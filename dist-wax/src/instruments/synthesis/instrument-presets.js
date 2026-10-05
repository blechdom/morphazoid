import { METHODS, createDefaultState, sanitizeState, stateFromPreset } from './catalog.js';
import { captureSoundState } from './presets.js';
import { SYNTHESAURUS_MASTER_PRESETS, SEQUENCE_SETTINGS_PRESETS, sanitizeSequencePerformance, randomizeMasterPerformance } from './performance-presets.js';
import { compileSequence } from './sequence-compiler.js';
import { sanitizeSignalPath } from './signal-path.js';
import { randomizeAllState } from './presets.js';
import { isVoiceInput, voicePresetsForInput, withVoiceInputText, randomizeVoiceInputState } from './voice-input-state.js';
import { envelopeFromBreakpoints } from './envelope-shape.js';
import { TUNINGS } from './tunings.js';
import { SYNTHESIS_PERFORMANCE_RECIPES, VOICE_PERFORMANCE_RECIPES } from './instrument-preset-recipes.js';

const directModes = new Set(['none', 'basic-up', 'basic-down', 'basic-up-down']);
const bounded = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
// Recorded loops and test fixtures remain explicit Input choices, not part of
// the musical preset tour or whole-instrument dice.
export const RANDOMIZABLE_INPUTS = Object.freeze(['synthesis', 'speech', 'singing']);
const pick = (values, rng) => values[Math.min(values.length - 1, Math.floor(rng() * values.length))];

/** Complete musical recall; devices, output level and live transport stay owned by the performer. */
export function captureInstrumentPreset(value = {}) {
  const sound = sanitizeState(value.sound ?? value);
  const routing = sanitizeSignalPath(value.routing, sound);
  const voice = isVoiceInput(routing.input);
  const source = voice ? { id: 'none' } : value.sequence ?? { id: 'none' };
  const sequence = directModes.has(source.id)
    ? { id: source.id, parameters: null, tempoBpm: Math.round(bounded(source.tempoBpm, 10, 1200, 120)) }
    : { ...sanitizeSequencePerformance(source) };
  return {
    sound: captureSoundState(sound),
    voiceMode: voice ? 'mono' : value.voiceMode ?? sound.voiceMode,
    tuningId: voice ? createDefaultState().tuningId : value.tuningId ?? sound.tuningId,
    routing,
    sequence: { ...sequence, gate: bounded(source.gate, 5, 95, 65) },
  };
}

const synthesisTour = SYNTHESAURUS_MASTER_PRESETS.map((preset, index) => ({
  ...preset,
  snapshot: captureInstrumentPreset({ ...preset.snapshot, voiceMode: [1, 4, 5, 7, 11].includes(index) ? 'poly' : 'mono' }),
}));

function voiceTour(input) {
  const sound = createDefaultState('fx-reverb');
  const seen = new Set();
  // One introduction per native engine; its complete bank remains beside Voice.
  return voicePresetsForInput(input).filter(preset => {
    const engine = preset.state.scene.engine;
    if (seen.has(engine)) return false;
    seen.add(engine); return true;
  }).map(preset => ({
    id: `voice:${input}:${preset.id}`, label: preset.label,
    snapshot: captureInstrumentPreset({ sound,
      routing: { input, voice: preset.state, effect: sound, effectEnabled: false, loop: true },
    }),
  }));
}

const tours = [synthesisTour, voiceTour('speech'), voiceTour('singing')];

// Spread shorter tours throughout longer ones instead of exhausting one family
// before the next. The first three recalls introduce all three musical sources.
const mixTours = banks => banks.flatMap((bank, family) => bank.map((preset, index) => ({
  preset, family, position: index / bank.length,
}))).sort((a, b) => a.position - b.position || a.family - b.family).map(entry => entry.preset);

// Unlike interactive selection, authored recipes must never silently fall back
// to another sound when a catalogue reference is misspelled or removed.
function recipeSound(methodId, presetId, kind) {
  const method = METHODS.find(item => item.id === methodId);
  if (!method || (method.kind === 'processor') !== (kind === 'processor') || !method.presets.some(item => item.id === presetId)) {
    throw new RangeError(`Unknown ${kind} preset in instrument recipe: ${methodId}:${presetId}`);
  }
  return stateFromPreset(methodId, presetId);
}

function recipeEffect(reference) {
  const [methodId, presetId] = (reference ?? 'fx-reverb:small-room').split(':');
  const sound = recipeSound(methodId, presetId, 'processor');
  // The source is the selected instrument, never a processor test signal. Keep
  // a generous dry component and the factory's calibrated, unboosted trims.
  return sanitizeState({ ...sound, source: 0, wet: Math.min(.35, sound.wet), bypass: false });
}

function createSynthesisRecipe([id, label, methodId, presetId, sequenceId, settingsId, tuningId, tempoBpm, voiceMode, insert]) {
  const settings = SEQUENCE_SETTINGS_PRESETS[sequenceId]?.find(item => item.id === `${sequenceId}:${settingsId}`);
  if (!settings || !TUNINGS.some(item => item.id === tuningId)) throw new RangeError(`Unknown sequence or tuning in instrument recipe: ${id}`);
  const sequence = { ...settings.snapshot, tempoBpm };
  const factory = recipeSound(methodId, presetId, 'synthesis');
  const sound = fitRandomAttackToSequence(factory, sequence);
  // Attack fitting is a real envelope edit; don't mislabel the local sound as
  // an unchanged factory patch. Preserve its measured level calibration.
  if (JSON.stringify(sound.envelope) !== JSON.stringify(factory.envelope)) sound.presetId = 'custom';
  return { id: `performance:${id}`, label, snapshot: captureInstrumentPreset({ sound, voiceMode, tuningId, sequence,
    routing: { input: 'synthesis', loop: true, effectEnabled: !!insert, effect: recipeEffect(insert) },
  }) };
}

const voiceFactories = new Map(['speech', 'singing'].map(input => [input, new Map(voicePresetsForInput(input).map(preset => [preset.id, preset]))]));
function createVoiceRecipe([id, label, input, presetId, text, insert, amplitudeScale = 1]) {
  const factory = voiceFactories.get(input)?.get(presetId);
  if (!factory) throw new RangeError(`Unknown voice preset in instrument recipe: ${id}`);
  const voice = text == null ? structuredClone(factory.state) : withVoiceInputText(factory.state, text);
  if (amplitudeScale !== 1) {
    // New STK lyrics can introduce stronger vowels than the factory's original
    // phone. Apply headroom to both the editable voice and each rendered note.
    voice.scene.values.amplitude *= amplitudeScale;
    for (const note of voice.scene.input.phrase?.notes ?? []) note.values.amplitude *= amplitudeScale;
  }
  const sound = recipeEffect(insert);
  return { id: `performance:${id}`, label, snapshot: captureInstrumentPreset({ sound,
    routing: { input, voice, loop: true, effectEnabled: !!insert, effect: sound },
  }) };
}

const addedVoices = VOICE_PERFORMANCE_RECIPES.map(createVoiceRecipe);
export const ADDITIONAL_INSTRUMENT_PRESETS = Object.freeze(mixTours([
  SYNTHESIS_PERFORMANCE_RECIPES.map(createSynthesisRecipe),
  addedVoices.filter(preset => preset.snapshot.routing.input === 'speech'),
  addedVoices.filter(preset => preset.snapshot.routing.input === 'singing'),
]));
// Keep the original tour's IDs, snapshots and ordering intact for saved links
// and familiar Next positions; the new mixed performances follow it.
export const INSTRUMENT_PRESETS = Object.freeze([...mixTours(tours), ...ADDITIONAL_INSTRUMENT_PRESETS]);

/** Kept as a compatibility seam: Input no longer restricts the top-level tour. */
export function instrumentPresetsForInput() { return INSTRUMENT_PRESETS; }

export function randomizeInstrumentPreset(value, rng = Math.random) {
  const r = () => bounded(rng(), 0, .999999999, 0);
  const input = pick(RANDOMIZABLE_INPUTS, r);
  const effect = randomizeAllState(createDefaultState('fx-reverb'), r);
  // Always keep an audible dry component and headroom on newly drawn inputs.
  // Manual/local controls retain their full ranges, including fully-wet effects.
  effect.wet = .15 + .5 * r(); effect.inputDb = -9 + 9 * r(); effect.outputDb = -6 + 6 * r();
  const routing = { input, effectEnabled: r() > .5, loop: r() > .5, effect };
  if (isVoiceInput(input)) {
    // Whole-instrument auditions must not end Play after a short phrase and
    // leave the following Next silent. One-shot remains an explicit Loop edit.
    routing.loop = true;
    effect.source = 0;
    routing.voice = randomizeVoiceInputState(value?.routing?.voice, input, r);
    return captureInstrumentPreset({ sound: effect, routing });
  }
  const next = randomizeMasterPerformance(value, r);
  return captureInstrumentPreset({ ...next, sound: fitRandomAttackToSequence(next.sound, next.sequence), voiceMode: next.sound.voiceMode,
    routing });
}

/** A randomized attack must open before a short arpeggiator gate closes. */
export function fitRandomAttackToSequence(sound, sequence) {
  if (!sequence?.id || sequence.id === 'none') return sound;
  const tempo = bounded(sequence.tempoBpm, 10, 1200, 120);
  const cycle = directModes.has(sequence.id) ? null : compileSequence(sequence.id, { parameters: sequence.parameters, tempo });
  const gates = cycle
    ? cycle.steps.flatMap(step => step.notes.map(note => step.duration * note.gate * 60 / tempo))
    : [60 / tempo * bounded(sequence.gate, 5, 95, 65) / 100];
  if (!gates.length) return sound;
  const median = gates.sort((a, b) => a - b)[Math.floor(gates.length / 2)];
  if (sound.envelope.points) {
    const points = sound.envelope.points.map(point => ({ ...point }));
    const scale = Math.min(1, Math.max(.001, median * .25) / Math.max(.001, points[1].time));
    const release = points[4].time - points[3].time;
    for (let index = 0; index < 4; index++) points[index].time *= scale;
    points[4].time = points[3].time + release;
    return sanitizeState({ ...sound, envelope: envelopeFromBreakpoints(points) });
  }
  return sanitizeState({ ...sound, envelope: { ...sound.envelope,
    attack: Math.min(sound.envelope.attack, Math.max(.001, median * .25)),
  } });
}
