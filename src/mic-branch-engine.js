import { clampMicValue, sanitizeMicBranchVoice, MicBranchDSP } from "./mic-branch-dsp.js";
import { AdaptivePolyphonyController } from "./adaptive-polyphony.js";

const MASTER_TIME_CONSTANT = 0.03;
const DEFAULT_INITIAL_VOICES = 128;
const MAX_MIC_BRANCH_VOICES = 4096;

function levelToGain(level) {
  const normalized = clampMicValue(level, 0, 1, 0.55);
  return normalized === 0 ? 0 : normalized ** 1.6;
}

export class MicBranchEngine {
  constructor(initialVoices = DEFAULT_INITIAL_VOICES, options = {}) {
    this.initialVoices = Math.max(1, Math.min(
      DEFAULT_INITIAL_VOICES,
      Math.floor(Number(initialVoices) || DEFAULT_INITIAL_VOICES),
    ));
    this.adaptivePolyphony = options.adaptive !== false;
    this.maxVoices = Math.max(this.initialVoices, Math.min(
      MAX_MIC_BRANCH_VOICES,
      Math.floor(Number(options.maxVoices) || MAX_MIC_BRANCH_VOICES),
    ));
    this.polyphonyController = this.adaptivePolyphony
      ? new AdaptivePolyphonyController({
        initialVoices: this.initialVoices,
        hardLimits: {
          sine: this.maxVoices,
          fm: this.maxVoices,
          pm: this.maxVoices,
          shepard: this.maxVoices,
        },
      })
      : null;
    this.context = null;
    this.master = null;
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.enabled = false;
    this.level = 0.55;
    this.feedback = 0.32;
    this.pendingVoices = [];
    this.voiceDemand = 0;
    this.lastSubmittedVoiceCount = 0;
    this.onPolyphonyStatus = null;
    this.lastPolyphonyStatusSignature = "";
    this.renderCapacity = null;
    this.renderCapacityActive = false;
    this.lastPlaybackStatsAt = -Infinity;
    this.lastUnderrunEvents = 0;
    this.lastUnderrunDuration = 0;
  }

  get voiceLimit() {
    return this.polyphonyController?.limitFor("sine") ?? this.initialVoices;
  }

  get polyphonyStatus() {
    if (this.polyphonyController) return this.polyphonyController.decision("sine");
    return Object.freeze({
      mode: "sine",
      limit: this.initialVoices,
      stableLimit: this.initialVoices,
      hardLimit: this.initialVoices,
      demand: this.voiceDemand,
      activeVoices: this.lastSubmittedVoiceCount,
      averageLoad: null,
      peakLoad: null,
      underrunRatio: 0,
      status: "fixed",
      source: "fixed",
      telemetry: "unavailable",
    });
  }

  setVoiceDemand(value) {
    this.voiceDemand = Math.max(0, Math.floor(Number(value) || 0));
    const status = this.polyphonyController?.setDemand("sine", this.voiceDemand)
      ?? this.polyphonyStatus;
    this.notifyPolyphonyStatus(status);
    return status.limit;
  }

  notifyPolyphonyStatus(status = this.polyphonyStatus) {
    const signature = [
      status.limit,
      status.demand,
      status.status,
      status.source,
      Number.isFinite(status.averageLoad) ? status.averageLoad.toFixed(3) : "-",
      Number.isFinite(status.peakLoad) ? status.peakLoad.toFixed(3) : "-",
    ].join("|");
    if (signature === this.lastPolyphonyStatusSignature) return;
    this.lastPolyphonyStatusSignature = signature;
    try {
      this.onPolyphonyStatus?.(status);
    } catch {
      // Capacity readouts must never interrupt audio updates.
    }
  }

  observePolyphony(sample) {
    if (!this.polyphonyController) return this.polyphonyStatus;
    const status = this.polyphonyController.observe({ mode: "sine", ...sample });
    this.notifyPolyphonyStatus(status);
    return status;
  }

  useAdaptiveFallback(source = "safe-fallback") {
    if (!this.polyphonyController) return;
    this.polyphonyController.setTelemetryUnavailable(source);
    this.notifyPolyphonyStatus();
  }

  startRenderCapacityMonitoring() {
    if (!this.polyphonyController || this.renderCapacityActive) return;
    const capacity = this.context?.renderCapacity;
    if (!capacity || typeof capacity.start !== "function") return;
    try {
      capacity.onupdate = (event) => this.observePolyphony({
        averageLoad: event?.averageLoad,
        peakLoad: event?.peakLoad,
        underrunRatio: event?.underrunRatio,
        activeVoices: this.lastSubmittedVoiceCount,
        requestedVoices: this.voiceDemand,
        source: "render-capacity",
      });
      capacity.start({ updateInterval: 0.5 });
      this.renderCapacity = capacity;
      this.renderCapacityActive = true;
    } catch {
      capacity.onupdate = null;
      this.renderCapacity = null;
      this.renderCapacityActive = false;
    }
  }

  stopRenderCapacityMonitoring() {
    if (this.renderCapacity) {
      try {
        this.renderCapacity.stop?.();
      } catch {
        // Closing an AudioContext may already have stopped measurement.
      }
      this.renderCapacity.onupdate = null;
    }
    this.renderCapacity = null;
    this.renderCapacityActive = false;
  }

  pollPlaybackStats() {
    if (!this.polyphonyController || !this.context) return;
    const now = Number(this.context.currentTime) || 0;
    if (now - this.lastPlaybackStatsAt < 1) return;
    this.lastPlaybackStatsAt = now;
    let stats = null;
    try {
      stats = this.context.playbackStats;
    } catch {
      return;
    }
    if (!stats) return;
    const events = Math.max(0, Number(stats.underrunEvents) || 0);
    const duration = Math.max(0, Number(stats.underrunDuration) || 0);
    const hadUnderrun = events > this.lastUnderrunEvents
      || duration > this.lastUnderrunDuration + 1e-6;
    this.lastUnderrunEvents = events;
    this.lastUnderrunDuration = duration;
    if (!hadUnderrun) return;
    this.observePolyphony({
      averageLoad: 1,
      peakLoad: 1,
      underrunRatio: 1,
      activeVoices: this.lastSubmittedVoiceCount,
      requestedVoices: this.voiceDemand,
      source: "playback-stats",
    });
  }

  async enable() {
    if (this.enabled) return;
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      throw new Error("Microphone input is not available in this browser.");
    }
    const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is not available in this browser.");

    if (!this.context || this.context.state === "closed") this.buildGraph(AudioContextConstructor);
    if (this.context.state !== "running") await this.context.resume();
    const stream = await mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    try {
      await this.buildProcessor();
      this.stream = stream;
      this.source = this.context.createMediaStreamSource(stream);
      this.source.connect(this.processor);
      this.enabled = true;
      this.startRenderCapacityMonitoring();
      this.master.gain.setTargetAtTime(levelToGain(this.level), this.context.currentTime, MASTER_TIME_CONSTANT);
      this.setFeedback(this.feedback);
      this.setVoices(this.pendingVoices, { requestedVoiceCount: this.voiceDemand });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
  }

  buildGraph(AudioContextConstructor) {
    this.context = new AudioContextConstructor();
    this.master = this.context.createGain();
    const compressor = this.context.createDynamicsCompressor();
    this.master.gain.value = 0;
    compressor.threshold.value = -6;
    compressor.knee.value = 8;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.14;
    this.master.connect(compressor).connect(this.context.destination);
  }

  async buildProcessor() {
    if (this.processor) return;
    const WorkletNode = globalThis.AudioWorkletNode;
    if (this.context.audioWorklet?.addModule && WorkletNode) {
      await this.context.audioWorklet.addModule(new URL("./mic-branch-processor.js", import.meta.url));
      this.processor = new WorkletNode(this.context, "morphazoid-mic-branches", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { maxVoices: this.maxVoices, historySeconds: 6 },
      });
      this.processor.port.onmessage = (event) => {
        const report = event?.data;
        if (report?.type !== "render-load" || !this.polyphonyController) return;
        if (report.supported === false) {
          if (!this.renderCapacityActive) this.useAdaptiveFallback("timing-unavailable");
          return;
        }
        if (this.renderCapacityActive) return;
        this.observePolyphony({
          averageLoad: report.averageLoad,
          peakLoad: report.peakLoad,
          underrunRatio: 0,
          activeVoices: report.renderedVoices ?? report.activeVoices,
          requestedVoices: report.requestedVoices ?? this.voiceDemand,
          source: report.timing === "high-res" ? "worklet" : "worklet-coarse",
          valid: report.supported !== false,
        });
      };
      this.processor.port.start?.();
      this.processor.onprocessorerror = () => {
        this.stopRenderCapacityMonitoring();
        this.useAdaptiveFallback("processor-error");
      };
      this.processor.connect(this.master);
      return;
    }
    if (!this.context.createScriptProcessor) {
      throw new Error("This microphone instrument requires AudioWorklet support.");
    }
    const renderer = new MicBranchDSP({
      sampleRate: this.context.sampleRate,
      historySeconds: 6,
      maxVoices: this.initialVoices,
    });
    const processor = this.context.createScriptProcessor(1024, 2, 2);
    processor.onaudioprocess = (event) => renderer.process(
      event.inputBuffer.getChannelData(0),
      event.inputBuffer.numberOfChannels > 1 ? event.inputBuffer.getChannelData(1) : null,
      event.outputBuffer.getChannelData(0),
      event.outputBuffer.getChannelData(1),
    );
    processor.port = {
      postMessage: (message) => {
        if (message?.type === "voices") renderer.setVoices(message.voices, message.voiceLimit);
        if (message?.type === "feedback") renderer.setFeedback(message.value);
      },
    };
    processor.connect(this.master);
    this.processor = processor;
    this.useAdaptiveFallback("script-processor-fallback");
  }

  setLevel(value) {
    this.level = clampMicValue(value, 0, 1, 0.55);
    if (this.master && this.context) this.master.gain.setTargetAtTime(
      this.enabled ? levelToGain(this.level) : 0,
      this.context.currentTime,
      MASTER_TIME_CONSTANT,
    );
  }

  setFeedback(value) {
    this.feedback = clampMicValue(value, 0, 0.82, 0.32);
    this.processor?.port.postMessage({ type: "feedback", value: this.feedback });
  }

  setVoices(voices, { requestedVoiceCount } = {}) {
    const source = Array.isArray(voices) ? voices : [];
    const demand = Math.max(
      source.length,
      Math.floor(Number(requestedVoiceCount) || 0),
    );
    const limit = this.setVoiceDemand(demand);
    this.pendingVoices = source
      .slice(0, limit)
      .map(sanitizeMicBranchVoice);
    this.lastSubmittedVoiceCount = this.pendingVoices.length;
    this.pollPlaybackStats();
    if (this.enabled) this.processor?.port.postMessage({
      type: "voices",
      voices: this.pendingVoices,
      requestedVoiceCount: demand,
      voiceLimit: limit,
    });
  }

  silence() {
    this.setVoices([], { requestedVoiceCount: 0 });
  }

  disable() {
    this.enabled = false;
    this.silence();
    this.stopRenderCapacityMonitoring();
    if (this.context && this.master) this.master.gain.setTargetAtTime(0, this.context.currentTime, MASTER_TIME_CONSTANT);
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  async close() {
    this.disable();
    this.processor?.disconnect();
    this.processor = null;
    this.master?.disconnect();
    await this.context?.close();
    this.context = null;
    this.master = null;
  }
}
