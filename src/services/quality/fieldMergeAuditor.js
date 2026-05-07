function toStringValue(value) {
    return value == null ? '' : String(value);
}

/**
 * Build field-level correction audit records.
 * @param {{
 *  raw: Record<string, any>,
 *  normalized: Record<string, any>,
 *  corrected: Record<string, any>,
 *  sourceByField?: Record<string, string>,
 *  confidenceByField?: Record<string, number>,
 *  reasonByField?: Record<string, string>
 * }} params
 */
export function buildFieldCorrectionAudit(params) {
    const raw = params?.raw || {};
    const normalized = params?.normalized || {};
    const corrected = params?.corrected || {};
    const sourceByField = params?.sourceByField || {};
    const confidenceByField = params?.confidenceByField || {};
    const reasonByField = params?.reasonByField || {};

    const keys = [...new Set([
        ...Object.keys(raw),
        ...Object.keys(normalized),
        ...Object.keys(corrected)
    ])];

    const records = {};
    for (const key of keys) {
        records[key] = {
            original: toStringValue(raw[key]),
            normalized: toStringValue(normalized[key]),
            corrected: toStringValue(corrected[key]),
            source: sourceByField[key] || 'INSEE',
            confidence: typeof confidenceByField[key] === 'number'
                ? Number(confidenceByField[key].toFixed(4))
                : null,
            reason: reasonByField[key] || ''
        };
    }

    return records;
}

/**
 * Flatten audit records for CSV export.
 * @param {Record<string, {original: string, normalized: string, corrected: string, source: string, confidence: number|null, reason: string}>} records
 */
export function flattenFieldCorrectionAudit(records) {
    const out = {};
    for (const [field, record] of Object.entries(records || {})) {
        out[`raw_${field}`] = record.original;
        out[`normalized_${field}`] = record.normalized;
        out[`corrected_${field}`] = record.corrected;
        out[`source_${field}`] = record.source;
        out[`confidence_${field}`] = record.confidence == null ? '' : record.confidence;
        out[`reason_${field}`] = record.reason;
    }
    return out;
}

