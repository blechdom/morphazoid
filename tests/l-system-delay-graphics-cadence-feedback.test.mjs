import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraphicsCapacity } from '../src/instruments/micmic/native/graphics-capacity.js';

const FRAME = 1000 / 60;
function simulation({ voices = 511, demand = voices + 1 } = {}) {
  const controller = createGraphicsCapacity({ preparedVoices: voices, nodeCount: demand });
  let now = 0, drawn = controller.limit;
  const changes = [];
  return { controller, changes,
    frame({ workMs = .2, ratio = 1, interval = ratio * FRAME, expected = FRAME,
      audioLoad = .2, peakLoad = .3, applied = true } = {}) {
      if (applied) drawn = Math.min(controller.limit, demand);
      now += interval;
      const before = controller.limit;
      const changed = controller.observe({ nowMs: now, workMs, frameIntervalMs: interval,
        expectedFrameMs: expected, drawnNodes: drawn, audioLoad, peakLoad });
      if (changed) changes.push({ before, after: controller.limit, ...controller.diagnostics() });
      return changed;
    },
    run(frames, sample = () => ({})) { for (let i = 0; i < frames; i++) this.frame(sample(i)); },
  };
}

test('constant cheap doubled callbacks cannot collapse a tree and unchanged external delay permits recovery', () => {
  const f = simulation();
  f.run(900, () => ({ ratio: 2, audioLoad: .7, peakLoad: .9 }));
  assert.equal(f.changes.filter(change => change.lastChange === 'shrink').length, 1);
  assert.ok(f.changes.every(change => change.after > 100), JSON.stringify(f.changes));
  assert.equal(f.controller.limit, 512, 'cheap measured work recovers the complete available tree');
  assert.equal(f.controller.diagnostics().cadenceSuppressed, true);
  const settled = f.changes.length;
  f.run(300, () => ({ ratio: 2, audioLoad: .7, peakLoad: .9 }));
  assert.equal(f.changes.length, settled, 'continued external lateness does not restart count oscillation');
});

test('50/66ms callbacks with .4–1.5ms work and busy audio retain useful graphics instead of falling to one', () => {
  const f = simulation({ voices: 584, demand: 585 });
  f.run(300, i => ({ interval: i % 2 ? 200 / 3 : 50, expected: 1000 / 30,
    workMs: i % 2 ? 1.5 : .4, audioLoad: .87 + (i % 3) * .19, peakLoad: 1.25 }));
  assert.equal(f.changes.filter(change => change.lastChange === 'shrink').length, 1);
  assert.ok(f.controller.limit > 200);
  f.run(500, i => ({ interval: i % 2 ? 200 / 3 : 50, expected: 1000 / 30,
    workMs: i % 2 ? 1.5 : .4, audioLoad: .6, peakLoad: .7 }));
  assert.equal(f.controller.limit, 585);
  assert.equal(f.changes.filter(change => change.lastChange === 'shrink').length, 1);
});

test('a pending smaller membership cannot multiply the old frame cost into further count cuts', () => {
  for (const sample of [{ workMs: .2, ratio: 2 }, { workMs: 16, ratio: 1 }]) {
    const f = simulation();
    f.run(3, () => sample);
    const candidate = f.controller.limit;
    assert.ok(candidate < 512);
    f.run(30, () => ({ ...sample, applied: false }));
    assert.equal(f.controller.limit, candidate, 'candidate must reach actual drawing before another cut');
    assert.equal(f.controller.diagnostics().pendingLimit, candidate);
    f.frame({ ...sample, applied: true });
    assert.equal(f.controller.diagnostics().pendingLimit === candidate, false);
  }
});

test('real node-dependent asynchronous cadence permits helpful reductions and later improved capacity', () => {
  const f = simulation();
  f.run(200, () => ({ ratio: .8 + f.controller.limit / 256 }));
  const settled = f.controller.limit;
  assert.ok(settled > 50 && settled < 150, settled);
  assert.ok(f.changes.filter(change => change.lastChange === 'shrink').length >= 2);
  assert.equal(f.controller.diagnostics().cadenceSuppressed, false, 'improving delivery confirms a causal response');
  const count = f.changes.length;
  f.run(200, () => ({ ratio: .8 + f.controller.limit / 256 }));
  assert.equal(f.controller.limit, settled); assert.equal(f.changes.length, count);
  f.run(300, () => ({ ratio: .8 + f.controller.limit / 1024 }));
  assert.ok(f.controller.limit > settled, 'new real headroom remains usable');
});

test('isolated unrelated callback delays do not keep cutting successive observation windows', () => {
  const f = simulation();
  f.run(600, i => ({ workMs: 1.5, ratio: i % 20 === 0 ? 4 : 1 }));
  assert.equal(f.controller.limit, 512);
  assert.equal(f.changes.length, 0);
});

test('overlapping late-callback jitter cannot masquerade as coherent improvement after a count cut', () => {
  const f = simulation();
  f.run(600, i => ({ ratio: [2, 2.1, 1.8, 1.9, 2.05, 1.85][i % 6] }));
  assert.equal(f.changes.filter(change => change.lastChange === 'shrink').length, 1);
  assert.equal(f.controller.limit, 512);
});

test('measured own work and setup overload stay actionable while unrelated cadence is suppressed', () => {
  const f = simulation();
  f.run(40, () => ({ ratio: 2 }));
  assert.equal(f.controller.diagnostics().cadenceSuppressed, true);
  const before = f.controller.limit;
  f.frame({ workMs: 16, ratio: 2 });
  assert.ok(f.controller.limit < before);
  const controller = createGraphicsCapacity({ preparedVoices: 511, nodeCount: 512 });
  assert.equal(controller.observe({ nowMs: 0, setupMs: 40, continuous: false, drawnNodes: 512 }), true);
  assert.ok(controller.limit < 512);
});

test('additional prepared demand retains scheduling evidence and new scenes permit fresh measurement', () => {
  const f = simulation({ demand: 1024 });
  f.run(40, () => ({ ratio: 2 }));
  assert.equal(f.controller.diagnostics().cadenceSuppressed, true);
  f.controller.ensureCapacity({ availableNodes: 2048 });
  assert.equal(f.controller.diagnostics().cadenceSuppressed, true, 'audio pool growth does not invent a new rendering cause');
  f.controller.ensureCapacity({ availableNodes: 2048, sceneRevision: 'another preset' });
  assert.equal(f.controller.diagnostics().cadenceSuppressed, false);
  f.run(3, () => ({ ratio: 2 }));
  assert.equal(f.controller.diagnostics().cadenceTrial, true, 'new scene can remeasure asynchronous pressure');
});

test('zero-depth root-only drawing retains prepared membership and cannot supply a reducible-work proof', () => {
  for (const workMs of [1.5, 16]) {
    const controller = createGraphicsCapacity({ preparedVoices: 30, nodeCount: 31 });
    for (let frame = 1; frame <= 120; frame++) {
      controller.observe({ nowMs: frame * FRAME * 2, workMs, frameIntervalMs: FRAME * 2,
        expectedFrameMs: FRAME, drawnNodes: 1, audioLoad: .9, peakLoad: .95 });
    }
    assert.equal(controller.limit, 31, 'irreducible root cost cannot erase the retained tree');
    assert.equal(controller.diagnostics().changes, 0);
    for (let frame = 121; frame <= 123; frame++) {
      controller.observe({ nowMs: frame * FRAME * 2, workMs: .2, frameIntervalMs: FRAME * 2,
        expectedFrameMs: FRAME, drawnNodes: 31, audioLoad: .2, peakLoad: .3 });
      if (frame < 123) assert.equal(controller.limit, 31, 'root-only samples cannot borrow full-tree evidence');
    }
    assert.ok(controller.limit < 31);
    assert.equal(controller.diagnostics().cadenceTrial, true);
  }
});
