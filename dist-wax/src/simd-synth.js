import { connectAudioOutput } from "./audio-output-manager.js";

export const SIMD_SYNTH_BLOCK_SIZE = 128;
export const SIMD_SYNTH_VOICE_COUNT = 8;
export const SIMD_SYNTH_SEQUENCE_LENGTH = 16;
export const SIMD_SYNTH_MOD_ROUTE_COUNT = 4;

const freeze = Object.freeze;

export const SIMD_SYNTH_SOURCE_MODELS = freeze([
  freeze({ id: 0, key: "vector", label: "Vector table", hint: "sine → triangle → saw" }),
  freeze({ id: 1, key: "fm", label: "Cascade FM", hint: "four-operator phase color" }),
  freeze({ id: 2, key: "fold", label: "Wavefold stack", hint: "folded table layers" }),
  freeze({ id: 3, key: "modal", label: "Modal metal", hint: "inharmonic resonator bank" }),
  freeze({ id: 4, key: "particle", label: "Particle cloud", hint: "pitched dust and noise" }),
  freeze({ id: 5, key: "organ", label: "Additive organ", hint: "nine moving drawbars" }),
  freeze({ id: 6, key: "formant", label: "Formant bank", hint: "vowel-weighted harmonics" }),
  freeze({ id: 7, key: "bytebeat", label: "Vector bytebeat", hint: "SIMD integer rhythm code" }),
]);

export const SIMD_SYNTH_COMBINERS = freeze([
  freeze({ id: 0, label: "Morph", hint: "equal-power A/B blend" }),
  freeze({ id: 1, label: "Stack", hint: "add both sources" }),
  freeze({ id: 2, label: "Ring", hint: "multiply A × B" }),
  freeze({ id: 3, label: "AM", hint: "B shapes A level" }),
  freeze({ id: 4, label: "Phase/FM", hint: "B bends A phase" }),
  freeze({ id: 5, label: "Difference", hint: "A minus B" }),
]);

export const SIMD_SYNTH_SHAPERS = freeze([
  freeze({ id: 0, label: "Clean" }),
  freeze({ id: 1, label: "Soft drive" }),
  freeze({ id: 2, label: "Wavefold" }),
  freeze({ id: 3, label: "Chebyshev" }),
  freeze({ id: 4, label: "Rectify" }),
  freeze({ id: 5, label: "Bit crush" }),
]);

export const SIMD_SYNTH_FILTERS = freeze([
  freeze({ id: 0, label: "Bypass" }),
  freeze({ id: 1, label: "Low-pass" }),
  freeze({ id: 2, label: "Band-pass" }),
  freeze({ id: 3, label: "High-pass" }),
  freeze({ id: 4, label: "Notch" }),
]);

export const SIMD_SYNTH_FILTER_ROUTES = freeze([
  freeze({ id: 0, label: "Serial 1 → 2" }),
  freeze({ id: 1, label: "Serial 2 → 1" }),
  freeze({ id: 2, label: "Parallel" }),
  freeze({ id: 3, label: "Voice split" }),
  freeze({ id: 4, label: "Ring filters" }),
  freeze({ id: 5, label: "Feedback" }),
]);

export const SIMD_SYNTH_FX = freeze([
  freeze({ id: 0, label: "Bypass" }),
  freeze({ id: 1, label: "Chorus" }),
  freeze({ id: 2, label: "Flanger" }),
  freeze({ id: 3, label: "Ping-pong" }),
  freeze({ id: 4, label: "Slippery comb" }),
  freeze({ id: 5, label: "Diffusion" }),
]);

export const SIMD_SYNTH_SCALES = freeze([
  freeze({ id: 0, label: "Chromatic", intervals: freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) }),
  freeze({ id: 1, label: "Dorian", intervals: freeze([0, 2, 3, 5, 7, 9, 10]) }),
  freeze({ id: 2, label: "Phrygian", intervals: freeze([0, 1, 3, 5, 7, 8, 10]) }),
  freeze({ id: 3, label: "Harmonic minor", intervals: freeze([0, 2, 3, 5, 7, 8, 11]) }),
  freeze({ id: 4, label: "Whole tone", intervals: freeze([0, 2, 4, 6, 8, 10]) }),
  freeze({ id: 5, label: "Pentatonic", intervals: freeze([0, 3, 5, 7, 10]) }),
]);

export const SIMD_SYNTH_MOD_SOURCES = freeze([
  freeze({ id: 0, label: "Off" }),
  freeze({ id: 1, label: "LFO 1" }),
  freeze({ id: 2, label: "LFO 2" }),
  freeze({ id: 3, label: "Amp envelope" }),
  freeze({ id: 4, label: "Sequence" }),
  freeze({ id: 5, label: "Sample + hold" }),
  freeze({ id: 6, label: "Velocity" }),
  freeze({ id: 7, label: "Key track" }),
  freeze({ id: 8, label: "X gesture" }),
  freeze({ id: 9, label: "Y gesture" }),
]);

export const SIMD_SYNTH_MOD_DESTINATIONS = freeze([
  freeze({ id: 0, label: "Source A pitch" }),
  freeze({ id: 1, label: "Source B pitch" }),
  freeze({ id: 2, label: "Source A color" }),
  freeze({ id: 3, label: "Source B color" }),
  freeze({ id: 4, label: "Source A motion" }),
  freeze({ id: 5, label: "Source B motion" }),
  freeze({ id: 6, label: "Combine mix" }),
  freeze({ id: 7, label: "Shaper amount" }),
  freeze({ id: 8, label: "Filter 1 cutoff" }),
  freeze({ id: 9, label: "Filter 2 cutoff" }),
  freeze({ id: 10, label: "Filter 1 resonance" }),
  freeze({ id: 11, label: "Filter 2 resonance" }),
  freeze({ id: 12, label: "Stereo width" }),
  freeze({ id: 13, label: "FX 1 amount" }),
  freeze({ id: 14, label: "FX 2 amount" }),
]);

export const SIMD_SYNTH_PARAM_ORDER = freeze([
  "sourceA", "sourceB", "tuneA", "tuneB", "colorA", "colorB", "motionA", "motionB",
  "detailA", "detailB", "combine", "combineMix", "combineDrive", "shaper", "shaperAmount",
  "toneOrder", "filter1", "cutoff1", "resonance1", "filter2", "cutoff2", "resonance2",
  "filterRoute", "filterBlend", "attack", "decay", "sustain", "release", "glide", "stereo",
  "drift", "lfo1Rate", "lfo2Rate", "fx1", "fx1Amount", "fx1Time", "fx1Feedback", "fx2",
  "fx2Amount", "fx2Time", "fx2Feedback", "fxOrder", "bpm", "swing", "steps", "gateLength",
  "rootNote", "scale", "xyX", "xyY", "seed",
]);

export const SIMD_SYNTH_DEFAULTS = freeze({
  sourceA: 0, sourceB: 1, tuneA: 0, tuneB: 12, colorA: 0.56, colorB: 0.42,
  motionA: 0.28, motionB: 0.34, detailA: 18, detailB: 4,
  combine: 0, combineMix: 0.36, combineDrive: 1.25,
  shaper: 1, shaperAmount: 0.18, toneOrder: 0,
  filter1: 1, cutoff1: 7200, resonance1: 0.28,
  filter2: 2, cutoff2: 2200, resonance2: 0.42,
  filterRoute: 0, filterBlend: 0.45,
  attack: 0.008, decay: 0.32, sustain: 0.72, release: 0.46, glide: 0.08,
  stereo: 0.62, drift: 0.08, lfo1Rate: 0.17, lfo2Rate: 0.43,
  fx1: 1, fx1Amount: 0.22, fx1Time: 0.018, fx1Feedback: 0.16,
  fx2: 3, fx2Amount: 0.2, fx2Time: 0.28, fx2Feedback: 0.34,
  fxOrder: 0, bpm: 112, swing: 0.08, steps: 16, gateLength: 0.72,
  rootNote: 43, scale: 1, xyX: 0.36, xyY: 0.64, seed: 17011,
});

export const SIMD_SYNTH_LIMITS = freeze({
  sourceA: freeze([0, 7]), sourceB: freeze([0, 7]), tuneA: freeze([-24, 24]), tuneB: freeze([-24, 24]),
  colorA: freeze([0, 1]), colorB: freeze([0, 1]), motionA: freeze([0, 1]), motionB: freeze([0, 1]),
  detailA: freeze([1, 24]), detailB: freeze([1, 24]), combine: freeze([0, 5]), combineMix: freeze([0, 1]),
  combineDrive: freeze([0.25, 6]), shaper: freeze([0, 5]), shaperAmount: freeze([0, 1]),
  toneOrder: freeze([0, 1]), filter1: freeze([0, 4]), cutoff1: freeze([45, 18_000]),
  resonance1: freeze([0, 1]), filter2: freeze([0, 4]), cutoff2: freeze([45, 18_000]),
  resonance2: freeze([0, 1]), filterRoute: freeze([0, 5]), filterBlend: freeze([0, 1]),
  attack: freeze([0.002, 2]), decay: freeze([0.02, 4]), sustain: freeze([0, 1]), release: freeze([0.02, 8]),
  glide: freeze([0, 0.95]), stereo: freeze([0, 1]), drift: freeze([0, 1]),
  lfo1Rate: freeze([0.02, 24]), lfo2Rate: freeze([0.02, 24]),
  fx1: freeze([0, 5]), fx1Amount: freeze([0, 1]), fx1Time: freeze([0.002, 0.68]), fx1Feedback: freeze([0, 0.84]),
  fx2: freeze([0, 5]), fx2Amount: freeze([0, 1]), fx2Time: freeze([0.002, 0.68]), fx2Feedback: freeze([0, 0.84]),
  fxOrder: freeze([0, 1]), bpm: freeze([30, 240]), swing: freeze([0, 0.42]), steps: freeze([4, 16]),
  gateLength: freeze([0.05, 1]), rootNote: freeze([24, 84]), scale: freeze([0, 5]), xyX: freeze([0, 1]),
  xyY: freeze([0, 1]), seed: freeze([1, 65_535]),
});

const INTEGER_PARAMS = new Set([
  "sourceA", "sourceB", "detailA", "detailB", "combine", "shaper", "toneOrder", "filter1",
  "filter2", "filterRoute", "fx1", "fx2", "fxOrder", "steps", "rootNote", "scale", "seed",
]);

const WASM_TIME_LIMIT = 1e6;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const finiteWasmTime = (value, fallback = 0) => Math.fround(clamp(finite(value, fallback), 0, WASM_TIME_LIMIT));

export function sanitizeSimdSynthParams(value = {}) {
  return Object.fromEntries(SIMD_SYNTH_PARAM_ORDER.map((key) => {
    const [minimum, maximum] = SIMD_SYNTH_LIMITS[key];
    const bounded = clamp(finite(value?.[key], SIMD_SYNTH_DEFAULTS[key]), minimum, maximum);
    return [key, INTEGER_PARAMS.has(key) ? Math.round(bounded) : bounded];
  }));
}

export function simdSynthParamArray(value = {}) {
  const params = sanitizeSimdSynthParams(value);
  return new Float32Array(SIMD_SYNTH_PARAM_ORDER.map((key) => params[key]));
}

export const SIMD_SYNTH_DEFAULT_SEQUENCE = freeze([
  [0, 1, 0.82, 0], [2, 1, 0.62, 0], [4, 0, 0.4, 0], [6, 1, 0.7, 0.16],
  [7, 1, 0.88, 0], [4, 1, 0.58, 0], [9, 0, 0.45, 0], [6, 1, 0.68, 0.34],
  [0, 1, 0.94, 0], [7, 0, 0.5, 0], [11, 1, 0.64, 0], [9, 1, 0.76, 0.2],
  [6, 1, 0.84, 0], [4, 0, 0.48, 0], [2, 1, 0.62, 0], [1, 1, 0.72, 0.48],
].map((step) => freeze(step)));

export const SIMD_SYNTH_DEFAULT_MOD_ROUTES = freeze([
  freeze([1, 2, 0.26, 0]),
  freeze([2, 8, 0.2, 0]),
  freeze([8, 6, 0.72, 0]),
  freeze([9, 8, 0.88, 0]),
]);

export function sanitizeSimdSynthSequence(value = SIMD_SYNTH_DEFAULT_SEQUENCE) {
  return Array.from({ length: SIMD_SYNTH_SEQUENCE_LENGTH }, (_, index) => {
    const step = value?.[index] ?? SIMD_SYNTH_DEFAULT_SEQUENCE[index];
    return [
      Math.round(clamp(finite(step?.[0], 0), -12, 24)),
      clamp(finite(step?.[1], 0), 0, 1) >= 0.5 ? 1 : 0,
      clamp(finite(step?.[2], 0.72), 0.05, 1),
      clamp(finite(step?.[3], 0), 0, 1),
    ];
  });
}

export function sanitizeSimdSynthModRoutes(value = SIMD_SYNTH_DEFAULT_MOD_ROUTES) {
  return Array.from({ length: SIMD_SYNTH_MOD_ROUTE_COUNT }, (_, index) => {
    const route = value?.[index] ?? SIMD_SYNTH_DEFAULT_MOD_ROUTES[index];
    return [
      Math.round(clamp(finite(route?.[0], 0), 0, SIMD_SYNTH_MOD_SOURCES.length - 1)),
      Math.round(clamp(finite(route?.[1], 0), 0, SIMD_SYNTH_MOD_DESTINATIONS.length - 1)),
      clamp(finite(route?.[2], 0), -1, 1),
      clamp(finite(route?.[3], 0), -1, 1),
    ];
  });
}

export function createSimdSynthSequence(seed = 17011, density = 0.68) {
  let state = Math.max(1, Math.round(finite(seed, 17011))) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0xffff_ffff;
  };
  const notes = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19];
  return Array.from({ length: SIMD_SYNTH_SEQUENCE_LENGTH }, (_, index) => [
    notes[Math.floor(random() * notes.length)],
    index % 4 === 0 || random() < clamp(density, 0.08, 1) ? 1 : 0,
    clamp(0.45 + random() * 0.55 + (index % 4 === 0 ? 0.12 : 0), 0.05, 1),
    random() < 0.22 ? 0.15 + random() * 0.75 : 0,
  ]);
}

export function createSimdSynthConfiguration(patch = {}) {
  const params = sanitizeSimdSynthParams(patch.params ?? patch);
  const sequence = sanitizeSimdSynthSequence(patch.sequence);
  const modRoutes = sanitizeSimdSynthModRoutes(patch.modRoutes);
  return freeze({
    params,
    sequence,
    modRoutes,
    paramArray: simdSynthParamArray(params),
    sequenceArray: new Float32Array(sequence.flat()),
    modRouteArray: new Float32Array(modRoutes.flat()),
  });
}

const ARRAY_EXPORTS = freeze({
  outputLeft: ["output_left_ptr", SIMD_SYNTH_BLOCK_SIZE],
  outputRight: ["output_right_ptr", SIMD_SYNTH_BLOCK_SIZE],
  params: ["params_ptr", SIMD_SYNTH_PARAM_ORDER.length],
  sequence: ["sequence_ptr", SIMD_SYNTH_SEQUENCE_LENGTH * 4],
  modRoutes: ["mod_routes_ptr", SIMD_SYNTH_MOD_ROUTE_COUNT * 4],
  voiceNote: ["voice_note_ptr", SIMD_SYNTH_VOICE_COUNT],
  voiceGate: ["voice_gate_ptr", SIMD_SYNTH_VOICE_COUNT],
  voiceEnvelope: ["voice_envelope_ptr", SIMD_SYNTH_VOICE_COUNT],
});

export function createSimdSynthKernelViews(instance) {
  const exports = instance?.exports;
  if (!(exports?.memory instanceof WebAssembly.Memory)) throw new TypeError("SIMD SYNTH kernel memory is missing.");
  for (const name of ["process", "reset", "note_on", "note_off", "all_notes_off", "lane_width", "block_size", "voice_count"]) {
    if (typeof exports[name] !== "function") throw new TypeError(`SIMD SYNTH kernel export is missing: ${name}`);
  }
  const views = { instance, exports };
  for (const [key, [pointerName, length]] of Object.entries(ARRAY_EXPORTS)) {
    if (typeof exports[pointerName] !== "function") throw new TypeError(`SIMD SYNTH pointer is missing: ${pointerName}`);
    views[key] = new Float32Array(exports.memory.buffer, exports[pointerName](), length);
  }
  return freeze(views);
}

export function writeSimdSynthConfiguration(kernel, configuration) {
  kernel.params.set(configuration.paramArray);
  kernel.sequence.set(configuration.sequenceArray);
  kernel.modRoutes.set(configuration.modRouteArray);
  return kernel;
}

export function simdSynthSupport(runtime = globalThis) {
  const AudioContextCtor = runtime.AudioContext ?? runtime.webkitAudioContext;
  const audio = Boolean(AudioContextCtor);
  const worklet = Boolean(runtime.AudioWorkletNode && AudioContextCtor?.prototype && "audioWorklet" in AudioContextCtor.prototype);
  const wasm = Boolean(runtime.WebAssembly ?? globalThis.WebAssembly);
  return freeze({ audio, worklet, wasm, supported: audio && worklet && wasm });
}

async function loadWasm(runtime, relativeUrl, { required = true } = {}) {
  try {
    const response = await runtime.fetch(new URL(relativeUrl, import.meta.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const wasm = runtime.WebAssembly ?? globalThis.WebAssembly;
    if (!wasm.validate(bytes)) throw new Error("binary is not supported");
    return bytes;
  } catch (error) {
    if (required) throw new Error(`Could not load ${relativeUrl}: ${error?.message || error}`);
    return null;
  }
}

function setTarget(param, value, time = 0, constant = 0.015) {
  if (typeof param?.setTargetAtTime === "function") param.setTargetAtTime(value, time, constant);
  else if (param) param.value = value;
}

export class SimdSynthAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.node = null;
    this.master = null;
    this.analyser = null;
    this.scopeData = null;
    this.releaseAudioOutput = null;
    this.patch = createSimdSynthConfiguration();
    this.output = 0.78;
    this.backend = "none";
    this.laneWidth = 0;
    this.simdAvailable = null;
    this.kernelMicros = null;
    this.budgetMicros = null;
    this.transportEnabled = false;
    this.sequenceTime = 0;
    this.onTelemetry = null;
    this.onError = null;
    this.ownsContext = false;
    this.destination = null;
  }

  setTelemetryHandler(handler) { this.onTelemetry = typeof handler === "function" ? handler : null; }
  setErrorHandler(handler) { this.onError = typeof handler === "function" ? handler : null; }

  setOutput(value) {
    this.output = clamp(finite(value, 0.78), 0, 1);
    if (this.master && this.context) setTarget(this.master.gain, this.output, this.context.currentTime, 0.018);
  }

  updatePatch(patch = {}) {
    this.patch = createSimdSynthConfiguration(patch);
    this.node?.port.postMessage({ type: "configure", configuration: this.patch });
  }

  setTransport(enabled, sequenceTime = this.sequenceTime) {
    this.transportEnabled = Boolean(enabled);
    this.sequenceTime = finiteWasmTime(sequenceTime, 0);
    this.node?.port.postMessage({ type: "transport", enabled: this.transportEnabled, sequenceTime: this.sequenceTime });
  }

  noteOn(note, velocity = 1) {
    this.node?.port.postMessage({ type: "note-on", note: clamp(finite(note, 60), 0, 127), velocity: clamp(finite(velocity, 1), 0.01, 1) });
  }

  noteOff(note) { this.node?.port.postMessage({ type: "note-off", note: clamp(finite(note, 60), 0, 127) }); }
  panic() { this.node?.port.postMessage({ type: "panic" }); }

  timeDomainData() {
    if (!this.analyser || !this.scopeData) return null;
    this.analyser.getFloatTimeDomainData(this.scopeData);
    return this.scopeData;
  }

  async start(patch = this.patch, options = {}) {
    if (this.context) await this.stop();
    const support = simdSynthSupport(this.runtime);
    if (!support.audio) throw new Error("Web Audio is not available in this browser.");
    if (!support.worklet) throw new Error("AudioWorklet is not available in this browser.");
    if (!support.wasm) throw new Error("WebAssembly is not available in this browser.");
    this.patch = createSimdSynthConfiguration(patch);
    this.transportEnabled = Boolean(options.transportEnabled ?? this.transportEnabled);
    this.sequenceTime = finiteWasmTime(options.sequenceTime, this.sequenceTime);

    const externalContext = options.context ?? options.audioContext ?? null;
    const AudioContextCtor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    this.ownsContext = !externalContext;
    this.context = externalContext ?? new AudioContextCtor({ latencyHint: "interactive" });
    try {
      if (this.context.state === "suspended" && typeof this.context.resume === "function") await this.context.resume();
      this.destination = options.destination ?? null;

      const forceScalar = options.forceScalar ?? new URL(this.runtime.location?.href ?? "https://localhost/").searchParams.has("scalar");
      const workletPromise = this.context.audioWorklet.addModule(new URL("./simd-synth-processor.js", import.meta.url));
      const scalarPromise = loadWasm(this.runtime, "../assets/wasm/simd-synth-scalar.wasm");
      const simdPromise = forceScalar ? Promise.resolve(null) : loadWasm(this.runtime, "../assets/wasm/simd-synth-simd.wasm", { required: false });
      const [scalarBytes, simdBytes] = await Promise.all([scalarPromise, simdPromise, workletPromise]);

      const AudioWorkletNodeCtor = this.runtime.AudioWorkletNode;
      const node = new AudioWorkletNodeCtor(this.context, "morphazoid-simd-synth", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      const master = this.context.createGain();
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      master.gain.value = 0;
      node.connect(master);
      master.connect(analyser);
      if (this.destination) {
        analyser.connect(this.destination);
        this.releaseAudioOutput = () => { try { analyser.disconnect?.(this.destination); } catch {} };
      } else {
        this.releaseAudioOutput = connectAudioOutput(this.context, analyser, { runtime: this.runtime });
      }
      this.node = node;
      this.master = master;
      this.analyser = analyser;
      this.scopeData = new Float32Array(analyser.fftSize);

      const ready = new Promise((resolve, reject) => {
        let settled = false;
        let timeout = null;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          if (timeout != null) this.runtime.clearTimeout(timeout);
          reject(error);
        };
        timeout = this.runtime.setTimeout(() => fail(new Error("SIMD SYNTH worklet did not become ready.")), 6_000);
        node.port.onmessage = (event) => {
          const message = event.data || {};
          if (message.type === "ready" || message.type === "backend") {
            this.backend = message.backend;
            this.laneWidth = message.laneWidth;
            this.simdAvailable = message.simdAvailable;
          }
          if (message.type === "ready") {
            if (!settled) {
              settled = true;
              this.runtime.clearTimeout(timeout);
              resolve(message);
            }
          } else if (message.type === "telemetry") {
            this.kernelMicros = message.kernelMicros;
            this.budgetMicros = message.budgetMicros;
            this.sequenceTime = finiteWasmTime(message.sequenceTime, this.sequenceTime);
            this.onTelemetry?.(message);
          } else if (message.type === "error") {
            const error = new Error(message.message || "SIMD SYNTH worklet reported an error.");
            this.onError?.(error);
            fail(error);
          }
        };
        node.addEventListener?.("processorerror", () => fail(new Error("SIMD SYNTH AudioWorklet stopped.")), { once: true });
      });

      node.port.postMessage({
        type: "install", scalarBytes, simdBytes, requestedBackend: forceScalar ? "scalar" : "simd",
        configuration: this.patch, transportEnabled: this.transportEnabled, sequenceTime: this.sequenceTime,
      }, simdBytes ? [scalarBytes, simdBytes] : [scalarBytes]);
      await ready;
      setTarget(master.gain, this.output, this.context.currentTime, 0.018);
      return this.context;
    } catch (error) {
      await this.stop().catch(() => {});
      throw error;
    }
  }

  async stop() {
    const context = this.context;
    const ownsContext = this.ownsContext;
    try { this.node?.port.postMessage({ type: "dispose" }); } catch {}
    try { this.node?.disconnect?.(); } catch {}
    try { this.releaseAudioOutput?.(); } catch {}
    try { this.master?.disconnect?.(); } catch {}
    try { this.analyser?.disconnect?.(); } catch {}
    this.releaseAudioOutput = null;
    this.context = null;
    this.node = null;
    this.master = null;
    this.analyser = null;
    this.scopeData = null;
    this.backend = "none";
    this.laneWidth = 0;
    this.ownsContext = false;
    this.destination = null;
    if (ownsContext && context?.state !== "closed" && typeof context?.close === "function") await context.close();
  }
}
