import { normalizeWitchControls, sampleChant, witchClamp, WITCH_VOCAL_EFFECTS, WITCH_FLIGHT_EFFECTS, WITCH_FINGER_SOURCES, WITCH_TAU } from './witch-model.js';
import { HandDSP } from '../gesticulating-hand/hand-dsp.js';

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
    this.fingers = new Float64Array([.5, .5, .5, .5, .5]); this.glass = 0; this.hair = 0;
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
    const c = this.controls, v = VOICE[c.voice];
    sampleChant(this.chantPhase, 1, this.radius, this.chant);
    const vowel = .77 + this.fingers[1] * .46;
    this.targetHz = v.hz * Math.pow(2.7, this.fingers[0] - .5) * this.chant.pitch;
    this.targetAir = witchClamp(v.air + (this.fingers[4] - .5) * .55, 0, .98);
    this.targetRasp = witchClamp(v.rasp + (this.fingers[2] - .5) * .8 + this.hair * .34);
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
      for (let f = 0; f < 5; f++) this.fingers[f] += (c.fingers[f] - this.fingers[f]) * this.smooth;
      const pace = .46 + this.speed * (c.voice === 'cackle' ? 12 : 8.6);
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
    return this.visual;
  }
}

// Ratios come from an asymmetric geometric pattern, not a pitch scale. Altitude
// continuously transposes every sounding strand, including already-ringing ones.
const FLIGHT_RATIOS = Object.freeze([1, Math.SQRT2, Math.sqrt(3), .83, Math.sqrt(5), 1.19, 1.73, 2.41]);
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
    this.visual = { flightPulse: 0, flightStep: 0, effect: '', effectEnvelope: 0 };
  }
  random() {
    let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x >>> 0;
    return this.randomState / 2147483648 - 1;
  }
  setControls(controls) { this.controls = controls; }
  setEnabled(enabled) { this.enabled = enabled === true; }
  strike(kind, ratio, duration, level, pan = 0) {
    let voice = this.voices.find(v => v.age >= v.duration);
    if (!voice) voice = this.voices.reduce((oldest, v) => v.age / v.duration > oldest.age / oldest.duration ? v : oldest);
    Object.assign(voice, { kind, age: 0, duration, phase: 0, mod: 0, upper: 0, ratio,
      frequency: this.rootHz * ratio, level, pan, envelope: 0 });
  }
  trigger(kind) {
    if (!this.enabled || !WITCH_FLIGHT_EFFECTS.includes(kind)) return false;
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
      let mixL = bed, mixR = bed;
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
  }
}

function fingerConfig(controls) {
  return {
    motion: { id: 'still', amount: 0 }, tremor: { amount: 0 },
    pose: { fingers: controls.fingers.map((bend, index) => ({ mcp: bend * 70, pip: bend * (index ? 85 : 65), dip: bend * 60, spread: 0 })),
      wrist: { flex: 0, side: 0, twist: 0 } },
    sound: { rhythm: 'continuous', rootHz: 91, pitchSpread: 1.25, brightness: controls.tone,
      roughness: .12, space: .14, rotationFx: 0, attack: .035, release: .28 },
    voices: WITCH_FINGER_SOURCES.map((source, index) => ({ source, level: index > 2 ? .9 : .76 })),
  };
}

/** Three independent instruments share only output and gesture state. The
 * hand is the actual Gesticules engine with five fixed nonvocal materials. */
export class WitchDSP {
  constructor(rate = 48000, seed = 0x71c4) {
    this.rate = witchClamp(rate, 8000, 192000, 48000); this.dt = 1 / this.rate;
    this.controls = normalizeWitchControls(); this.enabled = false; this.time = 0;
    this.brew = new CauldronDSP(this.rate, seed); this.hand = new HandDSP(this.rate); this.flight = new FlightDSP(this.rate);
    this.hand.setConfig(fingerConfig(this.controls)); this.hand.reset();
    this.weights = new Float64Array([1, 0, 0]); this.fadeFrom = new Float64Array(this.weights);
    this.fadeSamples = Math.round(.04 * this.rate); this.fadePosition = this.fadeSamples;
    this.handDormant = true; this.flightDormant = true;
    this.buffers = Array.from({ length: 6 }, () => new Float32Array(128));
    this.visual = { ...this.brew.visual, fingerLevels: [0, 0, 0, 0, 0], flightPulse: 0, flightStep: 0 };
    this.setControls(this.controls);
  }
  get chantPhase() { return this.brew.chantPhase; }
  get effectCounter() { return this.flight.noteCount; }
  get effects() { return this.brew.effects; }
  syncPhase(phase, speed = 0) { this.brew.syncPhase(phase, speed); this.visual.phase = this.brew.phase; this.visual.speed = this.brew.speed; }
  setControls(value) {
    const previous = this.controls;
    this.controls = normalizeWitchControls({ ...previous, ...value });
    const c = this.controls;
    if (c.mode !== previous.mode) { this.fadeFrom.set(this.weights); this.fadePosition = 0; }
    // The cauldron advances silently when another scene is selected, preserving
    // phase continuity while its mixed contribution reaches exactly zero.
    this.brew.setControls({ ...c, mode: 'brew' });
    this.flight.setControls(c);
    if (c.tone !== previous.tone || c.fingers.some((v, i) => v !== previous.fingers[i])) {
      this.hand.setConfig(fingerConfig(c));
      if (c.mode === 'fingers' && c.gate && this.enabled) {
        const mask = c.fingerMask || 31;
        for (let i = 0; i < 5; i++) if ((mask & (1 << i)) && Math.abs(c.fingers[i] - previous.fingers[i]) > .002) {
          this.hand.auditionFinger(i, .06, this.time);
        }
      }
    }
    this.hand.setSoundPlaying(false);
    this.hand.setHeldFingers(c.mode === 'fingers' && c.gate ? c.fingerMask || 31 : 0);
    this.hand.setEnabled(this.enabled && c.mode === 'fingers');
    this.brew.setEnabled(this.enabled && c.mode === 'brew');
    this.flight.setEnabled(this.enabled && c.mode === 'flight');
  }
  setEnabled(enabled) {
    this.enabled = enabled === true;
    this.brew.setEnabled(this.enabled && this.controls.mode === 'brew');
    this.hand.setEnabled(this.enabled && this.controls.mode === 'fingers');
    this.flight.setEnabled(this.enabled && this.controls.mode === 'flight');
  }
  trigger(kind) {
    if (!this.enabled) return false;
    if (this.controls.mode === 'brew') return this.brew.trigger(kind);
    if (this.controls.mode === 'flight') return this.flight.trigger(kind);
    return false;
  }
  process(left, right = left) {
    const mode = this.controls.mode, selected = mode === 'brew' ? 0 : mode === 'fingers' ? 1 : 2;
    let energy = 0;
    for (let offset = 0; offset < left.length; offset += 128) {
      const count = Math.min(128, left.length - offset);
      const b = count === 128 ? this.buffers : this.buffers.map(buffer => buffer.subarray(0, count));
      this.brew.process(b[0], b[1]);
      if (selected === 1 || this.weights[1] > 0) {
        this.hand.process(b[2], b[3], this.time); this.handDormant = false;
      } else {
        b[2].fill(0); b[3].fill(0);
        if (!this.handDormant) { this.hand.reset(); this.handDormant = true; }
      }
      if (selected === 2 || this.weights[2] > 0) {
        this.flight.process(b[4], b[5]); this.flightDormant = false;
      } else {
        b[4].fill(0); b[5].fill(0);
        if (!this.flightDormant) { this.flight.clear(); this.flightDormant = true; }
      }
      for (let i = 0; i < count; i++) {
        const fade = Math.min(1, ++this.fadePosition / this.fadeSamples);
        for (let engine = 0; engine < 3; engine++) this.weights[engine] = this.fadeFrom[engine] * (1 - fade) + (selected === engine ? fade : 0);
        // Limit each engine before crossfading: changing scenes never changes
        // the transfer curve underneath a ringing sound.
        const outL = b[0][i] * this.weights[0] + Math.tanh(b[2][i] * 1.7 / .54) * .54 * this.weights[1]
          + Math.tanh(b[4][i] / .54) * .54 * this.weights[2];
        const outR = b[1][i] * this.weights[0] + Math.tanh(b[3][i] * 1.7 / .54) * .54 * this.weights[1]
          + Math.tanh(b[5][i] / .54) * .54 * this.weights[2];
        left[offset + i] = right === left ? (outL + outR) * .5 : outL;
        if (right !== left) right[offset + i] = outR;
        energy += (outL * outL + outR * outR) * .5;
      }
      this.time += count * this.dt;
    }
    Object.assign(this.visual, this.brew.visual);
    this.visual.energy = Math.sqrt(energy / Math.max(1, left.length)); this.visual.audioTime = this.time;
    for (let i = 0; i < 5; i++) this.visual.fingerLevels[i] = this.hand.voiceLevels[i];
    this.visual.flightPulse = selected === 2 ? this.flight.visual.flightPulse : 0;
    this.visual.flightStep = this.flight.visual.flightStep;
    if (selected !== 0) {
      this.visual.mouth = 0; this.visual.breath = 0;
      this.visual.effect = selected === 2 ? this.flight.visual.effect : '';
      this.visual.effectEnvelope = selected === 2 ? this.flight.visual.effectEnvelope : 0;
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
        if (data.type === 'phase') this.dsp.syncPhase(data.phase, data.speed);
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
