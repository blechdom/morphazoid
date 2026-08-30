import assert from "node:assert/strict";
import test from "node:test";

import {
  channelSummary,
  clampPosition,
  computeSpeakerGains,
  makeLayouts,
  outputModeFor,
  projectPoint,
} from "../src/surround-field.js";

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
