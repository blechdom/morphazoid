import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";
import { clamp } from "./yoyodyne.js";
export class YoyodyneAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime; this.context = null; this.node = null; this.master = null;
    this.armed = false; this.level = 0.4; this.generation = 0; this.starting = null;
    this.onStateChange = () => {};
    this.stateListener = () => this.onStateChange();
  }
  get currentTime() { return this.context?.currentTime ?? 0; }
  get running() { return this.armed && this.context?.state === "running"; }
  async arm() {
    if (this.starting) return this.starting;
    const token = ++this.generation;
    this.starting = this.start(token).finally(() => { this.starting = null; });
    return this.starting;
  }
  async start(token) {
    const Constructor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    if (!Constructor) throw new Error("Web Audio is unavailable.");
    if (!this.context || this.context.state === "closed") {
      this.context = new Constructor();
      this.context.addEventListener("statechange", this.stateListener);
    }
    const context = this.context;
    unlockAudioContext(context);
    const resumed = context.state === "running" ? Promise.resolve() : context.resume();
    try {
      await resumed;
      if (!this.node) {
        await context.audioWorklet.addModule(new URL("./yoyodyne-processor.js", import.meta.url));
        if (token !== this.generation || this.context !== context) return false;
        this.node = new this.runtime.AudioWorkletNode(context, "yoyodyne-string", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        this.master = context.createGain(); this.master.gain.value = 0;
        this.node.connect(this.master);
        this.releaseOutput = connectAudioOutput(context, this.master, { runtime: this.runtime });
      }
      if (token !== this.generation || this.context !== context) return false;
      this.armed = true; this.setLevel(this.level); return true;
    } catch (error) { await this.close(); throw error; }
  }
  setLevel(value) {
    this.level = clamp(value, 0, 0.8, 0.4);
    if (this.master) this.master.gain.setTargetAtTime(this.armed ? this.level : 0, this.currentTime, 0.02);
  }
  send(frames) { if (this.running && frames.length) this.node.port.postMessage({ type: "frames", frames }); }
  silence() { this.node?.port.postMessage({ type: "mute" }); }
  mute() { this.generation++; this.armed = false; this.setLevel(this.level); this.silence(); }
  async close() {
    this.generation++; this.armed = false;
    const context = this.context; this.context = null;
    context?.removeEventListener("statechange", this.stateListener);
    this.node?.port.postMessage({ type: "dispose" }); this.node?.disconnect(); this.node?.port.close();
    this.master?.disconnect(); this.releaseOutput?.(); this.releaseOutput = null;
    this.node = this.master = null;
    if (context && context.state !== "closed") await context.close();
  }
}
