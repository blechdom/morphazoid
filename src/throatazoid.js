export const MAX_THROATS = 5;

export const SPECIMENS = Object.freeze({
  triune: Object.freeze({
    name: "Triune",
    throatCount: 3,
    bodyLength: 0.56,
    tension: 0.58,
    mutation: 0.32,
    coupling: 0.18,
    growl: 0.2,
    throats: Object.freeze([
      Object.freeze({ aperture: 0.42, length: 0.64 }),
      Object.freeze({ aperture: 0.68, length: 0.48 }),
      Object.freeze({ aperture: 0.36, length: 0.78 }),
    ]),
  }),
  oracle: Object.freeze({
    name: "Oracle",
    throatCount: 1,
    bodyLength: 0.86,
    tension: 0.32,
    mutation: 0.15,
    coupling: 0.28,
    growl: 0.13,
    throats: Object.freeze([
      Object.freeze({ aperture: 0.78, length: 0.9 }),
    ]),
  }),
  hive: Object.freeze({
    name: "Hive",
    throatCount: 5,
    bodyLength: 0.38,
    tension: 0.72,
    mutation: 0.58,
    coupling: 0.42,
    growl: 0.31,
    throats: Object.freeze([
      Object.freeze({ aperture: 0.3, length: 0.46 }),
      Object.freeze({ aperture: 0.47, length: 0.62 }),
      Object.freeze({ aperture: 0.25, length: 0.74 }),
      Object.freeze({ aperture: 0.52, length: 0.54 }),
      Object.freeze({ aperture: 0.34, length: 0.82 }),
    ]),
  }),
  razor: Object.freeze({
    name: "Razor",
    throatCount: 4,
    bodyLength: 0.44,
    tension: 0.9,
    mutation: 0.77,
    coupling: 0.08,
    growl: 0.66,
    throats: Object.freeze([
      Object.freeze({ aperture: 0.16, length: 0.42 }),
      Object.freeze({ aperture: 0.24, length: 0.6 }),
      Object.freeze({ aperture: 0.12, length: 0.72 }),
      Object.freeze({ aperture: 0.2, length: 0.88 }),
    ]),
  }),
});

export function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function defaultThroat(index) {
  return {
    aperture: clamp(0.36 + ((index * 0.19) % 0.38)),
    length: clamp(0.45 + ((index * 0.17) % 0.44)),
    muted: false,
  };
}

export function specimenState(name = "triune") {
  const key = SPECIMENS[name] ? name : "triune";
  const specimen = SPECIMENS[key];
  const throats = Array.from({ length: MAX_THROATS }, (_, index) => ({
    ...defaultThroat(index),
    ...(specimen.throats[index] ?? {}),
    muted: false,
  }));
  return {
    specimen: key,
    throatCount: specimen.throatCount,
    bodyLength: specimen.bodyLength,
    tension: specimen.tension,
    mutation: specimen.mutation,
    coupling: specimen.coupling,
    growl: specimen.growl,
    throats,
  };
}

export function throatSlots(count) {
  const total = Math.round(clamp(count, 1, MAX_THROATS));
  if (total === 1) return [0];
  const spread = total === 2 ? 0.44 : total === 3 ? 0.68 : 0.82;
  return Array.from(
    { length: total },
    (_, index) => -spread + (index / (total - 1)) * spread * 2,
  );
}

function unitVector(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const magnitude = Math.max(0.0001, Math.hypot(dx, dy));
  return { x: dx / magnitude, y: dy / magnitude };
}

function offsetPoint(point, normal, distance) {
  return {
    x: point.x + normal.x * distance,
    y: point.y + normal.y * distance,
  };
}

export function anatomyLayout(width, height, state) {
  const safeWidth = Math.max(320, Number(width) || 320);
  const safeHeight = Math.max(220, Number(height) || 220);
  const shortSide = Math.min(safeWidth, safeHeight);
  const centerY = safeHeight * 0.5;
  const root = { x: safeWidth * 0.105, y: centerY };
  const larynx = {
    x: safeWidth * (0.205 + clamp(state.bodyLength) * 0.055),
    y: centerY,
  };
  const junction = {
    x: safeWidth * (0.36 + clamp(state.bodyLength) * 0.105),
    y: centerY,
  };
  const bodyRadius = shortSide * (0.084 + clamp(state.tension) * 0.016);
  const slots = throatSlots(state.throatCount);
  const branches = slots.map((slot, index) => {
    const throat = state.throats[index] ?? defaultThroat(index);
    const length = clamp(throat.length);
    const aperture = clamp(throat.aperture);
    const mouth = {
      x: safeWidth * (0.78 + length * 0.145),
      y: centerY + slot * safeHeight * 0.355,
    };
    const direction = unitVector(junction, mouth);
    const normal = { x: -direction.y, y: direction.x };
    const outerSign = Math.abs(slot) < 0.001 ? -1 : Math.sign(slot);
    const mutationDirection = index % 2 === 0 ? 1 : -1;
    const bend = {
      x: junction.x + (mouth.x - junction.x) * (0.47 + (length - 0.5) * 0.08),
      y: junction.y + (mouth.y - junction.y) * 0.48
        + mutationDirection * clamp(state.mutation) * shortSide * 0.038,
    };
    const widthAtJunction = shortSide * (0.014 + aperture * 0.015);
    const widthAtBend = shortSide * (0.022 + aperture * 0.069);
    const widthAtMouth = shortSide * (0.009 + aperture * 0.042);
    const handle = offsetPoint(bend, normal, widthAtBend * outerSign);
    const polygon = [
      offsetPoint(junction, normal, widthAtJunction),
      offsetPoint(bend, normal, widthAtBend),
      offsetPoint(mouth, normal, widthAtMouth),
      offsetPoint(mouth, normal, -widthAtMouth),
      offsetPoint(bend, normal, -widthAtBend),
      offsetPoint(junction, normal, -widthAtJunction),
    ];
    return {
      index,
      slot,
      root: junction,
      bend,
      mouth,
      direction,
      normal,
      outerSign,
      handle,
      polygon,
      aperture,
      length,
      muted: Boolean(throat.muted),
    };
  });

  return {
    width: safeWidth,
    height: safeHeight,
    shortSide,
    centerY,
    root,
    larynx,
    junction,
    bodyRadius,
    branches,
  };
}

export function throatVoiceParameters(state, index, sampleRate = 48_000) {
  const count = Math.round(clamp(state.throatCount, 1, MAX_THROATS));
  const throat = state.throats[index] ?? defaultThroat(index);
  const aperture = clamp(throat.aperture);
  const length = clamp(throat.length);
  const bodyLength = clamp(state.bodyLength);
  const tension = clamp(state.tension);
  const mutation = clamp(state.mutation);
  const growl = clamp(state.growl);
  const nyquistLimit = Math.max(4_000, Number(sampleRate) * 0.45);
  const tractScale = 0.68 + (1 - bodyLength) * 0.68;
  const mutationSkew = 1 + Math.sin((index + 1) * 2.17) * mutation * 0.16;
  const first = (170 + aperture * 720) * tractScale * mutationSkew;
  const second = (610 + (1 - length) * 1_760 + index * 118) * tractScale;
  const third = Math.min(
    nyquistLimit,
    (1_680 + aperture * 1_620 + index * 205) * tractScale * (2 - mutationSkew),
  );
  const fourth = Math.min(
    nyquistLimit,
    (3_250 + length * 2_100 + index * 270) * (0.82 + tension * 0.32),
  );
  const resonance = 2.4 + tension * 8.8 + (1 - aperture) * 4.2;
  const pan = count === 1 ? 0 : (index / (count - 1)) * 2 - 1;

  return {
    formants: [first, second, third, fourth].map((frequency) => (
      clamp(frequency, 80, nyquistLimit)
    )),
    resonance,
    peakGains: [
      8 + aperture * 6,
      11 - aperture * 2,
      7 + mutation * 5,
      3 + tension * 4,
    ],
    lowpass: clamp(2_200 + aperture * 9_800 + tension * 2_000, 1_600, nyquistLimit),
    highpass: 48 + (1 - aperture) * 190,
    delay: 0.003 + length * 0.028 + index * mutation * 0.0017,
    pan,
    ringFrequency: 23 + index * 17 + mutation * 83 + tension * 29,
    ringMix: growl * (0.12 + mutation * 0.48),
    normalMix: 1 - growl * 0.42,
    gain: throat.muted ? 0 : 1 / Math.sqrt(count),
  };
}

export function waveformLevel(samples) {
  if (!samples?.length) return { rms: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(Number(sample) || 0);
    sum += magnitude * magnitude;
    peak = Math.max(peak, magnitude);
  }
  return {
    rms: Math.sqrt(sum / samples.length),
    peak,
  };
}

