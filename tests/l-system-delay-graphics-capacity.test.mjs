import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraphicsCapacity, createConnectedGraphicsSelection, selectConnectedGraphics } from '../src/instruments/micmic/native/graphics-capacity.js';

const graph = [
  { id: 'root', parentId: null, generation: 0, voiceIndex: 0 },
  { id: 'a', parentId: 'root', generation: 1, priority: 3, voiceIndex: 19, gain: .5 },
  { id: 'b', parentId: 'root', generation: 1, priority: 0, voiceIndex: 2, gain: .5 },
  { id: 'a1', parentId: 'a', generation: 2, priority: 2, voiceIndex: 38, gain: .2 },
  { id: 'b1', parentId: 'b', generation: 2, priority: 1, voiceIndex: 4, gain: .2 },
  { id: 'unavailable', parentId: 'root', generation: 1, priority: null, voiceIndex: 99, gain: 0 },
];
const ids = nodes => nodes.map(node => node.id);

test('graphics selection stays rooted and connected even when child ranks precede parents', () => {
  for (let count = 0; count <= graph.length; count++) {
    const result = selectConnectedGraphics(graph, count), seen = new Set();
    assert.equal(result.length, count);
    for (const node of result) {
      if (node.parentId !== null) assert.ok(seen.has(node.parentId), node.id);
      seen.add(node.id); assert.ok(graph.includes(node), 'original metadata references');
    }
  }
  assert.deepEqual(ids(selectConnectedGraphics(graph, 5)), ['root', 'b', 'b1', 'a', 'a1']);
  assert.deepEqual(ids(selectConnectedGraphics([graph[4], graph[3], graph[0], graph[1], graph[2], graph[5]], 5)), ['root', 'b', 'b1', 'a', 'a1']);
});

test('raw Rust keys select before normalization and retain voice slots, gain and release metadata', () => {
  const raw = graph.map(({ id, parentId, ...node }, index) => ({ ...node, id: index,
    parent: parentId === null ? 0 : graph.findIndex(node => node.id === parentId),
    key: `generation:${id}`, parentKey: parentId === null ? '' : `generation:${parentId}` }));
  const original = structuredClone(raw), selected = selectConnectedGraphics(raw, 4);
  assert.deepEqual(selected.map(node => node.key), ['generation:root', 'generation:b', 'generation:b1', 'generation:a']);
  assert.ok(selected.every(node => raw.includes(node))); assert.deepEqual(raw, original);
  assert.deepEqual(selected.map(node => node.voiceIndex), [0, 2, 4, 19]);
});

test('cached prefixes retain identity, shrink without lost ancestors and grow without per-frame clones', () => {
  const selector = createConnectedGraphicsSelection(graph);
  const a = selector.select(3); assert.equal(selector.select(3), a);
  const larger = selector.select(5); assert.deepEqual(larger.slice(0, 3), a);
  const smaller = selector.select(2); assert.deepEqual(smaller, larger.slice(0, 2));
  const full = selector.select(100); assert.equal(selector.select(200), full);
  assert.equal(selector.select(Infinity), full); assert.deepEqual(ids(full), ['root', 'b', 'b1', 'a', 'a1', 'unavailable']);
});

test('malformed detached, duplicate and cyclic nodes cannot create an unrooted view', () => {
  const nodes = [...graph, { id: 'orphan', parentId: 'absent', priority: -1 },
    { id: 'self', parentId: 'self', priority: 0 }, { id: 'cycle1', parentId: 'cycle2' },
    { id: 'cycle2', parentId: 'cycle1' }, { ...graph[1], priority: 0 }, { parentId: 'root' }];
  assert.deepEqual(selectConnectedGraphics(nodes, Infinity), selectConnectedGraphics(graph, Infinity));
  assert.deepEqual(selectConnectedGraphics([], 100), []);
  assert.deepEqual(selectConnectedGraphics(graph, NaN), []);
});

test('initial measured capacity and subsequent graphics reductions survive small presets', () => {
  const device = createGraphicsCapacity({ preparedVoices: 100000, nodeCount: 4 });
  assert.equal(device.limit, 100001);
  device.ensureCapacity({ preparedVoices: 200000, availableNodes: 20 });
  assert.equal(device.limit, 100001, 'demand and audio calibration do not erase graphics learning');
  assert.equal(device.observe({ nowMs: 0, workMs: 20, drawnNodes: 20 }), true);
  const reduced = device.limit;
  device.ensureCapacity({ availableNodes: 2 }); assert.equal(device.limit, reduced);
  for (let i = 1; i <= 200; i++) device.observe({ nowMs: i * 17, workMs: .1, frameIntervalMs: 17, drawnNodes: 2 });
  assert.equal(device.limit, reduced, 'cheap undersized samples cannot inflate learned capacity');
});

test('setup, rendered frame cost, cadence and audio warnings reduce node count immediately', () => {
  for (const sample of [{ setupMs: 32 }, { workMs: 16 }, { workMs: 1, frameIntervalMs: 80 }, { workMs: 3, audioLoad: .9 }, { workMs: 3, peakLoad: .98 }]) {
    const device = createGraphicsCapacity({ preparedVoices: 999, nodeCount: 10000 });
    assert.equal(device.observe({ nowMs: 100, ...sample }), true, JSON.stringify(sample));
    assert.ok(device.limit <= 800); assert.ok(device.limit >= 1);
  }
  const floor = createGraphicsCapacity({ preparedVoices: 0, nodeCount: 10 });
  assert.equal(floor.observe({ nowMs: 0, setupMs: 10000 }), false); assert.equal(floor.limit, 1);
});

test('cheap graphics survive a busy audio thread and a single unrelated late callback', () => {
  const device = createGraphicsCapacity({ preparedVoices: 999, nodeCount: 2000 });
  for (let i = 0; i < 120; i++) device.observe({ nowMs: i * 17, workMs: .2, audioLoad: .9, peakLoad: .98 });
  const before = device.limit; assert.ok(before >= 1000);
  assert.equal(device.observe({ nowMs: 2500, workMs: .2, frameIntervalMs: 80 }), false);
  assert.equal(device.limit, before);
  device.ensureCapacity({ availableNodes: 10000 });
  for (let i = 0; i < 120; i++) device.observe({ nowMs: 2600 + i * 17, workMs: .2, frameIntervalMs: 17,
    drawnNodes: device.limit, audioLoad: .8, peakLoad: .9 });
  assert.ok(device.limit > before, 'measured cheap graphics can grow while audio uses its own proven capacity');
});

test('sustained headroom cautiously grows beyond historic graphical caps without changing audio', () => {
  const audio = Object.freeze({ voiceLimit: 300000, targetVoices: 250000 });
  const device = createGraphicsCapacity({ preparedVoices: 2047, nodeCount: 1000000, growthDelayMs: 200 });
  for (let i = 0; i < 1200; i++) device.observe({ nowMs: i * 17, workMs: .3, frameIntervalMs: 17, drawnNodes: device.limit, audioLoad: .2, peakLoad: .3 });
  assert.ok(device.limit > 100000, device.limit);
  assert.ok(device.limit <= 1000000); assert.deepEqual(audio, { voiceLimit: 300000, targetVoices: 250000 });
  assert.equal(device.diagnostics().lastChange, 'grow');
});

test('idle gaps and intentional low FPS do not falsely shrink topology capacity', () => {
  const device = createGraphicsCapacity({ preparedVoices: 999, nodeCount: 2000 });
  assert.equal(device.observe({ nowMs: 0, workMs: 1, frameIntervalMs: 60000, continuous: false }), false);
  assert.equal(device.observe({ nowMs: 100, workMs: 1, frameIntervalMs: 50, expectedFrameMs: 50 }), false);
  assert.equal(device.limit, 1000);
  assert.equal(device.observe({ nowMs: 90, workMs: 1 }), false, 'clock reversal cannot count toward growth');
  assert.equal(device.observe({ nowMs: 110 }), false, 'missing measurement is not evidence of headroom');
});

test('growth stops at demand and invalid settings keep a finite usable root budget', () => {
  const device = createGraphicsCapacity({ preparedVoices: NaN, nodeCount: 3, growthDelayMs: 50, workBudgetMs: NaN });
  for (let i = 0; i < 150; i++) device.observe({ nowMs: i * 17, workMs: .1, drawnNodes: device.limit });
  assert.equal(device.limit, 3);
  for (let i = 150; i < 250; i++) device.observe({ nowMs: i * 17, workMs: .1, drawnNodes: 3 });
  assert.equal(device.limit, 3);
});
