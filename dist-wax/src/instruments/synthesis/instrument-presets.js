import { createDefaultState, sanitizeState } from './catalog.js';
import { captureSoundState, SECTION_PRESETS } from './presets.js';
import { SYNTHESAURUS_MASTER_PRESETS, sanitizeSequencePerformance, randomizeMasterPerformance } from './performance-presets.js';
import { compileSequence } from './sequence-compiler.js';
import { sanitizeSignalPath } from './signal-path.js';
import { randomizeAllState } from './presets.js';
import { isVoiceInput, voicePresetsForInput, randomizeVoiceInputState } from './voice-input-state.js';

const directModes = new Set(['none', 'basic-up', 'basic-down', 'basic-up-down']);
const bounded = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

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

export const INSTRUMENT_PRESETS = [
  ...SYNTHESAURUS_MASTER_PRESETS.map((preset, index) => ({
    ...preset,
    snapshot: captureInstrumentPreset({ ...preset.snapshot, voiceMode: [1, 4, 5, 7, 11].includes(index) ? 'poly' : 'mono' }),
  })),
  ...SECTION_PRESETS.processing.filter((preset, index, bank) => index === 0 || bank[index - 1].snapshot.methodId !== preset.snapshot.methodId)
    .map(preset => ({ ...preset, id: `instrument:${preset.id}`, snapshot: captureInstrumentPreset({ sound: preset.snapshot }) })),
];

/** Voice inputs replace the regular instrument tour with their native scenes. */
export function instrumentPresetsForInput(input) {
  if (!isVoiceInput(input)) return INSTRUMENT_PRESETS;
  const sound = createDefaultState('fx-reverb');
  return voicePresetsForInput(input).map(preset => ({
    id: `voice:${input}:${preset.id}`, label: preset.label,
    snapshot: captureInstrumentPreset({ sound,
      routing: { input, voice: preset.state, effect: sound, effectEnabled: false, loop: true },
    }),
  }));
}

export function randomizeInstrumentPreset(value, rng = Math.random) {
  if (isVoiceInput(value?.routing?.input)) {
    const routing = sanitizeSignalPath(value.routing, value.sound);
    const effect = randomizeAllState(routing.effect, rng);
    return captureInstrumentPreset({ ...value, sound: effect, routing: {
      ...routing, effect, effectEnabled: rng() > .5, loop: rng() > .5,
      voice: randomizeVoiceInputState(routing.voice, routing.input, rng),
    } });
  }
  const next = randomizeMasterPerformance(value, rng);
  const routing = sanitizeSignalPath(value?.routing, next.sound);
  const effect = randomizeAllState(routing.effect, rng);
  // Randomization never opens a microphone or a local file. Its note-generating
  // source is the randomized synthesizer; the insert explores processor settings.
  return captureInstrumentPreset({ ...next, sound: fitRandomAttackToSequence(next.sound, next.sequence), voiceMode: next.sound.voiceMode,
    routing: { input: 'synthesis', effectEnabled: rng() > .5, loop: rng() > .5, effect } });
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
