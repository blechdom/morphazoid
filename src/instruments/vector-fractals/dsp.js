import { HARMONICS, TABLE_SIZE, clamp, mipSelection } from './model.js';

function sample(table, index, next, fraction) {
  return table[index] + (table[next] - table[index]) * fraction;
}

/** One shared phase, bounded table reads, no geometry construction in process(). */
export class VectorDSP {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate; this.phase = 0; this.scanPhase = 0; this.voyage = 0;
    this.frequency = 110; this.rotation = 0; this.amplitude = 0; this.monoMix = 0;
    this.playing = false; this.level = .35; this.state = {};
    this.bank = null; this.previous = null; this.pending = null; this.fade = 1; this.previousVoyage = 0;
    this.smoothing = 1 - Math.exp(-1 / (.035 * sampleRate));
    this.pair = new Float64Array(2); this.oldPair = new Float64Array(2);
  }
  setState(state) { this.state = state; }
  setBank(bank, resetMotion = false) {
    if (!bank?.frames?.length) return;
    if (this.previous) { this.pending = { bank, resetMotion: resetMotion || this.pending?.resetMotion }; return; }
    this.previousVoyage = this.voyage;
    this.previous = this.bank; this.bank = bank; this.fade = this.previous ? 0 : 1;
    if (resetMotion) this.voyage = 0;
  }
  resetMotion() { this.scanPhase = 0; this.setBank(this.bank, true); }
  read(bank, mip, mix, out, voyage = this.voyage) {
    if (!bank) { out.fill(0); return; }
    const position = voyage * bank.frames.length;
    const f0 = Math.floor(position) % bank.frames.length, f1 = (f0 + 1) % bank.frames.length, blend = position % 1;
    const a = bank.frames[f0].tables, b = bank.frames[f1].tables;
    const coarse = Math.min(mip + 1, HARMONICS.length - 1);
    const p = this.phase * TABLE_SIZE, i = Math.floor(p), j = (i + 1) & (TABLE_SIZE - 1), t = p - i;
    for (let ch = 0; ch < 2; ch++) {
      const key = ch ? 'y' : 'x';
      const af = sample(a[mip][key], i, j, t), ac = sample(a[coarse][key], i, j, t);
      const bf = sample(b[mip][key], i, j, t), bc = sample(b[coarse][key], i, j, t);
      const av = ac + (af - ac) * mix, bv = bc + (bf - bc) * mix;
      out[ch] = av + (bv - av) * blend;
    }
  }
  process(left, right) {
    const targetFrequency = clamp(this.state.pitch, 25, 1200, 110);
    // Selecting for the higher end of this block's glide never exposes an unsafe mip.
    const endFrequency = targetFrequency + (this.frequency - targetFrequency) * (1 - this.smoothing) ** left.length;
    const mip = mipSelection(Math.max(this.frequency, endFrequency), this.sampleRate);
    const targetAmplitude = this.playing && this.bank ? clamp(this.level, 0, .8, .35) : 0;
    const targetRotation = clamp(this.state.rotation, -180, 180) * Math.PI / 180;
    const speed = this.state.mode === 'voyager' ? clamp(this.state.speed, .005, .4, .06) : 0;
    for (let i = 0; i < left.length; i++) {
      this.frequency += (targetFrequency - this.frequency) * this.smoothing;
      this.amplitude += (targetAmplitude - this.amplitude) * this.smoothing;
      this.rotation += (targetRotation - this.rotation) * this.smoothing;
      this.monoMix += ((this.state.readout === 'mono' ? 1 : 0) - this.monoMix) * this.smoothing;
      this.read(this.bank, mip.index, mip.mix, this.pair);
      if (this.previous) {
        this.read(this.previous, mip.index, mip.mix, this.oldPair, this.previousVoyage);
        // Linear aligned-table fade avoids equal-power gain bumps for correlated shapes.
        const blend = this.fade * this.fade * (3 - 2 * this.fade);
        for (let ch = 0; ch < 2; ch++) this.pair[ch] = this.oldPair[ch] + (this.pair[ch] - this.oldPair[ch]) * blend;
        this.fade = Math.min(1, this.fade + 1 / (.09 * this.sampleRate));
        if (this.fade === 1) {
          this.previous = null;
          if (this.pending) { const next = this.pending; this.pending = null; this.setBank(next.bank, next.resetMotion); }
        }
      }
      const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
      const x = (this.pair[0] * cos - this.pair[1] * sin) * this.amplitude;
      const stereoY = (this.pair[0] * sin + this.pair[1] * cos) * this.amplitude;
      const y = stereoY + (x - stereoY) * this.monoMix;
      left[i] = Number.isFinite(x) ? Math.max(-.95, Math.min(.95, x)) : 0;
      right[i] = Number.isFinite(y) ? Math.max(-.95, Math.min(.95, y)) : 0;
      // Carrier remains continuous during the release; slow motion pauses with transport.
      this.phase = (this.phase + this.frequency / this.sampleRate) % 1;
      if (this.playing) {
        this.scanPhase = (this.scanPhase + this.frequency / (this.sampleRate * 256)) % 1;
        this.voyage = (this.voyage + speed / this.sampleRate) % 1;
        if (this.previous) this.previousVoyage = (this.previousVoyage + speed / this.sampleRate) % 1;
      }
    }
  }
}
