import cache from '../../api/cache.js';
import queryBuilder from '../../api/queryBuilder.js';
import requestDedup from '../../api/requestDedup.js';
import requestQueue from '../../api/requestQueue.js';
import {
    getCachedInseeQuery,
    setCachedInseeQuery,
    setLane1SirenCandidates,
    setLane1SiretEntity
} from '../memory/enrichmentCaches.js';
import { normalizeInputRow } from './pipelineOrchestrator.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.insee.fr/api-sirene/3.11';
const DEFAULT_BATCH_SIZE = 25;

function cleanDigits(value, size) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === size ? digits : '';
}

function chunk(values = [], chunkSize = DEFAULT_BATCH_SIZE) {
    const size = Math.max(1, Number.parseInt(String(chunkSize), 10) || DEFAULT_BATCH_SIZE);
    const out = [];
    for (let index = 0; index < values.length; index += size) {
        out.push(values.slice(index, index + size));
    }
    return out;
}

function buildBulkUrl({ kind, ids, champs = [], date = '' }) {
    const field = kind === 'siren' ? 'siren' : 'siret';
    const query = `${field}:(${ids.join(' OR ')})`;
    const params = new URLSearchParams();
    params.append('q', query);
    params.append('nombre', '1000');
    params.append('debut', '0');

    const normalizedDate = queryBuilder.utils.normalizeDateParam(date);
    if (normalizedDate) {
        params.append('date', normalizedDate);
    }

    const normalizedChamps = queryBuilder.utils.normalizeChamps(champs || []);
    if (normalizedChamps.length > 0) {
        params.append('champs', normalizedChamps.join(','));
    }

    return `${BASE_URL}/siret?${params.toString()}`;
}

async function fetchBatchSearch({ url, apiKey, fetchImpl = fetch }) {
    const headers = {
        Accept: 'application/json',
        'X-INSEE-Api-Key-Integration': apiKey
    };
    const cacheKey = `search:${url}`;
    const queryCached = getCachedInseeQuery(cacheKey);
    if (queryCached) return queryCached;
    const localCached = cache.getWithPolicy(cacheKey, 'search');
    if (localCached) return localCached;

    const dedupKey = requestDedup.buildKey(url, headers);
    return requestDedup.run(dedupKey, async () => {
        const response = await requestQueue.add(async () => fetchImpl(url, { headers }));
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            error.status = response.status;
            throw error;
        }
        const json = await response.json();
        cache.setWithPolicy(cacheKey, json, 'search');
        setCachedInseeQuery(cacheKey, json);
        return json;
    });
}

function seedLane1Caches(etablissements = [], date = '') {
    const normalizedDate = queryBuilder.utils.normalizeDateParam(date);
    for (const etablissement of etablissements) {
        const siret = cleanDigits(etablissement?.siret, 14);
        const siren = cleanDigits(etablissement?.siren, 9);
        if (siret) {
            setLane1SiretEntity({ siret, date: normalizedDate, entity: etablissement });
        }
        if (siren) {
            setLane1SirenCandidates({
                siren,
                date: normalizedDate,
                candidates: [etablissement]
            });
        }
    }
}

function collectDateBuckets(rows = []) {
    const buckets = new Map();

    rows.forEach((row) => {
        const canonical = normalizeInputRow(row);
        const siret = cleanDigits(canonical?.identifiers?.siret, 14);
        const siren = cleanDigits(canonical?.identifiers?.siren, 9);
        if (!siret && !siren) return;

        const dateKey = queryBuilder.utils.normalizeDateParam(canonical?.transactionDate || '') || '';
        if (!buckets.has(dateKey)) {
            buckets.set(dateKey, {
                sirets: new Set(),
                sirens: new Set()
            });
        }
        const bucket = buckets.get(dateKey);
        if (siret) {
            bucket.sirets.add(siret);
        } else if (siren) {
            bucket.sirens.add(siren);
        }
    });

    return buckets;
}

/**
 * Lane-1 bulk prefetch for exact identifiers (SIRET/SIREN).
 * Seeds dedicated per-id caches so row workers can resolve with near-zero extra calls.
 *
 * @param {{
 *  rows: Record<string, any>[],
 *  apiKeys: string[],
 *  champs?: string[],
 *  batchSize?: number,
 *  fetchImpl?: typeof fetch
 * }} params
 */
export async function prefetchLane1IdentifierBatches(params = {}) {
    const rows = Array.isArray(params.rows) ? params.rows : [];
    const apiKeys = Array.isArray(params.apiKeys) ? params.apiKeys.filter(Boolean) : [];
    if (!rows.length || !apiKeys.length) {
        return {
            totalRequests: 0,
            dateGroups: 0,
            prefetchedSirets: 0,
            prefetchedSirens: 0,
            prefetchedEtablissements: 0,
            errors: []
        };
    }

    const champs = Array.isArray(params.champs) ? params.champs : [];
    const batchSize = params.batchSize || DEFAULT_BATCH_SIZE;
    const fetchImpl = params.fetchImpl || fetch;

    const dateBuckets = collectDateBuckets(rows);
    const errors = [];
    let totalRequests = 0;
    let prefetchedSirets = 0;
    let prefetchedSirens = 0;
    let prefetchedEtablissements = 0;
    let keyCursor = 0;

    const nextKey = () => {
        const key = apiKeys[keyCursor % apiKeys.length];
        keyCursor += 1;
        return key;
    };

    for (const [date, groups] of dateBuckets.entries()) {
        const siretChunks = chunk([...groups.sirets], batchSize);
        const sirenChunks = chunk([...groups.sirens], batchSize);

        for (const ids of siretChunks) {
            const url = buildBulkUrl({ kind: 'siret', ids, champs, date });
            try {
                const data = await fetchBatchSearch({ url, apiKey: nextKey(), fetchImpl });
                const etablissements = Array.isArray(data?.etablissements) ? data.etablissements : [];
                seedLane1Caches(etablissements, date);
                totalRequests += 1;
                prefetchedSirets += ids.length;
                prefetchedEtablissements += etablissements.length;
            } catch (error) {
                errors.push({
                    lane: 'L1_SIRET',
                    date,
                    ids,
                    message: error?.message || String(error)
                });
            }
        }

        for (const ids of sirenChunks) {
            const url = buildBulkUrl({ kind: 'siren', ids, champs, date });
            try {
                const data = await fetchBatchSearch({ url, apiKey: nextKey(), fetchImpl });
                const etablissements = Array.isArray(data?.etablissements) ? data.etablissements : [];
                seedLane1Caches(etablissements, date);
                totalRequests += 1;
                prefetchedSirens += ids.length;
                prefetchedEtablissements += etablissements.length;
            } catch (error) {
                errors.push({
                    lane: 'L1_SIREN',
                    date,
                    ids,
                    message: error?.message || String(error)
                });
            }
        }
    }

    return {
        totalRequests,
        dateGroups: dateBuckets.size,
        prefetchedSirets,
        prefetchedSirens,
        prefetchedEtablissements,
        errors
    };
}
