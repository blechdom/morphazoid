import assert from "node:assert/strict";
import test from "node:test";
import {
  ACOUSTIC_INPUT_SOURCES,
  MAX_SAMPLE_SECONDS,
  acousticSampleChoices,
  boundedSampleChannel,
  createSampleLoader,
  inputModeVisibility,
  nextSampleId,
  normalizeInputMode,
  sampleOriginId,
  sampleSourceOrigin,
  sampleStatusText,
} from "../src/instruments/acoustic-manifold/acoustic-manifold-samples.js";

const fakeBuffer = (length, rate = 48_000) => ({
  length, sampleRate: rate, numberOfChannels: 2, getChannelData: () => new Float32Array(length).fill(0.25),
});
const toMono = (buffer) => Float32Array.from(buffer.getChannelData(0));

test("source list is Mic, File, Samples and unknown modes fall back to Mic", () => {
  assert.deepEqual(ACOUSTIC_INPUT_SOURCES.map((entry) => entry.label), ["Mic", "File", "Samples"]);
  assert.equal(normalizeInputMode("samples"), "samples");
  assert.equal(normalizeInputMode("bogus"), "mic");
});

test("each mode shows only its own controls", () => {
  assert.deepEqual(inputModeVisibility("mic"), { liveControls: true, fileLabel: false, sampleRow: false });
  assert.deepEqual(inputModeVisibility("file"), { liveControls: false, fileLabel: true, sampleRow: false });
  assert.deepEqual(inputModeVisibility("samples"), { liveControls: false, fileLabel: false, sampleRow: true });
});

test("sample choices use the shared order and Next wraps", () => {
  const choices = acousticSampleChoices();
  assert.equal(choices[0].id, "music-vocal-scat");
  assert.equal(nextSampleId(choices, choices.at(-1).id), choices[0].id);
  assert.equal(nextSampleId(choices, choices[0].id), choices[1].id);
  assert.equal(nextSampleId([], "x"), null);
});

test("sample origin is a recording-kind credit that never names a species", () => {
  const origin = sampleSourceOrigin({ id: "a", label: "A" }, { credit: "Someone, CC-BY", creditUrl: "https://x.test/c" });
  assert.equal(origin.kind, "recording");
  assert.equal(origin.id, sampleOriginId("a"));
  assert.equal(origin.attribution, "Someone, CC-BY");
  assert.equal(origin.sourceUrl, "https://x.test/c");
  assert.equal(sampleSourceOrigin({ id: "a", label: "A" }).attribution, "Bundled recorded sample");
});

test("sample channel is bounded by duration", () => {
  const long = new Float32Array(48_000 * 3);
  assert.equal(boundedSampleChannel(long, 48_000, 1).length, 48_000);
  assert.equal(boundedSampleChannel(long, 48_000, 10), long);
});

test("loader decodes with the injected context and returns mono bounded PCM", async () => {
  const calls = [];
  const loader = createSampleLoader({
    toMono,
    createContext: () => ({ id: "ctx" }),
    loadDemo: async (context, id) => { calls.push([context.id, id]); return { buffer: fakeBuffer(48_000 * (MAX_SAMPLE_SECONDS + 5)), credit: "c", creditUrl: "u" }; },
  });
  const id = loader.choices[0].id;
  const loaded = await loader.load(id);
  assert.deepEqual(calls, [["ctx", id]]);
  assert.equal(loaded.samples.length, 48_000 * MAX_SAMPLE_SECONDS);
  assert.equal(loaded.sampleRate, 48_000);
  assert.equal(loaded.origin.id, sampleOriginId(id));
  assert.equal(loaded.decodeMetadata.originalSampleRatePreserved, false);
});

test("loader rejects unknown ids, pre-aborted signals, and aborts after decode", async () => {
  let decoded = 0;
  const loader = createSampleLoader({ toMono, createContext: () => ({}), loadDemo: async () => { decoded += 1; return { buffer: fakeBuffer(100) }; } });
  await assert.rejects(loader.load("nope"), RangeError);
  const early = new AbortController(); early.abort();
  await assert.rejects(loader.load(loader.choices[0].id, { signal: early.signal }), { name: "AbortError" });
  assert.equal(decoded, 0);
  const late = new AbortController();
  const slow = createSampleLoader({ toMono, createContext: () => ({}), loadDemo: async () => { late.abort(); return { buffer: fakeBuffer(100) }; } });
  await assert.rejects(slow.load(slow.choices[0].id, { signal: late.signal }), { name: "AbortError" });
});

test("loader requires a mono selector and rejects silent-empty buffers", async () => {
  assert.throws(() => createSampleLoader({}), TypeError);
  const loader = createSampleLoader({ toMono: () => new Float32Array(0), createContext: () => ({}), loadDemo: async () => ({ buffer: fakeBuffer(0) }) });
  await assert.rejects(loader.load(loader.choices[0].id), /no audio/);
});

test("status text prefers errors, then loading, then playback", () => {
  assert.equal(sampleStatusText({ error: "bad", pending: true }), "bad");
  assert.equal(sampleStatusText({ pending: true }), "Preparing sample…");
  assert.equal(sampleStatusText({ playing: true, loop: false, label: "Tabla" }), "Tabla · once");
  assert.match(sampleStatusText({}), /Press Play/);
});

import { readFileSync } from "node:fs";

test("selecting a source never reaches getUserMedia and only the mic toggle starts capture", () => {
  const app = readFileSync(new URL("../src/instruments/acoustic-manifold/acoustic-manifold-app.js", import.meta.url), "utf8");
  const samples = readFileSync(new URL("../src/instruments/acoustic-manifold/acoustic-manifold-samples.js", import.meta.url), "utf8");
  assert.doesNotMatch(samples, /getUserMedia/);
  const switcher = app.slice(app.indexOf("function switchInputMode"), app.indexOf("acousticInput = mountAcousticInput"));
  assert.doesNotMatch(switcher, /startLiveInput|AcousticLiveCapture/);
  assert.match(switcher, /cancelLiveCapture\(\)/);
  assert.match(switcher, /cancelSampleLoad\(\)/);
  assert.match(switcher, /stopPlayback\(false, true\)/);
  assert.match(app, /fileInput: \$\("audio-file"\)/);
  assert.equal(app.split('$("audio-file").addEventListener("change"').length - 1, 1);
});
