import {
  SYNTHESIS_METHODS,
  createDefaultState,
  sanitizeState,
  stateFromPreset,
  randomizeState,
} from './catalog.js';
import { captureSoundState } from './presets.js';
import { SEQUENCE_STUDIES, getSequenceStudy } from './sequence-catalog.js';
import {
  createSequenceParameterValues,
  getSequenceParameterBounds,
  getSequenceParameterDefinitions,
} from './sequence-parameters.js';
import { TUNINGS, sanitizeTuningId } from './tunings.js';

export const MIN_SEQUENCE_TEMPO = 10;
export const MAX_SEQUENCE_TEMPO = 1200;
const MIN_RANDOM_TEMPO = 48;
const MAX_RANDOM_TEMPO = 220;

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const finite = (value, fallback) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, finite(value, fallback)));
const unit = rng => clamp(rng(), 0, 1, 0);
const indexFromUnit = (length, value) => Math.min(length - 1, Math.floor(value * length));
const pick = (items, rng) => items[indexFromUnit(items.length, unit(rng))];
const wrap = (index, length) => ((index % length) + length) % length;

const hashText = value => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const resolveStudy = (studyOrId, fallbackId = SEQUENCE_STUDIES[0].id) => {
  const id = typeof studyOrId === 'string' ? studyOrId : studyOrId?.id;
  return getSequenceStudy(id) || getSequenceStudy(fallbackId) || SEQUENCE_STUDIES[0];
};

const resolveSynthesisMethod = methodId => {
  return SYNTHESIS_METHODS.find(method => method.id === methodId) || SYNTHESIS_METHODS[0];
};

const clampTempo = (value, fallback) => Math.round(clamp(
  value,
  MIN_SEQUENCE_TEMPO,
  MAX_SEQUENCE_TEMPO,
  fallback,
));

/** A complete, immutable historical-sequence state with no transport fields. */
export function sanitizeSequencePerformance(value = {}, fallbackId = SEQUENCE_STUDIES[0].id) {
  const source = typeof value === 'string' ? { id: value } : value && typeof value === 'object' ? value : {};
  const study = resolveStudy(source.id ?? source.sequenceId, fallbackId);
  const parameters = createSequenceParameterValues(study, source.parameters ?? source.values ?? {});
  const tempoBpm = clampTempo(source.tempoBpm ?? source.tempo, study.defaults.tempoBpm);
  return deepFreeze({ id: study.id, parameters, tempoBpm });
}

export const SEQUENCE_SETTING_RECIPES = deepFreeze([
  {
    id: 'original',
    label: 'Original',
    description: 'The authored cycle and mechanism values.',
    tempoScale: 1,
  },
  {
    id: 'spacious',
    label: 'Spacious',
    description: 'Longer steps, open articulation and gently reduced density.',
    tempoScale: .76,
    stepScale: 1.5,
    cycleScale: 1,
    density: .72,
    gate: .9,
    swing: -.06,
    mechanismShift: -.09,
    selectOffset: 0,
    booleanMode: 'off',
  },
  {
    id: 'sparse',
    label: 'Sparse',
    description: 'Fewer attacks and a shorter cycle leave clear gaps.',
    tempoScale: .9,
    stepScale: 1,
    cycleScale: .75,
    density: .38,
    gate: .48,
    swing: .08,
    mechanismShift: -.2,
    selectOffset: 1,
    booleanMode: 'alternate',
  },
  {
    id: 'tight',
    label: 'Tight',
    description: 'Short, even articulations sharpen rhythmic comparison.',
    tempoScale: 1.16,
    stepScale: .75,
    cycleScale: 1,
    density: .9,
    gate: .28,
    swing: 0,
    mechanismShift: .06,
    selectOffset: 0,
    booleanMode: 'off',
  },
  {
    id: 'dense',
    label: 'Dense',
    description: 'A longer, faster and nearly continuous event field.',
    tempoScale: 1.28,
    stepScale: .5,
    cycleScale: 1.25,
    density: 1,
    gate: .78,
    swing: .04,
    mechanismShift: .18,
    selectOffset: 2,
    booleanMode: 'on',
  },
  {
    id: 'wild',
    label: 'Wild',
    description: 'Bounded asymmetry, wider mechanism motion and a reproducible seed.',
    tempoScale: 1.08,
    stepScale: .625,
    cycleScale: 1.125,
    density: .74,
    gate: .62,
    swing: .27,
    transpose: 7,
    mechanismShift: .31,
    selectOffset: -1,
    booleanMode: 'alternate',
  },
]);

const recipeFor = recipeOrId => {
  const id = typeof recipeOrId === 'string' ? recipeOrId : recipeOrId?.id;
  const recipe = SEQUENCE_SETTING_RECIPES.find(candidate => candidate.id === id);
  if (!recipe) throw new RangeError(`Unknown sequence-settings recipe: ${id}`);
  return recipe;
};

const quantizeNumber = (definition, value, bounds = definition) => {
  const minimum = finite(bounds.min, definition.min);
  const maximum = Math.max(minimum, finite(bounds.max, definition.max));
  const steps = Math.round((value - minimum) / definition.step);
  const quantized = minimum + steps * definition.step;
  return Number(clamp(quantized, minimum, maximum, definition.default).toFixed(10));
};

const shiftedNumber = (definition, recipe, index, bounds, currentValue) => {
  const span = bounds.max - bounds.min;
  if (!(span > 0)) return bounds.min;
  const current = clamp(currentValue, bounds.min, bounds.max, definition.default);
  const original = (current - bounds.min) / span;
  const direction = recipe.id === 'wild' && index % 2 ? -1 : 1;
  return quantizeNumber(
    definition,
    bounds.min + span * clamp(original + recipe.mechanismShift * direction, 0, 1, original),
    bounds,
  );
};

const booleanForRecipe = (definition, recipe, index) => {
  if (recipe.booleanMode === 'on') return true;
  if (recipe.booleanMode === 'off') return false;
  if (recipe.booleanMode === 'alternate') return index % 2 === 0 ? !definition.default : definition.default;
  return definition.default;
};

const selectForRecipe = (definition, recipe) => {
  const original = definition.choices.findIndex(choice => choice.value === definition.default);
  return definition.choices[wrap(original + recipe.selectOffset, definition.choices.length)].value;
};

const dependencySafeDefinitions = study => {
  const definitions = getSequenceParameterDefinitions(study);
  if (study.archetype !== 'euclidean') return definitions;
  const slots = definitions.findIndex(definition => definition.id === 'euclideanSteps');
  const pulses = definitions.findIndex(definition => definition.id === 'pulses');
  if (slots < 0 || pulses < 0 || slots < pulses) return definitions;
  const ordered = [...definitions];
  const [definition] = ordered.splice(slots, 1);
  ordered.splice(pulses, 0, definition);
  return ordered;
};

const effectiveBounds = (study, definition, values) => (
  getSequenceParameterBounds(study, definition.id, values) || definition
);

function settingsValues(study, recipe) {
  const original = createSequenceParameterValues(study);
  if (recipe.id === 'original') return original;
  const values = { ...original };
  const cycleValues = {
    steps: original.steps * recipe.cycleScale,
    stepBeats: original.stepBeats * recipe.stepScale,
    density: recipe.density,
    gate: recipe.gate,
    swing: recipe.swing,
    transpose: recipe.transpose ?? original.transpose,
    seed: hashText(`${study.id}:${recipe.id}`),
  };
  const mechanismIndexes = new Map(getSequenceParameterDefinitions(study)
    .filter(definition => definition.group === 'mechanism')
    .map((definition, index) => [definition.id, index]));
  for (const definition of dependencySafeDefinitions(study)) {
    if (definition.group === 'cycle') {
      if (Object.hasOwn(cycleValues, definition.id)) {
        values[definition.id] = definition.type === 'number'
          ? quantizeNumber(definition, cycleValues[definition.id], effectiveBounds(study, definition, values))
          : cycleValues[definition.id];
      }
      continue;
    }
    const index = mechanismIndexes.get(definition.id);
    if (definition.type === 'number') {
      const bounds = effectiveBounds(study, definition, values);
      values[definition.id] = shiftedNumber(definition, recipe, index, bounds, values[definition.id]);
    } else if (definition.type === 'boolean') {
      values[definition.id] = booleanForRecipe(definition, recipe, index);
    } else {
      values[definition.id] = selectForRecipe(definition, recipe);
    }
  }
  return createSequenceParameterValues(study, values);
}

/** Build the six complete, mechanism-aware settings presets for one study. */
export function createSequenceSettingsPresets(studyOrId) {
  const study = resolveStudy(studyOrId);
  return deepFreeze(SEQUENCE_SETTING_RECIPES.map(recipe => ({
    id: `${study.id}:${recipe.id}`,
    label: recipe.label,
    description: recipe.description,
    snapshot: sanitizeSequencePerformance({
      id: study.id,
      parameters: settingsValues(study, recipe),
      tempoBpm: study.defaults.tempoBpm * recipe.tempoScale,
    }),
  })));
}

export const SEQUENCE_SETTINGS_PRESETS = deepFreeze(Object.fromEntries(
  SEQUENCE_STUDIES.map(study => [study.id, createSequenceSettingsPresets(study)]),
));

/** Apply one factory settings recipe without changing the selected study. */
export function applySequenceSettingsRecipe(sequence, recipeOrId) {
  const current = sanitizeSequencePerformance(sequence);
  const recipe = recipeFor(recipeOrId);
  return SEQUENCE_SETTINGS_PRESETS[current.id].find(preset => preset.id.endsWith(`:${recipe.id}`)).snapshot;
}

const randomNumberValue = (definition, bounds, rng) => {
  const count = Math.floor(Number(((bounds.max - bounds.min) / definition.step).toPrecision(12)));
  const index = Math.min(count, Math.floor(unit(rng) * (count + 1)));
  return quantizeNumber(definition, bounds.min + index * definition.step, bounds);
};

/** Randomize every exposed cycle and mechanism parameter for one study. */
export function randomizeSequenceParameters(studyOrId, inputOrRng = {}, maybeRng = Math.random) {
  const study = resolveStudy(studyOrId);
  const rng = typeof inputOrRng === 'function' ? inputOrRng : maybeRng;
  const input = typeof inputOrRng === 'function' ? {} : inputOrRng;
  const values = { ...createSequenceParameterValues(study, input) };
  for (const definition of dependencySafeDefinitions(study)) {
    if (definition.type === 'number') {
      values[definition.id] = randomNumberValue(definition, effectiveBounds(study, definition, values), rng);
    }
    else if (definition.type === 'boolean') values[definition.id] = unit(rng) >= .5;
    else values[definition.id] = pick(definition.choices, rng).value;
  }
  return createSequenceParameterValues(study, values);
}

/** Randomize settings and tempo while retaining the sequence identity. */
export function randomizeSequenceSettings(sequence, rng = Math.random) {
  const current = sanitizeSequencePerformance(sequence);
  return sanitizeSequencePerformance({
    id: current.id,
    parameters: randomizeSequenceParameters(current.id, current.parameters, rng),
    tempoBpm: MIN_RANDOM_TEMPO + (MAX_RANDOM_TEMPO - MIN_RANDOM_TEMPO) * unit(rng),
  });
}

export function nextSequenceId(currentId, direction = 1) {
  const index = SEQUENCE_STUDIES.findIndex(study => study.id === currentId);
  if (index < 0) return direction < 0 ? SEQUENCE_STUDIES.at(-1).id : SEQUENCE_STUDIES[0].id;
  return SEQUENCE_STUDIES[wrap(index + (direction < 0 ? -1 : 1), SEQUENCE_STUDIES.length)].id;
}

export const randomSequenceId = (rng = Math.random) => pick(SEQUENCE_STUDIES, rng).id;

export function nextTuningId(currentId, direction = 1) {
  const index = TUNINGS.findIndex(tuning => tuning.id === currentId);
  if (index < 0) return direction < 0 ? TUNINGS.at(-1).id : TUNINGS[0].id;
  return TUNINGS[wrap(index + (direction < 0 ? -1 : 1), TUNINGS.length)].id;
}

export const randomTuningId = (rng = Math.random) => pick(TUNINGS, rng).id;

/**
 * Reduce current UI state to the complete musical state owned by a master
 * preset. Output level, mono/poly choice, transport, Audio and device state are
 * intentionally absent.
 */
export function capturePerformanceSnapshot(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const incomingSound = source.sound ?? source.state ?? source;
  const method = resolveSynthesisMethod(incomingSound?.methodId);
  const sound = captureSoundState(sanitizeState({ ...incomingSound, methodId: method.id }));
  const tuningId = sanitizeTuningId(source.tuningId ?? incomingSound?.tuningId);
  const sequence = sanitizeSequencePerformance(source.sequence ?? source.sequenceState ?? {});
  return deepFreeze({ sound, sequence, tuningId });
}

/** Restore a master snapshot while retaining performer-owned output and voicing. */
export function applyPerformanceSnapshot(snapshot, currentSound = {}) {
  const captured = capturePerformanceSnapshot(snapshot);
  const performer = sanitizeState(currentSound);
  const sound = sanitizeState({
    ...captured.sound,
    outputLevel: performer.outputLevel,
    voiceMode: performer.voiceMode,
    tuningId: captured.tuningId,
  });
  return deepFreeze({ sound, sequence: captured.sequence, tuningId: captured.tuningId });
}

export const MASTER_PRESET_RECIPES = deepFreeze([
  ['ratio-sunrise', 'Ratio sunrise', 'additive', 'eight-part-saw', 'perforated-ratio-canon', 'spacious', 'just-5-limit-major'],
  ['euclidean-tines', 'Euclidean tines', 'fm', 'electric-tine', 'rotating-euclidean-chords', 'tight', 'edo-19'],
  ['pythagorean-pluck', 'Pythagorean pluck', 'karplus-strong', 'natural-string-pluck', 'rising-latched-chord', 'original', 'pythagorean-12'],
  ['gesture-reed', 'Gesture reed', 'waveguide', 'soft-breathy-pipe', 'captured-control-gesture', 'spacious', 'japanese-yo-12edo'],
  ['slendro-cloud', 'Sléndro cloud', 'granular', 'frozen-cloud', 'density-breathing-stream', 'sparse', 'javanese-slendro-5edo-model'],
  ['pelog-plate', 'Pélog plate', 'modal', 'metal-plate', 'co-prime-lane-cycle', 'dense', 'javanese-pelog-9edo-model'],
  ['lü-vowel-weave', 'Lü vowel weave', 'fof', 'open-low-vowel', 'multiplexed-phrase-arp', 'spacious', 'chinese-twelve-lu'],
  ['meantone-strings', 'Meantone strings', 'padsynth', 'wide-string-ensemble', 'interlocking-live-streams', 'sparse', 'quarter-comma-meantone'],
  ['timbila-step-light', 'Timbila step light', 'wavetable', 'bright-saw', 'accented-step-line', 'tight', 'chopi-timbila-7edo-model'],
  ['thirty-one-bar', 'Thirty-one division bar', 'physical', 'balanced-elastic-bar', 'pulse-divider-chain', 'dense', 'edo-31'],
  ['ambassel-vector', 'Ambassel vector', 'vector-phase', 'narrow-phase-reed', 'groove-template-shift', 'wild', 'amhara-ambassel-12edo-map'],
  ['tritave-chamber', 'Tritave chamber', 'fdn-resonator', 'long-metal-chamber', 'nested-event-phrases', 'spacious', 'bohlen-pierce-13edt'],
  ['harmonic-formants', 'Harmonic formants', 'formant-voice', 'ah-cascade', 'edited-gesture-loop', 'original', 'harmonic-8-16'],
  ['thirteen-orbit', 'Thirteen division orbit', 'rossler', 'slow-irregular-drone', 'bounded-random-walk', 'sparse', 'edo-13'],
  ['twenty-two-beads', 'Twenty-two division beads', 'particle-shaker', 'dense-maraca-texture', 'recurring-conditional-steps', 'tight', 'edo-22'],
  ['fifty-three-sync', 'Fifty-three division sync', 'hard-sync', 'classic-synced-saw', 'octave-spread-cycle', 'wild', 'edo-53'],
].map(([id, label, methodId, presetId, sequenceId, settingsId, tuningId]) => ({
  id,
  label,
  methodId,
  presetId,
  sequenceId,
  settingsId,
  tuningId,
})));

const createMasterPreset = recipe => {
  const method = SYNTHESIS_METHODS.find(candidate => candidate.id === recipe.methodId);
  if (!method) throw new RangeError(`Master preset ${recipe.id} names unknown synthesis method ${recipe.methodId}`);
  const preset = method.presets.find(candidate => candidate.id === recipe.presetId);
  if (!preset) throw new RangeError(`Master preset ${recipe.id} names unknown sound preset ${recipe.presetId}`);
  const study = getSequenceStudy(recipe.sequenceId);
  if (!study) throw new RangeError(`Master preset ${recipe.id} names unknown sequence ${recipe.sequenceId}`);
  const tuning = TUNINGS.find(candidate => candidate.id === recipe.tuningId);
  if (!tuning) throw new RangeError(`Master preset ${recipe.id} names unknown tuning ${recipe.tuningId}`);
  const settings = SEQUENCE_SETTINGS_PRESETS[study.id].find(candidate => candidate.id.endsWith(`:${recipe.settingsId}`));
  if (!settings) throw new RangeError(`Master preset ${recipe.id} names unknown settings ${recipe.settingsId}`);
  return deepFreeze({
    id: recipe.id,
    label: recipe.label,
    description: `${method.label} · ${study.label} · ${tuning.label}.`,
    snapshot: capturePerformanceSnapshot({
      sound: stateFromPreset(method.id, preset.id),
      sequence: settings.snapshot,
      tuningId: tuning.id,
    }),
  });
};

export const SYNTHESAURUS_MASTER_PRESETS = deepFreeze(MASTER_PRESET_RECIPES.map(createMasterPreset));

const assertFiniteTree = (value, path = 'snapshot') => {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) assertFiniteTree(child, `${path}.${key}`);
};

/** Validate the storage and ownership contract expected by the master UI. */
export function validatePerformancePresetBank(bank = SYNTHESAURUS_MASTER_PRESETS) {
  if (!Array.isArray(bank) || bank.length < 12) throw new RangeError('Synthesaurus needs at least 12 complete master presets');
  const ids = new Set();
  const snapshots = new Set();
  for (const preset of bank) {
    if (!preset || typeof preset !== 'object') throw new TypeError('Master presets must be objects');
    if (!preset.id || ids.has(preset.id)) throw new RangeError(`Duplicate or missing master preset ID: ${preset.id}`);
    ids.add(preset.id);
    if (typeof preset.label !== 'string' || !preset.label.trim()) throw new TypeError(`Master preset ${preset.id} needs a label`);
    assertFiniteTree(preset.snapshot, `${preset.id}.snapshot`);
    const captured = capturePerformanceSnapshot(preset.snapshot);
    const encoded = JSON.stringify(captured);
    if (encoded !== JSON.stringify(preset.snapshot)) throw new TypeError(`Master preset ${preset.id} is not a sanitized performance snapshot`);
    if (snapshots.has(encoded)) throw new RangeError(`Master preset ${preset.id} duplicates another snapshot`);
    snapshots.add(encoded);
    if (!SYNTHESIS_METHODS.some(method => method.id === captured.sound.methodId)) throw new TypeError(`Master preset ${preset.id} is not a synthesis scene`);
    for (const key of ['outputLevel', 'voiceMode', 'tuningId', 'source', 'audioEnabled', 'playing', 'transport', 'midi']) {
      if (Object.hasOwn(captured.sound, key) || Object.hasOwn(captured, key) && key !== 'tuningId') {
        throw new TypeError(`Master preset ${preset.id} owns performer/runtime field ${key}`);
      }
    }
  }
  return true;
}

validatePerformancePresetBank();

export function instantiateMasterPreset(presetOrId, currentSound = {}) {
  const id = typeof presetOrId === 'string' ? presetOrId : presetOrId?.id;
  const preset = SYNTHESAURUS_MASTER_PRESETS.find(candidate => candidate.id === id);
  if (!preset) throw new RangeError(`Unknown Synthesaurus master preset: ${id}`);
  return applyPerformanceSnapshot(preset.snapshot, currentSound);
}

/**
 * Full master dice: independently chooses and randomizes synthesis, a
 * historical sequence (including every exposed setting and tempo), and tuning.
 */
export function randomizeMasterPerformance(value = {}, rng = Math.random) {
  const source = value && typeof value === 'object' ? value : {};
  const performer = sanitizeState(source.sound ?? source.state ?? source);
  // Select all three axes first so their identity does not depend on how many
  // parameters a particular synthesis method happens to expose.
  const method = pick(SYNTHESIS_METHODS, rng);
  const study = pick(SEQUENCE_STUDIES, rng);
  const tuning = pick(TUNINGS, rng);
  const voiceMode = pick(['mono', 'poly'], rng);
  const initial = {
    ...createDefaultState(method.id),
    outputLevel: performer.outputLevel,
    voiceMode,
    tuningId: tuning.id,
  };
  const sound = randomizeState(initial, rng);
  const sequence = randomizeSequenceSettings({ id: study.id }, rng);
  return applyPerformanceSnapshot(
    { sound, sequence, tuningId: tuning.id },
    { ...performer, voiceMode },
  );
}
