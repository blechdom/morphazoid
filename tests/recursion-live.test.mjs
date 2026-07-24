import assert from "node:assert/strict";
import test from "node:test";

import {
  RECURSION_STUDIES,
  buildRecursionPlan,
} from "../src/recursion.js";
import {
  LIVE_AXIS_IDS,
  LIVE_DEFAULTS,
  ancestorGain,
  denseMomentFor,
  fuzzyDspFor,
  morphMoment,
  normalizeLiveAxes,
  sessionToneFor,
  voiceMixFor,
} from "../src/recursion-live.js";
import { MOTION_CAPS } from "../src/recursion-motion.js";

const EPSILON = 1e-6;
const PUBLIC_INSTRUMENT_ID = "ouroboros-tape";

function average(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function finiteNumbers(value, path = "value", seen = new WeakSet()) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (ArrayBuffer.isView(value)) {
    for (let index = 0; index < value.length; index += 1) {
      finiteNumbers(value[index], `${path}[${index}]`, seen);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    finiteNumbers(child, `${path}.${key}`, seen);
  }
}

function logarithmicPosition(value, minimum, maximum) {
  return Math.log(Math.max(minimum, value) / minimum)
    / Math.log(maximum / minimum);
}

function eventFilters(moment) {
  return moment.events.flatMap((event) => event.process?.filters ?? []);
}

function axisProjection(axis, moment) {
  const pulses = moment.motion?.pulses ?? [];
  const events = moment.events ?? [];
  if (axis === "timbre") {
    return [
      ...pulses.flatMap((pulse) => [
        logarithmicPosition(
          pulse.filterHz,
          MOTION_CAPS.minFilterHz,
          MOTION_CAPS.maxFilterHz,
        ),
        pulse.q / 14,
      ]),
      ...eventFilters(moment).flatMap((filter) => [
        logarithmicPosition(filter.cutoffHz, 24, 18_000),
        filter.q / 12,
      ]),
    ];
  }
  if (axis === "pitch") {
    return pulses.flatMap((pulse) => [
      logarithmicPosition(
        pulse.playbackRate,
        MOTION_CAPS.minPlaybackRate,
        MOTION_CAPS.maxPlaybackRate,
      ),
      (pulse.pitchEnd + MOTION_CAPS.maxAbsPitchSemitones)
        / (MOTION_CAPS.maxAbsPitchSemitones * 2),
    ]);
  }
  if (axis === "rhythm") {
    return [
      pulses.length / MOTION_CAPS.maxPulsesPerMoment,
      ...pulses.flatMap((pulse) => [
        pulse.offset / Math.max(0.08, moment.duration * 0.84),
        pulse.duration / 1.5,
        pulse.delay / MOTION_CAPS.maxDelaySeconds,
      ]),
      ...events.flatMap((event) => [
        (event.offset ?? 0) / Math.max(0.08, moment.duration),
        (event.duration ?? 0) / 8,
      ]),
    ];
  }
  if (axis === "phrase") {
    return [
      ...pulses.flatMap((pulse) => [
        pulse.sourcePosition,
        (pulse.pan + 1) / 2,
        (pulse.routeIndex ?? 0) / 65_536,
      ]),
      ...events.map((event) => ((event.pan ?? 0) + 1) / 2),
    ];
  }
  if (axis === "twist") {
    return pulses.flatMap((pulse) => [
      pulse.timeDirection < 0 ? 0 : 1,
      pulse.polarity < 0 ? 0 : 1,
      pulse.channelSwap ? 1 : 0,
      (pulse.routeIndex ?? 0) / 65_536,
      pulse.q / 14,
      (pulse.generation ?? 0) / Math.max(1, moment.depth),
    ]);
  }
  return [
    ...pulses.flatMap((pulse) => [
      pulse.duration / 1.5,
      pulse.delay / MOTION_CAPS.maxDelaySeconds,
    ]),
    ...events.flatMap((event) => [
      (event.duration ?? 0) / 8,
      Number(event.gain) || 0,
    ]),
  ];
}

function materialDifference(first, second) {
  const maximumLength = Math.max(1, first.length, second.length);
  const lengthDifference = Math.abs(first.length - second.length) / maximumLength;
  const sharedLength = Math.min(first.length, second.length);
  const deltas = Array.from(
    { length: sharedLength },
    (_, index) => Math.abs(first[index] - second[index]),
  );
  const valueDifference = average(deltas);
  const changedPopulation = sharedLength
    ? deltas.filter((difference) => difference >= 0.0001).length / sharedLength
    : 0;
  return Math.max(
    lengthDifference,
    valueDifference,
    changedPopulation * 0.3,
  );
}

function assertBoundedPulse(pulse, moment, label) {
  finiteNumbers(pulse, label);
  assert.ok(pulse.offset >= 0, `${label}.offset must be non-negative`);
  assert.ok(
    pulse.offset <= Math.max(0.08, moment.duration * 0.84) + EPSILON,
    `${label}.offset must remain inside the live phrase span`,
  );
  assert.ok(pulse.duration >= 0.02 && pulse.duration <= 1.5 + EPSILON);
  assert.ok(pulse.sourcePosition >= 0 && pulse.sourcePosition <= 1);
  assert.ok(pulse.playbackRate >= MOTION_CAPS.minPlaybackRate - EPSILON);
  assert.ok(pulse.playbackRate <= MOTION_CAPS.maxPlaybackRate + EPSILON);
  assert.ok(
    Math.abs(pulse.pitchEnd) <= MOTION_CAPS.maxAbsPitchSemitones + EPSILON,
  );
  assert.ok(pulse.filterHz >= MOTION_CAPS.minFilterHz - EPSILON);
  assert.ok(pulse.filterHz <= MOTION_CAPS.maxFilterHz + EPSILON);
  assert.ok(pulse.q >= 0.2 && pulse.q <= 14 + EPSILON);
  assert.ok(pulse.pan >= -1 && pulse.pan <= 1);
  assert.ok(pulse.delay >= 0 && pulse.delay <= MOTION_CAPS.maxDelaySeconds + EPSILON);
  assert.ok(pulse.polarity === -1 || pulse.polarity === 1);
  assert.ok(pulse.timeDirection === -1 || pulse.timeDirection === 1);
  assert.equal(typeof pulse.channelSwap, "boolean");
}

test("Fuzzy Donut starts at its deepest, busy recursive state", () => {
  assert.equal(RECURSION_STUDIES.length, 1);
  assert.equal(RECURSION_STUDIES[0].id, PUBLIC_INSTRUMENT_ID);
  assert.equal(RECURSION_STUDIES[0].title, "Fuzzy Donut");

  const plan = buildRecursionPlan(PUBLIC_INSTRUMENT_ID);
  const dense = denseMomentFor(plan);
  assert.ok(dense, "Fuzzy Donut must expose a dense state");
  assert.equal(dense.depth, plan.params.depth);
  assert.notEqual(dense.kind, "seed");
  assert.notEqual(dense.kind, "unwind");
  assert.equal(dense, plan.moments.at(-1));

  const live = morphMoment(PUBLIC_INSTRUMENT_ID, dense, LIVE_DEFAULTS);
  assert.ok(
    live.motion.pulses.length >= 40,
    `the default canopy should begin busy; received ${live.motion.pulses.length} pulses`,
  );

  const generation = { kind: "generation", depth: 4 };
  const center = { kind: "center", depth: 4 };
  assert.equal(denseMomentFor({
    moments: [
      { kind: "seed", depth: 0 },
      generation,
      center,
      { kind: "unwind", depth: 99 },
    ],
  }), center, "a center wins a deepest-depth tie and unwind never wins");
});

test("the default Fuzzy Donut live morph is deterministic", () => {
  const dense = denseMomentFor(buildRecursionPlan(PUBLIC_INSTRUMENT_ID));
  const first = morphMoment(PUBLIC_INSTRUMENT_ID, dense, LIVE_DEFAULTS);
  const second = morphMoment(PUBLIC_INSTRUMENT_ID, dense, LIVE_DEFAULTS);
  assert.deepEqual(first, second);
});

test("every live axis materially reshapes Fuzzy Donut motion or direct DSP", () => {
  const dense = denseMomentFor(buildRecursionPlan(PUBLIC_INSTRUMENT_ID));
  for (const axis of LIVE_AXIS_IDS) {
    const low = morphMoment(PUBLIC_INSTRUMENT_ID, dense, {
      ...LIVE_DEFAULTS,
      [axis]: 0,
    });
    const high = morphMoment(PUBLIC_INSTRUMENT_ID, dense, {
      ...LIVE_DEFAULTS,
      [axis]: 1,
    });
    const difference = materialDifference(
      axisProjection(axis, low),
      axisProjection(axis, high),
    );
    const lowDsp = fuzzyDspFor({ ...LIVE_DEFAULTS, [axis]: 0 });
    const highDsp = fuzzyDspFor({ ...LIVE_DEFAULTS, [axis]: 1 });
    const directDspChanged = Object.keys(lowDsp).some(
      (key) => lowDsp[key] !== highDsp[key],
    );
    assert.ok(
      difference >= 0.01 || directDspChanged,
      `Fuzzy Donut ${axis} must materially change motion or DSP; difference=${difference}`,
    );
  }
});

test("Fuzzy Donut keeps tape grains foregrounded in its bounded voice mix", () => {
  const mix = voiceMixFor(PUBLIC_INSTRUMENT_ID, LIVE_DEFAULTS);
  finiteNumbers(mix, "Fuzzy Donut.mix");
  assert.ok(mix.native > 0 && mix.native <= 1);
  assert.ok(mix.motion > 0 && mix.motion <= 1);
  assert.ok(
    mix.motion > mix.native,
    "Fuzzy Donut keeps its tape-grain motion as the foreground identity",
  );
});

test("fuzzyDspFor gives all six live axes wide, independent endpoint travel", () => {
  const expectedKeys = [
    "cutoffHz",
    "toneQ",
    "pitchRate",
    "rhythmHz",
    "rhythmDepth",
    "phraseDelay",
    "phrasePan",
    "twistHz",
    "twistQ",
    "feedback",
    "wet",
    "feedbackCutoffHz",
    "pulsePopulation",
    "subdivisions",
    "grainSeconds",
    "readPosition",
    "reverseChance",
    "memoryStretch",
  ];
  const changedKeys = {};
  const endpoints = {};

  for (const axis of LIVE_AXIS_IDS) {
    const low = fuzzyDspFor({ ...LIVE_DEFAULTS, [axis]: 0 });
    const high = fuzzyDspFor({ ...LIVE_DEFAULTS, [axis]: 1 });
    assert.deepEqual(Object.keys(low), expectedKeys);
    assert.deepEqual(Object.keys(high), expectedKeys);
    finiteNumbers(low, `${axis}.low`);
    finiteNumbers(high, `${axis}.high`);
    endpoints[axis] = { low, high };
    changedKeys[axis] = expectedKeys.filter((key) => low[key] !== high[key]);
  }

  assert.deepEqual(changedKeys, {
    timbre: ["cutoffHz", "toneQ"],
    pitch: ["pitchRate"],
    rhythm: [
      "rhythmHz",
      "rhythmDepth",
      "pulsePopulation",
      "subdivisions",
      "grainSeconds",
    ],
    phrase: ["phraseDelay", "phrasePan", "readPosition"],
    twist: ["twistHz", "twistQ", "reverseChance"],
    memory: ["feedback", "wet", "memoryStretch"],
  });

  assert.ok(endpoints.timbre.high.cutoffHz / endpoints.timbre.low.cutoffHz >= 100);
  assert.ok(endpoints.pitch.high.pitchRate / endpoints.pitch.low.pitchRate >= 16);
  assert.ok(endpoints.rhythm.high.rhythmHz / endpoints.rhythm.low.rhythmHz >= 40);
  assert.ok(
    endpoints.rhythm.high.pulsePopulation
      / endpoints.rhythm.low.pulsePopulation >= 40,
  );
  assert.ok(
    endpoints.phrase.high.phraseDelay
      / endpoints.phrase.low.phraseDelay >= 30,
  );
  assert.deepEqual(
    [endpoints.twist.low.reverseChance, endpoints.twist.high.reverseChance],
    [0, 1],
  );
  assert.deepEqual(
    [endpoints.memory.low.feedback, endpoints.memory.high.feedback],
    [0, 0.88],
  );
});

test("ancestorGain power-normalizes lineages and Memory prunes old depths", () => {
  const maximumDepth = 8;
  for (const memory of [0, 0.1, 0.5, LIVE_DEFAULTS.memory, 1]) {
    const gains = Array.from(
      { length: maximumDepth + 1 },
      (_, depth) => ancestorGain(depth, maximumDepth, memory),
    );
    assert.ok(gains.every((gain) => Number.isFinite(gain) && gain >= 0));
    const power = gains.reduce((total, gain) => total + gain * gain, 0);
    assert.ok(
      Math.abs(power - 1) <= 5e-6,
      `memory=${memory} must have unit lineage power; received ${power}`,
    );
  }

  const forgotten = Array.from(
    { length: maximumDepth + 1 },
    (_, depth) => ancestorGain(depth, maximumDepth, 0),
  );
  assert.deepEqual(forgotten.slice(0, -1), Array(maximumDepth).fill(0));
  assert.equal(forgotten.at(-1), 1);

  const shortMemory = Array.from(
    { length: maximumDepth + 1 },
    (_, depth) => ancestorGain(depth, maximumDepth, 0.1),
  );
  const longMemory = Array.from(
    { length: maximumDepth + 1 },
    (_, depth) => ancestorGain(depth, maximumDepth, 0.9),
  );
  assert.ok(shortMemory[0] < 1e-5, "short Memory should prune the oldest depth");
  assert.ok(shortMemory.at(-1) > shortMemory.at(-2) * 5);
  assert.ok(longMemory[0] > shortMemory[0] * 10_000);
  assert.ok(longMemory.every((gain) => gain > 0));
});

test("live morphs, session tones, and mixes stay finite and hard-bounded", () => {
  const axisStates = [
    LIVE_DEFAULTS,
    Object.fromEntries(LIVE_AXIS_IDS.map((axis) => [axis, 0])),
    Object.fromEntries(LIVE_AXIS_IDS.map((axis) => [axis, 1])),
    {
      timbre: Number.POSITIVE_INFINITY,
      pitch: -100,
      rhythm: 100,
      phrase: Number.NaN,
      twist: "0.25",
      memory: null,
    },
  ];

  for (const rawAxes of axisStates) {
    const axes = normalizeLiveAxes(rawAxes);
    assert.deepEqual(Object.keys(axes), LIVE_AXIS_IDS);
    assert.ok(Object.values(axes).every((value) => (
      Number.isFinite(value) && value >= 0 && value <= 1
    )));

    for (const study of RECURSION_STUDIES) {
      const dense = denseMomentFor(buildRecursionPlan(study.id));
      const morphed = morphMoment(study.id, dense, axes);
      finiteNumbers(morphed, `${study.id}.morph`);
      assert.ok(morphed.motion.pulses.length >= 1);
      assert.ok(morphed.motion.pulses.length <= MOTION_CAPS.maxPulsesPerMoment);
      assert.ok(morphed.events.length >= 1);
      for (let index = 0; index < morphed.motion.pulses.length; index += 1) {
        assertBoundedPulse(
          morphed.motion.pulses[index],
          morphed,
          `${study.id}.pulses[${index}]`,
        );
      }
      for (const event of morphed.events) {
        assert.ok(event.offset >= 0);
        assert.ok(event.duration > 0 && event.duration <= 8 + EPSILON);
        assert.ok(event.liveOrder >= 0 && event.liveOrder <= 1);
        for (const filter of event.process?.filters ?? []) {
          assert.ok(filter.cutoffHz >= 24 && filter.cutoffHz <= 18_000);
          assert.ok(filter.q >= 0.1 && filter.q <= 12);
        }
        for (const stage of event.process?.chain ?? []) {
          assert.ok(stage.delayMs >= 1 && stage.delayMs <= 48);
          assert.ok(stage.feedback >= 0.02 && stage.feedback <= 0.94);
        }
      }

      const tone = sessionToneFor(study.id, axes);
      finiteNumbers(tone, `${study.id}.tone`);
      assert.ok(tone.frequency >= MOTION_CAPS.minFilterHz);
      assert.ok(tone.frequency <= MOTION_CAPS.maxFilterHz);
      assert.ok(tone.q >= 0.1 && tone.q <= 14);
      assert.ok(tone.gain >= -18 && tone.gain <= 18);

      const mix = voiceMixFor(study.id, axes);
      finiteNumbers(mix, `${study.id}.mix`);
      assert.ok(mix.native > 0 && mix.native <= 1);
      assert.ok(mix.motion > 0 && mix.motion <= 1);
    }
  }
});
