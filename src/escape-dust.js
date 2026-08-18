const TAU = Math.PI * 2;
const DEFAULT_WAVE_SIZE = 81;

export const ESCAPE_DUST_DEFAULTS = Object.freeze({
  classicalCount: 486,
  waveSize: DEFAULT_WAVE_SIZE,
  seed: 37,
  packetPosition: 0.24,
  packetMomentum: 0.68,
  packetSpread: 0.072,
  openingWidth: 1 / 3,
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function circularDifference(value, center) {
  const difference = Math.abs(wrap01(value) - wrap01(center));
  return Math.min(difference, 1 - difference);
}

function numericSeed(seed) {
  if (Number.isFinite(seed)) return Math.trunc(seed) >>> 0;
  const source = String(seed ?? "escape-dust");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic Mulberry32 stream for repeatable classical ensembles. */
export function createSeededRandom(seed = ESCAPE_DUST_DEFAULTS.seed) {
  let state = numericSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianPair(random) {
  const radius = Math.sqrt(-2 * Math.log(Math.max(1e-12, random())));
  const angle = TAU * random();
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/**
 * Snap a centered opening to the finite wave grid while keeping equal left
 * and right branches. The resulting three block sizes exactly sum to N, so
 * the classical branch widths and the closed block-baker quantization agree.
 */
export function openingPartition(size = DEFAULT_WAVE_SIZE, openingWidth = 1 / 3) {
  const dimension = Math.max(3, Math.round(Number(size) || DEFAULT_WAVE_SIZE));
  const requestedWidth = clamp(Number(openingWidth) || 0, 0.02, 0.86);
  let openingCells = clamp(Math.round(requestedWidth * dimension), 1, dimension - 2);
  if ((dimension - openingCells) % 2 !== 0) {
    const lower = openingCells > 1 ? openingCells - 1 : null;
    const upper = openingCells < dimension - 2 ? openingCells + 1 : null;
    const candidates = [lower, upper].filter((value) => value !== null);
    openingCells = candidates.sort((left, right) => (
      Math.abs(left / dimension - requestedWidth)
      - Math.abs(right / dimension - requestedWidth)
    ))[0];
  }
  const branchCells = (dimension - openingCells) / 2;
  return Object.freeze({
    size: dimension,
    requestedWidth,
    openingCells,
    branchCells,
    width: openingCells / dimension,
    blockSizes: Object.freeze([branchCells, openingCells, branchCells]),
  });
}

export function sanitizeEscapeDustOptions(options = {}) {
  const waveSize = Math.max(9, Math.round(Number(options.waveSize) || DEFAULT_WAVE_SIZE));
  const normalizedWaveSize = waveSize - (waveSize % 3);
  const partition = openingPartition(
    normalizedWaveSize,
    Number.isFinite(options.openingWidth)
      ? options.openingWidth
      : ESCAPE_DUST_DEFAULTS.openingWidth,
  );
  return {
    classicalCount: Math.max(
      1,
      Math.min(4096, Math.round(Number(options.classicalCount)
        || ESCAPE_DUST_DEFAULTS.classicalCount)),
    ),
    waveSize: normalizedWaveSize,
    seed: options.seed ?? ESCAPE_DUST_DEFAULTS.seed,
    packetPosition: wrap01(Number.isFinite(options.packetPosition)
      ? options.packetPosition
      : ESCAPE_DUST_DEFAULTS.packetPosition),
    packetMomentum: wrap01(Number.isFinite(options.packetMomentum)
      ? options.packetMomentum
      : ESCAPE_DUST_DEFAULTS.packetMomentum),
    packetSpread: clamp(
      Number.isFinite(options.packetSpread)
        ? options.packetSpread
        : ESCAPE_DUST_DEFAULTS.packetSpread,
      0.008,
      0.28,
    ),
    openingWidth: partition.width,
    openingCells: partition.openingCells,
    branchCells: partition.branchCells,
  };
}

/**
 * Seed a compact packet of classical phase-space points. Coordinates wrap on
 * the unit torus, matching the baker map's phase-space convention.
 */
export function createClassicalEnsemble(options = {}) {
  const settings = sanitizeEscapeDustOptions(options);
  const random = createSeededRandom(settings.seed);
  const points = [];
  for (let index = 0; index < settings.classicalCount; index += 1) {
    const [qOffset, pOffset] = gaussianPair(random);
    points.push({
      id: index,
      q: wrap01(settings.packetPosition + qOffset * settings.packetSpread),
      p: wrap01(settings.packetMomentum + pOffset * settings.packetSpread),
      alive: true,
      escapedAt: null,
      escapeQ: null,
      escapeP: null,
    });
  }
  return {
    points,
    step: 0,
    initialCount: points.length,
    survivors: points.length,
    escapedThisStep: 0,
    totalEscaped: 0,
  };
}

/**
 * One open two-branch baker step. At openingWidth = 1/3 this is the usual
 * triadic map: the middle third escapes and the outer thirds are stretched.
 */
export function stepClassicalEnsemble(ensemble, options = {}) {
  if (!ensemble?.points || !Array.isArray(ensemble.points)) {
    throw new TypeError("A classical ensemble with a points array is required.");
  }
  const openingWidth = clamp(
    Number.isFinite(options.openingWidth)
      ? options.openingWidth
      : ESCAPE_DUST_DEFAULTS.openingWidth,
    0.02,
    0.86,
  );
  const branchWidth = (1 - openingWidth) / 2;
  const openingStart = branchWidth;
  const openingEnd = 1 - branchWidth;
  const nextStep = Math.max(0, Math.trunc(ensemble.step || 0)) + 1;
  let escapedThisStep = 0;

  const points = ensemble.points.map((point) => {
    if (!point.alive) return { ...point };
    const q = wrap01(Number(point.q) || 0);
    const p = wrap01(Number(point.p) || 0);
    if (q >= openingStart && q < openingEnd) {
      escapedThisStep += 1;
      return {
        ...point,
        q,
        p,
        alive: false,
        escapedAt: nextStep,
        escapeQ: q,
        escapeP: p,
      };
    }
    if (q < openingStart) {
      return {
        ...point,
        q: q / branchWidth,
        p: branchWidth * p,
      };
    }
    return {
      ...point,
      q: (q - openingEnd) / branchWidth,
      p: openingEnd + branchWidth * p,
    };
  });

  const survivors = points.reduce((count, point) => count + (point.alive ? 1 : 0), 0);
  const initialCount = Math.max(1, Math.trunc(ensemble.initialCount || points.length));
  return {
    points,
    step: nextStep,
    initialCount,
    survivors,
    escapedThisStep,
    totalEscaped: initialCount - survivors,
  };
}

export function classicalSurvivalRatio(ensemble) {
  const initial = Math.max(1, Number(ensemble?.initialCount) || 1);
  return clamp((Number(ensemble?.survivors) || 0) / initial, 0, 1);
}

/** Return an interleaved complex array [re0, im0, re1, im1, ...]. */
export function createGaussianWavePacket(options = {}) {
  const settings = sanitizeEscapeDustOptions(options);
  const amplitudes = new Float64Array(settings.waveSize * 2);
  const sigma = Math.max(settings.packetSpread, 1 / settings.waveSize);
  let energy = 0;
  for (let index = 0; index < settings.waveSize; index += 1) {
    const q = (index + 0.5) / settings.waveSize;
    const distance = circularDifference(q, settings.packetPosition);
    const envelope = Math.exp(-(distance * distance) / (4 * sigma * sigma));
    const phase = TAU * settings.packetMomentum * index;
    const re = envelope * Math.cos(phase);
    const im = envelope * Math.sin(phase);
    amplitudes[index * 2] = re;
    amplitudes[index * 2 + 1] = im;
    energy += re * re + im * im;
  }
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 1;
  for (let index = 0; index < amplitudes.length; index += 1) {
    amplitudes[index] *= scale;
  }
  return {
    amplitudes,
    step: 0,
    initialNorm: 1,
    norm: complexEnergy(amplitudes),
    escapedThisStep: 0,
    totalLeak: 0,
  };
}

export function complexEnergy(amplitudes) {
  if (!amplitudes || amplitudes.length % 2 !== 0) {
    throw new TypeError("Interleaved complex amplitudes are required.");
  }
  let energy = 0;
  for (let index = 0; index < amplitudes.length; index += 2) {
    energy += amplitudes[index] ** 2 + amplitudes[index + 1] ** 2;
  }
  return energy;
}

/** Unitary discrete Fourier transform; inverse uses the conjugate sign. */
export function unitaryDft(amplitudes, inverse = false) {
  if (!amplitudes || amplitudes.length % 2 !== 0) {
    throw new TypeError("Interleaved complex amplitudes are required.");
  }
  const size = amplitudes.length / 2;
  const output = new Float64Array(amplitudes.length);
  const direction = inverse ? 1 : -1;
  const scale = 1 / Math.sqrt(size);
  for (let frequency = 0; frequency < size; frequency += 1) {
    let sumRe = 0;
    let sumIm = 0;
    for (let position = 0; position < size; position += 1) {
      const angle = direction * TAU * frequency * position / size;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const re = amplitudes[position * 2];
      const im = amplitudes[position * 2 + 1];
      sumRe += re * cosine - im * sine;
      sumIm += re * sine + im * cosine;
    }
    output[frequency * 2] = sumRe * scale;
    output[frequency * 2 + 1] = sumIm * scale;
  }
  return output;
}

/**
 * Closed triadic quantum-baker matrix F_N^-1 diag(F_N/3, F_N/3, F_N/3).
 * It is a finite classical calculation of a unitary matrix, not QPU output.
 */
export function applyClosedTriadicBaker(amplitudes) {
  if (!amplitudes || amplitudes.length % 2 !== 0) {
    throw new RangeError("Interleaved complex wave amplitudes are required.");
  }
  if ((amplitudes.length / 2) % 3 !== 0) {
    throw new RangeError("The closed triadic baker requires a dimension divisible by 3.");
  }
  return applyPartitionedBaker(amplitudes, 1 / 3);
}

/**
 * Unitary closed block baker F_N^-1 diag(F_L, F_M, F_R), with equal outer
 * branches and a grid-snapped centered middle block. Projection turns this
 * closed finite map into the matching open map.
 */
export function applyPartitionedBaker(amplitudes, openingWidth = 1 / 3) {
  if (!amplitudes || amplitudes.length % 2 !== 0) {
    throw new RangeError("Interleaved complex wave amplitudes are required.");
  }
  const size = amplitudes.length / 2;
  const { blockSizes } = openingPartition(size, openingWidth);
  const blocks = new Float64Array(amplitudes.length);
  let cellOffset = 0;
  for (const blockSize of blockSizes) {
    const start = cellOffset * 2;
    const transformed = unitaryDft(amplitudes.slice(start, start + blockSize * 2));
    blocks.set(transformed, start);
    cellOffset += blockSize;
  }
  return unitaryDft(blocks, true);
}

export function openingBounds(openingWidth = ESCAPE_DUST_DEFAULTS.openingWidth) {
  const width = clamp(Number(openingWidth) || 0, 0.02, 0.86);
  return Object.freeze({
    width,
    start: 0.5 - width / 2,
    end: 0.5 + width / 2,
  });
}

export function projectWaveOpening(amplitudes, openingWidth) {
  const size = amplitudes.length / 2;
  const partition = openingPartition(size, openingWidth);
  const bounds = openingBounds(partition.width);
  const projected = Float64Array.from(amplitudes);
  for (let position = 0; position < size; position += 1) {
    const q = (position + 0.5) / size;
    if (q >= bounds.start && q < bounds.end) {
      projected[position * 2] = 0;
      projected[position * 2 + 1] = 0;
    }
  }
  return projected;
}

/**
 * Project out the opening, then apply the closed baker matrix. Lost norm is
 * not restored. A tiny scalar correction removes DFT round-off only, keeping
 * the propagated energy equal to the already-projected energy rather than 1.
 */
export function stepOpenWave(wave, options = {}) {
  if (!wave?.amplitudes) throw new TypeError("A wave state is required.");
  const before = complexEnergy(wave.amplitudes);
  const partition = openingPartition(wave.amplitudes.length / 2, options.openingWidth);
  const projected = projectWaveOpening(wave.amplitudes, partition.width);
  const projectedNorm = complexEnergy(projected);
  const propagated = applyPartitionedBaker(projected, partition.width);
  const rawNorm = complexEnergy(propagated);
  if (rawNorm > 0 && projectedNorm >= 0) {
    const driftCorrection = Math.sqrt(projectedNorm / rawNorm);
    for (let index = 0; index < propagated.length; index += 1) {
      propagated[index] *= driftCorrection;
    }
  }
  const norm = complexEnergy(propagated);
  const initialNorm = Number.isFinite(wave.initialNorm) ? wave.initialNorm : before;
  return {
    amplitudes: propagated,
    step: Math.max(0, Math.trunc(wave.step || 0)) + 1,
    initialNorm,
    norm,
    escapedThisStep: Math.max(0, before - norm),
    totalLeak: Math.max(0, initialNorm - norm),
  };
}

export function wavePositionDensity(waveOrAmplitudes) {
  const amplitudes = waveOrAmplitudes?.amplitudes ?? waveOrAmplitudes;
  if (!amplitudes || amplitudes.length % 2 !== 0) {
    throw new TypeError("A wave state or interleaved complex amplitudes are required.");
  }
  const density = new Float64Array(amplitudes.length / 2);
  for (let index = 0; index < density.length; index += 1) {
    density[index] = amplitudes[index * 2] ** 2 + amplitudes[index * 2 + 1] ** 2;
  }
  return density;
}

function midiFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function livingCentroid(ensemble, fallbackQ, fallbackP) {
  let qTotal = 0;
  let pTotal = 0;
  let left = 0;
  let right = 0;
  let count = 0;
  for (const point of ensemble?.points ?? []) {
    if (!point.alive) continue;
    qTotal += point.q;
    pTotal += point.p;
    if (point.q < 0.5) left += 1;
    else right += 1;
    count += 1;
  }
  return {
    q: count ? qTotal / count : fallbackQ,
    p: count ? pTotal / count : fallbackP,
    count,
    left,
    right,
  };
}

function normalizedDensityEntropy(density) {
  const total = density.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || density.length <= 1) return 0;
  let entropy = 0;
  for (const value of density) {
    if (value <= 0) continue;
    const probability = value / total;
    entropy -= probability * Math.log(probability);
  }
  return clamp(entropy / Math.log(density.length), 0, 1);
}

function wavePhaseSlope(amplitudes, fallback = 0.5) {
  let real = 0;
  let imaginary = 0;
  const size = amplitudes.length / 2;
  for (let index = 0; index < size; index += 1) {
    const next = (index + 1) % size;
    const re = amplitudes[index * 2];
    const im = amplitudes[index * 2 + 1];
    const nextRe = amplitudes[next * 2];
    const nextIm = amplitudes[next * 2 + 1];
    real += re * nextRe + im * nextIm;
    imaginary += re * nextIm - im * nextRe;
  }
  if (Math.hypot(real, imaginary) < 1e-12) return fallback;
  return wrap01(Math.atan2(imaginary, real) / TAU);
}

/**
 * Deterministic sonification contract shared by the UI and tests. The mapping
 * remains stable while the map changes: phase-space location selects register
 * and melody, spread/entropy roughen the harmony, survivor branches create
 * spatial clicks, norm controls ensemble weight, and escape flux accents it.
 */
export function deriveEscapeDustSound(simulation) {
  if (!simulation?.classical || !simulation?.wave) {
    throw new TypeError("An Escape Dust simulation is required.");
  }
  const settings = sanitizeEscapeDustOptions(simulation.settings);
  const centroid = livingCentroid(
    simulation.classical,
    settings.packetPosition,
    settings.packetMomentum,
  );
  const positionDensity = wavePositionDensity(simulation.wave);
  const entropy = normalizedDensityEntropy(positionDensity);
  const phaseSlope = wavePhaseSlope(
    simulation.wave.amplitudes,
    settings.packetMomentum,
  );
  const waveNorm = clamp(simulation.wave.norm, 0, 1);
  const survival = classicalSurvivalRatio(simulation.classical);
  const phraseStep = Math.max(0, Math.trunc(simulation.step || 0)) % 8;
  const phraseShape = [1, 0.82, 0.9, 0.72, 0.96, 0.76, 0.86, 0.66][phraseStep];
  const restStride = Math.max(2, Math.round(8 - settings.openingWidth * 12));
  const resting = simulation.step > 0 && simulation.step % restStride === 0;
  const scale = [0, 2, 5, 7, 10];
  const degree = scale[Math.min(scale.length - 1, Math.floor(phaseSlope * scale.length))];
  const rootMidi = 36 + Math.round(centroid.q * 24) + degree;
  const rootFrequency = midiFrequency(rootMidi);
  const texture = clamp(settings.packetSpread / 0.18 * 0.58 + entropy * 0.42, 0, 1);
  const availableVoices = Math.round(
    10 * Math.sqrt(waveNorm) * (1 - settings.openingWidth * 0.72),
  );
  const voiceCount = waveNorm < 1e-5 ? 0 : Math.max(1, Math.min(10, availableVoices));
  const intervals = [0, 7, 12, 17, 19, 24, 28, 31, 36, 41];
  const chordGain = 0.1 * Math.sqrt(waveNorm) * phraseShape;
  const waveVoices = Array.from({ length: voiceCount }, (_, index) => {
    const signed = index === 0 ? 0 : (index % 2 ? -1 : 1);
    const spreadDetune = signed * texture * (0.16 + index * 0.055);
    return {
      key: `escape-wave-${index}`,
      frequency: clamp(rootFrequency * 2 ** ((intervals[index] + spreadDetune) / 12), 24, 12_000),
      gain: chordGain / Math.sqrt(index + 1),
      pan: voiceCount <= 1 ? 0 : -0.72 + 1.44 * index / (voiceCount - 1),
      waveform: index % 3 === 2 && texture > 0.52 ? "triangle" : "sine",
      mode: "pm",
      synthDrive: texture,
      modulationIndex: 0.4 + texture * 3.8,
      modulationRatio: 1 + phaseSlope * 2,
      gainSmoothingSeconds: 0.03,
    };
  });

  const branchTotal = Math.max(1, centroid.left + centroid.right);
  const clickGain = resting ? 0 : 0.07 + 0.12 * Math.sqrt(survival);
  const classicalClicks = [
    {
      key: `escape-click-left-${simulation.step}`,
      frequency: clamp(rootFrequency * 2 ** ((12 + centroid.p * 5) / 12), 32, 12_000),
      gain: clickGain * Math.sqrt(centroid.left / branchTotal),
      pan: -0.78,
      waveform: "triangle",
      delay: 0,
    },
    {
      key: `escape-click-right-${simulation.step}`,
      frequency: clamp(rootFrequency * 2 ** ((19 - centroid.p * 4) / 12), 32, 12_000),
      gain: clickGain * Math.sqrt(centroid.right / branchTotal),
      pan: 0.78,
      waveform: "triangle",
      delay: 0.018 + 0.018 * (1 - centroid.p),
    },
  ];
  const classicalFlux = simulation.classical.initialCount > 0
    ? simulation.classical.escapedThisStep / simulation.classical.initialCount
    : 0;
  const waveFlux = Math.max(0, simulation.wave.escapedThisStep);
  const escapeFlux = clamp(classicalFlux + waveFlux, 0, 1);
  const accentForFlux = (flux, layer) => ({
    key: `escape-flux-${layer}-${simulation.step}`,
    frequency: clamp(rootFrequency * 2 ** ((30 + settings.openingWidth * 16) / 12), 40, 12_000),
    gain: flux > 1e-8 ? 0.08 + 0.3 * Math.sqrt(flux) : 0,
    pan: clamp((centroid.q - 0.5) * 1.4, -0.7, 0.7),
    waveform: "sawtooth",
    attackNoise: clamp(0.25 + flux * 1.8, 0, 1),
    flux,
  });
  const classicalEscapeAccent = accentForFlux(classicalFlux, "classical");
  const waveEscapeAccent = accentForFlux(waveFlux, "wave");
  const escapeAccent = accentForFlux(escapeFlux, "overlay");

  return {
    waveVoices,
    classicalClicks,
    classicalEscapeAccent,
    waveEscapeAccent,
    escapeAccent,
    telemetry: Object.freeze({
      rootMidi,
      rootFrequency,
      melodicDegree: degree,
      phaseSlope,
      texture,
      entropy,
      voiceCount,
      restStride,
      resting,
      phraseStep,
      phraseShape,
      survival,
      waveNorm,
      classicalFlux,
      waveFlux,
      escapeFlux,
      leftFraction: centroid.left / branchTotal,
      rightFraction: centroid.right / branchTotal,
    }),
  };
}

/** Count living classical points into a square phase-space histogram. */
export function classicalPhaseSpaceDensity(ensemble, gridSize = 21) {
  const size = Math.max(3, Math.min(81, Math.round(gridSize)));
  const values = new Float64Array(size * size);
  for (const point of ensemble?.points ?? []) {
    if (!point.alive) continue;
    const x = Math.min(size - 1, Math.floor(wrap01(point.q) * size));
    const y = Math.min(size - 1, Math.floor(wrap01(point.p) * size));
    values[(size - 1 - y) * size + x] += 1;
  }
  return { size, values, total: Number(ensemble?.survivors) || 0 };
}

/**
 * Gaussian-windowed Fourier energy on a coarse q/p grid. This spectrogram is
 * a display diagnostic; its cells are scaled to the current unnormalized norm.
 */
export function windowedFourierDensity(waveOrAmplitudes, gridSize = 21) {
  const amplitudes = waveOrAmplitudes?.amplitudes ?? waveOrAmplitudes;
  if (!amplitudes || amplitudes.length % 2 !== 0) {
    throw new TypeError("A wave state or interleaved complex amplitudes are required.");
  }
  const waveSize = amplitudes.length / 2;
  const size = Math.max(3, Math.min(48, Math.round(gridSize)));
  const values = new Float64Array(size * size);
  const windowSigma = Math.max(1.5 / size, 1.5 / Math.sqrt(waveSize));
  let total = 0;

  for (let y = 0; y < size; y += 1) {
    const frequency = Math.round(y * waveSize / size) % waveSize;
    for (let x = 0; x < size; x += 1) {
      const center = (x + 0.5) / size;
      let sumRe = 0;
      let sumIm = 0;
      for (let position = 0; position < waveSize; position += 1) {
        const q = (position + 0.5) / waveSize;
        const distance = circularDifference(q, center);
        const window = Math.exp(-(distance * distance) / (2 * windowSigma * windowSigma));
        const angle = -TAU * frequency * position / waveSize;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const re = amplitudes[position * 2];
        const im = amplitudes[position * 2 + 1];
        sumRe += window * (re * cosine - im * sine);
        sumIm += window * (re * sine + im * cosine);
      }
      const energy = sumRe * sumRe + sumIm * sumIm;
      const index = (size - 1 - y) * size + x;
      values[index] = energy;
      total += energy;
    }
  }

  const target = complexEnergy(amplitudes);
  const scale = total > 0 ? target / total : 0;
  for (let index = 0; index < values.length; index += 1) values[index] *= scale;
  return { size, values, total: target };
}

export function createEscapeDustSimulation(options = {}) {
  const settings = sanitizeEscapeDustOptions(options);
  const classical = createClassicalEnsemble(settings);
  const wave = createGaussianWavePacket(settings);
  return {
    settings,
    step: 0,
    classical,
    wave,
    classicalDensity: classicalPhaseSpaceDensity(classical),
    waveDensity: windowedFourierDensity(wave),
  };
}

export function stepEscapeDustSimulation(simulation, options = {}) {
  if (!simulation?.classical || !simulation?.wave) {
    throw new TypeError("An Escape Dust simulation is required.");
  }
  const openingWidth = Number.isFinite(options.openingWidth)
    ? options.openingWidth
    : simulation.settings?.openingWidth;
  const settings = sanitizeEscapeDustOptions({
    ...simulation.settings,
    ...options,
    openingWidth,
  });
  const classical = stepClassicalEnsemble(simulation.classical, settings);
  const wave = stepOpenWave(simulation.wave, settings);
  return {
    settings,
    step: Math.max(classical.step, wave.step),
    classical,
    wave,
    classicalDensity: classicalPhaseSpaceDensity(classical),
    waveDensity: windowedFourierDensity(wave),
  };
}
