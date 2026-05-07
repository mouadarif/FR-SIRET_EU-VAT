import { describe, expect, it } from 'vitest';
import { submitSiretEnrichment } from '../batchEnrichmentService';

const HAS_BACKEND = String(import.meta.env.VITE_RUN_BACKEND_INTEGRATION || '') === '1';

describe('backend SIRET enrichment integration', () => {
    it(
        'can call the local backend when explicitly enabled',
        async () => {
            if (!HAS_BACKEND) {
                console.warn('Skipped: set VITE_RUN_BACKEND_INTEGRATION=1 and run the backend to enable this test');
                return;
            }

            const file = new File(['FR_SIRET\n55210055400013'], 'input.csv', { type: 'text/csv' });
            const result = await submitSiretEnrichment({
                file,
                siretColumn: 'FR_SIRET'
            });

            expect(result.blob.size).toBeGreaterThan(0);
            expect(result.filename).toMatch(/\.xlsx$/);
        },
        120000
    );
});
