import { createDefaultState, getMethod, sanitizeState } from './catalog.js';
import { PROCESSING_INPUT_OPTIONS, getProcessingInput } from './demo-sources.js';

export const INPUT_CATEGORIES = Object.freeze([
  { id: 'synthesis', label: 'Synthesizer' },
  { id: 'microphone', label: 'Mic / audio in' },
  { id: 'file', label: 'Audio file' },
  { id: 'samples', label: 'Sample loops' },
  { id: 'signals', label: 'Test signals' },
].map(Object.freeze));

export function inputCategoryFor(id) {
  const kind = getProcessingInput(id)?.kind;
  return kind === 'demo' ? 'samples' : kind === 'signal' ? 'signals' : kind === 'file' ? 'file' : kind === 'microphone' ? 'microphone' : 'synthesis';
}

export function inputsForCategory(category) {
  return PROCESSING_INPUT_OPTIONS.filter(option => inputCategoryFor(option.id) === category);
}

export function presetSignal(source = 3) {
  return PROCESSING_INPUT_OPTIONS.find(option => option.kind === 'signal' && option.source === source)?.id ?? 'noise';
}

/** Versioned musical routing only. Never stores files, streams, Audio or clocks. */
export function sanitizeSignalPath(value = {}, sound = createDefaultState()) {
  if (!value || typeof value !== 'object') value = {};
  const processing = getMethod(sound.methodId).kind === 'processor';
  const effect = getMethod(value.effect?.methodId).kind === 'processor'
    ? sanitizeState(value.effect) : processing ? sanitizeState(sound) : createDefaultState('fx-reverb');
  // In this version sound holds the active generator OR external processor.
  // Reject cross-kind paths rather than restoring a menu that disagrees with DSP.
  const category = !processing ? 'synthesis' : INPUT_CATEGORIES.some(item => item.id === value.input && item.id !== 'synthesis') ? value.input : 'signals';
  const options = inputsForCategory(category);
  const selection = options.some(item => item.id === value.selection) ? value.selection
    : category === 'signals' ? presetSignal(sound.source) : options[0]?.id ?? null;
  const { outputLevel, voiceMode, tuningId, ...effectSound } = effect;
  return { version: 1, input: category, selection, loop: value.loop !== false,
    effectEnabled: category !== 'synthesis' || value.effectEnabled === true, effect: effectSound };
}
