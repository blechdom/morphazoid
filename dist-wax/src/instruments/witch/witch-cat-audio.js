import { createQuadrupedState, quadrupedAnimal, quadrupedSequenceEvent, QUADRUPED_LANES } from '../quadruped/quadruped.js';
import { createQuadrupedSoundBank, QUADRUPED_DEFAULT_SOUND_SKIN } from '../quadruped/quadruped-sound-skins.js';
import { createWitchCatClock, advanceWitchCatClock, WITCH_CAT_GAITS } from './witch-cat-model.js';

const SOURCE_RATE = 24000;
const VOICE_COUNT = 12;
const CAT = quadrupedAnimal('cat');
const LANE_INDEX = new Map(QUADRUPED_LANES.map((lane, index) => [lane.id, index]));
// These are Quadruped's actual authored contact events, prepared once. The
// canvas reads the same gait/score phase; no animation frame schedules sound.
const SCORES = new Map(WITCH_CAT_GAITS.map(gait => {
  const score = createQuadrupedState('cat', gait);
  return [gait, { score, events: Array.from({ length: 16 }, (_, step) => quadrupedSequenceEvent(score, step)) }];
}));

/** A bounded PCM adapter to Quadruped's default Karplus contact instrument.
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
  }
}
