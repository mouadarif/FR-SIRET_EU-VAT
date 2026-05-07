import cache from './cache.js';
import requestDedup from './requestDedup.js';
import requestQueue from './requestQueue.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.insee.fr/api-sirene/3.11';

/**
 * @param {any} payload
 */
function normalizeServiceInfo(payload) {
    const source = payload || {};
    const freshness = source.dateDernierTraitement || source.dateDerniereMiseAJour || source.dateMiseAJour || null;
    return {
        serviceState: source.etatService || source.etat || source.status || 'UNKNOWN',
        version: source.version || source.versionService || source.apiVersion || null,
        freshnessDate: freshness,
        raw: source
    };
}

/**
 * Fetch INSEE service information (/informations).
 * Uses cache policy "info" + in-flight de-dup.
 *
 * @param {{ apiKey: string }} params
 */
export async function fetchServiceInfo({ apiKey }) {
    const url = `${BASE_URL}/informations`;
    const policy = 'info';
    const headers = {
        Accept: 'application/json',
        'X-INSEE-Api-Key-Integration': apiKey || ''
    };

    const cached = cache.getWithPolicy(url, policy);
    if (cached) {
        return cached;
    }

    const key = requestDedup.buildKey(url, headers);
    return requestDedup.run(key, async () => {
        const payload = await requestQueue.add(async () => {
            const response = await fetch(url, { headers });
            if (!response.ok) {
                const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
                err.status = response.status;
                throw err;
            }
            return response.json();
        });

        const normalized = normalizeServiceInfo(payload);
        cache.setWithPolicy(url, normalized, policy);
        return normalized;
    });
}

