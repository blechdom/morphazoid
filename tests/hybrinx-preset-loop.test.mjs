import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HYBRINX_FULL_PRESETS, captureHybrinxPresetState, applyHybrinxPresetState, validateHybrinxFullPreset, randomizeHybrinxPreset } from '../src/families/syrinx/full-presets.js';
import { animalState, resolveGestureTimeline } from '../src/families/syrinx/syrinx.js';
import { presetStateKey } from '../src/site/header-presets.js';
const seeded = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);

test('Hybrinx Loop is live, not captured or restored by scenes or legacy snapshots', () => {
  for (const preset of HYBRINX_FULL_PRESETS) for (const loop of [false, true]) for (const active of [false, true]) {
    const snapshot = structuredClone(preset.snapshot);
    assert.equal(Object.hasOwn(snapshot.state, 'loop'), false);
    const live = animalState('raven', { loop, active, level: 0.12 });
    const before = structuredClone(live);
    for (const candidate of [snapshot, { ...snapshot, state: { ...snapshot.state, loop: !loop, level: .99 } }]) {
      validateHybrinxFullPreset(candidate);
      const applied = applyHybrinxPresetState(candidate.state, live);
      assert.equal(applied.loop, loop);
      assert.equal(applied.active, active);
      assert.equal(applied.level, .12);
      assert.deepEqual(captureHybrinxPresetState(applied), snapshot.state);
    }
    assert.deepEqual(live, before);
    assert.deepEqual(snapshot, preset.snapshot);
    assert.deepEqual(captureHybrinxPresetState(live), captureHybrinxPresetState({ ...live, loop: !loop }));
  }
});

test('Hybrinx dice, rollback and subsequent call cycles preserve the live Loop choice', () => {
  const current = HYBRINX_FULL_PRESETS[0].snapshot;
  for (const loop of [true, false]) for (let seed = 1; seed <= 64; seed++) {
    const snapshot = randomizeHybrinxPreset(current, seeded(seed));
    assert.equal(Object.hasOwn(snapshot.state, 'loop'), false);
    validateHybrinxFullPreset(snapshot);
    assert.deepEqual(randomizeHybrinxPreset({ ...current, state: { ...current.state, loop: !loop } }, seeded(seed)), snapshot);
    const live = animalState('raven', { active: true, loop, level: 0 });
    const next = applyHybrinxPresetState(snapshot.state, live);
    assert.equal(next.loop, loop);
    assert.equal(next.level, 0);
    const duration = snapshot.gesture.durationMs / next.gestureRate;
    const later = resolveGestureTimeline(5 * (duration + next.loopGapMs) + duration / 2, duration, next.loop, next.loopGapMs);
    assert.equal(later.complete, !loop, 'Loop-on must still cycle well past a one-shot completion');
    const restored = applyHybrinxPresetState(current.state, next);
    assert.equal(restored.loop, loop);
    assert.equal(restored.level, 0);
    assert.deepEqual(captureHybrinxPresetState(restored), current.state);
  }
});

test('removing Loop does not shift any previously seeded musical dice parameter', async () => {
  const reference = JSON.parse(await readFile(new URL('./fixtures/hybrinx-loop-random-reference.json', import.meta.url)));
  const random = seeded(reference.seed);
  for (const expected of reference.canonicalSha256) {
    const snapshot = randomizeHybrinxPreset(HYBRINX_FULL_PRESETS[0].snapshot, random);
    assert.equal(createHash('sha256').update(presetStateKey(snapshot)).digest('hex'), expected);
  }
});
