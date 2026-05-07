import { EXTRACTION_FIELD_NAMES, createEmptyExtractionRow } from './llmExtractionSchema.js';

const LEGAL_FORM_PATTERN = /\b(SASU?|SARL|EURL|SA|SNC|SCI|SELARL|EI|EIRL)\b/g;
const CORE_NAME_NOISE_PATTERN = /\b(FACTURE|ACOMPTE|CMD|COMMANDE|BON|BC|BL|FOURNISSEUR|VIR|VIREMENT)\b/g;

function normalizeText(value) {
    return String(value || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function clampConfidence(value) {
    const parsed = Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
}

function normalizeDate(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(raw)) {
        const [dd, mm, yyyy] = raw.split(/[/-]/);
        return `${yyyy}-${mm}-${dd}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function normalizeCoreName(value) {
    const normalized = normalizeText(value)
        .replace(LEGAL_FORM_PATTERN, ' ')
        .replace(CORE_NAME_NOISE_PATTERN, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || null;
}

function emptyField() {
    return { value: null, evidence_text: null, confidence: 0 };
}

function isEvidenceValid(rowText, evidenceText) {
    if (!evidenceText) return false;
    return String(rowText || '').includes(evidenceText);
}

function verifyField(fieldName, rawField, rowText, flags) {
    const value = rawField?.value === null || rawField?.value === undefined
        ? null
        : String(rawField.value).trim();
    const evidenceText = rawField?.evidence_text === null || rawField?.evidence_text === undefined
        ? null
        : String(rawField.evidence_text);

    if (!value) {
        return emptyField();
    }

    const confidence = clampConfidence(rawField?.confidence);
    if (!isEvidenceValid(rowText, evidenceText)) {
        flags.push(`${fieldName}:evidence_not_in_row`);
        return emptyField();
    }

    if (fieldName === 'siren') {
        const digits = cleanDigits(value);
        if (digits.length !== 9) {
            flags.push('siren:invalid_format');
            return emptyField();
        }
        return { value: digits, evidence_text: evidenceText, confidence };
    }

    if (fieldName === 'siret') {
        const digits = cleanDigits(value);
        if (digits.length !== 14) {
            flags.push('siret:invalid_format');
            return emptyField();
        }
        return { value: digits, evidence_text: evidenceText, confidence };
    }

    if (fieldName === 'postal_code') {
        const digits = cleanDigits(value);
        if (digits.length !== 5) {
            flags.push('postal_code:invalid_format');
            return emptyField();
        }
        return { value: digits, evidence_text: evidenceText, confidence };
    }

    if (fieldName === 'transaction_date') {
        const normalized = normalizeDate(value);
        if (!normalized) {
            flags.push('transaction_date:invalid_format');
            return emptyField();
        }
        return { value: normalized, evidence_text: evidenceText, confidence };
    }

    if (fieldName === 'city') {
        return {
            value: normalizeText(value) || null,
            evidence_text: evidenceText,
            confidence
        };
    }

    if (fieldName === 'company_name_core') {
        const normalized = normalizeCoreName(value);
        if (!normalized) {
            flags.push('company_name_core:empty_after_normalization');
            return emptyField();
        }
        return {
            value: normalized,
            evidence_text: evidenceText,
            confidence
        };
    }

    return {
        value: value || null,
        evidence_text: evidenceText,
        confidence
    };
}

function hasAnyExtractedSignal(fields) {
    return EXTRACTION_FIELD_NAMES.some((fieldName) => fields?.[fieldName]?.value);
}

function inferParseStatus(originalStatus, fields, invalidFieldCount) {
    if (!hasAnyExtractedSignal(fields)) return 'empty';
    if (invalidFieldCount > 0) return 'low_confidence';
    if (originalStatus === 'parsed' || originalStatus === 'low_confidence') return originalStatus;
    return 'parsed';
}

export function verifyExtractionRow(row, rowText = '') {
    const fallback = createEmptyExtractionRow(row?.row_id || '');
    const rawFields = row?.fields || fallback.fields;
    const contaminationFlags = [];
    const verifiedFields = {};

    for (const fieldName of EXTRACTION_FIELD_NAMES) {
        verifiedFields[fieldName] = verifyField(fieldName, rawFields[fieldName], rowText, contaminationFlags);
    }

    const invalidFieldCount = contaminationFlags.length;
    const parseStatus = inferParseStatus(row?.parse_status, verifiedFields, invalidFieldCount);
    const notes = Array.isArray(row?.notes)
        ? row.notes.map((item) => String(item)).filter(Boolean)
        : [];

    const verifiedRow = {
        row_id: row?.row_id || fallback.row_id,
        parse_status: parseStatus,
        fields: verifiedFields,
        invalid_field_count: invalidFieldCount,
        notes: [...notes, ...(invalidFieldCount > 0 ? [`verifier_invalid_fields:${invalidFieldCount}`] : [])]
    };

    return {
        row: verifiedRow,
        verification: {
            row_id: verifiedRow.row_id,
            schema_valid: true,
            evidence_valid: contaminationFlags.length === 0,
            invalid_field_count: invalidFieldCount,
            contamination_flags: contaminationFlags,
            parse_status: parseStatus
        }
    };
}

export function verifyExtractionRows(rows, rowTextById = new Map()) {
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row) => {
        const rowId = row?.row_id || '';
        const rowText = rowTextById.get(rowId) || '';
        return verifyExtractionRow(row, rowText);
    });
}
