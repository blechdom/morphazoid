import {
  HARMONICA_HOLE_COUNT,
  HARMONICA_LIMITS,
  activeHoles,
  harmonicaBreathShiftProfile,
  harmonicaBluesRhythm,
  harmonicaMaterialProperties,
  harmonicaMouthFormants,
  harmonicaOverbendTarget,
  harmonicaReedCoupling,
  harmonicaTechnique,
  harmonicaTechniqueAllowed,
  sanitizeHarmonicaState,
} from "./harmonica.js";

const HOLE_COUNT = HARMONICA_HOLE_COUNT;
const REED_COUNT = HOLE_COUNT * 2;
const TELEMETRY_BLOCKS = 8;
const SILENCE_FLOOR = 1e-10;
const DISCRETE_KEYS = new Set([
  "presetId",
  "keyId",
  "hole",
  "chordWidth",
  "breathDirection",
  "autoBreath",
  "bluesTechniqueId",
  "bluesRhythmId",
]);
const CROSSFADED_CONFIGURATION_KEYS = new Set(["presetId", "keyId"]);
const BEND_TECHNIQUES = new Set([
  "draw-bend",
  "blow-bend",
  "draw-scoop",
  "blow-scoop",
  "dip",
  "fall",
]);
const DRAW_OCTAVE_PARTNERS = Object.freeze([3, -1, 6, 7, 8, 9, -1, -1, -1, -1]);

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function smoothstep(value) {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
}

class StateVariableBandpass {
  constructor(rate) {
    this.rate = rate;
    this.low = 0;
    this.band = 0;
    this.coefficient = 0.1;
    this.damping = 0.2;
  }

  configure(frequency, bandwidth) {
    const safeFrequency = clamp(frequency, 30, this.rate * 0.2);
    const safeBandwidth = clamp(bandwidth, 20, safeFrequency * 1.5);
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
    if (!Number.isFinite(this.band) || Math.abs(this.band) < SILENCE_FLOOR) this.band = 0;
    if (!Number.isFinite(this.low) || Math.abs(this.low) < SILENCE_FLOOR) this.low = 0;
    return this.band * Math.sqrt(this.damping);
  }
}

class HarmonicaPhysicalProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = sampleRate;
    this.configuration = sanitizeHarmonicaState(options.processorOptions?.configuration ?? {});
    this.targetConfiguration = { ...this.configuration };
    this.phases = new Float64Array(REED_COUNT);
    this.envelopes = new Float64Array(REED_COUNT);
    this.frequencies = new Float64Array(REED_COUNT);
    this.baseFrequencies = new Float64Array(REED_COUNT);
    this.reedPositions = new Float64Array(REED_COUNT);
    this.reedVelocities = new Float64Array(REED_COUNT);
    this.pairCouplings = new Float64Array(HOLE_COUNT);
    this.overbendLatches = new Float64Array(HOLE_COUNT);
    this.couplingModels = Array(REED_COUNT).fill(null);
    this.baseCouplingModels = Array(REED_COUNT).fill(null);
    this.bendTechniqueLegal = new Uint8Array(REED_COUNT);
    this.overbendTargets = Array(REED_COUNT).fill(null);
    this.holeWeights = new Float64Array(HOLE_COUNT);
    this.baseHoleWeights = new Float64Array(HOLE_COUNT);
    this.apertureHoleWeights = new Float64Array(HOLE_COUNT);
    this.openHoleIndices = [];
    this.slapHoleProfile = new Float64Array(HOLE_COUNT);
    this.mouthFiltersLeft = Array.from({ length: 3 }, () => new StateVariableBandpass(this.rate));
    this.mouthFiltersRight = Array.from({ length: 3 }, () => new StateVariableBandpass(this.rate));
    this.formantFocusWeights = new Float64Array(3);
    this.combFilterLeft = new StateVariableBandpass(this.rate);
    this.combFilterRight = new StateVariableBandpass(this.rate);
    this.coverFilterLeft = new StateVariableBandpass(this.rate);
    this.coverFilterRight = new StateVariableBandpass(this.rate);
    this.handResonatorLeft = new StateVariableBandpass(this.rate);
    this.handResonatorRight = new StateVariableBandpass(this.rate);
    this.noiseState = 0x4861726d;
    this.breathNoiseState = 0;
    this.sourceDcLeft = 0;
    this.sourceDcRight = 0;
    this.renderedSourceLeft = 0;
    this.renderedSourceRight = 0;
    this.manualBreathFlow = null;
    this.breathFlow = 0;
    this.breathPhase = 0;
    this.rhythmStepIndex = -1;
    this.rhythmOnsetPending = false;
    this.articulationArmed = true;
    this.vibratoPhase = 0;
    this.tremoloPhase = 0;
    this.techniquePhase = 0;
    this.techniqueAgeSeconds = 10;
    this.lastBreathDirection = 0;
    this.lastRequestedBreathDirection = 0;
    this.breathShiftSamplesRemaining = 0;
    this.tongueSlapEnvelope = 0;
    this.chamberBleedEnvelope = 0;
    this.holeMotionEnergy = 0;
    this.holeMotionDirection = 0;
    this.effectiveTongueBlock = this.configuration.tongueBlock;
    this.effectiveHandCup = this.configuration.handCup;
    this.handResonanceFrequencyHz = 0;
    this.handResonanceGain = 0;
    this.handLowpassLeft = 0;
    this.handLowpassRight = 0;
    this.growlNoiseState = 0;
    this.techniqueBendContour = 0;
    this.overbendActive = false;
    this.overbendReleaseActive = false;
    this.overbendGate = 0;
    this.chokedReed = "none";
    this.energy = 0;
    this.reedDisplacement = 0;
    this.activeFrequencyHz = 0;
    this.activeBendSemitones = 0;
    this.activePassiveGain = 0;
    this.lastPeak = 0;
    this.lastRms = 0;
    this.blockCounter = 0;
    this.silenced = false;
    this.presetFade = 1;
    this.presetTransition = null;
    this.material = harmonicaMaterialProperties(this.configuration);
    this.formants = harmonicaMouthFormants(this.configuration);
    this.technique = harmonicaTechnique(this.configuration.bluesTechniqueId);
    this.bluesRhythm = harmonicaBluesRhythm(this.configuration.bluesRhythmId);
    this.rhythmStepDurations = [];
    this._updateCoefficients(true);
    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      const nextConfiguration = sanitizeHarmonicaState({
        ...this.targetConfiguration,
        ...(message.configuration ?? {}),
      }, this.targetConfiguration);
      if ([...CROSSFADED_CONFIGURATION_KEYS].some(
        (key) => nextConfiguration[key] !== this.configuration[key],
      )) {
        this.presetTransition = "out";
      }
      this.targetConfiguration = nextConfiguration;
      return;
    }
    if (message.type === "breath") {
      const requested = Number(message.flow);
      this.manualBreathFlow = message.manual === false
        ? null
        : clamp(
          Number.isFinite(requested) ? requested : 0,
          HARMONICA_LIMITS.breathFlow[0],
          HARMONICA_LIMITS.breathFlow[1],
        );
      if (this.manualBreathFlow === 0) this.articulationArmed = true;
      this.silenced = false;
      return;
    }
    if (message.type === "breath-cycle-reset") {
      const phase = Number(message.phase);
      this.breathPhase = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
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
    this.silenced = true;
    this.manualBreathFlow = null;
    this.breathFlow = 0;
    this.envelopes.fill(0);
    this.reedPositions.fill(0);
    this.reedVelocities.fill(0);
    this.pairCouplings.fill(0);
    this.overbendLatches.fill(0);
    this.energy = 0;
    this.reedDisplacement = 0;
    this.activeFrequencyHz = 0;
    this.activeBendSemitones = 0;
    this.activePassiveGain = 0;
    this.breathNoiseState = 0;
    this.growlNoiseState = 0;
    this.sourceDcLeft = 0;
    this.sourceDcRight = 0;
    this.renderedSourceLeft = 0;
    this.renderedSourceRight = 0;
    this.handLowpassLeft = 0;
    this.handLowpassRight = 0;
    this.techniqueAgeSeconds = 10;
    this.rhythmStepIndex = -1;
    this.rhythmOnsetPending = false;
    this.articulationArmed = true;
    this.lastBreathDirection = 0;
    this.lastRequestedBreathDirection = 0;
    this.breathShiftSamplesRemaining = 0;
    this.tongueSlapEnvelope = 0;
    this.chamberBleedEnvelope = 0;
    this.holeMotionEnergy = 0;
    this.holeMotionDirection = 0;
    this.apertureHoleWeights.set(this.baseHoleWeights);
    this.holeWeights.set(this.baseHoleWeights);
    this.effectiveTongueBlock = this.configuration.tongueBlock;
    this.effectiveHandCup = this.configuration.handCup;
    this.handResonanceFrequencyHz = 0;
    this.handResonanceGain = 0;
    this.techniqueBendContour = 0;
    this.overbendActive = false;
    this.overbendReleaseActive = false;
    this.overbendGate = 0;
    this.chokedReed = "none";
    this.presetFade = 1;
    this.presetTransition = null;
    for (const filter of [
      ...this.mouthFiltersLeft,
      ...this.mouthFiltersRight,
      this.combFilterLeft,
      this.combFilterRight,
      this.coverFilterLeft,
      this.coverFilterRight,
      this.handResonatorLeft,
      this.handResonatorRight,
    ]) filter.reset();
  }

  _approachConfiguration(blockSize) {
    const amount = 1 - Math.exp(-blockSize / (this.rate * 0.018));
    const next = { ...this.configuration };
    let changed = false;
    for (const [key, value] of Object.entries(this.targetConfiguration)) {
      if (CROSSFADED_CONFIGURATION_KEYS.has(key) && this.presetTransition === "out") continue;
      if (CROSSFADED_CONFIGURATION_KEYS.has(key) && this.presetTransition === "swap") {
        if (next[key] !== value) {
          next[key] = value;
          changed = true;
        }
        this.presetTransition = "in";
        continue;
      }
      if (DISCRETE_KEYS.has(key) || typeof value !== "number") {
        if (next[key] !== value) {
          if (key === "hole") {
            const distance = Math.abs(value - next[key]);
            this.holeMotionDirection = Math.sign(value - next[key]);
            this.holeMotionEnergy = clamp(0.58 + distance * 0.09, 0, 1);
            this.chamberBleedEnvelope = Math.max(
              this.chamberBleedEnvelope,
              clamp(0.46 + distance * 0.08, 0, 1),
            );
          } else if (key === "chordWidth") {
            this.holeMotionEnergy = Math.max(this.holeMotionEnergy, 0.38);
          }
          next[key] = value;
          changed = true;
        }
        continue;
      }
      const difference = value - next[key];
      if (Math.abs(difference) > 1e-6) {
        next[key] += difference * amount;
        changed = true;
      } else if (difference !== 0) {
        next[key] = value;
        changed = true;
      }
    }
    if (!changed) return;
    const techniqueChanged = next.bluesTechniqueId !== this.configuration.bluesTechniqueId;
    this.configuration = sanitizeHarmonicaState(next, this.targetConfiguration);
    if (techniqueChanged) {
      this.techniqueAgeSeconds = 0;
      this.techniquePhase = 0;
      this.tongueSlapEnvelope = 0;
      this.overbendLatches.fill(0);
    }
    this._updateCoefficients();
  }

  _updateCoefficients(resetFrequencies = false) {
    const state = this.configuration;
    this.material = harmonicaMaterialProperties(state);
    this.formants = harmonicaMouthFormants(state);
    this.technique = harmonicaTechnique(state.bluesTechniqueId);
    this.bluesRhythm = harmonicaBluesRhythm(state.bluesRhythmId);
    this.breathShiftProfile = harmonicaBreathShiftProfile(state);
    const rhythmStepCount = this.bluesRhythm.steps.length;
    this.rhythmStepDurations = this.bluesRhythm.steps.map((_, index) => (
      (1 / Math.max(1, rhythmStepCount))
      * (1 + (index % 2 === 0 ? state.rhythmSwing : -state.rhythmSwing))
    ));
    const coefficientForMilliseconds = (milliseconds) => (
      milliseconds <= 0
        ? 1
        : 1 - Math.exp(-1 / (this.rate * milliseconds / 1_000))
    );
    this.breathAttackCoefficient = coefficientForMilliseconds(state.breathAttackMs);
    this.breathReleaseCoefficient = coefficientForMilliseconds(state.breathReleaseMs);
    this.slapDecay = Math.exp(-1 / (this.rate * 0.038));
    // The signed air column always crosses zero. Player slop lives around that
    // crossing as finite reed inertia and a moving lip aperture, never as
    // physically impossible simultaneous inward/outward lung pressure.
    this.breathShiftPressureCoefficient = 1 - Math.exp(
      -1 / (this.rate * this.breathShiftProfile.pressureTimeSeconds),
    );
    this.breathShiftAttackCoefficient = 1 - Math.exp(
      -1 / (this.rate * this.breathShiftProfile.reedAttackSeconds),
    );
    this.breathShiftReleaseCoefficient = 1 - Math.exp(
      -1 / (this.rate * this.breathShiftProfile.reedTailSeconds),
    );
    this.holeSlideCoefficient = 1 - Math.exp(
      -1 / (this.rate * this.breathShiftProfile.holeSlideSeconds),
    );
    this.holeMotionDecay = Math.exp(
      -1 / (this.rate * (0.026 + this.breathShiftProfile.holeSlideSeconds * 1.05)),
    );
    this.chamberBleedDecay = Math.exp(
      -1 / (this.rate * (0.018 + this.breathShiftProfile.amount * 0.042)),
    );
    this.pitchApproach = 1 - Math.exp(-1 / (this.rate * 0.0045));
    this.pairApproach = 1 - Math.exp(-1 / (this.rate * 0.007));
    this.chokeCloseCoefficient = 1 - Math.exp(-1 / (this.rate * 0.002));
    this.overbendOpenCoefficient = 1 - Math.exp(-1 / (this.rate * 0.0025));
    this.presetFadeCoefficient = 1 - Math.exp(-1 / (this.rate * 0.0045));
    this.effectiveStiffness = Math.max(
      0.08,
      state.reedStiffness * this.material.stiffnessScale,
    );
    const stiffnessRoot = Math.sqrt(this.effectiveStiffness);
    this.pressureLeakScale = 1 - state.airLeak * 0.82;
    this.pressureThreshold = 0.014 + state.reedGap
      * (0.038 + this.effectiveStiffness * 0.014)
      / Math.max(0.35, this.material.flowResponse);
    this.pressureDriveScale = (2.15 + this.material.flowResponse * 1.85) / stiffnessRoot;
    this.pressureFactorScale = (2.4 + this.material.flowResponse) / stiffnessRoot;
    const reedAttackSeconds = (
      0.0022 + state.reedGap * 0.0062 + this.effectiveStiffness * 0.0015
    )
      / Math.max(0.32, this.material.flowResponse * Math.sqrt(this.material.stiffnessScale))
      * (0.92 + this.material.lossScale * 0.08);
    const reedReleaseSeconds = (
      0.026 + state.reedStiffness * 0.034 + state.reedGap * 0.006
    ) / (0.56 + this.material.lossScale * 0.68);
    this.reedAttackCoefficient = 1 - Math.exp(-1 / (this.rate * reedAttackSeconds));
    this.reedReleaseCoefficient = 1 - Math.exp(-1 / (this.rate * reedReleaseSeconds));
    this.baseHoleWeights.fill(0);
    const holes = activeHoles(state);
    this.openHoleIndices = holes.map((hole) => hole - 1);
    const center = (holes.length - 1) * 0.5;
    holes.forEach((hole, index) => {
      this.baseHoleWeights[hole - 1] = Math.exp(
        -Math.pow((index - center) / Math.max(0.8, holes.length * 0.56), 2),
      );
    });
    if (resetFrequencies) this.apertureHoleWeights.set(this.baseHoleWeights);
    for (let index = 0; index < HOLE_COUNT; index += 1) {
      this.slapHoleProfile[index] = Math.exp(
        -Math.pow((index - (state.hole - 1)) / 1.28, 2),
      );
    }
    this.holeWeights.set(this.baseHoleWeights);
    const technique = this.technique;
    for (let hole = 1; hole <= HOLE_COUNT; hole += 1) {
      for (const direction of [1, -1]) {
        const reedIndex = (direction < 0 ? HOLE_COUNT : 0) + hole - 1;
        const techniqueOwnsBend = BEND_TECHNIQUES.has(technique.id)
          && harmonicaTechniqueAllowed(state, hole, direction);
        this.bendTechniqueLegal[reedIndex] = techniqueOwnsBend ? 1 : 0;
        const baseState = techniqueOwnsBend ? { ...state, bend: 0 } : state;
        const fullState = techniqueOwnsBend
          ? { ...state, bend: clamp(state.bend * state.techniqueAmount, 0, 1.5) }
          : state;
        const baseModel = harmonicaReedCoupling(baseState, hole, direction);
        const model = harmonicaReedCoupling(fullState, hole, direction);
        this.baseCouplingModels[reedIndex] = baseModel;
        this.couplingModels[reedIndex] = model;
        this.overbendTargets[reedIndex] = harmonicaOverbendTarget(state, hole, direction);
        this.baseFrequencies[reedIndex] = baseModel.baseFrequencyHz;
        if (resetFrequencies || !(this.frequencies[reedIndex] > 0)) {
          this.frequencies[reedIndex] = baseModel.baseFrequencyHz;
        }
      }
    }
    for (let index = 0; index < 3; index += 1) {
      this.mouthFiltersLeft[index].configure(
        this.formants.frequenciesHz[index] * (0.994 - index * 0.002),
        this.formants.bandwidthsHz[index],
      );
      this.mouthFiltersRight[index].configure(
        this.formants.frequenciesHz[index] * (1.006 + index * 0.002),
        this.formants.bandwidthsHz[index],
      );
    }
    const formantFocus = clamp(
      Math.log2(Math.max(55, this.formants.bendTargetHz) / 55) / Math.log2(2_800 / 55),
    ) * 2;
    for (let index = 0; index < 3; index += 1) {
      this.formantFocusWeights[index] = 0.28
        + 1.5 * Math.exp(-Math.abs(index - formantFocus) * 1.4);
    }
    const combFrequency = clamp(
      330 + state.reedGap * 155 + this.material.stiffnessScale * 115,
      180,
      1_250,
    );
    const coverFrequency = clamp(
      1_340 + state.brightness * 710 + this.material.stiffnessScale * 420,
      720,
      5_800,
    );
    const combBandwidth = 150 + this.material.lossScale * 230 + state.airLeak * 310;
    const coverBandwidth = 430 + this.material.lossScale * 690 + state.reedGap * 95;
    this.combFilterLeft.configure(combFrequency * 0.992, combBandwidth);
    this.combFilterRight.configure(combFrequency * 1.008, combBandwidth * 1.03);
    this.coverFilterLeft.configure(coverFrequency * 0.996, coverBandwidth);
    this.coverFilterRight.configure(coverFrequency * 1.004, coverBandwidth * 1.025);
  }

  _advancePresetFade() {
    const coefficient = this.presetFadeCoefficient;
    if (this.presetTransition === "out") {
      this.presetFade += (0 - this.presetFade) * coefficient;
      if (this.presetFade < 0.002) {
        this.presetFade = 0;
        this.presetTransition = "swap";
      }
    } else if (this.presetTransition === "in") {
      this.presetFade += (1 - this.presetFade) * coefficient;
      if (this.presetFade > 0.998) {
        this.presetFade = 1;
        this.presetTransition = null;
      }
    }
    return this.presetFade;
  }

  _techniqueIsLegal(direction, hole) {
    const technique = this.technique;
    return (technique.direction === 0 || technique.direction === direction)
      && (technique.holes.length === 0 || technique.holes.includes(hole));
  }

  _bendContour() {
    const state = this.configuration;
    const id = state.bluesTechniqueId;
    if (!BEND_TECHNIQUES.has(id)) return 0;
    const age = this.techniqueAgeSeconds;
    const rate = Math.max(0.1, state.techniqueRateHz);
    if (id === "draw-bend" || id === "blow-bend") return 1;
    if (id === "draw-scoop" || id === "blow-scoop") {
      return 1 - smoothstep(age / clamp(0.75 / rate, 0.06, 0.42));
    }
    if (id === "dip") {
      const duration = clamp(1.25 / rate, 0.1, 0.6);
      return age < duration ? Math.sin(Math.PI * age / duration) : 0;
    }
    if (id === "fall") {
      return smoothstep((age - 0.035) / clamp(0.9 / rate, 0.08, 0.5));
    }
    return 0;
  }

  _updateTechniqueHoleWeights(direction, effectiveTongueBlock = this.configuration.tongueBlock) {
    const state = this.configuration;
    const id = state.bluesTechniqueId;
    for (let index = 0; index < HOLE_COUNT; index += 1) {
      const target = this.baseHoleWeights[index];
      const difference = target - this.apertureHoleWeights[index];
      this.apertureHoleWeights[index] += difference * this.holeSlideCoefficient;
      if (Math.abs(difference) < 1e-8) this.apertureHoleWeights[index] = target;
    }
    this.holeWeights.set(this.apertureHoleWeights);
    this.holeMotionEnergy *= this.holeMotionDecay;
    if (this.holeMotionEnergy < SILENCE_FLOOR) this.holeMotionEnergy = 0;

    const openHoles = this.openHoleIndices;
    if (effectiveTongueBlock > 0 && openHoles.length > 1) {
      const attenuation = 1 - effectiveTongueBlock * 0.94;
      const anchor = state.hole - 1;
      for (const holeIndex of openHoles) {
        if (holeIndex !== anchor) this.holeWeights[holeIndex] *= attenuation;
      }
      this.holeWeights[anchor] += (1 - this.holeWeights[anchor]) * effectiveTongueBlock;
    }

    const center = state.hole - 1;
    if (id === "shake-warble") {
      const neighbor = center >= HOLE_COUNT - 1 ? center - 1 : center + 1;
      const wet = clamp(state.techniqueAmount, 0, 1);
      const blend = 0.5 - 0.5 * Math.cos(Math.PI * 2 * this.techniquePhase);
      for (let index = 0; index < HOLE_COUNT; index += 1) {
        this.holeWeights[index] *= 1 - wet;
      }
      this.holeWeights[center] += wet * Math.cos(blend * Math.PI * 0.5);
      this.holeWeights[neighbor] += wet * Math.sin(blend * Math.PI * 0.5);
    }

    if (id === "octave-tongue-block") {
      const octave = direction < 0
        ? DRAW_OCTAVE_PARTNERS[center]
        : (center <= 6 ? center + 3 : -1);
      const wet = clamp(state.techniqueAmount * Math.max(0.2, effectiveTongueBlock), 0, 1);
      this.holeWeights[center] = Math.max(this.holeWeights[center], 1);
      if (octave >= 0) {
        this.holeWeights[octave] = Math.max(this.holeWeights[octave], wet);
        const first = Math.min(center, octave);
        const last = Math.max(center, octave);
        for (let index = first + 1; index < last; index += 1) {
          this.holeWeights[index] *= 1 - effectiveTongueBlock;
        }
      }
    }

    if (this.tongueSlapEnvelope > 1e-6) {
      for (let index = 0; index < HOLE_COUNT; index += 1) {
        const chord = this.slapHoleProfile[index];
        this.holeWeights[index] = Math.max(
          this.holeWeights[index],
          chord * this.tongueSlapEnvelope,
        );
      }
    }

    // A breath onset or lateral slide briefly exposes the chamber dividers.
    // This is tonal reed bleed—adjacent pitched chambers—not a noise burst.
    const growlBleed = clamp(state.growl / 2) * 0.32;
    const tongueSeal = 1 - effectiveTongueBlock * 0.9;
    const chamberBleed = clamp(
      this.chamberBleedEnvelope
        * this.breathShiftProfile.chamberBleed
        * (1 + growlBleed)
        * tongueSeal,
      0,
      0.32,
    );
    if (chamberBleed > SILENCE_FLOOR) {
      const anchor = state.hole - 1;
      for (const neighbor of [anchor - 1, anchor + 1]) {
        if (neighbor < 0 || neighbor >= HOLE_COUNT) continue;
        this.holeWeights[neighbor] = Math.max(
          this.holeWeights[neighbor],
          chamberBleed,
        );
      }
    }
  }

  _automaticBreathFlow() {
    const state = this.configuration;
    if (!state.autoBreath) return 0;
    const phase = this.breathPhase;
    this.breathPhase += state.breathRateBpm / (60 * this.rate);
    if (this.breathPhase >= 1) this.breathPhase -= Math.floor(this.breathPhase);
    const steps = this.bluesRhythm.steps;
    if (steps.length === 0) {
      this.rhythmStepIndex = -1;
      this.rhythmOnsetPending = false;
      if (phase < state.breathBalance) {
        return -state.breathPressure * Math.sin(Math.PI * phase / state.breathBalance);
      }
      return state.breathPressure
        * Math.sin(Math.PI * (phase - state.breathBalance) / (1 - state.breathBalance));
    }
    let start = 0;
    let stepIndex = steps.length - 1;
    for (let index = 0; index < steps.length; index += 1) {
      const duration = this.rhythmStepDurations[index];
      if (phase < start + duration || index === steps.length - 1) {
        stepIndex = index;
        break;
      }
      start += duration;
    }
    const velocity = steps[stepIndex];
    if (stepIndex !== this.rhythmStepIndex) {
      this.rhythmOnsetPending = velocity !== 0;
    }
    this.rhythmStepIndex = stepIndex;
    if (velocity === 0) return 0;
    const duration = this.rhythmStepDurations[stepIndex];
    const local = clamp((phase - start) / Math.max(1e-9, duration));
    // A short closed tail separates repeated same-direction attacks and gives
    // paired reeds time to release before a polarity reversal.
    if (local >= 0.8) return 0;
    return state.breathPressure * velocity;
  }

  _renderReeds() {
    const state = this.configuration;
    if (this.manualBreathFlow !== null) {
      this.rhythmStepIndex = -1;
      this.rhythmOnsetPending = false;
    }
    const targetFlow = this.manualBreathFlow ?? this._automaticBreathFlow();
    const requestedDirection = Math.abs(targetFlow) > 1e-7
      ? Math.sign(targetFlow)
      : 0;
    if (
      !this.silenced
      && requestedDirection !== 0
      && this.lastRequestedBreathDirection !== 0
      && requestedDirection !== this.lastRequestedBreathDirection
    ) {
      this.breathShiftSamplesRemaining = Math.max(
        this.breathShiftSamplesRemaining,
        Math.round(
          Math.max(
            this.breathShiftProfile.reedTailSeconds,
            state.breathReleaseMs / 1_000 * 1.12,
          ) * this.rate,
        ),
      );
    }
    if (requestedDirection !== 0) {
      this.lastRequestedBreathDirection = requestedDirection;
    }
    const breathShiftActive = this.breathShiftSamplesRemaining > 0;
    if (this.silenced) {
      this.breathFlow = 0;
    } else {
      const sameDirection = this.breathFlow === 0
        || targetFlow === 0
        || Math.sign(targetFlow) === Math.sign(this.breathFlow);
      const increasing = sameDirection && Math.abs(targetFlow) > Math.abs(this.breathFlow);
      const ordinaryCoefficient = increasing
        ? this.breathAttackCoefficient
        : this.breathReleaseCoefficient;
      const coefficient = breathShiftActive
        ? Math.min(
          ordinaryCoefficient,
          this.breathShiftPressureCoefficient,
        )
        : ordinaryCoefficient;
      this.breathFlow += (targetFlow - this.breathFlow) * coefficient;
    }
    if (Math.abs(this.breathFlow) < 1e-7 && Math.abs(targetFlow) < 1e-7) this.breathFlow = 0;
    const flow = clamp(
      this.breathFlow,
      HARMONICA_LIMITS.breathFlow[0],
      HARMONICA_LIMITS.breathFlow[1],
    );
    const magnitude = Math.abs(flow);
    const direction = magnitude < 1e-8 ? state.breathDirection : (flow < 0 ? -1 : 1);
    const pressure = magnitude * this.pressureLeakScale;
    const excessPressure = Math.max(0, pressure - this.pressureThreshold);
    let drive = Math.tanh(excessPressure * this.pressureDriveScale);
    const pressureFactor = clamp(
      1 - Math.exp(-excessPressure * this.pressureFactorScale),
    );
    if (Math.abs(targetFlow) < 1e-7) this.articulationArmed = true;
    const soundingDirection = drive > 0.002 ? direction : 0;
    const targetDirection = Math.abs(targetFlow) > 1e-7 ? Math.sign(targetFlow) : 0;
    const onset = soundingDirection !== 0 && (
      soundingDirection !== this.lastBreathDirection
      || (this.rhythmOnsetPending && targetDirection === soundingDirection)
      || (this.articulationArmed && targetDirection === soundingDirection)
    );
    if (onset) {
      this.rhythmOnsetPending = false;
      this.articulationArmed = false;
      this.techniqueAgeSeconds = 0;
      this.chamberBleedEnvelope = Math.max(
        this.chamberBleedEnvelope,
        clamp(
          0.34
            + this.breathShiftProfile.amount * 0.42
            + clamp(state.growl / 2) * 0.16,
          0,
          0.92,
        ),
      );
      if (state.bluesTechniqueId === "tongue-slap") {
        this.tongueSlapEnvelope = clamp(state.techniqueAmount, 0, 2);
      } else if (state.bluesTechniqueId === "train-chug") {
        this.tongueSlapEnvelope = clamp(state.techniqueAmount * 0.56, 0, 1.2);
      }
    } else if (soundingDirection !== 0) {
      this.techniqueAgeSeconds += 1 / this.rate;
    }
    if (soundingDirection !== 0) this.lastBreathDirection = soundingDirection;
    else if (Math.abs(targetFlow) < 1e-5) this.lastBreathDirection = 0;
    this.techniquePhase = (
      this.techniquePhase + state.techniqueRateHz / this.rate
    ) % 1;
    const techniqueWave = Math.sin(Math.PI * 2 * this.techniquePhase);
    const techniquePulse = 0.5 + 0.5 * techniqueWave;
    const tonguePulse = 0.5 + 0.5 * Math.sin(
      Math.PI * 2 * this.techniquePhase + Math.PI * 0.36,
    );
    const authoredCupMotion = clamp(state.cupMotionDepth);
    const techniqueCupMotion = state.bluesTechniqueId === "hand-wah"
      ? clamp(state.techniqueAmount)
      : 0;
    const cupMotionDepth = clamp(
      authoredCupMotion + techniqueCupMotion * (1 - authoredCupMotion),
    );
    const authoredTongueMotion = clamp(state.tongueMotionDepth);
    const techniqueTongueMotion = state.bluesTechniqueId === "flutter"
      ? clamp(state.techniqueAmount)
      : 0;
    const tongueMotionDepth = clamp(
      authoredTongueMotion + techniqueTongueMotion * (1 - authoredTongueMotion),
    );
    this.effectiveHandCup = clamp(
      state.handCup * (1 - cupMotionDepth * 0.92 * (1 - techniquePulse)),
    );
    // Tongue motion opens around the authored closure rather than erasing it.
    // Flutter can still articulate a single clean hole by introducing a small,
    // rapidly moving occlusion even when the static tongue-block value is zero.
    this.effectiveTongueBlock = clamp(
      state.tongueBlock * (1 - tongueMotionDepth * 0.84 * (1 - tonguePulse))
        + techniqueTongueMotion * tonguePulse * 0.34 * (1 - state.tongueBlock),
    );
    this.tongueSlapEnvelope *= this.slapDecay;
    if (this.tongueSlapEnvelope < SILENCE_FLOOR) this.tongueSlapEnvelope = 0;
    this._updateTechniqueHoleWeights(direction, this.effectiveTongueBlock);
    // A moving comb leaks and sheds a little pressure at the chamber divider.
    // Keep the disturbance subtle: the overlapping reeds provide the audible
    // slide, while this prevents the transition from feeling digitally exact.
    drive *= 1 - this.holeMotionEnergy * 0.075;
    const attack = breathShiftActive
      ? Math.min(this.reedAttackCoefficient, this.breathShiftAttackCoefficient)
      : this.reedAttackCoefficient;
    const release = breathShiftActive
      ? Math.min(this.reedReleaseCoefficient, this.breathShiftReleaseCoefficient)
      : this.reedReleaseCoefficient;
    const pitchApproach = this.pitchApproach;
    const pairApproach = this.pairApproach;
    this.vibratoPhase = (this.vibratoPhase + state.vibratoRateHz / this.rate) % 1;
    this.tremoloPhase = (this.tremoloPhase + state.tremoloRateHz / this.rate) % 1;
    const tongueOcclusion = this.effectiveTongueBlock * 0.3;
    this.radiationCup = clamp(this.effectiveHandCup + tongueOcclusion, 0, 1);
    const handCutoffHz = 380 + Math.pow(1 - this.radiationCup, 2) * 9_400;
    this.handFilterCoefficient = 1 - Math.exp(-Math.PI * 2 * handCutoffHz / this.rate);
    // The cover hand is also a small, leaky Helmholtz cavity. Closing it lowers
    // and sharpens a moving resonance; opening it raises and broadens that peak.
    // Keeping filter state between coefficient moves produces the audible wah
    // sweep without rebuilding or hard-switching the signal path.
    const handOpening = 1 - this.effectiveHandCup;
    this.handResonanceFrequencyHz = 460 + Math.pow(handOpening, 1.35) * 2_760;
    const handResonanceBandwidthHz = 105 + Math.pow(handOpening, 0.72) * 1_180;
    this.handResonanceGain = this.effectiveHandCup
      * (0.2 + this.effectiveHandCup * 0.34)
      * (1 + cupMotionDepth * 0.16);
    this.handResonatorLeft.configure(
      this.handResonanceFrequencyHz * 0.992,
      handResonanceBandwidthHz,
    );
    this.handResonatorRight.configure(
      this.handResonanceFrequencyHz * 1.008,
      handResonanceBandwidthHz * 1.04,
    );
    this.tongueRadiationGain = 1 - this.effectiveTongueBlock * 0.11;
    if (state.bluesTechniqueId === "flutter") {
      drive *= clamp(1 - state.techniqueAmount * 0.62 * techniquePulse, 0.08, 1);
    } else if (state.bluesTechniqueId === "throat-vibrato") {
      drive *= clamp(1 - state.techniqueAmount * 0.14 * techniquePulse, 0.58, 1);
    }
    let vibratoSemitones = Math.sin(Math.PI * 2 * this.vibratoPhase)
      * state.vibratoDepth * Math.sqrt(clamp(magnitude / 3));
    if (state.bluesTechniqueId === "throat-vibrato") {
      vibratoSemitones += techniqueWave
        * state.techniqueAmount * 0.42 * Math.sqrt(clamp(magnitude / 3));
    }
    const pitchMotion = Math.pow(2, vibratoSemitones / 12);
    const tremolo = 1 - state.tremoloDepth * 0.5
      + Math.sin(Math.PI * 2 * this.tremoloPhase) * state.tremoloDepth * 0.5;
    const growlAmount = clamp(
      state.growl + (state.bluesTechniqueId === "growl" ? state.techniqueAmount * 0.45 : 0),
      0,
      2,
    );
    this.growlNoiseState += (this._random() - this.growlNoiseState) * 0.012;
    const growlWave = techniqueWave * 0.72
      + Math.sin(Math.PI * 6 * this.techniquePhase + 0.31) * 0.2
      + this.growlNoiseState * 0.26;
    const growlAmplitude = clamp(1 + growlWave * growlAmount * 0.24, 0.38, 1.62);
    // A vocal growl roughens phase and upper partial balance as well as level.
    // These bounded sidebands make the effect read as throat/reed interaction
    // rather than broadband distortion.
    const growlPhaseWarp = growlWave * growlAmount * 0.052;
    const growlTwang = growlAmount * (0.014 + state.brightness * 0.012);
    let left = 0;
    let right = 0;
    let displacement = 0;
    let energy = 0;
    let weightedFrequency = 0;
    let frequencyWeight = 0;
    let weightedBend = 0;
    let weightedPassiveGain = 0;
    let maximumBendContour = 0;
    let maximumOverbendGate = 0;
    let anyOverbendRelease = false;
    let activeChoke = "none";
    const primaryOffset = direction < 0 ? HOLE_COUNT : 0;
    const opposingOffset = direction < 0 ? 0 : HOLE_COUNT;
    const saturation = 1.15 + this.material.saturation * 1.5 + pressure * 0.5;
    const harmonicRetention = clamp(
      1 / (0.72 + this.material.lossScale * 0.28),
      0.58,
      1.18,
    );
    const secondAmount = (0.1 + state.brightness * 0.09)
      * this.material.brightness * harmonicRetention;
    const thirdAmount = (0.038 + state.brightness * 0.052)
      * this.material.brightness * harmonicRetention * harmonicRetention;
    let aperturePower = 0;
    for (const weight of this.holeWeights) aperturePower += weight * weight;
    const apertureNormalization = 1 / Math.sqrt(Math.max(1, aperturePower));
    const bendGestureContour = this._bendContour();

    for (let holeIndex = 0; holeIndex < HOLE_COUNT; holeIndex += 1) {
      const selected = this.holeWeights[holeIndex];
      const primaryIndex = primaryOffset + holeIndex;
      const opposingIndex = opposingOffset + holeIndex;
      const model = this.couplingModels[primaryIndex];
      const baseModel = this.baseCouplingModels[primaryIndex];
      const bendContour = this.bendTechniqueLegal[primaryIndex]
        ? bendGestureContour
        : 0;
      maximumBendContour = Math.max(maximumBendContour, bendContour * selected);
      const baseBendAtFullPressure = baseModel.normalBendAtFullPressure
        + baseModel.extensionBendAtFullPressure;
      const techniqueBendAtFullPressure = model.normalBendAtFullPressure
        + model.extensionBendAtFullPressure;
      const bendSemitones = (
        baseBendAtFullPressure
        + (techniqueBendAtFullPressure - baseBendAtFullPressure) * bendContour
      ) * pressureFactor;
      const pressureDetuneCents = pressureFactor
        * (direction < 0 ? -4.5 : 3)
        / Math.sqrt(Math.max(0.2, state.reedStiffness));
      const primaryTargetFrequency = baseModel.baseFrequencyHz
        * Math.pow(2, (-bendSemitones + pressureDetuneCents / 100) / 12);
      if (onset
        && (state.bluesTechniqueId === "draw-scoop" || state.bluesTechniqueId === "blow-scoop")
        && selected > 0) {
        this.frequencies[primaryIndex] = primaryTargetFrequency;
      }
      const passiveGainAtFullPressure = baseModel.passiveGainAtFullPressure
        + (model.passiveGainAtFullPressure - baseModel.passiveGainAtFullPressure)
          * bendContour;
      let passiveGainTarget = passiveGainAtFullPressure * pressureFactor * drive;

      const overbendTarget = this.overbendTargets[primaryIndex];
      const overbendTechnique = (state.bluesTechniqueId === "overblow" && direction > 0)
        || (state.bluesTechniqueId === "overdraw" && direction < 0);
      // The raw control addresses the physical reed-choke mechanism directly;
      // a technique preset is convenient setup, not a hidden prerequisite.
      const legalOverbend = overbendTarget?.legal
        && selected > 1e-5
        && state.chordWidth === 1
        && holeIndex === state.hole - 1;
      const overbendCommand = legalOverbend
        ? state.overbend * pressureFactor
          * (0.72 + clamp(state.vocalTractCoupling / 2) * 0.28)
        : 0;
      let overbendMode = this.overbendLatches[holeIndex]; // 0 normal, 1 speaking, 2 release
      const wasOverbending = overbendMode === 1;
      if (overbendMode === 0 && overbendCommand >= 0.52) {
        overbendMode = 1;
      } else if (overbendMode === 1 && overbendCommand <= 0.34) {
        overbendMode = 2;
      } else if (overbendMode === 2 && overbendCommand >= 0.52) {
        overbendMode = 1;
      } else if (overbendMode === 2 && this.envelopes[opposingIndex] < 0.012) {
        overbendMode = 0;
        this.frequencies[opposingIndex] = baseModel.opposingFrequencyHz;
      }
      this.overbendLatches[holeIndex] = overbendMode;
      // Once the pressure/reed-gap threshold is crossed, reed primacy swaps
      // discontinuously. Command above the threshold changes stability/level,
      // never the overbend pitch or the identity of the speaking reed.
      const overbendGate = overbendMode === 1 ? 1 : 0;
      const overbendReleasing = overbendMode === 2;
      const speakingGate = overbendGate > 0 || overbendReleasing ? 1 : 0;
      const overbendStrength = overbendGate > 0
        ? clamp(
          (0.74 + (overbendCommand - 0.52) * 0.34)
            * (overbendTechnique ? 0.72 + state.techniqueAmount * 0.28 : 1),
          0.62,
          1,
        )
        : 0;
      if (speakingGate > 0) {
        passiveGainTarget = 0;
        if (overbendGate > 0) {
          maximumOverbendGate = Math.max(maximumOverbendGate, selected);
          activeChoke = direction < 0 ? "draw" : "blow";
        }
        if (overbendReleasing) anyOverbendRelease = true;
        if (!wasOverbending && overbendMode === 1) {
          this.frequencies[opposingIndex] = overbendTarget.frequencyHz;
        }
      }
      this.pairCouplings[holeIndex] += (
        passiveGainTarget - this.pairCouplings[holeIndex]
      ) * pairApproach;
      const pairCoupling = this.pairCouplings[holeIndex];
      const passivePullCents = Math.min(44, bendSemitones * 7 + pairCoupling * 32);
      const normalOpposingFrequency = baseModel.opposingFrequencyHz
        * Math.pow(2, passivePullCents / 1_200);
      const opposingTargetFrequency = speakingGate > 0
        ? overbendTarget.frequencyHz
        : normalOpposingFrequency;
      this.frequencies[primaryIndex] += (
        primaryTargetFrequency - this.frequencies[primaryIndex]
      ) * pitchApproach;
      this.frequencies[opposingIndex] += (
        opposingTargetFrequency - this.frequencies[opposingIndex]
      ) * pitchApproach;

      const primaryTarget = selected * drive
        * (1 - pairCoupling * 0.18)
        * (1 - speakingGate * 0.998);
      const chokeReady = this.envelopes[primaryIndex] < Math.max(0.015, selected * drive * 0.1);
      const opposingTarget = overbendGate > 0
        ? (chokeReady ? selected * drive * overbendStrength : 0)
        : (overbendReleasing ? 0 : selected * drive * pairCoupling);
      let primaryEnvelopeCoefficient = primaryTarget > this.envelopes[primaryIndex]
        ? attack
        : release;
      let opposingEnvelopeCoefficient = opposingTarget > this.envelopes[opposingIndex]
        ? attack
        : release;
      if (speakingGate > 0) {
        primaryEnvelopeCoefficient = Math.max(
          primaryEnvelopeCoefficient,
          this.chokeCloseCoefficient,
        );
        opposingEnvelopeCoefficient = Math.max(
          opposingEnvelopeCoefficient,
          this.overbendOpenCoefficient,
        );
      }
      this.envelopes[primaryIndex] += (
        primaryTarget - this.envelopes[primaryIndex]
      ) * primaryEnvelopeCoefficient;
      this.envelopes[opposingIndex] += (
        opposingTarget - this.envelopes[opposingIndex]
      ) * opposingEnvelopeCoefficient;
      if (Math.abs(this.envelopes[primaryIndex]) < SILENCE_FLOOR && primaryTarget === 0) {
        this.envelopes[primaryIndex] = 0;
      }
      if (Math.abs(this.envelopes[opposingIndex]) < SILENCE_FLOOR && opposingTarget === 0) {
        this.envelopes[opposingIndex] = 0;
      }
      this.phases[primaryIndex] = (
        this.phases[primaryIndex]
        + Math.PI * 2 * this.frequencies[primaryIndex] * pitchMotion / this.rate
      ) % (Math.PI * 2);
      this.phases[opposingIndex] = (
        this.phases[opposingIndex]
        + Math.PI * 2 * this.frequencies[opposingIndex] * pitchMotion / this.rate
      ) % (Math.PI * 2);

      const primaryFrequency = this.frequencies[primaryIndex] * pitchMotion;
      const opposingFrequency = this.frequencies[opposingIndex] * pitchMotion;
      const primaryEnvelope = this.envelopes[primaryIndex];
      const opposingEnvelope = this.envelopes[opposingIndex];
      if (
        primaryFrequency >= this.rate * 0.44
        && opposingFrequency >= this.rate * 0.44
      ) continue;
      const primaryPhase = this.phases[primaryIndex];
      const opposingPhase = this.phases[opposingIndex];
      const primaryNeutral = Math.sin(primaryPhase + growlPhaseWarp);
      // The passive tongue is mounted in the opposite orientation.
      const opposingNeutral = -Math.sin(opposingPhase - growlPhaseWarp * 0.78);
      const primaryMotion = primaryNeutral * primaryEnvelope;
      const opposingMotion = opposingNeutral * opposingEnvelope;
      this.reedVelocities[primaryIndex] = primaryMotion - this.reedPositions[primaryIndex];
      this.reedVelocities[opposingIndex] = opposingMotion - this.reedPositions[opposingIndex];
      this.reedPositions[primaryIndex] = primaryMotion;
      this.reedPositions[opposingIndex] = opposingMotion;
      const pairFeedback = (opposingMotion - primaryMotion)
        * pairCoupling * (0.22 + model.tractAlignment * 0.22);
      const orientation = direction < 0 ? -1 : 1;
      const primaryPulse = Math.tanh((
        primaryNeutral
        + pairFeedback
        + Math.sin(primaryPhase * 2 + orientation * 0.16) * secondAmount
        + Math.sin(primaryPhase * 3 - orientation * 0.22 + growlPhaseWarp * 1.7)
          * (thirdAmount + growlTwang)
      ) * saturation) / saturation;
      const opposingPulse = Math.tanh((
        opposingNeutral
        - pairFeedback * 0.58
        + Math.sin(opposingPhase * 2 - orientation * 0.12) * secondAmount * 0.82
        + Math.sin(opposingPhase * 3 + orientation * 0.2 - growlPhaseWarp * 1.25)
          * (thirdAmount * 0.72 + growlTwang * 0.58)
      ) * saturation) / saturation;
      const reedGain = tremolo
        * (0.68 + state.brightness * 0.23)
        * this.material.brightness
        * growlAmplitude;
      const reed = (
        primaryPulse * primaryEnvelope
        + opposingPulse * opposingEnvelope
      ) * reedGain;
      const position = holeIndex / (HOLE_COUNT - 1) * 2 - 1;
      const pan = position * state.stereoSpread;
      left += reed * Math.sqrt((1 - pan) * 0.5);
      right += reed * Math.sqrt((1 + pan) * 0.5);
      displacement += primaryMotion + opposingMotion * 0.36;
      energy += primaryEnvelope * primaryEnvelope + opposingEnvelope * opposingEnvelope;
      const activeEnvelope = primaryEnvelope * (1 - speakingGate)
        + opposingEnvelope * speakingGate;
      const activeWeight = selected * activeEnvelope;
      const speakingFrequency = primaryFrequency * (1 - speakingGate)
        + opposingFrequency * speakingGate;
      weightedFrequency += speakingFrequency * activeWeight;
      weightedBend += bendSemitones * activeWeight;
      weightedPassiveGain += pairCoupling * activeWeight;
      frequencyWeight += activeWeight;
    }

    const rawNoise = this._random();
    const noiseColor = clamp(0.08 + state.airLeak * 0.45 + state.brightness * 0.08, 0.03, 0.72);
    this.breathNoiseState += (rawNoise - this.breathNoiseState) * noiseColor;
    const breathNoise = (this.breathNoiseState * 0.72 + rawNoise * 0.28)
      * magnitude * (0.012 + state.airLeak * 0.13) * (0.25 + drive * 0.75);
    const directionalNoise = direction < 0 ? -breathNoise * 0.92 : breathNoise;
    left += directionalNoise;
    right += directionalNoise * 0.97;
    const slideNoise = (rawNoise * 0.42 + this.breathNoiseState * 0.58)
      * magnitude * this.holeMotionEnergy * (0.018 + state.airLeak * 0.035);
    left += slideNoise * (this.holeMotionDirection < 0 ? 1 : 0.82);
    right += slideNoise * (this.holeMotionDirection > 0 ? 1 : 0.82);
    if (this.tongueSlapEnvelope > 0) {
      const slapNoise = (
        rawNoise * 0.72 + this.breathNoiseState * 0.28
      ) * drive * this.tongueSlapEnvelope * 0.11;
      left += slapNoise;
      right += slapNoise * 0.88;
    }
    this.reedDisplacement += (displacement - this.reedDisplacement) * 0.035;
    this.energy += (Math.sqrt(energy) - this.energy) * 0.0024;
    this.activeFrequencyHz = frequencyWeight > 1e-9 ? weightedFrequency / frequencyWeight : 0;
    this.activeBendSemitones = frequencyWeight > 1e-9 ? weightedBend / frequencyWeight : 0;
    this.activePassiveGain = frequencyWeight > 1e-9
      ? weightedPassiveGain / frequencyWeight
      : 0;
    this.techniqueBendContour = maximumBendContour;
    this.overbendGate = maximumOverbendGate;
    this.overbendActive = maximumOverbendGate > 0.5;
    this.overbendReleaseActive = anyOverbendRelease;
    this.chokedReed = this.overbendActive ? activeChoke : "none";
    const presetFade = this._advancePresetFade();
    this.renderedSourceLeft = left * apertureNormalization * presetFade;
    this.renderedSourceRight = right * apertureNormalization * presetFade;
    this.chamberBleedEnvelope *= this.chamberBleedDecay;
    if (this.chamberBleedEnvelope < SILENCE_FLOOR) this.chamberBleedEnvelope = 0;
    if (this.breathShiftSamplesRemaining > 0) this.breathShiftSamplesRemaining -= 1;
  }

  _radiate(source, side) {
    const state = this.configuration;
    const filters = side < 0 ? this.mouthFiltersLeft : this.mouthFiltersRight;
    const combFilter = side < 0 ? this.combFilterLeft : this.combFilterRight;
    const coverFilter = side < 0 ? this.coverFilterLeft : this.coverFilterRight;
    const handCup = this.effectiveHandCup;
    let cavity = 0;
    for (let index = 0; index < 3; index += 1) {
      const cupFormantWeight = index === 0
        ? 1 + handCup * 0.68
        : index === 1
          ? 1 + handCup * 0.16
          : 1 - handCup * 0.42;
      cavity += filters[index].process(source)
        * this.formantFocusWeights[index]
        * cupFormantWeight;
    }
    const coupling = state.vocalTractCoupling;
    const normal = Math.min(1, coupling);
    const overCoupled = 1 + Math.max(0, coupling - 1) * 2.2;
    const direct = source * (0.32 + (1 - normal) * 0.55);
    const comb = combFilter.process(source)
      * (0.08 + state.reedGap * 0.028) / (0.72 + this.material.lossScale * 0.28);
    const cover = coverFilter.process(source)
      * (0.1 + state.brightness * 0.035) * this.material.stiffnessScale;
    const emitted = direct
      + cavity * normal * overCoupled * (0.82 + state.embouchure * 0.08)
      + comb
      + cover;
    // A single-hole tongue block still changes the radiating aperture/cavity,
    // so the raw control never becomes visually active but acoustically inert.
    const cup = this.radiationCup;
    const coefficient = this.handFilterCoefficient;
    const handResonator = side < 0 ? this.handResonatorLeft : this.handResonatorRight;
    const handResonance = handResonator.process(emitted) * this.handResonanceGain;
    if (side < 0) {
      this.handLowpassLeft += (emitted - this.handLowpassLeft) * coefficient;
      return (
        emitted * (1 - cup * 0.9)
        + this.handLowpassLeft * cup * 0.9
        + handResonance
      )
        * this.tongueRadiationGain;
    }
    this.handLowpassRight += (emitted - this.handLowpassRight) * coefficient;
    return (
      emitted * (1 - cup * 0.9)
      + this.handLowpassRight * cup * 0.9
      + handResonance
    )
      * this.tongueRadiationGain;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    const leftOutput = output[0];
    const rightOutput = output[1] ?? leftOutput;
    this._approachConfiguration(leftOutput.length);
    let squareSum = 0;
    let peak = 0;

    for (let frame = 0; frame < leftOutput.length; frame += 1) {
      this._renderReeds();
      const sourceLeft = this.renderedSourceLeft;
      const sourceRight = this.renderedSourceRight;
      this.sourceDcLeft += (sourceLeft - this.sourceDcLeft) * 0.0007;
      this.sourceDcRight += (sourceRight - this.sourceDcRight) * 0.0007;
      const left = Math.tanh(this._radiate(sourceLeft - this.sourceDcLeft, -1) * 1.28) * 0.78;
      const right = Math.tanh(this._radiate(sourceRight - this.sourceDcRight, 1) * 1.28) * 0.78;
      leftOutput[frame] = Number.isFinite(left) ? left : 0;
      rightOutput[frame] = Number.isFinite(right) ? right : 0;
      const magnitude = Math.max(Math.abs(leftOutput[frame]), Math.abs(rightOutput[frame]));
      peak = Math.max(peak, magnitude);
      squareSum += (leftOutput[frame] ** 2 + rightOutput[frame] ** 2) * 0.5;
    }

    const rms = Math.sqrt(squareSum / Math.max(1, leftOutput.length));
    this.lastPeak += (peak - this.lastPeak) * 0.3;
    this.lastRms += (rms - this.lastRms) * 0.22;
    this.blockCounter += 1;
    if (this.blockCounter % TELEMETRY_BLOCKS === 0) {
      const direction = Math.abs(this.breathFlow) < 1e-5
        ? 0
        : (this.breathFlow < 0 ? -1 : 1);
      this.port.postMessage({
        type: "telemetry",
        breathFlow: this.breathFlow,
        direction,
        displacement: this.reedDisplacement,
        energy: this.energy,
        activeFrequencyHz: this.activeFrequencyHz,
        bendSemitones: this.activeBendSemitones,
        passiveReedGain: this.activePassiveGain,
        sounding: this.activeFrequencyHz > 0 && this.energy > 1e-5,
        peak: this.lastPeak,
        rms: this.lastRms,
        formants: this.formants.frequenciesHz,
        bendTargetHz: this.formants.bendTargetHz,
        hole: this.configuration.hole,
        chordWidth: this.configuration.chordWidth,
        bluesTechniqueId: this.configuration.bluesTechniqueId,
        bluesRhythmId: this.configuration.bluesRhythmId,
        techniquePhase: this.techniquePhase,
        techniqueAgeSeconds: this.techniqueAgeSeconds,
        techniqueBendContour: this.techniqueBendContour,
        tongueSlapEnvelope: this.tongueSlapEnvelope,
        holeMotionEnergy: this.holeMotionEnergy,
        breathShiftSlop: this.configuration.breathShiftSlop,
        breathShiftActive: this.breathShiftSamplesRemaining > 0,
        effectiveHandCup: this.effectiveHandCup,
        handResonanceFrequencyHz: this.handResonanceFrequencyHz,
        effectiveTongueBlock: this.effectiveTongueBlock,
        rhythmStepIndex: this.rhythmStepIndex,
        overbendActive: this.overbendActive,
        overbendReleaseActive: this.overbendReleaseActive,
        overbendGate: this.overbendGate,
        chokedReed: this.chokedReed,
      });
    }
    return true;
  }
}

registerProcessor("harmonica-physical-model", HarmonicaPhysicalProcessor);

export { HarmonicaPhysicalProcessor };
