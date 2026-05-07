import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('file-saver', () => ({
    saveAs: vi.fn()
}));

import { saveAs } from 'file-saver';
import {
    SUPPORTED_SPREADSHEET_EXTENSIONS,
    exportToWorkbook,
    parseCSV,
    parseSpreadsheetFile
} from '../csvHandler.js';

async function createWorkbookFile(rows, fileName = 'suppliers.xlsx') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    if (rows.length > 0) {
        const keys = Object.keys(rows[0]);
        sheet.addRow(keys);
        rows.forEach((r) => sheet.addRow(keys.map((k) => r[k])));
    }
    const buffer = await workbook.xlsx.writeBuffer();

    const file = new File([buffer], fileName, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    Object.defineProperty(file, 'arrayBuffer', {
        value: async () => buffer
    });

    return file;
}

describe('csvHandler spreadsheet support', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('parses Excel files and appends stable row identifiers', async () => {
        const file = await createWorkbookFile([
            { VAT: 'FR30334691813', Supplier: 'Westfalia Fruit France' },
            { VAT: 'IE6388047V', Supplier: 'Google Ireland' }
        ]);

        const rows = await parseSpreadsheetFile(file);

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            VAT: 'FR30334691813',
            Supplier: 'Westfalia Fruit France'
        });
        expect(rows[0]._row_id).toMatch(/^row_0_/);
        expect(rows[1]._row_id).toMatch(/^row_1_/);
    });

    it('keeps the public batch parser compatible with Excel input', async () => {
        expect(SUPPORTED_SPREADSHEET_EXTENSIONS).toContain('.xlsx');
        expect(SUPPORTED_SPREADSHEET_EXTENSIONS).toContain('.xlsm');

        const file = await createWorkbookFile([
            { SIRET: '12345678901234', Supplier: 'Excel Supplier' }
        ]);

        const rows = await parseCSV(file);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            SIRET: '12345678901234',
            Supplier: 'Excel Supplier'
        });
    });

    it('detects the real header row when a title row appears before the table', async () => {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Sheet1');
        sheet.addRow(['VAT supplier extract']);
        sheet.addRow([]);
        sheet.addRow(['VAT Number', 'Country', 'Supplier Name']);
        sheet.addRow(['FR30334691813', 'FRA', 'Westfalia Fruit France']);
        sheet.addRow(['DE813960018', 'DEU', 'Hapag-Lloyd']);

        const buffer = await workbook.xlsx.writeBuffer();
        const file = new File([buffer], 'vat_with_title.xlsx', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        Object.defineProperty(file, 'arrayBuffer', {
            value: async () => buffer
        });

        const rows = await parseSpreadsheetFile(file);

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            'VAT Number': 'FR30334691813',
            Country: 'FRA',
            'Supplier Name': 'Westfalia Fruit France'
        });
    });

    it('exports workbook downloads through file-saver', async () => {
        await exportToWorkbook([
            { VIES_Normalized_VAT: 'FR30334691813', VIES_Status: 'VALID' }
        ], 'vat_output.xlsx', 'VAT Validation');

        expect(saveAs).toHaveBeenCalledTimes(1);
        expect(saveAs.mock.calls[0][0]).toBeInstanceOf(Blob);
        expect(saveAs.mock.calls[0][1]).toBe('vat_output.xlsx');
    });

    it('rejects legacy .xls files with a clear error', async () => {
        const file = new File([new Uint8Array([1, 2, 3])], 'old.xls', {
            type: 'application/vnd.ms-excel'
        });
        Object.defineProperty(file, 'arrayBuffer', {
            value: async () => new Uint8Array([1, 2, 3]).buffer
        });

        await expect(parseSpreadsheetFile(file)).rejects.toThrow(/Format \.xls/);
    });
});
