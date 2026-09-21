const TAU = Math.PI * 2;
const EPSILON = 1e-9;

export const FLIGHT_TIERS = Object.freeze([
  Object.freeze({ id: "vector", label: "Vector cruise", minimum: 0, accent: "#8dffcf" }),
  Object.freeze({ id: "attack", label: "Attack speed", minimum: 26, accent: "#ffe17a" }),
  Object.freeze({ id: "hyper", label: "Hyperspace", minimum: 54, accent: "#75d9ff" }),
  Object.freeze({ id: "ludicrous", label: "Ludicrous", minimum: 78, accent: "#ff7bd5" }),
  Object.freeze({ id: "plaid", label: "Plaid", minimum: 94, accent: "#ffffff" }),
]);

export const FLIGHT_ARTICULATIONS = Object.freeze(["continuous", "notes", "triggers"]);

export function clamp(value, minimum = 0, maximum = 1) {
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

export function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

export function wrapAngle(angle) {
  const value = Number.isFinite(angle) ? angle : 0;
  return ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

export function flightTierForThrottle(throttle) {
  const value = clamp(throttle, 0, 100);
  let tier = FLIGHT_TIERS[0];
  for (const candidate of FLIGHT_TIERS) {
    if (value >= candidate.minimum) tier = candidate;
  }
  return tier;
}

export function normalizedThrottle(throttle) {
  return clamp(throttle, 0, 100) / 100;
}

export function travelSpeedForThrottle(throttle) {
  const amount = normalizedThrottle(throttle);
  return 0.075 + 3.85 * amount ** 2.18;
}

export function trailLengthForThrottle(throttle) {
  const amount = normalizedThrottle(throttle);
  return clamp((amount - 0.18) / 0.74, 0, 1) ** 1.35;
}

export function plaidAmountForThrottle(throttle) {
  const amount = normalizedThrottle(throttle);
  if (amount <= 0.92) return 0;
  if (amount >= 1) return 1;
  return clamp((amount - 0.92) / 0.08, 0, 1);
}

export function seededRandom(seed = 1) {
  let value = Math.trunc(Number(seed) || 1) >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Create one deterministic 3D star ray over the complete 360-degree field. */
export function createFlightStar(id, random = Math.random, depth = null) {
  const theta = random() * TAU;
  const radius = lerp(0.18, 1.08, Math.sqrt(random()));
  const star = {
    id: Math.max(0, Math.trunc(id)),
    theta,
    radius,
    x: Math.cos(theta) * radius,
    y: Math.sin(theta) * radius,
    z: Number.isFinite(depth) ? clamp(depth, 0.025, 1.08) : lerp(0.05, 1.05, random()),
    previousTheta: theta,
    previousX: 0,
    previousY: 0,
    previousZ: 1,
    angularVelocity: lerp(-0.16, 0.16, random()),
    colorIndex: Math.floor(random() * 7),
    brightness: lerp(0.48, 1, random()),
    size: lerp(0.62, 1.62, random()),
    twinkle: random() * TAU,
    contacted: false,
  };
  star.previousX = star.x;
  star.previousY = star.y;
  star.previousZ = star.z;
  return star;
}

export function recycleFlightStar(star, random = Math.random, depth = null) {
  return Object.assign(star, createFlightStar(star?.id ?? 0, random, depth), {
    contacted: false,
  });
}

/** Advance depth and angular drift; the canvas projection supplies helm parallax. */
export function stepFlightStar(star, deltaSeconds, travelSpeed, {
  fieldSpin = 0,
  steeringCurl = 0,
} = {}) {
  const dt = clamp(deltaSeconds, 0, 0.1);
  star.previousTheta = star.theta;
  star.previousX = star.x;
  star.previousY = star.y;
  star.previousZ = star.z;
  const curl = clamp(steeringCurl, -1, 1) * lerp(0.04, 0.28, 1 - clamp(star.z, 0, 1));
  star.theta += (star.angularVelocity + clamp(fieldSpin, -1.5, 1.5) + curl) * dt;
  star.x = Math.cos(star.theta) * star.radius;
  star.y = Math.sin(star.theta) * star.radius;
  star.z -= clamp(travelSpeed, 0, 8) * dt;
  return star;
}

/** Perspective projection centered on the ship, with bounded helm parallax. */
export function projectFlightStar(star, {
  width,
  height,
  centerX = width * 0.5,
  centerY = height * 0.5,
  depth: requestedDepth = star?.z ?? 1,
  sourceX = star?.x ?? 0,
  sourceY = star?.y ?? 0,
  helmX = 0,
  helmY = 0,
} = {}) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const projectionScale = Math.min(safeWidth, safeHeight);
  const depth = clamp(requestedDepth, 0.025, 1.1);
  const perspective = 0.045 + ((1 - Math.min(1, depth)) ** 1.17 / (depth + 0.052)) * 0.62;
  const nearWarp = (1 - Math.min(1, depth)) ** 1.6;
  const x = centerX
    + sourceX * projectionScale * 0.43 * perspective
    - clamp(helmX, -1, 1) * projectionScale * 0.075 * nearWarp;
  const y = centerY
    + sourceY * projectionScale * 0.43 * perspective
    - clamp(helmY, -1, 1) * projectionScale * 0.075 * nearWarp;
  return { x, y, perspective, depth };
}

/**
 * Resolve visible screen-space motion into radial and tangential components.
 * Keeping this in projected space makes Doppler and timbre follow exactly what
 * passes the centered ship, including perspective, helm parallax, and curl.
 */
export function projectedKinematics(previousPoint, currentPoint, center = { x: 0, y: 0 }, deltaSeconds = 1) {
  if (!previousPoint || !currentPoint) return { radialVelocity: 0, tangentialVelocity: 0 };
  const values = [
    previousPoint.x,
    previousPoint.y,
    currentPoint.x,
    currentPoint.y,
    center?.x,
    center?.y,
    deltaSeconds,
  ];
  if (!values.every(Number.isFinite) || deltaSeconds <= EPSILON) {
    return { radialVelocity: 0, tangentialVelocity: 0 };
  }
  const previousX = previousPoint.x - center.x;
  const previousY = previousPoint.y - center.y;
  const currentX = currentPoint.x - center.x;
  const currentY = currentPoint.y - center.y;
  let radialX = (previousX + currentX) * 0.5;
  let radialY = (previousY + currentY) * 0.5;
  let radialLength = Math.hypot(radialX, radialY);
  if (radialLength <= EPSILON) {
    radialX = currentX || previousX;
    radialY = currentY || previousY;
    radialLength = Math.hypot(radialX, radialY);
  }
  if (radialLength <= EPSILON) return { radialVelocity: 0, tangentialVelocity: 0 };
  const unitX = radialX / radialLength;
  const unitY = radialY / radialLength;
  const velocityX = (currentPoint.x - previousPoint.x) / deltaSeconds;
  const velocityY = (currentPoint.y - previousPoint.y) / deltaSeconds;
  return {
    radialVelocity: velocityX * unitX + velocityY * unitY,
    tangentialVelocity: velocityX * -unitY + velocityY * unitX,
  };
}

/** Seam-free periodic position over a circular pitch pattern. */
export function circularPitchAmount(angle, {
  lobes = 3,
  phase = 0,
} = {}) {
  const count = Math.round(clamp(lobes, 1, 12));
  return 0.5 + Math.sin(count * wrapAngle(angle) + phase) * 0.5;
}

/** Radius of the ship-owned circular/rose listening contour at one angle. */
export function circularPlayheadRadius(baseRadius, angle, {
  lobes = 3,
  phase = 0,
  depth = 0.12,
} = {}) {
  const radius = Math.max(EPSILON, Number(baseRadius) || 0);
  const wave = Math.sin(Math.round(clamp(lobes, 1, 12)) * wrapAngle(angle) + phase);
  return radius * (1 + clamp(depth, 0, 0.32) * wave);
}

/**
 * Map star/ship geometry directly to an unquantized oscillator target.
 * There is deliberately no root note, scale table, score, or pitch grid.
 */
export function mapFlightContact(point, {
  id = point?.id ?? 0,
  centerX = 0,
  centerY = 0,
  heading = -Math.PI / 2,
  sensorRadius = 1,
  sensorWidth = 0.2,
  orbitLobes = 3,
  orbitPhase = 0,
  orbitDepth = 0.12,
  minimumFrequency = 48,
  maximumFrequency = 2_400,
  radialVelocity = 0,
  tangentialVelocity = 0,
  brightness = 1,
  doppler = 0.7,
  stereoWidth = 0.92,
} = {}) {
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  const dx = x - centerX;
  const dy = y - centerY;
  const radius = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const localAngle = wrapAngle(angle - heading);
  const contourRadius = circularPlayheadRadius(sensorRadius, localAngle, {
    lobes: orbitLobes,
    phase: orbitPhase,
    depth: orbitDepth,
  });
  const signedDistance = radius - contourRadius;
  const width = Math.max(EPSILON, Number(sensorWidth) || 0);
  const bandAmount = clamp(1 - Math.abs(signedDistance) / width, 0, 1);
  const proximity = bandAmount * bandAmount * (3 - 2 * bandAmount);
  const pitch = circularPitchAmount(localAngle, { lobes: orbitLobes, phase: orbitPhase });
  const low = clamp(minimumFrequency, 20, 18_000);
  const high = clamp(maximumFrequency, low, 20_000);
  const baseFrequency = low * (high / low) ** pitch;
  const radial = clamp(radialVelocity, -1, 1);
  const tangent = clamp(tangentialVelocity, -1, 1);
  const bendPosition = -Math.tanh(signedDistance / Math.max(EPSILON, width * 0.48));
  const dopplerOctaves = clamp(doppler, 0, 1) * radial * bendPosition * 0.34;
  const frequency = clamp(baseFrequency * 2 ** dopplerOctaves, 20, 20_000);
  const incidence = clamp(Math.abs(radial) / Math.max(EPSILON, Math.hypot(radial, tangent)), 0, 1);
  const forwardWeight = lerp(0.56, 1, clamp((Math.cos(localAngle) + 1) * 0.5, 0, 1));
  const strength = proximity * clamp(brightness, 0, 1) * forwardWeight;
  return {
    id: Math.max(0, Math.trunc(id)),
    x,
    y,
    angle,
    localAngle,
    radius,
    contourRadius,
    signedDistance,
    proximity,
    radialVelocity: radial,
    tangentialVelocity: tangent,
    incidence,
    strength,
    pan: clamp(Math.sin(localAngle) * clamp(stereoWidth, 0, 1), -1, 1),
    pitch,
    baseFrequency,
    frequency,
    character: clamp(Math.abs(tangent) * 0.62 + Math.abs(radial) * 0.38, 0, 1),
  };
}

/** Detect an outward swept crossing of the ship's circular/rose playhead. */
export function radialPlayheadCrossing(previousPoint, currentPoint, {
  centerX = 0,
  centerY = 0,
  heading = -Math.PI / 2,
  previousHeading = heading,
  currentHeading = heading,
  sensorRadius = 1,
  orbitLobes = 3,
  orbitPhase = 0,
  orbitDepth = 0.12,
} = {}) {
  if (!previousPoint || !currentPoint) return null;
  const values = [previousPoint.x, previousPoint.y, currentPoint.x, currentPoint.y];
  if (!values.every(Number.isFinite)) return null;
  const signedDistance = (point, fieldHeading) => {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const localAngle = wrapAngle(Math.atan2(dy, dx) - fieldHeading);
    return Math.hypot(dx, dy) - circularPlayheadRadius(sensorRadius, localAngle, {
      lobes: orbitLobes,
      phase: orbitPhase,
      depth: orbitDepth,
    });
  };
  const before = signedDistance(previousPoint, previousHeading);
  const after = signedDistance(currentPoint, currentHeading);
  if (before > EPSILON || after < -EPSILON) return null;
  if (Math.abs(before) <= EPSILON && Math.abs(after) <= EPSILON) return null;
  const amount = clamp(-before / Math.max(EPSILON, after - before), 0, 1);
  const x = lerp(previousPoint.x, currentPoint.x, amount);
  const y = lerp(previousPoint.y, currentPoint.y, amount);
  const dx = x - centerX;
  const dy = y - centerY;
  const angle = Math.atan2(dy, dx);
  const crossingHeading = previousHeading
    + wrapAngle(currentHeading - previousHeading) * amount;
  return {
    amount,
    x,
    y,
    angle,
    localAngle: wrapAngle(angle - crossingHeading),
    radius: Math.hypot(dx, dy),
  };
}
