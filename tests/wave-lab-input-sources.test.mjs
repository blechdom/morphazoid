import test from "node:test";
import assert from "node:assert/strict";
import { INPUT_SOURCE_OPTIONS, normalizeInputSource, recordedSourceStatus } from "../src/families/wave-lab/wave-lab-input-sources.js";

test("source list is Mic, File, Samples and unknown values fall back to Mic", () => {
  assert.deepEqual(INPUT_SOURCE_OPTIONS.map((option) => option.label), ["Mic", "File", "Samples"]);
  assert.equal(normalizeInputSource("samples"), "samples");
  assert.equal(normalizeInputSource("file"), "file");
  assert.equal(normalizeInputSource("bogus"), "mic");
  assert.equal(normalizeInputSource(undefined), "mic");
});

test("recorded source status never implies Audio is armed", () => {
  const idle = { pending: false, playing: false, hasFile: true, loop: true, ended: false, label: "x" };
  assert.equal(recordedSourceStatus("mic", idle, true), "");
  assert.match(recordedSourceStatus("samples", idle, false), /Audio on/);
  assert.match(recordedSourceStatus("file", { ...idle, hasFile: false }, true), /Choose an audio file/);
  assert.match(recordedSourceStatus("samples", { ...idle, pending: true }, true), /Loading/);
  assert.equal(recordedSourceStatus("samples", { ...idle, playing: true }, true), "x · looping");
  assert.equal(recordedSourceStatus("samples", { ...idle, ended: true }, true), "Finished.");
});
