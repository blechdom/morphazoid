import { normalizeWitchControls, sampleChant, witchClamp, witchHandConfig, applyWitchManualFingers, witchSpoonHeight, witchVoiceAtHeight, witchGhostFrame, WITCH_VOCAL_EFFECTS, WITCH_FLIGHT_EFFECTS, WITCH_DROP_EFFECTS, WITCH_LAUNCH_DURATION, WITCH_TAU } from './witch-model.js';
import { HandDSP } from '../gesticulating-hand/hand-dsp.js';
import { createHandPose, createHandVoices, evaluateHandVoices, handPlayableFrequency, normalizeHandConfig } from '../gesticulating-hand/hand-model.js';
import { RoachPercussion } from '../roach-synth/roach-synth-percussion.js';
import { RoachZing } from '../roach-synth/roach-synth-textures.js';
import { hiccupHeadGestureFrame, physicalVoiceParameters } from '../hiccup-head/hiccup-head.js';
import { SyrinxSourceEngine } from '../../families/syrinx/syrinx-source-models.js';
import { DEFAULT_FM_DRUM_VOICES } from '../fm-drums/fm-drums.js';
import { HYPER_RUBIX_CELL_ORDER, hyperRubixBoundaryCell, hyperRubixTechnoVoiceParameters, hyperRubixStepDurationSeconds } from '../hyper-rubix/hyper-rubix.js';
import { HYPER_RUBIX_PRESET_DEFAULTS } from '../hyper-rubix/preset-state.js';
import { voicePresetState, glottalHarmonics, throatVoiceParameters } from '../../families/tract/throatazoid.js';
import { moireFilterTarget, stableSvfCoefficients } from '../moire-drone/moire-drone.js';
import { barberDelayCurve, barberDelayWindow, sandySyrupTargetRate } from '../../families/barber-delay/barber-delay.js';
import { animalState, interpolateGesture, resolveSourceControls, CALL_GESTURES } from '../../families/syrinx/syrinx.js';
import { TONGUED_BEASTS_FULL_PRESETS } from '../../families/syrinx/voice-presets.js';
import { sampleTongueMotionPreset } from '../../families/syrinx/tongue-performance.js';
import { tongueCavityGuides } from '../../families/syrinx/tongue-physics.js';
import { applyHybrinxTimelinePerformance } from '../hybrinx/hybrinx-timeline.js';
import { resolveCreaturazoidEventState } from '../creaturazoid/creaturazoid.js';
import { ALIEN_LARYNX_FULL_PRESETS } from '../alien-larynx/full-presets.js';
import { DIGESTAZOID_EVENT_PROFILES } from '../digestazoid/digestazoid.js';
import { createBlowholeState, createBlowholeVoicePlan } from '../blowhole/blowhole.js';
import { throatSingingState, ventricularFoldSupercycle, dualFocusTargets } from '../throat-singing/throat-singing.js';
import { JULIE_SAW_DEFAULTS, applyJulieSawPreset, bendToFrequency, julieSawBlade } from '../julie-saw/julie-saw.js';
import { buildPhysicalModalBank } from '../../physical-sounds.js';
import { WitchCatDSP } from './witch-cat-audio.js';
import { WitchVisitorDSP } from './witch-visitors-audio.js';
import { witchCatMeowEnvelope } from './witch-cat-model.js';
import { witchBiteClips, witchBiteVariants, WitchSceneDSP, WitchEyeShock, WitchFabricWind, WitchBlechFlyby } from './witch-scene-audio.js';

const TAU = WITCH_TAU;
const VOICE = Object.freeze({
  mutter: { hz: 139, air: .13, rasp: .23, vibrato: .009, sustain: .24 },
  whisper: { hz: 164, air: .94, rasp: .05, vibrato: .003, sustain: .34 },
  creak: { hz: 69, air: .09, rasp: .88, vibrato: .025, sustain: .3 },
  cackle: { hz: 253, air: .21, rasp: .52, vibrato: .045, sustain: .02 },
  sing: { hz: 252, air: .025, rasp: .015, vibrato: .013, sustain: .86 },
  wail: { hz: 206, air: .08, rasp: .07, vibrato: .022, sustain: .68 },
  chatter: { hz: 187, air: .17, rasp: .38, vibrato: .006, sustain: .015 },
});

class Resonator {
  constructor(rate) { this.rate = rate; this.y1 = 0; this.y2 = 0; this.x1 = 0; this.x2 = 0; this.b = 0; this.a1 = 0; this.a2 = 0; }
  tune(hz, width) {
    const w = TAU * witchClamp(hz, 60, this.rate * .43) / this.rate;
    const alpha = Math.sin(w) * witchClamp(width, 25, 1800) / (2 * Math.max(60, hz));
    const inverse = 1 / (1 + alpha);
    this.b = alpha * inverse; this.a1 = -2 * Math.cos(w) * inverse; this.a2 = (1 - alpha) * inverse;
  }
  next(x) {
    const y = this.b * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

function polyBlep(phase, step) {
  if (phase < step) { const t = phase / step; return t + t - t * t - 1; }
  if (phase > 1 - step) { const t = (phase - 1) / step; return t * t + t + t + 1; }
  return 0;
}

/** The browser worklet and offline tests run this same sample-clock engine.
 * One voice, four bounded effect slots, and fixed delay memory. */
class CauldronDSP {
  constructor(rate = 48000, seed = 0x71c4) {
    this.rate = witchClamp(rate, 8000, 192000, 48000); this.dt = 1 / this.rate;
    this.controls = normalizeWitchControls(); this.enabled = false; this.randomState = seed >>> 0 || 1;
    this.time = 0; this.phase = 0; this.chantPhase = 0; this.osc = 0; this.subOsc = 0;
    this.vibratoPhase = 0; this.wobblePhase = 0; this.speed = 0; this.radius = .5; this.altitude = .5;
    this.fingers = new Float64Array([.5, .5, .5, .5, .5]); this.glass = 0; this.hair = 0; this.nose = .5; this.hat = .5;
    this.spoonTime = 0; this.spoonHeight = .5; this.activeVoice = 'mutter';
    this.spoonSmooth = 1 - Math.exp(-this.dt / .4);
    this.envelope = 0; this.releaseAir = 0; this.lastGate = false; this.sourceLow = 0; this.noiseLow = 0;
    this.hairFriction = 0; this.hairBody = 0; this.hairTail = 0;
    this.hairTailRelease = 1 - Math.exp(-this.dt / .58);
    this.hairFrictionFollow = 1 - Math.exp(-TAU * Math.min(4300, this.rate * .32) * this.dt);
    this.hairBodyFollow = 1 - Math.exp(-TAU * 380 * this.dt);
    this.lastInput = 0; this.dc = 0; this.gain = 0; this.targetHz = 139; this.frequency = 139;
    this.targetAir = .13; this.air = .13; this.targetRasp = .23; this.rasp = .23;
    this.targetSustain = .24; this.sustain = .24; this.targetVibrato = .009; this.vibrato = .009;
    this.articulation = .24 + .76 * .22; this.articulationFollow = 1 - Math.exp(-this.dt / .003);
    this.formants = Array.from({ length: 3 }, () => new Resonator(this.rate));
    this.ring = new Resonator(this.rate); this.nasal = new Resonator(this.rate); this.chant = sampleChant(0); this.controlSamples = 0;
    this.effects = Array.from({ length: 4 }, () => ({ kind: '', age: 0, duration: 0, phase: 0, low: 0, envelope: 0, release: 1, releasing: false,
      formants: [new Resonator(this.rate), new Resonator(this.rate)] }));
    this.accentReleaseStep = 1 / (this.rate * .035);
    this.delay = new Float32Array(Math.ceil(this.rate * .19)); this.delayIndex = 0;
    this.visual = { phase: 0, chantPhase: 0, mouth: 0, energy: 0, speed: 0, direction: 1, syllable: 0, audioTime: 0, effect: '', effectEnvelope: 0, breath: 0 };
    this.smooth = 1 - Math.exp(-this.dt / .035);
    this.attack = 1 - Math.exp(-this.dt / .035); this.release = 1 - Math.exp(-this.dt / .48);
    this.coast = Math.exp(-this.dt / 1.3); this.airDecay = Math.exp(-this.dt / .62);
  }
  random() {
    let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x >>> 0;
    return (this.randomState / 0x100000000) * 2 - 1;
  }
  setControls(value) { this.controls = normalizeWitchControls({ ...this.controls, ...value }); }
  syncPhase(phase, speed = this.speed) {
    this.phase = ((witchClamp(phase, -1e12, 1e12) % TAU) + TAU) % TAU;
    this.speed = witchClamp(speed);
    this.visual.phase = this.phase; this.visual.speed = this.speed;
  }
  setEnabled(enabled) {
    this.enabled = enabled === true;
  }
  releaseAccents() { for (const effect of this.effects) effect.releasing = true; }
  trigger(kind) {
    if (!this.enabled || !WITCH_VOCAL_EFFECTS.includes(kind)) return false;
    let slot = this.effects.find(effect => effect.age >= effect.duration);
    if (!slot) slot = this.effects.reduce((oldest, effect) => effect.age / effect.duration > oldest.age / oldest.duration ? effect : oldest);
    slot.kind = kind; slot.age = 0; slot.phase = 0; slot.low = 0; slot.envelope = 0; slot.release = 1; slot.releasing = false;
    slot.duration = { cackle: 1.35, moan: 2.6, howl: 2.1, ghost: 2.85, bat: .36 }[kind];
    const mouth = { cackle: [770, 1320], moan: [330, 710], howl: [630, 1080], ghost: [970, 1730], bat: [2100, 3200] }[kind];
    for (let i = 0; i < 2; i++) {
      const formant = slot.formants[i]; formant.x1 = formant.x2 = formant.y1 = formant.y2 = 0;
      formant.tune(mouth[i], kind === 'ghost' ? 75 : 140 + i * 60);
    }
    return true;
  }
  tuneVoice() {
    const c = this.controls;
    this.activeVoice = c.spoonAuto ? witchVoiceAtHeight(this.spoonHeight) : c.voice;
    const v = VOICE[this.activeVoice];
    sampleChant(this.chantPhase, 1, this.radius, this.chant, this.activeVoice);
    const vowel = (.77 + this.fingers[1] * .46) * Math.pow(1.8, (this.nose - .5) * 2);
    this.targetHz = v.hz * Math.pow(2.7, this.fingers[0] - .5) * this.chant.pitch * Math.pow(2, (this.hat - .5) * 1.3 + (this.nose - .5) * 1.5);
    this.targetAir = witchClamp(v.air + (this.fingers[4] - .5) * .55, 0, .98);
    this.targetRasp = witchClamp(v.rasp + (this.fingers[2] - .5) * .8 + this.hair * .34 + (this.hat - .5) * .5);
    this.targetVibrato = v.vibrato + this.fingers[3] ** 2 * .065;
    this.targetSustain = v.sustain;
    const width = 85 + this.targetAir * 230 + this.hair * 65;
    this.formants[0].tune(this.chant.f1 * vowel, width);
    this.formants[1].tune(this.chant.f2 * vowel, width * 1.3);
    this.formants[2].tune(this.chant.f3 * (.94 + vowel * .06), width * 1.7);
    this.nasal.tune(370 + this.nose * 1390, 65 + (1 - this.nose) * 70);
    this.ring.tune(1140 + this.radius * 1780 + this.fingers[1] * 270, 32 + (1 - this.glass) * 70);
  }
  effectSample() {
    let sum = 0, activeKind = '', activeEnvelope = 0;
    for (const e of this.effects) {
      if (e.age >= e.duration) continue;
      if (e.releasing) e.release = Math.max(0, e.release - this.accentReleaseStep);
      if (e.release === 0) { e.age = e.duration; e.envelope = 0; continue; }
      const t = e.age, u = t / e.duration;
      let hz, envelope, source;
      if (e.kind === 'cackle') {
        const ha = (t * 6.2) % 1;
        envelope = Math.sin(Math.PI * ha) ** 3 * Math.min(1, t * 20) * (1 - u);
        hz = 270 + 150 * (1 - ha) + 50 * Math.sin(t * 9);
        source = Math.sin(e.phase) + .35 * Math.sin(e.phase * 3) + .12 * this.random();
      } else if (e.kind === 'bat') {
        const flap = (u * 3) % 1;
        envelope = Math.sin(Math.PI * flap) ** 4 * (1 - u);
        hz = 2100 - flap * 1420;
        source = .3 * Math.sin(e.phase) + .45 * this.random();
      } else {
        envelope = Math.sin(Math.PI * u) ** 1.4;
        hz = e.kind === 'moan' ? 88 + 75 * Math.sin(Math.PI * u)
          : e.kind === 'howl' ? 175 + 390 * Math.sin(Math.PI * u) ** 1.7
            : 390 + 185 * Math.sin(u * Math.PI * 2) + 16 * Math.sin(t * 37);
        source = Math.sin(e.phase) + (e.kind === 'moan' ? .42 : .16) * Math.sin(e.phase * 2)
          + (e.kind === 'howl' ? .25 : .08) * Math.sin(e.phase * 3);
        if (e.kind === 'ghost') source = source * (.62 + .38 * Math.sin(t * 29)) + this.random() * .04;
      }
      if (e.kind !== 'bat') {
        const cycle = e.phase / TAU, step = hz * this.dt;
        const glottal = 2 * cycle - 1 - polyBlep(cycle, step);
        const air = e.kind === 'cackle' ? this.random() * .13 : this.random() * .025;
        const excitation = glottal * .8 + air;
        const resonant = e.formants[0].next(excitation) * 2.6 + e.formants[1].next(excitation) * 1.9;
        source = source * (e.kind === 'ghost' ? .5 : .19) + resonant * (e.kind === 'cackle' ? 1.8 : 1.25);
      }
      e.phase = (e.phase + TAU * hz * this.dt) % TAU;
      e.low += .42 * (source - e.low);
      envelope *= e.release;
      sum += e.low * envelope * (e.kind === 'bat' ? .16 : .13);
      e.age += this.dt; e.envelope = envelope;
      if (envelope > activeEnvelope) { activeEnvelope = envelope; activeKind = e.kind; }
    }
    this.visual.effect = activeKind; this.visual.effectEnvelope = activeEnvelope;
    return sum;
  }
  process(left, right = left) {
    const c = this.controls;
    let square = 0;
    for (let i = 0; i < left.length; i++) {
      const active = this.enabled && c.gate;
      if (this.lastGate && !active) this.releaseAir = Math.max(this.releaseAir, this.envelope * .72);
      this.lastGate = active;
      this.envelope += ((active ? 1 : 0) - this.envelope) * (active ? this.attack : this.release);
      this.releaseAir *= this.airDecay;
      // Manual pots rest independently of the singer and the ensemble clock.
      if (c.gate && (c.stirAuto || c.stirring)) this.speed += (c.speed - this.speed) * this.smooth;
      else this.speed *= this.coast;
      this.radius += (c.radius - this.radius) * this.smooth;
      this.altitude += (c.altitude - this.altitude) * this.smooth;
      this.glass += (c.glass - this.glass) * this.smooth; this.hair += (c.hair - this.hair) * this.smooth;
      this.hairTail += (this.hair - this.hairTail) * (this.hair > this.hairTail ? this.smooth : this.hairTailRelease);
      this.nose += (c.nose - this.nose) * this.smooth; this.hat += (c.hat - this.hat) * this.smooth;
      if (c.gate) this.spoonTime += this.dt;
      if (c.gate || !c.spoonAuto) this.spoonHeight += ((c.spoonAuto ? witchSpoonHeight(this.spoonTime) : c.spoonHeight) - this.spoonHeight) * this.spoonSmooth;
      for (let f = 0; f < 5; f++) this.fingers[f] += (c.fingers[f] - this.fingers[f]) * this.smooth;
      const pace = this.activeVoice === 'wail' ? .18 + this.speed * 2.3
        : this.activeVoice === 'chatter' ? 1.1 + this.speed * 16.4
          : .46 + this.speed * (this.activeVoice === 'cackle' ? 12 : 8.6);
      this.chantPhase += c.direction * pace * this.dt * (c.gate ? 1 : this.speed);
      // Radians, independent from articulation so a broad chant still follows
      // the visible ladle rotation while its vowels take their own time.
      this.phase = (this.phase + c.direction * this.speed * 12 * this.dt + TAU) % TAU;
      if (this.controlSamples-- <= 0) { this.tuneVoice(); this.controlSamples = 31; }
      this.frequency += (this.targetHz - this.frequency) * this.smooth;
      this.air += (this.targetAir - this.air) * this.smooth; this.rasp += (this.targetRasp - this.rasp) * this.smooth;
      this.sustain += (this.targetSustain - this.sustain) * this.smooth; this.vibrato += (this.targetVibrato - this.vibrato) * this.smooth;
      this.vibratoPhase = (this.vibratoPhase + (4.4 + this.fingers[3] * 2.8) * this.dt * TAU) % TAU;
      this.wobblePhase = (this.wobblePhase + 17.31 * this.dt * TAU) % TAU;
      const noise = this.random(); this.noiseLow += .025 * (noise - this.noiseLow);
      const wander = Math.sin(this.wobblePhase) * this.hair * .06 + this.noiseLow * this.rasp * .12;
      const hz = witchClamp(this.frequency * (1 + Math.sin(this.vibratoPhase) * this.vibrato + wander), 35, 1100);
      const step = hz * this.dt;
      this.osc = (this.osc + step) % 1; this.subOsc = (this.subOsc + step * .5) % 1;
      const saw = 2 * this.osc - 1 - polyBlep(this.osc, step);
      this.sourceLow += .3 * (saw - this.sourceLow);
      const cycle = Math.sin(this.osc * TAU);
      const sub = Math.sin(this.subOsc * TAU);
      const voiced = this.sourceLow * .7 + cycle * .25 + this.rasp * sub * .24;
      const creak = 1 - this.rasp * .44 + this.rasp * .44 * (sub > 0 ? 1 : -.3);
      const source = voiced * creak * (1 - this.air * .94) + noise * (.018 + Math.max(0, this.air) * .36);
      let vowel = this.formants[0].next(source) * 1.8 + this.formants[1].next(source) * 1.3 + this.formants[2].next(source) * .7;
      const ringing = this.ring.next(source + noise * this.releaseAir * .04);
      vowel += this.glass * ringing * 2.4;
      const nasalAmount = (this.nose - .5) * 2;
      vowel = vowel * (1 - Math.abs(nasalAmount) * .27) + this.nasal.next(source) * nasalAmount * 3.2;
      this.articulation += (this.sustain + (1 - this.sustain) * this.chant.articulation - this.articulation) * this.articulationFollow;
      const articulation = this.articulation;
      const release = (noise - this.noiseLow) * this.releaseAir * .026;
      let sample = (vowel * articulation * .88 + cycle * (1 - this.air) * .035) * this.envelope + release;
      // Pulling tangles adds uneven, scratchy friction around the voiced spell.
      // Reuse its noise sample so an untouched head preserves the original RNG
      // and voice exactly; fixed band-limiting keeps the new strand bounded.
      this.hairFriction += (noise - this.hairFriction) * this.hairFrictionFollow;
      this.hairBody += (this.hairFriction - this.hairBody) * this.hairBodyFollow;
      const snarl = .25 + .75 * Math.sin(this.wobblePhase + Math.sin(this.vibratoPhase) * 2.1) ** 2;
      const scratch = (this.hairFriction - this.hairBody) * this.hairTail * (.14 + this.hairTail * .27) * snarl;
      sample += scratch * (.35 + articulation * .65) * this.envelope;
      sample += this.effectSample();
      const delayed = this.delay[this.delayIndex]; this.delay[this.delayIndex] = sample + delayed * .17;
      this.delayIndex = (this.delayIndex + 1) % this.delay.length;
      sample += delayed * (.1 + this.glass * .09);
      const clean = sample - this.lastInput + .995 * this.dc; this.lastInput = sample; this.dc = clean;
      this.gain += ((this.enabled ? 1 : 0) - this.gain) * this.smooth;
      const output = Math.tanh(clean * 1.7) * .54 * this.gain;
      left[i] = output;
      if (right !== left) right[i] = Math.tanh((clean + delayed * .08) * 1.7) * .54 * this.gain;
      square += output * output;
      this.time += this.dt;
    }
    this.visual.phase = this.phase; this.visual.chantPhase = this.chantPhase;
    this.visual.mouth = witchClamp(this.chant.mouth * this.envelope + this.releaseAir * .18 + this.visual.effectEnvelope * .3);
    this.visual.energy = Math.sqrt(square / Math.max(1, left.length)); this.visual.speed = this.speed;
    this.visual.direction = c.direction; this.visual.syllable = this.chant.index; this.visual.audioTime = this.time;
    this.visual.breath = this.releaseAir;
    this.visual.spoonHeight = this.spoonHeight; this.visual.activeVoice = this.activeVoice;
    return this.visual;
  }
}

// Ratios come from an asymmetric geometric pattern, not a pitch scale. Altitude
// continuously transposes every sounding strand, including already-ringing ones.
const FLIGHT_RATIOS = Object.freeze([1, Math.SQRT2, Math.sqrt(3), .83, Math.sqrt(5), 1.19, 1.73, 2.41]);
const LAUNCH_SYLLABLES = Object.freeze([
  [0, .38, 0, 177], [.4, .38, 0, 207], [.82, .22, 1, 335],
  [1.07, .2, 1, 362], [1.29, .25, 1, 307], [1.56, .28, 1, 278],
]);

/** The takeoff exclamation is a single explicitly triggered gesture. It has no
 * connection to the flight pattern's clock, controls, or automatic note events. */
class LaunchAccent {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.active = false; this.pending = false; this.fading = false;
    this.age = WITCH_LAUNCH_DURATION; this.phase = 0; this.sourceLow = 0; this.fade = 1;
    this.fadeStep = 1 / (.012 * rate); this.envelope = 0; this.mouth = 0; this.control = 0; this.randomState = 0x2a4edf;
    this.formants = [new Resonator(rate), new Resonator(rate), new Resonator(rate)];
  }
  begin() {
    this.active = true; this.pending = false; this.fading = false; this.age = 0; this.phase = 0;
    this.fade = 1; this.sourceLow = 0; this.envelope = 0; this.mouth = 0; this.control = 0;
    for (const formant of this.formants) formant.x1 = formant.x2 = formant.y1 = formant.y2 = 0;
  }
  trigger() {
    if (!this.active) this.begin();
    else { this.pending = true; this.fading = true; }
  }
  cancel() { this.pending = false; if (this.active) this.fading = true; }
  clear() { this.active = this.pending = this.fading = false; this.envelope = this.mouth = 0; }
  next() {
    if (!this.active) return 0;
    if (this.fading) {
      this.fade = Math.max(0, this.fade - this.fadeStep);
      if (this.fade === 0) {
        if (this.pending) this.begin(); else this.clear();
        return 0;
      }
    }
    if (this.age >= WITCH_LAUNCH_DURATION) {
      if (this.pending) this.begin(); else this.clear();
      return 0;
    }
    let envelope = 0, opening = 0, hz = 190, hiss = 0;
    for (const [start, duration, ha, base] of LAUNCH_SYLLABLES) {
      const u = (this.age - start) / duration;
      if (u < 0 || u >= 1) continue;
      opening = ha ? .94 : .16 + .84 * Math.min(1, u * 2.3);
      envelope = Math.sin(Math.PI * u) ** (ha ? 1.8 : 1.2);
      hz = base + (ha ? 75 * (1 - u) : 115 * Math.sin(Math.PI * u));
      hiss = ha ? .035 + Math.max(0, 1 - u * 5) * .2 : .025;
      break;
    }
    if (this.control-- <= 0) {
      this.formants[0].tune(270 + opening * 540, 130);
      this.formants[1].tune(700 + opening * 650, 175);
      this.formants[2].tune(2460 + opening * 210, 280);
      this.control = 15;
    }
    let seed = this.randomState; seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; this.randomState = seed >>> 0;
    const noise = this.randomState / 2147483648 - 1;
    const step = hz * (1 + .014 * Math.sin(this.age * 37)) * this.dt;
    this.phase = (this.phase + step) % 1;
    const saw = 2 * this.phase - 1 - polyBlep(this.phase, step);
    this.sourceLow += .32 * (saw - this.sourceLow);
    const source = this.sourceLow * .88 + noise * hiss;
    const voice = this.formants[0].next(source) * 2.4 + this.formants[1].next(source) * 1.8 + this.formants[2].next(source) * .8
      + Math.sin(this.phase * TAU) * .1;
    this.envelope = envelope * this.fade;
    this.mouth = this.envelope * opening;
    this.age += this.dt;
    return voice * this.envelope * .58;
  }
}

class FlightDSP {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.controls = normalizeWitchControls(); this.enabled = false;
    this.randomState = 0x391fa; this.time = 0; this.speed = 0; this.altitude = .5; this.x = .5; this.tone = .5;
    this.gain = 0; this.drone = 0; this.dronePhase = 0; this.noiseLow = 0; this.lastGate = false;
    this.beat = 0; this.step = -1; this.noteCount = 0; this.pulse = 0; this.rootHz = 201;
    this.smooth = 1 - Math.exp(-this.dt / .025); this.fade = 1 - Math.exp(-this.dt / .025);
    this.pulseDecay = Math.exp(-this.dt / .11); this.droneSmooth = 1 - Math.exp(-this.dt / .18);
    this.voices = Array.from({ length: 8 }, () => ({ kind: '', age: 1, duration: 0, phase: 0, mod: 0, upper: 0, release: 1, releasing: false,
      ratio: 1, frequency: 200, pan: 0, envelope: 0, level: 0 }));
    this.accentReleaseStep = 1 / (this.rate * .035);
    this.launch = new LaunchAccent(rate);
    this.visual = { flightPulse: 0, flightStep: 0, effect: '', effectEnvelope: 0, launchEnvelope: 0, launchActive: false, mouth: 0 };
  }
  random() {
    let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x >>> 0;
    return this.randomState / 2147483648 - 1;
  }
  setControls(controls) { this.controls = controls; }
  setEnabled(enabled) {
    if (this.enabled && enabled !== true) this.launch.cancel();
    this.enabled = enabled === true;
  }
  strike(kind, ratio, duration, level, pan = 0) {
    let voice = this.voices.find(v => v.age >= v.duration);
    if (!voice) voice = this.voices.reduce((oldest, v) => v.age / v.duration > oldest.age / oldest.duration ? v : oldest);
    Object.assign(voice, { kind, age: 0, duration, phase: 0, mod: 0, upper: 0, ratio,
      frequency: this.rootHz * ratio, level, pan, envelope: 0, release: 1, releasing: false });
  }
  trigger(kind) {
    if (!this.enabled || !WITCH_FLIGHT_EFFECTS.includes(kind)) return false;
    if (kind === 'launch') { this.launch.trigger(); return true; }
    if (kind === 'moon') {
      this.strike(kind, .5, 2.7, .1, -.28); this.strike(kind, 1.37, 2.5, .07, .28);
    } else if (kind === 'bat') this.strike(kind, 2.9, .48, .14, this.random() * .7);
    else if (kind === 'ghost') this.strike(kind, .79, 2.6, .16, .25);
    else if (kind === 'spark') this.strike(kind, 3.1, 1.15, .14, -.2);
    else this.strike(kind, .6, 1.65, .16, 0);
    return true;
  }
  clear() {
    for (const voice of this.voices) voice.duration = 0;
    this.drone = 0; this.pulse = 0; this.lastGate = false;
    this.launch.clear();
  }
  releaseAccents() {
    for (const voice of this.voices) if (voice.kind !== 'pattern') voice.releasing = true;
    this.launch.cancel();
  }
  process(left, right = left) {
    const c = this.controls;
    let effect = '', effectEnvelope = 0;
    for (let i = 0; i < left.length; i++) {
      this.speed += (c.speed - this.speed) * this.smooth;
      this.altitude += (c.altitude - this.altitude) * this.smooth;
      this.x += (c.flightX - this.x) * this.smooth; this.tone += (c.tone - this.tone) * this.smooth;
      this.rootHz = 90 * Math.pow(5, this.altitude);
      // The musical clock advances with transport even while Audio is muted.
      if (c.gate) {
        this.beat += (1.15 + this.speed * 7.8) * this.dt;
        if (!this.lastGate || this.beat >= 1) {
          this.beat %= 1; this.step = (this.step + 1) % FLIGHT_RATIOS.length; this.noteCount++;
          this.strike('pattern', FLIGHT_RATIOS[this.step], .65 + this.tone * .95, .095 + this.speed * .035, (this.step % 3 - 1) * .25);
          this.pulse = 1;
        }
      }
      this.lastGate = c.gate; this.pulse *= this.pulseDecay;
      this.drone += ((c.gate ? 1 : 0) - this.drone) * this.droneSmooth;
      this.dronePhase = (this.dronePhase + this.rootHz * .25 * this.dt) % 1;
      const noise = this.random(); this.noiseLow += .018 * (noise - this.noiseLow);
      const air = (noise - this.noiseLow) * .006 * this.speed * this.drone;
      const bed = (Math.sin(this.dronePhase * TAU) * .025 + air) * this.drone;
      const takeoff = this.launch.next() * .70710678;
      let mixL = bed + takeoff, mixR = bed + takeoff;
      for (const v of this.voices) {
        if (v.age >= v.duration) continue;
        if (v.releasing) v.release = Math.max(0, v.release - this.accentReleaseStep);
        if (v.release === 0) { v.age = v.duration; v.envelope = 0; continue; }
        const u = v.age / v.duration;
        const target = this.rootHz * v.ratio * (v.kind === 'ghost' ? 1 + .016 * Math.sin(this.time * 5.3) : 1);
        v.frequency += (Math.min(this.rate * .15, target) - v.frequency) * this.smooth;
        const modal = v.kind === 'moon' || v.kind === 'spark' ? 2.756 : v.kind === 'bat' ? 3.13 : 2.013;
        const high = Math.min(this.rate * .42, v.frequency * (v.kind === 'moon' ? 5.404 : 4.03));
        v.phase = (v.phase + v.frequency * this.dt) % 1;
        v.mod = (v.mod + Math.min(this.rate * .4, v.frequency * modal) * this.dt) % 1;
        v.upper = (v.upper + high * this.dt) % 1;
        let envelope, sample;
        if (v.kind === 'ghost') {
          envelope = Math.sin(Math.PI * u) ** 1.3;
          sample = (Math.sin(TAU * v.phase) + .28 * Math.sin(TAU * v.mod)) * (.65 + .35 * Math.sin(this.time * 13));
        } else if (v.kind === 'gust') {
          envelope = Math.sin(Math.PI * u) ** 1.5;
          sample = this.noiseLow * 2.5 + (noise - this.noiseLow) * .06 + .07 * Math.sin(TAU * v.phase);
        } else if (v.kind === 'bat') {
          envelope = Math.sin(Math.PI * ((u * 4) % 1)) ** 3 * (1 - u);
          sample = Math.sin(TAU * v.phase + .6 * Math.sin(TAU * v.mod)) * .55 + noise * .19;
        } else {
          envelope = (1 - Math.exp(-v.age / .003)) * Math.exp(-u * 5) * Math.min(1, (1 - u) * 18);
          const bright = this.tone * Math.exp(-u * 4);
          sample = Math.sin(TAU * v.phase + bright * .45 * Math.sin(TAU * v.mod))
            + (.08 + bright * .55) * Math.sin(TAU * v.mod) + bright * .23 * Math.sin(TAU * v.upper);
        }
        const pan = witchClamp((this.x - .5) * 1.45 + v.pan, -.95, .95);
        const angle = (pan + 1) * Math.PI / 4;
        envelope *= v.release;
        const value = sample * envelope * v.level;
        mixL += value * Math.cos(angle); mixR += value * Math.sin(angle);
        v.age += this.dt; v.envelope = envelope;
        if (v.kind !== 'pattern' && envelope > effectEnvelope) { effect = v.kind; effectEnvelope = envelope; }
      }
      this.gain += ((this.enabled ? 1 : 0) - this.gain) * this.fade;
      left[i] = mixL * this.gain;
      if (right !== left) right[i] = mixR * this.gain;
      this.time += this.dt;
    }
    this.visual.flightPulse = this.pulse; this.visual.flightStep = this.step;
    this.visual.effect = effect; this.visual.effectEnvelope = effectEnvelope;
    this.visual.launchActive = this.launch.active;
    this.visual.launchEnvelope = this.launch.envelope; this.visual.mouth = this.launch.mouth;
    if (this.launch.envelope > 0) { this.visual.effect = 'launch'; this.visual.effectEnvelope = this.launch.envelope; }
  }
}

/** Keep Gesticules' sample-clock choreography and resonators intact. A held
 * digit overrides only its own pose/targets; its neighbours keep moving. */
class WitchHandDSP extends HandDSP {
  constructor(rate) {
    super(rate);
    this.witchControls = null; this.manualConfig = null;
    this.manualPose = createHandPose(); this.manualPrevious = createHandPose(); this.manualTargets = createHandVoices();
  }
  setWitchControls(controls) {
    this.witchControls = controls;
    const config = witchHandConfig(controls);
    this.setConfig(config);
    this.manualConfig = normalizeHandConfig({ ...config, motion: { id: 'still', amount: 0 } });
    applyWitchManualFingers(controls, this.manualConfig.pose);
  }
  updateTargets(at) {
    super.updateTargets(at);
    const mask = this.witchControls?.handAuto === false ? 31 : this.witchControls?.manualFingerMask ?? 0;
    if (!mask || !this.manualConfig) return;
    evaluateHandVoices(this.manualConfig, 0, this.manualTargets, this.manualPose, this.manualPrevious);
    for (let index = 0; index < 5; index++) if (mask & (1 << index)) {
      Object.assign(this.targets[index], this.manualTargets[index]);
      if (this.sampleRate * .17 < 4200) this.targets[index].frequency = handPlayableFrequency(this.targets[index].frequency, this.sampleRate * .17);
      Object.assign(this.pose.fingers[index], this.manualPose.fingers[index]);
    }
  }
}

// The former Oculoid slot retains its trigger ID for saved controls, but now
// contains an actual FM Drums excerpt and uses that instrument's catalogue icon.
const FM_TASTE_VOICES = Object.freeze([0, 2, 7, 10, 11, 14, 6, 9].map(index => DEFAULT_FM_DRUM_VOICES[index]));
const FM_TASTE_KITS = Object.freeze([FM_TASTE_VOICES,
  [1, 3, 4, 8, 12, 13, 15, 5].map(index => DEFAULT_FM_DRUM_VOICES[index]),
  [0, 5, 7, 9, 11, 12, 14, 15].map(index => DEFAULT_FM_DRUM_VOICES[index])]);
const FM_TASTE_RHYTHMS = Object.freeze([
  [0, 2, 6, 2, 1, 2, 7, 2, 0, 2, 6, 3, 1, 2, 4, 5],
  [0, 7, 7, 3, 1, 4, 2, 4, 0, 6, 5, 6, 1, 3, 7, 3],
  [0, 5, 3, 6, 2, 7, 4, 1, 0, 4, 6, 2, 7, 3, 5, 1],
]);
const THROAT_TASTE_PROFILES = Object.freeze(['clear', 'deep', 'bright'].map(id => {
  const state = voicePresetState(id);
  return Object.freeze({ id, state, spectrum: glottalHarmonics(state.exciterTenseness, 48, 1024) });
}));
// Sample the real Hiccup Head gesture model once on module load. The miniature
// keeps its pressure, catch, aspiration and rear-tongue release trajectory;
// three formants replace the full physical tube for this deliberately small taste.
const HICCUP_TASTE_PLAN = physicalVoiceParameters('hiccup');
const HICCUP_TASTE_FRAMES = Object.freeze(Array.from({ length: 129 }, (_, index) => hiccupHeadGestureFrame('hiccup', index / 128)));
const THROAT_TASTE_ORDERS = Object.freeze([[0, 1, 2], [1, 0, 1], [2, 2, 0]]);
const CREATURE_TASTE_REPEATS = Object.freeze([.69, 1.4, .93]);
const FM_TASTE_TIMING = Object.freeze([[27, 6, .066, .088], [36, 4, .045, .063], [42, 3, .03, .055]]);
const SAW_TASTE_BENDS = Object.freeze([[.32, .32, 1.3], [.12, .19, .8], [.25, .51, 4.6]]);
const HICCUP_TASTES = Object.freeze(['hiccup', 'growl', 'braap'].map((id, variant) => ({
  plan: variant ? physicalVoiceParameters(id) : HICCUP_TASTE_PLAN,
  frames: variant ? Array.from({ length: 129 }, (_, index) => hiccupHeadGestureFrame(id, index / 128)) : HICCUP_TASTE_FRAMES,
  interval: [.54, .78, .34][variant],
})));
const GHOST_PAN_LEFT = Object.freeze([-.58, .48, .1].map(pan => Math.cos((pan + 1) * Math.PI / 4)));
const GHOST_PAN_RIGHT = Object.freeze([-.58, .48, .1].map(pan => Math.sin((pan + 1) * Math.PI / 4)));

/** Scalar version of FM Drums' native oscillator/envelope/filter graph. Only
 * eight reusable hits are needed for this short factory-kit excerpt; the source
 * parameters remain the actual shared factory objects rather than a new kit. */
class FmTasteDSP {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.index = 0;
    this.voices = Array.from({ length: 8 }, () => ({ age: 10, phase: 0, modPhase: 0, voice: FM_TASTE_VOICES[0],
      random: 0x51ac83, x1: 0, x2: 0, y1: 0, y2: 0, noiseLow: 0, b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 }));
  }
  reset() { this.index = 0; for (const hit of this.voices) { hit.age = 10; hit.x1 = hit.x2 = hit.y1 = hit.y2 = 0; } }
  strike(voice) {
    const hit = this.voices[this.index++ % this.voices.length];
    hit.voice = voice; hit.age = hit.phase = hit.modPhase = hit.x1 = hit.x2 = hit.y1 = hit.y2 = hit.noiseLow = 0;
    const highpass = voice.family === 'hat';
    const frequency = Math.min(this.rate * .43, highpass ? 2200 + voice.tone * 5000 : 550 + voice.tone * 11500);
    const omega = TAU * frequency / this.rate, cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * (voice.family === 'metal' ? 2.6 : .75)), inverse = 1 / (1 + alpha);
    hit.b0 = (1 + (highpass ? cosine : -cosine)) * .5 * inverse;
    hit.b1 = (highpass ? -1 - cosine : 1 - cosine) * inverse; hit.b2 = hit.b0;
    hit.a1 = -2 * cosine * inverse; hit.a2 = (1 - alpha) * inverse;
  }
  next() {
    let sum = 0;
    for (const hit of this.voices) {
      const voice = hit.voice, t = hit.age;
      if (t > voice.attack + voice.decay * 1.35) continue;
      hit.age += this.dt;
      const envelope = t < voice.attack ? .0001 * (Math.max(.001, voice.level) / .0001) ** (t / voice.attack)
        : voice.level * (.0001 / voice.level) ** Math.min(1, (t - voice.attack) / voice.decay);
      hit.modPhase = (hit.modPhase + Math.min(this.rate * .4, voice.frequency * voice.modRatio) * this.dt) % 1;
      const modulation = voice.family === 'bell' ? Math.sin(hit.modPhase * TAU) : 1 - 4 * Math.abs(hit.modPhase - .5);
      const index = voice.frequency * voice.modIndex * (.001 / Math.max(.001, voice.frequency * voice.modIndex)) ** Math.min(1, t / Math.max(.025, voice.decay));
      const carrier = voice.frequency * Math.max(.15, 1 + voice.pitchBend) ** Math.max(0, 1 - t / Math.max(.018, voice.decay * .42));
      const hz = witchClamp(carrier + modulation * index, -this.rate * .4, this.rate * .4);
      hit.phase = ((hit.phase + hz * this.dt) % 1 + 1) % 1;
      const step = Math.max(.00001, Math.abs(hz) * this.dt);
      const oscillator = (voice.family === 'hat' || voice.family === 'metal' || voice.family === 'rattle')
        ? (hit.phase < .5 ? 1 : -1) + polyBlep(hit.phase, step) - polyBlep((hit.phase + .5) % 1, step)
        : Math.sin(hit.phase * TAU);
      let x = hit.random; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; hit.random = x | 0;
      const noise = (x >>> 0) / 2147483648 - 1;
      hit.noiseLow += .4 * (noise - hit.noiseLow);
      const excitation = (oscillator + (noise - hit.noiseLow) * voice.noise) * envelope;
      const filtered = hit.b0 * excitation + hit.b1 * hit.x1 + hit.b2 * hit.x2 - hit.a1 * hit.y1 - hit.a2 * hit.y2;
      hit.x2 = hit.x1; hit.x1 = excitation; hit.y2 = hit.y1; hit.y1 = filtered;
      sum += filtered * .55;
    }
    return sum;
  }
}

// A short traversal of Hyper Rubix's eight real cell voices. Its native
// geometry mapper supplies pitch/filter/pan; the components below follow
// HyperRubixAudio.strikeSticker's Hyper Kit ratios and exponential envelopes.
// Only this score and twelve reusable scalar voices replace the native graph.
const HYPER_RUBIX_TASTE_SCORES = Object.freeze([0, 1, 2].map(variant => {
  let at = 0;
  return Object.freeze(Array.from({ length: [24, 32, 36][variant] }, (_, index) => {
    const cell = HYPER_RUBIX_CELL_ORDER[[[0,5,1,7,2,4,3,6], [6,0,4,2,7,3,1,5], [3,7,2,6,1,5,0,4]][variant][index % 8]];
    const boundary = hyperRubixBoundaryCell(cell), plane = boundary.tangentPlanes[(Math.floor(index / 8) + variant) % boundary.tangentPlanes.length];
    const parameters = hyperRubixTechnoVoiceParameters({ cell, plane, quarterTurns: index % 3 ? 1 : -1 }, {
      angle: index / 24 + variant * .27, depth: [.5, .82, .19][variant], disorder: [.15, .6, .9][variant], shapeInfluence: HYPER_RUBIX_PRESET_DEFAULTS.shapeInfluence,
      position: { [boundary.axis]: boundary.sign },
    });
    const pitch = parameters.pitchHz, duration = witchClamp(parameters.decaySeconds * .78, .018, .38);
    const cutoff = parameters.filterHz * (.7 + HYPER_RUBIX_PRESET_DEFAULTS.tone * .6);
    const q = parameters.filterQ * .72, accent = index % 4 === 0 ? 1.15 : .85, drive = .72 + parameters.drive * .46;
    const components = [], add = (shape, startHz, endHz, level, length = duration, offset = 0, filter = 'lowpass', filterHz = cutoff) =>
      components.push(Object.freeze({ shape, startHz, endHz, level: level * accent, duration: length, offset, filter, filterHz, q, pan: parameters.pan }));
    const family = parameters.voice.family;
    if (family === 'kick') { add('sine', pitch * 2.35, pitch * .78, .31 * drive, duration, 0, 'lowpass', Math.min(cutoff, 2500)); add('noise', 0, 0, .045, .012, 0, 'highpass', 4800); }
    else if (family === 'sub') add('triangle', pitch * 1.48, pitch * .72, .25 * drive, duration, 0, 'lowpass', Math.min(cutoff, 1900));
    else if (family === 'snare') { add('triangle', pitch * 1.16, pitch * .68, .085, Math.min(duration, .16)); add('noise', 0, 0, .2 * drive, duration, 0, 'bandpass'); }
    else if (family === 'clap') for (const [i, offset] of [0, .018, .034].entries()) add('noise', 0, 0, (i === 2 ? .14 : .1) * drive, i === 2 ? duration : Math.min(.034, duration), offset, 'bandpass');
    else if (family.includes('hat')) add('noise', 0, 0, family === 'closed-hat' ? .105 : .12, family === 'closed-hat' ? Math.min(duration, .075) : duration, 0, 'highpass', Math.max(4200, cutoff));
    else if (family === 'rim') for (const [i, ratio] of [1, 1.64].entries()) add('sine', pitch * ratio, pitch * ratio * .96, .12 / (1 + i * .34), Math.min(duration, .09 - i * .012), i * .0015);
    else for (const [i, ratio] of [1, 1.37, 2.03].entries()) add(i === 1 ? 'square' : 'triangle', pitch * ratio * (1 + parameters.drive * .08), pitch * ratio * .91, .095 * drive / (1 + i * .32), duration * (1 - i * .08), i * .002);
    const event = Object.freeze({ at, parameters, components: Object.freeze(components) });
    at += hyperRubixStepDurationSeconds([168, 232, 276][variant], 4, [.08, .21, 0][variant], index);
    return event;
  }));
}));
class HyperRubixTasteDSP {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.index = 0; this.score = HYPER_RUBIX_TASTE_SCORES[0];
    this.left = this.right = 0;
    this.voices = Array.from({ length: 12 }, () => ({ component: null, age: 10, phase: 0, hz: 0, step: 1, random: 0x6b82f1,
      x1: 0, x2: 0, y1: 0, y2: 0, b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, panL: 0, panR: 0 }));
  }
  reset() { this.index = 0; for (const hit of this.voices) hit.component = null; }
  strike(event) {
    if (event.parameters.voice.family === 'closed-hat') for (const hit of this.voices)
      if (hit.component?.filter === 'highpass') hit.age = Math.max(hit.age, hit.component.duration - .006);
    for (const component of event.components) {
      const hit = this.voices[this.index++ % this.voices.length];
      hit.component = component; hit.age = -component.offset; hit.phase = hit.x1 = hit.x2 = hit.y1 = hit.y2 = 0;
      hit.hz = Math.max(20, component.startHz); hit.step = (Math.max(20, component.endHz) / hit.hz) ** (this.dt / component.duration);
      hit.panL = Math.cos((component.pan + 1) * Math.PI / 4); hit.panR = Math.sin((component.pan + 1) * Math.PI / 4);
      const omega = TAU * witchClamp(component.filterHz, 60, this.rate * .43) * this.dt, cosine = Math.cos(omega);
      const alpha = Math.sin(omega) / (2 * Math.max(.45, component.q)), inverse = 1 / (1 + alpha);
      const highpass = component.filter === 'highpass', bandpass = component.filter === 'bandpass';
      hit.b0 = bandpass ? alpha * inverse : (1 + (highpass ? cosine : -cosine)) * .5 * inverse;
      hit.b1 = bandpass ? 0 : (highpass ? -1 - cosine : 1 - cosine) * inverse; hit.b2 = bandpass ? -hit.b0 : hit.b0;
      hit.a1 = -2 * cosine * inverse; hit.a2 = (1 - alpha) * inverse;
    }
  }
  next() {
    this.left = this.right = 0;
    for (const hit of this.voices) {
      const c = hit.component, t = hit.age;
      if (!c || t >= c.duration) continue;
      hit.age += this.dt; if (t < 0) continue;
      const attack = Math.min(c.shape === 'noise' ? .004 : .008, c.duration * .18);
      const envelope = t < attack ? .0001 * (c.level / .0001) ** (t / attack) : c.level * (.0001 / c.level) ** ((t - attack) / (c.duration - attack));
      const step = Math.min(.43, hit.hz * this.dt); hit.phase = (hit.phase + step) % 1; hit.hz *= hit.step;
      let source;
      if (c.shape === 'noise') { let x = hit.random; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; hit.random = x | 0; source = (x >>> 0) / 2147483648 - 1; }
      else if (c.shape === 'square') source = (hit.phase < .5 ? 1 : -1) + polyBlep(hit.phase, step) - polyBlep((hit.phase + .5) % 1, step);
      else if (c.shape === 'triangle') { source = 0; for (let n = 1; n <= 7 && n * step < .45; n += 2) source += Math.sin(hit.phase * TAU * n) * (n % 4 === 1 ? 1 : -1) / (n * n); source *= 8 / (Math.PI * Math.PI); }
      else source = Math.sin(hit.phase * TAU);
      const filtered = hit.b0 * source + hit.b1 * hit.x1 + hit.b2 * hit.x2 - hit.a1 * hit.y1 - hit.a2 * hit.y2;
      hit.x2 = hit.x1; hit.x1 = source; hit.y2 = hit.y1; hit.y1 = filtered;
      this.left += filtered * envelope * hit.panL; this.right += filtered * envelope * hit.panR;
    }
  }
}

/** Three fixed background voices, never drop/solo voices. Creaturazoid borrows
 * its frog source family for a distant gunk/chuff; Monstrozoid borrows its
 * collision-roar two-mass source and low mouth resonances. Hiccup Head uses its
 * actual pressure/catch trajectory. These short spectral sketches omit the
 * complete instruments' bodies, tube networks and sequencers. */
class WitchGhostDSP {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.phase = 0; this.wasActive = false; this.notBeforeStep = 0;
    this.left = this.right = 0; this.presence = [0, 0, 0]; this.pulses = [0, 0, 0];
    this.attack = 1 - Math.exp(-this.dt / .003); this.release = 1 - Math.exp(-this.dt / .045);
    this.voices = Array.from({ length: 3 }, (_, index) => ({ frame: {}, envelope: 0, phase: 0, random: 0x53bf + index * 721,
      low: 0, source: index < 2 ? new SyrinxSourceEngine({ sampleRate: rate, seed: 0x1e71 + index,
        model: index ? 'twoMass' : 'frog', parameters: index
          ? { frequencyHz: 83, pressure: .76, tension: .34, adduction: .9, sourceScale: .9, breath: .2, roughness: .68, asymmetry: .34, coupling: .46, feedback: .62, outputGain: 1.04 }
          : { frequencyHz: 196, pressure: .78, tension: .36, adduction: .68, sourceScale: .72, breath: .13, roughness: .21, pulseRateHz: 26, coupling: .1, outputGain: .9 },
      }) : null, formants: [new Resonator(rate), new Resonator(rate), new Resonator(rate)] }));
    const mouths = [[420, 970, 1860], [286, 720, 1360], HICCUP_TASTE_PLAN.formantFrequenciesHz];
    for (let index = 0; index < 3; index++) for (let band = 0; band < 3; band++) {
      this.voices[index].formants[band].tune(mouths[index][band], index === 2 ? HICCUP_TASTE_PLAN.formantBandwidthsHz[band] : 90 + band * 80);
    }
    this.updateVisual();
  }
  syncPhase(phase) {
    this.phase = witchClamp(phase, 0, 1e12); this.wasActive = false;
    for (const voice of this.voices) voice.envelope = 0;
    this.updateVisual();
  }
  updateVisual() {
    for (let index = 0; index < 3; index++) {
      const frame = witchGhostFrame(this.phase, index, this.voices[index].frame);
      this.presence[index] = frame.presence; this.pulses[index] = frame.pulse;
    }
  }
  next(controls, enabled) {
    const active = enabled && controls.ghostGate;
    if (active && !this.wasActive) {
      // Re-arming or resuming midway through a beat waits for the next onset;
      // there is no stale-event queue and a held gesture cannot start this bed.
      const step = this.phase * 2;
      this.notBeforeStep = Math.ceil(step - 1e-9);
    }
    this.wasActive = active; let left = 0, right = 0;
    for (let index = 0; index < 3; index++) {
      const voice = this.voices[index], frame = witchGhostFrame(this.phase, index, voice.frame);
      const target = active && frame.step >= this.notBeforeStep ? frame.pulse : 0;
      voice.envelope += (target - voice.envelope) * (target > voice.envelope ? this.attack : this.release);
      if (voice.envelope < 1e-8) continue;
      let x = voice.random; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; voice.random = x | 0;
      const noise = (x >>> 0) / 2147483648 - 1, age = frame.beatAge;
      let source;
      if (index < 2) {
        const fall = Math.exp(-age * (index ? 10 : 16));
        voice.source.target.frequencyHz = index ? 73 + fall * 68 : 160 + fall * 234;
        source = voice.source.renderSample(voice.low * .16);
        const resonant = voice.formants[0].next(source) * 2.4 + voice.formants[1].next(source) * 1.1 + voice.formants[2].next(source) * .45;
        source = source * .4 + resonant * 2 + noise * fall * (index ? .025 : .06);
      } else {
        const position = Math.min(128, age / .4 * 128), step = Math.min(127, Math.floor(position)), mix = position - step;
        const a = HICCUP_TASTE_FRAMES[step], b = HICCUP_TASTE_FRAMES[step + 1];
        const pressure = a.pressureDrive + (b.pressureDrive - a.pressureDrive) * mix;
        const catchAmount = a.diaphragmCatch + (b.diaphragmCatch - a.diaphragmCatch) * mix;
        const voicing = a.voicing + (b.voicing - a.voicing) * mix;
        const air = a.aspiration + (b.aspiration - a.aspiration) * mix;
        const turbulence = a.turbulence + (b.turbulence - a.turbulence) * mix;
        const frequency = HICCUP_TASTE_PLAN.glottalFrequencyHz * (1 + catchAmount * .76);
        voice.phase = (voice.phase + frequency * this.dt) % 1;
        const excitation = (2 * voice.phase - 1 - polyBlep(voice.phase, frequency * this.dt)) * voicing * pressure
          + noise * (air * .14 + turbulence * .22);
        source = voice.formants[0].next(excitation) * 3.1 + voice.formants[1].next(excitation) * 2.4 + voice.formants[2].next(excitation) * 1.2;
      }
      voice.low += .17 * (source - voice.low);
      const sample = Math.tanh(voice.low * (index === 2 ? 9 : 6)) * voice.envelope * (index === 0 ? 1.65 : 1);
      left += sample * GHOST_PAN_LEFT[index];
      right += sample * GHOST_PAN_RIGHT[index];
    }
    this.left = Math.tanh(left * 2); this.right = Math.tanh(right * 2);
    if (controls.ghostGate) this.phase += controls.ghostTempo / 60 * this.dt;
  }
}

/** Fixed resources for the new potion ingredients. Roach shares its actual
 * contact percussion and wire rasp; Spider uses its bundled speech excerpt.
 * Throatazoid uses its own glottal spectrum and authored vowel resonances; the
 * legacy Oculoid slot is now the actual FM Drums factory-kit excerpt. The
 * remaining shelf objects reuse compact excerpts from their named instruments. */
// Each miniature keeps its instrument's authored source/gesture data. Only
// fixed source voices and three resonators are retained, never complete UIs.
const ALIEN_TASTES = Object.freeze(['double-fold', 'giant-tract', 'ring-wormhole'].map(id => {
  const state = ALIEN_LARYNX_FULL_PRESETS.find(preset => preset.id === id).snapshot;
  return { state, spectrum: glottalHarmonics(state.exciterTenseness, 48, 1024) };
}));
const THROAT_SINGER_TASTE = throatSingingState('open-drone');
const THROAT_SINGER_SPECTRUM = ventricularFoldSupercycle(THROAT_SINGER_TASTE);
const TONGUE_TASTE = TONGUED_BEASTS_FULL_PRESETS.find(preset => preset.id === 'wolf-rolled-howl').snapshot;
const BLOWHOLE_TASTE = createBlowholeState('humpback-two-voice-phrase');
const BLOWHOLE_TASTE_FRAMES = Array.from({ length: 129 }, (_, i) => createBlowholeVoicePlan(BLOWHOLE_TASTE, i / 128));
// Fixed per-instrument trims retain phrase dynamics while putting very
// different native source gains in the same short-bite neighborhood.
const TASTE_LEVELS = Object.freeze({ 'drop-choir': .5, 'drop-glass': 1.1, 'drop-tail': .075,
  'drop-earwax': .33, 'drop-eyeball': .3, 'drop-newt': .13, 'drop-hair': .08,
  'drop-roach': .8, 'drop-spider': .9, 'drop-oculoid': .88, 'drop-rubix': .9,
  'drop-hiccup': .5, 'drop-blowhole': .55, 'drop-syrinx': .6, 'drop-throat-singing': .25, 'drop-julie-saw': .48, 'drop-puggler': .72,
  'drop-hyper-rubix': 1.7, 'drop-marimba': .64, 'drop-synthesaurus': .65,
  'drop-jaw-harp': .85, 'drop-harmonicazoid': .62, 'drop-dentaphone': .62,
  'drop-blech': .78, 'drop-monstroid': .7, 'drop-candy-coil': .9,
  'drop-cat': .85, 'drop-quadruped': .85, 'drop-mouse': .95, 'drop-lizard': .85,
  'drop-chiptune': .62, 'drop-acid-303': .8 });
const TASTE_FORMANT_KEYS = ['f1', 'f2', 'f3'];
const DIGEST_TASTES = Object.freeze([
  { ids: ['MB', 'BURP', 'HS'], starts: [0, 1.45, 1.8] },
  { ids: ['CRS', 'QUICK_FART', 'WHOOPEE', 'SB'], starts: [0, .65, 1, 1.8] },
  { ids: ['HEART', 'BURP', 'CRS', 'QUICK_FART'], starts: [0, .45, 1.1, 1.9] },
].map(({ ids, starts }) => ({ profiles: ids.map(id => DIGESTAZOID_EVENT_PROFILES[id]), starts })));
const ROACH_TASTES = Object.freeze([
  { contact: [141, .64, .52, 1.3, .4], wire: [141, .7, .6, .3], rhythm: [.108, .143, .073], wings: 1 },
  { contact: [89, .88, .27, .7, .82], wire: [89, .38, .91, .65], rhythm: [.045, .045, .16, .06], wings: 1.16 },
  { contact: [237, .35, .89, 1.8, .18], wire: [237, .93, .32, .12], rhythm: [.065, .11, .038, .038, .17], wings: .84 },
]);
const SINGER_FOCUS_FRAMES = Array.from({ length: 129 }, (_, i) => dualFocusTargets(THROAT_SINGER_TASTE, THROAT_SINGER_TASTE.trueFoldHz * (6 + 5 * Math.sin(Math.PI * i / 128))));
const SAW_TASTE_STATES = Object.freeze([JULIE_SAW_DEFAULTS, applyJulieSawPreset('low-fog'), applyJulieSawPreset('rough-rosin')]);
const SOURCE_TASTE_KEYS = ['frequencyHz', 'pressure', 'tension', 'adduction', 'breath', 'sourceScale', 'asymmetry', 'sourceBalance', 'roughness', 'pulseRateHz', 'coupling', 'feedback', 'outputGain'];
const SOURCE_TASTE_VARIANTS = Object.fromEntries(['drop-tail', 'drop-eyeball', 'drop-newt', 'drop-hair', 'drop-syrinx'].map(kind => [kind, [0, 1, 2].map(variant => {
  const frames = Array.from({ length: 129 }, (_, i) => {
    const phase = i / 128;
    let host, tongue = null;
    if (kind === 'drop-tail') {
      const motion = sampleTongueMotionPreset(TONGUE_TASTE.motion, phase * 2.4, TONGUE_TASTE.tongue);
      host = { ...interpolateGesture(TONGUE_TASTE.state.callId, phase, TONGUE_TASTE.state), ...motion.host, active: true };
      tongue = motion.tongue;
    } else if (kind === 'drop-eyeball') host = resolveCreaturazoidEventState(['caw', 'growl', 'harsh'][variant], { phase, velocity: .9 });
    else if (kind === 'drop-hair') {
      const base = animalState(['hyena', 'alligator', 'wolf'][variant]);
      const performance = applyHybrinxTimelinePerformance(CALL_GESTURES[base.callId], base, {}, phase);
      host = performance.host; tongue = performance.tongue;
    } else if (kind === 'drop-syrinx') {
      const base = animalState(['songbird', 'raven', 'bullfrog'][variant]); host = interpolateGesture(base.callId, phase, base);
    } else host = interpolateGesture('lion-roar', phase, animalState('lion'));
    const source = { ...resolveSourceControls(host) };
    if (kind === 'drop-newt') Object.assign(source, {
      // Monstroid's collision-roar source profile (monstroid-processor.js).
      model: 'twoMass', frequencyHz: source.frequencyHz * .72, tension: Math.max(0, source.tension - .16),
      adduction: .9, sourceScale: .9, breath: .38, roughness: .68, asymmetry: .34,
      coupling: .46, feedback: .62, outputGain: 1.04, pulseRateHz: 19,
    });
    const quarter = 343 / (4 * source.tractLengthM);
    const guides = tongue ? tongueCavityGuides(source.tractLengthM, tongue) : null;
    return { ...source, f1: kind === 'drop-newt' ? 286 : guides?.rearQuarterWaveHz ?? quarter,
      f2: kind === 'drop-newt' ? 720 : guides?.frontQuarterWaveHz ?? quarter * 3,
      f3: kind === 'drop-newt' ? 1360 : quarter * 5 };
  });
  return frames;
})]));
const SOURCE_TASTE_FRAMES = Object.fromEntries(Object.entries(SOURCE_TASTE_VARIANTS).map(([kind, variants]) => [kind, variants[0]]));

// Authored variants use fixed source trims, preserving the established base mix.
const TASTE_VARIANT_TRIMS = Object.freeze({
  'drop-blech': [.831, .831, .831], 'drop-rubix': [1, .755, .755],
  'drop-candy-coil': [1, .73, .73],
  'drop-glass': [1, .8, .25], 'drop-hair': [1, 1.7, .9],
  'drop-oculoid': [1, .6, .63], 'drop-hiccup': [1, .31, .265],
  'drop-syrinx': [1, .48, .36], 'drop-eyeball': [1, .32, .35],
  'drop-fractal': [1, .68, .84], 'drop-spider': [1, .7, .69],
});

function spectrumSample(spectrum, phase, frequency, rate) {
  const c = Math.cos(TAU * phase), s = Math.sin(TAU * phase);
  let cosine = c, sine = s, sum = 0;
  for (let harmonic = 1; harmonic < spectrum.real.length; harmonic++) {
    const fade = witchClamp((rate * .45 - frequency * harmonic) / (rate * .06));
    sum += (spectrum.real[harmonic] * cosine + spectrum.imaginary[harmonic] * sine) * fade;
    const next = cosine * c - sine * s; sine = sine * c + cosine * s; cosine = next;
  }
  return sum;
}

class PotionTasteDSP {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate;
    this.roach = new RoachPercussion(rate, true); this.zing = new RoachZing(rate);
    this.roach.configure(141, .64, .52, 1.3, .4); this.zing.tune(141, .7, .6, .3);
    this.fmDrums = new FmTasteDSP(rate); this.hyperRubix = new HyperRubixTasteDSP(rate);
    this.clips = witchBiteClips(); this.variants = witchBiteVariants();
    this.roachWings = this.clips['roach-wings'];
    this.throatProfiles = THROAT_TASTE_PROFILES.map(profile => ({ ...profile, body: throatVoiceParameters(profile.state, 0, rate) }));
    this.alienProfiles = ALIEN_TASTES.map(profile => ({ ...profile, body: throatVoiceParameters(profile.state, 0, rate) }));
    this.sawBanks = SAW_TASTE_STATES.map((state, variant) => buildPhysicalModalBank('bowed-things', {
      presetId: 'musical-saw', baseFrequencyHz: bendToFrequency(state), damping: variant ? state.bladeDamping : .5,
      brightness: variant ? state.brightness : .5, energy: .58, stereoWidth: .3,
      bowPressure: variant ? state.bowPressure : .65, bowVelocity: variant ? state.bowSpeed : .5,
      bowPosition: .4, rosin: variant ? state.rosin : .6, size: 1 }, { sampleRate: rate, maxModes: 8 }));
    this.left = 0; this.right = 0;
    this.attack = 1 - Math.exp(-1 / (rate * .012)); this.release = 1 - Math.exp(-1 / (rate * .07));
  }
  createSlot(kind) {
    const clip = this.clips[kind] ?? null;
    const slot = { kind, variant: 0, nextVariant: 0, frames: SOURCE_TASTE_FRAMES[kind], sawState: { ...JULIE_SAW_DEFAULTS }, mask: 0, until: -1, age: 0, gain: 0, event: 0, nextEvent: 0,
      duration: Math.max(['drop-blech', 'drop-eyeball', 'drop-syrinx'].includes(kind) ? 5 : 2.4, clip ? clip.frames / clip.rate : 0),
      clip,
      phase: 0, phase2: 0, phase3: 0, low: 0, band: 0, random: 0x37c4a9,
      control: 0, lastL: 0, lastR: 0, tailL: 0, tailR: 0,
      formants: Array.from({ length: kind === 'drop-choir' ? 4 : 3 }, () => new Resonator(this.rate)),
      source: SOURCE_TASTE_FRAMES[kind] ? new SyrinxSourceEngine({ sampleRate: this.rate, seed: 0xa37d,
        model: SOURCE_TASTE_FRAMES[kind][0].model, parameters: SOURCE_TASTE_FRAMES[kind][0] }) : null,
      sawPhase: kind === 'drop-julie-saw' ? new Float64Array(8) : null };
    for (let i = 0; i < 3; i++) slot.formants[i].tune(HICCUP_TASTE_PLAN.formantFrequenciesHz[i], HICCUP_TASTE_PLAN.formantBandwidthsHz[i]);
    return slot;
  }
  trigger(slot) {
    const variant = slot.variant;
    slot.clip = this.variants[slot.kind]?.[variant] ?? this.clips[slot.kind] ?? null;
    slot.duration = Math.max(['drop-blech', 'drop-eyeball', 'drop-syrinx'].includes(slot.kind) ? 5 : 2.4,
      slot.clip ? slot.clip.frames / slot.clip.rate : 0);
    if (slot.source) {
      slot.frames = SOURCE_TASTE_VARIANTS[slot.kind][variant];
      slot.source.setParameters(slot.frames[0]);
    }
    if (slot.kind === 'drop-roach') {
      const taste = ROACH_TASTES[variant]; this.roach.configure(...taste.contact); this.zing.tune(...taste.wire);
    }
    if (slot.kind === 'drop-hiccup') {
      const plan = HICCUP_TASTES[variant].plan;
      for (let i = 0; i < 3; i++) slot.formants[i].tune(plan.formantFrequenciesHz[i], plan.formantBandwidthsHz[i]);
    }
    if (slot.kind === 'drop-julie-saw') Object.assign(slot.sawState, SAW_TASTE_STATES[variant]);
    if (slot.kind === 'drop-hyper-rubix') this.hyperRubix.score = HYPER_RUBIX_TASTE_SCORES[variant];
    slot.tailL = slot.lastL; slot.tailR = slot.lastR;
    slot.age = 0; slot.event = 0; slot.nextEvent = 0; slot.control = 0;
    if (slot.kind === 'drop-oculoid') this.fmDrums.reset();
    if (slot.kind === 'drop-hyper-rubix') this.hyperRubix.reset();
  }
  releaseAll() { this.roach.releaseAll(); }
  finish(slot, left, right) {
    const trim = (TASTE_LEVELS[slot.kind] ?? 1) * (TASTE_VARIANT_TRIMS[slot.kind]?.[slot.variant] ?? 1);
    left *= trim; right *= trim;
    const blend = Math.min(1, slot.age / (this.rate * .008));
    const outgoing = 1 - blend * blend * (3 - 2 * blend);
    this.left = slot.lastL = left * (1 - outgoing) + slot.tailL * outgoing;
    this.right = slot.lastR = right * (1 - outgoing) + slot.tailR * outgoing;
  }
  sample(slot, active) {
    slot.gain += ((active ? 1 : 0) - slot.gain) * (active ? this.attack : this.release);
    this.left = this.right = 0;
    if (slot.gain < 1e-8) return;
    const t = slot.age++ * this.dt, variant = slot.variant;
    let x = slot.random; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; slot.random = x | 0;
    const noise = (x >>> 0) / 2147483648 - 1;
    let sample = 0, frequency = 0;
    const fade = Math.min(1, Math.max(0, (slot.duration - t) / .23));
    if (slot.clip) {
      const { data, rate } = slot.clip, position = t * rate, index = Math.floor(position), mix = position - index;
      if (index + 1 < data.length) sample = data[index] + (data[index + 1] - data[index]) * mix;
    } else if (slot.kind === 'drop-choir') {
      // An excerpt of Throatazoid's authored Clear / Deep / Bright voices.
      // Its source harmonics and body resonances are reused directly; a fixed
      // four-formant miniature replaces the complete multi-mouth tube network.
      const position = Math.min(2.999999, t / .8), index = Math.floor(position), blend = position - index;
      const mix = blend * blend * (3 - 2 * blend);
      const order = THROAT_TASTE_ORDERS[variant];
      const a = this.throatProfiles[order[index]], b = this.throatProfiles[order[(index + 1) % 3]];
      frequency = a.state.exciterPitch + (b.state.exciterPitch - a.state.exciterPitch) * mix;
      const vibrato = a.state.exciterVibrato + (b.state.exciterVibrato - a.state.exciterVibrato) * mix;
      frequency *= 1 + Math.sin(t * TAU * 4.63) * vibrato * .02;
      slot.phase = (slot.phase + frequency * this.dt) % 1;
      if (slot.control-- <= 0) {
        for (let band = 0; band < 4; band++) {
          const center = a.body.formants[band] + (b.body.formants[band] - a.body.formants[band]) * mix;
          const resonance = a.body.resonance + (b.body.resonance - a.body.resonance) * mix;
          slot.formants[band].tune(center, center / resonance);
        }
        slot.control = 31;
      }
      const c = Math.cos(TAU * slot.phase), s = Math.sin(TAU * slot.phase);
      let cosine = c, sine = s, glottis = 0;
      for (let harmonic = 1; harmonic <= 48; harmonic++) {
        const fade = witchClamp((this.rate * .45 - frequency * harmonic) / (this.rate * .06));
        glottis += ((a.spectrum.real[harmonic] + (b.spectrum.real[harmonic] - a.spectrum.real[harmonic]) * mix) * cosine
          + (a.spectrum.imaginary[harmonic] + (b.spectrum.imaginary[harmonic] - a.spectrum.imaginary[harmonic]) * mix) * sine) * fade;
        const next = cosine * c - sine * s; sine = sine * c + cosine * s; cosine = next;
      }
      const source = glottis + noise * (a.state.exciterBreath + (b.state.exciterBreath - a.state.exciterBreath) * mix) * .07;
      sample = (slot.formants[0].next(source) * 1.7 + slot.formants[1].next(source) * 1.2
        + slot.formants[2].next(source) * .7 + slot.formants[3].next(source) * .35 + glottis * .09) * 2.2;
      sample *= Math.min(1, t / .035);
    } else if (slot.kind === 'drop-roach') {
      if (active && t >= slot.nextEvent && t < 2.1) {
        this.roach.strike(.64 + .2 * Math.sin(slot.event * 1.7), slot.event % 6);
        this.zing.excite(variant === 0 ? .35 : variant === 1 ? .64 : .22);
        const rhythm = ROACH_TASTES[variant].rhythm; slot.nextEvent += rhythm[slot.event++ % rhythm.length];
      }
      const taps = this.roach.sample(noise, 0, 2);
      const { data, rate } = this.roachWings, position = t * rate * ROACH_TASTES[variant].wings, index = Math.floor(position), mix = position - index;
      const flutter = index + 1 < data.length ? data[index] + (data[index + 1] - data[index]) * mix : 0;
      sample = (taps[0] * 1.2 + taps[2] * .58 + this.zing.sample(noise, active ? .14 : 0) * .74) * .8 + flutter * .5;
    } else if (slot.kind === 'drop-hyper-rubix') {
      const score = this.hyperRubix.score;
      if (active && slot.event < score.length && t >= score[slot.event].at) this.hyperRubix.strike(score[slot.event++]);
      this.hyperRubix.next();
      this.finish(slot, this.hyperRubix.left * slot.gain * fade, this.hyperRubix.right * slot.gain * fade);
      return;
    } else if (slot.kind === 'drop-hiccup') {
      const { plan, frames, interval } = HICCUP_TASTES[variant];
      const local = t % interval, progress = Math.min(1, local / plan.durationSeconds);
      const position = progress * 128, index = Math.min(127, Math.floor(position)), mix = position - index;
      const a = frames[index], b = frames[index + 1];
      const pressure = a.pressureDrive + (b.pressureDrive - a.pressureDrive) * mix;
      const catchAmount = a.diaphragmCatch + (b.diaphragmCatch - a.diaphragmCatch) * mix;
      const voicing = a.voicing + (b.voicing - a.voicing) * mix;
      const air = a.aspiration + (b.aspiration - a.aspiration) * mix;
      const turbulence = a.turbulence + (b.turbulence - a.turbulence) * mix;
      frequency = plan.glottalFrequencyHz * (1 + catchAmount * .76);
      slot.phase = (slot.phase + frequency * this.dt) % 1;
      const source = (2 * slot.phase - 1 - polyBlep(slot.phase, frequency * this.dt)) * voicing * pressure
        + noise * (air * .14 + turbulence * .22);
      sample = slot.formants[0].next(source) * 3.1 + slot.formants[1].next(source) * 2.4 + slot.formants[2].next(source) * 1.2;
      sample += Math.sin(slot.phase * TAU) * pressure * voicing * .14;
      sample *= 1.45;
    } else if (slot.source) {
      const repeat = CREATURE_TASTE_REPEATS[variant];
      const local = slot.kind === 'drop-eyeball' ? (t % repeat) / repeat : t / slot.duration;
      const position = Math.min(128, local * 128), index = Math.min(127, Math.floor(position)), mix = position - index;
      const frames = slot.frames, a = frames[index], b = frames[index + 1];
      if (slot.control-- <= 0) {
        for (const key of SOURCE_TASTE_KEYS) slot.source.target[key] = a[key] + (b[key] - a[key]) * mix;
        for (let i = 0; i < 3; i++) {
          const key = TASTE_FORMANT_KEYS[i]; slot.formants[i].tune(a[key] + (b[key] - a[key]) * mix, 80 + i * 75);
        }
        slot.control = 31;
      }
      const source = slot.source.renderSample(slot.low * .12);
      sample = source * .18 + slot.formants[0].next(source) * 2.4 + slot.formants[1].next(source) * 1.7 + slot.formants[2].next(source) * .7;
      slot.low += .14 * (sample - slot.low);
      sample *= 1.7 * Math.min(1, t / .025);
    } else if (slot.kind === 'drop-glass') {
      // Alien Larynx's Double Fold snapshot: actual LF coefficients and tract,
      // with its second fold, asymmetry, and bounded local feedback.
      const { state, spectrum, body } = this.alienProfiles[variant], larynx = state.alien.larynx;
      frequency = state.exciterPitch * (1 + Math.sin(t * 5.7) * .04);
      slot.phase = (slot.phase + frequency * this.dt) % 1;
      slot.phase2 = (slot.phase2 + frequency * .5 * this.dt) % 1;
      const primary = spectrumSample(spectrum, slot.phase, frequency, this.rate);
      const fold = spectrumSample(spectrum, slot.phase2, frequency * .5, this.rate);
      const source = Math.tanh(primary + fold * larynx.falseFoldMix + slot.low * larynx.feedback)
        * (1 + Math.sin(slot.phase2 * TAU) * larynx.asymmetry);
      if (slot.control-- <= 0) {
        for (let i = 0; i < 3; i++) slot.formants[i].tune(body.formants[i], body.formants[i] / body.resonance);
        slot.control = 31;
      }
      sample = slot.formants[0].next(source) * 2.8 + slot.formants[1].next(source) * 1.8 + slot.formants[2].next(source) * .7;
      slot.low += .2 * (sample - slot.low); sample *= Math.min(1, t / .03);
    } else if (slot.kind === 'drop-earwax') {
      const { profiles, starts } = DIGEST_TASTES[variant];
      let index = starts.length - 1; while (index > 0 && t < starts[index]) index--;
      const profile = profiles[index], age = Math.max(0, t - starts[index]);
      const envelope = Math.min(1, age / profile.attackSeconds) * Math.exp(-age / profile.releaseSeconds);
      frequency = profile.peakFrequencyHz * (1 + .3 * Math.exp(-age * 18));
      slot.phase = (slot.phase + frequency * this.dt) % 1;
      slot.phase2 = (slot.phase2 + frequency * .47 * this.dt) % 1;
      if (slot.control-- <= 0) { slot.formants[0].tune(profile.peakFrequencyHz, profile.bandwidthHz); slot.control = 31; }
      const source = Math.sin(slot.phase * TAU + Math.sin(slot.phase2 * TAU) * 2.3) + noise * .27;
      sample = (slot.formants[0].next(source) * 2.1 + source * .25) * envelope * .66;
    } else if (slot.kind === 'drop-blowhole') {
      const position = Math.min(128, t / 2.4 * 128), index = Math.min(127, Math.floor(position)), mix = position - index;
      const a = BLOWHOLE_TASTE_FRAMES[index], b = BLOWHOLE_TASTE_FRAMES[index + 1];
      for (let i = 0; i < a.voices.length; i++) {
        const first = a.voices[i], next = b.voices[i], key = i ? 'phase2' : 'phase';
        frequency = first.monitorFrequencyHz + (next.monitorFrequencyHz - first.monitorFrequencyHz) * mix;
        slot[key] = (slot[key] + Math.min(this.rate * .35, frequency) * this.dt) % 1;
        const gain = first.gain + (next.gain - first.gain) * mix;
        const closure = first.closure + (next.closure - first.closure) * mix;
        const roughness = first.roughness + (next.roughness - first.roughness) * mix;
        const phase = slot[key] * TAU;
        sample += (Math.sin(phase) + Math.sin(phase * 2) * closure * .37 + noise * roughness * .05) * gain * .68;
      }
    } else if (slot.kind === 'drop-throat-singing') {
      frequency = THROAT_SINGER_TASTE.trueFoldHz * THROAT_SINGER_SPECTRUM.baseFrequencyRatio;
      slot.phase = (slot.phase + frequency * this.dt) % 1;
      if (slot.control-- <= 0) {
        const focus = SINGER_FOCUS_FRAMES[Math.min(128, Math.floor(t / 2.4 * 128))];
        slot.formants[0].tune(340, 150); slot.formants[1].tune(focus.f2Hz, focus.bandwidthHz); slot.formants[2].tune(focus.f3Hz, focus.bandwidthHz);
        slot.control = 63;
      }
      const source = spectrumSample(THROAT_SINGER_SPECTRUM, slot.phase, frequency, this.rate);
      sample = source * .16 + slot.formants[0].next(source) * 1.6 + slot.formants[1].next(source) * 2.5 + slot.formants[2].next(source) * 2.2;
      sample *= Math.min(1, t / .045);
    } else if (slot.kind === 'drop-julie-saw') {
      const state = slot.sawState, bank = this.sawBanks[variant], blade = julieSawBlade(state.bladeId);
      // Continuous blade flex and the actual musical-saw modal ratios/T60s.
      // A short bow excites this fixed modal bank; no note quantization.
      if (slot.control-- <= 0) { const bend = SAW_TASTE_BENDS[variant]; state.bend = bend[0] + bend[1] * Math.sin(t * bend[2]) ** 2; slot.frequency = bendToFrequency(state); slot.control = 31; }
      frequency = slot.frequency;
      const bow = Math.min(1, t / .16) * Math.min(1, (2.4 - t) / .3);
      for (let i = 0; i < bank.modeCount; i++) {
        const hz = frequency * bank.frequenciesHz[i] / bank.fundamentalHz;
        if (hz > this.rate * .44) continue;
        slot.sawPhase[i] = (slot.sawPhase[i] + hz * (1 + .008 * Math.sin(t * 32)) * this.dt) % 1;
        const t60 = bank.t60Seconds[i] * blade.decayScale;
        sample += Math.sin(slot.sawPhase[i] * TAU) * bank.gains[i] * Math.exp(-t / Math.max(.3, t60)) / (1 + i * .45);
      }
      sample = (sample * .54 + noise * state.edgeRasp * .018) * bow;
    } else if (slot.kind === 'drop-oculoid') {
      const timing = FM_TASTE_TIMING[variant];
      if (active && t >= slot.nextEvent && slot.event < timing[0]) {
        const kit = FM_TASTE_KITS[variant], rhythm = FM_TASTE_RHYTHMS[variant];
        this.fmDrums.strike(kit[rhythm[slot.event % rhythm.length]]);
        if (slot.event % timing[1] === 0) this.fmDrums.strike(kit[2]);
        slot.event++; slot.nextEvent += slot.event % 4 === 3 ? timing[2] : timing[3];
      }
      sample = this.fmDrums.next();
    }
    sample *= slot.gain * fade;
    const pan = slot.kind === 'drop-oculoid' ? Math.sin(t * 5.3) * .8 : Math.sin(t * 2.7) * .22;
    this.finish(slot, sample * Math.cos((pan + 1) * Math.PI / 4), sample * Math.sin((pan + 1) * Math.PI / 4));
  }
}

/** Fixed ingredient slots share a five-voice Gesticules engine and
 * bounded miniature components. A retrigger reuses the same slot and clocks;
 * every phrase finishes, leaving the continuing singer and fingers audible. */
class DroppedInstrumentDSP {
  constructor(rate) {
    this.rate = rate; this.clock = 0; this.enabled = false; this.dormant = true;
    this.hand = new HandDSP(rate); this.tastes = new PotionTasteDSP(rate);
    this.solo = 0; this.kind = ''; this.handTrim = this.handTrimTarget = 1; this.handMakeup = 1.4; this.handMakeupTarget = 1.4; this.levels = new Float32Array(128);
    this.slots = WITCH_DROP_EFFECTS.map(kind => ({ ...this.tastes.createSlot(kind), mask: kind === 'drop-gesticules' ? 19 : 0 }));
    this.handConfigs = [0, 1, 2].map(variant => ({
      motion: { id: ['flourish', 'scatter', 'flick'][variant], tempo: [90, 176, 246][variant], amount: [.48, .82, .94][variant] }, tremor: { amount: [0, .3, .58][variant] },
      pose: { fingers: [.12, .28, .18, .38, .22].map(bend => ({ mcp: bend * 50, pip: bend * 60, dip: bend * 40, spread: 0 })) },
      sound: { rhythm: 'continuous', rootHz: [137, 61, 169][variant], pitchSpread: [1.6, 1.1, 2][variant], brightness: [.64, .38, .83][variant], roughness: [.12, .78, .62][variant],
        attack: .012, release: .42, space: .16, rotationFx: 0 },
      voices: [['glass', 'wire', 'marimba', 'choir', 'metal'], ['bowed', 'wire', 'metal', 'bowed', 'reed'], ['marimba', 'pulse', 'metal', 'wire', 'glass']][variant].map(source => ({ source, level: .86 })),
    }));
    this.hand.setConfig(this.handConfigs[0]);
    this.hand.setSoundPlaying(false); this.hand.setTransport({ playing: true }); this.hand.reset();
    this.attack = 1 - Math.exp(-1 / (rate * .018)); this.release = 1 - Math.exp(-1 / (rate * .12));
  }
  setEnabled(enabled) {
    this.enabled = enabled === true; this.hand.setEnabled(this.enabled);
    if (!this.enabled) this.releaseAll();
  }
  releaseAll() { for (const slot of this.slots) slot.until = -1; this.tastes.releaseAll(); }
  trigger(kind, variant) {
    const slot = this.slots.find(slot => slot.kind === kind);
    if (!this.enabled || !slot) return false;
    slot.variant = Number.isInteger(variant) && variant >= 0 && variant < 3 ? variant : slot.nextVariant;
    slot.nextVariant = (slot.variant + 1) % 3;
    this.tastes.trigger(slot);
    if (slot.mask) {
      this.hand.setConfig(this.handConfigs[slot.variant]);
      this.handTrimTarget = slot.variant === 0 ? 1 : slot.variant === 1 ? .6 : .66;
    }
    slot.until = this.clock + Math.round(this.rate * slot.duration);
    this.kind = kind; this.variant = slot.variant; this.dormant = false;
    for (let i = 0; i < 5; i++) if (slot.mask & (1 << i)) this.hand.auditionFinger(i, .08, this.clock / this.rate);
    return true;
  }
  process(left, right) {
    if (this.dormant) { left.fill(0); right.fill(0); this.levels.fill(0); this.clock += left.length; return; }
    let offset = 0;
    while (offset < left.length) {
      let mask = 0, active = false, boundary = Infinity;
      for (const slot of this.slots) if (slot.until > this.clock) {
        mask |= slot.mask; active = true; boundary = Math.min(boundary, slot.until);
      }
      this.hand.setHeldFingers(mask);
      if (mask) this.handMakeupTarget = mask === 4 ? 5.5 : 1.4;
      const count = Math.min(left.length - offset, boundary - this.clock);
      this.hand.process(offset === 0 && count === left.length ? left : left.subarray(offset, offset + count),
        offset === 0 && count === right.length ? right : right.subarray(offset, offset + count), this.clock / this.rate);
      active = this.enabled && active;
      for (let i = offset; i < offset + count; i++) {
        this.handMakeup += (this.handMakeupTarget - this.handMakeup) * this.attack;
        this.handTrim += (this.handTrimTarget - this.handTrim) * this.attack;
        left[i] *= this.handMakeup * this.handTrim; right[i] *= this.handMakeup * this.handTrim;
        for (const slot of this.slots) if (!slot.mask && (slot.until > this.clock || slot.gain > 1e-8)) {
          this.tastes.sample(slot, this.enabled && slot.until > this.clock);
          left[i] += this.tastes.left; right[i] += this.tastes.right;
        }
        this.solo += ((active ? 1 : 0) - this.solo) * (active ? this.attack : this.release);
        this.levels[i] = this.solo; this.clock++;
      }
      offset += count;
    }
    if (this.solo < 1e-6) this.kind = '';
    if (this.solo < 1e-7 && this.hand.rms < 1e-9) { this.hand.reset(); this.dormant = true; }
  }
}

/** Candy Coil's windowed read-head cloud after the complete mix. A long fixed
 * history, cross-channel dub feedback and slewed reads keep noodle edits audible
 * without changing the singer, hand or independent flight clocks. */
export class FlightMixDelay {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.controls = normalizeWitchControls();
    this.buffers = [new Float32Array(Math.ceil(rate * 10.5)), new Float32Array(Math.ceil(rate * 10.5))];
    this.writeIndex = 0; this.ridePhase = 0; this.wet = 0; this.feedback = 0; this.master = 0;
    this.delayL = rate * .32; this.delayR = rate * .39; this.lowL = 0; this.lowR = 0;
    this.dcL = 0; this.dcR = 0; this.pull = .5; this.twist = .5; this.space = .5; this.headPhase = 0; this.activityHold = 0;
    this.stopping = false; this.previousGate = false; this.previousGhostGate = false;
    this.left = 0; this.right = 0; this.wetLeft = 0; this.wetRight = 0; this.cleared = true;
    this.smooth = 1 - Math.exp(-1 / (rate * .08)); this.fade = 1 - Math.exp(-1 / (rate * .025));
    this.release = 1 - Math.exp(-1 / (rate * .09)); this.dcCut = 1 - Math.exp(-TAU * 24 / rate);
  }
  resume() {
    this.stopping = false;
    this.previousGate = this.controls.gate; this.previousGhostGate = this.controls.ghostGate;
  }
  read(buffer, delay) {
    const position = (this.writeIndex - delay + buffer.length) % buffer.length;
    const index = Math.floor(position), fraction = position - index;
    return buffer[index] + (buffer[(index + 1) % buffer.length] - buffer[index]) * fraction;
  }
  next(left, right, enabled) {
    const c = this.controls, flying = c.mode === 'flight';
    if ((this.previousGate && !c.gate && !c.ghostGate)
      || (this.previousGhostGate && !c.ghostGate && !c.gate)) this.stopping = true;
    if ((!this.previousGate && c.gate) || (!this.previousGhostGate && c.ghostGate)) this.stopping = false;
    this.previousGate = c.gate; this.previousGhostGate = c.ghostGate;
    this.activityHold = Math.abs(left) + Math.abs(right) > 1e-5 ? 2.5 : Math.max(0, this.activityHold - this.dt);
    // An explicit Stop fades history even while source release envelopes are
    // still audible. A fresh manual accent can reopen the delay while stopped.
    const running = !this.stopping && (c.gate || c.ghostGate || this.activityHold > 0);
    this.pull += (c.trailPull - this.pull) * this.smooth;
    this.twist += (c.trailTwist - this.twist) * this.smooth;
    this.space += (witchClamp(c.trailSpace, 0, 1, .5) - this.space) * this.smooth;
    const regeneration = witchClamp(c.trailFeedback, 0, 1, .55);
    const wetTarget = flying && running ? .24 + this.space * .7 : 0;
    this.wet += (wetTarget - this.wet) * (running ? this.smooth : this.release);
    this.feedback += ((flying && running ? .18 + regeneration * .75 : 0) - this.feedback) * this.smooth;
    const ride = (.01 + Math.abs(this.twist - .5) * .04) * Math.sin(this.ridePhase);
    const seconds = .065 + this.pull * 3 + c.altitude * .1 + ride;
    // A bounded read-head slope avoids abrupt discontinuities on pointer edits.
    this.delayL += witchClamp(seconds * this.rate - this.delayL, -.38, .38);
    this.delayR += witchClamp(seconds * (.83 + c.flightX * .34) * this.rate - this.delayR, -.38, .38);
    // Native Candy curve/window and fractional head activation. Smoothly morph
    // direction through the center instead of switching an occupied read head.
    const heads = 4 + this.space * 8, span = (.08 + this.space * 5.8) * this.rate;
    const direction = (1 + Math.tanh((this.twist - .5) * 7)) * .5;
    const tilt = (this.twist - .5) * 1.6;
    let movingL = 0, movingR = 0, weightSum = 0;
    for (let i = 0; i < Math.ceil(heads); i++) {
      const phase = (this.headPhase + i / heads) % 1;
      const weight = barberDelayWindow(phase, tilt) * Math.min(1, heads - i) * 2 / heads;
      const curve = barberDelayCurve('candy', phase, true);
      const delay = (curve * direction + (1 - curve) * (1 - direction)) * span;
      movingL += this.read(this.buffers[0], this.delayL + delay) * weight;
      movingR += this.read(this.buffers[1], this.delayR + delay * (.86 + this.space * .14)) * weight;
      weightSum += weight;
    }
    const headGain = 1 / Math.max(1, weightSum), coil = .2 + this.space * .72;
    const echoL = this.read(this.buffers[0], this.delayL) * (1 - coil) + movingL * headGain * coil;
    const echoR = this.read(this.buffers[1], this.delayR) * (1 - coil) + movingR * headGain * coil;
    if (running) this.headPhase = (this.headPhase + this.dt
      * (.012 + Math.abs(this.twist - .5) * .14 + this.space * .025)
      * sandySyrupTargetRate(4.5, this.twist, true)) % 1;
    const lowpass = 1 - Math.exp(-TAU * (600 + (1 - this.space) * 2200 + (1 - regeneration) * 900) / this.rate);
    this.lowL += lowpass * (echoL - this.lowL); this.lowR += lowpass * (echoR - this.lowR);
    this.dcL += this.dcCut * (this.lowL - this.dcL); this.dcR += this.dcCut * (this.lowR - this.dcR);
    this.buffers[0][this.writeIndex] = enabled && running ? Math.tanh((left + (this.lowR - this.dcR) * this.feedback) / .8) * .8 : 0;
    this.buffers[1][this.writeIndex] = enabled && running ? Math.tanh((right + (this.lowL - this.dcL) * this.feedback) / .8) * .8 : 0;
    this.writeIndex = (this.writeIndex + 1) % this.buffers[0].length;
    this.master += ((enabled ? 1 : 0) - this.master) * this.fade;
    this.wetLeft = Math.tanh(echoL / .54) * .54 * this.wet * this.master;
    this.wetRight = Math.tanh(echoR / .54) * .54 * this.wet * this.master;
    // Keep the ensemble present while the long coil fills. A send-style echo
    // avoids losing almost all direct sound at the widest noodle setting.
    const direct = 1 - this.wet * .1;
    this.left = left * direct * this.master + this.wetLeft;
    this.right = right * direct * this.master + this.wetRight;
    if (enabled && running) this.cleared = false;
    else if (!this.cleared && ((!enabled && this.master < 1e-7) || (!running && this.wet < 1e-7))) {
      for (const buffer of this.buffers) buffer.fill(0);
      this.lowL = this.lowR = this.dcL = this.dcR = 0; this.cleared = true;
    }
    if(c.gate) this.ridePhase += (1 + c.flightSpeed * 5) * this.dt;
  }
}

/** Eight pairs from Fabric Filter's actual lattice, planar pull and Q mapping.
 * The centered fabric rests dry; displacement reveals its parallel resonators
 * across the whole flight mix. Fixed TPT states slew without seeking audio. */
export class WitchFabricFilter {
  constructor(rate) {
    this.rate = rate; this.wet = 0; this.targetWet = 0; this.left = 0; this.right = 0;
    this.smooth = 1 - Math.exp(-1 / (rate * .045));
    this.filters = Array.from({ length: 16 }, () => ({ ic1: 0, ic2: 0, a1: 1, a2: 0, a3: 0, k: 1,
      gainL: 0, gainR: 0, targetGainL: 0, targetGainR: 0, target: null }));
    this.setControls(.5, .5);
  }
  setControls(x, y, pull = 0, velocity = 0) {
    const a = (witchClamp(x, 0, 1, .5) - .5) * 2, b = (witchClamp(y, 0, 1, .5) - .5) * 2;
    pull = witchClamp(pull); velocity = witchClamp(velocity);
    const amount = Math.min(1, Math.hypot(a, b) * .85 + pull * .65 + velocity * .2);
    this.targetWet = 1 - (1 - amount) ** 2;
    for (let i = 0; i < 16; i++) {
      const target = moireFilterTarget({ index: i % 8, bank: i >> 3, sampleRate: this.rate,
        phaseA: a * .38, phaseB: .37 + b * .38,
        fabricVectorAX: a * (1 + pull * .7), fabricVectorAY: b,
        fabricVectorBX: -b, fabricVectorBY: a * (1 + pull * .7),
        fabricVectorVelocityAX: Math.sign(a) * velocity * 12,
        fabricVectorVelocityBY: Math.sign(b) * velocity * 12,
        parameters: { filterPairs: 8, lowFrequency: 85, highFrequency: 7800,
          resonance: .3 + pull * .48 + velocity * .12 + Math.abs(b) * .09,
          resonanceMotion: .76, fabricDepth: 3.4, fieldADepth: .85, fieldBDepth: 1.05,
          pluckCut: 0, stereoWidth: .84 } });
      const f = this.filters[i], pan = (target.pan + 1) * Math.PI / 4;
      // Keep native lattice/collision gain, without applying the source page's
      // extra fabric-cut fade to this already mixed external performance.
      const gain = target.gain / Math.max(.08, target.fabricCut);
      f.target = stableSvfCoefficients(target.frequency, target.q, this.rate);
      f.targetGainL = gain * Math.cos(pan); f.targetGainR = gain * Math.sin(pan);
    }
  }
  next(left, right) {
    this.wet += (this.targetWet - this.wet) * this.smooth;
    let bandL = 0, bandR = 0;
    for (let i = 0; i < 16; i++) {
      const f = this.filters[i], t = f.target, source = i < 8 ? left : right;
      f.a1 += (t.a1 - f.a1) * this.smooth; f.a2 += (t.a2 - f.a2) * this.smooth;
      f.a3 += (t.a3 - f.a3) * this.smooth; f.k += (t.k - f.k) * this.smooth;
      f.gainL += (f.targetGainL - f.gainL) * this.smooth;
      f.gainR += (f.targetGainR - f.gainR) * this.smooth;
      const v3 = source - f.ic2, v1 = f.a1 * f.ic1 + f.a2 * v3;
      const v2 = f.ic2 + f.a2 * f.ic1 + f.a3 * v3;
      f.ic1 = 2 * v1 - f.ic1; f.ic2 = 2 * v2 - f.ic2;
      const band = v1 * f.k;
      bandL += band * f.gainL; bandR += band * f.gainR;
    }
    this.left = left * (1 - this.wet * .89) + bandL * this.wet * 1.8;
    this.right = right * (1 - this.wet * .89) + bandR * this.wet * 1.8;
  }
}

/** Voice and Gesticules keep their clocks together. Focus changes balance,
 * dropped instruments briefly solo, and flight delays the complete performance. */
export class WitchDSP {
  constructor(rate = 48000, seed = 0x71c4) {
    this.rate = witchClamp(rate, 8000, 192000, 48000); this.dt = 1 / this.rate;
    this.controls = normalizeWitchControls(); this.enabled = false; this.time = 0;
    this.brew = new CauldronDSP(this.rate, seed); this.hand = new WitchHandDSP(this.rate); this.flight = new FlightDSP(this.rate);
    this.hand.setWitchControls(this.controls); this.hand.reset();
    this.weights = new Float64Array([.72, .28, 0]); this.fadeFrom = new Float64Array(this.weights);
    this.fadeSamples = Math.round(.04 * this.rate); this.fadePosition = this.fadeSamples;
    this.drops = new DroppedInstrumentDSP(this.rate); this.delay = new FlightMixDelay(this.rate);
    this.catDropSlot = this.drops.slots.find(slot => slot.kind === 'drop-cat');
    this.cat = new WitchCatDSP(this.rate); this.fabric = new WitchFabricFilter(this.rate); this.fabricMix = 0;
    this.visitors = new WitchVisitorDSP(this.rate);
    this.fabricWind = new WitchFabricWind(this.rate);
    this.blechFlyby = new WitchBlechFlyby(this.rate);
    this.scene = new WitchSceneDSP(this.rate); this.shock = new WitchEyeShock(this.rate);
    this.ghosts = new WitchGhostDSP(this.rate); this.backingEnergy = 0;
    this.backingFollow = 1 - Math.exp(-this.dt / .025);
    this.buffers = Array.from({ length: 8 }, () => new Float32Array(128));
    this.visual = { ...this.brew.visual, handTime: 0, flightPhase: 0, brewLevel: 0, handLevel: 0, dropLevel: 0, dropKind: '', dropVariant: 0, dropEnvelope: 0,
      catClock: this.cat.clock, catTime: 0, catLevel: 0, catMeow: 0, catMeowLevel: 0,
      ghostPhase: 0, ghostPresence: [0, 0, 0], ghostPulses: [0, 0, 0], ghostLevel: 0, flybyTime: 0, flybyLevel: 0, treeEnvelope: 0, treeLevel: 0,
      delayWet: 0, delayTime: .32, delayLevel: 0, fingerLevels: [0, 0, 0, 0, 0], flightPulse: 0, flightStep: 0, launchEnvelope: 0, launchActive: false };
    this.setControls(this.controls);
  }
  get chantPhase() { return this.brew.chantPhase; }
  get effectCounter() { return this.flight.noteCount; }
  get effects() { return this.brew.effects; }
  syncPhase(phase, speed = 0, handTime, spoonHeight, flightPhase, ghostPhase, catClock, flybyTime, visitorCaptures) {
    this.brew.syncPhase(phase, speed);
    if (Number.isFinite(flybyTime)) { this.blechFlyby.syncTime(flybyTime); this.visual.flybyTime = this.blechFlyby.time; this.visual.flybyLevel = 0; }
    if (catClock && typeof catClock === 'object') {
      this.cat.syncTime(catClock); this.visual.catClock = this.cat.clock; this.visual.catTime = this.cat.time;
      this.visitors.syncTime(this.cat.time, visitorCaptures);
      this.visual.catMeow = 0; this.visual.catMeowLevel = 0;
    }
    this.visual.phase = this.brew.phase; this.visual.speed = this.brew.speed;
    if (Number.isFinite(ghostPhase)) { this.ghosts.syncPhase(ghostPhase); this.visual.ghostPhase = this.ghosts.phase; }
    if (Number.isFinite(handTime)) {
      this.hand.setTransport({ time: witchClamp(handTime, 0, 1e9) }, this.time);
      this.visual.handTime = this.hand.getMotionTime(this.time);
      this.brew.spoonTime = this.visual.handTime;
      this.delay.ridePhase = Number.isFinite(flightPhase) ? witchClamp(flightPhase, 0, 1e12) * 1.4 : this.visual.handTime * (1 + this.controls.flightSpeed * 5);
      this.visual.flightPhase = this.delay.ridePhase / 1.4;
      this.brew.spoonHeight = witchClamp(spoonHeight, 0, 1,
        this.controls.spoonAuto ? witchSpoonHeight(this.visual.handTime) : this.controls.spoonHeight);
      this.visual.spoonHeight = this.brew.spoonHeight; this.brew.controlSamples = 0;
    }
  }
  setControls(value) {
    const previous = this.controls;
    this.controls = normalizeWitchControls({ ...previous, ...value,
      handFocus: value.mode && value.mode !== previous.mode && value.handFocus === undefined ? undefined : value.handFocus ?? previous.handFocus });
    const c = this.controls;
    if (c.handFocus !== previous.handFocus || c.spellBalance !== previous.spellBalance) {
      this.fadeFrom.set(this.weights); this.fadePosition = 0;
    }
    // Preserve the brewed anatomy underneath hand gestures: bending an
    // instrumental finger must not simultaneously reshape the background voice.
    this.brew.setControls({ ...c, mode: 'brew', fingers: this.brew.controls.fingers });
    this.flight.setControls({ ...c, gate: false }); // flight is the shared delay; accents remain explicit.
    this.delay.controls = c;
    if (c.fabricX !== previous.fabricX || c.fabricY !== previous.fabricY
      || c.fabricPull !== previous.fabricPull || c.fabricVelocity !== previous.fabricVelocity) {
      this.fabric.setControls(c.fabricX, c.fabricY, c.fabricPull, c.fabricVelocity);
    }
    if (c.treeSpread !== previous.treeSpread || c.treeCurl !== previous.treeCurl) {
      this.scene.tree.setControls(c.treeSpread, c.treeCurl);
    }
    if (previous.gate && !c.gate) { this.drops.releaseAll(); this.flight.launch.cancel(); this.scene.releaseAll(); this.shock.cancel(); this.fabricWind.cancel(); }
    if (previous.mode === 'flight' && c.mode !== 'flight') { this.fabricWind.cancel(); this.blechFlyby.release(); }
    if (previous.ghostGate && !c.ghostGate) { this.cat.release(); this.visitors.release(); this.blechFlyby.release(); this.scene.tree.release(); }
    if (c.handAuto !== previous.handAuto || c.handMotion !== previous.handMotion || c.handRate !== previous.handRate || c.handDepth !== previous.handDepth || c.handSound !== previous.handSound || c.tone !== previous.tone || c.manualFingerMask !== previous.manualFingerMask || c.fingers.some((v, i) => v !== previous.fingers[i])) {
      this.hand.setWitchControls(c);
      if (c.gate && this.enabled) {
        const mask = c.fingerMask || 31;
        for (let i = 0; i < 5; i++) if ((mask & (1 << i)) && Math.abs(c.fingers[i] - previous.fingers[i]) > .002) {
          this.hand.auditionFinger(i, .06, this.time);
        }
      }
    }
    this.hand.setTransport({ playing: c.gate }, this.time);
    this.hand.setSoundPlaying(false);
    this.hand.setHeldFingers(c.gate ? c.fingerMask || 31 : 0);
    this.hand.setEnabled(this.enabled); this.brew.setEnabled(this.enabled); this.flight.setEnabled(this.enabled);
  }
  setEnabled(enabled) {
    this.enabled = enabled === true;
    this.brew.setEnabled(this.enabled); this.hand.setEnabled(this.enabled); this.flight.setEnabled(this.enabled);
    this.drops.setEnabled(this.enabled);
    if (!this.enabled) { this.cat.release(); this.visitors.release(); this.scene.releaseAll(); this.shock.cancel(); this.fabricWind.cancel(); this.blechFlyby.release(); }
  }
  /** Cancel manual gestures without seeking or changing either transport. */
  releaseAccents() {
    this.drops.releaseAll(); this.scene.releaseAll(); this.shock.cancel(); this.fabricWind.cancel(); this.blechFlyby.release();
    this.cat.release(); this.visitors.release(); this.brew.releaseAccents(); this.flight.releaseAccents();
  }
  trigger(kind, variant) {
    if (!this.enabled) return false;
    let accepted;
    if (kind === 'fabric-wind') {
      if (this.controls.mode !== 'flight') return false;
      this.fabricWind.trigger(); accepted = true;
    } else if (kind === 'meow') accepted = this.controls.ghostGate && !this.controls.catCaptured && this.cat.triggerMeow();
    else if (kind === 'eye-shock') { this.shock.trigger(); accepted = true; }
    else if (this.scene.trigger(kind)) accepted = true;
    else if (WITCH_DROP_EFFECTS.includes(kind)) {
      accepted = this.drops.trigger(kind, variant);
      if (accepted && (kind === 'drop-mouse' || kind === 'drop-lizard')) this.visitors.capture(kind.slice(5));
    }
    else if (WITCH_FLIGHT_EFFECTS.includes(kind) && (this.controls.mode === 'flight' || !WITCH_VOCAL_EFFECTS.includes(kind))) accepted = this.flight.trigger(kind);
    else accepted = this.brew.trigger(kind);
    if (accepted) this.delay.resume();
    return accepted;
  }
  process(left, right = left) {
    const c = this.controls, focusedVoice = .72 - c.handFocus * .54;
    // The midpoint keeps the established scene balance. Hand-heavy presets
    // can lead even with the hand closed; the singer always keeps a small part.
    // Biasing a preset toward voice still leaves room for finger instruments.
    const voiceWeight = c.spellBalance <= .5
      ? focusedVoice + (1 - focusedVoice) * .75 * (1 - c.spellBalance * 2)
      : .06 + (focusedVoice - .06) * (2 - c.spellBalance * 2) ** 1.6;
    let energy = 0, brewEnergy = 0, handEnergy = 0, dropEnergy = 0, delayEnergy = 0, ghostEnergy = 0, flybyEnergy = 0, treeEnergy = 0;
    for (let offset = 0; offset < left.length; offset += 128) {
      const count = Math.min(128, left.length - offset);
      const b = count === 128 ? this.buffers : this.buffers.map(buffer => buffer.subarray(0, count));
      this.brew.process(b[0], b[1]);
      this.hand.process(b[2], b[3], this.time); this.flight.process(b[4], b[5]); this.drops.process(b[6], b[7]);
      for (let i = 0; i < count; i++) {
        const fade = Math.min(1, ++this.fadePosition / this.fadeSamples);
        this.weights[0] = this.fadeFrom[0] * (1 - fade) + voiceWeight * fade;
        this.weights[1] = 1 - this.weights[0];
        // Limit each engine before crossfading: changing scenes never changes
        // the transfer curve underneath a ringing sound.
        const handL = Math.tanh(b[2][i] * 1.7 / .54) * .54 * this.weights[1];
        const handR = Math.tanh(b[3][i] * 1.7 / .54) * .54 * this.weights[1];
        const soloMix = this.drops.levels[i] * .58, backing = 1 - this.drops.levels[i] * .28;
        const dropL = Math.tanh(b[6][i] * 1.7 / .54) * .54 * soloMix;
        const dropR = Math.tanh(b[7][i] * 1.7 / .54) * .54 * soloMix;
        const bedL = b[0][i] * this.weights[0] + handL, bedR = b[1][i] * this.weights[0] + handR;
        this.backingEnergy += ((bedL * bedL + bedR * bedR) * .5 - this.backingEnergy) * this.backingFollow;
        this.ghosts.next(c, this.enabled);
        this.cat.next(c, this.enabled && c.ghostGate && !c.catCaptured, c.ghostGate);
        this.visitors.next(this.cat.time, this.enabled && c.ghostGate && c.mode !== 'flight');
        this.scene.next(this.enabled);
        this.fabricWind.next(c, this.enabled && c.mode === 'flight');
        this.blechFlyby.next(c, this.enabled);
        // The visitors stay below the singer/fingers even in very quiet
        // patches. Featured potion objects duck them with the other backing.
        const ghostCeiling = Math.min(.028, Math.sqrt(Math.max(0, this.backingEnergy)) * .3);
        const ghostL = this.ghosts.left * ghostCeiling * backing, ghostR = this.ghosts.right * ghostCeiling * backing;
        // The clicked head is featured above its feet, through the same flight
        // delay and Fabric filter as every other performer.
        const catL = (this.cat.left * .85 + this.cat.meowLeft * .9) * backing;
        const catR = (this.cat.right * .85 + this.cat.meowRight * .9) * backing;
        const visitorL = this.visitors.left * backing, visitorR = this.visitors.right * backing;
        const dryL = Math.tanh((bedL * backing + ghostL + catL + visitorL + dropL + this.scene.left + this.fabricWind.left + this.blechFlyby.left + b[4][i] * .85) / .54) * .54;
        const dryR = Math.tanh((bedR * backing + ghostR + catR + visitorR + dropR + this.scene.right + this.fabricWind.right + this.blechFlyby.right + b[5][i] * .85) / .54) * .54;
        this.delay.next(dryL, dryR, this.enabled);
        this.fabric.next(this.delay.left, this.delay.right);
        this.fabricMix += ((c.mode === 'flight' ? 1 : 0) - this.fabricMix) * this.fabric.smooth;
        this.shock.next(this.delay.left + (this.fabric.left - this.delay.left) * this.fabricMix,
          this.delay.right + (this.fabric.right - this.delay.right) * this.fabricMix, this.enabled);
        // Fixed makeup preserves relative whispers and decays. This memoryless
        // soft peak ceiling cannot raise a tail or chase silence like AGC.
        const outL = Math.tanh(this.shock.left * 2.9 / .84) * .84;
        const outR = Math.tanh(this.shock.right * 2.9 / .84) * .84;
        left[offset + i] = right === left ? (outL + outR) * .5 : outL;
        if (right !== left) right[offset + i] = outR;
        energy += (outL * outL + outR * outR) * .5;
        brewEnergy += (b[0][i] ** 2 + b[1][i] ** 2) * .5 * this.weights[0] ** 2 * backing ** 2;
        handEnergy += (handL * handL + handR * handR) * .5 * backing ** 2;
        dropEnergy += (dropL * dropL + dropR * dropR) * .5;
        delayEnergy += (this.delay.wetLeft ** 2 + this.delay.wetRight ** 2) * .5;
        ghostEnergy += (ghostL * ghostL + ghostR * ghostR) * .5;
        flybyEnergy += (this.blechFlyby.left ** 2 + this.blechFlyby.right ** 2) * .5;
        treeEnergy += (this.scene.tree.left ** 2 + this.scene.tree.right ** 2) * .5;
      }
      this.time += count * this.dt;
    }
    Object.assign(this.visual, this.brew.visual);
    this.visual.energy = Math.sqrt(energy / Math.max(1, left.length)); this.visual.audioTime = this.time;
    this.visual.brewLevel = Math.sqrt(brewEnergy / Math.max(1, left.length));
    this.visual.handLevel = Math.sqrt(handEnergy / Math.max(1, left.length));
    this.visual.dropLevel = Math.sqrt(dropEnergy / Math.max(1, left.length));
    this.visual.catClock = this.cat.clock; this.visual.catTime = this.cat.time; this.visual.catLevel = this.cat.level;
    this.visual.catMeow = Math.max(this.cat.meowEnvelope,
      this.catDropSlot?.gain > .01 && this.catDropSlot.until > this.drops.clock
        ? witchCatMeowEnvelope(this.catDropSlot.age / this.rate) * this.catDropSlot.gain : 0);
    this.visual.catMeowLevel = this.cat.meowLevel;
    this.visual.dropVariant = this.drops.variant ?? 0; this.visual.dropKind = this.drops.kind; this.visual.dropEnvelope = this.drops.solo;
    this.visual.shockEnvelope = this.shock.envelope;
    this.visual.fabricWindEnvelope = this.fabricWind.gain;
    this.visual.flybyTime = this.blechFlyby.time;
    this.visual.flybyLevel = Math.sqrt(flybyEnergy / Math.max(1, left.length));
    this.visual.treeEnvelope = this.scene.tree.envelope;
    this.visual.treeProgress = witchClamp(this.scene.tree.cursor * this.scene.tree.clip.rate / this.scene.tree.clip.frames);
    this.visual.treeLevel = Math.sqrt(treeEnergy / Math.max(1, left.length));
    this.ghosts.updateVisual(); this.visual.ghostPhase = this.ghosts.phase;
    this.visual.ghostLevel = Math.sqrt(ghostEnergy / Math.max(1, left.length));
    for (let i = 0; i < 3; i++) {
      this.visual.ghostPresence[i] = this.ghosts.presence[i]; this.visual.ghostPulses[i] = this.ghosts.pulses[i];
    }
    this.visual.delayLevel = Math.sqrt(delayEnergy / Math.max(1, left.length));
    this.visual.delayWet = this.delay.wet; this.visual.delayTime = this.delay.delayL / this.rate;
    this.visual.flightPhase = this.delay.ridePhase / 1.4;
    this.visual.handTime = this.hand.getMotionTime(this.time);
    for (let i = 0; i < 5; i++) this.visual.fingerLevels[i] = this.hand.voiceLevels[i];
    this.visual.flightPulse = c.mode === 'flight' ? witchClamp(this.visual.delayLevel * 8) : 0;
    this.visual.flightStep = this.flight.visual.flightStep;
    this.visual.launchActive = this.flight.visual.launchActive;
    this.visual.launchEnvelope = this.flight.visual.launchEnvelope;
    this.visual.mouth = Math.max(this.visual.mouth * (1 - c.handFocus * .45), this.flight.visual.mouth);
    if (this.flight.visual.effectEnvelope > this.visual.effectEnvelope) {
      this.visual.effect = this.flight.visual.effect;
      this.visual.effectEnvelope = this.flight.visual.effectEnvelope;
    }
    return this.visual;
  }
}

// The guard permits offline import of the exact DSP without faking browser globals.
if (typeof globalThis.AudioWorkletProcessor === 'function') {
  class WitchProcessor extends AudioWorkletProcessor {
    constructor(options = {}) {
      super(); this.phaseGeneration = Number.isSafeInteger(options.processorOptions?.phaseGeneration)
        ? Math.max(0, options.processorOptions.phaseGeneration) : 0;
      this.dsp = new WitchDSP(sampleRate); this.alive = true; this.nextTelemetry = 0;
      this.port.onmessage = ({ data }) => {
        if (!data || !this.alive) return;
        if (data.type === 'controls') this.dsp.setControls(data.controls);
        if (data.type === 'enabled') this.dsp.setEnabled(data.enabled);
        if (data.type === 'release-accents') this.dsp.releaseAccents();
        if (data.type === 'phase') {
          const generation = data.phaseGeneration;
          // Untagged direct callers retain the current generation. Tagged
          // seeks are ordered, and an older one cannot rewind a newer node.
          if (generation === undefined || (Number.isSafeInteger(generation) && generation >= this.phaseGeneration)) {
            if (generation !== undefined) this.phaseGeneration = generation;
            this.dsp.syncPhase(data.phase, data.speed, data.handTime, data.spoonHeight, data.flightPhase, data.ghostPhase, data.catClock, data.flybyTime, data.visitorCaptures);
            this.nextTelemetry = 0;
          }
        }
        if (data.type === 'trigger' && Number.isFinite(data.at) && currentTime - data.at < .25) this.dsp.trigger(data.kind, data.variant);
        if (data.type === 'dispose') { this.alive = false; this.dsp.setEnabled(false); }
      };
    }
    process(_inputs, outputs) {
      const channels = outputs[0];
      if (!channels?.[0]) return this.alive;
      if (!this.alive) { for (const channel of channels) channel.fill(0); return false; }
      this.dsp.process(channels[0], channels[1] || channels[0]);
      if (currentTime >= this.nextTelemetry) {
        this.nextTelemetry = currentTime + 1 / 30;
        this.port.postMessage({ type: 'visual', ...this.dsp.visual, audioTime: currentTime, phaseGeneration: this.phaseGeneration });
      }
      return true;
    }
  }
  registerProcessor('witch-voice', WitchProcessor);
}
