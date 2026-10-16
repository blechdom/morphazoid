import assert from "node:assert/strict";
import test from "node:test";
import { RECORDER_SOURCES, sourceMode, nextIndex, sampleChoices, checkInputFile, recorderStatus } from "../src/families/recorded-input/recorder-input-sources.js";
import { SAMPLE_INPUT_OPTIONS, MAX_INPUT_FILE_BYTES } from "../src/instruments/micmic/native/input-source.js";

test("sources list Mic, File and Samples", () => {
  assert.deepEqual(RECORDER_SOURCES.map(source => source.value), ["mic", "file", "samples"]);
  assert.equal(sourceMode("samples"), "samples");
  assert.equal(sourceMode("file"), "file");
  assert.equal(sourceMode("anything"), "mic");
});

test("next wraps and sample choices keep every bundled sample once", () => {
  assert.equal(nextIndex(2, 3), 0);
  assert.equal(nextIndex(0, 0), 0);
  const ids = sampleChoices().map(choice => choice.id);
  assert.equal(new Set(ids).size, SAMPLE_INPUT_OPTIONS.length);
  assert.equal(ids[0], "music-vocal-scat");
});

test("file checks reject empty, oversized and non-file input", () => {
  const file = size => ({ size, arrayBuffer() {} });
  assert.ok(checkInputFile(null));
  assert.ok(checkInputFile(file(0)));
  assert.ok(checkInputFile(file(MAX_INPUT_FILE_BYTES + 1)));
  assert.equal(checkInputFile(file(1024)), "");
});

test("status text covers mic, loading, playing, finished and waiting states", () => {
  const base = { label: "Drums", loop: true, pending: false, playing: false, ended: false, hasFile: false, fileName: "" };
  assert.equal(recorderStatus({ mode: "mic", snapshot: base }), "");
  assert.equal(recorderStatus({ mode: "samples", snapshot: { ...base, pending: true } }), "Loading…");
  assert.equal(recorderStatus({ mode: "samples", snapshot: { ...base, playing: true } }), "Drums · looping");
  assert.match(recorderStatus({ mode: "samples", snapshot: { ...base, playing: true, loop: false } }), /once/);
  assert.match(recorderStatus({ mode: "samples", snapshot: { ...base, ended: true } }), /Finished/);
  assert.match(recorderStatus({ mode: "file", snapshot: base }), /Choose an audio file/);
  assert.match(recorderStatus({ mode: "file", snapshot: base, pendingFile: "a.wav" }), /a\.wav ready/);
});
