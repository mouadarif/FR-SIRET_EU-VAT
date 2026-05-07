// ActiveFiltersDisplay Tests - Fixed
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActiveFiltersDisplay from '../ActiveFiltersDisplay.jsx';

describe('ActiveFiltersDisplay', () => {
    const defaultProps = {
        filters: {},
        onRemove: vi.fn(),
        onClearAll: vi.fn()
    };

    it('should not render when no filters are active', () => {
        const { container } = render(<ActiveFiltersDisplay {...defaultProps} />);
        expect(container.firstChild).toBeNull();
    });

    it('should render filter chips for active filters', () => {
        const filters = {
            nameQuery: 'Pizza',
            postalCode: '75001',
            city: 'Paris'
        };

        render(<ActiveFiltersDisplay {...defaultProps} filters={filters} />);

        expect(screen.getByText(/Nom : "Pizza"/i)).toBeInTheDocument();
        expect(screen.getByText(/Code postal : 75001/i)).toBeInTheDocument();
        expect(screen.getByText(/Ville : Paris/i)).toBeInTheDocument();
    });

    it('should show SIRET filter chip', () => {
        const filters = {
            nameQuery: 'Restaurant',
            siret: '12345678901234'
        };

        render(<ActiveFiltersDisplay {...defaultProps} filters={filters} />);

        expect(screen.getByText(/SIRET : 12345678901234/i)).toBeInTheDocument();
    });

    it('should show address filter chip', () => {
        const filters = {
            nameQuery: 'Carrefour',
            address: 'Rue de Rivoli'
        };

        render(<ActiveFiltersDisplay {...defaultProps} filters={filters} />);

        expect(screen.getByText(/Adresse : "Rue de Rivoli"/i)).toBeInTheDocument();
    });

    it('should render Clear All Filters button', () => {
        const filters = {
            nameQuery: 'Pizza',
            postalCode: '75001'
        };

        render(<ActiveFiltersDisplay {...defaultProps} filters={filters} />);

        expect(screen.getByText(/Tout effacer/i)).toBeInTheDocument();
    });

    it('should call onRemove when filter chip remove button is clicked', () => {
        const onRemove = vi.fn();
        const filters = {
            nameQuery: 'Pizza',
            postalCode: '75001'
        };

        render(<ActiveFiltersDisplay {...defaultProps} filters={filters} onRemove={onRemove} />);

        const removeButtons = screen.getAllByText('×');
        fireEvent.click(removeButtons[0]);

        expect(onRemove).toHaveBeenCalled();
    });

    it('should call onClearAll when Clear All button is clicked', () => {
        const onClearAll = vi.fn();
        const filters = {
            nameQuery: 'Pizza',
            postalCode: '75001'
        };

        render(<ActiveFiltersDisplay {...defaultProps} filters={filters} onClearAll={onClearAll} />);

        const clearAllButton = screen.getByText(/Tout effacer/i);
        fireEvent.click(clearAllButton);

        expect(onClearAll).toHaveBeenCalled();
    });

    it('should show advanced filter chips', () => {
        const filters = {
            nameQuery: 'Restaurant',
            code_naf: '5610A',
            etat_administratif: 'A'
        };

        render(<ActiveFiltersDisplay {...defaultProps} filters={filters} />);

        expect(screen.getByText(/NAF : 5610A/i)).toBeInTheDocument();
        expect(screen.getAllByText(/Actif/i).length).toBeGreaterThanOrEqual(1);
    });
});
