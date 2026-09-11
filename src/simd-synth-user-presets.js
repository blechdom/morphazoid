import {
  createSimdSynthConfiguration,
} from "./simd-synth.js";

export const SIMD_SYNTH_USER_PRESET_STORAGE_KEY = "morphazoid.simd-synth.user-presets.v1";
const STORAGE_VERSION = 1;

export function sanitizeSimdSynthPresetName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
}

export function createSimdSynthUserPreset(patch, name, options = {}) {
  const label = sanitizeSimdSynthPresetName(name);
  if (!label) throw new TypeError("Enter a preset name first.");
  const configuration = createSimdSynthConfiguration(patch);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const random = typeof options.random === "function" ? options.random() : Math.random();
  return Object.freeze({
    id: `user:${now.toString(36)}-${Math.floor(Math.max(0, Math.min(0.999999, random)) * 0xffffff).toString(36)}`,
    label,
    category: "My presets",
    description: "Saved in this browser.",
    userPreset: true,
    params: Object.freeze({ ...configuration.params }),
    sequence: Object.freeze(configuration.sequence.map((step) => Object.freeze([...step]))),
    modRoutes: Object.freeze(configuration.modRoutes.map((route) => Object.freeze([...route]))),
  });
}

function validUserPreset(candidate) {
  if (!candidate || typeof candidate !== "object" || !String(candidate.id ?? "").startsWith("user:")) return null;
  const label = sanitizeSimdSynthPresetName(candidate.label);
  if (!label) return null;
  const configuration = createSimdSynthConfiguration(candidate);
  return Object.freeze({
    id: String(candidate.id), label, category: "My presets", description: "Saved in this browser.", userPreset: true,
    params: Object.freeze({ ...configuration.params }),
    sequence: Object.freeze(configuration.sequence.map((step) => Object.freeze([...step]))),
    modRoutes: Object.freeze(configuration.modRoutes.map((route) => Object.freeze([...route]))),
  });
}

export function loadSimdSynthUserPresets(storage = globalThis.localStorage) {
  try {
    const payload = JSON.parse(storage?.getItem?.(SIMD_SYNTH_USER_PRESET_STORAGE_KEY) ?? "null");
    if (payload?.version !== STORAGE_VERSION || !Array.isArray(payload.presets)) return [];
    return payload.presets.map(validUserPreset).filter(Boolean).slice(0, 64);
  } catch {
    return [];
  }
}

export function persistSimdSynthUserPresets(storage, presets) {
  try {
    storage?.setItem?.(SIMD_SYNTH_USER_PRESET_STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      presets: (presets ?? []).map((entry) => ({
        id: entry.id, label: entry.label, params: entry.params, sequence: entry.sequence, modRoutes: entry.modRoutes,
      })),
    }));
    return true;
  } catch {
    return false;
  }
}
