import {
  DEFAULT_FM_DRUM_VOICES,
  FM_DRUM_STORAGE_KEY,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import { unlockAudioContext } from "./src/audio.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import {
  WEBGPU_303_SEQUENCE_LENGTH,
  WebGpu303Audio,
  webGpu303Support,
} from "./src/webgpu-303.js";
import {
  RUBIX_WEBGPU_303_DEFAULTS,
  createRubixWebGpu303Pattern,
} from "./src/rubix-webgpu-303.js";
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
  RUBIX_TWIST_SPEED_DEFAULT_POSITION,
  createRubixSequenceSnapshot,
  createSolvedRubixCube,
  rubixFaceForNormal,
  rubixEulerMatrix,
  rubixLayersForSize,
  rubixReadFrame,
  rubixTwistIntervalMs,
  rubixTwistSpeedMultiplier,
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
const DEFAULT_SHAPE_ID = "cube";
const DEFAULT_RUBIX_SIZE = 3;
const RUBIX_SIZE_MIN = 2;
const RUBIX_SIZE_MAX = 6;
const DEFAULT_ACID_ENGINE = "web-audio";
const DEFAULT_STICKER_MODULATION = 0.68;
const WEBGPU_TIMING_CONTROL_IDS = Object.freeze(new Set(["tempo", "swing"]));

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

const SOUND_BANKS = Object.freeze({
  "soft-fm": Object.freeze({
    id: "soft-fm",
    label: "Soft FM kit",
    detail: "rounded carrier + modulation",
    role: "percussion",
  }),
  analog: Object.freeze({
    id: "analog",
    label: "Analog kit",
    detail: "sine bodies + shaped noise",
    role: "percussion",
  }),
  modal: Object.freeze({
    id: "modal",
    label: "Modal kit",
    detail: "three short damped partials",
    role: "percussion",
  }),
  noise: Object.freeze({
    id: "noise",
    label: "Noise kit",
    detail: "filtered bursts + quiet body",
    role: "percussion",
  }),
  "acid-303": Object.freeze({
    id: "acid-303",
    label: "303 acid",
    detail: "upper-face resonant sequence",
    role: "acid",
  }),
});
const PERCUSSION_SOUND_BANK_IDS = Object.freeze(
  Object.keys(SOUND_BANKS).filter((id) => SOUND_BANKS[id].role === "percussion"),
);

const READ_MODE_DESCRIPTIONS = Object.freeze({
  parallel: "All three visible faces read left-to-right, top-to-bottom together. Hidden stickers are silent.",
  snake: "All three visible faces snake together: the middle row reverses, then the bottom row turns forward again. Hidden stickers are silent.",
  face: "Each snake beat is divided into three face subdivisions: upper acid, left drum, then right drum. Hidden stickers are silent.",
});

const ACID_ENGINES = Object.freeze({
  "web-audio": Object.freeze({
    id: "web-audio",
    label: "Web Audio 303",
    detail: "classic resonant voice",
  }),
  "webgpu-303": Object.freeze({
    id: "webgpu-303",
    label: "WebGPU 303",
    detail: "sticker placement modulation",
  }),
});

const SHAPES = Object.freeze({
  cube: Object.freeze({ id: "cube", label: "Cube", surface: "cube", triangulated: false }),
  morphix: Object.freeze({ id: "morphix", label: "Morphix", surface: "morphix", triangulated: true }),
  diamond: Object.freeze({ id: "diamond", label: "Diamond", surface: "diamond", triangulated: true }),
  stella: Object.freeze({ id: "stella", label: "Stella", surface: "stella", triangulated: true }),
  orb: Object.freeze({ id: "orb", label: "Orb", surface: "orb", triangulated: false }),
});

const MORPHIX_FACE_NORMALS = Object.freeze([
  Object.freeze({ x: -1, y: -1, z: -1 }),
  Object.freeze({ x: -1, y: 1, z: 1 }),
  Object.freeze({ x: 1, y: -1, z: 1 }),
  Object.freeze({ x: 1, y: 1, z: -1 }),
]);

const DEFAULTS = Object.freeze({
  tempo: 126,
  swing: 0,
  cutoff: 980,
  resonance: 11.5,
  acidDecay: 0.18,
  drive: 2.4,
  acidLevel: 0.58,
  drumLevel: 0.54,
  soundBank: "soft-fm",
  acidEngine: DEFAULT_ACID_ENGINE,
  stickerModulation: DEFAULT_STICKER_MODULATION,
  visibilityDynamics: 0.72,
  output: 0.56,
  randomTwists: false,
  randomTwistSpeed: RUBIX_TWIST_SPEED_DEFAULT_POSITION,
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
  soundBank: DEFAULTS.soundBank,
  acidEngine: DEFAULTS.acidEngine,
  stickerModulation: DEFAULTS.stickerModulation,
  visibilityDynamics: DEFAULTS.visibilityDynamics,
  output: DEFAULTS.output,
});

const RUBIX_PRESETS = Object.freeze({
  classic: Object.freeze({
    id: "classic",
    label: "Classic cube",
    shapeId: "cube",
    size: 3,
    readingMode: "parallel",
    settings: Object.freeze({ ...DEFAULTS, soundBank: "soft-fm" }),
  }),
  "pocket-funk": Object.freeze({
    id: "pocket-funk",
    label: "Pocket funk",
    shapeId: "cube",
    size: 2,
    readingMode: "snake",
    settings: Object.freeze({
      tempo: 108, swing: 0.16, visibilityDynamics: 0.58,
      cutoff: 720, resonance: 8.8, acidDecay: 0.24, drive: 1.6,
      acidLevel: 0.43, drumLevel: 0.52, output: 0.52,
      soundBank: "analog", randomTwists: true, randomTwistSpeed: 48,
    }),
  }),
  "modal-sphere": Object.freeze({
    id: "modal-sphere",
    label: "Modal orb",
    shapeId: "orb",
    size: 3,
    readingMode: "face",
    settings: Object.freeze({
      tempo: 112, swing: 0.2, visibilityDynamics: 0.86,
      cutoff: 620, resonance: 7.5, acidDecay: 0.28, drive: 1.35,
      acidLevel: 0.36, drumLevel: 0.53, output: 0.52,
      soundBank: "modal", randomTwists: true, randomTwistSpeed: 42,
    }),
  }),
  "noise-grid": Object.freeze({
    id: "noise-grid",
    label: "Noise grid",
    shapeId: "cube",
    size: 4,
    readingMode: "face",
    settings: Object.freeze({
      tempo: 138, swing: 0.04, visibilityDynamics: 0.92,
      cutoff: 1860, resonance: 9, acidDecay: 0.11, drive: 1.7,
      acidLevel: 0.4, drumLevel: 0.4, output: 0.48,
      soundBank: "noise", randomTwists: true, randomTwistSpeed: 70,
    }),
  }),
  "pyramid-drift": Object.freeze({
    id: "pyramid-drift",
    label: "Morphix drift",
    shapeId: "morphix",
    size: 3,
    readingMode: "snake",
    settings: Object.freeze({
      tempo: 94, swing: 0.12, visibilityDynamics: 0.78,
      cutoff: 540, resonance: 10.4, acidDecay: 0.38, drive: 1.25,
      acidLevel: 0.34, drumLevel: 0.48, output: 0.5,
      soundBank: "acid-303", acidEngine: "web-audio",
      randomTwists: true, randomTwistSpeed: 32,
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
    this.releaseAudioOutput = null;
    this.drumBus = null;
    this.drumBankBuses = new Map();
    this.acidBus = null;
    this.webGpuAcidBus = null;
    this.acidFilter = null;
    this.acidShaper = null;
    this.acidVca = null;
    this.acidOscillator = null;
    this.acidSub = null;
    this.noiseBuffer = null;
    this.output = DEFAULTS.output;
    this.soundBank = DEFAULTS.soundBank;
    this.acidEngine = DEFAULT_ACID_ENGINE;
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
    this.drumBus.gain.value = 0;
    this.drumBankBuses = new Map(PERCUSSION_SOUND_BANK_IDS.map((bankId) => {
      const bus = context.createGain();
      bus.gain.value = 0;
      bus.connect(this.drumBus);
      return [bankId, bus];
    }));
    this.acidBus = context.createGain();
    this.webGpuAcidBus = context.createGain();
    this.drumBus.connect(this.compressor);
    this.acidBus.connect(this.compressor);
    this.webGpuAcidBus.connect(this.compressor);
    this.compressor.connect(this.transportGain);
    this.transportGain.connect(this.master);
    this.master.connect(this.analyser);
    this.releaseAudioOutput = connectAudioOutput(context, this.analyser, { runtime: this.runtime });

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
    this.soundBank = Object.hasOwn(SOUND_BANKS, settings.soundBank)
      ? settings.soundBank
      : DEFAULTS.soundBank;
    const acidSelected = this.soundBank === "acid-303";
    this.setBankGain(
      this.drumBus,
      acidSelected ? 0 : clamp(settings.drumLevel, 0, 1),
      now,
    );
    for (const [bankId, bus] of this.drumBankBuses) {
      this.setBankGain(bus, !acidSelected && bankId === this.soundBank ? 1 : 0, now);
    }
    const acidLevel = clamp(settings.acidLevel, 0, 1);
    this.setBankGain(
      this.acidBus,
      acidSelected && this.acidEngine === "web-audio" ? acidLevel : 0,
      now,
    );
    this.setBankGain(
      this.webGpuAcidBus,
      acidSelected && this.acidEngine === "webgpu-303" ? acidLevel : 0,
      now,
    );
    this.acidFilter.Q.setTargetAtTime(clamp(settings.resonance, 0, 18), now, 0.012);
    this.acidShaper.curve = this.distortionCurve(settings.drive);
  }

  setBankGain(bus, value, now = this.context?.currentTime ?? 0) {
    const gain = bus?.gain;
    if (!gain) return;
    const target = clamp(value, 0, 1);
    gain.cancelScheduledValues?.(now);
    if (gain.setTargetAtTime) {
      gain.setTargetAtTime(target, now, target > 0 ? 0.012 : 0.006);
    } else {
      gain.value = target;
    }
    if (target === 0) gain.setValueAtTime?.(0, now + 0.024);
  }

  setSoundBank(bankId, settings) {
    this.soundBank = Object.hasOwn(SOUND_BANKS, bankId) ? bankId : DEFAULTS.soundBank;
    this.updateSettings({ ...settings, soundBank: this.soundBank });
  }

  setAcidEngine(engineId, settings) {
    this.acidEngine = engineId === "webgpu-303" ? "webgpu-303" : "web-audio";
    this.updateSettings(settings);
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
    const bankId = PERCUSSION_SOUND_BANK_IDS.includes(engineId) ? engineId : DEFAULTS.soundBank;
    const destination = this.drumBankBuses.get(bankId);
    if (!destination) return;
    const safeGain = clamp(laneGain, 0, 1.4);
    if (safeGain <= 0) return;
    const voice = sanitizeFmDrumVoice(this.voices[voiceIndex] ?? this.voices[0]);
    if (engineId === "analog") {
      this.scheduleAnalogDrum(voice, when, safeGain, destination);
    } else if (engineId === "modal") {
      this.scheduleModalDrum(voice, when, safeGain, destination);
    } else if (engineId === "noise") {
      this.scheduleNoiseDrum(voice, when, safeGain, destination);
    } else {
      this.scheduleFmDrum(voice, when, safeGain, destination);
    }
  }

  scheduleFmDrum(voice, when, laneGain, destination) {
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
    filter.connect(destination);

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

  scheduleAnalogDrum(voice, when, laneGain, destination) {
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
      filter.connect(destination);
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
        destination,
        when,
        stopAt,
        laneGain * 0.54,
      );
    }
  }

  scheduleModalDrum(voice, when, laneGain, destination) {
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
    filter.connect(destination);
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
        destination,
        when,
        when + attack + noiseDecay + 0.05,
        laneGain * 0.14,
      );
    }
  }

  scheduleNoiseDrum(voice, when, laneGain, destination) {
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
    amplitude.connect(destination);
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
      bodyGain.connect(destination);
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
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.compressor = null;
    this.transportGain = null;
    this.master = null;
    this.analyser = null;
    this.drumBus = null;
    this.drumBankBuses.clear();
    this.acidBus = null;
    this.webGpuAcidBus = null;
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
const webGpu303Capability = webGpu303Support(globalThis);
const state = {
  cube: createSolvedRubixCube(DEFAULT_RUBIX_SIZE),
  camera: { ...DEFAULT_RUBIX_CAMERA },
  selectedStickerId: null,
  audioOn: false,
  playing: false,
  currentStep: 0,
  readingMode: DEFAULT_READING_MODE,
  shapeId: DEFAULT_SHAPE_ID,
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
let webGpu303LifecycleGeneration = 0;
let webGpu303StartPromise = null;
let webGpu303Engine = null;
let webGpu303PatternKey = "";
let webGpu303FailureMessage = "";
let activeAcidEngine = DEFAULT_ACID_ENGINE;
let soundBankLifecycleGeneration = 0;
let soundBankTransportResumeRequested = false;
let transportLifecycleGeneration = 0;
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

function shapeForId(shapeId) {
  return Object.hasOwn(SHAPES, shapeId) ? SHAPES[shapeId] : SHAPES[DEFAULT_SHAPE_ID];
}

function currentShape() {
  return shapeForId(state.shapeId);
}

function sanitizeRubixSize(value, fallback = DEFAULT_RUBIX_SIZE) {
  const size = Math.round(Number(value));
  return Number.isFinite(size)
    ? clamp(size, RUBIX_SIZE_MIN, RUBIX_SIZE_MAX)
    : fallback;
}

function currentFormLabel(shape = currentShape(), size = state.cube.size) {
  return `${size} × ${size} · ${shape.label}`;
}

function twistSpeedValue(position = state.randomTwistSpeed) {
  const speed = rubixTwistSpeedMultiplier(position);
  const digits = speed < 1 ? 2 : speed < 10 ? 1 : 0;
  return Number(speed.toFixed(digits));
}

function twistSpeedLabel(position = state.randomTwistSpeed) {
  return `${twistSpeedValue(position)}×`;
}

function updateSizeControl(size = state.cube.size) {
  const safeSize = sanitizeRubixSize(size, state.cube.size);
  $("rubixSize").value = String(safeSize);
  $("rubixSize").setAttribute("aria-valuetext", `${safeSize} by ${safeSize}, ${safeSize} layers per face`);
  $("rubixSizeOut").textContent = `${safeSize} × ${safeSize}`;
}

function currentSoundBank() {
  return SOUND_BANKS[state.soundBank] ?? SOUND_BANKS[DEFAULTS.soundBank];
}

function soundBankRoleSet(bank = currentSoundBank()) {
  return bank.role === "acid"
    ? new Set(["acid"])
    : new Set(["drumLeft", "drumRight"]);
}

function currentAcidEngine() {
  return ACID_ENGINES[state.acidEngine] ?? ACID_ENGINES[DEFAULT_ACID_ENGINE];
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
  const activeRoles = new Set(
    frame.activeRoles.filter((role) => soundBankRoleSet().has(role)),
  );
  const ids = new Set();
  for (const role of Object.keys(ROLE_AUDIO_VALUE)) {
    if (!activeRoles.has(role)) continue;
    for (const event of performanceEventsForRole(role, frame)) {
      if (event.gain > 0) ids.add(event.sticker.id);
    }
  }
  return ids;
}

function webGpu303FormSupported() {
  return state.cube.size * state.cube.size <= WEBGPU_303_SEQUENCE_LENGTH;
}

function webGpu303ParamsFromControls() {
  const cutoff = clamp(state.cutoff, 160, 4200);
  const cutoffPosition = (
    Math.log(cutoff) - Math.log(160)
  ) / (Math.log(4200) - Math.log(160));
  return {
    ...RUBIX_WEBGPU_303_DEFAULTS,
    flt: -28 + cutoffPosition * 56,
    res: clamp(state.resonance / 18 * 15, 0, 15),
    dur: clamp(state.acidDecay, 0.06, 0.72),
    dist: clamp(state.drive * 0.58, 0.01, 5),
    swing: clamp(state.swing, 0, 0.42),
  };
}

function currentWebGpu303Pattern() {
  const snapshot = performanceSnapshots.at(-1) ?? sequenceSnapshot;
  const visibilityById = Object.freeze(Object.fromEntries(
    snapshot.lanes.acid.map((sticker) => [sticker.id, stickerDynamicsGain(sticker)]),
  ));
  return createRubixWebGpu303Pattern(snapshot, {
    readingMode: state.readingMode,
    tempo: state.tempo,
    visibilityById,
    amount: state.stickerModulation,
    baseParams: webGpu303ParamsFromControls(),
  });
}

function webGpu303PatternFingerprint(pattern) {
  return [
    ...Object.values(pattern.params).map((value) => Number(value).toFixed(4)),
    ...pattern.sequence.slice(0, state.cube.size * state.cube.size),
    ...pattern.stepModulation
      .slice(0, state.cube.size * state.cube.size)
      .flatMap((step) => step.map((value) => Number(value).toFixed(3))),
  ].join("|");
}

function syncWebGpu303Pattern({ force = false } = {}) {
  if (
    !webGpu303Engine
    || state.soundBank !== "acid-303"
    || state.acidEngine !== "webgpu-303"
  ) return false;
  try {
    const pattern = currentWebGpu303Pattern();
    const key = webGpu303PatternFingerprint(pattern);
    if (!force && key === webGpu303PatternKey) return true;
    webGpu303PatternKey = key;
    webGpu303Engine.updateParams(pattern.params);
    webGpu303Engine.updateSequence(pattern.sequence);
    webGpu303Engine.updateStepModulation(pattern.stepModulation);
    return true;
  } catch (error) {
    void fallbackFromWebGpu303(error);
    return false;
  }
}

function currentReadModeDescription() {
  const config = currentReadConfig();
  const soundBank = currentSoundBank();
  const soundingFaces = soundBank.role === "acid"
    ? `Only the upper visible face sounds through ${soundBank.label}; both drum faces rest.`
    : `The two side faces sound through ${soundBank.label}; the upper acid face rests.`;
  if (config.id !== "face") {
    return `${READ_MODE_DESCRIPTIONS[config.id]} ${soundingFaces}`;
  }
  const frame = currentReadFrame();
  const beatCount = frame.stepCount / config.subdivisionsPerBeat;
  return `Each of ${beatCount} snake beats is divided into upper acid, left drum, then right drum: ${frame.stepCount} alternating face subdivisions. ${soundingFaces} Hidden stickers are silent.`;
}

function renderStepStrip() {
  const config = currentReadConfig();
  const currentFrame = currentReadFrame();
  const cellCount = sequenceSnapshot.lanes.acid.length;
  const audibleRoles = soundBankRoleSet();
  const strip = $("stepStrip");
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < currentFrame.stepCount; index += 1) {
    const role = config.roleMode === "all"
      ? null
      : rubixReadFrame(state.readingMode, index, cellCount).activeRoles[0];
    const bankActive = !role || audibleRoles.has(role);
    const isTransportPosition = index === currentFrame.transportStep;
    const cell = document.createElement("span");
    cell.className = [
      "rubix-step",
      isTransportPosition ? "is-transport-position" : "",
      isTransportPosition && bankActive ? "is-active" : "",
      bankActive ? "" : "is-bank-resting",
    ].filter(Boolean).join(" ");
    cell.dataset.step = String(index);
    cell.dataset.bankActive = String(bankActive);
    if (role) cell.dataset.laneRole = role;
    cell.textContent = String(index + 1).padStart(2, "0");
    cell.title = bankActive
      ? `Step ${index + 1} of ${currentFrame.stepCount}`
      : `Step ${index + 1} of ${currentFrame.stepCount} · ${ROLE_META[role].label} bank resting`;
    cell.setAttribute("aria-hidden", "true");
    fragment.append(cell);
  }
  strip.dataset.stepCount = String(currentFrame.stepCount);
  strip.classList.toggle("is-dense", currentFrame.stepCount > 27);
  strip.style.gridTemplateColumns = `repeat(${currentFrame.stepCount}, minmax(0, 1fr))`;
  strip.setAttribute("aria-label", `${config.label}, ${currentReadLengthLabel(currentFrame, config)} playhead · ${currentSoundBank().label}`);
  strip.replaceChildren(fragment);
}

function renderColorKey() {
  const soundBank = currentSoundBank();
  const fragment = document.createDocumentFragment();
  for (const color of RUBIX_COLOR_ORDER) {
    const leftVoice = voices[RUBIX_DRUM_LEFT_VOICE_BY_COLOR[color]];
    const rightVoice = voices[RUBIX_DRUM_RIGHT_VOICE_BY_COLOR[color]];
    const item = document.createElement("span");
    item.style.setProperty("--key-color", COLOR_HEX[color]);
    const swatch = document.createElement("i");
    const copy = document.createElement("b");
    copy.textContent = soundBank.role === "acid"
      ? `${color} · ${midiLabel(RUBIX_ACID_MIDI_BY_COLOR[color] + 12)}`
      : `${color} · ${leftVoice.name} / ${rightVoice.name}`;
    item.append(swatch, copy);
    fragment.append(item);
  }
  const colorKey = $("colorKey");
  colorKey.dataset.soundBank = soundBank.id;
  colorKey.setAttribute("aria-label", `${soundBank.label} sticker color mapping`);
  colorKey.replaceChildren(fragment);
}

function renderLaneList() {
  const frame = currentReadFrame();
  const audibleRoles = soundBankRoleSet();
  const lanes = [
    ["acid", sequenceSnapshot.lanes.acid, sequenceSnapshot.faceNames.acid],
    ["drumLeft", sequenceSnapshot.lanes.drumLeft, sequenceSnapshot.faceNames.drumLeft],
    ["drumRight", sequenceSnapshot.lanes.drumRight, sequenceSnapshot.faceNames.drumRight],
  ];
  const fragment = document.createDocumentFragment();
  for (const [role, stickers, face] of lanes) {
    const meta = ROLE_META[role];
    const card = document.createElement("article");
    const bankActive = audibleRoles.has(role);
    const isReading = bankActive && frame.activeRoles.includes(role);
    card.className = `rubix-lane-card${isReading ? " is-reading" : ""}${bankActive ? "" : " is-bank-resting"}`;
    card.dataset.laneRole = role;
    card.dataset.bankActive = String(bankActive);
    card.setAttribute("aria-disabled", String(!bankActive));
    card.style.setProperty("--lane-color", meta.color);
    const copy = document.createElement("div");
    copy.className = "rubix-lane-copy";
    const label = document.createElement("b");
    const identity = document.createElement("span");
    const detail = document.createElement("small");
    label.textContent = meta.label;
    identity.textContent = `${FACE_SHORT[face]} face · ${faceCenterColor(face)}`;
    detail.textContent = bankActive ? meta.detail : `${meta.detail} · bank resting`;
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
  const audibleRoles = soundBankRoleSet();
  for (const [role, face] of entries) {
    const badge = document.createElement("span");
    const bankActive = audibleRoles.has(role);
    badge.className = `rubix-face-badge${bankActive ? "" : " is-bank-resting"}`;
    badge.dataset.laneRole = role;
    badge.dataset.bankActive = String(bankActive);
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
      ? `random · ${twistSpeedLabel()}`
      : "manual · no selection";
    return;
  }
  const face = rubixFaceForNormal(sticker.normal);
  $("selectedSticker").textContent = `${sticker.color} · ${FACE_SHORT[face]} face · ${sticker.id.replaceAll(":", " / ")}`;
  $("selectedSwatch").style.background = COLOR_HEX[sticker.color];
  $("selectedSwatch").style.borderColor = COLOR_HEX[sticker.color];
  $("selectedSwatch").style.boxShadow = `0 0 10px ${COLOR_HEX[sticker.color]}66`;
  $("moveSummary").textContent = state.randomTwists
    ? `random · ${twistSpeedLabel()}`
    : `${FACE_SHORT[face]} ${sticker.color} selected`;
}

function updateAcidEngineUi() {
  const engine = currentAcidEngine();
  const acidBankSelected = currentSoundBank().role === "acid";
  const engineSelect = $("acidEngine");
  const modulationControl = $("stickerModulationControl");
  const modulationInput = $("stickerModulation");
  if (!engineSelect || !modulationControl || !modulationInput) return;
  const gpuOption = engineSelect.querySelector('option[value="webgpu-303"]');
  const gpuAvailable = webGpu303Capability.supported && webGpu303FormSupported();
  if (gpuOption) gpuOption.disabled = !gpuAvailable;
  engineSelect.value = engine.id;
  engineSelect.disabled = !acidBankSelected;
  if (webGpu303StartPromise) engineSelect.setAttribute("aria-busy", "true");
  else engineSelect.removeAttribute("aria-busy");
  $("acidEngineState").textContent = engine.label;
  modulationInput.value = String(state.stickerModulation);
  $("stickerModulationOut").textContent = `${Math.round(state.stickerModulation * 100)}%`;
  const modulationDisabled = !acidBankSelected || engine.id !== "webgpu-303" || !gpuAvailable;
  modulationInput.disabled = modulationDisabled;
  modulationControl.classList.toggle("is-disabled", modulationDisabled);
  modulationControl.setAttribute("aria-disabled", String(modulationDisabled));
  let status = "WebGPU ready · select it to let sticker placement shape each step";
  if (!acidBankSelected) {
    status = "303 resting · choose the 303 acid bank to enable these controls";
  } else if (!webGpu303Capability.supported) {
    status = "WebGPU unavailable in this browser · using Web Audio 303";
  } else if (!webGpu303FormSupported()) {
    status = `WebGPU supports up to ${Math.floor(Math.sqrt(WEBGPU_303_SEQUENCE_LENGTH))} × ${Math.floor(Math.sqrt(WEBGPU_303_SEQUENCE_LENGTH))} · using Web Audio 303`;
  } else if (webGpu303FailureMessage) {
    status = webGpu303FailureMessage;
  } else if (webGpu303StartPromise) {
    status = "Starting WebGPU 303…";
  } else if (engine.id === "webgpu-303" && webGpu303Engine) {
    status = `WebGPU 303 active · sticker modulation ${Math.round(state.stickerModulation * 100)}%`;
  } else if (engine.id === "webgpu-303") {
    status = "WebGPU ready · starts with Audio";
  }
  $("acidEngineStatus").textContent = status;
}

function updateReadouts() {
  const readConfig = currentReadConfig();
  const readFrame = currentReadFrame();
  const shape = currentShape();
  const soundBank = currentSoundBank();
  const acidEngine = currentAcidEngine();
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
  $("shape").value = shape.id;
  $("shapeState").textContent = shape.label;
  updateSizeControl();
  $("soundBank").value = soundBank.id;
  $("soundBankState").textContent = soundBank.label;
  $("soundBankSummary").textContent = soundBank.label;
  const acidBankSelected = soundBank.role === "acid";
  $("soundBankStatus").textContent = acidBankSelected
    ? `${acidEngine.label} active · upper face audible · drum kits resting`
    : `${soundBank.label} active · side faces audible · 303 resting`;
  $("scoreSummary").textContent = soundBank.role === "acid"
    ? `${FACE_SHORT[sequenceSnapshot.faceNames.acid]} · ${soundBank.label}`
    : `${FACE_SHORT[sequenceSnapshot.faceNames.drumLeft]} + ${FACE_SHORT[sequenceSnapshot.faceNames.drumRight]} · ${soundBank.label}`;
  $("scoreDescription").textContent = currentReadModeDescription();
  for (const [id, disabled] of [
    ["kitBankControls", acidBankSelected],
    ["acidBankControls", !acidBankSelected],
  ]) {
    const fieldset = $(id);
    fieldset.disabled = disabled;
    fieldset.classList.toggle("is-disabled", disabled);
    fieldset.setAttribute("aria-disabled", String(disabled));
  }
  updateAcidEngineUi();
  $("randomTwistSpeed").value = String(state.randomTwistSpeed);
  $("randomTwistSpeed").setAttribute(
    "aria-valuetext",
    `${twistSpeedValue()} times normal speed`,
  );
  $("randomTwistSpeedOut").textContent = twistSpeedLabel();
  $("randomTwists").setAttribute("aria-pressed", String(state.randomTwists));
  $("randomTwistState").textContent = state.randomTwists
    ? `on · ${twistSpeedLabel()} speed`
    : "off · manual moves only";
  $("rubixPreset").value = preset?.id ?? "";
  $("rubixPresetState").textContent = preset?.label ?? "Custom";
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
    if (activeAcidEngine === "webgpu-303") {
      stopTransport();
      void startTransport({ restart: true });
    } else {
      if (schedulerTimer !== null) clearTimeout(schedulerTimer);
      schedulerTimer = null;
      clearVisualTimers();
      nextStepTime = audio.context.currentTime + LOOKAHEAD_SECONDS + 0.025;
      schedulerTick();
    }
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
    `Interactive ${currentFormLabel()} sequencer. Audio ${state.audioOn ? "on" : "off"}. Drag a sticker to twist it; drag empty space to orbit. Random twists ${state.randomTwists ? "on" : "off"}.`,
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
  const soundBank = currentSoundBank();
  const audibleFaceLabel = soundBank.role === "acid"
    ? FACE_SHORT[sequenceSnapshot.faceNames.acid]
    : [
      sequenceSnapshot.faceNames.drumLeft,
      sequenceSnapshot.faceNames.drumRight,
    ].map((face) => FACE_SHORT[face]).join(" / ");
  $("scoreSummary").textContent = soundBank.role === "acid"
    ? `${FACE_SHORT[sequenceSnapshot.faceNames.acid]} · ${soundBank.label}`
    : `${FACE_SHORT[sequenceSnapshot.faceNames.drumLeft]} + ${FACE_SHORT[sequenceSnapshot.faceNames.drumRight]} · ${soundBank.label}`;
  $("sequenceState").textContent = `${sequenceSnapshot.stickerIds.length} visible stickers · ${soundBank.label} on ${audibleFaceLabel} · ${readConfig.label} · ${currentReadLengthLabel(readFrame, readConfig)}`;
  if (
    announceChange
    && JSON.stringify(previousFaces) !== JSON.stringify(sequenceSnapshot.faceNames)
  ) {
    announce(soundBank.role === "acid"
      ? `Visible score changed. ${sequenceSnapshot.faceNames.acid} face now plays ${soundBank.label}; both drum faces rest.`
      : `Visible score changed. ${sequenceSnapshot.faceNames.drumLeft} and ${sequenceSnapshot.faceNames.drumRight} faces now play ${soundBank.label}; the upper acid face rests.`);
  }
  requestDraw();
}

function updateNowPlaying(frame = currentReadFrame()) {
  const liveSnapshot = performanceSnapshots.at(-1) ?? sequenceSnapshot;
  const acidEvent = performanceEventsForRole("acid", frame)[0];
  const leftEvent = performanceEventsForRole("drumLeft", frame)[0];
  const rightEvent = performanceEventsForRole("drumRight", frame)[0];
  const activeRoles = new Set(frame.activeRoles);
  const acidBankSelected = currentSoundBank().role === "acid";
  const acidText = !acidBankSelected
    ? "ACID · BANK RESTING"
    : activeRoles.has("acid")
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
  const drumText = acidBankSelected
    ? "DRUMS · BANK RESTING"
    : drumNames.length
      ? `${currentSoundBank().label.toUpperCase()} · ${drumNames.join(" + ")}`
      : `${currentSoundBank().label.toUpperCase()} · REST`;
  if ($("drumNow").textContent !== drumText) $("drumNow").textContent = drumText;
}

function setAudibleStickerIds(ids) {
  const value = [...ids].join("|");
  if (canvas.dataset.audibleStickerIds !== value) canvas.dataset.audibleStickerIds = value;
}

function updatePlayhead(step) {
  const frame = currentReadFrame(step);
  const audibleRoles = soundBankRoleSet();
  state.currentStep = frame.transportStep;
  for (const item of $("stepStrip").querySelectorAll(".rubix-step")) {
    const bankActive = !item.dataset.laneRole || audibleRoles.has(item.dataset.laneRole);
    const itemStep = Number(item.dataset.step);
    const isTransportPosition = itemStep === state.currentStep;
    item.classList.toggle("is-transport-position", isTransportPosition);
    item.classList.toggle("is-active", isTransportPosition && bankActive);
    item.classList.toggle("is-bank-resting", !bankActive);
    item.dataset.bankActive = String(bankActive);
    item.title = bankActive
      ? `Step ${itemStep + 1} of ${frame.stepCount}`
      : `Step ${itemStep + 1} of ${frame.stepCount} · ${ROLE_META[item.dataset.laneRole].label} bank resting`;
  }
  for (const card of $("laneList").querySelectorAll(".rubix-lane-card")) {
    const bankActive = audibleRoles.has(card.dataset.laneRole);
    const isReading = bankActive && frame.activeRoles.includes(card.dataset.laneRole);
    card.classList.toggle("is-reading", isReading);
    card.classList.toggle("is-bank-resting", !bankActive);
    card.dataset.bankActive = String(bankActive);
    card.setAttribute("aria-disabled", String(!bankActive));
    for (const [index, sticker] of [...card.querySelectorAll(".rubix-mini-sticker")].entries()) {
      sticker.classList.toggle("is-active", isReading && index === frame.cellIndex);
    }
  }
  updateNowPlaying(frame);
  const audibleIds = audibleStickerIds(frame);
  setAudibleStickerIds(audibleIds);
  const liveSnapshot = performanceSnapshots.at(-1) ?? sequenceSnapshot;
  const soundBank = currentSoundBank();
  const audibleFaceLabel = soundBank.role === "acid"
    ? FACE_SHORT[liveSnapshot.faceNames.acid]
    : [
      liveSnapshot.faceNames.drumLeft,
      liveSnapshot.faceNames.drumRight,
    ].map((face) => FACE_SHORT[face]).join(" / ");
  $("stageReadout").textContent = `AUDIBLE ${audibleFaceLabel} · ${soundBank.label.toUpperCase()} · STEP ${state.currentStep + 1}/${frame.stepCount} · AUDIO ${state.audioOn ? "ON" : "OFF"}`;
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
  const shape = currentShape();
  if (shape.surface === "cube") return add(source, scale(outward, lift));

  const direction = normalize(source);
  if (shape.surface === "orb") {
    return scale(direction, state.cube.size * 0.58 + lift);
  }

  if (shape.surface === "diamond") {
    const taxicabLength = Math.max(
      1e-9,
      Math.abs(source.x) + Math.abs(source.y) + Math.abs(source.z),
    );
    return scale(source, (state.cube.size * 0.9 + lift) / taxicabLength);
  }

  if (shape.surface === "morphix") {
    const faceDistance = Math.max(
      1e-9,
      ...MORPHIX_FACE_NORMALS.map((normal) => dot(normal, direction)),
    );
    return scale(direction, (state.cube.size * 0.55 + lift) / faceDistance);
  }

  const cornerAlignment = (
    Math.abs(direction.x) + Math.abs(direction.y) + Math.abs(direction.z)
  ) / Math.sqrt(3);
  const axisAlignment = 1 / Math.sqrt(3);
  const spike = clamp((cornerAlignment - axisAlignment) / (1 - axisAlignment), 0, 1) ** 3;
  const starRadius = state.cube.size * 0.62 * (0.62 + spike * 0.9) + lift;
  return scale(direction, starRadius);
}

function appendPolygonPath(points) {
  drawing.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) drawing.lineTo(points[index].x, points[index].y);
  drawing.closePath();
}

function projectedTriangleTwiceArea(points) {
  const [center, first, second] = points;
  return (
    (first.x - center.x) * (second.y - center.y)
    - (first.y - center.y) * (second.x - center.x)
  );
}

function appendNormalizedTrianglePath(points) {
  appendPolygonPath(projectedTriangleTwiceArea(points) < 0
    ? [points[0], points[2], points[1]]
    : points);
}

function surfacePath(surface) {
  drawing.beginPath();
  for (const triangle of surface.triangles) {
    if (triangle.visible) appendNormalizedTrianglePath(triangle.points);
  }
}

function surfaceBoundaryPath(surface, inset = 1) {
  const { projectedCenter, triangles } = surface;
  const insetPoint = (point) => ({
    x: projectedCenter.x + (point.x - projectedCenter.x) * inset,
    y: projectedCenter.y + (point.y - projectedCenter.y) * inset,
  });
  drawing.beginPath();
  for (let index = 0; index < triangles.length; index += 1) {
    const triangle = triangles[index];
    if (!triangle.visible) continue;
    const previous = triangles[(index + triangles.length - 1) % triangles.length];
    const next = triangles[(index + 1) % triangles.length];
    const [center, first, second] = triangle.points.map(insetPoint);
    if (!previous.visible) {
      drawing.moveTo(center.x, center.y);
      drawing.lineTo(first.x, first.y);
    }
    drawing.moveTo(first.x, first.y);
    drawing.lineTo(second.x, second.y);
    if (!next.visible) {
      drawing.moveTo(second.x, second.y);
      drawing.lineTo(center.x, center.y);
    }
  }
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
  const sourceCorners = (half) => [
    add(add(faceCenter, scale(right, -half)), scale(down, -half)),
    add(add(faceCenter, scale(right, half)), scale(down, -half)),
    add(add(faceCenter, scale(right, half)), scale(down, half)),
    add(add(faceCenter, scale(right, -half)), scale(down, half)),
  ];
  const screenTangent = (direction, lift) => {
    const sampleDistance = 0.2;
    const before = projectWorld(warpRubixSurfacePoint(
      add(faceCenter, scale(direction, -sampleDistance)),
      normal,
      lift,
    ));
    const after = projectWorld(warpRubixSurfacePoint(
      add(faceCenter, scale(direction, sampleDistance)),
      normal,
      lift,
    ));
    return normalize({ x: after.x - before.x, y: after.y - before.y, z: 0 });
  };
  const makeSurface = (half, lift) => {
    const worldCenter = warpRubixSurfacePoint(faceCenter, normal, lift);
    const worldCorners = sourceCorners(half)
      .map((point) => warpRubixSurfacePoint(point, normal, lift));
    const projectedCenter = projectWorld(worldCenter);
    const projectedCorners = worldCorners.map(projectWorld);
    const triangles = worldCorners.map((_, index) => {
      const points = [
        projectedCenter,
        projectedCorners[index],
        projectedCorners[(index + 1) % projectedCorners.length],
      ];
      const twiceArea = projectedTriangleTwiceArea(points);
      return {
        visible: points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))
          && Math.abs(twiceArea) > 1e-6,
        points,
      };
    });
    return { worldCenter, projectedCenter, projectedCorners, triangles };
  };
  const stickerSurface = makeSurface(0.405, 0.033);
  const projectedTriangles = stickerSurface.triangles
    .filter(({ visible }) => visible)
    .map(({ points }) => points);
  if (!projectedTriangles.length) return null;
  const baseSurface = makeSurface(0.485, 0.015);
  return {
    sticker,
    face,
    normal,
    right,
    down,
    screenRight: screenTangent(right, 0.033),
    screenDown: screenTangent(down, 0.033),
    center: stickerSurface.worldCenter,
    projectedCenter: stickerSurface.projectedCenter,
    depth: stickerSurface.projectedCenter.depth,
    baseSurface,
    stickerSurface,
    projectedTriangles,
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
  const { sticker, baseSurface, stickerSurface, projectedCenter, face } = geometry;
  surfacePath(baseSurface);
  drawing.fillStyle = "#030405";
  drawing.fill();
  surfaceBoundaryPath(baseSurface);
  drawing.strokeStyle = "rgba(226, 241, 233, 0.15)";
  drawing.lineWidth = 1;
  drawing.stroke();

  const visiblePoints = stickerSurface.triangles
    .filter(({ visible }) => visible)
    .flatMap(({ points }) => points);
  const bounds = visiblePoints.reduce((result, point) => ({
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
  surfacePath(stickerSurface);
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
  surfaceBoundaryPath(stickerSurface);
  drawing.stroke();

  if (currentShape().triangulated) {
    const diagonalStart = (sticker.homeRow + sticker.homeColumn) % 2 === 0 ? 0 : 1;
    drawing.beginPath();
    for (const cornerIndex of [diagonalStart, (diagonalStart + 2) % 4]) {
      const before = stickerSurface.triangles[(cornerIndex + 3) % 4];
      const after = stickerSurface.triangles[cornerIndex];
      if (!before.visible && !after.visible) continue;
      const corner = stickerSurface.projectedCorners[cornerIndex];
      drawing.moveTo(corner.x, corner.y);
      drawing.lineTo(projectedCenter.x, projectedCenter.y);
    }
    drawing.strokeStyle = "rgba(4, 8, 9, 0.42)";
    drawing.lineWidth = 1;
    drawing.stroke();
  }

  if (selected) {
    surfaceBoundaryPath(stickerSurface, 0.78);
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
  if (state.soundBank === "acid-303" && state.acidEngine === "webgpu-303") {
    syncWebGpu303Pattern();
  }
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
  announceCompletion = true,
} = {}) {
  if (turnAnimation) {
    turnQueue.push({ move, options: {
      fromAngle, duration, record, label, announceCompletion,
    } });
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
    announceCompletion,
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
  if (!turnQueue.length && finished.announceCompletion) {
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
  const interval = rubixTwistIntervalMs(state.randomTwistSpeed);
  randomTwistTimer = setTimeout(() => {
    randomTwistTimer = null;
    if (
      state.randomTwists
      && !pointerGesture
      && !turnAnimation
      && turnQueue.length === 0
    ) {
      beginTurn(nextRandomTwistMove(), {
        duration: clamp(interval * 0.7, 48, 240),
        record: true,
        label: "random twist",
        announceCompletion: false,
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
    announce(`Random twists on at ${twistSpeedValue()} times normal speed.`);
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

function setRubixForm({ shapeId = state.shapeId, size = state.cube.size } = {}, shouldAnnounce = true) {
  const shape = shapeForId(shapeId);
  const safeSize = sanitizeRubixSize(size, state.cube.size);
  const shapeChanged = state.shapeId !== shape.id;
  const sizeChanged = state.cube.size !== safeSize;
  state.shapeId = shape.id;
  canvas.dataset.shape = shape.surface;
  stageWrap.dataset.shape = shape.surface;
  $("shape").value = shape.id;
  $("shapeState").textContent = shape.label;
  updateSizeControl(safeSize);
  if (!sizeChanged) {
    updateCanvasAriaLabel();
    updateReadouts();
    if (shapeChanged) {
      updateSelectedUi();
      requestDraw();
      if (shouldAnnounce) {
        announce(`${shape.label} visual form applied. Cube arrangement, size, and view unchanged.`);
      }
    }
    return;
  }

  turnQueue = [];
  turnAnimation = null;
  previewTurn = null;
  moveHistory = [];
  visibilityProfile = Object.freeze({});
  state.cube = createSolvedRubixCube(safeSize);
  if (
    state.soundBank === "acid-303"
    && state.acidEngine === "webgpu-303"
    && !webGpu303FormSupported()
  ) {
    void fallbackFromWebGpu303();
  }
  updateCanvasAriaLabel();
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
    if (activeAcidEngine === "webgpu-303") {
      stopTransport();
      void startTransport({ restart: true });
    } else {
      if (schedulerTimer !== null) clearTimeout(schedulerTimer);
      schedulerTimer = null;
      clearVisualTimers();
      nextStepTime = audio.context.currentTime + LOOKAHEAD_SECONDS + 0.025;
      schedulerTick();
    }
  }
  if (shouldAnnounce) {
    announce(`${currentFormLabel(shape, safeSize)} loaded as a solved visual form. ${safeSize * safeSize} stickers per face; ${currentReadConfig().label.toLowerCase()} uses ${currentReadLengthLabel()}.`);
  }
}

async function applyRubixPreset(presetId, shouldAnnounce = true) {
  const preset = RUBIX_PRESETS[presetId] ?? RUBIX_PRESETS.classic;
  const wasPlaying = state.playing;
  if (wasPlaying) stopTransport();
  if (randomTwistTimer !== null) clearTimeout(randomTwistTimer);
  randomTwistTimer = null;
  state.presetId = preset.id;
  Object.assign(state, DEFAULTS, preset.settings);
  setRubixForm({ shapeId: preset.shapeId, size: preset.size }, false);
  setReadingMode(preset.readingMode, false);
  await selectSoundBank(state.soundBank, {
    announceChange: false,
    markCustom: false,
  });
  audio.updateSettings(state);
  audio.setOutput(state.output);
  updateReadouts();
  updateSelectedUi();
  if (state.randomTwists) startRandomTwists(false);
  else stopRandomTwists(false);
  const shouldResume = state.audioOn
    && (wasPlaying || state.playing || soundBankTransportResumeRequested);
  if (shouldResume) await startTransport({ restart: true });
  if (shouldAnnounce) {
    announce(`${preset.label} preset. ${currentFormLabel()}, ${currentReadConfig().label}, ${currentSoundBank().label}.`);
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
  state.cube = createSolvedRubixCube(state.cube.size);
  updateSnapshot();
  state.selectedStickerId = sequenceSnapshot.lanes.acid[middleFaceIndex()].id;
  $("undoMove").disabled = true;
  updateSelectedUi();
  announce(randomTwistsWereActive
    ? "Cube solved and random twists stopped. Sound and view unchanged."
    : "Cube solved. Sound and view unchanged.");
}

async function resetSound() {
  const wasPlaying = state.playing;
  if (wasPlaying) stopTransport();
  Object.assign(state, SOUND_DEFAULTS);
  state.presetId = "";
  audio.updateSettings(state);
  audio.setOutput(state.output);
  setReadingMode(DEFAULT_READING_MODE, false);
  await selectSoundBank(DEFAULTS.soundBank, {
    announceChange: false,
    markCustom: false,
  });
  const shouldResume = state.audioOn
    && (wasPlaying || state.playing || soundBankTransportResumeRequested);
  if (shouldResume) await startTransport({ restart: true });
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
    if (hitRegions[index].projectedTriangles.some(
      (triangle) => polygonContains(triangle, point.x, point.y),
    )) return hitRegions[index];
  }
  return null;
}

function gestureMoveForDelta(hit, deltaX, deltaY) {
  const determinant = (
    hit.screenRight.x * hit.screenDown.y
    - hit.screenRight.y * hit.screenDown.x
  );
  const horizontalAmount = Math.abs(determinant) > 1e-5
    ? (deltaX * hit.screenDown.y - deltaY * hit.screenDown.x) / determinant
    : deltaX * hit.screenRight.x + deltaY * hit.screenRight.y;
  const verticalAmount = Math.abs(determinant) > 1e-5
    ? (hit.screenRight.x * deltaY - hit.screenRight.y * deltaX) / determinant
    : deltaX * hit.screenDown.x + deltaY * hit.screenDown.y;
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
    const acidBankActive = state.soundBank === "acid-303";
    const acidEvent = performanceEventsForRole("acid", frame)[0];
    if (
      acidBankActive
      &&
      activeAcidEngine === "web-audio"
      && activeRoles.has("acid")
      && acidEvent?.gain > 0
    ) {
      audio.scheduleAcid(
        acidEvent.value,
        acidEvent.sticker,
        nextStepTime,
        beatDuration,
        state,
        acidEvent.gain,
      );
    }
    if (!acidBankActive) {
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
            state.soundBank,
          );
        }
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

function setActiveAcidEngine(engineId) {
  activeAcidEngine = engineId === "webgpu-303" && webGpu303Engine
    ? "webgpu-303"
    : "web-audio";
  audio.setAcidEngine(activeAcidEngine, state);
}

async function stopWebGpu303Engine() {
  webGpu303LifecycleGeneration += 1;
  webGpu303StartPromise = null;
  webGpu303PatternKey = "";
  const engine = webGpu303Engine;
  webGpu303Engine = null;
  setActiveAcidEngine("web-audio");
  if (engine) await engine.stop().catch(() => {});
}

async function fallbackFromWebGpu303(error) {
  const wasSelected = state.acidEngine === "webgpu-303";
  if (error) {
    webGpu303FailureMessage = "WebGPU 303 could not start or continue · using Web Audio 303";
  }
  state.acidEngine = DEFAULT_ACID_ENGINE;
  await stopWebGpu303Engine();
  updateReadouts();
  setAudioState(state.audioOn);
  if (wasSelected) {
    announce("WebGPU 303 could not continue. Using the classic Web Audio 303.");
  }
  if (error) console.warn("Rubix WebGPU 303 fallback", error);
}

async function startWebGpu303Engine() {
  if (state.soundBank !== "acid-303" || state.acidEngine !== "webgpu-303") return false;
  if (webGpu303Engine) {
    setActiveAcidEngine("webgpu-303");
    syncWebGpu303Pattern({ force: true });
    return true;
  }
  if (!webGpu303Capability.supported || !webGpu303FormSupported()) {
    await fallbackFromWebGpu303();
    return false;
  }
  if (!audio.context || !audio.webGpuAcidBus) return false;
  if (webGpu303StartPromise) return webGpu303StartPromise;

  webGpu303FailureMessage = "";
  const generation = ++webGpu303LifecycleGeneration;
  const candidate = new WebGpu303Audio(globalThis, { chunkDuration: 0.055 });
  const pattern = currentWebGpu303Pattern();
  candidate.updateSequence(pattern.sequence);
  candidate.updateStepModulation(pattern.stepModulation);
  candidate.setOutput(1);
  candidate.setPlaybackEnabled(false);

  let pending;
  pending = candidate.start(pattern.params, {
    context: audio.context,
    destination: audio.webGpuAcidBus,
    autoStart: false,
  }).then(async () => {
    if (
      generation !== webGpu303LifecycleGeneration
      || state.soundBank !== "acid-303"
      || state.acidEngine !== "webgpu-303"
      || candidate.context !== audio.context
    ) {
      await candidate.stop().catch(() => {});
      return false;
    }
    webGpu303Engine = candidate;
    webGpu303PatternKey = webGpu303PatternFingerprint(pattern);
    candidate.setErrorHandler((renderError) => {
      if (webGpu303Engine === candidate) void fallbackFromWebGpu303(renderError);
    });
    setActiveAcidEngine("webgpu-303");
    updateReadouts();
    return true;
  }).catch(async (error) => {
    await candidate.stop().catch(() => {});
    if (generation === webGpu303LifecycleGeneration) {
      await fallbackFromWebGpu303(error);
    }
    return false;
  }).finally(() => {
    if (webGpu303StartPromise === pending) webGpu303StartPromise = null;
    updateReadouts();
  });
  webGpu303StartPromise = pending;
  updateReadouts();
  return pending;
}

async function activateSelectedSoundBank({ audioEnabled = state.audioOn } = {}) {
  audio.setSoundBank(state.soundBank, state);
  if (
    state.soundBank === "acid-303"
    && state.acidEngine === "webgpu-303"
    && audioEnabled
  ) {
    return startWebGpu303Engine();
  }
  await stopWebGpu303Engine();
  setActiveAcidEngine("web-audio");
  return true;
}

async function selectSoundBank(bankId, {
  announceChange = true,
  markCustom = true,
} = {}) {
  const requested = SOUND_BANKS[bankId]?.id ?? DEFAULTS.soundBank;
  const wasPlaying = state.playing || soundBankTransportResumeRequested;
  soundBankTransportResumeRequested = wasPlaying;
  const generation = ++soundBankLifecycleGeneration;
  stopTransport();
  state.soundBank = requested;
  if (markCustom) markPresetCustom();
  audio.setSoundBank(requested, state);
  updateReadouts();
  renderStepStrip();
  renderColorKey();
  renderLaneList();
  renderFaceBadges();
  updatePlayhead(state.currentStep);

  const activated = await activateSelectedSoundBank();
  if (generation !== soundBankLifecycleGeneration) return false;
  const shouldResume = state.audioOn
    && (wasPlaying || state.playing || soundBankTransportResumeRequested);
  if (shouldResume) await startTransport({ restart: true });
  if (generation !== soundBankLifecycleGeneration) return false;
  soundBankTransportResumeRequested = false;
  updateReadouts();
  setAudioState(state.audioOn);
  if (announceChange && activated) {
    announce(requested === "acid-303"
      ? `${currentAcidEngine().label} 303 bank selected. Only the upper face is sounding.`
      : `${currentSoundBank().label} selected. Only the two drum faces are sounding.`);
  }
  return activated;
}

async function selectAcidEngine(engineId, {
  announceChange = true,
  markCustom = true,
} = {}) {
  const requested = ACID_ENGINES[engineId]?.id ?? DEFAULT_ACID_ENGINE;
  if (requested === "webgpu-303") webGpu303FailureMessage = "";
  else if (state.acidEngine !== "webgpu-303") webGpu303FailureMessage = "";
  if (
    requested === "webgpu-303"
    && (!webGpu303Capability.supported || !webGpu303FormSupported())
  ) {
    state.acidEngine = DEFAULT_ACID_ENGINE;
    setActiveAcidEngine(DEFAULT_ACID_ENGINE);
    updateReadouts();
    if (announceChange) {
      announce("WebGPU 303 is unavailable for this browser or cube size. Using Web Audio 303.");
    }
    return false;
  }

  const acidBankSelected = state.soundBank === "acid-303";
  const wasPlaying = acidBankSelected
    && (state.playing || soundBankTransportResumeRequested);
  soundBankTransportResumeRequested = wasPlaying;
  const generation = ++soundBankLifecycleGeneration;
  if (acidBankSelected) stopTransport();
  state.acidEngine = requested;
  if (markCustom) markPresetCustom();
  updateReadouts();

  const activated = await activateSelectedSoundBank();
  if (generation !== soundBankLifecycleGeneration) return false;
  const shouldResume = acidBankSelected
    && state.audioOn
    && (wasPlaying || state.playing || soundBankTransportResumeRequested);
  if (shouldResume) await startTransport({ restart: true });
  if (generation !== soundBankLifecycleGeneration) return false;
  soundBankTransportResumeRequested = false;
  updateReadouts();
  setAudioState(state.audioOn);
  if (announceChange && activated) {
    announce(requested === "webgpu-303"
      ? "WebGPU 303 selected. Sticker row, column, edge, face, and visibility now shape the acid voice."
      : "Web Audio 303 selected.");
  }
  return activated;
}

function setAudioState(enabled) {
  state.audioOn = enabled;
  $("audioButton").setAttribute("aria-pressed", String(enabled));
  $("audioState").textContent = enabled ? "on" : "off";
  updateCanvasAriaLabel();
  if (enabled && audio.context) {
    const engineLabel = state.soundBank === "acid-303"
      ? activeAcidEngine === "webgpu-303" ? "WebGPU 303 acid" : "Classic Web Audio 303"
      : `${currentSoundBank().label} · Web Audio`;
    $("engineState").textContent = `${engineLabel} · ${Math.round(audio.context.sampleRate / 1000)} kHz`;
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
  pending = audio.start(state).then(async (context) => {
    if (generation !== audioLifecycleGeneration || context !== audio.context) return false;
    audio.setOutput(state.output);
    setActiveAcidEngine("web-audio");
    await activateSelectedSoundBank({ audioEnabled: true });
    if (generation !== audioLifecycleGeneration || context !== audio.context) return false;
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
  soundBankLifecycleGeneration += 1;
  soundBankTransportResumeRequested = false;
  audioLifecycleGeneration += 1;
  audioStartPromise = null;
  setAudioState(false);
  await stopWebGpu303Engine();
  await audio.close().catch(() => {});
}

async function startTransport({ restart = false } = {}) {
  if (state.playing && !restart) return;
  if (!state.audioOn || !audio.context) {
    announce("Turn Audio on before playing the Rubix sequencer.");
    return false;
  }
  const generation = ++transportLifecycleGeneration;
  if (schedulerTimer !== null) clearTimeout(schedulerTimer);
  clearVisualTimers();
  let transportStartTime = audio.context.currentTime + 0.055;
  const gpuEngine = webGpu303Engine;
  if (
    state.soundBank === "acid-303"
    && activeAcidEngine === "webgpu-303"
    && gpuEngine
  ) {
    try {
      syncWebGpu303Pattern({ force: true });
      gpuEngine.setPlaybackEnabled(false);
      const gpuStartTime = await gpuEngine.restartTimeline({
        startAt: audio.context.currentTime + 0.075,
        offset: 0,
      });
      if (
        generation !== transportLifecycleGeneration
        || !state.audioOn
        || state.soundBank !== "acid-303"
        || gpuEngine !== webGpu303Engine
        || activeAcidEngine !== "webgpu-303"
      ) return false;
      if (Number.isFinite(gpuStartTime)) transportStartTime = gpuStartTime;
      gpuEngine.setPlaybackEnabled(true);
    } catch (error) {
      await fallbackFromWebGpu303(error);
      transportStartTime = audio.context.currentTime + 0.055;
    }
  }
  if (generation !== transportLifecycleGeneration || !state.audioOn || !audio.context) return false;
  state.playing = true;
  nextStepIndex = 0;
  nextSwingStep = 0;
  nextStepTime = transportStartTime;
  audio.setTransportActive(true);
  $("playButton").setAttribute("aria-pressed", "true");
  $("playLabel").textContent = "Pause cube";
  $("playState").textContent = `${Math.round(state.tempo)} BPM · running`;
  schedulerTick();
  announce(restart ? "Rubix loop restarted at step one." : "Rubix sequencer playing.");
  return true;
}

function stopTransport() {
  transportLifecycleGeneration += 1;
  state.playing = false;
  if (schedulerTimer !== null) clearTimeout(schedulerTimer);
  schedulerTimer = null;
  clearVisualTimers();
  webGpu303Engine?.setPlaybackEnabled(false);
  webGpu303Engine?.pauseTimeline();
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
    if (
      !state.playing
      || activeAcidEngine !== "webgpu-303"
      || !WEBGPU_TIMING_CONTROL_IDS.has(id)
    ) syncWebGpu303Pattern();
  });
}

function commitWebGpuTimingChange() {
  if (
    state.soundBank !== "acid-303"
    || activeAcidEngine !== "webgpu-303"
    || !webGpu303Engine
  ) return;
  syncWebGpu303Pattern({ force: true });
  if (!state.playing) return;
  stopTransport();
  void startTransport({ restart: true });
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

$("shape").addEventListener("change", (event) => {
  markPresetCustom();
  setRubixForm({ shapeId: event.currentTarget.value, size: state.cube.size });
});
$("rubixSize").addEventListener("input", (event) => {
  updateSizeControl(event.currentTarget.value);
});
$("rubixSize").addEventListener("change", (event) => {
  markPresetCustom();
  setRubixForm({ shapeId: state.shapeId, size: event.currentTarget.value });
});
$("soundBank").addEventListener("change", (event) => {
  void selectSoundBank(event.currentTarget.value);
});
$("acidEngine").addEventListener("change", (event) => {
  void selectAcidEngine(event.currentTarget.value);
});
$("rubixPreset").addEventListener("change", (event) => {
  void applyRubixPreset(event.currentTarget.value);
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
$("resetSound").addEventListener("click", () => {
  void resetSound();
});

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
$("tempo").addEventListener("change", commitWebGpuTimingChange);
$("swing").addEventListener("change", commitWebGpuTimingChange);
bindRange("randomTwistSpeed", "randomTwistSpeed", (value) => twistSpeedLabel(value), () => {
  if (state.randomTwists) startRandomTwists(false);
  updateSelectedUi();
});
bindRange("visibilityDynamics", "visibilityDynamics", (value) => `${Math.round(value * 100)}%`, () => {
  updateNowPlaying();
  requestDraw();
});
bindRange("stickerModulation", "stickerModulation", (value) => `${Math.round(value * 100)}%`);
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
  soundBankLifecycleGeneration += 1;
  soundBankTransportResumeRequested = false;
  audioStartPromise = null;
  webGpu303LifecycleGeneration += 1;
  webGpu303StartPromise = null;
  webGpu303PatternKey = "";
  const gpuEngine = webGpu303Engine;
  webGpu303Engine = null;
  setAudioState(false);
  void (async () => {
    await gpuEngine?.stop().catch(() => {});
    await audio.close().catch(() => {});
  })();
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  setAudioState(false);
  updateSnapshot();
});

new ResizeObserver(resizeCanvas).observe(stageWrap);

const initialParams = new URLSearchParams(location.search);
const legacyGeometryId = initialParams.get("geometry") ?? "";
const legacyCubeMatch = legacyGeometryId.match(/^cube(\d+)$/);
const legacyShapeId = legacyGeometryId === "pyramid"
  ? "diamond"
  : legacyGeometryId === "sphere"
    ? "orb"
    : legacyCubeMatch
      ? "cube"
      : null;
const initialShapeId = Object.hasOwn(SHAPES, initialParams.get("shape"))
  ? initialParams.get("shape")
  : legacyShapeId ?? DEFAULT_SHAPE_ID;
const initialSize = sanitizeRubixSize(
  initialParams.get("size") ?? legacyCubeMatch?.[1],
  DEFAULT_RUBIX_SIZE,
);
if (initialShapeId !== DEFAULT_SHAPE_ID || initialSize !== DEFAULT_RUBIX_SIZE) {
  state.presetId = "";
}
renderColorKey();
setRubixForm({ shapeId: initialShapeId, size: initialSize }, false);
setReadingMode(DEFAULT_READING_MODE, false);
updateSelectedUi();
setAudioState(false);
resizeCanvas();
updatePlayhead(0);
