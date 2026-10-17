import { connectAudioOutput } from "../../audio-output-manager.js";
import { WOBBLINI_DECK_COUNT, WOBBLINI_DEMOS, createDeckState,
  sanitizeDeckPatch, sanitizeMasterPatch, crossfadeGains, deckPosition,
  createDemoSamples, waveformPeaks, wobbleAt, beatPhase, syncRate, syncPosition, syncLoopPeriod, clamp, tempoBounds } from "./wobblini-model.js";
import { scratchPosition, createScratchWindow, SCRATCH_MAX_SPEED, SCRATCH_HOLD_SECONDS } from "./wobblini-scratch-model.js";
import { createBeatAnalyzer } from "../trackazoid/beat-analysis-client.js";
import { analyzeTrackLevel } from "./wobblini-level-analysis.js";
import { createWobbliniPitch, needsPitchProcessing, wobbliniPitchMemoryBytes } from "./wobblini-pitch.js";

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

/** Eight bounded transports with lazy pitch-preserving buffer playback.
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
    }, metadataReader = readWobbliniFileDuration, outputConnector = connectAudioOutput, analyzerFactory = createBeatAnalyzer,
    pitchFactory = createWobbliniPitch,
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
    this.decodeQueue = Promise.resolve(); this.wobbleClock = null; this.syncEnabled = false; this.masterDeck = 0;
    this.analysisQueue = Promise.resolve(); this.analyzerFactory = analyzerFactory;
    this.pitchFactory = pitchFactory;
    this.scratchFactory = scratchFactory; this.scratchNode = null; this.scratchPromise = null; this.scratchError = null;
    this.master = { gain: 0.65, crossfader: 0, wobbleAmount: 0, wobbleRate: 2, syncMode: "beat", syncInterval: 1 };
    this.decks = Array.from({ length: WOBBLINI_DECK_COUNT }, (_, id) => {
      const demo = createDemoSamples(id);
      return { state: { ...createDeckState(id), autoGainDb: analyzeTrackLevel([demo.samples]).gainDb, anchorTime: this.wallTime() },
        samples: demo.samples, sampleRate: demo.sampleRate, buffer: null,
        peaks: waveformPeaks([demo.samples]), loopPeakCache: null, graph: null, source: null, retiring: new Set(), generation: 0,
        scratch: null, scratchGeneration: 0, importAbort: null, syncRequested: false, syncAligned: false,
        cuePreview: null, slip: null, analyzer: null, analysisRevision: 0, gridRevision: 0,
        pitch: null, pitchPromise: null, pitchEndTimer: null };
    });
    this.handleContextState = () => {
      if (!this.armed || this.disposed || this.context?.state === "running") return;
      this._switchClock(false); this.requestedAudio = false; ++this.generation;
      for (const deck of this.decks) { this._stopSource(deck, true); this._dropPitch(deck); }
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
      if (deck.slip) { deck.slip.position = deckPosition(deck.slip, previous); deck.slip.anchorTime = next; }
    }
    this.armed = audio;
  }
  _loopPeaks(deck) {
    const { state, peaks } = deck;
    if (state.loopStart === 0 && state.loopEnd === state.duration) return peaks;
    const cache = deck.loopPeakCache;
    if (cache?.source === peaks && cache.start === state.loopStart && cache.end === state.loopEnd) return cache.peaks;
    const length = deck.buffer?.length ?? deck.samples?.length ?? 0;
    const first = Math.min(length, Math.floor(state.loopStart * deck.sampleRate));
    const last = Math.min(length, Math.ceil(state.loopEnd * deck.sampleRate));
    let selected;
    if (deck.buffer?.copyFromChannel) {
      selected = new Float32Array(256);
      // Native source playback can acquire an AudioBuffer's channel contents.
      // Read one display bin at a time instead of materializing the full file
      // with getChannelData, or allocating another copy of the entire loop.
      const frames = last - first, scratch = new Float32Array(Math.ceil(frames / selected.length) + 1);
      for (let channel = 0; channel < deck.buffer.numberOfChannels; channel++) {
        for (let bin = 0; bin < selected.length; bin++) {
          const from = first + Math.floor(bin * frames / selected.length);
          const to = first + Math.ceil((bin + 1) * frames / selected.length);
          if (to <= from) continue;
          const samples = scratch.subarray(0, to - from);
          deck.buffer.copyFromChannel(samples, channel, from);
          for (const value of samples) if (Number.isFinite(value)) {
            selected[bin] = Math.max(selected[bin], Math.min(1, Math.abs(value)));
          }
        }
      }
    } else {
      const channels = deck.buffer ? Array.from({ length: deck.buffer.numberOfChannels },
        (_, index) => deck.buffer.getChannelData(index).subarray(first, last))
        : deck.samples ? [deck.samples.subarray(first, last)] : [];
      selected = waveformPeaks(channels);
    }
    // Cache only the bounded display bins, never a view retaining old decoded PCM.
    deck.loopPeakCache = { source: peaks, start: state.loopStart, end: state.loopEnd, peaks: selected };
    return selected;
  }
  getDeckState(index, now = this._now()) {
    const deck = this._deck(index), state = deck.state, position = deckPosition(state, now);
    const master = this.decks[this.masterDeck].state, masterPosition = deckPosition(master, now);
    const playing = state.playing && (state.scratching || state.loopEnabled || position < state.duration);
    const masterPlaying = master.playing && !master.scratching && !this.decks[this.masterDeck].cuePreview && (master.loopEnabled || masterPosition < master.duration);
    const period = this.master.syncInterval;
    const { anchorTime: _anchor, ...snapshot } = state;
    return { ...snapshot, eq: { ...state.eq }, position, playing, cuePreviewing: Boolean(deck.cuePreview),
      slipPosition: deck.slip ? deckPosition(deck.slip, now) : null,
      scratchVelocity: deck.scratch && now - deck.scratch.moveTime <= SCRATCH_HOLD_SECONDS ? state.scratchVelocity : 0,
      effectiveBpm: state.bpm * state.rate, peaks: deck.peaks, loopPeaks: this._loopPeaks(deck), isMaster: index === this.masterDeck,
      syncEnabled: deck.syncRequested, syncError: deck.syncRequested ? state.syncError : null,
      syncBeatPeriod: period, beatPhase: beatPhase(position, state, period),
      syncActive: deck.syncRequested && deck.syncAligned && !state.syncError && playing && !state.scratching && !deck.cuePreview && (this.master.syncMode === "tempo" || masterPlaying) &&
        state.anchorTime <= now && master.anchorTime <= now };
  }
  getState() { const now = this._now(); return { resourceProfile: this.resourceProfile, limits: { ...this.limits }, armed: this.armed,
    scratchReady: Boolean(this.scratchNode), master: { ...this.master }, syncEnabled: this.syncEnabled,
    syncAllEnabled: this.decks.filter(deck => deck.state.id !== this.masterDeck).every(deck => deck.syncRequested),
    masterDeck: this.masterDeck, syncBpm: this.decks[this.masterDeck].state.bpm * this.decks[this.masterDeck].state.rate,
    decks: this.decks.map((_, id) => this.getDeckState(id, now)) }; }
  /** Elect a reference without restarting either the old or new master.
   * Membership belongs to each follower; the former master stays independent. */
  setMasterDeck(index) {
    if (this.disposed) return false;
    const deck = this._deck(index);
    if (index === this.masterDeck) return index;
    this.masterDeck = index;
    this._setSyncMembership(deck, false);
    this._syncFollowers(); this._notify(); return index;
  }
  /** The master BPM control edits playback speed, not the source's beat grid. */
  setMasterBpm(bpm) {
    if (this.disposed) return false;
    const state = this.decks[this.masterDeck].state;
    this.setDeck(this.masterDeck, { rate: clamp(Number(bpm) / state.bpm, ...tempoBounds(state.tempoRange), state.rate) });
    return state.bpm * state.rate;
  }
  setSyncEnabled(enabled) {
    if (this.disposed) return false;
    this.syncEnabled = Boolean(enabled);
    for (const deck of this.decks.filter(deck => deck.state.id !== this.masterDeck)) {
      deck.syncRequested = this.syncEnabled; deck.syncAligned = false; deck.state.syncError = null;
    }
    if (this.syncEnabled) this._syncFollowers();
    this._notify(); return this.syncEnabled;
  }
  _setSyncMembership(deck, enabled) {
    deck.syncRequested = Boolean(enabled); deck.syncAligned = false; deck.state.syncError = null;
    this.syncEnabled = this.decks.some(item => item.syncRequested);
  }
  setDeckSyncEnabled(index, enabled) {
    if (this.disposed) return false;
    const deck = this._deck(index); if (index === this.masterDeck) return false;
    this._setSyncMembership(deck, enabled);
    if (deck.syncRequested) this._syncFollowers(index);
    this._notify(); return deck.syncRequested;
  }
  _syncBoundary(now = this._now()) {
    if (!this.armed) return now;
    // Repeated edits before a pending launch reuse its existing boundary.
    const pending = this.decks.filter(deck => deck.state.playing && deck.state.anchorTime > now).map(deck => deck.state.anchorTime);
    const latency = Math.max(0, ...this.decks.filter(deck => deck.state.playing && needsPitchProcessing(deck.state))
      .map(deck => deck.pitch?.latency ?? 0));
    return Math.max(pending.length ? Math.min(...pending) : now + 0.016, now + latency + (latency ? FADE : 0));
  }
  _syncFollowers(index = null, boundary = null) {
    const rendered = new Set(); if (!this.syncEnabled) return rendered;
    const followers = (index === null ? this.decks.filter(deck => deck.state.id !== this.masterDeck) : [this._deck(index)]).filter(deck => deck.syncRequested);
    if (!followers.length) return rendered;
    if (this.armed) for (const deck of followers) if (deck.state.playing && !deck.state.scratching) this._buffer(deck);
    const now = this._now(), when = Math.max(now, boundary ?? this._syncBoundary(now));
    const master = this.decks[this.masterDeck].state, reference = deckPosition(master, when);
    const masterPlaying = master.playing && !master.scratching && !this.decks[this.masterDeck].cuePreview && (master.loopEnabled || reference < master.duration);
    for (const deck of followers) {
      const state = this._capture(deck, now), rate = syncRate(state, master);
      if (deck.cuePreview) continue;
      deck.syncAligned = false;
      state.syncError = rate === null ? `Sync needs a speed outside 0.25×–1.75×. Adjust deck ${this.masterDeck + 1} tempo or this source BPM.` : null;
      if (state.syncError) continue;
      if (deck.slip) { deck.slip.position = deckPosition(deck.slip, now); deck.slip.anchorTime = now; deck.slip.rate = rate; }
      state.rate = rate;
      if (deck.source) deck.source.source.playbackRate.setValueAtTime(rate, now);
      if (this.master.syncMode === "tempo") { deck.syncAligned = true; this._render(deck); rendered.add(state.id); continue; }
      if (!state.playing || state.scratching || !masterPlaying) {
        if (!state.scratching && deck.pitch?.isReady(deck.buffer)) this._refreshPlayback(deck);
        continue;
      }
      const period = this.master.syncInterval;
      // Repeating an arbitrary-length conversation must not trim or skip words
      // to fit a beat grid. Match tempo, but do not claim phase lock when either
      // complete file changes beat phase at its wrap.
      if (syncLoopPeriod(master, this.decks[this.masterDeck].sampleRate, period) !== period ||
          syncLoopPeriod(state, deck.sampleRate, period) !== period) {
        state.syncError = "Tempo matched; these full-file lengths cannot keep beat alignment when repeating. Choose Tempo only.";
        this._render(deck); rendered.add(state.id); continue;
      }
      const target = syncPosition(deckPosition(state, when), state, beatPhase(reference, master, period), period);
      if (target === null) { state.syncError = "This source has no matching beat phase at this interval. Choose one-beat Sync or adjust beat zero."; continue; }
      state.position = target; state.anchorTime = when; this._render(deck, when); deck.syncAligned = true; rendered.add(state.id);
    }
    return rendered;
  }
  _renderTransport(deck) {
    if (!this.syncEnabled) { this._render(deck); return; }
    if (deck.state.id === this.masterDeck) { this._render(deck); this._syncFollowers(); }
    else if (!this._syncFollowers(deck.state.id).has(deck.state.id)) this._render(deck);
  }
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
      const input = this._gain(1);
      const low = context.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 220;
      const mid = context.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1100; mid.Q.value = 0.7;
      const high = context.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = 4500;
      const highpass = context.createBiquadFilter(); highpass.type = "highpass"; highpass.Q.value = 0.6;
      const lowpass = context.createBiquadFilter(); lowpass.type = "lowpass"; lowpass.Q.value = 0.6;
      const wobble = context.createBiquadFilter(); wobble.type = "lowpass"; wobble.Q.value = 0.7;
      const wobbleDepth = this._gain(0), pan = context.createStereoPanner(), gain = this._gain();
      input.connect(low).connect(mid).connect(high).connect(highpass).connect(lowpass).connect(wobble).connect(pan).connect(gain).connect(master);
      lfo.connect(wobbleDepth).connect(wobble.detune);
      deck.graph = { input, low, mid, high, highpass, lowpass, wobble, wobbleDepth, pan, gain };
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
    smooth(graph.input.gain, 10 ** ((state.trimDb + (state.autoGain ? state.autoGainDb : 0)) / 20), time);
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
  _stopSource(deck, immediate = false, when = this.context?.currentTime) {
    clearTimeout(deck.pitchEndTimer); deck.pitchEndTimer = null;
    if (deck.pitch) void deck.pitch.stop(when, immediate);
    const record = deck.source; if (!record) return;
    deck.source = null;
    const time = Math.max(this.context.currentTime, when ?? this.context.currentTime);
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
    when = Math.max(when, deck.state.playing ? deck.state.anchorTime : when);
    if (this.armed && deck.state.playing && !deck.state.scratching && needsPitchProcessing(deck.state) && deck.pitch?.isReady(deck.buffer)) {
      when = Math.max(when, this.context.currentTime + deck.pitch.latency + FADE);
    }
    this._stopSource(deck, false, this.armed ? when : undefined);
    if (!this.armed || !deck.graph || this.disposed || deck.state.scratching) return;
    const state = this._capture(deck, when), buffer = this._buffer(deck);
    if (!state.playing || !buffer) { if (deck.pitch) this._dropPitch(deck); return; }
    if (needsPitchProcessing(state)) {
      if (deck.pitch?.isReady(buffer)) {
        void deck.pitch.play({ ...state, when, position: state.position });
        this._schedulePitchEnd(deck);
        return;
      }
      this._preparePitch(deck);
    } else if (deck.pitch) this._dropPitch(deck);
    const time = Math.max(when, this.context.currentTime), source = this.context.createBufferSource(), gain = this._gain(0);
    source.buffer = buffer; source.playbackRate.value = state.rate;
    source.loop = state.loopEnabled; source.loopStart = state.loopStart; source.loopEnd = state.loopEnd;
    source.connect(gain).connect(deck.graph.input); smooth(gain.gain, 1, time);
    const record = { source, gain }; deck.source = record;
    source.onended = () => {
      const current = deck.source === record; this._releaseSource(deck, record);
      if (current && !this.disposed) { this._capture(deck); this._notify(); }
    };
    source.start(time, Math.min(state.position, Math.max(0, state.duration - 1 / buffer.sampleRate)));
  }
  _dropPitch(deck) {
    clearTimeout(deck.pitchEndTimer); deck.pitchEndTimer = null;
    deck.pitch?.dispose(); deck.pitch = null; deck.pitchPromise = null;
    deck.state.pitchStatus = "idle"; deck.state.pitchError = null;
  }
  _schedulePitchEnd(deck) {
    clearTimeout(deck.pitchEndTimer); deck.pitchEndTimer = null;
    if (!deck.pitch || !this.armed || !deck.state.playing || deck.state.loopEnabled) return;
    const now = this._now(), remaining = Math.max(0, deck.state.anchorTime - now) +
      Math.max(0, deck.state.duration - deckPosition(deck.state, now)) / deck.state.rate;
    deck.pitchEndTimer = setTimeout(() => {
      deck.pitchEndTimer = null;
      if (this.disposed || !this.armed || !deck.pitch) return;
      if (deckPosition(deck.state, this._now()) < deck.state.duration) { this._schedulePitchEnd(deck); return; }
      this._capture(deck); this._dropPitch(deck); this._notify();
    }, Math.max(16, remaining * 1000 + 16));
    deck.pitchEndTimer.unref?.();
  }
  _pitchFailed(deck, helper, error) {
    if (this.disposed || deck.pitch !== helper) return;
    this._capture(deck); this._dropPitch(deck);
    Object.assign(deck.state, { keyLock: false, pitchSemitones: 0, pitchStatus: "error", pitchError: error?.message || "Pitch processing unavailable." });
    this._render(deck); this._notify(); this._error(error);
  }
  _preparePitch(deck) {
    if (deck.pitchPromise || !this.armed || !deck.state.playing || !needsPitchProcessing(deck.state)) return;
    const buffer = this._buffer(deck);
    let helper = deck.pitch;
    try {
      if (!helper) {
        helper = this.pitchFactory({ context: this.context, output: deck.graph.input,
          memoryLimit: this.limits.bufferBytes, getBaseBytes: () => this._otherBufferBytes(null),
          onError: error => this._pitchFailed(deck, helper, error) });
        deck.pitch = helper;
      }
    } catch (error) { this._pitchFailed(deck, helper, error); return; }
    deck.state.pitchStatus = "preparing"; deck.state.pitchError = null;
    const pending = Promise.resolve().then(() => helper.prepare(buffer)).then(ready => {
      if (!ready || this.disposed || deck.pitch !== helper || deck.buffer !== buffer) return;
      deck.state.pitchStatus = "ready";
      if (this.armed && deck.state.playing && !deck.state.scratching && needsPitchProcessing(deck.state)) this._renderTransport(deck);
      this._notify();
    }, error => this._pitchFailed(deck, helper, error)).finally(() => {
      if (deck.pitchPromise === pending) deck.pitchPromise = null;
    });
    deck.pitchPromise = pending;
  }
  _refreshPlayback(deck) {
    const state = deck.state;
    if (!needsPitchProcessing(state) && deck.pitch) { this._dropPitch(deck); this._render(deck); }
    else if (deck.pitch?.isReady(deck.buffer)) this._render(deck);
    else {
      if (deck.source) deck.source.source.playbackRate.setValueAtTime(state.rate, this.context.currentTime);
      this._preparePitch(deck);
    }
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
        for (let index = 0; index < 8; index++) node.connect(this.decks[index].graph.input, index);
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
      for (const deck of this.decks) { this._stopSource(deck); this._dropPitch(deck); }
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
        if (this.syncEnabled) {
          for (const deck of this.decks) if (deck.state.playing) this._buffer(deck);
          const when = this._syncBoundary(); this._render(this.decks[this.masterDeck], when);
          const aligned = this._syncFollowers(null, when);
          for (const deck of this.decks.filter(deck => deck.state.id !== this.masterDeck)) if (!aligned.has(deck.state.id)) this._render(deck, when);
        } else for (const deck of this.decks) this._render(deck);
        for (const deck of this.decks) if (deck.scratch) this._startScratchAudio(deck);
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
    if (deck.cuePreview) { deck.cuePreview.continuePlaying = true; deck.slip = null; }
    if (state.playing) return true;
    if (state.position >= state.duration) state.position = state.loopEnabled ? state.loopStart : 0;
    state.playing = true; state.anchorTime = this._now(); this._renderTransport(deck); this._notify(); return true;
  }
  playAll() {
    if (this.disposed) return false;
    // Prepare first, then choose one launch boundary. Neither DOM observer work
    // nor eight separate buffer copies can stagger the eight source starts.
    if (this.armed) for (const deck of this.decks) this._buffer(deck);
    const now = this._now(), when = this._syncBoundary(now);
    const started = [];
    for (const deck of this.decks) {
      const state = this._capture(deck, now);
      if (deck.cuePreview) { deck.cuePreview.continuePlaying = true; deck.slip = null; }
      if (state.playing) continue;
      if (state.position >= state.duration) state.position = state.loopEnabled ? state.loopStart : 0;
      state.playing = true; state.anchorTime = when; started.push(deck);
    }
    if (this.syncEnabled) {
      if (started.includes(this.decks[this.masterDeck])) this._render(this.decks[this.masterDeck], when);
      const aligned = this._syncFollowers(null, when);
      for (const deck of started) if (deck.state.id !== this.masterDeck && !aligned.has(deck.state.id)) this._render(deck, when);
    } else for (const deck of started) this._render(deck, when);
    this._notify(); return true;
  }
  pauseAll() {
    if (this.disposed) return;
    const now = this._now();
    for (const deck of this.decks) { this._capture(deck, now).playing = false; deck.cuePreview = deck.slip = null; this._stopSource(deck); this._dropPitch(deck); }
    this._notify();
  }
  pause(index) {
    if (this.disposed) return;
    const deck = this._deck(index); this._capture(deck).playing = false; deck.cuePreview = deck.slip = null; this._stopSource(deck); this._dropPitch(deck); this._notify();
  }
  toggle(index) { if (this._deck(index).cuePreview) this.play(index); else if (this.getDeckState(index).playing) this.pause(index); else this.play(index); }
  _beginSlip(deck) {
    if (deck.state.slipEnabled && deck.state.playing && !deck.slip) deck.slip = { ...deck.state, scratching: false, anchorTime: this._now() };
  }
  _restoreSlip(deck) {
    if (!deck.slip) return false;
    const now = this._now(), position = deckPosition(deck.slip, now);
    Object.assign(deck.state, { position, anchorTime: now, playing: deck.slip.playing && (deck.state.loopEnabled || position < deck.state.duration) });
    deck.slip = null; return true;
  }
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
    if (deck.cuePreview) this.endCuePreview(index);
    this._beginSlip(deck);
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
    this._cancelScratch(deck); this._restoreSlip(deck); this._renderTransport(deck); this._notify();
  }
  seek(index, seconds) {
    if (this.disposed) return;
    const deck = this._deck(index); this._cancelScratch(deck); deck.cuePreview = deck.slip = null; const state = this._capture(deck);
    state.position = scratchPosition(clamp(seconds, 0, state.duration, state.position), state); state.anchorTime = this._now();
    this._renderTransport(deck); this._notify();
  }
  setCue(index, seconds = this.getDeckState(index).position) {
    if (this.disposed) return;
    const deck = this._deck(index); deck.state.cuePoint = scratchPosition(clamp(seconds, 0, deck.state.duration, deck.state.cuePoint), deck.state);
    this._notify();
  }
  cue(index) {
    if (this.disposed) return;
    const deck = this._deck(index); this._cancelScratch(deck); deck.cuePreview = deck.slip = null;
    const state = this._capture(deck); state.position = state.cuePoint; state.anchorTime = this._now();
    deck.syncAligned = false; this._render(deck);
    if (index === this.masterDeck) this._syncFollowers();
    this._notify();
  }
  beginCuePreview(index) {
    if (this.disposed) return false;
    const deck = this._deck(index); if (deck.cuePreview) return false;
    this._cancelScratch(deck); const state = this._capture(deck);
    this._beginSlip(deck);
    deck.cuePreview = { continuePlaying: state.playing };
    state.position = state.cuePoint; state.anchorTime = this._now(); state.playing = true;
    this._render(deck); this._notify(); return true;
  }
  endCuePreview(index) {
    if (this.disposed) return;
    const deck = this._deck(index), preview = deck.cuePreview; if (!preview) return;
    this._capture(deck); deck.cuePreview = null;
    if (!this._restoreSlip(deck) && !preview.continuePlaying) {
      Object.assign(deck.state, { playing: false, position: deck.state.cuePoint, anchorTime: this._now() });
    }
    this._renderTransport(deck); this._notify();
  }
  setLoop(index, beats) {
    if (this.disposed) return;
    // Retained for old callers only. Full-source repeat has no editable region.
    this._deck(index); return false;
  }
  setDeck(index, patch) {
    if (this.disposed) return;
    const deck = this._deck(index), state = this._capture(deck), changes = sanitizeDeckPatch(patch, state);
    const speedChange = Object.hasOwn(changes, "rate"), gridChange = Object.hasOwn(changes, "bpm") || Object.hasOwn(changes, "beatOffset");
    if (deck.slip) { deck.slip.position = deckPosition(deck.slip, this._now()); deck.slip.anchorTime = this._now(); }
    if (deck.syncRequested && speedChange) this._setSyncMembership(deck, false);
    if (gridChange) deck.gridRevision++;
    Object.assign(state, changes);
    if (deck.slip && speedChange) deck.slip.rate = state.rate;
    if (changes.slipEnabled === false) deck.slip = null;
    const audioChange = speedChange || Object.hasOwn(changes, "keyLock") || Object.hasOwn(changes, "pitchSemitones");
    if (audioChange) this._refreshPlayback(deck);
    if (this.syncEnabled && (index === this.masterDeck || deck.syncRequested) && (speedChange || gridChange)) this._syncFollowers(index === this.masterDeck ? null : index);
    for (const item of this.decks) this._applyDeck(item);
    this._notify();
  }
  /** Apply a mixer batch together without touching transport or Sync.
   * Only pan/gain are accepted; each affected graph is smoothed once. */
  setDeckMix(patches) {
    if (this.disposed || !Array.isArray(patches)) return 0;
    const updates = new Map();
    for (const patch of patches.slice(0, WOBBLINI_DECK_COUNT)) {
      if (!patch || !Number.isInteger(patch.id) || !this.decks[patch.id]) continue;
      const update = updates.get(patch.id) ?? {};
      for (const [key, low, high] of [["pan", -1, 1], ["gain", 0, 1]]) {
        if (Object.hasOwn(patch, key) && Number.isFinite(Number(patch[key]))) update[key] = clamp(patch[key], low, high);
      }
      if (Object.keys(update).length) updates.set(patch.id, update);
    }
    for (const [id, update] of updates) {
      const deck = this.decks[id]; Object.assign(deck.state, update); this._applyDeck(deck);
    }
    if (updates.size) this._notify();
    return updates.size;
  }
  setMaster(patch) {
    if (this.disposed) return;
    const changes = sanitizeMasterPatch(patch, this.master);
    Object.assign(this.master, changes); this._applyMaster();
    if (Object.hasOwn(changes, "syncMode") || Object.hasOwn(changes, "syncInterval")) this._syncFollowers();
    this._notify();
  }

  _replace(deck, { buffer = null, samples = null, sampleRate, name, kind, bpm, duration, peaks, autoGainDb = 0 }) {
    this._cancelScratch(deck); deck.cuePreview = deck.slip = null;
    this._dropPitch(deck);
    deck.analyzer?.cancel(); deck.analysisRevision++; deck.gridRevision++;
    const state = this._capture(deck), wasPlaying = state.playing;
    deck.buffer = buffer; deck.samples = samples; deck.sampleRate = sampleRate; deck.peaks = peaks; deck.loopPeakCache = null;
    Object.assign(state, { name, kind, bpm, duration, position: 0, anchorTime: this._now(), cuePoint: 0, beatOffset: 0, autoGainDb, analysisStatus: "idle", analysisError: null,
      playing: wasPlaying, loopBeats: null, loopEnabled: true, loopStart: 0, loopEnd: duration, loading: false });
    this._applyDeck(deck); this._renderTransport(deck); this._notify();
  }
  loadDemo(index) {
    if (this.disposed) return false;
    const deck = this._deck(index); ++deck.generation;
    deck.importAbort?.abort(); deck.importAbort = null;
    const data = createDemoSamples(index), demo = WOBBLINI_DEMOS[index];
    this._replace(deck, { ...data, name: demo.name, kind: "demo", peaks: waveformPeaks([data.samples]), autoGainDb: analyzeTrackLevel([data.samples]).gainDb }); return true;
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
        const available = Math.max(0, Math.min(this.limits.deckBytes, this.limits.bufferBytes - this._otherBufferBytes(deck) - wobbliniPitchMemoryBytes(this.context)));
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
      const otherBytes = this._otherBufferBytes(deck) + wobbliniPitchMemoryBytes(this.context);
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
        kind: "file", duration: buffer.duration, bpm: 120, peaks: waveformPeaks(channels), autoGainDb: analyzeTrackLevel(channels).gainDb });
      this._analyze(deck, buffer); return true;
    } catch (error) {
      if (this.disposed || attempt !== deck.generation) return false;
      throw new Error(error?.message || "This browser could not decode that audio file.");
    } finally {
      if (deck.importAbort === inspection) deck.importAbort = null;
      if (!this.disposed && attempt === deck.generation) { deck.state.loading = false; this._notify(); }
    }
  }
  _analyze(deck, buffer) {
    const attempt = ++deck.analysisRevision, revision = deck.gridRevision;
    const valid = () => !this.disposed && attempt === deck.analysisRevision && deck.buffer === buffer;
    deck.state.analysisStatus = "analyzing"; deck.state.analysisError = null; this._notify();
    const pending = this.analysisQueue.then(async () => {
      if (!valid()) return;
      try {
        deck.analyzer ??= this.analyzerFactory();
        const result = await deck.analyzer.analyze(buffer);
        if (!valid()) return;
        const reliable = result?.status === "ok" && Number.isFinite(result.bpm) && result.bpm >= 40 && result.bpm <= 240
          && Number.isFinite(result.beatOffset) && result.beatOffset >= 0 && result.beatOffset <= deck.state.duration;
        deck.state.analysisStatus = reliable ? "ready" : "fallback";
        if (reliable && revision === deck.gridRevision) {
          this._capture(deck); deck.state.bpm = result.bpm; deck.state.beatOffset = result.beatOffset;
          this._syncFollowers(deck.state.id === this.masterDeck ? null : deck.state.id);
        }
      } catch (error) {
        if (!valid()) return;
        deck.state.analysisStatus = "fallback";
        deck.state.analysisError = error?.message || "Beat analysis unavailable; set BPM manually.";
      } finally { if (valid()) this._notify(); }
    });
    this.analysisQueue = pending.catch(() => {});
    return pending;
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
      this._cancelScratch(deck); deck.cuePreview = deck.slip = null;
      this._dropPitch(deck);
      deck.analyzer?.dispose(); deck.analyzer = null; deck.analysisRevision++;
      ++deck.generation; deck.state.playing = false; deck.state.loading = false;
      deck.importAbort?.abort(); deck.importAbort = null;
      this._stopSource(deck, true);
      for (const record of [...deck.retiring]) { try { record.source.stop(); } catch { /* Ended. */ } this._releaseSource(deck, record); }
      for (const node of Object.values(deck.graph ?? {})) disconnect(node);
      deck.buffer = deck.samples = deck.graph = deck.loopPeakCache = null;
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
