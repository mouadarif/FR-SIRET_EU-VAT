import { GoogleGenerativeAI } from '@google/generative-ai';
import {
    ENRICHMENT_BATCH_SIZES,
    IDENTITY_MAX_HYPOTHESES,
    IDENTITY_PROMPT_VERSION
} from './identityConfig.js';
import {
    getCachedLlmExtraction,
    hashRowForExtraction,
    setCachedLlmExtraction
} from '../services/memory/enrichmentCaches.js';
import { normalizeExtractionPayload } from '../services/batch/llmExtractionSchema.js';
import { verifyExtractionRows } from '../services/batch/llmVerifier.js';

const MODEL_NAME = 'gemini-2.5-flash';

const PHASE2_SYSTEM_PROMPT = `You are a strict information extraction engine for French ERP text lines.

Your task is ONLY to extract row-local signals from each row text.
You are NOT allowed to resolve entities, guess INSEE matches, or infer missing values from other rows.

CORE RULES (MANDATORY)
1) Treat each <Row> independently. Never copy or reuse information from another row.
2) Extract only what is explicitly present in the row text.
3) If a field is missing or uncertain, return null (never guess).
4) For every non-null field, return an evidence_text that is an exact substring from that same row.
5) DO NOT return character offsets. Offsets are forbidden.
6) Keep row_id exactly as provided.
7) Return JSON only. No markdown, no commentary, no explanations.

Return a single JSON object with:
{
  "rows": [
    {
      "row_id": "...",
      "parse_status": "parsed|low_confidence|empty",
      "fields": {
        "company_name_raw": {"value": "...|null", "evidence_text": "...|null", "confidence": 0..1},
        "company_name_core": {"value": "...|null", "evidence_text": "...|null", "confidence": 0..1},
        "city": {"value": "...|null", "evidence_text": "...|null", "confidence": 0..1},
        "postal_code": {"value": "...|null", "evidence_text": "...|null", "confidence": 0..1},
        "siren": {"value": "...|null", "evidence_text": "...|null", "confidence": 0..1},
        "siret": {"value": "...|null", "evidence_text": "...|null", "confidence": 0..1},
        "legal_form": {"value": "...|null", "evidence_text": "...|null", "confidence": 0..1},
        "transaction_date": {"value": "...|null", "evidence_text": "...|null", "confidence": 0..1},
        "address_fragment": {"value": "...|null", "evidence_text": "...|null", "confidence": 0..1}
      },
      "invalid_field_count": 0,
      "notes": ["short_machine_notes_only"]
    }
  ]
}`;

const PHASE2_USER_PROMPT = `Extract row-local signals from the following ERP rows.

IMPORTANT:
- Use only the text inside each <Row>.
- Never use information from one row to fill another row.
- Return JSON only.
- Do NOT return character offsets.
- Every non-null field must include evidence_text copied exactly from the same row.

Normalization conventions:
- company_name_core.value: uppercase, stripped of legal form and obvious ERP noise words
- city.value: uppercase normalized city string
- postal_code.value: 5 digits only
- siren.value: 9 digits only
- siret.value: 14 digits only
- transaction_date.value: YYYY-MM-DD only if unambiguous`;

const PHASE2_RETRY_PROMPT = `Re-extract the rows below with MAXIMUM strictness.

A previous extraction failed validation because some values were not exact substrings of the same row.
This time:
- If unsure, return null.
- Do not normalize aggressively.
- Never invent or repair text.
- Every non-null evidence_text must be copied exactly from the row.

Return JSON only, same schema as before.`;

function stripCodeBlocks(text) {
    return String(text || '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
}

function extractJson(text) {
    const clean = stripCodeBlocks(text);
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) return null;
    return clean.slice(start, end + 1);
}

function coerceArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clamp01(value, fallback = 0.5) {
    const parsed = Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(1, parsed));
}

function parseTransactionDate(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(raw)) {
        const [dd, mm, yyyy] = raw.split(/[/-]/);
        return `${yyyy}-${mm}-${dd}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
}

function normalizePlan(plan, transactionDate) {
    const list = Array.isArray(plan) ? plan : [];
    return list
        .map((step, index) => ({
            priority: Number.parseInt(String(step?.priority ?? index + 1), 10) || index + 1,
            endpoint: step?.endpoint || 'search_siret',
            lookupValue: step?.lookupValue || null,
            q: step?.q || null,
            params: {
                nombre: typeof step?.params?.nombre === 'number' ? step.params.nombre : null,
                tri: step?.params?.tri || null,
                date: step?.params?.date || transactionDate || null,
                champs: coerceArray(step?.params?.champs)
            },
            why: step?.why || 'No reason provided'
        }))
        .slice(0, IDENTITY_MAX_HYPOTHESES);
}

function getGeminiClient() {
    if (import.meta.env?.VITEST && import.meta.env?.VITE_ENABLE_GEMINI_IN_TESTS !== '1') {
        return null;
    }
    const key = import.meta.env?.VITE_GEMINI_API_KEY;
    if (!key || key === 'YOUR_GEMINI_API_KEY_HERE') return null;
    return new GoogleGenerativeAI(key);
}

function xmlEscape(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildRawRowText(canonical = {}) {
    if (canonical.raw_text) return String(canonical.raw_text);
    const raw = canonical.raw || {};
    return Object.values(raw)
        .map((value) => String(value || ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildBatchXml(batchRows) {
    const lines = ['<Batch>'];
    for (const item of batchRows) {
        lines.push(`  <Row id="${xmlEscape(item.rowId)}">${xmlEscape(item.rowText)}</Row>`);
    }
    lines.push('</Batch>');
    return lines.join('\n');
}

function hasExtractedSignal(row) {
    const fields = row?.fields || {};
    return Boolean(
        fields.siret?.value
        || fields.siren?.value
        || fields.company_name_core?.value
        || fields.company_name_raw?.value
        || fields.city?.value
        || fields.postal_code?.value
        || fields.transaction_date?.value
        || fields.address_fragment?.value
    );
}

function buildDeterministicPayload(fallback, warning = null) {
    const metadata = {
        source: 'deterministic',
        promptVersion: `${IDENTITY_PROMPT_VERSION}-phase2`,
        model: null
    };
    if (warning) metadata.warning = warning;

    return {
        hypothesis: {
            ...fallback,
            metadata
        },
        rawModelOutput: null,
        llm_parse: null,
        llm_verification: null
    };
}

function averageConfidence(values = []) {
    const numbers = values
        .map((value) => Number.parseFloat(String(value)))
        .filter((value) => Number.isFinite(value));
    if (!numbers.length) return 0;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function splitAddressTokens(value) {
    return String(value || '')
        .split(/[\s,;|/\\\-]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
        .slice(0, 8);
}

function buildHypothesisFromExtraction(row, fallback) {
    const fields = row?.fields || {};
    const baseSignals = fallback?.row_analysis?.identity_signals || {};

    const coreName = fields.company_name_core?.value || null;
    const rawName = fields.company_name_raw?.value || null;
    const legalNameCandidates = coreName
        ? [coreName]
        : rawName
            ? [rawName]
            : coerceArray(baseSignals.legal_name_candidates);
    const tradeNameCandidates = (
        rawName
        && coreName
        && rawName !== coreName
    ) ? [rawName] : coerceArray(baseSignals.trade_name_candidates);

    const transactionDate = parseTransactionDate(fields.transaction_date?.value || baseSignals.transaction_date);
    const queryPlan = normalizePlan(fallback?.query_plan || [], transactionDate);

    const extractConfidence = averageConfidence([
        fields.company_name_raw?.confidence,
        fields.company_name_core?.confidence,
        fields.city?.confidence,
        fields.postal_code?.confidence,
        fields.siren?.confidence,
        fields.siret?.confidence,
        fields.transaction_date?.confidence
    ]);

    let readiness = 0.2;
    if (fields.siret?.value) readiness = 0.98;
    else if (fields.siren?.value) readiness = 0.9;
    else if ((coreName || rawName) && (fields.city?.value || fields.postal_code?.value)) readiness = 0.75;
    else if (coreName || rawName) readiness = 0.58;
    if (row?.parse_status === 'low_confidence') readiness *= 0.85;
    if (row?.parse_status === 'empty') readiness = Math.min(readiness, 0.35);

    const ambiguityFlags = coerceArray(fallback?.row_analysis?.ambiguity_flags);
    if (row?.parse_status === 'low_confidence' || row?.parse_status === 'empty') {
        ambiguityFlags.push(`phase2_${row.parse_status}`);
    }

    const nextAction = fields.siret?.value || fields.siren?.value
        ? 'DIRECT_LOOKUP'
        : legalNameCandidates.length > 0 || tradeNameCandidates.length > 0
            ? 'SEARCH'
            : row?.parse_status === 'empty'
                ? 'NEEDS_MORE_DATA'
                : 'MANUAL_REVIEW';

    return {
        row_analysis: {
            identity_signals: {
                possible_siret: fields.siret?.value || baseSignals.possible_siret || null,
                possible_siren: fields.siren?.value || baseSignals.possible_siren || null,
                possible_vat_fr: baseSignals.possible_vat_fr || null,
                legal_name_candidates: legalNameCandidates,
                trade_name_candidates: tradeNameCandidates,
                postal_code: fields.postal_code?.value || baseSignals.postal_code || null,
                city: fields.city?.value || baseSignals.city || null,
                transaction_date: transactionDate || null,
                address_tokens: fields.address_fragment?.value
                    ? splitAddressTokens(fields.address_fragment.value)
                    : coerceArray(baseSignals.address_tokens),
                legal_form_hint: fields.legal_form?.value || baseSignals.legal_form_hint || null,
                activity_hint: baseSignals.activity_hint || null
            },
            noise_tokens: coerceArray(fallback?.row_analysis?.noise_tokens),
            missing_critical_signals: coerceArray(fallback?.row_analysis?.missing_critical_signals),
            ambiguity_flags: [...new Set(ambiguityFlags)]
        },
        query_plan: queryPlan,
        confidence: {
            identity_extract_confidence: clamp01(extractConfidence, fallback?.confidence?.identity_extract_confidence ?? 0.5),
            match_readiness_confidence: clamp01(readiness, fallback?.confidence?.match_readiness_confidence ?? 0.5)
        },
        next_action: nextAction,
        metadata: {
            source: 'gemini_phase2',
            promptVersion: `${IDENTITY_PROMPT_VERSION}-phase2`,
            model: MODEL_NAME,
            parse_status: row?.parse_status || 'low_confidence'
        }
    };
}

function chooseBestAttempt(firstAttempt, retryAttempt) {
    if (!retryAttempt) return firstAttempt;
    const firstInvalid = firstAttempt?.verification?.invalid_field_count ?? 999;
    const retryInvalid = retryAttempt?.verification?.invalid_field_count ?? 999;
    if (retryInvalid < firstInvalid) return retryAttempt;
    return firstAttempt;
}

async function runGeminiPhase2Chunk(model, chunk, { retry = false } = {}) {
    const batchXml = buildBatchXml(chunk);
    const prompt = retry ? PHASE2_RETRY_PROMPT : PHASE2_USER_PROMPT;
    const content = [
        PHASE2_SYSTEM_PROMPT,
        '',
        prompt,
        '',
        'Batch payload:',
        batchXml
    ].join('\n');

    const result = await model.generateContent(content);
    const rawModelOutput = result?.response?.text?.() || '';
    const jsonText = extractJson(rawModelOutput);
    if (!jsonText) {
        throw new Error('Gemini did not return valid JSON for Phase 2 extraction');
    }

    const parsed = JSON.parse(jsonText);
    const expectedIds = chunk.map((item) => item.rowId);
    const normalized = normalizeExtractionPayload(parsed, expectedIds);
    const rowTextById = new Map(chunk.map((item) => [item.rowId, item.rowText]));
    const verifiedRows = verifyExtractionRows(normalized.rows, rowTextById);

    const byRowId = new Map();
    for (const verified of verifiedRows) {
        byRowId.set(verified.row.row_id, {
            llm_parse: normalized.byRowId.get(verified.row.row_id) || verified.row,
            verified_row: verified.row,
            verification: verified.verification,
            rawModelOutput
        });
    }
    return { byRowId, rawModelOutput };
}

/**
 * Batch warm-up for Gemini extraction cache using XML batch prompts and deterministic verification.
 *
 * @param {Array<{ canonical: any, deterministicHypothesis: any }>} items
 * @param {{ batchSize?: number }} [options]
 */
async function runGeminiBatchExtraction(items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return [];

    const output = new Array(list.length);
    const pending = [];

    for (let index = 0; index < list.length; index += 1) {
        const item = list[index];
        const canonical = item?.canonical || {};
        const fallback = item?.deterministicHypothesis || null;
        const cacheKey = hashRowForExtraction(canonical);
        const cached = getCachedLlmExtraction(cacheKey);
        if (cached) {
            output[index] = {
                hypothesis: cached.hypothesis,
                rawModelOutput: cached.rawModelOutput || null,
                llm_parse: cached.llm_parse || null,
                llm_verification: cached.llm_verification || null
            };
            continue;
        }

        const rowId = String(canonical?.rowId || canonical?.raw?._row_id || `ROW_${index + 1}`);
        pending.push({
            index,
            cacheKey,
            rowId,
            rowText: buildRawRowText(canonical),
            fallback,
            canonical
        });
    }

    if (!pending.length) {
        return output;
    }

    const batchSize = Math.max(
        1,
        Number.parseInt(String(options.batchSize || ENRICHMENT_BATCH_SIZES.llmExtractionBatch), 10)
        || ENRICHMENT_BATCH_SIZES.llmExtractionBatch
    );

    const client = getGeminiClient();
    const model = client
        ? client.getGenerativeModel({
            model: MODEL_NAME,
            generationConfig: {
                temperature: 0.1
            }
        })
        : null;

    for (let start = 0; start < pending.length; start += batchSize) {
        const chunk = pending.slice(start, start + batchSize);

        if (!model) {
            for (const item of chunk) {
                const fallbackPayload = buildDeterministicPayload(item.fallback);
                setCachedLlmExtraction(item.cacheKey, fallbackPayload);
                output[item.index] = fallbackPayload;
            }
            continue;
        }

        let firstAttempt;
        try {
            firstAttempt = await runGeminiPhase2Chunk(model, chunk, { retry: false });
        } catch {
            firstAttempt = null;
        }

        let retryAttempt = null;
        if (firstAttempt) {
            const retryRows = chunk.filter((item) => {
                const firstRow = firstAttempt.byRowId.get(item.rowId);
                return (firstRow?.verification?.invalid_field_count || 0) > 0;
            });
            if (retryRows.length > 0) {
                try {
                    retryAttempt = await runGeminiPhase2Chunk(model, retryRows, { retry: true });
                } catch {
                    retryAttempt = null;
                }
            }
        } else {
            try {
                retryAttempt = await runGeminiPhase2Chunk(model, chunk, { retry: true });
            } catch {
                retryAttempt = null;
            }
        }

        for (const item of chunk) {
            const firstRow = firstAttempt?.byRowId?.get(item.rowId) || null;
            const retryRow = retryAttempt?.byRowId?.get(item.rowId) || null;
            const selected = chooseBestAttempt(firstRow, retryRow);

            if (!selected) {
                const fallbackPayload = buildDeterministicPayload(item.fallback, 'phase2_extraction_failed');
                setCachedLlmExtraction(item.cacheKey, fallbackPayload);
                output[item.index] = fallbackPayload;
                continue;
            }

            const hasSignal = hasExtractedSignal(selected.verified_row);
            const hypothesis = hasSignal
                ? buildHypothesisFromExtraction(selected.verified_row, item.fallback)
                : {
                    ...item.fallback,
                    metadata: {
                        source: 'deterministic',
                        promptVersion: `${IDENTITY_PROMPT_VERSION}-phase2`,
                        model: MODEL_NAME,
                        warning: 'phase2_empty_signals'
                    }
                };

            const payload = {
                hypothesis,
                rawModelOutput: selected.rawModelOutput || null,
                llm_parse: selected.llm_parse || null,
                llm_verification: selected.verification || null
            };
            setCachedLlmExtraction(item.cacheKey, payload);
            output[item.index] = payload;
        }
    }

    return output;
}

/**
 * Run Gemini-based row parsing for a single canonical row.
 *
 * @param {{
 *  canonical: any,
 *  deterministicHypothesis: any
 * }} params
 */
export async function runGeminiIdentityPlanning(params) {
    const canonical = params?.canonical || {};
    const fallback = params?.deterministicHypothesis || null;
    const cacheKey = hashRowForExtraction(canonical);
    const cached = getCachedLlmExtraction(cacheKey);
    if (cached) {
        return {
            hypothesis: cached.hypothesis,
            rawModelOutput: cached.rawModelOutput || null,
            llm_parse: cached.llm_parse || null,
            llm_verification: cached.llm_verification || null
        };
    }

    const [result] = await runGeminiBatchExtraction([
        {
            canonical,
            deterministicHypothesis: fallback
        }
    ], { batchSize: 1 });

    return result || buildDeterministicPayload(fallback);
}


// ---------------------------------------------------------------------------
// Tier 4 AI Detective — generate legal name variations for hard cases
// ---------------------------------------------------------------------------
const DETECTIVE_PROMPT = (name, postalCode) => `You are a specialist in the French business registry (INSEE Sirene / Annuaire des entreprises).

A company search failed for: "${name}" at postal code "${postalCode}".
Your job: suggest the most likely official registered names (dénomination légale) in INSEE.

Rules:
1. Legal forms (SARL, SAS, EURL, SCI, SA, SASU, SNC…) are usually NOT part of "denominationUniteLegale"
2. Return only the core name, without punctuation variations
3. Try abbreviations, concatenations, and common French registry patterns
4. Limit to 4 variations maximum

Return ONLY valid JSON, no markdown:
{"primaryName": "MOST_LIKELY_NAME", "alternativeNames": ["VAR1", "VAR2", "VAR3"]}`;

let _detectiveGenAI = null;
function getDetectiveGenAI() {
    if (_detectiveGenAI) return _detectiveGenAI;
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) return null;
    _detectiveGenAI = new GoogleGenerativeAI(apiKey);
    return _detectiveGenAI;
}

/**
 * Tier 4 AI Recovery — generate legal name variations for a company that
 * failed Tier 2 and Tier 3 searches.
 *
 * @param {string} name - Company display name that failed
 * @param {string} [postalCode] - Postal code hint
 * @returns {Promise<string[]>} - Array of name variations to try (may be empty)
 */
export async function getAINameVariations(name, postalCode = '') {
    if (!name) return [];
    try {
        const genAI = getDetectiveGenAI();
        if (!genAI) return [];
        const model = genAI.getGenerativeModel({ model: MODEL_NAME });
        const result = await model.generateContent(DETECTIVE_PROMPT(name, postalCode));
        const text = result.response.text().replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(text);
        const variations = [parsed.primaryName, ...(parsed.alternativeNames || [])]
            .map((v) => String(v || '').trim())
            .filter(Boolean);
        return variations;
    } catch {
        return [];
    }
}
