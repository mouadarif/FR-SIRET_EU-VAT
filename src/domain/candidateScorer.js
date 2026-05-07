import {
    buildCandidateScoreSignature,
    getCachedCandidateScore,
    hashRowForExtraction,
    setCachedCandidateScore
} from '../services/memory/enrichmentCaches.js';
import { normalizeAddress, normalizeCity, normalizeToken, stripLegalForms } from './normalizationDictionaries.js';

const FEATURE_WEIGHTS = {
    identifier: 0.52,
    name: 0.23,
    geo: 0.13,
    address: 0.05,
    temporal: 0.04,
    legal_form: 0.02,
    lucene: 0.01
};

const SEVERE_NAME_MISMATCH_THRESHOLD = 0.35;
const SEVERE_CITY_MISMATCH_THRESHOLD = 0.45;

function normalize(value) {
    return String(value || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanDigits(value, size = null) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!size) return digits;
    return digits.length === size ? digits : '';
}

function clamp01(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
}

function parseNumber(value) {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
}

function parseTransactionDate(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(raw)) {
        const [dd, mm, yyyy] = raw.split(/[/-]/);
        return `${yyyy}-${mm}-${dd}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function tokenSet(value) {
    return new Set(normalize(value).split(' ').filter(Boolean));
}

function tokenSetRatio(leftValue, rightValue) {
    const left = tokenSet(leftValue);
    const right = tokenSet(rightValue);
    if (!left.size || !right.size) return 0;
    let intersection = 0;
    for (const token of left) {
        if (right.has(token)) intersection += 1;
    }
    return (2 * intersection) / (left.size + right.size);
}

function tokenContainment(leftValue, rightValue) {
    const left = tokenSet(leftValue);
    const right = tokenSet(rightValue);
    if (!left.size || !right.size) return 0;

    let contained = 0;
    for (const token of left) {
        if (right.has(token)) contained += 1;
    }
    return contained / left.size;
}

function jaroWinkler(leftValue, rightValue) {
    const left = normalize(leftValue);
    const right = normalize(rightValue);
    if (left === right) return 1;
    if (!left.length || !right.length) return 0;

    const matchDistance = Math.max(Math.floor(Math.max(left.length, right.length) / 2) - 1, 0);
    const leftMatches = new Array(left.length).fill(false);
    const rightMatches = new Array(right.length).fill(false);

    let matches = 0;
    for (let i = 0; i < left.length; i += 1) {
        const start = Math.max(0, i - matchDistance);
        const end = Math.min(i + matchDistance + 1, right.length);
        for (let j = start; j < end; j += 1) {
            if (rightMatches[j] || left[i] !== right[j]) continue;
            leftMatches[i] = true;
            rightMatches[j] = true;
            matches += 1;
            break;
        }
    }

    if (matches === 0) return 0;

    let transpositions = 0;
    let pointer = 0;
    for (let i = 0; i < left.length; i += 1) {
        if (!leftMatches[i]) continue;
        while (!rightMatches[pointer]) pointer += 1;
        if (left[i] !== right[pointer]) transpositions += 1;
        pointer += 1;
    }

    const jaro = (
        matches / left.length
        + matches / right.length
        + (matches - transpositions / 2) / matches
    ) / 3;

    let prefix = 0;
    for (let i = 0; i < Math.min(4, left.length, right.length); i += 1) {
        if (left[i] !== right[i]) break;
        prefix += 1;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
}

function weightedAverage(values) {
    let weighted = 0;
    let totalWeight = 0;
    for (const item of values) {
        if (typeof item?.value !== 'number' || !Number.isFinite(item.value)) continue;
        if (typeof item?.weight !== 'number' || item.weight <= 0) continue;
        weighted += item.value * item.weight;
        totalWeight += item.weight;
    }
    if (totalWeight === 0) return null;
    return weighted / totalWeight;
}

function extractDepartment(postalCode) {
    const digits = cleanDigits(postalCode);
    if (digits.length < 2) return '';
    if (digits.startsWith('97') || digits.startsWith('98')) return digits.slice(0, 3);
    return digits.slice(0, 2);
}

function extractInputAddress(raw = {}) {
    return raw.Enriched_Address
        || raw.Original_Address
        || raw.Address
        || raw.adresse
        || '';
}

function normalizeCoreName(value) {
    return normalizeToken(stripLegalForms(value || '') || value || '');
}

function detectLegalFormFamily(value) {
    const normalized = normalize(value);
    if (!normalized) return '';
    if (/\bSASU?\b/.test(normalized)) return 'SAS_FAMILY';
    if (/\bSARL\b|\bEURL\b|\bSARLU\b/.test(normalized)) return 'SARL_FAMILY';
    if (/\bSA\b|\bSOCIETE ANONYME\b/.test(normalized)) return 'SA';
    if (/\bSCI\b/.test(normalized)) return 'SCI';
    if (/\bEI\b|\bEIRL\b|\bENTREPRENEUR INDIVIDUEL\b/.test(normalized)) return 'EI';
    return '';
}

function sameFamilyButVariant(leftFamily, rightFamily) {
    if (!leftFamily || !rightFamily) return false;
    if (leftFamily === rightFamily) return false;
    const corporate = new Set(['SAS_FAMILY', 'SARL_FAMILY', 'SA']);
    return corporate.has(leftFamily) && corporate.has(rightFamily);
}

function detectCandidateLegalFormFamily(candidate) {
    const category = normalize(
        candidate?.uniteLegale?.categorieJuridiqueUniteLegale
        || candidate?.categorieJuridiqueUniteLegale
        || ''
    );
    if (category.includes('SAS')) return 'SAS_FAMILY';
    if (category.includes('SARL') || category.includes('EURL')) return 'SARL_FAMILY';
    if (category.includes('SOCIETE ANONYME') || category === 'SA') return 'SA';
    if (category.includes('SCI')) return 'SCI';
    if (category.includes('ENTREPRENEUR INDIVIDUEL') || category === 'EI') return 'EI';

    return detectLegalFormFamily(
        candidate?.uniteLegale?.denominationUniteLegale
        || candidate?.denominationUniteLegale
        || ''
    );
}

function candidateId(candidate) {
    return candidate?.siret || candidate?.siren || '';
}

function candidateSiret(candidate) {
    return cleanDigits(candidate?.siret || '', 14);
}

function candidateSiren(candidate) {
    return cleanDigits(candidate?.siren || '', 9);
}

function candidateNameValues(candidate) {
    const legal = candidate?.uniteLegale?.denominationUniteLegale || candidate?.denominationUniteLegale || '';
    const usual = candidate?.periodesEtablissement?.[0]?.denominationUsuelleEtablissement
        || candidate?.denominationUsuelleEtablissement
        || candidate?.periodesEtablissement?.[0]?.enseigne1Etablissement
        || candidate?.enseigne1Etablissement
        || '';
    return [legal, usual].filter(Boolean);
}

function candidateCity(candidate) {
    return candidate?.adresseEtablissement?.libelleCommuneEtablissement
        || candidate?.libelleCommuneEtablissement
        || '';
}

function candidatePostal(candidate) {
    return cleanDigits(
        candidate?.adresseEtablissement?.codePostalEtablissement
        || candidate?.codePostalEtablissement
        || '',
        5
    );
}

function candidateStreetNumber(candidate) {
    return cleanDigits(
        candidate?.adresseEtablissement?.numeroVoieEtablissement
        || candidate?.numeroVoieEtablissement
        || ''
    );
}

function candidateStreetName(candidate) {
    const address = candidate?.adresseEtablissement || {};
    return [
        address.typeVoieEtablissement || candidate?.typeVoieEtablissement,
        address.libelleVoieEtablissement || candidate?.libelleVoieEtablissement
    ].filter(Boolean).join(' ');
}

function candidateStatus(candidate) {
    const status = normalize(
        candidate?.periodesEtablissement?.[0]?.etatAdministratifEtablissement
        || candidate?.etatAdministratifEtablissement
        || ''
    );
    if (status === 'A' || status.includes('ACTIF') || status.includes('ACTIVE')) return 'A';
    if (status === 'F' || status.includes('FERME') || status.includes('CLOSED')) return 'F';
    return '';
}

function isHeadquarters(candidate) {
    return candidate?.etablissementSiege === true
        || candidate?.periodesEtablissement?.[0]?.etablissementSiege === true;
}

function extractRawLuceneScore(candidate) {
    return parseNumber(
        candidate?.score
        ?? candidate?.raw_lucene_score
        ?? candidate?.relevanceScore
    );
}

function computeLucenePriors(candidates) {
    const scores = candidates
        .map((candidate) => ({ id: candidateId(candidate), raw: extractRawLuceneScore(candidate) }))
        .filter((item) => item.id && item.raw !== null);

    const priors = new Map();
    if (!scores.length) return priors;

    const values = scores.map((item) => item.raw).sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];

    if (min === max) {
        for (const item of scores) {
            priors.set(item.id, 1);
        }
        return priors;
    }

    for (const item of scores) {
        const normalized = (item.raw - min) / (max - min);
        priors.set(item.id, clamp01(normalized));
    }
    return priors;
}

function readSignalConfidence(input = {}, fieldName) {
    const direct = parseNumber(input?.field_confidences?.[fieldName]);
    if (direct !== null) return clamp01(direct);

    const llmField = parseNumber(input?.llm_parse?.fields?.[fieldName]?.confidence);
    if (llmField !== null) return clamp01(llmField);

    const verificationField = parseNumber(input?.llm_verification?.field_confidences?.[fieldName]);
    if (verificationField !== null) return clamp01(verificationField);

    return null;
}

function extractStreetNumberFromText(value) {
    const match = normalizeAddress(value || '').match(/\b\d+[A-Z]?\b/);
    return match ? cleanDigits(match[0]) : '';
}

function extractStreetNameFromText(value) {
    const normalized = normalizeAddress(value || '');
    if (!normalized) return '';
    return normalized
        .replace(/\b\d+[A-Z]?\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildRowContext(input = {}) {
    const identifiers = input.identifiers || {};
    const raw = input.raw || {};
    const address = input.address
        || input.address_fragment
        || raw.Original_Address
        || raw.Enriched_Address
        || extractInputAddress(raw)
        || '';

    const contaminationFlags = Array.isArray(input?.llm_verification?.contamination_flags)
        ? input.llm_verification.contamination_flags
        : [];

    return {
        raw,
        identifiers: {
            siret: cleanDigits(identifiers.siret, 14),
            siren: cleanDigits(identifiers.siren, 9),
            name: identifiers.name || input.company_name_core || input.company_name_raw || '',
            city: identifiers.city || input.city || '',
            postalCode: cleanDigits(identifiers.postalCode || input.postal_code || '', 5)
        },
        signalConfidence: {
            siret: readSignalConfidence(input, 'siret') ?? 0,
            siren: readSignalConfidence(input, 'siren') ?? 0,
            city: readSignalConfidence(input, 'city') ?? 0,
            postal_code: readSignalConfidence(input, 'postal_code') ?? 0,
            company_name_core: readSignalConfidence(input, 'company_name_core') ?? 0
        },
        transactionDate: parseTransactionDate(
            input.transactionDate
            || raw.Transaction_Date_Used
            || raw.Transaction_Date
            || raw.transaction_date
        ),
        legalFormRaw: input.legal_form_raw
            || input.legal_form_hint
            || raw.Legal_Form
            || raw.legal_form
            || raw.Enriched_Legal_Form
            || raw.Original_Legal_Form
            || '',
        streetNumber: cleanDigits(input.street_number || extractStreetNumberFromText(address)),
        streetName: input.street_name || extractStreetNameFromText(address),
        verificationFlags: {
            cross_contamination_detected: input?.verification_flags?.cross_contamination_detected === true
                || contaminationFlags.length > 0,
            invalid_field_count: Number(input?.verification_flags?.invalid_field_count ?? input?.llm_verification?.invalid_field_count ?? 0),
            empty_query_guard: input?.verification_flags?.empty_query_guard === true
                || String(input?.parse_status || '').toLowerCase() === 'empty'
        }
    };
}

function scoreIdentifier(rowContext, candidate) {
    const flags = [];
    const rowSiret = rowContext.identifiers.siret;
    const rowSiren = rowContext.identifiers.siren;
    const candSiret = candidateSiret(candidate);
    const candSiren = candidateSiren(candidate);

    if (rowSiret) {
        if (candSiret && rowSiret === candSiret) {
            return {
                value: 1,
                redFlags: flags,
                hardVeto: false,
                exactSiretMatch: true,
                exactSirenMatch: Boolean(rowSiren && rowSiren === candSiren)
            };
        }
        flags.push('SIRET_CONTRADICTION');
        return {
            value: 0,
            redFlags: flags,
            hardVeto: true,
            exactSiretMatch: false,
            exactSirenMatch: false
        };
    }

    if (rowSiren) {
        if (candSiren && rowSiren === candSiren) {
            let base = 0.96;
            if (isHeadquarters(candidate)) base += 0.02;
            return {
                value: Math.min(base, 1),
                redFlags: flags,
                hardVeto: false,
                exactSiretMatch: false,
                exactSirenMatch: true
            };
        }

        flags.push('SIREN_CONTRADICTION');
        const hardVeto = rowContext.signalConfidence.siren >= 0.9;
        return {
            value: 0,
            redFlags: flags,
            hardVeto,
            exactSiretMatch: false,
            exactSirenMatch: false
        };
    }

    return {
        value: null,
        redFlags: flags,
        hardVeto: false,
        exactSiretMatch: false,
        exactSirenMatch: false
    };
}

function scoreName(rowContext, candidate) {
    const flags = [];
    const rowName = normalizeCoreName(rowContext.identifiers.name);
    if (!rowName) {
        return {
            value: null,
            redFlags: flags,
            components: { jw: null, tsr: null, containment: null, compared_name: '' }
        };
    }

    const comparisons = candidateNameValues(candidate).map((candidateNameValue) => {
        const normalizedCandidateName = normalizeCoreName(candidateNameValue);
        const jw = jaroWinkler(rowName, normalizedCandidateName);
        const tsr = tokenSetRatio(rowName, normalizedCandidateName);
        const containment = tokenContainment(rowName, normalizedCandidateName);
        const value = clamp01(0.45 * jw + 0.45 * tsr + 0.10 * containment);
        return {
            name: candidateNameValue,
            jw,
            tsr,
            containment,
            value
        };
    }).sort((left, right) => right.value - left.value);

    if (!comparisons.length) {
        return {
            value: null,
            redFlags: flags,
            components: { jw: null, tsr: null, containment: null, compared_name: '' }
        };
    }

    const best = comparisons[0];
    if (best.value < SEVERE_NAME_MISMATCH_THRESHOLD) {
        flags.push('NAME_STRONG_MISMATCH');
    }

    return {
        value: best.value,
        redFlags: flags,
        components: {
            jw: best.jw,
            tsr: best.tsr,
            containment: best.containment,
            compared_name: best.name
        }
    };
}

function scoreGeo(rowContext, candidate) {
    const flags = [];
    const parts = [];

    const rowPostal = rowContext.identifiers.postalCode;
    const candPostal = candidatePostal(candidate);
    let postalScore = null;

    if (rowPostal && candPostal) {
        if (rowPostal === candPostal) {
            postalScore = 1;
        } else if (extractDepartment(rowPostal) === extractDepartment(candPostal)) {
            postalScore = 0.72;
        } else {
            postalScore = 0.1;
            flags.push('CP_CONTRADICTION');
        }
        parts.push({ value: postalScore, weight: 0.55 });
    }

    const rowCity = normalizeCity(rowContext.identifiers.city || '');
    const candCity = normalizeCity(candidateCity(candidate) || '');
    let cityScore = null;

    if (rowCity && candCity) {
        cityScore = Math.max(
            jaroWinkler(rowCity, candCity),
            tokenSetRatio(rowCity, candCity)
        );
        parts.push({ value: cityScore, weight: 0.45 });
        if (cityScore < SEVERE_CITY_MISMATCH_THRESHOLD) {
            flags.push('CITY_STRONG_MISMATCH');
        }
    }

    if (!parts.length) {
        return {
            value: null,
            redFlags: flags,
            components: {
                postal: postalScore,
                city: cityScore
            }
        };
    }

    return {
        value: weightedAverage(parts),
        redFlags: flags,
        components: {
            postal: postalScore,
            city: cityScore
        }
    };
}

function scoreAddress(rowContext, candidate) {
    const flags = [];
    const parts = [];

    const rowNumber = rowContext.streetNumber;
    const candNumber = candidateStreetNumber(candidate);
    let numberScore = null;

    if (rowNumber && candNumber) {
        if (rowNumber === candNumber) {
            numberScore = 1;
        } else {
            numberScore = 0.2;
            flags.push('STREET_NUMBER_CONTRADICTION');
        }
        parts.push({ value: numberScore, weight: 0.35 });
    }

    const rowStreet = normalizeAddress(rowContext.streetName || '');
    const candStreet = normalizeAddress(candidateStreetName(candidate) || '');
    let streetScore = null;

    if (rowStreet && candStreet) {
        streetScore = clamp01(
            0.5 * jaroWinkler(rowStreet, candStreet)
            + 0.5 * tokenSetRatio(rowStreet, candStreet)
        );
        parts.push({ value: streetScore, weight: 0.65 });
        if (streetScore < 0.35) {
            flags.push('STREET_STRONG_MISMATCH');
        }
    }

    if (!parts.length) {
        return {
            value: null,
            redFlags: flags,
            components: {
                number: numberScore,
                street: streetScore
            }
        };
    }

    return {
        value: weightedAverage(parts),
        redFlags: flags,
        components: {
            number: numberScore,
            street: streetScore
        }
    };
}

function scoreTemporalActivity(rowContext, candidate) {
    const flags = [];
    const status = candidateStatus(candidate);

    if (status === 'A') {
        return { value: 1, redFlags: flags, status: 'A' };
    }

    if (status === 'F') {
        if (rowContext.transactionDate) {
            flags.push('ESTABLISHMENT_CLOSED_AT_REFERENCE_DATE_OR_NEAR');
            return { value: 0.55, redFlags: flags, status: 'F' };
        }
        flags.push('ESTABLISHMENT_CLOSED_CURRENTLY');
        return { value: 0.4, redFlags: flags, status: 'F' };
    }

    return { value: 0.7, redFlags: flags, status: 'UNKNOWN' };
}

function scoreLegalForm(rowContext, candidate) {
    const rowFamily = detectLegalFormFamily(rowContext.legalFormRaw || '');
    if (!rowFamily) {
        return { value: null, redFlags: [], rowFamily: '', candidateFamily: '' };
    }

    const candidateFamily = detectCandidateLegalFormFamily(candidate);
    if (!candidateFamily) {
        return { value: 0.3, redFlags: [], rowFamily, candidateFamily: '' };
    }

    if (candidateFamily === rowFamily) {
        return { value: 1, redFlags: [], rowFamily, candidateFamily };
    }

    if (sameFamilyButVariant(candidateFamily, rowFamily)) {
        return { value: 0.7, redFlags: [], rowFamily, candidateFamily };
    }

    return { value: 0.3, redFlags: ['LEGAL_FORM_WEAK_MISMATCH'], rowFamily, candidateFamily };
}

function reasonCodesFromFlags(flags, components) {
    const reasonCodes = [];

    if (components.identifier.exactSiretMatch) reasonCodes.push('EXACT_SIRET');
    if (components.identifier.exactSirenMatch) reasonCodes.push('EXACT_SIREN');

    if (typeof components.name.value === 'number' && components.name.value >= 0.9) reasonCodes.push('NAME_STRONG_MATCH');
    if (typeof components.geo.components.postal === 'number' && components.geo.components.postal === 1) reasonCodes.push('POSTAL_EXACT');
    if (typeof components.geo.components.city === 'number' && components.geo.components.city >= 0.9) reasonCodes.push('CITY_STRONG_MATCH');

    for (const flag of flags) {
        reasonCodes.push(flag);
    }

    return [...new Set(reasonCodes)];
}

function candidateDecision(score, hardVeto) {
    if (hardVeto) return 'REJECT';
    if (score >= 0.88) return 'BEST';
    if (score >= 0.72) return 'PLAUSIBLE';
    return 'REJECT';
}

/**
 * Deterministically score candidates for one row.
 *
 * @param {{
 *  input: {
 *   identifiers?: { siret?: string, siren?: string, name?: string, postalCode?: string, city?: string },
 *   raw?: Record<string, any>,
 *   transactionDate?: string,
 *   verification_flags?: {
 *    cross_contamination_detected?: boolean,
 *    invalid_field_count?: number,
 *    empty_query_guard?: boolean
 *   },
 *   llm_parse?: any,
 *   llm_verification?: any,
 *   field_confidences?: Record<string, number>
 *  },
 *  candidates: any[],
 *  lane?: string,
 *  transactionDate?: string,
 *  useScoreCache?: boolean
 * }} params
 */
export function scoreCandidatesDeterministic(params) {
    const input = params?.input || {};
    const candidates = Array.isArray(params?.candidates) ? params.candidates : [];
    const useCache = params?.useScoreCache !== false;
    const rowContext = buildRowContext({
        ...input,
        transactionDate: params?.transactionDate || input.transactionDate
    });

    const lucenePriors = computeLucenePriors(candidates);

    const rowSignature = hashRowForExtraction({
        raw: {
            ...(rowContext.raw || {}),
            _lane: params?.lane || '',
            _transactionDate: rowContext.transactionDate || ''
        },
        identifiers: rowContext.identifiers
    });

    const scored = candidates.map((candidate) => {
        const id = candidateId(candidate);
        const cacheKey = buildCandidateScoreSignature(rowSignature, id);
        if (useCache) {
            const cached = getCachedCandidateScore(cacheKey);
            if (cached) return cached;
        }

        const identifier = scoreIdentifier(rowContext, candidate);
        const name = scoreName(rowContext, candidate);
        const geo = scoreGeo(rowContext, candidate);
        const address = scoreAddress(rowContext, candidate);
        const temporal = scoreTemporalActivity(rowContext, candidate);
        const legalForm = scoreLegalForm(rowContext, candidate);
        const lucene = { value: lucenePriors.has(id) ? lucenePriors.get(id) : null, redFlags: [] };

        const redFlags = [
            ...identifier.redFlags,
            ...name.redFlags,
            ...geo.redFlags,
            ...address.redFlags,
            ...temporal.redFlags,
            ...legalForm.redFlags,
            ...lucene.redFlags
        ];

        const hardVeto = identifier.hardVeto === true;
        let weighted = weightedAverage([
            { value: identifier.value, weight: FEATURE_WEIGHTS.identifier },
            { value: name.value, weight: FEATURE_WEIGHTS.name },
            { value: geo.value, weight: FEATURE_WEIGHTS.geo },
            { value: address.value, weight: FEATURE_WEIGHTS.address },
            { value: temporal.value, weight: FEATURE_WEIGHTS.temporal },
            { value: legalForm.value, weight: FEATURE_WEIGHTS.legal_form },
            { value: lucene.value, weight: FEATURE_WEIGHTS.lucene }
        ]);

        if (weighted === null) weighted = 0;

        let penalty = 0;
        if (redFlags.includes('CP_CONTRADICTION') && redFlags.includes('CITY_STRONG_MISMATCH')) {
            penalty += 0.10;
        }
        if (redFlags.includes('STREET_NUMBER_CONTRADICTION')) {
            penalty += 0.04;
        }
        if (redFlags.includes('NAME_STRONG_MISMATCH')) {
            penalty += 0.15;
        }

        const finalScore = hardVeto ? 0 : clamp01(weighted - penalty);

        const result = {
            candidate_id: id,
            score: Number(finalScore.toFixed(4)),
            hard_veto: hardVeto,
            red_flags: [...new Set(redFlags)],
            decision: candidateDecision(finalScore, hardVeto),
            evidence: [],
            conflicts: [...new Set(redFlags)],
            reason_codes: reasonCodesFromFlags(redFlags, {
                identifier,
                name,
                geo,
                address,
                temporal,
                legalForm,
                lucene
            }),
            veto_flags: hardVeto ? [...new Set(redFlags)] : [],
            retrieval_lane: String(candidate?.retrieval_lane || params?.lane || ''),
            breakdown: {
                identifierFeature: identifier.value,
                nameFeature: name.value,
                postalFeature: geo.components.postal,
                cityFeature: geo.components.city,
                geoFeature: geo.value,
                addressFeature: address.value,
                timeFeature: temporal.value,
                legalFormFeature: legalForm.value,
                luceneFeature: lucene.value,
                weightedScore: Number(weighted.toFixed(4)),
                penalty: Number(penalty.toFixed(4)),
                hardVeto,
                transactionDate: rowContext.transactionDate || null,
                components: {
                    identifier: {
                        value: identifier.value,
                        weight: FEATURE_WEIGHTS.identifier,
                        exactSiretMatch: identifier.exactSiretMatch,
                        exactSirenMatch: identifier.exactSirenMatch
                    },
                    name: {
                        value: name.value,
                        weight: FEATURE_WEIGHTS.name,
                        jw: name.components.jw,
                        tsr: name.components.tsr,
                        containment: name.components.containment,
                        compared_name: name.components.compared_name
                    },
                    geo: {
                        value: geo.value,
                        weight: FEATURE_WEIGHTS.geo,
                        postal: geo.components.postal,
                        city: geo.components.city
                    },
                    address: {
                        value: address.value,
                        weight: FEATURE_WEIGHTS.address,
                        number: address.components.number,
                        street: address.components.street
                    },
                    temporal: {
                        value: temporal.value,
                        weight: FEATURE_WEIGHTS.temporal,
                        status: temporal.status
                    },
                    legal_form: {
                        value: legalForm.value,
                        weight: FEATURE_WEIGHTS.legal_form,
                        row_family: legalForm.rowFamily,
                        candidate_family: legalForm.candidateFamily
                    },
                    lucene: {
                        value: lucene.value,
                        weight: FEATURE_WEIGHTS.lucene
                    }
                }
            },
            score_components: {
                identifier: identifier.value,
                name: name.value,
                geo: geo.value,
                address: address.value,
                temporal: temporal.value,
                legal_form: legalForm.value,
                lucene: lucene.value
            },
            candidate
        };

        if (useCache) setCachedCandidateScore(cacheKey, result);
        return result;
    });

    return scored.sort((left, right) => right.score - left.score);
}
