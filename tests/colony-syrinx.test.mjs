import assert from "node:assert/strict";
import test from "node:test";

import {
  COLONY_SYRINX_BANK_COUNT,
  COLONY_SYRINX_FOLD_COUNT,
  COLONY_SYRINX_LANE_COUNT,
  COLONY_SYRINX_LUNG_COUNT,
  COLONY_SYRINX_LUNGS_PER_BANK,
  COLONY_SYRINX_MAX_DELTA_SECONDS,
  COLONY_SYRINX_MEDIA,
  COLONY_SYRINX_MOUTH_COUNT,
  COLONY_SYRINX_PHONATOR_COUNT,
  COLONY_SYRINX_ROUTE_COUNT,
  COLONY_SYRINX_SEQUENCE_LENGTH,
  COLONY_SYRINX_TOPOLOGY,
  DEFAULT_COLONY_SYRINX_LANES,
  DEFAULT_COLONY_SYRINX_RUNTIME,
  DEFAULT_COLONY_SYRINX_STATE,
  colonySyrinxLaneStepDurationSeconds,
  colonySyrinxMidiNoteForRoute,
  colonySyrinxRouteCoordinates,
  colonySyrinxRouteFromMidiNote,
  colonySyrinxRouteIndex,
  colonySyrinxStepDurationSeconds,
  createColonySyrinxRuntime,
  createColonySyrinxState,
  evaluateColonySyrinxStep,
  sanitizeColonySyrinxRuntime,
  sanitizeColonySyrinxState,
  setColonySyrinxRoute,
  stepColonySyrinx,
} from "../src/colony-syrinx.js";

function assertFiniteTree(value, label = "value") {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${label} must be finite`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) assertFiniteTree(child, `${label}.${key}`);
}

function runModel(configuration, frames = 480, deltaSeconds = 1 / 120) {
  let runtime = createColonySyrinxRuntime();
  for (let frame = 0; frame < frames; frame += 1) {
    runtime = stepColonySyrinx(runtime, configuration, deltaSeconds);
  }
  return runtime;
}

test("Colony Syrinx topology is exactly sixteen lungs, eight folds, twelve routes, and three mouths", () => {
  assert.equal(COLONY_SYRINX_LUNG_COUNT, 16);
  assert.equal(COLONY_SYRINX_BANK_COUNT, 4);
  assert.equal(COLONY_SYRINX_LUNGS_PER_BANK, 4);
  assert.equal(COLONY_SYRINX_PHONATOR_COUNT, 4);
  assert.equal(COLONY_SYRINX_FOLD_COUNT, 8);
  assert.equal(COLONY_SYRINX_MOUTH_COUNT, 3);
  assert.equal(COLONY_SYRINX_LANE_COUNT, 3);
  assert.equal(COLONY_SYRINX_ROUTE_COUNT, 12);
  assert.equal(COLONY_SYRINX_SEQUENCE_LENGTH, 16);
  assert.equal(COLONY_SYRINX_TOPOLOGY.banks.length, 4);
  assert.equal(COLONY_SYRINX_TOPOLOGY.routes.length, 12);

  const lungIndices = COLONY_SYRINX_TOPOLOGY.banks.flatMap(({ lungIndices }) => lungIndices);
  const foldIndices = COLONY_SYRINX_TOPOLOGY.banks.flatMap(({ foldIndices }) => foldIndices);
  assert.deepEqual(lungIndices, Array.from({ length: 16 }, (_, index) => index));
  assert.deepEqual(foldIndices, Array.from({ length: 8 }, (_, index) => index));
  assert.deepEqual(
    COLONY_SYRINX_TOPOLOGY.routes.map(({ phonatorIndex, mouthIndex }) => [phonatorIndex, mouthIndex]),
    Array.from({ length: 12 }, (_, index) => [Math.floor(index / 3), index % 3]),
  );
});

test("defaults and hostile input sanitize into a complete fixed-size state without mutation", () => {
  assert.deepEqual(sanitizeColonySyrinxState(), DEFAULT_COLONY_SYRINX_STATE);
  const fallback = createColonySyrinxState({ mediumId: "water", breath: 0.42 });
  const snapshot = structuredClone(fallback);
  const state = sanitizeColonySyrinxState({
    mediumId: "vacuum",
    breath: Infinity,
    breathRateBpm: -999,
    pressureGain: NaN,
    crossCoupling: 99,
    colonyAmount: -99,
    stepsPerBeat: 999,
    midiBaseNote: 999,
    lungEnabled: [false, 0, 1, null],
    banks: [{ drive: -10, compliance: Infinity, leak: 8 }],
    phonators: [{ frequencyHz: -1, tension: 8, closure: -8, asymmetry: 8 }],
    routes: [[Infinity, -1, { aperture: 4 }], [false, true, { open: false }]],
    mouths: [{ opening: -4, tongueSize: 5, resonanceHz: Infinity, pan: 9 }],
    lanes: [{ length: 99, rate: -4, muted: 1, steps: [Infinity, -1, 4] }],
    sequence: [{ routeMask: 999_999, mouthGates: [-1, Infinity, 8], accent: 9 }],
  }, fallback);

  assert.equal(state.mediumId, "water");
  assert.equal(state.banks.length, 4);
  assert.equal(state.phonators.length, 4);
  assert.deepEqual(state.routes.map((row) => row.length), [3, 3, 3, 3]);
  assert.equal(state.mouths.length, 3);
  assert.equal(state.lanes.length, 3);
  assert.equal(state.sequence.length, 16);
  assert.equal(state.lungEnabled.length, 16);
  assert.deepEqual(state.lungEnabled.slice(0, 4), [false, false, true, true]);
  assert.ok(state.routes.flat().every((value) => value >= 0 && value <= 1));
  assert.ok(state.lanes.every(({ length, rate, steps }) => (
    length >= 1 && length <= 16
      && rate >= 0.125 && rate <= 8
      && steps.length === 16
      && steps.every((velocity) => velocity >= 0 && velocity <= 1)
  )));
  assertFiniteTree(state, "state");
  assert.deepEqual(fallback, snapshot, "sanitization must not mutate its fallback");
});

test("the three mouth lanes are independently polymetric and expose sixteen velocities", () => {
  assert.deepEqual(
    DEFAULT_COLONY_SYRINX_LANES.map(({ length, rate }) => [length, rate]),
    [[13, 1], [11, 1.5], [7, 2]],
  );
  assert.ok(DEFAULT_COLONY_SYRINX_LANES.every(({ steps }) => steps.length === 16));
  assert.equal(new Set(DEFAULT_COLONY_SYRINX_LANES.map(({ steps }) => steps.join(","))).size, 3);

  const atTen = evaluateColonySyrinxStep(DEFAULT_COLONY_SYRINX_STATE, 10);
  assert.deepEqual(atTen.laneStepIndices, [10, 4, 6]);
  assert.deepEqual(atTen.laneVelocities, [0, 0, 0.7]);
  assert.deepEqual(atTen.mouthGates, atTen.laneVelocities);

  const forced = evaluateColonySyrinxStep(DEFAULT_COLONY_SYRINX_STATE, 0, {
    laneStepIndices: [4, 6, 2],
  });
  assert.deepEqual(forced.laneStepIndices, [4, 6, 2]);
  assert.deepEqual(forced.laneVelocities, [0.82, 0.72, 0.7]);

  const muted = createColonySyrinxState({
    lanes: DEFAULT_COLONY_SYRINX_LANES.map((lane, index) => ({ ...lane, muted: index === 1 })),
  });
  assert.equal(evaluateColonySyrinxStep(muted, 0).mouthGates[1], 0);

  const clockState = createColonySyrinxState({ tempoBpm: 120, stepsPerBeat: 4, swing: 0 });
  const afterOneSecond = runModel(clockState, 120, 1 / 120);
  assert.equal(afterOneSecond.stepIndex, 8);
  assert.deepEqual(afterOneSecond.laneStepIndices, [8, 1, 2]);
  assert.deepEqual(afterOneSecond.laneStepElapsedSeconds, [0, 0, 0]);
});

test("route coordinates and chromatic MIDI notes round-trip across the 4x3 valve matrix", () => {
  for (let phonatorIndex = 0; phonatorIndex < 4; phonatorIndex += 1) {
    for (let mouthIndex = 0; mouthIndex < 3; mouthIndex += 1) {
      const routeIndex = colonySyrinxRouteIndex(phonatorIndex, mouthIndex);
      const note = colonySyrinxMidiNoteForRoute(phonatorIndex, mouthIndex, 48);
      assert.deepEqual(colonySyrinxRouteCoordinates(routeIndex), {
        routeIndex,
        phonatorIndex,
        mouthIndex,
      });
      assert.deepEqual(colonySyrinxRouteFromMidiNote(note, 48), {
        routeIndex,
        phonatorIndex,
        mouthIndex,
        note,
      });
    }
  }
  assert.equal(colonySyrinxRouteIndex(4, 0), -1);
  assert.equal(colonySyrinxRouteCoordinates(12), null);
  assert.equal(colonySyrinxRouteFromMidiNote(47, 48), null);

  const before = createColonySyrinxState();
  const snapshot = structuredClone(before);
  const changed = setColonySyrinxRoute(before, 2, 1, 0.123);
  assert.equal(changed.routes[2][1], 0.123);
  assert.deepEqual(before, snapshot, "route editing must be immutable");
});

test("sequencer evaluation combines score gates, lane velocity, and direct MIDI replacement", () => {
  const last = evaluateColonySyrinxStep(DEFAULT_COLONY_SYRINX_STATE, -1);
  assert.equal(last.index, 15);
  assert.deepEqual(last.laneStepIndices, [2, 0, 2]);

  const state = createColonySyrinxState({ sequencerEnabled: false, midiMode: "replace" });
  const note = state.midiBaseNote + 5;
  const evaluation = evaluateColonySyrinxStep(state, 7, {
    activeMidiNotes: [{ note, velocity: 64 }],
  });
  assert.deepEqual(evaluation.activeRouteIndices, [5]);
  assert.ok(Math.abs(evaluation.routeTargets[5] - state.routes[1][2] * 64 / 127) < 1e-12);
  assert.deepEqual(evaluation.mouthGates, [1, 1, 1]);
  assert.equal(evaluation.routes[5].midiNote, note);

  const silenced = evaluateColonySyrinxStep(state, 7, { activeMidiNotes: [] });
  assert.ok(silenced.routeTargets.every((aperture) => aperture === 0));
});

test("bank exhale gates release each four-lung source without changing legacy callers", () => {
  const state = createColonySyrinxState({
    sequencerEnabled: false,
    colonyAmount: 0,
    routes: Array.from({ length: 4 }, () => [1, 1, 1]),
  });
  const initial = createColonySyrinxRuntime();
  const firstBankOnly = stepColonySyrinx(initial, state, 0, {
    bankExhaleGates: [1, 0, 0, 0],
  });
  assert.deepEqual(firstBankOnly.routeTargets.slice(0, 3), [1, 1, 1]);
  assert.deepEqual(firstBankOnly.routeTargets.slice(3), Array(9).fill(0));

  const ungated = stepColonySyrinx(initial, state, 0);
  assert.deepEqual(ungated.routeTargets, Array(12).fill(1));

  const partial = stepColonySyrinx(initial, state, 0, { bankExhaleGates: [0] });
  assert.deepEqual(partial.routeTargets.slice(0, 3), [0, 0, 0]);
  assert.deepEqual(partial.routeTargets.slice(3), Array(9).fill(1));
});

test("global swing and lane rates produce bounded pair-preserving durations", () => {
  const state = createColonySyrinxState({ tempoBpm: 120, stepsPerBeat: 4, swing: 0.25 });
  const straightPairSeconds = 2 * (60 / 120 / 4);
  assert.equal(
    colonySyrinxStepDurationSeconds(state, 0) + colonySyrinxStepDurationSeconds(state, 1),
    straightPairSeconds,
  );
  for (let laneIndex = 0; laneIndex < 3; laneIndex += 1) {
    const lane = state.lanes[laneIndex];
    const pair = colonySyrinxLaneStepDurationSeconds(state, laneIndex, 0)
      + colonySyrinxLaneStepDurationSeconds(state, laneIndex, 1);
    assert.ok(Math.abs(pair - straightPairSeconds / lane.rate) < 1e-12);
  }
});

test("pressure evolution is deterministic, finite, immutable, and independently clocks all lanes", () => {
  const state = createColonySyrinxState();
  const first = runModel(state, 360);
  const second = runModel(state, 360);
  assert.deepEqual(first, second);
  assertFiniteTree(first, "runtime");
  assert.equal(first.lungPressures.length, 16);
  assert.equal(first.reservoirPressures.length, 4);
  assert.equal(first.routeApertures.length, 12);
  assert.equal(first.mouthPressures.length, 3);
  assert.equal(first.phonatorFrequenciesHz.length, 4);
  assert.equal(first.foldFrequenciesHz.length, 8);
  assert.equal(first.laneStepIndices.length, 3);
  assert.equal(first.laneVelocities.length, 3);
  assert.ok(first.meanPressure > 0);
  assert.ok(first.totalFlow > 0);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.routeFlows));
  assert.notDeepEqual(first.laneStepIndices, [first.stepIndex, first.stepIndex, first.stepIndex]);

  const bounded = stepColonySyrinx(first, state, 99);
  assert.ok(Math.abs(bounded.timeSeconds - first.timeSeconds - COLONY_SYRINX_MAX_DELTA_SECONDS) < 1e-9);
  assert.deepEqual(first, second, "stepping from a runtime must not mutate it");
});

test("individual lung toggles remove their bank supply while preserving fixed telemetry", () => {
  const active = createColonySyrinxState({
    sequencerEnabled: false,
    colonyAmount: 0,
    routes: Array.from({ length: 4 }, () => [0, 0, 0]),
  });
  const firstBankOff = createColonySyrinxState({
    ...active,
    lungEnabled: Array.from({ length: 16 }, (_, index) => index >= 4),
  });
  const allOff = createColonySyrinxState({ ...active, lungEnabled: Array(16).fill(false) });
  const activeRuntime = runModel(active, 480);
  const firstBankOffRuntime = runModel(firstBankOff, 480);
  const allOffRuntime = runModel(allOff, 480);

  assert.ok(activeRuntime.reservoirPressures[0] > firstBankOffRuntime.reservoirPressures[0]);
  assert.ok(firstBankOffRuntime.lungPressures.slice(0, 4).every((pressure) => pressure === 0));
  assert.ok(allOffRuntime.lungPressures.every((pressure) => pressure === 0));
  assert.ok(allOffRuntime.reservoirPressures.every((pressure) => pressure === 0));
  assert.equal(allOffRuntime.totalFlow, 0);
});

test("closed plumbing stores pressure and opening the three mouths releases a burst", () => {
  const common = {
    sequencerEnabled: false,
    colonyAmount: 0,
    breath: 1,
    mouths: DEFAULT_COLONY_SYRINX_STATE.mouths.map((mouth) => ({ ...mouth, opening: 1 })),
  };
  const closedRoutes = createColonySyrinxState({
    ...common,
    routes: Array.from({ length: 4 }, () => [0, 0, 0]),
  });
  const openRoutes = createColonySyrinxState({
    ...common,
    routes: Array.from({ length: 4 }, () => [1, 1, 1]),
  });
  const closed = runModel(closedRoutes, 600);
  const open = runModel(openRoutes, 600);
  assert.ok(closed.meanPressure > open.meanPressure);
  assert.equal(closed.totalFlow, 0);
  assert.ok(open.totalFlow > 0.2);

  const sealedMouths = createColonySyrinxState({
    ...openRoutes,
    mouths: openRoutes.mouths.map((mouth) => ({ ...mouth, opening: 0, leak: 0 })),
  });
  let stored = runModel(sealedMouths, 600);
  assert.ok(stored.mouthPressures.every((pressure) => pressure > 0.3));
  assert.equal(stored.totalFlow, 0);
  const released = createColonySyrinxState({
    ...sealedMouths,
    mouths: sealedMouths.mouths.map((mouth) => ({ ...mouth, opening: 1, slewMs: 2 })),
  });
  stored = stepColonySyrinx(stored, released, 1 / 60);
  assert.ok(stored.totalFlow > 1);
  assert.ok(stored.impact > 0);
});

test("air, water, and pellets remain stable while exposing distinct loading and granular jams", () => {
  const results = Object.keys(COLONY_SYRINX_MEDIA).map((mediumId) => runModel(createColonySyrinxState({
    mediumId,
    sequencerEnabled: false,
    colonyAmount: 0,
    breath: 1,
    routes: Array.from({ length: 4 }, () => [0.5, 0.5, 0.5]),
    mouths: DEFAULT_COLONY_SYRINX_STATE.mouths.map((mouth) => ({ ...mouth, opening: 0.8 })),
  }), 720));

  for (const runtime of results) assertFiniteTree(runtime, "medium runtime");
  const [air, water, pellets] = results;
  assert.ok(air.totalFlow > water.totalFlow);
  assert.ok(water.totalFlow > pellets.totalFlow);
  assert.equal(air.granularActivity, 0);
  assert.equal(water.granularActivity, 0);
  assert.ok(pellets.granularActivity > 0);
  assert.ok(pellets.routeJams.some((jam) => jam > 0));
});

test("runtime sanitation repairs hostile vectors to exact control-rate dimensions", () => {
  const runtime = sanitizeColonySyrinxRuntime({
    timeSeconds: Infinity,
    stepIndex: -1,
    laneStepIndices: [99, -4, Infinity],
    lungPressures: [Infinity, -4, 2],
    routeApertures: new Float32Array([2, -1, 0.5]),
    mouthPressures: [NaN, 99],
    foldFrequenciesHz: [Infinity],
  });
  assert.equal(runtime.stepIndex, 15);
  assert.equal(runtime.lungPressures.length, 16);
  assert.equal(runtime.routeApertures.length, 12);
  assert.equal(runtime.mouthPressures.length, 3);
  assert.equal(runtime.foldFrequenciesHz.length, 8);
  assert.equal(runtime.laneStepIndices.length, 3);
  assertFiniteTree(runtime, "sanitized runtime");
  assert.deepEqual(DEFAULT_COLONY_SYRINX_RUNTIME, sanitizeColonySyrinxRuntime());
});
