import {
  JAW_HARP_LIMITS,
  JAW_HARP_MODE_COUNT,
  effectiveBreathRateBpm,
  jawHarpPreset,
  mouthFormants,
  reedMaterialProperties,
  reedModeFrequencies,
  sanitizeJawHarpState,
} from "./jaw-harp.js";

const MODE_COUNT = JAW_HARP_MODE_COUNT;
const TELEMETRY_BLOCKS = 10;
const SILENCE_FLOOR = 1e-9;
const TINE_HOLD_FADE_SECONDS = 0.004;
const TWO_PI = Math.PI * 2;
const SINE_TABLE_SIZE = 8_192;
const SINE_TABLE_MASK = SINE_TABLE_SIZE - 1;
const PHASE_TO_SINE_TABLE = SINE_TABLE_SIZE / TWO_PI;
const SINE_TABLE = new Float64Array(SINE_TABLE_SIZE);
const INHALE_AIR_WEIGHTS_DRY = new Float64Array(MODE_COUNT);
const INHALE_AIR_WEIGHTS_WET = new Float64Array(MODE_COUNT);
const EXHALE_AIR_WEIGHTS_DRY = new Float64Array(MODE_COUNT);
const EXHALE_AIR_WEIGHTS_WET = new Float64Array(MODE_COUNT);
const INHALE_FORMANT_WEIGHTS = Object.freeze([0.96, 0.72, 0.24]);
const EXHALE_FORMANT_WEIGHTS = Object.freeze([0.48, 1.08, 0.72]);
const REST_FORMANT_WEIGHTS = Object.freeze([0.7, 0.9, 0.42]);
const COEFFICIENT_REED = 1;
const COEFFICIENT_TRACT = 2;
const COEFFICIENT_FRAME = 4;
const COEFFICIENT_BREATH = 8;
const COEFFICIENT_BREATH_TEXTURE = 16;
const COEFFICIENT_ALL = COEFFICIENT_REED
  | COEFFICIENT_TRACT
  | COEFFICIENT_FRAME
  | COEFFICIENT_BREATH
  | COEFFICIENT_BREATH_TEXTURE;
const DISCRETE_CONFIGURATION_KEYS = new Set([
  "presetId", "vowelId", "repeat", "autoBreath", "breathLinked", "rhythmId",
  "pluckDirection", "breathFlow",
]);

for (let index = 0; index < SINE_TABLE_SIZE; index += 1) {
  SINE_TABLE[index] = Math.sin(index * TWO_PI / SINE_TABLE_SIZE);
}
for (let index = 0; index < MODE_COUNT; index += 1) {
  const harmonic = index + 1;
  const inhaleParity = harmonic % 2 === 0 ? 0.46 : 1.08;
  const exhaleParity = harmonic % 2 === 0 ? 1.38 : 0.92;
  INHALE_AIR_WEIGHTS_DRY[index] = inhaleParity / Math.pow(harmonic, 1.18);
  INHALE_AIR_WEIGHTS_WET[index] = inhaleParity / Math.pow(harmonic, 1.14);
  EXHALE_AIR_WEIGHTS_DRY[index] = exhaleParity / Math.pow(harmonic, 0.68);
  EXHALE_AIR_WEIGHTS_WET[index] = exhaleParity / Math.pow(harmonic, 0.52);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function fastSine(phase) {
  const position = phase * PHASE_TO_SINE_TABLE;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const first = SINE_TABLE[lower & SINE_TABLE_MASK];
  const second = SINE_TABLE[(lower + 1) & SINE_TABLE_MASK];
  return first + (second - first) * fraction;
}

// Reserve the first few percent of the control for an effectively clean reed,
// then ease the turbulence in perceptually. A linear gain made even a 1–5%
// setting read as a constant noise bed on laptop speakers.
function breathTextureGain(amount) {
  const unit = clamp((clamp(amount) - 0.018) / 0.982);
  return unit * unit * (3 - 2 * unit);
}

function coefficientMaskForKey(key) {
  switch (key) {
    case "reedFrequencyHz": return COEFFICIENT_REED | COEFFICIENT_FRAME;
    case "reedDecaySeconds": return COEFFICIENT_REED;
    case "reedStiffness": return COEFFICIENT_REED
      | COEFFICIENT_FRAME
      | COEFFICIENT_BREATH_TEXTURE;
    case "tonguePosition":
    case "tongueHeight":
    case "jawOpening":
    case "lipRounding": return COEFFICIENT_TRACT;
    case "glottisOpening": return COEFFICIENT_TRACT | COEFFICIENT_BREATH_TEXTURE;
    case "formantFocus": return COEFFICIENT_TRACT;
    case "frameCoupling": return COEFFICIENT_FRAME;
    case "breathRateBpm":
    case "repeatRateBpm":
    case "breathsPerLoop":
    case "breathLinked":
    case "rhythmId": return COEFFICIENT_BREATH;
    case "breathFilter": return COEFFICIENT_BREATH_TEXTURE;
    default: return 0;
  }
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
    this.focusFilterLeft = new StateVariableBandpass(this.rate);
    this.focusFilterRight = new StateVariableBandpass(this.rate);
    this.frameFilterLeft = new StateVariableBandpass(this.rate);
    this.frameFilterRight = new StateVariableBandpass(this.rate);
    this.noiseState = 0x4a617748;
    this.clickEnvelope = 0;
    this.attackEnvelope = 0;
    this.strikePresence = 0;
    this.clickPolarity = 1;
    this.breathFlow = clamp(
      this.configuration.breathFlow,
      JAW_HARP_LIMITS.breathFlow[0],
      JAW_HARP_LIMITS.breathFlow[1],
    );
    this.manualBreathFlow = null;
    this.breathPhase = 0;
    this.breathPhaseIncrement = 0;
    this.effectiveBreathRate = this.configuration.breathRateBpm;
    this.breathNoiseState = 0;
    this.breathNoiseSmoothState = 0;
    this.breathNoiseDcState = 0;
    this.breathNoiseColorInhale = 0;
    this.breathNoiseColorExhale = 0;
    this.breathNoiseDcColor = 0;
    this.breathTexture = 0;
    this.sourceDc = 0;
    this.airGate = 0;
    this.airPathPrimed = false;
    this.tineHeld = false;
    this.tineHoldFading = false;
    this.tineHoldGain = 1;
    this.tineHoldFadeStep = 1 / Math.max(1, this.rate * TINE_HOLD_FADE_SECONDS);
    this.hasBeenPlucked = false;
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
      const previousPresetId = this.targetConfiguration.presetId;
      this.targetConfiguration = sanitizeJawHarpState({
        ...this.targetConfiguration,
        ...(message.configuration ?? {}),
      }, this.targetConfiguration);
      if (this.targetConfiguration.presetId !== previousPresetId) {
        const wasHeld = this.tineHeld;
        const manualBreathFlow = this.manualBreathFlow;
        this._silence();
        this.tineHeld = wasHeld;
        this.manualBreathFlow = manualBreathFlow;
        const preset = jawHarpPreset(this.targetConfiguration.presetId);
        for (const key of Object.keys(preset.settings)) {
          this.configuration[key] = this.targetConfiguration[key];
        }
        this.configuration.presetId = this.targetConfiguration.presetId;
        this._updateCoefficients();
      }
      return;
    }
    if (message.type === "pluck") {
      this._pluck(message.force, message.direction, message.position, message.automatic);
      return;
    }
    if (message.type === "strike-tine") {
      this._pluck(
        message.force,
        message.direction,
        message.position,
        message.automatic,
        false,
        true,
      );
      return;
    }
    if (message.type === "breath") {
      const requestedFlow = Number(message.flow);
      this.manualBreathFlow = message.manual === false
        ? null
        : clamp(
          Number.isFinite(requestedFlow) ? requestedFlow : 0,
          JAW_HARP_LIMITS.breathFlow[0],
          JAW_HARP_LIMITS.breathFlow[1],
        );
      return;
    }
    if (message.type === "breath-cycle-reset") {
      const phase = Number(message.phase);
      this.breathPhase = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
      return;
    }
    if (message.type === "hold-tine") {
      this._holdTine();
      return;
    }
    if (message.type === "release-tine") {
      if (this.tineHoldFading) this._finishTineHold();
      this.tineHeld = false;
      this.tineHoldFading = false;
      this.tineHoldGain = 1;
      if (Number(message.force) > 0) {
        this._pluck(message.force, message.direction, message.position, false, true, true);
      }
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
    this.amplitudes.fill(0);
    this.clickEnvelope = 0;
    this.attackEnvelope = 0;
    this.strikePresence = 0;
    this.breathFlow = 0;
    this.manualBreathFlow = null;
    this.breathNoiseState = 0;
    this.breathNoiseSmoothState = 0;
    this.breathNoiseDcState = 0;
    this.breathTexture = 0;
    this.sourceDc = 0;
    this.airGate = 0;
    this.airPathPrimed = false;
    this.tineHeld = false;
    this.tineHoldFading = false;
    this.tineHoldGain = 1;
    this.hasBeenPlucked = false;
    this.energy = 0;
    this.reedDisplacement = 0;
    this._resetFilters();
  }

  _holdTine() {
    if (this.tineHeld) return;
    this.tineHeld = true;
    if (this.silenced || !this.hasBeenPlucked) {
      this._finishTineHold();
      return;
    }
    this.tineHoldFading = true;
    this.tineHoldGain = 1;
  }

  _finishTineHold() {
    this.amplitudes.fill(0);
    this.clickEnvelope = 0;
    this.attackEnvelope = 0;
    this.strikePresence = 0;
    this.sourceDc = 0;
    this.breathFlow = 0;
    this.breathNoiseState = 0;
    this.breathNoiseSmoothState = 0;
    this.breathNoiseDcState = 0;
    this.breathTexture = 0;
    this.airGate = 0;
    this.airPathPrimed = false;
    this.energy = 0;
    this.reedDisplacement = 0;
    this.hasBeenPlucked = false;
    this.tineHeld = true;
    this.tineHoldFading = false;
    this.tineHoldGain = 0;
    this._resetFilters();
  }

  _resetFilters() {
    for (let index = 0; index < 3; index += 1) {
      this.mouthFiltersLeft[index].reset();
      this.mouthFiltersRight[index].reset();
    }
    this.focusFilterLeft.reset();
    this.focusFilterRight.reset();
    this.frameFilterLeft.reset();
    this.frameFilterRight.reset();
  }

  _pluck(
    force,
    direction,
    position,
    _automatic = false,
    tineRelease = false,
    releasedDisplacement = false,
  ) {
    if (this.tineHeld && !tineRelease) return;
    if (tineRelease && this.tineHoldFading) this._finishTineHold();
    this.silenced = false;
    this.tineHeld = false;
    this.tineHoldFading = false;
    this.tineHoldGain = 1;
    const strength = clamp(
      Number(force),
      JAW_HARP_LIMITS.pluckForce[0],
      JAW_HARP_LIMITS.pluckForce[1],
    );
    const side = Number(direction) < 0 ? -1 : 1;
    const pluckPosition = clamp(Number(position), 0.05, 0.95);
    const stiffness = this.targetConfiguration.reedStiffness;
    const material = jawHarpPreset(this.targetConfiguration.presetId).material;
    const physics = reedMaterialProperties(this.targetConfiguration);
    const spectralSlope = clamp(
      0.68 + (1 - stiffness) * 0.82
        - Math.log2(material.brightness) * 0.42
        - Math.log2(physics.specificModulusRatio) * 0.08,
      0.38,
      2.2,
    );
    const elasticHeadroom = clamp(physics.elasticLimitStrain / 0.006, 0.5, 1.65);
    const impulseCoupling = 0.74 + elasticHeadroom * 0.08;

    for (let index = 0; index < MODE_COUNT; index += 1) {
      const harmonic = index + 1;
      const positionComb = Math.sin(Math.PI * harmonic * pluckPosition);
      const excitation = side * strength * impulseCoupling * positionComb
        / Math.pow(harmonic, spectralSlope);
      if (tineRelease) {
        // A pulled tine is released from maximum displacement with zero velocity.
        this.amplitudes[index] = Math.abs(excitation);
        this.phases[index] = excitation < 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
      } else if (releasedDisplacement) {
        // A fast finger strike adds another released-displacement state to the
        // moving tine. Finite finger contact turns the phase toward maximum
        // displacement without teleporting a ringing oscillator across a large
        // phase angle. Modal energy adds in quadrature, so later hits cannot
        // erase the stronger second and third vibrations of an elastic reed.
        const previousAmplitude = this.amplitudes[index];
        if (previousAmplitude < SILENCE_FLOOR) {
          this.amplitudes[index] = Math.abs(excitation);
          this.phases[index] = excitation < 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
        } else {
          const releasePhase = excitation < 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
          const phaseDelta = Math.atan2(
            Math.sin(releasePhase - this.phases[index]),
            Math.cos(releasePhase - this.phases[index]),
          );
          const phaseInfluence = Math.abs(excitation)
            / Math.max(SILENCE_FLOOR, previousAmplitude + Math.abs(excitation));
          this.amplitudes[index] = Math.hypot(previousAmplitude, excitation);
          this.phases[index] += clamp(phaseDelta * phaseInfluence, -0.48, 0.48);
        }
      } else {
        // A retrigger supplies energy without phase-braking a mode that is
        // already ringing. Dormant modes start from the signed velocity
        // impulse; active modes retain their phase and gain quadrature energy.
        const previousAmplitude = this.amplitudes[index];
        if (previousAmplitude < SILENCE_FLOOR) {
          this.amplitudes[index] = Math.abs(excitation);
          this.phases[index] = excitation < 0 ? Math.PI : 0;
        } else {
          this.amplitudes[index] = Math.hypot(previousAmplitude, excitation);
        }
      }
    }
    // A weaker follow-up cannot erase the attack that is still decaying from
    // the preceding strike; it can only add its own click/modal energy.
    this.clickEnvelope = Math.max(this.clickEnvelope, strength * material.contact);
    this.attackEnvelope = Math.max(this.attackEnvelope, strength);
    this.clickPolarity = side;
    this.energy = Math.max(this.energy, strength);
    this.airGate = Math.max(this.airGate, Math.min(1.6, Math.sqrt(strength) * 0.58));
    this.hasBeenPlucked = true;
  }

  _approachConfiguration(frameCount = 128) {
    const smooth = 1 - Math.exp(-Math.max(1, frameCount) / (this.rate * 0.012));
    let coefficientMask = 0;
    for (const key in this.targetConfiguration) {
      const target = this.targetConfiguration[key];
      if (DISCRETE_CONFIGURATION_KEYS.has(key) || typeof target !== "number") {
        if (this.configuration[key] !== target) {
          this.configuration[key] = target;
          coefficientMask |= coefficientMaskForKey(key);
        }
      } else {
        const difference = target - this.configuration[key];
        if (Math.abs(difference) > 1e-6) {
          this.configuration[key] += difference * smooth;
          coefficientMask |= coefficientMaskForKey(key);
        } else if (difference !== 0) {
          this.configuration[key] = target;
          coefficientMask |= coefficientMaskForKey(key);
        }
      }
    }
    if (coefficientMask) this._updateCoefficients(coefficientMask);
  }

  _updateCoefficients(coefficientMask = COEFFICIENT_ALL) {
    const state = this.configuration;
    if (coefficientMask & COEFFICIENT_BREATH_TEXTURE) {
      const glottisUnit = clamp(
        (state.glottisOpening - JAW_HARP_LIMITS.glottisOpening[0])
          / (JAW_HARP_LIMITS.glottisOpening[1] - JAW_HARP_LIMITS.glottisOpening[0]),
      );
      // Turbulence is always colored before it reaches the mouth. The filter
      // control spans a muffled chesty air stream to an open airy edge without
      // ever exposing sample-to-sample white noise directly.
      const filterUnit = clamp(state.breathFilter);
      const baseCutoffHz = 260 * Math.pow(32, filterUnit);
      const inhaleCutoffHz = clamp(
        baseCutoffHz * (0.72 + glottisUnit * 0.3),
        170,
        8_400,
      );
      const exhaleCutoffHz = clamp(
        baseCutoffHz * (0.9 + state.reedStiffness * 0.24),
        210,
        9_600,
      );
      this.breathNoiseColorInhale = 1 - Math.exp(-TWO_PI * inhaleCutoffHz / this.rate);
      this.breathNoiseColorExhale = 1 - Math.exp(-TWO_PI * exhaleCutoffHz / this.rate);
      const rumbleCutoffHz = 38 + filterUnit * 62;
      this.breathNoiseDcColor = 1 - Math.exp(-TWO_PI * rumbleCutoffHz / this.rate);
    }
    if (coefficientMask & COEFFICIENT_REED) {
      const material = jawHarpPreset(state.presetId).material;
      const physics = reedMaterialProperties(state);
      this.material = material;
      this.materialPhysics = physics;
      const modes = reedModeFrequencies(state, MODE_COUNT);
      const baseDecay = state.reedDecaySeconds;
      const intrinsicLossScale = clamp(
        Math.log1p(physics.internalLossFactor * 10_000) / Math.log(151),
        0,
        1,
      );
      const lossTilt = (0.018 + (1 - state.reedStiffness) * 0.055)
        * material.lossTilt * (0.92 + intrinsicLossScale * 0.28);
      for (let index = 0; index < MODE_COUNT; index += 1) {
        const harmonic = index + 1;
        const idealFrequency = state.reedFrequencyHz * harmonic;
        this.frequencies[index] = idealFrequency
          + (modes[index] - idealFrequency) * material.inharmonicity;
        const modeDecay = baseDecay / (1 + index * lossTilt);
        this.decays[index] = Math.exp(-1 / Math.max(1, this.rate * modeDecay));
      }
    }

    if (coefficientMask & COEFFICIENT_TRACT) {
      const formants = mouthFormants(state);
      for (let index = 0; index < 3; index += 1) {
        const frequency = formants.frequenciesHz[index];
        const bandwidth = formants.bandwidthsHz[index];
        this.mouthFiltersLeft[index].configure(frequency * (index === 1 ? 0.997 : 1), bandwidth);
        this.mouthFiltersRight[index].configure(frequency * (index === 1 ? 1.003 : 1), bandwidth * 1.03);
      }
      this.focusFilterLeft.configure(formants.focusFrequencyHz * 0.998, formants.focusBandwidthHz);
      this.focusFilterRight.configure(formants.focusFrequencyHz * 1.002, formants.focusBandwidthHz * 1.04);
    }

    if (coefficientMask & COEFFICIENT_FRAME) {
      const frameFrequency = Math.min(
        this.rate * 0.18,
        state.reedFrequencyHz * (3.2 + state.frameCoupling * 9.4) * this.material.frameRatio,
      );
      const frameBandwidth = (130 + (1 - state.reedStiffness) * 360)
        * this.material.frameBandwidth;
      this.frameFilterLeft.configure(frameFrequency * 0.992, frameBandwidth);
      this.frameFilterRight.configure(frameFrequency * 1.008, frameBandwidth);
    }

    if (coefficientMask & COEFFICIENT_BREATH) {
      this.effectiveBreathRate = effectiveBreathRateBpm(state);
      this.breathPhaseIncrement = this.effectiveBreathRate / (60 * this.rate);
    }
  }

  _automaticBreathFlow() {
    const state = this.configuration;
    if (!state.autoBreath) return 0;
    const phase = this.breathPhase;
    this.breathPhase += this.breathPhaseIncrement;
    if (this.breathPhase >= 1) this.breathPhase -= Math.floor(this.breathPhase);
    if (phase < state.breathBalance) {
      return -state.breathDepth * Math.sin(Math.PI * phase / state.breathBalance);
    }
    return state.breathDepth
      * Math.sin(Math.PI * (phase - state.breathBalance) / (1 - state.breathBalance));
  }

  _renderSource() {
    const automaticBreathFlow = this._automaticBreathFlow();
    if (this.silenced || (this.tineHeld && !this.tineHoldFading)) {
      this.breathFlow = 0;
      this.breathTexture = 0;
      return 0;
    }
    const state = this.configuration;
    const targetBreathFlow = this.manualBreathFlow ?? automaticBreathFlow;
    if (this.manualBreathFlow === null && state.autoBreath) {
      this.breathFlow = targetBreathFlow;
    } else {
      this.breathFlow += (targetBreathFlow - this.breathFlow) * 0.032;
    }
    if (Math.abs(this.breathFlow) < 1e-6 && Math.abs(targetBreathFlow) < 1e-6) this.breathFlow = 0;
    const flow = clamp(
      this.breathFlow,
      JAW_HARP_LIMITS.breathFlow[0],
      JAW_HARP_LIMITS.breathFlow[1],
    );
    const flowMagnitude = Math.abs(flow);
    const breathPresence = 1 - Math.exp(-flowMagnitude * 1.15);
    const exhaling = flow >= 0;
    const flowGate = this.hasBeenPlucked && !this.tineHeld ? breathPresence : 0;
    const gateTarget = flowGate > 0.004 ? 0.08 + flowGate * 1.12 : 0;
    // Once breath has opened this reed, reopen it promptly after a breath-zero
    // crossing. A brand-new feather-light pluck still earns its intentionally
    // soft attack instead of being inflated to the hard-pluck air level.
    const gateRate = gateTarget > this.airGate
      ? (this.airPathPrimed ? 0.0006 : 0.00004) + Math.min(1, this.energy) * 0.003
      : 0.0007;
    this.airGate += (gateTarget - this.airGate) * gateRate;
    if (this.airGate > 0.2) this.airPathPrimed = true;
    let sum = 0;
    let fundamental = 0;
    let energy = 0;
    const maximumFrequency = this.rate * 0.44;
    const pressureBend = Math.pow(2, flow * (0.012 + state.reedStiffness * 0.018));
    const airWeightsDry = exhaling ? EXHALE_AIR_WEIGHTS_DRY : INHALE_AIR_WEIGHTS_DRY;
    const airWeightsWet = exhaling ? EXHALE_AIR_WEIGHTS_WET : INHALE_AIR_WEIGHTS_WET;
    const breathSustain = breathPresence * (0.82 + state.reedStiffness * 0.16);

    for (let index = 0; index < MODE_COUNT; index += 1) {
      const frequency = this.frequencies[index] * pressureBend;
      const amplitude = this.amplitudes[index];
      if (frequency >= maximumFrequency) {
        let phase = this.phases[index] + TWO_PI * frequency / this.rate;
        if (phase >= TWO_PI) phase -= TWO_PI;
        else if (phase < 0) phase += TWO_PI;
        this.phases[index] = phase;
        this.amplitudes[index] *= Math.min(
          0.9999995,
          this.decays[index] + (1 - this.decays[index]) * breathSustain,
        );
        continue;
      }
      const airWeight = airWeightsDry[index]
        + (airWeightsWet[index] - airWeightsDry[index]) * breathPresence;
      const airAmplitude = this.airGate * flowMagnitude
        * (0.078 + state.reedStiffness * 0.04) * this.material.airResponse
        * airWeight;
      if (Math.abs(amplitude) < SILENCE_FLOOR && airAmplitude < SILENCE_FLOOR) {
        this.amplitudes[index] = 0;
        continue;
      }
      let phase = this.phases[index] + TWO_PI * frequency / this.rate;
      if (phase >= TWO_PI) phase -= TWO_PI;
      else if (phase < 0) phase += TWO_PI;
      this.phases[index] = phase;
      const mechanical = fastSine(phase) * amplitude;
      const aerodynamic = fastSine(phase + (exhaling ? 0.19 : -0.31))
        * airAmplitude * Math.sign(flow || 1);
      const value = mechanical + aerodynamic;
      sum += value;
      if (index === 0) fundamental = value;
      energy += amplitude * amplitude + airAmplitude * airAmplitude;
      this.amplitudes[index] *= Math.min(0.9999995, this.decays[index] + (1 - this.decays[index]) * breathSustain);
    }

    this.reedDisplacement = fundamental;
    this.energy += (Math.sqrt(energy) - this.energy) * 0.0018;
    const elasticHeadroom = clamp(this.materialPhysics.elasticLimitStrain / 0.006, 0.5, 1.65);
    const edge = (1.2 + state.reedStiffness * 5.4)
      * (0.82 + this.material.brightness * 0.22)
      * (0.9 + elasticHeadroom * 0.1);
    const nonlinear = Math.tanh(sum * edge) / edge;
    const pressureLoaded = nonlinear * (1 + flow * nonlinear * (0.55 + state.reedStiffness * 0.42));
    this.sourceDc += (pressureLoaded - this.sourceDc) * 0.00055;
    const pressureLoadedAc = pressureLoaded - this.sourceDc;
    const clickNoise = this._random() * this.clickEnvelope * this.clickPolarity;
    this.clickEnvelope *= 0.9972 - state.frameCoupling * 0.00045;
    if (this.clickEnvelope < SILENCE_FLOOR) this.clickEnvelope = 0;
    const attack = this.attackEnvelope;
    this.strikePresence = clamp(attack * 0.8, 0, 1);
    this.attackEnvelope *= 0.99928;
    if (this.attackEnvelope < SILENCE_FLOOR) this.attackEnvelope = 0;
    const rawBreathNoise = this._random();
    const breathColor = exhaling
      ? this.breathNoiseColorExhale
      : this.breathNoiseColorInhale;
    // Two gentle poles remove the sample-to-sample white-noise edge that read as
    // digital distortion. A slow subtraction keeps the result airy rather than
    // adding low-frequency pressure wander; the reed and attack paths are not
    // part of this texture branch.
    this.breathNoiseState += (rawBreathNoise - this.breathNoiseState) * breathColor;
    this.breathNoiseSmoothState += (
      this.breathNoiseState - this.breathNoiseSmoothState
    ) * breathColor;
    this.breathNoiseDcState += (
      this.breathNoiseSmoothState - this.breathNoiseDcState
    ) * this.breathNoiseDcColor;
    const smoothBreathNoise = (this.breathNoiseSmoothState - this.breathNoiseDcState) * 1.5;
    this.breathTexture = smoothBreathNoise * breathTextureGain(state.breathNoiseAmount)
      * flowMagnitude * (exhaling ? 0.082 : 0.058) * this.material.airResponse
      * (0.18 + this.airGate * 0.82) * (this.hasBeenPlucked ? 1 : 0);
    const breathLoad = clamp(
      state.dryResonance + breathPresence * (1 - state.dryResonance)
        + this.strikePresence * 0.12,
      0,
      1,
    );
    const mechanicalAudibility = 0.09 + state.dryResonance * 0.72
      + breathPresence * 1.16 + this.strikePresence * 0.62;
    const releaseLift = 1 + Math.min(1.5, attack) * (0.22 + this.material.contact * 0.08);
    return pressureLoadedAc
        * mechanicalAudibility * releaseLift
        * (0.68 + breathPresence * 0.42)
      + clickNoise * (0.018 + breathLoad * 0.045);
  }

  _radiate(source, side) {
    const state = this.configuration;
    const filters = side < 0 ? this.mouthFiltersLeft : this.mouthFiltersRight;
    const flow = clamp(
      this.breathFlow,
      JAW_HARP_LIMITS.breathFlow[0],
      JAW_HARP_LIMITS.breathFlow[1],
    );
    const breathPresence = 1 - Math.exp(-Math.abs(flow) * 1.15);
    const directionalWeights = flow < -0.015
      ? INHALE_FORMANT_WEIGHTS
      : flow > 0.015
        ? EXHALE_FORMANT_WEIGHTS
        : REST_FORMANT_WEIGHTS;
    const focusCoordinate = clamp(state.formantFocus, 0, 2);
    // Breath turbulence joins the vibrating reed only at the vocal tract. It
    // therefore receives the same moving formants/focus as the jaw-harp tone,
    // while staying out of the reed saturation and metallic frame resonator.
    const tractInput = source + this.breathTexture;
    let cavity = 0;
    for (let index = 0; index < 3; index += 1) {
      const focusWeight = 0.34 + 1.66 * Math.exp(-Math.abs(focusCoordinate - index) * 1.55);
      cavity += filters[index].process(tractInput) * directionalWeights[index] * focusWeight;
    }
    const focusFilter = side < 0 ? this.focusFilterLeft : this.focusFilterRight;
    const focusResonance = focusFilter.process(tractInput)
      * (1.15 + Math.abs(state.formantFocus - 0.5) * 0.18);
    const coupling = clamp(state.cavityCoupling, 0, 2);
    const normalCoupling = Math.min(1, coupling);
    const superCoupling = 1 + Math.max(0, coupling - 1) * 2.4;
    const breathLoad = clamp(
      state.dryResonance + breathPresence * (1 - state.dryResonance)
        + this.strikePresence * 0.12,
      0,
      1,
    );
    const openGlottisLoss = clamp(1 - state.glottisOpening * 0.18, 0.32, 1.42);
    const directionalDirect = flow < -0.015 ? 0.14 : flow > 0.015 ? 0.27 : 0.2;
    const directionalCavity = flow < -0.015 ? 2.9 : flow > 0.015 ? 2.55 : 2.62;
    const mouth = (
      source * (0.025 + directionalDirect * breathLoad + (1 - normalCoupling) * 0.24)
      + (cavity + focusResonance * (0.7 + breathPresence * 0.8))
        * normalCoupling * superCoupling * directionalCavity * breathLoad
    )
      * openGlottisLoss;
    const frameFilter = side < 0 ? this.frameFilterLeft : this.frameFilterRight;
    const frame = frameFilter.process(source) * (0.5 + state.reedStiffness * 0.7);
    return mouth + frame * state.frameCoupling * this.material.contact * (0.28 + breathLoad * 1.8);
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
      const holdGain = this.tineHoldFading ? this.tineHoldGain : 1;
      const source = this._renderSource();
      const left = Math.tanh(this._radiate(source, -1) * 1.42) * 0.82 * holdGain;
      const right = Math.tanh(this._radiate(source, 1) * 1.42) * 0.82 * holdGain;
      leftOutput[frame] = left;
      rightOutput[frame] = right;
      const magnitude = Math.max(Math.abs(left), Math.abs(right));
      peak = Math.max(peak, magnitude);
      squareSum += (left * left + right * right) * 0.5;
      if (this.tineHoldFading) {
        this.tineHoldGain = Math.max(0, this.tineHoldGain - this.tineHoldFadeStep);
        if (this.tineHoldGain === 0) this._finishTineHold();
      }
    }

    const rms = Math.sqrt(squareSum / Math.max(1, leftOutput.length));
    this.lastPeak += (peak - this.lastPeak) * 0.28;
    this.lastRms += (rms - this.lastRms) * 0.2;
    this.blockCounter += 1;
    if (this.blockCounter % TELEMETRY_BLOCKS === 0) {
      const formants = mouthFormants(this.configuration);
      const harmonicIndex = clamp(
        Math.round(formants.focusFrequencyHz / this.configuration.reedFrequencyHz),
        1,
        MODE_COUNT,
      );
      const harmonicFrequencyHz = harmonicIndex * this.configuration.reedFrequencyHz;
      this.port.postMessage({
        type: "telemetry",
        displacement: this.reedDisplacement,
        energy: this.energy,
        peak: this.lastPeak,
        rms: this.lastRms,
        formants: formants.frequenciesHz,
        focusFrequencyHz: formants.focusFrequencyHz,
        harmonicIndex,
        harmonicFrequencyHz,
        breathFlow: this.breathFlow,
        breathRateBpm: this.effectiveBreathRate,
        tineHeld: this.tineHeld,
      });
    }
    return true;
  }
}

registerProcessor("jaw-harp-physical-model", JawHarpPhysicalProcessor);

export { JawHarpPhysicalProcessor, breathTextureGain, fastSine };
