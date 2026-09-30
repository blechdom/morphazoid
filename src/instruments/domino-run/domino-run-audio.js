import { connectAudioOutput } from '../../audio-output-manager.js';
import { resumeAudioContext, withAudioTimeout } from '../../audio-startup.js';
import { IMPACT_SIZE_EXPONENT, MIN_IMPACT_HEIGHT, MAX_IMPACT_HEIGHT, materialId, renderImpact } from './domino-run-sound.js';

const clamp = (value, low, high, fallback = low) => Math.min(high, Math.max(low,
  Number.isFinite(Number(value)) ? Number(value) : fallback));
const abortError = () => new DOMException('Audio startup cancelled.', 'AbortError');
const safeDisconnect = (node) => { try { node?.disconnect(); } catch { /* Already detached. */ } };
const MAX_CACHE = 256;

/** Reproducible, bounded strike color; no timing, pitch or spatial jitter. */
export function impactVariation(seed, amount = 0) {
  const depth = clamp(amount, 0, 1);
  if (depth === 0) return { strength: 1, tilt: 0, attack: 0, body: 0 };
  let state = 2166136261;
  for (const character of String(seed).slice(0, 128)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  state = (state >>> 0) || 0x6d2b79f5;
  const signed = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 2147483648 - 1;
  };
  return { strength: 1 + signed() * depth * 0.12,
    tilt: signed() * depth * 0.45,
    attack: signed() * depth * 0.20,
    body: signed() * depth * 0.15 };
}

/**
 * Explicit Audio lifecycle. Play/queue never create or resume an AudioContext.
 *
 * arm() -> Promise<AudioContext>; setArmed(false) mutes and cancels all attacks.
 * queue(events, startAt?, {preserveStart:false}) -> AudioContext start, or null if off.
 *   event.time is relative seconds; use the returned time for the visual clock.
 *   preserveStart keeps an existing clock anchor and skips expired attacks.
 * play(event, when?) -> boolean; when is absolute AudioContext time.
 *   event: { material, height, energy, type:'contact'|'floor', pan:-1..1 }.
 *   If pan is omitted, x is mapped through tanh(x/8).
 * prepare(events) pre-renders missing material/size/settings buffers while armed.
 * cancelQueued() removes future attacks while preserving audible resonance tails.
 * setParams({ring,brightness,soundVariation,pitch}), setLevel(0..1), silence(), async dispose().
 * context/armed/status getters expose transport clock and bounded mixer counts.
 */
export class DominoAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this._context = null;
    this._armed = false;
    this._disposed = false;
    this._generation = 0;
    this._starting = null;
    this._workletReady = false;
    this.level = 0.5;
    this.params = { ring: 0.5, brightness: 0.5, soundVariation: 0.2, pitch: 0 };
    this._hitSerial = 0;
    this._queueSerial = 0;
    this.cache = new Map();
    this._nextBuffer = 1;
    this._status = { active: 0, queued: 0, buffers: 0, played: 0, dropped: 0, stolen: 0 };
  }

  get context() { return this._context; }
  get armed() { return this._armed && this._context?.state === 'running'; }
  get status() { return { ...this._status, armed: this.armed, cached: this.cache.size }; }

  async arm() {
    if (this._disposed) throw new Error('This instrument has been closed. Reload to start Audio.');
    if (this.armed) return this._context;
    if (this._starting) return this._starting;
    const generation = ++this._generation;
    if (!this._context) {
      const Constructor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      if (!Constructor) throw new Error('Web Audio is unavailable in this browser.');
      this._context = new Constructor({ latencyHint: 'interactive' });
    }
    const context = this._context;
    // Resume directly in the Audio gesture, before asynchronous worklet loading.
    const resumed = resumeAudioContext(context);
    const start = (async () => {
      await resumed;
      if (!context.audioWorklet || !this.runtime.AudioWorkletNode) {
        throw new Error('Domino Run needs a browser with AudioWorklet support.');
      }
      if (!this._workletReady) {
        await withAudioTimeout(context.audioWorklet.addModule(new URL('./domino-run-processor.js', import.meta.url)));
        if (generation !== this._generation || this._disposed) throw abortError();
        this.mixer = new this.runtime.AudioWorkletNode(context, 'domino-run-processor', {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        });
        this.mixer.port.onmessage = ({ data }) => { this._status = data; };
        this.highpass = context.createBiquadFilter();
        this.highpass.type = 'highpass'; this.highpass.frequency.value = 22; this.highpass.Q.value = 0.6;
        this.compressor = context.createDynamicsCompressor();
        this.compressor.threshold.value = -16; this.compressor.knee.value = 16;
        this.compressor.ratio.value = 8; this.compressor.attack.value = 0.003; this.compressor.release.value = 0.16;
        this.limiter = context.createWaveShaper();
        const curve = new Float32Array(2049);
        for (let i = 0; i < curve.length; i += 1) curve[i] = Math.tanh((i / 2048 * 2 - 1) * 1.4) * 0.9;
        this.limiter.curve = curve; this.limiter.oversample = '2x';
        this.master = context.createGain(); this.master.gain.value = 0;
        this.mixer.connect(this.highpass).connect(this.compressor).connect(this.limiter).connect(this.master);
        this.releaseOutput = connectAudioOutput(context, this.master, { runtime: this.runtime });
        this._workletReady = true;
      }
      if (generation !== this._generation || this._disposed) throw abortError();
      this._armed = true;
      this._rampLevel(this.level);
      return context;
    })();
    this._starting = start;
    try { return await start; }
    catch (error) { if (generation === this._generation) { this._armed = false; this._rampLevel(0); } throw error; }
    finally { if (this._starting === start) this._starting = null; }
  }

  setArmed(value) {
    if (value) return this.arm();
    this._generation += 1;
    this._armed = false;
    this._rampLevel(0);
    this.silence();
    return Promise.resolve(false);
  }

  _rampLevel(value) {
    if (!this.master || !this._context) return;
    const now = this._context.currentTime;
    const parameter = this.master.gain;
    if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(now);
    else { parameter.cancelScheduledValues(now); parameter.setValueAtTime(parameter.value, now); }
    parameter.linearRampToValueAtTime(value, now + 0.015);
  }

  setLevel(value) {
    this.level = clamp(value, 0, 1, 0.5);
    this._rampLevel(this._armed ? this.level : 0);
  }

  setParams(values = {}) {
    if (values.ring !== undefined) this.params.ring = clamp(values.ring, 0, 1, this.params.ring);
    if (values.brightness !== undefined) this.params.brightness = clamp(values.brightness, 0, 1, this.params.brightness);
    if (values.soundVariation !== undefined) this.params.soundVariation = clamp(values.soundVariation, 0, 1, this.params.soundVariation);
    if (values.pitch !== undefined) this.params.pitch = clamp(values.pitch, -36, 36, this.params.pitch);
  }

  _buffer(event) {
    const material = materialId(event.material);
    const height = clamp(event.height, MIN_IMPACT_HEIGHT, MAX_IMPACT_HEIGHT, 1);
    // Quarter-octave cache bins save synthesis work. Playback-rate correction
    // restores the exact continuous size/pitch relation for every domino.
    const heightBin = Math.round(Math.log2(height) * 4);
    const size = 2 ** (heightBin / 4);
    const ring = Math.round(this.params.ring * 32) / 32;
    const brightness = Math.round(this.params.brightness * 8) / 8;
    const pitch = this.params.pitch;
    const type = event.type === 'floor' ? 'floor' : 'contact';
    const key = `${material}:${heightBin}:${type}:${ring}:${brightness}:${pitch}`;
    let cached = this.cache.get(key);
    if (!cached) {
      const sampleRate = Math.min(24000, this._context.sampleRate);
      const data = renderImpact(material, size, 1, type, { sampleRate, ring, brightness, pitch, seed: 1729 + heightBin });
      cached = { id: this._nextBuffer++, size };
      this.mixer.port.postMessage({ type: 'buffer', id: cached.id, sampleRate, data }, [data.buffer]);
    } else this.mixer.port.postMessage({ type: 'touch', id: cached.id });
    // Keep both LRU caches in the same order, including prepare() hits.
    this.cache.delete(key); this.cache.set(key, cached);
    while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
    return { bufferId: cached.id, rate: (cached.size / height) ** IMPACT_SIZE_EXPONENT };
  }

  prepare(events = []) {
    if (!this.armed) return 0;
    const previous = this._nextBuffer;
    for (const event of events.slice(0, 4096)) this._buffer(event);
    return this._nextBuffer - previous;
  }

  _event(event, time) {
    const energy = clamp(event.energy, 0, 2, 1);
    if (energy === 0) return null;
    // Streaming event IDs survive pause and requeue. Manual/finite hits use a
    // bounded deterministic counter so repeated strikes still vary naturally.
    const identity = Number.isFinite(event.eventId)
      ? `event:${event.eventId}:${event.occurrenceId ?? ''}:${event.id ?? ''}:${event.type}:${event.targetId ?? ''}`
      : `hit:${this._hitSerial = (this._hitSerial + 1) >>> 0}`;
    const variation = impactVariation(identity, this.params.soundVariation);
    return { ...this._buffer(event), time, variation,
      gain: Math.sqrt(energy) * 0.6 * variation.strength,
      pan: event.pan === undefined ? Math.tanh(clamp(event.x, -100, 100, 0) / 8) * 0.85 : clamp(event.pan, -1, 1) };
  }

  play(event = {}, when = this._context?.currentTime) {
    if (!this.armed) return false;
    const requested = Number(when);
    if (!Number.isFinite(requested) || requested < this._context.currentTime - 0.06) return false;
    const planned = this._event(event, Math.max(requested, this._context.currentTime + 0.003));
    if (!planned) return false;
    // Buffer generation may have consumed a few milliseconds on the first tap.
    planned.time = Math.max(planned.time, this._context.currentTime + 0.003);
    this.mixer.port.postMessage({ type: 'events', events: [planned] });
    return true;
  }

  queue(events = [], startAt, { preserveStart = false } = {}) {
    if (!this.armed) return null;
    const staged = events.length > 128;
    const batch = staged ? (this._queueSerial = (this._queueSerial + 1) >>> 0) : null;
    let planned = [];
    for (const event of events.slice(0, 4096)) {
      if (!Number.isFinite(event.time) || event.time < 0) continue;
      const next = this._event(event, event.time);
      if (next) planned.push(next);
      if (staged && planned.length === 128) {
        this.mixer.port.postMessage({ type: 'stage', batch, events: planned });
        planned = [];
      }
    }
    if (staged && planned.length) this.mixer.port.postMessage({ type: 'stage', batch, events: planned });
    const now = this._context.currentTime;
    const requested = Number(startAt);
    // Live edits retain their clock anchor through cold-cache preparation.
    // Expired attacks are skipped rather than squeezed into a late burst.
    const keepClock = preserveStart && Number.isFinite(requested);
    const start = keepClock ? requested : Math.max(requested || 0, now + 0.04);
    if (staged) {
      this.mixer.port.postMessage({ type: 'commit', batch, start, notBefore: keepClock ? now : -Infinity });
      return start;
    }
    for (const event of planned) event.time += start;
    const upcoming = keepClock ? planned.filter((event) => event.time >= now) : planned;
    this.mixer.port.postMessage({ type: 'events', events: upcoming });
    return start;
  }

  cancelQueued() {
    this.mixer?.port.postMessage({ type: 'cancel' });
    this._status = { ...this._status, queued: 0 };
  }

  silence() {
    this.mixer?.port.postMessage({ type: 'silence' });
    this._status = { ...this._status, queued: 0 };
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.setArmed(false);
    const context = this._context;
    if (context?.state === 'running') await new Promise((resolve) => setTimeout(resolve, 20));
    this.mixer?.port.postMessage({ type: 'dispose' });
    if (this.mixer) this.mixer.port.onmessage = null;
    this.releaseOutput?.(); this.releaseOutput = null;
    [this.mixer, this.highpass, this.compressor, this.limiter, this.master].forEach(safeDisconnect);
    this.cache.clear(); this._context = null;
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
}

export { renderImpact } from './domino-run-sound.js';
