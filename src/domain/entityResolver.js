import cache from '../api/cache.js';
import queryBuilder from '../api/queryBuilder.js';
import requestDedup from '../api/requestDedup.js';
import requestQueue from '../api/requestQueue.js';
import { assertTriCurseurGuard, clampJsonPagination } from '../api/paginator.js';
import {
    getCachedInseeQuery,
    getLane1SirenCandidates,
    getLane1SiretEntity,
    setCachedInseeQuery
} from '../services/memory/enrichmentCaches.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.insee.fr/api-sirene/3.11';

function cleanDigits(value, size) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!size) return digits;
    return digits.length === size ? digits : '';
}

function buildSearchUrl(query, params = {}, endpoint = 'siret') {
    assertTriCurseurGuard(params);
    const { nombre, debut } = clampJsonPagination(params);
    const search = new URLSearchParams();
    if (query) search.append('q', query);
    search.append('nombre', String(nombre));

    if (params.curseur) {
        search.append('curseur', params.curseur);
    } else {
        search.append('debut', String(debut));
        if (params.tri) search.append('tri', params.tri);
    }

    const dateParam = queryBuilder.utils.normalizeDateParam(params.date);
    if (dateParam) search.append('date', dateParam);

    if (Array.isArray(params.champs) && params.champs.length > 0) {
        const champs = queryBuilder.utils.normalizeChamps(params.champs);
        if (champs.length > 0) search.append('champs', champs.join(','));
    }

    return `${BASE_URL}/${endpoint}?${search.toString()}`;
}

function appendLookupParams(url, params = {}) {
    const search = new URLSearchParams();
    const champs = queryBuilder.utils.normalizeChamps(params.champs || []);
    if (champs.length > 0) {
        search.append('champs', champs.join(','));
    }
    const dateParam = queryBuilder.utils.normalizeDateParam(params.date);
    if (dateParam) {
        search.append('date', dateParam);
    }
    if (![...search.keys()].length) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${search.toString()}`;
}

function isTransientStatus(status) {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePlanStep(step, index) {
    return {
        priority: Number.parseInt(String(step?.priority ?? index + 1), 10) || index + 1,
        endpoint: step?.endpoint || 'search_siret',
        lookupValue: step?.lookupValue || null,
        q: step?.q || null,
        params: step?.params || {},
        why: step?.why || ''
    };
}

function pickHeadquartersFirst(candidates = []) {
    return candidates.find((candidate) => candidate?.etablissementSiege) || candidates[0] || null;
}

function extractUnitesLegales(payload = {}) {
    if (Array.isArray(payload.unitesLegales)) return payload.unitesLegales;
    if (Array.isArray(payload.uniteLegales)) return payload.uniteLegales;
    if (payload.uniteLegale) return [payload.uniteLegale];
    return [];
}

/**
 * Dedicated entity resolution layer for INSEE.
 */
export class EntityResolver {
    /**
     * @param {{
     *  apiKey: string,
     *  champs?: string[],
     *  aiRecoveryFn?: ((name: string, postalCode?: string) => Promise<string[]>) | null,
     *  fetchImpl?: typeof fetch,
     *  maxRetries?: number,
     *  queryDate?: string | null
     * }} options
     */
    constructor(options) {
        this.apiKey = options?.apiKey || '';
        this.champs = options?.champs || [];
        this.aiRecoveryFn = options?.aiRecoveryFn || null;
        this.fetchImpl = options?.fetchImpl || fetch;
        this.maxRetries = options?.maxRetries ?? 3;
        this.queryDate = queryBuilder.utils.normalizeDateParam(options?.queryDate);
    }

    _headers() {
        return {
            Accept: 'application/json',
            'X-INSEE-Api-Key-Integration': this.apiKey
        };
    }

    async _requestJson(url, policy = 'search') {
        const headers = this._headers();
        const cacheKey = `${policy}:${url}`;
        const queryCached = getCachedInseeQuery(cacheKey);
        if (queryCached) return { ok: true, status: 200, data: queryCached, fromCache: true };
        const cached = cache.getWithPolicy(cacheKey, policy);
        if (cached) return { ok: true, status: 200, data: cached, fromCache: true };

        const dedupKey = requestDedup.buildKey(url, headers);
        return requestDedup.run(dedupKey, async () => {
            let lastError = null;
            for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
                try {
                    const response = await requestQueue.add(async () => this.fetchImpl(url, { headers }));
                    if (response.status === 404) {
                        return { ok: false, status: 404, data: null };
                    }

                    if (!response.ok) {
                        const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
                        err.status = response.status;
                        throw err;
                    }

                    const data = await response.json();
                    cache.setWithPolicy(cacheKey, data, policy);
                    setCachedInseeQuery(cacheKey, data);
                    return { ok: true, status: response.status, data };
                } catch (error) {
                    lastError = error;
                    const status = error?.status || 0;
                    if (!isTransientStatus(status) || attempt === this.maxRetries - 1) {
                        break;
                    }
                    await wait(250 * (2 ** attempt));
                }
            }

            return {
                ok: false,
                status: lastError?.status || 0,
                error: lastError
            };
        });
    }

    /**
     * @param {string} siret
     */
    async resolveBySiret(siret) {
        const cleaned = cleanDigits(siret, 14);
        if (!cleaned) {
            return this._notFound('siret', 'Invalid SIRET format');
        }

        const lane1Cached = getLane1SiretEntity({
            siret: cleaned,
            date: this.queryDate || ''
        });
        if (lane1Cached) {
            return this._resolved({
                entity: lane1Cached,
                candidates: [lane1Cached],
                tierUsed: 'siret_bulk_cache',
                candidateCount: 1,
                queryUsed: `lane1_cache:siret:${cleaned}`,
                warnings: []
            });
        }

        const lookupUrl = appendLookupParams(queryBuilder.buildSiretLookupUrl(cleaned), {
            champs: this.champs,
            date: this.queryDate
        });
        const response = await this._requestJson(lookupUrl, 'lookup');
        if (!response.ok || !response.data?.etablissement) {
            return this._notFound('siret', `No entity found for SIRET ${cleaned}`);
        }

        return this._resolved({
            entity: response.data.etablissement,
            candidates: [response.data.etablissement],
            tierUsed: 'siret_exact',
            candidateCount: 1,
            queryUsed: lookupUrl,
            warnings: []
        });
    }

    /**
     * @param {string} siren
     */
    async resolveBySiren(siren) {
        const cleaned = cleanDigits(siren, 9);
        if (!cleaned) {
            return this._notFound('siren', 'Invalid SIREN format');
        }

        const lane1Cached = getLane1SirenCandidates({
            siren: cleaned,
            date: this.queryDate || ''
        });
        if (Array.isArray(lane1Cached) && lane1Cached.length > 0) {
            const selected = pickHeadquartersFirst(lane1Cached);
            return this._resolved({
                entity: selected,
                candidates: lane1Cached,
                tierUsed: 'siren_bulk_cache',
                candidateCount: lane1Cached.length,
                queryUsed: `lane1_cache:siren:${cleaned}`,
                warnings: lane1Cached.length > 1 ? ['Multiple establishments for SIREN'] : []
            });
        }

        const directSearchUrl = buildSearchUrl(`siren:${cleaned}`, {
            nombre: 20,
            champs: this.champs,
            date: this.queryDate
        }, 'siret');
        const directSearchResponse = await this._requestJson(directSearchUrl, 'search');
        const directCandidates = directSearchResponse.data?.etablissements || [];
        const directSelected = pickHeadquartersFirst(directCandidates);
        if (directSelected) {
            return this._resolved({
                entity: directSelected,
                candidates: directCandidates,
                tierUsed: 'siren_direct_search',
                candidateCount: directCandidates.length || 1,
                queryUsed: directSearchUrl,
                warnings: directCandidates.length > 1 ? ['Multiple establishments for SIREN'] : []
            });
        }

        const lookupUrl = appendLookupParams(queryBuilder.buildSirenLookupUrl(cleaned), {
            champs: this.champs,
            date: this.queryDate
        });
        const response = await this._requestJson(lookupUrl, 'lookup');
        if (response.ok && response.data?.uniteLegale) {
            const unitName = response.data.uniteLegale?.periodesUniteLegale?.[0]?.denominationUniteLegale
                || response.data.uniteLegale?.denominationUniteLegale
                || '';

            const searchQuery = unitName
                ? queryBuilder.utils.buildNameSearchQuery(unitName)
                : `siren:${cleaned}`;

            const searchUrl = buildSearchUrl(searchQuery, {
                nombre: 20,
                champs: this.champs,
                date: this.queryDate
            }, 'siret');
            const searchResponse = await this._requestJson(searchUrl, 'search');
            const candidates = searchResponse.data?.etablissements || [];
            const selected = candidates.find((candidate) => candidate.etablissementSiege) || candidates[0];

            if (selected) {
                return this._resolved({
                    entity: selected,
                    candidates: candidates.length > 0 ? candidates : [selected],
                    tierUsed: 'siren_lookup',
                    candidateCount: candidates.length || 1,
                    queryUsed: searchUrl,
                    warnings: candidates.length > 1 ? ['Multiple establishments for SIREN'] : []
                });
            }
        }

        return this._notFound('siren', `No entity found for SIREN ${cleaned}`);
    }

    /**
     * @param {{name: string, city?: string, postalCode?: string, codeNaf?: string}} params
     */
    async resolveByNameTiered(params) {
        const name = String(params?.name || '').trim();
        if (!name) return this._notFound('tiered', 'Missing company name');

        const fetchFn = async (url) => {
            const response = await this._requestJson(url, 'search');
            return response.ok ? response.data : { etablissements: [] };
        };

        const result = await queryBuilder.executeTieredSearch({
            query: name,
            code_postal: params?.postalCode || '',
            commune: params?.city || '',
            code_naf: params?.codeNaf || '',
            date: this.queryDate,
            champs: this.champs,
            fetchFn,
            aiVariationsFn: this.aiRecoveryFn || null
        });

        const candidates = result?.results || [];
        const entity = candidates[0];
        if (!entity) {
            return this._notFound('tiered', 'No candidate found in tiered search');
        }

        return this._resolved({
            entity,
            candidates,
            tierUsed: `tier${result.tier}_${String(result.tierName || '').toLowerCase()}`,
            candidateCount: candidates.length,
            queryUsed: result.url || '',
            warnings: candidates.length > 1 ? ['Ambiguous tiered match'] : []
        });
    }

    /**
     * Optional explicit AI recovery stage.
     * @param {{name: string, postalCode?: string, codeNaf?: string}} params
     */
    async resolveWithAIRecovery(params) {
        if (!this.aiRecoveryFn) {
            return this._notFound('ai_recovery', 'AI recovery disabled');
        }

        const variations = await this.aiRecoveryFn(params.name, params.postalCode);
        if (!variations || variations.length === 0) {
            return this._notFound('ai_recovery', 'AI recovery returned no variations');
        }

        const url = queryBuilder.buildTier4DetectiveUrl({
            variations,
            code_postal: params.postalCode || '',
            code_naf: params.codeNaf || '',
            date: this.queryDate,
            champs: this.champs
        });

        const response = await this._requestJson(url, 'search');
        const candidates = response.data?.etablissements || [];
        const entity = candidates.find((candidate) => candidate.etablissementSiege) || candidates[0];
        if (!entity) {
            return this._notFound('ai_recovery', 'AI recovery found no entity');
        }

        return this._resolved({
            entity,
            candidates,
            tierUsed: 'tier4_ai_recovery',
            candidateCount: candidates.length,
            queryUsed: url,
            warnings: candidates.length > 1 ? ['Ambiguous AI recovery'] : []
        });
    }

    /**
     * Execute explicit query-plan hypotheses before fallback auto-resolution.
     * @param {{
     *  queryPlan?: Array<{
     *    priority?: number,
     *    endpoint?: 'direct_siret'|'direct_siren'|'search_siret'|'search_siren',
     *    lookupValue?: string|null,
     *    q?: string|null,
     *    params?: { nombre?: number, debut?: number, tri?: string|null, curseur?: string|null, champs?: string[] }
     *  }>,
     *  fallbackIdentifiers?: { siret?: string, siren?: string, name?: string, city?: string, postalCode?: string, codeNaf?: string },
     *  transactionDate?: string | null
     * }} options
     */
    async resolveFromQueryPlan(options = {}) {
        const overrideDate = queryBuilder.utils.normalizeDateParam(options.transactionDate);
        if (overrideDate) this.queryDate = overrideDate;

        const plan = (options.queryPlan || [])
            .map((step, index) => normalizePlanStep(step, index))
            .sort((a, b) => a.priority - b.priority);

        for (const step of plan) {
            if (step.endpoint === 'direct_siret' && step.lookupValue) {
                const bySiret = await this.resolveBySiret(step.lookupValue);
                if (bySiret.status === 'resolved') return bySiret;
                continue;
            }

            if (step.endpoint === 'direct_siren' && step.lookupValue) {
                const bySiren = await this.resolveBySiren(step.lookupValue);
                if (bySiren.status === 'resolved') return bySiren;
                continue;
            }

            if ((step.endpoint === 'search_siret' || step.endpoint === 'search_siren') && step.q) {
                const byQuery = await this._resolveBySearchPlanStep(step);
                if (byQuery.status === 'resolved') return byQuery;
            }
        }

        if (options.fallbackIdentifiers) {
            return this.resolveAuto(options.fallbackIdentifiers);
        }

        return this._notFound('query_plan', 'No query-plan strategy succeeded');
    }

    async _resolveBySearchPlanStep(step) {
        const params = {
            ...step.params,
            champs: Array.isArray(step.params?.champs) && step.params.champs.length > 0
                ? step.params.champs
                : this.champs,
            date: step.params?.date || this.queryDate
        };

        if (step.endpoint === 'search_siret') {
            const url = buildSearchUrl(step.q, params, 'siret');
            const response = await this._requestJson(url, 'search');
            const candidates = response.data?.etablissements || [];
            const entity = pickHeadquartersFirst(candidates);
            if (!entity) {
                return this._notFound('query_plan_search_siret', 'No candidates found from search_siret');
            }
            return this._resolved({
                entity,
                candidates,
                tierUsed: 'query_plan_search_siret',
                candidateCount: candidates.length,
                queryUsed: url,
                warnings: candidates.length > 1 ? ['Multiple candidates from query-plan siret search'] : []
            });
        }

        if (step.endpoint === 'search_siren') {
            const unitUrl = buildSearchUrl(step.q, params, 'siren');
            const unitResponse = await this._requestJson(unitUrl, 'search');
            const units = extractUnitesLegales(unitResponse.data);
            const firstUnit = units[0];
            if (!firstUnit?.siren) {
                return this._notFound('query_plan_search_siren', 'No legal-unit candidates found from search_siren');
            }

            const etabUrl = buildSearchUrl(`siren:${firstUnit.siren}`, {
                nombre: 20,
                champs: this.champs,
                date: this.queryDate
            }, 'siret');
            const etabResponse = await this._requestJson(etabUrl, 'search');
            const candidates = etabResponse.data?.etablissements || [];
            const entity = pickHeadquartersFirst(candidates);
            if (!entity) {
                return this._notFound('query_plan_search_siren', `No establishments found for SIREN ${firstUnit.siren}`);
            }

            return this._resolved({
                entity,
                candidates,
                tierUsed: 'query_plan_search_siren',
                candidateCount: candidates.length,
                queryUsed: `${unitUrl} -> ${etabUrl}`,
                warnings: candidates.length > 1 ? ['Multiple establishments from query-plan siren search'] : []
            });
        }

        return this._notFound('query_plan', 'Unsupported query-plan endpoint');
    }

    /**
     * @param {{siret?: string, siren?: string, name?: string, city?: string, postalCode?: string, department?: string, codeNaf?: string}} identifiers
     */
    async resolveAuto(identifiers) {
        if (identifiers?.siret) {
            const bySiret = await this.resolveBySiret(identifiers.siret);
            if (bySiret.status === 'resolved') return bySiret;
        }

        if (identifiers?.siren) {
            const bySiren = await this.resolveBySiren(identifiers.siren);
            if (bySiren.status === 'resolved') return bySiren;
        }

        if (identifiers?.namesToTry && identifiers.namesToTry.length > 0) {
            for (const nameToTry of identifiers.namesToTry) {
                if (!nameToTry) continue;
                const byName = await this.resolveByNameTiered({
                    name: nameToTry,
                    city: identifiers.city,
                    postalCode: identifiers.postalCode,
                    codeNaf: identifiers.codeNaf
                });
                if (byName.status === 'resolved') {
                    // Update the metadata to indicate which name succeeded
                    byName.metadata = byName.metadata || {};
                    byName.metadata.nameSucceeded = nameToTry;
                    return byName;
                }
            }
        } else if (identifiers?.name) {
            const byName = await this.resolveByNameTiered({
                name: identifiers.name,
                city: identifiers.city,
                postalCode: identifiers.postalCode,
                codeNaf: identifiers.codeNaf
            });
            if (byName.status === 'resolved') {
                byName.metadata = byName.metadata || {};
                byName.metadata.nameSucceeded = identifiers.name;
                return byName;
            }
        }

        if (this.aiRecoveryFn && identifiers?.name) {
            const byAi = await this.resolveWithAIRecovery({
                name: identifiers.name,
                postalCode: identifiers.postalCode,
                codeNaf: identifiers.codeNaf
            });
            if (byAi.status === 'resolved') return byAi;
            return byAi;
        }

        return this._notFound('resolver', 'No resolution strategy succeeded');
    }

    _resolved(metadata) {
        return {
            status: 'resolved',
            entity: metadata.entity,
            candidates: metadata.candidates || (metadata.entity ? [metadata.entity] : []),
            metadata: {
                tierUsed: metadata.tierUsed,
                candidateCount: metadata.candidateCount || 1,
                queryUsed: metadata.queryUsed || '',
                warnings: metadata.warnings || []
            }
        };
    }

    _notFound(tierUsed, warning) {
        return {
            status: 'not_found',
            entity: null,
            candidates: [],
            metadata: {
                tierUsed,
                candidateCount: 0,
                queryUsed: '',
                warnings: warning ? [warning] : []
            }
        };
    }
}
