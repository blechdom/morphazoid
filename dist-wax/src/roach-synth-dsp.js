import { normalizeRoachMotion, writeRoachPose, createRoachSceneState, writeRoachSceneState } from './roach-synth-motion.js';

// Artistic sonification of one shared support/flight model: six short foot
// contacts, shell friction, wing pulses and keyed growls. The optional modal
// drone is scalar DSP informed by SIMD Resonator, not a claim of SIMD execution.
// Sound Play adds a pose-dependent pulse texture on its own sample clock;
// Animation Play alone advances the shared pose clock. Spoken words retain the
// bundled KAL16 source independently of either transport.
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
  feet: 0.88, growl: 0.24, drone: 0,
  pitch: 140, vowel: 0.35, brightness: 0.46, resonance: 0.38,
  wingRate: 72, rhythm: 1, crunch: 0.18, pan: 0,
});
const SOUND_RANGES = Object.freeze({
  level: [0, 0.8], hiss: [0, 1], shell: [0, 1], wing: [0, 1], voice: [0, 1],
  feet: [0, 1], growl: [0, 1], drone: [0, 1],
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
export const ROACH_SOUND_PRESETS = Object.freeze([
  { id: 'scuttling-shell', label: 'Nervous scuttle', sound: { ...ROACH_SOUND_DEFAULTS } },
  { id: 'spiracle-whisper', label: 'Spiracle whisper', sound: { ...ROACH_SOUND_DEFAULTS, hiss: .88, shell: .22, feet: .36, wing: .04, growl: .08, pitch: 85, brightness: .34, resonance: .20, crunch: .08 } },
  { id: 'wing-radio', label: 'Unfurling wings', sound: { ...ROACH_SOUND_DEFAULTS, hiss: .25, shell: .16, feet: .3, wing: .95, growl: .05, pitch: 220, wingRate: 94, brightness: .7, resonance: .45, crunch: .34 } },
  { id: 'tin-carapace', label: 'Tin carapace', sound: { ...ROACH_SOUND_DEFAULTS, hiss: .06, shell: 1, feet: .55, wing: .05, growl: .05, pitch: 310, resonance: .72, rhythm: 1.7, brightness: .66, crunch: .24 } },
  { id: 'crunchy-orator', label: 'Crusty orator', sound: { ...ROACH_SOUND_DEFAULTS, hiss: .08, shell: .2, feet: .28, wing: .08, growl: .18, voice: 1, pitch: 116, vowel: .13, crunch: .42, resonance: .32 } },
  { id: 'pitter-patter', label: 'Pitter patter feet', sound: { ...ROACH_SOUND_DEFAULTS, hiss: .04, shell: .18, feet: 1, wing: .02, growl: 0, pitch: 420, resonance: .08, rhythm: 1.4, brightness: .84, crunch: .05 } },
  { id: 'under-fridge', label: 'Under-fridge growl', sound: { ...ROACH_SOUND_DEFAULTS, hiss: .12, shell: .58, feet: .52, wing: .05, growl: .95, pitch: 76, brightness: .2, resonance: .58, crunch: .68 } },
  { id: 'modal-carapace', label: 'Modal carapace drone', sound: { ...ROACH_SOUND_DEFAULTS, hiss: .06, shell: .4, feet: .6, wing: .1, growl: .12, drone: .55, pitch: 108, vowel: .7, resonance: .8, brightness: .4, crunch: .28 } },
].map((preset) => Object.freeze({ ...preset, sound: Object.freeze(preset.sound) })));

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
    this.motion = normalizeRoachMotion(); this.sound = normalizeRoachSound();
    this.joints = []; this.jointStructureKey = ''; this.mappings = []; this.pose = new Float32Array(MAX_JOINTS * 3);
    this.previousPose = new Float32Array(MAX_JOINTS * 3);
    this.jointKinds = new Uint8Array(MAX_JOINTS); // leg, wing, head/body, antenna/other
    this.mod = new Float64Array(ROACH_MOD_TARGETS.length); this.modCounts = new Uint16Array(ROACH_MOD_TARGETS.length);
    this.scene = createRoachSceneState(); this.contactCounts = new Float64Array(6);
    this.footEnvelopes = new Float64Array(6); this.footAges = new Float64Array(6);
    this.contactsPrimed = false; this.contactEvents = 0; this.lastContactTime = -1;
    this.controlStride = Math.max(1, Math.round(this.sampleRate / 200)); this.controlCountdown = 0;
    this.controlPrimed = false; this.master = 0; this.gate = 0; this.soundGate = 0; this.drive = 0; this.wingDrive = 0; this.bodyDrive = 0;
    this.manualDrive = new Float64Array(4); this.interactionJoint = -1; this.interactionActive = false; this.interactionPeak = 0;
    this.manualDecay = Math.exp(-1 / (this.sampleRate * .055));
    this.footDecay = Math.exp(-1 / (this.sampleRate * .017));
    this.targets = normalizeRoachSound(); this.smooth = normalizeRoachSound();
    this.smoothing = 1 - Math.exp(-1 / (this.sampleRate * .022));
    this.gateSmoothing = 1 - Math.exp(-1 / (this.sampleRate * .018));
    this.shellModes = Array.from({ length: 16 }, resonator);
    this.poseModes = Array.from({ length: 8 }, resonator);
    this.voiceModes = Array.from({ length: 3 }, resonator);
    this.speechModes = Array.from({ length: 3 }, resonator);
    this.wingModes = Array.from({ length: 2 }, resonator);
    this.voicePhase = 0; this.wingPhase = 0; this.rhythmPhase = 0; this.creakPhase = 0;
    this.posePhase = 0; this.poseGrain = 0; this.poseImpulse = 0; this.poseGrainIndex = 0;
    this.posePressure = 0; this.poseWing = 0; this.poseHead = 0; this.poseSignature = 0;
    this.poseTargets = new Float64Array(4); this.poseGrainDecay = Math.exp(-1 / (this.sampleRate * .026));
    this.impulse = 0; this.noiseLow = 0; this.filterL = 0; this.filterR = 0;
    this.dcL = 0; this.dcR = 0; this.previousL = 0; this.previousR = 0; this.randomState = 0x756d4f21;
    this.atlas = null; this.atlasRate = 16000; this.phoneQueue = EMPTY_PHONES; this.phoneIndex = 0;
    this.phonePosition = 0; this.phone = null; this.speechEnvelope = 0;
    this.speechGain = 0; this.speechTarget = 0; this.pendingSpeech = null;
    this.speechSmoothing = 1 - Math.exp(-1 / (this.sampleRate * .0015));
    this.filterCoefficient = .25; this.panL = Math.SQRT1_2; this.panR = Math.SQRT1_2; this.speechRate = 1;
    this.telemetry = { rms: 0, peak: 0, speechEnvelope: 0, motionTime: 0, soundTime: 0, renderedFrames: 0 };
  }
  update(value = {}) {
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
    if ('soundPlaying' in value) {
      const next = value.soundPlaying === true;
      if (next && !this.soundPlaying) { this.poseGrain = .7; this.poseImpulse = .28; }
      this.soundPlaying = next;
    }
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
      if (same) {
        for (let i = 0; i < next.length; i += 1) {
          let delta = 0;
          for (const axis of ['x', 'y', 'z']) delta += Math.abs(next[i].offset[axis] - this.joints[i].offset[axis]);
          if (delta > .001 && this.enabled && this.hasBeenEnabled) this.exciteInteraction(i, clamp(delta / 18, .025, 1));
          // Retain object identity and the motion module's metadata cache. A UI
          // edit must not erase the previous pose and silence its own gesture.
          this.joints[i].offset = next[i].offset;
          this.joints[i].motion = next[i].motion;
        }
      } else {
        this.joints = next; this.controlPrimed = false; this.contactsPrimed = false;
        this.jointKinds.fill(3);
        for (let i = 0; i < this.joints.length; i += 1) {
          const label = `${this.joints[i].name} ${this.joints[i].jointId}`.toLowerCase();
          this.jointKinds[i] = /wing/.test(label) ? 1 : /leg|proximal|distal|foot|front_|middle_|hind_/.test(label) ? 0
            : /head|neck|body|abdomen|thorax|pronotum/.test(label) ? 2 : 3;
        }
        this.manualDrive.fill(0); this.interactionJoint = -1; this.interactionActive = false;
      }
      // Populate first-use metadata on the message boundary, outside render().
      writeRoachPose(this.time, this.motion, this.joints, this.pose);
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
      for (const mapping of this.mappings) this.modCounts[mapping.target] += 1;
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
    const kind = this.jointKinds[index];
    this.manualDrive[kind] = Math.min(1, Math.max(this.manualDrive[kind], amount * .8 + .06));
    this.interactionJoint = index;
    if (kind === 0 || kind === 2) this.impulse = Math.min(.6, this.impulse + amount * (kind === 2 ? .42 : .12));
  }
  triggerFoot(index, impact) {
    const strength = clamp(impact, 0, 1);
    if (!strength) return;
    this.footEnvelopes[index] = Math.min(1.4, this.footEnvelopes[index] + .4 + strength * .7);
    this.footAges[index] = 0;
    this.impulse = Math.min(1.3, this.impulse + strength * .25);
    this.contactEvents += 1; this.lastContactTime = this.time;
  }
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
    let pressure = 0; let wingShape = 0; let headShape = 0; let signature = 0; let wingShapes = 0; let headShapes = 0;
    for (let i = 0; i < this.joints.length; i += 1) {
      const rest = this.joints[i].restOffset; const k = i * 3;
      const x = this.pose[k] - rest.x; const y = this.pose[k + 1] - rest.y; const z = this.pose[k + 2] - rest.z;
      const magnitude = Math.min(1, (Math.abs(x) + Math.abs(y) + Math.abs(z)) / 90);
      pressure += magnitude;
      signature += Math.sin((x * (1 + i % 3) + y * 1.7 + z * .8) * Math.PI / 180) / Math.sqrt(i + 1);
      if (this.jointKinds[i] === 1) { wingShape += magnitude; wingShapes += 1; }
      if (this.jointKinds[i] === 2) { headShape += magnitude; headShapes += 1; }
    }
    this.poseTargets[0] = clamp(pressure / Math.max(1, this.joints.length), 0, 1);
    this.poseTargets[1] = clamp(wingShape / Math.max(1, wingShapes), 0, 1);
    this.poseTargets[2] = clamp(headShape / Math.max(1, headShapes), 0, 1);
    this.poseTargets[3] = clamp(signature / Math.sqrt(Math.max(1, this.joints.length)), -1, 1);
    this.mod.fill(0);
    for (const mapping of this.mappings) {
      let value = 0;
      for (const axis of mapping.axes) {
        const rest = this.joints[mapping.joint].restOffset;
        const neutral = axis === 0 ? rest.x : axis === 1 ? rest.y : rest.z;
        value += (this.pose[mapping.joint * 3 + axis] - neutral) / 30;
      }
      const focus = mapping.joint === this.interactionJoint && this.manualDrive[this.jointKinds[mapping.joint]] > .0001
        ? Math.sqrt(Math.max(1, this.modCounts[mapping.target])) : 1;
      this.mod[mapping.target] += clamp(value / Math.sqrt(mapping.axes.length), -1, 1) * mapping.amount * focus;
    }
    for (let i = 0; i < this.mod.length; i += 1) this.mod[i] = clamp(this.mod[i] / Math.sqrt(Math.max(1, this.modCounts[i])), -1, 1);
    writeRoachSceneState(this.time, this.motion, this.scene, this.joints);
    let activity = 0; let wingActivity = 0; let bodyActivity = 0; let wingCount = 0; let bodyCount = 0;
    const interval = this.controlStride / this.sampleRate;
    if (this.controlPrimed) {
      for (let i = 0; i < this.joints.length; i += 1) {
        const k = i * 3;
        const velocity = (Math.abs(this.pose[k] - this.previousPose[k]) + Math.abs(this.pose[k + 1] - this.previousPose[k + 1])
          + Math.abs(this.pose[k + 2] - this.previousPose[k + 2])) / (interval * 200);
        activity += velocity;
        if (this.jointKinds[i] === 1) { wingActivity += velocity; wingCount += 1; }
        if (this.jointKinds[i] === 2) { bodyActivity += velocity; bodyCount += 1; }
      }
    }
    this.previousPose.set(this.pose); this.controlPrimed = true;
    this.drive = clamp(activity / Math.max(1, this.joints.length), 0, 1);
    this.wingDrive = clamp(wingActivity / Math.max(1, wingCount), 0, 1);
    this.bodyDrive = clamp(bodyActivity / Math.max(1, bodyCount), 0, 1);
    for (let i = 0; i < 6; i += 1) {
      const foot = this.scene.feet[i];
      if (this.contactsPrimed && this.playing && this.enabled && foot.stance && foot.contactCount > this.contactCounts[i]) this.triggerFoot(i, foot.impact);
      this.contactCounts[i] = foot.contactCount;
    }
    this.contactsPrimed = true;
    const s = this.sound; const m = this.mod; const t = this.targets;
    t.pitch = clamp(s.pitch * 2 ** (m[0] * 1.7), 45, 1600);
    t.vowel = clamp(s.vowel + m[1] * .55, 0, 1);
    t.brightness = clamp(s.brightness + m[2] * .6, 0, 1);
    t.resonance = clamp(s.resonance + m[3] * .5, 0, .98);
    t.hiss = clamp(s.hiss * (1 + m[4] * .85), 0, 1.8);
    t.wingRate = clamp(s.wingRate * 2 ** (m[5] * 1.7), 8, 420);
    t.rhythm = clamp(s.rhythm * 2 ** m[6], .15, 6);
    t.shell = clamp(s.shell * (1 + m[7] * .85), 0, 1.8);
    t.crunch = clamp(s.crunch + m[8] * .6, 0, 1);
    t.pan = clamp(s.pan + m[9] * .85, -1, 1);
    t.voice = clamp(s.voice * (1 + m[10] * .85), 0, 1.8);
    t.feet = clamp(s.feet * (1 + m[11] * .9), 0, 1.8);
    t.growl = clamp(s.growl * (1 + m[12] * .9), 0, 1.8);
    t.drone = clamp(s.drone * (1 + m[13] * .9), 0, 1);
    t.wing = s.wing; t.level = s.level;
    // Coefficients follow already-smoothed controls; changing presets preserves
    // every resonator state and oscillator phase.
    const smooth = this.smooth;
    this.filterCoefficient = 1 - Math.exp(-TAU * Math.min(this.sampleRate * .4, 900 * 10 ** smooth.brightness) / this.sampleRate);
    this.panL = Math.cos((smooth.pan + 1) * Math.PI * .25); this.panR = Math.sin((smooth.pan + 1) * Math.PI * .25);
    this.speechRate = clamp((smooth.pitch / 140) ** .22, .72, 1.4);
    for (let i = 0; i < this.shellModes.length; i += 1) {
      const ratio = (i + 1) * Math.sqrt(1 + i * i * .0048);
      tune(this.shellModes[i], smooth.pitch * 2.15 * ratio,
        Math.exp(-1 / (this.sampleRate * (.020 + smooth.resonance * .23) / (1 + i * .2))), this.sampleRate);
    }
    for (let i = 0; i < this.poseModes.length; i += 1) {
      const ratio = (i + 1) * Math.sqrt(1 + i * i * .012);
      tune(this.poseModes[i], smooth.pitch * (1.8 + this.poseSignature * .5) * ratio,
        Math.exp(-1 / (this.sampleRate * (.018 + smooth.resonance * .18) / (1 + i * .2))), this.sampleRate);
    }
    const vowel = smooth.vowel * 4; const first = Math.min(3, Math.floor(vowel)); const mix = vowel - first;
    for (let i = 0; i < 3; i += 1) {
      const frequency = VOWELS[first][i] * (1 - mix) + VOWELS[first + 1][i] * mix;
      tune(this.voiceModes[i], frequency, Math.exp(-Math.PI * (90 + i * 50) / this.sampleRate), this.sampleRate);
      tune(this.speechModes[i], frequency, Math.exp(-Math.PI * (160 + i * 70) / this.sampleRate), this.sampleRate);
    }
    for (let i = 0; i < 2; i += 1) tune(this.wingModes[i], 1100 + smooth.brightness * 2400 + i * 230,
      Math.exp(-Math.PI * (200 - smooth.resonance * 100) / this.sampleRate), this.sampleRate);
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
    const count = Math.min(left.length, right.length); let energy = 0; let peak = 0;
    for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
      if (this.controlCountdown-- <= 0) { this.control(); this.controlCountdown = this.controlStride - 1; }
      if (this.playing) this.time += 1 / this.sampleRate;
      if (this.soundPlaying) this.soundTime += 1 / this.sampleRate;
      for (const key of SOUND_KEYS) this.smooth[key] += (this.targets[key] - this.smooth[key]) * this.smoothing;
      const s = this.smooth;
      this.master += ((this.enabled ? 1 : 0) - this.master) * this.gateSmoothing;
      this.gate += ((this.playing ? 1 : 0) - this.gate) * this.gateSmoothing;
      this.soundGate += ((this.soundPlaying ? 1 : 0) - this.soundGate) * this.gateSmoothing;
      this.posePressure += (this.poseTargets[0] - this.posePressure) * this.smoothing;
      this.poseWing += (this.poseTargets[1] - this.poseWing) * this.smoothing;
      this.poseHead += (this.poseTargets[2] - this.poseHead) * this.smoothing;
      this.poseSignature += (this.poseTargets[3] - this.poseSignature) * this.smoothing;
      for (let i = 0; i < 4; i += 1) this.manualDrive[i] *= this.manualDecay;
      const leg = this.manualDrive[0]; const manualWing = this.manualDrive[1]; const head = this.manualDrive[2]; const feeler = this.manualDrive[3];
      const noise = this.random(); this.noiseLow += (noise - this.noiseLow) * .055;
      const scratch = noise - this.noiseLow;
      this.rhythmPhase = (this.rhythmPhase + this.motion.tempo / 60 * s.rhythm / this.sampleRate) % 1;
      const grouping = .18 + .82 * Math.max(0, Math.sin(TAU * this.rhythmPhase));
      const autoDrive = this.drive * this.gate;
      if (this.soundPlaying) {
        // This is a synth pulse, not a claimed foot contact. Its own clock can
        // sound a completely static pose without advancing animation or feet.
        const grainRate = clamp((6 + this.posePressure * 19) * s.rhythm * (1 + this.poseSignature * .35), 1, 72);
        this.posePhase += grainRate / this.sampleRate;
        if (this.posePhase >= 1) {
          this.posePhase %= 1; this.poseGrainIndex += 1;
          const accent = this.poseGrainIndex % 4 === 0 ? 1 : this.poseGrainIndex % 3 === 0 ? .35 : .64;
          this.poseGrain = (.5 + this.posePressure * .5) * accent;
          this.poseImpulse = Math.min(.7, this.poseImpulse + this.poseGrain * .34);
        }
      }
      this.poseGrain *= this.poseGrainDecay;
      const staticPulse = this.poseGrain * this.soundGate;
      const droneGate = Math.max(this.soundGate, autoDrive);
      const physicalHeadDrive = Math.max(head, Math.min(1, this.bodyDrive * this.gate * (.5 + this.scene.energy.growl * 2.5)));
      const headDrive = Math.max(physicalHeadDrive, staticPulse * (.25 + this.poseHead * .75));
      const wingDrive = Math.max(Math.min(1, manualWing * 3.5), this.wingDrive * this.gate * (.08 + this.scene.energy.wing * .92), staticPulse * (.12 + this.poseWing * .88));
      const hiss = scratch * s.hiss * (autoDrive * .032 * grouping + (leg + head * .35 + feeler) * .18 + staticPulse * (.04 + this.posePressure * .035));
      let feet = 0;
      for (let i = 0; i < 6; i += 1) {
        const envelope = this.footEnvelopes[i];
        if (envelope < 1e-15) { this.footEnvelopes[i] = 0; continue; }
        const age = this.footAges[i]++ / this.sampleRate;
        const rattle = .65 + .35 * Math.cos(age * TAU * (125 + i * 29) * s.rhythm);
        feet += envelope * (scratch * .15 * rattle + Math.sin(age * TAU * (720 + i * 173) * (s.pitch / 140) ** .35) * .065);
        this.footEnvelopes[i] *= this.footDecay;
      }
      feet *= s.feet;
      const poseRattle = staticPulse * s.feet * (scratch * .058
        + Math.sin(TAU * this.voicePhase * (2 + this.poseSignature * .6)) * .025);
      this.creakPhase = (this.creakPhase + (38 + headDrive * 230) / this.sampleRate) % 1;
      const stickSlip = this.creakPhase < .08 ? .35 : -.02;
      const excite = this.impulse + scratch * (autoDrive * .0009 + leg * .009) + stickSlip * physicalHeadDrive * .055;
      const poseExcite = this.poseImpulse * this.soundGate + stickSlip * staticPulse * .02 + noise * s.drone * droneGate * .002;
      this.impulse *= .58; this.poseImpulse *= .58;
      let shell = 0;
      for (let i = 0; i < this.shellModes.length; i += 1) shell += resonate(this.shellModes[i], excite / (1 + i * .28)) * (.039 / Math.sqrt(i + 1));
      shell *= s.shell * Math.max(this.gate, Math.min(1, (leg + head + feeler) * 4));
      let poseShell = 0;
      for (let i = 0; i < this.poseModes.length; i += 1) poseShell += resonate(this.poseModes[i], poseExcite / (1 + i * .3)) * (.045 / Math.sqrt(i + 1));
      poseShell *= s.shell * Math.max(this.soundGate, s.drone > .0001 ? droneGate : 0);
      const wingStep = s.wingRate / this.sampleRate;
      this.wingPhase += wingStep;
      const tooth = this.wingPhase >= 1 ? 1 : 0; this.wingPhase %= 1;
      let wing = 0;
      for (let i = 0; i < 2; i += 1) wing += resonate(this.wingModes[i], tooth * (.8 + noise * .2) * wingDrive) * .026;
      wing = (wing + scratch * wingDrive * (.025 + .035 * Math.max(0, Math.sin(TAU * this.wingPhase)))) * s.wing;
      const voiceStep = Math.min(.15, s.pitch / this.sampleRate);
      this.voicePhase = (this.voicePhase + voiceStep) % 1;
      const glottal = (2 * this.voicePhase - 1 - polyBlep(this.voicePhase, voiceStep)) * .24 + noise * .006;
      let formant = 0;
      for (let i = 0; i < 3; i += 1) formant += resonate(this.voiceModes[i], glottal * this.voiceModes[i].gain) * FORMANT_GAINS[i];
      const growl = (Math.tanh(Math.sin(TAU * this.voicePhase) * 3 + noise * .2) * .06
        + formant * .3) * headDrive * s.growl * (.2 + .8 * grouping);
      const drone = (formant * .25 + Math.sin(TAU * this.voicePhase) * .025) * s.drone * droneGate;
      const speech = this.atlas ? this.speechSample() : 0;
      this.speechEnvelope += (Math.abs(speech) - this.speechEnvelope) * .008;
      const speechDuck = 1 / (1 + this.speechEnvelope * 12);
      // Contact tails and direct manipulation remain audible with animation
      // paused. Only automatic movement follows the transport gate.
      const mechanical = (hiss + shell + poseShell + feet + poseRattle + wing + growl + drone) * speechDuck;
      let speechColor = 0;
      for (let i = 0; i < 3; i += 1) speechColor += resonate(this.speechModes[i], speech * this.speechModes[i].gain) * FORMANT_GAINS[i];
      // Keep the familiar word voice dry at its default. Other vowel/resonance
      // settings gently color the sampled phones, preserving consonant attacks.
      const speechColorMix = Math.min(.22, Math.abs(s.vowel - ROACH_SOUND_DEFAULTS.vowel) * .22
        + Math.abs(s.resonance - ROACH_SOUND_DEFAULTS.resonance) * .06);
      const voice = (speech * (1 - speechColorMix * .3) + speechColor * speechColorMix) * s.voice * 1.15;
      const raw = mechanical + voice;
      const distortion = Math.tanh(raw * (1 + s.crunch * 7)) / (1 + s.crunch * 2.5);
      const mixed = raw * (1 - s.crunch * .65) + distortion * s.crunch * .65;
      this.filterL += (mixed * this.panL - this.filterL) * this.filterCoefficient;
      this.filterR += (mixed * this.panR - this.filterR) * this.filterCoefficient;
      this.dcL = clean(this.filterL - this.previousL + this.dcL * .997);
      this.dcR = clean(this.filterR - this.previousR + this.dcR * .997);
      this.previousL = this.filterL; this.previousR = this.filterR;
      const gain = this.master * s.level * 1.25;
      const l = Math.tanh(this.dcL * gain); const r = Math.tanh(this.dcR * gain);
      left[sampleIndex] = Number.isFinite(l) ? l : 0; right[sampleIndex] = Number.isFinite(r) ? r : 0;
      energy += l * l + r * r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
      if (this.interactionActive) this.interactionPeak = Math.max(this.interactionPeak, Math.abs(l), Math.abs(r));
    }
    this.telemetry.rms = Math.sqrt(energy / Math.max(1, count * 2)); this.telemetry.peak = peak;
    this.telemetry.motionTime = this.time; this.telemetry.soundTime = this.soundTime; this.telemetry.speechEnvelope = this.speechEnvelope;
    this.telemetry.contactEvents = this.contactEvents; this.telemetry.lastContactTime = this.lastContactTime;
    this.telemetry.interactionPeak = this.interactionPeak;
    this.telemetry.renderedFrames += count;
    return this.telemetry;
  }
}
