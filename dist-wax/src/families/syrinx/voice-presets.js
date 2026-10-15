import { ANIMALS, CONTROL_LIMITS, MODULATION_TARGETS, animalState, sanitizeSyrinxState } from "./syrinx.js";
import { DEFAULT_TONGUE_STATE, TONGUE_ANATOMIES, sanitizeTongueState } from "./tongue-physics.js";
import { FERAL_TONGUE_PRESETS, TONGUE_MOTION_PRESETS, TONGUE_PARAMETER_LIMITS } from "./tongue-performance.js";
import { clonePresetData, presetRandom } from "../../site/preset-random.js";
import { presetStateKey } from "../../site/header-presets.js";

export const PARAMETER_MODULATOR_DEFINITIONS = Object.freeze([
  { target: "tonguePosition", elementId: "tonguePosition", family: "tongue", rateHz: 1.7, depth: 0.42, shape: "sine" },
  { target: "tongueHeight", elementId: "tongueHeight", family: "tongue", rateHz: 3.1, depth: 0.48, shape: "triangle" },
  { target: "tongueShape", elementId: "tongueShape", family: "tongue", rateHz: 0.73, depth: 0.52, shape: "sine" },
  { target: "tongueTip", elementId: "tongueTip", family: "tongue", rateHz: 7.8, depth: 0.58, shape: "square" },
  { target: "tongueExtension", elementId: "tongueExtension", family: "tongue", rateHz: 1.2, depth: 0.68, shape: "triangle" },
  { target: "tongueCurl", elementId: "tongueCurl", family: "tongue", rateHz: 4.3, depth: 0.62, shape: "sine" },
  { target: "tongueLateral", elementId: "tongueLateral", family: "tongue", rateHz: 2.4, depth: 0.54, shape: "square" },
  { target: "pressure", elementId: "pressure", family: "host", rateHz: 0.82, depth: 0.5, shape: "triangle" },
  { target: "tension", elementId: "tension", family: "host", rateHz: 5.4, depth: 0.34, shape: "sine" },
  { target: "adduction", elementId: "adduction", family: "host", rateHz: 2.6, depth: 0.48, shape: "square" },
  { target: "sourceScale", elementId: "sourceScale", family: "host", rateHz: 0.17, depth: 0.6, shape: "triangle" },
  { target: "tractLengthM", elementId: "tractLength", family: "host", rateHz: 0.13, depth: 0.46, shape: "sine" },
  { target: "mouthOpening", elementId: "mouthOpening", family: "host", rateHz: 3.7, depth: 0.72, shape: "square" },
  { target: "cavityCoupling", elementId: "cavityCoupling", family: "host", rateHz: 0.47, depth: 0.62, shape: "sine" },
  { target: "asymmetry", elementId: "asymmetry", family: "host", rateHz: 1.33, depth: 0.7, shape: "sample-hold" },
  { target: "sourceBalance", elementId: "sourceBalance", family: "host", rateHz: 0.29, depth: 0.82, shape: "triangle" },
  { target: "roughness", elementId: "roughness", family: "host", rateHz: 8.6, depth: 0.66, shape: "sample-hold" },
  { target: "gestureRate", elementId: "gestureRate", family: "host", rateHz: 0.21, depth: 0.58, shape: "triangle" },
  { target: "loopGapMs", elementId: "loopGap", family: "host", rateHz: 0.08, depth: 0.82, shape: "sample-hold" },
]);

const SHAPES = Object.freeze(["sine", "triangle", "square", "sample-hold"]);
const HOST_KEYS = Object.freeze(Object.keys(CONTROL_LIMITS).filter(key => key !== "level"));
const TONGUE_KEYS = Object.freeze(Object.keys(TONGUE_PARAMETER_LIMITS));
const WIGGLE_RATE_MAX = Object.freeze(PARAMETER_MODULATOR_DEFINITIONS.map(item => item.family === "host" ? 20 : 30));
const LFO_COUNT = 3;
const LFO_RATE_MAX = 12;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const ANIMAL_IDS = Object.freeze(Object.keys(ANIMALS));
const MOTION_IDS = Object.freeze(Object.keys(TONGUE_MOTION_PRESETS));

// Output level, Loop and live activity belong to the performer, not to a scene.
export function captureVoiceHostState(state) {
  const { active, level, loop, ...settings } = state;
  return settings;
}

export function applyVoiceHostState(hostState, liveState) {
  return sanitizeSyrinxState({ ...hostState, active: liveState.active, level: liveState.level, loop: liveState.loop });
}

function validateHost(host) {
  presetStateKey(host);
  const canonical = captureVoiceHostState(sanitizeSyrinxState(host));
  if (presetStateKey(canonical) !== presetStateKey(host)) throw new TypeError("Invalid host voice state");
}

function validateTongue(tongue) {
  if (presetStateKey(sanitizeTongueState(tongue)) !== presetStateKey(tongue)) throw new TypeError("Invalid tongue state");
}

const captureLfo = ({ enabled, target, shape, rateHz, depth, phase }) => ({ enabled: Boolean(enabled), target, shape, rateHz, depth, phase });
const captureWiggle = ({ enabled, shape, rateHz, depth, phase }) => ({ enabled: Boolean(enabled), shape, rateHz, depth, phase });

export function captureSyrinxPreset(state, modulators) {
  return clonePresetData({ state: captureVoiceHostState(state), modulators: modulators.map(captureLfo) });
}

export function validateSyrinxPreset(snapshot) {
  presetStateKey(snapshot);
  validateHost(snapshot?.state);
  const lfos = snapshot.modulators;
  if (!Array.isArray(lfos) || lfos.length !== LFO_COUNT || lfos.some(m => typeof m.enabled !== "boolean"
    || !MODULATION_TARGETS.includes(m.target) || !SHAPES.includes(m.shape)
    || !(m.rateHz >= 0.02 && m.rateHz <= LFO_RATE_MAX) || !(m.depth >= 0 && m.depth <= 1)
    || !(m.phase >= 0 && m.phase <= 1)
    || presetStateKey(captureLfo(m)) !== presetStateKey(m))) throw new TypeError("Invalid Syrinx modulators");
  return snapshot;
}

export function captureTonguedBeastsPreset(state, tongue, motionId, parameterModulators) {
  return clonePresetData({
    state: captureVoiceHostState(state), tongue, motion: motionId,
    wiggles: parameterModulators.map(captureWiggle),
  });
}

export function validateTonguedBeastsPreset(snapshot) {
  presetStateKey(snapshot);
  validateHost(snapshot?.state);
  validateTongue(snapshot.tongue);
  const { motion, wiggles } = snapshot;
  if (motion !== "" && !MOTION_IDS.includes(motion)) throw new TypeError("Unknown tongue motion");
  if (motion !== "" && !snapshot.tongue.tongueEnabled) throw new TypeError("Tongue motion needs the tongue in circuit");
  if (!Array.isArray(wiggles) || wiggles.length !== PARAMETER_MODULATOR_DEFINITIONS.length
    || wiggles.some((m, i) => typeof m.enabled !== "boolean" || !SHAPES.includes(m.shape)
      || !(m.rateHz >= 0.02 && m.rateHz <= WIGGLE_RATE_MAX[i]) || !(m.depth >= 0 && m.depth <= 1)
      || !(m.phase >= 0 && m.phase <= 1) || presetStateKey(captureWiggle(m)) !== presetStateKey(m))) {
    throw new TypeError("Invalid Tongued Beasts wiggles");
  }
  return snapshot;
}

const hostFor = (animalId, callIndex, overrides = {}) => {
  const animal = ANIMALS[animalId];
  const callId = animal.callIds[Math.min(callIndex, animal.callIds.length - 1)];
  return captureVoiceHostState(animalState(animalId, { biologicalLock: false, loopGapMs: 1_000, callId, ...overrides }));
};

const lfoDefaults = () => [
  { enabled: false, target: "tension", shape: "sine", rateHz: 5.4, depth: 0.12, phase: 0 },
  { enabled: false, target: "pressure", shape: "triangle", rateHz: 0.25, depth: 0.18, phase: 0.17 },
  { enabled: false, target: "mouthOpening", shape: "sine", rateHz: 0.4, depth: 0.16, phase: 0.41 },
];

const syrinxScene = (id, label, animalId, callIndex, host = {}, lfos = []) => {
  const modulators = lfoDefaults().map((base, i) => lfos[i] ? { ...base, enabled: true, ...lfos[i] } : base);
  const snapshot = captureSyrinxPreset(hostFor(animalId, callIndex, host), modulators);
  validateSyrinxPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const SYRINX_FULL_PRESETS = Object.freeze([
  syrinxScene("raven-croak", "Raven · Dark croak", "raven", 0),
  syrinxScene("wolf-drift", "Wolf · Drifting howl", "wolf", 0, { gestureRate: 0.8, loopGapMs: 1_800 }, [
    { target: "tension", shape: "sine", rateHz: 0.09, depth: 0.2 }, { target: "pressure", shape: "triangle", rateHz: 0.09, depth: 0.14 },
    { target: "mouthOpening", shape: "sine", rateHz: 0.13, depth: 0.12, phase: 0.41 },
  ]),
  syrinxScene("songbird-flurry", "Songbird · Bright flurry", "songbird", 1, { gestureRate: 1.9, loopGapMs: 90, roughness: 0.04 }),
  syrinxScene("dove-hollow", "Dove · Hollow coo", "dove", 0, { gestureRate: 0.6, loopGapMs: 2_400, cavityCoupling: 0.74 }, [
    { target: "tension", shape: "sine", rateHz: 4.6, depth: 0.05 },
  ]),
  syrinxScene("elephant-subsonic", "Elephant · Slow rumble", "elephant", 0, { gestureRate: 0.45, tractLengthM: 0.82, roughness: 0.5 }, [
    { target: "pressure", shape: "triangle", rateHz: 0.31, depth: 0.28 },
  ]),
  syrinxScene("bullfrog-pond", "Bullfrog · Pond throb", "bullfrog", 0, { cavityCoupling: 0.95, gestureRate: 1.2 }, [
    { target: "mouthOpening", shape: "square", rateHz: 3.2, depth: 0.35 },
  ]),
  syrinxScene("cat-purr", "Cat · Idling purr", "cat", 1, { gestureRate: 1.4, loopGapMs: 0 }, [
    { target: "pressure", shape: "square", rateHz: 7.5, depth: 0.22 },
  ]),
  syrinxScene("hyena-giggle", "Hyena · Frantic giggle", "hyena", 1, { gestureRate: 1.9, asymmetry: 0.7, loopGapMs: 150 }),
  syrinxScene("lion-grit", "Lion · Gravel roar", "lion", 0, { roughness: 0.93, pressure: 0.95, gestureRate: 0.7 }, [
    { target: "roughness", shape: "sample-hold", rateHz: 6.2, depth: 0.3 },
  ]),
  syrinxScene("mouse-glass", "Mouse · Glass sweep", "mouse", 0, { gestureRate: 1.6, tension: 0.9, loopGapMs: 400 }),
  syrinxScene("horse-vibrato", "Horse · Wavering whinny", "horse", 0, { gestureRate: 1.1, loopGapMs: 1_400 }, [
    { target: "tension", shape: "sine", rateHz: 5.6, depth: 0.1 }, { target: "tractLengthM", shape: "triangle", rateHz: 0.22, depth: 0.12 },
  ]),
  syrinxScene("owl-lullaby", "Owl · Night double hoot", "owl", 1, { gestureRate: 0.5, loopGapMs: 3_200, mouthOpening: 0.3 }),
  syrinxScene("treefrog-chorus", "Tree frog · Chirp chorus", "treefrog", 1, { gestureRate: 2.2, loopGapMs: 120 }, [
    { target: "gestureRate", shape: "sample-hold", rateHz: 1.4, depth: 0.25 },
  ]),
  syrinxScene("alligator-swamp", "Alligator · Swamp bellow", "alligator", 0, { gestureRate: 0.55, tractLengthM: 0.65, cavityCoupling: 0.7 }, [
    { target: "adduction", shape: "triangle", rateHz: 0.4, depth: 0.2 },
  ]),
]);

const defaultWiggles = () => PARAMETER_MODULATOR_DEFINITIONS.map((definition, index) => ({
  enabled: false, shape: definition.shape, rateHz: definition.rateHz, depth: definition.depth, phase: (index * 0.173) % 1,
}));

const feralWiggles = ({ rateBase, rateSpread, depth, shapes }) => PARAMETER_MODULATOR_DEFINITIONS.map((definition, index) => ({
  enabled: true, shape: shapes[index % shapes.length],
  rateHz: clamp(rateBase + (index % 7) * rateSpread, 0.02, definition.family === "host" ? 20 : 30),
  depth: clamp(depth - (index % 4) * 0.055), phase: (index * 0.137) % 1,
}));

const wiggleOverrides = (overrides = {}) => PARAMETER_MODULATOR_DEFINITIONS.map((definition, index) => {
  const override = overrides[definition.target];
  return override ? { ...defaultWiggles()[index], enabled: true, ...override } : defaultWiggles()[index];
});

const beastScene = (id, label, animalId, callIndex, host, tongue, motion = "", wiggles = {}) => {
  const tongueState = sanitizeTongueState({ ...DEFAULT_TONGUE_STATE, tongueEnabled: Boolean(motion) || tongue.tongueEnabled !== false, ...tongue });
  const snapshot = captureTonguedBeastsPreset(
    hostFor(animalId, callIndex, host), tongueState, motion,
    Array.isArray(wiggles) ? wiggles : wiggleOverrides(wiggles),
  );
  validateTonguedBeastsPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

const feralScene = preset => {
  const animal = preset.id === "inside-out" ? "elephant" : preset.id === "panic-goblin" ? "mouse" : preset.id === "rubber-opera" ? "cow" : "hyena";
  return beastScene(`feral-${preset.id}`, `Feral · ${preset.label}`, animal, 0, preset.host, preset.tongue, preset.motion, feralWiggles(preset.modulation));
};

export const TONGUED_BEASTS_FULL_PRESETS = Object.freeze([
  ...Object.values(FERAL_TONGUE_PRESETS).map(feralScene),
  beastScene("raven-chatter", "Raven · Beak chatter", "raven", 1, { gestureRate: 1.4, loopGapMs: 200 }, { tongueAnatomy: "avian", tongueHeight: 0.4 }, "wiggle"),
  beastScene("wolf-rolled-howl", "Wolf · Rolled howl", "wolf", 0, { gestureRate: 0.8, loopGapMs: 1_500 }, { tongueAnatomy: "canine", tongueExtension: 0.35 }, "rolled-r", {
    tension: { rateHz: 0.2, depth: 0.2 },
  }),
  beastScene("dog-wet-bark", "Dog · Wet bark", "dog", 0, { roughness: 0.55, gestureRate: 1.3 }, { tongueAnatomy: "canine", tongueExtension: 0.7, tongueCurl: 0.3 }, "lick"),
  beastScene("songbird-tongue-trill", "Songbird · Tongue trill", "songbird", 1, { gestureRate: 1.9, loopGapMs: 100 }, { tongueAnatomy: "avian" }, "la-la", {
    tongueTip: { rateHz: 9, depth: 0.5 },
  }),
  beastScene("elephant-lip-rumble", "Elephant · Lip rumble", "elephant", 0, { gestureRate: 0.5, tractLengthM: 0.8 }, { tongueAnatomy: "human", tongueHeight: 0.3 }, "b", {
    pressure: { rateHz: 0.35, depth: 0.3 },
  }),
  beastScene("cow-sucking-moo", "Cow · Sucking moo", "cow", 0, { gestureRate: 0.7, loopGapMs: 1_800 }, { tongueAnatomy: "macaque", tongueHeight: 0.8 }, "suck"),
  beastScene("bullfrog-tongue-gate", "Bullfrog · Tongue gate", "bullfrog", 0, { cavityCoupling: 0.9 }, { tongueAnatomy: "human", tongueHeight: 0.7 }, "p", {
    mouthOpening: { shape: "square", rateHz: 2.5, depth: 0.4 },
  }),
  beastScene("hyena-gyration", "Hyena · Gyrating giggle", "hyena", 1, { gestureRate: 1.8, asymmetry: 0.7 }, { tongueAnatomy: "human", tongueLateral: 0.6 }, "gyrate", {
    tongueLateral: { rateHz: 3.4, depth: 0.5 }, asymmetry: { rateHz: 1.1, depth: 0.5 },
  }),
  beastScene("cat-purring-l", "Cat · Purring L", "cat", 1, { gestureRate: 1.4, loopGapMs: 0 }, { tongueAnatomy: "canine", tongueTip: 0.9, tongueLateral: 0.5 }, "l"),
  beastScene("mouse-slow-lick", "Mouse · Slow lick", "mouse", 0, { gestureRate: 0.6, loopGapMs: 900 }, { tongueAnatomy: "macaque", tongueExtension: 0.8 }, "lick"),
  beastScene("dove-free-tongue", "Dove · Bypassed tongue", "dove", 0, { gestureRate: 0.6, loopGapMs: 2_200 }, { tongueEnabled: false }),
  beastScene("lion-resonant-pose", "Lion · Resonant pose", "lion", 0, { roughness: 0.8, gestureRate: 0.65 }, { tongueAnatomy: "canine", tonguePosition: 0.2, tongueHeight: 0.2, tongueShape: 0.8 }, "", {
    roughness: { rateHz: 5.5, depth: 0.3 }, cavityCoupling: { rateHz: 0.3, depth: 0.5 },
  }),
]);

function randomHost(rng) {
  const animal = ANIMALS[rng.pick(ANIMAL_IDS)];
  const biologicalLock = rng.pick([true, false]);
  const values = {};
  for (const name of HOST_KEYS) {
    const [min, max] = biologicalLock ? animal.bounds[name] ?? CONTROL_LIMITS[name] : CONTROL_LIMITS[name];
    const unit = 0.04 + rng.unit() * 0.92;
    values[name] = name === "tractLengthM" ? Math.exp(Math.log(min) + unit * Math.log(max / min)) : min + unit * (max - min);
  }
  values.gestureRate = rng.between(0.4, 2.2);
  values.loopGapMs = rng.pick([0, rng.between(60, 3_000)]);
  return captureVoiceHostState(sanitizeSyrinxState({
    ...values, animalId: animal.id, callId: rng.pick(animal.callIds), biologicalLock,
  }));
}

export function randomizeSyrinxPreset(current, random = Math.random) {
  validateSyrinxPreset(current);
  const rng = presetRandom(random);
  const state = randomHost(rng);
  const modulators = Array.from({ length: LFO_COUNT }, () => ({
    enabled: rng.unit() > 0.4, target: rng.pick(MODULATION_TARGETS), shape: rng.pick(SHAPES),
    rateHz: 0.05 + rng.unit() ** 2 * (LFO_RATE_MAX - 0.05), depth: rng.between(0.03, 0.6), phase: rng.unit(),
  }));
  return validateSyrinxPreset(clonePresetData({ state, modulators }));
}

export function randomizeTonguedBeastsPreset(current, random = Math.random) {
  validateTonguedBeastsPreset(current);
  const rng = presetRandom(random);
  const state = randomHost(rng);
  const motion = rng.pick(["", ...MOTION_IDS]);
  const tongue = sanitizeTongueState({
    ...Object.fromEntries(TONGUE_KEYS.map(key => [key, rng.unit()])),
    tongueAnatomy: rng.pick(Object.keys(TONGUE_ANATOMIES)),
    tongueEnabled: motion !== "" || rng.unit() > 0.2,
  });
  const wiggles = PARAMETER_MODULATOR_DEFINITIONS.map((_, index) => ({
    enabled: rng.unit() > 0.55, shape: rng.pick(SHAPES),
    rateHz: 0.02 + rng.unit() ** 2 * (WIGGLE_RATE_MAX[index] - 0.02), depth: rng.between(0.15, 1), phase: rng.unit(),
  }));
  return validateTonguedBeastsPreset(clonePresetData({ state, tongue, motion, wiggles }));
}
