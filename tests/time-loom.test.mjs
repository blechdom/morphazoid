import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TIME_LOOM_PRESETS, validateTimeLoomPreset, randomizeTimeLoomPreset } from '../src/instruments/time-loom/time-loom-presets.js';
import { timeLoomSiteChanges, restoreTimeLoomSite } from './helpers/time-loom-site-reference.mjs';
import { instrumentById } from '../src/site/instrument-catalog.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';

test('twelve complete weaves round-trip without owning output, recordings or transport', () => {
  assert.equal(new Set(TIME_LOOM_PRESETS.map(p => JSON.stringify(p.snapshot))).size, 12);
  for (const { snapshot } of TIME_LOOM_PRESETS) {
    assert.deepEqual(validateTimeLoomPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot), ['cords']);
  }
  assert.throws(() => validateTimeLoomPreset({ cords: [{ start: NaN }] }));
});

test('random weaves vary every musical dimension and keep knots and routes valid', () => {
  let seed = 91;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  const current = TIME_LOOM_PRESETS[0].snapshot, before = JSON.stringify(current);
  const states = Array.from({ length: 80 }, () => randomizeTimeLoomPreset(current, random));
  for (const state of states) {
    validateTimeLoomPreset(state);
    state.cords.forEach((c, i) => { assert.ok(c.end - c.start >= .02); assert.notEqual(c.next, i); });
  }
  for (let i = 0; i < 3; i++) for (const key of ['start', 'end', 'stretch', 'reverse', 'next']) {
    assert.ok(new Set(states.map(s => s.cords[i][key])).size > 1, `${i}.${key} must vary`);
  }
  assert.equal(JSON.stringify(current), before);
  validateTimeLoomPreset(randomizeTimeLoomPreset(current, () => NaN));
});

test('new registration is additive and each historical source is exactly recoverable', async () => {
  for (const { file, replacements } of timeLoomSiteChanges.changes) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const restored = restoreTimeLoomSite(source, file);
    let replayed = restored;
    for (const { before, after } of replacements) { assert.equal(replayed.split(before).length - 1, 1); replayed = replayed.replace(before, () => after); }
    assert.equal(replayed, source, file);
    assert.equal(restoreTimeLoomSite(restored, file, { allowRestored: true }), restored);
  }
});

test('Time Loom is a discoverable WIP recorder without a pitched keyboard claim', () => {
  const item = instrumentById('time-loom');
  assert.equal(item.href, 'time-loom.html'); assert.equal(item.status, 'Work in Progress');
  const capability = instrumentMidiCapabilityForId('time-loom');
  assert.equal(capability.noteMode, 'processor'); assert.equal(capability.audioInput, true);
  assert.equal(capability.midiOutput, false);
});
