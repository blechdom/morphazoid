import {
  SyrinxSourceEngine,
  sanitizeSyrinxSourceParameters,
  syrinxSourceModelId,
} from "./syrinx-source-models.js";
import {
  applyTonguesToDiameter,
  tongueAirwayState,
} from "./tongue-physics.js";

const SPEED_OF_SOUND = 343;
const MAX_WAVEGUIDE_RATE = 96_000;
const SOURCE_OVERSAMPLE = 2;
const MAX_SECTIONS = 232;
const MIN_SECTIONS = 5;
const AREA_FLOOR = 0.000001;
const DIAMETER_FLOOR = 0.001;
const REFLECTION_LIMIT = 0.998;
const TUBE_LOSS = 0.9987;
const SOURCE_REFLECTION = 0.72;
const OUTPUT_LIMIT = 0.94;
const DENORMAL_LIMIT = 1e-20;
const TELEMETRY_BLOCKS = 12;
const MAX_VOICE_SOURCES = 7;

// Species-informed diameter priors in centimeters. These are deliberately
// coarse playable area functions, not claims of individualized CT geometry.
// Length is handled by propagation delay; these points only describe shape.
const TRACT_DIAMETER_PROFILES = Object.freeze({
  lion: Object.freeze([0.72, 1.05, 1.75, 2.28, 1.62, 1.86, 2.34, 2.72]),
  wolf: Object.freeze([0.48, 0.72, 1.22, 1.58, 1.12, 1.34, 1.72, 2.02]),
  dog: Object.freeze([0.42, 0.64, 1.08, 1.42, 0.92, 1.18, 1.62, 2.04]),
  elephant: Object.freeze([1.35, 2.08, 3.42, 4.58, 3.28, 4.12, 5.22, 4.62]),
  alligator: Object.freeze([0.88, 1.28, 2.18, 3.02, 2.72, 2.92, 3.46, 3.12]),
  raven: Object.freeze([0.22, 0.3, 0.44, 0.58, 0.46, 0.54, 0.7, 0.84]),
  songbird: Object.freeze([0.1, 0.14, 0.2, 0.27, 0.23, 0.28, 0.36, 0.43]),
  dove: Object.freeze([0.18, 0.25, 0.38, 0.5, 0.43, 0.5, 0.66, 0.78]),
  owl: Object.freeze([0.25, 0.36, 0.54, 0.72, 0.62, 0.72, 0.91, 1.04]),
  bullfrog: Object.freeze([0.32, 0.5, 0.78, 1.08, 1.26, 1.08, 0.78, 0.54]),
  treefrog: Object.freeze([0.12, 0.18, 0.3, 0.44, 0.54, 0.46, 0.32, 0.24]),
  mouse: Object.freeze([0.08, 0.11, 0.16, 0.21, 0.18, 0.22, 0.28, 0.32]),
  mammal: Object.freeze([0.5, 0.74, 1.28, 1.66, 1.16, 1.4, 1.82, 2.1]),
  syrinx: Object.freeze([0.18, 0.25, 0.38, 0.5, 0.42, 0.5, 0.66, 0.78]),
  frog: Object.freeze([0.24, 0.38, 0.62, 0.86, 1.02, 0.88, 0.64, 0.46]),
  whistle: Object.freeze([0.08, 0.11, 0.16, 0.21, 0.18, 0.22, 0.28, 0.32]),
});

const clamp = (value, minimum = 0, maximum = 1) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
};

const integer = (value, minimum, maximum, fallback = minimum) => {
  const number = Number(value);
  return Math.round(clamp(Number.isFinite(number) ? number : fallback, minimum, maximum));
};

const clean = (value) => (
  Number.isFinite(value) && Math.abs(value) >= DENORMAL_LIMIT ? value : 0
);

function waveguideRateFor(rate = 48_000) {
  const outputRate = clamp(rate, 8_000, 384_000);
  return outputRate <= 50_000
    ? outputRate * 2
    : Math.min(outputRate, MAX_WAVEGUIDE_RATE);
}

export function tractSectionCount(tractLengthM, rate = 48_000) {
  const length = clamp(tractLengthM, 0.018, 0.82);
  const sections = Math.round(length * waveguideRateFor(rate) / SPEED_OF_SOUND);
  return Math.max(MIN_SECTIONS, Math.min(MAX_SECTIONS, sections));
}

export function tractDiameterAt(position, configuration = {}) {
  const x = clamp(position);
  const model = syrinxSourceModelId(configuration.model ?? configuration.sourceModel);
  const mouthOpening = clamp(configuration.mouthOpening, 0, 1);
  const family = model === "twoMass" ? "mammal" : model;
  const profile = TRACT_DIAMETER_PROFILES[configuration.animalId]
    ?? TRACT_DIAMETER_PROFILES[family]
    ?? TRACT_DIAMETER_PROFILES.mammal;
  const scaled = x * (profile.length - 1);
  const leftIndex = Math.min(profile.length - 1, Math.floor(scaled));
  const rightIndex = Math.min(profile.length - 1, leftIndex + 1);
  const amount = scaled - leftIndex;
  let diameter = profile[leftIndex] + (profile[rightIndex] - profile[leftIndex]) * amount;

  const mouthBlend = clamp((x - 0.72) / 0.28);
  const lipDiameter = Math.max(
    0.04,
    profile[profile.length - 1] * (0.18 + mouthOpening * 1.04),
  );
  diameter += (lipDiameter - diameter) * mouthBlend * mouthBlend;
  diameter = applyTonguesToDiameter(x, diameter, configuration);
  return Math.max(DIAMETER_FLOOR, diameter);
}

function updateReflections(diameters, areas, reflections, sectionCount) {
  for (let index = 0; index < sectionCount; index += 1) {
    const diameter = Math.max(DIAMETER_FLOOR, diameters[index]);
    areas[index] = Math.max(AREA_FLOOR, diameter * diameter);
    if (index === 0) continue;
    const sum = Math.max(AREA_FLOOR, areas[index - 1] + areas[index]);
    reflections[index] = clamp(
      (areas[index - 1] - areas[index]) / sum,
      -REFLECTION_LIMIT,
      REFLECTION_LIMIT,
    );
  }
}

class SyrinxPhysicalProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const initial = options.processorOptions?.configuration ?? {};
    this.workletRate = sampleRate;
    this.waveguideRate = waveguideRateFor(sampleRate);
    this.sourceRate = this.waveguideRate * SOURCE_OVERSAMPLE;
    this.waveguideStepsPerOutput = this.waveguideRate / this.workletRate;
    this.waveguidePhase = 0;
    this.source = new SyrinxSourceEngine({
      sampleRate: this.sourceRate,
      parameters: initial.source,
      model: initial.source?.model ?? initial.model ?? "syrinx",
      seed: initial.seed ?? 0x51f15e,
    });

    this.right = new Float64Array(MAX_SECTIONS);
    this.left = new Float64Array(MAX_SECTIONS);
    this.rightJunction = new Float64Array(MAX_SECTIONS + 1);
    this.leftJunction = new Float64Array(MAX_SECTIONS + 1);
    this.diameter = new Float64Array(MAX_SECTIONS);
    this.targetDiameter = new Float64Array(MAX_SECTIONS);
    this.area = new Float64Array(MAX_SECTIONS);
    this.reflection = new Float64Array(MAX_SECTIONS + 1);

    this.configuration = {
      animalId: "raven",
      model: "syrinx",
      tractLengthM: 0.17,
      mouthOpening: 0.52,
      cavityCoupling: 0.34,
      cavityFrequencyHz: 780,
      tongueEnabled: false,
      tongueAnatomy: "human",
      tonguePosition: 0.5,
      tongueHeight: 0.56,
      tongueShape: 0.48,
      tongueTip: 0.3,
      tongueExtension: 0.08,
      tongueCurl: 0.5,
      tongueLateral: 0.12,
      tongueCount: 1,
      tongues: [],
      airwayGate: null,
      gatePosition: null,
      lateralBypass: 0,
      nasalBypass: 0,
      flutterHz: 0,
      flutterDepth: 0,
      turbulence: 0,
      flowDirection: 1,
      articulationVoicing: 1,
      articulationPressure: 0,
      burstGain: 0,
      burstFrequencyHz: 1_050,
      cavityBranches: 2,
      sourceBalance: 0,
      asymmetry: 0.3,
      voiceCount: 1,
      voiceSpreadCents: 0,
      ...initial.tract,
      ...initial,
    };
    this.configuration.model = syrinxSourceModelId(
      initial.source?.model ?? initial.model ?? this.configuration.model,
    );
    const initialSourceParameters = sanitizeSyrinxSourceParameters(
      initial.source ?? initial,
      this.sourceRate,
    );
    this.configuration.sourceBalance = initialSourceParameters.sourceBalance;
    this.configuration.asymmetry = initialSourceParameters.asymmetry;
    this.configuration.voiceCount = integer(
      initial.source?.voiceCount ?? this.configuration.voiceCount,
      1,
      MAX_VOICE_SOURCES,
      1,
    );
    this.configuration.voiceSpreadCents = clamp(
      initial.source?.voiceSpreadCents ?? this.configuration.voiceSpreadCents,
      0,
      80,
    );
    this.sources = Array.from({ length: MAX_VOICE_SOURCES }, (_, index) => (
      index === 0
        ? this.source
        : new SyrinxSourceEngine({
          sampleRate: this.sourceRate,
          parameters: initial.source,
          model: initial.source?.model ?? initial.model ?? "syrinx",
          seed: (initial.seed ?? 0x51f15e) + index * 0x9e37,
        })
    ));
    this.voiceGains = new Float64Array(MAX_VOICE_SOURCES);
    this.voiceTargetGains = new Float64Array(MAX_VOICE_SOURCES);
    this.voicePans = new Float64Array(MAX_VOICE_SOURCES);
    this.voiceGains[0] = 1;
    this.voiceTargetGains[0] = 1;
    this.voiceGainSmoothing = 1 - Math.exp(-1 / (this.sourceRate * 0.045));
    this._configureSourceBank(
      initialSourceParameters,
      initial.source ?? initial,
    );
    this.activeSections = tractSectionCount(this.configuration.tractLengthM, this.workletRate);
    this.targetSections = this.activeSections;
    this.feedbackPressure = 0;
    this.sourceLowpassOne = 0;
    this.sourceLowpassTwo = 0;
    this.lastLipWave = 0;
    this.nasalDrive = 0;
    const sourceCutoff = Math.min(18_000, this.workletRate * 0.38);
    this.sourceLowpassAlpha = 1 - Math.exp(-Math.PI * 2 * sourceCutoff / this.sourceRate);
    this.lipLowpass = 0;
    this.cavityOne = 0;
    this.cavityOnePrevious = 0;
    this.cavityTwo = 0;
    this.cavityTwoPrevious = 0;
    this.cavityThree = 0;
    this.cavityThreePrevious = 0;
    this.bilateralDifference = 0;
    this.flutterPhase = 0;
    this.previousAirwayGate = 1;
    this.currentAirwayGate = 1;
    this.pressureEnergy = 0;
    this.transientStrength = 0;
    this.transientAge = Infinity;
    this.releaseBurstGain = 0;
    this.transientFrequencyHz = this.configuration.burstFrequencyHz;
    this.noiseState = (Number(initial.seed) || 0x51f15e) >>> 0;
    this.burstOne = 0;
    this.burstTwo = 0;
    this.previousOutputLeft = 0;
    this.previousOutputRight = 0;
    this.transitionLeft = 0;
    this.transitionRight = 0;
    this.transitionRemaining = 0;
    this.transitionLength = Math.max(1, Math.round(sampleRate * 0.018));
    this.blockCounter = 0;
    this.lastPeak = 0;
    this.lastRms = 0;
    this._updateGeometry(true);

    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _configureSourceBank(parameters, raw = {}) {
    this.configuration.voiceCount = integer(
      raw.voiceCount ?? this.configuration.voiceCount,
      1,
      MAX_VOICE_SOURCES,
      1,
    );
    this.configuration.voiceSpreadCents = clamp(
      raw.voiceSpreadCents ?? this.configuration.voiceSpreadCents,
      0,
      80,
    );
    const count = this.configuration.voiceCount;
    const spread = this.configuration.voiceSpreadCents;
    for (let index = 0; index < this.sources.length; index += 1) {
      const active = index < count;
      this.voiceTargetGains[index] = active ? 1 : 0;
      if (!active) continue;
      const pan = count <= 1 ? 0 : index / Math.max(1, count - 1) * 2 - 1;
      const unit = pan * 0.5;
      this.voicePans[index] = pan;
      this.sources[index].setParameters({
        ...parameters,
        frequencyHz: parameters.frequencyHz * 2 ** (unit * spread / 1_200),
        asymmetry: clamp(parameters.asymmetry + unit * spread / 180, -1, 1),
      });
    }
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "reset") {
      this._beginTransition();
      for (let index = 0; index < this.sources.length; index += 1) {
        this.sources[index].reset((message.seed ?? 0x51f15e) + index * 0x9e37);
      }
      this._resetWaveguide();
      return;
    }
    if (message.type !== "configure") return;
    const requestedSource = message.source
      ? sanitizeSyrinxSourceParameters(message.source, this.sourceRate)
      : null;
    const changedModel = requestedSource
      ? requestedSource.model !== this.configuration.model
      : false;
    if (changedModel || message.resetTract) this._beginTransition();
    this.configuration = {
      ...this.configuration,
      ...(message.tract ?? {}),
      ...(requestedSource ? {
        model: requestedSource.model,
        sourceBalance: requestedSource.sourceBalance,
        asymmetry: requestedSource.asymmetry,
      } : {}),
    };
    if (requestedSource) this._configureSourceBank(requestedSource, message.source);
    this.targetSections = tractSectionCount(
      this.configuration.tractLengthM,
      this.workletRate,
    );
    if (changedModel || message.resetTract) {
      this.activeSections = this.targetSections;
      this._updateGeometry(true);
      this._resetWaveguide();
    } else {
      this._updateGeometry(false);
    }
  }

  _beginTransition() {
    this.transitionLeft = this.previousOutputLeft;
    this.transitionRight = this.previousOutputRight;
    this.transitionRemaining = this.transitionLength;
  }

  _resetWaveguide() {
    this.right.fill(0);
    this.left.fill(0);
    this.rightJunction.fill(0);
    this.leftJunction.fill(0);
    this.feedbackPressure = 0;
    this.sourceLowpassOne = 0;
    this.sourceLowpassTwo = 0;
    this.lastLipWave = 0;
    this.nasalDrive = 0;
    this.waveguidePhase = 0;
    this.lipLowpass = 0;
    this.cavityOne = 0;
    this.cavityOnePrevious = 0;
    this.cavityTwo = 0;
    this.cavityTwoPrevious = 0;
    this.cavityThree = 0;
    this.cavityThreePrevious = 0;
    this.bilateralDifference = 0;
    this.flutterPhase = 0;
    this.previousAirwayGate = 1;
    this.currentAirwayGate = 1;
    this.pressureEnergy = 0;
    this.transientStrength = 0;
    this.transientAge = Infinity;
    this.releaseBurstGain = 0;
    this.transientFrequencyHz = this.configuration.burstFrequencyHz;
    this.burstOne = 0;
    this.burstTwo = 0;
  }

  _noise() {
    let value = this.noiseState || 0x51f15e;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.noiseState = value >>> 0;
    return this.noiseState / 0x80000000 - 1;
  }

  _airwayGate() {
    const base = clamp(this.baseAirwayGate ?? 1);
    const flutterHz = clamp(this.configuration.flutterHz, 0, 60);
    const flutterDepth = clamp(this.configuration.flutterDepth);
    let opening = base;
    if (flutterHz > 0 && flutterDepth > 0) {
      this.flutterPhase = (this.flutterPhase + flutterHz / this.waveguideRate) % 1;
      const flutter = Math.sin(this.flutterPhase * Math.PI * 2) * 0.5 + 0.5;
      const flick = flutter * flutter * (3 - 2 * flutter);
      opening += (1 - opening) * flick * flutterDepth;
    }
    const lateral = clamp(this.configuration.lateralBypass);
    return lateral + clamp(opening) * (1 - lateral);
  }

  _burstSample(noise) {
    if (this.transientAge > 0.18 || this.transientStrength <= 0.00001) return 0;
    const frequency = clamp(
      this.transientFrequencyHz,
      80,
      this.waveguideRate * 0.38,
    );
    const radius = 0.92;
    const resonated = clean(
      noise * (1 - radius)
        + 2 * radius * Math.cos(Math.PI * 2 * frequency / this.waveguideRate) * this.burstOne
        - radius * radius * this.burstTwo,
    );
    this.burstTwo = this.burstOne;
    this.burstOne = resonated;
    const envelope = this.transientStrength * 2 ** (-this.transientAge * 190);
    this.transientAge += 1 / this.waveguideRate;
    return resonated * envelope * 2.4;
  }

  _updateGeometry(immediate) {
    const sectionCount = Math.max(this.activeSections, this.targetSections);
    for (let index = 0; index < sectionCount; index += 1) {
      const progress = sectionCount <= 1 ? 0 : index / (sectionCount - 1);
      this.targetDiameter[index] = tractDiameterAt(progress, this.configuration);
      if (immediate || !Number.isFinite(this.diameter[index]) || this.diameter[index] <= 0) {
        this.diameter[index] = this.targetDiameter[index];
      }
    }
    updateReflections(this.diameter, this.area, this.reflection, this.activeSections);
    this._updateCavityCoefficients();
    const airway = tongueAirwayState(this.configuration);
    const requestedGate = this.configuration.airwayGate;
    this.baseAirwayGate = requestedGate == null || !Number.isFinite(Number(requestedGate))
      ? airway.aperture
      : clamp(requestedGate);
    const requestedPosition = this.configuration.gatePosition;
    const numericPosition = Number(requestedPosition);
    this.valvePosition = requestedPosition != null && Number.isFinite(numericPosition)
      ? clamp(numericPosition)
      : airway.position;
  }

  _prepareBlock() {
    if (this.activeSections < this.targetSections) {
      const newIndex = this.activeSections;
      const previousIndex = Math.max(0, newIndex - 1);
      this.right[newIndex] = this.right[previousIndex];
      this.left[newIndex] = this.left[previousIndex];
      this.diameter[newIndex] = this.targetDiameter[newIndex] || this.diameter[previousIndex];
      this.activeSections += 1;
    }
    else if (this.activeSections > this.targetSections) this.activeSections -= 1;
    const alpha = 0.075;
    for (let index = 0; index < this.activeSections; index += 1) {
      const progress = this.activeSections <= 1 ? 0 : index / (this.activeSections - 1);
      this.targetDiameter[index] = tractDiameterAt(progress, this.configuration);
      this.diameter[index] += (this.targetDiameter[index] - this.diameter[index]) * alpha;
    }
    updateReflections(this.diameter, this.area, this.reflection, this.activeSections);
    this._updateCavityCoefficients();
  }

  _updateCavityCoefficients() {
    const frequency = clamp(
      this.configuration.cavityFrequencyHz,
      28,
      this.workletRate * 0.38,
    );
    const coupling = clamp(this.configuration.cavityCoupling);
    const radius = 0.91 + coupling * 0.076;
    this.cavityOneRadius = Math.min(0.994, radius);
    this.cavityTwoRadius = Math.min(0.991, radius - 0.008);
    this.cavityThreeRadius = Math.min(0.988, radius - 0.014);
    this.cavityOneCosine = Math.cos(Math.PI * 2 * frequency / this.workletRate);
    this.cavityTwoCosine = Math.cos(
      Math.PI * 2 * Math.min(this.workletRate * 0.4, frequency * 1.72) / this.workletRate,
    );
    this.cavityThreeCosine = Math.cos(
      Math.PI * 2 * Math.min(this.workletRate * 0.4, frequency * 2.37) / this.workletRate,
    );
  }

  _propagate(sourceFlow) {
    const count = this.activeSections;
    const gate = this._airwayGate();
    const pressureDrive = clamp(this.configuration.articulationPressure);
    if (gate <= 0.075) {
      const targetEnergy = pressureDrive * pressureDrive * 0.42 + sourceFlow * sourceFlow;
      this.pressureEnergy += (targetEnergy - this.pressureEnergy) * 0.0009;
      this.releaseBurstGain = Math.max(
        this.releaseBurstGain,
        clamp(this.configuration.burstGain, 0, 1.5),
      );
      this.transientFrequencyHz = this.configuration.burstFrequencyHz;
    } else {
      this.pressureEnergy *= 0.9992;
    }
    if (this.previousAirwayGate <= 0.075 && gate >= 0.2) {
      this.transientStrength = clamp(
        Math.sqrt(Math.max(0, this.pressureEnergy))
          * this.releaseBurstGain,
        0,
        1.2,
      );
      this.transientAge = 0;
      this.pressureEnergy *= 0.16;
      this.releaseBurstGain = 0;
    }
    this.previousAirwayGate = gate;
    this.currentAirwayGate = gate;

    const noise = this._noise();
    const voicing = clamp(this.configuration.articulationVoicing ?? 1);
    const turbulence = clamp(this.configuration.turbulence, 0, 1.5);
    const direction = Number(this.configuration.flowDirection) < 0 ? -1 : 1;
    const articulationNoise = noise
      * turbulence
      * (0.035 + pressureDrive * 0.14)
      * (0.55 + gate * 0.45);
    sourceFlow = (sourceFlow * voicing + this._burstSample(noise)) * direction;
    this.nasalDrive = sourceFlow
      * clamp(this.configuration.nasalBypass)
      * (1 - gate);

    const gateIndex = Math.max(1, Math.min(
      count - 1,
      Math.round(clamp(this.valvePosition ?? 0.9) * (count - 1)),
    ));
    this.rightJunction[0] = clean(sourceFlow + this.left[0] * SOURCE_REFLECTION);
    for (let index = 1; index < count; index += 1) {
      const offset = this.reflection[index] * (this.right[index - 1] + this.left[index]);
      const normalRight = this.right[index - 1] - offset;
      const normalLeft = this.left[index] + offset;
      if (index === gateIndex && gate < 0.999) {
        this.rightJunction[index] = clean(
          normalRight * gate + this.left[index] * (1 - gate) + articulationNoise,
        );
        this.leftJunction[index] = clean(
          normalLeft * gate + this.right[index - 1] * (1 - gate),
        );
      } else {
        this.rightJunction[index] = clean(normalRight);
        this.leftJunction[index] = clean(normalLeft);
      }
    }
    const opening = clamp(this.configuration.mouthOpening);
    const lipReflection = -0.95 + opening * 0.28;
    this.leftJunction[count] = clean(this.right[count - 1] * lipReflection);
    for (let index = 0; index < count; index += 1) {
      this.right[index] = clean(this.rightJunction[index] * TUBE_LOSS);
      this.left[index] = clean(this.leftJunction[index + 1] * TUBE_LOSS);
    }
    this.feedbackPressure = clamp(
      (this.right[0] + this.left[0]) / Math.max(0.18, Math.sqrt(this.area[0])) * 0.14,
      -1,
      1,
    );
    return this.right[count - 1];
  }

  _resonate(input, radius, cosine, firstKey, secondKey) {
    const first = this[firstKey];
    const second = this[secondKey];
    const result = clean(
      (1 - radius) * input
      + 2 * radius * cosine * first
      - radius * radius * second,
    );
    this[secondKey] = first;
    this[firstKey] = result;
    return result;
  }

  _radiate(lipWave) {
    const opening = clamp(this.configuration.mouthOpening)
      * (0.04 + this.currentAirwayGate * 0.96);
    const smoothing = 0.06 + opening * 0.22;
    this.lipLowpass += (lipWave - this.lipLowpass) * smoothing;
    const differentiated = lipWave - this.lipLowpass;
    const oral = lipWave * (0.28 + opening * 0.42) + differentiated * (0.7 + opening * 0.45);
    const cavityInput = oral + this.nasalDrive;
    const modeOne = this._resonate(
      cavityInput,
      this.cavityOneRadius,
      this.cavityOneCosine,
      "cavityOne",
      "cavityOnePrevious",
    );
    const modeTwo = this._resonate(
      cavityInput,
      this.cavityTwoRadius,
      this.cavityTwoCosine,
      "cavityTwo",
      "cavityTwoPrevious",
    );
    const modeThree = this._resonate(
      cavityInput,
      this.cavityThreeRadius,
      this.cavityThreeCosine,
      "cavityThree",
      "cavityThreePrevious",
    );
    const cavity = clamp(this.configuration.cavityCoupling);
    const branches = integer(this.configuration.cavityBranches, 0, 3, 2);
    const resonant = branches <= 0
      ? 0
      : branches === 1
        ? modeOne * 0.72
        : branches === 2
          ? modeOne * 0.62 + modeTwo * 0.28
          : (modeOne * 0.58 + modeTwo * 0.28 + modeThree * 0.2) / 1.06;
    return oral * (1 - cavity * 0.32) + resonant * cavity;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    const leftOutput = output[0];
    const rightOutput = output[1] ?? leftOutput;
    this._prepareBlock();
    let squareSum = 0;
    let peak = 0;
    const spread = clamp(
      Math.abs(this.configuration.asymmetry) * 0.28
        + (this.configuration.voiceCount - 1) * 0.045,
      0,
      0.34,
    );

    for (let frame = 0; frame < leftOutput.length; frame += 1) {
      this.waveguidePhase += this.waveguideStepsPerOutput;
      const waveguideSteps = Math.floor(this.waveguidePhase);
      this.waveguidePhase -= waveguideSteps;
      let lipWave = this.lastLipWave;
      if (waveguideSteps > 0) {
        lipWave = 0;
        for (let step = 0; step < waveguideSteps; step += 1) {
          let sourceFlow = 0;
          let sourceDifference = 0;
          for (let sourceStep = 0; sourceStep < SOURCE_OVERSAMPLE; sourceStep += 1) {
            let rawSource = 0;
            let rawDifference = 0;
            let voicePower = 0;
            for (let voiceIndex = 0; voiceIndex < this.sources.length; voiceIndex += 1) {
              this.voiceGains[voiceIndex] += (
                this.voiceTargetGains[voiceIndex] - this.voiceGains[voiceIndex]
              ) * this.voiceGainSmoothing;
              const gain = this.voiceGains[voiceIndex];
              if (gain < 0.0001 && this.voiceTargetGains[voiceIndex] <= 0) continue;
              const voice = this.sources[voiceIndex];
              const voiceSample = voice.renderSample(this.feedbackPressure);
              const pan = this.voicePans[voiceIndex];
              rawSource += voiceSample * gain;
              rawDifference += (voice.bilateralDifference + voiceSample * pan * 0.16) * gain;
              voicePower += gain * gain;
            }
            const voiceNormalization = 1 / Math.sqrt(Math.max(1, voicePower));
            rawSource *= voiceNormalization;
            rawDifference *= voiceNormalization;
            this.sourceLowpassOne += (rawSource - this.sourceLowpassOne) * this.sourceLowpassAlpha;
            this.sourceLowpassTwo += (
              this.sourceLowpassOne - this.sourceLowpassTwo
            ) * this.sourceLowpassAlpha;
            sourceFlow += this.sourceLowpassTwo;
            sourceDifference += rawDifference;
          }
          sourceFlow /= SOURCE_OVERSAMPLE;
          this.bilateralDifference = sourceDifference / SOURCE_OVERSAMPLE;
          this.lastLipWave = this._propagate(sourceFlow);
          lipWave += this.lastLipWave;
        }
        lipWave /= waveguideSteps;
      }
      const radiated = this._radiate(lipWave);
      const bilateralDifference = Number.isFinite(this.bilateralDifference)
        ? this.bilateralDifference
        : 0;
      const side = bilateralDifference * spread * 0.18;
      let left = Math.tanh((radiated + side) * 0.72) * OUTPUT_LIMIT;
      let right = Math.tanh((radiated - side) * 0.72) * OUTPUT_LIMIT;
      const balance = clamp(this.configuration.sourceBalance, -1, 1);
      left *= 1 - Math.max(0, balance) * 0.85;
      right *= 1 - Math.max(0, -balance) * 0.85;
      if (this.transitionRemaining > 0) {
        const amount = 1 - this.transitionRemaining / this.transitionLength;
        const oldAmount = 1 - amount;
        left = left * amount + this.transitionLeft * oldAmount;
        right = right * amount + this.transitionRight * oldAmount;
        this.transitionRemaining -= 1;
      }
      leftOutput[frame] = left;
      rightOutput[frame] = right;
      this.previousOutputLeft = left;
      this.previousOutputRight = right;
      const magnitude = Math.max(Math.abs(left), Math.abs(right));
      peak = Math.max(peak, magnitude);
      squareSum += (left * left + right * right) * 0.5;
    }

    this.lastPeak += (peak - this.lastPeak) * 0.32;
    this.lastRms += (Math.sqrt(squareSum / Math.max(1, leftOutput.length)) - this.lastRms) * 0.22;
    this.blockCounter += 1;
    if (this.blockCounter % TELEMETRY_BLOCKS === 0) {
      this.port.postMessage({
        type: "telemetry",
        model: this.configuration.model,
        pressure: this.feedbackPressure,
        sections: this.activeSections,
        tractLengthM: this.activeSections * SPEED_OF_SOUND / this.waveguideRate,
        peak: this.lastPeak,
        rms: this.lastRms,
        whistleMode: this.source.whistleMode,
      });
    }
    return true;
  }
}

registerProcessor("syrinx-physical-model", SyrinxPhysicalProcessor);

export { SyrinxPhysicalProcessor };
