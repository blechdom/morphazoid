import { sampleSourceGrasp } from "./hand-source-motion.js";
import { createHandPresets } from "./hand-presets.js";
import { createHandTremor } from "./hand-tremor.js";

/** Shared choreography and sound mapping. Angles are degrees, time is seconds.
 * The ranges are conservative playable rig limits, not clinical measurements.
 * Slots mcp/pip/dip mean MCP/PIP/DIP on fingers and CMC/MCP/IP on the thumb;
 * thumb spread is basal opposition. In foot mode they mean MTP/PIP/DIP; the
 * two-joint big toe uses mcp=MTP, dip=IP and keeps pip=0. Wrist slots describe
 * the ankle/foot complex. Sound and adapted toe choreography are artistic mappings.
 */
export const FINGERS = Object.freeze(["thumb", "index", "middle", "ring", "little"]);
export const GESTICULES_FORMS = Object.freeze(["hand", "foot"]);
const HAND_DIGIT_LABELS = Object.freeze(["Thumb", "Index", "Middle", "Ring", "Little"]);
const FOOT_DIGIT_LABELS = Object.freeze(["Big toe", "Second toe", "Third toe", "Fourth toe", "Little toe"]);
const DIGIT_KEYS = Object.freeze(["mcp", "pip", "dip", "spread"]);
const BIG_TOE_KEYS = Object.freeze(["mcp", "dip", "spread"]);
export const handDigitLabels = form => form === "foot" ? FOOT_DIGIT_LABELS : HAND_DIGIT_LABELS;
export const handJointKeys = (form, index) => form === "foot" && index === 0 ? BIG_TOE_KEYS : DIGIT_KEYS;
export const VOICE_SOURCES = Object.freeze(["glass", "reed", "wire", "pulse", "air", "bowed", "vowel", "metal"]);
export const TREMOR_FINGERS = Object.freeze(["all", ...FINGERS, "alternating"]);
export const TREMOR_JOINTS = Object.freeze(["tip", "middle", "knuckle", "whole", "spread", "wrist"]);
export const HAND_SKINS = Object.freeze([0, .17, .38, .55, .76, .9, 1]);
export const HAND_LIGHTINGS = Object.freeze([0, .2, .4, .6, .8, 1]);
const LEGACY_COLORS = Object.freeze({copper:0,jade:.38,cyan:.55,violet:.76});
const LEGACY_LIGHTS = Object.freeze({studio:0,warm:.2,cool:.4,noir:.6,neon:.8,soft:1});
export function normalizeHandAppearance(value = {}) {
  const input = record(value);
  return {
    skin: clampHand(typeof input.skin === 'string' && Object.hasOwn(LEGACY_COLORS,input.skin) ? LEGACY_COLORS[input.skin] : input.skin,0,1,0),
    lighting: clampHand(typeof input.lighting === 'string' && Object.hasOwn(LEGACY_LIGHTS,input.lighting) ? LEGACY_LIGHTS[input.lighting] : input.lighting,0,1,0),
  };
}
const TAU = Math.PI * 2;
const record = value => value && typeof value === "object" ? value : {};
export function handNumber(value, fallback = 0) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.length < 80 ? Number(value) : NaN;
  return Number.isFinite(number) ? number : fallback;
}
export const clampHand = (value, min, max, fallback = min) => Math.max(min, Math.min(max, handNumber(value, fallback)));
const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const HAND_LIMITS = freeze({
  finger: { mcp: [-15, 90], pip: [-2, 110], dip: [-15, 85], spread: [-25, 25] },
  thumb: { mcp: [-12, 85], pip: [0, 80], dip: [-6, 75], spread: [-25, 25] },
  wrist: { flex: [-55, 65], side: [-30, 30], twist: [-70, 70] },
  tremor: { amount: [0, 45], rate: [.1, 120], rateSpread: [0, 1], phaseSpread: [0, 1] },
  view: { yaw: [-Math.PI, Math.PI], pitch: [-1.15, 1.15], zoom: [.62, 2] },
  motion: { tempo: [20, 1100], amount: [0, 1], speed: [.1, 4], elasticity: [0, 1] },
  sound: { rootHz: [35, 1000], brightness: [0, 1], roughness: [0, 1], space: [0, 1], rotationFx: [0, 1], attack: [.004, 1.2], release: [.04, 3.5] },
});
export const FOOT_LIMITS = freeze({
  bigToe: { mcp: [-55, 40], pip: [0, 0], dip: [0, 70], spread: [-12, 12] },
  toe: { mcp: [-40, 40], pip: [0, 90], dip: [0, 60], spread: [-10, 10] },
  ankle: { flex: [-20, 45], side: [-15, 25], twist: [-12, 12] },
  shape: { arch: [-70, 85], twist: [-55, 55], stretch: [-.4, 1] },
});
export const handDigitLimits = (form, index) => form === "foot"
  ? index === 0 ? FOOT_LIMITS.bigToe : FOOT_LIMITS.toe
  : index === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger;
export const handWristLimits = form => form === "foot" ? FOOT_LIMITS.ankle : HAND_LIMITS.wrist;
const DIGIT_JOINT_LABELS = freeze({ mcp: "Knuckle bend", pip: "Middle joint", dip: "Tip joint", spread: "Spread" });
const THUMB_JOINT_LABELS = freeze({ mcp: "Base bend", pip: "Knuckle bend", dip: "Tip bend", spread: "Opposition" });
const TOE_JOINT_LABELS = freeze({ mcp: "Base bend", pip: "Middle joint", dip: "Tip joint", spread: "Spread" });
export function handJointLabel(form, index, key) {
  if (form === "foot" && index === 0 && key === "pip") return "";
  return (form === "foot" ? TOE_JOINT_LABELS : index === 0 ? THUMB_JOINT_LABELS : DIGIT_JOINT_LABELS)[key] ?? "";
}
// Scale authored hand offsets, never a performer's physical degree controls.
const FOOT_MOTION_SCALE = freeze({ mcp: .5, pip: .75, dip: .7, spread: .4, flex: .55, side: .55, twist: .18 });
const footTipOffset = (index, pip, dip) => index === 0 ? .85 * (.45 * pip + .55 * dip) : dip * FOOT_MOTION_SCALE.dip;
const fingers = (bends, spreads = [12, -8, 0, 5, 13]) => bends.map((bend, i) => ({ mcp: bend[0], pip: bend[1], dip: bend[2], spread: spreads[i] }));
export const HAND_POSES = freeze([
  { id: "source-open", label: "Open hand · original", pose: { fingers: fingers([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], [0, 0, 0, 0, 0]), wrist: { flex: 0, side: 0, twist: 0 } } },
  { id: "relaxed", label: "Relaxed", pose: { fingers: fingers([[18, 16, 12], [16, 24, 12], [18, 28, 16], [22, 32, 20], [26, 35, 23]]), wrist: { flex: 0, side: 0, twist: 0 } } },
  { id: "open", label: "Open palm", pose: { fingers: fingers([[4, 4, 3], [2, 2, 2], [0, 2, 2], [3, 3, 3], [5, 4, 4]], [22, -15, 0, 11, 23]), wrist: { flex: -8, side: 0, twist: 0 } } },
  { id: "fist", label: "Soft fist", pose: { fingers: fingers([[42, 42, 32], [72, 88, 60], [78, 94, 64], [76, 91, 62], [74, 86, 58]], [-10, -3, 0, 2, 5]), wrist: { flex: 9, side: -4, twist: 0 } } },
  { id: "point", label: "Point", pose: { fingers: fingers([[28, 22, 16], [0, 3, 2], [73, 89, 62], [78, 94, 66], [79, 90, 65]], [5, -6, 0, 4, 8]), wrist: { flex: -4, side: -9, twist: -12 } } },
  { id: "pinch", label: "Pinch", pose: { fingers: fingers([[40, 30, 26], [48, 66, 39], [20, 25, 14], [25, 32, 19], [32, 38, 23]], [-20, -13, 0, 10, 18]), wrist: { flex: -5, side: 4, twist: 18 } } },
  { id: "claw", label: "Claw", pose: { fingers: fingers([[22, 54, 42], [-7, 84, 58], [-10, 88, 62], [-5, 82, 56], [0, 76, 52]], [20, -17, 0, 14, 24]), wrist: { flex: 18, side: 0, twist: -8 } } },
  { id: "fan", label: "Finger fan", pose: { fingers: fingers([[8, 6, 5], [8, 12, 8], [12, 16, 10], [17, 20, 12], [22, 25, 16]], [25, -25, -5, 16, 25]), wrist: { flex: -16, side: 10, twist: 24 } } },
]);
export const HAND_MOTIONS = freeze([
  { id: "source-grasp", label: "Open / close · original", beats: 4 },
  { id: "still", label: "Still", beats: 4 },
  { id: "wave", label: "Wave", beats: 4 },
  { id: "beckon", label: "Beckon", beats: 4 },
  { id: "finger-roll", label: "Finger roll", beats: 4 },
  { id: "pinch", label: "Pinch and release", beats: 4 },
  { id: "count", label: "Counting fingers", beats: 10 },
  { id: "flourish", label: "Flourish", beats: 8 },
  { id: "finger-fan", label: "Fan and gather", beats: 4 },
  { id: "ripple-open", label: "Opening ripple", beats: 8 },
  { id: "ripple-close", label: "Closing ripple", beats: 8 },
  { id: "finger-drumming", label: "Finger drumming", beats: 8 },
  { id: "spider-walk", label: "Spider walk", beats: 8 },
  { id: "air-piano", label: "Air piano", beats: 8 },
  { id: "index-tap", label: "Index tapping", beats: 4 },
  { id: "thumb-pulse", label: "Thumb pulse", beats: 4 },
  { id: "thumb-orbit", label: "Thumb orbit", beats: 4 },
  { id: "opposition-walk", label: "Thumb visits fingers", beats: 8 },
  { id: "pinch-ladder", label: "Climbing pinches", beats: 8 },
  { id: "circle-pinch", label: "Circling pinch", beats: 8 },
  { id: "claw-pulse", label: "Claw and uncurl", beats: 4 },
  { id: "squeeze-release", label: "Squeeze and release", beats: 8 },
  { id: "wrist-circle", label: "Wrist circles", beats: 8 },
  { id: "wrist-nod", label: "Wrist nodding", beats: 4 },
  { id: "wrist-turn", label: "Palm to back", beats: 8 },
  { id: "figure-eight", label: "Figure eight", beats: 8 },
  { id: "flourish-spiral", label: "Spiral flourish", beats: 8 },
  { id: "flick", label: "Finger flicks", beats: 8 },
  { id: "finger-scissors", label: "Finger scissors", beats: 4 },
  { id: "double-beckon", label: "Two-finger beckon", beats: 4 },
  { id: "two-finger-walk", label: "Two-finger walk", beats: 8 },
  { id: "ring-pulse", label: "Ring-finger bow", beats: 4 },
  { id: "polyrhythmic-tangle", label: "Polyrhythmic tangle", beats: 16 },
  { id: "finger-swarm", label: "Finger swarm", beats: 16 },
  { id: "frantic-orbit", label: "Frantic orbit", beats: 16 },
  { id: "scatter", label: "Scatter", beats: 16 },
]);
const FOOT_POSE_LABELS = freeze({ "source-open": "Toes at rest", relaxed: "Relaxed toes", open: "Open toes", fist: "Toe curl",
  point: "Second toe extended", pinch: "Gathered toes", claw: "Toe claw", fan: "Toe fan" });
const FOOT_MOTION_LABELS = freeze({
  "source-grasp": "Toe curl · adapted", wave: "Toe wave", beckon: "Toe beckon", "finger-roll": "Toe roll",
  pinch: "Gather and release", count: "Counting toes", flourish: "Foot flourish", "finger-drumming": "Toe drumming",
  "spider-walk": "Toe stepping", "air-piano": "Toe piano", "index-tap": "Second-toe tapping", "thumb-pulse": "Big-toe pulse",
  "thumb-orbit": "Big-toe orbit", "opposition-walk": "Big-toe conversation", "pinch-ladder": "Curl ladder", "circle-pinch": "Circling curl",
  "wrist-circle": "Ankle circles", "wrist-nod": "Ankle rocking", "wrist-turn": "Foot turning", "flourish-spiral": "Ankle spiral",
  flick: "Toe flicks", "finger-scissors": "Toe scissors", "double-beckon": "Two-toe beckon", "two-finger-walk": "Two-toe stepping",
  "ring-pulse": "Fourth-toe bow", "finger-swarm": "Toe swarm",
});
export function handMotionLabel(id, form = "hand") {
  return (form === "foot" ? FOOT_MOTION_LABELS[id] : null) ?? HAND_MOTIONS.find(motion => motion.id === id)?.label ?? "Still";
}
export function handPoseLabel(id, form = "hand") {
  return (form === "foot" ? FOOT_POSE_LABELS[id] : null) ?? HAND_POSES.find(pose => pose.id === id)?.label ?? "Relaxed";
}
/** Fresh base pose for either rig; saved foot values remain actual degrees. */
export function handPoseForForm(id, form = "hand") {
  const source = HAND_POSES.find(pose => pose.id === id)?.pose ?? HAND_POSES[0].pose;
  const pose = createHandPose();
  for (let i = 0; i < 5; i++) {
    const f = source.fingers[i], out = pose.fingers[i];
    if (form === "foot") {
      out.mcp = f.mcp * FOOT_MOTION_SCALE.mcp; out.pip = i === 0 ? 0 : f.pip * FOOT_MOTION_SCALE.pip;
      out.dip = footTipOffset(i, f.pip, f.dip); out.spread = f.spread * FOOT_MOTION_SCALE.spread;
    } else Object.assign(out, f);
  }
  for (const key of ["flex", "side", "twist"]) pose.wrist[key] = source.wrist[key] * (form === "foot" ? FOOT_MOTION_SCALE[key] : 1);
  return normalizeHandConfig({ form, pose }).pose;
}
const MOTION_BEATS = new Map(HAND_MOTIONS.map(motion => [motion.id, motion.beats]));
/** Cycle length in beats; unknown legacy values use the original four beats. */
export const handMotionBeats = id => MOTION_BEATS.get(id) ?? 4;
/** Cycle length in seconds. Speed multiplies tempo and defaults to 1 for v1 scenes. */
export function handMotionPeriod(value = {}) {
  const motion = record(value);
  return handMotionBeats(motion.id) * 60 / (clampHand(motion.tempo, 20, 1100, 72) * clampHand(motion.speed, .1, 4, 1));
}
const DEFAULT_POSE = HAND_POSES.find(pose => pose.id === "source-open").pose;
export const HAND_DEFAULTS = freeze({
  version: 1, form: "hand",
  pose: { fingers: DEFAULT_POSE.fingers.map(f => ({ ...f })), wrist: { ...DEFAULT_POSE.wrist } },
  motion: { id: "source-grasp", tempo: 72, amount: .85, speed: 1, elasticity: 0 },
  sound: { rootHz: 137, brightness: .46, roughness: .16, space: .28, rotationFx: .65, attack: .045, release: .45 },
  voices: FINGERS.map((_, i) => ({ source: VOICE_SOURCES[i], level: i === 4 ? .5 : .7, mute: false, solo: false })),
  view: { yaw: .12, pitch: .035, zoom: 1 },
  tremor: { finger: "all", joint: "tip", amount: 0, rate: 8, rateSpread: 0, phaseSpread: 0 },
  appearance: { skin: 0, lighting: 0 },
});
export function createHandPose() {
  return { fingers: Array.from({ length: 5 }, () => ({ mcp: 0, pip: 0, dip: 0, spread: 0 })), wrist: { flex: 0, side: 0, twist: 0 } };
}
export function normalizeHandConfig(value = {}) {
  const input = record(value), pose = record(input.pose), wrist = record(pose.wrist), motion = record(input.motion), sound = record(input.sound), view = record(input.view), tremor = record(input.tremor), appearance = record(input.appearance);
  // Additive v1 fields retain the hand, 1× speed, palm framing and natural studio appearance.
  const next = { version: 1, form: input.form === "foot" ? "foot" : "hand", pose: createHandPose(), motion: {}, sound: {}, voices: [], view: {}, tremor: {}, appearance: {} };
  for (let i = 0; i < 5; i++) {
    const f = record(pose.fingers?.[i]), bounds = handDigitLimits(next.form, i);
    for (const key of ["mcp", "pip", "dip", "spread"]) next.pose.fingers[i][key] = clampHand(f[key], ...bounds[key], HAND_DEFAULTS.pose.fingers[i][key]);
    const v = record(input.voices?.[i]), fallback = HAND_DEFAULTS.voices[i];
    next.voices.push({ source: VOICE_SOURCES.includes(v.source) ? v.source : fallback.source,
      level: clampHand(v.level, 0, 1, fallback.level), mute: v.mute === true, solo: v.solo === true });
  }
  for (const [key, bounds] of Object.entries(handWristLimits(next.form))) next.pose.wrist[key] = clampHand(wrist[key], ...bounds, HAND_DEFAULTS.pose.wrist[key]);
  if (next.form === "foot") {
    next.pose.foot = {};
    const shape = record(pose.foot);
    for (const [key, bounds] of Object.entries(FOOT_LIMITS.shape)) next.pose.foot[key] = clampHand(shape[key], ...bounds, 0);
  }
  for (const [key, bounds] of Object.entries(HAND_LIMITS.view)) next.view[key] = clampHand(view[key], ...bounds, HAND_DEFAULTS.view[key]);
  next.tremor.finger = TREMOR_FINGERS.includes(tremor.finger) ? tremor.finger : HAND_DEFAULTS.tremor.finger;
  next.tremor.joint = TREMOR_JOINTS.includes(tremor.joint) ? tremor.joint : HAND_DEFAULTS.tremor.joint;
  if (next.form === "foot" && next.tremor.finger === "thumb" && next.tremor.joint === "middle") next.tremor.joint = "tip";
  for (const [key, bounds] of Object.entries(HAND_LIMITS.tremor)) next.tremor[key] = clampHand(tremor[key], ...bounds, HAND_DEFAULTS.tremor[key]);
  next.appearance = normalizeHandAppearance(appearance);
  next.motion.id = HAND_MOTIONS.some(item => item.id === motion.id) ? motion.id : HAND_DEFAULTS.motion.id;
  for (const [key, bounds] of Object.entries(HAND_LIMITS.motion)) next.motion[key] = clampHand(motion[key], ...bounds, HAND_DEFAULTS.motion[key]);
  for (const [key, bounds] of Object.entries(HAND_LIMITS.sound)) next.sound[key] = clampHand(sound[key], ...bounds, HAND_DEFAULTS.sound[key]);
  return next;
}
const smooth = value => { const x = clampHand(value, 0, 1); return x * x * (3 - 2 * x); };
// Reused output objects own their sampler scratch space without serializing it
// into configuration or visible pose data. No allocation after first source use.
const sourceCaches = new WeakMap();
// The worklet warms both pose objects before processing. Tremor pitch deltas
// remain private to evaluated poses, outside saved configuration and rig metadata.
const tremorPitchByPose = new WeakMap();
function tremorPitchForPose(out) {
  let offsets = tremorPitchByPose.get(out);
  if (!offsets) { offsets = new Float64Array(5); tremorPitchByPose.set(out, offsets); }
  offsets.fill(0);
  return offsets;
}
const applyHandTremor = createHandTremor({
  clampHand, handDigitLimits, handWristLimits, FINGERS, TREMOR_FINGERS, TREMOR_JOINTS,
});
function sourceForPose(out, phase, amount) {
  let cache = sourceCaches.get(out);
  if (!cache) {
    cache = { sample: sampleSourceGrasp(0), metadata: { phase: 0, amount: 0, offsets: createHandPose().fingers } };
    sourceCaches.set(out, cache);
  }
  sampleSourceGrasp(phase, cache.sample);
  cache.metadata.phase = phase; cache.metadata.amount = amount;
  for (let i = 0; i < 5; i++) {
    const sample = cache.sample.fingers[i], offsets = cache.metadata.offsets[i];
    offsets.mcp = sample.mcp * amount; offsets.pip = sample.pip * amount;
    offsets.dip = sample.dip * amount; offsets.spread = sample.spread * amount;
  }
  out.source = cache.metadata;
  return cache.sample;
}
/** Additive choreography preserves every base joint's effect during playback.
 * Optional output storage lets both the viewer and the worklet avoid allocation.
 * Pausing means retaining time; it does not select the base pose or zero motion.
 * An independent tremor time preserves its Hz phase when choreography is rebased.
 */
export function evaluateHandPose(value = HAND_DEFAULTS, time = 0, out = createHandPose(), tremorTime = time) {
  const config = record(value), pose = record(config.pose), motion = record(config.motion), foot = config.form === "foot";
  const id = motion.id, amount = id === "still" ? 0 : clampHand(motion.amount, 0, 1, HAND_DEFAULTS.motion.amount);
  const beats = handMotionBeats(id), seconds = clampHand(time, 0, 1e9), tremorPitch = tremorPitchForPose(out);
  const beat = (seconds * clampHand(motion.tempo, 20, 1100, 72) * clampHand(motion.speed, .1, 4, 1) / 60) % beats;
  const phase = beat / beats * TAU;
  out.source = null;
  const source = id === "source-grasp" ? sourceForPose(out, beat / beats, amount) : null;
  // Foot choreography adapts scalar curves only. Hand quaternion metadata must
  // never enter the foot rig or subtract its original hand offsets a second time.
  if (foot) out.source = null;
  for (let i = 0; i < 5; i++) {
    const base = record(pose.fingers?.[i]), f = out.fingers[i], fallback = HAND_DEFAULTS.pose.fingers[i];
    let curl = 0, tip = 0, spread = 0, distal = null;
    if (source) { curl = source.fingers[i].mcp; tip = source.fingers[i].pip; spread = source.fingers[i].spread; }
    else if (id === "wave") { curl = 11 * Math.sin(phase - i * .34); tip = 7 * Math.sin(phase - i * .34 - .35); spread = 4 * Math.cos(phase + i * .4); }
    else if (id === "beckon") { const bend = .5 - .5 * Math.cos(phase * 2 - i * .15); curl = (i === 0 ? 12 : 49) * bend; tip = (i === 0 ? 8 : 50) * bend; }
    else if (id === "finger-roll") { const bend = Math.sin(phase - i * .88); curl = 25 * bend + 12; tip = 30 * Math.sin(phase - i * .88 - .3) + 12; spread = 5 * Math.sin(phase - i * .6); }
    else if (id === "pinch") { const bend = .5 - .5 * Math.cos(phase); curl = (i === 0 ? 29 : i === 1 ? 35 : -9) * bend; tip = (i < 2 ? 33 : -8) * bend; spread = (i === 0 ? -31 : i === 1 ? -7 : 5) * bend; }
    else if (id === "count") {
      const rise = smooth(beat - i * .72), fall = smooth(beat - 5.4 - i * .6);
      const closed = 1 - rise + fall;
      curl = (i === 0 ? 30 : 54) * closed; tip = (i === 0 ? 30 : 61) * closed; spread = -6 * closed;
    } else if (id === "flourish") { curl = 20 * Math.sin(phase * 2 - i * .65) + 8 * Math.cos(phase); tip = 25 * Math.sin(phase * 2 - i * .65 - .4); spread = 10 * Math.sin(phase + i * .45); }
    // These are authored periodic joint offsets, not captured human motion.
    // Integer harmonics and smooth cosine pulses keep every loop seam continuous.
    else switch (id) {
      case "finger-fan": {
        const open = .5 - .5 * Math.cos(phase);
        curl = (i + 1) * 1.5 * (1 - open); tip = 4 * (1 - open);
        spread = (i === 0 ? 24 : i === 1 ? -22 : i === 2 ? -3 : i === 3 ? 13 : 24) * open;
        break;
      }
      case "ripple-open": {
        const closed = .5 + .5 * Math.cos(phase - i * .92);
        curl = (i === 0 ? 35 : 56) * closed; tip = (i === 0 ? 40 : 74) * closed * closed;
        spread = (i - 2) * 3 * (1 - closed); break;
      }
      case "ripple-close": {
        const closed = .5 - .5 * Math.cos(phase + (4 - i) * .92);
        curl = (i === 0 ? 39 : 63) * closed * closed; tip = (i === 0 ? 38 : 62) * closed;
        spread = (2 - i) * 2.5 * closed; break;
      }
      case "finger-drumming": {
        const tap = (.5 + .5 * Math.cos(phase * 2 - i * TAU / 5)) ** 4;
        curl = (i === 0 ? 13 : 40) * tap; tip = (i === 0 ? 9 : 21) * tap;
        distal = 7 * tap; spread = (i - 2) * 2; break;
      }
      case "spider-walk": {
        const step = .5 + .5 * Math.sin(phase * 2 + i * Math.PI / 2);
        curl = i === 0 ? 18 + 12 * step : 21 + 31 * step;
        tip = i === 0 ? 18 : 68 - 41 * step; distal = 9 + 25 * (1 - step);
        spread = (i - 2) * 4 + 5 * Math.sin(phase * 2 + i); break;
      }
      case "air-piano": {
        const press = (.5 - .5 * Math.cos(phase * (i === 0 ? 1 : i % 3 + 1) - i * 1.15)) ** 3;
        curl = (i === 0 ? 18 : 34) * press; tip = 9 + 13 * press;
        distal = 4 + 5 * press; spread = (i - 2) * 3; break;
      }
      case "index-tap": {
        const tap = (.5 - .5 * Math.cos(phase * 2)) ** 2;
        curl = i === 1 ? 46 * tap : i === 0 ? 17 : 27 + i * 3;
        tip = i === 1 ? 16 * tap : i === 0 ? 12 : 33;
        distal = i === 1 ? 3 * tap : 17; break;
      }
      case "thumb-pulse": {
        const press = .5 - .5 * Math.cos(phase * 2);
        curl = i === 0 ? 45 * press : 5; tip = i === 0 ? 42 * press : 8;
        spread = i === 0 ? -23 * press : (i - 2) * 2; break;
      }
      case "thumb-orbit": {
        curl = i === 0 ? 28 + 24 * Math.sin(phase) : 7;
        tip = i === 0 ? 17 + 12 * Math.sin(phase - .8) : 11;
        distal = i === 0 ? 10 + 8 * Math.sin(phase - 1.2) : 6;
        spread = i === 0 ? 22 * Math.cos(phase) : (i - 2) * 3; break;
      }
      case "opposition-walk": {
        const meet = (.5 + .5 * Math.cos(phase - (i - 1) * Math.PI / 2)) ** 3;
        curl = i === 0 ? 35 + 10 * Math.sin(phase) : 47 * meet;
        tip = i === 0 ? 25 + 11 * Math.cos(phase) : 56 * meet;
        spread = i === 0 ? -12 + 11 * Math.sin(phase - .6) : (2 - i) * 3 * meet; break;
      }
      case "pinch-ladder": {
        const meet = (.5 + .5 * Math.cos(phase + (i - 1) * Math.PI / 2)) ** 4;
        curl = i === 0 ? 27 + 13 * (.5 - .5 * Math.cos(phase * 4)) : (32 + i * 4) * meet;
        tip = i === 0 ? 31 : (43 + i * 4) * meet;
        spread = i === 0 ? -16 - 7 * Math.cos(phase) : (2 - i) * 5 * meet; break;
      }
      case "circle-pinch": {
        const close = .65 + .35 * Math.sin(phase * 2);
        curl = (i < 2 ? 39 : 8 + i * 2) * close;
        tip = (i < 2 ? 43 : 13) * close; spread = i === 0 ? -22 * close : i === 1 ? -8 * close : (i - 2) * 6;
        break;
      }
      case "claw-pulse": {
        const claw = .5 - .5 * Math.cos(phase);
        curl = (i === 0 ? 18 : -9) * claw; tip = (i === 0 ? 53 : 87) * claw;
        distal = (i === 0 ? 37 : 59) * claw; spread = (i === 0 ? 20 : (i - 2) * 8) * claw; break;
      }
      case "squeeze-release": {
        const squeeze = (.5 - .5 * Math.cos(phase)) ** 2;
        const settle = 1 + .06 * Math.sin(phase * 3 - i * .12);
        curl = (i === 0 ? 42 : 73) * squeeze * settle;
        tip = (i === 0 ? 44 : 88) * squeeze; distal = (i === 0 ? 31 : 59) * squeeze;
        spread = (i === 0 ? -18 : (2 - i) * 2) * squeeze; break;
      }
      case "wrist-circle": {
        curl = 9 + i * 2 + 5 * Math.sin(phase - i * .2); tip = 15 + 6 * Math.sin(phase - i * .2 - .4);
        spread = (i - 2) * 4; break;
      }
      case "wrist-nod": {
        curl = 6 + 5 * Math.sin(phase - .4); tip = 8 + 5 * Math.sin(phase - .8); break;
      }
      case "wrist-turn": {
        curl = 13 + 9 * Math.sin(phase - i * .22); tip = 17 + 10 * Math.sin(phase - i * .22 - .5);
        spread = (i === 0 ? 17 : (i - 2) * 5) * (.7 + .3 * Math.cos(phase)); break;
      }
      case "figure-eight": {
        curl = 14 + 11 * Math.sin(phase - i * .4); tip = 16 + 13 * Math.sin(phase - i * .4 - .3);
        spread = 7 * Math.sin(phase * 2 + i * .3); break;
      }
      case "flourish-spiral": {
        const spiral = .5 + .5 * Math.sin(phase * 2 - i * 1.1);
        curl = 44 * spiral; tip = 58 * spiral * spiral;
        spread = (i === 0 ? 21 : (i - 2) * 9) * Math.sin(phase - i * .15); break;
      }
      case "flick": {
        const release = (.5 + .5 * Math.cos(phase * 2 - i * .48)) ** 6;
        curl = (i === 0 ? 28 : 48) * (1 - release); tip = (i === 0 ? 23 : 61) * (1 - release);
        distal = (i === 0 ? 18 : 39) * (1 - release); spread = (i - 2) * 4 * release; break;
      }
      case "finger-scissors": {
        const apart = .5 - .5 * Math.cos(phase * 2);
        curl = i === 1 || i === 2 ? 4 : i === 0 ? 31 : 66;
        tip = i === 1 || i === 2 ? 4 : i === 0 ? 30 : 77;
        spread = i === 1 ? -22 * apart : i === 2 ? 16 * apart : 0; break;
      }
      case "double-beckon": {
        const bend = .5 - .5 * Math.cos(phase * 2 - (i === 2 ? .35 : 0));
        curl = i === 1 || i === 2 ? 45 * bend : i === 0 ? 24 : 61;
        tip = i === 1 || i === 2 ? 64 * bend : i === 0 ? 21 : 72;
        spread = i === 1 ? -7 : i === 2 ? 5 : 0; break;
      }
      case "two-finger-walk": {
        const step = .5 + .5 * Math.sin(phase * 2 + (i === 2 ? Math.PI : 0));
        curl = i === 1 || i === 2 ? 19 + 41 * step : i === 0 ? 31 : 69;
        tip = i === 1 || i === 2 ? 46 - 37 * step : i === 0 ? 28 : 81;
        distal = i === 1 || i === 2 ? 8 + 17 * (1 - step) : 39;
        spread = i === 1 ? -9 : i === 2 ? 7 : 0; break;
      }
      case "ring-pulse": {
        const bow = .5 - .5 * Math.cos(phase);
        curl = i === 3 ? 63 * bow : i === 4 ? 15 * bow : i === 2 ? 9 * bow : 6;
        tip = i === 3 ? 74 * bow : i === 4 ? 21 * bow : i === 2 ? 12 * bow : 8;
        spread = i === 3 ? 5 * Math.sin(phase) : (i - 2) * 3; break;
      }
      // Composite loops use separate integer-rate or phase-modulated paths at
      // every joint, so the fingers counter-move rather than echo one oscillator.
      case "polyrhythmic-tangle": {
        const direction = i % 2 === 0 ? 1 : -1;
        curl = 27 + 20 * Math.sin(phase * (i + 2) + i * .73) + 8 * Math.sin(phase * (i + 5) - i * .4);
        tip = 34 + 25 * Math.sin(phase * (i + 3) * direction - i * .57) + 8 * Math.cos(phase * 2 + i * .5);
        distal = 19 + 15 * Math.sin(phase * (i + 4) + i * .81);
        spread = 17 * Math.sin(phase * (i + 1) + i) + 4 * Math.sin(phase * 7 - i); break;
      }
      case "finger-swarm": {
        curl = 28 + 19 * Math.sin(phase * (i * 2 + 3) + i * .9) + 7 * Math.sin(phase * (i + 2) + 1.1);
        tip = 40 + 27 * Math.sin(phase * (i + 4) - i * .65) + 10 * Math.cos(phase * (i * 2 + 1));
        distal = 20 + 16 * Math.cos(phase * (i + 5) + .5);
        spread = 16 * Math.sin(phase * (i + 3) + i * 1.3); break;
      }
      case "frantic-orbit": {
        curl = 25 + 22 * Math.sin(phase * (i + 2) + i * 1.15 + .6 * Math.sin(phase * 3));
        tip = 35 + 28 * Math.sin(phase * (i + 3) - i * .62 + .4 * Math.sin(phase * 2));
        distal = 23 + 17 * Math.cos(phase * (i + 4) + .3 * Math.sin(phase * 5));
        spread = 19 * Math.sin(phase * 2 + i * .7) * Math.cos(phase * (i + 1) - .2) + 5 * Math.sin(phase * 7 + i); break;
      }
      case "scatter": {
        const burst = (.5 + .5 * Math.sin(phase * (i + 3) + 1.3 * Math.sin(phase * 2) - i * 1.31)) ** 3;
        curl = 12 + 53 * burst;
        tip = 14 + 64 * (.5 + .5 * Math.cos(phase * (i + 5) - .8 * Math.sin(phase * 3) + i * .91)) ** 2;
        distal = 8 + 44 * (.5 + .5 * Math.sin(phase * (i + 2) + i * .42)) ** 3;
        spread = 20 * Math.sin(phase * (i + 2) + i * .8) * (.35 + .65 * burst); break;
      }
    }
    let distalOffset = source ? source.fingers[i].dip : distal ?? tip * .62;
    if (foot) {
      distalOffset = footTipOffset(i, tip, distalOffset);
      curl *= FOOT_MOTION_SCALE.mcp; tip = i === 0 ? 0 : tip * FOOT_MOTION_SCALE.pip; spread *= FOOT_MOTION_SCALE.spread;
    }
    const bounds = handDigitLimits(config.form, i);
    f.mcp = clampHand(clampHand(base.mcp, ...bounds.mcp, fallback.mcp) + curl * amount, ...bounds.mcp);
    f.pip = clampHand(clampHand(base.pip, ...bounds.pip, fallback.pip) + tip * amount, ...bounds.pip);
    f.dip = clampHand(clampHand(base.dip, ...bounds.dip, fallback.dip) + distalOffset * amount, ...bounds.dip);
    f.spread = clampHand(clampHand(base.spread, ...bounds.spread, fallback.spread) + spread * amount, ...bounds.spread);
  }
  const baseWrist = record(pose.wrist);
  let flex = 0, side = 0, twist = 0;
  if (id === "wave") { side = 23 * Math.sin(phase); twist = 14 * Math.sin(phase); flex = 7 * Math.cos(phase); }
  if (id === "beckon") flex = 13 * Math.sin(phase * 2 - .5);
  if (id === "pinch") twist = 12 * Math.sin(phase);
  if (id === "flourish") { flex = 24 * Math.sin(phase); side = 19 * Math.cos(phase); twist = 44 * Math.sin(phase - .5); }
  switch (id) {
    case "finger-fan": flex = -7 * (.5 - .5 * Math.cos(phase)); break;
    case "ripple-open": flex = 7 * Math.sin(phase - .8); break;
    case "ripple-close": flex = -9 * Math.sin(phase + .7); break;
    case "finger-drumming": flex = -7 + 3 * Math.sin(phase * 2); side = 6 * Math.sin(phase); break;
    case "spider-walk": flex = 13 + 7 * Math.sin(phase * 4); side = 9 * Math.sin(phase * 2); break;
    case "air-piano": flex = -6 + 4 * Math.cos(phase * 2); side = 10 * Math.sin(phase); break;
    case "index-tap": flex = 4 * Math.sin(phase * 2 - .4); break;
    case "thumb-pulse": twist = 6 * Math.sin(phase * 2 - .3); break;
    case "opposition-walk": side = 8 * Math.sin(phase); twist = 13 * Math.cos(phase); break;
    case "pinch-ladder": flex = 8 * Math.sin(phase); side = -13 * Math.cos(phase); break;
    case "circle-pinch": flex = 21 * Math.sin(phase); side = 18 * Math.cos(phase); twist = 22 * Math.sin(phase + .6); break;
    case "claw-pulse": flex = 18 * (.5 - .5 * Math.cos(phase)); break;
    case "squeeze-release": flex = 17 * (.5 - .5 * Math.cos(phase)); twist = 8 * Math.sin(phase); break;
    case "wrist-circle": flex = 32 * Math.sin(phase); side = 25 * Math.cos(phase); break;
    case "wrist-nod": flex = 42 * Math.sin(phase); break;
    case "wrist-turn": flex = -8; twist = 64 * Math.sin(phase); break;
    case "figure-eight": flex = 29 * Math.sin(phase); side = 23 * Math.sin(phase * 2); twist = 31 * Math.cos(phase); break;
    case "flourish-spiral": flex = 23 * Math.sin(phase); side = 21 * Math.cos(phase); twist = 53 * Math.sin(phase - .7); break;
    case "flick": flex = 15 * Math.sin(phase * 2 - .6); twist = 11 * Math.sin(phase); break;
    case "finger-scissors": twist = 9 * Math.sin(phase); break;
    case "double-beckon": flex = 9 * Math.sin(phase * 2 - .4); twist = -10; break;
    case "two-finger-walk": flex = 20 + 5 * Math.sin(phase * 4); side = 6 * Math.sin(phase * 2); break;
    case "ring-pulse": side = 7 * Math.sin(phase - .4); break;
    case "polyrhythmic-tangle":
      flex = 28 * Math.sin(phase * 3) + 10 * Math.cos(phase * 7);
      side = 17 * Math.sin(phase * 2) + 8 * Math.cos(phase * 5);
      twist = 38 * Math.sin(phase) + 19 * Math.sin(phase * 4); break;
    case "finger-swarm":
      flex = 21 * Math.sin(phase * 5) + 9 * Math.sin(phase * 2);
      side = 17 * Math.cos(phase * 3) + 9 * Math.sin(phase * 7);
      twist = 34 * Math.sin(phase * 2) + 24 * Math.cos(phase * 5); break;
    case "frantic-orbit":
      flex = 34 * Math.sin(phase * 4) + 9 * Math.sin(phase);
      side = 24 * Math.cos(phase * 3);
      twist = 45 * Math.sin(phase * 2) + 17 * Math.sin(phase * 5); break;
    case "scatter":
      flex = 24 * Math.sin(phase * 3 + .7 * Math.sin(phase * 2));
      side = 23 * Math.sin(phase * 5 - .6 * Math.sin(phase));
      twist = 55 * Math.sin(phase * 2 + .5 * Math.sin(phase * 7)); break;
  }
  if (foot) { flex *= FOOT_MOTION_SCALE.flex; side *= FOOT_MOTION_SCALE.side; twist *= FOOT_MOTION_SCALE.twist; }
  const wristBounds = handWristLimits(config.form);
  out.wrist.flex = clampHand(handNumber(baseWrist.flex) + flex * amount, ...wristBounds.flex);
  out.wrist.side = clampHand(handNumber(baseWrist.side) + side * amount, ...wristBounds.side);
  out.wrist.twist = clampHand(handNumber(baseWrist.twist) + twist * amount, ...wristBounds.twist);
  if (foot) {
    const shape = record(pose.foot), elastic = clampHand(motion.elasticity, 0, 1, 0) * amount;
    const complex = id === "polyrhythmic-tangle" || id === "finger-swarm" || id === "frantic-orbit" || id === "scatter";
    const sway = phase * (complex ? 3 : 1), ripple = phase * (complex ? 5 : 2);
    out.foot ??= { arch: 0, twist: 0, stretch: 0 };
    // Artistic elastic rigging follows the same audio-clock phase as the toes.
    // Base shape remains directly editable; zero elasticity preserves older scenes.
    out.foot.arch = clampHand(handNumber(shape.arch) + elastic * 55 * (.75 * Math.sin(sway) + .25 * Math.sin(ripple)), ...FOOT_LIMITS.shape.arch);
    out.foot.twist = clampHand(handNumber(shape.twist) + elastic * 35 * (.7 * Math.sin(ripple) + .3 * Math.sin(phase * 7)), ...FOOT_LIMITS.shape.twist);
    out.foot.stretch = clampHand(handNumber(shape.stretch) + elastic * .6 * (.8 * Math.sin(sway) - .2 * Math.sin(ripple)), ...FOOT_LIMITS.shape.stretch);
  } else if (out.foot) delete out.foot;
  applyHandTremor(config.tremor, clampHand(tremorTime, -1e9, 1e9, seconds), out, tremorPitch, config.form);
  return out;
}
export function createHandVoices() {
  return Array.from({ length: 5 }, () => ({ frequency: 100, brightness: 0, roughness: 0, pan: 0, level: 0, source: "glass", excitation: 0 }));
}
const REGISTER_RATIOS = Object.freeze([.79, 1.19, 1, 1.09, 1.42]);
export function evaluateHandVoices(value = HAND_DEFAULTS, time = 0, out = createHandVoices(), pose = createHandPose(), previous = createHandPose(), tremorTime = time) {
  const config = record(value), sound = record(config.sound), voices = config.voices;
  const tremorSeconds = clampHand(tremorTime, -1e9, 1e9, clampHand(time, 0, 1e9));
  evaluateHandPose(config, time, pose, tremorSeconds);
  evaluateHandPose(config, Math.max(0, handNumber(time) - .01), previous, tremorSeconds - .01);
  const tremorPitch = tremorPitchByPose.get(pose);
  let solo = false;
  for (let i = 0; i < 5; i++) if (voices?.[i]?.solo === true && voices?.[i]?.mute !== true) solo = true;
  for (let i = 0; i < 5; i++) {
    const f = pose.fingers[i], old = previous.fingers[i], voice = record(voices?.[i]), fallback = HAND_DEFAULTS.voices[i], target = out[i];
    // Continuous exponential bend and deliberately non-scale finger registers.
    target.frequency = clampHand(clampHand(sound.rootHz, 35, 1000, 137) * REGISTER_RATIOS[i]
      * Math.exp(f.mcp * .0122 + pose.wrist.flex * .008 + pose.wrist.twist * .002 + tremorPitch[i]), 25, 4200);
    target.brightness = clampHand(clampHand(sound.brightness, 0, 1, .46) * .58 + f.pip / 110 * .26 + f.dip / 80 * .16 + pose.wrist.side * .002, 0, 1);
    target.roughness = clampHand(clampHand(sound.roughness, 0, 1, .16) * .8 + f.dip / 80 * .2, 0, 1);
    target.pan = clampHand((i - 2) * .26 + f.spread / 42 + pose.wrist.side / 100, -.97, .97);
    target.level = voice.mute === true || (solo && voice.solo !== true) ? 0 : clampHand(voice.level, 0, 1, fallback.level);
    target.source = VOICE_SOURCES.includes(voice.source) ? voice.source : fallback.source;
    target.excitation = clampHand((Math.abs(f.mcp - old.mcp) + .55 * Math.abs(f.pip - old.pip) + .35 * Math.abs(f.dip - old.dip)) / 3.5, 0, 1);
    if (config.form === "foot") {
      const shape = pose.foot, oldShape = previous.foot;
      // Stretch lowers register like a longer resonator; arch lifts its pitch and
      // brightness. Torsion widens/pans the sound and adds a little grain.
      target.frequency = clampHand(target.frequency * Math.exp(shape.arch * .006 - Math.log1p(shape.stretch) * .6), 25, 4200);
      target.brightness = clampHand(target.brightness + shape.arch / 260 + shape.stretch * .12, 0, 1);
      target.roughness = clampHand(target.roughness + Math.abs(shape.twist) / 260, 0, 1);
      target.pan = clampHand(target.pan + shape.twist / 140, -.97, .97);
      target.excitation = clampHand(target.excitation + (Math.abs(shape.arch - oldShape.arch) * .32
        + Math.abs(shape.twist - oldShape.twist) * .16 + Math.abs(shape.stretch - oldShape.stretch) * 22) / 3.5, 0, 1);
    }
  }
  return out;
}
export const HAND_PRESETS = createHandPresets({ normalizeHandConfig, HAND_POSES, handPoseForForm });
/** A full-state randomizer: no factory-scene selection or runtime ownership. */
export function randomizeHandConfig(_current = HAND_DEFAULTS, random = Math.random) {
  const unit = () => clampHand(typeof random === "function" ? random() : .5, 0, .999999, .5);
  const between = (lo, hi) => lo + (hi - lo) * unit();
  const next = normalizeHandConfig();
  for (let i = 0; i < 5; i++) {
    const bounds = i === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger;
    for (const key of ["mcp", "pip", "dip", "spread"]) next.pose.fingers[i][key] = between(...bounds[key]);
    next.voices[i] = { source: VOICE_SOURCES[Math.floor(unit() * VOICE_SOURCES.length)], level: between(.24, .91), mute: unit() < .09, solo: unit() < .08 };
  }
  for (const [key, bounds] of Object.entries(HAND_LIMITS.wrist)) next.pose.wrist[key] = between(...bounds);
  for (const [key, bounds] of Object.entries(HAND_LIMITS.view)) next.view[key] = between(...bounds);
  next.tremor = { finger: TREMOR_FINGERS[Math.floor(unit() * TREMOR_FINGERS.length)],
    joint: TREMOR_JOINTS[Math.floor(unit() * TREMOR_JOINTS.length)], amount: between(0, 45), rate: .1 * 1200 ** unit(), rateSpread: unit(), phaseSpread: unit() };
  next.appearance = { skin: unit(), lighting: unit() };
  next.motion = { id: HAND_MOTIONS[Math.floor(unit() * HAND_MOTIONS.length)].id, tempo: between(20, 1100), amount: unit(), speed: .1 * 40 ** unit() };
  next.sound = { rootHz: 35 * (1000 / 35) ** unit(), brightness: unit(), roughness: unit(), space: unit(), rotationFx: unit(),
    attack: .004 * 300 ** unit(), release: .04 * 87.5 ** unit() };
  if (next.voices.every(v => v.mute)) next.voices[Math.floor(unit() * 5)].mute = false;
  next.form = unit() < .5 ? "hand" : "foot";
  if (next.form === "foot") {
    for (let i = 0; i < 5; i++) for (const [key, bounds] of Object.entries(handDigitLimits("foot", i))) next.pose.fingers[i][key] = between(...bounds);
    for (const [key, bounds] of Object.entries(FOOT_LIMITS.ankle)) next.pose.wrist[key] = between(...bounds);
    next.pose.foot = {};
    for (const [key, bounds] of Object.entries(FOOT_LIMITS.shape)) next.pose.foot[key] = between(...bounds);
    next.motion.elasticity = unit();
  }
  return normalizeHandConfig(next);
}
