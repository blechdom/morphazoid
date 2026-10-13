import assert from 'node:assert/strict';
import test from 'node:test';
import { BARBER_DELAY_DEFAULTS, BARBER_DELAY_PRESETS } from '../src/families/barber-delay/barber-delay.js';
import { BARBER_FULL_PRESETS, captureBarberPreset, validateBarberPreset, randomizeBarberPreset } from '../src/families/barber-delay/full-presets.js';
import { SLIPPERY_RESYNTHESIS_DEFAULTS, SLIPPERY_RESYNTHESIS_PRESETS } from '../src/instruments/slippery-resynthesis/slippery-resynthesis.js';
import { SLIPPERY_FULL_PRESETS, captureSlipperyPreset, validateSlipperyPreset, randomizeSlipperyPreset } from '../src/instruments/slippery-resynthesis/full-presets.js';
import { validateFullPresetBank, presetStateKey } from '../src/site/header-presets.js';

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const cases = ['candy', 'sandy'].map(mode => ({
  name: mode, defaults: BARBER_DELAY_DEFAULTS[mode], original: BARBER_DELAY_PRESETS[mode], bank: BARBER_FULL_PRESETS[mode],
  capture: parameters => captureBarberPreset(parameters, mode), validate: snapshot => validateBarberPreset(snapshot, mode),
  randomize: (snapshot, random) => randomizeBarberPreset(snapshot, mode, random),
}));
cases.push({ name: 'slippery', defaults: SLIPPERY_RESYNTHESIS_DEFAULTS, original: SLIPPERY_RESYNTHESIS_PRESETS,
  bank: SLIPPERY_FULL_PRESETS, capture: captureSlipperyPreset, validate: validateSlipperyPreset, randomize: randomizeSlipperyPreset });

for (const c of cases) {
  test(`${c.name}: full recall preserves every authored scene and excludes performer state`, () => {
    validateFullPresetBank(c.bank);
    assert.deepEqual(c.bank.map(p => p.id), c.original.map(p => p.id));
    for (let i = 0; i < c.bank.length; i++) {
      assert.deepEqual(c.bank[i].snapshot, c.capture({ ...c.defaults, ...c.original[i].settings }));
      assert.equal(c.validate(c.bank[i].snapshot), c.bank[i].snapshot);
    }
    const session = { ...c.defaults, outputLevel: 0.13, inputGain: 1.83, audioOn: true, source: 'samples', loop: false, time: 20 };
    assert.deepEqual(c.capture(session), c.capture(c.defaults));
    const bad = structuredClone(c.bank[0].snapshot);
    delete bad.settings.dryWet;
    assert.throws(() => c.validate(bad), TypeError);
    assert.throws(() => c.validate({ ...c.bank[0].snapshot, outputLevel: 0.3 }), TypeError);
    assert.throws(() => c.validate({ settings: { ...c.bank[0].snapshot.settings, speed: Infinity } }), TypeError);
  });

  test(`${c.name}: bounded dice varies all musical fields and is reproducible`, () => {
    const initial = c.bank[0].snapshot, before = structuredClone(initial);
    assert.deepEqual(c.randomize(initial, seed(92)), c.randomize(c.bank.at(-1).snapshot, seed(92)));
    assert.deepEqual(initial, before);
    const seen = new Map(Object.keys(initial.settings).map(key => [key, new Set()]));
    const locks = new Set(), random = seed(82347);
    const factory = new Set(c.bank.map(p => presetStateKey(p.snapshot)));
    for (let i = 0; i < 256; i++) {
      const result = c.randomize(initial, random);
      c.validate(result);
      for (const [key, value] of Object.entries(result.settings)) seen.get(key).add(value);
      locks.add(result.ratioLock);
      assert.equal(factory.has(presetStateKey(result)), false);
      if (c.name === 'slippery') assert.ok(result.settings.bankWidth * result.settings.bandCount <= 256);
      else assert.ok(result.settings.feedback + result.settings.globalFeedback <= 0.83 + 1e-12);
      if (result.ratioLock) assert.ok(Math.abs(result.settings.speed * result.settings.range - 1) < 1e-12);
    }
    for (const [key, values] of seen) assert.ok(values.size > 1, `${key} must vary`);
    if (c.name === 'candy') assert.equal(locks.size, 2);
  });
}
