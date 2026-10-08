import { factoryLevelMatch } from './performance-level-factories.js';

const WORKER_URL = new URL('./performance-level-worker.js', import.meta.url);
const aborted = () => new DOMException('Preset level preparation cancelled.', 'AbortError');
const supported = performance => ['synthesis', 'percussion'].includes(performance?.routing?.input);

/** One reusable offline renderer. Never owns Audio, transport, input permission or master gain. */
export class PerformanceLevelMatcher {
  constructor({ workerFactory = () => new Worker(WORKER_URL, { type: 'module', name: 'synthesis-preset-level' }), cacheSize = 32, factoryCache = true } = {}) {
    this.workerFactory = workerFactory;
    this.factoryCache = factoryCache;
    this.cacheSize = Math.max(1, Math.min(128, Math.floor(cacheSize) || 32));
    this.cache = new Map();
    this.worker = null;
    this.ready = null;
    this.finishWarm = null;
    this.active = null;
    this.nextId = 0;
    this.disposed = false;
  }

  warm() {
    if (this.disposed) return Promise.reject(new Error('Preset level preparation has closed.'));
    if (this.ready) return this.ready;
    try {
      const worker = this.worker = this.workerFactory();
      this.ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.fail(new Error('Preset level renderer took too long to start.')), 20000);
        this.finishWarm = error => {
          clearTimeout(timer); this.finishWarm = null;
          if (error) reject(error); else resolve();
        };
      });
      worker.onmessage = ({ data }) => {
        if (worker !== this.worker) return;
        if (data?.type === 'ready') this.finishWarm?.();
        else if (data?.type === 'error' && data.id == null) this.fail(new Error(data.message || 'Preset level renderer failed.'));
        else if (data?.id === this.active?.id) {
          const request = this.active;
          if (data.type === 'result') {
            this.cache.set(request.key, structuredClone(data.result));
            while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value);
            this.settle(request, null, data.result);
          } else if (data.type === 'error') this.settle(request, new Error(data.message || 'Preset level measurement failed.'));
        }
      };
      worker.onerror = event => this.fail(new Error(event?.message || 'Preset level worker could not load.'));
      worker.onmessageerror = () => this.fail(new Error('Preset level worker returned an unreadable response.'));
      worker.postMessage({ type: 'warm' });
      return this.ready;
    } catch (error) {
      this.fail(error);
      return Promise.reject(error);
    }
  }

  cached(performance, { sampleRate = 48000 } = {}) {
    if (this.disposed || !supported(performance)) return null;
    const key = JSON.stringify([sampleRate, performance]);
    const result = this.cache.get(key);
    return result ? structuredClone(result) : this.factoryCache ? factoryLevelMatch(performance, { sampleRate }) : null;
  }

  match(performance, { sampleRate = 48000, signal } = {}) {
    this.cancel();
    if (this.disposed) return Promise.reject(new Error('Preset level preparation has closed.'));
    if (signal?.aborted) return Promise.reject(aborted());
    if (!supported(performance)) return Promise.resolve({ sourceTrimDb: null, outputGain: 1, stats: { skipped: 'external-input' } });
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) return Promise.reject(new RangeError('Unsupported level-render sample rate.'));
    let snapshot, key;
    try { snapshot = structuredClone(performance); key = JSON.stringify([sampleRate, snapshot]); }
    catch (error) { return Promise.reject(error); }
    const factory = this.factoryCache && factoryLevelMatch(snapshot, { sampleRate });
    if (factory) return Promise.resolve(factory);
    if (this.cache.has(key)) {
      const result = this.cache.get(key);
      this.cache.delete(key); this.cache.set(key, result);
      return Promise.resolve(structuredClone(result));
    }
    return new Promise((resolve, reject) => {
      const request = { id: ++this.nextId, key, resolve, reject, signal, onAbort: () => this.cancel() };
      this.active = request;
      signal?.addEventListener('abort', request.onAbort, { once: true });
      // A stalled worker cannot keep the preset transaction pending forever.
      request.timer = setTimeout(() => this.fail(new Error('Preset level measurement timed out.')), 60000);
      this.warm().then(() => {
        if (this.active !== request || this.disposed) return;
        try { this.worker.postMessage({ type: 'match', id: request.id, performance: snapshot, sampleRate }); }
        catch (error) { this.fail(error); }
      }, error => { if (this.active === request) this.settle(request, error); });
    });
  }

  settle(request, error, result) {
    clearTimeout(request.timer);
    request.signal?.removeEventListener('abort', request.onAbort);
    if (this.active === request) this.active = null;
    if (error) request.reject(error); else request.resolve(structuredClone(result));
  }

  cancel() {
    const request = this.active;
    if (!request) return;
    this.worker?.postMessage({ type: 'cancel', id: request.id });
    this.settle(request, aborted());
  }

  fail(error) {
    this.finishWarm?.(error);
    if (this.active) this.settle(this.active, error);
    this.worker?.terminate(); this.worker = null; this.ready = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.finishWarm?.(aborted());
    this.worker?.terminate(); this.worker = null; this.ready = null;
    this.cache.clear();
  }
}
