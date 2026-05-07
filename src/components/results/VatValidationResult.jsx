import './results.css';

function formatRequestDate(value) {
    if (!value) return 'Non disponible';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleString('fr-FR');
}

function renderAddressLines(address) {
    if (!address) return ['Adresse non disponible'];
    return String(address)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function firstPresent(...values) {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const normalized = String(value).trim();
        if (normalized) return normalized;
    }

    return null;
}

function getLegalName(result) {
    return firstPresent(
        result.legal_name,
        result.nom_complet,
        result.nom_raison_sociale,
        result.name,
        result.traderName,
        result._raw?.legalName,
        result._raw?.legal_name,
        result._raw?.name,
        result._raw?.traderName,
        result._raw?.trader?.name,
        'Nom indisponible'
    );
}

function getRegisteredAddress(result) {
    return firstPresent(
        result.registered_address,
        result.geo_adresse,
        result.address,
        result.traderAddress,
        result._raw?.registeredAddress,
        result._raw?.registered_address,
        result._raw?.address,
        result._raw?.traderAddress,
        result._raw?.trader?.address
    );
}

function getVatNumber(result) {
    const countryCode = firstPresent(result.country_code, result.countryCode, result._raw?.countryCode) || '';
    const vatNumber = firstPresent(result.vat_number, result.vatNumber, result._raw?.vatNumber, result._raw?.vat_number) || '';
    if (!countryCode) return vatNumber || firstPresent(result.original_vat_number, result._raw?.originalVatNumber) || '';
    if (vatNumber.toUpperCase().startsWith(countryCode.toUpperCase())) return vatNumber;
    return `${countryCode}${vatNumber}`;
}

function getOriginalVatNumber(result, displayVat) {
    return firstPresent(
        result.original_vat_number,
        result.originalVatNumber,
        result._raw?.originalVatNumber,
        result._raw?.original_vat_number,
        displayVat
    );
}

export default function VatValidationResult({ results, loading, error }) {
    if (loading) {
        return <div className="loading">Validation en cours…</div>;
    }

    if (error) {
        return <div className="error-state">Erreur : {error}</div>;
    }

    if (!results || results.length === 0) {
        return (
            <div className="empty-state">
                <h3>Aucun résultat TVA</h3>
                <p>Saisissez un numéro TVA UE dans l'onglet Identifiants.</p>
            </div>
        );
    }

    return (
        <div className="vat-result-grid">
            {results.map((result) => {
                const statusClass = result.is_valid ? 'valid' : 'invalid';
                const legalName = getLegalName(result);
                const registeredAddress = getRegisteredAddress(result);
                const displayVat = getVatNumber(result);
                const originalVatNumber = getOriginalVatNumber(result, displayVat);
                const addressLines = renderAddressLines(registeredAddress);

                return (
                    <article
                        key={displayVat || `${result.country_code}-${result.vat_number}`}
                        className={`vat-result-card ${statusClass}`}
                        aria-labelledby={`vat-result-title-${displayVat}`}
                    >
                        <div className="vat-result-header">
                            <div>
                                <p className="vat-result-eyebrow">TVA / VIES</p>
                                <h3 id={`vat-result-title-${displayVat}`}>
                                    {legalName}
                                </h3>
                            </div>
                            <span className={`vat-status-pill ${statusClass}`}>
                                {result.is_valid ? 'Valide' : 'Invalide'}
                            </span>
                        </div>

                        <div className="vat-result-meta">
                            <div className="vat-meta-card">
                                <span className="vat-meta-label">Numéro TVA</span>
                                <strong className="vat-meta-value">{displayVat || 'Non disponible'}</strong>
                            </div>
                            <div className="vat-meta-card">
                                <span className="vat-meta-label">Raison sociale VIES</span>
                                <strong>{legalName}</strong>
                            </div>
                            <div className="vat-meta-card">
                                <span className="vat-meta-label">Statut VIES</span>
                                <strong>{result.validation_status || 'Inconnu'}</strong>
                            </div>
                            <div className="vat-meta-card">
                                <span className="vat-meta-label">Date de requête</span>
                                <strong>{formatRequestDate(result.request_date)}</strong>
                            </div>
                        </div>

                        <div className="vat-result-body">
                            <section className="vat-result-section">
                                <h4>Adresse enregistrée</h4>
                                <address>
                                    {addressLines.map((line) => (
                                        <span key={line}>{line}</span>
                                    ))}
                                </address>
                            </section>

                            <section className="vat-result-section">
                                <h4>Référence</h4>
                                <dl className="vat-result-definition-list">
                                    <div>
                                        <dt>Numéro d'origine</dt>
                                        <dd>{originalVatNumber}</dd>
                                    </div>
                                    <div>
                                        <dt>Identifiant de requête</dt>
                                        <dd>{result.request_identifier || 'Non fourni'}</dd>
                                    </div>
                                </dl>
                            </section>
                        </div>
                    </article>
                );
            })}
        </div>
    );
}
