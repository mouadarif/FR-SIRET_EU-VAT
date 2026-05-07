import { describe, expect, it } from 'vitest';
import queryBuilder from '../queryBuilder.js';

function getDecodedQuery(url) {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.searchParams.get('q') || '');
}

describe('queryBuilder', () => {
    describe('buildSiretMultiCriteriaUrl', () => {
        it('builds query with name and postal code', () => {
            const url = queryBuilder.buildSiretMultiCriteriaUrl({
                query: 'GOOGLE',
                code_postal: '75008'
            });

            const decoded = getDecodedQuery(url);
            expect(decoded).toContain('denominationUniteLegale:GOOGLE*');
            expect(decoded).toContain('codePostalEtablissement:75008');
        });

        it('applies champs optimization fields', () => {
            const url = queryBuilder.buildSiretMultiCriteriaUrl({
                query: 'GOOGLE',
                champs: ['siret', 'siren', 'siret']
            });

            const parsed = new URL(url);
            expect(parsed.searchParams.get('champs')).toBe('siret,siren');
        });

        it('normalizes nested champs names to flat INSEE fields', () => {
            const url = queryBuilder.buildSiretMultiCriteriaUrl({
                query: 'GOOGLE',
                champs: [
                    'uniteLegale.denominationUniteLegale',
                    'adresseEtablissement.codePostalEtablissement',
                    'periodesEtablissement.0.enseigne1Etablissement'
                ]
            });

            const parsed = new URL(url);
            expect(parsed.searchParams.get('champs')).toBe(
                'denominationUniteLegale,codePostalEtablissement,enseigne1Etablissement'
            );
        });

        it('supports historical date parameter for time-aware queries', () => {
            const url = queryBuilder.buildSiretMultiCriteriaUrl({
                query: 'GOOGLE',
                date: '2024-03-12'
            });

            const parsed = new URL(url);
            expect(parsed.searchParams.get('date')).toBe('2024-03-12');
        });

        it('enforces tri and curseur incompatibility', () => {
            expect(() => queryBuilder.buildSiretMultiCriteriaUrl({
                query: 'GOOGLE',
                tri: 'asc',
                curseur: '*'
            })).toThrow('tri');
        });

        it('applies nature_juridique on /siret queries', () => {
            const url = queryBuilder.buildSiretMultiCriteriaUrl({
                query: 'GOOGLE',
                nature_juridique: '5710'
            });

            const decoded = getDecodedQuery(url);
            expect(decoded).toContain('categorieJuridiqueUniteLegale:5710');
        });
    });

    describe('buildSirenMultiCriteriaUrl', () => {
        it('supports cursor pagination without tri', () => {
            const url = queryBuilder.buildSirenMultiCriteriaUrl({
                query: 'CARREFOUR',
                curseur: '*',
                nombre: 500
            });

            const parsed = new URL(url);
            expect(parsed.searchParams.get('curseur')).toBe('*');
            expect(parsed.searchParams.get('debut')).toBeNull();
            expect(parsed.searchParams.get('nombre')).toBe('500');
        });

        it('clamps JSON pagination limits', () => {
            const url = queryBuilder.buildSirenMultiCriteriaUrl({
                query: 'CARREFOUR',
                nombre: 9999,
                debut: 5000
            });

            const parsed = new URL(url);
            expect(parsed.searchParams.get('nombre')).toBe('1000');
            expect(parsed.searchParams.get('debut')).toBe('5000');
        });

        it('allows nombre=0 for count-only style requests', () => {
            const url = queryBuilder.buildSirenMultiCriteriaUrl({
                query: 'CARREFOUR',
                nombre: 0
            });
            const parsed = new URL(url);
            expect(parsed.searchParams.get('nombre')).toBe('0');
        });

        it('normalizes date formats in siren searches', () => {
            const url = queryBuilder.buildSirenMultiCriteriaUrl({
                query: 'CARREFOUR',
                date: '15/04/2025'
            });

            const parsed = new URL(url);
            expect(parsed.searchParams.get('date')).toBe('2025-04-15');
        });
    });

    describe('service info endpoint', () => {
        it('builds /informations URL', () => {
            const url = queryBuilder.buildInformationsUrl();
            expect(url).toMatch(/\/informations$/);
        });
    });

    describe('lucene safety', () => {
        it('does not emit forbidden leading wildcard tokens', () => {
            const url = queryBuilder.buildSiretMultiCriteriaUrl({
                query: 'CARREFOUR',
                commune: 'PARIS'
            });
            const decoded = getDecodedQuery(url);
            expect(decoded).not.toContain(':*');
        });
    });

    describe('strict matching behavior', () => {
        it('allows single-word prefix matching when explicitly enabled', () => {
            const out = queryBuilder.utils.strictNameMatch(
                'ADWORK',
                'ADWORKS SERVICES',
                { allowPrefixForSingleWord: true }
            );
            expect(out).toBe(true);
        });

        it('keeps multi-word strict sequence behavior', () => {
            const ok = queryBuilder.utils.strictNameMatch('GO EMBAL', 'GO EMBAL PLATEAUX');
            const ko = queryBuilder.utils.strictNameMatch('GO EMBAL', 'EMBAL GO PLATEAUX');
            expect(ok).toBe(true);
            expect(ko).toBe(false);
        });

        it('normalizes French ligatures in strict matching', () => {
            const out = queryBuilder.utils.strictNameMatch('COEUR', 'CŒUR DE FRANCE');
            expect(out).toBe(true);
        });
    });

    describe('etablissement flags and status helpers', () => {
        it('sorts with top-level etablissementSiege priority', () => {
            const sorted = queryBuilder.sortHeadquartersFirst([
                { siret: '2', etablissementSiege: false, periodesEtablissement: [{ etatAdministratifEtablissement: 'A' }] },
                { siret: '1', etablissementSiege: true, periodesEtablissement: [{ etatAdministratifEtablissement: 'F' }] }
            ]);
            expect(sorted[0].siret).toBe('1');
        });

        it('reads active status from current period (dateFin null)', () => {
            const sorted = queryBuilder.sortHeadquartersFirst([
                {
                    siret: '1',
                    etablissementSiege: false,
                    periodesEtablissement: [
                        { dateDebut: '2020-01-01', dateFin: '2023-12-31', etatAdministratifEtablissement: 'F' },
                        { dateDebut: '2024-01-01', dateFin: null, etatAdministratifEtablissement: 'A' }
                    ]
                },
                {
                    siret: '2',
                    etablissementSiege: false,
                    periodesEtablissement: [{ dateDebut: '2024-01-01', dateFin: null, etatAdministratifEtablissement: 'F' }]
                }
            ]);
            expect(sorted[0].siret).toBe('1');
        });

        it('falls back to top-level etatAdministratifEtablissement when periods are absent', () => {
            const active = queryBuilder.filterActiveOnly([
                { siret: '1', etablissementSiege: false, etatAdministratifEtablissement: 'A' },
                { siret: '2', etablissementSiege: false, etatAdministratifEtablissement: 'F' }
            ]);
            expect(active.map((e) => e.siret)).toEqual(['1']);
        });
    });

    describe('strict match field coverage', () => {
        it('matches top-level enseigne fields when periodes are absent', () => {
            const matches = queryBuilder.filterStrictNameMatch(
                [{ enseigne1Etablissement: 'ADWORK TRAVAIL TEMPORAIRE' }],
                'ADWORK',
                { allowPrefixForSingleWord: true }
            );
            expect(matches).toHaveLength(1);
        });
    });

    describe('compatibility helpers', () => {
        it('does not append page/per_page in name helper URL', () => {
            const url = queryBuilder.buildNameSearchUrl({
                query: 'CARREFOUR',
                page: 2,
                per_page: 25
            });
            const parsed = new URL(url);
            expect(parsed.searchParams.get('page')).toBeNull();
            expect(parsed.searchParams.get('per_page')).toBeNull();
            expect(parsed.searchParams.get('debut')).toBe('25');
        });

        it('does not append page/per_page for id helper URL', () => {
            const url = queryBuilder.buildIdSearchUrl('siret', '12345678901234', {
                page: 3,
                per_page: 25
            });
            expect(url).toMatch(/\/siret\/12345678901234$/);
        });

        it('uses numeric 20 prefix for Corsica postal codes', () => {
            expect(queryBuilder.utils.getDepartmentFromPostalCode('20000')).toBe('20');
        });
    });
});
