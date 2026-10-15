import {
  SIMD_RESONATOR_DEFAULTS, SIMD_RESONATOR_LIMITS,
  sanitizeSimdResonatorSettings, createSimdResonatorConfiguration,
} from '../../simd-resonator.js';

export const MAX_MODES = 4096;
export const BLOCK_SIZE = 128;
export const COEFFICIENT_KEYS = Object.freeze(['cosine', 'sine', 'decay', 'strike', 'gain', 'panLeft', 'panRight']);
export const DEFAULTS = Object.freeze({ ...SIMD_RESONATOR_DEFAULTS, modeCount: 512, spectralSpan: 128 });
export const LIMITS = Object.freeze({ ...SIMD_RESONATOR_LIMITS, modeCount: [32, MAX_MODES], spectralSpan: [8, 512] });
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
export function sanitizeSettings(value = {}) {
  return Object.freeze({
    ...sanitizeSimdResonatorSettings(value),
    modeCount: clamp(Math.round(finite(value.modeCount, DEFAULTS.modeCount) / 4) * 4, 32, MAX_MODES),
    spectralSpan: clamp(finite(value.spectralSpan, DEFAULTS.spectralSpan), 8, 512),
  });
}

// Fractional modal orders fill a fixed spectral span. At span=count<=128 the
// original frequency, excitation, damping, stereo and normalization are exact.
export function createConfiguration(value = {}, rate = 48000) {
  const settings = sanitizeSettings(value);
  const sampleRate = clamp(finite(rate, 48000), 8000, 384000);
  const reference = createSimdResonatorConfiguration({ ...settings, modeCount: Math.min(settings.modeCount, 128) }, sampleRate);
  const arrays = Object.fromEntries(COEFFICIENT_KEYS.map(key => [key, new Float32Array(MAX_MODES)]));
  const frequencies = new Float32Array(MAX_MODES);
  const brightness = 5 + settings.hardness * 91;
  let audibleModes = 0, energy = 0, referenceEnergy = 0;
  for (let i = 0; i < reference.modeCount; i++) referenceEnergy += (reference.strike[i] * reference.gain[i]) ** 2;
  for (let i = 0; i < settings.modeCount; i++) {
    const order = 1 + i * (settings.spectralSpan - 1) / (settings.modeCount - 1);
    const index = order - 1;
    const stiffness = 1 + settings.spread * .00016 * index * index;
    const irregularity = 1 + settings.spread * .006 * Math.sin(order * 2.399963);
    const frequency = settings.baseFrequency * order * Math.sqrt(stiffness) * irregularity;
    const audible = frequency < sampleRate * .44;
    const phase = Math.PI * 2 * Math.min(frequency, sampleRate * .44) / sampleRate;
    const lifetime = Math.max(.08, settings.decaySeconds / (1 + index * (.006 + settings.spread * .012)));
    const pan = Math.sin(order * 1.61803398875) * .68;
    frequencies[i] = frequency;
    arrays.cosine[i] = Math.cos(phase); arrays.sine[i] = Math.sin(phase);
    arrays.decay[i] = Math.exp(-1 / (sampleRate * lifetime));
    arrays.strike[i] = audible ? Math.sin(Math.PI * order * settings.strikePosition) * Math.exp(-index / brightness) : 0;
    arrays.gain[i] = audible ? 1 / Math.sqrt(order) : 0;
    arrays.panLeft[i] = Math.sqrt((1 - pan) * .5); arrays.panRight[i] = Math.sqrt((1 + pan) * .5);
    energy += (arrays.strike[i] * arrays.gain[i]) ** 2;
    if (audible) audibleModes++;
  }
  const classic = settings.modeCount <= 128 && settings.spectralSpan === settings.modeCount;
  const outputScale = classic ? reference.outputScale
    : Math.min(.6, reference.outputScale * Math.sqrt(referenceEnergy / Math.max(energy, 1e-12)));
  return { ...reference, ...arrays, settings, sampleRate, modeCount: settings.modeCount,
    audibleModes, outputScale, frequencies };
}

export const POINTERS = Object.freeze({ input: 'input_ptr', outputLeft: 'output_left_ptr', outputRight: 'output_right_ptr',
  real: 'real_ptr', imaginary: 'imaginary_ptr', energy: 'energy_ptr',
  ...Object.fromEntries(COEFFICIENT_KEYS.map(key => [key, key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase()) + '_ptr'])),
});
export function kernelViews(exports) {
  if (!(exports.memory instanceof WebAssembly.Memory) || exports.max_modes?.() !== MAX_MODES
    || exports.block_size?.() !== BLOCK_SIZE || exports.abi_version?.() !== 1) throw new Error('Unexpected Rust resonator ABI.');
  return { exports, ...Object.fromEntries(Object.entries(POINTERS).map(([key, pointer]) => {
    if (typeof exports[pointer] !== 'function') throw new Error('Missing Rust resonator array: ' + key);
    return [key, new Float32Array(exports.memory.buffer, exports[pointer](), ['input', 'outputLeft', 'outputRight'].includes(key) ? BLOCK_SIZE : MAX_MODES)];
  })) };
}
