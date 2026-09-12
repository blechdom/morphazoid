import { RoachZing, RoachRecordingGrains } from './roach-synth-textures.js';
import { ROACH_BODY_SOURCE_INDEX, ROACH_BODY_SOURCES, normalizeRoachBodyMix } from './roach-synth-body.js';
import { RoachPercussion } from './roach-synth-percussion.js';

const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const percussionFamily = (source) => source >= 12 && source <= 15 ? source - 12 : source === 17 ? 4 : source === 18 ? 5 : -1;
function mode() { return { re: 0, im: 0, c: 1, s: 0, r: .99 }; }
function tune(m, f, decay, rate) {
  const angle = TAU * clamp(f, 20, rate * .43) / rate;
  m.c = Math.cos(angle); m.s = Math.sin(angle); m.r = Math.exp(-1 / (rate * decay));
}
function resonant(m, input) {
  const re = m.re;
  m.re = (re * m.c - m.im * m.s) * m.r + input;
  m.im = (re * m.s + m.im * m.c) * m.r;
  if (!Number.isFinite(m.re) || Math.abs(m.re) > 20 || Math.abs(m.im) > 20) m.re = m.im = 0;
  if (Math.abs(m.re) < 1e-25) m.re = 0;
  if (Math.abs(m.im) < 1e-25) m.im = 0;
  return m.im;
}
function blep(phase, step) {
  if (phase < step) { const x = phase / step; return x + x - x * x - 1; }
  if (phase > 1 - step) { const x = (phase - 1) / step; return x * x + x + x + 1; }
  return 0;
}

// One owned instrument per anatomical group. Its random stream, filters,
// envelopes, modal state and waveguide never borrow motion from another row.
class BodyVoice {
  constructor(rate, index) {
    this.rate = rate; this.index = index; this.source = 0; this.oldSource = 0; this.sourceFade = 1;
    this.level = 0; this.targetLevel = 0; this.manual = 0; this.motion = 0; this.motionTarget = 0; this.distance = 0;
    this.x = 0; this.y = 0; this.z = 0; this.side = 0; this.frequency = 100; this.frequencyTarget = 100;
    this.brightness = .4; this.resonance = .4; this.crunch = .15; this.rhythm = 1; this.vowel = .35;
    this.buzzPhase = 0; this.buzzRate = 72; this.buzzTarget = 72;
    this.panL = Math.SQRT1_2; this.panR = Math.SQRT1_2; this.targetPanL = Math.SQRT1_2; this.targetPanR = Math.SQRT1_2;
    this.coefficient = .3; this.targetCoefficient = .3; this.filtered = 0;
    this.phase = 0; this.phase2 = .137; this.phase3 = .379; this.phase4 = .719;
    this.low = 0; this.particle = 0; this.contact = new Float64Array(6); this.footAge = new Float64Array(6);
    this.footNoise = new Float64Array(6); this.footParticle = new Float64Array(6);
    this.modes = Array.from({ length: 4 }, mode); this.zing = new RoachZing(rate);
    this.percussion = new RoachPercussion(rate, index === 0); this.percussionDistance = 0; this.percussionActive = false;
    this.randomState = (0x756d4f21 ^ (index + 1) * 0x45d9f3b) | 0;
    this.smooth = 1 - Math.exp(-1 / (rate * .028));
    this.manualDecay = Math.exp(-1 / (rate * .052));
    this.contactDecay = Math.exp(-1 / (rate * .045));
    this.contactRelease = Math.exp(-1 / (rate * .016));
    this.particleDecay = Math.exp(-1 / (rate * .004));
    this.output = new Float64Array(ROACH_BODY_SOURCES.length); this.releaseContacts = false;
    this.midiGate = 0; this.midiGateTarget = 0; this.midiFrequency = 0;
  }
  random() {
    let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x | 0;
    return (x >>> 0) / 2147483648 - 1;
  }
  assign(row, initial = false) {
    const source = ROACH_BODY_SOURCE_INDEX.get(row.source) ?? 0;
    if (source !== this.source) { this.oldSource = this.source; this.source = source; this.sourceFade = initial ? 1 : 0; }
    // A gesture and several source changes may arrive before the first sample.
    // Remember that this source can own an unsampled strike as soon as selected.
    if (percussionFamily(source) >= 0) this.percussionActive = true;
    this.targetLevel = row.level;
    if (initial) this.level = row.level;
  }
  excite(amount) {
    this.manual = Math.min(1, Math.max(this.manual, amount));
    this.zing.excite(amount * .65);
    this.particle = Math.min(1.5, this.particle + amount * .4);
    if (percussionFamily(this.source) >= 0) this.percussion.strike(amount);
  }
  foot(index, amount) {
    this.contact[index] = Math.min(1.3, this.contact[index] + amount);
    this.footAge[index] = 0; this.footParticle[index] = amount;
    this.releaseContacts = false; this.zing.excite(amount * .55); this.particle = Math.min(1.2, this.particle + amount * .4);
    if (percussionFamily(this.source) >= 0) this.percussion.strike(amount, index);
  }
  control(x, y, z, side, velocity, sound, mods, offset, midiFrequency = 0, midiGate = 0, midiPan = 0) {
    this.x = x; this.y = y; this.z = z; this.side = side;
    const firstMidi = midiFrequency > 0 && this.midiFrequency === 0;
    this.midiFrequency = midiFrequency; this.midiGateTarget = clamp(midiGate, 0, 1);
    const pitchMod = mods[offset] || 0; const brightMod = mods[offset + 2] || 0;
    this.frequencyTarget = midiFrequency > 0
      ? clamp(midiFrequency * (sound.pitch / 140) * 2 ** (x * .06 + y * .035 + pitchMod * 1.5), 28, this.rate * .12)
      : clamp(sound.pitch * (.63 + this.index * .039) * 2 ** (x * .9 + y * .13 + pitchMod * 1.5 + side * .13), 28, this.rate * .12);
    if (firstMidi) this.frequency = this.frequencyTarget;
    this.brightness = clamp(sound.brightness + y * .44 + z * .1 + brightMod * .5, 0, 1);
    this.resonance = clamp(sound.resonance + (mods[offset + 3] || 0) * .5, 0, .98);
    this.crunch = clamp(sound.crunch + (mods[offset + 8] || 0) * .5, 0, 1);
    this.rhythm = clamp(sound.rhythm * 2 ** (mods[offset + 6] || 0), .25, 6);
    this.vowel = clamp(sound.vowel + (mods[offset + 1] || 0) * .55, 0, 1);
    this.buzzTarget = clamp(sound.wingRate * 2 ** (x * .35 + (mods[offset + 5] || 0) * 1.5), 8, 420);
    if (midiFrequency > 0) this.buzzTarget = clamp(this.buzzTarget * midiFrequency / 261.625565, 8, 1200);
    this.motionTarget = Math.min(1, velocity);
    const pan = clamp(sound.pan + z * .63 + side * .35 + midiPan * .35 + (mods[offset + 9] || 0) * .7, -.94, .94);
    this.targetPanL = Math.cos((pan + 1) * Math.PI / 4); this.targetPanR = Math.sin((pan + 1) * Math.PI / 4);
    this.targetCoefficient = 1 - Math.exp(-TAU * Math.min(this.rate * .39, 450 * 22 ** this.brightness) / this.rate);
    for (let i = 0; i < 4; i += 1) tune(this.modes[i], this.frequency * (2.13 + i * 1.473) * (1 + (this.vowel - .35) * (.4 + i * .11)), .016 + this.resonance * .09, this.rate);
    this.zing.tune(this.frequency, this.brightness, this.resonance, clamp(x, -1, 1));
    if (percussionFamily(this.source) >= 0 || (percussionFamily(this.oldSource) >= 0 && this.sourceFade < 1)) {
      this.percussion.configure(this.frequency, this.brightness, this.resonance, this.rhythm, this.vowel);
    }
  }
  sample(stillGate, recording, moving) {
    this.midiGate += (this.midiGateTarget - this.midiGate) * this.smooth;
    this.level += (this.targetLevel - this.level) * this.smooth;
    this.panL += (this.targetPanL - this.panL) * this.smooth; this.panR += (this.targetPanR - this.panR) * this.smooth;
    this.coefficient += (this.targetCoefficient - this.coefficient) * this.smooth;
    this.frequency += (this.frequencyTarget - this.frequency) * this.smooth;
    this.buzzRate += (this.buzzTarget - this.buzzRate) * this.smooth;
    this.motion += (this.motionTarget - this.motion) * this.smooth;
    this.manual *= this.manualDecay;
    const activity = Math.max(this.manual, this.motion);
    let sustained = Math.max(stillGate, activity, this.midiGate);
    const white = this.random(); this.low += (white - this.low) * .045;
    const scratch = white - this.low;
    const step = Math.min(.18, this.frequency / this.rate);
    this.phase = (this.phase + step) % 1;
    this.phase2 = (this.phase2 + step * 1.0137) % 1;
    this.phase3 = (this.phase3 + step * 1.4371) % 1;
    this.phase4 = (this.phase4 + step * .5031) % 1;
    const sine = Math.sin(TAU * this.phase); const detuned = Math.sin(TAU * this.phase2);
    const partial = Math.sin(TAU * this.phase3); const sub = Math.sin(TAU * this.phase4);
    const saw = 2 * this.phase - 1 - blep(this.phase, step);
    const buzzStep = this.buzzRate / this.rate; this.buzzPhase = (this.buzzPhase + buzzStep) % 1;
    const buzz = 2 * this.buzzPhase - 1 - blep(this.buzzPhase, buzzStep);
    let feet = 0; let contact = 0;
    for (let i = 0; i < 6; i += 1) {
      const envelope = this.contact[i]; if (envelope < 1e-15) { this.contact[i] = 0; continue; }
      const noise = this.random();
      if ((noise + 1) * .5 < (210 + i * 43) * this.rhythm * envelope / this.rate) this.footParticle[i] = Math.min(1.2, this.footParticle[i] + .5);
      this.footParticle[i] *= this.particleDecay;
      this.footNoise[i] += (noise - this.footNoise[i]) * .24;
      const age = this.footAge[i]++ / this.rate;
      feet += envelope * (noise - this.footNoise[i] * .8) * (.16 + this.footParticle[i] * .65)
        * (.55 + .45 * Math.abs(Math.sin(age * TAU * (63 + i * 23)))) + this.footNoise[i] * envelope * .14;
      contact += envelope;
      this.contact[i] *= moving && !this.releaseContacts ? this.contactDecay : this.contactRelease;
    }
    const movement = Math.min(1, activity + contact * .45);
    sustained = Math.max(sustained, Math.min(1, contact * .4));
    if ((white + 1) * .5 < (60 + this.rhythm * 170) * activity / this.rate) this.particle = Math.min(1.2, this.particle + activity * .65);
    this.particle *= this.particleDecay;
    let resonances = 0;
    for (let i = 0; i < 4; i += 1) resonances += resonant(this.modes[i], (white * .0025 + sine * .0012) * sustained / (1 + i)) * .35;
    const out = this.output;
    // Four smooth sources can sound held geometry. There is no pose beat,
    // free-running sample scheduler, or periodic fake foot-contact generator.
    out[0] = (resonances + sub * .09 + partial * .035) * sustained;
    out[1] = (sine * .065 + detuned * .057 + sub * .075 + partial * .022) * sustained;
    out[2] = (Math.tanh(sub * 1.45) * .19 + sine * .025) * sustained;
    out[3] = (partial * .073 + Math.sin(TAU * this.phase2 * 3) * .035 + this.low * .024) * sustained;
    out[4] = Math.tanh((buzz * .21 + scratch * .11) * (1 + this.crunch * 2)) * movement;
    out[5] = this.zing.sample(scratch, activity * .7);
    out[6] = (Math.tanh(feet * 1.7) / 1.7 + scratch * activity * (.055 + this.particle * .35)) * 2;
    out[7] = (scratch * (.045 * activity + this.particle * .55) + this.low * activity * .28);
    out[8] = recording * 4.5;
    out[9] = Math.sin(TAU * this.phase3 * 5 + sine * (1.2 + this.crunch * 5)) * movement * .19;
    out[10] = scratch * movement * .16;
    out[11] = (Math.tanh(sub * 3 + sine * (1 + this.vowel)) * .18 + saw * (.02 + this.vowel * .043)) * movement;
    if (percussionFamily(this.source) >= 0 || (percussionFamily(this.oldSource) >= 0 && this.sourceFade < 1)) {
      this.percussionActive = true;
      const percussion = this.percussion.sample(white, percussionFamily(this.source), this.sourceFade < 1 ? percussionFamily(this.oldSource) : percussionFamily(this.source));
      for (let i = 0; i < 4; i += 1) out[12 + i] = percussion[i];
      out[17] = percussion[4]; out[18] = percussion[5];
    } else if (this.percussionActive) {
      // Keep the hot branch on this voice's stable boolean. Reading .running
      // through dormant/active percussion object maps repeatedly deoptimized
      // V8's first live instrument; cleanup still happens once after the fade.
      this.percussion.clear(); this.percussionActive = false;
    }
    // The neck's clean source exposes joint pitch/filter/pan without shell
    // noise. A small second harmonic makes its higher-frequency poses legible.
    out[16] = (sine * .18 + Math.sin(TAU * this.phase * 2) * this.brightness * .025) * sustained;
    this.sourceFade = Math.min(1, this.sourceFade + 1 / (this.rate * .035));
    const raw = out[this.source] * this.sourceFade + out[this.oldSource] * (1 - this.sourceFade);
    const drive = 1 + this.crunch * 3;
    const textured = raw * (1 - this.crunch * .3) + Math.tanh(raw * drive) / drive * this.crunch * .3;
    this.filtered += (textured - this.filtered) * this.coefficient;
    return this.filtered * this.level;
  }
}

export class RoachBodyEngine {
  constructor(rate) {
    this.rate = rate; this.voices = Array.from({ length: 8 }, (_, i) => new BodyVoice(rate, i));
    this.recordings = new RoachRecordingGrains(rate, { groups: 8, voices: 16 });
    this.recordingOutput = new Float64Array(8); this.left = 0; this.right = 0;
    this.wasMoving = false;
    this.setMix(normalizeRoachBodyMix(), true);
  }
  setMix(mix, initial = false) { for (let i = 0; i < 8; i += 1) this.voices[i].assign(mix[i], initial); }
  releaseMidi(group) {
    const voice = this.voices[group];
    voice.releaseContacts = true; voice.percussionDistance = 0; voice.distance = 0;
    voice.percussion.releaseAll();
    for (const recording of this.recordings.voices) if (recording.group === group) recording.releasing = true;
  }
  retuneMidiRecordings(group, frequency) {
    if (!(frequency > 0)) return;
    // Existing fixed grain voices retain their position/envelope through bend;
    // only their playback increment changes. No additional sample players.
    for (const voice of this.recordings.voices) if (voice.recording && voice.group === group) {
      voice.increment = voice.recording.sampleRate / this.rate * clamp(frequency / 261.625565, .25, 4);
    }
  }
  excite(group, strength) {
    const voice = this.voices[group]; voice.excite(strength);
    if (voice.source === 8) this.recordings.trigger(group === 0 ? 0 : 1, strength, (voice.random() + 1) * .5, group);
  }
  contact(index, strength) {
    this.voices[0].foot(index, strength);
    if (this.voices[0].source === 8) this.recordings.trigger(2, strength, (this.voices[0].random() + 1) * .5, 0);
  }
  movement(group, deltaDegrees, enabled, gaitContacts = false) {
    const voice = this.voices[group];
    if (!enabled || deltaDegrees <= .001) return;
    if (percussionFamily(voice.source) >= 0 && !(group === 0 && gaitContacts)) {
      voice.percussionDistance += deltaDegrees;
      if (voice.percussionDistance >= 10) {
        voice.percussionDistance %= 10;
        voice.percussion.strike(Math.min(1, deltaDegrees / 6 + .3));
      }
    }
    voice.distance += deltaDegrees;
    if (voice.distance >= 3) {
      voice.distance %= 3; voice.zing.excite(Math.min(1, deltaDegrees / 5 + .1));
      if (voice.source === 8) this.recordings.trigger(group === 0 ? 0 : 1, Math.min(1, deltaDegrees / 6 + .35), (voice.random() + 1) * .5, group);
    }
  }
  resetActivity() {
    for (const voice of this.voices) {
      voice.manual = 0; voice.motionTarget = 0; voice.distance = 0; voice.releaseContacts = true;
      voice.percussionDistance = 0; voice.percussion.releaseAll();
    }
    this.recordings.release();
  }
  sample(stillGate, moving) {
    if (this.wasMoving && !moving) for (const voice of this.voices) if (voice.midiGateTarget < .0001) voice.percussion.releaseAll();
    this.wasMoving = moving;
    this.recordings.sample(this.recordingOutput);
    this.left = 0; this.right = 0;
    for (let i = 0; i < 8; i += 1) {
      const voice = this.voices[i]; const sample = voice.sample(stillGate, this.recordingOutput[i], moving || voice.midiGate > .0001);
      this.left += sample * voice.panL; this.right += sample * voice.panR;
    }
  }
}
