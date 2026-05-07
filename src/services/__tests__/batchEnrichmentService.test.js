import { describe, expect, it, vi } from 'vitest';
import {
    detectCountryColumn,
    detectSiretColumn,
    detectVatColumn,
    submitSiretEnrichment,
    submitViesEnrichment
} from '../batchEnrichmentService';

describe('backend SIRET enrichment adapter', () => {
    it('detects common SIRET columns from imported files', () => {
        expect(detectSiretColumn(['Supplier', 'FR_SIRET'])).toBe('FR_SIRET');
        expect(detectSiretColumn(['Supplier', 'Enriched_SIRET'])).toBe('Enriched_SIRET');
        expect(detectSiretColumn(['Supplier'])).toBeNull();
    });

    it('posts the selected file and SIRET column to the backend', async () => {
        const blob = new Blob(['xlsx'], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const response = new Response(blob, {
            status: 200,
            headers: {
                'x-enriched-filename': 'out.xlsx',
                'x-input-rows': '12'
            }
        });
        const fetchImpl = vi.fn(async () => response);
        const file = new File(['a;b\n1;2'], 'input.csv', { type: 'text/csv' });

        const result = await submitSiretEnrichment({
            file,
            siretColumn: 'FR_SIRET',
            fetchImpl
        });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('/api/enrich-by-siret');
        expect(options.method).toBe('POST');
        expect(options.body).toBeInstanceOf(FormData);
        expect(options.body.get('file')).toBeInstanceOf(File);
        expect(options.body.get('file').name).toBe('input.csv');
        expect(options.body.get('siret_column')).toBe('FR_SIRET');
        expect(result.filename).toBe('out.xlsx');
        expect(result.rowCount).toBe(12);
        expect(result.blob.size).toBeGreaterThan(0);
    });

    it('surfaces backend JSON errors', async () => {
        const fetchImpl = vi.fn(async () => new Response(
            JSON.stringify({ detail: 'No INSEE credentials configured' }),
            {
                status: 500,
                headers: { 'content-type': 'application/json' }
            }
        ));
        const file = new File(['FR_SIRET\n123'], 'input.csv', { type: 'text/csv' });

        await expect(submitSiretEnrichment({
            file,
            siretColumn: 'FR_SIRET',
            fetchImpl
        })).rejects.toThrow('No INSEE credentials configured');
    });

    it('requires a real file and selected SIRET column', async () => {
        await expect(submitSiretEnrichment({
            file: null,
            siretColumn: 'FR_SIRET'
        })).rejects.toThrow('real file');

        await expect(submitSiretEnrichment({
            file: new File([''], 'input.csv'),
            siretColumn: ''
        })).rejects.toThrow('Select the SIRET column');
    });
});

describe('backend VIES enrichment adapter', () => {
    it('detects common VAT and country columns from imported files', () => {
        expect(detectVatColumn(['Supplier', 'VAT Number'])).toBe('VAT Number');
        expect(detectVatColumn(['Supplier', 'TVA'])).toBe('TVA');
        expect(detectVatColumn(['Supplier'])).toBeNull();

        expect(detectCountryColumn(['Supplier', 'Country_Code'])).toBe('Country_Code');
        expect(detectCountryColumn(['Supplier', 'Pays'])).toBe('Pays');
        expect(detectCountryColumn(['Supplier'])).toBeNull();
    });

    it('posts the selected file, VAT column, and country column to the backend', async () => {
        const blob = new Blob(['xlsx'], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const response = new Response(blob, {
            status: 200,
            headers: {
                'x-enriched-filename': 'vat-out.xlsx',
                'x-input-rows': '8'
            }
        });
        const fetchImpl = vi.fn(async () => response);
        const file = new File(['VAT;Country\nFR123;FR'], 'input.csv', { type: 'text/csv' });

        const result = await submitViesEnrichment({
            file,
            vatColumn: 'VAT',
            countryColumn: 'Country',
            fetchImpl
        });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('/api/enrich-by-vat');
        expect(options.method).toBe('POST');
        expect(options.body).toBeInstanceOf(FormData);
        expect(options.body.get('file')).toBeInstanceOf(File);
        expect(options.body.get('file').name).toBe('input.csv');
        expect(options.body.get('vat_column')).toBe('VAT');
        expect(options.body.get('country_column')).toBe('Country');
        expect(result.filename).toBe('vat-out.xlsx');
        expect(result.rowCount).toBe(8);
        expect(result.blob.size).toBeGreaterThan(0);
    });

    it('surfaces VIES backend JSON errors', async () => {
        const fetchImpl = vi.fn(async () => new Response(
            JSON.stringify({ detail: 'VAT column missing' }),
            {
                status: 400,
                headers: { 'content-type': 'application/json' }
            }
        ));
        const file = new File(['VAT\nFR123'], 'input.csv', { type: 'text/csv' });

        await expect(submitViesEnrichment({
            file,
            vatColumn: 'VAT',
            fetchImpl
        })).rejects.toThrow('VAT column missing');
    });

    it('requires a real file and selected VAT column', async () => {
        await expect(submitViesEnrichment({
            file: null,
            vatColumn: 'VAT'
        })).rejects.toThrow('real file');

        await expect(submitViesEnrichment({
            file: new File([''], 'input.csv'),
            vatColumn: ''
        })).rejects.toThrow('Select the VAT column');
    });
});
