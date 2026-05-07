function readThresholdFromEnv(name, fallback) {
    const envValue = import.meta.env?.[name];
    const parsed = Number.parseFloat(String(envValue ?? ''));
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < 0) return 0;
    if (parsed > 1) return 1;
    return parsed;
}

function readNumberFromEnv(name, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
    const envValue = import.meta.env?.[name];
    const parsed = Number.parseFloat(String(envValue ?? ''));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

export const IDENTITY_THRESHOLDS = {
    autoAcceptThreshold: readThresholdFromEnv('VITE_IDENTITY_AUTO_ACCEPT_THRESHOLD', 0.86),
    autoAcceptWeakThreshold: readThresholdFromEnv('VITE_IDENTITY_AUTO_ACCEPT_WEAK_THRESHOLD', 0.92),
    reviewThreshold: readThresholdFromEnv('VITE_IDENTITY_REVIEW_THRESHOLD', 0.7),
    minSignalThreshold: readThresholdFromEnv('VITE_IDENTITY_MIN_SIGNAL_THRESHOLD', 0.3),
    marginThreshold: readThresholdFromEnv('VITE_IDENTITY_MARGIN_THRESHOLD', 0.08),
    eodAcceptThreshold: readThresholdFromEnv('VITE_IDENTITY_EOD_ACCEPT_THRESHOLD', 0.7),
    eodMarginThreshold: readThresholdFromEnv('VITE_IDENTITY_EOD_MARGIN_THRESHOLD', 0.05)
};

export const ENRICHMENT_BATCH_SIZES = {
    llmExtractionBatch: readNumberFromEnv('VITE_LLM_EXTRACTION_BATCH_SIZE', 25, 1, 200),
    queryBatch: readNumberFromEnv('VITE_QUERY_BATCH_SIZE', 30, 1, 300),
    scoringBatch: readNumberFromEnv('VITE_SCORING_BATCH_SIZE', 100, 1, 500)
};

const CONFIDENCE_BANDS = {
    high: { min: 0.8, label: 'HIGH' },
    medium: { min: 0.55, label: 'MEDIUM' },
    low: { min: 0, label: 'LOW' }
};

export const IDENTITY_MAX_HYPOTHESES = 5;
export const IDENTITY_PROMPT_VERSION = 'identity-agent-v1';

export function getConfidenceBand(score) {
    if (score >= CONFIDENCE_BANDS.high.min) return CONFIDENCE_BANDS.high.label;
    if (score >= CONFIDENCE_BANDS.medium.min) return CONFIDENCE_BANDS.medium.label;
    return CONFIDENCE_BANDS.low.label;
}
