import { Core, Voices, TAU, clamp, wrap, signedPhase } from "./common.js";

export const TEMPO_DEFAULTS = Object.freeze({ tempo: 120, strength: 0.32, detune: 0.09, decay: 0.22, driver: 0.22 });
export const TEMPO_PRESETS = Object.freeze({
  "Soft agreement": { ...TEMPO_DEFAULTS },
  "On the edge": { tempo: 145, strength: 0.12, detune: 0.18, decay: 0.12, driver: 0.2 },
  "No manners": { tempo: 170, strength: 0.04, detune: 0.42, decay: 0.08, driver: 0.12 },
  "Slow recovery": { tempo: 80, strength: 0.19, detune: 0.08, decay: 0.6, driver: 0.1 },
});

/**
 * Classical driven-phase model, NOT a quantum time crystal.
 * In cycles: theta' = f/q * (1 + delta + K sin(2pi(phi-q theta))).
 * phi' = f. For fixed parameters, a stable phase relation is possible when
 * |delta| < K. Crossings of theta, not divided clock ticks, excite voices.
 */
export class TempoTantrum extends Core {
  constructor(rate = 48000) {
    super(rate, TEMPO_DEFAULTS);
    this.voices = new Voices(rate, 4);
    this.ratios = [2, 3, 4];
    this.resetClock();
  }
  resetClock() {
    this.driverPhase = 0;
    this.phases = [0.11, 0.33, 0.71];
    this.offsets = [0, -0.03, 0.04];
    this.errorSpeed = [1, 1, 1];
    this.flashes = [0, 0, 0];
    this.hits = [0, 0, 0];
    this.driveHits = 0;
    this.time = 0;
    this.voices.clear();
  }
  set(p) {
    for (const [k, lo, hi] of [["tempo", 40, 240], ["strength", 0, 0.9], ["detune", -0.6, 0.6], ["decay", 0.04, 0.8], ["driver", 0, 0.5]]) {
      if (k in p) this.params[k] = clamp(p[k], lo, hi, TEMPO_DEFAULTS[k]);
    }
  }
  command(m) {
    super.command(m);
    const i = Math.round(clamp(m.index, 0, 2));
    if (m.type === "nudge") {
      this.phases[i] = wrap(this.phases[i] + clamp(m.amount, -0.45, 0.45, 0.22));
      this.errorSpeed[i] = 1;
    }
    if (m.type === "body") {
      if (m.phase !== undefined) this.phases[i] = wrap(clamp(m.phase, 0, 1));
      if (m.offset !== undefined) this.offsets[i] = clamp(m.offset, -0.45, 0.45);
      this.errorSpeed[i] = 1;
    }
    if (m.type === "reset") { this.set(TEMPO_DEFAULTS); this.resetClock(); }
  }
  advance(dt) {
    if (!this.playing) return;
    // Subdivide caller time so the silent preview follows the same ODE.
    const steps = Math.max(1, Math.ceil(dt * 480));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      const f = this.params.tempo / 60;
      const oldDriver = this.driverPhase;
      this.driverPhase = wrap(this.driverPhase + f * h);
      if (this.driverPhase < oldDriver) {
        this.driveHits++;
        this.voices.hit(3, 960, this.params.driver, 0.028);
      }
      for (let i = 0; i < 3; i++) {
        const old = this.phases[i], q = this.ratios[i];
        const delta = clamp(this.params.detune + this.offsets[i], -0.75, 0.9);
        const error = TAU * (this.driverPhase - q * old);
        const speed = Math.max(0.01, f / q * (1 + delta + this.params.strength * Math.sin(error)));
        this.phases[i] = wrap(old + speed * h);
        // A measured relative phase velocity, not "locked because K is high".
        const slip = Math.abs(f - q * speed) / Math.max(f, 0.1);
        this.errorSpeed[i] += (slip - this.errorSpeed[i]) * (1 - Math.exp(-h * 3));
        this.flashes[i] *= Math.exp(-h * 7);
        if (Math.floor(old + speed * h) > 0) {
          this.hits[i]++;
          this.flashes[i] = 1;
          this.voices.hit(i, [98, 196, 293.665][i], 0.7, this.params.decay);
        }
      }
      this.time += h;
    }
  }
  tick() {
    this.advance(1 / this.rate);
    return this.output(this.voices.tick());
  }
  snapshot() {
    return { ...super.snapshot(), driverPhase: this.driverPhase, phases: [...this.phases],
      offsets: [...this.offsets], hits: [...this.hits], driveHits: this.driveHits,
      flashes: [...this.flashes], slip: [...this.errorSpeed],
      errors: this.phases.map((p, i) => signedPhase(this.driverPhase - this.ratios[i] * p)),
      locked: this.errorSpeed.map((v) => this.time > 2 && this.params.strength > 0.005 && v < 0.018) };
  }
  restore(s) {
    super.restore(s);
    this.driverPhase = wrap(clamp(s?.driverPhase, 0, 1));
    this.driveHits = Math.round(clamp(s?.driveHits, 0, 1e9));
    for (let i = 0; i < 3; i++) {
      this.phases[i] = wrap(clamp(s?.phases?.[i], 0, 1));
      this.offsets[i] = clamp(s?.offsets?.[i], -0.45, 0.45);
      this.hits[i] = clamp(s?.hits?.[i], 0, 1e9);
      this.errorSpeed[i] = clamp(s?.slip?.[i], 0, 10, 1);
    }
  }
}
