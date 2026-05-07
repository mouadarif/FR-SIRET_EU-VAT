import './search.css';

const SIRET_LENGTH = 14;
const SIREN_LENGTH = 9;
const VAT_MAX_LENGTH = 16;

const digitsOnly = (value) => value.replace(/\D/g, '');
const normalizeVat = (value) => value
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9+*]/g, '')
    .slice(0, VAT_MAX_LENGTH);

export default function IdSearchPanel({
    activeService,
    siretQuery,
    sirenQuery,
    vatQuery,
    onSiretChange,
    onSirenChange,
    onVatChange,
    onSearchSiret,
    onSearchSiren,
    onSearchVat,
}) {
    const siretValid = /^\d{14}$/.test(siretQuery);
    const sirenValid = /^\d{9}$/.test(sirenQuery);
    const vatValid = /^[A-Z]{2}[A-Z0-9+*]{2,14}$/.test(vatQuery);

    return (
        <div className="id-search-panel">
            {activeService === 'insee' && (
                <section className="lookup-group lookup-group-fr">
                    <div className="lookup-group-header">
                        <p className="lookup-group-tag">France - INSEE</p>
                        <h2>Identifiants du registre</h2>
                    </div>

                    <div className="id-row">
                        <div className="search-field id-field">
                            <label htmlFor="direct-siret-search">SIRET</label>
                            <div className="input-with-clear">
                                <input
                                    id="direct-siret-search"
                                    type="text"
                                    value={siretQuery}
                                    onChange={(e) => onSiretChange(digitsOnly(e.target.value).slice(0, SIRET_LENGTH))}
                                    placeholder="ex : 33358346602181"
                                    maxLength={SIRET_LENGTH}
                                    onKeyDown={(e) => e.key === 'Enter' && siretValid && onSearchSiret()}
                                />
                                {siretQuery && (
                                    <button type="button" className="clear-btn" aria-label="Effacer le champ SIRET" onClick={() => onSiretChange('')}>x</button>
                                )}
                            </div>
                            {siretValid && (
                                <span className="validation-message success">Valide</span>
                            )}
                            {siretQuery && !siretValid && (
                                <span className="validation-message error">
                                    {siretQuery.length}/{SIRET_LENGTH} chiffres
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={onSearchSiret}
                            disabled={!siretValid}
                            className="search-button search-button-fr"
                        >
                            Rechercher
                        </button>
                    </div>

                    <div className="id-row">
                        <div className="search-field id-field">
                            <label htmlFor="direct-siren-search">SIREN</label>
                            <div className="input-with-clear">
                                <input
                                    id="direct-siren-search"
                                    type="text"
                                    value={sirenQuery}
                                    onChange={(e) => onSirenChange(digitsOnly(e.target.value).slice(0, SIREN_LENGTH))}
                                    placeholder="ex : 333583466"
                                    maxLength={SIREN_LENGTH}
                                    onKeyDown={(e) => e.key === 'Enter' && sirenValid && onSearchSiren()}
                                />
                                {sirenQuery && (
                                    <button type="button" className="clear-btn" aria-label="Effacer le champ SIREN" onClick={() => onSirenChange('')}>x</button>
                                )}
                            </div>
                            {sirenValid && (
                                <span className="validation-message success">Valide</span>
                            )}
                            {sirenQuery && !sirenValid && (
                                <span className="validation-message error">
                                    {sirenQuery.length}/{SIREN_LENGTH} chiffres
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={onSearchSiren}
                            disabled={!sirenValid}
                            className="search-button search-button-fr"
                        >
                            Rechercher
                        </button>
                    </div>
                </section>
            )}

            {activeService === 'vat' && (
                <section className="lookup-group lookup-group-eu">
                    <div className="lookup-group-header">
                        <p className="lookup-group-tag">TVA / VIES</p>
                        <h2>Validation du numero TVA</h2>
                    </div>

                    <div className="id-row">
                        <div className="search-field id-field">
                            <label htmlFor="direct-vat-search">Numero TVA</label>
                            <div className="input-with-clear">
                                <input
                                    id="direct-vat-search"
                                    type="text"
                                    value={vatQuery}
                                    onChange={(e) => onVatChange(normalizeVat(e.target.value))}
                                    placeholder="ex : FR30334691813"
                                    maxLength={VAT_MAX_LENGTH}
                                    onKeyDown={(e) => e.key === 'Enter' && vatValid && onSearchVat()}
                                />
                                {vatQuery && (
                                    <button type="button" className="clear-btn" aria-label="Effacer le champ Numero TVA" onClick={() => onVatChange('')}>x</button>
                                )}
                            </div>

                            {vatQuery && !vatValid && (
                                <span className="validation-message error">
                                    Commencez par le code pays (FR, DE...)
                                </span>
                            )}
                            {vatValid && (
                                <span className="validation-message success">Format valide</span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={onSearchVat}
                            disabled={!vatValid}
                            className="search-button search-button-eu"
                        >
                            Valider
                        </button>
                    </div>
                </section>
            )}
        </div>
    );
}
