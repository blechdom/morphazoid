import {
  breathDirectionAllowed,
  clamp,
  directionalModeWeight,
  excitationGain,
  instrumentPreset,
  modeFrequencies,
  mouthFormants,
  sanitizeBreathAtlasState,
  sourceNeedsGesture,
  sourceRequiresBreath,
} from "./breath-atlas.js";

const MODE_COUNT = 24;
const SILENCE_FLOOR = 1e-8;

class ResonantBandpass {
  constructor(rate) {
    this.rate = rate;
    this.low = 0;
    this.band = 0;
    this.coefficient = 0.1;
    this.damping = 0.2;
  }

  configure(frequency, bandwidth) {
    const safeFrequency = clamp(frequency, 30, this.rate * 0.2);
    const safeBandwidth = clamp(bandwidth, 18, safeFrequency * 1.55);
    this.coefficient = 2 * Math.sin(Math.PI * safeFrequency / this.rate);
    this.damping = clamp(safeBandwidth / safeFrequency, 0.025, 1.45);
  }

  reset() {
    this.low = 0;
    this.band = 0;
  }

  process(input) {
    const high = input - this.low - this.damping * this.band;
    this.band += this.coefficient * high;
    this.low += this.coefficient * this.band;
    if (!Number.isFinite(this.band)) this.reset();
    return this.band * Math.sqrt(this.damping);
  }
}

class BreathAtlasPhysicalProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = sampleRate;
    this.configuration = sanitizeBreathAtlasState(options.processorOptions?.configuration ?? {});
    this.targetConfiguration = { ...this.configuration };
    this.preset = instrumentPreset(this.configuration.instrumentId);
    this.phases = new Float64Array(MODE_COUNT);
    this.frequencies = new Float64Array(MODE_COUNT);
    this.amplitudes = new Float64Array(MODE_COUNT);
    this.stringEnergy = new Float64Array(MODE_COUNT);
    this.mouthLeft = Array.from({ length: 3 }, () => new ResonantBandpass(this.rate));
    this.mouthRight = Array.from({ length: 3 }, () => new ResonantBandpass(this.rate));
    this.bodyLeft = new ResonantBandpass(this.rate);
    this.bodyRight = new ResonantBandpass(this.rate);
    this.targetBreathFlow = 0;
    this.breathFlow = 0;
    this.gestureActive = false;
    this.gestureEnergy = 0;
    this.gestureForce = this.configuration.gestureForce;
    this.reedPosition = 0;
    this.reedVelocity = 0;
    this.jetMemory = 0;
    this.noiseMemory = 0;
    this.noiseState = 0x42726561;
    this.rms = 0;
    this.peak = 0;
    this.sourceMotion = 0;
    this.blockCounter = 0;
    this._updateCoefficients(true);
    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      const previousId = this.targetConfiguration.instrumentId;
      this.targetConfiguration = sanitizeBreathAtlasState({
        ...this.targetConfiguration,
        ...(message.configuration ?? {}),
      }, this.targetConfiguration);
      if (previousId !== this.targetConfiguration.instrumentId) this._changeInstrument();
      return;
    }
    if (message.type === "breath") {
      this.targetBreathFlow = clamp(message.flow, -1, 1);
      return;
    }
    if (message.type === "gesture") {
      this._setGesture(Boolean(message.active), message.force);
      return;
    }
    if (message.type === "excite") {
      this._strike(message.force);
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

  _changeInstrument() {
    this.configuration = { ...this.targetConfiguration };
    this.preset = instrumentPreset(this.configuration.instrumentId);
    this.phases.fill(0);
    this.amplitudes.fill(0);
    this.stringEnergy.fill(0);
    this.gestureActive = false;
    this.gestureEnergy = 0;
    this.reedPosition = 0;
    this.reedVelocity = 0;
    this._updateCoefficients(true);
  }

  _silence() {
    this.targetBreathFlow = 0;
    this.breathFlow = 0;
    this.gestureActive = false;
    this.gestureEnergy = 0;
    this.amplitudes.fill(0);
    this.stringEnergy.fill(0);
    this.reedPosition = 0;
    this.reedVelocity = 0;
    this.jetMemory = 0;
    this.noiseMemory = 0;
    for (const filter of [...this.mouthLeft, ...this.mouthRight, this.bodyLeft, this.bodyRight]) {
      filter.reset();
    }
  }

  _setGesture(active, force = this.configuration.gestureForce) {
    this.gestureActive = active;
    this.gestureForce = clamp(force, 0.05, 1);
    if (active && ["pluck", "pluck-string"].includes(this.preset.gesture)) this._strike(force);
    if (active && this.preset.topology === "jawReed") this._strike(force);
  }

  _strike(force = this.configuration.gestureForce) {
    const strength = clamp(force, 0.05, 1);
    this.gestureEnergy = Math.max(this.gestureEnergy, strength);
    const slope = this.preset.topology === "jawReed" ? 0.58 : 0.82;
    for (let index = 0; index < MODE_COUNT; index += 1) {
      const harmonic = index + 1;
      const comb = Math.abs(Math.sin(harmonic * Math.PI * 0.31));
      const energy = strength * (0.25 + comb * 0.75) / harmonic ** slope;
      this.stringEnergy[index] = Math.max(this.stringEnergy[index], energy);
      this.phases[index] = index % 2 ? Math.PI * 0.5 : 0;
    }
  }

  _approachConfiguration() {
    const discrete = new Set(["instrumentId", "autoBreath"]);
    for (const [key, target] of Object.entries(this.targetConfiguration)) {
      if (discrete.has(key) || typeof target !== "number") this.configuration[key] = target;
      else this.configuration[key] += (target - this.configuration[key]) * 0.12;
    }
    this.preset = instrumentPreset(this.configuration.instrumentId);
    this._updateCoefficients();
  }

  _updateCoefficients(reset = false) {
    const direction = this.breathFlow < 0 ? -1 : 1;
    const frequencies = modeFrequencies(this.configuration, direction, MODE_COUNT);
    for (let index = 0; index < MODE_COUNT; index += 1) {
      this.frequencies[index] = frequencies[index];
    }

    const formants = mouthFormants(this.configuration);
    for (let index = 0; index < 3; index += 1) {
      this.mouthLeft[index].configure(formants.frequenciesHz[index] * (index === 1 ? 0.996 : 1), formants.bandwidthsHz[index]);
      this.mouthRight[index].configure(formants.frequenciesHz[index] * (index === 1 ? 1.004 : 1), formants.bandwidthsHz[index] * 1.035);
    }
    const bodyFrequency = clamp(
      343 / Math.max(0.12, this.configuration.boreLengthM) * (this.preset.topology === "lipReed" ? 0.25 : 0.5),
      55,
      1_900,
    );
    this.bodyLeft.configure(bodyFrequency * 0.993, 70 + this.configuration.damping * 330);
    this.bodyRight.configure(bodyFrequency * 1.007, 74 + this.configuration.damping * 340);
    if (reset) {
      for (const filter of [...this.mouthLeft, ...this.mouthRight, this.bodyLeft, this.bodyRight]) filter.reset();
    }
  }

  _physicalFlow() {
    this.breathFlow += (this.targetBreathFlow - this.breathFlow) * 0.0016;
    if (Math.abs(this.breathFlow) < 1e-5 && Math.abs(this.targetBreathFlow) < 1e-5) this.breathFlow = 0;
    if (!breathDirectionAllowed(this.preset, this.breathFlow)) return 0;
    return this.breathFlow;
  }

  _renderModeBank(flow, drive) {
    const state = this.configuration;
    const direction = flow < 0 ? -1 : 1;
    const flowMagnitude = Math.abs(flow);
    const topology = this.preset.topology;
    const gestureDriven = topology === "mouthBow" || topology === "jawReed";
    const isContinuousGesture = this.gestureActive && ["bow", "rub"].includes(this.preset.gesture);
    const attack = topology === "freeReed" ? 0.00042 : topology === "lipReed" ? 0.0003 : 0.00062;
    const release = topology === "edgeTone" ? 0.00018 : 0.00008;
    let sum = 0;
    let motion = 0;

    for (let index = 0; index < MODE_COUNT; index += 1) {
      const frequency = this.frequencies[index];
      if (frequency >= this.rate * 0.44) continue;
      const weight = directionalModeWeight(this.preset, direction, index);
      let target = drive * weight * (0.18 + state.brightness * 0.2);

      if (gestureDriven) {
        if (isContinuousGesture) {
          const bowComb = 0.42 + Math.abs(Math.sin((index + 1) * 1.73)) * 0.58;
          this.stringEnergy[index] += (this.gestureForce * bowComb / (index + 1) ** 0.72 - this.stringEnergy[index]) * 0.00022;
        }
        target = this.stringEnergy[index] * weight;
        const loss = 0.999985 - state.damping * (0.000012 + index * 0.0000018);
        const breathSustain = topology === "jawReed" ? flowMagnitude * 0.000012 : 0;
        this.stringEnergy[index] *= Math.min(0.999999, loss + breathSustain);
      }

      const approach = target > this.amplitudes[index] ? attack : release;
      this.amplitudes[index] += (target - this.amplitudes[index]) * approach;
      if (Math.abs(this.amplitudes[index]) < SILENCE_FLOOR && target === 0) this.amplitudes[index] = 0;
      const pressureBend = 1 + flow * (
        topology === "freeReed" ? 0.006 : topology === "stringWind" ? 0.0035 : 0.0015
      );
      this.phases[index] += Math.PI * 2 * frequency * pressureBend / this.rate;
      if (this.phases[index] > Math.PI * 2) this.phases[index] -= Math.PI * 2;
      const phaseOffset = direction < 0 ? -0.26 : 0.14;
      const value = Math.sin(this.phases[index] + phaseOffset * Math.min(1, index)) * this.amplitudes[index];
      sum += value;
      if (index === 0) motion = value;
    }
    this.sourceMotion = motion;
    return sum;
  }

  _renderSource() {
    const state = this.configuration;
    const flow = this._physicalFlow();
    const flowMagnitude = Math.abs(flow);
    const topology = this.preset.topology;
    const drive = excitationGain(this.configuration, flow, this.gestureEnergy);
    let modal = this._renderModeBank(flow, drive);

    if (topology === "freeReed") {
      const pressure = Math.sign(flow) * drive;
      const stiffness = 0.005 + this.configuration.sourcePitchHz / this.rate * 0.25;
      const opening = clamp(0.58 - this.reedPosition * Math.sign(flow || 1), 0, 1.2);
      const jet = pressure * opening * Math.sqrt(Math.abs(pressure) + 1e-8);
      this.reedVelocity += (jet - this.reedPosition * stiffness - this.reedVelocity * 0.018) * 0.11;
      this.reedPosition += this.reedVelocity;
      this.reedPosition = clamp(this.reedPosition, -1.3, 1.3);
      modal += (this.reedPosition - jet * 0.24) * drive * 0.14;
    } else if (topology === "lipReed") {
      const pressure = Math.max(0, flow);
      const lipClosure = Math.tanh(modal * (2.2 + this.configuration.brightness * 2.6));
      modal = (modal + lipClosure * 0.65) * pressure;
    } else if (topology === "edgeTone") {
      const noise = this._random();
      this.jetMemory += (noise - this.jetMemory) * (0.08 + this.configuration.brightness * 0.24);
      modal = modal * 0.72 + this.jetMemory * drive * 0.18;
    } else if (topology === "stringWind") {
      const pressureSkew = 1 + Math.sign(flow) * modal * 0.42;
      modal *= drive * pressureSkew;
    } else if (topology === "mouthBow") {
      this.gestureEnergy *= this.gestureActive ? 0.99999 : 0.99982;
      const breathLoad = state.dryResonance + flowMagnitude * (1 - state.dryResonance);
      modal *= 0.18 + breathLoad * 0.82;
    } else if (topology === "jawReed") {
      this.gestureEnergy *= this.gestureActive ? 0.99996 : 0.9997;
      const breathLoad = state.dryResonance + flowMagnitude * (1 - state.dryResonance);
      modal *= 0.12 + breathLoad * 0.98;
    }

    const rawNoise = this._random();
    const noiseSpeed = flow < 0 ? 0.06 : 0.2;
    this.noiseMemory += (rawNoise - this.noiseMemory) * noiseSpeed;
    const breathNoise = this.noiseMemory * flowMagnitude * (
      topology === "mouthBow" ? 0.018 : topology === "edgeTone" ? 0.12 : 0.045
    );
    if (sourceRequiresBreath(this.preset) && drive <= 0) modal = 0;
    return Math.tanh(modal * (1.6 + this.configuration.brightness * 2.2)) * 0.55 + breathNoise;
  }

  _radiate(source, side) {
    const state = this.configuration;
    const filters = side < 0 ? this.mouthLeft : this.mouthRight;
    const bodyFilter = side < 0 ? this.bodyLeft : this.bodyRight;
    const flowDirection = this.breathFlow < 0 ? -1 : 1;
    const directionWeights = flowDirection < 0 ? [1.05, 0.62, 0.28] : [0.7, 1.05, 0.58];
    let mouth = 0;
    for (let index = 0; index < filters.length; index += 1) {
      mouth += filters[index].process(source) * directionWeights[index];
    }
    const body = bodyFilter.process(source);
    const mouthImportance = this.preset.topology === "mouthBow" || this.preset.topology === "jawReed" ? 1.9 : 1.15;
    const gestureSource = this.preset.topology === "mouthBow" || this.preset.topology === "jawReed";
    const breathLoad = gestureSource
      ? state.dryResonance + Math.abs(this.breathFlow) * (1 - state.dryResonance)
      : 1;
    const glottalLoss = 1 - state.glottisOpening * 0.13;
    return (
      source * (0.12 + (1 - state.coupling) * 0.36)
      + mouth * state.coupling * mouthImportance * breathLoad
      + body * (0.22 + state.coupling * 0.52) * (0.3 + breathLoad * 0.7)
    ) * glottalLoss;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    const left = output[0];
    const right = output[1] ?? left;
    this._approachConfiguration();
    let squareSum = 0;
    let peak = 0;
    for (let frame = 0; frame < left.length; frame += 1) {
      const source = this._renderSource();
      const leftValue = Math.tanh(this._radiate(source, -1) * 1.35) * 0.72;
      const rightValue = Math.tanh(this._radiate(source, 1) * 1.35) * 0.72;
      left[frame] = leftValue;
      right[frame] = rightValue;
      squareSum += (leftValue * leftValue + rightValue * rightValue) * 0.5;
      peak = Math.max(peak, Math.abs(leftValue), Math.abs(rightValue));
    }
    const rms = Math.sqrt(squareSum / Math.max(1, left.length));
    this.rms += (rms - this.rms) * 0.22;
    this.peak += (peak - this.peak) * 0.28;
    this.blockCounter += 1;
    if (this.blockCounter % 9 === 0) {
      this.port.postMessage({
        type: "telemetry",
        breathFlow: this.breathFlow,
        gestureEnergy: this.gestureEnergy,
        sourceMotion: this.sourceMotion,
        rms: this.rms,
        peak: this.peak,
        topology: this.preset.topology,
        breathRequired: sourceRequiresBreath(this.preset),
        gestureRequired: sourceNeedsGesture(this.preset),
      });
    }
    return true;
  }
}

registerProcessor("breath-atlas-physical-model", BreathAtlasPhysicalProcessor);

export { BreathAtlasPhysicalProcessor };
