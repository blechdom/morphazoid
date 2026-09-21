// Crab Loom tape: a circular buffer read by two heads, where crossing the seam
// applies an involution. An odd-twist band therefore has a two-lap period.
class CrabLoomProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    this.capacity = Math.max(1, Math.floor((o.maxSeconds ?? 10) * sampleRate));
    this.lane = [new Float32Array(this.capacity), new Float32Array(this.capacity)];
    this.length = Math.max(1, Math.floor((o.seconds ?? 4) * sampleRate));
    this.phase = 0;
    this.speed = 1;
    this.halfTwists = 1;
    this.involution = "retrograde";
    this.seam = 0;
    this.headOffset = 0.5;
    this.hocket = 0;        // 0 = both heads sound, 1 = strict alternation
    this.writeLevel = 0.9;
    this.retain = 1;
    this.recording = 0;
    this.running = false;
    this.hocketPhase = 0;
    this.frame = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m || typeof m !== "object") return;
    if (m.type === "param") {
      for (const k of ["speed", "halfTwists", "seam", "headOffset", "hocket", "writeLevel", "retain"]) {
        if (Number.isFinite(m[k])) this[k] = m[k];
      }
      if (typeof m.involution === "string") this.involution = m.involution;
      if (typeof m.running === "boolean") this.running = m.running;
      if (typeof m.recording === "boolean") this.recording = m.recording ? 1 : 0;
      if (Number.isFinite(m.seconds)) {
        const next = Math.max(1, Math.min(this.capacity, Math.floor(m.seconds * sampleRate)));
        if (next !== this.length) { this.length = next; this.phase %= this.length; }
      }
    } else if (m.type === "clear") { this.lane[0].fill(0); this.lane[1].fill(0); }
    else if (m.type === "load" && m.channel) {
      const src = m.channel;
      const n = Math.min(this.capacity, src.length);
      this.length = Math.max(1, n);
      this.lane[0].fill(0); this.lane[1].fill(0);
      for (let i = 0; i < n; i += 1) this.lane[0][i] = src[i];
      // The second lane holds the same take shifted, so a lane swap is audible.
      for (let i = 0; i < n; i += 1) this.lane[1][i] = src[(i + Math.floor(n / 3)) % n];
      this.phase = 0;
    }
  }

  oneSided() { return Math.abs(Math.round(this.halfTwists)) % 2 === 1; }

  read(laneIndex, pos) {
    const n = this.length;
    let p = pos % n; if (p < 0) p += n;
    const i0 = Math.floor(p);
    const i1 = (i0 + 1) % n;
    const f = p - i0;
    const buf = this.lane[laneIndex];
    return buf[i0] * (1 - f) + buf[i1] * f;
  }

  // Apply the involution for stage 1 (the flipped face).
  sample(stage, pos, channel) {
    const n = this.length;
    if (stage === 0) return { v: this.read(0, pos), ch: channel };
    switch (this.involution) {
      case "retrograde":
      case "table":
        return { v: this.read(0, n - 1 - (pos % n)), ch: channel };
      case "lane":
        return { v: this.read(1, pos), ch: channel };
      case "polarity":
        return { v: -this.read(0, pos), ch: channel };
      case "stereo":
        return { v: this.read(0, pos), ch: 1 - channel };
      case "inversion":
        // Amplitude mirror: a cheap, audible stand-in for pitch inversion.
        return { v: -this.read(0, pos), ch: channel };
      case "tritone":
        return { v: this.read(0, pos * 1.4142135623730951), ch: channel };
      default:
        return { v: this.read(0, pos), ch: channel };
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    const input = inputs[0]?.[0] ?? null;
    const n = L.length;
    if (!this.running) { L.fill(0); if (R !== L) R.fill(0); return true; }

    const laps = this.oneSided() ? 2 : 1;
    const period = this.length * laps;

    for (let i = 0; i < n; i += 1) {
      if (input && this.recording) {
        const idx = Math.floor(this.phase) % this.length;
        const prev = this.lane[0][idx] * this.retain;
        this.lane[0][idx] = Math.tanh(prev + input[i] * this.writeLevel);
      }
      const headA = this.phase;
      const headB = this.phase + this.headOffset * period;
      const stageA = laps === 2 ? (Math.floor(headA / this.length) % 2) : 0;
      const stageB = laps === 2 ? (Math.floor(headB / this.length) % 2) : 0;
      const a = this.sample(stageA, headA % this.length, 0);
      const b = this.sample(stageB, headB % this.length, 1);

      // Hocket gate: at 1 the two heads strictly alternate, so one line is split
      // across its own transform instead of sounding against it.
      let ga = 1, gb = 1;
      if (this.hocket > 0) {
        const slot = Math.floor(this.hocketPhase) % 2;
        const hard = this.hocket;
        ga = slot === 0 ? 1 : 1 - hard;
        gb = slot === 1 ? 1 : 1 - hard;
      }
      const la = a.ch === 0 ? a.v * ga : 0;
      const ra = a.ch === 1 ? a.v * ga : 0;
      const lb = b.ch === 0 ? b.v * gb : 0;
      const rb = b.ch === 1 ? b.v * gb : 0;
      L[i] = (la + lb) * 0.7;
      R[i] = (ra + rb) * 0.7;

      this.phase += this.speed;
      this.hocketPhase += this.speed / Math.max(1, this.length / 8);
      if (this.phase >= period) this.phase -= period;
    }

    this.frame += 1;
    if (this.frame % 8 === 0) {
      this.port.postMessage({
        type: "snapshot",
        phase01: (this.phase / this.length) % laps,
        laps,
      });
    }
    return true;
  }
}
registerProcessor("morphazoid-crab-loom", CrabLoomProcessor);
