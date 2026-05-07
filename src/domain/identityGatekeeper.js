import { createRowDecision } from './contracts.js';

function cleanDigits(value, size = null) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!size) return digits;
    return digits.length === size ? digits : '';
}

function mapLegacyDecision(decision) {
    if (decision === 'AUTO_RESOLVED') return 'AUTO_ACCEPT';
    if (decision === 'AMBIGUOUS_EOD' || decision === 'REVIEW_QUEUE') return 'REVIEW_REQUIRED';
    return 'NO_MATCH';
}

function toCompactCandidate(item) {
    return {
        siret: item?.candidate?.siret || null,
        siren: item?.candidate?.siren || null,
        score: Number((item?.score || 0).toFixed(4)),
        hard_veto: item?.hard_veto === true,
        red_flags: Array.isArray(item?.red_flags) ? item.red_flags : [],
        components: item?.score_components || item?.breakdown || {}
    };
}

function hasSevereContradictions(top) {
    const redFlags = Array.isArray(top?.red_flags) ? top.red_flags : [];
    const severe = ['NAME_STRONG_MISMATCH', 'CP_CONTRADICTION', 'CITY_STRONG_MISMATCH'];
    return severe.some((flag) => redFlags.includes(flag));
}

/**
 * Phase 5 row routing.
 *
 * @param {{
 *  candidateScores: Array<{
 *   score: number,
 *   hard_veto?: boolean,
 *   red_flags?: string[],
 *   candidate?: any
 *  }>,
 *  context?: {
 *   identifiers?: { siret?: string, siren?: string },
 *   verification_flags?: {
 *    cross_contamination_detected?: boolean,
 *    invalid_field_count?: number,
 *    empty_query_guard?: boolean
 *   },
 *   parseStatus?: string
 *  },
 *  thresholds?: Partial<{
 *   autoAcceptScore: number,
 *   autoAcceptMargin: number,
 *   ambiguousScore: number,
 *   ambiguousMargin: number,
 *   reviewMinScore: number
 *  }>
 * }} params
 */
export function gateIdentityDecision(params) {
    const scores = Array.isArray(params?.candidateScores)
        ? [...params.candidateScores].sort((a, b) => (b?.score || 0) - (a?.score || 0))
        : [];

    const context = params?.context || {};
    const verificationFlags = context?.verification_flags || {};
    const parseStatus = String(context?.parseStatus || '').toLowerCase();

    const thresholds = {
        autoAcceptScore: 0.88,
        autoAcceptMargin: 0.08,
        ambiguousScore: 0.72,
        ambiguousMargin: 0.08,
        reviewMinScore: 0.55,
        ...(params?.thresholds || {})
    };

    const [top, second] = scores;
    const topScore = Number(top?.score || 0);
    const top2Score = Number(second?.score || 0);
    const margin = Number((topScore - top2Score).toFixed(4));
    const topCandidate = top?.candidate || {};

    const rowSiret = cleanDigits(context?.identifiers?.siret, 14);
    const rowSiren = cleanDigits(context?.identifiers?.siren, 9);
    const topSiret = cleanDigits(topCandidate?.siret, 14);

    const crossContaminationDetected = verificationFlags.cross_contamination_detected === true;
    const emptyQueryGuard = verificationFlags.empty_query_guard === true || parseStatus === 'empty';

    const base = {
        recommended_siret: topCandidate?.siret || null,
        recommended_siren: topCandidate?.siren || null,
        topScore,
        top2Score,
        margin,
        candidateCount: scores.length,
        candidates_topk: scores.slice(0, 5).map(toCompactCandidate),
        requires_eod_disambiguation: false,
        phase5_version: 'v1.1.0'
    };

    if (crossContaminationDetected) {
        return createRowDecision({
            ...base,
            decision: 'DEAD_LETTER',
            legacyDecision: mapLegacyDecision('DEAD_LETTER'),
            reason: 'Cross-row contamination detected during verification',
            reason_codes: ['LLM_CROSS_CONTAMINATION'],
            lock_strength: null
        });
    }

    if (emptyQueryGuard) {
        return createRowDecision({
            ...base,
            decision: 'DEAD_LETTER',
            legacyDecision: mapLegacyDecision('DEAD_LETTER'),
            reason: 'No usable signals for deterministic resolution',
            reason_codes: ['NO_USABLE_SIGNALS'],
            lock_strength: null
        });
    }

    if (!scores.length) {
        return createRowDecision({
            ...base,
            decision: 'NO_MATCH',
            legacyDecision: mapLegacyDecision('NO_MATCH'),
            reason: 'INSEE returned zero candidates',
            reason_codes: ['INSEE_ZERO_CANDIDATES'],
            lock_strength: null
        });
    }

    if (scores.every((item) => item?.hard_veto === true)) {
        return createRowDecision({
            ...base,
            decision: 'NO_MATCH',
            legacyDecision: mapLegacyDecision('NO_MATCH'),
            reason: 'All candidates contradicted hard constraints',
            reason_codes: ['ALL_CANDIDATES_CONTRADICTED'],
            lock_strength: null
        });
    }

    if (rowSiret && topSiret && rowSiret === topSiret && top?.hard_veto !== true) {
        return createRowDecision({
            ...base,
            decision: 'AUTO_RESOLVED',
            legacyDecision: mapLegacyDecision('AUTO_RESOLVED'),
            reason: 'Exact SIRET fast-path match',
            reason_codes: ['EXACT_SIRET'],
            lock_strength: 'hard'
        });
    }

    if (
        topScore >= thresholds.autoAcceptScore
        && margin >= thresholds.autoAcceptMargin
        && !hasSevereContradictions(top)
    ) {
        return createRowDecision({
            ...base,
            decision: 'AUTO_RESOLVED',
            legacyDecision: mapLegacyDecision('AUTO_RESOLVED'),
            reason: 'High confidence with clear top-2 margin',
            reason_codes: ['HIGH_SCORE_HIGH_MARGIN'],
            lock_strength: rowSiren ? 'hard' : 'soft'
        });
    }

    if (topScore >= thresholds.ambiguousScore && margin < thresholds.ambiguousMargin) {
        return createRowDecision({
            ...base,
            decision: 'AMBIGUOUS_EOD',
            legacyDecision: mapLegacyDecision('AMBIGUOUS_EOD'),
            reason: 'Top candidates too close, defer to EOD disambiguation',
            reason_codes: ['TOP2_TOO_CLOSE'],
            requires_eod_disambiguation: true,
            lock_strength: null
        });
    }

    if (topScore >= thresholds.reviewMinScore) {
        return createRowDecision({
            ...base,
            decision: 'REVIEW_QUEUE',
            legacyDecision: mapLegacyDecision('REVIEW_QUEUE'),
            reason: 'Medium-confidence candidate requires manual review',
            reason_codes: ['MEDIUM_CONFIDENCE'],
            lock_strength: null
        });
    }

    return createRowDecision({
        ...base,
        decision: 'NO_MATCH',
        legacyDecision: mapLegacyDecision('NO_MATCH'),
        reason: 'Best candidate score below minimum threshold',
        reason_codes: ['LOW_SCORE'],
        lock_strength: null
    });
}
