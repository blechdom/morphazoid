import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";

import {
  PLUGAZOID_DEFAULTS,
  PLUGAZOID_PLUGIN_FORMATS,
  PLUGAZOID_PRESETS,
  classifyPluginArtifact,
  decibelsToGain,
  meterPercentage,
  outputLevelToGain,
  sanitizePlugazoidSettings,
} from "../src/plugazoid.js";

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const PROCESSOR_URL = new URL("../src/plugazoid-processor.js", import.meta.url);
const PAGE_URL = new URL("../plugazoid.html", import.meta.url);
const savedGlobals = new Map(
  ["sampleRate", "AudioWorkletProcessor", "registerProcessor"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);

let registeredName = null;
let ProcessorConstructor = null;

class MockAudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      messages: [],
      postMessage(message) {
        this.messages.push(message);
      },
    };
  }
}

Object.defineProperties(globalThis, {
  sampleRate: { configurable: true, writable: true, value: SAMPLE_RATE },
  AudioWorkletProcessor: {
    configurable: true,
    writable: true,
    value: MockAudioWorkletProcessor,
  },
  registerProcessor: {
    configurable: true,
    writable: true,
    value(name, constructor) {
      registeredName = name;
      ProcessorConstructor = constructor;
    },
  },
});

await import(`${PROCESSOR_URL.href}?test=${Date.now()}`);

after(() => {
  for (const [key, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function parameterBlock(overrides = {}) {
  return {
    driveDb: new Float32Array([8]),
    toneHz: new Float32Array([4_200]),
    mix: new Float32Array([0.72]),
    bypass: new Float32Array([0]),
    ...overrides,
  };
}

function renderBlock(processor, sampleAtFrame, parameters = parameterBlock()) {
  const input = new Float32Array(BLOCK_SIZE);
  const left = new Float32Array(BLOCK_SIZE);
  const right = new Float32Array(BLOCK_SIZE);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = sampleAtFrame(index);
  }
  assert.equal(processor.process([[input]], [[left, right]], parameters), true);
  return { input, left, right };
}

test("Plugazoid presents the native roadmap in VST3, CLAP, Audio Unit order", () => {
  assert.deepEqual(
    PLUGAZOID_PLUGIN_FORMATS.map(({ id }) => id),
    ["vst3", "clap", "audio-unit"],
  );
  assert.equal(PLUGAZOID_PLUGIN_FORMATS[0].available, true);
  assert.equal(PLUGAZOID_PLUGIN_FORMATS.slice(1).every(({ available }) => !available), true);
});

test("settings reject hostile values and stay within finite output limits", () => {
  const safe = sanitizePlugazoidSettings({
    format: "dll",
    preset: "untrusted",
    inputTrimDb: -999,
    driveDb: Infinity,
    toneHz: Number.NaN,
    mix: 12,
    outputLevel: 4,
    bypassed: "yes",
  });
  assert.deepEqual(safe, {
    ...PLUGAZOID_DEFAULTS,
    inputTrimDb: -18,
    mix: 1,
    outputLevel: 0.82,
    bypassed: true,
  });
  assert.ok(Object.isFrozen(safe));
  assert.ok(Number.isFinite(decibelsToGain(Number.NaN)));
  assert.equal(outputLevelToGain(0), 0);
  assert.ok(outputLevelToGain(0.82) < 1);
  assert.equal(meterPercentage(0), 0);
  assert.ok(meterPercentage(0.1) > meterPercentage(0.01));
});

test("presets are distinct, bounded, and reproducible", () => {
  assert.deepEqual(
    PLUGAZOID_PRESETS.map(({ id }) => id),
    ["clean-port", "warm-port", "feral-port"],
  );
  assert.equal(
    new Set(PLUGAZOID_PRESETS.map(({ values }) => JSON.stringify(values))).size,
    PLUGAZOID_PRESETS.length,
  );
  for (const preset of PLUGAZOID_PRESETS) {
    const safe = sanitizePlugazoidSettings({
      ...PLUGAZOID_DEFAULTS,
      ...preset.values,
      preset: preset.id,
    });
    assert.equal(safe.preset, preset.id);
    assert.deepEqual(
      {
        inputTrimDb: safe.inputTrimDb,
        driveDb: safe.driveDb,
        toneHz: safe.toneHz,
        mix: safe.mix,
      },
      preset.values,
    );
  }
});

test("packaging inspection never mistakes native bundles for browser modules", () => {
  for (const [filename, format] of [
    ["glue.vst3", "VST3"],
    ["voices.CLAP", "CLAP"],
    ["chorus.component", "Audio Unit"],
  ]) {
    const result = classifyPluginArtifact(filename);
    assert.equal(result.kind, "native-bundle");
    assert.equal(result.format, format);
    assert.equal(result.browserRunnable, false);
    assert.match(result.message, /source port|source ported/);
  }
  assert.equal(classifyPluginArtifact("processor.wasm").kind, "wasm-module");
  assert.equal(classifyPluginArtifact("mystery.exe").kind, "unknown");
});

test("the worklet registers one bounded realtime processor with a WASM adapter seam", () => {
  assert.equal(registeredName, "morphazoid-plugazoid-port");
  assert.equal(typeof ProcessorConstructor, "function");
  const processor = new ProcessorConstructor();
  assert.deepEqual(processor.port.messages[0], {
    type: "ready",
    processor: "morphazoid-plugazoid-port",
    backend: "AudioWorklet JS",
    wasmSlot: true,
  });

  let changedSamples = 0;
  for (let block = 0; block < 16; block += 1) {
    const rendered = renderBlock(
      processor,
      (index) => Math.sin((block * BLOCK_SIZE + index) * Math.PI * 2 * 220 / SAMPLE_RATE) * 0.42,
    );
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      assert.ok(Number.isFinite(rendered.left[index]));
      assert.ok(Number.isFinite(rendered.right[index]));
      assert.ok(Math.abs(rendered.left[index]) <= 0.98);
      assert.equal(rendered.left[index], rendered.right[index]);
      if (Math.abs(rendered.left[index] - rendered.input[index]) > 0.0001) changedSamples += 1;
    }
  }
  assert.ok(changedSamples > BLOCK_SIZE);
});

test("bypass converges smoothly to the dry signal instead of stopping processing", () => {
  const processor = new ProcessorConstructor();
  const bypassed = parameterBlock({ bypass: new Float32Array([1]) });
  let rendered = null;
  for (let block = 0; block < 30; block += 1) {
    rendered = renderBlock(processor, () => 0.2, bypassed);
  }
  const tail = rendered.left.slice(-16);
  for (const sample of tail) {
    assert.ok(Math.abs(sample - 0.2) < 0.002);
  }
});

test("the page exposes explicit audio, separate mic capture, truthful formats, and scripts", async () => {
  const page = await readFile(PAGE_URL, "utf8");
  assert.match(page, /id="audioButton"/);
  assert.match(page, /id="micButton"/);
  assert.match(page, /Use headphones/);
  assert.match(page, /data-format="vst3"/);
  assert.match(page, /data-format="clap" disabled/);
  assert.match(page, /data-format="audio-unit" disabled/);
  assert.match(page, /does not claim binary VST3 compatibility/);
  assert.match(page, /src="plugazoid-app\.js"/);
  assert.match(page, /assets\/instruments\/plugazoid\.webp|plugazoid\.css/);
});
