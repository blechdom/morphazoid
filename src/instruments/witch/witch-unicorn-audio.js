import { createQuadrupedState, quadrupedAnimal, quadrupedSequenceEvent, QUADRUPED_LANES } from '../quadruped/quadruped.js';
import { createQuadrupedSoundBank, QUADRUPED_DEFAULT_SOUND_SKIN } from '../quadruped/quadruped-sound-skins.js';
import { createQuadrupedGestureCall } from '../quadruped/quadruped-gesture-voices.js';
import { WITCH_CAT_UNICORN_DELAY, WITCH_CAT_UNICORN_LEAP, WITCH_CAT_UNICORN_RUN,
  WITCH_CAT_UNICORN_DURATION, WITCH_CAT_UNICORN_STEPS_PER_SECOND } from './witch-cat-model.js';

const SOURCE_RATE = 24000;
const VOICE_COUNT = 12;
const TAU = Math.PI * 2;
const LANDING = WITCH_CAT_UNICORN_DELAY + WITCH_CAT_UNICORN_LEAP;
const SCORE = createQuadrupedState('unicorn', 'gallop');
const ANIMAL = quadrupedAnimal('unicorn');
const EVENTS = Object.freeze(Array.from({ length: 16 }, (_, step) => quadrupedSequenceEvent(SCORE, step)));
const CALL = createQuadrupedGestureCall(SCORE, { row: 0, strength: .8 });
const LANE_INDEX = new Map(QUADRUPED_LANES.map((lane, index) => [lane.id, index]));
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
let preparedBank;

/** Render Quadruped's native scheduleCall/scheduleTone Sparkle graph once:
 * authored sine pitches, staggered attacks, exponential glides/envelopes,
 * 6500 Hz lowpass and alternating stereo positions. This is the actual call
 * descriptor, not the unrelated Synthesis instrument's unicorn-sparkles WAV. */
function prepareSparkle() {
  const duration = CALL.noteOffsetsSeconds.at(-1) + CALL.noteDurationSeconds + .02;
  const left = new Float32Array(Math.ceil(duration * SOURCE_RATE) + 1);
  const right = new Float32Array(left.length);
  const omega = TAU * CALL.filter / SOURCE_RATE, cosine = Math.cos(omega);
  // Web Audio's lowpass Q is expressed in dB.
  const alpha = Math.sin(omega) / (2 * 10 ** (.8 / 20)), inverse = 1 / (1 + alpha);
  const b0 = (1 - cosine) * .5 * inverse, b1 = (1 - cosine) * inverse;
  const a1 = -2 * cosine * inverse, a2 = (1 - alpha) * inverse;
  for (let note = 0; note < CALL.notes.length; note++) {
    const start = Math.round(CALL.noteOffsetsSeconds[note] * SOURCE_RATE);
    const frequency = 440 * 2 ** ((CALL.notes[note] - 69) / 12);
    const peak = .14 * CALL.intensity, attack = CALL.attackSeconds, end = CALL.noteDurationSeconds;
    const pan = (note % 2 ? .12 : -.12), angle = (pan + 1) * Math.PI / 4;
    let phase = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let frame = 0; frame < Math.ceil((end + .02) * SOURCE_RATE); frame++) {
      const age = frame / SOURCE_RATE;
      const envelope = age >= end ? .0001 : age < attack
        ? .0001 * (peak / .0001) ** (age / attack)
        : peak * (.0001 / peak) ** ((age - attack) / (end - attack));
      const input = Math.sin(phase * TAU) * envelope;
      const sample = b0 * input + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = input; y2 = y1; y1 = sample;
      phase = (phase + frequency * 1.02 * (.997 / 1.02) ** Math.min(1, age / end) / SOURCE_RATE) % 1;
      const tail = 1 - smooth((age - end - .015) / .005);
      left[start + frame] += sample * Math.cos(angle) * tail;
      right[start + frame] += sample * Math.sin(angle) * tail;
    }
  }
  return Object.freeze({ left, right, sampleRate: SOURCE_RATE, call: CALL });
}

function sources() {
  if (!preparedBank) {
    const bank = createQuadrupedSoundBank({ sampleRate: SOURCE_RATE, maxEntries: 8 });
    const hooves = QUADRUPED_LANES.flatMap(lane => [0, 1].map(variant => bank.get({
      skinId: QUADRUPED_DEFAULT_SOUND_SKIN, phase: 'touchdown', animal: ANIMAL,
      terrain: EVENTS[0].terrain, contact: { id: lane.id, intensity: 1 },
      resonance: SCORE.groundResonance, spring: SCORE.spring, scrape: .45,
      velocity: WITCH_CAT_UNICORN_STEPS_PER_SECOND, seed: variant + 1,
    })));
    preparedBank = Object.freeze({ bank, hooves: Object.freeze(hooves), sparkle: prepareSparkle() });
  }
  return preparedBank;
}

/** One finite escape on the existing cat clock. The source bank and twelve
 * fixed hoof slots are prepared before any onset; no timers, render callbacks,
 * AudioContexts or on-demand sample generation schedule this performance. */
export class WitchUnicornDSP {
  constructor(rate = 48000) {
    this.rate = Number.isFinite(rate) ? Math.max(8000, Math.min(192000, rate)) : 48000;
    this.sources = sources(); this.events = EVENTS;
    this.voices = Array.from({ length: VOICE_COUNT }, () => ({
      samples: null, position: 0, increment: 1, left: 0, right: 0,
    }));
    this.active = false; this.age = WITCH_CAT_UNICORN_DURATION; this.direction = 1;
    this.startedAt = 0; this.lastTime = 0; this.position = 0; this.lastStep = -1; this.renderAge = 0; this.releaseSparkle = false;
    this.releasing = false; this.release = 1; this.releaseStep = 1 / (this.rate * .035);
    this.attack = 0; this.attackStep = 1 / (this.rate * .008);
    this.left = this.right = this.hoofLeft = this.hoofRight = this.sparkleLeft = this.sparkleRight = 0;
    this.triggerCount = 0;
  }

  get activeVoiceCount() { return this.voices.reduce((sum, voice) => sum + Number(voice.samples !== null), 0); }

  trigger(time = 0, detail = {}) {
    if (this.active || !Number.isFinite(time)) return false;
    const startedAt = Number.isFinite(detail?.startedAt) ? Math.max(0, detail.startedAt) : time;
    const age = time - startedAt;
    if (age >= WITCH_CAT_UNICORN_DURATION || age < -.25) return false;
    this.startedAt = startedAt; this.lastTime = time; this.age = this.renderAge = Math.max(0, age);
    this.direction = detail?.direction < 0 ? -1 : 1;
    this.active = true; this.releasing = false; this.release = 1; this.attack = 0;
    this.position = Math.max(0, age - LANDING) * WITCH_CAT_UNICORN_STEPS_PER_SECOND;
    // A slow Audio start joins the current picture. Never replay the contacts
    // that happened during module loading, nor restart the sparkle at its head.
    this.lastStep = age < LANDING ? -1 : Math.floor(this.position);
    for (const voice of this.voices) voice.samples = null;
    return true;
  }

  cancel() {
    if (!this.active || this.releasing) return;
    this.releasing = true;
    const cursor = (this.renderAge - WITCH_CAT_UNICORN_DELAY) * SOURCE_RATE;
    this.releaseSparkle = cursor >= 0 && cursor < this.sources.sparkle.left.length - 1;
  }

  stop() {
    this.active = false;
    for (const voice of this.voices) voice.samples = null;
  }

  strike(contact, step, pan) {
    const lane = LANE_INDEX.get(contact.id), prepared = this.sources.hooves[lane * 2 + (Math.floor(step / 16) & 1)];
    let voice;
    for (const candidate of this.voices) if (!candidate.samples) { voice = candidate; break; }
    if (!voice) return; // Fixed pool: no abrupt stealing or unbounded overlap.
    const angle = (Math.max(-.95, Math.min(.95, pan + (lane % 2 ? .05 : -.05))) + 1) * Math.PI / 4;
    const gain = prepared.gain * contact.intensity * .52;
    voice.samples = prepared.samples; voice.position = 0;
    voice.increment = prepared.playbackRate * SOURCE_RATE / this.rate;
    voice.left = Math.cos(angle) * gain; voice.right = Math.sin(angle) * gain;
    this.triggerCount++;
  }

  next(time, enabled = true, playing = true) {
    this.left = this.right = this.hoofLeft = this.hoofRight = this.sparkleLeft = this.sparkleRight = 0;
    if (!this.active) return;
    if (!enabled || !playing || !Number.isFinite(time) || time < this.lastTime - 1e-9) this.cancel();
    if (Number.isFinite(time)) {
      this.lastTime = time;
      // Cancellation still advances its 35 ms release when Play has stopped.
      if (!this.releasing) this.age = this.renderAge = Math.max(0, time - this.startedAt);
    }
    if (this.age >= WITCH_CAT_UNICORN_DURATION) { this.age = WITCH_CAT_UNICORN_DURATION; this.stop(); return; }
    if (this.releasing) { this.release = Math.max(0, this.release - this.releaseStep); this.renderAge += 1 / this.rate; }
    if (!this.release) { this.stop(); return; }
    this.attack = Math.min(1, this.attack + this.attackStep);
    const run = clamp((this.age - LANDING) / WITCH_CAT_UNICORN_RUN);
    const landing = 600 + this.direction * 100, exit = this.direction > 0 ? 1250 : -250;
    const x = landing + (exit - landing) * run ** 1.2;
    const pan = Math.max(-.86, Math.min(.86, (x / 1000 * 2 - 1) * .72));
    this.position = Math.max(0, this.age - LANDING) * WITCH_CAT_UNICORN_STEPS_PER_SECOND;
    const step = this.age < LANDING ? -1 : Math.floor(this.position);
    if (!this.releasing && step > this.lastStep) {
      // Sample-clock progression crosses one frame. A seek consumes skipped
      // frames instead of bursting through historical hoof attacks.
      if (step === this.lastStep + 1) for (const contact of EVENTS[step % 16].contacts) this.strike(contact, step, pan);
      this.lastStep = step;
    }
    const sparkle = this.sources.sparkle, cursor = (this.renderAge - WITCH_CAT_UNICORN_DELAY) * SOURCE_RATE;
    if ((!this.releasing || this.releaseSparkle) && cursor >= 0 && cursor < sparkle.left.length - 1) {
      const index = Math.floor(cursor), fraction = cursor - index;
      this.sparkleLeft = sparkle.left[index] + (sparkle.left[index + 1] - sparkle.left[index]) * fraction;
      this.sparkleRight = sparkle.right[index] + (sparkle.right[index + 1] - sparkle.right[index]) * fraction;
    }
    for (const voice of this.voices) {
      if (!voice.samples) continue;
      const index = Math.floor(voice.position);
      if (index >= voice.samples.length - 1) { voice.samples = null; continue; }
      const fraction = voice.position - index;
      const sample = voice.samples[index] + (voice.samples[index + 1] - voice.samples[index]) * fraction;
      this.hoofLeft += sample * voice.left; this.hoofRight += sample * voice.right;
      voice.position += voice.increment;
    }
    const gain = smooth(this.release) * smooth(this.attack) * smooth((WITCH_CAT_UNICORN_DURATION - this.age) / .16);
    this.sparkleLeft *= gain; this.sparkleRight *= gain;
    this.hoofLeft *= gain; this.hoofRight *= gain;
    this.left = this.sparkleLeft + this.hoofLeft; this.right = this.sparkleRight + this.hoofRight;
  }
}
