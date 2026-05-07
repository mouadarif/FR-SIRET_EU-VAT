import { describe, expect, it } from 'vitest';
import { runPhase8ReviewAndLearning } from '../review/phase8Service.js';

describe('phase 8 review and learning', () => {
    it('builds review queue, applies labels, and emits learning artifacts', () => {
        const finalDecisions = [
            {
                row_id: 'r1',
                decision_status: 'REVIEW_REQUIRED',
                decision_source: 'PHASE5',
                final_confidence: 0.73,
                score_margin_top1_top2: 0.03,
                top_candidates: [
                    { siret: '11111111111111', siren: '111111111', score: 0.73 },
                    { siret: '22222222222222', siren: '222222222', score: 0.71 }
                ]
            },
            {
                row_id: 'r2',
                decision_status: 'AUTO_RESOLVED',
                decision_source: 'PHASE5',
                final_confidence: 0.92,
                score_margin_top1_top2: 0.16,
                top_candidates: []
            }
        ];

        const results = [
            {
                _row_id: 'r1',
                Original_Name: 'Ste Dupnoto',
                Enriched_Name: 'DUPONTO',
                Original_City: 'Paris',
                Original_CP: '75001',
                Resolution_Reason_Codes: 'TOP2_TOO_CLOSE|MEDIUM_CONFIDENCE',
                LLM_Contamination_Flags: ''
            },
            {
                _row_id: 'r2',
                Original_Name: 'Acme',
                Enriched_Name: 'ACME',
                Original_City: 'Lyon',
                Original_CP: '69001'
            }
        ];

        const ambiguityReport = [
            {
                rowId: 'r1',
                reason: 'Insufficient EOD margin after global reranking',
                topCandidates: [
                    { candidate: { siret: '11111111111111', siren: '111111111' }, score: 0.73 },
                    { candidate: { siret: '22222222222222', siren: '222222222' }, score: 0.71 }
                ]
            }
        ];

        const reviewLabels = [
            {
                row_id: 'r1',
                reviewer_id: 'qa-user',
                action_type: 'SELECT_CANDIDATE',
                selected_siret: '22222222222222',
                selected_siren: '222222222',
                reason_code: 'HUMAN_TIE_BREAK'
            },
            {
                row_id: 'r1',
                reviewer_id: 'qa-user',
                action_type: 'CORRECT_SIGNALS',
                corrected_signals_json: {
                    company_name_raw: 'STE DUPNOTO',
                    company_name_core: 'DUPONTO'
                },
                reason_code: 'NAME_OCR_FIX'
            }
        ];

        const out = runPhase8ReviewAndLearning({
            runId: 'run-test-8',
            finalDecisions,
            results,
            ambiguityReport,
            reviewLabels
        });

        expect(out.reviewCases).toHaveLength(1);
        expect(out.reviewCases[0].row_id).toBe('r1');
        expect(out.reviewCases[0].top_candidates.length).toBeGreaterThan(0);

        expect(out.appliedLabels).toHaveLength(2);
        const decisionAfter = out.finalDecisionsAfterReview.find((item) => item.row_id === 'r1');
        expect(decisionAfter.decision_source).toBe('HUMAN_REVIEW');
        expect(decisionAfter.decision_status).toBe('REVIEW_REQUIRED');
        expect(decisionAfter.decision_reason_code).toBe('NAME_OCR_FIX');

        expect(out.learningArtifacts.run_id).toBe('run-test-8');
        expect(out.learningArtifacts.alias_proposals.length).toBeGreaterThan(0);
        expect(out.learningArtifacts.prompt_failure_patterns.length).toBeGreaterThan(0);
    });
});
