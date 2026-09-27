import { MicBranchEngine } from "../../families/mic-branch/mic-branch-engine.js";
import { unlockAudioContext } from "../../audio.js";
import { audioInputConstraints, configureAudioInputNode, loadAudioInputSettings } from "../../audio-input-settings.js";
import { GranularEconomyRenderer } from "../../families/signalsmith-generation/granular-economy-renderer.js";

const cancelled = () => new DOMException("Microphone start cancelled", "AbortError");

/** One permission, stream and context for the original reader and Delay's
 * generation renderer. Geometry/preset edits switch taps, never the device or
 * raw history. Both processors continue collecting history while connected. */
export class LSystemsMicDelayAudio extends MicBranchEngine {
  constructor(initialVoices = 128, options = {}) {
    super(initialVoices, options);
    this.geometryModel = "rewrite";
    this.dry = 0;
    this.revision = 0;
    this.startPromise = null;
  }

  get voiceLimit() { return this.geometryModel === "generations" ? 128 : super.voiceLimit; }
  get polyphonyStatus() {
    return this.geometryModel === "generations"
      ? { limit: 128, status: "fixed", demand: this.voiceDemand }
      : super.polyphonyStatus;
  }
  setVoiceDemand(value) {
    if (this.geometryModel !== "generations") return super.setVoiceDemand(value);
    this.voiceDemand = Math.max(0, Number(value) || 0);
    return 128;
  }
  setGeometryModel(model) {
    if (model === this.geometryModel) return;
    this.silence();
    this.geometryModel = model;
  }
  setDry(value) {
    this.dry = Math.max(0, Math.min(.5, Number(value) || 0));
    this.dryGain?.gain.setTargetAtTime(this.enabled ? this.dry : 0, this.context.currentTime, .03);
  }
  setVoices(voices, options = {}) {
    if (this.geometryModel !== "generations") return super.setVoices(voices, options);
    this.pendingVoices = voices.slice(0, 128);
    this.setVoiceDemand(options.requestedVoiceCount ?? voices.length);
    this.lastSubmittedVoiceCount = this.pendingVoices.length;
    if (this.enabled) this.renderer?.setVoices(this.pendingVoices, { voiceLimit: 128, requestedVoiceCount: this.voiceDemand });
  }
  silence() {
    super.silence();
    // Clear both renderers on an explicit transport/route stop.
    this.processor?.port.postMessage({ type: "voices", voices: [], voiceLimit: super.voiceLimit });
    this.renderer?.silence(128);
    this.dryGain?.gain.setTargetAtTime(0, this.context.currentTime, .03);
  }
  enable() {
    if (this.enabled) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    const revision = ++this.revision;
    const pending = this.start(revision).finally(() => {
      if (this.startPromise === pending) this.startPromise = null;
    });
    this.startPromise = pending;
    return pending;
  }
  async start(revision) {
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    const media = globalThis.navigator?.mediaDevices;
    if (!Audio || !media?.getUserMedia) throw new Error("Microphone input is unavailable.");
    if (!this.context || this.context.state === "closed") this.buildGraph(Audio);
    const context = this.context;
    const check = () => { if (revision !== this.revision || context !== this.context) throw cancelled(); };
    unlockAudioContext(context);
    await context.resume();
    check();
    let stream;
    try {
      stream = await media.getUserMedia(audioInputConstraints(globalThis));
      check();
      await this.buildProcessor();
      check();
      this.stream = stream;
      this.source = configureAudioInputNode(context.createMediaStreamSource(stream), globalThis);
      this.source.connect(this.processor);
      this.source.connect(this.generationProcessor);
      this.source.connect(this.dryGain);
      this.enabled = true;
      this.startRenderCapacityMonitoring();
      this.setLevel(this.level);
      this.setFeedback(this.feedback);
      this.setVoices(this.pendingVoices, { requestedVoiceCount: this.voiceDemand });
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      throw error;
    }
  }
  buildProcessor() {
    if (this.generationProcessor && this.processor && !this.processorStart) return Promise.resolve();
    if (this.processorStart) return this.processorStart;
    const pending = this.buildProcessors().finally(() => {
      if (this.processorStart === pending) this.processorStart = null;
    });
    this.processorStart = pending;
    return pending;
  }
  async buildProcessors() {
    // Load generation worklet first: never leave a reader-only half-start on a
    // browser that cannot support the imported delay scenes.
    if (!this.context.audioWorklet?.addModule || !globalThis.AudioWorkletNode) {
      throw new Error("L-Systems Mic needs AudioWorklet support.");
    }
    const context = this.context;
    await context.audioWorklet.addModule(new URL("../../families/mic-branch/micmic-generation-processor.js?v=20260725-presets", import.meta.url));
    if (context !== this.context) throw cancelled();
    await super.buildProcessor();
    if (context !== this.context) throw cancelled();
    if (this.generationProcessor) return;
    const node = new AudioWorkletNode(context, "morphazoid-micmic-generations", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { historySeconds: 40, maxVoices: 128, renderer: "granular-economy", channels: loadAudioInputSettings(globalThis).inputChannels },
    });
    this.generationProcessor = node;
    this.renderer = new GranularEconomyRenderer(node, { maxVoices: 128 });
    this.dryGain = context.createGain();
    this.dryGain.gain.value = 0;
    this.dryGain.connect(this.master);
    node.connect(this.master);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Microphone delay did not become ready.")), 8000);
      const fail = () => {
        clearTimeout(timer);
        const error = new Error("Microphone delay processor failed.");
        if (this.generationProcessor === node) {
          this.disable();
          node.disconnect(); node.port.close();
          this.generationProcessor = null; this.renderer = null;
          this.dryGain?.disconnect(); this.dryGain = null;
          this.onError?.(error);
        }
        reject(error);
      };
      node.onprocessorerror = fail;
      node.port.onmessage = ({ data }) => {
        if (data?.type === "renderer-ready") { clearTimeout(timer); resolve(); }
      };
      node.port.start?.();
    }).catch(error => {
      node.disconnect(); node.port.close();
      if (this.generationProcessor === node) {
        this.generationProcessor = null; this.renderer = null;
        this.dryGain.disconnect(); this.dryGain = null;
      }
      throw error;
    });
  }
  disable() {
    this.revision += 1;
    // A new explicit start need not wait for an obsolete permission prompt.
    this.startPromise = null;
    super.disable();
  }
  async close() {
    this.disable();
    this.generationProcessor?.disconnect();
    this.generationProcessor?.port.close();
    this.generationProcessor = null;
    this.renderer = null;
    this.dryGain?.disconnect();
    this.dryGain = null;
    await super.close();
  }
}
