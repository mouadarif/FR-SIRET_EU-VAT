export const LEGAL_FORMS = new Set([
    'SARL',
    'SAS',
    'SASU',
    'SA',
    'EURL',
    'SCI',
    'SNC',
    'SELARL',
    'SELAS',
    'GIE',
    'ASSOCIATION'
]);

export const STOPWORDS = new Set([
    'SOCIETE',
    'COMPAGNIE',
    'ENTREPRISE',
    'ET',
    'DE',
    'DU',
    'DES',
    'LA',
    'LE',
    'LES',
    'AU',
    'AUX'
]);

const ABBREVIATIONS = new Map([
    ['ST', 'SAINT'],
    ['STE', 'SAINTE'],
    ['AV', 'AVENUE'],
    ['BD', 'BOULEVARD'],
    ['RTE', 'ROUTE'],
    ['IMP', 'IMPASSE']
]);

const CITY_ALIASES = new Map([
    ['PARIS 01', 'PARIS'],
    ['PARIS 1ER', 'PARIS'],
    ['PARIS 1', 'PARIS'],
    ['LYON 01', 'LYON'],
    ['LYON 1ER', 'LYON'],
    ['MARSEILLE CEDEX', 'MARSEILLE'],
    ['ST ETIENNE', 'SAINT ETIENNE']
]);

const OCR_HINTS = new Map([
    ['S0CIETE', 'SOCIETE'],
    ['5ARL', 'SARL'],
    ['SASUU', 'SASU'],
    ['PARlS', 'PARIS'],
    ['L Y O N', 'LYON']
]);

function normalizeBase(value) {
    return String(value || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function applyOcrHints(value) {
    let output = normalizeBase(value);
    for (const [wrong, fixed] of OCR_HINTS.entries()) {
        const pattern = new RegExp(`\\b${wrong}\\b`, 'g');
        output = output.replace(pattern, fixed);
    }
    return output;
}

export function expandAbbreviations(value) {
    const tokens = normalizeBase(value).split(' ').filter(Boolean);
    return tokens
        .map((token) => ABBREVIATIONS.get(token) || token)
        .join(' ');
}

export function normalizeCity(value) {
    const normalized = expandAbbreviations(applyOcrHints(value));
    return CITY_ALIASES.get(normalized) || normalized;
}

export function stripLegalForms(value) {
    const tokens = normalizeBase(value).split(' ').filter(Boolean);
    return tokens
        .filter((token) => !LEGAL_FORMS.has(token))
        .join(' ')
        .trim();
}

export function dropStopwords(tokens = []) {
    return tokens.filter((token) => {
        const value = normalizeBase(token);
        return value && !STOPWORDS.has(value);
    });
}

export function normalizeAddress(value) {
    return expandAbbreviations(applyOcrHints(value))
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeToken(token) {
    return normalizeBase(token).replace(/[^\w]/g, '');
}
