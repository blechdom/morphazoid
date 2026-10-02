import {
  THROAT_SINGING_LIMITS,
  THROAT_SINGING_MOTION_SHAPES,
  THROAT_SINGING_STYLE_PRESETS,
  dualFocusTargets,
  modulateThroatSingingPerformance,
  sampleThroatSingingMotion,
  sanitizeThroatSingingState,
  throatSingingState,
} from "./throat-singing.js";

const TAU = Math.PI * 2;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, finite(value, low)));
const cycle = (value) => ((value % 1) + 1) % 1;
const mix = (from, to, amount) => from + (to - from) * amount;
const smooth = (value) => { const x = clamp(value); return x * x * (3 - 2 * x); };
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const LOOP_MODES = freeze([
  { id: "off", label: "Off" },
  { id: "once", label: "Once" },
  { id: "loop", label: "Loop" },
  { id: "alternate", label: "Back and forth" },
]);

// These are authored synthesis gestures. The labels make no claim about a
// particular singer, culture, or measured articulation.
export const ORNAMENT_PATTERNS = freeze([
  { id: "none", label: "Still", shape: "none", weights: [0, 0, 0, 0, 0] },
  { id: "swell", label: "Swell", shape: "swell", weights: [0.35, 0.7, 0.65, 1, 0.3] },
  { id: "roll", label: "Rolling tongue", shape: "roll", weights: [1, 0.36, 0.65, 0.64, 0.8] },
  { id: "flutter", label: "Flutter", shape: "flutter", weights: [0.8, 1, 0.25, 0.7, 0.65] },
  { id: "double-pulse", label: "Double pulse", shape: "double", weights: [0.55, 0.7, 1, 1, 0.15] },
  { id: "climb", label: "Overtone climb", shape: "climb", weights: [0.9, 0.28, 0.55, 0.5, 1] },
  { id: "fall", label: "Overtone fall", shape: "fall", weights: [0.76, 0.45, 0.8, 0.62, 1] },
  { id: "spiral", label: "Spiral", shape: "spiral", weights: [0.7, 0.85, 0.9, 0.45, 0.8] },
  { id: "rock", label: "Throat rock", shape: "rock", weights: [0.38, 1, 0.6, 0.9, 0.55] },
  { id: "hiccup", label: "Soft hiccup", shape: "hiccup", weights: [0.4, 0.65, 0.9, 1, 0.45] },
  { id: "pendulum", label: "Wide pendulum", shape: "pendulum", weights: [1, 0.7, 0.82, 0.42, 0.9] },
  { id: "breath-wave", label: "Breath wave", shape: "breath", weights: [0.24, 0.5, 1, 1, 0.38] },
  { id: "rake", label: "Harmonic rake", shape: "rake", weights: [1, 0.42, 0.44, 0.65, 1] },
  { id: "ripple", label: "Lip ripple", shape: "ripple", weights: [0.44, 0.4, 1, 0.72, 0.52] },
  { id: "skip", label: "Skipping pulses", shape: "skip", weights: [0.6, 0.8, 0.65, 1, 0.7] },
  { id: "accelerate", label: "Gathering roll", shape: "accelerate", weights: [0.9, 0.6, 0.75, 0.85, 0.65] },
  { id: "decelerate", label: "Unwinding roll", shape: "decelerate", weights: [0.8, 0.7, 0.9, 0.75, 0.6] },
  { id: "crescent", label: "Crescent", shape: "crescent", weights: [0.62, 0.9, 0.72, 0.8, 0.9] },
  { id: "echo", label: "Echo pulses", shape: "echo", weights: [0.8, 0.65, 0.5, 1, 0.72] },
]);

export const PITCH_MELODIES = freeze([
  { id: "steady", label: "Steady drone", notes: [0], hold: 0 },
  { id: "arch", label: "Rising arch", notes: [0, 0.25, 0.5, 1, 0.5, 0.25], hold: 0.18 },
  { id: "valley", label: "Falling valley", notes: [0, -0.25, -0.5, -1, -0.5, -0.25], hold: 0.18 },
  { id: "pendulum", label: "Pitch pendulum", notes: [0, 1, 0, -1], hold: 0 },
  { id: "three-step", label: "Three step", notes: [0, 1 / 3, 2 / 3, 1, 2 / 3, 1 / 3], hold: 0.6 },
  { id: "fifths", label: "Open fifths", notes: [0, 7 / 12, 0, 1, 7 / 12, 0], hold: 0.7 },
  { id: "minor-turn", label: "Minor turn", notes: [0, 3 / 12, 7 / 12, 5 / 12, 3 / 12, -2 / 12], hold: 0.55 },
  { id: "major-turn", label: "Major turn", notes: [0, 4 / 12, 7 / 12, 1, 9 / 12, 4 / 12], hold: 0.55 },
  { id: "stairs", label: "Chromatic stairs", notes: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1], hold: 0.65 },
  { id: "wide-leaps", label: "Wide leaps", notes: [0, 1, -0.5, 0.75, -1, 0.5], hold: 0.7 },
  { id: "drift", label: "Floating drift", notes: [0, 0.36, -0.12, 0.72, 0.19, -0.45, -0.15], hold: 0 },
  { id: "answer", label: "Call and answer", notes: [0, 0.5, 0.75, 0.5, 0, -0.5, -0.25, 0], hold: 0.5 },
  { id: "orbit", label: "Whole tone orbit", notes: [0, 2 / 12, 4 / 12, 6 / 12, 8 / 12, 10 / 12, 1, 6 / 12], hold: 0.45 },
]);

export const THROAT_SINGER_PERFORMANCE_DEFAULTS = freeze({
  ornamentId: "none",
  ornamentLoop: "loop",
  melodyId: "steady",
  melodyRateHz: 0.12,
  melodyDepthSemitones: 12,
});

export const THROAT_SINGER_EXTRA_DEFAULTS = freeze({
  sublingualCoupling: 0.06,
  pulseRate: 0,
  pulseDepth: 0,
  phantomAirways: 1,
  impossibleFocus: 0,
  sourceInstability: 0,
});

const ornamentById = new Map(ORNAMENT_PATTERNS.map((entry) => [entry.id, entry]));
const melodyById = new Map(PITCH_MELODIES.map((entry) => [entry.id, entry]));

export function sanitizePerformanceSettings(candidate = {}) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  return freeze({
    ornamentId: ornamentById.has(source.ornamentId) ? source.ornamentId : "none",
    ornamentLoop: LOOP_MODES.some(({ id }) => id === source.ornamentLoop) ? source.ornamentLoop : "loop",
    melodyId: melodyById.has(source.melodyId) ? source.melodyId : "steady",
    melodyRateHz: clamp(finite(source.melodyRateHz, 0.12), 0, 4),
    melodyDepthSemitones: clamp(finite(source.melodyDepthSemitones, 12), 0, 24),
  });
}

export function sanitizeSingerExtras(candidate = {}) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  return freeze(Object.fromEntries(Object.entries(THROAT_SINGER_EXTRA_DEFAULTS).map(([key, fallback]) => {
    const value = finite(source[key], fallback);
    return [key, key === "phantomAirways" ? Math.round(clamp(value, 1, 4))
      : key === "pulseRate" ? clamp(value, 0, 10) : clamp(value)];
  })));
}

function makePreset(id, label, styleId, state, extras = {}, settings = {}) {
  const fullState = throatSingingState(styleId, { ...state, active: false, level: 0.28 });
  const fullExtras = sanitizeSingerExtras(extras);
  const fullSettings = sanitizePerformanceSettings(settings);
  const { level: _level, active: _active, ...musicalState } = fullState;
  return freeze({
    id, label, state: fullState, extras: fullExtras, settings: fullSettings,
    snapshot: { state: musicalState, extras: fullExtras, settings: fullSettings },
  });
}

export const THROAT_SINGER_PRESETS = freeze([
  makePreset("open-drone", "Open drone", "open-drone", { motionRateHz: 0.35, motionDepth: 0.18 }),
  makePreset("soft-swell", "Soft swell", "open-drone", { trueFoldHz: 98, harmonicNumber: 6, intensity: 0.43, mouthOpening: 0.76, motionRateHz: 0.18, motionDepth: 0.65 }, {}, { ornamentId: "swell" }),
  makePreset("velvet-bass", "Velvet bass", "low-chant", { trueFoldHz: 65, harmonicNumber: 6, creakAmount: 0.18, formantConvergence: 0.35, tractLengthCm: 21, motionRateHz: 0.24, motionDepth: 0.3 }, { sublingualCoupling: 0.18 }, { ornamentId: "breath-wave", melodyId: "valley", melodyRateHz: 0.06, melodyDepthSemitones: 4 }),
  makePreset("bright-thread", "Bright thread", "sygyt", { trueFoldHz: 176, harmonicNumber: 15, intensity: 0.65, focusBandwidthHz: 38, motionRateHz: 0.72, motionDepth: 0.3 }, { sublingualCoupling: 0.35 }, { ornamentId: "climb" }),
  makePreset("rounded-glass", "Rounded glass", "western-overtone", { trueFoldHz: 154, harmonicNumber: 13, lipRounding: 0.88, mouthOpening: 0.24, frontCavityExpansion: 0.78, motionRateHz: 0.4, motionDepth: 0.58 }, { sublingualCoupling: 0.55 }, { ornamentId: "ripple", melodyId: "arch", melodyDepthSemitones: 5 }),
  makePreset("deep-gravel", "Deep gravel", "kargyraa", { trueFoldHz: 92, falseFoldDivision: 2, harmonicNumber: 7, creakAmount: 0.6, roughness: 0.65, tractLengthCm: 22, motionRateHz: 0.5, motionDepth: 0.5 }, { sourceInstability: 0.3, pulseRate: 0.5, pulseDepth: 0.2 }, { ornamentId: "rock", melodyId: "minor-turn", melodyRateHz: 0.08 }),
  makePreset("three-fold-cavern", "Three fold cavern", "kargyraa", { trueFoldHz: 165, falseFoldDivision: 3, falseFoldCoupling: 0.93, harmonicNumber: 11, mouthOpening: 0.92, formantConvergence: 0.52, motionRateHz: 0.28, motionDepth: 0.8 }, { sublingualCoupling: 0.65, pulseRate: 0.9, pulseDepth: 0.32 }, { ornamentId: "swell", melodyId: "fifths", melodyRateHz: 0.09 }),
  makePreset("four-fold-stone", "Four fold stone", "kargyraa", { trueFoldHz: 236, falseFoldDivision: 4, falseFoldCoupling: 0.88, harmonicNumber: 14, foldTenseness: 0.77, roughness: 0.48, motionRateHz: 0.85, motionDepth: 0.7 }, { pulseRate: 1.7, pulseDepth: 0.4 }, { ornamentId: "double-pulse", melodyId: "answer", melodyRateHz: 0.13, melodyDepthSemitones: 7 }),
  makePreset("reed-orbit", "Reed orbit", "xoomei", { trueFoldHz: 128, harmonicNumber: 9, lipRounding: 0.62, frontCavityExpansion: 0.82, motionRateHz: 0.42, motionDepth: 0.75 }, { sublingualCoupling: 0.45 }, { ornamentId: "spiral", melodyId: "orbit", melodyRateHz: 0.08, melodyDepthSemitones: 7 }),
  makePreset("rolling-light", "Rolling light", "borbangnadyr", { trueFoldHz: 142, harmonicNumber: 12, intensity: 0.64, motionRateHz: 1.2, motionDepth: 0.62, amplitudeMotionDepth: 0.35 }, { sublingualCoupling: 0.25 }, { ornamentId: "roll" }),
  makePreset("quick-silver", "Quick silver", "sygyt", { trueFoldHz: 210, harmonicNumber: 18, vibratoDepthCents: 8, motionRateHz: 2.4, motionDepth: 0.45 }, { sublingualCoupling: 0.32 }, { ornamentId: "flutter", melodyId: "three-step", melodyRateHz: 0.22, melodyDepthSemitones: 5 }),
  makePreset("two-heartbeats", "Two heartbeats", "ezengileer", { trueFoldHz: 120, harmonicNumber: 10, motionRateHz: 0.8, motionDepth: 0.8 }, { pulseRate: 1.6, pulseDepth: 0.55 }, { ornamentId: "double-pulse", melodyId: "fifths", melodyRateHz: 0.12, melodyDepthSemitones: 7 }),
  makePreset("long-climb", "Long climb", "western-overtone", { trueFoldHz: 104, harmonicNumber: 11, formantConvergence: 0.85, motionRateHz: 0.12, motionDepth: 0.95 }, { sublingualCoupling: 0.3 }, { ornamentId: "climb", ornamentLoop: "alternate", melodyId: "stairs", melodyRateHz: 0.05 }),
  makePreset("falling-ember", "Falling ember", "xoomei", { trueFoldHz: 164, harmonicNumber: 8, intensity: 0.5, roughness: 0.28, motionRateHz: 0.24, motionDepth: 0.85 }, { sourceInstability: 0.1 }, { ornamentId: "fall", melodyId: "valley", melodyRateHz: 0.07, melodyDepthSemitones: 7 }),
  makePreset("wide-pendulum", "Wide pendulum", "western-overtone", { trueFoldHz: 133, harmonicNumber: 10, mouthOpening: 0.85, motionRateHz: 0.6, motionDepth: 0.9 }, { sublingualCoupling: 0.5 }, { ornamentId: "pendulum", melodyId: "pendulum", melodyRateHz: 0.1, melodyDepthSemitones: 5 }),
  makePreset("small-hiccups", "Small hiccups", "open-drone", { trueFoldHz: 116, harmonicNumber: 7, foldTenseness: 0.65, motionRateHz: 1.5, motionDepth: 0.72 }, { pulseRate: 0.7, pulseDepth: 0.3 }, { ornamentId: "hiccup", melodyId: "three-step", melodyRateHz: 0.18, melodyDepthSemitones: 3 }),
  makePreset("harmonic-rake", "Harmonic rake", "sygyt", { trueFoldHz: 138, harmonicNumber: 17, alveolarConstriction: 0.94, focusBandwidthHz: 45, motionRateHz: 0.5, motionDepth: 0.96 }, { impossibleFocus: 0.22 }, { ornamentId: "rake", melodyId: "minor-turn", melodyRateHz: 0.1, melodyDepthSemitones: 5 }),
  makePreset("lip-lantern", "Lip lantern", "xoomei", { trueFoldHz: 95, harmonicNumber: 8, lipRounding: 0.8, mouthOpening: 0.36, motionRateHz: 0.95, motionDepth: 0.85 }, { sublingualCoupling: 0.72 }, { ornamentId: "ripple", melodyId: "drift", melodyRateHz: 0.06, melodyDepthSemitones: 3 }),
  makePreset("skipping-pebbles", "Skipping pebbles", "ezengileer", { trueFoldHz: 156, harmonicNumber: 10, roughness: 0.22, motionRateHz: 1.1, motionDepth: 0.7 }, { pulseRate: 2.8, pulseDepth: 0.6 }, { ornamentId: "skip", melodyId: "major-turn", melodyRateHz: 0.16, melodyDepthSemitones: 7 }),
  makePreset("gathering-storm", "Gathering storm", "kargyraa", { trueFoldHz: 130, harmonicNumber: 13, creakAmount: 0.42, roughness: 0.7, motionRateHz: 0.35, motionDepth: 0.92 }, { sourceInstability: 0.5, pulseDepth: 0.24, pulseRate: 1.2 }, { ornamentId: "accelerate", melodyId: "arch", melodyRateHz: 0.07, melodyDepthSemitones: 8 }),
  makePreset("unwinding-coil", "Unwinding coil", "borbangnadyr", { trueFoldHz: 148, harmonicNumber: 11, vibratoDepthCents: 32, motionRateHz: 0.48, motionDepth: 0.85 }, { sublingualCoupling: 0.38 }, { ornamentId: "decelerate", ornamentLoop: "alternate", melodyId: "valley", melodyRateHz: 0.09, melodyDepthSemitones: 5 }),
  makePreset("crescent-song", "Crescent song", "western-overtone", { trueFoldHz: 180, harmonicNumber: 9, foldTenseness: 0.7, motionRateHz: 0.32, motionDepth: 0.75 }, { sublingualCoupling: 0.28 }, { ornamentId: "crescent", melodyId: "major-turn", melodyRateHz: 0.12 }),
  makePreset("echo-chamber", "Echo chamber", "low-chant", { trueFoldHz: 88, harmonicNumber: 9, formantConvergence: 0.62, frontCavityExpansion: 0.9, motionRateHz: 0.65, motionDepth: 0.78 }, { sublingualCoupling: 0.85, pulseRate: 1.3, pulseDepth: 0.45 }, { ornamentId: "echo", melodyId: "answer", melodyRateHz: 0.08, melodyDepthSemitones: 5 }),
  makePreset("floating-voice", "Floating voice", "open-drone", { trueFoldHz: 193, harmonicNumber: 6, intensity: 0.4, roughness: 0.03, vibratoDepthCents: 40, mouthOpening: 0.9, motionRateHz: 0.16, motionDepth: 0.35 }, {}, { ornamentId: "breath-wave", melodyId: "drift", melodyRateHz: 0.04, melodyDepthSemitones: 6 }),
  makePreset("tiny-whistle", "Tiny whistle", "sygyt", { trueFoldHz: 276, harmonicNumber: 21, intensity: 0.5, mouthOpening: 0.16, lipRounding: 0.7, tractLengthCm: 13.5, vibratoDepthCents: 5, motionRateHz: 1.8, motionDepth: 0.35 }, { impossibleFocus: 0.35 }, { ornamentId: "flutter", melodyId: "stairs", melodyRateHz: 0.25, melodyDepthSemitones: 3 }),
  makePreset("wide-leaping-drone", "Wide leaping drone", "xoomei", { trueFoldHz: 145, harmonicNumber: 9, motionRateHz: 0.5, motionDepth: 0.55 }, { sublingualCoupling: 0.32 }, { ornamentId: "pendulum", melodyId: "wide-leaps", melodyRateHz: 0.08, melodyDepthSemitones: 12 }),
  makePreset("phantom-choir", "Phantom choir", "western-overtone", { trueFoldHz: 122, harmonicNumber: 14, intensity: 0.58, motionRateHz: 0.3, motionDepth: 0.75 }, { phantomAirways: 4, impossibleFocus: 0.55, sourceInstability: 0.16, sublingualCoupling: 0.6 }, { ornamentId: "spiral", melodyId: "fifths", melodyRateHz: 0.06 }),
  makePreset("fractured-metal", "Fractured metal", "kargyraa", { trueFoldHz: 310, falseFoldDivision: 7, falseFoldCoupling: 0.96, harmonicNumber: 23, roughness: 0.85, creakAmount: 0.72, focusBandwidthHz: 28, motionRateHz: 1.4, motionDepth: 0.88 }, { phantomAirways: 2, impossibleFocus: 0.7, sourceInstability: 0.8, pulseRate: 4.2, pulseDepth: 0.65 }, { ornamentId: "rake", melodyId: "orbit", melodyRateHz: 0.14, melodyDepthSemitones: 5 }),
]);

function shapeAt(shape, phase) {
  const s = (turns, offset = 0) => Math.sin(TAU * (phase * turns + offset));
  if (shape === "swell") return Math.sin(Math.PI * phase);
  if (shape === "roll") return s(3) * 0.75 + s(1, 0.08) * 0.25;
  if (shape === "flutter") return s(7) * (0.55 + 0.45 * Math.sin(Math.PI * phase));
  if (shape === "double") return (Math.exp(-(((phase - 0.25) / 0.13) ** 2))
    + Math.exp(-(((phase - 0.67) / 0.17) ** 2)) * 0.72) * 1.5 - 0.5;
  if (shape === "climb") return phase * 2 - 1;
  if (shape === "fall") return 1 - phase * 2;
  if (shape === "spiral") return s(2) * 0.65 + s(3, 0.25) * 0.35;
  if (shape === "rock") return s(1) * 0.8 + s(2) * 0.2;
  if (shape === "hiccup") return 0.3 - Math.exp(-(((phase - 0.38) / 0.09) ** 2)) * 1.3;
  if (shape === "pendulum") return Math.cos(TAU * phase);
  if (shape === "breath") return Math.sin(Math.PI * phase) * 0.7 + s(1) * 0.3;
  if (shape === "rake") return s(4) * 0.7 + (phase * 2 - 1) * 0.3;
  if (shape === "ripple") return s(5) * 0.65 + s(2, 0.2) * 0.35;
  if (shape === "skip") return s(3) * (0.5 + 0.5 * Math.cos(TAU * phase));
  if (shape === "accelerate") return Math.sin(TAU * (phase + phase * phase * 3));
  if (shape === "decelerate") return Math.sin(TAU * (phase * 7 - phase * phase * 3));
  if (shape === "crescent") return s(1, -0.15) * 0.6 + Math.sin(Math.PI * phase) * 0.4;
  if (shape === "echo") return s(4) * Math.exp(-phase * 2);
  return 0;
}

function melodyAt(melody, phase) {
  if (melody.notes.length === 1) return melody.notes[0];
  const position = cycle(phase) * melody.notes.length;
  const index = Math.floor(position);
  const blend = smooth((position - index - melody.hold) / (1 - melody.hold));
  return mix(melody.notes[index], melody.notes[(index + 1) % melody.notes.length], blend);
}

/**
 * Audio and drawing consume the same externally supplied clock. The optional
 * local clocks allow retriggering one phrase without resetting the other.
 * Once completion returns to the authored pose; it never changes transport.
 */
export function evaluateSingerPerformance(baseState, extras, settings, timeSeconds = 0, timing = {}) {
  const base = sanitizeThroatSingingState(baseState);
  const extra = sanitizeSingerExtras(extras);
  const controls = sanitizePerformanceSettings(settings);
  const elapsed = clamp(finite(timeSeconds), 0, 1e9);
  const clocks = timing && typeof timing === "object" ? timing : {};
  const ornamentTime = clamp(finite(clocks.ornamentTimeSeconds, elapsed), 0, 1e9);
  const melodyTime = clamp(finite(clocks.melodyTimeSeconds, elapsed), 0, 1e9);
  const ornament = ornamentById.get(controls.ornamentId);
  const cycles = ornamentTime * base.motionRateHz;
  const ornamentEnabled = ornament.id !== "none" && controls.ornamentLoop !== "off" && base.motionRateHz > 0;
  const ornamentFinished = ornamentEnabled && controls.ornamentLoop === "once" && cycles >= 1;
  let phase = cycle(cycles);
  if (controls.ornamentLoop === "once") phase = Math.min(1, cycles);
  else if (controls.ornamentLoop === "alternate" && Math.floor(cycles) % 2) phase = 1 - phase;
  const active = ornamentEnabled && !ornamentFinished && base.motionDepth > 0;
  // A zero value and zero slope at both phrase ends make loop/once seams
  // smooth even for the accelerating and nonperiodic contour shapes.
  const envelope = active ? Math.sin(Math.PI * phase) ** 2 * base.motionDepth : 0;
  const wave = active ? clamp(shapeAt(ornament.shape, phase), -1, 1) * envelope : 0;
  const secondary = active ? (Math.sin(TAU * phase) * 0.8
    + sampleThroatSingingMotion(base.motionShape, phase) * 0.2) * envelope : 0;
  const [tongueWeight, throatWeight, lipWeight, pressureWeight, focusWeight] = ornament.weights;
  const tongueMotion = wave * tongueWeight;
  const throatMotion = (wave * 0.76 + secondary * 0.24) * throatWeight;
  const lipMotion = (wave * 0.62 - secondary * 0.38) * lipWeight;
  const pressureMotion = (wave * 0.8 + envelope * 0.2) * pressureWeight;
  const effective = sanitizeThroatSingingState({
    ...base,
    uvularConstriction: base.uvularConstriction + throatMotion * 0.24,
    alveolarConstriction: base.alveolarConstriction + tongueMotion * 0.2,
    frontCavityExpansion: base.frontCavityExpansion - tongueMotion * 0.18,
    mouthOpening: base.mouthOpening + lipMotion * 0.22,
    lipRounding: base.lipRounding - lipMotion * 0.25,
    foldTenseness: base.foldTenseness + throatMotion * 0.06,
    intensity: base.intensity * clamp(1 + pressureMotion * (0.3 + base.amplitudeMotionDepth * 0.3), 0.5, 1.6),
    // The authored ornament replaces the old generic motion, while the source
    // vibrato remains independent and follows the global audio clock.
    motionDepth: 0,
    amplitudeMotionDepth: 0,
  }, base);
  const melodyPhase = melodyTime * controls.melodyRateHz;
  const melodyValue = controls.melodyRateHz > 0 ? melodyAt(melodyById.get(controls.melodyId), melodyPhase) : 0;
  const pitchSemitones = melodyValue * controls.melodyDepthSemitones;
  const modulated = modulateThroatSingingPerformance(effective, elapsed, { pitchCents: pitchSemitones * 100 });
  const targetHarmonic = clamp(base.harmonicNumber + wave * focusWeight * 3, ...THROAT_SINGING_LIMITS.harmonicNumber);
  const focusFrequencyHz = modulated.heardDroneHz * targetHarmonic;
  const pulsing = extra.pulseRate > 0 ? Math.sin(TAU * elapsed * extra.pulseRate) * extra.pulseDepth : 0;
  const performance = freeze({
    ...modulated,
    motionDepth: base.motionDepth,
    amplitudeMotionDepth: base.amplitudeMotionDepth,
    motionPhase: cycles,
    motionWave: wave,
    targetHarmonic,
    pitchSemitones,
    pressurePulseWave: pulsing,
    focusFrequencyHz,
    focus: dualFocusTargets(modulated, focusFrequencyHz),
  });
  const animation = freeze({
    phase, ornamentPhase: phase, melodyPhase: cycle(melodyPhase), active, ornamentFinished,
    tongue: tongueMotion, lips: lipMotion, throat: throatMotion,
    pulse: clamp(pressureMotion * 0.75 + pulsing * 0.25, -1, 1),
    nose: clamp(throatMotion * 0.35 + lipMotion * 0.25, -1, 1),
    jaw: lipMotion * 0.7,
    airflow: clamp(performance.intensity * (1 + pulsing * 0.2)),
    pitch: melodyValue,
  });
  return freeze({
    state: sanitizeThroatSingingState(performance), extras: extra, settings: controls,
    performance, animation, ornamentFinished,
    ornamentDurationSeconds: ornamentEnabled ? 1 / base.motionRateHz : null,
  });
}

/** Every musical field varies independently; output level is a runtime trim. */
export function randomizeSingerPreset(random = Math.random, currentLevel = 0.28) {
  const generator = typeof random === "function" ? random : Math.random;
  const unit = () => clamp(finite(generator(), 0.5), 0, 1 - Number.EPSILON);
  const range = (low, high) => mix(low, high, unit());
  const pick = (values) => values[Math.floor(unit() * values.length)];
  const values = Object.fromEntries(Object.entries(THROAT_SINGING_LIMITS).map(([key, limits]) => [key, range(...limits)]));
  values.trueFoldHz = Math.exp(range(Math.log(55), Math.log(320)));
  values.intensity = range(0.3, 0.94);
  values.formantSeparationHz = range(80, 820);
  values.focusBandwidthHz = Math.exp(range(Math.log(30), Math.log(440)));
  values.vibratoDepthCents = range(0, 65);
  values.motionRateHz = Math.exp(range(Math.log(0.08), Math.log(6)));
  values.level = clamp(finite(currentLevel, 0.28), ...THROAT_SINGING_LIMITS.level);
  const state = sanitizeThroatSingingState({
    ...values, active: false,
    styleId: pick(THROAT_SINGING_STYLE_PRESETS).id,
    motionShape: pick(THROAT_SINGING_MOTION_SHAPES),
  });
  const extras = sanitizeSingerExtras({
    sublingualCoupling: unit(), pulseRate: range(0, 10), pulseDepth: unit(),
    phantomAirways: Math.floor(range(1, 5)), impossibleFocus: unit(), sourceInstability: unit(),
  });
  const settings = sanitizePerformanceSettings({
    ornamentId: pick(ORNAMENT_PATTERNS).id,
    ornamentLoop: pick(LOOP_MODES).id,
    melodyId: pick(PITCH_MELODIES).id,
    melodyRateHz: Math.exp(range(Math.log(0.025), Math.log(1.5))),
    melodyDepthSemitones: range(0, 24),
  });
  const { level: _level, active: _active, ...musicalState } = state;
  return freeze({
    state, extras, settings,
    snapshot: { state: musicalState, extras, settings },
  });
}
