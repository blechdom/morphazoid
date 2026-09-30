/**
 * Original, sample-free domino impacts. Broad contact transients and damped
 * body noise carry the sound; a small modal component supplies optional color.
 * These are expressive material approximations, not recorded specimens.
 */
const TAU = Math.PI * 2;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high, fallback = low) => Math.min(high, Math.max(low, finite(value, fallback)));

// Size changes the weight/color of a knock without turning a run into a scale.
export const IMPACT_SIZE_EXPONENT = 0.34;
export const MIN_IMPACT_HEIGHT = 0.03;
export const MAX_IMPACT_HEIGHT = 64;
export const DOMINO_MATERIALS = Object.freeze({
  stone: Object.freeze({ frequency: 420, decay: 0.015, maxDecay: 0.052, noise: 1.05, grit: 0.85,
    cutoff: 5800, edge: 720, transient: 0.0044, body: 2.6, color: 0.12,
    modes: [1, 1.63, 2.29, 3.47, 4.88, 6.37], weights: [1, 0.7, 0.46, 0.33, 0.25, 0.17] }),
  wood: Object.freeze({ frequency: 510, decay: 0.013, maxDecay: 0.05, noise: 0.96, grit: 0.45,
    cutoff: 4400, edge: 540, transient: 0.0041, body: 2.25, color: 0.10,
    modes: [1, 2.76, 5.4, 8.93, 13.34], weights: [1, 0.63, 0.38, 0.21, 0.1] }),
  ceramic: Object.freeze({ frequency: 930, decay: 0.011, maxDecay: 0.058, noise: 1.08, grit: 0.12,
    cutoff: 9400, edge: 1450, transient: 0.0028, body: 1.7, color: 0.14,
    modes: [1, 1.47, 2.09, 2.79, 3.82, 5.16], weights: [1, 0.64, 0.55, 0.37, 0.28, 0.17] }),
  glass: Object.freeze({ frequency: 1350, decay: 0.018, maxDecay: 0.105, noise: 1.0, grit: 0.04,
    cutoff: 10500, edge: 1900, transient: 0.0024, body: 1.15, color: 0.24,
    modes: [1, 1.39, 1.94, 2.58, 3.37, 4.65, 6.31], weights: [1, 0.62, 0.48, 0.36, 0.3, 0.2, 0.12] }),
  metal: Object.freeze({ frequency: 790, decay: 0.019, maxDecay: 0.145, noise: 1.03, grit: 0.10,
    cutoff: 9700, edge: 1200, transient: 0.0032, body: 1.6, color: 0.28,
    modes: [1, 1.43, 1.97, 2.67, 3.94, 5.61, 8.13], weights: [1, 0.8, 0.7, 0.58, 0.44, 0.32, 0.22] }),
  plastic: Object.freeze({ frequency: 670, decay: 0.007, maxDecay: 0.026, noise: 1.10, grit: 0.26,
    cutoff: 6900, edge: 1000, transient: 0.0035, body: 2.05, color: 0.055,
    modes: [1, 1.83, 3.26, 5.22, 7.89], weights: [1, 0.56, 0.36, 0.23, 0.12] }),
});

export function materialId(value) {
  const id = value === 'wooden' ? 'wood' : String(value);
  return Object.hasOwn(DOMINO_MATERIALS, id) ? id : 'stone';
}

export function impactFrequency(material, height = 1, type = 'contact', pitch = 0) {
  return DOMINO_MATERIALS[materialId(material)].frequency
    / clamp(height, MIN_IMPACT_HEIGHT, MAX_IMPACT_HEIGHT, 1) ** IMPACT_SIZE_EXPONENT
    * (type === 'floor' ? 0.42 : 1) * 2 ** (clamp(pitch, -36, 36, 0) / 12);
}

function broadBand(frequency, sampleRate, q = 0.72) {
  const omega = TAU * Math.min(sampleRate * 0.35, frequency) / sampleRate;
  const alpha = Math.sin(omega) / (2 * q);
  return { a1: -2 * Math.cos(omega) / (1 + alpha), a2: (1 - alpha) / (1 + alpha),
    b0: alpha / (1 + alpha), x1: 0, x2: 0, y1: 0, y2: 0 };
}
function bandSample(band, input) {
  const value = band.b0 * (input - band.x2) - band.a1 * band.y1 - band.a2 * band.y2;
  band.x2 = band.x1; band.x1 = input; band.y2 = band.y1; band.y1 = value;
  return value;
}

/** Deterministic mono PCM; energy 0..2, ring/brightness 0..1, pitch -36..36 semitones. */
export function renderImpact(material, height = 1, energy = 1, type = 'contact', options = {}) {
  const rate = Math.round(clamp(options.sampleRate, 8000, 96000, 48000));
  const ring = clamp(options.ring, 0, 1, 0.5);
  const bright = clamp(options.brightness, 0, 1, 0.5);
  const size = clamp(height, MIN_IMPACT_HEIGHT, MAX_IMPACT_HEIGHT, 1);
  const pitch = clamp(options.pitch, -36, 36, 0);
  const force = Math.sqrt(clamp(energy, 0, 2, 1));
  const model = DOMINO_MATERIALS[materialId(material)];
  const floor = type === 'floor';
  // Transpose the material bands at their native sample rate. The contact
  // envelope stays dry, and high pitches never speed PCM past its Nyquist limit.
  const sizeColor = size ** -IMPACT_SIZE_EXPONENT * 2 ** (pitch / 12);
  const frequency = impactFrequency(material, size, type, pitch);
  // The lower Ring range stays dry. Even maximum Ring uses heavily damped
  // short modes, with glass and metal retaining the clearest optional color.
  const ringAmount = ring * ring;
  const decay = (model.decay + (model.maxDecay - model.decay) * ringAmount)
    * size ** 0.12 * (floor ? 0.58 : 1);
  const bodyDecay = (floor ? 0.012 + model.grit * 0.01 : 0.0035 + model.grit * 0.003) * size ** 0.12;
  const duration = clamp(Math.max(decay * 7, bodyDecay * 8) + 0.012, 0.085, 1.25);
  const output = new Float32Array(Math.ceil(duration * rate));
  if (!force) return output;
  let random = (Math.trunc(finite(options.seed, 1)) >>> 0) || 1;
  const noise = () => {
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    return (random >>> 0) / 2147483648 - 1;
  };
  const modes = [];
  let sum = 0;
  model.modes.forEach((ratio, index) => {
    const hz = frequency * ratio * (1 + noise() * 0.018);
    if (hz > rate * 0.42) return;
    const weight = model.weights[index] * (0.35 + 0.65 * bright) ** (index * 0.35)
      * (floor ? 1 / (1 + index * 0.3) : 1);
    // Low-Q, noise-driven bands supply broad material color instead of
    // free-running sinusoidal pitches. High Ring opens a little more color.
    const q = 1.1 + ringAmount * (model.color > 0.2 ? 9 : 3.5);
    modes.push({ band: broadBand(hz, rate, q), weight });
    sum += weight;
  });
  const modalLevel = (0.018 + model.color * ringAmount) * 4 * (floor ? 0.7 : 1) / Math.max(1, sum);
  const modalPole = Math.exp(-1 / (rate * decay));
  const cutoff = Math.min(rate * 0.42, model.cutoff * sizeColor * (0.32 + bright * 1.22) * (floor ? 0.8 : 1));
  const edge = Math.min(cutoff * 0.7, model.edge * sizeColor * (0.6 + bright * 0.7));
  const lowpass = 1 - Math.exp(-TAU * cutoff / rate);
  const highpass = 1 - Math.exp(-TAU * edge / rate);
  const bodyBand = broadBand(frequency * (floor ? 1 : 0.78), rate, floor ? 0.64 : 0.85);
  const upperBand = broadBand(frequency * (floor ? 2.35 : 2.1), rate, 0.72);
  const noisePole = Math.exp(-1 / (rate * model.transient * (floor ? 0.65 : 1)));
  const bodyPole = Math.exp(-1 / (rate * bodyDecay));
  const scatterAt = Math.round(rate * (0.0015 + (noise() + 1) * 0.0012));
  const scatterPole = Math.exp(-1 / (rate * model.transient * 0.48));
  const dcPole = Math.exp(-TAU * 24 / rate);
  let noiseEnvelope = 1; let bodyEnvelope = 1; let scatterEnvelope = 0; let modalEnvelope = 1;
  let low = 0; let lower = 0; let prior = 0; let dc = 0;
  const fadeSamples = Math.round(rate * 0.007);
  for (let sample = 0; sample < output.length; sample += 1) {
    const white = noise();
    let resonance = 0;
    for (const mode of modes) resonance += bandSample(mode.band, white) * mode.weight;
    low += lowpass * (white - low);
    lower += highpass * (low - lower);
    if (sample === scatterAt) scatterEnvelope = 0.25 + model.grit * 0.18;
    const contact = (low - lower) * model.noise * (noiseEnvelope + scatterEnvelope);
    const body = (bandSample(bodyBand, white) + bandSample(upperBand, white) * (floor ? 0.25 : 0.5))
      * model.body * bodyEnvelope * (floor ? 1 : 0.34);
    noiseEnvelope *= noisePole; bodyEnvelope *= bodyPole; scatterEnvelope *= scatterPole; modalEnvelope *= modalPole;
    const attack = Math.min(1, sample / Math.max(1, rate * 0.00015));
    const tail = Math.min(1, (output.length - sample - 1) / fadeSamples);
    const value = ((contact * (floor ? 0.55 : 1) + body) * 0.92 + resonance * modalLevel * modalEnvelope) * force * attack * tail;
    dc = value - prior + dcPole * dc;
    prior = value;
    output[sample] = dc / (1 + Math.abs(dc));
  }
  output[output.length - 1] = 0;
  return output;
}
