import {
  dominantHarmonic,
  mouthFormants,
  reedModeFrequencies,
  sanitizeJawHarpState,
} from "./jaw-harp.js";

const MODE_COUNT = 36;
const TELEMETRY_BLOCKS = 10;
const SILENCE_FLOOR = 1e-9;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

class StateVariableBandpass {
  constructor(rate) {
    this.rate = rate;
    this.low = 0;
    this.band = 0;
    this.frequency = 800;
    this.bandwidth = 120;
    this.coefficient = 0.1;
    this.damping = 0.15;
  }

  configure(frequency, bandwidth) {
    this.frequency = clamp(frequency, 30, this.rate * 0.2);
    this.bandwidth = clamp(bandwidth, 20, this.frequency * 1.6);
    this.coefficient = 2 * Math.sin(Math.PI * this.frequency / this.rate);
    this.damping = clamp(this.bandwidth / this.frequency, 0.025, 1.5);
  }

  reset() {
    this.low = 0;
    this.band = 0;
  }

  process(input) {
    const high = input - this.low - this.damping * this.band;
    this.band += this.coefficient * high;
    this.low += this.coefficient * this.band;
    if (!Number.isFinite(this.band) || Math.abs(this.band) < SILENCE_FLOOR) this.band = 0;
    if (!Number.isFinite(this.low) || Math.abs(this.low) < SILENCE_FLOOR) this.low = 0;
    return this.band * Math.sqrt(this.damping);
  }
}

class JawHarpPhysicalProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = sampleRate;
    this.configuration = sanitizeJawHarpState(
      options.processorOptions?.configuration ?? {},
    );
    this.targetConfiguration = { ...this.configuration };
    this.phases = new Float64Array(MODE_COUNT);
    this.amplitudes = new Float64Array(MODE_COUNT);
    this.frequencies = new Float64Array(MODE_COUNT);
    this.decays = new Float64Array(MODE_COUNT);
    this.mouthFiltersLeft = Array.from({ length: 3 }, () => new StateVariableBandpass(this.rate));
    this.mouthFiltersRight = Array.from({ length: 3 }, () => new StateVariableBandpass(this.rate));
    this.frameFilterLeft = new StateVariableBandpass(this.rate);
    this.frameFilterRight = new StateVariableBandpass(this.rate);
    this.noiseState = 0x4a617748;
    this.clickEnvelope = 0;
    this.clickPolarity = 1;
    this.reedDisplacement = 0;
    this.energy = 0;
    this.lastPeak = 0;
    this.lastRms = 0;
    this.blockCounter = 0;
    this.silenced = false;
    this._updateCoefficients();
    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      this.targetConfiguration = sanitizeJawHarpState({
        ...this.targetConfiguration,
        ...(message.configuration ?? {}),
      }, this.targetConfiguration);
      return;
    }
    if (message.type === "pluck") {
      this._pluck(message.force, message.direction, message.position);
      return;
    }
    if (message.type === "silence") this._silence();
  }

  _random() {
    let value = this.noiseState | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.noiseState = value | 0;
    return (value >>> 0) / 4294967295 * 2 - 1;
  }

  _silence() {
    this.amplitudes.fill(0);
    this.clickEnvelope = 0;
    this.energy = 0;
    this.reedDisplacement = 0;
    for (const filter of [
      ...this.mouthFiltersLeft,
      ...this.mouthFiltersRight,
      this.frameFilterLeft,
      this.frameFilterRight,
    ]) filter.reset();
  }

  _pluck(force, direction, position) {
    this.silenced = false;
    const strength = clamp(Number(force), 0.04, 1);
    const side = Number(direction) < 0 ? -1 : 1;
    const pluckPosition = clamp(Number(position), 0.05, 0.95);
    const stiffness = this.targetConfiguration.reedStiffness;
    const spectralSlope = 0.68 + (1 - stiffness) * 0.82;
    const resetAmount = 0.78;

    for (let index = 0; index < MODE_COUNT; index += 1) {
      const harmonic = index + 1;
      const positionComb = Math.sin(Math.PI * harmonic * pluckPosition);
      const amplitude = side * strength * positionComb
        / Math.pow(harmonic, spectralSlope);
      this.amplitudes[index] = this.amplitudes[index] * (1 - resetAmount)
        + amplitude * resetAmount;
      this.phases[index] = side > 0 ? 0 : Math.PI;
    }
    this.clickEnvelope = 0.42 + strength * 0.58;
    this.clickPolarity = side;
    this.energy = Math.max(this.energy, strength);
  }

  _approachConfiguration() {
    const smooth = 0.16;
    const discrete = new Set(["presetId", "vowelId", "repeat", "pluckDirection"]);
    for (const [key, target] of Object.entries(this.targetConfiguration)) {
      if (discrete.has(key) || typeof target !== "number") {
        this.configuration[key] = target;
      } else {
        this.configuration[key] += (target - this.configuration[key]) * smooth;
      }
    }
    this._updateCoefficients();
  }

  _updateCoefficients() {
    const state = this.configuration;
    const modes = reedModeFrequencies(state, MODE_COUNT);
    const baseDecay = state.reedDecaySeconds;
    const lossTilt = 0.018 + (1 - state.reedStiffness) * 0.055;
    for (let index = 0; index < MODE_COUNT; index += 1) {
      this.frequencies[index] = modes[index];
      const modeDecay = baseDecay / (1 + index * lossTilt);
      this.decays[index] = Math.exp(-1 / Math.max(1, this.rate * modeDecay));
    }

    const formants = mouthFormants(state);
    for (let index = 0; index < 3; index += 1) {
      const frequency = formants.frequenciesHz[index];
      const bandwidth = formants.bandwidthsHz[index];
      this.mouthFiltersLeft[index].configure(frequency * (index === 1 ? 0.997 : 1), bandwidth);
      this.mouthFiltersRight[index].configure(frequency * (index === 1 ? 1.003 : 1), bandwidth * 1.03);
    }
    const frameFrequency = Math.min(
      this.rate * 0.18,
      state.reedFrequencyHz * (3.2 + state.frameCoupling * 9.4),
    );
    const frameBandwidth = 130 + (1 - state.reedStiffness) * 360;
    this.frameFilterLeft.configure(frameFrequency * 0.992, frameBandwidth);
    this.frameFilterRight.configure(frameFrequency * 1.008, frameBandwidth);
  }

  _renderSource() {
    const state = this.configuration;
    let sum = 0;
    let fundamental = 0;
    let energy = 0;
    const maximumFrequency = this.rate * 0.44;

    for (let index = 0; index < MODE_COUNT; index += 1) {
      const frequency = this.frequencies[index];
      if (frequency >= maximumFrequency) continue;
      const amplitude = this.amplitudes[index];
      if (Math.abs(amplitude) < SILENCE_FLOOR) {
        this.amplitudes[index] = 0;
        continue;
      }
      this.phases[index] += Math.PI * 2 * frequency / this.rate;
      if (this.phases[index] > Math.PI * 2) this.phases[index] -= Math.PI * 2;
      const value = Math.sin(this.phases[index]) * amplitude;
      sum += value;
      if (index === 0) fundamental = value;
      energy += amplitude * amplitude;
      this.amplitudes[index] *= this.decays[index];
    }

    this.reedDisplacement = fundamental;
    this.energy += (Math.sqrt(energy) - this.energy) * 0.0018;
    const edge = 1.4 + state.reedStiffness * 5.8;
    const nonlinear = Math.tanh(sum * edge) / edge;
    const clickNoise = this._random() * this.clickEnvelope * this.clickPolarity;
    this.clickEnvelope *= 0.992 - state.frameCoupling * 0.0015;
    if (this.clickEnvelope < SILENCE_FLOOR) this.clickEnvelope = 0;
    const breathActivity = clamp(this.energy * 2.4);
    const breathNoise = this._random() * state.breath * breathActivity * 0.1;
    return nonlinear * 0.78 + clickNoise * 0.1 + breathNoise;
  }

  _radiate(source, side) {
    const state = this.configuration;
    const filters = side < 0 ? this.mouthFiltersLeft : this.mouthFiltersRight;
    const weights = [0.72, 1, 0.46];
    let cavity = 0;
    for (let index = 0; index < 3; index += 1) {
      cavity += filters[index].process(source) * weights[index];
    }
    const coupling = state.cavityCoupling;
    const openGlottisLoss = 1 - state.glottisOpening * 0.18;
    const mouth = (source * (0.2 + (1 - coupling) * 0.34) + cavity * coupling * 2.45)
      * openGlottisLoss;
    const frameFilter = side < 0 ? this.frameFilterLeft : this.frameFilterRight;
    const frame = frameFilter.process(source) * (0.5 + state.reedStiffness * 0.7);
    return mouth + frame * state.frameCoupling * 0.72;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    const leftOutput = output[0];
    const rightOutput = output[1] ?? leftOutput;
    this._approachConfiguration();
    let squareSum = 0;
    let peak = 0;

    for (let frame = 0; frame < leftOutput.length; frame += 1) {
      const source = this._renderSource();
      const left = Math.tanh(this._radiate(source, -1) * 1.42) * 0.82;
      const right = Math.tanh(this._radiate(source, 1) * 1.42) * 0.82;
      leftOutput[frame] = left;
      rightOutput[frame] = right;
      const magnitude = Math.max(Math.abs(left), Math.abs(right));
      peak = Math.max(peak, magnitude);
      squareSum += (left * left + right * right) * 0.5;
    }

    const rms = Math.sqrt(squareSum / Math.max(1, leftOutput.length));
    this.lastPeak += (peak - this.lastPeak) * 0.28;
    this.lastRms += (rms - this.lastRms) * 0.2;
    this.blockCounter += 1;
    if (this.blockCounter % TELEMETRY_BLOCKS === 0) {
      const formants = mouthFormants(this.configuration);
      const selected = dominantHarmonic(this.configuration);
      this.port.postMessage({
        type: "telemetry",
        displacement: this.reedDisplacement,
        energy: this.energy,
        peak: this.lastPeak,
        rms: this.lastRms,
        formants: formants.frequenciesHz,
        focusFrequencyHz: formants.focusFrequencyHz,
        harmonicIndex: selected.index,
        harmonicFrequencyHz: selected.frequencyHz,
      });
    }
    return true;
  }
}

registerProcessor("jaw-harp-physical-model", JawHarpPhysicalProcessor);

export { JawHarpPhysicalProcessor };
