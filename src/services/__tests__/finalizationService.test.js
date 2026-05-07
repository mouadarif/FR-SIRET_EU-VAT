import { describe, expect, it } from 'vitest';
import { finalizePipelineRun } from '../finalization/finalizationService.js';

describe('phase 7 finalization service', () => {
    it('consolidates phase5 and eod decisions into one final decision per row', () => {
        const inputRows = [
            { _row_id: 'r1', Original_Name: 'Alpha', Original_CP: '75001' },
            { _row_id: 'r2', Original_Name: 'Beta', Original_CP: '69001' }
        ];

        const results = [
            {
                _row_id: 'r1',
                API_Status: 'SUCCESS',
                Resolution_Decision_Phase5: 'AUTO_RESOLVED',
                Resolution_Confidence: 0.93,
                Resolution_Score_Margin: 0.15,
                Resolved_SIRET: '11111111111111',
                Resolved_SIREN: '111111111',
                Resolution_Reason_Codes: 'HIGH_SCORE_HIGH_MARGIN'
            },
            {
                _row_id: 'r2',
                API_Status: 'AMBIGUOUS_EOD',
                Resolution_Decision_Phase5: 'AMBIGUOUS_EOD',
                Resolution_Confidence: 0.74,
                Resolution_Score_Margin: 0.03,
                Resolution_Reason_Codes: 'TOP2_TOO_CLOSE'
            }
        ];

        const ambiguityReport = [
            {
                rowId: 'r2',
                decision: 'REVIEW_REQUIRED',
                reason: 'Insufficient EOD margin after global reranking',
                topCandidates: [
                    { candidate: { siret: '22222222222222', siren: '222222222' }, score: 0.78 },
                    { candidate: { siret: '33333333333333', siren: '333333333' }, score: 0.77 }
                ]
            }
        ];

        const eodFinalized = [
            {
                rowId: 'r2',
                decision: 'AUTO_ACCEPT',
                recommendedCandidate: {
                    siret: '22222222222222',
                    siren: '222222222'
                },
                topScore: 0.81,
                margin: 0.07,
                scoreBreakdown: {
                    localMargin: 0.03,
                    eodScore: 0.81
                }
            }
        ];

        const out = finalizePipelineRun({
            runId: 'run-test-7',
            sourceFileId: 'input.csv',
            inputRows,
            results,
            ambiguityReport,
            eodFinalized,
            auditTrail: [],
            deadLetterQueue: [],
            startedAt: 1,
            endedAt: 1001
        });

        expect(out.runId).toBe('run-test-7');
        expect(out.finalDecisions).toHaveLength(2);

        const row1 = out.finalDecisions.find((item) => item.row_id === 'r1');
        const row2 = out.finalDecisions.find((item) => item.row_id === 'r2');

        expect(row1.decision_status).toBe('AUTO_RESOLVED');
        expect(row2.decision_status).toBe('EOD_RESOLVED');
        expect(row2.selected_siret).toBe('22222222222222');
        expect(row2.decision_source).toBe('PHASE6');

        expect(out.resolvedRowsExport).toHaveLength(2);
        expect(out.reviewQueueExport).toHaveLength(0);

        expect(out.persistenceSnapshot.raw_row).toHaveLength(2);
        expect(out.persistenceSnapshot.signal_envelope).toHaveLength(2);
        expect(out.persistenceSnapshot.query_attempt).toHaveLength(2);
        expect(out.persistenceSnapshot.candidate_snapshot.length).toBeGreaterThanOrEqual(2);
        expect(out.persistenceSnapshot.resolution_decision).toHaveLength(2);
        expect(out.persistenceSnapshot.resolution_link_current).toHaveLength(2);

        expect(out.pipelineMetrics.total_rows).toBe(2);
        expect(out.pipelineMetrics.eod_resolved).toBe(1);
    });
});

