import assert from "node:assert/strict";
import test from "node:test";

import { buildShapesScene } from "../src/shapes-scene.js";
import {
  MAX_SHAPES_2D_HEADS,
  createShapesState,
  setShapes2dHeadCount,
  setShapes2dHeadOffset,
  shapes2dHeadPhase,
  shapes2dHeadTravel,
  toggleShapes2dHeadOption,
} from "../src/shapes-state.js";
import {
  advanceShapesRhythmSample,
  createShapesRhythmSample,
} from "../src/shapes-rhythm.js";

const EPSILON = 1e-10;

function assertClose(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= EPSILON,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test("2D multihead defaults and legacy aliases sanitize into the canonical state", () => {
  const defaults = createShapesState().dimension["2d"];
  assert.equal(defaults.heads, 1);
  assert.deepEqual(defaults.headOffsets, [0]);
  assert.equal(defaults.scanLineAxes.length, MAX_SHAPES_2D_HEADS);
  assert.ok(defaults.scanLineAxes.every((axis) => axis === "vertical"));
  assert.ok(defaults.traceHeadDirections.every((direction) => direction === 1));
  assert.ok(defaults.radialHeadDirections.every((direction) => direction === 1));

  const migrated = createShapesState({
    dimension: {
      "2d": {
        headCount: 3,
        readerOffsets: [-0.25, 0.5, 1.25],
        lineAxes: ["horizontal", "bad", "horizontal"],
        pointHeadDirections: [-1, 0, 1],
        radarHeadDirections: [1, -1, -8],
        pointHeadDirectionAdjustments: [0.2, Number.NaN, -0.3],
        radarHeadDirectionAdjustments: [0.4, -0.1, 0],
      },
    },
  }).dimension["2d"];
  assert.equal(migrated.heads, 3);
  assert.deepEqual(migrated.headOffsets, [0.75, 0.5, 0.25]);
  assert.deepEqual(migrated.scanLineAxes.slice(0, 3), ["horizontal", "vertical", "horizontal"]);
  assert.deepEqual(migrated.traceHeadDirections.slice(0, 3), [-1, 1, 1]);
  assert.deepEqual(migrated.radialHeadDirections.slice(0, 3), [1, -1, -1]);
  assert.deepEqual(migrated.traceHeadDirectionAdjustments.slice(0, 3), [0.2, 0, -0.3]);
  assert.deepEqual(migrated.radialHeadDirectionAdjustments.slice(0, 3), [0.4, -0.1, 0]);
});

test("head count, offsets, line axes, and point/radar directions retain original semantics", () => {
  const state = createShapesState({ play: { continuousPhase: 0.37 } });
  setShapes2dHeadCount(state, 3);
  assert.deepEqual(state.dimension["2d"].headOffsets, [0, 1 / 3, 2 / 3]);
  setShapes2dHeadOffset(state, 1, -0.1);
  assertClose(state.dimension["2d"].headOffsets[1], 0.9, "custom offsets wrap");

  const pointTravel = shapes2dHeadTravel(state, 1, "points");
  const pointPhase = shapes2dHeadPhase(state, 1, "points");
  toggleShapes2dHeadOption(state, 1, "points");
  assert.equal(state.dimension["2d"].traceHeadDirections[1], -1);
  assert.equal(state.dimension["2d"].radialHeadDirections[1], 1, "reader directions stay independent");
  assertClose(shapes2dHeadTravel(state, 1, "points"), pointTravel, "direction toggle preserves travel");
  assertClose(shapes2dHeadPhase(state, 1, "points"), pointPhase, "direction toggle has no visual jump");

  state.play.continuousPhase += 0.1;
  assertClose(shapes2dHeadTravel(state, 1, "points"), pointTravel - 0.1, "reversed point head moves backward");
  assertClose(shapes2dHeadTravel(state, 1, "radar"), 1.37, "radar head still moves forward");

  toggleShapes2dHeadOption(state, 1, "line");
  assert.equal(state.dimension["2d"].scanLineAxes[1], "horizontal");
  toggleShapes2dHeadOption(state, 1, "line");
  assert.equal(state.dimension["2d"].scanLineAxes[1], "vertical");

  setShapes2dHeadCount(state, 2);
  assert.deepEqual(state.dimension["2d"].headOffsets, [0, 0.5], "count changes restore even spacing");
  assertClose(
    shapes2dHeadTravel(state, 1, "points"),
    state.play.continuousPhase + 0.5,
    "count changes rebase reversed heads at the current position",
  );
});

test("2D scenes expose all readers while preserving the legacy reader property", () => {
  const state = createShapesState({
    play: { continuousPhase: 0.9, motion: "loop" },
    dimension: { "2d": { heads: 3, headOffsets: [0, 0.25, 0.75] } },
  });
  const scene = buildShapesScene(state);

  assert.equal(scene.readers.length, 3);
  assert.strictEqual(scene.reader, scene.readers[0]);
  assert.deepEqual(scene.readers.map(({ headIndex }) => headIndex), [0, 1, 2]);
  scene.readers.map(({ phase }) => phase).forEach((phase, index) => {
    assertClose(phase, [0.9, 0.15, 0.65][index], `head ${index} loop phase`);
  });
  assert.equal(scene.contacts.length, 3);
  assert.equal(new Set(scene.contacts.map(({ voiceKey }) => voiceKey)).size, 3);
  assert.equal(new Set(scene.contacts.map(({ eventKey }) => eventKey)).size, 3);
  for (const contact of scene.contacts) {
    assert.match(contact.voiceKey, new RegExp(`:head:${contact.headIndex}:contact:`));
    assert.match(contact.eventKey, new RegExp(`:head:${contact.headIndex}$`));
    assert.ok(scene.readers[contact.headIndex].contacts.includes(contact));
  }
});

test("each 2D reader folds its own ping-pong travel and line axis", () => {
  const state = createShapesState({
    play: { continuousPhase: 1.2, motion: "pingpong" },
    dimension: {
      "2d": {
        reader: "line",
        heads: 3,
        headOffsets: [0, 0.4, 0.9],
        scanLineAxes: ["vertical", "horizontal", "vertical"],
      },
    },
  });
  const scene = buildShapesScene(state);
  scene.readers.map(({ phase }) => phase).forEach((phase, index) => {
    assertClose(phase, [0.8, 0.4, 0.1][index], `head ${index} ping-pong phase`);
  });
  assert.deepEqual(scene.readers.map(({ axis }) => axis), ["vertical", "horizontal", "vertical"]);
  assertClose(
    scene.readers[0].coordinate,
    scene.geometry.bounds.minX + scene.geometry.bounds.width * 0.8,
    "vertical line uses the x span",
  );
  assertClose(
    scene.readers[1].coordinate,
    scene.geometry.bounds.minY + scene.geometry.bounds.height * 0.4,
    "horizontal line uses the y span",
  );
  for (const reader of scene.readers) {
    assert.ok(reader.contacts.length > 0);
    assert.ok(reader.contacts.every((contact) => (
      contact.headIndex === reader.headIndex && contact.scanAxis === reader.axis
    )));
  }
});

test("multihead rhythm topology resets safely and offset seams emit only the crossing head", () => {
  const state = createShapesState({
    selection: { dimension: "2d", playingMode: "triggers" },
    play: { continuousPhase: 0.74, motion: "loop", divisions: 1 },
    profile: { sides: 1, kind: "circle", starDepth: 0.48 },
    dimension: { "2d": { heads: 2, headOffsets: [0, 0.25] } },
  });
  const before = createShapesRhythmSample(state);
  state.play.continuousPhase = 0.76;
  const crossed = advanceShapesRhythmSample(before, state);
  assert.deepEqual(crossed.event.enteredKeys, ["2d:contour:0:head:1"]);
  assertClose(crossed.event.time01, 0.5, "offset seam root time");

  const changedOffset = structuredClone(state);
  changedOffset.dimension["2d"].headOffsets[1] = 0.4;
  const reset = advanceShapesRhythmSample(crossed.sample, changedOffset);
  assert.equal(reset.event, null);
  assert.notEqual(reset.sample.topologyKey, crossed.sample.topologyKey);

  const changedDirection = structuredClone(state);
  toggleShapes2dHeadOption(changedDirection, 1, "points");
  assert.notEqual(
    createShapesRhythmSample(changedDirection).topologyKey,
    createShapesRhythmSample(state).topologyKey,
  );

  const pingPong = createShapesState({
    selection: { dimension: "2d", playingMode: "triggers" },
    play: { continuousPhase: 0.74, motion: "pingpong", divisions: 1 },
    profile: { sides: 5, kind: "polygon", starDepth: 0.48 },
    dimension: { "2d": { heads: 2, headOffsets: [0, 0.25] } },
  });
  let sample = createShapesRhythmSample(pingPong);
  pingPong.play.continuousPhase = 0.75;
  const atTurn = advanceShapesRhythmSample(sample, pingPong);
  assert.deepEqual(atTurn.event.enteredKeys, ["2d:side:4:segment:0:head:1"]);
  assert.equal(atTurn.event.time01, 1);
  sample = atTurn.sample;
  pingPong.play.continuousPhase = 0.76;
  assert.equal(
    advanceShapesRhythmSample(sample, pingPong).event,
    null,
    "an offset ping-pong turn emits once when the grid lands exactly on it",
  );
});
