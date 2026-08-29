import assert from "node:assert/strict";
import test from "node:test";

import {
  createShapesState,
  selectShapesPlayingMode,
  setShapesDivisionCount,
} from "../src/shapes-state.js";
import {
  advanceShapesRhythmSample,
  createShapesRhythmSample,
} from "../src/shapes-rhythm.js";

function rhythmState({
  phase,
  direction = 1,
  motion = "loop",
  divisions = 1,
  dimension = "2d",
} = {}) {
  const state = createShapesState({
    selection: { dimension, playingMode: "triggers" },
    play: { continuousPhase: phase, direction, motion, divisions },
  });
  selectShapesPlayingMode(state, "triggers");
  setShapesDivisionCount(state, divisions);
  state.dimension["2d"].reader = "points";
  return state;
}

function consume(states, groups = [states.length - 1]) {
  let sample = createShapesRhythmSample(states[0]);
  const events = [];
  let cursor = 1;
  for (const size of groups) {
    const end = Math.min(states.length, cursor + size);
    for (; cursor < end; cursor += 1) {
      const advanced = advanceShapesRhythmSample(sample, states[cursor]);
      sample = advanced.sample;
      if (advanced.event) events.push(advanced.event);
    }
  }
  assert.equal(cursor, states.length, "test grouping must consume every fixed sample");
  return events;
}

const eventKeys = (events) => events.map(({ enteredKeys }) => enteredKeys.join("+"));

test("adjacent fixed samples report exact forward and reverse square region entries", () => {
  const forward = consume([0.1, 0.3, 0.55, 0.8, 0.95].map((phase) => rhythmState({ phase })));
  assert.deepEqual(eventKeys(forward), [
    "2d:side:1:segment:0:head:0",
    "2d:side:2:segment:0:head:0",
    "2d:side:3:segment:0:head:0",
  ]);
  assert.ok(forward.every(({ time01 }) => time01 === 1));

  const reverse = consume([0.9, 0.7, 0.45, 0.2, 0.05]
    .map((phase) => rhythmState({ phase, direction: -1 })));
  assert.deepEqual(eventKeys(reverse), [
    "2d:side:2:segment:0:head:0",
    "2d:side:1:segment:0:head:0",
    "2d:side:0:segment:0:head:0",
  ]);
});

test("loop seams have exact fractional timing in both directions", () => {
  const forward = advanceShapesRhythmSample(
    createShapesRhythmSample(rhythmState({ phase: 0.99 })),
    rhythmState({ phase: 1.01 }),
  ).event;
  assert.deepEqual(forward.enteredKeys, ["2d:side:0:segment:0:head:0"]);
  assert.ok(Math.abs(forward.time01 - 0.5) < 1e-12);

  const reverse = advanceShapesRhythmSample(
    createShapesRhythmSample(rhythmState({ phase: 0.01, direction: -1 })),
    rhythmState({ phase: -0.01, direction: -1 }),
  ).event;
  assert.deepEqual(reverse.enteredKeys, ["2d:side:3:segment:0:head:0"]);
  assert.ok(Math.abs(reverse.time01 - 0.5) < 1e-12);
});

test("one-region circles re-enter once at a loop seam", () => {
  const before = rhythmState({ phase: 0.98 });
  before.profile.sides = 1;
  before.profile.kind = "circle";
  const after = structuredClone(before);
  after.play.continuousPhase = 1.02;
  const event = advanceShapesRhythmSample(createShapesRhythmSample(before), after).event;
  assert.deepEqual(event.enteredKeys, ["2d:contour:0:head:0"]);
  assert.ok(Math.abs(event.time01 - 0.5) < 1e-12);
});

test("a ping-pong turn emits once even when the grid lands exactly on it", () => {
  const states = [0.98, 1, 1.02].map((phase) => rhythmState({ phase, motion: "pingpong" }));
  const events = consume(states);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].enteredKeys, ["2d:side:3:segment:0:head:0"]);
  assert.equal(events[0].time01, 1);

  const straddled = consume([0.98, 1.02]
    .map((phase) => rhythmState({ phase, motion: "pingpong" })));
  assert.equal(straddled.length, 1);
  assert.ok(Math.abs(straddled[0].time01 - 0.5) < 1e-12);
});

test("topology changes reset the adjacent comparison and inputs remain immutable", () => {
  const previousState = rhythmState({ phase: 0.1 });
  const previousSample = createShapesRhythmSample(previousState);
  const currentState = rhythmState({ phase: 0.3 });
  currentState.profile.sides = 6;
  const beforeState = structuredClone(currentState);
  const beforeSample = {
    ...previousSample,
    regionKeys: [...previousSample.regionKeys],
    scene: structuredClone(previousSample.scene),
  };
  const advanced = advanceShapesRhythmSample(previousSample, currentState);
  assert.equal(advanced.event, null);
  assert.deepEqual(currentState, beforeState);
  assert.deepEqual(previousSample, beforeSample);
});

test("combined 3D phase and rotation is invariant across scheduler callback grouping", () => {
  const startPhase = 0.9972004555165768;
  const endPhase = 0.9649189056828618;
  const rotationStart = { x: -24, y: 36, z: 8 };
  const rotationTravel = {
    x: 7.3845112370,
    y: 8.2881813310,
    z: 9.7513566678,
  };
  const states = Array.from({ length: 65 }, (_, index) => {
    const amount = index / 64;
    const state = rhythmState({
      phase: startPhase + (endPhase - startPhase) * amount,
      direction: -1,
      motion: "pingpong",
      divisions: 16,
      dimension: "3d",
    });
    state.dimension["3d"].representation = "cube";
    for (const axis of ["x", "y", "z"]) {
      state.dimension["3d"].rotation[axis] = rotationStart[axis] + rotationTravel[axis] * amount;
    }
    return state;
  });

  const singleCallback = consume(states);
  const fourCallbacks = consume(states, [7, 19, 3, 35]);
  assert.deepEqual(eventKeys(singleCallback), [
    "3d:edge:2:segment:15+3d:edge:8:segment:12+3d:edge:9:segment:0",
    "3d:edge:8:segment:7",
    "3d:edge:8:segment:6",
    "3d:edge:8:segment:5",
  ]);
  assert.deepEqual(eventKeys(fourCallbacks), eventKeys(singleCallback));
  assert.deepEqual(
    fourCallbacks.map(({ time01 }) => time01),
    singleCallback.map(({ time01 }) => time01),
  );
});
