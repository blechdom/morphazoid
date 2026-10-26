import { WITCH_BITE_CLIPS } from './witch-bite-clips.js';
import { SpiderStrings } from '../spider-synth/spider-synth-string.js';
import { SyrinxSourceEngine } from '../../families/syrinx/syrinx-source-models.js';

const TAU = Math.PI * 2;
let decodedClips;

/** Fixed PCM bank, decoded once at Audio arm. No fetch, base64 browser globals,
 * source instrument, or allocation is needed at a trigger or render boundary. */
export function witchBiteClips() {
  if (decodedClips) return decodedClips;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  decodedClips = Object.fromEntries(Object.entries(WITCH_BITE_CLIPS).map(([kind, clip]) => {
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
    return [kind, Object.freeze({ data, rate: clip.rate, frames: clip.frames, instrumentId: clip.instrumentId, events: clip.events })];
  }));
  return Object.freeze(decodedClips);
}

export const WITCH_WEB_RATIOS = Object.freeze([1, 1.071, Math.SQRT2, 1.493, Math.sqrt(3), 2.031, Math.sqrt(5)]);
const WEB_SOUND = Object.freeze({ tune: 1, tension: 1, damping: .18, decay: 1.7,
  texture: .49, slide: .08, coupling: .08, pluckRegister: 5, pluckSpread: 1,
  pluckAttack: .004, pluckHold: .025, pluckRelease: 1.2 });

export class WitchSceneDSP {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate; this.left = this.right = 0;
    this.web = new SpiderStrings(rate); this.levels = new Float64Array(8).fill(1);
    this.active = 0; this.gain = 0; this.groanAge = 2; this.groan = 0; this.low = 0;
    this.groanRelease = 1; this.groanReleasing = false;
    this.attack = 1 - Math.exp(-this.dt / .006); this.release = 1 - Math.exp(-this.dt / .035);
    this.source = new SyrinxSourceEngine({ sampleRate: rate, seed: 0x4a61, model: 'twoMass', parameters: {
      frequencyHz: 57, pressure: .83, tension: .2, adduction: .91, breath: .23, roughness: .72,
      asymmetry: .4, sourceScale: .8, sourceBalance: .48, coupling: .5, feedback: .4, outputGain: .65, pulseRateHz: 14,
    } });
  }
  trigger(kind) {
    if (/^web-[0-6]$/.test(kind)) {
      const index = Number(kind.at(-1));
      this.web.pluck(71 * WITCH_WEB_RATIOS[index], .8, (index - 3) / 4, WEB_SOUND, 6, index, index % 3, .28, null, 1, true, 0, -1, true);
      this.active = 2.8; return true;
    }
    if (kind === 'spider-groan') {
      this.groanAge = 0; this.groanRelease = 1; this.groanReleasing = false;
      this.active = Math.max(this.active, 1.7); return true;
    }
    return false;
  }
  releaseAll() { this.active = 0; this.web.release(); this.groanReleasing = true; }
  next(enabled) {
    this.active = Math.max(0, this.active - this.dt);
    const active = enabled && this.active > 0;
    this.gain += ((active ? 1 : 0) - this.gain) * (active ? this.attack : this.release);
    this.web.sample(this.levels, .7, WEB_SOUND);
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
    this.left = (this.web.left * 1.8 + this.groan) * this.gain;
    this.right = (this.web.right * 1.8 + this.groan * .8) * this.gain;
    if (this.gain < 1e-9) this.groanAge = 2;
  }
}

/** A finite electrical tear after the complete mix, including existing flight
 * echoes and Fabric. One reusable capture buffer; no performer clock changes. */
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
