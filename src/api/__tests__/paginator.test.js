import { describe, expect, it } from 'vitest';
import {
    assertTriCurseurGuard,
    buildCursorStartParams,
    clampJsonPagination,
    paginateByCursor
} from '../paginator.js';

describe('paginator guardrails', () => {
    it('throws when tri and curseur are both set', () => {
        expect(() => assertTriCurseurGuard({ tri: 'asc', curseur: '*' })).toThrow('tri');
    });

    it('clamps JSON pagination bounds', () => {
        const out = clampJsonPagination({ nombre: 5000, debut: 9000 });
        expect(out).toEqual({ nombre: 1000, debut: 1000 });
    });

    it('starts deep pagination with curseur=*', () => {
        const out = buildCursorStartParams({ nombre: 10 });
        expect(out).toEqual({ nombre: 10, curseur: '*' });
    });
});

describe('paginateByCursor stop condition', () => {
    it('stops when curseur no longer advances', async () => {
        const pages = await paginateByCursor(async (cursor) => {
            if (cursor === '*') {
                return { header: { curseur: '*', curseurSuivant: 'abc' }, etablissements: [1] };
            }
            return { header: { curseur: 'abc', curseurSuivant: 'abc' }, etablissements: [2] };
        });

        expect(pages).toHaveLength(2);
        expect(pages[1].header.curseur).toBe('abc');
    });
});
