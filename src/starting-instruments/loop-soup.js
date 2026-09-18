import { Core, clamp, wrap, demoTape, waveform, TAU } from "./common.js";
const LEFT = [0.6, 0.45, 0.25], RIGHT = [0.25, 0.45, 0.6];

export const SOUP_DEFAULTS = Object.freeze({ retention: 0.87, feed: 0.38, spill: 0.18, demo: 1 });
export const SOUP_PRESETS = Object.freeze({
  "Gentle simmer": { ...SOUP_DEFAULTS },
  "Thick broth": { retention: 0.98, feed: 0.3, spill: 0.45, demo: 1 },
  "Quick rinse": { retention: 0.38, feed: 0.65, spill: 0.06, demo: 1 },
  "Listen to the pot": { retention: 1, feed: 0, spill: 0, demo: 0 },
});
export class LoopSoup extends Core {
  constructor(rate = 48000) {
    super(rate, SOUP_DEFAULTS);
    this.phases = [0, 0, 0]; this.positions = [0, 0, 0];
    this.modes = ["overdub", "overdub", "overdub"];
    this.previous = new Float64Array(3);
    this.mediaVersion = 0;
    this.demo();
  }
  demo() {
    this.buffers = [0.75, 1.2, 1.8].map((d, i) => demoTape(this.rate, d, i % 2));
    this.positions = [0, 0, 0]; this.previous.fill(0); this.mediaVersion++;
  }
  set(p) {
    for (const [key, lo, hi] of [["retention", 0, 1], ["feed", 0, 0.9], ["spill", 0, 0.7], ["demo", 0, 1]]) {
      if (key in p) this.params[key] = clamp(p[key], lo, hi, SOUP_DEFAULTS[key]);
    }
  }
  command(m) {
    super.command(m);
    const i = Math.round(clamp(m.index, 0, 2));
    if (m.type === "mode" && ["hold", "overdub"].includes(m.value)) this.modes[i] = m.value;
    if (m.type === "clear") { this.buffers[i].fill(0); this.previous[i] = 0; this.mediaVersion++; }
    if (m.type === "erase") {
      const data = this.buffers[i], center = clamp(m.phase, 0, 1);
      for (let j = 0; j < data.length; j++) {
        if (Math.abs(wrap(j / data.length - center + 0.5) - 0.5) < 0.045) data[j] = 0;
      }
      this.mediaVersion++;
    }
    if (m.type === "demo") this.demo();
    if (m.type === "reset") {
      this.set(SOUP_DEFAULTS);
      // Reset parameters never releases a protected (held) tape.
    }
  }
  advance(dt) {
    if (!this.playing) return;
    this.time += dt;
    for (let i = 0; i < 3; i++) this.positions[i] = (this.positions[i] + Math.round(dt * this.rate)) % this.buffers[i].length;
  }
  tick(input = 0) {
    if (!this.playing) return this.output(0);
    this.time += 1 / this.rate;
    const local = this.time % 0.6;
    const demo = this.params.demo > 0.5 && local < 0.16
      ? Math.sin(TAU * (146.83 + 73.415 * (Math.floor(this.time / 0.6) % 3)) * local) * Math.sin(Math.PI * local / 0.16) ** 2 * 0.26 : 0;
    const incoming = clamp(input, -1, 1, 0) + demo;
    let left = 0, right = 0;
    // Previous-frame spill avoids an instantaneous algebraic feedback cycle.
    const old0 = this.previous[0], old1 = this.previous[1], old2 = this.previous[2];
    for (let i = 0; i < 3; i++) {
      const data = this.buffers[i], p = this.positions[i], stored = data[p];
      const neighbor = i === 0 ? old2 : i === 1 ? old0 : old1;
      if (this.modes[i] === "overdub") {
        data[p] = 0.9 * Math.tanh((stored * this.params.retention +
          incoming * this.params.feed + neighbor * this.params.spill) / 0.9);
      }
      this.previous[i] = stored;
      this.positions[i] = (p + 1) % data.length;
      left += stored * LEFT[i];
      right += stored * RIGHT[i];
    }
    this.out[0] = Math.tanh(left * 0.55); this.out[1] = Math.tanh(right * 0.55);
    return this.out;
  }
  snapshot() {
    return { ...super.snapshot(), phases: this.positions.map((p, i) => p / this.buffers[i].length),
      modes: [...this.modes], waves: this.buffers.map((b) => waveform(b, 72)),
      energy: this.buffers.map((b) => {
        let sum = 0;
        for (let i = 0; i < b.length; i += 97) sum += b[i] * b[i];
        return Math.sqrt(sum / Math.ceil(b.length / 97));
      }), mediaVersion: this.mediaVersion };
  }
  restore(s) {
    super.restore(s);
    for (let i = 0; i < 3; i++) {
      this.positions[i] = Math.floor(clamp(s?.phases?.[i], 0, 0.99999) * this.buffers[i].length);
      this.modes[i] = s?.modes?.[i] === "hold" ? "hold" : "overdub";
      // Only the first Audio arm transfers the silent preview's edited tape.
      // Regular 20 Hz snapshots never include these sample arrays.
      const source = s?.tapeData?.[i];
      if (!(source instanceof Float32Array) || source.length < 80 || source.length > 192000 * 2) continue;
      const target = this.buffers[i];
      for (let j = 0; j < target.length; j++) {
        const pos = j / target.length * source.length, a = Math.floor(pos), mix = pos - a;
        target[j] = clamp(source[a] * (1 - mix) + source[(a + 1) % source.length] * mix, -0.9, 0.9, 0);
      }
    }
  }
}
