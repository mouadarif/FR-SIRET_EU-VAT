import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NameLocationSearchPanel from '../NameLocationSearchPanel.jsx';

describe('NameLocationSearchPanel', () => {
    const defaultProps = {
        nameQuery: '',
        onNameChange: vi.fn(),
        address: '',
        onAddressChange: vi.fn(),
        postalCode: '',
        onPostalCodeChange: vi.fn(),
        city: '',
        onCityChange: vi.fn(),
        onSearch: vi.fn()
    };

    it('renders key input fields', () => {
        render(<NameLocationSearchPanel {...defaultProps} />);
        expect(screen.getByLabelText(/Nom de l'entreprise/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Adresse/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Code postal/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Ville/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/^SIRET/i)).not.toBeInTheDocument();
    });

    it('calls onNameChange when typing', () => {
        const onNameChange = vi.fn();
        render(<NameLocationSearchPanel {...defaultProps} onNameChange={onNameChange} />);
        fireEvent.change(screen.getByLabelText(/Nom de l'entreprise/i), {
            target: { value: 'Restaurant' }
        });
        expect(onNameChange).toHaveBeenCalledWith('Restaurant');
    });

    it('enables search button only when name is valid', () => {
        const { rerender } = render(<NameLocationSearchPanel {...defaultProps} nameQuery="Ab" />);
        expect(screen.getByRole('button', { name: /^Rechercher$/i })).toBeDisabled();
        expect(screen.getByText(/Saisissez au moins 3 caracteres/i)).toBeInTheDocument();

        rerender(<NameLocationSearchPanel {...defaultProps} nameQuery="Abc" />);
        expect(screen.getByRole('button', { name: /^Rechercher$/i })).not.toBeDisabled();
    });
});
