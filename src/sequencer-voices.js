import {
  SEQUENCER_VOICES, sequencerVoice, loadSequencerVoiceKernels, renderSequencerVoice,
} from "./sequencer-voice-renderer.js";
export { SEQUENCER_VOICES, sequencerVoice } from "./sequencer-voice-renderer.js";
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const BRIGHTNESS = Object.freeze([.16, .55, .95]);
const aborted = () => Object.assign(new Error("Sequencer voices preparation was cancelled."), { name: "AbortError" });

/** One destination in the caller's explicitly armed AudioContext. Preparation
 * compiles existing SIMD WASM and caches bounded source buffers; trigger never
 * fetches, renders, waits for a worker, or creates an AudioContext. */
export class SequencerVoiceBank {
  constructor({ runtime = globalThis, maxVoices = 32, maxCacheBytes = 12 * 1024 * 1024, forceScalar = false, onError } = {}) {
    this.runtime = runtime;
    this.maxVoices = Math.round(clamp(finite(maxVoices, 32), 1, 64));
    this.maxCacheBytes = Math.max(1024 * 1024, finite(maxCacheBytes, 12 * 1024 * 1024));
    this.forceScalar = forceScalar;
    this.onError = onError;
    this.context = null;
    this.output = null;
    this.destination = null;
    this.active = new Set();
    this.cache = new Map();
    this.cacheBytes = 0;
    this.generation = 0;
    this.muted = false;
    this.ready = false;
    this.pending = null;
    this.kernels = null;
    this.driveCurves = Array.from({ length: 9 }, (_, character) => {
      const curve = new Float32Array(1025);
      const slope = 1.1 + character / 8 * 3;
      for (let i = 0; i < curve.length; i += 1) curve[i] = Math.tanh((i / (curve.length - 1) * 2 - 1) * slope) / Math.tanh(slope);
      return curve;
    });
    this.stats = { triggered: 0, skipped: 0, stolen: 0 };
  }

  async prepare(context, destination = context?.destination) {
    if (!context || !destination || context.state === "closed") throw new Error("Supply an explicitly enabled AudioContext and destination.");
    if (this.context === context && this.destination === destination) {
      if (this.pending) return this.pending;
      if (this.ready) return this;
    }
    this.dispose();
    const generation = this.generation;
    this.context = context;
    this.destination = destination;
    const output = context.createGain();
    output.gain.value = this.muted ? 0 : 1;
    // A bounded final soft clip protects dense parallel face/cell chords.
    const ceiling = context.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i += 1) curve[i] = .84 * Math.tanh((i / (curve.length - 1) * 2 - 1) * 1.25);
    ceiling.curve = curve;
    output.connect(ceiling).connect(destination);
    this.output = output;
    this.ceiling = ceiling;
    const pending = (async () => {
      const kernels = await loadSequencerVoiceKernels(this.runtime, { forceScalar: this.forceScalar });
      if (generation !== this.generation) throw aborted();
      this.kernels = kernels;
      for (const voice of SEQUENCER_VOICES) {
        for (let tone = 0; tone < BRIGHTNESS.length; tone += 1) {
          if (generation !== this.generation) throw aborted();
          const rendered = renderSequencerVoice({ voice: voice.id, sampleRate: context.sampleRate, frequency: 220, brightness: BRIGHTNESS[tone] }, this.kernels);
          const buffer = context.createBuffer(1, rendered.samples.length, rendered.sampleRate);
          buffer.getChannelData(0).set(rendered.samples);
          const bytes = rendered.samples.byteLength;
          if (this.cacheBytes + bytes > this.maxCacheBytes) throw new Error("Sequencer voice cache exceeds its memory budget.");
          this.cache.set(`${voice.id}:${tone}`, { ...rendered, samples: undefined, buffer, bytes });
          this.cacheBytes += bytes;
          // Keep preparation responsive; no synthesis occurs in trigger().
          await new Promise((resolve) => (this.runtime.setTimeout ?? globalThis.setTimeout)(resolve, 0));
        }
      }
      if (generation !== this.generation) throw aborted();
      this.ready = true;
      for (const message of this.kernels.failures) this.onError?.(new Error(message));
      return this;
    })();
    this.pending = pending;
    try { return await pending; }
    catch (error) {
      if (generation === this.generation) this.dispose();
      throw error;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  trigger(options = {}) {
    const context = this.context;
    const now = context?.currentTime ?? 0;
    const requested = finite(options.when, now);
    const velocity = clamp(finite(options.velocity, .75), 0, 1);
    if (!this.ready || !context || context.state === "closed" || this.muted || velocity === 0 || requested < now - .06) {
      this.stats.skipped += 1;
      return null;
    }
    // Legacy instruments can retain their per-sticker/gesture gates. Their
    // supplied destination owns final limiting; this bank still owns every
    // source envelope, mute, and teardown in the same AudioContext.
    const destination = options.destination ?? this.output;
    if (destination?.context && destination.context !== context) {
      this.stats.skipped += 1;
      return null;
    }
    const descriptor = sequencerVoice(options.voice);
    const brightness = clamp(finite(options.brightness, .55), 0, 1);
    const tone = BRIGHTNESS.reduce((best, value, index) => Math.abs(value - brightness) < Math.abs(BRIGHTNESS[best] - brightness) ? index : best, 0);
    const cached = this.cache.get(`${descriptor.id}:${tone}`);
    if (!cached) { this.stats.skipped += 1; return null; }
    const when = Math.max(now, Math.min(now + 2, requested));
    const duration = clamp(finite(options.duration, .16), .015, 16);
    const attack = Math.min(duration * .45, clamp(finite(options.attack, .004), .001, 1));
    const decay = Math.min(duration - attack, clamp(finite(options.decay, .045), .001, 2));
    const sustain = clamp(finite(options.sustain, descriptor.kind === "synth" ? .65 : .5), 0, 1);
    const release = clamp(finite(options.release, .065), .005, 2);
    const frequency = clamp(finite(options.frequency, 220), 20, Math.min(12000, context.sampleRate * .4));
    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const driveGain = context.createGain();
    const shaper = context.createWaveShaper();
    const character = clamp(finite(options.character, .25), 0, 1);
    const cutoff = clamp(finite(options.cutoff, 1400 + brightness * 12500), 80, context.sampleRate * .44);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(context.sampleRate * .44, cutoff * (1 + character * 1.2)), when);
    filter.frequency.exponentialRampToValueAtTime(cutoff, when + Math.min(duration * .8, .18));
    filter.Q.setValueAtTime(clamp(finite(options.resonance, .4), 0, 12), when);
    driveGain.gain.setValueAtTime(clamp(finite(options.drive, 1), .2, 4), when);
    shaper.curve = this.driveCurves[Math.round(character * 8)];
    const pan = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
    source.buffer = cached.buffer;
    source.playbackRate.setValueAtTime(frequency / cached.frequency, when);
    source.loop = cached.loop;
    source.loopStart = cached.loopStart;
    source.loopEnd = cached.loopEnd;
    const peak = .38 * velocity;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    gain.gain.linearRampToValueAtTime(peak * sustain, when + attack + decay);
    gain.gain.setValueAtTime(peak * sustain, when + duration);
    gain.gain.linearRampToValueAtTime(0, when + duration + release);
    source.connect(filter).connect(driveGain).connect(shaper).connect(gain);
    if (pan) {
      pan.pan.setValueAtTime(clamp(finite(options.pan, 0), -1, 1), when);
      gain.connect(pan).connect(destination);
    } else gain.connect(destination);
    const stopAt = when + duration + release + .002;
    const handle = { source, gain, pan, filter, driveGain, shaper, when, stopAt, referenceFrequency: cached.frequency, voice: descriptor.id, backend: cached.backend, stopped: false };
    const cleanup = () => {
      this.active.delete(handle);
      source.disconnect(); gain.disconnect(); filter.disconnect(); driveGain.disconnect(); shaper.disconnect(); pan?.disconnect();
    };
    source.onended = cleanup;
    while (this.active.size >= this.maxVoices) {
      const oldest = this.active.values().next().value;
      this.releaseVoice(oldest, now);
      this.stats.stolen += 1;
    }
    this.active.add(handle);
    source.start(when);
    source.stop(stopAt);
    this.stats.triggered += 1;
    return handle;
  }

  releaseVoice(handle, when = this.context?.currentTime ?? 0) {
    if (!handle || handle.stopped) return;
    handle.stopped = true;
    const param = handle.gain.gain;
    try {
      if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(when);
      else { param.cancelScheduledValues(when); param.setValueAtTime(0, when); }
      param.linearRampToValueAtTime(0, when + .008);
      handle.source.stop(when + .009);
    } catch { /* already ended */ }
    this.active.delete(handle);
  }

  stop() { for (const handle of this.active) this.releaseVoice(handle); }
  cancelScheduled(after = this.context?.currentTime ?? 0) {
    let count = 0;
    for (const handle of this.active) {
      if (handle.when <= after) continue;
      this.releaseVoice(handle);
      count += 1;
    }
    return count;
  }
  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.output && this.context) this.output.gain.setTargetAtTime(this.muted ? 0 : 1, this.context.currentTime, .008);
    if (this.muted) this.stop();
  }
  dispose() {
    this.generation += 1;
    this.stop();
    this.output?.disconnect();
    this.ceiling?.disconnect();
    this.output = null;
    this.ceiling = null;
    this.context = null;
    this.destination = null;
    this.ready = false;
    this.pending = null;
    this.kernels = null;
    this.cache.clear();
    this.cacheBytes = 0;
  }
  diagnostics() {
    return {
      prepared: this.ready, activeVoices: this.active.size, maxVoices: this.maxVoices,
      cacheBytes: this.cacheBytes, templates: this.cache.size,
      backends: { ...this.kernels?.backends }, failures: [...(this.kernels?.failures ?? [])],
      ...this.stats,
    };
  }
}

/** Add supported shared engines to a native select while retaining local voice
 * IDs and labels. The instrument still owns change events and scheduling. */
export function appendSequencerVoiceOptions(select, { prefix = "", include = SEQUENCER_VOICES.map(({ id }) => id) } = {}) {
  if (!select?.ownerDocument) return;
  for (const id of include) {
    const descriptor = SEQUENCER_VOICES.find((voice) => voice.id === id);
    if (!descriptor) continue;
    const value = `${prefix}${id}`;
    if (Array.from(select.options ?? []).some((option) => option.value === value)) continue;
    const option = select.ownerDocument.createElement("option");
    option.value = value;
    option.textContent = descriptor.label;
    select.append(option);
  }
}
