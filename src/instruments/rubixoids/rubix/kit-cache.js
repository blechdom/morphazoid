/** Serial, coalesced kit preparation. Ready buffers remain playable until an
 * entire replacement is ready; stale jobs never publish partial kits. */
export class RubixKitCache {
  constructor() {
    this.buffers = new Map();
    this.keys = new Map();
    this.pending = new Map();
    this.queue = Promise.resolve();
  }
  request(bank, key, render) {
    if (this.keys.get(bank) === key) { this.pending.delete(bank); return Promise.resolve(this.buffers.get(bank)); }
    const pending = this.pending.get(bank);
    if (pending?.key === key) return pending.promise;
    const request = { key };
    this.pending.set(bank, request);
    const current = () => this.pending.get(bank) === request;
    const job = this.queue.then(async () => {
      if (!current()) return null;
      const buffers = await render(current);
      if (!current() || !buffers) return null;
      this.buffers.set(bank, buffers);
      this.keys.set(bank, key);
      return buffers;
    });
    request.promise = job.finally(() => { if (current()) this.pending.delete(bank); });
    this.queue = request.promise.catch(() => {});
    return request.promise;
  }
  clear() {
    this.pending.clear(); this.buffers.clear(); this.keys.clear();
  }
}
