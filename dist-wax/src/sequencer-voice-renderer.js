import {
  createSimdSynthConfiguration, createSimdSynthKernelViews, writeSimdSynthConfiguration,
} from "./simd-synth.js";
import {
  createSimd303Configuration, createSimd303KernelViews, writeSimd303Configuration,
} from "./simd-303.js";
import { linearDrumParameters } from "./instruments/linear-drums/linear-drums.js";
import { generateKarplusStrongSamples } from "./instruments/karplus-strong/karplus-strong.js";

/** Chiptune uses the real SIMD Synth vector oscillator and bit-crush shaper.
 * It is a new playable patch, not a claim to port the WebGPU Chiptune score. */
export const SEQUENCER_VOICES = Object.freeze([
  { id: "simd-chiptune", label: "SIMD Chiptune", kind: "synth", engine: "simd-synth" },
  { id: "simd-303", label: "SIMD 303", kind: "synth", engine: "simd-303" },
  { id: "simd-synth", label: "SIMD Synth", kind: "synth", engine: "simd-synth" },
  { id: "soft-fm", label: "Soft FM kit", kind: "percussion", engine: "native" },
  { id: "analog", label: "Analog kit", kind: "percussion", engine: "native" },
  { id: "modal", label: "Modal kit", kind: "percussion", engine: "native" },
  { id: "noise", label: "Noise kit", kind: "percussion", engine: "native" },
  { id: "rattlesnake", label: "Rattlesnake · Modal + FM", kind: "percussion", engine: "native" },
  { id: "pitched-morph", label: "Mallets · Pitched Morph", kind: "percussion", engine: "native" },
  { id: "karplus-strong", label: "Karplus Strong · plucked", kind: "percussion", engine: "native" },
  { id: "sine", label: "Sine", kind: "synth", engine: "native" },
].map(Object.freeze));
const BY_ID = new Map(SEQUENCER_VOICES.map((voice) => [voice.id, voice]));
export const sequencerVoice = (id) => BY_ID.get(id) ?? BY_ID.get("simd-chiptune");
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const TAU = Math.PI * 2;

export async function loadSequencerVoiceKernels(runtime = globalThis, { forceScalar = false } = {}) {
  const wasm = runtime.WebAssembly ?? globalThis.WebAssembly;
  const result = { synth: null, acid: null, backends: {}, failures: [] };
  for (const [key, filename, views] of [
    ["synth", "simd-synth", createSimdSynthKernelViews],
    ["acid", "simd-303", createSimd303KernelViews],
  ]) {
    for (const backend of forceScalar ? ["scalar"] : ["simd", "scalar"]) {
      try {
        if (!wasm || !runtime.fetch) throw new Error("WebAssembly loading is unavailable");
        const url = new URL(`../assets/wasm/${filename}-${backend}.wasm`, import.meta.url);
        const response = await runtime.fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (!wasm.validate(bytes)) throw new Error(`${backend} binary is unsupported`);
        const { instance } = await wasm.instantiate(bytes);
        result[key] = views(instance);
        result.backends[key] = backend;
        break;
      } catch (error) {
        if (backend === "scalar") result.failures.push(`${filename}: ${error.message}`);
      }
    }
    if (!result[key]) result.backends[key] = "native-fallback";
  }
  return result;
}

function rng(seed) {
  let state = (seed >>> 0) || 17011;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Remove DC and match energy without amplifying near-silent buffers. */
function normalize(samples, peakLimit = .65) {
  let mean = 0;
  for (let i = 0; i < samples.length; i += 1) mean += Number.isFinite(samples[i]) ? samples[i] : 0;
  mean /= samples.length || 1;
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Number.isFinite(samples[i]) ? samples[i] - mean : 0;
    samples[i] = value;
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  const gain = Math.min(12, .18 / Math.max(.001, rms), peakLimit / Math.max(.001, peak));
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
  return samples;
}

function synthPatch(voice, brightness) {
  const chip = voice === "simd-chiptune";
  return createSimdSynthConfiguration({
    params: {
      sourceA: chip ? 0 : 2, sourceB: chip ? 0 : 0,
      tuneA: 0, tuneB: chip ? -12 : 12,
      colorA: chip ? .65 + brightness * .35 : .25 + brightness * .52,
      colorB: .5, motionA: 0, motionB: 0,
      detailA: chip ? 16 : 3, detailB: chip ? 5 : 8,
      combine: 1, combineMix: chip ? .19 : .38, combineDrive: chip ? 3.2 : 1.4,
      shaper: chip ? 5 : 1, shaperAmount: chip ? .98 : .18,
      filter1: 1, cutoff1: 1200 + brightness * 12000, resonance1: .05,
      filter2: 0, filterRoute: 0, filterBlend: 0,
      attack: .002, decay: .02, sustain: 1, release: .02,
      glide: 0, stereo: 0, drift: 0, fx1: 0, fx2: 0, seed: 17011,
    },
    modRoutes: Array.from({ length: 4 }, () => [0, 0, 0, 0]),
  });
}

function renderWasmTone(voice, kernel, frequency, brightness, sampleRate, frames) {
  kernel.exports.reset();
  if (voice === "simd-303") {
    const config = createSimd303Configuration({
      partials: 48, frequency: 12, timeMod: 1, timeScale: .01,
      sequencePhase: .18, gain: .13, dist: .9,
      dur: 1, ratio: 1, sampOffset: 1, fundamental: frequency,
      stereo: 0, nse: 17011, res: 1.5 + brightness * 4,
      lfo: 0, flt: -8 + brightness * 7,
    }, [0], [[1, -78 + brightness * 55, 0, 0]], {
      spectrumMorph: .4, chorusMix: 0, delayMix: 0, delayFeedback: 0,
    });
    writeSimd303Configuration(kernel, config);
    // Direct pitch avoids the source score's normalized pitch mapping.
    kernel.stepFrequency.fill(frequency);
    kernel.partialFold.set(kernel.partialBase);
  } else {
    writeSimdSynthConfiguration(kernel, synthPatch(voice, brightness));
    kernel.exports.set_sequence_active(0);
    kernel.exports.note_on(69 + 12 * Math.log2(frequency / 440), 1);
  }
  const samples = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += 128) {
    const count = Math.min(128, frames - offset);
    kernel.exports.process(128, sampleRate, offset / sampleRate, 0);
    for (let i = 0; i < count; i += 1) samples[offset + i] = (kernel.outputLeft[i] + kernel.outputRight[i]) * .5;
  }
  return samples;
}

function renderNativeTone(voice, frequency, brightness, sampleRate, frames) {
  const samples = new Float32Array(frames);
  let filtered = 0;
  const follow = 1 - Math.exp(-TAU * (600 + brightness * 8500) / sampleRate);
  for (let i = 0; i < frames; i += 1) {
    const phase = (i * frequency / sampleRate) % 1;
    let sample = Math.sin(phase * TAU);
    if (voice === "simd-chiptune") {
      sample = (phase < .25 + brightness * .25 ? .65 : -.65) + .2 * (1 - 4 * Math.abs(phase - .5));
      sample = Math.round(sample * 8) / 8;
    } else if (voice === "simd-303") {
      sample = 2 * phase - 1;
    } else if (voice === "simd-synth") {
      sample = Math.sin(Math.sin(phase * TAU) * (1.5 + brightness * 5)) + .3 * Math.sin(phase * TAU * 2);
    }
    filtered += (sample - filtered) * follow;
    samples[i] = filtered;
  }
  return samples;
}

function renderPercussion(voice, frequency, brightness, sampleRate, frames, seed) {
  const random = rng(seed);
  if (voice === "karplus-strong") {
    return generateKarplusStrongSamples({
      sampleRate, frequency, duration: frames / sampleRate, decay: .72,
      damping: .55 - brightness * .35, brightness,
      hardness: .25 + brightness * .65, excitationColor: .2 + brightness * .7,
      chorusDepth: 0, roughness: 0, coupling: 0, random,
    });
  }
  const samples = new Float32Array(frames);
  const linear = (voice === "rattlesnake" || voice === "pitched-morph")
    ? linearDrumParameters(frequency, {
      model: voice === "pitched-morph" ? "pitched" : "hybrid",
      decay: .64, brightness, pitchedOrder: ["marimba", "xylophone", "kalimba"],
    }, { preserveDuration: true }) : null;
  let phase = 0;
  let coloredNoise = 0;
  const noiseFollow = .08 + brightness * .78;
  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate;
    const white = random() * 2 - 1;
    coloredNoise += (white - coloredNoise) * noiseFollow;
    const attack = Math.min(1, t / .0015);
    const envelope = attack * Math.exp(-t / (.05 + brightness * .09));
    phase += frequency / sampleRate;
    const angle = phase * TAU;
    let sample;
    if (voice === "soft-fm") {
      const index = (1.4 + brightness * 6) * Math.exp(-t / .075);
      sample = Math.sin(angle + Math.sin(angle * 1.5) * index) * envelope;
    } else if (voice === "analog") {
      const bendPhase = frequency * (t + .015 * (1 - Math.exp(-t / .025)));
      sample = (Math.sin(TAU * bendPhase) + .15 * (2 * ((bendPhase * 2) % 1) - 1)) * envelope;
      sample += coloredNoise * .18 * Math.exp(-t / .02) * attack;
    } else if (voice === "noise") {
      sample = (white - coloredNoise) * envelope + .08 * Math.sin(angle) * envelope;
    } else if (linear) {
      const pitched = voice === "pitched-morph";
      const ratios = pitched ? linear.pitchedRatios : linear.modalRatios;
      const gains = pitched ? linear.pitchedGains : linear.modalGains;
      const sum = gains.reduce((a, b) => a + b, 0) || 1;
      const drop = pitched ? t : t + (2 ** linear.pitchDropOctaves - 1) * linear.pitchDropSeconds * (1 - Math.exp(-t / linear.pitchDropSeconds));
      sample = 0;
      for (let p = 0; p < ratios.length; p += 1) {
        if (frequency * ratios[p] > sampleRate * .44) continue;
        const decay = linear.decay / (1 + p * linear.highDamping * .48);
        sample += Math.sin(TAU * frequency * ratios[p] * drop) * gains[p] / sum * Math.exp(-t * 8 / decay);
      }
      if (!pitched) sample = sample * .75 + Math.sin(angle + Math.sin(angle * linear.fmRatio) * linear.fmIndex * Math.exp(-t / .06)) * Math.exp(-t * 8 / linear.decay) * .32;
      sample = sample * attack + coloredNoise * linear.noiseMix * .16 * attack * Math.exp(-t / .028);
    } else {
      sample = [1, 2.76 + brightness * .12, 5.4].reduce((total, ratio, p) => (
        total + Math.sin(angle * ratio) * Math.exp(-t * (8 + p * 5)) / (1 + p * 2)
      ), 0) * attack;
    }
    samples[i] = sample;
  }
  return samples;
}

/** Render a reusable, pitch-correct source. All timing envelopes belong to the
 * caller, so resampling the source never changes a scheduled note's ADSR. */
export function renderSequencerVoice(options = {}, kernels = {}) {
  const descriptor = sequencerVoice(options.voice);
  const sampleRate = clamp(Math.round(finite(options.sampleRate, 48000)), 8000, 96000);
  const frequency = clamp(finite(options.frequency, 220), 30, Math.min(8000, sampleRate * .2));
  const brightness = clamp(finite(options.brightness, .6), 0, 1);
  const seed = Math.round(finite(options.seed, 17011));
  const loop = descriptor.kind === "synth";
  let samples;
  let loopStart = 0;
  let backend = "native";
  if (loop) {
    const period = Math.max(8, Math.round(sampleRate / frequency));
    const referenceFrequency = sampleRate / period;
    const warmup = period * 14;
    const frames = warmup + period * 28;
    const kernel = descriptor.engine === "simd-303" ? kernels.acid : descriptor.engine === "simd-synth" ? kernels.synth : null;
    samples = kernel
      ? renderWasmTone(descriptor.id, kernel, referenceFrequency, brightness, sampleRate, frames)
      : renderNativeTone(descriptor.id, referenceFrequency, brightness, sampleRate, frames);
    backend = kernel ? (kernels.backends?.[descriptor.engine === "simd-303" ? "acid" : "synth"] ?? "simd")
      : descriptor.engine === "native" ? "native" : "native-fallback";
    samples = samples.slice(warmup);
    // Overlap matching periods; the loop resumes after the blended head.
    const overlap = period * 4;
    for (let i = 0; i < overlap; i += 1) {
      const mix = (i + 1) / overlap;
      const tail = samples.length - overlap + i;
      samples[tail] = samples[tail] * (1 - mix) + samples[i] * mix;
    }
    normalize(samples);
    loopStart = overlap / sampleRate;
    return { samples, sampleRate, frequency: referenceFrequency, loop, loopStart, loopEnd: samples.length / sampleRate, backend };
  }
  samples = normalize(renderPercussion(descriptor.id, frequency, brightness, sampleRate, Math.ceil(sampleRate * .78), seed));
  const fade = Math.ceil(sampleRate * .02);
  for (let i = Math.max(0, samples.length - fade); i < samples.length; i += 1) samples[i] *= (samples.length - 1 - i) / fade;
  return { samples, sampleRate, frequency, loop, loopStart, loopEnd: 0, backend };
}
