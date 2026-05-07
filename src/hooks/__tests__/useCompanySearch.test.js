import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/inseeApiClient';
import useCompanySearch, { runCompanySearch } from '../useCompanySearch';

describe('runCompanySearch', () => {
    it('returns a validation error before calling the client for short name searches', async () => {
        const client = {
            searchByName: vi.fn()
        };

        const outcome = await runCompanySearch({
            searchType: 'name',
            searchQuery: {
                nameQuery: 'ab',
                address: '',
                postalCode: '',
                city: '',
                siret: ''
            },
            advancedFilters: {},
            pagination: { page: 1, perPage: 25 },
            client
        });

        expect(outcome).toEqual({
            success: false,
            didSearch: false,
            errorMessage: 'Veuillez saisir au moins 3 caractères pour le nom de l\'entreprise',
            results: [],
            totalResults: 0
        });
        expect(client.searchByName).not.toHaveBeenCalled();
    });

    it('normalizes successful name searches', async () => {
        const client = {
            searchByName: vi.fn().mockResolvedValue({
                success: true,
                data: {
                    results: [{ siret: '123' }],
                    total_results: 1
                }
            })
        };

        const outcome = await runCompanySearch({
            searchType: 'name',
            searchQuery: {
                nameQuery: 'carrefour',
                address: '1 rue test',
                postalCode: '75001',
                city: 'Paris',
                siret: ''
            },
            advancedFilters: { etat_administratif: 'A' },
            pagination: { page: 2, perPage: 10 },
            client
        });

        expect(client.searchByName).toHaveBeenCalledWith({
            nameQuery: 'carrefour',
            address: '1 rue test',
            postalCode: '75001',
            city: 'Paris',
            siret: '',
            filters: { etat_administratif: 'A' },
            page: 2,
            perPage: 10
        });
        expect(outcome).toEqual({
            success: true,
            didSearch: true,
            errorMessage: null,
            results: [{ siret: '123' }],
            totalResults: 1
        });
    });

    it('normalizes API failures from exact searches', async () => {
        const client = {
            searchBySIRET: vi.fn().mockResolvedValue({
                success: false,
                error: { userMessage: 'No company found with SIRET 123.' }
            })
        };

        const outcome = await runCompanySearch({
            searchType: 'siret',
            searchQuery: { siretQuery: '123' },
            advancedFilters: {},
            pagination: { page: 1, perPage: 25 },
            client
        });

        expect(outcome).toEqual({
            success: false,
            didSearch: true,
            errorMessage: 'No company found with SIRET 123.',
            results: [],
            totalResults: 0
        });
    });

    it('returns a generic message when the client throws unexpectedly', async () => {
        const client = {
            searchBySIREN: vi.fn().mockRejectedValue(new Error('network down'))
        };

        const outcome = await runCompanySearch({
            searchType: 'siren',
            searchQuery: { sirenQuery: '552100554' },
            advancedFilters: {},
            pagination: { page: 1, perPage: 25 },
            client
        });

        expect(outcome).toEqual({
            success: false,
            didSearch: true,
            errorMessage: 'Une erreur inattendue est survenue. Veuillez réessayer.',
            results: [],
            totalResults: 0
        });
    });

    it('normalizes successful VAT searches', async () => {
        const client = {
            searchByVAT: vi.fn().mockResolvedValue({
                success: true,
                data: {
                    results: [{ vat_number: '30334691813', country_code: 'FR' }],
                    total_results: 1
                }
            })
        };

        const outcome = await runCompanySearch({
            searchType: 'vat',
            searchQuery: { vatQuery: 'FR30334691813' },
            advancedFilters: {},
            pagination: { page: 1, perPage: 25 },
            client
        });

        expect(client.searchByVAT).toHaveBeenCalledWith({ vatNumber: 'FR30334691813' });
        expect(outcome).toEqual({
            success: true,
            didSearch: true,
            errorMessage: null,
            results: [{ vat_number: '30334691813', country_code: 'FR' }],
            totalResults: 1
        });
    });
});

describe('useCompanySearch', () => {
    it('tracks the last successful search type and resets it', async () => {
        const searchByName = vi.spyOn(apiClient, 'searchByName').mockResolvedValue({
            success: true,
            data: {
                results: [{ siret: '123' }],
                total_results: 42
            }
        });
        const setLoading = vi.fn();
        const setError = vi.fn();
        const setResults = vi.fn();

        const { result } = renderHook(() => useCompanySearch({
            searchQuery: {
                nameQuery: 'carrefour',
                address: '',
                postalCode: '75001',
                city: 'Paris',
                siret: ''
            },
            advancedFilters: {},
            pagination: { page: 3, perPage: 25 },
            setLoading,
            setError,
            setResults
        }));

        await act(async () => {
            await result.current.handleSearch('name', {
                pagination: { page: 1, perPage: 50 }
            });
        });

        expect(searchByName).toHaveBeenCalledWith({
            nameQuery: 'carrefour',
            address: '',
            postalCode: '75001',
            city: 'Paris',
            siret: '',
            filters: {},
            page: 1,
            perPage: 50
        });
        expect(setResults).toHaveBeenCalledWith([{ siret: '123' }], 42);
        expect(result.current.searchPerformed).toBe(true);
        expect(result.current.lastSearchType).toBe('name');

        act(() => {
            result.current.resetSearchState();
        });

        expect(result.current.searchPerformed).toBe(false);
        expect(result.current.lastSearchType).toBe(null);
    });
});
