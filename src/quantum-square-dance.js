/**
 * Exact, finite model of the exchange pair behind NIST's 2007
 * "quantum square dance" metaphor.
 *
 * For the default preparation |01>, the ideal exchange path is
 *
 *   |psi(theta)> = cos(theta / 2)|01> - i sin(theta / 2)|10>.
 *
 * `visibility` applies phase damping only to rho[01,10] and its conjugate.
 * It never changes the computational-basis populations. The module has no
 * DOM, Web Audio, timers, or ambient randomness and is safe to import in Node.
 */

const TAU = Math.PI * 2;
const EPSILON = 1e-12;
const DEFAULT_SAMPLE_SEED = "quantum-square-dance";
const DEFAULT_SHOTS = 64;
const MAX_SHOTS = 100_000;

/** Measured population-oscillation period 2*T_SWAP = 285(1) microseconds. */
export const PHYSICAL_EXCHANGE_CYCLE_SECONDS = 285e-6;

export const SQUARE_DANCE_BASIS = Object.freeze(["00", "01", "10", "11"]);
export const SQUARE_DANCE_PREPARATIONS = Object.freeze([
  "up-down",
  "down-up",
  "up-up",
  "down-down",
]);

export const DEFAULT_SQUARE_DANCE_SETTINGS = Object.freeze({
  preparation: "up-down",
  exchangeAngle: 0,
  visibility: 1,
});

export const DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS = Object.freeze({
  musicalCycleSeconds: 2,
  beatsPerCycle: 4,
  subdivisions: 8,
  rootMidi: 48,
  spinIntervalSemitones: 7,
  contourSemitones: 5,
  stereoWidth: 0.78,
  level: 0.72,
});

const PREPARATION = Object.freeze({
  "up-down": Object.freeze({ basis: "01", basisIndex: 1, opposite: true, direction: 1 }),
  "down-up": Object.freeze({ basis: "10", basisIndex: 2, opposite: true, direction: -1 }),
  "up-up": Object.freeze({ basis: "00", basisIndex: 0, opposite: false, direction: 0 }),
  "down-down": Object.freeze({ basis: "11", basisIndex: 3, opposite: false, direction: 0 }),
});

const PREPARATION_ALIASES = Object.freeze({
  "01": "up-down",
  "10": "down-up",
  "00": "up-up",
  "11": "down-down",
  "up_down": "up-down",
  "down_up": "down-up",
  "up_up": "up-up",
  "down_down": "down-down",
  "↑↓": "up-down",
  "↓↑": "down-up",
  "↑↑": "up-up",
  "↓↓": "down-down",
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const square = (value) => value * value;
const magnitude = (value) => Math.hypot(value.re, value.im);

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return clamp(number, minimum, maximum);
}

function modulo(value, modulus) {
  const wrapped = ((value % modulus) + modulus) % modulus;
  return Math.abs(wrapped - modulus) < EPSILON || Math.abs(wrapped) < EPSILON ? 0 : wrapped;
}

// Preserve a positive full-cycle endpoint so a 0..2pi UI can distinguish
// "returned" from "prepared", even though their density matrices are equal.
function normalizeExchangeAngle(value) {
  const wrapped = modulo(value, TAU);
  return wrapped === 0 && value > 0 ? TAU : wrapped;
}

function complex(re = 0, im = 0) {
  return Object.freeze({
    re: Object.is(re, -0) ? 0 : re,
    im: Object.is(im, -0) ? 0 : im,
  });
}

function conjugate(value) {
  return complex(value.re, -value.im);
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

function freezeArray(values) {
  return Object.freeze([...values]);
}

function normalizePreparation(value) {
  const candidate = String(value ?? "").trim().toLowerCase();
  const aliased = PREPARATION_ALIASES[candidate] ?? candidate;
  return SQUARE_DANCE_PREPARATIONS.includes(aliased)
    ? aliased
    : DEFAULT_SQUARE_DANCE_SETTINGS.preparation;
}

/** Normalize aliases, wrap theta to one population cycle, and clamp visibility. */
export function normalizeSquareDanceSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  let exchangeAngle = DEFAULT_SQUARE_DANCE_SETTINGS.exchangeAngle;
  if (Number.isFinite(Number(source.exchangeAngle))) {
    exchangeAngle = Number(source.exchangeAngle);
  } else if (Number.isFinite(Number(source.theta))) {
    exchangeAngle = Number(source.theta);
  } else if (Number.isFinite(Number(source.cyclePhase))) {
    exchangeAngle = Number(source.cyclePhase) * TAU;
  }

  let visibility = source.visibility;
  if (!Number.isFinite(Number(visibility))) visibility = source.coherenceVisibility;

  return Object.freeze({
    preparation: normalizePreparation(source.preparation),
    exchangeAngle: normalizeExchangeAngle(exchangeAngle),
    visibility: clamp(
      finiteNumber(visibility, DEFAULT_SQUARE_DANCE_SETTINGS.visibility),
      0,
      1,
    ),
  });
}

/**
 * Ideal pure reference state in basis |00>, |01>, |10>, |11>.
 * Aligned spins are eigenstates and remain unchanged after global phase is
 * discarded. The two opposite-spin inputs traverse the exchange in reverse.
 */
export function exchangeState(exchangeAngle = 0, preparation = "up-down") {
  const settings = normalizeSquareDanceSettings({ exchangeAngle, preparation, visibility: 1 });
  const descriptor = PREPARATION[settings.preparation];
  const amplitudes = Array.from({ length: 4 }, () => complex());

  if (!descriptor.opposite) {
    amplitudes[descriptor.basisIndex] = complex(1, 0);
    return freezeArray(amplitudes);
  }

  const cosine = Math.cos(settings.exchangeAngle / 2);
  const sine = Math.sin(settings.exchangeAngle / 2);
  if (settings.preparation === "up-down") {
    amplitudes[1] = complex(cosine, 0);
    amplitudes[2] = complex(0, -sine);
  } else {
    amplitudes[1] = complex(0, -sine);
    amplitudes[2] = complex(cosine, 0);
  }
  return freezeArray(amplitudes);
}

/** Outer product of the ideal state with exchange coherence scaled by visibility. */
export function exchangeDensityMatrix(
  exchangeAngle = 0,
  visibility = 1,
  preparation = "up-down",
) {
  const settings = normalizeSquareDanceSettings({ exchangeAngle, visibility, preparation });
  const state = exchangeState(settings.exchangeAngle, settings.preparation);
  const density = state.map((rowAmplitude, row) => Object.freeze(state.map((columnAmplitude, column) => {
    const pureValue = multiply(rowAmplitude, conjugate(columnAmplitude));
    const isExchangeCoherence = (row === 1 && column === 2) || (row === 2 && column === 1);
    return isExchangeCoherence ? scale(pureValue, settings.visibility) : pureValue;
  })));
  return freezeArray(density);
}

function binaryEntropy(probability) {
  const p = clamp(probability, 0, 1);
  if (p <= EPSILON || p >= 1 - EPSILON) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

function entanglementOfFormation(concurrence) {
  const c = clamp(concurrence, 0, 1);
  if (c <= EPSILON) return 0;
  const branch = (1 + Math.sqrt(Math.max(0, 1 - c * c))) / 2;
  return binaryEntropy(branch);
}

function densityPurity(density) {
  let purity = 0;
  for (const row of density) {
    for (const value of row) purity += square(magnitude(value));
  }
  return clamp(purity, 0, 1);
}

function hermitianError(density) {
  let error = 0;
  for (let row = 0; row < density.length; row += 1) {
    for (let column = 0; column < density.length; column += 1) {
      const left = density[row][column];
      const right = density[column][row];
      error = Math.max(error, Math.abs(left.re - right.re), Math.abs(left.im + right.im));
    }
  }
  return error;
}

function densityEigenvalues(probabilities, coherence) {
  const [p00, p01, p10, p11] = probabilities;
  const exchangeMass = p01 + p10;
  const discriminant = Math.sqrt(Math.max(
    0,
    square(p01 - p10) + 4 * square(magnitude(coherence)),
  ));
  return freezeArray([
    p00,
    (exchangeMass - discriminant) / 2,
    (exchangeMass + discriminant) / 2,
    p11,
  ].sort((left, right) => left - right));
}

function nearestLandmark(phase) {
  const landmarks = [
    [0, "prepared"],
    [0.25, "sqrt-swap"],
    [0.5, "swapped"],
    [0.75, "sqrt-swap-return"],
    [1, "returned"],
  ];
  return landmarks.find(([position]) => Math.abs(phase - position) <= EPSILON)?.[1] ?? null;
}

function timelineFor(exchangeAngle, preparation) {
  const descriptor = PREPARATION[preparation];
  const normalizedAngle = normalizeExchangeAngle(exchangeAngle);
  const phase = normalizedAngle / TAU;
  let stage = descriptor.opposite ? nearestLandmark(phase) : "aligned";
  if (!stage) {
    if (phase < 0.25) stage = "entangling";
    else if (phase < 0.5) stage = "completing-swap";
    else if (phase < 0.75) stage = "re-entangling";
    else stage = "returning";
  }
  const segment = Math.min(3, Math.floor(phase * 4));
  return Object.freeze({
    stage,
    phase,
    exchangeAngle: normalizedAngle,
    segment,
    segmentProgress: phase * 4 - segment,
    direction: descriptor.direction,
    landmarks: Object.freeze({
      prepared: 0,
      sqrtSwap: 0.25,
      swapped: 0.5,
      sqrtSwapReturn: 0.75,
      returned: 1,
    }),
  });
}

/** Complete ideal/dephased diagnostics for one pair at one exchange angle. */
export function simulateSquareDance(settings = {}) {
  const normalized = normalizeSquareDanceSettings(settings);
  const descriptor = PREPARATION[normalized.preparation];
  const state = exchangeState(normalized.exchangeAngle, normalized.preparation);
  const densityMatrix = exchangeDensityMatrix(
    normalized.exchangeAngle,
    normalized.visibility,
    normalized.preparation,
  );
  const probabilities = freezeArray(densityMatrix.map((row, index) => row[index].re));
  const probabilitiesByBasis = Object.freeze(Object.fromEntries(
    SQUARE_DANCE_BASIS.map((basis, index) => [basis, probabilities[index]]),
  ));
  const rawCoherence = densityMatrix[1][2];
  const coherenceMagnitude = magnitude(rawCoherence);
  const coherence = Object.freeze({
    re: rawCoherence.re,
    im: rawCoherence.im,
    magnitude: coherenceMagnitude,
    normalizedMagnitude: clamp(2 * coherenceMagnitude, 0, 1),
    phase: coherenceMagnitude > EPSILON ? Math.atan2(rawCoherence.im, rawCoherence.re) : 0,
  });
  const concurrence = descriptor.opposite
    ? clamp(normalized.visibility * Math.abs(Math.sin(normalized.exchangeAngle)), 0, 1)
    : 0;

  const [p00, p01, p10, p11] = probabilities;
  const orbitalMarginals = Object.freeze({
    excited: Object.freeze({ up: p00 + p01, down: p10 + p11 }),
    ground: Object.freeze({ up: p00 + p10, down: p01 + p11 }),
  });
  const excitedPurity = square(orbitalMarginals.excited.up) + square(orbitalMarginals.excited.down);
  const groundPurity = square(orbitalMarginals.ground.up) + square(orbitalMarginals.ground.down);
  const excitedEntropy = binaryEntropy(orbitalMarginals.excited.up);
  const groundEntropy = binaryEntropy(orbitalMarginals.ground.up);
  const eigenvalues = densityEigenvalues(probabilities, rawCoherence);
  const trace = probabilities.reduce((sum, probability) => sum + probability, 0);
  const stateNorm = state.reduce((sum, amplitude) => sum + square(magnitude(amplitude)), 0);
  const minimumEigenvalue = Math.min(...eigenvalues);

  return Object.freeze({
    settings: normalized,
    preparation: normalized.preparation,
    inputBasis: descriptor.basis,
    isOppositeSpinPreparation: descriptor.opposite,
    exchangeDirection: descriptor.direction,
    state: freezeArray(state),
    densityMatrix,
    probabilities,
    probabilitiesByBasis,
    orbitalMarginals,
    coherence,
    concurrence,
    entanglementOfFormation: entanglementOfFormation(concurrence),
    reducedPurity: Object.freeze({ excited: excitedPurity, ground: groundPurity }),
    localEntropy: Object.freeze({ excited: excitedEntropy, ground: groundEntropy }),
    jointPurity: densityPurity(densityMatrix),
    observables: Object.freeze({
      zz: p00 - p01 - p10 + p11,
      xy: descriptor.opposite
        ? normalized.visibility * descriptor.direction * Math.sin(normalized.exchangeAngle)
        : 0,
      yx: descriptor.opposite
        ? -normalized.visibility * descriptor.direction * Math.sin(normalized.exchangeAngle)
        : 0,
      zExcited: orbitalMarginals.excited.up - orbitalMarginals.excited.down,
      zGround: orbitalMarginals.ground.up - orbitalMarginals.ground.down,
    }),
    densityEigenvalues: eigenvalues,
    timeline: timelineFor(normalized.exchangeAngle, normalized.preparation),
    invariants: Object.freeze({
      stateNorm,
      trace,
      probabilitySum: trace,
      hermitianError: hermitianError(densityMatrix),
      minimumEigenvalue,
      normalized: Math.abs(trace - 1) <= EPSILON && Math.abs(stateNorm - 1) <= EPSILON,
      hermitian: hermitianError(densityMatrix) <= EPSILON,
      positiveSemidefinite: minimumEigenvalue >= -EPSILON,
      populationsIndependentOfVisibility: true,
    }),
    interpretation: Object.freeze({
      populationMeasurementBasis: "computational Z basis",
      populationsAloneProveEntanglement: false,
      coherenceRequiredForEntanglement: true,
      simulatedQuantity: "ideal exchange pair with optional phase damping",
    }),
  });
}

function hashSeed(seed) {
  const source = String(seed ?? DEFAULT_SAMPLE_SEED);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG, deterministic and deliberately unsuitable for cryptography. */
export function createSquareDanceRandom(seed = DEFAULT_SAMPLE_SEED) {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizedProbabilityVector(probabilities) {
  if ((!Array.isArray(probabilities) && !ArrayBuffer.isView(probabilities)) || probabilities.length !== 4) {
    throw new TypeError("diagnostics.probabilities must contain four basis probabilities.");
  }
  const values = Array.from(probabilities, (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new RangeError("basis probabilities must contain positive mass.");
  return values.map((value) => value / total);
}

/** Seeded computational-basis shots. These samples do not estimate concurrence. */
export function sampleSquareDance(
  diagnostics,
  { shots = DEFAULT_SHOTS, seed = DEFAULT_SAMPLE_SEED } = {},
) {
  const count = boundedInteger(shots, DEFAULT_SHOTS, 1, MAX_SHOTS);
  const probabilities = normalizedProbabilityVector(diagnostics?.probabilities);
  const random = createSquareDanceRandom(seed);
  const outcomes = [];
  const counts = Object.fromEntries(SQUARE_DANCE_BASIS.map((basis) => [basis, 0]));

  for (let shot = 0; shot < count; shot += 1) {
    const draw = random();
    let cumulative = 0;
    let selected = SQUARE_DANCE_BASIS.at(-1);
    for (let index = 0; index < probabilities.length; index += 1) {
      cumulative += probabilities[index];
      if (draw < cumulative) {
        selected = SQUARE_DANCE_BASIS[index];
        break;
      }
    }
    outcomes.push(selected);
    counts[selected] += 1;
  }

  const frequencies = Object.freeze(Object.fromEntries(
    SQUARE_DANCE_BASIS.map((basis) => [basis, counts[basis] / count]),
  ));
  const sameSpinCount = counts["00"] + counts["11"];
  const oppositeSpinCount = counts["01"] + counts["10"];

  return Object.freeze({
    shots: count,
    seed,
    outcomes: freezeArray(outcomes),
    counts: Object.freeze(counts),
    frequencies,
    sameSpinCount,
    oppositeSpinCount,
    empiricalZZ: (sameSpinCount - oppositeSpinCount) / count,
    interpretation: "Z-basis shots reveal exchange populations, not entanglement by themselves.",
  });
}

/** Convert the measured 285 microsecond population cycle through a musical time lens. */
export function timeLensDiagnostics(
  musicalCycleSeconds = DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS.musicalCycleSeconds,
) {
  const musicalSeconds = positiveNumber(
    musicalCycleSeconds,
    DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS.musicalCycleSeconds,
  );
  const timeLens = musicalSeconds / PHYSICAL_EXCHANGE_CYCLE_SECONDS;
  return Object.freeze({
    physicalCycleSeconds: PHYSICAL_EXCHANGE_CYCLE_SECONDS,
    physicalCycleMicroseconds: PHYSICAL_EXCHANGE_CYCLE_SECONDS * 1e6,
    physicalExchangeFrequencyHz: 1 / PHYSICAL_EXCHANGE_CYCLE_SECONDS,
    sqrtSwapPhysicalSeconds: PHYSICAL_EXCHANGE_CYCLE_SECONDS / 4,
    fullSwapPhysicalSeconds: PHYSICAL_EXCHANGE_CYCLE_SECONDS / 2,
    musicalCycleSeconds: musicalSeconds,
    sqrtSwapMusicalSeconds: musicalSeconds / 4,
    fullSwapMusicalSeconds: musicalSeconds / 2,
    timeLens,
    slowdownFactor: timeLens,
    cycleRatePerMinute: 60 / musicalSeconds,
    fourBeatTempoBpm: 240 / musicalSeconds,
  });
}

function midiFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function normalizeMusicalSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  return Object.freeze({
    musicalCycleSeconds: positiveNumber(
      source.musicalCycleSeconds,
      DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS.musicalCycleSeconds,
    ),
    beatsPerCycle: boundedInteger(
      source.beatsPerCycle,
      DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS.beatsPerCycle,
      1,
      16,
    ),
    subdivisions: boundedInteger(
      source.subdivisions,
      DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS.subdivisions,
      2,
      64,
    ),
    rootMidi: clamp(
      finiteNumber(source.rootMidi, DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS.rootMidi),
      0,
      127,
    ),
    spinIntervalSemitones: clamp(
      finiteNumber(
        source.spinIntervalSemitones,
        DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS.spinIntervalSemitones,
      ),
      0,
      36,
    ),
    contourSemitones: clamp(
      finiteNumber(source.contourSemitones, DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS.contourSemitones),
      0,
      24,
    ),
    stereoWidth: clamp(
      finiteNumber(source.stereoWidth, DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS.stereoWidth),
      0,
      1,
    ),
    level: clamp(finiteNumber(source.level, DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS.level), 0, 1),
  });
}

function dominantSpin(marginal) {
  if (Math.abs(marginal.up - marginal.down) <= EPSILON) return "balanced";
  return marginal.up > marginal.down ? "up" : "down";
}

/**
 * Stable, isomorphic control snapshot for a synth or sequencer. Population
 * power and coherent interference are kept in separate fields so a 50/50
 * incoherent mixture is never sonified as if it were entangled.
 */
export function deriveSquareDanceSound(diagnostics, musicalSettings = {}) {
  if (!diagnostics?.settings || !diagnostics?.probabilities || !diagnostics?.coherence) {
    throw new TypeError("deriveSquareDanceSound requires simulateSquareDance diagnostics.");
  }
  const music = normalizeMusicalSettings(musicalSettings);
  const lens = timeLensDiagnostics(music.musicalCycleSeconds);
  const descriptor = PREPARATION[diagnostics.preparation];
  const swapBasis = descriptor.basis === "01"
    ? "10"
    : descriptor.basis === "10" ? "01" : descriptor.basis;
  const stayProbability = diagnostics.probabilitiesByBasis[descriptor.basis];
  const swapProbability = descriptor.opposite
    ? diagnostics.probabilitiesByBasis[swapBasis]
    : 0;
  const melodicPosition = descriptor.direction * (swapProbability - stayProbability);
  const coherentFlow = diagnostics.observables.xy;
  const upMidi = clamp(
    music.rootMidi + music.spinIntervalSemitones + melodicPosition * music.contourSemitones,
    0,
    127,
  );
  const downMidi = clamp(
    music.rootMidi - melodicPosition * music.contourSemitones,
    0,
    127,
  );
  const activeStep = Math.floor(diagnostics.timeline.phase * music.subdivisions) % music.subdivisions;
  const rhythmSteps = Array.from({ length: music.subdivisions }, (_, index) => {
    if (!descriptor.opposite) {
      return Object.freeze({
        index,
        phase: index / music.subdivisions,
        stayWeight: 1,
        swapWeight: 0,
        coherenceWeight: 0,
        contour: 0,
      });
    }
    const theta = TAU * index / music.subdivisions;
    return Object.freeze({
      index,
      phase: index / music.subdivisions,
      stayWeight: square(Math.cos(theta / 2)),
      swapWeight: square(Math.sin(theta / 2)),
      coherenceWeight: diagnostics.settings.visibility * Math.abs(Math.sin(theta)),
      contour: descriptor.direction * diagnostics.settings.visibility * Math.sin(theta),
    });
  });

  return Object.freeze({
    settings: music,
    tempo: Object.freeze({
      cycleSeconds: music.musicalCycleSeconds,
      beatsPerCycle: music.beatsPerCycle,
      bpm: 60 * music.beatsPerCycle / music.musicalCycleSeconds,
      timeLens: lens.timeLens,
      physicalExchangeFrequencyHz: lens.physicalExchangeFrequencyHz,
    }),
    spinVoices: Object.freeze({
      up: Object.freeze({ midi: upMidi, frequencyHz: midiFrequency(upMidi), timbre: "bright" }),
      down: Object.freeze({ midi: downMidi, frequencyHz: midiFrequency(downMidi), timbre: "dark" }),
    }),
    spatialRoles: Object.freeze({
      excited: Object.freeze({
        pan: -music.stereoWidth,
        ...diagnostics.orbitalMarginals.excited,
        dominantSpin: dominantSpin(diagnostics.orbitalMarginals.excited),
      }),
      ground: Object.freeze({
        pan: music.stereoWidth,
        ...diagnostics.orbitalMarginals.ground,
        dominantSpin: dominantSpin(diagnostics.orbitalMarginals.ground),
      }),
    }),
    branches: Object.freeze({
      stay: Object.freeze({
        basis: descriptor.basis,
        probability: stayProbability,
        amplitude: Math.sqrt(stayProbability),
        gain: music.level * Math.sqrt(stayProbability),
      }),
      swap: Object.freeze({
        basis: swapBasis,
        probability: swapProbability,
        amplitude: Math.sqrt(swapProbability),
        gain: music.level * Math.sqrt(swapProbability),
      }),
    }),
    interference: Object.freeze({
      coherenceMagnitude: diagnostics.coherence.magnitude,
      normalizedCoherence: diagnostics.coherence.normalizedMagnitude,
      relativePhase: diagnostics.coherence.phase,
      signedXY: diagnostics.observables.xy,
      spectralFusion: diagnostics.concurrence,
      coherenceGain: music.level * diagnostics.concurrence,
    }),
    contour: Object.freeze({
      direction: descriptor.direction,
      position: melodicPosition,
      coherentFlow,
      upMidi,
      downMidi,
    }),
    dynamics: Object.freeze({
      masterGain: music.level,
      stayGain: music.level * Math.sqrt(stayProbability),
      swapGain: music.level * Math.sqrt(swapProbability),
      coherenceGain: music.level * diagnostics.concurrence,
      exchangeAccent: music.level * (0.25 + 0.75 * Math.abs(coherentFlow)),
      texture: diagnostics.concurrence,
      jointPurity: diagnostics.jointPurity,
    }),
    rhythm: Object.freeze({
      subdivisions: music.subdivisions,
      activeStep,
      stayWeight: stayProbability,
      swapWeight: swapProbability,
      coherenceWeight: diagnostics.concurrence,
      steps: freezeArray(rhythmSteps),
    }),
    scientificGuardrail: Object.freeze({
      populationPowerSeparatedFromCoherence: true,
      populationsAloneProveEntanglement: false,
      entanglementMappedFromCoherence: true,
      statement: "Equal branch power is not enough: only the coherence layer maps modeled entanglement.",
    }),
  });
}

const CALLS = Object.freeze({
  prepared: Object.freeze({
    label: "Prepared",
    call: "Honor your partner",
    description: "Opposite spin labels begin in separate orbital roles.",
  }),
  entangling: Object.freeze({
    label: "Entangling",
    call: "Merge and turn",
    description: "Singlet and triplet phases separate as the exchange branches become coherent.",
  }),
  "sqrt-swap": Object.freeze({
    label: "Square-root SWAP",
    call: "Half-swap, branches balanced",
    description: "The two exchange branches have equal probability and maximal ideal coherence.",
  }),
  "completing-swap": Object.freeze({
    label: "Completing SWAP",
    call: "Carry the phase",
    description: "Interference moves population toward the exchanged spin assignment.",
  }),
  swapped: Object.freeze({
    label: "Full SWAP",
    call: "Trade spin roles",
    description: "The spin labels have exchanged orbital roles and the ideal pair is separable again.",
  }),
  "re-entangling": Object.freeze({
    label: "Re-entangling",
    call: "Turn through again",
    description: "The next coherent half-cycle grows from the swapped product state.",
  }),
  "sqrt-swap-return": Object.freeze({
    label: "Return square-root SWAP",
    call: "Half-swap on the return",
    description: "The branches balance again with the opposite signed exchange contour.",
  }),
  returning: Object.freeze({
    label: "Returning",
    call: "Resolve the exchange",
    description: "The exchange branches interfere back toward the prepared assignment.",
  }),
  returned: Object.freeze({
    label: "Returned",
    call: "Home with your partner",
    description: "One population cycle closes; global phase is not observable here.",
  }),
  aligned: Object.freeze({
    label: "Aligned eigenstate",
    call: "Hold your spin",
    description: "Aligned spins do not exchange in this model and remain separable.",
  }),
});

/** Human-readable stage call derived from, but not mutating, diagnostics. */
export function squareDanceCall(diagnostics) {
  const timeline = diagnostics?.timeline;
  if (!timeline || !CALLS[timeline.stage]) {
    throw new TypeError("squareDanceCall requires simulateSquareDance diagnostics.");
  }
  const source = CALLS[timeline.stage];
  return Object.freeze({
    id: timeline.stage,
    label: source.label,
    call: source.call,
    description: source.description,
    phase: timeline.phase,
    segment: timeline.segment,
    segmentProgress: timeline.segmentProgress,
    direction: timeline.direction,
  });
}
