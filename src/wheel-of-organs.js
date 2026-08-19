import {
  ARTICULATIONS,
  CONSONANTS,
  articulationKey,
  consonantVoiceParameters,
} from "./throatazoid.js";

const TAU = Math.PI * 2;
const DEFAULT_ROTATION = -Math.PI / 2;
const DEFAULT_WORD = "ORGANISM";
const DEFAULT_ROOT_MIDI = 48;
const PULL_PITCH_SEMITONES = 18;
const PULL_FORMANT_SEMITONES = -5;

export const WHEEL_MOUTH_LIMITS = Object.freeze({
  minimum: 0,
  default: 8,
  maximum: 32,
});

export const WHEEL_MORPH_LIMITS = Object.freeze({
  size: Object.freeze({ minimum: 0.2, default: 1, maximum: 2.6 }),
  stretch: Object.freeze({ minimum: 0.35, default: 1, maximum: 2.8 }),
  tongueOut: Object.freeze({ minimum: 0, default: 0.38, maximum: 1 }),
});

export const WHEEL_SPIN_PHASES = Object.freeze({
  idle: "idle",
  accelerating: "accelerating",
  coasting: "coasting",
  decelerating: "decelerating",
  sustaining: "sustaining",
  decaying: "decaying",
  cooldown: "cooldown",
});

export const WHEEL_SPIN_DEFAULTS = Object.freeze({
  readerAngle: 0,
  direction: 1,
  minimumTurns: 6,
  extraTurns: 2,
  accelerationSeconds: 0.9,
  coastSeconds: 1.7,
  decelerationSeconds: 4.8,
  sustainSeconds: 1.6,
  decaySeconds: 2.4,
  cooldownSeconds: 0.7,
  fixedStepSeconds: 1 / 120,
  seed: 0x57484545,
});

export const ALPHABET = Object.freeze([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]);

const DEFAULT_LETTER_ORDER = Object.freeze([
  ...new Set([...DEFAULT_WORD, ...ALPHABET]),
]);

const DEFAULT_INTERVALS = Object.freeze([0, 4, 7, 2, 5, 9, 7, 12, -5, 14, -2, 16]);

const CARRIER_FORMANTS = Object.freeze({
  AE: Object.freeze([660, 1_720, 2_410]),
  EH: Object.freeze([530, 1_840, 2_480]),
  IH: Object.freeze([390, 1_990, 2_550]),
  AO: Object.freeze([570, 840, 2_410]),
  AH: Object.freeze([640, 1_190, 2_390]),
  AX: Object.freeze([500, 1_500, 2_500]),
  IY: Object.freeze([270, 2_290, 3_010]),
  UW: Object.freeze([300, 870, 2_240]),
});

export const WHEEL_DENTAL_ARTICULATIONS = Object.freeze({
  th: Object.freeze({
    id: "th",
    symbol: "TH",
    name: "Unvoiced TH",
    manner: "fricative",
    place: "dental",
    articulator: "tongue-teeth",
    voiced: false,
    constrictionPosition: 0.985,
    constrictionDiameter: 0.46,
    oralClosure: 0.43,
    glottalClosure: 0,
    nasalCoupling: 0,
    frication: Object.freeze({ frequency: 4_650, q: 0.64, gain: 0.58 }),
    burst: Object.freeze({
      frequency: 4_100,
      q: 0.7,
      gain: 0,
      halfLife: 0.006,
      duration: 0.04,
    }),
    nasal: Object.freeze({ poleFrequency: 255, notchFrequency: 1_180, q: 3.2, gain: 0 }),
  }),
  dh: Object.freeze({
    id: "dh",
    symbol: "DH",
    name: "Voiced TH",
    manner: "fricative",
    place: "dental",
    articulator: "tongue-teeth",
    voiced: true,
    constrictionPosition: 0.985,
    constrictionDiameter: 0.5,
    oralClosure: 0.39,
    glottalClosure: 0,
    nasalCoupling: 0,
    frication: Object.freeze({ frequency: 4_050, q: 0.58, gain: 0.38 }),
    burst: Object.freeze({
      frequency: 3_700,
      q: 0.68,
      gain: 0,
      halfLife: 0.006,
      duration: 0.04,
    }),
    nasal: Object.freeze({ poleFrequency: 255, notchFrequency: 1_180, q: 3.2, gain: 0 }),
  }),
});

const LETTER_CARRIERS = Object.freeze({
  A: "AE",
  E: "EH",
  I: "IH",
  O: "AO",
  U: "UW",
});

const VOWELS = new Set(["A", "E", "I", "O", "U"]);

const VOICED_TH_WORDS = new Set([
  "THE",
  "THAT",
  "THAN",
  "THEE",
  "THEIR",
  "THEM",
  "THEN",
  "THERE",
  "THESE",
  "THEY",
  "THIS",
  "THOSE",
  "THOUGH",
  "THUS",
  "THY",
]);

function wordAt(characters, index) {
  let start = index;
  let end = index + 1;
  while (start > 0 && /^[A-Z]$/.test(characters[start - 1] ?? "")) start -= 1;
  while (end < characters.length && /^[A-Z]$/.test(characters[end] ?? "")) end += 1;
  return characters.slice(start, end).join("");
}

function setSpeechSequence(plan, articulations, carriers, weights) {
  plan.articulationSequence = [...articulations];
  if (Array.isArray(carriers)) plan.carrierSequence = [...carriers];
  if (Array.isArray(weights)) plan.sequenceWeights = [...weights];
  plan.articulation = plan.articulationSequence[0] ?? plan.articulation;
  if (plan.carrierSequence?.[0]) plan.carrierLetter = plan.carrierSequence[0];
}

function normalizedSequenceWeights(length, values) {
  if (length <= 0) return [];
  const weights = Array.from({ length }, (_, index) => {
    const value = Number(values?.[index]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

function speechPlans(word) {
  const characters = [...word];
  const plans = characters.map((character) => ({
    articulation: character === " " ? "" : character.toLowerCase(),
    carrierLetter: LETTER_CARRIERS[character] ?? null,
    durationScale: VOWELS.has(character) ? 0.9 : 0.58,
    silent: character === " ",
  }));
  const isLetter = (index) => /^[A-Z]$/.test(characters[index] ?? "");
  const isWordEnd = (index) => !isLetter(index + 1);

  for (let index = 0; index < characters.length; index += 1) {
    const current = characters[index];
    const next = characters[index + 1] ?? "";
    if (!isLetter(index)) continue;

    const pair = current + next;
    const plan = plans[index];
    const following = plans[index + 1];
    const currentWord = wordAt(characters, index);
    if (pair === "CH") {
      plan.articulation = "c";
      plan.durationScale = 0.62;
      following.silent = true;
    } else if (pair === "SH") {
      plan.articulation = "sh";
      plan.durationScale = 0.65;
      following.silent = true;
    } else if (pair === "NG") {
      plan.articulation = "ng";
      plan.durationScale = 0.7;
      following.silent = true;
    } else if (pair === "PH") {
      plan.articulation = "f";
      plan.durationScale = 0.58;
      following.silent = true;
    } else if (pair === "TH") {
      const voiced = VOICED_TH_WORDS.has(currentWord)
        || (VOWELS.has(characters[index - 1]) && VOWELS.has(characters[index + 2]));
      plan.articulation = voiced ? "dh" : "th";
      plan.durationScale = 0.6;
      following.silent = true;
    } else if (pair === "CK") {
      plan.articulation = "k";
      plan.durationScale = 0.52;
      following.silent = true;
    } else if (pair === "QU") {
      plan.articulation = "k";
      following.articulation = "w";
      following.carrierLetter = "UW";
      plan.durationScale = 0.46;
      following.durationScale = 0.5;
    } else if (pair === "EE" || pair === "EA") {
      plan.articulation = "i";
      plan.carrierLetter = "IY";
      plan.durationScale = 0.98;
      following.silent = true;
    } else if (pair === "OO") {
      plan.articulation = "u";
      plan.carrierLetter = "UW";
      plan.durationScale = 0.98;
      following.silent = true;
    } else if (pair === "OU" || pair === "OW") {
      setSpeechSequence(plan, ["a", "u"], ["AH", "UW"], [0.46, 0.54]);
      plan.durationScale = 1.02;
      following.silent = true;
    } else if (pair === "AI" || pair === "AY") {
      plan.articulation = "e";
      plan.carrierLetter = "EH";
      plan.durationScale = 0.96;
      following.silent = true;
    } else if (
      current === next
      && !VOWELS.has(current)
    ) {
      following.silent = true;
    }

    if (current === "C" && pair !== "CH") {
      plan.articulation = /[EIY]/.test(next) ? "s" : "k";
    }
    if (current === "G" && plan.articulation === "g" && /[EIY]/.test(next)) {
      plan.articulation = "j";
    }
    if (current === "Y" && isWordEnd(index)) {
      plan.articulation = "i";
      plan.carrierLetter = "IY";
      plan.durationScale = 0.9;
    }
    if (current === "X") {
      setSpeechSequence(plan, ["k", "s"], null, [0.38, 0.62]);
      plan.durationScale = 0.68;
    }
    if (current === "E" && isWordEnd(index) && index > 1) {
      let previousVowel = -1;
      for (let previous = index - 1; previous >= 0 && isLetter(previous); previous -= 1) {
        if (VOWELS.has(characters[previous]) && !plans[previous].silent) {
          previousVowel = previous;
          break;
        }
      }
      if (previousVowel >= 0) {
        plan.silent = true;
        plans[previousVowel].durationScale = Math.max(
          plans[previousVowel].durationScale,
          0.98,
        );
      } else if (currentWord === "SHE") {
        plan.articulation = "i";
        plan.carrierLetter = "IY";
      } else if (currentWord === "THE") {
        plan.carrierLetter = "AX";
      }
    }
  }

  for (let index = 0; index < plans.length; index += 1) {
    if (!isLetter(index) || plans[index].carrierLetter) continue;
    let carrier = null;
    for (let next = index + 1; next < plans.length && isLetter(next); next += 1) {
      if (plans[next].carrierLetter && !plans[next].silent) {
        carrier = plans[next].carrierLetter;
        break;
      }
    }
    if (!carrier) {
      for (let previous = index - 1; previous >= 0 && isLetter(previous); previous -= 1) {
        if (plans[previous].carrierLetter && !plans[previous].silent) {
          carrier = plans[previous].carrierSequence?.at(-1)
            ?? plans[previous].carrierLetter;
          break;
        }
      }
    }
    plans[index].carrierLetter = carrier ?? "AX";
  }

  for (const plan of plans) {
    if (plan.silent) {
      plan.articulationSequence = [];
      plan.carrierSequence = [];
      plan.sequenceWeights = [];
      continue;
    }
    const articulations = Array.isArray(plan.articulationSequence)
      && plan.articulationSequence.length
      ? plan.articulationSequence
      : [plan.articulation];
    const requestedCarriers = Array.isArray(plan.carrierSequence)
      ? plan.carrierSequence
      : [];
    const carriers = articulations.map((_, index) => (
      requestedCarriers[index]
        ?? requestedCarriers.at(-1)
        ?? plan.carrierLetter
        ?? "AX"
    ));
    plan.articulationSequence = articulations;
    plan.carrierSequence = carriers;
    plan.sequenceWeights = normalizedSequenceWeights(
      articulations.length,
      plan.sequenceWeights,
    );
    plan.articulation = articulations[0];
    plan.carrierLetter = carriers[0];
  }
  return plans;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1, fallback = minimum) {
  let low = finiteNumber(minimum, 0);
  let high = finiteNumber(maximum, low);
  if (high < low) [low, high] = [high, low];
  const safeFallback = Math.min(high, Math.max(low, finiteNumber(fallback, low)));
  return Math.min(high, Math.max(low, finiteNumber(value, safeFallback)));
}

function clampInteger(value, minimum, maximum, fallback = minimum) {
  return Math.round(clamp(value, minimum, maximum, fallback));
}

function mouthCount(value, fallback = WHEEL_MOUTH_LIMITS.default) {
  return clampInteger(
    value,
    WHEEL_MOUTH_LIMITS.minimum,
    WHEEL_MOUTH_LIMITS.maximum,
    fallback,
  );
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function spinDirection(value, fallback = WHEEL_SPIN_DEFAULTS.direction) {
  const requested = finiteNumber(value, fallback);
  return requested < 0 ? -1 : 1;
}

function spinSeed(value, fallback = WHEEL_SPIN_DEFAULTS.seed) {
  const requested = Number(value);
  return Number.isFinite(requested) ? Math.trunc(requested) >>> 0 : fallback >>> 0;
}

function nextSpinSeed(value) {
  return (Math.imul(spinSeed(value), 1_664_525) + 1_013_904_223) >>> 0;
}

function spinUnit(value) {
  return spinSeed(value) / 0x1_0000_0000;
}

function spinSeconds(value, fallback, minimum = 0) {
  return clamp(value, minimum, 60, fallback);
}

function spinTimings(source = {}) {
  return {
    accelerationSeconds: spinSeconds(
      source.accelerationSeconds,
      WHEEL_SPIN_DEFAULTS.accelerationSeconds,
      0.05,
    ),
    coastSeconds: spinSeconds(
      source.coastSeconds,
      WHEEL_SPIN_DEFAULTS.coastSeconds,
    ),
    decelerationSeconds: spinSeconds(
      source.decelerationSeconds,
      WHEEL_SPIN_DEFAULTS.decelerationSeconds,
      0.05,
    ),
    sustainSeconds: spinSeconds(
      source.sustainSeconds,
      WHEEL_SPIN_DEFAULTS.sustainSeconds,
      0.05,
    ),
    decaySeconds: spinSeconds(
      source.decaySeconds,
      WHEEL_SPIN_DEFAULTS.decaySeconds,
      0.05,
    ),
    cooldownSeconds: spinSeconds(
      source.cooldownSeconds,
      WHEEL_SPIN_DEFAULTS.cooldownSeconds,
    ),
  };
}

function spinMotionDuration(timings) {
  return timings.accelerationSeconds
    + timings.coastSeconds
    + timings.decelerationSeconds;
}

function spinLifecycleDuration(timings) {
  return spinMotionDuration(timings)
    + timings.sustainSeconds
    + timings.decaySeconds
    + timings.cooldownSeconds;
}

function spinMotionAt(spin, elapsedSeconds) {
  const accelerationSeconds = spin.accelerationSeconds;
  const coastSeconds = spin.coastSeconds;
  const decelerationSeconds = spin.decelerationSeconds;
  const motionDurationSeconds = spin.motionDurationSeconds;
  const peak = Math.max(0, finiteNumber(spin.peakAngularVelocity, 0));
  const elapsed = clamp(elapsedSeconds, 0, motionDurationSeconds, 0);
  const accelerationDistance = peak * accelerationSeconds * 0.5;
  const coastDistance = peak * coastSeconds;
  let distance;
  let velocity;

  if (elapsed < accelerationSeconds) {
    const ratio = elapsed / accelerationSeconds;
    distance = accelerationDistance * ratio * ratio;
    velocity = peak * ratio;
  } else if (elapsed < accelerationSeconds + coastSeconds) {
    const coastElapsed = elapsed - accelerationSeconds;
    distance = accelerationDistance + peak * coastElapsed;
    velocity = peak;
  } else if (elapsed < motionDurationSeconds) {
    const decelerationElapsed = elapsed - accelerationSeconds - coastSeconds;
    const ratio = decelerationElapsed / decelerationSeconds;
    distance = accelerationDistance
      + coastDistance
      + peak * decelerationElapsed
      - peak * decelerationSeconds * ratio * ratio * 0.5;
    velocity = peak * (1 - ratio);
  } else {
    distance = spin.travelRadians;
    velocity = 0;
  }

  return {
    distance: Math.min(spin.travelRadians, Math.max(0, distance)),
    velocity: spin.direction * velocity,
  };
}

function spinTimeAtDistance(spin, requestedDistance) {
  const distance = clamp(requestedDistance, 0, spin.travelRadians, 0);
  const peak = spin.peakAngularVelocity;
  const accelerationDistance = peak * spin.accelerationSeconds * 0.5;
  const coastDistance = peak * spin.coastSeconds;
  const decelerationStartDistance = accelerationDistance + coastDistance;

  if (distance <= accelerationDistance) {
    return Math.sqrt(2 * distance * spin.accelerationSeconds / peak);
  }
  if (distance <= decelerationStartDistance) {
    return spin.accelerationSeconds + (distance - accelerationDistance) / peak;
  }
  const remainingDistance = Math.max(0, spin.travelRadians - distance);
  const remainingTime = Math.sqrt(
    2 * remainingDistance * spin.decelerationSeconds / peak,
  );
  return spin.motionDurationSeconds - remainingTime;
}

function spinPhaseAt(spin, elapsedSeconds) {
  const motionEnd = spin.motionDurationSeconds;
  const sustainEnd = motionEnd + spin.sustainSeconds;
  const decayEnd = sustainEnd + spin.decaySeconds;
  const cooldownEnd = decayEnd + spin.cooldownSeconds;
  const elapsed = clamp(elapsedSeconds, 0, cooldownEnd, 0);

  if (elapsed < spin.accelerationSeconds) {
    return [WHEEL_SPIN_PHASES.accelerating, elapsed];
  }
  if (elapsed < spin.accelerationSeconds + spin.coastSeconds) {
    return [
      WHEEL_SPIN_PHASES.coasting,
      elapsed - spin.accelerationSeconds,
    ];
  }
  if (elapsed < motionEnd) {
    return [
      WHEEL_SPIN_PHASES.decelerating,
      elapsed - spin.accelerationSeconds - spin.coastSeconds,
    ];
  }
  if (elapsed < sustainEnd) {
    return [WHEEL_SPIN_PHASES.sustaining, elapsed - motionEnd];
  }
  if (elapsed < decayEnd) {
    return [WHEEL_SPIN_PHASES.decaying, elapsed - sustainEnd];
  }
  if (elapsed < cooldownEnd) {
    return [WHEEL_SPIN_PHASES.cooldown, elapsed - decayEnd];
  }
  return [WHEEL_SPIN_PHASES.idle, 0];
}

function spinEndState(spin, elapsedSeconds) {
  const motionEnd = spin.motionDurationSeconds;
  const sustainEnd = motionEnd + spin.sustainSeconds;
  const decayEnd = sustainEnd + spin.decaySeconds;
  const lifecycleDurationSeconds = decayEnd + spin.cooldownSeconds;
  const elapsed = clamp(elapsedSeconds, 0, lifecycleDurationSeconds, 0);
  const [phase, phaseElapsedSeconds] = spinPhaseAt(spin, elapsed);
  const moving = elapsed < motionEnd;
  const motion = moving
    ? spinMotionAt(spin, elapsed)
    : { distance: spin.travelRadians, velocity: 0 };
  const sustaining = phase === WHEEL_SPIN_PHASES.sustaining;
  const decaying = phase === WHEEL_SPIN_PHASES.decaying;
  const finalEnvelope = sustaining
    ? 1
    : decaying
      ? clamp(1 - phaseElapsedSeconds / spin.decaySeconds)
      : 0;
  const finalMouthIndex = elapsed >= motionEnd
    ? spin.targetMouthIndex
    : null;
  const idle = phase === WHEEL_SPIN_PHASES.idle;

  return {
    ...spin,
    phase,
    rotation: spin.startRotation + spin.direction * motion.distance,
    angularVelocity: motion.velocity,
    elapsedSeconds: elapsed,
    phaseElapsedSeconds,
    motionElapsedSeconds: Math.min(elapsed, motionEnd),
    progress: spin.travelRadians > 0 ? motion.distance / spin.travelRadians : 0,
    finalMouthIndex,
    finalEnvelope,
    sustainRemainingSeconds: elapsed < motionEnd
      ? spin.sustainSeconds
      : Math.max(0, sustainEnd - elapsed),
    decayRemainingSeconds: elapsed < sustainEnd
      ? spin.decaySeconds
      : Math.max(0, decayEnd - elapsed),
    cooldownRemainingSeconds: elapsed < decayEnd
      ? spin.cooldownSeconds
      : Math.max(0, lifecycleDurationSeconds - elapsed),
    locked: !idle,
    canSpin: idle && spin.mouthCount > 0,
  };
}

/**
 * Create the wheel's quiet, motionless transport. The state is intentionally
 * plain data so a UI can keep it in any store and advance it at a fixed step.
 */
export function createWheelSpinState(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const count = mouthCount(source.mouthCount ?? source.count, WHEEL_MOUTH_LIMITS.default);
  const timings = spinTimings(source);
  return {
    phase: WHEEL_SPIN_PHASES.idle,
    rotation: finiteNumber(source.rotation, DEFAULT_ROTATION),
    angularVelocity: 0,
    mouthCount: count,
    readerAngle: finiteNumber(source.readerAngle, WHEEL_SPIN_DEFAULTS.readerAngle),
    direction: spinDirection(source.direction),
    targetMouthIndex: null,
    finalMouthIndex: null,
    spinNumber: clampInteger(source.spinNumber, 0, 1_000_000_000, 0),
    rngState: spinSeed(source.seed ?? source.rngState),
    elapsedSeconds: 0,
    phaseElapsedSeconds: 0,
    motionElapsedSeconds: 0,
    motionDurationSeconds: 0,
    lifecycleDurationSeconds: 0,
    startRotation: finiteNumber(source.rotation, DEFAULT_ROTATION),
    targetRotation: finiteNumber(source.rotation, DEFAULT_ROTATION),
    travelRadians: 0,
    peakAngularVelocity: 0,
    progress: 0,
    finalEnvelope: 0,
    sustainRemainingSeconds: 0,
    decayRemainingSeconds: 0,
    cooldownRemainingSeconds: 0,
    locked: false,
    canSpin: count > 0,
    ...timings,
  };
}

/** True only after the complete final decay and cooldown, and with a mouth to spin. */
export function canStartWheelSpin(state) {
  return state?.phase === WHEEL_SPIN_PHASES.idle
    && state?.locked !== true
    && mouthCount(state?.mouthCount, 0) > 0;
}

/**
 * Start a deterministic Wheel-of-Fortune trajectory. A supplied target wins;
 * otherwise the state's seeded generator selects the landing mouth and turns.
 */
export function startWheelSpin(state = createWheelSpinState(), options = {}) {
  const current = state && typeof state === "object" && state.phase
    ? state
    : createWheelSpinState(state);
  if (!canStartWheelSpin(current)) return current;
  const source = options && typeof options === "object" ? options : {};
  const count = mouthCount(source.mouthCount ?? current.mouthCount, current.mouthCount);
  if (count <= 0) return { ...current, mouthCount: 0, canSpin: false };

  const direction = spinDirection(source.direction, current.direction);
  const readerAngle = finiteNumber(source.readerAngle, current.readerAngle);
  let rngState = spinSeed(source.seed ?? current.rngState);
  if (source.targetMouthIndex === undefined) rngState = nextSpinSeed(rngState);
  const targetMouthIndex = source.targetMouthIndex === undefined
    ? Math.min(count - 1, Math.floor(spinUnit(rngState) * count))
    : clampInteger(source.targetMouthIndex, 0, count - 1, 0);
  const minimumTurns = clampInteger(
    source.minimumTurns,
    3,
    24,
    WHEEL_SPIN_DEFAULTS.minimumTurns,
  );
  const extraTurns = clampInteger(
    source.extraTurns,
    0,
    12,
    WHEEL_SPIN_DEFAULTS.extraTurns,
  );
  if (source.turns === undefined) rngState = nextSpinSeed(rngState);
  const turns = source.turns === undefined
    ? minimumTurns + Math.floor(spinUnit(rngState) * (extraTurns + 1))
    : clampInteger(source.turns, 3, 36, minimumTurns);
  const timings = spinTimings({ ...current, ...source });
  const motionDurationSeconds = spinMotionDuration(timings);
  const lifecycleDurationSeconds = spinLifecycleDuration(timings);
  const startRotation = finiteNumber(current.rotation, DEFAULT_ROTATION);
  const mouthAngle = TAU / count;
  const targetAlignment = readerAngle - targetMouthIndex * mouthAngle;
  const alignmentTravel = direction > 0
    ? positiveModulo(targetAlignment - startRotation, TAU)
    : positiveModulo(startRotation - targetAlignment, TAU);
  const travelRadians = turns * TAU + alignmentTravel;
  const weightedMotionSeconds = timings.coastSeconds
    + timings.accelerationSeconds * 0.5
    + timings.decelerationSeconds * 0.5;
  const peakAngularVelocity = travelRadians / weightedMotionSeconds;
  const targetRotation = startRotation + direction * travelRadians;

  return {
    ...current,
    ...timings,
    phase: WHEEL_SPIN_PHASES.accelerating,
    rotation: startRotation,
    angularVelocity: 0,
    mouthCount: count,
    readerAngle,
    direction,
    targetMouthIndex,
    finalMouthIndex: null,
    spinNumber: clampInteger(current.spinNumber + 1, 0, 1_000_000_000, 1),
    rngState,
    elapsedSeconds: 0,
    phaseElapsedSeconds: 0,
    motionElapsedSeconds: 0,
    motionDurationSeconds,
    lifecycleDurationSeconds,
    startRotation,
    targetRotation,
    travelRadians,
    peakAngularVelocity,
    progress: 0,
    finalEnvelope: 0,
    sustainRemainingSeconds: timings.sustainSeconds,
    decayRemainingSeconds: timings.decaySeconds,
    cooldownRemainingSeconds: timings.cooldownSeconds,
    locked: true,
    canSpin: false,
  };
}

/**
 * Enumerate only physical mouth crossings of the fixed reader (3 o'clock by
 * default). The start angle is exclusive and the end angle is inclusive.
 */
export function wheelMouthCrossings(
  fromRotation,
  toRotation,
  requestedMouthCount,
  options = {},
) {
  const count = mouthCount(requestedMouthCount, 0);
  const from = finiteNumber(fromRotation, 0);
  const to = finiteNumber(toRotation, from);
  if (count <= 0 || Math.abs(to - from) < 1e-12) return [];
  const source = options && typeof options === "object" ? options : {};
  const readerAngle = finiteNumber(source.readerAngle, WHEEL_SPIN_DEFAULTS.readerAngle);
  const spacing = TAU / count;
  const fromGrid = (from - readerAngle) / spacing;
  const toGrid = (to - readerAngle) / spacing;
  const crossings = [];
  const epsilon = 1e-10;

  if (to > from) {
    const first = Math.floor(fromGrid + epsilon) + 1;
    const last = Math.floor(toGrid + epsilon);
    for (let grid = first; grid <= last; grid += 1) {
      crossings.push({
        type: "mouth-crossing",
        mouthIndex: positiveModulo(-grid, count),
        crossingRotation: readerAngle + grid * spacing,
        readerAngle,
        direction: 1,
      });
    }
  } else {
    const first = Math.ceil(fromGrid - epsilon) - 1;
    const last = Math.ceil(toGrid - epsilon);
    for (let grid = first; grid >= last; grid -= 1) {
      crossings.push({
        type: "mouth-crossing",
        mouthIndex: positiveModulo(-grid, count),
        crossingRotation: readerAngle + grid * spacing,
        readerAngle,
        direction: -1,
      });
    }
  }
  return crossings;
}

/**
 * Advance a spin without mutating it. Analytic kinematics make the final state
 * independent of whether callers use one large step or many fixed small ones.
 */
export function stepWheelSpin(state, deltaSeconds = 0) {
  const current = state && typeof state === "object" && state.phase
    ? state
    : createWheelSpinState(state);
  const delta = Math.max(0, finiteNumber(deltaSeconds, 0));
  if (delta <= 0 || current.phase === WHEEL_SPIN_PHASES.idle) {
    return { state: current, events: [] };
  }

  const previousElapsed = clamp(
    current.elapsedSeconds,
    0,
    current.lifecycleDurationSeconds,
    0,
  );
  let nextElapsed = Math.min(
    current.lifecycleDurationSeconds,
    previousElapsed + delta,
  );
  // Repeated browser-frame deltas can accumulate just below a phase boundary
  // (for example 7.399999999999982 instead of 7.4). Snap that numerical dust
  // so the mouth that physically reaches the reader is also marked final.
  for (const boundary of [
    current.motionDurationSeconds,
    current.motionDurationSeconds + current.sustainSeconds,
    current.motionDurationSeconds + current.sustainSeconds + current.decaySeconds,
    current.lifecycleDurationSeconds,
  ]) {
    if (Math.abs(nextElapsed - boundary) < 1e-10) nextElapsed = boundary;
  }
  const next = spinEndState(current, nextElapsed);
  const events = wheelMouthCrossings(
    current.rotation,
    next.rotation,
    current.mouthCount,
    { readerAngle: current.readerAngle },
  ).map((event) => {
    const distance = Math.abs(event.crossingRotation - current.startRotation);
    const crossingElapsedSeconds = spinTimeAtDistance(current, distance);
    const crossingMotion = spinMotionAt(current, crossingElapsedSeconds);
    return {
      ...event,
      angularVelocity: crossingMotion.velocity,
      crossingElapsedSeconds,
      stepOffsetSeconds: clamp(
        crossingElapsedSeconds - previousElapsed,
        0,
        delta,
        0,
      ),
      progress: distance / current.travelRadians,
      isFinal: false,
      sustainSeconds: 0,
      decaySeconds: 0,
    };
  });

  if (previousElapsed < current.motionDurationSeconds
    && nextElapsed >= current.motionDurationSeconds
    && events.length) {
    const finalEvent = events.at(-1);
    finalEvent.isFinal = true;
    finalEvent.sustainSeconds = current.sustainSeconds;
    finalEvent.decaySeconds = current.decaySeconds;
  }

  return { state: next, events };
}

function normalizeLetter(value, fallback = "A") {
  const letter = String(value ?? "").trim().toUpperCase();
  return ALPHABET.includes(letter) ? letter : fallback;
}

function defaultLetter(index) {
  return DEFAULT_LETTER_ORDER[index % DEFAULT_LETTER_ORDER.length];
}

function defaultMouth(index, requestedLetter = defaultLetter(index)) {
  return {
    id: `mouth-${index + 1}`,
    active: true,
    letter: normalizeLetter(requestedLetter, defaultLetter(index)),
    pull: clamp(0.3 + (index % 4) * 0.055),
    tongue: clamp(0.48 + Math.sin(index * 1.71) * 0.19),
    tongueOut: clamp(0.34 + (index % 4) * 0.035),
    aperture: clamp(0.66 + Math.cos(index * 1.37) * 0.12),
    glottalTension: clamp(0.52 + Math.sin(index * 0.93) * 0.1),
    breath: clamp(0.12 + (index % 3) * 0.035),
    pinch: clamp(0.1 + (index % 3) * 0.025),
    push: clamp(0.54 + Math.sin(index * 1.13) * 0.08),
    nasality: clamp(0.68 + (index % 3) * 0.045),
    screech: clamp(0.32 + (index % 4) * 0.035),
    size: clamp(
      0.94 + Math.sin(index * 0.79) * 0.1,
      WHEEL_MORPH_LIMITS.size.minimum,
      WHEEL_MORPH_LIMITS.size.maximum,
      WHEEL_MORPH_LIMITS.size.default,
    ),
    stretch: clamp(
      0.92 + (index % 3) * 0.08,
      WHEEL_MORPH_LIMITS.stretch.minimum,
      WHEEL_MORPH_LIMITS.stretch.maximum,
      WHEEL_MORPH_LIMITS.stretch.default,
    ),
    interval: DEFAULT_INTERVALS[index % DEFAULT_INTERVALS.length],
  };
}

function uniqueId(value, fallback, usedIds) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (candidate && !usedIds.has(candidate)) return candidate;
  let suffix = 1;
  let generated = fallback;
  while (usedIds.has(generated)) {
    suffix += 1;
    generated = `${fallback}-${suffix}`;
  }
  return generated;
}

function sanitizeMouth(source, fallback, index, usedIds) {
  const mouth = source && typeof source === "object" ? source : {};
  const id = uniqueId(mouth.id, fallback.id, usedIds);
  usedIds.add(id);

  return {
    id,
    active: mouth.active === undefined ? fallback.active : Boolean(mouth.active),
    letter: normalizeLetter(mouth.letter, fallback.letter),
    pull: clamp(mouth.pull, 0, 1, fallback.pull),
    tongue: clamp(mouth.tongue, 0, 1, fallback.tongue),
    tongueOut: clamp(
      mouth.tongueOut ?? mouth.protrusion,
      WHEEL_MORPH_LIMITS.tongueOut.minimum,
      WHEEL_MORPH_LIMITS.tongueOut.maximum,
      fallback.tongueOut,
    ),
    aperture: clamp(mouth.aperture, 0, 1, fallback.aperture),
    glottalTension: clamp(
      mouth.glottalTension ?? mouth.glottis,
      0,
      1,
      fallback.glottalTension,
    ),
    breath: clamp(mouth.breath, 0, 1, fallback.breath),
    pinch: clamp(mouth.pinch ?? mouth.constriction, 0, 1, fallback.pinch),
    push: clamp(mouth.push ?? mouth.pressure, 0, 1, fallback.push),
    nasality: clamp(mouth.nasality ?? mouth.nasal, 0, 1, fallback.nasality),
    screech: clamp(mouth.screech ?? mouth.edge, 0, 1, fallback.screech),
    size: clamp(
      mouth.size ?? mouth.scale,
      WHEEL_MORPH_LIMITS.size.minimum,
      WHEEL_MORPH_LIMITS.size.maximum,
      fallback.size,
    ),
    stretch: clamp(
      mouth.stretch ?? mouth.elongation,
      WHEEL_MORPH_LIMITS.stretch.minimum,
      WHEEL_MORPH_LIMITS.stretch.maximum,
      fallback.stretch,
    ),
    interval: clamp(mouth.interval, -36, 36, fallback.interval),
  };
}

/** Keep a typed word inside the wheel's deliberately literal A-Z vocabulary. */
export function normalizeWheelWord(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32)
    .trim();
}

/** Create a deterministic wheel whose eight default mouths spell ORGANISM. */
export function createWheelState(options = {}) {
  const source = typeof options === "number" ? { mouthCount: options } : options;
  const safeSource = source && typeof source === "object" ? source : {};
  const word = normalizeWheelWord(safeSource.word ?? DEFAULT_WORD);
  const letters = [...word].filter((character) => /^[A-Z]$/.test(character));
  const hasExplicitCount = safeSource.mouthCount !== undefined
    || safeSource.count !== undefined;
  const count = hasExplicitCount
    ? mouthCount(safeSource.mouthCount ?? safeSource.count)
    : mouthCount(letters.length, letters.length);
  return sanitizeWheelState({
    word,
    rootMidi: safeSource.rootMidi ?? DEFAULT_ROOT_MIDI,
    mouthCount: count,
    mouths: Array.from(
      { length: count },
      (_, index) => defaultMouth(index, letters[index] ?? defaultLetter(index)),
    ),
  });
}

/** Clone and repair external wheel state without retaining caller references. */
export function sanitizeWheelState(state = {}) {
  const source = state && typeof state === "object" ? state : {};
  const hasSuppliedMouths = Array.isArray(source.mouths);
  const suppliedMouths = hasSuppliedMouths ? source.mouths : [];
  const word = normalizeWheelWord(source.word ?? DEFAULT_WORD);
  const wordLetters = [...word].filter((character) => /^[A-Z]$/.test(character));
  const requestedCount = source.mouthCount ?? source.count ?? (
    hasSuppliedMouths ? suppliedMouths.length : wordLetters.length
  );
  const count = mouthCount(requestedCount);
  const usedIds = new Set();
  const mouths = Array.from({ length: count }, (_, index) => sanitizeMouth(
    suppliedMouths[index],
    defaultMouth(index, wordLetters[index] ?? defaultLetter(index)),
    index,
    usedIds,
  ));
  return {
    word,
    rootMidi: clamp(source.rootMidi, 24, 84, DEFAULT_ROOT_MIDI),
    mouths,
  };
}

function occurrenceKeys(letters) {
  const counts = new Map();
  return letters.map((letter) => {
    const occurrence = counts.get(letter) ?? 0;
    counts.set(letter, occurrence + 1);
    return `${letter}:${occurrence}`;
  });
}

function freshMouthId(usedIds) {
  let suffix = 1;
  while (usedIds.has(`mouth-${suffix}`)) suffix += 1;
  const id = `mouth-${suffix}`;
  usedIds.add(id);
  return id;
}

/**
 * Synchronize one mouth per alphabetic character occurrence. Existing anatomy is
 * matched by letter-occurrence first, then by its still-unused stable position.
 */
export function wheelStateForWord(word, priorState) {
  const normalized = normalizeWheelWord(word);
  const letters = [...normalized].filter((character) => /^[A-Z]$/.test(character));
  const prior = priorState === undefined
    ? null
    : sanitizeWheelState(
      Array.isArray(priorState) ? { mouths: priorState } : priorState,
    );
  const priorMouths = prior?.mouths ?? [];
  const priorKeys = occurrenceKeys(priorMouths.map(({ letter }) => letter));
  const nextKeys = occurrenceKeys(letters);
  const priorIndexByKey = new Map(priorKeys.map((key, index) => [key, index]));
  const usedPriorIndexes = new Set();
  const selected = Array(letters.length).fill(null);

  // Preserve a repeated character's own patch even when spaces or neighbors move.
  for (let index = 0; index < letters.length; index += 1) {
    const priorIndex = priorIndexByKey.get(nextKeys[index]);
    if (priorIndex === undefined || usedPriorIndexes.has(priorIndex)) continue;
    selected[index] = { ...priorMouths[priorIndex], letter: letters[index] };
    usedPriorIndexes.add(priorIndex);
  }

  // A changed character can inherit the patch already living at the same spoke.
  for (let index = 0; index < letters.length; index += 1) {
    if (selected[index] || !priorMouths[index] || usedPriorIndexes.has(index)) continue;
    selected[index] = { ...priorMouths[index], letter: letters[index] };
    usedPriorIndexes.add(index);
  }

  // Fresh ids never steal an id from an occurrence that may have moved elsewhere.
  const usedIds = new Set(priorMouths.map(({ id }) => id));
  for (let index = 0; index < letters.length; index += 1) {
    if (selected[index]) continue;
    selected[index] = {
      ...defaultMouth(index, letters[index]),
      id: freshMouthId(usedIds),
    };
  }

  return sanitizeWheelState({
    word: normalized,
    rootMidi: prior?.rootMidi ?? DEFAULT_ROOT_MIDI,
    mouthCount: letters.length,
    mouths: selected,
  });
}

/** Resize immutably while preserving every retained mouth's stable id and patch. */
export function resizeWheelMouths(state, requestedCount) {
  const safe = sanitizeWheelState(state);
  const count = mouthCount(requestedCount, safe.mouths.length);
  if (count <= safe.mouths.length) {
    return sanitizeWheelState({ ...safe, mouthCount: count, mouths: safe.mouths.slice(0, count) });
  }

  const mouths = safe.mouths.map((mouth) => ({ ...mouth }));
  const usedIds = new Set(mouths.map(({ id }) => id));
  for (let index = mouths.length; index < count; index += 1) {
    const fallback = defaultMouth(index);
    const mouth = sanitizeMouth(fallback, fallback, index, usedIds);
    mouths.push(mouth);
  }
  return sanitizeWheelState({ ...safe, mouthCount: count, mouths });
}

function mouthIndexForSelector(mouths, selector) {
  if (Number.isInteger(Number(selector))) {
    const index = Number(selector);
    return index >= 0 && index < mouths.length ? index : -1;
  }
  if (typeof selector !== "string") return -1;
  return mouths.findIndex(({ id }) => id === selector);
}

/** Assign one A-Z letter to one mouth. Repeated assignments are intentional. */
export function assignWheelMouthLetter(state, mouthSelector, requestedLetter) {
  const safe = sanitizeWheelState(state);
  const targetIndex = mouthIndexForSelector(safe.mouths, mouthSelector);
  const letter = normalizeLetter(requestedLetter, "");
  if (targetIndex < 0 || !letter) return safe;

  const mouths = safe.mouths.map((mouth) => ({ ...mouth }));
  mouths[targetIndex].letter = letter;
  return { ...safe, mouths };
}

function circularTurnDistance(first, second) {
  const distance = Math.abs(first - second) % 1;
  return Math.min(distance, 1 - distance);
}

/**
 * Choose the physical spoke nearest to a letter's canonical A-Z wheel angle.
 * Active mouths are preferred so a borrowed letter remains audible.
 */
export function nearestWheelMouthForLetter(
  requestedLetter,
  stateOrMouths = createWheelState(),
) {
  const letter = normalizeLetter(requestedLetter, "");
  if (!letter) return null;
  const safe = sanitizeWheelState(
    Array.isArray(stateOrMouths) ? { mouths: stateOrMouths } : stateOrMouths,
  );
  const active = safe.mouths.filter((mouth) => mouth.active);
  const candidates = active.length ? active : safe.mouths;
  if (!candidates.length) return null;
  const targetTurn = ALPHABET.indexOf(letter) / ALPHABET.length;
  let result = null;
  for (const mouth of candidates) {
    const mouthIndex = safe.mouths.findIndex(({ id }) => id === mouth.id);
    const mouthTurn = mouthIndex / safe.mouths.length;
    const distanceTurns = circularTurnDistance(targetTurn, mouthTurn);
    if (
      !result
      || distanceTurns < result.distanceTurns
      || (distanceTurns === result.distanceTurns && mouthIndex < result.mouthIndex)
    ) {
      result = {
        mouthIndex,
        mouthId: mouth.id,
        mouthLetter: mouth.letter,
        targetAngle: DEFAULT_ROTATION + targetTurn * TAU,
        angularDistance: distanceTurns * TAU,
        distanceTurns,
      };
    }
  }
  return result;
}

/** Resolve a word positionally: every letter occurrence consumes the next mouth. */
export function compileWheelWord(word, stateOrMouths = createWheelState()) {
  let requestedWord = word;
  let source = stateOrMouths;
  if (word && typeof word === "object" && typeof stateOrMouths === "string") {
    requestedWord = stateOrMouths;
    source = word;
  }
  const safe = sanitizeWheelState(Array.isArray(source) ? { mouths: source } : source);
  const normalized = normalizeWheelWord(requestedWord ?? safe.word);
  const plans = speechPlans(normalized);
  let nextMouthIndex = 0;
  const events = [...normalized].map((character, index) => {
    const plan = plans[index];
    if (character === " ") {
      return {
        index,
        type: "space",
        character,
        letter: null,
        mouthIndex: null,
        mouthId: null,
        articulation: "",
        carrierLetter: null,
        articulationSequence: [],
        carrierSequence: [],
        sequenceWeights: [],
        durationScale: 0.38,
        silent: true,
        borrowed: false,
        borrowedFromLetter: null,
        borrowedAngularDistance: 0,
      };
    }
    const mouthIndex = nextMouthIndex;
    nextMouthIndex += 1;
    const mouth = safe.mouths[mouthIndex] ?? null;
    const borrowed = mouth || plan.silent
      ? null
      : nearestWheelMouthForLetter(character, safe);
    return {
      index,
      type: mouth ? "mouth" : "missing",
      character,
      letter: character,
      mouthIndex: mouth ? mouthIndex : borrowed?.mouthIndex ?? null,
      mouthId: mouth?.id ?? borrowed?.mouthId ?? null,
      articulation: plan.articulation,
      carrierLetter: plan.carrierLetter,
      articulationSequence: [...plan.articulationSequence],
      carrierSequence: [...plan.carrierSequence],
      sequenceWeights: [...plan.sequenceWeights],
      durationScale: plan.durationScale,
      silent: plan.silent,
      borrowed: Boolean(borrowed),
      borrowedFromLetter: borrowed?.mouthLetter ?? null,
      borrowedAngularDistance: borrowed?.angularDistance ?? 0,
    };
  });
  return {
    word: normalized,
    events,
    missingLetters: [...new Set(
      events
        .filter(({ type, silent }) => type === "missing" && !silent)
        .map(({ letter }) => letter),
    )],
  };
}

/** Find the next audible assigned or borrowed-mouth event, wrapping once. */
export function nextWheelSoundingEvent(eventsOrCompilation, startIndex = -1) {
  const events = Array.isArray(eventsOrCompilation)
    ? eventsOrCompilation
    : eventsOrCompilation?.events;
  if (!Array.isArray(events) || !events.length) return null;
  const start = Number.isFinite(Number(startIndex)) ? Math.trunc(Number(startIndex)) : -1;
  for (let offset = 1; offset <= events.length; offset += 1) {
    const index = ((start + offset) % events.length + events.length) % events.length;
    const event = events[index];
    if (
      event
      && !event.silent
      && (event.type === "mouth" || event.type === "missing")
    ) return event;
  }
  return null;
}

function mouthsFrom(value) {
  if (Array.isArray(value)) return sanitizeWheelState({ mouths: value }).mouths;
  return sanitizeWheelState(value).mouths;
}

/** Build a responsive radial layout with each mouth displaced by its pull. */
export function wheelMouthLayout(width = 1, height = 1, stateOrMouths = createWheelState(), options = {}) {
  const safeWidth = clamp(width, 1e-6, 1_000_000, 1);
  const safeHeight = clamp(height, 1e-6, 1_000_000, 1);
  const size = Math.min(safeWidth, safeHeight);
  const mouths = mouthsFrom(stateOrMouths);
  const count = mouths.length;
  const source = options && typeof options === "object" ? options : {};
  const centerX = clamp(source.centerX, 0, safeWidth, safeWidth / 2);
  const centerY = clamp(source.centerY, 0, safeHeight, safeHeight / 2);
  const coreRadius = clamp(source.coreRadius, size * 0.035, size * 0.22, size * 0.09);
  const innerRadius = clamp(
    source.innerRadius,
    coreRadius * 1.2,
    size * 0.34,
    size * 0.225,
  );
  const outerRadius = clamp(
    source.outerRadius,
    innerRadius + size * 0.04,
    size * 0.47,
    size * 0.4,
  );
  const radialRadius = clamp(
    source.radialRadius,
    size * 0.045,
    size * 0.18,
    size * (count > 10 ? 0.09 : count > 8 ? 0.105 : 0.125),
  );
  const availableHalfSlot = count <= 2
    ? size * 0.11
    : innerRadius * Math.sin(Math.PI / count) * 0.76;
  const tangentialRadius = clamp(
    source.tangentialRadius,
    size * 0.025,
    Math.max(size * 0.026, availableHalfSlot),
    Math.min(size * 0.083, availableHalfSlot),
  );
  const rotation = finiteNumber(source.rotation, DEFAULT_ROTATION);
  const layoutMouths = mouths.map((mouth, index) => {
    const angle = rotation + index * TAU / count;
    const pull = clamp(mouth.pull);
    const mouthSize = clamp(
      mouth.size,
      WHEEL_MORPH_LIMITS.size.minimum,
      WHEEL_MORPH_LIMITS.size.maximum,
      WHEEL_MORPH_LIMITS.size.default,
    );
    const stretch = clamp(
      mouth.stretch,
      WHEEL_MORPH_LIMITS.stretch.minimum,
      WHEEL_MORPH_LIMITS.stretch.maximum,
      WHEEL_MORPH_LIMITS.stretch.default,
    );
    const stretchRoot = Math.sqrt(stretch);
    const mouthRadialRadius = radialRadius * mouthSize * stretchRoot;
    const mouthTangentialRadius = tangentialRadius * mouthSize / stretchRoot;
    const radius = innerRadius + pull * (outerRadius - innerRadius);
    const radialX = Math.cos(angle);
    const radialY = Math.sin(angle);
    const mouthCenterX = centerX + radialX * radius;
    const mouthCenterY = centerY + radialY * radius;
    return {
      index,
      id: mouth.id,
      letter: mouth.letter,
      pull,
      size: mouthSize,
      stretch,
      tongueOut: mouth.tongueOut,
      angle,
      rotation: angle,
      radius,
      x: mouthCenterX,
      y: mouthCenterY,
      centerX: mouthCenterX,
      centerY: mouthCenterY,
      radialRadius: mouthRadialRadius,
      tangentialRadius: mouthTangentialRadius,
      pan: clamp(radialX, -1, 1),
    };
  });
  return {
    width: safeWidth,
    height: safeHeight,
    centerX,
    centerY,
    coreRadius,
    innerRadius,
    outerRadius,
    radialRadius,
    tangentialRadius,
    rotation,
    count,
    mouths: layoutMouths,
  };
}

function localMouthCoordinates(point, mouth, padding = 0) {
  const x = finiteNumber(point?.x, mouth.centerX);
  const y = finiteNumber(point?.y, mouth.centerY);
  const dx = x - mouth.centerX;
  const dy = y - mouth.centerY;
  const cosine = Math.cos(mouth.angle);
  const sine = Math.sin(mouth.angle);
  const safePadding = Math.max(0, finiteNumber(padding, 0));
  const radial = (dx * cosine + dy * sine) / Math.max(1e-9, mouth.radialRadius + safePadding);
  const tangential = (-dx * sine + dy * cosine)
    / Math.max(1e-9, mouth.tangentialRadius + safePadding);
  return { radial, tangential, distance: Math.hypot(radial, tangential) };
}

/** Return the nearest rotated-ellipse mouth hit, or null outside the wheel. */
export function hitTestWheelMouth(point, layout, padding = 0) {
  const mouths = Array.isArray(layout) ? layout : layout?.mouths;
  if (!Array.isArray(mouths)) return null;
  let winner = null;
  let bestDistance = Infinity;
  for (const mouth of mouths) {
    if (!mouth || !Number.isInteger(mouth.index)) continue;
    const local = localMouthCoordinates(point, mouth, padding);
    if (local.distance <= 1 && local.distance < bestDistance) {
      winner = mouth.index;
      bestDistance = local.distance;
    }
  }
  return winner;
}

function layoutMouthForSelector(layout, selector) {
  const mouths = layout?.mouths;
  if (!Array.isArray(mouths)) return null;
  if (Number.isInteger(Number(selector))) {
    return mouths.find(({ index }) => index === Number(selector)) ?? null;
  }
  if (typeof selector === "string") return mouths.find(({ id }) => id === selector) ?? null;
  if (selector && typeof selector === "object") {
    return layoutMouthForSelector(layout, selector.id ?? selector.index);
  }
  return null;
}

/** Map a captured free drag to radial pull and lateral tongue position. */
export function mapWheelPullGesture(point, layout, mouthSelector) {
  const mouth = layoutMouthForSelector(layout, mouthSelector);
  if (!mouth) return null;
  const x = finiteNumber(point?.x, mouth.centerX);
  const y = finiteNumber(point?.y, mouth.centerY);
  const dx = x - layout.centerX;
  const dy = y - layout.centerY;
  const cosine = Math.cos(mouth.angle);
  const sine = Math.sin(mouth.angle);
  const projectedRadius = dx * cosine + dy * sine;
  const lateralDistance = -dx * sine + dy * cosine;
  const radiusSpan = Math.max(1e-9, layout.outerRadius - layout.innerRadius);
  const pull = clamp((projectedRadius - layout.innerRadius) / radiusSpan);
  const tangential = clamp(
    lateralDistance / Math.max(1, mouth.tangentialRadius * 2),
    -1,
    1,
    0,
  );
  const tongue = clamp((tangential + 1) / 2);
  return {
    mouthIndex: mouth.index,
    mouthId: mouth.id,
    pull,
    tongue,
    distance: Math.hypot(dx, dy),
    tangential,
    projectedRadius,
    lateralDistance,
    pitchSemitones: pull * PULL_PITCH_SEMITONES,
    formantScale: 2 ** ((pull * PULL_FORMANT_SEMITONES) / 12),
  };
}

/**
 * Map one or two canvas-local pointers into the complete mouth morph gesture.
 * One pointer retains the supplied pinch and uses pointer pressure for push;
 * two pointers additionally derive pinch from their span across the mouth.
 */
export function mapWheelMorphGesture(
  pointers,
  layout,
  mouthSelector,
  current = {},
) {
  const mouth = layoutMouthForSelector(layout, mouthSelector);
  if (!mouth) return null;
  let requested;
  if (Array.isArray(pointers)) requested = pointers;
  else if (pointers && typeof pointers === "object" && Symbol.iterator in pointers) {
    requested = Array.from(pointers);
  } else requested = pointers ? [pointers] : [];
  const points = requested.filter((point) => point && typeof point === "object").slice(0, 2);
  if (!points.length) return null;

  const centroid = points.reduce(
    (sum, point) => ({
      x: sum.x + finiteNumber(point.x, mouth.centerX),
      y: sum.y + finiteNumber(point.y, mouth.centerY),
    }),
    { x: 0, y: 0 },
  );
  centroid.x /= points.length;
  centroid.y /= points.length;
  const primary = mapWheelPullGesture(centroid, layout, mouthSelector);
  if (!primary) return null;

  const span = points.length > 1
    ? Math.hypot(
      finiteNumber(points[1].x, centroid.x) - finiteNumber(points[0].x, centroid.x),
      finiteNumber(points[1].y, centroid.y) - finiteNumber(points[0].y, centroid.y),
    )
    : 0;
  const spanNormalized = points.length > 1
    ? clamp(span / Math.max(1, mouth.tangentialRadius * 2), 0, 1, 0)
    : 0;
  const pinch = points.length > 1
    ? 1 - spanNormalized
    : clamp(current?.pinch, 0, 1, 0);
  const pressures = points
    .map((point) => Number(point.pressure))
    .filter((pressure) => Number.isFinite(pressure) && pressure >= 0);
  const local = localMouthCoordinates(centroid, mouth);
  const push = pressures.length
    ? clamp(pressures.reduce((sum, pressure) => sum + pressure, 0) / pressures.length)
    : Number.isFinite(Number(current?.push))
      ? clamp(current.push)
      : clamp(1 - local.distance / 1.15);

  return {
    ...primary,
    pointerCount: points.length,
    centroid,
    span,
    spanNormalized,
    pinch,
    push,
  };
}

export const mapWheelMultiPointerGesture = mapWheelMorphGesture;

function midiToFrequency(midi) {
  return 440 * (2 ** ((midi - 69) / 12));
}

function carrierFormants(letter, globals) {
  if (Array.isArray(globals.carrierFormants) && globals.carrierFormants.length >= 3) {
    return globals.carrierFormants.slice(0, 3).map((value, index) => clamp(
      value,
      120,
      8_000,
      CARRIER_FORMANTS.AX[index],
    ));
  }
  const requestedCarrier = String(globals.carrierLetter ?? "").trim().toUpperCase();
  const carrier = CARRIER_FORMANTS[requestedCarrier]
    ? requestedCarrier
    : LETTER_CARRIERS[letter] ?? "AX";
  return [...CARRIER_FORMANTS[carrier]];
}

function safePhase(value) {
  const phase = String(value ?? "hold").toLowerCase();
  return ["attack", "hold", "release"].includes(phase) ? phase : "hold";
}

function wheelConsonantVoiceParameters(value, phase, sampleRate) {
  const dental = WHEEL_DENTAL_ARTICULATIONS[value];
  if (!dental) return consonantVoiceParameters(value, phase, sampleRate);
  const eventPhase = safePhase(phase);
  const sustaining = eventPhase !== "release";
  const sustainScale = eventPhase === "attack" ? 0.72 : sustaining ? 1 : 0;
  const safeSampleRate = clamp(sampleRate, 8_000, 384_000, 48_000);
  const frequency = (requested) => clamp(requested, 80, safeSampleRate * 0.45, 1_000);
  return {
    id: dental.id,
    symbol: dental.symbol,
    name: dental.name,
    manner: dental.manner,
    place: dental.place,
    articulator: dental.articulator,
    phase: eventPhase,
    voiced: dental.voiced,
    constrictionPosition: dental.constrictionPosition,
    oralClosure: sustaining ? dental.oralClosure : 0,
    glottalClosure: 0,
    voicingGain: dental.voiced ? sustainScale : 0,
    fricationFrequency: frequency(dental.frication.frequency),
    fricationQ: dental.frication.q,
    fricationGain: dental.frication.gain * sustainScale,
    burstFrequency: frequency(dental.burst.frequency),
    burstQ: dental.burst.q,
    burstGain: 0,
    burstHalfLife: dental.burst.halfLife,
    burstDuration: dental.burst.duration,
    nasalPoleFrequency: frequency(dental.nasal.poleFrequency),
    nasalNotchFrequency: frequency(dental.nasal.notchFrequency),
    nasalQ: dental.nasal.q,
    nasalCoupling: 0,
    nasalGain: 0,
  };
}

/**
 * Convert one mouth into a bounded vocal target. A pull from 0 to 1 contributes
 * +18 semitones to F0 and -5 semitones to the complete formant envelope.
 */
export function wheelVocalParameters(mouth = defaultMouth(0), globals = {}) {
  const source = mouth && typeof mouth === "object" ? mouth : {};
  const safeMouth = sanitizeMouth(
    source,
    defaultMouth(0),
    0,
    new Set(),
  );
  const safeGlobals = globals && typeof globals === "object" ? globals : {};
  const rootMidi = clamp(safeGlobals.rootMidi, 24, 84, DEFAULT_ROOT_MIDI);
  const phase = safePhase(safeGlobals.phase);
  const sampleRate = clamp(safeGlobals.sampleRate, 8_000, 384_000, 48_000);
  const nyquistLimit = Math.min(8_000, sampleRate * 0.45);
  const filterCeiling = Math.min(18_000, sampleRate * 0.45);
  const requestedArticulation = String(
    safeGlobals.articulation ?? safeMouth.letter,
  ).trim().toLowerCase();
  const articulation = WHEEL_DENTAL_ARTICULATIONS[requestedArticulation]
    ? requestedArticulation
    : articulationKey(requestedArticulation);
  const articulationData = WHEEL_DENTAL_ARTICULATIONS[articulation]
    ?? ARTICULATIONS[articulation];
  const consonant = WHEEL_DENTAL_ARTICULATIONS[articulation]
    ?? CONSONANTS[articulation];
  const consonantParameters = wheelConsonantVoiceParameters(
    articulation,
    phase,
    sampleRate,
  );
  const manner = articulationData?.kind === "vowel"
    ? "vowel"
    : consonantParameters?.manner ?? "vowel";
  const voiced = manner === "vowel" || Boolean(consonantParameters?.voiced);

  const pitchSemitones = safeMouth.pull * PULL_PITCH_SEMITONES;
  const tensionSemitones = (safeMouth.glottalTension - 0.5) * 10;
  const pressureSemitones = (safeMouth.push - 0.5) * 4 + safeMouth.screech * 5;
  const sizeOctaves = Math.log2(safeMouth.size);
  const stretchOctaves = Math.log2(safeMouth.stretch);
  const anatomySemitones = -5 * sizeOctaves
    - 4 * stretchOctaves
    + (safeMouth.tongueOut - WHEEL_MORPH_LIMITS.tongueOut.default) * 3;
  const frequency = clamp(
    midiToFrequency(
      rootMidi
        + safeMouth.interval
        + pitchSemitones
        + tensionSemitones
        + pressureSemitones
        + anatomySemitones,
    ),
    40,
    1_400,
    130.8128,
  );
  const formantScale = clamp(
    2 ** ((safeMouth.pull * PULL_FORMANT_SEMITONES) / 12)
      * clamp(safeGlobals.formantScale, 0.5, 2, 1)
      * safeMouth.size ** -0.28
      * safeMouth.stretch ** -0.3,
    0.32,
    2.4,
    1,
  );
  const baseFormants = carrierFormants(safeMouth.letter, safeGlobals);
  const tongueOffset = safeMouth.tongue - 0.5;
  const apertureOffset = safeMouth.aperture - 0.5;
  const effectiveAperture = clamp(safeMouth.aperture * (1 - safeMouth.pinch * 0.82));
  const formantModifiers = [
    1 + apertureOffset * 0.5 - tongueOffset * 0.2 - safeMouth.pinch * 0.42
      - safeMouth.tongueOut * 0.16,
    1 + tongueOffset * 0.65 + apertureOffset * 0.09
      + safeMouth.pinch * (0.16 + tongueOffset * 0.2)
      + safeMouth.tongueOut * 0.32,
    1 + tongueOffset * 0.16 + apertureOffset * 0.08
      + safeMouth.pinch * 0.08
      + safeMouth.screech * 0.38
      + safeMouth.tongueOut * 0.28,
  ];
  const formants = baseFormants.map((base, index) => clamp(
    base * formantModifiers[index] * formantScale,
    120,
    nyquistLimit,
    CARRIER_FORMANTS.AX[index],
  ));
  const bandwidths = [70, 105, 155].map((base, index) => clamp(
    base * (0.58 + safeMouth.breath * 1.9 + (1 - safeMouth.glottalTension) * 0.38)
      * (0.72 + safeMouth.push * 0.55)
      * (1 + safeMouth.pinch * (index === 0 ? -0.18 : 0.18))
      * (1 + safeMouth.screech * (0.12 + index * 0.25))
      * (1 + Math.abs(sizeOctaves) * 0.16 + Math.abs(stretchOctaves) * 0.18)
      * (1 + safeMouth.tongueOut * (0.14 + index * 0.09))
      * (1 + index * safeMouth.aperture * 0.12),
    35,
    900,
    base,
  ));
  const formantGains = [1, 0.74, 0.48].map((base, index) => clamp(
    base * (0.28 + effectiveAperture * 0.72)
      * (0.58 + safeMouth.push * (0.42 + index * 0.05))
      * (1 + safeMouth.screech * index * 0.3)
      * (1 - Math.min(0.28, Math.abs(stretchOctaves) * 0.11))
      * (1 - index * safeMouth.breath * 0.16),
    0,
    1,
    base,
  ));

  const fricationGain = consonantParameters?.fricationGain ?? 0;
  const aspirationGain = clamp(
    safeMouth.breath * (
      (voiced ? 0.34 : 0.5)
      + safeMouth.push * 0.48
      + (1 - safeMouth.glottalTension) * 0.28
    )
      + safeMouth.screech * 0.06
      + safeMouth.tongueOut * 0.04,
  );
  const constrictionTurbulence = safeMouth.pinch
    * ((manner === "vowel" ? 0.12 : 0.2) + safeMouth.push * 0.22);
  const screechTurbulence = safeMouth.screech
    * (manner === "vowel" ? 0.38 : 0.52);
  const anatomyTurbulence = Math.abs(sizeOctaves) * 0.035
    + Math.abs(stretchOctaves) * 0.045
    + safeMouth.tongueOut * (manner === "vowel" ? 0.16 : 0.24);
  const noiseGain = clamp(
    Math.max(fricationGain, aspirationGain)
      + constrictionTurbulence
      + screechTurbulence
      + anatomyTurbulence,
  );
  const noiseFrequency = clamp(
    (consonantParameters?.fricationFrequency
      ?? (2_600 + safeMouth.tongue * 3_200))
      * (1 + safeMouth.screech * 0.8)
      * safeMouth.size ** -0.12
      * safeMouth.stretch ** -0.1
      * (1 + safeMouth.tongueOut * 0.42),
    120,
    nyquistLimit,
    (2_600 + safeMouth.tongue * 3_200) * (1 + safeMouth.screech * 0.22),
  );
  const noiseQ = clamp(
    (consonantParameters?.fricationQ ?? 1.2)
      * (0.72 + safeMouth.pinch * 2.2 + safeMouth.screech * 0.8),
    0.2,
    30,
    1.2,
  );
  const burstGain = clamp(consonantParameters?.burstGain, 0, 1, 0);
  const burstFrequency = clamp(
    consonantParameters?.burstFrequency,
    120,
    nyquistLimit,
    2_200,
  );
  const burstQ = clamp(consonantParameters?.burstQ, 0.2, 30, 1.2);
  const burstHalfLife = clamp(consonantParameters?.burstHalfLife, 0.001, 0.2, 0.012);
  const burstDuration = clamp(consonantParameters?.burstDuration, 0.005, 0.5, 0.05);
  const nasalWetness = clamp(safeMouth.nasality ** 0.65);
  const nasalGain = clamp(Math.max(
    consonantParameters?.nasalGain ?? 0,
    nasalWetness * (manner === "nasal" ? 0.98 : 0.78),
  ));
  const nasalCoupling = clamp(Math.max(
    consonantParameters?.nasalCoupling ?? 0,
    nasalWetness * (manner === "nasal" ? 1 : 0.9),
  ));
  const nasalPoleFrequency = clamp(
    (consonantParameters?.nasalPoleFrequency ?? 280)
      * (1 - nasalWetness * 0.28)
      * safeMouth.size ** -0.06,
    80,
    nyquistLimit,
    280,
  );
  const nasalNotchFrequency = clamp(
    (consonantParameters?.nasalNotchFrequency ?? 1_100)
      * (1 + nasalWetness * 0.44 + safeMouth.tongueOut * 0.14),
    80,
    nyquistLimit,
    1_100,
  );
  const nasalQ = clamp(
    (consonantParameters?.nasalQ ?? 2) * (0.82 + nasalWetness * 1.1),
    0.2,
    30,
    2,
  );
  const active = safeMouth.active;
  const gain = active
    ? clamp(safeGlobals.gain, 0, 1, 1)
      * (0.22 + effectiveAperture * 0.78)
      * (0.35 + safeMouth.push * 0.65)
      * (1 - safeMouth.breath * 0.18)
    : 0;
  const voicing = active && voiced
    ? clamp(
      (0.3 + safeMouth.glottalTension * 0.7)
        * (1 - safeMouth.breath * 0.52)
        * (0.7 + safeMouth.push * 0.3)
        * (1 - safeMouth.screech * 0.16),
    )
    : 0;
  const baseOralClosure = clamp(consonantParameters?.oralClosure, 0, 1, 0);
  const oralClosure = clamp(
    1 - (1 - baseOralClosure) * (1 - safeMouth.pinch * 0.94),
  );
  const expressiveGlottalClosure = phase === "release"
    ? 0
    : clamp(
      safeMouth.glottalTension * 0.72
        + safeMouth.push * 0.18
        - safeMouth.breath * 0.34,
    );
  const glottalClosure = clamp(Math.max(
    consonantParameters?.glottalClosure ?? 0,
    expressiveGlottalClosure,
  ));
  const baseConstrictionPosition = clamp(
    consonantParameters?.constrictionPosition,
    0,
    1,
    safeMouth.tongue,
  );
  const constrictionPosition = clamp(
    baseConstrictionPosition * (0.72 - safeMouth.pinch * 0.24)
      + safeMouth.tongue * (0.2 + safeMouth.pinch * 0.2)
      + safeMouth.tongueOut * 0.12,
  );
  const pan = clamp(safeGlobals.pan, -1, 1, 0);
  const pressure = clamp(safeMouth.push ** 0.72);
  const roughness = clamp(
    aspirationGain * 0.25
      + safeMouth.pinch * 0.24
      + safeMouth.push * 0.12
      + safeMouth.screech * 0.46
      + Math.abs(stretchOctaves) * 0.08,
  );
  const resonance = clamp(
    0.12
      + safeMouth.pinch * 0.46
      + (1 - safeMouth.breath) * 0.16
      + nasalWetness * 0.2
      + Math.abs(stretchOctaves) * 0.1,
  );
  const timbreDrive = clamp(
    0.06
      + safeMouth.push * 0.48
      + safeMouth.pinch * 0.28
      + safeMouth.screech * 0.48
      + Math.abs(stretchOctaves) * 0.1
      + safeMouth.tongueOut * 0.14
      + clamp(safeGlobals.growl) * 0.2,
  );
  const brightness = clamp(
    0.12
      + safeMouth.tongue * 0.4
      + safeMouth.push * 0.18
      + safeMouth.screech * 0.48
      - sizeOctaves * 0.1
      - stretchOctaves * 0.08
      + safeMouth.tongueOut * 0.24
      - safeMouth.pinch * 0.22
      + safeMouth.aperture * 0.1,
  );
  const highpassFrequency = clamp(
    28
      + (1 - safeMouth.aperture) * 250
      + safeMouth.pinch * 620
      + safeMouth.tongueOut * 150
      + safeMouth.screech * 260,
    20,
    Math.min(1_800, filterCeiling),
    70,
  );
  const lowpassFrequency = clamp(
    1_600
      + safeMouth.aperture * 8_800
      + brightness * 3_400
      + safeMouth.screech * 3_800
      - safeMouth.pinch * 3_600
      - safeMouth.breath * 1_500,
    Math.max(800, highpassFrequency + 120),
    filterCeiling,
    Math.min(8_000, filterCeiling),
  );
  const spectralTilt = clamp(
    0.72
      + safeMouth.breath * 0.26
      + safeMouth.pinch * 0.14
      - safeMouth.glottalTension * 0.34
      - safeMouth.screech * 0.32,
  );
  const totalPitchSemitones = pitchSemitones
    + tensionSemitones
    + pressureSemitones
    + anatomySemitones;

  return {
    id: safeMouth.id,
    letter: safeMouth.letter,
    articulation,
    phase,
    manner,
    voiced,
    active,
    pull: safeMouth.pull,
    tongue: safeMouth.tongue,
    tongueOut: safeMouth.tongueOut,
    tongueExtension: safeMouth.tongueOut,
    aperture: safeMouth.aperture,
    glottalTension: safeMouth.glottalTension,
    tenseness: safeMouth.glottalTension,
    breath: safeMouth.breath,
    pinch: safeMouth.pinch,
    push: safeMouth.push,
    nasality: safeMouth.nasality,
    screech: safeMouth.screech,
    edge: safeMouth.screech,
    size: safeMouth.size,
    stretch: safeMouth.stretch,
    pressure,
    airPressure: pressure,
    aspiration: aspirationGain,
    aspirationGain,
    roughness,
    resonance,
    spectralTilt,
    effectiveAperture,
    frequency,
    f0: frequency,
    fundamentalHz: frequency,
    pitchSemitones,
    tensionSemitones,
    pressureSemitones,
    anatomySemitones,
    totalPitchSemitones,
    formantScale,
    formants,
    bandwidths,
    formantGains,
    gain,
    pan,
    voicing,
    oralClosure,
    constriction: oralClosure,
    glottalClosure,
    constrictionPosition,
    highpass: highpassFrequency,
    highpassFrequency,
    lowpass: lowpassFrequency,
    lowpassFrequency,
    noise: {
      gain: noiseGain,
      frequency: noiseFrequency,
      q: noiseQ,
      aspiration: aspirationGain,
      roughness,
    },
    noiseGain,
    noiseFrequency,
    noiseQ,
    burst: {
      gain: burstGain,
      frequency: burstFrequency,
      q: burstQ,
      halfLife: burstHalfLife,
      duration: burstDuration,
    },
    burstGain,
    burstFrequency,
    burstQ,
    burstHalfLife,
    burstDuration,
    nasal: {
      gain: nasalGain,
      coupling: nasalCoupling,
      poleFrequency: nasalPoleFrequency,
      notchFrequency: nasalNotchFrequency,
      q: nasalQ,
      wetness: nasalWetness,
    },
    nasalWetness,
    nasalGain,
    nasalCoupling,
    nasalPoleFrequency,
    nasalNotchFrequency,
    nasalQ,
    timbreDrive,
    throatDrive: timbreDrive,
    brightness,
    timbre: {
      drive: timbreDrive,
      brightness,
      constriction: oralClosure,
      pressure,
      aspiration: aspirationGain,
      roughness,
      resonance,
      nasalWetness,
      spectralTilt,
    },
  };
}
