import { describe, expect, it } from 'vitest';
import { runEndOfDayDisambiguation } from '../eodDisambiguationService.js';

function activeCandidate({ siret, siren, name, city, postalCode, hq = false }) {
    return {
        siret,
        siren,
        etablissementSiege: hq,
        uniteLegale: {
            denominationUniteLegale: name
        },
        adresseEtablissement: {
            libelleCommuneEtablissement: city,
            codePostalEtablissement: postalCode
        },
        periodesEtablissement: [
            {
                etatAdministratifEtablissement: 'A'
            }
        ]
    };
}

describe('end-of-day disambiguation', () => {
    it('auto-accepts an ambiguous row when global consistency and margin are strong', () => {
        const best = activeCandidate({
            siret: '11111111111111',
            siren: '111111111',
            name: 'ACME FRANCE',
            city: 'PARIS',
            postalCode: '75001',
            hq: true
        });
        const second = activeCandidate({
            siret: '22222222222222',
            siren: '222222222',
            name: 'ACME SERVICES',
            city: 'LYON',
            postalCode: '69001'
        });

        const result = runEndOfDayDisambiguation({
            resolvedRows: [
                {
                    Original_Name: 'Acme France',
                    Original_City: 'Paris',
                    Resolved_SIRET: '11111111111111'
                }
            ],
            ambiguousRows: [
                {
                    rowId: 'row-1',
                    row: {
                        Original_Name: 'Acme France',
                        Original_City: 'Paris',
                        Original_CP: '75001'
                    },
                    candidateScores: [
                        { score: 0.91, candidate: best },
                        { score: 0.58, candidate: second }
                    ]
                }
            ]
        });

        expect(result.finalized).toHaveLength(1);
        expect(result.finalized[0].rowId).toBe('row-1');
        expect(result.finalized[0].recommendedCandidate.siret).toBe('11111111111111');
        expect(result.finalized[0].scoreBreakdown.applyGlobalTieBreaker).toBe(false);
        expect(result.finalized[0].topScore).toBe(0.91);
        expect(result.ambiguityReport).toHaveLength(0);
    });

    it('keeps row in ambiguity report when EOD score is not decisive', () => {
        const a = activeCandidate({
            siret: '33333333333333',
            siren: '333333333',
            name: 'BETA',
            city: 'NANTES',
            postalCode: '44000'
        });
        const b = activeCandidate({
            siret: '44444444444444',
            siren: '444444444',
            name: 'BETA SOLUTIONS',
            city: 'NANTES',
            postalCode: '44000'
        });

        const result = runEndOfDayDisambiguation({
            resolvedRows: [],
            ambiguousRows: [
                {
                    rowId: 'row-2',
                    row: {
                        Original_Name: 'Beta',
                        Original_City: 'Nantes',
                        Original_CP: '44000'
                    },
                    candidateScores: [
                        { score: 0.62, candidate: a },
                        { score: 0.6, candidate: b }
                    ]
                }
            ]
        });

        expect(result.finalized).toHaveLength(0);
        expect(result.ambiguityReport).toHaveLength(1);
        expect(result.ambiguityReport[0].rowId).toBe('row-2');
        expect(result.ambiguityReport[0].decision).toBe('REVIEW_REQUIRED');
    });

    it('prefers the best branch within same SIREN using active/date + geo + address', () => {
        const hq = {
            ...activeCandidate({
                siret: '55555555500001',
                siren: '555555555',
                name: 'GAMMA',
                city: 'LYON',
                postalCode: '69001',
                hq: true
            }),
            adresseEtablissement: {
                codePostalEtablissement: '69001',
                libelleCommuneEtablissement: 'LYON',
                numeroVoieEtablissement: '1',
                typeVoieEtablissement: 'RUE',
                libelleVoieEtablissement: 'DES TESTS'
            }
        };

        const branch = {
            ...activeCandidate({
                siret: '55555555500027',
                siren: '555555555',
                name: 'GAMMA',
                city: 'PARIS',
                postalCode: '75011',
                hq: false
            }),
            adresseEtablissement: {
                codePostalEtablissement: '75011',
                libelleCommuneEtablissement: 'PARIS',
                numeroVoieEtablissement: '10',
                typeVoieEtablissement: 'RUE',
                libelleVoieEtablissement: 'ALPHA'
            }
        };

        const result = runEndOfDayDisambiguation({
            resolvedRows: [],
            ambiguousRows: [
                {
                    rowId: 'row-branch',
                    row: {
                        Original_Name: 'Gamma',
                        Original_City: 'Paris',
                        Original_CP: '75011',
                        Original_Address: '10 RUE ALPHA',
                        Transaction_Date_Used: '2024-06-10'
                    },
                    candidateScores: [
                        { score: 0.82, candidate: hq },
                        { score: 0.8, candidate: branch }
                    ]
                }
            ]
        });

        expect(result.finalized).toHaveLength(0);
        expect(result.ambiguityReport).toHaveLength(1);
        expect(result.ambiguityReport[0].topCandidates[0].candidate.siret).toBe('55555555500027');
    });

    it('applies locked SIREN hard conflict when component context is strongly anchored', () => {
        const anchored = activeCandidate({
            siret: '77777777700011',
            siren: '777777777',
            name: 'DELTA',
            city: 'PARIS',
            postalCode: '75001'
        });
        const conflicting = activeCandidate({
            siret: '88888888800011',
            siren: '888888888',
            name: 'DELTA',
            city: 'PARIS',
            postalCode: '75001'
        });

        const result = runEndOfDayDisambiguation({
            resolvedRows: [
                { Original_Name: 'Delta', Original_City: 'Paris', Original_CP: '75001', Resolved_SIRET: '77777777700011', Resolved_SIREN: '777777777' },
                { Original_Name: 'Delta', Original_City: 'Paris', Original_CP: '75001', Resolved_SIRET: '77777777700012', Resolved_SIREN: '777777777' },
                { Original_Name: 'Delta', Original_City: 'Paris', Original_CP: '75001', Resolved_SIRET: '77777777700013', Resolved_SIREN: '777777777' }
            ],
            ambiguousRows: [
                {
                    rowId: 'row-locked',
                    row: {
                        Original_Name: 'Delta',
                        Original_City: 'Paris',
                        Original_CP: '75001'
                    },
                    candidateScores: [
                        { score: 0.79, candidate: conflicting },
                        { score: 0.76, candidate: anchored }
                    ]
                }
            ]
        });

        expect(result.finalized).toHaveLength(1);
        expect(result.finalized[0].recommendedCandidate.siren).toBe('777777777');
    });
});
