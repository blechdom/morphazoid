// One-time character treatments of the licensed human OI/WOO recordings.
// Source provenance: assets/puggler/CREDITS.md. These are theatrical DSP voices,
// not recordings of nine actors, identity clones, or a physical vocal model.
const TAU = Math.PI * 2;
const bounded = (value, low, high, fallback) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : fallback));

// Pitch changes the complete recording's duration; no syllables are chopped or
// rearranged. Broad EQ colors the existing mouth resonances without synthesizing
// replacement vowels. Future performers add a restrained robotic sideband layer.
export const VOCAL_CHARACTERS = Object.freeze([
  { id: 'punk-puggler', skin: 'punk', owner: 0, name: 'Puggler', pitch: 0,
    highpass: 90, lowpass: 6200, colorHz: 760, colorDb: 2.5, colorQ: .7, edgeHz: 2300, edgeDb: 1.2,
    doubleMs: 10, doubleMix: .08, chorusMs: 0, chorusHz: 1, ringHz: 0, ringMix: 0, cadenceHz: 2.4, cadenceDepth: .03 },
  { id: 'punk-roxy', skin: 'punk', owner: 1, name: 'Roxy', pitch: 3,
    highpass: 150, lowpass: 7800, colorHz: 1500, colorDb: 3.2, colorQ: .8, edgeHz: 3200, edgeDb: 1.5,
    doubleMs: 17, doubleMix: .12, chorusMs: 0, chorusHz: 1, ringHz: 0, ringMix: 0, cadenceHz: 3.5, cadenceDepth: .04 },
  { id: 'punk-moss', skin: 'punk', owner: 2, name: 'Moss', pitch: -4,
    highpass: 60, lowpass: 4600, colorHz: 420, colorDb: 4.2, colorQ: .7, edgeHz: 1450, edgeDb: -2,
    doubleMs: 24, doubleMix: .16, chorusMs: 0, chorusHz: 1, ringHz: 0, ringMix: 0, cadenceHz: 1.8, cadenceDepth: .05 },
  { id: 'history-caveman', skin: 'history', owner: 0, name: 'Cavewoman', pitch: -7,
    highpass: 45, lowpass: 3300, colorHz: 310, colorDb: 4.5, colorQ: .8, edgeHz: 1800, edgeDb: -2.5,
    doubleMs: 33, doubleMix: .18, chorusMs: 0, chorusHz: 1, ringHz: 0, ringMix: 0, cadenceHz: 2.1, cadenceDepth: .06 },
  { id: 'history-dame-roxy', skin: 'history', owner: 1, name: 'Dame Roxy', pitch: 1,
    highpass: 125, lowpass: 6500, colorHz: 1100, colorDb: 4.5, colorQ: .9, edgeHz: 3400, edgeDb: -1,
    doubleMs: 21, doubleMix: .10, chorusMs: 0, chorusHz: 1, ringHz: 0, ringMix: 0, cadenceHz: 3, cadenceDepth: .08 },
  { id: 'history-maestro-moss', skin: 'history', owner: 2, name: 'Maestro Moss', pitch: 5,
    highpass: 160, lowpass: 8100, colorHz: 2200, colorDb: 3.5, colorQ: 1.2, edgeHz: 650, edgeDb: -2,
    doubleMs: 13, doubleMix: .07, chorusMs: 0, chorusHz: 1, ringHz: 0, ringMix: 0, cadenceHz: 5.3, cadenceDepth: .07 },
  { id: 'future-futureman', skin: 'future', owner: 0, name: 'Futureman', pitch: -2,
    highpass: 130, lowpass: 5700, colorHz: 920, colorDb: 4.8, colorQ: 1.2, edgeHz: 2400, edgeDb: -4,
    doubleMs: 19, doubleMix: .20, chorusMs: 1.2, chorusHz: 1.3, ringHz: 37, ringMix: .22, cadenceHz: 4, cadenceDepth: .08 },
  { id: 'future-cyberwoman', skin: 'future', owner: 1, name: 'Cyberwoman', pitch: 4,
    highpass: 220, lowpass: 8400, colorHz: 1850, colorDb: 5, colorQ: 1.3, edgeHz: 400, edgeDb: -3,
    doubleMs: 9, doubleMix: .22, chorusMs: 2.5, chorusHz: 2.1, ringHz: 73, ringMix: .14, cadenceHz: 6, cadenceDepth: .08 },
  { id: 'future-quor', skin: 'future', owner: 2, name: 'Quor', pitch: 8,
    highpass: 100, lowpass: 7000, colorHz: 560, colorDb: 6, colorQ: 1.6, edgeHz: 3100, edgeDb: -5,
    doubleMs: 27, doubleMix: .24, chorusMs: 4, chorusHz: 3.3, ringHz: 113, ringMix: .32, cadenceHz: 7.2, cadenceDepth: .10 },
].map(profile => Object.freeze(profile)));

export function vocalCharacter(skin = 'punk', owner = 0) {
  const canonicalSkin = ['punk', 'history', 'future'].includes(skin) ? skin : 'punk';
  const canonicalOwner = Number.isInteger(owner) && owner >= 0 && owner <= 2 ? owner : 0;
  return VOCAL_CHARACTERS.find(profile => profile.skin === canonicalSkin && profile.owner === canonicalOwner);
}

// RBJ biquad coefficients: https://www.w3.org/TR/audio-eq-cookbook/
// Direct form II transposed, in double precision; only the stored PCM is float32.
function filter(data, sampleRate, type, frequency, q = Math.SQRT1_2, db = 0) {
  const w = TAU * Math.min(sampleRate * .45, frequency) / sampleRate;
  const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peak') {
    const a = 10 ** (db / 40);
    b0 = 1 + alpha * a; b1 = -2 * cos; b2 = 1 - alpha * a;
    a0 = 1 + alpha / a; a1 = -2 * cos; a2 = 1 - alpha / a;
  } else {
    const high = type === 'highpass';
    b0 = (1 + (high ? cos : -cos)) / 2;
    b1 = (high ? -2 : 2) * b0; b2 = b0;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let z1 = 0, z2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i], y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y;
    data[i] = y;
  }
}

function sample(data, position) {
  if (position < 0 || position >= data.length) return 0;
  const index = Math.floor(position), fraction = position - index;
  return data[index] * (1 - fraction) + (data[index + 1] ?? 0) * fraction;
}

/**
 * Derive one complete character phrase, without Web Audio nodes or source edits.
 * Call once per decoded clip/character, then cache the returned mono buffer.
 * Pitch is semitones; delays/chorus are milliseconds; all profile values clamp.
 * Invalid PCM values become silence. Invalid container/rate or clips longer
 * than eight seconds throw before allocating output instead of truncating speech.
 */
export function renderCharacterVocal(input, sampleRate, profile = VOCAL_CHARACTERS[0]) {
  if (!(input instanceof Float32Array)) throw new TypeError('Character vocals require Float32Array PCM');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError('Character vocal sample rate must be 8000–192000 Hz');
  }
  if (input.length > sampleRate * 8) throw new RangeError('Character vocal input is limited to eight seconds');
  if (!input.length) return new Float32Array(0);
  const base = VOCAL_CHARACTERS[0];
  const p = profile && typeof profile === 'object' ? profile : base;
  const param = (key, low, high) => bounded(p[key], low, high, base[key]);
  const ratio = 2 ** (param('pitch', -12, 12) / 12);
  const delay = param('doubleMs', 6, 45) * sampleRate / 1000;
  const doubling = param('doubleMix', 0, .35);
  const chorus = param('chorusMs', 0, 6) * sampleRate / 1000;
  const chorusHz = param('chorusHz', .1, 6);
  const ringHz = param('ringHz', 0, 160), ringMix = param('ringMix', 0, .4);
  const cadenceHz = param('cadenceHz', .1, 10), cadenceDepth = param('cadenceDepth', 0, .18);
  const source = Float32Array.from(input, value => bounded(value, -1, 1, 0));
  let sourceEnergy = 0;
  for (const x of source) sourceEnergy += x * x;
  const sourceRms = Math.sqrt(sourceEnergy / source.length);
  // A low-pass before upward resampling reduces aliasing of mouth transients.
  // Downward resampling retains the source's available high-frequency detail.
  if (ratio > 1) filter(source, sampleRate, 'lowpass', sampleRate * .44 / ratio);
  const speechLength = Math.ceil(input.length / ratio);
  const output = new Float32Array(speechLength + Math.ceil(sampleRate * .09));
  for (let i = 0; i < speechLength; i++) output[i] = sample(source, i * ratio);
  filter(output, sampleRate, 'highpass', param('highpass', 30, 400));
  filter(output, sampleRate, 'peak', param('colorHz', 200, 3500), param('colorQ', .4, 2), param('colorDb', -6, 6));
  filter(output, sampleRate, 'peak', param('edgeHz', 300, 5000), .8, param('edgeDb', -6, 6));
  filter(output, sampleRate, 'lowpass', param('lowpass', 2200, 10000));
  const dry = output.slice();
  const fadeIn = Math.min(Math.round(sampleRate * .004), Math.floor(output.length / 2));
  const fadeOut = Math.min(Math.round(sampleRate * .025), Math.floor(output.length / 2));
  let peak = 0, energy = 0;
  for (let i = 0; i < output.length; i++) {
    const time = i / sampleRate;
    const delayed = sample(dry, i - delay - chorus * Math.sin(TAU * chorusHz * time));
    // The dry human waveform is always dominant, including the alien profiles.
    const metallic = dry[i] * (1 - ringMix + ringMix * Math.cos(TAU * ringHz * time));
    const cadence = 1 - cadenceDepth * .5 + cadenceDepth * .5 * Math.cos(TAU * cadenceHz * time);
    const edge = Math.min(1, i / Math.max(1, fadeIn), (output.length - 1 - i) / Math.max(1, fadeOut));
    const value = (metallic + delayed * doubling) * cadence * edge;
    output[i] = value; peak = Math.max(peak, Math.abs(value)); energy += value * value;
  }
  // Keep original clip loudness instead of making quiet source recordings loud.
  // Correct the small tail's RMS dilution; the peak ceiling wins when necessary.
  const targetRms = sourceRms * Math.sqrt(speechLength / output.length);
  const outputRms = Math.sqrt(energy / output.length);
  const gain = Math.min(3, targetRms / Math.max(1e-12, outputRms), .88 / Math.max(1e-12, peak));
  for (let i = 0; i < output.length; i++) output[i] *= gain;
  return output;
}
