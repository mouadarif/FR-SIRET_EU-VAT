import { describe, expect, it } from 'vitest';
import { runKpiEngine } from '../kpiEngine.js';

describe('KPI engine', () => {
    it('executes KPI calculators in parallel', async () => {
        let started = 0;
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });

        const catalog = ['a', 'b', 'c'].map((id) => ({
            id,
            column: `KPI_${id.toUpperCase()}`,
            type: 'derived',
            compute: async () => {
                started += 1;
                await gate;
                return id;
            }
        }));

        const promise = runKpiEngine({ catalog, entity: {} });
        await Promise.resolve();
        await Promise.resolve();

        expect(started).toBe(3);
        release();

        const out = await promise;
        expect(out.values.KPI_A).toBe('a');
        expect(out.values.KPI_B).toBe('b');
        expect(out.values.KPI_C).toBe('c');
    });
});
