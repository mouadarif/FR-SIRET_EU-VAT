import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPipelineForRow } from '../pipelineOrchestrator.js';
import { EntityResolver } from '../../../domain/entityResolver.js';

vi.mock('../../../domain/entityResolver.js', () => ({
    EntityResolver: vi.fn()
}));

vi.mock('../../../domain/kpiEngine.js', () => ({
    runKpiEngine: vi.fn(async () => ({
        values: { KPI_SIRET: '12345678901234', KPI_ESTABLISHMENT_COUNT: 7 },
        perKpiMeta: { kpi_siret: { status: 'ok' } }
    }))
}));

vi.mock('../../quality/resolutionScoring.js', () => ({
    scoreResolutionConfidence: vi.fn(() => ({ score: 0.88, needsReview: false, reasons: [] }))
}));

describe('pipeline orchestrator output', () => {
    const resolveFromQueryPlan = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        EntityResolver.mockImplementation(function EntityResolverMock() {
            return {
                resolveFromQueryPlan
            };
        });
    });

    it('produces enriched row with original + resolved + KPI + metadata fields', async () => {
        resolveFromQueryPlan.mockResolvedValue({
            status: 'resolved',
            entity: {
                siret: '12345678901234',
                siren: '123456789',
                etablissementSiege: true,
                uniteLegale: { denominationUniteLegale: 'ACME' },
                periodesEtablissement: [{
                    denominationUsuelleEtablissement: 'ACME',
                    etatAdministratifEtablissement: 'A'
                }],
                adresseEtablissement: {
                    codePostalEtablissement: '75001',
                    libelleCommuneEtablissement: 'PARIS'
                }
            },
            metadata: {
                tierUsed: 'tier2_neighbor',
                candidateCount: 1,
                queryUsed: '/siret?q=acme',
                warnings: []
            },
            candidates: [{
                siret: '12345678901234',
                siren: '123456789',
                etablissementSiege: true,
                uniteLegale: { denominationUniteLegale: 'ACME' },
                periodesEtablissement: [{
                    denominationUsuelleEtablissement: 'ACME',
                    etatAdministratifEtablissement: 'A'
                }],
                adresseEtablissement: {
                    codePostalEtablissement: '75001',
                    libelleCommuneEtablissement: 'PARIS'
                }
            }]
        });

        const out = await runPipelineForRow({
            row: {
                Original_Name: 'ACME',
                Enriched_Name: 'ACME',
                Original_CP: '75001',
                Original_SIRET: '12345678901234'
            },
            apiKey: 'test-key',
            serviceInfo: { serviceState: 'UP', version: '3.11', freshnessDate: '2026-02-20' }
        });

        expect(out.status).toBe('resolved');
        const row = out.outputRows[0];
        expect(row.Original_Name).toBe('ACME');
        expect(row.Resolved_SIRET).toBe('12345678901234');
        expect(row.Resolved_SIREN).toBe('123456789');
        expect(row.KPI_SIRET).toBe('12345678901234');
        expect(row.Resolution_Tier).toBe('tier2_neighbor');
        expect(row.Resolution_Confidence).toBe(0.88);
        expect(row.Service_Version).toBe('3.11');
    });
});
