import { connectAudioOutput } from "../../audio-output-manager.js";
import { resumeAudioContext, withAudioTimeout } from "../../audio-startup.js";
import { CORD_COUNT, clamp, cordEntry, createDefaultState, normalizeState, sanitizeSource } from "./time-loom-model.js";

/** The application owns microphone permission, capture and file decoding.
 * init() must be called from an explicit Audio or microphone action; it creates
 * a muted graph. Neither transport nor source/parameter edits create audio. */
export class TimeLoomAudio {
  constructor({ onState = () => {}, onError = () => {}, runtime = globalThis } = {}) {
    this.runtime = runtime; this.onState = onState; this.onError = onError;
    this.context = null; this.node = null; this.release = null;
    this.state = createDefaultState(); this.sources = Array(CORD_COUNT).fill(null);
    this.playing = false; this.armed = false; this.volume = 0.65;
    this.disposed = false; this.initializing = null; this.abort = null;
    this.snapshot = {
      ...this.state, position: cordEntry(this.state.cords[0]), phase: 0,
      playing: false, armed: false, transitions: 0, durations: [0, 0, 0], time: 0,
    };
  }

  get output() { return this.node; }

  async init() {
    if (this.disposed) return false;
    if (this.initializing) return this.initializing;
    const Constructor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    if (!Constructor) throw new Error("Time Loom needs a browser with Web Audio.");
    const context = this.context ?? new Constructor({ latencyHint: "interactive" });
    this.context = context;
    this.abort = new AbortController();
    // Resume before any asset loading: the explicit mobile user gesture is live.
    const resumed = resumeAudioContext(context, { signal: this.abort.signal });
    const initializing = this.initialize(context, resumed, this.abort.signal);
    this.initializing = initializing;
    try { return await initializing; }
    finally { if (this.initializing === initializing) this.initializing = null; }
  }

  async initialize(context, resumed, signal) {
    try {
      await resumed;
      if (this.disposed || signal.aborted) return false;
      if (!this.node) {
        if (!context.audioWorklet) throw new Error("Time Loom needs AudioWorklet. Open it using HTTPS or localhost.");
        await withAudioTimeout(context.audioWorklet.addModule(new URL("./time-loom-processor.js", import.meta.url)), { signal });
        if (this.disposed || signal.aborted) return false;
        const NodeConstructor = this.runtime.AudioWorkletNode;
        if (!NodeConstructor) throw new Error("This browser does not support AudioWorklet.");
        const node = new NodeConstructor(context, "morphazoid-time-loom", {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        });
        this.node = node;
        node.port.onmessage = ({ data }) => {
          if (this.disposed || this.node !== node || data?.type !== "state") return;
          this.snapshot = data.state;
          this.state.activeCord = data.state.activeCord;
          this.onState(this.getSnapshot());
        };
        node.onprocessorerror = () => {
          if (this.disposed || this.node !== node) return;
          this.setArmed(false);
          this.release?.(); this.release = null;
          node.port.onmessage = null; node.onprocessorerror = null;
          node.port.close?.(); node.disconnect(); this.node = null;
          this.onError(new Error("Audio stopped. Tap Audio to restart it."));
        };
        this.release = connectAudioOutput(context, node, { runtime: this.runtime });
        this.send({ type: "state", state: this.state });
        for (let index = 0; index < CORD_COUNT; index++) {
          if (this.sources[index]) this.send({ type: "source", index, ...this.sources[index] });
        }
        this.send({ type: "seek", index: this.snapshot.activeCord, position: this.snapshot.position });
        this.send({ type: "volume", value: this.volume });
        this.send({ type: "play", value: this.playing });
        this.send({ type: "arm", value: this.armed });
      }
      return true;
    } catch (error) {
      if (this.disposed || signal.aborted) return false;
      this.armed = false;
      this.release?.(); this.release = null;
      this.node?.disconnect(); this.node = null;
      if (this.context === context) this.context = null;
      try { await context.close(); } catch { /* Startup may already have closed it. */ }
      throw error;
    }
  }

  send(message) { if (!this.disposed) this.node?.port.postMessage(message); }

  setState(value) {
    this.state = normalizeState(value, this.state);
    const cord = this.state.cords[this.state.activeCord];
    const changed = this.snapshot.activeCord !== this.state.activeCord;
    this.snapshot = { ...this.snapshot, ...this.state,
      position: changed ? cordEntry(cord) : clamp(this.snapshot.position, cord.start, cord.end, cordEntry(cord)),
    };
    // Omit an implicit reader change. A stale UI snapshot must not reset a route.
    this.send({ type: "state", state: {
      cords: this.state.cords,
      ...(value?.activeCord !== undefined ? { activeCord: this.state.activeCord } : {}),
    } });
  }

  setSource(index, samples, sampleRate = 48000) {
    if (this.disposed || !Number.isInteger(index) || index < 0 || index >= CORD_COUNT) return false;
    this.sources[index] = sanitizeSource(samples, sampleRate);
    this.snapshot.durations[index] = this.sources[index].samples.length / this.sources[index].sampleRate;
    this.send({ type: "source", index, ...this.sources[index] });
    return true;
  }

  setPlaying(value) {
    this.playing = Boolean(value); this.snapshot.playing = this.playing;
    this.send({ type: "play", value: this.playing });
  }

  setArmed(value) {
    // Creating/resuming a graph is exclusively init()'s explicit-action job.
    this.armed = Boolean(value) && Boolean(this.node) && !this.disposed;
    this.snapshot.armed = this.armed;
    this.send({ type: "arm", value: this.armed });
    return this.armed;
  }

  seek(index, normalizedPosition) {
    if (!Number.isInteger(index) || index < 0 || index >= CORD_COUNT) return;
    const cord = this.state.cords[index];
    const position = clamp(normalizedPosition, cord.start, cord.end, cordEntry(cord));
    this.state.activeCord = index;
    this.snapshot = { ...this.snapshot, activeCord: index, position,
      phase: (position - cord.start) / (cord.end - cord.start) };
    this.send({ type: "seek", index, position });
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1, 0.65);
    this.send({ type: "volume", value: this.volume });
  }

  getSnapshot() {
    const cord = this.state.cords[this.snapshot.activeCord];
    const position = clamp(this.snapshot.position, cord.start, cord.end, cordEntry(cord));
    return { ...this.snapshot, cords: this.state.cords.map(cord => ({ ...cord })),
      position, phase: (position - cord.start) / (cord.end - cord.start),
      playing: this.playing, armed: this.armed,
      durations: this.sources.map(source => source ? source.samples.length / source.sampleRate : 0) };
  }

  async dispose() {
    if (this.disposed) return;
    this.setArmed(false); this.setPlaying(false); this.send({ type: "dispose" });
    this.disposed = true; this.abort?.abort();
    const node = this.node; this.node = null;
    if (node) { node.port.onmessage = null; node.onprocessorerror = null; node.port.close?.(); node.disconnect(); }
    this.release?.(); this.release = null;
    const context = this.context; this.context = null;
    this.sources.fill(null);
    try { await context?.close(); } catch { /* Teardown is idempotent. */ }
  }
}
