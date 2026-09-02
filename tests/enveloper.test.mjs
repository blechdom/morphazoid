import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ENVELOPER_STATE,
  ENVELOPER_LIMITS,
  ENVELOPER_MIN_SPLIT_GAP,
  ENVELOPER_PRESETS,
  ENVELOPER_STRUCTURE,
  cloneEnveloperState,
  createDefaultEnveloperLeafEnvelopes,
  createEnveloperState,
  deriveEnveloperTimeline,
  enveloperInheritedGlideSemitones,
  enveloperLeafFrequency,
  enveloperLeafTimbre,
  enveloperNormalizedSlope,
  sampleEnveloperEnvelope,
  sanitizeEnveloperEnvelope,
  sanitizeEnveloperLeaf,
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
  assert.ok(DEFAULT_ENVELOPER_STATE.leaves.every(({
    pitch,
    timbre,
    pitchEnvelope,
    indexEnvelope,
  }) => (
    pitch >= 0 && pitch <= 1
      && timbre >= 0 && timbre <= 1
      && pitchEnvelope.nodes.length === 4
      && indexEnvelope.nodes.length === 4
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
  assert.equal(Object.isFrozen(DEFAULT_ENVELOPER_STATE.leaves[0].pitchEnvelope.nodes), true);
  assert.equal(Object.isFrozen(DEFAULT_ENVELOPER_STATE.leaves[0].indexEnvelope.nodes[0]), true);

  const editable = createEnveloperState();
  assert.notEqual(editable, DEFAULT_ENVELOPER_STATE);
  assert.notEqual(editable.root.nodes, DEFAULT_ENVELOPER_STATE.root.nodes);
  editable.root.nodes[1].time = 0.2;
  assert.notEqual(editable.root.nodes[1].time, DEFAULT_ENVELOPER_STATE.root.nodes[1].time);
  editable.leaves[0].pitchEnvelope.nodes[1].level = 0;
  assert.notEqual(
    editable.leaves[0].pitchEnvelope.nodes[1].level,
    DEFAULT_ENVELOPER_STATE.leaves[0].pitchEnvelope.nodes[1].level,
  );
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

test("leaf sanitization preserves scalar controls and repairs both four-node contours", () => {
  const leaf = sanitizeEnveloperLeaf({
    pitch: 4,
    timbre: -2,
    pitchEnvelope: {
      nodes: [
        { time: 0.8, level: -1 },
        { time: 0.99, level: 0.25 },
        { time: -3, level: 2 },
        { time: 0.1, level: 0.75 },
      ],
    },
    indexEnvelope: {
      nodes: [
        { x: 0.4, y: 0.1 },
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.7 },
        { x: 0.6, y: 0.9 },
      ],
    },
  }, undefined, 4);

  assert.equal(leaf.pitch, 1);
  assert.equal(leaf.timbre, 0);
  for (const envelope of [leaf.pitchEnvelope, leaf.indexEnvelope]) {
    assert.equal(envelope.nodes.length, 4);
    assert.equal(envelope.nodes[0].time, 0);
    assert.equal(envelope.nodes[3].time, 1);
    assert.ok(envelope.nodes[1].time >= ENVELOPER_MIN_SPLIT_GAP);
    assert.ok(envelope.nodes[2].time >= envelope.nodes[1].time + ENVELOPER_MIN_SPLIT_GAP);
    assert.ok(envelope.nodes.every(({ level }) => level >= 0 && level <= 1));
  }
  assert.deepEqual(leaf.pitchEnvelope.nodes.map(({ level }) => level), [0, 0.25, 1, 0.75]);
  assert.deepEqual(leaf.indexEnvelope.nodes.map(({ level }) => level), [0.1, 0.3, 0.7, 0.9]);
});

test("legacy scalar-only leaves receive deterministic, independent contour defaults", () => {
  const legacy = {
    leaves: Array.from({ length: ENVELOPER_STRUCTURE.leafCount }, (_, index) => ({
      pitch: index / ENVELOPER_STRUCTURE.leafCount,
      timbre: 0.5,
    })),
  };
  const first = sanitizeEnveloperState(legacy);
  const second = sanitizeEnveloperState(legacy);

  assert.deepEqual(first.leaves, second.leaves);
  assert.deepEqual(
    first.leaves[4].pitchEnvelope,
    createDefaultEnveloperLeafEnvelopes(4).pitchEnvelope,
  );
  assert.notDeepEqual(first.leaves[0].pitchEnvelope, first.leaves[1].pitchEnvelope);
  assert.notEqual(first.leaves[0].pitchEnvelope, second.leaves[0].pitchEnvelope);
  assert.notEqual(first.leaves[0].pitchEnvelope.nodes, second.leaves[0].pitchEnvelope.nodes);

  first.leaves[0].pitchEnvelope.nodes[1].level = 0;
  assert.notEqual(
    first.leaves[0].pitchEnvelope.nodes[1].level,
    second.leaves[0].pitchEnvelope.nodes[1].level,
  );
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

test("normalized ancestor slopes retain direction and stay bounded", () => {
  assert.equal(
    enveloperNormalizedSlope({ time: 0, level: 0.5 }, { time: 1, level: 0.5 }),
    0,
  );
  assert.ok(
    enveloperNormalizedSlope({ time: 0, level: 0.2 }, { time: 1, level: 0.8 }) > 0,
  );
  assert.ok(
    enveloperNormalizedSlope({ time: 0, level: 0.8 }, { time: 1, level: 0.2 }) < 0,
  );
  assert.ok(
    Math.abs(enveloperNormalizedSlope(
      { time: 0, level: 0 },
      { time: Number.MIN_VALUE, level: 1 },
    )) <= 1,
  );
  assert.equal(
    enveloperNormalizedSlope({ time: 1, level: 0 }, { time: 0, level: 1 }),
    0,
    "non-forward segments cannot create an unsafe slope",
  );
});

test("rising, falling, and flat ancestor segments bend leaf pitch in kind", () => {
  const neutralPitchEnvelope = {
    nodes: [0, 0.25, 0.75, 1].map((time) => ({ time, level: 0.5 })),
  };
  const eventFor = ({ rootStart, rootEnd, branchStart, branchEnd }) => {
    const state = createEnveloperState();
    state.root.nodes[0].level = rootStart;
    state.root.nodes[1].level = rootEnd;
    state.branches[0].nodes[0].level = branchStart;
    state.branches[0].nodes[1].level = branchEnd;
    state.leaves[0].pitchEnvelope = neutralPitchEnvelope;
    return deriveEnveloperTimeline(state)[0];
  };
  const flat = eventFor({ rootStart: 0.5, rootEnd: 0.5, branchStart: 0.5, branchEnd: 0.5 });
  const rootRise = eventFor({ rootStart: 0.4, rootEnd: 0.6, branchStart: 0.5, branchEnd: 0.5 });
  const branchRise = eventFor({ rootStart: 0.5, rootEnd: 0.5, branchStart: 0.4, branchEnd: 0.6 });
  const bothRise = eventFor({ rootStart: 0.4, rootEnd: 0.6, branchStart: 0.4, branchEnd: 0.6 });
  const bothFall = eventFor({ rootStart: 0.6, rootEnd: 0.4, branchStart: 0.6, branchEnd: 0.4 });

  assert.ok(flat.frequencyEnvelope.every(({ value }) => value === flat.frequencyHz));
  assert.ok(rootRise.frequencyEnvelope.at(-1).value > rootRise.frequencyEnvelope[0].value);
  assert.ok(branchRise.frequencyEnvelope.at(-1).value > branchRise.frequencyEnvelope[0].value);
  assert.ok(bothRise.frequencyEnvelope.at(-1).value > bothRise.frequencyEnvelope[0].value);
  assert.ok(bothFall.frequencyEnvelope.at(-1).value < bothFall.frequencyEnvelope[0].value);
  assert.ok(bothRise.inheritedGlideSemitones > rootRise.inheritedGlideSemitones);
  assert.ok(bothRise.inheritedGlideSemitones > branchRise.inheritedGlideSemitones);
  closeTo(bothFall.inheritedGlideSemitones, -bothRise.inheritedGlideSemitones);
  closeTo(
    Math.sqrt(
      bothRise.frequencyEnvelope[0].value * bothRise.frequencyEnvelope.at(-1).value,
    ),
    bothRise.frequencyHz,
    1e-8,
  );
  closeTo(
    Math.sqrt(
      bothFall.frequencyEnvelope[0].value * bothFall.frequencyEnvelope.at(-1).value,
    ),
    bothFall.frequencyHz,
    1e-8,
  );
});

test("leaf pitch levels are centered at 0.5 and FM-index levels multiply the base", () => {
  const state = createEnveloperState();
  state.root.nodes.forEach((node) => { node.level = 0.5; });
  state.branches[0].nodes.forEach((node) => { node.level = 0.5; });
  state.leaves[0].pitchEnvelope = {
    nodes: [
      { time: 0, level: 0.5 },
      { time: 0.25, level: 1 },
      { time: 0.75, level: 0 },
      { time: 1, level: 0.5 },
    ],
  };
  state.leaves[0].indexEnvelope = {
    nodes: [
      { time: 0, level: 0 },
      { time: 0.25, level: 0.25 },
      { time: 0.75, level: 0.75 },
      { time: 1, level: 1 },
    ],
  };
  const event = deriveEnveloperTimeline(state, { leafPitchEnvelopeSemitones: 7 })[0];

  closeTo(event.frequencyEnvelope[0].value, event.frequencyHz);
  closeTo(event.frequencyEnvelope[1].value, event.frequencyHz * 2 ** (7 / 12));
  closeTo(event.frequencyEnvelope[2].value, event.frequencyHz * 2 ** (-7 / 12));
  closeTo(event.frequencyEnvelope[3].value, event.frequencyHz);
  assert.deepEqual(
    event.modulationIndexEnvelope.map(({ value }) => value),
    [0, 0.25, 0.75, 1].map((level) => event.modulationIndex * level),
  );
});

test("combined inherited glide and automation values remain within hard limits", () => {
  const steepRise = [
    { time: 0, level: 0 },
    { time: ENVELOPER_MIN_SPLIT_GAP, level: 1 },
  ];
  const inherited = enveloperInheritedGlideSemitones(
    ...steepRise,
    ...steepRise,
    {
      rootSlopeSemitones: 1e9,
      branchSlopeSemitones: 1e9,
      maximumInheritedGlideSemitones: 1e9,
    },
  );
  assert.ok(inherited <= ENVELOPER_LIMITS.inheritedGlideSemitones.maximum);
  assert.ok(inherited >= -ENVELOPER_LIMITS.inheritedGlideSemitones.maximum);

  const state = createEnveloperState();
  state.leaves[0].pitch = 1;
  state.leaves[0].timbre = 1;
  state.leaves[0].pitchEnvelope.nodes.forEach((node) => { node.level = 1; });
  state.leaves[0].indexEnvelope.nodes.forEach((node) => { node.level = 1; });
  state.root.nodes[0].level = 0;
  state.root.nodes[1].level = 1;
  state.branches[0].nodes[0].level = 0;
  state.branches[0].nodes[1].level = 1;
  const event = deriveEnveloperTimeline(state, {
    maximumFrequencyHz: ENVELOPER_LIMITS.frequencyHz.maximum,
    leafPitchEnvelopeSemitones: 1e9,
    rootSlopeSemitones: 1e9,
    branchSlopeSemitones: 1e9,
    maximumInheritedGlideSemitones: 1e9,
    maximumModulationIndex: 1e9,
  })[0];

  assert.ok(Math.abs(event.inheritedGlideSemitones) <= 12);
  assert.ok(event.frequencyEnvelope.every(({ value }) => (
    value >= ENVELOPER_LIMITS.frequencyHz.minimum
      && value <= ENVELOPER_LIMITS.frequencyHz.maximum
  )));
  assert.ok(event.modulationIndexEnvelope.every(({ value }) => (
    value >= ENVELOPER_LIMITS.modulationIndex.minimum
      && value <= ENVELOPER_LIMITS.modulationIndex.maximum
  )));
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
    assert.equal(event.frequencyEnvelope.length, 4);
    assert.equal(event.frequencyEnvelope[0].time, 0);
    assert.equal(event.frequencyEnvelope.at(-1).time, 1);
    assert.ok(event.frequencyEnvelope.every(({ time, value }, pointIndex, envelope) => (
      time >= 0
        && time <= 1
        && value >= ENVELOPER_LIMITS.frequencyHz.minimum
        && value <= ENVELOPER_LIMITS.frequencyHz.maximum
        && (pointIndex === 0 || time > envelope[pointIndex - 1].time)
    )));
    assert.ok(event.timbre >= 0 && event.timbre <= 1);
    assert.ok(event.modulationIndex >= 0);
    assert.equal(event.modulationIndexEnvelope.length, 4);
    assert.equal(event.modulationIndexEnvelope[0].time, 0);
    assert.equal(event.modulationIndexEnvelope.at(-1).time, 1);
    assert.ok(event.modulationIndexEnvelope.every(({ time, value }, pointIndex, envelope) => (
      time >= 0
        && time <= 1
        && value >= ENVELOPER_LIMITS.modulationIndex.minimum
        && value <= ENVELOPER_LIMITS.modulationIndex.maximum
        && (pointIndex === 0 || time > envelope[pointIndex - 1].time)
    )));
    for (let pointIndex = 0; pointIndex < event.modulationIndexEnvelope.length; pointIndex += 1) {
      closeTo(
        event.modulationIndexEnvelope[pointIndex].value,
        event.modulationIndex * state.leaves[index].indexEnvelope.nodes[pointIndex].level,
      );
    }
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
  assert.equal(Object.isFrozen(timeline[0].frequencyEnvelope), true);
  assert.equal(Object.isFrozen(timeline[0].frequencyEnvelope[0]), true);
  assert.equal(Object.isFrozen(timeline[0].modulationIndexEnvelope), true);
  assert.equal(Object.isFrozen(timeline[0].modulationIndexEnvelope[0]), true);
});

test("the model keeps every nested leaf long enough for exact FM rendering", () => {
  const state = createEnveloperState();
  state.cycleSeconds = 0.75;
  const minimumTimes = [0, ENVELOPER_MIN_SPLIT_GAP, ENVELOPER_MIN_SPLIT_GAP * 2, 1];
  state.root.nodes.forEach((node, index) => { node.time = minimumTimes[index]; });
  state.branches.forEach((branch) => {
    branch.nodes.forEach((node, index) => { node.time = minimumTimes[index]; });
  });

  const timeline = deriveEnveloperTimeline(state);
  assert.equal(
    timeline.at(-1).endSeconds,
    ENVELOPER_LIMITS.cycleSeconds.minimum,
  );
  assert.ok(timeline.every(({ durationSeconds }) => durationSeconds >= 0.025));
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
