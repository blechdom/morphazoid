import { connectAudioOutput } from "../../audio-output-manager.js";
import { makeLayouts, outputModeFor, speakerPan } from "../surround-field/surround-field.js";

export function spartialLayout(id = "8-circle") {
  if (id === "4-ring" || id === "16-ring") return makeLayouts(Number(id.split("-")[0])).custom;
  const layouts = makeLayouts();
  const layout = layouts[id] ?? layouts["8-circle"];
  if (id !== "7-4-1") return layout;
  // SPARTIAL's interface patch places the side pair before the rear pair.
  const channels = { "left-side": 5, "right-side": 6, "left-rear": 7, "right-rear": 8 };
  return { ...layout, speakers: layout.speakers.map(speaker => ({
    ...speaker, channel: channels[speaker.id] ?? speaker.channel,
  })).sort((a, b) => a.channel - b.channel) };
}

export function spartialSpeakers(layout, omitLfe = true) {
  return layout.speakers.filter((speaker) => !omitLfe || speaker.kind !== "lfe")
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
    this.omitLfe = true;
    this.enabled = false;
    this.disposed = false;
    this.startPromise = null;
    this.routeTimer = null;
    this.grainFile = null;
    this.grainFileToken = 0;
    this.handleSinkChange = () => this.scheduleRouteChange();
  }

  async start(settings, layoutId, forcePreview, phase = 0, omitLfe = true) {
    if (this.startPromise) return this.startPromise;
    const start = async () => {
      this.layoutId = layoutId;
      this.forcePreview = forcePreview;
      this.omitLfe = omitLfe;
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
        this.sendGrainFile();
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

  // Decoding in an offline context never arms the physical output.
  async loadGrainFile(file) {
    const token = ++this.grainFileToken;
    if (!file || file.size > 20 * 1024 * 1024) throw new Error("Choose an audio file smaller than 20 MB.");
    const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
    if (!Offline) throw new Error("Audio file decoding is unavailable in this browser.");
    const decoder = new Offline(1, 1, 48000);
    let decoded;
    try { decoded = await decoder.decodeAudioData(await file.arrayBuffer()); }
    catch (error) {
      if (this.disposed || token !== this.grainFileToken) return null;
      throw error;
    }
    if (this.disposed || token !== this.grainFileToken) return null;
    const length = Math.min(decoded.length, Math.round(decoded.sampleRate * 20));
    if (length < 2) throw new Error("The audio file is empty.");
    const samples = new Float32Array(length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        if (Number.isFinite(data[index])) samples[index] += data[index] / decoded.numberOfChannels;
      }
    }
    for (let index = 0; index < length; index += 1) samples[index] = Math.max(-1, Math.min(1, samples[index]));
    this.grainFile = { samples, sampleRate: decoded.sampleRate, name: file.name, duration: length / decoded.sampleRate, trimmed: decoded.length > length };
    this.sendGrainFile();
    return this.grainFile;
  }
  sendGrainFile() {
    if (!this.node || !this.grainFile) return;
    const samples = this.grainFile.samples.slice();
    this.node.port.postMessage({ type: "grainFile", samples, sampleRate: this.grainFile.sampleRate }, [samples.buffer]);
  }
  clearGrainFile() {
    this.grainFileToken += 1;
    this.grainFile = null;
    this.node?.port.postMessage({ type: "clearGrainFile" });
  }

  rebuildRoutes() {
    if (!this.master || this.disposed) return;
    this.releaseOutput?.();
    this.master.disconnect();
    for (const node of this.routes) node.disconnect();
    this.routes = [];
    const layout = spartialLayout(this.layoutId);
    const speakers = spartialSpeakers(layout, this.omitLfe);
    const capacity = Math.max(1, this.context.destination.maxChannelCount || 2);
    let mode = outputModeFor(capacity, layout.speakers.length, this.forcePreview);
    try {
      this.context.destination.channelCount = mode === "discrete" ? layout.speakers.length : Math.min(2, capacity);
      this.context.destination.channelInterpretation = mode === "discrete" ? "discrete" : "speakers";
    } catch { mode = "preview"; }
    const splitter = this.context.createChannelSplitter(16);
    // Keep the complete azimuth mix available for stereo meters/recording
    // even when the physical destination uses discrete surround channels.
    const stereo = this.context.createGain();
    stereo.channelInterpretation = "speakers";
    stereo.channelCount = 2;
    stereo.channelCountMode = "explicit";
    // A constant sum bound covers equal-power crossfades folding into stereo.
    stereo.gain.value = 0.7;
    const output = mode === "discrete"
      ? this.context.createChannelMerger(layout.speakers.length) : stereo;
    output.channelInterpretation = mode === "discrete" ? "discrete" : "speakers";
    this.master.connect(splitter);
    this.routes.push(splitter, stereo);
    if (output !== stereo) this.routes.push(output);
    speakers.forEach((speaker, index) => {
      if (mode === "discrete") splitter.connect(output, index, speaker.channel - 1);
      const panner = this.context.createStereoPanner();
      panner.pan.value = speakerPan(speaker);
      splitter.connect(panner, index, 0);
      panner.connect(stereo);
      this.routes.push(panner);
    });
    this.releaseOutput = connectAudioOutput(this.context, output, { stereoSource: stereo });
    this.onRoute?.({ mode, capacity, layout, speakers, omitLfe: this.omitLfe });
  }

  route(layoutId, forcePreview, omitLfe = true) {
    const changed = layoutId !== this.layoutId || forcePreview !== this.forcePreview || omitLfe !== this.omitLfe;
    this.layoutId = layoutId;
    this.forcePreview = forcePreview;
    this.omitLfe = omitLfe;
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
    this.grainFileToken += 1; this.grainFile = null;
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
