// Agent 3: Zustand store for global state management
import { create } from 'zustand';
import {
    createDefaultPagination,
    createInitialAdvancedFilters,
    createInitialSearchQuery
} from './initialState';

const useStore = create((set) => ({
    // State
    activeService: 'insee', // 'insee' | 'vat'
    activeTab: 'name',
    searchQuery: createInitialSearchQuery(),
    advancedFilters: createInitialAdvancedFilters(),
    results: [],
    totalResults: 0,
    pagination: createDefaultPagination(),
    loading: false,
    error: null,
    selectedCompany: null,
    serviceInfo: null,
    serviceInfoError: null,

    // Actions
    setActiveService: (service) => set({ 
        activeService: service,
        activeTab: service === 'insee' ? 'name' : 'id'
    }),
    setActiveTab: (tab) => set({ activeTab: tab }),

    setSearchQuery: (query) => set((state) => ({
        searchQuery: { ...state.searchQuery, ...query }
    })),

    setAdvancedFilters: (filters) => set((state) => ({
        advancedFilters: { ...state.advancedFilters, ...filters }
    })),

    setResults: (results, totalResults) => set({
        results,
        totalResults
    }),

    setPagination: (pagination) => set((state) => ({
        pagination: { ...state.pagination, ...pagination }
    })),

    setLoading: (loading) => set({ loading }),

    setError: (error) => set({ error }),

    setSelectedCompany: (company) => set({ selectedCompany: company }),

    setServiceInfo: (serviceInfo) => set({ serviceInfo, serviceInfoError: null }),

    setServiceInfoError: (serviceInfoError) => set({ serviceInfoError }),

    clearAll: () => set({
        searchQuery: createInitialSearchQuery(),
        advancedFilters: createInitialAdvancedFilters(),
        results: [],
        totalResults: 0,
        pagination: createDefaultPagination(),
        error: null,
        selectedCompany: null
    }),
}));

export default useStore;
