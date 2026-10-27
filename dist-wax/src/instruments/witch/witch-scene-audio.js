import { WITCH_BITE_CLIPS } from './witch-bite-clips.js';
import { WITCH_NATIVE_BITE_VARIANTS } from './witch-bite-native-variants.js';
import { WITCH_CHARACTER_BITE_VARIANTS } from './witch-bite-character-variants.js';
import { WITCH_SOURCE_BITE_VARIANTS } from './witch-bite-source-variants.js';
import { SpiderStrings } from '../spider-synth/spider-synth-string.js';
import { SyrinxSourceEngine } from '../../families/syrinx/syrinx-source-models.js';
import { branchAngleFrequency } from '../l-system/l-system.js';
import { traceWitchTree, witchTreeSettings, WITCH_TREE_TRAVERSAL_SECONDS } from './witch-tree-model.js';
import { WITCH_BLECH_FLYBY_CYCLE, WITCH_BLECH_FLYBY_DURATION, WITCH_BLECH_FLYBY_EVENTS } from './witch-scene-model.js';

const TAU = Math.PI * 2;
let decodedClips, decodedVariants;
const rawVariants = { ...WITCH_NATIVE_BITE_VARIANTS, ...WITCH_CHARACTER_BITE_VARIANTS, ...WITCH_SOURCE_BITE_VARIANTS };
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const lookup = new Int16Array(128).fill(-1);
for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
function decodeClip(clip) {
  const data = new Float32Array(clip.frames);
  let bits = 0, accumulator = 0, low = -1, frame = 0;
  for (let i = 0; i < clip.pcm.length; i++) {
    const value = lookup[clip.pcm.charCodeAt(i)]; if (value < 0) continue;
    accumulator = (accumulator << 6) | value; bits += 6;
    if (bits >= 8) {
      bits -= 8; const byte = (accumulator >>> bits) & 255;
      if (low < 0) low = byte;
      else { const sample = low | (byte << 8); data[frame++] = (sample >= 32768 ? sample - 65536 : sample) / 32768; low = -1; }
    }
  }
  return Object.freeze({ data, rate: clip.rate, frames: clip.frames, instrumentId: clip.instrumentId, events: clip.events, label: clip.label, source: clip.source,
    loopStartFrame: clip.loopStartFrame, loopFrames: clip.loopFrames });
}

/** Fixed PCM bank, decoded once at Audio arm. No fetch, base64 browser globals,
 * source instrument, or allocation is needed at a trigger or render boundary. */
export function witchBiteClips() {
  if (decodedClips) return decodedClips;
  decodedClips = Object.fromEntries(Object.entries(WITCH_BITE_CLIPS).map(([kind, clip]) => [kind, decodeClip(rawVariants[kind]?.[0] ?? clip)]));
  // The cupboard Quadruped is the same native cat call already used by the
  // walking animal; share its fixed PCM allocation rather than duplicate it.
  decodedClips['drop-quadruped'] = decodedClips['drop-cat'];
  return Object.freeze(decodedClips);
}

/** Authored choices share fixed decoded storage across Witch engines. */
export function witchBiteVariants() {
  if (decodedVariants) return decodedVariants;
  const base = witchBiteClips();
  decodedVariants = Object.fromEntries(Object.entries(rawVariants).map(([kind, variants]) =>
    [kind, Object.freeze(variants.map((clip, index) => index === 0 || !clip ? base[kind] : decodeClip(clip)))]));
  if (decodedVariants['drop-cat']) decodedVariants['drop-quadruped'] = decodedVariants['drop-cat'];
  return Object.freeze(decodedVariants);
}

export const WITCH_BLECH_FRENZY_DURATION = 5.2;

// Read a crossfaded source period from the shared native PCM. Loop metadata
// stays inside the ingredient clip's boundary fades; no voices are created.
export function sampleWitchBlechLoop(clip, position) {
  const crossfade = Math.round(clip.rate * .025), loopLength = clip.loopFrames ?? clip.frames - crossfade - 1;
  const start = clip.loopStartFrame ?? 0, index = Math.floor(position), blend = position - index;
  let source = clip.data[start + index] + (clip.data[start + index + 1] - clip.data[start + index]) * blend;
  if (position < crossfade) {
    const tail = start + loopLength + index;
    const ending = clip.data[tail] + (clip.data[tail + 1] - clip.data[tail]) * blend;
    const mix = position / crossfade;
    source = ending * (1 - mix) + source * mix;
  }
  return source;
}

/** Two fixed PCM readers for sparse BLECH visitors. Geometric patterns and
 * chromatic ending excerpts repeat through BLECH's SoundFont engine, without using a
 * potion slot or its solo ducking.
 * Muted events are consumed; a seek or resume never replays a stale entrance. */
export class WitchBlechFlyby {
  constructor(rate) {
    this.dt = 1 / rate; this.time = 0; this.left = this.right = 0;
    this.clips = witchBiteVariants()['drop-blech'] ?? [witchBiteClips()['drop-blech']];
    this.clip = this.clips[0]; this.nextVariant = 0; this.nextManualVariant = 0;
    this.slots = Array.from({ length: 2 }, () => ({ age: -1, release: 1, releasing: false, direction: 1, clip: this.clip, variant: 0, position: 0, loops: 0 }));
    this.nextEvent = 0; this.nextCycle = 0; this.nextAt = WITCH_BLECH_FLYBY_EVENTS[0].at;
    // One reusable manual burst, with three faster, offset readers of the
    // clicked visitor's native phrase. It never occupies a potion
    // slot, wakes backing performers or allocates voices on a click.
    this.frenzy = { age: -1, gain: 0, releasing: false, pendingIndex: -1, pendingClip: null,
      index: 0, clip: this.clip, loops: 0 };
    this.frenzyReaders = [
      { position: 0, speed: 2.4, offset: .11, left: Math.sqrt(.79), right: Math.sqrt(.21) },
      { position: 0, speed: 2.8, offset: .39, left: Math.sqrt(.46), right: Math.sqrt(.54) },
      { position: 0, speed: 3.2, offset: .79, left: Math.sqrt(.18), right: Math.sqrt(.82) },
    ];
    this.frenzyLeft = this.frenzyRight = this.frenzyEnvelope = 0;
  }
  syncTime(time) {
    if (!Number.isFinite(time)) return;
    this.time = Math.max(0, time); this.release();
    this.nextCycle = Math.floor(this.time / WITCH_BLECH_FLYBY_CYCLE);
    const phase = this.time - this.nextCycle * WITCH_BLECH_FLYBY_CYCLE;
    this.nextEvent = WITCH_BLECH_FLYBY_EVENTS.findIndex(event => event.at > phase);
    if (this.nextEvent < 0) { this.nextEvent = 0; this.nextCycle++; }
    this.nextAt = this.nextCycle * WITCH_BLECH_FLYBY_CYCLE + WITCH_BLECH_FLYBY_EVENTS[this.nextEvent].at;
  }
  releaseFrenzy() {
    this.frenzy.pendingIndex = -1; this.frenzy.pendingClip = null; this.frenzy.releasing = true;
  }
  release() {
    for (const slot of this.slots) slot.releasing = true;
    this.releaseFrenzy();
  }
  triggerFrenzy(index = 0) {
    if (index !== 0 && index !== 1) return false;
    const slot = this.slots[index], live = slot.age >= 0 && !slot.releasing;
    const clip = live ? slot.clip : this.clips[this.nextManualVariant];
    if (!live) this.nextManualVariant = (this.nextManualVariant + 1) % this.clips.length;
    if (this.frenzy.age >= 0) {
      // Busy clicks replace one pending burst behind a 12 ms release rather
      // than stack more sample readers or cut the currently sounding wave.
      this.frenzy.pendingIndex = index; this.frenzy.pendingClip = clip; this.frenzy.releasing = true;
    } else this.startFrenzy(index, clip);
    return true;
  }
  startFrenzy(index, clip) {
    const burst = this.frenzy;
    burst.age = 0; burst.gain = 0; burst.releasing = false; burst.index = index; burst.clip = clip; burst.loops = 0;
    burst.pendingIndex = -1; burst.pendingClip = null;
    for (const reader of this.frenzyReaders) reader.position = reader.offset * (clip.loopFrames ?? clip.frames - Math.round(clip.rate * .025) - 1);
  }
  nextFrenzy(enabled) {
    this.frenzyLeft = this.frenzyRight = this.frenzyEnvelope = 0;
    const burst = this.frenzy;
    if (!enabled) this.releaseFrenzy();
    if (burst.age < 0) return;
    if (burst.releasing) {
      burst.gain = Math.max(0, burst.gain - this.dt / (burst.pendingIndex >= 0 ? .012 : .08));
      if (burst.gain === 0) {
        if (burst.pendingIndex >= 0 && enabled) this.startFrenzy(burst.pendingIndex, burst.pendingClip);
        else { burst.age = -1; return; }
      }
    } else burst.gain = Math.min(1, burst.gain + this.dt / .025);
    if (burst.age >= WITCH_BLECH_FRENZY_DURATION) { burst.age = -1; burst.gain = 0; return; }
    const clip = burst.clip, loopLength = clip.loopFrames ?? clip.frames - Math.round(clip.rate * .025) - 1;
    const envelope = burst.gain * Math.min(1, (WITCH_BLECH_FRENZY_DURATION - burst.age) / .22);
    this.frenzyEnvelope = envelope;
    for (const reader of this.frenzyReaders) {
      const sample = sampleWitchBlechLoop(clip, reader.position) * .125 * envelope;
      this.frenzyLeft += sample * reader.left; this.frenzyRight += sample * reader.right;
      reader.position += clip.rate * this.dt * reader.speed;
      if (reader.position >= loopLength) { reader.position -= loopLength; burst.loops++; }
    }
    burst.age += this.dt;
  }
  next(controls, enabled, manualEnabled = enabled) {
    this.left = this.right = 0;
    const running = controls.ghostGate && controls.mode === 'flight';
    if (!running || !enabled) for (const slot of this.slots) slot.releasing = true;
    this.nextFrenzy(manualEnabled && controls.mode === 'flight');
    if (running && this.time >= this.nextAt) {
      if (enabled) {
        const slot = this.slots[this.nextEvent === 2 ? 1 : 0];
        slot.age = 0; slot.release = 1; slot.releasing = false; slot.position = 0; slot.loops = 0;
        slot.variant = this.nextVariant; slot.clip = this.clips[this.nextVariant % this.clips.length];
        this.nextVariant = (this.nextVariant + 1) % this.clips.length;
        slot.direction = WITCH_BLECH_FLYBY_EVENTS[this.nextEvent].direction;
      }
      if (++this.nextEvent === WITCH_BLECH_FLYBY_EVENTS.length) { this.nextEvent = 0; this.nextCycle++; }
      this.nextAt = this.nextCycle * WITCH_BLECH_FLYBY_CYCLE + WITCH_BLECH_FLYBY_EVENTS[this.nextEvent].at;
    }
    for (const slot of this.slots) {
      if (slot.age < 0) continue;
      if (slot.releasing) slot.release = Math.max(0, slot.release - this.dt / .035);
      if (slot.release === 0 || slot.age >= WITCH_BLECH_FLYBY_DURATION) { slot.age = -1; continue; }
      const clip = slot.clip, loopLength = clip.loopFrames ?? clip.frames - Math.round(clip.rate * .025) - 1;
      const source = sampleWitchBlechLoop(clip, slot.position);
      const envelope = Math.min(1, slot.age / .025, (WITCH_BLECH_FLYBY_DURATION - slot.age) / .08) * slot.release;
      const pan = slot.direction * (slot.age / WITCH_BLECH_FLYBY_DURATION * 2 - 1) * .9;
      const sample = source * .22 * envelope * (1 - this.frenzyEnvelope * .85);
      this.left += sample * Math.sqrt((1 - pan) * .5);
      this.right += sample * Math.sqrt((1 + pan) * .5);
      slot.position += clip.rate * this.dt;
      if (slot.position >= loopLength) { slot.position -= loopLength; slot.loops++; }
      slot.age += this.dt;
    }
    if (running) this.time += this.dt;
  }
}

export const WITCH_WEB_RATIOS = Object.freeze([1, 1.071, Math.SQRT2, 1.493, Math.sqrt(3), 2.031, Math.sqrt(5)]);
// Short force and a clear onset let individual silk crossings read as plucks.
// The lower strike strength keeps overlapping sweeps at the restrained web
// level; dispersion and strain retain the low, creaking tail.
const WEB_SOUND = Object.freeze({ tune: 1, tension: 1, damping: .38, decay: 1.95,
  texture: .715, slide: .49, coupling: .08, pluckRegister: 1, pluckSpread: .93,
  pluckAttack: .003, pluckHold: .006, pluckRelease: 1.08 });
const WEB_STRUM_CAPACITY = 24;

const CHARM_BELLS = Object.freeze([
  [0, 1175, -.55], [.049, 988, .1], [.103, 784, .5],
  [.174, 1047, -.3], [.248, 1319, .3], [.331, 1568, -.05],
]);
const MUSHROOM_GLOBS = Object.freeze([
  [0, 104, 246, .065, .43, -.25], [.115, 139, -64, .13, .48, .3],
  [.338, 88, 298, .08, .52, -.4], [.617, 164, -73, .12, .46, .4],
  [.832, 102, 168, .07, .43, 0],
]);

/** Two original picture accents: inharmonic struck bells and liquid pitch
 * glides with a little filtered air. Each gesture reuses one finite voice;
 * repeated clicks coalesce behind an 8 ms fade, never stack or cut a waveform.
 * These are authored synth gestures, not samples of another instrument. */
export class WitchPictureAccents {
  constructor(rate) {
    this.dt = 1 / rate; this.nyquist = rate * .45; this.left = this.right = 0;
    this.airSlew = 1 - Math.exp(-TAU * 620 / rate);
    this.slots = Array.from({ length: 2 }, (_, index) => ({ age: -1, gain: 0, pending: false,
      releasing: false, duration: index === 0 ? 1.65 : 1.3, random: 0x5ab367, air: 0 }));
  }
  trigger(kind) {
    const index = kind === 'dice-charm' ? 0 : kind === 'mushroom-gloop' ? 1 : -1;
    if (index < 0) return false;
    const slot = this.slots[index];
    if (slot.age >= 0) { slot.pending = true; slot.releasing = true; }
    else this.start(slot);
    return true;
  }
  start(slot) {
    slot.age = 0; slot.gain = 0; slot.pending = false; slot.releasing = false;
    slot.random = 0x5ab367; slot.air = 0;
  }
  release() { for (const slot of this.slots) { slot.pending = false; slot.releasing = true; } }
  next(enabled) {
    this.left = this.right = 0;
    if (!enabled) this.release();
    for (let index = 0; index < this.slots.length; index++) {
      const slot = this.slots[index];
      if (slot.age < 0) continue;
      if (slot.releasing) {
        slot.gain = Math.max(0, slot.gain - this.dt / (slot.pending ? .008 : .025));
        if (slot.gain === 0) {
          if (slot.pending && enabled) this.start(slot);
          else { slot.age = -1; continue; }
        }
      } else slot.gain = Math.min(1, slot.gain + this.dt / .006);
      let left = 0, right = 0;
      if (index === 0) {
        for (const [onset, frequency, pan] of CHARM_BELLS) {
          const t = slot.age - onset;
          if (t < 0 || t > 1.3) continue;
          const envelope = Math.min(1, t / .003, (1.3 - t) / .12) * Math.exp(-t * 3.4);
          // The upper, non-integer modes ring briefly, leaving a clear bell tail.
          const phase = TAU * frequency * t;
          let bell = Math.sin(phase);
          if (frequency * 2.756 < this.nyquist) bell += Math.sin(phase * 2.756) * .4 * Math.exp(-t * 7);
          if (frequency * 4.137 < this.nyquist) bell += Math.sin(phase * 4.137) * .17 * Math.exp(-t * 13);
          const sample = bell * envelope * .072;
          left += sample * Math.sqrt((1 - pan) * .5); right += sample * Math.sqrt((1 + pan) * .5);
        }
      } else {
        let noise = slot.random; noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
        slot.random = noise >>> 0;
        slot.air += ((slot.random / 0x80000000 - 1) - slot.air) * this.airSlew;
        for (const [onset, frequency, sweep, glide, duration, pan] of MUSHROOM_GLOBS) {
          const t = slot.age - onset;
          if (t < 0 || t > duration) continue;
          const envelope = Math.min(1, t / .009, (duration - t) / .07) * Math.exp(-t * 4.2);
          const phase = TAU * (frequency * t + sweep * glide * (1 - Math.exp(-t / glide)));
          const wobble = Math.sin(TAU * t * 23) * .32 * Math.exp(-t * 9);
          const glob = Math.sin(phase + wobble) + Math.sin(phase * 1.92 + .7) * .34
            + Math.sin(phase * 3.13) * .14 + slot.air * .19 * Math.exp(-t * 11);
          const sample = Math.tanh(glob * 1.15) * envelope * .145;
          left += sample * Math.sqrt((1 - pan) * .5); right += sample * Math.sqrt((1 + pan) * .5);
        }
      }
      this.left += Math.tanh(left / .22) * .22 * slot.gain;
      this.right += Math.tanh(right / .22) * .22 * slot.gain;
      slot.age += this.dt;
      if (slot.age >= slot.duration) {
        if (slot.pending && enabled) this.start(slot);
        else { slot.age = -1; slot.gain = 0; }
      }
    }
  }
}

const TREE_RELEASE_SECONDS = .16;
export const WITCH_TREE_PHRASE_SECONDS = WITCH_TREE_TRAVERSAL_SECONDS + TREE_RELEASE_SECONDS;
const treeUnit = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : .5));
const treeSmooth = value => value * value * (3 - 2 * value);
// Grammar topology and parent distances are independent of live turn controls.
// Two native traces recover the exact inherited +/- turn counts, including
// multiple turns between drawn segments in the plant and coral grammars.
const TREE_SCORES = Array.from({ length: 6 }, (_, treeShape) => {
  const settings = witchTreeSettings({ treeShape });
  const trace = traceWitchTree({ treeShape });
  const skewed = traceWitchTree({ treeShape, treeCurl: 1 });
  const radians = settings.angle * Math.PI / 180;
  const turns = trace.segments.map((segment, index) => {
    const absolute = Math.round((skewed.segments[index].heading - segment.heading) / (radians * .18));
    return { absolute, signed: Math.round(segment.heading / radians - absolute * settings.turnAsymmetry) };
  });
  const order = trace.segments.map(segment => segment.index).sort((a, b) =>
    trace.segments[a].startDistance - trace.segments[b].startDistance || a - b);
  return { trace, turns, order };
});
const TREE_VOICE_LIMIT = Math.max(...TREE_SCORES.map(score => score.trace.segments.length));

/** One note for every visible branch, using the native synchronous frontier.
 * Six fixed schedules and one fixed voice bank are prepared at audio arm.
 * Only sounding/releasing voices run per sample; live bends never regenerate
 * a tree, allocate a score, restart its clock or change its fork timings. */
export class WitchTreePhrase {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate;
    this.age = -1; this.gain = 0; this.envelope = 0; this.left = this.right = 0;
    this.cursor = 0; this.frame = 0; this.onsets = 0; this.onsetCursor = 0;
    this.modulationIndex = this.targetIndex = 5.5;
    this.slew = 1 - Math.exp(-this.dt / .04); this.releasing = false;
    this.lowL = this.lowR = 0;
    this.lowpass = 1 - Math.exp(-TAU * Math.min(4200, rate * .32) / rate);
    this.controls = { treeShape: 0, treeSpread: .5, treeCurl: .5 }; this.settings = {};
    this.scores = TREE_SCORES.map(score => ({ ...score,
      notes: score.trace.segments.map((segment, index) => {
        const startFrame = Math.round(segment.startDistance / score.trace.duration * WITCH_TREE_TRAVERSAL_SECONDS * rate);
        const releaseFrame = Math.round(segment.endDistance / score.trace.duration * WITCH_TREE_TRAVERSAL_SECONDS * rate);
        const holdFrames = releaseFrame - startFrame;
        return { segment, ...score.turns[index], startFrame, releaseFrame,
          attackFrames: Math.max(1, Math.round(Math.min(rate * .018, holdFrames * .16))),
          decayFrames: Math.max(1, Math.round(Math.min(rate * .07, holdFrames * .28))),
          releaseFrames: Math.max(1, Math.round(rate * TREE_RELEASE_SECONDS)), sustain: .64,
          amplitude: .082 * Math.sqrt(segment.powerShare) * (1 - segment.forkDepth * .06) };
      }),
    }));
    this.voices = Array.from({ length: TREE_VOICE_LIMIT }, () => ({
      segment: null, phase: 0, modPhase: 0, frequency: 0, targetFrequency: 0, ratio: 0, targetRatio: 0,
      panL: 0, panR: 0, targetPanL: 0, targetPanR: 0, envelope: 0, started: false,
    }));
    this.activeIndices = new Uint16Array(TREE_VOICE_LIMIT); this.activeCount = 0;
    this.selectScore(0); this.setControls();
  }
  get progress() { return Math.min(1, this.cursor / WITCH_TREE_TRAVERSAL_SECONDS); }
  selectScore(shape) {
    this.shape = shape; this.score = this.scores[shape]; this.trace = this.score.trace;
    this.branchCount = this.score.notes.length; this.frames = 0;
    for (let index = 0; index < this.voices.length; index++) {
      const voice = this.voices[index], note = this.score.notes[index];
      voice.segment = note?.segment ?? null; voice.envelope = 0; voice.started = false;
      if (note) {
        Object.assign(voice, note);
        this.frames = Math.max(this.frames, note.releaseFrame + note.releaseFrames);
      }
    }
  }
  setControls(treeSpread = .5, treeCurl = .5, treeShape = 0) {
    this.controls.treeSpread = treeUnit(treeSpread); this.controls.treeCurl = treeUnit(treeCurl);
    this.controls.treeShape = Math.round(Math.max(0, Math.min(5, Number.isFinite(Number(treeShape)) ? Number(treeShape) : 0)));
    const settings = witchTreeSettings(this.controls, this.settings);
    if (settings.shape !== this.shape) {
      // A replacement picture cannot inherit an unrelated phrase/playhead.
      // Finish a short fade; only a later click may start the new score.
      if (this.age >= 0) { this.release(); return; }
      this.selectScore(settings.shape);
    }
    this.targetAngle = settings.angle; this.targetAsymmetry = settings.turnAsymmetry;
    this.targetIndex = 3 + 5 * settings.spread;
    for (let index = 0; index < this.branchCount; index++) {
      const voice = this.voices[index], generation = voice.segment.generation;
      const heading = settings.angle * Math.PI / 180 * (voice.signed + voice.absolute * settings.turnAsymmetry);
      voice.targetHeading = heading;
      voice.targetRatio = 1.5 + generation * .12 + (settings.curl - .5) * .9;
      // Reserve room for index-eight sidebands, including low-rate offline
      // rendering. The audible index itself always spans the full 3–8 range.
      voice.targetFrequency = Math.min(branchAngleFrequency(heading, 294, 2.6),
        this.rate * .4 / (1 + 10 * voice.targetRatio));
      const pan = Math.max(-.85, Math.min(.85, Math.sin(heading) * .65 + (settings.curl - .5) * .28));
      voice.targetPanL = Math.cos((pan + 1) * Math.PI / 4);
      voice.targetPanR = Math.sin((pan + 1) * Math.PI / 4);
    }
  }
  trigger() {
    if (this.age >= 0) return false;
    // Apply a score change deferred during the old phrase's release.
    this.setControls(this.controls.treeSpread, this.controls.treeCurl, this.controls.treeShape);
    this.age = this.cursor = this.frame = this.onsets = this.onsetCursor = this.activeCount = 0;
    this.gain = 1; this.releasing = false; this.lowL = this.lowR = 0;
    this.modulationIndex = this.targetIndex;
    for (let index = 0; index < this.branchCount; index++) {
      const voice = this.voices[index];
      voice.phase = voice.segment.index * 2.399963229728653;
      voice.modPhase = voice.phase * .61803398875;
      voice.envelope = 0; voice.started = false;
    }
    return true;
  }
  release() { this.releasing = true; }
  next(enabled) {
    this.left = this.right = this.envelope = 0;
    if (!enabled) this.release();
    if (this.age < 0) return;
    if (this.releasing) this.gain = Math.max(0, this.gain - this.dt / .035);
    if (this.gain === 0 || this.frame >= this.frames) {
      this.age = -1; this.gain = 0; this.lowL = this.lowR = 0;
      for (let index = 0; index < this.activeCount; index++) this.voices[this.activeIndices[index]].envelope = 0;
      this.activeCount = 0;
      return;
    }
    while (!this.releasing && this.onsetCursor < this.branchCount) {
      const index = this.score.order[this.onsetCursor], voice = this.voices[index];
      if (voice.startFrame > this.frame) break;
      voice.started = true; this.onsets++; this.onsetCursor++;
      voice.frequency = voice.targetFrequency; voice.ratio = voice.targetRatio;
      voice.panL = voice.targetPanL; voice.panR = voice.targetPanR;
      this.activeIndices[this.activeCount++] = index;
    }
    this.modulationIndex += (this.targetIndex - this.modulationIndex) * this.slew;
    let left = 0, right = 0;
    for (let index = 0; index < this.activeCount;) {
      const voice = this.voices[this.activeIndices[index]], local = this.frame - voice.startFrame;
      if (this.frame >= voice.releaseFrame + voice.releaseFrames) {
        voice.envelope = 0;
        this.activeIndices[index] = this.activeIndices[--this.activeCount];
        continue;
      }
      index++;
      let envelope = voice.sustain;
      if (local < voice.attackFrames) envelope = treeSmooth(local / voice.attackFrames);
      else if (local < voice.attackFrames + voice.decayFrames) {
        envelope = 1 - (1 - voice.sustain) * treeSmooth((local - voice.attackFrames) / voice.decayFrames);
      } else if (this.frame >= voice.releaseFrame) {
        envelope *= 1 - treeSmooth((this.frame - voice.releaseFrame) / voice.releaseFrames);
      }
      voice.envelope = envelope * this.gain;
      voice.frequency += (voice.targetFrequency - voice.frequency) * this.slew;
      voice.ratio += (voice.targetRatio - voice.ratio) * this.slew;
      voice.panL += (voice.targetPanL - voice.panL) * this.slew;
      voice.panR += (voice.targetPanR - voice.panR) * this.slew;
      const step = TAU * voice.frequency * this.dt;
      voice.phase = (voice.phase + step) % TAU;
      voice.modPhase = (voice.modPhase + step * voice.ratio) % TAU;
      const sample = Math.sin(voice.phase + this.modulationIndex * Math.sin(voice.modPhase))
        * voice.amplitude * voice.envelope;
      left += sample * voice.panL; right += sample * voice.panR;
      this.envelope = Math.max(this.envelope, voice.envelope);
    }
    this.lowL += (left - this.lowL) * this.lowpass;
    this.lowR += (right - this.lowR) * this.lowpass;
    this.left = Math.tanh(this.lowL / .22) * .22;
    this.right = Math.tanh(this.lowR / .22) * .22;
    this.frame++; this.age = this.cursor = this.frame * this.dt;
  }
}

export class WitchSceneDSP {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.left = this.right = 0;
    this.tree = new WitchTreePhrase(rate);
    this.pictureAccents = new WitchPictureAccents(rate);
    this.web = new SpiderStrings(rate); this.levels = new Float64Array(8).fill(1);
    this.active = 0; this.gain = 0; this.groanAge = 2; this.groan = 0; this.low = 0;
    this.webControl = 0; this.webDormant = true; this.webLowL = this.webLowR = 0;
    this.webLowpass = 1 - Math.exp(-TAU * 1250 / rate);
    // Sparse pointer updates may cross several silk lines. Spread those
    // attacks on the audio clock; a busy gesture can never build a long queue.
    this.webFrame = 0; this.webQueueHead = 0; this.webQueueCount = 0;
    this.webQueueIndices = new Uint8Array(WEB_STRUM_CAPACITY);
    this.webQueueFrames = new Float64Array(WEB_STRUM_CAPACITY);
    this.webQueueHorizon = Math.round(rate * .12);
    this.groanRelease = 1; this.groanReleasing = false;
    this.attack = 1 - Math.exp(-this.dt / .006); this.release = 1 - Math.exp(-this.dt / .035);
    this.source = new SyrinxSourceEngine({ sampleRate: rate, seed: 0x4a61, model: 'twoMass', parameters: {
      frequencyHz: 57, pressure: .83, tension: .2, adduction: .91, breath: .23, roughness: .72,
      asymmetry: .4, sourceScale: .8, sourceBalance: .48, coupling: .5, feedback: .4, outputGain: .65, pulseRateHz: 14,
    } });
  }
  pluckWeb(index) {
    this.web.pluck(69 * WITCH_WEB_RATIOS[index], .48, (index - 3) / 4, WEB_SOUND, 6, index, 1, .19, null, 1, true, 0, -1, true);
    this.webDormant = false;
    this.active = 2.8;
  }
  queueWebStrum(detail) {
    if (!Array.isArray(detail?.indices)) return false;
    const seconds = Number.isFinite(detail.interval) ? detail.interval : .012;
    const interval = Math.max(1, Math.round(this.rate * Math.max(.006, Math.min(.025, seconds))));
    const last = (this.webQueueHead + this.webQueueCount - 1 + WEB_STRUM_CAPACITY) % WEB_STRUM_CAPACITY;
    let frame = this.webQueueCount ? Math.max(this.webFrame, this.webQueueFrames[last] + interval) : this.webFrame;
    let accepted = false;
    for (let i = 0; i < Math.min(8, detail.indices.length); i++) {
      const index = detail.indices[i];
      if (!Number.isInteger(index) || index < 0 || index > 6) continue;
      if (this.webQueueCount >= WEB_STRUM_CAPACITY || frame > this.webFrame + this.webQueueHorizon) break;
      const tail = (this.webQueueHead + this.webQueueCount) % WEB_STRUM_CAPACITY;
      this.webQueueIndices[tail] = index; this.webQueueFrames[tail] = frame;
      this.webQueueCount++; frame += interval; accepted = true;
    }
    return accepted;
  }
  trigger(kind, detail) {
    if (this.pictureAccents.trigger(kind)) return true;
    if (kind === 'tree-l-system') return this.tree.trigger();
    if (kind === 'web-strum') return this.queueWebStrum(detail);
    if (/^web-[0-6]$/.test(kind)) {
      this.pluckWeb(Number(kind.at(-1))); return true;
    }
    if (kind === 'spider-groan') {
      this.groanAge = 0; this.groanRelease = 1; this.groanReleasing = false;
      this.active = Math.max(this.active, 1.7); return true;
    }
    return false;
  }
  releaseAll() { this.active = 0; this.webQueueCount = 0; this.web.release(); this.groanReleasing = true; this.tree.release(); this.pictureAccents.release(); }
  next(enabled) {
    if (!enabled) this.webQueueCount = 0;
    while (this.webQueueCount > 0 && this.webQueueFrames[this.webQueueHead] <= this.webFrame) {
      this.pluckWeb(this.webQueueIndices[this.webQueueHead]);
      this.webQueueHead = (this.webQueueHead + 1) % WEB_STRUM_CAPACITY; this.webQueueCount--;
    }
    this.webFrame++;
    this.active = Math.max(0, this.active - this.dt);
    const active = enabled && this.active > 0;
    this.gain += ((active ? 1 : 0) - this.gain) * (active ? this.attack : this.release);
    if (this.webControl-- <= 0) {
      this.webControl = 31;
      if (!this.webDormant) for (const voice of this.web.voices) if (voice.remaining > 0) {
        const age = voice.age / this.rate;
        const strain = 1 + .0525 * Math.sin(age * 17.3 + voice.segmentId) * Math.exp(-age * 1.5)
          + .013 * Math.sin(age * 83.1);
        voice.targetPeriod = Math.max(3, Math.min(4092, this.rate / (voice.frequency * strain) - voice.loss));
      }
    }
    // Empty SpiderStrings only rewrites zero outputs/scratch arrays. Keep its
    // strain clock and the downstream lowpass tail running between plucks.
    if (!this.webDormant) {
      this.web.sample(this.levels, .47, WEB_SOUND);
      this.webDormant = this.web.active === 0;
    }
    this.webLowL += (this.web.left - this.webLowL) * this.webLowpass;
    this.webLowR += (this.web.right - this.webLowR) * this.webLowpass;
    this.groan = 0;
    if (this.groanReleasing) this.groanRelease = Math.max(0, this.groanRelease - this.dt / .035);
    if (this.groanRelease === 0) this.groanAge = 2;
    if (this.groanAge < 1.6) {
      const t = this.groanAge; this.groanAge += this.dt;
      this.source.target.frequencyHz = 47 + 38 * Math.sin(Math.PI * t / 1.6) ** 2;
      const source = this.source.renderSample(this.low * .1);
      this.low += .07 * (source - this.low);
      this.groan = Math.tanh(this.low * 3) * Math.sin(Math.PI * t / 1.6) * .11 * this.groanRelease;
    }
    this.tree.next(enabled);
    this.pictureAccents.next(enabled);
    // Restore half the unfiltered pluck while keeping the quieter 1.05 trim.
    this.left = ((this.webLowL + this.web.left) * .525 + this.groan) * this.gain + this.tree.left + this.pictureAccents.left;
    this.right = ((this.webLowR + this.web.right) * .525 + this.groan * .8) * this.gain + this.tree.right + this.pictureAccents.right;
    if (this.gain < 1e-9) this.groanAge = 2;
  }
}

/** One refreshable wind puff. The brown/pink/white coloring is the scalar
 * colored-noise branch of Fabric Filter's MoireDroneDSP; no fabric simulation
 * or source instrument is constructed here. Its random stream is independent
 * of the performers, and repeated pointer events extend one bounded voice. */
export class WitchFabricWind {
  constructor(rate) {
    this.dt = 1 / rate; this.hold = 0; this.gain = 0; this.releasing = false;
    this.left = this.right = 0; this.x = this.y = .5; this.phase = 0;
    this.attack = 1 - Math.exp(-this.dt / .035);
    this.release = 1 - Math.exp(-this.dt / .22);
    this.cancelRelease = 1 - Math.exp(-this.dt / .025);
    this.noiseStates = new Uint32Array([0x7f63a1, 0x531bb7, 0x349fc5]);
    this.pink0 = new Float64Array(3); this.pink1 = new Float64Array(3); this.pink2 = new Float64Array(3);
    this.brown = new Float64Array(3);
  }
  trigger() { this.hold = .16; this.releasing = false; }
  cancel() { this.hold = 0; this.releasing = true; }
  noise(stream, color) {
    let state = this.noiseStates[stream]; state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    this.noiseStates[stream] = state >>> 0;
    const white = (state >>> 0) / 0x80000000 - 1;
    this.pink0[stream] = .99765 * this.pink0[stream] + white * .099046;
    this.pink1[stream] = .963 * this.pink1[stream] + white * .2965164;
    this.pink2[stream] = .57 * this.pink2[stream] + white * 1.0526913;
    const pink = (this.pink0[stream] + this.pink1[stream] + this.pink2[stream] + white * .1848) * .085;
    this.brown[stream] = Math.max(-1, Math.min(1, (this.brown[stream] + white * .018) / 1.006));
    const blend = color < -.5 ? (color + 1) * 2 : (color + .5) * 2;
    return color < -.5 ? this.brown[stream] * 2.6 * (1 - blend) + pink * blend : pink * (1 - blend) + white * blend;
  }
  next(controls, enabled) {
    if (!enabled) this.cancel();
    this.hold = Math.max(0, this.hold - this.dt);
    const active = enabled && this.hold > 0;
    this.gain += ((active ? 1 : 0) - this.gain) * (active ? this.attack : this.releasing ? this.cancelRelease : this.release);
    if (this.gain < 1e-7) { this.gain = 0; this.left = this.right = 0; return; }
    this.x += (controls.fabricX - this.x) * this.attack; this.y += (controls.fabricY - this.y) * this.attack;
    const pull = Math.max(0, Math.min(1, Number(controls.fabricPull) || 0));
    const velocity = Math.max(0, Math.min(1, Number(controls.fabricVelocity) || 0));
    const color = -.9 + this.y * .7 + pull * .18;
    const common = this.noise(0, color) * .824621125;
    const a = common + this.noise(1, color) * .565685425, b = common + this.noise(2, color) * .565685425;
    this.phase = (this.phase + TAU * (.7 + this.x * 1.4) * this.dt) % TAU;
    const gust = (.84 + Math.sin(this.phase) * .16) * (1 + velocity * .55 + pull * .24);
    this.left = Math.tanh(a * 1.8) * .085 * this.gain * gust * (1.25 - this.x * .5);
    this.right = Math.tanh(b * 1.8) * .085 * this.gain * gust * (.75 + this.x * .5);
  }
}

/** A finite electrical tear after the complete mix, including existing flight
 * echoes and filtered wind. One reusable capture buffer; no performer clock changes. */
export class WitchEyeShock {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.age = 2; this.envelope = 0;
    this.release = 1; this.releasing = false; this.pending = false; this.random = 0x672ac;
    this.bufferL = new Float32Array(Math.ceil(rate * .09)); this.bufferR = new Float32Array(this.bufferL.length);
    this.write = 0; this.phase = 0; this.lowL = this.lowR = 0; this.left = this.right = 0;
  }
  trigger() {
    if (this.age < 1.5 && this.release > 0) { this.pending = true; this.releasing = true; }
    else { this.age = 0; this.release = 1; this.releasing = false; }
  }
  cancel() { this.releasing = true; this.pending = false; }
  next(left, right, enabled) {
    this.bufferL[this.write] = left; this.bufferR[this.write] = right;
    this.write = (this.write + 1) % this.bufferL.length;
    if (!enabled) this.cancel();
    if (this.releasing) this.release = Math.max(0, this.release - this.dt / .035);
    if (this.release === 0 && this.pending && enabled) { this.pending = false; this.age = 0; this.release = 1; this.releasing = false; }
    this.envelope = this.age < 1.5 ? Math.min(1, this.age / .012) * Math.max(0, 1 - this.age / 1.5) ** .65 * this.release : 0;
    if (this.envelope <= 0) {
      this.left = left; this.right = right; this.age += this.dt; return;
    }
    const t = this.age; this.age += this.dt;
    this.phase += (29 + 430 * Math.exp(-t * 5)) * this.dt * TAU;
    let r = this.random; r ^= r << 13; r ^= r >>> 17; r ^= r << 5; this.random = r | 0;
    const noise = (r >>> 0) / 2147483648 - 1;
    const lag = Math.round(this.rate * (.004 + .04 * Math.sin(t * 31.7) ** 2));
    const read = (this.write - lag + this.bufferL.length) % this.bufferL.length;
    const ring = Math.sin(this.phase), burst = .2 + .8 * Math.sin(t * 83) ** 8;
    this.lowL += .18 * (left - this.lowL); this.lowR += .18 * (right - this.lowR);
    const crackle = noise * burst * .026;
    const tornL = Math.tanh((left - this.lowL + this.bufferL[read] * ring * .85 + crackle) * 2.6) * .38;
    const tornR = Math.tanh((right - this.lowR + this.bufferR[read] * -ring * .85 + crackle) * 2.6) * .38;
    const mix = this.envelope * .8;
    this.left = left * (1 - mix) + tornL * mix; this.right = right * (1 - mix) + tornR * mix;
  }
}
