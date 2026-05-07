const llmExtractionCache = new Map();
const inseeQueryCache = new Map();
const candidateScoreCache = new Map();
const entityMemory = new Map();
const lane1SiretEntityCache = new Map();
const lane1SirenCandidatesCache = new Map();

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function hashRowForExtraction(row) {
    const payload = {
        name: row?.identifiers?.name || '',
        city: row?.identifiers?.city || '',
        postalCode: row?.identifiers?.postalCode || '',
        siret: row?.identifiers?.siret || '',
        siren: row?.identifiers?.siren || '',
        raw: row?.raw || {}
    };
    return stableStringify(payload);
}

export function getCachedLlmExtraction(key) {
    return llmExtractionCache.get(key) || null;
}

export function setCachedLlmExtraction(key, value) {
    llmExtractionCache.set(key, value);
}

export function getCachedInseeQuery(signature) {
    return inseeQueryCache.get(signature) || null;
}

export function setCachedInseeQuery(signature, value) {
    inseeQueryCache.set(signature, value);
}

export function getCachedCandidateScore(signature) {
    return candidateScoreCache.get(signature) || null;
}

export function setCachedCandidateScore(signature, value) {
    candidateScoreCache.set(signature, value);
}

export function buildCandidateScoreSignature(rowSignature, candidateId) {
    return `${rowSignature}::${candidateId}`;
}

function memoryKey(nameSignature, city, candidateId) {
    return `${nameSignature}::${city || ''}::${candidateId || ''}`;
}

function lane1Key(id, date = '') {
    return `${date || 'current'}::${id || ''}`;
}

function dedupeCandidatesBySiret(candidates = []) {
    const seen = new Set();
    const out = [];
    for (const candidate of candidates) {
        const siret = String(candidate?.siret || '');
        const key = siret || JSON.stringify(candidate || {});
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(candidate);
    }
    return out;
}

export function updateEntityMemory({ nameSignature, city, candidateId, confidence }) {
    if (!nameSignature || !candidateId) return;
    const key = memoryKey(nameSignature, city, candidateId);
    const current = entityMemory.get(key) || { count: 0, totalConfidence: 0 };
    const next = {
        count: current.count + 1,
        totalConfidence: current.totalConfidence + Math.max(0, Math.min(1, confidence || 0))
    };
    entityMemory.set(key, next);
}

export function listEntityMemoryEntries() {
    return Array.from(entityMemory.entries()).map(([key, value]) => ({ key, ...value }));
}

export function getLane1SiretEntity({ siret, date = '' }) {
    const key = lane1Key(siret, date);
    return lane1SiretEntityCache.get(key) || null;
}

export function setLane1SiretEntity({ siret, date = '', entity }) {
    if (!siret || !entity) return;
    const key = lane1Key(siret, date);
    lane1SiretEntityCache.set(key, entity);
}

export function getLane1SirenCandidates({ siren, date = '' }) {
    const key = lane1Key(siren, date);
    return lane1SirenCandidatesCache.get(key) || null;
}

export function setLane1SirenCandidates({ siren, date = '', candidates = [] }) {
    if (!siren) return;
    const key = lane1Key(siren, date);
    const existing = lane1SirenCandidatesCache.get(key) || [];
    lane1SirenCandidatesCache.set(key, dedupeCandidatesBySiret([...existing, ...candidates]));
}

export function clearEnrichmentCaches() {
    llmExtractionCache.clear();
    inseeQueryCache.clear();
    candidateScoreCache.clear();
    lane1SiretEntityCache.clear();
    lane1SirenCandidatesCache.clear();
}
