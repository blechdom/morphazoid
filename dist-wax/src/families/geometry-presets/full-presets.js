import { amplitudeEnvelopePreset, sanitizeAmplitudeEnvelope } from "../../audio.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom, randomParameterValues, clonePresetData } from "../../site/preset-random.js";
import { createSolidInitialState, createHyperInitialState } from "./initial-state.js";
export { createSolidInitialState, createHyperInitialState };

// The owner requested explicit playhead-only / shape-only scenes. Motion
// switches belong to presets; Audio and evolving positions remain live.
export const GEOMETRY_LIVE_KEYS = Object.freeze({
  solid: ["audio", "position", "continuousPosition", "rotationX", "rotationY", "rotationZ", "planeYaw", "planePitch"],
  hyper: ["audio", "position", "continuousPosition", "rotationXW", "rotationYW", "rotationZW"],
});
const initial = kind => kind === "solid" ? createSolidInitialState() : createHyperInitialState();
const keys = kind => Object.keys(initial(kind)).filter(key => !GEOMETRY_LIVE_KEYS[kind].includes(key));
const forms = {
  solid: ["cube", "pyramid", "octahedron", "prism", "cone", "cylinder", "sphere", "torus"],
  hyper: ["tesseract", "hypersphere", "hyperpyramid", "klein"],
};
const soundModes = ["sine", "fm", "pm", "percussion", "shepard"];
const commonRanges = {
  speed: [0.01, 4], level: [0, 1], baseFrequency: [20, 440], pitchRange: [0, 7],
  fmIndex: [0, 12], fmRatio: [0.25, 8], percussionAttack: [0.5, 30], percussionDecay: [15, 2000],
  profileSides: [1, 32], profileStarDepth: [0.05, 0.82],
};
function ranges(kind) {
  return {
    ...commonRanges,
    voiceLimit: [1, kind === "solid" ? 32 : 20],
    ...Object.fromEntries(keys(kind).filter(key => key.endsWith("Speed")).map(key => [key, [-0.5, 0.5]])),
    ...(kind === "solid" ? {
      formScaleX: [0.5, 1.6], formScaleY: [0.5, 1.6], formScaleZ: [0.5, 1.6],
      formSkewX: [-0.7, 0.7], formSkewZ: [-0.7, 0.7],
    } : Object.fromEntries(["X", "Y", "Z", "W"].map(axis => [`hyperScale${axis}`, [0.5, 1.5]]))),
  };
}
export function validateGeometryPreset(kind, snapshot) {
  if (!GEOMETRY_LIVE_KEYS[kind]) throw new TypeError("Unknown geometry preset kind");
  presetStateKey(snapshot);
  const p = snapshot.parameters;
  if (!p || Object.keys(p).length !== keys(kind).length || keys(kind).some(key => !Object.hasOwn(p, key))) throw new TypeError("Incomplete geometry parameters");
  for (const [key, [min, max]] of Object.entries(ranges(kind))) {
    if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new TypeError(`Invalid ${kind} ${key}`);
  }
  for (const key of keys(kind).filter(key => key === "playing" || key.endsWith("Playing"))) if (typeof p[key] !== "boolean") throw new TypeError(key);
  if (!Number.isInteger(p.profileSides) || !Number.isInteger(p.voiceLimit) || ![-1, 1].includes(p.direction)
    || !["polygon", "star"].includes(p.profileShapeType) || !soundModes.includes(p.soundMode)
    || ![...forms[kind], "profile"].includes(p[kind === "solid" ? "solidType" : "shapeType"])) throw new TypeError("Invalid geometry choices");
  const e = snapshot.envelope;
  if (!e || Object.keys(e).sort().join() !== "enabled,level,points,preset,swell"
    || typeof e.enabled !== "boolean" || typeof e.swell !== "boolean" || (!e.enabled && e.swell)
    || !["pluck", "note", "sustain", "pad", "custom"].includes(e.preset)
    || !(e.level >= 0 && e.level <= 1) || presetStateKey(sanitizeAmplitudeEnvelope(e.points)) !== presetStateKey(e.points)) throw new TypeError("Invalid geometry envelope");
  return snapshot;
}
export function captureGeometryPreset(kind, state, envelope) {
  return clonePresetData(validateGeometryPreset(kind, {
    parameters: Object.fromEntries(keys(kind).map(key => [key, state[key]])), envelope,
  }));
}
function scene(kind, id, label, description, overrides = {}, envelope = "sustain", envelopeOverrides = {}) {
  const settings = { ...initial(kind), playing: true, ...overrides };
  if (settings.soundMode === "shepard" && overrides.voiceLimit === undefined) settings.voiceLimit = 8;
  const axes = keys(kind).filter(key => key.endsWith("Playing") && settings[key]);
  const movement = settings.playing ? (axes.length ? "Playhead + rotation." : "Playhead only.") : "Shape only; fixed centered slice.";
  return Object.freeze({ id, label, description: `${description} ${movement} Audio stays under your control.`,
    snapshot: captureGeometryPreset(kind, settings, {
      enabled: true, swell: false, preset: envelope, level: 1,
      points: amplitudeEnvelopePreset(envelope), ...envelopeOverrides,
    }),
  });
}

const solidScenes = [
  scene("solid", "original-cube", "Cube · First study", "A faster plain sine scan with an open envelope so the first example is immediately legible.",
    { speed: 0.45, pitchRange: 2.5, level: 0.5 }, "sustain", { enabled: false }),
  scene("solid", "pyramid-velvet", "Pyramid · Velvet incline", "Slow reverse slice, broad soft FM and a turning Y axis.",
    { solidType: "pyramid", speed: 0.08, direction: -1, rotationYPlaying: true, rotationYSpeed: -0.035, soundMode: "fm", fmIndex: 0.6, fmRatio: 1, baseFrequency: 98, pitchRange: 2, level: 0.48 }, "pad"),
  scene("solid", "octahedron-chimes", "Octahedron · Glass hinges", "PM follows narrow bright intersections in a stretched octahedron.",
    { solidType: "octahedron", formScaleY: 1.45, formScaleX: 0.7, soundMode: "pm", fmIndex: 2.4, fmRatio: 3, baseFrequency: 147, pitchRange: 2.5, speed: 0.5, level: 0.45 }, "sustain", { enabled: false }),
  scene("solid", "prism-knocks", "Prism · Unequal knocks", "Dry vertex strikes with skewed proportions and a slowly yawing plane.",
    { solidType: "prism", soundMode: "percussion", speed: 0.36, formSkewX: 0.35, formScaleZ: 1.4, planeYawPlaying: true, planeYawSpeed: -0.03, baseFrequency: 65, pitchRange: 2.5, percussionAttack: 12, percussionDecay: 160, level: 0.45 }),
  scene("solid", "cone-reed", "Cone · Turning reed", "A narrow tilted cone with shallow FM and reversed X rotation.",
    { solidType: "cone", formScaleX: 0.65, formScaleZ: 0.7, formScaleY: 1.5, rotationXPlaying: true, rotationXSpeed: -0.08, soundMode: "fm", fmIndex: 1.7, fmRatio: 0.5, speed: 0.19, baseFrequency: 82, pitchRange: 3, level: 0.46 }, "note"),
  scene("solid", "cylinder-wash", "Cylinder · Long wash", "A wide cylinder, quiet sine intersections and a long spatial envelope.",
    { solidType: "cylinder", formScaleX: 1.5, formScaleY: 0.6, soundMode: "sine", speed: 0.055, pitchRange: 1.5, baseFrequency: 130, planePitchPlaying: true, planePitchSpeed: 0.02, level: 0.43 }, "pad", { swell: true }),
  scene("solid", "sphere-shepard", "Sphere · Endless meridian", "A faster fixed-sphere scan through eight Shepard voices, without rotation or a closing envelope.",
    { solidType: "sphere", formScaleY: 1.2, formScaleZ: 0.8, soundMode: "shepard", speed: 0.4, direction: -1, baseFrequency: 82, pitchRange: 2.5, voiceLimit: 8, level: 0.42 }, "sustain", { enabled: false }),
  scene("solid", "torus-beating", "Torus · Cross-current", "Opposite-axis motion, a skewed torus and near-harmonic phase modulation.",
    { solidType: "torus", formSkewZ: -0.4, soundMode: "pm", fmIndex: 2.3, fmRatio: 1.03, speed: 0.17, rotationXPlaying: true, rotationZPlaying: true, rotationXSpeed: 0.04, rotationZSpeed: -0.065, level: 0.4 }, "sustain"),
  scene("solid", "cube-corner-club", "Cube · Corner club", "A faster, flattened cube used as a low-register percussion instrument.",
    { soundMode: "percussion", speed: 0.68, baseFrequency: 55, pitchRange: 1.7, formScaleY: 0.55, formSkewX: -0.35, percussionAttack: 10, percussionDecay: 95, level: 0.42 }),
  scene("solid", "prism-brass", "Prism · Brass fan", "Bright harmonic FM with two counter-moving orientation controls.",
    { solidType: "prism", soundMode: "fm", fmIndex: 4.8, fmRatio: 2, speed: 0.32, rotationYPlaying: true, planeYawPlaying: true, rotationYSpeed: -0.06, planeYawSpeed: 0.045, baseFrequency: 73, pitchRange: 3.5, level: 0.4 }, "note"),
  scene("solid", "crooked-octahedron", "Octahedron · Crooked metal", "Inharmonic FM on a heavily skewed body; deliberately rough but level-bounded.",
    { solidType: "octahedron", soundMode: "fm", fmIndex: 6.5, fmRatio: 0.7, formSkewX: 0.6, formSkewZ: -0.55, speed: 0.43, rotationXPlaying: true, rotationXSpeed: -0.12, baseFrequency: 55, pitchRange: 4, level: 0.34 }, "pluck"),
  scene("solid", "torus-whisper", "Torus · Hollow whisper", "Slow reverse travel, low PM depth and independently drifting plane angles.",
    { solidType: "torus", soundMode: "pm", fmIndex: 0.45, fmRatio: 1.5, speed: 0.045, direction: -1, planeYawPlaying: true, planePitchPlaying: true, planeYawSpeed: -0.025, planePitchSpeed: 0.015, baseFrequency: 165, pitchRange: 1.25, level: 0.43 }, "pad"),
  scene("solid", "plane-cube-fast", "Playhead only · Quick cube", "A single fast scan through an unmoving cube.",
    { speed: 0.75, soundMode: "sine", baseFrequency: 98, pitchRange: 2.7, level: 0.46 }, "note"),
  scene("solid", "shape-cube-orbit", "Shape only · Cube orbit", "Only the Y rotation moves; a fixed central plane reads gentle FM.",
    { playing: false, rotationYPlaying: true, rotationYSpeed: -0.2, soundMode: "fm", fmIndex: 1.2, fmRatio: 1, baseFrequency: 110, pitchRange: 2.5, level: 0.44 }, "sustain", { enabled: false }),
  scene("solid", "plane-prism-skip", "Playhead only · Prism skips", "Fast vertex strikes; no shape or plane-angle rotation.",
    { solidType: "prism", speed: 0.85, soundMode: "percussion", baseFrequency: 65, pitchRange: 2.2, percussionAttack: 10, percussionDecay: 130, level: 0.43 }),
  scene("solid", "shape-pyramid-turn", "Shape only · Pyramid turn", "One X-axis rotation carries a PM pyramid through a stationary slice.",
    { solidType: "pyramid", playing: false, rotationXPlaying: true, rotationXSpeed: 0.18, soundMode: "pm", fmIndex: 1.4, fmRatio: 1.5, baseFrequency: 98, pitchRange: 2.5, level: 0.44 }, "sustain", { enabled: false }),
  scene("solid", "plane-octa-chase", "Playhead only · Octahedron chase", "A brisk FM scan makes the eight-sided structure easy to hear.",
    { solidType: "octahedron", speed: 0.65, soundMode: "fm", fmIndex: 0.9, fmRatio: 2, baseFrequency: 130, pitchRange: 2.2, level: 0.42 }, "note"),
  scene("solid", "shape-torus-sweep", "Shape only · Torus sweep", "A single reverse Z rotation; no moving scan or changing plane angles.",
    { solidType: "torus", playing: false, rotationZPlaying: true, rotationZSpeed: -0.22, soundMode: "fm", fmIndex: 2.4, fmRatio: 0.5, baseFrequency: 82, pitchRange: 2.5, level: 0.4 }, "sustain", { enabled: false }),
  scene("solid", "plane-cylinder-beat", "Playhead only · Cylinder beat", "A fast fixed-cylinder percussion study.",
    { solidType: "cylinder", speed: 0.9, soundMode: "percussion", baseFrequency: 73, pitchRange: 2.3, percussionAttack: 12, percussionDecay: 110, level: 0.38 }),
  scene("solid", "shape-prism-turn", "Shape only · Prism carousel", "Only the triangular prism rotates, with the reading plane centered.",
    { solidType: "prism", playing: false, rotationYPlaying: true, rotationYSpeed: 0.25, soundMode: "sine", baseFrequency: 146, pitchRange: 2.2, level: 0.44 }, "sustain", { enabled: false }),
];

const hyperScenes = [
  scene("hyper", "original-tesseract", "Tesseract · First study", "A faster, clear sine scan through the stationary 4D cube.",
    { speed: 0.45, pitchRange: 2.8, level: 0.46 }, "sustain", { enabled: false }),
  scene("hyper", "slow-hypersphere", "Hypersphere · Slow breathing", "A stretched fourth axis and two slow opposed rotation planes.",
    { shapeType: "hypersphere", hyperScaleW: 1.45, hyperScaleY: 0.7, speed: 0.055, rotationXWPlaying: true, rotationYWPlaying: true, rotationXWSpeed: -0.035, rotationYWSpeed: 0.025, baseFrequency: 110, pitchRange: 1.5, level: 0.42 }, "pad"),
  scene("hyper", "pyramid-knocks", "Hyperpyramid · Low knocks", "Sparse vertex percussion with a longer fourth dimension.",
    { shapeType: "hyperpyramid", soundMode: "percussion", hyperScaleW: 1.4, speed: 0.27, direction: -1, baseFrequency: 55, pitchRange: 2, percussionAttack: 12, percussionDecay: 180, level: 0.44 }),
  scene("hyper", "klein-reed", "Klein bottle · Folded reed", "Soft harmonic FM travelling briskly through a stationary 4D embedding.",
    { shapeType: "klein", soundMode: "fm", fmIndex: 1.1, fmRatio: 1, speed: 0.38, baseFrequency: 98, pitchRange: 2, level: 0.4 }, "sustain"),
  scene("hyper", "glass-tesseract", "Tesseract · Glass seams", "Bright PM with unlike dimensions and counter-turning XW/YW planes.",
    { soundMode: "pm", fmIndex: 3.8, fmRatio: 3, hyperScaleX: 0.6, hyperScaleZ: 1.4, speed: 0.24, rotationXWPlaying: true, rotationYWPlaying: true, rotationXWSpeed: 0.075, rotationYWSpeed: -0.045, baseFrequency: 147, pitchRange: 2.5, level: 0.42 }, "pluck"),
  scene("hyper", "endless-hypersphere", "Hypersphere · Inside-out ascent", "Shepard traversal through a compressed W dimension.",
    { shapeType: "hypersphere", soundMode: "shepard", hyperScaleW: 0.8, speed: 0.42, baseFrequency: 82, pitchRange: 2.5, voiceLimit: 8, level: 0.4 }, "sustain", { enabled: false }),
  scene("hyper", "pyramid-brass", "Hyperpyramid · Brass folds", "Stronger harmonic FM, reversed travel and unequal X/Z stretches.",
    { shapeType: "hyperpyramid", soundMode: "fm", fmIndex: 4, fmRatio: 2, hyperScaleX: 1.45, hyperScaleZ: 0.65, speed: 0.36, direction: -1, baseFrequency: 65, pitchRange: 3, level: 0.42 }, "note"),
  scene("hyper", "klein-lantern", "Klein bottle · Phase lantern", "Subtle inharmonic PM and three differently paced rotation planes.",
    { shapeType: "klein", soundMode: "pm", fmIndex: 1.6, fmRatio: 1.07, rotationXWPlaying: true, rotationYWPlaying: true, rotationZWPlaying: true, rotationXWSpeed: -0.03, rotationYWSpeed: 0.04, rotationZWSpeed: -0.025, speed: 0.09, baseFrequency: 130, pitchRange: 2, level: 0.38 }, "sustain"),
  scene("hyper", "tesseract-sprint", "Tesseract · Corner sprint", "Fast low percussion from a flattened fourth-axis cube.",
    { soundMode: "percussion", speed: 0.58, hyperScaleW: 0.65, hyperScaleY: 1.35, rotationYWPlaying: true, rotationYWSpeed: -0.07, baseFrequency: 65, pitchRange: 2.4, percussionAttack: 10, percussionDecay: 100, level: 0.4 }),
  scene("hyper", "velvet-tesseract", "Tesseract · Velvet pulse", "A fast moving plane and shaped sine envelope instead of the slow sustained drift.",
    { soundMode: "sine", speed: 0.68, hyperScaleX: 1.4, baseFrequency: 73, pitchRange: 2.5, level: 0.44 }, "note"),
  scene("hyper", "feral-klein", "Klein bottle · Feral lattice", "Wide FM motion in a strongly stretched embedding; deliberately abrasive.",
    { shapeType: "klein", soundMode: "fm", fmIndex: 6, fmRatio: 0.65, hyperScaleX: 1.5, hyperScaleY: 0.55, hyperScaleW: 1.35, speed: 0.4, rotationZWPlaying: true, rotationZWSpeed: -0.14, baseFrequency: 55, pitchRange: 4, level: 0.3 }, "pluck"),
  scene("hyper", "pyramid-inversion", "Hyperpyramid · Backward veil", "Reverse Shepard travel, long envelope and a quiet opposing XW turn.",
    { shapeType: "hyperpyramid", soundMode: "shepard", direction: -1, speed: 0.08, rotationXWPlaying: true, rotationXWSpeed: 0.025, baseFrequency: 110, pitchRange: 2, level: 0.4 }, "pad", { swell: true }),
  scene("hyper", "plane-tesseract-fast", "Playhead only · Quick tesseract", "A fast FM slice with the form held still.",
    { speed: 0.8, soundMode: "fm", fmIndex: 1.2, fmRatio: 1.5, baseFrequency: 98, pitchRange: 2.5, level: 0.42 }, "note"),
  scene("hyper", "shape-tesseract-spin", "Shape only · XW spinner", "Only the XW plane rotates; the reading slice stays centered.",
    { playing: false, rotationXWPlaying: true, rotationXWSpeed: 0.24, soundMode: "pm", fmIndex: 1.2, fmRatio: 2, baseFrequency: 110, pitchRange: 2.5, level: 0.42 }, "sustain", { enabled: false }),
  scene("hyper", "plane-pyramid-ticks", "Playhead only · Pyramid ticks", "Fast four-dimensional corner percussion, with no rotation.",
    { shapeType: "hyperpyramid", speed: 0.75, soundMode: "percussion", baseFrequency: 65, pitchRange: 2.5, percussionAttack: 12, percussionDecay: 125, level: 0.4 }),
  scene("hyper", "shape-klein-roll", "Shape only · Klein roll", "One reverse ZW turn in a stationary central slice.",
    { shapeType: "klein", playing: false, rotationZWPlaying: true, rotationZWSpeed: -0.17, soundMode: "fm", fmIndex: 0.9, fmRatio: 1, baseFrequency: 98, pitchRange: 2.5, voiceLimit: 12, level: 0.4 }, "sustain", { enabled: false }),
  scene("hyper", "plane-sphere-sweep", "Playhead only · Hypersphere sweep", "A quicker low-PM scan without spinning the hypersphere.",
    { shapeType: "hypersphere", speed: 0.6, soundMode: "pm", fmIndex: 1.1, fmRatio: 1.5, baseFrequency: 110, pitchRange: 2.3, voiceLimit: 12, level: 0.42 }, "sustain"),
  scene("hyper", "shape-pyramid-turn", "Shape only · YW pyramid", "A single YW rotation makes the 4D pyramid's mechanism legible.",
    { shapeType: "hyperpyramid", playing: false, rotationYWPlaying: true, rotationYWSpeed: 0.2, soundMode: "sine", baseFrequency: 130, pitchRange: 2.5, level: 0.44 }, "sustain", { enabled: false }),
  scene("hyper", "plane-klein-skip", "Playhead only · Klein skips", "Fast gentle FM travel through an unmoving Klein embedding.",
    { shapeType: "klein", speed: 0.85, soundMode: "fm", fmIndex: 0.6, fmRatio: 2, baseFrequency: 98, pitchRange: 2.8, voiceLimit: 12, level: 0.42 }, "note"),
  scene("hyper", "shape-sphere-turn", "Shape only · Hypersphere turn", "One reverse XW motion, quiet PM, and a centered fixed slice.",
    { shapeType: "hypersphere", playing: false, rotationXWPlaying: true, rotationXWSpeed: -0.16, soundMode: "pm", fmIndex: 0.7, fmRatio: 1.5, baseFrequency: 110, pitchRange: 2, voiceLimit: 12, level: 0.4 }, "sustain", { enabled: false }),
];

function ordered(scenes, ids) {
  const byId = new Map(scenes.map(p => [p.id, p]));
  if (ids.length !== byId.size || new Set(ids).size !== byId.size || ids.some(id => !byId.has(id))) throw new Error("Incomplete geometry preset order");
  return Object.freeze(ids.map(id => byId.get(id)));
}
export const SOLID_FULL_PRESETS = ordered(solidScenes, [
  "original-cube", "shape-cube-orbit", "octahedron-chimes", "plane-prism-skip", "pyramid-velvet",
  "shape-pyramid-turn", "sphere-shepard", "plane-cube-fast", "prism-knocks", "shape-torus-sweep",
  "cone-reed", "plane-octa-chase", "torus-beating", "shape-prism-turn", "cylinder-wash",
  "plane-cylinder-beat", "cube-corner-club", "prism-brass", "crooked-octahedron", "torus-whisper",
]);
export const HYPER_FULL_PRESETS = ordered(hyperScenes, [
  "original-tesseract", "klein-reed", "plane-tesseract-fast", "slow-hypersphere", "shape-tesseract-spin",
  "pyramid-knocks", "plane-sphere-sweep", "glass-tesseract", "shape-klein-roll", "endless-hypersphere",
  "plane-pyramid-ticks", "pyramid-brass", "shape-pyramid-turn", "klein-lantern", "velvet-tesseract",
  "plane-klein-skip", "tesseract-sprint", "shape-sphere-turn", "feral-klein", "pyramid-inversion",
]);

export function randomizeGeometryPreset(kind, current, random = Math.random) {
  const rng = presetRandom(random);
  const p = { ...current.parameters, ...randomParameterValues({
    ...ranges(kind), speed: [0.04, 0.5], baseFrequency: [55, 220], pitchRange: [1, 4],
    fmIndex: [0.2, 5], percussionAttack: [8, 25], percussionDecay: [60, 500],
    ...Object.fromEntries(keys(kind).filter(key => key.endsWith("Speed")).map(key => [key, [-0.15, 0.15]])),
  }, rng), level: current.parameters.level, profileSides: rng.integer(1, 16),
  };
  for (const key of keys(kind).filter(key => key === "playing" || key.endsWith("Playing"))) p[key] = rng.pick([true, false]);
  if (!p.playing && !keys(kind).some(key => key.endsWith("Playing") && p[key])) p.playing = true;
  p.direction = rng.pick([-1, 1]);
  p.profileShapeType = rng.pick(["polygon", "star"]);
  p.soundMode = rng.pick(soundModes);
  p.voiceLimit = rng.integer(4, p.soundMode === "shepard" ? 8 : kind === "solid" ? 24 : 20);
  p[kind === "solid" ? "solidType" : "shapeType"] = rng.pick(forms[kind]);
  const enabled = rng.pick([true, false]);
  const result = { parameters: p, envelope: {
    enabled, swell: enabled && rng.pick([true, false]), preset: "custom", level: rng.between(0.3, 1),
    points: [0, rng.between(0.04, 0.2), rng.between(0.25, 0.48), rng.between(0.55, 0.8), 1].map(x => ({ x, y: rng.between(0.1, 1) })),
  } };
  return validateGeometryPreset(kind, result);
}
