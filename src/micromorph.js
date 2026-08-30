import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

export const MICROMORPH_PROCESSOR_NAME = "morphazoid-micromorph";
export const MICROMORPH_PROTOCOL_VERSION = "mga-stream/1";
export const MICROMORPH_PCM_CHUNK_FRAMES = 1_024;
export const MICROMORPH_MAX_MODEL_PCM_FRAMES = 4_096;

const DEFAULT_SAMPLE_RATE = 48_000;
const MAX_MODEL_BUFFER_SECONDS = 0.5;
const MAX_DELAY_SECONDS = 1.5;
const TELEMETRY_INTERVAL_BLOCKS = 16;
const EPSILON = 1e-9;
const MODEL_CROSSFADE_SECONDS = 0.008;

export const MICROMORPH_DEFAULTS = Object.freeze({
  derivation: 0.56,
  material: 0.5,
  structureLock: 0.74,
  memory: 0.62,
  mutation: 0.22,
  continuation: 0.2,
  inputGain: 1,
  outputLevel: 0.64,
});

function freezePreset(preset) {
  return Object.freeze({
    ...preset,
    anchors: Object.freeze({ ...preset.anchors }),
    parameters: Object.freeze({ ...preset.parameters }),
  });
}

export const MICROMORPH_PRESETS = Object.freeze([
  freezePreset({
    id: "near-kin",
    label: "Near kin",
    anchors: {
      a: "close human breath, dry and intimate",
      b: "the same breath through a soft resonant membrane",
    },
    parameters: {
      derivation: 0.28,
      material: 0.35,
      structureLock: 0.92,
      memory: 0.36,
      mutation: 0.08,
      continuation: 0.04,
    },
  }),
  freezePreset({
    id: "glass-lung",
    label: "Glass lung",
    anchors: {
      a: "wet ceramic throat and close breath",
      b: "fractured glass lung singing in a small chamber",
    },
    parameters: {
      derivation: 0.58,
      material: 0.74,
      structureLock: 0.78,
      memory: 0.58,
      mutation: 0.2,
      continuation: 0.22,
    },
  }),
  freezePreset({
    id: "wire-choir",
    label: "Wire choir",
    anchors: {
      a: "quiet vocal wire, narrow and metallic",
      b: "a spatial choir of vibrating copper filaments",
    },
    parameters: {
      derivation: 0.7,
      material: 0.9,
      structureLock: 0.66,
      memory: 0.76,
      mutation: 0.18,
      continuation: 0.42,
    },
  }),
  freezePreset({
    id: "moss-memory",
    label: "Moss memory",
    anchors: {
      a: "muffled breath under damp leaves",
      b: "slow fungal resonance remembering a distant voice",
    },
    parameters: {
      derivation: 0.78,
      material: 0.18,
      structureLock: 0.42,
      memory: 0.92,
      mutation: 0.26,
      continuation: 0.72,
    },
  }),
  freezePreset({
    id: "feral-descendant",
    label: "Feral descendant",
    anchors: {
      a: "animal breath and membrane clicks",
      b: "an impossible electrical animal answering from a tunnel",
    },
    parameters: {
      derivation: 0.94,
      material: 0.55,
      structureLock: 0.24,
      memory: 0.7,
      mutation: 0.78,
      continuation: 0.64,
    },
  }),
]);

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)));
}

export function sanitizeMicromorphParams(parameters = {}) {
  const source = parameters && typeof parameters === "object" ? parameters : {};
  return Object.freeze({
    derivation: clamp(source.derivation, 0, 1, MICROMORPH_DEFAULTS.derivation),
    material: clamp(source.material, 0, 1, MICROMORPH_DEFAULTS.material),
    structureLock: clamp(
      source.structureLock,
      0,
      1,
      MICROMORPH_DEFAULTS.structureLock,
    ),
    memory: clamp(source.memory, 0, 1, MICROMORPH_DEFAULTS.memory),
    mutation: clamp(source.mutation, 0, 1, MICROMORPH_DEFAULTS.mutation),
    continuation: clamp(
      source.continuation,
      0,
      1,
      MICROMORPH_DEFAULTS.continuation,
    ),
    inputGain: clamp(source.inputGain, 0, 4, MICROMORPH_DEFAULTS.inputGain),
    outputLevel: clamp(
      source.outputLevel,
      0,
      0.82,
      MICROMORPH_DEFAULTS.outputLevel,
    ),
  });
}

export function micromorphStageWeights(derivation) {
  const position = clamp(derivation, 0, 1, MICROMORPH_DEFAULTS.derivation) * 4;
  const lower = Math.min(4, Math.floor(position));
  const upper = Math.min(4, lower + 1);
  const fraction = position - lower;
  const weights = new Float32Array(5);
  weights[lower] = 1 - fraction;
  weights[upper] += fraction;
  return weights;
}

export function micromorphStageName(derivation) {
  const index = Math.round(clamp(derivation, 0, 1, 0) * 4);
  return ["source", "reconstruction", "derivation", "mutation", "imaginary"][index];
}

function equalPowerMix(dry, wet, amount) {
  const mix = Math.min(1, Math.max(0, amount));
  return dry * Math.cos(mix * Math.PI * 0.5)
    + wet * Math.sin(mix * Math.PI * 0.5);
}

function softLimit(value) {
  const sample = Number.isFinite(value) ? value : 0;
  return Math.tanh(sample * 1.18) / Math.tanh(1.18);
}

function stopMediaStream(stream) {
  let tracks = [];
  try {
    tracks = stream?.getTracks?.() ?? [];
  } catch {
    return;
  }
  for (let index = 0; index < tracks.length; index += 1) {
    try {
      tracks[index]?.stop?.();
    } catch {
      // A track can already have ended while an async lifecycle operation settles.
    }
  }
}

function disconnectNode(node) {
  try {
    node?.disconnect?.();
  } catch {
    // Closing contexts and already-disconnected nodes are harmless here.
  }
}

function lifecycleCancellation(message) {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "micromorph-audio-cancelled";
  return error;
}

function processorClass(AudioWorkletBase) {
  return class MicromorphProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      this.parameters = {
        ...sanitizeMicromorphParams(options.processorOptions?.parameters),
      };
      this.active = false;
      this.modelActive = false;
      this.modelChannels = 2;
      this.modelBlockFrames = MICROMORPH_PCM_CHUNK_FRAMES;
      this.modelRead = 0;
      this.modelWrite = 0;
      this.modelAvailable = 0;
      this.modelUnderflows = 0;
      this.modelUnderflowing = false;
      this.modelRejectedBlocks = 0;
      this.modelFrameLeft = 0;
      this.modelFrameRight = 0;
      this.lastModelOutputLeft = 0;
      this.lastModelOutputRight = 0;
      this.modelMix = 0;
      this.modelMixStep = 1 / Math.max(1, Math.round(sampleRate * MODEL_CROSSFADE_SECONDS));
      this.modelPcmActive = false;
      this.modelFallbackActive = false;
      this.renderedModelFrames = 0;
      this.rehearsalLeft = 0;
      this.rehearsalRight = 0;
      this.modelBuffer = new Float32Array(
        Math.max(2_048, Math.round(sampleRate * MAX_MODEL_BUFFER_SECONDS * 2)),
      );
      this.delayBuffer = new Float32Array(
        Math.max(2_048, Math.round(sampleRate * MAX_DELAY_SECONDS)),
      );
      this.delayIndex = 0;
      this.lowState = 0;
      this.lowStateRight = 0;
      this.bandState = 0;
      this.bandStateRight = 0;
      this.envelope = 0;
      this.holdEnvelope = 0;
      this.previousInput = 0;
      this.randomState = 0x6d2b79f5;
      this.inputChunk = new Float32Array(MICROMORPH_PCM_CHUNK_FRAMES);
      this.inputChunkIndex = 0;
      this.inputSequence = 0;
      this.telemetryCounter = 0;
      this.inputSquareSum = 0;
      this.outputSquareSum = 0;
      this.telemetrySamples = 0;

      this.port.onmessage = (event) => this.handleMessage(event.data);
    }

    handleMessage(message) {
      if (!message || typeof message !== "object") return;
      if (message.type === "active") {
        this.active = Boolean(message.value);
        if (!this.active) {
          this.resetSignalState();
          this.publishTelemetry();
        }
        return;
      }
      if (message.type === "parameters") {
        this.parameters = {
          ...sanitizeMicromorphParams({
            ...this.parameters,
            ...message.parameters,
          }),
        };
        return;
      }
      if (message.type === "model-active") {
        this.modelActive = Boolean(message.value);
        if (!this.modelActive) this.clearModelBuffer(false);
        return;
      }
      if (message.type === "model-config") {
        const channelValue = Number(message.channels);
        const blockSizeValue = Number(message.blockSize);
        const channels = Math.trunc(channelValue);
        const blockSize = Math.trunc(blockSizeValue);
        if (
          !Number.isInteger(channelValue)
          || channels !== 2
          || !Number.isInteger(blockSizeValue)
          || blockSize < 1
          || blockSize > MICROMORPH_MAX_MODEL_PCM_FRAMES
        ) {
          this.modelRejectedBlocks += 1;
          return;
        }
        this.modelChannels = channels;
        this.modelBlockFrames = blockSize;
        this.clearModelBuffer(false);
        return;
      }
      if (message.type === "model-pcm") {
        this.enqueueModelPcm(message.samples, message.channels);
        return;
      }
      if (message.type === "reset") this.resetSignalState();
    }

    clearModelBuffer(resetTransition = false) {
      this.modelRead = 0;
      this.modelWrite = 0;
      this.modelAvailable = 0;
      this.modelUnderflows = 0;
      this.modelUnderflowing = false;
      this.modelPcmActive = false;
      if (resetTransition) {
        this.modelMix = 0;
        this.lastModelOutputLeft = 0;
        this.lastModelOutputRight = 0;
        this.modelFallbackActive = false;
      }
    }

    resetSignalState() {
      this.clearModelBuffer(true);
      this.delayBuffer.fill(0);
      this.delayIndex = 0;
      this.lowState = 0;
      this.lowStateRight = 0;
      this.bandState = 0;
      this.bandStateRight = 0;
      this.envelope = 0;
      this.holdEnvelope = 0;
      this.previousInput = 0;
      this.inputChunkIndex = 0;
      this.inputSquareSum = 0;
      this.outputSquareSum = 0;
      this.telemetrySamples = 0;
    }

    enqueueModelPcm(samples, channels = 2) {
      let pcm = null;
      try {
        if (samples instanceof Float32Array) {
          pcm = samples;
        } else if (samples instanceof ArrayBuffer) {
          if (samples.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) throw new RangeError();
          pcm = new Float32Array(samples);
        } else if (ArrayBuffer.isView(samples)) {
          if (
            samples.byteOffset % Float32Array.BYTES_PER_ELEMENT !== 0
            || samples.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0
          ) throw new RangeError();
          pcm = new Float32Array(
            samples.buffer,
            samples.byteOffset,
            samples.byteLength / Float32Array.BYTES_PER_ELEMENT,
          );
        }
      } catch {
        this.modelRejectedBlocks += 1;
        return false;
      }
      if (!pcm?.length) return false;
      const channelValue = Number(channels);
      const channelCount = Math.trunc(channelValue);
      if (
        !Number.isInteger(channelValue)
        || channelCount !== 2
        || channelCount !== this.modelChannels
        || pcm.length % channelCount !== 0
      ) {
        this.modelRejectedBlocks += 1;
        return false;
      }
      const frameCount = Math.floor(pcm.length / channelCount);
      if (
        frameCount < 1
        || frameCount > this.modelBlockFrames
        || frameCount > MICROMORPH_MAX_MODEL_PCM_FRAMES
      ) {
        this.modelRejectedBlocks += 1;
        return false;
      }
      for (let frame = 0; frame < frameCount; frame += 1) {
        const left = pcm[frame * channelCount] || 0;
        const right = channelCount > 1 ? pcm[frame * channelCount + 1] || 0 : left;
        if (this.modelAvailable + 2 > this.modelBuffer.length) {
          this.modelRead = (this.modelRead + 2) % this.modelBuffer.length;
          this.modelAvailable -= 2;
        }
        this.modelBuffer[this.modelWrite] = Number.isFinite(left) ? left : 0;
        this.modelWrite = (this.modelWrite + 1) % this.modelBuffer.length;
        this.modelBuffer[this.modelWrite] = Number.isFinite(right) ? right : 0;
        this.modelWrite = (this.modelWrite + 1) % this.modelBuffer.length;
        this.modelAvailable += 2;
      }
      return true;
    }

    takeModelFrame() {
      if (this.modelAvailable < 2) {
        if (!this.modelUnderflowing) this.modelUnderflows += 1;
        this.modelUnderflowing = true;
        return false;
      }
      this.modelUnderflowing = false;
      this.modelFrameLeft = this.modelBuffer[this.modelRead];
      this.modelRead = (this.modelRead + 1) % this.modelBuffer.length;
      this.modelFrameRight = this.modelBuffer[this.modelRead];
      this.modelRead = (this.modelRead + 1) % this.modelBuffer.length;
      this.modelAvailable -= 2;
      return true;
    }

    randomSigned() {
      let value = this.randomState | 0;
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      this.randomState = value >>> 0;
      return this.randomState / 2_147_483_648 - 1;
    }

    rehearsalFrame(input) {
      const parameters = this.parameters;
      const material = parameters.material;
      const memory = parameters.memory;
      const mutation = parameters.mutation;
      const structure = parameters.structureLock;
      const absoluteInput = Math.abs(input);
      const envelopeCoefficient = absoluteInput > this.envelope ? 0.17 : 0.006;
      this.envelope += (absoluteInput - this.envelope) * envelopeCoefficient;
      const continuationFloor = parameters.continuation * 0.11;
      this.holdEnvelope = Math.max(
        this.envelope,
        this.holdEnvelope * (0.9992 + parameters.continuation * 0.00075),
        continuationFloor * this.holdEnvelope,
      );

      const lowCoefficient = 0.006 + material * 0.045;
      this.lowState += (input - this.lowState) * lowCoefficient;
      this.lowStateRight += (input - this.lowStateRight) * (lowCoefficient * 0.83);
      const high = input - this.lowState;
      const highRight = input - this.lowStateRight;
      const transient = input - this.previousInput;
      this.previousInput = input;

      const resonantFrequency = 110 + material * 1_750;
      const resonanceStep = Math.min(0.46, 2 * Math.sin(Math.PI * resonantFrequency / sampleRate));
      const damping = 0.035 + (1 - memory) * 0.19;
      const highDrive = high - this.bandState * damping;
      this.bandState += resonanceStep * (highDrive - this.bandState * 0.08);
      const highDriveRight = highRight - this.bandStateRight * (damping * 1.08);
      this.bandStateRight += resonanceStep * 0.971
        * (highDriveRight - this.bandStateRight * 0.075);

      const delaySeconds = 0.035 + memory * memory * 0.82;
      const delayFrames = Math.max(1, Math.round(delaySeconds * sampleRate));
      const rightDelayFrames = Math.max(1, Math.round(delayFrames * (0.83 + material * 0.26)));
      const leftRead = (
        this.delayIndex - delayFrames + this.delayBuffer.length
      ) % this.delayBuffer.length;
      const rightRead = (
        this.delayIndex - rightDelayFrames + this.delayBuffer.length
      ) % this.delayBuffer.length;
      const delayLeft = this.delayBuffer[leftRead];
      const delayRight = this.delayBuffer[rightRead];
      const noise = this.randomSigned() * mutation;
      const feedback = 0.18 + memory * 0.68;
      const delayWrite = softLimit(
        input * (0.72 + structure * 0.24)
        + delayLeft * feedback
        + noise * this.holdEnvelope * 0.12,
      );
      this.delayBuffer[this.delayIndex] = delayWrite;
      this.delayIndex = (this.delayIndex + 1) % this.delayBuffer.length;

      const reconstructedLeft = softLimit(
        this.lowState * (1.08 - material * 0.28)
        + high * (0.66 + material * 0.62)
        + transient * structure * 0.22,
      );
      const reconstructedRight = softLimit(
        this.lowStateRight * (1.08 - material * 0.24)
        + highRight * (0.62 + material * 0.66)
        + transient * structure * 0.2,
      );
      const bodyEnvelope = structure * this.envelope
        + (1 - structure) * Math.max(this.holdEnvelope, 0.04 * parameters.continuation);
      const derivedLeft = softLimit(
        reconstructedLeft * (0.55 + structure * 0.35)
        + this.bandState * bodyEnvelope * (0.55 + material * 0.9)
        + delayLeft * memory * 0.44,
      );
      const derivedRight = softLimit(
        reconstructedRight * (0.55 + structure * 0.35)
        + this.bandStateRight * bodyEnvelope * (0.55 + material * 0.9)
        + delayRight * memory * 0.44,
      );
      const mutatedLeft = softLimit(
        derivedLeft * (1 - mutation * 0.22)
        + delayRight * (0.28 + mutation * 0.52)
        + noise * bodyEnvelope * 0.34,
      );
      const mutatedRight = softLimit(
        derivedRight * (1 - mutation * 0.22)
        + delayLeft * (0.28 + mutation * 0.52)
        - noise * bodyEnvelope * 0.34,
      );
      const imaginaryLeft = softLimit(
        mutatedLeft * 0.68
        + delayLeft * (0.42 + memory * 0.38)
        + this.bandStateRight * material * 0.42,
      );
      const imaginaryRight = softLimit(
        mutatedRight * 0.68
        + delayRight * (0.42 + memory * 0.38)
        - this.bandState * material * 0.42,
      );

      const stagePosition = parameters.derivation * 4;
      const lowerStage = Math.min(4, Math.floor(stagePosition));
      const stageFraction = stagePosition - lowerStage;
      let lowerLeft = input;
      let lowerRight = input;
      let upperLeft = reconstructedLeft;
      let upperRight = reconstructedRight;
      if (lowerStage === 1) {
        lowerLeft = reconstructedLeft;
        lowerRight = reconstructedRight;
        upperLeft = derivedLeft;
        upperRight = derivedRight;
      } else if (lowerStage === 2) {
        lowerLeft = derivedLeft;
        lowerRight = derivedRight;
        upperLeft = mutatedLeft;
        upperRight = mutatedRight;
      } else if (lowerStage === 3) {
        lowerLeft = mutatedLeft;
        lowerRight = mutatedRight;
        upperLeft = imaginaryLeft;
        upperRight = imaginaryRight;
      } else if (lowerStage === 4) {
        lowerLeft = imaginaryLeft;
        lowerRight = imaginaryRight;
        upperLeft = imaginaryLeft;
        upperRight = imaginaryRight;
      }
      this.rehearsalLeft = lowerLeft + (upperLeft - lowerLeft) * stageFraction;
      this.rehearsalRight = lowerRight + (upperRight - lowerRight) * stageFraction;
    }

    captureInput(input) {
      if (!this.active || !this.modelActive) return;
      this.inputChunk[this.inputChunkIndex] = input;
      this.inputChunkIndex += 1;
      if (this.inputChunkIndex < this.inputChunk.length) return;
      const samples = this.inputChunk;
      this.inputChunk = new Float32Array(MICROMORPH_PCM_CHUNK_FRAMES);
      this.inputChunkIndex = 0;
      const buffer = samples.buffer;
      this.port.postMessage({
        type: "input-pcm",
        protocol: MICROMORPH_PROTOCOL_VERSION,
        sequence: this.inputSequence,
        channels: 1,
        sampleRate,
        frames: samples.length,
        samples: buffer,
      }, [buffer]);
      this.inputSequence += 1;
    }

    publishTelemetry() {
      const count = Math.max(1, this.telemetrySamples);
      this.port.postMessage({
        type: "telemetry",
        inputRms: Math.sqrt(this.inputSquareSum / count),
        outputRms: Math.sqrt(this.outputSquareSum / count),
        modelActive: this.modelActive,
        modelBufferedFrames: Math.floor(this.modelAvailable / 2),
        modelUnderflows: this.modelUnderflows,
        modelRejectedBlocks: this.modelRejectedBlocks,
        modelPcmActive: this.modelPcmActive,
        modelFallbackActive: this.modelFallbackActive,
        modelTransitionMix: this.modelMix,
        renderedModelFrames: this.renderedModelFrames,
      });
      this.inputSquareSum = 0;
      this.outputSquareSum = 0;
      this.telemetrySamples = 0;
    }

    process(inputs, outputs) {
      const output = outputs[0];
      if (!output?.length) return true;
      const leftOutput = output[0];
      const rightOutput = output[1] ?? leftOutput;
      const inputChannels = inputs[0] ?? [];
      const frameCount = leftOutput.length;

      if (!this.active) {
        leftOutput.fill(0);
        if (rightOutput !== leftOutput) rightOutput.fill(0);
        return true;
      }

      for (let frame = 0; frame < frameCount; frame += 1) {
        let input = 0;
        for (let channel = 0; channel < inputChannels.length; channel += 1) {
          input += inputChannels[channel]?.[frame] ?? 0;
        }
        if (inputChannels.length) input /= inputChannels.length;
        input *= this.parameters.inputGain;
        if (!Number.isFinite(input)) input = 0;

        this.captureInput(input);
        const hasModelFrame = this.modelActive && this.takeModelFrame();
        const needsRehearsal = !hasModelFrame || this.modelMix < 1;
        if (needsRehearsal) this.rehearsalFrame(input);

        let left;
        let right;
        if (hasModelFrame) {
          const modelLeft = equalPowerMix(
            input,
            this.modelFrameLeft,
            this.parameters.derivation,
          );
          const modelRight = equalPowerMix(
            input,
            this.modelFrameRight,
            this.parameters.derivation,
          );
          this.lastModelOutputLeft = modelLeft;
          this.lastModelOutputRight = modelRight;
          this.renderedModelFrames += 1;
          this.modelMix = Math.min(1, this.modelMix + this.modelMixStep);
          if (1 - this.modelMix < EPSILON) this.modelMix = 1;
          if (this.modelMix >= 1) {
            left = modelLeft;
            right = modelRight;
          } else {
            const mix = this.modelMix * this.modelMix * (3 - 2 * this.modelMix);
            left = this.rehearsalLeft + (modelLeft - this.rehearsalLeft) * mix;
            right = this.rehearsalRight + (modelRight - this.rehearsalRight) * mix;
          }
        } else {
          this.modelMix = Math.max(0, this.modelMix - this.modelMixStep);
          if (this.modelMix < EPSILON) this.modelMix = 0;
          if (this.modelMix > 0) {
            const mix = this.modelMix * this.modelMix * (3 - 2 * this.modelMix);
            left = this.rehearsalLeft
              + (this.lastModelOutputLeft - this.rehearsalLeft) * mix;
            right = this.rehearsalRight
              + (this.lastModelOutputRight - this.rehearsalRight) * mix;
          } else {
            left = this.rehearsalLeft;
            right = this.rehearsalRight;
          }
        }
        this.modelPcmActive = hasModelFrame && this.modelMix > 0;
        this.modelFallbackActive = this.modelActive
          ? (!hasModelFrame || this.modelMix < 1)
          : this.modelMix > 0;
        left = softLimit(left) * this.parameters.outputLevel;
        right = softLimit(right) * this.parameters.outputLevel;
        leftOutput[frame] = Number.isFinite(left) ? left : 0;
        rightOutput[frame] = Number.isFinite(right) ? right : 0;
        this.inputSquareSum += input * input;
        this.outputSquareSum += (left * left + right * right) * 0.5;
        this.telemetrySamples += 1;
      }

      this.telemetryCounter += 1;
      if (this.telemetryCounter >= TELEMETRY_INTERVAL_BLOCKS) {
        this.telemetryCounter = 0;
        this.publishTelemetry();
      }
      return true;
    }
  };
}

export const createMicromorphProcessorClass = processorClass;

const AudioWorkletBase = globalThis.AudioWorkletProcessor;
if (
  typeof AudioWorkletBase === "function"
  && typeof globalThis.registerProcessor === "function"
) {
  globalThis.registerProcessor(
    MICROMORPH_PROCESSOR_NAME,
    processorClass(AudioWorkletBase),
  );
}

/**
 * Browser mic graph. Model inference remains in a local host; the worklet only
 * captures/plays PCM and provides a deterministic, explicitly labeled
 * rehearsal effect whenever no model stream is available.
 */
export class MicromorphAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.parameters = { ...MICROMORPH_DEFAULTS };
    this.context = null;
    this.node = null;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.master = null;
    this.ceiling = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.outputRelease = null;
    this.enabled = false;
    this.modelActive = false;
    this.modelPcmChannels = 2;
    this.modelPcmBlockSize = MICROMORPH_PCM_CHUNK_FRAMES;
    this.initializePromise = null;
    this.startPromise = null;
    this.closeGeneration = 0;
    this.startGeneration = 0;
    this.suspendTimer = null;
    this.inputFrameHandler = null;
    this.telemetryHandler = null;
    this.lastTelemetry = Object.freeze({
      inputRms: 0,
      outputRms: 0,
      modelActive: false,
      modelBufferedFrames: 0,
      modelUnderflows: 0,
      modelRejectedBlocks: 0,
      modelPcmActive: false,
      modelFallbackActive: false,
      modelTransitionMix: 0,
      renderedModelFrames: 0,
    });
  }

  get isInitialized() {
    return Boolean(this.context && this.context.state !== "closed");
  }

  get state() {
    return Object.freeze({
      initialized: this.isInitialized,
      enabled: this.enabled,
      starting: Boolean(this.startPromise),
      modelActive: this.modelActive,
      contextState: this.context?.state ?? "closed",
      sampleRate: this.context?.sampleRate ?? null,
      modelPcmConfig: Object.freeze({
        channels: this.modelPcmChannels,
        blockSize: this.modelPcmBlockSize,
      }),
      telemetry: this.lastTelemetry,
    });
  }

  initialize() {
    if (this.isInitialized) return Promise.resolve();
    if (this.initializePromise) return this.initializePromise;
    const generation = this.closeGeneration;
    let pending;
    pending = this.initializeGraph(generation).finally(() => {
      if (this.initializePromise === pending) this.initializePromise = null;
    });
    this.initializePromise = pending;
    return pending;
  }

  async initializeGraph(generation) {
    const AudioContextConstructor = this.runtime.AudioContext
      ?? this.runtime.webkitAudioContext;
    const AudioWorkletNodeConstructor = this.runtime.AudioWorkletNode
      ?? globalThis.AudioWorkletNode;
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }
    if (typeof AudioWorkletNodeConstructor !== "function") {
      throw new Error("Micromorph requires AudioWorklet support.");
    }

    const context = new AudioContextConstructor({
      latencyHint: "interactive",
      sampleRate: DEFAULT_SAMPLE_RATE,
    });
    if (!context.audioWorklet) {
      await context.close().catch(() => {});
      throw new Error("Micromorph requires AudioWorklet support.");
    }

    let node = null;
    let inputAnalyser = null;
    let outputAnalyser = null;
    let ceiling = null;
    let master = null;
    let outputRelease = null;
    try {
      unlockAudioContext(context);
      await context.resume();
      await context.audioWorklet.addModule(new URL("./micromorph.js", import.meta.url));
      node = new AudioWorkletNodeConstructor(context, MICROMORPH_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { parameters: this.parameters },
      });
      inputAnalyser = context.createAnalyser();
      outputAnalyser = context.createAnalyser();
      ceiling = context.createWaveShaper();
      master = context.createGain();
      for (const analyser of [inputAnalyser, outputAnalyser]) {
        analyser.fftSize = 1_024;
        analyser.minDecibels = -100;
        analyser.maxDecibels = -10;
        analyser.smoothingTimeConstant = 0.7;
      }
      const curve = new Float32Array(2_049);
      for (let index = 0; index < curve.length; index += 1) {
        const value = index / (curve.length - 1) * 2 - 1;
        curve[index] = softLimit(value);
      }
      ceiling.curve = curve;
      ceiling.oversample = "2x";
      master.gain.value = 0;

      inputAnalyser.connect(node);
      node.connect(ceiling).connect(master).connect(outputAnalyser);
      outputRelease = connectAudioOutput(context, outputAnalyser, {
        runtime: this.runtime,
      });
      node.port.onmessage = (event) => this.handleWorkletMessage(event.data);

      if (generation !== this.closeGeneration) {
        throw lifecycleCancellation("Micromorph initialization was cancelled.");
      }
      node.port.postMessage({ type: "parameters", parameters: this.parameters });
      node.port.postMessage({
        type: "model-config",
        channels: this.modelPcmChannels,
        blockSize: this.modelPcmBlockSize,
      });
      node.port.postMessage({ type: "model-active", value: this.modelActive });

      this.context = context;
      this.node = node;
      this.inputAnalyser = inputAnalyser;
      this.outputAnalyser = outputAnalyser;
      this.ceiling = ceiling;
      this.master = master;
      this.outputRelease = outputRelease;
      outputRelease = null;
    } catch (error) {
      try {
        outputRelease?.();
      } catch {
        // Output routing teardown is best-effort after partial initialization.
      }
      if (node?.port) node.port.onmessage = null;
      disconnectNode(node);
      disconnectNode(inputAnalyser);
      disconnectNode(outputAnalyser);
      disconnectNode(ceiling);
      disconnectNode(master);
      await context.close().catch(() => {});
      throw error;
    }
  }

  handleWorkletMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "input-pcm") {
      this.inputFrameHandler?.(message);
      return;
    }
    if (message.type === "telemetry") {
      this.lastTelemetry = Object.freeze({
        inputRms: clamp(message.inputRms, 0, 8, 0),
        outputRms: clamp(message.outputRms, 0, 8, 0),
        modelActive: Boolean(message.modelActive),
        modelBufferedFrames: Math.max(0, Math.trunc(message.modelBufferedFrames) || 0),
        modelUnderflows: Math.max(0, Math.trunc(message.modelUnderflows) || 0),
        modelRejectedBlocks: Math.max(0, Math.trunc(message.modelRejectedBlocks) || 0),
        modelPcmActive: Boolean(message.modelPcmActive),
        modelFallbackActive: Boolean(message.modelFallbackActive),
        modelTransitionMix: clamp(message.modelTransitionMix, 0, 1, 0),
        renderedModelFrames: Math.max(0, Math.trunc(message.renderedModelFrames) || 0),
      });
      this.telemetryHandler?.(this.lastTelemetry);
    }
  }

  setInputFrameHandler(handler) {
    this.inputFrameHandler = typeof handler === "function" ? handler : null;
  }

  setTelemetryHandler(handler) {
    this.telemetryHandler = typeof handler === "function" ? handler : null;
  }

  setParameters(parameters = {}) {
    this.parameters = {
      ...sanitizeMicromorphParams({ ...this.parameters, ...parameters }),
    };
    this.node?.port.postMessage({
      type: "parameters",
      parameters: this.parameters,
    });
    if (this.enabled && this.master && this.context) {
      this.master.gain.setTargetAtTime(1, this.context.currentTime, 0.018);
    }
    return Object.freeze({ ...this.parameters });
  }

  setModelActive(active) {
    const next = Boolean(active);
    if (next === this.modelActive) return;
    this.modelActive = next;
    this.node?.port.postMessage({ type: "model-active", value: this.modelActive });
  }

  configureModelPcm({
    channels = 2,
    blockSize = MICROMORPH_PCM_CHUNK_FRAMES,
  } = {}) {
    const channelValue = Number(channels);
    const blockSizeValue = Number(blockSize);
    const normalizedChannels = Math.trunc(channelValue);
    const normalizedBlockSize = Math.trunc(blockSizeValue);
    if (!Number.isInteger(channelValue) || normalizedChannels !== 2) {
      throw new RangeError("Micromorph model PCM must be negotiated as stereo.");
    }
    if (
      !Number.isInteger(blockSizeValue)
      || normalizedBlockSize < 1
      || normalizedBlockSize > MICROMORPH_MAX_MODEL_PCM_FRAMES
    ) {
      throw new RangeError(
        `Micromorph model PCM blocks must contain 1 to ${MICROMORPH_MAX_MODEL_PCM_FRAMES} frames.`,
      );
    }
    this.modelPcmChannels = normalizedChannels;
    this.modelPcmBlockSize = normalizedBlockSize;
    this.node?.port.postMessage({
      type: "model-config",
      channels: normalizedChannels,
      blockSize: normalizedBlockSize,
    });
    return Object.freeze({
      channels: normalizedChannels,
      blockSize: normalizedBlockSize,
    });
  }

  enqueueModelPcm(samples, { channels = 2 } = {}) {
    if (!this.node) return false;
    let pcm = null;
    try {
      if (samples instanceof Float32Array) {
        pcm = samples;
      } else if (samples instanceof ArrayBuffer) {
        if (samples.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return false;
        pcm = new Float32Array(samples);
      }
    } catch {
      return false;
    }
    if (!pcm?.length) return false;
    const channelValue = Number(channels);
    const channelCount = Math.trunc(channelValue);
    if (
      !Number.isInteger(channelValue)
      || channelCount !== 2
      || channelCount !== this.modelPcmChannels
      || pcm.length % channelCount !== 0
    ) return false;
    const frameCount = pcm.length / channelCount;
    if (
      frameCount < 1
      || frameCount > this.modelPcmBlockSize
      || frameCount > MICROMORPH_MAX_MODEL_PCM_FRAMES
    ) return false;
    const copy = new Float32Array(pcm);
    this.node.port.postMessage({
      type: "model-pcm",
      channels: channelCount,
      samples: copy.buffer,
    }, [copy.buffer]);
    return true;
  }

  start() {
    if (this.enabled) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.clearSuspendTimer();
    const startGeneration = this.startGeneration + 1;
    this.startGeneration = startGeneration;
    const closeGeneration = this.closeGeneration;
    let pending;
    pending = this.startMicrophone(startGeneration, closeGeneration).finally(() => {
      if (this.startPromise === pending) this.startPromise = null;
    });
    this.startPromise = pending;
    return pending;
  }

  startIsCurrent(startGeneration, closeGeneration) {
    return startGeneration === this.startGeneration
      && closeGeneration === this.closeGeneration;
  }

  async startMicrophone(startGeneration, closeGeneration) {
    await this.initialize();
    if (!this.startIsCurrent(startGeneration, closeGeneration)) {
      throw lifecycleCancellation("Microphone start was cancelled.");
    }
    const getUserMedia = this.runtime.navigator?.mediaDevices?.getUserMedia
      ?.bind(this.runtime.navigator.mediaDevices);
    if (typeof getUserMedia !== "function") {
      this.deactivateGraph();
      this.scheduleSuspend();
      throw new Error("Microphone input is not available in this browser.");
    }
    this.releaseSource();
    let stream = null;
    let sourceNode = null;
    try {
      stream = await getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      if (!this.startIsCurrent(startGeneration, closeGeneration)) {
        throw lifecycleCancellation("Microphone start was cancelled after permission was granted.");
      }

      const context = this.context;
      const node = this.node;
      const inputAnalyser = this.inputAnalyser;
      const master = this.master;
      if (!context || !node || !inputAnalyser || !master || context.state === "closed") {
        throw lifecycleCancellation("Micromorph audio closed before microphone startup completed.");
      }
      this.mediaStream = stream;
      await context.resume();
      if (
        !this.startIsCurrent(startGeneration, closeGeneration)
        || context !== this.context
      ) {
        throw lifecycleCancellation("Microphone start was cancelled while audio resumed.");
      }
      sourceNode = context.createMediaStreamSource(stream);
      sourceNode.connect(inputAnalyser);
      this.sourceNode = sourceNode;
      node.port.postMessage({ type: "reset" });
      node.port.postMessage({ type: "active", value: true });
      node.port.postMessage({ type: "model-active", value: this.modelActive });
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(1, now + 0.035);
      this.enabled = true;
    } catch (error) {
      if (this.sourceNode !== sourceNode) disconnectNode(sourceNode);
      if (this.mediaStream === stream) this.releaseSource();
      else stopMediaStream(stream);
      if (this.startIsCurrent(startGeneration, closeGeneration)) {
        this.enabled = false;
        this.node?.port.postMessage({ type: "active", value: false });
        if (this.master) this.master.gain.value = 0;
        await this.context?.suspend?.().catch(() => {});
      }
      throw error;
    }
  }

  releaseSource() {
    try {
      this.sourceNode?.disconnect();
    } catch {
      // The context may already have closed.
    }
    this.sourceNode = null;
    stopMediaStream(this.mediaStream);
    this.mediaStream = null;
  }

  clearSuspendTimer() {
    if (this.suspendTimer === null) return;
    this.runtime.clearTimeout?.(this.suspendTimer);
    this.suspendTimer = null;
  }

  deactivateGraph() {
    this.enabled = false;
    this.node?.port.postMessage({ type: "active", value: false });
    if (!this.isInitialized || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.035);
  }

  scheduleSuspend() {
    this.clearSuspendTimer();
    const suspend = () => {
      this.suspendTimer = null;
      if (!this.enabled && this.context?.state === "running") {
        this.context.suspend().catch(() => {});
      }
    };
    if (typeof this.runtime.setTimeout === "function") {
      this.suspendTimer = this.runtime.setTimeout(suspend, 55);
    } else {
      suspend();
    }
  }

  getWaveforms(inputTarget, outputTarget) {
    if (
      !this.inputAnalyser
      || !this.outputAnalyser
      || !(inputTarget instanceof Float32Array)
      || !(outputTarget instanceof Float32Array)
      || inputTarget.length !== this.inputAnalyser.fftSize
      || outputTarget.length !== this.outputAnalyser.fftSize
    ) return false;
    this.inputAnalyser.getFloatTimeDomainData(inputTarget);
    this.outputAnalyser.getFloatTimeDomainData(outputTarget);
    return true;
  }

  async stop() {
    this.startGeneration += 1;
    const pendingStart = this.startPromise;
    this.releaseSource();
    this.setModelActive(false);
    this.deactivateGraph();
    this.scheduleSuspend();
    await pendingStart?.catch(() => {});
    this.releaseSource();
    this.deactivateGraph();
    this.scheduleSuspend();
  }

  async close() {
    this.startGeneration += 1;
    this.closeGeneration += 1;
    const pendingStart = this.startPromise;
    const pendingInitialize = this.initializePromise;
    this.clearSuspendTimer();
    this.releaseSource();
    this.enabled = false;
    this.modelActive = false;
    const node = this.node;
    const inputAnalyser = this.inputAnalyser;
    const outputAnalyser = this.outputAnalyser;
    const ceiling = this.ceiling;
    const master = this.master;
    node?.port.postMessage({ type: "active", value: false });
    if (node?.port) node.port.onmessage = null;
    disconnectNode(node);
    disconnectNode(inputAnalyser);
    disconnectNode(outputAnalyser);
    disconnectNode(ceiling);
    disconnectNode(master);
    try {
      this.outputRelease?.();
    } catch {
      // Output routing may already have been released by its host.
    }
    this.outputRelease = null;
    const context = this.context;
    this.context = null;
    this.node = null;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.ceiling = null;
    this.master = null;
    const closingContext = context?.close?.().catch(() => {});
    await Promise.allSettled([
      closingContext,
      pendingInitialize,
      pendingStart,
    ].filter(Boolean));
    this.releaseSource();
  }
}
