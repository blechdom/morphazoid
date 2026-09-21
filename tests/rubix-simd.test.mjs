import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRubixSequenceSnapshot, createSolvedRubixCube } from "../src/instruments/rubix/rubix.js";
import { createRubixSimdSurfacePatterns, rubixSimdConfigurations, RubixSurfaceSimd303 } from "../src/instruments/rubix/rubix-simd-surface.js";
import { RUBIX_WEBGPU_303_DEFAULTS } from "../src/instruments/rubix/rubix-webgpu-303.js";

globalThis.sampleRate = 48000;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = []; this.port = { postMessage: (message) => this.messages.push(message) }; }
};
globalThis.registerProcessor = () => {};
const { RubixSimd303Processor, rubixSimdClock } = await import("../src/instruments/rubix/rubix-simd-303-processor.js");
const scalarBytes = await readFile(new URL("../assets/wasm/simd-303-scalar.wasm", import.meta.url));
const simdBytes = await readFile(new URL("../assets/wasm/simd-303-simd.wasm", import.meta.url));

function patterns({ size = 3, readingMode = "parallel", tempo = 126, swing = 0 } = {}) {
  return createRubixSimdSurfacePatterns(createRubixSequenceSnapshot(createSolvedRubixCube(size)), {
    readingMode, tempo, baseParams: { ...RUBIX_WEBGPU_303_DEFAULTS, swing },
  });
}
function processor(options = {}, simd = true) {
  const source = patterns(options);
  const instance = new RubixSimd303Processor();
  instance.handleMessage({ type: "install", scalarBytes, simdBytes: simd ? simdBytes : null, faces: rubixSimdConfigurations(source) });
  return { instance, source };
}
function reveal(instance, source, level = 1, face = null) {
  instance.handleMessage({
    type: "visibility",
    gains: Object.fromEntries(source.filter((p) => !face || p.face === face).flatMap((p) => p.stickerIds.map((id) => [id, level]))),
  });
}
function render(instance, startFrame, frames = 128) {
  const samples = new Float32Array(frames);
  let alive = true;
  for (let offset = 0; offset < frames; offset += 128) {
    globalThis.currentTime = (startFrame + offset) / sampleRate;
    const output = [new Float32Array(128), new Float32Array(128)];
    alive = instance.process([], [output]);
    samples.set(output[0].subarray(0, Math.min(128, frames - offset)), offset);
  }
  return { samples, alive };
}
function start(instance, at = 0.012) {
  globalThis.currentTime = 0;
  instance.handleMessage({ type: "restart", startAt: at, offset: 0 });
  instance.handleMessage({ type: "playback", enabled: true });
}
const rms = (samples) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);

test("SIMD surface reuses the compiled 303 ABI and has six bounded face scores in every mode/size", () => {
  for (const size of [2, 3, 6]) {
    for (const readingMode of ["parallel", "snake", "face"]) {
      const faces = rubixSimdConfigurations(patterns({ size, readingMode }));
      assert.equal(faces.length, 6);
      const ids = new Set(faces.flatMap((face) => face.stepStickerIds.filter(Boolean)));
      assert.equal(ids.size, 6 * size * size);
      for (const face of faces) {
        assert.equal(face.configuration.paramArray.length, 17);
        assert.equal(face.configuration.xlParams.delayMix, 0);
        assert.equal(face.configuration.xlParams.chorusMix, 0);
        assert.equal(face.stepStickerIds.length, size * size * face.divisions);
      }
      if (readingMode === "face") {
        for (let step = 0; step < size * size * 3; step += 1) {
          assert.equal(faces.filter((face) => face.stepStickerIds[step] !== null).length, 2);
        }
      }
    }
  }
  assert.throws(() => rubixSimdConfigurations([]), /six/);
});

test("worklet starts on the requested audio frame without GPU priming, then pauses and disposes", () => {
  const { instance, source } = processor();
  reveal(instance, source);
  assert.ok(render(instance, 0).samples.every((value) => value === 0), "Audio/playback begins off");
  start(instance);
  const output = render(instance, 0, 8192).samples;
  const first = output.findIndex((value) => Math.abs(value) > 1e-5);
  assert.ok(first >= 0.012 * sampleRate);
  assert.ok(first < 0.04 * sampleRate, `first sample at ${first / sampleRate}s`);
  assert.ok(output.every(Number.isFinite));
  assert.ok(rms(output) > 0.005);
  assert.deepEqual(instance.messages.find(({ type }) => type === "ready"), { type: "ready", backend: "simd", faceCount: 6 });
  instance.handleMessage({ type: "playback", enabled: false });
  const beat = instance.beat;
  assert.ok(render(instance, 8192, 256).samples.every((value) => value === 0));
  assert.equal(instance.beat, beat);
  instance.handleMessage({ type: "dispose" });
  assert.equal(render(instance, 8448).alive, false);
  assert.equal(instance.voices.length, 0);
});

test("worklet visibility follows area ratios, fades tails to zero and reveals without a timeline reset", () => {
  const a = processor();
  const b = processor();
  reveal(a.instance, a.source, 1, "front");
  reveal(b.instance, b.source, 0.25, "front");
  start(a.instance);
  start(b.instance);
  const full = render(a.instance, 0, 4096).samples;
  const quarter = render(b.instance, 0, 4096).samples;
  assert.ok(Math.abs(rms(quarter) / rms(full) - 0.25) < 1e-5);
  const before = a.instance.beat;
  a.instance.handleMessage({ type: "visibility", gains: {} });
  const hidden = render(a.instance, 4096, 2048).samples;
  assert.ok(hidden.subarray(1024).every((value) => value === 0));
  assert.ok(a.instance.beat > before, "hidden faces keep clock phase");
  reveal(a.instance, a.source, 1, "back");
  const revealed = render(a.instance, 6144, 8192).samples;
  assert.ok(rms(revealed) > 0.001);
  assert.equal(a.instance.messages.filter(({ type }) => type === "error").length, 0);
});

test("rapid hide before a fade begins cancels the pending reveal", () => {
  const { instance, source } = processor();
  reveal(instance, source);
  instance.handleMessage({ type: "visibility", gains: {} });
  start(instance);
  assert.ok(render(instance, 0, 4096).samples.every((value) => value === 0));
});

test("live tempo, swing, timbre and score updates preserve phase without restarting audio", () => {
  const { instance, source } = processor();
  reveal(instance, source);
  start(instance);
  render(instance, 0, 4096);
  const before = instance.beat;
  const kernels = instance.voices.map((voice) => voice.kernel);
  instance.handleMessage({ type: "configure", faces: rubixSimdConfigurations(patterns({ tempo: 212, swing: 0.3, readingMode: "face" })) });
  assert.equal(instance.beat, before);
  assert.equal(instance.enabled, true);
  assert.deepEqual(instance.voices.map((voice) => voice.kernel), kernels);
  assert.ok(render(instance, 4096, 4096).samples.every(Number.isFinite));
  assert.ok(instance.beat > before);
});

test("opposite pairs share correctly swung subdivisions and the actual audio-clock playhead", () => {
  const { instance, source } = processor({ tempo: 120, swing: 0.3, readingMode: "face" });
  reveal(instance, source);
  start(instance, 0);
  render(instance, 0, 48000);
  const steps = instance.messages.filter(({ type }) => type === "step");
  assert.deepEqual(steps.slice(0, 7).map(({ step }) => step), [0, 1, 2, 3, 4, 5, 6]);
  for (let index = 0; index < 6; index += 1) {
    const expected = (index < 3 ? 0.125 * 1.3 : 0.125 * 0.7) / 3;
    assert.ok(Math.abs(steps[index + 1].time - steps[index].time - expected) < 2 / sampleRate);
  }
  assert.equal(instance.messages.filter(({ type }) => type === "error").length, 0);
  for (const swing of [0, 0.2, 0.42]) {
    for (const beat of [0, 0.3, 1, 1.2, 2, 3.7, 20]) {
      const single = rubixSimdClock(beat, 8, swing);
      const triple = rubixSimdClock(beat, 8, swing, 3);
      assert.equal(triple.phase, single.phase * 3);
      assert.ok(Math.abs(triple.slope - single.slope * 3) < 1e-10);
    }
  }
});

test("scalar Wasm fallback remains audible and close to SIMD without touching shared kernels", () => {
  const a = processor({}, true);
  const b = processor({}, false);
  reveal(a.instance, a.source);
  reveal(b.instance, b.source);
  start(a.instance);
  start(b.instance);
  const simd = render(a.instance, 0, 8192).samples;
  const scalar = render(b.instance, 0, 8192).samples;
  assert.ok(rms(scalar) > 0.005);
  assert.ok(Math.abs(rms(simd) - rms(scalar)) < 0.002);
  assert.equal(b.instance.backend, "scalar");
});

test("surface start cancellation aborts loads, closes no borrowed context, and cannot recreate a node", async () => {
  let aborted = 0;
  let nodes = 0;
  const runtime = {
    AbortController, WebAssembly, setTimeout, clearTimeout,
    AudioWorkletNode: class { constructor() { nodes += 1; } },
    fetch(_url, { signal }) {
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => {
        aborted += 1;
        reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
      }));
    },
  };
  const context = { audioWorklet: { addModule: async () => {} }, close() { assert.fail("borrowed context closed"); } };
  const engine = new RubixSurfaceSimd303(runtime);
  engine.updateSurfacePatterns(patterns());
  const pending = engine.start({}, { context, destination: {} });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await engine.stop();
  await rejected;
  assert.equal(aborted, 2);
  assert.equal(nodes, 0);
  assert.equal(engine.context, null);
});
