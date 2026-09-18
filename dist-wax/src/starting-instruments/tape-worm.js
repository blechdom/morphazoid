import { clamp, wrap, sampleAt } from "./common.js";
import { LoopNetwork } from "./loop-network.js";

export const TAPE_DEFAULTS = Object.freeze({ speed: 1, splice: 1, departure: 0.72, landing: 0.08 });
export const TAPE_PRESETS = Object.freeze({
  "Two phrases": { ...TAPE_DEFAULTS },
  "Tiny detours": { speed: 1, splice: 1, departure: 0.28, landing: 0.1 },
  "Slow worm": { speed: 0.55, splice: 1, departure: 0.81, landing: 0.31 },
  "Original loops": { speed: 1, splice: 0, departure: 0.72, landing: 0.08 },
});
export class TapeWorm extends LoopNetwork {
  constructor(rate = 48000) {
    super(rate, TAPE_DEFAULTS, "tape");
    this.phase = 0; this.tape = 0; this.transitions = 0; this.fading = 0;
    this.oldBuffer = null; this.oldPhase = 0; this.routeCursor = new Map();
    this.fadeLength = 1; this.monitorGain = 0; this.demo();
  }
  get tapes() { return this.buffers; }
  get names() { return this.loops.map((l) => l.name); }
  demo() {
    this.loops = []; this.buffers = []; this.routes = []; this.envelopes = []; this.energy = [];
    this.recording = null; this.nextLoopId = 0; this.nextRouteId = 0; this.routeCursor.clear();
    const a = this.addLoop(2, true), b = this.addLoop(3, true);
    this.addRoute(a, b); this.addRoute(b, a); this.phase = 0; this.tape = 0; this.fading = 0;
    this.oldBuffer = null; this.mediaVersion++; this.transitions = 0;
  }
  set(p) {
    for (const [key, lo, hi] of [["speed", 0.25, 2], ["departure", 0.02, 0.98], ["landing", 0, 0.95], ["splice", 0, 1]]) {
      if (key in p) this.params[key] = clamp(p[key], lo, hi, TAPE_DEFAULTS[key]);
    }
    // Legacy global gate knobs remain explicit all-route edits. Route edits
    // are independent until a global gate knob/preset is deliberately applied.
    if ("departure" in p || "landing" in p) for (const route of this.routes) {
      if ("departure" in p) route.departure = this.params.departure;
      if ("landing" in p) route.landing = this.params.landing;
    }
  }
  onBeforeRemove(index) {
    if (this.tape === index) {
      this.removedFade = { buffer: this.buffers[index], phase: this.phase,
        audible: !this.loops[index].muted && (!this.hasSolo || this.loops[index].solo) };
    }
  }
  onRemove(index) {
    if (this.tape === index) {
      this.tape = Math.min(index, this.loops.length - 1); this.phase = 0;
      this.oldBuffer = this.removedFade?.buffer; this.oldPhase = this.removedFade?.phase ?? 0;
      this.oldAudible = this.removedFade?.audible ?? false;
      this.fading = this.fadeLength = Math.round(this.rate * 0.025);
      this.removedFade = null;
    }
    else if (this.tape > index) this.tape--;
  }
  onInstall(index) { if (index === this.tape) { this.phase = wrap(this.phase); this.fading = 0; } }
  jump(index, phase, fade = 0.025, count = true) {
    if (!this.loops[index]) return;
    this.oldBuffer = this.buffers[this.tape]; this.oldPhase = this.phase;
    this.oldAudible = !this.loops[this.tape]?.muted && (!this.hasSolo || this.loops[this.tape]?.solo);
    this.fadeLength = Math.max(1, Math.round(this.rate * clamp(fade, 0.005, 0.15, 0.025)));
    this.fading = this.fadeLength; this.tape = index; this.phase = wrap(phase);
    if (count) this.transitions++;
  }
  command(m) {
    super.command(m);
    const i = this.indexFor(m);
    if (m.type === "jump" && i >= 0) { this.jump(i, clamp(m.phase, 0, 1)); this.loops[i].paused = false; }
    if (m.type === "demo") this.demo();
    if (m.type === "reset") { this.set(TAPE_DEFAULTS); this.jump(0, 0); this.transitions = 0; }
  }
  advance(dt) {
    if (!this.playing || this.loops[this.tape]?.paused) return;
    let remaining = dt, guard = 0;
    while (remaining > 1e-10 && guard++ < 32) {
      const index = this.tape, speed = this.params.speed / (this.buffers[index].length / this.rate);
      let bestDistance = Infinity, chosen = null;
      const startCursor = this.routeCursor.get(this.loops[index].id) ?? 0;
      for (let j = 0; j < this.routes.length; j++) {
        const route = this.routes[(j + startCursor) % this.routes.length];
        if (this.params.splice < 0.5 || !route.enabled || route.a !== index || this.loops[route.b]?.paused) continue;
        let distance = wrap(route.departure - this.phase);
        if (distance < 1e-12) distance = 1;
        if (distance < bestDistance - 1e-8) { bestDistance = distance; chosen = route; }
      }
      if (chosen && bestDistance / speed <= remaining + 1e-10) {
        const elapsed = Math.min(remaining, bestDistance / speed);
        this.phase = wrap(this.phase + elapsed * speed); remaining -= elapsed;
        this.routeCursor.set(this.loops[index].id, (this.routes.indexOf(chosen) + 1) % this.routes.length);
        this.jump(chosen.b, chosen.landing, chosen.fade);
      } else { this.phase = wrap(this.phase + remaining * speed); remaining = 0; }
    }
    this.time += dt;
  }
  tick(input = 0) {
    this.capture(input);
    const loop = this.loops[this.tape];
    const active = this.playing && !loop.paused;
    const desired = active && !loop.muted && (!this.hasSolo || loop.solo) ? loop.level : 0;
    this.monitorGain += (desired - this.monitorGain) * this.gainSlew;
    let sample = sampleAt(this.buffers[this.tape], this.phase);
    if (this.fading > 0 && this.oldBuffer) {
      const mix = this.fading / this.fadeLength;
      sample = sample * (1 - mix) + (this.oldAudible ? sampleAt(this.oldBuffer, this.oldPhase) : 0) * mix;
      this.oldPhase = wrap(this.oldPhase + this.params.speed / this.oldBuffer.length);
      this.fading--; if (!this.fading) this.oldBuffer = null;
    }
    const output = this.output(sample * this.monitorGain, loop.pan);
    if (active) this.advance(1 / this.rate);
    return output;
  }
  snapshot() { return { ...super.snapshot(), ...this.metadata(), phase: this.phase, tape: this.tape, transitions: this.transitions }; }
  restore(s) {
    super.restore(s); this.restoreNetwork(s);
    this.phase = wrap(clamp(s?.phase, 0, 1)); this.tape = Math.round(clamp(s?.tape, 0, this.loops.length - 1));
    this.transitions = Math.round(clamp(s?.transitions, 0, 1e9));
  }
}
