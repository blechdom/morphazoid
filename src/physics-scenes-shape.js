/**
 * The four shape-first geometric physics scenes.
 *
 * Every factory is deterministic: randomness is avoided, simulation work happens
 * only in step(), and drawing only reads the current model state. Coordinates are
 * the model-space coordinates used by createPainter() (+X right, +Y up).
 */

import {
  TAU,
  PHYSICS_COLORS,
  add,
  clamp,
  closestPointOnSegment,
  closestPointOnPolyline,
  cross,
  distance,
  dot,
  length,
  lerp,
  makeEventQueue,
  measurePolyline,
  normalize,
  normalizedVoice,
  perpendicular,
  pointInPolygon,
  pointAtDistance,
  polygonArea,
  polygonEdges,
  polygonSignedArea,
  rangeControl,
  regularPolygon,
  rotate,
  scale,
  selectControl,
  sub,
  wrap,
} from "./physics-common.js";

const EPSILON = 1e-9;

function finiteStep(dt) {
  return clamp(Number(dt), 0, 1 / 30);
}

function radians(degrees) {
  return Number(degrees) * Math.PI / 180;
}

function roundTo(value, places = 3) {
  const power = 10 ** places;
  return Math.round(value * power) / power;
}

function clampMagnitude(vector, maximum) {
  const magnitude = length(vector);
  return magnitude > maximum ? scale(vector, maximum / magnitude) : vector;
}

function coerceControl(controls, key, value) {
  const control = controls.find((candidate) => candidate.key === key);
  if (!control) return undefined;
  if (control.type === "select") {
    const values = control.options.map((option) => String(option?.value ?? option));
    const index = values.indexOf(String(value));
    return index < 0 ? control.value : (control.options[index]?.value ?? control.options[index]);
  }
  if (control.type === "toggle") return Boolean(value);
  const number = clamp(Number(value), Number(control.min), Number(control.max));
  return Number(control.step) >= 1 ? Math.round(number) : number;
}

function transient(key, pitch01, gain, pan, waveform = "triangle", extras = {}) {
  return {
    ...normalizedVoice({ key, pitch01, gain, pan, waveform }),
    attackSeconds: extras.attackSeconds ?? 0.003,
    decaySeconds: extras.decaySeconds ?? 0.14,
    attackNoise: extras.attackNoise ?? 0,
  };
}

function cyclicDelta(next, previous, period) {
  let delta = next - previous;
  if (delta > period / 2) delta -= period;
  if (delta < -period / 2) delta += period;
  return delta;
}

function pointBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------------------
// Gravity Walk

const GRAVITY_DEFAULTS = Object.freeze({
  sides: 5,
  roundness: 0.18,
  rotation: 0,
  gravity: 1.35,
  gravityAngle: 0,
  drag: 0.12,
  kick: 1.15,
});

function morphedPolygon(sides, roundness, rotation, radius = 0.72, samplesPerSide = 18) {
  const points = [];
  const sector = TAU / sides;
  const pose = radians(rotation);
  for (let side = 0; side < sides; side += 1) {
    const angleA = Math.PI / 2 + side * sector;
    const angleB = angleA + sector;
    const a = { x: Math.cos(angleA) * radius, y: Math.sin(angleA) * radius };
    const b = { x: Math.cos(angleB) * radius, y: Math.sin(angleB) * radius };
    for (let sample = 0; sample < samplesPerSide; sample += 1) {
      const t = sample / samplesPerSide;
      const chord = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
      const angle = lerp(angleA, angleB, t);
      const arc = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      points.push(rotate({
        x: lerp(chord.x, arc.x, roundness),
        y: lerp(chord.y, arc.y, roundness),
      }, pose));
    }
  }
  return points;
}

function createGravityWalk() {
  const controls = Object.freeze([
    rangeControl("sides", "Sides", 3, 12, 1, GRAVITY_DEFAULTS.sides),
    rangeControl("roundness", "Roundness", 0, 1, 0.01, GRAVITY_DEFAULTS.roundness, (v) => Number(v).toFixed(2)),
    rangeControl("rotation", "Shape angle", -180, 180, 1, GRAVITY_DEFAULTS.rotation, (v) => `${Math.round(v)}°`),
    rangeControl("gravity", "Gravity", 0, 3, 0.01, GRAVITY_DEFAULTS.gravity, (v) => Number(v).toFixed(2)),
    rangeControl("gravityAngle", "Gravity angle", -180, 180, 1, GRAVITY_DEFAULTS.gravityAngle, (v) => `${Math.round(v)}°`),
    rangeControl("drag", "Drag", 0, 1.5, 0.01, GRAVITY_DEFAULTS.drag, (v) => Number(v).toFixed(2)),
    rangeControl("kick", "Kick strength", 0.1, 3, 0.05, GRAVITY_DEFAULTS.kick, (v) => Number(v).toFixed(2)),
  ]);
  const state = { ...GRAVITY_DEFAULTS };
  const events = makeEventQueue();
  const samplesPerSide = 18;
  let path = measurePolyline(morphedPolygon(state.sides, state.roundness, state.rotation), true);
  let pathBounds = pointBounds(path.points);
  let beadDistance = 0;
  let beadVelocity = 0;
  let cornerGlow = 0;
  let lastSector = 0;
  let dragging = false;
  let dragDistance = 0;
  let dragVelocity = 0;
  let dragTime = 0;
  let trail = [];
  let trailClock = 0;

  const gravityDirection = () => {
    const angle = radians(state.gravityAngle);
    return { x: Math.sin(angle), y: -Math.cos(angle) };
  };
  const bead = () => pointAtDistance(path, beadDistance);
  const height = (point) => -dot(point, gravityDirection());
  const heightRange = () => {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const point of path.points) {
      const value = height(point);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    return { minimum, maximum, span: Math.max(EPSILON, maximum - minimum) };
  };
  const height01 = (point) => {
    const range = heightRange();
    return clamp((height(point) - range.minimum) / range.span);
  };
  const speedReference = () => Math.max(0.25, Math.sqrt(2 * Math.max(0.05, state.gravity) * heightRange().span));
  const accelerationAt = (requestedDistance) => {
    const sample = pointAtDistance(path, requestedDistance);
    return state.gravity * dot(gravityDirection(), sample.tangent);
  };

  function placeAtHighPoint() {
    let bestIndex = 0;
    let bestHeight = -Infinity;
    path.points.forEach((point, index) => {
      const candidate = height(point);
      if (candidate > bestHeight) {
        bestHeight = candidate;
        bestIndex = index;
      }
    });
    beadDistance = wrap(path.cumulative[bestIndex] + path.total * 0.009, path.total);
    beadVelocity = 0;
    lastSector = Math.floor(pointAtDistance(path, beadDistance).edgeIndex / samplesPerSide);
    trail = [bead()];
  }

  function rebuildPath(preserve = true) {
    const oldPoint = path?.edges?.length ? bead() : null;
    const oldVelocity = oldPoint ? scale(oldPoint.tangent, beadVelocity) : null;
    path = measurePolyline(
      morphedPolygon(Math.round(state.sides), state.roundness, state.rotation, 0.72, samplesPerSide),
      true,
    );
    pathBounds = pointBounds(path.points);
    if (preserve && oldPoint) {
      const nearest = closestPointOnPolyline(oldPoint, path);
      beadDistance = nearest?.pathDistance ?? 0;
      beadVelocity = oldVelocity ? dot(oldVelocity, nearest?.tangent ?? { x: 1, y: 0 }) : 0;
      lastSector = Math.floor((nearest?.edgeIndex ?? 0) / samplesPerSide);
      trail = [bead()];
    } else {
      placeAtHighPoint();
    }
  }

  function reset() {
    Object.assign(state, GRAVITY_DEFAULTS);
    events.clear();
    cornerGlow = 0;
    dragging = false;
    dragVelocity = 0;
    dragTime = 0;
    trailClock = 0;
    rebuildPath(false);
  }

  function setParam(key, value) {
    const next = coerceControl(controls, key, value);
    if (next === undefined) return;
    state[key] = next;
    if (["sides", "roundness", "rotation"].includes(key)) rebuildPath(true);
  }

  function step(dt) {
    const h = finiteStep(dt);
    if (h <= 0) return;
    cornerGlow *= Math.exp(-h / 0.11);
    if (dragging || path.total <= EPSILON) return;

    const oldSample = bead();
    const halfVelocity = beadVelocity + 0.5 * accelerationAt(beadDistance) * h;
    beadDistance = wrap(beadDistance + halfVelocity * h, path.total);
    beadVelocity = halfVelocity + 0.5 * accelerationAt(beadDistance) * h;
    beadVelocity *= Math.exp(-state.drag * h);
    beadVelocity = clamp(beadVelocity, -5, 5);

    const current = bead();
    const sector = Math.floor(current.edgeIndex / samplesPerSide);
    if (sector !== lastSector) {
      const speed01 = clamp(Math.abs(beadVelocity) / speedReference());
      const sharpness = 1 - state.roundness;
      cornerGlow = Math.max(cornerGlow, sharpness * (0.25 + 0.75 * speed01));
      if (sharpness > 0.01) {
        events.push(transient(
          `corner-${sector}`,
          height01(current),
          sharpness * (0.18 + 0.62 * speed01),
          clamp(current.x / 0.72, -1, 1),
          "triangle",
          { decaySeconds: 0.1 + 0.1 * sharpness, attackNoise: 0.08 * speed01 * sharpness },
        ));
      }
      lastSector = sector;
    }

    trailClock += h;
    if (trailClock >= 1 / 60 || distance(oldSample, current) > 0.025) {
      trailClock = 0;
      trail.push({ x: current.x, y: current.y });
      if (trail.length > 52) trail.shift();
    }
  }

  function draw(painter) {
    const current = bead();
    trail.forEach((point, index) => {
      const amount = (index + 1) / Math.max(1, trail.length);
      painter.circle(point, 0.005 + 0.009 * amount, {
        color: PHYSICS_COLORS.brass,
        fill: PHYSICS_COLORS.brass,
        width: 0,
        alpha: 0.04 + 0.22 * amount * amount,
      });
    });
    painter.polyline(path.points, {
      close: true,
      color: PHYSICS_COLORS.brass,
      width: 1.6,
      fill: "rgba(232,196,107,0.025)",
    });
    for (let side = 0; side < state.sides; side += 1) {
      painter.circle(path.points[side * samplesPerSide], 0.009, {
        color: PHYSICS_COLORS.brass,
        fill: PHYSICS_COLORS.background,
        width: 1,
        alpha: 0.52 * (1 - state.roundness) + 0.12,
      });
    }
    const direction = gravityDirection();
    const arrowStart = { x: 0.72, y: 0.68 };
    const arrowEnd = add(arrowStart, scale(direction, 0.22));
    painter.arrow(arrowStart, arrowEnd, { color: PHYSICS_COLORS.muted, width: 1.1, alpha: 0.85 });
    painter.text("g", add(arrowEnd, scale(direction, 0.05)), { color: PHYSICS_COLORS.muted, size: 9 });
    painter.circle(current, 0.025 + 0.012 * cornerGlow, {
      color: PHYSICS_COLORS.point,
      fill: PHYSICS_COLORS.brass,
      width: 1.4,
    });
    const velocityTip = add(current, scale(current.tangent, clamp(beadVelocity * 0.075, -0.22, 0.22)));
    if (Math.abs(beadVelocity) > 0.04) {
      painter.arrow(current, velocityTip, { color: PHYSICS_COLORS.point, width: 1, alpha: 0.68, headLength: 0.028 });
    }
  }

  function voices() {
    const current = bead();
    const potential = height01(current);
    const speed01 = clamp(Math.abs(beadVelocity) / speedReference());
    const kinetic = clamp((beadVelocity * beadVelocity) / (speedReference() ** 2));
    const pan = clamp((current.x - pathBounds.minX) / Math.max(EPSILON, pathBounds.maxX - pathBounds.minX) * 2 - 1, -1, 1);
    return [
      normalizedVoice({
        key: "potential",
        pitch01: potential,
        gain: 0.09 + 0.23 * Math.sqrt(speed01) + 0.16 * cornerGlow,
        pan,
        waveform: "sine",
      }),
      normalizedVoice({
        key: "kinetic",
        pitch01: kinetic,
        gain: 0.02 + 0.22 * Math.sqrt(kinetic),
        pan: clamp(pan * 0.72, -1, 1),
        waveform: "triangle",
      }),
    ];
  }

  function metrics() {
    const current = bead();
    const kinetic = clamp((beadVelocity * beadVelocity) / (speedReference() ** 2));
    return [
      ["State", dragging ? "held" : Math.abs(beadVelocity) < 0.018 ? "resting" : "moving"],
      ["Speed", roundTo(Math.abs(beadVelocity))],
      ["Potential", `${Math.round(height01(current) * 100)}%`],
      ["Kinetic", `${Math.round(kinetic * 100)}%`],
    ];
  }

  function pointerDown(point) {
    const nearest = closestPointOnPolyline(point, path);
    if (!nearest || nearest.distance > 0.18) return;
    dragging = true;
    beadDistance = nearest.pathDistance;
    beadVelocity = 0;
    dragVelocity = 0;
    dragDistance = beadDistance;
    dragTime = Number(point.time) || 0;
    trail = [bead()];
  }

  function pointerMove(point) {
    if (!dragging) return;
    const nearest = closestPointOnPolyline(point, path);
    if (!nearest) return;
    const now = Number(point.time) || dragTime + 1 / 60;
    const elapsed = clamp(now - dragTime, 1 / 240, 0.1);
    const instantaneous = cyclicDelta(nearest.pathDistance, dragDistance, path.total) / elapsed;
    dragVelocity = lerp(dragVelocity, clamp(instantaneous, -5, 5), 0.38);
    dragDistance = nearest.pathDistance;
    dragTime = now;
    beadDistance = nearest.pathDistance;
    lastSector = Math.floor(nearest.edgeIndex / samplesPerSide);
  }

  function pointerUp(point) {
    if (!dragging) return;
    pointerMove(point);
    dragging = false;
    beadVelocity = dragVelocity;
  }

  function primaryAction() {
    const direction = beadVelocity < -0.02 ? -1 : 1;
    beadVelocity += direction * state.kick;
    const current = bead();
    events.push(transient("kick", height01(current), 0.52, clamp(current.x / 0.72, -1, 1), "triangle", {
      attackSeconds: 0.002,
      decaySeconds: 0.18,
      attackNoise: 0.1,
    }));
  }

  reset();

  return {
    id: "gravity-walk",
    title: "Gravity Walk",
    kicker: "Physics · 01 · Contour-constrained dynamics",
    description: "A point falls around a closed contour. Shape becomes an energy landscape.",
    instruction: "Drag the bead around the contour and release it, or use Kick to add tangent velocity.",
    lesson: "Gravity is projected onto the contour tangent, exchanging potential and kinetic energy until drag selects a stable low point.",
    color: PHYSICS_COLORS.brass,
    mappings: [["Height", "pitch"], ["Speed", "kinetic voice level"], ["Corner crossing", "accent"], ["Horizontal position", "stereo"]],
    controls,
    state,
    reset,
    setParam,
    step,
    draw,
    voices,
    consumeEvents: () => events.drain(),
    metrics,
    pointerDown,
    pointerMove,
    pointerUp,
    primaryActionLabel: "Kick",
    primaryAction,
  };
}

// ---------------------------------------------------------------------------
// Ricochet

const RICOCHET_DEFAULTS = Object.freeze({
  preset: "regular",
  sides: 6,
  rotation: 0,
  rotationSpeed: 0,
  launchVelocity: 0.78,
  launchAngle: 27,
  restitution: 1,
  trail: 120,
});

const RICOCHET_PRESETS = Object.freeze([
  Object.freeze({ value: "regular", label: "Regular polygon" }),
  Object.freeze({ value: "asymmetric", label: "Asymmetric chamber" }),
  Object.freeze({ value: "star", label: "Irregular star" }),
  Object.freeze({ value: "tunnel", label: "Bent tunnel" }),
]);

function ricochetPresetPoints(preset, sides) {
  const count = Math.max(3, Math.min(12, Math.round(sides)));
  if (preset === "tunnel") {
    // One simple concave polygon whose interior is a bent, unequal-width channel.
    return [
      { x: -0.78, y: -0.7 },
      { x: 0.78, y: -0.7 },
      { x: 0.78, y: 0.68 },
      { x: 0.36, y: 0.68 },
      { x: 0.36, y: -0.2 },
      { x: -0.25, y: -0.2 },
      { x: -0.25, y: 0.34 },
      { x: -0.78, y: 0.34 },
    ];
  }
  if (preset === "star") {
    return regularPolygon(count, {
      radius: 0.76,
      rotation: Math.PI / 2,
      starDepth: 0.47,
    }).map((point, index) => {
      const skew = 1 + 0.055 * Math.sin(index * 1.73 + 0.4);
      return { x: point.x * skew, y: point.y * (2 - skew) };
    });
  }
  if (preset === "asymmetric") {
    return regularPolygon(count, { radius: 0.71, rotation: Math.PI / 2 }).map((point, index) => {
      const radial = 1 + 0.12 * Math.sin(index * 1.91 + 0.35)
        + 0.045 * Math.cos(index * 2.63 - 0.2);
      return {
        x: point.x * radial + 0.035 * Math.sin(index * 1.37),
        y: point.y * radial + 0.025 * Math.cos(index * 2.11),
      };
    });
  }
  return regularPolygon(count, { radius: 0.76, rotation: Math.PI / 2 });
}

function ricochetSegmentsCross(a, b, c, d) {
  const ab = sub(b, a);
  const cd = sub(d, c);
  const first = cross(ab, sub(c, a));
  const second = cross(ab, sub(d, a));
  const third = cross(cd, sub(a, c));
  const fourth = cross(cd, sub(b, c));
  return first * second < -1e-9 && third * fourth < -1e-9;
}

function validRicochetPolygon(points, minimumEdge = 0.065) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 32) return false;
  if (Math.abs(polygonSignedArea(points)) < 0.055) return false;
  const edges = polygonEdges(points);
  if (edges.some((edge) => distance(edge.a, edge.b) < minimumEdge)) return false;
  for (let first = 0; first < edges.length; first += 1) {
    for (let second = first + 1; second < edges.length; second += 1) {
      if (second === first + 1 || (first === 0 && second === edges.length - 1)) continue;
      if (ricochetSegmentsCross(edges[first].a, edges[first].b, edges[second].a, edges[second].b)) {
        return false;
      }
    }
  }
  return true;
}

function createRicochet() {
  const controls = Object.freeze([
    selectControl("preset", "Arena preset", RICOCHET_PRESETS, RICOCHET_DEFAULTS.preset),
    rangeControl("sides", "Sides / star tips", 3, 12, 1, RICOCHET_DEFAULTS.sides),
    rangeControl("rotation", "Arena angle", -180, 180, 1, RICOCHET_DEFAULTS.rotation, (v) => `${Math.round(v)}°`),
    rangeControl("rotationSpeed", "Rotation speed", -120, 120, 1, RICOCHET_DEFAULTS.rotationSpeed, (v) => `${Math.round(v)}°/s`),
    rangeControl("launchVelocity", "Launch velocity", 0.15, 4, 0.01, RICOCHET_DEFAULTS.launchVelocity, (v) => Number(v).toFixed(2)),
    rangeControl("launchAngle", "Launch angle", -180, 180, 1, RICOCHET_DEFAULTS.launchAngle, (v) => `${Math.round(v)}°`),
    rangeControl("restitution", "Reflection", 0.55, 1, 0.01, RICOCHET_DEFAULTS.restitution, (v) => Number(v).toFixed(2)),
    rangeControl("trail", "Trail", 24, 240, 1, RICOCHET_DEFAULTS.trail),
  ]);
  const state = { ...RICOCHET_DEFAULTS };
  const events = makeEventQueue();
  const ballRadius = 0.025;
  const maximumBalls = 12;
  let localPolygon = [];
  let arenaAngle = 0;
  let balls = [];
  let nextBallId = 1;
  let collisionCount = 0;
  let lastEdge = -1;
  let lastIncidence = 0;
  let impactGlow = 0;
  let lastImpact = null;
  let interaction = null;
  let geometryEdited = false;

  const worldPolygon = () => localPolygon.map((point) => rotate(point, arenaAngle));

  function arenaWalls(points = worldPolygon()) {
    const orientation = polygonSignedArea(points) < 0 ? -1 : 1;
    return polygonEdges(points).map((edge) => {
      const tangent = normalize(sub(edge.b, edge.a));
      return {
        ...edge,
        tangent,
        length: distance(edge.a, edge.b),
        inward: scale(perpendicular(tangent), orientation),
      };
    });
  }

  function nearestBoundary(point, walls) {
    let best = null;
    for (const wall of walls) {
      const candidate = closestPointOnSegment(point, wall.a, wall.b);
      if (!best || candidate.distance < best.distance) best = { ...candidate, wall };
    }
    return best;
  }

  function isSafePosition(point, points = worldPolygon(), walls = arenaWalls(points), margin = ballRadius) {
    if (!pointInPolygon(point, points)) return false;
    const nearest = nearestBoundary(point, walls);
    return Boolean(nearest && nearest.distance >= margin - 1e-6);
  }

  function safeSpawnPoint(preferred = null) {
    const points = worldPolygon();
    const walls = arenaWalls(points);
    const candidates = [];
    if (preferred) candidates.push(preferred);
    candidates.push(
      state.preset === "tunnel" ? { x: -0.53, y: 0.02 } : { x: -0.18, y: 0.08 },
      { x: 0, y: 0 },
    );
    for (let row = 0; row < 13; row += 1) {
      for (let column = 0; column < 15; column += 1) {
        candidates.push({ x: -0.7 + column * 0.1, y: -0.6 + row * 0.1 });
      }
    }
    return candidates.find((candidate) => (
      isSafePosition(candidate, points, walls, ballRadius * 1.35)
      && balls.every((ball) => distance(candidate, ball.position) > ballRadius * 2.6)
    )) ?? candidates.find((candidate) => isSafePosition(candidate, points, walls, ballRadius * 1.1))
      ?? { x: 0, y: -0.42 };
  }

  function makeBall(position, angle, speed) {
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    return {
      id: nextBallId++,
      position: { ...position },
      velocity: scale(direction, speed),
      trail: [{ ...position }],
      trailClock: 0,
      impactGlow: 0,
      aiming: false,
    };
  }

  function spawnBall({ position = null, angle = null, speed = null, emit = true } = {}) {
    if (balls.length >= maximumBalls) return null;
    const spawnIndex = balls.length;
    const launchAngle = angle ?? radians(state.launchAngle + spawnIndex * 17);
    const launchSpeed = speed ?? state.launchVelocity;
    const ball = makeBall(safeSpawnPoint(position), launchAngle, launchSpeed);
    balls.push(ball);
    if (emit) {
      events.push(transient(
        `launch-${ball.id}`,
        clamp((ball.position.y + 0.8) / 1.6),
        0.18 + 0.12 * clamp(launchSpeed / 4),
        clamp(ball.position.x / 0.8, -1, 1),
        "sine",
        { decaySeconds: 0.08 },
      ));
    }
    return ball;
  }

  function resetDynamics() {
    balls = [];
    nextBallId = 1;
    collisionCount = 0;
    lastEdge = -1;
    lastIncidence = 0;
    impactGlow = 0;
    lastImpact = null;
    interaction = null;
    events.clear();
    spawnBall({ position: { x: -0.18, y: 0.08 }, angle: radians(state.launchAngle), emit: false });
  }

  function orientArena(points) {
    return polygonSignedArea(points) < 0 ? [...points].reverse() : points;
  }

  function rebuildArena(preserveDynamics = true) {
    localPolygon = orientArena(ricochetPresetPoints(state.preset, state.sides));
    geometryEdited = false;
    if (!preserveDynamics) {
      resetDynamics();
      return;
    }
    repairBallsAfterEdit();
  }

  function reset() {
    Object.assign(state, RICOCHET_DEFAULTS);
    arenaAngle = radians(state.rotation);
    rebuildArena(false);
  }

  function setParam(key, value) {
    const next = coerceControl(controls, key, value);
    if (next === undefined) return;
    state[key] = next;
    if (key === "preset" || key === "sides") rebuildArena(true);
    else if (key === "rotation") {
      arenaAngle = radians(state.rotation);
      repairBallsAfterEdit();
    } else if (key === "launchVelocity" && balls.length === 1 && collisionCount === 0) {
      const ball = balls[0];
      if (!ball.aiming && length(ball.velocity) > EPSILON) {
        ball.velocity = scale(normalize(ball.velocity), state.launchVelocity);
      }
    }
  }

  function wallVelocityAt(point, angularVelocity) {
    return scale(perpendicular(point), angularVelocity);
  }

  function registerImpact(ball, point, normal, wall, incomingVelocity, angularVelocity) {
    const wallVelocity = wallVelocityAt(point, angularVelocity);
    const relativeVelocity = sub(incomingVelocity, wallVelocity);
    const impactSpeed = length(relativeVelocity);
    const approach = clamp(-dot(normalize(relativeVelocity), normal));
    lastIncidence = Math.acos(approach) * 180 / Math.PI;
    lastEdge = wall.index;
    lastImpact = { point: { ...point }, normal: { ...normal }, ballId: ball.id };
    const energy = clamp(impactSpeed / 3.2);
    impactGlow = Math.max(impactGlow, 0.25 + 0.75 * energy);
    ball.impactGlow = Math.max(ball.impactGlow, 0.3 + 0.7 * energy);
    collisionCount += 1;
    events.push(transient(
      `tine-${wall.index}`,
      clamp(lastIncidence / 90),
      0.08 + 0.82 * energy,
      clamp(point.x / 0.8, -1, 1),
      "triangle",
      {
        decaySeconds: clamp(0.055 + 0.16 * wall.length / 0.8, 0.065, 0.3),
        attackNoise: 0.035 + 0.055 * energy,
      },
    ));
  }

  function reflectBall(ball, contact, normal, angularVelocity) {
    const wallVelocity = wallVelocityAt(contact.point, angularVelocity);
    const relative = sub(ball.velocity, wallVelocity);
    const normalSpeed = dot(relative, normal);
    if (normalSpeed >= -1e-7) return false;
    const incoming = { ...ball.velocity };
    const reflected = sub(relative, scale(normal, (1 + state.restitution) * normalSpeed));
    ball.velocity = clampMagnitude(add(wallVelocity, reflected), 6);
    registerImpact(ball, contact.point, normal, contact.wall, incoming, angularVelocity);
    return true;
  }

  function inwardContactNormal(contact, safePoint, points) {
    let normal = normalize(sub(safePoint, contact.point), contact.wall.inward);
    if (dot(normal, contact.wall.inward) < 0.1) normal = contact.wall.inward;
    if (!pointInPolygon(add(contact.point, scale(normal, ballRadius * 1.2)), points)) {
      normal = contact.wall.inward;
    }
    return normal;
  }

  function relocateBall(ball, preferred = ball.position) {
    const position = safeSpawnPoint(preferred);
    ball.position = { ...position };
    ball.trail = [{ ...position }];
    ball.trailClock = 0;
  }

  function containBall(ball, points, walls, angularVelocity, soundContact = true) {
    if (isSafePosition(ball.position, points, walls)) return true;
    const contact = nearestBoundary(ball.position, walls);
    if (!contact) {
      relocateBall(ball);
      return false;
    }
    const wasInside = pointInPolygon(ball.position, points);
    const normal = wasInside
      ? inwardContactNormal(contact, ball.position, points)
      : contact.wall.inward;
    const corrected = add(contact.point, scale(normal, ballRadius + 2e-5));
    if (!isSafePosition(corrected, points, walls, ballRadius * 0.98)) {
      relocateBall(ball);
      return false;
    }
    if (soundContact) reflectBall(ball, contact, normal, angularVelocity);
    ball.position = corrected;
    return true;
  }

  function integrateBall(ball, dt, points, walls, angularVelocity) {
    if (ball.aiming || length(ball.velocity) <= EPSILON) {
      containBall(ball, points, walls, angularVelocity, false);
      return;
    }
    if (!containBall(ball, points, walls, angularVelocity, true)) return;

    let remaining = dt;
    let contacts = 0;
    while (remaining > 1e-8 && contacts < 5) {
      const start = { ...ball.position };
      const target = add(start, scale(ball.velocity, remaining));
      if (isSafePosition(target, points, walls)) {
        ball.position = target;
        remaining = 0;
        break;
      }

      let safeAmount = 0;
      let unsafeAmount = 1;
      for (let iteration = 0; iteration < 15; iteration += 1) {
        const amount = (safeAmount + unsafeAmount) / 2;
        const candidate = add(start, scale(ball.velocity, remaining * amount));
        if (isSafePosition(candidate, points, walls)) safeAmount = amount;
        else unsafeAmount = amount;
      }
      const safePoint = add(start, scale(ball.velocity, remaining * safeAmount));
      const unsafePoint = add(start, scale(ball.velocity, remaining * unsafeAmount));
      const contact = nearestBoundary(unsafePoint, walls);
      if (!contact) {
        relocateBall(ball, start);
        return;
      }
      const normal = inwardContactNormal(contact, safePoint, points);
      ball.position = add(contact.point, scale(normal, ballRadius + 2e-5));
      if (!isSafePosition(ball.position, points, walls, ballRadius * 0.98)) {
        ball.position = safePoint;
      }
      const reflected = reflectBall(ball, contact, normal, angularVelocity);
      remaining *= 1 - safeAmount;
      contacts += 1;
      if (!reflected || safeAmount < 1e-5) remaining *= 0.5;
    }
    if (contacts >= 5 && remaining > 0) ball.velocity = scale(ball.velocity, 0.985);
    containBall(ball, points, walls, angularVelocity, false);
  }

  function repairBallsAfterEdit() {
    const points = worldPolygon();
    const walls = arenaWalls(points);
    for (const ball of balls) {
      if (!isSafePosition(ball.position, points, walls)) relocateBall(ball);
    }
  }

  function step(dt) {
    const h = finiteStep(dt);
    if (h <= 0) return;
    impactGlow *= Math.exp(-h / 0.1);
    for (const ball of balls) ball.impactGlow *= Math.exp(-h / 0.085);

    const angularVelocity = radians(state.rotationSpeed);
    const fastest = balls.reduce((maximum, ball) => Math.max(maximum, length(ball.velocity)), 0);
    const projectedTravel = (fastest + Math.abs(angularVelocity) * 0.9) * h;
    const substeps = Math.max(1, Math.min(12, Math.ceil(projectedTravel / (ballRadius * 0.42))));
    const substep = h / substeps;
    for (let index = 0; index < substeps; index += 1) {
      arenaAngle = wrap(arenaAngle + angularVelocity * substep + Math.PI, TAU) - Math.PI;
      const points = worldPolygon();
      const walls = arenaWalls(points);
      for (const ball of balls) integrateBall(ball, substep, points, walls, angularVelocity);
    }

    for (const ball of balls) {
      ball.trailClock += h;
      if (ball.trailClock >= 1 / 90) {
        ball.trailClock = 0;
        ball.trail.push({ ...ball.position });
        while (ball.trail.length > state.trail) ball.trail.shift();
      }
    }
  }

  function draw(painter) {
    const polygon = worldPolygon();
    const currentWalls = arenaWalls(polygon);
    for (const ball of balls) {
      ball.trail.forEach((point, index) => {
        const amount = (index + 1) / Math.max(1, ball.trail.length);
        painter.circle(point, 0.0025 + 0.0045 * amount, {
          color: PHYSICS_COLORS.blue,
          fill: PHYSICS_COLORS.blue,
          width: 0,
          alpha: 0.018 + 0.15 * amount * amount,
        });
      });
    }
    painter.polyline(polygon, {
      close: true,
      color: PHYSICS_COLORS.blue,
      width: 1.6,
      fill: "rgba(125,180,255,0.025)",
    });
    currentWalls.forEach((wall) => {
      const active = wall.index === lastEdge ? impactGlow : 0;
      painter.line(wall.a, wall.b, {
        color: active > 0.05 ? PHYSICS_COLORS.point : PHYSICS_COLORS.blue,
        width: 1.15 + 2.3 * active,
        alpha: 0.64 + 0.34 * active,
      });
      const midpoint = scale(add(wall.a, wall.b), 0.5);
      if (polygon.length <= 16) {
        painter.circle(midpoint, 0.013, {
          color: PHYSICS_COLORS.muted,
          fill: PHYSICS_COLORS.background,
          width: 1,
          alpha: 0.78,
        });
        painter.text("+", midpoint, { color: PHYSICS_COLORS.point, size: 8, alpha: 0.76 });
      } else {
        painter.circle(midpoint, 0.006, { color: PHYSICS_COLORS.faint, fill: PHYSICS_COLORS.background, width: 1, alpha: 0.42 });
      }
    });
    polygon.forEach((point, index) => {
      const active = interaction?.type === "vertex" && interaction.index === index;
      painter.circle(point, active ? 0.027 : 0.018, {
        color: active ? PHYSICS_COLORS.point : PHYSICS_COLORS.blue,
        fill: PHYSICS_COLORS.background,
        width: active ? 1.7 : 1.1,
        alpha: 0.9,
      });
    });
    if (lastImpact) {
      painter.arrow(lastImpact.point, add(lastImpact.point, scale(lastImpact.normal, 0.14)), {
        color: PHYSICS_COLORS.coral,
        width: 1,
        alpha: 0.25 + 0.65 * impactGlow,
        headLength: 0.026,
      });
    }
    if (interaction?.type === "aim") {
      const ball = balls.find((candidate) => candidate.id === interaction.ballId);
      if (ball) {
        painter.arrow(ball.position, interaction.aimPoint, {
          color: PHYSICS_COLORS.point,
          width: 1,
          alpha: 0.78,
          dash: [4, 4],
          headLength: 0.035,
        });
      }
    }
    for (const ball of balls) {
      painter.circle(ball.position, ballRadius + 0.009 * ball.impactGlow, {
        color: PHYSICS_COLORS.point,
        fill: PHYSICS_COLORS.blue,
        width: 1.35,
      });
    }
  }

  function voices() {
    return balls.map((ball) => normalizedVoice({
      key: `flight-${ball.id}`,
      pitch01: clamp((ball.position.y + 0.8) / 1.6),
      gain: ball.aiming ? 0.012 : 0.018 + 0.016 * clamp(length(ball.velocity) / 4),
      pan: clamp(ball.position.x / 0.8, -1, 1),
      waveform: "sine",
    }));
  }

  function metrics() {
    const fastest = balls.reduce((maximum, ball) => Math.max(maximum, length(ball.velocity)), 0);
    return [
      ["Collisions", collisionCount],
      ["Balls", balls.length],
      ["Fastest", roundTo(fastest)],
      ["Incidence", lastEdge < 0 ? "—" : `${roundTo(lastIncidence, 1)}°`],
      ["Vertices", localPolygon.length],
      ["Arena", `${state.preset}${geometryEdited ? " · edited" : ""}`],
    ];
  }

  function pointerDown(point) {
    const polygon = worldPolygon();
    const currentWalls = arenaWalls(polygon);
    let nearestVertex = { index: -1, distance: Infinity };
    polygon.forEach((vertex, index) => {
      const candidateDistance = distance(point, vertex);
      if (candidateDistance < nearestVertex.distance) nearestVertex = { index, distance: candidateDistance };
    });
    if (nearestVertex.distance <= 0.065) {
      interaction = { type: "vertex", index: nearestVertex.index };
      return;
    }

    const edge = nearestBoundary(point, currentWalls);
    if (edge && edge.distance <= 0.045 && localPolygon.length < 32) {
      const localPoint = rotate(edge.point, -arenaAngle);
      const nextPolygon = [...localPolygon];
      nextPolygon.splice(edge.wall.index + 1, 0, localPoint);
      if (validRicochetPolygon(nextPolygon)) {
        localPolygon = nextPolygon;
        geometryEdited = true;
        interaction = { type: "vertex", index: edge.wall.index + 1 };
        repairBallsAfterEdit();
        return;
      }
    }

    if (!isSafePosition(point, polygon, currentWalls, ballRadius * 1.05)) return;
    if (balls.some((ball) => distance(point, ball.position) < ballRadius * 2.8)) return;
    const ball = spawnBall({ position: point, angle: 0, speed: 0, emit: false });
    if (!ball) return;
    ball.aiming = true;
    interaction = { type: "aim", ballId: ball.id, origin: { ...ball.position }, aimPoint: { ...point } };
  }

  function pointerMove(point) {
    if (interaction?.type === "aim") {
      interaction.aimPoint = { x: point.x, y: point.y };
      return;
    }
    if (interaction?.type !== "vertex") return;
    let localPoint = rotate(point, -arenaAngle);
    const radius = length(localPoint);
    if (radius > 0.92) localPoint = scale(localPoint, 0.92 / radius);
    const nextPolygon = localPolygon.map((vertex, index) => (
      index === interaction.index ? localPoint : vertex
    ));
    if (!validRicochetPolygon(nextPolygon)) return;
    localPolygon = nextPolygon;
    geometryEdited = true;
    repairBallsAfterEdit();
  }

  function pointerUp(point) {
    if (interaction?.type === "vertex") {
      pointerMove(point);
      interaction = null;
      return false;
    }
    if (interaction?.type !== "aim") return false;
    const ball = balls.find((candidate) => candidate.id === interaction.ballId);
    if (!ball) {
      interaction = null;
      return false;
    }
    const direction = normalize(sub(point, interaction.origin), {
      x: Math.cos(radians(state.launchAngle)),
      y: Math.sin(radians(state.launchAngle)),
    });
    const dragDistance = distance(point, interaction.origin);
    const velocityScale = clamp(dragDistance / 0.48, 0.18, 1);
    const launchVelocity = state.launchVelocity * velocityScale;
    ball.velocity = scale(direction, launchVelocity);
    ball.aiming = false;
    ball.trail = [{ ...ball.position }];
    state.launchAngle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
    events.push(transient(`launch-${ball.id}`, clamp((ball.position.y + 0.8) / 1.6), 0.25, clamp(ball.position.x / 0.8, -1, 1), "sine", {
      decaySeconds: 0.09,
    }));
    interaction = null;
    return true;
  }

  function primaryAction() {
    spawnBall();
  }

  reset();

  return {
    id: "ricochet",
    title: "Ricochet",
    kicker: "Physics · 02 · Polygonal billiards",
    description: "",
    instruction: "Drag a vertex to reshape the arena. Press an edge and drag to insert a vertex. Press empty space inside to spawn a ball, drag to aim, and release to launch.",
    lesson: "Each edge acts as a struck tine: incidence angle sets continuous pitch and relative impact velocity sets amplitude. Concave and rotating boundaries reveal focusing, rapid collision trains, and moving-wall energy exchange.",
    color: PHYSICS_COLORS.blue,
    mappings: [["Incidence angle", "tine pitch"], ["Impact velocity", "amplitude"], ["Edge length", "tine decay"], ["Impact x-position", "stereo"], ["Ball position", "faint flight voice"]],
    get controls() {
      return state.preset === "tunnel"
        ? controls.filter((control) => control.key !== "sides")
        : controls;
    },
    state,
    reset,
    setParam,
    step,
    draw,
    voices,
    consumeEvents: () => events.drain(),
    metrics,
    pointerDown,
    pointerMove,
    pointerUp,
    primaryActionLabel: "Spawn ball",
    primaryAction,
  };
}

// ---------------------------------------------------------------------------
// Rigidity

const RIGIDITY_DEFAULTS = Object.freeze({
  structure: "square",
  load: 1.15,
  loadAngle: 12,
  flexibility: 0.16,
  damping: 1.4,
});

const STRUCTURES = Object.freeze({
  triangle: {
    points: [[-0.42, 0.5], [0.42, 0.5], [0, -0.28]],
    pins: [0, 1],
    bars: [[0, 1], [1, 2], [2, 0]],
    outline: [0, 1, 2],
    mechanism: "rigid",
  },
  square: {
    points: [[-0.4, 0.5], [0.4, 0.5], [0.4, -0.3], [-0.4, -0.3]],
    pins: [0, 1],
    bars: [[0, 1], [1, 2], [2, 3], [3, 0]],
    outline: [0, 1, 2, 3],
    mechanism: "1 shear mode",
  },
  braced: {
    points: [[-0.4, 0.5], [0.4, 0.5], [0.4, -0.3], [-0.4, -0.3]],
    pins: [0, 1],
    bars: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
    outline: [0, 1, 2, 3],
    mechanism: "rigid",
  },
  truss: {
    points: [[-0.7, 0.5], [0, 0.5], [0.7, 0.5], [-0.35, -0.25], [0.35, -0.25]],
    pins: [0, 2],
    bars: [[0, 1], [1, 2], [0, 3], [3, 1], [1, 4], [4, 2], [3, 4]],
    outline: [0, 2, 4, 3],
    mechanism: "rigid truss",
  },
});

function createRigidity() {
  const controls = Object.freeze([
    selectControl("structure", "Framework", [
      { value: "square", label: "Square" },
      { value: "braced", label: "Braced square" },
      { value: "triangle", label: "Triangle" },
      { value: "truss", label: "Two-bay truss" },
    ], RIGIDITY_DEFAULTS.structure),
    rangeControl("load", "Load", 0, 3, 0.01, RIGIDITY_DEFAULTS.load, (v) => Number(v).toFixed(2)),
    rangeControl("loadAngle", "Load angle", -45, 45, 1, RIGIDITY_DEFAULTS.loadAngle, (v) => `${Math.round(v)}°`),
    rangeControl("flexibility", "Joint flexibility", 0, 1, 0.01, RIGIDITY_DEFAULTS.flexibility, (v) => Number(v).toFixed(2)),
    rangeControl("damping", "Damping", 0, 5, 0.05, RIGIDITY_DEFAULTS.damping, (v) => Number(v).toFixed(2)),
  ]);
  const state = { ...RIGIDITY_DEFAULTS };
  const events = makeEventQueue();
  let nodes = [];
  let bars = [];
  let outline = [];
  let restArea = 1;
  let draggedNode = -1;
  let dragTarget = null;
  let maxError = 0;
  let peakForce = 0;

  function definition() {
    return STRUCTURES[state.structure] ?? STRUCTURES.square;
  }

  function resetDynamics() {
    const model = definition();
    const pins = new Set(model.pins);
    nodes = model.points.map(([x, y], id) => ({
      id,
      p: { x, y },
      rest: { x, y },
      v: { x: 0, y: 0 },
      pinned: pins.has(id),
      stress: 0,
    }));
    bars = model.bars.map(([a, b], id) => ({
      id,
      a,
      b,
      restLength: distance(nodes[a].p, nodes[b].p),
      lambda: 0,
      error: 0,
    }));
    outline = [...model.outline];
    restArea = Math.max(EPSILON, polygonArea(outline.map((id) => nodes[id].p)));
    draggedNode = -1;
    dragTarget = null;
    maxError = 0;
    peakForce = 0;
    events.clear();
  }

  function reset() {
    Object.assign(state, RIGIDITY_DEFAULTS);
    resetDynamics();
  }

  function setParam(key, value) {
    const next = coerceControl(controls, key, value);
    if (next === undefined) return;
    state[key] = next;
    if (key === "structure") resetDynamics();
  }

  function inverseMass(node) {
    return node.pinned || node.id === draggedNode ? 0 : 1;
  }

  function step(dt) {
    const h = finiteStep(dt);
    if (h <= 0) return;
    const angle = radians(state.loadAngle);
    const acceleration = { x: Math.sin(angle) * state.load, y: -Math.cos(angle) * state.load };
    const oldPositions = nodes.map((node) => ({ ...node.p }));

    for (const node of nodes) {
      if (node.pinned) {
        node.p = { ...node.rest };
        node.v = { x: 0, y: 0 };
      } else if (node.id === draggedNode && dragTarget) {
        node.p = { ...dragTarget };
        node.v = { x: 0, y: 0 };
      } else {
        node.v = add(node.v, scale(acceleration, h));
        node.v = scale(node.v, Math.exp(-state.damping * h));
        node.v = clampMagnitude(node.v, 4);
        node.p = add(node.p, scale(node.v, h));
      }
      node.stress = 0;
    }

    bars.forEach((bar) => { bar.lambda = 0; });
    const compliance = state.flexibility ** 3 * 0.0015;
    const alpha = compliance / Math.max(EPSILON, h * h);
    for (let iteration = 0; iteration < 10; iteration += 1) {
      for (const bar of bars) {
        const left = nodes[bar.a];
        const right = nodes[bar.b];
        const delta = sub(right.p, left.p);
        const currentLength = Math.max(EPSILON, length(delta));
        const direction = scale(delta, 1 / currentLength);
        const error = currentLength - bar.restLength;
        const leftWeight = inverseMass(left);
        const rightWeight = inverseMass(right);
        const denominator = leftWeight + rightWeight + alpha;
        if (denominator <= EPSILON) continue;
        const deltaLambda = (-error - alpha * bar.lambda) / denominator;
        bar.lambda += deltaLambda;
        left.p = add(left.p, scale(direction, -leftWeight * deltaLambda));
        right.p = add(right.p, scale(direction, rightWeight * deltaLambda));
      }
      for (const node of nodes) {
        if (node.pinned) node.p = { ...node.rest };
        else if (node.id === draggedNode && dragTarget) node.p = { ...dragTarget };
      }
    }

    maxError = 0;
    peakForce = 0;
    for (const bar of bars) {
      const currentLength = distance(nodes[bar.a].p, nodes[bar.b].p);
      bar.error = (currentLength - bar.restLength) / Math.max(EPSILON, bar.restLength);
      const force = Math.abs(bar.lambda) / Math.max(EPSILON, h * h);
      peakForce = Math.max(peakForce, force);
      maxError = Math.max(maxError, Math.abs(bar.error));
      const stress = clamp(force / Math.max(0.2, state.load * 4));
      nodes[bar.a].stress = Math.max(nodes[bar.a].stress, stress);
      nodes[bar.b].stress = Math.max(nodes[bar.b].stress, stress);
    }

    for (const node of nodes) {
      if (node.pinned || node.id === draggedNode) {
        node.v = { x: 0, y: 0 };
      } else {
        node.v = clampMagnitude(scale(sub(node.p, oldPositions[node.id]), 1 / h), 4);
      }
      if (!Number.isFinite(node.p.x + node.p.y + node.v.x + node.v.y)) {
        resetDynamics();
        return;
      }
    }
  }

  function currentAreaRatio() {
    return polygonArea(outline.map((id) => nodes[id].p)) / restArea;
  }

  function draw(painter) {
    bars.forEach((bar) => {
      painter.line(nodes[bar.a].rest, nodes[bar.b].rest, {
        color: PHYSICS_COLORS.lineSoft,
        width: 1,
        dash: [4, 5],
      });
    });
    bars.forEach((bar) => {
      const intensity = clamp(Math.abs(bar.error) * 120 + Math.abs(bar.lambda) * 5);
      const color = bar.error >= 0 ? PHYSICS_COLORS.coral : PHYSICS_COLORS.blue;
      painter.line(nodes[bar.a].p, nodes[bar.b].p, {
        color,
        width: 1.4 + 2.3 * intensity,
        alpha: 0.55 + 0.42 * intensity,
      });
    });
    for (const node of nodes) {
      painter.circle(node.p, node.pinned ? 0.031 : 0.025, {
        color: node.pinned ? PHYSICS_COLORS.point : PHYSICS_COLORS.violet,
        fill: node.pinned ? PHYSICS_COLORS.background : PHYSICS_COLORS.violet,
        width: 1.5,
      });
      if (node.pinned) {
        painter.line(add(node.p, { x: -0.045, y: -0.055 }), add(node.p, { x: 0.045, y: -0.055 }), {
          color: PHYSICS_COLORS.muted,
          width: 1,
        });
      }
    }
    const angle = radians(state.loadAngle);
    const direction = { x: Math.sin(angle), y: -Math.cos(angle) };
    const start = { x: 0.72, y: 0.63 };
    painter.arrow(start, add(start, scale(direction, 0.22)), {
      color: PHYSICS_COLORS.muted,
      width: 1,
      alpha: 0.85,
      headLength: 0.035,
    });
    painter.text("load", add(start, { x: 0, y: 0.07 }), { color: PHYSICS_COLORS.muted, size: 8 });
  }

  function voices() {
    const jointVoices = nodes.map((node) => normalizedVoice({
      key: `joint-${node.id}`,
      pitch01: clamp((node.p.y + 0.7) / 1.4),
      gain: (node.pinned ? 0.045 : 0.075) + 0.12 * node.stress,
      pan: clamp(node.p.x / 0.82, -1, 1),
      waveform: node.pinned ? "sine" : "triangle",
    }));
    jointVoices.push(normalizedVoice({
      key: "area",
      pitch01: clamp(currentAreaRatio() * 0.72),
      gain: 0.055 + 0.06 * clamp(Math.abs(1 - currentAreaRatio()) * 2),
      pan: 0,
      waveform: "sine",
    }));
    return jointVoices;
  }

  function metrics() {
    return [
      ["Frame", definition().mechanism],
      ["Area", `${Math.round(currentAreaRatio() * 100)}%`],
      ["Bar error", `${(maxError * 100).toFixed(2)}%`],
      ["Constraint force", roundTo(peakForce, 2)],
    ];
  }

  function pointerDown(point) {
    let nearest = null;
    for (const node of nodes) {
      if (node.pinned) continue;
      const separation = distance(node.p, point);
      if (!nearest || separation < nearest.separation) nearest = { id: node.id, separation };
    }
    if (!nearest || nearest.separation > 0.16) return;
    draggedNode = nearest.id;
    dragTarget = { x: clamp(point.x, -0.9, 0.9), y: clamp(point.y, -0.72, 0.72) };
    nodes[draggedNode].p = { ...dragTarget };
    nodes[draggedNode].v = { x: 0, y: 0 };
  }

  function pointerMove(point) {
    if (draggedNode < 0) return;
    dragTarget = { x: clamp(point.x, -0.9, 0.9), y: clamp(point.y, -0.72, 0.72) };
    nodes[draggedNode].p = { ...dragTarget };
  }

  function pointerUp(point) {
    if (draggedNode < 0) return;
    pointerMove(point);
    const node = nodes[draggedNode];
    events.push(transient(
      `pluck-${node.id}`,
      clamp((node.p.y + 0.7) / 1.4),
      0.32 + 0.42 * node.stress,
      clamp(node.p.x / 0.82, -1, 1),
      "triangle",
      { decaySeconds: 0.22, attackNoise: 0.08 },
    ));
    draggedNode = -1;
    dragTarget = null;
  }

  function primaryAction() {
    nodes.forEach((node) => {
      if (!node.pinned) {
        const direction = node.id % 2 ? -1 : 1;
        node.v.x += direction * (0.55 + 0.08 * node.id);
        node.v.y += 0.08;
      }
    });
    events.push(transient("shake", 0.48, 0.58, 0, "sawtooth", {
      attackSeconds: 0.002,
      decaySeconds: 0.28,
      attackNoise: 0.18,
    }));
  }

  reset();

  return {
    id: "rigidity",
    title: "Rigidity",
    kicker: "Physics · 03 · Bar-and-joint frameworks",
    description: "The same lengths can define a stable structure or leave a hidden way to move.",
    instruction: "Drag a free joint, compare Square with Braced square, and use Shake to excite the frame.",
    lesson: "Triangles remove shear mechanisms. A quadrilateral can change shape without changing bar length until a diagonal brace makes it rigid.",
    color: PHYSICS_COLORS.violet,
    mappings: [["Joint height", "chord pitch"], ["Constraint force", "voice level"], ["Joint position", "stereo"], ["Enclosed area", "bass pitch"]],
    controls,
    state,
    reset,
    setParam,
    step,
    draw,
    voices,
    consumeEvents: () => events.drain(),
    metrics,
    pointerDown,
    pointerMove,
    pointerUp,
    primaryActionLabel: "Shake",
    primaryAction,
  };
}

// ---------------------------------------------------------------------------
// Rolling Measure

const ROLLING_DEFAULTS = Object.freeze({
  sides: 5,
  radius: 0.42,
  slope: 10,
  gravity: 1.25,
  drive: 0.44,
  restitution: 0.86,
  drag: 0.1,
});

function createRollingMeasure() {
  const controls = Object.freeze([
    rangeControl("sides", "Sides", 3, 12, 1, ROLLING_DEFAULTS.sides),
    rangeControl("radius", "Radius", 0.25, 0.56, 0.01, ROLLING_DEFAULTS.radius, (v) => Number(v).toFixed(2)),
    rangeControl("slope", "Slope", -25, 35, 1, ROLLING_DEFAULTS.slope, (v) => `${Math.round(v)}°`),
    rangeControl("gravity", "Gravity", 0, 3, 0.01, ROLLING_DEFAULTS.gravity, (v) => Number(v).toFixed(2)),
    rangeControl("drive", "Drive torque", -1.5, 1.5, 0.01, ROLLING_DEFAULTS.drive, (v) => Number(v).toFixed(2)),
    rangeControl("restitution", "Impact retention", 0.35, 1, 0.01, ROLLING_DEFAULTS.restitution, (v) => Number(v).toFixed(2)),
    rangeControl("drag", "Angular drag", 0, 1.5, 0.01, ROLLING_DEFAULTS.drag, (v) => Number(v).toFixed(2)),
  ]);
  const state = { ...ROLLING_DEFAULTS };
  const events = makeEventQueue();
  let phase = 0;
  let omega = 0;
  let pivotX = 0;
  let contactId = 0;
  let impactCount = 0;
  let impactGlow = 0;
  let swipeStart = null;
  let centroidTrail = [];
  let trailClock = 0;

  const beta = () => TAU / Math.round(state.sides);
  const halfSide = () => state.radius * Math.sin(Math.PI / Math.round(state.sides));
  const inradius = () => state.radius * Math.cos(Math.PI / Math.round(state.sides));
  const sideLength = () => 2 * halfSide();
  const centerRelative = (atPhase = phase) => rotate({ x: -halfSide(), y: inradius() }, -atPhase);
  const centerGround = () => add({ x: pivotX, y: 0 }, centerRelative());
  const inertiaCenter = () => state.radius ** 2 * (
    1 + 2 * Math.cos(Math.PI / Math.round(state.sides)) ** 2
  ) / 6;
  const inertiaPivot = () => inertiaCenter() + state.radius ** 2;
  const lift01 = () => clamp((centerRelative().y - inradius()) / Math.max(1e-6, state.radius - inradius()));

  function bodyVertices() {
    const count = Math.round(state.sides);
    const centerAtRest = { x: -halfSide(), y: inradius() };
    return Array.from({ length: count }, (_, index) => {
      const angle = -Math.PI / 2 + Math.PI / count + index * TAU / count;
      const local = add(centerAtRest, {
        x: Math.cos(angle) * state.radius,
        y: Math.sin(angle) * state.radius,
      });
      return add({ x: pivotX, y: 0 }, rotate(local, -phase));
    });
  }

  function sceneTransform(point, cameraX = centerGround().x) {
    const angle = radians(state.slope);
    const along = { x: Math.cos(angle), y: -Math.sin(angle) };
    const normal = { x: Math.sin(angle), y: Math.cos(angle) };
    return add(
      { x: 0, y: -0.34 },
      add(scale(along, point.x - cameraX), scale(normal, point.y)),
    );
  }

  function resetDynamics() {
    phase = 0;
    omega = 0;
    pivotX = 0;
    contactId = 0;
    impactCount = 0;
    impactGlow = 0;
    swipeStart = null;
    centroidTrail = [centerGround()];
    trailClock = 0;
    events.clear();
  }

  function reset() {
    Object.assign(state, ROLLING_DEFAULTS);
    resetDynamics();
  }

  function setParam(key, value) {
    const next = coerceControl(controls, key, value);
    if (next === undefined) return;
    state[key] = next;
    if (key === "sides" || key === "radius") resetDynamics();
  }

  function angularAcceleration(atPhase = phase, atOmega = omega) {
    const center = centerRelative(atPhase);
    const slope = radians(state.slope);
    const gravityTorque = state.gravity * (
      center.x * Math.cos(slope) + center.y * Math.sin(slope)
    );
    return (gravityTorque + state.drive - state.drag * atOmega) / Math.max(1e-6, inertiaPivot());
  }

  function impactRetention() {
    const geometric = (
      inertiaCenter() + state.radius ** 2 * Math.cos(beta())
    ) / Math.max(1e-6, inertiaPivot());
    return state.restitution * clamp(geometric, 0, 1);
  }

  function registerContact(direction, incomingOmega) {
    const count = Math.round(state.sides);
    if (direction > 0) {
      pivotX += sideLength();
      phase = 0;
      contactId = (contactId + 1) % count;
    } else {
      pivotX -= sideLength();
      phase = beta();
      contactId = (contactId - 1 + count) % count;
    }
    const retained = impactRetention();
    omega = Math.sign(incomingOmega) * Math.abs(incomingOmega) * retained;
    const loss = clamp(Math.abs(incomingOmega - omega) * state.radius / 2.2);
    impactGlow = Math.max(impactGlow, 0.25 + 0.75 * loss);
    impactCount += 1;
    events.push(transient(
      `contact-${contactId}`,
      count <= 1 ? 0.5 : contactId / (count - 1),
      0.25 + 0.68 * loss,
      direction,
      "triangle",
      { decaySeconds: 0.11 + 0.1 * loss, attackNoise: 0.12 * loss },
    ));
  }

  function shiftRestingSupport(direction) {
    const count = Math.round(state.sides);
    if (direction > 0) {
      pivotX += sideLength();
      phase = 0;
      contactId = (contactId + 1) % count;
    } else {
      pivotX -= sideLength();
      phase = beta();
      contactId = (contactId - 1 + count) % count;
    }
  }

  function step(dt) {
    let remaining = finiteStep(dt);
    if (remaining <= 0) return;
    impactGlow *= Math.exp(-remaining / 0.12);
    let transitions = 0;
    while (remaining > 1e-8 && transitions < 6) {
      const acceleration = angularAcceleration();
      const candidateOmega = clamp(omega + acceleration * remaining, -14, 14);
      const candidatePhase = phase + candidateOmega * remaining;

      // An edge resting on both adjacent vertices can support a restoring torque.
      if (phase <= 1e-8 && omega >= -1e-5 && candidatePhase < 0) {
        omega = 0;
        if (angularAcceleration(beta(), 0) < -1e-7) {
          shiftRestingSupport(-1);
          transitions += 1;
          continue;
        }
        phase = 0;
        break;
      }
      if (phase >= beta() - 1e-8 && omega <= 1e-5 && candidatePhase > beta()) {
        omega = 0;
        if (angularAcceleration(0, 0) > 1e-7) {
          shiftRestingSupport(1);
          transitions += 1;
          continue;
        }
        phase = beta();
        break;
      }

      if (candidatePhase >= 0 && candidatePhase <= beta()) {
        omega = candidateOmega;
        phase = candidatePhase;
        remaining = 0;
        break;
      }

      const direction = candidatePhase > beta() ? 1 : -1;
      const boundary = direction > 0 ? beta() : 0;
      const denominator = candidatePhase - phase;
      const fraction = Math.abs(denominator) > EPSILON
        ? clamp((boundary - phase) / denominator)
        : 1;
      const used = Math.max(1e-7, remaining * fraction);
      omega = clamp(omega + acceleration * used, -14, 14);
      phase = boundary;
      remaining = Math.max(0, remaining - used);
      registerContact(direction, omega);
      transitions += 1;
      if (Math.abs(omega) < 1e-7 && used <= 1e-7) break;
    }

    trailClock += finiteStep(dt);
    if (trailClock >= 1 / 60) {
      trailClock = 0;
      centroidTrail.push(centerGround());
      if (centroidTrail.length > 100) centroidTrail.shift();
    }
  }

  function draw(painter) {
    const cameraX = centerGround().x;
    const spacing = Math.max(0.12, sideLength());
    const firstTick = Math.floor((cameraX - 2) / spacing) * spacing;
    for (let x = firstTick; x <= cameraX + 2; x += spacing) {
      const base = sceneTransform({ x, y: 0 }, cameraX);
      const tip = sceneTransform({ x, y: -0.035 }, cameraX);
      painter.line(base, tip, { color: PHYSICS_COLORS.line, width: 1 });
    }
    painter.line(sceneTransform({ x: cameraX - 2, y: 0 }, cameraX), sceneTransform({ x: cameraX + 2, y: 0 }, cameraX), {
      color: PHYSICS_COLORS.line,
      width: 1.3,
    });
    if (centroidTrail.length > 1) {
      painter.polyline(centroidTrail.map((point) => sceneTransform(point, cameraX)), {
        color: PHYSICS_COLORS.orange,
        width: 1,
        alpha: 0.28,
      });
    }
    const vertices = bodyVertices().map((point) => sceneTransform(point, cameraX));
    painter.polyline(vertices, {
      close: true,
      color: PHYSICS_COLORS.orange,
      width: 1.8,
      fill: "rgba(255,184,107,0.055)",
    });
    const center = sceneTransform(centerGround(), cameraX);
    const pivot = sceneTransform({ x: pivotX, y: 0 }, cameraX);
    painter.line(center, pivot, { color: PHYSICS_COLORS.line, width: 1, dash: [3, 4] });
    painter.circle(center, 0.018, { color: PHYSICS_COLORS.point, fill: PHYSICS_COLORS.orange, width: 1.2 });
    painter.circle(pivot, 0.017 + 0.012 * impactGlow, {
      color: PHYSICS_COLORS.point,
      fill: PHYSICS_COLORS.background,
      width: 1.4,
    });
    painter.text(String(contactId + 1), add(pivot, { x: 0, y: -0.065 }), { color: PHYSICS_COLORS.muted, size: 8 });
  }

  function voices() {
    const phasePan = clamp(phase / Math.max(EPSILON, beta()) * 2 - 1, -1, 1);
    return [normalizedVoice({
      key: "centroid",
      pitch01: lift01(),
      gain: 0.09 + 0.16 * clamp(Math.abs(omega) / 8),
      pan: phasePan,
      waveform: "sine",
    })];
  }

  function metrics() {
    return [
      ["Contact", `${contactId + 1} / ${Math.round(state.sides)}`],
      ["Lift", `${Math.round(lift01() * 100)}%`],
      ["Angular speed", roundTo(omega)],
      ["Steps", impactCount],
    ];
  }

  function pointerDown(point) {
    swipeStart = { x: point.x, y: point.y };
  }

  function pointerMove(point) {
    if (!swipeStart) return;
    omega = clamp(omega + (point.dx ?? 0) * 0.35, -14, 14);
  }

  function pointerUp(point) {
    if (!swipeStart) return;
    const displacement = point.x - swipeStart.x;
    omega = clamp(omega + displacement * 4.5, -14, 14);
    swipeStart = null;
  }

  function primaryAction() {
    omega = clamp(omega + 2.8, -14, 14);
    events.push(transient("nudge", lift01(), 0.48, 0, "triangle", {
      attackSeconds: 0.002,
      decaySeconds: 0.2,
      attackNoise: 0.08,
    }));
  }

  reset();

  return {
    id: "rolling-measure",
    title: "Rolling Measure",
    kicker: "Physics · 04 · Polygonal rolling contact",
    description: "A regular polygon measures the ground one pivot and one side at a time.",
    instruction: "Swipe across the stage or use Nudge, then compare how side count changes the rise-and-fall rhythm.",
    lesson: "No-slip motion is a sequence of rotations about contact vertices. The centroid rises between impacts, then kinetic energy is lost when the pivot changes.",
    color: PHYSICS_COLORS.orange,
    mappings: [["Centroid lift", "continuous pitch"], ["Contact vertex", "impact pitch"], ["Impact loss", "accent level"], ["Roll phase", "stereo"]],
    controls,
    state,
    reset,
    setParam,
    step,
    draw,
    voices,
    consumeEvents: () => events.drain(),
    metrics,
    pointerDown,
    pointerMove,
    pointerUp,
    primaryActionLabel: "Nudge",
    primaryAction,
  };
}

export const SHAPE_PHYSICS_SCENES = Object.freeze([
  createGravityWalk,
  createRicochet,
  createRigidity,
  createRollingMeasure,
]);
