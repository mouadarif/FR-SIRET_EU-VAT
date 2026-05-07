import { describe, it, expect, beforeEach } from 'vitest';

describe('RequestQueue', () => {
    let RequestQueue;
    let queue;

    beforeEach(async () => {
        const module = await import('../requestQueue.js');
        RequestQueue = module.default.constructor;
        queue = new RequestQueue(7);
    });

    it('should execute requests and return results', async () => {
        const results = [];

        const promise1 = queue.add(async () => {
            results.push(1);
            return 'result1';
        });

        const promise2 = queue.add(async () => {
            results.push(2);
            return 'result2';
        });

        const [r1, r2] = await Promise.all([promise1, promise2]);
        expect(r1).toBe('result1');
        expect(r2).toBe('result2');
        expect(results).toContain(1);
        expect(results).toContain(2);
    });

    it('should run requests concurrently up to maxConcurrent', async () => {
        const concurrencyLog = [];
        let running = 0;

        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(queue.add(async () => {
                running++;
                concurrencyLog.push(running);
                await new Promise(resolve => setTimeout(resolve, 10));
                running--;
                return i;
            }));
        }

        await Promise.all(promises);
        const maxObserved = Math.max(...concurrencyLog);
        expect(maxObserved).toBeGreaterThan(1);
        expect(maxObserved).toBeLessThanOrEqual(7);
    });

    it('should handle errors in requests', async () => {
        const errorRequest = queue.add(async () => {
            throw new Error('Test error');
        });

        await expect(errorRequest).rejects.toThrow('Test error');
    });

    it('should continue processing after error', async () => {
        const promise1 = queue.add(async () => {
            throw new Error('Error');
        }).catch(() => 'error-handled');

        const promise2 = queue.add(async () => 'success');

        const results = await Promise.all([promise1, promise2]);

        expect(results).toEqual(['error-handled', 'success']);
    });
});
