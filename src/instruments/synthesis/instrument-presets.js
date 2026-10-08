import { METHODS, createDefaultState, sanitizeState, stateFromPreset } from './catalog.js';
import { captureSoundState } from './presets.js';
import { SYNTHESAURUS_MASTER_PRESETS, SEQUENCE_SETTINGS_PRESETS, sanitizeSequencePerformance, randomizeMasterPerformance } from './performance-presets.js';
import { compileSequence } from './sequence-compiler.js';
import { inputsForCategory, sanitizeSignalPath } from './signal-path.js';
import { randomizeAllState } from './presets.js';
import { isVoiceInput, voicePresetsForInput, withVoiceInputText, randomizeVoiceInputState } from './voice-input-state.js';
import { envelopeFromBreakpoints } from './envelope-shape.js';
import { TUNINGS } from './tunings.js';
import { getProcessingInput } from './demo-sources.js';
import { SYNTHESIS_PERFORMANCE_RECIPES, VOICE_PERFORMANCE_RECIPES, SAMPLE_PROCESSING_RECIPES } from './instrument-preset-recipes.js';
import { PERCUSSION_METHODS, createPercussionState, applyPercussionKit, applyPercussionRhythm, randomizePercussionKit, randomizePercussionRhythm } from './percussion-state.js';

const directModes = new Set(['none', 'basic-up', 'basic-down', 'basic-up-down']);
const bounded = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
// Give every unattended musical input an equal share of the main dice.
export const RANDOMIZABLE_INPUTS = Object.freeze(['synthesis', 'speech', 'singing', 'percussion', 'samples']);
const pick = (values, rng) => values[Math.min(values.length - 1, Math.floor(rng() * values.length))];

/** Complete musical recall; devices, output level and live transport stay owned by the performer. */
export function captureInstrumentPreset(value = {}) {
  const sound = sanitizeState(value.sound ?? value);
  const routing = sanitizeSignalPath(value.routing, sound);
  const voice = isVoiceInput(routing.input);
  const source = voice ? { id: 'none' } : routing.input === 'percussion' ? { ...value.sequence, id: 'none' } : value.sequence ?? { id: 'none' };
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
  snapshot: captureInstrumentPreset({ ...preset.snapshot,
    sound: performanceSound(preset.snapshot.sound, preset.snapshot.sequence),
    voiceMode: [1, 4, 5, 7, 11].includes(index) ? 'poly' : 'mono' }),
}));

function performanceSound(sound, sequence) {
  const fitted = fitRandomAttackToSequence(sound, sequence);
  // A long pad attack belongs to the local factory sound, but cannot open
  // inside a short sequencer gate. Mark this performance-specific edit honestly.
  if (JSON.stringify(fitted.envelope) !== JSON.stringify(sound.envelope)) fitted.presetId = 'custom';
  return fitted;
}

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

// Spread shorter tours throughout longer ones before the complete bank shuffle.
const mixTours = banks => banks.flatMap((bank, family) => bank.map((preset, index) => ({
  preset, family, position: index / bank.length,
}))).sort((a, b) => a.position - b.position || a.family - b.family).map(entry => entry.preset);

// A fixed Fisher–Yates shuffle makes the whole main tour repeatable across
// reloads without changing factory banks, preset IDs or musical snapshots.
function shuffledTour(presets) {
  const shuffled = [...presets];
  let seed = 0x53594e54;
  for (let index = shuffled.length - 1; index > 0; index--) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const target = Math.floor((seed >>> 0) / 4294967296 * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

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
  const sound = performanceSound(factory, sequence);
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
export const SAMPLE_INSTRUMENT_PRESETS = Object.freeze(SAMPLE_PROCESSING_RECIPES.map(
  ([id, label, selection, methodId, presetId, wet]) => {
    if (getProcessingInput(selection)?.kind !== 'demo') throw new RangeError(`Unknown bundled sample in instrument recipe: ${id}`);
    const factory = recipeSound(methodId, presetId, 'processor');
    const sound = sanitizeState({ ...factory, source: 0, wet, bypass: false,
      presetId: wet === factory.wet ? presetId : 'custom' });
    return { id: `sample:${id}`, label, snapshot: captureInstrumentPreset({ sound,
      voiceMode: 'mono', sequence: { id: 'none', tempoBpm: 120 },
      routing: { input: 'samples', selection, loop: true, effectEnabled: true, effect: sound },
    }) };
  },
));
export const ADDITIONAL_INSTRUMENT_PRESETS = Object.freeze(mixTours([
  SYNTHESIS_PERFORMANCE_RECIPES.map(createSynthesisRecipe),
  addedVoices.filter(preset => preset.snapshot.routing.input === 'speech'),
  addedVoices.filter(preset => preset.snapshot.routing.input === 'singing'),
  SAMPLE_INSTRUMENT_PRESETS,
]));
export const PERCUSSION_INSTRUMENT_PRESETS = Object.freeze(PERCUSSION_METHODS.flatMap((method, methodIndex) => method.kits.map((kit, index) => {
  const sound = sanitizeState({ ...createDefaultState('fx-reverb'), source: 0, wet: .18, inputDb: 0, outputDb: 0 });
  const percussion = applyPercussionRhythm(applyPercussionKit(createPercussionState(method.id), kit.id), method.rhythms[index % method.rhythms.length].id);
  return { id: `percussion:${method.id}:${kit.id}`, label: `${kit.label} · ${method.label}`,
    snapshot: captureInstrumentPreset({ sound, routing: { input: 'percussion', percussion, effect: sound, effectEnabled: false, loop: true },
      sequence: { id: 'none', tempoBpm: [112, 96, 128, 124, 86, 118][methodIndex] + index * 4 } }) };
})));
export const INSTRUMENT_PRESETS = Object.freeze(shuffledTour([...mixTours(tours), ...ADDITIONAL_INSTRUMENT_PRESETS, ...PERCUSSION_INSTRUMENT_PRESETS]));

/** Kept as a compatibility seam: Input no longer restricts the top-level tour. */
export function instrumentPresetsForInput() { return INSTRUMENT_PRESETS; }

export function randomizeInstrumentPreset(value, rng = Math.random) {
  const r = () => bounded(rng(), 0, .999999999, 0);
  const input = pick(RANDOMIZABLE_INPUTS, r);
  const effect = randomizeAllState(createDefaultState('fx-reverb'), r);
  // Always keep an audible dry component and headroom on newly drawn inputs.
  // Manual/local controls retain their full ranges, including fully-wet effects.
  effect.wet = .15 + .3 * r();
  effect.inputDb = -6 + 6 * r();
  // Vary processor drive, not two unrelated volume cuts (formerly up to
  // 15 dB combined). Coupled makeup preserves dry-path level and headroom.
  effect.outputDb = -effect.inputDb + (r() - .5);
  const routing = { input, effectEnabled: r() > .5, loop: r() > .5, effect };
  if (input === 'samples') {
    // Bundled loops are ready to play without a file or device. Keep the
    // recording audible alongside a freshly generated processor setting.
    effect.source = 0; effect.bypass = false;
    routing.selection = pick(inputsForCategory('samples'), r).id;
    routing.loop = true; routing.effectEnabled = true;
    return captureInstrumentPreset({ sound: effect, routing, voiceMode: 'mono', sequence: { id: 'none' } });
  }
  if (input === 'percussion') {
    effect.source = 0; routing.loop = true;
    routing.percussion = randomizePercussionRhythm(randomizePercussionKit(createPercussionState(pick(PERCUSSION_METHODS, r).id), r), r);
    return captureInstrumentPreset({ sound: effect, routing, sequence: { id: 'none', tempoBpm: Math.round(72 + 88 * r()) } });
  }
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
