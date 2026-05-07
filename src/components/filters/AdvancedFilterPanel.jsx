import { useState } from 'react';
import './filters.css';

const ADVANCED_FILTERS_STORAGE_KEY = 'advancedFiltersExpanded';

const LEGAL_FORMS = {
    '5710': 'SAS (Societe par Actions Simplifiee)',
    '5498': 'SARL (Societe a Responsabilite Limitee)',
    '5499': 'SA (Societe Anonyme)',
    '5202': 'EURL (Entreprise Unipersonnelle)',
    '5306': 'SASU (Societe par Actions Simplifiee Unipersonnelle)',
};

const EMPLOYEE_RANGES = {
    '00': '0 salarie',
    '01': '1 a 2 salaries',
    '02': '3 a 5 salaries',
    '03': '6 a 9 salaries',
    '11': '10 a 19 salaries',
    '12': '20 a 49 salaries',
    '21': '50 a 99 salaries',
    '22': '100 a 249 salaries',
    '31': '250 a 499 salaries',
    '32': '500 salaries et plus',
};

function readInitialExpandedState() {
    try {
        const savedValue = window.localStorage.getItem(ADVANCED_FILTERS_STORAGE_KEY);
        return savedValue === null ? true : savedValue === 'true';
    } catch {
        return true;
    }
}

function saveExpandedState(isExpanded) {
    try {
        window.localStorage.setItem(ADVANCED_FILTERS_STORAGE_KEY, String(isExpanded));
    } catch {
        // Persisting this preference is optional.
    }
}

function onlyDigits(value) {
    return value.replace(/\D/g, '');
}

export default function AdvancedFilterPanel({ filters, onChange, isVisible }) {
    const [isExpanded, setIsExpanded] = useState(readInitialExpandedState);
    const panelId = 'advanced-filters-panel';

    if (!isVisible) return null;

    const activeFilterCount = Object.values(filters).filter((value) => value && value !== '').length;

    const handleFilterChange = (key, value) => {
        onChange({ [key]: value });
    };

    const toggleExpanded = () => {
        setIsExpanded((current) => {
            const next = !current;
            saveExpandedState(next);
            return next;
        });
    };

    return (
        <div className="advanced-filters">
            <button
                type="button"
                className="toggle-filters-btn"
                onClick={toggleExpanded}
                aria-expanded={isExpanded}
                aria-controls={panelId}
            >
                {isExpanded ? 'v' : '>'} Filtres avances
                {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
            </button>

            {isExpanded && (
                <div className="filters-content" id={panelId}>
                    <div className="filter-section">
                        <h4>Filtres d'identifiant</h4>
                        <div className="filter-row">
                            <div className="filter-field">
                                <label htmlFor="advanced-siret-filter">Filtrer par SIRET</label>
                                <input
                                    id="advanced-siret-filter"
                                    type="text"
                                    inputMode="numeric"
                                    value={filters.siret || ''}
                                    onChange={(e) => handleFilterChange('siret', onlyDigits(e.target.value).slice(0, 14))}
                                    placeholder="ex : 13001045700013"
                                    maxLength={14}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="filter-section">
                        <h4>Filtres d'activite</h4>
                        <div className="filter-row">
                            <div className="filter-field">
                                <label htmlFor="naf-code-filter">Code NAF</label>
                                <input
                                    id="naf-code-filter"
                                    type="text"
                                    value={filters.code_naf || ''}
                                    onChange={(e) => handleFilterChange('code_naf', e.target.value)}
                                    placeholder="ex : 56.10A"
                                    maxLength={6}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="filter-section">
                        <h4>Filtres juridiques et statut</h4>
                        <div className="filter-row">
                            <div className="filter-field">
                                <label htmlFor="legal-form-filter">Forme juridique</label>
                                <select
                                    id="legal-form-filter"
                                    value={filters.nature_juridique || ''}
                                    onChange={(e) => handleFilterChange('nature_juridique', e.target.value)}
                                >
                                    <option value="">Toutes</option>
                                    {Object.entries(LEGAL_FORMS).map(([code, label]) => (
                                        <option key={code} value={code}>{label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="filter-field">
                                <label htmlFor="employee-size-filter">Effectif salarie</label>
                                <select
                                    id="employee-size-filter"
                                    value={filters.tranche_effectif_salarie || ''}
                                    onChange={(e) => handleFilterChange('tranche_effectif_salarie', e.target.value)}
                                >
                                    <option value="">Tous</option>
                                    {Object.entries(EMPLOYEE_RANGES).map(([code, label]) => (
                                        <option key={code} value={code}>{label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="filter-row">
                            <fieldset className="filter-field filter-fieldset">
                                <legend>Etat administratif</legend>
                                <div className="radio-group">
                                    <label>
                                        <input
                                            type="radio"
                                            name="status"
                                            value=""
                                            checked={!filters.etat_administratif}
                                            onChange={() => handleFilterChange('etat_administratif', '')}
                                        />
                                        Tous
                                    </label>
                                    <label>
                                        <input
                                            type="radio"
                                            name="status"
                                            value="A"
                                            checked={filters.etat_administratif === 'A'}
                                            onChange={() => handleFilterChange('etat_administratif', 'A')}
                                        />
                                        Actifs uniquement
                                    </label>
                                    <label>
                                        <input
                                            type="radio"
                                            name="status"
                                            value="C"
                                            checked={filters.etat_administratif === 'C'}
                                            onChange={() => handleFilterChange('etat_administratif', 'C')}
                                        />
                                        Fermes uniquement
                                    </label>
                                </div>
                            </fieldset>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
