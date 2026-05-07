import { beforeEach, describe, expect, it, vi } from 'vitest';
import cache from '../cache.js';
import requestDedup from '../requestDedup.js';
import viesApiClient, { ViesApiClient } from '../viesApiClient.js';

function okJson(body) {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body
    };
}

function failJson(status, statusText = '') {
    return {
        ok: false,
        status,
        statusText,
        json: async () => ({})
    };
}

describe('ViesApiClient', () => {
    beforeEach(() => {
        global.fetch = vi.fn();
        cache.clear();
        requestDedup.clear();
        viesApiClient.cancelPendingRequests();
        vi.restoreAllMocks();
    });

    it('normalizes configuration payloads', async () => {
        global.fetch.mockResolvedValue(okJson({
            updateDate: '21/10/2025 13:18',
            version: '7.3.0-HF1',
            countries: ['FR', 'IE'],
            vatNumberPattern: '[a-zA-Z0-9+*]*',
            maximumRowsForBatch: 100
        }));

        const response = await viesApiClient.getConfiguration();

        expect(response.success).toBe(true);
        expect(response.data.version).toBe('7.3.0-HF1');
        expect(response.data.countries).toEqual(['FR', 'IE']);
        expect(String(global.fetch.mock.calls[0][0])).toBe('/api/vies/configurations');
    });

    it('normalizes countries payloads', async () => {
        global.fetch.mockResolvedValue(okJson({
            value: [
                { countryCode: 'FR', approxMatching: false, hasName: false, hasAddress: false, hasCompanyType: false },
                { countryCode: 'ES', approxMatching: true, hasName: false, hasAddress: false, hasCompanyType: false }
            ]
        }));

        const response = await viesApiClient.getCountries({ forRequester: true });

        expect(response.success).toBe(true);
        expect(response.data.countries).toHaveLength(2);
        expect(response.data.countries[1].countryCode).toBe('ES');
        expect(String(global.fetch.mock.calls[0][0])).toContain('/api/vies/countries?forRequester=true');
    });

    it('normalizes countries when the endpoint returns a raw array', async () => {
        global.fetch.mockResolvedValue(okJson([
            { countryCode: 'FR', approxMatching: false, hasName: false, hasAddress: false, hasCompanyType: false },
            { countryCode: 'IE', approxMatching: false, hasName: false, hasAddress: false, hasCompanyType: false }
        ]));

        const response = await viesApiClient.getCountries({ forRequester: true });

        expect(response.success).toBe(true);
        expect(response.data.countries).toHaveLength(2);
        expect(response.data.countries[1].countryCode).toBe('IE');
    });

    it('builds VAT validation URL and strips country prefix from a full VAT number', async () => {
        global.fetch.mockResolvedValue(okJson({
            isValid: true,
            requestDate: '2026-04-01T14:20:16.130Z',
            userError: 'VALID',
            name: 'GOOGLE IRELAND LIMITED',
            address: 'DUBLIN 4',
            vatNumber: '6388047V',
            originalVatNumber: '6388047V'
        }));

        const response = await viesApiClient.validateVat({
            vatNumber: 'IE6388047V'
        });

        expect(response.success).toBe(true);
        expect(response.data.countryCode).toBe('IE');
        expect(response.data.vatNumber).toBe('6388047V');
        expect(response.data.name).toBe('GOOGLE IRELAND LIMITED');
        expect(String(global.fetch.mock.calls[0][0])).toBe('/api/vies/ms/IE/vat/6388047V');
    });

    it('adapts VAT validation into the search result shape used by the UI', async () => {
        global.fetch.mockResolvedValue(okJson({
            isValid: true,
            requestDate: '2026-04-01T14:20:16.130Z',
            userError: 'VALID',
            name: 'SAS WESTFALIA FRUIT FRANCE',
            address: '5 BD DU DELTA\n94260 FRESNES',
            vatNumber: '30334691813',
            originalVatNumber: '30334691813'
        }));

        const response = await viesApiClient.searchByVAT({
            vatNumber: 'FR30334691813'
        });

        expect(response.success).toBe(true);
        expect(response.data.total_results).toBe(1);
        expect(response.data.results[0]).toMatchObject({
            result_kind: 'vat',
            country_code: 'FR',
            vat_number: '30334691813',
            nom_complet: 'SAS WESTFALIA FRUIT FRANCE',
            geo_adresse: '5 BD DU DELTA\n94260 FRESNES',
            validation_status: 'VALID',
            is_valid: true
        });
    });

    it('normalizes VAT legal name and address from alternate VIES field names', async () => {
        global.fetch.mockResolvedValue(okJson({
            valid: 'true',
            userError: 'VALID',
            legalName: 'ALT LEGAL NAME LIMITED',
            registeredAddress: '1 MARKET STREET\nDUBLIN',
            vat_number: '1234567A',
            original_vat_number: 'IE1234567A',
            request_identifier: 'REQ-ALT'
        }));

        const response = await viesApiClient.searchByVAT({
            vatNumber: 'IE1234567A'
        });

        expect(response.success).toBe(true);
        expect(response.data.results[0]).toMatchObject({
            legal_name: 'ALT LEGAL NAME LIMITED',
            registered_address: '1 MARKET STREET\nDUBLIN',
            nom_complet: 'ALT LEGAL NAME LIMITED',
            geo_adresse: '1 MARKET STREET\nDUBLIN',
            original_vat_number: 'IE1234567A',
            request_identifier: 'REQ-ALT',
            is_valid: true
        });
    });

    it('passes approximate matching query parameters when provided', async () => {
        global.fetch.mockResolvedValue(okJson({
            isValid: true,
            userError: 'VALID',
            vatNumber: '6388047V'
        }));

        const response = await viesApiClient.validateVat({
            countryCode: 'IE',
            vatNumber: '6388047V',
            requesterMemberStateCode: 'FR',
            requesterNumber: '40303265045',
            traderName: 'Google Ireland Limited',
            traderStreet: 'Barrow Street',
            traderPostalCode: 'D04',
            traderCity: 'Dublin',
            traderCompanyType: 'business'
        });

        expect(response.success).toBe(true);

        const calledUrl = new URL(String(global.fetch.mock.calls[0][0]), 'http://localhost');
        expect(calledUrl.pathname).toBe('/api/vies/ms/IE/vat/6388047V');
        expect(calledUrl.searchParams.get('requesterMemberStateCode')).toBe('FR');
        expect(calledUrl.searchParams.get('requesterNumber')).toBe('40303265045');
        expect(calledUrl.searchParams.get('traderName')).toBe('Google Ireland Limited');
        expect(calledUrl.searchParams.get('traderStreet')).toBe('Barrow Street');
        expect(calledUrl.searchParams.get('traderPostalCode')).toBe('D04');
        expect(calledUrl.searchParams.get('traderCity')).toBe('Dublin');
        expect(calledUrl.searchParams.get('traderCompanyType')).toBe('business');
    });

    it('returns a validation error when VAT input is incomplete', async () => {
        const response = await viesApiClient.validateVat({
            vatNumber: ''
        });

        expect(response.success).toBe(false);
        expect(response.error.userMessage).toContain('Le code pays et le numéro TVA sont obligatoires');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('maps 400 errors to a user-friendly VIES message', async () => {
        global.fetch.mockResolvedValue(failJson(400, 'Bad Request'));

        const response = await viesApiClient.validateVat({
            countryCode: 'FR',
            vatNumber: 'BAD'
        });

        expect(response.success).toBe(false);
        expect(response.error.userMessage).toContain('Vérifiez le code pays et le format du numéro TVA');
    });

    it('returns cached data for repeated requests', async () => {
        global.fetch.mockResolvedValue(okJson({
            isValid: true,
            userError: 'VALID',
            vatNumber: '6388047V'
        }));

        const customClient = new ViesApiClient();
        const first = await customClient.validateVat({ vatNumber: 'IE6388047V' });
        const second = await customClient.validateVat({ vatNumber: 'IE6388047V' });

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
