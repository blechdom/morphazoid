// Small, browser-independent DSP tools shared by the five starting instruments.
export const TAU = Math.PI * 2;
export const clamp = (x, lo = 0, hi = 1, fallback = lo) =>
  Math.min(hi, Math.max(lo, Number.isFinite(Number(x)) ? Number(x) : fallback));
export const wrap = (x) => ((x % 1) + 1) % 1;
export const signedPhase = (x) => wrap(x + 0.5) - 0.5;

export function sampleAt(buffer, phase) {
  if (!buffer?.length) return 0;
  const x = wrap(phase) * buffer.length;
  const a = Math.floor(x);
  return buffer[a] + (buffer[(a + 1) % buffer.length] - buffer[a]) * (x - a);
}

export function waveform(buffer, bins = 96) {
  const points = new Array(bins).fill(0);
  const stride = Math.max(1, Math.floor(buffer.length / 16000));
  for (let i = 0; i < buffer.length; i += stride) {
    const bin = Math.min(bins - 1, Math.floor(i / buffer.length * bins));
    points[bin] = Math.max(points[bin], Math.abs(buffer[i]));
  }
  return points;
}

/** Original synthetic phrases, no downloads or third-party samples. */
export function demoTape(rate, seconds, voice = 0) {
  const data = new Float32Array(Math.round(rate * seconds));
  const notes = voice ? [220, 330, 293.665, 164.814] : [130.813, 196, 261.626, 174.614];
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    const step = Math.floor(t / seconds * 8);
    const local = (t / seconds * 8) % 1;
    const envelope = Math.sin(Math.PI * Math.min(1, local * 10)) *
      Math.exp(-local * (voice ? 4 : 8));
    const f = notes[step % 4];
    data[i] = 0.38 * envelope * (Math.sin(TAU * f * t) +
      0.24 * Math.sin(TAU * f * 2 * t) + 0.10 * Math.sin(TAU * f * 3 * t));
  }
  return data;
}

export class Voices {
  constructor(rate, count = 6) {
    this.rate = rate;
    this.phase = new Float64Array(count);
    this.amp = new Float64Array(count);
    this.frequency = new Float64Array(count);
    this.decay = new Float64Array(count);
    this.count = count;
  }
  hit(index, frequency, strength = 0.5, seconds = 0.22) {
    const i = Math.round(clamp(index, 0, this.count - 1));
    this.frequency[i] = clamp(frequency, 30, Math.min(4000, this.rate * 0.2));
    this.amp[i] = clamp(strength, 0, 0.8);
    this.decay[i] = Math.exp(-1 / (clamp(seconds, 0.02, 2) * this.rate));
    // Do not reset oscillator phase on retrigger.
  }
  tick() {
    let value = 0;
    for (let i = 0; i < this.count; i++) {
      this.phase[i] = wrap(this.phase[i] + this.frequency[i] / this.rate);
      this.amp[i] *= this.decay[i];
      value += Math.sin(TAU * this.phase[i]) * this.amp[i] *
        (1 + 0.2 * Math.sin(TAU * this.phase[i] * 2));
    }
    return value * 0.42;
  }
  clear() { this.amp.fill(0); }
}

export class Core {
  constructor(rate, defaults) {
    this.rate = rate;
    this.params = { ...defaults };
    this.playing = false;
    this.out = new Float64Array(2);
    this.time = 0;
  }
  output(value, pan = 0) {
    const v = Math.tanh(Number.isFinite(value) ? value : 0);
    this.out[0] = v * Math.sqrt((1 - clamp(pan, -0.85, 0.85)) * 0.5);
    this.out[1] = v * Math.sqrt((1 + clamp(pan, -0.85, 0.85)) * 0.5);
    return this.out;
  }
  command(message) {
    if (message.type === "play") this.playing = Boolean(message.value);
    if (message.type === "params") this.set(message.values ?? {});
  }
  snapshot() { return { params: { ...this.params }, playing: this.playing, time: this.time }; }
  restore(s) {
    if (!s) return;
    this.playing = Boolean(s.playing);
    this.time = clamp(s.time, 0, 1e9);
  }
}
