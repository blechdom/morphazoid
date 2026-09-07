import { connectAudioOutput } from "./audio-output-manager.js";
import { SRTUSS_SHADER_PORTS_A } from "./srtuss-shaders-a.js";
import { SRTUSS_SHADER_PORTS_B } from "./srtuss-shaders-b.js";
import { SRTUSS_SHADER_PORTS_C } from "./srtuss-shaders-c.js";
import { SRTUSS_SHADER_PORTS_D } from "./srtuss-shaders-d.js";
import { makeSrtussMasterWgsl } from "./srtuss-master-shaders.js?v=20260906-parts-1";
import {
  SRTUSS_MIX_PART_ID,
  SRTUSS_MASTER_PARAM_DEFAULTS,
  SRTUSS_MASTER_PARAM_ORDER,
  SRTUSS_MASTER_STEM_DEFAULTS,
  sanitizeSrtussMasterPartId,
  sanitizeSrtussMasterParams,
  sanitizeSrtussMasterStems,
  srtussMasterPartIndex,
} from "./srtuss-master.js?v=20260906-parts-1";

const NUM_CHANNELS = 2;
const VOICE_UNIFORM_BUFFER_SIZE = 256;
const VOICE_MIX_HEADER_FLOATS = 4;
const VOICE_MIX_RECORD_FLOATS = 4;
const VOICE_MIX_BUFFER_SIZE = (VOICE_MIX_HEADER_FLOATS + 16 * VOICE_MIX_RECORD_FLOATS) * 4;
const MAX_BUFFERED_CHUNKS = 2.5;
const OUTPUT_FADE_SECONDS = 0.024;
const LOOP_SEAM_FADE_SECONDS = 0.01;
const PEBBLES_URL = new URL("../assets/srtuss/pebbles.png", import.meta.url);

const SRTUSS_VOICE_MIX_WGSL = `
override WORKGROUP_SIZE: u32 = 256u;
override MAX_VOICES: u32 = 16u;

struct VoiceMix {
  header: vec4<u32>,
  voices: array<vec4<f32>, 16>,
}

@group(0) @binding(0) var<storage, read> voice_samples: array<vec2<f32>>;
@group(0) @binding(1) var<uniform> voice_mix: VoiceMix;
@group(0) @binding(2) var<storage, read_write> sound_output: array<vec2<f32>>;

fn finiteOrZero(value: f32) -> f32 {
  let exponent = bitcast<u32>(value) & 0x7f800000u;
  return select(value, 0.0, exponent == 0x7f800000u);
}

fn mixVoice(value: vec2<f32>, settings: vec4<f32>) -> vec2<f32> {
  if (settings.x <= 0.0) {
    return vec2<f32>(0.0);
  }
  let pan = clamp(settings.y, -1.0, 1.0);
  let balance = vec2<f32>(1.0 - max(pan, 0.0), 1.0 + min(pan, 0.0));
  return value * balance * settings.x;
}

@compute
@workgroup_size(WORKGROUP_SIZE)
fn mixVoices(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let sample = global_id.x;
  if (sample >= arrayLength(&sound_output)) {
    return;
  }
  var mixed = vec2<f32>(0.0);
  let voice_count = min(voice_mix.header.x, MAX_VOICES);
  let voice_stride = voice_mix.header.y;
  for (var voice_index = 0u; voice_index < voice_count; voice_index += 1u) {
    let source_index = voice_index * voice_stride + sample;
    if (source_index < arrayLength(&voice_samples)) {
      mixed += mixVoice(voice_samples[source_index], voice_mix.voices[voice_index]);
    }
  }
  let finite = vec2<f32>(finiteOrZero(mixed.x), finiteOrZero(mixed.y));
  sound_output[sample] = clamp(finite, vec2<f32>(-0.88), vec2<f32>(0.88));
}
`;

const alignTo = (value, alignment) => Math.ceil(value / alignment) * alignment;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const approximatelyEqual = (first, second, epsilon = 1e-7) =>
  Math.abs(finiteOr(first, 0) - finiteOr(second, 0)) <= epsilon;

function isNeutralMasterVoice(voice) {
  if (voice?.mode !== "master") return false;
  if (
    sanitizeSrtussMasterPartId(voice.projectId, voice.partId, voice.mode)
    !== SRTUSS_MIX_PART_ID
  ) {
    return false;
  }
  const params = sanitizeSrtussMasterParams(
    voice.params ?? SRTUSS_MASTER_PARAM_DEFAULTS,
  );
  const stems = sanitizeSrtussMasterStems(
    voice.stems ?? SRTUSS_MASTER_STEM_DEFAULTS,
  );
  return approximatelyEqual(voice.width ?? 1, 1)
    && SRTUSS_MASTER_PARAM_ORDER.every((key) => (
      approximatelyEqual(params[key], SRTUSS_MASTER_PARAM_DEFAULTS[key])
    ))
    && Object.keys(SRTUSS_MASTER_STEM_DEFAULTS).every((key) => (
      approximatelyEqual(stems[key], SRTUSS_MASTER_STEM_DEFAULTS[key])
    ));
}

const profileProject = (id, title, kind, options = {}) => Object.freeze({
  id,
  title,
  kind,
  sourceUrl: "https://www.shadertoy.com/view/" + id,
  ...options,
});

export const SRTUSS_PROFILE_PROJECTS = Object.freeze([
  profileProject("MljSRt", "Chiptune (sound)", "sound"),
  profileProject("XdSGz1", "noir et blanc (sound)", "sound"),
  profileProject("Xd2GW3", "Industry II (sound)", "sound"),
  profileProject("MlBBRG", "Lego Crystal", "image"),
  profileProject("ldlfRS", "Shift (sound)", "sound"),
  profileProject("4tsGD8", "Boulder Dash title (sound)", "sound"),
  profileProject("lldGDM", "Noise Bands (sound)", "sound"),
  profileProject("ltKSRc", "Gravity Shielding (sound)", "sound"),
  profileProject("4sSSWV", "Grinder", "image"),
  profileProject("4tdSDB", "DnB (sound)", "sound"),
  profileProject("MslBR4", "Cipher (sound)", "sound"),
  profileProject("Xtl3zn", "Spacebubbles", "image"),
  profileProject("Wds3z7", "2-edge Wang Tiles", "image"),
  profileProject("4sfBz4", "filip II", "image"),
  profileProject("4sl3Dr", "Digital Brain", "image"),
  profileProject("lss3WS", "Relentless", "image"),
  profileProject("Msf3D7", "Industry", "image"),
  profileProject("MdXGDr", "Data Transfer", "image"),
  profileProject("MdXXW2", "sound - digital ambience", "sound", { sourcePending: true }),
  profileProject("Xd2XDm", "Star Swirl (sound)", "sound", { sourcePending: true }),
  profileProject("Msl3DM", "Crystal Gap", "image"),
  profileProject("4dfGzf", "Tech Tunnel", "image"),
  profileProject("4sBGWG", "Binary Finery", "image"),
  profileProject("ldfSW2", "sound - acid jam", "sound"),
  profileProject("XlsGRs", "jetstream", "image"),
  profileProject("lt23WG", "Stack Trace", "image"),
  profileProject("4ddfWX", "Sanctuary (sound)", "sound", { sourcePending: true }),
]);

const portsById = new Map(
  [
    ...SRTUSS_SHADER_PORTS_A,
    ...SRTUSS_SHADER_PORTS_B,
    ...SRTUSS_SHADER_PORTS_C,
    ...SRTUSS_SHADER_PORTS_D,
  ]
    .map((project) => {
      const masterWgsl = makeSrtussMasterWgsl(project);
      return [project.id, masterWgsl
        ? Object.freeze({ ...project, masterWgsl })
        : project];
    }),
);

export const SRTUSS_PLAYABLE_ORDER = Object.freeze([
  "MljSRt",
  "XdSGz1",
  "Xd2GW3",
  "4tsGD8",
  "ldlfRS",
  "lldGDM",
  "ltKSRc",
  "4tdSDB",
  "MslBR4",
  "ldfSW2",
]);

export const SRTUSS_SOUND_PROJECTS = Object.freeze(
  SRTUSS_PLAYABLE_ORDER.map((id) => {
    const project = portsById.get(id);
    if (!project) throw new Error("Missing exact srtuss Sound port: " + id);
    return project;
  }),
);

export const SRTUSS_PENDING_SOUND_PROJECTS = Object.freeze(
  SRTUSS_PROFILE_PROJECTS.filter(({ kind, sourcePending }) => kind === "sound" && sourcePending),
);

export const SRTUSS_IMAGE_PROJECTS = Object.freeze(
  SRTUSS_PROFILE_PROJECTS.filter(({ kind }) => kind === "image"),
);

export const SRTUSS_DURATION_SECONDS = 60;
export const SRTUSS_CROSSFADE_SECONDS = 0.03;
export const SRTUSS_MAX_VOICES = 16;
export const SRTUSS_VOICE_LIMITS = Object.freeze({
  timeRate: Object.freeze([0.125, 8]),
  level: Object.freeze([0, 1]),
  pan: Object.freeze([-1, 1]),
});
export const SRTUSS_TAPE_RATE_LIMITS = Object.freeze([0.5, 2]);
export const SRTUSS_WORKGROUP_SIZES = Object.freeze([32, 64, 128, 256]);
export const SRTUSS_RUNTIME_DEFAULTS = Object.freeze({
  chunkDuration: 0.1,
  workgroupSize: 256,
  output: 0.82,
  pipelineCacheSize: 20,
});

export function srtussProjectById(id) {
  return portsById.get(String(id)) ?? null;
}

export function srtussProfileProjectById(id) {
  return SRTUSS_PROFILE_PROJECTS.find((project) => project.id === String(id)) ?? null;
}

export function sanitizeSrtussVoices(voices, fallbackProjectId = SRTUSS_PLAYABLE_ORDER[0]) {
  const fallback = srtussProjectById(fallbackProjectId)?.id ?? SRTUSS_PLAYABLE_ORDER[0];
  const source = Array.isArray(voices) && voices.length ? voices : [{}];
  const usedIds = new Set();
  return Object.freeze(source.slice(0, SRTUSS_MAX_VOICES).map((candidate = {}, index) => {
    const voice = candidate && typeof candidate === "object" ? candidate : {};
    const requestedId = String(voice.id ?? `voice-${index + 1}`)
      .trim()
      .replace(/[^a-z0-9_-]+/gi, "-")
      .slice(0, 48);
    const baseId = requestedId || `voice-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    const project = srtussProjectById(voice.projectId) ?? srtussProjectById(fallback);
    const mode = voice.mode === "master" && project?.masterWgsl ? "master" : "original";
    const requestedGroupId = String(voice.groupId ?? id)
      .trim()
      .replace(/[^a-z0-9_-]+/gi, "-")
      .slice(0, 48) || id;
    return Object.freeze({
      id,
      projectId: project?.id ?? fallback,
      mode,
      partId: sanitizeSrtussMasterPartId(project?.id ?? fallback, voice.partId, mode),
      groupId: requestedGroupId,
      enabled: voice.enabled !== false,
      solo: voice.solo === true,
      timeRate: clamp(
        finiteOr(voice.timeRate, 1),
        SRTUSS_VOICE_LIMITS.timeRate[0],
        SRTUSS_VOICE_LIMITS.timeRate[1],
      ),
      level: clamp(
        finiteOr(voice.level, 1),
        SRTUSS_VOICE_LIMITS.level[0],
        SRTUSS_VOICE_LIMITS.level[1],
      ),
      pan: clamp(
        finiteOr(voice.pan, 0),
        SRTUSS_VOICE_LIMITS.pan[0],
        SRTUSS_VOICE_LIMITS.pan[1],
      ),
      width: clamp(finiteOr(voice.width, 1), 0, 1.5),
      params: sanitizeSrtussMasterParams(voice.params ?? SRTUSS_MASTER_PARAM_DEFAULTS),
      stems: sanitizeSrtussMasterStems(voice.stems ?? SRTUSS_MASTER_STEM_DEFAULTS),
    });
  }));
}

export function srtussVoiceMixSettings(voices, fallbackProjectId) {
  const sanitized = sanitizeSrtussVoices(voices, fallbackProjectId);
  const soloed = sanitized.some((voice) => voice.enabled && voice.solo);
  const isAudible = (voice) => voice.enabled && (!soloed || voice.solo);
  const contributes = (voice) => isAudible(voice) && voice.level > 0;

  const groupedVoices = new Map();
  for (const voice of sanitized) {
    if (!contributes(voice)) continue;
    const members = groupedVoices.get(voice.groupId) ?? [];
    members.push(voice);
    groupedVoices.set(voice.groupId, members);
  }

  const logicalPartGroups = new Set();
  for (const [groupId, members] of groupedVoices) {
    const projectId = members[0]?.projectId;
    const partIds = members.map(({ partId }) => partId);
    const validPartGroup = members.every((voice) => (
      voice.mode === "master"
      && voice.projectId === projectId
      && voice.partId !== SRTUSS_MIX_PART_ID
    )) && new Set(partIds).size === partIds.length;
    if (validPartGroup) logicalPartGroups.add(groupId);
  }

  const audibleUnitLevels = new Map();
  for (const voice of sanitized) {
    if (!contributes(voice)) continue;
    const unitId = logicalPartGroups.has(voice.groupId)
      ? "group:" + voice.groupId
      : "voice:" + voice.id;
    const previous = audibleUnitLevels.get(unitId) ?? 0;
    audibleUnitLevels.set(unitId, Math.max(previous, voice.level));
  }
  const levelTotal = [...audibleUnitLevels.values()].reduce((total, level) => total + level, 0);
  const headroom = 1 / Math.max(1, levelTotal);
  return Object.freeze(sanitized.map((voice) => Object.freeze({
    ...voice,
    mixLevel: isAudible(voice) ? voice.level * headroom : 0,
  })));
}

export function sanitizeSrtussRuntime(options = {}) {
  const requestedWorkgroup = Number(options.workgroupSize);
  return Object.freeze({
    chunkDuration: clamp(
      finiteOr(options.chunkDuration, SRTUSS_RUNTIME_DEFAULTS.chunkDuration),
      0.03,
      0.25,
    ),
    workgroupSize: SRTUSS_WORKGROUP_SIZES.includes(requestedWorkgroup)
      ? requestedWorkgroup
      : SRTUSS_RUNTIME_DEFAULTS.workgroupSize,
    output: clamp(finiteOr(options.output, SRTUSS_RUNTIME_DEFAULTS.output), 0, 1),
    pipelineCacheSize: Math.round(clamp(
      finiteOr(options.pipelineCacheSize, SRTUSS_RUNTIME_DEFAULTS.pipelineCacheSize),
      1,
      24,
    )),
  });
}

export function srtussSupport(runtime = globalThis) {
  const audio = Boolean(runtime.AudioContext ?? runtime.webkitAudioContext);
  const webgpu = Boolean(runtime.navigator?.gpu?.requestAdapter);
  return Object.freeze({ audio, webgpu, supported: audio && webgpu });
}

function safeSample(value) {
  return clamp(Number.isFinite(value) ? value : 0, -0.88, 0.88);
}

export function mixSrtussTransition(
  previous,
  next,
  sampleRate,
  duration = SRTUSS_CROSSFADE_SECONDS,
  curve = "equal-power",
) {
  const length = Math.min(previous?.length ?? 0, next?.length ?? 0);
  const result = new Float32Array(length);
  const frames = Math.max(1, Math.min(
    Math.floor(length / NUM_CHANNELS),
    Math.round(Math.max(0, finiteOr(duration, SRTUSS_CROSSFADE_SECONDS)) * sampleRate),
  ));
  for (let index = 0; index < length; index += 1) {
    const frame = Math.floor(index / NUM_CHANNELS);
    if (frame >= frames) {
      result[index] = safeSample(next[index]);
      continue;
    }
    const amount = frames === 1 ? 1 : frame / (frames - 1);
    const oldGain = curve === "linear"
      ? 1 - amount
      : Math.cos(amount * Math.PI * 0.5);
    const newGain = curve === "linear"
      ? amount
      : Math.sin(amount * Math.PI * 0.5);
    result[index] = safeSample(safeSample(previous[index]) * oldGain + safeSample(next[index]) * newGain);
  }
  return result;
}

export function fadeSrtussHead(samples, sampleRate, duration = LOOP_SEAM_FADE_SECONDS) {
  const frameCount = Math.floor((samples?.length ?? 0) / NUM_CHANNELS);
  const fadeFrames = Math.max(0, Math.min(
    frameCount,
    Math.round(Math.max(0, finiteOr(duration, LOOP_SEAM_FADE_SECONDS)) * sampleRate),
  ));
  if (!fadeFrames) return samples;
  for (let frame = 0; frame < fadeFrames; frame += 1) {
    const amount = fadeFrames === 1 ? 1 : frame / (fadeFrames - 1);
    const gain = Math.sin(amount * Math.PI * 0.5);
    const index = frame * NUM_CHANNELS;
    for (let channel = 0; channel < NUM_CHANNELS; channel += 1) {
      samples[index + channel] = safeSample(samples[index + channel]) * gain;
    }
  }
  return samples;
}

function setParamValue(param, value, time = 0) {
  if (typeof param?.setValueAtTime === "function") param.setValueAtTime(value, time);
  else if (param) param.value = value;
}

function setTarget(param, value, time = 0, constant = 0.015) {
  if (typeof param?.setTargetAtTime === "function") param.setTargetAtTime(value, time, constant);
  else setParamValue(param, value, time);
}

function holdParamAtTime(param, time) {
  if (!param) return;
  if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(time);
  else if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(time);
    setParamValue(param, finiteOr(param.value, 0), time);
  }
}

function rampToZero(param, time, duration) {
  if (!param) return;
  holdParamAtTime(param, time);
  if (typeof param.linearRampToValueAtTime === "function") {
    param.linearRampToValueAtTime(0, time + duration);
  } else {
    setTarget(param, 0, time, duration / 7);
  }
}

function requireGpuConstants(runtime) {
  const usage = runtime.GPUBufferUsage ?? globalThis.GPUBufferUsage;
  const textureUsage = runtime.GPUTextureUsage ?? globalThis.GPUTextureUsage;
  const mapMode = runtime.GPUMapMode ?? globalThis.GPUMapMode;
  if (!usage || !textureUsage || !mapMode) {
    throw new Error("WebGPU constants are not available in this browser.");
  }
  return { usage, textureUsage, mapMode };
}

function createAbortError(message) {
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function createTextureStagingCanvas(runtime, width, height) {
  const OffscreenCanvasCtor = runtime.OffscreenCanvas ?? globalThis.OffscreenCanvas;
  if (typeof OffscreenCanvasCtor === "function") {
    return new OffscreenCanvasCtor(width, height);
  }
  const documentRef = runtime.document ?? globalThis.document;
  const canvas = documentRef?.createElement?.("canvas");
  if (!canvas) throw new Error("Texture pixel staging is unavailable.");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function stageFlippedTexturePixels(runtime, bitmap) {
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = createTextureStagingCanvas(runtime, width, height);
  const context = canvas.getContext?.("2d", {
    alpha: true,
    willReadFrequently: true,
  });
  if (!context?.drawImage || !context?.getImageData) {
    throw new Error("Texture pixel staging is unavailable.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  const source = context.getImageData(0, 0, width, height).data;
  const bytesPerRow = width * 4;
  const expectedLength = bytesPerRow * height;
  if (source.byteLength !== expectedLength) {
    throw new Error("Texture pixel staging returned an unexpected byte count.");
  }
  const pixels = new Uint8Array(expectedLength);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (height - row - 1) * bytesPerRow;
    pixels.set(source.subarray(sourceOffset, sourceOffset + bytesPerRow), row * bytesPerRow);
  }
  return { width, height, bytesPerRow, pixels };
}

export class SrtussAudio {
  constructor(runtime = globalThis, options = {}) {
    const settings = sanitizeSrtussRuntime(options);
    this.runtime = runtime;
    this.chunkDurationInSeconds = settings.chunkDuration;
    this.workgroupSize = settings.workgroupSize;
    this.output = settings.output;
    this.pipelineCacheSize = settings.pipelineCacheSize;
    const initialProjectId = srtussProjectById(options.projectId)?.id ?? SRTUSS_PLAYABLE_ORDER[0];
    this.voiceConfig = sanitizeSrtussVoices(options.voices, initialProjectId);
    this.selectedProjectId = this.voiceConfig[0].projectId;
    this.context = null;
    this.ownsContext = false;
    this.input = null;
    this.master = null;
    this.releaseAudioOutput = null;
    this.device = null;
    this.timeInfoBuffer = null;
    this.voiceTimeBuffers = [];
    this.voiceChunkBuffer = null;
    this.voiceChunkStride = 0;
    this.voiceMixBuffer = null;
    this.voiceMixPipeline = null;
    this.voiceMixBindGroup = null;
    this.chunkBuffer = null;
    this.chunkMapBuffer = null;
    this.channelTexture = null;
    this.channelSampler = null;
    this.chunkNumSamplesPerChannel = 0;
    this.chunkNumSamples = 0;
    this.chunkBufferSize = 0;
    this.sampleRate = 44100;
    this.activeRenderer = null;
    this.pendingRenderer = null;
    this.activeVoices = [];
    this.pendingVoices = null;
    this.pendingStartOffset = null;
    this.pendingTransitionKind = null;
    this.pipelineCache = new Map();
    this.pipelinePromises = new Map();
    this.lifecycleEpoch = 0;
    this.selectionGeneration = 0;
    this.pauseGeneration = 0;
    this.timelineGeneration = 0;
    this.renderSampleOffset = 0;
    this.renderTransportSample = 0;
    this.nextStartTime = 0;
    this.timeoutId = null;
    this.renderingPromise = null;
    this.gpuRenderTail = Promise.resolve();
    this.stopPromise = null;
    this.ready = false;
    this.running = false;
    this.playbackEnabled = false;
    this.restarting = false;
    this.sources = new Set();
    this.scheduledChunks = [];
    this.onError = null;
    this.onStatus = null;
  }

  get activeProject() {
    return this.activeRenderer?.project ?? srtussProjectById(this.selectedProjectId);
  }

  setErrorHandler(handler) {
    this.onError = typeof handler === "function" ? handler : null;
  }

  setStatusHandler(handler) {
    this.onStatus = typeof handler === "function" ? handler : null;
  }

  emitStatus(kind, project = this.activeProject, detail = "") {
    this.onStatus?.(Object.freeze({ kind, project, detail }));
  }

  async start(options = {}) {
    if (this.stopPromise) await this.stopPromise;
    if (this.context) await this.stop();
    const support = srtussSupport(this.runtime);
    const externalContext = options.context ?? options.audioContext ?? null;
    if (!externalContext && !support.audio) {
      throw new Error("Web Audio buffer playback is not available in this browser.");
    }
    if (!support.webgpu) throw new Error("WebGPU is not available in this browser.");

    const epoch = ++this.lifecycleEpoch;
    try {
      this.ownsContext = !externalContext;
      if (externalContext) this.context = externalContext;
      else {
        const AudioContextCtor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
        this.context = new AudioContextCtor();
      }
      if (
        this.ownsContext
        && this.context.state === "suspended"
        && typeof this.context.resume === "function"
      ) {
        await this.context.resume();
      }
      if (epoch !== this.lifecycleEpoch) throw createAbortError("srtuss audio start was superseded.");
      this.sampleRate = this.context.sampleRate;
      const initialTransportSample = Number.isFinite(Number(options.transportSeconds))
        ? Math.max(0, Math.round(Number(options.transportSeconds) * this.sampleRate))
        : Number.isFinite(Number(options.transportSample))
          ? Math.max(0, Math.round(Number(options.transportSample)))
          : this.normalizeSampleOffset(
            Math.round(finiteOr(options.offset, 0) * this.sampleRate),
          );
      this.createAudioGraph(options.destination ?? null);
      await this.initGpu(epoch);
      let voices;
      while (true) {
        const requestedVoices = this.voiceConfig;
        const selectionGeneration = this.selectionGeneration;
        voices = await this.ensureVoiceRenderers(requestedVoices, epoch, {
          anchorTransportSample: initialTransportSample,
          preserveFrom: [],
          initialPhases: options.voicePhases,
        });
        if (
          requestedVoices === this.voiceConfig
          && selectionGeneration === this.selectionGeneration
        ) break;
      }
      this.activateVoices(voices);
      if (epoch !== this.lifecycleEpoch) throw createAbortError("srtuss audio start was superseded.");
      this.renderTransportSample = initialTransportSample;
      this.renderSampleOffset = this.normalizeSampleOffset(initialTransportSample);
      this.ready = true;
      this.setOutput(this.output);
      await this.setPlaybackEnabled(options.autoStart === true);
      this.emitStatus("ready", this.activeRenderer.project);
      return this.context;
    } catch (error) {
      if (epoch === this.lifecycleEpoch) await this.stop({ fade: false }).catch(() => {});
      throw error;
    }
  }

  createAudioGraph(destination = null) {
    if (!this.context) return;
    this.input = this.context.createGain();
    this.master = this.context.createGain();
    this.input.gain.value = 1;
    this.master.gain.value = 0;
    this.input.connect(this.master);
    if (destination) {
      this.master.connect(destination);
      this.releaseAudioOutput = () => {
        try { this.master?.disconnect?.(destination); } catch { /* Already disconnected. */ }
      };
    } else {
      this.releaseAudioOutput = connectAudioOutput(this.context, this.master, { runtime: this.runtime });
    }
  }

  async initGpu(epoch = this.lifecycleEpoch) {
    if (!this.context) throw new Error("Audio must be initialized before WebGPU.");
    const { usage, textureUsage } = requireGpuConstants(this.runtime);
    const adapter = await this.runtime.navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter was found.");
    const device = await adapter.requestDevice();
    if (epoch !== this.lifecycleEpoch) {
      device.destroy?.();
      throw createAbortError("WebGPU initialization was superseded.");
    }
    this.device = device;
    device.lost?.then((info) => {
      if (this.device !== device || epoch !== this.lifecycleEpoch) return;
      this.handleRenderError(new Error(
        "WebGPU device lost" + (info?.message ? ": " + info.message : "."),
      ));
    });
    this.chunkNumSamplesPerChannel = Math.max(
      128,
      Math.round(this.sampleRate * this.chunkDurationInSeconds),
    );
    this.chunkNumSamples = this.chunkNumSamplesPerChannel * NUM_CHANNELS;
    this.chunkBufferSize = this.chunkNumSamples * Float32Array.BYTES_PER_ELEMENT;
    const storageAlignment = Math.max(
      256,
      Number(device.limits?.minStorageBufferOffsetAlignment) || 256,
    );
    this.voiceChunkStride = alignTo(this.chunkBufferSize, storageAlignment);
    this.voiceTimeBuffers = Array.from({ length: SRTUSS_MAX_VOICES }, (_, index) => device.createBuffer({
      label: `srtuss voice ${index + 1} time`,
      size: VOICE_UNIFORM_BUFFER_SIZE,
      usage: usage.UNIFORM | usage.COPY_DST,
    }));
    this.timeInfoBuffer = this.voiceTimeBuffers[0];
    this.voiceChunkBuffer = device.createBuffer({
      label: "srtuss voice scratch arena",
      size: this.voiceChunkStride * SRTUSS_MAX_VOICES,
      usage: usage.STORAGE,
    });
    this.voiceMixBuffer = device.createBuffer({
      label: "srtuss voice mix",
      size: VOICE_MIX_BUFFER_SIZE,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    this.chunkBuffer = device.createBuffer({
      label: "srtuss mixed samples",
      size: this.chunkBufferSize,
      usage: usage.STORAGE | usage.COPY_SRC,
    });
    this.chunkMapBuffer = device.createBuffer({
      size: this.chunkBufferSize,
      usage: usage.MAP_READ | usage.COPY_DST,
    });
    this.channelTexture = device.createTexture({
      label: "srtuss Pebbles iChannel0",
      size: [512, 512, 1],
      format: "rgba8unorm",
      usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST,
    });
    this.channelSampler = device.createSampler({
      addressModeU: "repeat",
      addressModeV: "repeat",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
    });
    await this.loadPebblesTexture(device, epoch);
    await this.initVoiceMixer(device, epoch);
  }

  async loadPebblesTexture(device, epoch) {
    const fetchImpl = this.runtime.fetch ?? globalThis.fetch;
    const createBitmap = this.runtime.createImageBitmap ?? globalThis.createImageBitmap;
    if (!fetchImpl || !createBitmap) throw new Error("Texture image loading is unavailable.");
    const response = await fetchImpl(PEBBLES_URL);
    if (!response.ok) throw new Error("Could not load the pinned Pebbles channel asset.");
    const blob = await response.blob();
    let bitmap;
    try {
      bitmap = await createBitmap(blob, {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      });
    } catch {
      try {
        bitmap = await createBitmap(blob, { colorSpaceConversion: "none" });
      } catch {
        bitmap = await createBitmap(blob);
      }
    }
    try {
      if (this.device !== device || epoch !== this.lifecycleEpoch) {
        throw createAbortError("Texture upload was superseded.");
      }
      const upload = stageFlippedTexturePixels(this.runtime, bitmap);
      device.queue.writeTexture(
        { texture: this.channelTexture },
        upload.pixels,
        {
          bytesPerRow: upload.bytesPerRow,
          rowsPerImage: upload.height,
        },
        [upload.width, upload.height, 1],
      );
      await device.queue.onSubmittedWorkDone?.();
    } finally {
      bitmap.close?.();
    }
  }

  async initVoiceMixer(device, epoch) {
    const module = device.createShaderModule({
      label: "srtuss voice mixer",
      code: SRTUSS_VOICE_MIX_WGSL,
    });
    if (typeof module.getCompilationInfo === "function") {
      const info = await module.getCompilationInfo();
      const errors = info.messages?.filter(({ type }) => type === "error") ?? [];
      if (errors.length) {
        throw new Error(
          "srtuss voice mixer WGSL failed: "
          + errors.map(({ lineNum, message }) => "line " + lineNum + ": " + message).join("; "),
        );
      }
    }
    const descriptor = {
      label: "srtuss voice mixer pipeline",
      layout: "auto",
      compute: {
        module,
          entryPoint: "mixVoices",
          constants: {
            WORKGROUP_SIZE: this.workgroupSize,
            MAX_VOICES: SRTUSS_MAX_VOICES,
          },
      },
    };
    const pipeline = typeof device.createComputePipelineAsync === "function"
      ? await device.createComputePipelineAsync(descriptor)
      : device.createComputePipeline(descriptor);
    if (this.device !== device || epoch !== this.lifecycleEpoch) {
      throw createAbortError("Voice mixer initialization was superseded.");
    }
    this.voiceMixPipeline = pipeline;
    this.voiceMixBindGroup = device.createBindGroup({
      label: "srtuss voice mixer bindings",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.voiceChunkBuffer } },
        { binding: 1, resource: { buffer: this.voiceMixBuffer } },
        { binding: 2, resource: { buffer: this.chunkBuffer } },
      ],
    });
  }

  async ensureRenderer(projectId, epoch = this.lifecycleEpoch, mode = "original") {
    const project = srtussProjectById(projectId);
    if (!project) throw new Error("Unknown or unavailable srtuss Sound project: " + projectId);
    const rendererMode = mode === "master" && project.masterWgsl ? "master" : "original";
    const cacheKey = `${project.id}:${rendererMode}`;
    const cached = this.pipelineCache.get(cacheKey);
    if (cached) {
      this.pipelineCache.delete(cacheKey);
      this.pipelineCache.set(cacheKey, cached);
      return cached;
    }
    const existing = this.pipelinePromises.get(cacheKey);
    if (existing) return existing;
    const device = this.device;
    if (
      !device
      || this.voiceTimeBuffers.length !== SRTUSS_MAX_VOICES
      || !this.voiceChunkBuffer
      || !this.chunkBuffer
      || !this.channelTexture
      || !this.channelSampler
    ) {
      throw new Error("WebGPU renderer is not initialized.");
    }

    const promise = (async () => {
      this.emitStatus("compiling", project);
      const module = device.createShaderModule({
        label: `srtuss ${project.id} ${rendererMode} Sound`,
        code: rendererMode === "master" ? project.masterWgsl : project.wgsl,
      });
      if (typeof module.getCompilationInfo === "function") {
        const info = await module.getCompilationInfo();
        const errors = info.messages?.filter(({ type }) => type === "error") ?? [];
        if (errors.length) {
          throw new Error(
            project.title + " WGSL failed: "
            + errors.map(({ lineNum, message }) => "line " + lineNum + ": " + message).join("; "),
          );
        }
      }
      const descriptor = {
        label: `srtuss ${project.id} ${rendererMode} pipeline`,
        layout: "auto",
        compute: {
          module,
          entryPoint: "synthesize",
          constants: {
            SAMPLE_RATE: this.sampleRate,
            WORKGROUP_SIZE: this.workgroupSize,
          },
        },
      };
      const pipeline = typeof device.createComputePipelineAsync === "function"
        ? await device.createComputePipelineAsync(descriptor)
        : device.createComputePipeline(descriptor);
      if (this.device !== device || epoch !== this.lifecycleEpoch) {
        throw createAbortError("Shader compilation was superseded.");
      }
      const layout = pipeline.getBindGroupLayout(0);
      const textureView = this.channelTexture.createView();
      const makeBindGroup = (label, timeBuffer, outputBuffer, outputOffset = 0) => device.createBindGroup({
        label,
        layout,
        entries: [
          { binding: 0, resource: { buffer: timeBuffer } },
          {
            binding: 1,
            resource: { buffer: outputBuffer, offset: outputOffset, size: this.chunkBufferSize },
          },
          { binding: 2, resource: textureView },
          { binding: 3, resource: this.channelSampler },
        ],
      });
      const bindGroup = makeBindGroup(
        "srtuss " + project.id + " direct bindings",
        this.voiceTimeBuffers[0],
        this.chunkBuffer,
      );
      const voiceBindGroups = Object.freeze(this.voiceTimeBuffers.map((timeBuffer, index) => (
        makeBindGroup(
          `srtuss ${project.id} ${rendererMode} voice ${index + 1} bindings`,
          timeBuffer,
          this.voiceChunkBuffer,
          this.voiceChunkStride * index,
        )
      )));
      return Object.freeze({
        project,
        mode: rendererMode,
        cacheKey,
        pipeline,
        bindGroup,
        voiceBindGroups,
        device,
        epoch,
      });
    })();
    this.pipelinePromises.set(cacheKey, promise);
    try {
      const renderer = await promise;
      if (this.device !== device || epoch !== this.lifecycleEpoch) {
        throw createAbortError("Shader compilation was superseded.");
      }
      this.pipelineCache.set(cacheKey, renderer);
      this.trimPipelineCache();
      return renderer;
    } finally {
      if (this.pipelinePromises.get(cacheKey) === promise) this.pipelinePromises.delete(cacheKey);
    }
  }

  currentVoiceSet() {
    if (this.activeVoices.length) return this.activeVoices;
    if (!this.activeRenderer) return [];
    const fallback = sanitizeSrtussVoices([{
      id: "voice-1",
      projectId: this.activeRenderer.project?.id ?? this.selectedProjectId,
    }], this.selectedProjectId)[0];
    return [Object.freeze({
      ...fallback,
      renderer: this.activeRenderer,
      anchorTransportSample: 0,
      anchorSourceSample: 0,
    })];
  }

  voiceSourcePosition(voice, transportSample) {
    const elapsed = finiteOr(transportSample, 0) - finiteOr(voice.anchorTransportSample, 0);
    return this.normalizeSourcePosition(
      finiteOr(voice.anchorSourceSample, 0) + elapsed * finiteOr(voice.timeRate, 1),
    );
  }

  rebaseVoicesAtTransport(voices, previous, transportSample) {
    return Object.freeze(voices.map((voice) => {
      const active = previous.find(({ id, projectId }) => (
        id === voice.id && projectId === voice.projectId
      ));
      if (!active) return voice;
      return Object.freeze({
        ...voice,
        anchorTransportSample: transportSample,
        anchorSourceSample: this.voiceSourcePosition(active, transportSample),
      });
    }));
  }

  resetVoiceAnchors(voices) {
    return Object.freeze(voices.map((voice) => Object.freeze({
      ...voice,
      anchorTransportSample: 0,
      anchorSourceSample: 0,
    })));
  }

  sameVoiceSources(first, second) {
    return first.length === second.length && first.every((voice, index) => {
      const candidate = second[index];
      const voicePartId = sanitizeSrtussMasterPartId(
        voice.projectId, voice.partId, voice.mode,
      );
      const candidatePartId = sanitizeSrtussMasterPartId(
        candidate?.projectId, candidate?.partId, candidate?.mode,
      );
      if (
        voice.id !== candidate?.id
        || voice.projectId !== candidate?.projectId
        || voicePartId !== candidatePartId
      ) return false;
      if (voice.mode === candidate.mode) return true;
      return approximatelyEqual(voice.timeRate ?? 1, candidate.timeRate ?? 1)
        && (isNeutralMasterVoice(voice) || isNeutralMasterVoice(candidate));
    });
  }

  async ensureVoiceRenderers(voices, epoch = this.lifecycleEpoch, options = {}) {
    const sanitized = sanitizeSrtussVoices(voices, this.selectedProjectId);
    const renderers = await Promise.all(
      sanitized.map(({ projectId, mode }) => this.ensureRenderer(projectId, epoch, mode)),
    );
    const anchorTransportSample = finiteOr(
      options.anchorTransportSample,
      this.renderTransportSample,
    );
    const preserveFrom = Array.isArray(options.preserveFrom)
      ? options.preserveFrom
      : this.currentVoiceSet();
    const initialPhases = Array.isArray(options.initialPhases)
      ? options.initialPhases
      : [];
    return Object.freeze(sanitized.map((voice, index) => {
      const phaseSourceId = options.phaseSources?.[voice.id] ?? voice.id;
      const previous = options.restart === true
        ? null
        : preserveFrom.find(({ id, projectId }) => (
          id === phaseSourceId && projectId === voice.projectId
        ));
      const initialPhase = previous || options.restart === true
        ? null
        : initialPhases.find((phase) => (
          phase
          && phase.id === voice.id
          && phase.projectId === voice.projectId
          && (
            Number.isFinite(Number(phase.sourceSeconds))
            || Number.isFinite(Number(phase.sourceSample))
          )
        ));
      const restoredSourceSample = initialPhase
        ? Number.isFinite(Number(initialPhase.sourceSeconds))
          ? Number(initialPhase.sourceSeconds) * this.sampleRate
          : Number(initialPhase.sourceSample) * (
            Number.isFinite(Number(initialPhase.sampleRate))
              && Number(initialPhase.sampleRate) > 0
              ? this.sampleRate / Number(initialPhase.sampleRate)
              : 1
          )
        : 0;
      return Object.freeze({
        ...voice,
        renderer: renderers[index],
        anchorTransportSample: previous || initialPhase ? anchorTransportSample : 0,
        anchorSourceSample: previous
          ? this.voiceSourcePosition(previous, anchorTransportSample)
          : initialPhase
            ? this.normalizeSourcePosition(restoredSourceSample)
            : 0,
      });
    }));
  }

  voiceSetsEqual(first, second) {
    if (first.length !== second.length) return false;
    return first.every((voice, index) => {
      const candidate = second[index];
      return Boolean(
        candidate
        && voice.renderer === candidate.renderer
        && voice.id === candidate.id
        && voice.projectId === candidate.projectId
        && voice.mode === candidate.mode
        && voice.partId === candidate.partId
        && voice.groupId === candidate.groupId
        && voice.enabled === candidate.enabled
        && voice.solo === candidate.solo
        && voice.timeRate === candidate.timeRate
        && voice.level === candidate.level
        && voice.pan === candidate.pan
        && voice.width === candidate.width
        && SRTUSS_MASTER_PARAM_ORDER.every((key) => (
          voice.params?.[key] === candidate.params?.[key]
        ))
        && Object.keys(SRTUSS_MASTER_STEM_DEFAULTS).every((key) => (
          voice.stems?.[key] === candidate.stems?.[key]
        ))
      );
    });
  }

  activateVoices(voices) {
    this.activeVoices = Object.freeze([...voices]);
    this.activeRenderer = this.activeVoices[0]?.renderer ?? null;
    this.pendingVoices = null;
    this.pendingRenderer = null;
    this.pendingStartOffset = null;
    this.pendingTransitionKind = null;
  }

  trimPipelineCache() {
    const protectedIds = new Set([
      ...this.currentVoiceSet().map(({ renderer, projectId, mode }) => (
        renderer?.cacheKey ?? `${projectId}:${mode ?? "original"}`
      )),
      ...(this.pendingVoices ?? []).map(({ renderer, projectId, mode }) => (
        renderer?.cacheKey ?? `${projectId}:${mode ?? "original"}`
      )),
      ...this.pipelinePromises.keys(),
    ]);
    while (this.pipelineCache.size > this.pipelineCacheSize) {
      const removable = [...this.pipelineCache.keys()].find((id) => !protectedIds.has(id));
      if (!removable) return;
      this.pipelineCache.delete(removable);
    }
  }

  async setVoices(voices, options = {}) {
    if (this.stopPromise) throw createAbortError("Sound selection cannot start during shutdown.");
    const nextConfig = sanitizeSrtussVoices(voices, this.selectedProjectId);
    const generation = ++this.selectionGeneration;
    this.pendingVoices = null;
    this.pendingRenderer = null;
    this.pendingStartOffset = null;
    this.pendingTransitionKind = null;
    if (!this.device) {
      this.voiceConfig = nextConfig;
      this.selectedProjectId = nextConfig[0].projectId;
      return nextConfig;
    }
    const epoch = this.lifecycleEpoch;
    let nextVoices;
    try {
      nextVoices = await this.ensureVoiceRenderers(nextConfig, epoch, {
        anchorTransportSample: options.restart === true ? 0 : undefined,
        preserveFrom: options.restart === true ? [] : this.currentVoiceSet(),
        restart: options.restart === true,
        phaseSources: options.phaseSources,
      });
    } catch (error) {
      if (
        generation !== this.selectionGeneration
        || epoch !== this.lifecycleEpoch
        || this.stopPromise
      ) {
        throw createAbortError("Sound selection was superseded.");
      }
      throw error;
    }
    if (
      generation !== this.selectionGeneration
      || epoch !== this.lifecycleEpoch
      || nextVoices.some(({ renderer }) => renderer.device !== this.device)
    ) {
      throw createAbortError("Sound selection was superseded.");
    }
    this.voiceConfig = nextConfig;
    this.selectedProjectId = nextConfig[0].projectId;
    const project = srtussProjectById(this.selectedProjectId);
    if (!this.running) {
      this.activateVoices(nextVoices);
      if (options.restart === true) {
        this.renderTransportSample = 0;
        this.renderSampleOffset = 0;
      }
      this.emitStatus(options.projectSelection ? "selected" : "voices-updated", project);
    } else if (!this.voiceSetsEqual(nextVoices, this.currentVoiceSet())) {
      this.pendingVoices = nextVoices;
      this.pendingRenderer = nextVoices[0]?.renderer !== this.activeRenderer
        ? nextVoices[0]?.renderer ?? null
        : null;
      this.pendingStartOffset = options.restart === true ? 0 : null;
      this.pendingTransitionKind = options.projectSelection ? "switched" : "voices-switched";
      this.emitStatus(options.projectSelection ? "queued" : "voices-queued", project);
    } else {
      this.pendingVoices = null;
      this.pendingRenderer = null;
      this.pendingStartOffset = null;
      this.pendingTransitionKind = null;
      this.emitStatus(options.projectSelection ? "selected" : "voices-updated", project);
    }
    this.trimPipelineCache();
    return nextConfig;
  }

  async selectProject(projectId, options = {}) {
    const project = srtussProjectById(projectId);
    if (!project) throw new Error("Unknown or unavailable srtuss Sound project: " + projectId);
    const current = sanitizeSrtussVoices(this.voiceConfig, this.selectedProjectId);
    const primary = current[0];
    const next = [
      { ...primary, projectId: project.id },
      ...current.slice(1),
    ];
    await this.setVoices(next, {
      restart: options.restart !== false,
      projectSelection: true,
    });
    return project;
  }

  setOutput(value) {
    this.output = clamp(finiteOr(value, SRTUSS_RUNTIME_DEFAULTS.output), 0, 1);
    this.applyOutputGain();
  }

  async setPlaybackEnabled(enabled) {
    const next = Boolean(enabled);
    this.playbackEnabled = next;
    const generation = ++this.pauseGeneration;
    this.applyOutputGain();
    if (next) {
      const context = this.context;
      if (
        context
        && context.state !== "running"
        && typeof context.resume === "function"
      ) {
        await context.resume();
      }
      if (
        generation !== this.pauseGeneration
        || !this.playbackEnabled
        || !this.ready
        || this.restarting
        || context !== this.context
      ) return;
      this.startTimeline();
      return;
    }
    if (!this.running) return;
    const setTimer = this.runtime.setTimeout ?? globalThis.setTimeout;
    setTimer(() => {
      if (generation !== this.pauseGeneration || this.playbackEnabled || !this.running) return;
      this.pauseTimeline();
    }, Math.ceil(OUTPUT_FADE_SECONDS * 1000));
  }

  applyOutputGain() {
    if (!this.master || !this.context) return;
    if (this.playbackEnabled && !this.restarting) {
      holdParamAtTime(this.master.gain, this.context.currentTime);
      setTarget(this.master.gain, this.output, this.context.currentTime, 0.012);
    } else {
      rampToZero(this.master.gain, this.context.currentTime, OUTPUT_FADE_SECONDS);
    }
  }

  normalizeSampleOffset(offset) {
    const durationSamples = Math.max(1, Math.round(this.sampleRate * SRTUSS_DURATION_SECONDS));
    return ((Math.round(finiteOr(offset, 0)) % durationSamples) + durationSamples) % durationSamples;
  }

  normalizeSourcePosition(position) {
    const durationSamples = Math.max(1, Math.round(this.sampleRate * SRTUSS_DURATION_SECONDS));
    const finite = finiteOr(position, 0);
    return ((finite % durationSamples) + durationSamples) % durationSamples;
  }

  startTimeline() {
    if (
      !this.context
      || !this.input
      || !this.activeRenderer
      || !this.ready
      || this.running
      || this.restarting
    ) return;
    this.running = true;
    this.nextStartTime = this.context.currentTime + 0.045;
    this.queueFill();
  }

  currentPlaybackSampleOffset(atTime = this.context?.currentTime) {
    return this.normalizeSampleOffset(this.currentPlaybackTransportSample(atTime));
  }

  currentPlaybackTransportSample(atTime = this.context?.currentTime) {
    if (!this.context || !Number.isFinite(atTime)) return finiteOr(
      this.renderTransportSample,
      this.renderSampleOffset,
    );
    const chunks = this.scheduledChunks;
    const active = chunks.find(({ startAt, endAt }) => atTime >= startAt && atTime < endAt);
    if (active) {
      return active.offset + Math.round((atTime - active.startAt) * this.sampleRate);
    }
    const next = chunks.find(({ startAt }) => startAt > atTime);
    if (next) return next.offset;
    return finiteOr(this.renderTransportSample, this.renderSampleOffset);
  }

  snapshotVoicePhases(transportSample = this.currentPlaybackTransportSample()) {
    const atTransportSample = Math.max(0, finiteOr(transportSample, 0));
    return Object.freeze(this.currentVoiceSet().map((voice) => {
      const sourceSample = this.voiceSourcePosition(voice, atTransportSample);
      return Object.freeze({
        id: voice.id,
        projectId: voice.projectId,
        sourceSeconds: sourceSample / this.sampleRate,
      });
    }));
  }

  alignStoppedTransport(offsetSeconds = 0) {
    if (!this.ready || this.running || this.sources.size) {
      throw createAbortError("srtuss transport can only align while ready and stopped.");
    }
    const transportSample = Math.max(
      0,
      Math.round(finiteOr(offsetSeconds, 0) * this.sampleRate),
    );
    const active = this.activeVoices;
    this.activeVoices = this.rebaseVoicesAtTransport(
      active,
      active,
      transportSample,
    );
    if (this.pendingVoices) {
      const pending = this.pendingVoices;
      this.pendingVoices = this.rebaseVoicesAtTransport(
        pending,
        pending,
        transportSample,
      );
    }
    this.activeRenderer = this.activeVoices[0]?.renderer ?? this.activeRenderer;
    this.pendingRenderer = this.pendingVoices?.[0]?.renderer ?? null;
    this.renderTransportSample = transportSample;
    this.renderSampleOffset = this.normalizeSampleOffset(transportSample);
    this.nextStartTime = 0;
    return transportSample;
  }

  async restart(offsetSeconds = 0) {
    if (!this.ready) throw createAbortError("srtuss audio is not ready.");
    const generation = ++this.timelineGeneration;
    this.restarting = true;
    this.running = false;
    this.clearQueueTimer();
    this.applyOutputGain();
    if (this.context && this.sources.size) {
      const setTimer = this.runtime.setTimeout ?? globalThis.setTimeout;
      await new Promise((resolve) => setTimer(resolve, Math.ceil(OUTPUT_FADE_SECONDS * 1000)));
    }
    if (generation !== this.timelineGeneration) return;
    this.stopScheduledSources(this.context?.currentTime);
    this.renderSampleOffset = this.normalizeSampleOffset(offsetSeconds * this.sampleRate);
    this.renderTransportSample = this.renderSampleOffset;
    this.activeVoices = this.resetVoiceAnchors(this.currentVoiceSet());
    this.activeRenderer = this.activeVoices[0]?.renderer ?? this.activeRenderer;
    if (this.pendingVoices) {
      this.pendingVoices = this.resetVoiceAnchors(this.pendingVoices);
      this.pendingRenderer = this.pendingVoices[0]?.renderer !== this.activeRenderer
        ? this.pendingVoices[0]?.renderer ?? null
        : null;
    }
    this.nextStartTime = 0;
    this.restarting = false;
    this.applyOutputGain();
    if (this.playbackEnabled) this.startTimeline();
  }

  queueFill(delay = 0) {
    if (!this.running || this.renderingPromise || this.timeoutId !== null) return;
    const setTimer = this.runtime.setTimeout ?? globalThis.setTimeout;
    this.timeoutId = setTimer(() => {
      this.timeoutId = null;
      const task = this.fillBuffer()
        .catch((error) => this.handleRenderError(error))
        .finally(() => {
          if (this.renderingPromise === task) {
            this.renderingPromise = null;
            if (this.running) this.queueFill(this.chunkDurationInSeconds * 220);
          }
        });
      this.renderingPromise = task;
    }, Math.max(0, delay));
  }

  async fillBuffer() {
    if (!this.context || !this.input || !this.activeRenderer) return;
    const timelineGeneration = this.timelineGeneration;
    const horizon = this.chunkDurationInSeconds * MAX_BUFFERED_CHUNKS + 0.05;
    while (
      this.running
      && this.context
      && this.input
      && (this.nextStartTime - this.context.currentTime) < horizon
    ) {
      const chunkOffset = this.renderTransportSample;
      const renderedChunk = await this.renderActiveChunk(chunkOffset, timelineGeneration);
      const chunkData = renderedChunk.data;
      const playbackOffset = renderedChunk.offset;
      if (
        timelineGeneration !== this.timelineGeneration
        || !this.running
        || !this.context
        || !this.input
      ) return;
      const intendedStartTime = this.nextStartTime;
      const startAt = Math.max(this.context.currentTime + 0.012, intendedStartTime);
      if (
        intendedStartTime > 0
        && startAt - intendedStartTime > 0.002
      ) {
        fadeSrtussHead(chunkData, this.sampleRate);
      }
      const audioBuffer = this.context.createBuffer(
        NUM_CHANNELS,
        this.chunkNumSamplesPerChannel,
        this.sampleRate,
      );
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      for (let sample = 0; sample < audioBuffer.length; sample += 1) {
        left[sample] = chunkData[sample * NUM_CHANNELS];
        right[sample] = chunkData[sample * NUM_CHANNELS + 1];
      }
      const source = this.context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.input);
      const endAt = startAt + audioBuffer.duration;
      source.onended = () => {
        this.sources.delete(source);
        this.scheduledChunks = this.scheduledChunks.filter((chunk) => chunk.source !== source);
      };
      this.sources.add(source);
      this.scheduledChunks.push({
        source,
        offset: playbackOffset,
        startAt,
        endAt,
        duration: audioBuffer.duration,
      });
      source.start(startAt);
      this.nextStartTime = endAt;
      this.renderTransportSample = playbackOffset + this.chunkNumSamplesPerChannel;
      this.renderSampleOffset = this.normalizeSampleOffset(this.renderTransportSample);
    }
  }

  async renderActiveChunk(offset, timelineGeneration = this.timelineGeneration) {
    const previous = this.currentVoiceSet();
    const pending = this.pendingVoices;
    const oldData = await this.renderTimelineChunk(previous, offset);
    if (!pending) return { data: oldData, offset };
    const pendingOffset = this.pendingStartOffset ?? offset;
    const restarted = this.pendingStartOffset === 0;
    const transitionedVoices = restarted
      ? this.resetVoiceAnchors(pending)
      : this.rebaseVoicesAtTransport(pending, previous, pendingOffset);
    const newData = await this.renderTimelineChunk(transitionedVoices, pendingOffset);
    if (
      this.pendingVoices !== pending
      || timelineGeneration !== this.timelineGeneration
    ) return { data: oldData, offset };
    const transitionKind = this.pendingTransitionKind ?? "voices-switched";
    const project = transitionedVoices[0]?.renderer.project;
    const transitionCurve = this.sameVoiceSources(previous, transitionedVoices)
      ? "linear"
      : "equal-power";
    this.activateVoices(transitionedVoices);
    this.emitStatus(transitionKind, project, restarted ? "restart" : "continuous");
    this.trimPipelineCache();
    return {
      data: mixSrtussTransition(
        oldData,
        newData,
        this.sampleRate,
        SRTUSS_CROSSFADE_SECONDS,
        transitionCurve,
      ),
      offset: pendingOffset,
    };
  }

  async renderProjectChunk(projectId, offset = 0) {
    if (!this.ready || this.stopPromise) {
      throw createAbortError("srtuss audio is not ready for rendering.");
    }
    const epoch = this.lifecycleEpoch;
    const renderer = await this.ensureRenderer(projectId, epoch);
    if (!this.ready || this.stopPromise || epoch !== this.lifecycleEpoch) {
      throw createAbortError("srtuss audio rendering was superseded.");
    }
    return this.renderTimelineChunk(renderer, this.normalizeSampleOffset(offset));
  }

  async renderVoicesChunk(voices, offset = 0) {
    if (!this.ready || this.stopPromise) {
      throw createAbortError("srtuss audio is not ready for rendering.");
    }
    const epoch = this.lifecycleEpoch;
    const voiceSet = await this.ensureVoiceRenderers(voices, epoch, {
      anchorTransportSample: 0,
      preserveFrom: [],
    });
    if (!this.ready || this.stopPromise || epoch !== this.lifecycleEpoch) {
      throw createAbortError("srtuss audio rendering was superseded.");
    }
    return this.renderTimelineChunk(voiceSet, finiteOr(offset, 0));
  }

  async renderTimelineChunk(rendererOrVoices, offset) {
    const result = new Float32Array(this.chunkNumSamples);
    const durationSamples = Math.max(1, Math.round(this.sampleRate * SRTUSS_DURATION_SECONDS));
    const transportStart = Math.round(finiteOr(offset, 0));
    const isVoiceSet = Array.isArray(rendererOrVoices);
    let writtenFrames = 0;
    while (writtenFrames < this.chunkNumSamplesPerChannel) {
      const transportCursor = transportStart + writtenFrames;
      const wrappedCursor = this.normalizeSampleOffset(transportCursor);
      const available = durationSamples - wrappedCursor;
      const needed = this.chunkNumSamplesPerChannel - writtenFrames;
      const take = Math.min(available, needed);
      const rendered = isVoiceSet
        ? await this.renderGpuVoices(rendererOrVoices, transportCursor)
        : await this.renderGpuChunk(rendererOrVoices, wrappedCursor);
      const destinationStart = writtenFrames * NUM_CHANNELS;
      result.set(rendered.subarray(0, take * NUM_CHANNELS), destinationStart);
      writtenFrames += take;
    }
    return result;
  }

  async renderGpuChunk(renderer, sampleOffset) {
    const job = this.gpuRenderTail.then(() => this.performGpuRender(renderer, sampleOffset));
    this.gpuRenderTail = job.catch(() => {});
    return job;
  }

  async renderGpuVoices(voices, transportSample) {
    const snapshot = Object.freeze([...voices]);
    const job = this.gpuRenderTail.then(() => (
      this.performGpuVoiceRender(snapshot, transportSample)
    ));
    this.gpuRenderTail = job.catch(() => {});
    return job;
  }

  writeVoiceTime(buffer, sampleOffset, timeRate, voice = {}) {
    const bytes = new ArrayBuffer(VOICE_UNIFORM_BUFFER_SIZE);
    const integers = new Uint32Array(bytes);
    const floats = new Float32Array(bytes);
    const params = sanitizeSrtussMasterParams(voice.params ?? SRTUSS_MASTER_PARAM_DEFAULTS);
    const stems = sanitizeSrtussMasterStems(voice.stems ?? SRTUSS_MASTER_STEM_DEFAULTS);
    const sourcePosition = this.normalizeSourcePosition(sampleOffset);
    const sourceSample = Math.floor(sourcePosition);
    integers[0] = sourceSample;
    integers[1] = 0;
    floats[2] = clamp(
      finiteOr(timeRate, 1),
      SRTUSS_VOICE_LIMITS.timeRate[0],
      SRTUSS_VOICE_LIMITS.timeRate[1],
    );
    floats[3] = sourcePosition - sourceSample;
    floats[4] = params.tune;
    floats[5] = params.shape;
    floats[6] = params.brightness;
    floats[7] = params.contour;
    floats[8] = params.pattern;
    floats[9] = params.motion;
    floats[10] = params.noise;
    floats[11] = params.space;
    floats[12] = params.drive;
    floats[13] = stems.tone;
    floats[14] = stems.bass;
    floats[15] = stems.percussion;
    floats[16] = stems.texture;
    floats[17] = stems.fx;
    floats[18] = finiteOr(voice.width, 1);
    floats[19] = srtussMasterPartIndex(voice.projectId, voice.partId, voice.mode);
    this.device.queue.writeBuffer(buffer, 0, bytes);
  }

  async performGpuRender(renderer, sampleOffset) {
    const voice = Object.freeze({
      ...sanitizeSrtussVoices([{
        id: "render-project",
        projectId: renderer.project.id,
      }], renderer.project.id)[0],
      renderer,
      anchorTransportSample: 0,
      anchorSourceSample: 0,
    });
    return this.performGpuVoiceRender([voice], sampleOffset);
  }

  async performGpuVoiceRender(voices, transportSample) {
    if (
      !this.device
      || voices.some(({ renderer }) => (
        renderer.device !== this.device || renderer.epoch !== this.lifecycleEpoch
      ))
      || this.voiceTimeBuffers.length !== SRTUSS_MAX_VOICES
      || !this.voiceChunkBuffer
      || !this.voiceChunkStride
      || !this.voiceMixBuffer
      || !this.voiceMixPipeline
      || !this.voiceMixBindGroup
      || !this.chunkBuffer
      || !this.chunkMapBuffer
    ) {
      throw new Error("WebGPU renderer is not initialized.");
    }
    const { mapMode } = requireGpuConstants(this.runtime);
    const mixSettings = srtussVoiceMixSettings(
      voices,
      voices[0]?.projectId ?? this.selectedProjectId,
    );
    const prepared = voices.map((voice, index) => Object.freeze({
      ...voice,
      mixLevel: mixSettings[index]?.mixLevel ?? 0,
    }));
    const audible = prepared.filter(({ mixLevel }) => mixLevel > 0);
    const directVoice = audible.length === 1
      && audible[0].mixLevel === 1
      && audible[0].pan === 0
      ? audible[0]
      : null;
    const encoder = this.device.createCommandEncoder();
    const workgroups = Math.ceil(this.chunkNumSamplesPerChannel / this.workgroupSize);
    if (directVoice) {
      this.writeVoiceTime(
        this.voiceTimeBuffers[0],
        this.voiceSourcePosition(directVoice, transportSample),
        directVoice.timeRate,
        directVoice,
      );
      const pass = encoder.beginComputePass();
      pass.setPipeline(directVoice.renderer.pipeline);
      pass.setBindGroup(0, directVoice.renderer.bindGroup);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    } else {
      const sourcePass = audible.length ? encoder.beginComputePass() : null;
      for (const voice of audible) {
        const slot = prepared.indexOf(voice);
        this.writeVoiceTime(
          this.voiceTimeBuffers[slot],
          this.voiceSourcePosition(voice, transportSample),
          voice.timeRate,
          voice,
        );
        sourcePass.setPipeline(voice.renderer.pipeline);
        sourcePass.setBindGroup(0, voice.renderer.voiceBindGroups[slot]);
        sourcePass.dispatchWorkgroups(workgroups);
      }
      sourcePass?.end();
      const mixBytes = new ArrayBuffer(VOICE_MIX_BUFFER_SIZE);
      const mixIntegers = new Uint32Array(mixBytes);
      const mixValues = new Float32Array(mixBytes);
      mixIntegers[0] = prepared.length;
      mixIntegers[1] = this.voiceChunkStride / (Float32Array.BYTES_PER_ELEMENT * NUM_CHANNELS);
      mixIntegers[2] = this.chunkNumSamplesPerChannel;
      for (let index = 0; index < prepared.length; index += 1) {
        const record = VOICE_MIX_HEADER_FLOATS + index * VOICE_MIX_RECORD_FLOATS;
        mixValues[record] = prepared[index].mixLevel;
        mixValues[record + 1] = prepared[index].pan;
      }
      this.device.queue.writeBuffer(this.voiceMixBuffer, 0, mixBytes);
      const mixPass = encoder.beginComputePass();
      mixPass.setPipeline(this.voiceMixPipeline);
      mixPass.setBindGroup(0, this.voiceMixBindGroup);
      mixPass.dispatchWorkgroups(workgroups);
      mixPass.end();
    }
    encoder.copyBufferToBuffer(
      this.chunkBuffer,
      0,
      this.chunkMapBuffer,
      0,
      this.chunkBufferSize,
    );
    this.device.queue.submit([encoder.finish()]);
    await this.chunkMapBuffer.mapAsync(mapMode.READ, 0, this.chunkBufferSize);
    const data = new Float32Array(this.chunkNumSamples);
    try {
      data.set(new Float32Array(
        this.chunkMapBuffer.getMappedRange(0, this.chunkBufferSize),
      ));
    } finally {
      this.chunkMapBuffer.unmap();
    }
    return data;
  }

  clearQueueTimer() {
    const clearTimer = this.runtime.clearTimeout ?? globalThis.clearTimeout;
    if (this.timeoutId !== null) clearTimer(this.timeoutId);
    this.timeoutId = null;
  }

  stopScheduledSources(when = this.context?.currentTime) {
    for (const source of this.sources) {
      try { source.stop?.(when); } catch { /* Source already ended. */ }
    }
    this.sources.clear();
    this.scheduledChunks = [];
  }

  pauseTimeline() {
    if (!this.running && this.scheduledChunks.length === 0) return;
    this.timelineGeneration += 1;
    this.renderTransportSample = this.currentPlaybackTransportSample();
    this.renderSampleOffset = this.normalizeSampleOffset(this.renderTransportSample);
    this.running = false;
    this.clearQueueTimer();
    this.stopScheduledSources(this.context?.currentTime);
    this.nextStartTime = 0;
  }

  handleRenderError(error) {
    this.playbackEnabled = false;
    this.running = false;
    this.timelineGeneration += 1;
    this.clearQueueTimer();
    this.applyOutputGain();
    const generation = ++this.pauseGeneration;
    const setTimer = this.runtime.setTimeout ?? globalThis.setTimeout;
    setTimer(() => {
      if (generation === this.pauseGeneration) {
        this.renderTransportSample = this.currentPlaybackTransportSample();
        this.renderSampleOffset = this.normalizeSampleOffset(this.renderTransportSample);
        this.stopScheduledSources(this.context?.currentTime);
        this.nextStartTime = 0;
      }
    }, Math.ceil(OUTPUT_FADE_SECONDS * 1000));
    this.onError?.(error);
  }

  stop(options = {}) {
    if (this.stopPromise) return this.stopPromise;
    this.ready = false;
    const run = Promise.resolve().then(() => this.performStop(options));
    let pending;
    pending = run.finally(() => {
      if (this.stopPromise === pending) this.stopPromise = null;
    });
    this.stopPromise = pending;
    return pending;
  }

  async performStop({ fade = true } = {}) {
    const context = this.context;
    const shouldFade = Boolean(fade && context && this.master && this.sources.size);
    this.lifecycleEpoch += 1;
    this.selectionGeneration += 1;
    this.pauseGeneration += 1;
    this.timelineGeneration += 1;
    this.playbackEnabled = false;
    this.applyOutputGain();
    this.running = false;
    this.clearQueueTimer();
    if (shouldFade) {
      const setTimer = this.runtime.setTimeout ?? globalThis.setTimeout;
      await new Promise((resolve) => setTimer(resolve, Math.ceil(OUTPUT_FADE_SECONDS * 1000)));
    }
    this.renderTransportSample = this.currentPlaybackTransportSample(context?.currentTime);
    this.renderSampleOffset = this.normalizeSampleOffset(this.renderTransportSample);
    this.stopScheduledSources(context?.currentTime);
    if (this.renderingPromise) await this.renderingPromise.catch(() => {});
    this.renderingPromise = null;
    await this.gpuRenderTail.catch(() => {});
    const pendingPipelines = [...this.pipelinePromises.values()];
    this.pipelinePromises.clear();
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.input = null;
    this.master = null;
    this.destroyGpuResources();
    await Promise.allSettled(pendingPipelines);
    if (
      this.ownsContext
      && context
      && context.state !== "closed"
      && typeof context.close === "function"
    ) {
      await context.close();
    }
    this.ownsContext = false;
    this.restarting = false;
  }

  destroyGpuResources() {
    const buffers = new Set([
      ...this.voiceTimeBuffers,
      this.voiceChunkBuffer,
      this.voiceMixBuffer,
      this.chunkBuffer,
      this.chunkMapBuffer,
    ]);
    for (const buffer of buffers) {
      try { buffer?.destroy?.(); } catch { /* Browser may reject a mapped buffer. */ }
    }
    try { this.channelTexture?.destroy?.(); } catch { /* Already released. */ }
    try { this.device?.destroy?.(); } catch { /* Device.destroy is optional. */ }
    this.device = null;
    this.timeInfoBuffer = null;
    this.voiceTimeBuffers = [];
    this.voiceChunkBuffer = null;
    this.voiceChunkStride = 0;
    this.voiceMixBuffer = null;
    this.voiceMixPipeline = null;
    this.voiceMixBindGroup = null;
    this.chunkBuffer = null;
    this.chunkMapBuffer = null;
    this.channelTexture = null;
    this.channelSampler = null;
    this.activeRenderer = null;
    this.pendingRenderer = null;
    this.activeVoices = [];
    this.pendingVoices = null;
    this.pendingStartOffset = null;
    this.pendingTransitionKind = null;
    this.pipelineCache.clear();
    this.pipelinePromises.clear();
    this.gpuRenderTail = Promise.resolve();
  }
}
