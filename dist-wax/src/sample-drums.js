import { connectAudioOutput } from "./audio-output-manager.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function cancelledAudioStart() {
  const error = new Error("Sample Drum audio start was cancelled.");
  error.name = "AbortError";
  return error;
}

function setParamValue(param, value, time = 0) {
  if (typeof param?.setValueAtTime === "function") {
    param.setValueAtTime(value, time);
  } else if (param) {
    param.value = value;
  }
}

function linearRamp(param, value, time = 0) {
  if (typeof param?.linearRampToValueAtTime === "function") {
    param.linearRampToValueAtTime(value, time);
  } else {
    setParamValue(param, value, time);
  }
}

function exponentialRamp(param, value, time = 0) {
  if (typeof param?.exponentialRampToValueAtTime === "function") {
    param.exponentialRampToValueAtTime(value, time);
  } else {
    setParamValue(param, value, time);
  }
}

function setTarget(param, value, time = 0, constant = .01) {
  if (typeof param?.setTargetAtTime === "function") {
    param.setTargetAtTime(value, time, constant);
  } else {
    setParamValue(param, value, time);
  }
}

export const SAMPLE_DRUM_SAMPLE_SOURCES = Object.freeze({
  "tr-808": Object.freeze({
    id: "tr-808",
    label: "TR-808",
    packageName: "@fluid-music/tr-808",
    version: "0.0.2",
    baseUrl: "https://unpkg.com/%40fluid-music/tr-808@0.0.2",
    packageUrl: "https://www.npmjs.com/package/%40fluid-music/tr-808",
    licenseSummary: "ISC package; original Hyperreal samples recorded by Michael Fischer with no licensing restrictions noted.",
  }),
  "tr-909": Object.freeze({
    id: "tr-909",
    label: "TR-909",
    packageName: "@fluid-music/tr-909",
    version: "0.0.4",
    baseUrl: "https://unpkg.com/%40fluid-music/tr-909@0.0.4",
    packageUrl: "https://www.npmjs.com/package/%40fluid-music/tr-909",
    licenseSummary: "Original Hyperreal sample text allows free copy/distribution and prohibits distributing the samples for profit.",
  }),
});

const voiceRows = [
  ["808-bd-short", "808 BD Short", "1", "kick", "#ff8a61", "tr-808", "/TR808WAV/BD/BD0025.WAV", .92, 0, .42, .001, .58, 48],
  ["808-bd-long", "808 BD Long", "2", "kick", "#ffad69", "tr-808", "/TR808WAV/BD/BD0050.WAV", .86, 0, .38, .001, .92, 63],
  ["808-snare", "808 Snare", "3", "snare", "#ff7aa6", "tr-808", "/TR808WAV/SD/SD0050.WAV", .78, 0, .62, .001, .34, 176],
  ["909-snare", "909 Snare", "4", "snare", "#de75b8", "tr-909", "/TR909all/ST0T7S7.WAV", .74, 0, .64, .001, .31, 238],
  ["808-low-tom", "808 Low Tom", "q", "tom", "#e8c46b", "tr-808", "/TR808WAV/LT/LT50.WAV", .82, 0, .45, .001, .5, 82],
  ["909-mid-tom", "909 Mid Tom", "w", "tom", "#dbd86b", "tr-909", "/TR909all/MT3D7.WAV", .78, 0, .5, .001, .48, 124],
  ["808-hi-tom", "808 Hi Tom", "e", "tom", "#b8df77", "tr-808", "/TR808WAV/HT/HT50.WAV", .74, 0, .58, .001, .46, 191],
  ["808-closed-hat", "808 Closed Hat", "r", "hat", "#5fe8c4", "tr-808", "/TR808WAV/CH/CH.WAV", .58, 0, .82, .001, .12, 4820],
  ["808-open-hat", "808 Open Hat", "a", "hat", "#55d6d0", "tr-808", "/TR808WAV/OH/OH50.WAV", .56, 0, .78, .001, .5, 4210],
  ["909-rim", "909 Rim", "s", "metal", "#70d8e7", "tr-909", "/TR909all/RIM63.WAV", .62, 0, .7, .001, .09, 510],
  ["808-cowbell", "808 Cowbell", "d", "metal", "#7db4ff", "tr-808", "/TR808WAV/CB/CB.WAV", .64, 0, .67, .001, .44, 563],
  ["909-clap", "909 Clap", "f", "snare", "#91a6ff", "tr-909", "/TR909all/HANDCLP1.WAV", .68, 0, .74, .001, .36, 784],
  ["808-clap", "808 Clap", "z", "snare", "#b299ff", "tr-808", "/TR808WAV/CP/CP.WAV", .64, 0, .72, .001, .48, 1047],
  ["909-ride", "909 Ride", "x", "metal", "#c79bff", "tr-909", "/TR909all/RIDED4.WAV", .54, 0, .68, .001, 1.1, 147],
  ["808-cymbal", "808 Cymbal", "c", "metal", "#e883ee", "tr-808", "/TR808WAV/CY/CY0050.WAV", .52, 0, .78, .001, 1.25, 329],
  ["909-open-hat", "909 Open Hat", "v", "hat", "#ff82c8", "tr-909", "/TR909all/HHOD8.WAV", .58, 0, .84, .001, .55, 927],
];

export const SAMPLE_DRUM_STORAGE_KEY = "morphazoid:sample-drums:bank:v1";

export const DEFAULT_SAMPLE_DRUM_VOICES = Object.freeze(voiceRows.map(([
  id, name, key, family, color, machine, samplePath, level, pitch,
  tone, attack, decay, referenceFrequency,
]) => {
  const source = SAMPLE_DRUM_SAMPLE_SOURCES[machine];
  return Object.freeze({
    id,
    name,
    key,
    family,
    color,
    machine,
    sourceLabel: source.label,
    samplePath,
    url: `${source.baseUrl}${samplePath}`,
    level,
    pitch,
    tone,
    attack,
    decay,
    referenceFrequency,
  });
}));

export function cloneDefaultSampleDrumVoices() {
  return DEFAULT_SAMPLE_DRUM_VOICES.map((voice) => ({ ...voice }));
}

export function sampleRateFromSemitones(semitones) {
  return 2 ** (clamp(finiteOr(semitones, 0), -48, 48) / 12);
}

export function sanitizeSampleDrumVoice(voice = {}) {
  const fallback = DEFAULT_SAMPLE_DRUM_VOICES.find(({ id }) => id === voice.id)
    ?? DEFAULT_SAMPLE_DRUM_VOICES[0];
  const machine = SAMPLE_DRUM_SAMPLE_SOURCES[voice.machine] ? voice.machine : fallback.machine;
  const source = SAMPLE_DRUM_SAMPLE_SOURCES[machine];
  const samplePath = typeof voice.samplePath === "string" && voice.samplePath.startsWith("/")
    ? voice.samplePath
    : fallback.samplePath;
  const url = typeof voice.url === "string" && /^https:\/\/[^ ]+$/i.test(voice.url)
    ? voice.url
    : `${source.baseUrl}${samplePath}`;
  return {
    ...fallback,
    ...voice,
    id: typeof voice.id === "string" ? voice.id : fallback.id,
    name: typeof voice.name === "string" && voice.name.trim() ? voice.name : fallback.name,
    key: typeof voice.key === "string" && voice.key ? voice.key : fallback.key,
    family: typeof voice.family === "string" && voice.family ? voice.family : fallback.family,
    color: typeof voice.color === "string" && voice.color ? voice.color : fallback.color,
    machine,
    sourceLabel: source.label,
    samplePath,
    url,
    level: clamp(finiteOr(voice.level, fallback.level), 0, 1),
    pitch: clamp(finiteOr(voice.pitch, fallback.pitch), -24, 24),
    tone: clamp(finiteOr(voice.tone, fallback.tone), 0, 1),
    attack: clamp(finiteOr(voice.attack, fallback.attack), .001, .25),
    decay: clamp(finiteOr(voice.decay, fallback.decay), .02, 3.5),
    referenceFrequency: clamp(finiteOr(voice.referenceFrequency, fallback.referenceFrequency), 20, 12_000),
  };
}

export function sampleDrumVoiceForFmVoice(sampleVoice, fmVoice = {}) {
  const voice = sanitizeSampleDrumVoice(sampleVoice);
  const frequency = finiteOr(fmVoice.frequency, voice.referenceFrequency);
  const bend = 12 * Math.log2(clamp(frequency, 20, 12_000) / voice.referenceFrequency);
  return sanitizeSampleDrumVoice({
    ...voice,
    pitch: voice.pitch + bend,
    tone: finiteOr(fmVoice.tone, voice.tone),
    level: finiteOr(fmVoice.level, voice.level),
  });
}

export function mappedLatticeSampleDrumVoice(sampleVoice, contact = {}, {
  bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 },
  pitchDepth = 12,
  characterDepth = .7,
  contactCount = 1,
} = {}) {
  const voice = sanitizeSampleDrumVoice(sampleVoice);
  const width = Math.max(1e-9, Number(bounds?.maxX) - Number(bounds?.minX));
  const height = Math.max(1e-9, Number(bounds?.maxY) - Number(bounds?.minY));
  const positionY = clamp((Number(contact?.y) - Number(bounds?.minY)) / height, 0, 1);
  const incidence = clamp(finiteOr(contact?.incidence, 0), 0, 1);
  const character = clamp(finiteOr(characterDepth, .7), 0, 1);
  const headroom = 1 / Math.sqrt(Math.max(1, Number(contactCount) / 5));
  const familyBoost = ["hat", "metal"].includes(voice.family) ? 1.08 : 1;
  const semitones = (positionY * 2 - 1) * clamp(pitchDepth, 0, 24) * .5;

  return sanitizeSampleDrumVoice({
    ...voice,
    pitch: voice.pitch + semitones,
    tone: voice.tone * (1 - character * .38) + incidence * character * .38,
    level: clamp(voice.level * (0.64 + incidence * .48) * headroom * familyBoost, .16, .96),
    decay: voice.decay * (0.92 + incidence * .18),
  });
}

export class SampleDrumAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.input = null;
    this.master = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.output = .72;
    this.lifecycleGeneration = 0;
    this.sampleCache = new Map();
    this.loadedUrls = new Set();
  }

  get loadedSampleCount() {
    return this.loadedUrls.size;
  }

  async start() {
    const lifecycleGeneration = this.lifecycleGeneration;
    let context = this.context;
    if (!context || context.state === "closed") {
      this.releaseAudioOutput?.();
      this.releaseAudioOutput = null;
      this.context = null;
      this.input = null;
      this.master = null;
      this.analyser = null;
      const Context = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      if (!Context) throw new Error("Web Audio is not available in this browser.");
      context = new Context();
      this.context = context;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 10;
      compressor.ratio.value = 7;
      compressor.attack.value = .002;
      compressor.release.value = .16;
      this.master = context.createGain();
      this.master.gain.value = this.output;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      compressor.connect(this.master);
      this.master.connect(this.analyser);
      this.releaseAudioOutput = connectAudioOutput(context, this.analyser, { runtime: this.runtime });
      this.input = compressor;
    }
    if (context.state === "suspended") await context.resume();
    if (
      lifecycleGeneration !== this.lifecycleGeneration
      || context !== this.context
      || context.state === "closed"
    ) throw cancelledAudioStart();
    return context;
  }

  setOutput(value) {
    this.output = clamp(finiteOr(value, 0), 0, .9);
    if (this.master && this.context) {
      setTarget(this.master.gain, this.output, this.context.currentTime, .015);
    }
  }

  async close() {
    this.lifecycleGeneration += 1;
    const context = this.context;
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.input = null;
    this.master = null;
    this.analyser = null;
    if (context && context.state !== "closed" && typeof context.close === "function") {
      await context.close();
    }
  }

  hasBuffer(url) {
    return this.loadedUrls.has(String(url));
  }

  async preload(voices = DEFAULT_SAMPLE_DRUM_VOICES) {
    const urls = [...new Set(voices.map((voice) => sanitizeSampleDrumVoice(voice).url))];
    await Promise.all(urls.map((url) => this.loadBuffer(url)));
    return urls.length;
  }

  async loadBuffer(url) {
    const sampleUrl = String(url || "");
    if (!sampleUrl) throw new Error("Sample URL is missing.");
    if (!this.sampleCache.has(sampleUrl)) {
      const pending = this.#fetchAndDecode(sampleUrl).then((buffer) => {
        this.loadedUrls.add(sampleUrl);
        return buffer;
      }).catch((error) => {
        this.sampleCache.delete(sampleUrl);
        throw error;
      });
      this.sampleCache.set(sampleUrl, pending);
    }
    return this.sampleCache.get(sampleUrl);
  }

  async trigger(sourceVoice) {
    const voice = sanitizeSampleDrumVoice(sourceVoice);
    const context = await this.start();
    const buffer = await this.loadBuffer(voice.url);
    if (context !== this.context || context.state === "closed") {
      throw cancelledAudioStart();
    }
    const now = context.currentTime;
    const rate = sampleRateFromSemitones(voice.pitch);
    const duration = Number(buffer.duration) > 0 ? buffer.duration / rate : voice.decay;
    const stopAt = now + Math.max(.03, Math.min(duration, voice.attack + voice.decay));

    const source = context.createBufferSource();
    source.buffer = buffer;
    setParamValue(source.playbackRate, rate, now);

    const filter = context.createBiquadFilter();
    filter.type = ["hat", "metal"].includes(voice.family) ? "highpass" : "lowpass";
    filter.frequency.value = ["hat", "metal"].includes(voice.family)
      ? 1_200 + voice.tone * 7_800
      : 380 + voice.tone * 10_500;
    filter.Q.value = voice.family === "metal" ? 1.4 : .75;

    const amplitude = context.createGain();
    setParamValue(amplitude.gain, .0001, now);
    linearRamp(amplitude.gain, Math.max(.001, voice.level), now + voice.attack);
    exponentialRamp(amplitude.gain, .0001, stopAt);

    source.connect(filter);
    filter.connect(amplitude);
    amplitude.connect(this.input);
    source.start(now, 0);
    source.stop(stopAt + .02);
    return voice;
  }

  async #fetchAndDecode(sampleUrl) {
    const context = await this.start();
    const fetcher = this.runtime.fetch ?? globalThis.fetch;
    if (typeof fetcher !== "function") throw new Error("Fetch is not available in this browser.");
    const response = await fetcher(sampleUrl);
    if (!response?.ok) {
      const status = response?.status ? ` (${response.status})` : "";
      throw new Error(`Could not load drum sample${status}: ${sampleUrl}`);
    }
    const data = await response.arrayBuffer();
    return await new Promise((resolve, reject) => {
      try {
        const result = context.decodeAudioData(data.slice(0), resolve, reject);
        if (result?.then) result.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }
}
