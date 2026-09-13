import { createSpiderWeb, projectSpiderWebInto as projectInto, spiderWebHeight } from './spider-synth-web.js?v=4c83d761d89b';
export { createSpiderWeb, projectSpiderWebPoint, normalizeSpiderWeb, SPIDER_WEB_PRESETS, SPIDER_WEB_PARAMETERS } from './spider-synth-web.js?v=4c83d761d89b';
/**
 * Shared audio-clock web contacts and authored spider gestures.
 * Coordinates are web-radius units, Y up, Z forward; rotations are radians.
 * This is a bounded performance model, not a biological locomotion simulation.
 */
const TAU = Math.PI * 2;
const SEGMENTS = Object.freeze(['hip', 'knee', 'ankle', 'tip']);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = value => value * value * (3 - 2 * value);
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const timeOf = value => clamp(finite(value), 0, 1e9);
const tempoOf = motion => clamp(finite(motion?.tempo, 108), 20, 300);
const intensityOf = motion => clamp(finite(motion?.intensity, .65), 0, 1);
const freeze = object => {
  for (const value of Object.values(object)) if (value && typeof value === 'object') freeze(value);
  return Object.freeze(object);
};

const jointRecords = [
  ['cephalothorax', 'Head / thorax', 'cephalothorax'], ['abdomen', 'Abdomen', 'abdomen'],
  ['pedipalp_left', 'Left palp', 'pedipalps'], ['pedipalp_right', 'Right palp', 'pedipalps'],
  ['chelicera_left', 'Left fang', 'chelicerae'], ['chelicera_right', 'Right fang', 'chelicerae'],
].map(([id, name, groupId]) => ({ id, jointId: id, name, groupId }));
for (const side of ['left', 'right']) for (let leg = 1; leg <= 4; leg += 1) {
  for (const segment of SEGMENTS) {
    const id = `leg_${side}_${leg}_${segment}`;
    jointRecords.push({ id, jointId: id, name: `${side === 'left' ? 'Left' : 'Right'} leg ${leg} ${segment}`, groupId: 'legs', side, leg, segment });
  }
}
export const SPIDER_JOINTS = freeze(jointRecords);
const JOINT_INDEX = new Map(SPIDER_JOINTS.map((joint, index) => [joint.id, index]));
const LIMITS = freeze({ cephalothorax: [.3, .48, .28], abdomen: [.4, .38, .38], pedipalps: [.75, .7, .65], chelicerae: [.48, .4, .4], hip: [.65, .7, .65], knee: [.7, .55, .65], ankle: [.6, .6, .65], tip: [.55, .55, .55] });

function preset(id, label, mode, period, duty, mask, travel, lift, twist, flavor) {
  const locomotion = ['crawl', 'side', 'back', 'circle', 'shuffle'].includes(mode) && travel > 0;
  const path = !locomotion ? 'hold' : mode === 'circle' ? 'orbit' : mode === 'side' ? 'radial' : mode === 'back' ? 'patrol' : period <= 1 ? 'radial' : period >= 8 ? 'patrol' : 'figure8';
  const speed = !locomotion ? .65 : period <= 1 ? 1.8 : period >= 8 ? .25 : mode === 'side' ? .75 : 1;
  return { id, label, mode, period, duty, mask, travel, lift, twist, flavor, loopBeats: 24, world: { path, speed, range: locomotion ? period >= 8 ? .35 : .52 : .4 }, direction: mode === 'back' ? 'backward' : mode === 'side' ? 'sideways' : 'forward' };
}
export const SPIDER_MOTION_PRESETS = freeze([
  { ...preset('orb-walk', 'Orb walk', 'crawl', 2, .78, 255, .7, .034, .08, 0), gait: 'ripple' },
  preset('cross-pluck', 'Cross pluck', 'pluck', 2, .66, 17, 0, .075, .1, 1),
  preset('tiptoe', 'Silk tiptoe', 'crawl', 4, .78, 255, .3, .045, .035, 2),
  preset('web-waltz', 'Web waltz', 'dance', 3, .66, 255, .15, .055, .18, 3),
  preset('listen', 'Listening glass', 'listen', 4, 1, 0, 0, 0, .06, 4),
  preset('radial-run', 'Radial run', 'crawl', 1, .58, 255, 1, .025, .045, 5),
  preset('abdomen-drum', 'Belly drummer', 'drum', 2, .65, 136, 0, .035, .035, 6),
  preset('side-step', 'Sideways silk', 'side', 2, .7, 255, .55, .034, .04, 7),
  preset('silk-harp', 'Silk harp', 'pluck', 4, .55, 51, 0, .065, .04, 8),
  preset('slow-stalk', 'Velvet stalk', 'crawl', 8, .82, 255, .25, .018, .04, 9),
  preset('front-wave', 'Hello, little fly', 'wave', 4, .3, 1, 0, .095, .09, 10),
  preset('spiral-dance', 'Spiral dance', 'dance', 2, .62, 255, .3, .065, .22, 11),
  preset('backpedal', 'Reverse weave', 'back', 2, .68, 255, .6, .025, .065, 12),
  preset('palp-talk', 'Silken gossip', 'talk', 4, 1, 0, 0, 0, .045, 13),
  preset('anchor-rock', 'Anchor rock', 'rock', 4, 1, 0, 0, 0, .075, 14),
  preset('triplet-pluck', 'Three-string answer', 'pluck', 3, .66, 19, 0, .075, .07, 15),
  preset('freeze-peek', 'Freeze and peek', 'peek', 8, .86, 17, 0, .035, .12, 16),
  preset('leg-fan', 'Eight-legged fan', 'fan', 4, .6, 51, 0, .075, .09, 17),
  preset('tap-dance', 'Tiny tap shoes', 'dance', 1, .65, 255, 0, .04, .14, 18),
  preset('web-tremolo', 'Web tremolo', 'pluck', .5, .6, 17, 0, .018, .025, 19),
  preset('creep-circle', 'Circle creep', 'circle', 4, .72, 255, .5, .035, .16, 20),
  preset('threat-pose', 'Velvet warning', 'threat', 8, 1, 0, 0, 0, .04, 21),
  preset('quiet-clean', 'Polished palps', 'clean', 4, .45, 16, 0, .065, .03, 22),
  preset('spinneret-sway', 'Spinneret sway', 'silk', 4, 1, 0, 0, 0, .1, 23),
  { ...preset('wave-walk', 'Traveling wave', 'crawl', 4, .88, 255, .35, .035, .025, 24), gait: 'wave' },
  { ...preset('ripple-run', 'Ripple runner', 'crawl', 2, .76, 255, .8, .035, .05, 25), gait: 'ripple' },
  preset('low-sprint', 'Low silk sprint', 'crawl', .4, .62, 255, .7, .018, .025, 26),
  preset('pushups', 'Silk push-ups', 'pushup', 4, 1, 0, 0, 0, .02, 27),
  { ...preset('web-jump', 'Safety-line jump', 'jump', 4, .72, 255, 0, .14, .02, 28), support: 'airborne', gait: 'together' },
  { ...preset('long-leap', 'Long silk leap', 'leap', 8, .72, 255, .3, .22, .04, 29), support: 'airborne', gait: 'together' },
  { ...preset('tether-bounce', 'Tether bounce', 'bounce', 2, .68, 255, 0, .12, .03, 30), support: 'tethered', gait: 'together' },
  { ...preset('rollover', 'Silk somersault', 'roll', 8, .65, 255, 0, .12, .02, 31), support: 'tethered', gait: 'together' },
  { ...preset('macarena', 'Eight-arm Macarena', 'macarena', 4, .35, 51, 0, .075, .12, 32), gait: 'ripple' },
  preset('disco', 'Disco spider', 'disco', 2, .64, 255, .1, .05, .18, 33),
  preset('moonwalk', 'Silken moonwalk', 'back', 2, .75, 255, .65, .022, .08, 34),
  { ...preset('circle-patrol', 'Circle patrol', 'circle', .5, .76, 255, .35, .03, 0, 35), gait: 'ripple', turnsPerLoop: 1 },
  preset('prey-pounce', 'Pounce and pin', 'pounce', 4, .7, 51, .15, .09, .06, 36),
  preset('silk-reel', 'Reel the silk', 'reel', 2, .6, 136, 0, .045, .07, 37),
  { ...preset('stutter-step', 'Stop-start shuffle', 'shuffle', 2, .8, 255, .45, .05, .09, 38), gait: 'ripple' },
  preset('palp-boxing', 'Tiny shadow boxer', 'box', 2, .7, 17, 0, .08, .11, 39),
]);
const PRESET_BY_ID = new Map(SPIDER_MOTION_PRESETS.map(item => [item.id, item]));
const STILL = freeze(preset('none', 'Held pose', 'still', 4, 1, 0, 0, 0, 0, 0));
const presetOf = motion => motion?.preset === 'none' ? STILL : PRESET_BY_ID.get(motion?.preset) || SPIDER_MOTION_PRESETS[0];
export const SPIDER_MOTION_DEFAULTS = freeze({ preset: 'orb-walk', tempo: 108, intensity: .65, explore: true, seed: 1, center: { x: 0, z: 0 }, yaw: 0, offsets: {} });

export function normalizeSpiderMotion(settings = {}) {
  const offsets = {};
  for (const joint of SPIDER_JOINTS) {
    const value = settings.offsets?.[joint.id];
    if (!value) continue;
    const limits = LIMITS[joint.segment || joint.groupId];
    offsets[joint.id] = { x: clamp(finite(value.x), -limits[0], limits[0]), y: clamp(finite(value.y), -limits[1], limits[1]), z: clamp(finite(value.z), -limits[2], limits[2]) };
  }
  return { preset: presetOf(settings).id, tempo: tempoOf(settings), intensity: intensityOf(settings), explore: settings.explore !== false, seed: finite(settings.seed, 1) >>> 0, center: { x: clamp(finite(settings.center?.x), -.42, .42), z: clamp(finite(settings.center?.z), -.42, .42) }, yaw: clamp(finite(settings.yaw), -Math.PI, Math.PI), offsets };
}
function randomGenerator(seed) {
  let state = finite(seed, 1) >>> 0;
  return () => { state = (state + 0x6d2b79f5) | 0; let v = Math.imul(state ^ state >>> 15, state | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61); return ((v ^ v >>> 14) >>> 0) / 4294967296; };
}
export function createRandomSpiderMotion(seed = 1, base = {}) {
  const random = randomGenerator(seed);
  const item = SPIDER_MOTION_PRESETS[Math.floor(random() * SPIDER_MOTION_PRESETS.length)];
  const motion = normalizeSpiderMotion({ ...base, seed, preset: item.id, intensity: .45 + random() * .55, yaw: (random() - .5) * .6, offsets: createSpiderStaticPose('random', seed) });
  motion.world = { path: item.world.path === 'hold' ? 'hold' : ['orbit', 'figure8', 'radial', 'patrol', 'random'][Math.floor(random() * 5)], speed: .25 + random() * 1.75, range: .25 + random() * .5 };
  return motion;
}

export const SPIDER_STATIC_POSES = freeze([
  ['neutral', 'Resting on silk'], ['crouch', 'Low and patient'], ['alert', 'Something moved'], ['wide', 'Wide embrace'],
  ['narrow', 'Needle stance'], ['left-pluck', 'Left string'], ['right-pluck', 'Right string'], ['harp', 'Harpist'],
  ['bow', 'Velvet bow'], ['peek', 'Curious peek'], ['warning', 'Tiny warning'], ['palps', 'Folded palps'],
  ['fangs', 'Little fangs'], ['silk', 'Silk maker'], ['diagonal', 'Diagonal grip'], ['random', 'Strange posture'],
].map(([id, label]) => ({ id, label })));
export function createSpiderStaticPose(id = 'neutral', seed = 1) {
  const offsets = {};
  if (id === 'neutral' || !SPIDER_STATIC_POSES.some(item => item.id === id)) return offsets;
  const random = randomGenerator(seed);
  for (let index = 0; index < SPIDER_JOINTS.length; index += 1) {
    const joint = SPIDER_JOINTS[index];
    const side = joint.side === 'left' || index === 2 || index === 4 ? -1 : 1;
    let x = 0; let y = 0; let z = 0;
    if (id === 'random') { x = (random() - .5) * .36; y = (random() - .5) * .42; z = (random() - .5) * .32; }
    else if (joint.groupId === 'legs') {
      const proximal = joint.segment === 'hip';
      if (id === 'crouch') { x = proximal ? .18 : -.16; z = side * .11; }
      if (id === 'alert') { x = proximal ? -.12 : .15; y = side * .08; }
      if (id === 'wide') { z = side * .28; y = side * .12; }
      if (id === 'narrow') { z = -side * .24; x = -.1; }
      if ((id === 'left-pluck' && side < 0 || id === 'right-pluck' && side > 0 || id === 'harp') && joint.leg <= 2) { x = .28; y = side * .24; z = side * .14; }
      if (id === 'warning' && joint.leg === 1) { x = -.32; z = side * .25; }
      if (id === 'diagonal') { x = .17 * (joint.leg % 2 ? side : -side); y = side * .12; }
    } else {
      if (id === 'bow') x = index === 0 ? .22 : -.12;
      if (id === 'peek') { y = index === 0 ? -.28 : .08; z = -.08; }
      if (id === 'alert' || id === 'warning') x = index === 0 ? -.14 : .16;
      if (id === 'palps' && joint.groupId === 'pedipalps') { x = .45; y = -side * .3; }
      if (id === 'fangs' && joint.groupId === 'chelicerae') { x = .3; z = side * .28; }
      if (id === 'silk' && index === 1) { x = -.28; y = .18; z = .15; }
    }
    if (x || y || z) offsets[joint.id] = { x, y, z };
  }
  return offsets;
}

export function constrainSpiderPose(pose, joints = SPIDER_JOINTS, out = pose) {
  const count = Math.min(joints.length, Math.floor(out.length / 3));
  for (let index = 0; index < count; index += 1) {
    const joint = joints[index];
    const standard = SPIDER_JOINTS[JOINT_INDEX.get(joint.id || joint.jointId) ?? index];
    const limits = LIMITS[joint.segment || joint.groupId] || LIMITS[standard?.segment || standard?.groupId] || LIMITS.cephalothorax;
    for (let axis = 0; axis < 3; axis += 1) out[index * 3 + axis] = clamp(finite(pose[index * 3 + axis]), -limits[axis], limits[axis]);
  }
  return out;
}

/** Intentional musical scaling: effective wave speed 18 web-units/s at tension1.
 * The shorter of the two toe-divided lengths determines this voiced mode;
 * near-end contacts and extreme inputs are bounded to a useful 45–6000 Hz.
 */
export function spiderStringFrequency(segmentLength, tension = 1, position = .5) {
  const length = clamp(finite(segmentLength, .1), .001, 4);
  const u = clamp(finite(position, .5), .025, .975);
  return clamp(9 * Math.sqrt(clamp(finite(tension, 1), .2, 4)) / (length * Math.min(u, 1 - u)), 45, 6000);
}

function footPhase(beat, item, index, intensity, out) {
  const active = intensity > 0 && (item.mask & (1 << index)) !== 0 && item.duty < 1;
  // Complementary tetrapods: L1/L3/R2/R4, then L2/L4/R1/R3.
  const offset = item.gait === 'together' ? 0 : item.gait === 'wave' ? index / 8 : item.gait === 'ripple' ? (index % 4) / 4 : ((index < 4 ? index : index + 1) & 1) * .5;
  const cycle = beat / item.period + offset;
  const step = Math.floor(cycle + 1e-10);
  const phase = Math.max(0, cycle - step);
  out.step = active ? step : 0; out.phase = active ? phase : 0; out.stance = !active || phase < item.duty;
  out.touchBeat = active ? (step - offset) * item.period : 0;
  out.nextBeat = active ? (step + 1 - offset) * item.period : 0;
  out.swing = out.stance ? 0 : (phase - item.duty) / (1 - item.duty);
  return out;
}

function bodyAt(beat, motion, item, intensity, out, web, travel) {
  const a = TAU * beat / 24;
  const phase = (finite(motion?.seed, 1) % 97) / 97 * TAU;
  const exploration = motion?.explore === false ? 0 : item.travel * .095 * intensity;
  let dx = exploration * Math.sin(a); let dz = exploration * Math.sin(a * 2) * .55;
  if (item.mode === 'side') { dx = exploration * Math.sin(a * 2); dz = 0; }
  if (item.mode === 'back') dz = -exploration * Math.sin(a);
  if (item.mode === 'circle') { dx = exploration * Math.sin(a); dz = exploration * (Math.cos(a) - 1) * .5; }
  let cx = clamp(finite(motion?.center?.x), -.78, .78); let cz = clamp(finite(motion?.center?.z), -.78, .78);
  const radius = Math.hypot(cx, cz); if (radius > .78) { cx *= .78 / radius; cz *= .78 / radius; }
  out.x = cx + dx; out.z = cz + dz;
  out.y = .06 + intensity * (item.mode === 'crawl' || item.mode === 'back' ? -.006 : .004 * Math.sin(TAU * beat / item.period));
  out.yaw = clamp(finite(motion?.yaw), -Math.PI, Math.PI) + item.twist * intensity * Math.sin(a + phase);
  // A full turn uses short overlapping steps; each supported toe still holds
  // its touchdown position while the body turns through the next small arc.
  if (item.turnsPerLoop && intensity > 0) out.yaw += mod(beat / item.loopBeats, 1) * TAU * item.turnsPerLoop;
  out.pitch = item.mode === 'threat' ? -.11 * intensity : .025 * intensity * Math.sin(TAU * beat / 4 + item.flavor);
  out.roll = (item.mode === 'rock' ? .12 : .035) * intensity * Math.sin(TAU * beat / (item.mode === 'dance' ? 3 : 8));
  if (item.mode === 'still') { out.y = .06; out.pitch = 0; out.roll = 0; }
  if (item.mode === 'pushup') out.y = .045 + .035 * intensity * (.5 + .5 * Math.cos(TAU * beat / 4));
  if (item.mode === 'disco') { out.roll = .14 * intensity * Math.sin(TAU * beat / 2); out.pitch = .08 * intensity * Math.cos(TAU * beat / 4); }
  if (item.mode === 'macarena') out.yaw += .14 * intensity * Math.sin(TAU * beat / 8);
  if (web) out.y += spiderWebHeight(web, out.x, out.z);
  if (travel) {
    travel.writeTravel(travel.queryClock === null ? beat * 60 / tempoOf(motion) + travel.frameClockOffset : travel.queryClock, travel.modelPoint, travel.anchorQuery ? travel.anchorCutoff : Infinity);
    out.x += travel.modelPoint.x; out.z += travel.modelPoint.z;
    const travelRadius = Math.hypot(out.x, out.z); if (travelRadius > .58) { out.x *= .58 / travelRadius; out.z *= .58 / travelRadius; }
    // Travel heading is fixed in each command segment: stance does not orbit.
    out.yaw += travel.modelPoint.yaw;
    if (web) out.y += spiderWebHeight(web, out.x, out.z) - spiderWebHeight(web, out.x - travel.modelPoint.x, out.z - travel.modelPoint.z);
  }
  return out;
}

function writeLegPose(beat, item, intensity, leg, out, start = 0) {
  if (item.mode === 'still' || intensity <= 0) { for (let i = start; i < start + 12; i += 1) out[i] = 0; return; }
  const pulse = TAU * beat / item.period;
  const side = leg < 4 ? -1 : 1; const phase = pulse + (((leg < 4 ? leg : leg + 1) & 1) ? Math.PI : 0);
  const active = (item.mask & (1 << leg)) !== 0;
  for (let segment = 0; segment < 4; segment += 1) {
    const i = start + segment * 3;
    const amount = active ? .045 + item.lift * 1.5 : .018;
    out[i] = intensity * amount * Math.sin(phase + segment * .25);
    out[i + 1] = side * intensity * amount * .6 * Math.cos(phase);
    out[i + 2] = side * intensity * .025 * Math.sin(TAU * beat / 8 + leg);
    if (item.mode === 'macarena' && leg % 4 < 2) { out[i] += .23 * intensity * Math.sin(pulse + leg * 1.3); out[i + 1] += side * .23 * intensity * Math.cos(pulse * .5 + segment); }
    if (item.mode === 'box' && leg % 4 === 0) out[i] += .25 * intensity * Math.sin(pulse * 2 + side);
    if (item.mode === 'fan') out[i + 2] += side * .17 * intensity * Math.sin(pulse + leg * .4);
    if (item.mode === 'threat' && leg % 4 === 0) out[i] -= intensity * .22;
  }
}

function writePose(time, motion, out, offsets) {
  const beat = timeOf(time) * tempoOf(motion) / 60; const item = presetOf(motion); const intensity = intensityOf(motion);
  const pulse = TAU * beat / item.period; const wave = Math.sin(pulse); const slow = Math.sin(TAU * beat / 8);
  out.fill(0);
  if (item.mode !== 'still' && intensity > 0) {
    out[0] = .045 * intensity * wave; out[1] = .065 * intensity * Math.sin(TAU * beat / 8 + item.flavor); out[2] = .035 * intensity * slow;
    out[3] = .07 * intensity * Math.sin(pulse + .7); out[4] = .045 * intensity * slow; out[5] = -.04 * intensity * wave;
    if (item.mode === 'drum' || item.mode === 'silk') { out[3] = .2 * intensity * Math.sin(pulse * 2); out[5] = .17 * intensity * slow; }
    if (item.mode === 'listen' || item.mode === 'peek') { out[0] = -.05 * intensity; out[1] = .23 * intensity * slow; out[2] = .11 * intensity * Math.sin(TAU * beat / 12); }
    if (item.mode === 'rock') { out[2] = .19 * intensity * slow; out[5] = -.22 * intensity * slow; }
    if (item.mode === 'threat') { out[0] = -.2 * intensity; out[3] = .16 * intensity; }
    for (let index = 2; index < 6; index += 1) {
      const side = index % 2 ? 1 : -1; const fast = item.mode === 'talk' ? 3 : item.mode === 'clean' ? 2 : 1;
      out[index * 3] = intensity * (index < 4 ? .14 : .045) * Math.sin(pulse * fast + index * .7);
      out[index * 3 + 1] = side * intensity * (item.mode === 'talk' || item.mode === 'clean' ? .19 : .055) * (.5 + .5 * Math.sin(pulse * fast + .8));
    }
    for (let leg = 0; leg < 8; leg += 1) writeLegPose(beat, item, intensity, leg, out, (6 + leg * 4) * 3);
  }
  if (offsets) for (let index = 0; index < SPIDER_JOINTS.length; index += 1) {
    const value = motion?.offsets?.[SPIDER_JOINTS[index].id];
    if (value) { out[index * 3] += finite(value.x); out[index * 3 + 1] += finite(value.y); out[index * 3 + 2] += finite(value.z); }
  }
  return constrainSpiderPose(out);
}
export function writeSpiderPose(time, motion = SPIDER_MOTION_DEFAULTS, out = new Float32Array(114)) { return writePose(time, motion, out, true); }

// Geometry constants below are extracted from the authored CC0 scan rig.json.
// Keep each chain's asymmetric length; particularly short third legs must not
// inherit the front legs' reach. They are not measured biological joint lengths.
const LEG_DATA = [{"id":"leg_left_1","hip":[-0.028999999999999998,-0.008,0.027999999999999997],"tip":[-0.18152625678146816,-0.08133799296441671,0.37022828639823285],"lengths":[0.29287096768969606,0.07019223075724654,0.05636722713421957,0.04210482543238473]},{"id":"leg_left_2","hip":[-0.033,-0.01,0.008999999999999998],"tip":[-0.2594274268285054,-0.0980544765457922,0.19580138155069687],"lengths":[0.15952369469558758,0.15094979360165484,0.09242697039403498,0.040940162626625344]},{"id":"leg_left_3","hip":[-0.033999999999999996,-0.01,-0.012],"tip":[-0.1744725624331153,-0.01479762527681694,-0.2301299117148901],"lengths":[0.0805643961434649,0.10933295587907976,0.055657019405965326,0.02516213183185387]},{"id":"leg_left_4","hip":[-0.028,-0.01,-0.03],"tip":[-0.09058521322903704,-0.12391606722533197,-0.4222173167853169],"lengths":[0.17505455014796373,0.13593106816632802,0.09239121476077286,0.04054629857169566]},{"id":"leg_right_1","hip":[0.028999999999999998,-0.008,0.027999999999999997],"tip":[0.08068319974943625,-0.13605032970107517,0.31947184342565577],"lengths":[0.28330544359600834,0.07013490516814175,0.05545798507459013,0.04011745889279488]},{"id":"leg_right_2","hip":[0.033,-0.01,0.008999999999999998],"tip":[0.15494292382780317,-0.16444708528596944,0.23728675501783783],"lengths":[0.157070639338727,0.1559204134672031,0.09190734982471384,0.04042079699761992]},{"id":"leg_right_3","hip":[0.033999999999999996,-0.01,-0.012],"tip":[0.23709051640080167,-0.013819192487094054,-0.19110928895549073],"lengths":[0.0836505664138107,0.11379697198604838,0.0572018028635017,0.02578615249075577]},{"id":"leg_right_4","hip":[0.028,-0.01,-0.03],"tip":[0.1416698662873986,-0.14681983228387752,-0.4122490041543284],"lengths":[0.2713705663669329,0.06283295164827087,0.0648014945397351,0.039526316917982314]}];
export const SPIDER_LEG_GEOMETRY = freeze(LEG_DATA.map(leg => {
  const reach = leg.lengths.reduce((sum, length) => sum + length, 0);
  const dx = leg.tip[0] - leg.hip[0]; const dz = leg.tip[2] - leg.hip[2]; const length = Math.hypot(dx, dz);
  return { ...leg, reach, innerReach: Math.max(0, Math.max(...leg.lengths) * 2 - reach), neutral: [leg.hip[0] + dx / length * reach * .68, 0, leg.hip[2] + dz / length * reach * .68] };
}));

export function createSpiderFrame() {
  const frame = { time: 0, body: { x: 0, y: .06, z: 0, yaw: 0, pitch: 0, roll: 0 }, feet: Array.from({ length: 8 }, (_, legIndex) => ({ id: SPIDER_JOINTS[9 + legIndex * 4].id, legIndex, x: 0, y: 0, z: 0, segmentId: 0, u: .5, stance: true, step: 0, impact: 0, speed: 0, angle: 0 })), pose: new Float32Array(114), beat: 0, beatIndex: 0, bar: 0, phase: 0, supportCount: 8, airborne: false, tethered: false, motionActive: true, contactEpoch: 0 };
  Object.defineProperty(frame, '_scratch', { value: { base: new Float32Array(114), anchorBase: new Float32Array(12), body: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }, phase: { step: 0, phase: 0, stance: true, touchBeat: 0, nextBeat: 0, swing: 0 }, a: { x: 0, y: 0, z: 0, segmentId: 0, u: 0, distance: 0 }, b: { x: 0, y: 0, z: 0, segmentId: 0, u: 0, distance: 0 } } });
  return frame;
}

function anchoredOffset(base, manual, midi, limit) {
  // Match writeSpiderPose -> MIDI applyPose, including their separate clamps
  // and Float32 storage. Opposing MIDI can pull a saturated manual pose inward.
  const manualPose = Math.fround(clamp(Math.fround(base + finite(manual)), -limit, limit));
  return Math.fround(clamp(Math.fround(manualPose + finite(midi)), -limit, limit)) - base;
}

/** Local foot-target overlay, evaluated against its touchdown pose. The raw
 * MIDI layer remains separate so saturated held controls cannot inherit the
 * changing procedural pose. Caller supplies reusable output and scratch. */
export function writeSpiderLegOffset(legIndex, touchTime, motion, pose, midiOffsets, out, scratch) {
  const beat = timeOf(touchTime) * tempoOf(motion) / 60; const item = presetOf(motion); const intensity = intensityOf(motion);
  writeLegPose(beat, item, intensity, legIndex, scratch);
  const side = legIndex < 4 ? -1 : 1; let dx = 0; let dz = 0;
  for (let segment = 0; segment < 4; segment += 1) {
    const index = 6 + legIndex * 4 + segment; const i = index * 3; const k = segment * 3; const weight = .024 / (1 + segment * .45);
    const manual = motion?.offsets?.[SPIDER_JOINTS[index].id]; const limits = LIMITS[SEGMENTS[segment]];
    let px; let py; let pz;
    if (midiOffsets) {
      px = anchoredOffset(scratch[k], manual?.x, midiOffsets[i], limits[0]);
      py = anchoredOffset(scratch[k + 1], manual?.y, midiOffsets[i + 1], limits[1]);
      pz = anchoredOffset(scratch[k + 2], manual?.z, midiOffsets[i + 2], limits[2]);
    } else { px = finite(manual?.x); py = finite(manual?.y); pz = finite(manual?.z); }
    dx += weight * (py + side * pz * .8 + side * px * .32); dz += weight * (px - py * side * .35 + pz * .5);
  }
  out.x = clamp(dx, -.055, .055); out.z = clamp(dz, -.055, .055); return out;
}

function anchor(beat, motion, item, intensity, web, legIndex, pose, base, body, out, midiPoseOffsets, anchorBase, travel) {
  bodyAt(beat, motion, item, intensity, body, web, travel);
  const geometry = SPIDER_LEG_GEOMETRY[legIndex]; const side = legIndex < 4 ? -1 : 1;
  let x = geometry.neutral[0]; let z = geometry.neutral[2];
  // Only the local overlay is applied here: procedural rotations are represented
  // by the analytic target itself. This keeps held stance anchors stationary.
  if (midiPoseOffsets) writeLegPose(beat, item, intensity, legIndex, anchorBase);
  let dx = 0; let dz = 0;
  for (let segment = 0; segment < 4; segment += 1) {
    const i = (6 + legIndex * 4 + segment) * 3; const weight = .024 / (1 + segment * .45);
    let px = pose[i] - base[i]; let py = pose[i + 1] - base[i + 1]; let pz = pose[i + 2] - base[i + 2];
    if (midiPoseOffsets) {
      // Saturating base(now)+gesture and subtracting base(now) would introduce
      // animation into a held gesture. Clamp the explicit gesture against the
      // touchdown base instead, keeping exactly the same supported anchor.
      const offset = motion?.offsets?.[SPIDER_JOINTS[6 + legIndex * 4 + segment].id];
      const limit = LIMITS[SEGMENTS[segment]]; const k = segment * 3;
      px = anchoredOffset(anchorBase[k], offset?.x, midiPoseOffsets[i], limit[0]);
      py = anchoredOffset(anchorBase[k + 1], offset?.y, midiPoseOffsets[i + 1], limit[1]);
      pz = anchoredOffset(anchorBase[k + 2], offset?.z, midiPoseOffsets[i + 2], limit[2]);
    }
    dx += weight * (py + side * pz * .8 + side * px * .32); dz += weight * (px - py * side * .35 + pz * .5);
  }
  x += clamp(dx, -.055, .055); z += clamp(dz, -.055, .055);
  const phase = TAU * beat / item.period;
  if (item.mode === 'pluck' || item.mode === 'fan' || item.mode === 'dance') { x += side * .014 * intensity * Math.sin(phase / 2 + legIndex); z += .016 * intensity * Math.cos(phase / 2 + legIndex); }
  const c = Math.cos(body.yaw); const s = Math.sin(body.yaw);
  const hx = body.x + geometry.hip[0] * c + geometry.hip[2] * s;
  const hz = body.z + geometry.hip[2] * c - geometry.hip[0] * s;
  return projectInto(web, body.x + x * c + z * s, body.z + z * c - x * s, out, hx, hz, geometry.reach * .78, body.y + geometry.hip[1], true, geometry.innerReach + .035);
}

// Optional final argument is the MIDI layer's pre-clamp additive XYZ radians.
// It is separate from pose and owned/reused by the caller, never a custom field
// on a typed array. Existing five-argument diagnostics retain their behavior.
export function writeSpiderFrame(time, motion = SPIDER_MOTION_DEFAULTS, web, out = createSpiderFrame(), pose, midiPoseOffsets, travel) {
  const t = timeOf(time); const tempo = tempoOf(motion); const intensity = intensityOf(motion); const item = presetOf(motion); const beat = t * tempo / 60;
  const scratch = out._scratch;
  const contactItem = travel?.contactItem || item; const contactBeat = travel?.contactItem ? travel.contactBeat : beat; const contactTempo = travel?.contactItem ? travel.contactTempo : tempo;
  if (pose) { if (pose !== out.pose) for (let i = 0; i < 114; i += 1) out.pose[i] = finite(pose[i]); constrainSpiderPose(out.pose); }
  else writePose(t, motion, out.pose, true);
  writePose(t, motion, scratch.base, false);
  out.time = t; out.beat = beat; out.beatIndex = Math.floor(beat + 1e-10); out.bar = Math.floor(out.beatIndex / 4); out.phase = mod(beat, 1);
  bodyAt(beat, motion, item, intensity, out.body, web, travel);
  // The fused front body can rock over fixed toe anchors; IK holds the support.
  out.body.pitch += out.pose[0] * .28; out.body.yaw += out.pose[1] * .2; out.body.roll += out.pose[2] * .28;
  if (travel) travel.anchorQuery = true;
  out.supportCount = 0; out.airborne = false; out.tethered = false;
  for (let index = 0; index < 8; index += 1) {
    const foot = out.feet[index]; const state = footPhase(contactBeat, contactItem, index, travel?.contactItem ? travel.contactIntensity : intensity, scratch.phase);
    let touchBeat = state.touchBeat; let nextBeat = state.nextBeat;
    if (travel?.contactItem) {
      const aClock = state.touchBeat * 60 / contactTempo + travel.contactClockOffset; const bClock = state.nextBeat * 60 / contactTempo + travel.contactClockOffset;
      touchBeat = travel.anchorMotionAdvances ? (aClock - travel.frameClockOffset) * tempo / 60 : beat; nextBeat = travel.anchorMotionAdvances ? (bClock - travel.frameClockOffset) * tempo / 60 : beat;
      travel.queryClock = aClock;
    }
    const a = anchor(touchBeat, motion, item, intensity, web, index, out.pose, scratch.base, scratch.body, scratch.a, midiPoseOffsets, scratch.anchorBase, travel);
    if (travel?.contactItem) travel.queryClock = state.nextBeat * 60 / contactTempo + travel.contactClockOffset;
    const b = anchor(nextBeat, motion, item, intensity, web, index, out.pose, scratch.base, scratch.body, scratch.b, midiPoseOffsets, scratch.anchorBase, travel);
    foot.airborne = false; foot.stance = state.stance; foot.step = state.step; foot.segmentId = a.segmentId; foot.u = a.u;
    const swingTime = contactItem.period * (1 - contactItem.duty) * 60 / contactTempo;
    foot.speed = state.nextBeat === state.touchBeat ? 0 : Math.hypot(b.x - a.x, b.z - a.z, contactItem.lift * intensity * 2) / Math.max(.025, swingTime);
    foot.impact = state.nextBeat === state.touchBeat ? 0 : clamp((.24 + foot.speed * 1.8) * intensity, 0, 1);
    // Angle is the toe's travel direction, not the strand tangent. A vertical
    // in-place lift pulls across the strand and uses its perpendicular instead.
    const dx = b.x - a.x; const dz = b.z - a.z;
    foot.angle = dx * dx + dz * dz > 1e-14 ? Math.atan2(dz, dx) : (web.segments[a.segmentId]?.angle || 0) + Math.PI / 2;
    if (state.stance) { foot.x = a.x; foot.y = a.y; foot.z = a.z; out.supportCount += 1; }
    else { const amount = smooth(state.swing); foot.x = a.x + (b.x - a.x) * amount; foot.z = a.z + (b.z - a.z) * amount; foot.y = a.y + (b.y - a.y) * amount + Math.max(1e-12, contactItem.lift * (travel?.contactItem ? travel.contactIntensity : intensity) * Math.sin(Math.PI * state.swing)); }
  }
  if (travel) travel.anchorQuery = false;
  if (item.support && intensity > 0) {
    const phase = mod(beat / item.period, 1); const airborne = phase >= item.duty;
    out.airborne = airborne; out.tethered = item.support === 'tethered' && airborne;
    if (airborne) {
      const amount = (phase - item.duty) / (1 - item.duty); const height = Math.sin(Math.PI * amount) * item.lift * intensity;
      out.body.y += height;
      if (item.mode === 'roll') out.body.roll += TAU * smooth(amount);
      if (item.mode === 'leap') out.body.pitch += .3 * Math.sin(TAU * amount) * intensity;
      for (const foot of out.feet) { foot.stance = false; foot.airborne = true; foot.impact = 0; }
      out.supportCount = 0;
    }
  }
  return out;
}

export function applySpiderSpeechPose(time, envelope, pose) {
  const amount = clamp(finite(envelope), 0, 1); if (!amount) return pose;
  const t = timeOf(time);
  pose[0] += amount * (.055 + .055 * Math.sin(t * 8.3)); pose[1] += amount * .05 * Math.sin(t * 5.7); pose[2] += amount * .04 * Math.sin(t * 6.1);
  for (let index = 2; index < 6; index += 1) { const side = index % 2 ? 1 : -1; pose[index * 3] += amount * .16 * Math.sin(t * (index < 4 ? 19 : 25) + index); pose[index * 3 + 1] += side * amount * .14 * (.6 + .4 * Math.sin(t * 15 + index)); }
  // Clamp only changed face entries; caller-owned leg and abdomen values are exact.
  for (let index = 0; index < 6; index += 1) if (index !== 1) { const limits = LIMITS[SPIDER_JOINTS[index].groupId]; for (let axis = 0; axis < 3; axis += 1) pose[index * 3 + axis] = clamp(finite(pose[index * 3 + axis]), -limits[axis], limits[axis]); }
  return pose;
}
