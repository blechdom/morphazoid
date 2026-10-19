export const CORD_COUNT = 3;
export const MAX_SOURCE_SECONDS = 30;
export const MIN_KNOT_DISTANCE = 0.02;
export const DEFAULT_CORDS = Object.freeze([
  Object.freeze({ start: 0.04, end: 0.36, stretch: 1, reverse: false, next: null }),
  Object.freeze({ start: 0.34, end: 0.68, stretch: 1.6, reverse: false, next: null }),
  Object.freeze({ start: 0.63, end: 0.96, stretch: 0.8, reverse: true, next: null }),
]);

export function clamp(value, minimum, maximum, fallback = minimum) {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

export function normalizeCord(value = {}, fallback = DEFAULT_CORDS[0]) {
  const source = value && typeof value === "object" ? value : {};
  let start = clamp(source.start, 0, 1 - MIN_KNOT_DISTANCE, fallback.start);
  let end = clamp(source.end, MIN_KNOT_DISTANCE, 1, fallback.end);
  if (end < start + MIN_KNOT_DISTANCE) end = Math.min(1, start + MIN_KNOT_DISTANCE);
  start = Math.min(start, end - MIN_KNOT_DISTANCE);
  const link = source.next === undefined ? fallback.next : source.next;
  return {
    start, end,
    stretch: clamp(source.stretch, 0.5, 4, fallback.stretch),
    reverse: typeof source.reverse === "boolean" ? source.reverse : fallback.reverse,
    next: Number.isInteger(link) && link >= 0 && link < CORD_COUNT ? link : null,
  };
}

export function createDefaultState() {
  return { cords: DEFAULT_CORDS.map(cord => ({ ...cord })), activeCord: 0 };
}

export function normalizeState(value = {}, fallback = createDefaultState()) {
  const source = value && typeof value === "object" ? value : {};
  return {
    cords: DEFAULT_CORDS.map((cord, index) => normalizeCord(source.cords?.[index], fallback.cords?.[index] ?? cord)),
    activeCord: Math.round(clamp(source.activeCord, 0, CORD_COUNT - 1, fallback.activeCord ?? 0)),
  };
}

export function cordEntry(cord) { return cord.reverse ? cord.end : cord.start; }

export function sanitizeSource(samples, sampleRate = 48000) {
  const rate = Math.round(clamp(sampleRate, 8000, 192000, 48000));
  const length = Math.min(Math.max(0, Math.trunc(samples?.length) || 0), rate * MAX_SOURCE_SECONDS);
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) result[i] = clamp(samples[i], -1, 1, 0);
  return { samples: result, sampleRate: rate };
}

/** Original, deterministic material: irregular plucks, sliding chirps and dry taps.
 * Frequencies and onset spacing are continuous, without scale quantization. */
export function createDemo(sampleRate = 48000) {
  const rate = Math.round(clamp(sampleRate, 8000, 192000, 48000));
  const samples = new Float32Array(rate * 8);
  const events = [
    [0.09, 137.3, 0], [0.47, 223.7, 0], [0.96, 301.13, 1], [1.37, 176.9, 0],
    [1.55, 436.4, 2], [2.24, 352.8, 0], [2.83, 191.6, 1], [3.04, 577.7, 2],
    [3.23, 268.2, 0], [3.51, 167.4, 0], [4.12, 397.1, 1], [4.73, 129.8, 0],
    [4.91, 681.3, 2], [5.11, 254.9, 0], [5.62, 472.6, 1], [6.29, 205.3, 0],
    [6.43, 527.9, 2], [6.81, 319.4, 0], [7.32, 153.6, 0],
  ];
  let seed = 0x74696d65;
  const noise = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 2147483648 - 1;
  };
  for (let event = 0; event < events.length; event++) {
    const [onset, frequency, type] = events[event];
    const offset = Math.round(onset * rate);
    const duration = type === 2 ? 0.13 : type === 1 ? 0.54 : 1.02;
    let filteredNoise = 0;
    for (let i = 0; i < duration * rate && offset + i < samples.length; i++) {
      const t = i / rate;
      const attack = Math.min(1, t / 0.003);
      let value;
      if (type === 0) {
        const phase = Math.PI * 2 * frequency * t;
        value = (Math.sin(phase) + 0.37 * Math.sin(phase * 2.013) * Math.exp(-t * 8)
          + 0.19 * Math.sin(phase * 3.971) * Math.exp(-t * 19)) * Math.exp(-t * 5.2);
      } else if (type === 1) {
        const phase = Math.PI * 2 * (frequency * t + frequency * 0.72 * t * t);
        value = Math.sin(phase) * Math.sin(Math.PI * t / duration) ** 2 * 0.53;
      } else {
        const n = noise(); filteredNoise += (n - filteredNoise) * 0.14;
        value = ((n - filteredNoise) * 0.45 + Math.sin(Math.PI * 2 * frequency * t) * 0.5) * Math.exp(-t * 53);
      }
      value *= attack * (0.4 + (event % 4) * 0.045);
      samples[offset + i] += value;
      if (type !== 2) {
        const echo = offset + i + Math.round(rate * (0.193 + event % 3 * 0.021));
        if (echo < samples.length) samples[echo] += value * 0.19;
      }
    }
  }
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const scale = peak > 0 ? 0.66 / peak : 1;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale * Math.min(1, (samples.length - i) / (rate * 0.025));
  return samples;
}

export function getWaveform(samples, bins = 96) {
  const count = Math.round(clamp(bins, 8, 1024, 96));
  const peaks = new Float32Array(count);
  if (!samples?.length) return peaks;
  for (let bin = 0; bin < count; bin++) {
    const start = Math.floor(bin * samples.length / count);
    const end = Math.max(start + 1, Math.floor((bin + 1) * samples.length / count));
    for (let i = start; i < end && i < samples.length; i++) peaks[bin] = Math.max(peaks[bin], Math.abs(clamp(samples[i], -1, 1, 0)));
  }
  return peaks;
}

/** Silent visual preview only. Audible transport is advanced per sample by DSP. */
export function advanceTransport(snapshot, seconds, durations = [8, 8, 8]) {
  const state = normalizeState(snapshot);
  let index = state.activeCord;
  let cord = state.cords[index];
  let position = clamp(snapshot?.position, cord.start, cord.end, cordEntry(cord));
  let remaining = snapshot?.playing === false ? 0 : clamp(seconds, 0, 1, 0);
  let transitions = Math.max(0, Math.trunc(snapshot?.transitions) || 0);
  for (let guard = 0; remaining > 0 && guard < 256; guard++) {
    const duration = clamp(durations[index], 0.001, MAX_SOURCE_SECONDS, 8);
    const distance = cord.reverse ? position - cord.start : cord.end - position;
    const toExit = distance * duration * cord.stretch;
    if (remaining < toExit) {
      position += (cord.reverse ? -1 : 1) * remaining / (duration * cord.stretch);
      remaining = 0;
    } else {
      remaining -= toExit;
      index = cord.next ?? index;
      cord = state.cords[index]; position = cordEntry(cord); transitions++;
    }
  }
  return { ...snapshot, ...state, activeCord: index, position, transitions,
    phase: clamp((position - cord.start) / (cord.end - cord.start), 0, 1) };
}
