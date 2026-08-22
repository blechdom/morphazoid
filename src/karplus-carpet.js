import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";
import {
  KARPLUS_STRONG_DEFAULTS,
  KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS,
  KARPLUS_STRONG_TUNING_DEFAULTS,
  generateKarplusStrongSamples,
  karplusStrongStringFrequencies,
  sanitizeKarplusStrongSettings,
  sanitizeKarplusStrongTuning,
} from "./karplus-strong.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const GOLDEN_PHASE = 0.6180339887498949;

export const KARPLUS_CARPET_LIMITS = Object.freeze({
  minimumHitCount: 8,
  maximumHitCount: 128,
  minimumDensity: 4,
  maximumDensity: 28,
  minimumGrainDuration: 0.08,
  maximumGrainDuration: 0.4,
  maximumVoices: 48,
  scheduleAheadSeconds: 0.1,
});

export const KARPLUS_CARPET_DEFAULTS = Object.freeze({
  ...KARPLUS_STRONG_TUNING_DEFAULTS,
  lowFrequency: 110,
  highFrequency: 880,
  hitCount: 64,
  hitDensity: 16,
  grainDuration: 0.16,
  timingJitter: 0.18,
  pitchSpread: 0.72,
  velocityScatter: 0.28,
  stereoSpread: 0.78,
  centerPosition: 0.5,
});

export function sanitizeKarplusCarpetSettings(source = {}) {
  const settings = source && typeof source === "object" ? source : {};
  const tuning = sanitizeKarplusStrongTuning({
    lowFrequency: settings.lowFrequency,
    highFrequency: settings.highFrequency,
    divisionsPerOctave: settings.divisionsPerOctave,
    spacing: settings.spacing,
  });
  return {
    ...tuning,
    hitCount: clamp(
      Math.round(finiteOr(settings.hitCount, KARPLUS_CARPET_DEFAULTS.hitCount)),
      KARPLUS_CARPET_LIMITS.minimumHitCount,
      KARPLUS_CARPET_LIMITS.maximumHitCount,
    ),
    hitDensity: clamp(
      Math.round(finiteOr(settings.hitDensity, KARPLUS_CARPET_DEFAULTS.hitDensity)),
      KARPLUS_CARPET_LIMITS.minimumDensity,
      KARPLUS_CARPET_LIMITS.maximumDensity,
    ),
    grainDuration: clamp(
      finiteOr(settings.grainDuration, KARPLUS_CARPET_DEFAULTS.grainDuration),
      KARPLUS_CARPET_LIMITS.minimumGrainDuration,
      KARPLUS_CARPET_LIMITS.maximumGrainDuration,
    ),
    timingJitter: clamp(
      finiteOr(settings.timingJitter, KARPLUS_CARPET_DEFAULTS.timingJitter),
      0,
      1,
    ),
    pitchSpread: clamp(
      finiteOr(settings.pitchSpread, KARPLUS_CARPET_DEFAULTS.pitchSpread),
      0.04,
      1,
    ),
    velocityScatter: clamp(
      finiteOr(settings.velocityScatter, KARPLUS_CARPET_DEFAULTS.velocityScatter),
      0,
      1,
    ),
    stereoSpread: clamp(
      finiteOr(settings.stereoSpread, KARPLUS_CARPET_DEFAULTS.stereoSpread),
      0,
      1,
    ),
    centerPosition: clamp(
      finiteOr(settings.centerPosition, KARPLUS_CARPET_DEFAULTS.centerPosition),
      0,
      1,
    ),
  };
}

export function createKarplusCarpetRandom(seed = 0x6d2b79f5) {
  let state = (Math.trunc(finiteOr(seed, 0x6d2b79f5)) >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function eventRandom(seed, index) {
  const mixed = (Math.trunc(finiteOr(seed, 1)) >>> 0)
    ^ Math.imul((Math.max(0, Math.trunc(index)) + 1) >>> 0, 0x9e3779b1);
  return createKarplusCarpetRandom(mixed >>> 0);
}

export function karplusCarpetIntervalMs(source = {}, index = 0, options = {}) {
  const settings = sanitizeKarplusCarpetSettings(source);
  const random = eventRandom(options.seed, index);
  const baseInterval = 1_000 / settings.hitDensity;
  const jitter = (random() * 2 - 1) * settings.timingJitter * 0.72;
  return baseInterval * clamp(1 + jitter, 0.28, 1.72);
}

export function karplusCarpetResumeTime(nextHitAt, now, options = {}) {
  const currentTime = Math.max(0, finiteOr(now, 0));
  const scheduledTime = finiteOr(nextHitAt, currentTime);
  const maximumLatenessMs = clamp(finiteOr(options.maximumLatenessMs, 50), 0, 1_000);
  const restartDelayMs = clamp(finiteOr(options.restartDelayMs, 8), 0, 100);
  return scheduledTime < currentTime - maximumLatenessMs
    ? currentTime + restartDelayMs
    : scheduledTime;
}

export function karplusCarpetRephaseTime(
  source,
  lastScheduledHitAt,
  now,
  index = 0,
  options = {},
) {
  const currentTime = Math.max(0, finiteOr(now, 0));
  const scheduledTime = lastScheduledHitAt == null
    ? currentTime
    : finiteOr(lastScheduledHitAt, currentTime);
  const minimumLeadMs = clamp(finiteOr(options.minimumLeadMs, 8), 0, 1_000);
  return Math.max(
    currentTime + minimumLeadMs,
    scheduledTime + karplusCarpetIntervalMs(source, index, options),
  );
}

export function karplusCarpetStageGeometry(width, height) {
  const safeWidth = Math.max(1, finiteOr(width, 1));
  const safeHeight = Math.max(1, finiteOr(height, 1));
  const left = Math.min(48, safeWidth * 0.07);
  const right = Math.min(safeWidth, Math.max(left + 1, safeWidth - 42));
  const top = Math.min(118, safeHeight * 0.22);
  const bottom = Math.min(safeHeight, Math.max(top + 1, safeHeight - 68));
  return Object.freeze({ top, bottom, left, right });
}

export function karplusCarpetPositionFromStageX(x, width) {
  const { left, right } = karplusCarpetStageGeometry(width, 1);
  return clamp((finiteOr(x, left) - left) / Math.max(1, right - left), 0, 1);
}

export function karplusCarpetPitchAtPosition(source = {}, position, frequencySource) {
  const settings = sanitizeKarplusCarpetSettings(source);
  const frequencies = Array.isArray(frequencySource) && frequencySource.length
    ? frequencySource
    : karplusStrongStringFrequencies(settings);
  const maximumIndex = Math.max(0, frequencies.length - 1);
  const normalizedPosition = clamp(
    finiteOr(position, settings.centerPosition),
    0,
    1,
  );
  const frequencyIndex = clamp(Math.round(normalizedPosition * maximumIndex), 0, maximumIndex);
  return Object.freeze({
    frequencyIndex,
    frequency: finiteOr(frequencies[frequencyIndex], settings.lowFrequency),
    fieldPosition: maximumIndex ? frequencyIndex / maximumIndex : 0.5,
  });
}

export function karplusCarpetEvent(source = {}, index = 0, options = {}) {
  const settings = sanitizeKarplusCarpetSettings(source);
  const serial = Math.max(0, Math.trunc(finiteOr(index, 0)));
  const seed = Math.trunc(finiteOr(options.seed, 1)) >>> 0;
  const random = eventRandom(seed, serial);
  const frequencies = Array.isArray(options.frequencies) && options.frequencies.length
    ? options.frequencies
    : karplusStrongStringFrequencies(settings);
  const maximumIndex = Math.max(0, frequencies.length - 1);
  const centerIndex = settings.centerPosition * maximumIndex;
  const halfWidth = Math.max(0.5, maximumIndex * settings.pitchSpread * 0.5);
  const lowerIndex = Math.max(0, centerIndex - halfWidth);
  const upperIndex = Math.min(maximumIndex, centerIndex + halfWidth);
  const wovenPhase = (serial * GOLDEN_PHASE + random() * 0.34) % 1;
  const frequencyIndex = clamp(
    Math.round(lowerIndex + (upperIndex - lowerIndex) * wovenPhase),
    0,
    maximumIndex,
  );
  const fieldPosition = maximumIndex ? frequencyIndex / maximumIndex : 0.5;
  const duration = clamp(
    settings.grainDuration * (0.78 + random() * 0.44),
    KARPLUS_CARPET_LIMITS.minimumGrainDuration,
    KARPLUS_CARPET_LIMITS.maximumGrainDuration,
  );
  const velocity = clamp(
    0.38 + (random() * 2 - 1) * settings.velocityScatter * 0.2,
    0.16,
    0.62,
  );
  const pan = clamp(
    (fieldPosition * 2 - 1) * settings.stereoSpread
      + (random() * 2 - 1) * settings.stereoSpread * 0.12,
    -1,
    1,
  );
  const eventSeed = (seed ^ Math.imul(serial + 11, 0x85ebca6b)) >>> 0;
  return Object.freeze({
    index: serial,
    seed: eventSeed,
    frequencyIndex,
    frequency: finiteOr(frequencies[frequencyIndex], settings.lowFrequency),
    fieldPosition,
    visualY: 0.12 + random() * 0.76,
    duration,
    velocity,
    pan,
    timbre: random() * 2 - 1,
  });
}

export function karplusCarpetPointerEvent(source = {}, index = 0, options = {}) {
  const settings = sanitizeKarplusCarpetSettings(source);
  const frequencies = Array.isArray(options.frequencies) && options.frequencies.length
    ? options.frequencies
    : karplusStrongStringFrequencies(settings);
  const event = karplusCarpetEvent(settings, index, { ...options, frequencies });
  const pitch = karplusCarpetPitchAtPosition(
    settings,
    options.position,
    frequencies,
  );
  return Object.freeze({
    ...event,
    ...pitch,
    visualY: clamp(finiteOr(options.visualY, 0.5), 0, 1),
    pan: clamp((pitch.fieldPosition * 2 - 1) * settings.stereoSpread, -1, 1),
  });
}

export function buildKarplusCarpetEvents(source = {}, options = {}) {
  const settings = sanitizeKarplusCarpetSettings(source);
  const frequencies = karplusStrongStringFrequencies(settings);
  const events = [];
  let atMs = 0;
  for (let index = 0; index < settings.hitCount; index += 1) {
    const event = karplusCarpetEvent(settings, index, {
      seed: options.seed,
      frequencies,
    });
    events.push(Object.freeze({ ...event, atMs }));
    atMs += karplusCarpetIntervalMs(settings, index, options);
  }
  return Object.freeze(events);
}

export function generateKarplusCarpetSamples(event = {}, sourceSettings = {}, sampleRate = 48_000) {
  const duration = clamp(
    finiteOr(event.duration, KARPLUS_CARPET_DEFAULTS.grainDuration),
    KARPLUS_CARPET_LIMITS.minimumGrainDuration,
    KARPLUS_CARPET_LIMITS.maximumGrainDuration,
  );
  const timbre = clamp(finiteOr(event.timbre, 0), -1, 1);
  const settings = sanitizeKarplusStrongSettings({
    ...sourceSettings,
    frequency: finiteOr(event.frequency, KARPLUS_STRONG_DEFAULTS.frequency),
    decay: Math.max(0.2, duration),
    hardness: finiteOr(sourceSettings.hardness, KARPLUS_STRONG_DEFAULTS.hardness)
      + timbre * 0.08,
    brightness: finiteOr(sourceSettings.brightness, KARPLUS_STRONG_DEFAULTS.brightness)
      + timbre * 0.06,
    pickPosition: finiteOr(sourceSettings.pickPosition, KARPLUS_STRONG_DEFAULTS.pickPosition)
      + timbre * 0.035,
    roughness: finiteOr(sourceSettings.roughness, KARPLUS_STRONG_DEFAULTS.roughness)
      + Math.abs(timbre) * 0.035,
    coupling: finiteOr(sourceSettings.coupling, KARPLUS_STRONG_DEFAULTS.coupling) * 0.28,
    spread: 1,
  });
  const variantSeed = ((Math.trunc(finiteOr(event.seed, 1)) >>> 0) & 3) + 1;
  return generateKarplusStrongSamples({
    ...settings,
    sampleRate,
    duration,
    random: createKarplusCarpetRandom(variantSeed),
  });
}

export function normalizeKarplusCarpetSamples(samples, sampleRate = 48_000) {
  const source = samples && typeof samples.length === "number" ? samples : [];
  const analysisFrames = Math.min(
    source.length,
    Math.max(1, Math.ceil(Math.max(1, finiteOr(sampleRate, 48_000)) * 0.14)),
  );
  let energy = 0;
  for (let index = 0; index < analysisFrames; index += 1) {
    const sample = finiteOr(source[index], 0);
    energy += sample * sample;
  }
  const openingRms = Math.sqrt(energy / Math.max(1, analysisFrames));
  const normalization = clamp(0.24 / Math.max(0.0001, openingRms), 1.15, 3.6);
  const normalized = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    normalized[index] = clamp(finiteOr(source[index], 0) * normalization, -1, 1);
  }
  return normalized;
}

function cancelledStartError() {
  const error = new Error("Karplus Carpet audio start was cancelled.");
  error.name = "AbortError";
  return error;
}

export class KarplusCarpetAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.input = null;
    this.master = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.activeVoices = [];
    this.bufferCache = new Map();
    this.output = KARPLUS_STRONG_DEFAULTS.level;
    this.pitchBendCents = 0;
    this.lifecycleGeneration = 0;
  }

  async start() {
    const generation = this.lifecycleGeneration;
    let context = this.context;
    if (!context || context.state === "closed") {
      this.releaseAudioOutput?.();
      const Context = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      if (!Context) throw new Error("Web Audio is not available in this browser.");
      context = new Context();
      this.context = context;
      this.input = context.createGain();
      this.input.gain.value = 0.72;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.18;
      this.master = context.createGain();
      this.master.gain.value = this.output;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.74;
      this.input.connect(compressor);
      compressor.connect(this.master);
      this.master.connect(this.analyser);
      this.releaseAudioOutput = connectAudioOutput(context, this.analyser, { runtime: this.runtime });
    }
    if (context.state === "suspended") {
      unlockAudioContext(context);
      await context.resume();
    }
    if (
      generation !== this.lifecycleGeneration
      || context !== this.context
      || context.state === "closed"
    ) throw cancelledStartError();
    return context;
  }

  setOutput(value) {
    this.output = clamp(finiteOr(value, KARPLUS_STRONG_DEFAULTS.level), 0, 0.85);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.output, this.context.currentTime, 0.015);
    }
  }

  setPitchBend(cents, options = {}) {
    this.pitchBendCents = clamp(
      finiteOr(cents, 0),
      -KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS,
      KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS,
    );
    const now = this.context?.currentTime ?? 0;
    const immediate = Boolean(options.immediate);
    const playbackRate = 2 ** (this.pitchBendCents / 1_200);
    for (const voice of this.activeVoices) {
      const source = voice.source;
      if (!source) continue;
      const parameter = source.detune ?? source.playbackRate;
      if (!parameter) continue;
      const value = source.detune ? this.pitchBendCents : playbackRate;
      parameter.cancelScheduledValues?.(now);
      if (immediate || typeof parameter.setTargetAtTime !== "function") {
        if (typeof parameter.setValueAtTime === "function") parameter.setValueAtTime(value, now);
        else parameter.value = value;
      } else {
        parameter.setTargetAtTime(value, now, 0.01);
      }
    }
    return this.pitchBendCents;
  }

  clearBufferCache() {
    this.bufferCache.clear();
  }

  async scheduleGrain(event = {}, sourceSettings = {}, options = {}) {
    const context = await this.start();
    if (context !== this.context || context.state === "closed") throw cancelledStartError();
    const duration = clamp(
      finiteOr(event.duration, KARPLUS_CARPET_DEFAULTS.grainDuration),
      KARPLUS_CARPET_LIMITS.minimumGrainDuration,
      KARPLUS_CARPET_LIMITS.maximumGrainDuration,
    );
    const settings = sanitizeKarplusStrongSettings({
      ...sourceSettings,
      frequency: finiteOr(event.frequency, KARPLUS_STRONG_DEFAULTS.frequency),
      decay: Math.max(0.2, duration),
      coupling: finiteOr(sourceSettings.coupling, KARPLUS_STRONG_DEFAULTS.coupling) * 0.28,
      spread: 1,
    });
    const renderDuration = clamp(
      finiteOr(options.renderDuration, duration),
      duration,
      KARPLUS_CARPET_LIMITS.maximumGrainDuration,
    );
    const renderEvent = {
      ...event,
      duration: renderDuration,
      seed: Math.max(1, Math.round(settings.frequency * 1_000)) >>> 0,
      timbre: 0,
    };
    const cacheKey = this.#bufferKey(renderEvent, settings, renderDuration);
    let buffer = this.bufferCache.get(cacheKey);
    if (!buffer) {
      const samples = normalizeKarplusCarpetSamples(
        generateKarplusCarpetSamples(renderEvent, settings, context.sampleRate),
        context.sampleRate,
      );
      buffer = context.createBuffer(1, samples.length, context.sampleRate);
      if (typeof buffer.copyToChannel === "function") buffer.copyToChannel(samples, 0);
      else buffer.getChannelData(0).set(samples);
      this.bufferCache.set(cacheKey, buffer);
      while (this.bufferCache.size > 192) {
        this.bufferCache.delete(this.bufferCache.keys().next().value);
      }
    }

    const source = context.createBufferSource();
    const tone = context.createBiquadFilter();
    const body = context.createBiquadFilter();
    const gain = context.createGain();
    const panner = typeof context.createStereoPanner === "function"
      ? context.createStereoPanner()
      : null;
    const delay = clamp(finiteOr(options.delay, 0), 0, 0.25);
    const requestedWhen = finiteOr(options.when, context.currentTime + delay);
    const when = Math.max(context.currentTime, requestedWhen);
    source.buffer = buffer;
    if (source.detune) source.detune.setValueAtTime?.(this.pitchBendCents, when);
    else if (source.playbackRate) {
      source.playbackRate.setValueAtTime?.(2 ** (this.pitchBendCents / 1_200), when);
    }
    tone.type = "lowpass";
    const eventTimbre = clamp(finiteOr(event.timbre, 0), -1, 1);
    tone.frequency.value = Math.min(
      context.sampleRate * 0.44,
      (700 + settings.brightness ** 1.35 * 17_000) * (2 ** (eventTimbre * 0.12)),
    );
    tone.Q.value = 0.25 + settings.dispersion * 0.9;
    body.type = "peaking";
    body.frequency.value = Math.min(context.sampleRate * 0.4, settings.frequency * settings.bodyTune);
    body.Q.value = settings.bodyQ;
    body.gain.value = settings.body * 9;
    const density = clamp(
      finiteOr(options.density, KARPLUS_CARPET_DEFAULTS.hitDensity),
      KARPLUS_CARPET_LIMITS.minimumDensity,
      KARPLUS_CARPET_LIMITS.maximumDensity,
    );
    const densityHeadroom = Math.sqrt(KARPLUS_CARPET_LIMITS.minimumDensity / density);
    const peak = clamp(finiteOr(event.velocity, 0.38), 0.05, 0.7) * 0.46 * densityHeadroom;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(Math.max(0.0002, peak), when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    if (panner) panner.pan.value = clamp(finiteOr(event.pan, 0), -1, 1);
    source.connect(tone).connect(body).connect(gain);
    if (panner) gain.connect(panner).connect(this.input);
    else gain.connect(this.input);
    source.start(when);

    const voice = { source, gain, startTime: when, nodes: [source, tone, body, gain, panner] };
    this.activeVoices = this.activeVoices.filter((candidate) => candidate.source !== null);
    while (this.activeVoices.length >= KARPLUS_CARPET_LIMITS.maximumVoices) {
      const oldest = this.activeVoices.shift();
      if (!oldest) break;
      try {
        oldest.gain.gain.setTargetAtTime(0, context.currentTime, 0.006);
        oldest.source?.stop(context.currentTime + 0.018);
      } catch {
        // A short grain can finish while the next one is being prepared.
      }
    }
    this.activeVoices.push(voice);
    source.onended = () => {
      for (const node of voice.nodes) {
        try { node?.disconnect?.(); } catch { /* already disconnected */ }
      }
      voice.source = null;
      this.activeVoices = this.activeVoices.filter((candidate) => candidate !== voice);
    };
    return Object.freeze({ ...event, when, duration });
  }

  stopAll() {
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.activeVoices) {
      try {
        voice.gain?.gain?.setTargetAtTime?.(0, now, 0.006);
        voice.source?.stop?.(now + 0.018);
      } catch {
        // The grain already ended.
      }
    }
  }

  #bufferKey(event, settings, duration) {
    const variant = (Math.trunc(finiteOr(event.seed, 1)) >>> 0) & 3;
    return [
      settings.frequency.toFixed(3),
      duration.toFixed(3),
      variant,
      clamp(finiteOr(event.timbre, 0), -1, 1).toFixed(2),
      settings.hardness.toFixed(2),
      settings.excitationColor.toFixed(2),
      settings.excitationShape.toFixed(2),
      settings.burstLength.toFixed(2),
      settings.pickPosition.toFixed(2),
      settings.pickWidth.toFixed(2),
      settings.damping.toFixed(2),
      settings.brightness.toFixed(2),
      settings.dispersion.toFixed(2),
      settings.polarity.toFixed(2),
      settings.lowCut.toFixed(2),
      settings.drive.toFixed(2),
      settings.detune.toFixed(1),
      settings.chorusDepth.toFixed(2),
      settings.chorusRate.toFixed(2),
      settings.roughness.toFixed(2),
      settings.pickupPosition.toFixed(2),
      settings.pickupMix.toFixed(2),
      settings.body.toFixed(2),
      settings.bodyTune.toFixed(2),
      settings.bodyQ.toFixed(2),
    ].join(":");
  }

  async close() {
    this.lifecycleGeneration += 1;
    const context = this.context;
    this.stopAll();
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.input = null;
    this.master = null;
    this.analyser = null;
    this.activeVoices = [];
    this.bufferCache.clear();
    if (context && context.state !== "closed") await context.close();
  }
}
