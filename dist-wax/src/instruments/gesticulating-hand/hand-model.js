import { sampleSourceGrasp } from "./hand-source-motion.js";

/** Shared choreography and sound mapping. Angles are degrees, time is seconds.
 * The ranges are conservative playable rig limits, not clinical measurements.
 * Slots mcp/pip/dip mean MCP/PIP/DIP on fingers and CMC/MCP/IP on the thumb;
 * thumb spread is basal opposition. Sound is an original artistic mapping.
 */
export const FINGERS = Object.freeze(["thumb", "index", "middle", "ring", "little"]);
export const VOICE_SOURCES = Object.freeze(["glass", "reed", "wire", "pulse", "air"]);
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
  motion: { tempo: [20, 220], amount: [0, 1] },
  sound: { rootHz: [35, 1000], brightness: [0, 1], roughness: [0, 1], space: [0, 1], attack: [.004, 1.2], release: [.04, 3.5] },
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
]);
const DEFAULT_POSE = HAND_POSES.find(pose => pose.id === "source-open").pose;
export const HAND_DEFAULTS = freeze({
  version: 1,
  pose: { fingers: DEFAULT_POSE.fingers.map(f => ({ ...f })), wrist: { ...DEFAULT_POSE.wrist } },
  motion: { id: "source-grasp", tempo: 72, amount: .85 },
  sound: { rootHz: 137, brightness: .46, roughness: .16, space: .28, attack: .045, release: .45 },
  voices: VOICE_SOURCES.map((source, i) => ({ source, level: i === 4 ? .5 : .7, mute: false, solo: false })),
});
export function createHandPose() {
  return { fingers: Array.from({ length: 5 }, () => ({ mcp: 0, pip: 0, dip: 0, spread: 0 })), wrist: { flex: 0, side: 0, twist: 0 } };
}
export function normalizeHandConfig(value = {}) {
  const input = record(value), pose = record(input.pose), wrist = record(pose.wrist), motion = record(input.motion), sound = record(input.sound);
  const next = { version: 1, pose: createHandPose(), motion: {}, sound: {}, voices: [] };
  for (let i = 0; i < 5; i++) {
    const f = record(pose.fingers?.[i]), bounds = i === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger;
    for (const key of ["mcp", "pip", "dip", "spread"]) next.pose.fingers[i][key] = clampHand(f[key], ...bounds[key], HAND_DEFAULTS.pose.fingers[i][key]);
    const v = record(input.voices?.[i]), fallback = HAND_DEFAULTS.voices[i];
    next.voices.push({ source: VOICE_SOURCES.includes(v.source) ? v.source : fallback.source,
      level: clampHand(v.level, 0, 1, fallback.level), mute: v.mute === true, solo: v.solo === true });
  }
  for (const [key, bounds] of Object.entries(HAND_LIMITS.wrist)) next.pose.wrist[key] = clampHand(wrist[key], ...bounds, HAND_DEFAULTS.pose.wrist[key]);
  next.motion.id = HAND_MOTIONS.some(item => item.id === motion.id) ? motion.id : HAND_DEFAULTS.motion.id;
  for (const [key, bounds] of Object.entries(HAND_LIMITS.motion)) next.motion[key] = clampHand(motion[key], ...bounds, HAND_DEFAULTS.motion[key]);
  for (const [key, bounds] of Object.entries(HAND_LIMITS.sound)) next.sound[key] = clampHand(sound[key], ...bounds, HAND_DEFAULTS.sound[key]);
  return next;
}
const smooth = value => { const x = clampHand(value, 0, 1); return x * x * (3 - 2 * x); };
// Reused output objects own their sampler scratch space without serializing it
// into configuration or visible pose data. No allocation after first source use.
const sourceCaches = new WeakMap();
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
 */
export function evaluateHandPose(value = HAND_DEFAULTS, time = 0, out = createHandPose()) {
  const config = record(value), pose = record(config.pose), motion = record(config.motion);
  const id = motion.id, amount = id === "still" ? 0 : clampHand(motion.amount, 0, 1, HAND_DEFAULTS.motion.amount);
  const beats = id === "count" ? 10 : id === "flourish" ? 8 : 4;
  const beat = (clampHand(time, 0, 1e9) * clampHand(motion.tempo, 20, 220, 72) / 60) % beats;
  const phase = beat / beats * TAU;
  out.source = null;
  const source = id === "source-grasp" ? sourceForPose(out, beat / beats, amount) : null;
  for (let i = 0; i < 5; i++) {
    const base = record(pose.fingers?.[i]), f = out.fingers[i], fallback = HAND_DEFAULTS.pose.fingers[i];
    let curl = 0, tip = 0, spread = 0;
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
    const bounds = i === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger;
    f.mcp = clampHand(clampHand(base.mcp, ...bounds.mcp, fallback.mcp) + curl * amount, ...bounds.mcp);
    f.pip = clampHand(clampHand(base.pip, ...bounds.pip, fallback.pip) + tip * amount, ...bounds.pip);
    f.dip = clampHand(clampHand(base.dip, ...bounds.dip, fallback.dip) + (source ? source.fingers[i].dip : tip * .62) * amount, ...bounds.dip);
    f.spread = clampHand(clampHand(base.spread, ...bounds.spread, fallback.spread) + spread * amount, ...bounds.spread);
  }
  const baseWrist = record(pose.wrist);
  let flex = 0, side = 0, twist = 0;
  if (id === "wave") { side = 23 * Math.sin(phase); twist = 14 * Math.sin(phase); flex = 7 * Math.cos(phase); }
  if (id === "beckon") flex = 13 * Math.sin(phase * 2 - .5);
  if (id === "pinch") twist = 12 * Math.sin(phase);
  if (id === "flourish") { flex = 24 * Math.sin(phase); side = 19 * Math.cos(phase); twist = 44 * Math.sin(phase - .5); }
  out.wrist.flex = clampHand(handNumber(baseWrist.flex) + flex * amount, ...HAND_LIMITS.wrist.flex);
  out.wrist.side = clampHand(handNumber(baseWrist.side) + side * amount, ...HAND_LIMITS.wrist.side);
  out.wrist.twist = clampHand(handNumber(baseWrist.twist) + twist * amount, ...HAND_LIMITS.wrist.twist);
  return out;
}
export function createHandVoices() {
  return Array.from({ length: 5 }, () => ({ frequency: 100, brightness: 0, roughness: 0, pan: 0, level: 0, source: "glass", excitation: 0 }));
}
const REGISTER_RATIOS = Object.freeze([.79, 1.19, 1, 1.09, 1.42]);
export function evaluateHandVoices(value = HAND_DEFAULTS, time = 0, out = createHandVoices(), pose = createHandPose(), previous = createHandPose()) {
  const config = record(value), sound = record(config.sound), voices = config.voices;
  evaluateHandPose(config, time, pose); evaluateHandPose(config, Math.max(0, handNumber(time) - .01), previous);
  let solo = false;
  for (let i = 0; i < 5; i++) if (voices?.[i]?.solo === true && voices?.[i]?.mute !== true) solo = true;
  for (let i = 0; i < 5; i++) {
    const f = pose.fingers[i], old = previous.fingers[i], voice = record(voices?.[i]), fallback = HAND_DEFAULTS.voices[i], target = out[i];
    // Continuous exponential bend and deliberately non-scale finger registers.
    target.frequency = clampHand(clampHand(sound.rootHz, 35, 1000, 137) * REGISTER_RATIOS[i]
      * Math.exp(f.mcp * .0122 + pose.wrist.flex * .008 + pose.wrist.twist * .002), 25, 4200);
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
];
export const HAND_PRESETS = freeze(PRESET_DEFINITIONS.map(([id, label, poseId, motionId, tempo, amount, rootHz, brightness, roughness, space, attack, release, sources], index) => ({
  id, label, snapshot: normalizeHandConfig({
    pose: HAND_POSES.find(p => p.id === poseId).pose,
    motion: { id: motionId, tempo, amount }, sound: { rootHz, brightness, roughness, space, attack, release },
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
  next.motion = { id: HAND_MOTIONS[Math.floor(unit() * HAND_MOTIONS.length)].id, tempo: between(20, 220), amount: unit() };
  next.sound = { rootHz: 35 * (1000 / 35) ** unit(), brightness: unit(), roughness: unit(), space: unit(),
    attack: .004 * 300 ** unit(), release: .04 * 87.5 ** unit() };
  if (next.voices.every(v => v.mute)) next.voices[Math.floor(unit() * 5)].mute = false;
  return normalizeHandConfig(next);
}
