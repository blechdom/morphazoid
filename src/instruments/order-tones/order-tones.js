/**
 * Exact, tiny, classical helpers for the order-finding part of Shor's
 * algorithm. The module deliberately has no browser or audio dependencies so
 * its arithmetic can be reused and tested without constructing global state.
 */

const TAU = Math.PI * 2;
const MAX_PRECISION_BITS = 12;

function integer(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new RangeError(`${name} must be a safe integer at least ${minimum}.`);
  }
  return number;
}

function signedInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`${name} must be a safe integer.`);
  }
  return number;
}

function positiveInteger(value, name) {
  return integer(value, name, 1);
}

function normalizeProbabilityVector(probabilities) {
  if (!Array.isArray(probabilities) && !ArrayBuffer.isView(probabilities)) {
    throw new TypeError("probabilities must be an array or typed array.");
  }
  const values = Array.from(probabilities, (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new RangeError("probabilities must contain positive mass.");
  return values.map((value) => value / total);
}

function freezePreset(preset) {
  return Object.freeze({
    ...preset,
    bases: Object.freeze([...preset.bases]),
  });
}

/** Friendly composites and coprime bases small enough for an exact browser simulation. */
export const ORDER_TONES_PRESETS = Object.freeze([
  freezePreset({
    modulus: 15,
    label: "15 · 3 × 5",
    defaultBase: 2,
    bases: [2, 4, 7, 8, 11, 13, 14],
  }),
  freezePreset({
    modulus: 21,
    label: "21 · 3 × 7",
    defaultBase: 2,
    bases: [2, 4, 5, 8, 10, 11, 13, 16, 17, 19, 20],
  }),
  freezePreset({
    modulus: 35,
    label: "35 · 5 × 7",
    defaultBase: 2,
    bases: [2, 3, 4, 6, 8, 9, 11, 12, 13, 16, 17, 18, 19, 22, 23, 24, 26, 27, 29, 31, 32, 33, 34],
  }),
]);

/** Euclid's algorithm over safe integers. */
export function greatestCommonDivisor(left, right) {
  let a = Math.abs(signedInteger(left, "left"));
  let b = Math.abs(signedInteger(right, "right"));
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export const gcd = greatestCommonDivisor;

/** Repeated-squaring modular exponentiation. */
export function modularExponentiation(base, exponent, modulus) {
  const n = positiveInteger(modulus, "modulus");
  let power = integer(exponent, "exponent");
  let factor = ((integer(base, "base") % n) + n) % n;
  let result = 1 % n;
  while (power > 0) {
    if (power % 2 === 1) result = (result * factor) % n;
    factor = (factor * factor) % n;
    power = Math.floor(power / 2);
  }
  return result;
}

export const modPow = modularExponentiation;

/**
 * Return [a^0 mod N, ..., a^(r-1) mod N], where r is the multiplicative
 * order. A coprime base must return to one within Euler's finite group.
 */
export function modularSequence(modulus, base) {
  const n = positiveInteger(modulus, "modulus");
  const a = integer(base, "base", 2);
  if (a >= n) throw new RangeError("base must be smaller than modulus.");
  if (greatestCommonDivisor(a, n) !== 1) {
    throw new RangeError("base and modulus must be coprime for order finding.");
  }

  const residues = [];
  let residue = 1;
  // There can be at most phi(N) distinct elements; N is a convenient safe cap.
  for (let exponent = 0; exponent <= n; exponent += 1) {
    if (exponent > 0 && residue === 1) return residues;
    residues.push(residue);
    residue = (residue * a) % n;
  }
  throw new Error("The modular sequence did not return to one.");
}

export function multiplicativeOrder(base, modulus) {
  return modularSequence(modulus, base).length;
}

export function analyzeModularOrder(modulus, base) {
  const n = positiveInteger(modulus, "modulus");
  const a = integer(base, "base", 2);
  const residues = modularSequence(n, a);
  return Object.freeze({
    modulus: n,
    base: a,
    order: residues.length,
    residues: Object.freeze(residues),
  });
}

export function registerSizeForPrecision(precision) {
  const bits = integer(precision, "precision", 1);
  if (bits > MAX_PRECISION_BITS) {
    throw new RangeError(`precision must be at most ${MAX_PRECISION_BITS} bits.`);
  }
  return 2 ** bits;
}

/** Exponents in one post-measurement periodic coset x = offset (mod r). */
export function periodicCoset(order, registerSize, offset = 0) {
  const period = positiveInteger(order, "order");
  const size = positiveInteger(registerSize, "registerSize");
  const start = integer(offset, "offset");
  if (start >= period) throw new RangeError("offset must be smaller than order.");
  const exponents = [];
  for (let exponent = start; exponent < size; exponent += period) {
    exponents.push(exponent);
  }
  if (!exponents.length) throw new RangeError("the selected coset is empty.");
  return exponents;
}

/**
 * Exact inverse-QFT amplitudes and probabilities for one periodic coset.
 *
 * The complex amplitude at k is
 *   1/sqrt(MQ) sum_j exp(-2 pi i k x_j / Q),
 * where Q is the power-of-two counting register and M is the coset size.
 */
export function qftCosetDistribution(order, precision, offset = 0) {
  const period = positiveInteger(order, "order");
  const bits = integer(precision, "precision", 1);
  const registerSize = registerSizeForPrecision(bits);
  const cosetOffset = integer(offset, "offset");
  const exponents = periodicCoset(period, registerSize, cosetOffset);
  const normalization = 1 / Math.sqrt(exponents.length * registerSize);
  const amplitudes = new Array(registerSize);
  const probabilities = new Array(registerSize);

  for (let bin = 0; bin < registerSize; bin += 1) {
    let real = 0;
    let imaginary = 0;
    for (const exponent of exponents) {
      const angle = -TAU * bin * exponent / registerSize;
      real += Math.cos(angle);
      imaginary += Math.sin(angle);
    }
    real *= normalization;
    imaginary *= normalization;
    amplitudes[bin] = Object.freeze({ real, imaginary });
    probabilities[bin] = real * real + imaginary * imaginary;
  }

  // Correct only floating-point summation drift; the analytical result is unitary.
  const normalized = normalizeProbabilityVector(probabilities);
  return Object.freeze({
    order: period,
    precision: bits,
    registerSize,
    offset: cosetOffset,
    exponents: Object.freeze(exponents),
    amplitudes: Object.freeze(amplitudes),
    probabilities: Object.freeze(normalized),
  });
}

/**
 * The physically exact distribution when the modular-value register is not
 * displayed: a size-weighted mixture of every possible measured coset.
 */
export function orderFindingDistribution(modulus, base, precision) {
  const analysis = analyzeModularOrder(modulus, base);
  const registerSize = registerSizeForPrecision(precision);
  const probabilities = new Array(registerSize).fill(0);
  const cosets = [];

  for (let offset = 0; offset < analysis.order && offset < registerSize; offset += 1) {
    const coset = qftCosetDistribution(analysis.order, precision, offset);
    const weight = coset.exponents.length / registerSize;
    for (let bin = 0; bin < registerSize; bin += 1) {
      probabilities[bin] += weight * coset.probabilities[bin];
    }
    cosets.push(Object.freeze({
      offset,
      residue: analysis.residues[offset],
      weight,
      exponents: coset.exponents,
    }));
  }

  return Object.freeze({
    ...analysis,
    precision: integer(precision, "precision", 1),
    registerSize,
    probabilities: Object.freeze(normalizeProbabilityVector(probabilities)),
    cosets: Object.freeze(cosets),
  });
}

/** Alias describing the UI's operation in domain language. */
export const qftProbabilityDistribution = orderFindingDistribution;

/** Individual unit phasors and their cumulative sum for a selected QFT bin. */
export function phasorContributions(order, precision, offset, bin) {
  const distribution = qftCosetDistribution(order, precision, offset);
  const selectedBin = integer(bin, "bin");
  if (selectedBin >= distribution.registerSize) {
    throw new RangeError("bin must fit inside the counting register.");
  }
  const contributionScale = 1 / Math.sqrt(
    distribution.exponents.length * distribution.registerSize,
  );
  let real = 0;
  let imaginary = 0;
  const contributions = distribution.exponents.map((exponent, index) => {
    const angle = -TAU * selectedBin * exponent / distribution.registerSize;
    const deltaReal = Math.cos(angle) * contributionScale;
    const deltaImaginary = Math.sin(angle) * contributionScale;
    const from = Object.freeze({ real, imaginary });
    real += deltaReal;
    imaginary += deltaImaginary;
    return Object.freeze({
      index,
      exponent,
      angle,
      real: deltaReal,
      imaginary: deltaImaginary,
      from,
      to: Object.freeze({ real, imaginary }),
    });
  });
  return Object.freeze({
    bin: selectedBin,
    registerSize: distribution.registerSize,
    offset: distribution.offset,
    contributions: Object.freeze(contributions),
    sum: Object.freeze({ real, imaginary }),
    probability: real * real + imaginary * imaginary,
  });
}

/** Return the strongest bins with stable lower-bin tie breaking. */
export function dominantPeakBins(probabilities, count = 1, { includeZero = true } = {}) {
  const values = normalizeProbabilityVector(probabilities);
  const limit = Math.min(values.length, positiveInteger(count, "count"));
  return values
    .map((probability, bin) => ({ bin, probability }))
    .filter(({ bin }) => includeZero || bin !== 0)
    .sort((left, right) => right.probability - left.probability || left.bin - right.bin)
    .slice(0, limit)
    .map(({ bin }) => bin);
}

function seedToUint32(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return Math.trunc(seed) >>> 0;
  const text = String(seed ?? "order-tones");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic Mulberry32 PRNG for repeatable educational shots and tests. */
export function createSeededRandom(seed = "order-tones") {
  let state = seedToUint32(seed);
  return function seededRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample one or many QFT bins. Passing a seed makes the sequence repeatable. */
export function sampleDistribution(probabilities, count = 1, options = {}) {
  const values = normalizeProbabilityVector(probabilities);
  const shotCount = positiveInteger(count, "count");
  const random = typeof options?.random === "function"
    ? options.random
    : options && Object.prototype.hasOwnProperty.call(options, "seed")
      ? createSeededRandom(options.seed)
      : Math.random;
  const cumulative = [];
  let total = 0;
  for (const probability of values) {
    total += probability;
    cumulative.push(total);
  }
  cumulative[cumulative.length - 1] = 1;

  const shots = [];
  for (let shot = 0; shot < shotCount; shot += 1) {
    const draw = Math.min(1 - Number.EPSILON, Math.max(0, Number(random()) || 0));
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (draw < cumulative[middle]) high = middle;
      else low = middle + 1;
    }
    shots.push(low);
  }
  return shots;
}

export function shotHistogram(shots, binCount) {
  const count = positiveInteger(binCount, "binCount");
  const histogram = new Array(count).fill(0);
  for (const value of shots) {
    const bin = integer(value, "shot bin");
    if (bin >= count) throw new RangeError("shot bin must be smaller than binCount.");
    histogram[bin] += 1;
  }
  return histogram;
}

/** Exact continued-fraction expansion of numerator / denominator. */
export function continuedFraction(numerator, denominator, maxTerms = 32) {
  let a = integer(numerator, "numerator");
  let b = positiveInteger(denominator, "denominator");
  const limit = positiveInteger(maxTerms, "maxTerms");
  const terms = [];
  while (b !== 0 && terms.length < limit) {
    const quotient = Math.floor(a / b);
    terms.push(quotient);
    [a, b] = [b, a - quotient * b];
  }
  return terms;
}

export function continuedFractionConvergents(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return [];
  let pMinusTwo = 0;
  let pMinusOne = 1;
  let qMinusTwo = 1;
  let qMinusOne = 0;
  return terms.map((rawTerm) => {
    const term = integer(rawTerm, "continued-fraction term");
    const numerator = term * pMinusOne + pMinusTwo;
    const denominator = term * qMinusOne + qMinusTwo;
    [pMinusTwo, pMinusOne] = [pMinusOne, numerator];
    [qMinusTwo, qMinusOne] = [qMinusOne, denominator];
    return Object.freeze({ numerator, denominator });
  });
}

function failure(reason, message, details = {}) {
  return Object.freeze({ success: false, reason, message, ...details });
}

/** Convert an even order into non-trivial factors, or explain why it fails. */
export function recoverFactorsFromOrder(modulus, base, order) {
  const n = positiveInteger(modulus, "modulus");
  const a = integer(base, "base", 2);
  const period = positiveInteger(order, "order");
  const common = greatestCommonDivisor(a, n);
  if (common > 1 && common < n) {
    return Object.freeze({
      success: true,
      reason: "lucky-gcd",
      message: `${a} already shares the factor ${common} with ${n}.`,
      order: null,
      halfPower: null,
      factors: Object.freeze([common, n / common].sort((left, right) => left - right)),
    });
  }
  if (period % 2 !== 0) {
    return failure("odd-order", `The recovered order ${period} is odd.`, { order: period });
  }
  const halfPower = modularExponentiation(a, period / 2, n);
  if (halfPower === 1 || halfPower === n - 1) {
    return failure(
      "trivial-square-root",
      `${a}^(${period}/2) mod ${n} is ${halfPower}, yielding only trivial divisors.`,
      { order: period, halfPower },
    );
  }
  const candidates = [
    greatestCommonDivisor(halfPower - 1, n),
    greatestCommonDivisor(halfPower + 1, n),
  ].filter((factor, index, factors) => (
    factor > 1 && factor < n && factors.indexOf(factor) === index
  ));
  if (candidates.length === 1 && n % candidates[0] === 0) candidates.push(n / candidates[0]);
  const factors = candidates.sort((left, right) => left - right);
  if (factors.length < 2 || factors[0] * factors[1] !== n) {
    return failure(
      "trivial-factors",
      `The order ${period} did not produce two non-trivial factors.`,
      { order: period, halfPower, factors: Object.freeze(factors) },
    );
  }
  return Object.freeze({
    success: true,
    reason: "factors-found",
    message: `${n} = ${factors[0]} × ${factors[1]}.`,
    order: period,
    halfPower,
    factors: Object.freeze(factors),
  });
}

/**
 * Use continued-fraction convergents of k/Q to recover a candidate order.
 * Multiples of a reduced denominator are checked because s/r may reduce.
 */
export function recoverOrderFromMeasurement(modulus, base, measuredBin, precision) {
  const n = positiveInteger(modulus, "modulus");
  const a = integer(base, "base", 2);
  const registerSize = registerSizeForPrecision(precision);
  const bin = integer(measuredBin, "measuredBin");
  if (bin >= registerSize) throw new RangeError("measuredBin must fit the register.");
  const terms = continuedFraction(bin, registerSize);
  const convergents = continuedFractionConvergents(terms);
  const details = {
    measuredBin: bin,
    registerSize,
    phase: bin / registerSize,
    continuedFraction: Object.freeze(terms),
    convergents: Object.freeze(convergents),
  };
  if (bin === 0) {
    return failure("zero-bin", "Bin 0 contains no usable period denominator.", details);
  }

  const tested = new Set();
  for (let index = convergents.length - 1; index >= 0; index -= 1) {
    const denominator = convergents[index].denominator;
    if (denominator <= 1 || denominator > n) continue;
    for (let multiplier = 1; denominator * multiplier <= n; multiplier += 1) {
      const candidate = denominator * multiplier;
      if (tested.has(candidate)) continue;
      tested.add(candidate);
      if (modularExponentiation(a, candidate, n) !== 1) continue;
      // Reduce a multiple to its true order without using a hidden order oracle.
      let reduced = candidate;
      for (let divisor = 1; divisor < candidate; divisor += 1) {
        if (candidate % divisor === 0 && modularExponentiation(a, divisor, n) === 1) {
          reduced = divisor;
          break;
        }
      }
      return Object.freeze({
        success: true,
        reason: "order-recovered",
        message: `Recovered order r = ${reduced}.`,
        order: reduced,
        denominator,
        multiplier,
        ...details,
      });
    }
  }
  return failure(
    "no-order-candidate",
    "No continued-fraction denominator matched a modular order; take another shot.",
    details,
  );
}

/** Complete classical post-processing receipt for one simulated QFT shot. */
export function recoverFactorsFromMeasurement(modulus, base, measuredBin, precision) {
  const n = positiveInteger(modulus, "modulus");
  const a = integer(base, "base", 2);
  const common = greatestCommonDivisor(a, n);
  if (common > 1 && common < n) {
    const result = recoverFactorsFromOrder(n, a, 2);
    return Object.freeze({
      ...result,
      measuredBin: integer(measuredBin, "measuredBin"),
      registerSize: registerSizeForPrecision(precision),
      phase: null,
      continuedFraction: Object.freeze([]),
      convergents: Object.freeze([]),
    });
  }
  if (common !== 1) {
    return failure("invalid-base", "The base must be coprime to the modulus.");
  }
  const orderResult = recoverOrderFromMeasurement(n, a, measuredBin, precision);
  if (!orderResult.success) return orderResult;
  const factorResult = recoverFactorsFromOrder(n, a, orderResult.order);
  return Object.freeze({
    ...orderResult,
    ...factorResult,
    order: orderResult.order,
    orderReason: orderResult.reason,
  });
}

/** Deterministic complete shot batch, useful to the UI and test harnesses. */
export function simulateOrderFindingShots({
  modulus,
  base,
  precision,
  count = 1,
  seed,
  random,
} = {}) {
  const distribution = orderFindingDistribution(modulus, base, precision);
  const options = typeof random === "function"
    ? { random }
    : seed === undefined ? {} : { seed };
  const shots = sampleDistribution(distribution.probabilities, count, options);
  const histogram = shotHistogram(shots, distribution.registerSize);
  const receipts = shots.map((bin) => recoverFactorsFromMeasurement(
    distribution.modulus,
    distribution.base,
    bin,
    distribution.precision,
  ));
  return Object.freeze({
    ...distribution,
    shots: Object.freeze(shots),
    histogram: Object.freeze(histogram),
    receipts: Object.freeze(receipts),
  });
}
