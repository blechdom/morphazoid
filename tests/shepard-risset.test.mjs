import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SHEPARD_DEFAULTS,
  SHEPARD_PRESETS,
  advanceUnitPosition,
  calculateShepardPartials,
  createSoftCeilingCurve,
  sanitizeShepardParams,
  shepardWindow,
} from "../src/shepard-risset.js";

test("Shepard parameters are finite and bounded", () => {
  assert.deepEqual(
    sanitizeShepardParams({
      centerFrequency: Number.NaN,
      rate: 99,
      width: -4,
      spread: 8,
      cutoff: Infinity,
      level: -2,
    }),
    {
      centerFrequency: SHEPARD_DEFAULTS.centerFrequency,
      rate: 2,
      width: 3,
      spread: 1,
      cutoff: SHEPARD_DEFAULTS.cutoff,
      level: 0,
    },
  );
});

test("cosine window is symmetric with silent bank edges", () => {
  assert.equal(shepardWindow(-2.5, 5), 0);
  assert.equal(shepardWindow(2.5, 5), 0);
  assert.equal(shepardWindow(0, 5), 1);
  assert.ok(Math.abs(shepardWindow(-1.25, 5) - shepardWindow(1.25, 5)) < 1e-12);
});

test("unit position reports positive and negative octave wraps", () => {
  assert.deepEqual(advanceUnitPosition(0.9, 0.25), {
    position: 0.1499999999999999,
    wraps: 1,
  });
  assert.deepEqual(advanceUnitPosition(0.1, -0.25), {
    position: 0.8500000000000001,
    wraps: -1,
  });
  assert.deepEqual(advanceUnitPosition(0.2, 2.25), {
    position: 0.4500000000000002,
    wraps: 2,
  });
});

test("active Shepard partials remain octave spaced and power normalized", () => {
  const frame = calculateShepardPartials({
    position: 0.37,
    centerFrequency: 220,
    width: 7,
    spread: 0.4,
    sampleRate: 48_000,
  });
  const active = frame.partials.filter((partial) => partial.active);
  assert.ok(active.length >= 5);
  for (let index = 1; index < active.length; index += 1) {
    assert.ok(Math.abs(active[index].frequency / active[index - 1].frequency - 2) < 1e-12);
  }
  assert.ok(Math.abs(frame.normalization ** 2 * frame.weightPower - 1) < 1e-12);
  assert.ok(active.every((partial) => partial.frequency >= 20));
  assert.ok(active.every((partial) => partial.frequency <= 21_600));
});

test("preset bank includes balanced rising and falling directions", () => {
  assert.equal(SHEPARD_PRESETS.length, 4);
  assert.ok(SHEPARD_PRESETS.some((preset) => preset.rate > 0));
  assert.ok(SHEPARD_PRESETS.some((preset) => preset.rate < 0));
  assert.equal(new Set(SHEPARD_PRESETS.map((preset) => preset.id)).size, 4);
});

test("soft ceiling is symmetric, monotonic, and bounded", () => {
  const curve = createSoftCeilingCurve(257);
  assert.equal(curve.length, 257);
  assert.ok(Math.abs(curve[0] + curve.at(-1)) < 1e-6);
  assert.ok(Math.abs(curve[128]) < 1e-7);
  assert.ok(Math.max(...curve.map(Math.abs)) <= 0.921);
  for (let index = 1; index < curve.length; index += 1) {
    assert.ok(curve[index] >= curve[index - 1]);
  }
});

test("worklet renders a finite normalized stereo bank through an octave seam", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }
  }

  globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
  globalThis.registerProcessor = (_name, ProcessorConstructor) => {
    Processor = ProcessorConstructor;
  };
  globalThis.sampleRate = 48_000;

  try {
    await import(`../src/shepard-risset.js?worklet-test=${Date.now()}`);
    assert.equal(typeof Processor, "function");
    const processor = new Processor({
      processorOptions: {
        centerFrequency: 220,
        rate: 2,
        width: 5,
        spread: 0.4,
      },
    });
    processor.port.onmessage({ data: { type: "active", value: true } });

    const rendered = [];
    let peak = 0;
    for (let block = 0; block < 220; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]));
        assert.ok(Number.isFinite(right[index]));
        peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
        rendered.push(left[index]);
      }
    }

    const rms = Math.sqrt(
      rendered.reduce((sum, sample) => sum + sample * sample, 0) / rendered.length,
    );
    assert.ok(rms > 0.05, `unexpected Shepard RMS ${rms}`);
    assert.ok(rms < 0.4, `unexpected Shepard RMS ${rms}`);
    assert.ok(peak < 0.8, `unexpected Shepard peak ${peak}`);
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("native page keeps audio creation behind the Audio gesture and cleans up", async () => {
  const root = new URL("../", import.meta.url);
  const [markup, app, audioModule] = await Promise.all([
    readFile(new URL("shepard-risset.html", root), "utf8"),
    readFile(new URL("shepard-risset-app.js", root), "utf8"),
    readFile(new URL("src/shepard-risset.js", root), "utf8"),
  ]);

  assert.match(markup, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="audioState">off</);
  assert.match(markup, /src="shepard-risset-app\.js"/);
  assert.match(app, /audioButton"\)\.addEventListener\("click", toggleAudio\)/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(audioModule, /async start\(\)\s*\{\s*await this\.initialize\(\)/);
  assert.doesNotMatch(app, /new AudioContext/);
  assert.doesNotMatch(markup, /https?:\/\//);
});
