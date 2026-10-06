import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { defaultLab, sanitizeLab, LAB_LIMITS, randomLab } from '../src/instruments/l-system-parametric-lab/model.js';
import { PRESETS as parametric } from '../src/instruments/l-system-parametric-lab/config.js';
import { PRESETS as experiments } from '../src/instruments/l-system-experiments/config.js';
import { INSTRUMENTS } from '../src/site/instrument-catalog.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { waxSupportForId } from '../src/instruments/wax/wax-instrument-roles.js';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';

test('lab modules clamp hostile values and retain independent finite defaults', () => {
  const original = defaultLab('parametric');
  const value = sanitizeLab({ kind: 'arbitrary', iterations: 99, branchCount: 6.8, pitchRatio: NaN, lengthRatio: -.8, angleIncrement: -Infinity });
  assert.equal(value.kind, 'parametric'); assert.equal(value.iterations, 24); assert.equal(value.branchCount, 6);
  assert.equal(value.pitchRatio, 1); assert.equal(value.lengthRatio, .2); assert.equal(value.angleIncrement, 0);
  assert.deepEqual(original, defaultLab('parametric'));
  assert.deepEqual(sanitizeLab(null), defaultLab());
});
test('complete lab presets reset every numeric module field and include every requested family', () => {
  assert.ok(parametric.length >= 12 && experiments.length >= 12, 'both banks satisfy the shared full-preset controller contract');
  assert.deepEqual(new Set(experiments.map(item => item.snapshot.parameters.lab.kind)), new Set(['context', 'thue-morse', 'fibonacci', 'penrose', 'sphinx']));
  for (const preset of [...parametric, ...experiments]) {
    const p = preset.snapshot.parameters;
    assert.equal(p.generations, p.lab.iterations);
    assert.deepEqual(sanitizeLab(p.lab), p.lab, preset.label);
    assert.deepEqual(Object.keys(p.lab), ['kind', ...Object.keys(LAB_LIMITS)]);
    assert.equal('source' in preset.snapshot.performance, false);
    assert.equal('level' in preset.snapshot.performance, false);
    assert.equal('inputGain' in preset.snapshot.performance, false);
    assert.equal('makeupDb' in preset.snapshot.performance.mastering, false);
  }
});
test('bounded module randomization varies every numeric field without changing caller state', () => {
  let seed = 23; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const values = Array.from({ length: 100 }, () => randomLab('parametric', random));
  for (const key of Object.keys(LAB_LIMITS)) assert.ok(new Set(values.map(value => value[key])).size > 1, key);
  for (const value of values) assert.deepEqual(sanitizeLab(value), value);
});
test('both copied pages preserve all original delay controls and register as playable WIP instruments', async () => {
  const original = await readFile(new URL('../src/pages/l-mic-rust.html', import.meta.url), 'utf8');
  const originalControls = [...original.matchAll(/<(?:input|select|button)\b[^>]*\bid="([^"]+)"/g)].map(match => match[1]).filter(id => !['grammarSeed', 'branchProbability', 'regrowGrammar'].includes(id));
  for (const [id, mode] of [['l-system-parametric-lab', 'parametric'], ['l-system-experiments', 'experiments']]) {
    assert.ok(CANONICAL_PAGE_ROUTES.includes(id + '.html'));
    const record = INSTRUMENTS.find(item => item.id === id); assert.equal(record.status, 'Work in Progress');
    const capability = instrumentMidiCapabilityForId(id); assert.equal(capability.noteMode, 'processor');
    assert.equal(capability.audioInput, true); assert.equal(capability.startsAudio, false); assert.equal(capability.computerKeyboardMode, 'page');
    assert.equal(waxSupportForId(id).available, false);
    const page = await readFile(new URL(`../src/pages/${id}.html`, import.meta.url), 'utf8');
    assert.ok(page.includes(`data-l-system-lab="${mode}"`));
    assert.ok(page.includes(`src="src/instruments/${id}/app.js"`));
    for (const control of originalControls) assert.ok(page.includes(`id="${control}"`), `${id}: ${control}`);
    const icon = await readFile(new URL(`../assets/instruments/${id}.webp`, import.meta.url));
    assert.equal(icon.toString('ascii', 8, 12), 'WEBP'); assert.ok(icon.length > 2000);
  }
});
