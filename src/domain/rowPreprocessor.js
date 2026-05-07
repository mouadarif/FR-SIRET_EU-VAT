import queryBuilder from '../api/queryBuilder.js';
import { IDENTITY_MAX_HYPOTHESES } from './identityConfig.js';
import {
    LEGAL_FORMS,
    STOPWORDS,
    applyOcrHints,
    dropStopwords,
    expandAbbreviations,
    normalizeAddress,
    normalizeCity,
    normalizeToken,
    stripLegalForms
} from './normalizationDictionaries.js';

const VAT_FR_PATTERN = /\bFR[0-9A-Z]{2}[0-9]{9}\b/i;
const INVOICE_PATTERN = /\b(FACTURE|INVOICE|REF|REFERENCE|BON|BC|BL)\b/i;
const PHONE_PATTERN = /\b(\+33|0[1-9][0-9]{8})\b/;

function compactSpaces(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function extractPotentialIds(raw) {
    // Scan original values first (exact digits only — no scientific notation expansion).
    // Scientific-notation values (e.g. "4,98155E+13") give wrong 14-digit numbers that
    // would cause SIRET_CONTRADICTION hardVeto; skip them entirely.
    const rawValues = Object.values(raw || {});
    const exactText = rawValues
        .map((value) => String(value || ''))
        .filter((value) => !/[eE]/.test(value))   // skip scientific notation
        .join(' ');

    const digits = exactText.match(/\d{9,14}/g) || [];
    let siret = null;
    let siren = null;

    for (const candidate of digits) {
        if (!siret && candidate.length === 14) siret = candidate;
        if (!siren && candidate.length === 9) siren = candidate;
    }

    // Derive SIREN from SIRET when no explicit 9-digit value found
    if (siret && !siren) siren = siret.slice(0, 9);

    return { siret, siren };
}

function classifyToken(rawToken) {
    const token = normalizeToken(rawToken);
    if (!token) return 'noise';
    if (STOPWORDS.has(token)) return 'noise';
    if (INVOICE_PATTERN.test(token) || PHONE_PATTERN.test(token) || /^[A-Z]*\d{5,}$/.test(token)) return 'noise';
    if (/^\d{9}$|^\d{14}$/.test(token)) return 'identity-bearing';
    if (LEGAL_FORMS.has(token)) return 'supporting';
    if (token.length <= 2) return 'noise';
    return 'supporting';
}

function tokenizeRow(raw) {
    const values = Object.values(raw || {}).map((value) => String(value || ''));
    const tokens = values
        .flatMap((value) => value.split(/[\s,;|/\\\-]+/))
        .map((token) => compactSpaces(token))
        .filter(Boolean);

    const identityBearing = [];
    const supporting = [];
    const noise = [];

    for (const token of tokens) {
        const kind = classifyToken(token);
        if (kind === 'identity-bearing') identityBearing.push(token);
        else if (kind === 'supporting') supporting.push(token);
        else noise.push(token);
    }

    return {
        identityBearing: [...new Set(identityBearing)],
        supporting: [...new Set(supporting)],
        noise: [...new Set(noise)]
    };
}

function pushPlan(plan, item) {
    if (plan.length >= IDENTITY_MAX_HYPOTHESES) return;
    plan.push(item);
}

function asPhrase(value) {
    const cleaned = compactSpaces(value);
    return cleaned ? `"${cleaned}"` : '';
}

function buildSearchQuery({ name, postalCode, city, fuzzy = false, acronym = false }) {
    const queryParts = [];
    if (name) {
        const stripped = stripLegalForms(name);
        const normalizedName = expandAbbreviations(applyOcrHints(stripped || name));
        if (acronym) {
            const acronymValue = normalizedName
                .split(' ')
                .filter((token) => token.length >= 2)
                .map((token) => token[0])
                .join('');
            if (acronymValue.length >= 2) {
                queryParts.push(`denominationUniteLegale:*${queryBuilder.utils.escapeLucene(acronymValue)}*`);
            }
        } else if (fuzzy) {
            queryParts.push(`denominationUniteLegale:${asPhrase(queryBuilder.utils.escapeLucene(normalizedName))}~`);
        } else {
            const nameQuery = queryBuilder.utils.buildNameSearchQuery(normalizedName);
            if (nameQuery) queryParts.push(nameQuery);
        }
    }

    if (postalCode) {
        queryParts.push(`codePostalEtablissement:${postalCode}`);
    } else if (city) {
        const escapedCity = queryBuilder.utils.escapeLucene(normalizeCity(city));
        queryParts.push(`libelleCommuneEtablissement:*${escapedCity}*`);
    }
    return queryParts.join(' AND ') || null;
}

function buildRaisonSocialeQuery({ name, postalCode, city }) {
    const stripped = stripLegalForms(name || '');
    const normalizedName = expandAbbreviations(applyOcrHints(stripped || name || ''));
    if (!normalizedName) return null;

    const escaped = queryBuilder.utils.escapeLucene(normalizedName);
    const tokens = escaped.split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;

    const nameQuery = tokens.length === 1
        ? `raisonSociale:*${tokens[0]}*`
        : `(${tokens.map((token) => `raisonSociale:*${token}*`).join(' AND ')})`;

    const filters = [];
    if (postalCode) filters.push(`codePostalEtablissement:${postalCode}`);
    else if (city) filters.push(`libelleCommuneEtablissement:*${queryBuilder.utils.escapeLucene(normalizeCity(city))}*`);

    return [nameQuery, ...filters].join(' AND ');
}

function getAddressTokens(raw) {
    const normalized = normalizeAddress(raw.Enriched_Address || raw.Original_Address || raw.Address || '');
    return normalized
        .split(' ')
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
        .slice(0, 8);
}

/**
 * Build deterministic identity hypothesis from a canonical row.
 * @param {{
 *  raw: Record<string, any>,
 *  identifiers: { siret?: string, siren?: string, name?: string, city?: string, postalCode?: string },
 *  audit?: { rawName?: string, rawCity?: string, rawPostalCode?: string }
 * }} canonical
 */
export function buildDeterministicIdentityHypothesis(canonical) {
    const raw = canonical?.raw || {};
    const identifiers = canonical?.identifiers || {};
    const tokenBuckets = tokenizeRow(raw);
    const extractedIds = extractPotentialIds(raw);

    const possibleSiret = identifiers.siret || extractedIds.siret || null;
    const possibleSiren = identifiers.siren || extractedIds.siren || null;
    const legalName = compactSpaces(identifiers.name || canonical?.audit?.rawName || '');
    const city = normalizeCity(identifiers.city || canonical?.audit?.rawCity || '');
    const postalCode = cleanDigits(identifiers.postalCode || canonical?.audit?.rawPostalCode || '').slice(0, 5);
    const legalFormMatch = (expandAbbreviations(applyOcrHints(legalName)).match(/\b(SARL|SASU?|EURL|SCI|SA|SNC|SELARL|SELAS|ASSOCIATION)\b/) || [null, null])[1];
    const transactionDate = canonical?.transactionDate || null;

    const vatText = Object.values(raw || {}).map((v) => String(v || '')).join(' ');
    const possibleVat = (vatText.match(VAT_FR_PATTERN) || [null])[0];

    const legalNamePrimary = expandAbbreviations(applyOcrHints(legalName));
    const legalNameCandidates = legalNamePrimary ? [legalNamePrimary] : [];
    const tradeCandidate = compactSpaces(raw.Enriched_Trade_Name || raw.Original_Trade_Name || raw.Trade_Name || '');
    const tradeNameCandidates = tradeCandidate ? [expandAbbreviations(applyOcrHints(tradeCandidate))] : [];
    const addressTokens = getAddressTokens(raw);

    const missingCritical = [];
    if (!possibleSiret && !possibleSiren && !legalNameCandidates.length) missingCritical.push('identifier_or_name');
    if (!postalCode && !city) missingCritical.push('location_hint');

    const ambiguityFlags = [];
    if (!possibleSiret && !possibleSiren && legalNameCandidates.length === 0) ambiguityFlags.push('no_strong_identity_signal');
    if (legalNameCandidates.length > 0 && !postalCode && !city) ambiguityFlags.push('name_without_location');
    if (addressTokens.length === 0 && !postalCode && !city) ambiguityFlags.push('weak_geo_signal');

    const queryPlan = [];
    if (possibleSiret) {
        pushPlan(queryPlan, {
            priority: 1,
            endpoint: 'direct_siret',
            lookupValue: possibleSiret,
            q: null,
            params: {
                nombre: null,
                tri: null,
                date: transactionDate,
                champs: ['siret', 'siren', 'uniteLegale.denominationUniteLegale', 'adresseEtablissement.codePostalEtablissement']
            },
            hypothesisType: 'strict_identifier',
            why: 'Valid 14-digit SIRET found in input'
        });
    }

    if (possibleSiren) {
        pushPlan(queryPlan, {
            priority: queryPlan.length + 1,
            endpoint: 'direct_siren',
            lookupValue: possibleSiren,
            q: null,
            params: {
                nombre: null,
                tri: null,
                date: transactionDate,
                champs: ['siren', 'denominationUniteLegale']
            },
            hypothesisType: 'strict_identifier',
            why: 'Valid 9-digit SIREN found in input'
        });
    }

    const strictLegalQuery = buildSearchQuery({
        name: legalNameCandidates[0] || '',
        postalCode,
        city
    });
    if (strictLegalQuery) {
        pushPlan(queryPlan, {
            priority: queryPlan.length + 1,
            endpoint: 'search_siret',
            q: strictLegalQuery,
            params: {
                nombre: 50,
                tri: null,
                date: transactionDate,
                champs: [
                    'siret',
                    'siren',
                    'uniteLegale.denominationUniteLegale',
                    'adresseEtablissement.codePostalEtablissement',
                    'adresseEtablissement.libelleCommuneEtablissement'
                ]
            },
            hypothesisType: 'strict_legal_name',
            why: 'Strict legal-name hypothesis with geo hints'
        });
    }

    const tradeQuery = buildSearchQuery({
        name: tradeNameCandidates[0] || '',
        postalCode,
        city
    });
    if (tradeQuery && tradeQuery !== strictLegalQuery) {
        pushPlan(queryPlan, {
            priority: queryPlan.length + 1,
            endpoint: 'search_siret',
            q: tradeQuery,
            params: {
                nombre: 50,
                tri: null,
                date: transactionDate,
                champs: ['siret', 'siren', 'uniteLegale.denominationUniteLegale']
            },
            hypothesisType: 'trade_name',
            why: 'Trade-name hypothesis'
        });
    }

    const raisonSocialeQuery = buildRaisonSocialeQuery({
        name: legalNameCandidates[0] || tradeNameCandidates[0] || '',
        postalCode,
        city
    });
    if (raisonSocialeQuery && raisonSocialeQuery !== strictLegalQuery && raisonSocialeQuery !== tradeQuery) {
        pushPlan(queryPlan, {
            priority: queryPlan.length + 1,
            endpoint: 'search_siret',
            q: raisonSocialeQuery,
            params: {
                nombre: 50,
                tri: null,
                date: transactionDate,
                champs: ['siret', 'siren', 'denominationUniteLegale']
            },
            hypothesisType: 'raison_sociale_fallback',
            why: 'Controlled raisonSociale fallback lane'
        });
    }

    const fuzzyQuery = buildSearchQuery({
        name: legalNameCandidates[0] || tradeNameCandidates[0] || '',
        postalCode: '',
        city,
        fuzzy: true
    });
    if (fuzzyQuery) {
        pushPlan(queryPlan, {
            priority: queryPlan.length + 1,
            endpoint: 'search_siret',
            q: fuzzyQuery,
            params: {
                nombre: 75,
                tri: null,
                date: transactionDate,
                champs: ['siret', 'siren', 'uniteLegale.denominationUniteLegale']
            },
            hypothesisType: 'typo_tolerant',
            why: 'Typo/OCR tolerant hypothesis'
        });
    }

    const acronymQuery = buildSearchQuery({
        name: legalNameCandidates[0] || tradeNameCandidates[0] || '',
        city,
        postalCode: '',
        acronym: true
    });
    if (acronymQuery) {
        pushPlan(queryPlan, {
            priority: queryPlan.length + 1,
            endpoint: 'search_siret',
            q: acronymQuery,
            params: {
                nombre: 50,
                tri: null,
                date: transactionDate,
                champs: ['siret', 'siren', 'uniteLegale.denominationUniteLegale']
            },
            hypothesisType: 'acronym_abbreviation',
            why: 'Acronym/abbreviation hypothesis'
        });
    }

    const identitySignalCount = [
        possibleSiret,
        possibleSiren,
        legalNameCandidates[0],
        tradeNameCandidates[0],
        postalCode || city
    ].filter(Boolean).length;

    const identityExtractConfidence = Math.min(1, 0.15 + identitySignalCount * 0.17);
    const matchReadinessConfidence = possibleSiret
        ? 0.95
        : possibleSiren
            ? 0.85
            : legalNameCandidates.length > 0
                ? 0.65
                : 0.2;

    const nextAction = possibleSiret || possibleSiren
        ? 'DIRECT_LOOKUP'
        : legalNameCandidates.length > 0 || tradeNameCandidates.length > 0
            ? 'SEARCH'
            : missingCritical.length > 0
                ? 'NEEDS_MORE_DATA'
                : 'MANUAL_REVIEW';

    return {
        row_analysis: {
            identity_signals: {
                possible_siret: possibleSiret,
                possible_siren: possibleSiren,
                possible_vat_fr: possibleVat,
                legal_name_candidates: legalNameCandidates,
                trade_name_candidates: tradeNameCandidates,
                postal_code: postalCode || null,
                city: city || null,
                transaction_date: transactionDate,
                address_tokens: addressTokens,
                legal_form_hint: legalFormMatch,
                activity_hint: null
            },
            identity_bearing_tokens: tokenBuckets.identityBearing,
            supporting_tokens: dropStopwords(tokenBuckets.supporting),
            noise_tokens: tokenBuckets.noise,
            missing_critical_signals: missingCritical,
            ambiguity_flags: ambiguityFlags
        },
        query_plan: queryPlan.slice(0, IDENTITY_MAX_HYPOTHESES),
        confidence: {
            identity_extract_confidence: Number(identityExtractConfidence.toFixed(4)),
            match_readiness_confidence: Number(matchReadinessConfidence.toFixed(4))
        },
        next_action: nextAction,
        metadata: {
            source: 'deterministic'
        }
    };
}
