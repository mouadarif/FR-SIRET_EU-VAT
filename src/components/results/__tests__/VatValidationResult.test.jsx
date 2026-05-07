import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import VatValidationResult from '../VatValidationResult.jsx';

describe('VatValidationResult', () => {
    it('renders legal name, VAT number, and registered address from canonical fields', () => {
        render(
            <VatValidationResult
                loading={false}
                error={null}
                results={[
                    {
                        result_kind: 'vat',
                        country_code: 'IE',
                        vat_number: '6388047V',
                        original_vat_number: 'IE6388047V',
                        legal_name: 'GOOGLE IRELAND LIMITED',
                        registered_address: '3RD FLOOR, GORDON HOUSE\nBARROW STREET\nDUBLIN 4',
                        validation_status: 'VALID',
                        is_valid: true,
                        request_date: '2026-05-06T09:59:59.626Z',
                        request_identifier: 'REQ-1'
                    }
                ]}
            />
        );

        expect(screen.getAllByText('GOOGLE IRELAND LIMITED')).toHaveLength(2);
        expect(screen.getAllByText('IE6388047V')).toHaveLength(2);
        expect(screen.getByText('3RD FLOOR, GORDON HOUSE')).toBeInTheDocument();
        expect(screen.getByText('BARROW STREET')).toBeInTheDocument();
        expect(screen.getByText('DUBLIN 4')).toBeInTheDocument();
        expect(screen.getByText('REQ-1')).toBeInTheDocument();
    });

    it('falls back to raw VIES aliases when adapted fields are missing', () => {
        render(
            <VatValidationResult
                loading={false}
                error={null}
                results={[
                    {
                        result_kind: 'vat',
                        country_code: 'IE',
                        vat_number: '1234567A',
                        validation_status: 'VALID',
                        is_valid: true,
                        _raw: {
                            legalName: 'ALT LEGAL NAME LIMITED',
                            registeredAddress: '1 MARKET STREET',
                            originalVatNumber: 'IE1234567A'
                        }
                    }
                ]}
            />
        );

        expect(screen.getAllByText('ALT LEGAL NAME LIMITED')).toHaveLength(2);
        expect(screen.getAllByText('IE1234567A')).toHaveLength(2);
        expect(screen.getByText('1 MARKET STREET')).toBeInTheDocument();
    });
});
