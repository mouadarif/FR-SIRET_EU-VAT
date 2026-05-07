export const EXTRACTION_FIELD_NAMES = [
    'company_name_raw',
    'company_name_core',
    'city',
    'postal_code',
    'siren',
    'siret',
    'legal_form',
    'transaction_date',
    'address_fragment'
];

const VALID_PARSE_STATUS = new Set(['parsed', 'low_confidence', 'empty']);

function clampConfidence(value) {
    const parsed = Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
}

function normalizeNullableString(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text : null;
}

function normalizeField(rawField) {
    const value = normalizeNullableString(rawField?.value);
    const evidence = normalizeNullableString(rawField?.evidence_text);
    const confidence = value === null ? 0 : clampConfidence(rawField?.confidence);
    return {
        value,
        evidence_text: value === null ? null : evidence,
        confidence
    };
}

function normalizeParseStatus(value) {
    const status = String(value || '').trim();
    if (VALID_PARSE_STATUS.has(status)) return status;
    return 'low_confidence';
}

export function createEmptyExtractionRow(rowId) {
    const fields = {};
    for (const fieldName of EXTRACTION_FIELD_NAMES) {
        fields[fieldName] = {
            value: null,
            evidence_text: null,
            confidence: 0
        };
    }
    return {
        row_id: rowId,
        parse_status: 'empty',
        fields,
        invalid_field_count: 0,
        notes: []
    };
}

function normalizeExtractionRow(rawRow, fallbackRowId = '') {
    const rowId = normalizeNullableString(rawRow?.row_id) || fallbackRowId || '';
    const base = createEmptyExtractionRow(rowId);
    const rawFields = rawRow?.fields || {};
    const fields = {};
    for (const fieldName of EXTRACTION_FIELD_NAMES) {
        fields[fieldName] = normalizeField(rawFields[fieldName]);
    }
    return {
        row_id: rowId,
        parse_status: normalizeParseStatus(rawRow?.parse_status),
        fields,
        invalid_field_count: Number.isInteger(rawRow?.invalid_field_count)
            ? Math.max(0, rawRow.invalid_field_count)
            : 0,
        notes: Array.isArray(rawRow?.notes)
            ? rawRow.notes.map((item) => String(item)).filter(Boolean)
            : base.notes
    };
}

export function normalizeExtractionPayload(rawPayload, expectedRowIds = []) {
    const expected = Array.isArray(expectedRowIds)
        ? expectedRowIds.map((item) => String(item || '')).filter(Boolean)
        : [];
    const rows = Array.isArray(rawPayload?.rows) ? rawPayload.rows : [];

    const byRowId = new Map();
    const unknownRowIds = [];
    const duplicateRowIds = [];

    for (const rawRow of rows) {
        const normalized = normalizeExtractionRow(rawRow);
        const rowId = normalized.row_id;
        if (!rowId) continue;

        if (byRowId.has(rowId)) {
            duplicateRowIds.push(rowId);
            continue;
        }
        if (expected.length > 0 && !expected.includes(rowId)) {
            unknownRowIds.push(rowId);
            continue;
        }
        byRowId.set(rowId, normalized);
    }

    const missingRowIds = [];
    for (const rowId of expected) {
        if (!byRowId.has(rowId)) {
            missingRowIds.push(rowId);
            byRowId.set(rowId, createEmptyExtractionRow(rowId));
        }
    }

    return {
        rows: [...byRowId.values()],
        byRowId,
        missingRowIds,
        unknownRowIds,
        duplicateRowIds,
        schemaValid: duplicateRowIds.length === 0 && unknownRowIds.length === 0
    };
}
