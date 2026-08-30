import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

export const MOIRE_DRONE_PROCESSOR_NAME = "morphazoid-moire-drone";

const TAU = Math.PI * 2;
const DEFAULT_SAMPLE_RATE = 48_000;
const MAX_FILTER_PAIRS = 24;
const MAX_COMB_TEETH = 16;
const FILTER_BANKS = 2;
const MAX_FILTERS = MAX_FILTER_PAIRS * FILTER_BANKS;
const FABRIC_WIDTH = 8;
const FABRIC_HEIGHT = 6;
const FABRIC_NODES = FABRIC_WIDTH * FABRIC_HEIGHT;
const MAX_PROPAGATIONS = 12;
const CONTROL_INTERVAL = 16;
const DELAY_SECONDS = 0.64;
export const MOIRE_DRONE_FFT_SIZE = 1_024;
export const MOIRE_DRONE_FFT_HOP_SIZE = MOIRE_DRONE_FFT_SIZE / 4;
export const MOIRE_DRONE_FFT_LATENCY = MOIRE_DRONE_FFT_SIZE - 1;
const MOIRE_DRONE_Q_PRE_DELAY = MOIRE_DRONE_FFT_SIZE / 2;
const MOIRE_DRONE_Q_POST_DELAY = (
  MOIRE_DRONE_FFT_LATENCY - MOIRE_DRONE_Q_PRE_DELAY
);
const QUALITY_SCALES = Object.freeze([1, 0.75, 0.5, 1 / 3]);
const COLLISION_MODES = Object.freeze(["multiply", "difference", "fold"]);
export const SPECTRAL_PROPAGATION_MODES = Object.freeze([
  "drop", "harmonic", "spiral", "shock",
]);
export const SPECTRAL_SCULPT_MODES = Object.freeze([
  "notches", "ridges", "lowpass", "highpass", "bandpass", "bandstop",
]);
const SMOOTHED_PARAMETER_KEYS = Object.freeze([
  "noiseColor", "noiseCorrelation", "dust", "lowFrequency", "highFrequency",
  "resonance", "resonanceMotion", "spectralTilt", "latticeScatter",
  "filteredMix", "cascade", "glideA", "glideB", "edgeFocus",
  "fieldAAngle", "fieldADensity", "fieldASpeed", "fieldACurvature",
  "fieldADepth", "fieldBAngle", "fieldBDensity", "fieldBSpeed",
  "fieldBCurvature", "fieldBDepth", "originX", "originY", "moireDetune",
  "phaseOffset", "collisionAmount", "collisionWidth", "collisionPolarity",
  "fabricTension", "fabricDamping", "fabricInertia", "fabricDepth",
  "fabricExcitation", "fabricVibration", "fabricRate", "fabricRotation",
  "fabricSpin", "fabricPull",
  "propagationRate", "propagationSpeed", "propagationDecay",
  "propagationDepth", "propagationGain", "propagationWidth",
  "ringDensity", "autoPluckRate", "combDepth", "combWidth", "combDrift",
  "combWarp", "pluckCut",
  "spectralFilterBlend", "fftCutDepth", "fftSharpness",
  "qCutDepth", "qCharacter",
  "gestureCoupling", "gestureMemory",
  "stereoWidth", "drive", "space", "feedback",
]);

export const MOIRE_DRONE_LIMITS = Object.freeze({
  minFilterPairs: 4,
  maxFilterPairs: MAX_FILTER_PAIRS,
  maxFilters: MAX_FILTERS,
  maxCascadeFilters: MAX_FILTERS * 2,
  minFrequency: 24,
  maxFrequency: 20_000,
  maxQ: 16,
  maxGlideRate: 2,
  maxFieldSpeed: 2,
  fabricWidth: FABRIC_WIDTH,
  fabricHeight: FABRIC_HEIGHT,
  fabricNodes: FABRIC_NODES,
  maxFabricDepth: 2,
  maxFabricRate: 30,
  maxFabricSpin: 1,
  maxPropagations: MAX_PROPAGATIONS,
  maxPropagationVoices: 4,
  minPropagationRate: 1,
  maxPropagationRate: 50,
  maxPropagationSpeed: 12,
  maxAutoPluckRate: 4,
  qualityScales: QUALITY_SCALES,
});

export const MOIRE_DRONE_DEFAULTS = Object.freeze({
  noiseColor: -0.2,
  noiseCorrelation: 0.68,
  dust: 0.02,
  filterPairs: 16,
  lowFrequency: 42,
  highFrequency: 14_000,
  resonance: 0.38,
  resonanceMotion: 0.22,
  spectralTilt: -1,
  latticeScatter: 0.08,
  filteredMix: 1,
  cascade: 0.1,
  glideA: 0.035,
  glideB: -0.027,
  edgeFocus: 1.4,
  fieldAAngle: 25,
  fieldADensity: 2.4,
  fieldASpeed: 0.035,
  fieldACurvature: 0.15,
  fieldADepth: 0.2,
  fieldBAngle: -31,
  fieldBDensity: 2.58,
  fieldBSpeed: -0.028,
  fieldBCurvature: 0.38,
  fieldBDepth: 0.22,
  originX: -0.18,
  originY: 0.06,
  moireDetune: 0.12,
  phaseOffset: 0.37,
  collisionMode: "multiply",
  collisionAmount: 0.35,
  collisionWidth: 0.2,
  collisionPolarity: 0.3,
  fabricTension: 0.58,
  fabricDamping: 0.42,
  fabricInertia: 0.5,
  fabricDepth: 0.55,
  fabricExcitation: 0,
  fabricVibration: 0,
  fabricRate: 2.4,
  fabricRotation: 18,
  fabricSpin: 0,
  fabricPull: 0.72,
  propagationMode: "drop",
  propagationRate: 5,
  propagationSpeed: 1.4,
  propagationDecay: 1.5,
  propagationDepth: 0.48,
  propagationGain: 0.68,
  propagationWidth: 0.15,
  harmonicOrder: 3,
  ringDensity: 2.4,
  autoPluckRate: 0,
  propagationVoices: 1,
  combDepth: 1,
  combTeeth: 6,
  combWidth: 0.16,
  combOffset: 0.875,
  combDrift: 0.035,
  combWarp: 2,
  pluckCut: 0.82,
  spectralFilterBlend: 0.55,
  fftCutDepth: 0.9,
  fftSharpness: 0.7,
  qCutDepth: 1,
  qCharacter: 0.55,
  spectralSculptMode: "notches",
  gestureCoupling: 0.9,
  gestureMemory: 1.1,
  stereoWidth: 0.78,
  drive: 0.12,
  space: 0.1,
  feedback: 0.08,
  outputLevel: 0.52,
  freeze: false,
  seed: 0x6d2b79f5,
});

export const MOIRE_DRONE_NOISE_COLOR_CHOICES = Object.freeze([
  Object.freeze({ id: "brown", label: "Brown", value: -1 }),
  Object.freeze({ id: "pink", label: "Pink", value: -0.5 }),
  Object.freeze({ id: "white", label: "White", value: 0 }),
  Object.freeze({ id: "blue", label: "Blue", value: 1 }),
]);

const PRESET_NOISE_COLORS = Object.freeze({
  "tectonic-veil": -0.7,
  "opposed-tides": -0.48,
  "folded-horizon": 0.3,
  "spherical-choir": -0.52,
  "spiral-current": 0.42,
  "shock-repeat": 0.72,
  "still-water": -0.58,
  "missing-teeth": 0,
  "hollow-ladder": -0.42,
  "barber-notches": 0.58,
  countercomb: -0.08,
  "two-step-rain": 0.28,
  "triplet-well": -0.72,
  "morse-gate": 0.08,
  "one-hertz-tide": -0.9,
  "fifty-hertz-flicker": 0.88,
});

const FILTER_ENGINE_PRESET_SETTINGS = Object.freeze({
  "radio-aurora": Object.freeze({ spectralFilterBlend: 0.86, fftCutDepth: 0.96, fftSharpness: 0.92, qCutDepth: 0.58, qCharacter: 0.76 }),
  "velvet-interference": Object.freeze({ spectralFilterBlend: 0.18, fftCutDepth: 0.52, fftSharpness: 0.24, qCutDepth: 1, qCharacter: 0.32 }),
  "opposed-tides": Object.freeze({ spectralFilterBlend: 0.48, fftCutDepth: 0.78, fftSharpness: 0.5, qCutDepth: 0.9, qCharacter: 0.64 }),
  "glass-weather": Object.freeze({ spectralFilterBlend: 0.94, fftCutDepth: 1, fftSharpness: 1, qCutDepth: 0.38, qCharacter: 0.8 }),
  "moire-storm": Object.freeze({ spectralFilterBlend: 0.68, fftCutDepth: 0.92, fftSharpness: 0.82, qCutDepth: 0.88, qCharacter: 0.94 }),
  "frozen-collision": Object.freeze({ spectralFilterBlend: 0.06, fftCutDepth: 0.4, fftSharpness: 0.36, qCutDepth: 1, qCharacter: 0.88 }),
  "static-escalator": Object.freeze({ spectralFilterBlend: 0.14, fftCutDepth: 0.6, fftSharpness: 0.76, qCutDepth: 0.9, qCharacter: 0.82 }),
  "ion-fog": Object.freeze({ spectralFilterBlend: 0.88, fftCutDepth: 0.7, fftSharpness: 0.16, qCutDepth: 0.32, qCharacter: 0.18 }),
  "folded-horizon": Object.freeze({ spectralFilterBlend: 0.52, fftCutDepth: 0.86, fftSharpness: 0.56, qCutDepth: 0.84, qCharacter: 0.72 }),
  "still-water": Object.freeze({ spectralFilterBlend: 0.24, fftCutDepth: 0.68, fftSharpness: 0.3, qCutDepth: 1, qCharacter: 0.36 }),
  "missing-teeth": Object.freeze({ spectralFilterBlend: 1, fftCutDepth: 1, fftSharpness: 0.96, qCutDepth: 0.2, qCharacter: 0.5 }),
  "hollow-ladder": Object.freeze({ spectralFilterBlend: 0.12, fftCutDepth: 0.55, fftSharpness: 0.64, qCutDepth: 1, qCharacter: 0.9 }),
  "barber-notches": Object.freeze({ spectralFilterBlend: 0.64, fftCutDepth: 0.92, fftSharpness: 0.88, qCutDepth: 0.82, qCharacter: 0.78 }),
  countercomb: Object.freeze({ spectralFilterBlend: 0.5, fftCutDepth: 0.88, fftSharpness: 0.72, qCutDepth: 0.88, qCharacter: 0.66 }),
  "morse-gate": Object.freeze({ spectralFilterBlend: 0.96, fftCutDepth: 1, fftSharpness: 1, qCutDepth: 0.42, qCharacter: 0.74 }),
  "velvet-slots": Object.freeze({ spectralFilterBlend: 0.08, fftCutDepth: 0.48, fftSharpness: 0.18, qCutDepth: 1, qCharacter: 0.28 }),
  "air-sieve": Object.freeze({ spectralFilterBlend: 0.98, fftCutDepth: 0.9, fftSharpness: 0.94, qCutDepth: 0.24, qCharacter: 0.44 }),
});

const PRESET_SCULPT_SETTINGS = Object.freeze({
  "tectonic-veil": Object.freeze({ spectralSculptMode: "lowpass", gestureMemory: 2.8 }),
  "radio-aurora": Object.freeze({ spectralSculptMode: "ridges", gestureMemory: 0.72 }),
  "velvet-interference": Object.freeze({ spectralSculptMode: "bandpass", gestureMemory: 1.8 }),
  "opposed-tides": Object.freeze({ spectralSculptMode: "bandstop", gestureMemory: 2.2 }),
  "glass-weather": Object.freeze({ spectralSculptMode: "highpass", gestureMemory: 0.42 }),
  "moire-storm": Object.freeze({ spectralSculptMode: "notches", gestureMemory: 0.3 }),
  "frozen-collision": Object.freeze({ spectralSculptMode: "bandstop", gestureMemory: 3.6 }),
  "subduction-drone": Object.freeze({ spectralSculptMode: "lowpass", gestureMemory: 3.2 }),
  "static-escalator": Object.freeze({ spectralSculptMode: "ridges", gestureMemory: 0.58 }),
  "ion-fog": Object.freeze({ spectralSculptMode: "bandpass", gestureMemory: 2.4 }),
  "folded-horizon": Object.freeze({ spectralSculptMode: "bandstop", gestureMemory: 1.65 }),
  "parallax-furnace": Object.freeze({ spectralSculptMode: "highpass", gestureMemory: 0.9 }),
  "taut-filament": Object.freeze({ spectralSculptMode: "ridges", gestureMemory: 0.34 }),
  "spectral-sail": Object.freeze({ spectralSculptMode: "lowpass", gestureMemory: 2.1 }),
  "rotary-loom": Object.freeze({ spectralSculptMode: "bandpass", gestureMemory: 1.15 }),
  "thunder-sheet": Object.freeze({ spectralSculptMode: "lowpass", gestureMemory: 2.7 }),
  "rain-engine": Object.freeze({ spectralSculptMode: "highpass", gestureMemory: 0.46 }),
  "spherical-choir": Object.freeze({ spectralSculptMode: "ridges", gestureMemory: 2.25 }),
  "spiral-current": Object.freeze({ spectralSculptMode: "bandpass", gestureMemory: 0.8 }),
  "shock-repeat": Object.freeze({ spectralSculptMode: "highpass", gestureMemory: 0.22 }),
  "still-water": Object.freeze({ spectralSculptMode: "bandpass", gestureMemory: 3.5 }),
  "missing-teeth": Object.freeze({ spectralSculptMode: "notches", gestureMemory: 1.3 }),
  "hollow-ladder": Object.freeze({ spectralSculptMode: "ridges", gestureMemory: 1.4 }),
  "barber-notches": Object.freeze({ spectralSculptMode: "notches", gestureMemory: 0.95 }),
  countercomb: Object.freeze({ spectralSculptMode: "bandstop", gestureMemory: 1.25 }),
  "two-step-rain": Object.freeze({ spectralSculptMode: "highpass", gestureMemory: 0.52 }),
  "triplet-well": Object.freeze({ spectralSculptMode: "lowpass", gestureMemory: 2.5 }),
  "morse-gate": Object.freeze({ spectralSculptMode: "bandstop", gestureMemory: 0.18 }),
  "velvet-slots": Object.freeze({ spectralSculptMode: "bandpass", gestureMemory: 1.9 }),
  "air-sieve": Object.freeze({ spectralSculptMode: "notches", gestureMemory: 0.38 }),
  "one-hertz-tide": Object.freeze({ spectralSculptMode: "lowpass", gestureMemory: 4 }),
  "fifty-hertz-flicker": Object.freeze({ spectralSculptMode: "highpass", gestureMemory: 0.08 }),
});

function freezePreset(preset) {
  return Object.freeze({
    ...preset,
    settings: Object.freeze({
      ...preset.settings,
      noiseColor: preset.settings.noiseColor
        ?? PRESET_NOISE_COLORS[preset.id]
        ?? MOIRE_DRONE_DEFAULTS.noiseColor,
      ...(FILTER_ENGINE_PRESET_SETTINGS[preset.id] ?? {}),
      ...(PRESET_SCULPT_SETTINGS[preset.id] ?? {}),
    }),
  });
}

export const MOIRE_DRONE_PRESETS = Object.freeze([
  freezePreset({
    id: "tectonic-veil",
    label: "Tectonic veil",
    settings: {},
  }),
  freezePreset({
    id: "radio-aurora",
    label: "Radio aurora",
    settings: {
      noiseColor: 0.38, dust: 0.36, filterPairs: 20, resonance: 0.62,
      resonanceMotion: 0.48, glideA: 0.08, glideB: -0.06,
      fieldASpeed: 0.08, fieldBSpeed: -0.06, fieldADensity: 5.2,
      fieldBDensity: 5.48, collisionAmount: 0.82, moireDetune: 0.27,
      latticeScatter: 0.2, filteredMix: 1, stereoWidth: 0.96,
      propagationMode: "spiral", propagationRate: 22,
      propagationSpeed: 5.4, propagationDepth: 0.2,
      propagationGain: 0.5, harmonicOrder: 5, ringDensity: 6.2,
      autoPluckRate: 0.65, propagationVoices: 2,
      combDepth: 0.92, combTeeth: 9, combWidth: 0.1,
      combDrift: 0.18, space: 0.1, feedback: 0.06,
      outputLevel: 0.45,
    },
  }),
  freezePreset({
    id: "velvet-interference",
    label: "Velvet interference",
    settings: {
      noiseColor: -0.62, noiseCorrelation: 0.86, dust: 0,
      filterPairs: 18, lowFrequency: 28, highFrequency: 6_400,
      resonance: 0.4, spectralTilt: -3.2, latticeScatter: 0.08,
      glideA: 0.025, glideB: -0.019, fieldASpeed: 0.018,
      fieldBSpeed: -0.014, collisionAmount: 0.72, space: 0.54,
      feedback: 0.42, outputLevel: 0.5,
    },
  }),
  freezePreset({
    id: "opposed-tides",
    label: "Opposed tides",
    settings: {
      glideA: 0.18, glideB: -0.18, fieldAAngle: 8, fieldBAngle: 172,
      fieldADensity: 1.6, fieldBDensity: 1.64, fieldASpeed: 0.11,
      fieldBSpeed: -0.11, fieldACurvature: 0.56, fieldBCurvature: 0.56,
      collisionMode: "difference", collisionAmount: 0.88,
      collisionPolarity: -0.22, collisionWidth: 0.12,
      combDepth: 0.72, combTeeth: 2, combWidth: 0.2,
      combDrift: -0.025, autoPluckRate: 0,
    },
  }),
  freezePreset({
    id: "glass-weather",
    label: "Glass weather",
    settings: {
      noiseColor: 0.82, noiseCorrelation: 0.38, dust: 0.18,
      lowFrequency: 320, highFrequency: 19_000, resonance: 0.68,
      spectralTilt: 3.8, latticeScatter: 0.64, glideA: 0.14,
      glideB: -0.098, fieldADensity: 7.4, fieldBDensity: 7.72,
      collisionMode: "fold", collisionAmount: 0.7, cascade: 0.56,
      propagationMode: "harmonic", propagationRate: 34,
      propagationSpeed: 7.8, propagationDecay: 0.62,
      propagationDepth: 0.16, propagationGain: 0.44,
      harmonicOrder: 7, ringDensity: 8.4, autoPluckRate: 0.85,
      propagationVoices: 2, combDepth: 1, combTeeth: 12,
      combWidth: 0.08, combDrift: 0.4,
      drive: 0.05, space: 0.08, feedback: 0.04, outputLevel: 0.39,
    },
  }),
  freezePreset({
    id: "moire-storm",
    label: "Moiré storm",
    settings: {
      noiseColor: 0.05, noiseCorrelation: 0.94, dust: 0.24,
      filterPairs: 22, resonance: 0.72, resonanceMotion: 0.86,
      latticeScatter: 0.32, glideA: 0.48, glideB: -0.41,
      fieldAAngle: 42, fieldBAngle: -47, fieldADensity: 8.3,
      fieldBDensity: 8.72, fieldASpeed: 0.18, fieldBSpeed: -0.16,
      fieldADepth: 0.42, fieldBDepth: 0.38, moireDetune: 0.52,
      collisionAmount: 1, collisionWidth: 0.08, cascade: 0.42,
      propagationMode: "shock", propagationRate: 46,
      propagationSpeed: 10.2, propagationDecay: 0.42,
      propagationDepth: 0.35, propagationGain: 0.72,
      propagationWidth: 0.045, ringDensity: 9.6, autoPluckRate: 1.2,
      propagationVoices: 4, combDepth: 1, combTeeth: 5,
      combWidth: 0.25, combDrift: -0.22, space: 0.06, feedback: 0.04,
      outputLevel: 0.38,
    },
  }),
  freezePreset({
    id: "frozen-collision",
    label: "Frozen collision",
    settings: {
      freeze: true, noiseColor: -0.28, dust: 0, filterPairs: 20,
      resonance: 0.78, resonanceMotion: 0.34, latticeScatter: 0.04,
      glideA: 0, glideB: 0, fieldASpeed: 0, fieldBSpeed: 0,
      collisionAmount: 0.92, collisionWidth: 0.06,
      phaseOffset: 0.5, space: 0.62, feedback: 0.5,
      autoPluckRate: 0, propagationVoices: 1,
      combDepth: 1, combTeeth: 3, combWidth: 0.32,
      combOffset: 0.75, combDrift: 0,
      outputLevel: 0.38,
    },
  }),
  freezePreset({
    id: "subduction-drone",
    label: "Subduction drone",
    settings: {
      noiseColor: -0.92, noiseCorrelation: 0.9, filterPairs: 14,
      lowFrequency: 24, highFrequency: 2_600, resonance: 0.58,
      spectralTilt: -6, latticeScatter: 0.52, filteredMix: 0.82,
      glideA: -0.035, glideB: 0.021, fieldADensity: 0.72,
      fieldBDensity: 0.81, fieldASpeed: 0.012, fieldBSpeed: -0.009,
      collisionPolarity: -0.48, drive: 0.3, space: 0.64,
      feedback: 0.58, outputLevel: 0.53,
    },
  }),
  freezePreset({
    id: "static-escalator",
    label: "Static escalator",
    settings: {
      noiseColor: 0, noiseCorrelation: 1, dust: 0.04,
      resonance: 0.7, latticeScatter: 0, filteredMix: 1,
      glideA: 0.42, glideB: 0.37, edgeFocus: 2.2,
      fieldADepth: 0.08, fieldBDepth: 0.08, collisionAmount: 0.28,
      stereoWidth: 0.44, combDepth: 0.6, combTeeth: 8,
      combWidth: 0.08, combDrift: -0.2, outputLevel: 0.42,
    },
  }),
  freezePreset({
    id: "ion-fog",
    label: "Ion fog",
    settings: {
      noiseColor: -0.4, noiseCorrelation: 0.22, dust: 0.02,
      resonance: 0.24, resonanceMotion: 0.2, spectralTilt: 1,
      latticeScatter: 0.84, filteredMix: 0.66, cascade: 0,
      glideA: 0.012, glideB: -0.008, fieldADensity: 3.1,
      fieldBDensity: 3.18, fieldASpeed: 0.06, fieldBSpeed: -0.048,
      fieldADepth: 0.92, fieldBDepth: 0.88, collisionAmount: 0.34,
      combDepth: 0.3, combTeeth: 11, combWidth: 0.05,
      combDrift: 0.015, space: 0.7, feedback: 0.34, outputLevel: 0.56,
    },
  }),
  freezePreset({
    id: "folded-horizon",
    label: "Folded horizon",
    settings: {
      collisionMode: "fold", collisionAmount: 0.96,
      collisionPolarity: 0.72, collisionWidth: 0.28,
      fieldACurvature: 0.92, fieldBCurvature: 0.86,
      originX: 0.36, originY: -0.28, fieldADepth: 1.3,
      fieldBDepth: 1.1, latticeScatter: 0.36, cascade: 0.68,
      combDepth: 0.82, combTeeth: 4, combWidth: 0.18,
      combDrift: 0.07, drive: 0.22, outputLevel: 0.36,
    },
  }),
  freezePreset({
    id: "parallax-furnace",
    label: "Parallax furnace",
    settings: {
      noiseColor: -0.08, dust: 0.26, filterPairs: 18,
      lowFrequency: 36, highFrequency: 8_800, resonance: 0.66,
      resonanceMotion: 0.9, spectralTilt: -1.5,
      latticeScatter: 0.58, filteredMix: 0.9, cascade: 0.76,
      glideA: -0.21, glideB: 0.16, fieldASpeed: -0.34,
      fieldBSpeed: 0.27, collisionAmount: 0.9,
      collisionPolarity: 0.88, drive: 0.58, space: 0.46,
      feedback: 0.48, combDepth: 0, autoPluckRate: 0, outputLevel: 0.32,
    },
  }),
  freezePreset({
    id: "taut-filament",
    label: "Taut filament",
    settings: {
      noiseColor: 0.46, resonance: 0.66, resonanceMotion: 0.72,
      fabricTension: 0.94, fabricDamping: 0.18, fabricInertia: 0.24,
      fabricDepth: 0.38, fabricExcitation: 0.08, fabricVibration: 0.1,
      fabricRate: 11.6, fabricRotation: 42, fabricSpin: 0.03,
      propagationMode: "harmonic", propagationRate: 18,
      propagationSpeed: 6.2, harmonicOrder: 8, ringDensity: 7.2,
      autoPluckRate: 0.55, propagationVoices: 1,
      combDepth: 0.88, combTeeth: 8, combWidth: 0.1,
      combDrift: 0.12, latticeScatter: 0.24,
      collisionWidth: 0.09, outputLevel: 0.4,
    },
  }),
  freezePreset({
    id: "spectral-sail",
    label: "Spectral sail",
    settings: {
      noiseColor: -0.48, noiseCorrelation: 0.82, resonance: 0.38,
      fabricTension: 0.28, fabricDamping: 0.14, fabricInertia: 0.86,
      fabricDepth: 0.72, fabricExcitation: 0, fabricVibration: 0.04,
      fabricRate: 0.72, fabricRotation: -28, fabricSpin: -0.008,
      fabricPull: 1.24, glideA: 0.018, glideB: -0.012,
      propagationMode: "drop", propagationRate: 2.2,
      propagationSpeed: 0.72, propagationDecay: 4.8,
      propagationDepth: 0.24, propagationWidth: 0.24,
      ringDensity: 1.2, autoPluckRate: 0.12, propagationVoices: 1,
      combDepth: 0.74, combTeeth: 3, combWidth: 0.24,
      combDrift: 0.015, space: 0.28, feedback: 0.14, outputLevel: 0.46,
    },
  }),
  freezePreset({
    id: "rotary-loom",
    label: "Rotary loom",
    settings: {
      noiseColor: 0.12, filterPairs: 22, resonance: 0.54,
      latticeScatter: 0.7, fabricTension: 0.68, fabricDamping: 0.34,
      fabricDepth: 0.48, fabricExcitation: 0.06, fabricVibration: 0.12,
      fabricRate: 5.7, fabricRotation: 76, fabricSpin: 0.08,
      propagationMode: "spiral", propagationRate: 28,
      propagationSpeed: 8.4, propagationDecay: 0.88,
      propagationDepth: 0.22, harmonicOrder: 6,
      ringDensity: 8.8, autoPluckRate: 0.8, propagationVoices: 2,
      combDepth: 0.9, combTeeth: 7, combWidth: 0.12, combDrift: 0.26,
      fieldAAngle: -64, fieldBAngle: 71, collisionMode: "fold",
      collisionAmount: 0.86, drive: 0.18, outputLevel: 0.36,
    },
  }),
  freezePreset({
    id: "thunder-sheet",
    label: "Thunder sheet",
    settings: {
      noiseColor: -0.78, dust: 0.42, lowFrequency: 26,
      highFrequency: 7_200, resonance: 0.7, resonanceMotion: 0.94,
      fabricTension: 0.36, fabricDamping: 0.06, fabricInertia: 0.72,
      fabricDepth: 0.62, fabricExcitation: 0.08, fabricVibration: 0.08,
      fabricRate: 3.2, fabricRotation: 8, fabricSpin: -0.02,
      fabricPull: 1.1, collisionAmount: 0.68, collisionPolarity: 0.4,
      propagationMode: "shock", propagationRate: 12,
      propagationSpeed: 4.6, propagationDecay: 2.4,
      propagationDepth: 0.34, propagationGain: 0.7,
      propagationWidth: 0.16, ringDensity: 3.6, autoPluckRate: 0.35,
      propagationVoices: 1, combDepth: 1, combTeeth: 3,
      combWidth: 0.32, combDrift: -0.06,
      drive: 0.24, space: 0.12, feedback: 0.08, outputLevel: 0.31,
    },
  }),
  freezePreset({
    id: "rain-engine",
    label: "Rain engine",
    settings: {
      propagationMode: "drop", propagationRate: 14,
      propagationSpeed: 5.2, propagationDecay: 1.1,
      propagationDepth: 0.18, propagationGain: 0.5,
      propagationWidth: 0.08, ringDensity: 5.6, autoPluckRate: 1.1,
      propagationVoices: 2, combDepth: 1, combTeeth: 6,
      combWidth: 0.11, combDrift: 0.08,
      fabricTension: 0.76, fabricDamping: 0.3, noiseColor: 0.22,
      resonance: 0.48, filteredMix: 1, space: 0.08,
      feedback: 0.04, outputLevel: 0.4,
    },
  }),
  freezePreset({
    id: "spherical-choir",
    label: "Spherical choir",
    settings: {
      propagationMode: "harmonic", propagationRate: 6.5,
      propagationSpeed: 2.1, propagationDecay: 3.6,
      propagationDepth: 0.24, propagationGain: 0.58,
      propagationWidth: 0.17, harmonicOrder: 9,
      ringDensity: 4.2, autoPluckRate: 0.4, propagationVoices: 1,
      combDepth: 0.9, combTeeth: 8, combWidth: 0.14,
      combDrift: 0.04, noiseCorrelation: 0.92, resonance: 0.7,
      space: 0.16, feedback: 0.08, outputLevel: 0.36,
    },
  }),
  freezePreset({
    id: "spiral-current",
    label: "Spiral current",
    settings: {
      propagationMode: "spiral", propagationRate: 31,
      propagationSpeed: 9.2, propagationDecay: 0.78,
      propagationDepth: 0.22, propagationGain: 0.62,
      propagationWidth: 0.055, harmonicOrder: 5,
      ringDensity: 9.4, autoPluckRate: 1, propagationVoices: 2,
      combDepth: 1, combTeeth: 7, combWidth: 0.09, combDrift: 0.72,
      fabricSpin: 0.06, fieldASpeed: 0.16, fieldBSpeed: -0.14,
      latticeScatter: 0.36, drive: 0.15, outputLevel: 0.38,
    },
  }),
  freezePreset({
    id: "shock-repeat",
    label: "Shock repeat",
    settings: {
      propagationMode: "shock", propagationRate: 50,
      propagationSpeed: 12, propagationDecay: 0.24,
      propagationDepth: 0.12, propagationGain: 0.46,
      propagationWidth: 0.025, harmonicOrder: 2,
      ringDensity: 12, autoPluckRate: 1.2, propagationVoices: 1,
      combDepth: 1, combTeeth: 2, combWidth: 0.18, combDrift: 2,
      resonance: 0.58, resonanceMotion: 0.8, cascade: 0.24,
      filteredMix: 1, drive: 0.08, feedback: 0.16,
      outputLevel: 0.32,
    },
  }),
  freezePreset({
    id: "still-water",
    label: "Still Water",
    settings: {
      propagationMode: "drop", propagationRate: 2.2,
      propagationSpeed: 1, propagationDecay: 3,
      propagationDepth: 0.45, propagationGain: 0.72,
      propagationWidth: 0.22, autoPluckRate: 0, propagationVoices: 1,
      glideA: 0, glideB: 0, fieldASpeed: 0, fieldBSpeed: 0,
      fabricDepth: 0.65, fabricExcitation: 0, fabricVibration: 0, fabricSpin: 0,
      combDepth: 1, combTeeth: 4, combWidth: 0.2,
      combOffset: 0.875, combDrift: 0, combWarp: 2.5, pluckCut: 0.9,
      filteredMix: 1,
      resonance: 0.5, space: 0.04, feedback: 0.02,
    },
  }),
  freezePreset({
    id: "missing-teeth",
    label: "Missing Teeth",
    settings: {
      propagationMode: "shock", propagationRate: 36,
      propagationSpeed: 10, propagationDecay: 0.38,
      propagationDepth: 0.65, propagationGain: 0.9,
      propagationWidth: 0.06, autoPluckRate: 0, propagationVoices: 1,
      glideA: 0, glideB: 0, fieldASpeed: 0, fieldBSpeed: 0,
      fabricDepth: 0.35, fabricExcitation: 0, fabricVibration: 0, fabricSpin: 0,
      combDepth: 1, combTeeth: 1, combWidth: 0.36,
      combOffset: 0.875, combDrift: 0, combWarp: 3.4, pluckCut: 1,
      filteredMix: 1,
      resonance: 0.62, space: 0, feedback: 0,
    },
  }),
  freezePreset({
    id: "hollow-ladder",
    label: "Hollow Ladder",
    settings: {
      propagationMode: "harmonic", propagationRate: 6,
      propagationSpeed: 2.5, propagationDecay: 1.8,
      propagationDepth: 0.44, propagationGain: 0.76,
      propagationWidth: 0.13, harmonicOrder: 4,
      autoPluckRate: 0, propagationVoices: 1,
      glideA: 0.018, glideB: 0.018, fieldASpeed: 0, fieldBSpeed: 0,
      fabricExcitation: 0, fabricVibration: 0, fabricSpin: 0,
      combDepth: 1, combTeeth: 5, combWidth: 0.16,
      combDrift: 0.03, combWarp: 2.2, pluckCut: 0.86,
      filteredMix: 1, space: 0.06, feedback: 0.03,
    },
  }),
  freezePreset({
    id: "barber-notches",
    label: "Barber Notches",
    settings: {
      propagationMode: "spiral", propagationRate: 24,
      propagationSpeed: 7, propagationDecay: 0.9,
      propagationDepth: 0.38, propagationGain: 0.8,
      propagationWidth: 0.07, harmonicOrder: 5,
      autoPluckRate: 0, propagationVoices: 1,
      glideA: 0.12, glideB: 0.12, fieldASpeed: 0, fieldBSpeed: 0,
      fabricExcitation: 0, fabricVibration: 0, fabricSpin: 0,
      combDepth: 0.92, combTeeth: 12, combWidth: 0.075,
      combDrift: -0.35, combWarp: 3, pluckCut: 0.9,
      filteredMix: 1, resonance: 0.56,
      space: 0.08, feedback: 0.04,
    },
  }),
  freezePreset({
    id: "countercomb",
    label: "Countercomb",
    settings: {
      propagationMode: "harmonic", propagationRate: 7,
      propagationSpeed: 2.2, propagationDecay: 1.4,
      propagationDepth: 0.14, propagationGain: 0.42,
      harmonicOrder: 4, autoPluckRate: 0.5, propagationVoices: 2,
      glideA: 0.04, glideB: -0.04, fieldASpeed: 0, fieldBSpeed: 0,
      fabricExcitation: 0, fabricVibration: 0, fabricSpin: 0,
      combDepth: 1, combTeeth: 6, combWidth: 0.14,
      combDrift: -0.09, filteredMix: 1, space: 0.08, feedback: 0.04,
    },
  }),
  freezePreset({
    id: "two-step-rain",
    label: "Two-Step Rain",
    settings: {
      propagationMode: "drop", propagationRate: 4,
      propagationSpeed: 2.8, propagationDecay: 0.9,
      propagationDepth: 0.12, propagationGain: 0.38,
      autoPluckRate: 0.75, propagationVoices: 2,
      glideA: 0, glideB: 0, fieldASpeed: 0, fieldBSpeed: 0,
      fabricExcitation: 0, fabricVibration: 0, fabricSpin: 0,
      combDepth: 1, combTeeth: 5, combWidth: 0.18,
      combDrift: 0.045, filteredMix: 1, space: 0.05, feedback: 0.02,
    },
  }),
  freezePreset({
    id: "triplet-well",
    label: "Triplet Well",
    settings: {
      propagationMode: "harmonic", propagationRate: 3,
      propagationSpeed: 1.8, propagationDecay: 1.6,
      propagationDepth: 0.16, propagationGain: 0.46,
      harmonicOrder: 3, ringDensity: 3, autoPluckRate: 0.6,
      propagationVoices: 3, glideA: 0, glideB: 0,
      fieldASpeed: 0, fieldBSpeed: 0, fabricExcitation: 0,
      fabricVibration: 0, fabricSpin: 0, combDepth: 0.9,
      combTeeth: 3, combWidth: 0.22, combDrift: 0.02,
      filteredMix: 1, space: 0.1, feedback: 0.05,
    },
  }),
  freezePreset({
    id: "morse-gate",
    label: "Morse Gate",
    settings: {
      propagationMode: "shock", propagationRate: 8,
      propagationSpeed: 7, propagationDecay: 0.36,
      propagationDepth: 0.08, propagationGain: 0.5,
      propagationWidth: 0.055, autoPluckRate: 0.9,
      propagationVoices: 1, glideA: 0, glideB: 0,
      fieldASpeed: 0, fieldBSpeed: 0, fabricExcitation: 0,
      fabricVibration: 0, fabricSpin: 0, combDepth: 1,
      combTeeth: 4, combWidth: 0.28, combDrift: 0,
      filteredMix: 1, drive: 0, space: 0, feedback: 0,
    },
  }),
  freezePreset({
    id: "velvet-slots",
    label: "Velvet Slots",
    settings: {
      noiseColor: -0.85, lowFrequency: 24, highFrequency: 4_200,
      spectralTilt: -4, resonance: 0.44, autoPluckRate: 0,
      propagationMode: "drop", propagationRate: 1.5,
      propagationSpeed: 0.8, propagationDecay: 4.2,
      propagationGain: 0.68, propagationWidth: 0.26,
      propagationVoices: 1, propagationDepth: 0.32,
      glideA: 0.006, glideB: -0.004, fieldASpeed: 0,
      fieldBSpeed: 0, fabricExcitation: 0, fabricVibration: 0,
      fabricSpin: 0, combDepth: 1, combTeeth: 5,
      combWidth: 0.21, combDrift: 0.012, combWarp: 1.7,
      pluckCut: 0.78, filteredMix: 1,
      space: 0.12, feedback: 0.06,
    },
  }),
  freezePreset({
    id: "air-sieve",
    label: "Air Sieve",
    settings: {
      noiseColor: 0.9, lowFrequency: 420, highFrequency: 20_000,
      spectralTilt: 4.5, resonance: 0.3, autoPluckRate: 0,
      propagationMode: "shock", propagationRate: 44,
      propagationSpeed: 11, propagationDecay: 0.3,
      propagationGain: 0.84, propagationWidth: 0.045,
      propagationVoices: 1, propagationDepth: 0.5,
      glideA: 0.015, glideB: -0.012, fieldASpeed: 0,
      fieldBSpeed: 0, fabricExcitation: 0, fabricVibration: 0,
      fabricSpin: 0, combDepth: 0.58, combTeeth: 14,
      combWidth: 0.055, combDrift: 0.24, combWarp: 3.6,
      pluckCut: 0.94, filteredMix: 1,
      space: 0.04, feedback: 0.02,
    },
  }),
  freezePreset({
    id: "one-hertz-tide",
    label: "One Hertz Tide",
    settings: {
      propagationMode: "drop", propagationRate: 1,
      propagationSpeed: 0.7, propagationDecay: 4,
      propagationDepth: 0.2, propagationGain: 0.52,
      propagationWidth: 0.24, autoPluckRate: 0.18,
      propagationVoices: 1, glideA: 0, glideB: 0,
      fieldASpeed: 0, fieldBSpeed: 0, fabricExcitation: 0,
      fabricVibration: 0, fabricSpin: 0, combDepth: 1,
      combTeeth: 4, combWidth: 0.2, combDrift: 0.01,
      filteredMix: 1, space: 0.08, feedback: 0.04,
    },
  }),
  freezePreset({
    id: "fifty-hertz-flicker",
    label: "Fifty Hertz Flicker",
    settings: {
      propagationMode: "shock", propagationRate: 50,
      propagationSpeed: 12, propagationDecay: 0.4,
      propagationDepth: 0.04, propagationGain: 0.7,
      propagationWidth: 0.035, ringDensity: 12,
      autoPluckRate: 1.2, propagationVoices: 1,
      glideA: 0, glideB: 0, fieldASpeed: 0, fieldBSpeed: 0,
      fabricExcitation: 0, fabricVibration: 0, fabricSpin: 0,
      combDepth: 1, combTeeth: 2, combWidth: 0.22,
      combDrift: 0, filteredMix: 1, resonance: 0.5,
      drive: 0, space: 0, feedback: 0, outputLevel: 0.34,
    },
  }),
]);

export function clamp(value, low, high, fallback = low) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(high, Math.max(low, numeric));
}

export function wrapUnit(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return ((numeric % 1) + 1) % 1;
}

/**
 * Translate a direct manipulation of the stage into a fixed-point fabric tug.
 * Contact alone depresses the sheet; distance increases tension. Vertical
 * motion selects positive/negative displacement while horizontal motion still
 * stretches the grabbed material point.
 */
export function fabricGesturePull({
  anchorX = 0,
  anchorY = 0,
  currentX = anchorX,
  currentY = anchorY,
  contactPull = 0.18,
  velocityX = 0,
  velocityY = 0,
} = {}) {
  const tugX = clamp(anchorX, -1, 1, 0);
  const tugY = clamp(anchorY, -1, 1, 0);
  const pointerX = clamp(currentX, -1, 1, tugX);
  const pointerY = clamp(currentY, -1, 1, tugY);
  const deltaX = pointerX - tugX;
  const deltaY = pointerY - tugY;
  const distance = Math.hypot(deltaX, deltaY);
  const contact = clamp(contactPull, 0.05, 0.5, 0.18);
  const maximumDistance = Math.SQRT2 * 2;
  const distanceCurve = (
    1 - Math.exp(-Math.min(maximumDistance, distance) * 1.1)
  ) / (1 - Math.exp(-maximumDistance * 1.1));
  const magnitude = clamp(
    contact + (1 - contact) * distanceCurve,
    0,
    1,
    contact,
  );
  const verticalTravel = pointerY - tugY;
  const polarity = Math.abs(verticalTravel) >= 0.035
    ? (verticalTravel < 0 ? 1 : -1)
    : 1;
  return {
    tugX,
    tugY,
    currentX: pointerX,
    currentY: pointerY,
    deltaX,
    deltaY,
    amount: magnitude * polarity,
    distance,
    velocityX: clamp(velocityX, -16, 16, 0),
    velocityY: clamp(velocityY, -16, 16, 0),
  };
}

function combNotchAmount(distanceInCycles, width) {
  const safeDistance = Math.max(0, Number(distanceInCycles) || 0);
  const safeWidth = clamp(width, 0.02, 0.48, MOIRE_DRONE_DEFAULTS.combWidth);
  const core = safeWidth * 0.65;
  if (safeDistance <= core) return 1;
  if (safeDistance >= safeWidth) return 0;
  const transition = (safeWidth - safeDistance) / (safeWidth - core);
  return transition * transition * (3 - 2 * transition);
}

/** A stable 2D attachment point for one real output-comb gap. */
export function combToothAnchor(stage = 0, count = MOIRE_DRONE_DEFAULTS.combTeeth) {
  const safeCount = Math.round(clamp(count, 1, MAX_COMB_TEETH, MOIRE_DRONE_DEFAULTS.combTeeth));
  const safeStage = ((Math.round(Number(stage) || 0) % safeCount) + safeCount) % safeCount;
  return Object.freeze({
    x: wrapUnit(0.5 + safeStage * 0.7548776662466927) * 2 - 1,
    y: wrapUnit(0.5 + safeStage * 0.5698402909980532) * 2 - 1,
    spectralPosition: safeStage / safeCount,
  });
}

/**
 * Map local fabric/ripple displacement into a bounded log-frequency offset.
 * The 0.42/tooth cap leaves at least 16% of the original space between
 * neighboring gaps even when adjacent anchors bend in opposite directions.
 */
export function combToothWarpOffset({
  fabric = 0,
  propagation = 0,
  fabricDepth = MOIRE_DRONE_DEFAULTS.fabricDepth,
  propagationDepth = MOIRE_DRONE_DEFAULTS.propagationDepth,
  combWarp = MOIRE_DRONE_DEFAULTS.combWarp,
  octaveSpan = 8,
  teeth = MOIRE_DRONE_DEFAULTS.combTeeth,
} = {}) {
  return combToothWarpOffsetFast(
    fabric,
    propagation,
    fabricDepth,
    propagationDepth,
    combWarp,
    octaveSpan,
    teeth,
  );
}

function combToothWarpOffsetFast(
  fabric,
  propagation,
  fabricDepth,
  propagationDepth,
  combWarp,
  octaveSpan,
  teeth,
) {
  const safeTeeth = Math.round(clamp(teeth, 1, MAX_COMB_TEETH, MOIRE_DRONE_DEFAULTS.combTeeth));
  const maximum = 0.42 / safeTeeth;
  const span = Math.max(0.25, Number(octaveSpan) || 8);
  const physicalOctaves = clamp(combWarp, 0, 4, MOIRE_DRONE_DEFAULTS.combWarp) * (
    clamp(fabric, -1.2, 1.2, 0) * clamp(fabricDepth, 0, 2, MOIRE_DRONE_DEFAULTS.fabricDepth)
    + clamp(propagation, -1, 1, 0)
      * clamp(propagationDepth, 0, 2, MOIRE_DRONE_DEFAULTS.propagationDepth)
  );
  if (Math.abs(physicalOctaves) < 1e-15) return 0;
  return maximum * Math.tanh((physicalOctaves / span) / maximum);
}

/**
 * A periodic subtractive mask in normalized log-frequency space.
 * Width is the half-width of each tooth, so 0.5 would close the whole cycle.
 * The flat core deliberately returns exactly zero at full depth.
 */
export function spectralCombGate({
  spectralPosition = 0,
  phase = 0,
  teeth = MOIRE_DRONE_DEFAULTS.combTeeth,
  width = MOIRE_DRONE_DEFAULTS.combWidth,
  depth = MOIRE_DRONE_DEFAULTS.combDepth,
  influence = 1,
} = {}) {
  const safeTeeth = Math.round(clamp(teeth, 1, 16, MOIRE_DRONE_DEFAULTS.combTeeth));
  const safeWidth = clamp(width, 0.02, 0.48, MOIRE_DRONE_DEFAULTS.combWidth);
  const clampedDepth = clamp(depth, 0, 1, MOIRE_DRONE_DEFAULTS.combDepth);
  const safeDepth = clampedDepth >= 0.999 ? 1 : clampedDepth;
  const safeInfluence = clamp(influence, 0, 1, 1);
  if (safeDepth === 0 || safeInfluence === 0) return 1;
  const cycle = wrapUnit(
    clamp(spectralPosition, -1_000_000, 1_000_000, 0) * safeTeeth
      + clamp(phase, -1_000_000, 1_000_000, 0),
  );
  const distance = Math.min(cycle, 1 - cycle);
  const notch = combNotchAmount(distance, safeWidth);
  return clamp(1 - safeDepth * safeInfluence * notch, 0, 1, 1);
}

/** A subtractive mask whose individual gaps may be bent away from a ruler. */
function warpedCombNotchAmount(
  spectralPosition,
  toothPositions,
  toothWidths,
  teeth,
  width,
  distanceReductionCycles = 0,
) {
  const position = wrapUnit(clamp(spectralPosition, -1_000_000, 1_000_000, 0));
  let notch = 0;
  let validCenters = 0;
  for (let stage = 0; stage < teeth; stage += 1) {
    const center = Number(toothPositions?.[stage]);
    if (!Number.isFinite(center)) continue;
    validCenters += 1;
    const stageWidth = toothWidths
      ? clamp(toothWidths[stage], 0.02, 0.48, width)
      : width;
    notch = Math.max(
      notch,
      combNotchAmount(
        Math.max(
          0,
          wrappedDistance(position, center) * teeth - distanceReductionCycles,
        ),
        stageWidth,
      ),
    );
    if (notch >= 1) break;
  }
  return validCenters > 0 ? notch : 0;
}

export function spectralWarpedCombGate({
  spectralPosition = 0,
  toothPositions = [],
  toothWidths = null,
  teeth = MOIRE_DRONE_DEFAULTS.combTeeth,
  width = MOIRE_DRONE_DEFAULTS.combWidth,
  depth = MOIRE_DRONE_DEFAULTS.combDepth,
  influence = 1,
} = {}) {
  const safeTeeth = Math.round(clamp(teeth, 1, MAX_COMB_TEETH, MOIRE_DRONE_DEFAULTS.combTeeth));
  const clampedDepth = clamp(depth, 0, 1, MOIRE_DRONE_DEFAULTS.combDepth);
  const safeDepth = clampedDepth >= 0.999 ? 1 : clampedDepth;
  const safeInfluence = clamp(influence, 0, 1, 1);
  if (safeDepth === 0 || safeInfluence === 0) return 1;
  const safeWidth = clamp(width, 0.02, 0.48, MOIRE_DRONE_DEFAULTS.combWidth);
  return spectralWarpedCombGateFast(
    spectralPosition,
    toothPositions,
    toothWidths,
    safeTeeth,
    safeWidth,
    safeDepth,
    safeInfluence,
  );
}

function spectralWarpedCombGateFast(
  spectralPosition,
  toothPositions,
  toothWidths,
  teeth,
  width,
  depth,
  influence = 1,
) {
  if (depth === 0 || influence === 0) return 1;
  const notch = warpedCombNotchAmount(
    spectralPosition,
    toothPositions,
    toothWidths,
    teeth,
    width,
  );
  return clamp(1 - depth * influence * notch, 0, 1, 1);
}

const SPECTRAL_SCULPT_MODE_INDEX = Object.freeze({
  notches: 0,
  ridges: 1,
  lowpass: 2,
  highpass: 3,
  bandpass: 4,
  bandstop: 5,
});

function spectralSculptModeIndex(mode) {
  return SPECTRAL_SCULPT_MODE_INDEX[String(mode)]
    ?? SPECTRAL_SCULPT_MODE_INDEX.notches;
}

function smoothUnit(value) {
  const unit = Math.max(0, Math.min(1, Number(value) || 0));
  return unit * unit * (3 - 2 * unit);
}

function reflectUnit(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  const reflected = ((numeric % 2) + 2) % 2;
  return reflected <= 1 ? reflected : 2 - reflected;
}

function spectralBandAmountFast(
  spectralPosition,
  focus,
  width,
  sharpness,
  binFootprint = 0,
) {
  const safeWidth = clamp(width, 0.02, 0.48, MOIRE_DRONE_DEFAULTS.combWidth);
  const safeSharpness = clamp(sharpness, 0, 1, MOIRE_DRONE_DEFAULTS.fftSharpness);
  const distance = Math.abs(spectralPosition - clamp(focus, 0, 1, 0.5));
  const transition = Math.max(
    Math.max(0, Number(binFootprint) || 0),
    safeWidth * (0.08 + (1 - safeSharpness) * 0.72),
  );
  const core = Math.max(0, safeWidth - transition);
  if (distance <= core) return 1;
  if (distance >= safeWidth + transition) return 0;
  return 1 - smoothUnit((distance - core) / Math.max(1e-9, transition * 2));
}

function spectralShelfAmountFast(
  spectralPosition,
  focus,
  width,
  sharpness,
  highpass = false,
  binFootprint = 0,
) {
  const safeWidth = clamp(width, 0.02, 0.48, MOIRE_DRONE_DEFAULTS.combWidth);
  const safeSharpness = clamp(sharpness, 0, 1, MOIRE_DRONE_DEFAULTS.fftSharpness);
  const transition = Math.max(
    Math.max(0, Number(binFootprint) || 0),
    safeWidth * (0.08 + (1 - safeSharpness) * 0.72),
  );
  const start = clamp(focus, 0, 1, 0.5) - transition;
  const amount = smoothUnit(
    (spectralPosition - start) / Math.max(1e-9, transition * 2),
  );
  return highpass ? amount : 1 - amount;
}

function spectralFftMaskGainFast(
  frequency,
  low,
  high,
  toothPositions,
  toothWidths,
  teeth,
  depth,
  sharpness,
  binWidth = 0,
  modeIndex = SPECTRAL_SCULPT_MODE_INDEX.notches,
  focus = MOIRE_DRONE_DEFAULTS.combOffset,
  width = MOIRE_DRONE_DEFAULTS.combWidth,
) {
  const safeBinWidth = Math.max(0, Number(binWidth) || 0);
  if (!Number.isFinite(frequency) || frequency < 0) return 1;
  const isPeriodic = modeIndex === SPECTRAL_SCULPT_MODE_INDEX.notches
    || modeIndex === SPECTRAL_SCULPT_MODE_INDEX.ridges;
  if (
    isPeriodic
    && (
      frequency + safeBinWidth * 0.5 < low
      || frequency - safeBinWidth * 0.5 > high
    )
  ) return 1;
  const octaveSpan = Math.max(0.25, Math.log2(high / low));
  const spectralPosition = Math.log2(Math.max(1e-9, frequency) / low) / octaveSpan;
  const binLow = Math.max(low, frequency - safeBinWidth * 0.5);
  const binHigh = Math.min(high, frequency + safeBinWidth * 0.5);
  const normalizedBinFootprint = binHigh > binLow
    ? Math.log2(binHigh / binLow) / octaveSpan * 0.5
    : 0;
  if (!isPeriodic) {
    let passAmount;
    if (modeIndex === SPECTRAL_SCULPT_MODE_INDEX.lowpass) {
      passAmount = spectralShelfAmountFast(
        spectralPosition,
        focus,
        width,
        sharpness,
        false,
        normalizedBinFootprint,
      );
    } else if (modeIndex === SPECTRAL_SCULPT_MODE_INDEX.highpass) {
      passAmount = spectralShelfAmountFast(
        spectralPosition,
        focus,
        width,
        sharpness,
        true,
        normalizedBinFootprint,
      );
    } else {
      const band = spectralBandAmountFast(
        spectralPosition,
        focus,
        width,
        sharpness,
        normalizedBinFootprint,
      );
      passAmount = modeIndex === SPECTRAL_SCULPT_MODE_INDEX.bandstop
        ? 1 - band
        : band;
    }
    return clamp(1 - depth * (1 - passAmount), 0, 1, 1);
  }
  const binFootprintCycles = binHigh > binLow
    ? Math.log2(binHigh / binLow) / octaveSpan * teeth * 0.5
    : 0;
  const smoothNotch = warpedCombNotchAmount(
    spectralPosition,
    toothPositions,
    toothWidths,
    teeth,
    MOIRE_DRONE_DEFAULTS.combWidth,
    binFootprintCycles,
  );
  let shapedNotch = smoothNotch;
  if (smoothNotch > 0 && smoothNotch < 1) {
    const contrast = 1 + sharpness * 12;
    const cutPower = smoothNotch ** contrast;
    const passPower = (1 - smoothNotch) ** contrast;
    shapedNotch = cutPower / Math.max(1e-15, cutPower + passPower);
  }
  if (modeIndex === SPECTRAL_SCULPT_MODE_INDEX.ridges) {
    const ridgeBoost = 0.5 + sharpness * 1.5;
    return clamp(1 + depth * shapedNotch * ridgeBoost, 1, 3, 1);
  }
  return clamp(1 - depth * shapedNotch, 0, 1, 1);
}

/** Convert the shared warped gap geometry into a true FFT-bin gain. */
export function spectralFftMaskGain({
  frequency = 0,
  lowFrequency = MOIRE_DRONE_DEFAULTS.lowFrequency,
  highFrequency = MOIRE_DRONE_DEFAULTS.highFrequency,
  toothPositions = [],
  toothWidths = null,
  teeth = MOIRE_DRONE_DEFAULTS.combTeeth,
  depth = MOIRE_DRONE_DEFAULTS.fftCutDepth,
  sharpness = MOIRE_DRONE_DEFAULTS.fftSharpness,
  binWidth = 0,
  mode = MOIRE_DRONE_DEFAULTS.spectralSculptMode,
  focus = MOIRE_DRONE_DEFAULTS.combOffset,
  width = MOIRE_DRONE_DEFAULTS.combWidth,
} = {}) {
  const low = clamp(lowFrequency, 20, 2_000, MOIRE_DRONE_DEFAULTS.lowFrequency);
  const high = clamp(
    highFrequency,
    Math.max(240, low * 1.25),
    MOIRE_DRONE_LIMITS.maxFrequency,
    MOIRE_DRONE_DEFAULTS.highFrequency,
  );
  const safeFrequency = Number(frequency);
  const safeBinWidth = Math.max(0, Number(binWidth) || 0);
  const modeIndex = spectralSculptModeIndex(mode);
  if (!Number.isFinite(safeFrequency) || safeFrequency < 0) {
    return 1;
  }
  return spectralFftMaskGainFast(
    safeFrequency,
    low,
    high,
    toothPositions,
    toothWidths,
    Math.round(clamp(teeth, 1, MAX_COMB_TEETH, MOIRE_DRONE_DEFAULTS.combTeeth)),
    clamp(depth, 0, 1, MOIRE_DRONE_DEFAULTS.fftCutDepth),
    clamp(sharpness, 0, 1, MOIRE_DRONE_DEFAULTS.fftSharpness),
    safeBinWidth,
    modeIndex,
    clamp(focus, 0, 1, MOIRE_DRONE_DEFAULTS.combOffset),
    clamp(width, 0.02, 0.48, MOIRE_DRONE_DEFAULTS.combWidth),
  );
}

function moireFftInPlace(real, imaginary, inverse = false) {
  const length = real?.length ?? 0;
  if (
    length < 2
    || imaginary?.length !== length
    || (length & (length - 1)) !== 0
  ) {
    throw new RangeError("FFT arrays must have the same power-of-two length.");
  }
  let reversed = 0;
  for (let index = 1; index < length; index += 1) {
    let bit = length >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      const realValue = real[index];
      real[index] = real[reversed];
      real[reversed] = realValue;
      const imaginaryValue = imaginary[index];
      imaginary[index] = imaginary[reversed];
      imaginary[reversed] = imaginaryValue;
    }
  }
  for (let width = 2; width <= length; width *= 2) {
    const angle = (inverse ? TAU : -TAU) / width;
    const rootReal = Math.cos(angle);
    const rootImaginary = Math.sin(angle);
    const halfWidth = width / 2;
    for (let offset = 0; offset < length; offset += width) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < halfWidth; index += 1) {
        const even = offset + index;
        const odd = even + halfWidth;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
        const nextReal = twiddleReal * rootReal - twiddleImaginary * rootImaginary;
        twiddleImaginary = twiddleReal * rootImaginary + twiddleImaginary * rootReal;
        twiddleReal = nextReal;
      }
    }
  }
  if (inverse) {
    for (let index = 0; index < length; index += 1) {
      real[index] /= length;
      imaginary[index] /= length;
    }
  }
}

/**
 * Allocation-free stereo STFT filter. A periodic Hann on both sides with
 * N/4 hops sums to 1.5, so 2/3 synthesis gain gives exact unity overlap-add
 * at a fixed N-1 sample latency while keeping each bin spectrally compact.
 */
export class SpectralFftFilter {
  constructor({
    sampleRate = DEFAULT_SAMPLE_RATE,
    fftSize = MOIRE_DRONE_FFT_SIZE,
  } = {}) {
    const requestedSize = Math.round(Number(fftSize) || MOIRE_DRONE_FFT_SIZE);
    if (
      requestedSize < 64
      || requestedSize > 2_048
      || (requestedSize & (requestedSize - 1)) !== 0
    ) {
      throw new RangeError("Spectral FFT size must be a power of two from 64 to 2048.");
    }
    this.sampleRate = Math.max(8_000, Number(sampleRate) || DEFAULT_SAMPLE_RATE);
    this.fftSize = requestedSize;
    this.hopSize = requestedSize / 4;
    this.latencySamples = requestedSize - 1;
    this.mask = requestedSize - 1;
    this.outputMask = requestedSize * 2 - 1;
    this.window = new Float64Array(requestedSize);
    for (let index = 0; index < requestedSize; index += 1) {
      this.window[index] = 0.5 - 0.5 * Math.cos(TAU * index / requestedSize);
    }
    this.inputLeft = new Float64Array(requestedSize);
    this.inputRight = new Float64Array(requestedSize);
    this.realLeft = new Float64Array(requestedSize);
    this.imaginaryLeft = new Float64Array(requestedSize);
    this.realRight = new Float64Array(requestedSize);
    this.imaginaryRight = new Float64Array(requestedSize);
    this.outputLeftRing = new Float64Array(requestedSize * 2);
    this.outputRightRing = new Float64Array(requestedSize * 2);
    this.binGains = new Float64Array(requestedSize / 2 + 1);
    this.binGains.fill(1);
    this.toothPositions = new Float64Array(MAX_COMB_TEETH);
    this.toothWidths = new Float64Array(MAX_COMB_TEETH);
    this.inputWrite = 0;
    this.outputRead = 0;
    this.hopCounter = 0;
    this.outputLeft = 0;
    this.outputRight = 0;
    this.lowFrequency = MOIRE_DRONE_DEFAULTS.lowFrequency;
    this.highFrequency = MOIRE_DRONE_DEFAULTS.highFrequency;
    this.teeth = MOIRE_DRONE_DEFAULTS.combTeeth;
    this.depth = MOIRE_DRONE_DEFAULTS.fftCutDepth;
    this.sharpness = MOIRE_DRONE_DEFAULTS.fftSharpness;
    this.modeIndex = spectralSculptModeIndex(MOIRE_DRONE_DEFAULTS.spectralSculptMode);
    this.focus = MOIRE_DRONE_DEFAULTS.combOffset;
    this.width = MOIRE_DRONE_DEFAULTS.combWidth;
  }

  setMask({
    lowFrequency = this.lowFrequency,
    highFrequency = this.highFrequency,
    toothPositions = this.toothPositions,
    toothWidths = this.toothWidths,
    teeth = this.teeth,
    depth = this.depth,
    sharpness = this.sharpness,
    mode = SPECTRAL_SCULPT_MODES[this.modeIndex],
    focus = this.focus,
    width = this.width,
  } = {}) {
    return this.setMaskState(
      lowFrequency,
      highFrequency,
      toothPositions,
      toothWidths,
      teeth,
      depth,
      sharpness,
      mode,
      focus,
      width,
    );
  }

  setMaskState(
    lowFrequency,
    highFrequency,
    toothPositions,
    toothWidths,
    teeth,
    depth,
    sharpness,
    mode = SPECTRAL_SCULPT_MODES[this.modeIndex],
    focus = this.focus,
    width = this.width,
  ) {
    this.lowFrequency = clamp(lowFrequency, 20, 2_000, this.lowFrequency);
    this.highFrequency = clamp(
      highFrequency,
      Math.max(240, this.lowFrequency * 1.25),
      MOIRE_DRONE_LIMITS.maxFrequency,
      this.highFrequency,
    );
    this.teeth = Math.round(clamp(teeth, 1, MAX_COMB_TEETH, this.teeth));
    this.depth = clamp(depth, 0, 1, this.depth);
    this.sharpness = clamp(sharpness, 0, 1, this.sharpness);
    this.modeIndex = spectralSculptModeIndex(mode);
    this.focus = clamp(focus, 0, 1, this.focus);
    this.width = clamp(width, 0.02, 0.48, this.width);
    for (let stage = 0; stage < MAX_COMB_TEETH; stage += 1) {
      const position = Number(toothPositions?.[stage]);
      const width = Number(toothWidths?.[stage]);
      this.toothPositions[stage] = Number.isFinite(position) ? wrapUnit(position) : 0;
      this.toothWidths[stage] = Number.isFinite(width)
        ? clamp(width, 0.02, 0.48, MOIRE_DRONE_DEFAULTS.combWidth)
        : MOIRE_DRONE_DEFAULTS.combWidth;
    }
    return this;
  }

  reset() {
    this.inputLeft.fill(0);
    this.inputRight.fill(0);
    this.realLeft.fill(0);
    this.imaginaryLeft.fill(0);
    this.realRight.fill(0);
    this.imaginaryRight.fill(0);
    this.outputLeftRing.fill(0);
    this.outputRightRing.fill(0);
    this.binGains.fill(1);
    this.inputWrite = 0;
    this.outputRead = 0;
    this.hopCounter = 0;
    this.outputLeft = 0;
    this.outputRight = 0;
  }

  renderFrame() {
    const size = this.fftSize;
    for (let index = 0; index < size; index += 1) {
      const source = (this.inputWrite + index) & this.mask;
      const window = this.window[index];
      this.realLeft[index] = this.inputLeft[source] * window;
      this.imaginaryLeft[index] = 0;
      this.realRight[index] = this.inputRight[source] * window;
      this.imaginaryRight[index] = 0;
    }
    moireFftInPlace(this.realLeft, this.imaginaryLeft);
    moireFftInPlace(this.realRight, this.imaginaryRight);
    const halfSize = size / 2;
    let inputEnergy = 0;
    let sculptedEnergy = 0;
    for (let bin = 0; bin <= halfSize; bin += 1) {
      const gain = spectralFftMaskGainFast(
        bin * this.sampleRate / size,
        this.lowFrequency,
        this.highFrequency,
        this.toothPositions,
        this.toothWidths,
        this.teeth,
        this.depth,
        this.sharpness,
        this.sampleRate / size,
        this.modeIndex,
        this.focus,
        this.width,
      );
      this.binGains[bin] = gain;
      if (this.modeIndex === SPECTRAL_SCULPT_MODE_INDEX.ridges) {
        const binEnergy = (
          this.realLeft[bin] * this.realLeft[bin]
          + this.imaginaryLeft[bin] * this.imaginaryLeft[bin]
          + this.realRight[bin] * this.realRight[bin]
          + this.imaginaryRight[bin] * this.imaginaryRight[bin]
        );
        const symmetryWeight = bin > 0 && bin < halfSize ? 2 : 1;
        inputEnergy += binEnergy * symmetryWeight;
        sculptedEnergy += binEnergy * gain * gain * symmetryWeight;
      }
    }
    const ridgeHeadroom = this.modeIndex === SPECTRAL_SCULPT_MODE_INDEX.ridges
      && sculptedEnergy > inputEnergy
      ? clamp(Math.sqrt(inputEnergy / Math.max(1e-18, sculptedEnergy)), 0.45, 1, 1)
      : 1;
    for (let bin = 0; bin <= halfSize; bin += 1) {
      const gain = this.binGains[bin] * ridgeHeadroom;
      this.realLeft[bin] *= gain;
      this.imaginaryLeft[bin] *= gain;
      this.realRight[bin] *= gain;
      this.imaginaryRight[bin] *= gain;
      if (bin > 0 && bin < halfSize) {
        const mirror = size - bin;
        this.realLeft[mirror] *= gain;
        this.imaginaryLeft[mirror] *= gain;
        this.realRight[mirror] *= gain;
        this.imaginaryRight[mirror] *= gain;
      }
    }
    moireFftInPlace(this.realLeft, this.imaginaryLeft, true);
    moireFftInPlace(this.realRight, this.imaginaryRight, true);
    for (let index = 0; index < size; index += 1) {
      const output = (this.outputRead + index) & this.outputMask;
      const synthesis = this.window[index] * (2 / 3);
      this.outputLeftRing[output] += this.realLeft[index] * synthesis;
      this.outputRightRing[output] += this.realRight[index] * synthesis;
    }
  }

  processSample(left = 0, right = left) {
    this.inputLeft[this.inputWrite] = Number.isFinite(left) ? left : 0;
    this.inputRight[this.inputWrite] = Number.isFinite(right) ? right : 0;
    this.inputWrite = (this.inputWrite + 1) & this.mask;
    this.hopCounter += 1;
    if (this.hopCounter >= this.hopSize) {
      this.hopCounter = 0;
      this.renderFrame();
    }
    const outputLeft = this.outputLeftRing[this.outputRead];
    const outputRight = this.outputRightRing[this.outputRead];
    this.outputLeftRing[this.outputRead] = 0;
    this.outputRightRing[this.outputRead] = 0;
    this.outputRead = (this.outputRead + 1) & this.outputMask;
    if (!Number.isFinite(outputLeft) || !Number.isFinite(outputRight)) {
      this.reset();
      return this;
    }
    this.outputLeft = outputLeft;
    this.outputRight = outputRight;
    return this;
  }
}

function sanitizeSeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MOIRE_DRONE_DEFAULTS.seed;
  const seed = Math.trunc(numeric) >>> 0;
  return seed || MOIRE_DRONE_DEFAULTS.seed;
}

export function sanitizeMoireDroneParams(params = {}) {
  const lowFrequency = clamp(
    params.lowFrequency,
    MOIRE_DRONE_LIMITS.minFrequency,
    2_000,
    MOIRE_DRONE_DEFAULTS.lowFrequency,
  );
  const highFrequency = clamp(
    params.highFrequency,
    Math.max(240, lowFrequency * 1.25),
    MOIRE_DRONE_LIMITS.maxFrequency,
    Math.max(MOIRE_DRONE_DEFAULTS.highFrequency, lowFrequency * 1.25),
  );
  const requestedMode = String(params.collisionMode ?? "");
  const collisionMode = COLLISION_MODES.includes(requestedMode)
    ? requestedMode
    : MOIRE_DRONE_DEFAULTS.collisionMode;
  const requestedPropagationMode = String(params.propagationMode ?? "");
  const propagationMode = SPECTRAL_PROPAGATION_MODES.includes(requestedPropagationMode)
    ? requestedPropagationMode
    : MOIRE_DRONE_DEFAULTS.propagationMode;
  const requestedSculptMode = String(params.spectralSculptMode ?? "");
  const spectralSculptMode = SPECTRAL_SCULPT_MODES.includes(requestedSculptMode)
    ? requestedSculptMode
    : MOIRE_DRONE_DEFAULTS.spectralSculptMode;

  return Object.freeze({
    noiseColor: clamp(params.noiseColor, -1, 1, MOIRE_DRONE_DEFAULTS.noiseColor),
    noiseCorrelation: clamp(params.noiseCorrelation, 0, 1, MOIRE_DRONE_DEFAULTS.noiseCorrelation),
    dust: clamp(params.dust, 0, 1, MOIRE_DRONE_DEFAULTS.dust),
    filterPairs: Math.round(clamp(params.filterPairs, 4, MAX_FILTER_PAIRS, MOIRE_DRONE_DEFAULTS.filterPairs)),
    lowFrequency,
    highFrequency,
    resonance: clamp(params.resonance, 0, 1, MOIRE_DRONE_DEFAULTS.resonance),
    resonanceMotion: clamp(params.resonanceMotion, 0, 1, MOIRE_DRONE_DEFAULTS.resonanceMotion),
    spectralTilt: clamp(params.spectralTilt, -9, 9, MOIRE_DRONE_DEFAULTS.spectralTilt),
    latticeScatter: clamp(params.latticeScatter, 0, 1, MOIRE_DRONE_DEFAULTS.latticeScatter),
    filteredMix: clamp(params.filteredMix, 0, 1, MOIRE_DRONE_DEFAULTS.filteredMix),
    cascade: clamp(params.cascade, 0, 1, MOIRE_DRONE_DEFAULTS.cascade),
    glideA: clamp(params.glideA, -2, 2, MOIRE_DRONE_DEFAULTS.glideA),
    glideB: clamp(params.glideB, -2, 2, MOIRE_DRONE_DEFAULTS.glideB),
    edgeFocus: clamp(params.edgeFocus, 0.5, 4, MOIRE_DRONE_DEFAULTS.edgeFocus),
    fieldAAngle: clamp(params.fieldAAngle, -180, 180, MOIRE_DRONE_DEFAULTS.fieldAAngle),
    fieldADensity: clamp(params.fieldADensity, 0.25, 12, MOIRE_DRONE_DEFAULTS.fieldADensity),
    fieldASpeed: clamp(params.fieldASpeed, -2, 2, MOIRE_DRONE_DEFAULTS.fieldASpeed),
    fieldACurvature: clamp(params.fieldACurvature, 0, 1, MOIRE_DRONE_DEFAULTS.fieldACurvature),
    fieldADepth: clamp(params.fieldADepth, 0, 2, MOIRE_DRONE_DEFAULTS.fieldADepth),
    fieldBAngle: clamp(params.fieldBAngle, -180, 180, MOIRE_DRONE_DEFAULTS.fieldBAngle),
    fieldBDensity: clamp(params.fieldBDensity, 0.25, 12, MOIRE_DRONE_DEFAULTS.fieldBDensity),
    fieldBSpeed: clamp(params.fieldBSpeed, -2, 2, MOIRE_DRONE_DEFAULTS.fieldBSpeed),
    fieldBCurvature: clamp(params.fieldBCurvature, 0, 1, MOIRE_DRONE_DEFAULTS.fieldBCurvature),
    fieldBDepth: clamp(params.fieldBDepth, 0, 2, MOIRE_DRONE_DEFAULTS.fieldBDepth),
    originX: clamp(params.originX, -1, 1, MOIRE_DRONE_DEFAULTS.originX),
    originY: clamp(params.originY, -1, 1, MOIRE_DRONE_DEFAULTS.originY),
    moireDetune: clamp(params.moireDetune, -1, 1, MOIRE_DRONE_DEFAULTS.moireDetune),
    phaseOffset: wrapUnit(clamp(params.phaseOffset, 0, 1, MOIRE_DRONE_DEFAULTS.phaseOffset)),
    collisionMode,
    collisionAmount: clamp(params.collisionAmount, 0, 1, MOIRE_DRONE_DEFAULTS.collisionAmount),
    collisionWidth: clamp(params.collisionWidth, 0.03, 1, MOIRE_DRONE_DEFAULTS.collisionWidth),
    collisionPolarity: clamp(params.collisionPolarity, -1, 1, MOIRE_DRONE_DEFAULTS.collisionPolarity),
    fabricTension: clamp(params.fabricTension, 0, 1, MOIRE_DRONE_DEFAULTS.fabricTension),
    fabricDamping: clamp(params.fabricDamping, 0, 1, MOIRE_DRONE_DEFAULTS.fabricDamping),
    fabricInertia: clamp(params.fabricInertia, 0, 1, MOIRE_DRONE_DEFAULTS.fabricInertia),
    fabricDepth: clamp(params.fabricDepth, 0, 2, MOIRE_DRONE_DEFAULTS.fabricDepth),
    fabricExcitation: clamp(params.fabricExcitation, 0, 1, MOIRE_DRONE_DEFAULTS.fabricExcitation),
    fabricVibration: clamp(params.fabricVibration, 0, 1, MOIRE_DRONE_DEFAULTS.fabricVibration),
    fabricRate: clamp(params.fabricRate, 0.05, 30, MOIRE_DRONE_DEFAULTS.fabricRate),
    fabricRotation: clamp(params.fabricRotation, -180, 180, MOIRE_DRONE_DEFAULTS.fabricRotation),
    fabricSpin: clamp(params.fabricSpin, -1, 1, MOIRE_DRONE_DEFAULTS.fabricSpin),
    fabricPull: clamp(params.fabricPull, 0, 2, MOIRE_DRONE_DEFAULTS.fabricPull),
    propagationMode,
    propagationRate: clamp(params.propagationRate, 1, 50, MOIRE_DRONE_DEFAULTS.propagationRate),
    propagationSpeed: clamp(params.propagationSpeed, 0.1, 12, MOIRE_DRONE_DEFAULTS.propagationSpeed),
    propagationDecay: clamp(params.propagationDecay, 0.08, 8, MOIRE_DRONE_DEFAULTS.propagationDecay),
    propagationDepth: clamp(params.propagationDepth, 0, 2, MOIRE_DRONE_DEFAULTS.propagationDepth),
    propagationGain: clamp(params.propagationGain, 0, 1, MOIRE_DRONE_DEFAULTS.propagationGain),
    propagationWidth: clamp(params.propagationWidth, 0.02, 0.6, MOIRE_DRONE_DEFAULTS.propagationWidth),
    harmonicOrder: Math.round(clamp(params.harmonicOrder, 0, 12, MOIRE_DRONE_DEFAULTS.harmonicOrder)),
    ringDensity: clamp(params.ringDensity, 0.25, 12, MOIRE_DRONE_DEFAULTS.ringDensity),
    autoPluckRate: clamp(
      params.autoPluckRate,
      0,
      MOIRE_DRONE_LIMITS.maxAutoPluckRate,
      MOIRE_DRONE_DEFAULTS.autoPluckRate,
    ),
    propagationVoices: Math.round(clamp(
      params.propagationVoices,
      1,
      MOIRE_DRONE_LIMITS.maxPropagationVoices,
      MOIRE_DRONE_DEFAULTS.propagationVoices,
    )),
    combDepth: clamp(params.combDepth, 0, 1, MOIRE_DRONE_DEFAULTS.combDepth),
    combTeeth: Math.round(clamp(params.combTeeth, 1, 16, MOIRE_DRONE_DEFAULTS.combTeeth)),
    combWidth: clamp(params.combWidth, 0.02, 0.48, MOIRE_DRONE_DEFAULTS.combWidth),
    combOffset: wrapUnit(clamp(params.combOffset, 0, 1, MOIRE_DRONE_DEFAULTS.combOffset)),
    combDrift: clamp(params.combDrift, -2, 2, MOIRE_DRONE_DEFAULTS.combDrift),
    combWarp: clamp(params.combWarp, 0, 4, MOIRE_DRONE_DEFAULTS.combWarp),
    pluckCut: clamp(params.pluckCut, 0, 1, MOIRE_DRONE_DEFAULTS.pluckCut),
    spectralFilterBlend: clamp(
      params.spectralFilterBlend,
      0,
      1,
      MOIRE_DRONE_DEFAULTS.spectralFilterBlend,
    ),
    fftCutDepth: clamp(params.fftCutDepth, 0, 1, MOIRE_DRONE_DEFAULTS.fftCutDepth),
    fftSharpness: clamp(params.fftSharpness, 0, 1, MOIRE_DRONE_DEFAULTS.fftSharpness),
    qCutDepth: clamp(params.qCutDepth, 0, 1, MOIRE_DRONE_DEFAULTS.qCutDepth),
    qCharacter: clamp(params.qCharacter, 0, 1, MOIRE_DRONE_DEFAULTS.qCharacter),
    spectralSculptMode,
    gestureCoupling: clamp(
      params.gestureCoupling,
      0,
      1,
      MOIRE_DRONE_DEFAULTS.gestureCoupling,
    ),
    gestureMemory: clamp(
      params.gestureMemory,
      0.08,
      4,
      MOIRE_DRONE_DEFAULTS.gestureMemory,
    ),
    stereoWidth: clamp(params.stereoWidth, 0, 1, MOIRE_DRONE_DEFAULTS.stereoWidth),
    drive: clamp(params.drive, 0, 1, MOIRE_DRONE_DEFAULTS.drive),
    space: clamp(params.space, 0, 1, MOIRE_DRONE_DEFAULTS.space),
    feedback: clamp(params.feedback, 0, 0.72, MOIRE_DRONE_DEFAULTS.feedback),
    outputLevel: clamp(params.outputLevel, 0, 0.72, MOIRE_DRONE_DEFAULTS.outputLevel),
    freeze: Boolean(params.freeze),
    seed: sanitizeSeed(params.seed),
  });
}

export function shepardWindow(position, edgeFocus = 1.4) {
  const phase = wrapUnit(position);
  const shape = Math.max(0.5, Number(edgeFocus) || 1.4);
  return Math.sin(Math.PI * phase) ** (2 * shape);
}

export function wrappedDistance(a, b) {
  const distance = Math.abs(wrapUnit(a) - wrapUnit(b));
  return Math.min(distance, 1 - distance);
}

export function latticeCoordinate(index, count) {
  const safeCount = Math.max(1, Math.round(Number(count) || 1));
  const safeIndex = Math.max(0, Math.min(safeCount - 1, Math.round(Number(index) || 0)));
  return Object.freeze({
    x: wrapUnit(0.5 + safeIndex * 0.7548776662466927) * 2 - 1,
    y: wrapUnit(0.5 + safeIndex * 0.5698402909980532) * 2 - 1,
    spectralPosition: (safeIndex + 0.5) / safeCount,
  });
}

export function waveFieldValue(
  x,
  y,
  phase,
  angleDegrees,
  density,
  curvature,
  originX = 0,
  originY = 0,
) {
  const px = clamp(x, -2, 2, 0) - clamp(originX, -1, 1, 0);
  const py = clamp(y, -2, 2, 0) - clamp(originY, -1, 1, 0);
  const angle = clamp(angleDegrees, -180, 180, 0) * Math.PI / 180;
  const direction = px * Math.cos(angle) + py * Math.sin(angle);
  const radial = Math.hypot(px, py) - 0.72;
  const bend = clamp(curvature, 0, 1, 0);
  const coordinate = direction * (1 - bend) + radial * bend;
  return Math.sin(TAU * (
    coordinate * clamp(density, 0.25, 12, 1)
    + wrapUnit(phase)
  ));
}

export function collideWaveFields(fieldA, fieldB, mode = "multiply") {
  const a = clamp(fieldA, -1, 1, 0);
  const b = clamp(fieldB, -1, 1, 0);
  if (mode === "difference") return clamp(Math.abs(a - b) - 1, -1, 1, 0);
  if (mode === "fold") {
    const folded = Math.abs((a + b) * 0.5);
    return clamp(1 - 4 * Math.abs(folded - 0.5), -1, 1, 0);
  }
  return a * b;
}

export function normalizedResonanceQ(value) {
  return 0.55 * (MOIRE_DRONE_LIMITS.maxQ / 0.55) ** clamp(value, 0, 1, 0.5);
}

export function stableSvfCoefficients(frequency, q, sampleRate = DEFAULT_SAMPLE_RATE) {
  const rate = Math.max(8_000, Number(sampleRate) || DEFAULT_SAMPLE_RATE);
  const safeFrequency = clamp(frequency, 20, rate * 0.42, 220);
  const safeQ = clamp(q, 0.45, MOIRE_DRONE_LIMITS.maxQ, 1);
  const g = Math.tan(Math.PI * safeFrequency / rate);
  const k = 1 / safeQ;
  const a1 = 1 / (1 + g * (g + k));
  return Object.freeze({
    frequency: safeFrequency,
    q: safeQ,
    g,
    k,
    a1,
    a2: g * a1,
    a3: g * g * a1,
  });
}

export function createSeededNoise(seed = MOIRE_DRONE_DEFAULTS.seed) {
  const initialSeed = sanitizeSeed(seed);
  let state = initialSeed;
  return Object.freeze({
    next() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) / 0x8000_0000) - 1;
    },
    reset() {
      state = initialSeed;
    },
    get state() {
      return state >>> 0;
    },
  });
}

function wrapBipolar(value) {
  return wrapUnit(Number(value) * 0.5 + 0.5) * 2 - 1;
}

export function rotateFabricCoordinate(x, y, angleDegrees = 0) {
  const angle = clamp(angleDegrees, -360_000, 360_000, 0) * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const safeX = clamp(x, -2, 2, 0);
  const safeY = clamp(y, -2, 2, 0);
  return Object.freeze({
    x: wrapBipolar(safeX * cosine - safeY * sine),
    y: wrapBipolar(safeX * sine + safeY * cosine),
  });
}

export function fabricImpulseWeight(
  x,
  y,
  centerX = 0,
  centerY = 0,
  radius = 0.28,
) {
  const px = wrapBipolar(clamp(x, -2, 2, 0));
  const py = wrapBipolar(clamp(y, -2, 2, 0));
  const cx = wrapBipolar(clamp(centerX, -2, 2, 0));
  const cy = wrapBipolar(clamp(centerY, -2, 2, 0));
  const dx = Math.min(Math.abs(px - cx), 2 - Math.abs(px - cx));
  const dy = Math.min(Math.abs(py - cy), 2 - Math.abs(py - cy));
  const safeRadius = clamp(radius, 0.04, 1.5, 0.28);
  return Math.exp(-0.5 * (dx * dx + dy * dy) / (safeRadius * safeRadius));
}

/**
 * A small toroidal mass-spring membrane over log-frequency space. Its scalar
 * displacement is mapped to octaves by `fabricDepth`; rotating the sampling
 * coordinates turns the weave without injecting unstable angular forces.
 */
export class SpectralFabric {
  constructor({
    width = FABRIC_WIDTH,
    height = FABRIC_HEIGHT,
    seed = MOIRE_DRONE_DEFAULTS.seed ^ 0xa511e9b3,
  } = {}) {
    this.width = Math.max(3, Math.min(16, Math.round(Number(width) || FABRIC_WIDTH)));
    this.height = Math.max(3, Math.min(16, Math.round(Number(height) || FABRIC_HEIGHT)));
    this.nodeCount = this.width * this.height;
    this.displacement = new Float64Array(this.nodeCount);
    this.velocity = new Float64Array(this.nodeCount);
    this.acceleration = new Float64Array(this.nodeCount);
    this.seed = sanitizeSeed(seed);
    this.randomState = this.seed;
    this.vibrationPhase = 0;
    this.tugActive = false;
    this.tugX = 0;
    this.tugY = 0;
    this.tugAmount = 0;
    this.lastEnergy = 0;
  }

  reset(seed = this.seed) {
    this.seed = sanitizeSeed(seed);
    this.randomState = this.seed;
    this.displacement.fill(0);
    this.velocity.fill(0);
    this.acceleration.fill(0);
    this.vibrationPhase = 0;
    this.tugActive = false;
    this.tugX = 0;
    this.tugY = 0;
    this.tugAmount = 0;
    this.lastEnergy = 0;
  }

  nextRandom() {
    let state = this.randomState >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.randomState = state >>> 0 || 1;
    return (this.randomState >>> 0) / 0x1_0000_0000;
  }

  excite(x = 0, y = 0, force = 0.7, radius = 0.28) {
    const amount = clamp(force, -2, 2, 0);
    const safeRadius = clamp(radius, 0.04, 1.5, 0.28);
    for (let row = 0; row < this.height; row += 1) {
      const nodeY = (row + 0.5) / this.height * 2 - 1;
      for (let column = 0; column < this.width; column += 1) {
        const nodeX = (column + 0.5) / this.width * 2 - 1;
        const index = row * this.width + column;
        const weight = fabricImpulseWeight(nodeX, nodeY, x, y, safeRadius);
        this.velocity[index] = clamp(
          this.velocity[index] + amount * weight * 6,
          -14,
          14,
          0,
        );
      }
    }
  }

  tug(x = 0, y = 0, amount = 0) {
    this.tugActive = true;
    this.tugX = wrapBipolar(clamp(x, -2, 2, 0));
    this.tugY = wrapBipolar(clamp(y, -2, 2, 0));
    this.tugAmount = clamp(amount, -1, 1, 0);
  }

  release() {
    this.tugActive = false;
    this.tugAmount = 0;
  }

  sample(x = 0, y = 0, angleDegrees = 0) {
    return this.sampleArray(this.displacement, x, y, angleDegrees);
  }

  sampleVelocity(x = 0, y = 0, angleDegrees = 0) {
    return this.sampleArray(this.velocity, x, y, angleDegrees);
  }

  sampleLocal(x = 0, y = 0) {
    return this.sampleArrayLocal(this.displacement, x, y);
  }

  sampleVelocityLocal(x = 0, y = 0) {
    return this.sampleArrayLocal(this.velocity, x, y);
  }

  sampleArray(values, x, y, angleDegrees) {
    const angle = clamp(angleDegrees, -360_000, 360_000, 0) * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const safeX = clamp(x, -2, 2, 0);
    const safeY = clamp(y, -2, 2, 0);
    const rotatedX = wrapBipolar(safeX * cosine - safeY * sine);
    const rotatedY = wrapBipolar(safeX * sine + safeY * cosine);
    return this.sampleArrayLocal(values, rotatedX, rotatedY);
  }

  sampleArrayLocal(values, x, y) {
    const rotatedX = wrapBipolar(clamp(x, -2, 2, 0));
    const rotatedY = wrapBipolar(clamp(y, -2, 2, 0));
    const gridX = (rotatedX + 1) * 0.5 * this.width - 0.5;
    const gridY = (rotatedY + 1) * 0.5 * this.height - 0.5;
    const floorX = Math.floor(gridX);
    const floorY = Math.floor(gridY);
    const x0 = ((floorX % this.width) + this.width) % this.width;
    const y0 = ((floorY % this.height) + this.height) % this.height;
    const x1 = (x0 + 1) % this.width;
    const y1 = (y0 + 1) % this.height;
    const mixX = gridX - floorX;
    const mixY = gridY - floorY;
    const top = values[y0 * this.width + x0] * (1 - mixX)
      + values[y0 * this.width + x1] * mixX;
    const bottom = values[y1 * this.width + x0] * (1 - mixX)
      + values[y1 * this.width + x1] * mixX;
    return top * (1 - mixY) + bottom * mixY;
  }

  step(seconds, parameters = MOIRE_DRONE_DEFAULTS, manualOnly = false) {
    let remaining = clamp(seconds, 0, 0.05, 0);
    if (remaining <= 0) return this.energy;
    const tension = clamp(parameters.fabricTension, 0, 1, MOIRE_DRONE_DEFAULTS.fabricTension);
    const damping = clamp(parameters.fabricDamping, 0, 1, MOIRE_DRONE_DEFAULTS.fabricDamping);
    const inertia = clamp(parameters.fabricInertia, 0, 1, MOIRE_DRONE_DEFAULTS.fabricInertia);
    const excitation = manualOnly
      ? 0
      : clamp(parameters.fabricExcitation, 0, 1, MOIRE_DRONE_DEFAULTS.fabricExcitation);
    const vibration = manualOnly
      ? 0
      : clamp(parameters.fabricVibration, 0, 1, MOIRE_DRONE_DEFAULTS.fabricVibration);
    const rate = clamp(parameters.fabricRate, 0.05, 30, MOIRE_DRONE_DEFAULTS.fabricRate);
    const pull = clamp(parameters.fabricPull, 0, 2, MOIRE_DRONE_DEFAULTS.fabricPull);
    const mass = 0.35 + inertia * 2.65;
    const waveRate = 1.2 + tension * 17;
    const coupling = (TAU * waveRate) ** 2 * 0.045 / mass;
    const anchor = (TAU * (0.28 + tension * 0.86)) ** 2 / mass;
    const dampingRate = 0.12 + damping * damping * 17;
    const maximumStep = 1 / 240;

    while (remaining > 1e-9) {
      const elapsed = Math.min(maximumStep, remaining);
      remaining -= elapsed;
      const impulseChance = (0.04 + excitation * excitation * 13) * elapsed;
      if (excitation > 0.001 && this.nextRandom() < impulseChance) {
        const x = this.nextRandom() * 2 - 1;
        const y = this.nextRandom() * 2 - 1;
        const polarity = this.nextRandom() < 0.5 ? -1 : 1;
        this.excite(
          x,
          y,
          polarity * (0.18 + excitation * 0.92),
          0.1 + (1 - excitation) * 0.18,
        );
      }
      this.vibrationPhase = wrapUnit(this.vibrationPhase + rate * elapsed);
      const driveAcceleration = Math.min(
        180,
        vibration * (TAU * rate) ** 2 * 0.18,
      );

      for (let row = 0; row < this.height; row += 1) {
        const up = ((row - 1 + this.height) % this.height) * this.width;
        const down = ((row + 1) % this.height) * this.width;
        const rowOffset = row * this.width;
        const nodeY = (row + 0.5) / this.height * 2 - 1;
        for (let column = 0; column < this.width; column += 1) {
          const left = rowOffset + (column - 1 + this.width) % this.width;
          const right = rowOffset + (column + 1) % this.width;
          const index = rowOffset + column;
          const center = this.displacement[index];
          const laplacian = this.displacement[left] + this.displacement[right]
            + this.displacement[up + column] + this.displacement[down + column]
            - center * 4;
          const nodeX = (column + 0.5) / this.width * 2 - 1;
          const modalDrive = Math.sin(TAU * (
            this.vibrationPhase + nodeX * 0.37 + nodeY * 0.23
          )) * driveAcceleration;
          let acceleration = laplacian * coupling - center * anchor + modalDrive;
          if (this.tugActive && Math.abs(this.tugAmount) > 0.001 && pull > 0.001) {
            const weight = fabricImpulseWeight(
              nodeX,
              nodeY,
              this.tugX,
              this.tugY,
              0.13 + pull * 0.1,
            );
            const target = this.tugAmount * Math.min(1.15, 0.28 + pull * 0.5);
            acceleration += weight * (target - center) * (55 + pull * 175) / mass;
          }
          this.acceleration[index] = clamp(acceleration, -520, 520, 0);
        }
      }

      const decay = Math.exp(-dampingRate * elapsed);
      let energyTotal = 0;
      for (let index = 0; index < this.nodeCount; index += 1) {
        let velocity = (
          this.velocity[index] + this.acceleration[index] * elapsed
        ) * decay;
        velocity = clamp(velocity, -16, 16, 0);
        let displacement = this.displacement[index] + velocity * elapsed;
        if (displacement > 1.2) {
          displacement = 1.2;
          velocity = -Math.abs(velocity) * 0.16;
        } else if (displacement < -1.2) {
          displacement = -1.2;
          velocity = Math.abs(velocity) * 0.16;
        }
        this.velocity[index] = velocity;
        this.displacement[index] = displacement;
        energyTotal += displacement * displacement + velocity * velocity * 0.006;
      }
      this.lastEnergy = Math.min(1.5, Math.sqrt(energyTotal / this.nodeCount));
    }
    return this.energy;
  }

  get energy() {
    return this.lastEnergy;
  }
}

const PROPAGATION_MODE_INDEX = Object.freeze({
  drop: 0,
  harmonic: 1,
  spiral: 2,
  shock: 3,
});

function propagationModeIndex(mode) {
  return PROPAGATION_MODE_INDEX[String(mode)] ?? PROPAGATION_MODE_INDEX.drop;
}

function propagationValueFast(
  modeIndex,
  x,
  y,
  originX,
  originY,
  age,
  strength,
  rate,
  speed,
  decay,
  width,
  harmonicOrder,
  ringDensity,
  polarity,
) {
  let dx = x - originX;
  let dy = y - originY;
  if (dx > 1) dx -= 2;
  else if (dx < -1) dx += 2;
  if (dy > 1) dy -= 2;
  else if (dy < -1) dy += 2;
  const distance = Math.hypot(dx, dy);
  const localTime = age - distance / speed;
  const frontRadius = speed * age;
  const frontOffset = (distance - frontRadius) / width;
  const front = Math.exp(-0.5 * frontOffset * frontOffset);
  if (localTime < -width / speed * 4 && front < 1e-7) return 0;

  const wakeAttack = localTime > 0
    ? Math.min(1, localTime * rate * 3.5)
    : 0;
  const wakeDecay = localTime > 0
    ? Math.exp(-localTime / Math.max(0.04, decay * 0.72))
    : 0;
  const phase = TAU * (
    rate * localTime - ringDensity * distance * 0.22
  );
  const sine = Math.sin(phase);
  const cosine = Math.cos(phase);
  const order = harmonicOrder | 0;
  let angularCosine = 1;
  let angularSine = 0;
  if (
    order > 0
    && distance > 1e-9
    && (modeIndex === PROPAGATION_MODE_INDEX.harmonic
      || modeIndex === PROPAGATION_MODE_INDEX.spiral)
  ) {
    const unitX = dx / distance;
    const unitY = dy / distance;
    let cosineN = 1;
    let sineN = 0;
    for (let step = 0; step < order; step += 1) {
      const nextCosine = cosineN * unitX - sineN * unitY;
      sineN = sineN * unitX + cosineN * unitY;
      cosineN = nextCosine;
    }
    angularCosine = cosineN;
    angularSine = sineN;
  }

  const wake = wakeAttack * wakeDecay;
  let wave;
  if (modeIndex === PROPAGATION_MODE_INDEX.harmonic) {
    wave = (
      sine * wake * 0.82 + front * 0.72
    ) * angularCosine;
  } else if (modeIndex === PROPAGATION_MODE_INDEX.spiral) {
    wave = (
      (sine * angularCosine + cosine * angularSine) * wake * 0.9
      + front * angularCosine * 0.52
    );
  } else if (modeIndex === PROPAGATION_MODE_INDEX.shock) {
    const square = frontOffset * frontOffset;
    const ricker = (1 - square) * Math.exp(-0.5 * square);
    wave = ricker * 1.18 + sine * wake * 0.24;
  } else {
    wave = front * 0.94 + sine * wake * 0.7;
  }
  const ageEnvelope = Math.exp(-age / Math.max(0.04, decay));
  const distanceEnvelope = 1 / (1 + distance * (0.3 + ringDensity * 0.035));
  return clamp(
    wave * strength * polarity * ageEnvelope * distanceEnvelope,
    -1.5,
    1.5,
    0,
  );
}

export function spectralPropagationValue({
  mode = MOIRE_DRONE_DEFAULTS.propagationMode,
  x = 0,
  y = 0,
  originX = 0,
  originY = 0,
  age = 0,
  strength = 1,
  rate = MOIRE_DRONE_DEFAULTS.propagationRate,
  speed = MOIRE_DRONE_DEFAULTS.propagationSpeed,
  decay = MOIRE_DRONE_DEFAULTS.propagationDecay,
  width = MOIRE_DRONE_DEFAULTS.propagationWidth,
  harmonicOrder = MOIRE_DRONE_DEFAULTS.harmonicOrder,
  ringDensity = MOIRE_DRONE_DEFAULTS.ringDensity,
  polarity = 1,
} = {}) {
  return propagationValueFast(
    propagationModeIndex(mode),
    clamp(x, -1, 1, 0),
    clamp(y, -1, 1, 0),
    clamp(originX, -1, 1, 0),
    clamp(originY, -1, 1, 0),
    clamp(age, 0, 60, 0),
    clamp(strength, 0, 2, 1),
    clamp(rate, 1, 50, MOIRE_DRONE_DEFAULTS.propagationRate),
    clamp(speed, 0.1, 12, MOIRE_DRONE_DEFAULTS.propagationSpeed),
    clamp(decay, 0.08, 8, MOIRE_DRONE_DEFAULTS.propagationDecay),
    clamp(width, 0.02, 0.6, MOIRE_DRONE_DEFAULTS.propagationWidth),
    Math.round(clamp(harmonicOrder, 0, 12, MOIRE_DRONE_DEFAULTS.harmonicOrder)),
    clamp(ringDensity, 0.25, 12, MOIRE_DRONE_DEFAULTS.ringDensity),
    clamp(polarity, -1, 1, 1),
  );
}

/** Fixed-size pool of persistent circular wave events. */
export class SpectralPropagationPool {
  constructor({
    maxEntities = MAX_PROPAGATIONS,
    activeLimit,
    seed = MOIRE_DRONE_DEFAULTS.seed ^ 0x3c6ef372,
  } = {}) {
    this.maxEntities = Math.max(1, Math.min(
      MAX_PROPAGATIONS,
      Math.round(Number(maxEntities) || MAX_PROPAGATIONS),
    ));
    this.activeLimit = activeLimit === undefined
      ? this.maxEntities
      : Math.round(clamp(activeLimit, 1, Math.min(4, this.maxEntities), 1));
    this.seed = sanitizeSeed(seed);
    this.randomState = this.seed;
    this.serial = 0;
    this.active = new Uint8Array(this.maxEntities);
    this.mode = new Uint8Array(this.maxEntities);
    this.x = new Float64Array(this.maxEntities);
    this.y = new Float64Array(this.maxEntities);
    this.age = new Float64Array(this.maxEntities);
    this.lifetime = new Float64Array(this.maxEntities);
    this.strength = new Float64Array(this.maxEntities);
    this.rate = new Float64Array(this.maxEntities);
    this.speed = new Float64Array(this.maxEntities);
    this.decay = new Float64Array(this.maxEntities);
    this.width = new Float64Array(this.maxEntities);
    this.harmonicOrder = new Uint8Array(this.maxEntities);
    this.ringDensity = new Float64Array(this.maxEntities);
    this.polarity = new Float64Array(this.maxEntities);
  }

  setActiveLimit(value) {
    this.activeLimit = Math.round(clamp(
      value,
      1,
      Math.min(MOIRE_DRONE_LIMITS.maxPropagationVoices, this.maxEntities),
      1,
    ));
    while (this.activeCount > this.activeLimit) {
      let weakest = -1;
      let lowestResidual = Infinity;
      for (let index = 0; index < this.maxEntities; index += 1) {
        if (!this.active[index]) continue;
        const residual = this.strength[index] * Math.exp(
          -this.age[index] / Math.max(0.04, this.decay[index]),
        );
        if (residual < lowestResidual) {
          lowestResidual = residual;
          weakest = index;
        }
      }
      if (weakest < 0) break;
      this.active[weakest] = 0;
    }
    return this.activeLimit;
  }

  reset(seed = this.seed) {
    this.seed = sanitizeSeed(seed);
    this.randomState = this.seed;
    this.serial = 0;
    this.active.fill(0);
    this.mode.fill(0);
    this.x.fill(0);
    this.y.fill(0);
    this.age.fill(0);
    this.lifetime.fill(0);
    this.strength.fill(0);
    this.rate.fill(0);
    this.speed.fill(0);
    this.decay.fill(0);
    this.width.fill(0);
    this.harmonicOrder.fill(0);
    this.ringDensity.fill(0);
    this.polarity.fill(0);
  }

  nextRandom() {
    let state = this.randomState >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.randomState = state >>> 0 || 1;
    return (this.randomState >>> 0) / 0x1_0000_0000;
  }

  trigger({
    mode = MOIRE_DRONE_DEFAULTS.propagationMode,
    x = 0,
    y = 0,
    strength = 1,
    rate = MOIRE_DRONE_DEFAULTS.propagationRate,
    speed = MOIRE_DRONE_DEFAULTS.propagationSpeed,
    decay = MOIRE_DRONE_DEFAULTS.propagationDecay,
    width = MOIRE_DRONE_DEFAULTS.propagationWidth,
    harmonicOrder = MOIRE_DRONE_DEFAULTS.harmonicOrder,
    ringDensity = MOIRE_DRONE_DEFAULTS.ringDensity,
    polarity,
  } = {}) {
    let slot = -1;
    let lowestResidual = Infinity;
    const mayUseInactive = this.activeCount < this.activeLimit;
    for (let index = 0; index < this.maxEntities; index += 1) {
      if (!this.active[index] && mayUseInactive) {
        slot = index;
        break;
      }
      if (!this.active[index]) continue;
      const residual = this.strength[index] * Math.exp(
        -this.age[index] / Math.max(0.04, this.decay[index]),
      );
      if (residual < lowestResidual) {
        lowestResidual = residual;
        slot = index;
      }
    }
    if (slot < 0) slot = 0;
    const safeRate = clamp(rate, 1, 50, MOIRE_DRONE_DEFAULTS.propagationRate);
    const safeSpeed = clamp(speed, 0.1, 12, MOIRE_DRONE_DEFAULTS.propagationSpeed);
    const safeDecay = clamp(decay, 0.08, 8, MOIRE_DRONE_DEFAULTS.propagationDecay);
    this.active[slot] = 1;
    this.mode[slot] = propagationModeIndex(mode);
    this.x[slot] = clamp(x, -1, 1, 0);
    this.y[slot] = clamp(y, -1, 1, 0);
    this.age[slot] = 0;
    this.lifetime[slot] = Math.min(
      60,
      safeDecay * 4 + Math.SQRT2 / safeSpeed + 2 / safeRate,
    );
    this.strength[slot] = clamp(strength, 0, 2, 1);
    this.rate[slot] = safeRate;
    this.speed[slot] = safeSpeed;
    this.decay[slot] = safeDecay;
    this.width[slot] = clamp(width, 0.02, 0.6, MOIRE_DRONE_DEFAULTS.propagationWidth);
    this.harmonicOrder[slot] = Math.round(clamp(
      harmonicOrder, 0, 12, MOIRE_DRONE_DEFAULTS.harmonicOrder,
    ));
    this.ringDensity[slot] = clamp(
      ringDensity, 0.25, 12, MOIRE_DRONE_DEFAULTS.ringDensity,
    );
    this.polarity[slot] = Number.isFinite(Number(polarity))
      ? (Number(polarity) < 0 ? -1 : 1)
      : (this.nextRandom() < 0.5 ? -1 : 1);
    this.serial += 1;
    return slot;
  }

  step(seconds) {
    const elapsed = clamp(seconds, 0, 0.1, 0);
    if (elapsed <= 0) return this.activeCount;
    for (let index = 0; index < this.maxEntities; index += 1) {
      if (!this.active[index]) continue;
      this.age[index] += elapsed;
      if (this.age[index] >= this.lifetime[index]) this.active[index] = 0;
    }
    return this.activeCount;
  }

  sample(x = 0, y = 0) {
    const safeX = clamp(x, -1, 1, 0);
    const safeY = clamp(y, -1, 1, 0);
    let value = 0;
    let strongest = 0;
    for (let index = 0; index < this.maxEntities; index += 1) {
      if (!this.active[index]) continue;
      const candidate = propagationValueFast(
        this.mode[index],
        safeX,
        safeY,
        this.x[index],
        this.y[index],
        this.age[index],
        this.strength[index],
        this.rate[index],
        this.speed[index],
        this.decay[index],
        this.width[index],
        this.harmonicOrder[index],
        this.ringDensity[index],
        this.polarity[index],
      );
      const magnitude = Math.abs(candidate);
      if (magnitude > strongest) {
        strongest = magnitude;
        value = candidate;
      }
    }
    return clamp(value, -1, 1, 0);
  }

  get activeCount() {
    let count = 0;
    for (let index = 0; index < this.maxEntities; index += 1) {
      count += this.active[index];
    }
    return count;
  }

  get energy() {
    let energy = 0;
    for (let index = 0; index < this.maxEntities; index += 1) {
      if (!this.active[index]) continue;
      energy += this.strength[index] * Math.exp(
        -this.age[index] / Math.max(0.04, this.decay[index]),
      );
    }
    return Math.min(1.5, energy / Math.max(1, this.activeLimit * 0.35));
  }
}

export function moireFilterTarget({
  index = 0,
  bank = 0,
  phaseA = 0,
  phaseB = MOIRE_DRONE_DEFAULTS.phaseOffset,
  fieldPhaseA = phaseA,
  fieldPhaseB = phaseB,
  fabricA = 0,
  fabricB = 0,
  fabricVelocityA = 0,
  fabricVelocityB = 0,
  propagationA = 0,
  propagationB = 0,
  combPhase = 0,
  combToothPositions = null,
  combToothWidths = null,
  sampleRate = DEFAULT_SAMPLE_RATE,
  parameters = MOIRE_DRONE_DEFAULTS,
} = {}) {
  const params = sanitizeMoireDroneParams(parameters);
  const safeSampleRate = Math.max(
    8_000,
    Number.isFinite(Number(sampleRate)) ? Number(sampleRate) : DEFAULT_SAMPLE_RATE,
  );
  const coordinate = latticeCoordinate(index, params.filterPairs);
  const fieldA = waveFieldValue(
    coordinate.x, coordinate.y, fieldPhaseA,
    params.fieldAAngle, params.fieldADensity,
    params.fieldACurvature, params.originX, params.originY,
  );
  const fieldB = waveFieldValue(
    coordinate.x, coordinate.y, fieldPhaseB,
    params.fieldBAngle, params.fieldBDensity * (1 + params.moireDetune * 0.08),
    params.fieldBCurvature, -params.originX, -params.originY,
  );
  const spatialCollision = collideWaveFields(fieldA, fieldB, params.collisionMode);
  const octaveSpan = Math.log2(params.highFrequency / params.lowFrequency);
  const hash = wrapUnit((index + 1) * 0.6180339887498949) - 0.5;
  const base = coordinate.spectralPosition + hash * params.latticeScatter / Math.max(1, octaveSpan);
  const localA = fieldA * params.fieldADepth / octaveSpan;
  const localB = fieldB * params.fieldBDepth / octaveSpan;
  const fabricShiftA = clamp(fabricA, -1.2, 1.2, 0) * params.fabricDepth / octaveSpan;
  const fabricShiftB = clamp(fabricB, -1.2, 1.2, 0) * params.fabricDepth / octaveSpan;
  const propagationShiftA = clamp(propagationA, -1, 1, 0)
    * params.propagationDepth / octaveSpan;
  const propagationShiftB = clamp(propagationB, -1, 1, 0)
    * params.propagationDepth / octaveSpan;
  const positionA = wrapUnit(
    base + phaseA + localA + fabricShiftA + propagationShiftA
  );
  const positionB = wrapUnit(
    base * (1 + params.moireDetune * 0.025)
    + phaseB + localB + fabricShiftB + propagationShiftB,
  );
  const proximityOctaves = wrappedDistance(positionA, positionB) * octaveSpan;
  const proximity = Math.exp(-0.5 * (proximityOctaves / params.collisionWidth) ** 2);
  const collision = spatialCollision * proximity * params.collisionAmount;
  const position = bank === 1 ? positionB : positionA;
  const field = bank === 1 ? fieldB : fieldA;
  const frequency = Math.min(
    safeSampleRate * 0.42,
    params.lowFrequency * 2 ** (position * octaveSpan),
  );
  const baseQ = normalizedResonanceQ(params.resonance);
  const fabricActivity = Math.min(1, (
    Math.abs(clamp(fabricVelocityA, -16, 16, 0))
    + Math.abs(clamp(fabricVelocityB, -16, 16, 0))
  ) * params.fabricDepth * 0.025);
  const propagationActivity = Math.min(1, (
    Math.abs(clamp(propagationA, -1, 1, 0))
    + Math.abs(clamp(propagationB, -1, 1, 0))
  ) * 0.5);
  const localPropagation = bank === 1
    ? clamp(propagationB, -1, 1, 0)
    : clamp(propagationA, -1, 1, 0);
  const q = clamp(
    baseQ * 2 ** (
      collision * params.resonanceMotion * 2
      + fabricActivity * 0.2
      + localPropagation * params.propagationGain
        * (0.05 + params.resonanceMotion * 0.2)
      + propagationActivity * params.propagationGain * 0.02
    ),
    0.45,
    MOIRE_DRONE_LIMITS.maxQ,
    baseQ,
  );
  const edge = shepardWindow(position, params.edgeFocus);
  const octaveFromCenter = (position - 0.5) * octaveSpan;
  const tiltGain = 10 ** (params.spectralTilt * octaveFromCenter / 20);
  const collisionGain = 2 ** (params.collisionPolarity * collision * 1.5);
  const baseGain = Math.min(
    3,
    edge * tiltGain * collisionGain / Math.sqrt(params.filterPairs * 2),
  );
  const combGain = combToothPositions
    ? spectralWarpedCombGate({
      spectralPosition: position,
      toothPositions: combToothPositions,
      toothWidths: combToothWidths,
      teeth: params.combTeeth,
      width: params.combWidth,
      depth: params.combDepth,
    })
    : spectralCombGate({
      spectralPosition: position,
      phase: wrapUnit(combPhase + params.combOffset),
      teeth: params.combTeeth,
      width: params.combWidth,
      depth: params.combDepth,
    });
  const propagationCut = 1 - Math.min(
    0.96,
    Math.abs(localPropagation) * params.pluckCut * 1.1,
  );
  const gain = baseGain * combGain * propagationCut;
  const pan = clamp(
    (
      coordinate.x * 0.68 + field * 0.25 + localPropagation * 0.18
    ) * params.stereoWidth,
    -1,
    1,
    0,
  );
  return Object.freeze({
    bank: bank === 1 ? 1 : 0,
    index,
    x: coordinate.x,
    y: coordinate.y,
    fieldA,
    fieldB,
    spatialCollision,
    proximity,
    collision,
    fabric: bank === 1 ? fabricShiftB * octaveSpan : fabricShiftA * octaveSpan,
    fabricActivity,
    propagation: bank === 1
      ? propagationShiftB * octaveSpan
      : propagationShiftA * octaveSpan,
    propagationActivity,
    position,
    frequency,
    q,
    combGain,
    propagationCut,
    gain,
    pan,
  });
}

export function adaptiveFilterCount(filterPairs, tier = 0) {
  const count = Math.round(clamp(filterPairs, 4, MAX_FILTER_PAIRS, 16));
  const safeTier = Math.round(clamp(tier, 0, QUALITY_SCALES.length - 1, 0));
  return Math.max(4, Math.round(count * QUALITY_SCALES[safeTier])) * 2;
}

function isCellEnabled(index, tier) {
  if (tier <= 0) return true;
  if (tier === 1) return index % 4 !== 3;
  if (tier === 2) return index % 2 === 0;
  return index % 3 === 0;
}

export class MoireDroneKernel {
  constructor({ sampleRate = DEFAULT_SAMPLE_RATE, parameters = MOIRE_DRONE_DEFAULTS } = {}) {
    this.sampleRate = Math.max(8_000, Number(sampleRate) || DEFAULT_SAMPLE_RATE);
    this.target = { ...sanitizeMoireDroneParams(parameters) };
    this.current = { ...this.target };
    this.activeTarget = 0;
    this.activeGain = 0;
    this.phaseA = 0.117;
    this.phaseB = 0.117;
    this.fieldPhaseA = 0.213;
    this.fieldPhaseB = 0.213;
    this.fabricSpinPhase = 0;
    this.combPhase = 0;
    this.fabricTugActive = false;
    this.fabricTugX = 0;
    this.fabricTugY = 0;
    this.fabricTugAmount = 0;
    this.gestureActive = false;
    this.gestureEnvelope = 0;
    this.gestureStrength = 0;
    this.gestureFocus = this.target.combOffset;
    this.gestureCurrentX = 0;
    this.gestureCurrentY = 0;
    this.gestureDeltaX = 0;
    this.gestureDeltaY = 0;
    this.gestureVelocityX = 0;
    this.gestureVelocityY = 0;
    this.gestureThrowVelocity = 0;
    this.gestureWidthVelocity = 0;
    this.gestureWidthScale = 1;
    this.sculptFocus = this.target.combOffset;
    this.sculptWidth = this.target.combWidth;
    this.sculptDepth = this.target.combDepth;
    this.sculptCharacter = this.target.qCharacter;
    this.sculptModeIndex = spectralSculptModeIndex(this.target.spectralSculptMode);
    this.controlCounter = 0;
    this.minimumQualityTier = (
      this.target.filterPairs >= 22 && this.target.cascade >= 0.7
    ) ? 1 : 0;
    this.qualityTier = this.minimumQualityTier;
    this.loadAverage = 0;
    this.loadSamples = 0;
    this.overloadBlocks = 0;
    this.recoveryBlocks = 0;

    this.nodeX = new Float64Array(MAX_FILTER_PAIRS);
    this.nodeY = new Float64Array(MAX_FILTER_PAIRS);
    this.nodeHash = new Float64Array(MAX_FILTER_PAIRS);
    for (let index = 0; index < MAX_FILTER_PAIRS; index += 1) {
      this.nodeX[index] = wrapUnit(0.5 + index * 0.7548776662466927) * 2 - 1;
      this.nodeY[index] = wrapUnit(0.5 + index * 0.5698402909980532) * 2 - 1;
      this.nodeHash[index] = wrapUnit((index + 1) * 0.6180339887498949) - 0.5;
    }

    this.a1 = new Float64Array(MAX_FILTERS);
    this.a2 = new Float64Array(MAX_FILTERS);
    this.a3 = new Float64Array(MAX_FILTERS);
    this.k = new Float64Array(MAX_FILTERS);
    this.targetGain = new Float64Array(MAX_FILTERS);
    this.gain = new Float64Array(MAX_FILTERS);
    this.targetCombGate = new Float64Array(MAX_FILTERS);
    this.combGate = new Float64Array(MAX_FILTERS);
    this.targetCombGate.fill(1);
    this.combGate.fill(1);
    this.panLeft = new Float64Array(MAX_FILTERS);
    this.panRight = new Float64Array(MAX_FILTERS);
    this.filterPosition = new Float64Array(MAX_FILTERS);
    this.positionInitialized = new Uint8Array(MAX_FILTERS);
    this.ic1 = new Float64Array(MAX_FILTERS);
    this.ic2 = new Float64Array(MAX_FILTERS);
    this.ic1Cascade = new Float64Array(MAX_FILTERS);
    this.ic2Cascade = new Float64Array(MAX_FILTERS);

    const delayLength = Math.max(256, Math.ceil(this.sampleRate * DELAY_SECONDS));
    this.delayLeft = new Float32Array(delayLength);
    this.delayRight = new Float32Array(delayLength);
    this.delayWrite = 0;
    this.delayTapLeft = Math.max(1, Math.round(this.sampleRate * 0.173));
    this.delayTapRight = Math.max(1, Math.round(this.sampleRate * 0.227));

    // A final series notch bank makes the comb acoustic, not merely a set of
    // muted parallel resonators. It lives after space/drive so those paths
    // cannot refill the missing frequencies.
    this.combStageCount = this.target.combTeeth;
    this.combModeIndex = this.sculptModeIndex;
    this.combNotchFrequency = new Float64Array(MAX_COMB_TEETH);
    this.combNotchPosition = new Float64Array(MAX_COMB_TEETH);
    this.combToothWarp = new Float64Array(MAX_COMB_TEETH);
    this.combNotchWidth = new Float64Array(MAX_COMB_TEETH);
    this.combNotchB0 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchB1 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchB2 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchA1 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchA2 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchB0.fill(1);
    this.combNotchB2.fill(1);
    this.combNotchLeftX1 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchLeftX2 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchLeftY1 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchLeftY2 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchRightX1 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchRightX2 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchRightY1 = new Float64Array(MAX_COMB_TEETH);
    this.combNotchRightY2 = new Float64Array(MAX_COMB_TEETH);
    this.fftFilter = new SpectralFftFilter({ sampleRate: this.sampleRate });
    this.qInputDelayLeft = new Float64Array(MOIRE_DRONE_FFT_SIZE);
    this.qInputDelayRight = new Float64Array(MOIRE_DRONE_FFT_SIZE);
    this.qOutputDelayLeft = new Float64Array(MOIRE_DRONE_FFT_SIZE);
    this.qOutputDelayRight = new Float64Array(MOIRE_DRONE_FFT_SIZE);
    this.qDelayWrite = 0;

    this.noiseStates = new Uint32Array(5);
    this.pink0 = new Float64Array(3);
    this.pink1 = new Float64Array(3);
    this.pink2 = new Float64Array(3);
    this.brown = new Float64Array(3);
    this.previousWhite = new Float64Array(3);
    this.dustEnvelope = 0;
    this.dustPolarity = 1;
    this.fabric = new SpectralFabric({
      seed: (this.target.seed ^ 0xa511e9b3) >>> 0,
    });
    this.propagation = new SpectralPropagationPool({
      seed: (this.target.seed ^ 0x3c6ef372) >>> 0,
      activeLimit: this.target.propagationVoices,
    });
    this.propagationAutoAccumulator = 0.82;
    this.autoLaunchSerial = 0;
    this.impactEnvelope = 0;
    this.impactGain = 0;
    this.impactPhase = 0;
    this.impactPolarity = 1;
    this.impactX = 0;
    this.impactPreviousNoise = 0;
    this.reset();
  }

  setParameters(parameters = {}) {
    const previousSeed = this.target.seed;
    this.target = {
      ...sanitizeMoireDroneParams({ ...this.target, ...parameters }),
    };
    this.minimumQualityTier = (
      this.target.filterPairs >= 22 && this.target.cascade >= 0.7
    ) ? 1 : 0;
    if (this.qualityTier < this.minimumQualityTier) {
      this.qualityTier = this.minimumQualityTier;
    }
    this.propagation.setActiveLimit(this.target.propagationVoices);
    if (this.target.seed !== previousSeed) {
      this.resetNoise();
      this.fabric.reset((this.target.seed ^ 0xa511e9b3) >>> 0);
      this.propagation.reset((this.target.seed ^ 0x3c6ef372) >>> 0);
      this.resetGestureState();
      this.propagationAutoAccumulator = 0.82;
      this.autoLaunchSerial = 0;
      this.impactEnvelope = 0;
      this.impactGain = 0;
      this.impactPreviousNoise = 0;
    }
    return Object.freeze({ ...this.target });
  }

  setActive(active) {
    this.activeTarget = active ? 1 : 0;
  }

  get fabricAngle() {
    return this.current.fabricRotation + this.fabricSpinPhase * 360;
  }

  captureGesture(x = 0, y = 0, amount = 0, gesture = {}, active = false) {
    const packet = gesture && typeof gesture === "object" ? gesture : {};
    const anchorX = clamp(x, -1, 1, 0);
    const anchorY = clamp(y, -1, 1, 0);
    const currentX = clamp(packet.currentX, -1, 1, anchorX);
    const currentY = clamp(packet.currentY, -1, 1, anchorY);
    const deltaX = clamp(packet.deltaX, -2, 2, currentX - anchorX);
    const deltaY = clamp(packet.deltaY, -2, 2, currentY - anchorY);
    const suppliedDistance = Number(packet.distance);
    const hasSpatialGesture = Number.isFinite(suppliedDistance)
      || Math.abs(deltaX) + Math.abs(deltaY) > 1e-6;
    const distance = clamp(
      suppliedDistance,
      0,
      Math.SQRT2 * 2,
      Math.hypot(deltaX, deltaY),
    );
    const effort = hasSpatialGesture
      ? 1 - Math.exp(-distance * 1.25)
      : 1 - Math.exp(-Math.abs(clamp(amount, -2, 2, 0)) * 1.4);
    const directAmount = Math.min(1, Math.abs(clamp(amount, -2, 2, 0)));
    this.gestureStrength = clamp(
      effort * 0.78 + directAmount * 0.22,
      0,
      1,
      directAmount,
    );
    this.gestureCurrentX = currentX;
    this.gestureCurrentY = currentY;
    this.gestureDeltaX = deltaX;
    this.gestureDeltaY = deltaY;
    this.gestureVelocityX = clamp(packet.velocityX, -16, 16, 0);
    this.gestureVelocityY = clamp(packet.velocityY, -16, 16, 0);
    this.gestureFocus = clamp((currentX + 1) * 0.5, 0, 1, this.gestureFocus);
    this.gestureWidthScale = 2 ** clamp(
      currentY * 0.9 + deltaY * 1.35
        + (this.gestureStrength - 0.5) * 1.1,
      -2.3,
      2.3,
      0,
    );
    this.gestureEnvelope = active
      ? 1
      : 0.15 + this.gestureStrength * 0.85;
    this.gestureActive = Boolean(active);
    if (active) {
      this.gestureThrowVelocity = 0;
      this.gestureWidthVelocity = 0;
    }
    return this.gestureStrength;
  }

  launchPropagation(
    x = 0,
    y = 0,
    force = 0.7,
    radius = 0.28,
    parameters = this.current,
    impactScale = 1,
    fabricScale = 1,
  ) {
    const angle = this.fabricAngle * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const safeX = clamp(x, -1, 1, 0);
    const safeY = clamp(y, -1, 1, 0);
    const safeForce = clamp(force, -2, 2, 0.7);
    if (Math.abs(safeForce) < 0.0001) return false;
    const safeFabricScale = clamp(fabricScale, 0, 1, 1);
    if (safeFabricScale > 0.0001) {
      this.fabric.excite(
        wrapBipolar(safeX * cosine - safeY * sine),
        wrapBipolar(safeX * sine + safeY * cosine),
        safeForce * safeFabricScale,
        radius,
      );
    }
    this.propagation.trigger({
      mode: parameters.propagationMode,
      x: safeX,
      y: safeY,
      strength: Math.abs(safeForce),
      rate: parameters.propagationRate,
      speed: parameters.propagationSpeed,
      decay: parameters.propagationDecay,
      width: parameters.propagationWidth,
      harmonicOrder: parameters.harmonicOrder,
      ringDensity: parameters.ringDensity,
      polarity: safeForce < 0 ? -1 : 1,
    });
    const impact = Math.abs(safeForce) * clamp(impactScale, 0, 1, 1);
    if (impact > 0.0001) {
      this.impactEnvelope = Math.min(
        1,
        Math.hypot(this.impactEnvelope, impact),
      );
      this.impactPhase = 0;
      this.impactPolarity = safeForce < 0 ? -1 : 1;
      this.impactX = safeX;
      this.impactPreviousNoise = 0;
    }
    return true;
  }

  pluckFabric(x = 0, y = 0, force = 0.7, radius = 0.28, gesture = {}) {
    this.captureGesture(x, y, force, gesture, false);
    this.gestureThrowVelocity = this.gestureVelocityX * 0.12;
    this.gestureWidthVelocity = this.gestureVelocityY * 0.08;
    this.launchPropagation(x, y, force, radius, this.target, 1);
  }

  exciteFabric(x = 0, y = 0, force = 0.7, radius = 0.28) {
    this.pluckFabric(x, y, force, radius);
  }

  kickFabric(x = 0, y = 0, force = 0.5, radius = 0.2, gesture = {}) {
    const angle = this.fabricAngle * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const safeX = clamp(x, -1, 1, 0);
    const safeY = clamp(y, -1, 1, 0);
    this.fabric.excite(
      wrapBipolar(safeX * cosine - safeY * sine),
      wrapBipolar(safeX * sine + safeY * cosine),
      clamp(force, -2, 2, 0.5),
      clamp(radius, 0.04, 1.5, 0.2),
    );
    this.captureGesture(safeX, safeY, force, gesture, false);
    this.gestureThrowVelocity = this.gestureVelocityX * 0.12;
    this.gestureWidthVelocity = this.gestureVelocityY * 0.08;
  }

  tugFabric(x = 0, y = 0, amount = 0, gesture = {}) {
    this.fabricTugActive = true;
    this.fabricTugX = clamp(x, -1, 1, 0);
    this.fabricTugY = clamp(y, -1, 1, 0);
    this.fabricTugAmount = clamp(amount, -1, 1, 0);
    this.captureGesture(x, y, amount, gesture, true);
  }

  releaseFabric(gesture = {}) {
    const packet = gesture && typeof gesture === "object" ? gesture : {};
    if (Object.keys(packet).length > 0) {
      this.captureGesture(
        this.fabricTugX,
        this.fabricTugY,
        this.fabricTugAmount,
        packet,
        false,
      );
    } else {
      this.gestureActive = false;
      this.gestureEnvelope = 0.15 + this.gestureStrength * 0.85;
    }
    this.gestureThrowVelocity = this.gestureVelocityX * 0.12;
    this.gestureWidthVelocity = this.gestureVelocityY * 0.08;
    this.fabricTugActive = false;
    this.fabricTugAmount = 0;
    this.fabric.release();
  }

  resetGestureState() {
    this.gestureActive = false;
    this.gestureEnvelope = 0;
    this.gestureStrength = 0;
    this.gestureFocus = this.target.combOffset;
    this.gestureCurrentX = 0;
    this.gestureCurrentY = 0;
    this.gestureDeltaX = 0;
    this.gestureDeltaY = 0;
    this.gestureVelocityX = 0;
    this.gestureVelocityY = 0;
    this.gestureThrowVelocity = 0;
    this.gestureWidthVelocity = 0;
    this.gestureWidthScale = 1;
    this.sculptFocus = this.target.combOffset;
    this.sculptWidth = this.target.combWidth;
    this.sculptDepth = this.target.combDepth;
    this.sculptCharacter = this.target.qCharacter;
    this.sculptModeIndex = spectralSculptModeIndex(this.target.spectralSculptMode);
  }

  resetFabric({ resetComb = true } = {}) {
    if (resetComb) {
      this.phaseA = 0.117;
      this.phaseB = 0.117;
      this.fieldPhaseA = 0.213;
      this.fieldPhaseB = 0.213;
      this.fabricSpinPhase = 0;
      this.combPhase = 0;
    }
    this.fabricTugActive = false;
    this.fabricTugAmount = 0;
    this.resetGestureState();
    this.fabric.reset((this.target.seed ^ 0xa511e9b3) >>> 0);
    this.propagation.reset((this.target.seed ^ 0x3c6ef372) >>> 0);
    this.propagationAutoAccumulator = 0.82;
    this.autoLaunchSerial = 0;
    this.impactEnvelope = 0;
    this.impactGain = 0;
    this.impactPhase = 0;
    this.impactPreviousNoise = 0;
  }

  resetNoise() {
    const seed = sanitizeSeed(this.target.seed);
    this.noiseStates[0] = seed;
    this.noiseStates[1] = (seed ^ 0x9e3779b9) >>> 0 || 1;
    this.noiseStates[2] = (seed ^ 0x85ebca6b) >>> 0 || 1;
    this.noiseStates[3] = (seed ^ 0xc2b2ae35) >>> 0 || 1;
    this.noiseStates[4] = (seed ^ 0x27d4eb2f) >>> 0 || 1;
    this.pink0.fill(0);
    this.pink1.fill(0);
    this.pink2.fill(0);
    this.brown.fill(0);
    this.previousWhite.fill(0);
    this.dustEnvelope = 0;
    this.dustPolarity = 1;
  }

  resetCombNotches(stage = -1) {
    const start = stage < 0 ? 0 : Math.min(MAX_COMB_TEETH - 1, stage);
    const end = stage < 0 ? MAX_COMB_TEETH : start + 1;
    for (let index = start; index < end; index += 1) {
      this.combNotchLeftX1[index] = 0;
      this.combNotchLeftX2[index] = 0;
      this.combNotchLeftY1[index] = 0;
      this.combNotchLeftY2[index] = 0;
      this.combNotchRightX1[index] = 0;
      this.combNotchRightX2[index] = 0;
      this.combNotchRightY1[index] = 0;
      this.combNotchRightY2[index] = 0;
    }
  }

  setCombBiquadCoefficients(stage, frequency, q, modeIndex) {
    const safeFrequency = clamp(frequency, 20, this.sampleRate * 0.42, 220);
    const safeQ = clamp(q, 0.18, 32, 1);
    const previousFrequency = this.combNotchFrequency[stage];
    if (
      previousFrequency > 0
      && (
        safeFrequency / previousFrequency > 2
        || previousFrequency / safeFrequency > 2
      )
    ) {
      this.resetCombNotches(stage);
    }
    this.combNotchFrequency[stage] = safeFrequency;
    const omega = TAU * safeFrequency / this.sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * safeQ);
    const inverseA0 = 1 / (1 + alpha);
    let b0 = 1;
    let b1 = -2 * cosine;
    let b2 = 1;
    if (modeIndex === SPECTRAL_SCULPT_MODE_INDEX.lowpass) {
      b0 = (1 - cosine) * 0.5;
      b1 = 1 - cosine;
      b2 = b0;
    } else if (modeIndex === SPECTRAL_SCULPT_MODE_INDEX.highpass) {
      b0 = (1 + cosine) * 0.5;
      b1 = -(1 + cosine);
      b2 = b0;
    } else if (modeIndex === SPECTRAL_SCULPT_MODE_INDEX.bandpass) {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    this.combNotchB0[stage] = b0 * inverseA0;
    this.combNotchB1[stage] = b1 * inverseA0;
    this.combNotchB2[stage] = b2 * inverseA0;
    this.combNotchA1[stage] = -2 * cosine * inverseA0;
    this.combNotchA2[stage] = (1 - alpha) * inverseA0;
  }

  updateCombNotchCoefficients(
    params,
    {
      fabricCosine = 1,
      fabricSine = 0,
      force = false,
      focus = params.combOffset,
      width = params.combWidth,
      character = params.qCharacter,
    } = {},
  ) {
    const modeIndex = spectralSculptModeIndex(params.spectralSculptMode);
    const isPeriodic = modeIndex === SPECTRAL_SCULPT_MODE_INDEX.notches
      || modeIndex === SPECTRAL_SCULPT_MODE_INDEX.ridges;
    const toothCount = Math.round(clamp(params.combTeeth, 1, MAX_COMB_TEETH, 6));
    const stageCount = isPeriodic ? toothCount : 1;
    if (stageCount !== this.combStageCount || modeIndex !== this.combModeIndex) {
      this.combStageCount = stageCount;
      this.combModeIndex = modeIndex;
      this.resetCombNotches();
      this.combToothWarp.fill(0);
    }
    const octaveSpan = Math.max(
      0.25,
      Math.log2(params.highFrequency / params.lowFrequency),
    );
    const safeFocus = clamp(focus, 0, 1, params.combOffset);
    const safeWidth = clamp(width, 0.02, 0.48, params.combWidth);
    const safeCharacter = clamp(character, 0, 1, params.qCharacter);
    if (!isPeriodic) {
      const broadAnchorX = safeFocus * 2 - 1;
      const broadAnchorY = this.gestureEnvelope > 1e-5
        ? this.gestureCurrentY
        : params.originY;
      const fabricX = wrapBipolar(
        broadAnchorX * fabricCosine - broadAnchorY * fabricSine,
      );
      const fabricY = wrapBipolar(
        broadAnchorX * fabricSine + broadAnchorY * fabricCosine,
      );
      const fabricValue = this.fabric.sampleLocal(fabricX, fabricY);
      const propagationValue = this.propagation.sample(broadAnchorX, broadAnchorY);
      const broadWarp = combToothWarpOffsetFast(
        fabricValue,
        propagationValue,
        params.fabricDepth,
        params.propagationDepth,
        params.combWarp,
        octaveSpan,
        1,
      );
      const broadFocus = reflectUnit(safeFocus + broadWarp);
      const widthExpansion = (
        Math.abs(propagationValue) * params.pluckCut * 2.2
        + Math.abs(fabricValue) * params.pluckCut * 0.45
      );
      const broadWidth = clamp(
        safeWidth * (1 + widthExpansion),
        0.02,
        0.48,
        safeWidth,
      );
      const frequency = params.lowFrequency * 2 ** (broadFocus * octaveSpan);
      const fullWidthOctaves = Math.max(0.03, octaveSpan * broadWidth * 2);
      const bandQ = 1 / (2 * Math.sinh(Math.LN2 * fullWidthOctaves * 0.5));
      const q = modeIndex === SPECTRAL_SCULPT_MODE_INDEX.lowpass
        || modeIndex === SPECTRAL_SCULPT_MODE_INDEX.highpass
        ? clamp(
          (0.55 + safeCharacter * 2.45) * 2 ** ((0.16 - broadWidth) * 1.5),
          0.5,
          4,
          0.707,
        )
        : clamp(
          bandQ * 2 ** ((safeCharacter - 0.5) * 2.5),
          0.2,
          16,
          1,
        );
      this.combNotchPosition[0] = broadFocus;
      this.combNotchWidth[0] = broadWidth;
      this.combToothWarp[0] = broadWarp;
      this.setCombBiquadCoefficients(0, frequency, q, modeIndex);
      for (let stage = 1; stage < MAX_COMB_TEETH; stage += 1) {
        this.combNotchFrequency[stage] = 0;
        this.combNotchPosition[stage] = 0;
        this.combToothWarp[stage] = 0;
        this.combNotchWidth[stage] = 0;
      }
      return;
    }

    const phase = wrapUnit(safeFocus);
    const warpSmoothing = force
      ? 1
      : 1 - Math.exp(-CONTROL_INTERVAL / (this.sampleRate * 0.004));
    for (let stage = 0; stage < toothCount; stage += 1) {
      const anchorX = this.nodeX[stage];
      const anchorY = this.nodeY[stage];
      const fabricX = wrapBipolar(
        anchorX * fabricCosine - anchorY * fabricSine,
      );
      const fabricY = wrapBipolar(
        anchorX * fabricSine + anchorY * fabricCosine,
      );
      const fabricValue = this.fabric.sampleLocal(fabricX, fabricY);
      const propagationValue = this.propagation.sample(anchorX, anchorY);
      const targetWarp = combToothWarpOffsetFast(
        fabricValue,
        propagationValue,
        params.fabricDepth,
        params.propagationDepth,
        params.combWarp,
        octaveSpan,
        toothCount,
      );
      this.combToothWarp[stage] += (
        targetWarp - this.combToothWarp[stage]
      ) * warpSmoothing;
      const position = wrapUnit(
        (stage - phase) / toothCount + this.combToothWarp[stage],
      );
      this.combNotchPosition[stage] = position;
      const widthExpansion = (
        Math.abs(propagationValue) * params.pluckCut * 3.5
        + Math.abs(fabricValue) * params.pluckCut * 0.35
      );
      const stageWidth = clamp(
        safeWidth * (1 + widthExpansion),
        0.02,
        0.48,
        safeWidth,
      );
      this.combNotchWidth[stage] = stageWidth;
      const fullWidthOctaves = Math.max(
        0.01,
        octaveSpan * stageWidth * 2 / toothCount,
      );
      const q = clamp(
        1 / (2 * Math.sinh(Math.LN2 * fullWidthOctaves * 0.5))
          * 2 ** ((safeCharacter - 0.5) * 4),
        0.18,
        32,
        2,
      );
      const frequency = params.lowFrequency * 2 ** (position * octaveSpan);
      this.setCombBiquadCoefficients(stage, frequency, q, modeIndex);
    }
    for (let stage = toothCount; stage < MAX_COMB_TEETH; stage += 1) {
      this.combNotchFrequency[stage] = 0;
      this.combNotchPosition[stage] = 0;
      this.combToothWarp[stage] = 0;
      this.combNotchWidth[stage] = 0;
    }
  }

  reset() {
    this.current = { ...this.target };
    this.phaseA = 0.117;
    this.phaseB = 0.117;
    this.fieldPhaseA = 0.213;
    this.fieldPhaseB = 0.213;
    this.fabricSpinPhase = 0;
    this.combPhase = 0;
    this.fabricTugActive = false;
    this.fabricTugX = 0;
    this.fabricTugY = 0;
    this.fabricTugAmount = 0;
    this.resetGestureState();
    this.controlCounter = 0;
    this.activeGain = 0;
    this.gain.fill(0);
    this.targetGain.fill(0);
    this.targetCombGate.fill(1);
    this.combGate.fill(1);
    this.ic1.fill(0);
    this.ic2.fill(0);
    this.ic1Cascade.fill(0);
    this.ic2Cascade.fill(0);
    this.filterPosition.fill(0);
    this.positionInitialized.fill(0);
    this.delayLeft.fill(0);
    this.delayRight.fill(0);
    this.delayWrite = 0;
    this.fftFilter.reset();
    this.qInputDelayLeft.fill(0);
    this.qInputDelayRight.fill(0);
    this.qOutputDelayLeft.fill(0);
    this.qOutputDelayRight.fill(0);
    this.qDelayWrite = 0;
    this.resetCombNotches();
    this.combNotchFrequency.fill(0);
    this.combNotchPosition.fill(0);
    this.combToothWarp.fill(0);
    this.combNotchWidth.fill(0);
    this.fabric.reset((this.target.seed ^ 0xa511e9b3) >>> 0);
    this.propagation.reset((this.target.seed ^ 0x3c6ef372) >>> 0);
    this.propagationAutoAccumulator = 0.82;
    this.autoLaunchSerial = 0;
    this.impactEnvelope = 0;
    this.impactGain = 0;
    this.impactPhase = 0;
    this.impactPolarity = 1;
    this.impactX = 0;
    this.impactPreviousNoise = 0;
    this.resetNoise();
    this.updateTargets(true);
  }

  nextWhite(stream) {
    let state = this.noiseStates[stream] >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.noiseStates[stream] = state >>> 0;
    return ((state >>> 0) / 0x8000_0000) - 1;
  }

  coloredNoise(stream, color) {
    const white = this.nextWhite(stream);
    this.pink0[stream] = 0.99765 * this.pink0[stream] + white * 0.099046;
    this.pink1[stream] = 0.963 * this.pink1[stream] + white * 0.2965164;
    this.pink2[stream] = 0.57 * this.pink2[stream] + white * 1.0526913;
    const pink = (
      this.pink0[stream] + this.pink1[stream]
      + this.pink2[stream] + white * 0.1848
    ) * 0.085;
    this.brown[stream] = Math.max(-1, Math.min(1,
      (this.brown[stream] + white * 0.018) / 1.006,
    ));
    const brown = this.brown[stream] * 2.6;
    const blue = (white - this.previousWhite[stream]) * 0.7071;
    this.previousWhite[stream] = white;
    if (color < -0.5) {
      const blend = (color + 1) * 2;
      return brown * (1 - blend) + pink * blend;
    }
    if (color < 0) {
      const blend = (color + 0.5) * 2;
      return pink * (1 - blend) + white * blend;
    }
    return white * (1 - color) + blue * color;
  }

  updateCurrentParameters() {
    const amount = 1 - Math.exp(
      -CONTROL_INTERVAL / (this.sampleRate * 0.03),
    );
    for (let index = 0; index < SMOOTHED_PARAMETER_KEYS.length; index += 1) {
      const key = SMOOTHED_PARAMETER_KEYS[index];
      this.current[key] += (this.target[key] - this.current[key]) * amount;
    }
    this.current.filterPairs = this.target.filterPairs;
    this.current.collisionMode = this.target.collisionMode;
    this.current.propagationMode = this.target.propagationMode;
    this.current.spectralSculptMode = this.target.spectralSculptMode;
    this.current.harmonicOrder = this.target.harmonicOrder;
    this.current.propagationVoices = this.target.propagationVoices;
    this.current.combTeeth = this.target.combTeeth;
    this.current.combOffset = this.target.combOffset;
    this.current.freeze = this.target.freeze;
    this.propagation.setActiveLimit(this.current.propagationVoices);
  }

  updateTargets(force = false) {
    this.updateCurrentParameters();
    const params = this.current;
    const count = params.filterPairs;
    const octaveSpan = Math.log2(params.highFrequency / params.lowFrequency);
    const nyquistLimit = this.sampleRate * 0.42;
    const elapsed = CONTROL_INTERVAL / this.sampleRate;
    if (!params.freeze && !force) {
      this.phaseA = wrapUnit(this.phaseA + params.glideA / octaveSpan * elapsed);
      this.phaseB = wrapUnit(this.phaseB + params.glideB / octaveSpan * elapsed);
      this.fieldPhaseA = wrapUnit(this.fieldPhaseA + params.fieldASpeed * elapsed);
      this.fieldPhaseB = wrapUnit(this.fieldPhaseB + params.fieldBSpeed * elapsed);
      this.fabricSpinPhase = wrapUnit(this.fabricSpinPhase + params.fabricSpin * elapsed);
      this.combPhase = wrapUnit(this.combPhase + params.combDrift * elapsed);
    }
    if (!this.gestureActive && this.gestureEnvelope > 1e-7) {
      const memory = clamp(
        params.gestureMemory,
        0.08,
        4,
        MOIRE_DRONE_DEFAULTS.gestureMemory,
      );
      const gestureDecay = Math.exp(-elapsed / memory);
      this.gestureFocus = clamp(
        this.gestureFocus + this.gestureThrowVelocity * elapsed,
        0,
        1,
        this.gestureFocus,
      );
      this.gestureWidthScale = clamp(
        this.gestureWidthScale * 2 ** (this.gestureWidthVelocity * elapsed * 0.2),
        0.2,
        5,
        1,
      );
      this.gestureThrowVelocity *= gestureDecay;
      this.gestureWidthVelocity *= gestureDecay;
      this.gestureEnvelope *= gestureDecay;
      if (this.gestureEnvelope < 1e-7) {
        this.gestureEnvelope = 0;
        this.gestureThrowVelocity = 0;
        this.gestureWidthVelocity = 0;
      }
    } else if (this.gestureActive) {
      this.gestureEnvelope = 1;
    }
    const gesturePositionInfluence = clamp(
      params.gestureCoupling * this.gestureEnvelope,
      0,
      1,
      0,
    );
    const gestureEnergy = 0.16 + this.gestureStrength * 0.84;
    const gestureInfluence = gesturePositionInfluence * gestureEnergy;
    const requestedModeIndex = spectralSculptModeIndex(params.spectralSculptMode);
    const isPeriodicSculpt = requestedModeIndex === SPECTRAL_SCULPT_MODE_INDEX.notches
      || requestedModeIndex === SPECTRAL_SCULPT_MODE_INDEX.ridges;
    const movingSculptFocus = isPeriodicSculpt
      ? wrapUnit(params.combOffset + this.combPhase)
      : reflectUnit(params.combOffset + this.combPhase * 2);
    // Repeated gaps consume a comb *phase*, while broad sculptors consume an
    // absolute log-frequency position. Convert the pointer position before
    // blending so one repeated region lands exactly under the grabbed point.
    const gestureTargetFocus = isPeriodicSculpt
      ? wrapUnit(-this.gestureFocus * params.combTeeth)
      : this.gestureFocus;
    const gestureFocusDelta = gestureTargetFocus - movingSculptFocus;
    const shortestGestureFocusDelta = isPeriodicSculpt
      ? gestureFocusDelta - Math.round(gestureFocusDelta)
      : gestureFocusDelta;
    const targetSculptFocus = isPeriodicSculpt
      ? wrapUnit(movingSculptFocus
        + shortestGestureFocusDelta * gesturePositionInfluence)
      : movingSculptFocus
        + shortestGestureFocusDelta * gesturePositionInfluence;
    const targetSculptWidth = clamp(
      params.combWidth * this.gestureWidthScale ** gestureInfluence,
      0.02,
      0.48,
      params.combWidth,
    );
    // `combDepth` is the maximum cut. While the fabric is held, pressure
    // travels from a lighter contact cut toward that maximum. This preserves
    // a real weak-to-hard range even for presets whose maximum is already 1.
    const pressureDepth = params.combDepth * (
      0.55 + this.gestureStrength * 0.45
    );
    const pressureAmount = clamp(
      params.gestureCoupling * this.gestureEnvelope * params.pluckCut,
      0,
      1,
      0,
    );
    const targetSculptDepth = clamp(
      params.combDepth + (pressureDepth - params.combDepth) * pressureAmount,
      0,
      1,
      params.combDepth,
    );
    const targetSculptCharacter = clamp(
      params.qCharacter + (
        this.gestureCurrentY * 0.12 + this.gestureDeltaY * 0.38
        + this.gestureStrength * params.pluckCut * 0.28
      ) * gestureInfluence,
      0,
      1,
      params.qCharacter,
    );
    const sculptSmoothing = force
      ? 1
      : 1 - Math.exp(-elapsed / 0.008);
    const focusDelta = targetSculptFocus - this.sculptFocus;
    const smoothedFocusDelta = isPeriodicSculpt
      ? focusDelta - Math.round(focusDelta)
      : focusDelta;
    this.sculptFocus = isPeriodicSculpt
      ? wrapUnit(this.sculptFocus + smoothedFocusDelta * sculptSmoothing)
      : clamp(
        this.sculptFocus + smoothedFocusDelta * sculptSmoothing,
        0,
        1,
        targetSculptFocus,
      );
    this.sculptWidth += (targetSculptWidth - this.sculptWidth) * sculptSmoothing;
    this.sculptDepth += (targetSculptDepth - this.sculptDepth) * sculptSmoothing;
    this.sculptCharacter += (
      targetSculptCharacter - this.sculptCharacter
    ) * sculptSmoothing;
    this.sculptModeIndex = requestedModeIndex;
    if (!force) {
      this.propagation.step(elapsed);
      if (!params.freeze && params.autoPluckRate > 0.001) {
        this.propagationAutoAccumulator += params.autoPluckRate * elapsed;
        let launches = 0;
        while (this.propagationAutoAccumulator >= 1 && launches < 3) {
          this.propagationAutoAccumulator -= 1;
          launches += 1;
          const serial = this.autoLaunchSerial;
          this.autoLaunchSerial += 1;
          const angle = serial * 2.399963229728653;
          const orbit = 0.18 + wrapUnit(serial * 0.6180339887498949) * 0.5;
          const x = wrapBipolar(params.originX + Math.cos(angle) * orbit);
          const y = wrapBipolar(params.originY + Math.sin(angle) * orbit);
          const strength = 0.28 + params.propagationGain * 0.42;
          this.launchPropagation(
            x,
            y,
            strength,
            Math.max(0.06, params.propagationWidth * 1.35),
            params,
            0.28,
            0.2,
          );
        }
        if (launches >= 3) this.propagationAutoAccumulator %= 1;
      }
    }
    const fieldPhaseA = this.fieldPhaseA;
    const fieldPhaseB = wrapUnit(this.fieldPhaseB + params.phaseOffset);
    const baseQ = normalizedResonanceQ(params.resonance);
    const tiltCenter = Math.sqrt(params.lowFrequency * params.highFrequency);
    const enabledNormalization = 1 / Math.sqrt(
      Math.max(4, adaptiveFilterCount(count, this.qualityTier))
      * (1 + params.noiseCorrelation * 0.65),
    );
    const fabricAngle = params.fabricRotation + this.fabricSpinPhase * 360;
    const fabricRadians = fabricAngle * Math.PI / 180;
    const fabricCosine = Math.cos(fabricRadians);
    const fabricSine = Math.sin(fabricRadians);
    if (this.fabricTugActive) {
      const tugX = wrapBipolar(
        this.fabricTugX * fabricCosine - this.fabricTugY * fabricSine,
      );
      const tugY = wrapBipolar(
        this.fabricTugX * fabricSine + this.fabricTugY * fabricCosine,
      );
      this.fabric.tug(tugX, tugY, this.fabricTugAmount);
    } else {
      this.fabric.release();
    }
    if (
      !force
      && (!params.freeze || this.fabricTugActive || this.propagation.activeCount > 0)
    ) {
      this.fabric.step(elapsed, params, params.freeze);
    }
    this.updateCombNotchCoefficients(params, {
      fabricCosine,
      fabricSine,
      force,
      focus: this.sculptFocus,
      width: this.sculptWidth,
      character: this.sculptCharacter,
    });
    const broadSculpt = this.sculptModeIndex !== SPECTRAL_SCULPT_MODE_INDEX.notches
      && this.sculptModeIndex !== SPECTRAL_SCULPT_MODE_INDEX.ridges;
    const renderedSculptFocus = broadSculpt
      ? this.combNotchPosition[0]
      : this.sculptFocus;
    const renderedSculptWidth = broadSculpt
      ? this.combNotchWidth[0]
      : this.sculptWidth;
    const sculptSharpness = clamp(
      params.fftSharpness + (
        this.sculptCharacter - params.qCharacter
      ) * 0.35,
      0,
      1,
      params.fftSharpness,
    );
    this.fftFilter.setMaskState(
      params.lowFrequency,
      params.highFrequency,
      this.combNotchPosition,
      this.combNotchWidth,
      params.combTeeth,
      this.sculptDepth * params.fftCutDepth,
      sculptSharpness,
      params.spectralSculptMode,
      renderedSculptFocus,
      renderedSculptWidth,
    );

    for (let index = 0; index < MAX_FILTER_PAIRS; index += 1) {
      const enabled = index < count && isCellEnabled(index, this.qualityTier);
      const x = this.nodeX[index];
      const y = this.nodeY[index];
      const fieldA = waveFieldValue(
        x, y, fieldPhaseA, params.fieldAAngle, params.fieldADensity,
        params.fieldACurvature, params.originX, params.originY,
      );
      const fieldB = waveFieldValue(
        x, y, fieldPhaseB, params.fieldBAngle,
        params.fieldBDensity * (1 + params.moireDetune * 0.08),
        params.fieldBCurvature, -params.originX, -params.originY,
      );
      const base = (
        (index + 0.5) / count
        + this.nodeHash[index] * params.latticeScatter / octaveSpan
      );
      const fabricX = wrapBipolar(x * fabricCosine - y * fabricSine);
      const fabricY = wrapBipolar(x * fabricSine + y * fabricCosine);
      const fabricBX = wrapBipolar(-x * fabricCosine + y * fabricSine);
      const fabricBY = wrapBipolar(-x * fabricSine - y * fabricCosine);
      const fabricA = this.fabric.sampleLocal(fabricX, fabricY);
      const fabricB = this.fabric.sampleLocal(fabricBX, fabricBY);
      const fabricVelocityA = this.fabric.sampleVelocityLocal(fabricX, fabricY);
      const fabricVelocityB = this.fabric.sampleVelocityLocal(fabricBX, fabricBY);
      const propagationA = enabled ? this.propagation.sample(x, y) : 0;
      const propagationB = enabled ? this.propagation.sample(-x, -y) : 0;
      const positionA = wrapUnit(
        base + this.phaseA
        + (
          fieldA * params.fieldADepth
          + fabricA * params.fabricDepth
          + propagationA * params.propagationDepth
        ) / octaveSpan
      );
      const positionB = wrapUnit(
        base * (1 + params.moireDetune * 0.025)
        + this.phaseB + params.phaseOffset
        + (
          fieldB * params.fieldBDepth
          + fabricB * params.fabricDepth
          + propagationB * params.propagationDepth
        ) / octaveSpan,
      );
      const proximityOctaves = wrappedDistance(positionA, positionB) * octaveSpan;
      const proximity = Math.exp(-0.5 * (
        proximityOctaves / params.collisionWidth
      ) ** 2);
      const spatial = collideWaveFields(fieldA, fieldB, params.collisionMode);
      const collision = spatial * proximity * params.collisionAmount;
      const fabricActivity = Math.min(1, (
        Math.abs(fabricVelocityA) + Math.abs(fabricVelocityB)
      ) * params.fabricDepth * 0.025);
      const propagationActivity = Math.min(1, (
        Math.abs(propagationA) + Math.abs(propagationB)
      ) * 0.5);
      for (let bank = 0; bank < FILTER_BANKS; bank += 1) {
        const slot = bank * MAX_FILTER_PAIRS + index;
        const position = bank === 0 ? positionA : positionB;
        const field = bank === 0 ? fieldA : fieldB;
        const propagationValue = bank === 0 ? propagationA : propagationB;
        if (
          this.positionInitialized[slot]
          && Math.abs(position - this.filterPosition[slot]) > 0.5
        ) {
          // A cyclic filter is inaudible at this seam. Clear its integrators
          // before it re-enters at the opposite edge so no old high/low-band
          // energy is carried through the discontinuous coefficient jump.
          this.resetFilter(slot);
        }
        this.filterPosition[slot] = position;
        this.positionInitialized[slot] = 1;
        const frequency = Math.min(
          nyquistLimit,
          params.lowFrequency * 2 ** (position * octaveSpan),
        );
        const q = clamp(
          baseQ * 2 ** (
            collision * params.resonanceMotion * 2
            + fabricActivity * 0.2
            + propagationValue * params.propagationGain
              * (0.05 + params.resonanceMotion * 0.2)
            + propagationActivity * params.propagationGain * 0.02
          ),
          0.45,
          MOIRE_DRONE_LIMITS.maxQ,
          baseQ,
        );
        const g = Math.tan(Math.PI * frequency / this.sampleRate);
        const k = 1 / q;
        const a1 = 1 / (1 + g * (g + k));
        this.a1[slot] = a1;
        this.a2[slot] = g * a1;
        this.a3[slot] = g * g * a1;
        this.k[slot] = k;
        const edge = shepardWindow(position, params.edgeFocus);
        const tilt = 10 ** (
          params.spectralTilt * Math.log2(frequency / tiltCenter) / 20
        );
        const collideGain = 2 ** (
          params.collisionPolarity * collision * 1.5
        );
        const propagationCut = 1 - Math.min(
          0.96,
          Math.abs(propagationValue) * params.pluckCut * 1.1,
        );
        this.targetGain[slot] = enabled
          ? Math.min(
            2.5,
            edge * tilt * collideGain,
          ) * enabledNormalization * propagationCut
          : 0;
        // The post Q/FFT sculptor owns the final spectral shape. Keeping the
        // inner Shepard resonators open avoids imposing the same comb twice.
        this.targetCombGate[slot] = 1;
        const fabricVelocity = bank === 0 ? fabricVelocityA : fabricVelocityB;
        const pan = clamp(
          (
            x * 0.64 + field * 0.23 + fabricVelocity * 0.012
            + propagationValue * 0.2
          ) * params.stereoWidth,
          -1, 1, 0,
        );
        const panAngle = (pan + 1) * Math.PI * 0.25;
        this.panLeft[slot] = Math.cos(panAngle);
        this.panRight[slot] = Math.sin(panAngle);
      }
    }
  }

  recordPerformanceLoad(loadRatio) {
    const load = Number(loadRatio);
    if (!Number.isFinite(load) || load < 0) return false;
    this.loadAverage = this.loadSamples === 0
      ? load
      : this.loadAverage + (Math.min(4, load) - this.loadAverage) * 0.08;
    this.loadSamples += 1;
    const before = this.qualityTier;
    if (load > 0.88 || this.loadAverage > 0.72) {
      this.overloadBlocks += load > 1 ? 3 : 1;
      this.recoveryBlocks = 0;
      if (this.overloadBlocks >= 8) {
        this.overloadBlocks = 0;
        this.qualityTier = Math.min(QUALITY_SCALES.length - 1, this.qualityTier + 1);
      }
    } else if (load < 0.38 && this.loadAverage < 0.42) {
      this.overloadBlocks = 0;
      this.recoveryBlocks += 1;
      if (this.recoveryBlocks >= 600) {
        this.recoveryBlocks = 0;
        this.qualityTier = Math.max(this.minimumQualityTier, this.qualityTier - 1);
      }
    } else {
      this.overloadBlocks = Math.max(0, this.overloadBlocks - 1);
      this.recoveryBlocks = 0;
    }
    return before !== this.qualityTier;
  }

  resetFilter(slot) {
    this.ic1[slot] = 0;
    this.ic2[slot] = 0;
    this.ic1Cascade[slot] = 0;
    this.ic2Cascade[slot] = 0;
    this.gain[slot] = 0;
  }

  processCombNotchChannel(input, channel = 0) {
    let output = Number.isFinite(input) ? input : 0;
    const right = channel === 1;
    const x1 = right ? this.combNotchRightX1 : this.combNotchLeftX1;
    const x2 = right ? this.combNotchRightX2 : this.combNotchLeftX2;
    const y1 = right ? this.combNotchRightY1 : this.combNotchLeftY1;
    const y2 = right ? this.combNotchRightY2 : this.combNotchLeftY2;
    for (let stage = 0; stage < this.combStageCount; stage += 1) {
      const stageInput = output;
      output = (
        this.combNotchB0[stage] * stageInput
        + this.combNotchB1[stage] * x1[stage]
        + this.combNotchB2[stage] * x2[stage]
        - this.combNotchA1[stage] * y1[stage]
        - this.combNotchA2[stage] * y2[stage]
      );
      x2[stage] = x1[stage];
      x1[stage] = stageInput;
      y2[stage] = y1[stage];
      y1[stage] = output;
    }
    if (!Number.isFinite(output)) {
      this.resetCombNotches();
      return 0;
    }
    return output;
  }

  process(leftOutput, rightOutput) {
    if (!(leftOutput instanceof Float32Array) || !(rightOutput instanceof Float32Array)) {
      throw new TypeError("Moiré Drone outputs must be Float32Array instances.");
    }
    if (leftOutput.length !== rightOutput.length) {
      throw new RangeError("Moiré Drone output channels must have equal lengths.");
    }
    const length = leftOutput.length;
    const activationCoefficient = 1 - Math.exp(-1 / (this.sampleRate * 0.012));
    const gainCoefficient = 1 - Math.exp(-1 / (this.sampleRate * 0.025));
    const impactAttackCoefficient = 1 - Math.exp(-1 / (this.sampleRate * 0.0012));
    const impactRelease = Math.exp(-1 / (
      this.sampleRate * (0.012 + this.current.propagationWidth * 0.55)
    ));

    for (let sample = 0; sample < length; sample += 1) {
      if (this.controlCounter === 0) {
        this.updateTargets();
      }
      this.activeGain += (this.activeTarget - this.activeGain) * activationCoefficient;

      const color = this.current.noiseColor;
      const common = this.coloredNoise(0, color);
      const independentA = this.coloredNoise(1, color);
      const independentB = this.coloredNoise(2, color);
      const commonWeight = Math.sqrt(this.current.noiseCorrelation);
      const independentWeight = Math.sqrt(1 - this.current.noiseCorrelation);
      let sourceA = common * commonWeight + independentA * independentWeight;
      let sourceB = common * commonWeight + independentB * independentWeight;

      if (this.impactEnvelope > 1e-7 || this.impactGain > 1e-7) {
        this.impactGain += (
          this.impactEnvelope - this.impactGain
        ) * impactAttackCoefficient;
        this.impactEnvelope *= impactRelease;
        this.impactPhase += TAU * (
          55 + this.current.propagationRate * 6
        ) / this.sampleRate;
        if (this.impactPhase >= TAU) this.impactPhase -= TAU;
        const impactNoise = this.nextWhite(4);
        const impactClick = impactNoise - this.impactPreviousNoise;
        this.impactPreviousNoise = impactNoise;
        const burst = (
          impactNoise * 0.4 + impactClick * 0.1
          + Math.sin(this.impactPhase) * 0.16
        ) * this.impactGain * this.impactPolarity
          * (0.04 + this.current.propagationGain * 0.08)
          * (1 - this.current.pluckCut * 0.65);
        const panAngle = (this.impactX + 1) * Math.PI * 0.25;
        sourceA += burst * (0.72 + Math.cos(panAngle) * 0.28);
        sourceB += burst * (0.72 + Math.sin(panAngle) * 0.28);
      }

      const dust = this.current.dust;
      if (dust > 0) {
        const chance = dust * dust * 900 / this.sampleRate;
        if ((this.nextWhite(3) + 1) * 0.5 < chance) {
          this.dustPolarity = this.nextWhite(3) < 0 ? -1 : 1;
          this.dustEnvelope = 0.35 + dust * 0.8;
        }
        this.dustEnvelope *= 0.985 - dust * 0.004;
        const dustSample = this.dustEnvelope * this.dustPolarity;
        sourceA += dustSample * dust;
        sourceB += dustSample * dust;
      }

      const leftTapIndex = (
        this.delayWrite - this.delayTapLeft + this.delayLeft.length
      ) % this.delayLeft.length;
      const rightTapIndex = (
        this.delayWrite - this.delayTapRight + this.delayRight.length
      ) % this.delayRight.length;
      const delayedLeft = this.delayLeft[leftTapIndex];
      const delayedRight = this.delayRight[rightTapIndex];
      sourceA += delayedRight * this.current.feedback * 0.28;
      sourceB += delayedLeft * this.current.feedback * 0.28;

      let filteredLeft = 0;
      let filteredRight = 0;
      const count = this.current.filterPairs;
      for (let bank = 0; bank < FILTER_BANKS; bank += 1) {
        const source = bank === 0 ? sourceA : sourceB;
        const offset = bank * MAX_FILTER_PAIRS;
        for (let index = 0; index < count; index += 1) {
          const slot = offset + index;
          const targetGain = this.targetGain[slot];
          this.gain[slot] += (targetGain - this.gain[slot]) * gainCoefficient;
          if (this.gain[slot] < 1e-7 && targetGain === 0) continue;

          const v3 = source - this.ic2[slot];
          const v1 = this.a1[slot] * this.ic1[slot] + this.a2[slot] * v3;
          const v2 = this.ic2[slot] + this.a2[slot] * this.ic1[slot] + this.a3[slot] * v3;
          this.ic1[slot] = 2 * v1 - this.ic1[slot];
          this.ic2[slot] = 2 * v2 - this.ic2[slot];
          let band = v1 * this.k[slot];

          if (this.current.cascade > 0.001 && this.qualityTier < 3) {
            const c3 = band - this.ic2Cascade[slot];
            const c1 = this.a1[slot] * this.ic1Cascade[slot] + this.a2[slot] * c3;
            const c2 = this.ic2Cascade[slot]
              + this.a2[slot] * this.ic1Cascade[slot]
              + this.a3[slot] * c3;
            this.ic1Cascade[slot] = 2 * c1 - this.ic1Cascade[slot];
            this.ic2Cascade[slot] = 2 * c2 - this.ic2Cascade[slot];
            const cascaded = c1 * this.k[slot];
            band += (cascaded - band) * this.current.cascade;
          } else {
            this.ic1Cascade[slot] = 0;
            this.ic2Cascade[slot] = 0;
          }
          const contribution = band * this.gain[slot];
          filteredLeft += contribution * this.panLeft[slot];
          filteredRight += contribution * this.panRight[slot];
        }
      }

      const rawLeft = (sourceA * 0.55 + sourceB * 0.15) * 0.22;
      const rawRight = (sourceB * 0.55 + sourceA * 0.15) * 0.22;
      const filteredMix = this.current.filteredMix;
      let dryLeft = rawLeft * (1 - filteredMix) + filteredLeft * filteredMix;
      let dryRight = rawRight * (1 - filteredMix) + filteredRight * filteredMix;
      if (!Number.isFinite(dryLeft) || !Number.isFinite(dryRight)) {
        for (let slot = 0; slot < MAX_FILTERS; slot += 1) this.resetFilter(slot);
        dryLeft = 0;
        dryRight = 0;
      }

      this.delayLeft[this.delayWrite] = Math.max(-1, Math.min(1,
        dryLeft + delayedRight * this.current.feedback,
      ));
      this.delayRight[this.delayWrite] = Math.max(-1, Math.min(1,
        dryRight + delayedLeft * this.current.feedback,
      ));
      this.delayWrite = (this.delayWrite + 1) % this.delayLeft.length;

      const space = this.current.space * 0.72;
      let mixedLeft = dryLeft * (1 - space) + delayedLeft * space;
      let mixedRight = dryRight * (1 - space) + delayedRight * space;
      if (this.current.drive > 0.001) {
        const driveGain = 1 + this.current.drive * 8;
        const normalization = Math.tanh(driveGain);
        mixedLeft = Math.tanh(mixedLeft * driveGain) / normalization;
        mixedRight = Math.tanh(mixedRight * driveGain) / normalization;
      }

      // A pluck is primarily a moving absence, not an added click. This brief
      // onset excavation guarantees that the event cuts through broadband
      // noise while the local ripple widens and bends its anchored gaps.
      const pluckDuck = 1 - Math.min(
        0.9,
        Math.pow(Math.max(0, this.impactGain), 0.65)
          * this.current.pluckCut * 0.9,
      );
      mixedLeft *= pluckDuck;
      mixedRight *= pluckDuck;

      // A WOLA frame hears moving masks around the middle of its 1023-sample
      // latency. Split the Q path delay around its notch bank so rapid plucks
      // and fabric motion meet that same effective control time.
      this.qInputDelayLeft[this.qDelayWrite] = mixedLeft;
      this.qInputDelayRight[this.qDelayWrite] = mixedRight;
      const qInputRead = (
        this.qDelayWrite - MOIRE_DRONE_Q_PRE_DELAY
      ) & (MOIRE_DRONE_FFT_SIZE - 1);
      const delayedQInputLeft = this.qInputDelayLeft[qInputRead];
      const delayedQInputRight = this.qInputDelayRight[qInputRead];
      const sculptedQLeft = this.processCombNotchChannel(delayedQInputLeft, 0);
      const sculptedQRight = this.processCombNotchChannel(delayedQInputRight, 1);
      const qDepthValue = this.sculptDepth * this.current.qCutDepth;
      const qDepth = qDepthValue >= 0.999 ? 1 : qDepthValue;
      const ridgeAmount = 0.45 + this.sculptCharacter * 1.05;
      const qLeft = this.sculptModeIndex === SPECTRAL_SCULPT_MODE_INDEX.ridges
        ? clamp(
          delayedQInputLeft
            + (delayedQInputLeft - sculptedQLeft) * qDepth * ridgeAmount,
          -3,
          3,
          0,
        )
        : delayedQInputLeft
          + (sculptedQLeft - delayedQInputLeft) * qDepth;
      const qRight = this.sculptModeIndex === SPECTRAL_SCULPT_MODE_INDEX.ridges
        ? clamp(
          delayedQInputRight
            + (delayedQInputRight - sculptedQRight) * qDepth * ridgeAmount,
          -3,
          3,
          0,
        )
        : delayedQInputRight
          + (sculptedQRight - delayedQInputRight) * qDepth;
      this.qOutputDelayLeft[this.qDelayWrite] = qLeft;
      this.qOutputDelayRight[this.qDelayWrite] = qRight;
      const qRead = (
        this.qDelayWrite - MOIRE_DRONE_Q_POST_DELAY
      ) & (MOIRE_DRONE_FFT_SIZE - 1);
      const alignedQLeft = this.qOutputDelayLeft[qRead];
      const alignedQRight = this.qOutputDelayRight[qRead];
      this.qDelayWrite = (this.qDelayWrite + 1) & (MOIRE_DRONE_FFT_SIZE - 1);

      this.fftFilter.processSample(mixedLeft, mixedRight);
      const fftBlend = this.current.spectralFilterBlend;
      mixedLeft = alignedQLeft
        + (this.fftFilter.outputLeft - alignedQLeft) * fftBlend;
      mixedRight = alignedQRight
        + (this.fftFilter.outputRight - alignedQRight) * fftBlend;
      const combDepth = this.sculptDepth >= 0.999
        ? 1
        : this.sculptDepth;
      if (combDepth === 0 && fftBlend === 0) {
        // Keep endpoint arithmetic exact when both spectral cuts are bypassed.
        mixedLeft = alignedQLeft;
        mixedRight = alignedQRight;
      }
      leftOutput[sample] = Math.max(-0.98, Math.min(0.98, mixedLeft * this.activeGain));
      rightOutput[sample] = Math.max(-0.98, Math.min(0.98, mixedRight * this.activeGain));
      this.controlCounter = (this.controlCounter + 1) % CONTROL_INTERVAL;
    }
    return true;
  }
}

function createProcessorClass(AudioWorkletBase) {
  return class MorphazoidMoireDroneProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      this.kernel = new MoireDroneKernel({
        sampleRate: Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE,
        parameters: options.processorOptions?.parameters ?? options.processorOptions,
      });
      this.performanceNow = typeof globalThis.performance?.now === "function"
        ? globalThis.performance.now.bind(globalThis.performance)
        : null;
      this.port.onmessage = (event) => {
        const message = event.data ?? {};
        if (message.type === "parameters") {
          const previousTier = this.kernel.qualityTier;
          this.kernel.setParameters(message.parameters);
          if (this.kernel.qualityTier !== previousTier) {
            this.postQuality("dense-lattice");
          }
        } else if (message.type === "active") {
          this.kernel.setActive(message.value);
        } else if (message.type === "reset") {
          this.kernel.reset();
        } else if (
          message.type === "fabric-pluck"
          || message.type === "fabric-excite"
        ) {
          this.kernel.pluckFabric(
            message.x,
            message.y,
            message.force,
            message.radius,
            message.gesture,
          );
        } else if (message.type === "fabric-kick") {
          this.kernel.kickFabric(
            message.x,
            message.y,
            message.force,
            message.radius,
            message.gesture,
          );
        } else if (message.type === "fabric-tug") {
          this.kernel.tugFabric(
            message.x,
            message.y,
            message.amount,
            message.gesture,
          );
        } else if (message.type === "fabric-release") {
          this.kernel.releaseFabric(message.gesture);
        } else if (message.type === "fabric-reset") {
          this.kernel.resetFabric({ resetComb: message.resetComb !== false });
        }
      };
      if (this.kernel.qualityTier > 0) this.postQuality("protected-start");
    }

    postQuality(reason = "load") {
      this.port.postMessage({
        type: "adaptive-quality",
        tier: this.kernel.qualityTier,
        activeFilters: adaptiveFilterCount(
          this.kernel.current.filterPairs,
          this.kernel.qualityTier,
        ),
        load: this.kernel.loadAverage,
        reason,
      });
    }

    process(_inputs, outputs) {
      const left = outputs[0]?.[0];
      const right = outputs[0]?.[1] ?? left;
      if (!left || !right) return true;
      const startedAt = this.performanceNow?.() ?? null;
      this.kernel.process(left, right);
      if (startedAt !== null && this.performanceNow) {
        const elapsed = this.performanceNow() - startedAt;
        const quantum = left.length / this.kernel.sampleRate * 1_000;
        if (this.kernel.recordPerformanceLoad(elapsed / quantum)) {
          this.postQuality("load");
        }
      }
      return true;
    }
  };
}

const AudioWorkletBase = globalThis.AudioWorkletProcessor;
if (
  typeof AudioWorkletBase === "function"
  && typeof globalThis.registerProcessor === "function"
) {
  globalThis.registerProcessor(
    MOIRE_DRONE_PROCESSOR_NAME,
    createProcessorClass(AudioWorkletBase),
  );
}

function createCeilingCurve(length = 2_001) {
  const size = Math.max(33, Math.round(Number(length) || 2_001));
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = index / (size - 1) * 2 - 1;
    curve[index] = Math.tanh(input * 1.35) / Math.tanh(1.35);
  }
  return curve;
}

function transferableFabricGesture(gesture = {}) {
  const packet = gesture && typeof gesture === "object" ? gesture : {};
  const keys = [
    "currentX", "currentY", "deltaX", "deltaY", "distance",
    "velocityX", "velocityY",
  ];
  if (!keys.some((key) => Number.isFinite(Number(packet[key])))) return undefined;
  return {
    currentX: clamp(packet.currentX, -1, 1, 0),
    currentY: clamp(packet.currentY, -1, 1, 0),
    deltaX: clamp(packet.deltaX, -2, 2, 0),
    deltaY: clamp(packet.deltaY, -2, 2, 0),
    distance: clamp(packet.distance, 0, Math.SQRT2 * 2, 0),
    velocityX: clamp(packet.velocityX, -16, 16, 0),
    velocityY: clamp(packet.velocityY, -16, 16, 0),
  };
}

export class MoireDroneAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.params = { ...MOIRE_DRONE_DEFAULTS };
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    this.outputRelease = null;
    this.enabled = false;
    this.suspendTimer = null;
    this.quality = Object.freeze({ tier: 0, activeFilters: this.params.filterPairs * 2, load: 0 });
    this.onQualityChange = null;
  }

  get isInitialized() {
    return Boolean(this.context && this.context.state !== "closed");
  }

  async initialize() {
    if (this.isInitialized) return;
    const AudioContextConstructor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    const AudioWorkletNodeConstructor = this.runtime.AudioWorkletNode ?? globalThis.AudioWorkletNode;
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }
    if (typeof AudioWorkletNodeConstructor !== "function") {
      throw new Error("Moiré Drone requires AudioWorklet support.");
    }
    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    if (!context.audioWorklet) {
      await context.close().catch(() => {});
      throw new Error("Moiré Drone requires AudioWorklet support.");
    }
    try {
      unlockAudioContext(context);
      await context.resume();
      await context.audioWorklet.addModule(new URL("./moire-drone.js", import.meta.url));
      const node = new AudioWorkletNodeConstructor(context, MOIRE_DRONE_PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { parameters: this.params },
      });
      const highpass = context.createBiquadFilter();
      const ceiling = context.createWaveShaper();
      const master = context.createGain();
      const analyser = context.createAnalyser();
      highpass.type = "highpass";
      highpass.frequency.value = 24;
      highpass.Q.value = 0.707;
      ceiling.curve = createCeilingCurve();
      ceiling.oversample = "2x";
      master.gain.value = 0;
      analyser.fftSize = 2_048;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -8;
      analyser.smoothingTimeConstant = 0.72;
      node.connect(highpass).connect(ceiling).connect(master).connect(analyser);
      this.outputRelease = connectAudioOutput(context, analyser, { runtime: this.runtime });
      node.port.onmessage = (event) => {
        if (event.data?.type !== "adaptive-quality") return;
        this.quality = Object.freeze({
          tier: event.data.tier,
          activeFilters: event.data.activeFilters,
          load: event.data.load,
        });
        this.onQualityChange?.(this.quality);
      };
      this.context = context;
      this.node = node;
      this.highpass = highpass;
      this.ceiling = ceiling;
      this.master = master;
      this.analyser = analyser;
      this.setParameters(this.params);
    } catch (error) {
      this.outputRelease?.();
      this.outputRelease = null;
      await context.close().catch(() => {});
      throw error;
    }
  }

  clearSuspendTimer() {
    if (this.suspendTimer === null) return;
    this.runtime.clearTimeout?.(this.suspendTimer);
    this.suspendTimer = null;
  }

  setParameters(parameters = {}) {
    this.params = { ...sanitizeMoireDroneParams({ ...this.params, ...parameters }) };
    this.node?.port.postMessage({ type: "parameters", parameters: this.params });
    if (this.isInitialized && this.enabled) {
      this.master.gain.setTargetAtTime(
        this.params.outputLevel,
        this.context.currentTime,
        0.02,
      );
    }
    return Object.freeze({ ...this.params });
  }

  pluckFabric(x = 0, y = 0, force = 0.7, radius = 0.28, gesture = {}) {
    this.node?.port.postMessage({
      type: "fabric-pluck",
      x: clamp(x, -1, 1, 0),
      y: clamp(y, -1, 1, 0),
      force: clamp(force, -2, 2, 0.7),
      radius: clamp(radius, 0.04, 1.5, 0.28),
      gesture: transferableFabricGesture(gesture),
    });
  }

  exciteFabric(x = 0, y = 0, force = 0.7, radius = 0.28) {
    this.pluckFabric(x, y, force, radius);
  }

  kickFabric(x = 0, y = 0, force = 0.5, radius = 0.2, gesture = {}) {
    this.node?.port.postMessage({
      type: "fabric-kick",
      x: clamp(x, -1, 1, 0),
      y: clamp(y, -1, 1, 0),
      force: clamp(force, -2, 2, 0.5),
      radius: clamp(radius, 0.04, 1.5, 0.2),
      gesture: transferableFabricGesture(gesture),
    });
  }

  tugFabric(x = 0, y = 0, amount = 0, gesture = {}) {
    this.node?.port.postMessage({
      type: "fabric-tug",
      x: clamp(x, -1, 1, 0),
      y: clamp(y, -1, 1, 0),
      amount: clamp(amount, -1, 1, 0),
      gesture: transferableFabricGesture(gesture),
    });
  }

  releaseFabric(gesture = {}) {
    this.node?.port.postMessage({
      type: "fabric-release",
      gesture: transferableFabricGesture(gesture),
    });
  }

  resetFabric({ resetComb = true } = {}) {
    this.node?.port.postMessage({
      type: "fabric-reset",
      resetComb: Boolean(resetComb),
    });
  }

  get spectrumBinCount() {
    return this.analyser?.frequencyBinCount ?? 1_024;
  }

  getSpectrum(target) {
    if (!(target instanceof Float32Array) || target.length !== this.analyser?.frequencyBinCount) {
      return false;
    }
    this.analyser.getFloatFrequencyData(target);
    return true;
  }

  async start() {
    await this.initialize();
    this.clearSuspendTimer();
    await this.context.resume();
    const now = this.context.currentTime;
    this.node.port.postMessage({ type: "reset" });
    this.node.port.postMessage({ type: "active", value: true });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.params.outputLevel, now + 0.025);
    this.enabled = true;
  }

  async stop() {
    this.clearSuspendTimer();
    if (!this.isInitialized) {
      this.enabled = false;
      return;
    }
    const now = this.context.currentTime;
    this.node.port.postMessage({ type: "active", value: false });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.025);
    this.enabled = false;
    this.suspendTimer = this.runtime.setTimeout?.(() => {
      this.suspendTimer = null;
      if (!this.enabled && this.context?.state === "running") {
        this.context.suspend().catch(() => {});
      }
    }, 45) ?? null;
  }

  async close() {
    this.clearSuspendTimer();
    this.enabled = false;
    this.node?.port.postMessage({ type: "active", value: false });
    this.node?.disconnect();
    this.highpass?.disconnect();
    this.ceiling?.disconnect();
    this.master?.disconnect();
    this.analyser?.disconnect();
    this.outputRelease?.();
    this.outputRelease = null;
    const context = this.context;
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    if (context && context.state !== "closed") await context.close().catch(() => {});
  }
}
