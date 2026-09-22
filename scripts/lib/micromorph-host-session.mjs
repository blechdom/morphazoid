import {
  MICROMORPH_PROCESSING_MODES,
  MICROMORPH_MODEL_PROTOCOL,
  decodeMicromorphPcmPacket,
  encodeMicromorphPcmPacket,
  normalizeMicromorphCondition,
  normalizeMicromorphConfig,
  normalizeMicromorphControlCurveFrame,
  normalizeMicromorphProcessingMode,
} from "../../src/micromorph-model-client.js";

import { loadMicromorphEngine } from "./micromorph-engine.mjs";

const UINT32_MAX = 0xffff_ffff;
const MAX_JSON_CHARACTERS = MICROMORPH_MODEL_PROTOCOL.MAX_JSON_CHARACTERS;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_HANDSHAKE_TIMEOUT_MS = 60_000;
const DEFAULT_ENGINE_CLOSE_TIMEOUT_MS = 250;
const MAX_ENGINE_CLOSE_TIMEOUT_MS = 5_000;
const MAX_GAP_SECONDS = 0.5;
const REQUIRED_CONTROL_IDS = Object.freeze([
  "derivation",
  "material",
  "structure_lock",
  "memory",
  "mutation",
  "continuation",
]);

const SERVER_CAPABILITIES = Object.freeze({
  causalTransform: true,
  textAnchors: true,
  controlCurves: true,
  framedPcm: true,
  sampleClock: true,
  pcmInput: true,
  pcmOutput: true,
  pcmFormat: MICROMORPH_MODEL_PROTOCOL.PCM_FORMAT,
  processingModes: Object.freeze(Object.values(MICROMORPH_PROCESSING_MODES)),
});

const REQUIRED_CLIENT_CAPABILITIES = Object.freeze({
  causalTransform: true,
  textAnchors: true,
  controlCurves: true,
  framedPcm: true,
  sampleClock: true,
  pcmInput: true,
  pcmOutput: true,
  pcmFormat: MICROMORPH_MODEL_PROTOCOL.PCM_FORMAT,
});

export class MicromorphHostError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "MicromorphHostError";
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function integer(value, minimum, maximum, label, code = "invalid-frame") {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new MicromorphHostError(
      code,
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new MicromorphHostError(
      "invalid-frame",
      `${label} must contain between 1 and ${maximum} characters`,
    );
  }
  return value.trim();
}

function nextUint32Sequence(sequence) {
  return sequence === UINT32_MAX ? 1 : sequence + 1;
}

function raceWithAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolvePromise, rejectPromise) => {
    const handleAbort = () => rejectPromise(signal.reason);
    signal.addEventListener("abort", handleAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolvePromise(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        rejectPromise(error);
      },
    );
  });
}

function invokeWithAbort(operation, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  const operationPromise = Promise.resolve().then(() => {
    if (signal.aborted) throw signal.reason;
    return operation();
  });
  return raceWithAbort(operationPromise, signal);
}

async function closeEngineQuietly(engine, timeoutMs = DEFAULT_ENGINE_CLOSE_TIMEOUT_MS) {
  let timeout = null;
  try {
    await Promise.race([
      Promise.resolve().then(() => engine?.close?.()),
      new Promise((resolvePromise) => {
        timeout = setTimeout(resolvePromise, timeoutMs);
      }),
    ]);
  } catch {
    // A failed or cancelled engine must not mask the handshake failure.
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

function normalizeHostError(error, fallbackCode = "host-error") {
  if (error instanceof MicromorphHostError) return error;
  return new MicromorphHostError(
    String(error?.code || fallbackCode).slice(0, 64),
    String(error?.message || error || "Micromorph host error").slice(0, 256),
    { cause: error },
  );
}

function textPayload(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  throw new MicromorphHostError("invalid-json", "Text WebSocket payload is unreadable");
}

function binaryPayload(value) {
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Uint8Array) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new MicromorphHostError("invalid-pcm", "Binary WebSocket payload is unreadable");
}

function validateClientHello(frame) {
  if (!isRecord(frame)
    || frame.type !== MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.HELLO
    || frame.protocol !== MICROMORPH_MODEL_PROTOCOL.NAME
    || frame.version !== MICROMORPH_MODEL_PROTOCOL.VERSION
    || frame.role !== "client") {
    throw new MicromorphHostError(
      "protocol-mismatch",
      `Host requires ${MICROMORPH_MODEL_PROTOCOL.NAME} v${MICROMORPH_MODEL_PROTOCOL.VERSION}`,
    );
  }
  const streamGeneration = integer(
    frame.streamGeneration,
    1,
    UINT32_MAX,
    "hello streamGeneration",
    "stream-mismatch",
  );
  integer(frame.sequence, 1, Number.MAX_SAFE_INTEGER, "hello sequence");
  if (!isRecord(frame.capabilities)) {
    throw new MicromorphHostError("capability-mismatch", "Client capabilities are required");
  }
  const missing = Object.entries(REQUIRED_CLIENT_CAPABILITIES)
    .filter(([name, value]) => frame.capabilities[name] !== value)
    .map(([name]) => name);
  if (missing.length) {
    throw new MicromorphHostError(
      "capability-mismatch",
      `Client is missing required capabilities: ${missing.join(", ")}`,
    );
  }
  const advertisedModes = frame.capabilities.processingModes === undefined
    ? [MICROMORPH_PROCESSING_MODES.LIVE_MORPH]
    : frame.capabilities.processingModes;
  if (!Array.isArray(advertisedModes) || advertisedModes.length < 1) {
    throw new MicromorphHostError(
      "capability-mismatch",
      "Client processingModes must be a non-empty array when supplied",
    );
  }
  let processingModes;
  try {
    processingModes = advertisedModes.map(normalizeMicromorphProcessingMode);
  } catch (error) {
    throw new MicromorphHostError("capability-mismatch", error.message, { cause: error });
  }
  if (new Set(processingModes).size !== processingModes.length) {
    throw new MicromorphHostError(
      "capability-mismatch",
      "Client processingModes must not contain duplicates",
    );
  }
  return Object.freeze({ streamGeneration, processingModes: Object.freeze(processingModes) });
}

function validateBrowserConfig(frame, streamGeneration, clientProcessingModes) {
  if (!isRecord(frame) || frame.type !== MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONFIG) {
    throw new MicromorphHostError(
      "handshake-order",
      "Browser config must follow the client hello",
    );
  }
  if (frame.streamGeneration !== streamGeneration) {
    throw new MicromorphHostError(
      "stream-mismatch",
      "Browser config must use the active streamGeneration",
    );
  }
  const sequence = integer(frame.sequence, 1, Number.MAX_SAFE_INTEGER, "config sequence");
  let config;
  try {
    config = normalizeMicromorphConfig(frame.config);
  } catch (error) {
    throw new MicromorphHostError("invalid-config", error.message, { cause: error });
  }
  if (config.inputChannels !== 1 || config.outputChannels !== 2) {
    throw new MicromorphHostError(
      "unsupported-config",
      "The Micromorph host currently requires mono input and stereo output",
    );
  }
  if (!clientProcessingModes.includes(config.processingMode)
    || !SERVER_CAPABILITIES.processingModes.includes(config.processingMode)) {
    throw new MicromorphHostError(
      "unsupported-config",
      `Processing mode ${config.processingMode} was not negotiated by both peers`,
    );
  }
  const ids = config.controls.map(({ id }) => id);
  if (ids.length !== REQUIRED_CONTROL_IDS.length
    || REQUIRED_CONTROL_IDS.some((id) => !ids.includes(id))) {
    throw new MicromorphHostError(
      "unsupported-config",
      `The host requires controls: ${REQUIRED_CONTROL_IDS.join(", ")}`,
    );
  }
  return Object.freeze({ config, sequence });
}

class ControlTimeline {
  constructor(config) {
    this.defaults = Object.freeze(Object.fromEntries(
      config.controls.map(({ id, defaultValue = 0 }) => [id, defaultValue]),
    ));
    this.replacements = new Map(
      config.controls.map(({ id }) => [id, []]),
    );
  }

  replace(frame, cursorFrame) {
    for (const curve of frame.curves) {
      const replacements = this.replacements.get(curve.id);
      if (!replacements) {
        throw new MicromorphHostError(
          "unknown-control",
          `Control ${curve.id} is not configured for this stream`,
        );
      }
      const replacement = Object.freeze({
        startFrame: frame.startFrame,
        points: Object.freeze(curve.points.map(({ offsetFrames, value }) => Object.freeze({
          frame: frame.startFrame + offsetFrames,
          value,
        }))),
      });
      const updated = replacements
        .filter(({ startFrame }) => startFrame !== replacement.startFrame)
        .concat(replacement)
        .sort((left, right) => left.startFrame - right.startFrame);
      this.replacements.set(curve.id, updated);
    }
    this.prune(cursorFrame);
  }

  prune(cursorFrame) {
    for (const [id, replacements] of this.replacements) {
      let effectiveIndex = -1;
      for (let index = 0; index < replacements.length; index += 1) {
        if (replacements[index].startFrame <= cursorFrame) effectiveIndex = index;
        else break;
      }
      if (effectiveIndex > 0) this.replacements.set(id, replacements.slice(effectiveIndex));
    }
  }

  replacementAt(id, frame, inclusive) {
    const replacements = this.replacements.get(id) ?? [];
    for (let index = replacements.length - 1; index >= 0; index -= 1) {
      const startsInTime = inclusive
        ? replacements[index].startFrame <= frame
        : replacements[index].startFrame < frame;
      if (startsInTime) return replacements[index];
    }
    return null;
  }

  evaluate(id, replacement, frame) {
    if (!replacement) return this.defaults[id] ?? 0;
    const points = replacement.points;
    if (frame <= points[0].frame) return points[0].value;
    for (let index = 1; index < points.length; index += 1) {
      const right = points[index];
      if (frame <= right.frame) {
        const left = points[index - 1];
        const span = Math.max(1, right.frame - left.frame);
        const amount = (frame - left.frame) / span;
        return left.value + (right.value - left.value) * amount;
      }
    }
    return points.at(-1).value;
  }

  valueAt(id, frame) {
    return this.evaluate(id, this.replacementAt(id, frame, true), frame);
  }

  valueBefore(id, frame) {
    return this.evaluate(id, this.replacementAt(id, frame, false), frame);
  }

  valuesAt(frame) {
    return Object.freeze(Object.fromEntries(
      [...this.replacements.keys()].map((id) => [id, this.valueAt(id, frame)]),
    ));
  }

  valuesBefore(frame) {
    return Object.freeze(Object.fromEntries(
      [...this.replacements.keys()].map((id) => [id, this.valueBefore(id, frame)]),
    ));
  }

  boundaries(startFrame, endFrame) {
    const boundaries = new Set();
    for (const replacements of this.replacements.values()) {
      for (const replacement of replacements) {
        if (replacement.startFrame > startFrame && replacement.startFrame < endFrame) {
          boundaries.add(replacement.startFrame);
        }
        for (const point of replacement.points) {
          if (point.frame > startFrame && point.frame < endFrame) boundaries.add(point.frame);
        }
      }
    }
    return boundaries;
  }
}

class ConditionTimeline {
  constructor() {
    this.events = [];
  }

  replace(startFrame, condition, cursorFrame) {
    const replacement = Object.freeze({ startFrame, condition });
    this.events = this.events
      .filter((event) => event.startFrame !== startFrame)
      .concat(replacement)
      .sort((left, right) => left.startFrame - right.startFrame);
    this.prune(cursorFrame);
  }

  prune(cursorFrame) {
    let effectiveIndex = -1;
    for (let index = 0; index < this.events.length; index += 1) {
      if (this.events[index].startFrame <= cursorFrame) effectiveIndex = index;
      else break;
    }
    if (effectiveIndex > 0) this.events = this.events.slice(effectiveIndex);
  }

  at(frame) {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (this.events[index].startFrame <= frame) return this.events[index];
    }
    return null;
  }

  boundaries(startFrame, endFrame) {
    return this.events
      .filter((event) => event.startFrame > startFrame && event.startFrame < endFrame)
      .map(({ startFrame: boundary }) => boundary);
  }
}

function engineWireMetadata(engine) {
  const identity = engine.identity;
  return Object.freeze({
    name: boundedText(identity.name, 128, "engine identity name"),
    version: boundedText(identity.version, 32, "engine identity version"),
    kind: boundedText(identity.kind, 64, "engine identity kind"),
    neural: identity.neural === true,
    generative: identity.generative === true,
    causal: identity.causal === true,
    processingMode: normalizeMicromorphProcessingMode(
      identity.mode ?? engine.processingMode,
    ),
  });
}

export class MicromorphHostSession {
  constructor({
    connection,
    engine = "reference",
    engineOptions = {},
    handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
    engineCloseTimeoutMs = DEFAULT_ENGINE_CLOSE_TIMEOUT_MS,
    logger = null,
  } = {}) {
    if (!connection) throw new TypeError("Micromorph host session requires a connection");
    this.connection = connection;
    this.engineSpecifier = engine;
    this.engineOptions = engineOptions;
    this.handshakeTimeoutMs = integer(
      handshakeTimeoutMs,
      1,
      MAX_HANDSHAKE_TIMEOUT_MS,
      "handshakeTimeoutMs",
      "invalid-option",
    );
    this.engineCloseTimeoutMs = integer(
      engineCloseTimeoutMs,
      1,
      MAX_ENGINE_CLOSE_TIMEOUT_MS,
      "engineCloseTimeoutMs",
      "invalid-option",
    );
    this.logger = typeof logger === "function" ? logger : () => {};
    this.phase = "hello";
    this.streamGeneration = null;
    this.clientProcessingModes = Object.freeze([MICROMORPH_PROCESSING_MODES.LIVE_MORPH]);
    this.config = null;
    this.engine = null;
    this.controlTimeline = null;
    this.conditionTimeline = new ConditionTimeline();
    this.appliedConditionEvent = null;
    this.inputCursor = 0;
    this.outputCursor = 0;
    this.expectedInputSequence = 1;
    this.outputSequence = 1;
    this.serverSequence = 0;
    this.closed = false;
    this.handshakeAbortController = new AbortController();
    this.handleConnectionClose = () => {
      this.abortHandshake(new MicromorphHostError(
        "session-closed",
        "Micromorph client disconnected",
      ));
    };
    this.connection.once?.("close", this.handleConnectionClose);
    this.handshakeTimer = setTimeout(() => {
      const error = new MicromorphHostError(
        "handshake-timeout",
        `Micromorph handshake did not complete within ${this.handshakeTimeoutMs} ms`,
      );
      this.abortHandshake(error);
      void this.fail(error).catch(() => {});
    }, this.handshakeTimeoutMs);
    this.handshakeTimer.unref?.();
  }

  abortHandshake(reason) {
    if (!this.handshakeAbortController.signal.aborted) {
      this.handshakeAbortController.abort(reason);
    }
  }

  clearHandshakeDeadline() {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  nextServerSequence() {
    this.serverSequence += 1;
    return this.serverSequence;
  }

  sendJson(frame) {
    const text = JSON.stringify(frame);
    if (text.length > MAX_JSON_CHARACTERS) {
      throw new MicromorphHostError("frame-too-large", "Outbound JSON frame is too large");
    }
    return this.connection.sendText(text);
  }

  async sendBinary(packet) {
    const writable = this.connection.sendBinary(packet);
    if (writable === false && typeof this.connection.waitForDrain === "function") {
      await this.connection.waitForDrain();
    }
  }

  async acceptMessage(message) {
    if (this.closed) return;
    if (message?.type === "text") {
      await this.acceptText(message.data);
      return;
    }
    if (message?.type === "binary") {
      await this.acceptBinary(message.data);
      return;
    }
    if (message?.type === "close") {
      await this.close();
      return;
    }
    throw new MicromorphHostError("unsupported-frame", "Unsupported WebSocket message type");
  }

  async acceptText(value) {
    const text = textPayload(value);
    if (text.length > MAX_JSON_CHARACTERS) {
      throw new MicromorphHostError("frame-too-large", "Inbound JSON frame is too large");
    }
    let frame;
    try {
      frame = JSON.parse(text);
    } catch (error) {
      throw new MicromorphHostError("invalid-json", "Inbound JSON could not be parsed", {
        cause: error,
      });
    }
    if (!isRecord(frame) || typeof frame.type !== "string") {
      throw new MicromorphHostError("invalid-frame", "Inbound JSON frame needs a type");
    }
    if (this.phase === "hello") {
      await this.acceptHello(frame);
      return;
    }
    if (this.phase === "config") {
      await this.acceptConfig(frame);
      return;
    }
    if (this.phase !== "ready") {
      throw new MicromorphHostError("handshake-order", "Model host is not ready for stream data");
    }
    switch (frame.type) {
      case MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONDITION:
        this.acceptCondition(frame);
        break;
      case MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONTROL_CURVE:
        this.acceptControlCurve(frame);
        break;
      case MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.INPUT_GAP:
        await this.acceptInputGap(frame);
        break;
      default:
        throw new MicromorphHostError(
          "unsupported-frame",
          `Host does not accept client frame type ${frame.type}`,
        );
    }
  }

  async acceptHello(frame) {
    const hello = validateClientHello(frame);
    this.streamGeneration = hello.streamGeneration;
    this.clientProcessingModes = hello.processingModes;
    this.phase = "config";
    this.sendJson(Object.freeze({
      type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.HELLO,
      protocol: MICROMORPH_MODEL_PROTOCOL.NAME,
      version: MICROMORPH_MODEL_PROTOCOL.VERSION,
      role: "model",
      sequence: this.nextServerSequence(),
      streamGeneration: this.streamGeneration,
      capabilities: SERVER_CAPABILITIES,
    }));
  }

  async acceptConfig(frame) {
    const { config, sequence } = validateBrowserConfig(
      frame,
      this.streamGeneration,
      this.clientProcessingModes,
    );
    let engine;
    try {
      const enginePromise = loadMicromorphEngine(
        this.engineSpecifier,
        config,
        {
          ...this.engineOptions,
          signal: this.handshakeAbortController.signal,
        },
      );
      void enginePromise.then((candidate) => {
        if (this.closed || this.handshakeAbortController.signal.aborted) {
          void closeEngineQuietly(candidate, this.engineCloseTimeoutMs);
        }
      }, () => {});
      engine = await raceWithAbort(enginePromise, this.handshakeAbortController.signal);
    } catch (error) {
      throw normalizeHostError(error, "engine-load-failed");
    }
    let latency;
    let priming;
    let outputHop;
    let metadata;
    try {
      latency = integer(
        engine.algorithmicLatencyFrames,
        0,
        config.sampleRate * 60,
        "engine algorithmicLatencyFrames",
        "unsupported-engine",
      );
      priming = integer(
        engine.primingFrames ?? 0,
        0,
        config.sampleRate * 60,
        "engine primingFrames",
        "unsupported-engine",
      );
      outputHop = integer(
        engine.outputHopFrames,
        1,
        config.blockSize,
        "engine outputHopFrames",
        "unsupported-engine",
      );
      metadata = engineWireMetadata(engine);
      if (metadata.processingMode !== config.processingMode) {
        throw new MicromorphHostError(
          "capability-mismatch",
          `Engine mode ${metadata.processingMode} does not match ${config.processingMode}`,
        );
      }
      if (config.processingMode === MICROMORPH_PROCESSING_MODES.LIVE_MORPH
        && !metadata.causal) {
        throw new MicromorphHostError(
          "capability-mismatch",
          "Live Morph requires a causal engine",
        );
      }
      if (engine.cursorFrame !== 0) {
        throw new MicromorphHostError(
          "engine-timeline",
          "A Micromorph engine must begin at sample frame 0",
        );
      }
    } catch (error) {
      await closeEngineQuietly(engine, this.engineCloseTimeoutMs);
      throw error;
    }
    this.config = config;
    this.engine = engine;
    this.controlTimeline = new ControlTimeline(config);
    this.phase = "ready";
    this.sendJson(Object.freeze({
      type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONFIG_ACCEPTED,
      sequence: this.nextServerSequence(),
      streamGeneration: this.streamGeneration,
      replyTo: sequence,
      modelId: boundedText(engine.identity.id, 128, "engine identity id"),
      engine: metadata,
      algorithmicLatencyFrames: latency,
      primingFrames: priming,
      outputHopFrames: outputHop,
      config,
    }));
    this.sendJson(Object.freeze({
      type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.MODEL_READY,
      sequence: this.nextServerSequence(),
      streamGeneration: this.streamGeneration,
      startFrame: 0,
    }));
    this.clearHandshakeDeadline();
    this.logger("ready", {
      modelId: engine.identity.id,
      engine: metadata,
      sampleRate: config.sampleRate,
      blockSize: config.blockSize,
    });
  }

  requireGeneration(frame) {
    if (frame.streamGeneration !== this.streamGeneration) {
      throw new MicromorphHostError(
        "stream-mismatch",
        `${frame.type} streamGeneration does not match this session`,
      );
    }
  }

  acceptCondition(frame) {
    this.requireGeneration(frame);
    integer(frame.sequence, 1, Number.MAX_SAFE_INTEGER, "condition sequence");
    const startFrame = integer(
      frame.startFrame,
      this.inputCursor,
      Number.MAX_SAFE_INTEGER,
      "condition startFrame",
      "invalid-condition",
    );
    let condition;
    try {
      condition = normalizeMicromorphCondition(frame.condition);
    } catch (error) {
      throw new MicromorphHostError("invalid-condition", error.message, { cause: error });
    }
    this.conditionTimeline.replace(startFrame, condition, this.inputCursor);
    this.logger("condition", { startFrame });
  }

  acceptControlCurve(frame) {
    this.requireGeneration(frame);
    let normalized;
    try {
      normalized = normalizeMicromorphControlCurveFrame(frame, {
        minimumStartFrame: this.inputCursor,
        maxOffsetFrames: this.config.sampleRate * 60,
      });
    } catch (error) {
      throw new MicromorphHostError(error.code || "invalid-control-curve", error.message, {
        cause: error,
      });
    }
    this.controlTimeline.replace(normalized, this.inputCursor);
    this.logger("controls", {
      startFrame: normalized.startFrame,
      controls: normalized.curves.map(({ id }) => id),
    });
  }

  segmentBoundaries(startFrame, endFrame) {
    const boundaries = new Set([startFrame, endFrame]);
    for (
      let boundary = startFrame + this.config.blockSize;
      boundary < endFrame;
      boundary += this.config.blockSize
    ) {
      boundaries.add(boundary);
    }
    for (const boundary of this.controlTimeline.boundaries(startFrame, endFrame)) {
      boundaries.add(boundary);
    }
    for (const boundary of this.conditionTimeline.boundaries(startFrame, endFrame)) {
      boundaries.add(boundary);
    }
    return [...boundaries].sort((left, right) => left - right);
  }

  async applyConditionAt(frame) {
    const event = this.conditionTimeline.at(frame);
    if (!event || event === this.appliedConditionEvent) return;
    this.assertEngineCursor(frame, "before condition update");
    await invokeWithAbort(
      () => this.engine.updateCondition(event.condition, event.startFrame),
      this.handshakeAbortController.signal,
    );
    this.assertEngineCursor(frame, "after condition update");
    this.appliedConditionEvent = event;
  }

  assertEngineCursor(expectedFrame, operation) {
    const actualFrame = this.engine?.cursorFrame;
    if (!Number.isSafeInteger(actualFrame) || actualFrame !== expectedFrame) {
      throw new MicromorphHostError(
        "engine-timeline",
        `Engine cursor must be ${expectedFrame} ${operation}; received ${actualFrame}`,
      );
    }
  }

  validateStereoOutput(value, frameCount) {
    if (!(value instanceof Float32Array) || value.length !== frameCount * 2) {
      throw new MicromorphHostError(
        "invalid-engine-output",
        `Engine must return ${frameCount * 2} interleaved stereo Float32 samples`,
      );
    }
    for (const sample of value) {
      if (!Number.isFinite(sample)) {
        throw new MicromorphHostError(
          "invalid-engine-output",
          "Engine output samples must remain finite",
        );
      }
    }
    return value;
  }

  async emitStereo(samples, startFrame) {
    const totalFrames = samples.length / 2;
    if (startFrame !== this.outputCursor) {
      throw new MicromorphHostError(
        "output-timeline",
        `Engine output must begin at frame ${this.outputCursor}`,
      );
    }
    const hop = this.engine.outputHopFrames;
    for (let offsetFrames = 0; offsetFrames < totalFrames; offsetFrames += hop) {
      const frameCount = Math.min(hop, totalFrames - offsetFrames);
      const sampleOffset = offsetFrames * 2;
      const packet = encodeMicromorphPcmPacket({
        kind: "output",
        streamGeneration: this.streamGeneration,
        sequence: this.outputSequence,
        startFrame: this.outputCursor,
        sampleRate: this.config.sampleRate,
        channels: 2,
        samples: samples.subarray(sampleOffset, sampleOffset + frameCount * 2),
      });
      await this.sendBinary(packet);
      this.outputCursor += frameCount;
      this.outputSequence = nextUint32Sequence(this.outputSequence);
    }
  }

  async processRange({ startFrame, frameCount, mono = null, gapReason = null }) {
    const endFrame = startFrame + frameCount;
    const boundaries = this.segmentBoundaries(startFrame, endFrame);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const segmentStart = boundaries[index];
      const segmentEnd = boundaries[index + 1];
      const segmentFrames = segmentEnd - segmentStart;
      this.assertEngineCursor(segmentStart, "before processing");
      await this.applyConditionAt(segmentStart);
      const controls = this.controlTimeline.valuesAt(segmentStart);
      const endControls = this.controlTimeline.valuesBefore(segmentEnd);
      await invokeWithAbort(
        () => this.engine.updateControls(controls, segmentStart),
        this.handshakeAbortController.signal,
      );
      this.assertEngineCursor(segmentStart, "after controls update");
      let stereo;
      if (mono) {
        const offset = segmentStart - startFrame;
        stereo = await invokeWithAbort(
          () => this.engine.process(
            mono.subarray(offset, offset + segmentFrames),
            { startFrame: segmentStart, controls, endControls },
          ),
          this.handshakeAbortController.signal,
        );
      } else {
        stereo = await invokeWithAbort(
          () => this.engine.handleGap({
            startFrame: segmentStart,
            frameCount: segmentFrames,
            reason: gapReason ?? "backpressure",
            controls,
            endControls,
          }),
          this.handshakeAbortController.signal,
        );
        if (!(stereo instanceof Float32Array)) {
          stereo = new Float32Array(segmentFrames * 2);
        }
      }
      this.assertEngineCursor(segmentEnd, mono ? "after process" : "after gap");
      await this.emitStereo(this.validateStereoOutput(stereo, segmentFrames), segmentStart);
    }
  }

  async acceptBinary(value) {
    if (this.phase !== "ready") {
      throw new MicromorphHostError(
        "handshake-order",
        "PCM input cannot arrive before model-ready",
      );
    }
    const packet = decodeMicromorphPcmPacket(binaryPayload(value), { expectedKind: "input" });
    if (packet.streamGeneration !== this.streamGeneration) {
      throw new MicromorphHostError("stream-mismatch", "PCM input belongs to another session");
    }
    if (packet.sampleRate !== this.config.sampleRate
      || packet.channels !== this.config.inputChannels) {
      throw new MicromorphHostError(
        "config-mismatch",
        "PCM input geometry does not match the accepted browser config",
      );
    }
    if (packet.frameCount > this.config.blockSize) {
      throw new MicromorphHostError("invalid-pcm", "PCM input exceeds the accepted blockSize");
    }
    if (packet.sequence !== this.expectedInputSequence || packet.startFrame !== this.inputCursor) {
      throw new MicromorphHostError(
        "input-timeline",
        `Expected PCM sequence ${this.expectedInputSequence} at frame ${this.inputCursor}`,
      );
    }
    this.connection.pause?.();
    try {
      await this.processRange({
        startFrame: packet.startFrame,
        frameCount: packet.frameCount,
        mono: packet.samples,
      });
      this.inputCursor = packet.endFrame;
      this.controlTimeline.prune(this.inputCursor);
      this.conditionTimeline.prune(this.inputCursor);
      this.expectedInputSequence = nextUint32Sequence(this.expectedInputSequence);
      this.logger("pcm", {
        startFrame: packet.startFrame,
        endFrame: packet.endFrame,
        frames: packet.frameCount,
      });
    } finally {
      this.connection.resume?.();
    }
  }

  async acceptInputGap(frame) {
    this.requireGeneration(frame);
    integer(frame.sequence, 1, Number.MAX_SAFE_INTEGER, "input-gap sequence");
    const startFrame = integer(
      frame.startFrame,
      0,
      Number.MAX_SAFE_INTEGER,
      "input-gap startFrame",
      "invalid-gap",
    );
    const frameCount = integer(
      frame.frameCount,
      1,
      Number.MAX_SAFE_INTEGER - startFrame,
      "input-gap frameCount",
      "invalid-gap",
    );
    const maximumGapFrames = Math.max(
      this.config.blockSize,
      Math.floor(this.config.sampleRate * MAX_GAP_SECONDS),
    );
    if (frameCount > maximumGapFrames) {
      throw new MicromorphHostError(
        "gap-too-large",
        `input-gap cannot exceed ${MAX_GAP_SECONDS} seconds`,
      );
    }
    const firstSequence = integer(
      frame.firstPcmSequence,
      1,
      UINT32_MAX,
      "input-gap firstPcmSequence",
      "invalid-gap",
    );
    const lastSequence = integer(
      frame.lastPcmSequence,
      1,
      UINT32_MAX,
      "input-gap lastPcmSequence",
      "invalid-gap",
    );
    if (frame.reason !== "backpressure"
      || startFrame !== this.inputCursor
      || firstSequence !== this.expectedInputSequence
      || lastSequence < firstSequence) {
      throw new MicromorphHostError(
        "invalid-gap",
        "input-gap does not continue the current input sequence and sample timeline",
      );
    }
    this.connection.pause?.();
    try {
      await this.processRange({ startFrame, frameCount, gapReason: frame.reason });
      this.inputCursor += frameCount;
      this.controlTimeline.prune(this.inputCursor);
      this.conditionTimeline.prune(this.inputCursor);
      this.expectedInputSequence = nextUint32Sequence(lastSequence);
      this.logger("gap", { startFrame, frameCount });
    } finally {
      this.connection.resume?.();
    }
  }

  async fail(error) {
    if (this.closed) return;
    const normalized = normalizeHostError(error);
    try {
      this.sendJson(Object.freeze({
        type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.ERROR,
        sequence: this.nextServerSequence(),
        streamGeneration: this.streamGeneration ?? 1,
        code: normalized.code,
        message: normalized.message,
      }));
    } catch {
      // Closing the WebSocket still communicates that the stream is unusable.
    }
    this.connection.close?.(1002, normalized.code.slice(0, 96));
    this.logger("error", { code: normalized.code, message: normalized.message });
    await this.close({ closeSocket: false });
  }

  async run() {
    try {
      for await (const message of this.connection) {
        await this.acceptMessage(message);
      }
    } catch (error) {
      await this.fail(error);
    } finally {
      await this.close({ closeSocket: false });
    }
  }

  async close({ closeSocket = true } = {}) {
    if (this.closed) return;
    this.closed = true;
    this.connection.off?.("close", this.handleConnectionClose);
    this.clearHandshakeDeadline();
    this.abortHandshake(new MicromorphHostError(
      "session-closed",
      "Micromorph host session closed",
    ));
    try {
      await closeEngineQuietly(this.engine, this.engineCloseTimeoutMs);
    } finally {
      if (closeSocket) this.connection.close?.(1000, "session complete");
      this.logger("closed", { inputFrame: this.inputCursor, outputFrame: this.outputCursor });
    }
  }
}

export async function runMicromorphHostSession(options) {
  const session = new MicromorphHostSession(options);
  await session.run();
  return session;
}

export const MICROMORPH_HOST_REQUIRED_CONTROLS = REQUIRED_CONTROL_IDS;
export const MICROMORPH_HOST_CAPABILITIES = SERVER_CAPABILITIES;
export const MICROMORPH_HOST_HANDSHAKE_TIMEOUT_MS = DEFAULT_HANDSHAKE_TIMEOUT_MS;
export const MICROMORPH_HOST_ENGINE_CLOSE_TIMEOUT_MS = DEFAULT_ENGINE_CLOSE_TIMEOUT_MS;
export const MICROMORPH_HOST_MAX_GAP_SECONDS = MAX_GAP_SECONDS;
