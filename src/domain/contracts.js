/**
 * @typedef {{
 *  row_analysis: {
 *    identity_signals: {
 *      possible_siret: string|null,
 *      possible_siren: string|null,
 *      possible_vat_fr: string|null,
 *      legal_name_candidates: string[],
 *      trade_name_candidates: string[],
 *      postal_code: string|null,
 *      city: string|null,
 *      transaction_date?: string|null,
 *      address_tokens: string[],
 *      legal_form_hint: string|null,
 *      activity_hint: string|null
 *    },
 *    noise_tokens: string[],
 *    missing_critical_signals: string[],
 *    ambiguity_flags: string[]
 *  },
 *  query_plan: Array<{
 *    priority: number,
 *    endpoint: 'direct_siret'|'direct_siren'|'search_siret'|'search_siren',
 *    lookupValue?: string|null,
 *    q: string|null,
 *    params: { nombre: number|null, tri: string|null, date?: string|null, champs: string[], curseur?: string|null },
 *    why: string
 *  }>,
 *  confidence: {
 *    identity_extract_confidence: number,
 *    match_readiness_confidence: number
 *  },
 *  next_action: 'DIRECT_LOOKUP'|'SEARCH'|'NEEDS_MORE_DATA'|'MANUAL_REVIEW',
 *  metadata?: {
 *    source?: 'deterministic'|'gemini',
 *    promptVersion?: string,
 *    model?: string|null
 *  }
 * }} IdentityHypothesis
 */

/**
 * @typedef {{
 *  candidate_id: string,
 *  score: number,
 *  decision: 'BEST'|'PLAUSIBLE'|'REJECT',
 *  evidence: string[],
 *  conflicts: string[],
 *  candidate: any
 * }} CandidateScore
 */

/**
 * @typedef {{
 *  decision: 'AUTO_RESOLVED'|'AMBIGUOUS_EOD'|'REVIEW_QUEUE'|'NO_MATCH'|'DEAD_LETTER',
 *  legacyDecision: 'AUTO_ACCEPT'|'REVIEW_REQUIRED'|'NO_MATCH',
 *  recommended_siret: string|null,
 *  recommended_siren: string|null,
 *  reason: string,
 *  reason_codes: string[],
 *  topScore: number,
 *  top2Score: number,
 *  margin: number,
 *  lock_strength: 'hard'|'soft'|null,
 *  candidateCount: number
 * }} RowDecision
 */

/**
 * @param {Partial<RowDecision>} [patch]
 * @returns {RowDecision}
 */
export function createRowDecision(patch = {}) {
    return {
        decision: patch.decision || 'NO_MATCH',
        legacyDecision: patch.legacyDecision || 'NO_MATCH',
        recommended_siret: patch.recommended_siret || null,
        recommended_siren: patch.recommended_siren || null,
        reason: patch.reason || 'No reliable candidate',
        reason_codes: Array.isArray(patch.reason_codes) ? patch.reason_codes : [],
        topScore: typeof patch.topScore === 'number' ? patch.topScore : 0,
        top2Score: typeof patch.top2Score === 'number' ? patch.top2Score : 0,
        margin: typeof patch.margin === 'number' ? patch.margin : 0,
        lock_strength: patch.lock_strength || null,
        candidateCount: typeof patch.candidateCount === 'number' ? patch.candidateCount : 0,
        ...patch
    };
}
