import { connectAudioOutput } from "../audio-output-manager.js";
import { clamp } from "./common.js";

/** Only explicit Audio creates a context; mic/file actions use that context. */
export class StartingAudio {
  constructor(id, onState, onError) {
    this.id = id; this.onState = onState; this.onError = onError;
    this.context = null; this.node = null; this.armed = false; this.disposed = false;
    this.generation = 0; this.micGeneration = 0; this.fileGeneration = 0;
    this.release = null; this.stream = null; this.input = null;
    this.level = 0.48; this.monitor = false;
  }
  async arm(snapshotProvider) {
    if (this.disposed) return false;
    this.armed = true;
    const generation = ++this.generation;
    if (this.context && this.node) {
      try { await this.context.resume(); }
      catch (error) { if (generation === this.generation) this.armed = false; throw error; }
      if (generation !== this.generation || !this.armed) return false;
      this.setLevel(this.level);
      return true;
    }
    const Constructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Constructor) { this.armed = false; throw new Error("This browser does not support Web Audio."); }
    let context;
    try { context = new Constructor(); }
    catch (error) { this.armed = false; throw error; }
    this.context = context;
    try {
      await context.resume();
      await context.audioWorklet.addModule(new URL("./processor.js", import.meta.url));
      if (generation !== this.generation || !this.armed || this.disposed) {
        await context.close(); if (this.context === context) this.context = null; return false;
      }
      const node = new AudioWorkletNode(context, "morphazoid-starting-instrument", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { id: this.id },
      });
      this.node = node;
      node.port.onmessage = ({ data }) => {
        if (!this.disposed && this.node === node && data.type === "state") this.onState(data.state, data.at);
      };
      node.onprocessorerror = () => {
        if (this.node !== node) return;
        this.mute();
        this.onError(new Error("The audio processor stopped. Reload this page to restart it."));
      };
      this.release = connectAudioOutput(context, node);
      this.send({ type: "restore", snapshot: snapshotProvider() });
      this.setLevel(this.level);
      return true;
    } catch (error) {
      if (generation !== this.generation || this.disposed || this.context !== context) {
        try { await context.close(); } catch { /* stale start is already closed */ }
        return false;
      }
      this.armed = false;
      this.node?.disconnect(); this.node = null;
      this.release?.(); this.release = null;
      try { await context.close(); } catch { /* already closed */ }
      if (this.context === context) this.context = null;
      throw error;
    }
  }
  send(m) { if (!this.disposed) this.node?.port.postMessage(m); }
  setLevel(value) {
    this.level = clamp(value, 0, 0.72, 0.48);
    this.send({ type: "gain", value: this.armed ? this.level : 0 });
  }
  mute() {
    this.armed = false; this.generation++; this.fileGeneration++;
    this.send({ type: "finish-record" });
    this.send({ type: "gain", value: 0 });
    this.stopMic();
  }
  async startMic() {
    if (!this.armed || !this.node) throw new Error("Turn Audio on before enabling the microphone.");
    if (this.stream) return true;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access needs a supported browser and HTTPS or localhost.");
    const generation = ++this.micGeneration;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (error) {
      if (generation !== this.micGeneration || !this.armed || this.disposed) return false;
      throw error;
    }
    if (generation !== this.micGeneration || !this.armed || this.disposed) {
      stream.getTracks().forEach((t) => t.stop()); return false;
    }
    this.stream = stream;
    this.input = this.context.createMediaStreamSource(stream);
    this.input.connect(this.node);
    for (const track of stream.getTracks()) track.addEventListener("ended", () => {
      if (this.stream === stream) {
        this.send({ type: "finish-record" }); this.stopMic();
        this.onError(new Error("Microphone disconnected; any recording has stopped."));
      }
    }, { once: true });
    this.setMonitor(this.monitor);
    return true;
  }
  setMonitor(value) {
    this.monitor = Boolean(value);
    this.send({ type: "monitor", value: this.monitor && this.stream && this.armed ? 0.3 : 0 });
  }
  stopMic() {
    this.micGeneration++;
    this.send({ type: "monitor", value: 0 });
    this.input?.disconnect(); this.input = null;
    const stream = this.stream; this.stream = null;
    stream?.getTracks().forEach((t) => t.stop());
  }
  async loadFile(file, index) {
    if (!this.armed || !this.context || !this.node) throw new Error("Turn Audio on before loading audio.");
    if (!file || file.size > 40 * 1024 * 1024) throw new Error("Choose an audio file smaller than 40 MB.");
    const generation = ++this.fileGeneration;
    let buffer;
    try { buffer = await this.context.decodeAudioData(await file.arrayBuffer()); }
    catch (error) {
      if (this.disposed || !this.armed || generation !== this.fileGeneration) return false;
      throw error;
    }
    if (this.disposed || !this.armed || generation !== this.fileGeneration) return false;
    const count = Math.min(buffer.length, Math.floor(buffer.sampleRate * 12));
    if (count < buffer.sampleRate * 0.08) throw new Error("Choose at least 0.08 seconds of audio.");
    const mono = new Float32Array(count);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const samples = buffer.getChannelData(c);
      for (let i = 0; i < count; i++) mono[i] += samples[i] / buffer.numberOfChannels;
    }
    this.send({ type: "load", ...(typeof index === "string" ? { loopId: index } : { index }), samples: mono, name: file.name });
    return buffer.duration > 12 ? "Loaded the first 12 seconds." : "Recording loaded.";
  }
  async close() {
    if (this.disposed) return;
    this.mute(); this.send({ type: "dispose" }); this.disposed = true;
    this.node?.disconnect(); if (this.node) this.node.port.onmessage = null;
    this.release?.(); this.release = null;
    const context = this.context; this.context = null; this.node = null;
    try { await context?.close(); } catch { /* teardown is idempotent */ }
  }
}
