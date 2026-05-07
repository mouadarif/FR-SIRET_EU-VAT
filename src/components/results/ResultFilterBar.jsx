import './results.css';

export default function ResultFilterBar({ filters, onChange, onClear, resultCount, totalCount }) {
    const hasActiveFilters = Object.values(filters).some((value) => value !== '');

    const handleChange = (key, value) => {
        onChange({
            ...filters,
            [key]: value
        });
    };

    return (
        <div className="result-filter-bar">
            <div className="filter-bar-header">
                <div className="filter-stats">
                    <span className="icon" aria-hidden="true">🔍</span>
                    <span className="text">
                        Affiner les résultats
                        {hasActiveFilters && <span className="count-badge">{resultCount} sur {totalCount} affichés</span>}
                    </span>
                </div>
                {hasActiveFilters && (
                    <button type="button" className="clear-filters-btn" onClick={onClear}>
                        Effacer les filtres
                    </button>
                )}
            </div>

            <div className="filter-grid">
                <div className="filter-item">
                    <label htmlFor="result-filter-name">Filtrer par nom d'entreprise</label>
                    <input
                        id="result-filter-name"
                        type="text"
                        placeholder="Filtrer par nom…"
                        value={filters.nom_complet}
                        onChange={(e) => handleChange('nom_complet', e.target.value)}
                    />
                </div>
                <div className="filter-item">
                    <label htmlFor="result-filter-address">Filtrer par adresse</label>
                    <input
                        id="result-filter-address"
                        type="text"
                        placeholder="Filtrer par adresse…"
                        value={filters.adresse}
                        onChange={(e) => handleChange('adresse', e.target.value)}
                    />
                </div>
                <div className="filter-item">
                    <label htmlFor="result-filter-siret">Filtrer par SIRET</label>
                    <input
                        id="result-filter-siret"
                        type="text"
                        placeholder="Filtrer par SIRET…"
                        value={filters.siret}
                        onChange={(e) => handleChange('siret', e.target.value)}
                    />
                </div>
                <div className="filter-item">
                    <label htmlFor="result-filter-city">Filtrer par ville</label>
                    <input
                        id="result-filter-city"
                        type="text"
                        placeholder="Filtrer par ville…"
                        value={filters.libelle_commune}
                        onChange={(e) => handleChange('libelle_commune', e.target.value)}
                    />
                </div>
                <div className="filter-item mobile-half">
                    <label htmlFor="result-filter-postal">Filtrer par code postal</label>
                    <input
                        id="result-filter-postal"
                        type="text"
                        placeholder="Code postal…"
                        value={filters.code_postal}
                        onChange={(e) => handleChange('code_postal', e.target.value)}
                    />
                </div>
                <div className="filter-item mobile-half">
                    <label htmlFor="result-filter-status">Filtrer par état administratif</label>
                    <select
                        id="result-filter-status"
                        value={filters.etat_administratif}
                        onChange={(e) => handleChange('etat_administratif', e.target.value)}
                    >
                        <option value="">Tous les statuts</option>
                        <option value="a">Actif</option>
                        <option value="c">Fermé</option>
                    </select>
                </div>
            </div>
        </div>
    );
}
