import { describe, expect, it } from 'vitest';
import requestDedup from '../requestDedup.js';
import cache from '../cache.js';

describe('request dedup', () => {
    it('shares in-flight promise for same key', async () => {
        let calls = 0;
        const key = requestDedup.buildKey('https://example.test', { Accept: 'application/json' });

        const [a, b] = await Promise.all([
            requestDedup.run(key, async () => {
                calls += 1;
                return 'ok';
            }),
            requestDedup.run(key, async () => {
                calls += 1;
                return 'ok';
            })
        ]);

        expect(a).toBe('ok');
        expect(b).toBe('ok');
        expect(calls).toBe(1);
    });
});

describe('cache policies', () => {
    it('detects policy by endpoint', () => {
        expect(cache.policyFromUrl('https://api.insee.fr/api-sirene/3.11/informations')).toBe('info');
        expect(cache.policyFromUrl('https://api.insee.fr/api-sirene/3.11/siret/12345678901234')).toBe('lookup');
        expect(cache.policyFromUrl('https://api.insee.fr/api-sirene/3.11/siret?q=siren:123')).toBe('search');
    });
});
