/** Musical state for an ESI-32-inspired sampler, not a hardware/ROM emulation. */
export const ESI32_MAX_VOICES = 32;
export const ESI32_SLOT_COUNT = 8;
export const ESI32_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const ESI32_MAX_SAMPLE_SECONDS = 60;
export const ESI32_MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const MIN_REGION = 1 / 65536;

export const ESI32_DEFAULT_PATCH = Object.freeze({
  sampleSlot: 0, start: 0, end: 1, loopStart: .24, loopEnd: .72,
  loopMode: 'off', reverse: false, rootNote: 60, tune: 0, fine: 0,
  attack: .004, decay: .7, sustain: .7, release: .35,
  cutoff: 9800, resonance: .12, filterEnv: 0,
  lfoRate: 4.8, lfoDepth: 0, pan: 0, level: .8,
});

export function sanitizeEsi32Patch(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const number = (key, low, high) => clamp(finite(value[key], ESI32_DEFAULT_PATCH[key]), low, high);
  const start = number('start', 0, 1 - MIN_REGION);
  const end = clamp(number('end', MIN_REGION, 1), start + MIN_REGION, 1);
  const loopStart = clamp(number('loopStart', 0, 1), start, end - MIN_REGION);
  const loopEnd = clamp(number('loopEnd', 0, 1), loopStart + MIN_REGION, end);
  return {
    sampleSlot: Math.round(number('sampleSlot', 0, ESI32_SLOT_COUNT - 1)),
    start, end, loopStart, loopEnd,
    loopMode: value.loopMode === 'forward' ? 'forward' : 'off',
    reverse: value.reverse === true,
    rootNote: Math.round(number('rootNote', 0, 127)),
    tune: number('tune', -36, 36), fine: number('fine', -100, 100),
    attack: number('attack', .002, 8), decay: number('decay', .005, 12),
    sustain: number('sustain', 0, 1), release: number('release', .005, 15),
    cutoff: number('cutoff', 30, 20000), resonance: number('resonance', 0, 1),
    filterEnv: number('filterEnv', -48, 48), lfoRate: number('lfoRate', .05, 20),
    lfoDepth: number('lfoDepth', 0, 200), pan: number('pan', -1, 1), level: number('level', 0, 1),
  };
}

export function samplePlaybackRate(note, patch = {}, bend = 0) {
  const settings = sanitizeEsi32Patch(patch);
  const semitones = clamp(finite(note, 60), 0, 127) - settings.rootNote
    + settings.tune + settings.fine / 100 + clamp(finite(bend, 0), -24, 24);
  return clamp(2 ** (semitones / 12), 1 / 64, 64);
}

function seededRandom(seed) {
  let state = finite(seed, 1) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let next = Math.imul(state ^ state >>> 15, state | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

/** All musical fields vary; master output and live device state are not patch fields. */
export function randomizeEsi32Patch(seed = 1, base = {}) {
  const random = seededRandom(seed);
  const start = random() * .45;
  const end = start + .25 + random() * (.75 - start);
  const loopStart = start + random() * (end - start) * .55;
  const loopEnd = loopStart + (end - loopStart) * (.2 + random() * .8);
  const logarithmic = (low, high) => low * (high / low) ** random();
  return sanitizeEsi32Patch({
    ...base, sampleSlot: Math.floor(random() * ESI32_SLOT_COUNT), start, end, loopStart, loopEnd,
    loopMode: random() < .55 ? 'forward' : 'off', reverse: random() < .32,
    rootNote: 48 + Math.floor(random() * 25), tune: random() * 24 - 12,
    fine: random() * 120 - 60, attack: logarithmic(.003, 1.4),
    decay: logarithmic(.05, 4), sustain: .12 + random() * .85,
    release: logarithmic(.04, 4), cutoff: logarithmic(180, 18000),
    resonance: random() * .8, filterEnv: random() * 60 - 20,
    lfoRate: logarithmic(.15, 12), lfoDepth: random() * 90,
    pan: random() * 1.6 - .8, level: .45 + random() * .5,
  });
}

export const ESI32_DEMO_SAMPLES = Object.freeze([
  ['glass', 'Glass tine', 60, 2.8, 'Original struck partials'],
  ['velvet', 'Velvet strings', 60, 3.2, 'Original bowed harmonic cluster'],
  ['choir', 'Vowel cloud', 60, 3, 'Original formant-shaped harmonics'],
  ['bass', 'Copper bass', 48, 2.4, 'Original resonant pluck'],
  ['bell', 'Satellite bell', 60, 3.2, 'Original inharmonic metallic strike'],
  ['drum', 'Dust drum', 36, 1.2, 'Original pitched skin and noise impact'],
  ['air', 'Air corridor', 60, 3, 'Original filtered noise texture'],
  ['keys', 'Circuit keys', 60, 2.8, 'Original hollow electric-key partials'],
].map(([id, label, rootNote, duration, description]) => Object.freeze({ id, label, rootNote, duration, description })));

const presetDefinitions = [
  ['glass-tine', 'Glass tine', { sampleSlot: 0 }],
  ['velvet-strings', 'Velvet strings', { sampleSlot: 1, attack: .45, decay: .5, sustain: .82, release: 1.8, loopMode: 'forward', cutoff: 4700, lfoDepth: 9 }],
  ['vowel-cloud', 'Vowel cloud', { sampleSlot: 2, attack: .16, sustain: .9, release: 1.1, loopMode: 'forward', cutoff: 6500, lfoRate: 5.3, lfoDepth: 14 }],
  ['copper-bass', 'Copper bass', { sampleSlot: 3, rootNote: 48, cutoff: 740, resonance: .48, filterEnv: 28, decay: .38, sustain: .28, release: .15 }],
  ['satellite-bell', 'Satellite bell', { sampleSlot: 4, attack: .003, decay: 2.1, sustain: .35, release: 2.5, cutoff: 14500 }],
  ['dust-drum', 'Dust drum', { sampleSlot: 5, rootNote: 36, attack: .002, decay: .28, sustain: 0, release: .12, cutoff: 8600 }],
  ['air-corridor', 'Air corridor', { sampleSlot: 6, attack: 1.2, decay: 2, sustain: .8, release: 2.8, loopMode: 'forward', cutoff: 1650, resonance: .6, filterEnv: 18, lfoRate: .4, lfoDepth: 45 }],
  ['circuit-keys', 'Circuit keys', { sampleSlot: 7, decay: .75, sustain: .4, release: .4, cutoff: 5700, filterEnv: 10 }],
  ['reverse-orbit', 'Reverse orbit', { sampleSlot: 4, reverse: true, attack: .25, release: 1.7, tune: -7.4, cutoff: 9200, lfoRate: 1.6, lfoDepth: 24 }],
  ['tiny-loop', 'Tiny loop', { sampleSlot: 0, start: .12, end: .7, loopStart: .21, loopEnd: .235, loopMode: 'forward', attack: .035, decay: .2, sustain: .75, release: .4, cutoff: 2100, resonance: .64, filterEnv: 16 }],
  ['submerged', 'Submerged choir', { sampleSlot: 2, tune: -12, fine: -17, attack: .8, decay: 2.1, sustain: .7, release: 3.2, loopMode: 'forward', cutoff: 430, resonance: .25, filterEnv: 12, lfoRate: .65, lfoDepth: 32 }],
  ['flutter-memory', 'Flutter memory', { sampleSlot: 7, reverse: true, start: .16, end: .86, loopStart: .31, loopEnd: .58, loopMode: 'forward', tune: 7.2, attack: .18, decay: .9, sustain: .6, release: 1.3, cutoff: 3200, resonance: .32, lfoRate: 8.2, lfoDepth: 65, pan: -.25 }],
];
export const ESI32_PRESETS = Object.freeze(presetDefinitions.map(([id, label, values]) => {
  const patch = Object.freeze(sanitizeEsi32Patch({ ...ESI32_DEFAULT_PATCH, ...values }));
  return Object.freeze({ id, label, patch, snapshot: patch });
}));

/** Generate original PCM once, then play it using AudioBufferSourceNode. */
export function createEsi32DemoData(slot = 0, requestedRate = 44100) {
  const index = clamp(Math.round(finite(slot, 0)), 0, ESI32_SLOT_COUNT - 1);
  const metadata = ESI32_DEMO_SAMPLES[index];
  const sampleRate = Math.round(clamp(finite(requestedRate, 44100), 8000, 192000));
  const length = Math.ceil(metadata.duration * sampleRate);
  const data = new Float32Array(length);
  const random = seededRandom(1947 + index * 379);
  const frequency = 440 * 2 ** ((metadata.rootNote - 69) / 12);
  const tau = Math.PI * 2;
  let noise = 0;
  let peak = 0;
  for (let frame = 0; frame < length; frame += 1) {
    const time = frame / sampleRate;
    const phase = tau * frequency * time;
    const rawNoise = random() * 2 - 1;
    noise += .08 * (rawNoise - noise);
    let value = 0;
    if (index === 0) {
      value = Math.sin(phase) * Math.exp(-time * 1.1)
        + .42 * Math.sin(phase * 2.008) * Math.exp(-time * 2.4)
        + .18 * Math.sin(phase * 6.01) * Math.exp(-time * 5);
    } else if (index === 1) {
      for (let harmonic = 1; harmonic <= 14; harmonic += 1) {
        if (frequency * harmonic > sampleRate * .45) break;
        value += Math.sin(phase * harmonic + .012 * harmonic * Math.sin(tau * .7 * time)) / harmonic;
      }
      value *= .65 + .2 * Math.sin(tau * .3 * time);
    } else if (index === 2) {
      for (let harmonic = 1; harmonic <= 24; harmonic += 1) {
        const hz = frequency * harmonic;
        if (hz > sampleRate * .45) break;
        const formant = Math.exp(-(((hz - 750) / 230) ** 2)) + .6 * Math.exp(-(((hz - 1450) / 320) ** 2));
        value += (.06 / harmonic + formant * .25) * Math.sin(phase * harmonic + harmonic * .12);
      }
      value *= .8 + .12 * Math.sin(tau * 1.4 * time);
    } else if (index === 3) {
      for (let harmonic = 1; harmonic <= 12; harmonic += 1) {
        if (frequency * harmonic > sampleRate * .45) break;
        value += Math.sin(phase * harmonic) / harmonic * Math.exp(-time * (.5 + harmonic * .65));
      }
    } else if (index === 4) {
      for (const [ratio, level, decay] of [[1, 1, .8], [2.756, .42, 1.1], [5.404, .27, 1.7], [8.933, .13, 2.8]]) {
        if (frequency * ratio < sampleRate * .45) value += Math.sin(phase * ratio) * level * Math.exp(-time * decay);
      }
    } else if (index === 5) {
      value = Math.sin(tau * (frequency * time + 80 * (1 - Math.exp(-time * 28)) / 28)) * Math.exp(-time * 7)
        + rawNoise * .27 * Math.exp(-time * 22);
    } else if (index === 6) {
      value = noise * (.7 + .22 * Math.sin(tau * .8 * time)) + .025 * Math.sin(phase);
    } else {
      value = Math.sin(phase + 1.8 * Math.sin(phase * 2) * Math.exp(-time * 4)) * Math.exp(-time * 1.1)
        + .25 * Math.sin(phase * 3) * Math.exp(-time * 2.8);
    }
    // Quiet endpoints suppress sample-start/end discontinuities without altering loop policy.
    const fade = Math.min(1, time / .003, (length - frame - 1) / (sampleRate * .025));
    data[frame] = value * Math.max(0, fade);
    peak = Math.max(peak, Math.abs(data[frame]));
  }
  const scale = .8 / Math.max(.0001, peak);
  for (let frame = 0; frame < length; frame += 1) data[frame] *= scale;
  return { channels: [data], sampleRate, duration: length / sampleRate, rootNote: metadata.rootNote };
}
