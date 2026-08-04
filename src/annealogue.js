/**
 * Annealogue's exact, closed-system three-qubit model.
 *
 * The state is an interleaved Float64Array:
 * [re(000), im(000), re(001), im(001), ... re(111), im(111)].
 * Time and energy use units where hbar = 1. This module intentionally has no
 * DOM, Web Audio, timer, or random side effects, so it is safe to import in
 * tests and server-side tools.
 */

export const QUBIT_COUNT = 3;
export const BASIS_STATE_COUNT = 2 ** QUBIT_COUNT;
export const AMPLITUDE_COMPONENT_COUNT = BASIS_STATE_COUNT * 2;
export const DEFAULT_ANNEAL_DURATION_SECONDS = 8;
export const DEFAULT_TRANSVERSE_FIELD = 1.25;
export const DEFAULT_MAX_STEP_SECONDS = 1 / 120;

const EPSILON = 1e-12;

function freezeLandscape({ id, name, description, energies, greedyStart }) {
  if (!Array.isArray(energies) || energies.length !== BASIS_STATE_COUNT) {
    throw new RangeError("An Annealogue landscape needs exactly eight energies.");
  }
  return Object.freeze({
    id,
    name,
    description,
    energies: Object.freeze(energies.map(Number)),
    greedyStart,
  });
}

/**
 * Tiny illustrative cost landscapes, not claims about practical quantum
 * advantage. False Floor deliberately puts the classical comparator at a
 * strict local minimum; Frustrated Ring is the antiferromagnetic triangle.
 */
export const ANNEALOGUE_LANDSCAPES = Object.freeze({
  "single-basin": freezeLandscape({
    id: "single-basin",
    name: "Single Basin",
    description: "One smooth descent toward |000>.",
    energies: [0, 1, 1, 2, 1, 2, 2, 3],
    greedyStart: 7,
  }),
  "false-floor": freezeLandscape({
    id: "false-floor",
    name: "False Floor",
    description: "The |111> corner is a local minimum above the true |000> floor.",
    energies: [0, 2.2, 2, 1.7, 2.4, 1.8, 1.9, 0.65],
    greedyStart: 7,
  }),
  "frustrated-ring": freezeLandscape({
    id: "frustrated-ring",
    name: "Frustrated Ring",
    description: "Three antiferromagnetic links cannot all be satisfied at once.",
    energies: [2, 0, 0, 0, 0, 0, 0, 2],
    greedyStart: 0,
  }),
});

export const LANDSCAPES = ANNEALOGUE_LANDSCAPES;
export const ANNEALOGUE_DEFAULTS = Object.freeze({
  landscapeId: "single-basin",
  durationSeconds: DEFAULT_ANNEAL_DURATION_SECONDS,
  gamma: DEFAULT_TRANSVERSE_FIELD,
  progress: 0,
});

function clamp(value, low, high) {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function checkedEnergies(energies) {
  if (!energies || energies.length !== BASIS_STATE_COUNT) {
    throw new RangeError("Expected one finite energy for each of eight basis states.");
  }
  const result = Array.from(energies, Number);
  if (!result.every(Number.isFinite)) {
    throw new TypeError("Landscape energies must be finite numbers.");
  }
  return result;
}

function copyState(state) {
  if (!state || state.length !== AMPLITUDE_COMPONENT_COUNT) {
    throw new RangeError("A three-qubit state needs sixteen interleaved components.");
  }
  const copy = Float64Array.from(state, Number);
  if (!copy.every(Number.isFinite)) {
    throw new TypeError("Quantum amplitudes must be finite numbers.");
  }
  return copy;
}

/** Return |000>, or another requested computational-basis state. */
export function createBasisState(index = 0) {
  const basisIndex = Math.trunc(Number(index));
  if (basisIndex < 0 || basisIndex >= BASIS_STATE_COUNT) {
    throw new RangeError("Basis-state index must be between 0 and 7.");
  }
  const state = new Float64Array(AMPLITUDE_COMPONENT_COUNT);
  state[basisIndex * 2] = 1;
  return state;
}

/** Return |+> tensor |+> tensor |+>, the anneal's driver ground state. */
export function createUniformState() {
  const state = new Float64Array(AMPLITUDE_COMPONENT_COUNT);
  const amplitude = 1 / Math.sqrt(BASIS_STATE_COUNT);
  for (let index = 0; index < BASIS_STATE_COUNT; index += 1) {
    state[index * 2] = amplitude;
  }
  return state;
}

export const uniformState = createUniformState;
export const basisState = createBasisState;

/** Squared L2 norm of an interleaved state. */
export function stateNormSquared(state) {
  const source = copyState(state);
  let total = 0;
  for (let index = 0; index < source.length; index += 2) {
    total += source[index] ** 2 + source[index + 1] ** 2;
  }
  return total;
}

export function stateNorm(state) {
  return Math.sqrt(stateNormSquared(state));
}

/** Return a normalized copy; a zero state is invalid. */
export function normalizeState(state) {
  const result = copyState(state);
  let normSquared = 0;
  for (let index = 0; index < result.length; index += 2) {
    normSquared += result[index] ** 2 + result[index + 1] ** 2;
  }
  if (!(normSquared > EPSILON)) throw new RangeError("Cannot normalize a zero state.");
  const inverseNorm = 1 / Math.sqrt(normSquared);
  for (let index = 0; index < result.length; index += 1) {
    result[index] *= inverseNorm;
  }
  return result;
}

/** Probabilities in |000> through |111> order. */
export function stateProbabilities(state) {
  const normalized = normalizeState(state);
  const result = new Float64Array(BASIS_STATE_COUNT);
  for (let index = 0; index < BASIS_STATE_COUNT; index += 1) {
    const offset = index * 2;
    result[index] = normalized[offset] ** 2 + normalized[offset + 1] ** 2;
  }
  return result;
}

export const probabilities = stateProbabilities;

/** Complex amplitudes as immutable-friendly plain records for rendering. */
export function complexAmplitudes(state) {
  const normalized = normalizeState(state);
  return Array.from({ length: BASIS_STATE_COUNT }, (_, index) => ({
    re: normalized[index * 2],
    im: normalized[index * 2 + 1],
  }));
}

export function bitstring(index) {
  return Math.trunc(Number(index)).toString(2).padStart(QUBIT_COUNT, "0").slice(-QUBIT_COUNT);
}

export function hammingNeighbors(index) {
  const basisIndex = Math.trunc(Number(index));
  if (basisIndex < 0 || basisIndex >= BASIS_STATE_COUNT) return [];
  return Array.from({ length: QUBIT_COUNT }, (_, qubit) => basisIndex ^ (1 << qubit));
}

export function resolveLandscape(landscape = ANNEALOGUE_DEFAULTS.landscapeId) {
  if (typeof landscape === "string") {
    const resolved = ANNEALOGUE_LANDSCAPES[landscape];
    if (!resolved) throw new RangeError("Unknown Annealogue landscape: " + landscape);
    return resolved;
  }
  if (landscape && typeof landscape === "object" && landscape.energies) {
    return {
      id: String(landscape.id ?? "custom"),
      name: String(landscape.name ?? "Custom"),
      description: String(landscape.description ?? "Custom eight-state landscape."),
      energies: checkedEnergies(landscape.energies),
      greedyStart: clamp(Math.trunc(landscape.greedyStart ?? 7), 0, 7),
    };
  }
  throw new TypeError("Landscape must be a preset id or an eight-energy object.");
}

function applyDiagonalPhaseInPlace(state, energies, progress, durationSeconds) {
  const halfTime = durationSeconds * 0.5;
  for (let index = 0; index < BASIS_STATE_COUNT; index += 1) {
    const angle = -progress * energies[index] * halfTime;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const offset = index * 2;
    const real = state[offset];
    const imaginary = state[offset + 1];
    state[offset] = real * cosine - imaginary * sine;
    state[offset + 1] = real * sine + imaginary * cosine;
  }
}

function applyDriverInPlace(state, progress, gamma, durationSeconds) {
  // exp[-i (-(1-s) gamma X) dt] = cos(theta) I + i sin(theta) X.
  const theta = (1 - progress) * gamma * durationSeconds;
  const cosine = Math.cos(theta);
  const sine = Math.sin(theta);
  for (let qubit = 0; qubit < QUBIT_COUNT; qubit += 1) {
    const mask = 1 << qubit;
    for (let basisIndex = 0; basisIndex < BASIS_STATE_COUNT; basisIndex += 1) {
      if (basisIndex & mask) continue;
      const peerIndex = basisIndex | mask;
      const first = basisIndex * 2;
      const second = peerIndex * 2;
      const firstReal = state[first];
      const firstImaginary = state[first + 1];
      const secondReal = state[second];
      const secondImaginary = state[second + 1];
      state[first] = cosine * firstReal - sine * secondImaginary;
      state[first + 1] = cosine * firstImaginary + sine * secondReal;
      state[second] = cosine * secondReal - sine * firstImaginary;
      state[second + 1] = cosine * secondImaginary + sine * firstReal;
    }
  }
}

/**
 * One symmetric split-operator step for
 * H(s) = -(1-s) gamma sum_i X_i + s sum_z E_z |z><z|.
 *
 * The diagonal half phases surround three exact, commuting X rotations. Each
 * factor is unitary; a final normalization only removes floating-point drift.
 */
export function splitStep(state, {
  energies,
  progress = 0,
  gamma = DEFAULT_TRANSVERSE_FIELD,
  dt = DEFAULT_MAX_STEP_SECONDS,
} = {}) {
  const result = copyState(state);
  const costs = checkedEnergies(energies);
  const scheduleProgress = clamp(progress, 0, 1);
  const transverseField = Math.max(0, Number.isFinite(gamma) ? gamma : 0);
  const timeStep = Number.isFinite(dt) ? dt : 0;
  applyDiagonalPhaseInPlace(result, costs, scheduleProgress, timeStep);
  applyDriverInPlace(result, scheduleProgress, transverseField, timeStep);
  applyDiagonalPhaseInPlace(result, costs, scheduleProgress, timeStep);
  return normalizeState(result);
}

export const evolveSplitStep = splitStep;

/** Evolve between two points of the linear schedule without mutating input. */
export function evolveSchedule(state, {
  energies,
  gamma = DEFAULT_TRANSVERSE_FIELD,
  durationSeconds = DEFAULT_ANNEAL_DURATION_SECONDS,
  fromProgress = 0,
  toProgress = 1,
  maxStepSeconds = DEFAULT_MAX_STEP_SECONDS,
} = {}) {
  const costs = checkedEnergies(energies);
  const duration = Math.max(0.001, Number(durationSeconds) || DEFAULT_ANNEAL_DURATION_SECONDS);
  const from = clamp(fromProgress, 0, 1);
  const to = clamp(toProgress, 0, 1);
  const elapsed = (to - from) * duration;
  if (Math.abs(elapsed) <= EPSILON) return normalizeState(state);
  const maximumStep = clamp(Math.abs(maxStepSeconds), 1 / 4000, 0.1);
  const steps = Math.max(1, Math.ceil(Math.abs(elapsed) / maximumStep));
  const dt = elapsed / steps;
  let result = normalizeState(state);
  for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
    const midpoint = from + (to - from) * ((stepIndex + 0.5) / steps);
    result = splitStep(result, {
      energies: costs,
      progress: midpoint,
      gamma,
      dt,
    });
  }
  return result;
}

/** Recompute the exact tiny simulation from its known |+++> initial state. */
export function simulateAnneal({
  landscape = ANNEALOGUE_DEFAULTS.landscapeId,
  energies,
  gamma = DEFAULT_TRANSVERSE_FIELD,
  durationSeconds = DEFAULT_ANNEAL_DURATION_SECONDS,
  progress = 1,
  maxStepSeconds = DEFAULT_MAX_STEP_SECONDS,
} = {}) {
  const costs = energies ? checkedEnergies(energies) : resolveLandscape(landscape).energies;
  return evolveSchedule(createUniformState(), {
    energies: costs,
    gamma,
    durationSeconds,
    fromProgress: 0,
    toProgress: progress,
    maxStepSeconds,
  });
}

/** Small immutable-style schedule records used by the UI and external demos. */
export function createAnnealSchedule(options = {}) {
  const landscape = resolveLandscape(options.landscape ?? options.landscapeId);
  return {
    landscapeId: landscape.id,
    energies: Array.from(landscape.energies),
    gamma: Math.max(0, Number(options.gamma ?? DEFAULT_TRANSVERSE_FIELD)),
    durationSeconds: Math.max(0.001, Number(options.durationSeconds ?? DEFAULT_ANNEAL_DURATION_SECONDS)),
    progress: 0,
    amplitudes: createUniformState(),
  };
}

export function restartAnneal(schedule, overrides = {}) {
  return createAnnealSchedule({
    landscape: overrides.landscape ?? overrides.landscapeId ?? schedule?.landscapeId,
    gamma: overrides.gamma ?? schedule?.gamma,
    durationSeconds: overrides.durationSeconds ?? schedule?.durationSeconds,
  });
}

export function runAnneal(schedule, toProgress = 1) {
  if (!schedule?.amplitudes) throw new TypeError("A schedule with amplitudes is required.");
  const target = clamp(toProgress, 0, 1);
  return {
    ...schedule,
    progress: target,
    amplitudes: evolveSchedule(schedule.amplitudes, {
      energies: schedule.energies,
      gamma: schedule.gamma,
      durationSeconds: schedule.durationSeconds,
      fromProgress: schedule.progress,
      toProgress: target,
    }),
  };
}

export function stepAnneal(schedule, elapsedSeconds = 1 / 60) {
  const duration = Math.max(0.001, Number(schedule?.durationSeconds) || DEFAULT_ANNEAL_DURATION_SECONDS);
  const delta = Number.isFinite(elapsedSeconds) ? elapsedSeconds / duration : 0;
  return runAnneal(schedule, clamp((schedule?.progress ?? 0) + delta, 0, 1));
}

export function expectedEnergy(state, energies) {
  const costs = checkedEnergies(energies);
  const values = stateProbabilities(state);
  return values.reduce((total, probability, index) => total + probability * costs[index], 0);
}

/** Expectation of the complete instantaneous annealing Hamiltonian. */
export function expectedHamiltonianEnergy(state, energies, progress = 1, gamma = DEFAULT_TRANSVERSE_FIELD) {
  const costs = checkedEnergies(energies);
  const normalized = normalizeState(state);
  const scheduleProgress = clamp(progress, 0, 1);
  let diagonal = 0;
  for (let index = 0; index < BASIS_STATE_COUNT; index += 1) {
    const offset = index * 2;
    diagonal += (normalized[offset] ** 2 + normalized[offset + 1] ** 2) * costs[index];
  }
  let transverse = 0;
  for (let qubit = 0; qubit < QUBIT_COUNT; qubit += 1) {
    const mask = 1 << qubit;
    for (let index = 0; index < BASIS_STATE_COUNT; index += 1) {
      if (index & mask) continue;
      const peer = index | mask;
      const first = index * 2;
      const second = peer * 2;
      transverse += 2 * (
        normalized[first] * normalized[second]
        + normalized[first + 1] * normalized[second + 1]
      );
    }
  }
  return scheduleProgress * diagonal
    - (1 - scheduleProgress) * Math.max(0, Number(gamma) || 0) * transverse;
}

export function groundStateIndices(energies, tolerance = 1e-9) {
  const costs = checkedEnergies(energies);
  const minimum = Math.min(...costs);
  const epsilon = Math.max(0, Number(tolerance) || 0);
  return costs.flatMap((energy, index) => (
    Math.abs(energy - minimum) <= epsilon ? [index] : []
  ));
}

export function successProbability(state, energies, tolerance = 1e-9) {
  const values = stateProbabilities(state);
  return groundStateIndices(energies, tolerance)
    .reduce((total, index) => total + values[index], 0);
}

/** Deterministic steepest one-bit descent, with lowest index breaking ties. */
export function classicalGreedyDescent(energies, startIndex = 7) {
  const costs = checkedEnergies(energies);
  const start = clamp(Math.trunc(startIndex), 0, BASIS_STATE_COUNT - 1);
  const path = [start];
  let current = start;
  while (path.length <= BASIS_STATE_COUNT) {
    const candidates = hammingNeighbors(current)
      .map((index) => ({ index, energy: costs[index] }))
      .sort((first, second) => first.energy - second.energy || first.index - second.index);
    const next = candidates[0];
    if (!next || next.energy >= costs[current] - EPSILON) break;
    current = next.index;
    path.push(current);
  }
  const groundStates = groundStateIndices(costs);
  return {
    start,
    path,
    finalState: current,
    finalEnergy: costs[current],
    reachedGround: groundStates.includes(current),
    stuck: !groundStates.includes(current),
  };
}

export function greedyPath(energies, startIndex = 7) {
  return classicalGreedyDescent(energies, startIndex).path;
}

function hashSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  const text = String(seed ?? "annealogue");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mulberry32, exposed so demonstrations and tests can replay a shot. */
export function createSeededRandom(seed = "annealogue") {
  let value = hashSeed(seed);
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample one basis state and return its collapsed state. */
export function measureState(state, randomSource = Math.random) {
  const values = stateProbabilities(state);
  let random = randomSource;
  if (randomSource && typeof randomSource === "object") {
    random = randomSource.random ?? (
      Object.hasOwn(randomSource, "seed") ? createSeededRandom(randomSource.seed) : Math.random
    );
  } else if (typeof randomSource !== "function") {
    random = createSeededRandom(randomSource);
  }
  const sample = clamp(Number(random()), 0, 1 - Number.EPSILON);
  let cumulative = 0;
  let index = BASIS_STATE_COUNT - 1;
  for (let candidate = 0; candidate < BASIS_STATE_COUNT; candidate += 1) {
    cumulative += values[candidate];
    if (sample < cumulative) {
      index = candidate;
      break;
    }
  }
  return {
    index,
    outcome: index,
    bitstring: bitstring(index),
    probability: values[index],
    sample,
    collapsedState: createBasisState(index),
  };
}
