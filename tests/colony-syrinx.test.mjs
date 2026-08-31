import assert from "node:assert/strict";
import test from "node:test";

import {
  COLONY_SYRINX_BANK_COUNT,
  COLONY_SYRINX_CONTOUR_IDS,
  COLONY_SYRINX_CONTOUR_POINT_COUNT,
  COLONY_SYRINX_CONTOUR_SHAPES,
  COLONY_SYRINX_CONTINUOUS_BREATH_FLOOR,
  COLONY_SYRINX_FOLD_COUNT,
  COLONY_SYRINX_LANE_COUNT,
  COLONY_SYRINX_LEGACY_LANE_COUNT,
  COLONY_SYRINX_LUNG_COUNT,
  COLONY_SYRINX_LUNGS_PER_BANK,
  COLONY_SYRINX_MAX_DELTA_SECONDS,
  COLONY_SYRINX_MEDIA,
  COLONY_SYRINX_MOUTH_COUNT,
  COLONY_SYRINX_PHONATOR_COUNT,
  COLONY_SYRINX_ROUTE_COUNT,
  COLONY_SYRINX_SEQUENCE_LENGTH,
  COLONY_SYRINX_TOPOLOGY,
  DEFAULT_COLONY_SYRINX_CONTOURS,
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
  evaluateColonySyrinxContours,
  evaluateColonySyrinxStep,
  randomizeColonySyrinxState,
  sampleColonySyrinxContour,
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
  assert.equal(COLONY_SYRINX_LANE_COUNT, 6);
  assert.equal(COLONY_SYRINX_LEGACY_LANE_COUNT, 3);
  assert.equal(COLONY_SYRINX_ROUTE_COUNT, 12);
  assert.equal(COLONY_SYRINX_SEQUENCE_LENGTH, 16);
  assert.equal(COLONY_SYRINX_TOPOLOGY.banks.length, 4);
  assert.equal(COLONY_SYRINX_TOPOLOGY.routes.length, 12);
  assert.equal(COLONY_SYRINX_TOPOLOGY.laneCount, 6);

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
    seed: "hostile colony",
    mediumId: "vacuum",
    breath: Infinity,
    breathRateBpm: -999,
    contourDurationSeconds: -999,
    pressureGain: NaN,
    crossCoupling: 99,
    colonyAmount: -99,
    stepsPerBeat: 999,
    midiBaseNote: 999,
    lungEnabled: [false, 0, 1, null],
    phonatorEnabled: [false, 1, null, "yes"],
    mouthEnabled: [0, "open", false],
    banks: [{ drive: -10, compliance: Infinity, leak: 8 }],
    phonators: [{ frequencyHz: -1, tension: 8, closure: -8, asymmetry: 8 }],
    routes: [[Infinity, -1, { aperture: 4 }], [false, true, { open: false }]],
    alternateRoutes: [[-4, Infinity, { open: true }]],
    mouths: [{ opening: -4, tongueSize: 5, resonanceHz: Infinity, pan: 9 }],
    contours: [{
      id: "breath",
      points: [Infinity, -1, 4],
      shape: "stairs",
      rate: 99,
      depth: -4,
      muted: 1,
    }],
    lanes: [{ length: 99, rate: -4, muted: 1, steps: [Infinity, -1, 4] }],
    sequence: [{ routeMask: 999_999, mouthGates: [-1, Infinity, 8], accent: 9 }],
  }, fallback);

  assert.equal(state.mediumId, "water");
  assert.equal(state.banks.length, 4);
  assert.equal(state.phonators.length, 4);
  assert.deepEqual(state.routes.map((row) => row.length), [3, 3, 3, 3]);
  assert.deepEqual(state.alternateRoutes.map((row) => row.length), [3, 3, 3, 3]);
  assert.equal(state.mouths.length, 3);
  assert.equal(state.lanes.length, COLONY_SYRINX_LEGACY_LANE_COUNT);
  assert.equal(state.contours.length, COLONY_SYRINX_LANE_COUNT);
  assert.equal(state.sequence.length, 16);
  assert.equal(state.lungEnabled.length, 16);
  assert.equal(state.phonatorEnabled.length, 4);
  assert.equal(state.mouthEnabled.length, 3);
  assert.deepEqual(state.lungEnabled.slice(0, 4), [false, false, true, true]);
  assert.deepEqual(state.phonatorEnabled, [false, true, true, true]);
  assert.deepEqual(state.mouthEnabled, [false, true, false]);
  assert.equal(state.contourDurationSeconds, 1);
  assert.ok(Number.isInteger(state.seed));
  assert.ok(state.seed >= 0 && state.seed <= 0xffff_ffff);
  assert.ok(state.routes.flat().every((value) => value >= 0 && value <= 1));
  assert.ok(state.alternateRoutes.flat().every((value) => value >= 0 && value <= 1));
  assert.deepEqual(state.contours.map(({ id }) => id), COLONY_SYRINX_CONTOUR_IDS);
  assert.ok(state.contours.every(({ points, shape, rate, depth }) => (
    points.length === COLONY_SYRINX_CONTOUR_POINT_COUNT
      && points.every((value) => value >= 0 && value <= 1)
      && COLONY_SYRINX_CONTOUR_SHAPES.includes(shape)
      && rate >= 0.125 && rate <= 8
      && depth >= 0 && depth <= 1
  )));
  assert.ok(state.lanes.every(({ length, rate, steps }) => (
    length >= 1 && length <= 16
      && rate >= 0.125 && rate <= 8
      && steps.length === 16
      && steps.every((velocity) => velocity >= 0 && velocity <= 1)
  )));
  assertFiniteTree(state, "state");
  assert.deepEqual(fallback, snapshot, "sanitization must not mutate its fallback");
});

test("six contour lanes replace the default attack grid with a continuously open field", () => {
  assert.equal(DEFAULT_COLONY_SYRINX_CONTOURS.length, 6);
  assert.deepEqual(
    DEFAULT_COLONY_SYRINX_CONTOURS.map(({ id }) => id),
    COLONY_SYRINX_CONTOUR_IDS,
  );
  assert.ok(DEFAULT_COLONY_SYRINX_CONTOURS.every(({ points, shape, rate, depth }) => (
    points.length === COLONY_SYRINX_CONTOUR_POINT_COUNT
      && points.every((value) => value > 0 && value <= 1)
      && COLONY_SYRINX_CONTOUR_SHAPES.includes(shape)
      && rate >= 0.125 && rate <= 8
      && depth >= 0 && depth <= 1
  )));

  // These are only a compatibility facade now: every legacy gate is open, so
  // old callers cannot accidentally restore the attack sequencer by default.
  assert.equal(DEFAULT_COLONY_SYRINX_LANES.length, COLONY_SYRINX_LEGACY_LANE_COUNT);
  assert.ok(DEFAULT_COLONY_SYRINX_LANES.every(({ length, steps }) => (
    length === COLONY_SYRINX_SEQUENCE_LENGTH
      && steps.length === COLONY_SYRINX_SEQUENCE_LENGTH
      && steps.every((velocity) => velocity === 1)
  )));
  for (let step = 0; step < COLONY_SYRINX_SEQUENCE_LENGTH; step += 1) {
    const legacy = evaluateColonySyrinxStep(DEFAULT_COLONY_SYRINX_STATE, step);
    assert.deepEqual(legacy.laneVelocities, [1, 1, 1]);
    assert.deepEqual(legacy.mouthGates, [1, 1, 1]);
    assert.ok(legacy.routeTargets.every((aperture) => aperture > 0));
    assert.equal(legacy.accent, 1);
  }
});

test("smooth, linear, and spline contour sampling stays continuous at every segment and loop seam", () => {
  const epsilon = 1e-8;
  const points = [
    0.08, 0.72, 0.22, 0.92, 0.34, 0.61, 0.13, 0.84,
    0.45, 0.76, 0.18, 0.68, 0.27, 0.96, 0.4, 0.58,
  ];
  for (const shape of COLONY_SYRINX_CONTOUR_SHAPES) {
    const lane = { points, shape };
    assert.equal(sampleColonySyrinxContour(lane, 0), sampleColonySyrinxContour(lane, 1));
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const boundary = pointIndex / points.length;
      const before = sampleColonySyrinxContour(lane, boundary - epsilon);
      const exact = sampleColonySyrinxContour(lane, boundary);
      const after = sampleColonySyrinxContour(lane, boundary + epsilon);
      assert.ok(Math.abs(before - exact) < 2e-6, `${shape} left seam ${pointIndex}`);
      assert.ok(Math.abs(after - exact) < 2e-6, `${shape} right seam ${pointIndex}`);
      assert.ok(Number.isFinite(before) && before >= 0 && before <= 1);
      assert.ok(Number.isFinite(after) && after >= 0 && after <= 1);
    }
  }
});

test("continuous evaluation crosses the master loop without an attack and morphs both route bodies", () => {
  const state = createColonySyrinxState({ contourDurationSeconds: 8 });
  const epsilon = 1e-6;
  const before = evaluateColonySyrinxContours(state, state.contourDurationSeconds - epsilon);
  const after = evaluateColonySyrinxContours(state, state.contourDurationSeconds + epsilon);
  assert.ok(Math.abs(before.contourPhase - 1) < 1e-5);
  assert.ok(after.contourPhase < 1e-5);
  for (let index = 0; index < COLONY_SYRINX_LANE_COUNT; index += 1) {
    assert.ok(Math.abs(before.contourValues[index] - after.contourValues[index]) < 2e-5);
  }
  assert.ok(Math.abs(before.continuousBreath - after.continuousBreath) < 2e-5);
  assert.ok(before.continuousBreath >= COLONY_SYRINX_CONTINUOUS_BREATH_FLOOR);
  assert.ok(after.continuousBreath >= COLONY_SYRINX_CONTINUOUS_BREATH_FLOOR);
  assert.equal(new Set(after.lanePhases.slice(3)).size, 3, "mouth phases stay separated");

  const flatRouting = (value) => state.contours.map((lane) => (
    lane.id === "routing" ? { ...lane, points: Array(16).fill(value), depth: 1 } : lane
  ));
  const primary = evaluateColonySyrinxContours({ ...state, contours: flatRouting(0) }, 0);
  const alternate = evaluateColonySyrinxContours({ ...state, contours: flatRouting(1) }, 0);
  primary.routes.flat().forEach((aperture, index) => {
    assert.ok(Math.abs(aperture - state.routes.flat()[index]) < 1e-12);
  });
  alternate.routes.flat().forEach((aperture, index) => {
    assert.ok(Math.abs(aperture - state.alternateRoutes.flat()[index]) < 1e-12);
  });
});

test("mouth contours can seal one exit without silencing every living outlet", () => {
  const contourPoints = (value) => Array(COLONY_SYRINX_CONTOUR_POINT_COUNT).fill(value);
  const state = createColonySyrinxState({
    mouthEnabled: [true, true, false],
    contours: DEFAULT_COLONY_SYRINX_CONTOURS.map((contour) => ({
      ...contour,
      depth: 1,
      rate: 1,
      points: contourPoints(contour.id === "maw" ? 0 : contour.id === "speech" ? 0.9 : 0.5),
    })),
  });
  const articulated = evaluateColonySyrinxContours(state, 0);
  assert.equal(articulated.mouthOpenings[0], 0);
  assert.ok(articulated.mouthOpenings[1] > 0.5);

  const allClosedState = {
    ...state,
    contours: state.contours.map((contour) => (
      ["maw", "speech"].includes(contour.id)
        ? { ...contour, points: contourPoints(0) }
        : contour
    )),
  };
  const closedTogether = evaluateColonySyrinxContours(allClosedState, 0);
  assert.equal(closedTogether.mouthOpenings[2], 0);
  assert.ok(Math.max(...closedTogether.mouthOpenings) >= 0.035);

  const explicitlyGated = evaluateColonySyrinxContours(
    allClosedState,
    0,
    { mouthGates: [0, 1, 0] },
  );
  assert.equal(explicitlyGated.mouthOpenings[0], 0);
  assert.equal(explicitlyGated.mouthOpenings[2], 0);

  const typedGates = new Float32Array([0, 0, 0]);
  assert.deepEqual(
    evaluateColonySyrinxContours(state, 0, { mouthGates: typedGates }).mouthOpenings,
    [0, 0, 0],
  );
  assert.deepEqual(
    evaluateColonySyrinxStep(state, 0, { mouthGates: typedGates }).mouthGates,
    [0, 0, 0],
  );
});

test("seeded randomization is deterministic, scoped, and always leaves a breathing connected body", () => {
  const base = createColonySyrinxState();
  const snapshot = structuredClone(base);
  for (const scope of ["anatomy", "plumbing", "motion", "all"]) {
    const first = randomizeColonySyrinxState(base, { scope, seed: "same-beast" });
    const second = randomizeColonySyrinxState(base, { scope, seed: "same-beast" });
    assert.deepEqual(first, second, `${scope} randomization must reproduce its seed`);
    assert.notDeepEqual(
      first,
      randomizeColonySyrinxState(base, { scope, seed: "different-beast" }),
      `${scope} must react to a different seed`,
    );
    assert.ok(first.breath >= COLONY_SYRINX_CONTINUOUS_BREATH_FLOOR);
    assert.ok(evaluateColonySyrinxContours(first, 99).continuousBreath > 0);
  }
  assert.deepEqual(base, snapshot, "randomization must not mutate its source");
});

test("sparse contour and route patches preserve every field they do not name", () => {
  const base = createColonySyrinxState({
    routes: [[0.91, 0.82, 0.73]],
    alternateRoutes: [[0.42, 0.88, 0.7]],
  });
  const patchedContour = sanitizeColonySyrinxState({
    contours: [{ id: "tension", depth: 0.123, rate: 7, points: [0.01] }],
  }, base);
  assert.deepEqual(patchedContour.contours[0], base.contours[0]);
  assert.equal(patchedContour.contours[1].depth, 0.123);
  assert.equal(patchedContour.contours[1].rate, 7);

  const patchedRoutes = sanitizeColonySyrinxState({ routes: [[0.01, 0.02, 0.03]] }, base);
  assert.deepEqual(patchedRoutes.routes[0], [0.01, 0.02, 0.03]);
  assert.deepEqual(patchedRoutes.alternateRoutes, base.alternateRoutes);
});

test("motion-only randomization never repairs or mutates closed plumbing", () => {
  const closed = createColonySyrinxState({
    routes: Array.from({ length: 4 }, () => [0, 0, 0]),
    alternateRoutes: Array.from({ length: 4 }, () => [0, 0, 0]),
  });
  const result = randomizeColonySyrinxState(closed, { scope: "motion", seed: 7 });
  assert.deepEqual(result.routes, closed.routes);
  assert.deepEqual(result.alternateRoutes, closed.alternateRoutes);
});

test("random anatomy varies active counts and every primary and alternate graph has no orphan organ", () => {
  const phonatorCounts = new Set();
  const mouthCounts = new Set();
  const lungCounts = new Set();
  for (let seed = 1; seed <= 32; seed += 1) {
    const state = randomizeColonySyrinxState(DEFAULT_COLONY_SYRINX_STATE, {
      scope: "all",
      seed,
    });
    const activePhonators = state.phonatorEnabled
      .map((enabled, index) => enabled ? index : -1)
      .filter((index) => index >= 0);
    const activeMouths = state.mouthEnabled
      .map((enabled, index) => enabled ? index : -1)
      .filter((index) => index >= 0);
    phonatorCounts.add(activePhonators.length);
    mouthCounts.add(activeMouths.length);
    lungCounts.add(state.lungEnabled.filter(Boolean).length);
    assert.ok(activePhonators.length >= 1 && activePhonators.length <= 4);
    assert.ok(activeMouths.length >= 1 && activeMouths.length <= 3);

    for (const phonatorIndex of activePhonators) {
      const start = phonatorIndex * COLONY_SYRINX_LUNGS_PER_BANK;
      assert.ok(state.lungEnabled.slice(start, start + 4).some(Boolean));
    }
    for (const matrix of [state.routes, state.alternateRoutes]) {
      for (let phonatorIndex = 0; phonatorIndex < 4; phonatorIndex += 1) {
        for (let mouthIndex = 0; mouthIndex < 3; mouthIndex += 1) {
          if (!state.phonatorEnabled[phonatorIndex] || !state.mouthEnabled[mouthIndex]) {
            assert.equal(matrix[phonatorIndex][mouthIndex], 0);
          }
        }
      }
      for (const phonatorIndex of activePhonators) {
        assert.ok(activeMouths.some((mouthIndex) => matrix[phonatorIndex][mouthIndex] > 0.04));
      }
      for (const mouthIndex of activeMouths) {
        assert.ok(activePhonators.some((phonatorIndex) => matrix[phonatorIndex][mouthIndex] > 0.04));
      }
    }
  }
  assert.ok(phonatorCounts.size > 1, "phonator count should vary across seeds");
  assert.ok(mouthCounts.size > 1, "mouth count should vary across seeds");
  assert.ok(lungCounts.size > 1, "lung count should vary across seeds");
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

test("legacy score evaluation remains available for explicit MIDI replacement", () => {
  const last = evaluateColonySyrinxStep(DEFAULT_COLONY_SYRINX_STATE, -1);
  assert.equal(last.index, 15);
  assert.deepEqual(last.laneStepIndices, [15, 15, 15]);

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
  const openRoutes = Array.from({ length: 4 }, () => [1, 1, 1]);
  const state = createColonySyrinxState({
    sequencerEnabled: false,
    colonyAmount: 0,
    routes: openRoutes,
    alternateRoutes: openRoutes,
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

test("pressure evolution is deterministic, finite, immutable, and exposes six continuous lanes", () => {
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
  assert.equal(first.laneStepIndices.length, COLONY_SYRINX_LEGACY_LANE_COUNT);
  assert.equal(first.laneVelocities.length, COLONY_SYRINX_LANE_COUNT);
  assert.equal(first.lanePhases.length, COLONY_SYRINX_LANE_COUNT);
  assert.equal(first.contourValues.length, COLONY_SYRINX_LANE_COUNT);
  assert.equal(first.phonatorTensions.length, COLONY_SYRINX_PHONATOR_COUNT);
  assert.ok(first.continuousBreath >= COLONY_SYRINX_CONTINUOUS_BREATH_FLOOR);
  assert.ok(first.contourPhase >= 0 && first.contourPhase < 1);
  assert.ok(first.meanPressure > 0);
  assert.ok(first.totalFlow > 0);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.routeFlows));
  assert.ok(Object.isFrozen(first.laneVelocities));
  assert.ok(Object.isFrozen(first.lanePhases));
  assert.ok(Object.isFrozen(first.contourValues));
  assert.ok(Object.isFrozen(first.phonatorTensions));

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

test("disabled phonators and mouths remain silent while fixed telemetry dimensions stay intact", () => {
  const state = createColonySyrinxState({
    phonatorEnabled: [false, true, false, false],
    mouthEnabled: [false, false, true],
    lungEnabled: Array.from({ length: 16 }, (_, index) => index >= 4 && index < 8),
    routes: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 0],
      [0, 0, 0],
    ],
  });
  const runtime = runModel(state, 480);
  assert.ok(runtime.reservoirPressures[1] > 0);
  assert.deepEqual(
    runtime.phonatorFrequenciesHz.map((frequency) => frequency > 0),
    [false, true, false, false],
  );
  assert.ok(runtime.foldFrequenciesHz.slice(0, 2).every((frequency) => frequency === 0));
  assert.ok(runtime.foldFrequenciesHz.slice(4).every((frequency) => frequency === 0));
  assert.deepEqual(runtime.mouthFlows.slice(0, 2), [0, 0]);
  assert.ok(runtime.mouthFlows[2] > 0);
  for (const { index, phonatorIndex, mouthIndex } of COLONY_SYRINX_TOPOLOGY.routes) {
    if (phonatorIndex !== 1 || mouthIndex !== 2) assert.equal(runtime.routeTargets[index], 0);
  }
});

test("closed plumbing stores pressure and opening the three mouths releases a burst", () => {
  const common = {
    sequencerEnabled: false,
    colonyAmount: 0,
    breath: 1,
    mouths: DEFAULT_COLONY_SYRINX_STATE.mouths.map((mouth) => ({ ...mouth, opening: 1 })),
  };
  const closedMatrix = Array.from({ length: 4 }, () => [0, 0, 0]);
  const openMatrix = Array.from({ length: 4 }, () => [1, 1, 1]);
  const closedRoutes = createColonySyrinxState({
    ...common,
    routes: closedMatrix,
    alternateRoutes: closedMatrix,
  });
  const openRoutes = createColonySyrinxState({
    ...common,
    routes: openMatrix,
    alternateRoutes: openMatrix,
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
    contourPhase: Infinity,
    continuousBreath: -9,
    tensionOffset: 9,
    stepIndex: -1,
    laneStepIndices: [99, -4, Infinity],
    lanePhases: [Infinity, -1],
    laneVelocities: [Infinity, -1],
    contourValues: new Float32Array([4, -3]),
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
  assert.equal(runtime.laneStepIndices.length, COLONY_SYRINX_LEGACY_LANE_COUNT);
  assert.equal(runtime.lanePhases.length, COLONY_SYRINX_LANE_COUNT);
  assert.equal(runtime.laneVelocities.length, COLONY_SYRINX_LANE_COUNT);
  assert.equal(runtime.contourValues.length, COLONY_SYRINX_LANE_COUNT);
  assert.equal(runtime.phonatorTensions.length, COLONY_SYRINX_PHONATOR_COUNT);
  assertFiniteTree(runtime, "sanitized runtime");
  assert.deepEqual(DEFAULT_COLONY_SYRINX_RUNTIME, sanitizeColonySyrinxRuntime());
});
