/**
 * Deterministic flocking and snakeskin-to-string mapping for Boidzoid.
 *
 * Positions live on a normalized torus. Velocities are normalized-height
 * units per second; `aspect` converts horizontal motion into the same visual
 * metric as vertical motion. The module has no DOM or audio side effects.
 */

import { clamp, lerp, mulberry32, wrap } from "./physics-common.js";

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

export const BOIDZOID_SCALES = Object.freeze({
  dorian: Object.freeze([0, 2, 3, 5, 7, 9, 10]),
  major: Object.freeze([0, 2, 4, 5, 7, 9, 11]),
  minor: Object.freeze([0, 2, 3, 5, 7, 8, 10]),
  pentatonic: Object.freeze([0, 3, 5, 7, 10]),
  minorPentatonic: Object.freeze([0, 3, 5, 7, 10]),
  majorPentatonic: Object.freeze([0, 2, 4, 7, 9]),
  wholeTone: Object.freeze([0, 2, 4, 6, 8, 10]),
  pelog: Object.freeze([0, 1, 3, 7, 8]),
  chromatic: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
});

export const BOIDZOID_DEFAULTS = Object.freeze({
  count: 18,
  seed: 0xb01d201d,
  rows: 13,
  columns: 11,
  aspect: 1,
  perceptionRadius: 0.19,
  separationRadius: 0.055,
  alignment: 0.72,
  cohesion: 0.42,
  separation: 1.15,
  wander: 0.055,
  minSpeed: 0.065,
  maxSpeed: 0.18,
  maxForce: 0.5,
  pointerRadius: 0.34,
  pointerStrength: 0.7,
  crossingCooldown: 0.12,
});

export const BOIDZOID_VOICE_DEFAULTS = Object.freeze({
  rootMidi: 38,
  octaves: 3,
  scale: "dorian",
  decay: 1.25,
  damping: 0.5,
  brightness: 0.62,
  body: 0.42,
  level: 0.62,
  seed: BOIDZOID_DEFAULTS.seed,
});

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  return Math.round(clamp(finiteOr(value, fallback), minimum, maximum));
}

function mixUint32(value) {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

/** Turn numeric or textual seeds into a stable unsigned 32-bit value. */
export function boidzoidSeed(value = BOIDZOID_DEFAULTS.seed) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0;
  const text = String(value ?? "boidzoid");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashUnit(seed, index) {
  return mixUint32(boidzoidSeed(seed) ^ Math.imul((index + 1) >>> 0, 0x9e3779b1))
    / 4_294_967_296;
}

/**
 * Shortest signed displacement on a periodic axis.
 * Exact half-period ties preserve their sign, which keeps pair forces equal
 * and opposite.
 */
export function minimumImage(displacement, period = 1) {
  const size = Math.abs(finiteOr(period, 1));
  if (size < EPSILON) return 0;
  let result = finiteOr(displacement, 0) % size;
  const half = size / 2;
  if (result > half) result -= size;
  else if (result < -half) result += size;
  return Object.is(result, -0) ? 0 : result;
}

/** Sanitize flock, surface, and crossing parameters into stable bounds. */
export function sanitizeBoidzoidSettings(source = {}) {
  const settings = source && typeof source === "object" ? source : {};
  const minSpeed = clamp(
    finiteOr(settings.minSpeed, BOIDZOID_DEFAULTS.minSpeed),
    0.005,
    0.8,
  );
  const maxSpeed = clamp(
    finiteOr(settings.maxSpeed, BOIDZOID_DEFAULTS.maxSpeed),
    minSpeed,
    1.2,
  );
  const perceptionRadius = clamp(
    finiteOr(settings.perceptionRadius, BOIDZOID_DEFAULTS.perceptionRadius),
    0.01,
    1,
  );
  return {
    count: boundedInteger(settings.count, BOIDZOID_DEFAULTS.count, 1, 64),
    seed: boidzoidSeed(settings.seed ?? BOIDZOID_DEFAULTS.seed),
    rows: boundedInteger(settings.rows, BOIDZOID_DEFAULTS.rows, 2, 48),
    columns: boundedInteger(settings.columns, BOIDZOID_DEFAULTS.columns, 2, 48),
    aspect: clamp(finiteOr(settings.aspect, BOIDZOID_DEFAULTS.aspect), 0.25, 4),
    perceptionRadius,
    separationRadius: clamp(
      finiteOr(settings.separationRadius, BOIDZOID_DEFAULTS.separationRadius),
      0.005,
      perceptionRadius,
    ),
    alignment: clamp(finiteOr(settings.alignment, BOIDZOID_DEFAULTS.alignment), 0, 4),
    cohesion: clamp(finiteOr(settings.cohesion, BOIDZOID_DEFAULTS.cohesion), 0, 4),
    separation: clamp(finiteOr(settings.separation, BOIDZOID_DEFAULTS.separation), 0, 4),
    wander: clamp(finiteOr(settings.wander, BOIDZOID_DEFAULTS.wander), 0, 1),
    minSpeed,
    maxSpeed,
    maxForce: clamp(finiteOr(settings.maxForce, BOIDZOID_DEFAULTS.maxForce), 0.01, 4),
    pointerRadius: clamp(
      finiteOr(settings.pointerRadius, BOIDZOID_DEFAULTS.pointerRadius),
      0.01,
      2,
    ),
    pointerStrength: clamp(
      finiteOr(settings.pointerStrength, BOIDZOID_DEFAULTS.pointerStrength),
      0,
      4,
    ),
    crossingCooldown: clamp(
      finiteOr(settings.crossingCooldown, BOIDZOID_DEFAULTS.crossingCooldown),
      0,
      2,
    ),
  };
}

/**
 * Locate a point in the staggered snakeskin lattice.
 *
 * Odd rows are shifted by half a cell. Returned centers are normalized and
 * wrapped in X, making the drawing and crossing map seamless at both edges.
 */
export function skinCellAt(x, y, source = {}) {
  const rows = boundedInteger(source?.rows, BOIDZOID_DEFAULTS.rows, 2, 48);
  const columns = boundedInteger(source?.columns, BOIDZOID_DEFAULTS.columns, 2, 48);
  const wrappedX = wrap(finiteOr(x, 0), 1);
  const wrappedY = wrap(finiteOr(y, 0), 1);
  const scaledY = wrappedY * rows;
  const row = Math.min(rows - 1, Math.floor(scaledY));
  const stagger = row % 2 === 1 ? 0.5 : 0;
  const scaledX = wrappedX * columns - stagger;
  const unwrappedColumn = Math.floor(scaledX);
  const column = wrap(unwrappedColumn, columns);
  return {
    id: row * columns + column,
    row,
    column,
    rows,
    columns,
    localX: scaledX - unwrappedColumn,
    localY: scaledY - row,
    centerX: wrap((column + 0.5 + stagger) / columns, 1),
    centerY: (row + 0.5) / rows,
  };
}

function setBoidCell(boid, cell) {
  boid.cellId = cell.id;
  boid.cellRow = cell.row;
  boid.cellColumn = cell.column;
  boid.skinRows = cell.rows;
  boid.skinColumns = cell.columns;
}

/** Create a well-spaced, deterministic flock for a numeric or textual seed. */
export function createFlock(source = {}) {
  const settings = sanitizeBoidzoidSettings(source);
  const random = mulberry32(settings.seed);
  const sharedHeading = random() * TAU;
  const goldenFraction = (Math.sqrt(5) - 1) / 2;

  return Array.from({ length: settings.count }, (_, index) => {
    const x = wrap((index + 0.2 + random() * 0.6) / settings.count, 1);
    const y = wrap(index * goldenFraction + random() * 0.12, 1);
    const angle = sharedHeading + (random() - 0.5) * 1.35;
    const speed = lerp(settings.minSpeed, settings.maxSpeed, 0.2 + random() * 0.58);
    const cell = skinCellAt(x, y, settings);
    return {
      id: index,
      x,
      y,
      vx: Math.cos(angle) * speed / settings.aspect,
      vy: Math.sin(angle) * speed,
      phase: random() * TAU,
      cooldown: 0,
      cellId: cell.id,
      cellRow: cell.row,
      cellColumn: cell.column,
      skinRows: cell.rows,
      skinColumns: cell.columns,
    };
  });
}

function repairBoid(boid, index, settings) {
  boid.id = Number.isInteger(boid.id) ? boid.id : index;
  boid.x = wrap(finiteOr(boid.x, hashUnit(settings.seed, index * 2)), 1);
  boid.y = wrap(finiteOr(boid.y, hashUnit(settings.seed, index * 2 + 1)), 1);
  boid.vx = finiteOr(boid.vx, 0);
  boid.vy = finiteOr(boid.vy, 0);
  boid.phase = wrap(finiteOr(boid.phase, hashUnit(settings.seed, index + 91) * TAU), TAU);
  boid.cooldown = Math.max(0, finiteOr(boid.cooldown, 0));

  let physicalX = boid.vx * settings.aspect;
  let physicalY = boid.vy;
  let speed = Math.hypot(physicalX, physicalY);
  if (speed < EPSILON) {
    const angle = hashUnit(settings.seed, boid.id + 313) * TAU;
    physicalX = Math.cos(angle) * settings.minSpeed;
    physicalY = Math.sin(angle) * settings.minSpeed;
    speed = settings.minSpeed;
  }
  const boundedSpeed = clamp(speed, settings.minSpeed, settings.maxSpeed);
  physicalX *= boundedSpeed / speed;
  physicalY *= boundedSpeed / speed;
  boid.vx = physicalX / settings.aspect;
  boid.vy = physicalY;
}

function steeringToward(x, y, velocityX, velocityY, maxSpeed) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < EPSILON) return [0, 0];
  return [x / magnitude * maxSpeed - velocityX, y / magnitude * maxSpeed - velocityY];
}

function collectAttractors(source) {
  const attractors = Array.isArray(source?.attractors) ? [...source.attractors] : [];
  if (source?.pointer && source.pointer.active !== false) attractors.push(source.pointer);
  return attractors;
}

/**
 * Advance a flock in place and return the newly crossed snakeskin ridges.
 *
 * `source.attractors` may contain `{x, y, strength, radius, mode}` values.
 * Negative strength, or `mode: "repel"`, pushes boids away. Force calculation
 * is completed for the whole flock before any position is integrated, so the
 * result is independent of mutation order.
 */
export function stepFlock(flock, deltaSeconds, source = {}) {
  if (!Array.isArray(flock) || flock.length === 0) return [];
  const settings = sanitizeBoidzoidSettings({ ...source, count: flock.length });
  const dt = clamp(finiteOr(deltaSeconds, 0), 0, 0.05);
  const count = flock.length;
  const accelerationX = new Float64Array(count);
  const accelerationY = new Float64Array(count);
  const perceptionSquared = settings.perceptionRadius ** 2;
  const separationSquared = settings.separationRadius ** 2;
  const attractors = collectAttractors(source);

  for (let index = 0; index < count; index += 1) {
    if (!flock[index] || typeof flock[index] !== "object") flock[index] = {};
    repairBoid(flock[index], index, settings);
  }

  for (let index = 0; index < count; index += 1) {
    const boid = flock[index];
    const velocityX = boid.vx * settings.aspect;
    const velocityY = boid.vy;
    let alignmentX = 0;
    let alignmentY = 0;
    let cohesionX = 0;
    let cohesionY = 0;
    let separationX = 0;
    let separationY = 0;
    let neighborCount = 0;
    let separationCount = 0;

    for (let otherIndex = 0; otherIndex < count; otherIndex += 1) {
      if (otherIndex === index) continue;
      const other = flock[otherIndex];
      const deltaX = minimumImage(other.x - boid.x) * settings.aspect;
      const deltaY = minimumImage(other.y - boid.y);
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared > perceptionSquared || distanceSquared < EPSILON) continue;

      neighborCount += 1;
      alignmentX += other.vx * settings.aspect;
      alignmentY += other.vy;
      cohesionX += deltaX;
      cohesionY += deltaY;

      if (distanceSquared <= separationSquared) {
        const inverseDistanceSquared = 1 / Math.max(distanceSquared, 1e-6);
        separationX -= deltaX * inverseDistanceSquared;
        separationY -= deltaY * inverseDistanceSquared;
        separationCount += 1;
      }
    }

    let forceX = 0;
    let forceY = 0;
    if (neighborCount > 0) {
      const alignment = steeringToward(
        alignmentX / neighborCount,
        alignmentY / neighborCount,
        velocityX,
        velocityY,
        settings.maxSpeed,
      );
      const cohesion = steeringToward(
        cohesionX / neighborCount,
        cohesionY / neighborCount,
        velocityX,
        velocityY,
        settings.maxSpeed,
      );
      forceX += alignment[0] * settings.alignment + cohesion[0] * settings.cohesion;
      forceY += alignment[1] * settings.alignment + cohesion[1] * settings.cohesion;
    }
    if (separationCount > 0) {
      const separation = steeringToward(
        separationX / separationCount,
        separationY / separationCount,
        velocityX,
        velocityY,
        settings.maxSpeed,
      );
      forceX += separation[0] * settings.separation;
      forceY += separation[1] * settings.separation;
    }

    for (let attractorIndex = 0; attractorIndex < attractors.length; attractorIndex += 1) {
      const attractor = attractors[attractorIndex];
      if (!attractor || attractor.active === false) continue;
      let deltaX = minimumImage(finiteOr(attractor.x, boid.x) - boid.x) * settings.aspect;
      let deltaY = minimumImage(finiteOr(attractor.y, boid.y) - boid.y);
      let distance = Math.hypot(deltaX, deltaY);
      const radius = clamp(
        finiteOr(attractor.radius, settings.pointerRadius),
        0.01,
        2,
      );
      if (distance >= radius) continue;
      if (distance < EPSILON) {
        const angle = hashUnit(settings.seed, boid.id + attractorIndex * 131) * TAU;
        deltaX = Math.cos(angle);
        deltaY = Math.sin(angle);
        distance = 1;
      }
      const requestedStrength = clamp(Math.abs(finiteOr(attractor.strength, 1)), 0, 4);
      const direction = attractor.mode === "repel" || finiteOr(attractor.strength, 1) < 0 ? -1 : 1;
      const falloff = (1 - Math.min(1, distance / radius)) ** 2;
      const amount = settings.pointerStrength * requestedStrength * direction * falloff;
      forceX += deltaX / distance * amount;
      forceY += deltaY / distance * amount;
    }

    const speed = Math.max(EPSILON, Math.hypot(velocityX, velocityY));
    const wobble = Math.sin(boid.phase) * settings.wander;
    forceX += -velocityY / speed * wobble;
    forceY += velocityX / speed * wobble;

    const forceMagnitude = Math.hypot(forceX, forceY);
    if (forceMagnitude > settings.maxForce) {
      forceX *= settings.maxForce / forceMagnitude;
      forceY *= settings.maxForce / forceMagnitude;
    }
    accelerationX[index] = forceX;
    accelerationY[index] = forceY;
  }

  const crossings = [];
  for (let index = 0; index < count; index += 1) {
    const boid = flock[index];
    let velocityX = boid.vx * settings.aspect + accelerationX[index] * dt;
    let velocityY = boid.vy + accelerationY[index] * dt;
    let speed = Math.hypot(velocityX, velocityY);
    if (speed < EPSILON) {
      velocityX = Math.cos(boid.phase) * settings.minSpeed;
      velocityY = Math.sin(boid.phase) * settings.minSpeed;
      speed = settings.minSpeed;
    }
    const boundedSpeed = clamp(speed, settings.minSpeed, settings.maxSpeed);
    velocityX *= boundedSpeed / speed;
    velocityY *= boundedSpeed / speed;
    boid.vx = velocityX / settings.aspect;
    boid.vy = velocityY;
    boid.x = wrap(boid.x + boid.vx * dt, 1);
    boid.y = wrap(boid.y + boid.vy * dt, 1);
    boid.phase = wrap(boid.phase + dt * (1.25 + boid.id * 0.017), TAU);
    boid.cooldown = Math.max(0, boid.cooldown - dt);

    const nextCell = skinCellAt(boid.x, boid.y, settings);
    const topologyMatches = boid.skinRows === settings.rows
      && boid.skinColumns === settings.columns
      && Number.isInteger(boid.cellId);
    const previous = {
      id: boid.cellId,
      row: boid.cellRow,
      column: boid.cellColumn,
    };
    setBoidCell(boid, nextCell);

    if (!topologyMatches || previous.id === nextCell.id || boid.cooldown > 0) continue;
    const energy = clamp(
      (boundedSpeed - settings.minSpeed)
        / Math.max(EPSILON, settings.maxSpeed - settings.minSpeed),
    );
    crossings.push({
      boidId: boid.id,
      fromCellId: previous.id,
      fromRow: previous.row,
      fromColumn: previous.column,
      cellId: nextCell.id,
      row: nextCell.row,
      column: nextCell.column,
      rows: nextCell.rows,
      columns: nextCell.columns,
      x: boid.x,
      y: boid.y,
      vx: boid.vx,
      vy: boid.vy,
      speed: boundedSpeed,
      energy,
    });
    boid.cooldown = settings.crossingCooldown;
  }

  return crossings;
}

/** Resolve a scale name or custom pitch-class array into safe ascending steps. */
export function resolveBoidzoidScale(source = BOIDZOID_VOICE_DEFAULTS.scale) {
  if (typeof source === "string") {
    const key = source === "whole-tone" ? "wholeTone" : source;
    return [...(BOIDZOID_SCALES[key] ?? BOIDZOID_SCALES.dorian)];
  }
  if (!Array.isArray(source)) return [...BOIDZOID_SCALES.dorian];
  const intervals = [...new Set(source
    .map((value) => Math.round(finiteOr(value, -1)))
    .filter((value) => value >= 0 && value <= 11))]
    .sort((left, right) => left - right);
  return intervals.length > 0 ? intervals : [...BOIDZOID_SCALES.dorian];
}

function midiFrequency(note) {
  return 440 * (2 ** ((note - 69) / 12));
}

/**
 * Map a ridge-crossing event to a complete KarplusStrongAudio pluck recipe.
 *
 * Callers can use `audio.pluck(recipe.frequency, recipe.settings,
 * { velocity: recipe.velocity, pan: recipe.pan })`.
 */
export function mapCrossingToVoice(crossing = {}, source = {}) {
  const options = source && typeof source === "object" ? source : {};
  const scale = resolveBoidzoidScale(options.scale ?? BOIDZOID_VOICE_DEFAULTS.scale);
  const rootMidi = boundedInteger(options.rootMidi, BOIDZOID_VOICE_DEFAULTS.rootMidi, 0, 108);
  const octaves = boundedInteger(options.octaves, BOIDZOID_VOICE_DEFAULTS.octaves, 1, 6);
  const rows = boundedInteger(crossing.rows ?? options.rows, BOIDZOID_DEFAULTS.rows, 2, 48);
  const columns = boundedInteger(
    crossing.columns ?? options.columns,
    BOIDZOID_DEFAULTS.columns,
    2,
    48,
  );
  const row = boundedInteger(crossing.row, rows - 1, 0, rows - 1);
  const column = boundedInteger(crossing.column, 0, 0, columns - 1);
  const vertical = 1 - row / Math.max(1, rows - 1);
  const degree = Math.round(vertical * octaves * scale.length);
  const semitones = Math.floor(degree / scale.length) * 12 + scale[degree % scale.length];
  const midi = boundedInteger(rootMidi + semitones, rootMidi, 0, 127);
  const cellId = boundedInteger(crossing.cellId, row * columns + column, 0, rows * columns - 1);
  const variation = hashUnit(options.seed ?? BOIDZOID_VOICE_DEFAULTS.seed, cellId);
  const columnAmount = column / Math.max(1, columns - 1);
  const minSpeed = clamp(finiteOr(options.minSpeed, BOIDZOID_DEFAULTS.minSpeed), 0.005, 0.8);
  const maxSpeed = clamp(finiteOr(options.maxSpeed, BOIDZOID_DEFAULTS.maxSpeed), minSpeed, 1.2);
  const eventSpeed = Math.max(0, finiteOr(
    crossing.speed,
    Math.hypot(finiteOr(crossing.vx, 0), finiteOr(crossing.vy, 0)),
  ));
  const energy = Number.isFinite(Number(crossing.energy))
    ? clamp(Number(crossing.energy))
    : clamp((eventSpeed - minSpeed) / Math.max(EPSILON, maxSpeed - minSpeed));
  const aspect = clamp(finiteOr(options.aspect, BOIDZOID_DEFAULTS.aspect), 0.25, 4);
  const headingX = finiteOr(crossing.vx, 0) * aspect;
  const headingY = finiteOr(crossing.vy, 0);
  const headingMagnitude = Math.hypot(headingX, headingY);
  const pan = headingMagnitude > EPSILON
    ? clamp(headingX / headingMagnitude, -1, 1)
    : clamp(finiteOr(crossing.x, 0.5) * 2 - 1, -1, 1);

  const baseDecay = clamp(finiteOr(options.decay, BOIDZOID_VOICE_DEFAULTS.decay), 0.25, 3.5);
  const baseDamping = clamp(finiteOr(options.damping, BOIDZOID_VOICE_DEFAULTS.damping));
  const baseBrightness = clamp(finiteOr(options.brightness, BOIDZOID_VOICE_DEFAULTS.brightness));
  const baseBody = clamp(finiteOr(options.body, BOIDZOID_VOICE_DEFAULTS.body));
  const level = clamp(finiteOr(options.level, BOIDZOID_VOICE_DEFAULTS.level), 0, 0.85);

  return {
    frequency: midiFrequency(midi),
    midi,
    degree,
    pitchClass: midi % 12,
    velocity: lerp(0.18, 0.78, energy),
    pan,
    settings: {
      decay: clamp(baseDecay * lerp(0.84, 1.16, variation), 0.25, 3.5),
      damping: clamp(baseDamping + (0.5 - columnAmount) * 0.48 - energy * 0.06),
      brightness: clamp(baseBrightness + (columnAmount - 0.5) * 0.54 + energy * 0.12),
      hardness: lerp(0.3, 0.9, energy),
      excitationColor: clamp(0.52 + columnAmount * 0.32),
      excitationShape: lerp(0.08, 0.2, variation),
      burstLength: lerp(0.5, 0.92, 1 - energy),
      pickPosition: lerp(0.12, 0.82, columnAmount),
      pickWidth: lerp(0.78, 0.6, energy),
      detune: (variation - 0.5) * 4,
      dispersion: lerp(0.08, 0.28, variation),
      polarity: 1,
      lowCut: lerp(0.18, 0.08, columnAmount),
      drive: lerp(0.04, 0.2, energy),
      chorusDepth: lerp(0.015, 0.07, variation),
      chorusRate: lerp(0.2, 0.7, variation),
      roughness: lerp(0.005, 0.035, energy),
      pickupPosition: lerp(0.76, 0.34, columnAmount),
      pickupMix: lerp(0.16, 0.36, variation),
      body: clamp(baseBody + (variation - 0.5) * 0.2),
      bodyTune: lerp(1.7, 3.1, variation),
      bodyQ: lerp(2.7, 5.8, variation),
      coupling: 0,
      couplingRatio: 2,
      couplingDetune: 0,
      spread: 1,
      level,
    },
  };
}
