import { useEffect, useMemo, useState } from 'react';
import {
    buildAvailableColumns,
    DEFAULT_VISIBLE_COLUMN_KEYS
} from '../components/results/columnConfig';
import { createInitialResultFilters } from '../store/initialState';

export function applyResultFilters(results, filters) {
    return results.filter((company) => {
        const name = (company.nom_complet || company.nom_raison_sociale || '').toLowerCase();
        const address = (company.siege?.adresse || company.geo_adresse || '').toLowerCase();
        const postal = (company.code_postal || company.siege?.code_postal || '').toLowerCase();
        const city = (company.libelle_commune || company.siege?.libelle_commune || '').toLowerCase();
        const status = (company.etat_administratif || '').toLowerCase();
        const siret = (company.siret || '').toLowerCase();

        return (
            name.includes(filters.nom_complet.toLowerCase()) &&
            address.includes(filters.adresse.toLowerCase()) &&
            postal.includes(filters.code_postal.toLowerCase()) &&
            city.includes(filters.libelle_commune.toLowerCase()) &&
            status.includes(filters.etat_administratif.toLowerCase()) &&
            siret.includes(filters.siret.toLowerCase())
        );
    });
}

export function reconcileVisibleColumnKeys(availableColumns, currentKeys) {
    const availableKeys = new Set(availableColumns.map((column) => column.key));
    const preserved = currentKeys.filter((key) => availableKeys.has(key));

    if (preserved.length > 0) {
        return preserved;
    }

    return DEFAULT_VISIBLE_COLUMN_KEYS.filter((key) => availableKeys.has(key));
}

export default function useResultView(results) {
    const [resultFilters, setResultFilters] = useState(createInitialResultFilters);
    const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => [...DEFAULT_VISIBLE_COLUMN_KEYS]);

    const filteredResults = useMemo(
        () => applyResultFilters(results, resultFilters),
        [results, resultFilters]
    );

    const availableColumns = useMemo(() => buildAvailableColumns(results), [results]);

    useEffect(() => {
        setVisibleColumnKeys((currentKeys) => reconcileVisibleColumnKeys(availableColumns, currentKeys));
    }, [availableColumns]);

    const clearResultFilters = () => {
        setResultFilters(createInitialResultFilters());
    };

    return {
        resultFilters,
        setResultFilters,
        clearResultFilters,
        filteredResults,
        availableColumns,
        visibleColumnKeys,
        setVisibleColumnKeys
    };
}
