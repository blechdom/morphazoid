import { ANIMALS, CALL_GESTURES, CONTROL_LIMITS, MODULATION_TARGETS, animalState, sanitizeSyrinxState } from "../../syrinx.js";
import { DEFAULT_TONGUE_STATE, TONGUE_ANATOMIES, sanitizeTongueState } from "../../tongue-physics.js";
import { TONGUE_PARAMETER_LIMITS, TONGUE_MOTION_PRESETS } from "../../tongue-performance.js";
import { normalizeHybrinxPresetGesture } from "../../hybrinx-timeline.js";
import { clonePresetData, presetRandom, randomParameterValues } from "../../site/preset-random.js";
import { presetStateKey } from "../../site/header-presets.js";

const withoutActive = state => { const { active, ...settings } = state; return settings; };
const motions = ["sine", "triangle", "square", "sample-hold"];
function scene(id, label, animalId, callIndex, host, tongue, motion = "", durationScale = 1, modulation = {}) {
  const animal = ANIMALS[animalId], callId = animal.callIds[Math.min(callIndex, animal.callIds.length - 1)];
  const native = CALL_GESTURES[callId];
  const gesture = normalizeHybrinxPresetGesture({
    ...native, durationMs: native.durationMs * durationScale,
    tonguePatterns: motion ? [{ id: "scene-tongue", presetId: motion, startPhase: 0.2, endPhase: 0.85 }] : [],
    modulations: modulation,
  });
  const snapshot = {
    state: withoutActive(animalState(animalId, { biologicalLock: false, loop: true, loopGapMs: 160, level: 0.44, callId, ...host })),
    tongue: sanitizeTongueState({ ...DEFAULT_TONGUE_STATE, ...tongue }),
    gesture,
    modulators: [
      { enabled: false, target: "tension", shape: "sine", rateHz: 5.4, depth: 0.12, phase: 0 },
      { enabled: false, target: "pressure", shape: "triangle", rateHz: 0.25, depth: 0.18, phase: 0.17 },
      { enabled: false, target: "mouthOpening", shape: "sine", rateHz: 0.4, depth: 0.16, phase: 0.41 },
    ],
  };
  validateHybrinxFullPreset(snapshot);
  return { id, label, description: `${animal.label} host, ${native.label.toLowerCase()} contour, complete tongue and editable timeline. Audio and the call player remain under your control.`, snapshot };
}
export const HYBRINX_FULL_PRESETS = Object.freeze([
  scene("first-croak", "Raven · First croak", "raven", 0, {}, {}),
  scene("velvet-coo", "Dove · Velvet coo", "dove", 0, { roughness: 0.02, gestureRate: 0.65, loopGapMs: 520 }, { tongueAnatomy: "avian", tongueHeight: 0.35 }, "", 1.3),
  scene("rolling-wolf", "Wolf · Rolling howl", "wolf", 0, { gestureRate: 0.8, roughness: 0.24 }, { tongueAnatomy: "canine" }, "rolled-r", 1.2),
  scene("tiny-trill", "Songbird · Tiny trill", "songbird", 1, { gestureRate: 1.8, loopGapMs: 80, level: 0.35 }, { tongueAnatomy: "avian" }, "wiggle", 0.7),
  scene("frog-gate", "Bullfrog · Rubber gate", "bullfrog", 0, { pressure: 0.7, gestureRate: 1.2 }, { tongueHeight: 0.72, tongueCurl: 0.8 }, "b"),
  scene("mouse-morse", "Mouse · Tongue telegram", "mouse", 0, { gestureRate: 1.5, loopGapMs: 250, level: 0.35 }, { tongueAnatomy: "macaque" }, "p", 0.8),
  scene("owl-lullaby", "Owl · Hollow lullaby", "owl", 0, { gestureRate: 0.55, loopGapMs: 900, cavityCoupling: 0.68 }, { tonguePosition: 0.28, tongueHeight: 0.22 }, "l", 1.5),
  scene("lion-raspberry", "Lion · Nasty raspberry", "lion", 0, { roughness: 0.7, pressure: 0.8, level: 0.34 }, { tongueAnatomy: "canine", tongueExtension: 0.6 }, "raspberry"),
  scene("cow-vowels", "Cow · Wandering vowels", "cow", 0, { gestureRate: 0.75, sourceBalance: 0.7, loopGapMs: 300 }, { tonguePosition: 0.55, tongueHeight: 0.45 }, "la-la", 1.4),
  scene("hyena-gyration", "Hyena · Elastic chatter", "hyena", 0, { gestureRate: 1.65, asymmetry: 0.65, level: 0.38 }, { tongueAnatomy: "human" }, "gyrate", 0.85),
  scene("raven-modulated", "Raven · Uneven rattle", "raven", 1, { gestureRate: 1.1, loopGapMs: 40 }, {}, "wiggle", 1, {
    tension: { enabled: true, shape: "triangle", phase: 0.2, speed: [[0, 1.5], [1, 7]], depth: [[0, 0.1], [0.55, 0.4], [1, 0.12]] },
  }),
  scene("elephant-whisper", "Elephant · Slow strange breath", "elephant", 1, { gestureRate: 0.5, sourceScale: 0.75, loopGapMs: 600, level: 0.34 }, { tongueEnabled: false }, "", 1.5),
]);
export function captureHybrinxPreset(state, tongue, gesture, modulators) {
  return clonePresetData({ state: withoutActive(state), tongue, gesture: normalizeHybrinxPresetGesture(gesture), modulators });
}
export function validateHybrinxFullPreset(s) {
  presetStateKey(s);
  if (presetStateKey(withoutActive(sanitizeSyrinxState(s.state))) !== presetStateKey(s.state)
    || presetStateKey(sanitizeTongueState(s.tongue)) !== presetStateKey(s.tongue)
    || s.gesture?.id !== s.state.callId
    || presetStateKey(normalizeHybrinxPresetGesture(s.gesture)) !== presetStateKey(s.gesture)) throw new TypeError("Invalid complete Hybrinx scene");
  if (s.modulators?.length !== 3 || s.modulators.some(m => typeof m.enabled !== "boolean" || !MODULATION_TARGETS.includes(m.target)
    || !motions.includes(m.shape) || !(m.rateHz >= 0 && m.rateHz <= 20) || !(m.depth >= 0 && m.depth <= 1) || !Number.isFinite(m.phase))) throw new TypeError("Invalid Hybrinx modulation");
  return s;
}
export function randomizeHybrinxPreset(current, random = Math.random) {
  const rng = presetRandom(random), animal = rng.pick(Object.values(ANIMALS));
  const callId = rng.pick(animal.callIds), native = CALL_GESTURES[callId];
  const state = withoutActive(sanitizeSyrinxState({
    ...randomParameterValues({ ...CONTROL_LIMITS, pressure: [0.3, 0.85], tractLengthM: [0.05, 0.5], roughness: [0, 0.7], gestureRate: [0.5, 2], loopGapMs: [0, 1000] }, rng),
    animalId: animal.id, callId, biologicalLock: rng.pick([true, false]), loop: rng.pick([true, false]), level: current.state.level,
  }));
  const tongue = sanitizeTongueState({ ...randomParameterValues(TONGUE_PARAMETER_LIMITS, rng),
    tongueEnabled: rng.pick([true, false]), tongueAnatomy: rng.pick(Object.keys(TONGUE_ANATOMIES)) });
  const tongueMotionId = rng.pick(["", ...Object.keys(TONGUE_MOTION_PRESETS)]);
  const curves = Object.fromEntries(Object.keys(native.curves).map(key => [key,
    [0, 0.25, 0.5, 0.75, 1].map((phase, i) => [phase, key === "pressure" ? (i === 0 || i === 4 ? 0 : rng.between(0.35, 1)) : rng.between(-0.3, 0.3)]),
  ]));
  const gesture = normalizeHybrinxPresetGesture({
    ...native, durationMs: rng.between(250, 3500), frequencyRatio: rng.between(0.5, 2), curves,
    modulations: Object.fromEntries(["tension", "mouthOpening"].map(key => [key, {
      enabled: rng.pick([true, false]), shape: rng.pick(motions), phase: rng.unit(),
      speed: [[0, rng.between(0.2, 8)], [1, rng.between(0.2, 8)]], depth: [[0, rng.between(0, 0.4)], [1, rng.between(0, 0.4)]],
    }])),
    tonguePatterns: tongueMotionId ? [{ id: "random-tongue", presetId: tongueMotionId, startPhase: rng.between(0, 0.3), endPhase: rng.between(0.6, 1) }] : [],
  });
  return validateHybrinxFullPreset({ state, tongue, gesture,
    modulators: Array.from({ length: 3 }, () => ({ enabled: rng.pick([true, false]), target: rng.pick(MODULATION_TARGETS),
      shape: rng.pick(motions), rateHz: rng.between(0.1, 8), depth: rng.between(0, 0.35), phase: rng.unit() })),
  });
}
