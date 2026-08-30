import {
  WAVE_POOL_LANE_IDS,
  WAVE_POOL_SEQUENCE_LENGTH,
  createWavePoolState,
  createWavePoolRuntime,
  deriveWavePoolPhysics,
  sanitizeWavePoolState,
  stepWavePool,
} from "./wave-pool.js";

const TAU = Math.PI * 2;
const AIR_PRESSURE_PA = 101_325;
const WATER_DENSITY_KG_M3 = 998;
const GRAVITY_M_S2 = 9.81;
const AIR_HEAT_RATIO = 1.4;
const BUBBLE_VOICE_COUNT = 24;
const BOUNDARY_MODE_COUNT = 4;
// Slightly below 0.72 so Float32 output remains <= 0.72 under strict checks.
const OUTPUT_CEILING = 0.719;
const SOURCE_DRIVE = 2.15;
const TELEMETRY_RATE_HZ = 24;
const SILENCE_FLOOR = 1e-14;
const EMPTY_EVENTS = Object.freeze([]);
const AudioWorkletProcessorBase = globalThis.AudioWorkletProcessor ?? class {
  constructor() {
    this.port = { onmessage: null, postMessage() {} };
  }
};

function finite(value, fallback = 0) {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, minimum = 0, maximum = 1, fallback = minimum) {
  return Math.min(maximum, Math.max(minimum, finite(value, fallback)));
}

function wrap(value, length) {
  const integer = Math.trunc(finite(value, 0));
  return length > 0 ? ((integer % length) + length) % length : 0;
}

function firstFinite(source, keys, fallback) {
  if (source && typeof source === "object") {
    for (let index = 0; index < keys.length; index += 1) {
      const value = Number(source[keys[index]]);
      if (Number.isFinite(value)) return value;
    }
  }
  return fallback;
}

function firstString(source, keys, fallback) {
  if (source && typeof source === "object") {
    for (let index = 0; index < keys.length; index += 1) {
      const value = source[keys[index]];
      if (typeof value === "string" && value) return value;
    }
  }
  return fallback;
}

function clean(value) {
  return Number.isFinite(value) && Math.abs(value) >= SILENCE_FLOOR ? value : 0;
}

function decayCoefficient(seconds, rate) {
  return Math.exp(-1 / Math.max(1, seconds * rate));
}

function powerLawSample(random, minimum, maximum, exponent) {
  const u = clamp(random, 0, 1, 0.5);
  const power = 1 - exponent;
  const low = minimum ** power;
  const high = maximum ** power;
  return (low + (high - low) * u) ** (1 / power);
}

function minnaertFrequencyHz(radiusMm, depthM = 0) {
  const radiusM = clamp(radiusMm, 0.12, 40, 1) * 0.001;
  const pressure = AIR_PRESSURE_PA
    + WATER_DENSITY_KG_M3 * GRAVITY_M_S2 * clamp(depthM, 0, 8, 0);
  return 1 / (TAU * radiusM)
    * Math.sqrt(3 * AIR_HEAT_RATIO * pressure / WATER_DENSITY_KG_M3);
}

class BandNoise {
  constructor(rate, lowHz, highHz) {
    this.rate = rate;
    this.lowState = 0;
    this.highState = 0;
    this.configure(lowHz, highHz);
  }

  configure(lowHz, highHz) {
    const low = clamp(lowHz, 5, this.rate * 0.18, 80);
    const high = clamp(highHz, low + 5, this.rate * 0.44, 2_000);
    this.lowAlpha = 1 - Math.exp(-TAU * low / this.rate);
    this.highAlpha = 1 - Math.exp(-TAU * high / this.rate);
  }

  reset() {
    this.lowState = 0;
    this.highState = 0;
  }

  process(input) {
    this.lowState += (input - this.lowState) * this.lowAlpha;
    this.highState += (input - this.highState) * this.highAlpha;
    return clean(this.highState - this.lowState);
  }
}

class OnePoleLowpass {
  constructor() {
    this.state = 0;
  }

  process(input, alpha) {
    this.state += (input - this.state) * alpha;
    this.state = clean(this.state);
    return this.state;
  }

  reset() {
    this.state = 0;
  }
}

class DampedMode {
  constructor(rate, frequencyHz = 220, decaySeconds = 0.2, gain = 0.1) {
    this.rate = rate;
    this.y1 = 0;
    this.y2 = 0;
    this.configure(frequencyHz, decaySeconds, gain);
  }

  configure(frequencyHz, decaySeconds, gain = this.gain) {
    const frequency = clamp(frequencyHz, 12, this.rate * 0.44, 220);
    const decay = clamp(decaySeconds, 0.004, 3, 0.2);
    const radius = Math.exp(-1 / Math.max(1, decay * this.rate));
    const angle = TAU * frequency / this.rate;
    this.coefficient = 2 * radius * Math.cos(angle);
    this.radiusSquared = radius * radius;
    this.gain = clamp(gain, 0, 1, 0.1);
    // The raw two-pole impulse response grows as 1/sin(angle), especially for
    // low machinery and air-pocket modes. This normalization makes `gain`
    // describe the ringing amplitude instead of allowing bass modes to pin the
    // safety limiter.
    this.excitationGain = this.gain * Math.max(0.002, Math.abs(Math.sin(angle)));
  }

  excite(amount) {
    this.y1 = clamp(this.y1 + finite(amount) * this.excitationGain, -2, 2, 0);
  }

  process() {
    let output = this.coefficient * this.y1 - this.radiusSquared * this.y2;
    if (!Number.isFinite(output) || Math.abs(output) < SILENCE_FLOOR) output = 0;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }

  reset() {
    this.y1 = 0;
    this.y2 = 0;
  }
}

class BubbleVoice {
  constructor(rate) {
    this.rate = rate;
    this.reset();
  }

  arm(frequencyHz, amplitude, decaySeconds, delayFrames, pan, character = 0, seed = 1) {
    this.frequencyHz = clamp(frequencyHz, 45, this.rate * 0.43, 3_200);
    this.phaseIncrement = TAU * this.frequencyHz / this.rate;
    const variation = clamp(character, -1, 1, 0);
    const chirpRatio = 0.7 + (variation + 1) * 0.075;
    const lifetime = clamp(decaySeconds, 0.005, 0.07, 0.022);
    this.phaseIncrementScale = Math.exp(
      Math.log(chirpRatio) / Math.max(1, lifetime * this.rate),
    );
    this.amplitude = clamp(amplitude, 0, 0.14, 0.018);
    this.initialAmplitude = this.amplitude;
    this.decay = decayCoefficient(lifetime, this.rate);
    this.delayFrames = Math.max(0, Math.round(finite(delayFrames, 0)));
    this.phase = (variation + 1) * Math.PI;
    this.ageFrames = 0;
    this.attackFrames = Math.max(1, Math.round(this.rate * 0.0015));
    this.noiseState = (Math.trunc(finite(seed, 1)) >>> 0) || 1;
    this.noiseFast = 0;
    this.noiseSlow = 0;
    this.previousNoise = 0;
    this.noiseFastAlpha = clamp(TAU * this.frequencyHz / this.rate * 0.72, 0.025, 0.42, 0.1);
    this.noiseSlowAlpha = this.noiseFastAlpha * 0.16;
    this.roughness = 0.48 + Math.abs(variation) * 0.18;
    const stereoPan = clamp(pan, -1, 1, 0);
    this.leftGain = Math.sqrt((1 - stereoPan) * 0.5);
    this.rightGain = Math.sqrt((1 + stereoPan) * 0.5);
    this.active = true;
  }

  process() {
    if (!this.active) {
      this.sample = 0;
      return 0;
    }
    if (this.delayFrames > 0) {
      this.delayFrames -= 1;
      this.sample = 0;
      return 0;
    }
    let randomState = this.noiseState | 0;
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    this.noiseState = randomState >>> 0;
    const noise = this.noiseState / 0x8000_0000 - 1;
    this.noiseFast += (noise - this.noiseFast) * this.noiseFastAlpha;
    this.noiseSlow += (noise - this.noiseSlow) * this.noiseSlowAlpha;
    const pressureGrain = this.noiseFast - this.noiseSlow;
    const onset = Math.min(1, (this.ageFrames + 1) / this.attackFrames);
    const pop = (noise - this.previousNoise) * (1 - onset) * 0.18;
    this.previousNoise = noise;

    this.phaseIncrement *= this.phaseIncrementScale;
    this.phase += this.phaseIncrement * (1 + pressureGrain * 0.035);
    if (this.phase >= TAU) this.phase -= TAU;
    const resonance = Math.sin(this.phase) * (0.22 + onset * 0.08);
    this.sample = this.amplitude * onset * (
      resonance + pressureGrain * this.roughness + pop
    );
    this.ageFrames += 1;
    this.amplitude *= this.decay;
    if (this.amplitude < 1e-5) this.reset();
    return this.sample;
  }

  reset() {
    this.frequencyHz = 0;
    this.phase = 0;
    this.phaseIncrement = 0;
    this.phaseIncrementScale = 1;
    this.amplitude = 0;
    this.initialAmplitude = 0;
    this.decay = 0;
    this.delayFrames = 0;
    this.ageFrames = 0;
    this.attackFrames = 1;
    this.noiseState = 1;
    this.noiseFast = 0;
    this.noiseSlow = 0;
    this.previousNoise = 0;
    this.noiseFastAlpha = 0.1;
    this.noiseSlowAlpha = 0.016;
    this.roughness = 0.5;
    this.leftGain = Math.SQRT1_2;
    this.rightGain = Math.SQRT1_2;
    this.sample = 0;
    this.active = false;
  }
}

class FeedForwardDelay {
  constructor(rate, maximumSeconds = 0.08) {
    this.rate = rate;
    this.buffer = new Float64Array(Math.max(4, Math.ceil(rate * maximumSeconds) + 2));
    this.writeIndex = 0;
  }

  process(input, delayFrames) {
    const frames = Math.round(clamp(delayFrames, 1, this.buffer.length - 2, 1));
    const readIndex = (this.writeIndex - frames + this.buffer.length) % this.buffer.length;
    const output = this.buffer[readIndex] || 0;
    this.buffer[this.writeIndex] = Number.isFinite(input) ? input : 0;
    this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
    return output;
  }

  reset() {
    this.buffer.fill(0);
    this.writeIndex = 0;
  }
}

class WavePoolPhysicalProcessor extends AudioWorkletProcessorBase {
  constructor(options = {}) {
    super();
    const processorOptions = options.processorOptions ?? {};
    const supplied = processorOptions.configuration
      ?? processorOptions.state
      ?? processorOptions
      ?? {};
    this.rate = clamp(globalThis.sampleRate, 8_000, 384_000, 48_000);
    const defaults = createWavePoolState();
    this.configuration = sanitizeWavePoolState(supplied, defaults);
    this.modelConfiguration = sanitizeWavePoolState(
      { sequencerEnabled: false },
      this.configuration,
    );
    this.runtime = createWavePoolRuntime();
    this.physics = deriveWavePoolPhysics(this.configuration);
    this.playing = Boolean(processorOptions.playing ?? supplied.playing ?? false);
    this.initialSeed = (Math.trunc(finite(processorOptions.seed ?? supplied.seed, 0x57617665)) || 1) >>> 0;
    this.randomState = this.initialSeed;

    this.bubbles = Array.from(
      { length: BUBBLE_VOICE_COUNT },
      () => new BubbleVoice(this.rate),
    );
    this.boundaryModes = Array.from(
      { length: BOUNDARY_MODE_COUNT },
      (_, index) => new DampedMode(this.rate, 120 * (index + 1), 0.18, 0.06),
    );
    this.machineLowMode = new DampedMode(this.rate, 58, 0.16, 0.14);
    this.machineHighMode = new DampedMode(this.rate, 146, 0.08, 0.07);
    this.airPocketMode = new DampedMode(this.rate, 320, 0.08, 0.06);
    this.gurgleMode = new DampedMode(this.rate, 96, 0.13, 0.08);

    this.machineBand = new BandNoise(this.rate, 70, 1_450);
    this.impactBand = new BandNoise(this.rate, 190, 8_500);
    this.sprayBand = new BandNoise(this.rate, 1_600, 12_500);
    this.vortexBand = new BandNoise(this.rate, 45, 1_650);
    this.pressureBand = new BandNoise(this.rate, 18, 280);
    this.turbulenceBand = new BandNoise(this.rate, 75, 2_200);
    this.foamBand = new BandNoise(this.rate, 700, 9_000);
    this.flowModulator = new OnePoleLowpass();
    this.reflectionLeft = new FeedForwardDelay(this.rate);
    this.reflectionRight = new FeedForwardDelay(this.rate);
    this.receiverLowpassLeft = new OnePoleLowpass();
    this.receiverLowpassRight = new OnePoleLowpass();

    this.telemetryQuantum = Math.max(128, Math.round(this.rate / TELEMETRY_RATE_HZ));
    this.telemetryCountdown = this.telemetryQuantum;
    this.peak = 0;
    this.rms = 0;
    this.renderedLeft = 0;
    this.renderedRight = 0;
    this.sequenceStepIndex = 0;
    this.sequenceFramesUntilStep = 0;
    this.sequencePendingInitialStep = true;
    this._clearDynamicState();
    this._configurePhysics();
    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _clearDynamicState() {
    this.pistonEnvelope = 0;
    this.returnEnvelope = 0;
    this.valveEnvelope = 0;
    this.whooshEnvelope = 0;
    this.breakerImpulseEnvelope = 0;
    this.splashEnvelope = 0;
    this.slapEnvelope = 0;
    this.vortexEnvelope = 0;
    this.gurgleEnvelope = 0;
    this.surfaceEnergy = 0;
    this.breakerEnergy = 0;
    this.wallEnergy = 0;
    this.vortexStrength = 0;
    this.runtimeVortexTarget = 0;
    this.runtimeMachineryTarget = 0;
    this.runtimeWaterPressureTarget = 0;
    this.runtimeTurbulenceTarget = 0;
    this.runtimeFoamTarget = 0;
    this.machineryBed = 0;
    this.breakerPan = 0;
    this.wallPan = 0.42;
    this.returnCountdown = -1;
    this.gurgleCooldown = 0;
    this.swirlPhase = 0;
    this.previousNoise = 0;
    this.waterPressureEnvelope = 0;
    this.turbulenceEnvelope = 0;
    this.foamEnvelope = 0;
    this.dcInputLeft = 0;
    this.dcOutputLeft = 0;
    this.dcInputRight = 0;
    this.dcOutputRight = 0;
    this.peak = 0;
    this.rms = 0;
    this.renderedLeft = 0;
    this.renderedRight = 0;
  }

  _configurePhysics() {
    const physics = this.physics ?? {};
    const generator = physics.generator ?? physics.resolvedGenerator ?? {};
    const boundary = physics.boundary ?? physics.resolvedBoundary ?? {};
    this.generatorId = firstString(
      generator,
      ["id", "type", "generatorId"],
      firstString(this.configuration, ["generatorId", "generatorType"], "piston"),
    );
    this.boundaryId = firstString(
      boundary,
      ["id", "type", "boundaryId"],
      firstString(this.configuration, ["boundaryId", "materialId"], "concrete"),
    );
    this.isPneumatic = /pneumatic|caisson|air/i.test(this.generatorId);
    // The app owns the visible master GainNode. Keeping the worklet normalized
    // avoids applying state.level twice while the final tanh still enforces the
    // processor's independent safety ceiling.
    this.outputLevel = 1;
    this.aeration = clamp(
      firstFinite(this.configuration, ["aeration", "aerationAmount", "bubbleAmount"], 0.48),
      0,
      1,
      0.48,
    );
    this.bubbleDensity = clamp(this.configuration.bubbleDensity, 0, 1, 0.38);
    this.machineryAmount = clamp(this.configuration.machinery, 0, 1, 0.24);
    this.whirlpoolAmount = clamp(this.configuration.whirlpool, 0, 1, 0.32);
    this.bubbleDepthM = clamp(
      firstFinite(physics, ["bubbleDepthM"], firstFinite(
        this.configuration,
        ["listenerDepthM", "bubbleDepthM"],
        0.18,
      )),
      0,
      8,
      0.18,
    );
    this.referenceBubbleRadiusMm = clamp(
      firstFinite(physics, ["bubbleRadiusMm"], firstFinite(
        this.configuration,
        ["bubbleSize", "bubbleRadiusMm", "bubbleSizeMm"],
        1,
      )),
      0.2,
      12,
      1,
    );
    this.referenceBubbleFrequencyHz = clamp(
      firstFinite(physics, ["bubbleFrequencyHz"], minnaertFrequencyHz(
        this.referenceBubbleRadiusMm,
        this.bubbleDepthM,
      )),
      45,
      this.rate * 0.43,
      3_200,
    );
    this.swirlRateHz = clamp(
      firstFinite(this.configuration, ["vortexRateHz", "whirlpoolRateHz", "swirlRateHz"], 0.34),
      0.04,
      2.2,
      0.34,
    );
    const returnMs = clamp(
      firstFinite(physics, ["acousticReturnMs"], 18),
      1,
      72,
      18,
    );
    this.reflectionFramesLeft = returnMs * 0.001 * this.rate;
    this.reflectionFramesRight = returnMs * 0.001 * this.rate * 1.071;
    this.reflectionCoefficient = clamp(
      firstFinite(physics, ["reflectionCoefficient", "boundaryReflection"], 0.68),
      0,
      0.98,
      0.68,
    );
    // A wet basin returns a diffuse pressure smear. Keep the single compact
    // delay below comb-filter territory; the broadband water layers carry the
    // audible sense of space.
    this.reflectionMix = 0.018 + this.reflectionCoefficient * 0.045;

    const receiver = physics.receiver ?? physics.resolvedReceiver ?? {};
    this.receiverDirectMix = clamp(receiver.directMix, 0, 1.5, 0.86);
    this.receiverBubbleMix = clamp(receiver.bubbleMix, 0, 1.5, 0.62);
    this.receiverImpactMix = clamp(receiver.impactMix, 0, 1.5, 0.88);
    this.receiverVortexMix = clamp(receiver.vortexMix, 0, 1.5, 0.72);
    this.receiverMachineryMix = clamp(receiver.machineryMix, 0, 1.5, 0.42);
    const receiverLowpassHz = clamp(
      firstFinite(physics, ["receiverLowpassHz"], receiver.lowpassHz),
      1_500,
      this.rate * 0.44,
      12_500,
    );
    this.receiverLowpassAlpha = 1 - Math.exp(-TAU * receiverLowpassHz / this.rate);

    const decaySource = boundary.modeDecaysSeconds
      ?? boundary.decaysSeconds
      ?? physics.boundaryModeDecaysSeconds;
    const fallbackFrequencies = this._fallbackBoundaryFrequencies();
    const fallbackDecays = this._fallbackBoundaryDecays();
    // `panelTone` is retained in the public state for compatibility, but is
    // now a structure-bleed amount rather than a musical pitch control.
    const structureBleed = clamp(this.configuration.panelTone, 0, 1, 0.08);
    const boundaryDamping = clamp(
      firstFinite(physics, ["boundaryDamping"], boundary.damping),
      0.05,
      0.95,
      0.34,
    );
    const panelCoupling = clamp(boundary.panelCoupling, 0.05, 1, 0.22);
    const boundaryBrightness = clamp(boundary.brightness, 0, 1, 0.42);
    this.impactBand.configure(
      105 + boundaryBrightness * 170,
      3_400 + boundaryBrightness * 5_200,
    );
    for (let index = 0; index < BOUNDARY_MODE_COUNT; index += 1) {
      const decay = Number(decaySource?.[index]);
      const nominalDecay = Number.isFinite(decay) ? decay : fallbackDecays[index];
      this.boundaryModes[index].configure(
        fallbackFrequencies[index],
        clamp(
          nominalDecay * (0.16 + (1 - boundaryDamping) * 0.12),
          0.008,
          0.075,
          0.028,
        ),
        structureBleed * (0.004 + panelCoupling * 0.009) / Math.sqrt(index + 1),
      );
    }

    const pocketFrequency = clamp(
      this.referenceBubbleFrequencyHz * 0.16,
      145,
      620,
      320,
    );
    this.airPocketMode.configure(pocketFrequency, 0.024, structureBleed * 0.012);
    this.machineLowMode.configure(this.isPneumatic ? 43 : 61, 0.07, 0.025);
    this.machineHighMode.configure(this.isPneumatic ? 118 : 172, 0.035, 0.012);
  }

  _fallbackBoundaryFrequencies() {
    if (/steel|metal/i.test(this.boundaryId)) return [186, 570, 1_720, 4_320];
    if (/tile|glass|ceramic/i.test(this.boundaryId)) return [390, 1_080, 2_740, 5_200];
    if (/acrylic|plastic|pmma|fiberglass/i.test(this.boundaryId)) return [142, 430, 1_180, 2_860];
    return [92, 246, 620, 1_420];
  }

  _fallbackBoundaryDecays() {
    if (/steel|metal/i.test(this.boundaryId)) return [0.72, 0.46, 0.24, 0.11];
    if (/tile|glass|ceramic/i.test(this.boundaryId)) return [0.34, 0.22, 0.12, 0.065];
    if (/acrylic|plastic|pmma|fiberglass/i.test(this.boundaryId)) return [0.48, 0.3, 0.17, 0.085];
    return [0.2, 0.14, 0.08, 0.045];
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      const patch = message.configuration ?? message.state ?? message.patch ?? {};
      this.configuration = sanitizeWavePoolState(patch, this.configuration);
      this.modelConfiguration = sanitizeWavePoolState(
        { sequencerEnabled: false },
        this.configuration,
      );
      this.physics = deriveWavePoolPhysics(this.configuration);
      this._configurePhysics();
      return;
    }
    if (message.type === "transport") {
      if (message.playing != null || message.running != null) {
        this.playing = Boolean(message.playing ?? message.running);
        if (!this.playing) {
          this.runtimeVortexTarget = 0;
          this.runtimeMachineryTarget = 0;
          this.runtimeWaterPressureTarget = 0;
          this.runtimeTurbulenceTarget = 0;
          this.runtimeFoamTarget = 0;
        }
      }
      const transportPatch = {};
      const tempo = Number(message.tempoBpm ?? message.tempo);
      const swing = Number(message.swing);
      if (Number.isFinite(tempo)) transportPatch.tempoBpm = tempo;
      if (Number.isFinite(swing)) transportPatch.swing = swing;
      if (Object.keys(transportPatch).length > 0) {
        this.configuration = sanitizeWavePoolState(transportPatch, this.configuration);
        this.modelConfiguration = sanitizeWavePoolState(
          { sequencerEnabled: false },
          this.configuration,
        );
        this.physics = deriveWavePoolPhysics(this.configuration);
        this._configurePhysics();
      }
      if (message.reset) this._resetClock();
      return;
    }
    if (message.type === "trigger" || message.type === "strike") {
      this._manualTrigger(message);
      return;
    }
    if (message.type === "pattern") {
      const patch = message.pattern != null
        ? { pattern: message.pattern }
        : { pattern: message.value };
      this.configuration = sanitizeWavePoolState(patch, this.configuration);
      this.modelConfiguration = sanitizeWavePoolState(
        { sequencerEnabled: false },
        this.configuration,
      );
      this.physics = deriveWavePoolPhysics(this.configuration);
      this._configurePhysics();
      return;
    }
    if (message.type === "panic" || message.type === "reset") {
      this._panic();
    }
  }

  _manualTrigger(message) {
    let type = String(message.event ?? message.lane ?? message.voice ?? "paddle").toLowerCase();
    const laneIndex = Number(message.laneIndex);
    if (Number.isFinite(laneIndex)) {
      type = WAVE_POOL_LANE_IDS[wrap(laneIndex, WAVE_POOL_LANE_IDS.length)] ?? type;
    }
    const energy = clamp(
      message.energy ?? message.velocity ?? message.strength ?? message.value,
      0,
      1.5,
      0.72,
    );
    const positionPan = Number.isFinite(Number(message.position?.x))
      ? Number(message.position.x) * 2 - 1
      : 0;
    const pan = clamp(message.pan ?? positionPan, -1, 1, 0);
    if (/bubble/.test(type)) {
      const radius = clamp(message.radiusMm, 0.2, 12, this.referenceBubbleRadiusMm);
      const frequency = clamp(
        message.frequencyHz,
        45,
        this.rate * 0.43,
        minnaertFrequencyHz(radius, this.bubbleDepthM),
      );
      this._triggerBubble(radius, frequency, energy, 0, pan);
      return;
    }
    this._dispatchEvent(type, energy, pan, null, true);
  }

  _resetClock() {
    this.runtime = createWavePoolRuntime();
    this.sequenceStepIndex = 0;
    this.sequenceFramesUntilStep = 0;
    this.sequencePendingInitialStep = true;
  }

  _panic() {
    this.playing = false;
    this.runtime = createWavePoolRuntime();
    this.sequenceStepIndex = 0;
    this.sequenceFramesUntilStep = 0;
    this.sequencePendingInitialStep = true;
    this.randomState = this.initialSeed;
    this._clearDynamicState();
    for (let index = 0; index < this.bubbles.length; index += 1) this.bubbles[index].reset();
    for (let index = 0; index < this.boundaryModes.length; index += 1) {
      this.boundaryModes[index].reset();
    }
    this.machineLowMode.reset();
    this.machineHighMode.reset();
    this.airPocketMode.reset();
    this.gurgleMode.reset();
    this.machineBand.reset();
    this.impactBand.reset();
    this.sprayBand.reset();
    this.vortexBand.reset();
    this.pressureBand.reset();
    this.turbulenceBand.reset();
    this.foamBand.reset();
    this.flowModulator.reset();
    this.reflectionLeft.reset();
    this.reflectionRight.reset();
    this.receiverLowpassLeft.reset();
    this.receiverLowpassRight.reset();
  }

  _random() {
    let value = this.randomState | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value >>> 0;
    return (this.randomState / 0x1_0000_0000) * 2 - 1;
  }

  _dispatchEvent(typeValue, energyValue, panValue, event, manual = false) {
    const type = String(typeValue ?? "").toLowerCase();
    const energy = clamp(energyValue, 0, 1.5, 0.7);
    const pan = clamp(panValue, -1, 1, 0);
    if (/paddle|generator/.test(type)) {
      this._triggerPaddle(energy, pan);
      return;
    }
    if (/machinery|machine|valve/.test(type)) {
      this._triggerMachinery(energy);
      return;
    }
    if (/breaker|splash/.test(type)) {
      this._triggerBreaker(energy, pan, manual);
      return;
    }
    if (/wall|slap|impact/.test(type)) {
      this._triggerWall(energy, pan);
      return;
    }
    if (/vortex|whirl/.test(type)) {
      this._triggerVortex(energy, pan);
      return;
    }
    if (/bubble/.test(type)) {
      const radius = clamp(event?.radiusMm, 0.2, 12, this.referenceBubbleRadiusMm);
      const frequency = clamp(
        event?.frequencyHz,
        45,
        this.rate * 0.43,
        minnaertFrequencyHz(radius, this.bubbleDepthM),
      );
      this._triggerBubble(radius, frequency, energy, 0, pan);
    }
  }

  _triggerPaddle(energy) {
    this.surfaceEnergy = Math.max(this.surfaceEnergy, clamp(energy));
    this.waterPressureEnvelope = Math.max(this.waterPressureEnvelope, energy * 0.9);
    this.turbulenceEnvelope = Math.max(this.turbulenceEnvelope, energy * 0.38);
    this._triggerMachinery(
      energy * this.machineryAmount * firstFinite(
        this.physics?.generator,
        ["machineryScale"],
        0.72,
      ),
    );
    if (this.isPneumatic) {
      const machineScale = 0.16 + this.machineryAmount * 0.84;
      this.valveEnvelope = Math.max(this.valveEnvelope, energy * machineScale);
      this.whooshEnvelope = Math.max(this.whooshEnvelope, energy * machineScale * 0.92);
    } else {
      this.pistonEnvelope = Math.max(this.pistonEnvelope, energy);
      this.returnCountdown = Math.max(1, Math.round(this.rate * (0.065 + energy * 0.045)));
    }
  }

  _triggerMachinery(energy) {
    const amount = clamp(energy, 0, 1.5, 0.7);
    this.machineLowMode.excite(amount * 0.24);
    this.machineHighMode.excite(amount * (this.isPneumatic ? 0.12 : -0.14));
    if (this.isPneumatic) {
      this.valveEnvelope = Math.max(this.valveEnvelope, amount * 0.72);
      this.whooshEnvelope = Math.max(this.whooshEnvelope, amount * 0.76);
    }
  }

  _triggerBreaker(energy, pan, forceBubbles) {
    const amount = clamp(energy, 0, 1.5, 0.7);
    this.breakerEnergy = Math.max(this.breakerEnergy, amount);
    this.breakerImpulseEnvelope = Math.max(this.breakerImpulseEnvelope, amount);
    this.splashEnvelope = Math.max(
      this.splashEnvelope,
      amount * this.configuration.splash * (0.72 + this.aeration * 0.24),
    );
    this.turbulenceEnvelope = Math.max(
      this.turbulenceEnvelope,
      amount * (0.68 + this.configuration.breaking * 0.32),
    );
    this.foamEnvelope = Math.max(
      this.foamEnvelope,
      amount * this.configuration.splash * (0.62 + this.aeration * 0.38),
    );
    this.breakerPan = pan;
    const entrainment = clamp(this.bubbleDensity * 0.72 + this.aeration * 0.46, 0, 1);
    const expectedCount = amount * entrainment * (3 + this.bubbleDensity * 10);
    const count = entrainment <= 0
      ? 0
      : Math.min(
        BUBBLE_VOICE_COUNT,
        Math.max(forceBubbles ? 1 : 0, Math.round(expectedCount)),
      );
    if (count > 0) this._scheduleBubbleCloud(count, amount, pan);
  }

  _scheduleBubbleCloud(count, energy, pan) {
    for (let index = 0; index < count; index += 1) {
      const branch = (this._random() + 1) * 0.5;
      const canonicalRadius = branch < 0.67
        ? powerLawSample((this._random() + 1) * 0.5, 0.24, 1, 1.5)
        : powerLawSample((this._random() + 1) * 0.5, 1, 9, 10 / 3);
      const radius = clamp(
        canonicalRadius * this.referenceBubbleRadiusMm / 2.6,
        0.2,
        12,
        this.referenceBubbleRadiusMm,
      );
      const delaySeconds = ((this._random() + 1) * 0.5) ** 1.6
        * (0.018 + this.aeration * 0.085);
      const eventPan = clamp(pan + this._random() * 0.64, -1, 1, 0);
      this._triggerBubble(
        radius,
        minnaertFrequencyHz(radius, this.bubbleDepthM),
        energy * (0.62 + this._random() * 0.13),
        Math.round(delaySeconds * this.rate),
        eventPan,
      );
    }
  }

  _triggerBubble(radiusMm, frequencyHz, energy, delayFrames, pan) {
    let selected = 0;
    let quietest = Infinity;
    for (let index = 0; index < this.bubbles.length; index += 1) {
      const voice = this.bubbles[index];
      if (!voice.active) {
        selected = index;
        quietest = -1;
        break;
      }
      if (voice.amplitude < quietest) {
        quietest = voice.amplitude;
        selected = index;
      }
    }
    const radius = clamp(radiusMm, 0.2, 12, this.referenceBubbleRadiusMm);
    const sizeWeight = clamp(Math.sqrt(radius / 1.2), 0.46, 2.1, 1);
    const amplitude = clamp(energy, 0, 1.5, 0.6) * 0.024 * sizeWeight;
    const decay = 0.007 + 0.027 * Math.sqrt(radius / 12);
    const character = this._random();
    const seed = Math.floor((this._random() + 1) * 0x7fff_ffff) || 1;
    this.bubbles[selected].arm(
      frequencyHz * (0.91 + (character + 1) * 0.055),
      amplitude,
      decay,
      delayFrames,
      pan,
      character,
      seed,
    );
  }

  _triggerWall(energy, pan) {
    const amount = clamp(energy, 0, 1.5, 0.72);
    this.wallEnergy = Math.max(this.wallEnergy, amount);
    this.slapEnvelope = Math.max(this.slapEnvelope, amount);
    this.waterPressureEnvelope = Math.max(this.waterPressureEnvelope, amount * 0.33);
    this.turbulenceEnvelope = Math.max(this.turbulenceEnvelope, amount * 0.54);
    this.foamEnvelope = Math.max(
      this.foamEnvelope,
      amount * this.configuration.splash * 0.12,
    );
    this.wallPan = clamp(pan, -1, 1, 0.42);
    for (let index = 0; index < this.boundaryModes.length; index += 1) {
      const polarity = index % 2 === 0 ? 1 : -1;
      this.boundaryModes[index].excite(amount * polarity * 0.26 / Math.sqrt(index + 1));
    }
    this.airPocketMode.excite(amount * (0.16 + this.aeration * 0.14));
  }

  _triggerVortex(energy) {
    const amount = clamp(energy, 0, 1.5, 0.65);
    this.vortexEnvelope = Math.max(this.vortexEnvelope, amount);
    this.vortexStrength = Math.max(this.vortexStrength, amount);
    this.turbulenceEnvelope = Math.max(this.turbulenceEnvelope, amount * 0.58);
    if (this.aeration > 0.08) {
      this.gurgleMode.excite(amount * this.aeration * 0.7);
      this.gurgleEnvelope = Math.max(this.gurgleEnvelope, amount * this.aeration);
    }
  }

  _processTimedEvents(events, eventIndex, frame) {
    let index = eventIndex;
    while (index < events.length) {
      const event = events[index];
      const eventFrame = Math.max(0, Math.round(finite(event?.timeOffsetSeconds, 0) * this.rate));
      if (eventFrame > frame) break;
      this._dispatchEvent(event?.type, event?.energy, event?.pan, event, false);
      index += 1;
    }
    return index;
  }

  _sequenceStepFrames(stepIndex) {
    const straightSixteenthSeconds = 15 / clamp(
      this.configuration.tempoBpm,
      35,
      160,
      72,
    );
    const swing = clamp(this.configuration.swing, 0, 0.35, 0.08);
    const swingScale = wrap(stepIndex, 2) === 0 ? 1 + swing : 1 - swing;
    return straightSixteenthSeconds * swingScale * this.rate;
  }

  _fireSequenceStep() {
    const pattern = this.configuration.pattern;
    const step = wrap(this.sequenceStepIndex, WAVE_POOL_SEQUENCE_LENGTH);
    for (let laneIndex = 0; laneIndex < WAVE_POOL_LANE_IDS.length; laneIndex += 1) {
      const laneId = WAVE_POOL_LANE_IDS[laneIndex];
      const velocity = clamp(pattern?.[laneId]?.[step], 0, 1, 0);
      if (velocity <= 0) continue;
      let energy = velocity;
      if (laneId === "paddle") {
        energy *= this.configuration.paddleForce * firstFinite(
          this.physics,
          ["paddleCoherence"],
          1,
        );
      } else if (laneId === "breaker") {
        energy *= this.configuration.breaking * (
          0.22 + firstFinite(this.physics, ["breakSeverity", "breakingSeverity"], 0.5) * 0.78
        );
      } else if (laneId === "wall") {
        energy *= this.configuration.wallImpact * this.reflectionCoefficient;
      } else if (laneId === "vortex") {
        energy *= this.whirlpoolAmount * (0.62 + this.aeration * 0.28);
      }
      const pan = laneId === "paddle"
        ? -0.62
        : laneId === "wall" ? 0.62 : laneId === "vortex" ? 0.3 : 0;
      this._dispatchEvent(laneId, energy, pan, null, false);
    }
  }

  _advanceSequenceClock() {
    if (!this.playing || !this.configuration.sequencerEnabled) return;
    if (this.sequencePendingInitialStep) {
      this._fireSequenceStep();
      this.sequenceFramesUntilStep += this._sequenceStepFrames(this.sequenceStepIndex);
      this.sequencePendingInitialStep = false;
    } else if (this.sequenceFramesUntilStep <= 0) {
      this.sequenceStepIndex = wrap(
        this.sequenceStepIndex + 1,
        WAVE_POOL_SEQUENCE_LENGTH,
      );
      this._fireSequenceStep();
      this.sequenceFramesUntilStep += this._sequenceStepFrames(this.sequenceStepIndex);
    }
    this.sequenceFramesUntilStep -= 1;
  }

  _renderBubbleBank() {
    let left = 0;
    let right = 0;
    for (let index = 0; index < this.bubbles.length; index += 1) {
      const voice = this.bubbles[index];
      const sample = voice.process();
      left += sample * voice.leftGain;
      right += sample * voice.rightGain;
    }
    this.bubbleLeft = left;
    this.bubbleRight = right;
  }

  _renderFrame() {
    if (this.returnCountdown >= 0) {
      this.returnCountdown -= 1;
      if (this.returnCountdown === 0) {
        this.returnEnvelope = Math.max(this.returnEnvelope, this.surfaceEnergy * 0.72);
        this.machineLowMode.excite(-this.surfaceEnergy * 0.14);
        this.machineHighMode.excite(this.surfaceEnergy * 0.08);
        this.waterPressureEnvelope = Math.max(
          this.waterPressureEnvelope,
          this.surfaceEnergy * 0.56,
        );
      }
    }

    const noise = this._random();
    const differentiatedNoise = noise - this.previousNoise;
    this.previousNoise = noise;
    const machineNoise = this.machineBand.process(noise);
    const impactNoise = this.impactBand.process(noise);
    const sprayNoise = this.sprayBand.process(noise);
    const vortexNoise = this.vortexBand.process(noise);
    const pressureNoise = this.pressureBand.process(noise);
    const turbulenceNoise = this.turbulenceBand.process(noise);
    const foamNoise = this.foamBand.process(noise);
    const flowModulation = 0.58 + this.flowModulator.process((noise + 1) * 0.5, 0.0007) * 0.72;

    const pressureRate = this.runtimeWaterPressureTarget > this.waterPressureEnvelope
      ? 0.0018
      : 0.00006;
    const turbulenceRate = this.runtimeTurbulenceTarget > this.turbulenceEnvelope
      ? 0.0028
      : 0.0001;
    const foamRate = this.runtimeFoamTarget > this.foamEnvelope
      ? 0.0016
      : 0.000025;
    this.waterPressureEnvelope += (
      this.runtimeWaterPressureTarget - this.waterPressureEnvelope
    ) * pressureRate;
    this.turbulenceEnvelope += (
      this.runtimeTurbulenceTarget - this.turbulenceEnvelope
    ) * turbulenceRate;
    this.foamEnvelope += (
      this.runtimeFoamTarget - this.foamEnvelope
    ) * foamRate;

    const waterPressure = pressureNoise * this.waterPressureEnvelope * 0.105 * flowModulation;
    const turbulence = turbulenceNoise * this.turbulenceEnvelope * 0.13 * flowModulation;
    const foam = foamNoise * this.foamEnvelope * 0.095 * (0.72 + flowModulation * 0.28);

    this.machineryBed += (
      this.runtimeMachineryTarget - this.machineryBed
    ) * 0.00075;
    const machineModes = this.machineLowMode.process() + this.machineHighMode.process();
    let machinery = machineModes * 0.22 + machineNoise * this.machineryBed * 0.035;
    if (this.isPneumatic) {
      machinery += differentiatedNoise * this.valveEnvelope * 0.032
        + machineNoise * this.whooshEnvelope * 0.15;
    } else {
      machinery += impactNoise * (this.pistonEnvelope - this.returnEnvelope * 0.6) * 0.052;
    }

    const breaker = impactNoise * this.breakerImpulseEnvelope * 0.12
      + sprayNoise * this.splashEnvelope * 0.105;
    const slap = (
      impactNoise * 0.72
      + differentiatedNoise * 0.12
      + pressureNoise * 0.34
    ) * this.slapEnvelope * 0.12;
    let boundary = this.airPocketMode.process();
    for (let index = 0; index < this.boundaryModes.length; index += 1) {
      boundary += this.boundaryModes[index].process();
    }
    boundary *= 0.1 + this.reflectionCoefficient * 0.08;

    this._renderBubbleBank();

    this.vortexStrength += (
      this.runtimeVortexTarget - this.vortexStrength
    ) * 0.00065;
    const vortexLevel = Math.max(this.vortexEnvelope, this.vortexStrength * 0.72);
    this.swirlPhase += this.swirlRateHz / this.rate;
    if (this.swirlPhase >= 1) this.swirlPhase -= 1;
    const vortexPan = Math.sin(this.swirlPhase * TAU) * 0.82;
    const vortex = vortexNoise * vortexLevel * 0.072
      + pressureNoise * this.gurgleEnvelope * 0.058
      + this.gurgleMode.process() * 0.08;

    if (this.gurgleCooldown > 0) this.gurgleCooldown -= 1;
    const gurgleRateHz = vortexLevel * this.aeration * 12;
    const randomUnit = (noise + 1) * 0.5;
    if (
      vortexLevel > 0.08
      && this.aeration > 0.08
      && this.gurgleCooldown <= 0
      && randomUnit < gurgleRateHz / this.rate
    ) {
      const radius = 4 + (this._random() + 1) * 4;
      this._triggerBubble(
        radius,
        minnaertFrequencyHz(radius, this.bubbleDepthM),
        vortexLevel * this.aeration * 0.68,
        0,
        vortexPan,
      );
      this.gurgleMode.excite(vortexLevel * this.aeration * 0.46);
      this.gurgleEnvelope = Math.max(this.gurgleEnvelope, vortexLevel * this.aeration);
      this.gurgleCooldown = Math.round(this.rate * (0.022 + randomUnit * 0.085));
    }

    const breakerLeftGain = Math.sqrt((1 - this.breakerPan) * 0.5);
    const breakerRightGain = Math.sqrt((1 + this.breakerPan) * 0.5);
    const wallLeftGain = Math.sqrt((1 - this.wallPan) * 0.5);
    const wallRightGain = Math.sqrt((1 + this.wallPan) * 0.5);
    const vortexLeftGain = Math.sqrt((1 - vortexPan) * 0.5);
    const vortexRightGain = Math.sqrt((1 + vortexPan) * 0.5);

    const waterLeft = waterPressure * 0.92
      + turbulence * (0.72 + breakerLeftGain * 0.28)
      + foam * breakerLeftGain;
    const waterRight = waterPressure
      + turbulence * (0.72 + breakerRightGain * 0.28)
      + foam * breakerRightGain;

    let left = waterLeft * this.receiverImpactMix
      + machinery * 0.76 * this.receiverMachineryMix
      + breaker * breakerLeftGain * this.receiverImpactMix
      + (slap + boundary) * wallLeftGain * this.receiverDirectMix
      + this.bubbleLeft * this.receiverBubbleMix
      + vortex * vortexLeftGain * this.receiverVortexMix;
    let right = waterRight * this.receiverImpactMix
      + machinery * this.receiverMachineryMix
      + breaker * breakerRightGain * this.receiverImpactMix
      + (slap + boundary) * wallRightGain * this.receiverDirectMix
      + this.bubbleRight * this.receiverBubbleMix
      + vortex * vortexRightGain * this.receiverVortexMix;

    // Pool-wall echoes are acoustic (millisecond) paths. Gravity-wave travel
    // remains in stepWavePool's event clock and is never faked with this delay.
    const reflectedLeft = this.reflectionLeft.process(left, this.reflectionFramesLeft);
    const reflectedRight = this.reflectionRight.process(right, this.reflectionFramesRight);
    left += reflectedRight * this.reflectionMix;
    right += reflectedLeft * this.reflectionMix;

    left = this.receiverLowpassLeft.process(left, this.receiverLowpassAlpha);
    right = this.receiverLowpassRight.process(right, this.receiverLowpassAlpha);

    const blockedLeft = left - this.dcInputLeft + 0.995 * this.dcOutputLeft;
    const blockedRight = right - this.dcInputRight + 0.995 * this.dcOutputRight;
    this.dcInputLeft = left;
    this.dcInputRight = right;
    this.dcOutputLeft = clean(blockedLeft);
    this.dcOutputRight = clean(blockedRight);
    this.renderedLeft = clamp(
      Math.tanh(blockedLeft * SOURCE_DRIVE) * OUTPUT_CEILING * this.outputLevel,
      -OUTPUT_CEILING,
      OUTPUT_CEILING,
      0,
    );
    this.renderedRight = clamp(
      Math.tanh(blockedRight * SOURCE_DRIVE) * OUTPUT_CEILING * this.outputLevel,
      -OUTPUT_CEILING,
      OUTPUT_CEILING,
      0,
    );

    this.pistonEnvelope *= 0.9915;
    this.returnEnvelope *= 0.986;
    this.valveEnvelope *= 0.972;
    this.whooshEnvelope *= 0.9991;
    this.breakerImpulseEnvelope *= 0.988;
    this.splashEnvelope *= 0.99955;
    this.slapEnvelope *= 0.996;
    this.vortexEnvelope *= 0.99972;
    this.gurgleEnvelope *= 0.9992;
    this.waterPressureEnvelope *= 0.99992;
    this.turbulenceEnvelope *= 0.99982;
    this.foamEnvelope *= 0.99996;
    this.surfaceEnergy *= 0.9996;
    this.breakerEnergy *= 0.9992;
    this.wallEnergy *= 0.9982;
    this.vortexStrength *= 0.99972;
  }

  _activeBubbleCount() {
    let count = 0;
    for (let index = 0; index < this.bubbles.length; index += 1) {
      if (this.bubbles[index].active) count += 1;
    }
    return count;
  }

  _postTelemetry() {
    this.port.postMessage({
      type: "telemetry",
      playing: this.playing,
      stepIndex: wrap(this.sequenceStepIndex, WAVE_POOL_SEQUENCE_LENGTH),
      generatorPhase: clamp(this.runtime?.generatorPhase, 0, 1, 0),
      surfaceEnergy: clamp(Math.max(this.surfaceEnergy, finite(this.runtime?.waveEnergy)), 0, 2, 0),
      breakerEnergy: clamp(Math.max(this.breakerEnergy, finite(this.runtime?.breakerEnergy)), 0, 2, 0),
      wallEnergy: clamp(Math.max(this.wallEnergy, finite(this.runtime?.wallEnergy)), 0, 2, 0),
      activeBubbles: this._activeBubbleCount(),
      vortexStrength: clamp(
        Math.max(this.vortexStrength, finite(this.runtime?.vortexEnergy)),
        0,
        2,
        0,
      ),
      peak: this.peak,
      rms: this.rms,
    });
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    const frameCount = output[0].length;
    let nextRuntime = this.runtime;
    let events = EMPTY_EVENTS;
    if (this.playing) {
      nextRuntime = stepWavePool(
        this.modelConfiguration,
        this.runtime,
        frameCount / this.rate,
      );
      events = Array.isArray(nextRuntime?.events) ? nextRuntime.events : EMPTY_EVENTS;
    }
    this.runtimeVortexTarget = this.playing
      ? clamp(nextRuntime?.vortexEnergy, 0, 1.5, 0)
      : 0;
    this.runtimeMachineryTarget = this.playing
      ? clamp(nextRuntime?.machineryEnergy, 0, 1.5, 0)
      : 0;
    const surfaceVelocity = Math.abs(finite(nextRuntime?.surfaceVelocityMps));
    this.runtimeWaterPressureTarget = this.playing
      ? clamp(
        finite(nextRuntime?.waveEnergy) * 0.58 + Math.min(1, surfaceVelocity * 0.34),
        0,
        1.5,
        0,
      )
      : 0;
    this.runtimeTurbulenceTarget = this.playing
      ? clamp(
        finite(nextRuntime?.breakerEnergy) * 0.64
          + finite(nextRuntime?.splashEnergy) * 0.42
          + Math.min(0.32, surfaceVelocity * 0.12),
        0,
        1.5,
        0,
      )
      : 0;
    this.runtimeFoamTarget = this.playing
      ? clamp(
        finite(nextRuntime?.foam) * 0.58
          + finite(nextRuntime?.splashEnergy) * 0.62
          + finite(nextRuntime?.breakerEnergy) * 0.18,
        0,
        1.5,
        0,
      )
      : 0;

    let eventIndex = 0;
    let blockPeak = 0;
    let squareSum = 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      eventIndex = this._processTimedEvents(events, eventIndex, frame);
      this._advanceSequenceClock();
      this._renderFrame();
      const left = this.renderedLeft;
      const right = this.renderedRight;
      output[0][frame] = left;
      if (output[1]) output[1][frame] = right;
      for (let channel = 2; channel < output.length; channel += 1) {
        output[channel][frame] = (left + right) * 0.5;
      }
      blockPeak = Math.max(blockPeak, Math.abs(left), Math.abs(right));
      squareSum += (left * left + right * right) * 0.5;
      this.telemetryCountdown -= 1;
    }
    this.runtime = nextRuntime;
    const blockRms = Math.sqrt(squareSum / Math.max(1, frameCount));
    this.peak += (blockPeak - this.peak) * 0.28;
    this.rms += (blockRms - this.rms) * 0.2;
    if (this.telemetryCountdown <= 0) {
      this.telemetryCountdown += this.telemetryQuantum;
      this._postTelemetry();
    }
    return true;
  }
}

if (typeof globalThis.registerProcessor === "function") {
  globalThis.registerProcessor("wave-pool-physical-model", WavePoolPhysicalProcessor);
}

export { WavePoolPhysicalProcessor };
