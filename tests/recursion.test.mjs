import assert from "node:assert/strict";
import test from "node:test";

import {
  RECURSION_STUDIES,
  buildRecursionPlan,
} from "../src/recursion.js";

const EXPECTED_IDS = [
  "ouroboros-tape",
  "spectral-mobius",
  "filter-hydra",
  "cantor-delay",
  "convolution-maw",
  "phase-labyrinth",
];

const approximately = (left, right, tolerance = 1e-6) => (
  Math.abs(left - right) <= tolerance
);

function assertValidPlan(plan) {
  assert.ok(Number.isFinite(plan.duration) && plan.duration > 0);
  assert.ok(plan.moments.length > 0);
  let previousAt = -Infinity;
  for (const moment of plan.moments) {
    assert.ok(Number.isFinite(moment.at) && moment.at >= previousAt);
    assert.ok(Number.isFinite(moment.duration) && moment.duration > 0);
    assert.ok(moment.at + moment.duration <= plan.duration + 1e-6);
    assert.equal(typeof moment.kind, "string");
    assert.ok(Number.isInteger(moment.depth) && moment.depth >= 0);
    assert.equal(typeof moment.label, "string");
    assert.ok(Array.isArray(moment.events) && moment.events.length > 0);
    for (const event of moment.events) {
      assert.equal(typeof event.synth, "string");
      assert.equal(event.source, plan.params.source);
      assert.ok(Number.isFinite(event.offset) && event.offset >= 0);
      assert.ok(Number.isFinite(event.duration) && event.duration > 0);
      assert.ok(event.offset + event.duration <= moment.duration + 1e-6);
      for (const melodicKey of ["frequency", "midi", "semitones", "pitch", "waveform"]) {
        assert.equal(
          Object.hasOwn(event, melodicKey),
          false,
          `${plan.studyId} must remain a non-melodic structural score`,
        );
      }
      if (Number.isFinite(event.gain)) {
        assert.ok(event.gain >= 0 && event.gain <= 0.5);
      }
    }
    previousAt = moment.at;
  }
}

test("metadata is exactly the six ranked non-melodic studies with UI definitions", () => {
  assert.deepEqual(RECURSION_STUDIES.map((study) => study.id), EXPECTED_IDS);
  assert.deepEqual(RECURSION_STUDIES.map((study) => study.rank), [1, 2, 3, 4, 5, 6]);
  for (const study of RECURSION_STUDIES) {
    assert.ok(study.title && study.shortTitle && study.description);
    for (const key of ["premise", "cue", "sequence", "recursion", "process", "listenFor"]) {
      assert.ok(study.copy[key], `${study.id} requires ${key} UI copy`);
    }
    for (const key of ["depth", "pace", "transform", "intensity"]) {
      const definition = study.parameters[key];
      assert.ok(definition.label);
      assert.ok(Number.isFinite(definition.min));
      assert.ok(Number.isFinite(definition.max));
      assert.ok(Number.isFinite(definition.default));
      assert.ok(definition.default >= definition.min && definition.default <= definition.max);
      assert.equal(typeof definition.format, "function");
      assert.equal(typeof definition.format(definition.default), "string");
    }
    assert.equal(study.transform, study.parameters.transform);
    assert.deepEqual(study.defaults, {
      depth: study.parameters.depth.default,
      pace: study.parameters.pace.default,
      transform: study.parameters.transform.default,
      intensity: study.parameters.intensity.default,
      source: "noise",
    });
    assert.deepEqual(study.sources.map((source) => source.id), ["noise", "impulse", "upload"]);
    assert.ok(study.sources.every((source) => source.label && source.description));
    assert.equal(study.limits.maxDepth, study.parameters.depth.max);
    assert.ok(
      study.limits.maxMoments > 0
      && study.limits.maxEvents > 0
      && study.limits.maxDuration > 0,
    );
  }
});

test("all default plans are deterministic, bounded, and structurally valid", () => {
  for (const study of RECURSION_STUDIES) {
    const first = buildRecursionPlan(study.id);
    const second = buildRecursionPlan(study.id);
    assert.deepEqual(first, second);
    assertValidPlan(first);
    assert.ok(first.moments.length <= study.limits.maxMoments);
    assert.ok(
      first.moments.reduce((total, moment) => total + moment.events.length, 0)
      <= study.limits.maxEvents,
    );
    assert.ok(first.duration <= study.limits.maxDuration);
    assert.ok(
      first.duration >= 35 && first.duration <= 55,
      `${study.id} default cycle should unfold slowly, received ${first.duration}s`,
    );
    assert.deepEqual(first.params, study.defaults);

    const maximum = buildRecursionPlan(study.id, {
      depth: study.parameters.depth.max,
      pace: study.parameters.pace.max,
      transform: study.parameters.transform.max,
      intensity: study.parameters.intensity.max,
      source: "upload",
    });
    assertValidPlan(maximum);
    assert.ok(maximum.moments.length <= study.limits.maxMoments);
    assert.ok(
      maximum.moments.reduce((total, moment) => total + moment.events.length, 0)
      <= study.limits.maxEvents,
    );
    assert.ok(maximum.duration <= study.limits.maxDuration);
  }
  assert.throws(() => buildRecursionPlan("not-a-study"), RangeError);
});

test("depth, pace, transform, intensity, and source are normalized", () => {
  const plan = buildRecursionPlan("cantor-delay", {
    depth: 999,
    pace: -4,
    transform: 99,
    intensity: -1,
    source: "uploaded:field-recording",
  });
  const metadata = RECURSION_STUDIES.find((study) => study.id === "cantor-delay");
  assert.equal(plan.params.depth, metadata.parameters.depth.max);
  assert.equal(plan.params.pace, metadata.parameters.pace.min);
  assert.equal(plan.params.transform, metadata.parameters.transform.max);
  assert.equal(plan.params.intensity, metadata.parameters.intensity.min);
  assert.equal(plan.params.source, "uploaded:field-recording");
  assert.ok(plan.moments.every((moment) => (
    moment.events.every((event) => event.source === "uploaded:field-recording")
  )));
});

test("Ouroboros uses each sequential buffer generation as the next input", () => {
  const depth = 5;
  const pace = 4;
  const plan = buildRecursionPlan("ouroboros-tape", {
    depth,
    pace,
    transform: 0.64,
    intensity: 0.7,
    source: "impulse",
  });
  assertValidPlan(plan);
  assert.equal(plan.moments.length, depth + 1);
  assert.deepEqual(plan.moments.map((moment) => moment.depth), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(
    plan.moments.map((moment) => moment.at),
    Array.from(
      { length: depth + 1 },
      (_, generation) => Number((generation * pace * 1.22).toFixed(6)),
    ),
  );
  for (let generation = 0; generation <= depth; generation += 1) {
    const event = plan.moments[generation].events[0];
    assert.equal(event.generation, generation);
    assert.equal(event.inputGeneration, generation ? generation - 1 : null);
    assert.equal(event.serialized, true);
    assert.equal(event.process.reverse, generation > 0 && generation % 2 === 1);
    assert.ok(event.process.tailFold >= 0 && event.process.tailFold <= 0.94);
    if (generation > 0) {
      assert.ok(event.process.lowpassHz <= plan.moments[generation - 1].events[0].process.lowpassHz);
      assert.ok(plan.moments[generation].at >= (
        plan.moments[generation - 1].at + plan.moments[generation - 1].duration
      ));
    }
  }
});

test("Spectral Möbius is a serial STFT fold with deterministic alternating phase", () => {
  const depth = 4;
  const plan = buildRecursionPlan("spectral-mobius", {
    depth,
    pace: 3.5,
    transform: 0.7,
    intensity: 0.8,
  });
  assertValidPlan(plan);
  assert.equal(plan.moments.length, depth + 1);
  for (let generation = 0; generation <= depth; generation += 1) {
    const event = plan.moments[generation].events[0];
    assert.deepEqual(event.analysis, { fftSize: 2048, hopSize: 512, window: "hann" });
    assert.equal(event.inputGeneration, generation ? generation - 1 : null);
    assert.equal(event.process.mirrorUpperBins, generation > 0);
    assert.equal(event.process.preserveMagnitude, true);
    assert.equal(event.process.overlapAdd, true);
    if (generation > 0) {
      assert.equal(
        Math.sign(event.process.phaseRotationTurns),
        generation % 2 === 0 ? 1 : -1,
      );
    }
  }
});

test("Filter Hydra produces sequential powers-of-two inherited filter generations", () => {
  const depth = 6;
  const intensity = 0.72;
  const plan = buildRecursionPlan("filter-hydra", {
    depth,
    pace: 3,
    transform: 0.3,
    intensity,
  });
  assertValidPlan(plan);
  assert.equal(plan.moments.length, depth + 1);
  assert.deepEqual(
    plan.moments.map((moment) => moment.events.length),
    [1, 2, 4, 8, 16, 32, 64],
  );
  for (let level = 0; level <= depth; level += 1) {
    const events = plan.moments[level].events;
    assert.ok(approximately(
      Math.sqrt(events.reduce((power, event) => power + event.gain ** 2, 0)),
      0.36 * intensity,
      1e-12,
    ));
    for (const event of events) {
      assert.equal(event.path.length, level);
      assert.equal(event.process.filters.length, level);
      assert.deepEqual(event.parentPath, event.path.slice(0, -1));
      assert.ok(event.process.filters.every((filter, index) => (
        filter.type === (event.path[index] === 0 ? "lowpass" : "highpass")
      )));
    }
    if (level > 0) {
      assert.ok(plan.moments[level].at >= (
        plan.moments[level - 1].at + plan.moments[level - 1].duration
      ));
    }
  }
});

test("Cantor Delay steps by generation while retaining 511 explicit contracting nodes", () => {
  const depth = 8;
  const pace = 3.2;
  const ratio = 1 / 3;
  const intensity = 0.7;
  const plan = buildRecursionPlan("cantor-delay", {
    depth,
    pace,
    transform: ratio,
    intensity,
  });
  assertValidPlan(plan);
  assert.equal(plan.moments.length, depth + 1);
  assert.deepEqual(
    plan.moments.map((moment) => moment.events.length),
    [1, 2, 4, 8, 16, 32, 64, 128, 256],
  );
  assert.equal(
    plan.moments.reduce((total, moment) => total + moment.events.length, 0),
    511,
  );

  const byPath = new Map(plan.moments.flatMap((moment) => (
    moment.events.map((event) => [event.path.join(""), event])
  )));
  for (const moment of plan.moments) {
    for (const node of moment.events) {
      if (!node.path.length) continue;
      const parent = byPath.get(node.path.slice(0, -1).join(""));
      const branch = node.path.at(-1);
      const expectedDelay = node.process.timeScale * ratio ** node.depth * (branch + 1);
      assert.ok(approximately(node.offset - parent.offset, expectedDelay, 3e-6));
      assert.ok(approximately(node.parentDelay, expectedDelay, 3e-6));
    }
  }

  for (let level = 0; level <= depth; level += 1) {
    const events = plan.moments[level].events;
    assert.equal(events.length, 2 ** level);
    assert.ok(approximately(
      Math.sqrt(events.reduce((power, event) => power + event.gain ** 2, 0)),
      0.38 * intensity,
      1e-12,
    ));
  }
});

test("Convolution Maw serially doubles convolution order while bounding the buffer", () => {
  const depth = 6;
  const plan = buildRecursionPlan("convolution-maw", {
    depth,
    pace: 3.5,
    transform: 0.76,
    intensity: 0.6,
  });
  assertValidPlan(plan);
  assert.equal(plan.moments.length, depth + 1);
  assert.deepEqual(
    plan.moments.map((moment) => moment.events[0].process.convolutionOrder),
    [1, 2, 4, 8, 16, 32, 64],
  );
  for (let generation = 0; generation <= depth; generation += 1) {
    const event = plan.moments[generation].events[0];
    assert.equal(event.inputGeneration, generation ? generation - 1 : null);
    assert.equal(event.process.operation, generation ? "self-convolution" : "identity");
    assert.equal(event.process.crop, "center-original-duration");
    assert.equal(event.process.normalize, "unit-rms");
    assert.equal(event.process.wet, generation ? 0.76 : 0);
    if (generation > 0) {
      assert.ok(plan.moments[generation].at >= (
        plan.moments[generation - 1].at + plan.moments[generation - 1].duration
      ));
    }
  }
});

test("Phase Labyrinth nests allpass stages and unwinds exact inverses", () => {
  const depth = 5;
  const pace = 2;
  const plan = buildRecursionPlan("phase-labyrinth", {
    depth,
    pace,
    transform: 19,
    intensity: 0.74,
  });
  assertValidPlan(plan);
  assert.equal(plan.moments.length, depth * 2 + 1);
  assert.deepEqual(
    plan.moments.map((moment) => moment.depth),
    [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0],
  );
  assert.deepEqual(
    plan.moments.map((moment) => moment.kind),
    ["seed", "enter", "enter", "enter", "enter", "center",
      "unwind", "unwind", "unwind", "unwind", "unwind"],
  );
  assert.deepEqual(
    plan.moments.map((moment) => moment.at),
    Array.from(
      { length: depth * 2 + 1 },
      (_, index) => Number((index * pace * 1.18).toFixed(6)),
    ),
  );

  const inwardStages = plan.moments
    .slice(1, depth + 1)
    .map((moment) => moment.events[0].process.stage);
  const removedStages = plan.moments
    .slice(depth + 1)
    .map((moment) => moment.events[0].process.stage);
  assert.deepEqual(removedStages, [...inwardStages].reverse());
  for (const moment of plan.moments) {
    const process = moment.events[0].process;
    assert.equal(process.chain.length, process.chainLength);
    assert.ok(process.chain.every((stage) => stage.feedback >= 0 && stage.feedback <= 0.92));
    assert.equal(process.inverse, moment.kind === "unwind");
  }
});
