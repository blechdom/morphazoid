// Native Vizsn phoneme/text and MEA8000 frame demos. No English gesture atlas.
// Intended to run in the instrument's render worker; importing does not load WASM.
const caches = new Map();
const finite = (value, fallback) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new Error('Use a finite numeric value.');
  return number;
};
function bounded(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be ${min}–${max}.`);
  return value;
}
function integer(value, min, max, label) {
  bounded(value, min, max, label);
  if (!Number.isInteger(value)) throw new Error(`${label} must be a whole number.`);
  return value;
}
async function backend(engine) {
  if (!caches.has(engine)) {
    const loading = (async () => {
      if (engine === 'vizsn') {
        const runtime = await import('./vizsn-runtime.js');
        return { ...runtime, module: await runtime.createVizsn() };
      }
      if (engine === 'mea8000') {
        const runtime = await import('./mea8000-runtime.js');
        return { ...runtime, module: await runtime.createMea8000() };
      }
      throw new Error(`Unknown native retro engine: ${engine}`);
    })();
    caches.set(engine, loading);
    loading.catch(() => { if (caches.get(engine) === loading) caches.delete(engine); });
  }
  return caches.get(engine);
}

export const VIZSN_NATIVE_PHONES = Object.freeze([
  ['a', 'a'], ['ae', 'ä'], ['e', 'e'], ['oe', 'ö'], ['o', 'o'], ['i', 'i'], ['y', 'y'], ['u', 'u'],
  ['h', 'h'], ['v', 'v'], ['j', 'j'], ['s', 's'], ['l', 'l'], ['r', 'r'], ['k', 'k'], ['t', 't'],
  ['p', 'p'], ['n', 'n'], ['m', 'm'], ['ng', 'ng'],
].map(([token, label], id) => Object.freeze({ id, token, label })));
const phoneIds = new Map(VIZSN_NATIVE_PHONES.flatMap(({id, token, label}) => [[token, id], [label, id]]));

/** String input means Vizsn's original character mapping, not English TTS.
 *  Native phones may be an array of 0–19 IDs or space-separated tokens.
 *  The native H sound needs neighbouring vowel context; isolated H may be silent.
 */
export function parseVizsnInput(input = 'a ä e ö o i y u') {
  if (Array.isArray(input)) input = { mode: 'phones', phones: input };
  if (typeof input === 'string') input = { mode: 'text', text: input };
  if (!input || typeof input !== 'object') throw new Error('Use Vizsn letters or native phones.');
  const mode = input.mode ?? (input.phones !== undefined ? 'phones' : 'text');
  if (mode === 'text') {
    const text = input.text ?? 'a ä e ö o i y u';
    if (typeof text !== 'string') throw new Error('Use Vizsn letters (a–z, ä, ö).');
    return { text };
  }
  if (mode !== 'phones') throw new Error('Unknown Vizsn input mode.');
  let phones = input.phones;
  if (typeof phones === 'string') phones = phones.trim() ? phones.trim().split(/[\s,]+/) : [];
  if (!Array.isArray(phones)) throw new Error('Use native Vizsn phones.');
  return { phones: phones.map(value => {
    if (typeof value === 'number') return integer(value, 0, 19, 'Native Vizsn sound ID');
    const id = phoneIds.get(String(value).toLowerCase());
    if (id === undefined) throw new Error(`Unknown Vizsn sound: ${value}`);
    return id;
  }) };
}

/** Pitch delta is the native signed increment code (-15…15). The chip scales it
 *  by 1, 2, 4 or 8 Hz for an 8, 16, 32 or 64 ms frame. F4 is fixed at 3500 Hz.
 */
export function createMea8000Note(input = {}, values = {}) {
  if (input === null || input === undefined) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('MEA8000 plays parameter-frame notes; it has no text frontend.');
  const durationMs = finite(input.durationMs, 512);
  if (durationMs <= 0) throw new Error('MEA8000 note length must be positive.');
  const frameMs = finite(values.frameMs, 32);
  if (![8,16,32,64].includes(frameMs)) throw new Error('MEA8000 frame length must be 8, 16, 32 or 64 ms.');
  const pitchDelta = integer(finite(values.pitchDelta, 0), -15, 15, 'MEA8000 pitch increment');
  const formants = [
    bounded(finite(values.formant1, 698), 150, 1047, 'Formant 1'),
    bounded(finite(values.formant2, 1179), 440, 3400, 'Formant 2'),
    bounded(finite(values.formant3, 2400), 1179, 3400, 'Formant 3'),
  ];
  const bandwidths = [1,2,3,4].map(i => {
    const value = finite(values[`bandwidth${i}`], 125);
    if (![50,125,309,726].includes(value)) throw new Error(`Bandwidth ${i} must be 50, 125, 309 or 726 Hz.`);
    return value;
  });
  const amplitude = bounded(finite(values.amplitude, .5), 0, 1, 'MEA8000 amplitude');
  const noise = values.noise === true || values.noise === 1 || values.noise === 'noise';
  if (values.noise !== undefined && ![true,false,0,1,'noise','voiced'].includes(values.noise)) throw new Error('Choose voiced or noise excitation.');
  const count = Math.ceil(durationMs / frameMs);
  const frame = { formants, bandwidths, amplitude, durationMs:frameMs, pitchDelta:pitchDelta*frameMs/8, noise };
  return { frames:Array.from({length:count}, () => ({...frame})), pitchHz:bounded(finite(values.pitchHz,120),0,510,'MEA8000 initial pitch byte'), seed:integer(finite(values.seed,1),0,0xffffffff,'Noise seed') };
}

/** Returns untouched signed native PCM. Master calibration/limiting belongs to
 *  the common audio output. No resampling, automatic RMS normalization, or atlas.
 *  Cached modules are owned by the enclosing worker; terminate it to release.
 */
export async function renderNativeRetro(engine, input, values = {}) {
  if (engine === 'vizsn') {
    const request = { ...parseVizsnInput(input),
      voiceType:integer(finite(values.voiceType,6),0,9,'Vizsn excitation'),
      pitchHz:finite(values.pitchHz,98),
      rate:finite(values.rate,1),
      seed:integer(finite(values.seed,1),0,0xffffffff,'Noise seed'),
    };
    const {module,synthesizeVizsn} = await backend(engine);
    return synthesizeVizsn(module,request);
  }
  if (engine === 'mea8000') {
    const request = createMea8000Note(input,values);
    const {module,synthesizeMea8000} = await backend(engine);
    return synthesizeMea8000(module,request);
  }
  throw new Error(`Unknown native retro engine: ${engine}`);
}
