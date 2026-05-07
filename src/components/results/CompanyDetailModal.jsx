import { useEffect, useMemo, useRef, useState } from 'react';
import './results.css';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

function formatValue(value) {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if (Array.isArray(value)) return value.length ? value.map((item) => formatValue(item)).join(', ') : '-';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function flattenObject(value, prefix = '', rows = []) {
    if (value === null || value === undefined) {
        rows.push({ key: prefix, value: '-' });
        return rows;
    }

    if (typeof value !== 'object') {
        rows.push({ key: prefix, value: formatValue(value) });
        return rows;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            rows.push({ key: prefix, value: '-' });
            return rows;
        }
        value.forEach((item, index) => {
            flattenObject(item, `${prefix}[${index}]`, rows);
        });
        return rows;
    }

    const entries = Object.entries(value)
        .filter(([key]) => key !== '_raw')
        .sort(([a], [b]) => a.localeCompare(b));

    entries.forEach(([key, child]) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        if (typeof child === 'object' && child !== null) {
            flattenObject(child, nextPrefix, rows);
        } else {
            rows.push({ key: nextPrefix, value: formatValue(child) });
        }
    });

    return rows;
}

function firstPresent(...values) {
    return values.find((value) => value !== null && value !== undefined && value !== '') ?? '';
}

function getCompanySummary(company) {
    return {
        name: firstPresent(company.nom_complet, company.nom_raison_sociale, company.denomination),
        siret: firstPresent(company.siret, company.siret_etablissement),
        siren: firstPresent(company.siren, company.siren_unite_legale),
        city: firstPresent(company.libelle_commune, company.commune, company.ville),
        naf: firstPresent(company.activite_principale, company.code_naf, company.activite_principale_unite_legale),
        isActive: company.etat_administratif === 'A'
    };
}

export default function CompanyDetailModal({ company, isOpen, onClose }) {
    const [copiedKey, setCopiedKey] = useState('');
    const closeButtonRef = useRef(null);
    const modalContentRef = useRef(null);
    const openerRef = useRef(null);

    const flattenedRows = useMemo(() => {
        if (!company) return [];
        return flattenObject(company);
    }, [company]);

    const summary = useMemo(() => {
        if (!company) return null;
        return getCompanySummary(company);
    }, [company]);

    useEffect(() => {
        if (isOpen) {
            openerRef.current = document.activeElement;
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !company) {
            return undefined;
        }

        closeButtonRef.current?.focus();

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                onClose();
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const focusableElements = Array.from(modalContentRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || []);
            if (focusableElements.length === 0) {
                event.preventDefault();
                return;
            }

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (event.shiftKey && document.activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
                return;
            }

            if (!event.shiftKey && document.activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            openerRef.current?.focus?.();
        };
    }, [company, isOpen, onClose]);

    if (!isOpen || !company || !summary) return null;

    const copyToClipboard = async (value, key) => {
        try {
            await navigator.clipboard.writeText(String(value ?? ''));
            setCopiedKey(key);
            window.setTimeout(() => setCopiedKey(''), 1200);
        } catch {
            setCopiedKey('');
        }
    };

    const copyLabel = (key) => (copiedKey === key ? 'Copie' : 'Copier');

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                ref={modalContentRef}
                className="modal-content"
                role="dialog"
                aria-modal="true"
                aria-labelledby="company-detail-title"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2 id="company-detail-title">Details de l'entreprise</h2>
                    <button ref={closeButtonRef} type="button" className="modal-close" aria-label="Fermer les details" onClick={onClose}>x</button>
                </div>

                <div className="modal-body">
                    <section className="company-summary-card" aria-label="Resume entreprise">
                        <div className="company-summary-heading">
                            <div>
                                <h3>{formatValue(summary.name)}</h3>
                                <span className={`status-badge ${summary.isActive ? 'active' : 'closed'}`}>
                                    {summary.isActive ? 'Actif' : 'Ferme'}
                                </span>
                            </div>
                        </div>

                        <div className="summary-fields-grid">
                            <div className="summary-field">
                                <strong>SIRET</strong>
                                <span>{formatValue(summary.siret)}</span>
                            </div>
                            <div className="summary-field">
                                <strong>SIREN</strong>
                                <span>{formatValue(summary.siren)}</span>
                            </div>
                            <div className="summary-field">
                                <strong>Ville</strong>
                                <span>{formatValue(summary.city)}</span>
                            </div>
                            <div className="summary-field">
                                <strong>NAF</strong>
                                <span>{formatValue(summary.naf)}</span>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h4>Copie rapide</h4>
                        <div className="detail-row">
                            <strong>SIRET</strong>
                            <span>
                                {formatValue(summary.siret)}
                                <button type="button" onClick={() => copyToClipboard(summary.siret, 'quick-siret')}>
                                    {copyLabel('quick-siret')}
                                </button>
                            </span>
                        </div>
                        <div className="detail-row">
                            <strong>SIREN</strong>
                            <span>
                                {formatValue(summary.siren)}
                                <button type="button" onClick={() => copyToClipboard(summary.siren, 'quick-siren')}>
                                    {copyLabel('quick-siren')}
                                </button>
                            </span>
                        </div>
                    </section>

                    <details className="complete-details">
                        <summary>Details complets</summary>
                        <div className="all-fields-grid">
                            {flattenedRows.map((row) => (
                                <div className="all-fields-row" key={row.key}>
                                    <code>{row.key}</code>
                                    <span>{row.value}</span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(row.value, row.key)}
                                    >
                                        {copyLabel(row.key)}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </details>
                </div>

                <div className="modal-footer">
                    <button type="button" onClick={onClose}>Fermer</button>
                </div>
            </div>
        </div>
    );
}
