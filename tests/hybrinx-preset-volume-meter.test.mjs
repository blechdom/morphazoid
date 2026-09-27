import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HYBRINX_FULL_PRESETS, captureHybrinxPresetState, captureHybrinxPreset, applyHybrinxPresetState, validateHybrinxFullPreset, randomizeHybrinxPreset } from '../src/families/syrinx/full-presets.js';
import { animalState } from '../src/families/syrinx/syrinx.js';
import { presetStateKey } from '../src/site/header-presets.js';
import { restoreHybrinxVolumeMeter, hybrinxVolumeMeterChanges } from './helpers/hybrinx-volume-meter-reference.mjs';
const seeded = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);

test('Hybrinx capture excludes live activity, Loop and master, without mutating state', () => {
  const live = animalState('wolf', { level: 0.17, active: true });
  const before = structuredClone(live), state = captureHybrinxPresetState(live);
  assert.equal(Object.hasOwn(state, 'level'), false);
  assert.equal(Object.hasOwn(state, 'active'), false);
  assert.deepEqual({ ...state, level: live.level, active: live.active, loop: live.loop }, before);
  assert.deepEqual(live, before);
  const { tongue, gesture, modulators } = HYBRINX_FULL_PRESETS[0].snapshot;
  assert.equal(presetStateKey(captureHybrinxPreset(live, tongue, gesture, modulators)),
    presetStateKey(captureHybrinxPreset({ ...live, level: 0, active: false }, tongue, gesture, modulators)));
});

test('all 12 Hybrinx scenes preserve live master and activity; legacy levels cannot unmute', async () => {
  const reference = JSON.parse(await readFile(new URL('./fixtures/hybrinx-preset-musical-reference.json', import.meta.url)));
  assert.deepEqual(HYBRINX_FULL_PRESETS.map(p => p.id), reference.map(p => p.id));
  for (const preset of HYBRINX_FULL_PRESETS) {
    assert.equal(Object.hasOwn(preset.snapshot.state, 'level'), false);
    // Restore only the old factory Loop=true for the frozen pre-loop proof.
    // The old fingerprint and every other musical field stay unchanged.
    const legacy = { ...preset, snapshot: { ...preset.snapshot, state: { ...preset.snapshot.state, loop: true } } };
    assert.equal(createHash('sha256').update(presetStateKey(legacy)).digest('hex'),
      reference.find(r => r.id === preset.id).musicalSha256, `${preset.id}: every non-master/non-Loop field retained`);
    const before = structuredClone(preset);
    for (const level of [0, 0.12, 0.48, 0.67, 1]) for (const active of [false, true]) {
      const live = animalState('lion', { level, active });
      for (const snapshot of [preset.snapshot, { ...preset.snapshot, state: { ...preset.snapshot.state, level: 0.99 } }]) {
        validateHybrinxFullPreset(snapshot);
        const result = applyHybrinxPresetState(snapshot.state, live);
        assert.equal(result.level, level); assert.equal(result.active, active);
        assert.deepEqual(captureHybrinxPresetState(result), preset.snapshot.state);
      }
      assert.equal(live.level, level);
    }
    assert.deepEqual(preset, before);
  }
});

test('Hybrinx dice and rollback never store or resurrect master output', () => {
  const current = structuredClone(HYBRINX_FULL_PRESETS[0].snapshot), before = structuredClone(current);
  for (let i = 1; i <= 48; i++) for (const level of [0, 0.12, 0.67, 1]) {
    const next = randomizeHybrinxPreset(current, seeded(i));
    validateHybrinxFullPreset(next);
    assert.equal(Object.hasOwn(next.state, 'level'), false);
    assert.deepEqual(randomizeHybrinxPreset({ ...current, state: { ...current.state, level } }, seeded(i)), next);
    const live = applyHybrinxPresetState(next.state, { level, active: true });
    assert.equal(live.level, level);
    const restored = applyHybrinxPresetState(current.state, live);
    assert.equal(restored.level, level);
    assert.equal(restored.active, true);
    assert.deepEqual(captureHybrinxPresetState(restored), current.state);
  }
  assert.deepEqual(current, before);
  assert.throws(() => validateHybrinxFullPreset({ ...current, state: { ...current.state, active: true } }), /Invalid/);
  assert.throws(() => validateHybrinxFullPreset({ ...current, state: { ...current.state, pressure: 99 } }), /Invalid/);
});

test('Syrinx-family metering uses exactly the header singleton, after master and compressor', async () => {
  const source = await readFile(new URL('../src/families/syrinx/syrinx-app.js', import.meta.url), 'utf8');
  const nav = await readFile(new URL('../nav.js', import.meta.url), 'utf8');
  const getUrl = (text, base) => new URL(text.match(/from "([^"]*audio-output-manager\.js[^\"]*)"/)[1], new URL(base, import.meta.url)).href;
  assert.equal(getUrl(source, '../src/families/syrinx/syrinx-app.js'), getUrl(nav, '../nav.js'));
  assert.match(source, /masterGain\.connect\(compressor\);\s*compressor\.connect\(analyser\);\s*releaseOutput = connectAudioOutput\(context, analyser/);
  const restored = restoreHybrinxVolumeMeter(source, 'src/families/syrinx/syrinx-app.js');
  const graph = text => text.slice(text.indexOf('async function createAudioGraph()'), text.indexOf('async function ensureAudio()'));
  assert.equal(graph(source), graph(restored), 'no audible topology, gain or compressor changes');
  for (const change of hybrinxVolumeMeterChanges) for (const file of change.regressionTests) {
    assert.ok((await readFile(new URL(`../${file}`, import.meta.url))).length > 0);
  }
});
