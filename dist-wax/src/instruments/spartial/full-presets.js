import {
  SPARTIAL_CHORDS, SPARTIAL_DEFAULTS, SPARTIAL_SPECTRAL_PRESETS, randomSpartialInstrument, sanitizeSpartialSettings, spartialChordIntervals,
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
  const chord = SPARTIAL_CHORDS.find(item => item.id === snapshot?.chord);
  const intervals = snapshot?.chordIntervals;
  const validChord = chord && Array.isArray(intervals) && intervals.length === chord.noteCount && intervals[0] === 0
    && intervals.every((note, index) => Number.isInteger(note) && note >= 0 && note < 12 && (index === 0 || note > intervals[index - 1]))
    && (!chord.intervals || intervals.every((note, index) => note === chord.intervals[index]));
  const ok = snapshot && MODES.includes(snapshot.mode) && MOTIONS.includes(snapshot.motion) && ROUTES.includes(snapshot.routingMode)
    && BEATS.includes(snapshot.beatsPerTurn) && validChord
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

/** Browser-local saved scenes and their versioned JSON backup. */
export const SPARTIAL_USER_PRESETS_KEY = "morphazoid:spartial:presets:v1";
export const SPARTIAL_PRESET_FILE_LIMIT = 1024 * 1024;
export const SPARTIAL_USER_PRESET_LIMIT = 128;
const FORMAT = "morphazoid-spartial-presets";
const VERSION = 1;
const USER_ID = /^user-([1-9]\d{0,14})$/;
const MAX_NEXT_ID = 999_999_999_999_999;

export function emptySpartialPresetBank() {
  return { format: FORMAT, version: VERSION, nextId: 1, presets: [] };
}

export function spartialPresetName(value) {
  if (typeof value !== "string") throw new TypeError("Enter a preset name.");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || [...name].length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new RangeError("Preset names must be 1–64 visible characters.");
  }
  return name;
}

function cleanBank(raw) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || raw.format !== FORMAT || raw.version !== VERSION) {
    throw new TypeError("This is not a supported SPARTIAL preset JSON file (version 1).");
  }
  if (!Number.isSafeInteger(raw.nextId) || raw.nextId < 1 || raw.nextId > MAX_NEXT_ID
    || !Array.isArray(raw.presets) || raw.presets.length > SPARTIAL_USER_PRESET_LIMIT) {
    throw new RangeError("Invalid or oversized SPARTIAL preset bank.");
  }
  // Factory records in exported backups are informational. The current built-in
  // bank always comes from the application, never from an imported file.
  if (raw.factoryPresets !== undefined && (!Array.isArray(raw.factoryPresets) || raw.factoryPresets.length > 256)) {
    throw new TypeError("Invalid factory preset reference list.");
  }
  const ids = new Set(), names = new Set();
  let highestId = 0;
  const presets = raw.presets.map(entry => {
    const match = typeof entry?.id === "string" && USER_ID.exec(entry.id);
    if (!match || ids.has(entry.id)) throw new TypeError("Saved preset IDs must be unique.");
    ids.add(entry.id);
    highestId = Math.max(highestId, Number(match[1]));
    const name = spartialPresetName(entry.name);
    if (name !== entry.name || names.has(name.toLowerCase())) throw new TypeError("Saved preset names must be unique.");
    names.add(name.toLowerCase());
    return { id: entry.id, name, snapshot: JSON.parse(presetStateKey(validateSpartialPreset(entry.snapshot))) };
  });
  if (raw.nextId <= highestId) throw new RangeError("Invalid next preset ID.");
  return { format: FORMAT, version: VERSION, nextId: raw.nextId, presets };
}

export function parseSpartialPresetBank(text) {
  if (typeof text !== "string" || text.length > SPARTIAL_PRESET_FILE_LIMIT
    || new TextEncoder().encode(text).length > SPARTIAL_PRESET_FILE_LIMIT) {
    throw new RangeError("Preset JSON must be at most 1 MB.");
  }
  let data;
  try { data = JSON.parse(text); }
  catch { throw new TypeError("Could not read preset JSON."); }
  return cleanBank(data);
}

export function stringifySpartialPresetBank(bank, { includeFactory = false } = {}) {
  const clean = cleanBank(bank);
  const data = includeFactory ? { ...clean, factoryPresets: SPARTIAL_FULL_PRESETS } : clean;
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (new TextEncoder().encode(text).length > SPARTIAL_PRESET_FILE_LIMIT) {
    throw new RangeError("Too many presets to export as one JSON file.");
  }
  return text;
}

export function saveSpartialUserPreset(bank, name, snapshot) {
  const clean = cleanBank(bank);
  const label = spartialPresetName(name);
  const saved = JSON.parse(presetStateKey(validateSpartialPreset(snapshot)));
  const index = clean.presets.findIndex(item => item.name.toLowerCase() === label.toLowerCase());
  if (index !== -1) {
    const id = clean.presets[index].id;
    clean.presets[index] = { id, name: label, snapshot: saved };
    return { bank: clean, id, replaced: true };
  }
  if (clean.presets.length === SPARTIAL_USER_PRESET_LIMIT) throw new RangeError("The 128-preset limit has been reached.");
  if (clean.nextId === MAX_NEXT_ID) throw new RangeError("No more preset IDs are available.");
  const id = `user-${clean.nextId++}`;
  clean.presets.push({ id, name: label, snapshot: saved });
  return { bank: clean, id, replaced: false };
}

export function removeSpartialUserPreset(bank, id) {
  const clean = cleanBank(bank);
  const index = clean.presets.findIndex(item => item.id === id);
  if (index < 0) throw new RangeError("Select a saved preset before removing it.");
  clean.presets.splice(index, 1);
  return clean;
}

/** Import by name: update matching saves, add new names, preserve other saves. */
export function mergeSpartialPresetBanks(bank, imported) {
  const result = cleanBank(bank);
  const incoming = cleanBank(imported);
  const used = new Set(result.presets.map(item => item.id));
  let added = 0, updated = 0;
  result.nextId = Math.max(result.nextId, incoming.nextId);
  for (const entry of incoming.presets) {
    const index = result.presets.findIndex(item => item.name.toLowerCase() === entry.name.toLowerCase());
    if (index !== -1) {
      if (presetStateKey(result.presets[index].snapshot) !== presetStateKey(entry.snapshot)
        || result.presets[index].name !== entry.name) updated++;
      result.presets[index] = { ...entry, id: result.presets[index].id };
      continue;
    }
    if (result.presets.length === SPARTIAL_USER_PRESET_LIMIT) throw new RangeError("Import would exceed the 128-preset limit.");
    let id = entry.id;
    if (used.has(id)) {
      while (used.has(`user-${result.nextId}`)) {
        if (result.nextId === MAX_NEXT_ID) throw new RangeError("No more preset IDs are available.");
        result.nextId++;
      }
      if (result.nextId === MAX_NEXT_ID) throw new RangeError("No more preset IDs are available.");
      id = `user-${result.nextId++}`;
    }
    result.nextId = Math.max(result.nextId, Number(id.slice(5)) + 1);
    used.add(id);
    result.presets.push({ ...entry, id });
    added++;
  }
  return { bank: result, added, updated };
}

export function spartialPresetMenuBank(bank) {
  return [
    ...SPARTIAL_FULL_PRESETS,
    ...cleanBank(bank).presets.map(item => ({ id: item.id, label: `My · ${item.name}`, snapshot: item.snapshot })),
  ];
}
