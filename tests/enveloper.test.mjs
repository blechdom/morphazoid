import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ENVELOPER_STATE,
  ENVELOPER_MIN_SPLIT_GAP,
  ENVELOPER_PRESETS,
  ENVELOPER_STRUCTURE,
  cloneEnveloperState,
  createEnveloperState,
  deriveEnveloperTimeline,
  enveloperLeafFrequency,
  enveloperLeafTimbre,
  sampleEnveloperEnvelope,
  sanitizeEnveloperEnvelope,
  sanitizeEnveloperState,
  updateEnveloperNode,
} from "../src/enveloper.js";

const closeTo = (actual, expected, epsilon = 1e-10) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

test("the default state is an immutable explicit 1 -> 3 -> 9 tree", () => {
  assert.equal(DEFAULT_ENVELOPER_STATE.root.nodes.length, 4);
  assert.equal(DEFAULT_ENVELOPER_STATE.branches.length, 3);
  assert.equal(DEFAULT_ENVELOPER_STATE.leaves.length, 9);
  assert.ok(DEFAULT_ENVELOPER_STATE.branches.every(({ nodes }) => nodes.length === 4));
  assert.ok(DEFAULT_ENVELOPER_STATE.leaves.every(({ pitch, timbre }) => (
    pitch >= 0 && pitch <= 1 && timbre >= 0 && timbre <= 1
  )));
  assert.deepEqual(ENVELOPER_STRUCTURE, {
    rootCount: 1,
    branchCount: 3,
    leavesPerBranch: 3,
    leafCount: 9,
    nodesPerEnvelope: 4,
  });
  assert.equal(Object.isFrozen(DEFAULT_ENVELOPER_STATE), true);
  assert.equal(Object.isFrozen(DEFAULT_ENVELOPER_STATE.root.nodes), true);
  assert.equal(Object.isFrozen(DEFAULT_ENVELOPER_STATE.root.nodes[0]), true);

  const editable = createEnveloperState();
  assert.notEqual(editable, DEFAULT_ENVELOPER_STATE);
  assert.notEqual(editable.root.nodes, DEFAULT_ENVELOPER_STATE.root.nodes);
  editable.root.nodes[1].time = 0.2;
  assert.notEqual(editable.root.nodes[1].time, DEFAULT_ENVELOPER_STATE.root.nodes[1].time);
});

test("envelope sanitization anchors endpoints and clamps monotone interior splits", () => {
  const envelope = sanitizeEnveloperEnvelope({
    nodes: [
      { time: 0.7, level: -4 },
      { time: 0.99, level: 2 },
      { time: -10, level: 0.4 },
      { time: 0.2, level: Number.NaN },
    ],
  });

  assert.equal(envelope.nodes.length, 4);
  assert.equal(envelope.nodes[0].time, 0);
  assert.equal(envelope.nodes[3].time, 1);
  assert.ok(envelope.nodes[1].time >= ENVELOPER_MIN_SPLIT_GAP);
  assert.ok(envelope.nodes[2].time >= envelope.nodes[1].time + ENVELOPER_MIN_SPLIT_GAP);
  assert.ok(envelope.nodes[3].time >= envelope.nodes[2].time + ENVELOPER_MIN_SPLIT_GAP);
  assert.deepEqual(envelope.nodes.map(({ level }) => level), [0, 1, 0.4, 0.64]);
});

test("node updates cannot cross neighbours and keep endpoint time anchors", () => {
  const original = sanitizeEnveloperEnvelope({
    nodes: [
      { time: 0, level: 0 },
      { time: 0.3, level: 0.5 },
      { time: 0.7, level: 0.5 },
      { time: 1, level: 0 },
    ],
  });
  const movedFirst = updateEnveloperNode(original, 1, { time: 0.99, level: 2 });
  closeTo(movedFirst.nodes[1].time, original.nodes[2].time - ENVELOPER_MIN_SPLIT_GAP);
  assert.equal(movedFirst.nodes[1].level, 1);
  const movedEndpoint = updateEnveloperNode(movedFirst, 0, { time: 0.4, level: 0.25 });
  assert.equal(movedEndpoint.nodes[0].time, 0);
  assert.equal(movedEndpoint.nodes[0].level, 0.25);
  assert.equal(original.nodes[1].time, 0.3, "updates must not mutate the source envelope");
});

test("envelope levels are sampled piecewise-linearly in real split time", () => {
  const envelope = {
    nodes: [
      { time: 0, level: 0 },
      { time: 0.2, level: 1 },
      { time: 0.8, level: 0.4 },
      { time: 1, level: 0 },
    ],
  };
  closeTo(sampleEnveloperEnvelope(envelope, 0.1), 0.5);
  closeTo(sampleEnveloperEnvelope(envelope, 0.5), 0.7);
  closeTo(sampleEnveloperEnvelope(envelope, 0.9), 0.2);
});

test("leaf XY uses logarithmic pitch and bounded monotone FM timbre", () => {
  const options = { minimumFrequencyHz: 100, maximumFrequencyHz: 1_600 };
  closeTo(enveloperLeafFrequency(0, options), 100);
  closeTo(enveloperLeafFrequency(0.5, options), 400);
  closeTo(enveloperLeafFrequency(1, options), 1_600);

  const dark = enveloperLeafTimbre(0);
  const middle = enveloperLeafTimbre(0.5);
  const bright = enveloperLeafTimbre(1);
  assert.equal(dark.timbre, 0);
  assert.equal(bright.timbre, 1);
  assert.ok(dark.modulationIndex < middle.modulationIndex);
  assert.ok(middle.modulationIndex < bright.modulationIndex);
  assert.ok(dark.modulationRatio < middle.modulationRatio);
  assert.ok(middle.modulationRatio < bright.modulationRatio);
  assert.ok(dark.brightness < middle.brightness);
  assert.ok(middle.brightness < bright.brightness);
});

test("the derived nine-event timeline tiles one cycle without gaps or overlaps", () => {
  const state = createEnveloperState();
  state.cycleSeconds = 13.5;
  const timeline = deriveEnveloperTimeline(state);
  assert.equal(timeline.length, 9);
  assert.equal(timeline[0].normalizedStart, 0);
  assert.equal(timeline.at(-1).normalizedEnd, 1);
  assert.equal(timeline[0].startSeconds, 0);
  assert.equal(timeline.at(-1).endSeconds, 13.5);

  for (let index = 0; index < timeline.length; index += 1) {
    const event = timeline[index];
    assert.equal(event.index, index);
    assert.equal(event.branchIndex, Math.floor(index / 3));
    assert.equal(event.leafInBranch, index % 3);
    assert.ok(event.normalizedDuration > 0);
    assert.ok(event.durationSeconds > 0);
    assert.ok(Number.isFinite(event.frequencyHz));
    assert.ok(event.timbre >= 0 && event.timbre <= 1);
    assert.ok(event.modulationIndex >= 0);
    assert.ok(event.modulationRatio >= 0.5 && event.modulationRatio <= 8);
    assert.ok(event.brightness >= 0 && event.brightness <= 1);
    assert.ok(event.pan >= -1 && event.pan <= 1);
    closeTo(event.amplitude, event.parentLevel * event.childLevel);
    if (index > 0) closeTo(event.normalizedStart, timeline[index - 1].normalizedEnd);
  }
  closeTo(
    timeline.reduce((sum, event) => sum + event.normalizedDuration, 0),
    1,
  );
  closeTo(
    timeline.reduce((sum, event) => sum + event.durationSeconds, 0),
    state.cycleSeconds,
  );
  assert.equal(Object.isFrozen(timeline), true);
  assert.equal(Object.isFrozen(timeline[0]), true);
});

test("moving a root split shortens its left subtree and lengthens its right subtree", () => {
  const state = createEnveloperState();
  const before = deriveEnveloperTimeline(state);
  const firstRootSplit = state.root.nodes[1].time;
  state.root = updateEnveloperNode(state.root, 1, { time: firstRootSplit - 0.12 });
  const after = deriveEnveloperTimeline(state);

  for (let index = 0; index < 3; index += 1) {
    assert.ok(after[index].normalizedDuration < before[index].normalizedDuration);
  }
  for (let index = 3; index < 6; index += 1) {
    assert.ok(after[index].normalizedDuration > before[index].normalizedDuration);
  }
  for (let index = 6; index < 9; index += 1) {
    closeTo(after[index].normalizedDuration, before[index].normalizedDuration);
  }
});

test("moving a branch split trades duration only between its adjacent leaves", () => {
  const state = cloneEnveloperState();
  const before = deriveEnveloperTimeline(state);
  state.branches[1] = updateEnveloperNode(state.branches[1], 1, {
    time: state.branches[1].nodes[1].time - 0.1,
  });
  const after = deriveEnveloperTimeline(state);

  assert.ok(after[3].normalizedDuration < before[3].normalizedDuration);
  assert.ok(after[4].normalizedDuration > before[4].normalizedDuration);
  closeTo(after[5].normalizedDuration, before[5].normalizedDuration);
  for (const index of [0, 1, 2, 6, 7, 8]) {
    closeTo(after[index].normalizedDuration, before[index].normalizedDuration);
  }
});

test("all four deeply frozen presets sanitize into complete playable cycles", () => {
  assert.equal(ENVELOPER_PRESETS.length, 4);
  assert.equal(new Set(ENVELOPER_PRESETS.map(({ id }) => id)).size, 4);
  for (const preset of ENVELOPER_PRESETS) {
    assert.equal(Object.isFrozen(preset), true);
    assert.equal(Object.isFrozen(preset.state), true);
    assert.equal(Object.isFrozen(preset.state.branches[0].nodes[0]), true);
    const state = sanitizeEnveloperState(preset.state);
    const timeline = deriveEnveloperTimeline(state);
    assert.equal(timeline.length, 9);
    closeTo(timeline[0].normalizedStart, 0);
    closeTo(timeline.at(-1).normalizedEnd, 1);
    closeTo(timeline.reduce((sum, event) => sum + event.normalizedDuration, 0), 1);
  }
});
