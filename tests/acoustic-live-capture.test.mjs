import assert from "node:assert/strict";
import test from "node:test";
import {
  ACOUSTIC_CAPTURE_ERROR_CODES,
  ACOUSTIC_LIVE_CAPTURE_LIMITS,
  AcousticCaptureError,
  AcousticLiveCapture,
  normalizeCaptureDuration,
} from "../src/acoustic-live-capture.js";

class FakeTrack {
  constructor() {
    this.listeners = new Map();
    this.stopCalls = 0;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  stop() {
    this.stopCalls += 1;
  }

  end() {
    this.listeners.get("ended")?.();
  }
}

class FakeNode {
  constructor(name) {
    this.name = name;
    this.connections = [];
    this.disconnectCalls = 0;
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.disconnectCalls += 1;
  }
}

class FakeProcessorNode extends FakeNode {
  constructor() {
    super("processor");
    this.onaudioprocess = null;
  }

  emit(samples) {
    this.onaudioprocess?.({
      inputBuffer: {
        getChannelData(channel) {
          assert.equal(channel, 0);
          return samples;
        },
      },
    });
  }

  emitInvalid() {
    this.onaudioprocess?.({ inputBuffer: {} });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function makeHarness({
  getUserMedia,
  onResume,
  sampleRate = 8,
  supportProcessor = true,
  suspended = false,
} = {}) {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track] };
  const calls = {
    clearTimeout: [],
    getUserMedia: [],
    setTimeout: [],
  };
  const contexts = [];

  class FakeAudioContext {
    constructor() {
      this.sampleRate = sampleRate;
      this.state = suspended ? "suspended" : "running";
      this.destination = new FakeNode("destination");
      this.source = new FakeNode("source");
      this.processor = new FakeProcessorNode();
      this.mute = new FakeNode("mute");
      this.mute.gain = { value: 1 };
      this.closeCalls = 0;
      this.resumeCalls = 0;
      contexts.push(this);
    }

    createMediaStreamSource(receivedStream) {
      assert.equal(receivedStream, stream);
      return this.source;
    }

    createScriptProcessor(bufferSize, inputChannels, outputChannels) {
      if (!supportProcessor) return undefined;
      assert.equal(bufferSize, ACOUSTIC_LIVE_CAPTURE_LIMITS.bufferSize);
      assert.equal(inputChannels, 1);
      assert.equal(outputChannels, 1);
      return this.processor;
    }

    createGain() {
      return this.mute;
    }

    async resume() {
      this.resumeCalls += 1;
      onResume?.({ context: this, track });
      this.state = "running";
    }

    async close() {
      this.closeCalls += 1;
      this.state = "closed";
    }
  }

  if (!supportProcessor) {
    FakeAudioContext.prototype.createScriptProcessor = undefined;
  }

  const navigatorRef = {
    mediaDevices: {
      async getUserMedia(constraints) {
        calls.getUserMedia.push(constraints);
        return getUserMedia ? getUserMedia({ constraints, stream, track }) : stream;
      },
    },
  };
  const timers = [];
  const setTimeoutFn = (callback, milliseconds) => {
    const timer = { callback, milliseconds };
    timers.push(timer);
    calls.setTimeout.push(milliseconds);
    return timer;
  };
  const clearTimeoutFn = (timer) => {
    calls.clearTimeout.push(timer);
  };

  return {
    AudioContextClass: FakeAudioContext,
    calls,
    contexts,
    navigatorRef,
    stream,
    timers,
    track,
    options: {
      AudioContextClass: FakeAudioContext,
      clearTimeoutFn,
      locationRef: { hostname: "localhost", protocol: "http:" },
      navigatorRef,
      queueMicrotaskFn: (callback) => callback(),
      secureContext: true,
      setTimeoutFn,
    },
  };
}

test("capture duration is bounded to the documented 1–30 second window", () => {
  assert.equal(normalizeCaptureDuration(0), 1);
  assert.equal(normalizeCaptureDuration(4.25), 4.25);
  assert.equal(normalizeCaptureDuration(90), 30);
  assert.equal(normalizeCaptureDuration("unknown"), 12);
});

test("construction does not request microphone permission", () => {
  const harness = makeHarness();
  const capture = new AcousticLiveCapture(harness.options);

  assert.equal(capture.state, "idle");
  assert.equal(capture.isRecording, false);
  assert.equal(harness.calls.getUserMedia.length, 0);
  assert.equal(harness.contexts.length, 0);
});

test("start requests raw mono input and capture auto-stops at the exact PCM bound", async () => {
  const harness = makeHarness({ sampleRate: 4, suspended: true });
  const levels = [];
  const progress = [];
  const capture = new AcousticLiveCapture({
    ...harness.options,
    maxDurationSeconds: 0,
    onLevel: (level) => levels.push(level),
    onProgress: (value) => progress.push(value),
  });

  await capture.start();
  assert.equal(capture.isRecording, true);
  assert.deepEqual(harness.calls.getUserMedia, [{
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  }]);
  assert.deepEqual(harness.calls.setTimeout, [1000]);

  const context = harness.contexts[0];
  assert.equal(context.resumeCalls, 1);
  assert.equal(context.mute.gain.value, 0);
  assert.deepEqual(context.source.connections, [context.processor]);
  assert.deepEqual(context.processor.connections, [context.mute]);
  assert.deepEqual(context.mute.connections, [context.destination]);

  const firstInput = new Float32Array([0.1, -0.8]);
  context.processor.emit(firstInput);
  firstInput.fill(0, 0, firstInput.length);
  context.processor.emit(new Float32Array([0.3, -0.4, 0.9]));
  const result = await capture.finished;

  assert.deepEqual([...result.samples], [
    Math.fround(0.1),
    Math.fround(-0.8),
    Math.fround(0.3),
    Math.fround(-0.4),
  ]);
  assert.equal(result.sampleRate, 4);
  assert.equal(result.duration, 1);
  assert.deepEqual(levels, [0, Math.fround(0.8), Math.fround(0.4)]);
  assert.deepEqual(progress.map((value) => value.progress), [0, 0.5, 1]);
  assert.equal(capture.isRecording, false);
  assert.equal(harness.track.stopCalls, 1);
  assert.equal(context.source.disconnectCalls, 1);
  assert.equal(context.processor.disconnectCalls, 1);
  assert.equal(context.mute.disconnectCalls, 1);
  assert.equal(context.closeCalls, 1);
  assert.equal(context.processor.onaudioprocess, null);
  assert.equal(harness.calls.clearTimeout.length, 1);
});

test("manual stop concatenates uncompressed Float32 chunks and returns their duration", async () => {
  const harness = makeHarness({ sampleRate: 10 });
  const capture = new AcousticLiveCapture({ ...harness.options, maxDurationSeconds: 3 });
  await capture.start();

  harness.contexts[0].processor.emit(new Float32Array([0.25, -0.5]));
  harness.contexts[0].processor.emit(new Float32Array([0.75]));
  const result = await capture.stop();

  assert.ok(result.samples instanceof Float32Array);
  assert.deepEqual([...result.samples], [0.25, -0.5, 0.75]);
  assert.equal(result.sampleRate, 10);
  assert.equal(result.duration, 0.3);
  assert.equal(await capture.finished, result);
});

test("a selected non-default microphone uses an exact device constraint", async () => {
  const harness = makeHarness();
  const capture = new AcousticLiveCapture(harness.options);

  await capture.start({ deviceId: "  field-mic-2  " });
  assert.deepEqual(harness.calls.getUserMedia[0].audio.deviceId, { exact: "field-mic-2" });
  await capture.cancel();

  const defaultHarness = makeHarness();
  const defaultCapture = new AcousticLiveCapture(defaultHarness.options);
  await defaultCapture.start({ deviceId: "default" });
  assert.equal("deviceId" in defaultHarness.calls.getUserMedia[0].audio, false);
  await defaultCapture.cancel();
});

test("the wall-clock duration timer also stops and releases an empty capture", async () => {
  const harness = makeHarness();
  const capture = new AcousticLiveCapture({ ...harness.options, maxDurationSeconds: 99 });
  await capture.start();

  assert.deepEqual(harness.calls.setTimeout, [30_000]);
  harness.timers[0].callback();
  const result = await capture.finished;

  assert.equal(result.samples.length, 0);
  assert.equal(result.duration, 0);
  assert.equal(harness.track.stopCalls, 1);
  assert.equal(harness.contexts[0].closeCalls, 1);
});

test("a track ending while the audio context resumes cannot leave an empty live session", async () => {
  const harness = makeHarness({
    suspended: true,
    onResume: ({ track }) => track.end(),
  });
  const capture = new AcousticLiveCapture(harness.options);

  await assert.rejects(
    capture.start(),
    (error) => error instanceof AcousticCaptureError
      && error.code === ACOUSTIC_CAPTURE_ERROR_CODES.noInputDevice
      && /stopped before capture/i.test(error.message),
  );
  await assert.rejects(capture.finished, /stopped before capture/i);
  assert.equal(capture.state, "idle");
  assert.equal(harness.track.stopCalls, 1);
  assert.equal(harness.contexts[0].closeCalls, 1);
});

test("cancel resolves without audio and still releases every active resource", async () => {
  const harness = makeHarness();
  const capture = new AcousticLiveCapture(harness.options);
  await capture.start();
  const finished = capture.finished;

  assert.equal(await capture.cancel(), null);
  assert.equal(await finished, null);
  assert.equal(capture.state, "idle");
  assert.equal(harness.track.stopCalls, 1);
  assert.equal(harness.contexts[0].closeCalls, 1);
  assert.equal(harness.contexts[0].processor.onaudioprocess, null);
});

test("cancel while permission is pending rejects start and stops a late stream", async () => {
  const permission = deferred();
  const harness = makeHarness({ getUserMedia: () => permission.promise });
  const capture = new AcousticLiveCapture(harness.options);
  const starting = capture.start();
  const finished = capture.finished;

  assert.equal(capture.state, "starting");
  await capture.cancel();
  assert.equal(await finished, null);
  permission.resolve(harness.stream);

  await assert.rejects(starting, (error) => (
    error.name === "AbortError"
      && error.code === ACOUSTIC_CAPTURE_ERROR_CODES.cancelled
  ));
  assert.equal(harness.track.stopCalls, 1);
  assert.equal(harness.contexts.length, 0);
});

test("insecure and unavailable environments fail clearly before requesting access", async () => {
  let requests = 0;
  const navigatorRef = {
    mediaDevices: {
      getUserMedia() {
        requests += 1;
      },
    },
  };
  const insecure = new AcousticLiveCapture({
    AudioContextClass: class {},
    locationRef: { hostname: "example.test", protocol: "http:" },
    navigatorRef,
    secureContext: false,
  });

  await assert.rejects(
    insecure.start(),
    (error) => error instanceof AcousticCaptureError
      && error.code === ACOUSTIC_CAPTURE_ERROR_CODES.insecureContext
      && /HTTPS or localhost/.test(error.message),
  );
  assert.equal(requests, 0);

  const unavailable = new AcousticLiveCapture({
    AudioContextClass: class {},
    navigatorRef: {},
    secureContext: true,
  });
  await assert.rejects(
    unavailable.start(),
    (error) => error.code === ACOUSTIC_CAPTURE_ERROR_CODES.unavailable
      && /not available/.test(error.message),
  );
});

test("permission failures have a specific public error", async () => {
  const permissionError = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
  const harness = makeHarness({ getUserMedia: () => Promise.reject(permissionError) });
  const capture = new AcousticLiveCapture(harness.options);

  await assert.rejects(
    capture.start(),
    (error) => error.code === ACOUSTIC_CAPTURE_ERROR_CODES.permissionDenied
      && /permission was denied/.test(error.message)
      && error.cause === permissionError,
  );
  await assert.rejects(capture.finished, { code: ACOUSTIC_CAPTURE_ERROR_CODES.permissionDenied });
  assert.equal(capture.state, "idle");
  assert.equal(harness.contexts.length, 0);
});

test("unsupported PCM setup stops tracks and closes the partially-created context", async () => {
  const harness = makeHarness({ supportProcessor: false });
  const capture = new AcousticLiveCapture(harness.options);

  await assert.rejects(
    capture.start(),
    (error) => error.code === ACOUSTIC_CAPTURE_ERROR_CODES.unsupportedPcm,
  );
  assert.equal(harness.track.stopCalls, 1);
  assert.equal(harness.contexts[0].closeCalls, 1);
  assert.equal(capture.state, "idle");
});

test("invalid PCM events reject finished and clean up the microphone session", async () => {
  const harness = makeHarness();
  const capture = new AcousticLiveCapture(harness.options);
  await capture.start();

  harness.contexts[0].processor.emitInvalid();
  await assert.rejects(
    capture.finished,
    (error) => error.code === ACOUSTIC_CAPTURE_ERROR_CODES.processingFailed,
  );
  assert.equal(harness.track.stopCalls, 1);
  assert.equal(harness.contexts[0].closeCalls, 1);
  assert.equal(capture.state, "idle");
});
