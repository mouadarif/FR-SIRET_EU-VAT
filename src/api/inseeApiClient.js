import queryBuilder from './queryBuilder.js';
import requestQueue from './requestQueue.js';
import cache from './cache.js';
import requestDedup from './requestDedup.js';
import { fetchServiceInfo } from './serviceInfoClient.js';

function getCurrentPeriod(periodesKey, target = {}) {
    const periodes = Array.isArray(target?.[periodesKey]) ? target[periodesKey] : [];
    if (periodes.length === 0) return {};

    const open = periodes.find((p) => p && (p.dateFin == null || p.dateFin === ''));
    if (open) return open;

    return [...periodes]
        .filter(Boolean)
        .sort((a, b) => String(b.dateDebut || '').localeCompare(String(a.dateDebut || '')))[0] || {};
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 250;

class InseeApiClient {
    constructor() {
        this._activeControllers = new Set();
    }

    // ─── Public search methods ───────────────────────────────────────────

    async searchBySIRET(siret) {
        // Direct lookup: exact, fast, always returns the single matching establishment
        const lookupUrl = queryBuilder.buildSiretLookupUrl(siret);
        const lookupResponse = await this._executeRequest(lookupUrl);

        if (lookupResponse.success && lookupResponse.data?.etablissement) {
            return this._etablissementResponse([lookupResponse.data.etablissement]);
        }

        if (!lookupResponse.success && lookupResponse.error?.status === 404) {
            return this._notFound(`Aucune entreprise trouvée avec le SIRET ${siret}. Veuillez vérifier que le numéro est correct.`);
        }

        return lookupResponse;
    }

    async searchBySIREN(siren) {
        const searchUrl = queryBuilder.buildSirenEtablissementsSearchUrl(siren, { nombre: 100 });
        const searchResponse = await this._executeRequest(searchUrl);

        if (searchResponse.success && searchResponse.data) {
            const etablissements = searchResponse.data.etablissements;
            if (Array.isArray(etablissements) && etablissements.length > 0) {
                return this._etablissementResponse(etablissements, searchResponse.data.header);
            }
        }

        // Fallback: unité légale document (no establishments returned)
        const lookupUrl = queryBuilder.buildSirenLookupUrl(siren);
        const lookupResponse = await this._executeRequest(lookupUrl);

        if (lookupResponse.success && lookupResponse.data?.uniteLegale) {
            return {
                success: true,
                data: {
                    results: [this._normalizeUniteLegale(lookupResponse.data.uniteLegale)],
                    total_results: 1
                },
                error: null
            };
        }

        if (!lookupResponse.success && lookupResponse.error?.status === 404) {
            return this._notFound(`Aucune entreprise trouvée avec le SIREN ${siren}. Veuillez vérifier que le numéro est correct.`);
        }

        return lookupResponse;
    }

    async searchByName(params) {
        const {
            nameQuery,
            address,
            postalCode,
            city,
            siret,
            filters = {},
            page = 1,
            perPage = 25,
            aiVariationsFn = null
        } = params;

        const fetchFn = async (url) => {
            const response = await this._executeRequest(url);
            if (!response.success) {
                if (response.error?.status !== 404) {
                    console.warn(`[INSEE] API error ${response.error?.status}:`, response.error?.userMessage || 'unknown');
                }
                return { etablissements: [] };
            }
            return response.data || { etablissements: [] };
        };

        try {
            const hasStructuredFilters = Boolean(
                address ||
                siret ||
                filters.code_naf ||
                filters.nature_juridique ||
                filters.etat_administratif ||
                filters.tranche_effectif_salarie
            );

            if (hasStructuredFilters) {
                const searchUrl = queryBuilder.buildSiretMultiCriteriaUrl({
                    query: nameQuery,
                    address,
                    code_postal: postalCode,
                    commune: city,
                    siret,
                    code_naf: filters.code_naf,
                    nature_juridique: filters.nature_juridique,
                    etat_administratif: filters.etat_administratif,
                    tranche_effectif_salarie: filters.tranche_effectif_salarie,
                    nombre: perPage,
                    debut: Math.max(0, (page - 1) * perPage)
                });
                const response = await this._executeRequest(searchUrl);

                if (!response.success) {
                    return response;
                }

                const etablissements = Array.isArray(response.data?.etablissements)
                    ? response.data.etablissements
                    : [];

                return {
                    success: true,
                    data: {
                        results: etablissements.map((e) => this._normalizeEtablissement(e)),
                        total_results: response.data?.header?.total ?? etablissements.length,
                        tier: null,
                        tierName: 'MULTI_CRITERIA',
                        variations: null
                    },
                    error: null
                };
            }

            const result = await queryBuilder.executeTieredSearch({
                query: nameQuery,
                code_postal: postalCode,
                commune: city,
                code_naf: filters.code_naf,
                fetchFn,
                aiVariationsFn
            });

            if (this._isDevMode()) {
                console.log(`[INSEE] Tier ${result.tier} (${result.tierName}) → ${result.results.length} results (raw: ${result.totalBeforeFilter})`);
            }

            const start = (page - 1) * perPage;
            const safeStart = start >= result.results.length && result.results.length > 0 ? 0 : start;
            const paginatedResults = result.results.slice(safeStart, safeStart + perPage);

            return {
                success: true,
                data: {
                    results: paginatedResults.map((e) => this._normalizeEtablissement(e)),
                    total_results: result.results.length,
                    tier: result.tier,
                    tierName: result.tierName,
                    variations: result.variations || null
                },
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: this._handleError(error)
            };
        }
    }

    async getServiceInfo() {
        const apiKey = queryBuilder.getApiKey();
        return fetchServiceInfo({ apiKey });
    }

    cancelPendingRequests() {
        for (const controller of this._activeControllers) {
            controller.abort();
        }
        this._activeControllers.clear();
    }

    // ─── HTTP layer ──────────────────────────────────────────────────────

    async _executeRequest(url) {
        const isDevMode = this._isDevMode();
        const cachePolicy = cache.policyFromUrl(url);

        const cached = cache.getWithPolicy(url, cachePolicy);
        if (cached) {
            if (isDevMode) console.log('[INSEE] cache hit', url.length > 120 ? url.slice(0, 117) + '...' : url);
            return { success: true, data: cached, error: null };
        }

        if (isDevMode) {
            try {
                const u = new URL(url);
                const q = u.searchParams.get('q') ? decodeURIComponent(u.searchParams.get('q')) : '';
                console.groupCollapsed(`[INSEE] GET ${q || url.slice(0, 80)}`);
                console.log('url:', url);
                if (q) console.log('q:', q);
            } catch (_) { /* ignore */ }
        }

        const t0 = Date.now();
        const controller = new AbortController();
        this._activeControllers.add(controller);

        try {
            const apiKey = queryBuilder.getApiKey();
            const headers = {
                Accept: 'application/json',
                'X-INSEE-Api-Key-Integration': apiKey
            };

            const response = await requestDedup.run(url, () =>
                requestQueue.add(() => this._fetchWithRetry(url, headers, controller.signal, isDevMode))
            );

            cache.setWithPolicy(url, response, cachePolicy);

            if (isDevMode) {
                const count = response?.etablissements?.length ?? response?.header?.total ?? '?';
                console.log(`OK — ${count} results, ${Date.now() - t0}ms`);
                console.groupEnd();
            }

            return { success: true, data: response, error: null };
        } catch (error) {
            if (isDevMode) {
                console.warn(`FAIL — ${error?.status ?? error?.message ?? error}, ${Date.now() - t0}ms`);
                console.groupEnd();
            }

            if (error.name === 'AbortError') {
                return { success: false, data: null, error: { userMessage: 'Requête annulée' } };
            }

            return { success: false, data: null, error: this._handleError(error) };
        } finally {
            this._activeControllers.delete(controller);
        }
    }

    async _fetchWithRetry(url, headers, signal, isDevMode) {
        let lastError = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
            try {
                const res = await fetch(url, { signal, headers });

                if (!res.ok) {
                    const isRetryable = (res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES - 1;
                    if (isRetryable) {
                        if (isDevMode) console.log(`[INSEE] ${res.status} — retry ${attempt + 1}/${MAX_RETRIES - 1}`);
                        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (2 ** attempt)));
                        continue;
                    }
                    throw Object.assign(new Error(`HTTP ${res.status}: ${res.statusText}`), {
                        status: res.status,
                        statusText: res.statusText
                    });
                }

                return res.json();
            } catch (error) {
                lastError = error;
                if (error?.name === 'AbortError') throw error;
                // HTTP errors (with a status code) should not be retried — only network failures
                if (error?.status) throw error;
                if (attempt === MAX_RETRIES - 1) throw error;
                await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (2 ** attempt)));
            }
        }
        throw lastError || new Error('Request failed');
    }

    // ─── Normalization ───────────────────────────────────────────────────

    _normalizeEtablissement(etablissement) {
        const periode = getCurrentPeriod('periodesEtablissement', etablissement);
        const uniteLegale = etablissement.uniteLegale || {};
        const adresse = etablissement.adresseEtablissement || {};
        const denominationUsuelle = periode.denominationUsuelleEtablissement || etablissement.denominationUsuelleEtablissement;
        const enseigne = periode.enseigne1Etablissement || etablissement.enseigne1Etablissement;
        const etatAdministratif = periode.etatAdministratifEtablissement || etablissement.etatAdministratifEtablissement;
        const activitePrincipale = periode.activitePrincipaleEtablissement || etablissement.activitePrincipaleEtablissement;

        return {
            siret: etablissement.siret,
            siren: etablissement.siren,
            nom_complet: denominationUsuelle || enseigne || uniteLegale.denominationUniteLegale || uniteLegale.nomUniteLegale || 'N/A',
            nom_raison_sociale: uniteLegale.denominationUniteLegale || uniteLegale.nomUniteLegale,
            enseigne: enseigne || null,
            etat_administratif: etatAdministratif,
            etablissement_siege: etablissement.etablissementSiege === true,
            code_postal: adresse.codePostalEtablissement,
            libelle_commune: adresse.libelleCommuneEtablissement,
            geo_adresse: this._buildAddress(adresse),
            siege: {
                siret: etablissement.siret,
                etat_administratif: etatAdministratif,
                adresse: this._buildAddress(adresse),
                code_postal: adresse.codePostalEtablissement,
                libelle_commune: adresse.libelleCommuneEtablissement
            },
            activite_principale: activitePrincipale,
            tranche_effectif_salarie: etablissement.trancheEffectifsEtablissement,
            date_creation: etablissement.dateCreationEtablissement,
            _raw: etablissement
        };
    }

    _normalizeUniteLegale(uniteLegale) {
        const periode = getCurrentPeriod('periodesUniteLegale', uniteLegale);
        const individuName = uniteLegale.prenom1UniteLegale && uniteLegale.nomUniteLegale
            ? `${uniteLegale.prenom1UniteLegale} ${uniteLegale.nomUniteLegale}`
            : uniteLegale.nomUniteLegale || null;

        return {
            siren: uniteLegale.siren,
            siret: null,
            nom_complet: periode.denominationUniteLegale || periode.nomUniteLegale || individuName || 'N/A',
            nom_raison_sociale: periode.denominationUniteLegale || periode.nomUniteLegale,
            etat_administratif: periode.etatAdministratifUniteLegale,
            activite_principale: periode.activitePrincipaleUniteLegale,
            tranche_effectif_salarie: uniteLegale.trancheEffectifsUniteLegale,
            date_creation: uniteLegale.dateCreationUniteLegale,
            categorie_juridique: periode.categorieJuridiqueUniteLegale,
            _raw: uniteLegale
        };
    }

    _buildAddress(adresse) {
        const parts = [
            adresse.numeroVoieEtablissement,
            adresse.indiceRepetitionEtablissement,
            adresse.typeVoieEtablissement,
            adresse.libelleVoieEtablissement,
            adresse.complementAdresseEtablissement
        ].filter(Boolean);

        return parts.join(' ') || 'N/A';
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    _etablissementResponse(etablissements, header) {
        const sorted = queryBuilder.sortHeadquartersFirst(etablissements);
        return {
            success: true,
            data: {
                results: sorted.map((e) => this._normalizeEtablissement(e)),
                total_results: header?.total ?? etablissements.length
            },
            error: null
        };
    }

    _notFound(userMessage) {
        return {
            success: false,
            data: null,
            error: { userMessage }
        };
    }

    _handleError(error) {
        const status = error.status || 0;
        const STATUS_MESSAGES = {
            401: 'Erreur d\'authentification. Veuillez vérifier la configuration de votre clé API.',
            404: 'Aucun résultat trouvé. Essayez d\'autres termes de recherche.',
            429: 'Trop de requêtes. Veuillez patienter quelques secondes.',
            400: 'Requête rejetée par les règles de syntaxe INSEE. Veuillez simplifier la recherche.',
            500: 'Service indisponible. Réessayez dans quelques minutes.',
            503: 'Service indisponible. Réessayez dans quelques minutes.'
        };

        return {
            status,
            userMessage: STATUS_MESSAGES[status] || error.message || 'Une erreur est survenue. Veuillez réessayer.'
        };
    }

    _isDevMode() {
        return (typeof import.meta !== 'undefined' && (import.meta.env?.DEV || import.meta.env?.VITEST))
            || (typeof process !== 'undefined' && process.env?.LOG_API_CALLS === '1');
    }
}

export default new InseeApiClient();
