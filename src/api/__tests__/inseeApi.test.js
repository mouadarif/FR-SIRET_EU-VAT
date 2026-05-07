import { beforeEach, describe, expect, it, vi } from 'vitest';
import cache from '../cache.js';
import inseeApiClient from '../inseeApiClient.js';
import queryBuilder from '../queryBuilder.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function okJson(body) {
    return { ok: true, status: 200, statusText: 'OK', json: async () => body };
}

function failJson(status, statusText = '') {
    return { ok: false, status, statusText, json: async () => ({}) };
}

function makeEtablissement(overrides = {}) {
    return {
        siret: '38838007300022',
        siren: '388380073',
        etablissementSiege: true,
        periodesEtablissement: [{
            denominationUsuelleEtablissement: 'CITEO',
            etatAdministratifEtablissement: 'A',
            dateFin: null
        }],
        uniteLegale: { denominationUniteLegale: 'CITEO' },
        adresseEtablissement: {
            numeroVoieEtablissement: '50',
            typeVoieEtablissement: 'BD',
            libelleVoieEtablissement: 'HAUSSMANN',
            codePostalEtablissement: '75008',
            libelleCommuneEtablissement: 'PARIS'
        },
        ...overrides
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('InseeApiClient', () => {
    beforeEach(() => {
        global.fetch = vi.fn();
        cache.clear();
        inseeApiClient.cancelPendingRequests();
        vi.restoreAllMocks();
    });

    // ─── searchBySIRET ───────────────────────────────────────────────────

    describe('searchBySIRET', () => {
        it('returns exactly 1 result via direct /siret/{siret} lookup', async () => {
            const etab = makeEtablissement({ siret: '33358346602181', siren: '333583466' });
            global.fetch.mockResolvedValue(okJson({ etablissement: etab }));

            const out = await inseeApiClient.searchBySIRET('33358346602181');

            expect(out.success).toBe(true);
            expect(out.data.results).toHaveLength(1);
            expect(out.data.results[0].siret).toBe('33358346602181');

            const calledUrl = String(global.fetch.mock.calls[0][0]);
            expect(calledUrl).toContain('/siret/33358346602181');
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('returns 404 when SIRET is unknown', async () => {
            global.fetch.mockResolvedValue(failJson(404, 'Not Found'));

            const out = await inseeApiClient.searchBySIRET('50113800000013');

            expect(out.success).toBe(false);
            expect(out.error.userMessage).toContain('Aucune entreprise trouvée avec le SIRET');
        });

        it('maps 401 to auth error', async () => {
            global.fetch.mockResolvedValue(failJson(401, 'Unauthorized'));

            const out = await inseeApiClient.searchBySIRET('12345678901234');
            expect(out.success).toBe(false);
            expect(out.error.userMessage).toContain('Erreur d\'authentification');
        });

        it('maps 400 to syntax guidance', async () => {
            global.fetch.mockResolvedValue(failJson(400, 'Bad Request'));

            const out = await inseeApiClient.searchBySIRET('12345678901234');
            expect(out.success).toBe(false);
            expect(out.error.userMessage).toContain('syntax');
        });
    });

    // ─── searchBySIREN ───────────────────────────────────────────────────

    describe('searchBySIREN', () => {
        it('uses /siret?q=siren:… and returns all establishments sorted HQ-first', async () => {
            const hq = makeEtablissement({ siret: '38838007300022', etablissementSiege: true });
            const branch = makeEtablissement({
                siret: '38838007300154',
                etablissementSiege: false,
                adresseEtablissement: {
                    codePostalEtablissement: '69002',
                    libelleCommuneEtablissement: 'LYON'
                }
            });

            global.fetch.mockResolvedValue(okJson({
                header: { total: 2 },
                etablissements: [branch, hq]
            }));

            const out = await inseeApiClient.searchBySIREN('388380073');

            expect(out.success).toBe(true);
            expect(out.data.total_results).toBe(2);
            expect(out.data.results).toHaveLength(2);
            expect(out.data.results[0].etablissement_siege).toBe(true);

            expect(global.fetch).toHaveBeenCalledTimes(1);
            const calledUrl = String(global.fetch.mock.calls[0][0]);
            expect(calledUrl).toContain('q=siren%3A388380073');
        });

        it('falls back to unité légale when establishment search is empty', async () => {
            global.fetch
                .mockResolvedValueOnce(okJson({ header: { total: 0 }, etablissements: [] }))
                .mockResolvedValueOnce(okJson({
                    uniteLegale: {
                        siren: '123456789',
                        periodesUniteLegale: [{
                            dateFin: null,
                            denominationUniteLegale: 'ACME',
                            etatAdministratifUniteLegale: 'A'
                        }]
                    }
                }));

            const out = await inseeApiClient.searchBySIREN('123456789');

            expect(out.success).toBe(true);
            expect(out.data.results).toHaveLength(1);
            expect(out.data.results[0].nom_complet).toBe('ACME');
            expect(out.data.results[0].siret).toBeNull();
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });

        it('returns user-friendly 404 when SIREN is unknown', async () => {
            // First call: /siret?q=siren:… → empty list
            // Second call: /siren/{siren} → 404
            global.fetch
                .mockResolvedValueOnce(okJson({ header: { total: 0 }, etablissements: [] }))
                .mockResolvedValueOnce(failJson(404, 'Not Found'));

            const out = await inseeApiClient.searchBySIREN('000000000');

            expect(out.success).toBe(false);
            expect(out.error.userMessage).toContain('Aucune entreprise trouvée avec le SIREN');
        });
    });

    // ─── searchByName ────────────────────────────────────────────────────

    describe('searchByName', () => {
        it('delegates to executeTieredSearch and normalizes results', async () => {
            const etab = makeEtablissement({ siret: '12345678901234', siren: '123456789' });
            vi.spyOn(queryBuilder, 'executeTieredSearch').mockResolvedValue({
                tier: 2,
                tierName: 'NEIGHBOR',
                totalBeforeFilter: 1,
                results: [etab]
            });

            const out = await inseeApiClient.searchByName({
                nameQuery: 'CITEO',
                postalCode: '75008',
                city: 'Paris',
                filters: {},
                page: 1,
                perPage: 25
            });

            expect(out.success).toBe(true);
            expect(out.data.total_results).toBe(1);
            expect(out.data.tier).toBe(2);
            expect(out.data.results[0].nom_complet).toBe('CITEO');
        });

        it('uses the multi-criteria URL when structured filters are present', async () => {
            const buildUrl = vi.spyOn(queryBuilder, 'buildSiretMultiCriteriaUrl').mockReturnValue('https://example.test/siret?q=test');
            const executeTieredSearch = vi.spyOn(queryBuilder, 'executeTieredSearch');
            const executeRequest = vi.spyOn(inseeApiClient, '_executeRequest').mockResolvedValue({
                success: true,
                data: {
                    header: { total: 73 },
                    etablissements: [makeEtablissement()]
                },
                error: null
            });

            const out = await inseeApiClient.searchByName({
                nameQuery: 'CITEO',
                address: '50 boulevard Haussmann',
                postalCode: '75008',
                city: 'Paris',
                siret: '38838007300022',
                filters: {
                    code_naf: '38.32Z',
                    nature_juridique: '5710',
                    etat_administratif: 'A',
                    tranche_effectif_salarie: '22'
                },
                page: 2,
                perPage: 25
            });

            expect(buildUrl).toHaveBeenCalledWith({
                query: 'CITEO',
                address: '50 boulevard Haussmann',
                code_postal: '75008',
                commune: 'Paris',
                siret: '38838007300022',
                code_naf: '38.32Z',
                nature_juridique: '5710',
                etat_administratif: 'A',
                tranche_effectif_salarie: '22',
                nombre: 25,
                debut: 25
            });
            expect(executeRequest).toHaveBeenCalledWith('https://example.test/siret?q=test');
            expect(executeTieredSearch).not.toHaveBeenCalled();
            expect(out.success).toBe(true);
            expect(out.data.total_results).toBe(73);
            expect(out.data.tierName).toBe('MULTI_CRITERIA');
        });

        it('wraps back to first page when requested page exceeds results', async () => {
            const etab = makeEtablissement();
            vi.spyOn(queryBuilder, 'executeTieredSearch').mockResolvedValue({
                tier: 2,
                tierName: 'NEIGHBOR',
                totalBeforeFilter: 1,
                results: [etab]
            });

            const out = await inseeApiClient.searchByName({
                nameQuery: 'CITEO',
                filters: {},
                page: 10,
                perPage: 25
            });

            expect(out.success).toBe(true);
            expect(out.data.results).toHaveLength(1);
        });

        it('returns error when tiered search throws', async () => {
            vi.spyOn(queryBuilder, 'executeTieredSearch').mockRejectedValue(
                Object.assign(new Error('HTTP 503: Service Unavailable'), { status: 503 })
            );

            const out = await inseeApiClient.searchByName({
                nameQuery: 'CITEO',
                filters: {}
            });

            expect(out.success).toBe(false);
            expect(out.error.userMessage).toContain('Service indisponible');
        });
    });

    // ─── retry / caching behaviour ───────────────────────────────────────

    describe('retry and caching', () => {
        it('retries on 429 and succeeds on second attempt', async () => {
            const etab = makeEtablissement();
            global.fetch
                .mockResolvedValueOnce(failJson(429, 'Too Many Requests'))
                .mockResolvedValueOnce(okJson({
                    header: { total: 1 },
                    etablissements: [etab]
                }));

            const out = await inseeApiClient.searchBySIREN('388380073');

            expect(out.success).toBe(true);
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });

        it('returns cached response on second call for the same URL', async () => {
            const etab = makeEtablissement();
            global.fetch.mockResolvedValue(okJson({
                header: { total: 1 },
                etablissements: [etab]
            }));

            const out1 = await inseeApiClient.searchBySIREN('388380073');
            const out2 = await inseeApiClient.searchBySIREN('388380073');

            expect(out1.success).toBe(true);
            expect(out2.success).toBe(true);
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });
    });
});
