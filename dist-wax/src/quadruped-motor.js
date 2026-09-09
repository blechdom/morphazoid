import {
  QUADRUPED_FOOT_LANES,
  QUADRUPED_STEP_COUNT,
  quadrupedAnimal,
  quadrupedSequenceEvent,
  quadrupedSupportSnapshot,
  quadrupedTerrain,
  quadrupedScoreTiming,
  quadrupedClockAtPosition,
  quadrupedPositionAtClock,
  quadrupedFlightTrajectory,
  quadrupedBodySlide,
} from "./quadruped.js";

const FOOT_LANE_IDS = Object.freeze(QUADRUPED_FOOT_LANES.map(({ id }) => id));

const FLIGHT_BY_BEHAVIOR = Object.freeze({
  walk: 0,
  "diagonal-walk": 0,
  "running-walk": 0.04,
  amble: 0,
  tolt: 0.04,
  jog: 0.03,
  charge: 0.08,
  trot: 0.34,
  passage: 0.52,
  pace: 0.24,
  "flying-pace": 0.48,
  canter: 0.52,
  "counter-canter": 0.52,
  gallop: 0.76,
  "counter-gallop": 0.76,
  sprint: 0.94,
  "rotary-left": 0.94,
  bound: 0.72,
  "half-bound": 0.78,
  "counter-half-bound": 0.78,
  stot: 1,
  jump: 1,
  leap: 1,
  skid: 0,
  "forward-roll": 1,
  "rear-up": 0.04,
  dance: 0.26,
  "rear-waltz": 0.18,
  carousel: 0,
  "cat-prowl": 0,
  "cat-gallop": 0.68,
  "run-leap": 1,
  "rabbit-gallop": 0.82,
  "giraffe-walk": 0,
  "giraffe-gallop": 0.04,
  "lizard-scuttle": 0,
  "lizard-trot": 0.05,
  "lizard-pace": 0,
  "lizard-sprint": 0.18,
});

export const QUADRUPED_MOTOR_LIMITS = Object.freeze({
  integrationStepSeconds: 1 / 480,
  maxAdvanceSeconds: 2,
  maxCrossingEvents: 384,
  maxTransitionEvents: 192,
  maxVelocity: 192,
  maxHeight: 2,
  maxPosition: 1_000_000_000,
});

const EPSILON = 1e-9;
const STALL_VELOCITY = 0.012;

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function contactAt(score, laneId, step) {
  const value = score?.pattern?.[laneId]?.[mod(step, QUADRUPED_STEP_COUNT)];
  return clamp(value, 0, 1, 0);
}

function scoreView(score) {
  const animal = quadrupedAnimal(score?.animalId);
  const terrain = quadrupedTerrain(score?.surfaceId);
  const animalId = animal.id;
  const tempoBpm = clamp(score?.tempoBpm, 24, 240, 72);
  return {
    animalId,
    behaviorId: typeof score?.behaviorId === "string" ? score.behaviorId : "walk",
    cadenceFramesPerSecond: tempoBpm * QUADRUPED_STEP_COUNT / 60,
    stride: clamp(score?.stride, 0.4, 1.6, 0.9),
    momentum: clamp(score?.momentum, 0.5, 1.4, 0.82),
    gravity: clamp(score?.gravity, 0.55, 1.55, 1),
    physics: Object.freeze({
      mass: clamp(animal.mass, 0.3, 2, 1),
      power: clamp(animal.power, 0.4, 1.8, 1),
      compliance: clamp(animal.compliance, 0.4, 1.6, 1),
      rolling: clamp(animal.rollingResistance, 0.4, 2, 1),
      gravity: clamp(animal.baseGravity, 7, 13, 9.8),
      traction: clamp(terrain.traction, 0.2, 1.4, 1),
      surfaceRolling: clamp(terrain.rollingResistance, 0.4, 2.2, 1),
      hardness: clamp(terrain.hardness, 0, 1, 0.5),
      damping: clamp(terrain.damping, 0, 1, 0.5),
    }),
  };
}

function footSupport(score, position) {
  return quadrupedSupportSnapshot(score, position);
}

function footEnergyAtFrame(score, frame) {
  return FOOT_LANE_IDS.reduce((sum, laneId) => sum + contactAt(score, laneId, frame), 0);
}

function scoredFootEnergy(score) {
  return FOOT_LANE_IDS.reduce((total, laneId) => (
    total + Array.from({ length: QUADRUPED_STEP_COUNT }, (_, frame) => contactAt(score, laneId, frame))
      .reduce((sum, intensity) => sum + intensity, 0)
  ), 0);
}

function targetVelocity(view) {
  return clamp(view.cadenceFramesPerSecond, 0, QUADRUPED_MOTOR_LIMITS.maxVelocity, 0);
}

function framesUntilSupport(score, position) {
  for (let offset = 0.0625; offset <= QUADRUPED_STEP_COUNT; offset += 0.0625) {
    if (footSupport(score, position + offset).supportCount > 0) return offset;
  }
  return 0;
}

function clockFraction(score, at, start, end) {
  const span = quadrupedClockAtPosition(score, end) - quadrupedClockAtPosition(score, start);
  return span > EPSILON ? clamp((quadrupedClockAtPosition(score, at) - quadrupedClockAtPosition(score, start)) / span, 0, 1, 1) : 1;
}

function supportBoundaryPosition(score, startPosition, endPosition, supportedAtEnd) {
  let low = startPosition;
  let high = endPosition;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const middle = (low + high) * 0.5;
    const supported = footSupport(score, middle).supportCount > 0;
    if (supported === supportedAtEnd) high = middle;
    else low = middle;
  }
  return high;
}

function immutableMotor(value) {
  return Object.freeze({
    version: 1,
    position: value.position,
    velocity: value.velocity,
    height: value.height,
    verticalVelocity: value.verticalVelocity,
    compression: value.compression,
    landing: value.landing,
    supportCount: value.supportCount,
    supportEnergy: value.supportEnergy,
    propulsion: value.propulsion,
    airborne: value.airborne,
    landingCount: value.landingCount,
    flightId: value.flightId,
    flightSerial: value.flightSerial,
    elapsedSeconds: value.elapsedSeconds,
    simulatedSeconds: value.simulatedSeconds,
    remainderSeconds: value.remainderSeconds,
    stalled: value.stalled,
  });
}

function sanitizeMotor(score, motor) {
  const position = clamp(motor?.position, 0, QUADRUPED_MOTOR_LIMITS.maxPosition, 0);
  const velocity = clamp(motor?.velocity, 0, QUADRUPED_MOTOR_LIMITS.maxVelocity, 0);
  const support = footSupport(score, position);
  // Contact belongs to the score at this exact position, never to a stale
  // snapshot carried through a gait, pattern, or terrain edit.
  const supportCount = support.supportCount;
  const supportEnergy = support.supportEnergy;
  const propulsion = support.propulsion;
  const grounded = supportCount > 0;
  const height = grounded ? 0 : clamp(motor?.height, 0, QUADRUPED_MOTOR_LIMITS.maxHeight, 0);
  const remainderSeconds = clamp(
    motor?.remainderSeconds,
    0,
    QUADRUPED_MOTOR_LIMITS.integrationStepSeconds - EPSILON,
    0,
  );
  const airborne = !grounded && Boolean(motor?.airborne);
  const flightSerial = Math.floor(clamp(motor?.flightSerial, 0, Number.MAX_SAFE_INTEGER, 0));
  return {
    position,
    velocity,
    height,
    verticalVelocity: grounded ? 0 : clamp(motor?.verticalVelocity, -12, 12, 0),
    compression: clamp(motor?.compression, 0, 1, 0),
    landing: clamp(motor?.landing, 0, 1, 0),
    supportCount,
    supportEnergy,
    propulsion,
    airborne,
    landingCount: Math.floor(clamp(motor?.landingCount, 0, Number.MAX_SAFE_INTEGER, 0)),
    flightId: airborne && typeof motor?.flightId === "string" ? motor.flightId : null,
    flightSerial,
    elapsedSeconds: clamp(motor?.elapsedSeconds, 0, QUADRUPED_MOTOR_LIMITS.maxPosition, 0),
    simulatedSeconds: clamp(motor?.simulatedSeconds, 0, QUADRUPED_MOTOR_LIMITS.maxPosition, 0),
    remainderSeconds,
    stalled: velocity === 0 && propulsion === 0,
  };
}

export function createQuadrupedMotorState(score, options = {}) {
  const position = clamp(options?.position, 0, QUADRUPED_MOTOR_LIMITS.maxPosition, 0);
  const support = footSupport(score, position);
  return immutableMotor(sanitizeMotor(score, {
    ...options,
    position,
    supportCount: support.supportCount,
    supportEnergy: support.supportEnergy,
    propulsion: support.propulsion,
    elapsedSeconds: options?.elapsedSeconds ?? 0,
    simulatedSeconds: options?.simulatedSeconds ?? 0,
    remainderSeconds: options?.remainderSeconds ?? 0,
  }));
}

function immutableEvent(event) {
  return Object.freeze(event);
}

function simulate(score, motor, deltaSeconds) {
  const view = scoreView(score);
  let current = sanitizeMotor(score, motor);
  const requestedDelta = Number(deltaSeconds);
  const advancedSeconds = Number.isFinite(requestedDelta)
    ? clamp(requestedDelta, 0, QUADRUPED_MOTOR_LIMITS.maxAdvanceSeconds, 0)
    : 0;
  const callStartSeconds = current.elapsedSeconds;
  const integrationStep = QUADRUPED_MOTOR_LIMITS.integrationStepSeconds;
  const availableSeconds = current.remainderSeconds + advancedSeconds;
  const tickCount = Math.min(
    Math.floor((availableSeconds + EPSILON) / integrationStep),
    Math.ceil(QUADRUPED_MOTOR_LIMITS.maxAdvanceSeconds / integrationStep) + 1,
  );
  const remainderSeconds = Math.max(0, availableSeconds - tickCount * integrationStep);
  const events = [];
  const transitions = [];
  const hasScoredFootfalls = scoredFootEnergy(score) > EPSILON;
  let droppedEvents = 0;
  let droppedTransitions = 0;

  const emitTransition = (transition) => {
    if (transitions.length < QUADRUPED_MOTOR_LIMITS.maxTransitionEvents) {
      transitions.push(immutableEvent(transition));
    } else {
      droppedTransitions += 1;
    }
  };

  for (let tick = 0; tick < tickCount; tick += 1) {
    const tickStartSeconds = current.simulatedSeconds;
    const previousPosition = current.position;
    const previousVelocity = current.velocity;
    const supportStart = footSupport(score, previousPosition);
    const desiredVelocity = targetVelocity(view);
    let velocity;
    let position;
    if (hasScoredFootfalls) {
      // BPM is the independent master clock: one sixteen-frame gait cycle is
      // one beat. Contact timing shapes support, flight, and sound, but animal
      // mass, terrain, and slope never bend the requested sequence rate.
      const clock = quadrupedClockAtPosition(score, previousPosition);
      position = clamp(
        quadrupedPositionAtClock(score, clock + desiredVelocity * integrationStep),
        0,
        QUADRUPED_MOTOR_LIMITS.maxPosition,
        previousPosition,
      );
      velocity = desiredVelocity / quadrupedScoreTiming(score).durations[mod(Math.floor(position), 16)];
    } else {
      // A score with no touchdown marks receives no new drive. Existing motion
      // can coast according to momentum and terrain, then reaches an exact stop.
      const groundResistance = view.physics.rolling * view.physics.surfaceRolling * 2.1
        / (view.momentum * view.momentum);
      const airResistance = 0.0025 * previousVelocity * previousVelocity;
      const acceleration = -groundResistance - airResistance;
      velocity = clamp(
        previousVelocity + acceleration * integrationStep,
        0,
        QUADRUPED_MOTOR_LIMITS.maxVelocity,
        0,
      );
      if (velocity < STALL_VELOCITY) velocity = 0;
      position = clamp(
        previousPosition + (previousVelocity + velocity) * 0.5 * integrationStep,
        0,
        QUADRUPED_MOTOR_LIMITS.maxPosition,
        previousPosition,
      );
    }
    if (position >= QUADRUPED_MOTOR_LIMITS.maxPosition - EPSILON) velocity = 0;
    const supportEnd = footSupport(score, position);

    let height = current.height;
    let verticalVelocity = current.verticalVelocity;
    let compression = current.compression * Math.exp(-(5 + view.physics.damping * 6) * integrationStep);
    let landing = Math.max(0, current.landing - integrationStep * 5.5);
    let airborne = current.airborne;
    let landingCount = current.landingCount;
    let flightId = current.flightId;
    let flightSerial = current.flightSerial;
    let landedThisTick = false;
    const transitionOffset = clamp(
      tickStartSeconds + integrationStep - callStartSeconds,
      0,
      advancedSeconds,
      0,
    );

    for (const laneId of FOOT_LANE_IDS) {
      const startLeg = supportStart.legs[laneId];
      const endLeg = supportEnd.legs[laneId];
      if (!startLeg?.grounded || endLeg?.grounded || !startLeg.eventId) continue;
      const toeOffPosition = startLeg.previousTouchdownPosition + startLeg.stanceDuration;
      if (toeOffPosition <= previousPosition + EPSILON || toeOffPosition > position + EPSILON) continue;
      const travel = position - previousPosition;
      const fraction = clockFraction(score, toeOffPosition, previousPosition, position);
      emitTransition({
        type: "toe-off",
        laneId,
        eventId: `${startLeg.eventId}:toe-off`,
        touchdownId: startLeg.eventId,
        intensity: startLeg.intensity,
        position: toeOffPosition,
        offsetSeconds: clamp(tickStartSeconds + fraction * integrationStep - callStartSeconds, 0, advancedSeconds, 0),
        velocity: previousVelocity + (velocity - previousVelocity) * fraction,
      });
    }

    for (const laneId of FOOT_LANE_IDS) {
      const startLeg = supportStart.legs[laneId];
      const endLeg = supportEnd.legs[laneId];
      if (!startLeg?.grounded || !endLeg?.grounded || !startLeg.eventId || startLeg.eventId !== endLeg.eventId) continue;
      for (const [type, stancePoint] of [["load", 0.28], ["push", 0.72]]) {
        const accentPosition = startLeg.previousTouchdownPosition + startLeg.stanceDuration * stancePoint;
        if (accentPosition <= previousPosition + EPSILON || accentPosition > position + EPSILON) continue;
        const travel = position - previousPosition;
        const fraction = clockFraction(score, accentPosition, previousPosition, position);
        emitTransition({
          type,
          laneId,
          eventId: `${startLeg.eventId}:${type}`,
          touchdownId: startLeg.eventId,
          intensity: startLeg.intensity * (type === "load" ? 0.62 : 0.74),
          stanceProgress: stancePoint,
          position: accentPosition,
          offsetSeconds: clamp(tickStartSeconds + fraction * integrationStep - callStartSeconds, 0, advancedSeconds, 0),
          velocity: previousVelocity + (velocity - previousVelocity) * fraction,
        });
      }
    }

    if (current.supportCount > 0 && supportEnd.supportCount === 0 && velocity > STALL_VELOCITY && view.behaviorId !== "skid") {
      const liftPosition = supportBoundaryPosition(score, previousPosition, position, false);
      const travel = position - previousPosition;
      const liftFraction = clockFraction(score, liftPosition, previousPosition, position);
      const flightFrames = framesUntilSupport(score, liftPosition);
      const flightSeconds = (quadrupedClockAtPosition(score, liftPosition + flightFrames) - quadrupedClockAtPosition(score, liftPosition)) / desiredVelocity;
      const behaviorFlight = clamp(FLIGHT_BY_BEHAVIOR[view.behaviorId] ?? (view.behaviorId === "walk-leap" ? 1 : 0), 0, 1, 0);
      const launchScale = clamp(Math.sqrt(view.physics.power / view.physics.mass), 0.72, 1.32, 1);
      const ballisticLaunch = clamp(
        view.physics.gravity * flightSeconds * 0.5 * (0.72 + behaviorFlight * 0.28) * launchScale,
        0,
        4.8,
        0,
      );
      if (ballisticLaunch > 0.04) {
        verticalVelocity = Math.max(
          verticalVelocity,
          ballisticLaunch * Math.sqrt(view.physics.compliance),
        );
        airborne = true;
        flightSerial += 1;
        flightId = `flight:${flightSerial}`;
        emitTransition({
          type: "lift-off",
          eventId: `${flightId}:lift-off`,
          flightId,
          position: liftPosition,
          offsetSeconds: clamp(tickStartSeconds + liftFraction * integrationStep - callStartSeconds, 0, advancedSeconds, 0),
          velocity,
          flightFrames,
          predictedFlightSeconds: flightSeconds,
        });
      }
    }

    if (supportEnd.supportCount > 0) {
      if (airborne || height > EPSILON) {
        const landingPosition = supportStart.supportCount === 0
          ? supportBoundaryPosition(score, previousPosition, position, true)
          : position;
        const travel = position - previousPosition;
        const landingFraction = clockFraction(score, landingPosition, previousPosition, position);
        const impact = clamp(
          (Math.abs(verticalVelocity) * 0.22 + velocity * 0.012) * (0.72 + view.physics.hardness * 0.34),
          0,
          1,
          0,
        );
        landing = Math.max(landing, impact);
        compression = clamp(compression + impact * 0.56 * view.physics.compliance, 0, 1, 0);
        landingCount += 1;
        landedThisTick = true;
        emitTransition({
          type: "landing",
          eventId: `${flightId ?? `flight:${flightSerial}`}:landing`,
          flightId,
          position: landingPosition,
          offsetSeconds: clamp(tickStartSeconds + landingFraction * integrationStep - callStartSeconds, 0, advancedSeconds, 0),
          impact,
        });
      }
      height = 0;
      verticalVelocity = 0;
      airborne = false;
      flightId = null;
    } else if (airborne || height > EPSILON || verticalVelocity > 0) {
      const nextVerticalVelocity = clamp(
        verticalVelocity - view.physics.gravity * view.gravity * integrationStep,
        -12,
        12,
        0,
      );
      const nextHeight = height + (verticalVelocity + nextVerticalVelocity) * 0.5 * integrationStep;
      verticalVelocity = nextVerticalVelocity;
      if (nextHeight <= 0 && verticalVelocity < 0) {
        height = 0;
        verticalVelocity = 0;
        airborne = true;
      } else {
        height = clamp(nextHeight, 0, QUADRUPED_MOTOR_LIMITS.maxHeight, 0);
        airborne = true;
      }
    } else {
      height = 0;
      verticalVelocity = 0;
      airborne = false;
      flightId = null;
    }

    const sliding = quadrupedBodySlide(score, position);
    if (sliding > 0) {
      height = 0;
      verticalVelocity = 0;
      airborne = false;
      flightId = null;
    } else if (supportEnd.supportCount === 0 && hasScoredFootfalls) {
      const arc = quadrupedFlightTrajectory(score, position, supportEnd);
      if (arc) {
        height = clamp(arc.height, 0, QUADRUPED_MOTOR_LIMITS.maxHeight, 0);
        verticalVelocity = clamp(arc.verticalVelocity, -12, 12, 0);
        airborne = true;
      }
    }

    const firstBoundary = Math.floor(previousPosition + EPSILON) + 1;
    const lastBoundary = Math.floor(position + EPSILON);
    for (let ordinal = firstBoundary; ordinal <= lastBoundary; ordinal += 1) {
      const travel = position - previousPosition;
      const fraction = hasScoredFootfalls ? clockFraction(score, ordinal, previousPosition, position) : travel > EPSILON ? clamp((ordinal - previousPosition) / travel, 0, 1, 1) : 1;
      const crossingSeconds = tickStartSeconds + fraction * integrationStep;
      const frame = mod(ordinal, QUADRUPED_STEP_COUNT);
      const scoreEvent = quadrupedSequenceEvent(score, ordinal);
      const footEnergy = scoreEvent.footEnergy;
      if (footEnergy > 0) {
        const impact = clamp(footEnergy / 4, 0, 1, 0);
        compression = clamp(compression + impact * 0.16, 0, 1, 0);
        landing = Math.max(landing, impact * 0.72);
      }
      const event = {
        ordinal,
        frame,
        offsetSeconds: clamp(crossingSeconds - callStartSeconds, 0, advancedSeconds, 0),
        velocity: previousVelocity + (velocity - previousVelocity) * fraction,
        footEnergy,
        supportCount: supportEnd.supportCount,
        airborne,
        height,
        landing: landedThisTick,
        compression,
        contacts: scoreEvent.contacts,
        terrain: scoreEvent.terrain,
        touchdownIds: Object.freeze(scoreEvent.contacts.map(({ id }) => `${id}:${Math.floor(ordinal / QUADRUPED_STEP_COUNT)}:${frame}`)),
      };
      if (events.length < QUADRUPED_MOTOR_LIMITS.maxCrossingEvents) {
        events.push(immutableEvent(event));
      } else {
        droppedEvents += 1;
      }
    }

    const simulatedSeconds = clamp(
      current.simulatedSeconds + integrationStep,
      0,
      QUADRUPED_MOTOR_LIMITS.maxPosition,
      current.simulatedSeconds,
    );
    current = {
      position,
      velocity,
      height,
      verticalVelocity,
      compression,
      landing,
      supportCount: supportEnd.supportCount,
      supportEnergy: supportEnd.supportEnergy,
      propulsion: supportEnd.propulsion,
      airborne,
      landingCount,
      flightId,
      flightSerial,
      elapsedSeconds: current.elapsedSeconds,
      simulatedSeconds,
      remainderSeconds: 0,
      stalled: velocity === 0 && supportEnd.propulsion === 0,
    };
  }

  current.elapsedSeconds = clamp(
    callStartSeconds + advancedSeconds,
    0,
    QUADRUPED_MOTOR_LIMITS.maxPosition,
    callStartSeconds,
  );
  current.remainderSeconds = clamp(
    remainderSeconds,
    0,
    integrationStep - EPSILON,
    0,
  );
  current.stalled = current.velocity === 0 && current.propulsion === 0;
  const nextMotor = immutableMotor(current);
  return Object.freeze({
    motor: nextMotor,
    events: Object.freeze(events),
    transitions: Object.freeze(transitions),
    advancedSeconds,
    droppedEvents,
    droppedTransitions,
  });
}

export function advanceQuadrupedMotor(score, motor, deltaSeconds) {
  return simulate(score, motor, deltaSeconds);
}

export function predictQuadrupedMotor(score, motor, horizonSeconds) {
  return simulate(score, motor, horizonSeconds);
}

export function kickQuadrupedMotor(score, motor, amount = 1) {
  const safe = sanitizeMotor(score, motor);
  const strength = clamp(amount, 0, 2, 1);
  if (strength <= EPSILON) return immutableMotor(safe);
  return synchronizeQuadrupedMotorTempo(score, safe);
}

export function synchronizeQuadrupedMotorTempo(score, motor) {
  const safe = sanitizeMotor(score, motor);
  if (scoredFootEnergy(score) <= EPSILON) return immutableMotor(safe);
  const velocity = targetVelocity(scoreView(score)) / quadrupedScoreTiming(score).durations[mod(Math.floor(safe.position), 16)];
  return immutableMotor({ ...safe, velocity, stalled: false });
}

export function quadrupedMotorSnapshot(score, motor) {
  const safe = sanitizeMotor(score, motor);
  const view = scoreView(score);
  const support = footSupport(score, safe.position);
  const positionInCycle = mod(safe.position, QUADRUPED_STEP_COUNT);
  const frame = Math.floor(positionInCycle);
  return Object.freeze({
    position: safe.position,
    ordinal: Math.floor(safe.position),
    frame,
    phase: positionInCycle - frame,
    clockPosition: quadrupedClockAtPosition(score, safe.position),
    cycleBeats: quadrupedScoreTiming(score).beats,
    bodySlide: quadrupedBodySlide(score, safe.position),
    cycleProgress: positionInCycle / QUADRUPED_STEP_COUNT,
    velocity: safe.velocity,
    targetVelocity: targetVelocity(view),
    normalizedVelocity: clamp(safe.velocity / Math.max(EPSILON, targetVelocity(view)), 0, 1.5, 0),
    momentum: view.momentum,
    gravity: view.gravity,
    moving: safe.velocity > STALL_VELOCITY,
    stalled: safe.velocity === 0 && support.propulsion === 0,
    supportCount: support.supportCount,
    supportEnergy: support.supportEnergy,
    propulsion: support.propulsion,
    legs: support.legs,
    bodyWorldX: support.bodyWorldX,
    airborne: safe.airborne,
    height: safe.height,
    verticalVelocity: safe.verticalVelocity,
    compression: safe.compression,
    landing: safe.landing,
    landingCount: safe.landingCount,
    flightId: safe.flightId,
    flightSerial: safe.flightSerial,
    elapsedSeconds: safe.elapsedSeconds,
    simulatedSeconds: safe.simulatedSeconds,
    remainderSeconds: safe.remainderSeconds,
  });
}
