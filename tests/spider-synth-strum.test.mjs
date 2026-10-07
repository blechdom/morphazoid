import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepSpiderStrings } from '../src/instruments/spider-synth/spider-synth-strum.js';
const strand = (id, x, source = 'web') => ({ source, segmentId: id, silkId: id, a: { x, y: -100 }, b: { x, y: 100 }, u0: 0, u1: 1 });
test('one fast move plays every crossed string in travel order, including silk', () => {
  const hits = sweepSpiderStrings([strand(3, 90), strand(1, 30), strand(2, 60, 'silk')], { x: 0, y: 0 }, { x: 120, y: 0 }, new Set());
  assert.deepEqual(hits.map(h => h.key), ['web:1', 'silk:2', 'web:3']);
  assert.ok(hits.every(h => h.u === .5));
});
test('contact hysteresis prevents hovering/parallel repeats, then permits a reverse stroke', () => {
  const parts = [strand(1, 30)], contacts = new Set();
  assert.equal(sweepSpiderStrings(parts, { x: 0, y: 0 }, { x: 30, y: 0 }, contacts).length, 1);
  assert.equal(sweepSpiderStrings(parts, { x: 30, y: 0 }, { x: 32, y: 40 }, contacts).length, 0);
  assert.equal(sweepSpiderStrings(parts, { x: 32, y: 40 }, { x: 65, y: 40 }, contacts).length, 0);
  assert.equal(contacts.size, 0);
  assert.equal(sweepSpiderStrings(parts, { x: 65, y: 40 }, { x: 0, y: 40 }, contacts).length, 1);
});
test('sampled pieces deduplicate, namespaces differ, and stationary input cannot repeat', () => {
  const parts = [strand(1, 30), strand(1, 30), strand(1, 30, 'silk')];
  const hits = sweepSpiderStrings(parts, { x: 0, y: 0 }, { x: 60, y: 0 }, new Set());
  assert.equal(hits.length, 2); assert.equal(new Set(hits.map(h => h.key)).size, 2);
  assert.equal(sweepSpiderStrings(parts, { x: 30, y: 0 }, { x: 30, y: 0 }, new Set()).length, 0);
});
