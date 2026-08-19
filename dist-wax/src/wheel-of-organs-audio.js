import { glottalHarmonics } from "./throatazoid.js";
import { connectAudioOutput } from "./audio-output-manager.js";
import {
  WHEEL_MOUTH_LIMITS,
  WHEEL_MORPH_LIMITS,
  wheelVocalParameters,
} from "./wheel-of-organs.js";

/**
 * Native Web Audio renderer for Wheel of Organs.
 *
 * The graph is deliberately lazy: constructing the class does not touch Web
 * Audio. The first enable() call, which the page makes from a user gesture,
 * creates twelve permanent voice paths. Articulation only automates those
 * paths; it never allocates a node in response to a letter or pointer event.
 */

export const WHEEL_AUDIO_VOICE_COUNT = 12;

const LEVEL_CEILING = 0.82;
const VOICE_GAIN_CEILING = 0.34;
const MIN_GAIN = 0.0001;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 18_000;
const DEFAULT_FORMANTS = Object.freeze([720, 1_220, 2_620, 4_180]);
const DEFAULT_BANDWIDTHS = Object.freeze([90, 120, 180, 420]);
const DEFAULT_FORMANT_GAINS = Object.freeze([10, 8, 5, 2.5]);
const STOP_MANNERS = new Set(["stop", "plosive", "occlusive"]);
const NOISY_MANNERS = new Set([
  "fricative",
  "sibilant",
  "affricate",
  "aspirate",
  "breath",
  "unvoiced",
]);
const CARRIER_ARTICULATIONS = Object.freeze({
  A: "a",
  AE: "a",
  AH: "a",
  AX: "a",
  E: "e",
  EH: "e",
  I: "i",
  IH: "i",
  IY: "i",
  O: "o",
  AO: "o",
  U: "u",
  UW: "u",
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1, fallback = minimum) {
  const safeFallback = Math.min(maximum, Math.max(minimum, finite(fallback, minimum)));
  return Math.min(maximum, Math.max(minimum, finite(value, safeFallback)));
}

function firstFinite(values, fallback) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return fallback;
}

function firstString(values, fallback) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function maximumModelMouths() {
  return Math.round(clamp(
    WHEEL_MOUTH_LIMITS?.maximum
      ?? WHEEL_MOUTH_LIMITS?.max
      ?? WHEEL_MOUTH_LIMITS?.mouthCount?.maximum
      ?? WHEEL_AUDIO_VOICE_COUNT,
    1,
    WHEEL_AUDIO_VOICE_COUNT,
    WHEEL_AUDIO_VOICE_COUNT,
  ));
}

function contextConstructor(runtime) {
  return runtime?.AudioContext ?? runtime?.webkitAudioContext;
}

function currentParamValue(parameter, fallback = 0) {
  return finite(parameter?.value, fallback);
}

function setParamValue(parameter, value, time) {
  if (!parameter) return;
  const target = finite(value);
  if (typeof parameter.setValueAtTime === "function") {
    parameter.setValueAtTime(target, time);
  } else {
    parameter.value = target;
  }
}

function holdParam(parameter, time, fallback = 0) {
  if (!parameter) return;
  if (typeof parameter.cancelAndHoldAtTime === "function") {
    try {
      parameter.cancelAndHoldAtTime(time);
      return;
    } catch {
      // Safari versions that expose but reject cancelAndHoldAtTime use the
      // conservative cancellation path below.
    }
  }
  parameter.cancelScheduledValues?.(time);
  setParamValue(parameter, currentParamValue(parameter, fallback), time);
}

function smoothParam(parameter, value, time, timeConstant = 0.018) {
  if (!parameter) return;
  const target = finite(value);
  holdParam(parameter, time, target);
  if (typeof parameter.setTargetAtTime === "function") {
    parameter.setTargetAtTime(target, time, Math.max(0.001, timeConstant));
  } else if (typeof parameter.linearRampToValueAtTime === "function") {
    parameter.linearRampToValueAtTime(target, time + Math.max(0.001, timeConstant * 3));
  } else {
    parameter.value = target;
  }
}

function rampParam(parameter, value, startTime, duration, fallback = 0) {
  if (!parameter) return;
  const target = finite(value, fallback);
  holdParam(parameter, startTime, fallback);
  if (typeof parameter.linearRampToValueAtTime === "function") {
    parameter.linearRampToValueAtTime(target, startTime + Math.max(0.001, duration));
  } else {
    setParamValue(parameter, target, startTime);
  }
}

function disconnect(node) {
  try {
    node?.disconnect?.();
  } catch {
    // A partially built or already disconnected graph is safe to discard.
  }
}

function stop(node, when) {
  try {
    node?.stop?.(when);
  } catch {
    // Oscillators and buffer sources throw when stopped more than once.
  }
}

function connect(source, destination) {
  source?.connect?.(destination);
  return destination;
}

function softClipCurve(size = 1_025) {
  const curve = new Float32Array(size);
  const drive = 2.4;
  const normalization = Math.tanh(drive);
  for (let index = 0; index < size; index += 1) {
    const input = index / (size - 1) * 2 - 1;
    curve[index] = Math.tanh(input * drive) / normalization;
  }
  return curve;
}

const VOICE_CLIP_CURVE = softClipCurve();

function fillNoiseBuffer(buffer) {
  if (!buffer || typeof buffer.getChannelData !== "function") return;
  const samples = buffer.getChannelData(0);
  let seed = 0x6d2b79f5;
  let brown = 0;
  for (let index = 0; index < samples.length; index += 1) {
    seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x9e3779b9) >>> 0;
    const white = seed / 0x80000000 - 1;
    brown = brown * 0.965 + white * 0.035;
    samples[index] = clamp(white * 0.72 + brown * 1.8, -1, 1, 0);
  }
}

function arrayValue(source, index, fallback) {
  if (Array.isArray(source) || ArrayBuffer.isView(source)) {
    return firstFinite([source[index]], fallback);
  }
  if (source && typeof source === "object") {
    return firstFinite([
      source[index],
      source[index + 1],
      source[`f${index + 1}`],
      source[`formant${index + 1}`],
    ], fallback);
  }
  return fallback;
}

function fourthFormant(formants) {
  const third = arrayValue(formants, 2, DEFAULT_FORMANTS[2]);
  return clamp(third * 1.48 + 280, 3_100, 7_600, DEFAULT_FORMANTS[3]);
}

function normalizeVoiceParameters(raw, mouth = {}, index = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  const articulation = source.articulation && typeof source.articulation === "object"
    ? source.articulation
    : {};
  const profile = source.profile && typeof source.profile === "object"
    ? source.profile
    : articulation;
  const noise = source.noise && typeof source.noise === "object" ? source.noise : {};
  const burst = source.burst && typeof source.burst === "object" ? source.burst : {};
  const nasal = source.nasal && typeof source.nasal === "object" ? source.nasal : {};
  const formantSource = source.formants ?? profile.formants;
  const bandwidthSource = source.bandwidths ?? profile.bandwidths;
  const gainSource = source.formantGains ?? source.peakGains ?? profile.formantGains;
  const formants = Array.from({ length: 4 }, (_, formantIndex) => {
    const fallback = formantIndex === 3
      ? fourthFormant(formantSource)
      : DEFAULT_FORMANTS[formantIndex];
    return clamp(
      arrayValue(formantSource, formantIndex, fallback),
      formantIndex === 0 ? 80 : 180,
      MAX_FREQUENCY,
      fallback,
    );
  });
  const bandwidths = Array.from({ length: 4 }, (_, formantIndex) => clamp(
    arrayValue(bandwidthSource, formantIndex, DEFAULT_BANDWIDTHS[formantIndex]),
    24,
    2_400,
    DEFAULT_BANDWIDTHS[formantIndex],
  ));
  const formantGains = Array.from({ length: 4 }, (_, formantIndex) => {
    const fallback = DEFAULT_FORMANT_GAINS[formantIndex];
    const supplied = arrayValue(gainSource, formantIndex, fallback);
    // Throatazoid's vocal model expresses the first three weights linearly,
    // while BiquadFilterNode's peaking gain is in dB. Keep explicit dB patches
    // intact and translate the model's 0..1 envelope into useful resonances.
    const decibels = formantIndex < 3 && supplied >= 0 && supplied <= 1.25
      ? supplied * 14
      : supplied;
    return clamp(decibels, -12, 18, fallback);
  });
  const manner = firstString([
    source.manner,
    profile.manner,
    articulation.manner,
  ], "vowel").toLowerCase();
  const voicedValue = source.voiced ?? profile.voiced ?? articulation.voiced;
  const voiced = voicedValue === undefined ? true : Boolean(voicedValue);
  const voicing = clamp(
    firstFinite([source.voicing, source.voicingGain, profile.voicing], voiced ? 1 : 0),
  );
  const noiseGain = clamp(firstFinite([
    noise.gain,
    source.noiseGain,
    source.frication,
    profile.noiseGain,
  ], NOISY_MANNERS.has(manner) ? 0.52 : 0.035));
  const burstGain = clamp(firstFinite([
    burst.gain,
    source.burstGain,
    profile.burstGain,
  ], STOP_MANNERS.has(manner) || manner === "affricate" ? 0.68 : 0));
  const active = source.active === undefined
    ? !(mouth?.muted || mouth?.active === false)
    : Boolean(source.active);

  return {
    active,
    manner,
    voiced,
    voicing,
    frequency: clamp(firstFinite([
      source.frequency,
      source.frequencyHz,
      source.fundamentalHz,
      source.f0,
      source.pitchHz,
    ], 98 * 2 ** (index / 36)), MIN_FREQUENCY, 2_400, 98),
    formants,
    bandwidths,
    formantGains,
    highpass: clamp(firstFinite([
      source.highpass,
      source.highpassFrequency,
    ], 42 + (1 - clamp(mouth?.aperture, 0, 1, 0.55)) * 90), 20, 1_200, 70),
    lowpass: clamp(firstFinite([
      source.lowpass,
      source.lowpassFrequency,
    ], 5_800 + clamp(mouth?.aperture, 0, 1, 0.55) * 6_500), 1_000, MAX_FREQUENCY, 9_000),
    gain: clamp(firstFinite([source.gain, source.level, mouth?.gain], 0.46), 0, 1, 0.46),
    pan: clamp(firstFinite([source.pan, mouth?.pan], 0), -1, 1, 0),
    pull: clamp(firstFinite([source.pull], mouth?.pull), 0, 1, 0.3),
    tongue: clamp(firstFinite([source.tongue], mouth?.tongue), 0, 1, 0.5),
    aperture: clamp(firstFinite([source.aperture], mouth?.aperture), 0, 1, 0.55),
    glottalTension: clamp(firstFinite([
      source.glottalTension,
      source.tenseness,
      mouth?.glottalTension,
      mouth?.glottis,
    ], 0.58), 0, 1, 0.58),
    breath: clamp(firstFinite([source.breath, mouth?.breath], 0.08), 0, 1, 0.08),
    oralClosure: clamp(firstFinite([
      source.oralClosure,
      profile.oralClosure,
    ], STOP_MANNERS.has(manner) ? 0.9 : 0), 0, 1, 0),
    glottalClosure: clamp(firstFinite([source.glottalClosure], 0), 0, 1, 0),
    noiseGain,
    noiseFrequency: clamp(firstFinite([
      noise.frequency,
      source.noiseFrequency,
    ], manner === "sibilant" || manner === "fricative" ? 5_800 : 2_400), 120, MAX_FREQUENCY, 3_200),
    noiseQ: clamp(firstFinite([noise.q, source.noiseQ], 1.2), 0.1, 28, 1.2),
    burstGain,
    burstFrequency: clamp(firstFinite([
      burst.frequency,
      source.burstFrequency,
    ], 3_200), 120, MAX_FREQUENCY, 3_200),
    burstQ: clamp(firstFinite([burst.q, source.burstQ], 0.82), 0.1, 28, 0.82),
    burstHalfLife: clamp(firstFinite([
      burst.halfLife,
      source.burstHalfLife,
    ], 0.018), 0.003, 0.12, 0.018),
    burstDuration: clamp(firstFinite([
      burst.duration,
      source.burstDuration,
    ], 0.075), 0.008, 0.3, 0.075),
    nasalGain: clamp(firstFinite([
      nasal.gain,
      source.nasalGain,
      profile.nasalGain,
    ], 0), 0, 1, 0),
    nasalCoupling: clamp(firstFinite([
      nasal.coupling,
      source.nasalCoupling,
      profile.nasalCoupling,
    ], 0), 0, 1, 0),
    nasalPoleFrequency: clamp(firstFinite([
      nasal.poleFrequency,
      source.nasalPoleFrequency,
    ], 280), 80, 2_400, 280),
    nasalNotchFrequency: clamp(firstFinite([
      nasal.notchFrequency,
      source.nasalNotchFrequency,
    ], 1_100), 120, 6_000, 1_100),
    nasalQ: clamp(firstFinite([
      nasal.q,
      source.nasalQ,
    ], 2), 0.2, 30, 2),
    pinch: clamp(firstFinite([source.pinch, source.constriction], mouth?.pinch), 0, 1, 0.2),
    push: clamp(firstFinite([source.push], mouth?.push), 0, 1, 0.4),
    nasality: clamp(firstFinite([source.nasality], mouth?.nasality), 0, 1, 0.4),
    screech: clamp(firstFinite([source.screech], mouth?.screech), 0, 1, 0.2),
    pressure: clamp(firstFinite([
      source.pressure,
      source.timbre?.pressure,
      mouth?.pressure,
    ], mouth?.push), 0, 1, 0.5),
    timbreDrive: clamp(firstFinite([
      source.timbreDrive,
      source.timbre?.drive,
    ], 0.4), 0, 1, 0.4),
    brightness: clamp(firstFinite([
      source.brightness,
      source.timbre?.brightness,
    ], 0.5), 0, 1, 0.5),
    slime: clamp(firstFinite([source.slime, source.wetness], mouth?.slime), 0, 1, 0),
    dirt: clamp(firstFinite([source.dirt, source.internalNoise], mouth?.dirt), 0, 1, 0),
    depth: clamp(firstFinite([source.depth], mouth?.depth), 0, 1, 0),
    size: clamp(
      firstFinite([source.size], mouth?.size),
      WHEEL_MORPH_LIMITS.size.minimum,
      WHEEL_MORPH_LIMITS.size.maximum,
      WHEEL_MORPH_LIMITS.size.default,
    ),
    stretch: clamp(
      firstFinite([source.stretch], mouth?.stretch),
      WHEEL_MORPH_LIMITS.stretch.minimum,
      WHEEL_MORPH_LIMITS.stretch.maximum,
      WHEEL_MORPH_LIMITS.stretch.default,
    ),
    tongueOut: clamp(firstFinite([
      source.tongueOut,
      source.tongueExtension,
    ], mouth?.tongueOut), 0, 1, 0.12),
  };
}

function expressionValue(mouth, globals, key, fallback) {
  return clamp(firstFinite([
    mouth?.[key],
    globals?.[key],
  ], fallback), 0, 1, fallback);
}

function logarithmicDeviation(value, limits) {
  const neutral = clamp(limits?.default, 0.001, 100, 1);
  const bounded = clamp(value, limits?.minimum, limits?.maximum, neutral);
  const offset = Math.log2(bounded / neutral);
  const extent = offset < 0
    ? Math.abs(Math.log2(clamp(limits?.minimum, 0.001, neutral, neutral) / neutral))
    : Math.abs(Math.log2(clamp(limits?.maximum, neutral, 100, neutral) / neutral));
  return extent > 0 ? clamp(Math.abs(offset) / extent, 0, 1, 0) : 0;
}

function geometricDeformation(profile) {
  const components = [
    profile.pull,
    profile.push,
    profile.pinch,
    profile.tongueOut,
    profile.sizeDeviation,
    profile.stretchDeviation,
    Math.abs(profile.aperture - 0.55) / 0.55,
    Math.abs(profile.tongue - 0.5) * 2,
  ].map((value) => clamp(value, 0, 1, 0));
  const strongest = Math.max(...components);
  const rms = Math.sqrt(
    components.reduce((sum, value) => sum + value * value, 0) / components.length,
  );
  // One grotesquely stretched feature is enough to color the voice. Multiple
  // simultaneous mutations push the wet/noisy anatomy toward its safe ceiling.
  return clamp(strongest * 0.62 + rms * 0.52, 0, 1, 0);
}

function sequenceArray(value, { numericArrayIsOne = false } = {}) {
  if (Array.isArray(value)) {
    if (numericArrayIsOne && value.length > 0 && value.every(Number.isFinite)) {
      return [value];
    }
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const pieces = value.split(/\s*(?:\+|>|\/|,)\s*/).filter(Boolean);
    return pieces.length > 0 ? pieces : [value];
  }
  return [];
}

function articulationDescriptor(value) {
  if (typeof value === "string" && value.trim()) {
    return { articulation: value.trim().toLowerCase() };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const articulation = firstString([
    value.articulation,
    value.phoneme,
    value.id,
    value.value,
  ], "").toLowerCase();
  if (!articulation) return null;
  return {
    articulation,
    carrierLetter: firstString([
      value.carrierLetter,
      value.carrier,
    ], "") || null,
    carrierFormants: Array.isArray(value.carrierFormants)
      ? value.carrierFormants
      : Array.isArray(value.formants) ? value.formants : null,
  };
}

function articulationDescriptors(globals = {}) {
  const sequence = sequenceArray(globals.articulationSequence)
    .map(articulationDescriptor)
    .filter(Boolean)
    .slice(0, 2);
  if (sequence.length > 0) return sequence;
  const fallback = articulationDescriptor(globals.articulation);
  return fallback ? [fallback] : [];
}

function carrierDescriptor(value) {
  if (Array.isArray(value) && value.length >= 3 && value.every(Number.isFinite)) {
    return { carrierLetter: null, carrierFormants: value.slice(0, 3), articulation: null };
  }
  if (typeof value === "string" && value.trim()) {
    return { carrierLetter: value.trim().toUpperCase(), carrierFormants: null, articulation: null };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const formants = Array.isArray(value.carrierFormants)
    ? value.carrierFormants
    : Array.isArray(value.formants) ? value.formants : null;
  const letter = firstString([
    value.carrierLetter,
    value.carrier,
    value.letter,
    value.id,
  ], "").toUpperCase();
  const articulation = firstString([
    value.articulation,
    value.phoneme,
  ], "").toLowerCase();
  if (!formants && !letter && !articulation) return null;
  return {
    carrierLetter: letter || null,
    carrierFormants: formants,
    articulation: articulation || null,
  };
}

function carrierDescriptors(globals = {}, forceFallback = false) {
  const sequence = sequenceArray(
    globals.carrierSequence,
    { numericArrayIsOne: true },
  ).map(carrierDescriptor).filter(Boolean).slice(0, 2);
  if (sequence.length > 0) return sequence;
  const explicit = carrierDescriptor(
    globals.carrierFormants
      ?? globals.carrierLetter
      ?? globals.nextLetter,
  );
  if (explicit) return [explicit];
  return forceFallback ? [carrierDescriptor("AX")] : [];
}

function carrierArticulation(descriptor, globals = {}) {
  if (descriptor?.articulation) return descriptor.articulation;
  const carrier = String(descriptor?.carrierLetter ?? "").trim().toUpperCase();
  if (CARRIER_ARTICULATIONS[carrier]) return CARRIER_ARTICULATIONS[carrier];
  const next = String(globals.nextLetter ?? "").trim().toUpperCase();
  return CARRIER_ARTICULATIONS[next] ?? "a";
}

function makeProfile(mouth, globals, index) {
  let calculated = null;
  try {
    calculated = wheelVocalParameters(mouth ?? {}, globals ?? {});
  } catch {
    // A half-edited external patch must not take down the already running
    // audio graph; the normalized neutral voice remains playable.
  }
  const normalized = normalizeVoiceParameters(calculated, mouth, index);
  const explicitMouthPan = Number(mouth?.pan);
  const explicitGlobalPan = Number(globals?.pan);
  if (!Number.isFinite(explicitMouthPan) && !Number.isFinite(explicitGlobalPan)) {
    const count = Math.round(clamp(
      globals?.mouthCount ?? globals?.count ?? WHEEL_MOUTH_LIMITS?.default,
      1,
      WHEEL_AUDIO_VOICE_COUNT,
      8,
    ));
    const spread = clamp(globals?.spread, 0, 1, 0.78);
    normalized.pan = Math.sin(index / count * Math.PI * 2) * spread;
  } else if (Number.isFinite(explicitMouthPan)) {
    normalized.pan = clamp(explicitMouthPan, -1, 1, 0);
  }
  normalized.growl = clamp(
    globals?.growl ?? globals?.organGrowl,
    0,
    1,
    0,
  );
  normalized.pull = expressionValue(mouth, globals, "pull", normalized.pull);
  normalized.tongue = expressionValue(mouth, globals, "tongue", normalized.tongue);
  normalized.aperture = expressionValue(mouth, globals, "aperture", normalized.aperture);
  normalized.glottalTension = expressionValue(
    mouth,
    globals,
    "glottalTension",
    normalized.glottalTension,
  );
  normalized.breath = expressionValue(mouth, globals, "breath", normalized.breath);
  const expression = expressionValue(mouth, globals, "expression", 0.46);
  normalized.nasality = expressionValue(
    mouth,
    globals,
    "nasality",
    normalized.nasality ?? (0.2 + expression * 0.18),
  );
  normalized.screech = expressionValue(
    mouth,
    globals,
    "screech",
    normalized.screech ?? (0.1 + expression * 0.18),
  );
  normalized.pressure = expressionValue(
    mouth,
    globals,
    "pressure",
    normalized.pressure ?? normalized.push ?? (0.46 + expression * 0.28),
  );
  normalized.pinch = expressionValue(
    mouth,
    globals,
    "pinch",
    normalized.pinch ?? (0.2 + expression * 0.3),
  );
  normalized.push = expressionValue(
    mouth,
    globals,
    "push",
    normalized.push ?? (0.18 + expression * 0.26),
  );
  normalized.slime = expressionValue(
    mouth,
    globals,
    "slime",
    normalized.slime ?? 0,
  );
  normalized.dirt = clamp(firstFinite([
    mouth?.dirt,
    mouth?.noise,
    globals?.dirt,
    globals?.noise,
    normalized.dirt,
  ], 0), 0, 1, 0);
  normalized.depth = expressionValue(
    mouth,
    globals,
    "depth",
    normalized.depth ?? 0,
  );
  normalized.size = clamp(
    firstFinite([mouth?.size, globals?.size, normalized.size], WHEEL_MORPH_LIMITS.size.default),
    WHEEL_MORPH_LIMITS.size.minimum,
    WHEEL_MORPH_LIMITS.size.maximum,
    WHEEL_MORPH_LIMITS.size.default,
  );
  normalized.stretch = clamp(
    firstFinite(
      [mouth?.stretch, globals?.stretch, normalized.stretch],
      WHEEL_MORPH_LIMITS.stretch.default,
    ),
    WHEEL_MORPH_LIMITS.stretch.minimum,
    WHEEL_MORPH_LIMITS.stretch.maximum,
    WHEEL_MORPH_LIMITS.stretch.default,
  );
  normalized.tongueOut = clamp(firstFinite([
    mouth?.tongueOut,
    mouth?.tongueExtension,
    globals?.tongueOut,
    normalized.tongueOut,
  ], 0.12), 0, 1, 0.12);
  normalized.expression = expression;
  normalized.sizeDeviation = logarithmicDeviation(normalized.size, WHEEL_MORPH_LIMITS.size);
  normalized.stretchDeviation = logarithmicDeviation(
    normalized.stretch,
    WHEEL_MORPH_LIMITS.stretch,
  );
  normalized.deformation = geometricDeformation(normalized);
  const glottalDeviation = Math.abs(normalized.glottalTension - 0.5) * 2;
  normalized.intensity = clamp(
    normalized.deformation * 0.7
      + normalized.push * 0.18
      + normalized.screech * 0.14
      + normalized.breath * 0.12
      + glottalDeviation * 0.1,
    0,
    1,
    normalized.deformation,
  );
  const sizeOctaves = Math.log2(normalized.size / WHEEL_MORPH_LIMITS.size.default);
  const stretchOctaves = Math.log2(
    normalized.stretch / WHEEL_MORPH_LIMITS.stretch.default,
  );
  const depthSemitones = normalized.depth * 6
    + sizeOctaves * 5.2
    + stretchOctaves * 3.4;
  const tractScale = 2 ** (-depthSemitones / 12);
  const tongueOffset = normalized.tongue - 0.5;
  const apertureOffset = normalized.aperture - 0.5;
  normalized.formants = normalized.formants.map((frequency, formantIndex) => clamp(
    frequency
      * tractScale
      * clamp(
        1
          + (formantIndex === 0
            ? apertureOffset * 0.24 - tongueOffset * 0.14 - normalized.tongueOut * 0.1
              - normalized.pinch * 0.1
            : tongueOffset * (formantIndex === 1 ? 0.38 : 0.1)
              + normalized.tongueOut * (0.12 + formantIndex * 0.035)
              + normalized.screech * (formantIndex >= 2 ? 0.09 : 0.02)),
        0.58,
        1.65,
        1,
      ),
    formantIndex === 0 ? 80 : 180,
    MAX_FREQUENCY,
    frequency,
  ));
  normalized.frequency = clamp(
    normalized.frequency
      * 2 ** (-(normalized.depth * 2.2 + sizeOctaves * 1.4 + stretchOctaves * 0.8) / 12),
    MIN_FREQUENCY,
    2_400,
    normalized.frequency,
  );
  normalized.lowpass = clamp(
    normalized.lowpass * clamp(
      1
        - normalized.depth * 0.4
        - normalized.deformation * 0.12
        + normalized.screech * 0.28
        + apertureOffset * 0.12,
      0.38,
      1.34,
      0.82,
    ),
    720,
    MAX_FREQUENCY,
    normalized.lowpass,
  );
  normalized.noiseFrequency = clamp(
    normalized.noiseFrequency
      * (0.72
        + normalized.tongue * 0.55
        + normalized.tongueOut * 0.55
        + normalized.screech * 0.38)
      * normalized.size ** -0.12
      * normalized.stretch ** -0.08,
    120,
    MAX_FREQUENCY,
    normalized.noiseFrequency,
  );
  return normalized;
}

function voicedLevel(profile) {
  if (!profile.active) return 0;
  const base = profile.voiced ? 0.46 : 0.008;
  return clamp(
    base
      * profile.voicing
      * (0.72 + profile.pressure * 0.28)
      * (0.84 + profile.glottalTension * 0.16)
      * (1 - profile.breath * 0.48)
      * (1 - profile.screech * 0.12)
      * (1 - profile.intensity * 0.2),
    0,
    0.52,
    0,
  );
}

function sourceDrive(profile) {
  return clamp(
    0.58
      + profile.growl * 0.52
      + profile.pressure * 0.28
      + profile.push * 0.24
      + profile.pinch * 0.12
      + profile.intensity * 0.22,
    0.5,
    1.58,
    0.72,
  );
}

function oralLevel(profile) {
  return clamp(
    0.3
      + profile.aperture * 0.34
      - profile.nasality * 0.11
      - profile.slime * 0.1
      - profile.breath * 0.08
      - profile.deformation * 0.1,
    0.16,
    0.68,
    0.42,
  );
}

function nasalLevel(profile) {
  if (!profile.active) return 0;
  const modeled = profile.nasalGain * profile.nasalCoupling;
  return clamp(
    modeled * (profile.manner === "nasal" ? 0.72 : profile.nasality * 0.5)
      + profile.nasality * (0.48 + profile.pinch * 0.2 + profile.depth * 0.12)
      + profile.deformation * (0.12 + profile.pinch * 0.12 + profile.pull * 0.06),
    0,
    0.92,
    0,
  );
}

function profileNoiseLevel(profile, forceNoisy = null) {
  const noisy = forceNoisy ?? (
    NOISY_MANNERS.has(profile.manner) || profile.noiseGain > 0.2
  );
  return clamp(
    profile.noiseGain * (noisy ? 0.58 : 0.22)
      + profile.breath * 0.28
      + profile.growl * 0.06
      + profile.screech * 0.12
      + profile.dirt * 0.28
      + profile.tongueOut * 0.08
      + profile.pinch * profile.push * 0.14
      + profile.deformation * 0.16
      + profile.intensity * 0.1,
    0,
    0.82,
    0,
  );
}

function slimeWetLevel(profile) {
  return clamp(
    profile.slime * (
      0.28
        + profile.pressure * 0.18
        + profile.depth * 0.16
        + profile.aperture * 0.08
        + profile.nasality * 0.1
    )
      + profile.deformation * (0.12 + profile.depth * 0.08 + profile.pull * 0.06)
      + profile.intensity * 0.05,
    0,
    0.68,
    0,
  );
}

function slimeDelaySeconds(profile) {
  return clamp(
    0.004
      + profile.slime * 0.016
      + profile.depth * 0.012
      + profile.pull * 0.008
      + profile.sizeDeviation * 0.006
      + profile.stretchDeviation * 0.006
      + profile.deformation * 0.006,
    0.003,
    0.05,
    0.012,
  );
}

function slimeFrequency(profile) {
  return clamp(
    (1_150 - profile.depth * 560)
      * profile.size ** -0.34
      * profile.stretch ** -0.18
      * (0.78
        + profile.tongue * 0.35
        + profile.tongueOut * 0.55
        + profile.screech * 0.35),
    140,
    3_600,
    620,
  );
}

function slimeResonance(profile) {
  return clamp(
    1.2
      + profile.slime * 8
      + profile.pinch * 7
      + profile.screech * 2.5
      + profile.deformation * 4,
    0.7,
    20,
    3.2,
  );
}

function slimeFeedbackLevel(profile) {
  return clamp(
    profile.slime * (0.14 + profile.depth * 0.12 + profile.nasality * 0.06)
      + profile.deformation * 0.1,
    0,
    0.32,
    0,
  );
}

function highpassFrequency(profile) {
  return clamp(
    profile.highpass
      + profile.pinch * 360
      + (1 - profile.aperture) * 190
      + profile.tongueOut * 140
      + profile.intensity * 100,
    20,
    1_800,
    profile.highpass,
  );
}

function anatomyFrequencyScale(profile) {
  return 2 ** (-(
    profile.depth * 4
      + Math.max(0, Math.log2(profile.size)) * 2.2
      + Math.max(0, Math.log2(profile.stretch)) * 1.2
  ) / 12);
}

function throatPeakFrequency(profile) {
  return clamp(
    (360
      + profile.pinch * 1_500
      + profile.screech * 3_600
      + profile.tongueOut * 850
      + profile.tongue * 480
      + profile.pull * 350)
      * anatomyFrequencyScale(profile),
    240,
    7_200,
    920,
  );
}

function throatPeakQ(profile) {
  return clamp(
    1
      + profile.pinch * 12
      + profile.screech * 5
      + profile.intensity * 4
      + profile.glottalTension * 2,
    0.7,
    22,
    2.4,
  );
}

function throatPeakGain(profile) {
  return clamp(
    1
      + profile.pinch * 9
      + profile.screech * 11
      + profile.push * 4
      + profile.intensity * 4,
    0,
    20,
    4,
  );
}

function throatNotchFrequency(profile) {
  return clamp(
    (760
      + profile.pinch * 1_800
      + profile.screech * 2_600
      + profile.tongueOut * 1_200
      + profile.tongue * 600
      + profile.stretchDeviation * 500)
      * anatomyFrequencyScale(profile),
    420,
    7_600,
    1_850,
  );
}

function throatNotchQ(profile) {
  return clamp(
    0.7
      + profile.pinch * 10
      + profile.screech * 4
      + profile.deformation * 4,
    0.4,
    18,
    1.4,
  );
}

function nasalPoleFrequency(profile) {
  return clamp(
    profile.nasalPoleFrequency
      * profile.size ** -0.22
      * 2 ** (-profile.depth * 4 / 12)
      * (1 + profile.tongueOut * 0.18),
    80,
    2_500,
    280,
  );
}

function nasalPoleQ(profile) {
  return clamp(
    profile.nasalQ * (
      0.75
        + profile.pinch * 1.4
        + profile.nasality * 0.9
        + profile.deformation * 0.65
    ),
    0.2,
    24,
    2,
  );
}

function nasalPoleGain(profile) {
  return clamp(
    4
      + profile.nasalCoupling * 10
      + profile.nasality * 9
      + profile.deformation * 5
      + profile.pinch * 3,
    4,
    22,
    5,
  );
}

function nasalNotchFrequency(profile) {
  return clamp(
    profile.nasalNotchFrequency
      * profile.stretch ** -0.12
      * (1 + profile.pinch * 0.4 + profile.tongue * 0.15 + profile.screech * 0.2),
    120,
    7_200,
    1_100,
  );
}

function formantQ(profile, frequency, index) {
  return clamp(
    frequency / (
      profile.bandwidths[index]
        * (1
          + profile.growl * 0.72
          + profile.breath * 0.48
          + profile.deformation * 0.32)
    )
      + profile.pinch * (index < 2 ? 2.2 : 0.7),
    0.25,
    38,
    6,
  );
}

function formantGain(profile, index) {
  return clamp(
    profile.formantGains[index]
      + profile.screech * (index >= 2 ? 8 : 2.4)
      + profile.deformation * (index === 0 ? 2.5 : 4.5)
      + profile.aperture * (index === 0 ? 2.2 : 0.8),
    -12,
    20,
    profile.formantGains[index],
  );
}

function coarticulationWindow(globals, options, duration) {
  const milliseconds = firstFinite([
    options?.coarticulationMs,
    globals?.coarticulationMs,
    globals?.morphMs,
  ], NaN);
  const seconds = firstFinite([
    options?.coarticulationSeconds,
    globals?.coarticulationSeconds,
    globals?.morphSeconds,
  ], Number.isFinite(milliseconds) ? milliseconds / 1_000 : 0.052);
  const requested = clamp(seconds, 0.035, 0.08, 0.052);
  return Math.min(requested, Math.max(0.018, duration * 0.56));
}

function carrierProfile(mouth, globals, descriptor, index) {
  const articulation = carrierArticulation(descriptor, globals);
  const carrierLetter = descriptor?.carrierLetter
    ?? globals.carrierLetter
    ?? globals.nextLetter
    ?? "AX";
  const targetMouth = {
    ...mouth,
    letter: ({ a: "A", e: "E", i: "I", o: "O", u: "U" })[articulation]
      ?? mouth?.letter,
  };
  return makeProfile(targetMouth, {
    ...globals,
    phase: "hold",
    articulation,
    carrierLetter,
    carrierFormants: descriptor?.carrierFormants ?? globals.carrierFormants,
  }, index);
}

function coarticulationTargets(mouth, globals, onsetProfile, index) {
  const articulations = articulationDescriptors(globals);
  const carriers = carrierDescriptors(globals, false);
  const targets = articulations.slice(1).map((descriptor, offset) => {
    const carrier = carriers[offset + 1] ?? carriers.at(-1) ?? null;
    return makeProfile(mouth, {
      ...globals,
      phase: "hold",
      articulation: descriptor.articulation,
      carrierLetter: descriptor.carrierLetter ?? carrier?.carrierLetter ?? null,
      carrierFormants: descriptor.carrierFormants ?? carrier?.carrierFormants ?? null,
    }, index);
  });
  const articulatedCarrier = [...articulations].reverse().find((descriptor) => (
    descriptor.carrierLetter || descriptor.carrierFormants
  ));
  const carrierGlobals = articulatedCarrier
    ? {
      ...globals,
      carrierLetter: globals.carrierLetter ?? articulatedCarrier.carrierLetter,
      carrierFormants: globals.carrierFormants ?? articulatedCarrier.carrierFormants,
    }
    : globals;
  const resolvedCarriers = carrierDescriptors(
    carrierGlobals,
    onsetProfile.manner !== "vowel" || articulations.length > 1,
  );
  const lastArticulationProfile = targets.at(-1) ?? onsetProfile;
  if (lastArticulationProfile.manner !== "vowel") {
    const descriptor = resolvedCarriers.at(-1) ?? carrierDescriptor("AX");
    targets.push(carrierProfile(mouth, carrierGlobals, descriptor, index));
  } else if (articulations.length <= 1 && resolvedCarriers.length > 0) {
    for (const descriptor of resolvedCarriers) {
      targets.push(carrierProfile(mouth, carrierGlobals, descriptor, index));
    }
  }
  return targets.slice(0, 3);
}

function coarticulationWeights(globals, targetCount) {
  if (targetCount <= 0) return [];
  const supplied = Array.isArray(globals?.sequenceWeights)
    ? globals.sequenceWeights.map((value) => Math.max(0, finite(value, 0)))
    : [];
  const aligned = supplied.length >= targetCount
    ? supplied.slice(-targetCount)
    : Array.from({ length: targetCount }, (_, index) => supplied[index] ?? 1);
  const total = aligned.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return Array(targetCount).fill(1 / targetCount);
  return aligned.map((value) => value / total);
}

function startTime(context, options = {}) {
  const now = finite(context?.currentTime, 0);
  const absolute = firstFinite([options.when, options.startAt], NaN);
  if (Number.isFinite(absolute)) return Math.max(now, absolute);
  return now + clamp(options.delay, 0, 2, 0);
}

function eventDuration(options, fallback = 0.34) {
  return clamp(options?.duration, 0.045, 8, fallback);
}

function eventVelocity(options) {
  return clamp(options?.velocity, 0, 1, 1);
}

/** A twelve-mouth, no-allocation-during-performance formant synthesizer. */
export class WheelOfOrgansAudio {
  constructor(options = {}) {
    const settings = options && typeof options === "object" ? options : {};
    this.runtime = settings.runtime ?? globalThis;
    this.desiredLevel = clamp(settings.level, 0, LEVEL_CEILING, 0.64);
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.releaseAudioOutput = null;
    this.voiceBus = null;
    this.noiseSource = null;
    this.noiseBuffer = null;
    this.vibrato = null;
    this.vibratoDepth = null;
    this.voices = [];
    this.waveCache = new Map();
    this.enabled = false;
    this.startPromise = null;
    this.pendingMouths = [];
    this.pendingGlobals = {};
  }

  get running() {
    return Boolean(this.enabled && this.context?.state === "running");
  }

  get isEnabled() {
    return this.enabled;
  }

  /** Absolute AudioContext time at which an explicitly released voice is silent. */
  get decayUntil() {
    if (!this.enabled || !this.context) return 0;
    const now = finite(this.context.currentTime, 0);
    let latest = 0;
    for (const voice of this.voices) {
      if (!voice.gated && Number.isFinite(voice.releaseAt) && voice.releaseAt > now) {
        latest = Math.max(latest, voice.releaseAt);
      }
    }
    return latest;
  }

  /** Remaining explicit release time in AudioContext seconds. */
  get decayRemaining() {
    if (!this.context) return 0;
    return Math.max(0, this.decayUntil - finite(this.context.currentTime, 0));
  }

  get isDecaying() {
    return this.decayRemaining > 0;
  }

  async enable() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#enableInternal();
    try {
      await this.startPromise;
      return this;
    } finally {
      this.startPromise = null;
    }
  }

  async #enableInternal() {
    if (this.context?.state === "closed") this.#resetGraph();
    if (!this.context) this.#buildGraph();
    if (!this.context || !this.master) {
      throw new Error("Web Audio could not be initialized.");
    }
    try {
      if (this.context.state !== "running") await this.context.resume?.();
      this.enabled = true;
      this.syncMouths(this.pendingMouths, this.pendingGlobals);
      const now = finite(this.context.currentTime, 0);
      smoothParam(this.master.gain, this.desiredLevel, now, 0.012);
    } catch (error) {
      this.enabled = false;
      await this.close();
      throw error;
    }
  }

  #buildGraph() {
    const AudioContextConstructor = contextConstructor(this.runtime);
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }
    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    try {
      const compressor = context.createDynamicsCompressor();
      const master = context.createGain();
      compressor.threshold.value = -18;
      compressor.knee.value = 16;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.0025;
      compressor.release.value = 0.18;
      master.gain.value = 0;
      connect(compressor, master);
      this.releaseAudioOutput = connectAudioOutput(context, master, { runtime: this.runtime });

      const vibrato = context.createOscillator();
      const vibratoDepth = context.createGain();
      vibrato.type = "sine";
      vibrato.frequency.value = 5.3;
      vibratoDepth.gain.value = 0;
      connect(vibrato, vibratoDepth);

      const bufferLength = Math.max(1_024, Math.round(finite(context.sampleRate, 48_000) * 2));
      const noiseBuffer = context.createBuffer(1, bufferLength, finite(context.sampleRate, 48_000));
      fillNoiseBuffer(noiseBuffer);
      const noiseSource = context.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      this.context = context;
      this.compressor = compressor;
      this.master = master;
      this.voiceBus = compressor;
      this.vibrato = vibrato;
      this.vibratoDepth = vibratoDepth;
      this.noiseSource = noiseSource;
      this.noiseBuffer = noiseBuffer;
      this.#preparePeriodicWaves();
      this.voices = Array.from(
        { length: WHEEL_AUDIO_VOICE_COUNT },
        (_, index) => this.#createVoice(index),
      );

      const now = finite(context.currentTime, 0);
      noiseSource.start(now);
      vibrato.start(now);
      for (const voice of this.voices) voice.oscillator.start(now);
    } catch (error) {
      try { context.close?.(); } catch { /* initialization never completed */ }
      this.#resetGraph();
      throw error;
    }
  }

  #createVoice(index) {
    const context = this.context;
    const oscillator = context.createOscillator();
    const voicedGain = context.createGain();
    const sourceBus = context.createGain();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    const highpass = context.createBiquadFilter();
    const throatPeak = context.createBiquadFilter();
    const throatNotch = context.createBiquadFilter();
    const formants = Array.from({ length: 4 }, () => context.createBiquadFilter());
    const lowpass = context.createBiquadFilter();
    const oralGain = context.createGain();
    const nasalPole = context.createBiquadFilter();
    const nasalNotch = context.createBiquadFilter();
    const nasalGain = context.createGain();
    const hasSlimeDelay = typeof context.createDelay === "function";
    const slimeDelay = hasSlimeDelay
      ? context.createDelay(0.08)
      : context.createGain();
    const slimeFilter = context.createBiquadFilter();
    const slimeWet = context.createGain();
    const slimeFeedback = context.createGain();
    const clipper = context.createWaveShaper();
    const envelope = context.createGain();
    const panner = context.createStereoPanner();

    oscillator.frequency.value = 98 * 2 ** (index / 36);
    voicedGain.gain.value = 0;
    sourceBus.gain.value = 0.62;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 3_200;
    noiseFilter.Q.value = 1.2;
    noiseGain.gain.value = 0;
    highpass.type = "highpass";
    highpass.frequency.value = 55;
    highpass.Q.value = 0.707;
    throatPeak.type = "peaking";
    throatPeak.frequency.value = 920;
    throatPeak.Q.value = 2.4;
    throatPeak.gain.value = 4;
    throatNotch.type = "notch";
    throatNotch.frequency.value = 1_850;
    throatNotch.Q.value = 1.4;
    formants.forEach((filter, formantIndex) => {
      filter.type = "peaking";
      filter.frequency.value = DEFAULT_FORMANTS[formantIndex];
      filter.Q.value = DEFAULT_FORMANTS[formantIndex] / DEFAULT_BANDWIDTHS[formantIndex];
      filter.gain.value = DEFAULT_FORMANT_GAINS[formantIndex];
    });
    lowpass.type = "lowpass";
    lowpass.frequency.value = 9_000;
    lowpass.Q.value = 0.707;
    oralGain.gain.value = 0.42;
    nasalPole.type = "peaking";
    nasalPole.frequency.value = 280;
    nasalPole.Q.value = 2;
    nasalPole.gain.value = 8;
    nasalNotch.type = "notch";
    nasalNotch.frequency.value = 1_100;
    nasalNotch.Q.value = 2;
    nasalGain.gain.value = 0;
    if (slimeDelay.delayTime) slimeDelay.delayTime.value = 0.012;
    slimeFilter.type = "bandpass";
    slimeFilter.frequency.value = 620;
    slimeFilter.Q.value = 3.2;
    slimeWet.gain.value = 0;
    slimeFeedback.gain.value = 0;
    clipper.curve = VOICE_CLIP_CURVE;
    clipper.oversample = "2x";
    envelope.gain.value = 0;
    panner.pan.value = 0;

    connect(oscillator, voicedGain);
    connect(voicedGain, sourceBus);
    connect(this.noiseSource, noiseFilter);
    connect(noiseFilter, noiseGain);
    connect(noiseGain, sourceBus);
    connect(sourceBus, highpass);
    connect(highpass, throatPeak);
    connect(throatPeak, throatNotch);
    let previous = throatNotch;
    for (const filter of formants) previous = connect(previous, filter);
    connect(previous, lowpass);
    connect(lowpass, oralGain);
    connect(oralGain, clipper);
    // The nasal cavity is a permanent parallel resonator. Modeled M/N coupling
    // and extreme mouth deformation can both open it without allocating or
    // reconnecting nodes while the instrument is performing.
    connect(sourceBus, nasalPole);
    connect(nasalPole, nasalNotch);
    connect(nasalNotch, nasalGain);
    connect(nasalGain, clipper);
    connect(sourceBus, slimeDelay);
    connect(slimeDelay, slimeFilter);
    connect(slimeFilter, slimeWet);
    connect(slimeWet, clipper);
    if (hasSlimeDelay) {
      connect(slimeFilter, slimeFeedback);
      connect(slimeFeedback, slimeDelay);
    }
    connect(clipper, envelope);
    connect(envelope, panner);
    connect(panner, this.voiceBus);
    connect(this.vibratoDepth, oscillator.frequency);
    const waveKey = this.#setPeriodicWave(oscillator, 0.58);

    return {
      index,
      oscillator,
      voicedGain,
      sourceBus,
      noiseFilter,
      noiseGain,
      highpass,
      throatPeak,
      throatNotch,
      formants,
      lowpass,
      oralGain,
      nasalPole,
      nasalNotch,
      nasalGain,
      slimeDelay,
      slimeFilter,
      slimeWet,
      slimeFeedback,
      clipper,
      envelope,
      panner,
      profile: null,
      coarticulationTarget: null,
      mouthId: null,
      present: false,
      gated: false,
      releaseAt: -Infinity,
      waveKey,
    };
  }

  #preparePeriodicWaves() {
    if (!this.context || typeof this.context.createPeriodicWave !== "function") return;
    for (let step = 0; step <= 16; step += 1) {
      const key = (step / 16).toFixed(4);
      if (this.waveCache.has(key)) continue;
      try {
        const harmonics = glottalHarmonics(step / 16, 48, 1_024);
        this.waveCache.set(key, this.context.createPeriodicWave(
          harmonics.real,
          harmonics.imaginary,
          { disableNormalization: false },
        ));
      } catch {
        // A browser without custom-wave support falls back per oscillator.
        break;
      }
    }
  }

  #setPeriodicWave(oscillator, tenseness, previousKey = null) {
    if (!oscillator || typeof oscillator.setPeriodicWave !== "function") {
      if (oscillator) oscillator.type = "sawtooth";
      return "fallback";
    }
    const key = (Math.round(clamp(tenseness, 0, 1, 0.58) * 16) / 16).toFixed(4);
    if (key === previousKey) return key;
    try {
      let wave = this.waveCache.get(key);
      if (!wave) {
        const harmonics = glottalHarmonics(Number(key), 48, 1_024);
        wave = this.context.createPeriodicWave(
          harmonics.real,
          harmonics.imaginary,
          { disableNormalization: false },
        );
        this.waveCache.set(key, wave);
      }
      oscillator.setPeriodicWave(wave);
      return key;
    } catch {
      oscillator.type = "sawtooth";
      return "fallback";
    }
  }

  #applyProfile(voice, profile, at, smoothing = 0.016) {
    voice.profile = profile;
    voice.present = profile.active;
    smoothParam(voice.oscillator.frequency, profile.frequency, at, 0.012);
    // Geometry and pressure drive the already-bounded per-voice waveshaper.
    // The oral path is deliberately attenuated below while the permanent
    // cavity/noise paths carry the wet anatomical character.
    smoothParam(
      voice.sourceBus.gain,
      sourceDrive(profile),
      at,
      0.022,
    );
    smoothParam(voice.voicedGain.gain, voicedLevel(profile), at, 0.009);
    smoothParam(voice.highpass.frequency, highpassFrequency(profile), at, smoothing);
    smoothParam(voice.lowpass.frequency, profile.lowpass, at, smoothing);
    smoothParam(voice.oralGain.gain, oralLevel(profile), at, 0.018);
    smoothParam(voice.panner.pan, profile.pan, at, 0.018);
    smoothParam(voice.noiseFilter.frequency, profile.noiseFrequency, at, 0.008);
    smoothParam(voice.noiseFilter.Q, profile.noiseQ, at, 0.012);
    smoothParam(
      voice.throatPeak.frequency,
      throatPeakFrequency(profile),
      at,
      smoothing,
    );
    smoothParam(
      voice.throatPeak.Q,
      throatPeakQ(profile),
      at,
      smoothing,
    );
    smoothParam(
      voice.throatPeak.gain,
      throatPeakGain(profile),
      at,
      smoothing,
    );
    smoothParam(
      voice.throatNotch.frequency,
      throatNotchFrequency(profile),
      at,
      smoothing,
    );
    smoothParam(
      voice.throatNotch.Q,
      throatNotchQ(profile),
      at,
      smoothing,
    );
    const nasalAmount = nasalLevel(profile);
    smoothParam(voice.nasalPole.frequency, nasalPoleFrequency(profile), at, smoothing);
    smoothParam(voice.nasalPole.Q, nasalPoleQ(profile), at, smoothing);
    smoothParam(
      voice.nasalPole.gain,
      nasalPoleGain(profile),
      at,
      smoothing,
    );
    smoothParam(voice.nasalNotch.frequency, nasalNotchFrequency(profile), at, smoothing);
    smoothParam(voice.nasalNotch.Q, nasalPoleQ(profile), at, smoothing);
    smoothParam(voice.nasalGain.gain, nasalAmount, at, 0.018);
    smoothParam(voice.slimeDelay.delayTime, slimeDelaySeconds(profile), at, 0.025);
    smoothParam(voice.slimeFilter.frequency, slimeFrequency(profile), at, smoothing);
    smoothParam(voice.slimeFilter.Q, slimeResonance(profile), at, smoothing);
    smoothParam(voice.slimeWet.gain, slimeWetLevel(profile), at, 0.022);
    smoothParam(voice.slimeFeedback.gain, slimeFeedbackLevel(profile), at, 0.03);
    profile.formants.forEach((frequency, index) => {
      const filter = voice.formants[index];
      smoothParam(filter.frequency, frequency, at, smoothing);
      smoothParam(
        filter.Q,
        formantQ(profile, frequency, index),
        at,
        smoothing,
      );
      smoothParam(
        filter.gain,
        formantGain(profile, index),
        at,
        smoothing,
      );
    });
    voice.waveKey = this.#setPeriodicWave(
      voice.oscillator,
      profile.glottalTension,
      voice.waveKey,
    );
  }

  #transitionProfile(voice, profile, start, end) {
    const duration = Math.max(0.006, end - start);
    const transition = (parameter, value, fallback = 0) => {
      rampParam(parameter, value, start, duration, fallback);
    };
    transition(voice.oscillator.frequency, profile.frequency, profile.frequency);
    transition(voice.sourceBus.gain, sourceDrive(profile), 0.58);
    transition(voice.voicedGain.gain, voicedLevel(profile), 0);
    transition(voice.highpass.frequency, highpassFrequency(profile), profile.highpass);
    transition(voice.lowpass.frequency, profile.lowpass, profile.lowpass);
    transition(voice.oralGain.gain, oralLevel(profile), 0.42);
    transition(voice.panner.pan, profile.pan, 0);
    transition(voice.noiseFilter.frequency, profile.noiseFrequency, profile.noiseFrequency);
    transition(voice.noiseFilter.Q, profile.noiseQ, profile.noiseQ);
    transition(voice.noiseGain.gain, profileNoiseLevel(profile), 0);
    transition(
      voice.throatPeak.frequency,
      throatPeakFrequency(profile),
      920,
    );
    transition(
      voice.throatPeak.Q,
      throatPeakQ(profile),
      2.4,
    );
    transition(
      voice.throatPeak.gain,
      throatPeakGain(profile),
      4,
    );
    transition(
      voice.throatNotch.frequency,
      throatNotchFrequency(profile),
      1_850,
    );
    transition(
      voice.throatNotch.Q,
      throatNotchQ(profile),
      1.4,
    );
    transition(voice.nasalPole.frequency, nasalPoleFrequency(profile), 280);
    transition(voice.nasalPole.Q, nasalPoleQ(profile), 2);
    transition(
      voice.nasalPole.gain,
      nasalPoleGain(profile),
      5,
    );
    transition(voice.nasalNotch.frequency, nasalNotchFrequency(profile), 1_100);
    transition(voice.nasalNotch.Q, nasalPoleQ(profile), 2);
    transition(voice.nasalGain.gain, nasalLevel(profile), 0);
    transition(voice.slimeDelay.delayTime, slimeDelaySeconds(profile), 0.012);
    transition(voice.slimeFilter.frequency, slimeFrequency(profile), 620);
    transition(voice.slimeFilter.Q, slimeResonance(profile), 3.2);
    transition(voice.slimeWet.gain, slimeWetLevel(profile), 0);
    transition(voice.slimeFeedback.gain, slimeFeedbackLevel(profile), 0);
    profile.formants.forEach((frequency, index) => {
      transition(voice.formants[index].frequency, frequency, frequency);
      transition(
        voice.formants[index].Q,
        formantQ(profile, frequency, index),
        6,
      );
      transition(
        voice.formants[index].gain,
        formantGain(profile, index),
        profile.formantGains[index],
      );
    });
    voice.coarticulationTarget = profile;
  }

  setLevel(value) {
    this.desiredLevel = clamp(value, 0, LEVEL_CEILING, this.desiredLevel);
    if (this.context && this.master && this.enabled) {
      smoothParam(this.master.gain, this.desiredLevel, this.context.currentTime, 0.012);
    }
    return this.desiredLevel;
  }

  syncMouths(mouths = [], globals = {}) {
    this.pendingMouths = Array.isArray(mouths)
      ? mouths.slice(0, maximumModelMouths())
      : [];
    this.pendingGlobals = globals && typeof globals === "object" ? { ...globals } : {};
    if (Number.isFinite(Number(this.pendingGlobals.level))) {
      this.setLevel(this.pendingGlobals.level);
    }
    if (!this.context || this.voices.length === 0) return this.pendingMouths.length;

    const now = finite(this.context.currentTime, 0);
    const vibratoRate = clamp(firstFinite([
      this.pendingGlobals.vibratoRate,
      this.pendingGlobals.vibratoHz,
    ], 5.3), 0.1, 14, 5.3);
    const vibratoAmount = clamp(firstFinite([
      this.pendingGlobals.vibrato,
      this.pendingGlobals.vibratoDepth,
    ], 0.24), 0, 1, 0.24);
    const vibratoDepthHz = clamp(firstFinite([
      this.pendingGlobals.vibratoDepthHz,
    ], vibratoAmount * 7.5), 0, 18, 1.8);
    smoothParam(this.vibrato.frequency, vibratoRate, now, 0.04);
    smoothParam(this.vibratoDepth.gain, vibratoDepthHz, now, 0.04);

    this.voices.forEach((voice, index) => {
      const mouth = this.pendingMouths[index];
      if (!mouth) {
        voice.present = false;
        voice.mouthId = null;
        this.release(index, { at: now, release: 0.025 });
        return;
      }
      const profile = makeProfile(mouth, {
        ...this.pendingGlobals,
        mouthCount: this.pendingGlobals.mouthCount ?? this.pendingMouths.length,
        sampleRate: this.context.sampleRate,
      }, index);
      voice.mouthId = mouth.id ?? null;
      this.#applyProfile(voice, profile, now);
      if (!profile.active) {
        this.release(index, { at: now, release: 0.025 });
      } else if (voice.gated && voice.releaseAt > now) {
        const sustainedNoise = profileNoiseLevel(profile);
        smoothParam(voice.noiseGain.gain, sustainedNoise, now, 0.012);
      } else if (voice.releaseAt <= now) {
        voice.gated = false;
      }
    });
    return this.pendingMouths.length;
  }

  articulate(index, mouth, options = {}) {
    return this.#perform(index, mouth, options, false);
  }

  sustain(index, mouth, options = {}) {
    return this.#perform(index, mouth, options, true);
  }

  #perform(index, mouth, options, sustained) {
    const voiceIndex = Math.trunc(Number(index));
    if (
      !this.enabled
      || !this.context
      || !Number.isInteger(voiceIndex)
      || voiceIndex < 0
      || voiceIndex >= this.voices.length
    ) return false;

    const voice = this.voices[voiceIndex];
    const globals = options?.globals && typeof options.globals === "object"
      ? { ...this.pendingGlobals, ...options.globals }
      : this.pendingGlobals;
    const effectiveMouth = mouth ?? this.pendingMouths[voiceIndex] ?? {};
    voice.mouthId = effectiveMouth?.id ?? null;
    const performanceGlobals = {
      ...globals,
      mouthCount: globals?.mouthCount ?? this.pendingMouths.length,
      phase: "attack",
      sampleRate: this.context.sampleRate,
    };
    const articulations = articulationDescriptors(performanceGlobals);
    const carriers = carrierDescriptors(performanceGlobals, false);
    const onsetArticulation = articulations[0] ?? null;
    const onsetCarrier = carriers[0] ?? null;
    const onsetGlobals = {
      ...performanceGlobals,
      articulation: onsetArticulation?.articulation ?? performanceGlobals.articulation,
      carrierLetter: onsetArticulation?.carrierLetter
        ?? onsetCarrier?.carrierLetter
        ?? performanceGlobals.carrierLetter,
      carrierFormants: onsetArticulation?.carrierFormants
        ?? onsetCarrier?.carrierFormants
        ?? performanceGlobals.carrierFormants,
    };
    const probeProfile = makeProfile(effectiveMouth, onsetGlobals, voiceIndex);
    const needsConsonantMorph = probeProfile.manner !== "vowel";
    const profile = needsConsonantMorph
      ? makeProfile(effectiveMouth, {
        ...onsetGlobals,
        carrierLetter: null,
        carrierFormants: null,
      }, voiceIndex)
      : probeProfile;
    if (!profile.active) {
      this.release(voiceIndex);
      return false;
    }

    const at = startTime(this.context, options);
    const targets = coarticulationTargets(
      effectiveMouth,
      performanceGlobals,
      profile,
      voiceIndex,
    );
    // Pointer drags call sustain repeatedly as anatomy changes. Once a mouth is
    // already held, update its pitch/formants/noise without replaying a stop
    // closure or restarting the amplitude attack on every pointermove.
    if (sustained && voice.gated && voice.releaseAt === Infinity) {
      const heldProfile = targets.at(-1) ?? profile;
      this.#applyProfile(voice, heldProfile, at, 0.008);
      smoothParam(
        voice.noiseGain.gain,
        profileNoiseLevel(heldProfile),
        at,
        0.012,
      );
      return true;
    }
    const duration = eventDuration(options);
    const velocity = eventVelocity(options);
    const peak = clamp(
      profile.gain
        * velocity
        * (0.5 + profile.pressure * 0.3 + profile.push * 0.12)
        * (0.84 + profile.voicing * 0.1),
      MIN_GAIN,
      VOICE_GAIN_CEILING,
      0.12,
    );
    const manner = profile.manner;
    const stopLike = STOP_MANNERS.has(manner) || profile.oralClosure > 0.72;
    const affricate = manner === "affricate";
    const fricative = NOISY_MANNERS.has(manner) || profile.noiseGain > 0.2;
    // Stop consonants keep the tract closed during their attack profile. Their
    // audible burst lives in the release profile, so ask the pure model for
    // both phases and schedule the release transient on this same voice path.
    const releaseProfile = stopLike || affricate
      ? makeProfile(effectiveMouth, {
        ...onsetGlobals,
        carrierLetter: null,
        carrierFormants: null,
        phase: "release",
      }, voiceIndex)
      : profile;
    const closureTime = stopLike || affricate
      ? clamp(
        0.005 + profile.oralClosure * 0.018,
        0.006,
        Math.min(0.032, duration * 0.24),
        0.014,
      )
      : 0;
    const onset = at + closureTime;
    const noiseBody = profileNoiseLevel(profile, fricative);

    this.#applyProfile(voice, profile, at, 0.008);
    voice.gated = true;
    voice.releaseAt = sustained ? Infinity : at + duration;

    holdParam(voice.envelope.gain, at, MIN_GAIN);
    holdParam(voice.noiseGain.gain, at, 0);
    if (stopLike || affricate) {
      rampParam(voice.envelope.gain, MIN_GAIN, at, closureTime, MIN_GAIN);
      rampParam(voice.noiseGain.gain, 0, at, closureTime, 0);
      smoothParam(voice.noiseFilter.frequency, releaseProfile.burstFrequency, onset, 0.002);
      smoothParam(voice.noiseFilter.Q, releaseProfile.burstQ, onset, 0.002);
      const burstLevel = clamp(
        releaseProfile.burstGain
          * velocity
          * (0.18 + profile.pressure * 0.1)
          + (affricate ? noiseBody * 0.22 : 0),
        0,
        0.34,
        0,
      );
      setParamValue(voice.noiseGain.gain, burstLevel, onset);
      if (typeof voice.noiseGain.gain.setTargetAtTime === "function") {
        voice.noiseGain.gain.setTargetAtTime(
          affricate ? noiseBody : profile.breath * 0.08,
          onset,
          releaseProfile.burstHalfLife / Math.log(2),
        );
      } else {
        rampParam(
          voice.noiseGain.gain,
          affricate ? noiseBody : profile.breath * 0.08,
          onset,
          releaseProfile.burstDuration,
          burstLevel,
        );
      }
      rampParam(voice.envelope.gain, peak, onset, 0.007, MIN_GAIN);
    } else {
      rampParam(
        voice.envelope.gain,
        peak,
        at,
        manner === "vowel" ? 0.022 : 0.01,
        MIN_GAIN,
      );
      rampParam(voice.noiseGain.gain, noiseBody, at, fricative ? 0.009 : 0.024, 0);
    }

    if (targets.length > 0) {
      const window = coarticulationWindow(performanceGlobals, options, duration);
      const morphStart = onset + Math.min(0.009, window * 0.16);
      const morphEnd = onset + window;
      const weights = coarticulationWeights(performanceGlobals, targets.length);
      const available = Math.max(0.006 * targets.length, morphEnd - morphStart);
      let cursor = morphStart;
      targets.forEach((target, targetIndex) => {
        const start = cursor;
        const end = targetIndex === targets.length - 1
          ? morphEnd
          : Math.min(morphEnd, start + Math.max(0.006, available * weights[targetIndex]));
        this.#transitionProfile(voice, target, start, end);
        cursor = end;
      });
    } else {
      voice.coarticulationTarget = null;
    }

    if (!sustained) {
      const releaseDuration = clamp(
        options.release,
        0.012,
        Math.min(0.24, duration * 0.48),
        manner === "vowel" || manner === "nasal" ? 0.075 : 0.035,
      );
      const releaseAt = Math.max(onset + 0.012, at + duration - releaseDuration);
      rampParam(voice.envelope.gain, 0, releaseAt, releaseDuration, peak);
      rampParam(voice.noiseGain.gain, 0, releaseAt, releaseDuration * 0.72, noiseBody);
    }
    return true;
  }

  release(index, options = {}) {
    const voiceIndex = Math.trunc(Number(index));
    if (
      !this.context
      || !Number.isInteger(voiceIndex)
      || voiceIndex < 0
      || voiceIndex >= this.voices.length
    ) return false;
    const voice = this.voices[voiceIndex];
    const at = Math.max(
      finite(this.context.currentTime, 0),
      firstFinite([options.at, options.when], this.context.currentTime),
    );
    // Spin winners use a deliberately theatrical multi-second tail. Keep
    // ordinary articulation releases short above, while allowing an explicit
    // release() call enough bounded range for the full winner decay.
    const duration = clamp(options.release ?? options.duration, 0.008, 4, 0.045);
    rampParam(voice.envelope.gain, 0, at, duration, MIN_GAIN);
    rampParam(voice.noiseGain.gain, 0, at, Math.min(duration, 0.06), 0);
    voice.gated = false;
    voice.releaseAt = at + duration;
    return true;
  }

  releaseAll(options = {}) {
    if (!this.context) return;
    for (let index = 0; index < this.voices.length; index += 1) {
      this.release(index, options);
    }
  }

  async disable() {
    this.enabled = false;
    if (!this.context) return;
    const now = finite(this.context.currentTime, 0);
    this.releaseAll({ at: now, release: 0.025 });
    smoothParam(this.master?.gain, 0, now, 0.008);
    if (this.context.state === "running") await this.context.suspend?.();
  }

  async close() {
    const context = this.context;
    this.enabled = false;
    if (!context) return;
    const now = finite(context.currentTime, 0);
    this.releaseAll({ at: now, release: 0.012 });
    for (const voice of this.voices) {
      stop(voice.oscillator, now);
      disconnect(voice.oscillator);
      disconnect(voice.voicedGain);
      disconnect(voice.sourceBus);
      disconnect(voice.noiseFilter);
      disconnect(voice.noiseGain);
      disconnect(voice.highpass);
      disconnect(voice.throatPeak);
      disconnect(voice.throatNotch);
      for (const filter of voice.formants) disconnect(filter);
      disconnect(voice.lowpass);
      disconnect(voice.oralGain);
      disconnect(voice.nasalPole);
      disconnect(voice.nasalNotch);
      disconnect(voice.nasalGain);
      disconnect(voice.slimeDelay);
      disconnect(voice.slimeFilter);
      disconnect(voice.slimeWet);
      disconnect(voice.slimeFeedback);
      disconnect(voice.clipper);
      disconnect(voice.envelope);
      disconnect(voice.panner);
    }
    stop(this.noiseSource, now);
    stop(this.vibrato, now);
    disconnect(this.noiseSource);
    disconnect(this.vibrato);
    disconnect(this.vibratoDepth);
    disconnect(this.compressor);
    disconnect(this.master);
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    try {
      if (context.state !== "closed") await context.close?.();
    } finally {
      this.#resetGraph();
    }
  }

  #resetGraph() {
    this.releaseAudioOutput?.();
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.releaseAudioOutput = null;
    this.voiceBus = null;
    this.noiseSource = null;
    this.noiseBuffer = null;
    this.vibrato = null;
    this.vibratoDepth = null;
    this.voices = [];
    this.waveCache = new Map();
  }
}
