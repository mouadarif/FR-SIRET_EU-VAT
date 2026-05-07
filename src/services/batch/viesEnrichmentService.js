const DEFAULT_VAT_COLUMNS = [
    'VAT',
    'VAT Number',
    'VAT_Number',
    'EU_VAT',
    'TVA',
    'TVA intracommunautaire',
    'VatNumber',
    'Tax_ID'
];

const DEFAULT_COUNTRY_COLUMNS = [
    'Country',
    'CountryCode',
    'Country_Code',
    'MSCode',
    'Member State',
    'Pays',
    'Country ISO'
];

function detectColumn(columns = [], candidates = []) {
    const columnSet = new Set(columns);
    return candidates.find((candidate) => columnSet.has(candidate)) || null;
}

async function readErrorMessage(response) {
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        const payload = await response.json().catch(() => null);
        if (payload?.detail) return String(payload.detail);
    }

    const text = await response.text().catch(() => '');
    return text || `Backend request failed with HTTP ${response.status}`;
}

export function detectVatColumn(columns = []) {
    return detectColumn(columns, DEFAULT_VAT_COLUMNS);
}

export function detectCountryColumn(columns = []) {
    return detectColumn(columns, DEFAULT_COUNTRY_COLUMNS);
}

export async function submitViesEnrichment({
    file,
    vatColumn,
    countryColumn = '',
    endpoint = '/api/enrich-by-vat',
    fetchImpl = fetch
}) {
    if (!(file instanceof File)) {
        throw new Error('A real file is required for backend VIES enrichment.');
    }

    if (!vatColumn) {
        throw new Error('Select the VAT column before enrichment.');
    }

    const body = new FormData();
    body.append('file', file, file.name);
    body.append('vat_column', vatColumn);
    body.append('country_column', countryColumn || '');

    const response = await fetchImpl(endpoint, {
        method: 'POST',
        body
    });

    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }

    const blob = await response.blob();
    return {
        blob,
        filename: response.headers.get('x-enriched-filename') || 'enriched_by_vat.xlsx',
        rowCount: Number(response.headers.get('x-input-rows') || 0)
    };
}
