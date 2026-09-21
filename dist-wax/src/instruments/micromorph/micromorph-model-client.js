const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

const MAX_JSON_CHARACTERS = 256 * 1024;
const MAX_PCM_SAMPLES = 1_048_576;
const MAX_CONTROLS = 128;
const MAX_POINTS_PER_CURVE = 2_048;
const MAX_CURVE_OFFSET_FRAMES = 192_000 * 60;
const MAX_CONDITION_CHARACTERS = 512;
const MAX_REMOTE_STATUS_CHARACTERS = 256;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_BACKPRESSURE_BLOCKS = 4;
const PCM_HEADER_BYTES = 32;
const PCM_MAGIC_NUMBER = 0x3141474d; // "MGA1" as little-endian bytes.
const PCM_PACKET_VERSION = 1;
const UINT32_MAX = 0xffff_ffff;
const CONTROL_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/i;

const PCM_KIND_CODES = Object.freeze({ input: 1, output: 2 });
const PCM_KIND_NAMES = Object.freeze({ 1: "input", 2: "output" });

export const MICROMORPH_MODEL_CLIENT_STATES = Object.freeze({
  MODEL_UNAVAILABLE: "model-unavailable",
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  READY: "ready",
  ERROR: "error",
});

export const MICROMORPH_MODEL_PROTOCOL = Object.freeze({
  NAME: "mga-stream/1",
  VERSION: 1,
  PCM_FORMAT: "f32le",
  PCM_MAGIC: "MGA1",
  PCM_PACKET_VERSION,
  PCM_HEADER_BYTES,
  PCM_KINDS: PCM_KIND_CODES,
  DEFAULT_BACKPRESSURE_BLOCKS,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  CONTROL_CURVE_MODE: "replace",
  CONTROL_CURVE_INTERPOLATION: "linear",
  FRAME_TYPES: Object.freeze({
    HELLO: "hello",
    CONFIG: "config",
    CONFIG_ACCEPTED: "config-accepted",
    MODEL_READY: "model-ready",
    CONDITION: "condition",
    CONTROL_CURVE: "control-curve",
    INPUT_GAP: "input-gap",
    STATUS: "status",
    ERROR: "error",
  }),
  MAX_JSON_CHARACTERS,
  MAX_PCM_SAMPLES,
});

export class MicromorphModelClientError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "MicromorphModelClientError";
    this.code = code;
  }
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MicromorphModelClientError("invalid-frame", `${label} must be finite`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum, label, code = "invalid-frame") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MicromorphModelClientError(code, `${label} must be finite`);
  }
  const number = value;
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new MicromorphModelClientError(
      code,
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return number;
}

function boundedString(value, label, { maximum = 128, allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    throw new MicromorphModelClientError("invalid-frame", `${label} must be a string`);
  }
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > maximum) {
    throw new MicromorphModelClientError(
      "invalid-frame",
      `${label} must contain ${allowEmpty ? "at most" : "between 1 and"} ${maximum} characters`,
    );
  }
  return text;
}

function normalizedValue(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0 || number > 1) {
    throw new MicromorphModelClientError("invalid-frame", `${label} must be normalized from 0 to 1`);
  }
  return number;
}

function frozenError(error) {
  if (!error) return null;
  return Object.freeze({
    code: String(error.code || "unknown-error").slice(0, 64),
    message: String(error.message || error).slice(0, MAX_REMOTE_STATUS_CHARACTERS),
  });
}

function safeCall(listener, value) {
  try {
    listener(value);
  } catch {
    // One observer must not interrupt the realtime transport or other observers.
  }
}

function socketIsOpen(socket) {
  return socket?.readyState === SOCKET_OPEN;
}

function loopbackHostname(hostname) {
  const normalized = String(hostname ?? "").toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "::1" || normalized === "[::1]") return true;
  const octets = normalized.split(".");
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

/** Validate and canonicalize a loopback-only WebSocket endpoint. */
export function validateMicromorphEndpoint(endpoint) {
  let url;
  try {
    url = new URL(String(endpoint ?? ""));
  } catch {
    throw new MicromorphModelClientError(
      "invalid-endpoint",
      "Micromorph requires an absolute local ws:// or wss:// endpoint",
    );
  }
  if ((url.protocol !== "ws:" && url.protocol !== "wss:") || !loopbackHostname(url.hostname)) {
    throw new MicromorphModelClientError(
      "invalid-endpoint",
      "Micromorph model endpoints must use ws:// or wss:// on localhost or a loopback address",
    );
  }
  if (url.username || url.password || url.hash) {
    throw new MicromorphModelClientError(
      "invalid-endpoint",
      "Micromorph endpoints cannot contain credentials or fragments",
    );
  }
  return url.href;
}

/** Return the public endpoint without bearer tokens or other query material. */
export function redactMicromorphEndpoint(endpoint) {
  const url = new URL(validateMicromorphEndpoint(endpoint));
  url.search = "";
  return url.href;
}

function normalizeControlDefinition(definition, index) {
  const source = typeof definition === "string" ? { id: definition } : definition;
  if (!isRecord(source)) {
    throw new MicromorphModelClientError(
      "invalid-config",
      `controls[${index}] must be a control id or object`,
    );
  }
  const id = boundedString(source.id, `controls[${index}].id`, { maximum: 64 });
  if (!CONTROL_ID_PATTERN.test(id)) {
    throw new MicromorphModelClientError(
      "invalid-config",
      `controls[${index}].id must start with a letter and use letters, numbers, dot, dash, or underscore`,
    );
  }
  const control = { id };
  if (source.label !== undefined) {
    control.label = boundedString(source.label, `controls[${index}].label`, { maximum: 96 });
  }
  if (source.defaultValue !== undefined) {
    control.defaultValue = normalizedValue(
      source.defaultValue,
      `controls[${index}].defaultValue`,
    );
  }
  return Object.freeze(control);
}

/** Return a canonical, frozen browser-owned stream configuration. */
export function normalizeMicromorphConfig(config) {
  if (!isRecord(config)) {
    throw new MicromorphModelClientError("invalid-config", "Micromorph config must be an object");
  }
  const controls = config.controls === undefined ? [] : config.controls;
  if (!Array.isArray(controls) || controls.length > MAX_CONTROLS) {
    throw new MicromorphModelClientError(
      "invalid-config",
      `controls must be an array with no more than ${MAX_CONTROLS} entries`,
    );
  }
  const normalizedControls = controls.map(normalizeControlDefinition);
  const ids = new Set(normalizedControls.map(({ id }) => id));
  if (ids.size !== normalizedControls.length) {
    throw new MicromorphModelClientError("invalid-config", "control ids must be unique");
  }

  const normalized = {
    sampleRate: boundedInteger(config.sampleRate, 8_000, 192_000, "sampleRate", "invalid-config"),
    blockSize: boundedInteger(config.blockSize, 16, 16_384, "blockSize", "invalid-config"),
    inputChannels: boundedInteger(
      config.inputChannels ?? 0, 0, 8, "inputChannels", "invalid-config",
    ),
    outputChannels: boundedInteger(
      config.outputChannels ?? 0, 0, 8, "outputChannels", "invalid-config",
    ),
    pcmFormat: config.pcmFormat === undefined
      ? MICROMORPH_MODEL_PROTOCOL.PCM_FORMAT
      : boundedString(config.pcmFormat, "pcmFormat", { maximum: 16 }),
    controls: Object.freeze(normalizedControls),
  };
  if (normalized.pcmFormat !== MICROMORPH_MODEL_PROTOCOL.PCM_FORMAT) {
    throw new MicromorphModelClientError(
      "invalid-config",
      `pcmFormat must be ${MICROMORPH_MODEL_PROTOCOL.PCM_FORMAT}`,
    );
  }
  if (config.modelId !== undefined) {
    normalized.modelId = boundedString(config.modelId, "modelId", { maximum: 128 });
  }
  return Object.freeze(normalized);
}

/** Validate the two prompt/reference endpoints used to condition Micromorph. */
export function normalizeMicromorphCondition(condition) {
  if (!isRecord(condition) || !isRecord(condition.anchors)) {
    throw new MicromorphModelClientError(
      "invalid-condition",
      "Micromorph condition must contain anchors a and b",
    );
  }
  let a;
  let b;
  try {
    a = boundedString(condition.anchors.a, "condition.anchors.a", {
      maximum: MAX_CONDITION_CHARACTERS,
    });
    b = boundedString(condition.anchors.b, "condition.anchors.b", {
      maximum: MAX_CONDITION_CHARACTERS,
    });
  } catch (error) {
    throw new MicromorphModelClientError("invalid-condition", error.message, { cause: error });
  }
  if (condition.material !== undefined) {
    throw new MicromorphModelClientError(
      "invalid-condition",
      "condition.material is not part of the condition frame; use the material control curve",
    );
  }
  return Object.freeze({ anchors: Object.freeze({ a, b }) });
}

function normalizeCurvePoint(point, curveLabel, pointIndex, maxOffsetFrames) {
  const source = Array.isArray(point)
    ? { offsetFrames: point[0], value: point[1] }
    : point;
  if (!isRecord(source)) {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      `${curveLabel}.points[${pointIndex}] must be an object or [offsetFrames, value] pair`,
    );
  }
  if (source.offset !== undefined) {
    throw new MicromorphModelClientError(
      "invalid-control-clock",
      `${curveLabel}.points[${pointIndex}] must use integer offsetFrames, not seconds`,
    );
  }
  return Object.freeze({
    offsetFrames: boundedInteger(
      source.offsetFrames ?? 0,
      0,
      maxOffsetFrames,
      `${curveLabel}.points[${pointIndex}].offsetFrames`,
      "invalid-control-curve",
    ),
    value: normalizedValue(source.value, `${curveLabel}.points[${pointIndex}].value`),
  });
}

function normalizeCurve(curve, index, maxOffsetFrames) {
  if (!isRecord(curve)) {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      `curves[${index}] must be an object`,
    );
  }
  const id = boundedString(curve.id, `curves[${index}].id`, { maximum: 64 });
  if (!CONTROL_ID_PATTERN.test(id)) {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      `curves[${index}].id is not a valid control id`,
    );
  }
  if (curve.interpolation !== undefined && curve.interpolation !== "linear") {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      `curves[${index}].interpolation must be linear`,
    );
  }
  if (!Array.isArray(curve.points) || curve.points.length === 0
    || curve.points.length > MAX_POINTS_PER_CURVE) {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      `curves[${index}].points must contain 1 to ${MAX_POINTS_PER_CURVE} points`,
    );
  }
  const points = curve.points.map((point, pointIndex) => (
    normalizeCurvePoint(point, `curves[${index}]`, pointIndex, maxOffsetFrames)
  ));
  if (points[0].offsetFrames !== 0) {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      `curves[${index}] must begin at offsetFrames 0`,
    );
  }
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    if (points[pointIndex].offsetFrames <= points[pointIndex - 1].offsetFrames) {
      throw new MicromorphModelClientError(
        "nonmonotonic-control",
        `curves[${index}] point offsets must be strictly increasing`,
      );
    }
  }
  return Object.freeze({
    id,
    interpolation: "linear",
    points: Object.freeze(points),
  });
}

function curvesFromValue(curves) {
  if (Array.isArray(curves)) return curves;
  if (!isRecord(curves)) {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      "control curves must be an array or an object keyed by control id",
    );
  }
  return Object.entries(curves).map(([id, value]) => ({
    id,
    points: typeof value === "number" ? [{ offsetFrames: 0, value }] : value,
  }));
}

/**
 * Normalize a sample-clock control frame. Each curve replaces that control's
 * future automation from startFrame, linearly interpolates strictly increasing
 * offsets, and holds its final value until another replacement arrives.
 */
export function normalizeMicromorphControlCurveFrame(frame, {
  minimumStartFrame = 0,
  maxOffsetFrames = MAX_CURVE_OFFSET_FRAMES,
} = {}) {
  if (!isRecord(frame)) {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      "control-curve frame must be an object",
    );
  }
  if (frame.timestamp !== undefined) {
    throw new MicromorphModelClientError(
      "invalid-control-clock",
      "control-curve frames use integer startFrame values, not timestamps in seconds",
    );
  }
  const startFrame = boundedInteger(
    frame.startFrame,
    0,
    Number.MAX_SAFE_INTEGER,
    "control-curve startFrame",
    "invalid-control-curve",
  );
  if (startFrame < minimumStartFrame) {
    throw new MicromorphModelClientError(
      "nonmonotonic-control",
      "control-curve startFrame values must be monotonic",
    );
  }
  if (frame.mode !== undefined && frame.mode !== "replace") {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      "control-curve mode must be replace",
    );
  }
  const sourceCurves = curvesFromValue(frame.curves);
  if (sourceCurves.length === 0 || sourceCurves.length > MAX_CONTROLS) {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      `control-curve frames must contain 1 to ${MAX_CONTROLS} curves`,
    );
  }
  const curves = sourceCurves.map((curve, index) => normalizeCurve(curve, index, maxOffsetFrames));
  const ids = new Set(curves.map(({ id }) => id));
  if (ids.size !== curves.length) {
    throw new MicromorphModelClientError(
      "invalid-control-curve",
      "a control-curve frame cannot repeat a control id",
    );
  }
  const normalized = {
    type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONTROL_CURVE,
    startFrame,
    mode: "replace",
    curves: Object.freeze(curves),
  };
  if (frame.streamGeneration !== undefined) {
    normalized.streamGeneration = boundedInteger(
      frame.streamGeneration,
      1,
      UINT32_MAX,
      "control-curve streamGeneration",
      "invalid-control-curve",
    );
  }
  if (frame.sequence !== undefined) {
    normalized.sequence = boundedInteger(
      frame.sequence,
      0,
      Number.MAX_SAFE_INTEGER,
      "control-curve sequence",
      "invalid-control-curve",
    );
  }
  return Object.freeze(normalized);
}

function normalizePcmSamples(value, label) {
  let source;
  try {
    if (value instanceof Float32Array) {
      source = value;
    } else if (value instanceof ArrayBuffer) {
      if (value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
        throw new MicromorphModelClientError(
          "invalid-pcm",
          `${label} byte length must be divisible by four`,
        );
      }
      source = new Float32Array(value);
    } else if (ArrayBuffer.isView(value)) {
      const bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
        throw new MicromorphModelClientError(
          "invalid-pcm",
          `${label} byte length must be divisible by four`,
        );
      }
      source = new Float32Array(bytes);
    } else {
      throw new MicromorphModelClientError(
        "invalid-pcm",
        `${label} must be Float32 PCM in an ArrayBuffer or typed-array view`,
      );
    }
  } catch (error) {
    if (error instanceof MicromorphModelClientError) throw error;
    throw new MicromorphModelClientError("invalid-pcm", `${label} could not be read`);
  }
  if (source.length === 0 || source.length > MAX_PCM_SAMPLES) {
    throw new MicromorphModelClientError(
      "invalid-pcm",
      `${label} must contain 1 to ${MAX_PCM_SAMPLES} samples`,
    );
  }
  const copy = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    if (!Number.isFinite(source[index])) {
      throw new MicromorphModelClientError("invalid-pcm", `${label} samples must be finite`);
    }
    copy[index] = source[index];
  }
  return copy;
}

function writeSafeUint64(view, offset, value, label) {
  const integer = boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, label, "invalid-pcm");
  view.setUint32(offset, integer >>> 0, true);
  view.setUint32(offset + 4, Math.floor(integer / 0x1_0000_0000), true);
}

function readSafeUint64(view, offset, label) {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  const value = high * 0x1_0000_0000 + low;
  if (!Number.isSafeInteger(value)) {
    throw new MicromorphModelClientError("invalid-pcm", `${label} exceeds the safe integer range`);
  }
  return value;
}

function pcmKindCode(kind) {
  const name = typeof kind === "string" ? kind : PCM_KIND_NAMES[kind];
  const code = PCM_KIND_CODES[name];
  if (!code) {
    throw new MicromorphModelClientError("invalid-pcm", "PCM packet kind must be input or output");
  }
  return { code, name };
}

/** Encode one interleaved f32le PCM packet with the fixed MGA1 header. */
export function encodeMicromorphPcmPacket({
  kind,
  streamGeneration,
  sequence,
  startFrame,
  sampleRate,
  channels,
  samples,
}) {
  const normalizedKind = pcmKindCode(kind);
  const generation = boundedInteger(
    streamGeneration, 1, UINT32_MAX, "PCM streamGeneration", "invalid-pcm",
  );
  const packetSequence = boundedInteger(sequence, 1, UINT32_MAX, "PCM sequence", "invalid-pcm");
  const packetStartFrame = boundedInteger(
    startFrame, 0, Number.MAX_SAFE_INTEGER, "PCM startFrame", "invalid-pcm",
  );
  const packetSampleRate = boundedInteger(
    sampleRate, 8_000, 192_000, "PCM sampleRate", "invalid-pcm",
  );
  const packetChannels = boundedInteger(channels, 1, 8, "PCM channels", "invalid-pcm");
  const pcm = normalizePcmSamples(samples, "PCM packet");
  if (pcm.length % packetChannels !== 0) {
    throw new MicromorphModelClientError(
      "invalid-pcm",
      "PCM packet sample count must be divisible by channels",
    );
  }
  const frameCount = pcm.length / packetChannels;
  if (packetStartFrame + frameCount > Number.MAX_SAFE_INTEGER) {
    throw new MicromorphModelClientError("invalid-pcm", "PCM packet timeline exceeds safe integers");
  }
  const packet = new ArrayBuffer(PCM_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(packet);
  view.setUint32(0, PCM_MAGIC_NUMBER, true);
  view.setUint8(4, PCM_PACKET_VERSION);
  view.setUint8(5, normalizedKind.code);
  view.setUint8(6, packetChannels);
  view.setUint8(7, 0);
  view.setUint32(8, generation, true);
  view.setUint32(12, packetSequence, true);
  writeSafeUint64(view, 16, packetStartFrame, "PCM startFrame");
  view.setUint32(24, frameCount, true);
  view.setUint32(28, packetSampleRate, true);
  for (let index = 0; index < pcm.length; index += 1) {
    view.setFloat32(PCM_HEADER_BYTES + index * 4, pcm[index], true);
  }
  return packet;
}

/** Decode and validate one fixed-header MGA1 PCM packet. */
export function decodeMicromorphPcmPacket(value, { expectedKind } = {}) {
  let bytes;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    throw new MicromorphModelClientError("invalid-pcm", "PCM packet must be binary data");
  }
  if (bytes.byteLength < PCM_HEADER_BYTES) {
    throw new MicromorphModelClientError("invalid-pcm", "PCM packet is shorter than its header");
  }
  const copy = bytes.slice().buffer;
  const view = new DataView(copy);
  if (view.getUint32(0, true) !== PCM_MAGIC_NUMBER) {
    throw new MicromorphModelClientError("invalid-pcm", "PCM packet has an invalid MGA1 magic");
  }
  if (view.getUint8(4) !== PCM_PACKET_VERSION) {
    throw new MicromorphModelClientError("invalid-pcm", "PCM packet version is unsupported");
  }
  const kind = pcmKindCode(view.getUint8(5)).name;
  if (expectedKind !== undefined && kind !== pcmKindCode(expectedKind).name) {
    throw new MicromorphModelClientError(
      "invalid-pcm",
      `Expected a ${expectedKind} PCM packet but received ${kind}`,
    );
  }
  const channels = boundedInteger(view.getUint8(6), 1, 8, "PCM channels", "invalid-pcm");
  if (view.getUint8(7) !== 0) {
    throw new MicromorphModelClientError("invalid-pcm", "PCM packet flags must be zero");
  }
  const streamGeneration = boundedInteger(
    view.getUint32(8, true), 1, UINT32_MAX, "PCM streamGeneration", "invalid-pcm",
  );
  const sequence = boundedInteger(
    view.getUint32(12, true), 1, UINT32_MAX, "PCM sequence", "invalid-pcm",
  );
  const startFrame = readSafeUint64(view, 16, "PCM startFrame");
  const frameCount = boundedInteger(
    view.getUint32(24, true), 1, MAX_PCM_SAMPLES, "PCM frameCount", "invalid-pcm",
  );
  const sampleRate = boundedInteger(
    view.getUint32(28, true), 8_000, 192_000, "PCM sampleRate", "invalid-pcm",
  );
  const sampleCount = frameCount * channels;
  if (sampleCount > MAX_PCM_SAMPLES
    || copy.byteLength !== PCM_HEADER_BYTES + sampleCount * Float32Array.BYTES_PER_ELEMENT) {
    throw new MicromorphModelClientError(
      "invalid-pcm",
      "PCM packet frame count, channels, and payload length do not agree",
    );
  }
  if (startFrame + frameCount > Number.MAX_SAFE_INTEGER) {
    throw new MicromorphModelClientError("invalid-pcm", "PCM packet timeline exceeds safe integers");
  }
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getFloat32(PCM_HEADER_BYTES + index * 4, true);
    if (!Number.isFinite(sample)) {
      throw new MicromorphModelClientError("invalid-pcm", "PCM packet samples must be finite");
    }
    samples[index] = sample;
  }
  return Object.freeze({
    kind,
    streamGeneration,
    sequence,
    startFrame,
    frameCount,
    endFrame: startFrame + frameCount,
    sampleRate,
    channels,
    samples,
  });
}

function attachSocketListener(socket, type, listener) {
  if (typeof socket?.addEventListener === "function") {
    socket.addEventListener(type, listener);
    return () => socket.removeEventListener?.(type, listener);
  }
  const property = `on${type}`;
  socket[property] = listener;
  return () => {
    if (socket[property] === listener) socket[property] = null;
  };
}

function exactConfigMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeServerCapabilities(frame, { pcmInput, pcmOutput }) {
  if (!isRecord(frame.capabilities)) {
    throw new MicromorphModelClientError(
      "capability-mismatch",
      "Server hello must declare capabilities",
    );
  }
  const capabilities = Object.freeze({
    causalTransform: frame.capabilities.causalTransform === true,
    textAnchors: frame.capabilities.textAnchors === true,
    controlCurves: frame.capabilities.controlCurves === true,
    framedPcm: frame.capabilities.framedPcm === true,
    sampleClock: frame.capabilities.sampleClock === true,
    pcmInput: frame.capabilities.pcmInput === true,
    pcmOutput: frame.capabilities.pcmOutput === true,
    pcmFormat: frame.capabilities.pcmFormat,
  });
  const missing = [
    "causalTransform",
    "textAnchors",
    "controlCurves",
    "framedPcm",
    "sampleClock",
  ].filter((name) => !capabilities[name]);
  if (pcmInput && !capabilities.pcmInput) missing.push("pcmInput");
  if (pcmOutput && !capabilities.pcmOutput) missing.push("pcmOutput");
  if (capabilities.pcmFormat !== MICROMORPH_MODEL_PROTOCOL.PCM_FORMAT) {
    missing.push(`pcmFormat:${MICROMORPH_MODEL_PROTOCOL.PCM_FORMAT}`);
  }
  if (missing.length) {
    throw new MicromorphModelClientError(
      "capability-mismatch",
      `Server is missing required capabilities: ${missing.join(", ")}`,
    );
  }
  return capabilities;
}

function validHello(frame, requirements, streamGeneration) {
  if (!isRecord(frame)
    || frame.type !== MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.HELLO
    || frame.protocol !== MICROMORPH_MODEL_PROTOCOL.NAME
    || frame.version !== MICROMORPH_MODEL_PROTOCOL.VERSION) {
    throw new MicromorphModelClientError(
      "protocol-mismatch",
      `Micromorph requires ${MICROMORPH_MODEL_PROTOCOL.NAME} v${MICROMORPH_MODEL_PROTOCOL.VERSION}`,
    );
  }
  if (frame.role !== "server" && frame.role !== "model") {
    throw new MicromorphModelClientError(
      "invalid-frame",
      "server hello role must be server or model",
    );
  }
  if (frame.streamGeneration !== streamGeneration) {
    throw new MicromorphModelClientError(
      "stream-mismatch",
      "server hello must echo the current streamGeneration",
    );
  }
  return Object.freeze({
    type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.HELLO,
    protocol: MICROMORPH_MODEL_PROTOCOL.NAME,
    version: MICROMORPH_MODEL_PROTOCOL.VERSION,
    role: frame.role,
    streamGeneration,
    capabilities: normalizeServerCapabilities(frame, requirements),
  });
}

function normalizeRemoteStatus(frame) {
  const level = frame.level ?? "info";
  if (!["info", "warning", "error"].includes(level)) {
    throw new MicromorphModelClientError(
      "invalid-frame",
      "status level must be info, warning, or error",
    );
  }
  const normalized = { level };
  if (frame.code !== undefined) {
    normalized.code = boundedString(frame.code, "status code", { maximum: 64 });
  }
  if (frame.message !== undefined) {
    normalized.message = boundedString(frame.message, "status message", {
      maximum: MAX_REMOTE_STATUS_CHARACTERS,
      allowEmpty: true,
    });
  }
  if (frame.progress !== undefined) {
    normalized.progress = normalizedValue(frame.progress, "status progress");
  }
  if (frame.sampleFrame !== undefined) {
    normalized.sampleFrame = boundedInteger(
      frame.sampleFrame, 0, Number.MAX_SAFE_INTEGER, "status sampleFrame",
    );
  }
  if (frame.sequence !== undefined) {
    normalized.sequence = boundedInteger(
      frame.sequence, 0, Number.MAX_SAFE_INTEGER, "status sequence",
    );
  }
  if (Object.keys(normalized).length === 1) {
    throw new MicromorphModelClientError(
      "invalid-frame",
      "status must contain a bounded code, message, progress, or sampleFrame",
    );
  }
  return Object.freeze(normalized);
}

function closeReason(value) {
  return String(value ?? "").replace(/[^\x20-\x7e]/g, "?").slice(0, 96);
}

/**
 * Strict local transport for a causal Micromorph model host. The browser owns
 * stream geometry and the integer sample clock; the server may accept or fail,
 * but may not renegotiate geometry after the socket opens.
 */
export class MicromorphModelClient {
  #connectionEndpoint;

  constructor({
    endpoint,
    runtime = globalThis,
    WebSocket: WebSocketConstructor = runtime?.WebSocket,
    now: _legacyClock,
    clientName = "Morphazoid Micromorph",
    clientVersion = "1",
    pcmInput = true,
    pcmOutput = true,
    config = null,
    maxBufferedInputFrames = null,
    maxBufferedAmount = null,
    handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
  } = {}) {
    this.#connectionEndpoint = validateMicromorphEndpoint(endpoint);
    this.endpoint = redactMicromorphEndpoint(this.#connectionEndpoint);
    this.runtime = runtime;
    this.WebSocketConstructor = typeof WebSocketConstructor === "function"
      ? WebSocketConstructor
      : null;
    this.clientName = boundedString(clientName, "clientName", { maximum: 96 });
    this.clientVersion = boundedString(clientVersion, "clientVersion", { maximum: 32 });
    this.pcmInput = Boolean(pcmInput);
    this.pcmOutput = Boolean(pcmOutput);
    this.desiredConfig = config === null ? null : normalizeMicromorphConfig(config);
    if (maxBufferedInputFrames !== null && maxBufferedAmount !== null) {
      throw new MicromorphModelClientError(
        "invalid-config",
        "Choose maxBufferedInputFrames or legacy maxBufferedAmount, not both",
      );
    }
    if (maxBufferedInputFrames !== null) {
      this.requestedFrameBudget = boundedInteger(
        maxBufferedInputFrames, 1, MAX_PCM_SAMPLES, "maxBufferedInputFrames", "invalid-config",
      );
    } else if (maxBufferedAmount !== null) {
      const legacyBytes = boundedInteger(
        maxBufferedAmount, 0, 64 * 1024 * 1024, "maxBufferedAmount", "invalid-config",
      );
      const channels = Math.max(1, this.desiredConfig?.inputChannels ?? 1);
      this.requestedFrameBudget = Math.max(1, Math.floor(legacyBytes / (channels * 4)));
    } else {
      this.requestedFrameBudget = null;
    }
    this.handshakeTimeoutMs = boundedInteger(
      handshakeTimeoutMs, 1, 120_000, "handshakeTimeoutMs", "invalid-config",
    );
    this.setTimer = typeof runtime?.setTimeout === "function"
      ? runtime.setTimeout.bind(runtime)
      : globalThis.setTimeout.bind(globalThis);
    this.clearTimer = typeof runtime?.clearTimeout === "function"
      ? runtime.clearTimeout.bind(runtime)
      : globalThis.clearTimeout.bind(globalThis);

    this.negotiatedConfig = null;
    this.serverHello = null;
    this.algorithmicLatencyFrames = null;
    this.outputHopFrames = null;
    this.serverModelId = null;
    this.modelReady = false;
    this.remoteStatus = null;
    this.socket = null;
    this.socketReleases = [];
    this.connectionGeneration = 0;
    this.streamGeneration = 0;
    this.handshakeTimer = null;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
    this.sequence = 0;
    this.configRequestSequence = null;
    this.pcmInputSequence = 0;
    this.lastPcmOutputSequence = 0;
    this.nextInputFrame = 0;
    this.nextOutputFrame = 0;
    this.lastOutputStartFrame = null;
    this.lastOutboundControlStartFrame = 0;
    this.lastInboundControlStartFrame = 0;
    this.pendingInputGap = null;
    this.droppedPcmInputFrames = 0;
    this.lastError = null;
    this.statusListeners = new Set();
    this.remoteStatusListeners = new Set();
    this.controlCurveListeners = new Set();
    this.pcmOutputListeners = new Set();
    this.protocolErrorListeners = new Set();
    this.state = this.WebSocketConstructor
      ? MICROMORPH_MODEL_CLIENT_STATES.DISCONNECTED
      : MICROMORPH_MODEL_CLIENT_STATES.MODEL_UNAVAILABLE;
  }

  frameBudget() {
    return this.requestedFrameBudget
      ?? ((this.desiredConfig?.blockSize ?? 1) * DEFAULT_BACKPRESSURE_BLOCKS);
  }

  effectivePcmInput() {
    return Boolean(this.pcmInput && this.desiredConfig?.inputChannels > 0);
  }

  effectivePcmOutput() {
    return Boolean(this.pcmOutput && this.desiredConfig?.outputChannels > 0);
  }

  currentSampleFrame() {
    return Math.max(this.nextInputFrame, this.nextOutputFrame);
  }

  getStatus() {
    const config = this.negotiatedConfig ?? this.desiredConfig;
    const inputChannels = Math.max(1, config?.inputChannels ?? 1);
    return Object.freeze({
      state: this.state,
      available: this.state !== MICROMORPH_MODEL_CLIENT_STATES.MODEL_UNAVAILABLE,
      connected: socketIsOpen(this.socket),
      ready: this.state === MICROMORPH_MODEL_CLIENT_STATES.READY,
      endpoint: this.endpoint,
      protocol: MICROMORPH_MODEL_PROTOCOL.NAME,
      protocolVersion: MICROMORPH_MODEL_PROTOCOL.VERSION,
      configured: Boolean(this.negotiatedConfig),
      config,
      streamGeneration: this.streamGeneration || null,
      serverCapabilities: this.serverHello?.capabilities ?? null,
      algorithmicLatencyFrames: this.algorithmicLatencyFrames,
      outputHopFrames: this.outputHopFrames,
      serverModelId: this.serverModelId,
      inputSampleFrame: this.nextInputFrame,
      inputFrameCursor: this.nextInputFrame,
      outputSampleFrame: this.nextOutputFrame,
      lastOutputStartFrame: this.lastOutputStartFrame,
      outputLagFrames: Math.max(0, this.nextInputFrame - this.nextOutputFrame),
      excessOutputLagFrames: Math.max(
        0,
        this.nextInputFrame
          - this.nextOutputFrame
          - (this.algorithmicLatencyFrames ?? 0),
      ),
      maxBufferedInputFrames: this.frameBudget(),
      maxBufferedAmount: this.frameBudget() * inputChannels * 4,
      droppedPcmInputFrames: this.droppedPcmInputFrames,
      pendingInputGapFrames: this.pendingInputGap?.frameCount ?? 0,
      remoteStatus: this.remoteStatus,
      lastError: frozenError(this.lastError),
    });
  }

  publishStatus() {
    const status = this.getStatus();
    for (const listener of this.statusListeners) safeCall(listener, status);
  }

  transition(state, error = null) {
    this.state = state;
    this.lastError = error;
    this.publishStatus();
  }

  subscribeStatus(listener, { emitCurrent = true } = {}) {
    if (typeof listener !== "function") throw new TypeError("status listener must be a function");
    this.statusListeners.add(listener);
    if (emitCurrent) safeCall(listener, this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  subscribeRemoteStatus(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== "function") {
      throw new TypeError("remote-status listener must be a function");
    }
    this.remoteStatusListeners.add(listener);
    if (emitCurrent && this.remoteStatus) safeCall(listener, this.remoteStatus);
    return () => this.remoteStatusListeners.delete(listener);
  }

  subscribeControlCurves(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("control-curve listener must be a function");
    }
    this.controlCurveListeners.add(listener);
    return () => this.controlCurveListeners.delete(listener);
  }

  subscribePcmOutput(listener) {
    if (typeof listener !== "function") throw new TypeError("PCM listener must be a function");
    this.pcmOutputListeners.add(listener);
    return () => this.pcmOutputListeners.delete(listener);
  }

  subscribeProtocolErrors(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("protocol-error listener must be a function");
    }
    this.protocolErrorListeners.add(listener);
    return () => this.protocolErrorListeners.delete(listener);
  }

  nextSequence() {
    this.sequence = this.sequence >= Number.MAX_SAFE_INTEGER ? 0 : this.sequence + 1;
    return this.sequence;
  }

  nextInputPacketSequence() {
    this.pcmInputSequence = this.pcmInputSequence >= UINT32_MAX ? 1 : this.pcmInputSequence + 1;
    return this.pcmInputSequence;
  }

  requireOpenSocket() {
    if (!socketIsOpen(this.socket)) {
      throw new MicromorphModelClientError(
        "not-connected",
        "Micromorph model socket is not connected",
      );
    }
    return this.socket;
  }

  requireReadySocket() {
    const socket = this.requireOpenSocket();
    if (this.state !== MICROMORPH_MODEL_CLIENT_STATES.READY) {
      throw new MicromorphModelClientError(
        "model-not-ready",
        "Micromorph model has not completed its handshake",
      );
    }
    return socket;
  }

  sendJson(frame) {
    const text = JSON.stringify(frame);
    if (text.length > MAX_JSON_CHARACTERS) {
      throw new MicromorphModelClientError("frame-too-large", "Micromorph JSON frame is too large");
    }
    this.requireOpenSocket().send(text);
    return frame;
  }

  helloFrame() {
    return Object.freeze({
      type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.HELLO,
      protocol: MICROMORPH_MODEL_PROTOCOL.NAME,
      version: MICROMORPH_MODEL_PROTOCOL.VERSION,
      role: "client",
      sequence: this.nextSequence(),
      streamGeneration: this.streamGeneration,
      client: Object.freeze({ name: this.clientName, version: this.clientVersion }),
      capabilities: Object.freeze({
        causalTransform: true,
        textAnchors: true,
        controlCurves: true,
        framedPcm: true,
        sampleClock: true,
        pcmInput: this.effectivePcmInput(),
        pcmOutput: this.effectivePcmOutput(),
        pcmFormat: MICROMORPH_MODEL_PROTOCOL.PCM_FORMAT,
      }),
    });
  }

  configFrame(config) {
    const frame = Object.freeze({
      type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONFIG,
      sequence: this.nextSequence(),
      streamGeneration: this.streamGeneration,
      config,
    });
    this.configRequestSequence = frame.sequence;
    return frame;
  }

  conditionFrame(condition, startFrame) {
    return Object.freeze({
      type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONDITION,
      sequence: this.nextSequence(),
      streamGeneration: this.streamGeneration,
      startFrame,
      condition,
    });
  }

  configure(config) {
    if (this.socket || [
      MICROMORPH_MODEL_CLIENT_STATES.CONNECTING,
      MICROMORPH_MODEL_CLIENT_STATES.CONNECTED,
      MICROMORPH_MODEL_CLIENT_STATES.READY,
    ].includes(this.state)) {
      throw new MicromorphModelClientError(
        "config-locked",
        "Micromorph stream geometry is immutable until disconnect",
      );
    }
    this.desiredConfig = normalizeMicromorphConfig(config);
    this.publishStatus();
    return this.desiredConfig;
  }

  sendCondition(condition, { startFrame = this.currentSampleFrame() } = {}) {
    this.requireReadySocket();
    const frameStart = boundedInteger(
      startFrame, 0, Number.MAX_SAFE_INTEGER, "condition startFrame", "invalid-condition",
    );
    if (frameStart < this.currentSampleFrame()) {
      throw new MicromorphModelClientError(
        "invalid-condition",
        "condition startFrame cannot precede the current sample cursor",
      );
    }
    const normalized = normalizeMicromorphCondition(condition);
    return this.sendJson(this.conditionFrame(normalized, frameStart));
  }

  connect(config = null) {
    if (config !== null) {
      if (this.socket) {
        return Promise.reject(new MicromorphModelClientError(
          "config-locked",
          "Micromorph stream geometry is immutable until disconnect",
        ));
      }
      this.desiredConfig = normalizeMicromorphConfig(config);
    }
    if (!this.WebSocketConstructor) {
      const error = new MicromorphModelClientError(
        "model-unavailable",
        "Micromorph is unavailable because this runtime has no WebSocket implementation",
      );
      this.transition(MICROMORPH_MODEL_CLIENT_STATES.MODEL_UNAVAILABLE, error);
      return Promise.reject(error);
    }
    if (!this.desiredConfig) {
      const error = new MicromorphModelClientError(
        "invalid-config",
        "Micromorph requires browser-owned stream geometry before connecting",
      );
      this.transition(MICROMORPH_MODEL_CLIENT_STATES.ERROR, error);
      return Promise.reject(error);
    }
    if (socketIsOpen(this.socket) && this.state === MICROMORPH_MODEL_CLIENT_STATES.READY) {
      return Promise.resolve(this.getStatus());
    }
    if (this.connectPromise) return this.connectPromise;
    if (this.socket) this.disconnect("replace stale socket");

    this.connectionGeneration += 1;
    const generation = this.connectionGeneration;
    this.streamGeneration = this.streamGeneration >= UINT32_MAX ? 1 : this.streamGeneration + 1;
    this.resetSessionState();
    this.transition(MICROMORPH_MODEL_CLIENT_STATES.CONNECTING);

    const pending = new Promise((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    this.connectPromise = pending;

    let socket;
    try {
      socket = new this.WebSocketConstructor(this.#connectionEndpoint);
      socket.binaryType = "arraybuffer";
    } catch (cause) {
      this.finishConnectionError(new MicromorphModelClientError(
        "connection-failed",
        "Micromorph model socket could not be created",
        { cause },
      ));
      return pending;
    }
    this.socket = socket;
    this.socketReleases = [
      attachSocketListener(socket, "open", () => this.handleOpen(socket, generation)),
      attachSocketListener(socket, "message", (event) => {
        this.handleMessage(event?.data, socket, generation).catch((error) => {
          this.handleInboundFailure(error);
        });
      }),
      attachSocketListener(socket, "error", () => this.handleSocketError(socket, generation)),
      attachSocketListener(socket, "close", (event) => this.handleClose(event, socket, generation)),
    ];
    return pending;
  }

  resetSessionState() {
    this.clearHandshakeTimer();
    this.negotiatedConfig = null;
    this.serverHello = null;
    this.algorithmicLatencyFrames = null;
    this.outputHopFrames = null;
    this.serverModelId = null;
    this.modelReady = false;
    this.remoteStatus = null;
    this.configRequestSequence = null;
    this.pcmInputSequence = 0;
    this.lastPcmOutputSequence = 0;
    this.nextInputFrame = 0;
    this.nextOutputFrame = 0;
    this.lastOutputStartFrame = null;
    this.lastOutboundControlStartFrame = 0;
    this.lastInboundControlStartFrame = 0;
    this.pendingInputGap = null;
    this.droppedPcmInputFrames = 0;
  }

  handleOpen(socket, generation) {
    if (socket !== this.socket || generation !== this.connectionGeneration) return;
    try {
      this.transition(MICROMORPH_MODEL_CLIENT_STATES.CONNECTED);
      this.sendJson(this.helloFrame());
      this.sendJson(this.configFrame(this.desiredConfig));
      this.startHandshakeTimer(socket, generation);
    } catch (error) {
      this.fatalProtocolError(error, "handshake");
    }
  }

  startHandshakeTimer(socket, generation) {
    this.clearHandshakeTimer();
    this.handshakeTimer = this.setTimer(() => {
      if (socket !== this.socket || generation !== this.connectionGeneration
        || this.state === MICROMORPH_MODEL_CLIENT_STATES.READY) return;
      this.fatalProtocolError(new MicromorphModelClientError(
        "handshake-timeout",
        `Micromorph handshake did not complete within ${this.handshakeTimeoutMs}ms`,
      ), "handshake");
    }, this.handshakeTimeoutMs);
    this.handshakeTimer?.unref?.();
  }

  clearHandshakeTimer() {
    if (this.handshakeTimer !== null) {
      this.clearTimer(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  handleSocketError(socket, generation) {
    if (socket !== this.socket || generation !== this.connectionGeneration) return;
    this.finishConnectionError(new MicromorphModelClientError(
      "connection-failed",
      "Micromorph model socket reported a connection error",
    ));
  }

  handleClose(event, socket, generation) {
    if (socket !== this.socket || generation !== this.connectionGeneration) return;
    const pendingReject = this.rejectConnect;
    const beforeReady = this.state !== MICROMORPH_MODEL_CLIENT_STATES.READY;
    const error = beforeReady
      ? new MicromorphModelClientError(
        "connection-closed",
        "Micromorph model socket closed before model-ready",
      )
      : event?.wasClean === false
        ? new MicromorphModelClientError(
          "connection-closed",
          `Micromorph model socket closed unexpectedly${event.reason ? `: ${event.reason}` : ""}`,
        )
        : null;
    this.clearHandshakeTimer();
    this.releaseSocketListeners();
    this.socket = null;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
    if (pendingReject) pendingReject(error);
    this.transition(
      beforeReady ? MICROMORPH_MODEL_CLIENT_STATES.ERROR : MICROMORPH_MODEL_CLIENT_STATES.DISCONNECTED,
      error,
    );
  }

  finishConnectionError(error) {
    const socket = this.socket;
    const reject = this.rejectConnect;
    this.clearHandshakeTimer();
    this.releaseSocketListeners();
    this.socket = null;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
    if (socket && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) {
      try {
        socket.close(1011, closeReason(error.code));
      } catch {
        // Connection failure teardown is best-effort.
      }
    }
    this.transition(MICROMORPH_MODEL_CLIENT_STATES.ERROR, error);
    reject?.(error);
  }

  releaseSocketListeners() {
    for (const release of this.socketReleases.splice(0)) {
      try {
        release();
      } catch {
        // Socket teardown is best-effort; stale callbacks are generation-guarded.
      }
    }
  }

  disconnect(reason = "client disconnect") {
    this.connectionGeneration += 1;
    const socket = this.socket;
    const pendingReject = this.rejectConnect;
    this.clearHandshakeTimer();
    this.releaseSocketListeners();
    this.socket = null;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
    if (pendingReject) {
      pendingReject(new MicromorphModelClientError("connection-cancelled", "Connection cancelled"));
    }
    if (socket && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) {
      try {
        socket.close(1000, closeReason(reason));
      } catch {
        // A socket may close itself between the readyState check and close().
      }
    }
    this.resetSessionState();
    const state = this.WebSocketConstructor
      ? MICROMORPH_MODEL_CLIENT_STATES.DISCONNECTED
      : MICROMORPH_MODEL_CLIENT_STATES.MODEL_UNAVAILABLE;
    if (this.state !== state || this.lastError) this.transition(state);
  }

  dispose() {
    this.disconnect("dispose");
    this.statusListeners.clear();
    this.remoteStatusListeners.clear();
    this.controlCurveListeners.clear();
    this.pcmOutputListeners.clear();
    this.protocolErrorListeners.clear();
  }

  activeConfig() {
    return this.negotiatedConfig ?? this.desiredConfig;
  }

  requireConfiguredControls(frame) {
    const controls = this.activeConfig()?.controls ?? [];
    if (controls.length === 0) return frame;
    const configuredIds = new Set(controls.map(({ id }) => id));
    const unknown = frame.curves.find(({ id }) => !configuredIds.has(id));
    if (unknown) {
      throw new MicromorphModelClientError(
        "unknown-control",
        `Control ${unknown.id} is not declared by the active Micromorph config`,
      );
    }
    return frame;
  }

  sendControlCurve(curves, options = {}) {
    this.requireReadySocket();
    if (options.timestamp !== undefined) {
      throw new MicromorphModelClientError(
        "invalid-control-clock",
        "sendControlCurve uses startFrame, not a timestamp in seconds",
      );
    }
    const startFrame = options.startFrame ?? this.currentSampleFrame();
    const frame = this.requireConfiguredControls(normalizeMicromorphControlCurveFrame({
      type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONTROL_CURVE,
      sequence: this.nextSequence(),
      streamGeneration: this.streamGeneration,
      startFrame,
      mode: "replace",
      curves,
    }, {
      minimumStartFrame: Math.max(
        this.lastOutboundControlStartFrame,
        this.currentSampleFrame(),
      ),
      maxOffsetFrames: this.activeConfig().sampleRate * 60,
    }));
    this.sendJson(frame);
    this.lastOutboundControlStartFrame = frame.startFrame;
    return frame;
  }

  sendControls(controls, options) {
    return this.sendControlCurve(controls, options);
  }

  recordInputGap(startFrame, frameCount, sequence) {
    const expectedSequence = this.pendingInputGap?.lastPcmSequence === UINT32_MAX
      ? 1
      : (this.pendingInputGap?.lastPcmSequence ?? 0) + 1;
    if (this.pendingInputGap
      && this.pendingInputGap.startFrame + this.pendingInputGap.frameCount === startFrame
      && expectedSequence === sequence) {
      this.pendingInputGap.frameCount += frameCount;
      this.pendingInputGap.lastPcmSequence = sequence;
      return;
    }
    this.pendingInputGap = {
      startFrame,
      frameCount,
      firstPcmSequence: sequence,
      lastPcmSequence: sequence,
    };
  }

  flushInputGap() {
    if (!this.pendingInputGap) return null;
    const gap = Object.freeze({
      type: MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.INPUT_GAP,
      sequence: this.nextSequence(),
      streamGeneration: this.streamGeneration,
      reason: "backpressure",
      startFrame: this.pendingInputGap.startFrame,
      frameCount: this.pendingInputGap.frameCount,
      firstPcmSequence: this.pendingInputGap.firstPcmSequence,
      lastPcmSequence: this.pendingInputGap.lastPcmSequence,
    });
    this.sendJson(gap);
    this.pendingInputGap = null;
    return gap;
  }

  sendPcmInput(samples) {
    if (!this.pcmInput) {
      throw new MicromorphModelClientError("pcm-unavailable", "PCM input is disabled for this client");
    }
    const socket = this.requireReadySocket();
    const config = this.activeConfig();
    if (!config || config.inputChannels < 1) {
      throw new MicromorphModelClientError(
        "pcm-unavailable",
        "PCM input requires a config with at least one input channel",
      );
    }
    const pcm = normalizePcmSamples(samples, "PCM input");
    if (pcm.length % config.inputChannels !== 0) {
      throw new MicromorphModelClientError(
        "invalid-pcm",
        "PCM input sample count must be divisible by inputChannels",
      );
    }
    const frames = pcm.length / config.inputChannels;
    if (frames > config.blockSize) {
      throw new MicromorphModelClientError(
        "invalid-pcm",
        "PCM input frame count cannot exceed the browser-requested blockSize",
      );
    }
    if (this.nextInputFrame + frames > Number.MAX_SAFE_INTEGER) {
      throw new MicromorphModelClientError("invalid-pcm", "PCM input timeline is exhausted");
    }
    const startFrame = this.nextInputFrame;
    const sequence = this.nextInputPacketSequence();
    this.nextInputFrame += frames;
    const bufferedAmount = Math.max(0, Number(socket.bufferedAmount) || 0);
    const bytesPerFrame = config.inputChannels * Float32Array.BYTES_PER_ELEMENT;
    const bufferedFrames = Math.ceil(bufferedAmount / bytesPerFrame);
    if (bufferedFrames + frames > this.frameBudget()) {
      this.recordInputGap(startFrame, frames, sequence);
      this.droppedPcmInputFrames += frames;
      this.publishStatus();
      return Object.freeze({
        channels: config.inputChannels,
        frames,
        sampleRate: config.sampleRate,
        startFrame,
        endFrame: startFrame + frames,
        sequence,
        bufferedAmount,
        bufferedFrames,
        dropped: true,
      });
    }
    const packet = encodeMicromorphPcmPacket({
      kind: "input",
      streamGeneration: this.streamGeneration,
      sequence,
      startFrame,
      sampleRate: config.sampleRate,
      channels: config.inputChannels,
      samples: pcm,
    });
    const gap = this.flushInputGap();
    socket.send(packet);
    if (gap) this.publishStatus();
    return Object.freeze({
      channels: config.inputChannels,
      frames,
      sampleRate: config.sampleRate,
      startFrame,
      endFrame: startFrame + frames,
      sequence,
      bufferedAmount,
      bufferedFrames,
      dropped: false,
      gap,
    });
  }

  async handleMessage(data, socket, generation) {
    if (socket !== this.socket || generation !== this.connectionGeneration) return;
    if (typeof data === "string") {
      this.handleJsonMessage(data);
      return;
    }
    let binary = data;
    if (binary && typeof binary.arrayBuffer === "function") binary = await binary.arrayBuffer();
    if (socket !== this.socket || generation !== this.connectionGeneration) return;
    if (this.state !== MICROMORPH_MODEL_CLIENT_STATES.READY) {
      this.fatalProtocolError(new MicromorphModelClientError(
        "handshake-order",
        "PCM cannot arrive before model-ready",
      ), "binary-pcm");
      return;
    }
    this.handlePcmOutput(binary);
  }

  handleJsonMessage(text) {
    if (text.length > MAX_JSON_CHARACTERS) {
      this.handleInboundFailure(new MicromorphModelClientError(
        "frame-too-large",
        "Incoming Micromorph JSON frame is too large",
      ));
      return;
    }
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      this.handleInboundFailure(new MicromorphModelClientError(
        "invalid-json",
        "Incoming Micromorph frame is not valid JSON",
      ));
      return;
    }
    if (!isRecord(frame) || typeof frame.type !== "string") {
      this.handleInboundFailure(new MicromorphModelClientError(
        "invalid-frame",
        "Incoming Micromorph JSON must be an object with a type",
      ));
      return;
    }
    try {
      switch (frame.type) {
        case MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.HELLO:
          this.acceptServerHello(frame);
          break;
        case MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONFIG_ACCEPTED:
          this.acceptConfig(frame);
          break;
        case MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.MODEL_READY:
          this.acceptModelReady(frame);
          break;
        case MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONFIG:
          throw new MicromorphModelClientError(
            "server-config-forbidden",
            "The server cannot configure or reconfigure browser-owned stream geometry",
          );
        case MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONTROL_CURVE:
          this.acceptControlCurve(frame);
          break;
        case MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.STATUS:
          this.acceptRemoteStatus(frame);
          break;
        case MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.ERROR:
          this.acceptRemoteError(frame);
          break;
        default:
          throw new MicromorphModelClientError(
            "unsupported-frame",
            `Unsupported Micromorph frame type: ${frame.type}`,
          );
      }
    } catch (error) {
      const alwaysFatal = [
        MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.HELLO,
        MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONFIG,
        MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.CONFIG_ACCEPTED,
        MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.MODEL_READY,
        MICROMORPH_MODEL_PROTOCOL.FRAME_TYPES.ERROR,
      ].includes(frame.type);
      this.handleInboundFailure(error, frame.type, { alwaysFatal });
    }
  }

  acceptServerHello(frame) {
    if (this.serverHello || this.state !== MICROMORPH_MODEL_CLIENT_STATES.CONNECTED) {
      throw new MicromorphModelClientError(
        "handshake-order",
        "Server hello must appear exactly once before config-accepted",
      );
    }
    this.serverHello = validHello(frame, {
      pcmInput: this.effectivePcmInput(),
      pcmOutput: this.effectivePcmOutput(),
    }, this.streamGeneration);
    this.publishStatus();
  }

  acceptConfig(frame) {
    if (!this.serverHello || this.negotiatedConfig || this.modelReady) {
      throw new MicromorphModelClientError(
        "handshake-order",
        "config-accepted must appear once after the server hello",
      );
    }
    if (frame.streamGeneration !== this.streamGeneration) {
      throw new MicromorphModelClientError(
        "stream-mismatch",
        "config-accepted must echo the current streamGeneration",
      );
    }
    if (frame.replyTo !== this.configRequestSequence) {
      throw new MicromorphModelClientError(
        "config-mismatch",
        "config-accepted must reply to the browser config sequence",
      );
    }
    const accepted = normalizeMicromorphConfig(frame.config);
    if (!exactConfigMatch(accepted, this.desiredConfig)) {
      throw new MicromorphModelClientError(
        "config-mismatch",
        "The server must echo the browser-requested geometry and controls exactly",
      );
    }
    const algorithmicLatencyFrames = boundedInteger(
      frame.algorithmicLatencyFrames,
      0,
      this.desiredConfig.sampleRate * 60,
      "algorithmicLatencyFrames",
      "config-mismatch",
    );
    const outputHopFrames = boundedInteger(
      frame.outputHopFrames,
      1,
      this.desiredConfig.blockSize,
      "outputHopFrames",
      "config-mismatch",
    );
    const serverModelId = boundedString(frame.modelId, "config-accepted modelId", {
      maximum: 128,
    });
    this.negotiatedConfig = this.desiredConfig;
    this.algorithmicLatencyFrames = algorithmicLatencyFrames;
    this.outputHopFrames = outputHopFrames;
    this.serverModelId = serverModelId;
    this.publishStatus();
  }

  acceptModelReady(frame) {
    if (!this.serverHello || !this.negotiatedConfig || this.modelReady
      || this.state !== MICROMORPH_MODEL_CLIENT_STATES.CONNECTED) {
      throw new MicromorphModelClientError(
        "handshake-order",
        "model-ready must appear once after config-accepted",
      );
    }
    if (frame.streamGeneration !== this.streamGeneration || frame.startFrame !== 0) {
      throw new MicromorphModelClientError(
        "stream-mismatch",
        "model-ready must echo streamGeneration and startFrame 0",
      );
    }
    this.modelReady = true;
    this.clearHandshakeTimer();
    this.transition(MICROMORPH_MODEL_CLIENT_STATES.READY);
    const resolve = this.resolveConnect;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
    resolve?.(this.getStatus());
  }

  acceptControlCurve(frame) {
    if (this.state !== MICROMORPH_MODEL_CLIENT_STATES.READY) {
      throw new MicromorphModelClientError(
        "handshake-order",
        "control-curve cannot arrive before model-ready",
      );
    }
    const controlFrame = this.requireConfiguredControls(normalizeMicromorphControlCurveFrame(frame, {
      minimumStartFrame: this.lastInboundControlStartFrame,
      maxOffsetFrames: this.activeConfig().sampleRate * 60,
    }));
    if (controlFrame.streamGeneration !== this.streamGeneration) {
      throw new MicromorphModelClientError(
        "stream-mismatch",
        "control-curve streamGeneration does not match this session",
      );
    }
    this.lastInboundControlStartFrame = controlFrame.startFrame;
    for (const listener of this.controlCurveListeners) safeCall(listener, controlFrame);
  }

  acceptRemoteStatus(frame) {
    const status = normalizeRemoteStatus(frame);
    this.remoteStatus = status;
    this.publishStatus();
    for (const listener of this.remoteStatusListeners) safeCall(listener, status);
  }

  acceptRemoteError(frame) {
    const code = boundedString(frame.code ?? "remote-error", "error code", { maximum: 64 });
    const message = boundedString(
      frame.message ?? "Micromorph model reported an error",
      "error message",
      { maximum: MAX_REMOTE_STATUS_CHARACTERS },
    );
    throw new MicromorphModelClientError(code, message);
  }

  handlePcmOutput(binary) {
    if (!this.pcmOutput) {
      this.reportProtocolError(new MicromorphModelClientError(
        "pcm-unavailable",
        "Received PCM while PCM output is disabled",
      ), "binary-pcm");
      return;
    }
    const config = this.activeConfig();
    if (!config || config.outputChannels < 1) {
      this.reportProtocolError(new MicromorphModelClientError(
        "pcm-unavailable",
        "Received PCM without an output-channel config",
      ), "binary-pcm");
      return;
    }
    let packet;
    try {
      packet = decodeMicromorphPcmPacket(binary, { expectedKind: "output" });
      if (packet.streamGeneration !== this.streamGeneration) {
        throw new MicromorphModelClientError(
          "stream-mismatch",
          "PCM output streamGeneration does not match this session",
        );
      }
      if (packet.sampleRate !== config.sampleRate || packet.channels !== config.outputChannels) {
        throw new MicromorphModelClientError(
          "config-mismatch",
          "PCM output geometry differs from the browser-owned config",
        );
      }
      if (packet.frameCount > this.outputHopFrames) {
        throw new MicromorphModelClientError(
          "invalid-pcm",
          "PCM output frameCount exceeds the accepted outputHopFrames",
        );
      }
      const expectedSequence = this.lastPcmOutputSequence === UINT32_MAX
        ? 1
        : this.lastPcmOutputSequence + 1;
      if (packet.sequence !== expectedSequence) {
        throw new MicromorphModelClientError(
          "pcm-sequence",
          "PCM output sequence must begin at 1 and increase by one",
        );
      }
      if (packet.startFrame !== this.nextOutputFrame) {
        throw new MicromorphModelClientError(
          "pcm-timeline",
          "PCM output packets must be contiguous on the shared sample timeline",
        );
      }
    } catch (error) {
      if (error?.code === "config-mismatch") {
        this.fatalProtocolError(error, "binary-pcm");
        return;
      }
      this.reportProtocolError(error, "binary-pcm");
      return;
    }
    this.lastPcmOutputSequence = packet.sequence;
    this.nextOutputFrame = packet.endFrame;
    this.lastOutputStartFrame = packet.startFrame;
    const block = Object.freeze({
      samples: packet.samples,
      channels: packet.channels,
      frames: packet.frameCount,
      sampleRate: packet.sampleRate,
      startFrame: packet.startFrame,
      endFrame: packet.endFrame,
      sequence: packet.sequence,
      streamGeneration: packet.streamGeneration,
      inputFrameCursor: this.nextInputFrame,
      lagFrames: Math.max(0, this.nextInputFrame - packet.endFrame),
      excessLagFrames: Math.max(
        0,
        this.nextInputFrame - packet.endFrame - this.algorithmicLatencyFrames,
      ),
      algorithmicLatencyFrames: this.algorithmicLatencyFrames,
      outputHopFrames: this.outputHopFrames,
    });
    for (const listener of this.pcmOutputListeners) safeCall(listener, block);
  }

  handleInboundFailure(error, frameType = null, { alwaysFatal = false } = {}) {
    if (alwaysFatal || this.state !== MICROMORPH_MODEL_CLIENT_STATES.READY) {
      this.fatalProtocolError(error, frameType);
      return;
    }
    this.reportProtocolError(error, frameType);
  }

  normalizedProtocolError(error) {
    return error instanceof MicromorphModelClientError
      ? error
      : new MicromorphModelClientError("invalid-frame", String(error?.message || error));
  }

  notifyProtocolError(error, frameType) {
    const detail = Object.freeze({
      ...frozenError(error),
      frameType: frameType === null ? null : String(frameType),
    });
    for (const listener of this.protocolErrorListeners) safeCall(listener, detail);
  }

  reportProtocolError(error, frameType = null) {
    const normalized = this.normalizedProtocolError(error);
    this.lastError = normalized;
    this.publishStatus();
    this.notifyProtocolError(normalized, frameType);
  }

  fatalProtocolError(error, frameType = null) {
    const normalized = this.normalizedProtocolError(error);
    const socket = this.socket;
    const reject = this.rejectConnect;
    this.connectionGeneration += 1;
    this.clearHandshakeTimer();
    this.releaseSocketListeners();
    this.socket = null;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
    if (socket && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) {
      try {
        socket.close(1002, closeReason(normalized.code));
      } catch {
        // Protocol teardown is best-effort after listeners are detached.
      }
    }
    this.transition(MICROMORPH_MODEL_CLIENT_STATES.ERROR, normalized);
    this.notifyProtocolError(normalized, frameType);
    reject?.(normalized);
  }
}

export function createMicromorphModelClient(options) {
  return new MicromorphModelClient(options);
}
