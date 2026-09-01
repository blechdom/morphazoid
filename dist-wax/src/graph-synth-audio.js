import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const FREQUENCY_RANGE_EPSILON = 1e-12;
export const MAX_GRAPH_SYNTH_ACTIVE_VOICES = 64;
export const MAX_GRAPH_SYNTH_LIVE_SOURCES = 256;
export const MAX_GRAPH_SYNTH_SOURCE_STARTS_PER_SECOND = 512;
export const MAX_GRAPH_SYNTH_SOURCE_START_BURST = 256;
const SILENCE_FLOOR = 0.0001;
const SILENCE_FADE_SECONDS = 0.025;
const SOURCE_STOP_PADDING = 0.012;
const WAVEFORMS = new Set(["sine", "triangle", "sawtooth", "square"]);
const MODES = new Set(["sine", "fm", "pm", "shepard"]);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.min(maximum, Math.max(minimum, finite(value, fallback)));
}

function requestedVoiceFrequency(source = {}) {
  if (source?.frequency === undefined) return 220;
  return Number(source.frequency);
}

function frequencyIsInRenderBand(frequency) {
  return Number.isFinite(frequency)
    && frequency >= MIN_FREQUENCY * (1 - FREQUENCY_RANGE_EPSILON)
    && frequency <= MAX_FREQUENCY * (1 + FREQUENCY_RANGE_EPSILON);
}

function voiceFrequencyIsRenderable(source = {}) {
  if (source?.inAudibleRange === false || source?.frequencyInRange === false) return false;
  const frequency = requestedVoiceFrequency(source);
  if (!Number.isFinite(frequency) || frequency <= 0) return false;
  if (source?.mode !== "shepard") {
    return frequencyIsInRenderBand(frequency);
  }
  const width = Math.round(clamp(source.shepardWidth, 3, 7, 5));
  const center = (width - 1) * 0.5;
  return Array.from({ length: width }, (_, index) => (
    frequency * 2 ** (index - center)
  )).some(frequencyIsInRenderBand);
}

function cancelledAudioStart() {
  const error = new Error("Graph Synth audio start was cancelled.");
  error.name = "AbortError";
  return error;
}

function safeConnect(source, destination) {
  try {
    source?.connect?.(destination);
  } catch {
    // A partially constructed voice can still be safely discarded.
  }
  return destination;
}

function safeDisconnect(node) {
  try {
    node?.disconnect?.();
  } catch {
    // Closing an AudioContext may already have detached the node.
  }
}

function setParam(parameter, method, value, time, extra) {
  if (!parameter || typeof parameter[method] !== "function") return;
  try {
    if (extra === undefined) parameter[method](value, time);
    else parameter[method](value, time, extra);
  } catch {
    // A browser may reject automation on a node which ended concurrently.
  }
}

function cancelParam(parameter, time, value = 0) {
  if (!parameter) return;
  try {
    parameter.cancelScheduledValues?.(time);
    parameter.setValueAtTime?.(value, time);
  } catch {
    // An already-ended parameter needs no cancellation.
  }
}

function sanitizeVoice(source = {}) {
  const candidate = source && typeof source === "object" ? source : {};
  const mode = MODES.has(candidate.mode) ? candidate.mode : "sine";
  const waveform = WAVEFORMS.has(candidate.waveform) ? candidate.waveform : "sine";
  return {
    ...candidate,
    mode,
    waveform,
    frequency: finite(candidate.frequency, 220),
    gain: clamp(candidate.gain ?? candidate.level, 0, 1, 0.28),
    pan: clamp(candidate.pan, -1, 1, 0),
    modulationIndex: clamp(
      candidate.modulationIndex ?? candidate.modIndex,
      0,
      20,
      0,
    ),
    modulationRatio: clamp(
      candidate.modulationRatio ?? candidate.modRatio,
      0.125,
      16,
      1.5,
    ),
    brightness: clamp(candidate.brightness ?? candidate.tone, 0, 1, 0.72),
    filterQ: clamp(candidate.filterQ, 0.1, 18, 0.7),
    shepardWidth: Math.round(clamp(candidate.shepardWidth, 3, 7, 5)),
    shepardRate: clamp(candidate.shepardRate, -4, 4, 0),
  };
}

/** Estimate native source-node cost before allocating any Web Audio nodes. */
export function graphSynthSourceCost(source = {}) {
  if (!voiceFrequencyIsRenderable(source)) return 0;
  const voice = sanitizeVoice(source);
  if (voice.mode === "fm" || voice.mode === "pm") return 2;
  if (voice.mode !== "shepard") return 1;
  const center = (voice.shepardWidth - 1) * 0.5;
  let partials = 0;
  for (let index = 0; index < voice.shepardWidth; index += 1) {
    const frequency = voice.frequency * 2 ** (index - center);
    if (frequencyIsInRenderBand(frequency)) partials += 1;
  }
  return Math.max(1, partials);
}

/** Map the normalized topology brightness to a perceptually useful low-pass. */
function brightnessCutoff(brightness, sampleRate) {
  const high = Math.min(18_000, Math.max(1_000, finite(sampleRate, 48_000) * 0.45));
  const low = Math.min(320, high);
  return low * (high / low) ** clamp(brightness, 0, 1, 0.72);
}

/**
 * Lazy one-shot renderer for the graph instrument. It deliberately owns only
 * native Web Audio nodes: importing this module never constructs an
 * AudioContext, while trigger times remain on the AudioContext clock.
 */
export class GraphSynthAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.input = null;
    this.master = null;
    this.compressor = null;
    this.releaseAudioOutput = null;
    this.output = 0.58;
    this.lifecycleGeneration = 0;
    this.startPromise = null;
    this.activeVoices = new Set();
    this.sourceStartTokens = MAX_GRAPH_SYNTH_SOURCE_START_BURST;
    this.sourceTokenTime = null;
  }

  get activeSourceCount() {
    let count = 0;
    for (const voice of this.activeVoices) count += voice.sourceCost ?? voice.sources?.length ?? 0;
    return count;
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    const promise = this.#startInternal();
    this.startPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.startPromise === promise) this.startPromise = null;
    }
  }

  async #startInternal() {
    const lifecycleGeneration = this.lifecycleGeneration;
    let context = this.context;
    if (!context || context.state === "closed") {
      this.#discardGraph();
      const AudioContextConstructor = this.runtime?.AudioContext
        ?? this.runtime?.webkitAudioContext;
      if (typeof AudioContextConstructor !== "function") {
        throw new Error("Web Audio is not available in this browser.");
      }
      context = new AudioContextConstructor();
      this.context = context;
      this.#resetSourceAdmission(context.currentTime);
      try {
        this.#buildGraph(context);
      } catch (error) {
        this.#discardGraph();
        this.context = null;
        try { await context.close?.(); } catch { /* A failed graph may already be closed. */ }
        throw error;
      }
    }

    if (context.state !== "running") {
      unlockAudioContext(context);
      try {
        await context.resume?.();
      } catch (error) {
        if (
          lifecycleGeneration !== this.lifecycleGeneration
          || context !== this.context
          || context.state === "closed"
        ) throw cancelledAudioStart();
        throw error;
      }
    }
    if (
      lifecycleGeneration !== this.lifecycleGeneration
      || context !== this.context
      || context.state === "closed"
    ) throw cancelledAudioStart();

    this.setOutput(this.output);
    return context;
  }

  #buildGraph(context) {
    let input = null;
    let master = null;
    let compressor = null;
    let releaseAudioOutput = null;
    try {
      input = context.createGain();
      master = context.createGain();
      compressor = context.createDynamicsCompressor?.() ?? context.createGain();
      input.gain.value = 1;
      master.gain.value = this.output;
      if (compressor.threshold) {
        compressor.threshold.value = -10;
        compressor.knee.value = 12;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.002;
        compressor.release.value = 0.14;
      }
      safeConnect(input, master);
      safeConnect(master, compressor);
      releaseAudioOutput = connectAudioOutput(context, compressor, {
        runtime: this.runtime,
      });
    } catch (error) {
      releaseAudioOutput?.();
      safeDisconnect(input);
      safeDisconnect(master);
      safeDisconnect(compressor);
      throw error;
    }

    this.releaseAudioOutput = releaseAudioOutput;
    this.input = input;
    this.master = master;
    this.compressor = compressor;
  }

  #discardGraph() {
    for (const voice of [...this.activeVoices]) this.#cleanupVoice(voice);
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    safeDisconnect(this.input);
    safeDisconnect(this.master);
    safeDisconnect(this.compressor);
    this.input = null;
    this.master = null;
    this.compressor = null;
  }

  setOutput(value) {
    this.output = clamp(value, 0, 1, 0);
    if (!this.context || !this.master) return;
    const now = finite(this.context.currentTime, 0);
    const parameter = this.master.gain;
    try {
      parameter.cancelScheduledValues?.(now);
      if (typeof parameter.setTargetAtTime === "function") {
        parameter.setTargetAtTime(this.output, now, 0.02);
      } else if (typeof parameter.setValueAtTime === "function") {
        parameter.setValueAtTime(this.output, now);
      } else {
        parameter.value = this.output;
      }
    } catch {
      // A closing context will be rebuilt at the next start gesture.
    }
  }

  /**
   * Schedule one graph response. `startAt` is absolute AudioContext time; past
   * requests are clamped to now so delayed JavaScript cannot throw or rewind.
   * A gate, sustain, or release opts into ADSR articulation. Calls which only
   * provide attack and decay retain the original two-stage one-shot envelope.
   */
  async trigger(spec, {
    startAt,
    attackSeconds,
    decaySeconds,
    gateSeconds,
    sustainLevel,
    releaseSeconds,
  } = {}) {
    if (!voiceFrequencyIsRenderable(spec)) {
      return Object.freeze({
        ...(spec && typeof spec === "object" ? spec : {}),
        frequency: requestedVoiceFrequency(spec),
        scheduled: false,
        skipped: true,
        skipReason: "frequency-range",
      });
    }
    let voice = sanitizeVoice(spec);
    if (voice.gain <= 0) return Object.freeze({ ...voice, scheduled: false });
    const context = await this.start();
    if (context !== this.context || context.state === "closed") {
      throw cancelledAudioStart();
    }

    const now = finite(context.currentTime, 0);
    this.#pruneVoices(now);
    const requestedStart = Number(startAt);
    const startsAt = startAt === undefined || startAt === null || !Number.isFinite(requestedStart)
      ? now
      : Math.max(now, requestedStart);
    this.#refillSourceTokens(now);
    let sourceCost = graphSynthSourceCost(voice);
    // Shepard is the only voice whose optional width multiplies native source
    // count. Under pressure, retain the note with a compact three-partial stack
    // before considering an ordinary overload drop.
    if (
      voice.mode === "shepard"
      && voice.shepardWidth > 3
      && this.sourceStartTokens < sourceCost
      && this.sourceStartTokens >= 3
    ) {
      voice = { ...voice, shepardWidth: 3 };
      sourceCost = graphSynthSourceCost(voice);
    }
    if (this.sourceStartTokens < sourceCost) {
      return Object.freeze({
        ...voice,
        startAt: startsAt,
        scheduled: false,
        skipReason: "source-rate-budget",
      });
    }
    const reservation = this.#reserveVoiceSlot(now, startsAt, sourceCost);
    if (!reservation.admitted) {
      return Object.freeze({
        ...voice,
        startAt: startsAt,
        scheduled: false,
        skipReason: reservation.reason,
      });
    }
    this.sourceStartTokens -= sourceCost;
    const attack = clamp(
      attackSeconds ?? spec?.attackSeconds ?? spec?.attack,
      0.0005,
      2,
      0.006,
    );
    const decay = clamp(
      decaySeconds ?? spec?.decaySeconds ?? spec?.decay,
      0.015,
      8,
      0.32,
    );
    const usesAdsrGate = (
      gateSeconds !== undefined
      || sustainLevel !== undefined
      || releaseSeconds !== undefined
      || spec?.gateSeconds !== undefined
      || spec?.gate !== undefined
      || spec?.sustainLevel !== undefined
      || spec?.sustain !== undefined
      || spec?.releaseSeconds !== undefined
      || spec?.release !== undefined
    );
    const requestedGate = usesAdsrGate
      ? clamp(gateSeconds ?? spec?.gateSeconds ?? spec?.gate, 0.0005, 16, 0.45)
      : null;
    const requestedSustain = usesAdsrGate
      ? clamp(sustainLevel ?? spec?.sustainLevel ?? spec?.sustain, 0, 1, 0.65)
      : null;
    const release = usesAdsrGate
      ? clamp(releaseSeconds ?? spec?.releaseSeconds ?? spec?.release, 0.001, 8, 0.18)
      : null;
    let envelopeAttack = attack;
    let envelopeDecay = decay;
    if (usesAdsrGate && envelopeAttack + envelopeDecay > requestedGate) {
      const compression = requestedGate / (envelopeAttack + envelopeDecay);
      envelopeAttack *= compression;
      envelopeDecay *= compression;
    }
    const attackEndsAt = startsAt + envelopeAttack;
    const decayEndsAt = attackEndsAt + envelopeDecay;
    const gateEndsAt = usesAdsrGate ? startsAt + requestedGate : null;
    const releaseEndsAt = usesAdsrGate ? gateEndsAt + release : null;
    const endsAt = usesAdsrGate ? releaseEndsAt : startsAt + attack + decay;
    const stopsAt = endsAt + SOURCE_STOP_PADDING;
    const filterFrequency = brightnessCutoff(voice.brightness, context.sampleRate);
    let amplitude = null;
    let filter = null;
    let panner = null;
    const sources = [];
    const nodes = [];
    let record = null;

    try {
      amplitude = context.createGain();
      nodes.push(amplitude);
      filter = context.createBiquadFilter();
      nodes.push(filter);
      panner = typeof context.createStereoPanner === "function"
        ? context.createStereoPanner()
        : null;
      if (panner) nodes.push(panner);

      filter.type = "lowpass";
      setParam(filter.frequency, "setValueAtTime", filterFrequency, startsAt);
      setParam(filter.Q, "setValueAtTime", voice.filterQ, startsAt);
      setParam(amplitude.gain, "setValueAtTime", SILENCE_FLOOR, startsAt);
      setParam(amplitude.gain, "linearRampToValueAtTime", voice.gain, attackEndsAt);
      if (usesAdsrGate) {
        const sustainGain = Math.max(SILENCE_FLOOR, voice.gain * requestedSustain);
        setParam(amplitude.gain, "exponentialRampToValueAtTime", sustainGain, decayEndsAt);
        setParam(amplitude.gain, "setValueAtTime", sustainGain, gateEndsAt);
        setParam(amplitude.gain, "exponentialRampToValueAtTime", SILENCE_FLOOR, releaseEndsAt);
      } else {
        setParam(amplitude.gain, "exponentialRampToValueAtTime", SILENCE_FLOOR, endsAt);
      }
      setParam(amplitude.gain, "setValueAtTime", 0, stopsAt);
      setParam(panner?.pan, "setValueAtTime", voice.pan, startsAt);

      if (voice.mode === "shepard") {
        this.#buildShepardVoice({
          context,
          voice,
          startsAt,
          endsAt,
          stopsAt,
          filter,
          sources,
          nodes,
        });
      } else {
        this.#buildSingleVoice({
          context,
          voice,
          startsAt,
          endsAt,
          stopsAt,
          filter,
          sources,
          nodes,
        });
      }
      safeConnect(filter, amplitude);
      if (panner) {
        safeConnect(amplitude, panner);
        safeConnect(panner, this.input);
      } else {
        safeConnect(amplitude, this.input);
      }

      const rendered = Object.freeze({
        ...voice,
        attackSeconds: envelopeAttack,
        decaySeconds: envelopeDecay,
        ...(usesAdsrGate ? {
          gateSeconds: requestedGate,
          sustainLevel: requestedSustain,
          releaseSeconds: release,
          gateEndAt: gateEndsAt,
          releaseEndAt: releaseEndsAt,
        } : {}),
        startAt: startsAt,
        endAt: endsAt,
        stopAt: stopsAt,
        filterFrequency,
        scheduled: true,
      });
      record = {
        spec: rendered,
        amplitude,
        filter,
        panner,
        sources,
        nodes,
        pendingSources: new Set(sources),
        startAt: startsAt,
        endAt: endsAt,
        stopAt: stopsAt,
        sourceCost,
        cleaned: false,
      };
      this.activeVoices.add(record);
      for (const source of sources) {
        source.onended = () => {
          record.pendingSources.delete(source);
          if (!record.pendingSources.size) this.#cleanupVoice(record);
        };
        source.start(startsAt);
        source.stop(stopsAt);
      }
      return rendered;
    } catch (error) {
      for (const source of sources) {
        try { source.stop(now); } catch { /* The source may not have started. */ }
      }
      if (record) this.#cleanupVoice(record);
      else for (const node of nodes) safeDisconnect(node);
      throw error;
    }
  }

  #buildSingleVoice({
    context,
    voice,
    startsAt,
    endsAt,
    filter,
    sources,
    nodes,
  }) {
    const carrier = context.createOscillator();
    carrier.type = voice.waveform;
    setParam(carrier.frequency, "setValueAtTime", voice.frequency, startsAt);
    sources.push(carrier);
    nodes.push(carrier);

    if (voice.mode === "fm") {
      const modulator = context.createOscillator();
      const modulation = context.createGain();
      const modulationFrequency = clamp(
        voice.frequency * voice.modulationRatio,
        MIN_FREQUENCY,
        MAX_FREQUENCY,
      );
      modulator.type = "sine";
      setParam(modulator.frequency, "setValueAtTime", modulationFrequency, startsAt);
      setParam(
        modulation.gain,
        "setValueAtTime",
        modulationFrequency * voice.modulationIndex,
        startsAt,
      );
      setParam(modulation.gain, "linearRampToValueAtTime", 0, endsAt);
      safeConnect(modulator, modulation);
      safeConnect(modulation, carrier.frequency);
      sources.push(modulator);
      nodes.push(modulator, modulation);
      safeConnect(carrier, filter);
      return;
    }

    if (voice.mode === "pm" && typeof context.createDelay === "function") {
      const phaseDelay = context.createDelay(0.05);
      const modulator = context.createOscillator();
      const modulation = context.createGain();
      const modulationFrequency = clamp(
        voice.frequency * voice.modulationRatio,
        MIN_FREQUENCY,
        MAX_FREQUENCY,
      );
      const phaseDepth = Math.min(
        0.006,
        voice.modulationIndex / Math.max(1, Math.PI * 2 * voice.frequency),
      );
      modulator.type = "sine";
      setParam(modulator.frequency, "setValueAtTime", modulationFrequency, startsAt);
      setParam(phaseDelay.delayTime, "setValueAtTime", phaseDepth + 0.0001, startsAt);
      setParam(modulation.gain, "setValueAtTime", phaseDepth, startsAt);
      setParam(modulation.gain, "linearRampToValueAtTime", 0, endsAt);
      safeConnect(carrier, phaseDelay);
      safeConnect(phaseDelay, filter);
      safeConnect(modulator, modulation);
      safeConnect(modulation, phaseDelay.delayTime);
      sources.push(modulator);
      nodes.push(phaseDelay, modulator, modulation);
      return;
    }

    // Sine mode, or a PM fallback on a minimal Web Audio host.
    safeConnect(carrier, filter);
  }

  #buildShepardVoice({
    context,
    voice,
    startsAt,
    endsAt,
    filter,
    sources,
    nodes,
  }) {
    const count = voice.shepardWidth;
    const center = (count - 1) * 0.5;
    const weights = [];
    for (let index = 0; index < count; index += 1) {
      const octave = index - center;
      const frequency = voice.frequency * 2 ** octave;
      if (!frequencyIsInRenderBand(frequency)) continue;
      weights.push({ octave, frequency, weight: Math.exp(-0.5 * (octave / 1.25) ** 2) });
    }
    if (!weights.length) weights.push({ octave: 0, frequency: voice.frequency, weight: 1 });
    const normalization = Math.sqrt(weights.reduce((sum, item) => sum + item.weight ** 2, 0));
    const duration = Math.max(0, endsAt - startsAt);
    for (const item of weights) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      oscillator.type = voice.waveform;
      setParam(oscillator.frequency, "setValueAtTime", item.frequency, startsAt);
      if (Math.abs(voice.shepardRate) > 1e-6) {
        const target = clamp(
          item.frequency * 2 ** (voice.shepardRate * duration),
          MIN_FREQUENCY,
          MAX_FREQUENCY,
        );
        setParam(oscillator.frequency, "exponentialRampToValueAtTime", target, endsAt);
      }
      setParam(partialGain.gain, "setValueAtTime", item.weight / normalization, startsAt);
      safeConnect(oscillator, partialGain);
      safeConnect(partialGain, filter);
      sources.push(oscillator);
      nodes.push(oscillator, partialGain);
    }
  }

  #pruneVoices(now) {
    for (const voice of [...this.activeVoices]) {
      if (voice.stopAt <= now) this.#cleanupVoice(voice);
    }
  }

  #reserveVoiceSlot(now, startsAt, sourceCost) {
    while (
      this.activeVoices.size >= MAX_GRAPH_SYNTH_ACTIVE_VOICES
      || this.activeSourceCount + sourceCost > MAX_GRAPH_SYNTH_LIVE_SOURCES
    ) {
      let latestFuture = null;
      for (const voice of this.activeVoices) {
        if (voice.startAt <= now + 1e-6) continue;
        if (!latestFuture || voice.startAt >= latestFuture.startAt) latestFuture = voice;
      }

      if (latestFuture) {
        // Lookahead scheduling arrives in chronological order. Once the pool
        // is full, replacing its earliest pending entries with later events
        // can indefinitely starve every attack before it reaches startAt.
        if (startsAt >= latestFuture.startAt) {
          return {
            admitted: false,
            reason: this.activeVoices.size >= MAX_GRAPH_SYNTH_ACTIVE_VOICES
              ? "voice-budget"
              : "live-source-budget",
          };
        }
        this.#cancelVoice(latestFuture, now, true);
        continue;
      }

      // Hard-stopping a live oscillator at an arbitrary phase creates a click.
      // Once every retained voice has started, thin the excess attack instead;
      // future reservations above are still safe to replace before they sound.
      return {
        admitted: false,
        reason: this.activeVoices.size >= MAX_GRAPH_SYNTH_ACTIVE_VOICES
          ? "voice-budget"
          : "live-source-budget",
      };
    }
    return { admitted: true, reason: null };
  }

  #resetSourceAdmission(now = 0) {
    this.sourceStartTokens = MAX_GRAPH_SYNTH_SOURCE_START_BURST;
    this.sourceTokenTime = finite(now, 0);
  }

  #refillSourceTokens(now) {
    const safeNow = finite(now, 0);
    if (!Number.isFinite(this.sourceTokenTime)) {
      this.#resetSourceAdmission(safeNow);
      return;
    }
    const elapsed = Math.max(0, safeNow - this.sourceTokenTime);
    this.sourceStartTokens = Math.min(
      MAX_GRAPH_SYNTH_SOURCE_START_BURST,
      this.sourceStartTokens + elapsed * MAX_GRAPH_SYNTH_SOURCE_STARTS_PER_SECOND,
    );
    this.sourceTokenTime = safeNow;
  }

  #stopSource(source, at) {
    try {
      source?.stop?.(at);
    } catch {
      // Repeated stop calls are harmless during lifecycle teardown.
    }
  }

  #cancelVoice(voice, now, immediate = false) {
    if (!voice || voice.cleaned) return;
    const future = voice.startAt > now + 1e-6;
    if (future || immediate) {
      cancelParam(voice.amplitude?.gain, now, 0);
      for (const source of voice.sources) this.#stopSource(source, now);
      this.#cleanupVoice(voice);
      return;
    }

    const fadeEnd = Math.min(voice.stopAt, now + SILENCE_FADE_SECONDS);
    const parameter = voice.amplitude?.gain;
    try {
      if (typeof parameter?.cancelAndHoldAtTime === "function") {
        parameter.cancelAndHoldAtTime(now);
      } else {
        parameter?.cancelScheduledValues?.(now);
        parameter?.setValueAtTime?.(
          Math.max(SILENCE_FLOOR, finite(parameter?.value, SILENCE_FLOOR)),
          now,
        );
      }
      parameter?.exponentialRampToValueAtTime?.(SILENCE_FLOOR, fadeEnd);
      parameter?.setValueAtTime?.(0, fadeEnd + 0.003);
    } catch {
      // An already-ended voice can proceed directly to source cleanup.
    }
    const sourceStop = fadeEnd + 0.005;
    for (const source of voice.sources) this.#stopSource(source, sourceStop);
    voice.endAt = fadeEnd;
    voice.stopAt = sourceStop;
  }

  #cleanupVoice(voice) {
    if (!voice || voice.cleaned) return;
    voice.cleaned = true;
    this.activeVoices.delete(voice);
    for (const source of voice.sources ?? []) source.onended = null;
    for (const node of voice.nodes ?? []) safeDisconnect(node);
    voice.pendingSources?.clear?.();
  }

  silence() {
    if (!this.context) {
      for (const voice of [...this.activeVoices]) this.#cleanupVoice(voice);
      return;
    }
    const now = finite(this.context.currentTime, 0);
    for (const voice of [...this.activeVoices]) this.#cancelVoice(voice, now);
  }

  async close() {
    this.lifecycleGeneration += 1;
    this.startPromise = null;
    const context = this.context;
    this.silence();
    for (const voice of [...this.activeVoices]) {
      for (const source of voice.sources) this.#stopSource(source, finite(context?.currentTime, 0));
      this.#cleanupVoice(voice);
    }
    this.#discardGraph();
    this.#resetSourceAdmission(0);
    this.context = null;
    if (context && context.state !== "closed" && typeof context.close === "function") {
      await context.close();
    }
  }
}
