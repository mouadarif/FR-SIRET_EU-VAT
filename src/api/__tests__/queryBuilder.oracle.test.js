import { describe, expect, it, vi } from 'vitest';
import queryBuilder from '../queryBuilder.js';

const { utils } = queryBuilder;

function parseUrl(url) {
    return new URL(url);
}

function getParam(url, key) {
    return parseUrl(url).searchParams.get(key);
}

function getQ(url) {
    return getParam(url, 'q') || '';
}

function makeEtab({
    legalName = 'GO EMBAL',
    legalUsual1 = null,
    legalUsual2 = null,
    legalUsual3 = null,
    enseigne1 = null,
    enseigne2 = null,
    enseigne3 = null,
    denomUsuelleEtab = null,
    etablissementSiege = false,
    currentStatus = 'A',
    oldStatus = null,
    currentFirst = true,
    city = 'PARIS',
    postal = '75001'
} = {}) {
    const currentPeriod = {
        dateDebut: '2022-01-01',
        dateFin: null,
        etatAdministratifEtablissement: currentStatus,
        enseigne1Etablissement: enseigne1,
        enseigne2Etablissement: enseigne2,
        enseigne3Etablissement: enseigne3,
        denominationUsuelleEtablissement: denomUsuelleEtab
    };

    const oldPeriod = oldStatus
        ? {
            dateDebut: '2018-01-01',
            dateFin: '2021-12-31',
            etatAdministratifEtablissement: oldStatus,
            enseigne1Etablissement: null,
            enseigne2Etablissement: null,
            enseigne3Etablissement: null,
            denominationUsuelleEtablissement: null
        }
        : null;

    const periodes = oldPeriod
        ? (currentFirst ? [currentPeriod, oldPeriod] : [oldPeriod, currentPeriod])
        : [currentPeriod];

    return {
        etablissementSiege,
        etatAdministratifEtablissement: 'F',
        enseigne1Etablissement: enseigne1,
        enseigne2Etablissement: enseigne2,
        enseigne3Etablissement: enseigne3,
        denominationUsuelleEtablissement: denomUsuelleEtab,
        uniteLegale: {
            denominationUniteLegale: legalName,
            denominationUsuelle1UniteLegale: legalUsual1,
            denominationUsuelle2UniteLegale: legalUsual2,
            denominationUsuelle3UniteLegale: legalUsual3
        },
        adresseEtablissement: {
            codePostalEtablissement: postal,
            libelleCommuneEtablissement: city
        },
        periodesEtablissement: periodes
    };
}

describe('oracle suite: text normalization', () => {
    it('escapes lucene special chars', () => {
        const s = utils.escapeLucene('A+B (TEST) [X]');
        expect(s).not.toContain('+');
        expect(s).toContain('\\(');
        expect(s).toContain('\\[');
    });

    it('replaces apostrophes with spaces', () => {
        expect(utils.escapeLucene("L'ATELIER")).toContain('L ATELIER');
    });

    it('normalizes for comparison to uppercase and trimmed', () => {
        expect(utils.normalizeForComparison('  societe generale  ')).toBe('SOCIETE GENERALE');
    });

    it('handles null in normalizeForComparison', () => {
        expect(utils.normalizeForComparison(null)).toBe('');
    });

    it('normalizes ligature OE', () => {
        expect(utils.normalizeForComparison('C\u0152UR')).toBe('COEUR');
    });

    it('normalizes ligature AE', () => {
        expect(utils.normalizeForComparison('\u00c6THER')).toBe('AETHER');
    });
});

describe('oracle suite: strictNameMatch', () => {
    const cases = [
        ['exact single-word match', 'DUPONT', 'DUPONT', {}, true],
        ['single-word exact does not match suffix by default', 'DUPONT', 'DUPONTEL', {}, false],
        ['single-word prefix allowed', 'DUPON', 'DUPONT', { allowPrefixForSingleWord: true }, true],
        ['single-word prefix disallowed', 'DUPON', 'DUPONT', { allowPrefixForSingleWord: false }, false],
        ['two-word contiguous exact', 'GO EMBAL', 'GO EMBAL PLATEAUX', {}, true],
        ['two-word not contiguous fails', 'GO EMBAL', 'GO PLATEAUX EMBAL', {}, false],
        ['word order matters', 'EMBAL GO', 'GO EMBAL', {}, false],
        ['last word prefix allowed in multi-word', 'GO EMB', 'GO EMBAL PLATEAUX', {}, true],
        ['non-last word must match exactly', 'G EMBAL', 'GO EMBAL', {}, false],
        ['three words contiguous', 'MAISON DE PARIS', 'LA MAISON DE PARIS CENTRE', {}, true],
        ['three words broken sequence fails', 'MAISON DE PARIS', 'MAISON DU PARIS', {}, false],
        ['hyphen and punctuation tolerated', 'SAINT ETIENNE', 'SAINT-ETIENNE BTP', {}, true],
        ['apostrophe tolerated', 'L ATELIER', "L'ATELIER DU BOIS", {}, true],
        ['parentheses removed before comparison', 'ATELIER CENTRAL', 'ATELIER (ANCIEN) CENTRAL', {}, true],
        ['multi spaces tolerated', 'GO    EMBAL', 'GO EMBAL', {}, true],
        ['single token with dot target', 'ABC', 'ABC.SARL', {}, true],
        ['single token with slash target', 'ABC', 'ABC/DEF', {}, true],
        ['last token prefix behavior on long target', 'COMPAGNIE FR', 'COMPAGNIE FRANCAISE', {}, true],
        ['ligature-insensitive strict match', 'COEUR', 'C\u0152UR DE FRANCE', {}, true],
        ['empty search returns false', '', 'GO EMBAL', {}, false]
    ];

    it.each(cases)('%s', (_label, search, target, options, expected) => {
        expect(utils.strictNameMatch(search, target, options)).toBe(expected);
    });
});

describe('oracle suite: resultMatchesStrictly', () => {
    it('matches legal denomination', () => {
        const etab = makeEtab({ legalName: 'GO EMBAL PLATEAUX' });
        expect(utils.resultMatchesStrictly(etab, 'GO EMBAL')).toBe(true);
    });

    it('matches legal denominationUsuelle1', () => {
        const etab = makeEtab({ legalName: 'SOCIETE X', legalUsual1: 'ATELIER BLEU' });
        expect(utils.resultMatchesStrictly(etab, 'ATELIER BLEU')).toBe(true);
    });

    it('matches top-level enseigne', () => {
        const etab = makeEtab({ legalName: 'SOCIETE X', enseigne1: 'BOUTIQUE DU PORT' });
        expect(utils.resultMatchesStrictly(etab, 'BOUTIQUE DU PORT')).toBe(true);
    });

    it('matches period denominationUsuelleEtablissement', () => {
        const etab = makeEtab({ legalName: 'SOCIETE X', denomUsuelleEtab: 'DEPOT OUEST' });
        expect(utils.resultMatchesStrictly(etab, 'DEPOT OUEST')).toBe(true);
    });

    it('uses current period (dateFin null), not blindly first period', () => {
        const etab = makeEtab({
            legalName: 'SOCIETE X',
            enseigne1: 'CURRENT BRAND',
            oldStatus: 'F',
            currentFirst: false
        });
        expect(utils.resultMatchesStrictly(etab, 'CURRENT BRAND')).toBe(true);
    });
});

describe('oracle suite: department extraction', () => {
    it.each([
        ['metropolitan 75', '75008', '75'],
        ['metropolitan 44', '44100', '44'],
        ['overseas 971', '97100', '971'],
        ['corsica uses 20 for postal wildcard', '20000', '20'],
        ['null returns empty', null, '']
    ])('%s', (_label, input, expected) => {
        expect(utils.getDepartmentFromPostalCode(input)).toBe(expected);
    });
});

describe('oracle suite: pagination and params', () => {
    it('defaults nombre/debut', () => {
        const n = utils.normalizePaginationOptions({});
        expect(n.nombre).toBe(25);
        expect(n.debut).toBe(0);
    });

    it('allows nombre=0 for count-only', () => {
        const n = utils.normalizePaginationOptions({ nombre: 0 });
        expect(n.nombre).toBe(0);
    });

    it('clamps nombre/debut upper bound for JSON', () => {
        const n = utils.normalizePaginationOptions({ nombre: 99999, debut: 99999 });
        expect(n.nombre).toBe(1000);
        expect(n.debut).toBe(10000);
    });

    it('throws when tri and curseur are both set', () => {
        expect(() => utils.normalizePaginationOptions({ tri: 'asc', curseur: '*' })).toThrow(/tri.*curseur/i);
    });

    it('applySearchPaginationParams writes curseur and omits debut when curseur present', () => {
        const params = new URLSearchParams();
        utils.applySearchPaginationParams(params, { curseur: '*' });
        expect(params.get('curseur')).toBe('*');
        expect(params.get('debut')).toBeNull();
    });

    it('applySearchPaginationParams supports date/champs/facette', () => {
        const params = new URLSearchParams();
        utils.applySearchPaginationParams(params, {
            date: '17/02/2026',
            champs: ['uniteLegale.denominationUniteLegale'],
            facetteChamp: ['categorieJuridiqueUniteLegale']
        });
        expect(params.get('date')).toBe('2026-02-17');
        expect(params.get('champs')).toContain('denominationUniteLegale');
        expect(params.get('facette.champ')).toContain('categorieJuridiqueUniteLegale');
    });

    it('applySearchPaginationParams supports masquerValeursNulles', () => {
        const params = new URLSearchParams();
        utils.applySearchPaginationParams(params, { masquerValeursNulles: true });
        expect(params.get('masquerValeursNulles')).toBe('true');
    });
});

describe('oracle suite: field/date normalization', () => {
    it('normalizeInseeFieldName normalizes aliases', () => {
        expect(utils.normalizeInseeFieldName('uniteLegale.denominationUniteLegale')).toBe('denominationUniteLegale');
        expect(utils.normalizeInseeFieldName('adresseEtablissement.codePostalEtablissement')).toBe('codePostalEtablissement');
        expect(utils.normalizeInseeFieldName('periodesEtablissement.0.enseigne1Etablissement')).toBe('enseigne1Etablissement');
    });

    it('normalizeChamps deduplicates and normalizes', () => {
        const out = utils.normalizeChamps([
            'uniteLegale.denominationUniteLegale',
            'denominationUniteLegale',
            'adresseEtablissement.codePostalEtablissement'
        ]);
        expect(out).toEqual(['denominationUniteLegale', 'codePostalEtablissement']);
    });

    it('normalizeDateParam formats supported inputs', () => {
        expect(utils.normalizeDateParam('2026-02-17')).toBe('2026-02-17');
        expect(utils.normalizeDateParam('17/02/2026')).toBe('2026-02-17');
        expect(utils.normalizeDateParam('17-02-2026')).toBe('2026-02-17');
    });

    it('normalizeDateParam returns empty on invalid value', () => {
        expect(utils.normalizeDateParam('not-a-date')).toBe('');
    });
});

describe('oracle suite: buildNameSearchQuery', () => {
    it('single-word query searches legal and historized establishment fields', () => {
        const q = utils.buildNameSearchQuery('GO');
        expect(q).toContain('denominationUniteLegale:GO*');
        expect(q).toContain('periode(enseigne1Etablissement:GO*)');
        expect(q).toContain('periode(denominationUsuelleEtablissement:GO*)');
        expect(q).not.toContain('*GO*');
    });

    it('does not use unsupported raisonSociale field', () => {
        const q = utils.buildNameSearchQuery('GO');
        expect(q).not.toContain('raisonSociale');
    });

    it('multi-word query requires all words in same field', () => {
        const q = utils.buildNameSearchQuery('GO EMBAL');
        expect(q).toContain('(denominationUniteLegale:GO* AND denominationUniteLegale:EMBAL*)');
        expect(q).toContain('periode(enseigne1Etablissement:GO* AND enseigne1Etablissement:EMBAL*)');
    });

    it('filters one-letter apostrophe fragments', () => {
        const q = utils.buildNameSearchQuery("L'ATELIER");
        expect(q).toContain('ATELIER*');
        expect(q).not.toContain(':L*');
    });

    it('returns empty for empty input', () => {
        expect(utils.buildNameSearchQuery('')).toBe('');
    });

    it('replaces punctuation with spaces in generated tokens', () => {
        const q = utils.buildNameSearchQuery('A+B');
        expect(q).not.toContain('+');
        expect(q).toContain('denominationUniteLegale:');
    });
});

describe('oracle suite: URL builders tiered', () => {
    it('Tier2 includes name + location clauses', () => {
        const url = queryBuilder.buildTier2NeighborUrl({
            query: 'GO EMBAL',
            code_postal: '75001',
            commune: 'Paris'
        });
        const q = getQ(url);
        expect(q).toContain('codePostalEtablissement:75001');
        expect(q).toContain('libelleCommuneEtablissement:Paris*');
    });

    it('Tier3 handles Corsica and overseas', () => {
        expect(getQ(queryBuilder.buildTier3MoverUrl({ query: 'GO EMBAL', code_postal: '20000' }))).toContain('codePostalEtablissement:20*');
        expect(getQ(queryBuilder.buildTier3MoverUrl({ query: 'GO EMBAL', code_postal: '97100' }))).toContain('codePostalEtablissement:971*');
    });

    it('Tier4 builds OR across variations + department + naf', () => {
        const url = queryBuilder.buildTier4DetectiveUrl({
            variations: ['GO EMBAL', 'GO EMBALLAGE'],
            code_postal: '75001',
            code_naf: '17.21A'
        });
        const q = getQ(url);
        expect(q).toContain('denominationUniteLegale:GO*');
        expect(q).toContain('codePostalEtablissement:75*');
        expect(q).toContain('activitePrincipaleEtablissement:17.21A');
    });

    it('Tier5 is name-only', () => {
        const url = queryBuilder.buildTier5LastResortUrl({ query: 'GO EMBAL' });
        const q = getQ(url);
        expect(q).toContain('denominationUniteLegale:GO*');
        expect(q).not.toContain('codePostalEtablissement:');
    });
});

describe('oracle suite: URL builders multi-criteria + legacy', () => {
    it('buildSiretMultiCriteriaUrl includes business filters', () => {
        const url = queryBuilder.buildSiretMultiCriteriaUrl({
            query: 'GO EMBAL',
            nature_juridique: '5710',
            code_naf: '47.11D',
            etat_administratif: 'A',
            tranche_effectif_salarie: '11'
        });
        const q = getQ(url);
        expect(q).toContain('categorieJuridiqueUniteLegale:5710');
        expect(q).toContain('activitePrincipaleEtablissement:47.11D');
        expect(q).toContain('etatAdministratifEtablissement:A');
        expect(q).toContain('trancheEffectifsEtablissement:11');
    });

    it('buildSiretMultiCriteriaUrl sanitizes SIRET inputs', () => {
        expect(getQ(queryBuilder.buildSiretMultiCriteriaUrl({ siret: '123 456 789 01234' }))).toContain('siret:12345678901234');
        expect(getQ(queryBuilder.buildSiretMultiCriteriaUrl({ siret: '123456789' }))).toContain('siret:123456789*');
    });

    it('buildSirenMultiCriteriaUrl uses legal fields only', () => {
        const q = getQ(queryBuilder.buildSirenMultiCriteriaUrl({ query: 'GO EMBAL' }));
        expect(q).toContain('denominationUniteLegale:GO*');
        expect(q).not.toContain('enseigne1Etablissement');
    });

    it('legacy helpers do not leak page/per_page', () => {
        const url = queryBuilder.buildNameSearchUrl({ query: 'GO', page: 3, per_page: 25 });
        expect(getParam(url, 'nombre')).toBe('25');
        expect(getParam(url, 'debut')).toBe('50');
        expect(getParam(url, 'page')).toBeNull();
        expect(getParam(url, 'per_page')).toBeNull();
        expect(queryBuilder.buildIdSearchUrl('siren', '123456789')).toMatch(/\/siren\/123456789$/);
    });
});

describe('oracle suite: filtering helpers', () => {
    it('filterStrictNameMatch keeps only strict matches', () => {
        const list = [
            makeEtab({ legalName: 'GO EMBAL PLATEAUX' }),
            makeEtab({ legalName: 'EMBAL GO' }),
            makeEtab({ legalName: 'GO PLATEAUX EMBAL' })
        ];
        const out = queryBuilder.filterStrictNameMatch(list, 'GO EMBAL');
        expect(out).toHaveLength(1);
    });

    it('sort/filter helpers use headquarters + current status', () => {
        const hqActive = makeEtab({ legalName: 'HQ ACTIVE', etablissementSiege: true, currentStatus: 'A' });
        const hqClosed = makeEtab({ legalName: 'HQ CLOSED', etablissementSiege: true, currentStatus: 'F' });
        const nonHq = makeEtab({ legalName: 'NON HQ', etablissementSiege: false, currentStatus: 'A' });

        const sorted = queryBuilder.sortHeadquartersFirst([nonHq, hqClosed, hqActive]);
        expect(sorted[0].uniteLegale.denominationUniteLegale).toBe('HQ ACTIVE');

        const hqOnly = queryBuilder.filterHeadquartersOnly([nonHq, hqActive]);
        expect(hqOnly).toHaveLength(1);
        expect(hqOnly[0].etablissementSiege).toBe(true);

        const activeOnly = queryBuilder.filterActiveOnly([hqClosed, hqActive]);
        expect(activeOnly).toHaveLength(1);
        expect(activeOnly[0].uniteLegale.denominationUniteLegale).toBe('HQ ACTIVE');
    });
});

describe('oracle suite: executeTieredSearch orchestration', () => {
    it('throws if fetchFn is missing', async () => {
        await expect(queryBuilder.executeTieredSearch({ query: 'GO EMBAL' })).rejects.toThrow(/fetchFn is required/i);
    });

    it('returns Tier 2 when results exist', async () => {
        const fetchFn = vi.fn(async () => ({
            etablissements: [
                makeEtab({ legalName: 'GO EMBAL PLATEAUX', etablissementSiege: true }),
                makeEtab({ legalName: 'EMBAL GO', etablissementSiege: false })
            ]
        }));

        const res = await queryBuilder.executeTieredSearch({
            query: 'GO EMBAL',
            code_postal: '75001',
            commune: 'Paris',
            fetchFn
        });

        expect(res.tier).toBe(2);
        expect(res.results).toHaveLength(2);
    });

    it('falls back to Tier 3 when Tier 2 is empty (parallel execution)', async () => {
        const fetchFn = vi
            .fn()
            .mockResolvedValueOnce({ etablissements: [] })
            .mockResolvedValueOnce({ etablissements: [makeEtab({ legalName: 'GO EMBAL SARL', etablissementSiege: true })] });

        const res = await queryBuilder.executeTieredSearch({
            query: 'GO EMBAL',
            code_postal: '44100',
            commune: 'Nantes',
            fetchFn
        });

        expect(res.tier).toBe(3);
    });

    it('uses Tier 4 detective when AI variations produce a match', async () => {
        const fetchFn = vi
            .fn()
            .mockResolvedValueOnce({ etablissements: [] })
            .mockResolvedValueOnce({ etablissements: [] })
            .mockResolvedValueOnce({ etablissements: [] })
            .mockResolvedValueOnce({
                etablissements: [
                    makeEtab({ legalName: 'SOCIETE X', enseigne1: 'GO EMBALLAGE', etablissementSiege: true, currentStatus: 'A' }),
                    makeEtab({ legalName: 'SOCIETE X', enseigne1: 'GO EMBALLAGE', etablissementSiege: false, currentStatus: 'F' })
                ]
            });

        const aiVariationsFn = vi.fn(async () => ['GO EMBALLAGE', 'GO EMBAL']);

        const res = await queryBuilder.executeTieredSearch({
            query: 'GO EMBAL',
            code_postal: '75001',
            code_naf: '17.21A',
            fetchFn,
            aiVariationsFn
        });

        expect(res.tier).toBe(4);
        expect(res.results.every((r) => r.periodesEtablissement.find((p) => p.dateFin == null).etatAdministratifEtablissement === 'A')).toBe(true);
    });

    it('continues to Tier 5 if aiVariationsFn throws', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetchFn = vi
            .fn()
            .mockResolvedValueOnce({ etablissements: [] })
            .mockResolvedValueOnce({ etablissements: [] })
            .mockResolvedValueOnce({
                etablissements: [
                    makeEtab({ legalName: 'GO EMBAL', etablissementSiege: true }),
                    makeEtab({ legalName: 'GO EMBAL', etablissementSiege: false })
                ]
            });
        const aiVariationsFn = vi.fn(async () => {
            throw new Error('AI down');
        });

        const res = await queryBuilder.executeTieredSearch({
            query: 'GO EMBAL',
            code_postal: '75001',
            fetchFn,
            aiVariationsFn
        });

        expect(res.tier).toBe(5);
        expect(res.results.every((r) => r.etablissementSiege === true)).toBe(true);
        warnSpy.mockRestore();
    });
});

describe('oracle suite: scenario matrix', () => {
    const scenarios = [
        ['multi-word legal name', { query: 'GO EMBAL PLATEAUX' }],
        ['partial last word', { query: 'GO EMB' }],
        ['accented company', { query: 'Societe Generale' }],
        ['apostrophe company', { query: "L'Atelier du Bois" }],
        ['ligature company', { query: 'Coeur de France' }],
        ['hyphenated company', { query: 'Saint-Etienne Services' }],
        ['city with spaces', { query: 'ALPHA', commune: 'Aix en Provence' }],
        ['city with hyphen', { query: 'ALPHA', commune: 'Clermont-Ferrand' }],
        ['postal only', { query: 'ALPHA', code_postal: '33000' }],
        ['postal + city', { query: 'ALPHA', code_postal: '59000', commune: 'Lille' }],
        ['naf + legal category', { query: 'ALPHA', code_naf: '47.11D', nature_juridique: '5710' }],
        ['status active', { query: 'ALPHA', etat_administratif: 'A' }],
        ['workforce tranche', { query: 'ALPHA', tranche_effectif_salarie: '11' }]
    ];

    it.each(scenarios)('%s', (_label, params) => {
        const url = queryBuilder.buildSiretMultiCriteriaUrl(params);
        expect(url).toContain('/siret?');
        expect(getParam(url, 'nombre')).toBeTruthy();
    });
});
