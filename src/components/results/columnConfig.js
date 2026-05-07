const BASE_RESULT_COLUMNS = [
    { key: 'nom_complet', label: 'Raison sociale', sortable: true, defaultVisible: true },
    { key: 'geo_adresse', label: 'Adresse', sortable: false, defaultVisible: true },
    { key: 'siret', label: 'SIRET', sortable: true, defaultVisible: true },
    { key: 'siren', label: 'SIREN', sortable: true, defaultVisible: false },
    { key: 'libelle_commune', label: 'Commune', sortable: true, defaultVisible: true },
    { key: 'code_postal', label: 'Code postal', sortable: true, defaultVisible: true },
    { key: 'etat_administratif', label: 'Statut', sortable: true, defaultVisible: true },
    { key: 'activite_principale', label: 'Activité', sortable: false, defaultVisible: false },
    { key: 'nature_juridique', label: 'Forme juridique', sortable: false, defaultVisible: false },
    { key: 'tranche_effectif_salarie', label: 'Effectif', sortable: false, defaultVisible: false },
    { key: 'date_creation', label: 'Date de création', sortable: true, defaultVisible: false },
    { key: 'enseigne', label: 'Enseigne', sortable: false, defaultVisible: false },
    { key: 'etablissement_siege', label: 'Siège', sortable: true, defaultVisible: false }
];

const BASE_COLUMN_KEYS = new Set(BASE_RESULT_COLUMNS.map((column) => column.key));

export const DEFAULT_VISIBLE_COLUMN_KEYS = BASE_RESULT_COLUMNS
    .filter((column) => column.defaultVisible)
    .map((column) => column.key);

function getPathValue(source, path) {
    if (!source || !path) return undefined;
    return path.split('.').reduce((current, segment) => {
        if (current == null) return undefined;
        return current[segment];
    }, source);
}

function toDisplayValue(value) {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if (Array.isArray(value)) return value.map((item) => toDisplayValue(item)).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function fromBaseField(company, key) {
    switch (key) {
    case 'nom_complet':
        return company.nom_complet || company.nom_raison_sociale || '';
    case 'geo_adresse':
        return company.siege?.adresse || company.geo_adresse || '';
    case 'libelle_commune':
        return company.libelle_commune || company.siege?.libelle_commune || '';
    case 'code_postal':
        return company.code_postal || company.siege?.code_postal || '';
    case 'etat_administratif':
        return company.etat_administratif || '';
    case 'tranche_effectif_salarie':
        return company.tranche_effectif_salarie_text || company.tranche_effectif_salarie || '';
    default:
        return company[key];
    }
}

export function getColumnRawValue(company, key) {
    if (!company || !key) return undefined;
    if (BASE_COLUMN_KEYS.has(key)) return fromBaseField(company, key);
    return getPathValue(company, key);
}

export function getColumnDisplayValue(company, key) {
    if (key === 'etat_administratif') {
        const value = getColumnRawValue(company, key);
        if (value === 'A') return 'Actif';
        if (value === 'F' || value === 'C') return 'Fermé';
        return toDisplayValue(value);
    }
    return toDisplayValue(getColumnRawValue(company, key));
}

function flattenPaths(value, prefix = '', out = new Set()) {
    if (value === null || value === undefined) return out;
    if (typeof value !== 'object') return out;

    Object.entries(value).forEach(([key, child]) => {
        if (key === '_raw') return;
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
            flattenPaths(child, path, out);
            return;
        }
        out.add(path);
    });

    return out;
}

function formatDynamicLabel(path) {
    return path
        .split('.')
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' / ');
}

export function buildAvailableColumns(results = []) {
    const columns = [...BASE_RESULT_COLUMNS];
    const dynamicPaths = new Set();

    results.slice(0, 100).forEach((company) => {
        flattenPaths(company, '', dynamicPaths);
    });

    [...dynamicPaths]
        .filter((path) => !BASE_COLUMN_KEYS.has(path))
        .sort((a, b) => a.localeCompare(b))
        .forEach((path) => {
            columns.push({
                key: path,
                label: formatDynamicLabel(path),
                sortable: true,
                defaultVisible: false
            });
        });

    return columns;
}
