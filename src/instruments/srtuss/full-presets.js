import {
  SRTUSS_MAX_VOICES,
  SRTUSS_SOUND_PROJECTS,
  SRTUSS_TAPE_RATE_LIMITS,
  sanitizeSrtussVoices,
} from "./srtuss.js?v=20260908-voice-card-1";
import {
  SRTUSS_MASTER_FAMILIES,
  SRTUSS_MASTER_PARAM_DEFAULTS,
  SRTUSS_MASTER_PARAM_LIMITS,
  SRTUSS_MASTER_PARAM_ORDER,
  SRTUSS_MASTER_PRESETS,
  SRTUSS_MASTER_STEMS,
  SRTUSS_MIX_PART_ID,
  sanitizeSrtussMasterGlobals,
  sanitizeSrtussMasterParams,
  sanitizeSrtussMasterStems,
  srtussMasterPartMacros,
} from "./srtuss-master.js?v=20260908-voice-card-1";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const SESSION_GLOBALS = ["output"];

export function normalizeSrtussVoices(voices, fallbackProjectId = SRTUSS_SOUND_PROJECTS[0].id) {
  const source = Array.isArray(voices) && voices.length ? voices : [{}];
  const prepared = source.slice(0, SRTUSS_MAX_VOICES).map((candidate = {}, index) => ({
    ...candidate,
    id: candidate.id ?? `voice-${index + 1}`,
    timeRate: candidate.tapeRate ?? candidate.timeRate ?? 1,
  }));
  return sanitizeSrtussVoices(prepared, fallbackProjectId).map((base, index) => {
    const candidate = prepared[index] ?? {};
    return {
      id: base.id, projectId: base.projectId, mode: base.mode, partId: base.partId, groupId: base.groupId,
      enabled: base.enabled, solo: base.solo, tapeRate: base.timeRate, level: base.level, pan: base.pan,
      params: { ...sanitizeSrtussMasterParams(candidate.params ?? base.params) },
      stems: { ...sanitizeSrtussMasterStems(candidate.stems ?? base.stems) },
    };
  });
}

export function captureSrtussPreset(scene) {
  const globals = { ...sanitizeSrtussMasterGlobals(scene.globals) };
  for (const key of SESSION_GLOBALS) delete globals[key];
  return { globals, voices: normalizeSrtussVoices(scene.voices) };
}

export function validateSrtussPreset(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.voices) || snapshot.voices.length < 1 || snapshot.voices.length > SRTUSS_MAX_VOICES
    || presetStateKey(snapshot) !== presetStateKey(captureSrtussPreset(snapshot))) {
    throw new TypeError("Invalid complete srtuss scene preset");
  }
  return snapshot;
}

const sceneFromPreset = preset => captureSrtussPreset({
  globals: preset.globals,
  voices: preset.voices.map(voice => ({ ...voice, mode: preset.mode, tapeRate: voice.tapeRate ?? voice.timeRate ?? 1 })),
});

const deepFreeze = value => {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
export const SRTUSS_FULL_PRESETS = Object.freeze(SRTUSS_MASTER_PRESETS
  .filter(preset => preset.kind !== "parts")
  .map(preset => Object.freeze({
    id: preset.id, label: preset.label, description: preset.description, snapshot: deepFreeze(sceneFromPreset(preset)),
  })));

const round = (value, digits = 2) => Number(value.toFixed(digits));

export function randomizeSrtussPreset(current, random = Math.random) {
  validateSrtussPreset(current);
  const rng = presetRandom(random);
  const count = rng.integer(1, 6);
  const enabled = Array.from({ length: count }, (_, index) => index === 0 || rng.unit() > 0.15);
  const enabledIndexes = enabled.flatMap((on, index) => on ? [index] : []);
  const solo = count > 1 && rng.unit() < 0.15 ? rng.pick(enabledIndexes) : -1;
  const voices = Array.from({ length: count }, (_, index) => {
    const family = rng.pick(SRTUSS_MASTER_FAMILIES);
    const partId = rng.unit() < 0.3 ? rng.pick(family.parts).id : SRTUSS_MIX_PART_ID;
    const macros = new Set(srtussMasterPartMacros(family.projectId, partId));
    const params = {};
    for (const id of SRTUSS_MASTER_PARAM_ORDER) {
      const { min, max } = SRTUSS_MASTER_PARAM_LIMITS[id];
      if (!macros.has(id)) params[id] = SRTUSS_MASTER_PARAM_DEFAULTS[id];
      else if (id === "tune") params[id] = rng.integer(min, max);
      else if (id === "clock") params[id] = round(Math.exp(rng.between(Math.log(min), Math.log(max))));
      else params[id] = round(rng.between(min, max));
    }
    const stems = Object.fromEntries(SRTUSS_MASTER_STEMS.map(({ id }) => [
      id, family.supportedStems.includes(id) ? round(rng.between(0, 1.25)) : 1,
    ]));
    return {
      id: `voice-${index + 1}`, projectId: family.projectId, mode: "master", partId, groupId: `voice-${index + 1}`,
      enabled: enabled[index], solo: index === solo, tapeRate: round(Math.exp(rng.between(Math.log(SRTUSS_TAPE_RATE_LIMITS[0]), Math.log(SRTUSS_TAPE_RATE_LIMITS[1])))),
      level: round(rng.between(0.3, 1)), pan: round(rng.between(-0.8, 0.8)), params, stems,
    };
  });
  const globals = {
    clock: round(Math.exp(rng.between(Math.log(0.6), Math.log(1.7)))), tune: rng.integer(-12, 12),
    width: round(rng.between(0.3, 1.5)), space: round(rng.between(-1, 1)), drive: round(rng.between(-0.6, 0.6)),
    maxVoices: rng.integer(Math.max(count, 4), 16),
  };
  return validateSrtussPreset(captureSrtussPreset({ globals, voices }));
}
