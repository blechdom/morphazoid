import {
  DEFAULT_RECURSIVE_FM_PRESET_ID,
  RECURSIVE_FM_LIMITS,
  RECURSIVE_FM_PARAMETER_IDS,
  RECURSIVE_FM_PERFORMANCE_DEFAULTS,
  RECURSIVE_FM_PRESETS,
  RecursiveFmMonophonicState,
  RecursiveFmWebMidi,
  deriveRecursiveFmStack,
  deriveRecursiveFmSafePitchRatio,
  formatRecursiveFmFrequency,
  logarithmicSliderPosition,
  logarithmicSliderValue,
  quadraticSliderPosition,
  quadraticSliderValue,
  recursiveFmFactoryControlChange,
  recursiveFmPitchRatio,
  sanitizeRecursiveFmPerformance,
  sanitizeRecursiveFmSettings,
  summarizeRecursiveFmStack,
} from "./src/recursive-fm.js";
import {
  createChaoticSpectrum,
  drawChaoticLiveAnalysis,
} from "./src/chaotic-synth-visuals.js";
import { getSharedMidiManager } from "./src/midi-manager.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_LEVEL = 0.58;
const VISUAL_FRAME_INTERVAL = 1_000 / 30;
const PARAMETER_SMOOTHING_SECONDS = 0.018;

function setAudioParam(param, value, context, timeConstant = PARAMETER_SMOOTHING_SECONDS) {
  if (!param || !context) return;
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(value, now, timeConstant);
}

function holdAudioParam(param, now) {
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(now);
  } else {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
  }
}

function rampAudioParam(param, value, context, durationSeconds = 0) {
  if (!param || !context) return;
  const now = context.currentTime;
  holdAudioParam(param, now);
  if (durationSeconds > 0) {
    param.linearRampToValueAtTime(value, now + durationSeconds);
  } else {
    param.setValueAtTime(value, now);
  }
}

function quadraticEaseOut(progress) {
  const safe = Math.min(1, Math.max(0, Number(progress) || 0));
  return 1 - (1 - safe) ** 2;
}

function quadraticValueCurve(start, end, pointCount = 48) {
  const count = Math.max(2, Math.round(pointCount));
  const curve = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const shaped = quadraticEaseOut(index / (count - 1));
    curve[index] = start + (end - start) * shaped;
  }
  curve[0] = start;
  curve[count - 1] = end;
  return curve;
}

function scheduleQuadraticAudioParam(param, value, context, durationSeconds) {
  if (!param || !context) return;
  const now = context.currentTime;
  const duration = Math.max(0, Number(durationSeconds) || 0);
  holdAudioParam(param, now);
  if (duration === 0) {
    param.setValueAtTime(value, now);
  } else if (typeof param.setValueCurveAtTime === "function") {
    param.setValueCurveAtTime(
      quadraticValueCurve(param.value, value),
      now,
      duration,
    );
  } else {
    param.linearRampToValueAtTime(value, now + duration);
  }
}

function attackDecayValueCurve(
  start,
  sustain,
  attackSeconds,
  decaySeconds,
) {
  const attack = Math.max(0, Number(attackSeconds) || 0);
  const decay = Math.max(0, Number(decaySeconds) || 0);
  const duration = attack + decay;
  const count = Math.max(32, Math.min(192, Math.ceil(duration * 250) + 2));
  const curve = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const elapsed = duration * index / (count - 1);
    if (attack > 0 && elapsed < attack) {
      curve[index] = start + (1 - start) * quadraticEaseOut(elapsed / attack);
    } else if (decay > 0) {
      curve[index] = 1 + (sustain - 1) * quadraticEaseOut(
        (elapsed - attack) / decay,
      );
    } else {
      curve[index] = sustain;
    }
  }
  curve[0] = attack > 0 ? start : 1;
  curve[count - 1] = sustain;
  return curve;
}

function setCompressorParameters(compressor) {
  compressor.threshold.value = -16;
  compressor.knee.value = 18;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.16;
}

class RecursiveFmAudioEngine {
  constructor() {
    this.context = null;
    this.oscillators = [];
    this.modulationGains = [];
    this.tapGains = [];
    this.nodes = [];
    this.normalizationGain = null;
    this.envelopeGain = null;
    this.expressionGain = null;
    this.masterGain = null;
    this.compressor = null;
    this.ceilingGain = null;
    this.analyser = null;
    this.waveform = null;
    this.selectedOperator = -1;
    this.stopping = false;
    this.settings = sanitizeRecursiveFmSettings();
    this.performance = { ...RECURSIVE_FM_PERFORMANCE_DEFAULTS };
    this.voice = new RecursiveFmMonophonicState();
    this.expression = 1;
    this.pitchBendNormalized = 0;
    this.requestedPitchRatio = 1;
    this.currentPitchRatio = 1;
    this.currentVelocity = 1;
    this.glideEnabled = true;
    this.hasEverNote = false;
  }

  get running() {
    return Boolean(this.context) && !this.stopping;
  }

  get sampleRate() {
    return this.context?.sampleRate ?? 48_000;
  }

  async start(
    settings,
    level = DEFAULT_LEVEL,
    performance = this.performance,
  ) {
    if (this.running) {
      if (this.context.state === "suspended") await this.context.resume();
      this.updatePerformance(performance);
      this.updateSettings(settings);
      this.setLevel(level);
      return;
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is not available in this browser.");

    // This constructor is called only from the Audio button's click handler.
    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    this.context = context;
    this.stopping = false;

    const mixBus = context.createGain();
    const normalizationGain = context.createGain();
    const envelopeGain = context.createGain();
    const expressionGain = context.createGain();
    const masterGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const ceilingGain = context.createGain();
    const analyser = context.createAnalyser();

    normalizationGain.gain.value = 0;
    envelopeGain.gain.value = 1;
    expressionGain.gain.value = 1;
    masterGain.gain.value = 0;
    ceilingGain.gain.value = 0.82;
    setCompressorParameters(compressor);
    analyser.fftSize = 2_048;
    analyser.minDecibels = -90;
    analyser.maxDecibels = 0;
    analyser.smoothingTimeConstant = 0.45;

    mixBus.connect(normalizationGain);
    normalizationGain.connect(envelopeGain);
    envelopeGain.connect(expressionGain);
    expressionGain.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(ceilingGain);
    ceilingGain.connect(analyser);
    analyser.connect(context.destination);

    this.normalizationGain = normalizationGain;
    this.envelopeGain = envelopeGain;
    this.expressionGain = expressionGain;
    this.masterGain = masterGain;
    this.compressor = compressor;
    this.ceilingGain = ceilingGain;
    this.analyser = analyser;
    // Share Chaotic FM's 512-sample oscilloscope window while the analyser's
    // longer FFT continues to provide the spectrum's frequency resolution.
    this.waveform = new Uint8Array(512);
    this.nodes.push(
      mixBus,
      normalizationGain,
      envelopeGain,
      expressionGain,
      masterGain,
      compressor,
      ceilingGain,
      analyser,
    );

    this.settings = sanitizeRecursiveFmSettings(settings, {
      sampleRate: context.sampleRate,
    });
    const maximumStack = deriveRecursiveFmStack({
      ...settings,
      depth: RECURSIVE_FM_LIMITS.maxDepth,
    }, { sampleRate: context.sampleRate });

    for (const operator of maximumStack.operators) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = operator.biasHz;
      const tapGain = context.createGain();
      tapGain.gain.value = 0;
      oscillator.connect(tapGain);
      tapGain.connect(mixBus);
      this.oscillators.push(oscillator);
      this.tapGains.push(tapGain);
      this.nodes.push(oscillator, tapGain);
    }

    for (let index = 1; index < maximumStack.operators.length; index += 1) {
      const modulationGain = context.createGain();
      modulationGain.gain.value = maximumStack.operators[index].modulationHz;
      this.oscillators[index - 1].connect(modulationGain);
      modulationGain.connect(this.oscillators[index].frequency);
      this.modulationGains[index] = modulationGain;
      this.nodes.push(modulationGain);
    }

    this.voice = new RecursiveFmMonophonicState();
    this.expression = 1;
    this.pitchBendNormalized = 0;
    this.requestedPitchRatio = 1;
    this.currentPitchRatio = 1;
    this.currentVelocity = 1;
    this.glideEnabled = true;
    this.hasEverNote = false;
    this.updatePerformance(performance, { immediate: true });
    envelopeGain.gain.value = this.performance.playMode === "drone" ? 1 : 0;
    expressionGain.gain.value = 1;
    this.updateSettings(settings, { immediate: true });
    for (const oscillator of this.oscillators) oscillator.start();
    if (context.state === "suspended") await context.resume();
    this.setLevel(level);
  }

  updateSettings(settings, { immediate = false } = {}) {
    if (!this.context) return deriveRecursiveFmStack(settings);

    const context = this.context;
    const stack = deriveRecursiveFmStack(settings, { sampleRate: context.sampleRate });
    this.settings = stack.settings;
    const maximumStack = deriveRecursiveFmStack({
      ...stack.settings,
      depth: RECURSIVE_FM_LIMITS.maxDepth,
    }, { sampleRate: context.sampleRate });
    const timeConstant = immediate ? 0.001 : PARAMETER_SMOOTHING_SECONDS;
    const requestedPitchRatio = this.performance.playMode === "midi"
      ? this.requestedPitchRatio
      : 1;
    const pitchRatio = deriveRecursiveFmSafePitchRatio(
      maximumStack,
      requestedPitchRatio,
    );

    maximumStack.operators.forEach((operator, index) => {
      setAudioParam(
        this.oscillators[index]?.frequency,
        operator.biasHz * pitchRatio,
        context,
        timeConstant,
      );
      if (index > 0) {
        setAudioParam(
          this.modulationGains[index]?.gain,
          operator.modulationHz * pitchRatio,
          context,
          timeConstant,
        );
      }
    });
    this.currentPitchRatio = pitchRatio;

    if (this.selectedOperator !== stack.audibleIndex) {
      this.tapGains.forEach((tap, index) => {
        setAudioParam(
          tap.gain,
          index === stack.audibleIndex ? 1 : 0,
          context,
          immediate ? 0.001 : 0.008,
        );
      });
      this.selectedOperator = stack.audibleIndex;
    }
    setAudioParam(
      this.normalizationGain.gain,
      stack.normalizedGain,
      context,
      timeConstant,
    );
    return stack;
  }

  updatePerformance(settings = {}, { immediate = false } = {}) {
    const previous = this.performance;
    const safe = sanitizeRecursiveFmPerformance({
      ...previous,
      ...settings,
    });
    this.performance = { ...safe };
    if (!this.context) return safe;

    if (safe.playMode !== previous.playMode) {
      this.voice.allNotesOff({ hard: true });
      this.hasEverNote = false;
      this.requestedPitchRatio = 1;
      this.currentPitchRatio = 1;
      this.currentVelocity = 1;
      this.expression = 1;
      rampAudioParam(
        this.envelopeGain?.gain,
        safe.playMode === "drone" ? 1 : 0,
        this.context,
        immediate ? 0 : 0.008,
      );
      rampAudioParam(
        this.expressionGain?.gain,
        1,
        this.context,
        immediate ? 0 : 0.008,
      );
      this.scheduleOperatorPitch(1, immediate ? 0 : 8);
    }

    if (
      safe.playMode === "midi"
      && this.voice.selectedNote >= 0
      && (
        safe.rootMidiNote !== previous.rootMidiNote
        || safe.pitchBendRangeSemitones !== previous.pitchBendRangeSemitones
      )
    ) {
      this.scheduleSelectedPitch({ durationMs: immediate ? 0 : 8 });
    }
    return safe;
  }

  scheduleOperatorPitch(ratio, durationMs = 0) {
    if (!this.context) return;
    const requestedRatio = Math.max(0.0001, Number(ratio) || 1);
    const maximumStack = deriveRecursiveFmStack({
      ...this.settings,
      depth: RECURSIVE_FM_LIMITS.maxDepth,
    }, { sampleRate: this.context.sampleRate });
    const safeRatio = deriveRecursiveFmSafePitchRatio(
      maximumStack,
      requestedRatio,
    );
    const durationSeconds = Math.max(0, Number(durationMs) || 0) / 1_000;
    maximumStack.operators.forEach((operator, index) => {
      rampAudioParam(
        this.oscillators[index]?.frequency,
        operator.biasHz * safeRatio,
        this.context,
        durationSeconds,
      );
      if (index > 0) {
        rampAudioParam(
          this.modulationGains[index]?.gain,
          operator.modulationHz * safeRatio,
          this.context,
          durationSeconds,
        );
      }
    });
    this.requestedPitchRatio = requestedRatio;
    this.currentPitchRatio = safeRatio;
  }

  scheduleSelectedPitch({ durationMs = 8 } = {}) {
    if (this.voice.selectedNote < 0) return;
    const ratio = recursiveFmPitchRatio(
      this.voice.selectedNote,
      this.performance.rootMidiNote,
      this.pitchBendNormalized,
      this.performance.pitchBendRangeSemitones,
    );
    this.scheduleOperatorPitch(ratio, durationMs);
  }

  beginEnvelope() {
    if (!this.context || !this.envelopeGain) return;
    const now = this.context.currentTime;
    const attackSeconds = this.performance.ampAttackMs / 1_000;
    const decaySeconds = this.performance.ampDecayMs / 1_000;
    const gain = this.envelopeGain.gain;
    holdAudioParam(gain, now);
    const duration = attackSeconds + decaySeconds;
    if (duration > 0 && typeof gain.setValueCurveAtTime === "function") {
      gain.setValueCurveAtTime(
        attackDecayValueCurve(
          gain.value,
          this.performance.ampSustainLevel,
          attackSeconds,
          decaySeconds,
        ),
        now,
        duration,
      );
    } else if (duration > 0) {
      if (attackSeconds > 0) {
        gain.linearRampToValueAtTime(1, now + attackSeconds);
      } else {
        gain.setValueAtTime(1, now);
      }
      gain.linearRampToValueAtTime(
        this.performance.ampSustainLevel,
        now + duration,
      );
    } else {
      gain.setValueAtTime(this.performance.ampSustainLevel, now);
    }
  }

  releaseEnvelope({ hard = false } = {}) {
    if (!this.context || !this.envelopeGain) return;
    scheduleQuadraticAudioParam(
      this.envelopeGain.gain,
      0,
      this.context,
      (hard ? 2 : this.performance.ampReleaseMs) / 1_000,
    );
  }

  updateExpressionGain({ immediate = false } = {}) {
    if (!this.context || !this.expressionGain) return;
    const value = this.performance.playMode === "midi"
      ? this.currentVelocity * this.expression
      : 1;
    setAudioParam(
      this.expressionGain.gain,
      value,
      this.context,
      immediate ? 0.001 : 0.006,
    );
  }

  applyVoiceAction(action) {
    if (!action || this.performance.playMode !== "midi") return false;
    if (action.type === "release") {
      this.releaseEnvelope({ hard: action.hard });
      return true;
    }
    if (action.type !== "select") return false;
    const shouldGlide = this.hasEverNote
      && this.glideEnabled
      && this.performance.glideTimeMs > 0
      && (
        this.performance.glideMode === "always"
        || (
          this.performance.glideMode === "legato"
          && action.legatoEligible
        )
      );
    this.scheduleOperatorPitch(
      recursiveFmPitchRatio(
        action.note,
        this.performance.rootMidiNote,
        this.pitchBendNormalized,
        this.performance.pitchBendRangeSemitones,
      ),
      shouldGlide ? this.performance.glideTimeMs : 0,
    );
    this.hasEverNote = true;
    this.currentVelocity = action.velocity;
    this.updateExpressionGain({ immediate: action.retrigger });
    if (action.retrigger) this.beginEnvelope();
    return true;
  }

  noteOn(note, velocity = 127, channel = 0, sourceId = null) {
    if (!this.running || this.performance.playMode !== "midi") return false;
    const owner = sourceId === null
      ? channel
      : `${String(sourceId)}\u0000${channel}`;
    return this.applyVoiceAction(this.voice.noteOn(note, velocity, owner));
  }

  noteOff(note, channel = 0, sourceId = null) {
    if (!this.running || this.performance.playMode !== "midi") return false;
    const owner = sourceId === null
      ? channel
      : `${String(sourceId)}\u0000${channel}`;
    return this.applyVoiceAction(this.voice.noteOff(note, owner));
  }

  get selectedMidiNote() {
    return this.performance.playMode === "midi" ? this.voice.selectedNote : -1;
  }

  pitchBend(normalized) {
    this.pitchBendNormalized = Math.min(1, Math.max(-1, Number(normalized) || 0));
    if (this.running && this.performance.playMode === "midi") {
      this.scheduleSelectedPitch({ durationMs: 8 });
    }
    return true;
  }

  setExpression(value) {
    this.expression = Math.min(1, Math.max(0, Number(value) || 0));
    this.updateExpressionGain();
    return true;
  }

  setSustain(down) {
    if (this.performance.playMode !== "midi") return false;
    return this.applyVoiceAction(this.voice.setSustain(down));
  }

  setGlideEnabled(enabled) {
    this.glideEnabled = Boolean(enabled);
    return true;
  }

  allNotesOff() {
    if (this.performance.playMode !== "midi") return false;
    return this.applyVoiceAction(this.voice.allNotesOff());
  }

  allSoundOff() {
    if (this.performance.playMode !== "midi") return false;
    return this.applyVoiceAction(this.voice.allNotesOff({ hard: true }));
  }

  resetControllers() {
    this.expression = 1;
    this.glideEnabled = true;
    this.pitchBendNormalized = 0;
    this.applyVoiceAction(this.voice.setSustain(false));
    this.updateExpressionGain();
    this.scheduleSelectedPitch({ durationMs: 8 });
    return true;
  }

  controlChange(controller, value) {
    const action = recursiveFmFactoryControlChange(controller, value);
    if (!action) return false;
    if (action.type === "parameter") {
      this.updatePerformance({ [action.key]: action.value });
      return true;
    }
    if (action.type === "expression") return this.setExpression(action.value);
    if (action.type === "sustain") return this.setSustain(action.down);
    if (action.type === "glideEnabled") {
      return this.setGlideEnabled(action.enabled);
    }
    if (action.type === "allSoundOff") return this.allSoundOff();
    if (action.type === "resetControllers") return this.resetControllers();
    if (action.type === "allNotesOff") return this.allNotesOff();
    return false;
  }

  setLevel(level) {
    if (!this.context || !this.masterGain) return;
    const safeLevel = Math.min(1, Math.max(0, Number(level) || 0));
    setAudioParam(this.masterGain.gain, safeLevel, this.context, 0.012);
  }

  readWaveform() {
    if (!this.running || !this.analyser || !this.waveform) return null;
    this.analyser.getByteTimeDomainData(this.waveform);
    return this.waveform;
  }

  async stop({ immediate = false } = {}) {
    if (!this.context || this.stopping) return;
    this.stopping = true;
    const context = this.context;
    const oscillators = [...this.oscillators];
    const nodes = [...this.nodes];

    if (this.masterGain) {
      const now = context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      if (immediate) this.masterGain.gain.setValueAtTime(0, now);
      else this.masterGain.gain.linearRampToValueAtTime(0, now + 0.025);
    }
    if (!immediate) {
      await new Promise((resolve) => window.setTimeout(resolve, 32));
    }

    for (const oscillator of oscillators) {
      try {
        oscillator.stop();
      } catch {
        // It may already have stopped while the page was unloading.
      }
    }
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // Disconnection is best-effort during page shutdown.
      }
    }
    if (context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // Some browsers abandon close() while a page is being discarded.
      }
    }

    if (this.context === context) {
      this.context = null;
      this.oscillators = [];
      this.modulationGains = [];
      this.tapGains = [];
      this.nodes = [];
      this.normalizationGain = null;
      this.envelopeGain = null;
      this.expressionGain = null;
      this.masterGain = null;
      this.compressor = null;
      this.ceilingGain = null;
      this.analyser = null;
      this.waveform = null;
      this.selectedOperator = -1;
      this.voice = new RecursiveFmMonophonicState();
      this.requestedPitchRatio = 1;
      this.currentPitchRatio = 1;
      this.currentVelocity = 1;
      this.hasEverNote = false;
      this.stopping = false;
    }
  }
}

const defaultPreset = RECURSIVE_FM_PRESETS.find(
  ({ id }) => id === DEFAULT_RECURSIVE_FM_PRESET_ID,
) ?? RECURSIVE_FM_PRESETS[0];

const state = {
  settings: { ...defaultPreset.settings },
  // Preserve the original demo's immediate Audio-button drone. MIDI mode is
  // explicitly selected when the page is played from a keyboard.
  performance: {
    ...RECURSIVE_FM_PERFORMANCE_DEFAULTS,
    playMode: "drone",
  },
  activePresetId: defaultPreset.id,
  level: DEFAULT_LEVEL,
  expression: 1,
  sustain: false,
  bend: 0,
  midiSelectedNote: -1,
  audioStarting: false,
};

const engine = new RecursiveFmAudioEngine();
const midiBridge = new RecursiveFmWebMidi(globalThis, {
  target: engine,
  onAction: handleMidiAction,
});
const sharedMidiManager = getSharedMidiManager(globalThis);
let sharedMidiEnabled = false;
let unregisterMidiClient = null;

function registerSharedMidiClient() {
  if (unregisterMidiClient) return;
  unregisterMidiClient = sharedMidiManager.registerClient({
    id: "recursive-fm",
    onMessage: handleSharedMidiMessage,
    onEnabledChange: handleSharedMidiEnabled,
    onPrepareEnable: prepareSharedMidiEnable,
    onProfileChange: handleSharedMidiProfileChange,
  });
}
const canvas = $("stage");
const canvasContext = canvas.getContext("2d");
const spectrum = createChaoticSpectrum();
const stageWrap = $("stageWrap");
let pixelRatio = 1;
let cssWidth = 1;
let cssHeight = 1;
let visualFrameId = null;
let lastVisualFrame = -Infinity;
let visualizationDirty = true;

const controls = {
  depth: {
    input: $("depth"),
    output: $("depthOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
  carrierHz: {
    input: $("carrier"),
    output: $("carrierOut"),
    read: (input) => logarithmicSliderValue(Number(input.value)),
    write: (value, input) => {
      input.value = String(logarithmicSliderPosition(value));
    },
  },
  offsetHz: {
    input: $("offset"),
    output: $("offsetOut"),
    read: (input) => quadraticSliderValue(Number(input.value)),
    write: (value, input) => {
      input.value = String(quadraticSliderPosition(value));
    },
  },
  modulationHz: {
    input: $("modulation"),
    output: $("modulationOut"),
    read: (input) => quadraticSliderValue(Number(input.value)),
    write: (value, input) => {
      input.value = String(quadraticSliderPosition(value));
    },
  },
  divisor: {
    input: $("divisor"),
    output: $("divisorOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
};

function logarithmicZeroSliderValue(position, minimum, maximum) {
  const normalized = Number(position);
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return logarithmicSliderValue(
    Math.max(0, (normalized - 0.001) / 0.999),
    minimum,
    maximum,
  );
}

function logarithmicZeroSliderPosition(value, minimum, maximum) {
  if (Number(value) <= 0) return 0;
  return 0.001 + logarithmicSliderPosition(value, minimum, maximum) * 0.999;
}

const performanceControls = {
  ampAttackMs: {
    input: $("ampAttackMs"),
    output: $("ampAttackMsOut"),
    read: (input) => logarithmicZeroSliderValue(input.value, 0.5, 5_000),
    write: (value, input) => {
      input.value = String(logarithmicZeroSliderPosition(value, 0.5, 5_000));
    },
  },
  ampDecayMs: {
    input: $("ampDecayMs"),
    output: $("ampDecayMsOut"),
    read: (input) => logarithmicZeroSliderValue(input.value, 1, 5_000),
    write: (value, input) => {
      input.value = String(logarithmicZeroSliderPosition(value, 1, 5_000));
    },
  },
  ampSustainLevel: {
    input: $("ampSustainLevel"),
    output: $("ampSustainLevelOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
  ampReleaseMs: {
    input: $("ampReleaseMs"),
    output: $("ampReleaseMsOut"),
    read: (input) => logarithmicSliderValue(Number(input.value), 2, 10_000),
    write: (value, input) => {
      input.value = String(logarithmicSliderPosition(value, 2, 10_000));
    },
  },
  glideTimeMs: {
    input: $("glideTimeMs"),
    output: $("glideTimeMsOut"),
    read: (input) => logarithmicZeroSliderValue(input.value, 10, 2_000),
    write: (value, input) => {
      input.value = String(logarithmicZeroSliderPosition(value, 10, 2_000));
    },
  },
  rootMidiNote: {
    input: $("rootMidiNote"),
    output: $("rootMidiNoteOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
  pitchBendRangeSemitones: {
    input: $("pitchBendRangeSemitones"),
    output: $("pitchBendRangeSemitonesOut"),
    read: (input) => Number(input.value),
    write: (value, input) => { input.value = String(value); },
  },
};

function compactNumber(value, maximumDigits = 3) {
  return Number(value)
    .toFixed(maximumDigits)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

function formatMilliseconds(value) {
  const milliseconds = Number(value);
  if (milliseconds === 0) return "off";
  if (milliseconds >= 1_000) {
    return `${compactNumber(milliseconds / 1_000, 2)} s`;
  }
  if (milliseconds < 10) return `${compactNumber(milliseconds, 1)} ms`;
  return `${Math.round(milliseconds)} ms`;
}

function midiNoteName(note) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const safe = Math.max(0, Math.min(127, Math.round(Number(note) || 0)));
  return `${names[safe % 12]}${Math.floor(safe / 12) - 1}`;
}

function updateAdsrPreview() {
  const sustainY = 64 - state.performance.ampSustainLevel * 52;
  $("adsrCurve").setAttribute(
    "d",
    `M 8 64 Q 31 12 52 8 Q 76 ${sustainY} 103 ${sustainY} L 171 ${sustainY} Q 202 ${sustainY} 232 64`,
  );
}

function writePerformanceControls() {
  for (const [key, control] of Object.entries(performanceControls)) {
    control.write(state.performance[key], control.input);
  }
  $("glideMode").value = state.performance.glideMode;
  performanceControls.ampAttackMs.output.textContent = formatMilliseconds(
    state.performance.ampAttackMs,
  );
  performanceControls.ampDecayMs.output.textContent = formatMilliseconds(
    state.performance.ampDecayMs,
  );
  performanceControls.ampSustainLevel.output.textContent = `${Math.round(
    state.performance.ampSustainLevel * 100,
  )}%`;
  performanceControls.ampReleaseMs.output.textContent = formatMilliseconds(
    state.performance.ampReleaseMs,
  );
  performanceControls.glideTimeMs.output.textContent = formatMilliseconds(
    state.performance.glideTimeMs,
  );
  performanceControls.rootMidiNote.output.textContent = `${midiNoteName(
    state.performance.rootMidiNote,
  )} · ${state.performance.rootMidiNote}`;
  performanceControls.pitchBendRangeSemitones.output.textContent = `±${compactNumber(
    state.performance.pitchBendRangeSemitones,
    1,
  )} st`;
  $("performanceState").textContent = state.performance.playMode === "drone"
    ? "Drone · continuous"
    : `${state.performance.glideMode} glide · mono`;
  $("expressionValue").textContent = `${Math.round(state.expression * 100)}%`;
  $("expressionMeter").style.setProperty("--expression", state.expression);
  $("sustainState").textContent = state.sustain ? "held" : "up";
  $("bendState").textContent = `${state.bend >= 0 ? "+" : ""}${compactNumber(
    state.bend * state.performance.pitchBendRangeSemitones,
    2,
  )} st`;
  $("currentNote").textContent = state.midiSelectedNote >= 0
    ? `${midiNoteName(state.midiSelectedNote)} · ${state.midiSelectedNote}`
    : "—";
  updateAdsrPreview();
}

function clearMidiMonitorState(activity = "Waiting for MIDI") {
  state.expression = 1;
  state.sustain = false;
  state.bend = 0;
  state.midiSelectedNote = -1;
  $("midiActivity").textContent = activity;
  $("midiActivity").classList.remove("is-active");
  writePerformanceControls();
}

function handleMidiAction(action) {
  let activity = "MIDI";
  const performanceActive = engine.running
    && state.performance.playMode === "midi";
  const inactiveReason = engine.running ? "drone mode" : "audio off";
  if (action.type === "noteOn") {
    activity = `${midiNoteName(action.note)} · velocity ${action.velocity}`
      + (performanceActive ? "" : ` · ${inactiveReason}`);
  } else if (action.type === "noteOff") {
    activity = `${midiNoteName(action.note)} released`;
  } else if (action.type === "pitchBend") {
    if (performanceActive) state.bend = action.normalized;
    activity = `Pitch bend${performanceActive ? "" : ` · ${inactiveReason}`}`;
  } else if (action.type === "controlChange") {
    const semantic = recursiveFmFactoryControlChange(
      action.controller,
      action.value,
    );
    activity = action.synthetic && action.reason === "input-disconnected"
      ? "MIDI disconnected · all sound off"
      : `CC${action.controller} · ${action.value}`;
    if (semantic?.type === "parameter") {
      state.performance = { ...sanitizeRecursiveFmPerformance({
        ...state.performance,
        [semantic.key]: semantic.value,
      }) };
    } else if (semantic?.type === "expression" && performanceActive) {
      state.expression = semantic.value;
    } else if (semantic?.type === "sustain" && performanceActive) {
      state.sustain = semantic.down;
    } else if (semantic?.type === "allSoundOff") {
      state.midiSelectedNote = -1;
      state.sustain = false;
    } else if (semantic?.type === "allNotesOff") {
      state.midiSelectedNote = -1;
    } else if (semantic?.type === "resetControllers") {
      state.expression = 1;
      state.sustain = false;
      state.bend = 0;
    }
  }
  state.midiSelectedNote = performanceActive ? engine.selectedMidiNote : -1;
  $("midiActivity").textContent = activity;
  $("midiActivity").classList.remove("is-active");
  requestAnimationFrame(() => $("midiActivity").classList.add("is-active"));
  writePerformanceControls();
}

const MIDI_MACRO_TARGETS = Object.freeze([
  { kind: "algorithm", key: "carrierHz", label: "carrier" },
  { kind: "algorithm", key: "offsetHz", label: "offset" },
  { kind: "algorithm", key: "modulationHz", label: "modulation" },
  { kind: "algorithm", key: "divisor", label: "divisor" },
  { kind: "performance", key: "ampAttackMs", label: "attack" },
  { kind: "performance", key: "ampReleaseMs", label: "release" },
  { kind: "performance", key: "glideTimeMs", label: "glide" },
  { kind: "output", label: "output" },
]);

function writeNormalizedMidiInput(input, normalized) {
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const safe = Math.min(1, Math.max(0, Number(normalized) || 0));
  input.value = String(minimum + (maximum - minimum) * safe);
}

function applyLogicalMidiMacro(logical) {
  if (logical?.type !== "macro") return false;
  const target = MIDI_MACRO_TARGETS[logical.index];
  if (!target) return false;
  if (target.kind === "algorithm") {
    const control = controls[target.key];
    writeNormalizedMidiInput(control.input, logical.normalized);
    applySettings({
      ...state.settings,
      [target.key]: control.read(control.input),
    });
  } else if (target.kind === "performance") {
    const control = performanceControls[target.key];
    writeNormalizedMidiInput(control.input, logical.normalized);
    applyPerformanceSettings({ [target.key]: control.read(control.input) });
  } else {
    writeNormalizedMidiInput($("level"), logical.normalized);
    state.level = Number($("level").value);
    $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
    engine.setLevel(state.level);
  }
  $("midiActivity").textContent = `Macro ${logical.index + 1} · ${target.label}`;
  $("midiActivity").classList.remove("is-active");
  requestAnimationFrame(() => $("midiActivity").classList.add("is-active"));
  return true;
}

function handleSharedMidiMessage(message, nativeEvent = null) {
  if (!message) return null;
  if (applyLogicalMidiMacro(message.logical)) return message;
  if (message.raw?.length) {
    return midiBridge.handleMessage({
      data: message.raw,
      nativeEvent,
      sourceId: message.sourceId,
    });
  }
  if (message.type === "noteOn") {
    engine.noteOn(message.note, message.velocity, message.channel, message.sourceId);
  } else if (message.type === "noteOff") {
    engine.noteOff(message.note, message.channel, message.sourceId);
  } else if (message.type === "pitchBend") {
    engine.pitchBend(message.normalized);
  } else if (message.type === "controlChange") {
    engine.controlChange(message.controller, message.value);
  }
  handleMidiAction(message);
  return message;
}

function handleSharedMidiEnabled(enabled) {
  const nextEnabled = Boolean(enabled);
  if (nextEnabled === sharedMidiEnabled) return;
  sharedMidiEnabled = nextEnabled;
  state.midiSelectedNote = -1;
  state.sustain = false;
  state.bend = 0;
  state.expression = 1;
  if (nextEnabled) {
    applyPerformanceSettings(
      { playMode: "midi" },
      { message: "MIDI on · monophonic performance mode selected." },
    );
    $("midiActivity").textContent = engine.running
      ? "Ready for MIDI"
      : "MIDI on · turn Audio on to perform";
  } else {
    engine.allSoundOff();
    applyPerformanceSettings(
      { playMode: "drone" },
      { message: "MIDI off · drone mode restored." },
    );
    $("midiActivity").textContent = "MIDI off · drone restored";
  }
  $("midiActivity").classList.remove("is-active");
  writePerformanceControls();
}

function handleSharedMidiProfileChange(profileState) {
  if (!sharedMidiEnabled) return;
  const label = profileState?.selectedProfile?.label ?? "Generic MIDI";
  $("midiActivity").textContent = `${label} mapping ready`;
}

function prepareSharedMidiEnable() {
  return true;
}

function currentStack() {
  return deriveRecursiveFmStack(
    state.settings,
    { sampleRate: engine.sampleRate },
  );
}

function presetById(id) {
  return RECURSIVE_FM_PRESETS.find((preset) => preset.id === id) ?? null;
}

function updatePresetButtons() {
  for (const button of $("presetButtons").querySelectorAll("[data-preset]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.preset === state.activePresetId),
    );
  }
  const preset = presetById(state.activePresetId);
  $("presetState").textContent = preset?.label ?? "Custom";
  $("presetDescription").textContent = preset?.description
    ?? "A custom recursive operator stack.";
}

function updateSignalFlow(stack) {
  const flow = $("recursiveFmFlow");
  const operators = stack.operators;
  const turnCount = stack.settings.depth;
  const graphWidth = Math.max(960, operators.length * 150 + 210);
  const left = 58;
  const outputX = graphWidth - 130;
  const busEnd = outputX - 45;
  const right = busEnd - 100;
  const nodeY = 108;
  const busY = 182;
  const spacing = operators.length > 1
    ? (right - left) / (operators.length - 1)
    : 0;
  const nodeWidth = Math.max(40, Math.min(92, spacing * 0.64));
  const nodeHeight = 48;
  const positions = operators.map((_, index) => left + spacing * index);
  const inputMarkup = operators.slice(1).map((operator, edgeIndex) => {
    const sourceX = positions[edgeIndex];
    const targetX = positions[edgeIndex + 1];
    const sourceEdge = sourceX + nodeWidth * 0.5;
    const frequencyInputX = targetX - nodeWidth * 0.5;
    const multiplierX = (sourceEdge + frequencyInputX) * 0.5;
    const multiplierWidth = Math.max(38, Math.min(66, spacing * 0.34));
    const biasWidth = Math.max(46, Math.min(68, nodeWidth * 0.82));
    return `
      <path class="recursive-fm-signal-wire"
        d="M ${sourceEdge} ${nodeY} L ${multiplierX - multiplierWidth * 0.5} ${nodeY}
           M ${multiplierX + multiplierWidth * 0.5} ${nodeY} L ${frequencyInputX} ${nodeY}" />
      <g class="recursive-fm-modulator">
        <rect x="${multiplierX - multiplierWidth * 0.5}" y="${nodeY - 18}"
          width="${multiplierWidth}" height="36" rx="3" />
        <text class="recursive-fm-block-title" x="${multiplierX}" y="${nodeY - 4}">× MOD</text>
        <text class="recursive-fm-block-value" x="${multiplierX}" y="${nodeY + 10}">
          ${formatRecursiveFmFrequency(operator.modulationHz)}
        </text>
      </g>
      <g class="recursive-fm-bias">
        <rect x="${frequencyInputX - biasWidth * 0.5}" y="39"
          width="${biasWidth}" height="34" rx="3" />
        <text class="recursive-fm-block-title" x="${frequencyInputX}" y="52">BIAS</text>
        <text class="recursive-fm-block-value" x="${frequencyInputX}" y="66">
          ${formatRecursiveFmFrequency(operator.biasHz)}
        </text>
      </g>
      <path class="recursive-fm-bias-wire"
        d="M ${frequencyInputX} 73 L ${frequencyInputX} ${nodeY}" />
      <g class="recursive-fm-input-junction">
        <circle cx="${frequencyInputX}" cy="${nodeY}" r="7" />
        <text x="${frequencyInputX}" y="${nodeY + 3}">+</text>
      </g>
    `;
  }).join("");
  const nodeMarkup = operators.map((operator, index) => {
    const x = positions[index];
    const audible = index === stack.audibleIndex;
    const title = operator.kind === "carrier"
      ? (operator.biasHz < 20 ? "LFO / CARRIER" : "CARRIER")
      : operator.kind === "offset-operator"
        ? "ENTRY OSC"
        : `RECURSIVE ${operator.turn}`;
    const value = operator.kind === "carrier"
      ? `${formatRecursiveFmFrequency(operator.biasHz)} sine`
      : "sine oscillator";
    return `
      <g class="recursive-fm-operator${index === 0 ? " is-carrier" : ""}${audible ? " is-audible" : ""}">
        <rect x="${x - nodeWidth * 0.5}" y="${nodeY - nodeHeight * 0.5}"
          width="${nodeWidth}" height="${nodeHeight}" rx="4" />
        <text class="recursive-fm-operator-title" x="${x}" y="${nodeY - 5}">${title}</text>
        <text class="recursive-fm-operator-value" x="${x}" y="${nodeY + 10}">${value}</text>
        <path class="recursive-fm-tap${audible ? " is-open" : ""}"
          d="M ${x} ${nodeY + nodeHeight * 0.5} L ${x} ${busY}" />
        <circle class="recursive-fm-tap-switch${audible ? " is-open" : ""}"
          cx="${x}" cy="${busY}" r="4" />
      </g>
    `;
  }).join("");
  flow.innerHTML = `
    <svg class="recursive-fm-flow-detailed" viewBox="0 0 ${graphWidth} 210" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <marker id="recursiveFmArrow" viewBox="0 0 8 8" refX="7" refY="4"
          markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      ${inputMarkup}
      ${nodeMarkup}
      <path class="recursive-fm-output-bus" d="M ${left} ${busY} L ${busEnd} ${busY}" />
      <text class="recursive-fm-bus-label" x="${left}" y="199">
        oscillator taps · only operator ${stack.audibleIndex} is open
      </text>
      <path class="recursive-fm-audio-edge" marker-end="url(#recursiveFmArrow)"
        d="M ${busEnd} ${busY} L ${outputX - 6} ${busY}" />
      <g class="recursive-fm-output-node">
        <rect x="${outputX}" y="143" width="116" height="54" rx="4" />
        <text x="${outputX + 58}" y="164">NORMALIZE</text>
        <text class="recursive-fm-output-value" x="${outputX + 58}" y="181">
          ${(stack.normalizedGain * 100).toFixed(0)}% → AUDIO
        </text>
      </g>
    </svg>
    <svg class="recursive-fm-flow-compact" viewBox="0 0 380 116" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g class="recursive-fm-compact-node is-carrier">
        <rect x="8" y="35" width="70" height="45" rx="3" />
        <text class="recursive-fm-compact-title" x="43" y="53">CARRIER</text>
        <text class="recursive-fm-compact-value" x="43" y="68">${formatRecursiveFmFrequency(operators[0].biasHz)}</text>
      </g>
      <text class="recursive-fm-compact-arrow" x="88" y="61">→</text>
      <g class="recursive-fm-compact-node is-entry">
        <rect x="100" y="35" width="70" height="45" rx="3" />
        <text class="recursive-fm-compact-title" x="135" y="53">ENTRY</text>
        <text class="recursive-fm-compact-value" x="135" y="68">SINE · OP 1</text>
      </g>
      <text class="recursive-fm-compact-arrow" x="180" y="61">→</text>
      <g class="recursive-fm-compact-node is-recursive">
        <rect x="192" y="35" width="88" height="45" rx="3" />
        <text class="recursive-fm-compact-title" x="236" y="53">${turnCount === 0 ? "FINAL TAP" : `${turnCount} ${turnCount === 1 ? "TURN" : "TURNS"}`}</text>
        <text class="recursive-fm-compact-value" x="236" y="68">OP ${stack.audibleIndex} OPEN</text>
      </g>
      <text class="recursive-fm-compact-arrow" x="290" y="61">→</text>
      <g class="recursive-fm-compact-node is-output">
        <rect x="302" y="35" width="70" height="45" rx="3" />
        <text class="recursive-fm-compact-title" x="337" y="53">AUDIO</text>
        <text class="recursive-fm-compact-value" x="337" y="68">NORMALIZED</text>
      </g>
      <text class="recursive-fm-compact-caption" x="8" y="101">SIGNED SINE × AMOUNT + BIAS → NEXT OSCILLATOR FREQUENCY</text>
    </svg>
  `;
  flow.setAttribute(
    "aria-label",
    `${
      operators[0].biasHz < 20 ? "LFO carrier" : "Carrier"
    } at ${formatRecursiveFmFrequency(operators[0].biasHz)} feeds the first modulation multiplier. `
      + `At each of ${operators.length - 1} stages, the previous sine is multiplied by the displayed modulation amount, `
      + `then added to the displayed bias at the next oscillator's frequency input. `
      + `Only operator ${stack.audibleIndex} reaches the normalized audio output.`,
  );
}

function updateControlOutputs(stack = currentStack()) {
  const { settings } = stack;
  controls.depth.output.textContent = String(settings.depth);
  controls.carrierHz.output.textContent = formatRecursiveFmFrequency(settings.carrierHz);
  controls.offsetHz.output.textContent = formatRecursiveFmFrequency(settings.offsetHz);
  controls.modulationHz.output.textContent = formatRecursiveFmFrequency(settings.modulationHz);
  controls.divisor.output.textContent = `÷${settings.divisor.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;

  const summary = summarizeRecursiveFmStack(stack);
  $("structureState").textContent = `${summary.recursiveTurns} ${summary.recursiveTurns === 1 ? "recursion" : "recursions"} · bounded`;
  $("seedReadout").textContent = `${formatRecursiveFmFrequency(settings.carrierHz)} carrier`;
  $("entryReadout").textContent = `${formatRecursiveFmFrequency(settings.offsetHz)} → ${formatRecursiveFmFrequency(settings.offsetHz + settings.modulationHz)}`;
  const recursiveOperators = stack.operators.filter(
    (operator) => operator.kind === "recursive-operator",
  );
  $("turnsReadout").textContent = recursiveOperators.length > 0
    ? recursiveOperators.map(
      (operator, index) => (
        `${index + 1}: ${formatRecursiveFmFrequency(operator.modulationHz)}`
      ),
    ).join(" · ")
    : "none · entry is audible";
  $("operatorReadout").textContent = `operator ${stack.audibleIndex} · ${(stack.normalizedGain * 100).toFixed(0)}% normalized`;
  $("ceilingReadout").textContent = formatRecursiveFmFrequency(settings.maximumFrequencyHz);
  updateSignalFlow(stack);
  $("stageReadout").textContent = `${summary.label} · ${state.performance.playMode} · ${engine.running ? "ON" : "OFF"}`.toUpperCase();
  canvas.setAttribute(
    "aria-label",
    `Recursive FM live spectrum bars with a foreground oscilloscope and ${summary.recursiveTurns} recursive ${summary.recursiveTurns === 1 ? "operator" : "operators"}. Audio ${engine.running ? "on" : "off"}.`,
  );
}

function writeControlsFromState() {
  for (const [name, control] of Object.entries(controls)) {
    control.write(state.settings[name], control.input);
  }
}

function applyPerformanceSettings(settings, { message = null } = {}) {
  state.performance = { ...sanitizeRecursiveFmPerformance({
    ...state.performance,
    ...settings,
  }) };
  engine.updatePerformance(state.performance);
  writePerformanceControls();
  updateControlOutputs();
  if (message) $("liveStatus").textContent = message;
}

function applySettings(settings, { presetId = null, announce = false } = {}) {
  const safe = sanitizeRecursiveFmSettings(settings, { sampleRate: engine.sampleRate });
  state.settings = {
    depth: safe.depth,
    carrierHz: safe.carrierHz,
    offsetHz: safe.offsetHz,
    modulationHz: safe.modulationHz,
    divisor: safe.divisor,
  };
  state.activePresetId = presetId;
  writeControlsFromState();
  const stack = engine.running
    ? engine.updateSettings(state.settings)
    : currentStack();
  updatePresetButtons();
  updateControlOutputs(stack);
  visualizationDirty = true;
  scheduleVisualization();
  if (announce) {
    const preset = presetById(presetId);
    $("liveStatus").textContent = preset
      ? `${preset.label} Recursive FM preset selected.`
      : "Recursive FM parameters reset.";
  }
}

function updateAudioUi() {
  const active = engine.running;
  $("audioButton").setAttribute("aria-pressed", String(active));
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = active ? "on" : "off";
  updateControlOutputs();
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
  $("liveStatus").textContent = `Audio error: ${message}`;
}

function clearError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  visualizationDirty = true;
  scheduleVisualization();
}

function drawRoundedNode(context, x, y, radius, color, selected) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = selected ? color : "#07090b";
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = selected ? 2 : 1;
  context.stroke();
}

function drawAlgorithm(context, stack, width, height) {
  const operators = stack.operators;
  const left = Math.max(28, width * 0.065);
  const right = width - left;
  const graphY = Math.max(92, Math.min(height * 0.47, height - 112));
  const available = Math.max(1, right - left);
  const spacing = operators.length > 1 ? available / (operators.length - 1) : 0;
  const radius = Math.max(7, Math.min(13, spacing * 0.23));
  const colors = ["#5fe8c4", "#7db4ff", "#b59cff"];

  context.save();
  context.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (let index = 1; index < operators.length; index += 1) {
    const x1 = left + spacing * (index - 1);
    const x2 = left + spacing * index;
    const color = index === operators.length - 1
      ? "#fff3d6"
      : colors[Math.min(2, index)];
    context.beginPath();
    context.moveTo(x1 + radius + 3, graphY);
    context.lineTo(x2 - radius - 3, graphY);
    context.strokeStyle = color;
    context.globalAlpha = 0.42;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;

    if (spacing > 60) {
      context.fillStyle = "#77837e";
      context.fillText(
        formatRecursiveFmFrequency(operators[index].modulationHz),
        (x1 + x2) / 2,
        graphY - 17,
      );
    }
  }

  operators.forEach((operator, index) => {
    const x = left + spacing * index;
    const selected = index === stack.audibleIndex;
    const color = selected
      ? "#fff3d6"
      : (index === 0 ? colors[0] : (index === 1 ? colors[1] : colors[2]));
    drawRoundedNode(context, x, graphY, selected ? radius + 2 : radius, color, selected);
    context.fillStyle = selected ? "#07090b" : color;
    context.font = `${Math.max(6, Math.min(9, radius * 0.72))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(index === 0 ? "C" : String(index), x, graphY + 0.5);
    if (spacing > 36 || operators.length <= 7) {
      context.fillStyle = selected ? "#fff3d6" : "#77837e";
      context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(
        index === 0 ? "CARRIER" : (index === 1 ? "ENTRY" : `TURN ${index - 1}`),
        x,
        graphY + radius + 17,
      );
    }
  });
  context.restore();
}

function drawScope(context, waveform, width, height) {
  const left = Math.max(24, width * 0.045);
  const right = width - left;
  const top = Math.max(height * 0.67, 125);
  const bottom = Math.max(top + 24, height - 43);
  const middle = (top + bottom) / 2;

  context.save();
  context.strokeStyle = "rgba(214, 232, 226, 0.08)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, middle);
  context.lineTo(right, middle);
  context.stroke();

  context.beginPath();
  if (waveform) {
    const slice = (right - left) / Math.max(1, waveform.length - 1);
    for (let index = 0; index < waveform.length; index += 1) {
      const x = left + index * slice;
      const normalized = waveform[index] / 128 - 1;
      const y = middle + normalized * (bottom - top) * 0.46;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = "#b59cff";
    context.shadowColor = "rgba(181, 156, 255, 0.35)";
    context.shadowBlur = 8;
  } else {
    context.moveTo(left, middle);
    context.lineTo(right, middle);
    context.strokeStyle = "rgba(119, 131, 126, 0.48)";
  }
  context.lineWidth = 1.25;
  context.stroke();
  context.restore();
}

function drawVisualization() {
  canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  canvasContext.clearRect(0, 0, cssWidth, cssHeight);
  drawChaoticLiveAnalysis(canvasContext, {
    analyser: engine.analyser,
    audioOn: engine.running,
    height: cssHeight,
    scopeGlow: "rgba(181, 156, 255, 0.72)",
    scopeStroke: "#fff3d6",
    spectrum,
    spectrumBarCap: "rgba(125, 180, 255, 0.72)",
    spectrumBarFill: "rgba(181, 156, 255, 0.28)",
    waveform: engine.readWaveform(),
    width: cssWidth,
  });
}

function visualizationFrame(timestamp) {
  visualFrameId = null;
  const shouldAnimate = engine.running && !document.hidden;
  if (
    visualizationDirty
    || timestamp - lastVisualFrame >= VISUAL_FRAME_INTERVAL
  ) {
    drawVisualization();
    visualizationDirty = false;
    lastVisualFrame = timestamp;
  }
  if (shouldAnimate) visualFrameId = requestAnimationFrame(visualizationFrame);
}

function scheduleVisualization() {
  if (visualFrameId === null && !document.hidden) {
    visualFrameId = requestAnimationFrame(visualizationFrame);
  }
}

for (const [name, control] of Object.entries(controls)) {
  control.input.dataset.parameterId = RECURSIVE_FM_PARAMETER_IDS[name];
  control.input.addEventListener("input", () => {
    const next = {
      ...state.settings,
      [name]: control.read(control.input),
    };
    applySettings(next);
  });
}

for (const [name, control] of Object.entries(performanceControls)) {
  control.input.dataset.parameterId = RECURSIVE_FM_PARAMETER_IDS[name];
  control.input.addEventListener("input", () => {
    applyPerformanceSettings({ [name]: control.read(control.input) });
  });
}

$("level").dataset.parameterId = RECURSIVE_FM_PARAMETER_IDS.output;
$("glideMode").dataset.parameterId = RECURSIVE_FM_PARAMETER_IDS.glideMode;

$("glideMode").addEventListener("change", () => {
  applyPerformanceSettings(
    { glideMode: $("glideMode").value },
    { message: `${$("glideMode").value} glide mode selected.` },
  );
});

$("presetButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;
  const preset = presetById(button.dataset.preset);
  if (!preset) return;
  clearError();
  applySettings(preset.settings, { presetId: preset.id, announce: true });
});

$("level").addEventListener("input", () => {
  state.level = Number($("level").value);
  $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
  engine.setLevel(state.level);
});

$("audioButton").addEventListener("click", async () => {
  if (state.audioStarting) return;
  clearError();
  state.audioStarting = true;
  updateAudioUi();
  try {
    if (engine.running) {
      await engine.stop();
      clearMidiMonitorState("Audio off · MIDI activity only");
      $("liveStatus").textContent = "Recursive FM audio off.";
    } else {
      clearMidiMonitorState(
        state.performance.playMode === "midi"
          ? "Ready for MIDI"
          : "Drone mode · MIDI activity only",
      );
      await engine.start(state.settings, state.level, state.performance);
      $("liveStatus").textContent = "Recursive FM audio on.";
    }
  } catch (error) {
    await engine.stop({ immediate: true });
    showError(error);
  } finally {
    state.audioStarting = false;
    visualizationDirty = true;
    updateAudioUi();
    scheduleVisualization();
  }
});

$("resetRecursiveFm").addEventListener("click", () => {
  clearError();
  engine.allSoundOff();
  engine.resetControllers();
  state.level = DEFAULT_LEVEL;
  state.performance = {
    ...RECURSIVE_FM_PERFORMANCE_DEFAULTS,
    playMode: sharedMidiEnabled ? "midi" : "drone",
  };
  state.expression = 1;
  state.sustain = false;
  state.bend = 0;
  state.midiSelectedNote = -1;
  $("level").value = String(DEFAULT_LEVEL);
  $("levelOut").textContent = `${Math.round(DEFAULT_LEVEL * 100)}%`;
  engine.setLevel(DEFAULT_LEVEL);
  engine.updatePerformance(state.performance);
  writePerformanceControls();
  applySettings(defaultPreset.settings, {
    presetId: defaultPreset.id,
    announce: true,
  });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    visualizationDirty = true;
    scheduleVisualization();
  }
});

window.addEventListener("pagehide", () => {
  unregisterMidiClient?.();
  unregisterMidiClient = null;
  engine.allSoundOff();
  engine.stop({ immediate: true });
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  registerSharedMidiClient();
  updateAudioUi();
  visualizationDirty = true;
  scheduleVisualization();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !engine.running) return;
  engine.stop({ immediate: true }).finally(() => {
    clearMidiMonitorState("Audio off · MIDI activity only");
    state.audioStarting = false;
    updateAudioUi();
    visualizationDirty = true;
    scheduleVisualization();
  });
});

if ("ResizeObserver" in window) {
  new ResizeObserver(resizeCanvas).observe(stageWrap);
} else {
  window.addEventListener("resize", resizeCanvas);
}

writeControlsFromState();
writePerformanceControls();
updatePresetButtons();
updateControlOutputs();
resizeCanvas();
registerSharedMidiClient();
