import test from "node:test";
import assert from "node:assert/strict";
import { isRecordedMode, inputStripState } from "../src/instruments/gesturama/gesturama-input.js";

test("only file and samples are recorded modes", () => {
  assert.equal(isRecordedMode("mic"), false);
  assert.equal(isRecordedMode("file"), true);
  assert.equal(isRecordedMode("samples"), true);
});

test("strip state follows the loop in recorded modes and the stream in mic mode", () => {
  const mic = { active: true, pending: false };
  assert.deepEqual(inputStripState("mic", { playing: false, pending: true }, mic), { active: true, pending: false, source: "mic" });
  assert.deepEqual(inputStripState("samples", { playing: true, pending: false }, mic), { active: true, pending: false, source: "samples" });
  assert.deepEqual(inputStripState("file", { playing: false, pending: true }, { active: true }), { active: false, pending: true, source: "file" });
});
