import { connectAudioOutput } from "../../audio-output-manager.js";
import { makeLayouts, outputModeFor, speakerPan } from "../surround-field/surround-field.js";

export function spartialLayout(id = "8-circle") {
  if (id === "4-ring" || id === "16-ring") return makeLayouts(Number(id.split("-")[0])).custom;
  return makeLayouts()[id] ?? makeLayouts()["8-circle"];
}

export function spartialSpeakers(layout) {
  return layout.speakers.filter((speaker) => speaker.kind !== "lfe")
    .sort((a, b) => ((a.azimuth + 360) % 360) - ((b.azimuth + 360) % 360) || a.z - b.z);
}

export class SpartialAudio {
  constructor(onSnapshot, onRoute, onError) {
    this.onSnapshot = onSnapshot;
    this.onRoute = onRoute;
    this.onError = onError;
    this.context = null;
    this.node = null;
    this.master = null;
    this.routes = [];
    this.releaseOutput = null;
    this.layoutId = "8-circle";
    this.forcePreview = false;
    this.enabled = false;
    this.disposed = false;
    this.startPromise = null;
    this.routeTimer = null;
    this.handleSinkChange = () => this.scheduleRouteChange();
  }

  async start(settings, layoutId, forcePreview, phase = 0) {
    if (this.startPromise) return this.startPromise;
    const start = async () => {
      this.layoutId = layoutId;
      this.forcePreview = forcePreview;
      if (!this.context) {
        const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Context) throw new Error("This browser does not support Web Audio.");
        this.context = new Context({ latencyHint: "interactive" });
        // Resume directly from the explicit Audio gesture, before loading code.
        const resume = this.context.resume();
        await this.context.audioWorklet.addModule(new URL("./spartial-processor.js", import.meta.url));
        if (this.disposed) return;
        this.node = new AudioWorkletNode(this.context, "spartial-synth", {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [16],
          channelInterpretation: "discrete", processorOptions: { settings, phase },
        });
        this.node.port.onmessage = ({ data }) => {
          if (data?.type === "snapshot") this.onSnapshot?.(data);
        };
        this.node.onprocessorerror = () => {
          this.disable();
          this.onError?.("The audio engine stopped. Reload SPARTIAL to restart it.");
        };
        this.master = this.context.createGain();
        this.master.channelCountMode = "max";
        this.master.channelInterpretation = "discrete";
        this.master.gain.value = 0;
        this.node.connect(this.master);
        this.context.addEventListener("sinkchange", this.handleSinkChange);
        this.rebuildRoutes();
        await resume;
      } else {
        await this.context.resume();
      }
      if (this.disposed || !this.master) return;
      this.enabled = true;
      this.master.gain.cancelAndHoldAtTime(this.context.currentTime);
      this.master.gain.setTargetAtTime(1, this.context.currentTime, 0.02);
      this.settings(settings);
    };
    this.startPromise = start();
    try { await this.startPromise; }
    catch (error) {
      // A failed first module load must remain retryable from the Audio button.
      if (!this.node) { await this.context?.close().catch(() => {}); this.context = null; }
      throw error;
    } finally { this.startPromise = null; }
  }

  rebuildRoutes() {
    if (!this.master || this.disposed) return;
    this.releaseOutput?.();
    this.master.disconnect();
    for (const node of this.routes) node.disconnect();
    this.routes = [];
    const layout = spartialLayout(this.layoutId);
    const speakers = spartialSpeakers(layout);
    const capacity = Math.max(1, this.context.destination.maxChannelCount || 2);
    let mode = outputModeFor(capacity, layout.speakers.length, this.forcePreview);
    try {
      this.context.destination.channelCount = mode === "discrete" ? layout.speakers.length : Math.min(2, capacity);
      this.context.destination.channelInterpretation = mode === "discrete" ? "discrete" : "speakers";
    } catch { mode = "preview"; }
    const splitter = this.context.createChannelSplitter(16);
    const output = mode === "discrete"
      ? this.context.createChannelMerger(layout.speakers.length) : this.context.createGain();
    output.channelInterpretation = mode === "discrete" ? "discrete" : "speakers";
    if (mode === "preview") {
      output.channelCount = 2;
      output.channelCountMode = "explicit";
      // A constant sum bound covers equal-power crossfades folding into stereo.
      output.gain.value = 0.7;
    }
    this.master.connect(splitter);
    this.routes.push(splitter, output);
    speakers.forEach((speaker, index) => {
      if (mode === "discrete") splitter.connect(output, index, speaker.channel - 1);
      else {
        const panner = this.context.createStereoPanner();
        panner.pan.value = speakerPan(speaker);
        splitter.connect(panner, index, 0);
        panner.connect(output);
        this.routes.push(panner);
      }
    });
    this.releaseOutput = connectAudioOutput(this.context, output);
    this.onRoute?.({ mode, capacity, layout, speakers });
  }

  route(layoutId, forcePreview) {
    const changed = layoutId !== this.layoutId || forcePreview !== this.forcePreview;
    this.layoutId = layoutId;
    this.forcePreview = forcePreview;
    if (changed) this.scheduleRouteChange();
  }
  scheduleRouteChange() {
    if (!this.master || this.disposed) return;
    clearTimeout(this.routeTimer);
    const now = this.context.currentTime;
    this.master.gain.cancelAndHoldAtTime(now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.025);
    this.routeTimer = setTimeout(() => {
      if (this.disposed) return;
      this.rebuildRoutes();
      const at = this.context.currentTime;
      this.master.gain.cancelScheduledValues(at);
      this.master.gain.setValueAtTime(0, at);
      this.master.gain.linearRampToValueAtTime(this.enabled ? 1 : 0, at + 0.025);
      this.routeTimer = null;
    }, 45);
  }
  settings(settings) { this.node?.port.postMessage({ type: "settings", settings }); }
  setPhase(phase) { this.node?.port.postMessage({ type: "phase", phase }); }
  noteOn(id, note, velocity = 0.8) { this.node?.port.postMessage({ type: "noteOn", id, note, velocity }); }
  retrigger(id, note, velocity = 0.8) { this.node?.port.postMessage({ type: "retrigger", id, note, velocity }); }
  noteOff(id) { this.node?.port.postMessage({ type: "noteOff", id }); }
  panic() { this.node?.port.postMessage({ type: "panic" }); }
  disable() {
    this.enabled = false;
    if (this.master) {
      const now = this.context.currentTime;
      this.master.gain.cancelAndHoldAtTime(now);
      this.master.gain.setTargetAtTime(0, now, 0.015);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.routeTimer);
    this.releaseOutput?.();
    this.node?.port.close();
    this.node?.disconnect();
    this.master?.disconnect();
    for (const node of this.routes) node.disconnect();
    this.context?.removeEventListener("sinkchange", this.handleSinkChange);
    void this.context?.close().catch(() => {});
  }
}
