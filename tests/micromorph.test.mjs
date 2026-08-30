import assert from "node:assert/strict";
import test, { after } from "node:test";

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const MODULE_URL = new URL("../src/micromorph.js", import.meta.url);
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
  sampleRate: {
    configurable: true,
    writable: true,
    value: SAMPLE_RATE,
  },
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

const micromorph = await import(`${MODULE_URL.href}?test=${Date.now()}`);
const {
  MICROMORPH_DEFAULTS,
  MICROMORPH_MAX_MODEL_PCM_FRAMES,
  MICROMORPH_PCM_CHUNK_FRAMES,
  MICROMORPH_PRESETS,
  MICROMORPH_PROCESSOR_NAME,
  MicromorphAudio,
  micromorphStageName,
  micromorphStageWeights,
  sanitizeMicromorphParams,
} = micromorph;

after(() => {
  for (const [key, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function renderBlock(processor, sampleAtFrame = () => 0) {
  const input = new Float32Array(BLOCK_SIZE);
  const left = new Float32Array(BLOCK_SIZE);
  const right = new Float32Array(BLOCK_SIZE);
  for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
    input[frame] = sampleAtFrame(frame);
  }
  assert.equal(processor.process([[input]], [[left, right]]), true);
  return { left, right };
}

function assertFiniteBounded(samples) {
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample), "audio output must remain finite");
    assert.ok(Math.abs(sample) <= 1, "the output limiter must remain bounded");
  }
}

test("Micromorph registers one AudioWorklet processor without constructing browser audio", () => {
  assert.equal(registeredName, MICROMORPH_PROCESSOR_NAME);
  assert.equal(typeof ProcessorConstructor, "function");
  const audio = new MicromorphAudio({});
  assert.equal(audio.state.initialized, false);
  assert.equal(audio.state.enabled, false);
  assert.equal(audio.state.modelActive, false);
});

test("Micromorph parameters clamp invalid input to finite safe ranges", () => {
  assert.deepEqual(
    sanitizeMicromorphParams({
      derivation: 99,
      material: -2,
      structureLock: Number.NaN,
      memory: Infinity,
      mutation: -Infinity,
      continuation: 4,
      inputGain: 99,
      outputLevel: 10,
    }),
    {
      derivation: 1,
      material: 0,
      structureLock: MICROMORPH_DEFAULTS.structureLock,
      memory: MICROMORPH_DEFAULTS.memory,
      mutation: MICROMORPH_DEFAULTS.mutation,
      continuation: 1,
      inputGain: 4,
      outputLevel: 0.82,
    },
  );
  assert.deepEqual(sanitizeMicromorphParams(null), MICROMORPH_DEFAULTS);
  assert.ok(Object.isFrozen(sanitizeMicromorphParams({})));
});

test("the derivation control crossfades adjacent named stages", () => {
  assert.equal(micromorphStageName(0), "source");
  assert.equal(micromorphStageName(0.5), "derivation");
  assert.equal(micromorphStageName(1), "imaginary");
  assert.deepEqual(Array.from(micromorphStageWeights(0)), [1, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(micromorphStageWeights(1)), [0, 0, 0, 0, 1]);
  const between = Array.from(micromorphStageWeights(0.375));
  assert.deepEqual(between, [0, 0.5, 0.5, 0, 0]);
  assert.equal(between.reduce((sum, value) => sum + value, 0), 1);
});

test("the preset organisms are unique, bounded, and supply two conditioning anchors", () => {
  assert.ok(MICROMORPH_PRESETS.length >= 5);
  assert.equal(
    new Set(MICROMORPH_PRESETS.map(({ id }) => id)).size,
    MICROMORPH_PRESETS.length,
  );
  for (const preset of MICROMORPH_PRESETS) {
    assert.match(preset.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(preset.anchors.a.length > 0);
    assert.ok(preset.anchors.b.length > 0);
    assert.deepEqual(
      sanitizeMicromorphParams({ ...MICROMORPH_DEFAULTS, ...preset.parameters }),
      { ...MICROMORPH_DEFAULTS, ...preset.parameters },
    );
    assert.ok(Object.isFrozen(preset));
    assert.ok(Object.isFrozen(preset.anchors));
    assert.ok(Object.isFrozen(preset.parameters));
  }
});

test("the rehearsal processor is deterministic, audible, finite, stereo, and silent when inactive", () => {
  const options = {
    processorOptions: {
      parameters: {
        ...MICROMORPH_DEFAULTS,
        derivation: 0.82,
        mutation: 0.4,
      },
    },
  };
  const first = new ProcessorConstructor(options);
  const second = new ProcessorConstructor(options);
  first.port.onmessage({ data: { type: "active", value: true } });
  second.port.onmessage({ data: { type: "active", value: true } });

  let audibleSquareSum = 0;
  let stereoDifference = 0;
  for (let block = 0; block < 64; block += 1) {
    const firstRendered = renderBlock(first, (frame) => (
      Math.sin((block * BLOCK_SIZE + frame) * Math.PI * 2 * 170 / SAMPLE_RATE) * 0.3
    ));
    const secondRendered = renderBlock(second, (frame) => (
      Math.sin((block * BLOCK_SIZE + frame) * Math.PI * 2 * 170 / SAMPLE_RATE) * 0.3
    ));
    assertFiniteBounded(firstRendered.left);
    assertFiniteBounded(firstRendered.right);
    assert.deepEqual(firstRendered.left, secondRendered.left);
    assert.deepEqual(firstRendered.right, secondRendered.right);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      audibleSquareSum += firstRendered.left[frame] ** 2 + firstRendered.right[frame] ** 2;
      stereoDifference += Math.abs(firstRendered.left[frame] - firstRendered.right[frame]);
    }
  }
  assert.ok(audibleSquareSum > 0.01);
  assert.ok(stereoDifference > 0.001);

  first.port.onmessage({ data: { type: "active", value: false } });
  const silent = renderBlock(first, () => 0.5);
  assert.equal(silent.left.every((sample) => sample === 0), true);
  assert.equal(silent.right.every((sample) => sample === 0), true);
});

test("model mode exports bounded mic chunks and consumes returned stereo PCM", () => {
  const processor = new ProcessorConstructor({
    processorOptions: { parameters: { ...MICROMORPH_DEFAULTS, derivation: 1 } },
  });
  processor.port.onmessage({ data: { type: "active", value: true } });
  processor.port.onmessage({ data: { type: "model-active", value: true } });

  for (let block = 0; block < MICROMORPH_PCM_CHUNK_FRAMES / BLOCK_SIZE; block += 1) {
    renderBlock(processor, () => 0.1);
  }
  const inputFrame = processor.port.messages.find(({ type }) => type === "input-pcm");
  assert.ok(inputFrame);
  assert.equal(inputFrame.channels, 1);
  assert.equal(inputFrame.sampleRate, SAMPLE_RATE);
  assert.equal(inputFrame.frames, MICROMORPH_PCM_CHUNK_FRAMES);
  assert.equal(new Float32Array(inputFrame.samples).length, MICROMORPH_PCM_CHUNK_FRAMES);

  const returned = new Float32Array(MICROMORPH_PCM_CHUNK_FRAMES * 2);
  for (let frame = 0; frame < MICROMORPH_PCM_CHUNK_FRAMES; frame += 1) {
    returned[frame * 2] = 0.25;
    returned[frame * 2 + 1] = -0.2;
  }
  processor.port.onmessage({
    data: { type: "model-pcm", channels: 2, samples: returned.buffer },
  });
  const transition = renderBlock(processor, () => 0);
  const rendered = renderBlock(processor, () => 0);
  renderBlock(processor, () => 0);
  assertFiniteBounded(rendered.left);
  assertFiniteBounded(rendered.right);
  assert.ok(Math.abs(transition.left[0]) < Math.abs(rendered.left.at(-1)));
  assert.ok(rendered.left.at(-1) > 0);
  assert.ok(rendered.right.at(-1) < 0);
  assert.equal(processor.modelMix, 1);
  assert.equal(processor.modelPcmActive, true);
  assert.equal(processor.modelFallbackActive, false);
  assert.equal(processor.renderedModelFrames, BLOCK_SIZE * 3);
});

test("model starvation counts episodes rather than every missing sample", () => {
  const processor = new ProcessorConstructor({
    processorOptions: { parameters: { ...MICROMORPH_DEFAULTS, derivation: 1 } },
  });
  processor.port.onmessage({ data: { type: "active", value: true } });
  processor.port.onmessage({ data: { type: "model-active", value: true } });

  renderBlock(processor, () => 0.1);
  renderBlock(processor, () => 0.1);
  assert.equal(processor.modelUnderflows, 1);

  const returned = new Float32Array(BLOCK_SIZE * 2);
  returned.fill(0.1);
  processor.port.onmessage({
    data: { type: "model-pcm", channels: 2, samples: returned.buffer },
  });
  renderBlock(processor, () => 0.1);
  renderBlock(processor, () => 0.1);
  assert.equal(processor.modelUnderflows, 2);

  processor.port.onmessage({ data: { type: "active", value: false } });
  processor.port.onmessage({ data: { type: "model-active", value: true } });
  renderBlock(processor, () => 0);
  assert.equal(processor.modelUnderflows, 0, "inactive renderers do not consume model PCM");
});

test("stable model playback skips rehearsal DSP and crossfades safely back on starvation", () => {
  const processor = new ProcessorConstructor({
    processorOptions: { parameters: { ...MICROMORPH_DEFAULTS, derivation: 1 } },
  });
  processor.port.onmessage({ data: { type: "active", value: true } });
  processor.port.onmessage({ data: { type: "model-active", value: true } });

  const modelPcm = new Float32Array(MICROMORPH_PCM_CHUNK_FRAMES * 2);
  for (let frame = 0; frame < MICROMORPH_PCM_CHUNK_FRAMES; frame += 1) {
    modelPcm[frame * 2] = 0.34;
    modelPcm[frame * 2 + 1] = -0.28;
  }
  processor.port.onmessage({
    data: { type: "model-pcm", channels: 2, samples: modelPcm.buffer },
  });

  const rehearsalFrame = processor.rehearsalFrame.bind(processor);
  let rehearsalCalls = 0;
  processor.rehearsalFrame = (input) => {
    rehearsalCalls += 1;
    rehearsalFrame(input);
  };

  let previous = renderBlock(processor, () => 0);
  previous = renderBlock(processor, () => 0);
  previous = renderBlock(processor, () => 0);
  assert.equal(processor.modelMix, 1);
  assert.ok(rehearsalCalls > 0, "the short model-entry transition renders both paths");

  rehearsalCalls = 0;
  previous = renderBlock(processor, () => 0);
  assert.equal(rehearsalCalls, 0, "stable model PCM bypasses the rehearsal renderer");
  assert.equal(processor.modelPcmActive, true);
  assert.equal(processor.modelFallbackActive, false);

  for (let block = 0; block < 4; block += 1) {
    previous = renderBlock(processor, () => 0);
  }
  const lastModelLeft = previous.left.at(-1);
  const firstFallback = renderBlock(processor, () => 0);
  assert.ok(
    Math.abs(firstFallback.left[0] - lastModelLeft) < 0.02,
    "starvation fades from the held model edge instead of hard-switching",
  );
  renderBlock(processor, () => 0);
  renderBlock(processor, () => 0);
  assert.equal(processor.modelMix, 0);
  assert.equal(processor.modelPcmActive, false);
  assert.equal(processor.modelFallbackActive, true);
  assert.equal(processor.renderedModelFrames, MICROMORPH_PCM_CHUNK_FRAMES);

  processor.publishTelemetry();
  const telemetry = processor.port.messages.filter(({ type }) => type === "telemetry").at(-1);
  assert.equal(telemetry.modelPcmActive, false);
  assert.equal(telemetry.modelFallbackActive, true);
  assert.equal(telemetry.modelTransitionMix, 0);
  assert.equal(telemetry.renderedModelFrames, MICROMORPH_PCM_CHUNK_FRAMES);
});

test("inactive rendering performs no rehearsal, capture, or model consumption", () => {
  const processor = new ProcessorConstructor();
  let rehearsalCalls = 0;
  processor.rehearsalFrame = () => {
    rehearsalCalls += 1;
  };
  processor.port.onmessage({ data: { type: "model-active", value: true } });
  const modelPcm = new Float32Array(BLOCK_SIZE * 2);
  modelPcm.fill(0.2);
  processor.port.onmessage({
    data: { type: "model-pcm", channels: 2, samples: modelPcm.buffer },
  });
  const available = processor.modelAvailable;
  const rendered = renderBlock(processor, () => 0.5);
  assert.equal(rehearsalCalls, 0);
  assert.equal(processor.inputChunkIndex, 0);
  assert.equal(processor.modelAvailable, available);
  assert.equal(rendered.left.every((sample) => sample === 0), true);
  assert.equal(rendered.right.every((sample) => sample === 0), true);
});

test("model PCM is stereo-only and bounded by the negotiated safe block", () => {
  const processor = new ProcessorConstructor();
  processor.port.onmessage({
    data: { type: "model-config", channels: 2, blockSize: BLOCK_SIZE },
  });
  processor.port.onmessage({
    data: {
      type: "model-pcm",
      channels: 1,
      samples: new Float32Array(BLOCK_SIZE).buffer,
    },
  });
  processor.port.onmessage({
    data: {
      type: "model-pcm",
      channels: 2,
      samples: new Float32Array((BLOCK_SIZE + 1) * 2).buffer,
    },
  });
  assert.equal(processor.modelAvailable, 0);
  assert.equal(processor.modelRejectedBlocks, 2);

  processor.port.onmessage({
    data: {
      type: "model-pcm",
      channels: 2,
      samples: new Float32Array(BLOCK_SIZE * 2).buffer,
    },
  });
  assert.equal(processor.modelAvailable, BLOCK_SIZE * 2);

  const sent = [];
  const audio = new MicromorphAudio({});
  audio.node = { port: { postMessage: (message) => sent.push(message) } };
  audio.setModelActive(true);
  audio.setModelActive(true);
  audio.setModelActive(false);
  audio.setModelActive(false);
  assert.equal(sent.filter(({ type }) => type === "model-active").length, 2);
  assert.deepEqual(audio.configureModelPcm({ channels: 2, blockSize: BLOCK_SIZE }), {
    channels: 2,
    blockSize: BLOCK_SIZE,
  });
  assert.throws(
    () => audio.configureModelPcm({ channels: 1, blockSize: BLOCK_SIZE }),
    /stereo/i,
  );
  assert.throws(
    () => audio.configureModelPcm({
      channels: 2,
      blockSize: MICROMORPH_MAX_MODEL_PCM_FRAMES + 1,
    }),
    /1 to/,
  );
  assert.equal(
    audio.enqueueModelPcm(new Float32Array((BLOCK_SIZE + 1) * 2), { channels: 2 }),
    false,
  );
  assert.equal(
    audio.enqueueModelPcm(new Float32Array(BLOCK_SIZE), { channels: 1 }),
    false,
  );
  assert.equal(
    audio.enqueueModelPcm(new Float32Array(BLOCK_SIZE * 2), { channels: 2 }),
    true,
  );
  assert.equal(sent.filter(({ type }) => type === "model-pcm").length, 1);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
  }

  cancelScheduledValues() {}

  setValueAtTime(value) {
    this.value = value;
  }

  linearRampToValueAtTime(value) {
    this.value = value;
  }

  setTargetAtTime(value) {
    this.value = value;
  }
}

class FakeAudioNode {
  constructor() {
    this.connections = [];
    this.disconnectCalls = 0;
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.disconnectCalls += 1;
  }
}

function fakeStream() {
  const track = {
    stopCalls: 0,
    stop() {
      this.stopCalls += 1;
    },
  };
  return {
    track,
    getTracks() {
      return [track];
    },
  };
}

function createAudioRuntime({ getUserMedia, moduleGate = null, failResumeAt = 0 } = {}) {
  const contexts = [];
  const workletNodes = [];
  const timers = new Map();
  let timerSequence = 0;

  class FakeAudioContext {
    constructor(options) {
      this.options = options;
      this.sampleRate = options.sampleRate;
      this.currentTime = 0;
      this.state = "suspended";
      this.resumeCalls = 0;
      this.suspendCalls = 0;
      this.closeCalls = 0;
      this.destination = new FakeAudioNode();
      this.audioWorklet = {
        addModule: async () => {
          if (moduleGate) await moduleGate.promise;
        },
      };
      contexts.push(this);
    }

    async resume() {
      this.resumeCalls += 1;
      if (failResumeAt && this.resumeCalls === failResumeAt) {
        throw new Error("resume failed");
      }
      this.state = "running";
    }

    async suspend() {
      this.suspendCalls += 1;
      if (this.state !== "closed") this.state = "suspended";
    }

    async close() {
      this.closeCalls += 1;
      this.state = "closed";
    }

    createAnalyser() {
      const node = new FakeAudioNode();
      node.fftSize = 1_024;
      node.getFloatTimeDomainData = (target) => target.fill(0);
      return node;
    }

    createWaveShaper() {
      return new FakeAudioNode();
    }

    createGain() {
      const node = new FakeAudioNode();
      node.gain = new FakeAudioParam();
      return node;
    }

    createMediaStreamSource(stream) {
      const node = new FakeAudioNode();
      node.stream = stream;
      return node;
    }

    createBuffer() {
      return {};
    }

    createBufferSource() {
      const node = new FakeAudioNode();
      node.start = () => {};
      return node;
    }
  }

  class FakeAudioWorkletNode extends FakeAudioNode {
    constructor(context, name, options) {
      super();
      this.context = context;
      this.name = name;
      this.options = options;
      this.port = {
        messages: [],
        onmessage: null,
        postMessage: (message) => this.port.messages.push(message),
      };
      workletNodes.push(this);
    }
  }

  const runtime = {
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    navigator: {
      mediaDevices: {
        getUserMedia: getUserMedia ?? (() => Promise.resolve(fakeStream())),
      },
    },
    setTimeout(callback) {
      timerSequence += 1;
      timers.set(timerSequence, callback);
      return timerSequence;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  return {
    runtime,
    contexts,
    workletNodes,
    flushTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
  };
}

test("Audio initialization is shared across concurrent callers and closes cleanly", async () => {
  const harness = createAudioRuntime();
  const audio = new MicromorphAudio(harness.runtime);
  const first = audio.initialize();
  const second = audio.initialize();
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(harness.contexts.length, 1);
  assert.equal(harness.workletNodes.length, 1);
  assert.equal(audio.state.initialized, true);
  assert.deepEqual(audio.state.modelPcmConfig, {
    channels: 2,
    blockSize: MICROMORPH_PCM_CHUNK_FRAMES,
  });
  await audio.close();
  assert.equal(harness.contexts[0].state, "closed");
  assert.equal(audio.state.initialized, false);
});

test("stop cancels delayed microphone permission and stops the eventual granted track", async () => {
  const permission = deferred();
  const requested = deferred();
  const stream = fakeStream();
  const harness = createAudioRuntime({
    getUserMedia: () => {
      requested.resolve();
      return permission.promise;
    },
  });
  const audio = new MicromorphAudio(harness.runtime);
  const starting = audio.start();
  const rejectedStart = assert.rejects(starting, /cancelled/i);
  await requested.promise;
  assert.equal(audio.state.starting, true);
  const stopping = audio.stop();
  permission.resolve(stream);
  await rejectedStart;
  await stopping;
  harness.flushTimers();
  assert.equal(stream.track.stopCalls, 1);
  assert.equal(audio.state.starting, false);
  assert.equal(audio.state.enabled, false);
  assert.equal(harness.contexts[0].state, "suspended");
  await audio.close();
});

test("close during delayed permission stops the granted track and cannot resurrect audio", async () => {
  const permission = deferred();
  const requested = deferred();
  const stream = fakeStream();
  const harness = createAudioRuntime({
    getUserMedia: () => {
      requested.resolve();
      return permission.promise;
    },
  });
  const audio = new MicromorphAudio(harness.runtime);
  const starting = audio.start();
  const rejectedStart = assert.rejects(starting, /cancelled|closed/i);
  await requested.promise;
  const closing = audio.close();
  permission.resolve(stream);
  await rejectedStart;
  await closing;
  assert.equal(stream.track.stopCalls, 1);
  assert.equal(audio.state.starting, false);
  assert.equal(audio.state.enabled, false);
  assert.equal(audio.state.initialized, false);
  assert.equal(harness.contexts[0].state, "closed");
});

test("a post-permission startup failure always stops the granted microphone", async () => {
  const stream = fakeStream();
  const harness = createAudioRuntime({
    getUserMedia: () => Promise.resolve(stream),
    failResumeAt: 2,
  });
  const audio = new MicromorphAudio(harness.runtime);
  await assert.rejects(audio.start(), /resume failed/);
  assert.equal(stream.track.stopCalls, 1);
  assert.equal(audio.state.enabled, false);
  assert.equal(audio.state.starting, false);
  await audio.close();
});

test("close invalidates an initialization that has not committed its graph", async () => {
  const moduleGate = deferred();
  const harness = createAudioRuntime({ moduleGate });
  const audio = new MicromorphAudio(harness.runtime);
  const initializing = audio.initialize();
  const rejectedInitialization = assert.rejects(initializing, /cancelled/i);
  await Promise.resolve();
  const closing = audio.close();
  moduleGate.resolve();
  await rejectedInitialization;
  await closing;
  assert.equal(harness.contexts.length, 1);
  assert.equal(harness.contexts[0].state, "closed");
  assert.equal(audio.state.initialized, false);
});
