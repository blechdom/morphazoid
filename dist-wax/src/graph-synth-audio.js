import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const MAX_ACTIVE_VOICES = 64;
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
    frequency: clamp(candidate.frequency, MIN_FREQUENCY, MAX_FREQUENCY, 220),
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
      this.#buildGraph(context);
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
    const input = context.createGain();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor?.() ?? context.createGain();
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
    this.releaseAudioOutput = connectAudioOutput(context, compressor, {
      runtime: this.runtime,
    });
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
    const voice = sanitizeVoice(spec);
    if (voice.gain <= 0) return Object.freeze({ ...voice, scheduled: false });
    const context = await this.start();
    if (context !== this.context || context.state === "closed") {
      throw cancelledAudioStart();
    }

    const now = finite(context.currentTime, 0);
    this.#pruneVoices(now);
    while (this.activeVoices.size >= MAX_ACTIVE_VOICES) {
      const oldest = this.activeVoices.values().next().value;
      if (!oldest) break;
      this.#cancelVoice(oldest, now, true);
    }

    const requestedStart = Number(startAt);
    const startsAt = startAt === undefined || startAt === null || !Number.isFinite(requestedStart)
      ? now
      : Math.max(now, requestedStart);
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
    const amplitude = context.createGain();
    const filter = context.createBiquadFilter();
    const panner = typeof context.createStereoPanner === "function"
      ? context.createStereoPanner()
      : null;
    const sources = [];
    const nodes = [amplitude, filter, panner].filter(Boolean);
    let record = null;

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

    try {
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
      if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) continue;
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
    this.context = null;
    if (context && context.state !== "closed" && typeof context.close === "function") {
      await context.close();
    }
  }
}
