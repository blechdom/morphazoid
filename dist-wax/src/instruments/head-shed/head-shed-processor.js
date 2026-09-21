// Head Shed: one circular tape, many independently positioned heads.
// Heads do not move the tape; the tape moves past them, as on real hardware.
const TAU = Math.PI * 2;

class HeadShedProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions ?? {};
    this.capacity = Math.max(1, Math.floor((opts.maxSeconds ?? 8) * sampleRate));
    this.tape = new Float32Array(this.capacity);
    this.length = Math.max(1, Math.floor((opts.seconds ?? 4) * sampleRate));
    this.phase = 0;          // tape position in samples, fractional
    this.speed = 1;          // tape speed multiplier
    this.heads = [];         // {id, kind, pos01, level, pan}
    this.retain = 1;         // 1 = sound-on-sound, 0 = wipe behind record head
    this.writeLevel = 0.9;
    this.genLoss = 0.12;     // per-pass saturation + HF loss amount
    this.hp = 0;             // one-pole state for generation loss
    this.running = false;
    this.rotorOnly = false;  // one play head at a time
    this.rotorIndex = 0;
    this.lastLap = 0;
    this.frame = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "heads") this.heads = Array.isArray(msg.heads) ? msg.heads : [];
    else if (msg.type === "param") {
      if (Number.isFinite(msg.speed)) this.speed = Math.max(0.1, Math.min(4, msg.speed));
      if (Number.isFinite(msg.retain)) this.retain = Math.max(0, Math.min(1, msg.retain));
      if (Number.isFinite(msg.writeLevel)) this.writeLevel = Math.max(0, Math.min(1.5, msg.writeLevel));
      if (Number.isFinite(msg.genLoss)) this.genLoss = Math.max(0, Math.min(1, msg.genLoss));
      if (typeof msg.running === "boolean") this.running = msg.running;
      if (typeof msg.rotorOnly === "boolean") this.rotorOnly = msg.rotorOnly;
      if (Number.isFinite(msg.seconds)) {
        const next = Math.max(1, Math.min(this.capacity, Math.floor(msg.seconds * sampleRate)));
        if (next !== this.length) { this.length = next; this.phase = this.phase % this.length; }
      }
    } else if (msg.type === "clear") this.tape.fill(0);
    else if (msg.type === "rotorReset") this.rotorIndex = 0;
  }

  readTape(pos) {
    const n = this.length;
    let p = pos % n; if (p < 0) p += n;
    const i0 = Math.floor(p);
    const i1 = (i0 + 1) % n;
    const f = p - i0;
    return this.tape[i0] * (1 - f) + this.tape[i1] * f;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] ?? out[0];
    const input = inputs[0]?.[0] ?? null;
    const n = left.length;

    if (!this.running) {
      left.fill(0); if (right !== left) right.fill(0);
      return true;
    }

    const playHeads = this.heads.filter((h) => h.kind === "play");
    const recHeads = this.heads.filter((h) => h.kind === "record");
    const eraseHeads = this.heads.filter((h) => h.kind === "erase");
    const activePlay = this.rotorOnly && playHeads.length
      ? [playHeads[this.rotorIndex % playHeads.length]]
      : playHeads;
    const norm = activePlay.length > 1 ? 1 / Math.sqrt(activePlay.length) : 1;

    for (let i = 0; i < n; i += 1) {
      const before = this.phase;
      // Erase heads wipe the tape they sit on, before any record head writes.
      for (let e = 0; e < eraseHeads.length; e += 1) {
        const idx = Math.floor((eraseHeads[e].pos01 * this.length + this.phase)) % this.length;
        const k = idx < 0 ? idx + this.length : idx;
        this.tape[k] *= (1 - Math.max(0, Math.min(1, eraseHeads[e].level)));
      }
      // Record heads write live input, mixed with what is already there.
      if (input && recHeads.length) {
        const x = input[i] ?? 0;
        for (let r = 0; r < recHeads.length; r += 1) {
          const idx = Math.floor((recHeads[r].pos01 * this.length + this.phase)) % this.length;
          const k = idx < 0 ? idx + this.length : idx;
          const prev = this.tape[k] * this.retain;
          // Generation loss: gentle saturation, not a clean multiply.
          const mixed = prev + x * this.writeLevel * Math.max(0, Math.min(1, recHeads[r].level));
          this.tape[k] = Math.tanh(mixed * (1 + this.genLoss)) / (1 + this.genLoss);
        }
      }
      // Play heads read.
      let l = 0, rr = 0;
      for (let p = 0; p < activePlay.length; p += 1) {
        const h = activePlay[p];
        const v = this.readTape(h.pos01 * this.length + this.phase) * Math.max(0, Math.min(1, h.level)) * norm;
        const pan = Math.max(-1, Math.min(1, h.pan ?? 0));
        l += v * Math.cos((pan + 1) * Math.PI / 4);
        rr += v * Math.sin((pan + 1) * Math.PI / 4);
      }
      left[i] = l; right[i] = rr;

      this.phase += this.speed;
      if (this.phase >= this.length) {
        this.phase -= this.length;
        this.lastLap += 1;
        if (this.rotorOnly && playHeads.length) this.rotorIndex = (this.rotorIndex + 1) % playHeads.length;
      }
      if (before > this.phase) { /* wrapped */ }
    }

    this.frame += 1;
    if (this.frame % 8 === 0) {
      this.port.postMessage({
        type: "snapshot",
        phase01: this.phase / this.length,
        lap: this.lastLap,
        rotorIndex: this.rotorIndex,
      });
    }
    return true;
  }
}

registerProcessor("morphazoid-head-shed", HeadShedProcessor);
