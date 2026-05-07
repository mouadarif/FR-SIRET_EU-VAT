function toNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function pickRowId(row = {}) {
    return row._row_id || row.row_id || row.Row_ID || '';
}

function splitPipe(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value)
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseJsonSafe(value, fallback = null) {
    if (!value || typeof value !== 'string') return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function createReviewCaseId(runId, rowId) {
    return `${runId || 'run'}::${rowId}`;
}

function requiresHumanReview(decision, thresholds) {
    if (!decision) return false;
    if (decision.decision_status === 'REVIEW_REQUIRED') return true;
    if (decision.decision_status === 'ERROR') return true;
    if (decision.decision_status === 'NO_MATCH') {
        return decision.final_confidence >= thresholds.lowScoreForReview;
    }
    return false;
}

function buildFlagReasons({ decision, row, ambiguityEntry, thresholds }) {
    const reasons = [];
    const margin = toNumber(decision?.score_margin_top1_top2, 0);
    const confidence = toNumber(decision?.final_confidence, 0);

    if (decision?.decision_status === 'REVIEW_REQUIRED') {
        reasons.push('PHASE5_OR_EOD_MARKED_REVIEW_REQUIRED');
    }

    if (decision?.decision_status === 'ERROR') {
        reasons.push('PIPELINE_ERROR_OR_DEAD_LETTER');
    }

    if (confidence < thresholds.autoResolveThreshold) {
        reasons.push('CONFIDENCE_BELOW_AUTO_THRESHOLD');
    }

    if (margin < thresholds.ambiguityMargin) {
        reasons.push('TOP2_MARGIN_TOO_SMALL');
    }

    const reasonCodes = splitPipe(row?.Resolution_Reason_Codes);
    reasonCodes.forEach((code) => reasons.push(code));

    if (row?.LLM_Contamination_Flags) {
        reasons.push('LLM_CROSS_CONTAMINATION_WARNING');
    }

    if (ambiguityEntry?.reason) {
        reasons.push(ambiguityEntry.reason);
    }

    return [...new Set(reasons)];
}

function buildTopCandidates(decision, ambiguityEntry) {
    const candidatesFromDecision = Array.isArray(decision?.top_candidates) ? decision.top_candidates : [];
    const candidatesFromAmbiguity = Array.isArray(ambiguityEntry?.topCandidates)
        ? ambiguityEntry.topCandidates.map((item) => ({
            siret: item?.candidate?.siret || item?.siret || null,
            siren: item?.candidate?.siren || item?.siren || null,
            score: toNumber(item?.eodScore ?? item?.score, 0),
            retrieval_lane: item?.retrieval_lane || null,
            components: item?.score_components || item?.breakdown || {}
        }))
        : [];

    const merged = [...candidatesFromDecision, ...candidatesFromAmbiguity];
    const unique = new Map();

    for (const candidate of merged) {
        const key = candidate?.siret || candidate?.siren;
        if (!key) continue;
        if (!unique.has(key)) {
            unique.set(key, candidate);
        }
    }

    return [...unique.values()]
        .sort((left, right) => toNumber(right.score, 0) - toNumber(left.score, 0))
        .slice(0, 5);
}

function buildSignalBundle(row = {}) {
    const llmParse = parseJsonSafe(row.LLM_Parse_JSON, null);
    const llmVerification = parseJsonSafe(row.LLM_Verification_JSON, null);
    return {
        company_name_raw: row.Original_Name || row.Enriched_Name || '',
        company_name_core: row.Enriched_Name || row.Original_Name || '',
        city: row.Original_City || row.Enriched_City || '',
        postal_code: row.Original_CP || row.Enriched_CP || '',
        transaction_date: row.Transaction_Date_Used || '',
        parse_status: row.Parse_Status || '',
        llm_parse: llmParse,
        llm_verification: llmVerification
    };
}

/**
 * Build Phase 8 human review queue.
 *
 * @param {{
 *  runId?: string,
 *  finalDecisions?: Array<any>,
 *  results?: Array<Record<string, any>>,
 *  ambiguityReport?: Array<any>,
 *  thresholds?: {
 *   autoResolveThreshold?: number,
 *   ambiguityMargin?: number,
 *   lowScoreForReview?: number
 *  }
 * }} params
 */
export function buildReviewQueue(params = {}) {
    const runId = params.runId || '';
    const finalDecisions = Array.isArray(params.finalDecisions) ? params.finalDecisions : [];
    const results = Array.isArray(params.results) ? params.results : [];
    const ambiguityReport = Array.isArray(params.ambiguityReport) ? params.ambiguityReport : [];

    const thresholds = {
        autoResolveThreshold: 0.88,
        ambiguityMargin: 0.08,
        lowScoreForReview: 0.55,
        ...(params.thresholds || {})
    };

    const rowLookup = new Map();
    results.forEach((row) => {
        const rowId = pickRowId(row);
        if (!rowId) return;
        rowLookup.set(rowId, row);
    });

    const ambiguityLookup = new Map();
    ambiguityReport.forEach((entry) => {
        if (!entry?.rowId) return;
        ambiguityLookup.set(entry.rowId, entry);
    });

    const reviewCases = [];
    for (const decision of finalDecisions) {
        if (!requiresHumanReview(decision, thresholds)) continue;
        const rowId = decision?.row_id || '';
        const row = rowLookup.get(rowId) || {};
        const ambiguityEntry = ambiguityLookup.get(rowId);
        const topCandidates = buildTopCandidates(decision, ambiguityEntry);
        const flagReasons = buildFlagReasons({
            decision,
            row,
            ambiguityEntry,
            thresholds
        });

        reviewCases.push({
            review_case_id: createReviewCaseId(runId, rowId),
            row_id: rowId,
            status: decision.decision_status,
            suggested_winner: topCandidates[0] || null,
            top_candidates: topCandidates,
            score_snapshot: {
                top1_score: toNumber(decision.final_confidence, 0),
                margin: toNumber(decision.score_margin_top1_top2, 0),
                decision_source: decision.decision_source || ''
            },
            parsed_signals: buildSignalBundle(row),
            raw_text: Object.values(row).map((value) => String(value ?? '')).join(' | ').slice(0, 4000),
            flags: flagReasons,
            created_at: new Date().toISOString()
        });
    }

    return reviewCases;
}

/**
 * Apply structured human-review labels to final decisions.
 *
 * @param {{
 *  finalDecisions?: Array<any>,
 *  reviewLabels?: Array<{
 *   review_case_id?: string,
 *   row_id?: string,
 *   reviewer_id?: string,
 *   action_type: 'SELECT_CANDIDATE'|'MARK_NO_MATCH'|'MARK_NOT_A_COMPANY'|'CORRECT_SIGNALS'|'SPLIT_ROW',
 *   selected_siret?: string|null,
 *   selected_siren?: string|null,
 *   corrected_signals_json?: any,
 *   reason_code?: string,
 *   comment?: string
 *  }>
 * }} params
 */
export function applyReviewLabels(params = {}) {
    const decisions = Array.isArray(params.finalDecisions) ? params.finalDecisions : [];
    const labels = Array.isArray(params.reviewLabels) ? params.reviewLabels : [];

    const decisionByRow = new Map(decisions.map((decision) => [decision.row_id, { ...decision }]));
    const appliedLabels = [];

    labels.forEach((label) => {
        const rowId = label?.row_id || '';
        if (!rowId || !decisionByRow.has(rowId)) return;

        const current = decisionByRow.get(rowId);
        const action = String(label?.action_type || '');
        if (!action) return;

        const next = {
            ...current,
            review_override: {
                action_type: action,
                reviewer_id: label?.reviewer_id || '',
                reason_code: label?.reason_code || '',
                comment: label?.comment || '',
                labeled_at: new Date().toISOString()
            }
        };

        if (action === 'SELECT_CANDIDATE') {
            next.decision_status = 'AUTO_RESOLVED';
            next.decision_source = 'HUMAN_REVIEW';
            next.decision_reason_code = label?.reason_code || 'HUMAN_SELECTED_CANDIDATE';
            next.selected_siret = label?.selected_siret || next.selected_siret || null;
            next.selected_siren = label?.selected_siren || next.selected_siren || null;
        } else if (action === 'MARK_NO_MATCH') {
            next.decision_status = 'NO_MATCH';
            next.decision_source = 'HUMAN_REVIEW';
            next.decision_reason_code = label?.reason_code || 'HUMAN_MARKED_NO_MATCH';
            next.selected_siret = null;
            next.selected_siren = null;
        } else if (action === 'MARK_NOT_A_COMPANY') {
            next.decision_status = 'NO_MATCH';
            next.decision_source = 'HUMAN_REVIEW';
            next.decision_reason_code = label?.reason_code || 'HUMAN_MARKED_NOT_A_COMPANY';
            next.selected_siret = null;
            next.selected_siren = null;
        } else if (action === 'CORRECT_SIGNALS') {
            next.decision_status = 'REVIEW_REQUIRED';
            next.decision_source = 'HUMAN_REVIEW';
            next.decision_reason_code = label?.reason_code || 'HUMAN_CORRECTED_SIGNALS';
            next.corrected_signals = label?.corrected_signals_json || null;
        } else if (action === 'SPLIT_ROW') {
            next.decision_status = 'REVIEW_REQUIRED';
            next.decision_source = 'HUMAN_REVIEW';
            next.decision_reason_code = label?.reason_code || 'HUMAN_REQUESTED_SPLIT';
        }

        next.resolved_at = new Date().toISOString();
        decisionByRow.set(rowId, next);
        appliedLabels.push({
            row_id: rowId,
            action_type: action
        });
    });

    return {
        finalDecisions: [...decisionByRow.values()],
        appliedLabels
    };
}
