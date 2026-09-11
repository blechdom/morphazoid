const BLOCK_SIZE = 128;
const PARAM_COUNT = 51;
const SEQUENCE_VALUE_COUNT = 16 * 4;
const MOD_ROUTE_VALUE_COUNT = 4 * 4;
const VOICE_COUNT = 8;
const TELEMETRY_INTERVAL_BLOCKS = 48;
const EVENT_QUEUE_CAPACITY = 128;
const HELD_NOTE_CAPACITY = 128;
const BACKEND_FADE_SAMPLES = BLOCK_SIZE * 2;
// All legitimate controls are below this generic boundary. It also keeps raw
// worklet messages safe for the kernels' f32-to-i32 mode/index conversions.
const WASM_F32_LIMIT = 1e6;
// prepare_sequence converts its scaled clock to i32. One million seconds at
// the maximum 240 BPM maps to 16 million steps, safely inside that range.
const WASM_TIME_LIMIT = 1e6;

const EVENT_NOTE_ON = 1;
const EVENT_NOTE_OFF = 2;

const ARRAY_POINTERS = Object.freeze({
  outputLeft: ["output_left_ptr", BLOCK_SIZE],
  outputRight: ["output_right_ptr", BLOCK_SIZE],
  params: ["params_ptr", PARAM_COUNT],
  sequence: ["sequence_ptr", SEQUENCE_VALUE_COUNT],
  modRoutes: ["mod_routes_ptr", MOD_ROUTE_VALUE_COUNT],
  voiceNote: ["voice_note_ptr", VOICE_COUNT],
  voiceGate: ["voice_gate_ptr", VOICE_COUNT],
  voiceEnvelope: ["voice_envelope_ptr", VOICE_COUNT],
});

const REQUIRED_FUNCTIONS = Object.freeze([
  "process",
  "reset",
  "note_on",
  "note_off",
  "all_notes_off",
  "set_sequence_active",
  "lane_width",
  "block_size",
  "voice_count",
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteWasmFloat(value, fallback = 0) {
  const fallbackNumber = finite(fallback, 0);
  const safeFallback = Math.min(WASM_F32_LIMIT, Math.max(-WASM_F32_LIMIT, fallbackNumber));
  const number = finite(value, safeFallback);
  const rounded = Math.fround(Math.min(WASM_F32_LIMIT, Math.max(-WASM_F32_LIMIT, number)));
  return Number.isFinite(rounded) ? rounded : Math.fround(safeFallback);
}

function finiteWasmTime(value, fallback = 0) {
  return Math.min(WASM_TIME_LIMIT, Math.max(0, finiteWasmFloat(value, fallback)));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function errorMessage(error, fallback) {
  return typeof error?.message === "string" && error.message ? error.message : fallback;
}

function refreshKernelViews(kernel) {
  const buffer = kernel.exports.memory.buffer;
  if (kernel.buffer === buffer) return;
  kernel.buffer = buffer;
  for (const key in ARRAY_POINTERS) {
    const pointer = kernel.pointers[key];
    const length = ARRAY_POINTERS[key][1];
    kernel[key] = new Float32Array(buffer, pointer, length);
  }
}

function createKernel(binary, expectedLaneWidth, label) {
  if (!binary) return null;
  const module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary);
  const instance = new WebAssembly.Instance(module);
  const exports = instance.exports;
  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new TypeError(`${label} SIMD SYNTH memory export is missing.`);
  }
  for (let index = 0; index < REQUIRED_FUNCTIONS.length; index += 1) {
    const name = REQUIRED_FUNCTIONS[index];
    if (typeof exports[name] !== "function") {
      throw new TypeError(`${label} SIMD SYNTH kernel export is missing: ${name}`);
    }
  }
  if (exports.block_size() !== BLOCK_SIZE) {
    throw new RangeError(`${label} SIMD SYNTH kernel block size is not ${BLOCK_SIZE}.`);
  }
  if (exports.voice_count() !== VOICE_COUNT) {
    throw new RangeError(`${label} SIMD SYNTH kernel voice count is not ${VOICE_COUNT}.`);
  }
  if (exports.lane_width() !== expectedLaneWidth) {
    throw new RangeError(`${label} SIMD SYNTH kernel lane width is not ${expectedLaneWidth}.`);
  }

  const pointers = {};
  const byteLength = exports.memory.buffer.byteLength;
  for (const key in ARRAY_POINTERS) {
    const pointerName = ARRAY_POINTERS[key][0];
    const length = ARRAY_POINTERS[key][1];
    if (typeof exports[pointerName] !== "function") {
      throw new TypeError(`${label} SIMD SYNTH pointer is missing: ${pointerName}`);
    }
    const pointer = exports[pointerName]();
    if (!Number.isInteger(pointer) || pointer < 0 || pointer + length * 4 > byteLength) {
      throw new RangeError(`${label} SIMD SYNTH pointer is out of bounds: ${pointerName}`);
    }
    pointers[key] = pointer;
  }

  const kernel = { instance, exports, pointers, buffer: null };
  refreshKernelViews(kernel);
  exports.reset();
  return kernel;
}

function copyFiniteArray(destination, source, label) {
  if (!source || typeof source.length !== "number" || source.length < destination.length) {
    throw new TypeError(`SIMD SYNTH ${label} must contain ${destination.length} values.`);
  }
  for (let index = 0; index < destination.length; index += 1) {
    destination[index] = finiteWasmFloat(source[index], 0);
  }
}

function writeConfigurationPart(kernel, key, source) {
  if (!kernel) return;
  refreshKernelViews(kernel);
  kernel[key].set(source);
}

class SimdSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kernels = { scalar: null, simd: null };
    this.kernel = null;
    this.backend = "none";
    this.ready = false;
    this.running = true;

    this.sampleCursor = 0;
    this.transportEnabled = false;
    this.sequenceTime = 0;

    this.stagedParams = new Float32Array(PARAM_COUNT);
    this.stagedSequence = new Float32Array(SEQUENCE_VALUE_COUNT);
    this.stagedModRoutes = new Float32Array(MOD_ROUTE_VALUE_COUNT);
    this.paramsPending = false;
    this.sequencePending = false;
    this.modRoutesPending = false;
    this.transportPending = false;
    this.pendingTransportEnabled = false;
    this.pendingTransportHasTime = false;
    this.pendingTransportTime = 0;
    this.pendingBackend = null;
    this.resetPending = false;
    this.pendingResetHasSequenceTime = false;
    this.pendingResetSequenceTime = 0;
    this.panicPending = false;

    this.eventTypes = new Uint8Array(EVENT_QUEUE_CAPACITY);
    this.eventValues = new Float32Array(EVENT_QUEUE_CAPACITY);
    this.eventVelocities = new Float32Array(EVENT_QUEUE_CAPACITY);
    this.eventRead = 0;
    this.eventWrite = 0;
    this.eventCount = 0;

    this.heldNoteActive = new Uint8Array(HELD_NOTE_CAPACITY);
    this.heldNoteValues = new Float32Array(HELD_NOTE_CAPACITY);
    this.heldNoteVelocities = new Float32Array(HELD_NOTE_CAPACITY);
    this.backendFadeRemaining = 0;

    this.telemetryBlocks = 0;
    this.telemetryMicros = 0;

    this.port.onmessage = (event) => {
      try {
        this.handleMessage(event.data || {});
      } catch (error) {
        this.post("error", { message: errorMessage(error, "SIMD SYNTH control message failed.") });
      }
    };
  }

  post(type, value = {}) {
    this.port.postMessage({ type, ...value });
  }

  clearEventQueue() {
    this.eventRead = 0;
    this.eventWrite = 0;
    this.eventCount = 0;
  }

  clearHeldNotes() {
    this.heldNoteActive.fill(0);
  }

  rememberNoteOn(note, velocity) {
    let available = -1;
    for (let index = 0; index < HELD_NOTE_CAPACITY; index += 1) {
      if (this.heldNoteActive[index]) {
        if (Math.abs(this.heldNoteValues[index] - note) < 0.01) {
          this.heldNoteValues[index] = note;
          this.heldNoteVelocities[index] = velocity;
          return;
        }
      } else if (available < 0) {
        available = index;
      }
    }
    // The kernel cannot sound more than eight voices. If a pathological input
    // holds over 128 distinct notes, retaining the newest note is preferable to
    // growing memory or allocating on the render thread.
    const index = available >= 0 ? available : Math.max(0, Math.min(127, Math.round(note)));
    this.heldNoteActive[index] = 1;
    this.heldNoteValues[index] = note;
    this.heldNoteVelocities[index] = velocity;
  }

  rememberNoteOff(note) {
    for (let index = 0; index < HELD_NOTE_CAPACITY; index += 1) {
      if (this.heldNoteActive[index] && Math.abs(this.heldNoteValues[index] - note) < 0.01) {
        this.heldNoteActive[index] = 0;
      }
    }
  }

  replayHeldNotes(kernel) {
    for (let index = 0; index < HELD_NOTE_CAPACITY; index += 1) {
      if (this.heldNoteActive[index]) {
        kernel.exports.note_on(this.heldNoteValues[index], this.heldNoteVelocities[index]);
      }
    }
  }

  enqueueEvent(type, value, velocity = 0) {
    if (this.eventCount >= EVENT_QUEUE_CAPACITY) {
      // Recover safely from an event flood: release every voice at the next
      // render boundary, then retain the newest command.
      this.clearEventQueue();
      this.panicPending = true;
    }
    const index = this.eventWrite;
    this.eventTypes[index] = type;
    this.eventValues[index] = value;
    this.eventVelocities[index] = velocity;
    this.eventWrite = (index + 1) % EVENT_QUEUE_CAPACITY;
    this.eventCount += 1;
  }

  stageConfiguration(configuration, required = false) {
    if (!configuration || typeof configuration !== "object") {
      if (required) throw new TypeError("SIMD SYNTH configuration is required.");
      return false;
    }

    let changed = false;
    if (configuration.paramArray != null) {
      copyFiniteArray(this.stagedParams, configuration.paramArray, "parameter array");
      this.paramsPending = true;
      changed = true;
    } else if (required) {
      throw new TypeError("SIMD SYNTH parameter array is required.");
    }

    if (configuration.sequenceArray != null) {
      copyFiniteArray(this.stagedSequence, configuration.sequenceArray, "sequence array");
      this.sequencePending = true;
      changed = true;
    } else if (required) {
      throw new TypeError("SIMD SYNTH sequence array is required.");
    }

    if (configuration.modRouteArray != null) {
      copyFiniteArray(this.stagedModRoutes, configuration.modRouteArray, "modulation route array");
      this.modRoutesPending = true;
      changed = true;
    } else if (required) {
      throw new TypeError("SIMD SYNTH modulation route array is required.");
    }
    return changed;
  }

  stageArrayMessage(message, key) {
    const value = message.value ?? message.values ?? message.array;
    if (key === "params") {
      copyFiniteArray(this.stagedParams, message.paramArray ?? value, "parameter array");
      this.paramsPending = true;
    } else if (key === "sequence") {
      copyFiniteArray(this.stagedSequence, message.sequenceArray ?? value, "sequence array");
      this.sequencePending = true;
    } else {
      copyFiniteArray(this.stagedModRoutes, message.modRouteArray ?? value, "modulation route array");
      this.modRoutesPending = true;
    }
  }

  applyPendingConfiguration() {
    if (this.paramsPending) {
      writeConfigurationPart(this.kernels.scalar, "params", this.stagedParams);
      writeConfigurationPart(this.kernels.simd, "params", this.stagedParams);
      this.paramsPending = false;
    }
    if (this.sequencePending) {
      writeConfigurationPart(this.kernels.scalar, "sequence", this.stagedSequence);
      writeConfigurationPart(this.kernels.simd, "sequence", this.stagedSequence);
      this.sequencePending = false;
    }
    if (this.modRoutesPending) {
      writeConfigurationPart(this.kernels.scalar, "modRoutes", this.stagedModRoutes);
      writeConfigurationPart(this.kernels.simd, "modRoutes", this.stagedModRoutes);
      this.modRoutesPending = false;
    }
  }

  applySequenceActive() {
    const active = this.transportEnabled ? 1 : 0;
    this.kernels.scalar?.exports.set_sequence_active(active);
    this.kernels.simd?.exports.set_sequence_active(active);
  }

  resetKernels() {
    this.kernels.scalar?.exports.reset();
    this.kernels.simd?.exports.reset();
    this.clearHeldNotes();
    this.sampleCursor = 0;
    if (this.pendingResetHasSequenceTime) this.sequenceTime = this.pendingResetSequenceTime;
    this.applySequenceActive();
    this.resetPending = false;
    this.pendingResetHasSequenceTime = false;
  }

  applyPendingTransport() {
    if (!this.transportPending) return;
    this.transportEnabled = this.pendingTransportEnabled;
    if (this.pendingTransportHasTime) this.sequenceTime = this.pendingTransportTime;
    this.applySequenceActive();
    this.transportPending = false;
    this.pendingTransportHasTime = false;
  }

  applyEventToKernel(kernel, type, value, velocity) {
    if (!kernel) return;
    if (type === EVENT_NOTE_ON) kernel.exports.note_on(value, velocity);
    else if (type === EVENT_NOTE_OFF) kernel.exports.note_off(value);
  }

  applyPendingEvents() {
    if (this.panicPending) {
      this.kernels.scalar?.exports.all_notes_off();
      this.kernels.simd?.exports.all_notes_off();
      this.clearHeldNotes();
      this.panicPending = false;
    }
    while (this.eventCount > 0) {
      const index = this.eventRead;
      const type = this.eventTypes[index];
      const value = this.eventValues[index];
      const velocity = this.eventVelocities[index];
      this.applyEventToKernel(this.kernels.scalar, type, value, velocity);
      this.applyEventToKernel(this.kernels.simd, type, value, velocity);
      if (type === EVENT_NOTE_ON) this.rememberNoteOn(value, velocity);
      else if (type === EVENT_NOTE_OFF) this.rememberNoteOff(value);
      this.eventRead = (index + 1) % EVENT_QUEUE_CAPACITY;
      this.eventCount -= 1;
    }
  }

  restartKernel(kernel) {
    kernel.exports.reset();
    refreshKernelViews(kernel);
    kernel.params.set(this.stagedParams);
    kernel.sequence.set(this.stagedSequence);
    kernel.modRoutes.set(this.stagedModRoutes);
    kernel.exports.set_sequence_active(this.transportEnabled ? 1 : 0);
    this.replayHeldNotes(kernel);
    this.backendFadeRemaining = BACKEND_FADE_SAMPLES;
  }

  chooseBackend(requested, notify = false, reason = "requested") {
    const backend = requested === "scalar" || !this.kernels.simd ? "scalar" : "simd";
    const nextKernel = this.kernels[backend];
    if (!nextKernel) throw new TypeError("Scalar SIMD SYNTH Wasm module is required.");
    if (nextKernel === this.kernel) return;
    if (this.kernel) this.restartKernel(nextKernel);
    this.backend = backend;
    this.kernel = nextKernel;
    if (notify && this.ready) {
      this.post("backend", {
        backend,
        laneWidth: nextKernel.exports.lane_width(),
        simdAvailable: Boolean(this.kernels.simd),
        reason,
      });
    }
  }

  install(message) {
    this.ready = false;
    this.kernel = null;
    this.backend = "none";
    this.kernels.scalar = null;
    this.kernels.simd = null;
    try {
      this.kernels.scalar = createKernel(message.scalarBytes, 1, "Scalar");
      if (!this.kernels.scalar) throw new TypeError("Scalar SIMD SYNTH Wasm module is required.");
      try {
        this.kernels.simd = createKernel(message.simdBytes, 4, "SIMD");
      } catch {
        this.kernels.simd = null;
      }

      this.paramsPending = false;
      this.sequencePending = false;
      this.modRoutesPending = false;
      this.stageConfiguration(message.configuration, true);
      this.applyPendingConfiguration();

      this.sampleCursor = 0;
      this.sequenceTime = finiteWasmTime(message.sequenceTime, 0);
      this.transportEnabled = Boolean(message.transportEnabled);
      this.applySequenceActive();
      this.clearEventQueue();
      this.clearHeldNotes();
      this.panicPending = false;
      this.resetPending = false;
      this.transportPending = false;
      this.pendingBackend = null;
      this.telemetryBlocks = 0;
      this.telemetryMicros = 0;
      this.backendFadeRemaining = 0;

      this.chooseBackend(message.requestedBackend === "scalar" ? "scalar" : "auto");
      this.running = true;
      this.ready = true;
      this.post("ready", {
        backend: this.backend,
        laneWidth: this.kernel.exports.lane_width(),
        blockSize: this.kernel.exports.block_size(),
        voiceCount: this.kernel.exports.voice_count(),
        simdAvailable: Boolean(this.kernels.simd),
      });
    } catch (error) {
      this.ready = false;
      this.kernel = null;
      this.backend = "none";
      this.post("error", { message: errorMessage(error, "SIMD SYNTH Wasm failed to start.") });
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "install":
        this.install(message);
        break;
      case "configure":
        this.stageConfiguration(message.configuration);
        break;
      case "params":
        this.stageArrayMessage(message, "params");
        break;
      case "sequence":
        this.stageArrayMessage(message, "sequence");
        break;
      case "mod-routes":
      case "modRoutes":
        this.stageArrayMessage(message, "modRoutes");
        break;
      case "note-on":
        this.enqueueEvent(
          EVENT_NOTE_ON,
          clamp(finite(message.note, 60), 0, 127),
          clamp(finite(message.velocity, 1), 0.01, 1),
        );
        break;
      case "note-off":
        this.enqueueEvent(EVENT_NOTE_OFF, clamp(finite(message.note, 60), 0, 127));
        break;
      case "panic":
        this.clearEventQueue();
        this.panicPending = true;
        break;
      case "transport": {
        this.pendingTransportEnabled = Boolean(message.enabled ?? message.value);
        const nextTime = Number(message.sequenceTime);
        this.pendingTransportHasTime = Number.isFinite(nextTime);
        if (this.pendingTransportHasTime) this.pendingTransportTime = finiteWasmTime(nextTime, 0);
        this.transportPending = true;
        break;
      }
      case "backend":
        this.pendingBackend = message.backend === "scalar" ? "scalar" : "auto";
        break;
      case "reset": {
        this.clearEventQueue();
        this.panicPending = false;
        const nextTime = Number(message.sequenceTime);
        this.pendingResetHasSequenceTime = Number.isFinite(nextTime);
        if (this.pendingResetHasSequenceTime) this.pendingResetSequenceTime = finiteWasmTime(nextTime, 0);
        this.resetPending = true;
        break;
      }
      case "dispose":
        this.running = false;
        break;
    }
  }

  applyBlockBoundaryChanges() {
    this.applyPendingConfiguration();
    if (this.resetPending) this.resetKernels();
    this.applyPendingTransport();
    this.applyPendingEvents();
    if (this.pendingBackend) {
      const requested = this.pendingBackend;
      this.pendingBackend = null;
      this.chooseBackend(requested, true);
    }
  }

  clearOutputs(outputs) {
    for (let outputIndex = 0; outputIndex < outputs.length; outputIndex += 1) {
      const output = outputs[outputIndex];
      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        output[channelIndex].fill(0);
      }
    }
  }

  runKernel(frames) {
    const kernelSampleRate = finiteWasmFloat(sampleRate, 48_000);
    const absoluteTime = finiteWasmTime(this.sampleCursor / kernelSampleRate, 0);
    const sequenceTime = finiteWasmTime(this.sequenceTime, 0);
    try {
      this.kernel.exports.process(frames, kernelSampleRate, absoluteTime, sequenceTime);
    } catch (error) {
      if (this.backend !== "simd" || !this.kernels.scalar) throw error;
      this.chooseBackend("scalar", true, "runtime-fallback");
      this.kernel.exports.process(frames, kernelSampleRate, absoluteTime, sequenceTime);
    }
    refreshKernelViews(this.kernel);
  }

  nextBackendGain() {
    if (this.backendFadeRemaining <= 0) return 1;
    const progress = (BACKEND_FADE_SAMPLES - this.backendFadeRemaining + 1) / BACKEND_FADE_SAMPLES;
    this.backendFadeRemaining -= 1;
    return progress * progress * (3 - 2 * progress);
  }

  copyOutput(output, frames) {
    const left = output[0];
    const right = output[1];
    const sourceLeft = this.kernel.outputLeft;
    const sourceRight = this.kernel.outputRight;
    if (right) {
      for (let frame = 0; frame < frames; frame += 1) {
        const leftValue = sourceLeft[frame];
        const rightValue = sourceRight[frame];
        const gain = this.nextBackendGain();
        left[frame] = (Number.isFinite(leftValue) ? leftValue : 0) * gain;
        right[frame] = (Number.isFinite(rightValue) ? rightValue : 0) * gain;
      }
      if (right.length > frames) right.fill(0, frames);
    } else {
      for (let frame = 0; frame < frames; frame += 1) {
        const leftValue = sourceLeft[frame];
        const rightValue = sourceRight[frame];
        const value = Number.isFinite(leftValue) && Number.isFinite(rightValue)
          ? (leftValue + rightValue) * 0.5
          : Number.isFinite(leftValue) ? leftValue
          : Number.isFinite(rightValue) ? rightValue
          : 0;
        left[frame] = value * this.nextBackendGain();
      }
    }
    if (left.length > frames) left.fill(0, frames);
    for (let channelIndex = 2; channelIndex < output.length; channelIndex += 1) {
      output[channelIndex].fill(0);
    }
  }

  publishTelemetry(frames) {
    if (this.telemetryBlocks < TELEMETRY_INTERVAL_BLOCKS) return;
    let activeVoices = 0;
    refreshKernelViews(this.kernel);
    for (let voice = 0; voice < VOICE_COUNT; voice += 1) {
      if (this.kernel.voiceGate[voice] > 0.5 || this.kernel.voiceEnvelope[voice] > 0.0001) {
        activeVoices += 1;
      }
    }
    this.post("telemetry", {
      backend: this.backend,
      laneWidth: this.kernel.exports.lane_width(),
      kernelMicros: this.telemetryMicros / this.telemetryBlocks,
      budgetMicros: frames / sampleRate * 1_000_000,
      activeVoices,
      transportEnabled: this.transportEnabled,
      sequenceTime: this.sequenceTime,
    });
    this.telemetryBlocks = 0;
    this.telemetryMicros = 0;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!this.running) {
      this.clearOutputs(outputs);
      return false;
    }
    if (!this.ready || !this.kernel || !output?.[0]) {
      this.clearOutputs(outputs);
      return true;
    }

    const left = output[0];
    const right = output[1];
    const frames = Math.min(BLOCK_SIZE, left.length, right ? right.length : left.length);
    try {
      this.applyBlockBoundaryChanges();
      const started = globalThis.performance?.now?.() ?? 0;
      this.runKernel(frames);
      const finished = globalThis.performance?.now?.() ?? started;
      this.telemetryMicros += Math.max(0, (finished - started) * 1_000);
    } catch (error) {
      this.clearOutputs(outputs);
      this.ready = false;
      this.post("error", { message: errorMessage(error, "SIMD SYNTH Wasm stopped.") });
      return true;
    }

    this.copyOutput(output, frames);
    this.sampleCursor += frames;
    if (this.transportEnabled) {
      this.sequenceTime = finiteWasmTime(this.sequenceTime + frames / finiteWasmFloat(sampleRate, 48_000), this.sequenceTime);
    }
    this.telemetryBlocks += 1;
    this.publishTelemetry(frames);
    return true;
  }
}

registerProcessor("morphazoid-simd-synth", SimdSynthProcessor);
