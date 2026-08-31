import {
  BLOWHOLE_DEFAULTS,
  BLOWHOLE_SOURCE_FAMILIES,
  blowholeCall,
  createBlowholeVoicePlan,
  deriveBlowholePropagation,
  evaluateBlowholeGesture,
  sanitizeBlowholeState,
} from "./blowhole.js";

const TAU = Math.PI * 2;
const TELEMETRY_BLOCKS = 12;
const SILENCE_FLOOR = 1e-12;
const CALL_RETARGET_FADE_OUT_SECONDS = 0.018;
const CALL_RETARGET_FADE_IN_SECONDS = 0.03;
const SURFACE_VALVE_OPEN_THRESHOLD = 0.01;
const SURFACE_VALVE_SMOOTH_SECONDS = 0.02;
const SURFACE_BREATH_FLOW_SMOOTH_SECONDS = 0.004;
const SURFACE_BREATH_RELEASE_SECONDS = 0.03;
const SURFACE_BREATH_PRESSURE_FLOOR = 1e-5;
const SURFACE_BREATH_VOLUME_FLOOR = 1e-6;
const SURFACE_BREATH_MONITOR_GAIN = 1.5;
const SURFACE_BREATH_RECEIVER_GAINS = Object.freeze({
  "water-calm": 0.82,
  "air-still": 1,
  "air-windy": 0.82,
  "water-choppy": 0.9,
});
const SURFACE_BREATH_PROFILES = Object.freeze({
  dolphin: Object.freeze({
    id: "dolphin",
    exhaleSeconds: 0.28,
    inhaleSeconds: 0.72,
    inhaleRatio: 0.06,
    lowFrequencyHz: 760,
    lowBandwidthHz: 620,
    highFrequencyHz: 2_300,
    highBandwidthHz: 1_750,
    outputGain: 0.27,
  }),
  orca: Object.freeze({
    id: "orca",
    exhaleSeconds: 0.42,
    inhaleSeconds: 0.9,
    inhaleRatio: 0.06,
    lowFrequencyHz: 540,
    lowBandwidthHz: 470,
    highFrequencyHz: 1_800,
    highBandwidthHz: 1_350,
    outputGain: 0.29,
  }),
  sperm: Object.freeze({
    id: "sperm",
    exhaleSeconds: 1,
    inhaleSeconds: 1.45,
    inhaleRatio: 0.05,
    lowFrequencyHz: 330,
    lowBandwidthHz: 310,
    highFrequencyHz: 1_100,
    highBandwidthHz: 850,
    outputGain: 0.32,
  }),
  humpback: Object.freeze({
    id: "humpback",
    exhaleSeconds: 1.1,
    inhaleSeconds: 1.55,
    inhaleRatio: 0.045,
    lowFrequencyHz: 250,
    lowBandwidthHz: 230,
    highFrequencyHz: 850,
    highBandwidthHz: 660,
    outputGain: 0.32,
  }),
  blue: Object.freeze({
    id: "blue",
    exhaleSeconds: 1.45,
    inhaleSeconds: 1.9,
    inhaleRatio: 0.045,
    lowFrequencyHz: 170,
    lowBandwidthHz: 160,
    highFrequencyHz: 640,
    highBandwidthHz: 510,
    outputGain: 0.34,
  }),
});
const PROPAGATION_PROFILE_IDS = Object.freeze([
  "water-calm",
  "air-still",
  "air-windy",
  "water-choppy",
]);

const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
);

const smoothCoefficient = (seconds, rate) => 1 - Math.exp(-1 / Math.max(1, seconds * rate));

const finiteOr = (value, fallback) => (
  Number.isFinite(value) ? value : fallback
);

const surfaceBreathProfile = (call) => (
  call?.id === "sperm-whale-coda"
    ? SURFACE_BREATH_PROFILES.sperm
    : call?.id === "orca-pulsed-call"
      ? SURFACE_BREATH_PROFILES.orca
      : call?.id === "blue-whale-b-call"
        ? SURFACE_BREATH_PROFILES.blue
        : call?.family === "mysticete"
          ? SURFACE_BREATH_PROFILES.humpback
          : SURFACE_BREATH_PROFILES.dolphin
);

function xorshift(value) {
  let state = value | 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state | 0;
}

class StateVariableBandpass {
  constructor(rate) {
    this.rate = rate;
    this.low = 0;
    this.band = 0;
    this.coefficient = 0.05;
    this.damping = 0.25;
  }

  configure(frequencyHz, bandwidthHz) {
    const center = clamp(frequencyHz, 18, this.rate * 0.205);
    const bandwidth = clamp(bandwidthHz, 8, center * 1.5);
    this.coefficient = 2 * Math.sin(Math.PI * center / this.rate);
    this.damping = clamp(bandwidth / Math.max(1, center), 0.025, 1.35);
  }

  reset() {
    this.low = 0;
    this.band = 0;
  }

  process(input) {
    const high = input - this.low - this.damping * this.band;
    this.band += this.coefficient * high;
    this.low += this.coefficient * this.band;
    if (!Number.isFinite(this.low) || Math.abs(this.low) < SILENCE_FLOOR) this.low = 0;
    if (!Number.isFinite(this.band) || Math.abs(this.band) < SILENCE_FLOOR) this.band = 0;
    return this.band * Math.sqrt(this.damping);
  }
}

class DampedMode {
  constructor(rate) {
    this.rate = rate;
    this.y1 = 0;
    this.y2 = 0;
    this.coefficient = 0;
    this.radiusSquared = 0;
    this.gain = 0.01;
  }

  configure(frequencyHz, decaySeconds = 0.004) {
    const frequency = clamp(frequencyHz, 14, this.rate * 0.47);
    const decay = clamp(decaySeconds, 0.00008, 2.5);
    const radius = Math.exp(-1 / Math.max(1, decay * this.rate));
    this.coefficient = 2 * radius * Math.cos(TAU * frequency / this.rate);
    this.radiusSquared = radius * radius;
    this.gain = Math.sin(TAU * frequency / this.rate) * (1 - radius + 0.002);
  }

  reset() {
    this.y1 = 0;
    this.y2 = 0;
  }

  process(input) {
    let value = input * this.gain + this.coefficient * this.y1 - this.radiusSquared * this.y2;
    if (!Number.isFinite(value) || Math.abs(value) < SILENCE_FLOOR) value = 0;
    this.y2 = this.y1;
    this.y1 = value;
    return value;
  }
}

class AcousticDelayLine {
  constructor(rate) {
    this.rate = rate;
    this.buffer = new Float32Array(Math.ceil(rate * 0.075));
    this.writeIndex = 0;
  }

  reset() {
    this.buffer.fill(0);
    this.writeIndex = 0;
  }

  process(input, delaySeconds, feedback) {
    const delayFrames = Math.round(clamp(delaySeconds, 0.001, 0.07) * this.rate);
    const readIndex = (this.writeIndex - delayFrames + this.buffer.length) % this.buffer.length;
    const delayed = this.buffer[readIndex] || 0;
    this.buffer[this.writeIndex] = clamp(input + delayed * clamp(feedback, 0, 0.34), -1.5, 1.5);
    this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
    return delayed;
  }
}

class OnePoleLowpass {
  constructor() {
    this.state = 0;
  }

  reset() {
    this.state = 0;
  }

  process(input, coefficient) {
    this.state += (input - this.state) * coefficient;
    if (!Number.isFinite(this.state) || Math.abs(this.state) < SILENCE_FLOOR) this.state = 0;
    return this.state;
  }
}

/**
 * A feed-forward fractional delay: only the unprocessed input is written to
 * the line, so the reflected path can never form an unstable feedback loop.
 */
class FractionalPropagationDelay {
  constructor(rate, maximumSeconds = 0.25) {
    this.rate = rate;
    this.buffer = new Float32Array(Math.ceil(rate * maximumSeconds) + 4);
    this.writeIndex = 0;
  }

  reset() {
    this.buffer.fill(0);
    this.writeIndex = 0;
  }

  process(input, delaySeconds) {
    const maximumFrames = this.buffer.length - 3;
    const delayFrames = clamp(delaySeconds * this.rate, 1, maximumFrames);
    let readPosition = this.writeIndex - delayFrames;
    while (readPosition < 0) readPosition += this.buffer.length;
    const firstIndex = Math.floor(readPosition) % this.buffer.length;
    const secondIndex = (firstIndex + 1) % this.buffer.length;
    const fraction = readPosition - Math.floor(readPosition);
    const delayed = this.buffer[firstIndex]
      + (this.buffer[secondIndex] - this.buffer[firstIndex]) * fraction;
    this.buffer[this.writeIndex] = Number.isFinite(input) ? input : 0;
    this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
    return Number.isFinite(delayed) ? delayed : 0;
  }
}

class BlowholePhysicalProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = sampleRate;
    this.configuration = sanitizeBlowholeState(
      options.processorOptions?.configuration ?? BLOWHOLE_DEFAULTS,
    );
    this.call = blowholeCall(this.configuration.callId);
    this.renderedFrames = 0;
    this.playing = false;
    this.loop = false;
    this.manualGate = false;
    this.callStartFrame = 0;
    this.nextPulseIndex = 0;
    this.lastPhase = 0;
    this.startedCurrentCall = false;
    this.seed = 0x63657461;
    this.surfaceBreathSeed = 0x62726561;
    this.blockCounter = 0;
    // A call topology is swapped only after the old source reaches zero and at
    // the beginning of a render block. This avoids retuning live modal state
    // when moving between laryngeal tones, nasal whistles, and click sources.
    this.pendingConfiguration = null;
    this.pendingTransportIntent = null;
    this.callTransitionState = "steady";
    this.callTransitionGain = 1;
    this.callTransitionFadeOutStep = 1 / Math.max(
      1,
      CALL_RETARGET_FADE_OUT_SECONDS * this.rate,
    );
    this.callTransitionFadeInStep = 1 / Math.max(
      1,
      CALL_RETARGET_FADE_IN_SECONDS * this.rate,
    );

    // The external valve is a surface-breath performance state, not part of
    // the underwater source configuration. Keeping it separate preserves the
    // model's sealed-underwater anatomical contract.
    this.surfaceValveTarget = 0;
    this.surfaceValveAperture = 0;
    this.surfaceValveSourceGain = 1;
    this.surfaceValveCoefficient = smoothCoefficient(SURFACE_VALVE_SMOOTH_SECONDS, this.rate);
    this.surfaceBreathFlowCoefficient = smoothCoefficient(
      SURFACE_BREATH_FLOW_SMOOTH_SECONDS,
      this.rate,
    );
    this.surfaceBreathPressure = 0;
    this.surfaceBreathFlow = 0;
    this.surfaceBreathTargetFlow = 0;
    this.surfaceBreathAirVolume = 1;
    this.surfaceBreathPhase = "sealed";
    this.surfaceBreathFrame = 0;
    this.surfaceBreathInitialPressure = 0;
    this.surfaceBreathReleaseStartFlow = 0;
    this.surfaceBreathEventId = 0;
    this.surfaceBreathTriggerFrame = null;
    this.surfaceBreathPathGain = SURFACE_BREATH_RECEIVER_GAINS["water-calm"];
    this.surfaceValveCommandOpen = false;
    this.surfaceBreathProfile = surfaceBreathProfile(this.call);
    this.ventFilterLow = new StateVariableBandpass(this.rate);
    this.ventFilterHigh = new StateVariableBandpass(this.rate);
    this._configureSurfaceBreath(this.surfaceBreathProfile);

    this.phaseLeft = 0;
    this.phaseRight = 0.31;
    this.pulsePhase = 0;
    this.pulseEnvelope = 0;
    this.clickPulseFramesRemaining = 0;
    this.clickPulseFrameLength = 1;
    this.pneumaticReservoir = 0;
    this.foldMemoryLeft = 0;
    this.foldMemoryRight = 0;
    this.smoothed = {
      pressure: 0,
      frequencyLeft: 220,
      frequencyRight: 222,
      pulseRateHz: 0,
      closure: this.configuration.closure,
      focus: this.configuration.focus,
      roughness: this.configuration.roughness,
      asymmetry: this.configuration.asymmetry,
    };
    this.target = { ...this.smoothed };
    this.lastPlan = createBlowholeVoicePlan(this.configuration, 0);
    this.currentPhysicalFrequencyHz = this.lastPlan.physicalFrequencyHz;
    this.currentMonitorFrequencyHz = this.lastPlan.monitorFrequencyHz;

    this.clickModesLeft = [0, 1, 2].map(() => new DampedMode(this.rate));
    this.clickModesRight = [0, 1, 2].map(() => new DampedMode(this.rate));
    this.nasalColorLeft = new StateVariableBandpass(this.rate);
    this.nasalColorRight = new StateVariableBandpass(this.rate);
    this.sacMode = new StateVariableBandpass(this.rate);
    this.spermacetiMode = new DampedMode(this.rate);
    this.bodyModes = [0, 1, 2].map(() => new StateVariableBandpass(this.rate));
    this.acousticDelayLeft = new AcousticDelayLine(this.rate);
    this.acousticDelayRight = new AcousticDelayLine(this.rate);

    this.propagationDelayLeft = new FractionalPropagationDelay(this.rate);
    this.propagationDelayRight = new FractionalPropagationDelay(this.rate);
    this.propagationDirectLowpassLeft = new OnePoleLowpass();
    this.propagationDirectLowpassRight = new OnePoleLowpass();
    this.propagationReflectionLowpassLeft = new OnePoleLowpass();
    this.propagationReflectionLowpassRight = new OnePoleLowpass();
    this.propagationParameterCoefficient = smoothCoefficient(0.12, this.rate);
    this.propagationPhasePrimary = 0;
    this.propagationPhaseSecondary = 0.271;
    this.propagationOutputLeft = 0;
    this.propagationOutputRight = 0;
    this.propagationTarget = {
      mix: 0,
      directGain: 1,
      directFilterCoefficient: 1,
      reflectionFilterCoefficient: 1,
      reflectionGain: 0,
      reflectionDelaySeconds: 0.008,
      reflectionSpreadSeconds: 0,
      modulationDepthSeconds: 0,
      modulationRateHz: 0,
      flutterDepth: 0,
    };
    this.propagationSmoothed = { ...this.propagationTarget };
    this.propagationMetadata = {
      presetId: "water-calm",
      label: "Calm Water",
      medium: "water",
      condition: "calm",
      speedMps: 1_500,
      distanceM: 0,
      travelTimeMs: 0,
    };
    this._setPropagationTarget(this.lastPlan);
    this._snapPropagationParameters();

    this.dcLeft = 0;
    this.dcRight = 0;
    this.lastPeak = 0;
    this.lastRms = 0;
    this.port.onmessage = (event) => this._handleMessage(event.data);
    this._configureFilters(this.lastPlan);
  }

  _configureSurfaceBreath(profile = surfaceBreathProfile(this.call)) {
    this.surfaceBreathProfile = profile;
    this.ventFilterLow.configure(profile.lowFrequencyHz, profile.lowBandwidthHz);
    this.ventFilterHigh.configure(profile.highFrequencyHz, profile.highBandwidthHz);
  }

  _surfaceBreathReceiverGain() {
    const configuration = this.pendingConfiguration ?? this.configuration;
    const propagation = deriveBlowholePropagation(configuration);
    // These are perceptual monitor trims, not a conversion between airborne
    // pascals and underwater micropascals. Comparing published close-range
    // humpback breath and typical song source levels suggests a gap of roughly
    // 19 dB, so the submerged scenes must not disappear into the noise floor.
    return SURFACE_BREATH_RECEIVER_GAINS[propagation.presetId]
      ?? SURFACE_BREATH_RECEIVER_GAINS["water-calm"];
  }

  _startSurfaceBreath(strength = 1) {
    const intensity = clamp(finiteOr(Number(strength), 1), 0, 1.4);
    if (intensity <= 0 || this.surfaceValveTarget <= SURFACE_VALVE_OPEN_THRESHOLD) return;
    const continuingRelease = this.surfaceBreathPhase === "release"
      && Math.abs(this.surfaceBreathFlow) > SURFACE_BREATH_PRESSURE_FLOOR;
    if (!continuingRelease) {
      this.ventFilterLow.reset();
      this.ventFilterHigh.reset();
      this.surfaceBreathFlow = 0;
    }
    this._configureSurfaceBreath();
    const respiratoryDrive = 0.35 + clamp(this.configuration.pressure) * 0.65;
    this.surfaceBreathInitialPressure = clamp(respiratoryDrive * intensity, 0, 1.4);
    this.surfaceBreathPressure = this.surfaceBreathInitialPressure;
    this.surfaceBreathTargetFlow = 0;
    this.surfaceBreathAirVolume = 1;
    this.surfaceBreathReleaseStartFlow = 0;
    this.surfaceBreathFrame = 0;
    this.surfaceBreathPhase = "exhale";
    this.surfaceBreathPathGain = this._surfaceBreathReceiverGain();
    this.surfaceBreathEventId += 1;
  }

  _releaseSurfaceBreath() {
    if (this.surfaceBreathPhase === "sealed" || this.surfaceBreathPhase === "open-idle") {
      this.surfaceBreathPressure = 0;
      this.surfaceBreathFlow = 0;
      this.surfaceBreathTargetFlow = 0;
      this.surfaceBreathPhase = this.surfaceValveCommandOpen ? "open-idle" : "sealed";
      return;
    }
    this.surfaceBreathReleaseStartFlow = this.surfaceBreathFlow;
    this.surfaceBreathPressure = 0;
    this.surfaceBreathFrame = 0;
    this.surfaceBreathPhase = "release";
  }

  _finishSurfaceBreath() {
    this.surfaceBreathPressure = 0;
    this.surfaceBreathFlow = 0;
    this.surfaceBreathTargetFlow = 0;
    this.surfaceBreathInitialPressure = 0;
    this.surfaceBreathReleaseStartFlow = 0;
    this.surfaceBreathAirVolume = 1;
    this.surfaceBreathFrame = 0;
    this.surfaceBreathPhase = this.surfaceValveCommandOpen ? "open-idle" : "sealed";
    this.ventFilterLow.reset();
    this.ventFilterHigh.reset();
  }

  _surfaceBreathProgress() {
    if (this.surfaceBreathPhase === "exhale") {
      return clamp(1 - Math.sqrt(this.surfaceBreathAirVolume));
    }
    if (this.surfaceBreathPhase === "inhale") {
      return clamp(this.surfaceBreathAirVolume);
    }
    if (this.surfaceBreathPhase === "release") {
      return clamp(
        this.surfaceBreathFrame / Math.max(1, SURFACE_BREATH_RELEASE_SECONDS * this.rate),
      );
    }
    return 0;
  }

  _triggerSurfaceBreathIfOpen() {
    const breathActive = ["exhale", "inhale", "release"].includes(this.surfaceBreathPhase);
    if (!this.surfaceValveCommandOpen || breathActive) return false;
    const previousEventId = this.surfaceBreathEventId;
    this._startSurfaceBreath();
    return this.surfaceBreathEventId !== previousEventId;
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      const base = this.pendingConfiguration ?? this.configuration;
      const nextConfiguration = sanitizeBlowholeState(
        { ...base, ...(message.configuration ?? {}) },
        base,
      );
      const callChanged = nextConfiguration.callId !== this.call.id;
      if (callChanged && (this.playing || this.manualGate)) {
        // Repeated UI updates during the fade replace/extend the pending
        // configuration without restarting the fade or touching transport.
        this.pendingConfiguration = nextConfiguration;
        this.pendingTransportIntent = {
          playing: this.playing,
          loop: this.loop,
          manualGate: this.manualGate,
        };
        this.callTransitionState = "fading-out";
      } else {
        // Switching back to the current call before the pending commit simply
        // cancels the swap and returns smoothly to unity.
        this.pendingConfiguration = null;
        this.pendingTransportIntent = null;
        if (callChanged) {
          this._commitCallConfiguration(nextConfiguration);
        } else {
          this.configuration = nextConfiguration;
          if (this.callTransitionGain < 1) this.callTransitionState = "fading-in";
        }
      }
      return;
    }
    if (message.type === "play" || message.type === "trigger") {
      if (message.callId) {
        this.configuration = sanitizeBlowholeState(
          { ...this.configuration, callId: message.callId },
          this.configuration,
        );
        this.call = blowholeCall(this.configuration.callId);
      }
      this.playing = true;
      this.loop = Boolean(message.loop);
      this.manualGate = false;
      const delaySeconds = clamp(Number(message.delaySeconds), 0, 2);
      this.callStartFrame = this.renderedFrames + Math.round(delaySeconds * this.rate);
      this.surfaceBreathTriggerFrame = this.surfaceValveCommandOpen
        ? this.callStartFrame
        : null;
      this.lastPhase = 0;
      this.nextPulseIndex = 0;
      this.pulsePhase = 0;
      this.startedCurrentCall = false;
      if (this.pendingTransportIntent) {
        this.pendingTransportIntent = {
          playing: this.playing,
          loop: this.loop,
          manualGate: this.manualGate,
        };
      }
      return;
    }
    if (message.type === "manual" || message.type === "gate") {
      this.manualGate = Boolean(message.active ?? message.value);
      if (this.manualGate) {
        this.playing = false;
        this.lastPhase = 0.45;
        this.pulsePhase = 0;
      }
      if (this.pendingTransportIntent) {
        this.pendingTransportIntent = {
          playing: this.playing,
          loop: this.loop,
          manualGate: this.manualGate,
        };
      }
      return;
    }
    if (message.type === "surfaceValve") {
      const requested = message.aperture
        ?? message.value
        ?? (message.active === true ? 1 : message.active === false ? 0 : 0);
      let aperture = 0;
      try {
        aperture = Number(requested);
      } catch {
        aperture = 0;
      }
      const requestedTarget = clamp(aperture, 0, 1);
      this.surfaceValveTarget = requestedTarget <= SURFACE_VALVE_OPEN_THRESHOLD
        ? 0
        : requestedTarget;
      if (!this.surfaceValveCommandOpen && this.surfaceValveTarget > SURFACE_VALVE_OPEN_THRESHOLD) {
        this.surfaceValveCommandOpen = true;
        this._startSurfaceBreath();
      } else if (this.surfaceValveCommandOpen && this.surfaceValveTarget === 0) {
        this.surfaceValveCommandOpen = false;
        this.surfaceBreathTriggerFrame = null;
        this._releaseSurfaceBreath();
      }
      return;
    }
    if (message.type === "stop") {
      this.pendingConfiguration = null;
      this.pendingTransportIntent = null;
      this.callTransitionState = this.callTransitionGain < 1 ? "fading-in" : "steady";
      this.playing = false;
      this.loop = false;
      this.surfaceBreathTriggerFrame = null;
      this.lastPhase = 0;
      this.startedCurrentCall = false;
      return;
    }
    if (message.type === "loop") {
      this.loop = Boolean(message.active);
      if (this.pendingTransportIntent) this.pendingTransportIntent.loop = this.loop;
      return;
    }
    if (message.type === "silence" || message.type === "panic") this._silence();
  }

  _silence() {
    this.playing = false;
    this.loop = false;
    this.manualGate = false;
    this.pendingConfiguration = null;
    this.pendingTransportIntent = null;
    this.callTransitionState = "steady";
    this.callTransitionGain = 1;
    this.surfaceValveTarget = 0;
    this.surfaceValveAperture = 0;
    this.surfaceValveSourceGain = 1;
    this.surfaceValveCommandOpen = false;
    this.surfaceBreathSeed = 0x62726561;
    this.surfaceBreathPressure = 0;
    this.surfaceBreathFlow = 0;
    this.surfaceBreathTargetFlow = 0;
    this.surfaceBreathInitialPressure = 0;
    this.surfaceBreathReleaseStartFlow = 0;
    this.surfaceBreathAirVolume = 1;
    this.surfaceBreathFrame = 0;
    this.surfaceBreathPhase = "sealed";
    this.surfaceBreathEventId = 0;
    this.surfaceBreathTriggerFrame = null;
    this.pulseEnvelope = 0;
    this.clickPulseFramesRemaining = 0;
    this.clickPulseFrameLength = 1;
    this.pneumaticReservoir = 0;
    this.lastPhase = 0;
    this.startedCurrentCall = false;
    this.smoothed.pressure = 0;
    this.dcLeft = 0;
    this.dcRight = 0;
    this.acousticDelayLeft.reset();
    this.acousticDelayRight.reset();
    this._resetPropagation();
    this.ventFilterLow.reset();
    this.ventFilterHigh.reset();
    for (const mode of [...this.clickModesLeft, ...this.clickModesRight]) mode.reset();
    this.nasalColorLeft.reset();
    this.nasalColorRight.reset();
    this.sacMode.reset();
    this.spermacetiMode.reset();
    for (const mode of this.bodyModes) mode.reset();
  }

  _resetSourceState() {
    this.nextPulseIndex = 0;
    this.pulsePhase = 0;
    this.pulseEnvelope = 0;
    this.clickPulseFramesRemaining = 0;
    this.clickPulseFrameLength = 1;
    this.pneumaticReservoir = 0;
    this.phaseLeft = 0;
    this.phaseRight = 0.31;
    this.foldMemoryLeft = 0;
    this.foldMemoryRight = 0;
    this.startedCurrentCall = false;

    this.acousticDelayLeft.reset();
    this.acousticDelayRight.reset();
    for (const mode of [...this.clickModesLeft, ...this.clickModesRight]) mode.reset();
    this.nasalColorLeft.reset();
    this.nasalColorRight.reset();
    this.sacMode.reset();
    this.spermacetiMode.reset();
    for (const mode of this.bodyModes) mode.reset();
  }

  _commitCallConfiguration(configuration) {
    this.configuration = sanitizeBlowholeState(configuration, this.configuration);
    this.call = blowholeCall(this.configuration.callId);
    this._resetSourceState();

    const phase = this.manualGate ? 0.45 : 0;
    this.lastPhase = phase;
    if (this.playing) this.callStartFrame = this.renderedFrames;
    const plan = createBlowholeVoicePlan(this.configuration, phase);
    const active = this.manualGate || this.playing;
    this._updateTargets(plan, active);
    this.smoothed.pressure = 0;
    this.smoothed.frequencyLeft = this.target.frequencyLeft;
    this.smoothed.frequencyRight = this.target.frequencyRight;
    this.smoothed.pulseRateHz = this.target.pulseRateHz;
    this.smoothed.closure = this.target.closure;
    this.smoothed.focus = this.target.focus;
    this.smoothed.roughness = this.target.roughness;
    this.smoothed.asymmetry = this.target.asymmetry;
    this._configureFilters(plan);
  }

  _commitPendingCallAtBlockBoundary() {
    if (
      this.callTransitionState !== "fading-out"
      || this.callTransitionGain > 0
      || !this.pendingConfiguration
    ) return;
    const configuration = this.pendingConfiguration;
    const transportIntent = this.pendingTransportIntent;
    this.pendingConfiguration = null;
    this.pendingTransportIntent = null;
    if (transportIntent) {
      this.playing = transportIntent.playing;
      this.loop = transportIntent.loop;
      this.manualGate = transportIntent.manualGate;
    }
    this._commitCallConfiguration(configuration);
    this.callTransitionState = "fading-in";
  }

  _advanceCallTransition() {
    if (this.callTransitionState === "fading-out") {
      this.callTransitionGain = Math.max(
        0,
        this.callTransitionGain - this.callTransitionFadeOutStep,
      );
      return;
    }
    if (this.callTransitionState === "fading-in") {
      this.callTransitionGain = Math.min(
        1,
        this.callTransitionGain + this.callTransitionFadeInStep,
      );
      if (this.callTransitionGain >= 1) this.callTransitionState = "steady";
    }
  }

  _smoothSurfaceValve() {
    this.surfaceValveAperture += (
      this.surfaceValveTarget - this.surfaceValveAperture
    ) * this.surfaceValveCoefficient;
    if (this.surfaceValveTarget === 0 && this.surfaceValveAperture < 1e-7) {
      this.surfaceValveAperture = 0;
    } else if (this.surfaceValveTarget === 1 && this.surfaceValveAperture > 1 - 1e-7) {
      this.surfaceValveAperture = 1;
    }
  }

  _random() {
    this.seed = xorshift(this.seed);
    return (this.seed >>> 0) / 4_294_967_295 * 2 - 1;
  }

  _surfaceBreathRandom() {
    this.surfaceBreathSeed = xorshift(this.surfaceBreathSeed);
    return (this.surfaceBreathSeed >>> 0) / 4_294_967_295 * 2 - 1;
  }

  _phaseAtFrame(frame) {
    if (this.manualGate) return 0.45;
    if (frame < this.callStartFrame) return 0;
    // Preserve a natural completion at phase 1 long enough for the main
    // thread to distinguish it from an explicit stop at phase 0.
    if (!this.playing) return this.lastPhase;
    this.startedCurrentCall = true;
    const durationFrames = Math.max(1, Math.round(this.call.durationMs * this.rate / 1_000));
    let elapsed = frame - this.callStartFrame;
    if (elapsed >= durationFrames) {
      if (!this.loop) {
        // A requested live call remains transport-active long enough for its
        // fade-out and block-boundary swap to complete, even if the outgoing
        // authored gesture reaches its endpoint during those few milliseconds.
        if (this.pendingConfiguration && this.callTransitionState === "fading-out") {
          this.lastPhase = 1;
          return 1;
        }
        this.playing = false;
        this.lastPhase = 1;
        return 1;
      }
      const loops = Math.floor(elapsed / durationFrames);
      this.callStartFrame += loops * durationFrames;
      elapsed = frame - this.callStartFrame;
      this.nextPulseIndex = 0;
      this.lastPhase = 0;
    }
    return clamp(elapsed / durationFrames);
  }

  _planAt(phase) {
    const plan = createBlowholeVoicePlan(this.configuration, phase);
    if (!this.manualGate) return plan;
    const manualPulseRange = this.call.physicalRange.pulseRateHz;
    const manualPulseRateHz = manualPulseRange[1] > 0
      ? clamp(this.configuration.pulseRateHz, manualPulseRange[0], manualPulseRange[1])
      : 0;
    const manualFundamentalHz = this.call.pulseLockedToFundamental
      ? clamp(
        manualPulseRateHz * 2 ** (
          (this.configuration.tension - this.call.controlDefaults.tension) * 1.5
        ),
        this.call.physicalRange.frequencyHz[0],
        this.call.physicalRange.frequencyHz[1],
      )
      : null;
    const monitorRatio = plan.monitorFrequencyHz / Math.max(1e-9, plan.physicalFrequencyHz);
    const voices = plan.voices.map((voice, index) => ({
      ...voice,
      physicalFrequencyHz: manualFundamentalHz ?? voice.physicalFrequencyHz,
      monitorFrequencyHz: manualFundamentalHz == null
        ? voice.monitorFrequencyHz
        : manualFundamentalHz * monitorRatio,
      gain: clamp(this.configuration.pressure * this.configuration.level
        * (index === 0 ? 0.78 : 0.56), 0, 1),
      pulseRateHz: manualFundamentalHz ?? manualPulseRateHz,
      closure: this.configuration.closure,
      roughness: this.configuration.roughness,
    }));
    return {
      ...plan,
      physicalFrequencyHz: manualFundamentalHz ?? plan.physicalFrequencyHz,
      audibleFrequencyHz: manualFundamentalHz == null
        ? plan.audibleFrequencyHz
        : manualFundamentalHz * 2 ** plan.audibleShiftOctaves,
      monitorFrequencyHz: manualFundamentalHz == null
        ? plan.monitorFrequencyHz
        : manualFundamentalHz * monitorRatio,
      pulseRateHz: manualFundamentalHz ?? manualPulseRateHz,
      focus: this.configuration.focus,
      voices,
    };
  }

  _updateTargets(plan, active) {
    const left = plan.voices[0];
    const right = plan.voices[1] ?? left;
    const gesture = evaluateBlowholeGesture(this.call, plan.phase, this.configuration);
    const depthExcess = this.call.family === "mysticete"
      ? Math.max(0, this.configuration.depthM - 100)
      : 0;
    const depthGain = this.call.family === "mysticete"
      ? 1 / (1 + Math.pow(depthExcess / 180, 2))
      : 1;
    this.target.pressure = active
      ? clamp((this.manualGate ? this.configuration.pressure : gesture.pressure) * depthGain)
      : 0;
    this.target.frequencyLeft = clamp(left?.monitorFrequencyHz ?? plan.monitorFrequencyHz, 12, this.rate * 0.44);
    this.target.frequencyRight = clamp(right?.monitorFrequencyHz ?? this.target.frequencyLeft, 12, this.rate * 0.44);
    this.target.pulseRateHz = this.manualGate
      ? plan.pulseRateHz
      : clamp(plan.pulseRateHz, 0, 10_000);
    this.target.closure = this.manualGate ? this.configuration.closure : gesture.closure;
    this.target.focus = this.manualGate ? this.configuration.focus : plan.focus;
    this.target.roughness = this.manualGate ? this.configuration.roughness : gesture.roughness;
    this.target.asymmetry = this.manualGate ? this.configuration.asymmetry : gesture.asymmetryBipolar;
    this.currentPhysicalFrequencyHz = plan.physicalFrequencyHz;
    this.currentMonitorFrequencyHz = plan.monitorFrequencyHz;
    this.lastPlan = plan;
  }

  _configureFilters(plan) {
    const center = clamp(plan.monitorFrequencyHz, 28, this.rate * 0.19);
    const focus = clamp(plan.focus);
    const scale = this.configuration.scale;
    const clickRatios = [0.58, 1, 1.62];
    for (let index = 0; index < clickRatios.length; index += 1) {
      const frequency = clamp(center * clickRatios[index], 30, this.rate * 0.46);
      const decay = 0.0005 + (1 - focus) * 0.004 + index * 0.0006;
      this.clickModesLeft[index].configure(frequency * (1 - this.configuration.asymmetry * 0.018), decay);
      this.clickModesRight[index].configure(frequency * (1 + this.configuration.asymmetry * 0.018), decay);
    }
    const nasalCenter = clamp(center * (0.68 + focus * 0.38), 45, this.rate * 0.19);
    this.nasalColorLeft.configure(nasalCenter * 0.992, nasalCenter * (0.12 + (1 - focus) * 0.72));
    this.nasalColorRight.configure(nasalCenter * 1.008, nasalCenter * (0.12 + (1 - focus) * 0.72));

    const sacFrequency = this.call.family === "mysticete"
      ? 32 + (1 - scale) * 155
      : 120 + (1 - scale) * 480;
    this.sacMode.configure(sacFrequency, 24 + (1 - this.configuration.recycle) * sacFrequency * 0.62);
    [1, 2.07, 3.54].forEach((ratio, index) => {
      const bodyCenter = clamp(
        (this.call.family === "mysticete" ? center : Math.max(90, center * 0.18)) * ratio,
        22,
        this.rate * 0.18,
      );
      this.bodyModes[index].configure(
        bodyCenter,
        bodyCenter * (0.08 + index * 0.05 + (1 - focus) * 0.2),
      );
    });
    if (this.call.id === "sperm-whale-coda") {
      this.spermacetiMode.configure(
        clamp(center * 0.46, 24, this.rate * 0.18),
        0.003 + this.configuration.scale * 0.009,
      );
    }
  }

  _propagationFilterCoefficient(frequencyHz) {
    const cutoffHz = clamp(frequencyHz, 24, this.rate * 0.48);
    return clamp(1 - Math.exp(-TAU * cutoffHz / this.rate), 0.0001, 1);
  }

  _setPropagationTarget(plan) {
    const propagation = plan?.propagation ?? deriveBlowholePropagation(this.configuration);
    const requestedId = typeof propagation?.presetId === "string"
      ? propagation.presetId
      : propagation?.id;
    const presetId = PROPAGATION_PROFILE_IDS.includes(requestedId)
      ? requestedId
      : "water-calm";
    const directCutoffHz = clamp(
      finiteOr(propagation?.directCutoffHz, propagation?.cutoffHz ?? 18_000),
      24,
      this.rate * 0.48,
    );
    const reflectionCutoffHz = clamp(
      finiteOr(propagation?.reflectionCutoffHz, directCutoffHz * 0.72),
      24,
      this.rate * 0.48,
    );
    const reflectionGain = Number.isFinite(propagation?.signedReflectionGain)
      ? propagation.signedReflectionGain
      : finiteOr(propagation?.reflectionGain, 0)
        * (finiteOr(propagation?.reflectionPolarity, 1) < 0 ? -1 : 1);
    const reflectionDelaySeconds = Number.isFinite(propagation?.reflectionDelaySeconds)
      ? propagation.reflectionDelaySeconds
      : finiteOr(propagation?.reflectionDelayMs, 8) / 1_000;
    const reflectionSpreadSeconds = Number.isFinite(propagation?.reflectionSpreadSeconds)
      ? propagation.reflectionSpreadSeconds
      : finiteOr(propagation?.reflectionSpreadMs, 0) / 1_000;
    const modulationDepthSeconds = Number.isFinite(propagation?.modulationDepthSeconds)
      ? propagation.modulationDepthSeconds
      : finiteOr(propagation?.modulationDepthMs, 0) / 1_000;

    this.propagationTarget.mix = clamp(finiteOr(propagation?.mix, 0));
    this.propagationTarget.directGain = clamp(finiteOr(propagation?.directGain, 1), 0, 1);
    this.propagationTarget.directFilterCoefficient = this._propagationFilterCoefficient(
      directCutoffHz,
    );
    this.propagationTarget.reflectionFilterCoefficient = this._propagationFilterCoefficient(
      reflectionCutoffHz,
    );
    this.propagationTarget.reflectionGain = clamp(reflectionGain, -0.6, 0.6);
    this.propagationTarget.reflectionDelaySeconds = clamp(
      reflectionDelaySeconds,
      1 / this.rate,
      0.24,
    );
    this.propagationTarget.reflectionSpreadSeconds = clamp(
      reflectionSpreadSeconds,
      0,
      0.04,
    );
    this.propagationTarget.modulationDepthSeconds = clamp(
      modulationDepthSeconds,
      0,
      0.01,
    );
    this.propagationTarget.modulationRateHz = clamp(
      finiteOr(propagation?.modulationRateHz, 0),
      0,
      5,
    );
    this.propagationTarget.flutterDepth = clamp(
      finiteOr(propagation?.flutterDepth, 0),
      0,
      0.25,
    );
    this.propagationMetadata.presetId = presetId;
    this.propagationMetadata.label = typeof propagation?.label === "string"
      ? propagation.label
      : presetId;
    this.propagationMetadata.medium = propagation?.medium === "air" ? "air" : "water";
    this.propagationMetadata.condition = typeof propagation?.condition === "string"
      ? propagation.condition
      : "calm";
    this.propagationMetadata.speedMps = clamp(
      finiteOr(propagation?.speedMps, this.propagationMetadata.medium === "air" ? 343 : 1_500),
      250,
      1_700,
    );
    this.propagationMetadata.distanceM = clamp(finiteOr(propagation?.distanceM, 0), 0, 100_000);
    this.propagationMetadata.travelTimeMs = Math.max(
      0,
      finiteOr(
        propagation?.travelTimeMs,
        finiteOr(propagation?.travelTimeSeconds, 0) * 1_000,
      ),
    );
    this.propagationMetadata.directCutoffHz = directCutoffHz;
    this.propagationMetadata.reflectionCutoffHz = reflectionCutoffHz;
    this.propagationMetadata.reflectionDelayMs = this.propagationTarget.reflectionDelaySeconds * 1_000;
    this.propagationMetadata.reflectionSpreadMs = this.propagationTarget.reflectionSpreadSeconds * 1_000;
  }

  _snapPropagationParameters() {
    const target = this.propagationTarget;
    const smoothed = this.propagationSmoothed;
    smoothed.mix = target.mix;
    smoothed.directGain = target.directGain;
    smoothed.directFilterCoefficient = target.directFilterCoefficient;
    smoothed.reflectionFilterCoefficient = target.reflectionFilterCoefficient;
    smoothed.reflectionGain = target.reflectionGain;
    smoothed.reflectionDelaySeconds = target.reflectionDelaySeconds;
    smoothed.reflectionSpreadSeconds = target.reflectionSpreadSeconds;
    smoothed.modulationDepthSeconds = target.modulationDepthSeconds;
    smoothed.modulationRateHz = target.modulationRateHz;
    smoothed.flutterDepth = target.flutterDepth;
  }

  _resetPropagation() {
    this.propagationDelayLeft.reset();
    this.propagationDelayRight.reset();
    this.propagationDirectLowpassLeft.reset();
    this.propagationDirectLowpassRight.reset();
    this.propagationReflectionLowpassLeft.reset();
    this.propagationReflectionLowpassRight.reset();
    this.propagationPhasePrimary = 0;
    this.propagationPhaseSecondary = 0.271;
    this.propagationOutputLeft = 0;
    this.propagationOutputRight = 0;
    this._snapPropagationParameters();
  }

  _smoothPropagationParameters() {
    const amount = this.propagationParameterCoefficient;
    const target = this.propagationTarget;
    const smoothed = this.propagationSmoothed;
    // A zero mix is a true bypass rather than an asymptotic approximation.
    smoothed.mix = target.mix === 0
      ? 0
      : smoothed.mix + (target.mix - smoothed.mix) * amount;
    smoothed.directGain += (target.directGain - smoothed.directGain) * amount;
    smoothed.directFilterCoefficient += (
      target.directFilterCoefficient - smoothed.directFilterCoefficient
    ) * amount;
    smoothed.reflectionFilterCoefficient += (
      target.reflectionFilterCoefficient - smoothed.reflectionFilterCoefficient
    ) * amount;
    smoothed.reflectionGain += (target.reflectionGain - smoothed.reflectionGain) * amount;
    smoothed.reflectionDelaySeconds += (
      target.reflectionDelaySeconds - smoothed.reflectionDelaySeconds
    ) * amount;
    smoothed.reflectionSpreadSeconds += (
      target.reflectionSpreadSeconds - smoothed.reflectionSpreadSeconds
    ) * amount;
    smoothed.modulationDepthSeconds += (
      target.modulationDepthSeconds - smoothed.modulationDepthSeconds
    ) * amount;
    smoothed.modulationRateHz += (
      target.modulationRateHz - smoothed.modulationRateHz
    ) * amount;
    smoothed.flutterDepth += (target.flutterDepth - smoothed.flutterDepth) * amount;
  }

  _processPropagation(inputLeft, inputRight) {
    this._smoothPropagationParameters();
    const parameters = this.propagationSmoothed;
    const primary = Math.sin(TAU * this.propagationPhasePrimary);
    const secondary = Math.sin(TAU * this.propagationPhaseSecondary);
    const modulationLeft = primary * 0.68 + secondary * 0.32;
    const modulationRight = Math.sin(TAU * (this.propagationPhasePrimary + 0.193)) * 0.68
      + Math.sin(TAU * (this.propagationPhaseSecondary + 0.417)) * 0.32;
    this.propagationPhasePrimary += parameters.modulationRateHz / this.rate;
    this.propagationPhaseSecondary += parameters.modulationRateHz * 0.61803398875 / this.rate;
    if (this.propagationPhasePrimary >= 1) this.propagationPhasePrimary -= 1;
    if (this.propagationPhaseSecondary >= 1) this.propagationPhaseSecondary -= 1;

    const halfSpread = parameters.reflectionSpreadSeconds * 0.5;
    const reflectionDelayLeft = parameters.reflectionDelaySeconds - halfSpread
      + parameters.modulationDepthSeconds * modulationLeft;
    const reflectionDelayRight = parameters.reflectionDelaySeconds + halfSpread
      + parameters.modulationDepthSeconds * modulationRight;
    const delayedLeft = this.propagationDelayLeft.process(inputLeft, reflectionDelayLeft);
    const delayedRight = this.propagationDelayRight.process(inputRight, reflectionDelayRight);
    const directLeft = this.propagationDirectLowpassLeft.process(
      inputLeft,
      parameters.directFilterCoefficient,
    );
    const directRight = this.propagationDirectLowpassRight.process(
      inputRight,
      parameters.directFilterCoefficient,
    );
    const reflectedLeft = this.propagationReflectionLowpassLeft.process(
      delayedLeft,
      parameters.reflectionFilterCoefficient,
    );
    const reflectedRight = this.propagationReflectionLowpassRight.process(
      delayedRight,
      parameters.reflectionFilterCoefficient,
    );

    // Turbulence/flutter changes level only. Delay modulation is confined to
    // the reflected tap, so changing medium never retunes the direct call.
    const flutterLeft = 1 + parameters.flutterDepth * modulationLeft;
    const flutterRight = 1 + parameters.flutterDepth * modulationRight;
    const maximumWetGain = Math.abs(parameters.directGain)
      * (1 + Math.abs(parameters.flutterDepth))
      + Math.abs(parameters.reflectionGain);
    const wetNormalization = 1 / Math.max(1, maximumWetGain);
    const wetLeft = (
      directLeft * parameters.directGain * flutterLeft
      + reflectedLeft * parameters.reflectionGain
    ) * wetNormalization;
    const wetRight = (
      directRight * parameters.directGain * flutterRight
      + reflectedRight * parameters.reflectionGain
    ) * wetNormalization;
    const mixAmount = this.propagationTarget.mix === 0 ? 0 : clamp(parameters.mix);
    this.propagationOutputLeft = mixAmount === 0
      ? inputLeft
      : inputLeft + (wetLeft - inputLeft) * mixAmount;
    this.propagationOutputRight = mixAmount === 0
      ? inputRight
      : inputRight + (wetRight - inputRight) * mixAmount;
  }

  _smoothParameters() {
    const fast = smoothCoefficient(0.006, this.rate);
    const pitch = smoothCoefficient(0.012, this.rate);
    if (this.call.sourceFamily === BLOWHOLE_SOURCE_FAMILIES.ODONTOCETE) {
      const filling = this.target.pressure > this.pneumaticReservoir;
      const reservoirSeconds = filling
        ? 0.004
        : 0.008 + this.configuration.recycle * 0.07;
      const reservoirCoefficient = smoothCoefficient(reservoirSeconds, this.rate);
      this.pneumaticReservoir += (
        this.target.pressure - this.pneumaticReservoir
      ) * reservoirCoefficient;
      this.smoothed.pressure += (this.pneumaticReservoir - this.smoothed.pressure) * fast;
    } else {
      this.pneumaticReservoir = 0;
      this.smoothed.pressure += (this.target.pressure - this.smoothed.pressure) * fast;
    }
    this.smoothed.frequencyLeft += (this.target.frequencyLeft - this.smoothed.frequencyLeft) * pitch;
    this.smoothed.frequencyRight += (this.target.frequencyRight - this.smoothed.frequencyRight) * pitch;
    this.smoothed.pulseRateHz += (this.target.pulseRateHz - this.smoothed.pulseRateHz) * fast;
    this.smoothed.closure += (this.target.closure - this.smoothed.closure) * fast;
    this.smoothed.focus += (this.target.focus - this.smoothed.focus) * fast;
    this.smoothed.roughness += (this.target.roughness - this.smoothed.roughness) * fast;
    this.smoothed.asymmetry += (this.target.asymmetry - this.smoothed.asymmetry) * fast;
  }

  _crossedAuthoredPulse(phase) {
    if (!this.playing || !this.startedCurrentCall || this.call.pulseTimes.length === 0) return false;
    const next = this.call.pulseTimes[this.nextPulseIndex];
    if (next == null || phase + 1e-9 < next) return false;
    this.nextPulseIndex += 1;
    return true;
  }

  _pulseTrigger(phase) {
    if (this.call.pulseTimes.length > 0 && !this.manualGate) {
      return this._crossedAuthoredPulse(phase);
    }
    const rate = clamp(this.smoothed.pulseRateHz, 0, 10_000);
    const onsetPressure = 0.018 + (1 - this.configuration.recycle) * 0.035;
    if (rate <= 0 || this.smoothed.pressure < onsetPressure) return false;
    this.pulsePhase += rate / this.rate;
    if (this.pulsePhase < 1) return false;
    this.pulsePhase -= Math.floor(this.pulsePhase);
    return true;
  }

  _renderOdontocete(phase) {
    const pressure = this.smoothed.pressure;
    const closure = this.smoothed.closure;
    const roughness = this.smoothed.roughness;
    const focus = this.smoothed.focus;
    const clickSource = /click|buzz|coda/.test(this.call.register);
    const pulsedCall = /pulsed/.test(this.call.register);
    const leftUnilateral = this.call.id === "bottlenose-signature-whistle";
    const rightUnilateral = this.call.id === "dolphin-search-clicks"
      || this.call.id === "dolphin-terminal-buzz"
      || this.call.id === "sperm-whale-coda";
    const triggered = clickSource && this._pulseTrigger(phase);

    if (clickSource) {
      if (triggered) {
        this.clickPulseFrameLength = Math.max(
          1,
          Math.round(this.lastPlan.pulseWidthMicroseconds * this.rate / 1_000_000),
        );
        this.clickPulseFramesRemaining = this.clickPulseFrameLength;
      }
      let pulseShape = 0;
      if (this.clickPulseFramesRemaining > 0) {
        const pulseIndex = this.clickPulseFrameLength - this.clickPulseFramesRemaining;
        pulseShape = Math.sin(
          Math.PI * (pulseIndex + 0.5) / this.clickPulseFrameLength,
        ) / Math.sqrt(this.clickPulseFrameLength);
        this.clickPulseFramesRemaining -= 1;
      }
      const impulse = pulseShape
        * pressure
        * (0.58 + closure * 0.72)
        * (1 + this._random() * roughness * 0.18);
      const leftWeight = rightUnilateral
        ? 0
        : Math.sqrt(clamp((1 - this.smoothed.asymmetry) * 0.5));
      const rightWeight = rightUnilateral
        ? 1
        : Math.sqrt(clamp((1 + this.smoothed.asymmetry) * 0.5));
      let left = 0;
      let right = 0;
      const modeGains = [0.56, 1, 0.48];
      for (let index = 0; index < 3; index += 1) {
        left += this.clickModesLeft[index].process(impulse * leftWeight) * modeGains[index];
        right += this.clickModesRight[index].process(impulse * rightWeight) * modeGains[index];
      }
      const delayedLeft = this.acousticDelayLeft.process(
        left,
        0.003 + this.configuration.scale * 0.009,
        0.08 + focus * 0.08,
      );
      const delayedRight = this.acousticDelayRight.process(
        right,
        this.call.id === "sperm-whale-coda"
          ? this.lastPlan.headReflectionDelaySeconds
          : 0.0034 + this.configuration.scale * 0.0095,
        this.call.id === "sperm-whale-coda" ? 0.22 : 0.08 + focus * 0.08,
      );
      left = left * (0.66 + focus * 0.52) + delayedLeft * 0.2;
      if (this.call.id === "sperm-whale-coda") {
        const caseMode = this.spermacetiMode.process(delayedRight);
        right = right * 0.36 + delayedRight * (0.76 + focus * 0.22) + caseMode * 1.15;
      } else {
        right = right * (0.66 + focus * 0.52) + delayedRight * 0.2;
      }
      const clickGain = this.call.id === "sperm-whale-coda" ? 9.5 : 8;
      if (rightUnilateral) {
        const source = right * 0.82 * clickGain;
        return [source * 0.96, source * 1.04];
      }
      return [left * 0.82 * clickGain, right * 0.82 * clickGain];
    }

    const stableRoughness = roughness * (1 - this.configuration.recycle * 0.38);
    const jitterLeft = 1 + this._random() * stableRoughness * 0.0028;
    const jitterRight = 1 + this._random() * stableRoughness * 0.0032;
    this.phaseLeft = (this.phaseLeft + this.smoothed.frequencyLeft * jitterLeft / this.rate) % 1;
    this.phaseRight = (this.phaseRight + this.smoothed.frequencyRight * jitterRight / this.rate) % 1;
    const lipWave = (cycle, memory, side) => {
      const angle = cycle * TAU;
      const opening = Math.sin(angle) + Math.sin(angle * 2 + side * 0.4) * 0.17;
      const collision = Math.tanh((opening + (closure - 0.5) * 0.38) * (1.6 + closure * 5.2));
      const derivative = collision - memory;
      return [collision * (0.6 - closure * 0.12) + derivative * (0.3 + closure * 0.5), collision];
    };
    const [sourceLeft, memoryLeft] = lipWave(this.phaseLeft, this.foldMemoryLeft, -1);
    const [sourceRight, memoryRight] = lipWave(this.phaseRight, this.foldMemoryRight, 1);
    this.foldMemoryLeft = memoryLeft;
    this.foldMemoryRight = memoryRight;
    const onsetPressure = 0.018 + (1 - this.configuration.recycle) * 0.035;
    const amplitude = Math.pow(clamp(
      (pressure - onsetPressure) / Math.max(0.001, 1 - onsetPressure),
    ), 1.22);
    const leftWeight = leftUnilateral
      ? 1
      : Math.sqrt(clamp((1 - this.smoothed.asymmetry) * 0.5));
    const rightWeight = leftUnilateral
      ? 0
      : Math.sqrt(clamp((1 + this.smoothed.asymmetry) * 0.5));
    // M1's pulse repetition is the oscillator fundamental itself, not a slow
    // amplitude gate over a separate carrier. The side is intentionally left
    // unassigned, so one computational source feeds the paired head filters.
    const m1Source = pulsedCall ? sourceLeft * amplitude : 0;
    const rawLeft = pulsedCall ? m1Source * 0.72 : sourceLeft * amplitude * leftWeight;
    const rawRight = pulsedCall ? m1Source * 0.72 : sourceRight * amplitude * rightWeight;
    const delayedLeft = this.acousticDelayLeft.process(
      rawLeft,
      0.004 + this.configuration.scale * 0.012,
      0.08 + focus * 0.08,
    );
    const delayedRight = this.acousticDelayRight.process(
      rawRight,
      0.0045 + this.configuration.scale * 0.012,
      0.08 + focus * 0.08,
    );
    const coloredLeft = this.nasalColorLeft.process(rawLeft + delayedLeft * 0.22);
    const coloredRight = this.nasalColorRight.process(rawRight + delayedRight * 0.22);
    const outputLeft = rawLeft * (0.16 + focus * 0.16) + coloredLeft * (0.72 + focus * 0.42);
    const outputRight = rawRight * (0.16 + focus * 0.16) + coloredRight * (0.72 + focus * 0.42);
    if (leftUnilateral) return [outputLeft * 1.04, outputLeft * 0.96];
    return [outputLeft, outputRight];
  }

  _renderMysticete() {
    const pressure = this.smoothed.pressure;
    const closure = this.smoothed.closure;
    const roughness = this.smoothed.roughness;
    const focus = this.smoothed.focus;
    const onsetPressure = 0.025 + (1 - closure) * 0.12;
    const sourceGain = Math.pow(clamp((pressure - onsetPressure) / (1 - onsetPressure)), 1.3);
    const instability = 1 + Math.sin(this.renderedFrames * 0.000071) * roughness * 0.026;
    this.phaseLeft = (this.phaseLeft + this.smoothed.frequencyLeft * instability / this.rate) % 1;
    this.phaseRight = (
      this.phaseRight
      + this.smoothed.frequencyRight * (2 - instability + this.smoothed.asymmetry * 0.006) / this.rate
    ) % 1;

    const foldContact = (phase, previous, side) => {
      const angle = phase * TAU;
      const fundamental = Math.sin(angle);
      const upperSurface = Math.sin(angle * 2 + side * 0.22) * (0.08 + closure * 0.18);
      const foldSurface = fundamental + upperSurface;
      const cushionSurface = Math.sin(angle - side * 0.14) * (0.2 + closure * 0.16);
      const coupledGap = foldSurface - cushionSurface;
      const contact = Math.tanh((coupledGap + (closure - 0.53) * 0.45) * (1.45 + closure * 5.8));
      const collision = contact - previous;
      const noisyContact = this._random() * roughness * Math.abs(collision) * 0.2;
      return [contact * (0.72 - closure * 0.18) + collision * (0.38 + closure * 0.44) + noisyContact, contact];
    };

    const [foldLeft, memoryLeft] = foldContact(this.phaseLeft, this.foldMemoryLeft, -1);
    this.foldMemoryLeft = memoryLeft;
    let secondaryRegime = 0;
    if (this.call.id === "humpback-two-voice-phrase") {
      // The second regime represents bilateral transverse-fold contact, not a
      // second independent fold-to-fat oscillator.
      const foldGap = Math.tanh(
        (Math.sin(this.phaseRight * TAU) - Math.sin(this.phaseLeft * TAU))
        * (1.5 + closure * 4.2),
      );
      secondaryRegime = foldGap - this.foldMemoryRight;
      this.foldMemoryRight = foldGap;
    } else {
      this.foldMemoryRight *= 0.999;
    }
    const modeBalance = clamp(this.smoothed.asymmetry, -1, 1);
    const primaryMix = this.call.id === "humpback-two-voice-phrase"
      ? 1 - modeBalance * 0.45
      : 1;
    const secondaryMix = 0.62 * (1 + modeBalance * 0.45);
    const source = (foldLeft * primaryMix + secondaryRegime * secondaryMix) * sourceGain;
    // This delay is compliant laryngeal-sac memory, not a claim of continuous
    // physiological air transport back to the lungs while sounding.
    const sacMemory = this.acousticDelayLeft.process(
      source,
      0.018 + this.configuration.scale * 0.038,
      this.configuration.recycle * 0.2,
    );
    const sac = this.sacMode.process(source + sacMemory * 0.3);
    const bodyInput = source * 0.34 + sac * (0.72 + this.configuration.recycle * 0.3);
    const body = this.bodyModes.reduce((sum, mode, index) => (
      sum + mode.process(bodyInput) * [1, 0.66, 0.38][index]
    ), 0);
    const coupled = source * (0.1 + focus * 0.1) + sac * 0.46 + body * (0.82 + focus * 0.35);
    const pan = clamp(this.smoothed.asymmetry, -1, 1);
    return [coupled * Math.cos((pan + 1) * Math.PI * 0.18), coupled * Math.sin((pan + 1) * Math.PI * 0.18 + 0.5)];
  }

  _renderSurfaceBreath() {
    if (this.surfaceBreathPhase === "sealed" || this.surfaceBreathPhase === "open-idle") {
      return 0;
    }
    const profile = this.surfaceBreathProfile;
    const aperture = clamp(this.surfaceValveAperture);
    const area = aperture * aperture * (3 - 2 * aperture);
    let targetFlow = 0;
    let highBandMix = 0.35;
    let finishesAfterSample = false;

    if (this.surfaceBreathPhase === "exhale") {
      const volume = clamp(this.surfaceBreathAirVolume);
      // Normalized orifice flow: Q is proportional to open area times the
      // square root of the pressure difference. Pressure falls with the
      // remaining air volume, so widening the valve uses the existing
      // reservoir faster instead of restarting an arbitrary noise envelope.
      this.surfaceBreathPressure = this.surfaceBreathInitialPressure
        * volume;
      targetFlow = area * Math.sqrt(this.surfaceBreathPressure);
      const volumeStep = 2 * area * Math.sqrt(volume)
        / Math.max(1, profile.exhaleSeconds * this.rate);
      this.surfaceBreathAirVolume = Math.max(0, volume - volumeStep);
      this.surfaceBreathFrame += 1;
      if (this.surfaceBreathAirVolume <= SURFACE_BREATH_VOLUME_FLOOR) {
        this.surfaceBreathAirVolume = 0;
        this.surfaceBreathPhase = "inhale";
        this.surfaceBreathFrame = 0;
        this.surfaceBreathPressure = 0;
      }
    } else if (this.surfaceBreathPhase === "inhale") {
      const volume = clamp(this.surfaceBreathAirVolume);
      const shape = Math.pow(Math.max(0, Math.sin(Math.PI * volume)), 0.8);
      targetFlow = -area * Math.sqrt(this.surfaceBreathInitialPressure)
        * profile.inhaleRatio * shape;
      highBandMix = 0.18;
      const volumeStep = area / Math.max(1, profile.inhaleSeconds * this.rate);
      this.surfaceBreathAirVolume = Math.min(1, volume + volumeStep);
      this.surfaceBreathFrame += 1;
      finishesAfterSample = this.surfaceBreathAirVolume >= 1;
    } else if (this.surfaceBreathPhase === "release") {
      const phaseFrames = Math.max(1, Math.round(SURFACE_BREATH_RELEASE_SECONDS * this.rate));
      const progress = clamp(this.surfaceBreathFrame / phaseFrames);
      targetFlow = this.surfaceBreathReleaseStartFlow * (1 - progress);
      highBandMix = targetFlow < 0 ? 0.18 : 0.35;
      this.surfaceBreathFrame += 1;
      finishesAfterSample = this.surfaceBreathFrame >= phaseFrames;
    }

    this.surfaceBreathTargetFlow = Number.isFinite(targetFlow) ? targetFlow : 0;
    this.surfaceBreathFlow += (
      this.surfaceBreathTargetFlow - this.surfaceBreathFlow
    ) * this.surfaceBreathFlowCoefficient;
    const noiseDrive = SURFACE_BREATH_MONITOR_GAIN * profile.outputGain
      * Math.pow(Math.abs(this.surfaceBreathFlow), 1.25);
    if (noiseDrive <= SURFACE_BREATH_PRESSURE_FLOOR) {
      if (finishesAfterSample) this._finishSurfaceBreath();
      return 0;
    }
    const noise = this._surfaceBreathRandom();
    const low = this.ventFilterLow.process(noise);
    const high = this.ventFilterHigh.process(noise);
    const output = (low * 0.94 + high * highBandMix) * noiseDrive;
    if (finishesAfterSample) this._finishSurfaceBreath();
    return Number.isFinite(output) ? output : 0;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] ?? left;
    if (!left) return true;

    this._commitPendingCallAtBlockBoundary();
    const startPhase = this._phaseAtFrame(this.renderedFrames);
    const active = this.manualGate
      || (this.playing && this.renderedFrames >= this.callStartFrame);
    const plan = this._planAt(startPhase);
    this._updateTargets(plan, active);
    this._configureFilters(plan);
    this._setPropagationTarget(plan);

    let peak = 0;
    let squareSum = 0;
    for (let frame = 0; frame < left.length; frame += 1) {
      const absoluteFrame = this.renderedFrames + frame;
      if (
        this.surfaceBreathTriggerFrame !== null
        && absoluteFrame >= this.surfaceBreathTriggerFrame
      ) {
        this.surfaceBreathTriggerFrame = null;
        this._triggerSurfaceBreathIfOpen();
      }
      const phase = this._phaseAtFrame(absoluteFrame);
      this._smoothParameters();
      this._smoothSurfaceValve();
      this._advanceCallTransition();
      // The external breathing valve is not the underwater sound generator.
      // Keep the authored call path independent while the finite surface breath
      // runs as its own air-side event.
      this.surfaceValveSourceGain = 1;
      let sampleLeft = 0;
      let sampleRight = 0;
      if (this.smoothed.pressure > 1e-5) {
        const sample = this.call.sourceFamily === BLOWHOLE_SOURCE_FAMILIES.ODONTOCETE
          ? this._renderOdontocete(phase)
          : this._renderMysticete();
        const sourceGain = this.callTransitionGain;
        sampleLeft += sample[0] * sourceGain;
        sampleRight += sample[1] * sourceGain;
      }

      this._processPropagation(sampleLeft, sampleRight);
      sampleLeft = this.propagationOutputLeft;
      sampleRight = this.propagationOutputRight;

      const surfaceBreath = this._renderSurfaceBreath();
      sampleLeft += surfaceBreath * this.surfaceBreathPathGain * 0.93;
      sampleRight += surfaceBreath * this.surfaceBreathPathGain * 1.07;

      this.dcLeft += (sampleLeft - this.dcLeft) * 0.00042;
      this.dcRight += (sampleRight - this.dcRight) * 0.00042;
      sampleLeft -= this.dcLeft;
      sampleRight -= this.dcRight;
      const boundedLeft = Math.tanh(sampleLeft * 1.35) * 0.58;
      const boundedRight = Math.tanh(sampleRight * 1.35) * 0.58;
      left[frame] = Number.isFinite(boundedLeft) ? boundedLeft : 0;
      right[frame] = Number.isFinite(boundedRight) ? boundedRight : 0;
      peak = Math.max(peak, Math.abs(left[frame]), Math.abs(right[frame]));
      squareSum += left[frame] * left[frame] + right[frame] * right[frame];
      this.lastPhase = phase;
    }

    this.renderedFrames += left.length;
    this.lastPeak = peak;
    this.lastRms = Math.sqrt(squareSum / Math.max(1, left.length * 2));
    this.blockCounter += 1;
    if (this.blockCounter >= TELEMETRY_BLOCKS) {
      this.blockCounter = 0;
      this.port.postMessage({
        type: "telemetry",
        callId: this.call.id,
        family: this.call.family,
        active: this.playing || this.manualGate,
        playing: this.playing,
        manual: this.manualGate,
        loop: this.loop,
        phase: this.lastPhase,
        physicalFrequencyHz: this.currentPhysicalFrequencyHz,
        monitorFrequencyHz: this.currentMonitorFrequencyHz,
        pulseRateHz: this.smoothed.pulseRateHz,
        pressure: this.smoothed.pressure,
        peak: this.lastPeak,
        rms: this.lastRms,
        valveAperture: this.surfaceValveAperture,
        valveSourceGain: this.surfaceValveSourceGain,
        valveOpen: this.surfaceValveCommandOpen,
        breathActive: ["exhale", "inhale", "release"].includes(this.surfaceBreathPhase),
        breathPhase: this.surfaceBreathPhase,
        breathProgress: this._surfaceBreathProgress(),
        breathPressure: clamp(this.surfaceBreathPressure, 0, 1.4),
        breathFlow: clamp(this.surfaceBreathFlow, -1.4, 1.4),
        breathAirVolume: clamp(this.surfaceBreathAirVolume),
        breathPathGain: clamp(this.surfaceBreathPathGain),
        breathEventId: this.surfaceBreathEventId,
        propagationId: this.propagationMetadata.presetId,
        propagationMedium: this.propagationMetadata.medium,
        propagationCondition: this.propagationMetadata.condition,
        propagationMix: this.propagationSmoothed.mix,
        propagationDistanceM: this.propagationMetadata.distanceM,
        propagationSpeedMps: this.propagationMetadata.speedMps,
        propagationTravelTimeMs: this.propagationMetadata.travelTimeMs,
        propagation: {
          presetId: this.propagationMetadata.presetId,
          label: this.propagationMetadata.label,
          medium: this.propagationMetadata.medium,
          condition: this.propagationMetadata.condition,
          mix: this.propagationSmoothed.mix,
          distanceM: this.propagationMetadata.distanceM,
          speedMps: this.propagationMetadata.speedMps,
          travelTimeMs: this.propagationMetadata.travelTimeMs,
          travelTimeReadoutOnly: true,
          appliesTravelTimeDelay: false,
          directCutoffHz: this.propagationMetadata.directCutoffHz,
          reflectionCutoffHz: this.propagationMetadata.reflectionCutoffHz,
          signedReflectionGain: this.propagationSmoothed.reflectionGain,
          reflectionDelayMs: this.propagationSmoothed.reflectionDelaySeconds * 1_000,
          reflectionSpreadMs: this.propagationSmoothed.reflectionSpreadSeconds * 1_000,
          modulationDepthMs: this.propagationSmoothed.modulationDepthSeconds * 1_000,
          modulationRateHz: this.propagationSmoothed.modulationRateHz,
          flutterDepth: this.propagationSmoothed.flutterDepth,
        },
      });
    }
    return true;
  }
}

registerProcessor("blowhole-physical-model", BlowholePhysicalProcessor);
