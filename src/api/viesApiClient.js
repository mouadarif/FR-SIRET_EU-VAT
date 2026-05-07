import cache from './cache.js';
import requestDedup from './requestDedup.js';
import requestQueue from './requestQueue.js';

const DEFAULT_BASE_URL = import.meta.env?.VITE_VIES_API_BASE_URL || '/api/vies/';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 250;

function trimSlashes(value = '') {
    return String(value || '').replace(/^\/+|\/+$/g, '');
}

function isAbsoluteUrl(value = '') {
    return /^https?:\/\//i.test(String(value || ''));
}

function buildUrl(baseUrl, path, params = {}) {
    const normalizedPath = trimSlashes(path);

    if (isAbsoluteUrl(baseUrl)) {
        const url = new URL(normalizedPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
        for (const [key, value] of Object.entries(params)) {
            if (value == null || value === '') continue;
            url.searchParams.set(key, String(value));
        }
        return url.toString();
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value == null || value === '') continue;
        query.set(key, String(value));
    }

    const queryString = query.toString();
    const prefix = `/${trimSlashes(baseUrl)}`;
    return `${prefix}/${normalizedPath}${queryString ? `?${queryString}` : ''}`;
}

function normalizeCountryCode(countryCode) {
    return String(countryCode || '').trim().toUpperCase();
}

function normalizeVatValue(vatNumber) {
    return String(vatNumber || '').replace(/\s+/g, '').trim().toUpperCase();
}

function firstPresent(...values) {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const normalized = String(value).trim();
        if (normalized) return normalized;
    }

    return null;
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'valid', 'yes', '1'].includes(normalized)) return true;
        if (['false', 'invalid', 'no', '0'].includes(normalized)) return false;
    }

    return Boolean(value);
}

function normalizeApproximate(source) {
    const approximate = source.viesApproximate || source.vies_approximate || source.approximate || {};
    return {
        name: firstPresent(approximate.name, approximate.traderName, source.matchNameValue),
        street: firstPresent(approximate.street, approximate.traderStreet, source.matchStreetValue),
        postalCode: firstPresent(approximate.postalCode, approximate.postal_code, source.matchPostalCodeValue),
        city: firstPresent(approximate.city, source.matchCityValue),
        companyType: firstPresent(approximate.companyType, approximate.company_type, source.matchCompanyTypeValue),
        matchName: approximate.matchName ?? source.matchName ?? '',
        matchStreet: approximate.matchStreet ?? source.matchStreet ?? '',
        matchPostalCode: approximate.matchPostalCode ?? source.matchPostalCode ?? '',
        matchCity: approximate.matchCity ?? source.matchCity ?? '',
        matchCompanyType: approximate.matchCompanyType ?? source.matchCompanyType ?? ''
    };
}

function splitVatIdentifier({ countryCode, vatNumber }) {
    const explicitCountryCode = normalizeCountryCode(countryCode);
    const normalizedVat = normalizeVatValue(vatNumber);

    if (explicitCountryCode) {
        const withoutPrefix = normalizedVat.startsWith(explicitCountryCode)
            ? normalizedVat.slice(explicitCountryCode.length)
            : normalizedVat;

        return {
            countryCode: explicitCountryCode,
            vatNumber: withoutPrefix
        };
    }

    const match = normalizedVat.match(/^([A-Z]{2})([A-Z0-9+*]+)$/);
    if (!match) {
        return {
            countryCode: '',
            vatNumber: normalizedVat
        };
    }

    return {
        countryCode: match[1],
        vatNumber: match[2]
    };
}

function normalizeConfiguration(payload) {
    const source = payload || {};
    return {
        updateDate: source.updateDate || null,
        version: source.version || null,
        countries: Array.isArray(source.countries) ? source.countries : [],
        vatNumberPattern: source.vatNumberPattern || null,
        maximumRowsForBatch: typeof source.maximumRowsForBatch === 'number' ? source.maximumRowsForBatch : null,
        minimumRowsForBatch: typeof source.minimumRowsForBatch === 'number' ? source.minimumRowsForBatch : null,
        maximumFileSizeForBatch: typeof source.maximumFileSizeForBatch === 'number' ? source.maximumFileSizeForBatch : null,
        raw: source
    };
}

function normalizeCountries(payload) {
    const value = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.value)
            ? payload.value
            : [];
    return value.map((item) => ({
        countryCode: item.countryCode || '',
        approxMatching: Boolean(item.approxMatching),
        hasName: Boolean(item.hasName),
        hasAddress: Boolean(item.hasAddress),
        hasCompanyType: Boolean(item.hasCompanyType)
    }));
}

function normalizeVatValidation(payload, normalizedLookup) {
    const source = payload || {};
    const legalName = firstPresent(
        source.name,
        source.legalName,
        source.legal_name,
        source.traderName,
        source.trader_name,
        source.companyName,
        source.company_name,
        source.trader?.name,
        source.legal?.name,
        source.company?.name
    );
    const registeredAddress = firstPresent(
        source.address,
        source.registeredAddress,
        source.registered_address,
        source.legalAddress,
        source.legal_address,
        source.traderAddress,
        source.trader_address,
        source.companyAddress,
        source.company_address,
        source.trader?.address,
        source.legal?.address,
        source.company?.address
    );
    const vatNumber = firstPresent(
        source.vatNumber,
        source.vat_number,
        source.traderVatNumber,
        source.trader_vat_number,
        normalizedLookup.vatNumber
    );
    const originalVatNumber = firstPresent(
        source.originalVatNumber,
        source.original_vat_number,
        source.requestedVatNumber,
        source.requested_vat_number,
        `${normalizedLookup.countryCode}${normalizedLookup.vatNumber}`
    );

    return {
        countryCode: normalizedLookup.countryCode,
        vatNumber,
        originalVatNumber,
        isValid: normalizeBoolean(source.isValid ?? source.valid ?? source.is_valid),
        requestDate: source.requestDate || null,
        userError: source.userError || null,
        name: legalName,
        address: registeredAddress,
        legalName,
        registeredAddress,
        requestIdentifier: firstPresent(source.requestIdentifier, source.request_identifier),
        viesApproximate: normalizeApproximate(source),
        raw: source
    };
}

function toVatSearchResult(result) {
    return {
        result_kind: 'vat',
        country_code: result.countryCode,
        vat_number: result.vatNumber,
        original_vat_number: result.originalVatNumber,
        legal_name: result.legalName || result.name || '',
        registered_address: result.registeredAddress || result.address || '',
        nom_complet: result.legalName || result.name || 'Nom indisponible',
        nom_raison_sociale: result.legalName || result.name || '',
        geo_adresse: result.registeredAddress || result.address || '',
        validation_status: result.userError || (result.isValid ? 'VALID' : 'INVALID'),
        is_valid: result.isValid,
        request_date: result.requestDate,
        request_identifier: result.requestIdentifier || '',
        viesApproximate: result.viesApproximate || null,
        _raw: result.raw || result
    };
}

export class ViesApiClient {
    constructor({ baseUrl = DEFAULT_BASE_URL } = {}) {
        this.baseUrl = baseUrl;
        this._activeControllers = new Set();
    }

    async getConfiguration() {
        const response = await this._executeRequest('configurations', { policy: 'info' });
        if (!response.success) return response;

        return {
            success: true,
            data: normalizeConfiguration(response.data),
            error: null
        };
    }

    async getCountries({ forRequester = true } = {}) {
        const response = await this._executeRequest('countries', {
            params: { forRequester },
            policy: 'lookup'
        });
        if (!response.success) return response;

        return {
            success: true,
            data: {
                countries: normalizeCountries(response.data)
            },
            error: null
        };
    }

    async validateVat({
        countryCode,
        vatNumber,
        requesterMemberStateCode,
        requesterNumber,
        traderName,
        traderCompanyType,
        traderStreet,
        traderPostalCode,
        traderCity
    }) {
        const normalizedLookup = splitVatIdentifier({ countryCode, vatNumber });

        if (!normalizedLookup.countryCode || !normalizedLookup.vatNumber) {
            return {
                success: false,
                data: null,
                error: {
                    status: 0,
                    userMessage: 'Le code pays et le numéro TVA sont obligatoires.'
                }
            };
        }

        const path = `ms/${normalizedLookup.countryCode}/vat/${normalizedLookup.vatNumber}`;
        const response = await this._executeRequest(path, {
            params: {
                requesterMemberStateCode,
                requesterNumber,
                traderName,
                traderCompanyType,
                traderStreet,
                traderPostalCode,
                traderCity
            },
            policy: 'lookup'
        });

        if (!response.success) return response;

        return {
            success: true,
            data: normalizeVatValidation(response.data, normalizedLookup),
            error: null
        };
    }

    async searchByVAT({ countryCode, vatNumber }) {
        const response = await this.validateVat({ countryCode, vatNumber });
        if (!response.success) return response;

        return {
            success: true,
            data: {
                results: [toVatSearchResult(response.data)],
                total_results: 1
            },
            error: null
        };
    }

    cancelPendingRequests() {
        for (const controller of this._activeControllers) {
            controller.abort();
        }
        this._activeControllers.clear();
    }

    async _executeRequest(path, { params = {}, policy = 'default' } = {}) {
        const url = buildUrl(this.baseUrl, path, params);
        const cached = cache.getWithPolicy(url, policy);
        if (cached) {
            return { success: true, data: cached, error: null };
        }

        const controller = new AbortController();
        const headers = {
            Accept: 'application/json'
        };
        const requestKey = requestDedup.buildKey(url, headers);
        this._activeControllers.add(controller);

        try {
            const payload = await requestDedup.run(requestKey, () =>
                requestQueue.add(() => this._fetchWithRetry(url, headers, controller.signal))
            );

            cache.setWithPolicy(url, payload, policy);
            return { success: true, data: payload, error: null };
        } catch (error) {
            if (error?.name === 'AbortError') {
                return {
                    success: false,
                    data: null,
                    error: {
                        status: 0,
                        userMessage: 'Requête annulée.'
                    }
                };
            }

            return {
                success: false,
                data: null,
                error: this._handleError(error)
            };
        } finally {
            this._activeControllers.delete(controller);
        }
    }

    async _fetchWithRetry(url, headers, signal) {
        let lastError = null;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
            try {
                const response = await fetch(url, { headers, signal });

                if (!response.ok) {
                    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                    error.status = response.status;
                    error.statusText = response.statusText;

                    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES - 1) {
                        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * (2 ** attempt)));
                        continue;
                    }

                    throw error;
                }

                return response.json();
            } catch (error) {
                lastError = error;
                if (error?.name === 'AbortError') throw error;
                if (error?.status) throw error;
                if (attempt === MAX_RETRIES - 1) throw error;

                await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * (2 ** attempt)));
            }
        }

        throw lastError || new Error('Request failed.');
    }

    _handleError(error) {
        const status = Number(error?.status) || 0;
        const statusMessages = {
            400: 'VIES a rejeté la requête. Vérifiez le code pays et le format du numéro TVA.',
            404: 'Le point de terminaison VIES est introuvable. Vérifiez la configuration du proxy local.',
            429: 'VIES limite les requêtes. Veuillez patienter quelques secondes.',
            500: 'VIES est temporairement indisponible. Veuillez réessayer ultérieurement.',
            503: 'VIES est temporairement indisponible. Veuillez réessayer ultérieurement.'
        };

        return {
            status,
            userMessage: statusMessages[status] || error?.message || 'La validation TVA a échoué. Veuillez réessayer.'
        };
    }
}

export default new ViesApiClient();
