function toNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAliasToken(value) {
    return String(value || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function addCount(map, key) {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
}

function mineAliasProposals(reviewLabels = []) {
    const aliasStats = new Map();

    reviewLabels.forEach((label) => {
        const corrected = label?.corrected_signals_json;
        if (!corrected || typeof corrected !== 'object') return;
        const from = normalizeAliasToken(corrected?.company_name_raw || corrected?.raw_name || '');
        const to = normalizeAliasToken(corrected?.company_name_core || corrected?.normalized_name || '');
        if (!from || !to || from === to) return;
        const key = `${from}=>${to}`;
        addCount(aliasStats, key);
    });

    return [...aliasStats.entries()]
        .map(([key, count]) => {
            const [from, to] = key.split('=>');
            return {
                alias_from: from,
                alias_to: to,
                observed_count: count,
                confidence: Math.min(1, count / 20)
            };
        })
        .sort((left, right) => right.observed_count - left.observed_count);
}

function evaluateScoring(reviewLabels = [], finalDecisions = []) {
    if (!reviewLabels.length) {
        return {
            labeled_rows: 0,
            human_selected_candidate_rate: 0,
            no_match_override_rate: 0,
            average_confidence_of_labeled_rows: 0
        };
    }

    const byRow = new Map(finalDecisions.map((decision) => [decision.row_id, decision]));

    let selectedCandidateCount = 0;
    let noMatchCount = 0;
    let confidenceSum = 0;
    let confidenceRows = 0;

    reviewLabels.forEach((label) => {
        const action = String(label?.action_type || '');
        if (action === 'SELECT_CANDIDATE') selectedCandidateCount += 1;
        if (action === 'MARK_NO_MATCH' || action === 'MARK_NOT_A_COMPANY') noMatchCount += 1;

        const rowId = label?.row_id || '';
        const decision = byRow.get(rowId);
        if (decision) {
            confidenceSum += toNumber(decision.final_confidence, 0);
            confidenceRows += 1;
        }
    });

    const total = reviewLabels.length;
    return {
        labeled_rows: total,
        human_selected_candidate_rate: Number((selectedCandidateCount / total).toFixed(4)),
        no_match_override_rate: Number((noMatchCount / total).toFixed(4)),
        average_confidence_of_labeled_rows: confidenceRows > 0
            ? Number((confidenceSum / confidenceRows).toFixed(4))
            : 0
    };
}

function minePromptFailurePatterns(reviewCases = [], reviewLabels = []) {
    const patternCounts = new Map();
    reviewCases.forEach((reviewCase) => {
        const flags = Array.isArray(reviewCase?.flags) ? reviewCase.flags : [];
        flags.forEach((flag) => addCount(patternCounts, flag));
    });

    reviewLabels.forEach((label) => {
        const reason = String(label?.reason_code || '').trim();
        if (reason) addCount(patternCounts, reason);
        if (String(label?.action_type || '') === 'CORRECT_SIGNALS') {
            addCount(patternCounts, 'LLM_SIGNAL_CORRECTION_REQUIRED');
        }
    });

    return [...patternCounts.entries()]
        .map(([pattern, count]) => ({
            pattern,
            count
        }))
        .sort((left, right) => right.count - left.count);
}

function computeOpsMetrics({ finalDecisions, reviewCases, reviewLabels }) {
    const totalRows = Array.isArray(finalDecisions) ? finalDecisions.length : 0;
    const counts = {
        AUTO_RESOLVED: 0,
        EOD_RESOLVED: 0,
        REVIEW_REQUIRED: 0,
        NO_MATCH: 0,
        ERROR: 0
    };

    finalDecisions.forEach((decision) => {
        const status = decision?.decision_status;
        if (counts[status] !== undefined) counts[status] += 1;
    });

    return {
        total_rows: totalRows,
        auto_resolved_rate: totalRows > 0 ? Number((counts.AUTO_RESOLVED / totalRows).toFixed(4)) : 0,
        eod_resolved_rate: totalRows > 0 ? Number((counts.EOD_RESOLVED / totalRows).toFixed(4)) : 0,
        review_required_rate: totalRows > 0 ? Number((counts.REVIEW_REQUIRED / totalRows).toFixed(4)) : 0,
        no_match_rate: totalRows > 0 ? Number((counts.NO_MATCH / totalRows).toFixed(4)) : 0,
        error_rate: totalRows > 0 ? Number((counts.ERROR / totalRows).toFixed(4)) : 0,
        review_queue_size: reviewCases.length,
        review_labels_received: reviewLabels.length
    };
}

/**
 * Phase 8 offline-safe learning artifact generation.
 *
 * @param {{
 *  runId?: string,
 *  finalDecisions?: Array<any>,
 *  reviewCases?: Array<any>,
 *  reviewLabels?: Array<any>
 * }} params
 */
export function generateLearningArtifacts(params = {}) {
    const runId = params.runId || '';
    const finalDecisions = Array.isArray(params.finalDecisions) ? params.finalDecisions : [];
    const reviewCases = Array.isArray(params.reviewCases) ? params.reviewCases : [];
    const reviewLabels = Array.isArray(params.reviewLabels) ? params.reviewLabels : [];

    const aliasProposals = mineAliasProposals(reviewLabels);
    const scoringEvaluation = evaluateScoring(reviewLabels, finalDecisions);
    const promptFailurePatterns = minePromptFailurePatterns(reviewCases, reviewLabels);
    const opsMetrics = computeOpsMetrics({ finalDecisions, reviewCases, reviewLabels });

    return {
        run_id: runId,
        generated_at: new Date().toISOString(),
        alias_proposals: aliasProposals,
        scoring_evaluation: scoringEvaluation,
        prompt_failure_patterns: promptFailurePatterns,
        ops_metrics: opsMetrics
    };
}

