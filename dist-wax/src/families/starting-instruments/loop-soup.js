import { clamp, TAU } from "./common.js";
import { LoopNetwork, MAX_LOOPS } from "./loop-network.js";
export const SOUP_DEFAULTS = Object.freeze({ retention: 0.87, feed: 0.38, spill: 0.18, demo: 1 });
export const SOUP_PRESETS = Object.freeze({
  "A": { ...SOUP_DEFAULTS },
  "B": { retention: 0.98, feed: 0.3, spill: 0.45, demo: 1 },
  "C": { retention: 0.38, feed: 0.65, spill: 0.06, demo: 1 },
  "D": { retention: 1, feed: 0, spill: 0, demo: 0 },
});
export class LoopSoup extends LoopNetwork {
  constructor(rate = 48000) {
    super(rate, SOUP_DEFAULTS, "soup");
    this.positions = []; this.previous = new Float64Array(MAX_LOOPS);
    this.sends = new Float64Array(MAX_LOOPS); this.values = new Float64Array(MAX_LOOPS);
    this.active = new Uint8Array(MAX_LOOPS); this.soloGain = new Float64Array(MAX_LOOPS);
    this.modes = []; this.lastMeterAt = -1; this.mixNorm = 0.8 / Math.sqrt(3); this.demo();
  }
  onAdd(index) { this.positions[index] = 0; this.modes[index] = "overdub"; this.previous[index] = 0; this.soloGain[index] = 0; }
  onRemove(index) {
    this.positions.splice(index, 1); this.modes.splice(index, 1);
    for (let i = index; i < MAX_LOOPS - 1; i++) {
      this.previous[i] = this.previous[i + 1]; this.soloGain[i] = this.soloGain[i + 1];
    }
    this.previous[MAX_LOOPS - 1] = 0; this.soloGain[MAX_LOOPS - 1] = 0;
  }
  onInstall(index) { this.positions[index] %= this.buffers[index].length; this.previous[index] = 0; }
  demo() {
    this.loops = []; this.buffers = []; this.routes = []; this.envelopes = []; this.energy = [];
    this.positions = []; this.modes = []; this.nextLoopId = 0; this.nextRouteId = 0; this.recording = null;
    const ids = [0.75, 1.2, 1.8].map((d) => this.addLoop(d, true));
    ids.forEach((id, i) => this.addRoute(id, ids[(i + 1) % ids.length]));
    this.previous.fill(0); this.mediaVersion++; this.lastMeterAt = -1;
  }
  set(p) {
    for (const [key, lo, hi] of [["retention", 0, 1], ["feed", 0, 0.9], ["spill", 0, 0.7], ["demo", 0, 1]]) {
      if (key in p) this.params[key] = clamp(p[key], lo, hi, SOUP_DEFAULTS[key]);
    }
  }
  command(m) {
    super.command(m);
    for (let i = 0; i < this.loops.length; i++) this.modes[i] = this.loops[i].mode;
    if (m.type === "demo") this.demo();
    if (m.type === "reset") this.set(SOUP_DEFAULTS);
  }
  advance(dt) {
    if (!this.playing) return;
    this.time += dt;
    for (let i = 0; i < this.loops.length; i++) if (!this.loops[i].paused) {
      this.positions[i] = (this.positions[i] + dt * this.rate) % this.buffers[i].length;
    }
  }
  tick(input = 0) {
    this.capture(input);
    if (this.playing) this.time += 1 / this.rate;
    const local = this.time % 0.6;
    const demo = this.params.demo > 0.5 && local < 0.16
      ? Math.sin(TAU * (146.83 + 73.415 * (Math.floor(this.time / 0.6) % 3)) * local) * Math.sin(Math.PI * local / 0.16) ** 2 * 0.26 : 0;
    const incoming = clamp(input, -1, 1, 0) + demo, count = this.loops.length;
    this.sends.fill(0);
    for (let i = 0; i < count; i++) {
      const loop = this.loops[i]; this.active[i] = this.playing && !loop.paused ? 1 : 0;
      this.positions[i] = Math.floor(this.positions[i]) % this.buffers[i].length;
      this.values[i] = this.buffers[i][this.positions[i]];
      const target = this.active[i] && !loop.muted ? loop.level : 0;
      this.loopGain[i] += (target - this.loopGain[i]) * this.gainSlew;
      this.soloGain[i] += ((!this.hasSolo || loop.solo ? 1 : 0) - this.soloGain[i]) * this.gainSlew;
    }
    for (const r of this.routes) {
      r.sendGain += ((r.enabled ? r.gain : 0) - r.sendGain) * this.gainSlew;
      r.filter += (this.previous[r.a] * this.loopGain[r.a] - r.filter) * r.alpha;
      this.sends[r.b] += r.filter * r.sendGain;
    }
    let left = 0, right = 0;
    for (let i = 0; i < count; i++) {
      const loop = this.loops[i], sample = this.values[i];
      if (this.active[i] && this.modes[i] === "overdub" && this.recording?.loopId !== loop.id) {
        const next = sample * this.params.retention + incoming * this.params.feed + this.sends[i] * this.params.spill;
        this.buffers[i][this.positions[i]] = 0.9 * Math.tanh(next / 0.9);
      }
      this.previous[i] = this.active[i] ? sample : 0;
      if (this.active[i]) this.positions[i] = (this.positions[i] + 1) % this.buffers[i].length;
      const monitor = this.loopGain[i] * this.soloGain[i];
      left += sample * monitor * this.panLeft[i]; right += sample * monitor * this.panRight[i];
    }
    this.mixNorm += (0.8 / Math.sqrt(count) - this.mixNorm) * this.gainSlew;
    this.out[0] = Math.tanh(left * this.mixNorm); this.out[1] = Math.tanh(right * this.mixNorm);
    return this.out;
  }
  snapshot() {
    if (this.time - this.lastMeterAt > 0.09 || this.lastMeterAt < 0) {
      this.loops.forEach((_, i) => this.updateWave(i)); this.lastMeterAt = this.time;
    }
    return { ...super.snapshot(), ...this.metadata(), phases: this.positions.map((p, i) => p / this.buffers[i].length), modes: [...this.modes] };
  }
  restore(s) {
    super.restore(s);
    if (this.restoreNetwork(s)) this.modes = this.loops.map((l) => l.mode);
    else if (s?.tapeData) {
      this.restoreNetwork({ ...this.snapshot(), tapeData: s.tapeData, loops: this.loops.map((l, i) => ({ ...l, mode: s.modes?.[i] ?? l.mode, duration: this.buffers[i].length / this.rate })) });
      this.modes = this.loops.map((l) => l.mode);
    }
    for (let i = 0; i < this.loops.length; i++) {
      this.positions[i] = Math.floor(clamp(s?.phases?.[i], 0, 0.99999) * this.buffers[i].length);
      if (["hold", "overdub"].includes(s?.modes?.[i])) this.loops[i].mode = this.modes[i] = s.modes[i];
    }
    this.lastMeterAt = -1;
  }
}
