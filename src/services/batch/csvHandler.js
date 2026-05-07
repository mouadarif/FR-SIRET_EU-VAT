/**
 * CSV Handler
 * Handles all file I/O: parsing uploaded CSV files and exporting enriched results.
 * Excel OOXML (.xlsx, .xlsm) via exceljs (replaces vulnerable community `xlsx` / SheetJS).
 */

import Papa from 'papaparse';
import { saveAs } from 'file-saver';

/** .xlsb (binary workbook) is not readable by exceljs; use .xlsx / .xlsm / CSV. */
export const SUPPORTED_SPREADSHEET_EXTENSIONS = '.csv,.tsv,.xlsx,.xlsm';

let exceljsModulePromise = null;

function withRowIds(rows) {
    const timestamp = Date.now();
    return rows.map((row, index) => ({
        ...row,
        _row_id: row._row_id || `row_${index}_${timestamp}`
    }));
}

function parseDelimitedFile(file, delimiter = '') {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            delimiter,
            skipEmptyLines: true,
            complete: (results) => resolve(withRowIds(results.data)),
            error: (error) => reject(error)
        });
    });
}

/** Legacy Excel 97–2003 binary — not supported (use .xlsx or CSV). */
function isLegacyXlsFile(fileName = '') {
    return /\.xls$/i.test(fileName);
}

function isExcelBinaryWorkbook(fileName = '') {
    return /\.xlsb$/i.test(fileName);
}

function isExcelOoXmlFile(fileName = '') {
    return /\.(xlsx|xlsm)$/i.test(fileName);
}

function normalizeCellText(value) {
    return String(value ?? '').trim();
}

function isNonEmptyCell(value) {
    return normalizeCellText(value) !== '';
}

function countNonEmptyCells(row = []) {
    return row.filter(isNonEmptyCell).length;
}

function findHeaderRowIndex(matrix = []) {
    if (!Array.isArray(matrix) || matrix.length === 0) {
        return 0;
    }

    let bestIndex = 0;
    let bestScore = -1;

    for (let index = 0; index < Math.min(matrix.length, 25); index += 1) {
        const row = Array.isArray(matrix[index]) ? matrix[index] : [];
        const nonEmptyCount = countNonEmptyCells(row);

        if (nonEmptyCount === 0) {
            continue;
        }

        const nextRows = matrix.slice(index + 1, index + 4);
        const nextRowSupport = nextRows.reduce((sum, nextRow) => sum + Math.min(countNonEmptyCells(nextRow), nonEmptyCount), 0);
        const textLikeCount = row.filter((cell) => /[A-Za-zÀ-ÿ]/.test(normalizeCellText(cell))).length;
        const score = (nonEmptyCount * 10) + (textLikeCount * 3) + nextRowSupport;

        if (nonEmptyCount >= 2 && score > bestScore) {
            bestIndex = index;
            bestScore = score;
        }
    }

    return bestScore >= 0 ? bestIndex : 0;
}

function buildHeaders(row = []) {
    const seen = new Map();

    return row.map((cell, index) => {
        const baseHeader = normalizeCellText(cell) || `Colonne ${index + 1}`;
        const occurrence = seen.get(baseHeader) || 0;
        seen.set(baseHeader, occurrence + 1);

        return occurrence === 0 ? baseHeader : `${baseHeader} (${occurrence + 1})`;
    });
}

function matrixToObjects(matrix = []) {
    const headerRowIndex = findHeaderRowIndex(matrix);
    const headerRow = Array.isArray(matrix[headerRowIndex]) ? matrix[headerRowIndex] : [];
    const headers = buildHeaders(headerRow);

    return matrix
        .slice(headerRowIndex + 1)
        .filter((row) => countNonEmptyCells(row) > 0)
        .map((row) => headers.reduce((record, header, index) => {
            record[header] = normalizeCellText(row?.[index]);
            return record;
        }, {}));
}

async function loadExcelJS() {
    if (!exceljsModulePromise) {
        exceljsModulePromise = import('exceljs');
    }

    const mod = await exceljsModulePromise;
    return mod.default;
}

async function readFileBuffer(file) {
    if (typeof file.arrayBuffer === 'function') {
        return file.arrayBuffer();
    }

    return new Response(file).arrayBuffer();
}

/**
 * @param {import('exceljs').Cell} cell
 */
function cellValueToString(cell) {
    if (!cell || cell.value == null || cell.value === '') {
        return '';
    }

    const v = cell.value;

    if (typeof v === 'object') {
        if (Array.isArray(v.richText)) {
            return v.richText.map((t) => t.text).join('');
        }
        if (Object.prototype.hasOwnProperty.call(v, 'text')) {
            return String(v.text);
        }
        if (Object.prototype.hasOwnProperty.call(v, 'result')) {
            return String(v.result);
        }
        if (v instanceof Date) {
            return v.toISOString().slice(0, 10);
        }
    }

    if (v instanceof Date) {
        return v.toLocaleDateString('fr-FR');
    }

    return String(v);
}

/**
 * @param {import('exceljs').Worksheet} worksheet
 */
function worksheetToMatrix(worksheet) {
    let maxCol = 0;
    worksheet.eachRow({ includeEmpty: true }, (row) => {
        maxCol = Math.max(maxCol, row.cellCount);
    });

    if (maxCol === 0) {
        return [];
    }

    const matrix = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
        const cols = [];
        for (let c = 1; c <= maxCol; c += 1) {
            cols.push(cellValueToString(row.getCell(c)));
        }
        matrix.push(cols);
    });

    return matrix;
}

function estimateColumnWidths(rows) {
    const keys = getUnionKeys(rows);
    return keys.map((key) => {
        const maxCellLength = rows.reduce((max, row) => {
            const value = row[key];
            return Math.max(max, String(value ?? '').length);
        }, String(key).length);

        return Math.min(Math.max(maxCellLength + 2, 12), 42);
    });
}

function getUnionKeys(rows = []) {
    const seen = new Set();
    const keys = [];

    rows.forEach((row) => {
        Object.keys(row || {}).forEach((key) => {
            if (!seen.has(key)) {
                seen.add(key);
                keys.push(key);
            }
        });
    });

    return keys;
}

export async function parseSpreadsheetFile(file) {
    if (!(file instanceof File)) {
        throw new Error('Invalid file object');
    }

    if (isLegacyXlsFile(file.name)) {
        throw new Error(
            'Format .xls (Excel 97–2003) non pris en charge. Enregistrez le fichier au format .xlsx ou exportez en CSV.'
        );
    }

    if (isExcelBinaryWorkbook(file.name)) {
        throw new Error(
            'Format .xlsb non pris en charge. Enregistrez le classeur au format .xlsx ou .xlsm, ou exportez en CSV.'
        );
    }

    if (isExcelOoXmlFile(file.name)) {
        const ExcelJS = await loadExcelJS();
        const buffer = await readFileBuffer(file);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            return withRowIds([]);
        }

        const matrix = worksheetToMatrix(worksheet);
        const rows = matrixToObjects(matrix);
        return withRowIds(rows);
    }

    if (/\.tsv$/i.test(file.name)) {
        return parseDelimitedFile(file, '\t');
    }

    return parseDelimitedFile(file);
}

/**
 * Parse uploaded CSV file.
 * Each row gets a unique _row_id for progress tracking and smart resume logic.
 */
export function parseCSV(file) {
    return parseSpreadsheetFile(file);
}

export async function exportToWorkbook(results, filename = 'enriched_results.xlsx', sheetName = 'Results') {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);

    if (results.length > 0) {
        const keys = getUnionKeys(results);
        sheet.addRow(keys);
        results.forEach((row) => {
            sheet.addRow(keys.map((k) => row[k] ?? ''));
        });

        const lastRow = results.length + 1;
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: lastRow, column: keys.length }
        };

        const widths = estimateColumnWidths(results);
        widths.forEach((w, i) => {
            sheet.getColumn(i + 1).width = w;
        });
    }

    const output = await workbook.xlsx.writeBuffer();
    const blob = new Blob([output], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    saveAs(blob, filename);
}
