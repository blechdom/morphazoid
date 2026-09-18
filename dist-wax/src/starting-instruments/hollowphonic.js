import { Core, clamp, TAU } from "./common.js";
export const HOLLOW_DEFAULTS = Object.freeze({ depth: 0.56, loss: 0.4, coupling: 0.3, mix: 0.85, source: 1 });
export const HOLLOW_PRESETS = Object.freeze({
  "Breathing chambers": { ...HOLLOW_DEFAULTS },
  "Glass hallway": { depth: 0.24, loss: 0.13, coupling: 0.72, mix: 1, source: 1 },
  "Soft wood": { depth: 0.8, loss: 0.76, coupling: 0.12, mix: 0.82, source: 2 },
  "Strike the wall": { depth: 0.5, loss: 0.23, coupling: 0.55, mix: 1, source: 0 },
});
/**
 * Three damped delay-line resonators. Coupling is a convex mixture of identity
 * and cyclic permutation (non-amplifying); reflection is always < 1.
 * A playable waveguide approximation, not the quantum Baldin sum rule.
 */
export class Hollowphonic extends Core {
  constructor(rate = 48000) {
    super(rate, HOLLOW_DEFAULTS);
    this.tubes = Array.from({ length: 3 }, () => new Float32Array(Math.ceil(rate / 40)));
    this.positions = [0, 0, 0]; this.lengths = [1, 1, 1];
    this.targetLengths = [1, 1, 1];
    this.offsets = [0, 0.13, -0.17]; this.energy = [0, 0, 0];
    this.inject = [0, 0, 0]; this.filtered = [0, 0, 0];
    this.seed = 917; this.dc = 0; this.bypass = false;
    this.strikeDecay = Math.exp(-1 / (rate * 0.008));
    this.slew = 1 - Math.exp(-1 / (rate * 0.03));
    this.currentMix = HOLLOW_DEFAULTS.mix;
    this.set(HOLLOW_DEFAULTS);
    this.lengths = [...this.targetLengths];
  }
  set(p) {
    for (const key of ["depth", "loss", "coupling", "mix"]) if (key in p) this.params[key] = clamp(p[key], 0, 1, HOLLOW_DEFAULTS[key]);
    if ("source" in p) this.params.source = Math.round(clamp(p.source, 0, 3, 1));
    for (let i = 0; i < 3; i++) {
      const depth = clamp(this.params.depth + this.offsets[i]);
      // A longer visible cavity corresponds to a longer delay/lower resonance.
      this.targetLengths[i] = clamp(this.rate / (1050 * 2 ** (-depth * 3)), 2, this.tubes[i].length - 2);
    }
  }
  command(m) {
    super.command(m);
    const i = Math.round(clamp(m.index, 0, 2));
    if (m.type === "strike") this.inject[i] = clamp(m.velocity, 0.05, 0.6, 0.5);
    if (m.type === "cavity") { this.offsets[i] = clamp(m.offset, -0.4, 0.4); this.set({}); }
    if (m.type === "bypass") this.bypass = Boolean(m.value);
    if (m.type === "reset") {
      this.offsets = [0, 0.13, -0.17]; this.set(HOLLOW_DEFAULTS);
      this.bypass = false;
      this.tubes.forEach((t) => t.fill(0)); this.filtered.fill(0); this.inject.fill(0); this.energy.fill(0);
    }
  }
  advance(dt) {
    if (this.playing) this.time += dt;
    const slew = 1 - Math.exp(-dt / 0.03);
    for (let i = 0; i < 3; i++) this.lengths[i] += (this.targetLengths[i] - this.lengths[i]) * slew;
  }
  tick(input = 0) {
    if (this.playing) this.time += 1 / this.rate;
    let x = this.seed | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0;
    const noise = this.seed / 2147483648 - 1;
    let source = 0;
    if (this.playing) {
      if (this.params.source === 1) source = noise * 0.15;
      if (this.params.source === 2) source = (Math.sin(TAU * 110 * this.time) + 0.4 * Math.sin(TAU * 220 * this.time)) * 0.12;
      if (this.params.source === 3) source = clamp(input, -0.9, 0.9, 0) * 0.7;
    }
    const read = this.filtered;
    // Read all cavities before writing any cross-coupled feedback.
    for (let i = 0; i < 3; i++) {
      this.lengths[i] += (this.targetLengths[i] - this.lengths[i]) * this.slew;
      const data = this.tubes[i], len = this.lengths[i];
      let pos = (this.positions[i] - len + data.length) % data.length;
      const j = Math.floor(pos); pos -= j;
      const sample = data[j] * (1 - pos) + data[(j + 1) % data.length] * pos;
      read[i] += (sample - read[i]) * (0.2 + (1 - this.params.loss) * 0.7);
    }
    const g = 0.965 - this.params.loss * 0.45, c = this.params.coupling * 0.7;
    let wet = 0;
    for (let i = 0; i < 3; i++) {
      const data = this.tubes[i], p = this.positions[i];
      const excitation = this.inject[i] * noise; this.inject[i] *= this.strikeDecay;
      data[p] = Math.tanh(g * ((1 - c) * read[i] + c * read[(i + 2) % 3]) + source * 0.12 + excitation * 0.3);
      this.positions[i] = (p + 1) % data.length;
      this.energy[i] += (Math.abs(read[i]) - this.energy[i]) * 0.005;
      wet += read[i] * 0.6;
    }
    // Interference of direct and resonated paths gives the spectral residue.
    const shaped = source * 0.8 - wet;
    this.currentMix += ((this.bypass ? 0 : this.params.mix) - this.currentMix) * this.slew;
    const mix = this.currentMix;
    const value = source * (1 - mix) + shaped * mix;
    this.dc += (value - this.dc) * 0.001;
    return this.output((value - this.dc) * 1.8);
  }
  snapshot() {
    return { ...super.snapshot(), offsets: [...this.offsets], lengths: this.lengths.map((n) => n / this.rate),
      frequencies: this.lengths.map((n) => this.rate / n), energy: [...this.energy], bypass: this.bypass };
  }
  restore(s) {
    super.restore(s);
    this.bypass = Boolean(s?.bypass);
    if (s?.offsets) for (let i = 0; i < 3; i++) this.offsets[i] = clamp(s.offsets[i], -0.4, 0.4);
    this.set({});
  }
}
