import {
  QUADRUPED_BEHAVIORS,
  QUADRUPED_STEP_COUNT,
  quadrupedAnimal,
} from "./quadruped.js";

const FOOT_LANE_IDS = Object.freeze([
  "front-left",
  "front-right",
  "rear-left",
  "rear-right",
]);

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
  dance: 0.26,
  "rear-waltz": 0.18,
  carousel: 0,
  "cat-prowl": 0,
  "cat-gallop": 0.68,
  "run-leap": 1,
  "giraffe-walk": 0,
  "giraffe-gallop": 0.04,
  "lizard-scuttle": 0,
  "lizard-trot": 0.05,
  "lizard-pace": 0,
  "lizard-sprint": 0.18,
});

export const QUADRUPED_MOTOR_LIMITS = Object.freeze({
  integrationStepSeconds: 1 / 120,
  maxAdvanceSeconds: 2,
  maxCrossingEvents: 160,
  maxTransitionEvents: 64,
  maxVelocity: 64,
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

function behaviorStanceSteps(score) {
  const definition = QUADRUPED_BEHAVIORS.find(({ id }) => id === score?.behaviorId);
  return clamp(definition?.stanceSteps, 0.65, QUADRUPED_STEP_COUNT - 0.35, 6.4);
}

function scoreView(score) {
  const animal = quadrupedAnimal(score?.animalId);
  const animalId = animal.id;
  const tempoBpm = clamp(score?.tempoBpm, 24, 240, 72);
  return {
    animalId,
    behaviorId: typeof score?.behaviorId === "string" ? score.behaviorId : "walk",
    cadenceFramesPerSecond: tempoBpm * QUADRUPED_STEP_COUNT / 60,
    stride: clamp(score?.stride, 0.4, 1.6, 0.9),
    momentum: clamp(score?.momentum, 0.5, 1.4, 0.82),
    gravity: clamp(score?.gravity, 0.55, 1.55, 1),
    stanceSteps: behaviorStanceSteps(score),
    physics: Object.freeze({
      mass: clamp(animal.mass, 0.3, 2, 1),
      power: clamp(animal.power, 0.4, 1.8, 1),
      compliance: clamp(animal.compliance, 0.4, 1.6, 1),
      rolling: clamp(animal.rollingResistance, 0.4, 2, 1),
      gravity: clamp(animal.baseGravity, 7, 13, 9.8),
    }),
  };
}

function footSupport(score, position, stanceSteps) {
  const cyclePosition = mod(position, QUADRUPED_STEP_COUNT);
  const wholeStep = Math.floor(cyclePosition);
  const fraction = cyclePosition - wholeStep;
  let supportCount = 0;
  let supportEnergy = 0;
  let propulsion = 0;

  for (const laneId of FOOT_LANE_IDS) {
    let previous = null;
    let next = null;
    for (let lag = 0; lag < QUADRUPED_STEP_COUNT; lag += 1) {
      const intensity = contactAt(score, laneId, wholeStep - lag);
      if (intensity > 0) {
        previous = { age: lag + fraction, intensity };
        break;
      }
    }
    if (!previous) continue;
    for (let lead = 1; lead <= QUADRUPED_STEP_COUNT; lead += 1) {
      if (contactAt(score, laneId, wholeStep + lead) > 0) {
        next = { distance: lead - fraction };
        break;
      }
    }
    if (!next) continue;

    const cycleSteps = Math.max(0.8, previous.age + next.distance);
    const stance = Math.min(stanceSteps, Math.max(0.55, cycleSteps - 0.28));
    if (previous.age >= stance) continue;
    const progress = clamp(previous.age / stance, 0, 1, 0);
    const release = progress > 0.88 ? (1 - progress) / 0.12 : 1;
    const load = previous.intensity * clamp(release, 0, 1, 0);
    const pushArc = 0.36 + Math.sin(Math.PI * Math.min(0.92, progress)) * 0.64;
    supportCount += 1;
    supportEnergy += load;
    propulsion += load * pushArc;
  }

  return { supportCount, supportEnergy, propulsion };
}

function footEnergyAtFrame(score, frame) {
  return FOOT_LANE_IDS.reduce((sum, laneId) => sum + contactAt(score, laneId, frame), 0);
}

function targetVelocity(view) {
  return clamp(view.cadenceFramesPerSecond, 0, QUADRUPED_MOTOR_LIMITS.maxVelocity, 0);
}

function flightAmount(behaviorId) {
  if (Object.hasOwn(FLIGHT_BY_BEHAVIOR, behaviorId)) return FLIGHT_BY_BEHAVIOR[behaviorId];
  if (/bound|gallop|sprint|leap|pronk|jump|stot/i.test(behaviorId)) return 0.78;
  if (/canter|trot|pace|rack|t.lt/i.test(behaviorId)) return 0.34;
  return 0;
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
    elapsedSeconds: value.elapsedSeconds,
    simulatedSeconds: value.simulatedSeconds,
    remainderSeconds: value.remainderSeconds,
    stalled: value.stalled,
  });
}

function sanitizeMotor(score, motor) {
  const position = clamp(motor?.position, 0, QUADRUPED_MOTOR_LIMITS.maxPosition, 0);
  const velocity = clamp(motor?.velocity, 0, QUADRUPED_MOTOR_LIMITS.maxVelocity, 0);
  const support = footSupport(score, position, behaviorStanceSteps(score));
  const supportCount = Math.round(clamp(motor?.supportCount, 0, 4, support.supportCount));
  const supportEnergy = clamp(motor?.supportEnergy, 0, 4, support.supportEnergy);
  const propulsion = clamp(motor?.propulsion, 0, 4, support.propulsion);
  const height = clamp(motor?.height, 0, QUADRUPED_MOTOR_LIMITS.maxHeight, 0);
  const remainderSeconds = clamp(
    motor?.remainderSeconds,
    0,
    QUADRUPED_MOTOR_LIMITS.integrationStepSeconds - EPSILON,
    0,
  );
  return {
    position,
    velocity,
    height,
    verticalVelocity: clamp(motor?.verticalVelocity, -12, 12, 0),
    compression: clamp(motor?.compression, 0, 1, 0),
    landing: clamp(motor?.landing, 0, 1, 0),
    supportCount,
    supportEnergy,
    propulsion,
    airborne: Boolean(motor?.airborne) && height > EPSILON,
    landingCount: Math.floor(clamp(motor?.landingCount, 0, Number.MAX_SAFE_INTEGER, 0)),
    elapsedSeconds: clamp(motor?.elapsedSeconds, 0, QUADRUPED_MOTOR_LIMITS.maxPosition, 0),
    simulatedSeconds: clamp(motor?.simulatedSeconds, 0, QUADRUPED_MOTOR_LIMITS.maxPosition, 0),
    remainderSeconds,
    stalled: velocity === 0 && propulsion === 0,
  };
}

export function createQuadrupedMotorState(score, options = {}) {
  const position = clamp(options?.position, 0, QUADRUPED_MOTOR_LIMITS.maxPosition, 0);
  const support = footSupport(score, position, behaviorStanceSteps(score));
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
    const supportStart = footSupport(score, previousPosition, view.stanceSteps);
    const desiredVelocity = targetVelocity(view);
    const traction = clamp(supportStart.propulsion / 1.7, 0, 1.5, 0);
    const response = 3.8 * view.physics.power / view.physics.mass
      * (0.72 + view.stride * 0.28) / Math.sqrt(view.momentum);
    const driveAcceleration = Math.max(0, desiredVelocity - previousVelocity) * response * traction;
    const groundResistance = view.physics.rolling * (supportStart.supportCount > 0 ? 0.34 : 2.1)
      / (view.momentum * view.momentum);
    const airResistance = 0.0025 * previousVelocity * previousVelocity;
    const acceleration = driveAcceleration - groundResistance - airResistance;
    let velocity = clamp(
      previousVelocity + acceleration * integrationStep,
      0,
      QUADRUPED_MOTOR_LIMITS.maxVelocity,
      0,
    );
    if (supportStart.propulsion === 0 && velocity < STALL_VELOCITY) velocity = 0;
    const position = clamp(
      previousPosition + (previousVelocity + velocity) * 0.5 * integrationStep,
      0,
      QUADRUPED_MOTOR_LIMITS.maxPosition,
      previousPosition,
    );
    if (position >= QUADRUPED_MOTOR_LIMITS.maxPosition - EPSILON) velocity = 0;
    const supportEnd = footSupport(score, position, view.stanceSteps);

    let height = current.height;
    let verticalVelocity = current.verticalVelocity;
    let compression = current.compression * Math.exp(-8 * integrationStep);
    let landing = Math.max(0, current.landing - integrationStep * 5.5);
    let airborne = current.airborne;
    let landingCount = current.landingCount;
    let landedThisTick = false;
    const transitionOffset = clamp(
      tickStartSeconds + integrationStep - callStartSeconds,
      0,
      advancedSeconds,
      0,
    );

    if (current.supportCount > 0 && supportEnd.supportCount === 0 && velocity > STALL_VELOCITY) {
      const launch = flightAmount(view.behaviorId);
      if (launch > 0) {
        verticalVelocity = Math.max(
          verticalVelocity,
          (0.78 + launch * 1.72) * Math.sqrt(view.physics.compliance),
        );
        airborne = true;
        emitTransition({
          type: "lift-off",
          position,
          offsetSeconds: transitionOffset,
          velocity,
        });
      }
    }

    if (supportEnd.supportCount > 0) {
      if (airborne || height > EPSILON) {
        const impact = clamp(Math.abs(verticalVelocity) * 0.22 + velocity * 0.012, 0, 1, 0);
        landing = Math.max(landing, impact);
        compression = clamp(compression + impact * 0.56 * view.physics.compliance, 0, 1, 0);
        landingCount += 1;
        landedThisTick = true;
        emitTransition({
          type: "landing",
          position,
          offsetSeconds: transitionOffset,
          impact,
        });
      }
      height = 0;
      verticalVelocity = 0;
      airborne = false;
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
        const impact = clamp(Math.abs(verticalVelocity) * 0.2 + velocity * 0.008, 0, 1, 0);
        height = 0;
        verticalVelocity = 0;
        airborne = false;
        landing = Math.max(landing, impact);
        compression = clamp(compression + impact * 0.48 * view.physics.compliance, 0, 1, 0);
        landingCount += 1;
        landedThisTick = true;
        emitTransition({
          type: "landing",
          position,
          offsetSeconds: transitionOffset,
          impact,
        });
      } else {
        height = clamp(nextHeight, 0, QUADRUPED_MOTOR_LIMITS.maxHeight, 0);
        airborne = height > EPSILON;
      }
    } else {
      height = 0;
      verticalVelocity = 0;
      airborne = false;
    }

    const firstBoundary = Math.floor(previousPosition + EPSILON) + 1;
    const lastBoundary = Math.floor(position + EPSILON);
    for (let ordinal = firstBoundary; ordinal <= lastBoundary; ordinal += 1) {
      const travel = position - previousPosition;
      const fraction = travel > EPSILON ? clamp((ordinal - previousPosition) / travel, 0, 1, 1) : 1;
      const crossingSeconds = tickStartSeconds + fraction * integrationStep;
      const frame = mod(ordinal, QUADRUPED_STEP_COUNT);
      const footEnergy = footEnergyAtFrame(score, frame);
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
  const scoredFootEnergy = FOOT_LANE_IDS.reduce((total, laneId) => (
    total + Array.from({ length: QUADRUPED_STEP_COUNT }, (_, frame) => contactAt(score, laneId, frame))
      .reduce((sum, intensity) => sum + intensity, 0)
  ), 0);
  if (scoredFootEnergy <= EPSILON) return immutableMotor(safe);
  const view = scoreView(score);
  const strength = clamp(amount, 0, 2, 1);
  const scoreDrive = clamp(scoredFootEnergy / 8, 0.08, 1, 0.08);
  const velocity = clamp(
    safe.velocity + targetVelocity(view) * (0.035 + scoreDrive * 0.07) * strength,
    0,
    QUADRUPED_MOTOR_LIMITS.maxVelocity,
    safe.velocity,
  );
  return immutableMotor({ ...safe, velocity, stalled: false });
}

export function quadrupedMotorSnapshot(score, motor) {
  const safe = sanitizeMotor(score, motor);
  const view = scoreView(score);
  const support = footSupport(score, safe.position, view.stanceSteps);
  const positionInCycle = mod(safe.position, QUADRUPED_STEP_COUNT);
  const frame = Math.floor(positionInCycle);
  return Object.freeze({
    position: safe.position,
    ordinal: Math.floor(safe.position),
    frame,
    phase: positionInCycle - frame,
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
    airborne: safe.airborne,
    height: safe.height,
    verticalVelocity: safe.verticalVelocity,
    compression: safe.compression,
    landing: safe.landing,
    landingCount: safe.landingCount,
    elapsedSeconds: safe.elapsedSeconds,
    simulatedSeconds: safe.simulatedSeconds,
    remainderSeconds: safe.remainderSeconds,
  });
}
