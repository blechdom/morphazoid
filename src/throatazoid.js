export const MAX_THROATS = 5;

function defineSpecimen(specimen) {
  return Object.freeze({
    ...specimen,
    throats: Object.freeze(specimen.throats.map((throat) => Object.freeze({ ...throat }))),
  });
}

export const SPECIMENS = Object.freeze({
  triune: defineSpecimen({
    name: "Triune",
    description: "three voices",
    throatCount: 3,
    bodyLength: 0.56,
    tension: 0.58,
    mutation: 0.32,
    coupling: 0.18,
    growl: 0.2,
    wet: 0.88,
    dry: 0.08,
    spread: 0.82,
    exciterPitch: 108,
    exciterIntensity: 0.72,
    exciterTenseness: 0.62,
    exciterBreath: 0.16,
    exciterVibrato: 0.08,
    exciterWobble: 0.05,
    throats: [
      { aperture: 0.42, length: 0.64 },
      { aperture: 0.68, length: 0.48 },
      { aperture: 0.36, length: 0.78 },
    ],
  }),
  oracle: defineSpecimen({
    name: "Oracle",
    description: "one abyss",
    throatCount: 1,
    bodyLength: 0.88,
    tension: 0.28,
    mutation: 0.12,
    coupling: 0.48,
    growl: 0.1,
    wet: 1,
    dry: 0,
    spread: 0,
    exciterPitch: 67,
    exciterIntensity: 0.78,
    exciterTenseness: 0.45,
    exciterBreath: 0.22,
    exciterVibrato: 0.03,
    exciterWobble: 0.18,
    throats: [{ aperture: 0.82, length: 0.95 }],
  }),
  hive: defineSpecimen({
    name: "Hive",
    description: "five mouths",
    throatCount: 5,
    bodyLength: 0.33,
    tension: 0.75,
    mutation: 0.62,
    coupling: 0.38,
    growl: 0.28,
    wet: 0.92,
    dry: 0.03,
    spread: 1,
    exciterPitch: 176,
    exciterIntensity: 0.62,
    exciterTenseness: 0.72,
    exciterBreath: 0.1,
    exciterVibrato: 0.12,
    exciterWobble: 0.08,
    throats: [
      { aperture: 0.3, length: 0.46 },
      { aperture: 0.47, length: 0.62 },
      { aperture: 0.25, length: 0.74 },
      { aperture: 0.52, length: 0.54 },
      { aperture: 0.34, length: 0.82 },
    ],
  }),
  razor: defineSpecimen({
    name: "Razor",
    description: "metal teeth",
    throatCount: 4,
    bodyLength: 0.42,
    tension: 0.94,
    mutation: 0.82,
    coupling: 0.04,
    growl: 0.78,
    wet: 1,
    dry: 0,
    spread: 0.9,
    exciterPitch: 132,
    exciterIntensity: 0.8,
    exciterTenseness: 0.94,
    exciterBreath: 0.04,
    exciterVibrato: 0,
    exciterWobble: 0.02,
    throats: [
      { aperture: 0.14, length: 0.38 },
      { aperture: 0.22, length: 0.58 },
      { aperture: 0.1, length: 0.74 },
      { aperture: 0.18, length: 0.9 },
    ],
  }),
  monolith: defineSpecimen({
    name: "Monolith",
    description: "subterranean",
    throatCount: 1,
    bodyLength: 1,
    tension: 0.82,
    mutation: 0.04,
    coupling: 0.12,
    growl: 0.44,
    wet: 0.98,
    dry: 0.01,
    spread: 0,
    exciterPitch: 45,
    exciterIntensity: 0.92,
    exciterTenseness: 0.88,
    exciterBreath: 0.03,
    exciterVibrato: 0.02,
    exciterWobble: 0.08,
    throats: [{ aperture: 0.96, length: 1 }],
  }),
  siren: defineSpecimen({
    name: "Siren",
    description: "split signal",
    throatCount: 2,
    bodyLength: 0.32,
    tension: 0.66,
    mutation: 0.44,
    coupling: 0.18,
    growl: 0.18,
    wet: 0.94,
    dry: 0.02,
    spread: 1,
    exciterPitch: 240,
    exciterIntensity: 0.58,
    exciterTenseness: 0.58,
    exciterBreath: 0.12,
    exciterVibrato: 0.82,
    exciterWobble: 0.3,
    throats: [
      { aperture: 0.55, length: 0.25 },
      { aperture: 0.3, length: 0.78 },
    ],
  }),
  larva: defineSpecimen({
    name: "Larva",
    description: "soft membrane",
    throatCount: 2,
    bodyLength: 0.22,
    tension: 0.18,
    mutation: 0.24,
    coupling: 0.58,
    growl: 0.04,
    wet: 0.86,
    dry: 0.12,
    spread: 0.45,
    exciterPitch: 198,
    exciterIntensity: 0.42,
    exciterTenseness: 0.18,
    exciterBreath: 0.82,
    exciterVibrato: 0.16,
    exciterWobble: 0.28,
    throats: [
      { aperture: 0.72, length: 0.3 },
      { aperture: 0.62, length: 0.44 },
    ],
  }),
  cathedral: defineSpecimen({
    name: "Cathedral",
    description: "hollow colony",
    throatCount: 5,
    bodyLength: 0.95,
    tension: 0.46,
    mutation: 0.18,
    coupling: 0.7,
    growl: 0.08,
    wet: 1,
    dry: 0,
    spread: 0.75,
    exciterPitch: 83,
    exciterIntensity: 0.74,
    exciterTenseness: 0.5,
    exciterBreath: 0.26,
    exciterVibrato: 0.04,
    exciterWobble: 0.14,
    throats: [
      { aperture: 0.78, length: 0.92 },
      { aperture: 0.58, length: 0.82 },
      { aperture: 0.9, length: 1 },
      { aperture: 0.52, length: 0.74 },
      { aperture: 0.7, length: 0.88 },
    ],
  }),
  needle: defineSpecimen({
    name: "Needle",
    description: "high puncture",
    throatCount: 3,
    bodyLength: 0.24,
    tension: 0.98,
    mutation: 0.91,
    coupling: 0.02,
    growl: 0.52,
    wet: 1,
    dry: 0,
    spread: 0.6,
    exciterPitch: 310,
    exciterIntensity: 0.52,
    exciterTenseness: 0.91,
    exciterBreath: 0.06,
    exciterVibrato: 0.08,
    exciterWobble: 0.02,
    throats: [
      { aperture: 0.08, length: 0.12 },
      { aperture: 0.12, length: 0.34 },
      { aperture: 0.07, length: 0.56 },
    ],
  }),
  maw: defineSpecimen({
    name: "Maw",
    description: "overfed",
    throatCount: 2,
    bodyLength: 0.78,
    tension: 0.68,
    mutation: 0.74,
    coupling: 0.34,
    growl: 0.96,
    wet: 0.96,
    dry: 0.02,
    spread: 0.72,
    exciterPitch: 52,
    exciterIntensity: 0.96,
    exciterTenseness: 0.74,
    exciterBreath: 0.08,
    exciterVibrato: 0.03,
    exciterWobble: 0.11,
    throats: [
      { aperture: 0.98, length: 0.88 },
      { aperture: 0.72, length: 0.52 },
    ],
  }),
  choir: defineSpecimen({
    name: "Choir",
    description: "gentle swarm",
    throatCount: 5,
    bodyLength: 0.54,
    tension: 0.42,
    mutation: 0.14,
    coupling: 0.32,
    growl: 0.02,
    wet: 0.82,
    dry: 0.18,
    spread: 1,
    exciterPitch: 121,
    exciterIntensity: 0.62,
    exciterTenseness: 0.53,
    exciterBreath: 0.13,
    exciterVibrato: 0.28,
    exciterWobble: 0.22,
    throats: [
      { aperture: 0.54, length: 0.52 },
      { aperture: 0.62, length: 0.57 },
      { aperture: 0.7, length: 0.62 },
      { aperture: 0.6, length: 0.67 },
      { aperture: 0.52, length: 0.72 },
    ],
  }),
  void: defineSpecimen({
    name: "Void",
    description: "breath without body",
    throatCount: 3,
    bodyLength: 0.99,
    tension: 0.06,
    mutation: 0.92,
    coupling: 0.72,
    growl: 0.62,
    wet: 1,
    dry: 0,
    spread: 0.95,
    exciterPitch: 49,
    exciterIntensity: 0.68,
    exciterTenseness: 0.12,
    exciterBreath: 1,
    exciterVibrato: 0.46,
    exciterWobble: 0.82,
    throats: [
      { aperture: 0.15, length: 0.98 },
      { aperture: 0.64, length: 0.86 },
      { aperture: 0.08, length: 0.72 },
    ],
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
    wet: specimen.wet,
    dry: specimen.dry,
    spread: specimen.spread,
    exciterPitch: specimen.exciterPitch,
    exciterIntensity: specimen.exciterIntensity,
    exciterTenseness: specimen.exciterTenseness,
    exciterBreath: specimen.exciterBreath,
    exciterVibrato: specimen.exciterVibrato,
    exciterWobble: specimen.exciterWobble,
    throats,
  };
}

export function glottalCoefficients(tenseness = 0.6) {
  const value = clamp(tenseness);
  const rd = clamp(3 * (1 - value), 0.5, 2.7);
  const ra = -0.01 + 0.048 * rd;
  const rk = 0.224 + 0.118 * rd;
  const rg = ((rk / 4) * (0.5 + 1.2 * rk)) / (0.11 * rd - ra * (0.5 + 1.2 * rk));
  const tp = 1 / (2 * rg);
  const te = tp * (1 + rk);
  const epsilon = 1 / ra;
  const shift = Math.exp(-epsilon * (1 - te));
  const delta = 1 - shift;
  const rhs = ((shift - 1) / epsilon + (1 - te) * shift) / delta;
  const lowerIntegral = -(te - tp) / 2 + rhs;
  const upperIntegral = -lowerIntegral;
  const omega = Math.PI / tp;
  const sineAtClosure = Math.sin(omega * te);
  const logarithmInput = Math.max(
    1e-8,
    (-Math.PI * sineAtClosure * upperIntegral) / (tp * 2),
  );
  const alpha = Math.log(logarithmInput) / (tp / 2 - te);
  const e0 = -1 / (sineAtClosure * Math.exp(alpha * te));
  return { alpha, delta, e0, epsilon, omega, shift, te };
}

export function glottalSample(phase, tenseness = 0.6) {
  const interpolation = ((Number(phase) || 0) % 1 + 1) % 1;
  const coefficients = glottalCoefficients(tenseness);
  return sampleGlottis(interpolation, coefficients);
}

function sampleGlottis(interpolation, coefficients) {
  if (interpolation > coefficients.te) {
    return (
      -Math.exp(-coefficients.epsilon * (interpolation - coefficients.te))
      + coefficients.shift
    ) / coefficients.delta;
  }
  return coefficients.e0
    * Math.exp(coefficients.alpha * interpolation)
    * Math.sin(coefficients.omega * interpolation);
}

export function glottalHarmonics(tenseness = 0.6, harmonicCount = 48, sampleCount = 1024) {
  const harmonics = Math.max(4, Math.min(96, Math.round(harmonicCount)));
  const samples = Math.max(128, Math.min(4096, Math.round(sampleCount)));
  const real = new Float32Array(harmonics + 1);
  const imaginary = new Float32Array(harmonics + 1);
  const coefficients = glottalCoefficients(tenseness);
  const waveform = Float32Array.from(
    { length: samples },
    (_, index) => sampleGlottis(index / samples, coefficients),
  );
  for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
    let cosine = 0;
    let sine = 0;
    for (let index = 0; index < samples; index += 1) {
      const phase = index / samples;
      const value = waveform[index];
      const angle = Math.PI * 2 * harmonic * phase;
      cosine += value * Math.cos(angle);
      sine += value * Math.sin(angle);
    }
    real[harmonic] = cosine * 2 / samples;
    imaginary[harmonic] = sine * 2 / samples;
  }
  return { real, imaginary };
}

export function smoothEnvelope(
  previous,
  target,
  deltaMilliseconds,
  attackMilliseconds = 55,
  releaseMilliseconds = 320,
) {
  const from = Math.max(0, Number(previous) || 0);
  const to = Math.max(0, Number(target) || 0);
  const elapsed = Math.max(0, Number(deltaMilliseconds) || 0);
  const time = Math.max(1, to > from ? attackMilliseconds : releaseMilliseconds);
  return from + (to - from) * (1 - Math.exp(-elapsed / time));
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
