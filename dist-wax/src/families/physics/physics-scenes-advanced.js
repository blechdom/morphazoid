/**
 * Advanced geometric-physics scenes.
 *
 * Every factory owns a deterministic, normalized model (+Y is up), and speaks
 * the deliberately small scene protocol consumed by the shared physics shell.
 * None of the sound sources are hidden sequencers: voices and transient events
 * are measurements of the visible simulation.
 */

import {
  TAU,
  PHYSICS_COLORS,
  add,
  clamp,
  convexHull,
  cross,
  delaunayEdges,
  distance,
  dot,
  length,
  lengthSquared,
  lerp,
  makeEventQueue,
  mulberry32,
  normalize,
  normalizedVoice,
  perpendicular,
  pointInPolygon,
  rangeControl,
  regularPolygon,
  rotate,
  scale,
  selectControl,
  sub,
  wrap,
} from "./physics-common.js";

const FALLING_COLOR = PHYSICS_COLORS.coral;
const CHARGE_COLOR = "#ee6fa9";
const PACKING_COLOR = "#d7e65b";
const GEODESIC_COLOR = "#62d8ff";
const HULL_COLOR = "#f5a65b";

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const damp = (value, rate, dt) => value * Math.exp(-Math.max(0, rate) * dt);
const eventSpec = (key, pitch01, gain, pan, waveform = "triangle", attackSeconds = 0.006, decaySeconds = 0.24) => ({
  key: String(key),
  pitch01: clamp(pitch01),
  gain: clamp(gain),
  pan: clamp(pan, -1, 1),
  waveform,
  attackSeconds,
  decaySeconds,
});

function polygonPerimeter(points) {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    total += distance(points[index], points[(index + 1) % points.length]);
  }
  return total;
}

function polygonAreaAbsolute(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    twiceArea += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(twiceArea) / 2;
}

// ---------------------------------------------------------------------------
// Falling Forms — convex rigid bodies, impulse contacts, torque and support.

const FALLING_BOUNDS = Object.freeze({ left: -1.02, right: 1.02, floor: -0.8, ceiling: 0.86 });

function makeRigidBody(id, sides, radius, position, velocity, angle, omega) {
  const mass = Math.max(0.01, radius * radius * sides * 0.9);
  return {
    id,
    sides,
    radius,
    position: { ...position },
    velocity: { ...velocity },
    angle,
    omega,
    mass,
    invMass: 1 / mass,
    inertia: 0.5 * mass * radius * radius,
    invInertia: 2 / (mass * radius * radius),
    localVertices: regularPolygon(sides, { radius }),
    held: false,
  };
}

function rigidVertices(body) {
  return body.localVertices.map((vertex) => add(body.position, rotate(vertex, body.angle)));
}

function supportPoint(points, direction) {
  let result = points[0];
  let best = dot(result, direction);
  for (let index = 1; index < points.length; index += 1) {
    const projection = dot(points[index], direction);
    if (projection > best) {
      best = projection;
      result = points[index];
    }
  }
  return result;
}

function projectPolygon(points, axis) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const point of points) {
    const projection = dot(point, axis);
    minimum = Math.min(minimum, projection);
    maximum = Math.max(maximum, projection);
  }
  return { minimum, maximum };
}

function polygonContact(bodyA, bodyB) {
  if (distance(bodyA.position, bodyB.position) > bodyA.radius + bodyB.radius + 0.01) return null;
  const verticesA = rigidVertices(bodyA);
  const verticesB = rigidVertices(bodyB);
  let normal = null;
  let penetration = Infinity;
  for (const points of [verticesA, verticesB]) {
    for (let index = 0; index < points.length; index += 1) {
      const edge = sub(points[(index + 1) % points.length], points[index]);
      const axis = normalize(perpendicular(edge));
      const projectionA = projectPolygon(verticesA, axis);
      const projectionB = projectPolygon(verticesB, axis);
      const overlap = Math.min(projectionA.maximum, projectionB.maximum)
        - Math.max(projectionA.minimum, projectionB.minimum);
      if (overlap <= 0) return null;
      if (overlap < penetration) {
        penetration = overlap;
        normal = axis;
      }
    }
  }
  if (dot(sub(bodyB.position, bodyA.position), normal) < 0) normal = scale(normal, -1);
  const pointA = supportPoint(verticesA, normal);
  const pointB = supportPoint(verticesB, scale(normal, -1));
  return {
    normal,
    penetration,
    point: scale(add(pointA, pointB), 0.5),
    key: bodyA.id < bodyB.id ? `${bodyA.id}:${bodyB.id}` : `${bodyB.id}:${bodyA.id}`,
  };
}

function pointVelocity(body, point) {
  const arm = sub(point, body.position);
  return add(body.velocity, scale(perpendicular(arm), body.omega));
}

function applyBodyImpulse(body, impulse, point, direction = 1) {
  if (body.held) return;
  body.velocity = add(body.velocity, scale(impulse, body.invMass * direction));
  body.omega += cross(sub(point, body.position), impulse) * body.invInertia * direction;
}

function resolveRigidPair(bodyA, bodyB, restitution, friction) {
  const hit = polygonContact(bodyA, bodyB);
  if (!hit) return null;
  const invA = bodyA.held ? 0 : bodyA.invMass;
  const invB = bodyB.held ? 0 : bodyB.invMass;
  const inverseSum = invA + invB;
  if (inverseSum <= 1e-12) return hit;

  const correction = Math.max(0, hit.penetration - 0.0015) * 0.62 / inverseSum;
  if (!bodyA.held) bodyA.position = add(bodyA.position, scale(hit.normal, -correction * invA));
  if (!bodyB.held) bodyB.position = add(bodyB.position, scale(hit.normal, correction * invB));

  const armA = sub(hit.point, bodyA.position);
  const armB = sub(hit.point, bodyB.position);
  let relative = sub(pointVelocity(bodyB, hit.point), pointVelocity(bodyA, hit.point));
  const normalSpeed = dot(relative, hit.normal);
  hit.approachSpeed = Math.max(0, -normalSpeed);
  hit.impulse = 0;
  if (normalSpeed >= 0) return hit;
  const denominator = inverseSum
    + cross(armA, hit.normal) ** 2 * (bodyA.held ? 0 : bodyA.invInertia)
    + cross(armB, hit.normal) ** 2 * (bodyB.held ? 0 : bodyB.invInertia);
  const impulseMagnitude = -(1 + restitution) * normalSpeed / Math.max(1e-9, denominator);
  const impulse = scale(hit.normal, impulseMagnitude);
  applyBodyImpulse(bodyA, impulse, hit.point, -1);
  applyBodyImpulse(bodyB, impulse, hit.point, 1);
  hit.impulse = impulseMagnitude;

  relative = sub(pointVelocity(bodyB, hit.point), pointVelocity(bodyA, hit.point));
  const tangentVelocity = sub(relative, scale(hit.normal, dot(relative, hit.normal)));
  if (lengthSquared(tangentVelocity) > 1e-12) {
    const tangent = normalize(tangentVelocity);
    const tangentDenominator = inverseSum
      + cross(armA, tangent) ** 2 * (bodyA.held ? 0 : bodyA.invInertia)
      + cross(armB, tangent) ** 2 * (bodyB.held ? 0 : bodyB.invInertia);
    const rawFriction = -dot(relative, tangent) / Math.max(1e-9, tangentDenominator);
    const frictionMagnitude = clamp(rawFriction, -friction * impulseMagnitude, friction * impulseMagnitude);
    const frictionImpulse = scale(tangent, frictionMagnitude);
    applyBodyImpulse(bodyA, frictionImpulse, hit.point, -1);
    applyBodyImpulse(bodyB, frictionImpulse, hit.point, 1);
  }
  return hit;
}

function wallCandidates(body) {
  const vertices = rigidVertices(body);
  const candidates = [];
  for (const point of vertices) {
    if (point.y < FALLING_BOUNDS.floor) candidates.push({
      key: `floor:${body.id}`, point, normal: { x: 0, y: 1 }, penetration: FALLING_BOUNDS.floor - point.y,
    });
    if (point.y > FALLING_BOUNDS.ceiling) candidates.push({
      key: `ceiling:${body.id}`, point, normal: { x: 0, y: -1 }, penetration: point.y - FALLING_BOUNDS.ceiling,
    });
    if (point.x < FALLING_BOUNDS.left) candidates.push({
      key: `left:${body.id}`, point, normal: { x: 1, y: 0 }, penetration: FALLING_BOUNDS.left - point.x,
    });
    if (point.x > FALLING_BOUNDS.right) candidates.push({
      key: `right:${body.id}`, point, normal: { x: -1, y: 0 }, penetration: point.x - FALLING_BOUNDS.right,
    });
  }
  candidates.sort((a, b) => b.penetration - a.penetration);
  const counts = new Map();
  return candidates.filter((candidate) => {
    const count = counts.get(candidate.key) ?? 0;
    counts.set(candidate.key, count + 1);
    return count < 2;
  });
}

function resolveWall(body, hit, restitution, friction) {
  if (body.held) return { ...hit, impulse: 0, approachSpeed: 0 };
  body.position = add(body.position, scale(hit.normal, Math.max(0, hit.penetration - 0.001) * 0.55));
  const arm = sub(hit.point, body.position);
  let velocity = pointVelocity(body, hit.point);
  const normalSpeed = dot(velocity, hit.normal);
  const result = { ...hit, approachSpeed: Math.max(0, -normalSpeed), impulse: 0 };
  if (normalSpeed >= 0) return result;
  const denominator = body.invMass + cross(arm, hit.normal) ** 2 * body.invInertia;
  const magnitude = -(1 + restitution) * normalSpeed / Math.max(1e-9, denominator);
  const impulse = scale(hit.normal, magnitude);
  applyBodyImpulse(body, impulse, hit.point);
  result.impulse = magnitude;
  velocity = pointVelocity(body, hit.point);
  const tangent = perpendicular(hit.normal);
  const tangentDenominator = body.invMass + cross(arm, tangent) ** 2 * body.invInertia;
  const rawFriction = -dot(velocity, tangent) / Math.max(1e-9, tangentDenominator);
  const frictionMagnitude = clamp(rawFriction, -friction * magnitude, friction * magnitude);
  applyBodyImpulse(body, scale(tangent, frictionMagnitude), hit.point);
  return result;
}

export function createFallingFormsScene() {
  const controls = [
    rangeControl("count", "forms", 1, 8, 1, 5),
    selectControl("sides", "geometry", [
      { value: "mixed", label: "mixed" },
      { value: 3, label: "triangles" },
      { value: 4, label: "squares" },
      { value: 5, label: "pentagons" },
      { value: 6, label: "hexagons" },
    ], "mixed"),
    rangeControl("gravity", "gravity", 0, 1.5, 0.01, 0.8, (value) => `${value.toFixed(2)} g`),
    rangeControl("restitution", "bounce", 0, 0.9, 0.01, 0.24),
    rangeControl("friction", "friction", 0, 1, 0.01, 0.55),
    rangeControl("angularDrag", "angular drag", 0, 1.5, 0.01, 0.12),
  ];
  const state = Object.fromEntries(controls.map((control) => [control.key, control.value]));
  const queue = makeEventQueue();
  let bodies = [];
  let contacts = [];
  let cooldowns = new Map();
  let grabbed = null;
  let pointerOffset = { x: 0, y: 0 };
  let pointerPrevious = null;

  const scene = {
    id: "falling-forms",
    title: "Falling Forms",
    kicker: "RIGID BODY / IMPULSE / SUPPORT",
    description: "Convex bodies fall, collide, and turn. Every strike reports the impulse geometry actually produced.",
    instruction: "Drag a form and release it to throw. Flat faces settle; corners turn impact into torque.",
    lesson: "Contact impulses act at particular points, so the same fall can become translation, rotation, or stable support depending on a form's geometry.",
    color: FALLING_COLOR,
    mappings: [["Body height", "continuous pitch"], ["Impact impulse", "accent level"], ["Number of sides", "timbre"], ["Contact position", "stereo"]],
    controls,
    state,

    reset() {
      const random = mulberry32(0xf4111a);
      const count = Math.round(clamp(finiteNumber(state.count, 5), 1, 8));
      bodies = Array.from({ length: count }, (_, index) => {
        const chosenSides = state.sides === "mixed" ? 3 + index % 5 : Math.round(finiteNumber(state.sides, 5));
        const radius = 0.105 + random() * 0.025;
        const column = index % 4;
        const row = Math.floor(index / 4);
        return makeRigidBody(
          index,
          chosenSides,
          radius,
          { x: -0.66 + column * 0.44 + (random() - 0.5) * 0.05, y: 0.14 + row * 0.34 + random() * 0.04 },
          { x: (random() - 0.5) * 0.11, y: 0 },
          random() * TAU,
          (random() - 0.5) * 1.3,
        );
      });
      contacts = [];
      cooldowns = new Map();
      grabbed = null;
      pointerPrevious = null;
      queue.clear();
    },

    setParam(key, value) {
      if (!(key in state)) return;
      state[key] = key === "sides" ? value : finiteNumber(value, state[key]);
      if (key === "count" || key === "sides") scene.reset();
    },

    step(dt) {
      const gravity = -1.8 * clamp(state.gravity, 0, 1.5);
      for (const [key, remaining] of cooldowns) {
        if (remaining <= dt) cooldowns.delete(key);
        else cooldowns.set(key, remaining - dt);
      }
      for (const body of bodies) {
        if (body.held) continue;
        body.velocity.y += gravity * dt;
        body.velocity.x = damp(body.velocity.x, 0.035, dt);
        body.velocity.y = damp(body.velocity.y, 0.018, dt);
        body.omega = damp(body.omega, state.angularDrag, dt);
        body.position = add(body.position, scale(body.velocity, dt));
        body.angle = wrap(body.angle + body.omega * dt, TAU);
      }

      const peaks = new Map();
      const remember = (hit) => {
        if (!hit) return;
        const previous = peaks.get(hit.key);
        if (!previous || hit.impulse > previous.impulse) peaks.set(hit.key, hit);
      };
      for (let pass = 0; pass < 5; pass += 1) {
        for (const body of bodies) {
          for (const wallHit of wallCandidates(body)) {
            remember(resolveWall(body, wallHit, state.restitution, state.friction));
          }
        }
        for (let left = 0; left < bodies.length - 1; left += 1) {
          for (let right = left + 1; right < bodies.length; right += 1) {
            remember(resolveRigidPair(bodies[left], bodies[right], state.restitution, state.friction));
          }
        }
      }
      contacts = [...peaks.values()];
      for (const hit of contacts) {
        if (hit.approachSpeed > 0.12 && hit.impulse > 0.0015 && !cooldowns.has(hit.key)) {
          const body = bodies.find((candidate) => hit.key.endsWith(`:${candidate.id}`)) ?? bodies[0];
          queue.push(eventSpec(
            `impact-${hit.key}`,
            clamp(0.18 + (hit.point.y - FALLING_BOUNDS.floor) * 0.38 + ((body?.sides ?? 4) - 3) * 0.025),
            clamp(0.12 + Math.sqrt(hit.impulse) * 0.65),
            hit.point.x,
            (body?.sides ?? 4) % 2 ? "triangle" : "square",
            0.004,
            0.18 + clamp(hit.impulse * 0.5, 0, 0.28),
          ));
          cooldowns.set(hit.key, 0.085);
        }
      }
    },

    draw(painter) {
      painter.line(
        { x: FALLING_BOUNDS.left, y: FALLING_BOUNDS.floor },
        { x: FALLING_BOUNDS.right, y: FALLING_BOUNDS.floor },
        { color: FALLING_COLOR, width: 2, alpha: 0.65 },
      );
      painter.line(
        { x: FALLING_BOUNDS.left, y: FALLING_BOUNDS.floor },
        { x: FALLING_BOUNDS.left, y: FALLING_BOUNDS.ceiling },
        { alpha: 0.22 },
      );
      painter.line(
        { x: FALLING_BOUNDS.right, y: FALLING_BOUNDS.floor },
        { x: FALLING_BOUNDS.right, y: FALLING_BOUNDS.ceiling },
        { alpha: 0.22 },
      );
      for (const body of bodies) {
        const vertices = rigidVertices(body);
        painter.polyline(vertices, {
          close: true,
          color: body.held ? PHYSICS_COLORS.point : FALLING_COLOR,
          width: body.held ? 2.3 : 1.45,
          fill: body.held ? "rgba(255,243,214,0.10)" : "rgba(255,130,111,0.065)",
        });
        painter.line(add(body.position, { x: -0.018, y: 0 }), add(body.position, { x: 0.018, y: 0 }), { alpha: 0.35 });
        painter.line(add(body.position, { x: 0, y: -0.018 }), add(body.position, { x: 0, y: 0.018 }), { alpha: 0.35 });
      }
      for (const hit of contacts) {
        painter.circle(hit.point, 0.009 + clamp(hit.impulse * 0.1, 0, 0.02), {
          color: PHYSICS_COLORS.point,
          fill: PHYSICS_COLORS.point,
          width: 0,
          alpha: 0.45,
        });
        painter.line(hit.point, add(hit.point, scale(hit.normal, 0.05)), { color: FALLING_COLOR, alpha: 0.4 });
      }
    },

    voices() {
      return bodies.map((body) => normalizedVoice({
        key: `body-${body.id}`,
        pitch01: clamp((body.position.y - FALLING_BOUNDS.floor) / (FALLING_BOUNDS.ceiling - FALLING_BOUNDS.floor)),
        gain: clamp(0.012 + length(body.velocity) * 0.025 + Math.abs(body.omega) * 0.009, 0, 0.13),
        pan: body.position.x,
        waveform: body.sides % 2 ? "sine" : "triangle",
      }));
    },

    consumeEvents() { return queue.drain(); },

    metrics() {
      const kinetic = bodies.reduce((sum, body) => sum
        + 0.5 * body.mass * lengthSquared(body.velocity)
        + 0.5 * body.inertia * body.omega * body.omega, 0);
      return {
        forms: bodies.length,
        contacts: contacts.length,
        energy: kinetic.toFixed(3),
      };
    },

    pointerDown(point) {
      const candidates = bodies
        .filter((body) => pointInPolygon(point, rigidVertices(body)) || distance(point, body.position) < body.radius * 1.15)
        .sort((a, b) => distance(point, a.position) - distance(point, b.position));
      grabbed = candidates[0] ?? null;
      if (!grabbed) return false;
      grabbed.held = true;
      pointerOffset = sub(grabbed.position, point);
      pointerPrevious = { ...point };
      return true;
    },

    pointerMove(point) {
      if (!grabbed) return false;
      const target = add(point, pointerOffset);
      const delta = sub(target, grabbed.position);
      grabbed.velocity = add(scale(grabbed.velocity, 0.35), scale(delta, 38));
      grabbed.position = target;
      grabbed.omega = damp(grabbed.omega, 8, 1 / 60);
      pointerPrevious = { ...point };
      return true;
    },

    pointerUp(point) {
      if (!grabbed) return false;
      if (point && pointerPrevious) {
        const delta = sub(point, pointerPrevious);
        grabbed.velocity = add(grabbed.velocity, scale(delta, 20));
      }
      grabbed.held = false;
      grabbed = null;
      pointerPrevious = null;
      return true;
    },
    primaryActionLabel: "Drop again",
    primaryAction() { scene.reset(); },
  };
  scene.reset();
  return scene;
}

// ---------------------------------------------------------------------------
// Charge Garden — potential contours, field vectors and charged test tracers.

const CHARGE_BOUNDS = Object.freeze({ left: -1, right: 1, bottom: -0.78, top: 0.78 });

function chargeFieldAt(point, sources, softening) {
  let potential = 0;
  let x = 0;
  let y = 0;
  const softenSquared = softening * softening;
  for (const source of sources) {
    const delta = sub(point, source.position);
    const radiusSquared = lengthSquared(delta) + softenSquared;
    const radius = Math.sqrt(radiusSquared);
    potential += source.charge / radius;
    const inverseCube = 1 / (radiusSquared * radius);
    x += source.charge * delta.x * inverseCube;
    y += source.charge * delta.y * inverseCube;
  }
  return { potential, field: { x, y } };
}

function marchPotentialContours(sources, softening) {
  const columns = 34;
  const rows = 26;
  const levels = [-8, -4, -2, -1, 0, 1, 2, 4, 8];
  const grid = Array.from({ length: rows + 1 }, (_, row) => Array.from({ length: columns + 1 }, (_, column) => {
    const point = {
      x: lerp(CHARGE_BOUNDS.left, CHARGE_BOUNDS.right, column / columns),
      y: lerp(CHARGE_BOUNDS.bottom, CHARGE_BOUNDS.top, row / rows),
    };
    return { point, value: chargeFieldAt(point, sources, softening).potential };
  }));
  const segments = [];
  const edgePairs = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const crossing = (left, right, level) => {
    if ((left.value < level) === (right.value < level)) return null;
    const amount = clamp((level - left.value) / (right.value - left.value || 1e-12));
    return {
      x: lerp(left.point.x, right.point.x, amount),
      y: lerp(left.point.y, right.point.y, amount),
    };
  };
  for (const level of levels) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const corners = [
          grid[row][column],
          grid[row][column + 1],
          grid[row + 1][column + 1],
          grid[row + 1][column],
        ];
        const hits = edgePairs
          .map(([left, right], edge) => ({ point: crossing(corners[left], corners[right], level), edge }))
          .filter((hit) => hit.point);
        if (hits.length === 2) segments.push({ a: hits[0].point, b: hits[1].point, level });
        else if (hits.length === 4) {
          const centerValue = corners.reduce((sum, corner) => sum + corner.value, 0) / 4;
          const pairings = centerValue >= level ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
          for (const [left, right] of pairings) segments.push({ a: hits[left].point, b: hits[right].point, level });
        }
      }
    }
  }
  return segments;
}

export function createChargeGardenScene() {
  const controls = [
    selectControl("arrangement", "arrangement", [
      { value: "dipole", label: "dipole" },
      { value: "quadrupole", label: "quadrupole" },
      { value: "ring", label: "alternating ring" },
      { value: "random", label: "seeded scatter" },
    ], "quadrupole"),
    rangeControl("sources", "source charges", 2, 8, 1, 4),
    selectControl("tracerCharge", "test charge", [
      { value: 1, label: "positive" },
      { value: -1, label: "negative" },
    ], 1),
    rangeControl("strength", "field strength", 0.1, 1.5, 0.01, 0.62),
    rangeControl("softening", "source radius", 0.035, 0.16, 0.005, 0.075),
    rangeControl("damping", "drag", 0, 2, 0.01, 0.34),
  ];
  const state = Object.fromEntries(controls.map((control) => [control.key, control.value]));
  const queue = makeEventQueue();
  let sources = [];
  let tracers = [];
  let contourSegments = [];
  let fieldDirty = true;
  let draggedSource = null;
  let pointerStart = null;
  let elapsed = 0;

  function arrangeSources() {
    const random = mulberry32(0xc4a263);
    const count = Math.round(clamp(finiteNumber(state.sources, 4), 2, 8));
    const arrangement = state.arrangement;
    sources = Array.from({ length: count }, (_, index) => {
      let position;
      if (arrangement === "quadrupole") {
        const corners = [
          { x: -0.46, y: 0.38 }, { x: 0.46, y: 0.38 },
          { x: 0.46, y: -0.38 }, { x: -0.46, y: -0.38 },
        ];
        const ring = Math.floor(index / 4);
        position = scale(corners[index % 4], 1 - ring * 0.45);
      } else if (arrangement === "ring") {
        const angle = index / count * TAU - Math.PI / 2;
        position = { x: Math.cos(angle) * 0.55, y: Math.sin(angle) * 0.48 };
      } else if (arrangement === "random") {
        position = { x: lerp(-0.72, 0.72, random()), y: lerp(-0.52, 0.52, random()) };
      } else {
        const side = index % 2 === 0 ? -1 : 1;
        const row = Math.floor(index / 2);
        position = { x: side * (0.33 + row * 0.1), y: (row - (count - 2) / 4) * 0.3 };
      }
      const charge = arrangement === "quadrupole"
        ? (index % 4 === 0 || index % 4 === 2 ? 1 : -1)
        : (index % 2 === 0 ? 1 : -1);
      return { id: index, position, charge };
    });
    fieldDirty = true;
  }

  function resetTracers() {
    const random = mulberry32(0x7aace2);
    tracers = Array.from({ length: 3 }, (_, index) => ({
      id: index,
      position: { x: lerp(-0.18, 0.18, random()), y: 0.62 - index * 0.12 },
      velocity: { x: (random() - 0.5) * 0.15, y: -0.05 - random() * 0.08 },
      band: null,
      trail: [],
      lastPotential: 0,
      lastField: 0,
    }));
  }

  const scene = {
    id: "charge-garden",
    title: "Charge Garden",
    kicker: "POTENTIAL / GRADIENT / SUPERPOSITION",
    description: "Positive and negative points bend a potential landscape; tracers make its slope audible.",
    instruction: "Drag a source to redraw every equipotential. Tap open space to plant another alternating charge.",
    lesson: "Potentials add as scalars; their gradient makes a vector field perpendicular to every equipotential contour, including around saddle points.",
    color: CHARGE_COLOR,
    mappings: [["Potential", "pitch"], ["Field magnitude", "voice level"], ["Equipotential crossing", "accent"], ["Tracer position", "stereo"]],
    controls,
    state,

    reset() {
      arrangeSources();
      resetTracers();
      contourSegments = [];
      draggedSource = null;
      pointerStart = null;
      elapsed = 0;
      queue.clear();
    },

    setParam(key, value) {
      if (!(key in state)) return;
      state[key] = ["arrangement"].includes(key) ? value : finiteNumber(value, state[key]);
      if (key === "arrangement" || key === "sources") scene.reset();
      else if (key === "softening") fieldDirty = true;
    },

    step(dt) {
      elapsed += dt;
      const tracerSign = finiteNumber(state.tracerCharge, 1) < 0 ? -1 : 1;
      for (const tracer of tracers) {
        const sample = chargeFieldAt(tracer.position, sources, state.softening);
        let acceleration = scale(sample.field, tracerSign * state.strength * 0.13);
        const magnitude = length(acceleration);
        if (magnitude > 7) acceleration = scale(acceleration, 7 / magnitude);
        tracer.velocity = add(tracer.velocity, scale(acceleration, dt));
        tracer.velocity = scale(tracer.velocity, Math.exp(-state.damping * dt));
        tracer.position = add(tracer.position, scale(tracer.velocity, dt));

        if (tracer.position.x < CHARGE_BOUNDS.left || tracer.position.x > CHARGE_BOUNDS.right) {
          tracer.position.x = clamp(tracer.position.x, CHARGE_BOUNDS.left, CHARGE_BOUNDS.right);
          tracer.velocity.x *= -0.72;
        }
        if (tracer.position.y < CHARGE_BOUNDS.bottom || tracer.position.y > CHARGE_BOUNDS.top) {
          tracer.position.y = clamp(tracer.position.y, CHARGE_BOUNDS.bottom, CHARGE_BOUNDS.top);
          tracer.velocity.y *= -0.72;
        }
        for (const source of sources) {
          const delta = sub(tracer.position, source.position);
          const minimumDistance = state.softening * 0.82;
          if (lengthSquared(delta) < minimumDistance * minimumDistance) {
            const normal = normalize(delta, { x: tracer.id % 2 ? 1 : -1, y: 0 });
            tracer.position = add(source.position, scale(normal, minimumDistance));
            const normalSpeed = dot(tracer.velocity, normal);
            if (normalSpeed < 0) tracer.velocity = sub(tracer.velocity, scale(normal, 1.65 * normalSpeed));
          }
        }
        const after = chargeFieldAt(tracer.position, sources, state.softening);
        tracer.lastPotential = after.potential;
        tracer.lastField = length(after.field);
        const normalizedPotential = 0.5 + Math.atan(after.potential / 4) / Math.PI;
        const band = Math.floor(clamp(normalizedPotential) * 9);
        if (tracer.band !== null && band !== tracer.band && length(tracer.velocity) > 0.035) {
          queue.push(eventSpec(
            `equipotential-${tracer.id}-${band}-${Math.floor(elapsed * 20)}`,
            band / 8,
            0.12 + clamp(length(tracer.velocity) * 0.2, 0, 0.3),
            tracer.position.x,
            "triangle",
            0.004,
            0.13,
          ));
        }
        tracer.band = band;
        tracer.trail.push({ ...tracer.position });
        if (tracer.trail.length > 100) tracer.trail.shift();
      }
    },

    draw(painter) {
      if (fieldDirty) {
        contourSegments = marchPotentialContours(sources, state.softening);
        fieldDirty = false;
      }
      for (const segment of contourSegments) {
        const color = segment.level > 0 ? CHARGE_COLOR : segment.level < 0 ? PHYSICS_COLORS.blue : PHYSICS_COLORS.point;
        painter.line(segment.a, segment.b, { color, width: segment.level === 0 ? 1.25 : 0.7, alpha: segment.level === 0 ? 0.35 : 0.16 });
      }
      for (let row = 0; row < 8; row += 1) {
        for (let column = 0; column < 12; column += 1) {
          const point = {
            x: lerp(-0.9, 0.9, column / 11),
            y: lerp(-0.67, 0.67, row / 7),
          };
          const field = chargeFieldAt(point, sources, state.softening).field;
          const magnitude = length(field);
          const direction = normalize(field);
          const extent = 0.022 + 0.047 * Math.tanh(magnitude * 0.12);
          painter.arrow(point, add(point, scale(direction, extent)), {
            color: PHYSICS_COLORS.muted,
            width: 0.7,
            alpha: 0.16 + 0.2 * Math.tanh(magnitude * 0.08),
            headLength: 0.015,
          });
        }
      }
      for (const tracer of tracers) {
        painter.polyline(tracer.trail, { color: PHYSICS_COLORS.point, width: 1, alpha: 0.2 });
        painter.circle(tracer.position, 0.018, { color: PHYSICS_COLORS.point, fill: PHYSICS_COLORS.point, width: 0, alpha: 0.9 });
        const direction = normalize(chargeFieldAt(tracer.position, sources, state.softening).field);
        painter.arrow(tracer.position, add(tracer.position, scale(direction, 0.075)), { color: PHYSICS_COLORS.point, alpha: 0.42, headLength: 0.022 });
      }
      for (const source of sources) {
        const positive = source.charge > 0;
        painter.circle(source.position, state.softening * 0.62, {
          color: positive ? CHARGE_COLOR : PHYSICS_COLORS.blue,
          fill: positive ? "rgba(238,111,169,0.14)" : "rgba(125,180,255,0.14)",
          width: draggedSource === source ? 2.4 : 1.5,
        });
        painter.text(positive ? "+" : "−", source.position, {
          color: positive ? CHARGE_COLOR : PHYSICS_COLORS.blue,
          size: 12,
        });
      }
    },

    voices() {
      return tracers.map((tracer) => normalizedVoice({
        key: `tracer-${tracer.id}`,
        pitch01: 0.5 + Math.atan(tracer.lastPotential / 4) / Math.PI,
        gain: 0.025 + 0.11 * Math.tanh(tracer.lastField * 0.045) + 0.04 * Math.tanh(length(tracer.velocity)),
        pan: tracer.position.x,
        waveform: tracer.lastPotential >= 0 ? "sine" : "triangle",
      }));
    },

    consumeEvents() { return queue.drain(); },

    metrics() {
      const focus = tracers[0] ?? { lastPotential: 0, lastField: 0 };
      return {
        potential: focus.lastPotential.toFixed(2),
        field: focus.lastField.toFixed(2),
        sources: sources.length,
      };
    },

    pointerDown(point) {
      pointerStart = { ...point };
      draggedSource = sources
        .filter((source) => distance(source.position, point) < Math.max(0.09, state.softening))
        .sort((a, b) => distance(a.position, point) - distance(b.position, point))[0] ?? null;
      return Boolean(draggedSource);
    },

    pointerMove(point) {
      if (!draggedSource) return false;
      draggedSource.position = {
        x: clamp(point.x, CHARGE_BOUNDS.left + 0.04, CHARGE_BOUNDS.right - 0.04),
        y: clamp(point.y, CHARGE_BOUNDS.bottom + 0.04, CHARGE_BOUNDS.top - 0.04),
      };
      fieldDirty = true;
      return true;
    },

    pointerUp(point) {
      if (draggedSource) {
        draggedSource = null;
        pointerStart = null;
        return true;
      }
      if (pointerStart && point && distance(pointerStart, point) < 0.025 && sources.length < 8) {
        const id = Math.max(-1, ...sources.map((source) => source.id)) + 1;
        sources.push({ id, position: { ...point }, charge: sources.length % 2 === 0 ? 1 : -1 });
        state.sources = sources.length;
        fieldDirty = true;
        pointerStart = null;
        return true;
      }
      pointerStart = null;
      return false;
    },
    primaryActionLabel: "Replant",
    primaryAction() { scene.reset(); },
  };
  scene.reset();
  return scene;
}

// ---------------------------------------------------------------------------
// Packing Pressure — position constraints and a visible contact-force graph.

const PACKING_BOUNDS = Object.freeze({ left: -0.98, right: 0.98, floor: -0.8 });

export function createPackingPressureScene() {
  const controls = [
    rangeControl("grains", "grains", 12, 72, 1, 44),
    rangeControl("spread", "size spread", 0, 0.42, 0.01, 0.2),
    rangeControl("gravity", "gravity", 0, 1.5, 0.01, 0.82),
    rangeControl("friction", "friction", 0, 1, 0.01, 0.5),
    rangeControl("compression", "compression", 0, 0.82, 0.01, 0.14),
    rangeControl("agitation", "agitation", 0, 1, 0.01, 0.04),
  ];
  const state = Object.fromEntries(controls.map((control) => [control.key, control.value]));
  const queue = makeEventQueue();
  let grains = [];
  let contacts = [];
  let previousContactKeys = new Set();
  let grabbed = null;
  let draggingRoof = false;
  let pointerPrevious = null;
  let elapsed = 0;
  let pressure = 0;
  let jammed = false;

  const roofY = () => lerp(0.78, -0.12, clamp(state.compression, 0, 0.82) / 0.82);

  function buildPairs() {
    const maximumRadius = Math.max(0.04, ...grains.map((grain) => grain.radius));
    const cellSize = maximumRadius * 2.05;
    const buckets = new Map();
    const cellOf = (grain) => ({
      x: Math.floor((grain.position.x - PACKING_BOUNDS.left) / cellSize),
      y: Math.floor((grain.position.y - PACKING_BOUNDS.floor) / cellSize),
    });
    grains.forEach((grain, index) => {
      const cell = cellOf(grain);
      const key = `${cell.x},${cell.y}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(index);
    });
    const pairs = [];
    grains.forEach((grain, left) => {
      const cell = cellOf(grain);
      for (let y = cell.y - 1; y <= cell.y + 1; y += 1) {
        for (let x = cell.x - 1; x <= cell.x + 1; x += 1) {
          for (const right of buckets.get(`${x},${y}`) ?? []) {
            if (right > left) pairs.push([left, right]);
          }
        }
      }
    });
    return pairs;
  }

  const scene = {
    id: "packing-pressure",
    title: "Packing Pressure",
    kicker: "PACKING / FORCE CHAINS / JAMMING",
    description: "Disks settle into a contact network. Compression turns overlap constraints into visible force chains.",
    instruction: "Pull the roof downward or stir a grain. Thick links carry the greatest constraint force.",
    lesson: "Local non-overlap constraints organize into system-spanning force chains; pressure, coordination, and diminishing motion mark the onset of jamming.",
    color: PACKING_COLOR,
    mappings: [["Contact height", "pitch"], ["Constraint force", "voice level"], ["New contact", "accent"], ["Packing fraction", "bass pitch"]],
    controls,
    state,

    reset() {
      const random = mulberry32(0x9ac41e);
      const count = Math.round(clamp(finiteNumber(state.grains, 44), 12, 72));
      const baseRadius = clamp(0.073 * Math.sqrt(44 / count), 0.052, 0.095);
      const columns = Math.max(4, Math.floor((PACKING_BOUNDS.right - PACKING_BOUNDS.left) / (baseRadius * 2.15)));
      grains = Array.from({ length: count }, (_, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        const radius = baseRadius * (1 + (random() - 0.5) * 2 * state.spread);
        return {
          id: index,
          radius,
          position: {
            x: PACKING_BOUNDS.left + baseRadius * 1.3 + column * baseRadius * 2.08 + (row % 2) * baseRadius * 0.72,
            y: PACKING_BOUNDS.floor + baseRadius * 1.35 + row * baseRadius * 2.05,
          },
          velocity: { x: (random() - 0.5) * 0.08, y: random() * 0.03 },
          held: false,
          coordination: 0,
        };
      });
      contacts = [];
      previousContactKeys = new Set();
      grabbed = null;
      draggingRoof = false;
      pointerPrevious = null;
      pressure = 0;
      elapsed = 0;
      jammed = false;
      queue.clear();
    },

    setParam(key, value) {
      if (!(key in state)) return;
      state[key] = finiteNumber(value, state[key]);
      if (key === "grains" || key === "spread") scene.reset();
    },

    step(dt) {
      elapsed += dt;
      const previousPositions = new Map();
      for (const grain of grains) {
        previousPositions.set(grain.id, { ...grain.position });
        grain.coordination = 0;
        if (grain.held) continue;
        grain.velocity.x += Math.sin(elapsed * 17 + grain.id * 2.399) * state.agitation * 1.5 * dt;
        grain.velocity.y -= state.gravity * 1.55 * dt;
        grain.velocity = scale(grain.velocity, Math.exp(-0.035 * dt));
        grain.position = add(grain.position, scale(grain.velocity, dt));
      }

      const forceMap = new Map();
      let roofCorrection = 0;
      for (let iteration = 0; iteration < 6; iteration += 1) {
        const roof = roofY();
        for (const grain of grains) {
          if (grain.held) continue;
          const leftPenetration = PACKING_BOUNDS.left + grain.radius - grain.position.x;
          const rightPenetration = grain.position.x + grain.radius - PACKING_BOUNDS.right;
          const floorPenetration = PACKING_BOUNDS.floor + grain.radius - grain.position.y;
          const roofPenetration = grain.position.y + grain.radius - roof;
          if (leftPenetration > 0) grain.position.x += leftPenetration;
          if (rightPenetration > 0) grain.position.x -= rightPenetration;
          if (floorPenetration > 0) grain.position.y += floorPenetration;
          if (roofPenetration > 0) {
            grain.position.y -= roofPenetration;
            roofCorrection += roofPenetration;
            const key = `roof:${grain.id}`;
            const old = forceMap.get(key);
            forceMap.set(key, {
              key,
              a: grain,
              b: null,
              point: { x: grain.position.x, y: roof },
              correction: (old?.correction ?? 0) + roofPenetration,
            });
          }
        }
        for (const [leftIndex, rightIndex] of buildPairs()) {
          const left = grains[leftIndex];
          const right = grains[rightIndex];
          const delta = sub(right.position, left.position);
          const minimum = left.radius + right.radius;
          const currentDistance = length(delta);
          const overlap = minimum - currentDistance;
          if (overlap <= 0) continue;
          const fallbackAngle = ((left.id * 97 + right.id * 31) % 360) / 360 * TAU;
          const normal = normalize(delta, { x: Math.cos(fallbackAngle), y: Math.sin(fallbackAngle) });
          const leftWeight = left.held ? 0 : 1;
          const rightWeight = right.held ? 0 : 1;
          const totalWeight = leftWeight + rightWeight;
          if (totalWeight <= 0) continue;
          if (!left.held) left.position = add(left.position, scale(normal, -overlap * leftWeight / totalWeight));
          if (!right.held) right.position = add(right.position, scale(normal, overlap * rightWeight / totalWeight));
          const key = left.id < right.id ? `${left.id}:${right.id}` : `${right.id}:${left.id}`;
          const old = forceMap.get(key);
          forceMap.set(key, {
            key,
            a: left,
            b: right,
            point: scale(add(left.position, right.position), 0.5),
            correction: (old?.correction ?? 0) + overlap,
          });
        }
      }

      contacts = [...forceMap.values()];
      for (const contact of contacts) {
        contact.force = contact.correction / Math.max(1e-9, dt * dt);
        contact.a.coordination += 1;
        if (contact.b) contact.b.coordination += 1;
      }
      for (const grain of grains) {
        if (grain.held) continue;
        const old = previousPositions.get(grain.id);
        const inferred = scale(sub(grain.position, old), 1 / dt);
        const contactDamping = Math.exp(-state.friction * grain.coordination * dt * 1.7);
        grain.velocity = {
          x: clamp(inferred.x * contactDamping, -3.5, 3.5),
          y: clamp(inferred.y, -3.5, 3.5),
        };
      }
      pressure += (roofCorrection / Math.max(1e-9, dt * dt) - pressure) * (1 - Math.exp(-4 * dt));

      const newKeys = new Set(contacts.map((contact) => contact.key));
      for (const contact of contacts) {
        if (!previousContactKeys.has(contact.key) && contact.correction > 0.0002) {
          const radius = contact.b ? Math.min(contact.a.radius, contact.b.radius) : contact.a.radius;
          queue.push(eventSpec(
            `grain-contact-${contact.key}-${Math.floor(elapsed * 40)}`,
            clamp(0.78 - radius * 4.5 + (contact.point.y - PACKING_BOUNDS.floor) * 0.12),
            clamp(0.06 + Math.sqrt(contact.correction) * 1.8),
            contact.point.x,
            "triangle",
            0.003,
            0.1,
          ));
        }
      }
      previousContactKeys = newKeys;

      const meanCoordination = grains.reduce((sum, grain) => sum + grain.coordination, 0) / Math.max(1, grains.length);
      const kinetic = grains.reduce((sum, grain) => sum + lengthSquared(grain.velocity), 0) / Math.max(1, grains.length);
      jammed = meanCoordination > 2.5 && pressure > 15 && kinetic < 0.02;
    },

    draw(painter) {
      const roof = roofY();
      painter.line({ x: PACKING_BOUNDS.left, y: PACKING_BOUNDS.floor }, { x: PACKING_BOUNDS.left, y: roof }, { alpha: 0.4 });
      painter.line({ x: PACKING_BOUNDS.right, y: PACKING_BOUNDS.floor }, { x: PACKING_BOUNDS.right, y: roof }, { alpha: 0.4 });
      painter.line({ x: PACKING_BOUNDS.left, y: PACKING_BOUNDS.floor }, { x: PACKING_BOUNDS.right, y: PACKING_BOUNDS.floor }, { color: PACKING_COLOR, width: 1.8, alpha: 0.55 });
      painter.line({ x: PACKING_BOUNDS.left, y: roof }, { x: PACKING_BOUNDS.right, y: roof }, { color: PACKING_COLOR, width: draggingRoof ? 3 : 2, alpha: 0.75 });
      const maximumForce = Math.max(1, ...contacts.map((contact) => contact.force));
      for (const contact of contacts) {
        if (!contact.b) continue;
        const strength = Math.sqrt(contact.force / maximumForce);
        painter.line(contact.a.position, contact.b.position, {
          color: PACKING_COLOR,
          width: 0.6 + strength * 3.2,
          alpha: 0.08 + strength * 0.5,
        });
      }
      for (const grain of grains) {
        const activity = clamp(grain.coordination / 6);
        painter.circle(grain.position, grain.radius, {
          color: grain.held ? PHYSICS_COLORS.point : PACKING_COLOR,
          fill: `rgba(215,230,91,${(0.025 + activity * 0.13).toFixed(3)})`,
          width: 0.8 + activity * 1.2,
          alpha: 0.5 + activity * 0.5,
        });
      }
      if (jammed) painter.text("JAMMED", { x: 0, y: roof + 0.07 }, { color: PACKING_COLOR, size: 10 });
    },

    voices() {
      const strongest = [...contacts]
        .filter((contact) => contact.b)
        .sort((a, b) => b.force - a.force)
        .slice(0, 8)
        .sort((a, b) => a.key.localeCompare(b.key));
      const availableArea = (PACKING_BOUNDS.right - PACKING_BOUNDS.left) * (roofY() - PACKING_BOUNDS.floor);
      const fraction = grains.reduce((sum, grain) => sum + Math.PI * grain.radius * grain.radius, 0) / Math.max(0.01, availableArea);
      return [
        ...strongest.map((contact) => normalizedVoice({
          key: `force-${contact.key}`,
          pitch01: clamp((contact.point.y - PACKING_BOUNDS.floor) / Math.max(0.1, roofY() - PACKING_BOUNDS.floor)),
          gain: clamp(0.018 + Math.sqrt(contact.force) * 0.004, 0, 0.16),
          pan: contact.point.x,
          waveform: "triangle",
        })),
        normalizedVoice({
          key: "packing-fraction",
          pitch01: clamp(0.08 + fraction * 0.48),
          gain: 0.025 + clamp(fraction * 0.04, 0, 0.055),
          pan: 0,
          waveform: "sine",
        }),
      ];
    },

    consumeEvents() { return queue.drain(); },

    metrics() {
      const availableArea = (PACKING_BOUNDS.right - PACKING_BOUNDS.left) * (roofY() - PACKING_BOUNDS.floor);
      const occupiedArea = grains.reduce((sum, grain) => sum + Math.PI * grain.radius * grain.radius, 0);
      const coordination = grains.reduce((sum, grain) => sum + grain.coordination, 0) / Math.max(1, grains.length);
      return {
        packing: `${(100 * occupiedArea / Math.max(0.01, availableArea)).toFixed(1)}%`,
        coordination: coordination.toFixed(2),
        pressure: pressure.toFixed(1),
        state: jammed ? "JAMMED" : "FLOWING",
      };
    },

    pointerDown(point) {
      if (Math.abs(point.y - roofY()) < 0.07) {
        draggingRoof = true;
        return true;
      }
      grabbed = grains
        .filter((grain) => distance(grain.position, point) < grain.radius * 1.45)
        .sort((a, b) => distance(a.position, point) - distance(b.position, point))[0] ?? null;
      if (!grabbed) return false;
      grabbed.held = true;
      pointerPrevious = { ...point };
      return true;
    },

    pointerMove(point) {
      if (draggingRoof) {
        state.compression = clamp((0.78 - point.y) / 0.9, 0, 0.82);
        return true;
      }
      if (!grabbed) return false;
      const target = {
        x: clamp(point.x, PACKING_BOUNDS.left + grabbed.radius, PACKING_BOUNDS.right - grabbed.radius),
        y: clamp(point.y, PACKING_BOUNDS.floor + grabbed.radius, roofY() - grabbed.radius),
      };
      const delta = sub(target, grabbed.position);
      grabbed.position = target;
      grabbed.velocity = add(scale(grabbed.velocity, 0.25), scale(delta, 40));
      pointerPrevious = { ...point };
      return true;
    },

    pointerUp() {
      const handled = Boolean(grabbed || draggingRoof);
      if (grabbed) grabbed.held = false;
      grabbed = null;
      draggingRoof = false;
      pointerPrevious = null;
      return handled;
    },
    primaryActionLabel: "Shake",
    primaryAction() {
      for (const grain of grains) {
        grain.velocity.x += Math.sin(grain.id * 2.399 + elapsed * 11) * 0.42;
        grain.velocity.y += 0.16 + Math.cos(grain.id * 1.731) * 0.08;
      }
      queue.push(eventSpec("packing-shake", 0.24, 0.34, 0, "triangle", 0.003, 0.2));
    },
  };
  scene.reset();
  return scene;
}

// ---------------------------------------------------------------------------
// Geodesic Drift — analytic geodesics on four parameterized surfaces.

const add3 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale3 = (vector, amount) => ({ x: vector.x * amount, y: vector.y * amount, z: vector.z * amount });
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const length3 = (vector) => Math.hypot(vector.x, vector.y, vector.z);
const normalize3 = (vector) => scale3(vector, 1 / Math.max(1e-12, length3(vector)));

function torusDerivative(value) {
  const major = 0.68;
  const minor = 0.27;
  const denominator = Math.max(0.08, major + minor * Math.cos(value.v));
  return {
    u: value.du,
    v: value.dv,
    du: 2 * minor * Math.sin(value.v) / denominator * value.du * value.dv,
    dv: -denominator * Math.sin(value.v) / minor * value.du * value.du,
  };
}

function torusRk4(value, amount) {
  const combine = (origin, derivative, factor) => ({
    u: origin.u + derivative.u * factor,
    v: origin.v + derivative.v * factor,
    du: origin.du + derivative.du * factor,
    dv: origin.dv + derivative.dv * factor,
  });
  const k1 = torusDerivative(value);
  const k2 = torusDerivative(combine(value, k1, amount / 2));
  const k3 = torusDerivative(combine(value, k2, amount / 2));
  const k4 = torusDerivative(combine(value, k3, amount));
  const next = {
    u: value.u + amount / 6 * (k1.u + 2 * k2.u + 2 * k3.u + k4.u),
    v: value.v + amount / 6 * (k1.v + 2 * k2.v + 2 * k3.v + k4.v),
    du: value.du + amount / 6 * (k1.du + 2 * k2.du + 2 * k3.du + k4.du),
    dv: value.dv + amount / 6 * (k1.dv + 2 * k2.dv + 2 * k3.dv + k4.dv),
  };
  next.u = wrap(next.u, TAU);
  next.v = wrap(next.v + Math.PI, TAU) - Math.PI;
  const metricU = 0.68 + 0.27 * Math.cos(next.v);
  const metricSpeed = Math.hypot(metricU * next.du, 0.27 * next.dv);
  next.du /= Math.max(1e-9, metricSpeed);
  next.dv /= Math.max(1e-9, metricSpeed);
  return next;
}

function embedWalker(surface, walker) {
  if (surface === "plane") return { x: walker.u * 0.72, y: walker.v * 0.72, z: 0 };
  if (surface === "cylinder") {
    const radius = 0.56;
    const angle = walker.s / radius;
    return { x: radius * Math.cos(angle), y: walker.z * 0.78, z: radius * Math.sin(angle) };
  }
  if (surface === "sphere") return scale3(walker.p, 0.72);
  const major = 0.68;
  const minor = 0.27;
  const ring = major + minor * Math.cos(walker.v);
  return { x: ring * Math.cos(walker.u), y: minor * Math.sin(walker.v), z: ring * Math.sin(walker.u) };
}

function gaussianCurvature(surface, walker) {
  if (surface === "plane" || surface === "cylinder") return 0;
  if (surface === "sphere") return 1 / (0.72 * 0.72);
  const major = 0.68;
  const minor = 0.27;
  return Math.cos(walker.v) / (minor * (major + minor * Math.cos(walker.v)));
}

export function createGeodesicDriftScene() {
  const controls = [
    selectControl("surface", "surface", [
      { value: "plane", label: "plane" },
      { value: "cylinder", label: "cylinder" },
      { value: "sphere", label: "sphere" },
      { value: "torus", label: "torus" },
    ], "torus"),
    rangeControl("heading", "launch heading", -180, 180, 1, 24, (value) => `${Math.round(value)}°`),
    rangeControl("startLatitude", "start latitude", -75, 75, 1, 22, (value) => `${Math.round(value)}°`),
    rangeControl("nearby", "nearby offset", 0.2, 8, 0.1, 2.2, (value) => `${value.toFixed(1)}°`),
    rangeControl("speed", "travel speed", 0.08, 1, 0.01, 0.34),
    rangeControl("yaw", "view yaw", -180, 180, 1, 28, (value) => `${Math.round(value)}°`),
    rangeControl("pitch", "view pitch", -80, 80, 1, -18, (value) => `${Math.round(value)}°`),
  ];
  const state = Object.fromEntries(controls.map((control) => [control.key, control.value]));
  const queue = makeEventQueue();
  let walkers = [];
  let trails = [[], []];
  let travel = 0;
  let separation = 0;
  let currentCurvature = 0;
  let lastGridKey = null;
  let draggingView = false;
  let pointerPrevious = null;

  function makeWalker(headingDegrees) {
    const heading = headingDegrees * Math.PI / 180;
    const latitude = state.startLatitude * Math.PI / 180;
    if (state.surface === "plane") return { u: -0.76, v: Math.sin(latitude) * 0.55, du: Math.cos(heading), dv: Math.sin(heading) };
    if (state.surface === "cylinder") return { s: 0, z: Math.sin(latitude) * 0.72, ds: Math.cos(heading), dz: Math.sin(heading) };
    if (state.surface === "sphere") {
      const p = { x: Math.cos(latitude), y: Math.sin(latitude), z: 0 };
      const east = { x: 0, y: 0, z: 1 };
      const north = { x: -Math.sin(latitude), y: Math.cos(latitude), z: 0 };
      return { p, tangent: normalize3(add3(scale3(east, Math.cos(heading)), scale3(north, Math.sin(heading)))) };
    }
    const v = latitude * 2;
    const metricU = 0.68 + 0.27 * Math.cos(v);
    return { u: 0, v, du: Math.cos(heading) / metricU, dv: Math.sin(heading) / 0.27 };
  }

  function initializeWalkers() {
    walkers = [makeWalker(state.heading), makeWalker(state.heading + state.nearby)];
    trails = [[embedWalker(state.surface, walkers[0])], [embedWalker(state.surface, walkers[1])]];
    travel = 0;
    separation = 0;
    currentCurvature = gaussianCurvature(state.surface, walkers[0]);
    lastGridKey = null;
  }

  function advanceWalker(walker, amount) {
    if (state.surface === "plane") {
      walker.u += walker.du * amount;
      walker.v += walker.dv * amount;
      return walker;
    }
    if (state.surface === "cylinder") {
      walker.s += walker.ds * amount;
      walker.z += walker.dz * amount;
      return walker;
    }
    if (state.surface === "sphere") {
      const cosine = Math.cos(amount / 0.72);
      const sine = Math.sin(amount / 0.72);
      const nextP = add3(scale3(walker.p, cosine), scale3(walker.tangent, sine));
      const nextTangent = add3(scale3(walker.tangent, cosine), scale3(walker.p, -sine));
      walker.p = normalize3(nextP);
      walker.tangent = normalize3(add3(nextTangent, scale3(walker.p, -dot3(nextTangent, walker.p))));
      return walker;
    }
    return torusRk4(walker, amount);
  }

  function gridKey(walker) {
    if (state.surface === "plane") return `${Math.floor((walker.u + 1) * 5)}:${Math.floor((walker.v + 1) * 5)}`;
    if (state.surface === "cylinder") return `${Math.floor(wrap(walker.s / 0.56, TAU) / TAU * 12)}:${Math.floor((walker.z + 1) * 5)}`;
    if (state.surface === "sphere") {
      const longitude = wrap(Math.atan2(walker.p.z, walker.p.x), TAU);
      const latitude = Math.asin(clamp(walker.p.y, -1, 1));
      return `${Math.floor(longitude / TAU * 12)}:${Math.floor((latitude + Math.PI / 2) / Math.PI * 8)}`;
    }
    return `${Math.floor(wrap(walker.u, TAU) / TAU * 12)}:${Math.floor(wrap(walker.v, TAU) / TAU * 8)}`;
  }

  function project(point) {
    const yaw = state.yaw * Math.PI / 180;
    const pitch = state.pitch * Math.PI / 180;
    const x1 = Math.cos(yaw) * point.x + Math.sin(yaw) * point.z;
    const z1 = -Math.sin(yaw) * point.x + Math.cos(yaw) * point.z;
    const y2 = Math.cos(pitch) * point.y - Math.sin(pitch) * z1;
    const z2 = Math.sin(pitch) * point.y + Math.cos(pitch) * z1;
    const perspective = 3 / Math.max(1.5, 3 - z2);
    return { x: x1 * perspective * 0.86, y: y2 * perspective * 0.86, depth: z2 };
  }

  function surfaceGrid() {
    const lines = [];
    if (state.surface === "plane") {
      for (let index = -5; index <= 5; index += 1) {
        const coordinate = index / 5;
        lines.push([{ x: coordinate * 0.72, y: -0.72, z: 0 }, { x: coordinate * 0.72, y: 0.72, z: 0 }]);
        lines.push([{ x: -0.72, y: coordinate * 0.72, z: 0 }, { x: 0.72, y: coordinate * 0.72, z: 0 }]);
      }
    } else if (state.surface === "cylinder") {
      for (let longitude = 0; longitude < 12; longitude += 1) {
        const angle = longitude / 12 * TAU;
        lines.push(Array.from({ length: 17 }, (_, index) => ({
          x: 0.56 * Math.cos(angle), y: lerp(-0.72, 0.72, index / 16) * 0.78, z: 0.56 * Math.sin(angle),
        })));
      }
      for (let row = 0; row <= 8; row += 1) {
        const y = lerp(-0.72, 0.72, row / 8) * 0.78;
        lines.push(Array.from({ length: 37 }, (_, index) => {
          const angle = index / 36 * TAU;
          return { x: 0.56 * Math.cos(angle), y, z: 0.56 * Math.sin(angle) };
        }));
      }
    } else if (state.surface === "sphere") {
      for (let longitude = 0; longitude < 12; longitude += 1) {
        const lon = longitude / 12 * TAU;
        lines.push(Array.from({ length: 25 }, (_, index) => {
          const lat = lerp(-Math.PI / 2, Math.PI / 2, index / 24);
          return { x: 0.72 * Math.cos(lat) * Math.cos(lon), y: 0.72 * Math.sin(lat), z: 0.72 * Math.cos(lat) * Math.sin(lon) };
        }));
      }
      for (let row = -3; row <= 3; row += 1) {
        const lat = row / 4 * Math.PI / 2;
        lines.push(Array.from({ length: 37 }, (_, index) => {
          const lon = index / 36 * TAU;
          return { x: 0.72 * Math.cos(lat) * Math.cos(lon), y: 0.72 * Math.sin(lat), z: 0.72 * Math.cos(lat) * Math.sin(lon) };
        }));
      }
    } else {
      for (let uIndex = 0; uIndex < 12; uIndex += 1) {
        const u = uIndex / 12 * TAU;
        lines.push(Array.from({ length: 29 }, (_, index) => embedWalker("torus", { u, v: index / 28 * TAU })));
      }
      for (let vIndex = 0; vIndex < 8; vIndex += 1) {
        const v = vIndex / 8 * TAU;
        lines.push(Array.from({ length: 37 }, (_, index) => embedWalker("torus", { u: index / 36 * TAU, v })));
      }
    }
    return lines;
  }

  const scene = {
    id: "geodesic-drift",
    title: "Geodesic Drift",
    kicker: "GEODESIC / CURVATURE / DIVERGENCE",
    description: "Nearby straightest paths cross curved surfaces; their separation reveals intrinsic curvature.",
    instruction: "Compare the plane and cylinder, then the sphere and torus. Drag to rotate the surface.",
    lesson: "A geodesic is locally straight on its surface. Gaussian curvature determines whether nearby geodesics tend to converge, remain parallel, or diverge.",
    color: GEODESIC_COLOR,
    mappings: [["Gaussian curvature", "pitch"], ["Nearby-path separation", "detuning"], ["Grid crossing", "accent"], ["Projected position", "stereo"]],
    controls,
    state,

    reset() {
      initializeWalkers();
      draggingView = false;
      pointerPrevious = null;
      queue.clear();
    },

    setParam(key, value) {
      if (!(key in state)) return;
      state[key] = key === "surface" ? value : finiteNumber(value, state[key]);
      if (["surface", "heading", "startLatitude", "nearby"].includes(key)) initializeWalkers();
    },

    step(dt) {
      const amount = clamp(state.speed, 0.08, 1) * dt;
      walkers = walkers.map((walker) => advanceWalker(walker, amount));
      travel += amount;
      if ((state.surface === "plane" && walkers.some((walker) => Math.abs(walker.u) > 1.02 || Math.abs(walker.v) > 1.02))
        || (state.surface === "cylinder" && walkers.some((walker) => Math.abs(walker.z) > 0.92))) {
        initializeWalkers();
        return;
      }
      const embedded = walkers.map((walker) => embedWalker(state.surface, walker));
      embedded.forEach((point, index) => {
        trails[index].push(point);
        if (trails[index].length > 300) trails[index].shift();
      });
      separation = length3(add3(embedded[0], scale3(embedded[1], -1)));
      currentCurvature = gaussianCurvature(state.surface, walkers[0]);
      const nextGridKey = gridKey(walkers[0]);
      if (lastGridKey !== null && nextGridKey !== lastGridKey) {
        queue.push(eventSpec(
          `grid-${nextGridKey}-${Math.floor(travel * 20)}`,
          clamp(0.5 + Math.atan(currentCurvature / 3) / Math.PI),
          0.12,
          project(embedded[0]).x,
          "triangle",
          0.003,
          0.1,
        ));
      }
      lastGridKey = nextGridKey;
    },

    draw(painter) {
      const grid = surfaceGrid();
      for (const line of grid) painter.polyline(line.map(project), { color: GEODESIC_COLOR, width: 0.65, alpha: 0.13 });
      painter.polyline(trails[1].map(project), { color: PHYSICS_COLORS.violet, width: 1.2, alpha: 0.48 });
      painter.polyline(trails[0].map(project), { color: GEODESIC_COLOR, width: 2, alpha: 0.85 });
      const positions = walkers.map((walker) => project(embedWalker(state.surface, walker)));
      painter.circle(positions[1], 0.015, { color: PHYSICS_COLORS.violet, fill: PHYSICS_COLORS.violet, width: 0 });
      painter.circle(positions[0], 0.02, { color: PHYSICS_COLORS.point, fill: PHYSICS_COLORS.point, width: 0 });
      painter.line(positions[0], positions[1], { color: PHYSICS_COLORS.point, width: 0.7, alpha: 0.28, dash: [3, 4] });
    },

    voices() {
      const positions = walkers.map((walker) => project(embedWalker(state.surface, walker)));
      const curvaturePitch = clamp(0.5 + Math.atan(currentCurvature / 3) / Math.PI);
      const spread = clamp(separation / 0.5);
      return [
        normalizedVoice({ key: "geodesic-primary", pitch01: curvaturePitch, gain: 0.11, pan: positions[0].x, waveform: "sine" }),
        normalizedVoice({ key: "geodesic-neighbour", pitch01: clamp(curvaturePitch + 0.055 * spread), gain: 0.07 + 0.035 * spread, pan: positions[1].x, waveform: "sine" }),
      ];
    },

    consumeEvents() { return queue.drain(); },

    metrics() {
      return {
        curvature: `${currentCurvature >= 0 ? "+" : ""}${currentCurvature.toFixed(3)}`,
        separation: separation.toFixed(3),
        distance: travel.toFixed(2),
      };
    },

    pointerDown(point) {
      draggingView = true;
      pointerPrevious = { ...point };
      return true;
    },

    pointerMove(point) {
      if (!draggingView || !pointerPrevious) return false;
      const delta = sub(point, pointerPrevious);
      state.yaw = ((state.yaw + delta.x * 120 + 180) % 360 + 360) % 360 - 180;
      state.pitch = clamp(state.pitch + delta.y * 120, -80, 80);
      pointerPrevious = { ...point };
      return true;
    },

    pointerUp() {
      const handled = draggingView;
      draggingView = false;
      pointerPrevious = null;
      return handled;
    },
    primaryActionLabel: "Relaunch",
    primaryAction() {
      initializeWalkers();
      queue.push(eventSpec("geodesic-relaunch", clamp(0.5 + Math.atan(currentCurvature / 3) / Math.PI), 0.3, 0, "sine", 0.004, 0.2));
    },
  };
  scene.reset();
  return scene;
}

// ---------------------------------------------------------------------------
// Kinetic Hull — moving points, a changing convex boundary and Delaunay net.

function hullArea(points) {
  return polygonAreaAbsolute(points);
}

function exteriorTurn(previous, point, next) {
  const incoming = normalize(sub(point, previous));
  const outgoing = normalize(sub(next, point));
  return Math.acos(clamp(dot(incoming, outgoing), -1, 1));
}

export function createKineticHullScene() {
  const controls = [
    rangeControl("points", "moving points", 8, 28, 1, 18),
    rangeControl("speed", "point speed", 0.04, 0.8, 0.01, 0.27),
    selectControl("boundary", "boundary", [
      { value: "box", label: "rectangle" },
      { value: "circle", label: "circle" },
    ], "box"),
    selectControl("structure", "structure", [
      { value: "hull", label: "convex hull" },
      { value: "delaunay", label: "Delaunay" },
      { value: "both", label: "both" },
    ], "both"),
    rangeControl("trail", "trail length", 0, 40, 1, 18),
  ];
  const state = Object.fromEntries(controls.map((control) => [control.key, control.value]));
  const queue = makeEventQueue();
  let points = [];
  let hull = [];
  let triangulation = [];
  let previousHullIds = new Set();
  let previousEdgeKeys = new Set();
  let flashes = [];
  let selected = null;
  let pointerPrevious = null;
  let structureClock = 0;
  let lastEdgeChanges = 0;
  let elapsed = 0;

  function updateStructures(emit = true) {
    // The shared computational-geometry helpers operate on top-level x/y
    // records. Keep simulation state in `position`, but hand them lightweight
    // identity-preserving projections and resolve the ids back afterward.
    const byId = new Map(points.map((point) => [point.id, point]));
    const geometryPoints = points.map((point) => ({
      id: point.id,
      x: point.position.x,
      y: point.position.y,
    }));
    const nextHull = convexHull(geometryPoints).map((point) => byId.get(point.id));
    const nextHullIds = new Set(nextHull.map((point) => point.id));
    if (emit) {
      const changed = [...nextHullIds].filter((id) => !previousHullIds.has(id))
        .concat([...previousHullIds].filter((id) => !nextHullIds.has(id)));
      for (const id of changed.slice(0, 4)) {
        const point = points.find((candidate) => candidate.id === id);
        if (!point) continue;
        flashes.push({ kind: "point", id, ttl: 0.28 });
        queue.push(eventSpec(
          `hull-change-${id}-${Math.floor(elapsed * 30)}`,
          clamp((point.position.y + 0.78) / 1.56),
          0.24,
          point.position.x,
          "triangle",
          0.004,
          0.18,
        ));
      }
    }
    hull = nextHull;
    previousHullIds = nextHullIds;

    triangulation = delaunayEdges(geometryPoints).map((edge) => ({
      key: edge.key,
      a: byId.get(edge.a.id),
      b: byId.get(edge.b.id),
    }));
    const nextEdgeKeys = new Set(triangulation.map((edge) => edge.key));
    const added = [...nextEdgeKeys].filter((key) => !previousEdgeKeys.has(key));
    const removed = [...previousEdgeKeys].filter((key) => !nextEdgeKeys.has(key));
    lastEdgeChanges = emit ? added.length + removed.length : 0;
    if (emit) {
      for (const key of added.slice(0, 3)) {
        const edge = triangulation.find((candidate) => candidate.key === key);
        if (!edge) continue;
        flashes.push({ kind: "edge", key, ttl: 0.22 });
        const midpoint = scale(add(edge.a.position, edge.b.position), 0.5);
        queue.push(eventSpec(
          `edge-change-${key}-${Math.floor(elapsed * 30)}`,
          clamp(0.78 - distance(edge.a.position, edge.b.position) * 0.42),
          0.13,
          midpoint.x,
          "square",
          0.003,
          0.1,
        ));
      }
    }
    previousEdgeKeys = nextEdgeKeys;
  }

  const scene = {
    id: "kinetic-hull",
    title: "Kinetic Hull",
    kicker: "CONVEXITY / DELAUNAY / TOPOLOGY",
    description: "Moving points continually renegotiate their convex boundary and nearest-neighbour triangulation.",
    instruction: "Drag a point and release it. Boundary membership and Delaunay edge changes become notes.",
    lesson: "Continuous point motion produces discrete combinatorial events: points enter or leave the convex hull and Delaunay diagonals exchange at critical configurations.",
    color: HULL_COLOR,
    mappings: [["Hull-point height", "pitch"], ["Exterior turn", "voice level"], ["Edge change", "accent"], ["Hull area", "bass pitch"]],
    controls,
    state,

    reset() {
      const random = mulberry32(0x4b11c0);
      const count = Math.round(clamp(finiteNumber(state.points, 18), 8, 28));
      points = [];
      for (let index = 0; index < count; index += 1) {
        let position;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const candidate = { x: lerp(-0.82, 0.82, random()), y: lerp(-0.64, 0.64, random()) };
          if (state.boundary !== "circle" || length(candidate) < 0.78) {
            position = candidate;
            break;
          }
        }
        position ??= { x: 0, y: 0 };
        const angle = random() * TAU;
        points.push({
          id: index,
          position,
          direction: { x: Math.cos(angle), y: Math.sin(angle) },
          trail: [{ ...position }],
          held: false,
        });
      }
      hull = [];
      triangulation = [];
      previousHullIds = new Set();
      previousEdgeKeys = new Set();
      flashes = [];
      selected = null;
      pointerPrevious = null;
      structureClock = 0;
      lastEdgeChanges = 0;
      elapsed = 0;
      queue.clear();
      updateStructures(false);
    },

    setParam(key, value) {
      if (!(key in state)) return;
      state[key] = ["boundary", "structure"].includes(key) ? value : finiteNumber(value, state[key]);
      if (key === "points" || key === "boundary") scene.reset();
    },

    step(dt) {
      elapsed += dt;
      for (const point of points) {
        if (point.held) continue;
        point.position = add(point.position, scale(point.direction, state.speed * dt));
        if (state.boundary === "circle") {
          const radius = 0.82;
          const magnitude = length(point.position);
          if (magnitude > radius) {
            const outward = scale(point.position, 1 / magnitude);
            point.position = scale(outward, radius);
            point.direction = normalize(sub(point.direction, scale(outward, 2 * dot(point.direction, outward))));
          }
        } else {
          if (point.position.x < -0.92 || point.position.x > 0.92) {
            point.position.x = clamp(point.position.x, -0.92, 0.92);
            point.direction.x *= -1;
          }
          if (point.position.y < -0.72 || point.position.y > 0.72) {
            point.position.y = clamp(point.position.y, -0.72, 0.72);
            point.direction.y *= -1;
          }
        }
        point.trail.push({ ...point.position });
        const trailLength = Math.round(clamp(state.trail, 0, 40));
        while (point.trail.length > Math.max(1, trailLength)) point.trail.shift();
      }
      const byId = new Map(points.map((point) => [point.id, point]));
      hull = convexHull(points.map((point) => ({
        id: point.id,
        x: point.position.x,
        y: point.position.y,
      }))).map((point) => byId.get(point.id));
      const nextHullIds = new Set(hull.map((point) => point.id));
      if ([...nextHullIds].some((id) => !previousHullIds.has(id)) || [...previousHullIds].some((id) => !nextHullIds.has(id))) {
        updateStructures(true);
        structureClock = 0;
      } else {
        previousHullIds = nextHullIds;
        structureClock += dt;
        if (structureClock >= 1 / 24) {
          updateStructures(true);
          structureClock %= 1 / 24;
        } else lastEdgeChanges = 0;
      }
      flashes = flashes.map((flash) => ({ ...flash, ttl: flash.ttl - dt })).filter((flash) => flash.ttl > 0);
    },

    draw(painter) {
      if (state.boundary === "circle") painter.circle({ x: 0, y: 0 }, 0.82, { color: PHYSICS_COLORS.line, fill: null, width: 1, alpha: 0.5 });
      else painter.polyline([
        { x: -0.92, y: -0.72 }, { x: 0.92, y: -0.72 },
        { x: 0.92, y: 0.72 }, { x: -0.92, y: 0.72 },
      ], { close: true, color: PHYSICS_COLORS.line, width: 1, alpha: 0.45 });
      if (state.structure === "delaunay" || state.structure === "both") {
        for (const edge of triangulation) {
          const flash = flashes.find((candidate) => candidate.kind === "edge" && candidate.key === edge.key);
          painter.line(edge.a.position, edge.b.position, {
            color: flash ? PHYSICS_COLORS.point : PHYSICS_COLORS.blue,
            width: flash ? 2 : 0.75,
            alpha: flash ? clamp(flash.ttl * 4) : 0.2,
          });
        }
      }
      if ((state.structure === "hull" || state.structure === "both") && hull.length > 2) {
        painter.polyline(hull.map((point) => point.position), {
          close: true,
          color: HULL_COLOR,
          width: 2,
          alpha: 0.82,
          fill: "rgba(245,166,91,0.055)",
        });
      }
      for (const point of points) {
        if (state.trail > 1) painter.polyline(point.trail, { color: HULL_COLOR, width: 0.7, alpha: 0.12 });
        const onHull = previousHullIds.has(point.id);
        const flash = flashes.find((candidate) => candidate.kind === "point" && candidate.id === point.id);
        painter.circle(point.position, point.held ? 0.027 : onHull ? 0.021 : 0.014, {
          color: flash ? PHYSICS_COLORS.point : onHull ? HULL_COLOR : PHYSICS_COLORS.muted,
          fill: onHull ? "rgba(245,166,91,0.22)" : PHYSICS_COLORS.background,
          width: point.held ? 2.2 : 1.2,
          alpha: flash ? 1 : onHull ? 0.95 : 0.6,
        });
      }
    },

    voices() {
      const ranked = hull.map((point, index) => ({
        point,
        turn: exteriorTurn(hull[(index - 1 + hull.length) % hull.length], point, hull[(index + 1) % hull.length]),
      })).sort((a, b) => b.turn - a.turn).slice(0, 10).sort((a, b) => a.point.id - b.point.id);
      const area = hull.length > 2 ? hullArea(hull.map((point) => point.position)) : 0;
      return [
        ...ranked.map(({ point, turn }) => normalizedVoice({
          key: `hull-${point.id}`,
          pitch01: clamp((point.position.y + 0.72) / 1.44),
          gain: clamp(0.025 + turn / Math.PI * 0.16),
          pan: point.position.x,
          waveform: "sine",
        })),
        normalizedVoice({ key: "hull-area", pitch01: clamp(0.08 + area * 0.22), gain: 0.025 + clamp(area * 0.015, 0, 0.03), pan: 0, waveform: "triangle" }),
      ];
    },

    consumeEvents() { return queue.drain(); },

    metrics() {
      const positions = hull.map((point) => point.position);
      return {
        hull: `${hull.length}/${points.length}`,
        area: (positions.length > 2 ? hullArea(positions) : 0).toFixed(3),
        perimeter: (positions.length > 2 ? polygonPerimeter(positions) : 0).toFixed(3),
        changes: lastEdgeChanges,
      };
    },

    pointerDown(point) {
      selected = points
        .filter((candidate) => distance(candidate.position, point) < 0.075)
        .sort((a, b) => distance(a.position, point) - distance(b.position, point))[0] ?? null;
      if (selected) {
        selected.held = true;
        pointerPrevious = { ...point };
        return true;
      }
      if (points.length < 28) {
        const id = Math.max(-1, ...points.map((candidate) => candidate.id)) + 1;
        points.push({ id, position: { ...point }, direction: normalize({ x: Math.cos(id * 2.17), y: Math.sin(id * 2.17) }), trail: [{ ...point }], held: false });
        state.points = points.length;
        updateStructures(true);
        return true;
      }
      return false;
    },

    pointerMove(point) {
      if (!selected) return false;
      const delta = sub(point, selected.position);
      selected.position = { ...point };
      if (lengthSquared(delta) > 1e-8) selected.direction = normalize(add(scale(selected.direction, 0.3), scale(normalize(delta), 0.7)));
      selected.trail.push({ ...point });
      pointerPrevious = { ...point };
      return true;
    },

    pointerUp() {
      if (!selected) return false;
      selected.held = false;
      selected = null;
      pointerPrevious = null;
      updateStructures(true);
      return true;
    },
    primaryActionLabel: "Reseed",
    primaryAction() { scene.reset(); },
  };
  scene.reset();
  return scene;
}

export const ADVANCED_PHYSICS_SCENES = Object.freeze([
  Object.freeze({ id: "falling-forms", title: "Falling Forms", create: createFallingFormsScene }),
  Object.freeze({ id: "charge-garden", title: "Charge Garden", create: createChargeGardenScene }),
  Object.freeze({ id: "packing-pressure", title: "Packing Pressure", create: createPackingPressureScene }),
  Object.freeze({ id: "geodesic-drift", title: "Geodesic Drift", create: createGeodesicDriftScene }),
  Object.freeze({ id: "kinetic-hull", title: "Kinetic Hull", create: createKineticHullScene }),
]);
