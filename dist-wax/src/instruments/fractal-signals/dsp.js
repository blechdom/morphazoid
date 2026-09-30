import { branchFrame, branchPitch, branchShape, wrapDegrees, branchTurnsGeometry, createBranchTurnsTarget, validBranchTurns } from './branch-geometry.js';
import { sanitizeModulatorState, modulatorSettings, modulatedValues, advanceModulators } from './modulators.js';
import { FractalOutput, outputMakeup } from './output.js';
import { sanitizeMotionState, createMotions, rebaseMotions, advanceMotions, motionValues, motionSnapshot, selectMotionFrame } from './motions.js';

/** Sample-clock synthesis for Fractal Signals. No DOM, timers, or audio nodes.
 * Limits: 384 score events, 32 simultaneous voices, 48 partials, 16 texture bands, 48 delay
 * taps, and 8 seconds of stereo delay. Above 24 levels, additive/wave voices
 * share a 192-partial work budget (four voices at 48 levels). Musical triggers are bounded to 480/s. All supplied audio is local/original. */
const TAU = Math.PI * 2;
const MODES = ['wander', 'grammar', 'grains', 'waveform', 'echoes', 'texture'];
export const DSP_ENGINES = {
  wander: ['cascade', 'pluck', 'additive'], grammar: ['cascade', 'pluck', 'bell'],
  grains: ['sample', 'resonant', 'cloud'], waveform: ['self-affine', 'folded', 'hollow'],
  echoes: ['shepard', 'strikes', 'resonant'], texture: ['noise', 'resonant', 'hybrid'],
};
const BOUNDS = {
  branchAngle: [0, 360, 0],
  lfo1Rate: [.01, 20, .2], lfo1Depth: [0, 1, .25], lfo2Rate: [.01, 20, .13], lfo2Depth: [0, 1, .25],
  seed: [1, 999999, 137], base: [20, 8000, 440], rate: [.0625, 64, 3],
  span: [0, 8, 2.4], index: [0, 32, 3], ratio: [.03125, 32, 1.7],
  depth: [1, 48, 5], roughness: [.01, 3, .55], branch: [0, 64, .65],
  memory: [0, .96, .3], attack: [.0002, 4, .003], decay: [.001, 8, .08],
  sustain: [0, 1, .12], release: [.005, 16, .06], phrase: [1, 512, 8],
  space: [0, 1, .25], x: [0, 1, .5], y: [0, 1, .5],
  glide: [0, 2, .015], chaos: [0, 2, .35], turns: [0, 32, 2], generationLoss: [0, 1, .22],
  grainSize: [.005, 1.5, .07], spray: [0, 1, .3], scan: [0, 1, .45],
  partialRatio: [1.1, 3, 2], fold: [0, 6, 1.2], echoTime: [.015, 3, .18],
  echoRatio: [.35, 2.5, 1.48], sweepRate: [.01, 4, .4],
  bandQ: [.3, 24, 2], tilt: [-3, 3, 0], profileMemory: [.01, 3, .22],
  inputMix: [0, 1, .8], inputGain: [0, 4, 1],
  timingBend: [-1, 1, 0], shapeToMod: [-16, 16, 0], stereoWidth: [0, 2, 1],
};
const KEYS = Object.keys(BOUNDS);
const MAX_VOICES = 32;
const PARTIALS = 48;
const DELAY_TAPS = 48;
const NOISE_OCTAVES = 24;
const SHEPARD_PARTIALS = 12;
const LEGACY_LEVELS = 12;
const BELL_RATIOS = [1, 2.756, 5.404, 8.933];
const clamp = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(Number(x)) ? Number(x) : a));
const fract = (x) => x - Math.floor(x);
const sine = (phase) => Math.sin(TAU * phase);
const curve = (x) => x * x * (3 - 2 * x);

export function sanitizeDSPState(input = {}) {
  input = input && typeof input === 'object' ? input : {};
  const state = {};
  for (const [key, [min, max, fallback]] of Object.entries(BOUNDS)) {
    state[key] = clamp(input[key] ?? fallback, min, max);
  }
  state.branchAngle = wrapDegrees(input.branchAngle);
  state.seed = Math.round(state.seed);
  state.depth = Math.round(state.depth);
  state.mode = MODES.includes(input.mode) ? input.mode : 'wander';
  state.engine = DSP_ENGINES[state.mode].includes(input.engine) ? input.engine : DSP_ENGINES[state.mode][0];
  Object.assign(state, sanitizeModulatorState(input, state.mode), sanitizeMotionState(input));
  state.pitchInvert = input.pitchInvert === true;
  state.stereoFlip = input.stereoFlip === true;
  state.direction = input.direction === -1 ? -1 : 1;
  state.loop = input.loop !== false;
  state.pingPong = input.pingPong === true;
  state.synthesis = input.synthesis === 'pm' ? 'pm' : 'fm';
  return state;
}

function hash(index, seed) {
  let x = Math.imul(index | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 2147483648 - 1;
}

function correlated(t, seed, roughness, depth) {
  let sum = 0, weight = 1, total = 0;
  for (let i = 0; i < depth; i += 1) {
    const n = Math.floor(t), u = curve(t - n);
    sum += (hash(n, seed + i * 1009) * (1 - u) + hash(n + 1, seed + i * 1009) * u) * weight;
    total += weight;
    weight *= .18 + roughness * .76;
    // Retain the existing octave coordinates, then layer new seeds at the
    // highest retained scale instead of losing lattice precision.
    if (i < NOISE_OCTAVES - 1) t *= 2;
  }
  return sum / Math.max(1, total);
}

/** Original, deterministic struck/rasping source: no fetched recordings. */
export function createFractalSource(sampleRate = 16000, seconds = 2) {
  const sr = clamp(sampleRate, 8000, 96000);
  const source = new Float32Array(Math.round(sr * clamp(seconds, .1, 12)));
  let random = 73517, low = 0;
  for (let i = 0; i < source.length; i += 1) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const t = i / sr, beat = fract(t * 3.1), noise = random / 2147483648 - 1;
    low += (noise - low) * .22;
    const body = Math.sin(TAU * (94 * t + 8 * Math.sin(t * 2.7))) * Math.exp(-beat * 11);
    const wire = Math.sin(TAU * 287.3 * t) * Math.exp(-fract(t * 5.2) * 19);
    source[i] = .43 * body + .17 * wire + .13 * low * (.1 + Math.exp(-beat * 26));
  }
  return source;
}

function filterCoefficients(frequency, q, sr) {
  const w = TAU * clamp(frequency, 20, sr * .43) / sr;
  const alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  return [alpha / a0, -2 * Math.cos(w) / a0, (1 - alpha) / a0];
}

/** The built-in texture uses energies actually measured from its source. */
function sourceProfile(source, sr) {
  const energies = new Float64Array(16), envelope = new Float64Array(64);
  for (let band = 0; band < 16; band += 1) {
    const [b0, a1, a2] = filterCoefficients(40 * 300 ** (band / 15), 1.6, sr);
    let z1 = 0, z2 = 0, power = 0;
    for (let i = 0; i < source.length; i += 1) {
      const x = source[i], y = b0 * x + z1;
      z1 = -a1 * y + z2;
      z2 = -b0 * x - a2 * y;
      power += y * y;
    }
    energies[band] = Math.sqrt(power / source.length);
  }
  for (let i = 0; i < source.length; i += 1) {
    envelope[Math.min(63, Math.floor(i / source.length * 64))] += source[i] ** 2;
  }
  const max = Math.max(...energies, 1e-8);
  for (let i = 0; i < 16; i += 1) energies[i] /= max;
  const peak = Math.sqrt(Math.max(...envelope, 1e-8));
  for (let i = 0; i < 64; i += 1) envelope[i] = Math.sqrt(envelope[i]) / peak;
  return { bands: Array.from(energies), envelope: Array.from(envelope) };
}

let originalSource;
let originalProfile;
function defaults() {
  if (!originalSource) {
    originalSource = createFractalSource();
    originalProfile = sourceProfile(originalSource, 16000);
  }
  return { source: originalSource, profile: originalProfile };
}

export function cleanEvents(structure, state) {
  if (!Array.isArray(structure?.events)) {
    return Array.from({ length: 16 }, (_, i) => ({
      endpoint: i === 0,
      phase: state.timingBend ? (i / 16) ** (2 ** (2 * state.timingBend)) : i / 16, freq: state.base * 2 ** (hash(i, state.seed) * state.span * .5 * (state.pitchInvert ? -1 : 1)),
      amp: .4 + .4 * (1 - i % 4 / 4), duration: .08 + state.release * .2,
      pan: hash(i + 11, state.seed) * .7, depth: i % state.depth, point: i, shape: hash(i, state.seed),
    }));
  }
  return structure.events.slice(0, 384).map((event) => ({
    endpoint: event.phase === 0 || event.phase === 1,
    phase: clamp(event.phase, 0, 1 - 1e-10), freq: clamp(event.freq, 15, 20000),
    amp: clamp(event.amp ?? .6, 0, 1), duration: clamp(event.duration ?? .12, .001, 16),
    pan: clamp(event.pan ?? 0, -1, 1), depth: clamp(event.depth ?? 0, 0, 48),
    point: Math.max(0, Math.floor(event.point ?? 0)),
    shape: clamp(event.shape ?? ((structure.points?.[event.point]?.y ?? .5) - .5) * 2, -1, 1),
  })).sort((a, b) => a.phase - b.phase);
}

function voice(sr) {
  return { active: false, type: 0, engine: '', age: 0, gate: .1, length: .2,
    attack: .003, decay: .08, sustain: .1, release: .06, releaseStart: 0,
    amp: 0, freq: 1, shape: 0, currentFreq: 440, panL: .707, panR: .707, depth: 0,
    p0: 0, p1: 0, p2: 0, source: 0, micSource: 0, sourceStep: 1,
    low: 0, micLow: 0, res1: 0, res2: 0, micRes1: 0, micRes2: 0,
    rb0: 0, ra1: 0, ra2: 0, string: new Float32Array(Math.ceil(sr / 16) + 4),
    micString: new Float32Array(Math.ceil(sr / 16) + 4), previousMic: 0, stringHead: 0, stringDelay: 100, previous: 0, lastEnvelope: 0, partialPhases: new Float64Array(PARTIALS), lastL: 0, lastR: 0, lastML: 0, lastMR: 0 };
}
function heldEnvelope(v, age) {
  if (age < v.attack) return curve(age / v.attack);
  const decay = Math.max(0, 1 - (age - v.attack) / v.decay);
  return v.sustain + (1 - v.sustain) * decay * decay;
}
function envelope(v) {
  if (v.age < v.gate) return heldEnvelope(v, v.age);
  const release = Math.max(0, 1 - (v.age - v.gate) / v.release);
  return v.releaseStart * release * release;
}

export class FractalDSP {
  constructor(sampleRate = 48000, state = {}, structure) {
    this.sampleRate = clamp(sampleRate, 8000, 192000);
    this.dt = 1 / this.sampleRate;
    this.state = sanitizeDSPState(state);
    this.smooth = { ...this.state };
    this.branchProjection = {};
    this.branchTurns = null;
    this.branchTurnsTarget = createBranchTurnsTarget();
    this.branchProjectionTurns = this.state.turns;
    this.rootCarrierTracked = false;
    this.pitchPolarity = this.state.pitchInvert ? -1 : 1;
    this.stereoSide = this.state.stereoWidth * (this.state.stereoFlip ? -1 : 1);
    this.phase = this.time = this.motionTime = 0;
    this.lfoPhases = new Float64Array(2);
    this.motions = createMotions(this.state);
    this.motionState = { ...this.state };
    this.motionReadout = {};
    this.motionTransport = { values: {}, directions: {} };
    this.motionBank = null;
    this.motionFrameIndex = -1;
    this.motionExpectedVersion = -1;
    this.motionLatestVersion = -1;
    this.motionAdvanceOptions = { branchReady: false, turnsReady: false };
    this.modulated = {};
    this.modulationReadout = {};
    this.travelDirection = 1;
    this.completed = this.releasing = false;
    this.completionAge = this.tailQuietTime = 0;
    this.completionRelease = this.state.release;
    this.playing = false;
    this.playGain = 0;
    this.level = this.levelSmooth = .55;
    this.outputStage = new FractalOutput(this.sampleRate, outputMakeup(this.state));
    this.microphone = false;
    this.micBlend = 0;
    this.textureToneMix = this.state.engine === 'resonant' ? 1 : 0;
    this.inputPower = 0;
    this.inputBands = new Float32Array(16);
    this.analysisB = new Float64Array(16);
    this.analysisA1 = new Float64Array(16);
    this.analysisA2 = new Float64Array(16);
    this.analysisZ1 = new Float64Array(16);
    this.analysisZ2 = new Float64Array(16);
    this.bandPower = new Float64Array(16);
    this.micBuffer = new Float32Array(Math.ceil(this.sampleRate * 2));
    this.micHead = 0;
    this.voices = Array.from({ length: MAX_VOICES }, () => voice(this.sampleRate));
    this.osc = new Float64Array(32);
    this.modeWeights = new Float64Array(6);
    this.modeWeights[MODES.indexOf(this.state.mode)] = 1;
    this.delaySize = Math.ceil(this.sampleRate * 8) + 4;
    this.delayL = new Float32Array(this.delaySize);
    this.delayR = new Float32Array(this.delaySize);
    this.micDelayL = new Float32Array(this.delaySize);
    this.micDelayR = new Float32Array(this.delaySize);
    this.delayHead = 0;
    this.tapDelay = new Float64Array(DELAY_TAPS);
    this.tapGain = new Float64Array(DELAY_TAPS);
    this.shepardFreq = new Float64Array(SHEPARD_PARTIALS);
    this.shepardGain = new Float64Array(SHEPARD_PARTIALS);
    this.bandB0 = new Float64Array(16);
    this.bandA1 = new Float64Array(16);
    this.bandA2 = new Float64Array(16);
    this.bandZ1 = new Float64Array(16);
    this.bandZ2 = new Float64Array(16);
    this.bandGain = new Float64Array(16);
    this.bandFrequency = new Float64Array(16);
    this.waveGain = new Float64Array(PARTIALS);
    this.waveOffset = new Float64Array(PARTIALS);
    this.waveHarmonics = new Float64Array(PARTIALS);
    this.additiveRatios = new Float64Array(PARTIALS);
    this.additiveGains = new Float64Array(PARTIALS);
    this.pitchShiftPhases = new Float64Array(DELAY_TAPS);
    this.random = this.state.seed;
    this.chaosX = .1; this.chaosY = .01; this.chaosZ = 20;
    this.modulation = this.modTarget = 0;
    this.eventPitch = this.eventPitchTarget = 1;
    this.eventShape = this.eventShapeTarget = 0;
    this.controlCountdown = 0;
    this.attackTokens = 16;
    this.stealL = this.stealR = this.stealML = this.stealMR = 0;
    this.pendingStart = true;
    this.stoppedCleared = true;
    this.lastL = this.lastR = this.dcXL = this.dcXR = this.dcYL = this.dcYR = 0;
    this.outputLowL = this.outputLowR = 0;
    this.dcCoefficient = Math.exp(-TAU * 15 / this.sampleRate);
    this.lowCoefficient = 1 - Math.exp(-TAU * Math.min(16000, this.sampleRate * .4) / this.sampleRate);
    this.resetBlend = this.resetL = this.resetR = 0;
    this.rms = this.peak = this.activeEvents = 0;
    this.telemetry = { phase: 0, time: 0, rms: 0, peak: 0, activeEvents: 0, inputRms: 0, inputBands: this.inputBands };
    const builtin = defaults();
    this.source = builtin.source;
    this.sourceRate = 16000;
    this.setProfile(builtin.profile);
    this.setState(state, structure);
    for (let i = 0; i < 16; i += 1) {
      const [b, a1, a2] = filterCoefficients(40 * 300 ** (i / 15), 1.6, this.sampleRate);
      this.analysisB[i] = b; this.analysisA1[i] = a1; this.analysisA2[i] = a2;
    }
    this.updateControls();
  }

  setState(input, structure, options = {}) {
    const previous = this.state;
    this.state = sanitizeDSPState(input);
    rebaseMotions(this.motions, previous, this.state, options);
    this.motionState = { ...this.state };
    if (Number.isFinite(options.motionBankVersion)) this.motionExpectedVersion = options.motionBankVersion;
    // Manual Branching edits and preset recall need their exact supplied frame.
    // Other edits may keep the previous complete bank until its replacement arrives.
    if (options.resetMotions || previous.branch !== this.state.branch || this.motionBank?.mode !== this.state.mode) this.motionBank = null;
    this.motionFrameIndex = -1;
    this.modulatorSlots = modulatorSettings(this.state);
    this.modulationReadout = {};
    this.outputStage.setMakeup(outputMakeup(this.state));
    this.branchBaseGeometry = Array.isArray(structure?.branchGeometry) ? structure.branchGeometry.slice(0, 768) : null;
    this.branchTurns = validBranchTurns(structure?.branchTurns, this.branchBaseGeometry?.length ?? 0) ? structure.branchTurns : null;
    this.refreshBranchProjection();
    if (this.state.depth > 24) this.trimExpensiveVoices(this.expensiveVoiceLimit());
    this.events = cleanEvents(structure, this.state);
    this.scoreBase = this.state.base;
    this.seekEvents(false);
    this.selectBranchFrame();
    if (structure?.profile) this.setProfile(structure.profile);
  }
  /** Atomic publication only. Frames have already been cleaned and sorted off-thread. */
  setMotionBank(bank) {
    if (!bank || !Number.isFinite(bank.version) || bank.version < this.motionExpectedVersion
      || bank.version <= this.motionLatestVersion || bank.mode !== this.state.mode
      || !Number.isFinite(bank.base) || bank.base < 20 || bank.base > 8000
      || !Array.isArray(bank.frames) || bank.frames.length < 65 || bank.frames.length > 66) return false;
    let previous = -1, integers = 0;
    for (const frame of bank.frames) {
      if (!Number.isFinite(frame?.branch) || frame.branch < 0 || frame.branch > 64 || frame.branch <= previous
        || !Array.isArray(frame.events) || frame.events.length > 384
        || (frame.branchGeometry != null && (!Array.isArray(frame.branchGeometry) || frame.branchGeometry.length > 768))) return false;
      if (frame.branchTurns != null && !validBranchTurns(frame.branchTurns, frame.branchGeometry?.length ?? 0)) return false;
      if (Number.isInteger(frame.branch)) integers++;
      previous = frame.branch;
      let phase = -1;
      for (const event of frame.events) {
        if (!Number.isFinite(event?.phase) || event.phase < phase || event.phase < 0 || event.phase >= 1
          || !Number.isFinite(event.freq) || !Number.isFinite(event.amp) || !Number.isFinite(event.duration)
          || !Number.isFinite(event.pan) || !Number.isFinite(event.depth) || !Number.isFinite(event.point) || !Number.isFinite(event.shape)) return false;
        phase = event.phase;
      }
    }
    if (integers !== 65) return false;
    this.motionBank = bank;
    this.motionLatestVersion = bank.version;
    this.motionFrameIndex = -1;
    this.selectBranchFrame();
    return true;
  }
  selectBranchFrame() {
    if (!this.motionBank) return;
    const index = selectMotionFrame(this.motionBank, this.motions.actual.branch);
    if (index < 0 || index === this.motionFrameIndex) return;
    // A loop start may still be due at this exact phase. Keep its outer attack
    // without reviving an endpoint already consumed before a ping-pong turn.
    const pending = this.events?.[this.nextEvent];
    const dueOuter = pending?.endpoint && Math.abs(pending.phase - this.phase) <= 1e-9
      && (pending === this.events[0] || pending === this.events[this.events.length - 1]);
    const frame = this.motionBank.frames[index];
    this.events = frame.events;
    this.branchBaseGeometry = frame.branchGeometry;
    this.branchTurns = frame.branchTurns ?? null;
    this.scoreBase = this.motionBank.base;
    this.motionFrameIndex = index;
    this.seekEvents(false);
    if (dueOuter) this.seekEvents(true);
    this.refreshBranchProjection();
  }
  refreshBranchProjection() {
    this.branchGeometry = this.branchBaseGeometry;
    this.branchProjectionTurns = this.branchTurns ? this.motions.actual.turns : this.state.turns;
    if (this.state.mode === 'grammar' && this.branchTurns && this.branchProjectionTurns !== this.branchTurns.turns) {
      this.branchGeometry = branchTurnsGeometry(this.branchTurns, this.branchProjectionTurns, this.branchTurnsTarget);
    }
    if (this.state.mode === 'grammar' && this.branchGeometry) branchFrame(this.branchGeometry, this.smooth.branchAngle, this.branchProjection);
  }
  setProfile(profile) {
    const builtin = originalProfile;
    const bands = Array.isArray(profile?.bands) || ArrayBuffer.isView(profile?.bands) ? profile.bands : builtin.bands;
    const envelopeValues = Array.isArray(profile?.envelope) || ArrayBuffer.isView(profile?.envelope) ? profile.envelope : builtin.envelope;
    this.profileBands = Float64Array.from({ length: 16 }, (_, i) => clamp(bands[Math.round(i / 15 * (bands.length - 1))] ?? 0, 0, 1));
    this.profileEnvelope = Float64Array.from({ length: 64 }, (_, i) => clamp(envelopeValues[Math.round(i / 63 * (envelopeValues.length - 1))] ?? 0, 0, 1));
  }
  setSource(samples, sampleRate = 48000, profile) {
    if (!samples || samples.length < 32) {
      const builtin = defaults(); this.source = builtin.source; this.sourceRate = 16000; this.setProfile(builtin.profile); return;
    }
    this.sourceRate = clamp(sampleRate, 8000, 192000);
    const length = Math.min(samples.length, 576000, Math.round(this.sourceRate * 12));
    this.source = new Float32Array(length);
    for (let i = 0; i < length; i += 1) this.source[i] = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
    this.setProfile(profile ?? sourceProfile(this.source, this.sourceRate));
  }
  setMicrophone(value) {
    this.microphone = Boolean(value);
    if (this.playGain < 1e-6) this.micBlend = this.microphone ? this.state.inputMix : 0;
  }
  setPlaying(value) {
    const next = Boolean(value);
    if (next && this.completed) this.setPhase(0, { motions: motionSnapshot(this.motions) });
    if (next && !this.playing) this.stoppedCleared = false;
    // Pausing keeps the event cursor and travel leg; resuming cannot repeat an attack.
    this.playing = next;
  }
  seekEvents(includeCurrent) {
    if (this.travelDirection > 0) {
      this.nextEvent = this.events.findIndex((event) => includeCurrent
        ? event.phase >= this.phase - 1e-9 : event.phase > this.phase + 1e-9);
      if (this.nextEvent < 0) this.nextEvent = this.events.length;
    } else {
      this.nextEvent = this.events.length - 1;
      while (this.nextEvent >= 0 && (includeCurrent
        ? this.events[this.nextEvent].phase > this.phase + 1e-9
        : this.events[this.nextEvent].phase >= this.phase - 1e-9)) this.nextEvent -= 1;
    }
  }
  scheduleEvents(limit) {
    if (this.travelDirection > 0) {
      while (this.nextEvent < this.events.length && this.events[this.nextEvent].phase <= limit + 1e-9) {
        this.trigger(this.events[this.nextEvent++]);
      }
    } else {
      while (this.nextEvent >= 0 && this.events[this.nextEvent].phase >= limit - 1e-9) {
        this.trigger(this.events[this.nextEvent--]);
      }
    }
  }
  finishTransport() {
    this.playing = false;
    this.completed = this.releasing = true;
    this.pendingStart = false;
    this.completionAge = this.tailQuietTime = 0;
    this.completionRelease = this.smooth.release;
    // Held notes release now. A note still in its attack may finish that attack
    // (or its shorter original gate), so an event in the final fractional sample
    // remains audible. Existing releases and grain window lengths stay intact.
    for (const v of this.voices) {
      if (!v.active || v.age >= v.gate) continue;
      v.gate = Math.min(v.gate, Math.max(v.age, v.attack));
      v.releaseStart = heldEnvelope(v, v.gate);
      if (!(v.type === 2 || (v.type === 5 && v.engine === 'hybrid'))) v.length = Math.min(v.length, v.gate + v.release);
    }
  }
  advanceTransport(step) {
    advanceModulators(this.lfoPhases, this.modulatorSlots, this.dt);
    this.time += this.dt;
    this.motionTime += this.dt * this.travelDirection;
    this.phase += step * this.travelDirection;
    if (this.travelDirection > 0 && this.phase >= 1) {
      if (this.state.pingPong) {
        const overshoot = this.phase - 1;
        this.phase = 1; this.travelDirection = -1; this.seekEvents(false);
        this.phase -= overshoot;
      } else if (this.state.loop) {
        this.phase -= 1; this.nextEvent = 0;
      } else {
        this.phase = 1; this.finishTransport();
      }
    } else if (this.travelDirection < 0 && this.phase <= 0) {
      if (this.state.loop) {
        const overshoot = -this.phase;
        this.phase = 0; this.travelDirection = 1; this.seekEvents(false);
        this.phase += overshoot;
      } else {
        this.phase = 0; this.finishTransport();
      }
    }
  }
  clearStoppedAudio() {
    for (const v of this.voices) v.active = false;
    this.delayL.fill(0); this.delayR.fill(0); this.micDelayL.fill(0); this.micDelayR.fill(0);
    this.bandZ1.fill(0); this.bandZ2.fill(0);
    this.dcXL = this.dcXR = this.dcYL = this.dcYR = this.outputLowL = this.outputLowR = 0;
    this.outputStage.clear();
    this.stealL = this.stealR = this.stealML = this.stealMR = 0;
    this.stoppedCleared = true;
  }
  tailDelay() {
    // A quiet gap must cover the longest audible delay before clearing memory;
    // otherwise a sparse late tap would be mistaken for the end of the tail.
    let longest = this.smooth.space > 1e-6 ? .277 : 0;
    if (this.modeWeights[4] > .0001) {
      for (let i = 0; i < this.tapGain.length; i += 1) if (this.tapGain[i] > 1e-7) {
        longest = Math.max(longest, Math.min(7.98, this.tapDelay[i] / this.sampleRate * 1.009) + .075);
      }
    }
    return longest + .05;
  }
  setLevel(value) {
    this.level = clamp(value, 0, 1);
    if (this.playGain === 0) this.levelSmooth = this.level;
  }
  setPhase(value, transport = {}) {
    transport = transport && typeof transport === 'object' ? transport : {};
    this.resetL = this.lastL; this.resetR = this.lastR; this.resetBlend = 1;
    this.phase = clamp(value, 0, 1);
    for (let i = 0; i < 2; i++) this.lfoPhases[i] = fract(Number.isFinite(transport.modPhases?.[i]) ? transport.modPhases[i] : 0);
    this.motions = createMotions(this.state, transport.motions);
    this.selectBranchFrame();
    this.travelDirection = transport.travelDirection === -1 ? -1 : 1;
    this.completed = transport.completed === true;
    this.releasing = false;
    this.completionAge = this.tailQuietTime = 0;
    this.time = Number.isFinite(transport.time) ? Math.max(0, transport.time) : this.phase * this.state.phrase / this.state.rate;
    this.motionTime = Number.isFinite(transport.motionTime) ? transport.motionTime : this.phase * this.state.phrase / this.state.rate;
    if (this.completed) this.playing = false;
    this.random = this.state.seed;
    this.chaosX = .1; this.chaosY = .01; this.chaosZ = 20;
    this.osc.fill(0);
    this.rootCarrierTracked = false;
    this.outputStage.clear();
    for (const v of this.voices) v.active = false;
    this.delayL.fill(0); this.delayR.fill(0); this.micDelayL.fill(0); this.micDelayR.fill(0);
    this.delayHead = 0;
    this.bandZ1.fill(0); this.bandZ2.fill(0);
    this.modulation = this.modTarget = 0;
    this.eventPitch = this.eventPitchTarget = 1;
    this.eventShape = this.eventShapeTarget = 0;
    this.dcXL = this.dcXR = this.dcYL = this.dcYR = this.outputLowL = this.outputLowR = 0;
    this.attackTokens = 16;
    this.controlCountdown = 0;
    this.pendingStart = true;
    this.seekEvents(true);
  }
  noise() { this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0; return this.random / 2147483648 - 1; }

  expensiveVoiceLimit() { return Math.max(4, Math.floor(192 / Math.max(24, this.state.depth))); }
  trimExpensiveVoices(limit) {
    let count = 0;
    for (const v of this.voices) if (v.active && (v.type === 3 || v.engine === 'additive')) count += 1;
    while (count > limit) {
      let quietest = null, energy = Infinity;
      for (const v of this.voices) {
        if (!v.active || !(v.type === 3 || v.engine === 'additive')) continue;
        const value = v.lastEnvelope * v.amp + (v.age < .015 ? 10 : 0);
        if (value < energy) { quietest = v; energy = value; }
      }
      if (!quietest) break;
      // Reuse the short voice-steal tail when a deeper bank needs fewer voices.
      // The clock, note cursor and all retained voices continue uninterrupted.
      this.stealL = clamp(this.stealL + quietest.lastL, -.6, .6); this.stealR = clamp(this.stealR + quietest.lastR, -.6, .6);
      this.stealML = clamp(this.stealML + quietest.lastML, -.6, .6); this.stealMR = clamp(this.stealMR + quietest.lastMR, -.6, .6);
      quietest.active = false; count -= 1;
    }
  }

  trigger(event, cloudOffset = 0) {
    // Protect only the actual outer attack, including the last-arriving member
    // of a tied endpoint group. Its single borrowed token is repaid before
    // later interior attacks; cloud children retain ordinary admission.
    const endpoint = cloudOffset === 0 && (this.state.pingPong || this.travelDirection < 0) && event.endpoint
      && (event.phase === 0 ? event === this.events[0] : event === this.events[this.events.length - 1]);
    if (this.attackTokens < (endpoint ? 0 : 1)) return;
    const type = MODES.indexOf(this.state.mode);
    const expensive = type === 3 || (type === 0 && this.state.engine === 'additive');
    const expensiveLimit = expensive ? (this.state.depth > 24 ? this.expensiveVoiceLimit() : 8) : MAX_VOICES;
    if (expensive && this.state.depth > 24) this.trimExpensiveVoices(expensiveLimit - 1);
    let activeForType = 0;
    for (const candidate of this.voices) if (candidate.active && candidate.type === type) activeForType += 1;
    let v = activeForType >= expensiveLimit ? null : this.voices.find((candidate) => !candidate.active);
    if (!v) {
      let quietest = Infinity;
      for (const candidate of this.voices) {
        if (!candidate.active) continue;
        if (activeForType >= expensiveLimit && candidate.type !== type) continue;
        const energy = candidate.lastEnvelope * candidate.amp + (candidate.age < .015 ? 10 : 0);
        if (energy < quietest) { v = candidate; quietest = energy; }
      }
      if (!v) return;
      // Retire an inaudible/old voice through a 12ms tail instead of freezing new attacks.
      this.stealL = clamp(this.stealL + v.lastL, -.6, .6); this.stealR = clamp(this.stealR + v.lastR, -.6, .6);
      this.stealML = clamp(this.stealML + v.lastML, -.6, .6); this.stealMR = clamp(this.stealMR + v.lastMR, -.6, .6);
    }
    this.attackTokens -= 1;
    const s = this.smooth;
    let eventFrequency = event.freq, shape = event.shape;
    if (type === 1 && this.branchGeometry && (this.motionBank || this.branchGeometry === this.branchTurnsTarget || s.branchAngle !== 0 || this.state.branchAngle !== 0)) {
      const pitch = branchPitch(this.branchGeometry, event.point, this.branchProjection);
      eventFrequency = clamp(this.state.base * 2 ** ((this.state.pitchInvert ? -pitch : pitch) * this.state.span), 20, 20000);
      shape = (branchShape(this.branchGeometry, event.point, this.branchProjection) - .5) * 2;
    }
    if (this.scoreBase !== this.state.base && !(type === 1 && this.branchGeometry && (this.motionBank || this.branchGeometry === this.branchTurnsTarget || s.branchAngle !== 0 || this.state.branchAngle !== 0))) eventFrequency *= this.state.base / this.scoreBase;
    const effectiveFrequency = eventFrequency * (s.base / this.state.base);
    this.eventPitchTarget = eventFrequency / this.state.base;
    this.eventShapeTarget = shape;
    v.shape = shape;
    v.active = true; v.type = type; v.engine = this.state.engine; v.age = 0;
    v.depth = event.depth;
    v.amp = event.amp * (type === 1 ? (1 - s.generationLoss * .91) ** (event.depth * .4) : 1);
    v.freq = eventFrequency / this.state.base * 2 ** (cloudOffset * s.spray * .65);
    v.currentFreq = type === 0 && s.glide > .001 ? this.eventPitch * s.base : effectiveFrequency;
    v.partialPhases.fill(0);
    v.lastL = v.lastR = v.lastML = v.lastMR = 0;
    v.p0 = 0; v.p1 = event.depth * .173; v.p2 = fract(event.phase + s.x);
    const pan = clamp(event.pan + cloudOffset * .4, -1, 1);
    v.panL = Math.sqrt((1 - pan) * .5); v.panR = Math.sqrt((1 + pan) * .5);
    v.attack = s.attack; v.decay = s.decay; v.sustain = s.sustain; v.release = s.release;
    v.gate = Math.max(.002, event.duration);
    v.length = v.gate + v.release;
    v.releaseStart = heldEnvelope(v, v.gate);
    v.low = v.micLow = v.res1 = v.res2 = v.micRes1 = v.micRes2 = 0;
    v.lastEnvelope = 0;
    const freq = clamp(effectiveFrequency, 16, this.sampleRate * .35);
    [v.rb0, v.ra1, v.ra2] = filterCoefficients(freq, type === 1 ? 3 + s.turns : 2 + s.memory * 10, this.sampleRate);
    if (type === 2 || (type === 5 && v.engine === 'hybrid')) {
      v.length = clamp(s.grainSize * (.6 + event.duration * s.rate) * (.78 + .22 * 2 ** (-event.depth * .25)), .005, 1.5);
      v.gate = v.length * .7;
      v.releaseStart = heldEnvelope(v, v.gate);
      v.source = fract(s.scan + event.phase * s.x + this.noise() * s.spray * .3) * this.source.length;
      v.micSource = this.micHead - (.025 + s.scan * 1.65 + Math.abs(this.noise()) * s.spray * .28) * this.sampleRate;
      v.sourceStep = clamp(effectiveFrequency / 110, .0625, 32) * 2 ** (cloudOffset * s.spray * .65) * this.state.direction * this.travelDirection;
    }
    if (v.engine === 'pluck') {
      v.stringDelay = Math.min(v.string.length - 2, Math.max(2, this.sampleRate / freq));
      v.stringHead = Math.ceil(v.stringDelay); v.previous = v.previousMic = 0;
      const length = Math.ceil(v.stringDelay) + 1;
      v.string.fill(0); v.micString.fill(0);
      for (let i = 0; i < length; i += 1) {
        v.string[i] = (this.noise() * .55 + sine(i / v.stringDelay) * .3) * (.5 + .5 * s.roughness / 1.8);
        v.micString[i] = this.sampleBuffer(this.micBuffer, this.micHead - length + i);
      }
    }
    if (type === 2 && v.engine === 'cloud' && cloudOffset === 0) {
      this.trigger(event, -.7); this.trigger(event, .7);
    }
  }

  updateControls() {
    const s = this.smooth;
    const playedPhase = this.state.direction < 0 ? fract(1 - this.phase) : this.phase;
    const scorePhase = s.timingBend ? playedPhase ** (2 ** (-2 * s.timingBend)) : playedPhase;
    const mappedIndex = s.shapeToMod ? clamp(s.index + this.eventShape * s.shapeToMod, 0, 32) : s.index;
    this.modTarget = correlated(scorePhase * (1.5 + s.x * 9), this.state.seed, Math.min(3, s.roughness), this.state.depth);
    const step = Math.min(.004, 32 / this.sampleRate * (.5 + s.chaos));
    const dx = 10 * (this.chaosY - this.chaosX), dy = this.chaosX * (28 - this.chaosZ) - this.chaosY, dz = this.chaosX * this.chaosY - 8 / 3 * this.chaosZ;
    this.chaosX = clamp(this.chaosX + dx * step, -35, 35);
    this.chaosY = clamp(this.chaosY + dy * step, -45, 45);
    this.chaosZ = clamp(this.chaosZ + dz * step, 0, 65);
    let waveTotal = 0;
    for (let i = 0; i < PARTIALS; i += 1) {
      this.waveHarmonics[i] = s.partialRatio ** i;
      this.additiveRatios[i] = 1 + i * (1.15 + s.roughness * .7);
      this.additiveGains[i] = 1 / (1 + i) ** (1.1 + s.y);
      this.waveGain[i] = clamp(s.depth - i, 0, 1) * (.20 + .68 * s.roughness) ** i;
      waveTotal += this.waveGain[i];
      this.waveOffset[i] = i === 0 ? 0 : ((s.x - .5) * i * 1.7 + s.index * .12 * Math.sin(i * s.ratio) + (this.state.seed % 97) / 97 * i * .4) / TAU;
    }
    for (let i = 0; i < SHEPARD_PARTIALS; i += 1) {
      const u = fract(this.motionTime * s.sweepRate * this.state.direction / 7 + i / 7 + s.y * .1);
      this.shepardFreq[i] = clamp(s.base * 2 ** ((u * 7 - 3.5) * this.pitchPolarity), 16, this.sampleRate * .35);
      this.shepardGain[i] = i < 7 ? Math.sin(Math.PI * u) ** 2 * clamp(s.depth - i, 0, 1) : 0;
    }
    for (let i = 0; i < DELAY_TAPS; i += 1) {
      this.tapDelay[i] = clamp(s.echoTime * s.echoRatio ** i, .002, 7.9) * this.sampleRate;
      this.tapGain[i] = clamp(s.depth - i, 0, 1) * (.2 + s.memory * .73) ** (i + 1);
    }
    for (let i = 0; i < PARTIALS; i += 1) this.waveGain[i] /= Math.max(1, waveTotal);
    let total = 0;
    for (let i = 0; i < 16; i += 1) {
      const originalPosition = (i / 15) ** (.7 + Math.sqrt(s.ratio) * .16);
      const position = this.pitchPolarity === 1 ? originalPosition : .5 + (originalPosition - .5) * this.pitchPolarity;
      const shift = this.state.synthesis === 'fm' ? this.modulation : sine(this.phase * s.phrase + this.chaosX * .03);
      const freq = clamp(40 * 300 ** position * (s.base / 220) ** .65 * 2 ** (((s.y - .5) * s.span + shift * mappedIndex * .025) * this.pitchPolarity), 20, this.sampleRate * .4);
      this.bandFrequency[i] = freq;
      const w = TAU * freq / this.sampleRate, alpha = Math.sin(w) / (2 * s.bandQ), a0 = 1 + alpha;
      this.bandB0[i] = alpha / a0; this.bandA1[i] = -2 * Math.cos(w) / a0; this.bandA2[i] = (1 - alpha) / a0;
      this.bandGain[i] = this.profileBands[i] * 10 ** (s.tilt * (i / 15 - .5)) * (.12 + .88 * clamp(s.depth * 1.6 - i, 0, 1));
      total += this.bandGain[i] ** 2;
    }
    const normalization = 1 / Math.max(.25, Math.sqrt(total));
    for (let i = 0; i < 16; i += 1) this.bandGain[i] *= normalization;
  }
  delayRead(buffer, delay) {
    const position = (this.delayHead - delay + this.delaySize) % this.delaySize;
    const i = Math.floor(position), mix = position - i;
    return buffer[i] * (1 - mix) + buffer[(i + 1) % this.delaySize] * mix;
  }
  sampleBuffer(buffer, position) {
    const length = buffer.length, p = ((position % length) + length) % length, i = Math.floor(p), mix = p - i;
    return buffer[i] * (1 - mix) + buffer[(i + 1) % length] * mix;
  }

  process(left, right, input) {
    const count = Math.min(left.length, right.length), sr = this.sampleRate, dt = this.dt;
    const smoothing = 1 - Math.exp(-count / (sr * .024));
    motionValues(this.state, this.motions, this.motionReadout);
    Object.assign(this.motionState, this.motionReadout);
    modulatedValues(this.motionState, this.modulatorSlots, this.lfoPhases, this.modulated);
    this.motionAdvanceOptions.branchReady = Boolean(this.motionBank);
    this.motionAdvanceOptions.turnsReady = Boolean(this.branchTurns);
    for (const key of KEYS) {
      const target = this.modulated[key] ?? this.motionState[key];
      if (key === 'branchAngle') {
        const delta = wrapDegrees(target - this.smooth[key] + 180) - 180;
        this.smooth[key] = Math.abs(delta) < 1e-9 ? target : wrapDegrees(this.smooth[key] + delta * smoothing);
      } else if (key === 'scan' && (this.state.motionScanOn || this.motions.actual.scan !== this.state.scan)) {
        const delta = fract(target - this.smooth[key] + .5) - .5;
        this.smooth[key] = Math.abs(delta) < 1e-9 ? target : fract(this.smooth[key] + delta * smoothing);
      } else if (key === 'turns' && this.state.mode === 'grammar' && (this.state.motionTurnsOn || this.motions.actual.turns !== this.state.turns)) {
        const delta = (target - this.smooth[key] + 48) % 32 - 16;
        this.smooth[key] = Math.abs(delta) < 1e-9 ? target : ((this.smooth[key] + delta * smoothing) % 32 + 32) % 32;
      } else this.smooth[key] += (target - this.smooth[key]) * smoothing;
    }
    this.refreshBranchProjection();
    const s = this.smooth, mode = MODES.indexOf(this.state.mode);
    // Keep the original phase evolution when recalling old-range settings.
    const partialCount = Math.min(PARTIALS, Math.max(LEGACY_LEVELS, Math.ceil(s.depth)));
    const tapCount = Math.min(DELAY_TAPS, Math.max(LEGACY_LEVELS, Math.ceil(s.depth)));
    const gainStep = 1 - Math.exp(-dt / (this.playing || this.releasing ? .006 : .028));
    const blendStep = 1 - Math.exp(-dt / .016), modeStep = 1 - Math.exp(-dt / .018);
    const glideStep = 1 - Math.exp(-dt / Math.max(.0002, s.glide));
    const stealDecay = Math.exp(-dt / .012);
    const inputAttack = 1 - Math.exp(-dt / .006), inputRelease = 1 - Math.exp(-dt / Math.max(.01, s.profileMemory));
    let sumSquares = 0, peak = 0;
    for (let sample = 0; sample < count; sample += 1) {
      // These transports run even during phrase pause/completion and silence.
      advanceMotions(this.motions, this.state, dt, this.motionAdvanceOptions);
      this.selectBranchFrame();
      if (this.motionBank) s.branch = this.motionBank.frames[this.motionFrameIndex].branch;
      const raw = this.microphone ? (Number.isFinite(input?.[sample]) ? input[sample] : 0) : 0;
      const microphone = Math.tanh(raw * s.inputGain);
      const micSquare = microphone * microphone;
      this.inputPower += (micSquare - this.inputPower) * (micSquare > this.inputPower ? inputAttack : inputRelease);
      this.micBuffer[this.micHead] = microphone;
      this.micHead = (this.micHead + 1) % this.micBuffer.length;
      if (this.microphone || this.inputPower > 1e-10) {
        for (let band = 0; band < 16; band += 1) {
          const y = this.analysisB[band] * microphone + this.analysisZ1[band];
          this.analysisZ1[band] = -this.analysisA1[band] * y + this.analysisZ2[band];
          this.analysisZ2[band] = -this.analysisB[band] * microphone - this.analysisA2[band] * y;
          const power = y * y;
          this.bandPower[band] += (power - this.bandPower[band]) * (power > this.bandPower[band] ? inputAttack : inputRelease);
          this.inputBands[band] = Math.sqrt(Math.max(0, this.bandPower[band]));
        }
      }
      const targetBlend = this.microphone ? s.inputMix : 0;
      this.micBlend += (targetBlend - this.micBlend) * blendStep;
      this.textureToneMix += ((this.state.engine === 'resonant' ? 1 : 0) - this.textureToneMix) * blendStep;
      if (Math.abs(this.micBlend - targetBlend) < 1e-7) this.micBlend = targetBlend;
      this.playGain += ((this.playing || this.releasing ? 1 : 0) - this.playGain) * gainStep;
      this.levelSmooth += (this.level - this.levelSmooth) * blendStep;
      if (!this.playing && !this.releasing && this.playGain < 1e-7) {
        if (!this.stoppedCleared) this.clearStoppedAudio();
        left[sample] = right[sample] = 0; continue;
      }
      for (let m = 0; m < 6; m += 1) this.modeWeights[m] += ((m === mode ? 1 : 0) - this.modeWeights[m]) * modeStep;
      this.attackTokens = Math.min(16, this.attackTokens + 480 * dt);
      const phaseStep = s.rate / s.phrase * dt;
      if (this.playing) {
        if (this.pendingStart) { this.pendingStart = false; this.seekEvents(true); }
        // Default looping retains the established timing. A finite leg also
        // consumes its final fractional sample, so no endpoint event is lost.
        let limit = this.phase;
        if (this.travelDirection < 0 && this.phase - phaseStep <= 0) limit = 0;
        else if (this.travelDirection > 0 && (!this.state.loop || this.state.pingPong) && this.phase + phaseStep >= 1) limit = 1;
        this.scheduleEvents(limit);
      }
      if (this.controlCountdown-- <= 0) { this.updateControls(); this.controlCountdown = 31; }
      this.modulation += (this.modTarget - this.modulation) * .02;
      this.eventShape += (this.eventShapeTarget - this.eventShape) * .02;
      const pitchTarget = this.state.pitchInvert ? -1 : 1;
      this.pitchPolarity += (pitchTarget - this.pitchPolarity) * blendStep;
      if (Math.abs(pitchTarget - this.pitchPolarity) < 1e-7) this.pitchPolarity = pitchTarget;
      const stereoTarget = (this.modulated.stereoWidth === undefined ? this.state.stereoWidth : s.stereoWidth) * (this.state.stereoFlip ? -1 : 1);
      this.stereoSide += (stereoTarget - this.stereoSide) * blendStep;
      if (Math.abs(stereoTarget - this.stereoSide) < 1e-7) this.stereoSide = stereoTarget;
      this.eventPitch += (this.eventPitchTarget - this.eventPitch) * glideStep;
      const chaotic = this.chaosX / 24 * s.chaos;
      const micEnvelope = Math.sqrt(Math.max(0, this.inputPower));
      let l = this.stealL, r = this.stealR, ml = this.stealML, mr = this.stealMR, textureGate = 0, shepardGate = 0, shepardLeft = 0, shepardRight = 0, scoreGate = 0;
      this.stealL *= stealDecay; this.stealR *= stealDecay; this.stealML *= stealDecay; this.stealMR *= stealDecay;
      let voicesActive = false;
      for (let i = 0; i < MAX_VOICES; i += 1) {
        const v = this.voices[i];
        if (!v.active) continue;
        v.age += dt;
        if (v.age >= v.length) { v.active = false; continue; }
        voicesActive = true;
        const isGrain = v.type === 2 || (v.type === 5 && v.engine === 'hybrid');
        const env = isGrain ? Math.sin(Math.PI * v.age / v.length) ** 2 * envelope(v) : envelope(v);
        v.lastEnvelope = env;
        const gain = env * v.amp * this.modeWeights[v.type];
        scoreGate += gain;
        if (v.type === 5 && !isGrain) { textureGate += gain; continue; }
        if (v.type === 4 && v.engine === 'shepard') { shepardGate += gain; shepardLeft += gain * v.panL; shepardRight += gain * v.panR; continue; }
        const targetFreq = clamp(s.base * v.freq, 16, sr * .37);
        v.currentFreq += (targetFreq - v.currentFreq) * (v.type === 0 ? glideStep : .018);
        const freq = v.currentFreq;
        const modFreq = Math.min(sr * .35, freq * s.ratio);
        const mappedIndex = s.shapeToMod ? clamp(s.index + v.shape * s.shapeToMod, 0, 32) : s.index;
        const index = Math.min(mappedIndex, Math.max(0, sr * .19 / Math.max(freq, modFreq) - 1) * 2.4);
        const deep = sine(v.p2 + chaotic * .07);
        v.p2 = fract(v.p2 + Math.min(sr * .1, s.rate * (.3 + v.depth * .4 + s.branch) * (v.type === 1 ? s.turns : 1)) * dt);
        v.p1 = fract(v.p1 + modFreq * (1 + deep * Math.min(1.5, index * .07)) * dt);
        const modulation = sine(v.p1 + deep * index * .03);
        const carrierStep = freq * (this.state.synthesis === 'fm' ? 1 + Math.min(1.2, index * .10) * modulation : 1) * dt;
        v.p0 = fract(v.p0 + carrierStep);
        let value = 0, micValue = 0;
        if (isGrain) {
          const displacement = this.state.synthesis === 'pm' ? modulation * index * 1.4 : 0;
          const source = this.sampleBuffer(this.source, v.source + displacement);
          const captured = this.sampleBuffer(this.micBuffer, v.micSource + displacement);
          const lowpass = Math.min(.94, .2 + .75 * s.roughness / 1.8);
          v.low += (source - v.low) * lowpass; v.micLow += (captured - v.micLow) * lowpass;
          value = v.low; micValue = v.micLow;
          const speed = v.sourceStep * (this.state.synthesis === 'fm' ? 1 + modulation * Math.min(.7, index * .03) : 1);
          v.source += speed * this.sourceRate / sr; v.micSource += speed;
          if (v.engine === 'resonant') {
            const out = v.rb0 * value + v.res1;
            v.res1 = -v.ra1 * out + v.res2; v.res2 = -v.rb0 * value - v.ra2 * out; value = out * 3;
            const mout = v.rb0 * micValue + v.micRes1;
            v.micRes1 = -v.ra1 * mout + v.micRes2; v.micRes2 = -v.rb0 * micValue - v.ra2 * mout; micValue = mout * 3;
          }
          if (v.type === 5) textureGate += gain * .5;
          value *= 1.5; micValue *= 1.5;
        } else if (v.engine === 'pluck') {
          const stringDelay = clamp(sr / freq * (this.state.synthesis === 'fm' ? 1 + .012 * index * modulation : 1) + (this.state.synthesis === 'pm' ? index * modulation * .6 : 0), 2, v.string.length - 2);
          const p = (v.stringHead - stringDelay + v.string.length) % v.string.length;
          const a = Math.floor(p), f = p - a;
          value = v.string[a] * (1 - f) + v.string[(a + 1) % v.string.length] * f;
          v.string[v.stringHead] = (value + v.previous) * .5 * (.962 + s.memory * .037);
          micValue = v.micString[a] * (1 - f) + v.micString[(a + 1) % v.micString.length] * f;
          v.micString[v.stringHead] = (micValue + v.previousMic) * .5 * (.962 + s.memory * .037);
          v.previousMic = micValue; micValue *= 2.8;
          v.previous = value; v.stringHead = (v.stringHead + 1) % v.string.length;
          value *= 2.8;
        } else if (v.engine === 'bell' || (v.type === 4 && v.engine === 'resonant')) {
          for (let partial = 0; partial < 4; partial += 1) {
            const ratio = BELL_RATIOS[partial] * (1 + partial * s.roughness * .06);
            v.partialPhases[partial] = fract(v.partialPhases[partial] + carrierStep * ratio);
            if (freq * ratio < sr * .39) value += sine(v.partialPhases[partial] + partial * .11 + (this.state.synthesis === 'pm' ? index * .035 * modulation : 0)) * Math.exp(-v.age * partial * (.4 + s.generationLoss * 8)) / (1 + partial * 1.5);
          }
        } else if (v.engine === 'additive') {
          for (let partial = 0; partial < Math.min(PARTIALS, this.state.depth); partial += 1) {
            const ratio = this.additiveRatios[partial];
            v.partialPhases[partial] = fract(v.partialPhases[partial] + carrierStep * ratio);
            if (freq * ratio < sr * .4) {
              const harmonic = sine(v.partialPhases[partial] + v.p2 * partial * .1 + (this.state.synthesis === 'pm' ? index * .035 * modulation : 0));
              if (this.micBlend < .99999) value += harmonic * this.additiveGains[partial];
              micValue += harmonic * this.inputBands[Math.min(15, partial + 2)] * this.additiveGains[partial] * 2;
            }
          }
          value *= .65;
        } else if (v.type === 3) {
          let weight = 0;
          // The folded branch evaluates a second half-sample, then averages.
          // This is a bounded oversampling approximation, not exact bandlimiting.
          const passes = v.engine === 'folded' ? 2 : 1;
          for (let pass = 0; pass < passes; pass += 1) {
            let shape = 0, sum = 0;
            for (let partial = 0; partial < partialCount; partial += 1) {
              if (v.engine === 'hollow' && partial % 2) continue;
              const ratio = this.waveHarmonics[partial];
              if (freq * ratio * (1 + Math.min(1.2, index * .10)) >= sr * .39) break;
              const gain = this.waveGain[partial] / (v.engine === 'hollow' ? 1 + .45 * partial : 1);
              if (pass === 0) v.partialPhases[partial] = fract(v.partialPhases[partial] + carrierStep * ratio);
              const phase = v.partialPhases[partial] + (pass ? carrierStep * .5 * ratio : 0) + this.waveOffset[partial] + (this.state.synthesis === 'pm' ? index * .017 * modulation : 0);
              shape += sine(phase) * gain; sum += gain;
            }
            // Normalize the audible subtotal even when deeper, ultrasonic levels
            // carry most of the bank weight; recursion must not mute its fundamental.
            if (s.depth > 24 || s.roughness > 1.8) shape = sum > 0 ? shape / sum : 0;
            else shape /= Math.max(1e-12, sum);
            if (v.engine === 'folded') shape = Math.asin(Math.sin(shape * (1 + s.fold * 2) * Math.PI / 2)) * 2 / Math.PI;
            value += shape / passes; weight = sum;
          }
          if (!weight) value = 0;
          const shapedMic = Math.asin(Math.sin(microphone * (1 + s.fold * 2) * Math.PI / 2)) * 2 / Math.PI;
          micValue = shapedMic * (.4 * value + .6 * sine(v.p0));
        } else {
          value = sine(v.p0 + (this.state.synthesis === 'pm' ? index * .105 * modulation : 0));
          if (v.type === 4) value *= .6 + .4 * Math.exp(-v.age * 40);
        }
        if (!isGrain && v.type !== 3 && v.engine !== 'pluck' && v.engine !== 'additive') {
          if (v.type === 0) {
            micValue = sine(v.p0 + microphone * (.6 + mappedIndex * .28) + modulation * s.chaos * .1) * micEnvelope * 1.8;
          } else {
            const filtered = v.rb0 * microphone + v.micRes1;
            v.micRes1 = -v.ra1 * filtered + v.micRes2;
            v.micRes2 = -v.rb0 * microphone - v.ra2 * filtered;
            micValue = filtered * (v.engine === 'bell' ? sine(v.p0 * 1.618) * 4 : 3);
          }
        }
        const amplitude = gain * (isGrain ? .48 : .22);
        v.lastL = value * amplitude * v.panL; v.lastR = value * amplitude * v.panR;
        v.lastML = micValue * amplitude * v.panL; v.lastMR = micValue * amplitude * v.panR;
        l += v.lastL; r += v.lastR; ml += v.lastML; mr += v.lastMR;
      }
      if (shepardGate > 0) {
        this.osc[12] = fract(this.osc[12] + Math.min(sr * .3, s.base * s.ratio) * dt);
        this.osc[13] = fract(this.osc[13] + s.rate * (.3 + s.branch) * dt);
        const mappedIndex = s.shapeToMod ? clamp(s.index + this.eventShape * s.shapeToMod, 0, 32) : s.index;
        const mod = sine(this.osc[12] + mappedIndex * .04 * sine(this.osc[13]));
        for (let i = 0; i < SHEPARD_PARTIALS; i += 1) {
          const index = Math.min(mappedIndex * (.4 + s.roughness * .35), Math.max(0, sr * .19 / this.shepardFreq[i] - 1));
          this.osc[i] = fract(this.osc[i] + this.shepardFreq[i] * (this.state.synthesis === 'fm' ? 1 + Math.min(.9, index * .06) * mod : 1) * dt);
          const value = sine(this.osc[i] + (this.state.synthesis === 'pm' ? index * .035 * mod : 0)) * this.shepardGain[i] * .075;
          l += value * Math.min(1.7, shepardLeft) * (.55 + i / SHEPARD_PARTIALS * .3); r += value * Math.min(1.7, shepardRight) * (.85 - i / SHEPARD_PARTIALS * .3);
        }
      }
      if (textureGate > 0 || this.modeWeights[5] > .001) {
        const noise = this.noise(), gate = Math.min(1.8, textureGate);
        const read = fract(this.phase * (1 + s.x * 3)) * 63, e = Math.floor(read), u = read - e;
        const profiled = this.profileEnvelope[e] * (1 - u) + this.profileEnvelope[Math.min(63, e + 1)] * u;
        for (let i = 0; i < 16; i += 1) {
          const y = this.bandB0[i] * noise + this.bandZ1[i];
          this.bandZ1[i] = -this.bandA1[i] * y + this.bandZ2[i]; this.bandZ2[i] = -this.bandB0[i] * noise - this.bandA2[i] * y;
          this.osc[16 + i] = fract(this.osc[16 + i] + this.bandFrequency[i] * dt);
          const tonal = sine(this.osc[16 + i]);
          const sound = tonal * .24 * this.textureToneMix + y * (1.1 + Math.sqrt(s.bandQ)) * (1 - this.textureToneMix);
          const synth = sound * this.bandGain[i] * gate * (.12 + .88 * profiled) * .55;
          const live = this.inputBands[i] * 10 ** (s.tilt * (i / 15 - .5) * .3);
          const captured = (tonal * .8 * this.textureToneMix + y * 5 * (1 - this.textureToneMix)) * live * gate * (.5 + s.roughness * .5);
          l += synth * (i % 2 ? .65 : 1); r += synth * (i % 2 ? 1 : .65);
          ml += captured * (i % 2 ? .65 : 1); mr += captured * (i % 2 ? 1 : .65);
        }
      }
      const echoMix = this.modeWeights[4];
      let el = 0, er = 0, eml = 0, emr = 0, tapWeight = 0;
      if (echoMix > .0001) {
        for (let i = 0; i < tapCount; i += 1) {
          const gain = this.tapGain[i];
          el += this.delayRead(i % 2 ? this.delayR : this.delayL, this.tapDelay[i]) * gain;
          er += this.delayRead(i % 2 ? this.delayL : this.delayR, Math.min(this.tapDelay[i] * 1.009, sr * 7.98)) * gain;
          if (this.state.engine === 'shepard') {
            const register = i < SHEPARD_PARTIALS ? i : i % 7;
            const ratio = clamp(this.shepardFreq[register] / 220, .125, 8);
            const phase = this.pitchShiftPhases[i] = fract(this.pitchShiftPhases[i] + (1 - ratio) * dt / .075);
            const second = fract(phase + .5), window = Math.sin(Math.PI * phase) ** 2;
            const d1 = this.tapDelay[i] + phase * sr * .075, d2 = this.tapDelay[i] + second * sr * .075;
            const leftBuffer = i % 2 ? this.micDelayR : this.micDelayL, rightBuffer = i % 2 ? this.micDelayL : this.micDelayR;
            eml += (this.delayRead(leftBuffer, d1) * window + this.delayRead(leftBuffer, d2) * (1 - window)) * gain * this.shepardGain[register];
            emr += (this.delayRead(rightBuffer, d1) * window + this.delayRead(rightBuffer, d2) * (1 - window)) * gain * this.shepardGain[register];
          } else {
            eml += this.delayRead(i % 2 ? this.micDelayR : this.micDelayL, this.tapDelay[i]) * gain;
            emr += this.delayRead(i % 2 ? this.micDelayL : this.micDelayR, Math.min(this.tapDelay[i] * 1.009, sr * 7.98)) * gain;
          }
          tapWeight += gain;
        }
        const gain = 1 / Math.max(1, tapWeight * .9);
        el *= gain; er *= gain; eml *= gain; emr *= gain;
      }
      const roomL = this.delayRead(this.delayR, sr * .173), roomR = this.delayRead(this.delayL, sr * .277);
      const micRoomL = this.delayRead(this.micDelayR, sr * .173), micRoomR = this.delayRead(this.micDelayL, sr * .277);
      const roomFeedback = s.space * .23 + s.memory * .25;
      this.delayL[this.delayHead] = Math.tanh(l + roomL * roomFeedback + el * s.memory * .42);
      this.delayR[this.delayHead] = Math.tanh(r + roomR * roomFeedback + er * s.memory * .42);
      // Echoes receive the actual live signal; no oscillator stands in for it.
      const completionGate = this.releasing ? Math.max(0, 1 - this.completionAge / this.completionRelease) ** 2 : 1;
      // Once Root is modulated, accumulate the live strike carrier's phase.
      // Multiplying elapsed time by a moving frequency would add time * df/dt.
      if (!this.rootCarrierTracked && (this.modulated.base !== undefined || this.motionReadout.base !== this.state.base)) {
        this.osc[14] = fract(this.time * s.base); this.rootCarrierTracked = true;
      }
      const strikeCarrier = sine(this.rootCarrierTracked ? this.osc[14] : this.time * s.base);
      if (this.rootCarrierTracked && this.playing) this.osc[14] = fract(this.osc[14] + s.base * dt);
      const excitation = completionGate * echoMix * (this.state.engine === 'resonant' ? (ml + mr) * .8 : microphone * .45 * (this.state.engine === 'strikes' ? (.15 + .85 * Math.min(1, scoreGate)) * (.6 + .4 * strikeCarrier) : 1));
      this.micDelayL[this.delayHead] = Math.tanh(ml * (1 - echoMix) + excitation + micRoomL * roomFeedback + eml * s.memory * .42);
      this.micDelayR[this.delayHead] = Math.tanh(mr * (1 - echoMix) + excitation + micRoomR * roomFeedback + emr * s.memory * .42);
      this.delayHead = (this.delayHead + 1) % this.delaySize;
      l += roomL * s.space * .28 + el * echoMix * .95;
      r += roomR * s.space * .28 + er * echoMix * .95;
      ml = ml * (1 - echoMix) + micRoomL * s.space * .28 + eml * echoMix;
      mr = mr * (1 - echoMix) + micRoomR * s.space * .28 + emr * echoMix;
      l = l * (1 - this.micBlend) + ml * this.micBlend;
      r = r * (1 - this.micBlend) + mr * this.micBlend;
      const dcL = l - this.dcXL + this.dcCoefficient * this.dcYL, dcR = r - this.dcXR + this.dcCoefficient * this.dcYR;
      this.dcXL = l; this.dcXR = r; this.dcYL = dcL; this.dcYR = dcR;
      this.outputLowL += this.lowCoefficient * (dcL - this.outputLowL);
      this.outputLowR += this.lowCoefficient * (dcR - this.outputLowR);
      // Preserve the existing full-level coloration; louder output comes from
      // fixed makeup outside the synthesis and feedback loops, not extra drive.
      const drive = this.playGain * 1.65;
      let finishedL = Math.tanh(this.outputLowL * drive) * .88, finishedR = Math.tanh(this.outputLowR * drive) * .88;
      // Matrix the complete wet signal before the stereo-linked limiter. Keep
      // neutral width/handedness bit-identical to the original signal path.
      if (this.stereoSide === -1) { const swap = finishedL; finishedL = finishedR; finishedR = swap; }
      else if (this.stereoSide !== 1) {
        const mid = (finishedL + finishedR) * .5, side = (finishedL - finishedR) * .5 * this.stereoSide;
        finishedL = mid + side; finishedR = mid - side;
      }
      this.outputStage.process(finishedL, finishedR, this.levelSmooth);
      l = this.outputStage.left; r = this.outputStage.right;
      if (this.resetBlend > 0) {
        this.resetBlend = Math.max(0, this.resetBlend - dt / .012);
        l = this.resetL * this.resetBlend + l * (1 - this.resetBlend); r = this.resetR * this.resetBlend + r * (1 - this.resetBlend);
      }
      this.lastL = left[sample] = Number.isFinite(l) ? l : 0;
      this.lastR = right[sample] = Number.isFinite(r) ? r : 0;
      sumSquares += (l * l + r * r) * .5; peak = Math.max(peak, Math.abs(l), Math.abs(r));
      if (this.playing) this.advanceTransport(phaseStep);
      else if (this.releasing) {
        this.completionAge += dt;
        const quiet = this.completionAge >= this.completionRelease && !voicesActive
          && Math.max(Math.abs(l), Math.abs(r), Math.abs(this.outputLowL), Math.abs(this.outputLowR),
            Math.abs(ml), Math.abs(mr), Math.abs(el), Math.abs(er), Math.abs(eml), Math.abs(emr)) < 1e-7;
        this.tailQuietTime = quiet ? this.tailQuietTime + dt : 0;
        if (quiet && this.tailQuietTime >= this.tailDelay()) {
          this.releasing = false; this.playGain = 0; this.clearStoppedAudio();
        }
      }
    }
    this.rms = Math.sqrt(sumSquares / Math.max(1, count)); this.peak = peak;
    this.activeEvents = this.voices.reduce((sum, v) => sum + Number(v.active), 0);
    for (const slot of this.modulatorSlots) if (slot.enabled && slot.depth > 0) this.modulationReadout[slot.target] = this.smooth[slot.target];
    motionValues(this.state, this.motions, this.motionReadout);
    if (this.motionBank) this.motionReadout.branch = this.motionBank.frames[this.motionFrameIndex].branch;
    motionSnapshot(this.motions, this.motionTransport);
    Object.assign(this.telemetry, { motions: this.motionTransport, motionValues: this.motionReadout,
      motionBankVersion: this.motionBank?.version ?? null, motionFrameIndex: this.motionFrameIndex,
      turns: this.branchProjectionTurns, branchAngle: this.smooth.branchAngle, modPhases: this.lfoPhases, modValues: this.modulationReadout, phase: this.phase, time: this.time, motionTime: this.motionTime,
      playing: this.playing, completed: this.completed, releasing: this.releasing,
      travelDirection: this.travelDirection, direction: this.state.direction * this.travelDirection,
      loop: this.state.loop, pingPong: this.state.pingPong, rms: this.rms, peak, activeEvents: this.activeEvents,
      modulation: this.modulation, frequency: s.base * this.eventPitch, inputRms: Math.sqrt(this.inputPower) });
    return this.telemetry;
  }
}
