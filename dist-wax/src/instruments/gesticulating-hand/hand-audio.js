import { unlockAudioContext } from "../../audio.js";
import { connectAudioOutput } from "../../audio-output-manager.js";
import { HAND_DEFAULTS, clampHand, handNumber, normalizeHandConfig } from "./hand-model.js";

const call = callback => { try { callback?.(); } catch {} };
/** Audio arm owns context creation; motion and finger gates never arm audio. */
export class HandAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime; this.context = null; this.node = null; this.master = null;
    this.armed = false; this.level = .52; this.config = normalizeHandConfig(HAND_DEFAULTS);
    this.soundPlaying = false; this.heldFingers = 0;
    this.playing = false; this.anchorTime = 0; this.anchorClock = this.clock();
    this.generation = 0; this.starting = null; this.startingToken = -1; this.buildPromise = null;
    this.releaseOutput = null; this.onStateChange = () => {}; this.onTelemetry = () => {};
    this.telemetry = { rms: 0, peak: 0, levels: [0, 0, 0, 0, 0], motionTime: 0, audioTime: 0 };
    this.stateListener = () => call(this.onStateChange);
  }
  get currentTime() { return this.context?.currentTime ?? 0; }
  get running() { return this.armed && this.context?.state === "running" && Boolean(this.node); }
  clock() { return this.context ? this.context.currentTime : handNumber(this.runtime.performance?.now?.(), Date.now()) / 1000; }
  getMotionTime() { return this.anchorTime + (this.playing ? Math.max(0, this.clock() - this.anchorClock) : 0); }
  getState() { return { ...this.telemetry, armed: this.armed, running: this.running, playing: this.playing,
    soundPlaying: this.soundPlaying, heldFingers: this.heldFingers, time: this.getMotionTime(), contextState: this.context?.state ?? "uninitialized" }; }
  post(data) { this.node?.port.postMessage(data); }
  initialize() { return this.arm(); }
  arm() {
    if (this.running) return Promise.resolve(true);
    if (this.starting && this.startingToken === this.generation) return this.starting;
    const token = ++this.generation;
    this.startingToken = token;
    const promise = this.start(token).finally(() => { if (this.starting === promise) this.starting = null; });
    this.starting = promise;
    return promise;
  }
  async build(context) {
    if (this.node) return true;
    if (this.buildPromise) return this.buildPromise;
    const promise = (async () => {
      if (!context.audioWorklet?.addModule || typeof this.runtime.AudioWorkletNode !== "function") throw new Error("Gesticules requires AudioWorklet support.");
      await context.audioWorklet.addModule(new URL("./hand-processor.js", import.meta.url));
      if (context !== this.context || context.state === "closed") return false;
      const node = new this.runtime.AudioWorkletNode(context, "gesticulating-hand", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
      });
      const master = context.createGain(); master.gain.value = 0;
      node.connect(master); this.node = node; this.master = master;
      this.releaseOutput = connectAudioOutput(context, master, { runtime: this.runtime });
      node.port.onmessage = ({ data }) => {
        if (this.node !== node || data?.type !== "telemetry") return;
        this.telemetry = { rms: clampHand(data.rms, 0, 1), peak: clampHand(data.peak, 0, 1),
          levels: Array.from({ length: 5 }, (_, i) => clampHand(data.levels?.[i], 0, 1)),
          motionTime: clampHand(data.motionTime, 0, 1e9), audioTime: clampHand(data.audioTime, 0, 1e9) };
        call(() => this.onTelemetry(this.telemetry));
      };
      node.onprocessorerror = () => {
        if (this.node !== node) return;
        this.mute(); this.detachNode(); call(this.onStateChange);
      };
      return true;
    })().finally(() => { if (this.buildPromise === promise) this.buildPromise = null; });
    this.buildPromise = promise;
    return promise;
  }
  async start(token) {
    const Constructor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    if (typeof Constructor !== "function") throw new Error("Web Audio is unavailable.");
    if (!this.context || this.context.state === "closed") {
      const time = this.getMotionTime();
      this.context = new Constructor({ latencyHint: "interactive" });
      this.anchorTime = time; this.anchorClock = this.context.currentTime;
      this.context.addEventListener?.("statechange", this.stateListener);
    }
    const context = this.context;
    // Resume synchronously within the explicit user's Audio gesture, before I/O.
    unlockAudioContext(context);
    try {
      const resumed = context.state === "running" ? Promise.resolve() : context.resume();
      const [, built] = await Promise.all([resumed, this.build(context)]);
      if (token !== this.generation || context !== this.context || !built) return false;
      if (context.state !== "running") throw new Error("Audio is suspended. Turn Audio on again.");
      this.post({ type: "config", config: this.config });
      this.post({ type: "transport", transport: { time: this.getMotionTime(), playing: this.playing }, audioTime: this.currentTime });
      this.post({ type: "sound", playing: this.soundPlaying });
      this.post({ type: "held", mask: this.heldFingers });
      this.post({ type: "enabled", enabled: true });
      this.armed = true; this.setOutput(this.level); call(this.onStateChange);
      return true;
    } catch (error) {
      if (token !== this.generation || context !== this.context) return false;
      await this.close();
      throw error;
    }
  }
  setConfig(config) { this.config = normalizeHandConfig(config); this.post({ type: "config", config: this.config }); }
  setTransport(value = {}) {
    this.anchorTime = clampHand(value?.time, 0, 1e9, this.getMotionTime()); this.anchorClock = this.clock();
    if (typeof value?.playing === "boolean") this.playing = value.playing;
    this.post({ type: "transport", transport: { time: this.anchorTime, playing: this.playing }, audioTime: this.currentTime });
  }
  setSoundPlaying(playing) { this.soundPlaying = playing === true; this.post({ type: "sound", playing: this.soundPlaying }); }
  setHeldFingers(mask) { this.heldFingers = Math.round(clampHand(mask, 0, 31)); this.post({ type: "held", mask: this.heldFingers }); }
  auditionFinger(index, seconds = .18) {
    if (!this.running || !Number.isInteger(index) || index < 0 || index >= 5) return false;
    this.post({ type: "audition", index, seconds: clampHand(seconds, .015, 2, .18), audioTime: this.currentTime });
    return true;
  }
  setOutput(value) {
    this.level = clampHand(value, 0, .85, .52);
    if (!this.master) return;
    const gain = this.master.gain, now = this.currentTime;
    if (typeof gain.cancelAndHoldAtTime === "function") gain.cancelAndHoldAtTime(now);
    else gain.cancelScheduledValues?.(now);
    gain.setTargetAtTime(this.armed ? this.level : 0, now, .015);
  }
  setLevel(value) { this.setOutput(value); }
  mute() {
    this.generation++; this.armed = false;
    this.post({ type: "enabled", enabled: false }); this.setOutput(this.level); call(this.onStateChange);
  }
  panic() {
    this.soundPlaying = false; this.heldFingers = 0; this.post({ type: "panic" });
  }
  detachNode() {
    if (this.node) {
      this.node.port.onmessage = null; this.node.onprocessorerror = null;
      this.node.disconnect(); this.node.port.close?.();
    }
    this.master?.disconnect(); this.releaseOutput?.(); this.releaseOutput = null;
    this.node = this.master = null;
  }
  async close() {
    this.generation++; this.armed = false;
    const time = this.getMotionTime(), context = this.context;
    this.post({ type: "dispose" }); this.detachNode();
    this.context = null; this.anchorTime = time; this.anchorClock = this.clock();
    this.starting = null; this.buildPromise = null;
    context?.removeEventListener?.("statechange", this.stateListener);
    if (context && context.state !== "closed") await context.close();
    call(this.onStateChange);
  }
}
