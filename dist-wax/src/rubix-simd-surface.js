import { createSimd303Configuration } from "./simd-303.js";
import { RUBIX_FACE_ROLES } from "./rubix-mix.js";
import { RUBIX_ACID_NORMALIZED_BY_COLOR, rubixReadFrame } from "./rubix.js";
import { createRubixWebGpu303Pattern } from "./rubix-webgpu-303.js";
import { WEBGPU_303_SEQUENCE_LENGTH } from "./webgpu-303.js";
import { rubixStickerVisibility, rubixVisibilityGain } from "./rubix-visibility.js";
import { rubixSimdPreset, RUBIX_SIMD_COLOR_TONE } from "./rubix-simd-presets.js";

const abortError = () => Object.assign(new Error("Rubix SIMD start cancelled."), { name: "AbortError" });

/** Reuse the original placement/timbre mapping; the audio renderer is SIMD. */
export function createRubixSimdSurfacePatterns(snapshot, options = {}) {
  const readingMode = options.readingMode ?? "parallel";
  const preset = options.presetId ? rubixSimdPreset(options.presetId) : null;
  return Object.entries(snapshot.faceLanes).map(([face, lane]) => {
    const pattern = createRubixWebGpu303Pattern({
      lanes: { acid: lane },
      audio: { acidNormalized: lane.map(({ color }) => RUBIX_ACID_NORMALIZED_BY_COLOR[color]) },
    }, { ...options, readingMode });
    const common = {
      face, readingMode, stickerIds: lane.map(({ id }) => id),
      spectrumMorph: preset?.spectrumMorph ?? 0,
      surface: preset?.surface ?? false,
    };
    const coloredModulation = pattern.stepModulation.map((step) => [...step]);
    const expression = Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, () => [0, 1, 0, 1]);
    if (preset?.surface) {
      for (let beat = 0; beat < lane.length; beat += 1) {
        const cell = rubixReadFrame(readingMode, beat * (readingMode === "face" ? 3 : 1), lane.length).cellIndex;
        const tone = RUBIX_SIMD_COLOR_TONE[lane[cell].color];
        const amount = Math.max(0, Math.min(1, options.amount ?? 0.68));
        coloredModulation[beat][1] += tone.filter * amount;
        coloredModulation[beat][2] += tone.resonance * amount;
        expression[beat] = [tone.accent * amount, 1 - (1 - tone.gate) * amount, 0, 1];
      }
    }
    if (readingMode !== "face") return { ...pattern, ...common, stepModulation: coloredModulation, stepExpression: expression };
    const sequence = Array(WEBGPU_303_SEQUENCE_LENGTH).fill(-1);
    const stepModulation = Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, () => [0, 0, 0, 0]);
    const stepExpression = Array.from({ length: WEBGPU_303_SEQUENCE_LENGTH }, () => [0, 1, 0, 1]);
    for (let step = 0; step < lane.length * 3; step += 1) {
      if (!rubixReadFrame("face", step, lane.length).activeRoles.includes(RUBIX_FACE_ROLES[face])) continue;
      sequence[step] = pattern.sequence[Math.floor(step / 3)];
      stepModulation[step] = coloredModulation[Math.floor(step / 3)];
      stepExpression[step] = expression[Math.floor(step / 3)];
    }
    return {
      ...pattern, ...common, sequence, stepModulation, stepExpression,
      params: { ...pattern.params, timeMod: lane.length * 3, timeScale: pattern.params.timeScale * 3 },
    };
  });
}

/** Prepare all faces atomically; no GPU device, audio chunks or JS note timers. */
export function rubixSimdConfigurations(patterns) {
  if (!Array.isArray(patterns) || patterns.length !== 6) throw new Error("Rubix SIMD requires six face patterns.");
  return patterns.map((pattern) => {
    const divisions = pattern.readingMode === "face" ? 3 : 1;
    const stepCount = pattern.stickerIds.length * divisions;
    if (stepCount > 512 || pattern.stickerIds.length > 36) throw new Error("Rubix SIMD face is too large.");
    const stepStickerIds = Array.from({ length: stepCount }, (_, step) => {
      const frame = rubixReadFrame(pattern.readingMode, step, pattern.stickerIds.length);
      return frame.activeRoles.includes(RUBIX_FACE_ROLES[pattern.face])
        ? pattern.stickerIds[frame.cellIndex] : null;
    });
    const configuration = createSimd303Configuration(
      pattern.params, pattern.sequence, pattern.stepModulation,
      // No delayed or chorused hidden notes: Rubix is a dry surface instrument.
      { spectrumMorph: pattern.spectrumMorph ?? 0, chorusMix: 0, delayMix: 0, delayFeedback: 0 },
      pattern.stepExpression,
    );
    return {
      face: pattern.face, stepStickerIds, divisions,
      // The legacy kernel also morphs harmonic weights by transport position.
      // Surface patches use their chosen spectrum throughout the loop instead;
      // only the explicit Original sweep retains that independent movement.
      configuration: pattern.surface ? {
        ...configuration, partialFold: configuration.partialBase.slice(),
      } : configuration,
    };
  });
}

export class RubixSurfaceSimd303 {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.node = null;
    this.patterns = [];
    this.profile = {};
    this.amount = 1;
    this.timbres = {};
    this.output = 1;
    this.enabled = false;
    this.generation = 0;
    this.backend = "none";
    this.faceCount = 0;
    this.timelineStart = null;
    this.lastStatus = null;
    this.readyTimeout = null;
    this.cancelReady = null;
    this.abortController = null;
  }

  updateSurfacePatterns(patterns) {
    const faces = rubixSimdConfigurations(patterns);
    this.patterns = patterns;
    this.faces = faces;
    this.node?.port.postMessage({ type: "configure", faces });
    this.updateVisibility(this.profile, this.amount, this.timbres);
  }

  setErrorHandler(handler) { this.onError = handler; }
  setStepHandler(handler) { this.onStep = handler; }
  setOutput(value) {
    this.output = Math.max(0, Math.min(1, Number(value) || 0));
    this.node?.port.postMessage({ type: "output", value: this.output });
  }
  setPlaybackEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.node?.port.postMessage({ type: "playback", enabled: this.enabled });
  }

  async start(_params, { context, destination } = {}) {
    if (this.context) await this.stop();
    if (!context?.audioWorklet || !destination) throw new Error("Rubix SIMD requires a shared AudioWorklet context.");
    const generation = ++this.generation;
    this.context = context;
    this.abortController = new this.runtime.AbortController();
    const signal = this.abortController.signal;
    const load = async (filename, required) => {
      try {
        const response = await this.runtime.fetch(new URL(`../assets/wasm/${filename}`, import.meta.url), { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (!this.runtime.WebAssembly.validate(bytes)) throw new Error(`${filename} is unsupported.`);
        return bytes;
      } catch (error) {
        if (required || signal.aborted) throw error;
        return null;
      }
    };
    try {
      const forceScalar = new URL(this.runtime.location?.href ?? "https://localhost/").searchParams.has("scalar");
      const [scalarBytes, simdBytes] = await Promise.all([
        load("simd-303-scalar.wasm", true),
        forceScalar ? Promise.resolve(null) : load("simd-303-simd.wasm", false),
        context.audioWorklet.addModule(new URL("./rubix-simd-303-processor.js", import.meta.url)),
      ]);
      if (generation !== this.generation || context !== this.context) throw abortError();
      const node = new this.runtime.AudioWorkletNode(context, "morphazoid-rubix-simd-303", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      this.node = node;
      node.connect(destination);
      const ready = new Promise((resolve, reject) => {
        this.cancelReady = () => reject(abortError());
        this.readyTimeout = this.runtime.setTimeout(() => reject(new Error("Rubix SIMD worklet did not become ready.")), 6000);
        node.port.onmessageerror = () => reject(new Error("Rubix SIMD worklet message could not be decoded."));
        node.port.onmessage = ({ data }) => {
          if (generation !== this.generation) return;
          if (data.type === "ready") {
            this.backend = data.backend;
            this.faceCount = data.faceCount;
            resolve();
          } else if (data.type === "step") {
            this.onStep?.(data.step, data.time);
          } else if (data.type === "status") {
            this.lastStatus = data;
          } else if (data.type === "error") {
            const error = new Error(data.message);
            if (this.cancelReady) reject(error);
            else this.onError?.(error);
          }
        };
        node.onprocessorerror = () => {
          const error = new Error("Rubix SIMD AudioWorklet stopped.");
          if (this.cancelReady) reject(error);
          else this.onError?.(error);
        };
      });
      node.port.postMessage({
        type: "install", scalarBytes, simdBytes, faces: this.faces,
      }, simdBytes ? [scalarBytes, simdBytes] : [scalarBytes]);
      await ready;
      this.runtime.clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
      this.cancelReady = null;
      if (generation !== this.generation || context !== this.context) throw abortError();
      this.setOutput(this.output);
      this.updateVisibility(this.profile, this.amount, this.timbres);
      this.setPlaybackEnabled(this.enabled);
      return context;
    } catch (error) {
      // An old start may finish after stop/new start; never tear down its successor.
      if (generation === this.generation) await this.stop();
      throw error;
    }
  }

  updateVisibility(profile, amount = 1, timbres = this.timbres) {
    this.profile = profile;
    this.amount = amount;
    this.timbres = timbres;
    if (!this.node) return;
    const gains = Object.fromEntries(this.patterns.flatMap((pattern) => pattern.stickerIds.map((id) => [
      id, rubixVisibilityGain(rubixStickerVisibility(profile, id), amount),
    ])));
    const surface = this.patterns.some((pattern) => pattern.surface) ? timbres : {};
    const key = JSON.stringify([gains, surface]);
    if (key === this.visibilityKey) return;
    this.visibilityKey = key;
    this.node.port.postMessage({ type: "visibility", gains, timbres: surface });
  }

  async restartTimeline({ startAt, offset = 0 } = {}) {
    if (!this.context || !this.node) throw new Error("Rubix SIMD is not ready.");
    // Two render quanta of message-delivery headroom, not a 250 ms chunk queue.
    const start = Math.max(Number(startAt) || 0, this.context.currentTime + 256 / this.context.sampleRate);
    this.timelineStart = start;
    this.node.port.postMessage({ type: "restart", startAt: start, offset });
    return start;
  }
  pauseTimeline() {
    this.setPlaybackEnabled(false);
  }
  async stop() {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.cancelReady?.();
    this.cancelReady = null;
    if (this.readyTimeout !== null) this.runtime.clearTimeout(this.readyTimeout);
    this.readyTimeout = null;
    if (this.node) {
      this.node.port.postMessage({ type: "dispose" });
      this.node.port.onmessage = null;
      this.node.port.onmessageerror = null;
      this.node.onprocessorerror = null;
      this.node.disconnect();
      this.node.port.close();
    }
    this.node = null;
    this.context = null;
    this.backend = "none";
    this.faceCount = 0;
    this.visibilityKey = "";
    this.lastStatus = null;
    this.timelineStart = null;
  }
}
