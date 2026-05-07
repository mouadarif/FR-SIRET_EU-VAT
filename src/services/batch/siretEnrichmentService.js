const DEFAULT_SIRET_COLUMNS = [
    'FR_SIRET',
    'SIRET',
    'Siret',
    'siret',
    'Enriched_SIRET',
    'Original_SIRET'
];

const DEFAULT_ENDPOINT = '/api/enrich-by-siret';

export function detectSiretColumn(columns = []) {
    return DEFAULT_SIRET_COLUMNS.find((candidate) => columns.includes(candidate)) || null;
}

function filenameFromDisposition(value) {
    if (!value) return '';

    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);
    if (utf8Match) {
        return decodeURIComponent(utf8Match[1].replace(/"/g, ''));
    }

    const plainMatch = /filename="?([^";]+)"?/i.exec(value);
    return plainMatch ? plainMatch[1] : '';
}

async function readErrorMessage(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const payload = await response.json().catch(() => null);
        return payload?.detail || payload?.message || `Request failed with status ${response.status}`;
    }

    const text = await response.text().catch(() => '');
    return text || `Request failed with status ${response.status}`;
}

export async function submitSiretEnrichment({
    file,
    siretColumn,
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = fetch
}) {
    if (!(file instanceof File)) {
        throw new Error('A real file is required for backend enrichment.');
    }

    if (!siretColumn) {
        throw new Error('Select the SIRET column before enrichment.');
    }

    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('siret_column', siretColumn);

    const response = await fetchImpl(endpoint, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }

    const blob = await response.blob();
    const filename = response.headers.get('x-enriched-filename')
        || filenameFromDisposition(response.headers.get('content-disposition'))
        || 'enriched_by_siret.xlsx';
    const rowCount = Number.parseInt(response.headers.get('x-input-rows') || '', 10);

    return {
        blob,
        filename,
        rowCount: Number.isFinite(rowCount) ? rowCount : null
    };
}
