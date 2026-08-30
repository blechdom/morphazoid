import assert from "node:assert/strict";
import test from "node:test";

import {
  MICROMORPH_MODEL_CLIENT_STATES,
  MICROMORPH_MODEL_PROTOCOL,
  MicromorphModelClient,
  MicromorphModelClientError,
  decodeMicromorphPcmPacket,
  encodeMicromorphPcmPacket,
  normalizeMicromorphConfig,
  normalizeMicromorphCondition,
  normalizeMicromorphControlCurveFrame,
  redactMicromorphEndpoint,
  validateMicromorphEndpoint,
} from "../src/micromorph-model-client.js";

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.binaryType = "blob";
    this.bufferedAmount = 0;
    this.listeners = new Map();
    this.sent = [];
    this.closeCalls = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  message(data) {
    this.emit("message", { data });
  }

  send(value) {
    if (this.readyState !== 1) throw new Error("socket is not open");
    this.sent.push(value);
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.emit("close", { code, reason, wasClean: code === 1000 });
  }

  listenerCount() {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.size;
    return count;
  }
}

function resetSockets() {
  FakeWebSocket.instances.length = 0;
}

function baseConfig(overrides = {}) {
  return {
    sampleRate: 48_000,
    blockSize: 16,
    inputChannels: 1,
    outputChannels: 1,
    controls: [
      { id: "density", label: "Density", defaultValue: 0.5 },
      "ferality",
    ],
    ...overrides,
  };
}

function jsonFrames(socket) {
  return socket.sent
    .filter((value) => typeof value === "string")
    .map((value) => JSON.parse(value));
}

function binaryFrames(socket) {
  return socket.sent.filter((value) => value instanceof ArrayBuffer);
}

function requiredCapabilities(overrides = {}) {
  return {
    causalTransform: true,
    textAnchors: true,
    controlCurves: true,
    framedPcm: true,
    sampleClock: true,
    pcmInput: true,
    pcmOutput: true,
    pcmFormat: "f32le",
    ...overrides,
  };
}

function startClient(options = {}) {
  resetSockets();
  const client = new MicromorphModelClient({
    endpoint: "ws://127.0.0.1:3939/micromorph/v1",
    WebSocket: FakeWebSocket,
    config: baseConfig(),
    ...options,
  });
  const connection = client.connect();
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  const [hello, configRequest] = jsonFrames(socket);
  return { client, socket, connection, hello, configRequest };
}

function serverHello(session, overrides = {}) {
  const capabilities = requiredCapabilities(overrides.capabilities);
  const frame = {
    type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.HELLO,
    protocol: MICROMORPH_MODEL_PROTOCOL.NAME,
    version: MICROMORPH_MODEL_PROTOCOL.VERSION,
    role: "server",
    streamGeneration: session.hello.streamGeneration,
    capabilities,
    ...overrides,
  };
  frame.capabilities = capabilities;
  return frame;
}

function configAccepted(session, overrides = {}) {
  return {
    type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONFIG_ACCEPTED,
    streamGeneration: session.hello.streamGeneration,
    replyTo: session.configRequest.sequence,
    config: session.configRequest.config,
    modelId: "test-causal-model@sha256:01234567",
    algorithmicLatencyFrames: 32,
    outputHopFrames: 16,
    ...overrides,
  };
}

function modelReady(session, overrides = {}) {
  return {
    type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.MODEL_READY,
    streamGeneration: session.hello.streamGeneration,
    startFrame: 0,
    ...overrides,
  };
}

function sendHandshake(session, overrides = {}) {
  session.socket.message(JSON.stringify(serverHello(session, overrides.hello)));
  session.socket.message(JSON.stringify(configAccepted(session, overrides.configAccepted)));
  session.socket.message(JSON.stringify(modelReady(session, overrides.modelReady)));
}

async function connectedClient(options = {}, handshake = {}) {
  const session = startClient(options);
  sendHandshake(session, handshake);
  await session.connection;
  return session;
}

function errorWithCode(code) {
  return (error) => error instanceof MicromorphModelClientError && error.code === code;
}

test("a runtime without WebSocket exposes model-unavailable and requires geometry", async () => {
  const client = new MicromorphModelClient({
    endpoint: "ws://localhost:3939/micromorph/v1",
    runtime: {},
    WebSocket: null,
    config: baseConfig(),
  });

  const status = client.getStatus();
  assert.equal(status.state, MICROMORPH_MODEL_CLIENT_STATES.MODEL_UNAVAILABLE);
  assert.equal(status.available, false);
  assert.equal(status.ready, false);
  assert.equal(status.configured, false, "configured means accepted by a server");
  assert.equal(status.maxBufferedInputFrames, 64, "default budget is four requested blocks");
  await assert.rejects(client.connect(), errorWithCode("model-unavailable"));

  const missingConfig = new MicromorphModelClient({
    endpoint: "ws://localhost:3939/micromorph/v1",
    WebSocket: FakeWebSocket,
  });
  await assert.rejects(missingConfig.connect(), errorWithCode("invalid-config"));
  assert.equal(FakeWebSocket.instances.length, 0);
});

test("endpoints are loopback-only and public views redact every query token", async () => {
  assert.equal(
    validateMicromorphEndpoint("ws://localhost:7777/model?token=secret&mode=x"),
    "ws://localhost:7777/model?token=secret&mode=x",
  );
  assert.equal(
    redactMicromorphEndpoint("ws://localhost:7777/model?token=secret&mode=x"),
    "ws://localhost:7777/model",
  );
  for (const endpoint of [
    "https://localhost:7777/model",
    "ws://models.example.com/stream",
    "ws://user:password@localhost:7777/model",
    "not a url",
  ]) {
    assert.throws(() => validateMicromorphEndpoint(endpoint), errorWithCode("invalid-endpoint"));
  }

  const session = startClient({
    endpoint: "ws://127.0.0.1:3939/stream?token=do-not-publish",
  });
  assert.equal(session.socket.url, "ws://127.0.0.1:3939/stream?token=do-not-publish");
  assert.equal(session.client.endpoint, "ws://127.0.0.1:3939/stream");
  assert.equal(session.client.getStatus().endpoint, "ws://127.0.0.1:3939/stream");
  assert.doesNotMatch(JSON.stringify(session.client.getStatus()), /do-not-publish/);
  sendHandshake(session);
  await session.connection;
});

test("READY and connect resolution require hello, exact config acceptance, and model-ready", async () => {
  const states = [];
  const config = baseConfig({ inputChannels: 2, outputChannels: 2, modelId: "requested-model" });
  const session = startClient({ config });
  session.client.subscribeStatus(({ state }) => states.push(state));

  assert.equal(session.socket.binaryType, "arraybuffer");
  assert.deepEqual(session.hello.capabilities, {
    causalTransform: true,
    textAnchors: true,
    controlCurves: true,
    framedPcm: true,
    sampleClock: true,
    pcmInput: true,
    pcmOutput: true,
    pcmFormat: "f32le",
  });
  assert.equal(session.configRequest.type, "config");
  assert.equal(session.configRequest.streamGeneration, session.hello.streamGeneration);
  assert.deepEqual(session.configRequest.config, normalizeMicromorphConfig(config));

  let settled = false;
  session.connection.then(() => { settled = true; });
  session.socket.message(JSON.stringify(serverHello(session)));
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(session.client.getStatus().state, MICROMORPH_MODEL_CLIENT_STATES.CONNECTED);

  session.socket.message(JSON.stringify(configAccepted(session, {
    modelId: "loaded-model@sha256:abcdef",
    algorithmicLatencyFrames: 48,
    outputHopFrames: 8,
  })));
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(session.client.getStatus().configured, true);

  session.socket.message(JSON.stringify(modelReady(session)));
  const status = await session.connection;
  assert.equal(settled, true);
  assert.equal(status.state, MICROMORPH_MODEL_CLIENT_STATES.READY);
  assert.equal(status.serverModelId, "loaded-model@sha256:abcdef");
  assert.equal(status.algorithmicLatencyFrames, 48);
  assert.equal(status.outputHopFrames, 8);
  assert.equal(status.serverCapabilities.causalTransform, true);
  assert.deepEqual(
    states.filter((state, index) => state !== states[index - 1]),
    ["connected", "ready"],
  );
});

test("missing causal/text/control/framing capabilities are fatal protocol failures", async () => {
  for (const missing of [
    "causalTransform",
    "textAnchors",
    "controlCurves",
    "framedPcm",
    "sampleClock",
    "pcmInput",
    "pcmOutput",
  ]) {
    const session = startClient();
    const rejected = assert.rejects(session.connection, errorWithCode("capability-mismatch"));
    session.socket.message(JSON.stringify(serverHello(session, {
      capabilities: { [missing]: false },
    })));
    await rejected;
    assert.deepEqual(session.socket.closeCalls, [{ code: 1002, reason: "capability-mismatch" }]);
    assert.equal(session.client.getStatus().state, MICROMORPH_MODEL_CLIENT_STATES.ERROR);
  }

  const session = startClient();
  const rejected = assert.rejects(session.connection, errorWithCode("capability-mismatch"));
  session.socket.message(JSON.stringify(serverHello(session, {
    capabilities: { pcmFormat: "s16le" },
  })));
  await rejected;
});

test("handshake order, version, binary-before-ready, and ack fields fail closed with 1002", async (t) => {
  await t.test("config before hello", async () => {
    const session = startClient();
    const rejected = assert.rejects(session.connection, errorWithCode("handshake-order"));
    session.socket.message(JSON.stringify(configAccepted(session)));
    await rejected;
    assert.equal(session.socket.closeCalls[0].code, 1002);
  });

  await t.test("protocol version mismatch", async () => {
    const session = startClient();
    const rejected = assert.rejects(session.connection, errorWithCode("protocol-mismatch"));
    session.socket.message(JSON.stringify(serverHello(session, { version: 2 })));
    await rejected;
    assert.equal(session.socket.closeCalls[0].code, 1002);
  });

  await t.test("binary before ready", async () => {
    const session = startClient();
    const rejected = assert.rejects(session.connection, errorWithCode("handshake-order"));
    session.socket.message(new ArrayBuffer(32));
    await rejected;
    assert.equal(session.socket.closeCalls[0].code, 1002);
  });

  for (const [name, overrides, code] of [
    ["wrong config reply", { replyTo: 999 }, "config-mismatch"],
    ["missing server model id", { modelId: undefined }, "invalid-frame"],
    ["missing latency", { algorithmicLatencyFrames: undefined }, "config-mismatch"],
    ["invalid output hop", { outputHopFrames: 17 }, "config-mismatch"],
  ]) {
    await t.test(name, async () => {
      const session = startClient();
      session.socket.message(JSON.stringify(serverHello(session)));
      const rejected = assert.rejects(session.connection, errorWithCode(code));
      session.socket.message(JSON.stringify(configAccepted(session, overrides)));
      await rejected;
      assert.equal(session.socket.closeCalls[0].code, 1002);
    });
  }
});

test("the exact browser config is authoritative and neither side can reconfigure midstream", async () => {
  const mismatch = startClient();
  mismatch.socket.message(JSON.stringify(serverHello(mismatch)));
  const rejected = assert.rejects(mismatch.connection, errorWithCode("config-mismatch"));
  mismatch.socket.message(JSON.stringify(configAccepted(mismatch, {
    config: { ...mismatch.configRequest.config, sampleRate: 44_100 },
  })));
  await rejected;
  assert.equal(mismatch.socket.closeCalls[0].code, 1002);

  const session = await connectedClient();
  assert.throws(
    () => session.client.configure(baseConfig({ sampleRate: 44_100 })),
    errorWithCode("config-locked"),
  );
  session.socket.message(JSON.stringify({
    type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONFIG,
    config: baseConfig({ sampleRate: 44_100 }),
  }));
  assert.equal(session.client.getStatus().state, MICROMORPH_MODEL_CLIENT_STATES.ERROR);
  assert.deepEqual(session.socket.closeCalls, [{ code: 1002, reason: "server-config-forbidden" }]);
});

test("the explicit handshake timeout rejects and closes with protocol code 1002", async () => {
  let timerCallback = null;
  let cleared = false;
  const runtime = {
    setTimeout(callback) {
      timerCallback = callback;
      return 41;
    },
    clearTimeout(id) {
      assert.equal(id, 41);
      cleared = true;
    },
  };
  const session = startClient({ runtime, handshakeTimeoutMs: 25 });
  const rejected = assert.rejects(session.connection, errorWithCode("handshake-timeout"));
  assert.equal(typeof timerCallback, "function");
  timerCallback();
  await rejected;
  assert.equal(cleared, true);
  assert.deepEqual(session.socket.closeCalls, [{ code: 1002, reason: "handshake-timeout" }]);
});

test("remote error frames are fatal both during and after the handshake", async () => {
  const during = startClient();
  const rejected = assert.rejects(during.connection, errorWithCode("weights-unavailable"));
  during.socket.message(JSON.stringify({
    type: "error",
    code: "weights-unavailable",
    message: "Model weights could not be loaded",
  }));
  await rejected;
  assert.deepEqual(during.socket.closeCalls, [{ code: 1002, reason: "weights-unavailable" }]);

  const after = await connectedClient();
  const errors = [];
  after.client.subscribeProtocolErrors((error) => errors.push(error));
  after.socket.message(JSON.stringify({
    type: "error",
    code: "inference-failed",
    message: "The causal worker stopped",
  }));
  assert.equal(after.client.getStatus().state, MICROMORPH_MODEL_CLIENT_STATES.ERROR);
  assert.equal(after.client.getStatus().connected, false);
  assert.equal(errors.at(-1).code, "inference-failed");
  assert.deepEqual(after.socket.closeCalls, [{ code: 1002, reason: "inference-failed" }]);
});

test("sample-clock controls use replace/linear semantics and strict integer offsets", async () => {
  const session = await connectedClient();
  session.client.sendPcmInput(new Float32Array(16));

  const first = session.client.sendControlCurve({
    density: [[0, 0.1], [4, 0.8]],
    ferality: 0.35,
  });
  const second = session.client.sendControls({ density: 1 }, { startFrame: 20 });

  assert.equal(first.startFrame, 16, "automatic controls target the shared input cursor");
  assert.equal(first.mode, "replace");
  assert.deepEqual(first.curves[0], {
    id: "density",
    interpolation: "linear",
    points: [{ offsetFrames: 0, value: 0.1 }, { offsetFrames: 4, value: 0.8 }],
  });
  assert.equal(second.startFrame, 20);
  assert.equal(jsonFrames(session.socket).at(-1).type, "control-curve");

  for (const operation of [
    () => session.client.sendControls({ density: -0.01 }, { startFrame: 21 }),
    () => session.client.sendControlCurve({ density: [[1, 0.2]] }, { startFrame: 21 }),
    () => session.client.sendControlCurve({ density: [[0, 0.2], [0, 0.3]] }, { startFrame: 21 }),
    () => session.client.sendControlCurve({ density: [[0, 0.2], [1.5, 0.3]] }, { startFrame: 21 }),
    () => session.client.sendControlCurve([
      { id: "density", points: [{ offset: 0.1, value: 0.2 }] },
    ], { startFrame: 21 }),
    () => session.client.sendControls({ density: 0.5 }, { startFrame: 19 }),
    () => session.client.sendControls({ density: 0.5 }, { timestamp: 1 }),
    () => session.client.sendControls({ hallucinated: 0.5 }, { startFrame: 21 }),
  ]) {
    assert.throws(operation, MicromorphModelClientError);
  }

  assert.throws(() => normalizeMicromorphControlCurveFrame({
    startFrame: 0,
    timestamp: 0,
    curves: { density: 0.5 },
  }), errorWithCode("invalid-control-clock"));
});

test("incoming controls share the stream generation and malformed app frames stay nonfatal", async () => {
  const session = await connectedClient();
  const received = [];
  const errors = [];
  session.client.subscribeControlCurves((frame) => received.push(frame));
  session.client.subscribeProtocolErrors((error) => errors.push(error));

  session.socket.message(JSON.stringify({
    type: "control-curve",
    sequence: 4,
    streamGeneration: session.hello.streamGeneration,
    startFrame: 10,
    mode: "replace",
    curves: [{ id: "density", points: [[0, 0.2], [3, 0.7]] }],
  }));
  session.socket.message(JSON.stringify({
    type: "control-curve",
    streamGeneration: session.hello.streamGeneration,
    startFrame: 9,
    curves: { density: 0.5 },
  }));
  session.socket.message("{broken json");
  session.socket.message(JSON.stringify({ type: "surprise", value: 1 }));

  assert.equal(received.length, 1);
  assert.equal(received[0].startFrame, 10);
  assert.deepEqual(errors.map(({ code }) => code), [
    "nonmonotonic-control",
    "invalid-json",
    "unsupported-frame",
  ]);
  assert.equal(session.client.getStatus().state, MICROMORPH_MODEL_CLIENT_STATES.READY);
});

test("condition frames are bounded and aligned to the integer sample cursor", async () => {
  const session = await connectedClient();
  session.client.sendPcmInput(new Float32Array(16));
  const condition = session.client.sendCondition({
    anchors: {
      a: "wet ceramic throat and close breath",
      b: "fractured glass lung singing in a small chamber",
    },
  });

  assert.equal(condition.type, "condition");
  assert.equal(condition.startFrame, 16);
  assert.equal(condition.streamGeneration, session.hello.streamGeneration);
  assert.deepEqual(condition.condition, normalizeMicromorphCondition({
    anchors: {
      a: "wet ceramic throat and close breath",
      b: "fractured glass lung singing in a small chamber",
    },
  }));

  for (const invalid of [
    {},
    { anchors: { a: "", b: "valid" } },
    { anchors: { a: "valid", b: "" } },
    { anchors: { a: "a".repeat(513), b: "valid" } },
    { anchors: { a: "valid", b: "valid" }, material: 0.74 },
  ]) {
    assert.throws(() => session.client.sendCondition(invalid), errorWithCode("invalid-condition"));
  }
});

test("MGA1 PCM codec has a fixed 32-byte header and preserves the safe integer timeline", () => {
  const source = Float32Array.of(0.1, -0.1, 0.2, -0.2);
  const packet = encodeMicromorphPcmPacket({
    kind: "input",
    streamGeneration: 7,
    sequence: 9,
    startFrame: 0x1_0000_0000 + 12,
    sampleRate: 48_000,
    channels: 2,
    samples: source,
  });
  source.fill(1);

  assert.equal(packet.byteLength, 32 + 4 * 4);
  assert.equal(new TextDecoder().decode(new Uint8Array(packet, 0, 4)), "MGA1");
  const decoded = decodeMicromorphPcmPacket(packet, { expectedKind: "input" });
  assert.deepEqual({
    kind: decoded.kind,
    streamGeneration: decoded.streamGeneration,
    sequence: decoded.sequence,
    startFrame: decoded.startFrame,
    frameCount: decoded.frameCount,
    endFrame: decoded.endFrame,
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
  }, {
    kind: "input",
    streamGeneration: 7,
    sequence: 9,
    startFrame: 0x1_0000_0000 + 12,
    frameCount: 2,
    endFrame: 0x1_0000_0000 + 14,
    sampleRate: 48_000,
    channels: 2,
  });
  assert.deepEqual([...decoded.samples], [
    Math.fround(0.1), Math.fround(-0.1), Math.fround(0.2), Math.fround(-0.2),
  ]);

  const wrongMagic = packet.slice(0);
  new DataView(wrongMagic).setUint32(0, 0, true);
  assert.throws(() => decodeMicromorphPcmPacket(wrongMagic), errorWithCode("invalid-pcm"));
  assert.throws(() => decodeMicromorphPcmPacket(packet.slice(0, -4)), errorWithCode("invalid-pcm"));
  assert.throws(
    () => decodeMicromorphPcmPacket(packet, { expectedKind: "output" }),
    errorWithCode("invalid-pcm"),
  );
});

test("PCM input is framed, copied, block-bounded, and advances the shared cursor", async () => {
  const session = await connectedClient({ config: baseConfig({ inputChannels: 2 }) });
  const source = Float32Array.of(0.1, -0.1, 0.2, -0.2);
  const result = session.client.sendPcmInput(source);
  source.fill(1);

  assert.deepEqual(result, {
    channels: 2,
    frames: 2,
    sampleRate: 48_000,
    startFrame: 0,
    endFrame: 2,
    sequence: 1,
    bufferedAmount: 0,
    bufferedFrames: 0,
    dropped: false,
    gap: null,
  });
  const decoded = decodeMicromorphPcmPacket(binaryFrames(session.socket)[0]);
  assert.equal(decoded.kind, "input");
  assert.equal(decoded.streamGeneration, session.hello.streamGeneration);
  assert.equal(decoded.startFrame, 0);
  assert.deepEqual([...decoded.samples], [
    Math.fround(0.1), Math.fround(-0.1), Math.fround(0.2), Math.fround(-0.2),
  ]);
  assert.equal(session.client.getStatus().inputFrameCursor, 2);
  assert.equal(session.client.getStatus().lastOutputStartFrame, null);

  assert.throws(() => session.client.sendPcmInput(Float32Array.of(0, 0, 0)), /inputChannels/);
  assert.throws(() => session.client.sendPcmInput(Float32Array.of(0, Number.NaN)), /finite/);
  assert.throws(() => session.client.sendPcmInput(new Float32Array(34)), /blockSize/);
});

test("backpressure uses a frame budget and emits one aggregated input-gap before recovery", async () => {
  const session = await connectedClient({
    config: baseConfig({ inputChannels: 1 }),
    maxBufferedInputFrames: 32,
  });
  assert.equal(session.client.getStatus().maxBufferedInputFrames, 32);
  session.socket.bufferedAmount = 32 * 4;

  const firstDrop = session.client.sendPcmInput(new Float32Array(16));
  const secondDrop = session.client.sendPcmInput(new Float32Array(16));
  assert.equal(firstDrop.dropped, true);
  assert.equal(firstDrop.startFrame, 0);
  assert.equal(secondDrop.sequence, 2);
  assert.equal(session.client.getStatus().pendingInputGapFrames, 32);
  assert.equal(binaryFrames(session.socket).length, 0);

  session.socket.bufferedAmount = 0;
  const recovered = session.client.sendPcmInput(new Float32Array(16));
  assert.equal(recovered.dropped, false);
  assert.deepEqual(recovered.gap, {
    type: "input-gap",
    sequence: recovered.gap.sequence,
    streamGeneration: session.hello.streamGeneration,
    reason: "backpressure",
    startFrame: 0,
    frameCount: 32,
    firstPcmSequence: 1,
    lastPcmSequence: 2,
  });
  const gap = jsonFrames(session.socket).find(({ type }) => type === "input-gap");
  assert.deepEqual(gap, recovered.gap);
  const packet = decodeMicromorphPcmPacket(binaryFrames(session.socket)[0]);
  assert.equal(packet.sequence, 3);
  assert.equal(packet.startFrame, 32);
  assert.equal(session.client.getStatus().inputFrameCursor, 48);
  assert.equal(session.client.getStatus().droppedPcmInputFrames, 32);
  assert.equal(session.client.getStatus().pendingInputGapFrames, 0);
  assert.ok(
    session.socket.sent.indexOf(JSON.stringify(gap)) < session.socket.sent.indexOf(binaryFrames(session.socket)[0]),
    "the gap marker precedes the next PCM packet on the ordered WebSocket",
  );

  const defaultBudget = await connectedClient({ config: baseConfig({ blockSize: 32 }) });
  assert.equal(defaultBudget.client.getStatus().maxBufferedInputFrames, 128);
});

test("framed PCM output exposes sequence, sample position, model latency, and live lag", async () => {
  const session = await connectedClient();
  const output = [];
  const errors = [];
  session.client.subscribePcmOutput((block) => output.push(block));
  session.client.subscribeProtocolErrors((error) => errors.push(error));
  session.client.sendPcmInput(new Float32Array(16));
  session.client.sendPcmInput(new Float32Array(16));

  const firstPacket = encodeMicromorphPcmPacket({
    kind: "output",
    streamGeneration: session.hello.streamGeneration,
    sequence: 1,
    startFrame: 0,
    sampleRate: 48_000,
    channels: 1,
    samples: Float32Array.from({ length: 16 }, (_, index) => index / 16),
  });
  session.socket.message(firstPacket);
  await Promise.resolve();

  assert.equal(output.length, 1);
  assert.deepEqual({
    channels: output[0].channels,
    frames: output[0].frames,
    startFrame: output[0].startFrame,
    endFrame: output[0].endFrame,
    sequence: output[0].sequence,
    streamGeneration: output[0].streamGeneration,
    inputFrameCursor: output[0].inputFrameCursor,
    lagFrames: output[0].lagFrames,
    algorithmicLatencyFrames: output[0].algorithmicLatencyFrames,
    outputHopFrames: output[0].outputHopFrames,
  }, {
    channels: 1,
    frames: 16,
    startFrame: 0,
    endFrame: 16,
    sequence: 1,
    streamGeneration: session.hello.streamGeneration,
    inputFrameCursor: 32,
    lagFrames: 16,
    algorithmicLatencyFrames: 32,
    outputHopFrames: 16,
  });
  assert.equal("timestamp" in output[0], false, "arrival time is not invented");
  assert.deepEqual({
    inputFrameCursor: session.client.getStatus().inputFrameCursor,
    outputSampleFrame: session.client.getStatus().outputSampleFrame,
    lastOutputStartFrame: session.client.getStatus().lastOutputStartFrame,
    outputLagFrames: session.client.getStatus().outputLagFrames,
  }, {
    inputFrameCursor: 32,
    outputSampleFrame: 16,
    lastOutputStartFrame: 0,
    outputLagFrames: 16,
  });

  session.socket.message(encodeMicromorphPcmPacket({
    kind: "output",
    streamGeneration: session.hello.streamGeneration,
    sequence: 3,
    startFrame: 16,
    sampleRate: 48_000,
    channels: 1,
    samples: new Float32Array(16),
  }));
  session.socket.message(encodeMicromorphPcmPacket({
    kind: "output",
    streamGeneration: session.hello.streamGeneration,
    sequence: 2,
    startFrame: 17,
    sampleRate: 48_000,
    channels: 1,
    samples: new Float32Array(16),
  }));
  session.socket.message(Float32Array.of(0.1, 0.2).buffer);
  await Promise.resolve();
  assert.deepEqual(errors.map(({ code }) => code), ["pcm-sequence", "pcm-timeline", "invalid-pcm"]);
  assert.equal(output.length, 1);
  assert.equal(session.client.getStatus().state, MICROMORPH_MODEL_CLIENT_STATES.READY);

  session.socket.message(encodeMicromorphPcmPacket({
    kind: "output",
    streamGeneration: session.hello.streamGeneration,
    sequence: 2,
    startFrame: 16,
    sampleRate: 44_100,
    channels: 1,
    samples: new Float32Array(16),
  }));
  assert.equal(session.client.getStatus().state, MICROMORPH_MODEL_CLIENT_STATES.ERROR);
  assert.deepEqual(session.socket.closeCalls, [{ code: 1002, reason: "config-mismatch" }]);
});

test("remote status exposes only bounded known fields and malformed status is nonfatal", async () => {
  const session = await connectedClient();
  const received = [];
  const errors = [];
  session.client.subscribeRemoteStatus((status) => received.push(status));
  session.client.subscribeProtocolErrors((error) => errors.push(error));

  session.socket.message(JSON.stringify({
    type: "status",
    level: "warning",
    code: "warming-up",
    message: "Compiling the causal graph",
    progress: 0.75,
    sampleFrame: 128,
    sequence: 8,
    diagnostics: "x".repeat(10_000),
  }));
  assert.deepEqual(received[0], {
    level: "warning",
    code: "warming-up",
    message: "Compiling the causal graph",
    progress: 0.75,
    sampleFrame: 128,
    sequence: 8,
  });
  assert.equal(session.client.getStatus().remoteStatus, received[0]);

  session.socket.message(JSON.stringify({
    type: "status",
    message: "x".repeat(257),
  }));
  assert.equal(received.length, 1);
  assert.equal(errors.at(-1).code, "invalid-frame");
  assert.equal(session.client.getStatus().state, MICROMORPH_MODEL_CLIENT_STATES.READY);
});

test("clean disconnect is idempotent, detaches callbacks, and rejects later sends", async () => {
  const session = await connectedClient();
  const states = [];
  session.client.subscribeStatus(({ state }) => states.push(state), { emitCurrent: false });
  assert.equal(session.socket.listenerCount(), 4);

  session.client.disconnect("test complete");
  session.client.disconnect("already closed");

  assert.deepEqual(session.socket.closeCalls, [{ code: 1000, reason: "test complete" }]);
  assert.equal(session.socket.listenerCount(), 0);
  assert.equal(session.client.getStatus().state, MICROMORPH_MODEL_CLIENT_STATES.DISCONNECTED);
  assert.equal(session.client.getStatus().connected, false);
  assert.deepEqual(states, ["disconnected"]);
  assert.throws(() => session.client.sendControls({ density: 0.5 }), /not connected/);

  session.socket.message(JSON.stringify(serverHello(session)));
  assert.equal(session.client.getStatus().state, MICROMORPH_MODEL_CLIENT_STATES.DISCONNECTED);
});

test("config validation rejects ambiguous geometry, format, and control definitions", () => {
  assert.throws(() => normalizeMicromorphConfig(baseConfig({ sampleRate: 0 })), /sampleRate/);
  assert.throws(() => normalizeMicromorphConfig(baseConfig({ inputChannels: 1.5 })), /inputChannels/);
  assert.throws(() => normalizeMicromorphConfig(baseConfig({ pcmFormat: "s16le" })), /f32le/);
  assert.throws(() => normalizeMicromorphConfig(baseConfig({ controls: ["same", "same"] })), /unique/);
  assert.throws(
    () => normalizeMicromorphConfig(baseConfig({ controls: [{ id: "gain", defaultValue: 2 }] })),
    /normalized/,
  );
});
