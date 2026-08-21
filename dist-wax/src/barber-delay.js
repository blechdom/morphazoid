import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const PROCESSOR_NAME = "morphazoid-barber-delay";
const DEFAULT_SAMPLE_RATE = 48_000;
const RENDER_QUANTUM = 128;
const TAU = Math.PI * 2;
const FEEDBACK_BUDGET = 0.95;
const BARBER_RECORD_LINEAR_LIMIT = 16;
const BARBER_RECORD_CEILING = 64;
const SANDY_BUFFER_SECONDS = 16;
const SANDY_STREAM_COUNT = 24;
const SANDY_READ_GUARD_SAMPLES = 1;

export const BARBER_DELAY_PROCESSOR_NAME = PROCESSOR_NAME;

export const BARBER_DELAY_LIMITS = Object.freeze({
  minimumVoices: 1,
  maximumVoices: 12,
  minimumSpeed: 0,
  maximumSpeed: 5,
  minimumRange: 0.1,
  maximumRange: 10,
  minimumPitchOctaves: 0.5,
  maximumPitchOctaves: 10,
  minimumGrainSize: 0.005,
  maximumGrainSize: 0.5,
  minimumFeedbackDelay: 0.001,
  maximumFeedbackDelay: 10,
  minimumSandyHistory: 0.1,
  maximumSandyHistory: 15,
  sandyBufferSeconds: SANDY_BUFFER_SECONDS,
  sandyStreamCount: SANDY_STREAM_COUNT,
  sandyReadGuardSamples: SANDY_READ_GUARD_SAMPLES,
  maximumFeedback: FEEDBACK_BUDGET,
  maximumGlobalFeedback: 0.5,
  maximumInputGain: 2,
  maximumOutputLevel: 1,
});

const CANDY_DEFAULTS = Object.freeze({
  numVoices: 8,
  speed: 0.5,
  range: 2,
  directionUp: true,
  tilt: 0,
  feedback: 0,
  fbDelay: 1,
  globalFeedback: 0,
  dryWet: 0.8,
  inputGain: 1,
  outputLevel: 0.5,
});

const SANDY_DEFAULTS = Object.freeze({
  numVoices: 8,
  speed: 0.05,
  pitchOctaves: 4,
  directionUp: true,
  tilt: 0,
  feedback: 0,
  fbDelay: 4,
  globalFeedback: 0,
  dryWet: 0.8,
  inputGain: 1,
  outputLevel: 0.5,
  grainSize: 0.05,
  blend: 0.5,
});

export const BARBER_DELAY_DEFAULTS = Object.freeze({
  candy: CANDY_DEFAULTS,
  sandy: SANDY_DEFAULTS,
});

export function sanitizeBarberDelayMode(mode) {
  return mode === "sandy" ? "sandy" : "candy";
}

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.min(
    maximum,
    Math.max(minimum, finiteNumber(value, fallback)),
  );
}

/**
 * Convert a normalized range-input position to a physical barber parameter.
 * Morphisma's original controls used power curves to devote more track travel
 * to low speed, short delay, and small grain values.
 */
export function barberDelaySliderValue(
  position,
  minimum,
  maximum,
  curve = 1,
  step = 0,
) {
  const safeMinimum = finiteNumber(minimum, 0);
  const safeMaximum = Math.max(
    safeMinimum,
    finiteNumber(maximum, safeMinimum),
  );
  const safeCurve = Math.max(Number.EPSILON, finiteNumber(curve, 1));
  const normalized = clamp(position, 0, 1, 0);
  const rawValue = safeMinimum + (
    (safeMaximum - safeMinimum) * normalized ** safeCurve
  );
  const safeStep = Math.max(0, finiteNumber(step, 0));
  const value = safeStep > 0
    ? Math.round(rawValue / safeStep) * safeStep
    : rawValue;
  return clamp(value, safeMinimum, safeMaximum, safeMinimum);
}

/**
 * Convert a physical barber parameter back to its normalized thumb position.
 */
export function barberDelaySliderPosition(
  value,
  minimum,
  maximum,
  curve = 1,
) {
  const safeMinimum = finiteNumber(minimum, 0);
  const safeMaximum = Math.max(
    safeMinimum,
    finiteNumber(maximum, safeMinimum),
  );
  const span = safeMaximum - safeMinimum;
  if (span <= 0) return 0;
  const safeCurve = Math.max(Number.EPSILON, finiteNumber(curve, 1));
  const normalized = (
    clamp(value, safeMinimum, safeMaximum, safeMinimum) - safeMinimum
  ) / span;
  return normalized ** (1 / safeCurve);
}

function barberRecordSample(value) {
  const sample = finiteNumber(value, 0);
  const magnitude = Math.abs(sample);
  if (magnitude <= BARBER_RECORD_LINEAR_LIMIT) return sample;
  const shoulder = BARBER_RECORD_CEILING - BARBER_RECORD_LINEAR_LIMIT;
  return Math.sign(sample) * (
    BARBER_RECORD_LINEAR_LIMIT
    + (
      shoulder
      * Math.tanh((magnitude - BARBER_RECORD_LINEAR_LIMIT) / shoulder)
    )
  );
}

export function wrapBarberPhase(value) {
  const phase = finiteNumber(value, 0);
  return ((phase % 1) + 1) % 1;
}

/**
 * Bound both UI and preset values before they cross onto the render thread.
 * Local and wet-bus feedback share a sub-unity user-control budget, reducing
 * runaway risk when both controls are raised. A transparent extreme-only
 * record guard provides the final internal numerical bound after head summing.
 */
export function sanitizeBarberDelayParams(params = {}, mode = "candy") {
  const safeMode = sanitizeBarberDelayMode(mode);
  const defaults = BARBER_DELAY_DEFAULTS[safeMode];
  const isSandy = safeMode === "sandy";
  let feedback = clamp(
    params.feedback,
    0,
    BARBER_DELAY_LIMITS.maximumFeedback,
    defaults.feedback,
  );
  let globalFeedback = clamp(
    params.globalFeedback,
    0,
    BARBER_DELAY_LIMITS.maximumGlobalFeedback,
    defaults.globalFeedback,
  );
  const feedbackTotal = feedback + globalFeedback;
  if (feedbackTotal > FEEDBACK_BUDGET) {
    const normalization = FEEDBACK_BUDGET / feedbackTotal;
    feedback *= normalization;
    globalFeedback *= normalization;
  }

  const shared = {
    numVoices: Math.round(clamp(
      params.numVoices,
      BARBER_DELAY_LIMITS.minimumVoices,
      BARBER_DELAY_LIMITS.maximumVoices,
      defaults.numVoices,
    )),
    speed: clamp(
      params.speed,
      BARBER_DELAY_LIMITS.minimumSpeed,
      BARBER_DELAY_LIMITS.maximumSpeed,
      defaults.speed,
    ),
    directionUp: params.directionUp === undefined
      ? defaults.directionUp
      : Boolean(params.directionUp),
    tilt: clamp(params.tilt, -1, 1, defaults.tilt),
    feedback,
    fbDelay: clamp(
      params.fbDelay,
      isSandy
        ? BARBER_DELAY_LIMITS.minimumSandyHistory
        : BARBER_DELAY_LIMITS.minimumFeedbackDelay,
      isSandy
        ? BARBER_DELAY_LIMITS.maximumSandyHistory
        : BARBER_DELAY_LIMITS.maximumFeedbackDelay,
      defaults.fbDelay,
    ),
    globalFeedback,
    dryWet: clamp(params.dryWet, 0, 1, defaults.dryWet),
    inputGain: clamp(
      params.inputGain,
      0,
      BARBER_DELAY_LIMITS.maximumInputGain,
      defaults.inputGain,
    ),
    outputLevel: clamp(
      params.outputLevel,
      0,
      BARBER_DELAY_LIMITS.maximumOutputLevel,
      defaults.outputLevel,
    ),
  };

  if (isSandy) {
    return Object.freeze({
      ...shared,
      pitchOctaves: clamp(
        params.pitchOctaves,
        BARBER_DELAY_LIMITS.minimumPitchOctaves,
        BARBER_DELAY_LIMITS.maximumPitchOctaves,
        defaults.pitchOctaves,
      ),
      grainSize: clamp(
        params.grainSize,
        BARBER_DELAY_LIMITS.minimumGrainSize,
        BARBER_DELAY_LIMITS.maximumGrainSize,
        defaults.grainSize,
      ),
      blend: clamp(params.blend, 0, 1, defaults.blend),
    });
  }

  return Object.freeze({
    ...shared,
    range: clamp(
      params.range,
      BARBER_DELAY_LIMITS.minimumRange,
      BARBER_DELAY_LIMITS.maximumRange,
      defaults.range,
    ),
  });
}

/**
 * Candy's centered sin² path passes from one side of the source pitch to the
 * other during each turn. Direction chooses which side is heard first.
 */
export function barberDelayCurve(
  mode,
  phase,
  directionUp = true,
) {
  const position = wrapBarberPhase(phase);
  const sine = Math.sin(Math.PI * position);
  const hump = sine * sine;
  return directionUp ? hump : 1 - hump;
}

/**
 * Hann window whose peak can lean earlier or later without changing its
 * bounded 0…1 output. This is the original Morphisma tilt mapping.
 */
export function barberDelayWindow(phase, tilt = 0) {
  const position = wrapBarberPhase(phase);
  const safeTilt = clamp(tilt, -1, 1, 0);
  const skew = 2 ** (safeTilt * 2);
  const skewedPosition = position ** skew;
  return 0.5 * (1 - Math.cos(TAU * skewedPosition));
}

function clampUnit(value, fallback = 0) {
  return clamp(value, 0, 1, fallback);
}

/**
 * Sandy Syrup's centered exponential pitch path. Unlike wrapBarberPhase(),
 * this helper intentionally keeps an endpoint phase of 1 so callers can
 * inspect the complete .25× → 1× → 4× vector for a four-octave sweep.
 */
export function sandySyrupTargetRate(
  pitchOctaves,
  phase,
  directionUp = true,
) {
  const octaves = clamp(
    pitchOctaves,
    BARBER_DELAY_LIMITS.minimumPitchOctaves,
    BARBER_DELAY_LIMITS.maximumPitchOctaves,
    SANDY_DEFAULTS.pitchOctaves,
  );
  const position = clampUnit(phase);
  const direction = directionUp ? 1 : -1;
  return 2 ** (octaves * (position - 0.5) * direction);
}

/**
 * Exponential history placement retained from the Morphisma instrument.
 * At four octaves and four seconds it maps p=[0,.5,1] to [4,.8,0].
 */
export function sandySyrupBaseDelay(
  pitchOctaves,
  phase,
  historySeconds,
) {
  const octaves = clamp(
    pitchOctaves,
    BARBER_DELAY_LIMITS.minimumPitchOctaves,
    BARBER_DELAY_LIMITS.maximumPitchOctaves,
    SANDY_DEFAULTS.pitchOctaves,
  );
  const position = clampUnit(phase);
  const history = clamp(
    historySeconds,
    BARBER_DELAY_LIMITS.minimumSandyHistory,
    BARBER_DELAY_LIMITS.maximumSandyHistory,
    SANDY_DEFAULTS.fbDelay,
  );
  const octaveSpan = 2 ** octaves;
  return (
    history
    * ((2 ** (octaves * (1 - position))) - 1)
    / (octaveSpan - 1)
  );
}

export function sandySyrupHann(phase) {
  const position = wrapBarberPhase(phase);
  return 0.5 * (1 - Math.cos(TAU * position));
}

export function sandySyrupComplementaryHann(phase) {
  const primary = sandySyrupHann(phase);
  const secondary = sandySyrupHann(phase + 0.5);
  return Object.freeze({
    primary,
    secondary,
    total: primary + secondary,
  });
}

export function sandySyrupEffectiveRate(heldRate, targetRate, blend) {
  const held = Math.max(0, finiteNumber(heldRate, 1));
  const target = Math.max(0, finiteNumber(targetRate, held));
  const mix = clampUnit(blend, SANDY_DEFAULTS.blend);
  return held + ((target - held) * mix);
}

export function integrateSandySyrupCursor(
  absoluteCursor,
  heldRate,
  targetRate,
  blend,
) {
  return (
    finiteNumber(absoluteCursor, 0)
    + sandySyrupEffectiveRate(heldRate, targetRate, blend)
  );
}

export function sandySyrupVoiceGain(numVoices) {
  const voices = clamp(
    numVoices,
    BARBER_DELAY_LIMITS.minimumVoices,
    BARBER_DELAY_LIMITS.maximumVoices,
    SANDY_DEFAULTS.numVoices,
  );
  return 2 / voices;
}

/**
 * Clamp an absolute grain cursor to readable history. This both proves that a
 * read never exceeds the finite ring and keeps high-rate grains behind the
 * write head if their requested traversal is longer than the available guard.
 */
export function clampSandySyrupCursor(
  absoluteCursor,
  absoluteWriteIndex,
  bufferLength,
  guardSamples = SANDY_READ_GUARD_SAMPLES,
) {
  const write = finiteNumber(absoluteWriteIndex, 0);
  const length = Math.max(
    RENDER_QUANTUM + 2,
    Math.round(finiteNumber(bufferLength, RENDER_QUANTUM + 2)),
  );
  const guard = clamp(
    guardSamples,
    1,
    Math.max(1, length - 2),
    SANDY_READ_GUARD_SAMPLES,
  );
  const oldest = write - (length - 2);
  const newest = write - guard;
  return Math.min(newest, Math.max(oldest, finiteNumber(
    absoluteCursor,
    newest,
  )));
}

/**
 * Place a new grain at Morphisma's exponential history position.
 * Faster-than-live grains are allowed to catch the write head and are then
 * held at the read guard, matching the source graph's max(rawDelay, 1 sample)
 * behavior. Reserving an entire grain traversal here changes the pitch and
 * makes otherwise distinct presets converge on the oldest available history.
 */
export function sandySyrupInitialCursor(
  absoluteWriteIndex,
  pitchOctaves,
  phase,
  historySeconds,
  sampleRate,
  bufferLength,
  guardSamples = SANDY_READ_GUARD_SAMPLES,
) {
  const safeSampleRate = clamp(
    sampleRate,
    8_000,
    384_000,
    DEFAULT_SAMPLE_RATE,
  );
  const delaySamples = sandySyrupBaseDelay(
    pitchOctaves,
    phase,
    historySeconds,
  ) * safeSampleRate;
  return clampSandySyrupCursor(
    finiteNumber(absoluteWriteIndex, 0) - delaySamples,
    absoluteWriteIndex,
    bufferLength,
    guardSamples,
  );
}

export function barberDelayPitchEstimate(params = {}, mode = "candy") {
  const safeMode = sanitizeBarberDelayMode(mode);
  const safe = sanitizeBarberDelayParams(params, safeMode);
  if (safeMode === "sandy") {
    const lowRatio = sandySyrupTargetRate(
      safe.pitchOctaves,
      0,
      safe.directionUp,
    );
    const highRatio = sandySyrupTargetRate(
      safe.pitchOctaves,
      1,
      safe.directionUp,
    );
    return Object.freeze({
      product: safe.pitchOctaves,
      ratio: 1,
      lowRatio,
      highRatio,
      semitones: safe.pitchOctaves * 6,
      symmetric: true,
      octaves: safe.pitchOctaves,
    });
  }
  const product = safe.speed * safe.range * Math.PI;
  const ratio = 1 + product;
  return Object.freeze({
    product,
    ratio,
    lowRatio: 1 / ratio,
    highRatio: ratio,
    semitones: 12 * Math.log2(ratio),
    symmetric: true,
  });
}

function makePreset(mode, id, label, settings) {
  return Object.freeze({
    id,
    label,
    settings: sanitizeBarberDelayParams({
      ...BARBER_DELAY_DEFAULTS[mode],
      ...settings,
    }, mode),
  });
}

const CANDY_PRESETS = Object.freeze([
  makePreset("candy", "centered-rise", "Centered Rise", {
    speed: 0.5, range: 2, directionUp: true, numVoices: 8, tilt: 0,
    feedback: 0, fbDelay: 1, globalFeedback: 0, dryWet: 0.8,
  }),
  makePreset("candy", "centered-fall", "Centered Fall", {
    speed: 0.5, range: 2, directionUp: false, numVoices: 8, tilt: 0,
    feedback: 0, fbDelay: 1, globalFeedback: 0, dryWet: 0.8,
  }),
  makePreset("candy", "slow-coil", "Slow Coil", {
    speed: 0.1, range: 4, directionUp: true, numVoices: 12, tilt: 0,
    feedback: 0.7, fbDelay: 3, globalFeedback: 0, dryWet: 0.9,
  }),
  makePreset("candy", "thick-tar", "Thick Tar", {
    speed: 0.08, range: 6, directionUp: false, numVoices: 12, tilt: -0.3,
    feedback: 0.85, fbDelay: 4, globalFeedback: 0, dryWet: 1,
  }),
  makePreset("candy", "quick-stripe", "Quick Stripe", {
    speed: 2, range: 0.5, directionUp: true, numVoices: 4, tilt: 0.5,
    feedback: 0.4, fbDelay: 0.5, globalFeedback: 0, dryWet: 0.6,
  }),
  makePreset("candy", "mud-churn", "Mud Churn", {
    speed: 0.3, range: 3, directionUp: false, numVoices: 10, tilt: 0.4,
    feedback: 0.8, fbDelay: 2, globalFeedback: 0, dryWet: 0.85,
  }),
  makePreset("candy", "dual-grind", "Dual Grind", {
    speed: 1.3, range: 0.1, directionUp: false, numVoices: 2, tilt: -0.5,
    feedback: 0.95, fbDelay: 0.01, globalFeedback: 0, dryWet: 1,
  }),
  makePreset("candy", "wide-sweep", "Wide Sweep", {
    speed: 0.15, range: 5, directionUp: true, numVoices: 12, tilt: 0,
    feedback: 0, fbDelay: 2, globalFeedback: 0, dryWet: 0.85,
  }),
  makePreset("candy", "frozen-bog", "Frozen Bog", {
    speed: 0.02, range: 8, directionUp: true, numVoices: 12, tilt: 0,
    feedback: 0.9, fbDelay: 5, globalFeedback: 0, dryWet: 1,
  }),
  makePreset("candy", "tight-wobble", "Tight Wobble", {
    speed: 1.5, range: 0.3, directionUp: true, numVoices: 6, tilt: -0.4,
    feedback: 0.5, fbDelay: 0.2, globalFeedback: 0, dryWet: 0.55,
  }),
  makePreset("candy", "long-pour", "Long Pour", {
    speed: 0.06, range: 7, directionUp: false, numVoices: 12, tilt: 0.2,
    feedback: 0.75, fbDelay: 4, globalFeedback: 0, dryWet: 0.95,
  }),
  makePreset("candy", "gentle-ooze", "Gentle Ooze", {
    speed: 0.2, range: 1.5, directionUp: true, numVoices: 8, tilt: 0.2,
    feedback: 0.3, fbDelay: 1, globalFeedback: 0, dryWet: 0.5,
  }),
]);

const SANDY_PRESETS = Object.freeze([
  makePreset("sandy", "silk-rise", "Silk Rise", {
    speed: 0.08, pitchOctaves: 4, directionUp: true, numVoices: 8, tilt: 0,
    feedback: 0, fbDelay: 4, globalFeedback: 0, dryWet: 0.85,
    grainSize: 0.05, blend: 0.5,
  }),
  makePreset("sandy", "silk-fall", "Silk Fall", {
    speed: 0.08, pitchOctaves: 4, directionUp: false, numVoices: 8, tilt: 0,
    feedback: 0, fbDelay: 4, globalFeedback: 0, dryWet: 0.85,
    grainSize: 0.05, blend: 0.5,
  }),
  makePreset("sandy", "pure-grit", "Pure Grit", {
    speed: 0.1, pitchOctaves: 3, directionUp: true, numVoices: 8, tilt: 0,
    feedback: 0, fbDelay: 4, globalFeedback: 0, dryWet: 0.85,
    grainSize: 0.08, blend: 0,
  }),
  makePreset("sandy", "pure-syrup", "Pure Syrup", {
    speed: 0.1, pitchOctaves: 3, directionUp: true, numVoices: 8, tilt: 0,
    feedback: 0, fbDelay: 4, globalFeedback: 0, dryWet: 0.85,
    grainSize: 0.08, blend: 1,
  }),
  makePreset("sandy", "glacial-drift", "Glacial Drift", {
    speed: 0.015, pitchOctaves: 8, directionUp: true, numVoices: 12, tilt: 0,
    feedback: 0.75, fbDelay: 12, globalFeedback: 0, dryWet: 1,
    grainSize: 0.04, blend: 0.7,
  }),
  makePreset("sandy", "robot-grind", "Robot Grind", {
    speed: 1.2, pitchOctaves: 1, directionUp: false, numVoices: 2, tilt: -0.6,
    feedback: 0.93, fbDelay: 2, globalFeedback: 0, dryWet: 1,
    grainSize: 0.015, blend: 0,
  }),
  makePreset("sandy", "grain-cloud", "Grain Cloud", {
    speed: 0.1, pitchOctaves: 3, directionUp: true, numVoices: 10, tilt: -0.3,
    feedback: 0.3, fbDelay: 5, globalFeedback: 0, dryWet: 0.9,
    grainSize: 0.3, blend: 0,
  }),
  makePreset("sandy", "silk-glide", "Silk Glide", {
    speed: 0.05, pitchOctaves: 6, directionUp: false, numVoices: 12, tilt: 0,
    feedback: 0, fbDelay: 6, globalFeedback: 0, dryWet: 0.8,
    grainSize: 0.008, blend: 1,
  }),
  makePreset("sandy", "metal-shimmer", "Metal Shimmer", {
    speed: 0.6, pitchOctaves: 1, directionUp: true, numVoices: 6, tilt: 0.7,
    feedback: 0.5, fbDelay: 1.5, globalFeedback: 0, dryWet: 0.7,
    grainSize: 0.01, blend: 0.3,
  }),
  makePreset("sandy", "feedback-drone", "Feedback Drone", {
    speed: 0.03, pitchOctaves: 2, directionUp: true, numVoices: 12, tilt: 0,
    feedback: 0.92, fbDelay: 8, globalFeedback: 0, dryWet: 1,
    grainSize: 0.06, blend: 0.6,
  }),
  makePreset("sandy", "full-spectrum", "Full Spectrum", {
    speed: 0.04, pitchOctaves: 10, directionUp: true, numVoices: 12, tilt: 0,
    feedback: 0, fbDelay: 10, globalFeedback: 0, dryWet: 1,
    grainSize: 0.03, blend: 0.8,
  }),
  makePreset("sandy", "gentle-blend", "Gentle Blend", {
    speed: 0.12, pitchOctaves: 2, directionUp: false, numVoices: 6, tilt: 0.2,
    feedback: 0.2, fbDelay: 3, globalFeedback: 0, dryWet: 0.4,
    grainSize: 0.06, blend: 0.4,
  }),
]);

export const BARBER_DELAY_PRESETS = Object.freeze({
  candy: CANDY_PRESETS,
  sandy: SANDY_PRESETS,
});

export function createBarberSoftCeilingCurve(
  length = 2_049,
  drive = 1.25,
  ceiling = 0.92,
) {
  const size = Math.max(33, Math.round(clamp(length, 33, 65_537, 2_049)));
  const safeDrive = clamp(drive, 0.25, 4, 1.25);
  const safeCeiling = clamp(ceiling, 0.5, 0.98, 0.92);
  const normalizer = Math.tanh(safeDrive);
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = (index / (size - 1)) * 2 - 1;
    curve[index] = (
      Math.tanh(input * safeDrive) / normalizer
    ) * safeCeiling;
  }
  return curve;
}

/**
 * The original Morphisma graphs had no always-on compressor or saturation.
 * This curve is exactly y=x through the normal ±0.9 range, then uses a
 * first-derivative-continuous shoulder to reach ±0.98 at full scale.
 */
export function createBarberTransparentCeilingCurve(
  length = 2_049,
  linearLimit = 0.9,
  ceiling = 0.98,
) {
  const size = Math.max(33, Math.round(clamp(length, 33, 65_537, 2_049)));
  const safeLinearLimit = clamp(linearLimit, 0.5, 0.95, 0.9);
  const minimumCeiling = Math.max(
    safeLinearLimit + 0.01,
    (1 + safeLinearLimit) * 0.5,
  );
  const safeCeiling = clamp(
    ceiling,
    minimumCeiling,
    0.999,
    0.98,
  );
  const inputSpan = 1 - safeLinearLimit;
  const shoulderCurve = (1 - safeCeiling) / (inputSpan * inputSpan);
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = (index / (size - 1)) * 2 - 1;
    const magnitude = Math.abs(input);
    if (magnitude <= safeLinearLimit) {
      curve[index] = input;
      continue;
    }
    const distance = magnitude - safeLinearLimit;
    const shoulder = (
      safeLinearLimit
      + distance
      - (shoulderCurve * distance * distance)
    );
    curve[index] = Math.sign(input) * shoulder;
  }
  return curve;
}

// Retain the earlier exported name for callers added with the Candy audit.
export const createCandyTransparentCeilingCurve = (
  createBarberTransparentCeilingCurve
);

function createProcessorClass(AudioWorkletBase) {
  return class MorphazoidBarberDelayProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      this.mode = sanitizeBarberDelayMode(options.processorOptions?.mode);
      const initial = sanitizeBarberDelayParams(
        options.processorOptions?.parameters,
        this.mode,
      );
      this.target = {
        ...initial,
        directionMix: initial.directionUp ? 1 : 0,
      };
      this.current = { ...this.target };
      const workletSampleRate = Number(globalThis.sampleRate)
        || DEFAULT_SAMPLE_RATE;
      this.sampleRate = workletSampleRate;
      this.isSandy = this.mode === "sandy";
      this.bufferLength = this.isSandy
        ? Math.ceil(SANDY_BUFFER_SECONDS * workletSampleRate)
        : (
          Math.ceil(
            BARBER_DELAY_LIMITS.maximumRange * workletSampleRate,
          )
          + RENDER_QUANTUM
          + 2
        );
      this.buffers = [
        new Float32Array(this.bufferLength),
        new Float32Array(this.bufferLength),
      ];
      this.writeIndex = 0;
      this.absoluteWriteIndex = 0;
      this.phase = 0;
      this.streamCursors = new Float64Array(SANDY_STREAM_COUNT);
      this.streamPhases = new Float64Array(SANDY_STREAM_COUNT);
      this.streamHeldRates = new Float64Array(SANDY_STREAM_COUNT);
      this.streamInitialized = new Uint8Array(SANDY_STREAM_COUNT);
      this.sandyVoiceCount = Math.max(1, Math.round(initial.numVoices));
      this.globalFeedbackBuffers = [
        new Float32Array(RENDER_QUANTUM),
        new Float32Array(RENDER_QUANTUM),
      ];
      this.globalFeedbackIndex = 0;
      this.activeTarget = 0;
      this.activeGain = 0;

      this.port.onmessage = (event) => {
        const message = event.data;
        if (message?.type === "parameters") {
          const safe = sanitizeBarberDelayParams({
            ...this.target,
            ...message.parameters,
          }, this.mode);
          this.target = {
            ...safe,
            directionMix: safe.directionUp ? 1 : 0,
          };
        } else if (message?.type === "active") {
          this.activeTarget = message.value ? 1 : 0;
        } else if (message?.type === "reset") {
          this.buffers[0].fill(0);
          this.buffers[1].fill(0);
          this.writeIndex = 0;
          this.absoluteWriteIndex = 0;
          this.phase = 0;
          this.streamCursors.fill(0);
          this.streamHeldRates.fill(1);
          this.streamInitialized.fill(0);
          this.streamPhases.fill(0);
          this.sandyVoiceCount = Math.max(
            1,
            Math.round(this.current.numVoices),
          );
          this.globalFeedbackBuffers[0].fill(0);
          this.globalFeedbackBuffers[1].fill(0);
          this.globalFeedbackIndex = 0;
        } else if (message?.type === "reseed-sandy-grains" && this.isSandy) {
          // Preserve captured audio while making a new preset's grain size,
          // history position, and held rates audible immediately.
          this.streamCursors.fill(0);
          this.streamHeldRates.fill(1);
          this.streamInitialized.fill(0);
          this.streamPhases.fill(0);
        }
      };
    }

    read(buffer, delaySamples) {
      let readPosition = this.writeIndex - delaySamples;
      while (readPosition < 0) readPosition += this.bufferLength;
      while (readPosition >= this.bufferLength) {
        readPosition -= this.bufferLength;
      }
      const before = Math.floor(readPosition);
      const after = before + 1 === this.bufferLength ? 0 : before + 1;
      const fraction = readPosition - before;
      return buffer[before] + ((buffer[after] - buffer[before]) * fraction);
    }

    readAbsolute(buffer, absoluteCursor) {
      let readPosition = absoluteCursor % this.bufferLength;
      if (readPosition < 0) readPosition += this.bufferLength;
      const before = Math.floor(readPosition);
      const after = before + 1 === this.bufferLength ? 0 : before + 1;
      const fraction = readPosition - before;
      return buffer[before] + ((buffer[after] - buffer[before]) * fraction);
    }

    initialSandyGrainPhase(voicePhase, streamOffset) {
      const speed = Math.max(0, this.target.speed);
      const grainSize = Math.max(0.005, this.target.grainSize);
      const sweepDuration = speed > 0 ? 1 / speed : 10;
      const grainsPerSweep = sweepDuration / grainSize;
      return wrapBarberPhase(
        (voicePhase * grainsPerSweep) + streamOffset,
      );
    }

    resetSandyStream(
      streamIndex,
      voicePhase,
      targetRate,
      absoluteWriteIndex,
    ) {
      this.streamHeldRates[streamIndex] = targetRate;
      this.streamCursors[streamIndex] = sandySyrupInitialCursor(
        absoluteWriteIndex,
        this.current.pitchOctaves,
        voicePhase,
        this.current.fbDelay,
        this.sampleRate,
        this.bufferLength,
      );
      this.streamInitialized[streamIndex] = 1;
    }

    process(inputs, outputs) {
      const output = outputs[0];
      if (!output?.length) return true;
      const leftOutput = output[0];
      const rightOutput = output[1] ?? leftOutput;
      const input = inputs[0] ?? [];
      const leftInput = input[0];
      const rightInput = input[1] ?? leftInput;
      const isSandy = this.isSandy;
      const parameterSlew = 1 - Math.exp(-1 / (this.sampleRate * 0.02));
      const voiceSlew = 1 - Math.exp(-1 / (this.sampleRate * 0.075));
      const activeSlew = 1 - Math.exp(-1 / (this.sampleRate * 0.008));

      for (
        let sampleIndex = 0;
        sampleIndex < leftOutput.length;
        sampleIndex += 1
      ) {
        this.current.speed += (
          this.target.speed - this.current.speed
        ) * parameterSlew;
        if (isSandy) {
          this.current.pitchOctaves += (
            this.target.pitchOctaves - this.current.pitchOctaves
          ) * parameterSlew;
          this.current.grainSize += (
            this.target.grainSize - this.current.grainSize
          ) * parameterSlew;
          this.current.blend += (
            this.target.blend - this.current.blend
          ) * parameterSlew;
        } else {
          this.current.range += (
            this.target.range - this.current.range
          ) * parameterSlew;
        }
        this.current.tilt += (
          this.target.tilt - this.current.tilt
        ) * parameterSlew;
        this.current.feedback += (
          this.target.feedback - this.current.feedback
        ) * parameterSlew;
        this.current.fbDelay += (
          this.target.fbDelay - this.current.fbDelay
        ) * parameterSlew;
        this.current.globalFeedback += (
          this.target.globalFeedback - this.current.globalFeedback
        ) * parameterSlew;
        this.current.dryWet += (
          this.target.dryWet - this.current.dryWet
        ) * parameterSlew;
        this.current.inputGain += (
          this.target.inputGain - this.current.inputGain
        ) * parameterSlew;
        this.current.outputLevel += (
          this.target.outputLevel - this.current.outputLevel
        ) * parameterSlew;
        this.current.directionMix += (
          this.target.directionMix - this.current.directionMix
        ) * parameterSlew;
        this.current.numVoices += (
          this.target.numVoices - this.current.numVoices
        ) * voiceSlew;
        this.activeGain += (
          this.activeTarget - this.activeGain
        ) * activeSlew;

        const phaseStep = this.current.speed / this.sampleRate;
        this.phase += phaseStep;
        if (this.phase >= 1) this.phase -= Math.floor(this.phase);

        const rawLeft = finiteNumber(leftInput?.[sampleIndex], 0);
        const rawRight = finiteNumber(rightInput?.[sampleIndex], rawLeft);
        const sourceLeft = rawLeft * this.current.inputGain;
        const sourceRight = rawRight * this.current.inputGain;
        const feedbackDelaySamples = (
          Math.max(1, this.current.fbDelay * this.sampleRate)
          + RENDER_QUANTUM
        );
        const feedbackLeft = this.read(
          this.buffers[0],
          feedbackDelaySamples,
        );
        const feedbackRight = this.read(
          this.buffers[1],
          feedbackDelaySamples,
        );

        const globalFeedbackLeft = this.globalFeedbackBuffers[0][
          this.globalFeedbackIndex
        ];
        const globalFeedbackRight = this.globalFeedbackBuffers[1][
          this.globalFeedbackIndex
        ];
        const recordInputLeft = (
          sourceLeft
          + (feedbackLeft * this.current.feedback)
          + (globalFeedbackLeft * this.current.globalFeedback)
        );
        const recordInputRight = (
          sourceRight
          + (feedbackRight * this.current.feedback)
          + (globalFeedbackRight * this.current.globalFeedback)
        );
        // Morphisma wrote summed input and feedback directly into every delay
        // head. Preserve that linear tape path throughout the normal range.
        // An inaudibly high guard catches numerical runaway before the browser
        // graph's transparent final ceiling.
        const recordLeft = barberRecordSample(recordInputLeft);
        const recordRight = barberRecordSample(recordInputRight);
        this.buffers[0][this.writeIndex] = recordLeft;
        this.buffers[1][this.writeIndex] = recordRight;

        const voiceCount = Math.max(1, this.current.numVoices);
        if (isSandy) {
          const nextSandyVoiceCount = Math.max(1, Math.round(voiceCount));
          if (nextSandyVoiceCount !== this.sandyVoiceCount) {
            this.sandyVoiceCount = nextSandyVoiceCount;
            this.streamInitialized.fill(0);
          }
        }
        const skew = 2 ** (this.current.tilt * 2);
        let wetLeft = 0;
        let wetRight = 0;
        if (isSandy) {
          const octaves = this.current.pitchOctaves;
          const directionSign = (this.current.directionMix * 2) - 1;
          const grainStep = this.target.speed > 0
            ? 1 / Math.max(
              1,
              this.current.grainSize * this.sampleRate,
            )
            : 0;
          const blend = this.current.blend;
          const voiceGain = sandySyrupVoiceGain(voiceCount);

          for (
            let voiceIndex = 0;
            voiceIndex < BARBER_DELAY_LIMITS.maximumVoices;
            voiceIndex += 1
          ) {
            const voiceActivation = Math.max(
              0,
              Math.min(1, voiceCount - voiceIndex),
            );
            if (voiceActivation <= 1e-6) continue;
            let voicePhase = this.phase + (voiceIndex / voiceCount);
            voicePhase -= Math.floor(voicePhase);
            const targetRate = 2 ** (
              octaves * (voicePhase - 0.5) * directionSign
            );
            const skewedPhase = voicePhase ** skew;
            const sweepWindow = 0.5 * (
              1 - Math.cos(TAU * skewedPhase)
            );
            let voiceLeft = 0;
            let voiceRight = 0;

            for (let stream = 0; stream < 2; stream += 1) {
              const streamIndex = voiceIndex * 2 + stream;
              let grainPhase = this.streamPhases[streamIndex];
              if (!this.streamInitialized[streamIndex]) {
                grainPhase = this.initialSandyGrainPhase(
                  voicePhase,
                  stream * 0.5,
                );
                this.streamPhases[streamIndex] = grainPhase;
                this.resetSandyStream(
                  streamIndex,
                  voicePhase,
                  targetRate,
                  this.absoluteWriteIndex,
                );
              }

              const heldRate = this.streamHeldRates[streamIndex];
              const effectiveRate = heldRate + (
                (targetRate - heldRate) * blend
              );
              const cursor = clampSandySyrupCursor(
                this.streamCursors[streamIndex],
                this.absoluteWriteIndex,
                this.bufferLength,
              );
              const grainWindow = 0.5 * (
                1 - Math.cos(TAU * grainPhase)
              );
              voiceLeft += this.readAbsolute(
                this.buffers[0],
                cursor,
              ) * grainWindow;
              voiceRight += this.readAbsolute(
                this.buffers[1],
                cursor,
              ) * grainWindow;

              this.streamCursors[streamIndex] = clampSandySyrupCursor(
                cursor + effectiveRate,
                this.absoluteWriteIndex + 1,
                this.bufferLength,
              );
              grainPhase += grainStep;
              if (grainPhase >= 1) {
                grainPhase -= Math.floor(grainPhase);
                this.resetSandyStream(
                  streamIndex,
                  voicePhase,
                  targetRate,
                  this.absoluteWriteIndex + 1,
                );
              }
              this.streamPhases[streamIndex] = grainPhase;
            }

            const gain = sweepWindow * voiceActivation * voiceGain;
            wetLeft += voiceLeft * gain;
            wetRight += voiceRight * gain;
          }
        } else {
          const voiceGain = 2 / voiceCount;
          const rangeSamples = this.current.range * this.sampleRate;
          for (
            let voiceIndex = 0;
            voiceIndex < BARBER_DELAY_LIMITS.maximumVoices;
            voiceIndex += 1
          ) {
            // A fractional final voice crossfades count changes instead of
            // abruptly inserting or removing a read head.
            const voiceActivation = Math.max(
              0,
              Math.min(1, voiceCount - voiceIndex),
            );
            if (voiceActivation <= 1e-6) continue;
            let voicePhase = this.phase + (voiceIndex / voiceCount);
            voicePhase -= Math.floor(voicePhase);

            const sine = Math.sin(Math.PI * voicePhase);
            const risingCurve = sine * sine;
            const curve = (
              (risingCurve * this.current.directionMix)
              + ((1 - risingCurve) * (1 - this.current.directionMix))
            );
            const delaySamples = curve * rangeSamples;
            const skewedPhase = voicePhase ** skew;
            const window = 0.5 * (1 - Math.cos(TAU * skewedPhase));
            const gain = window * voiceGain * voiceActivation;
            wetLeft += this.read(this.buffers[0], delaySamples) * gain;
            wetRight += this.read(this.buffers[1], delaySamples) * gain;
          }
        }

        this.globalFeedbackBuffers[0][this.globalFeedbackIndex] = (
          finiteNumber(wetLeft, 0)
        );
        this.globalFeedbackBuffers[1][this.globalFeedbackIndex] = (
          finiteNumber(wetRight, 0)
        );
        this.globalFeedbackIndex += 1;
        if (this.globalFeedbackIndex === RENDER_QUANTUM) {
          this.globalFeedbackIndex = 0;
        }
        const dryGain = 1 - this.current.dryWet;
        const outputGain = this.current.outputLevel * this.activeGain;
        const mixedLeft = (
          (sourceLeft * dryGain) + (wetLeft * this.current.dryWet)
        ) * outputGain;
        const mixedRight = (
          (sourceRight * dryGain) + (wetRight * this.current.dryWet)
        ) * outputGain;
        leftOutput[sampleIndex] = finiteNumber(mixedLeft, 0);
        if (rightOutput !== leftOutput) {
          rightOutput[sampleIndex] = finiteNumber(mixedRight, 0);
        }

        this.writeIndex += 1;
        if (this.writeIndex === this.bufferLength) this.writeIndex = 0;
        this.absoluteWriteIndex += 1;
      }
      return true;
    }
  };
}

const AudioWorkletBase = globalThis.AudioWorkletProcessor;
if (
  typeof AudioWorkletBase === "function"
  && typeof globalThis.registerProcessor === "function"
) {
  globalThis.registerProcessor(
    PROCESSOR_NAME,
    createProcessorClass(AudioWorkletBase),
  );
}

/**
 * Browser-facing graph. Construction is deliberately inert: start() must be
 * called by a user gesture before an AudioContext or microphone is created.
 */
export class BarberDelayAudio {
  constructor(mode = "candy", runtime = globalThis) {
    this.mode = sanitizeBarberDelayMode(mode);
    this.runtime = runtime;
    this.params = { ...BARBER_DELAY_DEFAULTS[this.mode] };
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    this.outputRelease = null;
    this.sourceNode = null;
    this.sourceKind = null;
    this.mediaStream = null;
    this.mediaElement = null;
    this.mediaElementNodes = new WeakMap();
    this.enabled = false;
    this.suspendTimer = null;
  }

  get isInitialized() {
    return Boolean(this.context && this.context.state !== "closed");
  }

  get state() {
    return Object.freeze({
      initialized: this.isInitialized,
      enabled: this.enabled,
      sourceKind: this.sourceKind,
      contextState: this.context?.state ?? "closed",
    });
  }

  async initialize() {
    if (this.isInitialized) return;
    const AudioContextConstructor = (
      this.runtime.AudioContext ?? this.runtime.webkitAudioContext
    );
    const AudioWorkletNodeConstructor = (
      this.runtime.AudioWorkletNode ?? globalThis.AudioWorkletNode
    );
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }
    if (typeof AudioWorkletNodeConstructor !== "function") {
      throw new Error("This effect requires AudioWorklet support.");
    }

    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    if (!context.audioWorklet) {
      await context.close().catch(() => {});
      throw new Error("This effect requires AudioWorklet support.");
    }

    try {
      if (context.state !== "running") {
        unlockAudioContext(context);
        await context.resume();
      }
      await context.audioWorklet.addModule(
        new URL("./barber-delay.js", import.meta.url),
      );
      const node = new AudioWorkletNodeConstructor(context, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          mode: this.mode,
          parameters: this.params,
        },
      });
      const ceiling = context.createWaveShaper();
      const master = context.createGain();
      const analyser = context.createAnalyser();

      ceiling.curve = createBarberTransparentCeilingCurve();
      ceiling.oversample = "none";
      master.gain.value = 0;
      analyser.fftSize = 1_024;
      analyser.smoothingTimeConstant = 0.72;

      node
        .connect(ceiling)
        .connect(master)
        .connect(analyser);
      this.outputRelease = connectAudioOutput(context, analyser, {
        runtime: this.runtime,
      });

      this.context = context;
      this.node = node;
      this.ceiling = ceiling;
      this.master = master;
      this.analyser = analyser;
      this.setParameters(this.params);
    } catch (error) {
      this.outputRelease?.();
      this.outputRelease = null;
      await context.close().catch(() => {});
      throw error;
    }
  }

  clearSuspendTimer() {
    if (this.suspendTimer === null) return;
    this.runtime.clearTimeout?.(this.suspendTimer);
    this.suspendTimer = null;
  }

  releaseSource({ pauseElement = true } = {}) {
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    for (const track of this.mediaStream?.getTracks?.() ?? []) track.stop();
    this.mediaStream = null;
    if (pauseElement) this.mediaElement?.pause?.();
    this.mediaElement = null;
    this.sourceKind = null;
  }

  async connectSource(source) {
    if (source?.kind === "microphone") {
      const getUserMedia = (
        this.runtime.navigator?.mediaDevices?.getUserMedia
      )?.bind(this.runtime.navigator.mediaDevices);
      if (typeof getUserMedia !== "function") {
        throw new Error("Microphone input is not available in this browser.");
      }
      const stream = await getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      this.mediaStream = stream;
      const sourceNode = this.context.createMediaStreamSource(stream);
      sourceNode.connect(this.node);
      this.sourceNode = sourceNode;
      this.sourceKind = "microphone";
      return;
    }

    if (source?.kind === "file" && source.element) {
      const element = source.element;
      let sourceNode = this.mediaElementNodes.get(element);
      if (!sourceNode) {
        sourceNode = this.context.createMediaElementSource(element);
        this.mediaElementNodes.set(element, sourceNode);
      }
      sourceNode.connect(this.node);
      this.sourceNode = sourceNode;
      this.mediaElement = element;
      this.sourceKind = "file";
      await element.play?.();
      return;
    }

    throw new Error("Choose a microphone or local audio file first.");
  }

  async start(source) {
    await this.initialize();
    this.clearSuspendTimer();
    this.releaseSource();
    this.enabled = false;
    await this.context.resume();

    try {
      await this.connectSource(source);
      const now = this.context.currentTime;
      this.node.port.postMessage({ type: "reset" });
      this.node.port.postMessage({ type: "active", value: true });
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(1, now + 0.035);
      this.enabled = true;
    } catch (error) {
      this.releaseSource();
      this.node.port.postMessage({ type: "active", value: false });
      this.master.gain.value = 0;
      this.enabled = false;
      await this.context.suspend().catch(() => {});
      throw error;
    }
  }

  setParameters(params = {}) {
    this.params = {
      ...sanitizeBarberDelayParams({
        ...this.params,
        ...params,
      }, this.mode),
    };
    this.node?.port.postMessage({
      type: "parameters",
      parameters: this.params,
    });
    return Object.freeze({ ...this.params });
  }

  reseedSandyGrains() {
    if (this.mode !== "sandy") return;
    this.node?.port.postMessage({ type: "reseed-sandy-grains" });
  }

  getTimeDomainData(target) {
    if (!this.analyser || !(target instanceof Float32Array)) return false;
    this.analyser.getFloatTimeDomainData(target);
    return true;
  }

  getWaveform(target) {
    return this.getTimeDomainData(target);
  }

  async stop() {
    this.clearSuspendTimer();
    this.releaseSource();
    if (!this.isInitialized) {
      this.enabled = false;
      return;
    }
    const now = this.context.currentTime;
    this.node.port.postMessage({ type: "active", value: false });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.035);
    this.enabled = false;
    this.suspendTimer = this.runtime.setTimeout?.(() => {
      this.suspendTimer = null;
      if (!this.enabled && this.context?.state === "running") {
        this.context.suspend().catch(() => {});
      }
    }, 55) ?? null;
  }

  async close() {
    this.clearSuspendTimer();
    this.releaseSource();
    this.enabled = false;
    this.node?.port.postMessage({ type: "active", value: false });
    this.node?.disconnect();
    this.highpass?.disconnect();
    this.compressor?.disconnect();
    this.ceiling?.disconnect();
    this.master?.disconnect();
    this.outputRelease?.();
    this.outputRelease = null;
    this.analyser?.disconnect();
    const context = this.context;
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    this.sourceKind = null;
    this.mediaElementNodes = new WeakMap();
    if (context && context.state !== "closed") {
      await context.close().catch(() => {});
    }
  }
}
