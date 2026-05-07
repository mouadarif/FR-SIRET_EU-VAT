import { validateName } from '../../utils/validation.js';
import './search.css';

export default function NameLocationSearchPanel({
    nameQuery, onNameChange,
    address, onAddressChange,
    postalCode, onPostalCodeChange,
    city, onCityChange,
    onSearch
}) {
    const nameValidation = validateName(nameQuery);
    const canSearch = nameValidation.valid;

    return (
        <div className="name-search-panel">
            <div className="search-panel-intro">
                <p className="lookup-group-tag">France - INSEE</p>
                <h2>Recherche par nom</h2>
            </div>

            <div className="search-field">
                <label htmlFor="company-name-search">Nom de l'entreprise <span className="required-mark" aria-hidden="true">*</span></label>
                <div className="input-with-clear">
                    <input
                        id="company-name-search"
                        type="text"
                        value={nameQuery}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="ex : Carrefour"
                        minLength={3}
                        required
                        onKeyDown={(e) => e.key === 'Enter' && canSearch && onSearch()}
                    />
                    {nameQuery && (
                        <button type="button" className="clear-btn" aria-label="Effacer le champ Nom de l'entreprise" onClick={() => onNameChange('')}>x</button>
                    )}
                </div>
                {nameQuery && (
                    <span className={`validation-message ${nameValidation.valid ? 'success' : 'warning'}`}>
                        {nameValidation.message}
                    </span>
                )}
            </div>

            <div className="search-field">
                <label htmlFor="company-address-search">Adresse</label>
                <div className="input-with-clear">
                    <input
                        id="company-address-search"
                        type="text"
                        value={address}
                        onChange={(e) => onAddressChange(e.target.value)}
                        placeholder="ex : Rue de Rivoli"
                    />
                    {address && (
                        <button type="button" className="clear-btn" aria-label="Effacer le champ Adresse" onClick={() => onAddressChange('')}>x</button>
                    )}
                </div>
            </div>

            <div className="location-fields">
                <div className="search-field">
                    <label htmlFor="company-postal-code-search">Code postal</label>
                    <div className="input-with-clear">
                        <input
                            id="company-postal-code-search"
                            type="text"
                            value={postalCode}
                            onChange={(e) => onPostalCodeChange(e.target.value)}
                            placeholder="ex : 75001"
                            maxLength={5}
                        />
                        {postalCode && (
                            <button type="button" className="clear-btn" aria-label="Effacer le champ Code postal" onClick={() => onPostalCodeChange('')}>x</button>
                        )}
                    </div>
                </div>

                <div className="search-field">
                    <label htmlFor="company-city-search">Ville</label>
                    <div className="input-with-clear">
                        <input
                            id="company-city-search"
                            type="text"
                            value={city}
                            onChange={(e) => onCityChange(e.target.value)}
                            placeholder="ex : Paris"
                        />
                        {city && (
                            <button type="button" className="clear-btn" aria-label="Effacer le champ Ville" onClick={() => onCityChange('')}>x</button>
                        )}
                    </div>
                </div>
            </div>

            <button
                type="button"
                onClick={onSearch}
                disabled={!canSearch}
                className="search-button search-button-fr"
                aria-describedby={!canSearch ? 'name-search-disabled-hint' : undefined}
            >
                Rechercher
            </button>
            {!canSearch && (
                <span className="search-disabled-hint" id="name-search-disabled-hint">
                    Saisissez au moins 3 caracteres pour rechercher.
                </span>
            )}
        </div>
    );
}
