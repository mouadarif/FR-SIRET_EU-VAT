// Coordinator: Main App Component
import { useEffect } from 'react';
import useStore from './store/store';

// Agent 1 components
import TabNavigation from './components/search/TabNavigation';
import IdSearchPanel from './components/search/IdSearchPanel';
import NameLocationSearchPanel from './components/search/NameLocationSearchPanel';

// Agent 2 components
import ResultsTable from './components/results/ResultsTable';
import ResultFilterBar from './components/results/ResultFilterBar';
import CompanyDetailModal from './components/results/CompanyDetailModal';
import Pagination from './components/results/Pagination';
import ExportButton from './components/results/ExportButton';
import VatValidationResult from './components/results/VatValidationResult';

// Agent 3 components
import AdvancedFilterPanel from './components/filters/AdvancedFilterPanel';
import ActiveFiltersDisplay from './components/filters/ActiveFiltersDisplay';

// Batch workflows
import BatchWorkspace from './components/batch/BatchWorkspace';
import useCompanySearch from './hooks/useCompanySearch';
import useResultView from './hooks/useResultView';
import useServiceInfo from './hooks/useServiceInfo';

import './App.css';

function App() {
    const {
        activeService,
        setActiveService,
        activeTab,
        setActiveTab,
        searchQuery,
        setSearchQuery,
        advancedFilters,
        setAdvancedFilters,
        results,
        totalResults,
        setResults,
        pagination,
        setPagination,
        loading,
        setLoading,
        error,
        setError,
        selectedCompany,
        setSelectedCompany,
        serviceInfo,
        serviceInfoError,
        setServiceInfo,
        setServiceInfoError,
        clearAll
    } = useStore();

    const {
        searchPerformed,
        lastSearchType,
        resetSearchState,
        handleSearch
    } = useCompanySearch({
        searchQuery,
        advancedFilters,
        pagination,
        setLoading,
        setError,
        setResults
    });

    const {
        resultFilters,
        setResultFilters,
        clearResultFilters,
        filteredResults,
        availableColumns,
        visibleColumnKeys,
        setVisibleColumnKeys
    } = useResultView(results);

    useServiceInfo({ setServiceInfo, setServiceInfoError });

    const runSearchFromFirstPage = (searchType) => {
        const nextPagination = { ...pagination, page: 1 };
        setPagination({ page: 1 });
        return handleSearch(searchType, { pagination: nextPagination });
    };

    const handlePaginationChange = (nextPage) => {
        setPagination({ page: nextPage });

        if (lastSearchType !== 'name') {
            return;
        }

        void handleSearch('name', {
            pagination: {
                ...pagination,
                page: nextPage
            }
        });
    };

    const handlePerPageChange = (nextPerPage) => {
        const nextPagination = {
            page: 1,
            perPage: nextPerPage
        };

        setPagination(nextPagination);

        if (lastSearchType !== 'name') {
            return;
        }

        void handleSearch('name', { pagination: nextPagination });
    };

    const handleTabChange = (newTab) => {
        setActiveTab(newTab);
        resetSearchState();
        clearAll();
    };

    const handleRemoveActiveFilter = (key) => {
        if (key === 'nameQuery' || key === 'address' || key === 'postalCode' || key === 'city') {
            setSearchQuery({ [key]: '' });
            return;
        }

        setAdvancedFilters({ [key]: '' });
    };

    const isClientPaginatedResultSet = lastSearchType === 'siren';
    const currentPageStart = Math.max(0, (pagination.page - 1) * pagination.perPage);
    const displayedResults = isClientPaginatedResultSet
        ? filteredResults.slice(currentPageStart, currentPageStart + pagination.perPage)
        : filteredResults;
    const paginationTotalResults = lastSearchType === 'name'
        ? totalResults
        : filteredResults.length;

    useEffect(() => {
        if (!isClientPaginatedResultSet) {
            return;
        }

        const maxPage = Math.max(1, Math.ceil(filteredResults.length / pagination.perPage));
        if (pagination.page > maxPage) {
            setPagination({ page: maxPage });
        }
    }, [filteredResults.length, isClientPaginatedResultSet, pagination.page, pagination.perPage, setPagination]);

    return (
        <div className="app-container">
            <header className="app-header">
                <div className="service-switcher" role="group" aria-label="Selection du service">
                    <button 
                        type="button"
                        className={`service-switcher-button ${activeService === 'insee' ? 'active' : ''}`}
                        onClick={() => setActiveService('insee')}
                        aria-pressed={activeService === 'insee'}
                    >
                        <span className="service-switcher-code" aria-hidden="true">FR</span>
                        <span className="service-switcher-copy">
                            <strong>INSEE SIRET</strong>
                            <small>Recherche entreprise France</small>
                        </span>
                    </button>

                    <button 
                        type="button"
                        className={`service-switcher-button ${activeService === 'vat' ? 'active' : ''}`}
                        onClick={() => setActiveService('vat')}
                        aria-pressed={activeService === 'vat'}
                        aria-label="TVA VAT Verification"
                    >
                        <span className="service-switcher-code" aria-hidden="true">TVA</span>
                        <span className="service-switcher-copy">
                            <strong>TVA / VAT Verification</strong>
                            <small>Nom legal, TVA et adresse</small>
                        </span>
                    </button>
                </div>

                <div className="app-header-content">
                    <div className="app-heading">
                        <h1>Registre</h1>
                    </div>

                    {activeService === 'insee' && serviceInfo && (
                        <p className="service-info" aria-live="polite">
                            INSEE {serviceInfo.serviceState} · v{serviceInfo.version || 'n/a'} · {serviceInfo.freshnessDate || 'n/a'}
                        </p>
                    )}
                    {activeService === 'insee' && !serviceInfo && serviceInfoError && (
                        <p className="service-info" role="status" aria-live="polite">
                            Statut INSEE indisponible
                        </p>
                    )}
                </div>
            </header>

            <TabNavigation
                activeService={activeService}
                activeTab={activeTab}
                onTabChange={handleTabChange}
            />

            <div className="search-section">
                {activeTab === 'batch' ? (
                    <BatchWorkspace activeService={activeService} />
                ) : activeTab === 'id' ? (
                    <IdSearchPanel
                        activeService={activeService}
                        siretQuery={searchQuery.siretQuery}
                        sirenQuery={searchQuery.sirenQuery}
                        vatQuery={searchQuery.vatQuery}
                        onSiretChange={(v) => setSearchQuery({ siretQuery: v })}
                        onSirenChange={(v) => setSearchQuery({ sirenQuery: v })}
                        onVatChange={(v) => setSearchQuery({ vatQuery: v })}
                        onSearchSiret={() => runSearchFromFirstPage('siret')}
                        onSearchSiren={() => runSearchFromFirstPage('siren')}
                        onSearchVat={() => runSearchFromFirstPage('vat')}
                    />
                ) : (
                    <>
                        <NameLocationSearchPanel
                            nameQuery={searchQuery.nameQuery}
                            onNameChange={(value) => setSearchQuery({ nameQuery: value })}
                            address={searchQuery.address}
                            onAddressChange={(value) => setSearchQuery({ address: value })}
                            postalCode={searchQuery.postalCode}
                            onPostalCodeChange={(value) => setSearchQuery({ postalCode: value })}
                            city={searchQuery.city}
                            onCityChange={(value) => setSearchQuery({ city: value })}
                            onSearch={() => runSearchFromFirstPage('name')}
                        />

                        <AdvancedFilterPanel
                            filters={advancedFilters}
                            onChange={(newFilters) => setAdvancedFilters(newFilters)}
                            isVisible={true}
                        />

                        <ActiveFiltersDisplay
                            filters={{
                                nameQuery: searchQuery.nameQuery,
                                address: searchQuery.address,
                                postalCode: searchQuery.postalCode,
                                city: searchQuery.city,
                                ...advancedFilters
                            }}
                            onRemove={handleRemoveActiveFilter}
                            onClearAll={clearAll}
                        />
                    </>
                )}
            </div>

            {error && activeTab !== 'batch' && (
                <div className="error-message">
                    Erreur : {error}
                </div>
            )}

            {/* Show results section after search has been performed */}
            {searchPerformed && activeTab !== 'batch' && lastSearchType === 'vat' && (
                <VatValidationResult
                    results={results}
                    loading={loading}
                    error={error}
                />
            )}

            {searchPerformed && activeTab !== 'batch' && lastSearchType !== 'vat' && (
                <>
                    {results.length > 0 && (
                        <>
                            <div className="results-header">
                                <p>Affichage de {displayedResults.length} sur {filteredResults.length} résultats filtrés (Total : {paginationTotalResults || filteredResults.length})</p>
                                <ExportButton
                                    results={filteredResults}
                                    filename="companies"
                                    availableColumns={availableColumns}
                                    visibleColumnKeys={visibleColumnKeys}
                                />
                            </div>

                            <ResultFilterBar
                                filters={resultFilters}
                                onChange={setResultFilters}
                                onClear={clearResultFilters}
                                resultCount={filteredResults.length}
                                totalCount={paginationTotalResults}
                            />
                        </>
                    )}

                    <ResultsTable
                        results={displayedResults}
                        loading={loading}
                        error={error}
                        onRowClick={(company) => setSelectedCompany(company)}
                        availableColumns={availableColumns}
                        visibleColumnKeys={visibleColumnKeys}
                        onVisibleColumnsChange={setVisibleColumnKeys}
                    />

                    {paginationTotalResults > pagination.perPage && (
                        <Pagination
                            currentPage={pagination.page}
                            totalResults={paginationTotalResults}
                            perPage={pagination.perPage}
                            onPageChange={handlePaginationChange}
                            onPerPageChange={handlePerPageChange}
                        />
                    )}
                </>
            )}

            <CompanyDetailModal
                company={selectedCompany}
                isOpen={!!selectedCompany}
                onClose={() => setSelectedCompany(null)}
            />
        </div>
    );
}

export default App;
