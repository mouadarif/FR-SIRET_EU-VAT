function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    if (isObject(value)) {
        const keys = Object.keys(value).sort();
        const body = keys
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',');
        return `{${body}}`;
    }
    return JSON.stringify(value);
}

function hashString(value) {
    const input = String(value || '');
    let hash = 5381;
    for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) + hash) + input.charCodeAt(i);
        hash &= 0x7fffffff;
    }
    return hash.toString(16).padStart(8, '0');
}

export function buildRawHash(rawRow) {
    return hashString(stableStringify(rawRow || {}));
}

export function buildIdempotencyKey({ sourceSystem = '', sourceFileId = '', sourceLineNumber = 0, rawHash = '' }) {
    return hashString(`${sourceSystem}|${sourceFileId}|${sourceLineNumber}|${rawHash}`);
}

function mapToSortedArray(map, sortBy) {
    const values = [...map.values()];
    if (!sortBy) return values;
    return values.sort((left, right) => {
        const a = String(left?.[sortBy] || '');
        const b = String(right?.[sortBy] || '');
        return a.localeCompare(b);
    });
}

export class PipelinePersistenceStore {
    constructor(runId) {
        this.runId = runId || '';
        this.rawRowMap = new Map();
        this.signalEnvelopeMap = new Map();
        this.queryAttemptMap = new Map();
        this.candidateSnapshotMap = new Map();
        this.candidateScoreMap = new Map();
        this.resolutionDecisionMap = new Map();
        this.currentLinkMap = new Map();
    }

    upsertRawRow(entry) {
        if (!entry?.row_id) return;
        this.rawRowMap.set(entry.row_id, entry);
    }

    upsertSignalEnvelope(entry) {
        if (!entry?.row_id) return;
        this.signalEnvelopeMap.set(entry.row_id, entry);
    }

    upsertQueryAttempt(entry) {
        if (!entry?.query_id) return;
        this.queryAttemptMap.set(entry.query_id, entry);
    }

    upsertCandidateSnapshot(entry) {
        if (!entry?.candidate_snapshot_id) return;
        this.candidateSnapshotMap.set(entry.candidate_snapshot_id, entry);
    }

    upsertCandidateScore(entry) {
        if (!entry?.row_id || !entry?.siret) return;
        this.candidateScoreMap.set(`${entry.row_id}::${entry.siret}`, entry);
    }

    upsertResolutionDecision(entry) {
        if (!entry?.row_id) return;
        this.resolutionDecisionMap.set(entry.row_id, entry);
    }

    upsertCurrentLink(entry) {
        if (!entry?.row_id) return;
        this.currentLinkMap.set(entry.row_id, entry);
    }

    snapshot() {
        return {
            raw_row: mapToSortedArray(this.rawRowMap, 'row_id'),
            signal_envelope: mapToSortedArray(this.signalEnvelopeMap, 'row_id'),
            query_attempt: mapToSortedArray(this.queryAttemptMap, 'query_id'),
            candidate_snapshot: mapToSortedArray(this.candidateSnapshotMap, 'candidate_snapshot_id'),
            candidate_score: mapToSortedArray(this.candidateScoreMap, 'row_id'),
            resolution_decision: mapToSortedArray(this.resolutionDecisionMap, 'row_id'),
            resolution_link_current: mapToSortedArray(this.currentLinkMap, 'row_id')
        };
    }
}
