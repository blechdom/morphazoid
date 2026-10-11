import SignalsmithStretch from "../../../vendor/signalsmith-stretch/SignalsmithStretch.mjs";
import { connectAudioOutput } from "../../audio-output-manager.js";
import { DeckTransport, clamp, crossfadeGains } from "./transport.js";

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
 * Native playback is the low-latency default; key lock uses vendored MIT Signalsmith.
 * Signalsmith's buffer mode compensates its own latency. Commands are scheduled
 * latency + 12 ms ahead with the transport projected to that output time. The
 * snapshot describes the requested timeline immediately; audible key-lock edits
 * arrive after that lead (usually about 100 ms), never add latency to inputTime.
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
    now = wallTime,
  } = {}) {
    this.onError = onError; this.onChange = onChange;
    this.contextFactory = contextFactory; this.stretchFactory = stretchFactory;
    this.outputConnector = outputConnector; this.wallTime = now;
    this.context = null; this.armed = false; this.requestedAudio = false; this.disposed = false;
    this.audioGeneration = 0; this.clockIsAudio = false;
    this.master = 0.7; this.crossfader = 0; this.cueLevel = 0.6; this.routing = "stereo";
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
      keyLock: false, gain: 0.8, eq: { low: 0, mid: 0, high: 0 }, filter: 0,
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
  snapshot(id) { const deck = this._deck(id); return { ...deck.transport.snapshot(this._now()), keyLock: deck.keyLock }; }

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
    const master = this._gain(this.master * 0.7);
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
        await Promise.all(Object.values(this.decks).filter(deck => deck.keyLock && deck.buffer).map(deck => this._prepareStretch(deck)));
        if (attempt !== this.audioGeneration || this.disposed) {
          if (!this.requestedAudio && context.state === "running") await context.suspend().catch(() => {});
          return false;
        }
        if (globalThis.document?.hidden) { this.requestedAudio = false; await context.suspend().catch(() => {}); return false; }
        this._switchClock(true); this.armed = true;
        // Meter/record the stereo master, even while hardware output is split cue.
        this.release ??= this.outputConnector(context, this.graph.output, { stereoSource: this.graph.masterArm });
        for (const deck of Object.values(this.decks)) this._render(deck);
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

  _stopDeck(deck, immediate = false) {
    const now = this.context?.currentTime ?? 0;
    this._stopNative(deck, now, immediate);
    if (deck.graph) smooth(deck.graph.stretchGain.gain, 0, now, immediate ? 0 : FADE);
    if (deck.stretch) {
      void deck.stretch.schedule({ active: false, output: now }).catch(error => this._error(error));
    }
  }

  _render(deck) {
    if (this.disposed || !this.armed || !deck.buffer || !deck.graph) return;
    const context = this.context; const now = context.currentTime;
    const state = deck.transport.snapshot(now);
    if (!state.playing) { this._stopDeck(deck); return; }
    const useStretch = deck.keyLock && deck.stretch && deck.stretchBuffer === deck.buffer;
    const when = now + (useStretch ? deck.latency + FADE : FADE);
    const projected = deck.transport.snapshot(when);
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
    const voice = { node: source, gain }; deck.source = voice;
    source.onended = () => {
      disconnect(source); disconnect(gain); deck.retiring.delete(voice);
      if (deck.source === voice) { deck.source = null; this._notify(); }
    };
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(1, when + FADE);
    source.start(when, projected.position);
  }

  _transport(id, operation, ...args) {
    if (this.disposed) return this.snapshot(id);
    const deck = this._deck(id); deck.transport[operation](...args, this._now());
    this._render(deck); this._notify(); return this.snapshot(id);
  }
  play(id) { return this._transport(id, "play"); }
  pause(id) { return this._transport(id, "pause"); }
  seek(id, seconds) { return this._transport(id, "seek", seconds); }
  setRate(id, rate) { return this._transport(id, "setRate", rate); }
  setLoop(id, start, end) { return this._transport(id, "setLoop", start, end); }
  clearLoop(id) { return this._transport(id, "clearLoop"); }

  async setKeyLock(id, enabled) {
    if (this.disposed) return false;
    const deck = this._deck(id); deck.keyLock = Boolean(enabled); this._notify();
    try {
      if (deck.keyLock && this.graph) await this._prepareStretch(deck);
      if (!this.disposed) this._render(deck);
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
  setMaster(value) { this.master = clamp(value, 0, 1, 0.7); if (this.graph) smooth(this.graph.master.gain, this.master * 0.7, this.context.currentTime); }
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
