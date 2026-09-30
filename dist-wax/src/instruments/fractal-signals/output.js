/** Fixed mix calibration followed by a stereo-linked sample-peak limiter.
 * Gain never follows RMS: quiet gestures, rests and decay tails keep their dynamics.
 * The 2 ms lookahead allows a fast gain ramp before an incoming peak. Master level
 * is applied last, so turning down does not change tone or drive the limiter.
 */
export const OUTPUT_CEILING = .88; // About -1.1 dBFS; sample peak, not a true-peak claim.
export const OUTPUT_TRIM_DB = Object.freeze({
  wander: Object.freeze({ cascade: 18, pluck: 18, additive: 18 }),
  grammar: Object.freeze({ cascade: 18, pluck: 18, bell: 6 }),
  grains: Object.freeze({ sample: 30, resonant: 18, cloud: 24 }),
  waveform: Object.freeze({ 'self-affine': 18, folded: 18, hollow: 18 }),
  echoes: Object.freeze({ shepard: 18, strikes: 18, resonant: 6 }),
  texture: Object.freeze({ noise: 6, resonant: 9, hybrid: 24 }),
});
export const outputMakeup = state => 10 ** ((OUTPUT_TRIM_DB[state.mode]?.[state.engine] ?? 12) / 20);

export class FractalOutput {
  constructor(sampleRate, makeup = 1) {
    this.lookahead = Math.max(1, Math.round(sampleRate * .002));
    const length = this.lookahead + 1;
    this.delayL = new Float64Array(length);
    this.delayR = new Float64Array(length);
    // Monotonic peak queue: amortized O(1), with no allocation in process().
    this.peakValues = new Float64Array(length + 1);
    this.peakFrames = new Float64Array(length + 1);
    this.attackStep = 1 - Math.exp(-1 / (sampleRate * .0001));
    this.releaseStep = 1 - Math.exp(-1 / (sampleRate * .08));
    this.trimStep = 1 - Math.exp(-1 / (sampleRate * .025));
    this.makeup = this.makeupTarget = makeup;
    this.clear();
  }
  setMakeup(value) { this.makeupTarget = Number.isFinite(value) ? Math.max(1, Math.min(32, value)) : 1; }
  clear() {
    this.delayL.fill(0); this.delayR.fill(0);
    this.head = this.tail = this.frame = this.write = 0;
    this.gain = 1;
    this.left = this.right = 0;
  }
  process(left, right, level = 1) {
    this.makeup += (this.makeupTarget - this.makeup) * this.trimStep;
    left = Number.isFinite(left) ? left * this.makeup : 0;
    right = Number.isFinite(right) ? right * this.makeup : 0;
    const peak = Math.max(Math.abs(left), Math.abs(right));
    const size = this.peakValues.length, oldest = this.frame - this.lookahead;
    while (this.head !== this.tail && this.peakFrames[this.head] < oldest) this.head = (this.head + 1) % size;
    while (this.head !== this.tail) {
      const previous = (this.tail + size - 1) % size;
      if (this.peakValues[previous] > peak) break;
      this.tail = previous;
    }
    this.peakValues[this.tail] = peak; this.peakFrames[this.tail] = this.frame++;
    this.tail = (this.tail + 1) % size;
    this.delayL[this.write] = left; this.delayR[this.write] = right;
    this.write = (this.write + 1) % this.delayL.length;
    const delayedL = this.delayL[this.write], delayedR = this.delayR[this.write];
    const windowPeak = this.peakValues[this.head];
    const target = Math.min(1, OUTPUT_CEILING / Math.max(OUTPUT_CEILING, windowPeak));
    this.gain += (target - this.gain) * (target < this.gain ? this.attackStep : this.releaseStep);
    // Covers rounding and a peak that arrives during initial lookahead fill.
    const gain = Math.min(this.gain, OUTPUT_CEILING / Math.max(OUTPUT_CEILING, Math.abs(delayedL), Math.abs(delayedR)));
    const master = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    this.left = delayedL * gain * master;
    this.right = delayedR * gain * master;
    return this;
  }
}
