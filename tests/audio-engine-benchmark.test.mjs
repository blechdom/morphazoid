import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_OFFLINE_RENDER_SECONDS,
  OFFLINE_BENCHMARK_RUNS,
  benchmarkOfflineEngine,
  createOfflineBenchmarkModes,
  summarizeOfflineMeasurements,
} from "../src/audio-engine-benchmark.js";

test("offline benchmark fixes one warm-up and three measured renders", () => {
  assert.deepEqual(OFFLINE_BENCHMARK_RUNS, {
    warmup: 1,
    measured: 3,
  });
  assert.equal(DEFAULT_OFFLINE_RENDER_SECONDS, 1.5);
});

test("offline benchmark modes isolate pitch, time, and their combined path", () => {
  const modes = createOfflineBenchmarkModes(7, 1.75);
  assert.deepEqual(
    modes.map(({ id, pitch, stretch }) => ({ id, pitch, stretch })),
    [
      { id: "pitch-only", pitch: 7, stretch: 1 },
      { id: "time-only", pitch: 0, stretch: 1.75 },
      { id: "combined", pitch: 7, stretch: 1.75 },
    ],
  );

  const clamped = createOfflineBenchmarkModes(99, 0.01);
  assert.equal(clamped[0].pitch, 24);
  assert.equal(clamped[1].stretch, 0.25);
  assert.equal(clamped[2].pitch, 24);
  assert.equal(clamped[2].stretch, 0.25);
});

test("offline summaries use measured medians and report realtime factor honestly", () => {
  const summary = summarizeOfflineMeasurements([
    { setupMs: 30, renderMs: 50, rms: 0.3, peak: 0.8 },
    { setupMs: 10, renderMs: 30, rms: 0.1, peak: 0.4 },
    { setupMs: 20, renderMs: 40, rms: 0.2, peak: 0.6 },
  ], 2);

  assert.equal(summary.setupMs, 20);
  assert.equal(summary.renderMs, 40);
  assert.equal(summary.rtf, 0.02);
  assert.equal(summary.offlineBudgetPercent, 2);
  assert.equal(summary.speed, 50);
  assert.equal(summary.rms, 0.2);
  assert.equal(summary.peak, 0.6);
});

test("offline benchmark rejects invalid and silent loops before browser work begins", async () => {
  await assert.rejects(
    benchmarkOfflineEngine("does-not-exist", {
      samples: new Float32Array([0.1, -0.1]),
      sampleRate: 48_000,
    }),
    /Unknown audio engine/i,
  );
  await assert.rejects(
    benchmarkOfflineEngine("raw", {
      samples: new Float32Array([0, 0, 0]),
      sampleRate: 48_000,
    }),
    /loop is silent/i,
  );
  await assert.rejects(
    benchmarkOfflineEngine("raw", {
      samples: new Float32Array([0.1, -0.1]),
      sampleRate: 0,
    }),
    /invalid sample rate/i,
  );
});

test("an abort during the final render cannot publish a stale measurement", async () => {
  const originalOfflineAudioContext = globalThis.OfflineAudioContext;
  const controller = new AbortController();
  class FakeOfflineAudioContext {
    constructor(options) {
      this.sampleRate = options.sampleRate;
      this.length = options.length;
      this.destination = {};
    }

    createBuffer(_channels, length) {
      const data = new Float32Array(length);
      return {
        copyToChannel(samples) {
          data.set(samples.subarray(0, data.length));
        },
      };
    }

    createBufferSource() {
      return {
        playbackRate: { value: 1 },
        connect() {},
        start() {},
        stop() {},
      };
    }

    async startRendering() {
      controller.abort();
      const output = Float32Array.from({ length: this.length }, () => 0.1);
      return {
        numberOfChannels: 1,
        getChannelData: () => output,
      };
    }
  }

  globalThis.OfflineAudioContext = FakeOfflineAudioContext;
  try {
    await assert.rejects(
      benchmarkOfflineEngine("raw", {
        samples: Float32Array.from([0.1, -0.1, 0.1, -0.1]),
        sampleRate: 48_000,
      }, {
        renderSeconds: 0.25,
        signal: controller.signal,
      }),
      (error) => error?.name === "AbortError",
    );
  } finally {
    if (originalOfflineAudioContext === undefined) {
      delete globalThis.OfflineAudioContext;
    } else {
      globalThis.OfflineAudioContext = originalOfflineAudioContext;
    }
  }
});

test("offline graph registry covers every current lab renderer", async () => {
  const source = await readFile(
    new URL("../src/audio-engine-benchmark.js", import.meta.url),
    "utf8",
  );
  for (const engineId of [
    "raw",
    "native-tape",
    "signalsmith-silky",
    "signalsmith-economy",
    "soundtouch",
    "soundtouch-phase-vocoder",
    "hybrid-soundtouch-signalsmith",
    "tone-grain",
    "elementary",
  ]) {
    assert.match(source, new RegExp(`"${engineId}"`));
  }
  assert.match(source, /new Tone\.OfflineContext\(context\)/);
  assert.match(source, /toneContext\.render\(false\)/);
  assert.match(source, /rendered silence/i);
});
