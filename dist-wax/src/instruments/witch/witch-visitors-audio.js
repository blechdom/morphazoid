import { createQuadrupedState, quadrupedAnimal, quadrupedSequenceEvent, QUADRUPED_LANES } from '../quadruped/quadruped.js';
import { createQuadrupedSoundBank, QUADRUPED_DEFAULT_SOUND_SKIN } from '../quadruped/quadruped-sound-skins.js';
import { WITCH_VISITORS } from './witch-visitors-model.js';

const SOURCE_RATE = 24000;
const LANE_INDEX = new Map(QUADRUPED_LANES.map((lane, index) => [lane.id, index]));
const clamp = value => Math.max(0, Math.min(1, value));

/** The mouse and ceiling lizard play their own native Quadruped contacts.
 * Their routes share the cat's audio-clock time; drawing never schedules a foot.
 * Samples, scores and voices are prepared once, with no onset-time allocation. */
export class WitchVisitorDSP {
  constructor(rate) {
    this.rate = rate; this.left = this.right = 0; this.time = 0;
    this.releaseStep = 1 / (rate * .025);
    this.visitors = WITCH_VISITORS.map(route => {
      const score = createQuadrupedState(route.id, route.behaviorId), animal = quadrupedAnimal(route.id);
      const events = Array.from({ length: 16 }, (_, step) => quadrupedSequenceEvent(score, step));
      const bank = createQuadrupedSoundBank({ sampleRate: SOURCE_RATE, maxEntries: 8 });
      const samples = QUADRUPED_LANES.flatMap(lane => [0, 1].map(variant => bank.get({
        skinId: QUADRUPED_DEFAULT_SOUND_SKIN, phase: 'touchdown', animal,
        terrain: events[0].terrain, contact: { id: lane.id, intensity: 1 },
        resonance: score.groundResonance, spring: score.spring, scrape: .45,
        velocity: route.stepsPerSecond, seed: variant + 1,
      })));
      return { ...route, events, samples, bank, lastVisit: -1, lastStep: -1, capturedVisit: -1,
        audible: false, position: 0, triggerCount: 0, cursor: 0, level: 0,
        voices: Array.from({ length: 12 }, () => ({ samples: null, position: 0, increment: 1,
          left: 0, right: 0, release: 1, releasing: false })) };
    });
  }
  syncTime(time = 0, capturedAt = {}) {
    this.time = time; this.release();
    for (const visitor of this.visitors) {
      const visit = Math.floor((time - visitor.first) / visitor.period);
      visitor.lastVisit = visit;
      visitor.lastStep = Math.floor((time - visitor.first - visit * visitor.period) * visitor.stepsPerSecond);
      const when = capturedAt?.[visitor.id], capturedVisit = Math.floor((when - visitor.first) / visitor.period);
      visitor.capturedVisit = Number.isFinite(when) && when <= time && capturedVisit >= 0
        && when - visitor.first - capturedVisit * visitor.period < visitor.duration ? capturedVisit : -1;
      visitor.audible = false;
    }
  }
  capture(id) {
    const visitor = this.visitors.find(item => item.id === id);
    if (!visitor) return;
    visitor.capturedVisit = Math.floor((this.time - visitor.first) / visitor.period);
    for (const voice of visitor.voices) voice.releasing = true;
  }
  release() {
    for (const visitor of this.visitors) for (const voice of visitor.voices) voice.releasing = true;
  }
  trigger(visitor, contact, step, progress, visit) {
    const lane = LANE_INDEX.get(contact.id), prepared = visitor.samples[lane * 2 + (Math.floor(step / 16) & 1)];
    let voice = visitor.voices.find(item => !item.samples);
    if (!voice) voice = visitor.voices[visitor.cursor++ % visitor.voices.length];
    // The ceiling lizard crosses the width; the mouse starts on the left wall
    // and turns onto the floor about halfway through its route.
    const travel = visit % 2 ? 1 - progress : progress;
    const across = visitor.id === 'mouse' ? clamp((travel - .43) / .57) : 1 - travel;
    const pan = (across * 2 - 1) * .72 + (lane % 2 ? .05 : -.05), angle = (pan + 1) * Math.PI / 4;
    const gain = prepared.gain * contact.intensity * (visitor.id === 'mouse' ? .55 : .7);
    voice.samples = prepared.samples; voice.position = 0;
    voice.increment = prepared.playbackRate * SOURCE_RATE / this.rate;
    voice.left = Math.cos(angle) * gain; voice.right = Math.sin(angle) * gain;
    voice.release = 1; voice.releasing = false; visitor.triggerCount++;
  }
  next(time, enabled) {
    this.time = time; this.left = this.right = 0;
    for (const visitor of this.visitors) {
      const visit = Math.floor((time - visitor.first) / visitor.period);
      const elapsed = time - visitor.first - visit * visitor.period;
      const active = visit >= 0 && elapsed >= 0 && elapsed < visitor.duration;
      const step = Math.floor(elapsed * visitor.stepsPerSecond);
      const audible = enabled && active && visit !== visitor.capturedVisit;
      visitor.position = active ? elapsed * visitor.stepsPerSecond : 0;
      if (!audible && visitor.audible) for (const voice of visitor.voices) voice.releasing = true;
      if (audible && (step !== visitor.lastStep || visit !== visitor.lastVisit)) {
        // Consume skipped/muted steps. A new visit starts at its first contact;
        // resuming midway through a stride never queues a burst of old feet.
        const entering = visit !== visitor.lastVisit;
        if (visitor.audible || entering) {
          const event = visitor.events[step % 16];
          for (const contact of event.contacts) this.trigger(visitor, contact, step, elapsed / visitor.duration, visit);
        }
      }
      visitor.lastStep = step; visitor.lastVisit = visit; visitor.audible = audible;
      let left = 0, right = 0;
      for (const voice of visitor.voices) {
        if (!voice.samples) continue;
        if (voice.releasing) voice.release = Math.max(0, voice.release - this.releaseStep);
        const index = Math.floor(voice.position);
        if (!voice.release || index >= voice.samples.length - 1) { voice.samples = null; continue; }
        const fraction = voice.position - index;
        const sample = (voice.samples[index] + (voice.samples[index + 1] - voice.samples[index]) * fraction) * voice.release;
        left += sample * voice.left; right += sample * voice.right; voice.position += voice.increment;
      }
      visitor.level = Math.max(Math.abs(left), Math.abs(right));
      this.left += left; this.right += right;
    }
  }
}
