import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIO_TIMING,
  DEFAULT_TEST_SIGNAL,
  TEST_SIGNALS,
  TEST_TRIM_RANGE,
  channelSummary,
  clampPosition,
  computeSpeakerGains,
  createLfePinkNoiseSamples,
  createPinkNoiseSamples,
  dbfsToGain,
  makeLayouts,
  outputModeFor,
  planAudioEvents,
  projectPoint,
  signalRms,
} from "../src/surround-field.js";

test("audio lookahead planner keeps events on an absolute timeline", () => {
  const plan = planAudioEvents({
    nextAt: 10,
    now: 9.9,
    lookahead: 0.8,
    interval: AUDIO_TIMING.phraseStepSeconds,
    maxEvents: 3,
  });
  assert.deepEqual(plan.times, [10, 10.31, 10.620000000000001]);
  assert.ok(Math.abs(plan.nextAt - 10.93) < 1e-9);
  assert.equal(plan.skipped, 0);
});

test("late audio scheduler ticks skip missed subdivisions instead of bursting", () => {
  const plan = planAudioEvents({ nextAt: 9.8, now: 10 });
  assert.equal(plan.skipped, 1);
  assert.equal(plan.times.length, 1);
  assert.ok(plan.times[0] >= 10 + AUDIO_TIMING.minimumLeadSeconds);

  const veryLate = planAudioEvents({ nextAt: 5, now: 10 });
  assert.ok(veryLate.skipped > 1);
  assert.ok(veryLate.times.length <= 1);
  assert.ok(veryLate.times.every((time) => time >= 10 + AUDIO_TIMING.minimumLeadSeconds));
});

test("Surround Field includes every requested layout", () => {
  const layouts = makeLayouts();
  assert.equal(layouts["7-4-1"].speakers.length, 12);
  assert.equal(layouts["7-4-1"].speakers.filter(({ kind }) => kind === "height").length, 4);
  assert.equal(layouts["7-4-1"].speakers.filter(({ kind }) => kind === "lfe").length, 1);
  assert.equal(layouts["4-1"].speakers.length, 5);
  assert.equal(layouts["8-circle"].speakers.length, 8);
  assert.equal(layouts["8-cube"].speakers.length, 8);
  assert.equal(layouts["8-cube"].speakers.filter(({ z }) => z > 0).length, 4);
});

test("7:4:1 follows Web Audio/WAVE order with rears before surrounds", () => {
  const speakers = makeLayouts()["7-4-1"].speakers;
  assert.deepEqual(
    speakers.map(({ channel, label, id, kind, azimuth }) => ({ channel, label, id, kind, azimuth })),
    [
      { channel: 1, label: "L", id: "left", kind: "full", azimuth: -30 },
      { channel: 2, label: "R", id: "right", kind: "full", azimuth: 30 },
      { channel: 3, label: "C", id: "center", kind: "full", azimuth: 0 },
      { channel: 4, label: "LFE", id: "sub", kind: "lfe", azimuth: -76 },
      { channel: 5, label: "Lrs", id: "left-rear", kind: "full", azimuth: -145 },
      { channel: 6, label: "Rrs", id: "right-rear", kind: "full", azimuth: 145 },
      { channel: 7, label: "Ls", id: "left-side", kind: "full", azimuth: -100 },
      { channel: 8, label: "Rs", id: "right-side", kind: "full", azimuth: 100 },
      { channel: 9, label: "Tfl", id: "top-front-left", kind: "height", azimuth: -44 },
      { channel: 10, label: "Tfr", id: "top-front-right", kind: "height", azimuth: 44 },
      { channel: 11, label: "Trl", id: "top-rear-left", kind: "height", azimuth: -136 },
      { channel: 12, label: "Trr", id: "top-rear-right", kind: "height", azimuth: 136 },
    ],
  );
});

test("speaker test signals expose calibrated digital reference levels", () => {
  assert.equal(DEFAULT_TEST_SIGNAL, "pink");
  assert.deepEqual(TEST_TRIM_RANGE, { minimum: -24, maximum: 6, defaultValue: 0 });
  assert.deepEqual(
    Object.fromEntries(Object.entries(TEST_SIGNALS).map(([id, signal]) => [id, {
      referenceDbfs: signal.referenceDbfs,
      referenceUnit: signal.referenceUnit,
    }])),
    {
      pink: { referenceDbfs: -20, referenceUnit: "RMS" },
      tone: { referenceDbfs: -18, referenceUnit: "PEAK" },
      chirp: { referenceDbfs: -18, referenceUnit: "PEAK" },
    },
  );
  assert.equal(dbfsToGain(-20), 0.1);
  assert.ok(Math.abs(dbfsToGain(-18) - 0.12589254117941673) < 1e-15);
  assert.equal(dbfsToGain(Number.NaN), 0);
});

test("pink-noise calibration is deterministic and normalized to target RMS", () => {
  const samples = createPinkNoiseSamples(48_000, -20, 12345);
  const matching = createPinkNoiseSamples(48_000, -20, 12345);
  const different = createPinkNoiseSamples(48_000, -20, 54321);

  assert.equal(samples.length, 48_000);
  assert.deepEqual(samples, matching);
  assert.notDeepEqual(samples.subarray(0, 64), different.subarray(0, 64));
  assert.ok(Math.abs(signalRms(samples) - 0.1) < 1e-7);
  assert.equal(signalRms(new Float32Array()), 0);
});

test("LFE calibration noise is band-limited and normalized after filtering", () => {
  const samples = createLfePinkNoiseSamples(48_000, 48_000, -20, 12345);
  assert.ok(Math.abs(signalRms(samples) - 0.1) < 1e-7);

  let adjacentDelta = 0;
  for (let index = 1; index < samples.length; index += 1) {
    adjacentDelta += Math.abs(samples[index] - samples[index - 1]);
  }
  assert.ok(adjacentDelta / (samples.length - 1) < 0.01, "LFE noise should not contain strong high-frequency energy");
});

test("custom ring reaches the Web Audio graph guarantee of 32 channels", () => {
  const layout = makeLayouts(32).custom;
  assert.equal(layout.speakers.length, 32);
  assert.deepEqual(
    layout.speakers.map(({ channel }) => channel),
    Array.from({ length: 32 }, (_, index) => index + 1),
  );
});

test("spatial gains are equal-power apart from a deliberate LFE send", () => {
  const speakers = makeLayouts()["8-circle"].speakers;
  const gains = computeSpeakerGains(speakers, { x: 0, y: 0, z: 0 }, 0.5);
  const power = gains.reduce((total, gain) => total + gain * gain, 0);
  assert.ok(Math.abs(power - 1) < 0.002, `power was ${power}`);
  assert.ok(gains.every((gain) => Math.abs(gain - gains[0]) <= 0.00011));
});

test("a source near front-right favors the nearest ring speaker", () => {
  const speakers = makeLayouts()["8-circle"].speakers;
  const gains = computeSpeakerGains(speakers, { x: 0.62, y: -0.62, z: 0 }, 0.8);
  const maximum = gains.indexOf(Math.max(...gains));
  assert.equal(speakers[maximum].azimuth, 45);
});

test("projection and position helpers keep the emitter inside the room", () => {
  assert.deepEqual(clampPosition({ x: 4, y: 0, z: 2 }), { x: 0.86, y: 0, z: 1 });
  const upper = projectPoint({ x: 0, y: 0, z: 1 }, "space");
  const lower = projectPoint({ x: 0, y: 0, z: 0 }, "space");
  assert.ok(upper.y < lower.y);
});

test("discrete mode is selected only when every requested channel fits", () => {
  assert.equal(outputModeFor(12, 12), "discrete");
  assert.equal(outputModeFor(8, 12), "preview");
  assert.equal(outputModeFor(12, 8, true), "preview");
  assert.deepEqual(channelSummary(null, 8), {
    mode: "unprobed",
    label: "Start audio to probe",
    detail: "8 virtual channels",
  });
});
