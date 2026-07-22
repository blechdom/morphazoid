/**
 * Lazy browser audio for the geometric instrument. Importing this module does
 * not touch window or construct an AudioContext, so its pure helpers are safe
 * to use during server rendering and in Node tests.
 */

/** @typedef {'sine'|'triangle'|'sawtooth'|'square'|'alternating'} OscillatorChoice */

/**
 * @typedef {object} VoiceSpec
 * @property {string} [key]
 * @property {number} frequency
 * @property {number} gain
 * @property {number} [pan]
 * @property {OscillatorChoice} [waveform]
 * @property {'sine'|'shepard'|'fm'|'pm'} [mode]
 * @property {number} [synthDrive]
 * @property {number} [modulationIndex]
 * @property {number} [modulationRatio]
 * @property {number} [shepardRate]
 * @property {number} [shepardWidth]
 * @property {number|null} [shepardPosition]
 * @property {number|null} [shepardTravel]
 */

const DEFAULT_VOICE_COUNT = 32;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const MAX_RANGE_OCTAVES = 10;
const MAX_SHEPARD_WIDTH = 15;

const FREQUENCY_TIME_CONSTANT = 0.018;
const ACTIVE_GAIN_TIME_CONSTANT = 0.003;
const RELEASE_TIME_CONSTANT = 0.025;
const PAN_TIME_CONSTANT = 0.025;
const MASTER_TIME_CONSTANT = 0.03;
const STRIKE_GAIN_FLOOR = 0.0001;
const PERCUSSION_ENVELOPE_MAX_MS = 4_000;
const ATTACK_NOISE_SECONDS = 0.04;
const CONTINUOUS_SYNTH_MODES = new Set(["sine", "shepard", "fm", "pm"]);

/** @typedef {{x: number, y: number}} AmplitudeEnvelopeNode */

function freezeEnvelopePreset(points) {
  return Object.freeze(points.map((point) => Object.freeze({ ...point })));
}

/**
 * Five-node trigger envelopes for the compact editor. The nodes represent,
 * in order: trigger level, attack peak, decay end, sustain end, and release
 * endpoint. Call amplitudeEnvelopePreset() to get an editable copy.
 */
export const AMPLITUDE_ENVELOPE_PRESETS = Object.freeze({
  pluck: freezeEnvelopePreset([
    { x: 0, y: 0 },
    { x: 0.02, y: 1 },
    { x: 0.06, y: 0.32 },
    { x: 0.1, y: 0.1 },
    { x: 0.16, y: 0 },
  ]),
  note: freezeEnvelopePreset([
    { x: 0, y: 0 },
    { x: 0.06, y: 1 },
    { x: 0.25, y: 0.28 },
    { x: 0.62, y: 0.12 },
    { x: 0.82, y: 0 },
  ]),
  sustain: freezeEnvelopePreset([
    { x: 0, y: 0 },
    { x: 0.1, y: 1 },
    { x: 0.28, y: 0.72 },
    { x: 0.78, y: 0.72 },
    { x: 0.9, y: 0 },
  ]),
  pad: freezeEnvelopePreset([
    { x: 0, y: 0 },
    { x: 0.3, y: 1 },
    { x: 0.58, y: 0.78 },
    { x: 0.82, y: 0.78 },
    { x: 0.95, y: 0 },
  ]),
});

/** Return a fresh, editable copy of a named envelope preset. */
export function amplitudeEnvelopePreset(name = "sustain") {
  const presetName = typeof name === "string" ? name.toLowerCase() : "sustain";
  const preset = AMPLITUDE_ENVELOPE_PRESETS[presetName]
    ?? AMPLITUDE_ENVELOPE_PRESETS.sustain;
  return preset.map((point) => ({ ...point }));
}

/**
 * Convert the compact percussion editor's logarithmic X coordinate to time.
 * log1p/expm1 keep zero exact while leaving enough horizontal space to edit
 * both a 3 ms click and a 4 second pad in the same small graph.
 */
export function percussionEnvelopeTimeMs(editorX) {
  const normalized = clamp(Number.isFinite(editorX) ? editorX : 0, 0, 1);
  return Math.expm1(normalized * Math.log1p(PERCUSSION_ENVELOPE_MAX_MS));
}

/** Convert a percussion envelope time (0-4000 ms) back to editor X. */
export function percussionEnvelopeEditorX(timeMs) {
  const bounded = clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, PERCUSSION_ENVELOPE_MAX_MS);
  return Math.log1p(bounded) / Math.log1p(PERCUSSION_ENVELOPE_MAX_MS);
}

function percussionPreset(times, levels) {
  return freezeEnvelopePreset(times.map((timeMs, index) => ({
    x: percussionEnvelopeEditorX(timeMs),
    y: levels[index],
  })));
}

/**
 * Five-node temporal percussion envelopes: trigger, attack peak, decay level,
 * sustain level/end, and release. X is logarithmic editor space; helpers above
 * convert it to milliseconds for display and Web Audio scheduling.
 */
export const PERCUSSION_ENVELOPE_PRESETS = Object.freeze({
  pluck: percussionPreset([0, 3, 25, 55, 100], [0, 1, 0.28, 0.08, 0]),
  note: percussionPreset([0, 10, 100, 350, 600], [0, 1, 0.55, 0.42, 0]),
  sustain: percussionPreset([0, 30, 180, 900, 1_400], [0, 1, 0.78, 0.78, 0]),
  pad: percussionPreset([0, 350, 900, 2_200, 3_500], [0, 1, 0.84, 0.72, 0]),
});

/** Return a fresh editable copy of a named percussion envelope preset. */
export function percussionEnvelopePreset(name = "pluck") {
  const presetName = typeof name === "string" ? name.toLowerCase() : "pluck";
  const preset = PERCUSSION_ENVELOPE_PRESETS[presetName]
    ?? PERCUSSION_ENVELOPE_PRESETS.pluck;
  return preset.map((point) => ({ ...point }));
}

/**
 * Keep persisted percussion editor state inside its five semantic node roles.
 * Node order is repaired without sorting, so an attack can never become a
 * decay node. Trigger/release stay silent and the attack remains the peak.
 * @param {unknown} points
 * @returns {AmplitudeEnvelopeNode[]}
 */
export function sanitizePercussionEnvelope(points) {
  const source = Array.isArray(points) ? points : [];
  const fallback = PERCUSSION_ENVELOPE_PRESETS.pluck;
  const sanitized = fallback.map((fallbackPoint, index) => {
    const point = source[index];
    return {
      x: point && typeof point === "object" && Number.isFinite(point.x)
        ? clamp(point.x, 0, 1)
        : fallbackPoint.x,
      y: point && typeof point === "object" && Number.isFinite(point.y)
        ? clamp(point.y, 0, 1)
        : fallbackPoint.y,
    };
  });

  sanitized[0].x = 0;
  for (let index = 1; index < sanitized.length; index += 1) {
    sanitized[index].x = Math.max(sanitized[index - 1].x, sanitized[index].x);
  }
  sanitized[0].y = 0;
  sanitized[1].y = 1;
  sanitized[4].y = 0;
  return sanitized;
}

/** Move one percussion node without crossing neighbours or changing anchors. */
export function updatePercussionEnvelopeNode(points, index, changes = {}) {
  const next = sanitizePercussionEnvelope(points);
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next;
  const safeChanges = changes && typeof changes === "object" ? changes : {};
  const current = next[index];
  const lowX = index > 0 ? next[index - 1].x : 0;
  const highX = index < next.length - 1 ? next[index + 1].x : 1;
  next[index] = {
    x: index === 0
      ? 0
      : Number.isFinite(safeChanges.x)
      ? clamp(safeChanges.x, lowX, highX)
      : current.x,
    y: index === 0 || index === 4
      ? 0
      : index === 1
      ? 1
      : Number.isFinite(safeChanges.y)
      ? clamp(safeChanges.y, 0, 1)
      : current.y,
  };
  return next;
}

/**
 * Keep externally supplied editor state inside the five-node contract. Invalid
 * node values fall back to the matching Sustain node; valid nodes are sorted
 * by X so sampling remains deterministic even for malformed persisted input.
 * @param {unknown} points
 * @returns {AmplitudeEnvelopeNode[]}
 */
export function sanitizeAmplitudeEnvelope(points) {
  const source = Array.isArray(points) ? points : [];
  const fallback = AMPLITUDE_ENVELOPE_PRESETS.sustain;
  const sanitized = fallback
    .map((fallbackPoint, index) => {
      const point = source[index];
      const x = point && typeof point === "object" && Number.isFinite(point.x)
        ? clamp(point.x, 0, 1)
        : fallbackPoint.x;
      const y = point && typeof point === "object" && Number.isFinite(point.y)
        ? clamp(point.y, 0, 1)
        : fallbackPoint.y;
      return { x, y, originalIndex: index };
    })
    .sort((a, b) => a.x - b.x || a.originalIndex - b.originalIndex)
    .map(({ x, y }) => ({ x, y }));
  sanitized[0].x = 0;
  return sanitized;
}

/**
 * Move one editor node without allowing it to cross either neighbour.
 * Invalid indices or values leave the sanitized curve unchanged.
 * @param {unknown} points
 * @param {number} index
 * @param {{x?: number, y?: number}} [changes]
 * @returns {AmplitudeEnvelopeNode[]}
 */
export function updateAmplitudeEnvelopeNode(points, index, changes = {}) {
  const next = sanitizeAmplitudeEnvelope(points);
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next;
  const safeChanges = changes && typeof changes === "object" ? changes : {};
  const current = next[index];
  const lowX = index > 0 ? next[index - 1].x : 0;
  const highX = index < next.length - 1 ? next[index + 1].x : 1;
  next[index] = {
    x: index === 0
      ? 0
      : Number.isFinite(safeChanges.x)
      ? clamp(safeChanges.x, lowX, highX)
      : current.x,
    y: Number.isFinite(safeChanges.y)
      ? clamp(safeChanges.y, 0, 1)
      : current.y,
  };
  return next;
}

/**
 * Piecewise-linear envelope sampling. Before the first node its level is held;
 * after the release node its final Y is held through phase 1. A zero endpoint
 * therefore stops, while a non-zero endpoint sustains until the next trigger.
 * @param {number} phase
 * @param {unknown} points
 */
export function sampleAmplitudeEnvelope(phase, points) {
  const envelope = sanitizeAmplitudeEnvelope(points);
  const amount = typeof phase === "number" && !Number.isNaN(phase)
    ? clamp(phase, 0, 1)
    : 0;
  if (amount <= envelope[0].x) return envelope[0].y;

  for (let index = 1; index < envelope.length; index += 1) {
    const left = envelope[index - 1];
    const right = envelope[index];
    if (amount > right.x) continue;
    if (right.x <= left.x) return right.y;
    const progress = (amount - left.x) / (right.x - left.x);
    return left.y + (right.y - left.y) * progress;
  }

  return envelope.at(-1).y;
}

/**
 * Convert local mirrored distance (corner 0 → adjacent midpoint 1) to the
 * envelope phase used by corner Swell. The attack node is the corner peak;
 * decay, sustain, and release then run outward in either direction.
 */
export function mirroredAmplitudeEnvelopePhase(distance, attackPhase = 0) {
  const attack = clamp(Number.isFinite(attackPhase) ? attackPhase : 0, 0, 1);
  return attack + clamp(Number.isFinite(distance) ? distance : 0, 0, 1) * (1 - attack);
}

/** Keep persisted or externally supplied mode names inside the DSP contract. */
export function sanitizeSynthMode(mode) {
  return CONTINUOUS_SYNTH_MODES.has(mode) ? mode : "sine";
}

/**
 * Map one normalized source value to the sound-specific timbre parameter.
 * FM controls frequency-modulation index, PM controls phase depth, and
 * Shepard controls the octave-window width. Sine has no mapped timbre.
 */
export function timbreParametersForMode(mode, amount = 0, {
  fmIndex = 2.5,
  pmIndex = 1.5,
  shepardWidth = 4,
} = {}) {
  const safeMode = sanitizeSynthMode(mode);
  const safeAmount = clamp(amount, 0, 1);
  const maximumShepardWidth = clamp(shepardWidth, 1, MAX_SHEPARD_WIDTH);
  return {
    modulationIndex: safeMode === "fm"
      ? clamp(fmIndex, 0, 20) * safeAmount
      : safeMode === "pm" ? clamp(pmIndex, 0, 12) * safeAmount : 0,
    shepardWidth: safeMode === "shepard"
      ? 1 + (maximumShepardWidth - 1) * safeAmount
      : maximumShepardWidth,
  };
}

/**
 * Turn one normalized timbre source value into the parameters for a single
 * synth patch. Ratios and Shepard motion remain independent of that mapping.
 */
export function synthParametersForMode(mode, drive = 0, {
  fmIndex = 2.5,
  fmRatio = 2,
  pmIndex = 1.5,
  pmRatio = 1,
  shepardRate = 0,
  shepardWidth = 4,
  shepardPosition = null,
} = {}) {
  const safeMode = sanitizeSynthMode(mode);
  const safeDrive = clamp(drive, 0, 1);
  const timbre = timbreParametersForMode(safeMode, safeDrive, {
    fmIndex,
    pmIndex,
    shepardWidth,
  });
  return {
    mode: safeMode,
    synthDrive: safeDrive,
    modulationIndex: timbre.modulationIndex,
    modulationRatio: safeMode === "fm"
      ? clamp(fmRatio, 0.125, 16)
      : safeMode === "pm" ? clamp(pmRatio, 0.125, 16) : 1,
    shepardRate: safeMode === "shepard" ? clamp(shepardRate, -8, 8) : 0,
    shepardWidth: timbre.shepardWidth,
    shepardPosition: safeMode === "shepard" && Number.isFinite(shepardPosition)
      ? ((shepardPosition % 1) + 1) % 1
      : null,
  };
}

/**
 * Clamp a number, accepting reversed bounds and treating NaN as the low bound.
 * @param {number} value
 * @param {number} firstBound
 * @param {number} secondBound
 */
export function clamp(value, firstBound, secondBound) {
  const low = Math.min(firstBound, secondBound);
  const high = Math.max(firstBound, secondBound);
  if (Number.isNaN(value)) return low;
  return Math.min(high, Math.max(low, value));
}

/** Match Web Audio's interpolation between two positive exponential values. */
function exponentialRampValue(start, end, progress) {
  const amount = clamp(progress, 0, 1);
  return start * (end / start) ** amount;
}

/** Transfer a normalized source value through a display/audio response curve. */
export function mapCurve01(value, curve = "linear") {
  const normalized = clamp(value, 0, 1);
  if (curve === "exponential") return normalized ** 2;
  if (curve === "logarithmic") return Math.log1p(9 * normalized) / Math.log(10);
  if (curve === "smooth") return normalized * normalized * (3 - 2 * normalized);
  if (curve === "inverted") return 1 - normalized;
  return normalized;
}

/**
 * Convert normalized pitch to continuous equal-tempered frequency. `baseHz`
 * is the bottom of the range; no scale quantization is performed.
 * @param {number} pitch01
 * @param {number} baseHz
 * @param {number} rangeOctaves
 */
export function pitch01ToFrequency(pitch01, baseHz, rangeOctaves) {
  const pitch = clamp(pitch01, 0, 1);
  const base = clamp(baseHz, MIN_FREQUENCY, MAX_FREQUENCY);
  const octaves = clamp(rangeOctaves, 0, MAX_RANGE_OCTAVES);
  return clamp(base * 2 ** (pitch * octaves), MIN_FREQUENCY, MAX_FREQUENCY);
}

/** Peak of a transient-only corner strike. */
export function cornerStrikePeak(cornerStrength, accent) {
  return 0.75 * clamp(cornerStrength, 0, 1) * clamp(accent, 0, 1);
}

/**
 * Tesselateher's single-voice corner envelope. The floor and corner peak are
 * two amplitudes of the same sine oscillator, never separately mixed layers.
 */
export function sineCornerEnvelopeGain(
  cornerStrength,
  distanceIntoEdge,
  accent = 1,
  decayMilliseconds = 650,
  edgeDurationMilliseconds = 1000,
) {
  const amount = clamp(accent, 0, 1.5);
  const decayMs = clamp(decayMilliseconds, 20, 4000);
  const distance = clamp(distanceIntoEdge, 0, 1);
  const edgeDuration = Math.max(1, Number(edgeDurationMilliseconds) || 0);
  const elapsedMs = distance * edgeDuration;
  const envelope = Number.isFinite(elapsedMs)
    ? Math.exp(-6.9 * elapsedMs / decayMs)
    : distance <= 1e-9 ? 1 : 0;
  const sustain = 0.015 + (0.12 - 0.015) * envelope;
  return clamp(
    sustain + 0.48 * amount * clamp(cornerStrength, 0, 1) * envelope,
    0,
    1,
  );
}

/** Convert the directly labelled articulation controls from ms to seconds. */
export function cornerAttackSeconds(milliseconds) {
  return clamp(milliseconds, 0.5, 30) / 1000;
}

export function cornerDecaySeconds(milliseconds) {
  return clamp(milliseconds, 15, 2000) / 1000;
}

/** A perceptual master taper keeps the useful half of the slider audible. */
export function levelToGain(level) {
  return Math.sqrt(clamp(level, 0, 1));
}

/**
 * Resolve the synthetic `alternating` option to a Web Audio oscillator type.
 * @param {OscillatorChoice} [waveform]
 * @param {number} [index]
 * @returns {'sine'|'triangle'|'sawtooth'|'square'}
 */
export function waveformForIndex(waveform = "sine", index = 0) {
  if (waveform === "alternating") {
    return Math.abs(Math.trunc(index)) % 2 ? "triangle" : "sine";
  }
  return waveform;
}

/** @param {VoiceSpec} voice @returns {VoiceSpec} */
function sanitizeVoice(voice) {
  return {
    key: typeof voice.key === "string" ? voice.key : undefined,
    frequency: clamp(voice.frequency, MIN_FREQUENCY, MAX_FREQUENCY),
    gain: clamp(voice.gain, 0, 1),
    pan: clamp(voice.pan ?? 0, -1, 1),
    waveform: voice.waveform ?? "sine",
    mode: sanitizeSynthMode(voice.mode),
    synthDrive: clamp(voice.synthDrive ?? 0, 0, 1),
    modulationIndex: clamp(voice.modulationIndex ?? 0, 0, 20),
    modulationRatio: clamp(voice.modulationRatio ?? 1, 0.125, 16),
    shepardRate: clamp(voice.shepardRate ?? 0, -8, 8),
    shepardWidth: clamp(voice.shepardWidth ?? 4, 1, MAX_SHEPARD_WIDTH),
    shepardPosition: Number.isFinite(voice.shepardPosition)
      ? ((voice.shepardPosition % 1) + 1) % 1
      : null,
    shepardTravel: Number.isFinite(voice.shepardTravel)
      ? voice.shepardTravel
      : null,
  };
}

/**
 * Keep the strongest contacts when geometry produces more voices than the pool
 * can render, then restore their original spatial/order relationship.
 * @param {readonly VoiceSpec[]} voices
 * @param {number} [maxVoices]
 * @returns {VoiceSpec[]}
 */
export function reduceVoiceContacts(voices, maxVoices = DEFAULT_VOICE_COUNT) {
  const limit = Math.max(
    0,
    Math.trunc(Number.isFinite(maxVoices) ? maxVoices : 0),
  );
  if (limit === 0) return [];

  const indexed = voices.map((voice, index) => ({
    voice: sanitizeVoice(voice),
    index,
  }));
  if (indexed.length <= limit) return indexed.map(({ voice }) => voice);

  return indexed
    .sort((a, b) => b.voice.gain - a.voice.gain || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map(({ voice }) => voice);
}

/**
 * Limit combined root-sum-square gain. Dense contact clouds stay near the same
 * perceived level, while quiet input is never boosted.
 * @param {readonly VoiceSpec[]} voices
 * @param {number} [maxCombinedGain]
 * @returns {VoiceSpec[]}
 */
export function normalizeVoiceGains(voices, maxCombinedGain = 1) {
  const sanitized = voices.map(sanitizeVoice);
  const ceiling = clamp(maxCombinedGain, 0, 1);
  const combined = Math.sqrt(
    sanitized.reduce((sum, voice) => sum + voice.gain ** 2, 0),
  );
  const scale = combined > ceiling && combined > 0 ? ceiling / combined : 1;
  return sanitized.map((voice) => ({ ...voice, gain: voice.gain * scale }));
}

/**
 * Give each Shape contact its own voice while keeping larger playhead groups
 * near the same perceived energy. Only finite positive gains count as audible;
 * the supplied voice objects and array are never modified.
 * @param {readonly VoiceSpec[]} voices
 * @returns {VoiceSpec[]}
 */
export function scaleShapeVoiceGains(voices) {
  if (!Array.isArray(voices)) return [];
  const audibleCount = voices.reduce(
    (count, voice) => count
      + (Number.isFinite(voice?.gain) && voice.gain > 0 ? 1 : 0),
    0,
  );
  const scale = audibleCount > 0 ? 1 / Math.sqrt(audibleCount) : 1;
  return voices.map((voice) => ({
    ...voice,
    gain: Number.isFinite(voice?.gain) ? voice.gain * scale : voice?.gain,
  }));
}

/**
 * Bound a synchronous transient batch by its worst-case phase-aligned peak.
 * Unlike sustained voices, fresh oscillators begin in phase, so an L1 ceiling
 * prevents a multi-head corner hit from overloading the shared bus.
 */
export function normalizeStrikeGains(voices, maxPeakSum = 0.78) {
  const sanitized = voices.map(sanitizeVoice);
  const ceiling = clamp(maxPeakSum, 0, 1);
  const peakSum = sanitized.reduce((sum, voice) => sum + voice.gain, 0);
  const scale = peakSum > ceiling && peakSum > 0 ? ceiling / peakSum : 1;
  return sanitized.map((voice) => ({ ...voice, gain: voice.gain * scale }));
}

/** Fixed-size, click-safe oscillator pool for animation-frame updates. */
export class VoicePool {
  /** @param {number} [size] */
  constructor(size = DEFAULT_VOICE_COUNT) {
    this.size = Math.max(
      0,
      Math.min(
        128,
        Math.trunc(Number.isFinite(size) ? size : DEFAULT_VOICE_COUNT),
      ),
    );

    /** @type {AudioContext|null} */
    this.context = null;
    /** @type {GainNode|null} */
    this.master = null;
    /** @type {DynamicsCompressorNode|null} */
    this.compressor = null;
    /** @type {AudioWorkletNode|null} */
    this.synthNode = null;
    this.workletUnavailable = false;
    /** @type {AudioBuffer|null} */
    this.attackNoiseBuffer = null;
    /** @type {{oscillator: OscillatorNode, gain: GainNode, pan: StereoPannerNode, key: string|null}[]} */
    this.voices = [];
    /** @type {Set<{oscillator: OscillatorNode, gain: GainNode, pan: StereoPannerNode, noiseSource?: AudioBufferSourceNode|null, noiseGain?: GainNode|null, noiseEndsAt?: number, startedAt: number, attackEndsAt: number, endedAt: number, peakGain: number, envelopeLevels?: {time: number, gain: number}[]|null}>} */
    this.activeStrikes = new Set();
    /** @type {Map<string, {oscillator: OscillatorNode, gain: GainNode, pan: StereoPannerNode, noiseSource?: AudioBufferSourceNode|null, noiseGain?: GainNode|null, noiseEndsAt?: number, startedAt: number, attackEndsAt: number, endedAt: number, peakGain: number, envelopeLevels?: {time: number, gain: number}[]|null}>} */
    this.activeStrikeByKey = new Map();
    /** @type {Map<string, number>} */
    this.lastStrikeAtByKey = new Map();
    this.desiredLevel = 0.5;
    this.enabled = false;
    /** @type {Promise<void>|null} */
    this.startPromise = null;
    /** @type {VoiceSpec[]} */
    this.pendingVoices = [];
  }

  get running() {
    return this.enabled && this.context?.state === "running";
  }

  get isEnabled() {
    return this.enabled;
  }

  get activeStrikeCount() {
    return this.activeStrikes.size;
  }

  /** Create/resume Web Audio after a user gesture and unmute the master bus. */
  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  /** Alias for start(), for an explicit audio on/off UI. */
  async enable() {
    await this.start();
  }

  async startInternal() {
    if (!this.context) this.buildGraph();
    if (!this.context || !this.master) {
      throw new Error("Web Audio could not be initialized.");
    }

    let context = this.context;
    if (context.state === "closed") {
      this.resetGraph();
      this.buildGraph();
      if (!this.context || !this.master) {
        throw new Error("Web Audio could not be reinitialized.");
      }
      context = this.context;
    }
    // iOS Safari requires resume() to be invoked synchronously inside the
    // original tap. Loading an AudioWorklet first can consume that activation.
    if (context.state !== "running") await context.resume();
    await this.prepareContinuousSynth(context);
    if (context.state !== "running" && context.state !== "closed") await context.resume();
    if (this.context !== context || !this.master || context.state === "closed") {
      throw new Error("Audio start was interrupted.");
    }

    this.enabled = true;
    this.master.gain.setTargetAtTime(
      levelToGain(this.desiredLevel),
      context.currentTime,
      MASTER_TIME_CONSTANT,
    );
    this.applyVoices(this.pendingVoices);
  }

  async prepareContinuousSynth(context) {
    if (this.synthNode || this.workletUnavailable) return;
    const audioGlobal = /** @type {any} */ (globalThis);
    const AudioWorkletNodeConstructor = audioGlobal.AudioWorkletNode;
    if (!context.audioWorklet?.addModule || !AudioWorkletNodeConstructor) {
      this.workletUnavailable = true;
      return;
    }

    try {
      await context.audioWorklet.addModule(
        new URL("./contour-synth-processor.js", import.meta.url),
      );
      if (this.context !== context || !this.master || context.state === "closed") return;
      const synthNode = new AudioWorkletNodeConstructor(
        context,
        "morphazoid-contour-synth",
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { maxVoices: this.size },
        },
      );
      synthNode.connect(this.master);
      synthNode.onprocessorerror = () => {
        synthNode.disconnect();
        if (this.synthNode === synthNode) this.synthNode = null;
        this.workletUnavailable = true;
        if (this.enabled) this.applyVoices(this.pendingVoices);
      };
      this.synthNode = synthNode;
    } catch {
      // The native sine pool below is a safe fallback for older Web Audio hosts.
      this.workletUnavailable = true;
    }
  }

  buildGraph() {
    // Deliberately resolved here, never at module load.
    const audioGlobal = /** @type {any} */ (globalThis);
    const AudioContextConstructor =
      audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("Web Audio is not available in this environment.");
    }

    /** @type {AudioContext} */
    const context = new AudioContextConstructor();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();

    master.gain.value = 0;
    compressor.threshold.value = -4;
    compressor.knee.value = 6;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.12;
    master.connect(compressor).connect(context.destination);

    const voices = [];
    for (let index = 0; index < this.size; index += 1) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const pan = context.createStereoPanner();

      oscillator.type = "sine";
      oscillator.frequency.value = 220;
      gain.gain.value = 0;
      pan.pan.value = 0;
      oscillator.connect(gain).connect(pan).connect(master);
      oscillator.start();
      voices.push({ oscillator, gain, pan, key: null });
    }

    this.context = context;
    this.master = master;
    this.compressor = compressor;
    this.voices = voices;
  }

  /** @param {number} level */
  setLevel(level) {
    this.desiredLevel = clamp(level, 0, 1);
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(
      this.enabled ? levelToGain(this.desiredLevel) : 0,
      this.context.currentTime,
      MASTER_TIME_CONSTANT,
    );
  }

  /**
   * Steer the oscillator pool; excess contacts are reduced and gains normalized.
   * @param {readonly VoiceSpec[]} voices
   */
  setVoices(voices) {
    const reduced = reduceVoiceContacts(voices, this.size);
    this.pendingVoices = normalizeVoiceGains(reduced);
    if (this.enabled) this.applyVoices(this.pendingVoices);
  }

  /**
   * Send the render-thread synth a short geometry trajectory. The worklet
   * interpolates it sample by sample, so a delayed paint does not freeze FM,
   * pitch, or pan at the last visual frame. Native Web Audio fallback keeps
   * using the current targets and remains click-smoothed.
   * @param {readonly VoiceSpec[]} voices
   * @param {readonly VoiceSpec[]} nextVoices
   * @param {number} durationSeconds
   */
  setVoiceTrajectory(voices, nextVoices, durationSeconds = 0.075) {
    const current = normalizeVoiceGains(reduceVoiceContacts(voices, this.size));
    const future = normalizeVoiceGains(reduceVoiceContacts(nextVoices, this.size));
    this.pendingVoices = current;
    if (!this.enabled) return;
    if (!this.synthNode) {
      this.applyVoices(current);
      return;
    }
    this.synthNode.port.postMessage({
      type: "voices",
      voices: current,
      nextVoices: future,
      durationSeconds: clamp(durationSeconds, 0.01, 0.25),
    });
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.voices) {
      voice.key = null;
      voice.gain.gain.setTargetAtTime(0, now, RELEASE_TIME_CONSTANT);
    }
  }

  /** Build one short reusable white-noise buffer for percussion attacks. */
  attackNoiseBufferForContext() {
    if (this.attackNoiseBuffer) return this.attackNoiseBuffer;
    const context = this.context;
    if (!context || typeof context.createBuffer !== "function") return null;
    try {
      const sampleRate = clamp(
        Number.isFinite(context.sampleRate) ? context.sampleRate : 48_000,
        8_000,
        192_000,
      );
      const buffer = context.createBuffer(
        1,
        Math.max(1, Math.ceil(sampleRate * ATTACK_NOISE_SECONDS)),
        sampleRate,
      );
      if (!buffer || typeof buffer.getChannelData !== "function") return null;
      const samples = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = Math.random() * 2 - 1;
      }
      this.attackNoiseBuffer = buffer;
      return buffer;
    } catch {
      return null;
    }
  }

  /**
   * Fire a one-shot attack/decay transient on the shared output bus. Unlike
   * the sustained pool, a strike cannot linger merely because a playhead is
   * parked on a corner.
   * @param {VoiceSpec} spec
   * @param {{attackSeconds?: number, decaySeconds?: number, envelopePoints?: unknown, attackNoise?: number, startDelaySeconds?: number, retriggerMode?: "overlap"|"crossfade"|"ignore", crossfadeSeconds?: number}} [envelope]
   */
  strike(spec, {
    attackSeconds = 0.004,
    decaySeconds = 0.08,
    envelopePoints,
    attackNoise = 0,
    startDelaySeconds = 0,
    retriggerMode = "overlap",
    crossfadeSeconds = 0.012,
  } = {}) {
    if (!this.enabled || !this.context || !this.master) return false;
    if (this.activeStrikes.size >= 128) return false;
    const voice = sanitizeVoice(spec);
    if (voice.gain <= STRIKE_GAIN_FLOOR) return false;

    const context = this.context;
    const now = context.currentTime;
    const startAt = now + clamp(startDelaySeconds, 0, 0.05);
    const key = voice.key;
    const previousStart = key ? this.lastStrikeAtByKey.get(key) : undefined;
    if (previousStart !== undefined && startAt - previousStart < 0.012) return false;
    const previousStrike = key ? this.activeStrikeByKey.get(key) : null;
    if (previousStrike && startAt < previousStrike.endedAt) {
      if (retriggerMode === "ignore") return false;
      if (retriggerMode === "crossfade") {
        const fadeDuration = clamp(crossfadeSeconds, 0.006, 0.04);
        const fadeEnd = startAt + fadeDuration;
        try {
          const parameter = previousStrike.gain.gain;
          if (typeof parameter.cancelAndHoldAtTime === "function") {
            parameter.cancelAndHoldAtTime(startAt);
            parameter.exponentialRampToValueAtTime(STRIKE_GAIN_FLOOR, fadeEnd);
          } else {
            parameter.cancelScheduledValues(startAt);
            parameter.setTargetAtTime(STRIKE_GAIN_FLOOR, startAt, fadeDuration / 4);
          }
        } catch {
          // The previous tone may have ended between lookup and reschedule.
        }
        if (previousStrike.noiseGain) {
          try {
            const noiseParameter = previousStrike.noiseGain.gain;
            noiseParameter.cancelScheduledValues(startAt);
            noiseParameter.setTargetAtTime(0, startAt, fadeDuration / 4);
          } catch {
            // An already-ended noise burst needs no fade.
          }
        }
        try {
          previousStrike.oscillator.stop(fadeEnd + 0.005);
        } catch {
          // Already stopped.
        }
        try {
          previousStrike.noiseSource?.stop(fadeEnd + 0.005);
        } catch {
          // Already stopped.
        }
        previousStrike.endedAt = fadeEnd;
      }
    }
    if (key) {
      this.lastStrikeAtByKey.set(key, startAt);
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const pan = context.createStereoPanner();
    const peakGain = Math.max(STRIKE_GAIN_FLOOR, voice.gain);
    const percussionEnvelope = envelopePoints === undefined
      ? null
      : sanitizePercussionEnvelope(envelopePoints);
    const envelopeTimes = percussionEnvelope?.map((point) =>
      percussionEnvelopeTimeMs(point.x) / 1_000
    ) ?? null;
    const attack = percussionEnvelope
      ? envelopeTimes[1]
      : clamp(attackSeconds, 0.0005, 0.03);
    const decay = percussionEnvelope
      ? Math.max(0, envelopeTimes[4] - attack)
      : clamp(decaySeconds, 0.015, 2);
    const end = startAt + Math.max(0.0005, attack + decay);

    let noiseSource = null;
    let noiseGain = null;
    let noisePeak = 0;
    const requestedNoise = clamp(Number.isFinite(attackNoise) ? attackNoise : 0, 0, 1);
    if (
      requestedNoise > 0
      && typeof context.createBufferSource === "function"
      && typeof context.createGain === "function"
    ) {
      const buffer = this.attackNoiseBufferForContext();
      if (buffer) {
        try {
          noiseSource = context.createBufferSource();
          noiseGain = context.createGain();
          if (
            !noiseSource
            || typeof noiseSource.connect !== "function"
            || typeof noiseSource.start !== "function"
            || typeof noiseSource.stop !== "function"
            || !noiseGain?.gain
            || typeof noiseGain.gain.setValueAtTime !== "function"
            || typeof noiseGain.gain.linearRampToValueAtTime !== "function"
          ) {
            throw new Error("Attack noise nodes are incomplete.");
          }
          noiseSource.buffer = buffer;
          noisePeak = Math.min(
            peakGain - STRIKE_GAIN_FLOOR,
            peakGain * 0.45 * requestedNoise,
          );
          if (noisePeak <= 0) {
            noiseSource = null;
            noiseGain = null;
            noisePeak = 0;
          }
        } catch {
          try {
            noiseSource?.disconnect();
            noiseGain?.disconnect();
          } catch {
            // Partially constructed fallback nodes can be discarded.
          }
          noiseSource = null;
          noiseGain = null;
          noisePeak = 0;
        }
      }
    }
    const tonePeak = peakGain - noisePeak;

    oscillator.type = waveformForIndex(voice.waveform, this.activeStrikes.size);
    oscillator.frequency.setValueAtTime(voice.frequency, startAt);
    pan.pan.setValueAtTime(voice.pan ?? 0, startAt);
    gain.gain.setValueAtTime(STRIKE_GAIN_FLOOR, startAt);
    if (percussionEnvelope && envelopeTimes) {
      let previousTime = startAt;
      for (let index = 1; index < percussionEnvelope.length; index += 1) {
        const at = startAt + envelopeTimes[index];
        const target = Math.max(
          STRIKE_GAIN_FLOOR,
          tonePeak * percussionEnvelope[index].y,
        );
        if (at <= previousTime) gain.gain.setValueAtTime(target, at);
        else gain.gain.exponentialRampToValueAtTime(target, at);
        previousTime = at;
      }
    } else {
      // Preserve the original two-ramp envelope exactly for callers on other
      // pages that still provide attackSeconds/decaySeconds.
      gain.gain.exponentialRampToValueAtTime(tonePeak, startAt + attack);
      gain.gain.exponentialRampToValueAtTime(STRIKE_GAIN_FLOOR, end);
    }
    gain.gain.setValueAtTime(0, end + 0.008);
    oscillator.connect(gain).connect(pan).connect(this.master);

    let noiseEndsAt = startAt;
    if (noiseSource && noiseGain && noisePeak > 0) {
      const duration = Math.min(ATTACK_NOISE_SECONDS, end - startAt);
      const noiseAttack = Math.min(
        duration,
        0.008,
        Math.max(0.001, duration * 0.2),
      );
      noiseEndsAt = startAt + duration;
      noiseGain.gain.setValueAtTime(0, startAt);
      noiseGain.gain.linearRampToValueAtTime(noisePeak, startAt + noiseAttack);
      noiseGain.gain.linearRampToValueAtTime(0, startAt + duration);
      noiseSource.connect(noiseGain).connect(pan);
      noiseSource.onended = () => {
        noiseSource.disconnect();
        noiseGain.disconnect();
      };
      noiseSource.start(startAt);
      noiseSource.stop(startAt + duration + 0.005);
    }

    const strike = {
      oscillator,
      gain,
      pan,
      noiseSource,
      noiseGain,
      noiseEndsAt,
      startedAt: startAt,
      attackEndsAt: startAt + attack,
      endedAt: end,
      peakGain,
      envelopeLevels: percussionEnvelope && envelopeTimes
        ? percussionEnvelope.map((point, index) => ({
            time: startAt + envelopeTimes[index],
            gain: Math.max(STRIKE_GAIN_FLOOR, tonePeak * point.y),
          }))
        : null,
    };
    this.activeStrikes.add(strike);
    if (key) this.activeStrikeByKey.set(key, strike);
    oscillator.onended = () => {
      this.activeStrikes.delete(strike);
      if (key && this.activeStrikeByKey.get(key) === strike) {
        this.activeStrikeByKey.delete(key);
      }
      oscillator.disconnect();
      gain.disconnect();
      pan.disconnect();
      noiseSource?.disconnect();
      noiseGain?.disconnect();
    };
    oscillator.start(startAt);
    oscillator.stop(end + 0.012);
    return true;
  }

  /**
   * Return the phase-aligned peak budget not currently occupied by one-shot
   * envelopes. Scheduled and attacking strikes conservatively reserve their
   * full eventual peak so adjacent animation frames cannot overbook delayed
   * hits. Completed envelopes are ignored even if their oscillator's
   * `onended` callback has not run yet.
   * @param {number} [maxPeakSum]
   */
  availableStrikeHeadroom(maxPeakSum = 0.78) {
    const ceiling = clamp(maxPeakSum, 0, 1);
    if (!this.context) return ceiling;

    const now = this.context.currentTime;
    let occupied = 0;
    for (const strike of this.activeStrikes) {
      if (now >= strike.endedAt) continue;

      if (now <= strike.attackEndsAt || now < (strike.noiseEndsAt ?? strike.startedAt)) {
        occupied += strike.peakGain;
      } else if (strike.envelopeLevels) {
        const levels = strike.envelopeLevels;
        let currentGain = levels.at(-1)?.gain ?? STRIKE_GAIN_FLOOR;
        for (let index = 1; index < levels.length; index += 1) {
          const left = levels[index - 1];
          const right = levels[index];
          if (now > right.time) continue;
          if (right.time <= left.time) currentGain = right.gain;
          else {
            currentGain = exponentialRampValue(
              Math.max(STRIKE_GAIN_FLOOR, left.gain),
              Math.max(STRIKE_GAIN_FLOOR, right.gain),
              (now - left.time) / (right.time - left.time),
            );
          }
          break;
        }
        occupied += currentGain;
      } else {
        const decayDuration = strike.endedAt - strike.attackEndsAt;
        const progress = decayDuration > 0
          ? clamp((now - strike.attackEndsAt) / decayDuration, 0, 1)
          : 1;
        occupied += exponentialRampValue(
          strike.peakGain,
          STRIKE_GAIN_FLOOR,
          progress,
        );
      }

      if (occupied >= ceiling) return 0;
    }
    return Math.max(0, ceiling - occupied);
  }

  /** @param {readonly VoiceSpec[]} specs */
  applyVoices(specs) {
    if (!this.context) return;
    const now = this.context.currentTime;

    const sanitized = specs.map((spec, index) => ({
      ...sanitizeVoice(spec),
      key: typeof spec.key === "string" ? spec.key : `index:${index}`,
    }));

    if (this.synthNode) {
      this.synthNode.port.postMessage({ type: "voices", voices: sanitized });
      for (const voice of this.voices) {
        voice.key = null;
        voice.gain.gain.setTargetAtTime(0, now, RELEASE_TIME_CONSTANT);
      }
      return;
    }
    const byKey = new Map(this.voices.map((voice, index) => [voice.key, index]));
    const assignments = new Array(this.voices.length).fill(null);
    const assignedSlots = new Set();
    const pending = [];

    for (const spec of sanitized) {
      const slot = byKey.get(spec.key);
      if (slot === undefined || assignedSlots.has(slot)) pending.push(spec);
      else {
        assignments[slot] = spec;
        assignedSlots.add(slot);
      }
    }

    const freeSlots = this.voices
      .map((_, index) => index)
      .filter((index) => !assignedSlots.has(index));
    pending.forEach((spec, index) => {
      const slot = freeSlots[index];
      if (slot !== undefined) assignments[slot] = spec;
    });

    this.voices.forEach((voice, index) => {
      const spec = assignments[index];
      if (!spec) {
        voice.key = null;
        voice.gain.gain.setTargetAtTime(0, now, RELEASE_TIME_CONSTANT);
        return;
      }

      voice.key = spec.key;

      const frequency = clamp(spec.frequency, MIN_FREQUENCY, MAX_FREQUENCY);
      const gain = clamp(spec.gain, 0, 1);
      const pan = clamp(spec.pan ?? 0, -1, 1);
      const waveform = waveformForIndex(spec.waveform, index);

      voice.oscillator.frequency.setTargetAtTime(
        frequency,
        now,
        FREQUENCY_TIME_CONSTANT,
      );
      voice.gain.gain.setTargetAtTime(
        gain,
        now,
        ACTIVE_GAIN_TIME_CONSTANT,
      );
      voice.pan.pan.setTargetAtTime(pan, now, PAN_TIME_CONSTANT);
      if (voice.oscillator.type !== waveform) {
        voice.oscillator.type = waveform;
      }
    });
  }

  /** Fade every oscillator out and clear pending voice state. */
  silence() {
    this.pendingVoices = [];
    this.synthNode?.port.postMessage({ type: "voices", voices: [] });
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      voice.gain.gain.setTargetAtTime(0, now, RELEASE_TIME_CONSTANT);
    }
    for (const strike of this.activeStrikes) {
      try {
        const parameter = strike.gain.gain;
        if (typeof parameter.cancelAndHoldAtTime === "function") {
          parameter.cancelAndHoldAtTime(now);
        } else {
          parameter.cancelScheduledValues(now);
          parameter.setValueAtTime(Math.max(0.0001, parameter.value), now);
        }
        parameter.exponentialRampToValueAtTime(0.0001, now + 0.025);
      } catch {
        // A strike that has already ended needs no further tone fade.
      }
      try {
        strike.oscillator.stop(now + 0.03);
      } catch {
        // Already stopped.
      }
      if (strike.noiseGain) {
        try {
          strike.noiseGain.gain.cancelScheduledValues(now);
          strike.noiseGain.gain.setTargetAtTime(0, now, 0.006);
        } catch {
          // An already-ended noise burst needs no fade.
        }
      }
      try {
        strike.noiseSource?.stop(now + 0.03);
      } catch {
        // Already stopped.
      }
    }
    this.activeStrikeByKey.clear();
    this.lastStrikeAtByKey.clear();
  }

  /** Mute without destroying the graph, so it can be enabled again cheaply. */
  disable() {
    this.enabled = false;
    this.silence();
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(
        0,
        this.context.currentTime,
        MASTER_TIME_CONSTANT,
      );
    }
  }

  /** Stop and release all Web Audio resources. The pool may be started again. */
  async close() {
    const context = this.context;
    this.enabled = false;
    this.pendingVoices = [];

    for (const voice of this.voices) {
      try {
        voice.oscillator.stop();
      } catch {
        // An already-stopped oscillator is harmless during teardown.
      }
      voice.oscillator.disconnect();
      voice.gain.disconnect();
      voice.pan.disconnect();
    }
    for (const strike of this.activeStrikes) {
      try {
        strike.oscillator.stop();
      } catch {
        // Already stopped.
      }
      strike.oscillator.disconnect();
      strike.gain.disconnect();
      strike.pan.disconnect();
      try {
        strike.noiseSource?.stop();
      } catch {
        // Already stopped.
      }
      strike.noiseSource?.disconnect();
      strike.noiseGain?.disconnect();
    }
    this.activeStrikes.clear();
    this.activeStrikeByKey.clear();
    this.lastStrikeAtByKey.clear();
    this.master?.disconnect();
    this.compressor?.disconnect();
    this.synthNode?.disconnect();
    this.resetGraph();

    if (context && context.state !== "closed") await context.close();
  }

  resetGraph() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.synthNode = null;
    this.workletUnavailable = false;
    this.attackNoiseBuffer = null;
    this.voices = [];
    this.activeStrikes.clear();
    this.activeStrikeByKey.clear();
    this.lastStrikeAtByKey.clear();
  }
}
