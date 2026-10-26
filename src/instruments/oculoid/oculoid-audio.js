import { unlockAudioContext } from "../../audio.js";
import { withAudioTimeout } from "../../audio-startup.js";
import { connectAudioOutput } from "../../audio-output-manager.js";
import { clampEye, normalizeOculoid, OCULOID_DEFAULTS, OCULOID_CRY_TEMPO_RANGE, OCULOID_SURFACE_DEFAULTS,
  OCULOID_SURFACE_RANGES, TEAR_CYCLE_BEATS, OCULOID_EYE_COUNTS,
  normalizeOculoidEnsemble, oculoidSonicWardrobe } from "./oculoid-model.js";

/** Audio owns its own lazy context and follows the same anchored beat as view. */
export class OculoidAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.node = null;
    this.master = null;
    this.releaseOutput = null;
    this.armed = false;
    this.starting = null;
    this.generation = 0;
    this.disposed = false;
    this.config = normalizeOculoid(OCULOID_DEFAULTS);
    this.level = 0.4;
    this.playing = false;
    this.anchorBeat = 0;
    this.anchorLidBeat = 0;
    this.anchorClock = this.clock();
    this.ensemble = { count: 1, style: "banter" };
    this.wardrobe = oculoidSonicWardrobe();
    this.lidsVisible = true;
    this.telemetry = { rms: 0, peak: 0 };
    this.flashlightExposure = 0;
    this.retracted = false;
    this.crying = false;
    this.cryBeat = 0;
    this.cryTempo = OCULOID_DEFAULTS.tempo;
    this.onState = () => {};
    this.onError = () => {};
  }

  clock() {
    return this.context && this.context.state !== "closed"
      ? this.context.currentTime
      : (this.runtime.performance?.now?.() ?? Date.now()) / 1000;
  }

  getBeat() {
    return this.anchorBeat + (this.playing
      ? Math.max(0, this.clock() - this.anchorClock) * this.config.tempo / 60 : 0);
  }

  getLidBeat() {
    return this.anchorLidBeat + (this.playing
      ? Math.max(0, this.clock() - this.anchorClock)
        * this.config.tempo * this.config.lidRate / 60 : 0);
  }

  get running() { return this.armed && this.context?.state === "running" && Boolean(this.node); }

  setConfig(value) {
    const beat = this.getBeat(), lidBeat = this.getLidBeat();
    this.config = { ...normalizeOculoid(value),
      midiHz: Number.isFinite(value?.midiHz) && value.midiHz > 0
        ? clampEye(value.midiHz, 25, 3000) : null };
    this.anchorBeat = beat;
    this.anchorLidBeat = lidBeat;
    this.anchorClock = this.clock();
    this.node?.port.postMessage({ type: "config", config: this.config });
    this.postTransport();
  }

  setPlaying(value) {
    const beat = this.getBeat(), lidBeat = this.getLidBeat();
    this.playing = value === true;
    this.anchorBeat = beat;
    this.anchorLidBeat = lidBeat;
    this.anchorClock = this.clock();
    this.postTransport();
  }

  seekBeat(value) {
    this.anchorBeat = clampEye(value, 0, 1e9, 0);
    this.anchorLidBeat = this.anchorBeat;
    this.anchorClock = this.clock();
    this.postTransport();
  }

  postTransport() {
    this.node?.port.postMessage({ type: "transport", playing: this.playing,
      beat: this.anchorBeat, lidBeat: this.anchorLidBeat, audioTime: this.anchorClock });
  }

  setEnsemble(count = 1, style = this.ensemble.style) {
    this.ensemble = {
      count: OCULOID_EYE_COUNTS.includes(Number(count)) ? Number(count) : 1,
      style: normalizeOculoidEnsemble(style),
    };
    this.node?.port.postMessage({ type: "ensemble", ...this.ensemble });
  }

  setWardrobe(value) {
    this.wardrobe = oculoidSonicWardrobe(value);
    this.node?.port.postMessage({ type: "wardrobe", wardrobe: this.wardrobe });
  }

  setLidsVisible(value) {
    this.lidsVisible = value === true;
    this.node?.port.postMessage({ type: "lids-visible", visible: this.lidsVisible });
  }

  excite(value) {
    if (this.armed && this.node) {
      this.node.port.postMessage({ type: "excite", amount: clampEye(value, 0, 1, 0.8) });
    }
  }

  poke({ pressure = 0, travel = 0, pan = 0, cancel = false,
    diameter = OCULOID_SURFACE_DEFAULTS.pokeDiameter } = {}) {
    if (this.armed && this.node) {
      this.node.port.postMessage({ type: "poke", pressure: clampEye(pressure, 0, 1, 0),
        travel: clampEye(travel, 0, 1, 0), pan: clampEye(pan, -0.84, 0.84, 0),
        diameter: clampEye(diameter, ...OCULOID_SURFACE_RANGES.pokeDiameter,
          OCULOID_SURFACE_DEFAULTS.pokeDiameter),
        cancel: cancel === true });
    }
  }

  surface({ kind, strength = 0, pan = 0, cancel = false,
    release = false } = {}) {
    if (this.armed && this.node) {
      this.node.port.postMessage({ type: "surface", kind,
        strength: clampEye(strength, 0, 1, 0), pan: clampEye(pan, -0.84, 0.84, 0),
        release: release === true, cancel: cancel === true });
    }
  }

  cry(active, beat = 0) {
    this.crying = active === true;
    this.cryBeat = clampEye(beat, 0, 1e9, 0) % TEAR_CYCLE_BEATS;
    this.node?.port.postMessage({ type: "cry", active: this.crying, beat: this.cryBeat });
  }

  setCryTempo(value) {
    this.cryTempo = clampEye(value, ...OCULOID_CRY_TEMPO_RANGE, OCULOID_DEFAULTS.tempo);
    this.node?.port.postMessage({ type: "cry-tempo", tempo: this.cryTempo });
  }

  tear(size = this.config.wetness) {
    if (this.armed && this.node) this.node.port.postMessage({
      type: "tear", size: clampEye(size, 0, 1, OCULOID_DEFAULTS.wetness),
    });
  }

  retractLids(value) {
    this.retracted = value === true;
    this.node?.port.postMessage({ type: "retractor", active: this.retracted });
  }

  flashlight(value) {
    const exposure = clampEye(value, 0, 1, 0);
    if (Math.abs(exposure - this.flashlightExposure) < 0.002) return;
    this.flashlightExposure = exposure;
    this.node?.port.postMessage({ type: "flashlight", exposure });
  }

  setOutput(value) {
    this.level = clampEye(value, 0, 0.8, 0.4);
    if (!this.master || !this.context) return;
    const param = this.master.gain, at = this.context.currentTime;
    param.cancelScheduledValues(at);
    param.setTargetAtTime(this.armed ? this.level : 0, at, 0.018);
  }

  arm() {
    if (this.disposed) return Promise.reject(new Error("This eye has been disposed."));
    if (this.running) return Promise.resolve(true);
    if (this.starting) return this.starting;
    const token = ++this.generation;
    const before = this.getBeat(), lidBefore = this.getLidBeat();
    const Ctor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    if (typeof Ctor !== "function") return Promise.reject(new Error("Web Audio is unavailable."));
    let context, resume;
    try {
      if (!this.context || this.context.state === "closed") {
        this.context = new Ctor({ latencyHint: "interactive" });
        this.context.addEventListener?.("statechange", this.onState);
      }
      context = this.context;
      this.anchorBeat = before;
      this.anchorLidBeat = lidBefore;
      this.anchorClock = this.clock();
      unlockAudioContext(context);
      // This call must happen inside the Audio button's gesture, before any await.
      resume = context.state === "running" ? Promise.resolve() : context.resume();
    } catch (error) {
      void this.close().catch(() => {});
      return Promise.reject(error);
    }
    const task = (async () => {
      try {
        if (!context.audioWorklet?.addModule || !this.runtime.AudioWorkletNode) {
          throw new Error("Oculoid needs AudioWorklet support.");
        }
        const build = this.node ? Promise.resolve() : context.audioWorklet.addModule(new URL("./oculoid-processor.js", import.meta.url));
        await withAudioTimeout(Promise.all([resume, build]));
        if (token !== this.generation || this.disposed || context !== this.context) return false;
        if (context.state !== "running") throw new Error("Audio is suspended; try Audio again.");
        if (!this.node) {
          const node = new this.runtime.AudioWorkletNode(context, "oculoid-voice", {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
          });
          const gain = context.createGain();
          gain.gain.value = 0;
          node.connect(gain);
          this.releaseOutput = connectAudioOutput(context, gain, { runtime: this.runtime });
          this.node = node;
          this.master = gain;
          node.port.onmessage = ({ data }) => {
            if (this.node !== node || data?.type !== "level") return;
            this.telemetry = { rms: clampEye(data.rms, 0, 1), peak: clampEye(data.peak, 0, 1) };
          };
          node.onprocessorerror = () => {
            if (this.node !== node) return;
            // A failed processor cannot be restarted by re-enabling its port.
            // Drop the graph and context so the next explicit Audio gesture
            // builds a fresh one instead of retaining a silent dead node.
            const closing = this.close();
            this.onError(new Error("Eye sound processor stopped. Turn Audio on to rebuild it."));
            void closing.catch(() => {});
          };
        }
        this.node.port.postMessage({ type: "config", config: this.config });
        this.postTransport();
        this.node.port.postMessage({ type: "ensemble", ...this.ensemble });
        this.node.port.postMessage({ type: "wardrobe", wardrobe: this.wardrobe });
        this.node.port.postMessage({ type: "lids-visible", visible: this.lidsVisible });
        this.node.port.postMessage({ type: "flashlight", exposure: this.flashlightExposure });
        this.node.port.postMessage({ type: "retractor", active: this.retracted });
        this.node.port.postMessage({ type: "cry-tempo", tempo: this.cryTempo });
        this.node.port.postMessage({ type: "cry", active: this.crying, beat: this.cryBeat });
        this.node.port.postMessage({ type: "enabled", enabled: true });
        this.armed = true;
        this.setOutput(this.level);
        this.onState();
        return true;
      } catch (error) {
        if (token !== this.generation || this.disposed) return false;
        await this.close().catch(() => {});
        throw error;
      }
    })();
    const promise = task.finally(() => { if (this.starting === promise) this.starting = null; });
    this.starting = promise;
    return promise;
  }

  mute() {
    this.generation++;
    this.armed = false;
    this.starting = null;
    try { this.node?.port.postMessage({ type: "enabled", enabled: false }); } catch {
      // A failed processor may already have closed its port.
    }
    this.setOutput(this.level);
    this.onState();
  }

  async close() {
    const beat = this.getBeat(), lidBeat = this.getLidBeat();
    this.mute();
    this.anchorBeat = beat;
    this.anchorLidBeat = lidBeat;
    const context = this.context;
    const node = this.node, master = this.master, release = this.releaseOutput;
    this.node = this.master = this.releaseOutput = this.context = null;
    this.telemetry = { rms: 0, peak: 0 };
    // Re-anchor on the fallback clock now, not after close(): an explicit
    // re-arm can happen before a previous context's close promise settles.
    this.anchorClock = this.clock();
    if (node) {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      try { node.port.postMessage({ type: "dispose" }); } catch { /* Dead processor. */ }
      try { node.disconnect(); } catch { /* Already disconnected. */ }
      node.port.close?.();
    }
    try { master?.disconnect(); } catch { /* Context may already be closed. */ }
    release?.();
    context?.removeEventListener?.("statechange", this.onState);
    if (context && context.state !== "closed") await context.close();
  }

  dispose() {
    this.disposed = true;
    return this.close();
  }
}
