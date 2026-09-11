import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  SIMD_SYNTH_DEFAULTS,
  SimdSynthAudio,
  createSimdSynthConfiguration,
} from "../src/simd-synth.js";

const root = new URL("../", import.meta.url);
const processorUrl = new URL("src/simd-synth-processor.js", root);
const scalarUrl = new URL("assets/wasm/simd-synth-scalar.wasm", root);
const simdUrl = new URL("assets/wasm/simd-synth-simd.wasm", root);

const wasmAssetsReady = await Promise.all([scalarUrl, simdUrl].map(async (url) => {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
})).then((results) => results.every(Boolean));

const wasmTest = (name, callback) => test(name, {
  skip: wasmAssetsReady ? false : "SIMD SYNTH Wasm assets have not been built yet",
}, callback);

async function arrayBuffer(url) {
  const bytes = await readFile(url);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function loadProcessor() {
  const source = await readFile(processorUrl, "utf8");
  let Processor = null;
  class MockAudioWorkletProcessor {
    constructor() {
      const messages = [];
      this.port = {
        messages,
        onmessage: null,
        postMessage(message) { messages.push(message); },
      };
    }
  }
  const context = vm.createContext({
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    WebAssembly,
    sampleRate: 48_000,
    performance: { now: () => 0 },
    registerProcessor(_name, constructor) { Processor = constructor; },
  });
  vm.runInContext(source, context, { filename: processorUrl.pathname });
  return Processor;
}

function audioOutput() {
  return [[new Float32Array(128), new Float32Array(128)]];
}

function edgePatch(overrides = {}) {
  return createSimdSynthConfiguration({
    params: {
      ...SIMD_SYNTH_DEFAULTS,
      sourceA: 0,
      sourceB: 0,
      combineMix: 0,
      filter1: 0,
      filter2: 0,
      attack: 0.002,
      decay: 0.03,
      sustain: 0.8,
      release: 0.08,
      fx1: 0,
      fx2: 0,
      bpm: 30,
      ...overrides,
    },
    sequence: Array.from({ length: 16 }, () => [0, 1, 1, 0]),
    modRoutes: Array.from({ length: 4 }, () => [0, 0, 0, 0]),
  });
}

test("processor keeps raw configuration arrays inside safe Wasm numeric bounds", async () => {
  const Processor = await loadProcessor();
  const processor = new Processor();
  processor.stageConfiguration({
    paramArray: Array.from({ length: 51 }, (_, index) => index & 1 ? -1e300 : 1e300),
    sequenceArray: Array(16 * 4).fill(1e300),
    modRouteArray: Array(4 * 4).fill(-1e300),
  });

  for (const values of [processor.stagedParams, processor.stagedSequence, processor.stagedModRoutes]) {
    assert.equal([...values].every((value) => Number.isFinite(value) && Math.abs(value) <= 1_000_000), true);
  }
});

wasmTest("processor bounds enormous transport time before rendering the real kernels", async () => {
  const Processor = await loadProcessor();
  const processor = new Processor();
  processor.install({
    scalarBytes: await arrayBuffer(scalarUrl),
    simdBytes: await arrayBuffer(simdUrl),
    requestedBackend: "simd",
    configuration: edgePatch(),
    transportEnabled: true,
    sequenceTime: 1e300,
  });

  let peak = 0;
  for (let block = 0; block < 12; block += 1) {
    const output = audioOutput();
    assert.equal(processor.process([], output), true);
    for (const channel of output[0]) {
      for (const sample of channel) {
        assert.equal(Number.isFinite(sample), true);
        peak = Math.max(peak, Math.abs(sample));
      }
    }
  }

  assert.equal(processor.ready, true);
  assert.equal(processor.sequenceTime, 1_000_000);
  assert.ok(peak > 0.0001, "bounded transport input still renders audio");
  assert.equal(processor.port.messages.some(({ type }) => type === "error"), false);
});

wasmTest("backend changes cleanly restart and replay held notes with a fade", async () => {
  const Processor = await loadProcessor();
  const processor = new Processor();
  const configuration = edgePatch({ cutoff1: 1234 });
  processor.install({
    scalarBytes: await arrayBuffer(scalarUrl),
    simdBytes: await arrayBuffer(simdUrl),
    requestedBackend: "simd",
    configuration,
    transportEnabled: false,
    sequenceTime: 3.5,
  });
  processor.handleMessage({ type: "note-on", note: 60, velocity: 0.76 });
  processor.process([], audioOutput());

  // A partial voice-array copy would carry this invalid inactive-kernel state
  // into the newly selected backend. A clean restart must discard it.
  processor.kernels.scalar.voiceEnvelope.fill(Number.NaN);
  processor.handleMessage({ type: "backend", backend: "scalar" });
  const switchedOutput = audioOutput();
  processor.process([], switchedOutput);

  assert.equal(processor.backend, "scalar");
  assert.equal(processor.transportEnabled, false);
  assert.equal(processor.sequenceTime, Math.fround(3.5));
  assert.equal(processor.kernel.params[17], Math.fround(1234));
  assert.equal([...processor.kernel.voiceEnvelope].every(Number.isFinite), true);
  assert.equal([...processor.kernel.voiceNote].some((note, index) => (
    Math.abs(note - 60) < 0.01 && processor.kernel.voiceGate[index] > 0.5
  )), true, "held manual note was replayed");
  assert.equal(processor.backendFadeRemaining, 128);
  assert.equal(switchedOutput[0].flatMap((channel) => [...channel]).every(Number.isFinite), true);
});

function createAudioRuntime(scalarBytes, onInstall) {
  const runtime = {
    WebAssembly,
    location: { href: "https://example.test/simd-synth.html" },
    contexts: [],
    nodes: [],
    setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 50)),
    clearTimeout,
    fetch: async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => scalarBytes.slice(0),
    }),
  };

  class MockAudioContext {
    constructor() {
      this.state = "running";
      this.currentTime = 0;
      this.closed = false;
      this.audioWorklet = { addModule: async () => {} };
      runtime.contexts.push(this);
    }

    createGain() {
      return {
        gain: { value: 0, setTargetAtTime(value) { this.value = value; } },
        connect() {},
        disconnect() {},
      };
    }

    createAnalyser() {
      return {
        fftSize: 0,
        smoothingTimeConstant: 0,
        connect() {},
        disconnect() {},
        getFloatTimeDomainData(target) { target.fill(0); },
      };
    }

    async close() {
      this.closed = true;
      this.state = "closed";
    }
  }
  MockAudioContext.prototype.audioWorklet = null;

  class MockAudioWorkletNode {
    constructor() {
      this.disconnected = false;
      this.sent = [];
      this.port = {
        onmessage: null,
        postMessage: (message) => {
          this.sent.push(message);
          if (message.type === "install") onInstall(this.port);
        },
      };
      runtime.nodes.push(this);
    }

    connect() {}
    disconnect() { this.disconnected = true; }
    addEventListener() {}
  }

  runtime.AudioContext = MockAudioContext;
  runtime.AudioWorkletNode = MockAudioWorkletNode;
  return runtime;
}

wasmTest("host retains telemetry time for default transport messages", async () => {
  const scalarBytes = await arrayBuffer(scalarUrl);
  const runtime = createAudioRuntime(scalarBytes, (port) => {
    port.onmessage({ data: {
      type: "ready", backend: "scalar", laneWidth: 1, simdAvailable: false,
    } });
    port.onmessage({ data: {
      type: "telemetry", kernelMicros: 7, budgetMicros: 2666, sequenceTime: 42.25,
    } });
  });
  const audio = new SimdSynthAudio(runtime);
  await audio.start(edgePatch(), { forceScalar: true, destination: {} });

  assert.equal(audio.sequenceTime, Math.fround(42.25));
  audio.setTransport(false);
  assert.deepEqual(runtime.nodes[0].sent.at(-1), {
    type: "transport", enabled: false, sequenceTime: Math.fround(42.25),
  });
  await audio.stop();
});

wasmTest("host rejects install errors immediately and cleans partial audio state", async () => {
  const scalarBytes = await arrayBuffer(scalarUrl);
  const runtime = createAudioRuntime(scalarBytes, (port) => {
    port.onmessage({ data: { type: "error", message: "kernel install exploded" } });
  });
  const audio = new SimdSynthAudio(runtime);
  let reported = null;
  audio.setErrorHandler((error) => { reported = error; });

  await assert.rejects(
    audio.start(edgePatch(), { forceScalar: true, destination: {} }),
    /kernel install exploded/,
  );
  assert.match(reported?.message ?? "", /kernel install exploded/);
  assert.equal(audio.context, null);
  assert.equal(audio.node, null);
  assert.equal(runtime.contexts[0].closed, true);
  assert.equal(runtime.nodes[0].disconnected, true);
  assert.equal(runtime.nodes[0].sent.at(-1).type, "dispose");
});
