import { sanitizeWebGpu303Sequence } from "./webgpu-303.js";
import {
  sanitizeSimd303Params,
  sanitizeSimd303StepExpression,
  sanitizeSimd303XlParams,
} from "./simd-303.js";

export const SIMD_303_USER_PRESET_STORAGE_KEY = "morphazoid.simd-303.user-presets.v1";
export const SIMD_303_USER_PRESET_LIMIT = 64;
export const SIMD_303_USER_PRESET_NAME_LIMIT = 48;

const USER_PRESET_ID = /^user:[a-z0-9_-]{6,80}$/i;

function finiteTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? Math.round(timestamp) : fallback;
}

export function sanitizeSimd303UserPresetName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SIMD_303_USER_PRESET_NAME_LIMIT);
}

function freezePreset(record) {
  const expression = sanitizeSimd303StepExpression(record.stepExpression)
    .map((step) => Object.freeze(step));
  return Object.freeze({
    id: record.id,
    label: record.label,
    category: "My presets",
    description: "Saved in this browser.",
    userPreset: true,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    params: Object.freeze(sanitizeSimd303Params(record.params)),
    sequence: Object.freeze(sanitizeWebGpu303Sequence(record.sequence)),
    xlParams: Object.freeze(sanitizeSimd303XlParams(record.xlParams)),
    stepExpression: Object.freeze(expression),
  });
}

function normalizeStoredPreset(record, now = Date.now()) {
  if (!record || typeof record !== "object") return null;
  const label = sanitizeSimd303UserPresetName(record.label);
  if (!label || !USER_PRESET_ID.test(record.id) || !record.params || !record.sequence) return null;
  const createdAt = finiteTimestamp(record.createdAt, now);
  return freezePreset({
    ...record,
    label,
    createdAt,
    updatedAt: finiteTimestamp(record.updatedAt, createdAt),
  });
}

function serializablePreset(preset) {
  return {
    id: preset.id,
    label: preset.label,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
    params: preset.params,
    sequence: preset.sequence,
    xlParams: preset.xlParams,
    stepExpression: preset.stepExpression,
  };
}

export function loadSimd303UserPresets(storage) {
  if (!storage?.getItem) return [];
  try {
    const stored = storage.getItem(SIMD_303_USER_PRESET_STORAGE_KEY);
    if (!stored) return [];
    const payload = JSON.parse(stored);
    if (payload?.version !== 1 || !Array.isArray(payload.presets)) return [];
    const ids = new Set();
    const presets = [];
    for (const record of payload.presets) {
      const preset = normalizeStoredPreset(record);
      if (!preset || ids.has(preset.id)) continue;
      ids.add(preset.id);
      presets.push(preset);
    }
    return presets.slice(-SIMD_303_USER_PRESET_LIMIT);
  } catch {
    return [];
  }
}

export function persistSimd303UserPresets(storage, presets) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(SIMD_303_USER_PRESET_STORAGE_KEY, JSON.stringify({
      version: 1,
      presets: presets.slice(-SIMD_303_USER_PRESET_LIMIT).map(serializablePreset),
    }));
    return true;
  } catch {
    return false;
  }
}

export function createSimd303UserPreset(snapshot, label, options = {}) {
  const name = sanitizeSimd303UserPresetName(label);
  if (!name) throw new TypeError("A preset name is required.");
  const now = finiteTimestamp(options.now, Date.now());
  const existing = options.existing?.userPreset ? options.existing : null;
  const suppliedRandom = Number(options.random);
  const random = Number.isFinite(suppliedRandom)
    ? Math.min(0.999999, Math.max(0, suppliedRandom))
    : Math.random();
  const token = `${now.toString(36)}-${Math.floor(random * 0xffffff).toString(36)}`;
  return freezePreset({
    id: existing?.id ?? `user:${token}`,
    label: name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    params: snapshot?.params,
    sequence: snapshot?.sequence,
    xlParams: snapshot?.xlParams,
    stepExpression: snapshot?.stepExpression,
  });
}
