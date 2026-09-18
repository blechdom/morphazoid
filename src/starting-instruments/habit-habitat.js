import { Core, Voices, clamp, wrap } from "./common.js";
export const HABIT_DEFAULTS = Object.freeze({ tempo: 112, follow: 0.88, learning: 0.45, decay: 0.24 });
export const HABIT_PRESETS = Object.freeze({
  "Remember the route": { ...HABIT_DEFAULTS },
  "Wander": { tempo: 90, follow: 0.1, learning: 0.3, decay: 0.48 },
  "Strong habits": { tempo: 155, follow: 1, learning: 0.9, decay: 0.12 },
  "Slow recollection": { tempo: 64, follow: 0.7, learning: 0.2, decay: 0.7 },
});
export class HabitHabitat extends Core {
  constructor(rate = 48000) {
    super(rate, HABIT_DEFAULTS);
    this.voices = new Voices(rate, 6);
    this.weights = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => i === j ? 0 : 0.25));
    this.mode = "recall"; this.head = 0; this.phase = 0; this.seed = 917;
    this.lastTaught = null; this.previousNode = 0; this.visits = 0;
    this.flash = new Float64Array(6);
    this.teachDemo();
  }
  teachDemo() {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) this.weights[i][j] = i === j ? 0 : 0.25;
    for (const [a, b] of [[0, 2], [2, 5], [5, 1], [1, 4], [4, 3], [3, 0]]) this.weights[a][b] = 6;
  }
  set(p) {
    for (const [key, lo, hi] of [["tempo", 35, 240], ["follow", 0, 1], ["learning", 0.05, 1], ["decay", 0.04, 0.8]]) {
      if (key in p) this.params[key] = clamp(p[key], lo, hi, HABIT_DEFAULTS[key]);
    }
  }
  visit(i, velocity = 0.7) {
    this.previousNode = this.head; this.head = i; this.flash[i] = 1; this.visits++;
    this.voices.hit(i, [130.813, 164.814, 196, 261.626, 329.628, 392][i], velocity, this.params.decay);
  }
  recall() {
    let x = this.seed | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0;
    const row = this.weights[this.head], total = row.reduce((a, b) => a + b, 0);
    let pick = this.seed / 4294967296;
    for (let j = 0; j < 6; j++) {
      if (j === this.head) continue;
      pick -= (1 - this.params.follow) / 5 + this.params.follow * row[j] / total;
      if (pick <= 0 || j === 5) { this.visit(j); return; }
    }
    this.visit((this.head + 1) % 6);
  }
  command(m) {
    super.command(m);
    if (m.type === "mode" && ["teach", "recall"].includes(m.value)) { this.mode = m.value; this.lastTaught = null; }
    const i = Math.round(clamp(m.index, 0, 5));
    if (m.type === "visit") {
      if (this.mode === "teach" && this.lastTaught !== null && this.lastTaught !== i) {
        const row = this.weights[this.lastTaught];
        row[i] = Math.min(12, row[i] + this.params.learning * 3);
      }
      this.lastTaught = i; this.visit(i, clamp(m.velocity, 0.05, 0.8, 0.7));
    }
    if (m.type === "forget") {
      const to = Math.round(clamp(m.to, 0, 5));
      if (i !== to) this.weights[i][to] = Math.max(0.25, this.weights[i][to] * 0.3);
    }
    if (m.type === "clear") {
      this.weights = this.weights.map((r, a) => r.map((_, b) => a === b ? 0 : 0.25));
      this.lastTaught = null;
    }
    if (m.type === "memory") {
      const rows = m.weights;
      if (Array.isArray(rows) && rows.length === 6 && rows.every((r) => Array.isArray(r) && r.length === 6 && r.every(Number.isFinite))) {
        this.weights = rows.map((r, a) => r.map((v, b) => a === b ? 0 : clamp(v, 0.25, 12)));
      }
    }
    if (m.type === "demo") this.teachDemo();
    if (m.type === "reset") {
      this.set(HABIT_DEFAULTS); this.head = 0; this.phase = 0; this.seed = 917; this.lastTaught = null; this.voices.clear();
      this.mode = "recall"; this.previousNode = 0; this.visits = 0; this.flash.fill(0);
    }
  }
  advance(dt) {
    for (let i = 0; i < 6; i++) this.flash[i] *= Math.exp(-dt * 6);
    if (!this.playing || this.mode !== "recall") return;
    const phase = this.phase + dt * this.params.tempo / 60;
    for (let n = 0; n < Math.min(8, Math.floor(phase)); n++) this.recall();
    this.phase = wrap(phase); this.time += dt;
  }
  tick() { this.advance(1 / this.rate); return this.output(this.voices.tick(), (this.head / 5 - 0.5) * 0.8); }
  snapshot() {
    return { ...super.snapshot(), weights: this.weights.map((r) => [...r]), head: this.head,
      previousNode: this.previousNode, phase: this.phase, mode: this.mode, visits: this.visits, flash: Array.from(this.flash), seed: this.seed };
  }
  restore(s) {
    super.restore(s); this.phase = wrap(clamp(s?.phase, 0, 1)); this.head = Math.round(clamp(s?.head, 0, 5));
    if (s?.mode === "teach") this.mode = "teach";
    if (s?.weights) this.command({ type: "memory", weights: s.weights });
    this.seed = clamp(s?.seed, 1, 4294967295, 917);
    this.visits = Math.round(clamp(s?.visits, 0, 1e9));
    this.previousNode = Math.round(clamp(s?.previousNode, 0, 5));
    this.lastTaught = this.mode === "teach" && this.visits > 0 ? this.head : null;
  }
}
