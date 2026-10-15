import {
  SPARTIAL_DEFAULTS, SPARTIAL_SPECTRAL_PRESETS, randomSpartialInstrument, sanitizeSpartialSettings, spartialChordIntervals,
} from "./spartial.js";
import { SPARTIAL_ORGAN_PRESETS } from "./spartial-organ.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const SPARTIAL_SCENES = [
  { id: "still", name: "Still harmonics", spectrum: "full", mode: "single", motion: "off" },
  { id: "halo", name: "Slow halo", spectrum: "soft", mode: "single", motion: "cw", beatsPerTurn: 32, attack: .5, release: 2.5, cascade: .06 },
  { id: "rise", name: "Ascending glass", spectrum: "bright", mode: "single", motion: "off", partials: 24, cascade: .065, cascadeCurve: -.45, attack: .015, release: .65 },
  { id: "fall", name: "Falling bells", spectrum: "bell", mode: "chord", chord: "fifth", motion: "off", cascadeOrder: "down", cascade: .08, cascadeCurve: .4, release: 2.2 },
  { id: "organ", name: "Wide organ", spectrum: "odd", mode: "chord", chord: "major", motion: "off", partials: 24, cascade: 0, attack: .02, release: .35 },
  { id: "hollow", name: "Hollow arc", spectrum: "hollow", mode: "single", motion: "off", cycles: .35, release: 1.8 },
  { id: "counter", name: "Counterpoint", spectrum: "full", mode: "chord", chord: "sus", motion: "counter", beatsPerTurn: 16, cascade: .02, pattern: "alternate" },
  { id: "squeeze", name: "Close cluster", spectrum: "cluster", mode: "single", motion: "off", cycles: .15, partials: 32, attack: .25 },
  { id: "double", name: "Double spiral", spectrum: "even", mode: "single", motion: "ccw", beatsPerTurn: 16, cycles: 2, partials: 32, cascade: .015 },
  { id: "scatter", name: "Scattered metal", spectrum: "bell", mode: "single", motion: "off", pattern: "scatter", partials: 24, cascadeOrder: "alternate", cascade: .045, cascadeVariation: .55 },
  { id: "soft", name: "Soft minor seven", spectrum: "soft", mode: "chord", chord: "minor7", motion: "off", attack: .65, release: 3, cascade: .01 },
  { id: "shimmer", name: "Expanded shimmer", spectrum: "bright", mode: "single", motion: "cw", beatsPerTurn: 64, stretch: 1.28, inharmonicity: .18, attack: .3, partials: 24 },
  { id: "grain-cloud", name: "Surround grain cloud", spectrum: "soft", mode: "single", motion: "off", granularMix: .65, grainSize: 220, grainDensity: 32, grainScatter: 240, attack: .12 },
  { id: "grain-rain", name: "Scattered grain rain", spectrum: "bright", mode: "single", motion: "off", granularMix: 1, grainSize: 25, grainDensity: 15, grainJitter: .5, grainScatter: 600, grainPattern: "scatter", cascade: 0 },
  { id: "grain-reverse", name: "Reverse grain tide", spectrum: "full", mode: "chord", chord: "fifth", motion: "off", granularMix: .85, grainSize: 400, grainDensity: 12, grainReverse: 1, grainLookback: 900, grainScatter: 300, attack: .2 },
  { id: "grain-shimmer", name: "Grain shimmer", spectrum: "bell", mode: "single", motion: "off", granularMix: .5, grainSize: 90, grainDensity: 36, grainPitch: 12, grainPattern: "alternate", grainScatter: 180 },
  ...SPARTIAL_ORGAN_PRESETS.map(preset => ({ ...preset.settings, id: `organ-${preset.id}`, name: preset.name, organPreset: preset.id, spectrum: "full", mode: "single", motion: "off" })),
  { id: "pitch-ripple", name: "Traveling pitch ripple", spectrum: "soft", mode: "single", motion: "off", pitchDepth: 32, modulationRate: .65, modulationRipple: 1.5, cascade: 0, attack: .15 },
  { id: "amplitude-ripple", name: "Reverse amplitude ripple", spectrum: "full", mode: "single", motion: "off", amplitudeDepth: .8, modulationRate: 1.2, modulationRipple: -2, cascade: 0 },
];

const SESSION_KEYS = ["level", "speakerCount", "rotation", "counterRotate", "lock", "spread", "granularSource", "grainFreeze"];
export const SPARTIAL_PRESET_KEYS = Object.freeze(Object.keys(SPARTIAL_DEFAULTS).filter(key => !SESSION_KEYS.includes(key)));
const MODES = ["single", "chord"], MOTIONS = ["off", "cw", "ccw", "counter"], ROUTES = ["spread", "focus"];
const BEATS = [4, 8, 16, 32, 64];
const SCENE_ONLY_SPEAKERS = 4;

const clone = value => JSON.parse(JSON.stringify(value));
const derivedLock = routingMode => routingMode === "focus" ? 1 : 0;

export function captureSpartialPreset(state) {
  const settings = sanitizeSpartialSettings(state.settings);
  return {
    mode: state.mode, chord: state.chord, chordIntervals: [...state.chordIntervals],
    motion: state.motion, beatsPerTurn: state.beatsPerTurn, routingMode: state.routingMode,
    settings: clone(Object.fromEntries(SPARTIAL_PRESET_KEYS.map(key => [key, settings[key]]))),
  };
}

export function validateSpartialPreset(snapshot) {
  const ok = snapshot && MODES.includes(snapshot.mode) && MOTIONS.includes(snapshot.motion) && ROUTES.includes(snapshot.routingMode)
    && BEATS.includes(snapshot.beatsPerTurn) && Array.isArray(snapshot.chordIntervals) && snapshot.chordIntervals.length > 0
    && snapshot.chordIntervals.every(note => Number.isInteger(note) && note >= 0 && note < 12) && typeof snapshot.chord === "string"
    && snapshot.settings && typeof snapshot.settings === "object"
    && presetStateKey(snapshot) === presetStateKey(captureSpartialPreset({ ...snapshot, settings: { ...snapshot.settings, speakerCount: 16 } }));
  if (!ok) throw new TypeError("Invalid complete SPARTIAL preset");
  return snapshot;
}

/** Settings handed to the engine for a snapshot; session-owned fields stay with the caller. */
export function spartialSettingsPatch(snapshot) {
  return { ...snapshot.settings, lock: derivedLock(snapshot.routingMode) };
}

export function spartialSceneSnapshot(scene) {
  const spectral = SPARTIAL_SPECTRAL_PRESETS.find(item => item.id === scene.spectrum) ?? SPARTIAL_SPECTRAL_PRESETS[0];
  const chord = scene.chord ?? "minor";
  const settings = sanitizeSpartialSettings({ ...SPARTIAL_DEFAULTS, ...spectral.settings, ...scene });
  return captureSpartialPreset({
    mode: scene.mode, chord, chordIntervals: spartialChordIntervals(chord), motion: scene.motion,
    beatsPerTurn: scene.beatsPerTurn ?? 16, routingMode: "spread", settings,
  });
}

const deepFreeze = value => {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
export const SPARTIAL_FULL_PRESETS = Object.freeze(SPARTIAL_SCENES.map(scene => (
  Object.freeze({ id: scene.id, label: scene.name, snapshot: deepFreeze(spartialSceneSnapshot(scene)) })
)));

export function randomizeSpartialPreset(current, random = Math.random) {
  validateSpartialPreset(current);
  const rng = presetRandom(random);
  const seed = Math.floor(rng.unit() * 0x7fffffff);
  const rolled = randomSpartialInstrument({
    settings: { ...current.settings, speakerCount: SCENE_ONLY_SPEAKERS }, tempo: 90, playing: false,
    hasGrainFile: false, grainBufferReady: false,
  }, seed);
  const organ = rolled.settings.organMode !== "partials";
  const settings = sanitizeSpartialSettings(organ ? { ...rolled.settings, partials: 32, rolloff: 0, gains: Array(32).fill(1) } : rolled.settings);
  return validateSpartialPreset(captureSpartialPreset({
    mode: rolled.mode, chord: rolled.chord, chordIntervals: rolled.chordIntervals, motion: rolled.motion,
    beatsPerTurn: rolled.beatsPerTurn, routingMode: rolled.routingMode, settings,
  }));
}
