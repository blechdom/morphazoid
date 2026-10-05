/** Bounded audio-clock contour capture, continuous sine heads and pulse clocks. */
const CAPACITY = 1024;
export const MAX_HEADS = 16;
const HEADS = MAX_HEADS;
export const SHAPE_AXES = Object.freeze(['none', 'height', 'horizontal', 'depth', 'center', 'angle', 'bend', 'path']);
export const PULSE_VOICES = Object.freeze(['pluck', 'bell', 'tick', 'kick']);
export const RHYTHM_RATIOS = Object.freeze({ unison: Object.freeze([1]), octaves: Object.freeze([.5, 1, 2, 4]), 'two-three-four': Object.freeze([1, 1.5, 2]), fibonacci: Object.freeze([1, 2, 3, 5]) });
const RECORD_SECONDS = 1 / 120;
const CONTROL_SECONDS = 1 / 240;
const TAU = Math.PI * 2;
const EMPTY_PARAMS = Object.freeze({});
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const numberOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const SQRT2 = Math.SQRT2;
const HEAD_DEFAULTS = Object.freeze({ position: 0, phase: 0, secondaryPhase: 0, frequency: 110, targetFrequency: 110, actualFrequency: 110, gain: 0, amplitude: 1, targetAmplitude: 1, pan: 0, targetPan: 0, leftGain: 1, rightGain: 1, targetLeftGain: 1, targetRightGain: 1, tempo: 96, targetTempo: 96, tempoCoordinate: .5, ratio: 1, speed: 0, travelCoordinate: .5, beatPhase: 0, pulseAge: 0, pulseEnvelope: 0, decayEnvelope: 0, decaySeconds: .18, attackSeconds: .0015 });
const HEAD_FIELDS = Object.freeze(Object.keys(HEAD_DEFAULTS));

export function shapeCoordinate(axis, u, v, w = 0, bend = 0, position01 = 0) {
  u = clamp(numberOr(u), -1, 1); v = clamp(numberOr(v), -1, 1); w = clamp(numberOr(w), -1, 1);
  switch (axis) {
    case 'height': return .5 + .5 * v;
    case 'horizontal': return .5 + .5 * u;
    case 'depth': return .5 + .5 * w;
    case 'center': return clamp(Math.hypot(u, v) / SQRT2, 0, 1);
    case 'angle': return clamp((Math.atan2(v, u) + Math.PI) / TAU, 0, 1);
    case 'bend': return clamp(numberOr(bend), 0, 1);
    case 'path': return clamp(numberOr(position01), 0, 1);
    default: return .5;
  }
}

export function rhythmRatio(index, family = 'unison') {
  const ratios = Object.hasOwn(RHYTHM_RATIOS, family) ? RHYTHM_RATIOS[family] : RHYTHM_RATIOS.unison;
  return ratios[Math.max(0, Math.floor(numberOr(index))) % ratios.length];
}

export function shapeTempo(coordinate01, params = EMPTY_PARAMS, index = 0) {
  if (!params || typeof params !== 'object') params = EMPTY_PARAMS;
  const coordinate = SHAPE_AXES.includes(params.tempoAxis) && params.tempoAxis !== 'none' ? clamp(numberOr(coordinate01, .5), 0, 1) : .5;
  const tempo = clamp(numberOr(params.tempo, 96), 30, 240);
  const span = clamp(numberOr(params.tempoSpan), 0, 3);
  return clamp(tempo * rhythmRatio(index, params.rhythmRatios) * Math.pow(2, (coordinate - .5) * span), 8, 960);
}

/** Fixed dimensionless projection. Positive v means up, independently of pixels. */
export function normalizedOrbitPoint(model, x, y, z, target, nativeParameter = 0) {
  x = numberOr(x); y = numberOr(y); z = numberOr(z);
  let u = 0, v = 0, w = 0;
  switch (model) {
    case 'lorenz': u = Math.tanh((x + .15 * y) / 28); v = Math.tanh((z - 24) / 25); w = Math.tanh(y / 28); break;
    case 'rossler': u = Math.tanh((x + .12 * z) / 12); v = Math.tanh((y + .23 * z) / 12); w = Math.tanh(z / 12); break;
    case 'hopf': u = Math.tanh(x / 1.2); v = Math.tanh(y / 1.2); break;
    case 'logistic': u = clamp(2 * y - 1, -1, 1); v = clamp(2 * x - 1, -1, 1); break;
    case 'fold': u = Math.tanh(x); v = clamp(numberOr(nativeParameter) / .65, -1, 1); break;
  }
  target[0] = clamp(numberOr(u), -1, 1);
  target[1] = clamp(numberOr(v), -1, 1);
  if (target.length > 2) target[2] = clamp(numberOr(w), -1, 1);
  return target;
}

/** Continuous pitch mapping, with a sample-rate ceiling and no quantization. */
export function shapeFrequency(u, v, params = EMPTY_PARAMS, sampleRate = 48000, w = 0, bend = 0, position01 = 0) {
  if (!params || typeof params !== 'object') params = EMPTY_PARAMS;
  u = clamp(numberOr(u), -1, 1); v = clamp(numberOr(v), -1, 1);
  const pitch = shapeCoordinate(params.pitchAxis ?? 'height', u, v, w, bend, position01);
  const base = clamp(numberOr(params.frequency, 110), 35, 1400);
  const span = clamp(numberOr(params.pitchSpan, 2.5), 0, 4);
  const ceiling = Math.min(12000, clamp(numberOr(sampleRate, 48000), 8000, 192000) * .25);
  return clamp(base * Math.pow(2, pitch * span), 20, ceiling);
}

export class ShapeReader {
  constructor(sampleRate = 48000) {
    this.sampleRate = clamp(numberOr(sampleRate, 48000), 8000, 192000);
    this._dt = 1 / this.sampleRate;
    this._pitchAlpha = 1 - Math.exp(-this._dt / .009);
    this._gainAlpha = 1 - Math.exp(-this._dt / .015);
    this._tempoAlpha = 1 - Math.exp(-this._dt / .025);
    this._routeAlpha = this._gainAlpha;
    this._u = new Float64Array(CAPACITY);
    this._v = new Float64Array(CAPACITY);
    this._w = new Float64Array(CAPACITY);
    this._arc = new Float64Array(CAPACITY);
    this._point = new Float64Array(3);
    this._readPoint = new Float64Array(5);
    this._position = new Float64Array(HEADS);
    this._direction = new Int8Array(HEADS);
    this._phase = new Float64Array(HEADS);
    this._frequency = new Float64Array(HEADS);
    this._targetFrequency = new Float64Array(HEADS);
    this._gain = new Float64Array(HEADS);
    this._active = new Uint8Array(HEADS);
    this._pendingPlacement = new Uint8Array(HEADS);
    for (const field of HEAD_FIELDS) if (!this[`_${field}`]) this[`_${field}`] = new Float64Array(HEADS);
    this._rhythmInitialized = new Uint8Array(HEADS);
    this._pulseActive = new Uint8Array(HEADS);
    this._pulseVoice = new Uint8Array(HEADS);
    this._hits = new Uint32Array(HEADS);
    this._decayCoefficient = new Float64Array(HEADS);
    this._attackCoefficient = new Float64Array(HEADS);
    this._mapping = { frequency: 110, pitchSpan: 2.5, pitchAxis: 'height' };
    this.reset();
  }

  get phase() { return this._phase[0]; }

  reset(model = 'lorenz', x = 0, y = 0, z = 0, nativeParameter = 0, { preservePhases = false } = {}) {
    const keepInitialized = preservePhases && this._initialized === true;
    this._start = 0; this._count = 1;
    this._recordElapsed = this._controlElapsed = 0;
    this._needsControl = true; this._initialized = keepInitialized;
    normalizedOrbitPoint(model, x, y, z, this._point, nativeParameter);
    this._u[0] = this._point[0]; this._v[0] = this._point[1]; this._w[0] = this._point[2]; this._arc[0] = 0;
    for (let index = 0; index < HEADS; index++) {
      this._position[index] = 0;
      this._direction[index] = index % 2 ? -1 : 1;
      if (!preservePhases) {
        for (const field of HEAD_FIELDS) this[`_${field}`][index] = HEAD_DEFAULTS[field];
        this._active[index] = this._pendingPlacement[index] = this._rhythmInitialized[index] = this._pulseActive[index] = this._pulseVoice[index] = this._hits[index] = 0;
      } else this._pendingPlacement[index] = this._active[index];
      this._decayCoefficient[index] = Math.exp(-this._dt / this._decaySeconds[index]);
      this._attackCoefficient[index] = 1 - Math.exp(-this._dt / this._attackSeconds[index]);
    }
    if (!preservePhases) { this._rhythmMode = false; this.left = this.right = this._mono = 0; }
    return this;
  }

  _lastIndex() { return (this._start + this._count - 1) % CAPACITY; }

  _append(u, v, w) {
    const previous = this._lastIndex();
    const arc = this._arc[previous] + Math.hypot(u - this._u[previous], v - this._v[previous]);
    const oldest = this._arc[this._start];
    const index = (this._start + this._count) % CAPACITY;
    this._u[index] = u; this._v[index] = v; this._w[index] = w; this._arc[index] = arc;
    if (this._count < CAPACITY) this._count++;
    else {
      this._start = (this._start + 1) % CAPACITY;
      const discarded = this._arc[this._start] - oldest;
      // Move the entire group by the discarded distance. Clamping each reader
      // to the new oldest point would collapse their spacing on every roll.
      for (let head = 0; head < HEADS; head++) {
        this._position[head] += discarded;
        this._moveHead(head, 0);
      }
    }
    // Keep arithmetic well-conditioned over long sessions without changing
    // retained geometry, relative reader positions, or oscillator phases.
    if (this._arc[this._start] > 1000000) {
      const origin = this._arc[this._start];
      for (let age = 0; age < this._count; age++) this._arc[(this._start + age) % CAPACITY] -= origin;
      for (let head = 0; head < HEADS; head++) this._position[head] -= origin;
    }
  }

  _moveHead(index, distance) {
    const start = this._arc[this._start];
    const length = this._arc[this._lastIndex()] - start;
    if (length <= 1e-12) { this._position[index] = start; return; }
    const relative = this._position[index] - start;
    const oriented = this._direction[index] > 0 ? relative : 2 * length - relative;
    const period = 2 * length;
    const folded = ((oriented + distance) % period + period) % period;
    if (folded <= length) {
      this._position[index] = start + folded; this._direction[index] = 1;
    } else {
      this._position[index] = start + period - folded; this._direction[index] = -1;
    }
  }

  _pointAt(position, target) {
    if (this._count === 1 || this._arc[this._lastIndex()] - this._arc[this._start] <= 1e-12) {
      const last = this._lastIndex(); target[0] = this._u[last]; target[1] = this._v[last]; target[2] = this._w[last]; target[3] = target[4] = 0; return;
    }
    // At most ten comparisons for the 1024-point ring, at control rate only.
    let low = 0, high = this._count - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this._arc[(this._start + middle) % CAPACITY] < position) low = middle + 1;
      else high = middle;
    }
    const right = (this._start + low) % CAPACITY;
    const left = (this._start + Math.max(0, low - 1)) % CAPACITY;
    const span = this._arc[right] - this._arc[left];
    const mix = span > 1e-12 ? clamp((position - this._arc[left]) / span, 0, 1) : 1;
    target[0] = this._u[left] + mix * (this._u[right] - this._u[left]);
    target[1] = this._v[left] + mix * (this._v[right] - this._v[left]);
    target[2] = this._w[left] + mix * (this._w[right] - this._w[left]);
    const leftBend = this._bendAt(Math.max(0, low - 1));
    target[3] = leftBend + mix * (this._bendAt(low) - leftBend);
    target[4] = clamp((position - this._arc[this._start]) / (this._arc[this._lastIndex()] - this._arc[this._start]), 0, 1);
  }

  _bendAt(age) {
    if (age <= 0 || age >= this._count - 1) return 0;
    const a = (this._start + age - 1) % CAPACITY, b = (this._start + age) % CAPACITY, c = (this._start + age + 1) % CAPACITY;
    const ax = this._u[b] - this._u[a], ay = this._v[b] - this._v[a];
    const bx = this._u[c] - this._u[b], by = this._v[c] - this._v[b];
    const product = Math.hypot(ax, ay) * Math.hypot(bx, by);
    return product > 1e-12 ? Math.acos(clamp((ax * bx + ay * by) / product, -1, 1)) / Math.PI : 0;
  }

  _updateHeads(current, params, seconds) {
    const count = clamp(Math.round(numberOr(params.headCount, 2)), 1, HEADS);
    const speed = 6 * clamp(numberOr(current.headRate, 1), .03, 3);
    const spread = clamp(numberOr(current.headSpread), 0, 3);
    const travelSpan = clamp(numberOr(current.travelSpan), 0, 3);
    const amplitudeDepth = clamp(numberOr(current.amplitudeDepth), 0, 1);
    const panWidth = clamp(numberOr(current.panWidth), 0, 1);
    const start = this._arc[this._start], length = this._arc[this._lastIndex()] - start;
    this._mapping.frequency = current.frequency;
    this._mapping.pitchSpan = current.pitchSpan;
    this._mapping.pitchAxis = params.pitchAxis;
    this._mapping.tempo = current.tempo;
    this._mapping.tempoSpan = current.tempoSpan;
    this._mapping.tempoAxis = params.tempoAxis;
    this._mapping.rhythmRatios = params.rhythmRatios;
    for (let index = 0; index < HEADS; index++) {
      const wanted = index < count ? 1 : 0;
      if (wanted && !this._active[index]) {
        this._position[index] = start + length * index / count;
        this._direction[index] = index % 2 ? -1 : 1;
        this._pendingPlacement[index] = length <= .05 ? 1 : 0;
      }
      // A just-created contour has no arclength on which to space readers.
      // Place each once when the first short segment exists; do not repeatedly
      // redistribute live readers whenever the shape grows or count changes.
      if (wanted && this._pendingPlacement[index] && length > .05) {
        this._position[index] = start + length * index / count;
        this._direction[index] = index % 2 ? -1 : 1;
        this._pendingPlacement[index] = 0;
      }
      this._active[index] = wanted;
      this._pointAt(this._position[index], this._readPoint);
      this._travelCoordinate[index] = this._coordinate(params.travelAxis);
      const spreadPosition = count > 1 ? clamp(index / (count - 1) - .5, -.5, .5) : 0;
      this._speed[index] = speed * Math.pow(2, spread * spreadPosition + (this._travelCoordinate[index] - .5) * travelSpan);
      if (!this._pendingPlacement[index] && (wanted || this._gain[index] > .00001)) this._moveHead(index, this._speed[index] * seconds);
      this._pointAt(this._position[index], this._readPoint);
      this._targetFrequency[index] = shapeFrequency(this._readPoint[0], this._readPoint[1], this._mapping, this.sampleRate, this._readPoint[2], this._readPoint[3], this._readPoint[4]);
      const amplitude = this._coordinate(params.amplitudeAxis);
      this._targetAmplitude[index] = SHAPE_AXES.includes(params.amplitudeAxis) && params.amplitudeAxis !== 'none' ? 1 - amplitudeDepth + amplitudeDepth * (.15 + .85 * amplitude) : 1;
      this._targetPan[index] = (2 * this._coordinate(params.panAxis) - 1) * panWidth;
      if (this._targetPan[index] === 0) this._targetLeftGain[index] = this._targetRightGain[index] = 1;
      else {
        const angle = (this._targetPan[index] + 1) * Math.PI / 4;
        this._targetLeftGain[index] = Math.cos(angle) * SQRT2;
        this._targetRightGain[index] = Math.sin(angle) * SQRT2;
      }
      this._tempoCoordinate[index] = this._coordinate(params.tempoAxis);
      this._ratio[index] = rhythmRatio(index, params.rhythmRatios);
      this._targetTempo[index] = shapeTempo(this._tempoCoordinate[index], this._mapping, index);
      if (!this._rhythmInitialized[index]) this._tempo[index] = this._targetTempo[index];
      this._setPulseTimes(index, current.pulseDecay);
      if (!this._initialized) this._frequency[index] = this._targetFrequency[index];
    }
    this._initialized = true;
  }

  _coordinate(axis) { return shapeCoordinate(axis, this._readPoint[0], this._readPoint[1], this._readPoint[2], this._readPoint[3], this._readPoint[4]); }

  _setPulseTimes(index, decay) {
    decay = clamp(numberOr(decay, .18), .025, 1.2);
    const voice = this._pulseVoice[index];
    this._decaySeconds[index] = voice === 1 ? decay * 1.7 : voice === 2 ? Math.min(.07, decay * .25) : voice === 3 ? decay * .7 : decay;
    this._attackSeconds[index] = voice === 1 ? .003 : voice === 2 ? .0004 : voice === 3 ? .001 : .0015;
    this._decayCoefficient[index] = Math.exp(-this._dt / this._decaySeconds[index]);
    this._attackCoefficient[index] = 1 - Math.exp(-this._dt / this._attackSeconds[index]);
  }

  _trigger(index, params, current) {
    this._pulseVoice[index] = Math.max(0, PULSE_VOICES.indexOf(params.pulseVoice));
    this._pulseAge[index] = 0; this._decayEnvelope[index] = 1; this._pulseActive[index] = 1;
    this._hits[index] = this._hits[index] >= 1000000000 ? 0 : this._hits[index] + 1;
    this._setPulseTimes(index, current.pulseDecay);
  }

  sample(model, x, y, z, nativeParameter, current = EMPTY_PARAMS, params = current) {
    if (!current || typeof current !== 'object') current = EMPTY_PARAMS;
    if (!params || typeof params !== 'object') params = current;
    normalizedOrbitPoint(model, x, y, z, this._point, nativeParameter);
    this._recordElapsed += this._dt;
    if (this._recordElapsed >= RECORD_SECONDS) {
      this._recordElapsed -= RECORD_SECONDS;
      if (params.growShape !== false) this._append(this._point[0], this._point[1], this._point[2]);
    }
    this._controlElapsed += this._dt;
    if (this._needsControl) {
      this._needsControl = false;
      this._updateHeads(current, params, 0);
    } else if (this._controlElapsed >= CONTROL_SECONDS) {
      this._controlElapsed -= CONTROL_SECONDS;
      this._updateHeads(current, params, CONTROL_SECONDS);
    }
    const rhythm = params.sonification === 'rhythm';
    const count = clamp(Math.round(numberOr(params.headCount, 2)), 1, HEADS);
    let sum = 0, left = 0, right = 0, gain = 0, stereo = false;
    for (let index = 0; index < HEADS; index++) {
      this._frequency[index] += this._pitchAlpha * (this._targetFrequency[index] - this._frequency[index]);
      this._gain[index] += this._gainAlpha * (this._active[index] - this._gain[index]);
      this._amplitude[index] += this._routeAlpha * (this._targetAmplitude[index] - this._amplitude[index]);
      this._pan[index] += this._routeAlpha * (this._targetPan[index] - this._pan[index]);
      this._leftGain[index] += this._routeAlpha * (this._targetLeftGain[index] - this._leftGain[index]);
      this._rightGain[index] += this._routeAlpha * (this._targetRightGain[index] - this._rightGain[index]);
      this._tempo[index] += this._tempoAlpha * (this._targetTempo[index] - this._tempo[index]);
      if (rhythm) {
        if (this._active[index] && !this._rhythmInitialized[index]) {
          this._rhythmInitialized[index] = 1;
          this._beatPhase[index] = index / count;
          if (index === 0) this._trigger(index, params, current);
        }
        if (this._active[index]) {
          this._beatPhase[index] += this._tempo[index] * this._dt / 60;
          if (this._beatPhase[index] >= 1) { this._beatPhase[index] -= 1; this._trigger(index, params, current); }
        }
        if (this._hits[index]) this._pulseAge[index] = Math.min(120, this._pulseAge[index] + this._dt);
        if (this._pulseActive[index]) {
          this._decayEnvelope[index] *= this._decayCoefficient[index];
          this._pulseEnvelope[index] += this._attackCoefficient[index] * (this._decayEnvelope[index] - this._pulseEnvelope[index]);
          if (this._decayEnvelope[index] < 1e-8 && this._pulseEnvelope[index] < 1e-8) this._decayEnvelope[index] = this._pulseEnvelope[index] = this._pulseActive[index] = 0;
        }
      }
      const voice = this._pulseVoice[index];
      const actualFrequency = rhythm && voice === 3 ? Math.max(20, this._frequency[index] * (.28 + .72 * Math.exp(-this._pulseAge[index] / .028))) : this._frequency[index];
      this._actualFrequency[index] = actualFrequency;
      this._phase[index] += actualFrequency * this._dt;
      if (this._phase[index] >= 1) this._phase[index] -= 1;
      let waveform = Math.sin(TAU * this._phase[index]);
      if (rhythm) {
        const partial = voice === 1 ? 2.71 : voice === 2 ? 6.37 : 2;
        this._secondaryPhase[index] += Math.min(this.sampleRate * .4, actualFrequency * partial) * this._dt;
        if (this._secondaryPhase[index] >= 1) this._secondaryPhase[index] -= 1;
        if (voice === 1) waveform = .62 * waveform + .38 * Math.sin(TAU * this._secondaryPhase[index]);
        else if (voice === 2) waveform = .3 * waveform + .7 * Math.sin(TAU * this._secondaryPhase[index]);
        else if (voice === 0) waveform = .9 * waveform + .1 * Math.sin(TAU * this._secondaryPhase[index]);
        waveform *= this._pulseEnvelope[index];
      }
      const value = waveform * this._gain[index] * this._amplitude[index];
      sum += value; left += value * this._leftGain[index]; right += value * this._rightGain[index];
      if (this._gain[index] > 0 && (this._leftGain[index] !== 1 || this._rightGain[index] !== 1)) stereo = true;
      gain += this._gain[index];
    }
    const denominator = Math.max(1, gain);
    this._mono = .55 * sum / denominator;
    this.left = stereo ? .55 * left / denominator : this._mono;
    this.right = stereo ? .55 * right / denominator : this._mono;
    this._rhythmMode = rhythm;
    return this._mono;
  }

  snapshot() {
    const points = [], depths = [];
    for (let age = 0; age < this._count; age++) {
      const index = (this._start + age) % CAPACITY;
      points.push([this._u[index], this._v[index]]);
      depths.push(this._w[index]);
    }
    const heads = [];
    for (let index = 0; index < HEADS; index++) {
      if (!this._active[index] && this._gain[index] < .00001) continue;
      this._pointAt(this._position[index], this._readPoint);
      heads.push({ index, x: this._readPoint[0], y: this._readPoint[1], depth: this._readPoint[2], bend: this._readPoint[3], pathCoordinate: this._readPoint[4], frequency: this._actualFrequency[index], baseFrequency: this._frequency[index], position: this._position[index] - this._arc[this._start], direction: this._direction[index], phase: this._phase[index], gain: this._gain[index], tempo: this._tempo[index], tempoCoordinate: this._tempoCoordinate[index], ratio: this._ratio[index], beatPhase: this._beatPhase[index], pulse: this._pulseEnvelope[index], pulseAge: this._pulseAge[index], amplitude: this._amplitude[index], pan: this._pan[index], speed: this._speed[index], hits: this._hits[index] });
    }
    return { points, depths, heads, count: this._count, totalLength: this._arc[this._lastIndex()] - this._arc[this._start] };
  }

  exportState() {
    const points = [], depths = [];
    for (let age = 0; age < this._count; age++) {
      const index = (this._start + age) % CAPACITY;
      points.push(this._u[index], this._v[index], this._arc[index]);
      depths.push(this._w[index]);
    }
    const heads = [];
    for (let index = 0; index < HEADS; index++) {
      const head = { direction: this._direction[index], active: this._active[index], pendingPlacement: this._pendingPlacement[index], rhythmInitialized: this._rhythmInitialized[index], pulseActive: this._pulseActive[index], pulseVoice: this._pulseVoice[index], hits: this._hits[index] };
      for (const field of HEAD_FIELDS) head[field] = this[`_${field}`][index];
      heads.push(head);
    }
    return { version: 2, start: this._start, count: this._count, points, depths, heads, recordElapsed: this._recordElapsed, controlElapsed: this._controlElapsed, needsControl: this._needsControl, initialized: this._initialized, rhythmMode: this._rhythmMode, mono: this._mono, left: this.left, right: this.right };
  }

  /** Validate completely before touching the live reader. Sample rate is local. */
  importState(state) {
    if (!state || ![1, 2].includes(state.version) || !Number.isInteger(state.start) || state.start < 0 || state.start >= CAPACITY
      || !Number.isInteger(state.count) || state.count < 1 || state.count > CAPACITY || !Array.isArray(state.points) || state.points.length !== state.count * 3
      || !Array.isArray(state.heads) || state.heads.length !== (state.version === 1 ? 4 : HEADS) || typeof state.needsControl !== 'boolean' || typeof state.initialized !== 'boolean'
      || !Number.isFinite(state.recordElapsed) || state.recordElapsed < 0 || state.recordElapsed >= RECORD_SECONDS
      || !Number.isFinite(state.controlElapsed) || state.controlElapsed < 0 || state.controlElapsed >= CONTROL_SECONDS) return false;
    if (state.version === 2 && (!Array.isArray(state.depths) || state.depths.length !== state.count || typeof state.rhythmMode !== 'boolean'
      || !Number.isFinite(state.mono) || Math.abs(state.mono) > .550000001 || !Number.isFinite(state.left) || Math.abs(state.left) > .800000001 || !Number.isFinite(state.right) || Math.abs(state.right) > .800000001)) return false;
    let previousArc = -1;
    for (let age = 0; age < state.count; age++) {
      const offset = age * 3, u = state.points[offset], v = state.points[offset + 1], arc = state.points[offset + 2];
      if (!Number.isFinite(u) || !Number.isFinite(v) || Math.abs(u) > 1 || Math.abs(v) > 1 || !Number.isFinite(arc) || arc < 0 || arc > 1000000000 || arc < previousArc) return false;
      if (state.version === 2 && (!Number.isFinite(state.depths[age]) || Math.abs(state.depths[age]) > 1)) return false;
      if (age > 0) {
        const distance = Math.hypot(u - state.points[offset - 3], v - state.points[offset - 2]);
        if (Math.abs(arc - previousArc - distance) > 1e-7) return false;
      }
      previousArc = arc;
    }
    const oldest = state.points[2], newest = state.points.at(-1);
    for (const head of state.heads) {
      if (!head || !Number.isFinite(head.position) || head.position < oldest - 1e-9 || head.position > newest + 1e-9
        || ![-1, 1].includes(head.direction) || !Number.isFinite(head.phase) || head.phase < 0 || head.phase >= 1
        || !Number.isFinite(head.frequency) || head.frequency < 20 || head.frequency > 12000
        || !Number.isFinite(head.targetFrequency) || head.targetFrequency < 20 || head.targetFrequency > 12000
        || !Number.isFinite(head.gain) || head.gain < 0 || head.gain > 1 || ![0, 1].includes(head.active) || ![0, 1].includes(head.pendingPlacement)) return false;
      if (state.version === 2) {
        for (const phase of ['secondaryPhase', 'beatPhase']) if (!Number.isFinite(head[phase]) || head[phase] < 0 || head[phase] >= 1) return false;
        const ranges = { actualFrequency: [20, 12000], amplitude: [.15, 1], targetAmplitude: [.15, 1], pan: [-1, 1], targetPan: [-1, 1], leftGain: [0, SQRT2 + 1e-12], rightGain: [0, SQRT2 + 1e-12], targetLeftGain: [0, SQRT2 + 1e-12], targetRightGain: [0, SQRT2 + 1e-12], tempo: [8, 960], targetTempo: [8, 960], tempoCoordinate: [0, 1], ratio: [.5, 5], speed: [0, 144.000000001], travelCoordinate: [0, 1], pulseAge: [0, 120], pulseEnvelope: [0, 1], decayEnvelope: [0, 1], decaySeconds: [.00625, 2.040000001], attackSeconds: [.0004, .003] };
        for (const [field, [low, high]] of Object.entries(ranges)) if (!Number.isFinite(head[field]) || head[field] < low || head[field] > high) return false;
        if (![0, 1].includes(head.rhythmInitialized) || ![0, 1].includes(head.pulseActive) || !Number.isInteger(head.pulseVoice) || head.pulseVoice < 0 || head.pulseVoice >= PULSE_VOICES.length || !Number.isInteger(head.hits) || head.hits < 0 || head.hits > 1000000000) return false;
      }
    }
    this._start = state.start; this._count = state.count;
    for (let age = 0; age < this._count; age++) {
      const offset = age * 3, index = (this._start + age) % CAPACITY;
      this._u[index] = state.points[offset]; this._v[index] = state.points[offset + 1]; this._arc[index] = state.points[offset + 2];
      this._w[index] = state.version === 2 ? state.depths[age] : 0;
    }
    const ceiling = Math.min(12000, this.sampleRate * .25);
    for (let index = 0; index < HEADS; index++) {
      const head = state.heads[index];
      for (const field of HEAD_FIELDS) this[`_${field}`][index] = state.version === 2 ? head[field] : HEAD_DEFAULTS[field];
      if (state.version === 1 && head) for (const field of ['position', 'phase', 'frequency', 'targetFrequency', 'gain']) this[`_${field}`][index] = head[field];
      if (state.version === 1) this._actualFrequency[index] = this._frequency[index];
      this._position[index] = clamp(this._position[index], oldest, newest);
      this._direction[index] = head ? head.direction : index % 2 ? -1 : 1;
      this._active[index] = head ? head.active : 0; this._pendingPlacement[index] = head ? head.pendingPlacement : 0;
      this._rhythmInitialized[index] = state.version === 2 ? head.rhythmInitialized : 0;
      this._pulseActive[index] = state.version === 2 ? head.pulseActive : 0;
      this._pulseVoice[index] = state.version === 2 ? head.pulseVoice : 0;
      this._hits[index] = state.version === 2 ? head.hits : 0;
      this._frequency[index] = Math.min(ceiling, this._frequency[index]); this._targetFrequency[index] = Math.min(ceiling, this._targetFrequency[index]); this._actualFrequency[index] = Math.min(ceiling, this._actualFrequency[index]);
      this._decayCoefficient[index] = Math.exp(-this._dt / this._decaySeconds[index]);
      this._attackCoefficient[index] = 1 - Math.exp(-this._dt / this._attackSeconds[index]);
    }
    this._recordElapsed = state.recordElapsed; this._controlElapsed = state.controlElapsed;
    this._needsControl = state.needsControl; this._initialized = state.initialized;
    this._rhythmMode = state.version === 2 ? state.rhythmMode : false;
    this._mono = state.version === 2 ? state.mono : 0; this.left = state.version === 2 ? state.left : 0; this.right = state.version === 2 ? state.right : 0;
    return true;
  }
}
