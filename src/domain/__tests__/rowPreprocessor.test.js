import { describe, expect, it } from 'vitest';
import { buildDeterministicIdentityHypothesis } from '../rowPreprocessor.js';

describe('row preprocessor', () => {
    it('extracts identifiers and generates direct lookup hypotheses', () => {
        const hypothesis = buildDeterministicIdentityHypothesis({
            raw: {
                Original_Name: 'ACME SAS',
                Original_SIRET: '12345678901234',
                Original_CP: '75001'
            },
            identifiers: {
                siret: '12345678901234',
                siren: '123456789',
                name: 'ACME SAS',
                city: 'PARIS',
                postalCode: '75001'
            },
            audit: {
                rawName: 'ACME SAS',
                rawCity: 'PARIS',
                rawPostalCode: '75001'
            }
        });

        expect(hypothesis.row_analysis.identity_signals.possible_siret).toBe('12345678901234');
        expect(hypothesis.query_plan[0].endpoint).toBe('direct_siret');
        expect(hypothesis.next_action).toBe('DIRECT_LOOKUP');
    });
});

