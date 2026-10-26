import { normalizeWitchControls, sampleChant, witchClamp, witchHandConfig, applyWitchManualFingers, witchSpoonHeight, witchVoiceAtHeight, WITCH_VOCAL_EFFECTS, WITCH_FLIGHT_EFFECTS, WITCH_DROP_EFFECTS, WITCH_LAUNCH_DURATION, WITCH_TAU } from './witch-model.js';
import { HandDSP } from '../gesticulating-hand/hand-dsp.js';
import { createHandPose, createHandVoices, evaluateHandVoices, handPlayableFrequency, normalizeHandConfig } from '../gesticulating-hand/hand-model.js';

const TAU = WITCH_TAU;
const VOICE = Object.freeze({
  mutter: { hz: 139, air: .13, rasp: .23, vibrato: .009, sustain: .24 },
  whisper: { hz: 164, air: .94, rasp: .05, vibrato: .003, sustain: .34 },
  creak: { hz: 69, air: .09, rasp: .88, vibrato: .025, sustain: .3 },
  cackle: { hz: 253, air: .21, rasp: .52, vibrato: .045, sustain: .02 },
  sing: { hz: 252, air: .025, rasp: .015, vibrato: .013, sustain: .86 },
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
    this.lastInput = 0; this.dc = 0; this.gain = 0; this.targetHz = 139; this.frequency = 139;
    this.targetAir = .13; this.air = .13; this.targetRasp = .23; this.rasp = .23;
    this.targetSustain = .24; this.sustain = .24; this.targetVibrato = .009; this.vibrato = .009;
    this.formants = Array.from({ length: 3 }, () => new Resonator(this.rate));
    this.ring = new Resonator(this.rate); this.chant = sampleChant(0); this.controlSamples = 0;
    this.effects = Array.from({ length: 4 }, () => ({ kind: '', age: 0, duration: 0, phase: 0, low: 0, envelope: 0,
      formants: [new Resonator(this.rate), new Resonator(this.rate)] }));
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
  trigger(kind) {
    if (!this.enabled || !WITCH_VOCAL_EFFECTS.includes(kind)) return false;
    let slot = this.effects.find(effect => effect.age >= effect.duration);
    if (!slot) slot = this.effects.reduce((oldest, effect) => effect.age / effect.duration > oldest.age / oldest.duration ? effect : oldest);
    slot.kind = kind; slot.age = 0; slot.phase = 0; slot.low = 0; slot.envelope = 0;
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
    sampleChant(this.chantPhase, 1, this.radius, this.chant);
    const vowel = (.77 + this.fingers[1] * .46) * Math.pow(1.8, (this.nose - .5) * 2);
    this.targetHz = v.hz * Math.pow(2.7, this.fingers[0] - .5) * this.chant.pitch * Math.pow(2, (this.hat - .5) * 1.3);
    this.targetAir = witchClamp(v.air + (this.fingers[4] - .5) * .55, 0, .98);
    this.targetRasp = witchClamp(v.rasp + (this.fingers[2] - .5) * .8 + this.hair * .34 + (this.hat - .5) * .5);
    this.targetVibrato = v.vibrato + this.fingers[3] ** 2 * .065;
    this.targetSustain = v.sustain;
    const width = 85 + this.targetAir * 230 + this.hair * 65;
    this.formants[0].tune(this.chant.f1 * vowel, width);
    this.formants[1].tune(this.chant.f2 * vowel, width * 1.3);
    this.formants[2].tune(this.chant.f3 * (.94 + vowel * .06), width * 1.7);
    this.ring.tune(1140 + this.radius * 1780 + this.fingers[1] * 270, 32 + (1 - this.glass) * 70);
  }
  effectSample() {
    let sum = 0, activeKind = '', activeEnvelope = 0;
    for (const e of this.effects) {
      if (e.age >= e.duration) continue;
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
      if (c.gate) this.speed += (c.speed - this.speed) * this.smooth;
      else this.speed *= this.coast;
      this.radius += (c.radius - this.radius) * this.smooth;
      this.altitude += (c.altitude - this.altitude) * this.smooth;
      this.glass += (c.glass - this.glass) * this.smooth; this.hair += (c.hair - this.hair) * this.smooth;
      this.nose += (c.nose - this.nose) * this.smooth; this.hat += (c.hat - this.hat) * this.smooth;
      if (c.gate) this.spoonTime += this.dt;
      if (c.gate || !c.spoonAuto) this.spoonHeight += ((c.spoonAuto ? witchSpoonHeight(this.spoonTime) : c.spoonHeight) - this.spoonHeight) * this.spoonSmooth;
      for (let f = 0; f < 5; f++) this.fingers[f] += (c.fingers[f] - this.fingers[f]) * this.smooth;
      const pace = .46 + this.speed * (this.activeVoice === 'cackle' ? 12 : 8.6);
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
      const articulation = this.sustain + (1 - this.sustain) * this.chant.articulation;
      const release = (noise - this.noiseLow) * this.releaseAir * .026;
      let sample = (vowel * articulation * .88 + cycle * (1 - this.air) * .035) * this.envelope + release;
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
    this.voices = Array.from({ length: 8 }, () => ({ kind: '', age: 1, duration: 0, phase: 0, mod: 0, upper: 0,
      ratio: 1, frequency: 200, pan: 0, envelope: 0, level: 0 }));
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
      frequency: this.rootHz * ratio, level, pan, envelope: 0 });
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
    const mask = this.witchControls?.manualFingerMask ?? 0;
    if (!mask || !this.manualConfig) return;
    evaluateHandVoices(this.manualConfig, 0, this.manualTargets, this.manualPose, this.manualPrevious);
    for (let index = 0; index < 5; index++) if (mask & (1 << index)) {
      Object.assign(this.targets[index], this.manualTargets[index]);
      if (this.sampleRate * .17 < 4200) this.targets[index].frequency = handPlayableFrequency(this.targets[index].frequency, this.sampleRate * .17);
      Object.assign(this.pose.fingers[index], this.manualPose.fingers[index]);
    }
  }
}

/** Three bounded miniature solos share five existing Gesticules voice engines:
 * glass/wire/metal, Linear Drums' marimba, and the Throatazoid-derived choir. */
class DroppedInstrumentDSP {
  constructor(rate) {
    this.rate = rate; this.clock = 0; this.enabled = false; this.dormant = true;
    this.hand = new HandDSP(rate); this.solo = 0; this.kind = ''; this.levels = new Float32Array(128);
    this.slots = WITCH_DROP_EFFECTS.map((kind, i) => ({ kind, mask: [19, 4, 8][i], until: -1 }));
    this.hand.setConfig({
      motion: { id: 'flourish', tempo: 90, amount: .48 }, tremor: { amount: 0 },
      pose: { fingers: [.12, .28, .18, .38, .22].map(bend => ({ mcp: bend * 50, pip: bend * 60, dip: bend * 40, spread: 0 })) },
      sound: { rhythm: 'continuous', rootHz: 137, pitchSpread: 1.6, brightness: .64, roughness: .12,
        attack: .012, release: .42, space: .16, rotationFx: 0 },
      voices: ['glass', 'wire', 'marimba', 'choir', 'metal'].map(source => ({ source, level: .86 })),
    });
    this.hand.setSoundPlaying(false); this.hand.setTransport({ playing: true }); this.hand.reset();
    this.attack = 1 - Math.exp(-1 / (rate * .018)); this.release = 1 - Math.exp(-1 / (rate * .24));
  }
  setEnabled(enabled) {
    this.enabled = enabled === true; this.hand.setEnabled(this.enabled);
    if (!this.enabled) this.releaseAll();
  }
  releaseAll() { for (const slot of this.slots) slot.until = -1; }
  trigger(kind) {
    const slot = this.slots.find(slot => slot.kind === kind);
    if (!this.enabled || !slot) return false;
    slot.until = this.clock + Math.round(this.rate * 2.4); this.kind = kind; this.dormant = false;
    for (let i = 0; i < 5; i++) if (slot.mask & (1 << i)) this.hand.auditionFinger(i, .08, this.clock / this.rate);
    return true;
  }
  process(left, right) {
    if (this.dormant) { left.fill(0); right.fill(0); this.levels.fill(0); this.clock += left.length; return; }
    let offset = 0;
    while (offset < left.length) {
      let mask = 0, boundary = Infinity;
      for (const slot of this.slots) if (slot.until > this.clock) {
        mask |= slot.mask; boundary = Math.min(boundary, slot.until);
      }
      this.hand.setHeldFingers(mask);
      const count = Math.min(left.length - offset, boundary - this.clock);
      this.hand.process(offset === 0 && count === left.length ? left : left.subarray(offset, offset + count),
        offset === 0 && count === right.length ? right : right.subarray(offset, offset + count), this.clock / this.rate);
      const active = this.enabled && mask !== 0;
      for (let i = offset; i < offset + count; i++) {
        this.solo += ((active ? 1 : 0) - this.solo) * (active ? this.attack : this.release);
        this.levels[i] = this.solo; this.clock++;
      }
      offset += count;
    }
    if (this.solo < 1e-6) this.kind = '';
    if (this.solo < 1e-7 && this.hand.rms < 1e-9) { this.hand.reset(); this.dormant = true; }
  }
}

/** One fractional stereo delay after the complete mix. Slewed read positions
 * make pitch bends; bounded feedback and a final mute keep every layer finite. */
export class FlightMixDelay {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.controls = normalizeWitchControls();
    this.buffers = [new Float32Array(Math.ceil(rate * 2)), new Float32Array(Math.ceil(rate * 2))];
    this.writeIndex = 0; this.ridePhase = 0; this.wet = 0; this.feedback = 0; this.master = 0;
    this.delayL = rate * .32; this.delayR = rate * .39; this.lowL = 0; this.lowR = 0;
    this.left = 0; this.right = 0; this.wetLeft = 0; this.wetRight = 0; this.cleared = true;
    this.smooth = 1 - Math.exp(-1 / (rate * .08)); this.fade = 1 - Math.exp(-1 / (rate * .025));
  }
  read(buffer, delay) {
    const position = (this.writeIndex - delay + buffer.length) % buffer.length;
    const index = Math.floor(position), fraction = position - index;
    return buffer[index] + (buffer[(index + 1) % buffer.length] - buffer[index]) * fraction;
  }
  next(left, right, enabled) {
    const c = this.controls, flying = c.mode === 'flight';
    const wetTarget = flying ? .35 + c.altitude * .25 : 0;
    this.wet += (wetTarget - this.wet) * this.smooth;
    this.feedback += ((flying && c.gate ? .28 + c.speed * .4 : .16) - this.feedback) * this.smooth;
    const ride = .018 * Math.sin(this.ridePhase);
    const seconds = .11 + c.altitude * .43 + (1 - c.speed) * .13 + ride;
    // A bounded read-head slope avoids abrupt discontinuities on pointer edits.
    this.delayL += witchClamp(seconds * this.rate - this.delayL, -.24, .24);
    this.delayR += witchClamp(seconds * (.74 + c.flightX * .48) * this.rate - this.delayR, -.24, .24);
    const echoL = this.read(this.buffers[0], this.delayL), echoR = this.read(this.buffers[1], this.delayR);
    this.lowL += .26 * (echoL - this.lowL); this.lowR += .26 * (echoR - this.lowR);
    this.buffers[0][this.writeIndex] = Math.tanh((left + this.lowR * this.feedback) / .8) * .8;
    this.buffers[1][this.writeIndex] = Math.tanh((right + this.lowL * this.feedback) / .8) * .8;
    this.writeIndex = (this.writeIndex + 1) % this.buffers[0].length;
    this.master += ((enabled ? 1 : 0) - this.master) * this.fade;
    this.wetLeft = Math.tanh(echoL / .54) * .54 * this.wet * this.master;
    this.wetRight = Math.tanh(echoR / .54) * .54 * this.wet * this.master;
    this.left = left * (1 - this.wet) * this.master + this.wetLeft;
    this.right = right * (1 - this.wet) * this.master + this.wetRight;
    if (enabled) this.cleared = false;
    else if (!this.cleared && this.master < 1e-7) {
      for (const buffer of this.buffers) buffer.fill(0);
      this.lowL = this.lowR = 0; this.cleared = true;
    }
    if(c.gate) this.ridePhase += (1 + c.speed * 5) * this.dt;
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
    this.buffers = Array.from({ length: 8 }, () => new Float32Array(128));
    this.visual = { ...this.brew.visual, handTime: 0, flightPhase: 0, brewLevel: 0, handLevel: 0, dropLevel: 0, dropKind: '', dropEnvelope: 0,
      delayWet: 0, delayTime: .32, delayLevel: 0, fingerLevels: [0, 0, 0, 0, 0], flightPulse: 0, flightStep: 0, launchEnvelope: 0, launchActive: false };
    this.setControls(this.controls);
  }
  get chantPhase() { return this.brew.chantPhase; }
  get effectCounter() { return this.flight.noteCount; }
  get effects() { return this.brew.effects; }
  syncPhase(phase, speed = 0, handTime, spoonHeight, flightPhase) {
    this.brew.syncPhase(phase, speed); this.visual.phase = this.brew.phase; this.visual.speed = this.brew.speed;
    if (Number.isFinite(handTime)) {
      this.hand.setTransport({ time: witchClamp(handTime, 0, 1e9) }, this.time);
      this.visual.handTime = this.hand.getMotionTime(this.time);
      this.brew.spoonTime = this.visual.handTime;
      this.delay.ridePhase = Number.isFinite(flightPhase) ? witchClamp(flightPhase, 0, 1e12) * 1.4 : this.visual.handTime * (1 + this.controls.speed * 5);
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
    if (c.handFocus !== previous.handFocus) { this.fadeFrom.set(this.weights); this.fadePosition = 0; }
    // Preserve the brewed anatomy underneath hand gestures: bending an
    // instrumental finger must not simultaneously reshape the background voice.
    this.brew.setControls({ ...c, mode: 'brew', fingers: this.brew.controls.fingers });
    this.flight.setControls({ ...c, gate: false }); // flight is the shared delay; accents remain explicit.
    this.delay.controls = c;
    if (previous.gate && !c.gate) { this.drops.releaseAll(); this.flight.launch.cancel(); }
    if (c.tone !== previous.tone || c.manualFingerMask !== previous.manualFingerMask || c.fingers.some((v, i) => v !== previous.fingers[i])) {
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
  }
  trigger(kind) {
    if (!this.enabled) return false;
    if (WITCH_DROP_EFFECTS.includes(kind)) return this.drops.trigger(kind);
    if (WITCH_FLIGHT_EFFECTS.includes(kind) && (this.controls.mode === 'flight' || !WITCH_VOCAL_EFFECTS.includes(kind))) return this.flight.trigger(kind);
    return this.brew.trigger(kind);
  }
  process(left, right = left) {
    const c = this.controls, voiceWeight = .72 - c.handFocus * .54;
    let energy = 0, brewEnergy = 0, handEnergy = 0, dropEnergy = 0, delayEnergy = 0;
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
        const soloMix = this.drops.levels[i] * .8, backing = 1 - soloMix;
        const dropL = Math.tanh(b[6][i] * 2.4 / .54) * .54 * soloMix;
        const dropR = Math.tanh(b[7][i] * 2.4 / .54) * .54 * soloMix;
        const dryL = Math.tanh(((b[0][i] * this.weights[0] + handL) * backing + dropL + b[4][i] * .85) / .54) * .54;
        const dryR = Math.tanh(((b[1][i] * this.weights[0] + handR) * backing + dropR + b[5][i] * .85) / .54) * .54;
        this.delay.next(dryL, dryR, this.enabled);
        const outL = this.delay.left, outR = this.delay.right;
        left[offset + i] = right === left ? (outL + outR) * .5 : outL;
        if (right !== left) right[offset + i] = outR;
        energy += (outL * outL + outR * outR) * .5;
        brewEnergy += (b[0][i] ** 2 + b[1][i] ** 2) * .5 * this.weights[0] ** 2 * backing ** 2;
        handEnergy += (handL * handL + handR * handR) * .5 * backing ** 2;
        dropEnergy += (dropL * dropL + dropR * dropR) * .5;
        delayEnergy += (this.delay.wetLeft ** 2 + this.delay.wetRight ** 2) * .5;
      }
      this.time += count * this.dt;
    }
    Object.assign(this.visual, this.brew.visual);
    this.visual.energy = Math.sqrt(energy / Math.max(1, left.length)); this.visual.audioTime = this.time;
    this.visual.brewLevel = Math.sqrt(brewEnergy / Math.max(1, left.length));
    this.visual.handLevel = Math.sqrt(handEnergy / Math.max(1, left.length));
    this.visual.dropLevel = Math.sqrt(dropEnergy / Math.max(1, left.length));
    this.visual.dropKind = this.drops.kind; this.visual.dropEnvelope = this.drops.solo;
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
    constructor() {
      super(); this.dsp = new WitchDSP(sampleRate); this.alive = true; this.nextTelemetry = 0;
      this.port.onmessage = ({ data }) => {
        if (!data || !this.alive) return;
        if (data.type === 'controls') this.dsp.setControls(data.controls);
        if (data.type === 'enabled') this.dsp.setEnabled(data.enabled);
        if (data.type === 'phase') this.dsp.syncPhase(data.phase, data.speed, data.handTime, data.spoonHeight, data.flightPhase);
        if (data.type === 'trigger' && Number.isFinite(data.at) && currentTime - data.at < .25) this.dsp.trigger(data.kind);
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
        this.port.postMessage({ type: 'visual', ...this.dsp.visual, audioTime: currentTime });
      }
      return true;
    }
  }
  registerProcessor('witch-voice', WitchProcessor);
}
