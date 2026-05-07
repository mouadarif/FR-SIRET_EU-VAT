import './filters.css';

const LEGAL_FORMS = {
    '5710': 'SAS',
    '5498': 'SARL',
    '5499': 'SA',
    '5202': 'EURL',
    '5306': 'SASU',
};

const EMPLOYEE_RANGES = {
    '00': '0 sal.',
    '01': '1-2 sal.',
    '02': '3-5 sal.',
    '03': '6-9 sal.',
    '11': '10-19 sal.',
    '12': '20-49 sal.',
    '21': '50-99 sal.',
    '22': '100-249 sal.',
    '31': '250-499 sal.',
    '32': '500+ sal.',
};

export default function ActiveFiltersDisplay({ filters, onRemove, onClearAll }) {
    const getFilterLabel = (key, value) => {
        const labels = {
            nameQuery: `Nom : "${value}"`,
            address: `Adresse : "${value}"`,
            postalCode: `Code postal : ${value}`,
            city: `Ville : ${value}`,
            siret: `SIRET : ${value}`,
            code_naf: `NAF : ${value}`,
            nature_juridique: `Forme : ${LEGAL_FORMS[value] || value}`,
            tranche_effectif_salarie: `Effectif : ${EMPLOYEE_RANGES[value] || value}`,
            etat_administratif: `${value === 'A' ? 'Actif' : 'Fermé'}`,
        };

        return labels[key] || `${key} : ${value}`;
    };

    const activeFilters = Object.entries(filters).filter(([, value]) => {
        if (typeof value === 'string') return value.length > 0;
        if (typeof value === 'boolean') return value === true;
        return false;
    });

    if (activeFilters.length === 0) return null;

    return (
        <div className="active-filters">
            <div className="filters-label">Filtres actifs :</div>
            <div className="filter-chips">
                {activeFilters.map(([key, value]) => {
                    const label = getFilterLabel(key, value);

                    return (
                        <div key={key} className="filter-chip">
                            <span>{label}</span>
                            <button type="button" aria-label={`Supprimer le filtre ${label}`} onClick={() => onRemove(key)}>×</button>
                        </div>
                    );
                })}
            </div>
            <button type="button" className="clear-all-btn" onClick={onClearAll}>
                Tout effacer
            </button>
        </div>
    );
}
