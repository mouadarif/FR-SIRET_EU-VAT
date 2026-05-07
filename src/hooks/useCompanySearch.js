import { useState } from 'react';
import apiClient from '../api/inseeApiClient';
import viesApiClient from '../api/viesApiClient';

const GENERIC_SEARCH_ERROR = 'Une erreur inattendue est survenue. Veuillez réessayer.';
const NAME_VALIDATION_ERROR = 'Veuillez saisir au moins 3 caractères pour le nom de l\'entreprise';

const defaultClient = {
    searchBySIRET: (...args) => apiClient.searchBySIRET(...args),
    searchBySIREN: (...args) => apiClient.searchBySIREN(...args),
    searchByName: (...args) => apiClient.searchByName(...args),
    searchByVAT: (...args) => viesApiClient.searchByVAT(...args)
};

export async function runCompanySearch({
    searchType,
    searchQuery,
    advancedFilters,
    pagination,
    client = defaultClient
}) {
    try {
        if (searchType === 'siret') {
            const response = await client.searchBySIRET(searchQuery.siretQuery);
            return normalizeSearchResponse(response);
        }

        if (searchType === 'siren') {
            const response = await client.searchBySIREN(searchQuery.sirenQuery);
            return normalizeSearchResponse(response);
        }

        if (searchType === 'vat') {
            const response = await client.searchByVAT({ vatNumber: searchQuery.vatQuery });
            return normalizeSearchResponse(response);
        }

        const { nameQuery, address, postalCode, city } = searchQuery;
        const siret = advancedFilters.siret || searchQuery.siret;

        if (nameQuery.length < 3) {
            return {
                success: false,
                didSearch: false,
                errorMessage: NAME_VALIDATION_ERROR,
                results: [],
                totalResults: 0
            };
        }

        const response = await client.searchByName({
            nameQuery,
            address,
            postalCode,
            city,
            siret,
            filters: advancedFilters,
            page: pagination.page,
            perPage: pagination.perPage
        });

        return normalizeSearchResponse(response);
    } catch {
        return {
            success: false,
            didSearch: true,
            errorMessage: GENERIC_SEARCH_ERROR,
            results: [],
            totalResults: 0
        };
    }
}

function normalizeSearchResponse(response) {
    if (response?.success) {
        return {
            success: true,
            didSearch: true,
            errorMessage: null,
            results: response.data?.results || [],
            totalResults: response.data?.total_results || 0
        };
    }

    return {
        success: false,
        didSearch: true,
        errorMessage: response?.error?.userMessage || GENERIC_SEARCH_ERROR,
        results: [],
        totalResults: 0
    };
}

export default function useCompanySearch({
    searchQuery,
    advancedFilters,
    pagination,
    setLoading,
    setError,
    setResults
}) {
    const [searchPerformed, setSearchPerformed] = useState(false);
    const [lastSearchType, setLastSearchType] = useState(null);

    const resetSearchState = () => {
        setSearchPerformed(false);
        setLastSearchType(null);
    };

    const handleSearch = async (searchType, options = {}) => {
        const effectivePagination = options.pagination || pagination;
        setLoading(true);
        setError(null);

        try {
            const outcome = await runCompanySearch({
                searchType,
                searchQuery,
                advancedFilters,
                pagination: effectivePagination
            });

            if (outcome.success) {
                setResults(outcome.results, outcome.totalResults);
                setSearchPerformed(true);
                setLastSearchType(searchType);
                return;
            }

            setError(outcome.errorMessage);
            setResults([], 0);

            if (outcome.didSearch) {
                setSearchPerformed(true);
                setLastSearchType(searchType);
            }
        } finally {
            setLoading(false);
        }
    };

    return {
        searchPerformed,
        lastSearchType,
        resetSearchState,
        handleSearch
    };
}
