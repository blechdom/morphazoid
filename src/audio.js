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
 */

const DEFAULT_VOICE_COUNT = 32;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const MAX_RANGE_OCTAVES = 10;

const FREQUENCY_TIME_CONSTANT = 0.018;
const ACTIVE_GAIN_TIME_CONSTANT = 0.003;
const RELEASE_TIME_CONSTANT = 0.025;
const PAN_TIME_CONSTANT = 0.025;
const MASTER_TIME_CONSTANT = 0.03;
const STRIKE_GAIN_FLOOR = 0.0001;

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

/** Transfer a normalized mark through a display/audio mapping curve. */
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
  accent = 0.75,
  decay = 0.65,
) {
  const amount = clamp(accent, 0, 1);
  const decayAmount = clamp(decay, 0, 1);
  const distance = clamp(distanceIntoEdge, 0, 1);
  const envelope = Math.exp(-7 * decayAmount * distance);
  const floor = 0.12 + (0.006 - 0.12) * decayAmount;
  const sustain = floor + (0.12 - floor) * envelope;
  return sustain + 0.34 * amount * clamp(cornerStrength, 0, 1) * envelope;
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
    /** @type {{oscillator: OscillatorNode, gain: GainNode, pan: StereoPannerNode, key: string|null}[]} */
    this.voices = [];
    /** @type {Set<{oscillator: OscillatorNode, gain: GainNode, pan: StereoPannerNode, startedAt: number, attackEndsAt: number, endedAt: number, peakGain: number}>} */
    this.activeStrikes = new Set();
    /** @type {Map<string, {oscillator: OscillatorNode, gain: GainNode, pan: StereoPannerNode, startedAt: number, attackEndsAt: number, endedAt: number, peakGain: number}>} */
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
    if (context.state === "suspended") await context.resume();
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
   * Fire a one-shot attack/decay transient on the shared output bus. Unlike
   * the sustained pool, a strike cannot linger merely because a playhead is
   * parked on a corner.
   * @param {VoiceSpec} spec
   * @param {{attackSeconds?: number, decaySeconds?: number, startDelaySeconds?: number}} [envelope]
   */
  strike(spec, {
    attackSeconds = 0.004,
    decaySeconds = 0.08,
    startDelaySeconds = 0,
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
    if (key) {
      this.lastStrikeAtByKey.set(key, startAt);
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const pan = context.createStereoPanner();
    const attack = clamp(attackSeconds, 0.0005, 0.03);
    const decay = clamp(decaySeconds, 0.015, 2);
    const end = startAt + attack + decay;
    const peakGain = Math.max(STRIKE_GAIN_FLOOR, voice.gain);

    oscillator.type = waveformForIndex(voice.waveform, this.activeStrikes.size);
    oscillator.frequency.setValueAtTime(voice.frequency, startAt);
    pan.pan.setValueAtTime(voice.pan ?? 0, startAt);
    gain.gain.setValueAtTime(STRIKE_GAIN_FLOOR, startAt);
    gain.gain.exponentialRampToValueAtTime(peakGain, startAt + attack);
    gain.gain.exponentialRampToValueAtTime(STRIKE_GAIN_FLOOR, end);
    oscillator.connect(gain).connect(pan).connect(this.master);

    const strike = {
      oscillator,
      gain,
      pan,
      startedAt: startAt,
      attackEndsAt: startAt + attack,
      endedAt: end,
      peakGain,
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
    };
    oscillator.start(startAt);
    oscillator.stop(end + 0.02);
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

      if (now <= strike.attackEndsAt) {
        occupied += strike.peakGain;
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
        strike.oscillator.stop(now + 0.03);
      } catch {
        // A strike that has already ended needs no further cleanup.
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
    }
    this.activeStrikes.clear();
    this.activeStrikeByKey.clear();
    this.lastStrikeAtByKey.clear();
    this.master?.disconnect();
    this.compressor?.disconnect();
    this.resetGraph();

    if (context && context.state !== "closed") await context.close();
  }

  resetGraph() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.voices = [];
    this.activeStrikes.clear();
    this.activeStrikeByKey.clear();
    this.lastStrikeAtByKey.clear();
  }
}
