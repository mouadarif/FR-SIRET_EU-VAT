const INITIAL_SEARCH_QUERY = Object.freeze({
    nameQuery: '',
    siretQuery: '',
    sirenQuery: '',
    vatQuery: '',
    address: '',
    postalCode: '',
    city: '',
    siret: '',
});

const INITIAL_ADVANCED_FILTERS = Object.freeze({
    code_naf: '',
    etat_administratif: '',
    nature_juridique: '',
    tranche_effectif_salarie: '',
});

const INITIAL_RESULT_FILTERS = Object.freeze({
    nom_complet: '',
    adresse: '',
    code_postal: '',
    libelle_commune: '',
    etat_administratif: '',
    siret: ''
});

const DEFAULT_PAGINATION = Object.freeze({
    page: 1,
    perPage: 25,
});

export function createInitialSearchQuery() {
    return { ...INITIAL_SEARCH_QUERY };
}

export function createInitialAdvancedFilters() {
    return { ...INITIAL_ADVANCED_FILTERS };
}

export function createInitialResultFilters() {
    return { ...INITIAL_RESULT_FILTERS };
}

export function createDefaultPagination() {
    return { ...DEFAULT_PAGINATION };
}
