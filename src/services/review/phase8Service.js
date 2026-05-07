import { applyReviewLabels, buildReviewQueue } from './reviewQueueService.js';
import { generateLearningArtifacts } from './learningLoopService.js';

/**
 * Run Phase 8 human-review + learning loop artifacts.
 *
 * @param {{
 *  runId?: string,
 *  finalDecisions?: Array<any>,
 *  results?: Array<Record<string, any>>,
 *  ambiguityReport?: Array<any>,
 *  reviewLabels?: Array<any>,
 *  reviewThresholds?: {
 *   autoResolveThreshold?: number,
 *   ambiguityMargin?: number,
 *   lowScoreForReview?: number
 *  }
 * }} params
 */
export function runPhase8ReviewAndLearning(params = {}) {
    const runId = params.runId || '';
    const finalDecisions = Array.isArray(params.finalDecisions) ? params.finalDecisions : [];
    const results = Array.isArray(params.results) ? params.results : [];
    const ambiguityReport = Array.isArray(params.ambiguityReport) ? params.ambiguityReport : [];
    const reviewLabels = Array.isArray(params.reviewLabels) ? params.reviewLabels : [];

    const reviewCases = buildReviewQueue({
        runId,
        finalDecisions,
        results,
        ambiguityReport,
        thresholds: params.reviewThresholds || {}
    });

    const labelApplication = applyReviewLabels({
        finalDecisions,
        reviewLabels
    });

    const learningArtifacts = generateLearningArtifacts({
        runId,
        finalDecisions: labelApplication.finalDecisions,
        reviewCases,
        reviewLabels
    });

    return {
        reviewCases,
        appliedLabels: labelApplication.appliedLabels,
        finalDecisionsAfterReview: labelApplication.finalDecisions,
        learningArtifacts
    };
}

