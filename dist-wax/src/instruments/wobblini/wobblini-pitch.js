import SignalsmithStretch from "../../../vendor/signalsmith-stretch/SignalsmithStretch.mjs";

const FADE = 0.008;
const MAX_VOICES = 8;
const DEFAULT_MEMORY_LIMIT = 192 * 1024 * 1024;
const accounts = new WeakMap();
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high, fallback) => Math.min(high, Math.max(low, finite(value, fallback)));
const rateFor = state => clamp(state.rate, 0.25, 1.75, 1);
const pitchFor = state => clamp(state.pitchSemitones, -12, 12, 0);

export function needsPitchProcessing(state) {
  return Math.abs(pitchFor(state)) > 1e-8 || Boolean(state.keyLock) && Math.abs(rateFor(state) - 1) > 1e-8;
}

export function pitchOutputSemitones(state) {
  return pitchFor(state) + (state.keyLock ? 0 : 12 * Math.log2(rateFor(state)));
}

function accountFor(context) {
  let account = accounts.get(context);
  if (!account) { account = { slots: new Set(), memory: new Map() }; accounts.set(context, account); }
  return account;
}

/** Extra PCM only: callers include this in native file/decode preflight too.
 * WASM overhead is bounded separately by the fixed maximum of eight nodes. */
export function wobbliniPitchMemoryBytes(context) {
  return context ? [...accountFor(context).memory.values()].reduce((sum, bytes) => sum + bytes, 0) : 0;
}

function disconnect(node) { try { node?.disconnect(); } catch { /* Already released. */ } }
function close(node) { if (!node) return; node.onprocessorerror = null; disconnect(node); node.port?.close(); }
function hold(param, when) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(when);
  else { param.cancelScheduledValues(when); param.setValueAtTime(param.value, when); }
}
function gainAt(param, value, when, immediate = false) {
  hold(param, when);
  if (immediate) param.setValueAtTime(value, when);
  else param.linearRampToValueAtTime(value, when + FADE);
}
function defaultOfflineFactory(channels, length, sampleRate) {
  const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new Error("This browser cannot resample audio for Key Lock.");
  return new Offline(channels, length, sampleRate);
}

/** One lazy, stereo Signalsmith buffer player. It never creates/resumes an
 * AudioContext or owns transport. The caller projects position to `when`, using
 * the same future boundary for native and processed decks. Buffer mode already
 * compensates latency: never add latency to the input position here.
 * Scratching bypasses this player; stop(..., true) gates it immediately.
 */
export function createWobbliniPitch(options) { return new WobbliniPitch(options); }

class WobbliniPitch {
  constructor({ context, output, stretchFactory = SignalsmithStretch, offlineFactory = defaultOfflineFactory,
    memoryLimit = DEFAULT_MEMORY_LIMIT, getBaseBytes = () => 0, onError = () => {}, timeoutMs = 12000 } = {}) {
    if (!context || !output) throw new Error("Pitch playback needs an existing audio context and output.");
    this.context = context; this.output = output; this.stretchFactory = stretchFactory; this.offlineFactory = offlineFactory;
    this.memoryLimit = Math.max(0, finite(memoryLimit, DEFAULT_MEMORY_LIMIT)); this.getBaseBytes = getBaseBytes;
    this.onError = onError; this.timeoutMs = Math.max(1, finite(timeoutMs, 12000)); this.account = accountFor(context);
    this.node = null; this.gain = null; this.buffer = null; this.requestedBuffer = null;
    this.latency = 0; this.disposed = false; this.revision = 0; this.pending = null; this.lease = null; this.slot = null;
  }

  _bounded(promise, label) {
    let timer;
    return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out. Turn Audio off and try again.`)), this.timeoutMs);
    })]).finally(() => clearTimeout(timer));
  }
  _valid(revision) { return !this.disposed && this.revision === revision; }
  _reserve(lease, bytes) {
    const old = this.account.memory.get(lease) ?? 0;
    const base = Math.max(0, finite(this.getBaseBytes(), this.memoryLimit));
    if (!Number.isSafeInteger(bytes) || base + wobbliniPitchMemoryBytes(this.context) - old + bytes > this.memoryLimit) {
      throw new Error("Key Lock or pitch needs more audio memory. Use shorter files or fewer pitch-shifted decks.");
    }
    this.account.memory.set(lease, bytes);
  }
  _release(lease) {
    if (!lease) return;
    lease.released = true;
    // OfflineAudioContext rendering cannot be cancelled. Keep its reservation
    // until it actually settles, even after disposal or a preparation timeout.
    if (!lease.rendering) this.account.memory.delete(lease);
    if (this.lease === lease) this.lease = null;
  }
  _clearNode() {
    close(this.node); this.node = null; disconnect(this.gain); this.gain = null;
    if (this.slot) this.account.slots.delete(this.slot);
    this.slot = null; this.buffer = null; this.latency = 0; this._release(this.lease);
  }
  _fail(error) {
    this._clearNode();
    try { this.onError(error); } catch { /* An observer cannot retain a failed voice. */ }
  }

  isReady(buffer) { return !this.disposed && Boolean(this.node) && Boolean(buffer) && this.buffer === buffer; }

  prepare(buffer) {
    if (this.disposed) return Promise.resolve(false);
    if (this.requestedBuffer === buffer && this.pending) return this.pending;
    if (this.isReady(buffer) && !this.pending) return Promise.resolve(true);
    this.requestedBuffer = buffer;
    const revision = ++this.revision;
    const previous = this.pending;
    const pending = (async () => {
      await previous?.catch(() => {});
      if (!this._valid(revision)) return false;
      try { return await this._prepare(buffer, revision); }
      catch (error) { if (this._valid(revision)) { this._clearNode(); throw error; } return false; }
      finally { if (this.pending === pending) this.pending = null; }
    })();
    this.pending = pending; return pending;
  }

  async _prepare(buffer, revision) {
    if (!buffer || !Number.isInteger(buffer.length) || buffer.length <= 0 ||
        !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 ||
        !Number.isFinite(buffer.duration) || buffer.duration <= 0 ||
        ![1, 2].includes(buffer.numberOfChannels) || !(buffer.copyFromChannel || buffer.getChannelData)) {
      throw new Error("Pitch playback needs valid mono or stereo PCM.");
    }
    if (!this.context.audioWorklet) throw new Error("Key Lock and pitch need AudioWorklet on HTTPS or localhost.");
    if (this.node) {
      await this.stop(this.context.currentTime, true);
      await this._bounded(this.node.dropBuffers(), "Replacing pitch audio");
      this.buffer = null; this._release(this.lease);
      if (!this._valid(revision)) return false;
    }
    const channels = buffer.numberOfChannels, resample = buffer.sampleRate !== this.context.sampleRate;
    const length = resample ? Math.ceil(buffer.duration * this.context.sampleRate) : buffer.length;
    const bytes = length * channels * Float32Array.BYTES_PER_ELEMENT;
    const lease = { rendering: false, released: false }; this.lease = lease;
    this._reserve(lease, bytes * (resample ? 2 : 1));
    if (!this.node) {
      if (this.account.slots.size >= MAX_VOICES) throw new Error("All eight pitch voices are in use. Try again after a deck stops.");
      const slot = {}; this.account.slots.add(slot);
      let accepted = true;
      // A late factory result still occupies its slot until we can close it.
      const creation = Promise.resolve().then(() => this.stretchFactory(this.context, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit",
      })).then(node => {
        if (!accepted || !this._valid(revision)) { close(node); this.account.slots.delete(slot); return null; }
        return node;
      }, error => { this.account.slots.delete(slot); throw error; });
      let node;
      try { node = await this._bounded(creation, "Starting Key Lock"); }
      catch (error) { accepted = false; throw error; }
      if (!node) { this._release(lease); return false; }
      this.node = node; this.slot = slot;
      node.onprocessorerror = () => {
        if (this.node !== node || this.disposed) return;
        ++this.revision; this._fail(new Error("The pitch processor stopped. Playback can continue without Key Lock or pitch."));
      };
      await this._bounded(node.configure({ blockMs: 80, intervalMs: 20, splitComputation: true }), "Configuring Key Lock");
      if (!this._valid(revision)) { this._clearNode(); return false; }
      this.latency = clamp(await this._bounded(node.latency(), "Measuring pitch latency"), 0, 0.5, 0.1);
      if (!this._valid(revision)) { this._clearNode(); return false; }
      this.gain = this.context.createGain(); this.gain.gain.value = 0;
      node.connect(this.gain); this.gain.connect(this.output);
    }
    let matching = buffer;
    if (resample) {
      const offline = this.offlineFactory(channels, length, this.context.sampleRate);
      const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
      lease.rendering = true;
      const rendering = Promise.resolve().then(() => offline.startRendering()).finally(() => {
        lease.rendering = false; if (lease.released) this.account.memory.delete(lease);
      });
      matching = await this._bounded(rendering, "Resampling pitch audio");
    }
    if (!this._valid(revision)) { this._release(lease); return false; }
    const copies = Array.from({ length: channels }, (_, channel) => {
      const copy = new Float32Array(length);
      if (matching.copyFromChannel) matching.copyFromChannel(copy, channel, 0);
      else copy.set(matching.getChannelData(channel));
      return copy;
    });
    await this._bounded(this.node.addBuffers(copies, copies.map(copy => copy.buffer)), "Loading pitch audio");
    // A superseded upload still resides in the node until the next queued
    // preparation drops it. Retain its reservation throughout that interval.
    if (!this._valid(revision)) return false;
    this._reserve(lease, bytes); this.buffer = buffer; return true;
  }

  play(state) {
    if (!this.isReady(this.requestedBuffer)) return Promise.resolve(false);
    const node = this.node, when = Math.max(this.context.currentTime, finite(state.when, this.context.currentTime));
    const position = clamp(state.position, 0, this.buffer.duration, 0), rate = rateFor(state);
    if (position >= this.buffer.duration) return this.stop(when, true).then(() => false);
    const command = { active: true, output: when, input: position, rate,
      semitones: pitchOutputSemitones(state), loopStart: 0, loopEnd: 0 };
    const result = this._bounded(node.schedule(command), "Scheduling pitch playback");
    // Source files play once. AudioParam automation ends output on the audio
    // clock even when UI timers stall; Signalsmith zero-pads past its buffer.
    const end = when + (this.buffer.duration - position) / rate;
    hold(this.gain.gain, when);
    const onset = Math.min(when + FADE, end);
    this.gain.gain.linearRampToValueAtTime(1, onset);
    this.gain.gain.setValueAtTime(1, Math.max(onset, end - FADE));
    this.gain.gain.linearRampToValueAtTime(0, end);
    return result.then(() => this.node === node && !this.disposed, error => {
      if (this.node === node && !this.disposed) this._fail(error);
      return false;
    });
  }

  stop(when = this.context.currentTime, immediate = false) {
    const node = this.node; if (!node) return Promise.resolve(false);
    const time = Math.max(this.context.currentTime, finite(when, this.context.currentTime));
    if (this.gain) gainAt(this.gain.gain, 0, time, immediate);
    return this._bounded(node.schedule({ active: false, output: time }), "Stopping pitch playback").then(() => true, error => {
      if (this.node === node && !this.disposed) this._fail(error);
      return false;
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; ++this.revision;
    if (this.gain) gainAt(this.gain.gain, 0, this.context.currentTime, true);
    this.requestedBuffer = null; this._clearNode();
  }
}
