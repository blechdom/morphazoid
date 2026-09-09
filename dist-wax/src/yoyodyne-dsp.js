const TAU = Math.PI * 2;
const SMOOTH_KEYS = ["frequency", "spin", "energy", "speed", "friction", "tone", "pan", "pluck", "held", "angle"];
const clamp = (v, lo, hi, fallback = lo) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : fallback));
export function sanitizeSound(s = {}) {
  return { frequency: clamp(s.frequency, 45, 1600, 147), spin: clamp(s.spin, 0, 200),
    energy: clamp(s.energy, 0, 1), speed: clamp(s.speed, 0, 10),
    tension: clamp(s.tension, 0, 12), friction: clamp(s.friction, 0, 1, 0.24),
    tone: clamp(s.tone, 0, 1, 0.28), pan: clamp(s.pan, -0.95, 0.95),
    angle: clamp(s.angle, -Math.PI, Math.PI), pluck: clamp(s.pluck, 0, 1),
    held: s.held ? 1 : 0 };
}
// One continuous, rotor-modulated exciter and one damped fractional-delay string.
// Harmonic excitation is intentionally tuned to the string: sonification, not
// an acoustic claim about the sound of a nylon yo-yo or bearing.
export class KineticStringDSP {
  constructor(sampleRate = 48000) {
    this.sampleRate = clamp(sampleRate, 8000, 192000, 48000);
    this.buffer = new Float32Array(16384); this.write = 0; this.filtered = 0;
    this.phase = this.rotorPhase = this.dc = this.outputLP = 0;
    this.target = sanitizeSound({ held: 1 });
    this.current = { ...this.target };
    this.smooth = 1 - Math.exp(-1 / (this.sampleRate * 0.025));
  }
  setState(state) { this.target = sanitizeSound(state); }
  process(left, right, start = 0, end = left.length) {
    const s = this.current, t = this.target, smooth = this.smooth, rate = this.sampleRate;
    for (let i = start; i < end; i++) {
      for (const key of SMOOTH_KEYS) {
        s[key] += (t[key] - s[key]) * smooth;
      }
      const f = s.frequency;
      this.phase = (this.phase + f / rate) % 1;
      this.rotorPhase = (this.rotorPhase + s.spin / rate) % 1;
      const spinAmount = Math.min(1, s.spin / 95);
      const pulse = 0.8 + 0.2 * Math.sin(TAU * this.rotorPhase);
      const brightness = Math.min(1, 0.1 + s.tone * 0.55 + spinAmount * 0.12
        + s.speed * 0.017 + (1 + Math.cos(s.angle)) * 0.08);
      const phase = TAU * this.phase + Math.sin(TAU * this.rotorPhase) * brightness * 0.11;
      const harmonics = Math.sin(phase) + brightness * 0.22 * Math.sin(phase * 2)
        + brightness * brightness * 0.09 * Math.sin(phase * 3);
      const drive = s.energy * pulse * (0.84 + Math.min(0.16, s.speed * 0.035));
      const damping = 0.35 + (1 - s.friction) * 0.65;
      const feedback = Math.exp(-6.9078 / (f * damping)) * (1 - s.held * 0.55);
      const delay = Math.min(this.buffer.length - 2, Math.max(3, rate / f - 1));
      const read = (this.write - delay + this.buffer.length) % this.buffer.length;
      const index = Math.floor(read), fraction = read - index;
      const delayed = this.buffer[index] * (1 - fraction) + this.buffer[(index + 1) % this.buffer.length] * fraction;
      this.filtered += (delayed - this.filtered) * (0.55 + brightness * 0.25);
      const excitation = harmonics * drive * (1 - feedback) * 0.62
        + s.pluck * Math.sin(phase) * (1 - feedback) * 0.25;
      const next = Math.tanh(this.filtered * feedback + excitation);
      this.buffer[this.write] = next; this.write = (this.write + 1) % this.buffer.length;
      const voice = next * 0.85 + harmonics * drive * 0.055;
      this.outputLP += (voice - this.outputLP) * Math.min(0.8, TAU * (1700 + brightness * 3600) / rate);
      this.dc += (this.outputLP - this.dc) * 0.001;
      const output = Math.tanh((this.outputLP - this.dc) * 1.2) * 0.8;
      const panAngle = (s.pan + 1) * Math.PI / 4;
      left[i] = output * Math.cos(panAngle);
      if (right) right[i] = output * Math.sin(panAngle);
    }
  }
}
