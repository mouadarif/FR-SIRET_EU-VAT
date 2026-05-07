/**
 * In-flight request de-duplication.
 * Ensures concurrent callers for the same request key share one promise.
 */
class RequestDedup {
    constructor() {
        this.inFlight = new Map();
    }

    /**
     * @param {string} url
     * @param {Record<string, string>} [headers]
     * @returns {string}
     */
    buildKey(url, headers = {}) {
        const normalizedHeaders = Object.entries(headers)
            .map(([key, value]) => [String(key).toLowerCase(), String(value)])
            .sort(([a], [b]) => a.localeCompare(b));
        return `${url}::${JSON.stringify(normalizedHeaders)}`;
    }

    /**
     * @template T
     * @param {string} key
     * @param {() => Promise<T>} factory
     * @returns {Promise<T>}
     */
    run(key, factory) {
        if (this.inFlight.has(key)) {
            return this.inFlight.get(key);
        }

        const promise = Promise.resolve()
            .then(factory)
            .finally(() => {
                this.inFlight.delete(key);
            });

        this.inFlight.set(key, promise);
        return promise;
    }

    clear() {
        this.inFlight.clear();
    }

    size() {
        return this.inFlight.size;
    }
}

export default new RequestDedup();

