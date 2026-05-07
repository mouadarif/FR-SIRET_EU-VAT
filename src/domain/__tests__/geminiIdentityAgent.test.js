import { describe, expect, it } from 'vitest';
import { runGeminiIdentityPlanning } from '../geminiIdentityAgent.js';

describe('gemini identity agent', () => {
    it('falls back to deterministic hypothesis when Gemini key is missing', async () => {
        const fallback = {
            row_analysis: {
                identity_signals: {
                    possible_siret: null,
                    possible_siren: null,
                    possible_vat_fr: null,
                    legal_name_candidates: ['ACME'],
                    trade_name_candidates: [],
                    postal_code: '75001',
                    city: 'PARIS',
                    address_tokens: [],
                    legal_form_hint: null,
                    activity_hint: null
                },
                noise_tokens: [],
                missing_critical_signals: [],
                ambiguity_flags: []
            },
            query_plan: [],
            confidence: {
                identity_extract_confidence: 0.5,
                match_readiness_confidence: 0.5
            },
            next_action: 'SEARCH'
        };

        const out = await runGeminiIdentityPlanning({
            canonical: { raw: {} },
            deterministicHypothesis: fallback
        });

        expect(out.hypothesis.row_analysis.identity_signals.legal_name_candidates[0]).toBe('ACME');
        expect(out.hypothesis.metadata.source).toBe('deterministic');
    });
});

