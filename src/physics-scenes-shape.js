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
  pointAtDistance,
  polygonArea,
  polygonEdges,
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
  sides: 6,
  rotation: 0,
  speed: 0.78,
  launchAngle: 27,
  restitution: 1,
  trail: 120,
});

function createRicochet() {
  const controls = Object.freeze([
    rangeControl("sides", "Walls", 3, 12, 1, RICOCHET_DEFAULTS.sides),
    rangeControl("rotation", "Arena angle", -180, 180, 1, RICOCHET_DEFAULTS.rotation, (v) => `${Math.round(v)}°`),
    rangeControl("speed", "Launch speed", 0.15, 2, 0.01, RICOCHET_DEFAULTS.speed, (v) => Number(v).toFixed(2)),
    rangeControl("launchAngle", "Launch angle", -180, 180, 1, RICOCHET_DEFAULTS.launchAngle, (v) => `${Math.round(v)}°`),
    rangeControl("restitution", "Reflection", 0.55, 1, 0.01, RICOCHET_DEFAULTS.restitution, (v) => Number(v).toFixed(2)),
    rangeControl("trail", "Trail", 24, 240, 1, RICOCHET_DEFAULTS.trail),
  ]);
  const state = { ...RICOCHET_DEFAULTS };
  const events = makeEventQueue();
  const ballRadius = 0.027;
  let polygon = regularPolygon(state.sides, { radius: 0.76, rotation: radians(state.rotation) + Math.PI / 2 });
  let ball = { x: -0.18, y: 0.08 };
  let velocity = { x: 0, y: 0 };
  let collisionCount = 0;
  let lastEdge = -1;
  let lastIncidence = 0;
  let impactGlow = 0;
  let lastImpact = null;
  let aiming = false;
  let aimPoint = null;
  let trailPoints = [];
  let trailClock = 0;

  const walls = () => polygonEdges(polygon).map((edge) => ({
    ...edge,
    inward: normalize(perpendicular(sub(edge.b, edge.a))),
  }));

  function insideWithMargin(point) {
    return walls().every((wall) => dot(sub(point, wall.a), wall.inward) >= ballRadius - 1e-7);
  }

  function launch() {
    const angle = radians(state.launchAngle);
    velocity = { x: Math.cos(angle) * state.speed, y: Math.sin(angle) * state.speed };
    aiming = false;
    aimPoint = null;
  }

  function resetDynamics() {
    ball = { x: -0.18, y: 0.08 };
    collisionCount = 0;
    lastEdge = -1;
    lastIncidence = 0;
    impactGlow = 0;
    lastImpact = null;
    aiming = false;
    aimPoint = null;
    trailPoints = [{ ...ball }];
    trailClock = 0;
    events.clear();
    launch();
  }

  function rebuildArena() {
    polygon = regularPolygon(Math.round(state.sides), {
      radius: 0.76,
      rotation: radians(state.rotation) + Math.PI / 2,
    });
    resetDynamics();
  }

  function reset() {
    Object.assign(state, RICOCHET_DEFAULTS);
    rebuildArena();
  }

  function setParam(key, value) {
    const next = coerceControl(controls, key, value);
    if (next === undefined) return;
    state[key] = next;
    if (key === "sides" || key === "rotation") rebuildArena();
    else if (key === "speed" && length(velocity) > EPSILON) velocity = scale(normalize(velocity), state.speed);
  }

  function registerImpact(point, normal, edgeIndex, incomingVelocity) {
    const approach = clamp(-dot(normalize(incomingVelocity), normal));
    lastIncidence = Math.acos(approach) * 180 / Math.PI;
    lastEdge = edgeIndex;
    lastImpact = { point: { ...point }, normal: { ...normal } };
    impactGlow = Math.max(impactGlow, approach);
    collisionCount += 1;
    events.push(transient(
      `wall-${edgeIndex}`,
      (edgeIndex + 0.5) / Math.max(1, state.sides),
      0.22 + 0.68 * approach,
      clamp(point.x / 0.76, -1, 1),
      "triangle",
      { decaySeconds: 0.08 + 0.12 * approach, attackNoise: 0.14 * approach },
    ));
  }

  function step(dt) {
    const h = finiteStep(dt);
    if (h <= 0) return;
    impactGlow *= Math.exp(-h / 0.1);
    if (aiming || length(velocity) <= EPSILON) return;

    let remaining = h;
    let contacts = 0;
    const arenaWalls = walls();
    while (remaining > 1e-8 && contacts < 8) {
      let earliest = remaining + 1;
      let hits = [];
      for (const wall of arenaWalls) {
        const normalSpeed = dot(velocity, wall.inward);
        if (normalSpeed >= -1e-9) continue;
        const clearance = dot(sub(ball, wall.a), wall.inward);
        const hitTime = (ballRadius - clearance) / normalSpeed;
        if (hitTime < -1e-8 || hitTime > remaining + 1e-8) continue;
        if (hitTime < earliest - 1e-7) {
          earliest = Math.max(0, hitTime);
          hits = [wall];
        } else if (Math.abs(hitTime - earliest) <= 1e-7) {
          hits.push(wall);
        }
      }

      if (!hits.length) {
        ball = add(ball, scale(velocity, remaining));
        remaining = 0;
        break;
      }

      ball = add(ball, scale(velocity, earliest));
      remaining -= earliest;
      const incoming = { ...velocity };
      const combinedNormal = normalize(hits.reduce(
        (sum, wall) => add(sum, wall.inward),
        { x: 0, y: 0 },
      ), hits[0].inward);
      const normalSpeed = dot(velocity, combinedNormal);
      velocity = sub(velocity, scale(combinedNormal, (1 + state.restitution) * normalSpeed));
      velocity = clampMagnitude(velocity, 2.5);
      ball = add(ball, scale(combinedNormal, 2e-6));
      registerImpact(ball, combinedNormal, hits[0].index, incoming);
      contacts += 1;
    }
    if (contacts >= 8 && remaining > 0) velocity = scale(velocity, 0.98);

    // Correct tiny accumulated half-plane errors without changing tangential motion.
    for (const wall of arenaWalls) {
      const clearance = dot(sub(ball, wall.a), wall.inward);
      if (clearance < ballRadius) ball = add(ball, scale(wall.inward, ballRadius - clearance + 1e-7));
    }

    trailClock += h;
    if (trailClock >= 1 / 90) {
      trailClock = 0;
      trailPoints.push({ ...ball });
      while (trailPoints.length > state.trail) trailPoints.shift();
    }
  }

  function draw(painter) {
    trailPoints.forEach((point, index) => {
      const amount = (index + 1) / Math.max(1, trailPoints.length);
      painter.circle(point, 0.003 + 0.006 * amount, {
        color: PHYSICS_COLORS.blue,
        fill: PHYSICS_COLORS.blue,
        width: 0,
        alpha: 0.025 + 0.22 * amount * amount,
      });
    });
    painter.polyline(polygon, {
      close: true,
      color: PHYSICS_COLORS.blue,
      width: 1.6,
      fill: "rgba(125,180,255,0.025)",
    });
    polygon.forEach((point, index) => painter.text(String(index + 1), scale(point, 1.08), {
      color: PHYSICS_COLORS.faint,
      size: 8,
    }));
    if (lastImpact) {
      painter.arrow(lastImpact.point, add(lastImpact.point, scale(lastImpact.normal, 0.14)), {
        color: PHYSICS_COLORS.coral,
        width: 1,
        alpha: 0.25 + 0.65 * impactGlow,
        headLength: 0.026,
      });
    }
    if (aiming && aimPoint) {
      painter.arrow(ball, aimPoint, { color: PHYSICS_COLORS.point, width: 1, alpha: 0.72, dash: [4, 4], headLength: 0.035 });
    }
    painter.circle(ball, ballRadius + 0.009 * impactGlow, {
      color: PHYSICS_COLORS.point,
      fill: PHYSICS_COLORS.blue,
      width: 1.4,
    });
  }

  function voices() {
    return [normalizedVoice({
      key: "flight",
      pitch01: clamp((ball.y + 0.76) / 1.52),
      gain: aiming ? 0.055 : 0.12 + 0.07 * clamp(length(velocity) / 2),
      pan: clamp(ball.x / 0.76, -1, 1),
      waveform: "sine",
    })];
  }

  function metrics() {
    return [
      ["Collisions", collisionCount],
      ["Speed", roundTo(length(velocity))],
      ["Incidence", lastEdge < 0 ? "—" : `${roundTo(lastIncidence, 1)}°`],
      ["Last wall", lastEdge < 0 ? "—" : lastEdge + 1],
    ];
  }

  function pointerDown(point) {
    if (insideWithMargin(point)) ball = { x: point.x, y: point.y };
    velocity = { x: 0, y: 0 };
    aiming = true;
    aimPoint = { ...point };
    trailPoints = [{ ...ball }];
  }

  function pointerMove(point) {
    if (aiming) aimPoint = { x: point.x, y: point.y };
  }

  function pointerUp(point) {
    if (!aiming) return;
    aimPoint = { x: point.x, y: point.y };
    const direction = normalize(sub(aimPoint, ball), {
      x: Math.cos(radians(state.launchAngle)),
      y: Math.sin(radians(state.launchAngle)),
    });
    velocity = scale(direction, state.speed);
    state.launchAngle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
    aiming = false;
    aimPoint = null;
    events.push(transient("launch", clamp((ball.y + 0.76) / 1.52), 0.38, clamp(ball.x / 0.76, -1, 1), "sine", {
      decaySeconds: 0.12,
    }));
  }

  function primaryAction() {
    ball = { x: -0.18, y: 0.08 };
    trailPoints = [{ ...ball }];
    launch();
    events.push(transient("relaunch", 0.52, 0.4, -0.2, "sine", { decaySeconds: 0.12 }));
  }

  reset();

  return {
    id: "ricochet",
    title: "Ricochet",
    kicker: "Physics · 02 · Polygonal billiards",
    description: "A ray remembers a polygon by the sequence of walls it strikes.",
    instruction: "Press inside the arena, drag an aim line, and release to launch the billiard.",
    lesson: "Each collision preserves the tangential velocity and reverses the normal velocity, producing periodic or quasi-periodic geometric orbits.",
    color: PHYSICS_COLORS.blue,
    mappings: [["Ball height", "flight pitch"], ["Wall identity", "impact pitch"], ["Normal impulse", "impact level"], ["Hit position", "stereo"]],
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
    primaryActionLabel: "Relaunch",
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
