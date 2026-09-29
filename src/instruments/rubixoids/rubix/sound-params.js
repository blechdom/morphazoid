/** Bank-owned controls. Neutral values retain the original Rubix render recipes. */
const range = (key, label, min, max, step, value, unit = '', render = false) => ({ key, label, min, max, step, value, unit, render });
const choice = (key, label, options, value, render = false) => ({ key, label, options, value, render });
const tuning = choice('tuning', 'Tuning', [['original', 'Original'], ['harmonic', 'Harmonic'], ['chromatic', 'Chromatic'], ['major', 'Major'], ['minor', 'Minor'], ['dorian', 'Dorian'], ['pentatonic', 'Pentatonic']], 'original');
const transpose = range('transpose', 'Transpose', -24, 24, .1, 0, 'st');
const pitch = [tuning, range('rootHz', 'Root', 40, 440, 1, 110, 'Hz'), range('pitchSpread', 'Pitch spread', 0, 2, .01, 1, '×')];
const pan = range('pan', 'Pan', -1, 1, .01, 0);
const body = [range('attackScale', 'Attack', .25, 4, .05, 1, '×', true), range('decayScale', 'Decay', .25, 2, .05, 1, '×', true), range('toneOffset', 'Brightness', -.5, .5, .01, 0, '%', true)];
const noise = range('noiseOffset', 'Noise', -.5, .5, .01, 0, '%', true);
const extra = [range('hardness', 'Hardness', 0, 1, .01, .62, '%', true), range('inharmonicity', 'Inharmonicity', 0, 1.5, .01, .58, '', true), range('strikeNoise', 'Strike noise', 0, 1.6, .01, 1, '×', true)];
const native = {
  'soft-fm': [transpose, ...body, range('fmRatio', 'FM ratio', .25, 4, .05, 1, '×', true), range('fmDepth', 'FM depth', 0, 3, .05, 1, '×', true), range('pitchSweep', 'Pitch sweep', 0, 2, .05, 1, '×', true), noise, pan],
  analog: [transpose, ...body, noise, pan],
  modal: [transpose, ...body, noise, pan],
  noise: [transpose, ...body, pan],
  rattlesnake: [transpose, ...body, ...extra, range('pitchFall', 'Pitch fall', 0, 2, .01, 1, '×', true), range('morphWidth', 'Morph width', .3, 2.5, .01, 1.05, '×', true), pan],
  'pitched-morph': [transpose, ...pitch, choice('malletSet', 'Mallets', [['original', 'Marimba / Xylophone / Kalimba'], ['bright', 'Xylophone / Kalimba / Marimba'], ['keys', 'Harp / Harpsichord / Piano']], 'original', true), ...body, ...extra, range('morphWidth', 'Morph width', .3, 2.5, .01, 1.05, '×', true), pan],
  'karplus-strong': [transpose, ...pitch, range('attack', 'Attack', 0, .12, .001, 0, 's'), range('length', 'Decay', .1, 1, .01, 1, '×'), range('filter', 'Filter', 80, 20000, 10, 20000, 'Hz'), range('resonance', 'Resonance', 0, 8, .1, 0), range('drive', 'Drive', 1, 4, .05, 1, '×'), pan],
};
const sharedIds = ['simd-chiptune', 'simd-303', 'simd-synth', 'soft-fm', 'analog', 'modal', 'noise', 'rattlesnake', 'pitched-morph', 'karplus-strong', 'sine'];
const shared = [transpose, ...pitch, range('duration', 'Gate', .025, 1.2, .005, .28, 's'), range('attack', 'Attack', .001, .3, .001, .004, 's'), range('decay', 'Decay', .001, .6, .001, .045, 's'), range('sustain', 'Sustain', 0, 1, .01, .65, '%'), range('release', 'Release', .005, 1, .005, .055, 's'), range('brightness', 'Brightness', 0, 1, .01, .5, '%'), range('cutoff', 'Filter', 80, 18000, 10, 7000, 'Hz'), range('resonance', 'Resonance', 0, 12, .1, 1), range('drive', 'Drive', .2, 4, .05, 1.8, '×'), range('character', 'Character', 0, 1, .01, .25, '%'), pan];
export const RUBIX_BANK_CONTROLS = Object.freeze(Object.fromEntries([
  ...Object.entries(native), ...sharedIds.map(id => [`shared-${id}`, shared]),
].map(([id, controls]) => [id, Object.freeze(controls.map(control => Object.freeze({ ...control })))])));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function rubixBankDefaults(bank, legacy = {}) {
  const values = Object.fromEntries((RUBIX_BANK_CONTROLS[bank] ?? []).map(control => [control.key, control.value]));
  if (bank.startsWith('shared-')) {
    values.duration = clamp(finite(legacy.acidDecay, .28), .04, .72);
    values.brightness = clamp((finite(legacy.cutoff, 840) - 160) / 4040, 0, 1);
    values.cutoff = 1400 + values.brightness * 12500;
    values.resonance = clamp(finite(legacy.resonance, 10.8), 0, 12);
    values.drive = clamp(finite(legacy.drive, 1.8), .2, 4);
    values.sustain = ['shared-simd-chiptune', 'shared-simd-303', 'shared-simd-synth', 'shared-sine'].includes(bank) ? .65 : .5;
  }
  return values;
}
export function rubixBankParams(bank, bankParams, legacy = {}) {
  return bankParams?.banks?.[bank] ?? rubixBankDefaults(bank, legacy);
}
export function changeRubixBankParam(bankParams, bank, key, value, legacy = {}) {
  const control = RUBIX_BANK_CONTROLS[bank]?.find(control => control.key === key);
  if (!control) throw new TypeError('Unknown Rubix bank parameter');
  const next = control.options
    ? (control.options.some(([id]) => id === value) ? value : control.value)
    : clamp(finite(value, control.value), control.min, control.max);
  return { version: 1, banks: { ...bankParams?.banks, [bank]: { ...rubixBankParams(bank, bankParams, legacy), [key]: next } } };
}
const plainObject = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function validateRubixBankParams(value) {
  if (value == null) return value;
  if (!plainObject(value) || value.version !== 1 || !plainObject(value.banks) || Object.keys(value).some(key => !['version', 'banks'].includes(key))) throw new TypeError('Invalid Rubix bank parameters');
  for (const [bank, params] of Object.entries(value.banks)) {
    const controls = RUBIX_BANK_CONTROLS[bank];
    if (!controls || !plainObject(params) || Object.keys(params).length !== controls.length) throw new TypeError('Invalid Rubix sound bank');
    for (const control of controls) {
      const v = params[control.key];
      if (control.options ? !control.options.some(([id]) => id === v) : (!Number.isFinite(v) || v < control.min || v > control.max)) throw new TypeError(`Invalid Rubix ${bank} ${control.key}`);
    }
  }
  return value;
}
export function cloneRubixBankParams(value) {
  validateRubixBankParams(value);
  return value == null ? null : JSON.parse(JSON.stringify(value));
}
export function randomizeRubixBankParams(rng) {
  return { version: 1, banks: Object.fromEntries(Object.entries(RUBIX_BANK_CONTROLS).map(([bank, controls]) => [bank, Object.fromEntries(controls.map(c => [c.key, c.options ? rng.pick(c.options)[0] : c.min + rng.between(.2, .8) * (c.max - c.min)]))])) };
}
export function rubixRenderedParams(bank, params) {
  return Object.fromEntries((RUBIX_BANK_CONTROLS[bank] ?? []).filter(control => control.render).map(control => [control.key, params[control.key]]));
}
export function rubixVoiceWithParams(voice, params) {
  return { ...voice, attack: voice.attack * params.attackScale, decay: voice.decay * params.decayScale,
    tone: clamp(voice.tone + params.toneOffset, 0, 1), noise: clamp(voice.noise + (params.noiseOffset ?? 0), 0, 1),
    modRatio: voice.modRatio * (params.fmRatio ?? 1), modIndex: voice.modIndex * (params.fmDepth ?? 1), pitchBend: voice.pitchBend * (params.pitchSweep ?? 1) };
}
export function rubixExtraSettings(bank, params) {
  const extra = { attack: .0015 * params.attackScale, decay: ({ rattlesnake: .42, 'pitched-morph': .48, 'karplus-strong': .38 }[bank]) * params.decayScale,
    hardness: params.hardness, inharmonicity: params.inharmonicity, strikeNoise: params.strikeNoise };
  if (params.pitchFall !== undefined) extra.pitchFall = params.pitchFall;
  if (params.morphWidth !== undefined) extra.morphWidth = params.morphWidth;
  if (params.malletSet === 'bright') extra.pitchedOrder = ['xylophone', 'kalimba', 'marimba'];
  if (params.malletSet === 'keys') extra.pitchedOrder = ['harp', 'harpsichord', 'piano'];
  if (params.material && params.material !== 'original') extra.karplusMorphOrder = Array(4).fill(params.material);
  return extra;
}
const colorIndex = color => Math.max(0, ['white', 'yellow', 'green', 'blue', 'red', 'orange'].indexOf(color));
const scales = { chromatic: [0, 1, 2, 3, 4, 5], major: [0, 2, 4, 5, 7, 9], minor: [0, 2, 3, 5, 7, 8], dorian: [0, 2, 3, 5, 7, 9], pentatonic: [0, 2, 4, 7, 9, 12] };
export function rubixBankFrequency(base, color, params) {
  if ((params.transpose ?? 0) === 0 && (!params.tuning || (params.tuning === 'original' && params.rootHz === 110 && params.pitchSpread === 1))) return base;
  const shift = 2 ** ((params.transpose ?? 0) / 12);
  if (!params.tuning) return clamp(base * shift, 20, 12000);
  let ratio = base / 110;
  if (params.tuning === 'harmonic') ratio = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 7 / 4][colorIndex(color)];
  else if (scales[params.tuning]) ratio = 2 ** (scales[params.tuning][colorIndex(color)] / 12);
  return clamp(params.rootHz * ratio ** params.pitchSpread * shift, 20, 12000);
}
export function formatRubixBankParam(control, value) {
  if (control.unit === 's') return `${Math.round(value * 1000)} ms`;
  if (control.unit === '%') return `${Math.round(value * 100)}%`;
  if (control.key === 'pan') return Math.abs(value) < .005 ? 'Center' : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? 'L' : 'R'}`;
  const text = control.unit === 'Hz' ? Math.round(value) : Number(value.toFixed(2));
  return `${text}${control.unit ? ` ${control.unit}` : ''}`;
}
