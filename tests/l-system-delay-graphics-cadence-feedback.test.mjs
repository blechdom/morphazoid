import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraphicsCapacity } from '../src/instruments/micmic/native/graphics-capacity.js';
import { visualBudget } from '../src/instruments/micmic/native/model.js';

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
    for (let frame = 0; frame < 3 && !f.changes.length; frame++) f.frame(sample);
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
    assert.equal(controller.limit, 31, 'unchanged external delay remains harmless after admission resumes');
    assert.equal(controller.diagnostics().cadenceSuppressed, true);
  }
});

test('work-origin root collapse recovers after sustained cheap work despite unrelated callback delays', () => {
  const f = simulation();
  f.run(10, () => ({ workMs: 16, ratio: 2 }));
  assert.ok(f.controller.limit > 1, 'unimproved work no longer repeatedly collapses the cached tree');
  assert.equal(f.controller.diagnostics().cadenceTrial, false);
  f.run(1000, () => ({ workMs: .2, ratio: 2 }));
  assert.equal(f.controller.limit, 512, 'a working graph cannot remain stuck on its input root');
  assert.equal(f.controller.diagnostics().cadenceSuppressed, true);
});

test('DPR or history startup cost does not strand cheap graphics when full audio stays near its deadline', () => {
  const f = simulation();
  f.run(10, () => ({ workMs: 32, ratio: 3, audioLoad: 1.05, peakLoad: 1.4 }));
  assert.ok(f.controller.limit > 1);
  f.run(1000, () => ({ workMs: .2, ratio: 2, audioLoad: 1.05, peakLoad: 1.4 }));
  assert.equal(f.controller.limit, 512, 'own measured drawing cost, with audio weighting, proves cheap recovery');
  assert.equal(f.controller.diagnostics().cadenceSuppressed, true);
});

test('a small current scene recovers after startup overhead without inflating beyond its prepared demand', () => {
  const f = simulation({ voices: 511, demand: 31 });
  f.run(10, () => ({ workMs: 16, ratio: 2 }));
  assert.ok(f.controller.limit > 1);
  f.run(400, () => ({ workMs: .2, ratio: 2 }));
  assert.equal(f.controller.limit, 512, 'the smaller scene retains the existing device budget');
  assert.equal(Math.min(f.controller.limit, f.controller.diagnostics().availableNodes), 31,
    'actual membership stays bounded by the current prepared scene');
});

test('idle drawing cannot fabricate a proof while actual root drawing can measure its irreducible floor', () => {
  const controller = createGraphicsCapacity({ preparedVoices: 0, nodeCount: 512 });
  for (let frame = 1; frame <= 120; frame++) {
    controller.observe({ nowMs: frame * FRAME, workMs: .2, frameIntervalMs: FRAME * 2,
      expectedFrameMs: FRAME, continuous: false, drawnNodes: 1 });
  }
  assert.equal(controller.diagnostics().cadenceSuppressed, false);
  assert.equal(controller.diagnostics().workFloor, 0);
  const idleLimit = controller.limit;
  for (let frame = 121; frame <= 240; frame++) {
    controller.observe({ nowMs: frame * FRAME, workMs: 16, frameIntervalMs: FRAME * 2,
      expectedFrameMs: FRAME, drawnNodes: 1 });
  }
  assert.equal(controller.limit, idleLimit);
  assert.equal(controller.diagnostics().cadenceSuppressed, true);
  assert.equal(controller.diagnostics().workFloor, 15);
});

test('a trial reaching the root can resolve and recover a second available branch', () => {
  const f = simulation({ voices: 1, demand: 2 });
  f.run(3, () => ({ ratio: 2 }));
  assert.equal(f.controller.limit, 1);
  assert.equal(f.controller.diagnostics().cadenceTrial, true);
  f.run(200, () => ({ ratio: 2 }));
  assert.equal(f.controller.limit, 2, 'root-only trial must not strand the retained available branch');
  assert.equal(f.controller.diagnostics().cadenceTrial, false);
  assert.equal(f.controller.diagnostics().cadenceSuppressed, true);
});

test('constant 6ms and 16ms frame overhead restores useful membership after a coherent unsuccessful cut', () => {
  for (const workMs of [6, 16]) {
    const f = simulation();
    const interval = Math.ceil(workMs / 75 * 1000 / FRAME) * FRAME;
    f.run(200, () => ({ workMs, interval, expected: interval, audioLoad: .7, peakLoad: .85 }));
    assert.equal(f.controller.limit, 512);
    assert.equal(f.changes.filter(change => change.lastChange === 'shrink').length, 1);
    assert.equal(f.changes.filter(change => change.lastChange === 'restore').length, 1);
    assert.equal(f.controller.diagnostics().workFloor, workMs - 1);
    assert.equal(f.controller.diagnostics().workMs, workMs, 'total rendering cost remains visible');
    assert.equal(visualBudget(.7, .85, false, true, workMs).fps, 75 / workMs,
      'total rendering cost continues to reduce drawing frequency');
  }
});

test('pure per-node work continues useful backoff and settles without fabricating a fixed floor', () => {
  const f = simulation();
  f.run(300, () => ({ workMs: .2 + f.controller.limit * .01, audioLoad: .7, peakLoad: .85 }));
  const settled = f.controller.limit, changes = f.changes.length;
  assert.ok(settled > 100 && settled < 400);
  assert.equal(f.controller.diagnostics().workFloor, 0);
  f.run(300, () => ({ workMs: .2 + f.controller.limit * .01, audioLoad: .7, peakLoad: .85 }));
  assert.equal(f.controller.limit, settled); assert.equal(f.changes.length, changes);
});

test('mixed fixed and per-node cost leaves a useful bounded tree and remeasures increased incremental cost', () => {
  const f = simulation();
  f.run(500, () => ({ workMs: 6 + f.controller.limit * .01, audioLoad: .7, peakLoad: .85 }));
  const before = f.controller.limit;
  assert.ok(before > 40 && before < 400, before);
  assert.ok(f.controller.diagnostics().workFloor > 4);
  f.run(500, () => ({ workMs: 6 + f.controller.limit * .1, audioLoad: .7, peakLoad: .85 }));
  assert.ok(f.controller.limit > 1 && f.controller.limit < before, f.controller.limit);
});

test('a cheaper rendering mode revokes an obsolete floor before node-dependent cost is judged', () => {
  const f = simulation();
  f.run(60, () => ({ workMs: 6 }));
  assert.equal(f.controller.diagnostics().workFloor, 5);
  f.run(60, () => ({ workMs: .2 }));
  assert.equal(f.controller.diagnostics().workFloor, 0);
  f.frame({ workMs: 16 });
  assert.ok(f.controller.limit < 512);
  assert.equal(f.controller.diagnostics().workTrial, true);
});

test('expensive root-only canvas overhead can recover a larger prepared tree without an audio-load gate', () => {
  const f = simulation({ voices: 0, demand: 31 });
  f.run(600, () => ({ workMs: 2, ratio: 2, audioLoad: 1.1, peakLoad: 1.4 }));
  assert.equal(f.controller.limit, 31);
  assert.equal(f.controller.diagnostics().workFloor, 1);
});
