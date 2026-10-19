// Rezoidinator source shaping and optional processing. Modal and FFT branches
// remain independent; the room has a separate diffused delay network per bus.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const SIGNAL_DEFAULTS = Object.freeze({ bodyEnabled: true, processingEnabled: false,
  resynthesisEnabled: false, reverbEnabled: false, bodyMix: 1, resynthesisMix: .94, wetMix: 1,
  filterType: 'lowpass', filterFrequency: 8000, drive: 1, reverbTime: 1.8,
  reverbDamping: .45, reverbMix: .4 });
export const SIGNAL_LIMITS = Object.freeze({ bodyMix: [0, 1], resynthesisMix: [0, 1], wetMix: [0, 1],
  filterFrequency: [20, 20000], drive: [1, 24], reverbTime: [.12, 12],
  reverbDamping: [0, .98], reverbMix: [0, 1] });
export const FILTER_TYPES = Object.freeze(['lowpass', 'highpass', 'bandpass', 'bypass']);
export const EXCITATION_TYPES = Object.freeze(['impulse', 'white-noise', 'pink-noise', 'pluck', 'soft-mallet', 'hard-mallet']);
export const EXCITATION_DEFAULTS = Object.freeze({ kind: 'pluck', strength: .8, durationMs: 18 });
export const EXCITATION_LIMITS = Object.freeze({ strength: [0, 1.5], durationMs: [1, 300] });
const ENABLE_KEYS = ['bodyEnabled', 'processingEnabled', 'resynthesisEnabled', 'reverbEnabled'];
export function sanitizeSignalSettings(value = {}) {
  const settings = {};
  for (const key of ENABLE_KEYS) settings[key] = value[key] === undefined ? SIGNAL_DEFAULTS[key] : Boolean(value[key]);
  for (const [key, [low, high]] of Object.entries(SIGNAL_LIMITS)) settings[key] = clamp(finite(value[key], SIGNAL_DEFAULTS[key]), low, high);
  settings.filterType = FILTER_TYPES.includes(value.filterType) ? value.filterType : SIGNAL_DEFAULTS.filterType;
  return settings;
}
export function sanitizeExcitation(value = {}) {
  return { kind: EXCITATION_TYPES.includes(value.kind) ? value.kind : EXCITATION_DEFAULTS.kind,
    strength: clamp(finite(value.strength, EXCITATION_DEFAULTS.strength), 0, 1.5),
    durationMs: clamp(finite(value.durationMs, EXCITATION_DEFAULTS.durationMs), 1, 300) };
}

/** Eight overlapping force events, allocated at construction. Shapes describe
 * the contact force/noise, not a claim to model the complete struck object. */
export class ExcitationSource {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate; this.next = 0; this.seed = 0x12345678;
    this.age = new Int32Array(8); this.length = new Int32Array(8);
    this.kind = new Uint8Array(8); this.level = new Float64Array(8);
    this.pinkA = new Float64Array(8); this.pinkB = new Float64Array(8); this.pinkC = new Float64Array(8);
    this.lowpass = new Float64Array(8);
  }
  reset() {
    this.next = 0; this.seed = 0x12345678; this.length.fill(0); this.age.fill(0);
    this.pinkA.fill(0); this.pinkB.fill(0); this.pinkC.fill(0); this.lowpass.fill(0);
  }
  trigger(value) {
    const settings = sanitizeExcitation(value), index = this.next;
    this.next = (index + 1) % 8; this.age[index] = 0;
    this.kind[index] = EXCITATION_TYPES.indexOf(settings.kind);
    this.length[index] = settings.kind === 'impulse' ? 1 : Math.max(2, Math.round(settings.durationMs * this.sampleRate / 1000));
    // Similar burst energy across durations: expanding a force event does not
    // multiply its total energy by hundreds. The sharper mallet compensates
    // for its short effective contact within the selected event duration.
    const n = this.length[index], kind = this.kind[index];
    this.level[index] = settings.strength * (kind === 0 ? 1 : kind === 5 ? Math.min(6, 24 / Math.sqrt(n)) : Math.min(1, 6 / Math.sqrt(n)));
    this.pinkA[index] = this.pinkB[index] = this.pinkC[index] = this.lowpass[index] = 0;
  }
  noise() {
    let seed = this.seed; seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    this.seed = seed | 0; return (seed >>> 0) / 2147483648 - 1;
  }
  nextSample() {
    let result = 0;
    for (let index = 0; index < 8; index++) {
      const n = this.length[index], age = this.age[index];
      if (age >= n) continue;
      const kind = this.kind[index], t = age / Math.max(1, n - 1);
      let value;
      if (kind === 0) value = 1;
      else if (kind === 4) value = Math.sin(Math.PI * t) ** 2;
      else if (kind === 5) value = Math.sin(Math.PI * t) * Math.exp(-8 * t);
      else {
        const white = this.noise();
        if (kind === 2) {
          // Three differently damped poles approximate a pink excitation tilt.
          this.pinkA[index] = .997 * this.pinkA[index] + .03 * white;
          this.pinkB[index] = .95 * this.pinkB[index] + .12 * white;
          this.pinkC[index] = .6 * this.pinkC[index] + .4 * white;
          value = this.pinkA[index] + this.pinkB[index] + this.pinkC[index] + .15 * white;
        } else if (kind === 3) {
          this.lowpass[index] += .35 * (white - this.lowpass[index]); value = this.lowpass[index];
        } else value = white;
        const attack = Math.min(1, age / Math.max(1, Math.min(n * .08, this.sampleRate * .0008)));
        value *= attack * (kind === 3 ? Math.exp(-6 * t) * (1 - t) : Math.sin(Math.PI * t));
      }
      result += value * this.level[index]; this.age[index] = age + 1;
    }
    return clamp(result, -2, 2);
  }
}

/** Four mutually mixed feedback delays per independent output bus. A
 * Householder matrix is lossless; damping and RT60 gains make each loop decay.
 * Fixed incommensurate lengths avoid live delay jumps and pitch modulation. */
export class DiffusedRoom {
  constructor(sampleRate = 48000, channels = 18) {
    this.sampleRate = sampleRate; this.channels = channels;
    this.remaining = new Float64Array(channels); this.tailLength = 0;
    this.lines = Array.from({ length: channels * 4 }, (_, index) => {
      const channel = Math.floor(index / 4), line = index % 4;
      const seconds = [.0297, .0371, .0411, .0437][line] * (1 + channel * .017);
      return new Float32Array(Math.max(2, Math.round(sampleRate * seconds)));
    });
    this.positions = new Uint32Array(channels * 4); this.feedback = new Float64Array(channels * 4);
    this.feedbackTarget = new Float64Array(channels * 4); this.memory = new Float64Array(channels * 4);
    this.values = new Float64Array(4); this.damping = SIGNAL_DEFAULTS.reverbDamping;
    this.dampingTarget = this.damping; this.step = 1 - Math.exp(-1 / (sampleRate * .025));
    this.configure(SIGNAL_DEFAULTS, true);
  }
  configure(settings, immediate = false) {
    this.dampingTarget = settings.reverbDamping;
    this.tailLength = Math.ceil(this.sampleRate * (settings.reverbTime * 2 + .5));
    for (let i = 0; i < this.lines.length; i++) this.feedbackTarget[i] = Math.exp(-Math.log(1000) * this.lines[i].length / (this.sampleRate * settings.reverbTime));
    if (immediate) { this.feedback.set(this.feedbackTarget); this.damping = this.dampingTarget; }
  }
  reset() { for (const line of this.lines) line.fill(0); this.positions.fill(0); this.memory.fill(0); this.remaining.fill(0); }
  advance() { this.damping += (this.dampingTarget - this.damping) * this.step; }
  process(channel, input) {
    if (Math.abs(input) > 1e-12) this.remaining[channel] = this.tailLength;
    else if (this.remaining[channel] <= 0) return 0;
    else this.remaining[channel]--;
    const offset = channel * 4;
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const index = offset + i, sample = this.lines[index][this.positions[index]];
      const value = sample * (1 - this.damping) + this.memory[index] * this.damping;
      this.values[i] = this.memory[index] = Math.abs(value) < 1e-20 ? 0 : value; sum += value;
    }
    for (let i = 0; i < 4; i++) {
      const index = offset + i, line = this.lines[index];
      this.feedback[index] += (this.feedbackTarget[index] - this.feedback[index]) * this.step;
      // H = I - 2uuᵀ for u=(1,1,1,1)/2; injection/listening vectors differ.
      line[this.positions[index]] = clamp(finite((this.values[i] - sum * .5) * this.feedback[index] + input * (i % 2 ? -.35 : .35)), -4, 4);
      this.positions[index] = (this.positions[index] + 1) % line.length;
    }
    return (this.values[0] + this.values[1] - this.values[2] - this.values[3]) * .7;
  }
}

/** Smoothed live mix/filter state. All sample/block storage is allocated once. */
export class SignalPath {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate; this.settings = { ...SIGNAL_DEFAULTS };
    this.excitation = new ExcitationSource(sampleRate); this.room = new DiffusedRoom(sampleRate);
    this.step = 1 - Math.exp(-1 / (sampleRate * .02));
    this.bodyMix = 1; this.fftMix = 0; this.wetMix = 1; this.processingMix = 0; this.reverbMix = 0;
    this.drive = 1; this.g = Math.tan(Math.PI * Math.min(8000, sampleRate * .45) / sampleRate);
    this.gTarget = this.g; this.ic1 = 0; this.ic2 = 0;
    this.composite = new Float64Array(18);
    this.filterWeights = new Float64Array([1, 0, 0, 0]); this.filterTarget = this.filterWeights.slice();
  }
  configure(value, immediate = false) {
    this.settings = sanitizeSignalSettings(value);
    this.gTarget = Math.tan(Math.PI * Math.min(this.settings.filterFrequency, this.sampleRate * .45) / this.sampleRate);
    this.filterTarget.fill(0); this.filterTarget[FILTER_TYPES.indexOf(this.settings.filterType)] = 1;
    this.room.configure(this.settings, immediate);
    if (immediate) {
      this.bodyMix = this.settings.bodyEnabled ? this.settings.bodyMix : 0;
      this.fftMix = this.settings.resynthesisEnabled ? this.settings.resynthesisMix : 0;
      this.processingMix = Number(this.settings.processingEnabled); this.wetMix = this.settings.wetMix;
      this.reverbMix = this.settings.reverbEnabled ? this.settings.reverbMix : 0;
      this.drive = this.settings.drive; this.g = this.gTarget; this.filterWeights.set(this.filterTarget);
    }
  }
  reset() { this.excitation.reset(); this.room.reset(); this.ic1 = this.ic2 = 0; this.configure(this.settings, true); }
  processSource(raw) {
    const s = this.settings, step = this.step;
    this.processingMix += (Number(s.processingEnabled) - this.processingMix) * step;
    this.drive += (s.drive - this.drive) * step; this.g += (this.gTarget - this.g) * step;
    for (let i = 0; i < 4; i++) this.filterWeights[i] += (this.filterTarget[i] - this.filterWeights[i]) * step;
    const denominator = 1 + this.g * (this.g + Math.SQRT2);
    const v1 = (this.ic1 + this.g * (raw - this.ic2)) / denominator;
    const low = this.ic2 + this.g * v1;
    this.ic1 = clamp(finite(2 * v1 - this.ic1), -8, 8); this.ic2 = clamp(finite(2 * low - this.ic2), -8, 8);
    const high = raw - Math.SQRT2 * v1 - low;
    const filtered = low * this.filterWeights[0] + high * this.filterWeights[1]
      + v1 * Math.SQRT2 * this.filterWeights[2] + raw * this.filterWeights[3];
    const saturated = Math.tanh(filtered * this.drive) / Math.tanh(this.drive);
    const driven = filtered + (saturated - filtered) * Math.min(1, this.drive - 1);
    return raw + (driven - raw) * this.processingMix;
  }
  advanceMix() {
    const s = this.settings, step = this.step;
    this.bodyMix += ((s.bodyEnabled ? s.bodyMix : 0) - this.bodyMix) * step;
    this.fftMix += ((s.resynthesisEnabled ? s.resynthesisMix : 0) - this.fftMix) * step;
    this.wetMix += (s.wetMix - this.wetMix) * step;
    this.reverbMix += ((s.reverbEnabled ? s.reverbMix : 0) - this.reverbMix) * step;
    this.room.advance();
  }
  mix(channel, raw, processed, modal, spectral, roomSend = 0) {
    const body = processed + (modal - processed) * this.bodyMix;
    const combined = body + (spectral - body) * this.fftMix;
    this.composite[channel] = combined;
    const room = this.room.process(channel, this.settings.reverbEnabled || this.reverbMix > 1e-6 ? combined + roomSend : 0);
    const wet = combined + (room - combined) * this.reverbMix;
    return finite(raw + (wet - raw) * this.wetMix);
  }
}
