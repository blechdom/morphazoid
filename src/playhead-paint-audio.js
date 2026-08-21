import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const MAX_SCHEDULE_AHEAD_SECONDS = 2;
const MAX_RELEASE_MS = 10_000;
const MAX_ENVELOPE_STAGE_MS = 5_000;
const OUTPUT_LIMIT = 0.9;
const VOICE_PEAK_CEILING = 0.82;
const PARAMETER_SMOOTHING_SECONDS = 0.016;
const LEVEL_SMOOTHING_SECONDS = 0.018;
const RELEASE_TAIL_SECONDS = 0.02;
const CLEANUP_GRACE_MS = 45;
const VALID_WAVEFORMS = new Set(["sine", "triangle", "sawtooth", "square"]);

export const PLAYHEAD_PAINT_SYMMETRY_VOICE_COUNT = 8;
export const PLAYHEAD_PAINT_DEFAULT_MAX_VOICES = 16;
export const PLAYHEAD_PAINT_HARD_MAX_VOICES = 32;
// Zero-time gain changes expose the arbitrary starting/stopping phase of saw,
// square, and FM voices. These synthesis-only floors leave persisted/editor
// ADSR values untouched while guaranteeing a short ramp at every gate edge.
export const PLAYHEAD_PAINT_DECLICK_ATTACK_MS = 5;
export const PLAYHEAD_PAINT_DECLICK_DECAY_MS = 5;
export const PLAYHEAD_PAINT_DECLICK_RELEASE_MS = 8;

export const DEFAULT_PLAYHEAD_PAINT_ADSR = Object.freeze({
  attackMs: 8,
  decayMs: 90,
  sustain: 0.72,
  releaseMs: 180,
});

export const DEFAULT_PLAYHEAD_PAINT_VOICE = Object.freeze({
  frequency: 220,
  gain: 0.8,
  pan: 0,
  brightness: 0.68,
  waveform: "sine",
  modulationDepth: 0,
  adsr: DEFAULT_PLAYHEAD_PAINT_ADSR,
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeKey(key) {
  if (typeof key !== "string" && typeof key !== "number") {
    throw new TypeError("A Playhead Paint voice key must be a string or number.");
  }
  const normalized = String(key);
  if (!normalized) throw new TypeError("A Playhead Paint voice key cannot be empty.");
  return normalized;
}

function audioStartCancelled() {
  const error = new Error("Playhead Paint audio start was cancelled.");
  error.name = "AbortError";
  return error;
}

function contextConstructor(runtime) {
  return runtime?.AudioContext ?? runtime?.webkitAudioContext;
}

function safeConnect(source, destination) {
  if (typeof source?.connect !== "function" || !destination) return false;
  source.connect(destination);
  return true;
}

function safeDisconnect(node) {
  try { node?.disconnect?.(); } catch { /* already disconnected */ }
}

function safeStop(node, when) {
  try { node?.stop?.(when); } catch { /* already stopped or never started */ }
}

function setParamValue(parameter, value, when) {
  if (!parameter) return;
  if (typeof parameter.setValueAtTime === "function") {
    parameter.setValueAtTime(value, when);
  } else {
    parameter.value = value;
  }
}

function cancelParameter(parameter, when) {
  try { parameter?.cancelScheduledValues?.(when); } catch { /* optional API */ }
}

function smoothParameter(parameter, value, when, timeConstant = PARAMETER_SMOOTHING_SECONDS) {
  if (!parameter) return;
  cancelParameter(parameter, when);
  if (typeof parameter.setTargetAtTime === "function") {
    parameter.setTargetAtTime(value, when, Math.max(0.001, timeConstant));
  } else {
    setParamValue(parameter, value, when);
  }
}

function rampParameter(parameter, value, when) {
  if (!parameter) return;
  if (typeof parameter.linearRampToValueAtTime === "function") {
    parameter.linearRampToValueAtTime(value, when);
  } else {
    setParamValue(parameter, value, when);
  }
}

function holdParameter(parameter, value, when) {
  if (!parameter) return;
  if (typeof parameter.cancelAndHoldAtTime === "function") {
    try {
      parameter.cancelAndHoldAtTime(when);
      return;
    } catch {
      // Fall through for older Web Audio implementations and test doubles.
    }
  }
  cancelParameter(parameter, when);
  setParamValue(parameter, value, when);
}

function requestedWhen(options) {
  if (Number.isFinite(options)) return Number(options);
  return Number.isFinite(options?.when) ? Number(options.when) : null;
}

function scheduleTime(context, options) {
  const now = Math.max(0, finite(context?.currentTime, 0));
  const requested = requestedWhen(options);
  return requested === null
    ? now
    : clamp(requested, now, now + MAX_SCHEDULE_AHEAD_SECONDS);
}

function cutoffForBrightness(brightness) {
  return 160 * ((18_000 / 160) ** clamp(brightness, 0, 1));
}

function modulationFrequency(spec) {
  return clamp(
    spec.frequency * (1.5 + spec.brightness * 2.01),
    MIN_FREQUENCY,
    MAX_FREQUENCY,
  );
}

function modulationAmount(spec) {
  return clamp(spec.frequency * spec.modulationDepth * 0.38, 0, 6_000);
}

function deClickEnvelopeTiming(adsr) {
  const attackSeconds = Math.max(
    finite(adsr?.attackMs, 0),
    PLAYHEAD_PAINT_DECLICK_ATTACK_MS,
  ) / 1_000;
  const decaySeconds = Math.abs(finite(adsr?.sustain, 1) - 1) > 1e-6
    ? Math.max(
      finite(adsr?.decayMs, 0),
      PLAYHEAD_PAINT_DECLICK_DECAY_MS,
    ) / 1_000
    : 0;
  return { attackSeconds, decaySeconds };
}

function flatAdsr(source) {
  if (!source || typeof source !== "object") return null;
  if (
    source.attackMs === undefined
    && source.decayMs === undefined
    && source.sustain === undefined
    && source.releaseMs === undefined
  ) return null;
  return {
    attackMs: source.attackMs,
    decayMs: source.decayMs,
    sustain: source.sustain,
    releaseMs: source.releaseMs,
  };
}

/** Sanitize a note-gated ADSR whose times are expressed in milliseconds. */
export function sanitizePlayheadPaintAdsr(source = {}, fallback = DEFAULT_PLAYHEAD_PAINT_ADSR) {
  const safeSource = source && typeof source === "object" ? source : {};
  const safeFallback = fallback && typeof fallback === "object"
    ? fallback
    : DEFAULT_PLAYHEAD_PAINT_ADSR;
  return {
    attackMs: clamp(
      finite(safeSource.attackMs, finite(safeFallback.attackMs, 8)),
      0,
      MAX_ENVELOPE_STAGE_MS,
    ),
    decayMs: clamp(
      finite(safeSource.decayMs, finite(safeFallback.decayMs, 90)),
      0,
      MAX_ENVELOPE_STAGE_MS,
    ),
    sustain: clamp(
      finite(safeSource.sustain, finite(safeFallback.sustain, 0.72)),
      0,
      1,
    ),
    releaseMs: clamp(
      finite(safeSource.releaseMs, finite(safeFallback.releaseMs, 180)),
      0,
      MAX_RELEASE_MS,
    ),
  };
}

/** Sanitize the continuously updateable properties of one paint voice. */
export function sanitizePlayheadPaintVoice(source = {}, fallback = DEFAULT_PLAYHEAD_PAINT_VOICE) {
  const safeSource = source && typeof source === "object" ? source : {};
  const safeFallback = fallback && typeof fallback === "object"
    ? fallback
    : DEFAULT_PLAYHEAD_PAINT_VOICE;
  const fallbackWaveform = VALID_WAVEFORMS.has(safeFallback.waveform)
    ? safeFallback.waveform
    : "sine";
  const waveform = VALID_WAVEFORMS.has(safeSource.waveform)
    ? safeSource.waveform
    : fallbackWaveform;
  const sourceAdsr = safeSource.adsr ?? flatAdsr(safeSource) ?? {};
  const fallbackAdsr = safeFallback.adsr ?? flatAdsr(safeFallback)
    ?? DEFAULT_PLAYHEAD_PAINT_ADSR;
  return {
    frequency: clamp(
      finite(safeSource.frequency, finite(safeFallback.frequency, 220)),
      MIN_FREQUENCY,
      MAX_FREQUENCY,
    ),
    gain: clamp(finite(safeSource.gain, finite(safeFallback.gain, 0.8)), 0, 1),
    pan: clamp(finite(safeSource.pan, finite(safeFallback.pan, 0)), -1, 1),
    brightness: clamp(
      finite(safeSource.brightness, finite(safeFallback.brightness, 0.68)),
      0,
      1,
    ),
    waveform,
    modulationDepth: clamp(
      finite(
        safeSource.modulationDepth,
        finite(safeFallback.modulationDepth, 0),
      ),
      0,
      1,
    ),
    adsr: sanitizePlayheadPaintAdsr(sourceAdsr, fallbackAdsr),
  };
}

function mergedVoiceSpec(previous, changes) {
  const safeChanges = changes && typeof changes === "object" ? changes : {};
  const changedAdsr = safeChanges.adsr ?? flatAdsr(safeChanges);
  return sanitizePlayheadPaintVoice({
    ...previous,
    ...safeChanges,
    adsr: changedAdsr
      ? { ...previous.adsr, ...changedAdsr }
      : previous.adsr,
  }, previous);
}

/**
 * Native Web Audio synth used by Playhead Paint.
 *
 * Voice keys make pointer, reflection, and loop ownership explicit. All final
 * audio is routed by connectAudioOutput; the engine never connects its mix to
 * destination itself.
 */
export class PlayheadPaintAudio {
  constructor({
    runtime = globalThis,
    maxVoices = PLAYHEAD_PAINT_DEFAULT_MAX_VOICES,
    level = 0.72,
  } = {}) {
    this.runtime = runtime;
    this.maxVoices = clamp(
      Math.trunc(finite(maxVoices, PLAYHEAD_PAINT_DEFAULT_MAX_VOICES)),
      1,
      PLAYHEAD_PAINT_HARD_MAX_VOICES,
    );
    // One additional bounded bank lets every active voice take its de-click
    // release when a whole symmetry group is replaced at once. Active gates
    // never exceed maxVoices and allocated native voices never exceed 2x it.
    this.maxAllocatedVoices = this.maxVoices * 2;
    this.outputLevel = clamp(finite(level, 0.72), 0, OUTPUT_LIMIT);
    this.context = null;
    this.voiceBus = null;
    this.master = null;
    this.releaseAudioOutput = null;
    this.activeVoices = new Map();
    this.pendingVoices = new Map();
    this.voices = new Set();
    this.lifecycleGeneration = 0;
    this.requestSerial = 0;
    this.startPromise = null;
  }

  get running() {
    return Boolean(this.context && this.context.state === "running");
  }

  get activeVoiceCount() {
    return this.activeVoices.size;
  }

  get allocatedVoiceCount() {
    return this.voices.size;
  }

  get currentTime() {
    return Math.max(0, finite(this.context?.currentTime, 0));
  }

  async start() {
    if (this.context?.state === "running" && this.master && this.voiceBus) {
      return this.context;
    }
    if (this.startPromise) return this.startPromise;
    const generation = this.lifecycleGeneration;
    const promise = this.#startAudio(generation);
    this.startPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.startPromise === promise) this.startPromise = null;
    }
  }

  async #startAudio(generation) {
    let context = this.context;
    if (!context || context.state === "closed" || !this.master || !this.voiceBus) {
      context = await this.#buildGraph(generation);
    }
    if (
      generation !== this.lifecycleGeneration
      || context !== this.context
      || context.state === "closed"
    ) throw audioStartCancelled();

    unlockAudioContext(context);
    if (context.state !== "running" && typeof context.resume === "function") {
      await context.resume();
    }
    if (
      generation !== this.lifecycleGeneration
      || context !== this.context
      || context.state === "closed"
    ) throw audioStartCancelled();
    if (typeof context.state === "string" && context.state !== "running") {
      throw new Error("The audio context could not enter its running state.");
    }
    return context;
  }

  async #buildGraph(generation) {
    const Context = contextConstructor(this.runtime);
    if (typeof Context !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }

    const previousNow = Math.max(0, finite(this.context?.currentTime, 0));
    for (const voice of [...this.voices]) this.#disposeVoiceNow(voice, previousNow);
    this.activeVoices.clear();
    this.voices.clear();
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    safeDisconnect(this.voiceBus);
    safeDisconnect(this.master);
    this.voiceBus = null;
    this.master = null;
    this.context = null;
    const context = new Context({ latencyHint: "interactive" });
    this.context = context;
    try {
      const voiceBus = typeof context.createDynamicsCompressor === "function"
        ? context.createDynamicsCompressor()
        : context.createGain();
      if (voiceBus.threshold) voiceBus.threshold.value = -16;
      if (voiceBus.knee) voiceBus.knee.value = 12;
      if (voiceBus.ratio) voiceBus.ratio.value = 8;
      if (voiceBus.attack) voiceBus.attack.value = 0.002;
      if (voiceBus.release) voiceBus.release.value = 0.16;

      const master = context.createGain();
      master.gain.value = this.outputLevel;
      safeConnect(voiceBus, master);
      const releaseAudioOutput = connectAudioOutput(context, master, {
        runtime: this.runtime,
      });

      if (
        generation !== this.lifecycleGeneration
        || context !== this.context
        || context.state === "closed"
      ) {
        releaseAudioOutput();
        throw audioStartCancelled();
      }
      this.voiceBus = voiceBus;
      this.master = master;
      this.releaseAudioOutput = releaseAudioOutput;
      return context;
    } catch (error) {
      if (this.context === context) this.#resetGraph();
      if (context.state !== "closed") {
        try { await context.close?.(); } catch { /* initialization failed */ }
      }
      throw error;
    }
  }

  /**
   * Gate on a keyed voice. `when` is absolute AudioContext time and is intended
   * for short look-ahead scheduling. Returns false if noteOff/panic cancelled a
   * pending audio start before a voice could be created.
   */
  async noteOn(key, sourceSpec = {}, options = {}) {
    const voiceKey = normalizeKey(key);
    const request = {
      id: ++this.requestSerial,
      spec: sanitizePlayheadPaintVoice(sourceSpec),
      when: requestedWhen(options),
      updates: [],
      noteOff: null,
    };
    this.pendingVoices.set(voiceKey, request);

    let context;
    try {
      context = await this.start();
    } catch (error) {
      if (this.pendingVoices.get(voiceKey) === request) {
        this.pendingVoices.delete(voiceKey);
      }
      throw error;
    }
    if (this.pendingVoices.get(voiceKey) !== request) return false;
    this.pendingVoices.delete(voiceKey);
    if (context !== this.context || context.state === "closed") return false;

    const when = scheduleTime(context, request.when);
    const existing = this.activeVoices.get(voiceKey);
    if (existing) this.#releaseVoice(existing, when, 8, true);
    this.#makeVoiceRoom(when);

    const voice = this.#createVoice(voiceKey, request.spec, when);
    this.voices.add(voice);
    this.activeVoices.set(voiceKey, voice);
    this.#rebalanceVoiceLevels(when);
    for (const update of request.updates) {
      this.updateVoice(voiceKey, update.changes, { when: update.when });
    }
    if (request.noteOff) {
      const releaseWhen = scheduleTime(context, request.noteOff.when);
      this.#releaseVoice(voice, releaseWhen, request.noteOff.releaseMs);
    }
    return true;
  }

  /** Smoothly update an active or not-yet-created keyed voice. */
  updateVoice(key, changes = {}, options = {}) {
    const voiceKey = normalizeKey(key);
    const pending = this.pendingVoices.get(voiceKey);
    if (pending) {
      const updateWhen = requestedWhen(options);
      if (updateWhen === null) pending.spec = mergedVoiceSpec(pending.spec, changes);
      else pending.updates.push({ changes, when: updateWhen });
      return true;
    }

    const voice = this.activeVoices.get(voiceKey);
    if (!voice || !this.context || voice.finalized) return false;
    const when = scheduleTime(this.context, options);
    voice.spec = mergedVoiceSpec(voice.spec, changes);
    voice.lastTouchedAt = when;
    // OscillatorNode.type is a discrete, non-automatable step. Changing it on
    // a sounding oscillator can discontinuously replace its waveform, so the
    // requested type is retained in spec and applied on the next noteOn.
    smoothParameter(voice.carrier.frequency, voice.spec.frequency, when);
    smoothParameter(
      voice.filter?.frequency,
      cutoffForBrightness(voice.spec.brightness),
      when,
    );
    smoothParameter(voice.panner?.pan, voice.spec.pan, when);
    smoothParameter(
      voice.modulator.frequency,
      modulationFrequency(voice.spec),
      when,
    );
    smoothParameter(
      voice.modulationGain.gain,
      modulationAmount(voice.spec),
      when,
    );
    if (when >= voice.sustainAt && voice.gate) {
      smoothParameter(
        voice.envelope.gain,
        voice.spec.adsr.sustain,
        when,
        0.01,
      );
    }
    this.#rebalanceVoiceLevels(when);
    return true;
  }

  /** Gate off one key, using its noteOn release unless releaseMs overrides it. */
  noteOff(key, options = {}) {
    const voiceKey = normalizeKey(key);
    const pending = this.pendingVoices.get(voiceKey);
    if (pending) {
      const offWhen = requestedWhen(options);
      const onWhen = pending.when;
      const now = this.currentTime;
      if (offWhen !== null && offWhen > Math.max(now, onWhen ?? now)) {
        pending.noteOff = {
          when: offWhen,
          releaseMs: clamp(
            finite(options?.releaseMs, pending.spec.adsr.releaseMs),
            0,
            MAX_RELEASE_MS,
          ),
        };
        return true;
      }
      this.pendingVoices.delete(voiceKey);
    }
    const voice = this.activeVoices.get(voiceKey);
    if (!voice || !this.context) return Boolean(pending);

    const when = scheduleTime(this.context, options);
    const releaseMs = clamp(
      finite(options?.releaseMs, voice.spec.adsr.releaseMs),
      0,
      MAX_RELEASE_MS,
    );
    this.#releaseVoice(voice, when, releaseMs);
    return true;
  }

  /** Release every active, pending, or already-releasing note. */
  panic(options = {}) {
    const pendingCount = this.pendingVoices.size;
    this.pendingVoices.clear();
    if (!this.context) return pendingCount;
    const when = scheduleTime(this.context, options);
    const releaseMs = clamp(finite(options?.releaseMs, 12), 0, 250);
    const voices = [...this.voices];
    for (const voice of voices) this.#releaseVoice(voice, when, releaseMs, true);
    return pendingCount + voices.length;
  }

  setOutput(level, options = {}) {
    this.outputLevel = clamp(finite(level, 0), 0, OUTPUT_LIMIT);
    if (this.master && this.context) {
      smoothParameter(
        this.master.gain,
        this.outputLevel,
        scheduleTime(this.context, options),
        0.02,
      );
    }
    return this.outputLevel;
  }

  async close() {
    this.lifecycleGeneration += 1;
    this.pendingVoices.clear();
    this.startPromise = null;
    const context = this.context;
    const now = Math.max(0, finite(context?.currentTime, 0));

    if (this.master?.gain) {
      cancelParameter(this.master.gain, now);
      setParamValue(this.master.gain, 0, now);
    }
    for (const voice of [...this.voices]) this.#disposeVoiceNow(voice, now);
    this.activeVoices.clear();
    this.voices.clear();
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.#resetGraph();
    if (context && context.state !== "closed" && typeof context.close === "function") {
      try { await context.close(); } catch { /* teardown remains idempotent */ }
    }
  }

  #createVoice(key, spec, when) {
    const context = this.context;
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modulationGain = context.createGain();
    const filter = typeof context.createBiquadFilter === "function"
      ? context.createBiquadFilter()
      : context.createGain();
    const envelope = context.createGain();
    const level = context.createGain();
    const panner = typeof context.createStereoPanner === "function"
      ? context.createStereoPanner()
      : context.createGain();

    carrier.type = spec.waveform;
    modulator.type = "sine";
    setParamValue(carrier.frequency, spec.frequency, when);
    setParamValue(modulator.frequency, modulationFrequency(spec), when);
    setParamValue(modulationGain.gain, modulationAmount(spec), when);
    if (filter.frequency) {
      filter.type = "lowpass";
      setParamValue(filter.frequency, cutoffForBrightness(spec.brightness), when);
      if (filter.Q) setParamValue(filter.Q, 0.707, when);
    }
    setParamValue(envelope.gain, 0, Math.min(this.currentTime, when));
    setParamValue(level.gain, 0, Math.min(this.currentTime, when));
    setParamValue(panner.pan, spec.pan, when);

    safeConnect(modulator, modulationGain);
    safeConnect(modulationGain, carrier.frequency);
    safeConnect(carrier, filter);
    safeConnect(filter, envelope);
    safeConnect(envelope, level);
    safeConnect(level, panner);
    safeConnect(panner, this.voiceBus);

    const { attackSeconds, decaySeconds } = deClickEnvelopeTiming(spec.adsr);
    const voice = {
      key,
      spec,
      carrier,
      modulator,
      modulationGain,
      filter,
      envelope,
      level,
      panner,
      createdAt: this.currentTime,
      startedAt: when,
      attackSeconds,
      decaySeconds,
      sustainAt: when + attackSeconds + decaySeconds,
      lastTouchedAt: when,
      cleanupTimer: null,
      gate: true,
      state: "active",
      finalized: false,
    };

    carrier.onended = () => this.#finalizeVoice(voice);
    try {
      this.#scheduleAttack(voice);
      carrier.start(when);
      modulator.start(when);
    } catch (error) {
      safeStop(carrier, this.currentTime);
      safeStop(modulator, this.currentTime);
      for (const node of [carrier, modulator, modulationGain, filter, envelope, level, panner]) {
        safeDisconnect(node);
      }
      throw error;
    }
    return voice;
  }

  #scheduleAttack(voice) {
    const gain = voice.envelope.gain;
    const { sustain } = voice.spec.adsr;
    const attack = voice.attackSeconds;
    const decay = voice.decaySeconds;
    const start = voice.startedAt;
    cancelParameter(gain, start);
    setParamValue(gain, 0, start);
    rampParameter(gain, 1, start + attack);
    if (decay > 0) rampParameter(gain, sustain, start + attack + decay);
  }

  #envelopeValueAt(voice, when) {
    const elapsed = when - voice.startedAt;
    if (elapsed <= 0) return 0;
    const attack = voice.attackSeconds;
    const decay = voice.decaySeconds;
    if (attack > 0 && elapsed < attack) return clamp(elapsed / attack, 0, 1);
    if (decay > 0 && elapsed < attack + decay) {
      const amount = (elapsed - attack) / decay;
      return 1 + (voice.spec.adsr.sustain - 1) * clamp(amount, 0, 1);
    }
    return voice.spec.adsr.sustain;
  }

  #releaseVoice(voice, when, releaseMs, force = false) {
    if (!voice || voice.finalized || (!voice.gate && !force)) return false;
    voice.gate = false;
    voice.state = "releasing";
    if (this.activeVoices.get(voice.key) === voice) this.activeVoices.delete(voice.key);
    const releaseSeconds = Math.max(
      clamp(finite(releaseMs, voice.spec.adsr.releaseMs), 0, MAX_RELEASE_MS),
      PLAYHEAD_PAINT_DECLICK_RELEASE_MS,
    ) / 1_000;
    const valueAtRelease = this.#envelopeValueAt(voice, when);
    holdParameter(voice.envelope.gain, valueAtRelease, when);
    rampParameter(voice.envelope.gain, 0, when + releaseSeconds);

    const stopAt = Math.max(voice.startedAt, when + releaseSeconds) + RELEASE_TAIL_SECONDS;
    voice.releaseStartedAt = when;
    voice.releaseEndsAt = when + releaseSeconds;
    safeStop(voice.carrier, stopAt);
    safeStop(voice.modulator, stopAt);
    this.#clearCleanupTimer(voice);
    const delayMs = Math.max(0, stopAt - this.currentTime) * 1_000 + CLEANUP_GRACE_MS;
    voice.cleanupTimer = this.#setTimer(() => this.#finalizeVoice(voice), delayMs);
    return true;
  }

  #makeVoiceRoom(when) {
    while (this.activeVoices.size >= this.maxVoices) {
      const candidate = [...this.activeVoices.values()].reduce((oldest, voice) => (
        !oldest || voice.lastTouchedAt < oldest.lastTouchedAt ? voice : oldest
      ), null);
      if (!candidate) return;
      this.#releaseVoice(candidate, when, PLAYHEAD_PAINT_DECLICK_RELEASE_MS, true);
    }

    // Long user releases can accumulate while new gates arrive. Keep native
    // allocation absolutely bounded, preferring the tail nearest silence if a
    // second complete bank has not cleaned itself up yet.
    while (this.voices.size >= this.maxAllocatedVoices) {
      const candidate = [...this.voices]
        .filter(({ state }) => state === "releasing")
        .reduce((nearest, voice) => (
          !nearest
          || finite(voice.releaseEndsAt, Infinity) < finite(nearest.releaseEndsAt, Infinity)
            ? voice
            : nearest
        ), null);
      if (!candidate) return;
      this.#disposeVoiceNow(candidate, when);
    }
  }

  #rebalanceVoiceLevels(when) {
    const voices = [...this.voices].filter(({ finalized }) => !finalized);
    const requestedPeak = voices.reduce((sum, voice) => sum + voice.spec.gain, 0);
    const scale = requestedPeak > VOICE_PEAK_CEILING
      ? VOICE_PEAK_CEILING / requestedPeak
      : 1;
    for (const voice of voices) {
      smoothParameter(
        voice.level.gain,
        voice.spec.gain * scale,
        when,
        LEVEL_SMOOTHING_SECONDS,
      );
    }
  }

  #disposeVoiceNow(voice, when) {
    if (!voice || voice.finalized) return;
    cancelParameter(voice.envelope?.gain, when);
    setParamValue(voice.envelope?.gain, 0, when);
    safeStop(voice.carrier, when);
    safeStop(voice.modulator, when);
    this.#finalizeVoice(voice, false);
  }

  #finalizeVoice(voice, rebalance = true) {
    if (!voice || voice.finalized) return;
    voice.finalized = true;
    voice.state = "finished";
    voice.gate = false;
    this.#clearCleanupTimer(voice);
    if (this.activeVoices.get(voice.key) === voice) this.activeVoices.delete(voice.key);
    this.voices.delete(voice);
    voice.carrier.onended = null;
    for (const node of [
      voice.carrier,
      voice.modulator,
      voice.modulationGain,
      voice.filter,
      voice.envelope,
      voice.level,
      voice.panner,
    ]) safeDisconnect(node);
    if (rebalance && this.context && this.context.state !== "closed") {
      this.#rebalanceVoiceLevels(this.currentTime);
    }
  }

  #setTimer(callback, delayMs) {
    const schedule = typeof this.runtime?.setTimeout === "function"
      ? this.runtime.setTimeout.bind(this.runtime)
      : globalThis.setTimeout?.bind(globalThis);
    if (!schedule) return null;
    const timer = schedule(callback, delayMs);
    timer?.unref?.();
    return timer;
  }

  #clearCleanupTimer(voice) {
    if (voice?.cleanupTimer === null || voice?.cleanupTimer === undefined) return;
    const clear = typeof this.runtime?.clearTimeout === "function"
      ? this.runtime.clearTimeout.bind(this.runtime)
      : globalThis.clearTimeout?.bind(globalThis);
    try { clear?.(voice.cleanupTimer); } catch { /* timer already fired */ }
    voice.cleanupTimer = null;
  }

  #resetGraph() {
    this.context = null;
    this.voiceBus = null;
    this.master = null;
    this.releaseAudioOutput = null;
  }
}
