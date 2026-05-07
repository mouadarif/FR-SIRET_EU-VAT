import { describe, expect, it } from 'vitest';
import { gateIdentityDecision } from '../identityGatekeeper.js';

describe('identity gatekeeper', () => {
    it('auto-resolves when exact SIRET is matched', () => {
        const decision = gateIdentityDecision({
            candidateScores: [
                { score: 0.93, candidate: { siret: '12345678901234', siren: '123456789' } },
                { score: 0.6, candidate: { siret: '99999999999999', siren: '999999999' } }
            ],
            context: {
                identifiers: { siret: '12345678901234' }
            }
        });

        expect(decision.decision).toBe('AUTO_RESOLVED');
        expect(decision.legacyDecision).toBe('AUTO_ACCEPT');
        expect(decision.recommended_siret).toBe('12345678901234');
    });

    it('routes ambiguous mid-confidence matches to EOD review', () => {
        const decision = gateIdentityDecision({
            candidateScores: [
                { score: 0.8, candidate: { siret: '1', siren: '2' } },
                { score: 0.76, candidate: { siret: '3', siren: '4' } }
            ]
        });

        expect(decision.decision).toBe('AMBIGUOUS_EOD');
        expect(decision.legacyDecision).toBe('REVIEW_REQUIRED');
    });

    it('routes cross-contaminated rows to dead letter', () => {
        const decision = gateIdentityDecision({
            candidateScores: [
                { score: 0.92, candidate: { siret: '12345678901234', siren: '123456789' } }
            ],
            context: {
                verification_flags: {
                    cross_contamination_detected: true
                }
            }
        });

        expect(decision.decision).toBe('DEAD_LETTER');
        expect(decision.legacyDecision).toBe('NO_MATCH');
    });
});
