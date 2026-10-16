import {
  SIMD_FREEZE_DEFAULTS, SIMD_FREEZE_LIMITS, SIMD_GRANULAR_DEFAULTS, SIMD_GRANULAR_LIMITS,
  SIMD_IR_DEFAULTS, SIMD_IR_LIMITS, SIMD_MESH_DEFAULTS, SIMD_MESH_LIMITS,
  SIMD_SPATIAL_DEFAULTS, SIMD_SPATIAL_LIMITS, SIMD_SWARM_DEFAULTS, SIMD_SWARM_LIMITS,
  SIMD_WAVEGUIDE_DEFAULTS, SIMD_WAVEGUIDE_LIMITS, presetsForSimdEngine,
  sanitizeSimdFreezeSettings, sanitizeSimdGranularSettings, sanitizeSimdIrSettings, sanitizeSimdMeshSettings,
  sanitizeSimdSpatialSettings, sanitizeSimdSwarmSettings, sanitizeSimdWaveguideSettings,
} from "../../simd-resonator.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const LANE_KEYS = new Set(["grainCount", "voiceCount", "binCount", "tapCount", "modeCount", "stringCount", "sourceCount"]);
export const SIMD_LAB_ENGINES = Object.freeze({
  granular: { label: "Grains", defaults: SIMD_GRANULAR_DEFAULTS, limits: SIMD_GRANULAR_LIMITS, sanitize: sanitizeSimdGranularSettings },
  swarm: { label: "Swarm", defaults: SIMD_SWARM_DEFAULTS, limits: SIMD_SWARM_LIMITS, sanitize: sanitizeSimdSwarmSettings },
  freeze: { label: "Freeze", defaults: SIMD_FREEZE_DEFAULTS, limits: SIMD_FREEZE_LIMITS, sanitize: sanitizeSimdFreezeSettings },
  ir: { label: "IR filter", defaults: SIMD_IR_DEFAULTS, limits: SIMD_IR_LIMITS, sanitize: sanitizeSimdIrSettings },
  mesh: { label: "Mesh", defaults: SIMD_MESH_DEFAULTS, limits: SIMD_MESH_LIMITS, sanitize: sanitizeSimdMeshSettings },
  waveguide: { label: "Strings", defaults: SIMD_WAVEGUIDE_DEFAULTS, limits: SIMD_WAVEGUIDE_LIMITS, sanitize: sanitizeSimdWaveguideSettings },
  spatial: { label: "Space", defaults: SIMD_SPATIAL_DEFAULTS, limits: SIMD_SPATIAL_LIMITS, sanitize: sanitizeSimdSpatialSettings },
});

/** Engine choice, input source, sample transport and levels stay with the session. */
export function captureSimdLabPreset(engine, settings) {
  return { engine, settings: Object.fromEntries(Object.keys(SIMD_LAB_ENGINES[engine].defaults).map(key => [key, settings[key]])) };
}

export function validateSimdLabPreset(snapshot) {
  presetStateKey(snapshot);
  const spec = SIMD_LAB_ENGINES[snapshot?.engine];
  if (!spec || Object.keys(snapshot).length !== 2 || !snapshot.settings
    || presetStateKey(snapshot.settings) !== presetStateKey(spec.sanitize(snapshot.settings))
    || Object.keys(snapshot.settings).length !== Object.keys(spec.defaults).length) {
    throw new TypeError("Invalid complete SIMD Lab preset");
  }
  return snapshot;
}

const EXTRA = {
  granular: [
    ["glassdrip", "Glass drip", { grainCount: 32, density: 46, grainSizeMs: 70, pitchSemitones: 7, scanPosition: 0.8, scatter: 0.18, stereoWidth: 1 }],
    ["undertow", "Undertow", { grainCount: 48, density: 140, grainSizeMs: 240, pitchSemitones: -12, scanPosition: 0.2, scatter: 0.5, stereoWidth: 0.6 }],
    ["stutter", "Tight stutter", { grainCount: 16, density: 260, grainSizeMs: 22, pitchSemitones: 0, scanPosition: 0.62, scatter: 0.05, stereoWidth: 0.3 }],
    ["shimmer", "Octave shimmer", { grainCount: 64, density: 420, grainSizeMs: 90, pitchSemitones: 12, scanPosition: 0.35, scatter: 0.8, stereoWidth: 1 }],
  ],
  swarm: [
    ["subhive", "Sub hive", { voiceCount: 64, centerFrequency: 48, detuneCents: 6, stereoWidth: 0.5 }],
    ["glasschoir", "Glass choir", { voiceCount: 112, centerFrequency: 520, detuneCents: 12, stereoWidth: 1 }],
    ["locusts", "Locusts", { voiceCount: 128, centerFrequency: 240, detuneCents: 90, stereoWidth: 0.8 }],
    ["single", "Near-unison", { voiceCount: 16, centerFrequency: 220, detuneCents: 2, stereoWidth: 0.2 }],
  ],
  freeze: [
    ["bell", "Frozen bell", { binCount: 56, holdSeconds: 18, tilt: 0.4, stereoWidth: 0.7, scanPosition: 0.12 }],
    ["murmur", "Murmur", { binCount: 24, holdSeconds: 5, tilt: -0.8, stereoWidth: 0.95, scanPosition: 0.7 }],
    ["sheet", "Bright sheet", { binCount: 64, holdSeconds: 30, tilt: 0.95, stereoWidth: 0.4, scanPosition: 0.9 }],
    ["flicker", "Flicker", { binCount: 16, holdSeconds: 0.8, tilt: 0, stereoWidth: 0.5, scanPosition: 0.33 }],
  ],
  ir: [
    ["spring", "Spring tank", { tapCount: 96, morph: 0.18, decay: 0.55, tone: 0.7 }],
    ["cavern", "Dark cavern", { tapCount: 128, morph: 0.7, decay: 1, tone: 0.2 }],
    ["telephone", "Telephone", { tapCount: 32, morph: 0.05, decay: 0.15, tone: 0.95 }],
    ["smear", "Smear", { tapCount: 112, morph: 0.95, decay: 0.6, tone: 0.45 }],
  ],
  mesh: [
    ["gong", "Long gong", { modeCount: 64, baseFrequency: 58, decaySeconds: 9, coupling: 0.5, strikeX: 0.25, strikeY: 0.7 }],
    ["tin", "Tin tray", { modeCount: 32, baseFrequency: 170, decaySeconds: 0.6, coupling: 0.15, strikeX: 0.8, strikeY: 0.2 }],
    ["corner", "Corner hit", { modeCount: 48, baseFrequency: 74, decaySeconds: 2.5, coupling: 0.78, strikeX: 0.07, strikeY: 0.93 }],
    ["glassgrid", "Glass grid", { modeCount: 56, baseFrequency: 140, decaySeconds: 5, coupling: 0.05, strikeX: 0.6, strikeY: 0.4 }],
  ],
  waveguide: [
    ["harp", "Harp bank", { stringCount: 16, baseFrequency: 196, decaySeconds: 3, brightness: 0.55, stereoWidth: 1 }],
    ["piano", "Upright strings", { stringCount: 12, baseFrequency: 262, decaySeconds: 2.2, brightness: 0.75, stereoWidth: 0.6 }],
    ["drone", "Drone strings", { stringCount: 8, baseFrequency: 55, decaySeconds: 8, brightness: 0.2, stereoWidth: 0.4 }],
    ["tick", "Bright ticks", { stringCount: 4, baseFrequency: 392, decaySeconds: 0.3, brightness: 1, stereoWidth: 0.9 }],
  ],
  spatial: [
    ["right", "Right drift", { sourceCount: 40, centerFrequency: 150, arcDegrees: 120, rotationDegrees: 75 }],
    ["rear", "Rear arc", { sourceCount: 56, centerFrequency: 82, arcDegrees: 200, rotationDegrees: 180 }],
    ["needle", "Narrow needle", { sourceCount: 8, centerFrequency: 440, arcDegrees: 20, rotationDegrees: -30 }],
    ["swirl", "Wide swirl", { sourceCount: 64, centerFrequency: 240, arcDegrees: 360, rotationDegrees: -140 }],
  ],
};

const rows = [];
for (const [engine, spec] of Object.entries(SIMD_LAB_ENGINES)) {
  for (const preset of presetsForSimdEngine(engine)) rows.push([preset.id, `${spec.label} · ${preset.label}`, engine, preset.settings]);
  for (const [id, label, settings] of EXTRA[engine]) rows.push([`${engine}:${id}`, `${spec.label} · ${label}`, engine, { ...spec.defaults, ...settings }]);
}

export const SIMD_LAB_FULL_PRESETS = Object.freeze(rows.map(([id, label, engine, settings]) => Object.freeze({
  id, label, snapshot: Object.freeze(validateSimdLabPreset(captureSimdLabPreset(engine, settings))),
})));

export function randomizeSimdLabPreset(current, random = Math.random) {
  validateSimdLabPreset(current);
  const rng = presetRandom(random);
  const { limits, defaults } = SIMD_LAB_ENGINES[current.engine];
  const settings = Object.fromEntries(Object.keys(defaults).map(key => {
    const [min, max] = limits[key];
    return [key, LANE_KEYS.has(key) ? rng.integer(min / 4, max / 4) * 4 : Number(rng.between(min, max).toFixed(3))];
  }));
  return validateSimdLabPreset({ engine: current.engine, settings });
}
