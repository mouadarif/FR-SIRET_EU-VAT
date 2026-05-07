import { beforeEach, describe, expect, it } from 'vitest';
import { scoreCandidatesDeterministic } from '../candidateScorer.js';
import {
    clearEnrichmentCaches
} from '../../services/memory/enrichmentCaches.js';

describe('candidate scorer', () => {
    beforeEach(() => {
        clearEnrichmentCaches();
    });

    it('prioritizes exact identifier matches', () => {
        const input = {
            identifiers: {
                siret: '12345678901234',
                siren: '123456789',
                name: 'ACME SARL',
                city: 'PARIS',
                postalCode: '75001'
            },
            raw: {
                Original_Address: '10 RUE TEST',
                Original_NAF: '6201Z'
            }
        };

        const exactCandidate = {
            siret: '12345678901234',
            siren: '123456789',
            etablissementSiege: true,
            uniteLegale: { denominationUniteLegale: 'ACME SARL' },
            periodesEtablissement: [{
                etatAdministratifEtablissement: 'A',
                activitePrincipaleEtablissement: '6201Z'
            }],
            adresseEtablissement: {
                codePostalEtablissement: '75001',
                libelleCommuneEtablissement: 'PARIS',
                numeroVoieEtablissement: '10',
                libelleVoieEtablissement: 'RUE TEST'
            }
        };

        const mismatchCandidate = {
            siret: '99999999999999',
            siren: '999999999',
            etablissementSiege: false,
            uniteLegale: { denominationUniteLegale: 'OTHER' },
            periodesEtablissement: [{
                etatAdministratifEtablissement: 'F',
                activitePrincipaleEtablissement: '4711B'
            }],
            adresseEtablissement: {
                codePostalEtablissement: '13001',
                libelleCommuneEtablissement: 'MARSEILLE'
            }
        };

        const [best, second] = scoreCandidatesDeterministic({
            input,
            candidates: [mismatchCandidate, exactCandidate]
        });

        expect(best.candidate_id).toBe('12345678901234');
        expect(best.score).toBeGreaterThan(second.score);
    });

    it('hard-vetoes contradictory exact SIRET candidates', () => {
        const input = {
            identifiers: {
                siret: '12345678901234',
                name: 'ACME SARL',
                city: 'PARIS',
                postalCode: '75001'
            },
            raw: {}
        };

        const candidates = [
            {
                siret: '99999999999999',
                siren: '123456789',
                uniteLegale: { denominationUniteLegale: 'ACME SARL' },
                periodesEtablissement: [{ etatAdministratifEtablissement: 'A' }],
                adresseEtablissement: {
                    codePostalEtablissement: '75001',
                    libelleCommuneEtablissement: 'PARIS'
                }
            },
            {
                siret: '12345678901234',
                siren: '123456789',
                uniteLegale: { denominationUniteLegale: 'ACME SARL' },
                periodesEtablissement: [{ etatAdministratifEtablissement: 'A' }],
                adresseEtablissement: {
                    codePostalEtablissement: '75001',
                    libelleCommuneEtablissement: 'PARIS'
                }
            }
        ];

        const [scored] = scoreCandidatesDeterministic({ input, candidates });
        const rejected = scoreCandidatesDeterministic({ input, candidates }).find((item) => item.candidate_id === '99999999999999');
        expect(rejected?.hard_veto).toBe(true);
        expect(rejected?.score).toBe(0);
        expect(scored.candidate_id).toBe('12345678901234');
    });

    it('renormalizes weights when geo fields are missing', () => {
        const input = {
            identifiers: {
                name: 'ALPHA INDUSTRIES'
            },
            raw: {}
        };

        const candidates = [{
            siret: '55555555555555',
            siren: '555555555',
            uniteLegale: { denominationUniteLegale: 'ALPHA INDUSTRIES' },
            periodesEtablissement: [{ etatAdministratifEtablissement: 'A' }],
            adresseEtablissement: {}
        }];

        const [scored] = scoreCandidatesDeterministic({ input, candidates });
        expect(scored.score).toBeGreaterThan(0.8);
        expect(scored.breakdown.geoFeature).toBeNull();
        expect(scored.decision).toBe('BEST');
    });
});
