// Freeze Point lattice: a grid of damped resonators coupled to their
// neighbours. Coupling only transfers energy between sites that are close in
// frequency, so raising disorder detunes neighbours apart and transfer
// collapses — producing a threshold rather than a gradual dulling.
class FreezePointProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    this.side = Math.max(2, Math.min(12, Math.round(o.side ?? 8)));
    this.count = this.side * this.side;
    this.freq = new Float32Array(this.count);
    this.offset = new Float32Array(o.offsets ?? new Float32Array(this.count));
    this.base = new Float32Array(o.base ?? new Float32Array(this.count));
    // Two-pole resonator state per site.
    this.y1 = new Float32Array(this.count);
    this.y2 = new Float32Array(this.count);
    this.drive = new Float32Array(this.count);
    this.energy = new Float32Array(this.count);
    this.disorder = 0.4;
    this.coupling = 0.55;
    this.damping = 2.4;
    this.running = false;
    this.inputSite = Math.floor(this.count / 2);
    this.inputGain = 0;
    this.frame = 0;
    this.recomputeCoefficients();
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m || typeof m !== "object") return;
    if (m.type === "param") {
      for (const k of ["disorder", "coupling", "damping", "inputGain"]) {
        if (Number.isFinite(m[k])) this[k] = m[k];
      }
      if (Number.isInteger(m.inputSite)) this.inputSite = Math.max(0, Math.min(this.count - 1, m.inputSite));
      if (typeof m.running === "boolean") this.running = m.running;
      this.recomputeCoefficients();
    } else if (m.type === "strike") {
      const i = Math.max(0, Math.min(this.count - 1, m.index | 0));
      this.drive[i] += Math.max(0, Math.min(1, m.amp ?? 1));
    } else if (m.type === "silence") {
      this.y1.fill(0); this.y2.fill(0); this.drive.fill(0); this.energy.fill(0);
    }
  }

  recomputeCoefficients() {
    for (let i = 0; i < this.count; i += 1) {
      const hz = this.base[i] * (2 ** (this.offset[i] * this.disorder * 0.5));
      this.freq[i] = Math.max(20, Math.min(sampleRate * 0.45, hz));
    }
  }

  neighbourTransfer(i, j) {
    const ratio = this.freq[j] / Math.max(1e-6, this.freq[i]);
    const detune = Math.abs(Math.log2(Math.max(1e-6, ratio)));
    const width = Math.max(1e-4, this.coupling * 0.35);
    const overlap = 1 / (1 + (detune / width) ** 2);
    return this.coupling * overlap * 0.18;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    const input = inputs[0]?.[0] ?? null;
    const n = L.length;
    if (!this.running) { L.fill(0); if (R !== L) R.fill(0); return true; }

    const side = this.side;
    const decay = Math.exp(-1 / (Math.max(0.05, this.damping) * sampleRate));
    const spread = new Float32Array(this.count);

    for (let s = 0; s < n; s += 1) {
      if (input && this.inputGain > 0) this.drive[this.inputSite] += input[s] * this.inputGain;

      let sumL = 0, sumR = 0;
      spread.fill(0);
      for (let i = 0; i < this.count; i += 1) {
        const w = 2 * Math.PI * this.freq[i] / sampleRate;
        const r = decay;
        const a1 = 2 * r * Math.cos(w);
        const a2 = -r * r;
        const y = a1 * this.y1[i] + a2 * this.y2[i] + this.drive[i];
        this.y2[i] = this.y1[i];
        this.y1[i] = y;
        this.drive[i] = 0;
        const mag = Math.abs(y);
        this.energy[i] = this.energy[i] * 0.999 + mag * 0.001;
        const pan = (i % side) / Math.max(1, side - 1);
        sumL += y * (1 - pan);
        sumR += y * pan;
      }
      // Couple neighbours after the site update so transfer is symmetric.
      for (let i = 0; i < this.count; i += 1) {
        const x = i % side, yy = (i / side) | 0;
        if (x < side - 1) { const t = this.neighbourTransfer(i, i + 1) * this.y1[i]; spread[i + 1] += t; spread[i] -= t; }
        if (yy < side - 1) { const t = this.neighbourTransfer(i, i + side) * this.y1[i]; spread[i + side] += t; spread[i] -= t; }
      }
      for (let i = 0; i < this.count; i += 1) this.drive[i] += spread[i];

      const norm = 1 / Math.sqrt(this.count);
      L[s] = Math.tanh(sumL * norm * 0.6);
      R[s] = Math.tanh(sumR * norm * 0.6);
    }

    this.frame += 1;
    if (this.frame % 6 === 0) {
      this.port.postMessage({ type: "energy", energy: Array.from(this.energy) });
    }
    return true;
  }
}
registerProcessor("morphazoid-freeze-point", FreezePointProcessor);
