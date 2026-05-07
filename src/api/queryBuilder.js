// Query Builder for Official INSEE Sirene API v3.11
// Base URL: https://api.insee.fr/api-sirene/3.11
// Authentication: X-INSEE-Api-Key-Integration header required
//
// ENHANCED VERSION with:
// - Strict name matching (spaces treated as single phrase)
// - Search on both denominationUniteLegale AND enseigne fields
// - Tiered fallback logic (NEIGHBOR, MOVER, DETECTIVE, LAST RESORT)

// Use environment variable for API URL (allows for dev/prod configs)
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.insee.fr/api-sirene/3.11';

const _isDev = !!(typeof import.meta !== 'undefined' && (import.meta.env?.DEV || import.meta.env?.VITEST));
function _log(...args) { if (_isDev) console.log('[INSEE QB]', ...args); }
function _warn(...args) { if (_isDev) console.warn('[INSEE QB]', ...args); }

// Assemble all 10 API keys from env
const API_KEYS = [
    import.meta.env.VITE_INSEE_API_KEY,
    import.meta.env.VITE_INSEE_API_KEY2,
    import.meta.env.VITE_INSEE_API_KEY3,
    import.meta.env.VITE_INSEE_API_KEY4,
    import.meta.env.VITE_INSEE_API_KEY5,
    import.meta.env.VITE_INSEE_API_KEY6,
    import.meta.env.VITE_INSEE_API_KEY7,
    import.meta.env.VITE_INSEE_API_KEY8,
    import.meta.env.VITE_INSEE_API_KEY9,
    import.meta.env.VITE_INSEE_API_KEY10
].filter(Boolean);

let keyIndex = 0;

function foldFrenchText(str) {
    if (!str) return '';
    return String(str)
        .replace(/\u0153/g, 'oe')
        .replace(/\u0152/g, 'OE')
        .replace(/\u00e6/g, 'ae')
        .replace(/\u00c6/g, 'AE')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');
}

function getCurrentPeriodeEtablissement(etablissement) {
    const periodes = Array.isArray(etablissement?.periodesEtablissement)
        ? etablissement.periodesEtablissement
        : [];
    if (periodes.length === 0) return {};

    const current = periodes.find((periode) => periode && (periode.dateFin == null || periode.dateFin === ''));
    if (current) return current;

    return [...periodes]
        .filter(Boolean)
        .sort((a, b) => String(b.dateDebut || '').localeCompare(String(a.dateDebut || '')))[0] || {};
}

function getCurrentEtablissementStatus(etablissement) {
    const current = getCurrentPeriodeEtablissement(etablissement);
    return current.etatAdministratifEtablissement || etablissement?.etatAdministratifEtablissement || null;
}

/**
 * Escape special characters for Lucene query syntax
 * Special characters: + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
 */
function escapeLucene(str) {
    if (!str) return '';

    // Step 1: Replace punctuation with spaces FIRST (Lucene doesn't handle them well in wildcards)
    // Example: "L'ATELIER" → "L ATELIER"
    // Example: "A.E.T.I." → "A E T I "
    // Example: "B-PROCESS" → "B PROCESS"
    // Example: "FRUITS & LEGUMES" → "FRUITS   LEGUMES"
    str = str.replace(/['\.\-_\&\+,\;:!]/g, ' ');

    // Step 2: Normalize accents (é → e, à → a, ç → c, etc.)
    // INSEE indexer ignores accents, so we must remove them too
    // Example: "SOCIÉTÉ" → "SOCIETE", "FRANÇAISE" → "FRANCAISE"
    str = foldFrenchText(str);     // Supprime les diacritiques

    // Step 3: Escape remaining special Lucene characters
    return str.replace(/([+&|!(){}[\]^"~?:\\\/])/g, '\\$1');
}

/**
 * Normalize a string for comparison (uppercase, remove accents, trim)
 */
function normalizeForComparison(str) {
    if (!str) return '';
    return foldFrenchText(str)
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * STRICT NAME MATCHING
 * Checks if the search phrase appears as a contiguous sequence in the target string.
 * "GO EMBAL" should match "GO EMBAL PLATEAUX" but NOT "EMBALLO" or "EMBALGO"
 * 
 * @param {string} searchPhrase - The phrase to search for (e.g., "GO EMBAL")
 * @param {string} targetName - The name to search in (e.g., "GO EMBAL PLATEAUX CARTON")
 * @param {Object} options - Optional matching options
 * @param {boolean} options.allowPrefixForSingleWord - Allow prefix matching for single word searches (default: false)
 * @returns {boolean} - True if the phrase matches strictly
 */
function strictNameMatch(searchPhrase, targetName, options = {}) {
    if (!searchPhrase || !targetName) return false;

    const { allowPrefixForSingleWord = false } = options;

    const normalizedSearch = normalizeForComparison(searchPhrase);
    const normalizedTarget = normalizeForComparison(targetName)
        .replace(/\([^)]*\)/g, ' '); // Remove content between parentheses

    // Split into words
    const searchWords = normalizedSearch.split(/\s+/).filter(w => w.length > 0);
    const targetWords = normalizedTarget.split(/[\s\-\.\'\*\/\(\)\[\]]+/).filter(w => w.length > 0);

    if (searchWords.length === 0) return false;
    if (searchWords.length === 1) {
        // Single word: require EXACT match by default
        // This prevents "DUPONT" from matching "DUPONTEL"
        // Set allowPrefixForSingleWord=true for prefix matching
        const searchWord = searchWords[0];
        if (allowPrefixForSingleWord) {
            return targetWords.some(tw => tw.startsWith(searchWord));
        }
        return targetWords.some(tw => tw === searchWord);
    }

    // Multiple words: find contiguous sequence in target
    // "GO EMBAL" must appear as consecutive words in target
    for (let i = 0; i <= targetWords.length - searchWords.length; i++) {
        let allMatch = true;
        for (let j = 0; j < searchWords.length; j++) {
            const searchWord = searchWords[j];
            const targetWord = targetWords[i + j];

            // Last search word can be a prefix (partial match)
            // Other words must match exactly or target word starts with search word
            if (j === searchWords.length - 1) {
                // Last word: allow prefix match
                if (!targetWord.startsWith(searchWord)) {
                    allMatch = false;
                    break;
                }
            } else {
                // Non-last words: must match exactly
                if (targetWord !== searchWord) {
                    allMatch = false;
                    break;
                }
            }
        }
        if (allMatch) return true;
    }

    return false;
}

/**
 * Check if a result matches the search criteria strictly
 * Searches in: denominationUniteLegale, enseigne1, enseigne2, enseigne3, denominationUsuelleEtablissement
 * 
 * @param {Object} etablissement - The establishment object from API response
 * @param {string} searchPhrase - The search phrase
 * @param {Object} options - Optional matching options (passed to strictNameMatch)
 * @returns {boolean} - True if any name field matches strictly
 */
function resultMatchesStrictly(etablissement, searchPhrase, options = {}) {
    if (!etablissement || !searchPhrase) return false;

    const uniteLegale = etablissement.uniteLegale || {};
    const currentPeriod = getCurrentPeriodeEtablissement(etablissement);

    // Fields to check for name match
    const nameFields = [
        uniteLegale.denominationUniteLegale,
        uniteLegale.denominationUsuelle1UniteLegale,
        uniteLegale.denominationUsuelle2UniteLegale,
        uniteLegale.denominationUsuelle3UniteLegale,
        etablissement.enseigne1Etablissement,
        etablissement.enseigne2Etablissement,
        etablissement.enseigne3Etablissement,
        etablissement.denominationUsuelleEtablissement,
        currentPeriod.enseigne1Etablissement,
        currentPeriod.enseigne2Etablissement,
        currentPeriod.enseigne3Etablissement,
        currentPeriod.denominationUsuelleEtablissement
    ];

    return nameFields.some(field => strictNameMatch(searchPhrase, field, options));
}

/**
 * Build name search query for API
 * INSEE API v3.11 constraint: leading wildcards (*word) are FORBIDDEN.
 * Only trailing wildcards (word*) are allowed.
 *
 * Searches 3 core fields:
 *   - denominationUniteLegale (legal name, non-historized on /siret)
 *   - enseigne1Etablissement  (trade name, historized → periode())
 *   - denominationUsuelleEtablissement (usual name, historized → periode())
 *
 * @param {string} query - The search query (company name)
 * @returns {string} - Lucene query string for name search
 */
function buildNameSearchQuery(query) {
    if (!query) return '';

    const escapedQuery = escapeLucene(query);
    const rawWords = escapedQuery.trim().split(/\s+/).filter(w => w.length > 0);
    const words = rawWords.filter(w => w.length > 1);
    const effectiveWords = words.length > 0 ? words : rawWords.slice(0, 1);

    if (effectiveWords.length === 0) return '';

    if (effectiveWords.length === 1) {
        const w = effectiveWords[0];
        return `(denominationUniteLegale:${w}* OR periode(enseigne1Etablissement:${w}*) OR periode(denominationUsuelleEtablissement:${w}*))`;
    }

    const ulParts = effectiveWords.map(w => `denominationUniteLegale:${w}*`);
    const e1Parts = effectiveWords.map(w => `enseigne1Etablissement:${w}*`);
    const duParts = effectiveWords.map(w => `denominationUsuelleEtablissement:${w}*`);

    return `((${ulParts.join(' AND ')}) OR periode(${e1Parts.join(' AND ')}) OR periode(${duParts.join(' AND ')}))`;
}

/**
 * Extract department code from postal code
 * Handles both metropolitan (2 digits) and overseas (3 digits) departments
 * 
 * @param {string} postalCode - 5-digit postal code
 * @returns {string} - Department code (2 or 3 digits)
 */
function getDepartmentFromPostalCode(postalCode) {
    if (!postalCode) return '';
    const pc = String(postalCode).trim();
    if (pc.length < 2) return '';

    // Overseas departments: 971, 972, 973, 974, 976
    if (pc.startsWith('97') && pc.length >= 3) {
        return pc.substring(0, 3);
    }
    // Corsica postal codes are numeric 20xxx in codePostal wildcard strategy.
    if (pc.startsWith('20')) {
        return '20';
    }
    // Metropolitan France: first 2 digits
    return pc.substring(0, 2);
}

function clampInt(value, min, max, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
}
function normalizePaginationOptions(options = {}, responseFormat = 'json') {
    const isCsv = String(responseFormat || '').toLowerCase() === 'csv';
    const maxNombre = isCsv ? 200000 : 1000;
    const maxDebut = 10000;

    const normalized = {
        nombre: clampInt(options.nombre, 0, maxNombre, 25),
        debut: clampInt(options.debut, 0, maxDebut, 0),
        tri: options.tri || null,
        curseur: options.curseur || null
    };

    // Guardrail: tri and curseur are incompatible in INSEE API.
    if (normalized.tri && normalized.curseur) {
        throw new Error('INSEE guardrail: `tri` cannot be used with `curseur`.');
    }

    return normalized;
}

const FLAT_FIELD_ALIASES = new Map([
    ['uniteLegale.denominationUniteLegale', 'denominationUniteLegale'],
    ['uniteLegale.categorieJuridiqueUniteLegale', 'categorieJuridiqueUniteLegale'],
    ['uniteLegale.etatAdministratifUniteLegale', 'etatAdministratifUniteLegale'],
    ['periodesUniteLegale.denominationUniteLegale', 'denominationUniteLegale'],
    ['periodesUniteLegale.denominationUsuelle1UniteLegale', 'denominationUsuelle1UniteLegale'],
    ['periodesUniteLegale.denominationUsuelle2UniteLegale', 'denominationUsuelle2UniteLegale'],
    ['periodesUniteLegale.denominationUsuelle3UniteLegale', 'denominationUsuelle3UniteLegale'],
    ['periodesEtablissement.denominationUsuelleEtablissement', 'denominationUsuelleEtablissement'],
    ['periodesEtablissement.enseigne1Etablissement', 'enseigne1Etablissement'],
    ['periodesEtablissement.enseigne2Etablissement', 'enseigne2Etablissement'],
    ['periodesEtablissement.enseigne3Etablissement', 'enseigne3Etablissement'],
    ['periodesEtablissement.etatAdministratifEtablissement', 'etatAdministratifEtablissement'],
    ['periodesEtablissement.activitePrincipaleEtablissement', 'activitePrincipaleEtablissement'],
    ['adresseEtablissement.codePostalEtablissement', 'codePostalEtablissement'],
    ['adresseEtablissement.libelleCommuneEtablissement', 'libelleCommuneEtablissement'],
    ['adresseEtablissement.libelleVoieEtablissement', 'libelleVoieEtablissement'],
    ['adresseEtablissement.complementAdresseEtablissement', 'complementAdresseEtablissement'],
    ['adresseEtablissement.numeroVoieEtablissement', 'numeroVoieEtablissement']
]);

function normalizeInseeFieldName(field) {
    const raw = String(field || '').trim();
    if (!raw) return '';
    const normalized = raw.replace(/\.\d+\./g, '.').replace(/\.\d+$/g, '');
    if (FLAT_FIELD_ALIASES.has(normalized)) {
        return FLAT_FIELD_ALIASES.get(normalized);
    }
    const parts = normalized.split('.');
    return parts[parts.length - 1] || normalized;
}

function normalizeChamps(champs = []) {
    const list = Array.isArray(champs) ? champs : [champs];
    const normalized = list
        .map((field) => normalizeInseeFieldName(field))
        .filter(Boolean);
    return [...new Set(normalized)];
}

function normalizeDateParam(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(raw)) {
        const [dd, mm, yyyy] = raw.split(/[/-]/);
        return `${yyyy}-${mm}-${dd}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function applySearchPaginationParams(urlParams, options = {}) {
    const normalized = normalizePaginationOptions(options, options.responseFormat || 'json');
    urlParams.append('nombre', String(normalized.nombre));

    if (normalized.curseur) {
        urlParams.append('curseur', normalized.curseur);
    } else {
        urlParams.append('debut', String(normalized.debut));
        if (normalized.tri) urlParams.append('tri', normalized.tri);
    }

    const dateParam = normalizeDateParam(options.date);
    if (dateParam) {
        urlParams.append('date', dateParam);
    }

    if (Array.isArray(options.champs) && options.champs.length > 0) {
        const unique = normalizeChamps(options.champs);
        if (unique.length > 0) {
            urlParams.append('champs', unique.join(','));
        }
    }

    if (typeof options.masquerValeursNulles === 'boolean') {
        urlParams.append('masquerValeursNulles', String(options.masquerValeursNulles));
    }

    const facettes = Array.isArray(options.facetteChamp)
        ? options.facetteChamp
        : (options.facetteChamp ? [options.facetteChamp] : []);
    if (facettes.length > 0) {
        urlParams.append('facette.champ', facettes.join(','));
    }
}

const queryBuilder = {
    /**
     * Get API Key for authentication
     */
    getApiKey() {
        if (API_KEYS.length === 0) return '';
        const key = API_KEYS[keyIndex % API_KEYS.length];
        keyIndex++;
        return key;
    },

    /**
     * Build URL for direct SIRET lookup
     */
    buildSiretLookupUrl(siret) {
        return `${BASE_URL}/siret/${siret}`;
    },

    /**
     * Build URL for direct SIREN lookup (unité légale document only)
     */
    buildSirenLookupUrl(siren) {
        return `${BASE_URL}/siren/${siren}`;
    },

    /**
     * List établissements for a SIREN (same pattern as enrichment / INSEE search).
     * GET /siret?q=siren:{siren}&nombre={n}
     */
    buildSirenEtablissementsSearchUrl(siren, { nombre = 100 } = {}) {
        const params = new URLSearchParams();
        params.set('q', `siren:${siren}`);
        params.set('nombre', String(nombre));
        return `${BASE_URL}/siret?${params.toString()}`;
    },

    /**
     * Build URL for the INSEE service information endpoint.
     */
    buildInformationsUrl() {
        return `${BASE_URL}/informations`;
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // TIERED SEARCH STRATEGY
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * TIER 2: NEIGHBOR 🏘️
     * Query: Name + Postal Code (NO street) OR City
     * API Call: GET /siret?q={query}&nombre=20
     * 
     * @param {Object} params - { query: string, code_postal?: string, commune?: string }
     * @returns {string} - Full URL for the request
     */
    buildTier2NeighborUrl(params) {
        const { query, code_postal, commune, date, champs = [] } = params;
        const queryParts = [];

        // Name search (legal name + brand names)
        if (query) {
            queryParts.push(buildNameSearchQuery(query));
        }

        // Location filter: Postal Code OR City (not both required)
        const locationParts = [];
        if (code_postal) {
            locationParts.push(`codePostalEtablissement:${code_postal}`);
        }
        if (commune) {
            const escapedCommune = escapeLucene(commune);
            const communeWords = escapedCommune.trim().split(/\s+/).filter(w => w.length > 0);
            if (communeWords.length === 1) {
                locationParts.push(`libelleCommuneEtablissement:${communeWords[0]}*`);
            } else {
                const communeQueries = communeWords.map(word => `libelleCommuneEtablissement:${word}*`);
                locationParts.push(`(${communeQueries.join(' AND ')})`);
            }
        }

        if (locationParts.length > 0) {
            queryParts.push(`(${locationParts.join(' OR ')})`);
        }

        const fullQuery = queryParts.join(' AND ');
        const urlParams = new URLSearchParams();
        if (fullQuery) urlParams.append('q', fullQuery);
        applySearchPaginationParams(urlParams, { nombre: 20, date, champs });

        _log('TIER 2 NEIGHBOR q=', fullQuery);
        return `${BASE_URL}/siret?${urlParams.toString()}`;
    },

    /**
     * TIER 3: MOVER 🚚
     * Query: Name + Department (first 2/3 digits of postal)
     * API Call: GET /siret?q={query}&nombre=50
     * Filter: Headquarters first, then establishments (active or not) with strict name search
     * 
     * @param {Object} params - { query: string, code_postal: string }
     * @returns {string} - Full URL for the request
     */
    buildTier3MoverUrl(params) {
        const { query, code_postal, date, champs = [] } = params;
        const queryParts = [];

        // Name search
        if (query) {
            queryParts.push(buildNameSearchQuery(query));
        }

        // Department filter (wildcard on postal code prefix)
        if (code_postal) {
            const department = getDepartmentFromPostalCode(code_postal);
            if (department) {
                queryParts.push(`codePostalEtablissement:${department}*`);
            }
        }

        const fullQuery = queryParts.join(' AND ');
        const urlParams = new URLSearchParams();
        if (fullQuery) urlParams.append('q', fullQuery);
        applySearchPaginationParams(urlParams, { nombre: 50, date, champs });

        _log('TIER 3 MOVER q=', fullQuery);
        return `${BASE_URL}/siret?${urlParams.toString()}`;
    },

    /**
     * TIER 4: DETECTIVE 🔍 (AI-POWERED)
     * AI Step: Find different names (legal) with department and activity
     * Query: Department + (variation1 OR variation2 OR variation3)
     * Search 3 Fields: denominationUniteLegale, enseigne1Etablissement
     * API Call: GET /siret?q={super_query}&nombre=50
     * Filter: Headquarters first, then active
     * 
     * @param {Object} params - { variations: string[], code_postal: string, code_naf?: string }
     * @returns {string} - Full URL for the request
     */
    buildTier4DetectiveUrl(params) {
        const { variations = [], code_postal, code_naf, date, champs = [] } = params;
        const queryParts = [];

        // Build OR query for all name variations
        if (variations.length > 0) {
            const variationQueries = variations.map(variation => {
                return buildNameSearchQuery(variation);
            }).filter(Boolean);

            if (variationQueries.length > 0) {
                queryParts.push(`(${variationQueries.join(' OR ')})`);
            }
        }

        // Department filter
        if (code_postal) {
            const department = getDepartmentFromPostalCode(code_postal);
            if (department) {
                queryParts.push(`codePostalEtablissement:${department}*`);
            }
        }

        // Optional NAF code filter
        if (code_naf) {
            queryParts.push(`activitePrincipaleEtablissement:${code_naf}`);
        }

        const fullQuery = queryParts.join(' AND ');
        const urlParams = new URLSearchParams();
        if (fullQuery) urlParams.append('q', fullQuery);
        applySearchPaginationParams(urlParams, { nombre: 50, date, champs });

        _log('TIER 4 DETECTIVE q=', fullQuery);
        return `${BASE_URL}/siret?${urlParams.toString()}`;
    },

    /**
     * TIER 5: LAST RESORT 🆘
     * Query: Name only (NO location filter)
     * API Call: GET /siret?q={query}&nombre=50
     * Filter: STRICT - Headquarters only, max 20 results
     * 
     * @param {Object} params - { query: string }
     * @returns {string} - Full URL for the request
     */
    buildTier5LastResortUrl(params) {
        const { query, date, champs = [] } = params;

        // Name search only - no location filters
        const nameQuery = query ? buildNameSearchQuery(query) : '';

        const urlParams = new URLSearchParams();
        if (nameQuery) urlParams.append('q', nameQuery);
        applySearchPaginationParams(urlParams, { nombre: 50, date, champs });

        _log('TIER 5 LAST RESORT q=', nameQuery);
        return `${BASE_URL}/siret?${urlParams.toString()}`;
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // RESULT FILTERING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Filter results with STRICT name matching
     * Ensures "GO EMBAL" matches "GO EMBAL PLATEAUX" but NOT "EMBALLO" or "EMBALGO"
     * 
     * @param {Array} etablissements - Array of establishment objects from API
     * @param {string} searchPhrase - The original search phrase
     * @param {Object} options - Optional matching options (e.g., { allowPrefixForSingleWord: true })
     * @returns {Array} - Filtered establishments that strictly match
     */
    filterStrictNameMatch(etablissements, searchPhrase, options = {}) {
        if (!etablissements || !searchPhrase) return [];
        return etablissements.filter(etab => resultMatchesStrictly(etab, searchPhrase, options));
    },

    /**
     * Sort results: Headquarters first, then by status (active first)
     * 
     * @param {Array} etablissements - Array of establishment objects
     * @returns {Array} - Sorted establishments
     */
    sortHeadquartersFirst(etablissements) {
        if (!etablissements) return [];

        return [...etablissements].sort((a, b) => {
            // Headquarters (etablissementSiege) first
            const isHQA = a?.etablissementSiege === true ? 0 : 1;
            const isHQB = b?.etablissementSiege === true ? 0 : 1;
            if (isHQA !== isHQB) return isHQA - isHQB;

            // Then active establishments first
            const isActiveA = getCurrentEtablissementStatus(a) === 'A' ? 0 : 1;
            const isActiveB = getCurrentEtablissementStatus(b) === 'A' ? 0 : 1;
            return isActiveA - isActiveB;
        });
    },

    /**
     * Filter to headquarters only
     * 
     * @param {Array} etablissements - Array of establishment objects
     * @returns {Array} - Only headquarters establishments
     */
    filterHeadquartersOnly(etablissements) {
        if (!etablissements) return [];

        return etablissements.filter(etab => etab?.etablissementSiege === true);
    },

    /**
     * Filter to active establishments only
     * 
     * @param {Array} etablissements - Array of establishment objects
     * @returns {Array} - Only active establishments
     */
    filterActiveOnly(etablissements) {
        if (!etablissements) return [];
        return etablissements.filter(etab => getCurrentEtablissementStatus(etab) === 'A');
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // COMPLETE TIERED SEARCH EXECUTOR
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Execute tiered search strategy with TRUE PARALLELISM.
     *
     * Phase 1 – fires Tier 2 (NEIGHBOR) + Tier 3 (MOVER) concurrently via
     *           Promise.all. If Tier 2 returns results it wins; else Tier 3.
     * Phase 2 – only entered when Phase 1 found nothing.
     *           Fires Tier 4 (AI DETECTIVE) + Tier 5 (LAST RESORT) concurrently.
     *           Tier 4 wins if it returns active results; else Tier 5 (HQ only).
     *
     * Every individual fetch is error-isolated so one failure never kills the chain.
     */
    async executeTieredSearch(params) {
        const {
            query,
            code_postal,
            commune,
            code_naf,
            date,
            champs = [],
            fetchFn,
            aiVariationsFn
        } = params;

        if (!fetchFn) {
            throw new Error('fetchFn is required for executeTieredSearch');
        }

        const t0 = Date.now();

        const safeFetch = async (url, tierLabel) => {
            const start = Date.now();
            try {
                const res = await fetchFn(url);
                _log(`${tierLabel} responded in ${Date.now() - start}ms — ${res?.etablissements?.length ?? 0} raw results`);
                return res;
            } catch (err) {
                _warn(`${tierLabel} failed after ${Date.now() - start}ms:`, err.message || err);
                return { etablissements: [] };
            }
        };

        // ── PHASE 1: Tier 2 + Tier 3 in PARALLEL ─────────────────────────
        _log('Phase 1 → Tier 2 (NEIGHBOR) + Tier 3 (MOVER) in parallel');

        const tier2Url = this.buildTier2NeighborUrl({ query, code_postal, commune, date, champs });
        const tier3Url = this.buildTier3MoverUrl({ query, code_postal, date, champs });

        const [tier2Response, tier3Response] = await Promise.all([
            safeFetch(tier2Url, 'Tier 2 NEIGHBOR'),
            safeFetch(tier3Url, 'Tier 3 MOVER')
        ]);

        const tier2Results = tier2Response?.etablissements || [];
        const tier3Results = tier3Response?.etablissements || [];

        _log(`Phase 1 done (${Date.now() - t0}ms) — T2: ${tier2Results.length}, T3: ${tier3Results.length}`);

        if (tier2Results.length > 0) {
            return {
                tier: 2,
                tierName: 'NEIGHBOR',
                results: this.sortHeadquartersFirst(tier2Results),
                url: tier2Url,
                totalBeforeFilter: tier2Results.length
            };
        }

        if (tier3Results.length > 0) {
            return {
                tier: 3,
                tierName: 'MOVER',
                results: this.sortHeadquartersFirst(tier3Results),
                url: tier3Url,
                totalBeforeFilter: tier3Results.length
            };
        }

        // ── PHASE 2: Tier 4 (AI) + Tier 5 in PARALLEL ────────────────────
        _log('Phase 2 → Tier 5 (LAST RESORT)' + (aiVariationsFn ? ' + Tier 4 (DETECTIVE)' : '') + ' in parallel');

        const tier5Url = this.buildTier5LastResortUrl({ query, date, champs });
        const tier5Promise = safeFetch(tier5Url, 'Tier 5 LAST RESORT');

        let tier4Promise = Promise.resolve(null);
        if (aiVariationsFn) {
            tier4Promise = (async () => {
                try {
                    const variations = await aiVariationsFn(query, code_postal);
                    if (variations?.length > 0) {
                        const url = this.buildTier4DetectiveUrl({ variations, code_postal, code_naf, date, champs });
                        const response = await safeFetch(url, 'Tier 4 DETECTIVE');
                        return { response, variations, url };
                    }
                    _log('Tier 4 DETECTIVE: AI returned no variations');
                } catch (err) {
                    _warn('Tier 4 DETECTIVE AI step failed:', err);
                }
                return null;
            })();
        }

        const [tier5Response, tier4Result] = await Promise.all([tier5Promise, tier4Promise]);

        if (tier4Result) {
            const tier4Results = tier4Result.response?.etablissements || [];
            let filtered = this.sortHeadquartersFirst(tier4Results);
            filtered = this.filterActiveOnly(filtered);
            _log(`Tier 4 DETECTIVE: ${filtered.length} active results (from ${tier4Results.length} raw)`);
            if (filtered.length > 0) {
                return {
                    tier: 4,
                    tierName: 'DETECTIVE',
                    results: filtered,
                    url: tier4Result.url,
                    variations: tier4Result.variations,
                    totalBeforeFilter: tier4Results.length
                };
            }
        }

        const tier5Results = tier5Response?.etablissements || [];
        let filtered = this.filterHeadquartersOnly(tier5Results).slice(0, 20);
        _log(`Tier 5 LAST RESORT: ${filtered.length} HQ results (from ${tier5Results.length} raw), total elapsed ${Date.now() - t0}ms`);

        return {
            tier: 5,
            tierName: 'LAST_RESORT',
            results: filtered,
            url: tier5Url,
            totalBeforeFilter: tier5Results.length
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // LEGACY MULTI-CRITERIA SEARCH (kept for backward compatibility)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Build URL for multi-criteria establishment (SIRET) search
     * Enhanced to search in both legal name AND brand names
     */
    buildSiretMultiCriteriaUrl(params) {
        const {
            query,
            address,
            code_postal,
            commune,
            siret,
            code_naf,
            nature_juridique,
            etat_administratif,
            tranche_effectif_salarie,
            nombre = 25,
            debut = 0,
            tri = null,
            curseur = null,
            date = null,
            champs = [],
            masquerValeursNulles = undefined,
            facetteChamp = undefined
        } = params;

        const queryParts = [];

        // Enhanced name search - searches in legal name AND brand names
        if (query) {
            queryParts.push(buildNameSearchQuery(query));
        }

        // SIRET filter with intelligent wildcard support
        if (siret) {
            const siretDigits = siret.replace(/\D/g, '');
            if (siretDigits.length === 14) {
                queryParts.push(`siret:${siretDigits}`);
            } else if (siretDigits.length === 9) {
                queryParts.push(`siret:${siretDigits}*`);
            } else if (siretDigits.length > 0) {
                queryParts.push(`siret:${siretDigits}*`);
            }
        }

        // Postal code filter (exact match)
        if (code_postal) {
            queryParts.push(`codePostalEtablissement:${code_postal}`);
        }

        // Commune/City filter
        if (commune) {
            const escapedCommune = escapeLucene(commune);
            const communeWords = escapedCommune.trim().split(/\s+/).filter(w => w.length > 0);
            if (communeWords.length === 1) {
                queryParts.push(`libelleCommuneEtablissement:${communeWords[0]}*`);
            } else {
                const communeQueries = communeWords.map(word => `libelleCommuneEtablissement:${word}*`);
                queryParts.push(`(${communeQueries.join(' AND ')})`);
            }
        }

        // Address search
        if (address) {
            const escapedAddress = escapeLucene(address);
            const addressWords = escapedAddress.trim().split(/\s+/).filter(w => w.length > 1);
            if (addressWords.length > 0) {
                const voieParts = addressWords.map((word) => `libelleVoieEtablissement:${word}*`);
                const complementParts = addressWords.map((word) => `complementAdresseEtablissement:${word}*`);
                queryParts.push(`((${voieParts.join(' AND ')}) OR (${complementParts.join(' AND ')}))`);
            }
        }

        // NAF code filter
        if (code_naf) {
            queryParts.push(`activitePrincipaleEtablissement:${code_naf}`);
        }

        if (nature_juridique) {
            queryParts.push(`categorieJuridiqueUniteLegale:${nature_juridique}`);
        }

        // Administrative status filter
        if (etat_administratif) {
            queryParts.push(`etatAdministratifEtablissement:${etat_administratif}`);
        }

        // Employee count range filter
        if (tranche_effectif_salarie) {
            queryParts.push(`trancheEffectifsEtablissement:${tranche_effectif_salarie}`);
        }

        const fullQuery = queryParts.join(' AND ');
        const urlParams = new URLSearchParams();
        if (fullQuery) urlParams.append('q', fullQuery);
        applySearchPaginationParams(urlParams, {
            nombre,
            debut,
            tri,
            curseur,
            date,
            champs,
            masquerValeursNulles,
            facetteChamp
        });

        const finalUrl = `${BASE_URL}/siret?${urlParams.toString()}`;
        _log('Multi-criteria q=', fullQuery);
        return finalUrl;
    },

    /**
     * Build URL for multi-criteria unité légale (SIREN) search
     */
    buildSirenMultiCriteriaUrl(params) {
        const {
            query,
            siren,
            code_naf,
            nature_juridique,
            etat_administratif,
            tranche_effectif_salarie,
            nombre = 25,
            debut = 0,
            tri = null,
            curseur = null,
            date = null,
            champs = []
        } = params;

        const queryParts = [];

        if (query) {
            const escapedQuery = escapeLucene(query);
            const words = escapedQuery.trim().split(/\s+/).filter(w => w.length > 1);
            const effectiveWords = words.length > 0 ? words : escapedQuery.trim().split(/\s+/).filter(w => w.length > 0).slice(0, 1);

            if (effectiveWords.length === 1) {
                const w = effectiveWords[0];
                queryParts.push(`(denominationUniteLegale:${w}* OR denominationUsuelle1UniteLegale:${w}*)`);
            } else if (effectiveWords.length > 1) {
                const fields = ['denominationUniteLegale', 'denominationUsuelle1UniteLegale'];
                const fieldQueries = fields.map(field => {
                    const wq = effectiveWords.map(word => `${field}:${word}*`);
                    return `(${wq.join(' AND ')})`;
                });
                queryParts.push(`(${fieldQueries.join(' OR ')})`);
            }
        }

        if (siren) {
            queryParts.push(`siren:${siren}`);
        }

        if (code_naf) {
            queryParts.push(`activitePrincipaleUniteLegale:${code_naf}`);
        }

        if (nature_juridique) {
            queryParts.push(`categorieJuridiqueUniteLegale:${nature_juridique}`);
        }

        if (etat_administratif) {
            queryParts.push(`etatAdministratifUniteLegale:${etat_administratif}`);
        }

        if (tranche_effectif_salarie) {
            queryParts.push(`trancheEffectifsUniteLegale:${tranche_effectif_salarie}`);
        }

        const fullQuery = queryParts.join(' AND ');
        const urlParams = new URLSearchParams();
        if (fullQuery) urlParams.append('q', fullQuery);
        applySearchPaginationParams(urlParams, { nombre, debut, tri, curseur, date, champs });

        return `${BASE_URL}/siren?${urlParams.toString()}`;
    },

    /**
     * Backward-compatible helper used by legacy tests and adapters.
     * Delegates to buildSiretMultiCriteriaUrl while mapping page/per_page.
     */
    buildNameSearchUrl(params = {}) {
        const page = Number.parseInt(String(params.page ?? 1), 10) || 1;
        const perPage = Number.parseInt(String(params.per_page ?? params.perPage ?? 25), 10) || 25;
        const debut = Math.max(0, (page - 1) * perPage);

        return this.buildSiretMultiCriteriaUrl({
            query: params.query,
            address: params.address,
            code_postal: params.code_postal,
            commune: params.commune,
            siret: params.siret,
            code_naf: params.code_naf,
            nature_juridique: params.nature_juridique,
            etat_administratif: params.etat_administratif,
            tranche_effectif_salarie: params.tranche_effectif_salarie,
            date: params.date,
            nombre: perPage,
            debut
        });
    },

    /**
     * Backward-compatible helper for direct ID lookup query creation.
     */
    buildIdSearchUrl(type, value, _params = {}) {
        if (String(type).toLowerCase() === 'siren') {
            return this.buildSirenLookupUrl(value);
        }
        return this.buildSiretLookupUrl(value);
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Utility functions exported for external use
     */
    utils: {
        escapeLucene,
        normalizeForComparison,
        strictNameMatch,
        resultMatchesStrictly,
        getDepartmentFromPostalCode,
        buildNameSearchQuery,
        normalizePaginationOptions,
        applySearchPaginationParams,
        normalizeInseeFieldName,
        normalizeChamps,
        normalizeDateParam
    }
};

export default queryBuilder;

