import cache from '../../api/cache.js';
import requestDedup from '../../api/requestDedup.js';
import requestQueue from '../../api/requestQueue.js';
import { scoreCandidatesDeterministic } from '../../domain/candidateScorer.js';
import { EntityResolver } from '../../domain/entityResolver.js';
import { runGeminiIdentityPlanning, getAINameVariations } from '../../domain/geminiIdentityAgent.js';
import { gateIdentityDecision } from '../../domain/identityGatekeeper.js';
import { collectRequiredFields, getKpiCatalog } from '../../domain/kpiCatalog.js';
import { runKpiEngine } from '../../domain/kpiEngine.js';
import { normalizeToken, stripLegalForms } from '../../domain/normalizationDictionaries.js';
import { buildDeterministicIdentityHypothesis } from '../../domain/rowPreprocessor.js';
import { normalizeEstablishment, reorganizeColumns } from './dataNormalizer.js';
import { updateEntityMemory } from '../memory/enrichmentCaches.js';
import { buildFieldCorrectionAudit, flattenFieldCorrectionAudit } from '../quality/fieldMergeAuditor.js';
import { scoreResolutionConfidence } from '../quality/resolutionScoring.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.insee.fr/api-sirene/3.11';

function cleanDigits(value, size) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!size) return digits;
    return digits.length === size ? digits : '';
}

/**
 * Convert scientific notation (e.g. "4,98155E+13" or "4.98155E+13") to a full integer string.
 * Excel frequently exports SIRETs in this format. Returns the original string if conversion fails.
 */
function parseScientificNumber(value) {
    const str = String(value || '').trim();
    if (!str) return str;
    // Normalize European decimal comma → dot
    const normalized = str.replace(',', '.');
    if (/^-?[\d.]+[eE][+\-]?\d+$/.test(normalized)) {
        const num = Number(normalized);
        if (Number.isFinite(num) && num > 0) {
            return Math.round(num).toString();
        }
    }
    return str;
}

function parseTransactionDate(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(raw)) {
        const [d, m, y] = raw.split(/[/-]/);
        return `${y}-${m}-${d}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function detectTransactionDate(raw = {}) {
    const preferredKeys = [
        'Transaction_Date',
        'transaction_date',
        'Date_Transaction',
        'Date_Facture',
        'Invoice_Date',
        'Document_Date',
        'date'
    ];
    for (const key of preferredKeys) {
        const parsed = parseTransactionDate(raw?.[key]);
        if (parsed) return parsed;
    }

    const merged = Object.values(raw).map((value) => String(value || '')).join(' ');
    const isoMatch = merged.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
    if (isoMatch) {
        const [full] = isoMatch;
        return full.replace(/\//g, '-');
    }
    const frMatch = merged.match(/\b(0[1-9]|[12]\d|3[01])[-/](0[1-9]|1[0-2])[-/](20\d{2})\b/);
    if (frMatch) {
        const [, dd, mm, yyyy] = frMatch;
        return `${yyyy}-${mm}-${dd}`;
    }
    return '';
}

function mergeIdentifiersWithSignals(identifiers, identitySignals = {}) {
    return {
        ...identifiers,
        siret: cleanDigits(identitySignals.possible_siret, 14) || identifiers.siret || '',
        siren: cleanDigits(identitySignals.possible_siren, 9) || identifiers.siren || '',
        name: (identitySignals.legal_name_candidates || [])[0]
            || identifiers.name
            || '',
        city: identitySignals.city || identifiers.city || '',
        postalCode: identitySignals.postal_code || identifiers.postalCode || ''
    };
}

function stringifySafe(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return '';
    }
}

function buildIdentityAuditColumns({
    canonical: _canonical,
    hypothesis,
    candidateScores,
    gate,
    rawModelOutput,
    llmParse,
    llmVerification
}) {
    const phase5Decision = gate?.decision || '';
    const legacyDecision = gate?.legacyDecision || '';
    return {
        Identity_Decision: phase5Decision,
        Identity_Decision_Legacy: legacyDecision,
        Identity_Reason: gate.reason,
        Identity_Top_Score: gate.topScore,
        Identity_Top2_Score: gate.top2Score ?? '',
        Identity_Score_Margin: gate.margin ?? '',
        Identity_Lock_Strength: gate.lock_strength || '',
        Identity_Reason_Codes: (gate.reason_codes || []).join(' | '),
        Identity_Query_Plan: stringifySafe(hypothesis?.query_plan || []),
        Identity_Ambiguity_Flags: (hypothesis?.row_analysis?.ambiguity_flags || []).join(' | '),
        Identity_Noise_Tokens: (hypothesis?.row_analysis?.noise_tokens || []).join(' | '),
        Identity_Extract_Confidence: hypothesis?.confidence?.identity_extract_confidence ?? '',
        Identity_Readiness_Confidence: hypothesis?.confidence?.match_readiness_confidence ?? '',
        Identity_Prompt_Version: hypothesis?.metadata?.promptVersion || '',
        Identity_Model: hypothesis?.metadata?.model || '',
        Identity_Source: hypothesis?.metadata?.source || 'deterministic',
        Identity_Candidate_Scores: stringifySafe(
            (candidateScores || []).slice(0, 3).map((item) => ({
                candidate_id: item.candidate_id,
                score: item.score,
                decision: item.decision,
                evidence: item.evidence,
                conflicts: item.conflicts,
                reason_codes: item.reason_codes || [],
                veto_flags: item.veto_flags || []
            }))
        ),
        Identity_Model_Raw_Output: rawModelOutput || '',
        LLM_Parse_JSON: stringifySafe(llmParse),
        LLM_Verification_JSON: stringifySafe(llmVerification),
        LLM_Invalid_Field_Count: llmVerification?.invalid_field_count ?? '',
        LLM_Contamination_Flags: (llmVerification?.contamination_flags || []).join(' | ')
    };
}

/**
 * Stage A: normalize input row into canonical structure.
 * @param {Record<string, any>} row
 * @param {object|null} [columnMapping] - Optional explicit column mapping:
 *   { name?, city?, postalCode?, siret?, siren? } — each value is the CSV column name to use.
 */
export function normalizeInputRow(row, columnMapping = null) {
    const raw = row || {};
    const cm = columnMapping || {};

    // Collect all available names to try as fallbacks
    const allNames = [];
    if (cm.name) {
        if (raw[cm.name]) allNames.push(raw[cm.name]);
    } else {
        if (raw.Enriched_Legal_Name) allNames.push(raw.Enriched_Legal_Name);
        if (raw.Enriched_Trade_Name) allNames.push(raw.Enriched_Trade_Name);
        if (raw.Original_Nom) allNames.push(raw.Original_Nom);
        if (raw.Enriched_Name) allNames.push(raw.Enriched_Name);
        if (raw.Nom) allNames.push(raw.Nom);
        if (raw['Raison sociale']) allNames.push(raw['Raison sociale']);
        if (raw.Company_Name) allNames.push(raw.Company_Name);
        if (raw.Name) allNames.push(raw.Name);
    }

    const uniqueNames = [...new Set(allNames.map(n => String(n).trim()).filter(Boolean))];
    const rawName = uniqueNames[0] || '';

    const rawCity = cm.city
        ? (raw[cm.city] || '')
        : (raw.Enriched_City || raw.Original_City || raw.City || raw.Commune || '');
    const rawPostal = cm.postalCode
        ? (raw[cm.postalCode] || '')
        : (raw.Enriched_CP || raw.Original_CP || raw['Code postal'] || raw.PostalCode || raw.Zip || '');
    const rawSiretInput = cm.siret
        ? (raw[cm.siret] || '')
        : (raw.Enriched_SIRET || raw.Original_SIRET || raw.SIRET || raw.Siret || '');
    const rawSiret = parseScientificNumber(rawSiretInput);
    // Scientific-notation SIRETs (e.g. "4,98155E+13") lose precision (only 6 sig figs).
    // Converted value (e.g. "49815500000000") is WRONG → would cause SIRET_CONTRADICTION
    // hardVeto on every candidate and force ALL_CANDIDATES_CONTRADICTED → NO_MATCH.
    // Treat as absent so name+postal scoring can work (weightedAverage redistributes weight).
    const siretIsApproximate = rawSiretInput.trim() !== rawSiret;

    const rawSirenInput = cm.siren
        ? (raw[cm.siren] || '')
        : (raw.Enriched_SIREN || raw.Original_SIREN || raw.SIREN || raw.Siren || '');
    const rawSiren = parseScientificNumber(rawSirenInput);
    const sirenIsApproximate = rawSirenInput.trim() !== rawSiren;

    const transactionDate = detectTransactionDate(raw);

    const postalCode = String(rawPostal || '').split('.')[0].padStart(5, '0');
    const department = postalCode.length >= 2
        ? (postalCode.startsWith('97') || postalCode.startsWith('98') ? postalCode.slice(0, 3) : postalCode.slice(0, 2))
        : '';

    // Only use SIRET/SIREN as hard identifier when the value is exact (not from scientific notation).
    const siret14 = siretIsApproximate ? '' : cleanDigits(rawSiret, 14);
    // SIREN = first 9 digits of SIRET — derive only when we have an exact SIRET.
    const siren9 = sirenIsApproximate
        ? ''
        : (cleanDigits(rawSiren, 9) || (siret14.length === 14 ? siret14.slice(0, 9) : ''));

    return {
        raw,
        rowId: raw._row_id || '',
        identifiers: {
            siret: siret14,
            siren: siren9,
            name: rawName,
            namesToTry: uniqueNames,
            city: String(rawCity || '').trim(),
            postalCode: postalCode.trim(),
            department
        },
        transactionDate,
        audit: {
            rawSiret: rawSiret || '',
            rawSiren: rawSiren || siren9 || '',
            rawName: rawName || '',
            rawCity: rawCity || '',
            rawPostalCode: rawPostal || '',
            rawTransactionDate: transactionDate || ''
        },
        parse_status: 'pending_llm',
        lineage: []
    };
}

function createAggregateFetcher(apiKey) {
    const headers = {
        Accept: 'application/json',
        'X-INSEE-Api-Key-Integration': apiKey
    };

    const runShared = async (key, factory) => {
        const cached = cache.getWithPolicy(key, 'facette');
        if (cached !== null) return cached;

        const dedupKey = requestDedup.buildKey(key, headers);
        return requestDedup.run(dedupKey, async () => {
            const value = await factory();
            cache.setWithPolicy(key, value, 'facette');
            return value;
        });
    };

    async function searchBySiren(siren) {
        const q = encodeURIComponent(`siren:${siren}`);
        const url = `${BASE_URL}/siret?q=${q}&nombre=1`;
        return requestQueue.add(async () => {
            const response = await fetch(url, { headers });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                throw error;
            }
            return response.json();
        });
    }

    runShared.searchBySiren = searchBySiren;
    return runShared;
}

/**
 * Stage B + C + D for a single row.
 * @param {{
 *  row: Record<string, any>,
 *  apiKey: string,
 *  kpiPreset?: 'default',
 *  aiRecoveryFn?: ((name: string, postalCode?: string) => Promise<string[]>) | null,
 *  serviceInfo?: { serviceState?: string, version?: string, freshnessDate?: string } | null,
 *  columnMapping?: object | null
 * }} params
 */
export async function runPipelineForRow(params) {
    const canonical = normalizeInputRow(params.row, params.columnMapping || null);
    const catalog = getKpiCatalog(params.kpiPreset || 'default');
    const requiredFields = collectRequiredFields(catalog);

    const deterministicHypothesis = buildDeterministicIdentityHypothesis(canonical);
    canonical.lineage.push({
        phase: 'deterministic_preprocess',
        timestamp: new Date().toISOString()
    });
    const {
        hypothesis,
        rawModelOutput,
        llm_parse: llmParse,
        llm_verification: llmVerification
    } = await runGeminiIdentityPlanning({
        canonical,
        deterministicHypothesis
    });
    if (!canonical.transactionDate) {
        canonical.transactionDate = parseTransactionDate(
            hypothesis?.row_analysis?.identity_signals?.transaction_date
        );
    }
    canonical.parse_status = llmVerification?.parse_status || llmParse?.parse_status || 'llm_extracted';
    canonical.lineage.push({
        phase: 'llm_identity_extraction',
        timestamp: new Date().toISOString(),
        source: hypothesis?.metadata?.source || 'deterministic'
    });
    canonical.lineage.push({
        phase: 'llm_extraction_verification',
        timestamp: new Date().toISOString(),
        parseStatus: llmVerification?.parse_status || llmParse?.parse_status || '',
        invalidFieldCount: llmVerification?.invalid_field_count ?? 0
    });

    const resolvedIdentifiers = mergeIdentifiersWithSignals(
        canonical.identifiers,
        hypothesis?.row_analysis?.identity_signals
    );

    const resolver = new EntityResolver({
        apiKey: params.apiKey,
        champs: requiredFields,
        aiRecoveryFn: params.aiRecoveryFn
            || ((name, postalCode) => getAINameVariations(name, postalCode)),
        queryDate: canonical.transactionDate || null
    });

    const resolution = await resolver.resolveFromQueryPlan({
        queryPlan: hypothesis?.query_plan || [],
        fallbackIdentifiers: resolvedIdentifiers,
        transactionDate: canonical.transactionDate || null
    });
    canonical.lineage.push({
        phase: 'insee_candidate_retrieval',
        timestamp: new Date().toISOString(),
        tierUsed: resolution?.metadata?.tierUsed || ''
    });

    const candidates = resolution.candidates || (resolution.entity ? [resolution.entity] : []);
    const candidateScores = scoreCandidatesDeterministic({
        input: {
            ...canonical,
            identifiers: resolvedIdentifiers,
            parse_confidence: hypothesis?.confidence?.identity_extract_confidence,
            parse_status: canonical.parse_status,
            llm_verification: llmVerification || null
        },
        candidates,
        lane: resolution?.metadata?.tierUsed || '',
        transactionDate: canonical.transactionDate || null
    });
    // When no identifier is present (SIRET/SIREN absent or from unreliable source),
    // the identifier feature (weight 0.52) is null and redistributed to name+geo.
    // Scores now top out ~0.79–0.93 instead of 1.0, and multiple sites of the same
    // company naturally produce margins < 0.08.
    // Use relaxed thresholds to avoid routing all good name+geo matches to REVIEW_QUEUE.
    const hasIdentifier = Boolean(resolvedIdentifiers.siret || resolvedIdentifiers.siren);
    const gateThresholds = hasIdentifier ? undefined : {
        autoAcceptScore: 0.74,   // reachable with perfect name+dept match, closed company
        autoAcceptMargin: 0.04,  // same company has 2 sites → margin ~0.06
        ambiguousScore: 0.60,
        ambiguousMargin: 0.04,
        reviewMinScore: 0.42
    };

    const gate = gateIdentityDecision({
        candidateScores,
        context: {
            identifiers: resolvedIdentifiers,
            parseStatus: canonical.parse_status,
            verification_flags: {
                cross_contamination_detected: Array.isArray(llmVerification?.contamination_flags)
                    && llmVerification.contamination_flags.length > 0,
                invalid_field_count: Number(llmVerification?.invalid_field_count || 0),
                empty_query_guard: canonical.parse_status === 'empty'
            }
        },
        thresholds: gateThresholds
    });
    const legacyDecision = gate.legacyDecision || 'NO_MATCH';
    const chosenCandidate = candidateScores[0]?.candidate || resolution.entity || null;
    canonical.lineage.push({
        phase: 'deterministic_scoring',
        timestamp: new Date().toISOString(),
        decision: gate.decision
    });

    const resolutionWithSignal = {
        ...resolution,
        entity: chosenCandidate,
        metadata: {
            ...(resolution.metadata || {}),
            apiScore: (candidateScores[0]?.score || 0) * 100
        }
    };

    const confidence = scoreResolutionConfidence({
        input: {
            ...canonical,
            identifiers: resolvedIdentifiers
        },
        resolution: resolutionWithSignal
    });

    const fieldAudit = buildFieldCorrectionAudit({
        raw: {
            siret: canonical.audit.rawSiret,
            siren: canonical.audit.rawSiren,
            name: canonical.audit.rawName,
            city: canonical.audit.rawCity,
            postalCode: canonical.audit.rawPostalCode
        },
        normalized: resolvedIdentifiers,
        corrected: {
            siret: chosenCandidate?.siret || '',
            siren: chosenCandidate?.siren || '',
            name: chosenCandidate?.uniteLegale?.denominationUniteLegale
                || chosenCandidate?.periodesEtablissement?.[0]?.denominationUsuelleEtablissement
                || '',
            city: chosenCandidate?.adresseEtablissement?.libelleCommuneEtablissement || '',
            postalCode: chosenCandidate?.adresseEtablissement?.codePostalEtablissement || ''
        },
        sourceByField: {
            siret: chosenCandidate?.siret ? 'INSEE' : 'INPUT',
            siren: chosenCandidate?.siren ? 'INSEE' : 'INPUT',
            name: chosenCandidate ? 'INSEE' : 'INPUT',
            city: chosenCandidate ? 'INSEE' : 'INPUT',
            postalCode: chosenCandidate ? 'INSEE' : 'INPUT'
        },
        confidenceByField: {
            siret: gate.topScore,
            siren: gate.topScore,
            name: confidence.score,
            city: confidence.score,
            postalCode: confidence.score
        },
        reasonByField: {
            siret: gate.reason,
            siren: gate.reason,
            name: gate.reason,
            city: gate.reason,
            postalCode: gate.reason
        }
    });
    const fieldAuditColumns = flattenFieldCorrectionAudit(fieldAudit);
    const identityColumns = buildIdentityAuditColumns({
        canonical,
        hypothesis,
        candidateScores,
        gate,
        rawModelOutput,
        llmParse,
        llmVerification
    });

    const baseColumns = {
        ...canonical.raw,
        ...fieldAuditColumns,
        ...identityColumns,
        Resolution_Confidence: confidence.score,
        Resolution_Confidence_Band: confidence.confidenceBand || '',
        Resolution_Review_Flag: confidence.needsReview ? 'YES' : 'NO',
        Resolution_Candidate_Count: resolution.metadata?.candidateCount || candidates.length || 0,
        Resolution_Query: resolution.metadata?.queryUsed || '',
        Resolution_Warnings: (resolution.metadata?.warnings || []).join(' | '),
        Resolution_Unresolved_Reason: legacyDecision === 'NO_MATCH'
            ? gate.reason
            : legacyDecision === 'REVIEW_REQUIRED'
                ? 'ambiguous_multi_candidate'
                : '',
        Resolution_Decision_Phase5: gate.decision || '',
        Resolution_Decision_Legacy: legacyDecision,
        Resolution_Top2_Score: gate.top2Score ?? '',
        Resolution_Score_Margin: gate.margin ?? '',
        Resolution_Lock_Strength: gate.lock_strength || '',
        Resolution_Reason_Codes: (gate.reason_codes || []).join(' | '),
        Resolution_Requires_EOD: gate.requires_eod_disambiguation ? 'YES' : 'NO',
        Parse_Status: canonical.parse_status,
        Pipeline_Lineage: stringifySafe(canonical.lineage),
        Transaction_Date_Used: canonical.transactionDate || '',
        Service_State: params.serviceInfo?.serviceState || '',
        Service_Version: params.serviceInfo?.version || '',
        Service_Freshness: params.serviceInfo?.freshnessDate || ''
    };

    if (resolution.status !== 'resolved' || !chosenCandidate || legacyDecision === 'NO_MATCH') {
        const isDeadLetter = gate.decision === 'DEAD_LETTER';
        const failedRow = reorganizeColumns({
            ...baseColumns,
            API_Status: isDeadLetter ? 'DEAD_LETTER' : 'NOT_FOUND',
            API_Method: resolution.metadata?.tierUsed || 'resolver',
            API_Reason: gate.reason || resolution.metadata?.warnings?.join(' | ') || 'No reliable match found',
            Resolution_Status: isDeadLetter ? 'DEAD_LETTER' : 'NOT_FOUND',
            Resolution_Tier: resolution.metadata?.tierUsed || '',
            Resolution_Decision: legacyDecision
        });

        return {
            status: 'not_found',
            outputRows: [failedRow],
            resolutionMetadata: {
                ...(resolution.metadata || {}),
                confidenceScore: confidence.score,
                rowDecision: gate,
                candidateScores
            }
        };
    }

    if (legacyDecision === 'REVIEW_REQUIRED') {
        const isAmbiguousEod = gate.decision === 'AMBIGUOUS_EOD';
        const reviewRow = reorganizeColumns({
            ...baseColumns,
            API_Status: isAmbiguousEod ? 'AMBIGUOUS_EOD' : 'REVIEW_QUEUE',
            API_Method: resolution.metadata?.tierUsed || 'query_plan',
            API_Reason: gate.reason,
            Resolved_SIRET: chosenCandidate?.siret || '',
            Resolved_SIREN: chosenCandidate?.siren || '',
            Resolution_Status: isAmbiguousEod ? 'AMBIGUOUS_EOD' : 'REVIEW_QUEUE',
            Resolution_Tier: resolution.metadata?.tierUsed || '',
            Resolution_Decision: legacyDecision
        });

        return {
            status: 'review_required',
            outputRows: [reviewRow],
            resolutionMetadata: {
                ...(resolution.metadata || {}),
                confidenceScore: confidence.score,
                rowDecision: gate,
                candidateScores
            }
        };
    }

    const aggregateFetcher = createAggregateFetcher(params.apiKey);
    const kpi = await runKpiEngine({
        catalog,
        entity: chosenCandidate,
        metadata: {
            ...(resolution.metadata || {}),
            confidenceScore: confidence.score
        },
        fetchAggregate: aggregateFetcher
    });

    const normalized = normalizeEstablishment(chosenCandidate);
    updateEntityMemory({
        nameSignature: normalizeToken(stripLegalForms(resolvedIdentifiers.name || canonical.audit.rawName || '')),
        city: resolvedIdentifiers.city || canonical.audit.rawCity || '',
        candidateId: chosenCandidate?.siret || chosenCandidate?.siren || '',
        confidence: confidence.score
    });
    const successRow = reorganizeColumns({
        ...baseColumns,
        API_Status: 'SUCCESS',
        API_Method: resolution.metadata?.tierUsed || 'query_plan',
        API_Total_Matches: resolution.metadata?.candidateCount || 1,
        API_Match_Number: 1,
        ...normalized,
        Resolved_SIRET: chosenCandidate?.siret || '',
        Resolved_SIREN: chosenCandidate?.siren || '',
        Resolution_Status: 'RESOLVED',
        Resolution_Tier: resolution.metadata?.tierUsed || '',
        Resolution_Decision: legacyDecision,
        ...kpi.values
    });

    return {
        status: 'resolved',
        outputRows: [successRow],
        resolutionMetadata: {
            ...(resolution.metadata || {}),
            confidenceScore: confidence.score,
            needsReview: confidence.needsReview,
            rowDecision: gate,
            candidateScores
        },
        kpiMetadata: kpi.perKpiMeta,
        identityHypothesis: hypothesis
    };
}
