import { IDENTITY_THRESHOLDS } from '../domain/identityConfig.js';
import { normalizeAddress, normalizeCity, normalizeToken, stripLegalForms } from '../domain/normalizationDictionaries.js';
import { listEntityMemoryEntries } from './memory/enrichmentCaches.js';

const EOD_TIEBREAK_MARGIN_WINDOW = 0.10;
const LOCKED_SIREN_HARD_THRESHOLD = 0.80;

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function cleanDigits(value, size = null) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!size) return digits;
    return digits.length === size ? digits : '';
}

function normalizeName(value) {
    return normalizeToken(stripLegalForms(String(value || '')));
}

function jaroWinkler(aValue, bValue) {
    const a = normalizeName(aValue);
    const b = normalizeName(bValue);
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;

    const matchDistance = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);
    const aMatches = new Array(a.length).fill(false);
    const bMatches = new Array(b.length).fill(false);

    let matches = 0;
    for (let i = 0; i < a.length; i += 1) {
        const start = Math.max(0, i - matchDistance);
        const end = Math.min(i + matchDistance + 1, b.length);
        for (let j = start; j < end; j += 1) {
            if (bMatches[j] || a[i] !== b[j]) continue;
            aMatches[i] = true;
            bMatches[j] = true;
            matches += 1;
            break;
        }
    }
    if (matches === 0) return 0;

    let transpositions = 0;
    let pointer = 0;
    for (let i = 0; i < a.length; i += 1) {
        if (!aMatches[i]) continue;
        while (!bMatches[pointer]) pointer += 1;
        if (a[i] !== b[pointer]) transpositions += 1;
        pointer += 1;
    }

    const jaro = (
        matches / a.length
        + matches / b.length
        + (matches - transpositions / 2) / matches
    ) / 3;

    let prefix = 0;
    for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
        if (a[i] !== b[i]) break;
        prefix += 1;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
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

function extractDepartment(postalCode) {
    const digits = cleanDigits(postalCode);
    if (digits.length < 2) return '';
    if (digits.startsWith('97') || digits.startsWith('98')) return digits.slice(0, 3);
    return digits.slice(0, 2);
}

function getRowName(row = {}) {
    return row.Identity_Name_Key
        || row.normalized_name
        || row.raw_name
        || row.Original_Name
        || row.Enriched_Name
        || row.Nom
        || '';
}

function getRowCity(row = {}) {
    return normalizeCity(row.Original_City || row.Enriched_City || row.city || row.Commune || '');
}

function getRowPostal(row = {}) {
    return cleanDigits(row.Original_CP || row.Enriched_CP || row.postalCode || row['Code postal'] || '', 5);
}

function getRowAddress(row = {}) {
    return normalizeAddress(row.Original_Address || row.Enriched_Address || row.Address || '');
}

function getRowTransactionDate(row = {}) {
    return parseTransactionDate(
        row.Transaction_Date_Used
        || row.Transaction_Date
        || row.transaction_date
        || row.Date_Transaction
        || row.Date_Facture
        || row.Invoice_Date
    );
}

function getCandidateId(candidate) {
    return candidate?.siret || candidate?.siren || '';
}

function getCandidateSiren(candidate) {
    return cleanDigits(candidate?.siren || '', 9);
}

function getCandidateName(candidate) {
    return candidate?.uniteLegale?.denominationUniteLegale
        || candidate?.periodesEtablissement?.[0]?.denominationUsuelleEtablissement
        || candidate?.periodesEtablissement?.[0]?.enseigne1Etablissement
        || '';
}

function getCandidateCity(candidate) {
    return normalizeCity(candidate?.adresseEtablissement?.libelleCommuneEtablissement || '');
}

function getCandidatePostal(candidate) {
    return cleanDigits(candidate?.adresseEtablissement?.codePostalEtablissement || '', 5);
}

function getCandidateAddress(candidate) {
    const address = candidate?.adresseEtablissement || {};
    return normalizeAddress([
        address.numeroVoieEtablissement,
        address.typeVoieEtablissement,
        address.libelleVoieEtablissement,
        address.complementAdresseEtablissement
    ].filter(Boolean).join(' '));
}

function isCandidateActive(candidate) {
    const status = String(
        candidate?.periodesEtablissement?.[0]?.etatAdministratifEtablissement
        || candidate?.etatAdministratifEtablissement
        || ''
    ).toUpperCase();
    return status === 'A';
}

function isHeadquarters(candidate) {
    return candidate?.etablissementSiege === true
        || candidate?.periodesEtablissement?.[0]?.etablissementSiege === true;
}

function rowClusterKey(row = {}) {
    return `${normalizeName(getRowName(row))}::${extractDepartment(getRowPostal(row))}::${getRowCity(row)}`;
}

function entryCandidateSirens(entry = {}) {
    const sirens = new Set();
    const scores = Array.isArray(entry.candidateScores) ? entry.candidateScores : [];
    for (const item of scores) {
        const siren = getCandidateSiren(item?.candidate);
        if (siren) sirens.add(siren);
    }
    return sirens;
}

function buildDisjointComponents(ambiguousRows = []) {
    const components = [];
    const visited = new Set();

    for (let i = 0; i < ambiguousRows.length; i += 1) {
        if (visited.has(i)) continue;

        const queue = [i];
        visited.add(i);
        const indices = [];

        while (queue.length > 0) {
            const currentIndex = queue.shift();
            indices.push(currentIndex);

            const current = ambiguousRows[currentIndex];
            const currentKey = rowClusterKey(current?.row || {});
            const currentSirens = entryCandidateSirens(current);

            for (let j = 0; j < ambiguousRows.length; j += 1) {
                if (visited.has(j)) continue;
                const next = ambiguousRows[j];
                const nextKey = rowClusterKey(next?.row || {});
                const nextSirens = entryCandidateSirens(next);

                let linked = Boolean(currentKey && nextKey && currentKey === nextKey);
                if (!linked && currentSirens.size > 0 && nextSirens.size > 0) {
                    for (const siren of currentSirens) {
                        if (nextSirens.has(siren)) {
                            linked = true;
                            break;
                        }
                    }
                }

                if (linked) {
                    visited.add(j);
                    queue.push(j);
                }
            }
        }

        components.push(indices.map((index) => ambiguousRows[index]));
    }

    return components;
}

function computeResolvedFrequency(resolvedRows = []) {
    const byCandidate = new Map();
    const bySiren = new Map();

    for (const row of resolvedRows) {
        const candidateId = row?.Resolved_SIRET || row?.Resolved_SIREN || '';
        if (candidateId) {
            byCandidate.set(candidateId, (byCandidate.get(candidateId) || 0) + 1);
        }

        const siren = cleanDigits(row?.Resolved_SIREN || '', 9);
        if (siren) {
            bySiren.set(siren, (bySiren.get(siren) || 0) + 1);
        }
    }

    return { byCandidate, bySiren };
}

function memoryPriorForCandidate(candidateId) {
    if (!candidateId) return 0;
    const entries = listEntityMemoryEntries();
    const hit = entries.find((entry) => entry.key.endsWith(`::${candidateId}`));
    if (!hit) return 0;
    const avgConfidence = hit.totalConfidence / Math.max(1, hit.count);
    return clamp01(avgConfidence);
}

function dominantValue(values = []) {
    const counts = new Map();
    for (const value of values.filter(Boolean)) {
        counts.set(value, (counts.get(value) || 0) + 1);
    }
    if (!counts.size) return '';
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function componentContext(componentRows, resolvedRows) {
    const rowKeys = new Set(componentRows.map((entry) => rowClusterKey(entry?.row || {})));
    const candidateSirens = new Set();

    for (const entry of componentRows) {
        for (const siren of entryCandidateSirens(entry)) {
            candidateSirens.add(siren);
        }
    }

    const linkedResolved = resolvedRows.filter((row) => {
        const resolvedKey = rowClusterKey(row || {});
        if (rowKeys.has(resolvedKey)) return true;

        const resolvedSiren = cleanDigits(row?.Resolved_SIREN || '', 9);
        return resolvedSiren && candidateSirens.has(resolvedSiren);
    });

    const dominantName = dominantValue(
        linkedResolved.map((row) => normalizeName(getRowName(row))).filter(Boolean)
    ) || dominantValue(componentRows.map((entry) => normalizeName(getRowName(entry?.row || {}))).filter(Boolean));

    const dominantCity = dominantValue(
        linkedResolved.map((row) => getRowCity(row)).filter(Boolean)
    ) || dominantValue(componentRows.map((entry) => getRowCity(entry?.row || {})).filter(Boolean));

    const dominantDept = dominantValue(
        linkedResolved.map((row) => extractDepartment(getRowPostal(row))).filter(Boolean)
    ) || dominantValue(componentRows.map((entry) => extractDepartment(getRowPostal(entry?.row || {}))).filter(Boolean));

    const sirenCounts = new Map();
    for (const row of linkedResolved) {
        const siren = cleanDigits(row?.Resolved_SIREN || '', 9);
        if (!siren) continue;
        sirenCounts.set(siren, (sirenCounts.get(siren) || 0) + 1);
    }

    const [dominantSiren = '', dominantSirenCount = 0] = [...sirenCounts.entries()]
        .sort((a, b) => b[1] - a[1])[0] || [];

    const lockStrength = linkedResolved.length > 0
        ? dominantSirenCount / linkedResolved.length
        : 0;

    return {
        linkedResolved,
        dominantName,
        dominantCity,
        dominantDept,
        dominantSiren,
        lockStrength
    };
}

function addressCloseness(row, candidate) {
    const rowAddress = getRowAddress(row);
    const candidateAddress = getCandidateAddress(candidate);
    if (!rowAddress || !candidateAddress) return 0;

    const rowTokens = new Set(rowAddress.split(' ').filter(Boolean));
    const candidateTokens = new Set(candidateAddress.split(' ').filter(Boolean));
    if (!rowTokens.size || !candidateTokens.size) return 0;

    let overlap = 0;
    for (const token of rowTokens) {
        if (candidateTokens.has(token)) overlap += 1;
    }

    return overlap / Math.max(rowTokens.size, candidateTokens.size);
}

function computePriorName(row, candidate, context, resolvedByCandidate) {
    const candidateName = normalizeName(getCandidateName(candidate));
    const rowName = normalizeName(getRowName(row));

    const targetName = context.dominantName || rowName;
    const nameSimilarity = targetName ? jaroWinkler(candidateName, targetName) : 0;
    const candidateId = getCandidateId(candidate);
    const frequencyPrior = Math.min(1, (resolvedByCandidate.get(candidateId) || 0) / 5);
    const memoryPrior = memoryPriorForCandidate(candidateId);

    return clamp01(0.65 * nameSimilarity + 0.2 * frequencyPrior + 0.15 * memoryPrior);
}

function computePriorCity(candidate, context, resolvedBySiren) {
    const candidateCity = getCandidateCity(candidate);
    const cityMatch = context.dominantCity && candidateCity === context.dominantCity ? 1 : 0;

    const candidateSiren = getCandidateSiren(candidate);
    const sirenSupport = candidateSiren
        ? Math.min(1, (resolvedBySiren.get(candidateSiren) || 0) / 5)
        : 0;

    return clamp01(0.7 * cityMatch + 0.3 * sirenSupport);
}

function computePriorGeo(row, candidate, context) {
    const rowPostal = getRowPostal(row);
    const rowDept = extractDepartment(rowPostal);
    const rowCity = getRowCity(row);

    const candidatePostal = getCandidatePostal(candidate);
    const candidateDept = extractDepartment(candidatePostal);
    const candidateCity = getCandidateCity(candidate);

    let score = 0;

    if (rowPostal && candidatePostal && rowPostal === candidatePostal) score += 0.45;
    else if (rowDept && candidateDept && rowDept === candidateDept) score += 0.25;

    if (rowCity && candidateCity && rowCity === candidateCity) score += 0.35;
    else if (context.dominantCity && candidateCity && context.dominantCity === candidateCity) score += 0.2;

    if (context.dominantDept && candidateDept && context.dominantDept === candidateDept) score += 0.1;

    return clamp01(score);
}

function computePriorTime(row, candidate) {
    const hasDate = Boolean(getRowTransactionDate(row));
    const active = isCandidateActive(candidate);

    if (hasDate) {
        return active ? 1 : 0.25;
    }

    return active ? 0.75 : 0.45;
}

function isHardVetoCandidate(item) {
    if (item?.hard_veto === true) return true;
    const redFlags = Array.isArray(item?.red_flags) ? item.red_flags : [];
    return redFlags.includes('SIRET_CONTRADICTION') || redFlags.includes('SIREN_CONTRADICTION');
}

function shouldApplyGlobal(localScores = []) {
    if (localScores.length <= 1) return false;
    const top = localScores[0] || 0;
    const second = localScores[1] || 0;
    const margin = top - second;
    return margin <= EOD_TIEBREAK_MARGIN_WINDOW;
}

function pickBestSameSirenBranch(row, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    const scored = candidates.map((item) => {
        const candidate = item.candidate;
        const hasDate = Boolean(getRowTransactionDate(row));
        const activeScore = isCandidateActive(candidate)
            ? 1
            : (hasDate ? 0.15 : 0.4);

        const geoScore = computePriorGeo(row, candidate, {
            dominantCity: getRowCity(row),
            dominantDept: extractDepartment(getRowPostal(row))
        });

        const addressScore = addressCloseness(row, candidate);
        const hasBranchEvidence = geoScore >= 0.6 || addressScore >= 0.45;

        let hqScore = 0;
        if (hasBranchEvidence) {
            hqScore = isHeadquarters(candidate) ? 0 : 1;
        } else {
            hqScore = isHeadquarters(candidate) ? 1 : 0.5;
        }

        const branchScore = clamp01(
            0.5 * activeScore
            + 0.25 * geoScore
            + 0.2 * addressScore
            + 0.05 * hqScore
        );

        return {
            item,
            branchScore
        };
    }).sort((a, b) => b.branchScore - a.branchScore);

    return scored[0] || null;
}

function rerankRowCandidates(entry, context, resolvedByCandidate, resolvedBySiren, componentIndex, edges) {
    const row = entry.row || {};
    const pool = (entry.candidateScores || [])
        .slice(0, 5)
        .filter((item) => !isHardVetoCandidate(item));

    if (!pool.length) {
        return {
            rescored: [],
            localMargin: 0,
            applyGlobalTieBreaker: false,
            reason: 'All candidates were hard-vetoed before EOD'
        };
    }

    const sortedByLocal = [...pool].sort((a, b) => (Number(b?.score || 0) - Number(a?.score || 0)));
    const localScores = sortedByLocal.map((item) => clamp01(Number(item?.score || 0)));
    const localMargin = localScores[0] - (localScores[1] || 0);
    const applyGlobalTieBreaker = shouldApplyGlobal(localScores);

    const rescored = sortedByLocal.map((item) => {
        const candidate = item.candidate;
        const candidateId = getCandidateId(candidate);
        const candidateSiren = getCandidateSiren(candidate);
        const localScore = clamp01(Number(item?.score || 0));

        const priorName = computePriorName(row, candidate, context, resolvedByCandidate);
        const priorCity = computePriorCity(candidate, context, resolvedBySiren);
        const priorGeo = computePriorGeo(row, candidate, context);
        const priorTime = computePriorTime(row, candidate);

        const conflictPenalty = (
            context.dominantSiren
            && context.lockStrength >= 0.7
            && candidateSiren
            && candidateSiren !== context.dominantSiren
        ) ? 1 : 0;

        const lockedSirenConflict = Boolean(
            context.dominantSiren
            && context.lockStrength >= LOCKED_SIREN_HARD_THRESHOLD
            && candidateSiren
            && candidateSiren !== context.dominantSiren
        );

        let eodScore = localScore;
        if (applyGlobalTieBreaker) {
            eodScore = clamp01(
                localScore
                + 0.04 * priorName
                + 0.03 * priorCity
                + 0.03 * priorGeo
                + 0.02 * priorTime
                - 0.06 * conflictPenalty
            );
        }

        if (lockedSirenConflict) {
            eodScore = 0;
        }

        const detailed = {
            ...item,
            localScore: Number(localScore.toFixed(4)),
            eodScore: Number(eodScore.toFixed(4)),
            priorName: Number(priorName.toFixed(4)),
            priorCity: Number(priorCity.toFixed(4)),
            priorGeo: Number(priorGeo.toFixed(4)),
            priorTime: Number(priorTime.toFixed(4)),
            conflictPenalty,
            lockedSirenConflict,
            applyGlobalTieBreaker
        };

        edges.push({
            componentIndex,
            rowId: entry.rowId,
            candidateId,
            candidateSiren,
            localScore: detailed.localScore,
            eodScore: detailed.eodScore,
            priorName: detailed.priorName,
            priorCity: detailed.priorCity,
            priorGeo: detailed.priorGeo,
            priorTime: detailed.priorTime,
            conflictPenalty,
            lockedSirenConflict,
            applyGlobalTieBreaker
        });

        return detailed;
    }).sort((a, b) => b.eodScore - a.eodScore);

    return {
        rescored,
        localMargin: Number(localMargin.toFixed(4)),
        applyGlobalTieBreaker,
        reason: ''
    };
}

/**
 * End-of-day global disambiguation pass.
 *
 * @param {{
 *  ambiguousRows: Array<{
 *   rowId: string,
 *   row: Record<string, any>,
 *   candidateScores: Array<{ score: number, candidate: any, hard_veto?: boolean, red_flags?: string[] }>,
 *   outputRowIndex?: number
 *  }>,
 *  resolvedRows?: Array<Record<string, any>>
 * }} params
 */
export function runEndOfDayDisambiguation(params) {
    const ambiguousRows = Array.isArray(params?.ambiguousRows) ? params.ambiguousRows : [];
    const resolvedRows = Array.isArray(params?.resolvedRows) ? params.resolvedRows : [];

    const components = buildDisjointComponents(ambiguousRows);
    const { byCandidate: resolvedByCandidate, bySiren: resolvedBySiren } = computeResolvedFrequency(resolvedRows);

    const finalized = [];
    const ambiguityReport = [];
    const edges = [];

    components.forEach((component, componentIndex) => {
        const context = componentContext(component, resolvedRows);

        component.forEach((entry) => {
            const reranked = rerankRowCandidates(
                entry,
                context,
                resolvedByCandidate,
                resolvedBySiren,
                componentIndex,
                edges
            );

            if (!reranked.rescored.length) {
                ambiguityReport.push({
                    rowId: entry.rowId,
                    outputRowIndex: entry.outputRowIndex,
                    decision: 'REVIEW_REQUIRED',
                    reason: reranked.reason || 'No viable candidates for EOD disambiguation',
                    topCandidates: []
                });
                return;
            }

            let top = reranked.rescored[0];
            let second = reranked.rescored[1] || null;
            let margin = top.eodScore - (second?.eodScore || 0);

            if (top?.candidate && second?.candidate) {
                const topSiren = getCandidateSiren(top.candidate);
                const secondSiren = getCandidateSiren(second.candidate);

                if (topSiren && topSiren === secondSiren && margin < IDENTITY_THRESHOLDS.eodMarginThreshold) {
                    const sameSirenCandidates = reranked.rescored
                        .filter((item) => getCandidateSiren(item.candidate) === topSiren)
                        .filter((item) => (top.eodScore - item.eodScore) <= 0.05);

                    const preferred = pickBestSameSirenBranch(entry.row || {}, sameSirenCandidates);
                    if (preferred?.item && preferred.item !== top) {
                        top = preferred.item;
                        second = reranked.rescored.find((item) => item !== top) || null;
                        margin = top.eodScore - (second?.eodScore || 0);
                    }
                }
            }

            if (top.eodScore >= IDENTITY_THRESHOLDS.eodAcceptThreshold && margin >= IDENTITY_THRESHOLDS.eodMarginThreshold) {
                finalized.push({
                    rowId: entry.rowId,
                    outputRowIndex: entry.outputRowIndex,
                    decision: 'AUTO_ACCEPT',
                    recommendedCandidate: top.candidate,
                    topScore: Number(top.eodScore.toFixed(4)),
                    margin: Number(margin.toFixed(4)),
                    scoreBreakdown: {
                        ...top,
                        localMargin: reranked.localMargin,
                        applyGlobalTieBreaker: reranked.applyGlobalTieBreaker,
                        componentContext: {
                            dominantSiren: context.dominantSiren,
                            lockStrength: Number(context.lockStrength.toFixed(4)),
                            dominantCity: context.dominantCity,
                            dominantDept: context.dominantDept
                        }
                    }
                });
                return;
            }

            ambiguityReport.push({
                rowId: entry.rowId,
                outputRowIndex: entry.outputRowIndex,
                decision: 'REVIEW_REQUIRED',
                reason: margin < IDENTITY_THRESHOLDS.eodMarginThreshold
                    ? 'Insufficient EOD margin after global reranking'
                    : 'Top EOD score below acceptance threshold',
                topCandidates: reranked.rescored.slice(0, 3),
                localMargin: reranked.localMargin,
                applyGlobalTieBreaker: reranked.applyGlobalTieBreaker
            });
        });
    });

    return {
        finalized,
        ambiguityReport,
        dailyEntityGraph: {
            nodeCounts: {
                components: components.length,
                ambiguousRows: ambiguousRows.length,
                resolvedRows: resolvedRows.length
            },
            edges
        }
    };
}
