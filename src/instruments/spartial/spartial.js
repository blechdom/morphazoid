import { SpartialGranularEngine } from "./spartial-granular.js";
import { SPARTIAL_ORGAN_DEFAULTS, sanitizeOrganSettings, writeOrganSpectrum, randomOrganRegistration } from "./spartial-organ.js";

// SPARTIAL's browser-free additive/granular engine. Timing advances on the sample
// clock; the application only supplies note gates and displays snapshots.
export const SPARTIAL_MAX_PARTIALS = 32;
export const SPARTIAL_MAX_VOICES = 8;
export const SPARTIAL_MAX_SPEAKERS = 16;
export const SPARTIAL_DEFAULTS = Object.freeze({
  ...SPARTIAL_ORGAN_DEFAULTS,
  partials: 16,
  rolloff: 1.2,
  attack: 0.04,
  release: 1.2,
  cascade: 0.045,
  cascadeStart: 0,
  cascadeCurve: 0,
  cascadeVariation: 0,
  cascadeOrder: "up",
  pattern: "wrap",
  rotation: 0,
  cycles: 1,
  stretch: 1,
  inharmonicity: 0,
  spread: 1,
  lock: 0,
  target: 0,
  speakerCount: 8,
  offset: 0,
  level: 0.65,
  counterRotate: false,
  seed: 17,
  granularMix: 0,
  grainSize: 100,
  grainDensity: 18,
  grainLookback: 150,
  grainScatter: 100,
  grainJitter: 0,
  grainPitch: 0,
  grainReverse: 0,
  grainSpread: 1,
  grainPattern: "wrap",
  grainFreeze: false,
  granularSource: "additive",
  grainPosition: 0.25,
  pitchDepth: 0,
  amplitudeDepth: 0,
  modulationRate: 5,
  modulationRipple: 0,
  modulationShape: "sine",
  rotaryMode: "off",
  rotaryMix: 0.7,
  rotarySpread: 0.7,
  rotaryRamp: 2.5,
  drive: 0,
  keyClick: 0,
  pipeChiff: 0,
  organPercussion: "off",
  percussionLevel: 0.25,
  percussionDecay: 0.35,
  gains: Object.freeze(Array(SPARTIAL_MAX_PARTIALS).fill(1)),
});

const TAU = 2 * Math.PI;
const CONTROL_FRAMES = 32;
const SMOOTH_SECONDS = 0.02;
const OUTPUT_CEILING = 0.72;
const SMOOTH_EFFECT_KEYS = ["pitchDepth", "amplitudeDepth", "modulationRate", "modulationRipple", "rotarySpread", "drive"];

function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function wrap(value, length = 1) {
  return ((value % length) + length) % length;
}

function circleDelta(from, to, length) {
  return wrap(to - from + length / 2, length) - length / 2;
}

function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function spectralPreset(id, name, rolloff, gain, stretch = 1, inharmonicity = 0) {
  return Object.freeze({ id, name, settings: Object.freeze({
    rolloff, stretch, inharmonicity,
    gains: Object.freeze(Array.from({ length: SPARTIAL_MAX_PARTIALS }, (_, index) => gain(index + 1))),
  }) });
}

/** Fingerprints reshape timbre without changing notes, routing, or transport. */
export const SPARTIAL_SPECTRAL_PRESETS = Object.freeze([
  spectralPreset("full", "Full spectrum", 1.2, () => 1),
  spectralPreset("odd", "Odd partials", 0.8, (harmonic) => harmonic % 2 ? 1 : 0),
  spectralPreset("even", "Even + root", 0.8, (harmonic) => harmonic === 1 || harmonic % 2 === 0 ? 1 : 0),
  spectralPreset("hollow", "Hollow", 0.65, (harmonic) => harmonic === 1 ? 0.55 : harmonic % 3 === 0 ? 1 : 0.08),
  spectralPreset("soft", "Soft cloud", 1.8, (harmonic) => Math.exp(-(harmonic - 1) / 8)),
  spectralPreset("bright", "Bright ridge", 0.3, (harmonic) => 0.2 + 0.8 * Math.exp(-(((harmonic - 9) / 5) ** 2))),
  spectralPreset("bell", "Split bell", 0.8, (harmonic) => harmonic === 1 || harmonic % 3 === 0 ? 1 : 0.12, 1.16, 0.45),
  spectralPreset("cluster", "Close cluster", 0.45, (harmonic) => harmonic < 10 ? 1 : 0.1, 0.6, 0.2),
]);

/** Semitone voicings above the selected root, all within one octave. */
export const SPARTIAL_CHORDS = Object.freeze([
  ["minor", "Minor", [0, 3, 7]],
  ["major", "Major", [0, 4, 7]],
  ["sus", "Suspended 4", [0, 5, 7]],
  ["sus2", "Suspended 2", [0, 2, 7]],
  ["fifth", "Open fifth", [0, 7]],
  ["augmented", "Augmented", [0, 4, 8]],
  ["diminished", "Diminished triad", [0, 3, 6]],
  ["minor7", "Minor 7", [0, 3, 7, 10]],
  ["major7", "Major 7", [0, 4, 7, 11]],
  ["dominant7", "Dominant 7", [0, 4, 7, 10]],
  ["diminished7", "Fully diminished 7", [0, 3, 6, 9]],
  ["halfDiminished", "Half diminished 7", [0, 3, 6, 10]],
  ["minorMajor7", "Minor / major 7", [0, 3, 7, 11]],
  ["major6", "Major 6", [0, 4, 7, 9]],
  ["minor6", "Minor 6", [0, 3, 7, 9]],
  ["add9", "Add 9 · close", [0, 2, 4, 7]],
  ["minorAdd9", "Minor add 9 · close", [0, 2, 3, 7]],
  ["quartal", "Stacked fourths", [0, 5, 10]],
  ["wholeTone3", "Whole tone · 3 notes", [0, 2, 4]],
  ["wholeTone4", "Whole tone · 4 notes", [0, 2, 4, 6]],
  ["wholeTone", "Whole tone · 6 notes", [0, 2, 4, 6, 8, 10]],
  ["chromatic3", "Chromatic · 3 notes", [0, 1, 2]],
  ["chromatic4", "Chromatic · 4 notes", [0, 1, 2, 3]],
  ["random3", "Random 3 notes", null, 3],
  ["random4", "Random 4 notes", null, 4],
].map(([id, name, intervals, noteCount]) => Object.freeze({
  id, name, intervals: intervals && Object.freeze(intervals), noteCount: noteCount ?? intervals.length,
})));

/** Root plus distinct pitches from the remaining eleven semitones; seed recalls a voicing. */
export function spartialChordIntervals(id = "minor", seed = 17) {
  const chord = SPARTIAL_CHORDS.find(item => item.id === id) ?? SPARTIAL_CHORDS[0];
  if (chord.intervals) return [...chord.intervals];
  const random = seededRandom(Math.imul(finite(seed, 17), 0x9e3779b1) ^ 0x43484f52);
  const pool = Array.from({ length: 11 }, (_, index) => index + 1);
  const notes = [0];
  for (let index = 1; index < chord.noteCount; index += 1) {
    notes.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return notes.sort((a, b) => a - b);
}

/** A reproducible, bounded fingerprint, always keeping the fundamental. */
export function randomSpartialSpectrum(seed = 17) {
  const random = seededRandom(finite(seed, 17));
  const rolloff = 0.5 + random() * 1.2;
  const stretch = 0.75 + random() * 0.65;
  const inharmonicity = random() * 0.65;
  const gains = Array.from({ length: SPARTIAL_MAX_PARTIALS }, (_, index) => (
    index === 0 ? 1 : random() < 0.22 ? 0 : 0.15 + random() * 0.85
  ));
  return { rolloff, stretch, inharmonicity, gains };
}

/** Pure full-instrument dice; preserve performer clocks, volume and devices. */
export function randomSpartialInstrument(current, seed = 17) {
  const random = seededRandom(Math.imul(finite(seed, 17), 0x9e3779b1) ^ 0x53504152);
  const pick = values => values[Math.floor(random() * values.length)];
  const between = (low, high, step) => low + Math.round(random() * (high - low) / step) * step;
  const previous = sanitizeSpartialSettings(current.settings);
  const mode = pick(["single", "chord"]);
  const chord = pick(SPARTIAL_CHORDS).id;
  const motion = pick(["off", "cw", "ccw", "counter"]);
  const beatsPerTurn = pick([4, 8, 16, 32, 64]);
  const routingMode = pick(["spread", "spread", "spread", "focus"]);
  const settingsSeed = Math.floor(random() * 0x80000000);
  const spectrum = randomSpartialSpectrum(settingsSeed);
  spectrum.gains[0] = between(0.65, 1, 0.01);
  const running = current.playing && motion !== "off" && routingMode !== "focus";
  const granularSource = current.hasGrainFile ? pick(["additive", "file"]) : "additive";
  return {
    ...current,
    mode, chord, chordIntervals: spartialChordIntervals(chord, settingsSeed), motion, beatsPerTurn, routingMode,
    settings: sanitizeSpartialSettings({
      ...spectrum,
      partials: pick([4, 8, 12, 16, 24, 32]),
      attack: between(0.005, 0.8, 0.005),
      release: between(0.1, 3, 0.01),
      cascade: between(0, 0.125, 0.001),
      cascadeStart: between(0, 0.3, 0.001),
      cascadeCurve: between(-1, 1, 0.01),
      cascadeVariation: between(0, 0.8, 0.01),
      cascadeOrder: pick(["up", "down", "alternate"]),
      pattern: pick(["wrap", "reverse", "alternate", "scatter"]),
      cycles: between(0, 4, 0.01),
      offset: between(0, 0.995, 0.005),
      target: Math.floor(random() * previous.speakerCount),
      seed: settingsSeed,
      // Cycles is this UI's span control; legacy spread stays at unity.
      spread: 1,
      lock: routingMode === "focus" ? 1 : 0,
      rotation: running ? finite(current.tempo, 90) / 60 / beatsPerTurn * (motion === "ccw" ? -1 : 1) : 0,
      counterRotate: motion === "counter",
      level: previous.level,
      speakerCount: previous.speakerCount,
      granularMix: between(0, 1, 0.01),
      grainSize: between(15, 350, 1),
      grainDensity: between(3, 60, 1),
      grainLookback: between(0, 2500, 1),
      grainScatter: between(0, 700, 1),
      grainJitter: between(0, 1, 0.01),
      grainPitch: between(-24, 24, 0.1),
      grainReverse: between(0, 1, 0.01),
      grainSpread: between(0, 1, 0.01),
      grainPattern: pick(["wrap", "reverse", "alternate", "scatter"]),
      grainFreeze: granularSource === "additive" && current.grainBufferReady === true && random() < 0.3,
      granularSource,
      grainPosition: between(0, 1, 0.01),
      ...randomOrganRegistration(settingsSeed),
      organMode: pick(["partials", "tonewheel", "pipe"]),
      pitchDepth: between(0, 80, 1),
      amplitudeDepth: between(0, 0.8, 0.01),
      modulationRate: between(0.05, 12, 0.05),
      modulationRipple: between(-4, 4, 0.05),
      modulationShape: pick(["sine", "triangle"]),
      rotaryMode: pick(["off", "slow", "fast", "brake"]),
      rotaryMix: between(0, 1, 0.01),
      rotarySpread: between(0, 1, 0.01),
      rotaryRamp: between(0.2, 8, 0.1),
      drive: between(0, 0.7, 0.01),
      keyClick: between(0, 0.65, 0.01),
      pipeChiff: between(0, 0.65, 0.01),
      organPercussion: pick(["off", "second", "third"]),
      percussionLevel: between(0, 0.6, 0.01),
      percussionDecay: between(0.08, 1.5, 0.01),
    }),
  };
}

function frequencyRatio(index, settings) {
  const base = settings.organMode === "partials" ? 1 : 0.5;
  if (index === 0) return base;
  // A stable per-partial deviation makes the irregular spacing reproducible;
  // it is an additive-synthesis texture, not a physical string/bar model.
  const random = seededRandom((settings.seed + 1) * 0x9e3779b1 ^ (index + 1) * 0x85ebca6b);
  const deviation = (random() * 2 - 1) * 0.22 * settings.inharmonicity;
  return base * ((index + 1) ** settings.stretch) * (1 + deviation);
}

/** Stretch 1 and inharmonicity 0 give exact integer harmonic ratios. */
export function partialFrequencyRatio(index, settings = SPARTIAL_DEFAULTS) {
  return frequencyRatio(
    clamp(Math.floor(finite(index, 0)), 0, SPARTIAL_MAX_PARTIALS - 1),
    sanitizeSpartialSettings(settings),
  );
}

export function sanitizeSpartialSettings(input = {}, previous = SPARTIAL_DEFAULTS) {
  const patch = input && typeof input === "object" ? input : {};
  const base = previous && typeof previous === "object" ? previous : SPARTIAL_DEFAULTS;
  const number = (key, low, high) => clamp(
    finite(patch[key], finite(base[key], SPARTIAL_DEFAULTS[key])), low, high,
  );
  const choice = (key, options) => options.includes(patch[key]) ? patch[key]
    : options.includes(base[key]) ? base[key] : SPARTIAL_DEFAULTS[key];
  const speakerCount = Math.round(number("speakerCount", 4, SPARTIAL_MAX_SPEAKERS));
  const rawGains = Array.isArray(patch.gains) || ArrayBuffer.isView(patch.gains)
    ? patch.gains : base.gains;
  return {
    ...sanitizeOrganSettings(patch, base),
    partials: Math.round(number("partials", 1, SPARTIAL_MAX_PARTIALS)),
    rolloff: number("rolloff", 0, 3),
    attack: number("attack", 0.002, 8),
    release: number("release", 0.005, 12),
    cascade: number("cascade", 0, 0.5),
    cascadeStart: number("cascadeStart", 0, 2),
    cascadeCurve: number("cascadeCurve", -1, 1),
    cascadeVariation: number("cascadeVariation", 0, 1),
    cascadeOrder: choice("cascadeOrder", ["up", "down", "alternate"]),
    pattern: choice("pattern", ["wrap", "reverse", "alternate", "scatter"]),
    rotation: number("rotation", -2, 2),
    cycles: number("cycles", 0, 4),
    stretch: number("stretch", 0.5, 2),
    inharmonicity: number("inharmonicity", 0, 1),
    spread: number("spread", 0, 1),
    lock: number("lock", 0, 1),
    target: clamp(Math.round(number("target", 0, 15)), 0, speakerCount - 1),
    speakerCount,
    offset: wrap(number("offset", -1e6, 1e6)),
    level: number("level", 0, 1),
    counterRotate: typeof patch.counterRotate === "boolean" ? patch.counterRotate
      : base.counterRotate === true,
    seed: Math.round(number("seed", 0, 0x7fffffff)),
    granularMix: number("granularMix", 0, 1),
    grainSize: number("grainSize", 5, 500),
    grainDensity: number("grainDensity", 1, 80),
    grainLookback: number("grainLookback", 0, 3000),
    grainScatter: number("grainScatter", 0, 1000),
    grainJitter: number("grainJitter", 0, 1),
    grainPitch: number("grainPitch", -24, 24),
    grainReverse: number("grainReverse", 0, 1),
    grainSpread: number("grainSpread", 0, 1),
    grainPattern: choice("grainPattern", ["wrap", "reverse", "alternate", "scatter"]),
    grainFreeze: typeof patch.grainFreeze === "boolean" ? patch.grainFreeze : base.grainFreeze === true,
    granularSource: choice("granularSource", ["additive", "file"]),
    grainPosition: number("grainPosition", 0, 1),
    pitchDepth: number("pitchDepth", 0, 200),
    amplitudeDepth: number("amplitudeDepth", 0, 1),
    modulationRate: number("modulationRate", 0.05, 20),
    modulationRipple: number("modulationRipple", -4, 4),
    modulationShape: choice("modulationShape", ["sine", "triangle"]),
    rotaryMode: choice("rotaryMode", ["off", "slow", "fast", "brake"]),
    rotaryMix: number("rotaryMix", 0, 1),
    rotarySpread: number("rotarySpread", 0, 1),
    rotaryRamp: number("rotaryRamp", 0.2, 8),
    drive: number("drive", 0, 1),
    keyClick: number("keyClick", 0, 1),
    pipeChiff: number("pipeChiff", 0, 1),
    organPercussion: choice("organPercussion", ["off", "second", "third"]),
    percussionLevel: number("percussionLevel", 0, 1),
    percussionDecay: number("percussionDecay", 0.08, 1.5),
    gains: Array.from({ length: SPARTIAL_MAX_PARTIALS }, (_, index) => clamp(
      finite(rawGains?.[index], finite(base.gains?.[index], 1)), 0, 1,
    )),
  };
}

function fillCascadeTimes(settings, times) {
  const count = settings.partials;
  const gapCount = count - 1;
  times[0] = settings.cascadeStart;
  if (!gapCount) return times;
  if (settings.cascade === 0) {
    for (let rank = 1; rank < count; rank += 1) times[rank] = settings.cascadeStart;
    return times;
  }
  const random = seededRandom(settings.seed ^ 0x43415343);
  let weightSum = 0;
  for (let rank = 1; rank < count; rank += 1) {
    const progress = gapCount > 1 ? 2 * (rank - 1) / (gapCount - 1) - 1 : 0;
    const curveWeight = 1 + 0.9 * settings.cascadeCurve * progress;
    const variationWeight = 1 + 0.8 * settings.cascadeVariation * (2 * random() - 1);
    times[rank] = curveWeight * variationWeight;
    weightSum += times[rank];
  }
  const span = gapCount * settings.cascade;
  let elapsed = 0;
  for (let rank = 1; rank < count; rank += 1) {
    elapsed += times[rank] * span / weightSum;
    times[rank] = settings.cascadeStart + elapsed;
  }
  // Keep the displayed and scheduled span exact despite accumulated rounding.
  times[count - 1] = settings.cascadeStart + span;
  return times;
}

/** Onset seconds by entrance rank; pitch direction is applied separately. */
export function spartialCascadeTimes(settings = SPARTIAL_DEFAULTS) {
  const safe = sanitizeSpartialSettings(settings);
  return fillCascadeTimes(safe, Array(safe.partials).fill(0));
}

/** Each speaker appears once per cycle, including the seeded scatter pattern. */
function speakerPattern(settings) {
  const count = settings.speakerCount;
  const values = Array.from({ length: count }, (_, index) => index);
  if (settings.pattern === "reverse") return values.map((index) => wrap(-index, count));
  if (settings.pattern === "alternate") {
    return values.map((index) => index % 2 ? count - Math.ceil(index / 2) : index / 2);
  }
  if (settings.pattern === "scatter") {
    let state = (settings.seed >>> 0) || 1;
    for (let index = count - 1; index > 0; index -= 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const other = (state >>> 0) % (index + 1);
      [values[index], values[other]] = [values[other], values[index]];
    }
  }
  // Keep the first partial at the angular origin so squeezing any pattern
  // down to zero cycles converges on the same visible source position.
  return values.map((value) => wrap(value - values[0], count));
}

function positionFromPattern(index, settings, phase, pattern) {
  const count = settings.speakerCount;
  const direction = settings.counterRotate && index % 2 ? -1 : 1;
  // The complete active bank spans `cycles` turns: one turn spreads all
  // partials around the ring, zero gathers them, and two repeats the ring.
  const slot = index * settings.cycles * count / settings.partials;
  const whole = Math.floor(slot);
  const start = pattern[whole % count];
  const end = pattern[(whole + 1) % count];
  const base = (start + circleDelta(start, end, count) * (slot - whole)) * settings.spread;
  const rotated = wrap(base + (settings.offset + phase * direction) * count, count);
  return wrap(rotated + circleDelta(rotated, settings.target, count) * settings.lock, count);
}

/** A fractional, zero-based speaker index. Phase and offset are turns. */
export function partialPosition(index, settings = SPARTIAL_DEFAULTS, phase = 0) {
  const safe = sanitizeSpartialSettings(settings);
  return positionFromPattern(
    clamp(Math.floor(finite(index, 0)), 0, SPARTIAL_MAX_PARTIALS - 1),
    safe, finite(phase, 0), speakerPattern(safe),
  );
}

/** Rank zero starts first. Alternate order interleaves lowest/highest partials. */
export function partialCascadeRank(index, count, order = "up") {
  const size = clamp(Math.round(finite(count, 1)), 1, SPARTIAL_MAX_PARTIALS);
  const item = clamp(Math.floor(finite(index, 0)), 0, size - 1);
  if (order === "down") return size - 1 - item;
  if (order === "alternate") return item < Math.ceil(size / 2)
    ? item * 2 : (size - 1 - item) * 2 + 1;
  return item;
}

export function equalPowerRoute(position, speakerCount = 8) {
  const count = clamp(Math.round(finite(speakerCount, 8)), 4, SPARTIAL_MAX_SPEAKERS);
  const wrapped = wrap(finite(position, 0), count);
  const left = Math.floor(wrapped);
  const mix = wrapped - left;
  return {
    left,
    right: (left + 1) % count,
    leftGain: Math.cos(mix * Math.PI / 2),
    rightGain: Math.sin(mix * Math.PI / 2),
  };
}

function makeVoice() {
  return {
    active: false, id: null, note: 60, velocity: 1, age: 0, serial: 0,
    gate: false, pending: null, releaseFrames: 0,
    panicGain: 1, panicStep: 0,
    noiseState: 1, lastNoise: 0, chiffLow: 0, chiffHigh: 0,
    clickLevel: 0, chiffLevel: 0, percussionEnvelope: 0, percussionPhase: 0,
    percussionIncrement: 0, percussionDecay: 1, articulationDelay: 0,
    phases: new Float64Array(SPARTIAL_MAX_PARTIALS),
    increments: new Float64Array(SPARTIAL_MAX_PARTIALS),
    targetIncrements: new Float64Array(SPARTIAL_MAX_PARTIALS),
    spectralGains: new Float64Array(SPARTIAL_MAX_PARTIALS),
    envelopes: new Float64Array(SPARTIAL_MAX_PARTIALS),
    releaseSteps: new Float64Array(SPARTIAL_MAX_PARTIALS),
    onsets: new Int32Array(SPARTIAL_MAX_PARTIALS),
    audible: new Uint8Array(SPARTIAL_MAX_PARTIALS),
  };
}

export class SpartialEngine {
  constructor({ sampleRate = 48000, settings = {}, phase = 0 } = {}) {
    this.sampleRate = clamp(finite(sampleRate, 48000), 8000, 192000);
    this.settings = sanitizeSpartialSettings(settings);
    this.granular = new SpartialGranularEngine(this.sampleRate, this.settings);
    this.voices = Array.from({ length: SPARTIAL_MAX_VOICES }, makeVoice);
    this.phase = wrap(finite(phase, 0));
    this.frame = 0;
    this.serial = 0;
    this.rotation = this.settings.rotation;
    this.level = this.settings.level;
    this.approach = 1 - Math.exp(-1 / (this.sampleRate * SMOOTH_SECONDS));
    this.routeApproach = 1 - Math.exp(-CONTROL_FRAMES / (this.sampleRate * SMOOTH_SECONDS));
    this.pattern = speakerPattern(this.settings);
    this.weights = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.targetWeights = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.frequencyRatios = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.frequencyRanks = new Uint8Array(SPARTIAL_MAX_PARTIALS);
    this.cascadeTimes = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.cascadeOnsets = new Int32Array(SPARTIAL_MAX_PARTIALS);
    this.partialSignals = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.partialEnergy = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.positions = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.routes = new Float64Array(SPARTIAL_MAX_PARTIALS * SPARTIAL_MAX_SPEAKERS);
    this.routeSteps = new Float64Array(this.routes.length);
    this.organWeights = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.modulationPhase = 0;
    for (const key of SMOOTH_EFFECT_KEYS) this[key] = this.settings[key];
    this.modulationTriangle = this.settings.modulationShape === "triangle" ? 1 : 0;
    this.modulationValues = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.pitchRatios = new Float64Array(SPARTIAL_MAX_PARTIALS).fill(1);
    this.pitchSteps = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.amplitudeGains = new Float64Array(SPARTIAL_MAX_PARTIALS).fill(1);
    this.amplitudeSteps = new Float64Array(SPARTIAL_MAX_PARTIALS);
    this.rotaryHornPhase = 0;
    this.rotaryDrumPhase = 0.25;
    this.rotaryHornHz = 0;
    this.rotaryDrumHz = 0;
    this.rotaryWet = this.settings.rotaryMode === "off" ? 0 : this.settings.rotaryMix;
    this.rotaryRamp = this.settings.rotaryRamp;
    this.rotaryLow = new Float64Array(SPARTIAL_MAX_SPEAKERS);
    this.rotaryOutput = new Float64Array(SPARTIAL_MAX_SPEAKERS);
    this.drivePrevious = new Float64Array(SPARTIAL_MAX_SPEAKERS);
    this.driveEnvelope = new Float64Array(SPARTIAL_MAX_SPEAKERS);
    this.driveDecay = Math.exp(-1 / (this.sampleRate * 0.12));
    this.delayLength = Math.ceil(this.sampleRate * 0.012) + 2;
    this.rotaryDelayLow = new Float64Array(this.delayLength * SPARTIAL_MAX_SPEAKERS);
    this.rotaryDelayHigh = new Float64Array(this.rotaryDelayLow.length);
    this.rotaryCrossover = 1 - Math.exp(-TAU * 800 / this.sampleRate);
    this.articulationSignal = 0;
    this.articulationGain = 0;
    this.updateModulation(true);
    this.updateWeights();
    this.updateSpectralRatios();
    this.updateCascadeSchedule();
    this.weights.set(this.targetWeights);
    this.updateRoutes(true);
  }

  setSettings(patch) {
    this.settings = sanitizeSpartialSettings(patch, this.settings);
    this.granular.updateSettings(this.settings);
    this.pattern = speakerPattern(this.settings);
    this.updateWeights();
    this.updateSpectralRatios();
    this.updateCascadeSchedule();
    for (const voice of this.voices) {
      if (voice.active) this.updateVoiceFrequencies(voice);
    }
  }

  setGrainSource(samples, sourceSampleRate = this.sampleRate) {
    return this.granular.setSource(samples, sourceSampleRate);
  }

  adoptGrainSource(samples, sourceSampleRate) {
    return this.granular.adoptSource(samples, sourceSampleRate);
  }

  clearGrainSource() {
    this.granular.clearSource();
    if (this.settings.granularSource === "file") this.setSettings({ granularSource: "additive" });
  }

  /** Reset spatial phase without restarting voices or stepping speaker gains. */
  setPhase(phase) {
    if (typeof phase !== "number" || !Number.isFinite(phase)) return false;
    this.phase = wrap(phase);
    // Adopt the requested speed immediately so a reset to stationary settings
    // cannot drift past the reset position while the old speed decelerates.
    this.rotation = this.settings.rotation;
    this.updateRoutes();
    return true;
  }

  updateSpectralRatios() {
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      this.frequencyRatios[partial] = frequencyRatio(partial, this.settings);
    }
    // Inharmonic offsets may reorder adjacent frequencies. Cascade direction
    // follows pitch, while each partial keeps its own gain and speaker route.
    // The fixed-size rank pass also avoids sorting/allocating on note starts.
    for (let partial = 0; partial < this.settings.partials; partial += 1) {
      let rank = 0;
      for (let other = 0; other < this.settings.partials; other += 1) {
        if (this.frequencyRatios[other] < this.frequencyRatios[partial]
          || (this.frequencyRatios[other] === this.frequencyRatios[partial] && other < partial)) rank += 1;
      }
      this.frequencyRanks[partial] = rank;
    }
  }

  updateVoiceFrequencies(voice, initial = false) {
    const fundamental = 440 * 2 ** ((voice.note - 69) / 12);
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      const frequency = fundamental * this.frequencyRatios[partial];
      voice.audible[partial] = frequency < this.sampleRate * 0.49 ? 1 : 0;
      // Out-of-band targets fade to silence without ever sweeping through
      // aliased frequencies. A newly audible partial fades in at its target.
      voice.targetIncrements[partial] = TAU * Math.min(frequency, this.sampleRate * 0.49) / this.sampleRate;
      if (initial || voice.spectralGains[partial] === 0) {
        voice.increments[partial] = voice.targetIncrements[partial];
      }
      if (initial) voice.spectralGains[partial] = voice.audible[partial];
    }
  }

  updateCascadeSchedule() {
    fillCascadeTimes(this.settings, this.cascadeTimes);
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      const rank = partialCascadeRank(this.frequencyRanks[partial], this.settings.partials, this.settings.cascadeOrder);
      this.cascadeOnsets[partial] = partial < this.settings.partials
        ? Math.round(this.cascadeTimes[rank] * this.sampleRate) : 0;
    }
  }

  updateWeights() {
    const settings = this.settings;
    const organ = settings.organMode !== "partials";
    if (organ) writeOrganSpectrum(settings, this.organWeights);
    let total = 0;
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      const baselineWeight = partial < settings.partials
        ? (organ ? this.organWeights[partial] : 1) / ((partial + 1) ** settings.rolloff) : 0;
      this.targetWeights[partial] = baselineWeight * settings.gains[partial];
      total += baselineWeight;
    }
    // Normalize against the unpainted bank, not the edited gains. A bar at
    // 0.5 then halves that partial without turning up its neighbors. Since
    // every bar is <=1, the resulting L1 sum remains bounded by one.
    if (organ) total = Math.max(1, total);
    if (total > 0) {
      for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
        this.targetWeights[partial] /= total;
      }
    }
  }

  updateModulation(initial = false) {
    const denominator = Math.max(1, this.settings.partials - 1);
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      // Positive ripple travels toward higher partials as the clock advances;
      // zero gives every partial the same vibrato/tremolo phase.
      const phase = wrap(this.modulationPhase - this.modulationRipple * partial / denominator);
      const sine = Math.sin(TAU * phase);
      const triangle = 1 - 4 * Math.abs(wrap(phase + 0.25) - 0.5);
      const value = sine + (triangle - sine) * this.modulationTriangle;
      this.modulationValues[partial] = value;
      const pitch = 2 ** (this.pitchDepth * value / 1200);
      const amplitude = 1 - this.amplitudeDepth * (0.5 - 0.5 * value);
      if (initial) { this.pitchRatios[partial] = pitch; this.amplitudeGains[partial] = amplitude; }
      this.pitchSteps[partial] = (pitch - this.pitchRatios[partial]) / CONTROL_FRAMES;
      this.amplitudeSteps[partial] = (amplitude - this.amplitudeGains[partial]) / CONTROL_FRAMES;
    }
  }

  updateEffectsClock() {
    if (this.frame % CONTROL_FRAMES === 0) {
      for (const key of SMOOTH_EFFECT_KEYS) {
        this[key] += (this.settings[key] - this[key]) * this.routeApproach;
        if (Math.abs(this.settings[key] - this[key]) < 1e-10) this[key] = this.settings[key];
      }
      this.modulationTriangle += ((this.settings.modulationShape === "triangle" ? 1 : 0) - this.modulationTriangle) * this.routeApproach;
      this.rotaryRamp += (this.settings.rotaryRamp - this.rotaryRamp) * this.routeApproach;
      const fast = this.settings.rotaryMode === "fast", slow = this.settings.rotaryMode === "slow";
      // Ramp is approximately the 95% settling time; horn and drum have distinct
      // inertia. Brake parks the last angle instead of resetting the speaker.
      const ramp = 1 - Math.exp(-3 * CONTROL_FRAMES / (this.sampleRate * this.rotaryRamp));
      this.rotaryHornHz += ((fast ? 6.6 : slow ? 0.8 : 0) - this.rotaryHornHz) * ramp;
      this.rotaryDrumHz += ((fast ? 5.7 : slow ? 0.65 : 0) - this.rotaryDrumHz) * ramp * 0.72;
      if (Math.abs(this.rotaryHornHz) < 1e-8) this.rotaryHornHz = 0;
      if (Math.abs(this.rotaryDrumHz) < 1e-8) this.rotaryDrumHz = 0;
    }
    this.modulationPhase += this.modulationRate / this.sampleRate;
    if (this.modulationPhase >= 1) this.modulationPhase -= 1;
    this.rotaryHornPhase += this.rotaryHornHz / this.sampleRate;
    if (this.rotaryHornPhase >= 1) this.rotaryHornPhase -= 1;
    this.rotaryDrumPhase -= this.rotaryDrumHz / this.sampleRate;
    if (this.rotaryDrumPhase < 0) this.rotaryDrumPhase += 1;
    const targetWet = this.settings.rotaryMode === "off" ? 0 : this.settings.rotaryMix;
    this.rotaryWet += (targetWet - this.rotaryWet) * this.approach;
    if (Math.abs(targetWet - this.rotaryWet) < 1e-10) this.rotaryWet = targetWet;
  }

  voiceArticulation(voice) {
    const age = voice.age - voice.articulationDelay;
    if (age < 0) return 0;
    let signal = 0;
    if (age < this.sampleRate * 0.12 && (voice.clickLevel > 0 || voice.chiffLevel > 0)) {
      let state = voice.noiseState;
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      voice.noiseState = state >>> 0;
      const noise = voice.noiseState / 0x80000000 - 1;
      const seconds = age / this.sampleRate;
      if (seconds < 0.012) signal += (noise - voice.lastNoise) * voice.clickLevel * 0.08 * Math.exp(-seconds / 0.002);
      voice.lastNoise = noise;
      voice.chiffLow += (noise - voice.chiffLow) * (1 - Math.exp(-TAU * 500 / this.sampleRate));
      voice.chiffHigh += (noise - voice.chiffHigh) * (1 - Math.exp(-TAU * 2800 / this.sampleRate));
      signal += (voice.chiffHigh - voice.chiffLow) * voice.chiffLevel * 0.22
        * Math.min(1, seconds / 0.003) * Math.exp(-seconds / 0.022);
    }
    if (voice.percussionEnvelope > 1e-7) {
      voice.percussionPhase = wrap(voice.percussionPhase + voice.percussionIncrement, TAU);
      signal += Math.sin(voice.percussionPhase) * voice.percussionEnvelope
        * Math.min(1, age / (this.sampleRate * 0.002));
      voice.percussionEnvelope *= voice.percussionDecay;
    } else voice.percussionEnvelope = 0;
    const release = voice.gate ? 1 : Math.min(1, voice.releaseFrames / (this.sampleRate * 0.015));
    return signal * voice.velocity * voice.panicGain * release;
  }

  processOutputEffects(channels, frame, outputCount) {
    const count = this.settings.speakerCount;
    const write = this.frame % this.delayLength;
    this.rotaryOutput.fill(0);
    const horn = Math.sin(TAU * this.rotaryHornPhase), drum = Math.sin(TAU * this.rotaryDrumPhase);
    const hornRead = wrap(write - this.sampleRate * (0.003 + 0.0008 * horn), this.delayLength);
    const drumRead = wrap(write - this.sampleRate * (0.003 + 0.0005 * drum), this.delayLength);
    const hornWhole = Math.floor(hornRead), drumWhole = Math.floor(drumRead);
    for (let speaker = 0; this.rotaryWet > 0 && speaker < count; speaker += 1) {
      const input = speaker < outputCount ? channels[speaker][frame] : 0;
      this.rotaryLow[speaker] += (input - this.rotaryLow[speaker]) * this.rotaryCrossover;
      const offset = speaker * this.delayLength;
      this.rotaryDelayLow[offset + write] = this.rotaryLow[speaker];
      this.rotaryDelayHigh[offset + write] = input - this.rotaryLow[speaker];
      if (this.rotaryWet > 0) {
        const low = this.rotaryDelayLow[offset + drumWhole] * (1 - drumRead + drumWhole)
          + this.rotaryDelayLow[offset + (drumWhole + 1) % this.delayLength] * (drumRead - drumWhole);
        const high = this.rotaryDelayHigh[offset + hornWhole] * (1 - hornRead + hornWhole)
          + this.rotaryDelayHigh[offset + (hornWhole + 1) % this.delayLength] * (hornRead - hornWhole);
        for (let band = 0; band < 2; band += 1) {
          const phase = band ? this.rotaryHornPhase : this.rotaryDrumPhase;
          const signal = band ? high * (0.82 + 0.18 * horn) : low * (0.88 + 0.12 * drum);
          if (this.settings.lock === 1) {
            this.rotaryOutput[this.settings.target] += signal;
            continue;
          }
          let rotated = speaker + phase * count;
          if (rotated >= count) rotated -= count;
          const position = this.settings.lock === 0 ? rotated
            : wrap(rotated + circleDelta(rotated, this.settings.target, count) * this.settings.lock, count);
          const left = Math.floor(position), fraction = position - left;
          // Linear interpolation preserves the total across neighboring buses;
          // crossover bands may converge, so the final bus is bounded below.
          this.rotaryOutput[left] += signal * (1 - fraction) * this.rotarySpread;
          this.rotaryOutput[(left + 1) % count] += signal * fraction * this.rotarySpread;
          // Width crossfades stationary and rotating buses, rather than
          // scaling the wrapped angle (which would jump once per revolution).
          if (this.settings.lock === 0) {
            this.rotaryOutput[speaker] += signal * (1 - this.rotarySpread);
            continue;
          }
          const fixed = wrap(speaker + circleDelta(speaker, this.settings.target, count) * this.settings.lock, count);
          const fixedLeft = Math.floor(fixed), fixedFraction = fixed - fixedLeft;
          this.rotaryOutput[fixedLeft] += signal * (1 - fixedFraction) * (1 - this.rotarySpread);
          this.rotaryOutput[(fixedLeft + 1) % count] += signal * fixedFraction * (1 - this.rotarySpread);
        }
      }
    }
    let peak = 0, total = 0;
    for (let speaker = 0; speaker < outputCount; speaker += 1) {
      let signal = channels[speaker][frame] * (1 - this.rotaryWet) + this.rotaryOutput[speaker] * this.rotaryWet;
      const previous = this.drivePrevious[speaker];
      this.drivePrevious[speaker] = signal;
      this.driveEnvelope[speaker] = Math.max(Math.abs(signal), this.driveEnvelope[speaker] * this.driveDecay);
      if (this.drive > 0 && (signal !== 0 || previous !== 0)) {
        // Partial normalization and surround panning can make each bus much
        // quieter than full scale. Shape relative to its own recent peak, then
        // restore that scale so drawbar levels, grain windows and fades remain.
        const reference = Math.max(0.0001, this.driveEnvelope[speaker]);
        const amount = 1 + 15 * this.drive * this.drive;
        const x = signal / reference, last = previous / reference;
        // First-order antiderivative antialiasing averages tanh over the sample
        // segment, using the same reference for both samples. Mild compensation
        // balances the added harmonics without the old full-drive level collapse.
        const difference = x - last;
        const saturated = Math.abs(difference) < 1e-7 ? Math.tanh(amount * (x + last) / 2)
          : (Math.log(Math.cosh(amount * x)) - Math.log(Math.cosh(amount * last))) / (amount * difference);
        const compensation = Math.tanh(amount) * (1 + 0.25 * this.drive);
        signal += (reference * saturated / compensation - signal) * this.drive;
      }
      this.rotaryOutput[speaker] = signal;
      peak = Math.max(peak, Math.abs(signal)); total += Math.abs(signal);
    }
    const scale = 1 / Math.max(1, peak / OUTPUT_CEILING, total / (OUTPUT_CEILING * Math.SQRT2));
    for (let speaker = 0; speaker < outputCount; speaker += 1) channels[speaker][frame] = this.rotaryOutput[speaker] * scale * this.level;
  }

  updateRoutes(initial = false) {
    const settings = this.settings;
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      const position = positionFromPattern(partial, settings, this.phase, this.pattern);
      this.positions[partial] = position;
      const left = Math.floor(position);
      const right = (left + 1) % settings.speakerCount;
      const mix = position - left;
      const leftGain = Math.cos(mix * Math.PI / 2);
      const rightGain = Math.sin(mix * Math.PI / 2);
      for (let speaker = 0; speaker < SPARTIAL_MAX_SPEAKERS; speaker += 1) {
        const index = partial * SPARTIAL_MAX_SPEAKERS + speaker;
        const target = speaker === left ? leftGain : speaker === right ? rightGain : 0;
        if (initial) {
          this.routes[index] = target;
          this.routeSteps[index] = 0;
        } else {
          // Interpolate at audio rate between control-rate route updates. This
          // also fades discrete pattern/array edits without restarting voices.
          const difference = target - this.routes[index];
          this.routeSteps[index] = difference * this.routeApproach / CONTROL_FRAMES;
        }
      }
    }
  }

  startVoice(voice, id, note, velocity, percussion = false) {
    voice.active = true;
    voice.id = id;
    voice.note = note;
    voice.velocity = velocity;
    voice.age = 0;
    voice.serial = ++this.serial;
    voice.gate = true;
    voice.pending = null;
    voice.releaseFrames = 0;
    voice.panicGain = 1;
    voice.panicStep = 0;
    voice.phases.fill(0);
    voice.envelopes.fill(0);
    voice.releaseSteps.fill(0);
    voice.noiseState = (this.settings.seed ^ Math.imul(voice.serial, 0x9e3779b1)) >>> 0 || 1;
    voice.lastNoise = 0; voice.chiffLow = 0; voice.chiffHigh = 0;
    voice.clickLevel = this.settings.keyClick; voice.chiffLevel = this.settings.pipeChiff;
    voice.percussionPhase = 0;
    voice.articulationDelay = 0;
    const harmonic = this.settings.organPercussion === "second" ? 2 : 3;
    const frequency = 440 * 2 ** ((note - 69) / 12) * harmonic;
    voice.percussionIncrement = TAU * Math.min(frequency, this.sampleRate * 0.49) / this.sampleRate;
    voice.percussionEnvelope = percussion && this.settings.organPercussion !== "off" && frequency < this.sampleRate * 0.45
      ? this.settings.percussionLevel * 0.45 : 0;
    voice.percussionDecay = Math.exp(-1 / (this.sampleRate * this.settings.percussionDecay));
    this.updateVoiceFrequencies(voice, true);
    voice.onsets.set(this.cascadeOnsets);
  }

  noteOn(id, note, velocity = 1) {
    if ((typeof id !== "string" && typeof id !== "number")
      || !Number.isFinite(note) || !Number.isFinite(velocity)) return false;
    const safeNote = clamp(note, 0, 127);
    const safeVelocity = clamp(velocity, 0, 1);
    if (safeVelocity === 0) { this.noteOff(id); return false; }
    // Repeated held IDs are idempotent; a retrigger needs a new ID or note-off.
    if (this.voices.some((voice) => voice.active && voice.gate && voice.id === id)) return false;
    // Hammond-inspired single trigger: percussion re-arms only after every
    // note gate (including queued replacements) has been released.
    const percussion = !this.voices.some(voice => (voice.active && voice.gate) || voice.pending);
    let voice = this.voices.find((candidate) => !candidate.active);
    if (voice) {
      this.startVoice(voice, id, safeNote, safeVelocity, percussion);
    } else {
      // Chord edits release the old latch first. Reuse its tails before taking
      // a still-held keyboard/MIDI note, and keep queued replacements intact.
      for (const candidate of this.voices) {
        if (!candidate.gate && !candidate.pending && (!voice || candidate.serial < voice.serial)) voice = candidate;
      }
      voice ??= this.voices.reduce((oldest, candidate) => candidate.serial < oldest.serial ? candidate : oldest);
      voice.pending = { id, note: safeNote, velocity: safeVelocity, percussion };
      // Give a pending replacement its own age so dense chords rotate through
      // all eight slots rather than repeatedly overwriting the same slot.
      voice.serial = ++this.serial;
      this.releaseVoice(voice, 0.006);
    }
    this.granular.noteOn(safeNote, safeVelocity);
    return true;
  }

  /** Restart one note after a 6 ms fade; other note IDs keep sounding. */
  retrigger(id, note, velocity = 1) {
    if ((typeof id !== "string" && typeof id !== "number")
      || !Number.isFinite(note) || !Number.isFinite(velocity)) return false;
    const safeNote = clamp(note, 0, 127);
    const safeVelocity = clamp(velocity, 0, 1);
    if (safeVelocity === 0) { this.noteOff(id); return false; }
    let destination = null;
    for (const voice of this.voices) {
      if (voice.active && voice.id === id && (!voice.pending || voice.pending.id === id)) {
        if (!destination || voice.gate) destination = voice;
      }
    }
    if (!destination) destination = this.voices.find((voice) => !voice.active);
    // A restart must not steal an unrelated held note. If this ID is already
    // queued behind a stolen voice, replacing that pending request is enough.
    if (!destination) destination = this.voices.find((voice) => voice.pending?.id === id);
    if (!destination) return false;
    for (const voice of this.voices) {
      if (voice.pending?.id === id) voice.pending = null;
      if (voice.active && voice.id === id) {
        // A different note may already be queued behind this old tail. Its
        // release countdown owns that entrance time, so leave it unchanged.
        if (!voice.pending) this.releaseVoice(voice, 0.006);
        // Keep the fade effective even when polyphonic gain normalization
        // would otherwise compensate for the descending release envelopes.
        voice.panicStep = voice.panicGain / voice.releaseFrames;
      }
    }
    const fadeFrames = Math.max(1, Math.round(0.006 * this.sampleRate));
    if (!destination.active) {
      // An empty slot waits silently for the same fixed restart interval.
      this.startVoice(destination, id, safeNote, safeVelocity);
      this.releaseVoice(destination, 0.006);
      destination.clickLevel = 0; destination.chiffLevel = 0; destination.percussionEnvelope = 0;
    }
    // An unrelated release may already own a queued replacement's slot. Keep
    // its remaining fade and add the rest of the fixed wait to the new voice.
    const delayFrames = Math.max(0, fadeFrames - destination.releaseFrames);
    destination.pending = { id, note: safeNote, velocity: safeVelocity, delayFrames };
    destination.serial = ++this.serial;
    this.granular.noteOn(safeNote, safeVelocity);
    return true;
  }

  releaseVoice(voice, seconds) {
    voice.gate = false;
    voice.releaseFrames = Math.max(1, Math.round(seconds * this.sampleRate));
    for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
      voice.releaseSteps[partial] = voice.envelopes[partial] / voice.releaseFrames;
    }
  }

  noteOff(id) {
    for (const voice of this.voices) {
      if (voice.pending?.id === id) voice.pending = null;
      if (voice.active && voice.id === id && voice.gate) {
        this.releaseVoice(voice, this.settings.release);
      }
    }
  }

  panic() {
    this.granular.panic();
    for (const voice of this.voices) {
      voice.pending = null;
      if (voice.active) {
        this.releaseVoice(voice, 0.006);
        // This extra ramp sits outside envelope normalization, so dense
        // chords fade throughout the six milliseconds as single notes do.
        voice.panicStep = voice.panicGain / voice.releaseFrames;
      }
    }
  }

  /** Fill caller-owned channels; no AudioContext, DOM, timers or frame loop. */
  render(channels) {
    const length = channels[0]?.length || 0;
    for (const channel of channels) channel.fill(0);
    const outputCount = Math.min(channels.length, SPARTIAL_MAX_SPEAKERS);
    const attackStep = 1 / (this.settings.attack * this.sampleRate);
    const energyDecay = Math.exp(-1 / (this.sampleRate * 0.07));
    for (let frame = 0; frame < length; frame += 1) {
      if (this.frame % CONTROL_FRAMES === 0) { this.updateRoutes(); this.updateModulation(); }
      this.updateEffectsClock();
      this.rotation += (this.settings.rotation - this.rotation) * this.approach;
      this.level += (this.settings.level - this.level) * this.approach;
      if (this.settings.level === 0 && this.level < 1e-10) this.level = 0;
      this.phase = wrap(this.phase + this.rotation / this.sampleRate);
      this.partialSignals.fill(0);
      this.articulationSignal = 0;
      const modulating = this.pitchDepth > 0 || this.amplitudeDepth > 0;
      const pitchModulating = this.pitchDepth > 1e-7;
      if (modulating) for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
          this.pitchRatios[partial] += this.pitchSteps[partial];
          this.amplitudeGains[partial] += this.amplitudeSteps[partial];
        }
      let envelopeSum = 0;
      let gated = false;
      for (const voice of this.voices) {
        if (!voice.active) continue;
        if (voice.gate) gated = true;
        let peakEnvelope = 0;
        const voiceGain = voice.velocity * voice.panicGain;
        for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
          voice.spectralGains[partial] += (voice.audible[partial] - voice.spectralGains[partial]) * this.approach;
          if (!voice.audible[partial] && voice.spectralGains[partial] < 1e-7) {
            voice.spectralGains[partial] = 0;
            continue;
          }
          voice.increments[partial] += (voice.targetIncrements[partial] - voice.increments[partial]) * this.approach;
          let envelope = voice.envelopes[partial];
          if (voice.gate) {
            if (voice.age >= voice.onsets[partial]) envelope = Math.min(1, envelope + attackStep);
          } else {
            envelope = Math.max(0, envelope - voice.releaseSteps[partial]);
          }
          voice.envelopes[partial] = envelope;
          peakEnvelope = Math.max(peakEnvelope, envelope);
          const increment = pitchModulating ? voice.increments[partial] * this.pitchRatios[partial] : voice.increments[partial];
          let phase = voice.phases[partial] + (increment > TAU * 0.49 ? TAU * 0.49 : increment);
          if (phase >= TAU) phase -= TAU;
          voice.phases[partial] = phase;
          let signal = Math.sin(phase) * envelope * voiceGain * voice.spectralGains[partial];
          if (pitchModulating && increment > TAU * 0.46) signal *= Math.max(0, (TAU * 0.49 - increment) / (TAU * 0.03));
          this.partialSignals[partial] += signal;
        }
        if (voice.clickLevel > 0 || voice.chiffLevel > 0 || voice.percussionEnvelope > 0) {
          this.articulationSignal += this.voiceArticulation(voice);
        }
        envelopeSum += peakEnvelope * voice.velocity;
        voice.panicGain = Math.max(0, voice.panicGain - voice.panicStep);
        voice.age += 1;
        if (!voice.gate) {
          voice.releaseFrames -= 1;
          if (voice.releaseFrames <= 0) {
            const next = voice.pending;
            voice.active = false;
            if (next) {
              this.startVoice(voice, next.id, next.note, next.velocity, next.percussion);
              if (next.delayFrames) {
                voice.articulationDelay = next.delayFrames;
                for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
                  voice.onsets[partial] += next.delayFrames;
                }
              }
            }
          }
        }
      }
      // Per-sample envelope normalization cannot overshoot when voices start
      // or release. Sum of weights <=1, route gains <=1, envelopes <=1, so even
      // eight phase-aligned notes gathered into one speaker stay <=0.72.
      const effects = this.rotaryWet > 0 || this.drive > 0 || this.articulationSignal !== 0 || this.articulationGain > 1e-10;
      this.articulationGain += (Math.abs(this.articulationSignal) - this.articulationGain) * this.approach;
      const gain = OUTPUT_CEILING * (effects ? 1 : this.level) / Math.max(1, envelopeSum);
      let capture = 0;
      for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
        this.weights[partial] += (this.targetWeights[partial] - this.weights[partial]) * this.approach;
        if (modulating) this.partialSignals[partial] *= this.amplitudeGains[partial];
        capture += this.partialSignals[partial] * this.weights[partial] / Math.max(1, envelopeSum);
      }
      capture += this.articulationSignal / Math.max(1, envelopeSum);
      if (this.articulationSignal !== 0 && Math.abs(capture) > 0.9) {
        capture = Math.sign(capture) * (0.9 + 0.1 * Math.tanh((Math.abs(capture) - 0.9) / 0.1));
      }
      this.granular.capture(capture, this.frame);
      const grainOutput = this.granular.tick(this.frame, this.phase, gated, this.level);
      const mix = this.granular.mix;
      for (let partial = 0; partial < SPARTIAL_MAX_PARTIALS; partial += 1) {
        const signal = this.partialSignals[partial] * this.weights[partial] * gain * (1 - mix);
        this.partialEnergy[partial] = this.partialEnergy[partial] * energyDecay
          + Math.abs(signal) * (effects ? this.level : 1) * (1 - energyDecay);
        for (let speaker = 0; speaker < SPARTIAL_MAX_SPEAKERS; speaker += 1) {
          const index = partial * SPARTIAL_MAX_SPEAKERS + speaker;
          this.routes[index] += this.routeSteps[index];
          if (speaker < outputCount) channels[speaker][frame] += signal * this.routes[index];
        }
      }
      if (mix > 0) {
        for (let speaker = 0; speaker < outputCount; speaker += 1) {
          channels[speaker][frame] += grainOutput[speaker] * OUTPUT_CEILING * (effects ? 1 : this.level) * mix;
        }
      }
      if (this.articulationSignal !== 0) {
        const partial = this.settings.organMode === "partials" ? 0 : 1;
        for (let speaker = 0; speaker < outputCount; speaker += 1) {
          channels[speaker][frame] += this.articulationSignal * gain * (1 - mix) * this.routes[partial * SPARTIAL_MAX_SPEAKERS + speaker];
        }
      }
      if (effects) this.processOutputEffects(channels, frame, outputCount);
      else {
        // Keep the detector current while bypassed, without changing a single
        // dry output sample. Master volume is outside the drive's reference.
        for (let speaker = 0; speaker < outputCount; speaker += 1) {
          const signal = this.level > 0 ? channels[speaker][frame] / this.level : 0;
          this.drivePrevious[speaker] = signal;
          this.driveEnvelope[speaker] = Math.max(Math.abs(signal), this.driveEnvelope[speaker] * this.driveDecay);
        }
      }
      this.frame += 1;
    }
  }

  snapshot() {
    return {
      phase: this.phase,
      voices: this.voices.filter((voice) => voice.active).length,
      positions: Array.from(this.positions.slice(0, this.settings.partials)),
      partialEnergy: Array.from(this.partialEnergy.slice(0, this.settings.partials)),
      modulationPhase: this.modulationPhase,
      modulationValues: Array.from(this.modulationValues.slice(0, this.settings.partials)),
      pitchCents: Array.from(this.pitchRatios.slice(0, this.settings.partials), ratio => 1200 * Math.log2(ratio)),
      amplitudeGains: Array.from(this.amplitudeGains.slice(0, this.settings.partials)),
      rotaryHornPhase: this.rotaryHornPhase,
      rotaryDrumPhase: this.rotaryDrumPhase,
      rotaryHornHz: this.rotaryHornHz,
      rotaryDrumHz: this.rotaryDrumHz,
      ...this.granular.snapshot(this.level),
    };
  }
}
