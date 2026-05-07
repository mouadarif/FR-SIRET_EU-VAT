import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResultsTable from '../ResultsTable.jsx';
import { buildAvailableColumns, DEFAULT_VISIBLE_COLUMN_KEYS } from '../columnConfig.js';

describe('ResultsTable', () => {
    const mockResults = [
        {
            siret: '12345678901234',
            nom_complet: 'Pizza Restaurant',
            siege: {
                adresse: '123 Rue de Rivoli',
                code_postal: '75001',
                libelle_commune: 'Paris'
            },
            etat_administratif: 'A'
        },
        {
            siret: '98765432109876',
            nom_raison_sociale: 'Boulangerie Artisanale',
            geo_adresse: '45 Avenue des Champs',
            code_postal: '75008',
            libelle_commune: 'Paris',
            etat_administratif: 'C'
        }
    ];

    const defaultProps = {
        results: mockResults,
        loading: false,
        error: null,
        onRowClick: vi.fn(),
        availableColumns: buildAvailableColumns(mockResults),
        visibleColumnKeys: DEFAULT_VISIBLE_COLUMN_KEYS,
        onVisibleColumnsChange: vi.fn()
    };

    it('should render table with correct headers', () => {
        render(<ResultsTable {...defaultProps} />);

        expect(screen.getByRole('button', { name: /Raison sociale/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /Adresse/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /SIRET/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Commune/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Code postal/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Statut/i })).toBeInTheDocument();
    });

    it('should render all results', () => {
        render(<ResultsTable {...defaultProps} />);

        expect(screen.getByText('Pizza Restaurant')).toBeInTheDocument();
        expect(screen.getByText('Boulangerie Artisanale')).toBeInTheDocument();
        expect(screen.getByText('12345678901234')).toBeInTheDocument();
        expect(screen.getByText('98765432109876')).toBeInTheDocument();
    });

    it('should show active and closed status badges', () => {
        render(<ResultsTable {...defaultProps} />);

        expect(screen.getByText(/^Actif$/i)).toBeInTheDocument();
        expect(screen.getByText(/^Fermé$/i)).toBeInTheDocument();
    });

    it('should call onRowClick when row is clicked', () => {
        const onRowClick = vi.fn();
        render(<ResultsTable {...defaultProps} onRowClick={onRowClick} />);

        const firstRow = screen.getByText('Pizza Restaurant').closest('tr');
        fireEvent.click(firstRow);

        expect(onRowClick).toHaveBeenCalledWith(mockResults[0]);
    });

    it('should show loading state', () => {
        render(<ResultsTable {...defaultProps} loading={true} />);

        expect(screen.getByText(/Chargement des résultats/i)).toBeInTheDocument();
    });

    it('should show error state', () => {
        render(<ResultsTable {...defaultProps} error="Failed to fetch" />);

        expect(screen.getByText(/Erreur :/i)).toBeInTheDocument();
        expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
    });

    it('should show empty state when no results', () => {
        render(<ResultsTable {...defaultProps} results={[]} />);

        expect(screen.getByText(/Aucun résultat/i)).toBeInTheDocument();
    });

    it('should handle missing address fields gracefully', () => {
        const resultsWithMissingData = [{
            siret: '11111111111111',
            nom_complet: 'Test Company',
            etat_administratif: 'A'
        }];

        render(
            <ResultsTable
                {...defaultProps}
                results={resultsWithMissingData}
                availableColumns={buildAvailableColumns(resultsWithMissingData)}
            />
        );

        expect(screen.getByText('Test Company')).toBeInTheDocument();
        expect(screen.getAllByText('-').length).toBeGreaterThan(0);
    });
});
