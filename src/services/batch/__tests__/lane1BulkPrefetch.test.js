import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefetchLane1IdentifierBatches } from '../lane1BulkPrefetch.js';
import {
    clearEnrichmentCaches,
    getLane1SirenCandidates,
    getLane1SiretEntity
} from '../../memory/enrichmentCaches.js';

function okJson(data) {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => data
    };
}

describe('lane1 bulk prefetch', () => {
    beforeEach(() => {
        clearEnrichmentCaches();
    });

    it('hydrates date-aware SIRET/SIREN caches from bulk OR requests', async () => {
        const fetchImpl = vi.fn(async (url) => {
            const decoded = decodeURIComponent(String(url));
            if (decoded.includes('q=siret:(')) {
                return okJson({
                    etablissements: [
                        {
                            siret: '11111111111111',
                            siren: '111111111',
                            etablissementSiege: true
                        }
                    ]
                });
            }
            if (decoded.includes('q=siren:(')) {
                return okJson({
                    etablissements: [
                        {
                            siret: '22222222200019',
                            siren: '222222222',
                            etablissementSiege: true
                        },
                        {
                            siret: '22222222200027',
                            siren: '222222222',
                            etablissementSiege: false
                        }
                    ]
                });
            }
            return {
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: async () => ({})
            };
        });

        const stats = await prefetchLane1IdentifierBatches({
            rows: [
                {
                    _row_id: 'r1',
                    Original_SIRET: '11111111111111',
                    Transaction_Date: '2024-03-12'
                },
                {
                    _row_id: 'r2',
                    Original_SIREN: '222222222',
                    Transaction_Date: '2024-03-12'
                }
            ],
            apiKeys: ['key-1'],
            champs: ['siret', 'siren', 'denominationUniteLegale'],
            batchSize: 10,
            fetchImpl
        });

        expect(stats.totalRequests).toBe(2);
        expect(stats.prefetchedSirets).toBe(1);
        expect(stats.prefetchedSirens).toBe(1);
        expect(stats.errors).toHaveLength(0);

        const siretEntity = getLane1SiretEntity({
            siret: '11111111111111',
            date: '2024-03-12'
        });
        expect(siretEntity?.siren).toBe('111111111');

        const sirenCandidates = getLane1SirenCandidates({
            siren: '222222222',
            date: '2024-03-12'
        });
        expect(sirenCandidates).toHaveLength(2);
    });
});
