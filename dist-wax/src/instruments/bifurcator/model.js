import { ShapeReader } from './shape-reader.js';

/**
 * Dimensionless dynamical systems, integrated on the audio clock.
 * No browser globals or dependencies: the same engine runs in a Worklet,
 * a silent preview, or Node. Rendering never changes the mathematical state.
 */
export const MODELS = Object.freeze([
  Object.freeze({ id: 'hopf', label: 'Hopf onset', parameterLabel: 'Growth', parameterSymbol: 'μ', nativeRange: Object.freeze([-1, 2]), defaultRegime: 0.58, description: 'Supercritical Hopf: a stable rest state becomes a limit cycle at μ = 0.' }),
  Object.freeze({ id: 'logistic', label: 'Period doubling', parameterLabel: 'Growth', parameterSymbol: 'r', nativeRange: Object.freeze([2.6, 4]), defaultRegime: 0.65, description: 'The logistic map develops alternating cycles at r = 3, then further doublings and chaotic windows.' }),
  Object.freeze({ id: 'fold', label: 'Fold / hysteresis', parameterLabel: 'Bias', parameterSymbol: 'b', nativeRange: Object.freeze([-0.65, 0.65]), defaultRegime: 0.5, description: 'Two stable branches coexist for |b| < 2 / (3√3); their loss produces jumps and hysteresis.' }),
  Object.freeze({ id: 'lorenz', label: 'Lorenz flow', parameterLabel: 'Convection', parameterSymbol: 'ρ', nativeRange: Object.freeze([0.5, 80]), defaultRegime: (28 - 0.5) / 79.5, description: 'Lorenz flow. The familiar ρ ≈ 24.74 Hopf threshold assumes σ = 10 and β = 8/3; changing them changes the regimes.' }),
  Object.freeze({ id: 'rossler', label: 'Rössler flow', parameterLabel: 'Return', parameterSymbol: 'c', nativeRange: Object.freeze([2, 18]), defaultRegime: (5.7 - 2) / 16, description: 'Rössler flow, with a = b = 0.2 by default. Parameter changes can produce periodic, doubled, and chaotic regimes; the sequence includes windows.' }),
]);

const MODEL_BY_ID = Object.assign(Object.create(null), Object.fromEntries(MODELS.map((model) => [model.id, model])));
export const PARAM_RANGES = Object.freeze({
  regime: Object.freeze([0, 1]), frequency: Object.freeze([35, 1400]), speed: Object.freeze([0.15, 3]),
  clarity: Object.freeze([0, 1]), depth: Object.freeze([0, 1]), cutoff: Object.freeze([80, 18000]),
  sigma: Object.freeze([4, 18]), beta: Object.freeze([0.8, 4]), a: Object.freeze([0.05, 0.35]), b: Object.freeze([0.05, 0.35]),
  sweepSeconds: Object.freeze([4, 40]),
  headCount: Object.freeze([1, 16]), headRate: Object.freeze([0.03, 3]), pitchSpan: Object.freeze([0, 4]),
  headSpread: Object.freeze([0, 3]), travelSpan: Object.freeze([0, 3]),
  amplitudeDepth: Object.freeze([0, 1]), panWidth: Object.freeze([0, 1]),
  tempo: Object.freeze([30, 240]), tempoSpan: Object.freeze([0, 3]), pulseDecay: Object.freeze([0.025, 1.2]),
});
export const DEFAULT_PARAMS = Object.freeze({
  model: 'lorenz', regime: (28 - 0.5) / 79.5, frequency: 110, speed: 1,
  clarity: 0.45, depth: 0.65, cutoff: 6000, playing: true,
  sigma: 10, beta: 8 / 3, a: 0.2, b: 0.2,
  sweepSeconds: 16,
  sonification: 'orbit', pitchAxis: 'height', headCount: 2, headRate: 1, pitchSpan: 2.5, growShape: true,
  headSpread: 0, travelAxis: 'none', travelSpan: 0,
  amplitudeAxis: 'none', amplitudeDepth: 0, panAxis: 'none', panWidth: 0,
  tempo: 96, tempoAxis: 'none', tempoSpan: 0, rhythmRatios: 'unison', pulseVoice: 'pluck', pulseDecay: .18,
});
const NUMERIC_KEYS = Object.keys(PARAM_RANGES);
const SMOOTH_KEYS = NUMERIC_KEYS.filter(key => key !== 'headCount');
export const SHAPE_AXES = Object.freeze(['height', 'horizontal', 'center', 'depth', 'angle', 'bend', 'path']);
export const MAPPING_AXES = Object.freeze(['none', ...SHAPE_AXES]);
export const ENUM_PARAMS = Object.freeze({
  sonification: Object.freeze(['orbit', 'shape', 'rhythm']), pitchAxis: SHAPE_AXES,
  travelAxis: MAPPING_AXES, amplitudeAxis: MAPPING_AXES, panAxis: MAPPING_AXES, tempoAxis: MAPPING_AXES,
  rhythmRatios: Object.freeze(['unison', 'octaves', 'two-three-four', 'fibonacci']),
  pulseVoice: Object.freeze(['pluck', 'bell', 'tick', 'kick']),
});
export const isShapeSonification = sonification => sonification === 'shape' || sonification === 'rhythm';
const TAU = Math.PI * 2;
const MAX_SUBSTEPS = 8;
const SHAPE_TIME_RATES = Object.freeze({ hopf: .35, fold: 3, lorenz: 3, rossler: 5 });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const numberOr = (value, fallback) => {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : fallback;
};
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Normalize a partial parameter object against a complete fallback. */
export function normalizeParams(input = {}, fallback = DEFAULT_PARAMS) {
  const source = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_PARAMS;
  const baseModel = MODEL_BY_ID[base.model] ? base.model : DEFAULT_PARAMS.model;
  const model = MODEL_BY_ID[source.model] ? source.model : baseModel;
  const result = { model };
  for (const key of NUMERIC_KEYS) {
    const [low, high] = PARAM_RANGES[key];
    const baseValue = clamp(numberOr(base[key], DEFAULT_PARAMS[key]), low, high);
    const value = key === 'regime' && model !== baseModel && source.regime === undefined
      ? MODEL_BY_ID[model].defaultRegime : numberOr(source[key], baseValue);
    result[key] = key === 'headCount' ? Math.round(clamp(value, low, high)) : clamp(value, low, high);
  }
  for (const [key, choices] of Object.entries(ENUM_PARAMS)) result[key] = choices.includes(source[key]) ? source[key] : choices.includes(base[key]) ? base[key] : DEFAULT_PARAMS[key];
  result.growShape = typeof source.growShape === 'boolean' ? source.growShape : typeof base.growShape === 'boolean' ? base.growShape : DEFAULT_PARAMS.growShape;
  result.playing = typeof source.playing === 'boolean' ? source.playing : typeof base.playing === 'boolean' ? base.playing : DEFAULT_PARAMS.playing;
  return result;
}

/** A complete, reproducible starting patch for a model. */
export function createPreset(model = DEFAULT_PARAMS.model, overrides = {}) {
  const id = MODEL_BY_ID[model] ? model : DEFAULT_PARAMS.model;
  return normalizeParams({ ...DEFAULT_PARAMS, model: id, regime: MODEL_BY_ID[id].defaultRegime, ...overrides });
}

/** Randomize all sound/model controls, retaining the current transport state. */
export function randomizeParams(params = DEFAULT_PARAMS, random = Math.random) {
  const previous = normalizeParams(params);
  const unit = () => clamp(numberOr(random(), 0.5), 0, 0.999999999);
  const model = MODELS[Math.floor(unit() * MODELS.length)].id;
  return normalizeParams({
    model, regime: unit(), frequency: 55 * Math.pow(12, unit()), speed: 0.35 * Math.pow(6, unit()),
    clarity: unit(), depth: 0.2 + 0.8 * unit(), cutoff: 350 * Math.pow(35, unit()),
    sigma: 4 + 14 * unit(), beta: 0.8 + 3.2 * unit(), a: 0.05 + 0.3 * unit(), b: 0.05 + 0.3 * unit(),
    sweepSeconds: 4 + 36 * unit(),
    ...Object.fromEntries(Object.entries(ENUM_PARAMS).map(([key, choices]) => [key, choices[Math.floor(unit() * choices.length)]])),
    headCount: 1 + Math.floor(unit() * 16), headRate: .03 + 2.97 * unit(), pitchSpan: 4 * unit(), growShape: unit() >= .5,
    headSpread: 3 * unit(), travelSpan: 3 * unit(), amplitudeDepth: unit(), panWidth: unit(),
    tempo: 30 + 210 * unit(), tempoSpan: 3 * unit(), pulseDecay: .025 * Math.pow(48, unit()),
    playing: previous.playing,
  });
}

export class BifurcatorEngine {
  constructor(sampleRate = 48000) {
    this.sampleRate = clamp(numberOr(sampleRate, 48000), 8000, 192000);
    this.params = normalizeParams();
    this._current = { ...this.params };
    this._parameterAlpha = 1 - Math.exp(-1 / (0.025 * this.sampleRate));
    this._gainAlpha = 1 - Math.exp(-1 / (0.012 * this.sampleRate));
    this._followerAlpha = 1 - Math.exp(-1 / (0.06 * this.sampleRate));
    this._dcPole = Math.exp(-TAU * 12 / this.sampleRate);
    this._model = this.params.model;
    this._phase = 0;
    this._gain = 0;
    this._dcInput = this._dcOutput = this._lowpass1 = this._lowpass2 = 0;
    this._lastVoice = this._lastOutput = this._orbitSignal = this._follower = 0;
    this._transitionSource = this._transitionSeconds = 0;
    this._stereoFilters = new Float64Array(8);
    this._lastVoiceLeft = this._lastVoiceRight = 0;
    this._transitionLeft = this._transitionRight = 0;
    this.left = this.right = 0;
    this._time = this._recoveries = this._integrationSteps = 0;
    this._integrationLimited = false;
    this._sweepRunning = false; this._sweepProgress = 0;
    this._shapeGap = false;
    this.shapeReader = new ShapeReader(this.sampleRate);
    this._seedModel();
  }

  get phase() { return isShapeSonification(this.params.sonification) ? this.shapeReader.phase : this._phase; }

  startSweep() {
    if (this._model !== 'logistic' || this.params.sonification !== 'orbit') return false;
    this._sweepRunning = true; this._sweepProgress = 0;
    this.params.regime = (2.8 - 2.6) / 1.4;
    return true;
  }

  stopSweep() { this._sweepRunning = false; }

  _advanceSweep() {
    if (!this._sweepRunning || !this.params.playing) return;
    const progress = this._sweepProgress = Math.min(1, this._sweepProgress + 1 / (this.sampleRate * this._current.sweepSeconds));
    // Spend time around the doubling cascade, then cross its periodic windows.
    let r;
    if (progress < .14) r = 2.8;
    else if (progress < .32) r = 2.8 + (progress - .14) / .18 * .4;
    else if (progress < .52) r = 3.2 + (progress - .32) / .2 * .3;
    else if (progress < .72) r = 3.5 + (progress - .52) / .2 * .06;
    else r = 3.56 + (progress - .72) / .28 * .43;
    this.params.regime = (r - 2.6) / 1.4;
    if (progress >= 1) this._sweepRunning = false;
  }

  setParams(patch = {}) {
    if (patch && (Object.hasOwn(patch, 'regime') || Object.hasOwn(patch, 'model') || Object.hasOwn(patch, 'sonification'))) this.stopSweep();
    const next = normalizeParams(patch, this.params);
    const changedModel = next.model !== this._model;
    if (next.sonification !== this.params.sonification) this._startTransition();
    this.params = next;
    for (const key of [...Object.keys(ENUM_PARAMS), 'headCount', 'growShape']) this._current[key] = next[key];
    if (changedModel) {
      this._startTransition();
      this._model = next.model;
      this._current.model = next.model;
      // A regime is a different native quantity in each model.
      this._current.regime = next.regime;
      this._seedModel(true);
    }
    if (isShapeSonification(next.sonification) && next.growShape && this._shapeGap) {
      // Time spent in the other voice is absent from the retained contour.
      // Begin at the actual current point rather than inventing a connector
      // across that gap. Oscillator phases and the mathematical orbit survive.
      this._startTransition();
      this.shapeReader.reset(this._model, this._x, this._y, this._z, this._nativeParameter(), { preservePhases: true });
      this._shapeGap = false;
    }
    return this;
  }

  reset() {
    this.stopSweep(); this._sweepProgress = 0;
    this._startTransition();
    this._current = { ...this.params };
    this._phase = this._follower = 0;
    this._seedModel();
    this._time = 0;
    this._recoveries = 0;
    return this;
  }

  perturb(amount = 0.35) {
    const strength = clamp(numberOr(amount, 0.35), -1, 1);
    switch (this._model) {
      case 'hopf': this._x += strength * 0.28; this._y += strength * 0.19; break;
      case 'logistic': this._x = clamp(this._x + strength * 0.09, 1e-9, 1 - 1e-9); break;
      case 'fold': this._x += strength * 4; break;
      case 'lorenz': this._x += strength * 4; this._y -= strength * 2; this._z += strength * 2; break;
      case 'rossler': this._x += strength * 2; this._y += strength; this._z += strength * 0.5; break;
    }
    return this;
  }

  _seedModel(preservePhases = false) {
    switch (this._model) {
      case 'hopf': this._x = 0.03; this._y = 0; this._z = 0; break;
      case 'logistic': this._x = 0.43123; this._y = 0.41713; this._z = 0.39791; break;
      case 'fold': this._x = 0.85; this._y = 0; this._z = 0; break;
      case 'lorenz': this._x = 0.1; this._y = 0.2; this._z = 0.15; break;
      case 'rossler': this._x = 0.2; this._y = 0; this._z = 0.1; break;
    }
    this._integrationSteps = 0;
    this.shapeReader.reset(this._model, this._x, this._y, this._z, this._nativeParameter(), { preservePhases });
    this._shapeGap = false;
  }

  _startTransition() {
    this._transitionSource = this._lastVoice;
    this._transitionLeft = this._lastVoiceLeft;
    this._transitionRight = this._lastVoiceRight;
    this._transitionSeconds = 0.025;
  }

  _nativeParameter() {
    const range = MODEL_BY_ID[this._model].nativeRange;
    return range[0] + this._current.regime * (range[1] - range[0]);
  }

  _advancePhase(frequency) {
    this._phase += Math.min(0.42, Math.max(0, frequency) / this.sampleRate);
    if (this._phase >= 1) { this._phase -= 1; return true; }
    return false;
  }

  _integrate(parameter, shapeTime = false) {
    const current = this._current;
    let rate, maxStep;
    switch (this._model) {
      case 'hopf': rate = current.frequency * current.speed; maxStep = 0.04; break;
      case 'fold': rate = 18 * current.speed; maxStep = 0.03; break;
      case 'lorenz': rate = current.frequency * current.speed * 0.35; maxStep = 0.006; break;
      case 'rossler': rate = current.frequency * current.speed * Math.PI; maxStep = 0.012; break;
      default: return;
    }
    // Contour playback has independent growth and musical travel clocks.
    // Slower model time makes its developing geometry individually readable;
    // the original audio-rate sonification keeps its established rescaling.
    if (shapeTime) rate = SHAPE_TIME_RATES[this._model] * current.speed;
    const requested = rate / this.sampleRate;
    const elapsed = Math.min(requested, MAX_SUBSTEPS * maxStep);
    const steps = Math.max(1, Math.ceil(elapsed / maxStep));
    const h = elapsed / steps;
    this._integrationSteps = steps;
    this._integrationLimited = requested > elapsed;
    for (let index = 0; index < steps; index += 1) {
      switch (this._model) {
        case 'hopf': this._stepHopf(h, parameter); break;
        case 'fold': this._stepFold(h, parameter); break;
        case 'lorenz': this._stepLorenz(h, parameter, current.sigma, current.beta); break;
        case 'rossler': this._stepRossler(h, parameter, current.a, current.b); break;
      }
    }
    // Recovery only catches numerical divergence; normal trajectories are not clipped.
    if (!Number.isFinite(this._x + this._y + this._z) || Math.max(Math.abs(this._x), Math.abs(this._y), Math.abs(this._z)) > 100000) {
      this._startTransition();
      this._seedModel(true);
      this._recoveries += 1;
    }
    // A rest state represented by an exact floating point zero cannot grow.
    // This inaudible seed permits a later positive-μ onset without a reset.
    if (this._model === 'hopf' && parameter > 0 && this._x * this._x + this._y * this._y < 1e-20) this._x = 1e-8;
  }

  _stepHopf(h, mu) {
    const x = this._x, y = this._y;
    let radius2 = x * x + y * y;
    const k1x = (mu - radius2) * x - TAU * y, k1y = TAU * x + (mu - radius2) * y;
    let xx = x + h * k1x / 2, yy = y + h * k1y / 2;
    radius2 = xx * xx + yy * yy;
    const k2x = (mu - radius2) * xx - TAU * yy, k2y = TAU * xx + (mu - radius2) * yy;
    xx = x + h * k2x / 2; yy = y + h * k2y / 2;
    radius2 = xx * xx + yy * yy;
    const k3x = (mu - radius2) * xx - TAU * yy, k3y = TAU * xx + (mu - radius2) * yy;
    xx = x + h * k3x; yy = y + h * k3y;
    radius2 = xx * xx + yy * yy;
    const k4x = (mu - radius2) * xx - TAU * yy, k4y = TAU * xx + (mu - radius2) * yy;
    this._x = x + h * (k1x + 2 * k2x + 2 * k3x + k4x) / 6;
    this._y = y + h * (k1y + 2 * k2y + 2 * k3y + k4y) / 6;
  }

  _stepFold(h, bias) {
    const x = this._x;
    const k1 = bias + x - x * x * x;
    let xx = x + h * k1 / 2;
    const k2 = bias + xx - xx * xx * xx;
    xx = x + h * k2 / 2;
    const k3 = bias + xx - xx * xx * xx;
    xx = x + h * k3;
    const k4 = bias + xx - xx * xx * xx;
    this._x = x + h * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
  }

  _stepLorenz(h, rho, sigma, beta) {
    const x = this._x, y = this._y, z = this._z;
    const k1x = sigma * (y - x), k1y = x * (rho - z) - y, k1z = x * y - beta * z;
    let xx = x + h * k1x / 2, yy = y + h * k1y / 2, zz = z + h * k1z / 2;
    const k2x = sigma * (yy - xx), k2y = xx * (rho - zz) - yy, k2z = xx * yy - beta * zz;
    xx = x + h * k2x / 2; yy = y + h * k2y / 2; zz = z + h * k2z / 2;
    const k3x = sigma * (yy - xx), k3y = xx * (rho - zz) - yy, k3z = xx * yy - beta * zz;
    xx = x + h * k3x; yy = y + h * k3y; zz = z + h * k3z;
    const k4x = sigma * (yy - xx), k4y = xx * (rho - zz) - yy, k4z = xx * yy - beta * zz;
    this._x = x + h * (k1x + 2 * k2x + 2 * k3x + k4x) / 6;
    this._y = y + h * (k1y + 2 * k2y + 2 * k3y + k4y) / 6;
    this._z = z + h * (k1z + 2 * k2z + 2 * k3z + k4z) / 6;
  }

  _stepRossler(h, c, a, b) {
    const x = this._x, y = this._y, z = this._z;
    const k1x = -y - z, k1y = x + a * y, k1z = b + z * (x - c);
    let xx = x + h * k1x / 2, yy = y + h * k1y / 2, zz = z + h * k1z / 2;
    const k2x = -yy - zz, k2y = xx + a * yy, k2z = b + zz * (xx - c);
    xx = x + h * k2x / 2; yy = y + h * k2y / 2; zz = z + h * k2z / 2;
    const k3x = -yy - zz, k3y = xx + a * yy, k3z = b + zz * (xx - c);
    xx = x + h * k3x; yy = y + h * k3y; zz = z + h * k3z;
    const k4x = -yy - zz, k4y = xx + a * yy, k4z = b + zz * (xx - c);
    this._x = x + h * (k1x + 2 * k2x + 2 * k3x + k4x) / 6;
    this._y = y + h * (k1y + 2 * k2y + 2 * k3y + k4y) / 6;
    this._z = z + h * (k1z + 2 * k2z + 2 * k3z + k4z) / 6;
  }

  _iterateLogistic(parameter) {
    this._z = this._y;
    this._y = this._x;
    this._x = clamp(parameter * this._x * (1 - this._x), 0, 1);
  }

  _voice(parameter) {
    const current = this._current;
    let rough, clear;
    if (this._model === 'logistic') {
      if (this._advancePhase(current.frequency * current.speed)) {
        this._iterateLogistic(parameter);
      }
      // One map iteration per carrier cycle: period-2 genuinely alternates
      // complete audio cycles and generates a subharmonic, even in clear mode.
      const envelope = 0.65 + current.depth * 0.85 * (this._x - 0.65);
      clear = Math.sin(TAU * this._phase) * envelope;
      this._orbitSignal = 2 * this._x - 1;
      rough = current.depth * 0.9 * this._orbitSignal + clear * (0.3 - 0.15 * current.depth);
    } else if (this._model === 'hopf') {
      const radius = Math.hypot(this._x, this._y);
      const envelope = Math.min(1, radius / 1.42);
      clear = radius > 1e-20 ? this._x / radius * envelope : 0;
      rough = Math.tanh(this._x * (1 + 4 * current.depth)) * 0.85;
      this._orbitSignal = this._x / 1.42;
      this._advancePhase(current.frequency * current.speed);
    } else if (this._model === 'fold') {
      // A scalar equilibrium has no oscillation to sonify. Its branch controls
      // a steady voice: opposite stable states have audibly different pitches.
      const pitch = current.frequency * Math.pow(2, 0.48 * this._x);
      this._advancePhase(pitch);
      const angle = TAU * this._phase;
      clear = 0.7 * Math.sin(angle);
      rough = 0.65 * Math.sin(angle + current.depth * 0.8 * Math.tanh(this._x) * Math.sin(angle))
        + current.depth * 0.22 * Math.sin(2 * angle) + current.depth * 0.25 * this._x;
      this._orbitSignal = Math.tanh(this._x);
    } else {
      const scale = this._model === 'lorenz' ? 20 : 4 + parameter * 0.85;
      const coordinate = Math.tanh(this._x / scale);
      this._follower += this._followerAlpha * (coordinate - this._follower);
      const pitch = current.frequency * Math.pow(2, (current.regime - 0.5) * 0.45 + this._follower * current.depth * 0.22);
      this._advancePhase(pitch);
      clear = Math.sin(TAU * this._phase) * (0.57 + 0.12 * Math.abs(this._follower));
      this._orbitSignal = coordinate;
      const projection = this._model === 'lorenz'
        ? this._x / 22 + current.depth * this._y / 55
        : this._x / scale + current.depth * this._z / (8 + parameter * 4);
      rough = Math.tanh(projection * (0.8 + 1.8 * current.depth)) * 0.85;
    }
    return rough + current.clarity * (clear - rough);
  }

  sample() {
    const current = this._current;
    this._advanceSweep();
    for (const key of SMOOTH_KEYS) current[key] += this._parameterAlpha * (this.params[key] - current[key]);
    this._gain += this._gainAlpha * ((this.params.playing ? 1 : 0) - this._gain);
    const active = this.params.playing || this._gain > 0.0001;
    const parameter = this._nativeParameter();
    let voice = 0, voiceLeft = 0, voiceRight = 0;
    this._integrationSteps = 0;
    this._integrationLimited = false;
    if (active) {
      if (isShapeSonification(this.params.sonification)) {
        if (this.params.growShape) {
          if (this._model === 'logistic') {
            if (this._advancePhase(8 * current.speed)) this._iterateLogistic(parameter);
          } else this._integrate(parameter, true);
        }
        voice = this.shapeReader.sample(this._model, this._x, this._y, this._z, parameter, current, this.params);
        voiceLeft = this.shapeReader.left ?? voice;
        voiceRight = this.shapeReader.right ?? voice;
      } else {
        if (this._model !== 'logistic') this._integrate(parameter);
        voice = this._voice(parameter);
        voiceLeft = voiceRight = voice;
        this._shapeGap = true;
      }
      this._time += 1 / this.sampleRate;
    } else {
      this._gain = 0;
    }
    if (this._transitionSeconds > 0) {
      const mix = clamp(1 - this._transitionSeconds / 0.025, 0, 1);
      voice = this._transitionSource + mix * (voice - this._transitionSource);
      voiceLeft = this._transitionLeft + mix * (voiceLeft - this._transitionLeft);
      voiceRight = this._transitionRight + mix * (voiceRight - this._transitionRight);
      this._transitionSeconds = Math.max(0, this._transitionSeconds - 1 / this.sampleRate);
    }
    this._lastVoice = voice;
    this._lastVoiceLeft = voiceLeft; this._lastVoiceRight = voiceRight;
    const highpass = voice - this._dcInput + this._dcPole * this._dcOutput;
    this._dcInput = voice;
    this._dcOutput = highpass;
    const cutoff = Math.min(current.cutoff, this.sampleRate * 0.42);
    const filterAlpha = 1 - Math.exp(-TAU * cutoff / this.sampleRate);
    this._lowpass1 += filterAlpha * (highpass - this._lowpass1);
    this._lowpass2 += filterAlpha * (this._lowpass1 - this._lowpass2);
    this._lastOutput = Math.tanh(this._lowpass2 * 1.15) * this._gain * 0.8;
    // The established mono reference remains independent of stereo routing.
    // Every channel gets the same DC/low-pass protection and transport gain.
    const stereo = this._stereoFilters;
    for (let channel = 0; channel < 2; channel++) {
      const offset = channel * 4, input = channel === 0 ? voiceLeft : voiceRight;
      const dc = input - stereo[offset] + this._dcPole * stereo[offset + 1];
      stereo[offset] = input; stereo[offset + 1] = dc;
      stereo[offset + 2] += filterAlpha * (dc - stereo[offset + 2]);
      stereo[offset + 3] += filterAlpha * (stereo[offset + 2] - stereo[offset + 3]);
      const output = Math.tanh(stereo[offset + 3] * 1.15) * this._gain * .8;
      if (channel === 0) this.left = output; else this.right = output;
    }
    return this._lastOutput;
  }

  snapshot() {
    return {
      model: this._model, point: [this._x, this._y, this._z], signal: this._lastOutput,
      orbitSignal: this._orbitSignal, phase: this.phase, nativeParameter: this._nativeParameter(),
      params: { ...this.params }, radius: Math.hypot(this._x, this._y),
      sweep: { running: this._sweepRunning, progress: this._sweepProgress },
      shape: isShapeSonification(this.params.sonification) ? this.shapeReader.snapshot() : null,
      channels: [this.left, this.right],
      diagnostics: { integrationSteps: this._integrationSteps, integrationLimited: this._integrationLimited, recoveries: this._recoveries, paused: !this.params.playing && this._gain === 0, time: this._time },
    };
  }

  /** Allocation-free, bounded telemetry capture; mathematical state only. */
  writeTrace(target, offset = 0) {
    target[offset] = this._x; target[offset + 1] = this._y;
    target[offset + 2] = this._z; target[offset + 3] = this._nativeParameter();
  }

  /** Serializable state in dimensionless coordinates and seconds, without a sample rate. */
  exportState() {
    return {
      version: 1, model: this._model, params: { ...this.params }, current: { ...this._current },
      point: [this._x, this._y, this._z], phase: this._phase, gain: this._gain,
      filter: { dcInput: this._dcInput, dcOutput: this._dcOutput, lowpass1: this._lowpass1, lowpass2: this._lowpass2 },
      voice: this._lastVoice, output: this._lastOutput, orbitSignal: this._orbitSignal, follower: this._follower,
      transition: { source: this._transitionSource, seconds: this._transitionSeconds },
      stereo: { filter: Array.from(this._stereoFilters), voice: [this._lastVoiceLeft, this._lastVoiceRight], output: [this.left, this.right], transition: [this._transitionLeft, this._transitionRight] },
      time: this._time, recoveries: this._recoveries,
      sweep: { running: this._sweepRunning, progress: this._sweepProgress },
      shape: this.shapeReader.exportState(),
      shapeGap: this._shapeGap,
    };
  }

  /** Join a preview at its current orbit. Returns false for an invalid state. */
  importState(state) {
    if (!state || state.version !== 1 || !MODEL_BY_ID[state.model] || !Array.isArray(state.point)
      || state.point.length !== 3 || !state.point.every((value) => finite(value) && Math.abs(value) <= 100000)) return false;
    if (state.stereo) {
      for (const [key, size, limit] of [['filter', 8, 100], ['voice', 2, 100], ['output', 2, .8], ['transition', 2, 100]]) {
        const values = state.stereo[key];
        if (!Array.isArray(values) || values.length !== size || !values.every(value => finite(value) && Math.abs(value) <= limit)) return false;
      }
    }
    if (state.shape && !this.shapeReader.importState(state.shape)) return false;
    this.params = normalizeParams({ ...state.params, model: state.model });
    this._current = normalizeParams({ ...state.current, model: state.model }, this.params);
    this._model = state.model;
    [this._x, this._y, this._z] = state.point;
    const phase = numberOr(state.phase, 0);
    this._phase = phase - Math.floor(phase);
    this._gain = clamp(numberOr(state.gain, 0), 0, 1);
    const filter = state.filter || {};
    this._dcInput = clamp(numberOr(filter.dcInput, 0), -100, 100);
    this._dcOutput = clamp(numberOr(filter.dcOutput, 0), -100, 100);
    this._lowpass1 = clamp(numberOr(filter.lowpass1, 0), -100, 100);
    this._lowpass2 = clamp(numberOr(filter.lowpass2, 0), -100, 100);
    this._lastVoice = clamp(numberOr(state.voice, 0), -100, 100);
    this._lastOutput = clamp(numberOr(state.output, 0), -0.8, 0.8);
    this._orbitSignal = clamp(numberOr(state.orbitSignal, 0), -100, 100);
    this._follower = clamp(numberOr(state.follower, 0), -1, 1);
    this._transitionSource = clamp(numberOr(state.transition?.source, 0), -100, 100);
    this._transitionSeconds = clamp(numberOr(state.transition?.seconds, 0), 0, 0.025);
    if (state.stereo) {
      this._stereoFilters.set(state.stereo.filter);
      [this._lastVoiceLeft, this._lastVoiceRight] = state.stereo.voice;
      [this.left, this.right] = state.stereo.output;
      [this._transitionLeft, this._transitionRight] = state.stereo.transition;
    } else {
      this._stereoFilters.set([this._dcInput, this._dcOutput, this._lowpass1, this._lowpass2, this._dcInput, this._dcOutput, this._lowpass1, this._lowpass2]);
      this._lastVoiceLeft = this._lastVoiceRight = this._lastVoice;
      this.left = this.right = this._lastOutput;
      this._transitionLeft = this._transitionRight = this._transitionSource;
    }
    this._time = Math.max(0, numberOr(state.time, 0));
    this._recoveries = Math.max(0, Math.floor(numberOr(state.recoveries, 0)));
    this._integrationSteps = 0;
    this._integrationLimited = false;
    this._sweepProgress = clamp(numberOr(state.sweep?.progress, 0), 0, 1);
    this._sweepRunning = this._model === 'logistic' && this.params.sonification === 'orbit' && state.sweep?.running === true && this._sweepProgress < 1;
    if (!state.shape) this.shapeReader.reset(this._model, this._x, this._y, this._z, this._nativeParameter());
    this._shapeGap = state.shapeGap === true;
    return true;
  }
}
