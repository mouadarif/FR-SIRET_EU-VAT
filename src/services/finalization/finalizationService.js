import {
    buildIdempotencyKey,
    buildRawHash,
    PipelinePersistenceStore
} from './pipelinePersistenceStore.js';

function toNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
    return new Date().toISOString();
}

function parseJsonSafe(value, fallback = null) {
    if (!value || typeof value !== 'string') return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function pickRowId(row = {}) {
    return row._row_id || row.row_id || row.Row_ID || '';
}

function pickApiStatus(row = {}) {
    return String(row.API_Status || '').toUpperCase();
}

function splitReasonCodes(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value)
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean);
}

function buildEodLookup(eodFinalized = []) {
    const map = new Map();
    for (const item of eodFinalized) {
        if (!item?.rowId) continue;
        map.set(item.rowId, item);
    }
    return map;
}

function buildAmbiguityLookup(ambiguityReport = []) {
    const map = new Map();
    for (const entry of ambiguityReport) {
        if (!entry?.rowId) continue;
        map.set(entry.rowId, entry);
    }
    return map;
}

function buildAuditLookup(auditTrail = []) {
    const map = new Map();
    for (const entry of auditTrail) {
        if (!entry?.rowId) continue;
        map.set(entry.rowId, entry);
    }
    return map;
}

function buildDeadLetterLookup(deadLetterQueue = []) {
    const map = new Map();
    for (const entry of deadLetterQueue) {
        if (!entry?.rowId) continue;
        map.set(entry.rowId, entry);
    }
    return map;
}

function normalizeDecisionStatus({ row, eodOverride }) {
    if (eodOverride?.decision === 'AUTO_ACCEPT') return 'EOD_RESOLVED';

    const apiStatus = pickApiStatus(row);
    if (apiStatus === 'EOD_RESOLVED') return 'EOD_RESOLVED';
    if (apiStatus === 'SUCCESS') return 'AUTO_RESOLVED';
    if (apiStatus === 'AMBIGUOUS_EOD' || apiStatus === 'REVIEW_QUEUE') return 'REVIEW_REQUIRED';
    if (apiStatus === 'NOT_FOUND') return 'NO_MATCH';
    if (apiStatus === 'DEAD_LETTER' || apiStatus === 'ERROR') return 'ERROR';

    const phase5Decision = String(row?.Resolution_Decision_Phase5 || '').toUpperCase();
    if (phase5Decision === 'AUTO_RESOLVED') return 'AUTO_RESOLVED';
    if (phase5Decision === 'AMBIGUOUS_EOD' || phase5Decision === 'REVIEW_QUEUE') return 'REVIEW_REQUIRED';
    if (phase5Decision === 'DEAD_LETTER') return 'ERROR';

    return 'NO_MATCH';
}

function decisionSource(status, eodOverride) {
    if (eodOverride?.decision === 'AUTO_ACCEPT' || status === 'EOD_RESOLVED') return 'PHASE6';
    if (status === 'ERROR') return 'PIPELINE';
    return 'PHASE5';
}

function defaultReasonCode(status) {
    if (status === 'AUTO_RESOLVED') return 'HIGH_MARGIN';
    if (status === 'EOD_RESOLVED') return 'GLOBAL_TIEBREAK';
    if (status === 'REVIEW_REQUIRED') return 'NEEDS_REVIEW';
    if (status === 'NO_MATCH') return 'NO_CANDIDATE';
    return 'PIPELINE_ERROR';
}

function normalizeTopCandidate(candidate) {
    if (!candidate) return null;

    const score = toNumber(candidate.eodScore ?? candidate.score, 0);
    const siret = candidate?.candidate?.siret || candidate?.siret || null;
    const siren = candidate?.candidate?.siren || candidate?.siren || null;

    return {
        siret,
        siren,
        score,
        retrieval_lane: candidate?.retrieval_lane || candidate?.matched_via_lane || null,
        components: candidate?.score_components || candidate?.breakdown || candidate?.scoreBreakdown || {}
    };
}

function collectTopCandidates({ row, ambiguityEntry, eodOverride }) {
    if (eodOverride?.scoreBreakdown) {
        return [normalizeTopCandidate(eodOverride.scoreBreakdown)].filter(Boolean);
    }

    const candidates = Array.isArray(ambiguityEntry?.topCandidates)
        ? ambiguityEntry.topCandidates
        : parseJsonSafe(row?.Identity_Candidate_Scores, []);

    if (!Array.isArray(candidates)) return [];
    return candidates.map((item) => normalizeTopCandidate(item)).filter(Boolean);
}

function buildDecisionReason({ row, status, eodOverride, deadLetterEntry }) {
    if (eodOverride?.decision === 'AUTO_ACCEPT') {
        return 'Resolved by end-of-day global disambiguation';
    }

    if (status === 'ERROR' && deadLetterEntry?.reason) {
        return deadLetterEntry.reason;
    }

    return row?.API_Reason
        || row?.Resolution_Unresolved_Reason
        || row?.Identity_Reason
        || '';
}

function buildDecisionExplanation({
    row,
    status,
    selectedSiret,
    selectedSiren,
    confidence,
    reasonCodes,
    reason,
    topCandidates,
    eodOverride
}) {
    const selectedName = row?.Resolved_Denomination
        || row?.Denomination_Unite_Legale
        || row?.Enriched_Name
        || row?.Original_Name
        || '';

    const why = [];
    if (status === 'EOD_RESOLVED') {
        why.push('EOD global disambiguation selected the top cluster-consistent candidate');
    }
    if (reason) {
        why.push(reason);
    }
    for (const code of reasonCodes.slice(0, 3)) {
        why.push(code.replace(/_/g, ' '));
    }

    const alternatives = [];
    if (Array.isArray(topCandidates) && topCandidates.length > 1) {
        topCandidates.slice(1, 4).forEach((candidate) => {
            alternatives.push({
                siret: candidate?.siret || null,
                score: toNumber(candidate?.score, 0),
                reason_not_selected: 'Lower deterministic/eod score than selected candidate'
            });
        });
    }

    if (eodOverride?.scoreBreakdown?.localMargin !== undefined) {
        why.push(`Local margin before EOD: ${eodOverride.scoreBreakdown.localMargin}`);
    }

    return {
        row_id: pickRowId(row),
        status,
        selected_entity: {
            siren: selectedSiren || null,
            siret: selectedSiret || null,
            name: selectedName || null,
            city: row?.Resolved_Commune || row?.Enriched_City || row?.Original_City || null,
            postal_code: row?.Resolved_CP || row?.Enriched_CP || row?.Original_CP || null
        },
        confidence,
        why: why.filter(Boolean),
        alternatives_considered: alternatives
    };
}

function buildInputLookup(inputRows = []) {
    const map = new Map();
    inputRows.forEach((row, index) => {
        const rowId = pickRowId(row);
        if (!rowId) return;
        map.set(rowId, {
            row,
            sourceLineNumber: index + 1
        });
    });
    return map;
}

function makeRawText(row = {}) {
    return Object.values(row)
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .join(' | ')
        .slice(0, 4000);
}

function buildFinalDecision({
    row,
    eodOverride,
    ambiguityEntry,
    auditEntry,
    deadLetterEntry,
    runId
}) {
    const status = normalizeDecisionStatus({ row, eodOverride });
    const selectedSiret = eodOverride?.recommendedCandidate?.siret
        || row?.Resolved_SIRET
        || null;
    const selectedSiren = eodOverride?.recommendedCandidate?.siren
        || row?.Resolved_SIREN
        || null;

    const confidence = toNumber(
        eodOverride?.topScore
        ?? row?.EOD_Final_Score
        ?? row?.Resolution_Confidence
        ?? row?.Identity_Top_Score,
        0
    );

    const margin = toNumber(
        eodOverride?.margin
        ?? row?.EOD_Score_Margin
        ?? row?.Resolution_Score_Margin
        ?? row?.Identity_Score_Margin,
        0
    );

    const topCandidates = collectTopCandidates({ row, ambiguityEntry, eodOverride });

    const reasonCodes = splitReasonCodes(row?.Resolution_Reason_Codes);
    if (!reasonCodes.length && eodOverride?.decision === 'AUTO_ACCEPT') {
        reasonCodes.push('GLOBAL_TIEBREAK');
    }

    const reason = buildDecisionReason({ row, status, eodOverride, deadLetterEntry });

    const decision = {
        row_id: pickRowId(row),
        decision_status: status,
        selected_siren: selectedSiren,
        selected_siret: selectedSiret,
        final_confidence: confidence,
        decision_source: decisionSource(status, eodOverride),
        decision_reason_code: reasonCodes[0] || defaultReasonCode(status),
        decision_explanation: reason,
        score_margin_top1_top2: margin,
        resolved_at: nowIso(),
        pipeline_run_id: runId,
        top_candidates: topCandidates,
        phase5_decision: row?.Resolution_Decision_Phase5 || '',
        eod_override_applied: eodOverride?.decision === 'AUTO_ACCEPT',
        audit: {
            tier_used: row?.Resolution_Tier || auditEntry?.tierUsed || '',
            confidence_from_phase5: toNumber(auditEntry?.confidence, confidence),
            api_status: row?.API_Status || ''
        }
    };

    decision.explanation_payload = buildDecisionExplanation({
        row,
        status,
        selectedSiret,
        selectedSiren,
        confidence,
        reasonCodes,
        reason,
        topCandidates,
        eodOverride
    });

    return decision;
}

function buildPipelineMetrics({
    runId,
    startedAt,
    endedAt,
    decisions,
    ambiguityReport,
    deadLetterQueue,
    dailyEntityGraph
}) {
    const counts = {
        AUTO_RESOLVED: 0,
        EOD_RESOLVED: 0,
        REVIEW_REQUIRED: 0,
        NO_MATCH: 0,
        ERROR: 0
    };

    decisions.forEach((decision) => {
        if (counts[decision.decision_status] !== undefined) {
            counts[decision.decision_status] += 1;
        }
    });

    const total = decisions.length;
    const unresolved = counts.REVIEW_REQUIRED + counts.NO_MATCH + counts.ERROR;
    const durationMs = Math.max(0, endedAt - startedAt);

    return {
        pipeline_run_id: runId,
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        duration_ms: durationMs,
        total_rows: total,
        auto_resolved: counts.AUTO_RESOLVED,
        eod_resolved: counts.EOD_RESOLVED,
        review_required: counts.REVIEW_REQUIRED,
        no_match: counts.NO_MATCH,
        error: counts.ERROR,
        unresolved_rate: total > 0 ? Number((unresolved / total).toFixed(4)) : 0,
        ambiguity_report_rows: ambiguityReport.length,
        dead_letter_rows: deadLetterQueue.length,
        graph_components: dailyEntityGraph?.nodeCounts?.components || 0,
        graph_edges: Array.isArray(dailyEntityGraph?.edges) ? dailyEntityGraph.edges.length : 0
    };
}

function persistRowArtifacts({
    store,
    row,
    inputRow,
    sourceLineNumber,
    sourceFileId,
    sourceSystem,
    runId,
    decision,
    versionInfo,
    ambiguityEntry
}) {
    const rowId = decision.row_id;
    const rawRow = inputRow || row;
    const rawHash = buildRawHash(rawRow || {});
    const idempotencyKey = buildIdempotencyKey({
        sourceSystem,
        sourceFileId,
        sourceLineNumber,
        rawHash
    });

    store.upsertRawRow({
        row_id: rowId,
        batch_id: runId,
        source_file_id: sourceFileId,
        source_line_number: sourceLineNumber,
        raw_text: makeRawText(rawRow),
        transaction_date: row?.Transaction_Date_Used || '',
        ingested_at: nowIso(),
        raw_hash: rawHash,
        idempotency_key: idempotencyKey
    });

    store.upsertSignalEnvelope({
        row_id: rowId,
        envelope_version: versionInfo.envelopeVersion,
        llm_model: versionInfo.llmModel,
        llm_prompt_version: versionInfo.llmPromptVersion,
        company_name_raw: row?.Original_Name || row?.Enriched_Name || '',
        company_name_core: row?.Enriched_Name || row?.Original_Name || '',
        legal_form_hint: row?.Original_Legal_Form || row?.Enriched_Legal_Form || '',
        siren_candidate: row?.Original_SIREN || '',
        siret_candidate: row?.Original_SIRET || '',
        postal_code: row?.Original_CP || row?.Enriched_CP || '',
        city: row?.Original_City || row?.Enriched_City || '',
        address_fragments: row?.Original_Address || row?.Enriched_Address || '',
        verification_flags: {
            parse_status: row?.Parse_Status || '',
            contamination_flags: splitReasonCodes(row?.LLM_Contamination_Flags),
            invalid_field_count: toNumber(row?.LLM_Invalid_Field_Count, 0)
        },
        parse_confidence: toNumber(row?.Identity_Extract_Confidence, 0),
        signals_json: {
            llm_parse: parseJsonSafe(row?.LLM_Parse_JSON, null),
            llm_verification: parseJsonSafe(row?.LLM_Verification_JSON, null)
        }
    });

    const queryId = `${rowId}::${row?.Resolution_Tier || 'resolver'}`;
    store.upsertQueryAttempt({
        query_id: queryId,
        row_id: rowId,
        lane: row?.Resolution_Tier || '',
        lucene_query: row?.Resolution_Query || '',
        date_param: row?.Transaction_Date_Used || '',
        champs_param: row?.KPI_Requested_Fields || '',
        http_status: row?.API_Status || '',
        result_count: toNumber(row?.Resolution_Candidate_Count, 0),
        latency_ms: null,
        rate_limit_bucket: row?.Service_State || '',
        issued_at: nowIso()
    });

    const selectedSnapshotId = `${rowId}::selected`;
    store.upsertCandidateSnapshot({
        candidate_snapshot_id: selectedSnapshotId,
        row_id: rowId,
        query_id: queryId,
        candidate_rank_from_api: 1,
        siren: decision.selected_siren,
        siret: decision.selected_siret,
        etablissement_siege: null,
        denomination: row?.Resolved_Denomination || row?.Denomination_Unite_Legale || '',
        denomination_usuelle: row?.Resolved_Enseigne || '',
        code_postal: row?.Resolved_CP || row?.Enriched_CP || row?.Original_CP || '',
        commune: row?.Resolved_Commune || row?.Enriched_City || row?.Original_City || '',
        etat_adm_unite_legale: row?.Resolved_Etat_UL || '',
        etat_adm_etablissement: row?.Resolved_Etat_Etablissement || '',
        candidate_json: {
            siret: decision.selected_siret,
            siren: decision.selected_siren,
            source: decision.decision_source
        }
    });

    if (Array.isArray(ambiguityEntry?.topCandidates)) {
        ambiguityEntry.topCandidates.slice(0, 3).forEach((candidate, index) => {
            const normalized = normalizeTopCandidate(candidate);
            if (!normalized) return;
            store.upsertCandidateSnapshot({
                candidate_snapshot_id: `${rowId}::alt::${index + 1}`,
                row_id: rowId,
                query_id: queryId,
                candidate_rank_from_api: index + 1,
                siren: normalized.siren,
                siret: normalized.siret,
                etablissement_siege: null,
                denomination: '',
                denomination_usuelle: '',
                code_postal: '',
                commune: '',
                etat_adm_unite_legale: '',
                etat_adm_etablissement: '',
                candidate_json: normalized
            });
        });
    }

    if (decision.selected_siret) {
        store.upsertCandidateScore({
            row_id: rowId,
            siret: decision.selected_siret,
            score_version: versionInfo.scoreVersion,
            name_score: toNumber(row?.Identity_Top_Score, 0),
            city_score: null,
            postal_score: null,
            geo_proximity_score: null,
            identifier_score: null,
            active_temporal_score: null,
            legal_form_boost: null,
            penalties: null,
            final_row_score: decision.final_confidence,
            score_explanation_json: {
                reason_codes: splitReasonCodes(row?.Resolution_Reason_Codes),
                margin: decision.score_margin_top1_top2
            }
        });
    }

    store.upsertResolutionDecision(decision);

    store.upsertCurrentLink({
        row_id: rowId,
        selected_siret: decision.selected_siret,
        selected_siren: decision.selected_siren,
        status: decision.decision_status,
        confidence: decision.final_confidence,
        last_updated_at: decision.resolved_at
    });
}

/**
 * Phase 7 finalization: consolidate decisions and persist audit-grade outputs.
 *
 * @param {{
 *  runId?: string,
 *  sourceFileId?: string,
 *  sourceSystem?: string,
 *  inputRows?: object[],
 *  results?: object[],
 *  auditTrail?: object[],
 *  ambiguityReport?: object[],
 *  deadLetterQueue?: object[],
 *  eodFinalized?: object[],
 *  dailyEntityGraph?: object|null,
 *  startedAt?: number,
 *  endedAt?: number,
 *  versionInfo?: {
 *   llmModel?: string,
 *   llmPromptVersion?: string,
 *   scoreVersion?: string,
 *   rulePackVersion?: string,
 *   queryTemplateVersion?: string,
 *   envelopeVersion?: string
 *  }
 * }} params
 */
export function finalizePipelineRun(params = {}) {
    const runId = params.runId || `run_${Date.now()}`;
    const sourceFileId = params.sourceFileId || '';
    const sourceSystem = params.sourceSystem || 'csv_upload';
    const inputRows = Array.isArray(params.inputRows) ? params.inputRows : [];
    const results = Array.isArray(params.results) ? params.results : [];
    const auditTrail = Array.isArray(params.auditTrail) ? params.auditTrail : [];
    const ambiguityReport = Array.isArray(params.ambiguityReport) ? params.ambiguityReport : [];
    const deadLetterQueue = Array.isArray(params.deadLetterQueue) ? params.deadLetterQueue : [];
    const eodFinalized = Array.isArray(params.eodFinalized) ? params.eodFinalized : [];
    const dailyEntityGraph = params.dailyEntityGraph || null;

    const versionInfo = {
        llmModel: params.versionInfo?.llmModel || 'gemini-2.5-flash',
        llmPromptVersion: params.versionInfo?.llmPromptVersion || 'phase2-extractor-v1',
        scoreVersion: params.versionInfo?.scoreVersion || 'phase4-scorer-v1',
        rulePackVersion: params.versionInfo?.rulePackVersion || 'phase5-gate-v1',
        queryTemplateVersion: params.versionInfo?.queryTemplateVersion || 'lane-template-v1',
        envelopeVersion: params.versionInfo?.envelopeVersion || 'envelope-v1'
    };

    const startedAt = Number.isFinite(params.startedAt) ? params.startedAt : Date.now();
    const endedAt = Number.isFinite(params.endedAt) ? params.endedAt : Date.now();

    const inputLookup = buildInputLookup(inputRows);
    const eodLookup = buildEodLookup(eodFinalized);
    const ambiguityLookup = buildAmbiguityLookup(ambiguityReport);
    const auditLookup = buildAuditLookup(auditTrail);
    const deadLetterLookup = buildDeadLetterLookup(deadLetterQueue);

    const store = new PipelinePersistenceStore(runId);
    const finalDecisions = [];

    results.forEach((row, index) => {
        const rowId = pickRowId(row);
        if (!rowId) return;

        const decision = buildFinalDecision({
            row,
            eodOverride: eodLookup.get(rowId),
            ambiguityEntry: ambiguityLookup.get(rowId),
            auditEntry: auditLookup.get(rowId),
            deadLetterEntry: deadLetterLookup.get(rowId),
            runId
        });

        const inputEntry = inputLookup.get(rowId);
        persistRowArtifacts({
            store,
            row,
            inputRow: inputEntry?.row,
            sourceLineNumber: inputEntry?.sourceLineNumber || (index + 1),
            sourceFileId,
            sourceSystem,
            runId,
            decision,
            versionInfo,
            ambiguityEntry: ambiguityLookup.get(rowId)
        });

        finalDecisions.push(decision);
    });

    const resolvedRowsExport = finalDecisions.map((decision) => ({
        row_id: decision.row_id,
        decision_status: decision.decision_status,
        selected_siren: decision.selected_siren,
        selected_siret: decision.selected_siret,
        final_confidence: decision.final_confidence,
        decision_source: decision.decision_source,
        decision_reason_code: decision.decision_reason_code,
        score_margin_top1_top2: decision.score_margin_top1_top2,
        pipeline_run_id: runId
    }));

    const reviewQueueExport = finalDecisions
        .filter((decision) => decision.decision_status === 'REVIEW_REQUIRED')
        .map((decision) => ({
            row_id: decision.row_id,
            reason_code: decision.decision_reason_code,
            confidence: decision.final_confidence,
            margin: decision.score_margin_top1_top2,
            candidates_topk: decision.top_candidates
        }));

    const pipelineMetrics = buildPipelineMetrics({
        runId,
        startedAt,
        endedAt,
        decisions: finalDecisions,
        ambiguityReport,
        deadLetterQueue,
        dailyEntityGraph
    });

    return {
        runId,
        finalDecisions,
        resolvedRowsExport,
        reviewQueueExport,
        pipelineMetrics,
        persistenceSnapshot: store.snapshot(),
        versionInfo
    };
}
