import test from "node:test";
import assert from "node:assert/strict";
import { RECORDED_INPUT_SOURCES, checkInputFile, normalizeInputSource, recordedFileStatus } from "../src/families/voice-input/recorded-input.js";
import { MAX_INPUT_FILE_BYTES } from "../src/instruments/micmic/native/input-source.js";

const file = (size, type = "audio/wav") => ({ size, type, arrayBuffer: async () => new ArrayBuffer(0) });

test("source menu lists Mic, File and Samples and falls back to Mic", () => {
  assert.deepEqual(RECORDED_INPUT_SOURCES.map(source => source.label), ["Mic", "File", "Samples"]);
  assert.equal(normalizeInputSource("samples"), "samples");
  assert.equal(normalizeInputSource("file"), "file");
  assert.equal(normalizeInputSource("line"), "mic");
  assert.equal(normalizeInputSource(undefined), "mic");
});

test("file check applies the shared byte bound and rejects non-audio", () => {
  assert.equal(checkInputFile(file(1024)), "");
  assert.equal(checkInputFile(file(1024, "")), "");
  assert.equal(checkInputFile(file(1024, "application/ogg")), "");
  assert.match(checkInputFile(file(0)), /nonempty/);
  assert.match(checkInputFile(file(MAX_INPUT_FILE_BYTES + 1)), /smaller than 64 MiB/);
  assert.match(checkInputFile(file(1024, "text/plain")), /audio file/);
  assert.match(checkInputFile(null), /audio file/);
  assert.match(checkInputFile({ size: 10, type: "audio/wav" }), /audio file/);
});

test("file status distinguishes pending, waiting for Audio, ready, playing and finished", () => {
  const idle = { pending: false, playing: false, hasFile: false, fileName: "", loop: true, ended: false };
  assert.match(recordedFileStatus({ armed: true, state: idle }), /Choose an audio file/);
  assert.equal(recordedFileStatus({ armed: false, state: idle, pendingName: "a.wav" }), "a.wav · switch Audio on, then play.");
  assert.equal(recordedFileStatus({ armed: true, state: idle, pendingName: "a.wav" }), "Ready to play.");
  assert.equal(recordedFileStatus({ armed: true, state: { ...idle, pending: true } }), "Loading file…");
  assert.equal(recordedFileStatus({ armed: true, state: { ...idle, playing: true, hasFile: true, fileName: "a.wav · 1.0 s" } }), "a.wav · 1.0 s · looping");
  assert.equal(recordedFileStatus({ armed: true, state: { ...idle, playing: true, loop: false, fileName: "a.wav" } }), "a.wav · once");
  assert.equal(recordedFileStatus({ armed: true, state: { ...idle, hasFile: true, fileName: "a.wav", ended: true } }), "File finished.");
});
