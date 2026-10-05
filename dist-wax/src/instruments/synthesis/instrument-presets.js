import { createDefaultState, sanitizeState } from './catalog.js';
import { captureSoundState, SECTION_PRESETS } from './presets.js';
import { SYNTHESAURUS_MASTER_PRESETS, sanitizeSequencePerformance, randomizeMasterPerformance } from './performance-presets.js';
import { compileSequence } from './sequence-compiler.js';
import { sanitizeSignalPath, inputsForCategory } from './signal-path.js';
import { randomizeAllState } from './presets.js';
import { isVoiceInput, voicePresetsForInput, randomizeVoiceInputState } from './voice-input-state.js';

const directModes = new Set(['none', 'basic-up', 'basic-down', 'basic-up-down']);
const bounded = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
export const RANDOMIZABLE_INPUTS = Object.freeze(['synthesis', 'speech', 'singing', 'samples', 'signals']);
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

const regularPresets = [
  ...SYNTHESAURUS_MASTER_PRESETS.map((preset, index) => ({
    ...preset,
    snapshot: captureInstrumentPreset({ ...preset.snapshot, voiceMode: [1, 4, 5, 7, 11].includes(index) ? 'poly' : 'mono' }),
  })),
  ...SECTION_PRESETS.processing.filter((preset, index, bank) => index === 0 || bank[index - 1].snapshot.methodId !== preset.snapshot.methodId)
    .map(preset => ({ ...preset, id: `instrument:${preset.id}`, snapshot: captureInstrumentPreset({ sound: preset.snapshot }) })),
];

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

function sourceTour(input) {
  return inputsForCategory(input).map((source, index) => {
    const effect = createDefaultState(['fx-reverb', 'fx-delay', 'fx-modulated-delay'][index % 3]);
    effect.source = source.source; effect.wet = .3; effect.inputDb = -3; effect.outputDb = -3;
    return {
      id: `input:${source.id}`, label: `${source.label} · ${input === 'samples' ? 'Sample loop' : 'Test signal'}`,
      snapshot: captureInstrumentPreset({ sound: effect,
        routing: { input, selection: source.id, effect, effectEnabled: true, loop: true } }),
    };
  });
}

const tours = [regularPresets.filter(preset => preset.snapshot.routing.input === 'synthesis'),
  voiceTour('speech'), voiceTour('singing'), sourceTour('samples'),
  [...sourceTour('signals'), ...regularPresets.filter(preset => preset.snapshot.routing.input === 'signals')]];

// Spread shorter tours throughout longer ones instead of exhausting one family
// before the next. The first five recalls introduce all five eligible sources.
export const INSTRUMENT_PRESETS = Object.freeze(tours.flatMap((bank, family) => bank.map((preset, index) => ({
  preset, family, position: index / bank.length,
}))).sort((a, b) => a.position - b.position || a.family - b.family).map(entry => entry.preset));

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
  if (input === 'samples' || input === 'signals') {
    if (input === 'samples') routing.loop = true;
    const source = pick(inputsForCategory(input), r);
    effect.source = source.source;
    effect.frequencyHz = 55 * (24 ** r());
    return captureInstrumentPreset({ sound: effect, routing: { ...routing, selection: source.id } });
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
  return sanitizeState({ ...sound, envelope: { ...sound.envelope,
    attack: Math.min(sound.envelope.attack, Math.max(.001, median * .25)),
  } });
}
