/**
 * Batch Enrichment Service - Facade
 *
 * This file is intentionally thin. It re-exports the public API of the
 * batch enrichment system so that all existing UI imports continue to
 * work without any change.
 *
 * Internal implementation is split across:
 *   ./batch/csvHandler.js       - CSV parsing and export
 *   ./batch/siretEnrichmentService.js - SIRET-only INSEE enrichment
 *   ./batch/viesEnrichmentService.js - VAT/VIES backend enrichment
 */

export {
    SUPPORTED_SPREADSHEET_EXTENSIONS,
    parseSpreadsheetFile
} from './batch/csvHandler';
export {
    detectSiretColumn,
    submitSiretEnrichment
} from './batch/siretEnrichmentService';
export {
    detectCountryColumn,
    detectVatColumn,
    submitViesEnrichment
} from './batch/viesEnrichmentService';
