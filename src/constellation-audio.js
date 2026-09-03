import { flattenPatch } from "./constellation-composer.js";
import { connectAudioOutput } from "./audio-output-manager.js";
import {
  aggregateFftBands,
  frequencyToMidiPitch,
  frequencyToNormalized,
  midiNoteToFrequency,
  normalizedToFrequency,
  normalizeDecibels,
  updateAmplitudeGate,
  waveformRmsPeak,
} from "./constellation-analysis.js";
import {
  clampPosition,
  computeSpeakerGains,
  makeLayouts,
  outputModeFor,
  speakerPan,
} from "./surround-field.js";

const EPSILON = 1e-7;
const MAX_EVENTS_PER_WINDOW = 512;
const MAX_ACTIVE_VOICES = 128;
const MAX_RECORDING_STEMS = 16;
const MAX_NODE_MONITORS = 32;
export const MAX_RUNTIME_EVENT_QUEUE = 256;
const MONITOR_INTERVAL_MS = 1000 / 30;
const MONITOR_WAVEFORM_POINTS = 128;
const MONITOR_SPECTRUM_POINTS = 64;
const NODE_MONITOR_WAVEFORM_POINTS = 64;
const NODE_MONITOR_SPECTRUM_POINTS = 32;
const SILENCE = 0.0001;

const RECORDING_MIME_TYPES = Object.freeze([
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
]);

const MONITOR_BANDS = Object.freeze({
  sub: Object.freeze([20, 60]),
  bass: Object.freeze([60, 250]),
  lowMid: Object.freeze([250, 500]),
  mid: Object.freeze([500, 2_000]),
  presence: Object.freeze([2_000, 6_000]),
  air: Object.freeze([6_000, 24_000]),
});

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, finite(value, fallback)))
);

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeConnect(source, destination, ...channels) {
  if (!source || !destination || typeof source.connect !== "function") return false;
  try {
    source.connect(destination, ...channels);
    return true;
  } catch {
    return false;
  }
}

function safeDisconnect(node, destination) {
  try {
    if (destination === undefined) node?.disconnect?.();
    else node?.disconnect?.(destination);
  } catch { /* A closing graph may already be disconnected. */ }
}

function safeLabel(value, fallback = "Track") {
  const label = String(value ?? "").trim().replace(/\s+/g, " ");
  return label || fallback;
}

function safeFileId(value, fallback = "track") {
  const id = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || fallback;
}

function recorderConstructor(runtime) {
  return runtime?.MediaRecorder ?? globalThis.MediaRecorder;
}

/** Pick a recording container supported by the current browser. */
export function recordingMimeType(runtime = globalThis) {
  const Recorder = recorderConstructor(runtime);
  if (typeof Recorder !== "function") return "";
  if (typeof Recorder.isTypeSupported !== "function") return "";
  return RECORDING_MIME_TYPES.find((type) => Recorder.isTypeSupported(type)) ?? "";
}

export function recordingExtension(mimeType = "") {
  const value = String(mimeType).toLowerCase();
  if (value.includes("ogg")) return "ogg";
  if (value.includes("mp4")) return "m4a";
  return "webm";
}

function setParam(parameter, method, ...values) {
  if (!parameter) return;
  try {
    if (typeof parameter[method] === "function") parameter[method](...values);
    else if (values.length) parameter.value = values[0];
  } catch {
    // A closing context is intentionally ignored; the next gesture rebuilds it.
  }
}

function playableEventHasEnergy(event) {
  if (!event?.playable) return false;
  const explicitLevels = [event.value, event.velocity]
    .filter((value) => value !== undefined)
    .map((value) => finite(value, 0));
  return !explicitLevels.length || explicitLevels.every((value) => value > EPSILON);
}

/** Return only playable note attacks inside one half-open beat window. */
export function performanceEventsForWindow(
  source,
  fromBeat,
  toBeat,
  { maximum = MAX_EVENTS_PER_WINDOW, includeControl = false, includeMidi = false } = {},
) {
  const events = Array.isArray(source) ? source : Array.isArray(source?.events) ? source.events : [];
  const start = finite(fromBeat, 0);
  const end = Math.max(start, finite(toBeat, start));
  if (end - start <= EPSILON) return [];
  return events
    .filter((event) => (
      event?.beat + EPSILON >= start
      && event.beat < end - EPSILON
      && (
        playableEventHasEnergy(event)
        || (includeControl && event.signal === "control")
        || (includeMidi && event.signal === "midi")
      )
    ))
    .sort((first, second) => first.beat - second.beat || String(first.id).localeCompare(String(second.id)))
    .slice(0, Math.max(1, Math.floor(finite(maximum, MAX_EVENTS_PER_WINDOW))));
}

function makePassthrough(context) {
  const input = context.createGain();
  const output = context.createGain();
  safeConnect(input, output);
  return {
    input,
    output,
    nodes: [input, output],
    controlParam: null,
    controlBase: 0,
    controlDepth: 0,
    controlMinimum: -Infinity,
    controlMaximum: Infinity,
  };
}

function makeImpulse(context, seconds = 1.4, decay = 2.4) {
  const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, frames, context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let seed = 173 + channel * 37;
    for (let index = 0; index < frames; index += 1) {
      seed = (seed * 16807) % 2147483647;
      const noise = seed / 1073741823.5 - 1;
      data[index] = noise * (1 - index / frames) ** decay;
    }
  }
  return buffer;
}

function primitiveBus(context, flat) {
  const primitiveId = flat.node?.primitiveId;
  const params = flat.node?.params ?? {};
  const bus = makePassthrough(context);
  safeDisconnect(bus.input);
  safeDisconnect(bus.output);
  bus.nodes = [bus.input, bus.output];

  if (primitiveId === "filter") {
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = clamp(params.cutoff, 80, 18_000, 2200);
    filter.Q.value = clamp(params.resonance, .1, 24, 2.2);
    safeConnect(bus.input, filter);
    safeConnect(filter, bus.output);
    bus.nodes.push(filter);
    bus.controlParam = filter.frequency;
    bus.controlBase = filter.frequency.value;
    bus.controlDepth = 1_100;
    bus.controlMinimum = 80;
    bus.controlMaximum = 18_000;
    return bus;
  }

  if (primitiveId === "delay") {
    const dry = context.createGain();
    const wet = context.createGain();
    const delay = context.createDelay(4);
    const feedback = context.createGain();
    dry.gain.value = 0.72;
    wet.gain.value = clamp(params.mix, 0, .9, .45);
    delay.delayTime.value = clamp(params.delaySeconds, .01, 3.8, .22);
    feedback.gain.value = clamp(params.feedback, 0, .78, .36);
    safeConnect(bus.input, dry);
    safeConnect(dry, bus.output);
    safeConnect(bus.input, delay);
    safeConnect(delay, wet);
    safeConnect(wet, bus.output);
    safeConnect(delay, feedback);
    safeConnect(feedback, delay);
    bus.nodes.push(dry, wet, delay, feedback);
    bus.controlParam = delay.delayTime;
    bus.controlBase = delay.delayTime.value;
    bus.controlDepth = .08;
    bus.controlMinimum = .01;
    bus.controlMaximum = 3.8;
    return bus;
  }

  if (primitiveId === "reverb") {
    const dry = context.createGain();
    const wet = context.createGain();
    const convolver = context.createConvolver();
    dry.gain.value = .65;
    wet.gain.value = clamp(params.mix, 0, .9, .42);
    convolver.buffer = makeImpulse(context);
    safeConnect(bus.input, dry);
    safeConnect(dry, bus.output);
    safeConnect(bus.input, convolver);
    safeConnect(convolver, wet);
    safeConnect(wet, bus.output);
    bus.nodes.push(dry, wet, convolver);
    bus.controlParam = wet.gain;
    bus.controlBase = wet.gain.value;
    bus.controlDepth = .32;
    bus.controlMinimum = 0;
    bus.controlMaximum = .9;
    return bus;
  }

  if (primitiveId === "compressor") {
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 16;
    compressor.ratio.value = 5;
    compressor.attack.value = .004;
    compressor.release.value = .16;
    safeConnect(bus.input, compressor);
    safeConnect(compressor, bus.output);
    bus.nodes.push(compressor);
    bus.controlParam = compressor.threshold;
    bus.controlBase = compressor.threshold.value;
    bus.controlDepth = 8;
    bus.controlMinimum = -100;
    bus.controlMaximum = 0;
    return bus;
  }

  if (["gain", "mixer", "output", "surround-output", "stem", "stem-output", "track", "track-output"].includes(primitiveId)) {
    const gain = context.createGain();
    gain.gain.value = clamp(params.gain, 0, 1.5, primitiveId === "output" ? .88 : .76);
    safeConnect(bus.input, gain);
    safeConnect(gain, bus.output);
    bus.nodes.push(gain);
    bus.controlParam = gain.gain;
    bus.controlBase = gain.gain.value;
    bus.controlDepth = .28;
    bus.controlMinimum = 0;
    bus.controlMaximum = 1.5;
    return bus;
  }

  safeConnect(bus.input, bus.output);
  return bus;
}

const DEFAULT_OUTPUT_CONFIG = Object.freeze({
  layoutId: "stereo",
  customCount: 8,
  forceStereo: false,
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  focus: .58,
});

function normalizeOutputConfig(options = {}, previous = DEFAULT_OUTPUT_CONFIG) {
  const requestedLayout = String(
    options.layoutId ?? options.layout ?? previous.layoutId ?? DEFAULT_OUTPUT_CONFIG.layoutId,
  );
  const layouts = outputLayouts(options.customCount ?? previous.customCount);
  const layoutId = requestedLayout === "stereo" || layouts[requestedLayout]
    ? requestedLayout
    : DEFAULT_OUTPUT_CONFIG.layoutId;
  return {
    layoutId,
    customCount: Math.round(clamp(
      options.customCount,
      2,
      32,
      previous.customCount ?? DEFAULT_OUTPUT_CONFIG.customCount,
    )),
    forceStereo: Boolean(options.forceStereo ?? options.forcePreview ?? previous.forceStereo),
    position: { ...clampPosition({
      ...(previous.position ?? DEFAULT_OUTPUT_CONFIG.position),
      ...(options.position ?? {}),
      ...(options.x === undefined ? {} : { x: options.x }),
      ...(options.y === undefined ? {} : { y: options.y }),
      ...(options.z === undefined ? {} : { z: options.z }),
    }) },
    focus: clamp(options.focus, 0, 1, previous.focus ?? DEFAULT_OUTPUT_CONFIG.focus),
  };
}

function outputLayouts(customCount = DEFAULT_OUTPUT_CONFIG.customCount) {
  const layouts = makeLayouts(customCount);
  const sevenFourOne = layouts["7-4-1"];
  const fourOne = layouts["4-1"];
  const makeAlias = (id, name, descriptor, speakers, view = "plan") => ({
    id,
    name,
    descriptor,
    view,
    speakers,
  });
  const binauralSpeakers = [
    { id: "headphone-left", label: "L", channel: 1, kind: "full", x: -.92, y: 0, z: 0, azimuth: -90 },
    { id: "headphone-right", label: "R", channel: 2, kind: "full", x: .92, y: 0, z: 0, azimuth: 90 },
  ];
  return {
    ...layouts,
    binaural: makeAlias("binaural", "Binaural headphones", "2-channel spatial preview", binauralSpeakers),
    quad: makeAlias("quad", "Quad", "4 around · discrete", fourOne.speakers.filter(({ kind }) => kind !== "lfe")),
    "5-1": makeAlias("5-1", "5.1", "5 bed · 1 LFE", sevenFourOne.speakers.slice(0, 6)),
    "7-1": makeAlias("7-1", "7.1", "7 bed · 1 LFE", sevenFourOne.speakers.slice(0, 8)),
  };
}

function isOutputFlat(flat) {
  const id = String(flat?.node?.primitiveId ?? "");
  return Boolean(
    flat?.primitive?.output
    || flat?.node?.params?.output === true
    || ["output", "surround-output", "audio-output", "master-output"].includes(id)
  );
}

function isActiveOutputFlat(flat) {
  const params = flat?.node?.params ?? {};
  return isOutputFlat(flat)
    && flat?.node?.active !== false
    && params.active !== false
    && params.disabled !== true;
}

function isExplicitStemFlat(flat) {
  const id = String(flat?.node?.primitiveId ?? "");
  const params = flat?.node?.params ?? {};
  const recordMode = String(params.recordMode ?? "").trim().toLowerCase();
  if (recordMode === "mix") return false;
  return Boolean(
    recordMode === "stem"
    || flat?.primitive?.stem
    || flat?.node?.recordStem
    || params.recordStem
    || params.stem
    || ["stem", "stem-output", "track", "track-output", "recorder"].includes(id)
  );
}

function configureStereoNode(node) {
  if (!node) return node;
  try {
    node.channelCount = 2;
    node.channelCountMode = "explicit";
    node.channelInterpretation = "speakers";
  } catch {
    // Fixed-channel browser nodes already expose the closest supported route.
  }
  return node;
}

function configureAnalyser(analyser) {
  if (!analyser) return null;
  try {
    analyser.fftSize = 2_048;
    analyser.smoothingTimeConstant = .72;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -18;
  } catch {
    // Minimal test and older browser analysers can keep their defaults.
  }
  return analyser;
}

function fillWaveform(source, target) {
  if (!target?.length) return target;
  if (!source?.length) {
    target.fill(0);
    return target;
  }
  for (let index = 0; index < target.length; index += 1) {
    target[index] = finite(source[Math.min(
      source.length - 1,
      Math.floor((index * source.length) / target.length),
    )], 0);
  }
  return target;
}

function fillSpectrum(source, target, minimumDb = -100, maximumDb = -18, bytes = false) {
  if (!target?.length) return target;
  if (!source?.length) {
    target.fill(0);
    return target;
  }
  for (let index = 0; index < target.length; index += 1) {
    const from = Math.floor((index * source.length) / target.length);
    const to = Math.max(from + 1, Math.floor(((index + 1) * source.length) / target.length));
    let total = 0;
    let count = 0;
    for (let bin = from; bin < Math.min(source.length, to); bin += 1) {
      total += bytes
        ? clamp(source[bin] / 255, 0, 1, 0)
        : normalizeDecibels(source[bin], { floorDb: minimumDb, ceilingDb: maximumDb });
      count += 1;
    }
    target[index] = count ? total / count : 0;
  }
  return target;
}

function analyseFrequency(source, analyser, sampleRate, bytes = false) {
  const bands = Object.fromEntries(Object.keys(MONITOR_BANDS).map((name) => [name, 0]));
  if (!source?.length || !analyser) return { dominantFrequencyHz: 0, centroidHz: 0, bands };
  const minimumDb = finite(analyser.minDecibels, -100);
  const maximumDb = finite(analyser.maxDecibels, -18);
  const fftSize = Math.max(2, finite(analyser.fftSize, source.length * 2));
  const hertzPerBin = Math.max(0, finite(sampleRate, 44_100) / fftSize);
  let strongest = 0;
  let strongestBin = 0;
  let weightedFrequency = 0;
  let totalWeight = 0;
  for (let index = 1; index < source.length; index += 1) {
    const frequency = index * hertzPerBin;
    const level = bytes
      ? clamp(source[index] / 255, 0, 1, 0)
      : normalizeDecibels(source[index], { floorDb: minimumDb, ceilingDb: maximumDb });
    if (level > strongest) {
      strongest = level;
      strongestBin = index;
    }
    const weight = level * level;
    weightedFrequency += frequency * weight;
    totalWeight += weight;
  }
  const aggregate = aggregateFftBands(source, {
    sampleRate,
    fftSize,
    scale: bytes ? "byte" : "decibels",
    floorDb: minimumDb,
    ceilingDb: maximumDb,
    bands: Object.entries(MONITOR_BANDS).map(([id, [minHz, maxHz]]) => ({ id, label: id, minHz, maxHz })),
  });
  for (const band of aggregate) {
    bands[band.id] = band.rms;
  }
  return {
    dominantFrequencyHz: strongest > .01 ? strongestBin * hertzPerBin : 0,
    centroidHz: totalWeight > EPSILON ? weightedFrequency / totalWeight : 0,
    bands,
  };
}

function monitorMetricForPort(portId = "", fallbackMetric = "rms") {
  const id = String(portId).toLowerCase();
  if (id.includes("frequency") || id.includes("pitch")) return "frequency";
  if (id.includes("sub")) return "sub";
  if (id.includes("bass") || id.includes("low")) return "bass";
  if (id.includes("mid")) return "mid";
  if (id.includes("presence") || id.includes("high")) return "presence";
  if (id.includes("air")) return "air";
  if (id.includes("peak")) return "peak";
  return fallbackMetric;
}

function normalizeMonitorMetric(record, metric) {
  if (!record) return 0;
  if (metric === "frequency") {
    return frequencyToNormalized(record.dominantFrequencyHz, { minHz: 20, maxHz: 20_000 });
  }
  if (Object.hasOwn(MONITOR_BANDS, metric)) return clamp(record.bands?.[metric], 0, 1, 0);
  return clamp(record[metric], 0, 1, 0);
}

function monitorClock(runtime, context) {
  const timestamp = runtime?.performance?.now?.();
  if (Number.isFinite(timestamp)) return timestamp;
  return finite(context?.currentTime, 0) * 1_000;
}

/**
 * One shared Web Audio graph for the whole patch. Trigger and control flow is
 * projected in beats and scheduled; only continuous audio cables compile here.
 */
export class ConstellationAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.patch = null;
    this.flattened = null;
    this.master = null;
    this.compressor = null;
    this.monitor = null;
    this.monitorSplitter = null;
    this.leftMonitor = null;
    this.rightMonitor = null;
    this.monitorNodes = [];
    this.monitorBuffers = null;
    this.monitorWaveform = new Float32Array(MONITOR_WAVEFORM_POINTS);
    this.monitorSpectrum = new Float32Array(MONITOR_SPECTRUM_POINTS);
    this.monitorSnapshotCache = null;
    this.monitorSampledAt = Number.NEGATIVE_INFINITY;
    this.monitorControlRoutes = [];
    this.manualMonitorControlRoutes = [];
    this.nodeMonitors = new Map();
    this.controlValues = new Map();
    this.runtimeEvents = [];
    this.runtimeConverterStates = new Map();
    this.runtimeEventSequence = 0;
    this.output = .54;
    this.outputConfig = normalizeOutputConfig();
    this.outputMode = "unprobed";
    this.outputNodes = [];
    this.outputConnections = [];
    this.releaseOutput = null;
    this.speakerRoutes = [];
    this.started = false;
    this.startPromise = null;
    this.buses = new Map();
    this.graphNodes = [];
    this.modulators = [];
    this.activeVoices = new Set();
    this.noiseBuffers = new Map();
    this.recordingSession = null;
    this.recordingStopPromise = null;
    this.lastRecording = null;
    this.transport = { tempo: 120, beat: 0, contextTime: 0 };
  }

  setPatch(patch) {
    this.patch = patch;
    this.transport.tempo = clamp(patch?.tempo, 30, 300, this.transport.tempo);
    if (patch?.rootGraphId) this.#applyPatchOutputConfig(flattenPatch(patch, patch.rootGraphId));
    if (this.context && this.context.state !== "closed") this.#compilePatch();
    return this.patch;
  }

  /**
   * Keep the adapter's tempo fallback aligned with the musical transport.
   * Projected LFO/control events already carry their phase in beats, so this
   * intentionally does not create or restart a free-running oscillator.
   */
  syncTransport(options = {}) {
    const values = typeof options === "number" ? { tempo: options } : options ?? {};
    this.transport = {
      tempo: clamp(values.tempo, 30, 300, this.patch?.tempo ?? this.transport.tempo),
      beat: Math.max(0, finite(values.beat, this.transport.beat)),
      contextTime: Math.max(0, finite(values.contextTime, this.context?.currentTime ?? this.transport.contextTime)),
    };
    return { ...this.transport };
  }

  setTempo(tempo, options = {}) {
    return this.syncTransport({ ...options, tempo });
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async #startInternal() {
    if (!this.context || this.context.state === "closed") {
      const AudioContextConstructor = this.runtime?.AudioContext ?? this.runtime?.webkitAudioContext;
      if (typeof AudioContextConstructor !== "function") throw new Error("Web Audio is not available in this browser.");
      this.context = new AudioContextConstructor();
      this.noiseBuffers.clear();
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor?.() ?? this.context.createGain();
      this.compressor.threshold && (this.compressor.threshold.value = -10);
      this.compressor.knee && (this.compressor.knee.value = 12);
      this.compressor.ratio && (this.compressor.ratio.value = 8);
      safeConnect(this.master, this.compressor);
      this.#buildMonitorGraph();
      this.#rebuildOutputRoute();
      this.setOutput(this.output);
      this.#compilePatch();
    }
    if (this.context.state !== "running") await this.context.resume?.();
    this.started = true;
    return this.context;
  }

  #buildMonitorGraph() {
    this.#clearMonitorGraph();
    const context = this.context;
    if (!context || !this.compressor) return;
    let monitor = null;
    try {
      monitor = configureAnalyser(context.createAnalyser?.());
    } catch {
      monitor = null;
    }
    if (monitor && safeConnect(this.compressor, monitor)) {
      this.monitor = monitor;
      this.monitorNodes.push(monitor);
    } else {
      safeDisconnect(monitor);
      monitor = null;
    }

    const monitorSource = monitor ?? this.compressor;
    if (typeof context.createChannelSplitter === "function" && typeof context.createAnalyser === "function") {
      try {
        const splitter = context.createChannelSplitter(2);
        const left = configureAnalyser(context.createAnalyser());
        const right = configureAnalyser(context.createAnalyser());
        safeConnect(monitorSource, splitter);
        safeConnect(splitter, left, 0, 0);
        safeConnect(splitter, right, 1, 0);
        this.monitorSplitter = splitter;
        this.leftMonitor = left;
        this.rightMonitor = right;
        this.monitorNodes.push(splitter, left, right);
      } catch {
        safeDisconnect(this.monitorSplitter);
        safeDisconnect(this.leftMonitor);
        safeDisconnect(this.rightMonitor);
        this.monitorSplitter = null;
        this.leftMonitor = null;
        this.rightMonitor = null;
      }
    }
    this.#resetMonitorBuffers();
  }

  #clearMonitorGraph() {
    if (this.compressor && this.monitor) safeDisconnect(this.compressor, this.monitor);
    for (const node of this.monitorNodes) safeDisconnect(node);
    this.monitor = null;
    this.monitorSplitter = null;
    this.leftMonitor = null;
    this.rightMonitor = null;
    this.monitorNodes = [];
    this.monitorBuffers = null;
    this.monitorSnapshotCache = null;
    this.monitorSampledAt = Number.NEGATIVE_INFINITY;
  }

  #resetMonitorBuffers() {
    const fftSize = Math.max(32, Math.floor(finite(this.monitor?.fftSize, 2_048)));
    const frequencyBins = Math.max(1, Math.floor(finite(this.monitor?.frequencyBinCount, fftSize / 2)));
    const channelSize = Math.max(32, Math.floor(finite(this.leftMonitor?.fftSize, fftSize)));
    this.monitorBuffers = {
      time: new Float32Array(fftSize),
      timeBytes: new Uint8Array(fftSize),
      frequency: new Float32Array(frequencyBins),
      frequencyBytes: new Uint8Array(frequencyBins),
      left: new Float32Array(channelSize),
      right: new Float32Array(channelSize),
    };
    this.monitorBuffers.frequency.fill(finite(this.monitor?.minDecibels, -100));
  }

  #buffersForAnalyser(analyser) {
    const fftSize = Math.max(32, Math.floor(finite(analyser?.fftSize, 2_048)));
    const frequencyBins = Math.max(1, Math.floor(finite(analyser?.frequencyBinCount, fftSize / 2)));
    const buffers = {
      time: new Float32Array(fftSize),
      timeBytes: new Uint8Array(fftSize),
      frequency: new Float32Array(frequencyBins),
      frequencyBytes: new Uint8Array(frequencyBins),
    };
    buffers.frequency.fill(finite(analyser?.minDecibels, -100));
    return buffers;
  }

  #readTimeDomain(analyser, buffers) {
    if (!analyser || !buffers) return false;
    buffers.time.fill(0);
    if (typeof analyser.getFloatTimeDomainData === "function") {
      try {
        analyser.getFloatTimeDomainData(buffers.time);
        return true;
      } catch { /* Byte-domain fallback below. */ }
    }
    if (typeof analyser.getByteTimeDomainData !== "function") return false;
    try {
      analyser.getByteTimeDomainData(buffers.timeBytes);
      for (let index = 0; index < buffers.time.length; index += 1) {
        buffers.time[index] = (buffers.timeBytes[index] - 128) / 128;
      }
      return true;
    } catch {
      return false;
    }
  }

  #readFrequencyDomain(analyser, buffers) {
    if (!analyser || !buffers) return { source: null, bytes: false };
    buffers.frequency.fill(finite(analyser.minDecibels, -100));
    if (typeof analyser.getFloatFrequencyData === "function") {
      try {
        analyser.getFloatFrequencyData(buffers.frequency);
        return { source: buffers.frequency, bytes: false };
      } catch { /* Byte-domain fallback below. */ }
    }
    buffers.frequencyBytes.fill(0);
    if (typeof analyser.getByteFrequencyData !== "function") return { source: null, bytes: false };
    try {
      analyser.getByteFrequencyData(buffers.frequencyBytes);
      return { source: buffers.frequencyBytes, bytes: true };
    } catch {
      return { source: null, bytes: false };
    }
  }

  #sampleAnalyser(analyser, buffers, waveform, spectrum) {
    const readTime = this.#readTimeDomain(analyser, buffers);
    const levels = readTime ? waveformRmsPeak(buffers.time) : { rms: 0, peak: 0 };
    fillWaveform(readTime ? buffers.time : null, waveform);
    const frequency = this.#readFrequencyDomain(analyser, buffers);
    fillSpectrum(
      frequency.source,
      spectrum,
      finite(analyser?.minDecibels, -100),
      finite(analyser?.maxDecibels, -18),
      frequency.bytes,
    );
    return {
      ...levels,
      ...analyseFrequency(frequency.source, analyser, this.context?.sampleRate, frequency.bytes),
    };
  }

  #monitorSource() {
    return this.monitor ?? this.compressor;
  }

  #rememberOutputConnection(source, destination) {
    if (!safeConnect(source, destination)) return false;
    this.outputConnections.push({ source, destination });
    return true;
  }

  #clearOutputRoute() {
    this.releaseOutput?.();
    this.releaseOutput = null;
    for (const { source, destination } of this.outputConnections) safeDisconnect(source, destination);
    this.outputConnections = [];
    for (const node of this.outputNodes) safeDisconnect(node);
    this.outputNodes = [];
    this.speakerRoutes = [];
    this.outputMode = this.context ? "stereo" : "unprobed";
  }

  #connectFinalOutput(node) {
    if (!node || !this.context) return false;
    this.releaseOutput = connectAudioOutput(this.context, node, { runtime: this.runtime });
    return true;
  }

  #buildDirectStereoRoute(source) {
    const context = this.context;
    if (!context || !source) return false;
    const stereo = configureStereoNode(context.createGain());
    if (!this.#rememberOutputConnection(source, stereo)) return false;
    this.outputNodes.push(stereo);
    this.#connectFinalOutput(stereo);
    this.outputMode = "stereo";
    return true;
  }

  #buildStereoSpatialRoute(source, layout, gains) {
    const context = this.context;
    if (!context || !source || typeof context.createStereoPanner !== "function") {
      return this.#buildDirectStereoRoute(source);
    }
    const stereoBus = configureStereoNode(context.createGain());
    stereoBus.gain && (stereoBus.gain.value = .92);
    this.outputNodes.push(stereoBus);
    for (let index = 0; index < layout.speakers.length; index += 1) {
      const speaker = layout.speakers[index];
      const spatialGain = context.createGain();
      const panner = context.createStereoPanner();
      spatialGain.gain.value = clamp(gains[index], 0, 1, 0);
      panner.pan.value = speaker.kind === "lfe" ? 0 : speakerPan(speaker);
      this.#rememberOutputConnection(source, spatialGain);
      let routeEntry = spatialGain;
      const nodes = [spatialGain, panner];
      if (speaker.kind === "lfe" && typeof context.createBiquadFilter === "function") {
        const lowpass = context.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 120;
        lowpass.Q.value = .7;
        safeConnect(spatialGain, lowpass);
        safeConnect(lowpass, panner);
        routeEntry = lowpass;
        nodes.push(lowpass);
      } else {
        safeConnect(spatialGain, panner);
      }
      safeConnect(panner, stereoBus);
      this.outputNodes.push(...nodes);
      this.speakerRoutes.push({ speaker, spatialGain, routeEntry, panner, channel: index });
    }
    this.#connectFinalOutput(stereoBus);
    this.outputMode = "stereo-preview";
    return true;
  }

  #buildDiscreteSpatialRoute(source, layout, gains) {
    const context = this.context;
    if (!context || !source || typeof context.createChannelMerger !== "function") return false;
    let merger;
    try {
      context.destination.channelCount = layout.speakers.length;
      context.destination.channelInterpretation = "discrete";
      merger = context.createChannelMerger(layout.speakers.length);
      merger.channelInterpretation = "discrete";
    } catch {
      return false;
    }
    this.outputNodes.push(merger);
    for (let index = 0; index < layout.speakers.length; index += 1) {
      const speaker = layout.speakers[index];
      const spatialGain = context.createGain();
      spatialGain.gain.value = clamp(gains[index], 0, 1, 0);
      this.#rememberOutputConnection(source, spatialGain);
      let routeEntry = spatialGain;
      const nodes = [spatialGain];
      if (speaker.kind === "lfe" && typeof context.createBiquadFilter === "function") {
        const lowpass = context.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 120;
        lowpass.Q.value = .7;
        safeConnect(spatialGain, lowpass);
        routeEntry = lowpass;
        nodes.push(lowpass);
      }
      safeConnect(routeEntry, merger, 0, index);
      this.outputNodes.push(...nodes);
      this.speakerRoutes.push({ speaker, spatialGain, routeEntry, channel: index });
    }
    this.#connectFinalOutput(merger);
    this.outputMode = "discrete";
    return true;
  }

  #rebuildOutputRoute() {
    if (!this.context) return this.outputCapabilities();
    this.#clearOutputRoute();
    const source = this.#monitorSource();
    if (!source) return this.outputCapabilities();
    const config = this.outputConfig;
    if (config.layoutId === "stereo") {
      try {
        this.context.destination.channelCount = Math.min(2, Math.max(1, finite(
          this.context.destination.maxChannelCount,
          2,
        )));
        this.context.destination.channelInterpretation = "speakers";
      } catch {
        // Fixed destinations still receive the stereo route below.
      }
      this.#buildDirectStereoRoute(source);
      return this.outputCapabilities();
    }
    const layout = outputLayouts(config.customCount)[config.layoutId] ?? outputLayouts(config.customCount)["8-circle"];
    const gains = computeSpeakerGains(layout.speakers, config.position, config.focus);
    const deviceChannels = Math.max(1, Math.floor(finite(this.context.destination.maxChannelCount, 2)));
    const wantedMode = outputModeFor(
      deviceChannels,
      layout.speakers.length,
      config.forceStereo || config.layoutId === "binaural",
    );
    if (wantedMode === "discrete" && this.#buildDiscreteSpatialRoute(source, layout, gains)) {
      return this.outputCapabilities();
    }
    try {
      this.context.destination.channelCount = Math.min(2, deviceChannels);
      this.context.destination.channelInterpretation = "speakers";
    } catch {
      // Fixed destinations still receive a safe browser down-mix.
    }
    this.#buildStereoSpatialRoute(source, layout, gains);
    return this.outputCapabilities();
  }

  configureOutput(options = {}) {
    this.outputConfig = normalizeOutputConfig(options, this.outputConfig);
    if (this.context && this.context.state !== "closed") this.#rebuildOutputRoute();
    return this.outputCapabilities();
  }

  setSpatialOutput(options = {}) {
    return this.configureOutput(options);
  }

  setSpatialPosition(position = {}, focus = this.outputConfig.focus) {
    return this.configureOutput({ position, focus });
  }

  outputCapabilities() {
    const layouts = outputLayouts(this.outputConfig.customCount);
    const layout = this.outputConfig.layoutId === "stereo" ? null : layouts[this.outputConfig.layoutId];
    const destination = this.context?.destination;
    const deviceChannels = destination
      ? Math.max(1, Math.floor(finite(destination.maxChannelCount, 2)))
      : null;
    return {
      available: Boolean(this.runtime?.AudioContext ?? this.runtime?.webkitAudioContext ?? this.context),
      mode: this.context ? this.outputMode : "unprobed",
      layoutId: this.outputConfig.layoutId,
      layoutName: layout?.name ?? "Stereo",
      layout: layout ? {
        id: layout.id,
        name: layout.name,
        descriptor: layout.descriptor,
        channels: layout.speakers.length,
      } : { id: "stereo", name: "Stereo", descriptor: "2-channel speakers", channels: 2 },
      virtualChannels: layout?.speakers?.length ?? 2,
      deviceChannels,
      forceStereo: this.outputConfig.forceStereo,
      position: { ...this.outputConfig.position },
      focus: this.outputConfig.focus,
      layouts: [
        { id: "stereo", label: "Stereo", channels: 2 },
        ...Object.values(layouts).map((item) => ({
          id: item.id,
          label: item.name,
          channels: item.speakers.length,
          descriptor: item.descriptor,
        })),
      ],
    };
  }

  #patchNode(graphId, nodeId) {
    const graph = this.patch?.graphs?.find?.(({ id }) => id === graphId);
    return graph?.nodes?.find?.(({ id }) => id === nodeId) ?? null;
  }

  #outputOptionsFromPatch(flattened) {
    const candidates = (flattened?.nodes ?? []).filter(isActiveOutputFlat);
    const flat = candidates.find(({ node }) => (
      node?.primitiveId === "surround-output" || node?.params?.layoutId || node?.layoutId
    )) ?? candidates[0];
    if (!flat) return null;
    const params = {};
    for (const instance of flat.instances ?? []) {
      const instanceNode = this.#patchNode(instance.parentGraphId, instance.nodeId);
      Object.assign(params, instanceNode?.params ?? {});
      for (const key of ["layoutId", "customCount", "forceStereo", "position", "focus", "renderMode"]) {
        if (instanceNode?.[key] !== undefined) params[key] = instanceNode[key];
      }
    }
    Object.assign(params, flat.node?.params ?? {});
    for (const key of ["layoutId", "customCount", "forceStereo", "position", "focus", "renderMode"]) {
      if (flat.node?.[key] !== undefined) params[key] = flat.node[key];
    }
    const primitiveId = String(flat.node?.primitiveId ?? "");
    const layoutId = params.layoutId
      ?? params.layout
      ?? (primitiveId === "surround-output" ? "8-circle" : "stereo");
    return {
      layoutId,
      ...(params.customCount === undefined ? {} : { customCount: params.customCount }),
      forceStereo: Boolean(
        params.forceStereo
        ?? params.forcePreview
        ?? ["preview", "stereo", "binaural"].includes(String(params.renderMode ?? "").toLowerCase()),
      ),
      ...(params.position === undefined ? {} : { position: params.position }),
      ...(params.focus === undefined ? {} : { focus: params.focus }),
    };
  }

  #applyPatchOutputConfig(flattened) {
    const options = this.#outputOptionsFromPatch(flattened);
    if (!options) return false;
    const next = normalizeOutputConfig(options, this.outputConfig);
    const before = JSON.stringify(this.outputConfig);
    const after = JSON.stringify(next);
    this.outputConfig = next;
    if (before === after) return false;
    this.#rebuildOutputRoute();
    return true;
  }

  #clearNodeMonitors() {
    for (const monitor of this.nodeMonitors.values()) {
      if (monitor.source && monitor.analyser) safeDisconnect(monitor.source, monitor.analyser);
      safeDisconnect(monitor.analyser);
    }
    this.nodeMonitors.clear();
    this.monitorControlRoutes = [];
    this.monitorSnapshotCache = null;
    this.monitorSampledAt = Number.NEGATIVE_INFINITY;
  }

  #monitorDescriptor(flat) {
    const node = flat?.node;
    if (!node) return null;
    if (
      node.type === "port"
      && node.direction === "out"
      && node.signal === "audio"
      && flat.instances?.length
    ) {
      const instance = flat.instances.at(-1);
      return {
        key: `${instance.parentGraphId}:${instance.nodeId}`,
        graphId: instance.parentGraphId,
        nodeId: instance.nodeId,
        label: safeLabel(instance.label, "Subgraph"),
        primitiveId: instance.deviceId ?? "subgraph",
        role: "subgraph-output",
        audio: true,
      };
    }
    const primitiveId = String(node.primitiveId ?? "");
    const runtime = flat.primitive?.runtime ?? {};
    const analysis = runtime.analysis ?? flat.primitive?.analysis;
    const explicit = runtime.kind === "monitor"
      || Boolean(analysis)
      || [
        "scope",
        "level-meter",
        "spectrum",
        "frequency-tracker",
        "control-display",
        "audio-to-amplitude",
        "audio-to-fft-bands",
      ].includes(primitiveId);
    if (!explicit) return null;
    return {
      key: `${flat.graphId}:${node.id}`,
      graphId: flat.graphId,
      nodeId: node.id,
      label: safeLabel(node.label, flat.primitive?.label ?? "Monitor"),
      primitiveId,
      role: runtime.role ?? analysis ?? primitiveId,
      audio: primitiveId !== "control-display" && analysis !== "control-value",
    };
  }

  #setupNodeMonitors() {
    this.#clearNodeMonitors();
    if (!this.context || !this.flattened) return;
    let count = 0;
    for (const flat of this.flattened.nodes) {
      if (count >= MAX_NODE_MONITORS) break;
      const descriptor = this.#monitorDescriptor(flat);
      const bus = this.buses.get(flat.address);
      if (!descriptor || !bus || this.nodeMonitors.has(flat.address)) continue;
      let analyser = null;
      let buffers = null;
      if (descriptor.audio && typeof this.context.createAnalyser === "function") {
        try {
          analyser = configureAnalyser(this.context.createAnalyser());
          const requestedFft = Math.floor(finite(flat.node?.params?.fftSize, analyser?.fftSize));
          if (requestedFft >= 32 && requestedFft <= 32_768 && !(requestedFft & (requestedFft - 1))) {
            analyser.fftSize = requestedFft;
          }
          safeConnect(bus.audio.output, analyser);
          buffers = this.#buffersForAnalyser(analyser);
          this.graphNodes.push(analyser);
        } catch {
          safeDisconnect(analyser);
          analyser = null;
        }
      }
      this.nodeMonitors.set(flat.address, {
        ...descriptor,
        address: flat.address,
        source: bus.audio.output,
        analyser,
        buffers,
        waveform: new Float32Array(NODE_MONITOR_WAVEFORM_POINTS),
        spectrum: new Float32Array(NODE_MONITOR_SPECTRUM_POINTS),
      });
      count += 1;
    }
  }

  #setupMonitorControlRoutes() {
    const outgoing = new Map();
    for (const edge of this.flattened?.edges ?? []) {
      if (edge.signal !== "control") continue;
      if (!outgoing.has(edge.sourceAddress)) outgoing.set(edge.sourceAddress, []);
      outgoing.get(edge.sourceAddress).push(edge);
    }
    const automatic = [];
    const routeKeys = new Set();
    for (const sourceAddress of this.nodeMonitors.keys()) {
      const sourceMonitor = this.nodeMonitors.get(sourceAddress);
      const sourceRole = String(sourceMonitor?.role ?? "").toLowerCase();
      const fallbackMetric = sourceRole.includes("frequency") || sourceRole.includes("fundamental")
        ? "frequency"
        : "rms";
      const queue = (outgoing.get(sourceAddress) ?? []).map((edge) => ({
        edge,
        metric: monitorMetricForPort(edge.from?.portId, fallbackMetric),
        gain: clamp(edge.gain, 0, 2, 1),
      }));
      const visited = new Set();
      while (queue.length && visited.size < 256) {
        const { edge, metric, gain } = queue.shift();
        const visitKey = `${edge.targetAddress}:${metric}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);
        const routeKey = `${sourceAddress}>${edge.targetAddress}:${metric}`;
        if (!routeKeys.has(routeKey)) {
          routeKeys.add(routeKey);
          automatic.push({ sourceAddress, targetAddress: edge.targetAddress, metric, gain });
        }
        for (const next of outgoing.get(edge.targetAddress) ?? []) {
          queue.push({ edge: next, metric, gain: clamp(gain * finite(next.gain, 1), 0, 2, gain) });
        }
      }
    }
    this.monitorControlRoutes = automatic;
  }

  setMonitorControlRoutes(routes = []) {
    this.manualMonitorControlRoutes = (Array.isArray(routes) ? routes : []).map((route) => ({
      sourceAddress: String(route?.sourceAddress ?? route?.source ?? "master"),
      targetAddress: String(route?.targetAddress ?? route?.target ?? ""),
      metric: String(route?.metric ?? "rms"),
      gain: clamp(route?.gain, 0, 2, 1),
    })).filter(({ targetAddress }) => targetAddress);
    return this.manualMonitorControlRoutes.map((route) => ({ ...route }));
  }

  #rememberControlValue(address, value, source = "control", metadata = {}) {
    if (!address) return;
    const frequencyHz = Number(metadata.frequencyHz);
    this.controlValues.set(address, {
      value: clamp(value, 0, 1, 0),
      source: String(source ?? "control"),
      contextTime: finite(this.context?.currentTime, 0),
      ...(metadata.metric ? { metric: String(metadata.metric) } : {}),
      ...(metadata.sourceAddress ? { sourceAddress: String(metadata.sourceAddress) } : {}),
      ...(Number.isFinite(frequencyHz) ? { frequencyHz } : {}),
    });
  }

  #applyMonitorControlRoutes(snapshot) {
    if (!this.context || !snapshot) return 0;
    const routes = [...this.monitorControlRoutes, ...this.manualMonitorControlRoutes];
    let applied = 0;
    for (const route of routes) {
      const sourceRecord = route.sourceAddress === "master"
        ? snapshot
        : snapshot.byAddress?.[route.sourceAddress];
      const target = this.buses.get(route.targetAddress);
      if (!sourceRecord || !target) continue;
      const value = clamp(
        normalizeMonitorMetric(sourceRecord, route.metric) * finite(route.gain, 1),
        0,
        1,
        0,
      );
      this.#triggerControl(
        {
          signal: "control",
          value,
          address: route.targetAddress,
          source: `monitor:${route.sourceAddress}`,
          sourceAddress: route.sourceAddress,
          metric: route.metric,
          ...(route.metric === "frequency"
            ? { frequencyHz: finite(sourceRecord.dominantFrequencyHz, 0) }
            : {}),
        },
        target,
        finite(this.context.currentTime, 0),
        60 / this.transport.tempo,
      );
      applied += 1;
    }
    return applied;
  }

  #resetRuntimeConverters() {
    this.runtimeEvents.length = 0;
    this.runtimeConverterStates.clear();
    this.runtimeEventSequence = 0;
  }

  #queueRuntimeMidiEvent(flat, messageType, {
    note,
    channel,
    velocity,
    value,
    timestamp,
    frequencyHz,
    monitorAddress,
  } = {}) {
    if (!flat) return null;
    const safeNote = Math.round(clamp(note, 0, 127, 60));
    const safeChannel = Math.round(clamp(channel, 0, 15, 0));
    const safeVelocity = messageType === "noteOff" ? 0 : clamp(velocity, 0, 1, .8);
    const safeValue = finite(value, 0);
    const midi = Object.freeze({
      type: messageType === "noteOff" ? "noteOff" : "noteOn",
      channel: safeChannel,
      note: safeNote,
      velocity: safeVelocity,
    });
    const sequence = this.runtimeEventSequence;
    this.runtimeEventSequence += 1;
    const event = Object.freeze({
      id: `runtime-midi:${sequence}:${flat.address}`,
      runtime: true,
      source: "runtime:audio-analysis",
      signal: "midi",
      playable: false,
      address: flat.address,
      sourceAddress: flat.address,
      graphId: flat.graphId,
      nodeId: flat.node?.id ?? null,
      primitiveId: flat.node?.primitiveId ?? null,
      monitorAddress: monitorAddress ?? null,
      timestamp: finite(timestamp, monitorClock(this.runtime, this.context)),
      contextTime: finite(this.context?.currentTime, 0),
      note: safeNote,
      channel: safeChannel,
      velocity: safeVelocity,
      value: safeValue,
      ...(Number.isFinite(Number(frequencyHz)) ? { frequencyHz: Number(frequencyHz) } : {}),
      message: midi,
      midi,
    });
    this.runtimeEvents.push(event);
    if (this.runtimeEvents.length > MAX_RUNTIME_EVENT_QUEUE) {
      this.runtimeEvents.splice(0, this.runtimeEvents.length - MAX_RUNTIME_EVENT_QUEUE);
    }
    return event;
  }

  #queueAmplitudeConverterEvents(flat, snapshot, timestamp) {
    const monitor = snapshot?.byAddress?.[flat.address];
    if (!monitor) return 0;
    const stateKey = `amplitude-to-midi:${flat.address}`;
    const previous = this.runtimeConverterStates.get(stateKey) ?? { open: false };
    const params = flat.node?.params ?? {};
    const gate = updateAmplitudeGate(previous.open, monitor.rms, {
      openThreshold: params.openThreshold,
      closeThreshold: params.closeThreshold,
    });
    const note = Math.round(clamp(params.note, 0, 127, 60));
    const channel = Math.round(clamp(params.channel, 0, 15, 0));
    this.runtimeConverterStates.set(stateKey, { open: gate.open, note, channel });
    if (!gate.changed) return 0;
    const velocity = gate.open
      ? clamp(params.velocity, 0, 1, Math.max(.01, gate.level))
      : 0;
    this.#queueRuntimeMidiEvent(flat, gate.open ? "noteOn" : "noteOff", {
      note,
      channel,
      velocity,
      value: gate.level,
      timestamp,
      monitorAddress: monitor.address,
    });
    return 1;
  }

  #queueFrequencyConverterEvents(flat, timestamp) {
    const control = this.controlValues.get(flat.address);
    if (!String(control?.source ?? "").startsWith("monitor:")) return 0;
    const params = flat.node?.params ?? {};
    const hasMeasuredFrequency = Object.hasOwn(control, "frequencyHz");
    const minimumHz = Math.max(1, finite(params.minimumHz, 20));
    const maximumHz = Math.max(minimumHz + 1, finite(params.maximumHz, 20_000));
    const frequencyHz = hasMeasuredFrequency
      ? finite(control.frequencyHz, 0)
      : normalizedToFrequency(control.value, { minHz: minimumHz, maxHz: maximumHz });
    const pitch = frequencyHz > 0 ? frequencyToMidiPitch(frequencyHz) : null;
    const stateKey = `frequency-to-midi:${flat.address}`;
    const previous = this.runtimeConverterStates.get(stateKey) ?? { note: null, channel: null };
    const note = pitch?.note ?? null;
    const channel = Math.round(clamp(params.channel, 0, 15, 0));
    if (previous.note === note && previous.channel === channel) return 0;

    let emitted = 0;
    if (previous.note !== null) {
      this.#queueRuntimeMidiEvent(flat, "noteOff", {
        note: previous.note,
        channel: previous.channel ?? channel,
        velocity: 0,
        value: control.value,
        timestamp,
        frequencyHz,
        monitorAddress: control.sourceAddress,
      });
      emitted += 1;
    }
    if (note !== null) {
      this.#queueRuntimeMidiEvent(flat, "noteOn", {
        note,
        channel,
        velocity: clamp(params.velocity, 0, 1, .8),
        value: control.value,
        timestamp,
        frequencyHz,
        monitorAddress: control.sourceAddress,
      });
      emitted += 1;
    }
    this.runtimeConverterStates.set(stateKey, { note, channel, frequencyHz });
    return emitted;
  }

  #queueRuntimeConverterEvents(snapshot, timestamp) {
    let emitted = 0;
    for (const flat of this.flattened?.nodes ?? []) {
      const conversion = flat.primitive?.runtime?.conversion;
      if (conversion === "amplitude-to-midi") {
        emitted += this.#queueAmplitudeConverterEvents(flat, snapshot, timestamp);
      } else if (conversion === "frequency-to-midi") {
        emitted += this.#queueFrequencyConverterEvents(flat, timestamp);
      }
    }
    return emitted;
  }

  #readChannelMonitor(analyser, buffer, fallback) {
    if (!analyser || !buffer || typeof analyser.getFloatTimeDomainData !== "function") return fallback;
    buffer.fill(0);
    try {
      analyser.getFloatTimeDomainData(buffer);
      return waveformRmsPeak(buffer);
    } catch {
      return fallback;
    }
  }

  getMonitorSnapshot({ force = false, driveControls = true } = {}) {
    const sampledAt = monitorClock(this.runtime, this.context);
    if (
      !force
      && this.monitorSnapshotCache
      && sampledAt - this.monitorSampledAt < MONITOR_INTERVAL_MS
    ) return this.monitorSnapshotCache;

    const main = this.monitor && this.monitorBuffers
      ? this.#sampleAnalyser(
        this.monitor,
        this.monitorBuffers,
        this.monitorWaveform,
        this.monitorSpectrum,
      )
      : {
        rms: 0,
        peak: 0,
        dominantFrequencyHz: 0,
        centroidHz: 0,
        bands: Object.fromEntries(Object.keys(MONITOR_BANDS).map((name) => [name, 0])),
      };
    if (!this.monitor) {
      this.monitorWaveform.fill(0);
      this.monitorSpectrum.fill(0);
    }
    const left = this.#readChannelMonitor(
      this.leftMonitor,
      this.monitorBuffers?.left,
      { rms: main.rms, peak: main.peak },
    );
    const right = this.#readChannelMonitor(
      this.rightMonitor,
      this.monitorBuffers?.right,
      { rms: main.rms, peak: main.peak },
    );
    const rms = Math.sqrt((left.rms ** 2 + right.rms ** 2) / 2);
    const peak = Math.max(left.peak, right.peak, main.peak);
    const active = peak >= .001 || rms >= .001;
    const nodes = {};
    const byAddress = {};
    const controls = {};
    for (const monitor of this.nodeMonitors.values()) {
      const sample = monitor.analyser && monitor.buffers
        ? this.#sampleAnalyser(monitor.analyser, monitor.buffers, monitor.waveform, monitor.spectrum)
        : {
          rms: 0,
          peak: 0,
          dominantFrequencyHz: 0,
          centroidHz: 0,
          bands: Object.fromEntries(Object.keys(MONITOR_BANDS).map((name) => [name, 0])),
        };
      const control = this.controlValues.get(monitor.address);
      const role = String(monitor.role).toLowerCase();
      const value = control?.value ?? (
        role.includes("frequency") || role.includes("fundamental")
          ? sample.dominantFrequencyHz
          : role.includes("spectrum") || role.includes("fft")
            ? sample.centroidHz
            : sample.rms
      );
      const record = {
        key: monitor.key,
        address: monitor.address,
        graphId: monitor.graphId,
        nodeId: monitor.nodeId,
        label: monitor.label,
        primitiveId: monitor.primitiveId,
        role: monitor.role,
        value,
        controlValue: control?.value ?? null,
        rms: sample.rms,
        peak: sample.peak,
        active: sample.peak >= .001 || sample.rms >= .001,
        clipped: sample.peak >= .985,
        dominantFrequencyHz: sample.dominantFrequencyHz,
        centroidHz: sample.centroidHz,
        bands: sample.bands,
        waveform: monitor.waveform,
        spectrum: monitor.spectrum,
      };
      nodes[monitor.key] = record;
      byAddress[monitor.address] = record;
      if (control) controls[monitor.key] = {
        key: monitor.key,
        address: monitor.address,
        value: control.value,
        source: control.source,
        contextTime: control.contextTime,
      };
    }
    for (const [address, control] of this.controlValues) {
      if (byAddress[address]) continue;
      const flat = this.flattened?.nodeByAddress?.get(address);
      const key = flat ? `${flat.graphId}:${flat.node.id}` : address;
      controls[key] = { key, address, ...control };
    }
    const contextTime = finite(this.context?.currentTime, 0);
    const beat = this.transport.beat + Math.max(0, contextTime - this.transport.contextTime)
      * this.transport.tempo / 60;
    const snapshot = {
      sampledAt,
      sampleRate: finite(this.context?.sampleRate, 0),
      active,
      clipped: peak >= .985,
      rms,
      peak,
      leftRms: left.rms,
      leftPeak: left.peak,
      rightRms: right.rms,
      rightPeak: right.peak,
      dominantFrequencyHz: active ? main.dominantFrequencyHz : 0,
      centroidHz: active ? main.centroidHz : 0,
      bands: main.bands,
      waveform: this.monitorWaveform,
      spectrum: this.monitorSpectrum,
      activeVoices: this.activeVoices.size,
      tempo: this.transport.tempo,
      beat,
      outputMode: this.context ? this.outputMode : "unprobed",
      recording: this.recordingState(),
      nodes,
      byAddress,
      controls,
    };
    this.monitorSnapshotCache = snapshot;
    this.monitorSampledAt = sampledAt;
    if (driveControls) this.#applyMonitorControlRoutes(snapshot);
    this.#queueRuntimeConverterEvents(snapshot, sampledAt);
    return snapshot;
  }

  monitorSnapshot(options = {}) {
    return this.getMonitorSnapshot(options);
  }

  /**
   * Consume live analyzer-to-MIDI transitions accumulated by monitor sampling.
   * The internal queue drops its oldest entries once MAX_RUNTIME_EVENT_QUEUE is
   * reached, so a suspended UI cannot grow memory without bound.
   */
  drainRuntimeEvents(options = {}) {
    const requested = typeof options === "number"
      ? options
      : options?.maximum ?? options?.limit ?? this.runtimeEvents.length;
    const maximum = Math.max(0, Math.floor(finite(requested, this.runtimeEvents.length)));
    if (!maximum) return [];
    return this.runtimeEvents.splice(0, Math.min(maximum, this.runtimeEvents.length));
  }

  #clearCompiledGraph() {
    this.#resetRuntimeConverters();
    this.#clearNodeMonitors();
    for (const voice of [...this.activeVoices]) {
      try { voice.source?.stop?.(); } catch { /* already stopped */ }
      this.#releaseVoice(voice);
    }
    this.activeVoices.clear();
    for (const oscillator of this.modulators) {
      try { oscillator.stop?.(); } catch { /* already stopped */ }
      safeDisconnect(oscillator);
    }
    this.modulators = [];
    for (const node of this.graphNodes) safeDisconnect(node);
    this.graphNodes = [];
    this.buses.clear();
  }

  #compilePatch() {
    if (!this.context) return;
    this.#clearCompiledGraph();
    if (!this.patch) {
      this.flattened = null;
      return;
    }
    this.flattened = flattenPatch(this.patch, this.patch.rootGraphId);
    this.#applyPatchOutputConfig(this.flattened);
    for (const flat of this.flattened.nodes) {
      const audio = primitiveBus(this.context, flat);
      this.buses.set(flat.address, { audio, control: null, flat });
      this.graphNodes.push(...audio.nodes);
      if (isActiveOutputFlat(flat)) safeConnect(audio.output, this.master);
    }

    for (const edge of this.flattened.edges) {
      const source = this.buses.get(edge.sourceAddress);
      const target = this.buses.get(edge.targetAddress);
      if (!source || !target) continue;
      if (edge.signal === "audio") {
        if (edge.feedback) {
          const delay = this.context.createDelay(.1);
          const gain = this.context.createGain();
          delay.delayTime.value = .01;
          gain.gain.value = clamp(edge.gain, 0, .78, .25);
          safeConnect(source.audio.output, delay);
          safeConnect(delay, gain);
          safeConnect(gain, target.audio.input);
          this.graphNodes.push(delay, gain);
        } else {
          const gain = this.context.createGain();
          gain.gain.value = clamp(edge.gain, 0, 2, 1);
          safeConnect(source.audio.output, gain);
          safeConnect(gain, target.audio.input);
          this.graphNodes.push(gain);
        }
      }
    }
    this.#setupNodeMonitors();
    this.#setupMonitorControlRoutes();
    this.#rebindRecordingTaps();
    for (const address of [...this.controlValues.keys()]) {
      if (!this.flattened.nodeByAddress.has(address)) this.controlValues.delete(address);
    }
  }

  recordingCapabilities() {
    const Recorder = recorderConstructor(this.runtime);
    const hasAudioContext = Boolean(
      this.context
      || this.runtime?.AudioContext
      || this.runtime?.webkitAudioContext
    );
    const streamDestinationKnown = this.context
      ? typeof this.context.createMediaStreamDestination === "function"
      : true;
    const supported = typeof Recorder === "function" && hasAudioContext && streamDestinationKnown;
    const mimeType = recordingMimeType(this.runtime);
    return {
      supported,
      mix: supported,
      stems: supported,
      stereo: true,
      multichannel: false,
      lossless: false,
      mimeType,
      extension: recordingExtension(mimeType),
      maxStems: MAX_RECORDING_STEMS,
      note: supported
        ? "Browser MediaRecorder capture is stereo and uses the browser's compressed audio container."
        : "This browser does not expose stereo MediaRecorder capture for Web Audio.",
    };
  }

  #recordableStemCandidates({ includeFallback = true } = {}) {
    const explicit = [];
    const sounds = [];
    const fallback = [];
    const graphById = new Map((this.patch?.graphs ?? []).map((graph) => [graph.id, graph]));
    for (const flat of this.flattened?.nodes ?? []) {
      const bus = this.buses.get(flat.address);
      if (!bus) continue;
      const params = flat.node?.params ?? {};
      if (isExplicitStemFlat(flat)) {
        explicit.push({
          id: String(params.stemId ?? params.trackId ?? flat.address),
          label: safeLabel(params.stemLabel ?? flat.node?.label, "Stem"),
          address: flat.address,
          graphId: flat.graphId,
          nodeId: flat.node?.id,
          primitiveId: flat.node?.primitiveId ?? "stem",
          explicit: true,
        });
      }
      if (
        flat.node?.type !== "port"
        || flat.node?.direction !== "out"
        || flat.node?.signal !== "audio"
        || !flat.instances?.length
      ) continue;
      const instance = flat.instances.at(-1);
      const child = graphById.get(instance.graphId);
      const candidate = {
        id: `${instance.parentGraphId}:${instance.nodeId}`,
        label: safeLabel(instance.label, child?.label ?? "Graph stem"),
        address: flat.address,
        graphId: instance.parentGraphId,
        nodeId: instance.nodeId,
        childGraphId: instance.graphId,
        primitiveId: instance.deviceId ?? child?.kind ?? "subgraph",
        explicit: false,
      };
      if (["sound", "instrument", "track", "voice"].includes(String(child?.kind ?? "").toLowerCase())) {
        sounds.push(candidate);
      } else {
        fallback.push(candidate);
      }
    }
    const incomingAudio = new Map();
    for (const edge of this.flattened?.edges ?? []) {
      if (edge.signal !== "audio") continue;
      if (!incomingAudio.has(edge.targetAddress)) incomingAudio.set(edge.targetAddress, []);
      incomingAudio.get(edge.targetAddress).push(edge.sourceAddress);
    }
    const markedStemAudio = new Set(explicit.map(({ address }) => address));
    const queue = [...markedStemAudio];
    while (queue.length) {
      const targetAddress = queue.shift();
      for (const sourceAddress of incomingAudio.get(targetAddress) ?? []) {
        if (markedStemAudio.has(sourceAddress)) continue;
        markedStemAudio.add(sourceAddress);
        queue.push(sourceAddress);
      }
    }
    const unmarkedSounds = sounds.filter(({ address }) => !markedStemAudio.has(address));
    const choices = explicit.length || unmarkedSounds.length
      ? [...explicit, ...unmarkedSounds]
      : includeFallback
        ? fallback
        : [];
    const seenIds = new Set();
    const seenAddresses = new Set();
    return choices.filter((candidate) => {
      if (seenIds.has(candidate.id) || seenAddresses.has(candidate.address)) return false;
      seenIds.add(candidate.id);
      seenAddresses.add(candidate.address);
      return true;
    }).slice(0, MAX_RECORDING_STEMS);
  }

  listRecordableStems() {
    return this.#recordableStemCandidates().map((candidate) => ({ ...candidate }));
  }

  #recordingSource(candidate) {
    if (!candidate || candidate.id === "mix") return this.compressor;
    return this.buses.get(candidate.address)?.audio?.output ?? null;
  }

  #releaseRecordingTake(take) {
    if (!take) return;
    if (take.source && take.captureInput) safeDisconnect(take.source, take.captureInput);
    safeDisconnect(take.captureInput);
    safeDisconnect(take.destination);
    for (const track of take.destination?.stream?.getTracks?.() ?? []) {
      try { track.stop?.(); } catch { /* Stream may already be closed. */ }
    }
    take.source = null;
  }

  #makeRecordingTake(candidate, mimeType) {
    if (!this.context || typeof this.context.createMediaStreamDestination !== "function") {
      throw new Error("Web Audio recording destinations are not available in this browser.");
    }
    const Recorder = recorderConstructor(this.runtime);
    if (typeof Recorder !== "function") throw new Error("MediaRecorder is not available in this browser.");
    const destination = this.context.createMediaStreamDestination();
    const captureInput = configureStereoNode(this.context.createGain());
    if (captureInput.gain) captureInput.gain.value = 1;
    safeConnect(captureInput, destination);
    const source = this.#recordingSource(candidate);
    if (!source || !safeConnect(source, captureInput)) {
      safeDisconnect(captureInput);
      safeDisconnect(destination);
      throw new Error(`The ${candidate.label} recording tap could not be connected.`);
    }
    let recorder;
    try {
      recorder = mimeType ? new Recorder(destination.stream, { mimeType }) : new Recorder(destination.stream);
    } catch (error) {
      if (!mimeType) {
        safeDisconnect(source, captureInput);
        safeDisconnect(captureInput);
        safeDisconnect(destination);
        throw error;
      }
      try {
        recorder = new Recorder(destination.stream);
      } catch (fallbackError) {
        safeDisconnect(source, captureInput);
        safeDisconnect(captureInput);
        safeDisconnect(destination);
        for (const track of destination.stream?.getTracks?.() ?? []) track.stop?.();
        throw fallbackError;
      }
    }
    const take = {
      id: candidate.id,
      label: candidate.label,
      address: candidate.address ?? null,
      candidate: { ...candidate },
      source,
      captureInput,
      destination,
      recorder,
      chunks: [],
      error: null,
    };
    recorder.ondataavailable = (event) => {
      if (event?.data && (event.data.size === undefined || event.data.size > 0)) take.chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      take.error = event?.error ?? new Error(`Recording ${take.label} failed.`);
    };
    return take;
  }

  #rebindRecordingTaps() {
    const session = this.recordingSession;
    if (!session?.active) return 0;
    const candidateById = new Map(this.#recordableStemCandidates().map((candidate) => [candidate.id, candidate]));
    let rebound = 0;
    for (const take of session.takes) {
      if (take.id === "mix") continue;
      if (take.source) safeDisconnect(take.source, take.captureInput);
      const candidate = candidateById.get(take.id);
      take.source = candidate ? this.#recordingSource(candidate) : null;
      if (take.source && safeConnect(take.source, take.captureInput)) {
        take.address = candidate.address;
        take.candidate = { ...candidate };
        rebound += 1;
      }
    }
    return rebound;
  }

  async startRecording({ mode = "mix", stemIds } = {}) {
    if (this.recordingSession?.active) throw new Error("A Composer recording is already in progress.");
    await this.start();
    const capabilities = this.recordingCapabilities();
    if (!capabilities.supported) throw new Error(capabilities.note);
    const normalizedMode = mode === "stems" || mode === "stem"
      ? "stems"
      : mode === "both"
        ? "both"
        : "mix";
    const requested = new Set(Array.isArray(stemIds) ? stemIds.map(String) : []);
    const stems = this.#recordableStemCandidates().filter(({ id }) => !requested.size || requested.has(id));
    if ((normalizedMode === "stems" || normalizedMode === "both") && !stems.length) {
      throw new Error("This patch has no recordable audio stems.");
    }
    const candidates = [
      ...(normalizedMode === "mix" || normalizedMode === "both"
        ? [{ id: "mix", label: "Stereo mix", address: null, explicit: true }]
        : []),
      ...(normalizedMode === "stems" || normalizedMode === "both" ? stems : []),
    ];
    const mimeType = capabilities.mimeType;
    const takes = [];
    try {
      for (const candidate of candidates) takes.push(this.#makeRecordingTake(candidate, mimeType));
      for (const take of takes) take.recorder.start();
    } catch (error) {
      for (const take of takes) {
        try { if (take.recorder?.state === "recording") take.recorder.stop(); } catch { /* best effort */ }
        this.#releaseRecordingTake(take);
      }
      throw error;
    }
    this.lastRecording = null;
    this.recordingSession = {
      active: true,
      mode: normalizedMode,
      mimeType,
      startedAt: monitorClock(this.runtime, this.context),
      takes,
    };
    this.monitorSnapshotCache = null;
    return this.recordingState();
  }

  #stopRecorderTake(take) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(take);
      };
      const previousStop = take.recorder.onstop;
      take.recorder.onstop = (event) => {
        try { previousStop?.(event); } catch { /* Observer failures do not strand cleanup. */ }
        finish();
      };
      if (!take.recorder || take.recorder.state === "inactive") {
        finish();
        return;
      }
      try {
        take.recorder.requestData?.();
        take.recorder.stop();
      } catch (error) {
        take.error = take.error ?? error;
        finish();
      }
    });
  }

  async #finishRecording(discard = false) {
    if (this.recordingStopPromise) return this.recordingStopPromise;
    const session = this.recordingSession;
    if (!session) return discard ? null : this.lastRecording;
    session.active = false;
    this.recordingStopPromise = (async () => {
      await Promise.all(session.takes.map((take) => this.#stopRecorderTake(take)));
      const endedAt = monitorClock(this.runtime, this.context);
      const BlobConstructor = this.runtime?.Blob ?? globalThis.Blob;
      const takes = [];
      for (const take of session.takes) {
        const actualMimeType = take.recorder?.mimeType || session.mimeType || "audio/webm";
        if (!discard && !take.error && typeof BlobConstructor === "function") {
          const blob = new BlobConstructor(take.chunks, { type: actualMimeType });
          takes.push({
            id: safeFileId(take.id, "take"),
            sourceId: take.id,
            address: take.address,
            label: take.label,
            blob,
            mimeType: actualMimeType,
            extension: recordingExtension(actualMimeType),
          });
        }
        this.#releaseRecordingTake(take);
      }
      const result = discard ? null : {
        mode: session.mode,
        startedAt: session.startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - session.startedAt),
        takes,
      };
      this.recordingSession = null;
      this.lastRecording = result;
      this.monitorSnapshotCache = null;
      return result;
    })();
    try {
      return await this.recordingStopPromise;
    } finally {
      this.recordingStopPromise = null;
    }
  }

  stopRecording() {
    return this.#finishRecording(false);
  }

  cancelRecording() {
    return this.#finishRecording(true);
  }

  recordingState() {
    const session = this.recordingSession;
    return session ? {
      active: Boolean(session.active),
      stopping: !session.active,
      mode: session.mode,
      startedAt: session.startedAt,
      mimeType: session.mimeType || session.takes[0]?.recorder?.mimeType || "",
      takeCount: session.takes.length,
      stems: session.takes.filter(({ id }) => id !== "mix").map(({ id, label, address }) => ({ id, label, address })),
    } : {
      active: false,
      stopping: false,
      mode: null,
      startedAt: null,
      mimeType: "",
      takeCount: 0,
      stems: [],
    };
  }

  setOutput(value) {
    this.output = clamp(value, 0, .9, .54);
    if (!this.master || !this.context) return;
    const now = finite(this.context.currentTime, 0);
    setParam(this.master.gain, "cancelScheduledValues", now, now);
    if (typeof this.master.gain.setTargetAtTime === "function") this.master.gain.setTargetAtTime(this.output, now, .02);
    else setParam(this.master.gain, "setValueAtTime", this.output, now);
  }

  #releaseVoice(record) {
    if (!record || record.released) return;
    record.released = true;
    this.activeVoices.delete(record);
    safeDisconnect(record.source);
    safeDisconnect(record.gain);
    for (const node of record.nodes ?? []) safeDisconnect(node);
  }

  #admitVoice(record) {
    if (this.activeVoices.size >= MAX_ACTIVE_VOICES) {
      const oldest = this.activeVoices.values().next().value;
      try { oldest?.source?.stop?.(); } catch { /* voice already ended */ }
      this.#releaseVoice(oldest);
    }
    this.activeVoices.add(record);
    record.source.onended = () => this.#releaseVoice(record);
  }

  #noiseBuffer(identity) {
    const sampleRate = Math.max(1, Math.floor(finite(this.context?.sampleRate, 44_100)));
    const key = `${sampleRate}:${identity}`;
    const cached = this.noiseBuffers.get(key);
    if (cached) return cached;
    const frames = Math.max(1, Math.floor(sampleRate * .16));
    const buffer = this.context.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);
    let seed = hashString(`constellation-noise:${key}`) || 1;
    for (let index = 0; index < frames; index += 1) {
      seed = (seed * 16807) % 2147483647;
      data[index] = (seed / 1073741823.5 - 1) * (1 - index / frames);
    }
    this.noiseBuffers.set(key, buffer);
    return buffer;
  }

  #triggerControl(event, bus, startsAt, secondsPerBeat) {
    this.#rememberControlValue(
      event?.address ?? bus?.flat?.address,
      event?.value,
      event?.source ?? "event",
      {
        metric: event?.metric,
        sourceAddress: event?.sourceAddress,
        frequencyHz: event?.frequencyHz,
      },
    );
    const audio = bus?.audio;
    const parameter = audio?.controlParam;
    if (!parameter) return { scheduled: false, skipped: true, reason: "no-control-target", event };
    const normalized = clamp(event.value, 0, 1, .5);
    const base = finite(audio.controlBase, finite(parameter.value, 0));
    const depth = Math.max(0, finite(audio.controlDepth, 0));
    const targetValue = clamp(
      base + (normalized * 2 - 1) * depth,
      finite(audio.controlMinimum, finite(parameter.minValue, -Infinity)),
      finite(audio.controlMaximum, finite(parameter.maxValue, Infinity)),
      base,
    );
    const rampSeconds = clamp(
      Math.max(1 / 64, finite(event.durationBeats, .25)) * secondsPerBeat * .08,
      .003,
      .08,
      .012,
    );
    if (typeof parameter.setTargetAtTime === "function") {
      setParam(parameter, "setTargetAtTime", targetValue, startsAt, rampSeconds);
    } else {
      setParam(parameter, "setValueAtTime", targetValue, startsAt);
    }
    return { scheduled: true, startAt: startsAt, targetValue, event };
  }

  #triggerPitched(event, destination, startsAt, secondsPerBeat) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const sound = String(event.soundId ?? "").toLowerCase();
    oscillator.type = sound.includes("lattice") ? "triangle" : sound.includes("voice") ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(midiNoteToFrequency(clamp(event.note, 0, 127, 60)), startsAt);
    if (sound.includes("spiral") && oscillator.detune) {
      oscillator.detune.setValueAtTime(-7, startsAt);
      oscillator.detune.linearRampToValueAtTime(14, startsAt + Math.max(.08, event.durationBeats * secondsPerBeat));
    }
    const peak = clamp(event.velocity * .18, .018, .24, .12);
    const attackEnd = startsAt + .008;
    const releaseAt = startsAt + Math.max(.04, event.durationBeats * secondsPerBeat);
    gain.gain.setValueAtTime(SILENCE, startsAt);
    gain.gain.linearRampToValueAtTime(peak, attackEnd);
    gain.gain.exponentialRampToValueAtTime(SILENCE, releaseAt);
    safeConnect(oscillator, gain);
    safeConnect(gain, destination);
    oscillator.start(startsAt);
    oscillator.stop(releaseAt + .03);
    this.#admitVoice({ source: oscillator, gain });
    return { scheduled: true, startAt: startsAt, event };
  }

  #triggerDrum(event, destination, startsAt, secondsPerBeat) {
    const identity = hashString(`${event.id}:${event.note}`) % 4;
    if (identity === 0 || event.note < 52) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(120, startsAt);
      oscillator.frequency.exponentialRampToValueAtTime(42, startsAt + .12);
      gain.gain.setValueAtTime(clamp(event.velocity * .42, .04, .55, .32), startsAt);
      gain.gain.exponentialRampToValueAtTime(SILENCE, startsAt + .2);
      safeConnect(oscillator, gain);
      safeConnect(gain, destination);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + .23);
      this.#admitVoice({ source: oscillator, gain });
      return { scheduled: true, startAt: startsAt, event };
    }

    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.#noiseBuffer(identity);
    filter.type = identity === 1 ? "bandpass" : "highpass";
    filter.frequency.value = identity === 1 ? 1_600 : 5_800;
    filter.Q.value = identity === 1 ? 1.8 : .8;
    gain.gain.setValueAtTime(clamp(event.velocity * .25, .025, .36, .2), startsAt);
    gain.gain.exponentialRampToValueAtTime(SILENCE, startsAt + (identity === 1 ? .16 : .07));
    safeConnect(source, filter);
    safeConnect(filter, gain);
    safeConnect(gain, destination);
    source.start(startsAt);
    source.stop(startsAt + .18);
    this.#admitVoice({ source, gain, nodes: [filter] });
    return { scheduled: true, startAt: startsAt, event, secondsPerBeat };
  }

  #triggerHiccupHead(event, destination, startsAt, secondsPerBeat) {
    const oscillator = this.context.createOscillator();
    const breath = this.context.createBufferSource();
    const mouth = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const identity = hashString(event.soundId ?? event.id) % 7;
    const duration = clamp(event.durationBeats * secondsPerBeat, .055, .42, .16);
    const base = midiNoteToFrequency(clamp(event.note, 30, 84, 48));
    oscillator.type = identity % 2 ? "triangle" : "sawtooth";
    oscillator.frequency.setValueAtTime(base * 1.45, startsAt);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, base * .72), startsAt + duration * .72);
    breath.buffer = this.#noiseBuffer(`hiccup-${identity}`);
    if (breath.playbackRate) breath.playbackRate.value = .75 + identity * .07;
    mouth.type = "bandpass";
    mouth.frequency.value = 780 + identity * 235;
    mouth.Q.value = 3.4 + identity * .55;
    const peak = clamp(event.velocity * .22, .025, .3, .14);
    gain.gain.setValueAtTime(SILENCE, startsAt);
    gain.gain.linearRampToValueAtTime(peak, startsAt + .006);
    gain.gain.exponentialRampToValueAtTime(peak * .28, startsAt + duration * .38);
    gain.gain.linearRampToValueAtTime(peak * .62, startsAt + duration * .5);
    gain.gain.exponentialRampToValueAtTime(SILENCE, startsAt + duration);
    safeConnect(oscillator, mouth);
    safeConnect(breath, mouth);
    safeConnect(mouth, gain);
    safeConnect(gain, destination);
    oscillator.start(startsAt);
    breath.start(startsAt);
    oscillator.stop(startsAt + duration + .025);
    breath.stop(startsAt + Math.min(duration, .16));
    this.#admitVoice({ source: oscillator, gain, nodes: [breath, mouth] });
    return { scheduled: true, startAt: startsAt, event, previewEngine: "hiccup-head" };
  }

  #triggerWebGpu303(event, destination, startsAt, secondsPerBeat) {
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const identity = hashString(event.soundId ?? event.id) % 9;
    const duration = clamp(event.durationBeats * secondsPerBeat, .07, .8, .22);
    const frequency = midiNoteToFrequency(clamp(event.note, 24, 96, 36));
    oscillator.type = identity % 3 === 0 ? "square" : "sawtooth";
    oscillator.frequency.setValueAtTime(frequency, startsAt);
    if (oscillator.detune) oscillator.detune.setValueAtTime(identity % 2 ? 5 : -4, startsAt);
    filter.type = "lowpass";
    filter.Q.value = 8 + identity * .75;
    const cutoffPeak = clamp(frequency * (7 + identity * .8), 380, 8_800, 2_600);
    const cutoffFloor = clamp(frequency * 1.35, 90, 1_800, 220);
    filter.frequency.setValueAtTime(cutoffFloor, startsAt);
    filter.frequency.exponentialRampToValueAtTime(cutoffPeak, startsAt + .012);
    filter.frequency.exponentialRampToValueAtTime(cutoffFloor, startsAt + duration);
    const peak = clamp(event.velocity * .2, .025, .28, .13);
    gain.gain.setValueAtTime(SILENCE, startsAt);
    gain.gain.linearRampToValueAtTime(peak, startsAt + .004);
    gain.gain.exponentialRampToValueAtTime(SILENCE, startsAt + duration);
    safeConnect(oscillator, filter);
    safeConnect(filter, gain);
    safeConnect(gain, destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + duration + .025);
    this.#admitVoice({ source: oscillator, gain, nodes: [filter] });
    return { scheduled: true, startAt: startsAt, event, previewEngine: "webgpu-303" };
  }

  async trigger(event, options = {}) {
    const isControl = event?.signal === "control";
    if (!isControl && !event?.playable) return { scheduled: false, skipped: true, reason: "not-playable" };
    if (!isControl && !playableEventHasEnergy(event)) return { scheduled: false, skipped: true, reason: "silent" };
    await this.start();
    const bus = this.buses.get(event?.address);
    if (!bus) return { scheduled: false, skipped: true, reason: "unrouted" };
    const delaySeconds = Math.max(0, finite(options.delaySeconds, 0));
    const secondsPerBeat = Math.max(1 / 1_000, finite(options.secondsPerBeat, 60 / this.transport.tempo));
    const startsAt = finite(this.context.currentTime, 0) + delaySeconds;
    if (isControl) return this.#triggerControl(event, bus, startsAt, secondsPerBeat);
    if (event.instrumentType === "hiccup-head") {
      return this.#triggerHiccupHead(event, bus.audio.input, startsAt, secondsPerBeat);
    }
    if (event.instrumentType === "webgpu-303") {
      return this.#triggerWebGpu303(event, bus.audio.input, startsAt, secondsPerBeat);
    }
    return event.instrumentType === "drums"
      ? this.#triggerDrum(event, bus.audio.input, startsAt, secondsPerBeat)
      : this.#triggerPitched(event, bus.audio.input, startsAt, secondsPerBeat);
  }

  resetControls({ toBase = true } = {}) {
    if (!this.context || this.context.state === "closed") return 0;
    const now = finite(this.context.currentTime, 0);
    let reset = 0;
    for (const { audio } of this.buses.values()) {
      const parameter = audio?.controlParam;
      if (!parameter) continue;
      if (!toBase && typeof parameter.cancelAndHoldAtTime === "function") {
        setParam(parameter, "cancelAndHoldAtTime", now);
      } else {
        const heldValue = finite(parameter.value, finite(audio.controlBase, 0));
        setParam(parameter, "cancelScheduledValues", now);
        setParam(parameter, "setValueAtTime", toBase ? finite(audio.controlBase, heldValue) : heldValue, now);
      }
      reset += 1;
    }
    return reset;
  }

  silence() {
    for (const voice of [...this.activeVoices]) {
      try { voice.source?.stop?.(); } catch { /* already stopped */ }
      this.#releaseVoice(voice);
    }
    this.activeVoices.clear();
  }

  async close() {
    this.started = false;
    this.silence();
    await this.cancelRecording();
    this.#clearCompiledGraph();
    this.#clearOutputRoute();
    this.#clearMonitorGraph();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.flattened = null;
    this.controlValues.clear();
    this.noiseBuffers.clear();
    if (context && context.state !== "closed") await context.close?.();
  }
}
