import { describe, expect, it, vi } from 'vitest';
import { EntityResolver } from '../entityResolver.js';
import {
    clearEnrichmentCaches,
    setLane1SirenCandidates,
    setLane1SiretEntity
} from '../../services/memory/enrichmentCaches.js';

describe('EntityResolver lane-1 cache shortcuts', () => {
    it('resolves SIRET from bulk cache without network call', async () => {
        clearEnrichmentCaches();
        setLane1SiretEntity({
            siret: '12345678901234',
            date: '2024-03-12',
            entity: {
                siret: '12345678901234',
                siren: '123456789',
                etablissementSiege: true
            }
        });

        const fetchImpl = vi.fn();
        const resolver = new EntityResolver({
            apiKey: 'test-key',
            queryDate: '2024-03-12',
            fetchImpl
        });

        const out = await resolver.resolveBySiret('12345678901234');

        expect(out.status).toBe('resolved');
        expect(out.metadata.tierUsed).toBe('siret_bulk_cache');
        expect(out.entity?.siret).toBe('12345678901234');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('resolves SIREN from bulk cache without network call', async () => {
        clearEnrichmentCaches();
        setLane1SirenCandidates({
            siren: '987654321',
            date: '2024-05-01',
            candidates: [
                {
                    siret: '98765432100011',
                    siren: '987654321',
                    etablissementSiege: true
                },
                {
                    siret: '98765432100029',
                    siren: '987654321',
                    etablissementSiege: false
                }
            ]
        });

        const fetchImpl = vi.fn();
        const resolver = new EntityResolver({
            apiKey: 'test-key',
            queryDate: '2024-05-01',
            fetchImpl
        });

        const out = await resolver.resolveBySiren('987654321');

        expect(out.status).toBe('resolved');
        expect(out.metadata.tierUsed).toBe('siren_bulk_cache');
        expect(out.entity?.siret).toBe('98765432100011');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('EntityResolver fallback flow', () => {
    it('falls back from SIRET -> SIREN -> tiered name', async () => {
        const resolver = new EntityResolver({ apiKey: 'test-key' });

        vi.spyOn(resolver, 'resolveBySiret').mockResolvedValue({
            status: 'not_found',
            entity: null,
            metadata: { tierUsed: 'siret', candidateCount: 0, queryUsed: '', warnings: ['no siret'] }
        });
        vi.spyOn(resolver, 'resolveBySiren').mockResolvedValue({
            status: 'not_found',
            entity: null,
            metadata: { tierUsed: 'siren', candidateCount: 0, queryUsed: '', warnings: ['no siren'] }
        });
        vi.spyOn(resolver, 'resolveByNameTiered').mockResolvedValue({
            status: 'resolved',
            entity: { siret: '12345678901234', siren: '123456789' },
            metadata: {
                tierUsed: 'tier2_neighbor',
                candidateCount: 2,
                queryUsed: '/siret?q=test',
                warnings: ['Ambiguous tiered match']
            }
        });

        const out = await resolver.resolveAuto({
            siret: 'bad',
            siren: 'bad',
            name: 'Test Company',
            city: 'Paris',
            postalCode: '75001'
        });

        expect(resolver.resolveBySiret).toHaveBeenCalledTimes(1);
        expect(resolver.resolveBySiren).toHaveBeenCalledTimes(1);
        expect(resolver.resolveByNameTiered).toHaveBeenCalledTimes(1);
        expect(out.status).toBe('resolved');
        expect(out.metadata.tierUsed).toBe('tier2_neighbor');
        expect(out.metadata.candidateCount).toBe(2);
    });
});
