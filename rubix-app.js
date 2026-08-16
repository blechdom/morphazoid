import {
  DEFAULT_FM_DRUM_VOICES,
  FM_DRUM_STORAGE_KEY,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import { unlockAudioContext } from "./src/audio.js";
import {
  createRubixVisibilityProfile,
  rubixStickerVisibility,
  rubixVisibilityGain,
} from "./src/rubix-visibility.js";
import {
  DEFAULT_RUBIX_CAMERA,
  RUBIX_ACID_MIDI_BY_COLOR,
  RUBIX_COLOR_ORDER,
  RUBIX_DRUM_LEFT_VOICE_BY_COLOR,
  RUBIX_DRUM_RIGHT_VOICE_BY_COLOR,
  RUBIX_FACE_DEFINITIONS,
  RUBIX_READ_MODES,
  createRubixSequenceSnapshot,
  createSolvedRubixCube,
  rubixFaceForNormal,
  rubixEulerMatrix,
  rubixLayersForSize,
  rubixReadFrame,
  turnRubixLayer,
} from "./src/rubix.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const TAU = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;
const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 24;
const TEMPO_MIN_BPM = 30;
const TEMPO_MAX_BPM = 300;
const DEFAULT_READING_MODE = "parallel";
const DEFAULT_GEOMETRY_ID = "cube3";

const COLOR_HEX = Object.freeze({
  white: "#edf6ee",
  yellow: "#f5c95c",
  green: "#70e06f",
  blue: "#458cff",
  red: "#ff5f72",
  orange: "#ff784f",
});

const COLOR_INK = Object.freeze({
  white: "#101416",
  yellow: "#171309",
  green: "#081308",
  blue: "#f2f7ff",
  red: "#fff5f7",
  orange: "#160a05",
});

const FACE_SHORT = Object.freeze({
  up: "U",
  down: "D",
  front: "F",
  back: "B",
  left: "L",
  right: "R",
});

const ROLE_META = Object.freeze({
  acid: Object.freeze({ label: "Acid", detail: "upper visible face", color: "#9dff57" }),
  drumLeft: Object.freeze({ label: "Drum A", detail: "left visible face", color: "#62dbff" }),
  drumRight: Object.freeze({ label: "Drum B", detail: "right visible face", color: "#ff784f" }),
});

const ROLE_AUDIO_VALUE = Object.freeze({
  acid: "acidMidi",
  drumLeft: "drumLeftVoiceIndices",
  drumRight: "drumRightVoiceIndices",
});

const PERC_ENGINES = Object.freeze({
  "soft-fm": Object.freeze({
    id: "soft-fm",
    label: "Soft FM",
    detail: "rounded carrier + modulation",
  }),
  analog: Object.freeze({
    id: "analog",
    label: "Analog drums",
    detail: "sine bodies + shaped noise",
  }),
  modal: Object.freeze({
    id: "modal",
    label: "Modal wood",
    detail: "three short damped partials",
  }),
  noise: Object.freeze({
    id: "noise",
    label: "Noise circuit",
    detail: "filtered bursts + quiet body",
  }),
});

const READ_MODE_DESCRIPTIONS = Object.freeze({
  parallel: "All three visible faces read left-to-right, top-to-bottom together. Hidden stickers are silent.",
  snake: "All three visible faces snake together: the middle row reverses, then the bottom row turns forward again. Hidden stickers are silent.",
  face: "Each snake beat is divided into three face subdivisions: upper acid, left drum, then right drum. Hidden stickers are silent.",
});

const GEOMETRIES = Object.freeze({
  cube3: Object.freeze({ id: "cube3", label: "3 × 3 · Rubix cube", size: 3, surface: "cube" }),
  cube2: Object.freeze({ id: "cube2", label: "2 × 2 · Pocket cube", size: 2, surface: "cube" }),
  cube4: Object.freeze({ id: "cube4", label: "4 × 4 · Rubix cube", size: 4, surface: "cube" }),
  cube5: Object.freeze({ id: "cube5", label: "5 × 5 · Rubix cube", size: 5, surface: "cube" }),
  cube6: Object.freeze({ id: "cube6", label: "6 × 6 · Rubix cube", size: 6, surface: "cube" }),
  pyramid: Object.freeze({ id: "pyramid", label: "Pyramid · faceted", size: 3, surface: "pyramid" }),
  sphere: Object.freeze({ id: "sphere", label: "Sphere · orbital", size: 3, surface: "sphere" }),
});

const DEFAULTS = Object.freeze({
  tempo: 126,
  swing: 0,
  cutoff: 980,
  resonance: 11.5,
  acidDecay: 0.18,
  drive: 2.4,
  acidLevel: 0.58,
  drumLevel: 0.54,
  percEngine: "soft-fm",
  visibilityDynamics: 0.72,
  output: 0.56,
  randomTwists: false,
  randomTwistTempo: 24,
});

const SOUND_DEFAULTS = Object.freeze({
  tempo: DEFAULTS.tempo,
  swing: DEFAULTS.swing,
  cutoff: DEFAULTS.cutoff,
  resonance: DEFAULTS.resonance,
  acidDecay: DEFAULTS.acidDecay,
  drive: DEFAULTS.drive,
  acidLevel: DEFAULTS.acidLevel,
  drumLevel: DEFAULTS.drumLevel,
  percEngine: DEFAULTS.percEngine,
  visibilityDynamics: DEFAULTS.visibilityDynamics,
  output: DEFAULTS.output,
});

const RUBIX_PRESETS = Object.freeze({
  classic: Object.freeze({
    id: "classic",
    label: "Classic cube",
    geometryId: "cube3",
    readingMode: "parallel",
    settings: Object.freeze({ ...DEFAULTS }),
  }),
  "pocket-funk": Object.freeze({
    id: "pocket-funk",
    label: "Pocket funk",
    geometryId: "cube2",
    readingMode: "snake",
    settings: Object.freeze({
      tempo: 108, swing: 0.16, visibilityDynamics: 0.58,
      cutoff: 720, resonance: 8.8, acidDecay: 0.24, drive: 1.6,
      acidLevel: 0.43, drumLevel: 0.52, output: 0.52,
      percEngine: "analog", randomTwists: true, randomTwistTempo: 18,
    }),
  }),
  "modal-sphere": Object.freeze({
    id: "modal-sphere",
    label: "Modal sphere",
    geometryId: "sphere",
    readingMode: "face",
    settings: Object.freeze({
      tempo: 112, swing: 0.2, visibilityDynamics: 0.86,
      cutoff: 620, resonance: 7.5, acidDecay: 0.28, drive: 1.35,
      acidLevel: 0.36, drumLevel: 0.53, output: 0.52,
      percEngine: "modal", randomTwists: true, randomTwistTempo: 15,
    }),
  }),
  "noise-grid": Object.freeze({
    id: "noise-grid",
    label: "Noise grid",
    geometryId: "cube4",
    readingMode: "face",
    settings: Object.freeze({
      tempo: 138, swing: 0.04, visibilityDynamics: 0.92,
      cutoff: 1860, resonance: 9, acidDecay: 0.11, drive: 1.7,
      acidLevel: 0.4, drumLevel: 0.4, output: 0.48,
      percEngine: "noise", randomTwists: true, randomTwistTempo: 42,
    }),
  }),
  "pyramid-drift": Object.freeze({
    id: "pyramid-drift",
    label: "Pyramid drift",
    geometryId: "pyramid",
    readingMode: "snake",
    settings: Object.freeze({
      tempo: 94, swing: 0.12, visibilityDynamics: 0.78,
      cutoff: 540, resonance: 10.4, acidDecay: 0.38, drive: 1.25,
      acidLevel: 0.34, drumLevel: 0.48, output: 0.5,
      percEngine: "modal", randomTwists: true, randomTwistTempo: 11,
    }),
  }),
});

function cloneVector(source) {
  return { x: source.x, y: source.y, z: source.z };
}

function add(first, second) {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function scale(source, amount) {
  return { x: source.x * amount, y: source.y * amount, z: source.z * amount };
}

function dot(first, second) {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function cross(first, second) {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

function vectorLength(source) {
  return Math.hypot(source.x, source.y, source.z);
}

function normalize(source) {
  const length = Math.max(1e-9, vectorLength(source));
  return scale(source, 1 / length);
}

function axisVector(axis) {
  return {
    x: axis === "x" ? 1 : 0,
    y: axis === "y" ? 1 : 0,
    z: axis === "z" ? 1 : 0,
  };
}

function axisName(source) {
  if (Math.abs(source.x) > 0.5) return "x";
  if (Math.abs(source.y) > 0.5) return "y";
  if (Math.abs(source.z) > 0.5) return "z";
  throw new Error("Rubix slice axes must align with x, y, or z.");
}

function rotateAroundAxis(source, axis, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  if (axis === "x") {
    return {
      x: source.x,
      y: source.y * cosine - source.z * sine,
      z: source.y * sine + source.z * cosine,
    };
  }
  if (axis === "y") {
    return {
      x: source.x * cosine + source.z * sine,
      y: source.y,
      z: -source.x * sine + source.z * cosine,
    };
  }
  return {
    x: source.x * cosine - source.y * sine,
    y: source.x * sine + source.y * cosine,
    z: source.z,
  };
}

function midiFrequency(midi) {
  return 440 * (2 ** ((midi - 69) / 12));
}

function midiLabel(midi) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const note = Math.round(midi);
  return `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

function shadeHex(hex, amount) {
  const source = hex.replace("#", "");
  const target = amount >= 0 ? 255 : 0;
  const weight = Math.abs(clamp(amount, -1, 1));
  const channels = [0, 2, 4].map((offset) => parseInt(source.slice(offset, offset + 2), 16));
  return `#${channels.map((channel) => (
    Math.round(channel + (target - channel) * weight).toString(16).padStart(2, "0")
  )).join("")}`;
}

function loadDrumBank() {
  const defaults = DEFAULT_FM_DRUM_VOICES.map((voice) => ({ ...voice }));
  const editableKeys = [
    "frequency", "attack", "decay", "modRatio", "modIndex",
    "pitchBend", "noise", "tone", "level",
  ];
  try {
    const stored = JSON.parse(localStorage.getItem(FM_DRUM_STORAGE_KEY));
    if (!Array.isArray(stored) || stored.length !== defaults.length) return defaults;
    return defaults.map((fallback) => {
      const saved = stored.find((voice) => voice?.id === fallback.id);
      const merged = { ...fallback };
      for (const key of editableKeys) {
        if (saved && Object.hasOwn(saved, key)) merged[key] = saved[key];
      }
      return sanitizeFmDrumVoice(merged);
    });
  } catch {
    return defaults;
  }
}

class RubixAudioEngine {
  constructor(runtime = globalThis, voices = DEFAULT_FM_DRUM_VOICES) {
    this.runtime = runtime;
    this.voices = voices;
    this.context = null;
    this.compressor = null;
    this.transportGain = null;
    this.master = null;
    this.analyser = null;
    this.drumBus = null;
    this.acidBus = null;
    this.acidFilter = null;
    this.acidShaper = null;
    this.acidVca = null;
    this.acidOscillator = null;
    this.acidSub = null;
    this.noiseBuffer = null;
    this.output = DEFAULTS.output;
    this.lastAcidFrequency = midiFrequency(52);
    this.lifecycleGeneration = 0;
  }

  async start(settings) {
    const lifecycleGeneration = this.lifecycleGeneration;
    if (!this.context || this.context.state === "closed") {
      const Context = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      if (!Context) throw new Error("Web Audio is not available in this browser.");
      const context = new Context({ latencyHint: "interactive" });
      this.context = context;
      this.buildGraph(settings);
    }
    const context = this.context;
    if (context.state === "suspended") {
      unlockAudioContext(context);
      await context.resume();
    }
    if (
      lifecycleGeneration !== this.lifecycleGeneration
      || context !== this.context
      || context.state === "closed"
    ) {
      const error = new Error("Rubix audio start was cancelled.");
      error.name = "AbortError";
      throw error;
    }
    this.updateSettings(settings);
    return context;
  }

  buildGraph(settings) {
    const context = this.context;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -13;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 7;
    this.compressor.attack.value = 0.002;
    this.compressor.release.value = 0.16;

    this.transportGain = context.createGain();
    this.transportGain.gain.value = 0.0001;
    this.master = context.createGain();
    this.master.gain.value = this.output;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.78;

    this.drumBus = context.createGain();
    this.acidBus = context.createGain();
    this.drumBus.connect(this.compressor);
    this.acidBus.connect(this.compressor);
    this.compressor.connect(this.transportGain);
    this.transportGain.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(context.destination);

    const sawGain = context.createGain();
    const subGain = context.createGain();
    sawGain.gain.value = 0.38;
    subGain.gain.value = 0.12;
    this.acidOscillator = context.createOscillator();
    this.acidOscillator.type = "sawtooth";
    this.acidSub = context.createOscillator();
    this.acidSub.type = "square";
    this.acidOscillator.frequency.value = this.lastAcidFrequency;
    this.acidSub.frequency.value = this.lastAcidFrequency * 0.5;
    this.acidOscillator.connect(sawGain);
    this.acidSub.connect(subGain);

    this.acidFilter = context.createBiquadFilter();
    this.acidFilter.type = "lowpass";
    this.acidShaper = context.createWaveShaper();
    this.acidShaper.oversample = "4x";
    this.acidVca = context.createGain();
    this.acidVca.gain.value = 0.0001;
    sawGain.connect(this.acidFilter);
    subGain.connect(this.acidFilter);
    this.acidFilter.connect(this.acidShaper);
    this.acidShaper.connect(this.acidVca);
    this.acidVca.connect(this.acidBus);

    this.noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const noise = this.noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) noise[index] = Math.random() * 2 - 1;

    const now = context.currentTime;
    this.acidOscillator.start(now);
    this.acidSub.start(now);
    this.updateSettings(settings);
  }

  updateSettings(settings) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.drumBus.gain.setTargetAtTime(clamp(settings.drumLevel, 0, 1), now, 0.015);
    this.acidBus.gain.setTargetAtTime(clamp(settings.acidLevel, 0, 1), now, 0.015);
    this.acidFilter.Q.setTargetAtTime(clamp(settings.resonance, 0, 18), now, 0.012);
    this.acidShaper.curve = this.distortionCurve(settings.drive);
  }

  distortionCurve(amount) {
    const drive = clamp(amount, 0.5, 6);
    const curve = new Float32Array(1024);
    for (let index = 0; index < curve.length; index += 1) {
      const x = index * 2 / (curve.length - 1) - 1;
      curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
  }

  setOutput(value) {
    this.output = clamp(value, 0, 0.9);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.output, this.context.currentTime, 0.015);
    }
  }

  setTransportActive(active) {
    if (!this.transportGain || !this.context) return;
    const now = this.context.currentTime;
    this.transportGain.gain.cancelScheduledValues(now);
    this.transportGain.gain.setTargetAtTime(active ? 1 : 0.0001, now, active ? 0.008 : 0.018);
    if (!active && this.acidVca) {
      this.acidVca.gain.cancelScheduledValues(now);
      this.acidVca.gain.setTargetAtTime(0.0001, now, 0.008);
    }
  }

  scheduleAcid(midi, sticker, when, stepDuration, settings, laneGain = 1) {
    if (!this.context || !this.acidOscillator || !this.acidSub || !this.acidVca) return;
    const visibleGain = clamp(laneGain, 0, 1);
    if (visibleGain <= 0) return;
    const target = midiFrequency(midi + 12);
    const glide = sticker.color === "blue" || sticker.color === "green";
    const lastCell = Math.max(0, Number(settings.cube?.size ?? 3) - 1);
    const isCorner = [0, lastCell].includes(sticker.homeRow) && [0, lastCell].includes(sticker.homeColumn);
    const accent = sticker.isCenter ? 1.18 : (isCorner ? 1.06 : 0.92);
    const attackEnd = when + 0.006;
    const decayEnd = when + Math.min(stepDuration * 0.94, clamp(settings.acidDecay, 0.06, 0.72));

    this.acidOscillator.frequency.setValueAtTime(this.lastAcidFrequency, when);
    this.acidSub.frequency.setValueAtTime(this.lastAcidFrequency * 0.5, when);
    if (glide) {
      const glideEnd = when + Math.min(0.055, stepDuration * 0.42);
      this.acidOscillator.frequency.exponentialRampToValueAtTime(target, glideEnd);
      this.acidSub.frequency.exponentialRampToValueAtTime(target * 0.5, glideEnd);
    } else {
      this.acidOscillator.frequency.setValueAtTime(target, when);
      this.acidSub.frequency.setValueAtTime(target * 0.5, when);
    }
    this.lastAcidFrequency = target;

    const peak = clamp(0.34 * accent * visibleGain, 0.0001, 0.52);
    this.acidVca.gain.setValueAtTime(0.0001, when);
    this.acidVca.gain.linearRampToValueAtTime(peak, attackEnd);
    this.acidVca.gain.exponentialRampToValueAtTime(0.0001, Math.max(attackEnd + 0.012, decayEnd));

    const cutoff = clamp(settings.cutoff, 160, 4200);
    const peakCutoff = clamp(cutoff * (2.25 + accent), 180, 12_000);
    this.acidFilter.frequency.setValueAtTime(peakCutoff, when);
    this.acidFilter.frequency.exponentialRampToValueAtTime(cutoff, Math.max(when + 0.018, decayEnd));
    this.acidFilter.Q.setValueAtTime(clamp(settings.resonance + (accent - 1) * 3, 0, 20), when);
  }

  scheduleDrum(voiceIndex, when, laneGain = 1, engineId = "soft-fm") {
    if (!this.context || !this.drumBus) return;
    const safeGain = clamp(laneGain, 0, 1.4);
    if (safeGain <= 0) return;
    const voice = sanitizeFmDrumVoice(this.voices[voiceIndex] ?? this.voices[0]);
    if (engineId === "analog") {
      this.scheduleAnalogDrum(voice, when, safeGain);
    } else if (engineId === "modal") {
      this.scheduleModalDrum(voice, when, safeGain);
    } else if (engineId === "noise") {
      this.scheduleNoiseDrum(voice, when, safeGain);
    } else {
      this.scheduleFmDrum(voice, when, safeGain);
    }
  }

  scheduleFmDrum(voice, when, laneGain) {
    const context = this.context;
    const stopAt = when + Math.max(0.12, voice.attack + voice.decay * 1.35);
    const amplitude = context.createGain();
    const filter = context.createBiquadFilter();
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modulation = context.createGain();

    amplitude.gain.setValueAtTime(0.0001, when);
    amplitude.gain.exponentialRampToValueAtTime(
      Math.max(0.001, voice.level * laneGain * 0.6),
      when + voice.attack,
    );
    amplitude.gain.exponentialRampToValueAtTime(0.0001, when + voice.attack + voice.decay);
    filter.type = voice.family === "hat" ? "highpass" : "lowpass";
    filter.frequency.value = voice.family === "hat"
      ? 2200 + voice.tone * 5000
      : 550 + voice.tone * 11_500;
    filter.Q.value = 0.75;
    amplitude.connect(filter);
    filter.connect(this.drumBus);

    const base = voice.frequency;
    carrier.type = voice.family === "hat" ? "triangle" : "sine";
    modulator.type = "triangle";
    carrier.frequency.setValueAtTime(clamp(base * Math.max(0.15, 1 + voice.pitchBend), 20, 16_000), when);
    carrier.frequency.exponentialRampToValueAtTime(base, when + Math.max(0.018, voice.decay * 0.42));
    modulator.frequency.value = clamp(base * voice.modRatio, 20, 18_000);
    const modulationDepth = Math.min(
      context.sampleRate * 0.24,
      base * voice.modIndex * (voice.family === "hat" ? 0.22 : 0.55),
    );
    modulation.gain.setValueAtTime(Math.max(0.001, modulationDepth), when);
    modulation.gain.exponentialRampToValueAtTime(0.001, when + Math.max(0.025, voice.decay));
    modulator.connect(modulation);
    modulation.connect(carrier.frequency);
    carrier.connect(amplitude);
    carrier.start(when);
    modulator.start(when);
    carrier.stop(stopAt);
    modulator.stop(stopAt);
    if (voice.noise > 0.005) {
      this.scheduleNoise(voice, filter, when, stopAt, laneGain * 0.72);
    }
  }

  scheduleAnalogDrum(voice, when, laneGain) {
    const context = this.context;
    const family = voice.family;
    const attack = clamp(voice.attack, 0.001, 0.08);
    const decayScale = family === "kick" ? 0.62 : family === "tom" ? 0.6 : 0.46;
    const decay = clamp(voice.decay * decayScale, 0.045, 0.48);
    const envelopeEnd = when + attack + decay;
    const stopAt = envelopeEnd + 0.06;
    if (family !== "hat") {
      const oscillator = context.createOscillator();
      const amplitude = context.createGain();
      const filter = context.createBiquadFilter();
      const pitchStart = family === "kick" ? 3.4 : family === "tom" ? 1.75 : 1.12;
      const peak = Math.max(0.001, voice.level * laneGain * 0.54 * Math.SQRT1_2);
      oscillator.type = family === "snare" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(clamp(voice.frequency * pitchStart, 24, 12_000), when);
      oscillator.frequency.exponentialRampToValueAtTime(
        clamp(voice.frequency, 20, 12_000),
        when + Math.max(0.018, decay * 0.38),
      );
      amplitude.gain.setValueAtTime(0.0001, when);
      amplitude.gain.exponentialRampToValueAtTime(peak, when + attack);
      amplitude.gain.exponentialRampToValueAtTime(0.0001, envelopeEnd);
      filter.type = "lowpass";
      filter.frequency.value = family === "kick"
        ? 520 + voice.tone * 1400
        : 900 + voice.tone * 3600;
      filter.Q.value = 0.65;
      oscillator.connect(amplitude);
      amplitude.connect(filter);
      filter.connect(this.drumBus);
      oscillator.start(when);
      oscillator.stop(stopAt);
    }

    const noiseAmount = family === "hat"
      ? Math.max(0.64, voice.noise)
      : family === "snare"
        ? Math.max(0.42, voice.noise)
        : voice.noise * 0.52;
    if (noiseAmount > 0.005) {
      this.scheduleNoise(
        { ...voice, attack, noise: noiseAmount, decay },
        this.drumBus,
        when,
        stopAt,
        laneGain * 0.54,
      );
    }
  }

  scheduleModalDrum(voice, when, laneGain) {
    const context = this.context;
    const root = voice.family === "hat" ? voice.frequency * 0.14 : voice.frequency;
    const attack = clamp(voice.attack, 0.001, 0.06);
    const decay = clamp(voice.decay * 0.72, 0.065, 0.68);
    const ratios = [1, 3.02, 6.13];
    const partialLevels = [0.74, 0.19, 0.07];
    const decayFactors = [1, 0.46, 0.23];
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1700 + voice.tone * 4200;
    filter.Q.value = 0.85;
    filter.connect(this.drumBus);
    ratios.forEach((ratio, index) => {
      const oscillator = context.createOscillator();
      const amplitude = context.createGain();
      const partialDecay = Math.max(0.035, decay * decayFactors[index]);
      const partialEnd = when + attack + partialDecay;
      const peak = Math.max(
        0.001,
        voice.level * laneGain * 0.52 * partialLevels[index] * Math.SQRT1_2,
      );
      oscillator.type = "sine";
      oscillator.frequency.value = clamp(root * ratio, 24, 14_000);
      amplitude.gain.setValueAtTime(0.0001, when);
      amplitude.gain.exponentialRampToValueAtTime(peak, when + attack);
      amplitude.gain.exponentialRampToValueAtTime(0.0001, partialEnd);
      oscillator.connect(amplitude);
      amplitude.connect(filter);
      oscillator.start(when);
      oscillator.stop(partialEnd + 0.05);
    });
    if (voice.noise > 0.02) {
      const noiseDecay = Math.min(decay, 0.24);
      this.scheduleNoise(
        { ...voice, attack, decay: noiseDecay },
        this.drumBus,
        when,
        when + attack + noiseDecay + 0.05,
        laneGain * 0.14,
      );
    }
  }

  scheduleNoiseDrum(voice, when, laneGain) {
    const context = this.context;
    const family = ["kick", "snare", "tom", "hat"].includes(voice.family)
      ? voice.family
      : "snare";
    const attack = clamp(voice.attack, 0.001, 0.055);
    const decay = clamp(voice.decay, 0.04, 0.32);
    const envelopeEnd = when + attack + decay;
    const peakByFamily = { kick: 0.22, snare: 0.52, tom: 0.28, hat: 0.48 };
    const filterSettings = {
      kick: ["bandpass", 180 + voice.tone * 420, 1.1],
      snare: ["bandpass", 1000 + voice.tone * 1800, 0.8],
      tom: ["bandpass", 420 + voice.tone * 1050, 1.8],
      hat: ["highpass", 3200 + voice.tone * 3800, 0.7],
    };
    const [type, frequency, q] = filterSettings[family];
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const amplitude = context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    amplitude.gain.setValueAtTime(0.0001, when);
    amplitude.gain.linearRampToValueAtTime(
      Math.max(0.001, peakByFamily[family] * voice.level * laneGain * Math.SQRT1_2),
      when + attack,
    );
    amplitude.gain.exponentialRampToValueAtTime(0.0001, envelopeEnd);
    source.connect(filter);
    filter.connect(amplitude);
    amplitude.connect(this.drumBus);
    const stopAt = envelopeEnd + 0.05;
    const availableOffset = Math.max(0, this.noiseBuffer.duration - (stopAt - when));
    source.start(when, Math.random() * availableOffset);
    source.stop(stopAt);
    if (["kick", "tom"].includes(family)) {
      const body = context.createOscillator();
      const bodyGain = context.createGain();
      body.type = "sine";
      body.frequency.setValueAtTime(clamp(voice.frequency * 1.45, 24, 4000), when);
      body.frequency.exponentialRampToValueAtTime(
        clamp(voice.frequency * 0.82, 20, 4000),
        when + Math.max(0.025, decay * 0.62),
      );
      bodyGain.gain.setValueAtTime(0.0001, when);
      bodyGain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, voice.level * laneGain * 0.12),
        when + attack,
      );
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, envelopeEnd);
      body.connect(bodyGain);
      bodyGain.connect(this.drumBus);
      body.start(when);
      body.stop(stopAt);
    }
  }

  scheduleNoise(voice, destination, when, stopAt, laneGain) {
    const context = this.context;
    const source = context.createBufferSource();
    const amplitude = context.createGain();
    const filter = context.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    filter.type = voice.family === "kick" ? "bandpass" : "highpass";
    filter.frequency.value = voice.family === "kick" ? 900 : 900 + voice.tone * 7200;
    filter.Q.value = voice.family === "snare" ? 0.7 : 1.8;
    amplitude.gain.setValueAtTime(0.0001, when);
    amplitude.gain.linearRampToValueAtTime(
      Math.max(0.001, voice.noise * voice.level * laneGain * Math.SQRT1_2),
      when + voice.attack,
    );
    amplitude.gain.exponentialRampToValueAtTime(0.0001, when + voice.attack + voice.decay);
    source.connect(filter);
    filter.connect(amplitude);
    amplitude.connect(destination);
    const availableOffset = Math.max(0, this.noiseBuffer.duration - (stopAt - when));
    source.start(when, Math.random() * availableOffset);
    source.stop(stopAt);
  }

  async close() {
    this.lifecycleGeneration += 1;
    const context = this.context;
    this.context = null;
    this.compressor = null;
    this.transportGain = null;
    this.master = null;
    this.analyser = null;
    this.drumBus = null;
    this.acidBus = null;
    this.acidFilter = null;
    this.acidShaper = null;
    this.acidVca = null;
    this.acidOscillator = null;
    this.acidSub = null;
    this.noiseBuffer = null;
    if (context && context.state !== "closed") await context.close();
  }
}

const voices = loadDrumBank();
const audio = new RubixAudioEngine(globalThis, voices);
const state = {
  cube: createSolvedRubixCube(),
  camera: { ...DEFAULT_RUBIX_CAMERA },
  selectedStickerId: null,
  audioOn: false,
  playing: false,
  currentStep: 0,
  readingMode: DEFAULT_READING_MODE,
  geometryId: DEFAULT_GEOMETRY_ID,
  presetId: "classic",
  ...DEFAULTS,
};

let sequenceSnapshot = createRubixSequenceSnapshot(state.cube, state.camera);
state.selectedStickerId = sequenceSnapshot.lanes.acid[middleFaceIndex()].id;
let performanceSnapshots = Object.freeze([sequenceSnapshot]);
let auditionCube = null;
let auditionMoveKey = "";
let audioLifecycleGeneration = 0;
let audioStartPromise = null;
let schedulerTimer = null;
let randomTwistTimer = null;
let lastRandomMove = null;
let nextStepTime = 0;
let nextStepIndex = 0;
let nextSwingStep = 0;
let visualTimers = new Set();
let visibilityProfile = Object.freeze({});

const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false });
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let lowPowerCanvas = false;
let pendingCanvasSize = null;
let scheduledFrame = 0;
let orbitSnapshotDirty = false;
let cameraMatrix = rubixEulerMatrix(state.camera);
let matrixCameraX = Number.NaN;
let matrixCameraY = Number.NaN;
let matrixCameraZ = Number.NaN;
let hitRegions = [];
let pointerGesture = null;
let previewTurn = null;
let turnAnimation = null;
let turnQueue = [];
let moveHistory = [];

function middleFaceIndex(size = state.cube.size) {
  const middle = Math.floor(size / 2);
  return middle * size + middle;
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function selectedSticker() {
  return state.cube.stickers.find(({ id }) => id === state.selectedStickerId) ?? null;
}

function roleForFace(face) {
  const snapshot = performanceSnapshots.at(-1) ?? sequenceSnapshot;
  if (snapshot.faceNames.acid === face) return "acid";
  if (snapshot.faceNames.drumLeft === face) return "drumLeft";
  if (snapshot.faceNames.drumRight === face) return "drumRight";
  return null;
}

function faceCenterColor(face) {
  const lane = sequenceSnapshot.lanes[
    sequenceSnapshot.faceNames.acid === face
      ? "acid"
      : sequenceSnapshot.faceNames.drumLeft === face
        ? "drumLeft"
        : "drumRight"
  ];
  return lane?.[middleFaceIndex()]?.color ?? RUBIX_FACE_DEFINITIONS[face]?.color ?? "white";
}

function currentReadConfig() {
  return RUBIX_READ_MODES[state.readingMode] ?? RUBIX_READ_MODES.parallel;
}

function currentGeometry() {
  return GEOMETRIES[state.geometryId] ?? GEOMETRIES[DEFAULT_GEOMETRY_ID];
}

function currentPercEngine() {
  return PERC_ENGINES[state.percEngine] ?? PERC_ENGINES["soft-fm"];
}

function markPresetCustom() {
  state.presetId = "";
  $("rubixPreset").value = "";
  $("rubixPresetState").textContent = "Custom";
}

function currentReadFrame(step = state.currentStep) {
  const cellCount = sequenceSnapshot?.lanes?.acid?.length ?? state.cube.size * state.cube.size;
  return rubixReadFrame(state.readingMode, step, cellCount);
}

function currentReadLengthLabel(frame = currentReadFrame(), config = currentReadConfig()) {
  return config.subdivisionsPerBeat > 1
    ? `${frame.stepCount} subdivisions · ${frame.stepCount / config.subdivisionsPerBeat} beats`
    : `${frame.stepCount}-step loop`;
}

function stickerVisibility(sticker) {
  return rubixStickerVisibility(visibilityProfile, sticker);
}

function stickerDynamicsGain(sticker) {
  return rubixVisibilityGain(stickerVisibility(sticker), state.visibilityDynamics);
}

function performanceSnapshotKey(snapshot) {
  return [
    snapshot.faceNames.acid,
    snapshot.faceNames.drumLeft,
    snapshot.faceNames.drumRight,
    ...snapshot.stickerIds,
  ].join("|");
}

function setPerformanceSnapshots(snapshots, { render = true } = {}) {
  const unique = new Map();
  for (const snapshot of snapshots) unique.set(performanceSnapshotKey(snapshot), snapshot);
  performanceSnapshots = Object.freeze([...unique.values()]);
  if (render) requestDraw();
}

function restorePerformanceSnapshot() {
  auditionCube = null;
  auditionMoveKey = "";
  setPerformanceSnapshots([sequenceSnapshot]);
}

function auditionTurn(move) {
  const moveKey = `${move.axis}:${move.layer}:${move.direction}`;
  if (auditionCube && auditionMoveKey === moveKey) return;
  auditionCube = turnRubixLayer(state.cube, move);
  auditionMoveKey = moveKey;
  const destination = createRubixSequenceSnapshot(auditionCube, state.camera);
  setPerformanceSnapshots([sequenceSnapshot, destination]);
}

function refreshOrbitPerformanceSnapshot() {
  orbitSnapshotDirty = true;
  requestDraw();
}

function flushOrbitPerformanceSnapshot() {
  if (!orbitSnapshotDirty) return;
  orbitSnapshotDirty = false;
  auditionCube = null;
  auditionMoveKey = "";
  setPerformanceSnapshots([
    createRubixSequenceSnapshot(state.cube, state.camera),
  ], { render: false });
}

function performanceEventsForRole(role, frame = currentReadFrame()) {
  const valueKey = ROLE_AUDIO_VALUE[role];
  if (!valueKey) return [];
  const bySticker = new Map();
  for (const snapshot of performanceSnapshots) {
    const sticker = snapshot.lanes[role]?.[frame.cellIndex];
    const value = snapshot.audio[valueKey]?.[frame.cellIndex];
    if (!sticker || !Number.isFinite(value)) continue;
    const event = {
      sticker,
      value,
      gain: stickerDynamicsGain(sticker),
      snapshot,
    };
    const existing = bySticker.get(sticker.id);
    if (!existing || event.gain > existing.gain) bySticker.set(sticker.id, event);
  }
  return [...bySticker.values()].sort((first, second) => second.gain - first.gain);
}

function audibleStickerIds(frame = currentReadFrame()) {
  const activeRoles = new Set(frame.activeRoles);
  const ids = new Set();
  for (const role of Object.keys(ROLE_AUDIO_VALUE)) {
    if (!activeRoles.has(role)) continue;
    for (const event of performanceEventsForRole(role, frame)) {
      if (event.gain > 0) ids.add(event.sticker.id);
    }
  }
  return ids;
}

function currentReadModeDescription() {
  const config = currentReadConfig();
  if (config.id !== "face") return READ_MODE_DESCRIPTIONS[config.id];
  const frame = currentReadFrame();
  const beatCount = frame.stepCount / config.subdivisionsPerBeat;
  return `Each of ${beatCount} snake beats is divided into upper acid, left drum, then right drum: ${frame.stepCount} alternating face subdivisions. Hidden stickers are silent.`;
}

function renderStepStrip() {
  const config = currentReadConfig();
  const currentFrame = currentReadFrame();
  const cellCount = sequenceSnapshot.lanes.acid.length;
  const strip = $("stepStrip");
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < currentFrame.stepCount; index += 1) {
    const cell = document.createElement("span");
    cell.className = `rubix-step${index === currentFrame.transportStep ? " is-active" : ""}`;
    cell.dataset.step = String(index);
    if (config.roleMode !== "all") {
      cell.dataset.laneRole = rubixReadFrame(
        state.readingMode,
        index,
        cellCount,
      ).activeRoles[0];
    }
    cell.textContent = String(index + 1).padStart(2, "0");
    cell.title = `Step ${index + 1} of ${currentFrame.stepCount}`;
    cell.setAttribute("aria-hidden", "true");
    fragment.append(cell);
  }
  strip.dataset.stepCount = String(currentFrame.stepCount);
  strip.classList.toggle("is-dense", currentFrame.stepCount > 27);
  strip.style.gridTemplateColumns = `repeat(${currentFrame.stepCount}, minmax(0, 1fr))`;
  strip.setAttribute("aria-label", `${config.label}, ${currentReadLengthLabel(currentFrame, config)} playhead`);
  strip.replaceChildren(fragment);
}

function renderColorKey() {
  const fragment = document.createDocumentFragment();
  for (const color of RUBIX_COLOR_ORDER) {
    const leftVoice = voices[RUBIX_DRUM_LEFT_VOICE_BY_COLOR[color]];
    const rightVoice = voices[RUBIX_DRUM_RIGHT_VOICE_BY_COLOR[color]];
    const item = document.createElement("span");
    item.style.setProperty("--key-color", COLOR_HEX[color]);
    const swatch = document.createElement("i");
    const copy = document.createElement("b");
    copy.textContent = `${color} · ${midiLabel(RUBIX_ACID_MIDI_BY_COLOR[color] + 12)} · ${leftVoice.name} / ${rightVoice.name}`;
    item.append(swatch, copy);
    fragment.append(item);
  }
  $("colorKey").replaceChildren(fragment);
}

function renderLaneList() {
  const frame = currentReadFrame();
  const lanes = [
    ["acid", sequenceSnapshot.lanes.acid, sequenceSnapshot.faceNames.acid],
    ["drumLeft", sequenceSnapshot.lanes.drumLeft, sequenceSnapshot.faceNames.drumLeft],
    ["drumRight", sequenceSnapshot.lanes.drumRight, sequenceSnapshot.faceNames.drumRight],
  ];
  const fragment = document.createDocumentFragment();
  for (const [role, stickers, face] of lanes) {
    const meta = ROLE_META[role];
    const card = document.createElement("article");
    const isReading = frame.activeRoles.includes(role);
    card.className = `rubix-lane-card${isReading ? " is-reading" : ""}`;
    card.dataset.laneRole = role;
    card.style.setProperty("--lane-color", meta.color);
    const copy = document.createElement("div");
    copy.className = "rubix-lane-copy";
    const label = document.createElement("b");
    const identity = document.createElement("span");
    const detail = document.createElement("small");
    label.textContent = meta.label;
    identity.textContent = `${FACE_SHORT[face]} face · ${faceCenterColor(face)}`;
    detail.textContent = meta.detail;
    copy.append(label, identity, detail);
    const miniFace = document.createElement("div");
    miniFace.className = "rubix-mini-face";
    miniFace.classList.toggle("is-dense", state.cube.size > 3);
    miniFace.style.gridTemplateColumns = `repeat(${state.cube.size}, 1fr)`;
    miniFace.style.gridTemplateRows = `repeat(${state.cube.size}, 1fr)`;
    miniFace.setAttribute("aria-hidden", "true");
    for (const [index, sticker] of stickers.entries()) {
      const tile = document.createElement("i");
      tile.className = `rubix-mini-sticker${isReading && index === frame.cellIndex ? " is-active" : ""}`;
      tile.dataset.stickerId = sticker.id;
      tile.style.setProperty("--sticker-color", COLOR_HEX[sticker.color]);
      miniFace.append(tile);
    }
    card.append(copy, miniFace);
    fragment.append(card);
  }
  $("laneList").replaceChildren(fragment);
}

function renderFaceBadges() {
  const entries = [
    ["acid", sequenceSnapshot.faceNames.acid],
    ["drumLeft", sequenceSnapshot.faceNames.drumLeft],
    ["drumRight", sequenceSnapshot.faceNames.drumRight],
  ];
  const fragment = document.createDocumentFragment();
  for (const [role, face] of entries) {
    const badge = document.createElement("span");
    badge.className = "rubix-face-badge";
    badge.style.setProperty("--face-color", ROLE_META[role].color);
    const name = document.createElement("b");
    const detail = document.createElement("small");
    name.textContent = `${ROLE_META[role].label} · ${FACE_SHORT[face]}`;
    detail.textContent = face;
    badge.append(name, detail);
    fragment.append(badge);
  }
  $("faceBadges").replaceChildren(fragment);
}

function updateSelectedUi() {
  const sticker = selectedSticker();
  const buttons = [$("moveUp"), $("moveDown"), $("moveLeft"), $("moveRight")];
  for (const button of buttons) button.disabled = !sticker || Boolean(turnAnimation || turnQueue.length);
  if (!sticker) {
    $("selectedSticker").textContent = "tap a tile";
    $("selectedSwatch").style.background = "var(--panel-high)";
    $("selectedSwatch").style.boxShadow = "none";
    $("moveSummary").textContent = state.randomTwists
      ? `random · ${Math.round(state.randomTwistTempo)} TPM`
      : "manual · no selection";
    return;
  }
  const face = rubixFaceForNormal(sticker.normal);
  $("selectedSticker").textContent = `${sticker.color} · ${FACE_SHORT[face]} face · ${sticker.id.replaceAll(":", " / ")}`;
  $("selectedSwatch").style.background = COLOR_HEX[sticker.color];
  $("selectedSwatch").style.borderColor = COLOR_HEX[sticker.color];
  $("selectedSwatch").style.boxShadow = `0 0 10px ${COLOR_HEX[sticker.color]}66`;
  $("moveSummary").textContent = state.randomTwists
    ? `random · ${Math.round(state.randomTwistTempo)} TPM`
    : `${FACE_SHORT[face]} ${sticker.color} selected`;
}

function updateReadouts() {
  const readConfig = currentReadConfig();
  const readFrame = currentReadFrame();
  const geometry = currentGeometry();
  const percEngine = currentPercEngine();
  const preset = RUBIX_PRESETS[state.presetId];
  $("tempo").value = String(state.tempo);
  $("tempoOut").textContent = `${Math.round(state.tempo)} BPM`;
  $("swing").value = String(state.swing);
  $("swingOut").textContent = `${Math.round(state.swing * 100)}%`;
  $("visibilityDynamics").value = String(state.visibilityDynamics);
  $("visibilityDynamicsOut").textContent = `${Math.round(state.visibilityDynamics * 100)}%`;
  $("cutoff").value = String(state.cutoff);
  $("cutoffOut").textContent = `${Math.round(state.cutoff)} Hz`;
  $("resonance").value = String(state.resonance);
  $("resonanceOut").textContent = state.resonance.toFixed(1);
  $("acidDecay").value = String(state.acidDecay);
  $("acidDecayOut").textContent = `${Math.round(state.acidDecay * 1000)} ms`;
  $("drive").value = String(state.drive);
  $("driveOut").textContent = `${state.drive.toFixed(1)}×`;
  $("acidLevel").value = String(state.acidLevel);
  $("acidLevelOut").textContent = `${Math.round(state.acidLevel * 100)}%`;
  $("drumLevel").value = String(state.drumLevel);
  $("drumLevelOut").textContent = `${Math.round(state.drumLevel * 100)}%`;
  $("output").value = String(state.output);
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  $("clockSummary").textContent = `${Math.round(state.tempo)} BPM · ${readConfig.label.toLowerCase()}`;
  $("readModeState").textContent = `${readConfig.label.toLowerCase()} · ${currentReadLengthLabel(readFrame, readConfig)}`;
  $("geometry").value = geometry.id;
  $("geometryState").textContent = geometry.label;
  $("percEngine").value = percEngine.id;
  $("percEngineState").textContent = percEngine.label;
  $("randomTwistTempo").value = String(state.randomTwistTempo);
  $("randomTwistTempoOut").textContent = `${Math.round(state.randomTwistTempo)} TPM`;
  $("randomTwists").setAttribute("aria-pressed", String(state.randomTwists));
  $("randomTwistState").textContent = state.randomTwists
    ? `on · ${Math.round(state.randomTwistTempo)} turns/min`
    : "off · manual moves only";
  $("rubixPreset").value = preset?.id ?? "";
  $("rubixPresetState").textContent = preset?.label ?? "Custom";
  $("acidSummary").textContent = `${Math.round(state.cutoff)} Hz · res ${state.resonance.toFixed(1)}`;
  $("drumSummary").textContent = `${percEngine.label} · ${Math.round(state.drumLevel * 100)}%`;
}

function syncReadingModeControls() {
  for (const button of document.querySelectorAll("[data-read-mode]")) {
    const mode = button.dataset.readMode;
    const config = RUBIX_READ_MODES[mode] ?? RUBIX_READ_MODES.parallel;
    const frame = rubixReadFrame(mode, 0, sequenceSnapshot.lanes.acid.length);
    button.setAttribute("aria-pressed", String(mode === state.readingMode));
    const detail = button.querySelector("small");
    if (detail) {
      detail.textContent = mode === "parallel"
        ? `default · all 3 · ${frame.stepCount} steps`
        : mode === "snake"
          ? `all 3 faces · ${frame.stepCount} steps`
          : `A → B → C · ${frame.stepCount} subdivisions`;
    }
    button.title = mode === "face"
      ? `${config.label}: ${frame.stepCount} subdivisions across ${frame.stepCount / config.subdivisionsPerBeat} beats`
      : `${config.label}: ${frame.stepCount} steps`;
  }
}

function setReadingMode(mode, shouldAnnounce = true) {
  const config = RUBIX_READ_MODES[mode] ?? RUBIX_READ_MODES.parallel;
  const changed = state.readingMode !== config.id;
  state.readingMode = config.id;
  if (changed) {
    state.currentStep = 0;
    nextStepIndex = 0;
    nextSwingStep = 0;
  }
  syncReadingModeControls();
  renderStepStrip();
  updateReadouts();
  updateSnapshot();
  $("scoreDescription").textContent = currentReadModeDescription();
  $("playState").textContent = state.playing
    ? `${Math.round(state.tempo)} BPM · running`
    : currentReadLengthLabel();

  if (state.playing && changed && audio.context) {
    if (schedulerTimer !== null) clearTimeout(schedulerTimer);
    schedulerTimer = null;
    clearVisualTimers();
    nextStepTime = audio.context.currentTime + LOOKAHEAD_SECONDS + 0.025;
    schedulerTick();
  }
  if (shouldAnnounce) {
    const frame = currentReadFrame();
    announce(config.roleMode === "all"
      ? `${config.label} read path selected. ${frame.stepCount} steps; all three faces together.`
      : `${config.label} read path selected. ${frame.stepCount} subdivisions across ${frame.stepCount / config.subdivisionsPerBeat} beats; acid, Drum A, and Drum B alternate inside every beat.`);
  }
}

function updateCanvasAriaLabel() {
  canvas.setAttribute(
    "aria-label",
    `Interactive ${currentGeometry().label} sequencer. Audio ${state.audioOn ? "on" : "off"}. Drag a sticker to twist it; drag empty space to orbit. Random twists ${state.randomTwists ? "on" : "off"}.`,
  );
}

function updateSnapshot({ announceChange = false } = {}) {
  const previousFaces = sequenceSnapshot.faceNames;
  const readConfig = currentReadConfig();
  sequenceSnapshot = createRubixSequenceSnapshot(state.cube, state.camera);
  auditionCube = null;
  auditionMoveKey = "";
  orbitSnapshotDirty = false;
  performanceSnapshots = Object.freeze([sequenceSnapshot]);
  const readFrame = currentReadFrame();
  renderLaneList();
  renderFaceBadges();
  updatePlayhead(state.currentStep);
  const visibleLabel = [
    sequenceSnapshot.faceNames.acid,
    sequenceSnapshot.faceNames.drumLeft,
    sequenceSnapshot.faceNames.drumRight,
  ].map((face) => FACE_SHORT[face]).join(" / ");
  $("scoreSummary").textContent = `${FACE_SHORT[sequenceSnapshot.faceNames.acid]} acid · ${FACE_SHORT[sequenceSnapshot.faceNames.drumLeft]} + ${FACE_SHORT[sequenceSnapshot.faceNames.drumRight]} drums`;
  $("sequenceState").textContent = `${sequenceSnapshot.stickerIds.length} visible stickers · ${readConfig.label} · ${currentReadLengthLabel(readFrame, readConfig)} · ${visibleLabel}`;
  if (
    announceChange
    && JSON.stringify(previousFaces) !== JSON.stringify(sequenceSnapshot.faceNames)
  ) {
    announce(`Visible score changed. ${sequenceSnapshot.faceNames.acid} face now plays acid; ${sequenceSnapshot.faceNames.drumLeft} and ${sequenceSnapshot.faceNames.drumRight} play drums.`);
  }
  requestDraw();
}

function updateNowPlaying(frame = currentReadFrame()) {
  const liveSnapshot = performanceSnapshots.at(-1) ?? sequenceSnapshot;
  const acidEvent = performanceEventsForRole("acid", frame)[0];
  const leftEvent = performanceEventsForRole("drumLeft", frame)[0];
  const rightEvent = performanceEventsForRole("drumRight", frame)[0];
  const activeRoles = new Set(frame.activeRoles);
  const acidText = activeRoles.has("acid")
    ? acidEvent?.gain > 0
      ? `ACID · ${acidEvent.sticker.color.toUpperCase()} · ${midiLabel(acidEvent.value + 12)} · ${Math.round(acidEvent.gain * 100)}%`
      : "ACID · SILENT · HIDDEN"
    : `ACID · REST · ${FACE_SHORT[liveSnapshot.faceNames.acid]} WAITING`;
  if ($("acidNow").textContent !== acidText) $("acidNow").textContent = acidText;
  const drumNames = [];
  if (activeRoles.has("drumLeft")) {
    const voice = voices[leftEvent?.value];
    drumNames.push(leftEvent?.gain > 0 && voice
      ? `${voice.name.toUpperCase()} ${Math.round(leftEvent.gain * 100)}%`
      : "A SILENT");
  }
  if (activeRoles.has("drumRight")) {
    const voice = voices[rightEvent?.value];
    drumNames.push(rightEvent?.gain > 0 && voice
      ? `${voice.name.toUpperCase()} ${Math.round(rightEvent.gain * 100)}%`
      : "B SILENT");
  }
  const drumText = drumNames.length ? `DRUMS · ${drumNames.join(" + ")}` : "DRUMS · REST";
  if ($("drumNow").textContent !== drumText) $("drumNow").textContent = drumText;
}

function setAudibleStickerIds(ids) {
  const value = [...ids].join("|");
  if (canvas.dataset.audibleStickerIds !== value) canvas.dataset.audibleStickerIds = value;
}

function updatePlayhead(step) {
  const frame = currentReadFrame(step);
  state.currentStep = frame.transportStep;
  for (const item of $("stepStrip").querySelectorAll(".rubix-step")) {
    item.classList.toggle("is-active", Number(item.dataset.step) === state.currentStep);
  }
  for (const card of $("laneList").querySelectorAll(".rubix-lane-card")) {
    const isReading = frame.activeRoles.includes(card.dataset.laneRole);
    card.classList.toggle("is-reading", isReading);
    for (const [index, sticker] of [...card.querySelectorAll(".rubix-mini-sticker")].entries()) {
      sticker.classList.toggle("is-active", isReading && index === frame.cellIndex);
    }
  }
  updateNowPlaying(frame);
  const audibleIds = audibleStickerIds(frame);
  setAudibleStickerIds(audibleIds);
  const liveSnapshot = performanceSnapshots.at(-1) ?? sequenceSnapshot;
  const visibleLabel = [
    liveSnapshot.faceNames.acid,
    liveSnapshot.faceNames.drumLeft,
    liveSnapshot.faceNames.drumRight,
  ].map((face) => FACE_SHORT[face]).join(" / ");
  $("stageReadout").textContent = `VISIBLE ${visibleLabel} · STEP ${state.currentStep + 1}/${frame.stepCount} · AUDIO ${state.audioOn ? "ON" : "OFF"}`;
  requestDraw();
}

function currentTurnTransform() {
  if (turnAnimation) {
    return {
      axis: turnAnimation.axis,
      layer: turnAnimation.layer,
      angle: turnAnimation.angle,
    };
  }
  return previewTurn;
}

function stickerParticipates(sticker, turn) {
  return Boolean(
    turn
    && sticker.position[turn.axis] === turn.layer
    && !(turn.layer === 0 && sticker.isCenter)
  );
}

function transformedVector(source, sticker, turn) {
  return stickerParticipates(sticker, turn)
    ? rotateAroundAxis(source, turn.axis, turn.angle)
    : source;
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  const nextCssWidth = Math.max(1, Math.round(bounds.width));
  const nextCssHeight = Math.max(1, Math.round(bounds.height));
  const deviceRatio = Math.max(1, Number(devicePixelRatio) || 1);
  const mobileCanvas = nextCssWidth <= 960 || matchMedia("(pointer: coarse)").matches;
  const pixelBudget = mobileCanvas ? 1_000_000 : 1_750_000;
  const ratioCap = mobileCanvas ? 2 : deviceRatio;
  const pixelBudgetRatio = Math.sqrt(pixelBudget / Math.max(1, nextCssWidth * nextCssHeight));
  const nextPixelRatio = Math.min(deviceRatio, ratioCap, Math.max(1, pixelBudgetRatio));
  const width = Math.max(1, Math.round(nextCssWidth * nextPixelRatio));
  const height = Math.max(1, Math.round(nextCssHeight * nextPixelRatio));
  const matchesCurrent = pendingCanvasSize === null
    && nextCssWidth === cssWidth
    && nextCssHeight === cssHeight
    && Math.abs(nextPixelRatio - pixelRatio) < 0.001
    && mobileCanvas === lowPowerCanvas
    && canvas.width === width
    && canvas.height === height;
  if (matchesCurrent) return;
  if (
    pendingCanvasSize
    && pendingCanvasSize.cssWidth === nextCssWidth
    && pendingCanvasSize.cssHeight === nextCssHeight
    && pendingCanvasSize.lowPowerCanvas === mobileCanvas
    && Math.abs(pendingCanvasSize.pixelRatio - nextPixelRatio) < 0.001
    && pendingCanvasSize.width === width
    && pendingCanvasSize.height === height
  ) return;
  pendingCanvasSize = {
    cssWidth: nextCssWidth,
    cssHeight: nextCssHeight,
    pixelRatio: nextPixelRatio,
    lowPowerCanvas: mobileCanvas,
    width,
    height,
  };
  requestDraw();
}

function applyPendingCanvasSize() {
  if (!pendingCanvasSize) return;
  const next = pendingCanvasSize;
  pendingCanvasSize = null;
  cssWidth = next.cssWidth;
  cssHeight = next.cssHeight;
  pixelRatio = next.pixelRatio;
  lowPowerCanvas = next.lowPowerCanvas;
  if (canvas.width !== next.width) canvas.width = next.width;
  if (canvas.height !== next.height) canvas.height = next.height;
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function rotateViewVector(source) {
  const cameraX = Number(state.camera.x) || 0;
  const cameraY = Number(state.camera.y) || 0;
  const cameraZ = Number(state.camera.z) || 0;
  if (
    cameraX !== matrixCameraX
    || cameraY !== matrixCameraY
    || cameraZ !== matrixCameraZ
  ) {
    matrixCameraX = cameraX;
    matrixCameraY = cameraY;
    matrixCameraZ = cameraZ;
    cameraMatrix = rubixEulerMatrix(state.camera);
  }
  const x = Number(source?.x) || 0;
  const y = Number(source?.y) || 0;
  const z = Number(source?.z) || 0;
  return {
    x: cameraMatrix[0][0] * x + cameraMatrix[0][1] * y + cameraMatrix[0][2] * z,
    y: cameraMatrix[1][0] * x + cameraMatrix[1][1] * y + cameraMatrix[1][2] * z,
    z: cameraMatrix[2][0] * x + cameraMatrix[2][1] * y + cameraMatrix[2][2] * z,
  };
}

function projectWorld(source) {
  const normalizedSource = scale(source, 3 / Math.max(1, state.cube.size));
  const rotated = rotateViewVector(normalizedSource);
  const cameraDistance = 7.4;
  const perspective = cameraDistance / Math.max(3.2, cameraDistance - rotated.z);
  const unit = Math.min(cssWidth, cssHeight) * (cssWidth < 560 ? 0.18 : 0.155);
  return {
    x: cssWidth * 0.5 + rotated.x * unit * perspective,
    y: cssHeight * 0.525 - rotated.y * unit * perspective,
    depth: rotated.z,
    perspective,
  };
}

function warpRubixSurfacePoint(source, outward, lift = 0) {
  const geometry = currentGeometry();
  if (geometry.surface === "cube") return add(source, scale(outward, lift));
  const radiusScale = geometry.surface === "pyramid" ? 0.9 : 0.58;
  const radius = state.cube.size * radiusScale + lift;
  if (geometry.surface === "sphere") return scale(normalize(source), radius);
  const taxicabLength = Math.max(1e-9, Math.abs(source.x) + Math.abs(source.y) + Math.abs(source.z));
  return scale(source, radius / taxicabLength);
}

function polygonPath(points) {
  drawing.beginPath();
  drawing.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) drawing.lineTo(points[index].x, points[index].y);
  drawing.closePath();
}

function polygonContains(points, x, y) {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const first = points[current];
    const second = points[previous];
    const crosses = (first.y > y) !== (second.y > y)
      && x < (second.x - first.x) * (y - first.y) / (second.y - first.y || 1e-9) + first.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function stickerGeometry(sticker, turn) {
  const face = rubixFaceForNormal(sticker.normal);
  const definition = RUBIX_FACE_DEFINITIONS[face];
  const normal = transformedVector(sticker.normal, sticker, turn);
  const right = transformedVector(definition.right, sticker, turn);
  const down = transformedVector(definition.down, sticker, turn);
  const faceCenter = transformedVector(add(sticker.position, scale(sticker.normal, 0.5)), sticker, turn);
  const viewNormal = rotateViewVector(normal);
  if (viewNormal.z <= 0.012) return null;

  const makeQuad = (half, lift = 0) => {
    return [
      add(add(faceCenter, scale(right, -half)), scale(down, -half)),
      add(add(faceCenter, scale(right, half)), scale(down, -half)),
      add(add(faceCenter, scale(right, half)), scale(down, half)),
      add(add(faceCenter, scale(right, -half)), scale(down, half)),
    ].map((point) => projectWorld(warpRubixSurfacePoint(point, normal, lift)));
  };
  const center = warpRubixSurfacePoint(faceCenter, normal, 0.015);
  const projectedCenter = projectWorld(center);
  return {
    sticker,
    face,
    normal,
    right,
    down,
    center,
    projectedCenter,
    depth: projectedCenter.depth,
    basePoints: makeQuad(0.485, 0.015),
    stickerPoints: makeQuad(0.405, 0.033),
  };
}

function drawBackdrop() {
  drawing.fillStyle = "#050608";
  drawing.fillRect(0, 0, cssWidth, cssHeight);
  const glow = drawing.createRadialGradient(
    cssWidth * 0.5,
    cssHeight * 0.52,
    0,
    cssWidth * 0.5,
    cssHeight * 0.52,
    Math.min(cssWidth, cssHeight) * 0.55,
  );
  glow.addColorStop(0, "rgba(157, 255, 87, 0.07)");
  glow.addColorStop(0.42, "rgba(69, 140, 255, 0.025)");
  glow.addColorStop(1, "rgba(5, 6, 8, 0)");
  drawing.fillStyle = glow;
  drawing.fillRect(0, 0, cssWidth, cssHeight);

  drawing.save();
  drawing.strokeStyle = "rgba(157, 255, 87, 0.024)";
  drawing.lineWidth = 1;
  const spacing = 36;
  for (let x = (cssWidth % spacing) / 2; x < cssWidth; x += spacing) {
    drawing.beginPath();
    drawing.moveTo(x, 0);
    drawing.lineTo(x, cssHeight);
    drawing.stroke();
  }
  for (let y = (cssHeight % spacing) / 2; y < cssHeight; y += spacing) {
    drawing.beginPath();
    drawing.moveTo(0, y);
    drawing.lineTo(cssWidth, y);
    drawing.stroke();
  }
  drawing.restore();

  const shadow = drawing.createRadialGradient(
    cssWidth * 0.5,
    cssHeight * 0.78,
    0,
    cssWidth * 0.5,
    cssHeight * 0.78,
    Math.min(cssWidth, cssHeight) * 0.32,
  );
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.6)");
  shadow.addColorStop(0.55, "rgba(98, 219, 255, 0.045)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  drawing.save();
  drawing.scale(1, 0.25);
  drawing.fillStyle = shadow;
  drawing.fillRect(0, cssHeight * 2.5, cssWidth, cssHeight * 1.25);
  drawing.restore();
}

function drawSticker(geometry, audibleIds) {
  const { sticker, basePoints, stickerPoints, projectedCenter, face } = geometry;
  polygonPath(basePoints);
  drawing.fillStyle = "#030405";
  drawing.strokeStyle = "rgba(226, 241, 233, 0.15)";
  drawing.lineWidth = 1;
  drawing.fill();
  drawing.stroke();

  const bounds = stickerPoints.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x),
    maxX: Math.max(result.maxX, point.x),
    minY: Math.min(result.minY, point.y),
    maxY: Math.max(result.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const fill = drawing.createLinearGradient(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  fill.addColorStop(0, shadeHex(COLOR_HEX[sticker.color], 0.14));
  fill.addColorStop(0.55, COLOR_HEX[sticker.color]);
  fill.addColorStop(1, shadeHex(COLOR_HEX[sticker.color], -0.22));

  const audible = audibleIds.has(sticker.id) && state.playing;
  const audibleGain = stickerDynamicsGain(sticker);
  const selected = sticker.id === state.selectedStickerId;
  drawing.save();
  if (audible && !lowPowerCanvas) {
    drawing.shadowColor = COLOR_HEX[sticker.color];
    drawing.shadowBlur = 5 + audibleGain * 22;
  }
  polygonPath(stickerPoints);
  drawing.fillStyle = fill;
  drawing.fill();
  drawing.shadowBlur = 0;
  const role = roleForFace(face);
  drawing.strokeStyle = audible
    ? "rgba(255, 255, 255, 0.96)"
    : selected
      ? "rgba(255, 255, 255, 0.82)"
      : role
        ? `${ROLE_META[role].color}88`
        : "rgba(0, 0, 0, 0.52)";
  drawing.lineWidth = audible ? (lowPowerCanvas ? 1.6 : 2.2) : selected ? 1.8 : 0.8;
  drawing.stroke();

  if (currentGeometry().surface === "pyramid") {
    const diagonal = (sticker.homeRow + sticker.homeColumn) % 2 === 0
      ? [stickerPoints[0], stickerPoints[2]]
      : [stickerPoints[1], stickerPoints[3]];
    drawing.beginPath();
    drawing.moveTo(diagonal[0].x, diagonal[0].y);
    drawing.lineTo(diagonal[1].x, diagonal[1].y);
    drawing.strokeStyle = "rgba(4, 8, 9, 0.42)";
    drawing.lineWidth = 1;
    drawing.stroke();
  }

  if (selected) {
    const inset = stickerPoints.map((point) => ({
      x: projectedCenter.x + (point.x - projectedCenter.x) * 0.78,
      y: projectedCenter.y + (point.y - projectedCenter.y) * 0.78,
    }));
    polygonPath(inset);
    drawing.strokeStyle = "rgba(255, 255, 255, 0.78)";
    drawing.lineWidth = 0.8;
    drawing.setLineDash([3, 3]);
    drawing.stroke();
  }

  if (audible) {
    drawing.setLineDash([]);
    drawing.fillStyle = COLOR_INK[sticker.color];
    drawing.font = `700 ${Math.max(8, Math.min(12, cssHeight * 0.018))}px ui-monospace, monospace`;
    drawing.textAlign = "center";
    drawing.textBaseline = "middle";
    drawing.fillText(String(state.currentStep + 1), projectedCenter.x, projectedCenter.y);
  }
  drawing.restore();
}

function drawCube() {
  const turn = currentTurnTransform();
  const geometry = state.cube.stickers
    .map((sticker) => stickerGeometry(sticker, turn))
    .filter(Boolean)
    .sort((first, second) => first.depth - second.depth);
  visibilityProfile = createRubixVisibilityProfile(geometry);
  updateNowPlaying();
  const audibleIds = audibleStickerIds();
  setAudibleStickerIds(audibleIds);
  hitRegions = [];
  for (const item of geometry) {
    drawSticker(item, audibleIds);
    hitRegions.push(item);
  }
}

function drawFrame(now = performance.now()) {
  scheduledFrame = 0;
  applyPendingCanvasSize();
  flushOrbitPerformanceSnapshot();
  if (turnAnimation) {
    const progress = clamp((now - turnAnimation.startedAt) / turnAnimation.duration, 0, 1);
    const eased = 1 - ((1 - progress) ** 3);
    turnAnimation.angle = turnAnimation.fromAngle
      + (turnAnimation.toAngle - turnAnimation.fromAngle) * eased;
    if (progress >= 1) finishTurnAnimation();
  }
  drawBackdrop();
  drawCube();
  if (turnAnimation) requestDraw();
}

function requestDraw() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(drawFrame);
}

function moveFromSticker(sticker, dimension, directionSign) {
  const face = rubixFaceForNormal(sticker.normal);
  const definition = RUBIX_FACE_DEFINITIONS[face];
  const desired = dimension === "horizontal"
    ? scale(definition.right, directionSign)
    : scale(definition.down, directionSign);
  const rotationAxis = dimension === "horizontal" ? definition.down : definition.right;
  const axis = axisName(rotationAxis);
  const layer = sticker.position[axis];
  const center = add(sticker.position, scale(sticker.normal, 0.5));
  const positiveVelocity = cross(axisVector(axis), center);
  const direction = dot(positiveVelocity, desired) >= 0 ? 1 : -1;
  return { axis, layer, direction };
}

function beginTurn(move, {
  fromAngle = 0,
  duration = 190,
  record = true,
  label = "slice",
} = {}) {
  if (turnAnimation) {
    turnQueue.push({ move, options: { fromAngle, duration, record, label } });
    return;
  }
  previewTurn = null;
  auditionTurn(move);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  turnAnimation = {
    ...move,
    fromAngle,
    toAngle: move.direction * QUARTER_TURN,
    angle: fromAngle,
    duration: reducedMotion ? 1 : Math.max(1, duration),
    startedAt: performance.now(),
    record,
    label,
  };
  updateSelectedUi();
  requestDraw();
}

function finishTurnAnimation() {
  const finished = turnAnimation;
  if (!finished) return;
  state.cube = turnRubixLayer(state.cube, finished);
  if (finished.record) {
    moveHistory.push({ axis: finished.axis, layer: finished.layer, direction: finished.direction });
    if (moveHistory.length > 120) moveHistory.shift();
  }
  turnAnimation = null;
  previewTurn = null;
  $("undoMove").disabled = moveHistory.length === 0;
  updateSnapshot();
  updateSelectedUi();
  if (!turnQueue.length) {
    announce(`${finished.label} turned ${finished.direction > 0 ? "clockwise" : "counter-clockwise"}. Visible score updated.`);
  }
  const next = turnQueue.shift();
  if (next) beginTurn(next.move, next.options);
}

function enqueueScramble() {
  if (turnAnimation || turnQueue.length) return;
  const layers = rubixLayersForSize(state.cube.size);
  const moves = [];
  let previous = null;
  for (let index = 0; index < 18; index += 1) {
    let move;
    do {
      const axis = ["x", "y", "z"][Math.floor(Math.random() * 3)];
      const layer = layers[Math.floor(Math.random() * layers.length)];
      const direction = Math.random() < 0.5 ? -1 : 1;
      move = { axis, layer, direction };
    } while (previous && move.axis === previous.axis && move.layer === previous.layer);
    moves.push(move);
    previous = move;
  }
  moves.forEach((move, index) => beginTurn(move, {
    duration: 82,
    record: true,
    label: index === moves.length - 1 ? "scramble" : "slice",
  }));
  announce("Eighteen-move scramble started.");
}

function nextRandomTwistMove() {
  const layers = rubixLayersForSize(state.cube.size);
  let move;
  do {
    move = {
      axis: ["x", "y", "z"][Math.floor(Math.random() * 3)],
      layer: layers[Math.floor(Math.random() * layers.length)],
      direction: Math.random() < 0.5 ? -1 : 1,
    };
  } while (
    lastRandomMove
    && move.axis === lastRandomMove.axis
    && move.layer === lastRandomMove.layer
  );
  lastRandomMove = move;
  return move;
}

function scheduleRandomTwists() {
  if (!state.randomTwists) return;
  const interval = 60_000 / clamp(state.randomTwistTempo, 6, 90);
  randomTwistTimer = setTimeout(() => {
    randomTwistTimer = null;
    if (
      state.randomTwists
      && !pointerGesture
      && !turnAnimation
      && turnQueue.length === 0
    ) {
      beginTurn(nextRandomTwistMove(), {
        duration: clamp(interval * 0.28, 95, 280),
        record: true,
        label: "random twist",
      });
    }
    scheduleRandomTwists();
  }, interval);
}

function startRandomTwists(shouldAnnounce = true) {
  if (randomTwistTimer !== null) clearTimeout(randomTwistTimer);
  randomTwistTimer = null;
  state.randomTwists = true;
  scheduleRandomTwists();
  updateReadouts();
  updateSelectedUi();
  updateCanvasAriaLabel();
  if (shouldAnnounce) {
    announce(`Random twists on at ${Math.round(state.randomTwistTempo)} turns per minute.`);
  }
}

function stopRandomTwists(shouldAnnounce = false) {
  state.randomTwists = false;
  if (randomTwistTimer !== null) clearTimeout(randomTwistTimer);
  randomTwistTimer = null;
  updateReadouts();
  updateSelectedUi();
  updateCanvasAriaLabel();
  if (shouldAnnounce) announce("Random twists off. Manual cube moves remain active.");
}

function undoLastMove() {
  if (turnAnimation || turnQueue.length || !moveHistory.length) return;
  const move = moveHistory.pop();
  $("undoMove").disabled = moveHistory.length === 0;
  beginTurn({ ...move, direction: -move.direction }, {
    record: false,
    label: "undo",
  });
}

function resetView() {
  state.camera = { ...DEFAULT_RUBIX_CAMERA };
  updateSnapshot({ announceChange: true });
  announce("Cube view reset. White, green, and red faces are visible.");
}

function setGeometry(geometryId, shouldAnnounce = true) {
  const geometry = GEOMETRIES[geometryId] ?? GEOMETRIES[DEFAULT_GEOMETRY_ID];
  const changed = state.geometryId !== geometry.id || state.cube.size !== geometry.size;
  state.geometryId = geometry.id;
  canvas.dataset.geometry = geometry.surface;
  stageWrap.dataset.geometry = geometry.surface;
  $("geometry").value = geometry.id;
  $("geometryState").textContent = geometry.label;
  updateCanvasAriaLabel();
  if (!changed) {
    updateReadouts();
    return;
  }

  turnQueue = [];
  turnAnimation = null;
  previewTurn = null;
  moveHistory = [];
  visibilityProfile = Object.freeze({});
  state.cube = createSolvedRubixCube(geometry.size);
  state.camera = { ...DEFAULT_RUBIX_CAMERA };
  state.currentStep = 0;
  nextStepIndex = 0;
  nextSwingStep = 0;
  updateSnapshot();
  renderStepStrip();
  syncReadingModeControls();
  updateReadouts();
  $("scoreDescription").textContent = currentReadModeDescription();
  $("playState").textContent = state.playing
    ? `${Math.round(state.tempo)} BPM · running`
    : currentReadLengthLabel();
  state.selectedStickerId = sequenceSnapshot.lanes.acid[middleFaceIndex()].id;
  $("undoMove").disabled = true;
  updateSelectedUi();

  if (state.playing && audio.context) {
    if (schedulerTimer !== null) clearTimeout(schedulerTimer);
    schedulerTimer = null;
    clearVisualTimers();
    nextStepTime = audio.context.currentTime + LOOKAHEAD_SECONDS + 0.025;
    schedulerTick();
  }
  if (shouldAnnounce) {
    announce(`${geometry.label} loaded. ${state.cube.size * state.cube.size} stickers per face; ${currentReadConfig().label.toLowerCase()} uses ${currentReadLengthLabel()}.`);
  }
}

function applyRubixPreset(presetId, shouldAnnounce = true) {
  const preset = RUBIX_PRESETS[presetId] ?? RUBIX_PRESETS.classic;
  if (randomTwistTimer !== null) clearTimeout(randomTwistTimer);
  randomTwistTimer = null;
  state.presetId = preset.id;
  Object.assign(state, preset.settings);
  setGeometry(preset.geometryId, false);
  setReadingMode(preset.readingMode, false);
  audio.updateSettings(state);
  audio.setOutput(state.output);
  updateReadouts();
  updateSelectedUi();
  if (state.randomTwists) startRandomTwists(false);
  else stopRandomTwists(false);
  if (shouldAnnounce) {
    announce(`${preset.label} preset. ${currentGeometry().label}, ${currentReadConfig().label}, ${currentPercEngine().label}.`);
  }
}

function solveCube() {
  const randomTwistsWereActive = state.randomTwists;
  if (randomTwistsWereActive) {
    markPresetCustom();
    stopRandomTwists(false);
  }
  turnQueue = [];
  turnAnimation = null;
  previewTurn = null;
  moveHistory = [];
  state.cube = createSolvedRubixCube(currentGeometry().size);
  updateSnapshot();
  state.selectedStickerId = sequenceSnapshot.lanes.acid[middleFaceIndex()].id;
  $("undoMove").disabled = true;
  updateSelectedUi();
  announce(randomTwistsWereActive
    ? "Cube solved and random twists stopped. Sound and view unchanged."
    : "Cube solved. Sound and view unchanged.");
}

function resetSound() {
  Object.assign(state, SOUND_DEFAULTS);
  state.presetId = "";
  audio.updateSettings(state);
  audio.setOutput(state.output);
  setReadingMode(DEFAULT_READING_MODE, false);
  announce("Sound reset. Cube arrangement and view unchanged.");
}

function pointFromEvent(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function hitSticker(point) {
  for (let index = hitRegions.length - 1; index >= 0; index -= 1) {
    if (polygonContains(hitRegions[index].stickerPoints, point.x, point.y)) return hitRegions[index];
  }
  return null;
}

function gestureMoveForDelta(hit, deltaX, deltaY) {
  const face = rubixFaceForNormal(hit.sticker.normal);
  const definition = RUBIX_FACE_DEFINITIONS[face];
  const center = projectWorld(add(hit.sticker.position, scale(hit.sticker.normal, 0.52)));
  const rightPoint = projectWorld(add(add(hit.sticker.position, scale(hit.sticker.normal, 0.52)), definition.right));
  const downPoint = projectWorld(add(add(hit.sticker.position, scale(hit.sticker.normal, 0.52)), definition.down));
  const screenRight = normalize({ x: rightPoint.x - center.x, y: rightPoint.y - center.y, z: 0 });
  const screenDown = normalize({ x: downPoint.x - center.x, y: downPoint.y - center.y, z: 0 });
  const horizontalAmount = deltaX * screenRight.x + deltaY * screenRight.y;
  const verticalAmount = deltaX * screenDown.x + deltaY * screenDown.y;
  const dimension = Math.abs(horizontalAmount) >= Math.abs(verticalAmount) ? "horizontal" : "vertical";
  const amount = dimension === "horizontal" ? horizontalAmount : verticalAmount;
  return {
    move: moveFromSticker(hit.sticker, dimension, amount >= 0 ? 1 : -1),
    amount,
  };
}

canvas.addEventListener("pointerdown", (event) => {
  if (turnAnimation || turnQueue.length) return;
  const point = pointFromEvent(event);
  const hit = hitSticker(point);
  const kind = hit ? "twist" : "orbit";
  if (hit) {
    state.selectedStickerId = hit.sticker.id;
    updateSelectedUi();
    requestDraw();
  }
  pointerGesture = {
    id: event.pointerId,
    kind,
    hit,
    start: point,
    previous: point,
    moved: false,
  };
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerGesture || pointerGesture.id !== event.pointerId) return;
  const point = pointFromEvent(event);
  const totalX = point.x - pointerGesture.start.x;
  const totalY = point.y - pointerGesture.start.y;
  if (Math.hypot(totalX, totalY) > 4) pointerGesture.moved = true;
  if (pointerGesture.kind === "orbit") {
    const deltaX = point.x - pointerGesture.previous.x;
    const deltaY = point.y - pointerGesture.previous.y;
    state.camera.y += deltaX * 0.38;
    state.camera.x = clamp(state.camera.x + deltaY * 0.34, -76, 76);
    if (state.camera.y > 180) state.camera.y -= 360;
    if (state.camera.y < -180) state.camera.y += 360;
    pointerGesture.previous = point;
    refreshOrbitPerformanceSnapshot();
    requestDraw();
    event.preventDefault();
    return;
  }
  if (!pointerGesture.hit || Math.hypot(totalX, totalY) < 6) return;
  const resolved = gestureMoveForDelta(pointerGesture.hit, totalX, totalY);
  const signedAngle = resolved.move.direction * Math.min(
    QUARTER_TURN * 0.82,
    Math.abs(resolved.amount) / Math.max(62, Math.min(cssWidth, cssHeight) * 0.24) * QUARTER_TURN,
  );
  previewTurn = { ...resolved.move, angle: signedAngle };
  pointerGesture.resolved = resolved;
  auditionTurn(resolved.move);
  requestDraw();
  event.preventDefault();
});

function endPointerGesture(event, cancelled = false) {
  if (!pointerGesture || pointerGesture.id !== event.pointerId) return;
  const gesture = pointerGesture;
  pointerGesture = null;
  canvas.classList.remove("is-dragging");
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (gesture.kind === "orbit") {
    updateSnapshot({ announceChange: gesture.moved });
  } else if (!cancelled && gesture.resolved && Math.abs(gesture.resolved.amount) >= 20) {
    beginTurn(gesture.resolved.move, {
      fromAngle: previewTurn?.angle ?? 0,
      label: `${gesture.resolved.move.axis.toUpperCase()} ${gesture.resolved.move.layer > 0 ? "+" : gesture.resolved.move.layer < 0 ? "−" : "middle"} slice`,
    });
  } else {
    previewTurn = null;
    restorePerformanceSnapshot();
    requestDraw();
  }
}

canvas.addEventListener("pointerup", (event) => endPointerGesture(event));
canvas.addEventListener("pointercancel", (event) => endPointerGesture(event, true));
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

function turnSelected(dimension, directionSign) {
  const sticker = selectedSticker();
  if (!sticker || turnAnimation || turnQueue.length) {
    announce("Select a visible sticker before moving a slice.");
    return;
  }
  beginTurn(moveFromSticker(sticker, dimension, directionSign), {
    label: `${dimension === "horizontal" ? "row" : "column"} ${directionSign > 0 ? "forward" : "back"}`,
  });
}

function sixteenthDurationSeconds(step = nextSwingStep) {
  const base = 60 / clamp(state.tempo, TEMPO_MIN_BPM, TEMPO_MAX_BPM) / 4;
  const swingOffset = clamp(state.swing, 0, 0.42);
  return base * (step % 2 === 0 ? 1 + swingOffset : 1 - swingOffset);
}

function scheduleVisualStep(step, when) {
  const delay = Math.max(0, (when - audio.context.currentTime) * 1000);
  const timer = setTimeout(() => {
    visualTimers.delete(timer);
    if (state.playing) updatePlayhead(step);
  }, delay);
  visualTimers.add(timer);
}

function schedulerTick() {
  if (!state.playing || !audio.context) return;
  const now = audio.context.currentTime;
  if (!Number.isFinite(nextStepTime) || nextStepTime < now - 0.05) {
    nextStepTime = now + 0.03;
  }
  const horizon = now + LOOKAHEAD_SECONDS;
  let scheduledSteps = 0;
  while (nextStepTime < horizon && scheduledSteps < 32) {
    const step = nextStepIndex;
    const frame = currentReadFrame(step);
    const subdivisionsPerBeat = currentReadConfig().subdivisionsPerBeat;
    const beatDuration = sixteenthDurationSeconds();
    const stepDuration = beatDuration / subdivisionsPerBeat;
    const activeRoles = new Set(frame.activeRoles);
    const acidEvent = performanceEventsForRole("acid", frame)[0];
    if (activeRoles.has("acid") && acidEvent?.gain > 0) {
      audio.scheduleAcid(
        acidEvent.value,
        acidEvent.sticker,
        nextStepTime,
        beatDuration,
        state,
        acidEvent.gain,
      );
    }
    for (const role of ["drumLeft", "drumRight"]) {
      if (!activeRoles.has(role)) continue;
      const drumEvents = performanceEventsForRole(role, frame)
        .filter(({ gain }) => gain > 0);
      const transitionHeadroom = 1 / Math.sqrt(Math.max(1, drumEvents.length));
      for (const event of drumEvents) {
        audio.scheduleDrum(
          event.value,
          nextStepTime,
          event.gain * transitionHeadroom,
          state.percEngine,
        );
      }
    }
    scheduleVisualStep(frame.transportStep, nextStepTime);
    nextStepTime += stepDuration;
    nextStepIndex = (nextStepIndex + 1) % frame.stepCount;
    if ((frame.transportStep + 1) % subdivisionsPerBeat === 0) nextSwingStep += 1;
    scheduledSteps += 1;
  }
  schedulerTimer = setTimeout(schedulerTick, SCHEDULER_INTERVAL_MS);
}

function clearVisualTimers() {
  for (const timer of visualTimers) clearTimeout(timer);
  visualTimers = new Set();
}

function setAudioState(enabled) {
  state.audioOn = enabled;
  $("audioButton").setAttribute("aria-pressed", String(enabled));
  $("audioState").textContent = enabled ? "on" : "off";
  updateCanvasAriaLabel();
  if (enabled && audio.context) {
    $("engineState").textContent = `Shared Web Audio engine · ${Math.round(audio.context.sampleRate / 1000)} kHz`;
  } else {
    $("engineState").textContent = "Shared Web Audio engine";
  }
  updatePlayhead(state.currentStep);
}

async function enableAudio() {
  if (state.audioOn && audio.context) return true;
  if (audioStartPromise) return audioStartPromise;
  const generation = audioLifecycleGeneration;
  clearError();
  let pending;
  pending = audio.start(state).then((context) => {
    if (generation !== audioLifecycleGeneration || context !== audio.context) return false;
    audio.setOutput(state.output);
    setAudioState(true);
    return true;
  }).catch((error) => {
    if (generation === audioLifecycleGeneration && error?.name !== "AbortError") showError(error);
    return false;
  }).finally(() => {
    if (audioStartPromise === pending) audioStartPromise = null;
  });
  audioStartPromise = pending;
  return pending;
}

async function disableAudio() {
  stopTransport();
  audioLifecycleGeneration += 1;
  audioStartPromise = null;
  setAudioState(false);
  await audio.close().catch(() => {});
}

async function startTransport({ restart = false } = {}) {
  if (state.playing && !restart) return;
  if (!await enableAudio()) return;
  if (schedulerTimer !== null) clearTimeout(schedulerTimer);
  clearVisualTimers();
  state.playing = true;
  nextStepIndex = 0;
  nextSwingStep = 0;
  nextStepTime = audio.context.currentTime + 0.055;
  audio.setTransportActive(true);
  $("playButton").setAttribute("aria-pressed", "true");
  $("playLabel").textContent = "Pause cube";
  $("playState").textContent = `${Math.round(state.tempo)} BPM · running`;
  schedulerTick();
  announce(restart ? "Rubix loop restarted at step one." : "Rubix sequencer playing.");
}

function stopTransport() {
  state.playing = false;
  if (schedulerTimer !== null) clearTimeout(schedulerTimer);
  schedulerTimer = null;
  clearVisualTimers();
  audio.setTransportActive(false);
  $("playButton").setAttribute("aria-pressed", "false");
  $("playLabel").textContent = "Play cube";
  $("playState").textContent = currentReadLengthLabel();
  updatePlayhead(state.currentStep);
}

function bindRange(id, key, format, onInput = () => {}) {
  const input = $(id);
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    markPresetCustom();
    const output = $(`${id}Out`);
    if (output) output.textContent = format(state[key]);
    onInput(state[key]);
    audio.updateSettings(state);
    updateReadouts();
  });
}

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    await disableAudio();
    announce("Rubix audio off.");
  } else if (await enableAudio()) {
    announce("Rubix audio on. Press Play cube to start the visible score.");
  }
});

$("playButton").addEventListener("click", async () => {
  if (state.playing) {
    stopTransport();
    announce("Rubix sequencer paused.");
  } else {
    await startTransport();
  }
});

for (const button of document.querySelectorAll("[data-read-mode]")) {
  button.addEventListener("click", () => {
    markPresetCustom();
    setReadingMode(button.dataset.readMode);
  });
}

$("geometry").addEventListener("change", (event) => {
  markPresetCustom();
  setGeometry(event.currentTarget.value);
});
$("percEngine").addEventListener("change", (event) => {
  state.percEngine = PERC_ENGINES[event.currentTarget.value]?.id ?? "soft-fm";
  markPresetCustom();
  updateReadouts();
  announce(`${currentPercEngine().label} percussion synth selected.`);
});
$("rubixPreset").addEventListener("change", (event) => {
  applyRubixPreset(event.currentTarget.value);
});
$("randomTwists").addEventListener("click", () => {
  markPresetCustom();
  if (state.randomTwists) stopRandomTwists(true);
  else startRandomTwists(true);
});

$("moveLeft").addEventListener("click", () => turnSelected("horizontal", -1));
$("moveRight").addEventListener("click", () => turnSelected("horizontal", 1));
$("moveUp").addEventListener("click", () => turnSelected("vertical", -1));
$("moveDown").addEventListener("click", () => turnSelected("vertical", 1));
$("scrambleCube").addEventListener("click", enqueueScramble);
$("undoMove").addEventListener("click", undoLastMove);
$("resetView").addEventListener("click", resetView);
$("solveCube").addEventListener("click", solveCube);
$("resetSound").addEventListener("click", resetSound);

$("restartLoop").addEventListener("click", async () => {
  if (state.playing) {
    stopTransport();
    await startTransport({ restart: true });
  } else {
    nextStepIndex = 0;
    nextSwingStep = 0;
    updatePlayhead(0);
    announce("Rubix playhead returned to step one.");
  }
});

bindRange("tempo", "tempo", (value) => `${Math.round(value)} BPM`);
bindRange("swing", "swing", (value) => `${Math.round(value * 100)}%`);
bindRange("randomTwistTempo", "randomTwistTempo", (value) => `${Math.round(value)} TPM`, () => {
  if (state.randomTwists) startRandomTwists(false);
  updateSelectedUi();
});
bindRange("visibilityDynamics", "visibilityDynamics", (value) => `${Math.round(value * 100)}%`, () => {
  updateNowPlaying();
  requestDraw();
});
bindRange("cutoff", "cutoff", (value) => `${Math.round(value)} Hz`);
bindRange("resonance", "resonance", (value) => value.toFixed(1));
bindRange("acidDecay", "acidDecay", (value) => `${Math.round(value * 1000)} ms`);
bindRange("drive", "drive", (value) => `${value.toFixed(1)}×`);
bindRange("acidLevel", "acidLevel", (value) => `${Math.round(value * 100)}%`);
bindRange("drumLevel", "drumLevel", (value) => `${Math.round(value * 100)}%`);
bindRange("output", "output", (value) => `${Math.round(value * 100)}%`, (value) => {
  audio.setOutput(value);
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target?.closest?.("input, select, button, a, summary")) return;
  const key = event.key.toLowerCase();
  if (key === " ") {
    event.preventDefault();
    $("playButton").click();
    return;
  }
  if (key === "arrowleft") {
    event.preventDefault();
    turnSelected("horizontal", -1);
  } else if (key === "arrowright") {
    event.preventDefault();
    turnSelected("horizontal", 1);
  } else if (key === "arrowup") {
    event.preventDefault();
    turnSelected("vertical", -1);
  } else if (key === "arrowdown") {
    event.preventDefault();
    turnSelected("vertical", 1);
  }
});

window.addEventListener("pagehide", () => {
  stopRandomTwists(false);
  stopTransport();
  audioLifecycleGeneration += 1;
  audioStartPromise = null;
  setAudioState(false);
  void audio.close().catch(() => {});
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  setAudioState(false);
  updateSnapshot();
});

new ResizeObserver(resizeCanvas).observe(stageWrap);

const requestedGeometryId = new URLSearchParams(location.search).get("geometry");
const initialGeometryId = GEOMETRIES[requestedGeometryId]
  ? requestedGeometryId
  : DEFAULT_GEOMETRY_ID;
if (initialGeometryId !== DEFAULT_GEOMETRY_ID) state.presetId = "";
renderColorKey();
setGeometry(initialGeometryId, false);
setReadingMode(DEFAULT_READING_MODE, false);
updateSelectedUi();
setAudioState(false);
resizeCanvas();
updatePlayhead(0);
