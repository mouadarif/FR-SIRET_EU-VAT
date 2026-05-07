// Agent 4: Simple cache with TTL + endpoint-aware policies
const CACHE_POLICY_TTL_MINUTES = {
    lookup: 15,
    search: 5,
    facette: 10,
    info: 30,
    default: 5
};

class Cache {
    constructor(ttlMinutes = 5) {
        this.cache = new Map();
        this.ttl = ttlMinutes * 60 * 1000;
    }

    _ttlFromPolicy(policy) {
        const minutes = CACHE_POLICY_TTL_MINUTES[policy] ?? CACHE_POLICY_TTL_MINUTES.default;
        return minutes * 60 * 1000;
    }

    _get(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;

        if (Date.now() > cached.expiry) {
            this.cache.delete(key);
            return null;
        }

        return cached.value;
    }

    _set(key, value, ttlMs) {
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttlMs
        });
    }

    get(key) {
        return this._get(key);
    }

    set(key, value) {
        this._set(key, value, this.ttl);
    }

    getWithPolicy(key, _policy = 'default') {
        return this._get(key);
    }

    setWithPolicy(key, value, policy = 'default') {
        this._set(key, value, this._ttlFromPolicy(policy));
    }

    policyFromUrl(url = '') {
        if (/\/informations(?:\?|$)/i.test(url)) return 'info';
        if (/facette/i.test(url)) return 'facette';
        if (/\/siret\/\d{14}(?:\?|$)/i.test(url) || /\/siren\/\d{9}(?:\?|$)/i.test(url)) {
            return 'lookup';
        }
        return 'search';
    }

    clear() {
        this.cache.clear();
    }

    size() {
        return this.cache.size;
    }
}

export default new Cache(5);
