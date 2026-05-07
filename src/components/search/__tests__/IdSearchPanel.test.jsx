import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import IdSearchPanel from '../IdSearchPanel';

const defaults = () => ({
    activeService: 'insee',
    siretQuery: '',
    sirenQuery: '',
    vatQuery: '',
    onSiretChange: vi.fn(),
    onSirenChange: vi.fn(),
    onVatChange: vi.fn(),
    onSearchSiret: vi.fn(),
    onSearchSiren: vi.fn(),
    onSearchVat: vi.fn()
});

describe('IdSearchPanel', () => {
    it('renders SIRET and SIREN fields for INSEE', () => {
        render(<IdSearchPanel {...defaults()} />);

        expect(screen.getByPlaceholderText(/33358346602181/)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/333583466$/)).toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/FR30334691813/)).not.toBeInTheDocument();
    });

    it('renders VAT field for VIES', () => {
        render(<IdSearchPanel {...defaults()} activeService="vat" />);

        expect(screen.getByPlaceholderText(/FR30334691813/)).toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/33358346602181/)).not.toBeInTheDocument();
    });

    it('renders lookup actions for each active service', () => {
        render(<IdSearchPanel {...defaults()} />);

        expect(screen.getAllByText('Rechercher')).toHaveLength(2);

        cleanup();
        render(<IdSearchPanel {...defaults()} activeService="vat" />);
        expect(screen.getByText('Valider')).toBeInTheDocument();
    });

    it('disables SIRET button when input is incomplete', () => {
        render(<IdSearchPanel {...defaults()} siretQuery="12345" />);

        expect(screen.getAllByText('Rechercher')[0]).toBeDisabled();
    });

    it('enables SIRET button for valid 14-digit input', () => {
        render(<IdSearchPanel {...defaults()} siretQuery="33358346602181" />);

        expect(screen.getAllByText('Rechercher')[0]).not.toBeDisabled();
    });

    it('disables SIREN button when input is incomplete', () => {
        render(<IdSearchPanel {...defaults()} sirenQuery="1234" />);

        expect(screen.getAllByText('Rechercher')[1]).toBeDisabled();
    });

    it('enables SIREN button for valid 9-digit input', () => {
        render(<IdSearchPanel {...defaults()} sirenQuery="388380073" />);

        expect(screen.getAllByText('Rechercher')[1]).not.toBeDisabled();
    });

    it('shows validation feedback for SIRET', () => {
        render(<IdSearchPanel {...defaults()} siretQuery="33358346602181" />);

        expect(screen.getByText(/Valide/)).toBeInTheDocument();
    });

    it('shows validation feedback for SIREN', () => {
        render(<IdSearchPanel {...defaults()} sirenQuery="388380073" />);

        expect(screen.getAllByText(/Valide/).length).toBeGreaterThanOrEqual(1);
    });

    it('calls onSearchSiret when SIRET button is clicked', () => {
        const props = defaults();
        props.siretQuery = '33358346602181';
        render(<IdSearchPanel {...props} />);

        fireEvent.click(screen.getAllByText('Rechercher')[0]);
        expect(props.onSearchSiret).toHaveBeenCalledTimes(1);
        expect(props.onSearchSiren).not.toHaveBeenCalled();
    });

    it('calls onSearchSiren when SIREN button is clicked', () => {
        const props = defaults();
        props.sirenQuery = '388380073';
        render(<IdSearchPanel {...props} />);

        fireEvent.click(screen.getAllByText('Rechercher')[1]);
        expect(props.onSearchSiren).toHaveBeenCalledTimes(1);
        expect(props.onSearchSiret).not.toHaveBeenCalled();
    });

    it('enables VAT validation for prefixed EU VAT numbers', () => {
        render(<IdSearchPanel {...defaults()} activeService="vat" vatQuery="FR30334691813" />);

        expect(screen.getByText('Valider')).not.toBeDisabled();
        expect(screen.getByText(/Format valide/)).toBeInTheDocument();
    });

    it('normalizes VAT input to uppercase alphanumeric content', () => {
        const props = defaults();
        render(<IdSearchPanel {...props} activeService="vat" />);

        fireEvent.change(screen.getByPlaceholderText(/FR30334691813/), {
            target: { value: 'fr 30-334691813' }
        });
        expect(props.onVatChange).toHaveBeenCalledWith('FR30334691813');
    });

    it('calls onSearchVat when VAT button is clicked', () => {
        const props = defaults();
        props.vatQuery = 'FR30334691813';
        render(<IdSearchPanel {...props} activeService="vat" />);

        fireEvent.click(screen.getByText('Valider'));
        expect(props.onSearchVat).toHaveBeenCalledTimes(1);
    });

    it('strips non-numeric characters from SIRET input', () => {
        const props = defaults();
        render(<IdSearchPanel {...props} />);

        fireEvent.change(screen.getByPlaceholderText(/33358346602181/), {
            target: { value: 'ABC123def456' }
        });
        expect(props.onSiretChange).toHaveBeenCalledWith('123456');
    });

    it('strips non-numeric characters from SIREN input', () => {
        const props = defaults();
        render(<IdSearchPanel {...props} />);

        fireEvent.change(screen.getByPlaceholderText(/333583466$/), {
            target: { value: 'XY9876Z' }
        });
        expect(props.onSirenChange).toHaveBeenCalledWith('9876');
    });
});
