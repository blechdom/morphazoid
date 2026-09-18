import { Core, clamp, wrap, sampleAt, demoTape, waveform } from "./common.js";

export const TAPE_DEFAULTS = Object.freeze({ speed: 1, splice: 1, departure: 0.72, landing: 0.08 });
export const TAPE_PRESETS = Object.freeze({
  "Two phrases": { ...TAPE_DEFAULTS },
  "Tiny detours": { speed: 1, splice: 1, departure: 0.28, landing: 0.1 },
  "Slow worm": { speed: 0.55, splice: 1, departure: 0.81, landing: 0.31 },
  "Original loops": { speed: 1, splice: 0, departure: 0.72, landing: 0.08 },
});
export class TapeWorm extends Core {
  constructor(rate = 48000) {
    super(rate, TAPE_DEFAULTS);
    this.phase = 0; this.tape = 0; this.transitions = 0;
    this.fading = 0; this.oldTape = 0; this.oldPhase = 0;
    this.recording = null; this.mediaVersion = 0;
    this.lastRecording = null;
    this.demo();
  }
  demo() {
    this.tapes = [demoTape(this.rate, 2, 0), demoTape(this.rate, 3, 1)];
    this.names = ["Demo · plucked phrase", "Demo · answering phrase"];
    this.envelopes = this.tapes.map((t) => waveform(t));
    this.mediaVersion++;
    this.phase = 0; this.tape = 0; this.fading = 0;
  }
  set(p) {
    for (const [key, lo, hi] of [["speed", 0.25, 2], ["departure", 0.05, 0.95], ["landing", 0, 0.85], ["splice", 0, 1]]) {
      if (key in p) this.params[key] = clamp(p[key], lo, hi, TAPE_DEFAULTS[key]);
    }
  }
  jump(tape, phase) {
    this.oldTape = this.tape; this.oldPhase = this.phase;
    this.fading = Math.max(1, Math.round(this.rate * 0.012));
    this.tape = Math.round(clamp(tape, 0, 1)); this.phase = wrap(phase);
    this.transitions++;
  }
  install(index, samples, name) {
    if (!(samples instanceof Float32Array) || samples.length < this.rate * 0.08 || samples.length > this.rate * 12) return false;
    const clean = Float32Array.from(samples, (x) => clamp(x, -0.95, 0.95, 0));
    const fade = Math.min(256, Math.floor(clean.length / 10));
    for (let i = 0; i < fade; i++) {
      clean[i] *= i / fade; clean[clean.length - 1 - i] *= i / fade;
    }
    this.tapes[index] = clean; this.names[index] = String(name ?? "Recording").slice(0, 80);
    this.envelopes[index] = waveform(clean); this.mediaVersion++;
    this.phase = wrap(this.phase); this.fading = 0;
    return true;
  }
  command(m) {
    super.command(m);
    const i = Math.round(clamp(m.index, 0, 1));
    if (m.type === "jump") this.jump(i, clamp(m.phase, 0, 1));
    if (m.type === "load") this.install(i, m.samples, m.name);
    if (m.type === "demo") { this.recording = null; this.demo(); }
    if (m.type === "record") {
      this.lastRecording = null;
      this.recording = { index: i, samples: new Float32Array(Math.round(this.rate * 12)), count: 0 };
    }
    if (m.type === "cancel-record") this.recording = null;
    if (m.type === "finish-record" && this.recording) {
      const r = this.recording; this.recording = null;
      const accepted = this.install(r.index, r.samples.slice(0, r.count), "Microphone recording");
      this.lastRecording = { index: r.index, accepted, seconds: r.count / this.rate };
    }
    if (m.type === "reset") { this.set(TAPE_DEFAULTS); this.jump(0, 0); this.transitions = 0; }
  }
  advance(dt) {
    if (!this.playing) return;
    const delta = dt * this.params.speed / (this.tapes[this.tape].length / this.rate);
    const old = this.phase;
    this.phase = wrap(old + delta);
    const gate = this.params.departure;
    const crossed = old < gate ? old + delta >= gate : old + delta >= 1 + gate;
    if (this.params.splice > 0.5 && crossed) this.jump(1 - this.tape, this.params.landing);
    this.time += dt;
  }
  tick(input = 0) {
    if (this.recording) {
      const r = this.recording;
      if (r.count < r.samples.length) r.samples[r.count++] = clamp(input, -0.95, 0.95, 0);
      // Completion is handled outside the inner render loop by the processor.
    }
    let sample = 0;
    if (this.playing) {
      sample = sampleAt(this.tapes[this.tape], this.phase);
      if (this.fading > 0) {
        const mix = this.fading / Math.max(1, Math.round(this.rate * 0.012));
        sample = sample * (1 - mix) + sampleAt(this.tapes[this.oldTape], this.oldPhase) * mix;
        this.oldPhase = wrap(this.oldPhase + this.params.speed / this.tapes[this.oldTape].length);
        this.fading--;
      }
      this.advance(1 / this.rate);
    }
    return this.output(sample, this.tape ? 0.3 : -0.3);
  }
  snapshot() {
    return { ...super.snapshot(), phase: this.phase, tape: this.tape, transitions: this.transitions,
      mediaVersion: this.mediaVersion, names: [...this.names], waves: this.envelopes,
      lastRecording: this.lastRecording,
      durations: this.tapes.map((t) => t.length / this.rate),
      recording: this.recording ? { index: this.recording.index, seconds: this.recording.count / this.rate } : null };
  }
  restore(s) {
    super.restore(s); this.phase = wrap(clamp(s?.phase, 0, 1)); this.tape = Math.round(clamp(s?.tape, 0, 1));
    this.transitions = Math.round(clamp(s?.transitions, 0, 1e9));
  }
}
