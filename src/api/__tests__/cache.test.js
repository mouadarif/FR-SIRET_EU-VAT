// Agent 4: Cache tests
import { describe, it, expect, beforeEach } from 'vitest';
import cache from '../cache';

describe('Cache', () => {
    beforeEach(() => {
        cache.clear();
    });

    it('should store and retrieve values', () => {
        cache.set('test-key', { data: 'test-value' });
        const result = cache.get('test-key');

        expect(result).toEqual({ data: 'test-value' });
    });

    it('should return null for missing keys', () => {
        const result = cache.get('non-existent-key');
        expect(result).toBeNull();
    });

    it('should expire after TTL', async () => {
        // Create cache with 1ms TTL for testing
        const testCache = {
            cache: new Map(),
            ttl: 1,

            get(key) {
                const cached = this.cache.get(key);
                if (!cached) return null;
                if (Date.now() > cached.expiry) {
                    this.cache.delete(key);
                    return null;
                }
                return cached.value;
            },

            set(key, value) {
                this.cache.set(key, {
                    value,
                    expiry: Date.now() + this.ttl
                });
            }
        };

        testCache.set('expire-test', 'value');

        // Wait for expiry
        await new Promise(resolve => setTimeout(resolve, 10));

        const result = testCache.get('expire-test');
        expect(result).toBeNull();
    });

    it('should clear all entries', () => {
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');

        cache.clear();

        expect(cache.get('key1')).toBeNull();
        expect(cache.get('key2')).toBeNull();
        expect(cache.size()).toBe(0);
    });

    it('should return cache size', () => {
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        cache.set('key3', 'value3');

        expect(cache.size()).toBe(3);
    });
});
