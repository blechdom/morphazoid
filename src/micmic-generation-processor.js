import { MicmicGenerationDSP } from "./micmic-generation-dsp.js?v=20260724-adaptive-canopy";

const LOAD_REPORT_BLOCKS = 96;
const CLOCK_KIND = typeof globalThis.performance?.now === "function"
  ? "high-res"
  : "unavailable";

function clockMilliseconds() {
  try {
    if (CLOCK_KIND === "high-res") return globalThis.performance.now();
  } catch {
    // Render telemetry is optional; audio must continue.
  }
  return null;
}

class MicmicGenerationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.rendererKind = options.processorOptions?.renderer === "granular-economy"
      ? "granular-economy"
      : "granular-fallback";
    this.renderer = new MicmicGenerationDSP({
      sampleRate,
      historySeconds: options.processorOptions?.historySeconds,
      maxVoices: options.processorOptions?.maxVoices,
    });
    this.requestedVoices = 0;
    this.loadBlocks = 0;
    this.loadTotal = 0;
    this.loadPeak = 0;
    this.pendingControlMilliseconds = 0;
    this.reportedTimingUnavailable = false;
    this.port.onmessage = ({ data }) => {
      const startedAt = clockMilliseconds();
      if (data?.type === "voices") {
        this.requestedVoices = Math.max(
          0,
          Math.floor(Number(data.requestedVoiceCount) || data.voices?.length || 0),
        );
        const previousLimit = this.renderer.runtimeLimit;
        this.renderer.setVoices(data.voices, data.voiceLimit);
        if (this.renderer.runtimeLimit !== previousLimit) {
          this.loadBlocks = 0;
          this.loadTotal = 0;
          this.loadPeak = 0;
          this.pendingControlMilliseconds = 0;
        }
      }
      const endedAt = clockMilliseconds();
      if (startedAt !== null && endedAt !== null) {
        this.pendingControlMilliseconds += Math.max(0, endedAt - startedAt);
      }
    };
    this.port.postMessage?.({
      type: "renderer-ready",
      renderer: this.rendererKind,
    });
  }

  recordRenderLoad(startedAt, frameCount) {
    if (startedAt === null || CLOCK_KIND === "unavailable") {
      if (!this.reportedTimingUnavailable) {
        this.port.postMessage?.({ type: "render-load", supported: false });
        this.reportedTimingUnavailable = true;
      }
      return;
    }
    const endedAt = clockMilliseconds();
    if (endedAt === null) return;
    const budgetMilliseconds = Math.max(1, frameCount) / sampleRate * 1000;
    const elapsed = Math.max(0, endedAt - startedAt) + this.pendingControlMilliseconds;
    this.pendingControlMilliseconds = 0;
    const load = elapsed / Math.max(1e-6, budgetMilliseconds);
    this.loadBlocks += 1;
    this.loadTotal += load;
    this.loadPeak = Math.max(this.loadPeak, load);
    if (this.loadBlocks < LOAD_REPORT_BLOCKS) return;
    this.port.postMessage?.({
      type: "render-load",
      supported: true,
      timing: CLOCK_KIND,
      averageLoad: this.loadTotal / this.loadBlocks,
      peakLoad: this.loadPeak,
      activeVoices: this.renderer.activeTargetCount,
      renderedVoices: this.renderer.voices.size,
      requestedVoices: this.requestedVoices,
      voiceLimit: this.renderer.runtimeLimit,
      mode: "sine",
      renderer: this.rendererKind,
    });
    this.loadBlocks = 0;
    this.loadTotal = 0;
    this.loadPeak = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (!output[0]) return true;
    const startedAt = clockMilliseconds();
    const keepAlive = this.renderer.process(
      input[0],
      input[1],
      output[0],
      output[1] ?? output[0],
    );
    this.recordRenderLoad(startedAt, output[0].length);
    return keepAlive;
  }
}

registerProcessor("morphazoid-micmic-generations", MicmicGenerationProcessor);
