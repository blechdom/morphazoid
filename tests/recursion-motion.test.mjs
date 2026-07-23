import assert from "node:assert/strict";
import test from "node:test";

import {
  RECURSION_STUDIES,
  buildRecursionPlan,
} from "../src/recursion.js";

const DIMENSIONS = ["timbre", "pitch", "rhythm", "phrase"];
const COUPLINGS = [
  "timbreToPitch",
  "pitchToRhythm",
  "rhythmToPhrase",
  "phraseToTimbre",
];

const approximately = (left, right, tolerance = 1e-9) => (
  Math.abs(left - right) <= tolerance
);

function distinct(values, precision = 6) {
  return new Set(values.map((value) => Number(value).toFixed(precision))).size;
}

function assertMotionCaps(caps) {
  assert.ok(caps && typeof caps === "object");
  assert.ok(Number.isInteger(caps.maxPulsesPerMoment));
  assert.ok(caps.maxPulsesPerMoment >= 8 && caps.maxPulsesPerMoment <= 96);
  assert.ok(Number.isInteger(caps.maxPulsesPerPlan));
  assert.ok(caps.maxPulsesPerPlan >= caps.maxPulsesPerMoment);
  assert.ok(caps.maxPulsesPerPlan <= 768);
  assert.ok(caps.minPlaybackRate > 0);
  assert.ok(caps.maxPlaybackRate > caps.minPlaybackRate);
  assert.ok(caps.maxPlaybackRate <= 4);
  assert.ok(caps.maxAbsPitchSemitones >= 12);
  assert.ok(caps.maxAbsPitchSemitones <= 48);
  assert.ok(caps.minFilterHz >= 20);
  assert.ok(caps.maxFilterHz > caps.minFilterHz);
  assert.ok(caps.maxFilterHz <= 20_000);
  assert.ok(caps.maxDelaySeconds > 0 && caps.maxDelaySeconds <= 2);
}

function assertPulse(pulse, moment, caps) {
  for (const key of [
    "offset",
    "duration",
    "sourcePosition",
    "playbackRate",
    "pitchEnd",
    "filterHz",
    "q",
    "pan",
    "delay",
    "polarity",
    "phraseIndex",
  ]) {
    assert.ok(Number.isFinite(pulse[key]), `pulse.${key} must be finite`);
  }

  assert.ok(pulse.offset >= 0);
  assert.ok(pulse.duration > 0);
  assert.ok(pulse.offset + pulse.duration <= moment.duration + 1e-6);
  assert.ok(pulse.sourcePosition >= 0 && pulse.sourcePosition <= 1);
  assert.ok(pulse.playbackRate >= caps.minPlaybackRate - 1e-9);
  assert.ok(pulse.playbackRate <= caps.maxPlaybackRate + 1e-9);
  assert.ok(Math.abs(pulse.pitchEnd) <= caps.maxAbsPitchSemitones + 1e-9);
  assert.ok(pulse.filterHz >= caps.minFilterHz - 1e-9);
  assert.ok(pulse.filterHz <= caps.maxFilterHz + 1e-9);
  assert.ok(pulse.q > 0 && pulse.q <= 30);
  assert.ok(pulse.pan >= -1 && pulse.pan <= 1);
  assert.ok(pulse.delay >= 0 && pulse.delay <= caps.maxDelaySeconds + 1e-9);
  assert.ok(pulse.polarity === -1 || pulse.polarity === 1);
  assert.ok(Number.isInteger(pulse.phraseIndex) && pulse.phraseIndex >= 0);
}

function dimensionFingerprint(moment, dimension) {
  const pulses = moment.motion.pulses;
  if (dimension === "timbre") {
    return pulses
      .map((pulse) => `${pulse.filterHz.toFixed(1)}:${pulse.q.toFixed(2)}:${pulse.polarity}`)
      .join("|");
  }
  if (dimension === "pitch") {
    return pulses
      .map((pulse) => `${pulse.playbackRate.toFixed(3)}:${pulse.pitchEnd.toFixed(2)}`)
      .join("|");
  }
  if (dimension === "rhythm") {
    return pulses
      .map((pulse) => `${pulse.offset.toFixed(3)}:${pulse.duration.toFixed(3)}:${pulse.delay.toFixed(3)}`)
      .join("|");
  }
  return pulses
    .map((pulse) => `${pulse.phraseIndex}:${pulse.sourcePosition.toFixed(3)}`)
    .join("|");
}

test("recursive plans expose deterministic nested clocks and a closed dimensional feedback loop", () => {
  for (const study of RECURSION_STUDIES) {
    const plan = buildRecursionPlan(study.id);
    assert.deepEqual(plan, buildRecursionPlan(study.id));
    assertMotionCaps(plan.motionCaps);

    const clockSignatures = new Set();
    const couplingSignatures = new Set();
    for (const moment of plan.moments) {
      const motion = moment.motion;
      assert.ok(motion && typeof motion === "object", `${study.id} requires moment.motion`);
      assert.deepEqual(Object.keys(motion.clocks), DIMENSIONS);
      assert.deepEqual(Object.keys(motion.coupling), COUPLINGS);

      const periods = [];
      for (const dimension of DIMENSIONS) {
        const clock = motion.clocks[dimension];
        assert.ok(Number.isFinite(clock.period) && clock.period > 0);
        assert.ok(Number.isInteger(clock.cycles) && clock.cycles >= 1);
        assert.ok(Number.isFinite(clock.phase) && clock.phase >= 0 && clock.phase < 1);
        assert.ok(clock.direction === -1 || clock.direction === 1);
        periods.push(clock.period);
      }
      assert.ok(periods[0] < periods[1], "timbre must turn faster than pitch");
      assert.ok(periods[1] < periods[2], "pitch must turn faster than rhythm");
      assert.ok(periods[2] < periods[3], "rhythm must turn faster than phrase");

      for (const coupling of COUPLINGS) {
        const amount = motion.coupling[coupling];
        assert.ok(Number.isFinite(amount));
        assert.ok(amount >= -1 && amount <= 1);
        assert.ok(Math.abs(amount) >= 0.04, `${coupling} must audibly feed its target`);
      }
      clockSignatures.add(DIMENSIONS.map((name) => (
        `${motion.clocks[name].phase.toFixed(4)}:${motion.clocks[name].direction}`
      )).join("|"));
      couplingSignatures.add(COUPLINGS.map((name) => (
        motion.coupling[name].toFixed(4)
      )).join("|"));
    }

    assert.ok(clockSignatures.size >= Math.min(3, plan.moments.length));
    assert.ok(
      couplingSignatures.size >= Math.min(2, plan.moments.length),
      `${study.id} coupling must itself evolve through recursive time`,
    );
  }
});

test("transformed generations are busy pulse fields with audible motion in all four dimensions", () => {
  for (const study of RECURSION_STUDIES) {
    const plan = buildRecursionPlan(study.id);
    const transformed = plan.moments.filter((moment) => moment.kind !== "seed");
    assert.ok(transformed.length > 0);

    for (const moment of transformed) {
      const pulses = moment.motion.pulses;
      assert.ok(Array.isArray(pulses));
      assert.ok(
        pulses.length >= 8 && pulses.length <= plan.motionCaps.maxPulsesPerMoment,
        `${study.id}/${moment.label} should contain 8–${plan.motionCaps.maxPulsesPerMoment} pulses`,
      );
      for (const pulse of pulses) assertPulse(pulse, moment, plan.motionCaps);

      assert.ok(distinct(pulses.map((pulse) => pulse.offset)) >= 2);
      assert.ok(distinct(pulses.map((pulse) => pulse.playbackRate)) >= 2);
      assert.ok(distinct(pulses.map((pulse) => pulse.pitchEnd)) >= 2);
      assert.ok(distinct(pulses.map((pulse) => pulse.filterHz), 2) >= 2);
      assert.ok(
        distinct(pulses.map((pulse) => pulse.phraseIndex), 0) >= 2
        || distinct(pulses.map((pulse) => pulse.sourcePosition), 3) >= 3,
        "phrase motion must reorder or jump through the source",
      );

      const playbackRates = pulses.map((pulse) => pulse.playbackRate);
      const pitchEnds = pulses.map((pulse) => pulse.pitchEnd);
      const filterFrequencies = pulses.map((pulse) => pulse.filterHz);
      const offsets = pulses.map((pulse) => pulse.offset);
      assert.ok(Math.max(...playbackRates) / Math.min(...playbackRates) >= 1.08);
      assert.ok(Math.max(...pitchEnds) - Math.min(...pitchEnds) >= 1.5);
      assert.ok(Math.max(...filterFrequencies) / Math.min(...filterFrequencies) >= 1.25);
      assert.ok(
        Math.max(...offsets) - Math.min(...offsets)
        >= Math.min(0.12, moment.duration * 0.08),
      );
    }

    assert.ok(
      Math.max(...transformed.map((moment) => moment.motion.pulses.length)) >= 16,
      `${study.id} must grow beyond a sparse demonstration`,
    );

    for (const dimension of DIMENSIONS) {
      const fingerprints = new Set(
        transformed.map((moment) => dimensionFingerprint(moment, dimension)),
      );
      assert.ok(
        fingerprints.size >= Math.max(2, Math.ceil(transformed.length * 0.6)),
        `${study.id} needs substantial per-generation ${dimension} change`,
      );
    }
  }
});

test("Klein seam crossings turn clock time, channel handedness, and pulse polarity inside out", () => {
  for (const study of RECURSION_STUDIES) {
    const plan = buildRecursionPlan(study.id);
    const seamStates = new Set();
    for (const moment of plan.moments) {
      const { seam, clocks, pulses } = moment.motion;
      assert.equal(seam.topology, "klein");
      assert.ok(Number.isInteger(seam.crossings) && seam.crossings >= 0);
      const odd = seam.crossings % 2 === 1;
      assert.equal(seam.orientation, odd ? -1 : 1);
      assert.equal(seam.channelSwap, odd);
      assert.equal(seam.timeDirection, odd ? -1 : 1);
      assert.ok(
        DIMENSIONS.some((dimension) => clocks[dimension].direction === seam.timeDirection),
        "the topological time reversal must reach at least one nested clock",
      );
      assert.ok(pulses.some((pulse) => pulse.polarity === seam.orientation));
      seamStates.add(`${seam.orientation}:${seam.channelSwap}:${seam.timeDirection}`);
    }
    assert.deepEqual(
      [...seamStates].sort(),
      ["-1:true:-1", "1:false:1"],
      `${study.id} must visit both sides of the Klein identification`,
    );
  }
});

test("maximum-depth multidimensional recursion remains finite and inside declared DSP caps", () => {
  for (const study of RECURSION_STUDIES) {
    const plan = buildRecursionPlan(study.id, {
      depth: study.parameters.depth.max,
      pace: study.parameters.pace.min,
      transform: study.parameters.transform.max,
      intensity: study.parameters.intensity.max,
    });
    assertMotionCaps(plan.motionCaps);
    const pulses = plan.moments.flatMap((moment) => moment.motion.pulses);
    assert.ok(pulses.length > 0);
    assert.ok(pulses.length <= plan.motionCaps.maxPulsesPerPlan);
    assert.ok(plan.moments.every((moment) => (
      moment.motion.pulses.length <= plan.motionCaps.maxPulsesPerMoment
    )));
    for (const moment of plan.moments) {
      for (const pulse of moment.motion.pulses) {
        assertPulse(pulse, moment, plan.motionCaps);
      }
    }

    const first = plan.moments[0].motion.pulses[0];
    const repeated = buildRecursionPlan(study.id, {
      depth: study.parameters.depth.max,
      pace: study.parameters.pace.min,
      transform: study.parameters.transform.max,
      intensity: study.parameters.intensity.max,
    }).moments[0].motion.pulses[0];
    assert.ok(approximately(first.offset, repeated.offset));
    assert.ok(approximately(first.playbackRate, repeated.playbackRate));
    assert.ok(approximately(first.filterHz, repeated.filterHz));
  }
});
