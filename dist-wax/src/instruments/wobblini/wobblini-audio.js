import { connectAudioOutput } from "../../audio-output-manager.js";
import { WOBBLINI_DECK_COUNT, WOBBLINI_DEMOS, WOBBLINI_LOOP_BEATS, createDeckState,
  sanitizeDeckPatch, sanitizeMasterPatch, crossfadeGains, deckPosition, beatLoop,
  createDemoSamples, waveformPeaks, wobbleAt, clamp } from "./wobblini-model.js";
import { scratchPosition, createScratchWindow, SCRATCH_MAX_SPEED, SCRATCH_HOLD_SECONDS } from "./wobblini-scratch-model.js";

const FADE = 0.008;
export const WOBBLINI_FILE_LIMIT = 64 * 1024 * 1024;
export const WOBBLINI_BUFFER_LIMIT = 192 * 1024 * 1024;
export const WOBBLINI_RESOURCE_LIMITS = Object.freeze({
  standard: Object.freeze({ fileBytes: WOBBLINI_FILE_LIMIT, deckBytes: WOBBLINI_FILE_LIMIT,
    bufferBytes: WOBBLINI_BUFFER_LIMIT, decodeSampleRate: 48000 }),
  constrained: Object.freeze({ fileBytes: 16 * 1024 * 1024, deckBytes: 16 * 1024 * 1024,
    bufferBytes: 64 * 1024 * 1024, decodeSampleRate: 32000 }),
});
const DURATION_ERROR = "Could not inspect this file's duration. Try a shorter WAV, MP3 or M4A clip.";

/** Metadata only: never plays media or creates an audible audio context. */
export function readWobbliniFileDuration(file, { signal, timeoutMs = 10000,
  document = globalThis.document, url = globalThis.URL } = {}) {
  return new Promise((resolve, reject) => {
    const cancelled = () => new DOMException("Audio file inspection cancelled.", "AbortError");
    if (signal?.aborted) { reject(cancelled()); return; }
    let audio, objectUrl, timer, settled = false;
    const finish = (error, duration) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (audio) {
        audio.removeEventListener("loadedmetadata", loaded);
        audio.removeEventListener("error", failed);
        audio.removeAttribute("src");
        try { audio.load(); } catch { /* Release a failed metadata reader. */ }
      }
      if (objectUrl) url.revokeObjectURL(objectUrl);
      if (error) reject(error); else resolve(duration);
    };
    const abort = () => finish(cancelled());
    const failed = () => finish(new Error(DURATION_ERROR));
    const loaded = () => {
      const duration = audio.duration;
      if (!Number.isFinite(duration) || duration <= 0) failed(); else finish(null, duration);
    };
    try {
      audio = document.createElement("audio"); audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", loaded);
      audio.addEventListener("error", failed);
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(failed, timeoutMs);
      objectUrl = url.createObjectURL(file); audio.src = objectUrl; audio.load();
    } catch { failed(); }
  });
}

const SAFETY_CURVE = Float32Array.from({ length: 4097 }, (_, index) => {
  const sample = index / 2048 - 1, level = Math.abs(sample);
  return Math.sign(sample) * (level <= 0.8 ? level : 0.8 + 0.17 * (1 - Math.exp(-(level - 0.8) / 0.17)));
});
const disconnect = node => { try { node?.disconnect(); } catch { /* Already released. */ } };
function smooth(param, value, time) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(time);
  else { param.cancelScheduledValues(time); param.setValueAtTime(param.value, time); }
  param.linearRampToValueAtTime(value, time + FADE);
}

/** Eight independent, bounded native buffer transports. Tempo changes pitch.
 * Audio is explicitly armed; silent transports use a monotonic clock, rebased
 * onto AudioContext.currentTime while armed. Rendering never schedules sound.
 */
export class WobbliniAudio {
  constructor({ resourceProfile = "standard", onChange = () => {}, onError = () => {}, now = () => performance.now() / 1000,
    contextFactory = () => {
      const Constructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Constructor) throw new Error("Wobblini needs a browser with Web Audio.");
      return new Constructor({ latencyHint: "interactive" });
    }, decodeContextFactory = sampleRate => {
      const Constructor = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
      if (!Constructor) throw new Error("This browser cannot decode local audio files.");
      return new Constructor(2, 1, sampleRate);
    }, metadataReader = readWobbliniFileDuration, outputConnector = connectAudioOutput,
    scratchFactory = async context => {
      if (!context.audioWorklet || !globalThis.AudioWorkletNode) return null;
      await context.audioWorklet.addModule(new URL("./wobblini-scratch-processor.js", import.meta.url));
      return new AudioWorkletNode(context, "morphazoid-wobblini-scratch", {
        numberOfInputs: 0, numberOfOutputs: 8, outputChannelCount: Array(8).fill(2),
      });
    },
  } = {}) {
    this.onChange = onChange; this.onError = onError; this.wallTime = now;
    this.resourceProfile = resourceProfile === "constrained" ? "constrained" : "standard";
    this.limits = WOBBLINI_RESOURCE_LIMITS[this.resourceProfile];
    this.contextFactory = contextFactory; this.decodeContextFactory = decodeContextFactory; this.metadataReader = metadataReader; this.outputConnector = outputConnector;
    this.context = null; this.graph = null; this.release = null; this.armed = false;
    this.requestedAudio = false; this.disposed = false; this.generation = 0; this.armPromise = null;
    this.decodeQueue = Promise.resolve(); this.wobbleClock = null;
    this.scratchFactory = scratchFactory; this.scratchNode = null; this.scratchPromise = null; this.scratchError = null;
    this.master = { gain: 0.65, crossfader: 0, wobbleAmount: 0, wobbleRate: 2 };
    this.decks = Array.from({ length: WOBBLINI_DECK_COUNT }, (_, id) => {
      const demo = createDemoSamples(id);
      return { state: { ...createDeckState(id), anchorTime: this.wallTime() },
        samples: demo.samples, sampleRate: demo.sampleRate, buffer: null,
        peaks: waveformPeaks([demo.samples]), graph: null, source: null, retiring: new Set(), generation: 0,
        scratch: null, scratchGeneration: 0, importAbort: null };
    });
    this.handleContextState = () => {
      if (!this.armed || this.disposed || this.context?.state === "running") return;
      this._switchClock(false); this.requestedAudio = false; ++this.generation;
      for (const deck of this.decks) this._stopSource(deck, true);
      this.scratchNode?.port.postMessage({ type: "clear" });
      this.release?.(); this.release = null;
      this._notify(); this._error(new Error("Audio was interrupted. Enable Audio to rejoin the mix."));
    };
  }

  _deck(index) {
    if (!Number.isInteger(index) || !this.decks[index]) throw new RangeError("Unknown Wobblini deck.");
    return this.decks[index];
  }
  _now() { return this.armed && this.context ? this.context.currentTime : this.wallTime(); }
  _notify() { try { this.onChange(); } catch { /* Observers do not own transport. */ } }
  _error(error) { try { this.onError(error); } catch { /* Observers do not own transport. */ } }
  _capture(deck, time = this._now()) {
    const state = deck.state;
    state.position = deckPosition(state, time);
    state.anchorTime = state.playing ? Math.max(state.anchorTime, time) : time;
    if (!state.scratching && !state.loopEnabled && state.position >= state.duration) state.playing = false;
    return state;
  }
  _switchClock(audio) {
    const previous = this._now(), next = audio ? this.context.currentTime : this.wallTime();
    for (const deck of this.decks) {
      this._capture(deck, previous); deck.state.anchorTime = next + Math.max(0, deck.state.anchorTime - previous);
      if (deck.scratch) deck.scratch.moveTime += next - previous;
    }
    this.armed = audio;
  }
  getDeckState(index) {
    const deck = this._deck(index), state = deck.state, position = deckPosition(state, this._now());
    const { anchorTime: _anchor, ...snapshot } = state;
    return { ...snapshot, eq: { ...state.eq }, position,
      playing: state.playing && (state.scratching || state.loopEnabled || position < state.duration),
      scratchVelocity: deck.scratch && this._now() - deck.scratch.moveTime <= SCRATCH_HOLD_SECONDS ? state.scratchVelocity : 0,
      effectiveBpm: state.bpm * state.rate, peaks: deck.peaks };
  }
  getState() { return { resourceProfile: this.resourceProfile, limits: { ...this.limits }, armed: this.armed, scratchReady: Boolean(this.scratchNode), master: { ...this.master }, decks: this.decks.map((_, id) => this.getDeckState(id)) }; }
  getWobbleState() {
    return this.wobbleClock && this.context ? wobbleAt(this.wobbleClock, this.context.currentTime)
      : { phase: 0, value: 0, frequency: this.master.wobbleRate };
  }

  _gain(value = 1) { const gain = this.context.createGain(); gain.gain.value = value; return gain; }
  _createGraph() {
    if (this.graph) return;
    const context = this.context, master = this._gain(this.master.gain * 0.38);
    const safety = context.createWaveShaper(); safety.curve = SAFETY_CURVE;
    const output = this._gain(0), lfo = context.createOscillator(); lfo.type = "sine";
    const splitter = context.createChannelSplitter(2), left = context.createAnalyser(), right = context.createAnalyser();
    left.fftSize = right.fftSize = 256;
    master.connect(safety).connect(output); output.connect(splitter);
    splitter.connect(left, 0); splitter.connect(right, 1);
    this.graph = { master, safety, output, lfo, splitter, left, right, meterSamples: new Float32Array(256) };
    for (const deck of this.decks) {
      const low = context.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 220;
      const mid = context.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1100; mid.Q.value = 0.7;
      const high = context.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = 4500;
      const highpass = context.createBiquadFilter(); highpass.type = "highpass"; highpass.Q.value = 0.6;
      const lowpass = context.createBiquadFilter(); lowpass.type = "lowpass"; lowpass.Q.value = 0.6;
      const wobble = context.createBiquadFilter(); wobble.type = "lowpass"; wobble.Q.value = 0.7;
      const wobbleDepth = this._gain(0), pan = context.createStereoPanner(), gain = this._gain();
      low.connect(mid).connect(high).connect(highpass).connect(lowpass).connect(wobble).connect(pan).connect(gain).connect(master);
      lfo.connect(wobbleDepth).connect(wobble.detune);
      deck.graph = { low, mid, high, highpass, lowpass, wobble, wobbleDepth, pan, gain };
      this._applyDeck(deck);
    }
    const startTime = context.currentTime;
    lfo.frequency.value = this.master.wobbleRate;
    this.wobbleClock = { time: startTime, phase: 0, frequency: this.master.wobbleRate,
      targetFrequency: this.master.wobbleRate, endTime: startTime };
    this._applyMaster(); lfo.start(startTime);
  }
  _applyDeck(deck) {
    if (!deck.graph) return;
    const { state, graph } = deck, time = this.context.currentTime;
    const gains = crossfadeGains(this.master.crossfader), anySolo = this.decks.some(item => item.state.solo);
    const audible = !state.mute && (!anySolo || state.solo);
    smooth(graph.gain.gain, audible ? state.gain * gains[state.assignment] : 0, time);
    smooth(graph.pan.pan, state.pan, time);
    for (const band of ["low", "mid", "high"]) smooth(graph[band].gain, state.eq[band], time);
    const ceiling = Math.min(20000, this.context.sampleRate * 0.45);
    smooth(graph.lowpass.frequency, state.filter < 0 ? ceiling * (180 / ceiling) ** -state.filter : ceiling, time);
    smooth(graph.highpass.frequency, state.filter > 0 ? 20 * 200 ** state.filter : 20, time);
  }
  _applyMaster() {
    if (!this.graph) return;
    const time = this.context.currentTime, { wobbleAmount, wobbleRate, gain } = this.master;
    smooth(this.graph.master.gain, gain * 0.38, time);
    if (this.wobbleClock.targetFrequency !== wobbleRate) {
      const current = this.getWobbleState();
      this.wobbleClock = { time, phase: current.phase, frequency: current.frequency,
        targetFrequency: wobbleRate, endTime: time + FADE };
      smooth(this.graph.lfo.frequency, wobbleRate, time);
    }
    for (const deck of this.decks) {
      smooth(deck.graph.wobble.frequency, Math.min(19000, this.context.sampleRate * 0.43) * 0.065 ** wobbleAmount, time);
      smooth(deck.graph.wobbleDepth.gain, wobbleAmount * 2400, time);
      this._applyDeck(deck);
    }
  }
  _buffer(deck) {
    if (!deck.buffer && deck.samples) {
      deck.buffer = this.context.createBuffer(1, deck.samples.length, deck.sampleRate);
      deck.buffer.getChannelData(0).set(deck.samples);
      deck.samples = null;
    }
    return deck.buffer;
  }
  _releaseSource(deck, record) {
    record.source.onended = null; disconnect(record.source); disconnect(record.gain);
    deck.retiring.delete(record); if (deck.source === record) deck.source = null;
  }
  _stopSource(deck, immediate = false) {
    const record = deck.source; if (!record) return;
    deck.source = null;
    const time = this.context.currentTime;
    if (immediate) { try { record.source.stop(time); } catch { /* Ended. */ } this._releaseSource(deck, record); return; }
    smooth(record.gain.gain, 0, time); deck.retiring.add(record);
    try { record.source.stop(time + FADE); } catch { this._releaseSource(deck, record); }
    // Fast pointer scrubs cannot accumulate unbounded overlapping sources.
    while (deck.retiring.size > 2) {
      const old = deck.retiring.values().next().value;
      try { old.source.stop(time); } catch { /* Ended. */ } this._releaseSource(deck, old);
    }
  }
  _render(deck, when = this._now()) {
    this._stopSource(deck);
    if (!this.armed || !deck.graph || this.disposed || deck.state.scratching) return;
    when = Math.max(when, deck.state.playing ? deck.state.anchorTime : when);
    const state = this._capture(deck, when), buffer = this._buffer(deck);
    if (!state.playing || !buffer) return;
    const time = Math.max(when, this.context.currentTime), source = this.context.createBufferSource(), gain = this._gain(0);
    source.buffer = buffer; source.playbackRate.value = state.rate;
    source.loop = state.loopEnabled; source.loopStart = state.loopStart; source.loopEnd = state.loopEnd;
    source.connect(gain).connect(deck.graph.low); smooth(gain.gain, 1, time);
    const record = { source, gain }; deck.source = record;
    source.onended = () => {
      const current = deck.source === record; this._releaseSource(deck, record);
      if (current && !this.disposed) { this._capture(deck); this._notify(); }
    };
    source.start(time, Math.min(state.position, Math.max(0, state.duration - 1 / buffer.sampleRate)));
  }

  arm() { return this.setAudioEnabled(true); }
  async _prepareScratch() {
    if (this.scratchNode) return;
    if (this.scratchPromise) return this.scratchPromise;
    const pending = (async () => {
      try {
        const node = await this.scratchFactory(this.context);
        if (this.disposed) { disconnect(node); node?.port.close?.(); return; }
        if (!node) return;
        this.scratchNode = node;
        node.port.onmessage = ({ data }) => {
          if (data?.type !== "window-request" || this.scratchNode !== node || !this.armed || this.disposed ||
              !Number.isInteger(data.index) || data.index < 0 || data.index >= 8 || !Number.isFinite(data.position)) return;
          const deck = this.decks[data.index];
          if (deck.scratch?.generation !== data.generation) return;
          this._sendScratchWindow(deck, data.position);
        };
        for (let index = 0; index < 8; index++) node.connect(this.decks[index].graph.low, index);
        node.onprocessorerror = () => {
          disconnect(node); node.port.close?.();
          if (this.scratchNode !== node || this.disposed) return;
          this.scratchNode = null; this.scratchError = new Error("The scratch engine stopped. Turn Audio off and on to retry.");
          for (let index = 0; index < 8; index++) this.endScratch(index);
          this._error(this.scratchError); this._notify();
        };
      } catch (error) { this.scratchError = error; }
    })();
    this.scratchPromise = pending;
    try { await pending; } finally { if (this.scratchPromise === pending) this.scratchPromise = null; }
  }
  async setAudioEnabled(enabled) {
    if (this.disposed) return false;
    if (enabled && this.requestedAudio) return this.armPromise ?? this.armed;
    this.requestedAudio = Boolean(enabled); const attempt = ++this.generation;
    if (!enabled) {
      this._switchClock(false);
      if (this.graph) smooth(this.graph.output.gain, 0, this.context.currentTime);
      for (const deck of this.decks) this._stopSource(deck);
      this.scratchNode?.port.postMessage({ type: "release" });
      this._notify();
      if (this.context) await new Promise(resolve => setTimeout(resolve, FADE * 1000 + 4));
      if (attempt !== this.generation || this.disposed) return false;
      this.release?.(); this.release = null;
      this.scratchNode?.port.postMessage({ type: "clear" });
      try { if (this.context?.state === "running") await this.context.suspend(); } catch { /* Already interrupted. */ }
      return false;
    }
    const start = async () => {
      try {
        if (!this.context) {
          this.context = this.contextFactory();
          this.context.addEventListener?.("statechange", this.handleContextState);
        }
        const context = this.context;
        // Resume directly from the explicit Audio action, before preparation.
        await context.resume();
        if (attempt !== this.generation || this.disposed) {
          if (!this.requestedAudio && context.state === "running") await context.suspend();
          return false;
        }
        this._createGraph(); await this._prepareScratch();
        if (attempt !== this.generation || this.disposed) {
          if (!this.requestedAudio && context.state === "running") await context.suspend();
          return false;
        }
        if (context.state !== "running") throw new Error("Audio is unavailable. Enable Audio again after returning to the browser.");
        this._switchClock(true);
        this.release ??= this.outputConnector(context, this.graph.output);
        for (const deck of this.decks) { this._render(deck); if (deck.scratch) this._startScratchAudio(deck); }
        smooth(this.graph.output.gain, 1, context.currentTime); this._notify(); return true;
      } catch (error) {
        if (attempt !== this.generation || this.disposed) return false;
        this._switchClock(false); this.requestedAudio = false;
        this.release?.(); this.release = null;
        for (const deck of this.decks) this._stopSource(deck, true);
        try { await this.context?.suspend(); } catch { /* Startup failed. */ }
        this._notify(); this._error(error); throw error;
      }
    };
    const pending = start(); this.armPromise = pending;
    try { return await pending; } finally { if (this.armPromise === pending) this.armPromise = null; }
  }

  play(index) {
    if (this.disposed) return false;
    const deck = this._deck(index), state = this._capture(deck);
    if (state.playing) return true;
    if (state.position >= state.duration) state.position = state.loopEnabled ? state.loopStart : 0;
    state.playing = true; state.anchorTime = this._now(); this._render(deck); this._notify(); return true;
  }
  playAll() {
    if (this.disposed) return false;
    // Prepare first, then choose one launch boundary. Neither DOM observer work
    // nor eight separate buffer copies can stagger the eight source starts.
    if (this.armed) for (const deck of this.decks) this._buffer(deck);
    const now = this._now(), when = now + (this.armed ? 0.016 : 0);
    for (const deck of this.decks) {
      const state = this._capture(deck, now);
      if (state.playing) continue;
      if (state.position >= state.duration) state.position = state.loopEnabled ? state.loopStart : 0;
      state.playing = true; state.anchorTime = when; this._render(deck, when);
    }
    this._notify(); return true;
  }
  pauseAll() {
    if (this.disposed) return;
    const now = this._now();
    for (const deck of this.decks) { this._capture(deck, now).playing = false; this._stopSource(deck); }
    this._notify();
  }
  pause(index) {
    if (this.disposed) return;
    const deck = this._deck(index); this._capture(deck).playing = false; this._stopSource(deck); this._notify();
  }
  toggle(index) { if (this.getDeckState(index).playing) this.pause(index); else this.play(index); }
  _sendScratchWindow(deck, position, begin = false) {
    if (!this.armed || !this.scratchNode || !deck.scratch) return;
    const buffer = this._buffer(deck), state = deck.state;
    const window = createScratchWindow(buffer, state, position);
    const message = { type: begin ? "begin" : "window", index: state.id, generation: deck.scratch.generation, window };
    if (begin) Object.assign(message, { sampleRate: buffer.sampleRate, duration: state.duration,
      position: deck.scratch.handPosition, loopEnabled: state.loopEnabled, loopStart: state.loopStart, loopEnd: state.loopEnd });
    this.scratchNode.port.postMessage(message, window.chunks.flatMap(chunk => chunk.channels.map(channel => channel.buffer)));
  }
  _startScratchAudio(deck) {
    if (deck.scratch) this._sendScratchWindow(deck, deck.scratch.handPosition, true);
  }
  beginScratch(index) {
    if (this.disposed) return false;
    const deck = this._deck(index);
    if (deck.scratch) return false;
    if (this.armed && !this.scratchNode) {
      this._error(new Error(this.scratchError?.message || "Vinyl scratching needs AudioWorklet support on HTTPS or localhost.")); return false;
    }
    const state = this._capture(deck);
    deck.scratch = { generation: ++deck.scratchGeneration, handPosition: state.position, moveTime: this._now() };
    state.scratching = true; state.scratchVelocity = 0;
    this._stopSource(deck); this._startScratchAudio(deck); this._notify(); return true;
  }
  scratchTo(index, seconds) {
    if (this.disposed || !Number.isFinite(seconds)) return;
    const deck = this._deck(index), scratch = deck.scratch;
    if (!scratch) return;
    const state = deck.state, time = this._now();
    const target = state.loopEnabled ? seconds : clamp(seconds, 0, state.duration);
    state.scratchVelocity = clamp((target - scratch.handPosition) / Math.max(0.004, time - scratch.moveTime), -SCRATCH_MAX_SPEED, SCRATCH_MAX_SPEED);
    scratch.handPosition = target; scratch.moveTime = time;
    state.position = scratchPosition(target, state); state.anchorTime = time;
    if (this.armed) this.scratchNode?.port.postMessage({ type: "move", index, generation: scratch.generation, position: target });
    this._notify();
  }
  _cancelScratch(deck) {
    if (!deck.scratch) return;
    this.scratchNode?.port.postMessage({ type: "end", index: deck.state.id, generation: deck.scratch.generation });
    deck.scratch = null; deck.state.scratching = false; deck.state.scratchVelocity = 0; deck.state.anchorTime = this._now();
  }
  endScratch(index) {
    if (this.disposed) return;
    const deck = this._deck(index); if (!deck.scratch) return;
    this._cancelScratch(deck); this._render(deck); this._notify();
  }
  seek(index, seconds) {
    if (this.disposed) return;
    const deck = this._deck(index); this._cancelScratch(deck); const state = this._capture(deck);
    state.position = clamp(seconds, 0, state.duration, state.position); state.anchorTime = this._now();
    if (state.loopEnabled && (state.position < state.loopStart || state.position >= state.loopEnd)) state.loopEnabled = false;
    this._render(deck); this._notify();
  }
  setCue(index, seconds = this.getDeckState(index).position) {
    if (this.disposed) return;
    const deck = this._deck(index); deck.state.cuePoint = clamp(seconds, 0, deck.state.duration, deck.state.cuePoint); this._notify();
  }
  cue(index) { if (this.disposed) return; this.pause(index); this.seek(index, this._deck(index).state.cuePoint); }
  setLoop(index, beats) {
    if (this.disposed) return;
    const deck = this._deck(index); this._cancelScratch(deck); const state = this._capture(deck);
    if (beats === null || beats === 0 || beats === false) state.loopEnabled = false;
    else {
      if (!WOBBLINI_LOOP_BEATS.includes(Number(beats))) throw new RangeError("Choose a loop between half a beat and 32 beats.");
      state.loopBeats = Number(beats); state.loopEnabled = true;
      Object.assign(state, beatLoop(state.position, state.loopBeats, state.bpm, state.duration));
      if (state.position >= state.loopEnd) state.position = state.loopStart;
    }
    this._render(deck); this._notify();
  }
  setDeck(index, patch) {
    if (this.disposed) return;
    const deck = this._deck(index), state = this._capture(deck), changes = sanitizeDeckPatch(patch, state);
    Object.assign(state, changes);
    if (Object.hasOwn(changes, "bpm") && state.loopEnabled) {
      this._cancelScratch(deck);
      Object.assign(state, beatLoop(state.position, state.loopBeats, state.bpm, state.duration)); this._render(deck);
    } else if (Object.hasOwn(changes, "rate") && deck.source) {
      // A step in playback rate preserves source phase and matches the model exactly.
      deck.source.source.playbackRate.setValueAtTime(state.rate, this.context.currentTime);
    }
    for (const item of this.decks) this._applyDeck(item);
    this._notify();
  }
  setMaster(patch) {
    if (this.disposed) return;
    Object.assign(this.master, sanitizeMasterPatch(patch, this.master)); this._applyMaster(); this._notify();
  }

  _replace(deck, { buffer = null, samples = null, sampleRate, name, kind, bpm, duration, peaks }) {
    this._cancelScratch(deck);
    const state = this._capture(deck), wasPlaying = state.playing;
    this._stopSource(deck); deck.buffer = buffer; deck.samples = samples; deck.sampleRate = sampleRate; deck.peaks = peaks;
    Object.assign(state, { name, kind, bpm, duration, position: 0, anchorTime: this._now(), cuePoint: 0,
      playing: wasPlaying, loopBeats: 16, loopEnabled: kind === "demo", loopStart: 0, loopEnd: duration, loading: false });
    this._render(deck); this._notify();
  }
  loadDemo(index) {
    if (this.disposed) return false;
    const deck = this._deck(index); ++deck.generation;
    deck.importAbort?.abort(); deck.importAbort = null;
    const data = createDemoSamples(index), demo = WOBBLINI_DEMOS[index];
    this._replace(deck, { ...data, name: demo.name, kind: "demo", peaks: waveformPeaks([data.samples]) }); return true;
  }
  _otherBufferBytes(deck) {
    return this.decks.reduce((total, item) => total + (item === deck ? 0 : item.buffer
      ? item.buffer.length * item.buffer.numberOfChannels * 4 : item.samples?.byteLength ?? 0), 0);
  }
  _decodeFile(file, valid, deck, signal) {
    // One decode at a time bounds temporary memory; stale queued requests never
    // read their files. Native decode itself cannot be cancelled once started.
    const pending = this.decodeQueue.then(async () => {
      if (!valid()) return null;
      if (this.resourceProfile === "constrained") {
        const duration = await this.metadataReader(file, { signal });
        if (!valid()) return null;
        if (!Number.isFinite(duration) || duration <= 0) throw new Error(DURATION_ERROR);
        // Mono is the least PCM a supported file can require. Do not reject a
        // valid longer mono clip using a stereo estimate; actual bytes/channels
        // are still checked after decode. This is not a native peak-memory cap.
        const available = Math.max(0, Math.min(this.limits.deckBytes, this.limits.bufferBytes - this._otherBufferBytes(deck)));
        const maxSeconds = Math.min(600, available / (this.limits.decodeSampleRate * 4));
        if (duration > maxSeconds) throw new Error(`This file is too long for the current import budget. Choose a clip under ${Math.floor(maxSeconds)} seconds or free another deck; stereo clips may need to be shorter.`);
      }
      const data = await file.arrayBuffer();
      if (!valid()) return null;
      const decoder = this.decodeContextFactory(this.limits.decodeSampleRate);
      return decoder.decodeAudioData(data);
    });
    // Retain only queue completion, never the last decoded AudioBuffer.
    this.decodeQueue = pending.then(() => {}, () => {}); return pending;
  }
  async loadFile(index, file) {
    if (this.disposed) return false;
    const deck = this._deck(index), attempt = ++deck.generation;
    deck.importAbort?.abort(); deck.importAbort = null;
    if (!file?.arrayBuffer || !Number.isFinite(file.size) || file.size <= 0 || file.size > this.limits.fileBytes) {
      deck.state.loading = false; this._notify();
      throw new Error(`Choose an audio file smaller than ${this.limits.fileBytes / 1024 / 1024} MB.`);
    }
    const inspection = this.resourceProfile === "constrained" ? new AbortController() : null;
    deck.importAbort = inspection;
    deck.state.loading = true; this._notify();
    try {
      // Offline decoding never creates/resumes the audible context.
      const buffer = await this._decodeFile(file, () => !this.disposed && attempt === deck.generation, deck, inspection?.signal);
      if (this.disposed || attempt !== deck.generation) return false;
      const bytes = buffer.length * buffer.numberOfChannels * 4;
      const otherBytes = this._otherBufferBytes(deck);
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 600 ||
          !Number.isFinite(bytes) || bytes > this.limits.deckBytes || otherBytes + bytes > this.limits.bufferBytes ||
          buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2) {
        throw new Error(`Use mono/stereo audio under 10 minutes and ${this.limits.deckBytes / 1024 / 1024} MB decoded; the eight-deck buffer limit is ${this.limits.bufferBytes / 1024 / 1024} MB.`);
      }
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
      // Malformed floating-point WAV files must not inject non-finite DSP input.
      for (const channel of channels) for (let sample = 0; sample < channel.length; sample++) {
        if (!Number.isFinite(channel[sample])) channel[sample] = 0;
      }
      this._replace(deck, { buffer, sampleRate: buffer.sampleRate, name: String(file.name || "Local track").slice(0, 180),
        kind: "file", duration: buffer.duration, bpm: 120, peaks: waveformPeaks(channels) });
      return true;
    } catch (error) {
      if (this.disposed || attempt !== deck.generation) return false;
      throw new Error(error?.message || "This browser could not decode that audio file.");
    } finally {
      if (deck.importAbort === inspection) deck.importAbort = null;
      if (!this.disposed && attempt === deck.generation) { deck.state.loading = false; this._notify(); }
    }
  }
  getMeter() {
    if (!this.armed || !this.graph) return { left: 0, right: 0, peak: 0 };
    const samples = this.graph.meterSamples, read = analyser => {
      analyser.getFloatTimeDomainData(samples); let sum = 0, peak = 0;
      for (const value of samples) if (Number.isFinite(value)) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
      return { rms: Math.sqrt(sum / samples.length), peak };
    };
    const left = read(this.graph.left), right = read(this.graph.right);
    return { left: left.rms, right: right.rms, peak: Math.max(left.peak, right.peak) };
  }
  async dispose() {
    if (this.disposed) return;
    this._switchClock(false); this.disposed = true; this.requestedAudio = false; ++this.generation;
    for (const deck of this.decks) {
      this._cancelScratch(deck);
      ++deck.generation; deck.state.playing = false; deck.state.loading = false;
      deck.importAbort?.abort(); deck.importAbort = null;
      this._stopSource(deck, true);
      for (const record of [...deck.retiring]) { try { record.source.stop(); } catch { /* Ended. */ } this._releaseSource(deck, record); }
      for (const node of Object.values(deck.graph ?? {})) disconnect(node);
      deck.buffer = deck.samples = deck.graph = null;
    }
    this.scratchNode?.port.postMessage({ type: "dispose" });
    disconnect(this.scratchNode); this.scratchNode?.port.close?.(); this.scratchNode = null;
    try { this.graph?.lfo.stop(); } catch { /* Already stopped. */ }
    for (const node of Object.values(this.graph ?? {})) if (node?.disconnect) disconnect(node);
    this.release?.(); this.release = null;
    this.context?.removeEventListener?.("statechange", this.handleContextState);
    try { await this.context?.close(); } catch { /* Already closed. */ }
    this.graph = null; this.context = null;
  }
}
