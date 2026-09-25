import { sampleSourceGrasp } from "./hand-source-motion.js";

/** Shared choreography and sound mapping. Angles are degrees, time is seconds.
 * The ranges are conservative playable rig limits, not clinical measurements.
 * Slots mcp/pip/dip mean MCP/PIP/DIP on fingers and CMC/MCP/IP on the thumb;
 * thumb spread is basal opposition. Sound is an original artistic mapping.
 */
export const FINGERS = Object.freeze(["thumb", "index", "middle", "ring", "little"]);
export const VOICE_SOURCES = Object.freeze(["glass", "reed", "wire", "pulse", "air", "bowed", "vowel", "metal"]);
export const TREMOR_FINGERS = Object.freeze(["all", ...FINGERS, "alternating"]);
export const TREMOR_JOINTS = Object.freeze(["tip", "middle", "knuckle", "whole", "wrist"]);
export const HAND_SKINS = Object.freeze(["natural", "porcelain", "copper", "jade", "violet", "cyan"]);
export const HAND_LIGHTINGS = Object.freeze(["studio", "warm", "cool", "noir", "neon", "soft"]);
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
  tremor: { amount: [0, 15], rate: [.5, 40] },
  view: { yaw: [-Math.PI, Math.PI], pitch: [-1.15, 1.15], zoom: [.62, 2] },
  motion: { tempo: [20, 1100], amount: [0, 1], speed: [.1, 4] },
  sound: { rootHz: [35, 1000], brightness: [0, 1], roughness: [0, 1], space: [0, 1], rotationFx: [0, 1], attack: [.004, 1.2], release: [.04, 3.5] },
});
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
  version: 1,
  pose: { fingers: DEFAULT_POSE.fingers.map(f => ({ ...f })), wrist: { ...DEFAULT_POSE.wrist } },
  motion: { id: "source-grasp", tempo: 72, amount: .85, speed: 1 },
  sound: { rootHz: 137, brightness: .46, roughness: .16, space: .28, rotationFx: .65, attack: .045, release: .45 },
  voices: FINGERS.map((_, i) => ({ source: VOICE_SOURCES[i], level: i === 4 ? .5 : .7, mute: false, solo: false })),
  view: { yaw: .12, pitch: .035, zoom: 1 },
  tremor: { finger: "all", joint: "tip", amount: 0, rate: 8 },
  appearance: { skin: "natural", lighting: "studio" },
});
export function createHandPose() {
  return { fingers: Array.from({ length: 5 }, () => ({ mcp: 0, pip: 0, dip: 0, spread: 0 })), wrist: { flex: 0, side: 0, twist: 0 } };
}
export function normalizeHandConfig(value = {}) {
  const input = record(value), pose = record(input.pose), wrist = record(pose.wrist), motion = record(input.motion), sound = record(input.sound), view = record(input.view), tremor = record(input.tremor), appearance = record(input.appearance);
  // Additive v1 fields restore 1× speed, palm framing, no tremor and natural studio appearance.
  const next = { version: 1, pose: createHandPose(), motion: {}, sound: {}, voices: [], view: {}, tremor: {}, appearance: {} };
  for (let i = 0; i < 5; i++) {
    const f = record(pose.fingers?.[i]), bounds = i === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger;
    for (const key of ["mcp", "pip", "dip", "spread"]) next.pose.fingers[i][key] = clampHand(f[key], ...bounds[key], HAND_DEFAULTS.pose.fingers[i][key]);
    const v = record(input.voices?.[i]), fallback = HAND_DEFAULTS.voices[i];
    next.voices.push({ source: VOICE_SOURCES.includes(v.source) ? v.source : fallback.source,
      level: clampHand(v.level, 0, 1, fallback.level), mute: v.mute === true, solo: v.solo === true });
  }
  for (const [key, bounds] of Object.entries(HAND_LIMITS.wrist)) next.pose.wrist[key] = clampHand(wrist[key], ...bounds, HAND_DEFAULTS.pose.wrist[key]);
  for (const [key, bounds] of Object.entries(HAND_LIMITS.view)) next.view[key] = clampHand(view[key], ...bounds, HAND_DEFAULTS.view[key]);
  next.tremor.finger = TREMOR_FINGERS.includes(tremor.finger) ? tremor.finger : HAND_DEFAULTS.tremor.finger;
  next.tremor.joint = TREMOR_JOINTS.includes(tremor.joint) ? tremor.joint : HAND_DEFAULTS.tremor.joint;
  for (const [key, bounds] of Object.entries(HAND_LIMITS.tremor)) next.tremor[key] = clampHand(tremor[key], ...bounds, HAND_DEFAULTS.tremor[key]);
  next.appearance.skin = HAND_SKINS.includes(appearance.skin) ? appearance.skin : HAND_DEFAULTS.appearance.skin;
  next.appearance.lighting = HAND_LIGHTINGS.includes(appearance.lighting) ? appearance.lighting : HAND_DEFAULTS.appearance.lighting;
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
function applyHandTremor(value, time, out, pitchOffsets) {
  const settings = record(value), amount = clampHand(settings.amount, 0, 15, 0);
  if (amount === 0) return;
  const finger = TREMOR_FINGERS.includes(settings.finger) ? settings.finger : "all";
  const joint = TREMOR_JOINTS.includes(settings.joint) ? settings.joint : "tip";
  const phase = time * clampHand(settings.rate, .5, 40, 8) * TAU;
  if (joint === "wrist") {
    out.wrist.flex = clampHand(out.wrist.flex + amount * Math.sin(phase), ...HAND_LIMITS.wrist.flex);
    out.wrist.side = clampHand(out.wrist.side + amount * .55 * Math.sin(phase + .9), ...HAND_LIMITS.wrist.side);
    out.wrist.twist = clampHand(out.wrist.twist + amount * .7 * Math.sin(phase + 1.8), ...HAND_LIMITS.wrist.twist);
    return;
  }
  for (let i = 0; i < 5; i++) {
    if (finger !== "all" && finger !== "alternating" && finger !== FINGERS[i]) continue;
    const f = out.fingers[i], bounds = i === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger;
    const delta = amount * Math.sin(phase + (finger === "alternating" && i % 2 ? Math.PI : 0));
    const oldMiddle = f.pip, oldTip = f.dip;
    if (joint === "knuckle" || joint === "whole") f.mcp = clampHand(f.mcp + delta, ...bounds.mcp);
    if (joint === "middle" || joint === "whole") f.pip = clampHand(f.pip + delta, ...bounds.pip);
    if (joint === "tip" || joint === "whole") f.dip = clampHand(f.dip + delta, ...bounds.dip);
    // Tip/middle tremor adds gentle vibrato from the actual visible deflection;
    // ordinary manual edits retain their original timbre mapping at amount 0.
    pitchOffsets[i] = (f.pip - oldMiddle) * .0035 + (f.dip - oldTip) * .0028;
  }
}
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
  const config = record(value), pose = record(config.pose), motion = record(config.motion);
  const id = motion.id, amount = id === "still" ? 0 : clampHand(motion.amount, 0, 1, HAND_DEFAULTS.motion.amount);
  const beats = handMotionBeats(id), seconds = clampHand(time, 0, 1e9), tremorPitch = tremorPitchForPose(out);
  const beat = (seconds * clampHand(motion.tempo, 20, 1100, 72) * clampHand(motion.speed, .1, 4, 1) / 60) % beats;
  const phase = beat / beats * TAU;
  out.source = null;
  const source = id === "source-grasp" ? sourceForPose(out, beat / beats, amount) : null;
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
    const bounds = i === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger;
    f.mcp = clampHand(clampHand(base.mcp, ...bounds.mcp, fallback.mcp) + curl * amount, ...bounds.mcp);
    f.pip = clampHand(clampHand(base.pip, ...bounds.pip, fallback.pip) + tip * amount, ...bounds.pip);
    f.dip = clampHand(clampHand(base.dip, ...bounds.dip, fallback.dip) + (source ? source.fingers[i].dip : distal ?? tip * .62) * amount, ...bounds.dip);
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
  out.wrist.flex = clampHand(handNumber(baseWrist.flex) + flex * amount, ...HAND_LIMITS.wrist.flex);
  out.wrist.side = clampHand(handNumber(baseWrist.side) + side * amount, ...HAND_LIMITS.wrist.side);
  out.wrist.twist = clampHand(handNumber(baseWrist.twist) + twist * amount, ...HAND_LIMITS.wrist.twist);
  applyHandTremor(config.tremor, clampHand(tremorTime, -1e9, 1e9, seconds), out, tremorPitch);
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
  }
  return out;
}
const PRESET_DEFINITIONS = [
  ["glass-wave", "Glass greeting", "open", "wave", 67, .72, 181, .44, .06, .42, .04, .85, ["glass", "glass", "glass", "wire", "air"]],
  ["reed-beckon", "Come closer", "relaxed", "beckon", 79, .82, 101, .55, .22, .16, .024, .25, ["reed", "reed", "wire", "reed", "air"]],
  ["wire-roll", "Finger loom", "relaxed", "finger-roll", 104, .77, 83, .69, .3, .33, .01, .32, ["wire", "wire", "wire", "wire", "glass"]],
  ["pinch-sparks", "Pinch sparks", "open", "pinch", 92, .9, 226, .72, .19, .12, .008, .13, ["pulse", "glass", "wire", "air", "glass"]],
  ["counting-air", "Count the air", "open", "count", 131, .88, 149, .27, .09, .68, .22, 1.1, ["air", "reed", "air", "glass", "air"]],
  ["flourish-copper", "Copper flourish", "fan", "flourish", 61, .8, 119, .74, .52, .46, .07, .65, ["wire", "reed", "pulse", "wire", "reed"]],
  ["low-claw", "Velvet claw", "claw", "finger-roll", 38, .33, 48, .17, .12, .2, .34, 1.4, ["reed", "pulse", "reed", "wire", "air"]],
  ["hushed-palm", "Hushed palm", "open", "wave", 29, .54, 312, .16, .02, .82, .65, 2.2, ["air", "glass", "air", "air", "glass"]],
  ["point-transmission", "Point transmission", "point", "flourish", 157, .38, 73, .86, .65, .06, .004, .085, ["pulse", "pulse", "wire", "pulse", "reed"]],
  ["slow-unfurl", "Slow unfurl", "relaxed", "count", 49, .66, 207, .39, .27, .59, .48, 1.75, ["glass", "wire", "reed", "air", "glass"]],
  ["closed-bell", "Bell in a fist", "fist", "still", 88, 0, 63, .61, .08, .37, .018, 1.3, ["glass", "glass", "glass", "glass", "glass"]],
  ["little-machinery", "Little machinery", "pinch", "beckon", 186, .48, 126, .81, .81, .23, .006, .17, ["pulse", "wire", "reed", "pulse", "air"]],
  ["original-grasp", "Original grasp", "source-open", "source-grasp", 75, 1, 151, .49, .13, .3, .04, .58, ["glass", "wire", "reed", "glass", "air"]],
  ["breathing-hand", "Breathing hand", "source-open", "source-grasp", 34, 1, 79, .24, .06, .71, .38, 1.8, ["air", "reed", "air", "wire", "air"]],
  ["bowed-spiral", "Rosin spiral", "source-open", "flourish-spiral", 74, .82, 92, .51, .37, .48, .16, .93, ["bowed", "bowed", "wire", "bowed", "glass"], .65],
  ["vowel-opposition", "Talking fingertips", "source-open", "opposition-walk", 89, .91, 118, .63, .21, .21, .032, .38, ["vowel", "vowel", "reed", "vowel", "air"], 1.1],
  ["metal-drumming", "Tin fingernails", "source-open", "finger-drumming", 122, .92, 173, .83, .47, .17, .006, .22, ["metal", "metal", "wire", "metal", "pulse"], 1.4],
  ["bowed-eight", "Cello figure eight", "relaxed", "figure-eight", 51, .68, 57, .28, .18, .56, .31, 1.65, ["bowed", "reed", "bowed", "bowed", "air"], .45],
  ["vowel-fan", "Palm choir", "source-open", "finger-fan", 62, .95, 204, .34, .08, .74, .44, 1.9, ["vowel", "vowel", "air", "vowel", "glass"], .8],
  ["metal-walk", "Clockwork fingers", "source-open", "two-finger-walk", 111, .76, 81, .71, .61, .29, .009, .31, ["metal", "pulse", "metal", "wire", "metal"], 1.7],
  ["tangled-polyrhythm", "Polyrhythmic tangle", "source-open", "polyrhythmic-tangle", 610, .86, 97, .67, .34, .29, .014, .21, ["wire", "metal", "vowel", "bowed", "glass"], 1.7],
  ["swarming-fingers", "Finger swarm", "source-open", "finger-swarm", 820, .78, 71, .75, .41, .22, .007, .15, ["pulse", "wire", "metal", "pulse", "air"], 2.4],
  ["orbit-frenzy", "Frantic orbit", "source-open", "frantic-orbit", 1060, .88, 113, .57, .49, .18, .009, .18, ["vowel", "bowed", "metal", "wire", "pulse"], 2.8],
  ["scattered-sparks", "Scattered sparks", "source-open", "scatter", 950, .93, 188, .86, .62, .13, .004, .09, ["metal", "pulse", "glass", "metal", "wire"], 3.1],
];
// Camera choices belong to full scenes; omitted entries retain the palm view.
const PRESET_VIEWS = {
  "reed-beckon": { yaw: -.65, pitch: .12, zoom: 1.05 },
  "wire-roll": { yaw: .75, pitch: -.12, zoom: 1.06 },
  "pinch-sparks": { yaw: -.9, pitch: .2, zoom: 1.15 },
  "flourish-copper": { yaw: .45, pitch: -.3, zoom: .88 },
  "low-claw": { yaw: 1.18, pitch: .15, zoom: 1 },
  "hushed-palm": { yaw: -.15, pitch: .16, zoom: .92 },
  "point-transmission": { yaw: -1.1, pitch: .06, zoom: 1.05 },
  "closed-bell": { yaw: .9, pitch: .25, zoom: 1.12 },
  "vowel-opposition": { yaw: -.7, pitch: .13, zoom: 1.1 },
  "metal-drumming": { yaw: 1.08, pitch: -.28, zoom: 1 },
  "bowed-eight": { yaw: 2.5, pitch: -.08, zoom: .92 },
  "metal-walk": { yaw: -1.15, pitch: .15, zoom: 1.06 },
  "tangled-polyrhythm": { yaw: -.45, pitch: .25, zoom: .9 },
  "swarming-fingers": { yaw: 1.32, pitch: .05, zoom: .88 },
  "orbit-frenzy": { yaw: -2.2, pitch: -.12, zoom: .82 },
  "scattered-sparks": { yaw: .7, pitch: .34, zoom: .92 },
};
const PRESET_TREMORS = {
  "reed-beckon": { finger: "thumb", joint: "knuckle", amount: 2.2, rate: 4.7 },
  "glass-wave": { finger: "all", joint: "tip", amount: 1.6, rate: 5.8 },
  "bowed-spiral": { finger: "alternating", joint: "whole", amount: 1.9, rate: 6.4 },
  "vowel-opposition": { finger: "index", joint: "middle", amount: 3.2, rate: 7.8 },
  "metal-drumming": { finger: "ring", joint: "tip", amount: 4, rate: 13 },
  "bowed-eight": { finger: "all", joint: "tip", amount: 1.2, rate: 5.2 },
  "tangled-polyrhythm": { finger: "alternating", joint: "whole", amount: 2.8, rate: 17 },
  "swarming-fingers": { finger: "alternating", joint: "tip", amount: 6.2, rate: 27 },
  "orbit-frenzy": { finger: "all", joint: "wrist", amount: 4.5, rate: 12 },
  "scattered-sparks": { finger: "little", joint: "middle", amount: 8, rate: 33 },
};
const PRESET_APPEARANCES = {
  "glass-wave": { skin: "porcelain", lighting: "cool" },
  "reed-beckon": { skin: "natural", lighting: "warm" },
  "wire-roll": { skin: "copper", lighting: "studio" },
  "pinch-sparks": { skin: "cyan", lighting: "neon" },
  "counting-air": { skin: "violet", lighting: "soft" },
  "flourish-copper": { skin: "copper", lighting: "warm" },
  "low-claw": { skin: "jade", lighting: "noir" },
  "hushed-palm": { skin: "porcelain", lighting: "soft" },
  "point-transmission": { skin: "cyan", lighting: "cool" },
  "closed-bell": { skin: "porcelain", lighting: "warm" },
  "tangled-polyrhythm": { skin: "jade", lighting: "neon" },
  "swarming-fingers": { skin: "violet", lighting: "cool" },
  "orbit-frenzy": { skin: "cyan", lighting: "neon" },
  "scattered-sparks": { skin: "copper", lighting: "noir" },
};
const PRESET_ROTATION_FX = {
  "glass-wave": .68, "reed-beckon": .42, "wire-roll": .76, "pinch-sparks": .54,
  "counting-air": .38, "flourish-copper": .92, "low-claw": .34, "hushed-palm": .28,
  "point-transmission": .81, "slow-unfurl": .57, "closed-bell": .18, "little-machinery": .72,
  "original-grasp": .65, "breathing-hand": .31, "bowed-spiral": .86, "vowel-opposition": .46,
  "metal-drumming": .61, "bowed-eight": .78, "vowel-fan": .43, "metal-walk": .74,
  "tangled-polyrhythm": .88, "swarming-fingers": .71, "orbit-frenzy": 1, "scattered-sparks": .83,
};
export const HAND_PRESETS = freeze(PRESET_DEFINITIONS.map(([id, label, poseId, motionId, tempo, amount, rootHz, brightness, roughness, space, attack, release, sources, speed = 1], index) => ({
  id, label, snapshot: normalizeHandConfig({
    pose: HAND_POSES.find(p => p.id === poseId).pose, view: PRESET_VIEWS[id],
    tremor: PRESET_TREMORS[id], appearance: PRESET_APPEARANCES[id],
    motion: { id: motionId, tempo, amount, speed }, sound: { rootHz, brightness, roughness, space, rotationFx: PRESET_ROTATION_FX[id], attack, release },
    voices: sources.map((source, i) => ({ source, level: source === "air" ? .43 : .56 + ((index + i) % 4) * .085, mute: false, solo: false })),
  }),
})));
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
    joint: TREMOR_JOINTS[Math.floor(unit() * TREMOR_JOINTS.length)], amount: between(0, 15), rate: .5 * 80 ** unit() };
  next.appearance = { skin: HAND_SKINS[Math.floor(unit() * HAND_SKINS.length)], lighting: HAND_LIGHTINGS[Math.floor(unit() * HAND_LIGHTINGS.length)] };
  next.motion = { id: HAND_MOTIONS[Math.floor(unit() * HAND_MOTIONS.length)].id, tempo: between(20, 1100), amount: unit(), speed: .1 * 40 ** unit() };
  next.sound = { rootHz: 35 * (1000 / 35) ** unit(), brightness: unit(), roughness: unit(), space: unit(), rotationFx: unit(),
    attack: .004 * 300 ** unit(), release: .04 * 87.5 ** unit() };
  if (next.voices.every(v => v.mute)) next.voices[Math.floor(unit() * 5)].mute = false;
  return normalizeHandConfig(next);
}
