/**
 * Phase-align complete cycles from the actual, filtered synthesizer samples.
 * Audio-rate push() does no allocation. Only snapshots copy the bounded ring.
 * A repeating display is an observation of recent audio, not a chaos verdict.
 */
export class CycleMonitor {
  constructor(points = 64, capacity = 24) {
    this.points = Math.max(16, Math.min(128, Math.floor(Number(points) || 64)));
    this.capacity = Math.max(24, Math.min(32, Math.floor(Number(capacity) || 24)));
    this._ring = new Float32Array(this.points * this.capacity);
    this._cycle = new Float32Array(this.points);
    this._resolution = new Uint8Array(this.capacity);
    this.reset();
  }

  reset() {
    this._count = this._cursor = 0;
    this._generation = 0;
    this.discardPartial();
  }

  /** Keep the last complete waves visible when transport pauses. */
  discardPartial() {
    this._phase = -1;
    this._value = 0;
    this._capturing = false;
    this._nextPoint = 0;
    this._maxStep = 0;
  }

  push(value, phase) {
    if (!Number.isFinite(value) || !Number.isFinite(phase) || phase < 0 || phase >= 1) {
      this.discardPartial();
      return;
    }
    const previousPhase = this._phase;
    const previousValue = this._value;
    this._phase = phase;
    this._value = value;
    if (previousPhase < 0) return;
    const wrapped = phase < previousPhase;
    const step = phase - previousPhase + (wrapped ? 1 : 0);
    if (step <= 0) return;
    // The engine never advances more than .42 of a cycle per sample. A larger
    // jump means an unannounced seek or a clock discontinuity, not a waveform.
    if (step > 0.5) {
      this._capturing = false;
      return;
    }
    this._maxStep = Math.max(this._maxStep, step);
    if (wrapped) {
      if (this._capturing) {
        this._fill(previousPhase, previousValue, phase + 1, value, 1);
        if (this._nextPoint === this.points) this._commit();
      }
      this._capturing = true;
      this._nextPoint = 0;
      this._maxStep = step;
      this._fill(previousPhase - 1, previousValue, phase, value, phase);
    } else if (this._capturing) {
      this._fill(previousPhase, previousValue, phase, value, phase);
    }
  }

  _fill(fromPhase, fromValue, toPhase, toValue, limit) {
    const difference = toValue - fromValue;
    const inverseStep = 1 / (toPhase - fromPhase);
    while (this._nextPoint < this.points) {
      const target = this._nextPoint / this.points;
      if (target > limit) break;
      this._cycle[this._nextPoint++] = fromValue + difference * ((target - fromPhase) * inverseStep);
    }
  }

  _commit() {
    this._ring.set(this._cycle, this._cursor * this.points);
    this._resolution[this._cursor] = this._maxStep <= 1 / 8 ? 1 : 0;
    this._cursor = (this._cursor + 1) % this.capacity;
    this._count = Math.min(this.capacity, this._count + 1);
    this._generation++;
  }

  /**
   * Compare phase-aligned audio without normalizing individual cycle amplitudes:
   * amplitude alternation is precisely what makes period doubling audible.
   */
  _measure() {
    if (this._count < 3) return { period: null, status: 'collecting', error: null };
    const start = (this._cursor - this._count + this.capacity) % this.capacity;
    const recent = Math.min(this._count, 24);
    let energy = 0;
    let mean = 0;
    let resolved = true;
    for (let age = this._count - recent; age < this._count; age++) {
      const slot = (start + age) % this.capacity;
      resolved &&= this._resolution[slot] === 1;
      for (let point = 0; point < this.points; point++) {
        const value = this._ring[slot * this.points + point];
        mean += value;
        energy += value * value;
      }
    }
    const sampleCount = recent * this.points;
    const rms = Math.sqrt(energy / sampleCount);
    if (rms < 0.0001) return { period: null, status: 'quiet', error: null };
    if (!resolved) return { period: null, status: 'under-sampled', error: null };
    // A near-DC waveform cannot establish a reliable audio-cycle pattern.
    const ac = Math.sqrt(Math.max(0, energy / sampleCount - (mean / sampleCount) ** 2));
    if (ac < 0.0001) return { period: null, status: 'quiet', error: null };
    let closest = Infinity;
    // A map-driven discontinuity starts on the first audio sample after phase
    // wrap. At noninteger samples/cycle its latency changes by < one sample,
    // so interpolating the onset can vary even when the remaining cycle repeats.
    // Keep that actual onset in the graphic, but measure repetition after the
    // first 1/32 cycle. Do not normalize away amplitude differences or relax the
    // repeat-error threshold: alternating levels must remain distinguishable.
    const firstPoint = Math.ceil(this.points / 32);
    for (const period of [1, 2, 3, 4, 6, 8]) {
      if (this._count < 3 * period) continue;
      const comparisons = Math.min(this._count - period, 2 * period + 8);
      let squaredDifference = 0;
      for (let age = this._count - comparisons; age < this._count; age++) {
        const current = ((start + age) % this.capacity) * this.points;
        const previous = ((start + age - period) % this.capacity) * this.points;
        for (let point = firstPoint; point < this.points; point++) {
          const difference = this._ring[current + point] - this._ring[previous + point];
          squaredDifference += difference * difference;
        }
      }
      const error = Math.sqrt(squaredDifference / (comparisons * (this.points - firstPoint))) / ac;
      closest = Math.min(closest, error);
      if (error <= 0.012) return { period, status: 'periodic', error };
    }
    return { period: null, status: this._count >= 24 ? 'irregular' : 'collecting', error: Number.isFinite(closest) ? closest : null };
  }

  snapshot() {
    const cycles = [];
    const start = (this._cursor - this._count + this.capacity) % this.capacity;
    for (let age = 0; age < this._count; age++) {
      const offset = ((start + age) % this.capacity) * this.points;
      cycles.push(this._ring.slice(offset, offset + this.points));
    }
    return { points: this.points, cycles, ...this._measure(), count: this._count, generation: this._generation };
  }
}
