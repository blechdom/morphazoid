const DEFAULT_CONCERT_A = 440;
const DEFAULT_FLOOR_DB = -60;
const DEFAULT_CEILING_DB = 0;
const DEFAULT_MIDI_CC_INTERVAL_MS = 1000 / 30;

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, finite(value, minimum)))
);

const positive = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

function decibelRange({
  floorDb = DEFAULT_FLOOR_DB,
  ceilingDb = DEFAULT_CEILING_DB,
} = {}) {
  const first = finite(floorDb, DEFAULT_FLOOR_DB);
  const second = finite(ceilingDb, DEFAULT_CEILING_DB);
  if (first === second) return { floorDb: first - 1, ceilingDb: second };
  return {
    floorDb: Math.min(first, second),
    ceilingDb: Math.max(first, second),
  };
}

function frequencyRange({ minHz = 20, maxHz = 20_000 } = {}) {
  const first = positive(minHz, 20);
  const second = positive(maxHz, 20_000);
  if (first === second) return { minHz: first, maxHz: first * 2 };
  return {
    minHz: Math.min(first, second),
    maxHz: Math.max(first, second),
  };
}

/** Convert a MIDI note number, including fractional notes, to hertz. */
export function midiNoteToFrequency(note, concertA = DEFAULT_CONCERT_A) {
  const reference = positive(concertA, DEFAULT_CONCERT_A);
  return reference * (2 ** ((finite(note, 69) - 69) / 12));
}

/** Convert a positive frequency to an unbounded fractional MIDI note number. */
export function frequencyToMidiNote(frequencyHz, concertA = DEFAULT_CONCERT_A) {
  const frequency = Number(frequencyHz);
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  const reference = positive(concertA, DEFAULT_CONCERT_A);
  return 69 + 12 * Math.log2(frequency / reference);
}

/**
 * Resolve a frequency to its nearest playable MIDI note plus tuning error.
 * `exactNote` remains unbounded so callers can detect range clipping.
 */
export function frequencyToMidiPitch(frequencyHz, {
  concertA = DEFAULT_CONCERT_A,
  minNote = 0,
  maxNote = 127,
} = {}) {
  const exactNote = frequencyToMidiNote(frequencyHz, concertA);
  if (exactNote === null) return null;
  const first = clamp(Math.round(finite(minNote, 0)), 0, 127);
  const second = clamp(Math.round(finite(maxNote, 127)), 0, 127);
  const low = Math.min(first, second);
  const high = Math.max(first, second);
  const boundedNote = clamp(exactNote, low, high);
  const note = Math.round(boundedNote);
  const rawCents = (boundedNote - note) * 100;
  const cents = Math.abs(rawCents) < 1e-10 ? 0 : rawCents;
  return Object.freeze({
    frequencyHz: Number(frequencyHz),
    exactNote,
    note,
    cents,
    clamped: boundedNote !== exactNote,
  });
}

/** Map normalized control space to a perceptually useful exponential Hz range. */
export function normalizedToFrequency(normalized, options = {}) {
  const { minHz, maxHz } = frequencyRange(options);
  const position = clamp(normalized, 0, 1);
  return minHz * ((maxHz / minHz) ** position);
}

/** Inverse of normalizedToFrequency, clamped to the declared Hz range. */
export function frequencyToNormalized(frequencyHz, options = {}) {
  const { minHz, maxHz } = frequencyRange(options);
  const frequency = clamp(positive(frequencyHz, minHz), minHz, maxHz);
  return Math.log(frequency / minHz) / Math.log(maxHz / minHz);
}

/** Convert a linear amplitude magnitude to dB, with a finite silence floor. */
export function amplitudeToDecibels(amplitude, options = {}) {
  const { floorDb, ceilingDb } = decibelRange(options);
  const magnitude = Math.abs(finite(amplitude, 0));
  if (!(magnitude > 0)) return floorDb;
  return clamp(20 * Math.log10(magnitude), floorDb, ceilingDb);
}

/** Normalize a dB value to 0..1 inside a configurable display/control window. */
export function normalizeDecibels(decibels, options = {}) {
  const { floorDb, ceilingDb } = decibelRange(options);
  const value = clamp(decibels, floorDb, ceilingDb);
  return (value - floorDb) / (ceilingDb - floorDb);
}

/** Convert linear amplitude directly to normalized dB control space. */
export function normalizeAmplitudeDb(amplitude, options = {}) {
  return normalizeDecibels(amplitudeToDecibels(amplitude, options), options);
}

/** Measure a waveform without mutating it. Non-finite samples count as silence. */
export function waveformRmsPeak(samples) {
  const length = Math.max(0, Math.trunc(Number(samples?.length) || 0));
  if (length === 0) return Object.freeze({ rms: 0, peak: 0 });
  let squareSum = 0;
  let peak = 0;
  for (let index = 0; index < length; index += 1) {
    const sample = finite(samples[index], 0);
    const magnitude = Math.abs(sample);
    squareSum += sample * sample;
    if (magnitude > peak) peak = magnitude;
  }
  return Object.freeze({
    rms: Math.sqrt(squareSum / length),
    peak,
  });
}

export const DEFAULT_COARSE_FFT_BANDS = Object.freeze([
  Object.freeze({ id: "low", label: "Low", minHz: 20, maxHz: 250 }),
  Object.freeze({ id: "mid", label: "Mid", minHz: 250, maxHz: 2_000 }),
  Object.freeze({ id: "high", label: "High", minHz: 2_000, maxHz: 20_000 }),
]);

function fftBinAmplitude(value, scale, floorDb, ceilingDb) {
  if (scale === "linear") return Math.abs(finite(value, 0));
  if (scale === "byte") return clamp(value, 0, 255) / 255;
  const decibels = clamp(value, floorDb, ceilingDb);
  return 10 ** (decibels / 20);
}

/**
 * Aggregate AnalyserNode-style frequency bins into coarse musical bands.
 * Decibel bins are converted back to linear amplitude before RMS aggregation.
 */
export function aggregateFftBands(frequencyData, {
  sampleRate = 48_000,
  fftSize = Math.max(2, (Number(frequencyData?.length) || 1) * 2),
  scale = "decibels",
  bands = DEFAULT_COARSE_FFT_BANDS,
  floorDb = -90,
  ceilingDb = 0,
} = {}) {
  const length = Math.max(0, Math.trunc(Number(frequencyData?.length) || 0));
  const rate = positive(sampleRate, 48_000);
  const size = Math.max(2, Math.round(positive(fftSize, Math.max(2, length * 2))));
  const binWidthHz = rate / size;
  const nyquist = rate / 2;
  const dbRange = decibelRange({ floorDb, ceilingDb });
  const inputScale = ["decibels", "linear", "byte"].includes(scale)
    ? scale
    : "decibels";
  const definitions = Array.isArray(bands) && bands.length
    ? bands
    : DEFAULT_COARSE_FFT_BANDS;

  return Object.freeze(definitions.map((definition, index) => {
    const rawMinimum = Math.max(0, finite(definition?.minHz, 0));
    const rawMaximum = Math.max(rawMinimum, finite(definition?.maxHz, nyquist));
    const minHz = Math.min(rawMinimum, nyquist);
    const maxHz = Math.min(Math.max(minHz, rawMaximum), nyquist);
    const firstBin = clamp(Math.ceil(minHz / binWidthHz), 0, length);
    const endBin = clamp(Math.ceil(maxHz / binWidthHz), firstBin, length);
    let squareSum = 0;
    let peak = 0;

    for (let bin = firstBin; bin < endBin; bin += 1) {
      const amplitude = fftBinAmplitude(
        frequencyData[bin],
        inputScale,
        dbRange.floorDb,
        dbRange.ceilingDb,
      );
      squareSum += amplitude * amplitude;
      if (amplitude > peak) peak = amplitude;
    }

    const binCount = Math.max(0, endBin - firstBin);
    const rms = binCount ? Math.sqrt(squareSum / binCount) : 0;
    const decibels = amplitudeToDecibels(rms, dbRange);
    const peakDecibels = amplitudeToDecibels(peak, dbRange);
    return Object.freeze({
      id: String(definition?.id ?? `band-${index + 1}`),
      label: String(definition?.label ?? definition?.id ?? `Band ${index + 1}`),
      minHz,
      maxHz,
      firstBin,
      endBin,
      binCount,
      rms,
      peak,
      decibels,
      peakDecibels,
      normalized: normalizeDecibels(decibels, dbRange),
    });
  }));
}

/** One-pole envelope smoothing with independent attack and release times. */
export function smoothAttackRelease(previous, target, deltaMilliseconds, {
  attackMs = 30,
  releaseMs = 220,
} = {}) {
  const from = Math.max(0, finite(previous, 0));
  const to = Math.max(0, finite(target, 0));
  const elapsed = Math.max(0, finite(deltaMilliseconds, 0));
  if (elapsed === 0 || from === to) return from;
  const time = Math.max(0, finite(to > from ? attackMs : releaseMs, 0));
  if (time === 0) return to;
  const alpha = -Math.expm1(-elapsed / time);
  return from + (to - from) * alpha;
}

/** Apply Schmitt-trigger hysteresis to an amplitude level. */
export function updateAmplitudeGate(previousOpen, amplitude, {
  openThreshold = 0.1,
  closeThreshold = 0.05,
} = {}) {
  const wasOpen = Boolean(previousOpen);
  const level = Math.max(0, finite(amplitude, 0));
  const first = Math.max(0, finite(openThreshold, 0.1));
  const second = Math.max(0, finite(closeThreshold, 0.05));
  const opensAt = Math.max(first, second);
  const closesAt = Math.min(first, second);
  const open = wasOpen ? level > closesAt : level >= opensAt;
  const changed = open !== wasOpen;
  return Object.freeze({
    open,
    changed,
    action: changed ? (open ? "open" : "close") : null,
    level,
    openThreshold: opensAt,
    closeThreshold: closesAt,
  });
}

/** Quantize a normalized control value to MIDI's 7-bit value range. */
export function normalizedToMidi7(normalized) {
  return Math.round(clamp(normalized, 0, 1) * 127);
}

/**
 * Pure dedupe/rate-limit reducer for continuous MIDI CC output.
 * Feed the returned `state` into the next call and send only when `emit` is true.
 */
export function limitMidiCc(previousState, normalized, timestampMilliseconds, {
  minimumIntervalMs = DEFAULT_MIDI_CC_INTERVAL_MS,
} = {}) {
  const value = normalizedToMidi7(normalized);
  const timestamp = finite(timestampMilliseconds, 0);
  const priorValue = Number.isInteger(previousState?.lastValue)
    ? clamp(previousState.lastValue, 0, 127)
    : null;
  const priorTimestamp = Number.isFinite(Number(previousState?.lastSentAt))
    ? Number(previousState.lastSentAt)
    : Number.NEGATIVE_INFINITY;
  const interval = Math.max(0, finite(minimumIntervalMs, DEFAULT_MIDI_CC_INTERVAL_MS));
  const changed = priorValue === null || value !== priorValue;
  const clockReset = timestamp < priorTimestamp;
  const due = priorValue === null || clockReset || timestamp - priorTimestamp >= interval;
  const emit = changed && due;
  const state = Object.freeze({
    lastValue: emit ? value : priorValue,
    lastSentAt: emit ? timestamp : priorTimestamp,
    pendingValue: !emit && changed ? value : null,
  });
  return Object.freeze({
    value,
    emit,
    deduped: !changed,
    rateLimited: changed && !emit,
    timestamp,
    state,
  });
}
