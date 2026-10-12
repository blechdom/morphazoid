import SignalsmithStretch from "../../../vendor/signalsmith-stretch/SignalsmithStretch.mjs";
import { connectAudioOutput } from "../../audio-output-manager.js";
import { DeckTransport, clamp, crossfadeGains, normalizeLoop, beatPhase, phaseDifference, alignedPosition, matchingRate,
  beatJumpPosition, quantizedPosition, wholeBeatLoop, shiftedLoop, resizedLoop, MIN_RATE, MAX_RATE } from "./transport.js";

const FADE = 0.012;
const SAMPLE_RATE = 48_000;
const WASM_TIMEOUT = 12_000;
const DECK_IDS = ["a", "b"];
// Unity below the knee; bounded soft saturation protects overloads from EQ boosts.
const SAFETY_CURVE = Float32Array.from({ length: 4097 }, (_, index) => {
  const sample = index / 2048 - 1; const level = Math.abs(sample);
  return Math.sign(sample) * (level <= 0.85 ? level : 0.85 + 0.13 * (1 - Math.exp(-(level - 0.85) / 0.13)));
});

function wallTime() { return performance.now() / 1000; }
function disconnect(node) { try { node?.disconnect(); } catch { /* Already disconnected. */ } }
function smooth(param, value, time, duration = FADE) {
  if (!param) return;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(time);
  else { param.cancelScheduledValues(time); param.setValueAtTime(param.value, time); }
  param.linearRampToValueAtTime(value, time + duration);
}

function bounded(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out. Turn Audio off and try again.`)), WASM_TIMEOUT); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Two independent transports on one AudioContext. Play never creates/resumes it.
 * Key lock uses vendored MIT Signalsmith; native playback remains a fallback.
 * Signalsmith's buffer mode compensates its own latency. Commands are scheduled
 * latency + 12 ms ahead with the transport projected to that output time. The
 * snapshot positions follow the audible timeline; playing/rate describe intent
 * while pending is true. Both decks receive changes at the same future time,
 * including mixed native/key-lock playback. Never add latency to inputTime.
 * We deliberately do not use its inputTime notifications: they include analysis
 * lookahead. Seeking/key-lock transitions are smoothed, not scratch emulation.
 */
export class TrackazoidAudio {
  constructor({ onError = () => {}, onChange = () => {},
    // Dependency seams support lifecycle/routing tests without a sound device.
    contextFactory = () => {
      const Constructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Constructor) throw new Error("Trackazoid needs a browser with Web Audio.");
      return new Constructor({ latencyHint: "interactive", sampleRate: SAMPLE_RATE });
    }, stretchFactory = SignalsmithStretch, outputConnector = connectAudioOutput,
    now = wallTime, defaultKeyLock = true,
  } = {}) {
    this.onError = onError; this.onChange = onChange;
    this.contextFactory = contextFactory; this.stretchFactory = stretchFactory;
    this.outputConnector = outputConnector; this.wallTime = now;
    this.context = null; this.armed = false; this.requestedAudio = false; this.disposed = false;
    this.audioGeneration = 0; this.clockIsAudio = false;
    this.masterLevel = 0.7; this.masterId = null; this.playSequence = 0;
    this.crossfader = 0; this.cueLevel = 0.6; this.routing = "stereo";
    this.graph = null; this.release = null; this.armPromise = null;
    this.handleContextState = () => {
      if (!this.armed || this.disposed || this.context?.state === "running") return;
      this._switchClock(false); this.armed = false; this.requestedAudio = false; ++this.audioGeneration;
      for (const deck of Object.values(this.decks)) this._stopDeck(deck, true);
      this.release?.(); this.release = null;
      this._notify(); this._error(new Error("The browser interrupted audio. Enable Audio to rejoin the mix."));
    };
    this.decks = Object.fromEntries(DECK_IDS.map(id => [id, {
      id, transport: new DeckTransport(), buffer: null, generation: 0,
      keyLock: defaultKeyLock, gain: 0.8, eq: { low: 0, mid: 0, high: 0 }, filter: 0,
      grid: { bpm: null, beatOffset: 0 }, sync: false, syncError: null, quantize: true, playOrder: 0,
      cue: false, graph: null, source: null, retiring: new Set(), stretch: null,
      stretchBuffer: null, stretchPending: null, latency: 0,
    }]));
  }

  _deck(id) {
    if (!this.decks[id]) throw new Error(`Unknown Trackazoid deck: ${id}`);
    return this.decks[id];
  }
  _now() { return this.clockIsAudio && this.context ? this.context.currentTime : this.wallTime(); }
  _notify() { try { this.onChange(); } catch { /* Observers cannot stop audio. */ } }
  _error(error) { try { this.onError(error); } catch { /* Observers cannot stop audio. */ } }
  _masterAt(now) {
    const playing = Object.values(this.decks).filter(deck => deck.transport.intent(now).playing);
    return playing.find(deck => deck.id === this.masterId)?.id
      ?? playing.sort((a, b) => a.playOrder - b.playOrder)[0]?.id ?? null;
  }
  get master() { return this._masterAt(this._now()); }
  snapshot(id) {
    const now = this._now(), deck = this._deck(id), masterId = this._masterAt(now);
    const current = deck.transport.snapshot(now), state = deck.transport.intent(now);
    const reference = masterId ? this.decks[masterId] : null;
    return { ...state, keyLock: deck.keyLock, sync: deck.sync, quantize: deck.quantize, isMaster: masterId === id,
      ...deck.grid, effectiveBpm: deck.grid.bpm ? deck.grid.bpm * state.rate : null,
      syncError: deck.syncError,
      phaseError: reference && current.playing && reference.transport.snapshot(now).playing
        ? phaseDifference(current.position, deck.grid, reference.transport.snapshot(now).position, reference.grid) : null,
    };
  }

  _lead() {
    if (!this.armed || !this.context) return 0;
    return FADE + Math.max(0, ...Object.values(this.decks).map(deck => (
      deck.keyLock && deck.stretch && deck.stretchBuffer === deck.buffer ? deck.latency : 0
    )));
  }
  _when() { return this._now() + this._lead(); }

  _commit(deck, changes, when, now = this._now(), relativePosition = false) {
    deck.transport.schedule(when, changes, now, { relativePosition });
    this._render(deck, when);
  }

  _syncRate(deck, master, time) {
    return matchingRate(deck.grid.bpm, master.grid.bpm, master.transport.snapshot(time).rate);
  }

  _nextBeatTime(master, time) {
    const reference = master.transport.snapshot(time);
    const phase = beatPhase(reference.position, master.grid);
    return phase !== null && phase > 1e-6 && 1 - phase > 1e-6
      ? time + (1 - phase) * 60 / (master.grid.bpm * reference.rate) : time;
  }

  _beatLoop(deck, time) {
    return wholeBeatLoop(deck.transport.intent(time).loop, deck.grid);
  }

  _syncFailure(deck, message, report = true) {
    deck.sync = false; deck.syncError = message;
    if (report) this._error(new Error(message));
  }

  _follow(when, { align = true } = {}) {
    const now = this._now(); this.masterId = this._masterAt(now);
    const master = this.decks[this.masterId]; if (!master) return;
    for (const deck of Object.values(this.decks)) {
      if (!deck.sync || deck === master) continue;
      if (!this._beatLoop(master, now) || !this._beatLoop(deck, now)) {
        this._syncFailure(deck, "A free-length loop overrides beat Sync."); continue;
      }
      const rate = this._syncRate(deck, master, when);
      if (rate === null) {
        this._syncFailure(deck, !deck.grid.bpm || !master.grid.bpm
          ? "Sync needs a known BPM and beat grid on both decks."
          : `Deck ${deck.id.toUpperCase()} needs more than ±16% tempo to follow the master. Sync is off.`);
        continue;
      }
      deck.syncError = null;
      const intent = deck.transport.intent(now);
      const pendingLaunch = intent.playing && !deck.transport.snapshot(now).playing;
      const boundary = pendingLaunch ? this._nextBeatTime(master, when) : when;
      let current;
      try { current = deck.transport.projected(boundary, now); }
      catch (error) {
        if (!(error instanceof RangeError)) throw error;
        this._syncFailure(deck, "The pending beat action reaches the track edge. Sync is off; pause or choose another point.");
        continue;
      }
      const changes = { rate };
      if (align && intent.playing) changes.position = alignedPosition(
        pendingLaunch ? deck.transport.pendingChanges?.position ?? current.position : current.position,
        deck.grid, beatPhase(master.transport.snapshot(boundary).position, master.grid), current.duration, current.loop);
      this._commit(deck, changes, boundary, now);
    }
  }

  _switchClock(audio) {
    if (audio === this.clockIsAudio) return;
    const oldTime = this._now();
    const nextTime = audio ? this.context.currentTime : this.wallTime();
    for (const deck of Object.values(this.decks)) deck.transport.rebase(oldTime, nextTime);
    this.clockIsAudio = audio;
  }

  _gain(value = 1, mono = false) {
    const node = this.context.createGain(); node.gain.value = value;
    node.channelCount = mono ? 1 : 2; node.channelCountMode = "explicit";
    node.channelInterpretation = "speakers";
    return node;
  }

  _createGraph() {
    if (this.graph) return;
    const context = this.context;
    const master = this._gain(this.masterLevel * 0.7);
    const masterSafety = context.createWaveShaper(); masterSafety.curve = SAFETY_CURVE;
    const masterArm = this._gain(0);
    const cue = this._gain(this.cueLevel * 0.7);
    const cueSafety = context.createWaveShaper(); cueSafety.curve = SAFETY_CURVE;
    const cueArm = this._gain(0);
    const stereo = this._gain(this.routing === "stereo" ? 1 : 0);
    const split = this._gain(this.routing === "split" ? 1 : 0);
    const monoMaster = this._gain(1, true); const monoCue = this._gain(1, true);
    const merger = context.createChannelMerger(2); const output = this._gain(1);
    master.connect(masterSafety).connect(masterArm); cue.connect(cueSafety).connect(cueArm);
    masterArm.connect(stereo).connect(output);
    masterArm.connect(monoMaster).connect(merger, 0, 0);
    cueArm.connect(monoCue).connect(merger, 0, 1);
    merger.connect(split).connect(output);
    this.graph = { master, masterSafety, masterArm, cue, cueSafety, cueArm, stereo, split, monoMaster, monoCue, merger, output };
    for (const deck of Object.values(this.decks)) {
      const input = this._gain();
      const low = context.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 250;
      const mid = context.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.7;
      const high = context.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = 4000;
      const highpass = context.createBiquadFilter(); highpass.type = "highpass"; highpass.Q.value = 0.5;
      const lowpass = context.createBiquadFilter(); lowpass.type = "lowpass"; lowpass.Q.value = 0.5;
      const fader = this._gain(); const cueSend = this._gain(0); const stretchGain = this._gain(0);
      stretchGain.connect(input);
      input.connect(low).connect(mid).connect(high).connect(highpass).connect(lowpass);
      lowpass.connect(fader).connect(master);
      // Cue taps before the deck fader and crossfader. It has no path to stereo master.
      lowpass.connect(cueSend).connect(cue);
      deck.graph = { input, low, mid, high, highpass, lowpass, fader, cueSend, stretchGain };
      this._applyMix(deck, true);
    }
  }

  async setAudio(enabled) {
    if (this.disposed) return false;
    if (!enabled) {
      const attempt = ++this.audioGeneration;
      this.requestedAudio = false; this.armed = false; this._switchClock(false);
      if (this.graph) {
        smooth(this.graph.masterArm.gain, 0, this.context.currentTime);
        smooth(this.graph.cueArm.gain, 0, this.context.currentTime);
      }
      this._notify();
      // Leave one short render fade, then release every active render source.
      await new Promise(resolve => setTimeout(resolve, FADE * 1000 + 4));
      if (attempt !== this.audioGeneration || this.disposed) return false;
      for (const deck of Object.values(this.decks)) this._stopDeck(deck, true);
      this.release?.(); this.release = null;
      if (this.context?.state === "running") await this.context.suspend().catch(() => {});
      return false;
    }
    if (globalThis.document?.hidden) return false;
    if (this.armed && this.context?.state === "running") return true;
    this.requestedAudio = true;
    const attempt = ++this.audioGeneration;
    // Both operations happen before the first await, within the explicit gesture.
    if (!this.context) {
      this.context = this.contextFactory();
      this.context.addEventListener?.("statechange", this.handleContextState);
    }
    const context = this.context;
    const resumed = context.resume();
    const work = async () => {
      try {
        await resumed;
        if (attempt !== this.audioGeneration || this.disposed) {
          if (!this.requestedAudio && context.state === "running") await context.suspend().catch(() => {});
          return false;
        }
        this._createGraph();
        await Promise.all(Object.values(this.decks).filter(deck => deck.keyLock && deck.buffer).map(async deck => {
          try { await this._prepareStretch(deck); }
          catch (error) {
            deck.keyLock = false;
            this._error(new Error(`Deck ${deck.id.toUpperCase()} will play without key lock: ${error.message}`));
          }
        }));
        if (attempt !== this.audioGeneration || this.disposed) {
          if (!this.requestedAudio && context.state === "running") await context.suspend().catch(() => {});
          return false;
        }
        if (globalThis.document?.hidden) { this.requestedAudio = false; await context.suspend().catch(() => {}); return false; }
        this._switchClock(true); this.armed = true;
        // Meter/record the stereo master, even while hardware output is split cue.
        this.release ??= this.outputConnector(context, this.graph.output, { stereoSource: this.graph.masterArm });
        const when = this._when();
        this._follow(when);
        for (const deck of Object.values(this.decks)) this._render(deck, when);
        smooth(this.graph.masterArm.gain, 1, context.currentTime);
        smooth(this.graph.cueArm.gain, 1, context.currentTime);
        this._notify();
        return true;
      } catch (error) {
        if (attempt !== this.audioGeneration || this.disposed) return false;
        this.requestedAudio = false; this.armed = false; this._switchClock(false);
        this.release?.(); this.release = null;
        if (this.graph) { this.graph.masterArm.gain.value = 0; this.graph.cueArm.gain.value = 0; }
        await context.suspend().catch(() => {});
        this._notify();
        throw error;
      }
    };
    this.armPromise = work();
    return this.armPromise;
  }

  async load(id, buffer) {
    if (this.disposed) return false;
    if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || !buffer.getChannelData) {
      throw new Error("This track has no playable audio.");
    }
    const deck = this._deck(id); const generation = ++deck.generation;
    this._stopDeck(deck, true);
    deck.buffer = buffer; deck.stretchBuffer = null;
    deck.transport.load(buffer.duration, this._now());
    deck.grid = { bpm: null, beatOffset: 0 }; deck.sync = false; deck.syncError = null;
    this.masterId = this._masterAt(this._now());
    this._notify();
    try {
      if (deck.stretch) await bounded(deck.stretch.dropBuffers(), "Releasing the previous track");
      if (generation !== deck.generation || this.disposed) return false;
      if (deck.keyLock && this.graph) await this._prepareStretch(deck);
    } catch (error) {
      if (generation !== deck.generation || this.disposed) return false;
      // Decoding succeeded: retain the new file, with usable native playback.
      disconnect(deck.stretch); deck.stretch?.port?.close(); deck.stretch = null;
      deck.stretchBuffer = null; deck.keyLock = false;
      this._error(new Error(`Deck ${id.toUpperCase()} loaded without key lock: ${error.message}`));
      this._notify();
    }
    if (generation !== deck.generation || this.disposed) return false;
    this._render(deck); return true;
  }

  async _prepareStretch(deck) {
    // One preparation per deck; stale jobs finish silently before newest input loads.
    while (deck.stretchPending) {
      await deck.stretchPending;
      if (this.disposed || !deck.keyLock || !deck.buffer) return;
      if (deck.stretchBuffer === deck.buffer) return;
    }
    if (!deck.buffer || this.disposed || deck.stretchBuffer === deck.buffer) return;
    const buffer = deck.buffer; const generation = deck.generation;
    const valid = () => !this.disposed && deck.generation === generation && deck.buffer === buffer;
    const prepare = async () => {
      if (!deck.stretch) {
        if (!this.context.audioWorklet) throw new Error("Key lock needs AudioWorklet on HTTPS or localhost.");
        const creation = this.stretchFactory(this.context, {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
          channelCount: 2, channelCountMode: "explicit",
        });
        let accepted = true;
        const node = await bounded(Promise.resolve(creation).then(node => {
          if (!accepted || this.disposed) { disconnect(node); node.port?.close(); }
          return node;
        }), "Starting key lock").catch(error => { accepted = false; throw error; });
        if (this.disposed) return;
        deck.stretch = node;
        node.onprocessorerror = () => {
          if (this.disposed || deck.stretch !== node) return;
          deck.keyLock = false; deck.stretchBuffer = null;
          disconnect(node); node.port?.close(); deck.stretch = null;
          this._render(deck); this._notify();
          this._error(new Error(`Deck ${deck.id.toUpperCase()} key lock stopped. Playback continues without key lock.`));
        };
        await bounded(node.configure({ blockMs: 80, intervalMs: 20, splitComputation: true }), "Configuring key lock");
        deck.latency = clamp(await bounded(node.latency(), "Measuring key-lock latency"), 0, 0.5, 0.1);
        node.connect(deck.graph.stretchGain);
      }
      if (!valid()) return;
      let matching = buffer;
      if (buffer.sampleRate !== this.context.sampleRate) {
        const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
        if (!Offline) throw new Error("This browser cannot resample this track for key lock.");
        const offline = new Offline(Math.min(2, buffer.numberOfChannels), Math.ceil(buffer.duration * this.context.sampleRate), this.context.sampleRate);
        const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
        matching = await offline.startRendering();
      }
      if (!valid()) return;
      await bounded(deck.stretch.dropBuffers(), "Replacing key-lock audio");
      if (!valid()) return;
      // Worklet takes transferable copies; native playback retains the AudioBuffer.
      const channels = Array.from({ length: Math.min(2, matching.numberOfChannels) }, (_, channel) => new Float32Array(matching.getChannelData(channel)));
      await bounded(deck.stretch.addBuffers(channels, channels.map(channel => channel.buffer)), "Loading key-lock audio");
      if (valid()) deck.stretchBuffer = buffer;
    };
    const pending = prepare(); deck.stretchPending = pending;
    try { await pending; }
    catch (error) {
      disconnect(deck.stretch); deck.stretch?.port?.close(); deck.stretch = null;
      deck.stretchBuffer = null;
      throw error;
    } finally { if (deck.stretchPending === pending) deck.stretchPending = null; }
  }

  _stopNative(deck, when = this.context?.currentTime ?? 0, immediate = false) {
    const voice = deck.source;
    if (!voice) return;
    deck.source = null;
    const end = immediate ? when : when + FADE;
    voice.endTime = end;
    if (immediate) voice.gain.gain.value = 0;
    else smooth(voice.gain.gain, 0, when);
    deck.retiring.add(voice);
    try { voice.node.stop(end); } catch { /* Already stopped. */ }
    if (immediate) { disconnect(voice.node); disconnect(voice.gain); deck.retiring.delete(voice); }
    // Fast scrubbing may overlap only one fading predecessor.
    while (deck.retiring.size > 1) {
      const old = deck.retiring.values().next().value;
      try { old.node.stop(); } catch { /* Already stopped. */ }
      disconnect(old.node); disconnect(old.gain); deck.retiring.delete(old);
    }
  }

  _restoreNative(deck, now) {
    if (!deck.source || deck.source.startTime <= now) return;
    // Replace a not-yet-started command without cutting its still-playing predecessor.
    const pending = deck.source; deck.source = null;
    try { pending.node.stop(); } catch { /* Already stopped. */ }
    disconnect(pending.node); disconnect(pending.gain);
    const predecessor = [...deck.retiring].find(voice => voice.startTime <= now && voice.endTime > now);
    if (predecessor) {
      deck.retiring.delete(predecessor); deck.source = predecessor;
      smooth(predecessor.gain.gain, 1, now);
    }
  }

  _stopDeck(deck, immediate = false, when = this.context?.currentTime ?? 0) {
    const now = when;
    this._stopNative(deck, now, immediate);
    for (const voice of deck.retiring) {
      if (immediate) { voice.gain.gain.value = 0; disconnect(voice.node); disconnect(voice.gain); }
      else smooth(voice.gain.gain, 0, now);
      voice.endTime = immediate ? now : now + FADE;
      try { voice.node.stop(voice.endTime); } catch { /* Already stopped. */ }
    }
    if (immediate) deck.retiring.clear();
    if (deck.graph) smooth(deck.graph.stretchGain.gain, 0, now, immediate ? 0 : FADE);
    if (deck.stretch) {
      void deck.stretch.schedule({ active: false, output: now }).catch(error => this._error(error));
    }
  }

  _render(deck, scheduledTime = this._when()) {
    if (this.disposed || !this.armed || !deck.buffer || !deck.graph) return;
    const context = this.context; const now = context.currentTime;
    const pendingTime = deck.transport.intent(now).playing ? deck.transport.pending?.time ?? scheduledTime : scheduledTime;
    const when = Math.max(scheduledTime, pendingTime);
    const state = deck.transport.snapshot(when);
    this._restoreNative(deck, now);
    if (!state.playing) { this._stopDeck(deck, false, when); return; }
    const useStretch = deck.keyLock && deck.stretch && deck.stretchBuffer === deck.buffer;
    const projected = state;
    if (useStretch) {
      this._stopNative(deck, when);
      void deck.stretch.schedule({
        output: when, active: true, input: projected.position, rate: state.rate, semitones: 0,
        loopStart: state.loop?.start ?? 0, loopEnd: state.loop?.end ?? 0,
      }).catch(error => this._error(error));
      smooth(deck.graph.stretchGain.gain, 1, when);
      return;
    }
    if (deck.stretch) {
      smooth(deck.graph.stretchGain.gain, 0, when);
      void deck.stretch.schedule({ active: false, output: when + FADE }).catch(error => this._error(error));
    }
    this._stopNative(deck, when);
    if (!projected.playing) return;
    const source = context.createBufferSource(); source.buffer = deck.buffer;
    source.playbackRate.value = state.rate;
    source.loop = Boolean(state.loop);
    if (state.loop) { source.loopStart = state.loop.start; source.loopEnd = state.loop.end; }
    const gain = this._gain(0); source.connect(gain).connect(deck.graph.input);
    const voice = { node: source, gain, startTime: when, endTime: Infinity }; deck.source = voice;
    source.onended = () => {
      disconnect(source); disconnect(gain); deck.retiring.delete(voice);
      if (deck.source === voice) { deck.source = null; this._notify(); }
    };
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(1, when + FADE);
    source.start(when, projected.position);
  }

  setBeatGrid(id, { bpm = null, beatOffset = 0 } = {}) {
    const deck = this._deck(id);
    const known = Number.isFinite(bpm) && bpm >= 40 && bpm <= 240;
    const grid = { bpm: known ? bpm : null, beatOffset: clamp(beatOffset, 0, deck.buffer?.duration ?? 24 * 60 * 60) };
    if (grid.bpm === deck.grid.bpm && grid.beatOffset === deck.grid.beatOffset) return this.snapshot(id);
    deck.grid = grid;
    if (!known && deck.sync) this._syncFailure(deck, "Set a BPM before enabling Sync.", false);
    this._follow(this._when()); this._notify(); return this.snapshot(id);
  }

  setSync(id, enabled) {
    if (this.disposed) return this.snapshot(id);
    const now = this._now(), deck = this._deck(id), masterId = this._masterAt(now);
    if (!enabled) { deck.sync = false; deck.syncError = null; this._notify(); return this.snapshot(id); }
    let message = !deck.grid.bpm ? "Analyze this track or enter its source BPM before enabling Sync." : null;
    if (!message && masterId && masterId !== id) {
      const master = this.decks[masterId];
      if (!master.grid.bpm) message = "Set the master track’s source BPM before enabling Sync.";
      else if (this._syncRate(deck, master, this._when()) === null) message = "Sync needs more than ±16% tempo. Correct a half/double BPM or adjust the master tempo.";
      else if (!this._beatLoop(deck, now) || !this._beatLoop(master, now)) message = "Use a whole-beat loop before enabling Sync.";
    }
    if (message) { this._syncFailure(deck, message, false); this._notify(); throw new Error(message); }
    deck.sync = true; deck.syncError = null;
    this._follow(this._when()); this._notify(); return this.snapshot(id);
  }

  play(id) {
    if (this.disposed) return this.snapshot(id);
    const deck = this._deck(id), now = this._now(), state = deck.transport.intent(now);
    if (!state.duration || state.playing) return this.snapshot(id);
    this.masterId = this._masterAt(now);
    const master = this.decks[this.masterId]; let when = this._when();
    const requestedPosition = deck.transport.pendingChanges?.position ?? state.position;
    let position = requestedPosition >= state.duration ? 0 : requestedPosition;
    const changes = { playing: true, position };
    if (deck.sync && master && master !== deck) {
      const rate = this._syncRate(deck, master, when);
      if (rate === null) {
        this._syncFailure(deck, "Sync cannot match this master within ±16%. Adjust the BPM or disable Sync.", false);
        this._notify(); throw new Error(deck.syncError);
      }
      // Launch on the next master beat, after enough lead for both render modes.
      when = this._nextBeatTime(master, when);
      changes.position = alignedPosition(position, deck.grid, beatPhase(master.transport.snapshot(when).position, master.grid), state.duration, state.loop);
      changes.rate = rate;
    }
    deck.playOrder = ++this.playSequence;
    this._commit(deck, changes, when, now);
    if (!this.masterId) this.masterId = id;
    // A first-playing master also supplies the tempo for stopped Sync followers.
    if (this.masterId === id) this._follow(when);
    this._notify(); return this.snapshot(id);
  }

  pause(id) {
    if (this.disposed) return this.snapshot(id);
    const deck = this._deck(id), now = this._now();
    // Pause promptly; future quantized starts are cancelled as part of this edit.
    deck.transport.change(now, { playing: false, position: deck.transport.snapshot(now).position }); this._stopDeck(deck);
    this.masterId = this._masterAt(now); this._follow(this._when());
    this._notify(); return this.snapshot(id);
  }

  seek(id, seconds) {
    if (this.disposed) return this.snapshot(id);
    const deck = this._deck(id), now = this._now(), when = this._when();
    this.masterId = this._masterAt(now);
    if (deck.sync && this.masterId !== id) { deck.sync = false; deck.syncError = null; }
    this._commit(deck, { position: clamp(seconds, 0, deck.buffer?.duration ?? 0) }, when, now);
    if (this.masterId === id) this._follow(when);
    this._notify(); return this.snapshot(id);
  }

  setQuantize(id, enabled) {
    if (this.disposed) return this.snapshot(id);
    this._deck(id).quantize = Boolean(enabled);
    this._notify(); return this.snapshot(id);
  }

  _actionState(id, needsGrid = false) {
    const deck = this._deck(id), now = this._now();
    if (!deck.buffer) throw new Error("Load a track before using cue or loop actions.");
    if (needsGrid && !deck.grid.bpm) throw new Error("Analyze this track or enter its BPM before using beat actions.");
    // A prepared Sync launch keeps its later, quantized start. Repeated actions
    // compose against one pending destination rather than growing an event queue.
    const when = Math.max(now + this._lead(), deck.transport.pending?.time ?? now);
    return { deck, now, when, state: deck.transport.projected(when, now) };
  }

  _actionCommit({ deck, now, when }, changes, { preserveSync, relativePosition = false }) {
    this.masterId = this._masterAt(now);
    this._commit(deck, changes, when, now, relativePosition);
    if (!preserveSync && deck.sync && this.masterId !== deck.id) { deck.sync = false; deck.syncError = null; }
    if (deck.sync && !this._beatLoop(deck, now)) this._syncFailure(deck, "A free-length loop overrides beat Sync.", false);
    if (this.masterId === deck.id) this._follow(when);
    this._notify(); return this.snapshot(deck.id);
  }

  triggerCue(id, time) {
    if (this.disposed) return this.snapshot(id);
    const action = this._actionState(id), { deck, state } = action;
    if (!Number.isFinite(time) || time < 0 || time > state.duration) throw new RangeError("This cue lies outside the track.");
    const quantized = deck.quantize && Boolean(deck.grid.bpm);
    const position = quantized && state.playing ? quantizedPosition(time, state.position, deck.grid, state.duration) : time;
    if (position === null) throw new RangeError("This track has no playable point at the current beat phase.");
    // Cue recall outside a loop exits it atomically; inside it keeps the loop.
    const loop = state.loop && position >= state.loop.start && position < state.loop.end ? state.loop : null;
    return this._actionCommit(action, { position, loop }, { preserveSync: quantized,
      relativePosition: quantized && state.playing });
  }

  triggerLoop(id, range) {
    if (this.disposed) return this.snapshot(id);
    const action = this._actionState(id), { deck, state } = action;
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 ||
      range.end > state.duration || range.end - range.start < 0.05) throw new RangeError("A saved loop needs at least 50 ms within the track.");
    const loop = { start: range.start, end: range.end };
    const quantized = deck.quantize && Boolean(deck.grid.bpm);
    const aligned = quantized && state.playing ? quantizedPosition(loop.start, state.position, deck.grid, state.duration, loop) : null;
    // A sub-beat/free loop may contain no point with the current full-beat
    // phase. It still recalls exactly, but cannot promise persistent beat Sync.
    const position = aligned ?? loop.start;
    return this._actionCommit(action, { position, loop }, { preserveSync: quantized && wholeBeatLoop(loop, deck.grid),
      relativePosition: aligned !== null });
  }

  beatJump(id, beats) {
    if (this.disposed) return this.snapshot(id);
    const action = this._actionState(id, true), { deck, state } = action;
    if (!Number.isInteger(beats) || !beats || Math.abs(beats) > 32) throw new RangeError("Choose a whole-beat jump from 1 to 32 beats in either direction.");
    const position = beatJumpPosition(state.position, beats, deck.grid, state.duration);
    if (position === null) throw new RangeError("That beat jump would leave the track.");
    const loop = state.loop && position >= state.loop.start && position < state.loop.end ? state.loop : null;
    return this._actionCommit(action, { position, loop }, { preserveSync: true, relativePosition: true });
  }

  moveLoop(id, beats) {
    if (this.disposed) return this.snapshot(id);
    const action = this._actionState(id, true), { deck, state } = action;
    if (!state.loop) throw new Error("Activate a loop before moving it.");
    if (!Number.isInteger(beats) || !beats || Math.abs(beats) > 32) throw new RangeError("Move a loop by 1 to 32 whole beats in either direction.");
    const loop = shiftedLoop(state.loop, beats, deck.grid, state.duration);
    if (!loop) throw new RangeError("That loop move would leave the track.");
    let position = state.position;
    if (position >= state.loop.start && position < state.loop.end) position += beats * 60 / deck.grid.bpm;
    else if (position >= loop.end) position = quantizedPosition(loop.start, state.position, deck.grid, state.duration, loop) ?? loop.start;
    return this._actionCommit(action, { loop, position }, { preserveSync: wholeBeatLoop(loop, deck.grid), relativePosition: true });
  }

  resizeLoop(id, factor) {
    if (this.disposed) return this.snapshot(id);
    const action = this._actionState(id, true), { deck, state } = action;
    if (!state.loop) throw new Error("Activate a loop before changing its size.");
    if (![0.5, 2].includes(factor)) throw new RangeError("A loop can be halved or doubled.");
    const loop = resizedLoop(state.loop, factor, deck.grid, state.duration);
    if (!loop) throw new RangeError("Loop size must stay between ⅛ and 32 beats, at least 50 ms, and inside the track.");
    let position = state.position;
    if (position >= loop.end) position = loop.start + (position - loop.start) % (loop.end - loop.start);
    return this._actionCommit(action, { loop, position }, { preserveSync: wholeBeatLoop(loop, deck.grid), relativePosition: true });
  }

  setRate(id, rate) {
    if (this.disposed) return this.snapshot(id);
    const deck = this._deck(id), now = this._now(), when = this._when();
    this.masterId = this._masterAt(now);
    if (deck.sync && this.masterId !== id) { deck.sync = false; deck.syncError = null; }
    this._commit(deck, { rate: clamp(rate, MIN_RATE, MAX_RATE, 1) }, when, now);
    if (this.masterId === id) this._follow(when);
    this._notify(); return this.snapshot(id);
  }

  setLoop(id, start, end) {
    if (this.disposed) return this.snapshot(id);
    const deck = this._deck(id), now = this._now(), when = this._when();
    const loop = normalizeLoop(start, end, deck.buffer?.duration ?? 0);
    const changes = { loop };
    if (loop && deck.transport.snapshot(when).position >= loop.end) changes.position = loop.start;
    if (loop && deck.sync && deck.grid.bpm) {
      const beats = (loop.end - loop.start) * deck.grid.bpm / 60;
      if (Math.abs(beats - Math.round(beats)) > 1e-4) this._syncFailure(deck, "A free-length loop overrides beat Sync.", false);
    }
    this._commit(deck, changes, when, now);
    if (deck.sync || this._masterAt(now) === id) this._follow(when);
    this._notify(); return this.snapshot(id);
  }
  clearLoop(id) { return this.setLoop(id, 0, 0); }

  async setKeyLock(id, enabled) {
    if (this.disposed) return false;
    const deck = this._deck(id); deck.keyLock = Boolean(enabled); this._notify();
    try {
      if (deck.keyLock && this.graph) await this._prepareStretch(deck);
      if (!this.disposed) {
        const now = this._now(), when = this._when();
        if (deck.transport.pendingPositionOffset !== null && deck.transport.pending?.time > now && deck.transport.pending.time < when) {
          // Increasing DSP lead replaces the not-yet-audible command as well as
          // its render source; the model must move to that same output boundary.
          this._commit(deck, {}, when, now);
          if (deck.sync || this._masterAt(now) === id) this._follow(when);
        } else this._render(deck, when);
      }
      return deck.keyLock;
    } catch (error) {
      deck.keyLock = false; this._render(deck); this._notify();
      throw error;
    }
  }

  _applyMix(deck, immediate = false) {
    if (!deck.graph) return;
    const now = this.context.currentTime;
    const set = (param, value) => { if (immediate) param.value = value; else smooth(param, value, now); };
    const [a, b] = crossfadeGains(this.crossfader);
    set(deck.graph.fader.gain, deck.gain * (deck.id === "a" ? a : b));
    set(deck.graph.cueSend.gain, deck.cue ? 0.7 : 0);
    for (const band of ["low", "mid", "high"]) set(deck.graph[band].gain, deck.eq[band]);
    set(deck.graph.highpass.frequency, deck.filter > 0 ? 20 * (6000 / 20) ** deck.filter : 0);
    set(deck.graph.lowpass.frequency, deck.filter < 0 ? 20_000 * (120 / 20_000) ** -deck.filter : this.context.sampleRate / 2);
  }

  setGain(id, value) { const deck = this._deck(id); deck.gain = clamp(value, 0, 1, 0.8); this._applyMix(deck); }
  setEQ(id, band, value) {
    const deck = this._deck(id);
    if (!(band in deck.eq)) throw new Error(`Unknown EQ band: ${band}`);
    deck.eq[band] = clamp(value, -24, 12, 0); this._applyMix(deck);
  }
  setFilter(id, value) { const deck = this._deck(id); deck.filter = clamp(value, -1, 1, 0); this._applyMix(deck); }
  setCrossfader(value) { this.crossfader = clamp(value, -1, 1, 0); Object.values(this.decks).forEach(deck => this._applyMix(deck)); }
  setMaster(value) { this.masterLevel = clamp(value, 0, 1, 0.7); if (this.graph) smooth(this.graph.master.gain, this.masterLevel * 0.7, this.context.currentTime); }
  setCue(id, value) { const deck = this._deck(id); deck.cue = Boolean(value); this._applyMix(deck); }
  setCueLevel(value) { this.cueLevel = clamp(value, 0, 1, 0.6); if (this.graph) smooth(this.graph.cue.gain, this.cueLevel * 0.7, this.context.currentTime); }
  setRouting(value) {
    if (!["stereo", "split"].includes(value)) throw new Error("Choose stereo or split output routing.");
    this.routing = value;
    if (!this.graph) return;
    smooth(this.graph.stereo.gain, value === "stereo" ? 1 : 0, this.context.currentTime);
    smooth(this.graph.split.gain, value === "split" ? 1 : 0, this.context.currentTime);
  }

  async dispose() {
    if (this.disposed) return;
    this._switchClock(false); this.disposed = true; this.armed = false; this.requestedAudio = false; ++this.audioGeneration;
    this.release?.(); this.release = null;
    for (const deck of Object.values(this.decks)) {
      ++deck.generation; this._stopDeck(deck, true);
      for (const voice of deck.retiring) { disconnect(voice.node); disconnect(voice.gain); }
      deck.retiring.clear();
      disconnect(deck.stretch); deck.stretch?.port?.close(); deck.stretch = null;
      if (deck.graph) Object.values(deck.graph).forEach(disconnect);
      deck.graph = null; deck.buffer = deck.stretchBuffer = null;
    }
    if (this.graph) Object.values(this.graph).forEach(disconnect);
    this.graph = null;
    const context = this.context; this.context = null;
    context?.removeEventListener?.("statechange", this.handleContextState);
    await context?.close().catch(() => {});
  }
}
