// Rezoidinator control settings. All audio processing executes in Rust.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const STAGE_ORDERS = Object.freeze(['process-resonance-reverb', 'process-reverb-resonance',
  'reverb-process-resonance', 'resonance-process-reverb', 'resonance-reverb-process', 'reverb-resonance-process']);
export const SIGNAL_DEFAULTS = Object.freeze({ stageOrder: STAGE_ORDERS[0], bodyEnabled: true, processingEnabled: false,
  resynthesisEnabled: false, reverbEnabled: false, bodyMix: 1, resynthesisMix: .94, wetMix: 1,
  filterType: 'lowpass', filterFrequency: 8000, drive: 1, reverbTime: 1.8,
  reverbDamping: .45, reverbMix: .4 });
export const SIGNAL_LIMITS = Object.freeze({ bodyMix: [0, 1], resynthesisMix: [0, 1], wetMix: [0, 1],
  filterFrequency: [20, 20000], drive: [1, 24], reverbTime: [.12, 12],
  reverbDamping: [0, .98], reverbMix: [0, 1] });
export const FILTER_TYPES = Object.freeze(['lowpass', 'highpass', 'bandpass', 'bypass']);
export const EXCITATION_TYPES = Object.freeze(['impulse', 'white-noise', 'pink-noise', 'pluck', 'soft-mallet', 'hard-mallet']);
export const EXCITATION_DEFAULTS = Object.freeze({ kind: 'pluck', strength: .8, durationMs: 18 });
export const EXCITATION_LIMITS = Object.freeze({ strength: [0, 1.5], durationMs: [1, 300] });
const ENABLE_KEYS = ['bodyEnabled', 'processingEnabled', 'resynthesisEnabled', 'reverbEnabled'];
export function sanitizeSignalSettings(value = {}) {
  const settings = {};
  for (const key of ENABLE_KEYS) settings[key] = value[key] === undefined ? SIGNAL_DEFAULTS[key] : Boolean(value[key]);
  for (const [key, [low, high]] of Object.entries(SIGNAL_LIMITS)) settings[key] = clamp(finite(value[key], SIGNAL_DEFAULTS[key]), low, high);
  settings.filterType = FILTER_TYPES.includes(value.filterType) ? value.filterType : SIGNAL_DEFAULTS.filterType;
  settings.stageOrder = STAGE_ORDERS.includes(value.stageOrder) ? value.stageOrder : SIGNAL_DEFAULTS.stageOrder;
  return settings;
}
export function sanitizeExcitation(value = {}) {
  return { kind: EXCITATION_TYPES.includes(value.kind) ? value.kind : EXCITATION_DEFAULTS.kind,
    strength: clamp(finite(value.strength, EXCITATION_DEFAULTS.strength), 0, 1.5),
    durationMs: clamp(finite(value.durationMs, EXCITATION_DEFAULTS.durationMs), 1, 300) };
}
