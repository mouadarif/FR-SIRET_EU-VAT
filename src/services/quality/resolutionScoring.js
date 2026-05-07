/**
 * Deterministic confidence scoring for entity resolution.
 */
import { getConfidenceBand } from '../../domain/identityConfig.js';

function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
}

function normalizeName(value) {
    if (!value) return '';
    return String(value)
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenSet(value) {
    return new Set(normalizeName(value).split(' ').filter(Boolean));
}

function jaccardSimilarity(a, b) {
    const tokensA = tokenSet(a);
    const tokensB = tokenSet(b);
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    tokensA.forEach((token) => {
        if (tokensB.has(token)) intersection += 1;
    });

    const union = tokensA.size + tokensB.size - intersection;
    if (union === 0) return 0;
    return intersection / union;
}

/**
 * @param {{
 * input: { identifiers?: { siret?: string, siren?: string, name?: string, city?: string, postalCode?: string, department?: string } },
 * resolution: { metadata?: { tierUsed?: string, candidateCount?: number, apiScore?: number }, entity?: any }
 * }} params
 */
export function scoreResolutionConfidence(params) {
    const identifiers = params?.input?.identifiers || {};
    const metadata = params?.resolution?.metadata || {};
    const entity = params?.resolution?.entity || {};

    let score = 0;
    const reasons = [];

    const tier = String(metadata.tierUsed || '').toLowerCase();
    if (tier.includes('siret')) {
        score += 0.55;
        reasons.push('Exact SIRET match');
    } else if (tier.includes('siren')) {
        score += 0.45;
        reasons.push('SIREN-based resolution');
    } else if (tier.includes('tier2')) {
        score += 0.33;
        reasons.push('Tier 2 name+postal/city match');
    } else if (tier.includes('tier3')) {
        score += 0.27;
        reasons.push('Tier 3 department match');
    } else if (tier.includes('tier4')) {
        score += 0.2;
        reasons.push('Tier 4 AI-assisted match');
    } else if (tier.includes('tier5')) {
        score += 0.12;
        reasons.push('Tier 5 broad name-only match');
    }

    const resolvedPostal = entity?.adresseEtablissement?.codePostalEtablissement || '';
    const resolvedCity = entity?.adresseEtablissement?.libelleCommuneEtablissement || '';
    const resolvedDepartment = resolvedPostal ? String(resolvedPostal).slice(0, 2) : '';

    if (identifiers.postalCode && resolvedPostal && String(identifiers.postalCode) === String(resolvedPostal)) {
        score += 0.14;
        reasons.push('Postal code agreement');
    }

    if (identifiers.city && resolvedCity) {
        const cityMatch = normalizeName(identifiers.city) === normalizeName(resolvedCity);
        if (cityMatch) {
            score += 0.11;
            reasons.push('City agreement');
        }
    }

    if (identifiers.department && resolvedDepartment && identifiers.department === resolvedDepartment) {
        score += 0.06;
        reasons.push('Department agreement');
    }

    if (identifiers.name) {
        const resolvedName = entity?.uniteLegale?.denominationUniteLegale
            || entity?.periodesEtablissement?.[0]?.denominationUsuelleEtablissement
            || '';
        const similarity = jaccardSimilarity(identifiers.name, resolvedName);
        score += 0.18 * similarity;
        if (similarity >= 0.6) reasons.push('Strong name similarity');
    }

    if (typeof metadata.apiScore === 'number') {
        const normalizedApiScore = clamp(metadata.apiScore / 100, 0, 1);
        score += 0.12 * normalizedApiScore;
        reasons.push('API score signal');
    }

    if ((metadata.candidateCount || 0) > 1) {
        score -= 0.08;
        reasons.push('Multiple candidates');
    }

    const normalizedScore = clamp(score, 0, 1);
    const needsReview = normalizedScore < 0.45;

    return {
        score: Number(normalizedScore.toFixed(4)),
        confidenceBand: getConfidenceBand(normalizedScore),
        needsReview,
        reasons
    };
}
