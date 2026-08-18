const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

export const PLASMA_DEFAULTS = Object.freeze({
  boltCount: 10,
  attraction: 0.82,
  motion: 0.72,
  jitter: 0.82,
  branching: 0.74,
  baseFrequency: 68,
  pitchRange: 3.6,
  level: 0.32,
});

// A deliberately wide, stratified distribution keeps languid filaments and
// skittish filaments alive at the same time. The small seeded variation avoids
// making bolts in the same band feel mechanically synchronized.
const FILAMENT_RATE_BANDS = Object.freeze([0.18, 0.31, 0.52, 0.82, 1.22, 1.82, 2.72, 3.4]);

/** Clamp a finite number while treating an invalid value as the lower bound. */
export function clamp(value, minimum = 0, maximum = 1) {
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : low;
}

/** Wrap an angle into one turn. */
export function wrapAngle(angle) {
  const value = Number(angle);
  return Number.isFinite(value) ? ((value % TAU) + TAU) % TAU : 0;
}

/** Project a point radially onto the surface of a spherical glass globe. */
export function closestGlassPoint(point, radius = 1) {
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  const z = Number(point?.z) || 0;
  const safeRadius = Math.max(0, Number(radius) || 0);
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) return { x: 0, y: 0, z: safeRadius };
  const scale = safeRadius / length;
  return { x: x * scale, y: y * scale, z: z * scale };
}

function hash01(value) {
  const hashed = Math.sin(value * 12.9898 + 78.233) * 43758.5453123;
  return hashed - Math.floor(hashed);
}

function signedHash(value) {
  return hash01(value) * 2 - 1;
}

function shortestAngleDelta(from, to) {
  return ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

function sphericalDirection(angle, latitude) {
  const azimuth = wrapAngle(angle);
  const elevation = clamp(latitude, -HALF_PI, HALF_PI);
  const latitudeRadius = Math.cos(elevation);
  return {
    x: latitudeRadius * Math.cos(azimuth),
    y: Math.sin(elevation),
    z: latitudeRadius * Math.sin(azimuth),
  };
}

function sphericalCoordinates(point) {
  if (!point?.active) return null;
  const rawX = Number(point.x);
  const rawY = Number(point.y);
  let rawZ = Number(point.z);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
  if (!Number.isFinite(rawZ)) {
    rawZ = Math.sqrt(Math.max(0, 1 - rawX * rawX - rawY * rawY));
  }
  const onGlass = closestGlassPoint({ x: rawX, y: rawY, z: rawZ }, 1);
  return {
    angle: wrapAngle(Math.atan2(onGlass.z, onGlass.x)),
    latitude: Math.asin(clamp(onGlass.y, -1, 1)),
    point: onGlass,
  };
}

function cycleValue(seed, cycle, salt) {
  return hash01(seed * (17.13 + salt * 0.37) + cycle * (29.71 + salt * 1.91) + salt * 101.3);
}

function filamentRate(seed, index = 0) {
  const band = FILAMENT_RATE_BANDS[index % FILAMENT_RATE_BANDS.length];
  const variation = 0.88 + hash01(seed * 83.17 + index * 19.73) * 0.24;
  return clamp(band * variation, 0.08, 4);
}

function cycleLifetime(seed, cycle) {
  return 0.48 + cycleValue(seed, cycle, 2) * 1.62;
}

function cycleAngle(seed, cycle) {
  return wrapAngle(cycleValue(seed, cycle, 3) * TAU);
}

function cycleLatitude(seed, cycle) {
  const height = clamp(cycleValue(seed, cycle, 5) * 2 - 1, -0.94, 0.94);
  return Math.asin(height);
}

function staticGate(age, lifetime, seed, cycle, time = 0) {
  const progress = clamp(age / Math.max(1e-6, lifetime), 0, 1);
  const onset = 0.025 + cycleValue(seed, cycle, 7) * 0.12;
  const attackEnd = onset + 0.045 + cycleValue(seed, cycle, 11) * 0.07;
  const releaseStart = 0.54 + cycleValue(seed, cycle, 13) * 0.27;
  const releaseEnd = Math.min(0.97, releaseStart + 0.07 + cycleValue(seed, cycle, 17) * 0.13);

  let envelope = 0;
  if (progress >= onset && progress < attackEnd) {
    envelope = (progress - onset) / Math.max(1e-6, attackEnd - onset);
  } else if (progress >= attackEnd && progress < releaseStart) {
    envelope = 1;
  } else if (progress >= releaseStart && progress < releaseEnd) {
    envelope = 1 - (progress - releaseStart) / Math.max(1e-6, releaseEnd - releaseStart);
  }
  if (envelope <= 0) return 0;

  const pulse = 0.7 + 0.3 * Math.abs(Math.sin(
    progress * Math.PI * (7 + cycleValue(seed, cycle, 19) * 13)
      + seed * 2.17
      + cycle * 0.73,
  ));
  const dropoutCell = Math.floor((Number(time) || 0) * (8 + cycleValue(seed, cycle, 23) * 8));
  const dropout = hash01(seed * 53.9 + cycle * 19.1 + dropoutCell * 7.73) < 0.075;
  return clamp(envelope * pulse * (dropout ? 0.035 : 1), 0, 1);
}

/** Create a deterministic field distributed over the full surface of a globe. */
export function createPlasmaBolts(count = PLASMA_DEFAULTS.boltCount, seed = 1) {
  const total = Math.round(clamp(count, 1, 24));
  const baseSeed = Number.isFinite(Number(seed)) ? Number(seed) : 1;
  return Array.from({ length: total }, (_, index) => {
    const boltSeed = baseSeed + index * 0.61803398875;
    const cycle = 0;
    const lifetime = cycleLifetime(boltSeed, cycle);
    const age = cycleValue(boltSeed, cycle, 29) * lifetime * 0.92;
    const angle = wrapAngle(
      index / total * TAU
        + signedHash(baseSeed * 31.7 + index * 8.13) * TAU / Math.max(3, total),
    );
    const height = clamp(signedHash(baseSeed * 71.3 + index * 27.17), -0.94, 0.94);
    const latitude = Math.asin(height);
    const targetAngle = cycleAngle(boltSeed, cycle);
    const targetLatitude = cycleLatitude(boltSeed, cycle);
    const phase = cycleValue(boltSeed, cycle, 31) * TAU;
    const gate = staticGate(age, lifetime, boltSeed, cycle, age);
    const crackle = 0.72 + 0.28 * cycleValue(boltSeed, cycle, 37);
    return {
      id: `plasma-${index}`,
      angle,
      latitude,
      targetAngle,
      targetLatitude,
      velocity: signedHash(baseSeed * 43.1 + index * 12.7) * 0.24,
      phase,
      energy: clamp(0.045 + gate * crackle, 0, 1.2),
      seed: boltSeed,
      age,
      lifetime,
      cycle,
      gate,
      affinity: hash01(baseSeed * 103.7 + index * 47.9),
      rate: filamentRate(boltSeed, index),
    };
  });
}

function safeBolt(bolt, index) {
  const seed = Number.isFinite(Number(bolt?.seed)) ? Number(bolt.seed) : index + 1;
  const cycle = Math.max(0, Math.floor(Number(bolt?.cycle) || 0));
  const fallbackLifetime = cycleLifetime(seed, cycle);
  const lifetime = Number.isFinite(Number(bolt?.lifetime))
    ? clamp(bolt.lifetime, 0.12, 30)
    : fallbackLifetime;
  return {
    id: bolt?.id ?? `plasma-${index}`,
    angle: wrapAngle(bolt?.angle),
    latitude: clamp(bolt?.latitude, -HALF_PI, HALF_PI),
    targetAngle: Number.isFinite(Number(bolt?.targetAngle))
      ? wrapAngle(bolt.targetAngle)
      : cycleAngle(seed, cycle),
    targetLatitude: Number.isFinite(Number(bolt?.targetLatitude))
      ? clamp(bolt.targetLatitude, -HALF_PI, HALF_PI)
      : cycleLatitude(seed, cycle),
    velocity: clamp(bolt?.velocity, -20, 20),
    phase: wrapAngle(bolt?.phase),
    energy: clamp(bolt?.energy, 0, 1.25),
    seed,
    age: clamp(bolt?.age, 0, lifetime),
    lifetime,
    cycle,
    gate: clamp(bolt?.gate, 0, 1),
    affinity: clamp(bolt?.affinity, 0, 1),
    rate: Number.isFinite(Number(bolt?.rate))
      ? clamp(bolt.rate, 0.08, 4)
      : filamentRate(seed, index),
  };
}

/**
 * Advance asynchronous discharge bursts. Only high-affinity filaments react
 * strongly to a touch, leaving most of the field free to rewire around the globe.
 */
export function stepPlasmaBolts(bolts, {
  dt = 1 / 60,
  time = 0,
  pointer = null,
  attraction = PLASMA_DEFAULTS.attraction,
  speed = PLASMA_DEFAULTS.motion,
} = {}) {
  if (!Array.isArray(bolts)) return [];
  const elapsed = clamp(dt, 0, 0.1);
  const clock = Number.isFinite(Number(time)) ? Number(time) : 0;
  const activity = clamp(speed, 0, 2);
  const pull = clamp(attraction, 0, 1.5);
  const contact = sphericalCoordinates(pointer);
  // The control scales the whole heterogeneous rate field without collapsing
  // it to a single tempo. Zero is a near-still electrical crawl; one is lively.
  const globalRate = 0.04 + activity * 1.48;

  return bolts.map((source, index) => {
    const bolt = safeBolt(source, index);
    const localElapsed = elapsed * globalRate * bolt.rate;
    let cycle = bolt.cycle;
    let age = bolt.age + localElapsed;
    let lifetime = bolt.lifetime;
    let targetAngle = bolt.targetAngle;
    let targetLatitude = bolt.targetLatitude;
    let phase = bolt.phase;

    while (age >= lifetime) {
      age -= lifetime;
      cycle += 1;
      lifetime = cycleLifetime(bolt.seed, cycle);
      targetAngle = cycleAngle(bolt.seed, cycle);
      targetLatitude = cycleLatitude(bolt.seed, cycle);
      phase = cycleValue(bolt.seed, cycle, 31) * TAU;
    }

    // Age is a local clock: it already contains both the filament's own rate
    // and the global speed setting, so slow and fast arcs never lock together.
    const localClock = age + cycle * 0.173 + clock * 0.002;
    const angularWander = Math.sin(localClock * (1.4 + cycleValue(bolt.seed, cycle, 41) * 2.2) + phase)
      * (0.08 + activity * 0.2);
    const latitudeWander = Math.sin(localClock * (1.7 + cycleValue(bolt.seed, cycle, 43) * 2.5) - phase * 0.71)
      * (0.045 + activity * 0.12);
    const freeAngleTarget = wrapAngle(targetAngle + angularWander);
    const freeLatitudeTarget = clamp(targetLatitude + latitudeWander, -1.36, 1.36);
    const angleDelta = shortestAngleDelta(bolt.angle, freeAngleTarget);
    const damping = Math.exp(-localElapsed * (2.4 + activity * 1.7));
    let velocity = bolt.velocity * damping
      + angleDelta * localElapsed * (0.8 + activity * 2.7)
      + signedHash(bolt.seed * 11.3 + cycle * 17.7 + Math.floor(localClock * 17))
        * localElapsed * activity * 0.16;
    let angle = wrapAngle(bolt.angle + velocity * localElapsed * (0.55 + activity * 1.45));
    const latitudeEase = 1 - Math.exp(-localElapsed * (0.45 + activity * 1.85));
    let latitude = clamp(
      bolt.latitude + (freeLatitudeTarget - bolt.latitude) * latitudeEase,
      -1.42,
      1.42,
    );

    // The stable affinity split prevents a contact from flattening the entire
    // globe into a radial bundle. Roughly two fifths of bolts can focus.
    const focusable = contact && bolt.affinity >= 0.62;
    if (focusable) {
      const affinityAmount = clamp((bolt.affinity - 0.62) / 0.38, 0, 1);
      const focusEase = 1 - Math.exp(-localElapsed * pull * (8.5 + affinityAmount * 5.5));
      angle = wrapAngle(angle + shortestAngleDelta(angle, contact.angle) * focusEase);
      latitude = clamp(
        latitude + (contact.latitude - latitude) * focusEase,
        -HALF_PI,
        HALF_PI,
      );
      velocity *= 1 - focusEase * 0.72;
    }

    const gate = staticGate(age, lifetime, bolt.seed, cycle, localClock);
    const spark = 0.7 + 0.3 * Math.abs(Math.sin(
      localClock * (19 + cycleValue(bolt.seed, cycle, 47) * 23) + phase,
    ));
    const focusEnergy = focusable ? pull * 0.09 : 0;
    const energy = clamp(0.035 + gate * (0.68 + spark * 0.27) + focusEnergy, 0, 1.2);

    return {
      id: bolt.id,
      angle,
      latitude,
      targetAngle,
      targetLatitude,
      velocity: clamp(velocity, -20, 20),
      phase: wrapAngle(phase),
      energy,
      seed: bolt.seed,
      age: clamp(age, 0, lifetime),
      lifetime,
      cycle,
      gate,
      affinity: bolt.affinity,
      rate: bolt.rate,
    };
  });
}

function scale3(point, amount) {
  return { x: point.x * amount, y: point.y * amount, z: point.z * amount };
}

function add3(...points) {
  return points.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y,
    z: sum.z + point.z,
  }), { x: 0, y: 0, z: 0 });
}

function normalize3(point, fallback = { x: 1, y: 0, z: 0 }) {
  const length = Math.hypot(point.x, point.y, point.z);
  return length < 1e-9 ? { ...fallback } : scale3(point, 1 / length);
}

function containInSphere(point, radius) {
  const length = Math.hypot(point.x, point.y, point.z);
  return length <= radius || length < 1e-9 ? point : scale3(point, radius / length);
}

function boltBasis(bolt) {
  const angle = wrapAngle(bolt?.angle);
  const latitude = clamp(bolt?.latitude, -HALF_PI, HALF_PI);
  return {
    radial: sphericalDirection(angle, latitude),
    azimuth: { x: -Math.sin(angle), y: 0, z: Math.cos(angle) },
    elevation: {
      x: -Math.sin(latitude) * Math.cos(angle),
      y: Math.cos(latitude),
      z: -Math.sin(latitude) * Math.sin(angle),
    },
  };
}

function pointAlongBolt(bolt, amount, radius, time, jitter, basis) {
  const progress = clamp(amount, 0, 1);
  const inner = radius * 0.105;
  const radialDistance = inner + (radius - inner) * progress;
  const taper = Math.sin(Math.PI * progress) ** 0.72;
  const seed = Number(bolt?.seed) || 1;
  const phase = Number(bolt?.phase) || 0;
  const cycle = Number(bolt?.cycle) || 0;
  const high = Math.sin(progress * 43.7 + seed * 8.31 + time * 13.2 + phase + cycle * 1.7);
  const middle = Math.sin(progress * 21.1 + seed * 3.77 - time * 8.6 + cycle * 0.41);
  const cross = Math.sin(progress * 31.9 - seed * 5.17 + time * 10.4 - phase * 0.53);
  const amplitude = radius * 0.052 * jitter * taper;
  return add3(
    scale3(basis.radial, radialDistance),
    scale3(basis.azimuth, (high * 0.68 + middle * 0.32) * amplitude),
    scale3(basis.elevation, (cross * 0.72 - middle * 0.28) * amplitude * 0.82),
  );
}

/** Build a jagged three-dimensional trunk and deterministic forked branches. */
export function plasmaBoltPath(bolt, {
  radius = 1,
  time = 0,
  jitter = PLASMA_DEFAULTS.jitter,
  branching = PLASMA_DEFAULTS.branching,
  segments = 18,
} = {}) {
  const safeRadius = Math.max(1e-6, Number(radius) || 1);
  const clock = Number.isFinite(Number(time)) ? Number(time) : 0;
  const jaggedness = clamp(jitter, 0, 1.5);
  const branchAmount = clamp(branching, 0, 1);
  const count = Math.round(clamp(segments, 8, 36));
  const basis = boltBasis(bolt);
  const intrinsicRate = Number.isFinite(Number(bolt?.rate))
    ? clamp(bolt.rate, 0.08, 4)
    : 1;
  const boltAge = Number(bolt?.age);
  // Stepped bolts use their accumulated local age, which carries the speed
  // slider into the visible crawl. Ad-hoc bolts still animate from wall time.
  const pathClock = Number.isFinite(boltAge)
    ? boltAge + (Number(bolt?.cycle) || 0) * 0.173
    : clock * intrinsicRate;
  const trunk = Array.from({ length: count + 1 }, (_, index) => (
    pointAlongBolt(bolt, index / count, safeRadius, pathClock, jaggedness, basis)
  ));
  // The discharge must touch the glass exactly, even with a heavily jagged trunk.
  trunk[trunk.length - 1] = scale3(basis.radial, safeRadius);

  const seed = Number(bolt?.seed) || 1;
  const cycle = Number(bolt?.cycle) || 0;
  const possible = Math.round(1 + branchAmount * 6);
  const branches = [];
  for (let branchIndex = 0; branchIndex < possible; branchIndex += 1) {
    const chance = cycleValue(seed + branchIndex * 0.31, cycle, 53 + branchIndex);
    if (chance > 0.16 + branchAmount * 0.84) continue;
    const position = 0.25 + cycleValue(seed, cycle, 61 + branchIndex) * 0.5;
    const startIndex = Math.round(position * count);
    const start = trunk[startIndex];
    const side = signedHash(seed * 29.1 + cycle * 13.7 + branchIndex * 17.3);
    const lift = signedHash(seed * 47.7 + cycle * 31.1 + branchIndex * 7.9);
    const direction = normalize3(add3(
      scale3(basis.azimuth, side),
      scale3(basis.elevation, lift),
      scale3(basis.radial, 0.22 + chance * 0.24),
    ));
    const branchLength = safeRadius * (0.065 + branchAmount * 0.095) * (0.72 + chance * 0.42);
    const branchSteps = 4 + Math.floor(cycleValue(seed, cycle, 73 + branchIndex) * 3);
    const points = [{ ...start }];
    for (let step = 1; step <= branchSteps; step += 1) {
      const progress = step / branchSteps;
      const crooked = Math.sin(
        step * 8.71 + pathClock * 11.3 + seed * 4.9 + branchIndex * 2.7,
      ) * safeRadius * 0.01 * jaggedness * Math.sin(Math.PI * progress);
      const point = add3(
        start,
        scale3(direction, branchLength * progress),
        scale3(basis.elevation, crooked),
        scale3(basis.azimuth, crooked * 0.61 * side),
      );
      points.push(containInSphere(point, safeRadius * 0.992));
    }
    branches.push(points);
  }

  return { trunk, branches };
}

/** Map every gated discharge to a quiet, unquantized, depth-aware voice. */
export function plasmaVoiceSpecs(bolts, {
  pointer = null,
  radius = 1,
  waveform = "triangle",
} = {}) {
  if (!Array.isArray(bolts)) return [];
  const contact = sphericalCoordinates(pointer);
  const safeRadius = Math.max(1e-6, Number(radius) || 1);
  const safeWaveform = /^(?:sine|triangle|sawtooth|square)$/.test(waveform)
    ? waveform
    : "triangle";
  return bolts.map((source, index) => {
    const bolt = safeBolt(source, index);
    const direction = sphericalDirection(bolt.angle, bolt.latitude);
    const depth = clamp(direction.z / Math.min(1, safeRadius), -1, 1);
    const gate = clamp(bolt.gate, 0, 1);
    const energy = clamp(bolt.energy, 0, 1.2);
    const focusDelta = contact && bolt.affinity >= 0.62
      ? Math.hypot(
        shortestAngleDelta(bolt.angle, contact.angle) / Math.PI,
        (bolt.latitude - contact.latitude) / Math.PI,
      )
      : 1;
    const focus = contact ? 1 - clamp(focusDelta, 0, 1) : 0;
    const distanceGain = 0.72 + (depth + 1) * 0.11;
    const gain = gate <= 0.015
      ? 0
      : clamp(gate ** 1.8 * energy * 0.021 * distanceGain * (0.94 + focus * 0.06), 0, 0.055);
    return {
      key: `plasma-${bolt.id ?? index}`,
      // Both angle terms meet at the azimuth seam, preserving continuous free pitch.
      pitch01: clamp(
        0.5
          - 0.34 * Math.sin(bolt.angle)
          + 0.13 * Math.sin(bolt.latitude)
          + 0.025 * Math.sin(bolt.angle * 2) * Math.cos(bolt.latitude),
        0,
        1,
      ),
      gain,
      pan: clamp(direction.x * (0.68 + Math.max(0, depth) * 0.18), -1, 1),
      waveform: safeWaveform,
      depth,
    };
  });
}
