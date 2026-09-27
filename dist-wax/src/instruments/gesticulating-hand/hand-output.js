export const HAND_OUTPUT_GAIN = 4;
export const HAND_OUTPUT_CEILING = .89;

/** Fixed output lift followed by a stereo-linked lookahead limiter. The original
 * synth/echo are untouched; below the ceiling this is exactly 4x plus 1.5 ms.
 * A monotonic peak queue holds each demand across the lookahead, and averaging
 * the gain over that interval gives a smooth attack before its delayed peak.
 * Gain recovery takes 80 ms. All process storage is allocated at construction. */
export class HandOutput {
  constructor(sampleRate = 48000) {
    this.sampleRate = Number.isFinite(sampleRate) ? Math.max(8000, Math.min(192000, sampleRate)) : 48000;
    this.latencyFrames = Math.max(1, Math.round(this.sampleRate * .0015));
    this.release = 1 - Math.exp(-1 / (this.sampleRate * .08));
    this.left = new Float64Array(this.latencyFrames);
    this.right = new Float64Array(this.latencyFrames);
    this.gains = new Float64Array(this.latencyFrames);
    this.peaks = new Float64Array(this.latencyFrames + 2);
    this.indices = new Float64Array(this.latencyFrames + 2);
    this.reset();
  }
  reset() {
    this.left.fill(0); this.right.fill(0); this.gains.fill(1);
    this.peaks.fill(0); this.indices.fill(0);
    this.cursor = this.head = this.tail = this.frame = 0;
    this.envelope = 1; this.gainSum = this.latencyFrames;
    this.rms = this.peak = this.gainReductionDb = 0;
  }
  process(left, right = left) {
    const frames = Math.min(left?.length ?? 0, right?.length ?? 0);
    if (!frames) { this.rms = this.peak = this.gainReductionDb = 0; return; }
    const delay = this.latencyFrames, capacity = this.peaks.length, stereo = right !== left;
    let energy = 0, peak = 0, minimumGain = 1;
    for (let i = 0; i < frames; i++) {
      const rawL = left[i] * HAND_OUTPUT_GAIN, rawR = right[i] * HAND_OUTPUT_GAIN;
      const inputL = Number.isFinite(rawL) ? rawL : 0, inputR = Number.isFinite(rawR) ? rawR : 0;
      const delayedL = this.left[this.cursor], delayedR = this.right[this.cursor];
      this.left[this.cursor] = inputL; this.right[this.cursor] = inputR;
      const magnitude = Math.max(Math.abs(inputL), Math.abs(inputR));
      while (this.head !== this.tail) {
        const last = (this.tail + capacity - 1) % capacity;
        if (this.peaks[last] > magnitude) break;
        this.tail = last;
      }
      this.peaks[this.tail] = magnitude; this.indices[this.tail] = this.frame;
      this.tail = (this.tail + 1) % capacity;
      while (this.indices[this.head] < this.frame - delay) this.head = (this.head + 1) % capacity;
      const windowPeak = this.peaks[this.head];
      const demand = windowPeak > HAND_OUTPUT_CEILING ? HAND_OUTPUT_CEILING / windowPeak : 1;
      this.envelope = demand < this.envelope ? demand : this.envelope + (demand - this.envelope) * this.release;
      if (this.envelope > 1 - 1e-12) this.envelope = 1;
      this.gainSum += this.envelope - this.gains[this.cursor]; this.gains[this.cursor] = this.envelope;
      // Every gain in this average saw the delayed sample in its peak window,
      // so it is bounded before scaling. The final min handles roundoff only;
      // there is no independent channel clip or waveform saturation here.
      const delayedPeak = Math.max(Math.abs(delayedL), Math.abs(delayedR));
      const gain = Math.max(0, Math.min(1, this.gainSum / delay,
        delayedPeak > HAND_OUTPUT_CEILING ? HAND_OUTPUT_CEILING / delayedPeak : 1));
      const outL = delayedL * gain, outR = delayedR * gain;
      left[i] = outL; if (stereo) right[i] = outR;
      energy += (outL * outL + outR * outR) * .5;
      peak = Math.max(peak, Math.abs(outL), Math.abs(outR)); minimumGain = Math.min(minimumGain, gain);
      this.cursor = (this.cursor + 1) % delay; this.frame++;
    }
    this.rms = Math.sqrt(energy / frames); this.peak = peak;
    this.gainReductionDb = minimumGain < 1 ? minimumGain > 0 ? -20 * Math.log10(minimumGain) : 160 : 0;
  }
}
