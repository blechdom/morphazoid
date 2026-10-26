import { WITCH_BITE_CLIPS } from './witch-bite-clips.js';
import { WITCH_NATIVE_BITE_VARIANTS } from './witch-bite-native-variants.js';
import { WITCH_CHARACTER_BITE_VARIANTS } from './witch-bite-character-variants.js';
import { WITCH_SOURCE_BITE_VARIANTS } from './witch-bite-source-variants.js';
import { SpiderStrings } from '../spider-synth/spider-synth-string.js';
import { SyrinxSourceEngine } from '../../families/syrinx/syrinx-source-models.js';
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
  return Object.freeze({ data, rate: clip.rate, frames: clip.frames, instrumentId: clip.instrumentId, events: clip.events, label: clip.label, source: clip.source });
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

/** All three authored sounds share fixed decoded storage across Witch engines. */
export function witchBiteVariants() {
  if (decodedVariants) return decodedVariants;
  const base = witchBiteClips();
  decodedVariants = Object.fromEntries(Object.entries(rawVariants).map(([kind, variants]) =>
    [kind, Object.freeze(variants.map((clip, index) => index === 0 || !clip ? base[kind] : decodeClip(clip)))]));
  if (decodedVariants['drop-cat']) decodedVariants['drop-quadruped'] = decodedVariants['drop-cat'];
  return Object.freeze(decodedVariants);
}

/** Two fixed PCM readers for sparse BLECH visitors. The shared clip is the
 * three extreme bundled BLACK MIDI demo passages, rendered with
 * BLECH's SoundFont engine, without using a potion slot or its solo ducking.
 * Muted events are consumed; a seek or resume never replays a stale entrance. */
export class WitchBlechFlyby {
  constructor(rate) {
    this.dt = 1 / rate; this.time = 0; this.left = this.right = 0;
    this.clips = witchBiteVariants()['drop-blech'] ?? [witchBiteClips()['drop-blech']];
    this.clip = this.clips[0]; this.nextVariant = 0;
    this.slots = Array.from({ length: 2 }, () => ({ age: -1, release: 1, releasing: false, direction: 1, clip: this.clip, variant: 0 }));
    this.nextEvent = 0; this.nextCycle = 0; this.nextAt = WITCH_BLECH_FLYBY_EVENTS[0].at;
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
  release() { for (const slot of this.slots) slot.releasing = true; }
  next(controls, enabled) {
    this.left = this.right = 0;
    const running = controls.ghostGate && controls.mode === 'flight';
    if (!running || !enabled) this.release();
    if (running && this.time >= this.nextAt) {
      if (enabled) {
        const slot = this.slots[this.nextEvent === 2 ? 1 : 0];
        slot.age = 0; slot.release = 1; slot.releasing = false;
        slot.variant = this.nextVariant; slot.clip = this.clips[this.nextVariant % this.clips.length];
        this.nextVariant = (this.nextVariant + 1) % 3;
        slot.direction = WITCH_BLECH_FLYBY_EVENTS[this.nextEvent].direction;
      }
      if (++this.nextEvent === WITCH_BLECH_FLYBY_EVENTS.length) { this.nextEvent = 0; this.nextCycle++; }
      this.nextAt = this.nextCycle * WITCH_BLECH_FLYBY_CYCLE + WITCH_BLECH_FLYBY_EVENTS[this.nextEvent].at;
    }
    for (const slot of this.slots) {
      if (slot.age < 0) continue;
      if (slot.releasing) slot.release = Math.max(0, slot.release - this.dt / .035);
      if (slot.release === 0 || slot.age >= WITCH_BLECH_FLYBY_DURATION) { slot.age = -1; continue; }
      const clip = slot.clip, position = slot.age * clip.rate, index = Math.floor(position), blend = position - index;
      const source = index + 1 < clip.frames
        ? clip.data[index] + (clip.data[index + 1] - clip.data[index]) * blend : 0;
      const envelope = Math.min(1, slot.age / .025, (WITCH_BLECH_FLYBY_DURATION - slot.age) / .08) * slot.release;
      const pan = slot.direction * (slot.age / WITCH_BLECH_FLYBY_DURATION * 2 - 1) * .9;
      const sample = source * .13 * envelope;
      this.left += sample * Math.sqrt((1 - pan) * .5);
      this.right += sample * Math.sqrt((1 + pan) * .5);
      slot.age += this.dt;
    }
    if (running) this.time += this.dt;
  }
}

export const WITCH_WEB_RATIOS = Object.freeze([1, 1.071, Math.SQRT2, 1.493, Math.sqrt(3), 2.031, Math.sqrt(5)]);
// Halfway between the original picked strings and the slower displaced silk:
// a clearer pluck still bends and rasps into pitch, at the restrained web level.
const WEB_SOUND = Object.freeze({ tune: 1, tension: 1, damping: .38, decay: 1.95,
  texture: .715, slide: .49, coupling: .08, pluckRegister: 1, pluckSpread: .93,
  pluckAttack: .0295, pluckHold: .0825, pluckRelease: 1.325 });

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

/** One native L-System phrase reader. Repeated clicks coalesce behind a short
 * fade before restarting; they never stack voices or abruptly seek live PCM.
 * Branch edits bend the existing cursor rate and pan through a 40 ms slew. */
export class WitchTreePhrase {
  constructor(rate) {
    this.dt = 1 / rate; this.clip = witchBiteClips()['tree-l-system'];
    this.age = -1; this.gain = 0; this.envelope = 0; this.left = this.right = 0;
    this.cursor = 0; this.playbackRate = this.targetRate = 1;
    this.pan = this.targetPan = 0; this.slew = 1 - Math.exp(-this.dt / .04);
    this.releasing = false; this.restart = false;
  }
  setControls(treeSpread = .5, treeCurl = .5) {
    const spread = Math.max(0, Math.min(1, Number.isFinite(Number(treeSpread)) ? Number(treeSpread) : .5));
    const curl = Math.max(0, Math.min(1, Number.isFinite(Number(treeCurl)) ? Number(treeCurl) : .5));
    this.targetRate = spread <= .5 ? .7 + spread * .6 : .6 + spread * .8;
    this.targetPan = (curl - .5) * .44;
  }
  trigger() {
    if (this.age >= 0) { this.restart = true; this.releasing = true; }
    else { this.age = 0; this.cursor = 0; this.gain = 0; this.releasing = false; }
  }
  release() { this.restart = false; this.releasing = true; }
  next(enabled) {
    this.left = this.right = this.envelope = 0;
    this.playbackRate += (this.targetRate - this.playbackRate) * this.slew;
    this.pan += (this.targetPan - this.pan) * this.slew;
    if (!enabled) this.release();
    if (this.age < 0) return;
    if (this.releasing) {
      this.gain = Math.max(0, this.gain - this.dt / (this.restart ? .008 : .035));
      if (this.gain === 0) {
        if (this.restart && enabled) { this.age = 0; this.cursor = 0; this.restart = false; this.releasing = false; }
        else { this.age = -1; return; }
      }
    } else this.gain = Math.min(1, this.gain + this.dt / .012);
    const position = this.cursor * this.clip.rate, index = Math.floor(position), blend = position - index;
    if (index + 1 >= this.clip.frames) { this.age = -1; this.gain = 0; return; }
    const sample = (this.clip.data[index] + (this.clip.data[index + 1] - this.clip.data[index]) * blend) * this.gain * .5;
    // Rotate the existing stereo balance without changing its total power.
    const cosine = Math.cos(this.pan), sine = Math.sin(this.pan);
    this.left = sample * (.58 * cosine - .82 * sine);
    this.right = sample * (.82 * cosine + .58 * sine);
    this.envelope = this.gain * Math.min(1, (this.clip.frames / this.clip.rate - this.cursor) / (this.playbackRate * .12));
    this.age += this.dt;
    this.cursor += this.dt * this.playbackRate;
  }
}

export class WitchSceneDSP {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.left = this.right = 0;
    this.tree = new WitchTreePhrase(rate);
    this.pictureAccents = new WitchPictureAccents(rate);
    this.web = new SpiderStrings(rate); this.levels = new Float64Array(8).fill(1);
    this.active = 0; this.gain = 0; this.groanAge = 2; this.groan = 0; this.low = 0;
    this.webControl = 0; this.webLowL = this.webLowR = 0;
    this.webLowpass = 1 - Math.exp(-TAU * 1250 / rate);
    this.groanRelease = 1; this.groanReleasing = false;
    this.attack = 1 - Math.exp(-this.dt / .006); this.release = 1 - Math.exp(-this.dt / .035);
    this.source = new SyrinxSourceEngine({ sampleRate: rate, seed: 0x4a61, model: 'twoMass', parameters: {
      frequencyHz: 57, pressure: .83, tension: .2, adduction: .91, breath: .23, roughness: .72,
      asymmetry: .4, sourceScale: .8, sourceBalance: .48, coupling: .5, feedback: .4, outputGain: .65, pulseRateHz: 14,
    } });
  }
  trigger(kind) {
    if (this.pictureAccents.trigger(kind)) return true;
    if (kind === 'tree-l-system') { this.tree.trigger(); return true; }
    if (/^web-[0-6]$/.test(kind)) {
      const index = Number(kind.at(-1));
      this.web.pluck(69 * WITCH_WEB_RATIOS[index], .66, (index - 3) / 4, WEB_SOUND, 6, index, 1, .19, null, 1, true, 0, -1, true);
      this.active = 2.8; return true;
    }
    if (kind === 'spider-groan') {
      this.groanAge = 0; this.groanRelease = 1; this.groanReleasing = false;
      this.active = Math.max(this.active, 1.7); return true;
    }
    return false;
  }
  releaseAll() { this.active = 0; this.web.release(); this.groanReleasing = true; this.tree.release(); this.pictureAccents.release(); }
  next(enabled) {
    this.active = Math.max(0, this.active - this.dt);
    const active = enabled && this.active > 0;
    this.gain += ((active ? 1 : 0) - this.gain) * (active ? this.attack : this.release);
    if (this.webControl-- <= 0) {
      this.webControl = 31;
      for (const voice of this.web.voices) if (voice.remaining > 0) {
        const age = voice.age / this.rate;
        const strain = 1 + .0525 * Math.sin(age * 17.3 + voice.segmentId) * Math.exp(-age * 1.5)
          + .013 * Math.sin(age * 83.1);
        voice.targetPeriod = Math.max(3, Math.min(4092, this.rate / (voice.frequency * strain) - voice.loss));
      }
    }
    this.web.sample(this.levels, .47, WEB_SOUND);
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
