// Concurrent request queue with rate limiting.
// Allows up to `maxConcurrent` in-flight requests simultaneously
// instead of serializing them one-by-one.
class RequestQueue {
    constructor(maxConcurrent = 7) {
        this.maxConcurrent = maxConcurrent;
        this.queue = [];
        this.activeCount = 0;
    }

    add(requestFn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ requestFn, resolve, reject });
            this._drain();
        });
    }

    _drain() {
        while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
            const { requestFn, resolve, reject } = this.queue.shift();
            this.activeCount++;

            requestFn()
                .then(resolve, reject)
                .finally(() => {
                    this.activeCount--;
                    this._drain();
                });
        }
    }

    get pending() {
        return this.queue.length;
    }

    get active() {
        return this.activeCount;
    }
}

export default new RequestQueue(7);
