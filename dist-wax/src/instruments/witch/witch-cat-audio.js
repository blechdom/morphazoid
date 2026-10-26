import { createQuadrupedState, quadrupedAnimal, quadrupedSequenceEvent, QUADRUPED_LANES } from '../quadruped/quadruped.js';
import { createQuadrupedSoundBank, QUADRUPED_DEFAULT_SOUND_SKIN } from '../quadruped/quadruped-sound-skins.js';
import { quadrupedCalls } from '../quadruped/quadruped-voices.js';
import { createWitchCatClock, advanceWitchCatClock, WITCH_CAT_GAITS, WITCH_CAT_MEOW_DURATION, witchCatMeowEnvelope } from './witch-cat-model.js';

const SOURCE_RATE = 24000;
const VOICE_COUNT = 12;
const CAT = quadrupedAnimal('cat');
const CAT_MEOW = quadrupedCalls('cat')[0];
const MEOW_PITCHES = CAT_MEOW.notes.map(note => 440 * 2 ** ((note - 69) / 12));
const TAU = Math.PI * 2;
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const LANE_INDEX = new Map(QUADRUPED_LANES.map((lane, index) => [lane.id, index]));
// These are Quadruped's actual authored contact events, prepared once. The
// canvas reads the same gait/score phase; no animation frame schedules sound.
const SCORES = new Map(WITCH_CAT_GAITS.map(gait => {
  const score = createQuadrupedState('cat', gait);
  return [gait, { score, events: Array.from({ length: 16 }, (_, step) => quadrupedSequenceEvent(score, step)) }];
}));

class MeowFormant {
  constructor(rate) { this.rate = rate; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  tune(hz, width) {
    const frequency = Math.min(hz, this.rate * .42), omega = TAU * frequency / this.rate;
    const alpha = Math.sin(omega) * width / (2 * frequency), inverse = 1 / (1 + alpha);
    this.b = alpha * inverse; this.a1 = -2 * Math.cos(omega) * inverse; this.a2 = (1 - alpha) * inverse;
  }
  next(input) {
    const output = this.b * (input - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = input; this.y2 = this.y1; this.y1 = output;
    return output;
  }
}

function meowSaw(phase, step) {
  let sample = 2 * phase - 1;
  if (phase < step) { const t = phase / step; sample -= t + t - t * t - 1; }
  else if (phase > 1 - step) { const t = (phase - 1) / step; sample -= t * t + t + t + 1; }
  return sample;
}

/** A bounded PCM adapter to Quadruped's default Karplus contact instrument.
 * Its single procedural head voice adapts Quadruped's authored Meow call with
 * an m→ee→ow mouth shape. This is a synthetic character, not a cat recording.
 * It owns neither an AudioContext nor any scheduler, source node or timer. */
export class WitchCatDSP {
  constructor(sampleRate = 48000) {
    this.sampleRate = Number.isFinite(sampleRate) ? Math.max(8000, Math.min(192000, sampleRate)) : 48000;
    this.clock = createWitchCatClock();
    this.left = 0; this.right = 0; this.level = 0;
    this.lastStep = -1; this.lastVisit = 0; this.audible = false;
    this.triggerCount = 0;
    this.bank = createQuadrupedSoundBank({ sampleRate: SOURCE_RATE, maxEntries: 8 });
    const { score, events } = SCORES.get('cat-prowl');
    // Eight buffers total: four real limbs, two fixed excitation variants.
    // Bank generation never happens inside next() or at a contact onset.
    this.samples = QUADRUPED_LANES.flatMap(lane => [0, 1].map(variant => this.bank.get({
      skinId: QUADRUPED_DEFAULT_SOUND_SKIN, phase: 'touchdown', animal: CAT,
      terrain: events[0].terrain, contact: { id: lane.id, intensity: 1 },
      resonance: score.groundResonance, spring: score.spring, scrape: .45,
      velocity: 48, seed: variant + 1,
    })));
    this.voices = Array.from({ length: VOICE_COUNT }, () => ({
      samples: null, position: 0, increment: 1, left: 0, right: 0, release: 1, releasing: false,
    }));
    this.voiceCursor = 0;
    this.releaseStep = 1 / (this.sampleRate * .025);
    this.levelDecay = Math.exp(-1 / (this.sampleRate * .05));
    // One voice and one coalesced request: clicking cannot grow resources or
    // stack meows. Retrigger only after a short fade has reached zero.
    this.meow = { active: false, pending: false, age: 0, phase: 0, subPhase: 0, pan: 0,
      release: 1, releaseStep: 0, controlSamples: 0,
      formants: Array.from({ length: 3 }, () => new MeowFormant(this.sampleRate)) };
    this.meowEnvelope = 0; this.meowLevel = 0; this.meowLeft = 0; this.meowRight = 0;
  }

  get time() { return this.clock.time; }
  get activeVoiceCount() { return this.voices.reduce((sum, voice) => sum + Number(voice.samples !== null), 0); }

  /** Restore the silent owner's integrated travel, including a live speed
   * edit mid-visit. Numeric callers retain the deterministic neutral fallback. */
  syncTime(secondsOrSnapshot = 0) {
    const snapshot = secondsOrSnapshot && typeof secondsOrSnapshot === 'object' ? secondsOrSnapshot : null;
    const time = snapshot ? snapshot.time : secondsOrSnapshot;
    this.clock = createWitchCatClock(time,
      snapshot ? { catSpeed: snapshot.speed, catGait: snapshot.gait } : {}, snapshot);
    this.lastVisit = this.clock.visit;
    this.lastStep = Math.floor(this.clock.position);
    this.release();
    return this.clock;
  }

  release() {
    for (const voice of this.voices) if (voice.samples) voice.releasing = true;
    this.releaseMeow();
  }

  releaseMeow() {
    this.meow.pending = false;
    if (this.meow.active) this.meow.releaseStep = this.releaseStep;
  }

  triggerMeow() {
    if (!this.clock.active) return false;
    if (this.meow.active) {
      this.meow.pending = true;
      this.meow.releaseStep = 1 / (this.sampleRate * .012);
    } else this.startMeow();
    return true;
  }

  startMeow() {
    const voice = this.meow;
    voice.active = true; voice.pending = false; voice.age = 0;
    voice.phase = 0; voice.subPhase = 0; voice.release = 1; voice.releaseStep = 0; voice.controlSamples = 0;
    voice.pan = (this.clock.visit % 2 ? 1 : -1) * (this.clock.progress * 2 - 1) * .55;
    for (const formant of voice.formants) formant.x1 = formant.x2 = formant.y1 = formant.y2 = 0;
  }

  nextMeow() {
    const voice = this.meow;
    this.meowLeft = this.meowRight = this.meowEnvelope = 0;
    if (voice.active) {
      voice.release = Math.max(0, voice.release - voice.releaseStep);
      if (voice.age >= WITCH_CAT_MEOW_DURATION || voice.release === 0) {
        voice.active = false;
        if (voice.pending) this.startMeow();
      }
    }
    if (voice.active) {
      const t = voice.age, open = smooth((t - .025) / .14), round = smooth((t - .27) / .4);
      if (voice.controlSamples-- <= 0) {
        // The source/filter character comes from Quadruped's call; the moving
        // resonances are an authored mouth proxy for this longer click gesture.
        voice.formants[0].tune(280 + open * 140 + round * 240, 160 + open * 100);
        voice.formants[1].tune(CAT_MEOW.filter * (.7 + open * .8 - round * .85), 240 + round * 130);
        voice.formants[2].tune(3000 - round * 800, 400);
        voice.controlSamples = 15;
      }
      const position = Math.min(MEOW_PITCHES.length - 1, t / WITCH_CAT_MEOW_DURATION * MEOW_PITCHES.length);
      const index = Math.min(MEOW_PITCHES.length - 2, Math.floor(position)), mix = smooth(position - index);
      const frequency = (MEOW_PITCHES[index] * (1 - mix) + MEOW_PITCHES[index + 1] * mix)
        * (1 + .008 * Math.sin(TAU * t * 7));
      const step = frequency / this.sampleRate;
      voice.phase = (voice.phase + step) % 1; voice.subPhase = (voice.subPhase + step * .5) % 1;
      const source = meowSaw(voice.phase, step);
      const shaped = voice.formants[0].next(source) * 1.3 + voice.formants[1].next(source) * (1 + open * 1.4)
        + voice.formants[2].next(source) * open * .35;
      const nasal = Math.sin(voice.phase * TAU) * (1 - open * .6);
      const sub = Math.sin(voice.subPhase * TAU) * .08 * (1 + .12 * Math.sin(TAU * t * 24));
      this.meowEnvelope = witchCatMeowEnvelope(t) * smooth(voice.release);
      const sample = Math.tanh(shaped * .95 + nasal * .32 + sub) * .34 * this.meowEnvelope;
      // A reset can move the visitor across the screen. Keep a releasing head
      // at its old position so the stereo image cannot jump during that tail.
      if (!voice.releaseStep) voice.pan = (this.clock.visit % 2 ? 1 : -1) * (this.clock.progress * 2 - 1) * .55;
      const angle = (voice.pan + 1) * Math.PI / 4;
      this.meowLeft = sample * Math.cos(angle); this.meowRight = sample * Math.sin(angle);
      voice.age += 1 / this.sampleRate;
    }
    this.meowLevel = Math.max(Math.abs(this.meowLeft), Math.abs(this.meowRight), this.meowLevel * this.levelDecay);
  }

  trigger(contact, absoluteStep) {
    const lane = LANE_INDEX.get(contact.id);
    const prepared = this.samples[lane * 2 + (Math.floor(absoluteStep / 16) & 1)];
    let voice = this.voices.find(item => !item.samples);
    if (!voice) voice = this.voices[this.voiceCursor++ % VOICE_COUNT];
    const direction = this.clock.visit % 2 ? 1 : -1;
    const pan = direction * (this.clock.progress * 2 - 1) * .65 + (lane % 2 ? .07 : -.07);
    const angle = (pan + 1) * Math.PI / 4;
    const gain = prepared.gain * contact.intensity * .58;
    voice.samples = prepared.samples; voice.position = 0;
    voice.increment = prepared.playbackRate * SOURCE_RATE / this.sampleRate;
    voice.left = Math.cos(angle) * gain; voice.right = Math.sin(angle) * gain;
    voice.release = 1; voice.releasing = false;
    this.triggerCount++;
  }

  /** Call for every sample. Play owns time even when Audio is muted. */
  next(controls = {}, enabled = false, playing = enabled) {
    const previouslyActive = this.clock.active;
    if (playing) advanceWitchCatClock(this.clock, this.clock.time + 1 / this.sampleRate, controls);
    const audible = enabled && playing;
    if (!audible && this.audible) this.release();
    if (!audible || !this.clock.active) this.releaseMeow();
    const step = Math.floor(this.clock.position);
    if (audible && this.clock.active) {
      if (this.lastVisit !== this.clock.visit || !previouslyActive) this.lastStep = step - 1;
      if (step > this.lastStep) {
        const event = SCORES.get(this.clock.gait).events[step % 16];
        for (const contact of event.contacts) this.trigger(contact, step);
      }
    }
    this.audible = audible; this.lastVisit = this.clock.visit; this.lastStep = step;
    let left = 0, right = 0;
    for (const voice of this.voices) {
      if (!voice.samples) continue;
      if (voice.releasing) voice.release = Math.max(0, voice.release - this.releaseStep);
      const index = Math.floor(voice.position);
      if (voice.release <= 0 || index >= voice.samples.length - 1) { voice.samples = null; continue; }
      const fraction = voice.position - index;
      const sample = (voice.samples[index] * (1 - fraction) + voice.samples[index + 1] * fraction) * voice.release;
      left += sample * voice.left; right += sample * voice.right;
      voice.position += voice.increment;
    }
    this.left = left; this.right = right;
    this.level = Math.max(Math.abs(left), Math.abs(right), this.level * this.levelDecay);
    this.nextMeow();
  }
}
