// Loopini's shared tape clock and non-destructive recording. No browser globals.
export const LOOPINI_LIMITS = Object.freeze({ slots: 6, minSeconds: 0.5, maxSeconds: 12, minSpeed: 0.5, maxSpeed: 2 });
export const clamp = (n, lo, hi, fallback = lo) => Math.max(lo, Math.min(hi, Number.isFinite(Number(n)) ? Number(n) : fallback));
export const slotId = (n) => Number.isInteger(n) && n >= 0 && n < LOOPINI_LIMITS.slots;

export function loopEnvelope(frame, length, rate) {
  const fade = Math.min(Math.round(rate * 0.006), length / 8);
  return clamp(Math.min(frame / fade, (length - 1 - frame) / fade), 0, 1);
}
export function loopiniMix(value) { return Math.tanh(value * 0.6) * 0.82; }
export function readLoop(samples, frame) {
  const position = ((frame % samples.length) + samples.length) % samples.length;
  const index = Math.floor(position), fraction = position - index;
  return samples[index] + (samples[(index + 1) % samples.length] - samples[index]) * fraction;
}
export function addLoopSample(previous, incoming) {
  if (incoming === 0) return previous;
  const sum = previous + incoming, magnitude = Math.abs(sum);
  // Linear with headroom, soft-knee bounded near the rails for repeated layers.
  return magnitude <= 0.85 ? sum : Math.sign(sum) * (0.85 + 0.15 * Math.tanh((magnitude - 0.85) / 0.15));
}
const emptySlot = () => ({ samples: null, on: true, gain: 0, waveform: [] });
function advancePhase(phase, speed, length) {
  const next = (phase + speed) % length;
  // Decimal knob values must not leave a clock numerically just below a wrap.
  return length - next < length * 1e-9 ? 0 : next;
}

export class Loopini {
  constructor(rate = 48000) {
    this.rate = Math.round(clamp(rate, 8000, 192000, 48000));
    this.maxFrames = Math.round(this.rate * LOOPINI_LIMITS.maxSeconds);
    this.slots = Array.from({ length: LOOPINI_LIMITS.slots }, emptySlot);
    this.length = 0; this.phase = 0; this.playing = false; this.recording = null;
    this.speed = this.currentSpeed = 1;
    this.undoState = null; this.notice = "empty"; this.revision = 0; this.meter = 0;
    this.smoothing = 1 - Math.exp(-1 / (this.rate * 0.009));
    this.speedSmoothing = 1 - Math.exp(-1 / (this.rate * 0.015));
    this.dcInput = 0; this.dcOutput = 0; this.tail = null;
  }
  filled() { return this.slots.filter((s) => s.samples).length; }
  saveUndo() { this.undoState = { length: this.length, slots: this.slots.map((s) => ({ ...s, gain: 0 })) }; }
  fadeOld() {
    this.tail = { slots: this.slots.filter((s) => s.samples && s.gain > 0.001).map((s) => ({ ...s })),
      phase: this.phase, length: this.length, left: Math.ceil(this.rate * 0.01), total: Math.ceil(this.rate * 0.01) };
  }
  setSpeed(value) {
    if (this.recording) return false;
    this.speed = clamp(value, LOOPINI_LIMITS.minSpeed, LOOPINI_LIMITS.maxSpeed, 1);
    if (!this.playing) this.currentSpeed = this.speed;
    return true;
  }
  record(id, mode = "replace") {
    if (!slotId(id) || this.recording || !["replace", "add"].includes(mode)) return false;
    if (mode === "add" && !this.slots[id].samples) return false;
    // Freeze tape speed for this take. No buffer/time stretching after recording.
    this.currentSpeed = this.speed;
    let wait = this.length ? Math.ceil((this.length - this.phase) / this.speed) : 0;
    if (wait && wait < this.rate * 0.3) wait = Math.ceil((2 * this.length - this.phase) / this.speed);
    const fade = Math.max(1, Math.round(this.rate * 0.006 * this.speed));
    this.recording = { id, mode, speed: this.speed, samples: new Float32Array(this.length || this.maxFrames),
      old: mode === "add" ? this.slots[id].samples : null, recent: new Float32Array(fade), fade,
      count: 0, written: 0, start: null, frames: 0, previous: 0, wait, energy: 0 };
    if (this.length) this.playing = true;
    this.dcInput = this.dcOutput = 0;
    this.notice = this.length ? "ready" : "recording"; this.revision++;
    return true;
  }
  writeSample(r, value) {
    const index = r.written++, added = value * Math.min(1, index / r.fade);
    r.recent[index % r.fade] = added;
    r.samples[index] = r.old ? addLoopSample(r.old[index], added) : added;
  }
  finish() {
    const r = this.recording;
    if (!r) return false;
    this.recording = null; this.meter = 0;
    const end = Math.min(r.samples.length, Math.round((r.start ?? 0) + r.count * r.speed));
    if (r.wait || r.count === 0 || (!this.length ? end < this.rate * LOOPINI_LIMITS.minSeconds
      : r.count < Math.min(this.rate * LOOPINI_LIMITS.minSeconds, r.frames))) {
      this.notice = "cancelled"; this.revision++; return false;
    }
    if (Math.sqrt(r.energy / r.count) < 0.001) {
      this.notice = "quiet"; this.revision++; return false;
    }
    this.saveUndo();
    if (!this.length) { this.length = end; this.phase = 0; }
    // At most two held endpoint samples complete the streaming resampler.
    while (r.written < end) this.writeSample(r, r.previous);
    for (let i = 0; i < Math.min(r.fade, end); i++) {
      const index = end - 1 - i, added = r.recent[index % r.fade] * i / r.fade;
      r.samples[index] = r.old ? addLoopSample(r.old[index], added) : added;
    }
    // Early overdubs leave the rest of the original exactly unchanged.
    if (r.old && end < this.length) r.samples.set(r.old.subarray(end), end);
    const samples = r.samples.subarray(0, this.length);
    const gain = r.mode === "add" ? this.slots[r.id].gain : 0;
    this.slots[r.id] = { samples, on: true, gain, waveform: waveform(samples) };
    this.playing = true; this.revision++; this.notice = r.mode === "add" ? "added" : "recorded"; return true;
  }
  cancel() { if (this.recording) { this.recording = null; this.notice = "cancelled"; this.meter = 0; this.revision++; } }
  toggle(id) {
    if (!slotId(id) || !this.slots[id].samples || this.recording) return;
    this.slots[id].on = !this.slots[id].on; this.revision++; this.notice = "mix";
  }
  remove(id) {
    if (!slotId(id) || !this.slots[id].samples || this.recording) return;
    this.saveUndo(); this.fadeOld(); this.slots.forEach((s) => { s.gain = 0; });
    this.slots[id] = emptySlot();
    if (!this.filled()) { this.length = this.phase = 0; this.playing = false; }
    this.revision++; this.notice = "removed";
  }
  undo() {
    if (!this.undoState || this.recording) return;
    const previous = this.undoState;
    this.fadeOld(); this.slots = previous.slots; this.length = previous.length;
    this.phase = this.length ? this.phase % this.length : 0;
    this.undoState = null; this.revision++; this.notice = "undone";
    if (!this.length) this.playing = false;
  }
  reset() {
    this.cancel(); this.saveUndo(); this.fadeOld();
    this.slots = this.slots.map(emptySlot);
    this.length = this.phase = 0; this.playing = false; this.speed = this.currentSpeed = 1;
    this.revision++; this.notice = "empty";
  }
  setPlaying(value) {
    if (this.recording) this.cancel();
    this.playing = Boolean(value) && Boolean(this.length);
    this.notice = this.playing ? "playing" : "paused";
  }
  loadDemo() {
    if (this.filled() || this.recording) return false;
    this.saveUndo(); this.length = this.rate * 3; this.phase = 0;
    const samples = makeLoopiniDemo(this.rate);
    for (let id = 0; id < samples.length; id++) this.slots[id] = { samples: samples[id], on: true, gain: 0, waveform: waveform(samples[id]) };
    this.revision++; this.notice = "demo"; return true;
  }
  isAudible(id) {
    const slot = this.slots[id], r = this.recording;
    if (!this.playing || !slot.samples) return false;
    if (r?.id === id && r.mode === "add") return true;
    return slot.on && !(r?.id === id && r.wait === 0);
  }
  tick(input = 0) {
    const r = this.recording;
    if (r) {
      if (r.wait > 0) r.wait--;
      else {
        if (r.start === null) {
          // A boundary is observed on the first output sample after a wrap.
          // Keep the shared phase; extend the first sample over the <2-sample gap.
          r.start = this.phase;
          r.frames = Math.ceil((r.samples.length - r.start) / r.speed);
        }
        const raw = clamp(input, -1, 1, 0);
        const highpass = raw - this.dcInput + 0.995 * this.dcOutput;
        this.dcInput = raw; this.dcOutput = highpass;
        const value = Math.tanh(highpass * 1.6), position = r.start + r.count * r.speed;
        while (r.written <= position && r.written < r.samples.length) {
          const fraction = r.count ? clamp((r.written - position + r.speed) / r.speed, 0, 1) : 1;
          this.writeSample(r, r.previous + (value - r.previous) * fraction);
        }
        r.count++; r.previous = value; r.energy += value * value;
        this.meter += (Math.abs(value) - this.meter) * 0.008;
        this.notice = "recording";
      }
    }
    if (!r) {
      this.currentSpeed += (this.speed - this.currentSpeed) * this.speedSmoothing;
      if (Math.abs(this.currentSpeed - this.speed) < 1e-10) this.currentSpeed = this.speed;
    }
    let mix = 0;
    for (let id = 0; id < this.slots.length; id++) {
      const slot = this.slots[id];
      slot.gain += ((this.isAudible(id) ? 1 : 0) - slot.gain) * this.smoothing;
      if (slot.samples) mix += readLoop(slot.samples, this.phase) * slot.gain * loopEnvelope(this.phase, this.length, this.rate);
    }
    if (this.tail) {
      const tail = this.tail;
      for (const slot of tail.slots) mix += readLoop(slot.samples, tail.phase) * slot.gain * (tail.left / tail.total) * loopEnvelope(tail.phase, tail.length, this.rate);
      tail.phase = advancePhase(tail.phase, this.currentSpeed, Math.max(1, tail.length));
      if (--tail.left <= 0) this.tail = null;
    }
    const out = loopiniMix(mix);
    if (this.playing && this.length) this.phase = advancePhase(this.phase, this.currentSpeed, this.length);
    if (r && r.frames && r.count >= r.frames) this.finish();
    return out;
  }
  snapshot() {
    const r = this.recording;
    return { version: 1, rate: this.rate, length: this.length, seconds: this.length / this.rate,
      speed: this.speed, currentSpeed: this.currentSpeed, turnSeconds: this.length / this.rate / this.speed,
      phase: this.length ? this.phase / this.length : 0, playing: this.playing,
      recording: r ? { id: r.id, mode: r.mode, speed: r.speed, waiting: r.wait / this.rate, seconds: r.count / this.rate,
        progress: Math.min(1, ((r.start ?? 0) + r.count * r.speed) / r.samples.length), meter: this.meter } : null,
      slots: this.slots.map((s, id) => ({ id, filled: Boolean(s.samples), on: s.on, audible: this.isAudible(id), waveform: s.waveform })),
      canUndo: Boolean(this.undoState), notice: this.notice, revision: this.revision };
  }
}

function waveform(samples) {
  return Array.from({ length: 48 }, (_, bin) => {
    let peak = 0;
    for (let j = 0; j < 12; j++) peak = Math.max(peak, Math.abs(samples[Math.floor((bin + j / 12) * samples.length / 48)] ?? 0));
    return peak;
  });
}

/** Original untuned toy percussion; no samples, scales or network requests. */
export function makeLoopiniDemo(rate) {
  const length = rate * 3, tracks = Array.from({ length: 3 }, () => new Float32Array(length));
  let seed = 713;
  for (let i = 0; i < length; i++) {
    const t = i / rate, beat = t % 0.75, offbeat = (t + 0.375) % 0.75, shake = t % 0.1875;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = seed / 2147483648;
    tracks[0][i] = Math.sin(2 * Math.PI * (67 * beat + 3.5 * (1 - Math.exp(-beat * 38)))) * Math.exp(-beat * 19) * 0.7;
    tracks[1][i] = (Math.sin(offbeat * 2 * Math.PI * 271) + Math.sin(offbeat * 2 * Math.PI * 437) * 0.4) * Math.exp(-offbeat * 27) * 0.32;
    tracks[2][i] = noise * Math.exp(-shake * 65) * 0.26;
  }
  return tracks;
}
