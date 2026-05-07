import { describe, expect, it } from 'vitest';
import queryBuilder from '../queryBuilder.js';

function decodeQ(url) {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.searchParams.get('q') || '');
}

describe('partial SIRET search', () => {
    it('uses exact match for 14-digit SIRET', () => {
        const url = queryBuilder.buildSiretMultiCriteriaUrl({ siret: '44306184100047' });
        expect(decodeQ(url)).toContain('siret:44306184100047');
        expect(decodeQ(url)).not.toContain('siret:44306184100047*');
    });

    it('uses wildcard for 9-digit SIREN prefix', () => {
        const url = queryBuilder.buildSiretMultiCriteriaUrl({ siret: '443061841' });
        expect(decodeQ(url)).toContain('siret:443061841*');
    });

    it('strips non digits from SIRET input', () => {
        const url = queryBuilder.buildSiretMultiCriteriaUrl({ siret: '443-061-841 000 47' });
        expect(decodeQ(url)).toContain('siret:44306184100047');
    });

    it('combines partial SIRET with name and city filters', () => {
        const url = queryBuilder.buildSiretMultiCriteriaUrl({
            query: 'Restaurant',
            siret: '751',
            commune: 'Paris'
        });
        const decoded = decodeQ(url);
        expect(decoded).toContain('denominationUniteLegale:Restaurant*');
        expect(decoded).toContain('periode(enseigne1Etablissement:Restaurant*)');
        expect(decoded).toContain('siret:751*');
        expect(decoded).toContain('libelleCommuneEtablissement:Paris*');
        expect(decoded).not.toContain('raisonSociale:');
    });
});
