import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UINT32_RANGE = 0x1_0000_0000;
const MAX_ANCHOR_CHARACTERS = 512;
const MAX_GAP_SECONDS = 60;
const TAU = Math.PI * 2;

export const MICROMORPH_ENGINE_CONTROL_IDS = Object.freeze([
  "derivation",
  "material",
  "structure_lock",
  "memory",
  "mutation",
  "continuation",
]);

export const MICROMORPH_ENGINE_DEFAULT_CONTROLS = Object.freeze({
  derivation: 0.56,
  material: 0.5,
  structure_lock: 0.74,
  memory: 0.62,
  mutation: 0.22,
  continuation: 0.2,
});

export const MICROMORPH_ENGINE_MODES = Object.freeze({
  LIVE_MORPH: "live-morph",
  GENERATIVE_DELAY: "generative-delay",
  DIFFUSION_CANVAS: "diffusion-canvas",
});

export const MICROMORPH_ENGINE_PROCESSING_MODES = Object.freeze(
  Object.values(MICROMORPH_ENGINE_MODES),
);

const LIVE_MORPH_IDENTITY = Object.freeze({
  id: "micromorph-reference-dsp",
  name: "Micromorph deterministic reference transform",
  version: "1.0.0",
  kind: "reference-dsp",
  neural: false,
  generative: false,
  causal: true,
  mode: MICROMORPH_ENGINE_MODES.LIVE_MORPH,
});

const GENERATIVE_DELAY_IDENTITY = Object.freeze({
  id: "micromorph-reference-generative-delay",
  name: "Micromorph deterministic generative-delay rehearsal",
  version: "1.0.0",
  kind: "reference-delay",
  neural: false,
  generative: false,
  causal: false,
  mode: MICROMORPH_ENGINE_MODES.GENERATIVE_DELAY,
});

const DIFFUSION_CANVAS_IDENTITY = Object.freeze({
  id: "micromorph-reference-diffusion-canvas",
  name: "Micromorph deterministic diffusion-canvas rehearsal",
  version: "1.0.0",
  kind: "reference-canvas",
  neural: false,
  generative: false,
  causal: false,
  mode: MICROMORPH_ENGINE_MODES.DIFFUSION_CANVAS,
});

export const MICROMORPH_REFERENCE_IDENTITIES = Object.freeze({
  [MICROMORPH_ENGINE_MODES.LIVE_MORPH]: LIVE_MORPH_IDENTITY,
  [MICROMORPH_ENGINE_MODES.GENERATIVE_DELAY]: GENERATIVE_DELAY_IDENTITY,
  [MICROMORPH_ENGINE_MODES.DIFFUSION_CANVAS]: DIFFUSION_CANVAS_IDENTITY,
});

// Preserve the original exported identity as the default live reference path.
export const MICROMORPH_REFERENCE_IDENTITY = LIVE_MORPH_IDENTITY;

export class MicromorphEngineError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "MicromorphEngineError";
    this.code = code;
  }
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function integer(value, minimum, maximum, label, code = "invalid-config") {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new MicromorphEngineError(
      code,
      `${label} must be a safe integer from ${minimum} through ${maximum}`,
    );
  }
  return value;
}

function nonemptyString(value, label, maximum = 128) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new MicromorphEngineError(
      "invalid-engine",
      `${label} must contain between 1 and ${maximum} characters`,
    );
  }
  return value.trim();
}

function normalizedValue(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

function normalizeProcessingMode(value, { code = "invalid-config" } = {}) {
  const mode = value ?? MICROMORPH_ENGINE_MODES.LIVE_MORPH;
  if (!MICROMORPH_ENGINE_PROCESSING_MODES.includes(mode)) {
    throw new MicromorphEngineError(
      code,
      `processingMode must be one of: ${MICROMORPH_ENGINE_PROCESSING_MODES.join(", ")}`,
    );
  }
  return mode;
}

function freezeControls(controls) {
  return Object.freeze({
    derivation: controls.derivation,
    material: controls.material,
    structure_lock: controls.structure_lock,
    memory: controls.memory,
    mutation: controls.mutation,
    continuation: controls.continuation,
  });
}

function mergeControls(current, update) {
  if (update === undefined) return freezeControls(current);
  if (!isRecord(update)) {
    throw new MicromorphEngineError("invalid-controls", "controls must be an object");
  }
  const aliases = {
    derivation: "derivation",
    material: "material",
    structure_lock: "structure_lock",
    structureLock: "structure_lock",
    memory: "memory",
    mutation: "mutation",
    continuation: "continuation",
  };
  const merged = { ...current };
  for (const [providedId, value] of Object.entries(update)) {
    const id = aliases[providedId];
    if (!id) {
      throw new MicromorphEngineError(
        "invalid-controls",
        `unknown Micromorph control: ${providedId}`,
      );
    }
    merged[id] = normalizedValue(value, merged[id]);
  }
  return freezeControls(merged);
}

function normalizeAnchor(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, MAX_ANCHOR_CHARACTERS);
}

function normalizeCondition(condition, current = { anchors: { a: "", b: "" } }) {
  if (!isRecord(condition)) {
    throw new MicromorphEngineError("invalid-condition", "condition must be an object");
  }
  const supplied = condition.anchors ?? condition;
  if (!isRecord(supplied)) {
    throw new MicromorphEngineError("invalid-condition", "condition.anchors must be an object");
  }
  const anchors = Object.freeze({
    a: supplied.a === undefined ? current.anchors.a : normalizeAnchor(supplied.a),
    b: supplied.b === undefined ? current.anchors.b : normalizeAnchor(supplied.b),
  });
  return Object.freeze({ anchors });
}

function normalizeControlDefinitions(definitions) {
  if (definitions === undefined) return Object.freeze([]);
  if (!Array.isArray(definitions)) {
    throw new MicromorphEngineError("invalid-config", "config.controls must be an array");
  }
  return Object.freeze(definitions.map((definition, index) => {
    const source = typeof definition === "string" ? { id: definition } : definition;
    if (!isRecord(source) || typeof source.id !== "string" || !source.id.trim()) {
      throw new MicromorphEngineError(
        "invalid-config",
        `config.controls[${index}] must have a non-empty id`,
      );
    }
    const normalized = { id: source.id.trim() };
    if (source.defaultValue !== undefined) {
      const value = Number(source.defaultValue);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new MicromorphEngineError(
          "invalid-config",
          `config.controls[${index}].defaultValue must be normalized from 0 to 1`,
        );
      }
      normalized.defaultValue = value;
    }
    return Object.freeze(normalized);
  }));
}

/** Validate and freeze the stream geometry supplied to an engine factory. */
export function normalizeMicromorphEngineConfig(config) {
  if (!isRecord(config)) {
    throw new MicromorphEngineError("invalid-config", "engine config must be an object");
  }
  const normalized = {
    sampleRate: integer(config.sampleRate, 8_000, 192_000, "config.sampleRate"),
    blockSize: integer(config.blockSize, 1, 4_096, "config.blockSize"),
    inputChannels: config.inputChannels ?? 1,
    outputChannels: config.outputChannels ?? 2,
    pcmFormat: config.pcmFormat ?? "f32le",
    controls: normalizeControlDefinitions(config.controls),
    processingMode: normalizeProcessingMode(config.processingMode),
  };
  if (normalized.inputChannels !== 1) {
    throw new MicromorphEngineError("unsupported-config", "Micromorph engines require mono input");
  }
  if (normalized.outputChannels !== 2) {
    throw new MicromorphEngineError("unsupported-config", "Micromorph engines require stereo output");
  }
  if (normalized.pcmFormat !== "f32le") {
    throw new MicromorphEngineError(
      "unsupported-config",
      "Micromorph engines require little-endian Float32 PCM",
    );
  }
  return Object.freeze(normalized);
}

function initialControls(config) {
  let controls = MICROMORPH_ENGINE_DEFAULT_CONTROLS;
  for (const definition of config.controls) {
    if (MICROMORPH_ENGINE_CONTROL_IDS.includes(definition.id)
      && definition.defaultValue !== undefined) {
      controls = mergeControls(controls, { [definition.id]: definition.defaultValue });
    }
  }
  return freezeControls(controls);
}

function hashText(text, salt = 0) {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function unitFeature(text, salt) {
  return (hashText(text, salt) + 0.5) / UINT32_RANGE;
}

function anchorFeatures(text) {
  return Object.freeze({
    color: unitFeature(text, 0x13579bdf),
    pitch: unitFeature(text, 0x2468ace0),
    space: unitFeature(text, 0x10203040),
    grain: unitFeature(text, 0x55667788),
  });
}

function finiteSample(value) {
  return Number.isFinite(value) ? value : 0;
}

function softBound(value) {
  const finite = finiteSample(value);
  if (finite > 1) return 1;
  if (finite < -1) return -1;
  return finite;
}

function controlLerp(start, end, id, amount) {
  return start[id] + (end[id] - start[id]) * amount;
}

function assertCurrentFrame(value, cursorFrame, label = "startFrame") {
  const frame = value ?? cursorFrame;
  integer(frame, 0, Number.MAX_SAFE_INTEGER, label, "invalid-timeline");
  if (frame !== cursorFrame) {
    throw new MicromorphEngineError(
      "noncontiguous-timeline",
      `${label} ${frame} does not match engine cursor ${cursorFrame}`,
    );
  }
  return frame;
}

/**
 * Stateful, deterministic DSP used to verify the host and stream without
 * pretending that a neural or diffusion model is running.
 */
class MicromorphReferenceEngine {
  #config;

  #controls;

  #condition;

  #featuresA;

  #featuresB;

  #cursorFrame = 0;

  #closed = false;

  #seed;

  #randomState;

  #lowState = 0;

  #bandState = 0;

  #previousInput = 0;

  #envelope = 0;

  #memoryEnvelope = 0;

  #phase = 0;

  #phaseCompanion = 0;

  #delay;

  #delayWrite = 0;

  #processingMode;

  #modeBuffer;

  #modeCapturedFrames = 0;

  #modePlayhead = 0;

  constructor(config, options = {}) {
    this.#config = normalizeMicromorphEngineConfig(config);
    this.#controls = initialControls(this.#config);
    this.#condition = normalizeCondition({ anchors: options.anchors ?? {} });
    this.#featuresA = anchorFeatures(this.#condition.anchors.a);
    this.#featuresB = anchorFeatures(this.#condition.anchors.b);
    this.#seed = Number.isInteger(options.seed) ? options.seed >>> 0 : 0x6d2b79f5;
    this.#randomState = this.#conditionSeed();
    this.#delay = new Float32Array(Math.max(2, Math.ceil(this.#config.sampleRate * 1.1)));
    this.#processingMode = this.#config.processingMode;
    const modeFrames = this.#processingMode === MICROMORPH_ENGINE_MODES.GENERATIVE_DELAY
      ? Math.round(this.#config.sampleRate * 0.5)
      : this.#processingMode === MICROMORPH_ENGINE_MODES.DIFFUSION_CANVAS
        ? Math.round(this.#config.sampleRate * 2)
        : 0;
    this.#modeBuffer = new Float32Array(modeFrames);
  }

  get identity() {
    return MICROMORPH_REFERENCE_IDENTITIES[this.#processingMode];
  }

  get algorithmicLatencyFrames() {
    return this.#processingMode === MICROMORPH_ENGINE_MODES.GENERATIVE_DELAY
      ? this.#modeBuffer.length
      : 0;
  }

  get primingFrames() {
    return this.#modeBuffer.length;
  }

  get outputHopFrames() {
    return this.#config.blockSize;
  }

  get cursorFrame() {
    return this.#cursorFrame;
  }

  get controls() {
    return this.#controls;
  }

  get condition() {
    return this.#condition;
  }

  updateCondition(condition, startFrame = this.#cursorFrame) {
    this.#assertOpen();
    assertCurrentFrame(startFrame, this.#cursorFrame);
    this.#condition = normalizeCondition(condition, this.#condition);
    this.#featuresA = anchorFeatures(this.#condition.anchors.a);
    this.#featuresB = anchorFeatures(this.#condition.anchors.b);
    this.#randomState = this.#conditionSeed();
    return this.#condition;
  }

  updateControls(controls, startFrame = this.#cursorFrame) {
    this.#assertOpen();
    assertCurrentFrame(startFrame, this.#cursorFrame);
    this.#controls = mergeControls(this.#controls, controls);
    return this.#controls;
  }

  process(input, context = {}) {
    this.#assertOpen();
    if (!(input instanceof Float32Array)) {
      throw new MicromorphEngineError("invalid-input", "process input must be a Float32Array");
    }
    if (input.length < 1 || input.length > this.#config.blockSize) {
      throw new MicromorphEngineError(
        "invalid-input",
        `process input must contain 1 through ${this.#config.blockSize} mono frames`,
      );
    }
    if (!isRecord(context)) {
      throw new MicromorphEngineError("invalid-input", "process context must be an object");
    }
    assertCurrentFrame(context.startFrame, this.#cursorFrame);
    const startControls = mergeControls(this.#controls, context.controls);
    const endControls = mergeControls(startControls, context.endControls);
    const output = new Float32Array(input.length * 2);
    this.#render(input, input.length, startControls, endControls, output);
    this.#controls = endControls;
    this.#cursorFrame += input.length;
    return output;
  }

  handleGap(gap) {
    this.#assertOpen();
    if (!isRecord(gap)) {
      throw new MicromorphEngineError("invalid-gap", "gap must be an object");
    }
    assertCurrentFrame(gap.startFrame, this.#cursorFrame);
    const maximum = this.#config.sampleRate * MAX_GAP_SECONDS;
    const frameCount = integer(gap.frameCount, 1, maximum, "gap.frameCount", "invalid-gap");
    const startControls = mergeControls(this.#controls, gap.controls);
    const endControls = mergeControls(startControls, gap.endControls);
    const output = this.#processingMode === MICROMORPH_ENGINE_MODES.LIVE_MORPH
      ? null
      : new Float32Array(frameCount * 2);
    this.#render(null, frameCount, startControls, endControls, output);
    this.#controls = endControls;
    this.#cursorFrame += frameCount;
    return output ?? this.#cursorFrame;
  }

  reset({ startFrame = 0 } = {}) {
    this.#assertOpen();
    integer(startFrame, 0, Number.MAX_SAFE_INTEGER, "startFrame", "invalid-timeline");
    this.#cursorFrame = startFrame;
    this.#lowState = 0;
    this.#bandState = 0;
    this.#previousInput = 0;
    this.#envelope = 0;
    this.#memoryEnvelope = 0;
    this.#phase = 0;
    this.#phaseCompanion = 0;
    this.#delay.fill(0);
    this.#delayWrite = 0;
    this.#modeBuffer.fill(0);
    this.#modeCapturedFrames = 0;
    this.#modePlayhead = 0;
    this.#randomState = this.#conditionSeed();
    return this.#cursorFrame;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#delay.fill(0);
    this.#modeBuffer.fill(0);
  }

  #assertOpen() {
    if (this.#closed) {
      throw new MicromorphEngineError("engine-closed", "Micromorph engine is closed");
    }
  }

  #conditionSeed() {
    const anchors = `${this.#condition.anchors.a}\u0000${this.#condition.anchors.b}`;
    return (hashText(anchors, this.#seed) || 1) >>> 0;
  }

  #randomSigned() {
    let state = this.#randomState >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.#randomState = (state || 1) >>> 0;
    return (this.#randomState / 0xffff_ffff) * 2 - 1;
  }

  #modeInput(rawSample) {
    if (this.#processingMode === MICROMORPH_ENGINE_MODES.LIVE_MORPH) {
      return rawSample;
    }

    if (this.#processingMode === MICROMORPH_ENGINE_MODES.GENERATIVE_DELAY) {
      const delayed = this.#modeBuffer[this.#modePlayhead];
      this.#modeBuffer[this.#modePlayhead] = rawSample;
      this.#modePlayhead = (this.#modePlayhead + 1) % this.#modeBuffer.length;
      if (this.#modeCapturedFrames < this.#modeBuffer.length) {
        this.#modeCapturedFrames += 1;
        return 0;
      }
      return delayed;
    }

    if (this.#modeCapturedFrames < this.#modeBuffer.length) {
      this.#modeBuffer[this.#modeCapturedFrames] = rawSample;
      this.#modeCapturedFrames += 1;
      return 0;
    }
    const captured = this.#modeBuffer[this.#modePlayhead];
    this.#modePlayhead = (this.#modePlayhead + 1) % this.#modeBuffer.length;
    return captured;
  }

  #render(input, frameCount, startControls, endControls, output) {
    const sampleRate = this.#config.sampleRate;
    const delayLength = this.#delay.length;
    for (let index = 0; index < frameCount; index += 1) {
      // The end snapshot belongs to the next block boundary, preserving one
      // shared sample clock when adjacent blocks are processed.
      const interpolation = index / frameCount;
      const derivation = controlLerp(startControls, endControls, "derivation", interpolation);
      const material = controlLerp(startControls, endControls, "material", interpolation);
      const structure = controlLerp(startControls, endControls, "structure_lock", interpolation);
      const memory = controlLerp(startControls, endControls, "memory", interpolation);
      const mutation = controlLerp(startControls, endControls, "mutation", interpolation);
      const continuation = controlLerp(
        startControls,
        endControls,
        "continuation",
        interpolation,
      );

      const rawSample = input ? finiteSample(input[index]) : 0;
      const sample = this.#modeInput(rawSample);
      const absolute = Math.abs(sample);
      const envelopeCoefficient = absolute > this.#envelope ? 0.18 : 0.008;
      this.#envelope += (absolute - this.#envelope) * envelopeCoefficient;
      const memoryRelease = 0.998 + memory * 0.00185;
      this.#memoryEnvelope = Math.max(absolute, this.#memoryEnvelope * memoryRelease);

      const color = this.#featuresA.color
        + (this.#featuresB.color - this.#featuresA.color) * material;
      const pitch = this.#featuresA.pitch
        + (this.#featuresB.pitch - this.#featuresA.pitch) * material;
      const space = this.#featuresA.space
        + (this.#featuresB.space - this.#featuresA.space) * material;
      const grain = this.#featuresA.grain
        + (this.#featuresB.grain - this.#featuresA.grain) * material;

      const cutoff = 90 + color * 2_700 + structure * 1_800;
      const lowCoefficient = 1 - Math.exp(-TAU * cutoff / sampleRate);
      this.#lowState += (sample - this.#lowState) * lowCoefficient;
      const edge = sample - this.#previousInput;
      this.#bandState += (edge - this.#bandState) * (0.025 + grain * 0.18);
      this.#previousInput = sample;

      const delayFrames = Math.max(
        1,
        Math.min(
          delayLength - 1,
          Math.round(sampleRate * (0.016 + memory * 0.31 + space * 0.07)),
        ),
      );
      let delayRead = this.#delayWrite - delayFrames;
      if (delayRead < 0) delayRead += delayLength;
      const delayed = this.#delay[delayRead];
      const feedback = 0.08 + memory * 0.72;
      this.#delay[this.#delayWrite] = softBound(sample * (0.8 + structure * 0.2) + delayed * feedback);
      this.#delayWrite += 1;
      if (this.#delayWrite === delayLength) this.#delayWrite = 0;

      const oscillatorFrequency = 48 + pitch * 460 + material * 110;
      const companionFrequency = oscillatorFrequency * (1.41 + grain * 0.48);
      this.#phase += TAU * oscillatorFrequency / sampleRate;
      this.#phaseCompanion += TAU * companionFrequency / sampleRate;
      if (this.#phase >= TAU) this.#phase -= TAU;
      if (this.#phaseCompanion >= TAU) this.#phaseCompanion -= TAU;
      const remembered = this.#memoryEnvelope
        * (Math.sin(this.#phase) * 0.68 + Math.sin(this.#phaseCompanion) * 0.32);
      const continuationVoice = remembered * continuation * (0.08 + derivation * 0.28);
      const noise = this.#randomSigned()
        * Math.max(this.#envelope, this.#memoryEnvelope * continuation)
        * mutation
        * (0.025 + derivation * 0.16);

      const reconstructed = this.#lowState * (0.75 + color * 0.3)
        + this.#bandState * (0.18 + grain * 0.38);
      const descendant = reconstructed * structure
        + (delayed * 0.62 + continuationVoice) * (1 - structure)
        + noise;
      const wet = sample * structure + descendant * (1 - structure * 0.58);
      const center = sample * (1 - derivation);
      const pan = (space - 0.5) * (0.12 + derivation * 0.56);
      const wetGain = derivation;
      const left = softBound(center + wet * wetGain * (1 - pan) + noise * 0.35);
      const right = softBound(center + wet * wetGain * (1 + pan) - noise * 0.35);

      if (output) {
        output[index * 2] = left;
        output[index * 2 + 1] = right;
      }
    }
  }
}

/** Create the built-in, explicitly non-neural reference engine. */
export async function createMicromorphEngine(config, options = {}) {
  return new MicromorphReferenceEngine(config, options);
}

function normalizedIdentity(identity, expectedMode) {
  if (!isRecord(identity)) {
    throw new MicromorphEngineError("invalid-engine", "engine.identity must be an object");
  }
  const mode = normalizeProcessingMode(identity.mode, { code: "invalid-engine" });
  if (mode !== expectedMode) {
    throw new MicromorphEngineError(
      "invalid-engine",
      `engine.identity.mode ${mode} does not match config.processingMode ${expectedMode}`,
    );
  }
  if (typeof identity.causal !== "boolean") {
    throw new MicromorphEngineError(
      "invalid-engine",
      "Micromorph engines must explicitly declare identity.causal as a boolean",
    );
  }
  if (mode === MICROMORPH_ENGINE_MODES.LIVE_MORPH && identity.causal !== true) {
    throw new MicromorphEngineError(
      "invalid-engine",
      "A live-morph engine must explicitly declare identity.causal as true",
    );
  }
  return Object.freeze({
    id: nonemptyString(identity.id, "engine.identity.id"),
    name: nonemptyString(identity.name, "engine.identity.name"),
    version: typeof identity.version === "string" && identity.version.trim()
      ? identity.version.trim().slice(0, 64)
      : "unversioned",
    kind: typeof identity.kind === "string" && identity.kind.trim()
      ? identity.kind.trim().slice(0, 64)
      : "external",
    neural: identity.neural === true,
    generative: identity.generative === true,
    causal: identity.causal,
    mode,
  });
}

/**
 * Validate an external implementation and return a small truth-preserving
 * facade. Async implementations are supported because callers may await every
 * method; the built-in reference implementation happens to be synchronous.
 */
export function validateMicromorphEngine(engine, config) {
  if (!engine || (typeof engine !== "object" && typeof engine !== "function")) {
    throw new MicromorphEngineError("invalid-engine", "engine factory returned no engine");
  }
  const normalizedConfig = normalizeMicromorphEngineConfig(config);
  const identity = normalizedIdentity(engine.identity, normalizedConfig.processingMode);
  const algorithmicLatencyFrames = integer(
    engine.algorithmicLatencyFrames,
    0,
    normalizedConfig.sampleRate * MAX_GAP_SECONDS,
    "engine.algorithmicLatencyFrames",
    "invalid-engine",
  );
  const primingFrames = integer(
    engine.primingFrames
      ?? (normalizedConfig.processingMode === MICROMORPH_ENGINE_MODES.LIVE_MORPH ? 0 : NaN),
    0,
    normalizedConfig.sampleRate * MAX_GAP_SECONDS,
    "engine.primingFrames",
    "invalid-engine",
  );
  const outputHopFrames = integer(
    engine.outputHopFrames,
    1,
    normalizedConfig.blockSize,
    "engine.outputHopFrames",
    "invalid-engine",
  );
  integer(
    engine.cursorFrame,
    0,
    Number.MAX_SAFE_INTEGER,
    "engine.cursorFrame",
    "invalid-engine",
  );
  for (const method of [
    "process",
    "updateCondition",
    "updateControls",
    "handleGap",
    "reset",
    "close",
  ]) {
    if (typeof engine[method] !== "function") {
      throw new MicromorphEngineError("invalid-engine", `engine.${method} must be a function`);
    }
  }
  const facade = {
    identity,
    processingMode: identity.mode,
    algorithmicLatencyFrames,
    primingFrames,
    outputHopFrames,
    get cursorFrame() {
      return engine.cursorFrame;
    },
    process(...arguments_) {
      return engine.process(...arguments_);
    },
    updateCondition(...arguments_) {
      return engine.updateCondition(...arguments_);
    },
    updateControls(...arguments_) {
      return engine.updateControls(...arguments_);
    },
    handleGap(...arguments_) {
      return engine.handleGap(...arguments_);
    },
    reset(...arguments_) {
      return engine.reset(...arguments_);
    },
    close(...arguments_) {
      return engine.close(...arguments_);
    },
  };
  return Object.freeze(facade);
}

function providerFactory(provider) {
  if (typeof provider === "function") return provider;
  if (provider && typeof provider.createMicromorphEngine === "function") {
    return provider.createMicromorphEngine.bind(provider);
  }
  if (provider && typeof provider.default === "function") return provider.default;
  if (provider && typeof provider.default?.createMicromorphEngine === "function") {
    return provider.default.createMicromorphEngine.bind(provider.default);
  }
  throw new MicromorphEngineError(
    "invalid-provider",
    "engine module must export createMicromorphEngine(config, options) or a default factory",
  );
}

async function importProvider(specifier, baseDirectory) {
  if (specifier instanceof URL) return import(specifier.href);
  if (typeof specifier !== "string" || !specifier.trim()) {
    throw new MicromorphEngineError("invalid-provider", "engine specifier must not be empty");
  }
  const source = specifier.trim();
  if (source === "reference" || source === "builtin:reference") return { createMicromorphEngine };
  let url;
  try {
    const candidate = new URL(source);
    if (candidate.protocol !== "file:") {
      throw new MicromorphEngineError(
        "invalid-provider",
        "engine module URLs must use the local file: scheme",
      );
    }
    url = candidate.href;
  } catch (error) {
    if (error instanceof MicromorphEngineError) throw error;
    url = pathToFileURL(resolve(baseDirectory, source)).href;
  }
  return import(url);
}

/**
 * Resolve and import an engine provider before the WebSocket begins listening.
 * Heavy modules may load shared weights at module scope without consuming the
 * browser's ten-second per-connection handshake window.
 */
export async function prepareMicromorphEngineProvider(specifier, options = {}) {
  const provider = typeof specifier === "string" || specifier instanceof URL
    ? await importProvider(specifier, options.baseDirectory ?? process.cwd())
    : specifier;
  providerFactory(provider);
  return provider;
}

/**
 * Load a replaceable engine provider. A CLI may pass `--engine reference`, a
 * path, or a file URL; tests and embedders may pass a provider object/factory.
 */
export async function loadMicromorphEngine(specifier, config, options = {}) {
  const normalizedConfig = normalizeMicromorphEngineConfig(config);
  const provider = await prepareMicromorphEngineProvider(specifier, options);
  const factory = providerFactory(provider);
  let engine;
  try {
    engine = await factory(normalizedConfig, options);
  } catch (error) {
    throw new MicromorphEngineError(
      "engine-start-failed",
      `Micromorph engine failed to start: ${error?.message ?? error}`,
      { cause: error },
    );
  }
  return validateMicromorphEngine(engine, normalizedConfig);
}
