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

export const KARPLUS_CARPET_LIMITS = Object.freeze({
  minimumGrainDuration: 0.08,
  maximumGrainDuration: 0.4,
  spatialCellSize: 10,
  minimumSpatialColumns: 24,
  maximumSpatialColumns: 512,
  minimumSpatialRows: 12,
  maximumSpatialRows: 96,
  maximumCrossingsPerMove: 48,
  minimumHeadroomDensity: 4,
  maximumHeadroomDensity: 28,
  defaultHeadroomDensity: 16,
  maximumVoices: 48,
});

export const KARPLUS_CARPET_DEFAULTS = Object.freeze({
  ...KARPLUS_STRONG_TUNING_DEFAULTS,
  lowFrequency: 110,
  highFrequency: 880,
  grainDuration: 0.16,
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
    grainDuration: clamp(
      finiteOr(settings.grainDuration, KARPLUS_CARPET_DEFAULTS.grainDuration),
      KARPLUS_CARPET_LIMITS.minimumGrainDuration,
      KARPLUS_CARPET_LIMITS.maximumGrainDuration,
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

export function karplusCarpetSpatialGrid(width, height, options = {}) {
  const geometry = karplusCarpetStageGeometry(width, height);
  const fieldWidth = Math.max(1, geometry.right - geometry.left);
  const fieldHeight = Math.max(1, geometry.bottom - geometry.top);
  const cellSize = clamp(
    finiteOr(options.cellSize, KARPLUS_CARPET_LIMITS.spatialCellSize),
    4,
    32,
  );
  const pitchCount = Math.max(1, Math.round(finiteOr(options.pitchCount, 1)));
  const columns = clamp(
    Math.max(
      KARPLUS_CARPET_LIMITS.minimumSpatialColumns,
      pitchCount,
      Math.ceil(fieldWidth / cellSize),
    ),
    1,
    KARPLUS_CARPET_LIMITS.maximumSpatialColumns,
  );
  const rows = clamp(
    Math.max(
      KARPLUS_CARPET_LIMITS.minimumSpatialRows,
      Math.ceil(fieldHeight / cellSize),
    ),
    1,
    KARPLUS_CARPET_LIMITS.maximumSpatialRows,
  );
  return Object.freeze({
    ...geometry,
    columns,
    rows,
    cellWidth: fieldWidth / columns,
    cellHeight: fieldHeight / rows,
  });
}

function spatialCellFromIndices(grid, column, row, amount = 1) {
  const safeColumn = clamp(Math.trunc(column), 0, grid.columns - 1);
  const safeRow = clamp(Math.trunc(row), 0, grid.rows - 1);
  const left = grid.left + safeColumn * grid.cellWidth;
  const top = grid.top + safeRow * grid.cellHeight;
  return Object.freeze({
    key: safeColumn + ":" + safeRow,
    index: safeRow * grid.columns + safeColumn,
    column: safeColumn,
    row: safeRow,
    position: (safeColumn + 0.5) / grid.columns,
    visualY: (safeRow + 0.5) / grid.rows,
    x: left + grid.cellWidth * 0.5,
    y: top + grid.cellHeight * 0.5,
    left,
    right: left + grid.cellWidth,
    top,
    bottom: top + grid.cellHeight,
    amount: clamp(finiteOr(amount, 1), 0, 1),
  });
}

export function karplusCarpetSpatialCellAtPosition(width, height, x, y, options = {}) {
  const grid = options.grid ?? karplusCarpetSpatialGrid(width, height, options);
  const pointX = finiteOr(x, Number.NaN);
  const pointY = finiteOr(y, Number.NaN);
  if (
    !Number.isFinite(pointX)
    || !Number.isFinite(pointY)
    || pointX < grid.left
    || pointX > grid.right
    || pointY < grid.top
    || pointY > grid.bottom
  ) return null;
  const column = Math.min(
    grid.columns - 1,
    Math.floor((pointX - grid.left) / grid.cellWidth),
  );
  const row = Math.min(
    grid.rows - 1,
    Math.floor((pointY - grid.top) / grid.cellHeight),
  );
  return spatialCellFromIndices(grid, column, row, 0);
}

export function karplusCarpetSpatialCrossings(from, to, options = {}) {
  const width = Math.max(1, finiteOr(options.width, 1));
  const height = Math.max(1, finiteOr(options.height, 1));
  const grid = options.grid ?? karplusCarpetSpatialGrid(width, height, options);
  const start = karplusCarpetSpatialCellAtPosition(width, height, from?.x, from?.y, { grid });
  const end = karplusCarpetSpatialCellAtPosition(width, height, to?.x, to?.y, { grid });
  if (!start || !end || start.key === end.key) return Object.freeze([]);

  const epsilon = Number.EPSILON * 16;
  const startX = clamp((finiteOr(from?.x, grid.left) - grid.left) / grid.cellWidth, 0, grid.columns - epsilon);
  const startY = clamp((finiteOr(from?.y, grid.top) - grid.top) / grid.cellHeight, 0, grid.rows - epsilon);
  const endX = clamp((finiteOr(to?.x, grid.left) - grid.left) / grid.cellWidth, 0, grid.columns - epsilon);
  const endY = clamp((finiteOr(to?.y, grid.top) - grid.top) / grid.cellHeight, 0, grid.rows - epsilon);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const stepX = Math.sign(deltaX);
  const stepY = Math.sign(deltaY);
  const deltaTX = stepX ? Math.abs(1 / deltaX) : Number.POSITIVE_INFINITY;
  const deltaTY = stepY ? Math.abs(1 / deltaY) : Number.POSITIVE_INFINITY;
  let column = start.column;
  let row = start.row;
  let maxTX = stepX > 0
    ? (column + 1 - startX) / deltaX
    : stepX < 0 ? (startX - column) / -deltaX : Number.POSITIVE_INFINITY;
  let maxTY = stepY > 0
    ? (row + 1 - startY) / deltaY
    : stepY < 0 ? (startY - row) / -deltaY : Number.POSITIVE_INFINITY;
  const crossed = [];
  const maximumSteps = grid.columns + grid.rows + 2;

  for (let step = 0; step < maximumSteps && (column !== end.column || row !== end.row); step += 1) {
    let amount;
    if (Math.abs(maxTX - maxTY) <= 1e-10) {
      amount = maxTX;
      column += stepX;
      row += stepY;
      maxTX += deltaTX;
      maxTY += deltaTY;
    } else if (maxTX < maxTY) {
      amount = maxTX;
      column += stepX;
      maxTX += deltaTX;
    } else {
      amount = maxTY;
      row += stepY;
      maxTY += deltaTY;
    }
    crossed.push(spatialCellFromIndices(grid, column, row, amount));
  }
  return Object.freeze(crossed);
}

export function karplusCarpetSpatialCellSeed(cell = {}) {
  return (
    Math.imul(Math.max(0, Math.trunc(finiteOr(cell.column, 0))) + 1, 0x8da6b343)
    ^ Math.imul(Math.max(0, Math.trunc(finiteOr(cell.row, 0))) + 1, 0xd8163841)
  ) >>> 0;
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

export function karplusCarpetPointerEvent(source = {}, index = 0, options = {}) {
  const settings = sanitizeKarplusCarpetSettings(source);
  const frequencies = Array.isArray(options.frequencies) && options.frequencies.length
    ? options.frequencies
    : karplusStrongStringFrequencies(settings);
  const serial = Math.max(0, Math.trunc(finiteOr(index, 0)));
  const seed = Math.trunc(finiteOr(options.seed, 1)) >>> 0;
  const random = eventRandom(seed, serial);
  const pitch = karplusCarpetPitchAtPosition(
    settings,
    options.position,
    frequencies,
  );
  const duration = clamp(
    settings.grainDuration * (0.9 + random() * 0.2),
    KARPLUS_CARPET_LIMITS.minimumGrainDuration,
    KARPLUS_CARPET_LIMITS.maximumGrainDuration,
  );
  const variedVelocity = 0.42 + (random() * 2 - 1) * settings.velocityScatter * 0.18;
  return Object.freeze({
    index: serial,
    seed: (seed ^ Math.imul(serial + 11, 0x85ebca6b)) >>> 0,
    ...pitch,
    visualY: clamp(finiteOr(options.visualY, 0.5), 0, 1),
    duration,
    velocity: clamp(finiteOr(options.velocity, variedVelocity), 0.16, 0.7),
    pan: clamp((pitch.fieldPosition * 2 - 1) * settings.stereoSpread, -1, 1),
    timbre: random() * 2 - 1,
  });
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
      finiteOr(options.density, KARPLUS_CARPET_LIMITS.defaultHeadroomDensity),
      KARPLUS_CARPET_LIMITS.minimumHeadroomDensity,
      KARPLUS_CARPET_LIMITS.maximumHeadroomDensity,
    );
    const densityHeadroom = Math.sqrt(KARPLUS_CARPET_LIMITS.minimumHeadroomDensity / density);
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
