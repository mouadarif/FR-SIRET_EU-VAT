import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResultFilterBar from '../ResultFilterBar.jsx';

describe('ResultFilterBar', () => {
    const defaultFilters = {
        nom_complet: '',
        adresse: '',
        code_postal: '',
        libelle_commune: '',
        etat_administratif: '',
        siret: ''
    };

    const defaultProps = {
        filters: defaultFilters,
        onChange: vi.fn(),
        onClear: vi.fn(),
        resultCount: 10,
        totalCount: 25
    };

    it('should render all filter inputs', () => {
        render(<ResultFilterBar {...defaultProps} />);

        expect(screen.getByLabelText(/Filtrer par nom d'entreprise/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Filtrer par adresse/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Filtrer par SIRET/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Filtrer par ville/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Filtrer par code postal/i)).toBeInTheDocument();
    });

    it('should render status dropdown', () => {
        render(<ResultFilterBar {...defaultProps} />);

        const statusSelect = screen.getByRole('combobox');
        expect(statusSelect).toBeInTheDocument();
        expect(screen.getByText(/Tous les statuts/i)).toBeInTheDocument();
    });

    it('should not show clear button when no filters are active', () => {
        render(<ResultFilterBar {...defaultProps} />);

        expect(screen.queryByText(/Effacer les filtres/i)).not.toBeInTheDocument();
    });

    it('should show clear button and count when filters are active', () => {
        const activeFilters = {
            ...defaultFilters,
            nom_complet: 'Pizza'
        };

        render(<ResultFilterBar {...defaultProps} filters={activeFilters} />);

        expect(screen.getByText(/Effacer les filtres/i)).toBeInTheDocument();
        expect(screen.getByText(/10 sur 25 affichés/i)).toBeInTheDocument();
    });

    it('should call onChange when typing in name filter', () => {
        const onChange = vi.fn();
        render(<ResultFilterBar {...defaultProps} onChange={onChange} />);

        const nameInput = screen.getByLabelText(/Filtrer par nom d'entreprise/i);
        fireEvent.change(nameInput, { target: { value: 'Restaurant' } });

        expect(onChange).toHaveBeenCalledWith({
            ...defaultFilters,
            nom_complet: 'Restaurant'
        });
    });

    it('should call onChange when selecting status', () => {
        const onChange = vi.fn();
        render(<ResultFilterBar {...defaultProps} onChange={onChange} />);

        const statusSelect = screen.getByRole('combobox');
        fireEvent.change(statusSelect, { target: { value: 'a' } });

        expect(onChange).toHaveBeenCalledWith({
            ...defaultFilters,
            etat_administratif: 'a'
        });
    });

    it('should call onClear when clear button is clicked', () => {
        const onClear = vi.fn();
        const activeFilters = {
            ...defaultFilters,
            nom_complet: 'Pizza'
        };

        render(<ResultFilterBar {...defaultProps} filters={activeFilters} onClear={onClear} />);

        const clearButton = screen.getByText(/Effacer les filtres/i);
        fireEvent.click(clearButton);

        expect(onClear).toHaveBeenCalled();
    });
});
