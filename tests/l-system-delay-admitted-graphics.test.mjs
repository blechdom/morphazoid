import assert from 'node:assert/strict';
import test from 'node:test';
import { generationTopology } from '../src/instruments/micmic/micmic.js';
import { DEFAULT_PARAMETERS, L_SYSTEM_TYPES, buildPreview, createPreviewDrawSelection,
  applyPreviewDepth, topologyBounds } from '../src/instruments/micmic/native/model.js';

test('playing draws admitted connected branches, retaining the complete preset and stable camera bounds', () => {
  for (const lSystemType of L_SYSTEM_TYPES) {
    const nodes = buildPreview({ ...DEFAULT_PARAMETERS, lSystemType, generations: 7, pruningBias: .65 }, generationTopology);
    const bounds = topologyBounds(nodes), original = structuredClone(nodes), selection = createPreviewDrawSelection(nodes);
    for (const limit of [0, 1, 3, 9, 1, nodes.length]) {
      const drawn = selection.select({ audio: true, limit });
      const ids = new Set(drawn.map(node => node.id));
      assert.equal(drawn[0], nodes[0], `${lSystemType} input root`);
      assert.deepEqual(drawn.filter(node => node.generation > 0).map(node => node.id),
        nodes.filter(node => Number.isInteger(node.priority) && node.priority >= 0 && node.priority < limit && node.gain > 0).map(node => node.id));
      for (const node of drawn.slice(1)) assert.ok(ids.has(node.parentId), `${lSystemType} connected admission`);
      assert.deepEqual(topologyBounds(nodes), bounds);
      assert.deepEqual(nodes, original, `${lSystemType} full source is unchanged`);
    }
    assert.equal(selection.select({ audio: false }), nodes, `${lSystemType} Audio-off complete preview`);
  }
});

test('real release tails remain visible until their meter reaches zero, with stable selection between membership changes', () => {
  const nodes = buildPreview({ ...DEFAULT_PARAMETERS, generations: 5 }, generationTopology), selection = createPreviewDrawSelection(nodes);
  const tail = nodes.find(node => node.priority === 12), levels = new Map([[tail.voiceIndex, .3]]);
  const active = selection.select({ audio: true, limit: 3, levels });
  assert.equal(active.length, 5); assert.equal(active.at(-1), tail);
  levels.set(tail.voiceIndex, .01);
  assert.equal(selection.select({ audio: true, limit: 3, levels }), active, 'amplitude changes reuse compact selection');
  levels.set(tail.voiceIndex, 0);
  const quiet = selection.select({ audio: true, limit: 3, levels });
  assert.equal(quiet.length, 4); assert.ok(!quiet.includes(tail));
  assert.equal(selection.select({ audio: true, limit: 3, levels }), quiet);
  levels.set(999999, .5);
  assert.equal(selection.select({ audio: true, limit: 3, levels }), quiet, 'unrepresented meters do not invent branches');
});

test('Depth zero keeps actual fading releases, then just the root, and resumes the same admitted identities', () => {
  const nodes = buildPreview({ ...DEFAULT_PARAMETERS, generations: 5 }, generationTopology), selection = createPreviewDrawSelection(nodes);
  const initial = selection.select({ audio: true, limit: 6, depth: .72 }), tail = initial.at(-1);
  applyPreviewDepth(nodes, 0);
  assert.deepEqual(selection.select({ audio: true, limit: 0, depth: 0, levels: new Map([[tail.voiceIndex, .1]]) }), [nodes[0], tail]);
  assert.deepEqual(selection.select({ audio: true, limit: 0, depth: 0 }), [nodes[0]]);
  applyPreviewDepth(nodes, .9);
  assert.deepEqual(selection.select({ audio: true, limit: 6, depth: .9 }).map(node => node.id), initial.map(node => node.id));
  assert.equal(selection.select({ audio: false, limit: 0, depth: 0 }), nodes);
});

test('stable playback selection never scans the inactive full preview again', () => {
  const nodes = buildPreview({ ...DEFAULT_PARAMETERS, generations: 13 }, generationTopology);
  let gainReads = 0;
  for (const node of nodes) { const gain = node.gain; Object.defineProperty(node, 'gain', { get() { gainReads++; return gain; } }); }
  const selection = createPreviewDrawSelection(nodes), first = selection.select({ audio: true, limit: 48 });
  assert.equal(nodes.length, 16383); assert.equal(first.length, 49);
  const initialReads = gainReads;
  for (let frame = 0; frame < 120; frame++) assert.equal(selection.select({ audio: true, limit: 48 }), first);
  assert.equal(gainReads, initialReads, 'stable frames only visit bounded meter membership');
});

test('an accepted compatible pool refreshes changed ranks and eligibility at the same voice limit', () => {
  const nodes = buildPreview({ ...DEFAULT_PARAMETERS, generations: 5 }, generationTopology), selection = createPreviewDrawSelection(nodes);
  const before = selection.select({ audio: true, limit: 3 }), removed = nodes.find(node => node.priority === 2), replacement = nodes.find(node => node.priority === 3);
  removed.priority = 3; replacement.priority = 2;
  selection.invalidate();
  const reranked = selection.select({ audio: true, limit: 3 });
  assert.equal(reranked.length, before.length); assert.ok(!reranked.includes(removed)); assert.ok(reranked.includes(replacement));
  replacement.gain = 0;
  selection.invalidate();
  const eligible = selection.select({ audio: true, limit: 3 });
  assert.equal(eligible.length, before.length - 1); assert.ok(!eligible.includes(replacement));
  assert.equal(selection.select({ audio: true, limit: 3 }), eligible);
});
