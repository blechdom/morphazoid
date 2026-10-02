import { connectAudioOutput } from "../../audio-output-manager.js";
import { clamp } from "./loopini.js";

/** Audio arm and microphone permission are separate, explicit user actions. */
export class LoopiniAudio {
  constructor(onState, onError) {
    this.onState = onState; this.onError = onError;
    this.context = this.node = this.stream = this.input = this.release = null;
    this.armed = this.disposed = false; this.level = 0.48;
    this.generation = this.micGeneration = 0;
    this.inputGain = 1; this.inputTrim = null;
  }
  async arm({ output = true } = {}) {
    const attempt = ++this.generation;
    if (this.disposed) return false;
    const Constructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Constructor) throw new Error("This browser cannot play Loopini. Please try a newer browser.");
    // Creating/resuming here preserves the explicit Audio gesture on mobile.
    const context = this.context ?? new Constructor();
    this.context = context;
    try {
      await context.resume();
      if (attempt !== this.generation || this.disposed) return false;
      if (!this.node) {
        if (!context.audioWorklet) throw new Error("Loopini needs HTTPS or localhost and a browser with AudioWorklet.");
        await context.audioWorklet.addModule(new URL("./loopini-processor.js", import.meta.url));
        if (attempt !== this.generation || this.disposed) return false;
        const node = new AudioWorkletNode(context, "morphazoid-loopini", {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
          channelCount: 1, channelCountMode: "explicit",
        });
        this.node = node;
        node.port.onmessage = ({ data }) => {
          if (this.disposed || this.node !== node) return;
          if (data.type === "state") this.onState(data.state);
        };
        node.onprocessorerror = () => {
          if (this.node !== node) return;
          this.mute(); this.release?.(); this.release = null;
          this.onError(new Error("The sound engine stopped. Reload Loopini to restart it; this will clear the loops."));
        };
      }
      this.release ??= connectAudioOutput(context, this.node);
      this.armed = output; this.setLevel(this.level); return true;
    } catch (error) {
      if (attempt !== this.generation || this.disposed) return false;
      this.armed = false;
      if (!this.node) { this.context = null; try { await context.close(); } catch { /* failed startup */ } }
      throw error;
    }
  }
  send(message) { if (!this.disposed) this.node?.port.postMessage(message); }
  setLevel(value) { this.level = clamp(value, 0, 0.8, 0.48); this.send({ type: "gain", value: this.armed ? this.level : 0 }); }
  mute() {
    this.generation++; this.armed = false; this.send({ type: "cancel" });
    this.setLevel(this.level); this.stopMic();
  }
  setInputGain(value) {
    this.inputGain = clamp(value, 0, 4, 1);
    if (this.inputTrim) this.inputTrim.gain.setTargetAtTime(this.inputGain, this.context.currentTime, 0.015);
  }
  async startMic() {
    if (this.stream) return true;
    this.stopMic(); const attempt = ++this.micGeneration;
    if (!this.node && !await this.arm({ output: false })) return false;
    await this.context.resume();
    if (attempt !== this.micGeneration || this.disposed) return false;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("The microphone needs HTTPS or localhost. You can still try the demo.");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
    } catch (error) {
      if (attempt !== this.micGeneration || this.disposed) return false;
      throw error;
    }
    if (attempt !== this.micGeneration || this.disposed) {
      stream.getTracks().forEach((t) => t.stop()); return false;
    }
    try {
      const input = this.context.createMediaStreamSource(stream);
      this.inputTrim = this.context.createGain(); this.inputTrim.gain.value = this.inputGain;
      input.connect(this.inputTrim).connect(this.node); this.stream = stream; this.input = input;
      for (const track of stream.getTracks()) track.addEventListener("ended", () => {
        if (this.stream !== stream) return;
        this.send({ type: "cancel" }); this.stopMic();
        this.onError(new Error("The microphone disconnected. Your other loops are still here. Tap a circle to try again."));
      }, { once: true });
      return true;
    } catch (error) { stream.getTracks().forEach((t) => t.stop()); throw error; }
  }
  stopMic() {
    this.micGeneration++; this.input?.disconnect(); this.input = null;
    this.inputTrim?.disconnect(); this.inputTrim = null;
    const stream = this.stream; this.stream = null;
    stream?.getTracks().forEach((t) => t.stop());
  }
  async suspend() {
    this.mute(); this.send({ type: "play", value: false });
    this.release?.(); this.release = null;
    // Retain recorded buffers through tab hiding; a later explicit Audio arm resumes.
    try { if (this.context?.state === "running") await this.context.suspend(); } catch { /* page teardown */ }
  }
  async close() {
    if (this.disposed) return;
    this.mute(); this.send({ type: "dispose" }); this.disposed = true;
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    this.release?.(); this.release = null;
    const context = this.context; this.context = this.node = null;
    try { await context?.close(); } catch { /* already closed */ }
  }
}
