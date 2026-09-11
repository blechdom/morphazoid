import { RoachBodyEngine } from './roach-synth-body-engine.js';
import { ROACH_BODY_GROUPS, ROACH_BODY_SOURCES, createDefaultRoachBodyMix, normalizeRoachBodyMix, getRoachJointBodyGroup } from './roach-synth-body.js';
export { ROACH_BODY_GROUPS, ROACH_BODY_SOURCES, createDefaultRoachBodyMix, normalizeRoachBodyMix, getRoachBodyGroupId } from './roach-synth-body.js';
import { normalizeRoachMotion, writeRoachPose, createRoachSceneState, writeRoachSceneState } from './roach-synth-motion.js';

// A held pose has smooth, group-owned resonances. Motion-only sources receive
// only their own joints' actual displacement and the shared six-foot contacts.
// Sound Play never manufactures scuttles, impulses, sample grains or footbeats.
// Spoken KAL16 words remain independent of all body assignments and transports.
const TAU = Math.PI * 2;
const MAX_JOINTS = 128;
const MAX_MAPPINGS = 128;
const MAX_PHONES = 96;
const EMPTY_PHONES = Object.freeze([]);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, finite(value, low)));
const clean = (value) => Number.isFinite(value) && Math.abs(value) > 1e-24 ? value : 0;

export const ROACH_SOUND_DEFAULTS = Object.freeze({
  level: 0.5, hiss: 0.22, shell: 0.46, wing: 0.28, voice: 0.78,
  feet: 0.88, growl: 0.24, drone: 0, zing: .55, samples: .65,
  pitch: 140, vowel: 0.35, brightness: 0.46, resonance: 0.38,
  wingRate: 72, rhythm: 1, crunch: 0.18, pan: 0,
});
const SOUND_RANGES = Object.freeze({
  level: [0, 0.8], hiss: [0, 1], shell: [0, 1], wing: [0, 1], voice: [0, 1],
  feet: [0, 1], growl: [0, 1], drone: [0, 1], zing: [0, 1], samples: [0, 1],
  pitch: [60, 600], vowel: [0, 1], brightness: [0, 1], resonance: [0, 1],
  wingRate: [12, 220], rhythm: [0.25, 4], crunch: [0, 1], pan: [-1, 1],
});
const SOUND_KEYS = Object.freeze(Object.keys(SOUND_RANGES));
const FORMANT_GAINS = Object.freeze([2.8, 1.8, 1.1]);
export function normalizeRoachSound(value = {}) {
  const result = {};
  for (const [key, range] of Object.entries(SOUND_RANGES)) {
    result[key] = clamp(finite(value?.[key], ROACH_SOUND_DEFAULTS[key]), ...range);
  }
  return result;
}
const PATCHES = [
  ['scuttling-shell', 'House in the walls', 140, .38, .55, .14, ['skuttle','walls','rustle','resonance','drone','growl','sub','shimmer']],
  ['spiracle-whisper', 'Breathing plaster', 92, .28, .7, .1, ['walls','hiss','rustle','drone','sub','hiss','resonance','shimmer']],
  ['wing-radio', 'Wing radio', 185, .57, .65, .2, ['skuttle','buzz','rustle','resonance','drone','zing','sub','shimmer']],
  ['tin-carapace', 'Rusting carapace', 235, .53, .8, .36, ['zing','walls','buzz','resonance','sub','growl','drone','shimmer']],
  ['crunchy-orator', 'Crusty orator', 116, .37, .45, .32, ['skuttle','rustle','hiss','resonance','drone','growl','sub','shimmer']],
  ['pitter-patter', 'Wall skitter', 225, .63, .42, .18, ['skuttle','walls','zing','resonance','sub','hiss','drone','shimmer']],
  ['under-fridge', 'Under the fridge', 76, .22, .72, .48, ['walls','rustle','buzz','drone','sub','growl','resonance','hiss']],
  ['modal-carapace', 'Black cavity', 108, .34, .88, .16, ['zing','resonance','shimmer','drone','sub','walls','resonance','shimmer']],
  ['pipe-organism', 'Pipe organism', 98, .3, .79, .12, ['skuttle','zing','rustle','resonance','drone','growl','sub','resonance']],
  ['radiator', 'Behind the radiator', 155, .48, .82, .24, ['walls','zing','buzz','resonance','sub','hiss','drone','shimmer']],
  ['velvet-threat', 'Velvet threat', 83, .24, .62, .09, ['rustle','walls','hiss','drone','sub','growl','resonance','shimmer']],
  ['antenna-static', 'Antenna static', 175, .62, .5, .26, ['skuttle','buzz','rustle','resonance','drone','walls','sub','hiss']],
  ['tiny-alarm', 'Tiny alarm', 265, .57, .66, .23, ['skuttle','zing','buzz','drone','sub','growl','shriek','shimmer']],
  ['floorboard', 'Floorboard tremor', 65, .33, .7, .35, ['walls','rustle','zing','sub','drone','growl','resonance','hiss']],
  ['ghost-shell', 'Ghost shell', 122, .44, .94, .07, ['rustle','resonance','shimmer','drone','sub','hiss','resonance','shimmer']],
  ['wire-nest', 'Wire nest', 195, .66, .77, .37, ['zing','walls','buzz','resonance','drone','zing','sub','shimmer']],
  ['inside-paper', 'Inside the paper', 134, .42, .52, .16, ['rustle','walls','rustle','resonance','sub','hiss','drone','shimmer']],
  ['deep-vivarium', 'Deep vivarium', 88, .3, .86, .27, ['skuttle','rustle','buzz','drone','sub','growl','resonance','shimmer']],
];
const PATCH_ARTICULATION = [
  [.35,72,1,.78,0],[.16,43,.7,.72,-.04],[.71,126,1.3,.82,.05],
  [.47,156,1.52,.68,-.08],[.13,88,.88,.93,0],[.42,180,1.65,.7,.06],
  [.2,34,.64,.84,-.05],[.79,58,.85,.8,0],[.64,65,.92,.78,-.03],
  [.26,110,1.23,.76,.04],[.09,38,.65,.88,.02],[.87,146,1.52,.69,-.06],
  [.91,172,1.72,.74,.07],[.29,32,.78,.83,-.03],[.74,52,.84,.9,0],
  [.53,162,1.48,.72,.03],[.39,91,1.18,.79,-.02],[.21,46,.83,.87,0],
];
export const ROACH_SOUND_PRESETS = Object.freeze(PATCHES.map(([id,label,pitch,brightness,resonance,crunch,sources],index) => Object.freeze({
  id, label, sound: Object.freeze({...ROACH_SOUND_DEFAULTS,pitch,brightness,resonance,crunch,
    vowel:PATCH_ARTICULATION[index][0],wingRate:PATCH_ARTICULATION[index][1],rhythm:PATCH_ARTICULATION[index][2],voice:PATCH_ARTICULATION[index][3],pan:PATCH_ARTICULATION[index][4]}),
  bodyMix: Object.freeze(createDefaultRoachBodyMix().map((row,i)=>Object.freeze({...row,source:sources[i]}))),
})));
export function createRandomRoachSound(seed = 1) {
  let state = (Number(seed) >>> 0) || 1;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const sound = normalizeRoachSound({...ROACH_SOUND_DEFAULTS,pitch:65+random()*230,brightness:.2+random()*.48,resonance:.38+random()*.54,crunch:.05+random()*.37,
    vowel:.08+random()*.84,wingRate:30+random()*150,rhythm:.6+random()*1.4,pan:(random()-.5)*.34,voice:.62+random()*.3});
  const bodyMix = createDefaultRoachBodyMix().map((row,i)=>({...row,
    source:ROACH_BODY_SOURCES[i===3||i===4 ? Math.floor(random()*4) : Math.floor(random()*ROACH_BODY_SOURCES.length)].id,
    level:(i===3||i===4 ? .45 : .22)+random()*.35,
  }));
  return {sound,bodyMix};
}

export const ROACH_MOD_TARGETS = Object.freeze([
  ['pitch', 'Pitch', 'Voiced fundamental and shell-mode tuning'],
  ['vowel', 'Vowel', 'Three moving formant bands'],
  ['filter', 'Brightness', 'Airflow and final low-pass cutoff'],
  ['resonance', 'Shell resonance', 'Decay and modal bandwidth'],
  ['hiss', 'Hiss', 'Filtered spiracle/friction noise level'],
  ['wingRate', 'Wing rate', 'Pulse-excited wing buzz frequency'],
  ['rhythm', 'Rhythm', 'Contact rattle and friction pulse grouping; foot timing stays with the gait'],
  ['percussion', 'Percussion', 'Shell and foot-impact energy'],
  ['crunch', 'Crunch', 'Bounded nonlinear rasp'],
  ['pan', 'Stereo pan', 'Equal-power stereo position'],
  ['voice', 'Voice', 'Spoken-word level'],
  ['feet', 'Feet', 'Six grounded contact transients'],
  ['growl', 'Growl', 'Movement-keyed subharmonic rasp'],
  ['drone', 'Drone', 'Optional sustained modal and formant source'],
  ['zing', 'Zing', 'Contact-excited lossy wire buzz and rasps'],
  ['samples', 'Recording', 'Real close-miked movement fragments'],
].map(([id, label, description]) => Object.freeze({ id, label, description })));
const TARGET_INDEX = new Map(ROACH_MOD_TARGETS.map(({ id }, index) => [id, index]));
const AXES = Object.freeze({ x: [0], y: [1], z: [2], xy: [0, 1], xz: [0, 2], yz: [1, 2], xyz: [0, 1, 2] });

export function createDefaultRoachMappings(joints = []) {
  return joints.slice(0, MAX_JOINTS).map((joint, index) => {
    const name = String(joint.jointId || joint.name || '').toLowerCase();
    const target = /antenna/.test(name) ? (/right/.test(name) ? 'pan' : 'filter')
      : /head|neck/.test(name) ? 'percussion' : /wing/.test(name) ? 'wingRate'
        : /abdomen/.test(name) ? 'hiss' : /body|thorax/.test(name) ? 'resonance'
          : 'filter';
    return { jointId: String(joint.id || joint.jointId || index), source: 'xyz', target, amount: /antenna|head|wing/.test(name) ? .7 : .8 };
  }).slice(0, MAX_MAPPINGS);
}

const GAIT_CORNERS = Object.freeze(['back', 'front', 'raisedBack', 'raisedFront']);
function normalizeGaitPose(value) {
  if (!value || !GAIT_CORNERS.every((key) => Array.isArray(value[key]) && value[key].length === 3)) return null;
  return Object.fromEntries(GAIT_CORNERS.map((key) => [key, value[key].map((angle) => clamp(finite(angle), -180, 180))]));
}
function jointVector(value, length, limit = 1e9) {
  if (!Array.isArray(value) || value.length !== length || !value.every((number) => Number.isFinite(number))) return null;
  return value.map((number) => clamp(number, -limit, limit));
}
function normalizeKinematics(value) {
  if (!value) return null;
  const position = jointVector(value.position, 3); const quaternion = jointVector(value.quaternion, 4, 1);
  const scale = jointVector(value.scale, 3);
  if (!position || !quaternion || !scale) return null;
  return { position, quaternion, scale, parentMatrix: jointVector(value.parentMatrix, 16), footTip: jointVector(value.footTip, 3) };
}
function normalizePoseLimits(value) {
  if (!value) return null;
  const result = {};
  for (const axis of ['x', 'y', 'z']) {
    const range = jointVector(value[axis], 2, 180);
    if (!range || range[0] > range[1]) return null;
    result[axis] = range;
  }
  return result;
}
function normalizeBodyEllipsoid(value) {
  if (!value || !value.jointId) return null;
  const center = jointVector(value.center, 3); const radii = jointVector(value.radii, 3);
  if (!center || !radii || radii.some((radius) => radius <= 0)) return null;
  return { jointId: String(value.jointId).slice(0, 120), center, radii };
}
function normalizeJoints(value) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_JOINTS).map((joint, index) => ({
    id: String(joint?.id ?? index).slice(0, 120), jointId: String(joint?.jointId ?? joint?.id ?? index).slice(0, 120),
    name: String(joint?.name ?? '').slice(0, 160), parent: joint?.parent == null ? null : String(joint.parent).slice(0, 120),
    kinematics: normalizeKinematics(joint?.kinematics), poseLimits: normalizePoseLimits(joint?.poseLimits),
    collisionSamples: Array.isArray(joint?.collisionSamples) ? joint.collisionSamples.slice(0, 8).map((point) => jointVector(point, 3)).filter(Boolean) : null,
    bodyEllipsoid: normalizeBodyEllipsoid(joint?.bodyEllipsoid),
    wingOpenSign: joint?.wingOpenSign === 1 || joint?.wingOpenSign === -1 ? joint.wingOpenSign : null,
    wingLayer: joint?.wingLayer === 'cover' || joint?.wingLayer === 'hind' ? joint.wingLayer : null,
    authoredReconstruction: joint?.authoredReconstruction === true,
    gaitPose: normalizeGaitPose(joint?.gaitPose),
    offset: Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, clamp(joint?.offset?.[axis] ?? 0, -180, 180)])),
    restOffset: Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, clamp(joint?.restOffset?.[axis] ?? 0, -145, 145)])),
    motion: { enabled: joint?.motion?.enabled === true, axis: ['x', 'y', 'z'].includes(joint?.motion?.axis) ? joint.motion.axis : 'x',
      amplitude: clamp(joint?.motion?.amplitude ?? 12, 0, 90), speed: clamp(joint?.motion?.speed ?? .5, .05, 8) },
  }));
}

function resonator() { return { re: 0, im: 0, cosine: 1, sine: 0, radius: .99, gain: .01 }; }
function tune(mode, frequency, radius, sampleRate) {
  const angle = TAU * clamp(frequency, 25, sampleRate * .43) / sampleRate;
  mode.cosine = Math.cos(angle); mode.sine = Math.sin(angle); mode.radius = radius;
  mode.gain = 1 - radius;
}
function resonate(mode, input) {
  const re = mode.re;
  mode.re = clean((re * mode.cosine - mode.im * mode.sine) * mode.radius + input);
  mode.im = clean((re * mode.sine + mode.im * mode.cosine) * mode.radius);
  // A hostile parameter or corrupt source must never poison subsequent blocks.
  if (Math.abs(mode.re) > 100 || Math.abs(mode.im) > 100) { mode.re = 0; mode.im = 0; }
  return mode.im;
}
function polyBlep(phase, step) {
  if (phase < step) { const x = phase / step; return x + x - x * x - 1; }
  if (phase > 1 - step) { const x = (phase - 1) / step; return x * x + x + x + 1; }
  return 0;
}
const VOWELS = [[800, 1150, 2900], [500, 1750, 2450], [300, 2300, 3000], [500, 900, 2400], [350, 700, 2200]];

/** Browser-free audio-clock renderer, also used directly by offline tests. */
export class RoachSynthDsp {
  constructor(sampleRate = 48000) {
    this.sampleRate = clamp(sampleRate, 8000, 192000);
    this.time = 0; this.soundTime = 0; this.enabled = false; this.playing = false; this.soundPlaying = false; this.hasBeenEnabled = false;
    this.motion = normalizeRoachMotion(); this.sound = normalizeRoachSound(); this.smooth = normalizeRoachSound(); this.targets = normalizeRoachSound();
    this.bodyMix = createDefaultRoachBodyMix(); this.body = new RoachBodyEngine(this.sampleRate); this.recordings = this.body.recordings;
    this.joints = []; this.jointStructureKey = ''; this.mappings = []; this.pose = new Float32Array(MAX_JOINTS * 3);
    this.previousPose = new Float32Array(MAX_JOINTS * 3);
    this.editedPose = new Float32Array(MAX_JOINTS * 3); this.editedJoints = new Uint8Array(MAX_JOINTS);
    this.jointKinds = new Uint8Array(MAX_JOINTS);
    this.jointGroups = new Uint8Array(MAX_JOINTS); this.jointSides = new Int8Array(MAX_JOINTS); this.groupCounts = new Uint16Array(8);
    this.groupPose = new Float64Array(32); this.groupMotion = new Float64Array(8); this.groupDistance = new Float64Array(8);
    this.mod = new Float64Array(ROACH_MOD_TARGETS.length * 8); this.modCounts = new Uint16Array(ROACH_MOD_TARGETS.length * 8);
    this.scene = createRoachSceneState(); this.contactCounts = new Float64Array(6);
    this.contactsPrimed = false; this.contactEvents = 0; this.lastContactTime = -1;
    this.controlStride = Math.max(1, Math.round(this.sampleRate / 200)); this.controlCountdown = 0; this.controlPrimed = false;
    this.master = 0; this.soundGate = 0; this.interactionJoint = -1; this.interactionActive = false; this.interactionPeak = 0;
    this.smoothing = 1 - Math.exp(-1 / (this.sampleRate * .022)); this.gateSmoothing = 1 - Math.exp(-1 / (this.sampleRate * .028));
    this.speechModes = Array.from({length:3},resonator);
    this.mixEnvelope = 0; this.mixAttack = 1 - Math.exp(-1 / (this.sampleRate * .0015)); this.mixRelease = 1 - Math.exp(-1 / (this.sampleRate * .085));
    this.filterL = 0; this.filterR = 0; this.dcL = 0; this.dcR = 0; this.previousL = 0; this.previousR = 0; this.randomState = 0x756d4f21;
    this.atlas = null; this.atlasRate = 16000; this.phoneQueue = EMPTY_PHONES; this.phoneIndex = 0;
    this.phonePosition = 0; this.phone = null; this.speechEnvelope = 0; this.speechGain = 0; this.speechTarget = 0; this.pendingSpeech = null;
    this.speechSmoothing = 1 - Math.exp(-1 / (this.sampleRate * .0015));
    this.filterCoefficient = .25; this.panL = Math.SQRT1_2; this.panR = Math.SQRT1_2; this.speechRate = 1;
    this.telemetry = {rms:0,peak:0,speechEnvelope:0,motionTime:0,soundTime:0,renderedFrames:0};
  }
  update(value = {}) {
    const resetActivity = value.resetActivity === true;
    if (resetActivity) { this.body.resetActivity(); this.controlPrimed = false; this.contactsPrimed = false; }
    if (value.bodyMix) { this.bodyMix = normalizeRoachBodyMix(value.bodyMix); this.body.setMix(this.bodyMix, !this.hasBeenEnabled); }
    if (value.time != null) {
      const next = clamp(value.time, 0, 1e9);
      if (Math.abs(next - this.time) > .05) this.contactsPrimed = false;
      this.time = next;
    }
    if ('enabled' in value) { this.enabled = value.enabled === true; if (!this.enabled) this.stopSpeech(); }
    if ('playing' in value) {
      if (this.playing !== (value.playing === true)) this.contactsPrimed = false;
      this.playing = value.playing === true;
    }
    if ('soundPlaying' in value) this.soundPlaying = value.soundPlaying === true;
    if (value.motion) {
      const motion = normalizeRoachMotion({ ...this.motion, ...value.motion });
      if (motion.presetId !== this.motion.presetId || motion.sequenceEnabled !== this.motion.sequenceEnabled || motion.tempo !== this.motion.tempo) {
        this.contactsPrimed = false; this.controlPrimed = false;
      }
      this.motion = motion;
    }
    if (value.sound) this.sound = normalizeRoachSound({ ...this.sound, ...value.sound });
    if (value.joints) {
      const next = normalizeJoints(value.joints);
      const structureKey = JSON.stringify(next.map(({ offset, motion, ...structure }) => structure));
      const same = structureKey === this.jointStructureKey;
      this.jointStructureKey = structureKey;
      let compareEdited = false;
      this.editedJoints.fill(0);
      if (same) {
        if (!resetActivity && this.enabled && this.hasBeenEnabled) {
          for (let i = 0; i < next.length; i += 1) {
            const old = this.joints[i].offset; const offset = next[i].offset;
            if (Math.abs(offset.x-old.x)+Math.abs(offset.y-old.y)+Math.abs(offset.z-old.z) > .001) {
              this.editedJoints[i] = 1; compareEdited = true;
            }
          }
          // Compare constrained geometry at one fixed audio time. A pointer
          // pushing beyond an anatomical limit must not invent friction.
          if (compareEdited) writeRoachPose(this.time, this.motion, this.joints, this.editedPose);
        }
        for (let i = 0; i < next.length; i += 1) {
          // Retain object identity and the motion module's metadata cache. A UI
          // edit must not erase the previous pose and silence its own gesture.
          this.joints[i].offset = next[i].offset;
          this.joints[i].motion = next[i].motion;
        }
      } else {
        this.joints = next; this.controlPrimed = false; this.contactsPrimed = false;
        this.jointKinds.fill(3); this.groupCounts.fill(0);
        for (let i = 0; i < this.joints.length; i += 1) {
          const label = `${this.joints[i].name} ${this.joints[i].jointId}`.toLowerCase();
          this.jointGroups[i] = getRoachJointBodyGroup(this.joints[i]);
          this.jointSides[i] = /left|_l\b/.test(label) ? -1 : /right|_r\b/.test(label) ? 1 : 0;
          this.groupCounts[this.jointGroups[i]] += 1;
          this.jointKinds[i] = /wing/.test(label) ? 1 : /leg|proximal|distal|foot|front_|middle_|hind_/.test(label) ? 0
            : /head|neck|body|abdomen|thorax|pronotum/.test(label) ? 2 : 3;
        }
        this.body.resetActivity(); this.interactionJoint = -1; this.interactionActive = false;
      }
      // Populate first-use metadata on the message boundary, outside render().
      writeRoachPose(this.time, this.motion, this.joints, this.pose);
      if (compareEdited) {
        for (let i = 0; i < this.joints.length; i += 1) {
          if (!this.editedJoints[i]) continue;
          const k = i * 3;
          const delta = Math.abs(this.pose[k]-this.editedPose[k])+Math.abs(this.pose[k+1]-this.editedPose[k+1])+Math.abs(this.pose[k+2]-this.editedPose[k+2]);
          if (delta > .001) this.exciteInteraction(i, clamp(delta / 18, .025, 1));
        }
      }
    }
    if (value.mappings || value.joints) {
      const source = value.mappings ?? this.mappingSource ?? createDefaultRoachMappings(this.joints);
      this.mappingSource = Array.isArray(source) ? source.slice(0, MAX_MAPPINGS) : [];
      this.mappings = this.mappingSource.flatMap((mapping) => {
        const joint = this.joints.findIndex((item) => item.jointId === mapping?.jointId || item.id === mapping?.jointId);
        const target = TARGET_INDEX.get(mapping?.target); const axes = AXES[mapping?.source];
        return joint >= 0 && target != null && axes ? [{ joint, target, axes, amount: clamp(mapping.amount, -1, 1) }] : [];
      });
      this.modCounts.fill(0);
      for (const mapping of this.mappings) this.modCounts[this.jointGroups[mapping.joint] * ROACH_MOD_TARGETS.length + mapping.target] += 1;
    }
    // Initial settings are a starting condition, not a transition from the
    // factory patch: in particular a preselected zero output must never blip.
    if (!this.hasBeenEnabled) { Object.assign(this.smooth, this.sound); Object.assign(this.targets, this.sound); }
    if (this.enabled) this.hasBeenEnabled = true;
    this.controlCountdown = 0;
  }
  interact(value = {}) {
    const active = value.active === true;
    const id = String(value.jointId ?? '');
    const index = active ? this.joints.findIndex((joint) => joint.id === id || joint.jointId === id) : this.interactionJoint;
    if (active && (!this.interactionActive || index !== this.interactionJoint)) this.interactionPeak = 0;
    this.interactionActive = active;
    if (!active) return;
    this.interactionJoint = index;
    // Selection alone does not sound. Pose deltas are authoritative; velocity
    // supports controllers that send an impulse without a pose update.
    const velocity = clamp(value.velocity ?? 0, 0, 1);
    if (this.enabled && this.interactionJoint >= 0 && velocity > 0) this.exciteInteraction(this.interactionJoint, velocity);
  }
  exciteInteraction(index, amount) {
    this.interactionJoint = index;
    this.body.excite(this.jointGroups[index], amount);
  }
  triggerFoot(index, impact) {
    const strength = clamp(impact, 0, 1); if (!strength) return;
    this.body.contact(index, strength);
    this.contactEvents += 1; this.lastContactTime = this.time;
  }
  setSampleBank(samples, options) { this.recordings.setBank(samples, options); }
  setAtlas(samples, sampleRate) {
    if (!(samples instanceof Float32Array) || samples.length > 192000 * 16) throw new Error('Speech atlas exceeds its fixed budget.');
    this.atlas = samples; this.atlasRate = clamp(sampleRate, 8000, 192000);
  }
  speak(phones) {
    if (!this.atlas || !this.enabled) return false;
    const queue = (Array.isArray(phones) ? phones : []).slice(0, MAX_PHONES).map((phone) => ({
      offset: clamp(phone?.offset, 0, this.atlas.length / this.atlasRate),
      duration: clamp(phone?.duration, .015, .65), gain: clamp(phone?.gain ?? 1, 0, 1.5), silence: phone?.silence === true,
    }));
    if (this.phone || this.phoneIndex < this.phoneQueue.length) {
      this.pendingSpeech = queue; this.speechTarget = 0;
    } else {
      this.phoneQueue = queue; this.phoneIndex = 0; this.phone = null; this.phonePosition = 0;
      this.speechTarget = 1; this.pendingSpeech = null;
    }
    return queue.length > 0;
  }
  stopSpeech() { this.pendingSpeech = null; this.speechTarget = 0; }
  random() {
    let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x | 0;
    return (x >>> 0) / 2147483648 - 1;
  }
  control() {
    writeRoachPose(this.time, this.motion, this.joints, this.pose);
    this.groupPose.fill(0); this.groupMotion.fill(0); this.groupDistance.fill(0); this.mod.fill(0);
    const interval = this.controlStride / this.sampleRate;
    for (let i=0;i<this.joints.length;i+=1) {
      const group=this.jointGroups[i]; const p=group*4; const k=i*3; const rest=this.joints[i].restOffset;
      const x=this.pose[k]-rest.x; const y=this.pose[k+1]-rest.y; const z=this.pose[k+2]-rest.z;
      const focus=i===this.interactionJoint && this.body.voices[group].manual>.0001 ? Math.sqrt(Math.max(1,this.groupCounts[group])) : 1;
      const identity=(1+(i%7)*.037)*(this.jointSides[i]<0?.86:this.jointSides[i]>0?1.17:1)*focus;
      this.groupPose[p]+=x/45*identity; this.groupPose[p+1]+=y/45*identity; this.groupPose[p+2]+=z/45*identity;
      const magnitude=Math.abs(x)+Math.abs(y)+Math.abs(z);
      this.groupPose[p+3]+=this.jointSides[i]*Math.min(1,magnitude/45)*focus;
      if(this.controlPrimed && this.playing) {
        const distance=Math.abs(this.pose[k]-this.previousPose[k])+Math.abs(this.pose[k+1]-this.previousPose[k+1])+Math.abs(this.pose[k+2]-this.previousPose[k+2]);
        this.groupDistance[group]+=distance;
        this.groupMotion[group]+=distance/(interval*160);
      }
    }
    for(const mapping of this.mappings) {
      const group=this.jointGroups[mapping.joint]; const index=group*ROACH_MOD_TARGETS.length+mapping.target; let value=0;
      for(const axis of mapping.axes) {
        const rest=this.joints[mapping.joint].restOffset;
        value+=(this.pose[mapping.joint*3+axis]-(axis===0?rest.x:axis===1?rest.y:rest.z))/30;
      }
      this.mod[index]+=clamp(value/Math.sqrt(mapping.axes.length),-1,1)*mapping.amount;
    }
    for(let i=0;i<this.mod.length;i+=1) this.mod[i]=clamp(this.mod[i]/Math.sqrt(Math.max(1,this.modCounts[i])),-1,1);
    for(let group=0;group<8;group+=1) {
      const p=group*4; const divisor=Math.sqrt(Math.max(1,this.groupCounts[group]));
      this.body.voices[group].control(clamp(this.groupPose[p]/divisor,-2,2),clamp(this.groupPose[p+1]/divisor,-2,2),clamp(this.groupPose[p+2]/divisor,-2,2),
        clamp(this.groupPose[p+3]/divisor,-1,1),clamp(this.groupMotion[group]/divisor,0,1),this.smooth,this.mod,group*ROACH_MOD_TARGETS.length);
      this.body.movement(group,this.groupDistance[group],this.enabled);
    }
    this.previousPose.set(this.pose); this.controlPrimed=true;
    writeRoachSceneState(this.time,this.motion,this.scene,this.joints);
    for(let i=0;i<6;i+=1) {
      const foot=this.scene.feet[i];
      if(this.contactsPrimed&&this.playing&&this.enabled&&foot.stance&&foot.contactCount>this.contactCounts[i]) this.triggerFoot(i,foot.impact);
      this.contactCounts[i]=foot.contactCount;
    }
    this.contactsPrimed=true;
    Object.assign(this.targets,this.sound);
    const smooth=this.smooth;
    this.filterCoefficient=1-Math.exp(-TAU*Math.min(this.sampleRate*.4,900*10**smooth.brightness)/this.sampleRate);
    this.panL=Math.cos((smooth.pan+1)*Math.PI*.25); this.panR=Math.sin((smooth.pan+1)*Math.PI*.25);
    this.speechRate=clamp((smooth.pitch/140)**.22,.72,1.4);
    const vowel=smooth.vowel*4; const first=Math.min(3,Math.floor(vowel)); const mix=vowel-first;
    for(let i=0;i<3;i+=1) tune(this.speechModes[i],VOWELS[first][i]*(1-mix)+VOWELS[first+1][i]*mix,
      Math.exp(-Math.PI*(160+i*70)/this.sampleRate),this.sampleRate);
  }

  speechSample() {
    this.speechGain += (this.speechTarget - this.speechGain) * this.speechSmoothing;
    if (this.speechTarget === 0 && this.speechGain < .0001) {
      this.phoneQueue = this.enabled && this.pendingSpeech ? this.pendingSpeech : EMPTY_PHONES;
      this.phoneIndex = 0; this.phone = null; this.phonePosition = 0;
      this.pendingSpeech = null;
      if (this.phoneQueue.length) this.speechTarget = 1;
      else return 0;
    }
    if (!this.phone) {
      this.phone = this.phoneQueue[this.phoneIndex++] ?? null; this.phonePosition = 0;
      if (!this.phone) { this.phoneQueue = EMPTY_PHONES; this.phoneIndex = 0; this.speechTarget = 0; return 0; }
    }
    const phone = this.phone;
    const rate = this.speechRate;
    const age = this.phonePosition / this.atlasRate;
    const envelope = Math.min(1, age / .007, (phone.duration - age) / .009);
    const position = phone.offset * this.atlasRate + this.phonePosition;
    const index = Math.floor(position); const mix = position - index;
    let sample = phone.silence ? 0 : ((this.atlas[index] || 0) * (1 - mix) + (this.atlas[index + 1] || 0) * mix) * Math.max(0, envelope) * phone.gain;
    this.phonePosition += this.atlasRate / this.sampleRate * rate;
    if (this.phonePosition >= phone.duration * this.atlasRate) this.phone = null;
    if (!Number.isFinite(sample)) sample = 0;
    return sample * this.speechGain;
  }
  render(left, right) {
    const count=Math.min(left.length,right.length); let energy=0; let peak=0;
    for(let sampleIndex=0;sampleIndex<count;sampleIndex+=1) {
      if(this.controlCountdown--<=0) { this.control(); this.controlCountdown=this.controlStride-1; }
      if(this.playing) this.time+=1/this.sampleRate;
      if(this.soundPlaying) this.soundTime+=1/this.sampleRate;
      for(const key of SOUND_KEYS) this.smooth[key]+=(this.targets[key]-this.smooth[key])*this.smoothing;
      const s=this.smooth;
      this.master+=((this.enabled?1:0)-this.master)*this.gateSmoothing;
      this.soundGate+=((this.soundPlaying?1:0)-this.soundGate)*this.gateSmoothing;
      this.body.sample(this.soundGate,this.playing);
      const speech=this.atlas?this.speechSample():0;
      this.speechEnvelope+=(Math.abs(speech)-this.speechEnvelope)*.008;
      const speechDuck=1/(1+this.speechEnvelope*s.voice*1.6);
      let speechColor=0;
      for(let i=0;i<3;i+=1) speechColor+=resonate(this.speechModes[i],speech*this.speechModes[i].gain)*FORMANT_GAINS[i];
      const speechColorMix=Math.min(.22,Math.abs(s.vowel-ROACH_SOUND_DEFAULTS.vowel)*.22+Math.abs(s.resonance-ROACH_SOUND_DEFAULTS.resonance)*.06);
      const voice=(speech*(1-speechColorMix*.3)+speechColor*speechColorMix)*s.voice*1.8;
      const bodyScale=2.1*speechDuck;
      const busL=this.body.left*bodyScale+voice*this.panL; const busR=this.body.right*bodyScale+voice*this.panR;
      const absolute=Math.max(Math.abs(busL),Math.abs(busR));
      this.mixEnvelope+=(absolute-this.mixEnvelope)*(absolute>this.mixEnvelope?this.mixAttack:this.mixRelease);
      const reduction=this.mixEnvelope>.72?(.72+(this.mixEnvelope-.72)*.3)/this.mixEnvelope:1;
      const rawL=busL*reduction; const rawR=busR*reduction;
      const drive=1+s.crunch*7; const norm=1+s.crunch*2.5;
      const mixedL=rawL*(1-s.crunch*.65)+Math.tanh(rawL*drive)/norm*s.crunch*.65;
      const mixedR=rawR*(1-s.crunch*.65)+Math.tanh(rawR*drive)/norm*s.crunch*.65;
      this.filterL+=(mixedL-this.filterL)*this.filterCoefficient; this.filterR+=(mixedR-this.filterR)*this.filterCoefficient;
      this.dcL=clean(this.filterL-this.previousL+this.dcL*.997); this.dcR=clean(this.filterR-this.previousR+this.dcR*.997);
      this.previousL=this.filterL; this.previousR=this.filterR;
      const gain=this.master*s.level*1.25;
      const l=Math.tanh(this.dcL*gain); const r=Math.tanh(this.dcR*gain);
      left[sampleIndex]=Number.isFinite(l)?l:0; right[sampleIndex]=Number.isFinite(r)?r:0;
      energy+=l*l+r*r; peak=Math.max(peak,Math.abs(l),Math.abs(r));
      if(this.interactionActive) this.interactionPeak=Math.max(this.interactionPeak,Math.abs(l),Math.abs(r));
    }
    this.telemetry.rms=Math.sqrt(energy/Math.max(1,count*2)); this.telemetry.peak=peak;
    this.telemetry.motionTime=this.time; this.telemetry.soundTime=this.soundTime; this.telemetry.speechEnvelope=this.speechEnvelope;
    this.telemetry.contactEvents=this.contactEvents; this.telemetry.lastContactTime=this.lastContactTime;
    this.telemetry.interactionPeak=this.interactionPeak; this.telemetry.recordingEvents=this.recordings.events;
    this.telemetry.renderedFrames+=count;
    return this.telemetry;
  }
}
