import {
  COLONY_SYRINX_BANK_COUNT,
  COLONY_SYRINX_FOLD_COUNT,
  COLONY_SYRINX_LANE_COUNT,
  COLONY_SYRINX_LEGACY_LANE_COUNT,
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
const CONTINUOUS_CONTOUR_COUNT = 6;
const CALL_MINIMUM_SECONDS = 0.05;
const CALL_MAXIMUM_SECONDS = 120;
const CALL_ATTACK_SECONDS = 0.035;
const CALL_RELEASE_SECONDS = 0.14;

const CALL_ARTICULATION_MODES = new Set([
  "tone",
  "plosive",
  "lip-pop",
  "tongue-click",
  "puff",
  "impact",
  "pulse",
  "throb",
  "sustained",
  "flow",
  "mouth-call",
]);

const LEGACY_CALL_ARTICULATION = Object.freeze({
  mode: "sustained",
  strike: 0,
  attackMs: CALL_ATTACK_SECONDS * 1_000,
  releaseMs: CALL_RELEASE_SECONDS * 1_000,
  prechargeMs: 0,
  burst: 0,
  pulseRateHz: 0,
  pulseDepth: 0,
  pushPull: 0,
  brightness: 1,
  noise: 1,
});

const MODE_ARTICULATION_DEFAULTS = Object.freeze({
  tone: Object.freeze({
    strike: 0.04, attackMs: 4, releaseMs: 70, prechargeMs: 0, burst: 0,
    pulseRateHz: 0, pulseDepth: 0, pushPull: 0.08, brightness: 0.34, noise: 0.04,
  }),
  plosive: Object.freeze({
    strike: 0.9, attackMs: 0.8, releaseMs: 42, prechargeMs: 22, burst: 0.94,
    pulseRateHz: 0, pulseDepth: 0, pushPull: 0.22, brightness: 0.56, noise: 0.24,
  }),
  "lip-pop": Object.freeze({
    strike: 0.92, attackMs: 0.5, releaseMs: 54, prechargeMs: 28, burst: 0.9,
    pulseRateHz: 0, pulseDepth: 0, pushPull: 0.2, brightness: 0.24, noise: 0.1,
  }),
  "tongue-click": Object.freeze({
    strike: 0.96, attackMs: 0.35, releaseMs: 28, prechargeMs: 16, burst: 0.96,
    pulseRateHz: 0, pulseDepth: 0, pushPull: 0.08, brightness: 0.68, noise: 0.16,
  }),
  puff: Object.freeze({
    strike: 0.42, attackMs: 2, releaseMs: 90, prechargeMs: 12, burst: 0.38,
    pulseRateHz: 0, pulseDepth: 0, pushPull: 0.28, brightness: 0.3, noise: 0.7,
  }),
  impact: Object.freeze({
    strike: 1, attackMs: 0.4, releaseMs: 34, prechargeMs: 10, burst: 1,
    pulseRateHz: 0, pulseDepth: 0, pushPull: 0.14, brightness: 0.48, noise: 0.28,
  }),
  pulse: Object.freeze({
    strike: 0.24, attackMs: 2, releaseMs: 58, prechargeMs: 8, burst: 0.18,
    pulseRateHz: 7.5, pulseDepth: 0.88, pushPull: 0.48, brightness: 0.42, noise: 0.16,
  }),
  throb: Object.freeze({
    strike: 0.08, attackMs: 5, releaseMs: 95, prechargeMs: 0, burst: 0,
    pulseRateHz: 2.4, pulseDepth: 0.72, pushPull: 0.72, brightness: 0.3, noise: 0.08,
  }),
  sustained: LEGACY_CALL_ARTICULATION,
  flow: LEGACY_CALL_ARTICULATION,
  "mouth-call": Object.freeze({
    strike: 0.2, attackMs: 7, releaseMs: 85, prechargeMs: 6, burst: 0.12,
    pulseRateHz: 3.4, pulseDepth: 0.2, pushPull: 0.22, brightness: 0.44, noise: 0.16,
  }),
});

const VOCAL_SOURCE_PROFILES = Object.freeze([
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

// Source engines can accept ultrasonic-adjacent fundamentals for reuse by
// other instruments, but this many-source body becomes fatiguing when a whole
// bank settles into that range. These per-organ ceilings retain the brighter
// syrinx registers without allowing a randomized sustained power-tool whine.
const VOCAL_SOURCE_CEILINGS_HZ = Object.freeze([720, 1_900, 1_000, 2_600]);

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

// Moving the small mouth still sweeps markedly higher than the bass and speech
// exits. The upper resonators are bounded to useful audible color, rather than
// tracking extreme geometry into a narrow 10–20 kHz ring.
const MOUTH_FORMANT_CEILINGS_HZ = Object.freeze([
  Object.freeze([1_100, 2_800, 4_600, 6_200]),
  Object.freeze([2_100, 4_600, 6_400, 7_600]),
  Object.freeze([3_800, 5_600, 6_900, 7_900]),
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

function sanitizeCallArticulation(source, fallback = LEGACY_CALL_ARTICULATION) {
  const value = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : LEGACY_CALL_ARTICULATION;
  const requestedMode = typeof value.mode === "string" ? value.mode.trim().toLowerCase() : "";
  const fallbackMode = typeof base.mode === "string" ? base.mode.trim().toLowerCase() : "";
  const mode = CALL_ARTICULATION_MODES.has(requestedMode)
    ? requestedMode
    : CALL_ARTICULATION_MODES.has(fallbackMode) ? fallbackMode : "sustained";
  const defaults = MODE_ARTICULATION_DEFAULTS[mode] ?? LEGACY_CALL_ARTICULATION;
  const numericBase = CALL_ARTICULATION_MODES.has(requestedMode) && requestedMode !== fallbackMode
    ? defaults
    : base;
  const number = (key, minimum, maximum) => clamp(
    value[key],
    minimum,
    maximum,
    clamp(numericBase[key], minimum, maximum, defaults[key]),
  );
  return Object.freeze({
    mode,
    strike: number("strike", 0, 1),
    attackMs: number("attackMs", 0, 2_000),
    releaseMs: number("releaseMs", 0, 5_000),
    prechargeMs: number("prechargeMs", 0, 2_000),
    burst: number("burst", 0, 1),
    pulseRateHz: number("pulseRateHz", 0, 80),
    pulseDepth: number("pulseDepth", 0, 1),
    pushPull: number("pushPull", 0, 1),
    brightness: number("brightness", 0, 1),
    noise: number("noise", 0, 1),
  });
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

function clean(value) {
  return Number.isFinite(value) && Math.abs(value) >= SILENCE_FLOOR ? value : 0;
}

function foldEnabled(configuration, foldIndex) {
  const phonatorIndex = Math.floor(foldIndex / 2);
  return configuration.phonatorEnabled?.[phonatorIndex] !== false
    && configuration.foldEnabled?.[foldIndex] !== false;
}

function interpolateMouthGesture(mouthIndex, phase) {
  const gestures = MOUTH_GESTURES_HZ[mouthIndex] ?? MOUTH_GESTURES_HZ[0];
  const cyclicPhase = ((Number(phase) || 0) % 1 + 1) % 1;
  const position = cyclicPhase * gestures.length;
  const leftIndex = Math.floor(position) % gestures.length;
  const rightIndex = (leftIndex + 1) % gestures.length;
  const amount = smoothstep(0, 1, position - Math.floor(position));
  return gestures[leftIndex].map((frequency, index) => (
    frequency + (gestures[rightIndex][index] - frequency) * amount
  ));
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
 * constriction noise, and pressure-release state. Continuous contour motion
 * therefore changes vowels and consonants instead of multiplying a static tone.
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
    this.networkActivity = 0;
    this.targetNetworkActivity = 0;
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
    this.transientEnvelope = 0;
    this.transientPhase = 0;
    this.transientFrequencyHz = 240;
    this.transientDecay = Math.exp(-1 / (rate * 0.018));
    this.transientToneMix = 0.5;
    this.transientNoiseMix = 0.5;
    this.transientDirectMix = 0.4;
    this.fricationEnvelope = 0;
    this.fricationTarget = 0;
    this.storedPressure = 0;
    this.gestureIndex = 0;
    this.gestureMotion = 0;
    this.gestureCoordinate = 0;
    this.gestureReady = false;
    this.formantsHz = [0, 0, 0, 0];
    this.brightness = 1;
    this.noiseAmount = 1;
    this.lipSize = 0.5;
    this.lipTension = 0.5;
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
    this.lipSize = clamp(mouth.lipSize, 0, 1, 0.5);
    this.lipTension = clamp(mouth.lipTension, 0, 1, 0.5);
  }

  articulate(
    mouth,
    aperture,
    flow,
    pressure,
    gesturePhase,
    contourValue,
    contourPhase,
    networkActivity,
    seconds = 1 / CONTROL_RATE_HZ,
    spectral = LEGACY_CALL_ARTICULATION,
  ) {
    const previousTarget = this.targetOpening;
    const opening = clamp(aperture);
    const phase = ((Number(gesturePhase) || 0) % 1 + 1) % 1;
    // The drawn contour's height owns the tongue/cavity trajectory. Phase adds
    // only a small cyclic muscular drift, so flattening or redrawing a lane
    // produces a meaningfully different timbre instead of the same canned
    // four-formant sweep behind a changing output aperture.
    const gestureTarget = clamp(
      0.08 + clamp(contourValue) * 0.78 + Math.sin(phase * TWO_PI) * 0.06,
      0,
      0.999,
    );
    if (!this.gestureReady) {
      this.gestureCoordinate = gestureTarget;
      this.gestureReady = true;
    } else {
      const gestureAlpha = 1 - Math.exp(
        -clamp(seconds, 0, 0.25, 1 / CONTROL_RATE_HZ) / 0.036,
      );
      this.gestureCoordinate += (gestureTarget - this.gestureCoordinate) * gestureAlpha;
    }
    const gestureCoordinate = clamp(this.gestureCoordinate, 0, 0.999);
    const gesturePosition = gestureCoordinate * MOUTH_GESTURES_HZ[this.index].length;
    const gestureMotion = gestureCoordinate * (MOUTH_GESTURES_HZ[this.index].length - 1);
    const frequencies = interpolateMouthGesture(this.index, gestureCoordinate);
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
    const brightness = clamp(spectral?.brightness, 0, 1, 1);
    const noiseAmount = clamp(spectral?.noise, 0, 1, 1);
    const qualityScale = 0.46 + brightness * 0.54;
    const upperBandScale = 0.7 + brightness * 0.3;
    const pressureWarp = 1 + (pressure - 0.5) * [0.09, -0.055, 0.12][this.index];
    const phaseWarp = 1 + Math.sin(
      ((Number(contourPhase) || 0) + this.index * 0.271) * TWO_PI,
    ) * [0.055, 0.08, 0.11][this.index];
    const formantCeilings = MOUTH_FORMANT_CEILINGS_HZ[this.index]
      ?? MOUTH_FORMANT_CEILINGS_HZ[1];
    const formants = [
      frequencies[0] * resonanceScale * (0.76 + opening * 0.42)
        * (1.08 - cavityVolume * 0.16) * pressureWarp,
      frequencies[1] * resonanceScale * (0.82 + tonguePosition * 0.34)
        * (1.14 - cavityVolume * 0.28) * phaseWarp,
      frequencies[2] * resonanceScale * (0.88 + tongueSize * 0.24) * upperBandScale,
      frequencies[3] * resonanceScale * (0.84 + lipTension * 0.28) * upperBandScale,
    ].map((frequency, index) => clamp(
      frequency,
      18,
      Math.min(formantCeilings[index], this.rate * 0.42),
      440,
    ));
    this.formantsHz = formants;
    this.throat.configure(
      formants[0],
      ([5.8, 7.2, 10.8][this.index] + lipSize * 1.6 + cavityVolume * 0.8)
        * (0.72 + brightness * 0.28),
    );
    this.cavity.configure(
      formants[1],
      ([7.2, 9.4, 13.2][this.index] + tongueSize * 1.8 + cavityVolume * 1.1)
        * qualityScale,
    );
    this.tongue.configure(
      formants[2],
      ([6.4, 10.2, 12.4][this.index] + lipTension * 0.7) * qualityScale,
    );
    this.teeth.configure(
      formants[3],
      [4.6, 8.2, 10.6][this.index] * qualityScale,
    );

    const constriction = Math.sin(clamp(opening) * Math.PI);
    this.fricationTarget = clamp(
      constriction
        * (0.18 + clamp(contourValue) * 0.82)
        * [0.2, 0.72, 1.28][this.index],
      0,
      1.4,
    );
    if (opening < 0.075) {
      this.storedPressure = clamp(
        this.storedPressure + pressure * clamp(seconds, 0, 0.25, 0) * 9,
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
    } else {
      this.storedPressure *= Math.exp(-clamp(seconds, 0, 0.25, 0) * (0.4 + opening * 1.8));
    }
    const openingJump = Math.max(0, opening - previousTarget);
    const openingVelocity = openingJump / Math.max(1e-6, clamp(seconds, 0, 0.25, 1 / CONTROL_RATE_HZ));
    const pressureLoaded = this.storedPressure > 0.08 || pressure > 0.16;
    const released = previousTarget < 0.1 && opening > 0.15 && pressureLoaded;
    if (pressureLoaded && (released || (openingJump > 0.025 && openingVelocity > 1.4))) {
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
      1_420 + gestureMotion * 460 + opening * 880 + pressure * 360,
      1_250,
      4_200,
      2_100,
    );
    this.gestureIndex = gesturePosition;
    this.gestureMotion = gestureMotion;
    this.targetOpening = opening;
    this.targetFlowActivity = clamp(Math.sqrt(Math.max(0, flow) / 1.4));
    this.targetNetworkActivity = clamp(networkActivity);
    this.brightness = brightness;
    this.noiseAmount = noiseAmount;
  }

  triggerArticulation(articulation, pressure = 0, openingVelocity = 1) {
    const strike = clamp(articulation?.strike);
    const burst = clamp(articulation?.burst);
    if (strike <= 1e-6 && burst <= 1e-6) return;
    const pressureEnergy = clamp(
      Math.sqrt(Math.max(this.storedPressure, pressure, 0) / COLONY_SYRINX_MAX_PRESSURE),
    );
    const velocityEnergy = clamp(openingVelocity, 0, 1, 1);
    const strength = clamp(
      (strike * 0.72 + burst * 0.78)
        * (0.46 + pressureEnergy * 0.54)
        * (0.68 + velocityEnergy * 0.32),
    );
    const mode = articulation?.mode;
    if (mode === "lip-pop") {
      // Lip mass, tension, and the speed of the opening are the pop's
      // resonator—not merely labels on a generic impulse. Large loose lips
      // make a low, long pop; small tense lips and a fast release snap higher.
      const lipMass = 0.7 + this.lipSize * 0.72;
      const tensionPitch = 0.62 + this.lipTension * 0.94;
      const velocityPitch = 0.84 + velocityEnergy * 0.34;
      this.transientFrequencyHz = clamp(
        ([132, 188, 264][this.index] ?? 188)
          * tensionPitch * velocityPitch / lipMass,
        54,
        1_200,
        154,
      );
      const popSeconds = (
        0.012
        + this.lipSize * 0.041
        + (1 - this.lipTension) * 0.013
      ) * (1.1 - velocityEnergy * 0.24);
      this.transientDecay = Math.exp(-1 / (this.rate * popSeconds));
      this.transientToneMix = 0.68 + this.lipSize * 0.3;
      this.transientNoiseMix = 0.035
        + (1 - this.lipSize) * 0.14
        + this.lipTension * 0.07;
      this.transientDirectMix = clamp(
        0.52 + velocityEnergy * 0.3 + this.lipSize * 0.12,
      );
    } else if (mode === "tongue-click") {
      this.transientFrequencyHz = [1_180, 2_080, 3_180][this.index] ?? 2_080;
      this.transientDecay = Math.exp(-1 / (this.rate * 0.006));
      this.transientToneMix = 0.34;
      this.transientNoiseMix = 0.94;
      this.transientDirectMix = 0.92;
    } else if (mode === "puff") {
      this.transientFrequencyHz = [180, 360, 720][this.index] ?? 360;
      this.transientDecay = Math.exp(-1 / (this.rate * 0.052));
      this.transientToneMix = 0.08;
      this.transientNoiseMix = 1;
      this.transientDirectMix = 0.48;
    } else if (mode === "impact") {
      this.transientFrequencyHz = [240, 620, 1_420][this.index] ?? 620;
      this.transientDecay = Math.exp(-1 / (this.rate * 0.014));
      this.transientToneMix = 0.52;
      this.transientNoiseMix = 0.78;
      this.transientDirectMix = 0.7;
    } else {
      this.transientFrequencyHz = [172, 760, 1_860][this.index] ?? 760;
      this.transientDecay = Math.exp(-1 / (this.rate * 0.018));
      this.transientToneMix = 0.42;
      this.transientNoiseMix = 0.82;
      this.transientDirectMix = 0.62;
    }
    this.transientEnvelope = Math.max(this.transientEnvelope, strength);
    this.burstEnvelope = Math.max(this.burstEnvelope, strength * (0.5 + burst * 0.5));
    this.transientPhase = 0;
    this.ratchetPhase = 0;
    this.storedPressure *= 0.14;
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
    this.networkActivity = 0;
    this.targetNetworkActivity = 0;
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
    this.transientEnvelope = 0;
    this.transientPhase = 0;
    this.fricationEnvelope = 0;
    this.fricationTarget = 0;
    this.storedPressure = 0;
    this.gestureIndex = 0;
    this.gestureMotion = 0;
    this.gestureCoordinate = 0;
    this.gestureReady = false;
    this.formantsHz = [0, 0, 0, 0];
    this.brightness = 1;
    this.noiseAmount = 1;
  }

  process(input, pressure, mediumId, noise, interference = 0) {
    this.opening += (this.targetOpening - this.opening) * this.openingAlpha;
    this.flowActivity += (
      this.targetFlowActivity - this.flowActivity
    ) * (this.targetFlowActivity > this.flowActivity ? 0.006 : 0.0024);
    this.networkActivity += (
      this.targetNetworkActivity - this.networkActivity
    ) * (this.targetNetworkActivity > this.networkActivity ? 0.012 : 0.0038);
    this.noiseMemory += (noise - this.noiseMemory) * 0.035;
    const turbulence = (noise - this.noiseMemory) * this.noiseAmount;
    this.fricationEnvelope += (
      this.fricationTarget - this.fricationEnvelope
    ) * (this.fricationTarget > this.fricationEnvelope ? 0.006 : 0.0016);

    const delayed = this.tractDelay[this.tractDelayIndex];
    const acousticGate = clamp(
      this.networkActivity * (this.flowActivity * 1.18 + Math.abs(input) * 0.82)
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
        pressure * this.opening * this.flowActivity * this.networkActivity * 0.92
          + this.fricationEnvelope * this.flowActivity * this.networkActivity * 0.38,
      );
      this.jetAmplitude += (jetTarget - this.jetAmplitude) * 0.0018;
      this.jetPhase += TWO_PI * this.jetFrequencyHz / this.rate;
      if (this.jetPhase >= TWO_PI) this.jetPhase %= TWO_PI;
      this.jetOvertonePhase += TWO_PI * this.jetFrequencyHz * 2.03 / this.rate;
      if (this.jetOvertonePhase >= TWO_PI) this.jetOvertonePhase %= TWO_PI;
      const jet = (
        Math.sin(this.jetPhase)
        + Math.sin(this.jetOvertonePhase + this.gestureMotion * 0.21)
          * 0.2 * (0.12 + this.brightness * 0.68)
      ) * this.jetAmplitude;
      excitation = Math.tanh((edge * 8.2 + excitation * 0.68) * 3.4)
        + jet * 0.48;
    }

    this.ratchetPhase += TWO_PI * (430 + this.gestureMotion * 91) / this.rate;
    if (this.ratchetPhase >= TWO_PI) this.ratchetPhase %= TWO_PI;
    const ratchet = this.index === 2
      ? (Math.sin(this.ratchetPhase) > 0.22 ? 1 : -0.18)
      : 1;
    const burst = this.burstEnvelope * ratchet * (0.58 + turbulence * 0.42);
    this.burstEnvelope *= MOUTH_BURST_DECAY[this.index];
    const frication = turbulence
      * this.fricationEnvelope
      * this.flowActivity
      * this.networkActivity
      * MOUTH_FRICATION_GAIN[this.index]
      * (0.12 + this.brightness * 0.88);
    this.transientPhase += TWO_PI * this.transientFrequencyHz / this.rate;
    if (this.transientPhase >= TWO_PI) this.transientPhase %= TWO_PI;
    const transient = this.transientEnvelope * (
      Math.sin(this.transientPhase) * this.transientToneMix
        + (noise - this.noiseMemory) * this.transientNoiseMix
          * (0.28 + this.brightness * 0.72)
    );
    this.transientEnvelope *= this.transientDecay;
    excitation += frication + burst * MOUTH_BURST_GAIN[this.index] + transient * 0.68;

    const throatBand = this.throat.process(excitation);
    const cavityBand = this.cavity.process(excitation + throatBand * 0.24);
    const tongueBand = this.tongue.process(excitation - cavityBand * 0.18);
    const teethBand = this.teeth.process(
      frication
        + edge * MOUTH_EDGE_GAIN[this.index] * (0.12 + this.brightness * 0.88)
        + tongueBand * 0.12,
    );
    let radiation;
    if (this.index === 0) {
      radiation = excitation * this.directGain
        + throatBand * 1.34
        + cavityBand * 0.92
        - tongueBand * 0.42
        + teethBand * 0.18 * (0.3 + this.brightness * 0.7);
      radiation = Math.tanh(radiation * 1.7) + Math.tanh(radiation * 6.4) * 0.16;
    } else if (this.index === 1) {
      radiation = excitation * this.directGain
        + throatBand * 0.54
        - cavityBand * 1.08
        + tongueBand * 0.94
        + teethBand * 0.62 * (0.2 + this.brightness * 0.8);
      radiation = Math.tanh(radiation * 1.5 + Math.sin(radiation * 4.8) * 0.32);
    } else {
      radiation = excitation * this.directGain
        + throatBand * 0.22
        + cavityBand * 0.46
        + tongueBand * 0.86
        + teethBand * 0.92 * (0.1 + this.brightness * 0.72)
        + burst * 0.44;
      radiation = Math.tanh(radiation * 2.15);
    }
    if (Math.abs(transient) > SILENCE_FLOOR) {
      radiation = Math.tanh(radiation + transient * this.transientDirectMix);
    }
    const radiationGate = mediumId === "pellets"
      ? 0.002 + Math.sqrt(acousticGate) * 0.998
      : 0.002 + acousticGate * 0.998;
    radiation *= radiationGate * this.radiationTrim;

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
    this.flowArticulation = sanitizeCallArticulation(
      this.configuration.articulation,
      LEGACY_CALL_ARTICULATION,
    );
    this.configuredBreath = this.configuration.breath;
    this.breathActive = processorOptions.breathActive === true;
    this.breathValue = this.breathActive ? this.configuredBreath : 0;
    const initialPlaying = processorOptions.playing ?? initial.playing;
    this.transportPlaying = initialPlaying == null
      ? this.configuration.sequencerEnabled
      : Boolean(initialPlaying);
    this.callActive = false;
    this.callOutputMuted = false;
    this.callDurationSamples = 0;
    this.callRenderedSamples = 0;
    this.callAttackSamples = 0;
    this.callReleaseSamples = 0;
    this.callPrechargeSamples = 0;
    this.callArticulation = LEGACY_CALL_ARTICULATION;
    this.callArticulationPending = false;
    this.callEndedPosted = false;
    this.callId = null;
    this.callToken = null;
    this.runtime = createColonySyrinxRuntime();
    this.activeSeed = (
      Number(processorOptions.seed ?? initial.seed ?? this.configuration.seed) || 0x436f6c6f
    ) >>> 0;

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
    this.sourceEngines = VOCAL_SOURCE_PROFILES.map((profile, index) => (
      new SyrinxSourceEngine({
        sampleRate: this.sourceRate,
        model: profile.model,
        seed: this.activeSeed + index * 0x9e37,
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
    this.previousRouteTargets = new Float64Array(COLONY_SYRINX_ROUTE_COUNT);
    this.routeShockEnvelopes = new Float64Array(COLONY_SYRINX_ROUTE_COUNT);
    this.routeDelayIndices = new Int32Array(COLONY_SYRINX_ROUTE_COUNT);
    this.routeDelayBuffers = ROUTE_DELAY_MILLISECONDS.map((milliseconds) => (
      new Float64Array(Math.max(2, Math.round(this.rate * milliseconds * 0.001)))
    ));
    this.evolutionCycles = 0;
    this.contourPhase = 0;
    this.bankExhaleLevels = new Float64Array(COLONY_SYRINX_BANK_COUNT);
    this.bankFeedbackPressures = new Float64Array(COLONY_SYRINX_BANK_COUNT);
    this.bankFeedbackWeights = new Float64Array(COLONY_SYRINX_BANK_COUNT);
    this.phonatorSources = new Float64Array(COLONY_SYRINX_PHONATOR_COUNT);
    this.mouthDrives = new Float64Array(COLONY_SYRINX_MOUTH_COUNT);
    this.mouthDriveWeights = new Float64Array(COLONY_SYRINX_MOUTH_COUNT);
    this.mouthConnectionApertures = new Float64Array(COLONY_SYRINX_MOUTH_COUNT);
    this.mouthLoads = new Float64Array(COLONY_SYRINX_MOUTH_COUNT);
    this.mouthBurstPeaks = new Float64Array(COLONY_SYRINX_MOUTH_COUNT);
    this.mouths = Array.from(
      { length: COLONY_SYRINX_MOUTH_COUNT },
      (_, index) => new MouthLoad(this.rate, index),
    );
    this.pelletCavityResonators = Array.from(
      { length: COLONY_SYRINX_MOUTH_COUNT },
      () => new StableResonator(this.rate),
    );
    this.pelletRicochetCountdowns = new Int32Array(COLONY_SYRINX_MOUTH_COUNT);
    this.pelletRicochetLevels = new Float64Array(COLONY_SYRINX_MOUTH_COUNT);
    this.pelletCountdown = 0;
    this.pelletPreviousStrike = 0;
    this.pelletImpactCount = 0;
    this.pelletRicochetCount = 0;
    this._configureMouths();
    this._configureVocalSources();
    for (let index = 0; index < this.sourceEngines.length; index += 1) {
      this.sourceEngines[index].reset(this.activeSeed + index * 0x9e37);
    }

    this.noiseState = this.activeSeed;
    this.mediumLowpass = 0;
    this.impactEnvelope = 0;
    this.pushPullPrevious = 0;
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
    this.defaultOutputLowpassAlpha = 1
      - Math.exp(-TWO_PI * Math.min(8_200, this.rate * 0.36) / this.rate);
    this.outputLowpassAlpha = this.defaultOutputLowpassAlpha;
    this.outputLowpassCutoffHz = Math.min(8_200, this.rate * 0.36);
    this._setCallBrightness(this.flowArticulation.brightness);
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
      const pelletResonator = this.pelletCavityResonators?.[index];
      if (pelletResonator) {
        const mouth = this.configuration.mouths[index];
        const minimumFrequency = [540, 1_080, 2_050][index] ?? 1_080;
        pelletResonator.configure(
          Math.max(minimumFrequency, mouth.resonanceHz * [3.8, 2.9, 1.72][index]),
          [10.5, 13.5, 16][index],
        );
      }
    }
  }

  _resetPelletExciter() {
    this.pelletCountdown = 0;
    this.pelletPreviousStrike = 0;
    this.pelletImpactCount = 0;
    this.pelletRicochetCount = 0;
    this.pelletRicochetCountdowns?.fill(0);
    this.pelletRicochetLevels?.fill(0);
    for (const resonator of this.pelletCavityResonators ?? []) resonator.reset();
  }

  _configureVocalSources() {
    const callSpectral = this.callActive ? this.callArticulation : this.flowArticulation;
    const noiseAmount = callSpectral.noise;
    for (let bank = 0; bank < COLONY_SYRINX_PHONATOR_COUNT; bank += 1) {
      const profile = VOCAL_SOURCE_PROFILES[bank];
      const phonator = this.configuration.phonators[bank];
      const firstFold = bank * 2;
      const secondFold = firstFold + 1;
      const firstFoldEnabled = foldEnabled(this.configuration, firstFold);
      const secondFoldEnabled = foldEnabled(this.configuration, secondFold);
      const enabledFoldCount = Number(firstFoldEnabled) + Number(secondFoldEnabled);
      const enabled = enabledFoldCount > 0;
      const runtimeFrequency = enabledFoldCount > 0
        ? (
          (firstFoldEnabled ? this.runtime.foldFrequenciesHz[firstFold] : 0)
          + (secondFoldEnabled ? this.runtime.foldFrequenciesHz[secondFold] : 0)
        ) / enabledFoldCount
        : 0;
      const baseFrequency = runtimeFrequency > 1
        ? runtimeFrequency
        : phonator.frequencyHz;
      const contourValues = this.runtime.contourValues ?? this.runtime.laneVelocities ?? [];
      const tensionContour = clamp(contourValues[1], 0, 1, 0.5);
      const routeOffset = bank * COLONY_SYRINX_MOUTH_COUNT;
      const connectedAperture = Math.max(
        this.runtime.routeApertures[routeOffset],
        this.runtime.routeApertures[routeOffset + 1],
        this.runtime.routeApertures[routeOffset + 2],
      );
      const connectionGate = smoothstep(0.004, 0.08, connectedAperture);
      const connectedFlow = this.runtime.routeFlows
        .slice(routeOffset, routeOffset + COLONY_SYRINX_MOUTH_COUNT)
        .reduce((sum, flow) => sum + flow, 0);
      const pressureVoicing = smoothstep(
        0.015,
        0.42,
        this.runtime.reservoirPressures[bank],
      );
      const networkVoicing = clamp(
        Math.max(this.runtime.phonatorLevels[bank], pressureVoicing * 0.72)
          * (0.38 + smoothstep(0.001, 0.16, connectedFlow) * 0.62),
      );
      const flutterDepth = [0.2, 0.28, 0.42, 0.17][bank];
      const motionPhase = clamp(
        this.runtime.lanePhases?.[1] ?? this.runtime.contourPhase ?? this.contourPhase,
      );
      const flutterPhase = motionPhase * TWO_PI * [1, 2, 3, 5][bank] + bank * 0.73;
      const flutter = 1 - flutterDepth * 0.5 + Math.sin(flutterPhase) * flutterDepth * 0.5;
      const bankMotion = clamp(this.bankExhaleLevels[bank], 0, 1, 0.72);
      const pushPullWave = this.callActive ? this._callPushPullWave(bank) : 0;
      const respiratoryDrive = clamp(
        1 - pushPullWave * callSpectral.pushPull * 0.34,
        0.35,
        1.45,
        1,
      );
      const pressure = clamp(
        (enabled ? 1 : 0)
          * connectionGate
          * Math.sqrt(networkVoicing)
          * (0.62 + this.configuredBreath * 0.38)
          * (0.58 + bankMotion * 0.42)
          * flutter
          * respiratoryDrive,
      );
      const frequencyHz = clamp(
        baseFrequency * profile.frequencyScale,
        profile.model === "syrinx" ? 40 : profile.model === "frog" ? 30 : 5,
        Math.min(
          VOCAL_SOURCE_CEILINGS_HZ[bank] ?? 1_900,
          this.sourceRate * 0.2,
        ),
        120,
      );
      this.sourceFrequenciesHz[bank] = enabled ? frequencyHz : 0;
      const sourceBalance = firstFoldEnabled && secondFoldEnabled
        ? clamp(profile.asymmetry * 0.44, -1, 1, 0)
        : firstFoldEnabled ? -1 : secondFoldEnabled ? 1 : 0;
      this.sourceEngines[bank].setParameters({
        model: profile.model,
        frequencyHz,
        pressure,
        tension: clamp(
          phonator.tension + profile.tensionBias + (tensionContour - 0.5) * 0.22,
        ),
        adduction: clamp(profile.adduction + phonator.closure * 0.12),
        sourceScale: profile.sourceScale,
        breath: clamp(
          (profile.breath + phonator.roughness * 0.22) * (0.025 + noiseAmount * 0.975),
        ),
        roughness: clamp(
          profile.roughness * noiseAmount
            + phonator.roughness * (0.05 + noiseAmount * 0.23)
            + this.configuration.colonyAmount * 0.08 * noiseAmount,
        ),
        asymmetry: clamp(
          profile.asymmetry + phonator.asymmetry * 0.36,
          -1,
          1,
          0,
        ),
        pulseRateHz: this.callActive && callSpectral.pulseRateHz > 0
          ? callSpectral.pulseRateHz * (0.92 + bank * 0.045)
          : profile.pulseRateHz * (0.84 + tensionContour * 0.32) + bank * 2.5,
        coupling: profile.coupling,
        sourceBalance,
        feedback: clamp(profile.feedback + this.configuration.crossCoupling * 0.18),
        outputGain: profile.outputGain,
      });
      if (pressure > 0.0005) {
        this.sourceSleeping[bank] = 0;
        this.sourceIdleSamples[bank] = 0;
      }
    }
  }

  _setCallBrightness(brightness = 1) {
    const amount = clamp(brightness, 0, 1, 1);
    const maximum = Math.min(8_200, this.rate * 0.36);
    const minimum = Math.min(1_250, maximum);
    const cutoff = minimum * (maximum / Math.max(1, minimum)) ** amount;
    this.outputLowpassCutoffHz = cutoff;
    this.outputLowpassAlpha = 1 - Math.exp(-TWO_PI * cutoff / this.rate);
  }

  _callIsPrecharging() {
    return this.callActive
      && this.callPrechargeSamples > 0
      && this.callRenderedSamples < this.callPrechargeSamples;
  }

  _callElapsedSeconds() {
    if (!this.callActive) return 0;
    return Math.max(0, this.callRenderedSamples - this.callPrechargeSamples) / this.rate;
  }

  _callPulsePhase(bank = 0) {
    const rate = this.callArticulation.pulseRateHz;
    if (!this.callActive || rate <= 0) return 0;
    const offset = [0, 0.17, 0.41, 0.68][bank] ?? 0;
    return (this._callElapsedSeconds() * rate + offset) % 1;
  }

  _callPushPullWave(bank = 0) {
    if (!this.callActive || this.callArticulation.pushPull <= 1e-6) return 0;
    const rate = this.callArticulation.pulseRateHz > 0
      ? this.callArticulation.pulseRateHz
      : (this.callArticulation.mode === "throb" ? 2.4 : 1.2);
    const offset = [0, 0.11, 0.29, 0.53][bank] ?? 0;
    return Math.cos(TWO_PI * (this._callElapsedSeconds() * rate + offset));
  }

  _callBankExhaleGates() {
    if (!this.callActive || this.callArticulation.pulseDepth <= 1e-6) return null;
    const depth = this.callArticulation.pulseDepth;
    const pulseMode = this.callArticulation.mode === "pulse"
      || ["plosive", "lip-pop", "tongue-click", "impact"].includes(
        this.callArticulation.mode,
      );
    return Array.from({ length: COLONY_SYRINX_BANK_COUNT }, (_, bank) => {
      const phase = this._callPulsePhase(bank);
      const cyclic = 0.5 + Math.cos(phase * TWO_PI) * 0.5;
      const motion = pulseMode ? cyclic ** 3.2 : cyclic;
      return clamp(1 - depth + motion * depth);
    });
  }

  _reseed(seed) {
    this.activeSeed = (Number(seed) || 0x436f6c6f) >>> 0;
    this.noiseState = this.activeSeed;
    for (let index = 0; index < this.sourceEngines.length; index += 1) {
      this.sourceEngines[index].reset(this.activeSeed + index * 0x9e37);
    }
    this.sourceLowpassOne.fill(0);
    this.sourceLowpassTwo.fill(0);
    this.sourceIdleSamples.fill(0);
    this.sourceSleeping.fill(1);
    this.sourceStepPhase = 0;
    this.mediumLowpass = 0;
    this.impactEnvelope = 0;
    this._resetPelletExciter();
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      const patch = message.configuration ?? message.state ?? message.patch ?? {};
      const previousBreath = this.configuration.breath;
      const previousSeed = this.configuration.seed;
      this.configuration = sanitizeColonySyrinxState(patch, this.configuration);
      this.flowArticulation = sanitizeCallArticulation(
        this.configuration.articulation,
        this.flowArticulation,
      );
      if (this.configuration.breath !== previousBreath || this.configuredBreath === previousBreath) {
        this.configuredBreath = this.configuration.breath;
      }
      this._configureMouths();
      this._configureVocalSources();
      if (!this.callActive) this._setCallBrightness(this.flowArticulation.brightness);
      if (this.configuration.seed !== previousSeed) this._reseed(this.configuration.seed);
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
      if (this.breathActive && !this.callActive) this.callOutputMuted = false;
      if (!this.callActive) this._setCallBrightness(this.flowArticulation.brightness);
      this.controlCountdown = 0;
      return;
    }
    if (message.type === "call") {
      if (!Boolean(message.playing ?? message.running)) {
        this._cancelCall();
        this.transportPlaying = false;
        this.controlCountdown = 0;
        return;
      }
      const fallbackDuration = clamp(
        this.configuration.contourDurationSeconds,
        CALL_MINIMUM_SECONDS,
        CALL_MAXIMUM_SECONDS,
        8,
      );
      const durationSeconds = clamp(
        message.durationSeconds ?? message.duration,
        CALL_MINIMUM_SECONDS,
        CALL_MAXIMUM_SECONDS,
        fallbackDuration,
      );
      const configuredArticulation = this.configuration.articulation
        ? sanitizeCallArticulation(this.configuration.articulation)
        : LEGACY_CALL_ARTICULATION;
      const articulation = message.articulation && typeof message.articulation === "object"
        ? sanitizeCallArticulation(message.articulation, configuredArticulation)
        : configuredArticulation;
      const reset = message.reset !== false;
      if (reset) this._panic();
      else this._cancelCall();
      this.callDurationSamples = Math.max(1, Math.round(durationSeconds * this.rate));
      this.callRenderedSamples = 0;
      this.callArticulation = articulation;
      this.callPrechargeSamples = Math.max(0, Math.min(
        Math.round(articulation.prechargeMs * 0.001 * this.rate),
        Math.floor(this.callDurationSamples * 0.45),
        this.callDurationSamples - 1,
      ));
      const audibleSamples = Math.max(1, this.callDurationSamples - this.callPrechargeSamples);
      this.callAttackSamples = Math.max(0, Math.min(
        Math.round(articulation.attackMs * 0.001 * this.rate),
        Math.floor(audibleSamples * 0.2),
      ));
      this.callReleaseSamples = Math.max(1, Math.min(
        Math.max(1, Math.round(articulation.releaseMs * 0.001 * this.rate)),
        Math.max(1, Math.floor(audibleSamples * 0.35)),
      ));
      this.callArticulationPending = articulation.strike > 1e-6 || articulation.burst > 1e-6;
      this.callActive = true;
      this.callOutputMuted = false;
      this.callEndedPosted = false;
      this.callId = typeof message.callId === "string" ? message.callId : null;
      this.callToken = typeof message.callToken === "string" || Number.isFinite(message.callToken)
        ? message.callToken
        : null;
      this.transportPlaying = true;
      if (reset) this._resetClock();
      this._prechargeCall();
      this.pushPullPrevious = this._callPushPullWave(0);
      this._setCallBrightness(articulation.brightness);
      this.controlCountdown = 0;
      return;
    }
    if (message.type === "transport") {
      this._cancelCall();
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

  _cancelCall() {
    this.callActive = false;
    this.callOutputMuted = false;
    this.callDurationSamples = 0;
    this.callRenderedSamples = 0;
    this.callAttackSamples = 0;
    this.callReleaseSamples = 0;
    this.callPrechargeSamples = 0;
    this.callArticulation = LEGACY_CALL_ARTICULATION;
    this.callArticulationPending = false;
    this.callEndedPosted = false;
    this.callId = null;
    this.callToken = null;
    this.pushPullPrevious = 0;
    if (Number.isFinite(this.defaultOutputLowpassAlpha)) {
      this._setCallBrightness(this.flowArticulation?.brightness ?? 1);
    }
  }

  _prechargeCall() {
    const mediumScale = this.configuration.mediumId === "pellets"
      ? 0.72
      : this.configuration.mediumId === "water" ? 0.56 : 0.38;
    const charge = clamp(
      this.configuredBreath * this.configuration.pressureGain * mediumScale,
      0,
      COLONY_SYRINX_MAX_PRESSURE,
    );
    const lungPressures = Array.from(
      { length: this.runtime.lungPressures.length },
      (_, index) => this.configuration.lungEnabled[index]
        ? charge * (0.82 + (index % 4) * 0.045)
        : 0,
    );
    const reservoirPressures = Array.from(
      { length: COLONY_SYRINX_BANK_COUNT },
      (_, bank) => this.configuration.lungEnabled
        .slice(bank * 4, bank * 4 + 4)
        .some(Boolean)
        ? charge * (0.7 + this.configuration.banks[bank].drive * 0.12)
        : 0,
    );
    const routeApertures = COLONY_SYRINX_TOPOLOGY.routes.map(({ phonatorIndex, mouthIndex }) => (
      this.configuration.phonatorEnabled?.[phonatorIndex] !== false
        && this.configuration.mouthEnabled?.[mouthIndex] !== false
        ? clamp(this.configuration.routes?.[phonatorIndex]?.[mouthIndex])
        : 0
    ));
    const tonalOpening = ["tone", "pulse", "throb", "mouth-call", "sustained"].includes(
      this.callArticulation.mode,
    );
    const mouthApertures = Array.from(
      { length: COLONY_SYRINX_MOUTH_COUNT },
      (_, index) => this.configuration.mouthEnabled?.[index] === false
        || this.callPrechargeSamples > 0
        ? 0
        : clamp(this.configuration.mouths[index].opening * (tonalOpening ? 0.72 : 0.28)),
    );
    const phonatorLevels = Array.from(
      { length: COLONY_SYRINX_PHONATOR_COUNT },
      (_, index) => {
        const firstFold = index * 2;
        const enabledFolds = Number(foldEnabled(this.configuration, firstFold))
          + Number(foldEnabled(this.configuration, firstFold + 1));
        return enabledFolds > 0 ? 0.58 * Math.sqrt(enabledFolds * 0.5) : 0;
      },
    );
    const phonatorFrequenciesHz = this.configuration.phonators.map((phonator, index) => (
      this.configuration.phonatorEnabled?.[index] === false ? 0 : phonator.frequencyHz
    ));
    const foldFrequenciesHz = Array.from(
      { length: COLONY_SYRINX_FOLD_COUNT },
      (_, index) => foldEnabled(this.configuration, index)
        ? this.configuration.phonators[Math.floor(index / 2)].frequencyHz
        : 0,
    );
    const foldActivities = Array.from(
      { length: COLONY_SYRINX_FOLD_COUNT },
      (_, index) => foldEnabled(this.configuration, index)
        ? phonatorLevels[Math.floor(index / 2)]
        : 0,
    );
    this.runtime = createColonySyrinxRuntime({
      ...this.runtime,
      lungPressures,
      reservoirPressures,
      routeTargets: routeApertures,
      routeApertures,
      mouthApertures,
      phonatorLevels,
      phonatorFrequenciesHz,
      foldFrequenciesHz,
      foldActivities,
    });
    const articulationEnergy = Math.max(
      this.callArticulation.strike,
      this.callArticulation.burst,
    );
    if (articulationEnergy > 1e-6) {
      for (let mouthIndex = 0; mouthIndex < COLONY_SYRINX_MOUTH_COUNT; mouthIndex += 1) {
        if (this.configuration.mouthEnabled?.[mouthIndex] === false) continue;
        let weightedPressure = 0;
        let routeWeight = 0;
        for (let bank = 0; bank < COLONY_SYRINX_BANK_COUNT; bank += 1) {
          if (this.configuration.phonatorEnabled?.[bank] === false) continue;
          const aperture = Math.max(
            this.configuration.routes?.[bank]?.[mouthIndex] ?? 0,
            this.configuration.alternateRoutes?.[bank]?.[mouthIndex] ?? 0,
          );
          weightedPressure += reservoirPressures[bank] * aperture;
          routeWeight += aperture;
        }
        const connectedPressure = routeWeight > 1e-6
          ? weightedPressure / routeWeight
          : charge;
        const preload = clamp(
          connectedPressure * (0.72 + articulationEnergy * 0.58),
          0,
          COLONY_SYRINX_MAX_PRESSURE,
        );
        this.mouths[mouthIndex].storedPressure = Math.max(
          this.mouths[mouthIndex].storedPressure,
          preload,
        );
        if (this.callPrechargeSamples > 0) {
          this.mouths[mouthIndex].opening = 0;
          this.mouths[mouthIndex].targetOpening = 0;
        }
      }
    }
    this._configureVocalSources();
    this._warmCallSources();
    this.breathValue = this.configuredBreath;
  }

  _warmCallSources() {
    if (!this.callActive || !this.configuration.foldEnabled.some(Boolean)) return;
    const secondsByMode = {
      tone: 0.06,
      pulse: 0.028,
      throb: 0.04,
      "mouth-call": 0.026,
      sustained: 0.024,
    };
    const seconds = secondsByMode[this.callArticulation.mode] ?? 0;
    if (seconds <= 0) return;
    const frames = Math.min(Math.round(seconds * this.rate), Math.round(this.rate * 0.06));
    const sourceSteps = Math.max(1, Math.round(this.sourceStepsPerOutput));
    // A two-mass source can need a substantial fraction of a short call to
    // grow from rest into its limit cycle. Prime tonal sources behind the
    // muted/precharged outlet at a healthy pressure, then restore the live
    // network target. This removes the false 100–200 ms "attack" without
    // adding a click, burst, or synthetic attack oscillator.
    if (this.callArticulation.mode === "tone") {
      for (let index = 0; index < this.sourceEngines.length; index += 1) {
        if (this.configuration.phonatorEnabled?.[index] === false) continue;
        this.sourceEngines[index].setParameters({
          pressure: Math.max(0.7, this.sourceEngines[index].target.pressure),
        });
      }
    }
    for (let frame = 0; frame < frames; frame += 1) {
      const noise = this._random();
      for (let phonator = 0; phonator < COLONY_SYRINX_PHONATOR_COUNT; phonator += 1) {
        this.phonatorSources[phonator] = this._renderPhonator(
          phonator,
          phonator % 2 === 0 ? noise : -noise,
          sourceSteps,
        );
      }
    }
    this._configureVocalSources();
  }

  _callEnvelope() {
    if (this.callOutputMuted) return 0;
    if (!this.callActive || this.callDurationSamples <= 0) return 1;
    const sampleIndex = Math.min(
      this.callRenderedSamples,
      this.callDurationSamples - 1,
    );
    if (sampleIndex < this.callPrechargeSamples) return 0;
    const audibleIndex = sampleIndex - this.callPrechargeSamples;
    const attackProgress = this.callAttackSamples <= 0
      ? 1
      : this.callAttackSamples === 1
        ? (audibleIndex > 0 ? 1 : 0)
        : clamp(audibleIndex / (this.callAttackSamples - 1));
    const samplesAfter = this.callDurationSamples - 1 - sampleIndex;
    const releaseProgress = this.callReleaseSamples <= 1
      ? (samplesAfter > 0 ? 1 : 0)
      : clamp(samplesAfter / (this.callReleaseSamples - 1));
    return smoothstep(0, 1, attackProgress) * smoothstep(0, 1, releaseProgress);
  }

  _finishCall() {
    if (!this.callActive) return;
    const callId = this.callId;
    const callToken = this.callToken;
    this.callRenderedSamples = this.callDurationSamples;
    this.callActive = false;
    this.callOutputMuted = true;
    this.transportPlaying = false;
    this.pushPullPrevious = 0;
    this._setCallBrightness(this.flowArticulation.brightness);
    this.controlCountdown = 0;
    if (this.callEndedPosted) return;
    this.callEndedPosted = true;
    this.port.postMessage({
      type: "call-ended",
      durationSeconds: this.callDurationSamples / this.rate,
      renderedSamples: this.callRenderedSamples,
      callId,
      callToken,
    });
    this.callId = null;
    this.callToken = null;
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
        { length: COLONY_SYRINX_LEGACY_LANE_COUNT },
        (_, index) => wrap(
          suppliedLanes?.[index],
          this.configuration.lanes?.[index]?.length ?? COLONY_SYRINX_SEQUENCE_LENGTH,
        ),
      ),
      laneStepElapsedSeconds: Array(COLONY_SYRINX_LEGACY_LANE_COUNT).fill(0),
    });
  }

  _resetClock() {
    this._setClockStep(0, Array(COLONY_SYRINX_LEGACY_LANE_COUNT).fill(0));
    this.runtime = createColonySyrinxRuntime({
      ...this.runtime,
      timeSeconds: 0,
      contourPhase: 0,
      continuousBreath: 0,
      tensionOffset: 0,
      lanePhases: Array(COLONY_SYRINX_LANE_COUNT).fill(0),
      laneVelocities: Array(COLONY_SYRINX_LANE_COUNT).fill(0),
      contourValues: Array(COLONY_SYRINX_LANE_COUNT).fill(0),
    });
    this.evolutionCycles = 0;
    this.contourPhase = 0;
    this.bankExhaleLevels.fill(0);
  }

  _panic() {
    this._cancelCall();
    this.breathActive = false;
    this.transportPlaying = false;
    this.breathValue = 0;
    this.runtime = createColonySyrinxRuntime();
    this.foldLevels.fill(0);
    this.foldDisplacements.fill(0);
    this.foldVelocities.fill(0);
    this.routeLevels.fill(0);
    this.previousRouteTargets.fill(0);
    this.routeShockEnvelopes.fill(0);
    this.routeDelayIndices.fill(0);
    for (const buffer of this.routeDelayBuffers) buffer.fill(0);
    this.evolutionCycles = 0;
    this.contourPhase = 0;
    this.bankExhaleLevels.fill(0);
    this.bankFeedbackPressures.fill(0);
    this.bankFeedbackWeights.fill(0);
    this.phonatorSources.fill(0);
    this.mouthDrives.fill(0);
    this.mouthDriveWeights.fill(0);
    this.mouthConnectionApertures.fill(0);
    this.mouthLoads.fill(0);
    this.mouthBurstPeaks.fill(0);
    for (const mouth of this.mouths) mouth.reset();
    this.noiseState = this.activeSeed;
    for (let index = 0; index < this.sourceEngines.length; index += 1) {
      this.sourceEngines[index].reset(this.activeSeed + index * 0x9e37);
    }
    this.sourceFrequenciesHz.fill(0);
    this.sourceLowpassOne.fill(0);
    this.sourceLowpassTwo.fill(0);
    this.sourceIdleSamples.fill(0);
    this.sourceSleeping.fill(1);
    this.sourceStepPhase = 0;
    this.mediumLowpass = 0;
    this.impactEnvelope = 0;
    this._resetPelletExciter();
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

  _mouthConnectionAperture(mouthIndex) {
    if (this.configuration.mouthEnabled?.[mouthIndex] === false) return 0;
    let aperture = 0;
    for (let phonatorIndex = 0; phonatorIndex < COLONY_SYRINX_PHONATOR_COUNT; phonatorIndex += 1) {
      if (this.configuration.phonatorEnabled?.[phonatorIndex] === false) continue;
      const routeIndex = phonatorIndex * COLONY_SYRINX_MOUTH_COUNT + mouthIndex;
      aperture = Math.max(aperture, this.runtime.routeApertures[routeIndex]);
    }
    return clamp(aperture);
  }

  _feedbackRuntime() {
    let hasLoad = false;
    let changed = false;
    const pressures = new Array(COLONY_SYRINX_MOUTH_COUNT);
    for (let index = 0; index < COLONY_SYRINX_MOUTH_COUNT; index += 1) {
      const connectionAperture = this._mouthConnectionAperture(index);
      if (connectionAperture <= 1e-6) {
        pressures[index] = 0;
        changed ||= this.runtime.mouthPressures[index] > 1e-9;
        continue;
      }
      const connectionGate = smoothstep(0.0001, 0.02, connectionAperture);
      const reflected = clamp(
        this.mouths[index].reflectedLoad * connectionGate,
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
      hasLoad ||= reflected > 1e-7;
      pressures[index] = clamp(
        Math.max(
          this.runtime.mouthPressures[index],
          reflected * (0.2 + this.configuration.crossCoupling * 0.45),
        ),
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
      changed ||= Math.abs(pressures[index] - this.runtime.mouthPressures[index]) > 1e-9;
    }
    return hasLoad || changed ? { ...this.runtime, mouthPressures: pressures } : this.runtime;
  }

  _updateContinuousBreathMotion(seconds) {
    if (!this.transportPlaying) {
      for (let bank = 0; bank < COLONY_SYRINX_BANK_COUNT; bank += 1) {
        this.bankExhaleLevels[bank] = this.breathActive
          && this.configuration.phonatorEnabled?.[bank] !== false ? 1 : 0;
      }
      return;
    }
    const duration = clamp(this.configuration.contourDurationSeconds, 1, 120, 8);
    const runtimePhase = Number(this.runtime.contourPhase);
    this.contourPhase = Number.isFinite(runtimePhase)
      ? ((runtimePhase % 1) + 1) % 1
      : (this.contourPhase + seconds / duration) % 1;
    if (this.breathActive) {
      for (let bank = 0; bank < COLONY_SYRINX_BANK_COUNT; bank += 1) {
        this.bankExhaleLevels[bank] = this.configuration.phonatorEnabled?.[bank] !== false ? 1 : 0;
      }
      return;
    }
    const breathValue = clamp(
      this.runtime.contourValues?.[0] ?? this.runtime.laneVelocities?.[0],
      0,
      1,
      0.72,
    );
    const offsets = [0, 0.19, 0.43, 0.68];
    for (let bankIndex = 0; bankIndex < COLONY_SYRINX_BANK_COUNT; bankIndex += 1) {
      if (this.configuration.phonatorEnabled?.[bankIndex] === false) {
        this.bankExhaleLevels[bankIndex] = 0;
        continue;
      }
      const phase = (this.contourPhase + offsets[bankIndex]) % 1;
      const broad = 0.5 + Math.sin(phase * TWO_PI) * 0.5;
      const detail = 0.5 + Math.sin(
        phase * TWO_PI * (bankIndex % 2 === 0 ? 2 : 3) + bankIndex * 0.61,
      ) * 0.5;
      this.bankExhaleLevels[bankIndex] = clamp(
        (0.34 + breathValue * 0.5) * (0.7 + broad * 0.2 + detail * 0.1),
        0.16,
        1,
      );
    }
  }

  _advancePressureNetwork(sampleCount) {
    const seconds = clamp(sampleCount / this.rate, 0, 0.25, 0);
    const precharging = this._callIsPrecharging();
    const articulationGates = this._callBankExhaleGates();
    const breathTarget = this.breathActive || this.transportPlaying ? this.configuredBreath : 0;
    this.breathValue += (
      breathTarget - this.breathValue
    ) * smoothingAlpha(breathTarget > 0 ? 9 : 5.5, seconds);
    this.configuration.breath = clamp(this.breathValue);

    if (this.transportPlaying) {
      if (this.callActive && this.callDurationSamples > 0) {
        this.evolutionCycles = this.callDurationSamples <= 1
          ? 1
          : clamp(this.callRenderedSamples / (this.callDurationSamples - 1));
      } else {
        const duration = clamp(this.configuration.contourDurationSeconds, 1, 120, 8);
        this.evolutionCycles += seconds / duration;
      }
    }
    const options = { phase: this.evolutionCycles };
    if (precharging) {
      options.mouthGates = Array(COLONY_SYRINX_MOUTH_COUNT).fill(0);
    }
    if (articulationGates) options.bankExhaleGates = articulationGates;
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
    this._updateContinuousBreathMotion(seconds);
    if (articulationGates) this.bankExhaleLevels.set(articulationGates);
    this.impactEnvelope = Math.max(this.impactEnvelope, this.runtime.impact);
    this._configureVocalSources();

    const releaseArticulation = this.callArticulationPending && !precharging;
    for (let index = 0; index < COLONY_SYRINX_MOUTH_COUNT; index += 1) {
      const enabled = this.configuration.mouthEnabled?.[index] !== false;
      const pressureActivity = smoothstep(0.012, 0.32, this.runtime.mouthPressures[index]);
      const flowActivity = smoothstep(0.001, 0.16, this.runtime.mouthFlows[index]);
      const networkActivity = enabled
        ? clamp(pressureActivity * 0.34 + flowActivity * 0.86)
        : 0;
      const contourIndex = 3 + index;
      const contourValue = this.runtime.contourValues?.[contourIndex]
        ?? this.runtime.laneVelocities?.[contourIndex]
        ?? 0;
      const gesturePhase = this.runtime.lanePhases?.[contourIndex]
        ?? this.runtime.contourPhase
        ?? this.contourPhase;
      const configuredAperture = enabled ? this.runtime.mouthApertures[index] : 0;
      const releaseAperture = releaseArticulation
        ? Math.max(
          configuredAperture,
          clamp(
            0.2 + this.callArticulation.strike * 0.48
              + this.callArticulation.burst * 0.22,
            0,
            0.94,
          ),
        )
        : configuredAperture;
      if (enabled && releaseArticulation) {
        const previousOpening = this.mouths[index].targetOpening;
        const openingVelocity = clamp(
          (releaseAperture - previousOpening)
            / Math.max(0.12, this.configuration.mouths[index].opening),
          0,
          1,
          0.5,
        );
        this.mouths[index].triggerArticulation(
          this.callArticulation,
          this.runtime.mouthPressures[index],
          openingVelocity,
        );
        this.mouthBurstPeaks[index] = Math.max(
          this.mouthBurstPeaks[index],
          this.mouths[index].burstEnvelope,
          this.mouths[index].transientEnvelope,
        );
      }
      this.mouths[index].articulate(
        this.configuration.mouths[index],
        enabled ? (precharging ? 0 : releaseAperture) : 0,
        enabled ? this.runtime.mouthFlows[index] : 0,
        enabled ? this.runtime.mouthPressures[index] : 0,
        gesturePhase,
        contourValue,
        this.runtime.contourPhase ?? this.contourPhase,
        networkActivity,
        seconds,
        this.callActive ? this.callArticulation : this.flowArticulation,
      );
    }
    if (releaseArticulation) this.callArticulationPending = false;
  }

  _updateBankFeedback() {
    this.bankFeedbackPressures.fill(0);
    this.bankFeedbackWeights.fill(0);
    for (let routeIndex = 0; routeIndex < COLONY_SYRINX_ROUTE_COUNT; routeIndex += 1) {
      const route = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
      if (this.configuration.phonatorEnabled?.[route.phonatorIndex] === false
        || this.configuration.mouthEnabled?.[route.mouthIndex] === false) continue;
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
    const firstFoldEnabled = foldEnabled(this.configuration, firstFold);
    const secondFoldEnabled = foldEnabled(this.configuration, secondFold);
    const enabledFoldCount = Number(firstFoldEnabled) + Number(secondFoldEnabled);
    const enabled = enabledFoldCount > 0;
    if (firstFoldEnabled) {
      this.foldLevels[firstFold] += (
        this.runtime.foldActivities[firstFold] - this.foldLevels[firstFold]
      ) * 0.0024;
    } else {
      this.foldLevels[firstFold] = 0;
    }
    if (secondFoldEnabled) {
      this.foldLevels[secondFold] += (
        this.runtime.foldActivities[secondFold] - this.foldLevels[secondFold]
      ) * 0.0024;
    } else {
      this.foldLevels[secondFold] = 0;
    }
    const activity = enabledFoldCount > 0
      ? clamp(
        (this.foldLevels[firstFold] + this.foldLevels[secondFold]) / enabledFoldCount,
      )
      : 0;
    const foldScale = Math.sqrt(enabledFoldCount * 0.5);
    const routeOffset = phonatorIndex * COLONY_SYRINX_MOUTH_COUNT;
    const connectedAperture = Math.max(
      this.runtime.routeApertures[routeOffset],
      this.runtime.routeApertures[routeOffset + 1],
      this.runtime.routeApertures[routeOffset + 2],
    );
    const connectedFlow = this.runtime.routeFlows
      .slice(routeOffset, routeOffset + COLONY_SYRINX_MOUTH_COUNT)
      .reduce((sum, flow) => sum + flow, 0);
    const sourceGate = enabled
      ? smoothstep(0.01, 0.32, this.runtime.reservoirPressures[phonatorIndex])
        * (0.28 + smoothstep(0.002, 0.12, connectedFlow) * 0.54
          + smoothstep(0.002, 0.08, connectedAperture) * 0.18)
      : 0;
    if (this.sourceSleeping[phonatorIndex]) {
      this.foldDisplacements[firstFold] = 0;
      this.foldDisplacements[secondFold] = 0;
      this.foldVelocities[firstFold] = 0;
      this.foldVelocities[secondFold] = 0;
      return 0;
    }
    const signedBreathLoad = this.callActive
      ? this._callPushPullWave(phonatorIndex) * this.callArticulation.pushPull * 0.42
      : 0;
    const tractFeedback = clamp(
      this.bankFeedbackPressures[phonatorIndex] + signedBreathLoad,
      -1,
      1,
      0,
    );
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
      const spectral = this.callActive ? this.callArticulation : this.flowArticulation;
      const edgeAmount = 0.035 + clamp(spectral.brightness) * 0.075;
      source = Math.tanh(source * 1.64) + (source - previousSource) * edgeAmount;
    }
    source = clamp(clean(source * foldScale), -1.8, 1.8, 0);
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
    const firstDisplacement = firstFoldEnabled
      ? clamp(
        source * (1 - pairDifference * 0.28) + pairDifference * activity * 0.16,
        -1,
        1,
        0,
      )
      : 0;
    const secondDisplacement = secondFoldEnabled
      ? clamp(
        source * (1 + pairDifference * 0.28) - pairDifference * activity * 0.16,
        -1,
        1,
        0,
      )
      : 0;
    const frequency = this.sourceFrequenciesHz[phonatorIndex];
    const previousFirst = this.foldDisplacements[firstFold];
    const previousSecond = this.foldDisplacements[secondFold];
    this.foldDisplacements[firstFold] = clean(firstDisplacement);
    this.foldDisplacements[secondFold] = clean(secondDisplacement);
    this.foldVelocities[firstFold] = firstFoldEnabled
      ? clamp(
        (firstDisplacement - previousFirst) * this.rate,
        -this.rate,
        this.rate,
        0,
      )
      : 0;
    this.foldVelocities[secondFold] = secondFoldEnabled
      ? clamp(
        (secondDisplacement - previousSecond) * this.rate,
        -this.rate,
        this.rate,
        0,
      )
      : 0;
    return source;
  }

  _pelletExcitation(activity, pressureEnergy, noiseAmount, rarefaction) {
    let primaryStrike = 0;
    if (activity > 0.006) {
      this.pelletCountdown -= 1;
      if (this.pelletCountdown <= 0) {
        const pulseRate = this.callActive ? this.callArticulation.pulseRateHz : 0;
        const impactsPerSecond = 9
          + activity * (34 + noiseAmount * 112)
          + Math.min(42, pulseRate * 2.4)
          + this.runtime.impact * 86;
        const spacingJitter = 0.58 + (this._random() + 1) * 0.46;
        this.pelletCountdown = Math.max(
          1,
          Math.round(this.rate / Math.max(4, impactsPerSecond) * spacingJitter),
        );
        const velocity = Math.sqrt(activity)
          * (0.32 + pressureEnergy * 0.68)
          * (0.72 + Math.abs(this._random()) * 0.42);
        primaryStrike = (this._random() >= 0 ? 1 : -1) * velocity;
        this.pelletImpactCount += 1;

        // One collision launches three diminishing, irregular returns. Their
        // delays are cavity-scale (not an audio-rate noise cloud), so a grain
        // can be followed as it hits a fold, a wall, and finally the lips.
        const delayMilliseconds = [1.15, 3.85, 9.7];
        const returnGain = [0.58, 0.39, 0.24];
        for (let index = 0; index < COLONY_SYRINX_MOUTH_COUNT; index += 1) {
          const delayJitter = 0.72 + (this._random() + 1) * 0.31;
          this.pelletRicochetCountdowns[index] = Math.max(
            1,
            Math.round(this.rate * delayMilliseconds[index] * 0.001 * delayJitter),
          );
          this.pelletRicochetLevels[index] = primaryStrike
            * returnGain[index]
            * (this._random() >= 0 ? 1 : -1);
        }
      }
    } else {
      this.pelletCountdown = Math.min(this.pelletCountdown, 64);
    }

    let ricochetOne = 0;
    let ricochetTwo = 0;
    let ricochetThree = 0;
    for (let index = 0; index < COLONY_SYRINX_MOUTH_COUNT; index += 1) {
      if (this.pelletRicochetCountdowns[index] <= 0) continue;
      this.pelletRicochetCountdowns[index] -= 1;
      if (this.pelletRicochetCountdowns[index] !== 0) continue;
      const level = this.pelletRicochetLevels[index];
      if (index === 0) ricochetOne = level;
      else if (index === 1) ricochetTwo = level;
      else ricochetThree = level;
      this.pelletRicochetCount += 1;
    }

    const firstCavity = this.pelletCavityResonators[0].process(
      primaryStrike * 0.78 + ricochetOne,
    );
    const secondCavity = this.pelletCavityResonators[1].process(
      primaryStrike * -0.46 + ricochetTwo + firstCavity * 0.11,
    );
    const thirdCavity = this.pelletCavityResonators[2].process(
      primaryStrike * 0.28 + ricochetThree + secondCavity * 0.09,
    );
    const combinedStrike = primaryStrike + ricochetOne + ricochetTwo + ricochetThree;
    const hardEdge = combinedStrike - this.pelletPreviousStrike * 0.12;
    this.pelletPreviousStrike = combinedStrike;
    this.impactEnvelope *= 0.965;
    return hardEdge * (0.48 + noiseAmount * 0.28)
      + firstCavity * 1.38
      + secondCavity * 1.12
      + thirdCavity * 0.92
      + rarefaction * 0.18;
  }

  _mediumExcitation(noise) {
    const mediumId = this.configuration.mediumId;
    const noiseAmount = this.callActive
      ? this.callArticulation.noise
      : this.flowArticulation.noise;
    const pressureEnergy = clamp(
      this.runtime.meanPressure * 0.34 + this.runtime.totalFlow * 0.72,
    );
    const pushPullWave = this.callActive ? this._callPushPullWave(0) : 0;
    const pushPullRate = Math.max(0.5, this.callArticulation.pulseRateHz || 1.2);
    const normalizedVelocity = clamp(
      (pushPullWave - this.pushPullPrevious) * this.rate / (TWO_PI * pushPullRate),
      -1,
      1,
      0,
    );
    this.pushPullPrevious = pushPullWave;
    const rarefaction = this.callActive
      ? normalizedVelocity * this.callArticulation.pushPull * pressureEnergy * 0.11
      : 0;
    if (mediumId === "water") {
      const alpha = 1 - Math.exp(-TWO_PI * 680 / this.rate);
      this.mediumLowpass += (noise - this.mediumLowpass) * alpha;
      const bubble = this.runtime.impact * this._random() * 0.52 * (0.28 + noiseAmount * 0.72);
      return this.mediumLowpass
          * (0.082 + this.runtime.totalFlow * 0.014)
          * pressureEnergy
          * (0.18 + noiseAmount * 0.82)
        + bubble
        + rarefaction * 0.62;
    }
    if (mediumId === "pellets") {
      const activity = clamp(this.runtime.granularActivity + this.runtime.impact * 0.6);
      return this._pelletExcitation(activity, pressureEnergy, noiseAmount, rarefaction);
    }
    this.impactEnvelope *= 0.985;
    return noise * (0.018 + this.runtime.totalFlow * 0.0025) * pressureEnergy * noiseAmount
      + noise * this.impactEnvelope * 0.035 * pressureEnergy * (0.2 + noiseAmount * 0.8)
      + rarefaction;
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
    this.mouthConnectionApertures.fill(0);
    const routeAlpha = 1 - Math.exp(-1 / (this.rate * 0.0055));
    for (let routeIndex = 0; routeIndex < COLONY_SYRINX_ROUTE_COUNT; routeIndex += 1) {
      const route = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
      const routeEnabled = this.configuration.phonatorEnabled?.[route.phonatorIndex] !== false
        && this.configuration.mouthEnabled?.[route.mouthIndex] !== false;
      const target = clamp(
        (routeEnabled ? this.runtime.routeApertures[routeIndex] : 0)
          * Math.sqrt(this.runtime.routeFlows[routeIndex] / 2.5),
        0,
        1.5,
      );
      const openingDelta = Math.max(0, target - this.previousRouteTargets[routeIndex]);
      this.previousRouteTargets[routeIndex] = target;
      const pressureEnergy = smoothstep(
        0.08,
        0.42,
        this.runtime.reservoirPressures[route.phonatorIndex],
      );
      const fastOpening = smoothstep(0.004, 0.028, openingDelta);
      this.routeShockEnvelopes[routeIndex] = Math.max(
        this.routeShockEnvelopes[routeIndex] * 0.994,
        clamp(openingDelta * 8.4 * fastOpening * pressureEnergy),
      );
      this.routeLevels[routeIndex] += (target - this.routeLevels[routeIndex]) * routeAlpha;
      const level = this.routeLevels[routeIndex];
      const buffer = this.routeDelayBuffers[routeIndex];
      const delayIndex = this.routeDelayIndices[routeIndex];
      const delayed = buffer[delayIndex];
      const shockNoise = (routeEnabled ? 1 : 0) * noise * (routeIndex % 2 === 0 ? 1 : -1)
        * this.routeShockEnvelopes[routeIndex]
        * (0.075 + route.mouthIndex * 0.045);
      const routeInput = this.phonatorSources[route.phonatorIndex] * level + shockNoise;
      const reflection = 0.07
        + this.configuration.crossCoupling * 0.14
        + route.phonatorIndex * 0.012;
      buffer[delayIndex] = clean(Math.tanh(routeInput + delayed * reflection) * 0.94);
      this.routeDelayIndices[routeIndex] = (delayIndex + 1) % buffer.length;
      if (routeEnabled) {
        this.mouthConnectionApertures[route.mouthIndex] = Math.max(
          this.mouthConnectionApertures[route.mouthIndex],
          this.runtime.routeApertures[routeIndex],
        );
        this.mouthDrives[route.mouthIndex] += delayed + routeInput * 0.16;
        this.mouthDriveWeights[route.mouthIndex] += level * level;
      }
    }
    for (let mouthIndex = 0; mouthIndex < COLONY_SYRINX_MOUTH_COUNT; mouthIndex += 1) {
      this.mouthDrives[mouthIndex] /= Math.sqrt(Math.max(1, this.mouthDriveWeights[mouthIndex]));
    }

    const medium = COLONY_SYRINX_MEDIA[this.configuration.mediumId] ?? COLONY_SYRINX_MEDIA.air;
    const excitation = this._mediumExcitation(noise);
    const connectionGateZero = smoothstep(0.0001, 0.02, this.mouthConnectionApertures[0]);
    const connectionGateOne = smoothstep(0.0001, 0.02, this.mouthConnectionApertures[1]);
    const connectionGateTwo = smoothstep(0.0001, 0.02, this.mouthConnectionApertures[2]);
    const previousMouthZero = this.configuration.mouthEnabled?.[0] === false
      ? 0 : this.mouths[0].lastRadiation * connectionGateZero;
    const previousMouthOne = this.configuration.mouthEnabled?.[1] === false
      ? 0 : this.mouths[1].lastRadiation * connectionGateOne;
    const previousMouthTwo = this.configuration.mouthEnabled?.[2] === false
      ? 0 : this.mouths[2].lastRadiation * connectionGateTwo;
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
      const enabled = this.configuration.mouthEnabled?.[mouthIndex] !== false;
      const connectionGate = enabled
        ? smoothstep(0.0001, 0.02, this.mouthConnectionApertures[mouthIndex])
        : 0;
      const transientGate = enabled ? smoothstep(
        0.0001,
        0.12,
        Math.max(mouth.burstEnvelope, mouth.transientEnvelope),
      ) : 0;
      const radiationConnectionGate = Math.max(connectionGate, transientGate);
      const flow = enabled ? this.runtime.mouthFlows[mouthIndex] : 0;
      if (enabled && (
        this.runtime.mouthApertures[mouthIndex] > 0.02
          || flow > 0.02
          || transientGate > 0.02
      )) {
        activeMouths += 1;
      }
      const voicedDriveScale = this.configuration.mediumId === "water"
        ? 0.58
        : this.configuration.mediumId === "pellets" ? 0.16 : 1;
      const materialExcitationScale = this.configuration.mediumId === "water"
        ? 1.34
        : this.configuration.mediumId === "pellets" ? 1.72 : 1;
      const drive = enabled
        ? (this.mouthDrives[mouthIndex] * voicedDriveScale
          + excitation * materialExcitationScale
            * (MOUTH_EXCITATION_GAINS[mouthIndex] + Math.sqrt(flow) * 0.28))
          * connectionGate
        : 0;
      const mouthInterference = mouthIndex === 0
        ? interferenceZero
        : mouthIndex === 1 ? interferenceOne : interferenceTwo;
      const radiated = mouth.process(
        drive,
        enabled ? this.runtime.mouthPressures[mouthIndex] * connectionGate : 0,
        this.configuration.mediumId,
        this._random(),
        enabled ? mouthInterference * interferenceScale * connectionGate : 0,
      );
      this.mouthLoads[mouthIndex] = enabled ? clamp(
        Math.max(this.runtime.mouthPressures[mouthIndex], mouth.reflectedLoad) * connectionGate,
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      ) : 0;
      const leftGain = Math.sqrt((1 - mouth.pan) * 0.5);
      const rightGain = Math.sqrt((1 + mouth.pan) * 0.5);
      if (enabled) {
        left += radiated * radiationConnectionGate * leftGain;
        right += radiated * radiationConnectionGate * rightGain;
      }
      this.mouthBurstPeaks[mouthIndex] = Math.max(
        this.mouthBurstPeaks[mouthIndex],
        mouth.burstEnvelope,
        mouth.transientEnvelope,
      );
    }
    // Feed the signed, audio-rate tract return into the next source sample.
    // Compression and rarefaction can now oppose or assist the tissue motion.
    this._updateBankFeedback();

    const activeMouthScale = 1 / Math.sqrt(Math.max(1, activeMouths * 0.78));
    const activeSources = this.phonatorSources.reduce((count, source, index) => (
      count + (this.configuration.phonatorEnabled?.[index] !== false && Math.abs(source) > 1e-5 ? 1 : 0)
    ), 0);
    const simultaneousSourceScale = 1 / Math.sqrt(Math.max(1, activeSources * 0.82));
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
    const contourPhase = clamp(runtime.contourPhase ?? this.contourPhase);
    const lanePhases = Array.from({ length: CONTINUOUS_CONTOUR_COUNT }, (_, index) => clamp(
      runtime.lanePhases?.[index],
      0,
      1,
      contourPhase,
    ));
    const contourValues = Array.from({ length: CONTINUOUS_CONTOUR_COUNT }, (_, index) => clamp(
      runtime.contourValues?.[index] ?? runtime.laneVelocities?.[index],
      0,
      1,
      index === 0 ? 0.72 : 0.5,
    ));
    const laneSteps = lanePhases.map((phase) => Math.floor(phase * COLONY_SYRINX_SEQUENCE_LENGTH)
      % COLONY_SYRINX_SEQUENCE_LENGTH);
    const activeLungCount = this.configuration.lungEnabled.filter(Boolean).length;
    const activePhonatorCount = Array.from(
      { length: COLONY_SYRINX_PHONATOR_COUNT },
      (_, index) => this.configuration.phonatorEnabled?.[index] !== false,
    ).filter(Boolean).length;
    const activeFoldCount = Array.from(
      { length: COLONY_SYRINX_FOLD_COUNT },
      (_, index) => foldEnabled(this.configuration, index),
    ).filter(Boolean).length;
    const activeMouthCount = Array.from(
      { length: COLONY_SYRINX_MOUTH_COUNT },
      (_, index) => this.configuration.mouthEnabled?.[index] !== false,
    ).filter(Boolean).length;
    const activeRouteCount = COLONY_SYRINX_TOPOLOGY.routes.filter(({ phonatorIndex, mouthIndex }) => (
      this.configuration.phonatorEnabled?.[phonatorIndex] !== false
        && this.configuration.mouthEnabled?.[mouthIndex] !== false
        && Math.max(
          this.configuration.routes?.[phonatorIndex]?.[mouthIndex] ?? 0,
          this.configuration.alternateRoutes?.[phonatorIndex]?.[mouthIndex] ?? 0,
        ) > 1e-6
    )).length;
    let load = 0;
    for (let index = 0; index < COLONY_SYRINX_MOUTH_COUNT; index += 1) {
      load += this.mouthLoads[index];
    }
    load /= COLONY_SYRINX_MOUTH_COUNT;
    this.port.postMessage({
      type: "telemetry",
      reservoirs: Array.from(runtime.reservoirPressures),
      lungs: Array.from(runtime.lungPressures),
      folds: Array.from(
        { length: COLONY_SYRINX_FOLD_COUNT },
        (_, index) => foldEnabled(this.configuration, index)
          ? runtime.foldActivities[index]
          : 0,
      ),
      routes: Array.from(runtime.routeFlows),
      mouths: Array.from(runtime.mouthFlows),
      step: Math.floor(contourPhase * COLONY_SYRINX_SEQUENCE_LENGTH)
        % COLONY_SYRINX_SEQUENCE_LENGTH,
      laneSteps,
      lanePhases,
      laneVelocities: contourValues,
      contourPhase,
      contourValues,
      flow: runtime.totalFlow,
      load,
      foldDisplacements: Array.from(
        { length: COLONY_SYRINX_FOLD_COUNT },
        (_, index) => foldEnabled(this.configuration, index)
          ? this.foldDisplacements[index]
          : 0,
      ),
      foldFrequenciesHz: Array.from(
        { length: COLONY_SYRINX_FOLD_COUNT },
        (_, index) => foldEnabled(this.configuration, index)
          ? runtime.foldFrequenciesHz[index]
          : 0,
      ),
      routeApertures: Array.from(runtime.routeApertures),
      mouthApertures: Array.from(runtime.mouthApertures),
      mouthPressures: Array.from(runtime.mouthPressures),
      mouthLoads: Array.from(this.mouthLoads),
      mouthGestures: this.mouths.map((mouth) => mouth.gestureIndex),
      mouthFormantsHz: this.mouths.map((mouth) => mouth.formantsHz.slice()),
      mouthBursts: this.mouths.map((mouth, index) => clamp(Math.max(
        this.mouthBurstPeaks[index],
        mouth.burstEnvelope,
        mouth.transientEnvelope,
      ))),
      exhales: Array.from(this.bankExhaleLevels),
      exhaleBeat: contourPhase,
      activeCounts: {
        lungs: activeLungCount,
        phonators: activePhonatorCount,
        folds: activeFoldCount,
        mouths: activeMouthCount,
        routes: activeRouteCount,
      },
      activeLungCount,
      activePhonatorCount,
      activeFoldCount,
      activeMouthCount,
      activeRouteCount,
      callActive: this.callActive,
      callId: this.callId,
      callToken: this.callToken,
      callProgress: this.callDurationSamples > 0
        ? clamp(this.callRenderedSamples / this.callDurationSamples)
        : 0,
      callArticulation: this.callActive ? { ...this.callArticulation } : null,
      sourceModels: VOCAL_SOURCE_PROFILES.map((profile) => profile.id),
      sourceFrequenciesHz: Array.from(this.sourceFrequenciesHz),
      mediumId: this.configuration.mediumId,
      pelletImpacts: this.pelletImpactCount,
      pelletRicochets: this.pelletRicochetCount,
      limiterGain: this.limiterGain,
      limitedShare: this.limitedShare,
      peak: this.peak,
      rms: this.rms,
    });
    this.mouthBurstPeaks.fill(0);
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
      const callEnvelope = this._callEnvelope();
      this._renderFrame();
      if (this.frameLimited) limitedFrames += 1;
      const left = this.renderedLeft * callEnvelope;
      const right = this.renderedRight * callEnvelope;
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
      if (this.callActive) {
        this.callRenderedSamples += 1;
        if (this.callRenderedSamples >= this.callDurationSamples) this._finishCall();
      }
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
