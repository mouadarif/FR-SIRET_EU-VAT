import { useMemo, useState } from 'react';
import {
    DEFAULT_VISIBLE_COLUMN_KEYS,
    getColumnDisplayValue,
    getColumnRawValue
} from './columnConfig';
import './results.css';

export default function ResultsTable({
    results,
    loading,
    error,
    onRowClick,
    availableColumns = [],
    visibleColumnKeys = DEFAULT_VISIBLE_COLUMN_KEYS,
    onVisibleColumnsChange
}) {
    const [sortColumn, setSortColumn] = useState(null);
    const [sortDirection, setSortDirection] = useState('asc');
    const [showColumnPicker, setShowColumnPicker] = useState(false);

    const selectedColumnKeys = visibleColumnKeys.length > 0
        ? visibleColumnKeys
        : DEFAULT_VISIBLE_COLUMN_KEYS;

    const columnsByKey = useMemo(() => {
        const map = new Map();
        availableColumns.forEach((column) => map.set(column.key, column));
        return map;
    }, [availableColumns]);

    const visibleColumns = selectedColumnKeys
        .map((key) => columnsByKey.get(key))
        .filter(Boolean);

    const handleSort = (column) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const sortedResults = sortColumn ? [...results].sort((a, b) => {
        const aVal = getColumnRawValue(a, sortColumn);
        const bVal = getColumnRawValue(b, sortColumn);

        if (aVal === bVal) return 0;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        const bothNumbers = typeof aVal === 'number' && typeof bVal === 'number';
        const comparison = bothNumbers
            ? (aVal - bVal)
            : String(aVal).localeCompare(String(bVal), undefined, { sensitivity: 'base' });

        return sortDirection === 'asc' ? comparison : -comparison;
    }) : results;

    const toggleColumn = (columnKey) => {
        if (!onVisibleColumnsChange) return;

        const isSelected = selectedColumnKeys.includes(columnKey);
        if (isSelected && selectedColumnKeys.length === 1) return;

        if (isSelected) {
            onVisibleColumnsChange(selectedColumnKeys.filter((key) => key !== columnKey));
            return;
        }

        onVisibleColumnsChange([...selectedColumnKeys, columnKey]);
    };

    const resetColumns = () => {
        if (!onVisibleColumnsChange) return;
        onVisibleColumnsChange(DEFAULT_VISIBLE_COLUMN_KEYS);
    };

    const renderCell = (company, columnKey) => {
        if (columnKey === 'etat_administratif') {
            const statusValue = getColumnRawValue(company, columnKey);
            const isActive = statusValue === 'A';
            const isClosed = statusValue === 'F' || statusValue === 'C';
            return (
                <span className={`status-badge ${isActive ? 'active' : 'closed'}`}>
                    {isActive ? 'Actif' : isClosed ? 'Fermé' : getColumnDisplayValue(company, columnKey)}
                </span>
            );
        }

        if (columnKey === 'siret') {
            return <span className="siret">{getColumnDisplayValue(company, columnKey)}</span>;
        }

        return getColumnDisplayValue(company, columnKey);
    };

    if (loading) {
        return <div className="loading">Chargement des résultats…</div>;
    }

    if (error) {
        return <div className="error-state">Erreur : {error}</div>;
    }

    if (results.length === 0) {
        return (
            <div className="empty-state">
                <h3>Aucun résultat</h3>
                <p>Aucune entreprise ne correspond à vos critères de recherche.</p>
                <div className="empty-state-suggestions">
                    <strong>Suggestions :</strong>
                    <ul>
                        <li>Utiliser des mots-clés différents ou moins nombreux</li>
                        <li>Vérifier l'orthographe</li>
                        <li>Supprimer les filtres géographiques (code postal, ville)</li>
                        <li>Rechercher uniquement par nom d'entreprise</li>
                        <li>Utiliser un nom partiel (ex. « CARREFOUR » au lieu de « CARREFOUR MARKET »)</li>
                    </ul>
                </div>
            </div>
        );
    }

    return (
        <div className="table-container">
            <div className="table-toolbar">
                <button
                    type="button"
                    className="columns-toggle-button"
                    onClick={() => setShowColumnPicker((open) => !open)}
                    aria-expanded={showColumnPicker}
                    aria-controls="results-column-picker"
                >
                    Colonnes - {visibleColumns.length}/{availableColumns.length}
                </button>
                {showColumnPicker && (
                    <div className="column-picker" id="results-column-picker">
                        <div className="column-picker-header">
                            <strong>Colonnes visibles</strong>
                            <button type="button" onClick={resetColumns}>Réinitialiser</button>
                        </div>
                        <div className="column-picker-grid">
                            {availableColumns.map((column) => (
                                <label key={column.key} className="column-picker-item">
                                    <input
                                        type="checkbox"
                                        checked={selectedColumnKeys.includes(column.key)}
                                        onChange={() => toggleColumn(column.key)}
                                    />
                                    <span>{column.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <table className="results-table">
                <thead>
                    <tr>
                        {visibleColumns.map((column) => (
                            <th
                                key={column.key}
                                aria-sort={
                                    column.sortable && sortColumn === column.key
                                        ? (sortDirection === 'asc' ? 'ascending' : 'descending')
                                        : 'none'
                                }
                            >
                                {column.sortable ? (
                                    <button
                                        type="button"
                                        className="sort-button"
                                        onClick={() => handleSort(column.key)}
                                    >
                                        <span>{column.label}</span>
                                        {sortColumn === column.key && (
                                            <span aria-hidden="true">{sortDirection === 'asc' ? ' ↑' : ' ↓'}</span>
                                        )}
                                    </button>
                                ) : (
                                    column.label
                                )}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sortedResults.map((company, idx) => (
                        <tr
                            key={company.siret || company.siren || idx}
                            tabIndex={0}
                            aria-label={`Ouvrir les détails de ${getColumnDisplayValue(company, 'nom_complet') || 'entreprise'}`}
                            onClick={() => onRowClick(company)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    onRowClick(company);
                                }
                            }}
                        >
                            {visibleColumns.map((column) => (
                                <td key={column.key}>{renderCell(company, column.key)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
