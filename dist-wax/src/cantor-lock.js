/**
 * Finite, classical Fourier model for the Cantor Lock experiment.
 *
 * The vectors are interleaved complex arrays: [re0, im0, re1, im1, ...].
 * Both transform directions use the unitary 1 / sqrt(N) convention, so energy
 * comparisons are meaningful without a hidden normalization step.
 */

const TAU = Math.PI * 2;
const MIN_DEPTH = 1;
const MAX_DEPTH = 5;
const twiddleCache = new Map();

function integer(value, name, minimum = Number.MIN_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new RangeError(`${name} must be a safe integer at least ${minimum}.`);
  }
  return number;
}

function validateDepth(depth) {
  const value = integer(depth, "depth", MIN_DEPTH);
  if (value > MAX_DEPTH) throw new RangeError(`depth must be at most ${MAX_DEPTH}.`);
  return value;
}

function validateComplex(vector, name = "vector") {
  if ((!Array.isArray(vector) && !ArrayBuffer.isView(vector)) || vector.length % 2 !== 0) {
    throw new TypeError(`${name} must be an interleaved complex array.`);
  }
  if (vector.length === 0) throw new RangeError(`${name} cannot be empty.`);
  for (const value of vector) {
    if (!Number.isFinite(Number(value))) throw new RangeError(`${name} must be finite.`);
  }
  return vector.length / 2;
}

function validateMask(mask, size, name = "mask") {
  if ((!Array.isArray(mask) && !ArrayBuffer.isView(mask)) || mask.length !== size) {
    throw new RangeError(`${name} must have ${size} entries.`);
  }
}

function modulo(value, size) {
  return ((value % size) + size) % size;
}

function hashSeed(seed) {
  const source = String(seed ?? "cantor-lock");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG: small, repeatable, and deliberately not cryptographic. */
export function createSeededRandom(seed = "cantor-lock") {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function cantorDimension(depth) {
  return 3 ** validateDepth(depth);
}

/** Discrete middle-third Cantor set, optionally translated around the circle. */
export function cantorMask(depth, offset = 0) {
  const level = validateDepth(depth);
  const size = 3 ** level;
  const shift = modulo(integer(offset, "offset"), size);
  const mask = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    let address = modulo(index - shift, size);
    let retained = true;
    for (let digit = 0; digit < level; digit += 1) {
      if (address % 3 === 1) {
        retained = false;
        break;
      }
      address = Math.floor(address / 3);
    }
    mask[index] = retained ? 1 : 0;
  }
  return mask;
}

/** Contiguous comparison window with exactly the same number of cells. */
export function solidIntervalMask(size, count, offset = 0) {
  const length = integer(size, "size", 1);
  const occupied = integer(count, "count", 1);
  if (occupied > length) throw new RangeError("count cannot exceed size.");
  const start = modulo(integer(offset, "offset"), length);
  const mask = new Uint8Array(length);
  for (let index = 0; index < occupied; index += 1) mask[modulo(start + index, length)] = 1;
  return mask;
}

export function countMask(mask) {
  if (!Array.isArray(mask) && !ArrayBuffer.isView(mask)) {
    throw new TypeError("mask must be an array or typed array.");
  }
  return Array.from(mask, Number).reduce((sum, value) => sum + (value ? 1 : 0), 0);
}

export function buildCantorLockMasks({ depth = 4, offset = 0, mode = "cantor" } = {}) {
  const level = validateDepth(depth);
  const size = 3 ** level;
  const shift = modulo(integer(offset, "offset"), size);
  const count = 2 ** level;
  const normalizedMode = mode === "solid" ? "solid" : "cantor";
  const factory = normalizedMode === "solid"
    ? () => solidIntervalMask(size, count, shift)
    : () => cantorMask(level, shift);
  // Mirroring Y makes the two translated masks visibly distinct while keeping
  // their dimensions and porosity identical.
  const positionMask = factory();
  const frequencyMask = normalizedMode === "solid"
    ? solidIntervalMask(size, count, -shift)
    : cantorMask(level, -shift);
  return { depth: level, size, count, offset: shift, mode: normalizedMode, positionMask, frequencyMask };
}

function twiddles(size) {
  if (twiddleCache.has(size)) return twiddleCache.get(size);
  const cosine = new Float64Array(size * size);
  const sine = new Float64Array(size * size);
  for (let bin = 0; bin < size; bin += 1) {
    for (let sample = 0; sample < size; sample += 1) {
      const angle = TAU * bin * sample / size;
      const index = bin * size + sample;
      cosine[index] = Math.cos(angle);
      sine[index] = Math.sin(angle);
    }
  }
  const table = { cosine, sine };
  twiddleCache.set(size, table);
  return table;
}

/** Unitary discrete Fourier transform. Pass inverse:true for F^-1. */
export function unitaryDft(vector, { inverse = false } = {}) {
  const size = validateComplex(vector);
  const output = new Float64Array(vector.length);
  const { cosine, sine } = twiddles(size);
  const scale = 1 / Math.sqrt(size);
  for (let bin = 0; bin < size; bin += 1) {
    let real = 0;
    let imaginary = 0;
    for (let sample = 0; sample < size; sample += 1) {
      const inputReal = Number(vector[sample * 2]);
      const inputImaginary = Number(vector[sample * 2 + 1]);
      const tableIndex = bin * size + sample;
      const c = cosine[tableIndex];
      const s = sine[tableIndex];
      if (inverse) {
        real += inputReal * c - inputImaginary * s;
        imaginary += inputReal * s + inputImaginary * c;
      } else {
        real += inputReal * c + inputImaginary * s;
        imaginary += inputImaginary * c - inputReal * s;
      }
    }
    output[bin * 2] = real * scale;
    output[bin * 2 + 1] = imaginary * scale;
  }
  return output;
}

export function inverseUnitaryDft(vector) {
  return unitaryDft(vector, { inverse: true });
}

export function complexEnergy(vector, mask = null) {
  const size = validateComplex(vector);
  if (mask !== null) validateMask(mask, size);
  let energy = 0;
  for (let index = 0; index < size; index += 1) {
    if (mask !== null && !mask[index]) continue;
    const real = Number(vector[index * 2]);
    const imaginary = Number(vector[index * 2 + 1]);
    energy += real * real + imaginary * imaginary;
  }
  return energy;
}

export function normalizeComplex(vector) {
  validateComplex(vector);
  const norm = Math.sqrt(complexEnergy(vector));
  if (!(norm > 0)) throw new RangeError("a zero complex vector cannot be normalized.");
  return Float64Array.from(vector, (value) => Number(value) / norm);
}

export function projectComplex(vector, mask) {
  const size = validateComplex(vector);
  validateMask(mask, size);
  const projected = new Float64Array(vector.length);
  for (let index = 0; index < size; index += 1) {
    if (!mask[index]) continue;
    projected[index * 2] = Number(vector[index * 2]);
    projected[index * 2 + 1] = Number(vector[index * 2 + 1]);
  }
  return projected;
}

export function complexMagnitudes(vector) {
  const size = validateComplex(vector);
  return Array.from({ length: size }, (_, index) => Math.hypot(
    Number(vector[index * 2]),
    Number(vector[index * 2 + 1]),
  ));
}

/** A = P_X F^-1 P_Y. The input lives in the frequency coordinate. */
export function applyRestrictedOperator(vector, positionMask, frequencyMask) {
  const size = validateComplex(vector);
  validateMask(positionMask, size, "positionMask");
  validateMask(frequencyMask, size, "frequencyMask");
  return projectComplex(
    inverseUnitaryDft(projectComplex(vector, frequencyMask)),
    positionMask,
  );
}

/** A* = P_Y F P_X. */
export function applyRestrictedAdjoint(vector, positionMask, frequencyMask) {
  const size = validateComplex(vector);
  validateMask(positionMask, size, "positionMask");
  validateMask(frequencyMask, size, "frequencyMask");
  return projectComplex(
    unitaryDft(projectComplex(vector, positionMask)),
    frequencyMask,
  );
}

export function seededMaskState(mask, seed = 1) {
  if (!Array.isArray(mask) && !ArrayBuffer.isView(mask)) {
    throw new TypeError("mask must be an array or typed array.");
  }
  if (!mask.length || countMask(mask) === 0) throw new RangeError("mask must retain at least one cell.");
  const random = createSeededRandom(seed);
  const vector = new Float64Array(mask.length * 2);
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const angle = TAU * random();
    vector[index * 2] = Math.cos(angle);
    vector[index * 2 + 1] = Math.sin(angle);
  }
  return normalizeComplex(vector);
}

function concentrationReceipt(frequencyState, positionMask, frequencyMask) {
  const maskedFrequencyState = projectComplex(frequencyState, frequencyMask);
  const normalizedFrequencyState = normalizeComplex(maskedFrequencyState);
  const fullPositionState = inverseUnitaryDft(normalizedFrequencyState);
  const positionState = projectComplex(fullPositionState, positionMask);
  const leakState = new Float64Array(fullPositionState.length);
  for (let index = 0; index < positionMask.length; index += 1) {
    if (positionMask[index]) continue;
    leakState[index * 2] = fullPositionState[index * 2];
    leakState[index * 2 + 1] = fullPositionState[index * 2 + 1];
  }
  const retainedEnergy = Math.max(0, Math.min(1, complexEnergy(positionState)));
  // Parseval makes this the exact complement analytically. Express it that
  // way so the public receipt always closes to one despite round-off in the
  // independently constructed leak vector.
  const leakedEnergy = 1 - retainedEnergy;
  return {
    frequencyState: normalizedFrequencyState,
    fullPositionState,
    positionState,
    leakState,
    retainedEnergy,
    leakedEnergy,
    responseNorm: Math.sqrt(retainedEnergy),
  };
}

/**
 * Power iteration on A* A. The returned responseNorm = ||A v|| approaches
 * sigma_max(A) as the finite iteration converges; it is not treated as an
 * exact singular value or used to infer a theorem bound.
 */
export function optimizeRestrictedConcentration({
  positionMask,
  frequencyMask,
  seed = 1,
  iterations = 32,
} = {}) {
  if (!positionMask || !frequencyMask) throw new TypeError("both masks are required.");
  if (positionMask.length !== frequencyMask.length) throw new RangeError("masks must have equal length.");
  const steps = integer(iterations, "iterations", 0);
  let frequencyState = seededMaskState(frequencyMask, seed);
  const initial = concentrationReceipt(frequencyState, positionMask, frequencyMask);
  const history = [initial.retainedEnergy];

  for (let step = 0; step < steps; step += 1) {
    const positionState = applyRestrictedOperator(frequencyState, positionMask, frequencyMask);
    const next = applyRestrictedAdjoint(positionState, positionMask, frequencyMask);
    const normSquared = complexEnergy(next);
    if (!(normSquared > 1e-28)) break;
    frequencyState = normalizeComplex(next);
    history.push(concentrationReceipt(
      frequencyState,
      positionMask,
      frequencyMask,
    ).retainedEnergy);
  }

  return {
    ...concentrationReceipt(frequencyState, positionMask, frequencyMask),
    initialRetainedEnergy: initial.retainedEnergy,
    iterations: history.length - 1,
    history,
  };
}

export const CANTOR_LOCK_DEFAULTS = Object.freeze({
  depth: 4,
  offset: 0,
  seed: 37,
  mode: "cantor",
  iterations: 36,
});

export function analyzeCantorLock(options = {}) {
  const settings = { ...CANTOR_LOCK_DEFAULTS, ...options };
  const masks = buildCantorLockMasks(settings);
  const receipt = optimizeRestrictedConcentration({
    positionMask: masks.positionMask,
    frequencyMask: masks.frequencyMask,
    seed: settings.seed,
    iterations: settings.iterations,
  });
  return {
    ...masks,
    seed: settings.seed,
    ...receipt,
  };
}
