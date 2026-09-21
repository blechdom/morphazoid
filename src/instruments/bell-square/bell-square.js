/**
 * Exact, dependency-free two-qubit model for Bell Square.
 *
 * The state path is |++> -> CP(phi) -> (I x H). Measurement axes are rotations
 * in the Bloch X-Z plane: zero is the computational Z basis and pi / 2 is X.
 * Dephasing is a local phase-damping channel applied after the circuit. This
 * module deliberately has no DOM or Web Audio side effects, so it is safe to
 * import in Node tests and non-browser tools.
 */

export const BELL_SQUARE_OUTCOMES = Object.freeze(["00", "01", "10", "11"]);
export const DEFAULT_SAMPLE_SEED = 0x42534c4c;

const SQRT1_2 = Math.SQRT1_2;
const EPSILON = 1e-12;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function complex(re = 0, im = 0) {
  return { re: Number(re) || 0, im: Number(im) || 0 };
}

function asComplex(value) {
  if (typeof value === "number") return complex(value, 0);
  return complex(value?.re, value?.im);
}

function add(left, right) {
  return complex(left.re + right.re, left.im + right.im);
}

function subtract(left, right) {
  return complex(left.re - right.re, left.im - right.im);
}

function multiply(left, right) {
  return complex(
    left.re * right.re - left.im * right.im,
    left.re * right.im + left.im * right.re,
  );
}

function scale(value, amount) {
  return complex(value.re * amount, value.im * amount);
}

function conjugate(value) {
  return complex(value.re, -value.im);
}

function magnitudeSquared(value) {
  return value.re * value.re + value.im * value.im;
}

function sanitizeState(state) {
  if (!Array.isArray(state) || state.length !== 4) {
    throw new TypeError("A two-qubit state must contain four amplitudes.");
  }
  return state.map(asComplex);
}

function sanitizeDensityMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 4) {
    throw new TypeError("A two-qubit density matrix must be 4 by 4.");
  }
  return matrix.map((row) => {
    if (!Array.isArray(row) || row.length !== 4) {
      throw new TypeError("A two-qubit density matrix must be 4 by 4.");
    }
    return row.map(asComplex);
  });
}

/** Return the exact circuit state for |++> -> CP(phi) -> (I x H). */
export function bellSquareState(collisionPhase = Math.PI) {
  const phi = Number.isFinite(Number(collisionPhase)) ? Number(collisionPhase) : Math.PI;
  const phase = complex(Math.cos(phi), Math.sin(phi));
  const inputAmplitude = complex(0.5, 0);
  const afterCollision = [
    inputAmplitude,
    inputAmplitude,
    inputAmplitude,
    multiply(inputAmplitude, phase),
  ];

  return [
    scale(add(afterCollision[0], afterCollision[1]), SQRT1_2),
    scale(subtract(afterCollision[0], afterCollision[1]), SQRT1_2),
    scale(add(afterCollision[2], afterCollision[3]), SQRT1_2),
    scale(subtract(afterCollision[2], afterCollision[3]), SQRT1_2),
  ];
}

export function stateNorm(state) {
  return sanitizeState(state).reduce((sum, amplitude) => sum + magnitudeSquared(amplitude), 0);
}

export function stateFidelity(leftState, rightState) {
  const left = sanitizeState(leftState);
  const right = sanitizeState(rightState);
  let overlap = complex(0, 0);
  for (let index = 0; index < 4; index += 1) {
    overlap = add(overlap, multiply(conjugate(left[index]), right[index]));
  }
  const denominator = stateNorm(left) * stateNorm(right);
  return denominator > EPSILON ? clamp(magnitudeSquared(overlap) / denominator, 0, 1) : 0;
}

export function densityMatrix(state) {
  const safeState = sanitizeState(state);
  return safeState.map((rowAmplitude) => safeState.map((columnAmplitude) => (
    multiply(rowAmplitude, conjugate(columnAmplitude))
  )));
}

/**
 * Apply independent, equally strong phase-damping channels to Alice and Bob.
 * amount=0 preserves every matrix element; amount=1 removes every coherence.
 * A coherence differing in both qubits receives the damping factor twice.
 */
export function dephaseDensityMatrix(matrix, amount = 0) {
  const safeMatrix = sanitizeDensityMatrix(matrix);
  const dephasing = clamp(Number(amount) || 0, 0, 1);
  const coherence = 1 - dephasing;
  return safeMatrix.map((row, rowIndex) => row.map((value, columnIndex) => {
    const xor = rowIndex ^ columnIndex;
    const differingQubits = (xor & 1) + ((xor >> 1) & 1);
    return scale(value, coherence ** differingQubits);
  }));
}

function measurementKet(outcome, angle) {
  const halfAngle = (Number(angle) || 0) / 2;
  const cosine = Math.cos(halfAngle);
  const sine = Math.sin(halfAngle);
  return outcome === 0 ? [cosine, sine] : [-sine, cosine];
}

/** Joint projective probabilities for independent Alice/Bob X-Z-plane axes. */
export function measurementProbabilities(matrix, aliceAxis = 0, bobAxis = 0) {
  const rho = sanitizeDensityMatrix(matrix);
  const raw = [];

  for (let alice = 0; alice <= 1; alice += 1) {
    const aliceKet = measurementKet(alice, aliceAxis);
    for (let bob = 0; bob <= 1; bob += 1) {
      const bobKet = measurementKet(bob, bobAxis);
      const ket = [
        aliceKet[0] * bobKet[0],
        aliceKet[0] * bobKet[1],
        aliceKet[1] * bobKet[0],
        aliceKet[1] * bobKet[1],
      ];
      let probability = complex(0, 0);
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          probability = add(probability, scale(rho[row][column], ket[row] * ket[column]));
        }
      }
      raw.push(clamp(probability.re, 0, 1));
    }
  }

  const total = raw.reduce((sum, probability) => sum + probability, 0);
  if (total <= EPSILON) return [0.25, 0.25, 0.25, 0.25];
  return raw.map((probability) => probability / total);
}

export function jointProbabilityMatrix(probabilities) {
  const safe = normalizeJointProbabilities(probabilities);
  return [safe.slice(0, 2), safe.slice(2, 4)];
}

export function probabilitiesByOutcome(probabilities) {
  const safe = normalizeJointProbabilities(probabilities);
  return Object.fromEntries(BELL_SQUARE_OUTCOMES.map((outcome, index) => [outcome, safe[index]]));
}

export function correlationExpectation(probabilities) {
  const [p00, p01, p10, p11] = normalizeJointProbabilities(probabilities);
  return clamp(p00 - p01 - p10 + p11, -1, 1);
}

export function pureStateConcurrence(state) {
  const [a00, a01, a10, a11] = sanitizeState(state);
  const determinant = subtract(multiply(a00, a11), multiply(a01, a10));
  return clamp(2 * Math.sqrt(magnitudeSquared(determinant)), 0, 1);
}

/** Partial trace over the other qubit; qubit may be "alice" or "bob". */
export function reducedDensityMatrix(matrix, qubit = "alice") {
  const rho = sanitizeDensityMatrix(matrix);
  if (qubit !== "alice" && qubit !== "bob") {
    throw new TypeError('qubit must be "alice" or "bob".');
  }
  const reduced = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => complex()));
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      let value = complex();
      for (let traced = 0; traced < 2; traced += 1) {
        const sourceRow = qubit === "alice" ? row * 2 + traced : traced * 2 + row;
        const sourceColumn = qubit === "alice" ? column * 2 + traced : traced * 2 + column;
        value = add(value, rho[sourceRow][sourceColumn]);
      }
      reduced[row][column] = value;
    }
  }
  return reduced;
}

export function matrixPurity(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) return 0;
  const size = matrix.length;
  if (!matrix.every((row) => Array.isArray(row) && row.length === size)) return 0;
  let purity = 0;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      purity += magnitudeSquared(asComplex(matrix[row][column]));
    }
  }
  return clamp(purity, 0, 1);
}

function phaseFlippedState(state, flipAlice, flipBob) {
  return sanitizeState(state).map((amplitude, index) => {
    const alice = (index >> 1) & 1;
    const bob = index & 1;
    const sign = (flipAlice && alice ? -1 : 1) * (flipBob && bob ? -1 : 1);
    return scale(amplitude, sign);
  });
}

function spinFlip(state) {
  const [a, b, c, d] = sanitizeState(state).map(conjugate);
  return [scale(d, -1), c, b, scale(a, -1)];
}

function innerProduct(left, right) {
  let result = complex();
  for (let index = 0; index < left.length; index += 1) {
    result = add(result, multiply(conjugate(left[index]), right[index]));
  }
  return result;
}

function hermitianProduct(matrix) {
  const size = matrix.length;
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
    let value = complex();
    for (let inner = 0; inner < size; inner += 1) {
      value = add(value, multiply(conjugate(matrix[inner][row]), matrix[inner][column]));
    }
    return value;
  }));
}

function realEmbedding(matrix) {
  const size = matrix.length;
  const embedded = Array.from({ length: size * 2 }, () => Array(size * 2).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const value = asComplex(matrix[row][column]);
      embedded[row][column] = value.re;
      embedded[row][column + size] = -value.im;
      embedded[row + size][column] = value.im;
      embedded[row + size][column + size] = value.re;
    }
  }
  return embedded;
}

function symmetricEigenvalues(matrix) {
  const values = matrix.map((row) => [...row]);
  const size = values.length;
  const iterations = size * size * 80;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let p = 0;
    let q = 1;
    let largest = 0;
    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const magnitude = Math.abs(values[row][column]);
        if (magnitude > largest) {
          largest = magnitude;
          p = row;
          q = column;
        }
      }
    }
    if (largest < 1e-14) break;

    const angle = 0.5 * Math.atan2(
      2 * values[p][q],
      values[q][q] - values[p][p],
    );
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const app = values[p][p];
    const aqq = values[q][q];
    const apq = values[p][q];

    for (let index = 0; index < size; index += 1) {
      if (index === p || index === q) continue;
      const aip = values[index][p];
      const aiq = values[index][q];
      values[index][p] = cosine * aip - sine * aiq;
      values[p][index] = values[index][p];
      values[index][q] = sine * aip + cosine * aiq;
      values[q][index] = values[index][q];
    }
    values[p][p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    values[q][q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    values[p][q] = 0;
    values[q][p] = 0;
  }
  return values.map((row, index) => row[index]).sort((left, right) => right - left);
}

/** Wootters concurrence after the same local phase-damping channel used above. */
export function dephasedConcurrence(state, amount = 0) {
  const safeState = sanitizeState(state);
  const dephasing = clamp(Number(amount) || 0, 0, 1);
  const flipProbability = dephasing / 2;
  const stayProbability = 1 - flipProbability;
  const channels = [
    { alice: false, bob: false, weight: stayProbability * stayProbability },
    { alice: false, bob: true, weight: stayProbability * flipProbability },
    { alice: true, bob: false, weight: flipProbability * stayProbability },
    { alice: true, bob: true, weight: flipProbability * flipProbability },
  ];
  const ensemble = channels.map(({ alice, bob, weight }) => (
    phaseFlippedState(safeState, alice, bob).map((amplitude) => scale(amplitude, Math.sqrt(weight)))
  ));
  const tau = ensemble.map((left) => ensemble.map((right) => innerProduct(left, spinFlip(right))));
  const duplicatedEigenvalues = symmetricEigenvalues(realEmbedding(hermitianProduct(tau)));
  const singularValues = [];
  for (let index = 0; index < 4; index += 1) {
    const pairAverage = (duplicatedEigenvalues[index * 2] + duplicatedEigenvalues[index * 2 + 1]) / 2;
    singularValues.push(Math.sqrt(Math.max(0, pairAverage)));
  }
  return clamp(singularValues[0] - singularValues[1] - singularValues[2] - singularValues[3], 0, 1);
}

function seedFromValue(seed) {
  if (typeof seed === "string") {
    let hash = 0x811c9dc5;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0 || DEFAULT_SAMPLE_SEED;
  }
  const numeric = Number(seed);
  return Number.isFinite(numeric) ? (Math.trunc(numeric) >>> 0) || DEFAULT_SAMPLE_SEED : DEFAULT_SAMPLE_SEED;
}

/** Mulberry32: a compact deterministic generator for repeatable shot examples. */
export function createSeededRandom(seed = DEFAULT_SAMPLE_SEED) {
  let value = seedFromValue(seed);
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeJointProbabilities(probabilities) {
  const source = Array.isArray(probabilities)
    ? probabilities
    : BELL_SQUARE_OUTCOMES.map((outcome) => probabilities?.[outcome]);
  if (!Array.isArray(source) || source.length !== 4) {
    throw new TypeError("Joint probabilities must contain 00, 01, 10, and 11.");
  }
  const safe = source.map((value) => Math.max(0, Number(value) || 0));
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total <= EPSILON) return [0.25, 0.25, 0.25, 0.25];
  return safe.map((value) => value / total);
}

export function sampleJoint(probabilities, { shots = 1, seed = DEFAULT_SAMPLE_SEED } = {}) {
  const safe = normalizeJointProbabilities(probabilities);
  const shotCount = clamp(Math.trunc(Number(shots) || 1), 1, 4096);
  const random = createSeededRandom(seed);
  const counts = Object.fromEntries(BELL_SQUARE_OUTCOMES.map((outcome) => [outcome, 0]));
  const outcomes = [];
  const cumulative = safe.reduce((values, probability) => {
    values.push((values.at(-1) ?? 0) + probability);
    return values;
  }, []);

  for (let shot = 0; shot < shotCount; shot += 1) {
    const draw = random();
    let index = cumulative.findIndex((threshold) => draw < threshold);
    if (index < 0) index = 3;
    const outcome = BELL_SQUARE_OUTCOMES[index];
    counts[outcome] += 1;
    outcomes.push(outcome);
  }

  return {
    seed: seedFromValue(seed),
    shots: shotCount,
    outcomes,
    counts,
    frequencies: Object.fromEntries(BELL_SQUARE_OUTCOMES.map((outcome) => (
      [outcome, counts[outcome] / shotCount]
    ))),
  };
}

export function simulateBellSquare({
  collisionPhase = Math.PI,
  aliceAxis = 0,
  bobAxis = 0,
  dephasing = 0,
} = {}) {
  const state = bellSquareState(collisionPhase);
  const rho = dephaseDensityMatrix(densityMatrix(state), dephasing);
  const probabilities = measurementProbabilities(rho, aliceAxis, bobAxis);
  const aliceReduced = reducedDensityMatrix(rho, "alice");
  const bobReduced = reducedDensityMatrix(rho, "bob");
  return {
    state,
    densityMatrix: rho,
    probabilities,
    probabilityMatrix: jointProbabilityMatrix(probabilities),
    probabilitiesByOutcome: probabilitiesByOutcome(probabilities),
    correlation: correlationExpectation(probabilities),
    idealConcurrence: pureStateConcurrence(state),
    concurrence: dephasedConcurrence(state, dephasing),
    globalPurity: matrixPurity(rho),
    alicePurity: matrixPurity(aliceReduced),
    bobPurity: matrixPurity(bobReduced),
  };
}
