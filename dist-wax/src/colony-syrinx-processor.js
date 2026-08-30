import {
  COLONY_SYRINX_BANK_COUNT,
  COLONY_SYRINX_FOLD_COUNT,
  COLONY_SYRINX_LANE_COUNT,
  COLONY_SYRINX_MAX_PRESSURE,
  COLONY_SYRINX_MEDIA,
  COLONY_SYRINX_MOUTH_COUNT,
  COLONY_SYRINX_PHONATOR_COUNT,
  COLONY_SYRINX_ROUTE_COUNT,
  COLONY_SYRINX_SEQUENCE_LENGTH,
  COLONY_SYRINX_TOPOLOGY,
  createColonySyrinxRuntime,
  sanitizeColonySyrinxState,
  stepColonySyrinx,
} from "./colony-syrinx.js";
import { SyrinxSourceEngine } from "./syrinx-source-models.js";

const TWO_PI = Math.PI * 2;
const OUTPUT_LIMIT = 0.92;
const SILENCE_FLOOR = 1e-18;
const CONTROL_RATE_HZ = 120;
const TELEMETRY_RATE_HZ = 24;
const SOURCE_OVERSAMPLE = 2;
const MAX_SOURCE_RATE = 384_000;
const AUTO_EXHALE_CYCLE_BEATS = 4;
const AUTO_EXHALE_PATTERN = Object.freeze([
  { start: 0, attack: 0.07, hold: 0.12, release: 0.43, level: 1 },
  { start: 0.72, attack: 0.055, hold: 0.1, release: 0.365, level: 0.8 },
  { start: 1.58, attack: 0.04, hold: 0.075, release: 0.305, level: 0.96 },
  { start: 2.46, attack: 0.025, hold: 0.11, release: 0.365, level: 1 },
]);

const FREAK_SOURCE_PROFILES = Object.freeze([
  Object.freeze({
    id: "collision-roar",
    model: "twoMass",
    frequencyScale: 0.72,
    tensionBias: -0.16,
    adduction: 0.9,
    sourceScale: 0.9,
    breath: 0.38,
    roughness: 0.68,
    asymmetry: 0.34,
    coupling: 0.46,
    feedback: 0.62,
    outputGain: 1.04,
    pulseRateHz: 19,
  }),
  Object.freeze({
    id: "split-syrinx",
    model: "syrinx",
    frequencyScale: 2.45,
    tensionBias: -0.02,
    adduction: 0.78,
    sourceScale: 0.58,
    breath: 0.24,
    roughness: 0.52,
    asymmetry: -0.58,
    coupling: 0.035,
    feedback: 0.7,
    outputGain: 1.1,
    pulseRateHz: 27,
  }),
  Object.freeze({
    id: "pulse-membrane",
    model: "frog",
    frequencyScale: 0.82,
    tensionBias: -0.22,
    adduction: 0.84,
    sourceScale: 0.76,
    breath: 0.28,
    roughness: 0.76,
    asymmetry: 0.42,
    coupling: 0.68,
    feedback: 0.64,
    outputGain: 0.78,
    pulseRateHz: 34,
  }),
  Object.freeze({
    id: "needle-syrinx",
    model: "syrinx",
    frequencyScale: 3.7,
    tensionBias: 0.16,
    adduction: 0.72,
    sourceScale: 0.3,
    breath: 0.2,
    roughness: 0.42,
    asymmetry: 0.7,
    coupling: 0.025,
    feedback: 0.54,
    outputGain: 0.92,
    pulseRateHz: 41,
  }),
]);

const SOURCE_STEP_RATIOS = Object.freeze([
  Object.freeze([1, 0.5, 0.78, 1.17]),
  Object.freeze([1, 1.26, 0.84, 1.5]),
  Object.freeze([1, 0.79, 1.12, 0.67]),
  Object.freeze([1, 1.5, 1.19, 0.71]),
]);

const MOUTH_GESTURES_HZ = Object.freeze([
  Object.freeze([
    Object.freeze([92, 286, 720, 1_360]),
    Object.freeze([168, 515, 1_040, 1_920]),
    Object.freeze([72, 238, 610, 1_180]),
    Object.freeze([204, 438, 1_280, 2_260]),
  ]),
  Object.freeze([
    Object.freeze([286, 890, 2_180, 3_380]),
    Object.freeze([525, 1_720, 2_560, 3_920]),
    Object.freeze([224, 2_060, 3_160, 4_420]),
    Object.freeze([438, 1_120, 2_820, 4_680]),
  ]),
  Object.freeze([
    Object.freeze([1_180, 2_540, 4_760, 7_100]),
    Object.freeze([1_820, 3_420, 5_640, 9_120]),
    Object.freeze([940, 4_180, 6_760, 10_900]),
    Object.freeze([2_260, 5_080, 8_040, 13_200]),
  ]),
]);

const MOUTH_REFERENCE_RESONANCE_HZ = Object.freeze([118, 420, 1_480]);
const MOUTH_EXCITATION_GAINS = Object.freeze([0.26, 0.48, 0.72]);
const MOUTH_DELAY_FEEDBACK = Object.freeze([0.34, 0.28, 0.19]);
const MOUTH_INTERNAL_FEEDBACK = Object.freeze([0.22, -0.18, 0.14]);
const MOUTH_BURST_DECAY = Object.freeze([0.9982, 0.9962, 0.9925]);
const MOUTH_FRICATION_GAIN = Object.freeze([0.16, 0.52, 0.86]);
const MOUTH_BURST_GAIN = Object.freeze([0.48, 0.82, 1.26]);
const MOUTH_EDGE_GAIN = Object.freeze([0.04, 0.18, 0.48]);
const ROUTE_DELAY_MILLISECONDS = Object.freeze([
  2.8, 1.45, 0.38,
  3.15, 1.08, 0.62,
  2.46, 1.72, 0.84,
  3.42, 1.28, 0.47,
]);

function clamp(value, minimum = 0, maximum = 1, fallback = minimum) {
  const number = Number(value);
  return Math.min(
    maximum,
    Math.max(minimum, Number.isFinite(number) ? number : fallback),
  );
}

function wrap(value, length) {
  const integer = Math.trunc(Number(value));
  if (!Number.isFinite(integer) || length <= 0) return 0;
  return ((integer % length) + length) % length;
}

function smoothingAlpha(rate, seconds) {
  return seconds > 0 && rate > 0 ? 1 - Math.exp(-rate * seconds) : 0;
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function autoExhaleEnvelope(beat, event) {
  const localBeat = beat - event.start;
  const releaseStart = event.attack + event.hold;
  const end = releaseStart + event.release;
  if (localBeat < 0 || localBeat >= end) return 0;
  if (localBeat < event.attack) return smoothstep(0, event.attack, localBeat) * event.level;
  if (localBeat < releaseStart) return event.level;
  return (1 - smoothstep(releaseStart, end, localBeat)) * event.level;
}

function clean(value) {
  return Number.isFinite(value) && Math.abs(value) >= SILENCE_FLOOR ? value : 0;
}

/**
 * A topology-preserving state-variable resonator. The TPT form stays bounded
 * while its frequency and damping are changed from the control thread.
 */
class StableResonator {
  constructor(rate) {
    this.rate = rate;
    this.integratorOne = 0;
    this.integratorTwo = 0;
    this.gainOne = 0;
    this.gainTwo = 0;
    this.gainThree = 0;
    this.damping = 1;
    this.targetGainOne = 0;
    this.targetGainTwo = 0;
    this.targetGainThree = 0;
    this.targetDamping = 1;
    this.coefficientsReady = false;
    this.coefficientSmoothing = 1 - Math.exp(-1 / (rate * 0.018));
    this.low = 0;
    this.band = 0;
    this.high = 0;
    this.configure(440, 1);
  }

  configure(frequencyHz, quality) {
    const frequency = clamp(frequencyHz, 18, this.rate * 0.42, 440);
    const q = clamp(quality, 0.36, 16, 1);
    const g = Math.tan(Math.PI * frequency / this.rate);
    this.targetDamping = 1 / q;
    this.targetGainOne = 1 / (1 + g * (g + this.targetDamping));
    this.targetGainTwo = g * this.targetGainOne;
    this.targetGainThree = g * this.targetGainTwo;
    if (!this.coefficientsReady) {
      this.damping = this.targetDamping;
      this.gainOne = this.targetGainOne;
      this.gainTwo = this.targetGainTwo;
      this.gainThree = this.targetGainThree;
      this.coefficientsReady = true;
    }
  }

  reset() {
    this.integratorOne = 0;
    this.integratorTwo = 0;
    this.low = 0;
    this.band = 0;
    this.high = 0;
  }

  process(input) {
    this.damping += (this.targetDamping - this.damping) * this.coefficientSmoothing;
    this.gainOne += (this.targetGainOne - this.gainOne) * this.coefficientSmoothing;
    this.gainTwo += (this.targetGainTwo - this.gainTwo) * this.coefficientSmoothing;
    this.gainThree += (this.targetGainThree - this.gainThree) * this.coefficientSmoothing;
    const drive = clamp(input, -8, 8, 0);
    const intermediate = drive - this.integratorTwo;
    const band = this.gainOne * this.integratorOne + this.gainTwo * intermediate;
    const low = this.integratorTwo
      + this.gainTwo * this.integratorOne
      + this.gainThree * intermediate;
    const high = drive - low - this.damping * band;
    this.integratorOne = clean(2 * band - this.integratorOne);
    this.integratorTwo = clean(2 * low - this.integratorTwo);

    if (Math.abs(this.integratorOne) > 24 || Math.abs(this.integratorTwo) > 24) {
      this.integratorOne = clamp(this.integratorOne, -4, 4, 0);
      this.integratorTwo = clamp(this.integratorTwo, -4, 4, 0);
    }
    this.low = clean(low);
    this.band = clean(band);
    this.high = clean(high);
    return this.band;
  }
}

/**
 * The three exits deliberately do not share one tract recipe. Each mouth has
 * four moving resonances, a short reflected path, its own nonlinear exciter,
 * constriction noise, and pressure-release state. The sequencer therefore
 * changes vowels and consonants instead of merely multiplying a static tone.
 */
class MouthLoad {
  constructor(rate, index) {
    this.rate = rate;
    this.index = index;
    this.throat = new StableResonator(rate);
    this.cavity = new StableResonator(rate);
    this.tongue = new StableResonator(rate);
    this.teeth = new StableResonator(rate);
    this.opening = 0;
    this.targetOpening = 0;
    this.flowActivity = 0;
    this.targetFlowActivity = 0;
    this.eventActivity = 0;
    this.targetEventActivity = 0;
    this.openingAlpha = 0.01;
    this.directGain = 0.05;
    this.radiationTrim = [1.08, 1.12, 1.34][index] ?? 1;
    this.pan = 0;
    this.reflectedLoad = 0;
    this.lastRadiation = 0;
    this.feedbackState = 0;
    this.previousInput = 0;
    this.noiseMemory = 0;
    this.subharmonicPolarity = 1;
    this.jetPhase = 0;
    this.jetOvertonePhase = 0;
    this.jetAmplitude = 0;
    this.jetFrequencyHz = 2_400;
    this.ratchetPhase = 0;
    this.burstEnvelope = 0;
    this.fricationEnvelope = 0;
    this.fricationTarget = 0;
    this.storedPressure = 0;
    this.gestureIndex = 0;
    const delayFrequency = [278, 740, 2_520][index] ?? 740;
    this.tractDelay = new Float64Array(Math.max(8, Math.round(rate / delayFrequency)));
    this.tractDelayIndex = 0;
  }

  configure(mouth) {
    const opening = clamp(mouth.opening);
    this.openingAlpha = 1 - Math.exp(
      -1 / (this.rate * clamp(mouth.slewMs, 2, 500, 40) * 0.001),
    );
    this.directGain = 0.026 + opening * 0.082;
    this.pan = clamp(mouth.pan, -1, 1, 0);
  }

  articulate(mouth, aperture, flow, pressure, stepIndex, velocity, exhaleBeat, eventActivity) {
    const previousTarget = this.targetOpening;
    const opening = clamp(aperture);
    const gesture = wrap(stepIndex + this.index, MOUTH_GESTURES_HZ[this.index].length);
    const frequencies = MOUTH_GESTURES_HZ[this.index][gesture];
    const resonanceScale = clamp(
      mouth.resonanceHz / MOUTH_REFERENCE_RESONANCE_HZ[this.index],
      0.45,
      2.2,
      1,
    );
    const tonguePosition = clamp(mouth.tonguePosition);
    const tongueSize = clamp(mouth.tongueSize);
    const lipSize = clamp(mouth.lipSize);
    const lipTension = clamp(mouth.lipTension);
    const cavityVolume = clamp(mouth.cavity);
    const pressureWarp = 1 + (pressure - 0.5) * [0.09, -0.055, 0.12][this.index];
    const phaseWarp = 1 + Math.sin(
      exhaleBeat * TWO_PI * (0.5 + this.index * 0.37) + gesture,
    ) * [0.055, 0.08, 0.11][this.index];
    this.throat.configure(
      frequencies[0] * resonanceScale * (0.76 + opening * 0.42)
        * (1.08 - cavityVolume * 0.16) * pressureWarp,
      [5.8, 7.2, 10.8][this.index] + lipSize * 1.6 + cavityVolume * 0.8,
    );
    this.cavity.configure(
      frequencies[1] * resonanceScale * (0.82 + tonguePosition * 0.34)
        * (1.14 - cavityVolume * 0.28) * phaseWarp,
      [7.2, 9.4, 13.2][this.index] + tongueSize * 1.8 + cavityVolume * 1.1,
    );
    this.tongue.configure(
      frequencies[2] * resonanceScale * (0.88 + tongueSize * 0.24),
      [6.4, 10.8, 15.2][this.index] + lipTension * 0.8,
    );
    this.teeth.configure(
      frequencies[3] * resonanceScale * (0.84 + lipTension * 0.28),
      [4.6, 8.6, 14.8][this.index],
    );

    const constriction = Math.sin(clamp(opening) * Math.PI);
    this.fricationTarget = clamp(
      constriction
        * (0.18 + clamp(velocity) * 0.82)
        * [0.2, 0.72, 1.28][this.index],
      0,
      1.4,
    );
    if (opening < 0.075) {
      this.storedPressure = clamp(
        this.storedPressure + pressure * 0.075,
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
    }
    const released = previousTarget < 0.1 && opening > 0.15;
    const openingJump = Math.max(0, opening - previousTarget);
    if (released || openingJump > 0.16) {
      const releaseStrength = Math.sqrt(this.storedPressure / COLONY_SYRINX_MAX_PRESSURE);
      const flowStrength = clamp(Math.sqrt(Math.max(0, flow) / 1.4));
      const pneumaticEnergy = clamp(releaseStrength + flowStrength * 0.62);
      this.burstEnvelope = Math.max(
        this.burstEnvelope,
        clamp(
          (openingJump * 1.8 + releaseStrength * 0.9 + flowStrength * 0.34)
            * pneumaticEnergy,
        ),
      );
      this.storedPressure *= 0.16;
      this.ratchetPhase = 0;
    }
    this.jetFrequencyHz = clamp(
      1_780 + gesture * 740 + opening * 1_460 + pressure * 620,
      1_600,
      6_200,
      2_400,
    );
    this.gestureIndex = gesture;
    this.targetOpening = opening;
    this.targetFlowActivity = clamp(Math.sqrt(Math.max(0, flow) / 1.4));
    this.targetEventActivity = clamp(eventActivity);
  }

  reset() {
    this.throat.reset();
    this.cavity.reset();
    this.tongue.reset();
    this.teeth.reset();
    this.tractDelay.fill(0);
    this.tractDelayIndex = 0;
    this.opening = 0;
    this.targetOpening = 0;
    this.flowActivity = 0;
    this.targetFlowActivity = 0;
    this.eventActivity = 0;
    this.targetEventActivity = 0;
    this.reflectedLoad = 0;
    this.lastRadiation = 0;
    this.feedbackState = 0;
    this.previousInput = 0;
    this.noiseMemory = 0;
    this.subharmonicPolarity = 1;
    this.jetPhase = 0;
    this.jetOvertonePhase = 0;
    this.jetAmplitude = 0;
    this.ratchetPhase = 0;
    this.burstEnvelope = 0;
    this.fricationEnvelope = 0;
    this.fricationTarget = 0;
    this.storedPressure = 0;
  }

  process(input, pressure, mediumId, noise, interference = 0) {
    this.opening += (this.targetOpening - this.opening) * this.openingAlpha;
    this.flowActivity += (
      this.targetFlowActivity - this.flowActivity
    ) * (this.targetFlowActivity > this.flowActivity ? 0.006 : 0.0024);
    this.eventActivity += (
      this.targetEventActivity - this.eventActivity
    ) * (this.targetEventActivity > this.eventActivity ? 0.012 : 0.0038);
    this.noiseMemory += (noise - this.noiseMemory) * 0.035;
    const turbulence = noise - this.noiseMemory;
    this.fricationEnvelope += (
      this.fricationTarget - this.fricationEnvelope
    ) * (this.fricationTarget > this.fricationEnvelope ? 0.006 : 0.0016);

    const delayed = this.tractDelay[this.tractDelayIndex];
    const acousticGate = clamp(
      this.eventActivity * (this.flowActivity * 1.18 + Math.abs(input) * 0.82)
        + this.burstEnvelope * 0.42,
    );
    const crossFeed = interference
      * (0.28 + this.index * 0.12)
      * (0.08 + acousticGate * 0.92);
    let excitation = input
      + crossFeed
      + delayed * MOUTH_DELAY_FEEDBACK[this.index] * (0.08 + acousticGate * 0.92)
      + this.feedbackState * MOUTH_INTERNAL_FEEDBACK[this.index] * acousticGate;
    const positiveCrossing = this.previousInput <= 0.018 && excitation > 0.018;
    if (positiveCrossing && this.index === 0) this.subharmonicPolarity *= -1;
    const edge = excitation - this.previousInput;
    this.previousInput = excitation;

    if (this.index === 0) {
      const falseFold = excitation * this.subharmonicPolarity;
      excitation = Math.tanh(excitation * 3.1 + falseFold * 1.42)
        + Math.tanh(excitation * 8.4) * 0.18;
    } else if (this.index === 1) {
      const folded = Math.sin(clamp(excitation * 4.6, -Math.PI * 1.5, Math.PI * 1.5));
      excitation = folded * 0.74 + Math.tanh(excitation * 2.2) * 0.46;
    } else {
      const jetTarget = clamp(
        pressure * this.opening * this.flowActivity * this.eventActivity * 0.92
          + this.fricationEnvelope * this.flowActivity * this.eventActivity * 0.38,
      );
      this.jetAmplitude += (jetTarget - this.jetAmplitude) * 0.0018;
      this.jetPhase += TWO_PI * this.jetFrequencyHz / this.rate;
      if (this.jetPhase >= TWO_PI) this.jetPhase %= TWO_PI;
      this.jetOvertonePhase += TWO_PI * this.jetFrequencyHz * 2.03 / this.rate;
      if (this.jetOvertonePhase >= TWO_PI) this.jetOvertonePhase %= TWO_PI;
      const jet = (
        Math.sin(this.jetPhase)
        + Math.sin(this.jetOvertonePhase + this.gestureIndex * 0.21) * 0.34
      ) * this.jetAmplitude;
      excitation = Math.tanh((edge * 8.2 + excitation * 0.68) * 3.4)
        + jet * 0.72;
    }

    this.ratchetPhase += TWO_PI * (430 + this.gestureIndex * 91) / this.rate;
    if (this.ratchetPhase >= TWO_PI) this.ratchetPhase %= TWO_PI;
    const ratchet = this.index === 2
      ? (Math.sin(this.ratchetPhase) > 0.22 ? 1 : -0.18)
      : 1;
    const burst = this.burstEnvelope * ratchet * (0.58 + turbulence * 0.42);
    this.burstEnvelope *= MOUTH_BURST_DECAY[this.index];
    const frication = turbulence
      * this.fricationEnvelope
      * this.flowActivity
      * this.eventActivity
      * MOUTH_FRICATION_GAIN[this.index];
    excitation += frication + burst * MOUTH_BURST_GAIN[this.index];

    const throatBand = this.throat.process(excitation);
    const cavityBand = this.cavity.process(excitation + throatBand * 0.24);
    const tongueBand = this.tongue.process(excitation - cavityBand * 0.18);
    const teethBand = this.teeth.process(
      frication + edge * MOUTH_EDGE_GAIN[this.index] + tongueBand * 0.12,
    );
    let radiation;
    if (this.index === 0) {
      radiation = excitation * this.directGain
        + throatBand * 1.34
        + cavityBand * 0.92
        - tongueBand * 0.42
        + teethBand * 0.18;
      radiation = Math.tanh(radiation * 1.7) + Math.tanh(radiation * 6.4) * 0.16;
    } else if (this.index === 1) {
      radiation = excitation * this.directGain
        + throatBand * 0.54
        - cavityBand * 1.08
        + tongueBand * 0.94
        + teethBand * 0.62;
      radiation = Math.tanh(radiation * 1.5 + Math.sin(radiation * 4.8) * 0.32);
    } else {
      radiation = excitation * this.directGain
        + throatBand * 0.22
        + cavityBand * 0.46
        + tongueBand * 0.86
        + teethBand * 1.28
        + burst * 0.44;
      radiation = Math.tanh(radiation * 2.15);
    }
    radiation *= (0.002 + acousticGate * 0.998) * this.radiationTrim;

    this.tractDelay[this.tractDelayIndex] = clean(Math.tanh(
      excitation * 0.52 + radiation * 0.21,
    ) * (0.24 + acousticGate * 0.58));
    this.tractDelayIndex = (this.tractDelayIndex + 1) % this.tractDelay.length;
    this.feedbackState += (
      radiation * acousticGate - this.feedbackState
    ) * (0.0024 + (1 - acousticGate) * 0.012);

    const mediumLoading = mediumId === "water" ? 1.45 : (mediumId === "pellets" ? 1.7 : 1);
    const closedLoad = pressure * (1 - this.opening) * 0.48 + this.storedPressure * 0.12;
    const reactiveLoad = (
      Math.abs(this.throat.low) * 0.064
      + Math.abs(this.cavity.band) * 0.042
      + Math.abs(this.tongue.band) * 0.028
      + Math.abs(this.teeth.band) * 0.012
    ) * mediumLoading;
    const targetLoad = clamp(closedLoad + reactiveLoad, 0, COLONY_SYRINX_MAX_PRESSURE);
    this.reflectedLoad += (targetLoad - this.reflectedLoad) * 0.0024;
    this.reflectedLoad = clamp(this.reflectedLoad, 0, COLONY_SYRINX_MAX_PRESSURE);
    this.lastRadiation = clean(radiation);
    return this.lastRadiation;
  }
}

class ColonySyrinxPressureProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const processorOptions = options.processorOptions ?? {};
    const initial = processorOptions.configuration
      ?? processorOptions.state
      ?? processorOptions
      ?? {};
    this.rate = clamp(sampleRate, 8_000, 384_000, 48_000);
    this.configuration = sanitizeColonySyrinxState(initial);
    this.configuredBreath = this.configuration.breath;
    this.breathActive = processorOptions.breathActive === true;
    this.breathValue = this.breathActive ? this.configuredBreath : 0;
    const initialPlaying = processorOptions.playing ?? initial.playing;
    this.transportPlaying = initialPlaying == null
      ? this.configuration.sequencerEnabled
      : Boolean(initialPlaying);
    this.runtime = createColonySyrinxRuntime();

    this.controlQuantum = Math.max(32, Math.round(this.rate / CONTROL_RATE_HZ));
    this.controlCountdown = 0;
    this.controlElapsedSamples = 0;
    this.telemetryQuantum = Math.max(128, Math.round(this.rate / TELEMETRY_RATE_HZ));
    this.telemetryCountdown = this.telemetryQuantum;

    this.foldPhases = new Float64Array(COLONY_SYRINX_FOLD_COUNT);
    this.foldLevels = new Float64Array(COLONY_SYRINX_FOLD_COUNT);
    this.foldDisplacements = new Float64Array(COLONY_SYRINX_FOLD_COUNT);
    this.foldVelocities = new Float64Array(COLONY_SYRINX_FOLD_COUNT);
    for (let index = 0; index < COLONY_SYRINX_FOLD_COUNT; index += 1) {
      this.foldPhases[index] = (index * 0.173 + Math.floor(index / 2) * 0.071) % 1;
    }
    this.sourceRate = Math.min(this.rate * SOURCE_OVERSAMPLE, MAX_SOURCE_RATE);
    this.sourceStepsPerOutput = this.sourceRate / this.rate;
    this.sourceStepPhase = 0;
    this.sourceEngines = FREAK_SOURCE_PROFILES.map((profile, index) => (
      new SyrinxSourceEngine({
        sampleRate: this.sourceRate,
        model: profile.model,
        seed: (Number(processorOptions.seed ?? initial.seed) || 0x436f6c6f)
          + index * 0x9e37,
        parameters: {
          ...profile,
          pressure: 0,
          frequencyHz: this.configuration.phonators[index].frequencyHz
            * profile.frequencyScale,
        },
      })
    ));
    this.sourceFrequenciesHz = new Float64Array(COLONY_SYRINX_PHONATOR_COUNT);
    this.sourceLowpassOne = new Float64Array(COLONY_SYRINX_PHONATOR_COUNT);
    this.sourceLowpassTwo = new Float64Array(COLONY_SYRINX_PHONATOR_COUNT);
    this.sourceIdleSamples = new Float64Array(COLONY_SYRINX_PHONATOR_COUNT);
    this.sourceSleeping = new Uint8Array(COLONY_SYRINX_PHONATOR_COUNT);
    this.sourceSleeping.fill(1);
    const sourceCutoff = Math.min(18_000, this.rate * 0.38);
    this.sourceLowpassAlpha = 1 - Math.exp(-TWO_PI * sourceCutoff / this.sourceRate);

    this.routeLevels = new Float64Array(COLONY_SYRINX_ROUTE_COUNT);
    this.routeShockEnvelopes = new Float64Array(COLONY_SYRINX_ROUTE_COUNT);
    this.routeDelayIndices = new Int32Array(COLONY_SYRINX_ROUTE_COUNT);
    this.routeDelayBuffers = ROUTE_DELAY_MILLISECONDS.map((milliseconds) => (
      new Float64Array(Math.max(2, Math.round(this.rate * milliseconds * 0.001)))
    ));
    this.autoExhaleBeat = 0;
    this.bankExhaleLevels = new Float64Array(COLONY_SYRINX_BANK_COUNT);
    this.bankFeedbackPressures = new Float64Array(COLONY_SYRINX_BANK_COUNT);
    this.bankFeedbackWeights = new Float64Array(COLONY_SYRINX_BANK_COUNT);
    this.phonatorSources = new Float64Array(COLONY_SYRINX_PHONATOR_COUNT);
    this.mouthDrives = new Float64Array(COLONY_SYRINX_MOUTH_COUNT);
    this.mouthDriveWeights = new Float64Array(COLONY_SYRINX_MOUTH_COUNT);
    this.mouthLoads = new Float64Array(COLONY_SYRINX_MOUTH_COUNT);
    this.mouths = Array.from(
      { length: COLONY_SYRINX_MOUTH_COUNT },
      (_, index) => new MouthLoad(this.rate, index),
    );
    this._configureMouths();
    this._configureFreakSources();

    this.noiseState = (Number(processorOptions.seed ?? initial.seed) || 0x436f6c6f) >>> 0;
    this.mediumLowpass = 0;
    this.impactEnvelope = 0;
    this.previousLeft = 0;
    this.previousRight = 0;
    this.renderedLeft = 0;
    this.renderedRight = 0;
    this.outputLowpassLeft = 0;
    this.outputLowpassRight = 0;
    this.outputHighpassInputLeft = 0;
    this.outputHighpassInputRight = 0;
    this.outputHighpassLeft = 0;
    this.outputHighpassRight = 0;
    this.outputHighpassPole = Math.exp(-TWO_PI * 25 / this.rate);
    this.outputLowpassAlpha = 1 - Math.exp(-TWO_PI * Math.min(12_000, this.rate * 0.36) / this.rate);
    this.limiterGain = 1;
    this.limiterReleaseAlpha = 1 - Math.exp(-1 / (this.rate * 0.08));
    this.limitedShare = 0;
    this.frameLimited = false;
    this.dcLeftInput = 0;
    this.dcLeftOutput = 0;
    this.dcRightInput = 0;
    this.dcRightOutput = 0;
    this.peak = 0;
    this.rms = 0;

    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _configureMouths() {
    for (let index = 0; index < COLONY_SYRINX_MOUTH_COUNT; index += 1) {
      this.mouths[index].configure(this.configuration.mouths[index]);
    }
  }

  _configureFreakSources() {
    for (let bank = 0; bank < COLONY_SYRINX_PHONATOR_COUNT; bank += 1) {
      const profile = FREAK_SOURCE_PROFILES[bank];
      const phonator = this.configuration.phonators[bank];
      const firstFold = bank * 2;
      const runtimeFrequency = (
        this.runtime.foldFrequenciesHz[firstFold]
        + this.runtime.foldFrequenciesHz[firstFold + 1]
      ) * 0.5;
      const baseFrequency = runtimeFrequency > 1
        ? runtimeFrequency
        : phonator.frequencyHz;
      const laneIndex = bank % COLONY_SYRINX_LANE_COUNT;
      const laneStep = this.runtime.laneStepIndices[laneIndex] ?? 0;
      const laneVelocity = this.runtime.laneVelocities[laneIndex] ?? 0;
      const stepRatio = SOURCE_STEP_RATIOS[bank][wrap(laneStep, 4)];
      const sourceGate = this.breathActive
        ? 1
        : this.transportPlaying ? this.bankExhaleLevels[bank] : 0;
      const routeOffset = bank * COLONY_SYRINX_MOUTH_COUNT;
      const connectedAperture = Math.max(
        this.runtime.routeApertures[routeOffset],
        this.runtime.routeApertures[routeOffset + 1],
        this.runtime.routeApertures[routeOffset + 2],
      );
      const connectionGate = smoothstep(0.004, 0.08, connectedAperture);
      const networkVoicing = clamp(this.runtime.phonatorLevels[bank]);
      const flutterDepth = [0.2, 0.28, 0.42, 0.17][bank];
      const flutterPhase = this.autoExhaleBeat * TWO_PI * [1.25, 2.6, 5.4, 3.8][bank]
        + laneStep * 0.71;
      const flutter = 1 - flutterDepth * 0.5 + Math.sin(flutterPhase) * flutterDepth * 0.5;
      const pressure = clamp(
        sourceGate
          * connectionGate
          * Math.sqrt(networkVoicing)
          * (0.62 + this.configuredBreath * 0.38)
          * flutter,
      );
      const frequencyHz = clamp(
        baseFrequency * profile.frequencyScale * stepRatio,
        profile.model === "syrinx" ? 40 : profile.model === "frog" ? 30 : 5,
        this.sourceRate * 0.2,
        120,
      );
      this.sourceFrequenciesHz[bank] = frequencyHz;
      this.sourceEngines[bank].setParameters({
        model: profile.model,
        frequencyHz,
        pressure,
        tension: clamp(phonator.tension + profile.tensionBias + laneVelocity * 0.08),
        adduction: clamp(profile.adduction + phonator.closure * 0.12),
        sourceScale: profile.sourceScale,
        breath: clamp(profile.breath + phonator.roughness * 0.22),
        roughness: clamp(
          profile.roughness
            + phonator.roughness * 0.28
            + this.configuration.colonyAmount * 0.08,
        ),
        asymmetry: clamp(
          profile.asymmetry + phonator.asymmetry * 0.36,
          -1,
          1,
          0,
        ),
        pulseRateHz: profile.pulseRateHz + laneVelocity * 19 + bank * 2.5,
        coupling: profile.coupling,
        sourceBalance: clamp(profile.asymmetry * 0.44, -1, 1, 0),
        feedback: clamp(profile.feedback + this.configuration.crossCoupling * 0.18),
        outputGain: profile.outputGain,
      });
      if (pressure > 0.0005) {
        this.sourceSleeping[bank] = 0;
        this.sourceIdleSamples[bank] = 0;
      }
    }
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      const patch = message.configuration ?? message.state ?? message.patch ?? {};
      const previousBreath = this.configuration.breath;
      this.configuration = sanitizeColonySyrinxState(patch, this.configuration);
      if (this.configuration.breath !== previousBreath || this.configuredBreath === previousBreath) {
        this.configuredBreath = this.configuration.breath;
      }
      this._configureMouths();
      this._configureFreakSources();
      this.controlCountdown = 0;
      return;
    }
    if (message.type === "breath") {
      const requested = Number(message.value ?? message.pressure ?? message.flow);
      if (Number.isFinite(requested)) this.configuredBreath = clamp(requested);
      if (message.active != null || message.held != null) {
        this.breathActive = Boolean(message.active ?? message.held);
      } else if (Number.isFinite(requested)) {
        this.breathActive = requested > 0;
      }
      this.controlCountdown = 0;
      return;
    }
    if (message.type === "transport") {
      if (message.playing != null || message.running != null) {
        this.transportPlaying = Boolean(message.playing ?? message.running);
      }
      const tempo = Number(message.tempoBpm ?? message.tempo);
      if (Number.isFinite(tempo)) {
        this.configuration = sanitizeColonySyrinxState(
          { tempoBpm: tempo },
          this.configuration,
        );
      }
      if (message.reset) this._resetClock();
      if (Number.isFinite(Number(message.step ?? message.stepIndex))) {
        this._setClockStep(message.step ?? message.stepIndex, message.laneSteps);
      } else if (Array.isArray(message.laneSteps)) {
        this._setClockStep(this.runtime.stepIndex, message.laneSteps);
      }
      this.controlCountdown = 0;
      return;
    }
    if (message.type === "panic") this._panic();
  }

  _setClockStep(step, laneSteps) {
    const suppliedLanes = Array.isArray(laneSteps) || ArrayBuffer.isView(laneSteps)
      ? laneSteps
      : this.runtime.laneStepIndices;
    this.runtime = createColonySyrinxRuntime({
      ...this.runtime,
      stepIndex: wrap(step, COLONY_SYRINX_SEQUENCE_LENGTH),
      stepElapsedSeconds: 0,
      laneStepIndices: Array.from(
        { length: COLONY_SYRINX_LANE_COUNT },
        (_, index) => wrap(
          suppliedLanes?.[index],
          this.configuration.lanes?.[index]?.length ?? COLONY_SYRINX_SEQUENCE_LENGTH,
        ),
      ),
      laneStepElapsedSeconds: Array(COLONY_SYRINX_LANE_COUNT).fill(0),
    });
  }

  _resetClock() {
    this._setClockStep(0, Array(COLONY_SYRINX_LANE_COUNT).fill(0));
    this.autoExhaleBeat = 0;
    this.bankExhaleLevels.fill(0);
  }

  _panic() {
    this.breathActive = false;
    this.breathValue = 0;
    this.runtime = createColonySyrinxRuntime();
    this.foldLevels.fill(0);
    this.foldDisplacements.fill(0);
    this.foldVelocities.fill(0);
    this.routeLevels.fill(0);
    this.routeShockEnvelopes.fill(0);
    this.routeDelayIndices.fill(0);
    for (const buffer of this.routeDelayBuffers) buffer.fill(0);
    this.autoExhaleBeat = 0;
    this.bankExhaleLevels.fill(0);
    this.bankFeedbackPressures.fill(0);
    this.bankFeedbackWeights.fill(0);
    this.phonatorSources.fill(0);
    this.mouthDrives.fill(0);
    this.mouthDriveWeights.fill(0);
    this.mouthLoads.fill(0);
    for (const mouth of this.mouths) mouth.reset();
    for (let index = 0; index < this.sourceEngines.length; index += 1) {
      this.sourceEngines[index].reset(this.noiseState + index * 0x9e37);
    }
    this.sourceFrequenciesHz.fill(0);
    this.sourceLowpassOne.fill(0);
    this.sourceLowpassTwo.fill(0);
    this.sourceIdleSamples.fill(0);
    this.sourceSleeping.fill(1);
    this.sourceStepPhase = 0;
    this.mediumLowpass = 0;
    this.impactEnvelope = 0;
    this.previousLeft = 0;
    this.previousRight = 0;
    this.renderedLeft = 0;
    this.renderedRight = 0;
    this.outputLowpassLeft = 0;
    this.outputLowpassRight = 0;
    this.outputHighpassInputLeft = 0;
    this.outputHighpassInputRight = 0;
    this.outputHighpassLeft = 0;
    this.outputHighpassRight = 0;
    this.limiterGain = 1;
    this.limitedShare = 0;
    this.frameLimited = false;
    this.dcLeftInput = 0;
    this.dcLeftOutput = 0;
    this.dcRightInput = 0;
    this.dcRightOutput = 0;
    this.controlCountdown = 0;
  }

  _random() {
    let value = this.noiseState | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.noiseState = value | 0;
    return (value >>> 0) / 2147483647.5 - 1;
  }

  _feedbackRuntime() {
    let hasLoad = false;
    const pressures = new Array(COLONY_SYRINX_MOUTH_COUNT);
    for (let index = 0; index < COLONY_SYRINX_MOUTH_COUNT; index += 1) {
      const reflected = clamp(this.mouths[index].reflectedLoad, 0, COLONY_SYRINX_MAX_PRESSURE);
      hasLoad ||= reflected > 1e-7;
      pressures[index] = clamp(
        Math.max(
          this.runtime.mouthPressures[index],
          reflected * (0.2 + this.configuration.crossCoupling * 0.45),
        ),
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
    }
    return hasLoad ? { ...this.runtime, mouthPressures: pressures } : this.runtime;
  }

  _advanceExhalePattern(seconds) {
    if (!this.transportPlaying) {
      this.bankExhaleLevels.fill(this.breathActive ? 1 : 0);
      return;
    }
    this.autoExhaleBeat = (
      this.autoExhaleBeat + seconds * this.configuration.tempoBpm / 60
    ) % AUTO_EXHALE_CYCLE_BEATS;
    if (this.breathActive) {
      this.bankExhaleLevels.fill(1);
      return;
    }
    for (let bankIndex = 0; bankIndex < COLONY_SYRINX_BANK_COUNT; bankIndex += 1) {
      this.bankExhaleLevels[bankIndex] = autoExhaleEnvelope(
        this.autoExhaleBeat,
        AUTO_EXHALE_PATTERN[bankIndex],
      );
    }
  }

  _advancePressureNetwork(sampleCount) {
    const seconds = clamp(sampleCount / this.rate, 0, 0.25, 0);
    const breathTarget = this.breathActive || this.transportPlaying ? this.configuredBreath : 0;
    this.breathValue += (
      breathTarget - this.breathValue
    ) * smoothingAlpha(breathTarget > 0 ? 9 : 5.5, seconds);
    this.configuration.breath = clamp(this.breathValue);
    this._advanceExhalePattern(seconds);

    const options = {};
    if (this.transportPlaying && !this.breathActive) {
      options.bankExhaleGates = this.bankExhaleLevels;
    }
    if (!this.transportPlaying) {
      options.stepIndex = this.runtime.stepIndex;
      options.laneStepIndices = this.runtime.laneStepIndices;
    }
    this.runtime = stepColonySyrinx(
      this._feedbackRuntime(),
      this.configuration,
      seconds,
      options,
    );
    this.impactEnvelope = Math.max(this.impactEnvelope, this.runtime.impact);
    this._configureFreakSources();

    for (let index = 0; index < COLONY_SYRINX_MOUTH_COUNT; index += 1) {
      let mouthEventActivity = this.breathActive ? 1 : 0;
      if (this.transportPlaying && !this.breathActive) {
        for (let bank = 0; bank < COLONY_SYRINX_BANK_COUNT; bank += 1) {
          mouthEventActivity = Math.max(
            mouthEventActivity,
            this.bankExhaleLevels[bank] * this.configuration.routes[bank][index],
          );
        }
      }
      this.mouths[index].articulate(
        this.configuration.mouths[index],
        this.runtime.mouthApertures[index],
        this.runtime.mouthFlows[index],
        this.runtime.mouthPressures[index],
        this.runtime.laneStepIndices[index],
        this.runtime.laneVelocities[index],
        this.autoExhaleBeat,
        mouthEventActivity,
      );
    }
  }

  _updateBankFeedback() {
    this.bankFeedbackPressures.fill(0);
    this.bankFeedbackWeights.fill(0);
    for (let routeIndex = 0; routeIndex < COLONY_SYRINX_ROUTE_COUNT; routeIndex += 1) {
      const route = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
      const aperture = this.runtime.routeApertures[routeIndex];
      if (aperture <= 1e-5) continue;
      const mouth = this.mouths[route.mouthIndex];
      const loadScale = 0.16
        + clamp(mouth.reflectedLoad / COLONY_SYRINX_MAX_PRESSURE) * 0.24;
      this.bankFeedbackPressures[route.phonatorIndex] += (
        mouth.lastRadiation * loadScale * aperture
      );
      this.bankFeedbackWeights[route.phonatorIndex] += aperture;
    }
    for (let bank = 0; bank < COLONY_SYRINX_BANK_COUNT; bank += 1) {
      const weight = this.bankFeedbackWeights[bank];
      if (weight > 1e-6) this.bankFeedbackPressures[bank] /= weight;
      this.bankFeedbackPressures[bank] = clamp(
        clean(this.bankFeedbackPressures[bank]),
        -1,
        1,
        0,
      );
    }
  }

  _renderPhonator(phonatorIndex, noise, sourceSteps) {
    const firstFold = phonatorIndex * 2;
    const secondFold = firstFold + 1;
    this.foldLevels[firstFold] += (
      this.runtime.foldActivities[firstFold] - this.foldLevels[firstFold]
    ) * 0.0024;
    this.foldLevels[secondFold] += (
      this.runtime.foldActivities[secondFold] - this.foldLevels[secondFold]
    ) * 0.0024;
    const activity = clamp(
      (this.foldLevels[firstFold] + this.foldLevels[secondFold]) * 0.5,
    );
    const sourceGate = this.breathActive
      ? 1
      : this.transportPlaying ? this.bankExhaleLevels[phonatorIndex] : 0;
    if (this.sourceSleeping[phonatorIndex]) {
      this.foldDisplacements[firstFold] = 0;
      this.foldDisplacements[secondFold] = 0;
      this.foldVelocities[firstFold] = 0;
      this.foldVelocities[secondFold] = 0;
      return 0;
    }
    const tractFeedback = this.bankFeedbackPressures[phonatorIndex];
    let physical = 0;
    let bilateralSum = 0;
    for (let substep = 0; substep < sourceSteps; substep += 1) {
      const raw = this.sourceEngines[phonatorIndex].renderSample(tractFeedback);
      this.sourceLowpassOne[phonatorIndex] += (
        raw - this.sourceLowpassOne[phonatorIndex]
      ) * this.sourceLowpassAlpha;
      this.sourceLowpassTwo[phonatorIndex] += (
        this.sourceLowpassOne[phonatorIndex] - this.sourceLowpassTwo[phonatorIndex]
      ) * this.sourceLowpassAlpha;
      physical += this.sourceLowpassTwo[phonatorIndex];
      bilateralSum += this.sourceEngines[phonatorIndex].bilateralDifference ?? 0;
    }
    physical /= sourceSteps;
    const previousSource = this.phonatorSources[phonatorIndex];
    const bilateral = bilateralSum / sourceSteps;
    let source = physical
      * Math.sqrt(sourceGate)
      * (0.28 + activity * 0.98);
    if (phonatorIndex === 0) {
      source = Math.tanh(source * 2.25) + noise * Math.abs(source) * 0.13;
    } else if (phonatorIndex === 1) {
      source = Math.tanh(source * 1.72 + bilateral * sourceGate * 0.26);
    } else if (phonatorIndex === 2) {
      source = Math.tanh(source * 2.08) + noise * Math.abs(source) * 0.19;
    } else {
      source = Math.tanh(source * 1.64) + (source - previousSource) * 0.18;
    }
    source = clamp(clean(source), -1.8, 1.8, 0);
    if (sourceGate <= 1e-5) {
      this.sourceIdleSamples[phonatorIndex] += sourceSteps;
      if (this.sourceIdleSamples[phonatorIndex] >= this.sourceRate * 0.08) {
        this.sourceEngines[phonatorIndex].reset(
          this.noiseState + phonatorIndex * 0x9e37,
        );
        this.sourceLowpassOne[phonatorIndex] = 0;
        this.sourceLowpassTwo[phonatorIndex] = 0;
        this.sourceSleeping[phonatorIndex] = 1;
        source = 0;
      }
    } else {
      this.sourceIdleSamples[phonatorIndex] = 0;
    }

    const phonator = this.configuration.phonators[phonatorIndex];
    const pairDifference = clamp(
      bilateral * 0.64 + phonator.asymmetry * 0.18,
      -1,
      1,
      0,
    );
    const firstDisplacement = clamp(
      source * (1 - pairDifference * 0.28) + pairDifference * activity * 0.16,
      -1,
      1,
      0,
    );
    const secondDisplacement = clamp(
      source * (1 + pairDifference * 0.28) - pairDifference * activity * 0.16,
      -1,
      1,
      0,
    );
    const frequency = this.sourceFrequenciesHz[phonatorIndex];
    const previousFirst = this.foldDisplacements[firstFold];
    const previousSecond = this.foldDisplacements[secondFold];
    this.foldDisplacements[firstFold] = clean(firstDisplacement);
    this.foldDisplacements[secondFold] = clean(secondDisplacement);
    this.foldVelocities[firstFold] = clamp(
      (firstDisplacement - previousFirst) * this.rate,
      -this.rate,
      this.rate,
      0,
    );
    this.foldVelocities[secondFold] = clamp(
      (secondDisplacement - previousSecond) * this.rate,
      -this.rate,
      this.rate,
      0,
    );
    return source;
  }

  _mediumExcitation(noise) {
    const mediumId = this.configuration.mediumId;
    const pressureEnergy = clamp(
      this.runtime.meanPressure * 0.34 + this.runtime.totalFlow * 0.72,
    );
    if (mediumId === "water") {
      const alpha = 1 - Math.exp(-TWO_PI * 1_800 / this.rate);
      this.mediumLowpass += (noise - this.mediumLowpass) * alpha;
      const bubble = this.runtime.impact * this._random() * 0.34;
      return this.mediumLowpass * (0.055 + this.runtime.totalFlow * 0.008) * pressureEnergy
        + bubble;
    }
    if (mediumId === "pellets") {
      const activity = clamp(this.runtime.granularActivity + this.runtime.impact * 0.6);
      if (this._random() > 1 - activity * 0.045) {
        this.impactEnvelope = Math.max(this.impactEnvelope, activity * (0.3 + Math.abs(noise) * 0.7));
      }
      const impulse = noise * this.impactEnvelope;
      this.impactEnvelope *= 0.972;
      return impulse * 0.46 + noise * activity * 0.07;
    }
    this.impactEnvelope *= 0.985;
    return noise * (0.018 + this.runtime.totalFlow * 0.0025) * pressureEnergy
      + noise * this.impactEnvelope * 0.035 * pressureEnergy;
  }

  _renderFrame() {
    const noise = this._random();
    this.sourceStepPhase += this.sourceStepsPerOutput;
    const sourceSteps = Math.max(1, Math.floor(this.sourceStepPhase));
    this.sourceStepPhase -= sourceSteps;

    for (let phonator = 0; phonator < COLONY_SYRINX_PHONATOR_COUNT; phonator += 1) {
      this.phonatorSources[phonator] = this._renderPhonator(
        phonator,
        phonator % 2 === 0 ? noise : -noise,
        sourceSteps,
      );
    }

    this.mouthDrives.fill(0);
    this.mouthDriveWeights.fill(0);
    const routeAlpha = 1 - Math.exp(-1 / (this.rate * 0.0055));
    for (let routeIndex = 0; routeIndex < COLONY_SYRINX_ROUTE_COUNT; routeIndex += 1) {
      const route = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
      const target = clamp(
        this.runtime.routeApertures[routeIndex]
          * Math.sqrt(this.runtime.routeFlows[routeIndex] / 2.5),
        0,
        1.5,
      );
      const movement = Math.abs(target - this.routeLevels[routeIndex]);
      this.routeShockEnvelopes[routeIndex] = Math.max(
        this.routeShockEnvelopes[routeIndex] * 0.994,
        clamp(movement * 4.8 + this.runtime.impact * 0.34),
      );
      this.routeLevels[routeIndex] += (target - this.routeLevels[routeIndex]) * routeAlpha;
      const level = this.routeLevels[routeIndex];
      const buffer = this.routeDelayBuffers[routeIndex];
      const delayIndex = this.routeDelayIndices[routeIndex];
      const delayed = buffer[delayIndex];
      const shockNoise = noise * (routeIndex % 2 === 0 ? 1 : -1)
        * this.routeShockEnvelopes[routeIndex]
        * (0.075 + route.mouthIndex * 0.045);
      const routeInput = this.phonatorSources[route.phonatorIndex] * level + shockNoise;
      const reflection = 0.07
        + this.configuration.crossCoupling * 0.14
        + route.phonatorIndex * 0.012;
      buffer[delayIndex] = clean(Math.tanh(routeInput + delayed * reflection) * 0.94);
      this.routeDelayIndices[routeIndex] = (delayIndex + 1) % buffer.length;
      this.mouthDrives[route.mouthIndex] += delayed + routeInput * 0.16;
      this.mouthDriveWeights[route.mouthIndex] += level * level;
    }
    for (let mouthIndex = 0; mouthIndex < COLONY_SYRINX_MOUTH_COUNT; mouthIndex += 1) {
      this.mouthDrives[mouthIndex] /= Math.sqrt(Math.max(1, this.mouthDriveWeights[mouthIndex]));
    }

    const medium = COLONY_SYRINX_MEDIA[this.configuration.mediumId] ?? COLONY_SYRINX_MEDIA.air;
    const excitation = this._mediumExcitation(noise);
    const previousMouthZero = this.mouths[0].lastRadiation;
    const previousMouthOne = this.mouths[1].lastRadiation;
    const previousMouthTwo = this.mouths[2].lastRadiation;
    const interferenceScale = 0.32 + this.configuration.crossCoupling * 0.86;
    const interferenceZero = previousMouthOne * 0.44 - previousMouthTwo * 0.2;
    const interferenceOne = previousMouthZero * 0.34 + previousMouthTwo * 0.38;
    const interferenceTwo = (previousMouthZero - previousMouthOne) * 0.31
      + previousMouthZero * previousMouthOne * 1.14;
    let left = 0;
    let right = 0;
    let activeMouths = 0;
    for (let mouthIndex = 0; mouthIndex < COLONY_SYRINX_MOUTH_COUNT; mouthIndex += 1) {
      const mouth = this.mouths[mouthIndex];
      const flow = this.runtime.mouthFlows[mouthIndex];
      if (this.runtime.mouthApertures[mouthIndex] > 0.02 || flow > 0.02) activeMouths += 1;
      const drive = this.mouthDrives[mouthIndex]
        + excitation * (MOUTH_EXCITATION_GAINS[mouthIndex] + Math.sqrt(flow) * 0.28);
      const mouthInterference = mouthIndex === 0
        ? interferenceZero
        : mouthIndex === 1 ? interferenceOne : interferenceTwo;
      const radiated = mouth.process(
        drive,
        this.runtime.mouthPressures[mouthIndex],
        this.configuration.mediumId,
        this._random(),
        mouthInterference * interferenceScale,
      );
      this.mouthLoads[mouthIndex] = clamp(
        Math.max(this.runtime.mouthPressures[mouthIndex], mouth.reflectedLoad),
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
      const leftGain = Math.sqrt((1 - mouth.pan) * 0.5);
      const rightGain = Math.sqrt((1 + mouth.pan) * 0.5);
      left += radiated * leftGain;
      right += radiated * rightGain;
    }
    // Feed the signed, audio-rate tract return into the next source sample.
    // Compression and rarefaction can now oppose or assist the tissue motion.
    this._updateBankFeedback();

    const activeMouthScale = 1 / Math.sqrt(Math.max(1, activeMouths * 0.78));
    const simultaneousSourceScale = this.breathActive ? 0.3 : 1;
    const gain = this.configuration.level
      * medium.outputGain
      * 2.5
      * activeMouthScale
      * simultaneousSourceScale;
    const drivenLeft = left * gain;
    const drivenRight = right * gain;
    left = drivenLeft / (1 + Math.abs(drivenLeft) * 0.42);
    right = drivenRight / (1 + Math.abs(drivenRight) * 0.42);

    const highpassedLeft = left
      - this.outputHighpassInputLeft
      + this.outputHighpassPole * this.outputHighpassLeft;
    const highpassedRight = right
      - this.outputHighpassInputRight
      + this.outputHighpassPole * this.outputHighpassRight;
    this.outputHighpassInputLeft = left;
    this.outputHighpassInputRight = right;
    this.outputHighpassLeft = clean(highpassedLeft);
    this.outputHighpassRight = clean(highpassedRight);
    this.outputLowpassLeft += (
      highpassedLeft - this.outputLowpassLeft
    ) * this.outputLowpassAlpha;
    this.outputLowpassRight += (
      highpassedRight - this.outputLowpassRight
    ) * this.outputLowpassAlpha;

    const linkedPeak = Math.max(
      Math.abs(this.outputLowpassLeft),
      Math.abs(this.outputLowpassRight),
    );
    const requiredGain = linkedPeak > OUTPUT_LIMIT ? OUTPUT_LIMIT / linkedPeak : 1;
    if (requiredGain < this.limiterGain) this.limiterGain = requiredGain;
    else this.limiterGain += (1 - this.limiterGain) * this.limiterReleaseAlpha;
    // Count a frame only when it asks the linked limiter for fresh gain
    // reduction. The release tail is deliberately slow, but treating that
    // inaudible recovery as continued limiting makes the telemetry misleading.
    this.frameLimited = requiredGain < 0.9999;
    this.previousLeft = clamp(
      this.outputLowpassLeft * this.limiterGain,
      -OUTPUT_LIMIT,
      OUTPUT_LIMIT,
      0,
    );
    this.previousRight = clamp(
      this.outputLowpassRight * this.limiterGain,
      -OUTPUT_LIMIT,
      OUTPUT_LIMIT,
      0,
    );
    this.renderedLeft = this.previousLeft;
    this.renderedRight = this.previousRight;
  }

  _postTelemetry() {
    const runtime = this.runtime;
    let load = 0;
    for (let index = 0; index < COLONY_SYRINX_MOUTH_COUNT; index += 1) {
      load += this.mouthLoads[index];
    }
    load /= COLONY_SYRINX_MOUTH_COUNT;
    this.port.postMessage({
      type: "telemetry",
      reservoirs: Array.from(runtime.reservoirPressures),
      lungs: Array.from(runtime.lungPressures),
      folds: Array.from(runtime.foldActivities),
      routes: Array.from(runtime.routeFlows),
      mouths: Array.from(runtime.mouthFlows),
      step: runtime.stepIndex,
      laneSteps: Array.from(runtime.laneStepIndices ?? Array(COLONY_SYRINX_LANE_COUNT).fill(0)),
      flow: runtime.totalFlow,
      load,
      foldDisplacements: Array.from(this.foldDisplacements),
      foldFrequenciesHz: Array.from(runtime.foldFrequenciesHz),
      routeApertures: Array.from(runtime.routeApertures),
      mouthPressures: Array.from(runtime.mouthPressures),
      mouthLoads: Array.from(this.mouthLoads),
      mouthGestures: this.mouths.map((mouth) => mouth.gestureIndex),
      exhales: Array.from(this.bankExhaleLevels),
      exhaleBeat: this.autoExhaleBeat,
      sourceModels: FREAK_SOURCE_PROFILES.map((profile) => profile.id),
      sourceFrequenciesHz: Array.from(this.sourceFrequenciesHz),
      mediumId: this.configuration.mediumId,
      limiterGain: this.limiterGain,
      limitedShare: this.limitedShare,
      peak: this.peak,
      rms: this.rms,
    });
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    const frameCount = output[0].length;
    let peak = 0;
    let squareSum = 0;
    let limitedFrames = 0;

    for (let frame = 0; frame < frameCount; frame += 1) {
      if (this.controlCountdown <= 0) {
        const elapsed = Math.max(1, this.controlElapsedSamples || this.controlQuantum);
        this._advancePressureNetwork(elapsed);
        this.controlElapsedSamples = 0;
        this.controlCountdown += this.controlQuantum;
      }
      this._renderFrame();
      if (this.frameLimited) limitedFrames += 1;
      const left = this.renderedLeft;
      const right = this.renderedRight;
      output[0][frame] = left;
      if (output[1]) output[1][frame] = right;
      for (let channel = 2; channel < output.length; channel += 1) {
        output[channel][frame] = (left + right) * 0.5;
      }
      const magnitude = Math.max(Math.abs(left), Math.abs(right));
      peak = Math.max(peak, magnitude);
      squareSum += (left * left + right * right) * 0.5;
      this.controlCountdown -= 1;
      this.controlElapsedSamples += 1;
      this.telemetryCountdown -= 1;
    }

    const blockRms = Math.sqrt(squareSum / Math.max(1, frameCount));
    const blockLimitedShare = limitedFrames / Math.max(1, frameCount);
    this.limitedShare += (blockLimitedShare - this.limitedShare) * 0.12;
    this.peak += (peak - this.peak) * 0.28;
    this.rms += (blockRms - this.rms) * 0.2;
    if (this.telemetryCountdown <= 0) {
      this.telemetryCountdown += this.telemetryQuantum;
      this._postTelemetry();
    }
    return true;
  }
}

registerProcessor("colony-syrinx-pressure-network", ColonySyrinxPressureProcessor);

export { ColonySyrinxPressureProcessor };
