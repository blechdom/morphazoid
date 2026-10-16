import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const range = (min, max, step, def, dice = [min, max]) => Object.freeze({ type: "range", min, max, step, def, dice });
const select = (values, def) => Object.freeze({ type: "select", values: Object.freeze(values), def });

export const PHYSICS_SOUND_SPEC = Object.freeze({
  baseFrequency: range(20, 440, 1, 110, [45, 300]),
  pitchRange: range(0.5, 5, 0.1, 3, [1.2, 4.6]),
  timeScale: range(0.15, 2, 0.05, 1, [0.4, 1.7]),
});

export const PHYSICS_PARAM_SPECS = Object.freeze({
  "gravity-walk": {
    sides: range(3, 12, 1, 5),
    roundness: range(0, 1, 0.01, 0.18),
    rotation: range(-180, 180, 1, 0),
    gravity: range(0, 3, 0.01, 1.35, [0.35, 3]),
    gravityAngle: range(-180, 180, 1, 0),
    drag: range(0, 1.5, 0.01, 0.12, [0.02, 0.9]),
    kick: range(0.1, 3, 0.05, 1.15),
  },
  ricochet: {
    preset: select(["regular", "asymmetric", "star", "tunnel"], "regular"),
    sides: range(3, 12, 1, 6),
    rotation: range(-180, 180, 1, 0),
    rotationSpeed: range(-120, 120, 1, 0, [-100, 100]),
    launchVelocity: range(0.15, 4, 0.01, 0.78, [0.25, 3.6]),
    launchAngle: range(-180, 180, 1, 27),
    restitution: range(0.55, 1, 0.01, 1, [0.65, 1]),
    trail: range(24, 240, 1, 120),
  },
  rigidity: {
    structure: select(["square", "braced", "triangle", "truss"], "square"),
    load: range(0, 3, 0.01, 1.15, [0.2, 3]),
    loadAngle: range(-45, 45, 1, 12),
    flexibility: range(0, 1, 0.01, 0.16, [0, 0.95]),
    damping: range(0, 5, 0.05, 1.4, [0.05, 4.5]),
  },
  "rolling-measure": {
    sides: range(3, 12, 1, 5),
    radius: range(0.25, 0.56, 0.01, 0.42),
    slope: range(-25, 35, 1, 10, [-6, 32]),
    gravity: range(0, 3, 0.01, 1.25, [0.6, 2.8]),
    drive: range(-1.5, 1.5, 0.01, 0.44, [-1.4, 1.4]),
    restitution: range(0.35, 1, 0.01, 0.86),
    drag: range(0, 1.5, 0.01, 0.1, [0, 0.7]),
  },
  "falling-forms": {
    count: range(1, 8, 1, 5),
    sides: select(["mixed", 3, 4, 5, 6], "mixed"),
    gravity: range(0, 1.5, 0.01, 0.8, [0.2, 1.5]),
    restitution: range(0, 0.9, 0.01, 0.24),
    friction: range(0, 1, 0.01, 0.55),
    angularDrag: range(0, 1.5, 0.01, 0.12),
  },
  "charge-garden": {
    arrangement: select(["dipole", "quadrupole", "ring", "random"], "quadrupole"),
    sources: range(2, 8, 1, 4),
    tracerCharge: select([1, -1], 1),
    strength: range(0.1, 1.5, 0.01, 0.62, [0.15, 1.5]),
    softening: range(0.035, 0.16, 0.005, 0.075),
    damping: range(0, 2, 0.01, 0.34, [0.02, 1.8]),
  },
  "packing-pressure": {
    grains: range(12, 72, 1, 44),
    spread: range(0, 0.42, 0.01, 0.2),
    gravity: range(0, 1.5, 0.01, 0.82, [0.1, 1.5]),
    friction: range(0, 1, 0.01, 0.5),
    compression: range(0, 0.82, 0.01, 0.14),
    agitation: range(0, 1, 0.01, 0.04),
  },
  "geodesic-drift": {
    surface: select(["plane", "cylinder", "sphere", "torus"], "torus"),
    heading: range(-180, 180, 1, 24),
    startLatitude: range(-75, 75, 1, 22),
    nearby: range(0.2, 8, 0.1, 2.2),
    speed: range(0.08, 1, 0.01, 0.34, [0.1, 1]),
    yaw: range(-180, 180, 1, 28),
    pitch: range(-80, 80, 1, -18, [-70, 70]),
  },
  "kinetic-hull": {
    points: range(8, 28, 1, 18),
    speed: range(0.04, 0.8, 0.01, 0.27),
    boundary: select(["box", "circle"], "box"),
    structure: select(["hull", "delaunay", "both"], "both"),
    trail: range(0, 40, 1, 18),
  },
});

export const PHYSICS_SCENE_IDS = Object.freeze(Object.keys(PHYSICS_PARAM_SPECS));
const REBUILD_ON_RESET = new Set(["falling-forms", "charge-garden", "packing-pressure", "geodesic-drift", "kinetic-hull"]);

const decimals = step => (String(step).split(".")[1] ?? "").length;

function normalizeValue(spec, value) {
  if (spec.type === "select") return spec.values.find(candidate => candidate === value || String(candidate) === String(value)) ?? spec.def;
  const number = Number(value);
  const bounded = Math.min(spec.max, Math.max(spec.min, Number.isFinite(number) ? number : spec.def));
  const snapped = spec.min + Math.round((bounded - spec.min) / spec.step) * spec.step;
  return Number(Math.min(spec.max, snapped).toFixed(Math.max(decimals(spec.step), decimals(spec.min))));
}

const specsFor = id => {
  const specs = PHYSICS_PARAM_SPECS[id];
  if (!specs) throw new RangeError(`Unknown physics instrument: ${id}`);
  return specs;
};

export function capturePhysicsPreset(id, state, sound) {
  const specs = specsFor(id);
  return {
    params: Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, normalizeValue(spec, state?.[key])])),
    sound: Object.fromEntries(Object.entries(PHYSICS_SOUND_SPEC).map(([key, spec]) => [key, normalizeValue(spec, sound?.[key])])),
  };
}

export function validatePhysicsPreset(id, snapshot) {
  const valid = snapshot && typeof snapshot === "object" && snapshot.params && snapshot.sound
    && presetStateKey(snapshot) === presetStateKey(capturePhysicsPreset(id, snapshot.params, snapshot.sound));
  if (!valid) throw new TypeError(`Invalid complete ${id} preset`);
  return snapshot;
}

/** Restores scene parameters and returns the sound settings for the page to apply. */
export function applyPhysicsPreset(id, scene, snapshot) {
  const { params, sound } = validatePhysicsPreset(id, snapshot);
  const rebuildsFromState = REBUILD_ON_RESET.has(id);
  if (!rebuildsFromState) scene.reset();
  for (const key of Object.keys(specsFor(id))) scene.setParam(key, params[key]);
  if (rebuildsFromState) scene.reset();
  return { ...sound };
}

function rollingTorqueRange({ sides, radius, slope, gravity }) {
  const half = radius * Math.sin(Math.PI / sides), inradius = radius * Math.cos(Math.PI / sides);
  const tilt = slope * Math.PI / 180, beta = 2 * Math.PI / sides;
  let low = Infinity, high = -Infinity;
  for (let i = 0; i <= 48; i++) {
    const phase = beta * i / 48;
    const x = -half * Math.cos(phase) + inradius * Math.sin(phase), y = half * Math.sin(phase) + inradius * Math.cos(phase);
    const torque = gravity * (x * Math.cos(tilt) + y * Math.sin(tilt));
    low = Math.min(low, torque); high = Math.max(high, torque);
  }
  return { low, high };
}

const CONSTRAINTS = {
  // A polygon rests in its contact basin unless the drive torque beats the gravity barrier.
  "rolling-measure"(params, rng) {
    const forward = rng.unit() < 0.8, margin = 0.12;
    for (let pass = 0; pass < 2; pass++) {
      const { low, high } = rollingTorqueRange(params);
      const barrier = forward ? Math.max(0, -low) : Math.max(0, high);
      if (barrier + margin > 1.25 && barrier > 0) params.gravity = Math.max(0.1, params.gravity * (1.1 / barrier));
    }
    const { low, high } = rollingTorqueRange(params);
    params.drive = forward
      ? Math.min(1.5, Math.max(Math.abs(params.drive), -low + margin, 0.25))
      : -Math.min(1.5, Math.max(Math.abs(params.drive), high + margin, 0.25));
  },
  "charge-garden"(params) {
    if (params.arrangement === "dipole") params.sources = Math.min(params.sources, 6);
  },
};

export function randomizePhysicsPreset(id, current, random = Math.random) {
  validatePhysicsPreset(id, current);
  const rng = presetRandom(random);
  const draw = spec => (spec.type === "select" ? rng.pick(spec.values) : rng.between(...spec.dice));
  const params = Object.fromEntries(Object.entries(specsFor(id)).map(([key, spec]) => [key, draw(spec)]));
  CONSTRAINTS[id]?.(params, rng);
  const sound = Object.fromEntries(Object.entries(PHYSICS_SOUND_SPEC).map(([key, spec]) => [key, draw(spec)]));
  return validatePhysicsPreset(id, capturePhysicsPreset(id, params, sound));
}

const SOUND_KEYS = Object.keys(PHYSICS_SOUND_SPEC);

function bank(id, rows) {
  return Object.freeze(rows.map(([presetId, label, overrides, sound = []]) => {
    const defaults = Object.fromEntries(Object.entries(PHYSICS_PARAM_SPECS[id]).map(([key, spec]) => [key, spec.def]));
    const soundValues = Object.fromEntries(SOUND_KEYS.map((key, index) => [key, sound[index] ?? PHYSICS_SOUND_SPEC[key].def]));
    const snapshot = capturePhysicsPreset(id, { ...defaults, ...overrides }, soundValues);
    for (const [key, value] of Object.entries({ ...overrides })) {
      if (snapshot.params[key] !== value) throw new RangeError(`${id}/${presetId}: ${key}=${value} is not a valid value`);
    }
    return Object.freeze({ id: `${id}-${presetId}`, label, snapshot: Object.freeze(snapshot) });
  }));
}

export const PHYSICS_FULL_PRESETS = Object.freeze({
  "gravity-walk": bank("gravity-walk", [
    ["factory", "Factory pentagon", {}],
    ["pendulum-bowl", "Pendulum bowl", { sides: 12, roundness: 1, gravity: 1.6, drag: 0.05, kick: 0.8 }, [98, 2.5]],
    ["triangle-drop", "Triangle drop", { sides: 3, roundness: 0, gravity: 1.8, drag: 0.1, kick: 1.4 }, [147, 3.5]],
    ["square-rattle", "Square rattle", { sides: 4, roundness: 0, rotation: 45, gravity: 2.2, drag: 0.06, kick: 1.9 }, [82, 3, 1.3]],
    ["hex-slide", "Hex slide", { sides: 6, roundness: 0.35, rotation: 30, gravity: 1, gravityAngle: 90, drag: 0.2, kick: 1.1 }, [123, 3]],
    ["slow-moon", "Slow moon", { sides: 8, roundness: 0.6, gravity: 0.45, drag: 0.03, kick: 2.4 }, [55, 4, 0.7]],
    ["tilted-heptagon", "Tilted heptagon", { sides: 7, roundness: 0.05, rotation: -20, gravity: 1.9, gravityAngle: -35, drag: 0.15, kick: 1.5 }, [196, 2]],
    ["inverted-crawler", "Inverted crawler", { sides: 5, roundness: 0.1, rotation: 36, gravity: 2.8, gravityAngle: 180, drag: 0.9, kick: 3 }, [73, 2.8, 0.8]],
    ["pentagon-glider", "Pentagon glider", { sides: 5, roundness: 0.8, rotation: -72, gravity: 0.9, gravityAngle: 20, drag: 0.01, kick: 0.5 }, [220, 4.5, 1.5]],
    ["octagon-drum", "Octagon drum", { sides: 8, roundness: 0, rotation: 22, gravity: 2.4, gravityAngle: -90, drag: 0.35, kick: 2 }, [65, 2.2]],
    ["dodecagon-spinner", "Dodecagon spinner", { sides: 12, roundness: 0, gravity: 1.2, gravityAngle: 60, drag: 0.02, kick: 1 }, [330, 1.5, 1.8]],
    ["teardrop-swing", "Teardrop swing", { sides: 3, roundness: 1, rotation: 90, gravity: 1.4, drag: 0.08, kick: 1.2 }, [73, 3.8]],
    ["squircle-lullaby", "Squircle lullaby", { sides: 4, roundness: 0.7, rotation: -45, gravity: 0.7, drag: 0.5, kick: 0.4 }, [261, 1.2, 0.5]],
  ]),
  ricochet: bank("ricochet", [
    ["factory", "Factory hexagon", {}],
    ["hexagon-room", "Hexagon room", { launchVelocity: 1.4, launchAngle: 63, trail: 200 }, [165, 3]],
    ["triangle-prism", "Triangle prism", { sides: 3, rotation: 15, launchVelocity: 1.1, launchAngle: -50, restitution: 0.97, trail: 150 }, [130, 3.5]],
    ["square-cage-spin", "Square cage spin", { sides: 4, rotationSpeed: 30, launchVelocity: 1, launchAngle: 35, trail: 100 }, [98, 2.4]],
    ["pentagram", "Pentagram", { preset: "star", sides: 5, launchVelocity: 0.9, launchAngle: 80, restitution: 0.95, trail: 180 }, [196, 4]],
    ["star-carousel", "Star carousel", { preset: "star", sides: 7, rotation: 10, rotationSpeed: -45, launchVelocity: 1.6, launchAngle: -20, restitution: 0.9, trail: 120 }, [247, 3.2, 1.2]],
    ["bent-tunnel-run", "Bent tunnel run", { preset: "tunnel", launchVelocity: 1.8, launchAngle: 10, restitution: 0.98, trail: 240 }, [110, 2.6]],
    ["tunnel-turbine", "Tunnel turbine", { preset: "tunnel", rotation: 90, rotationSpeed: 60, launchVelocity: 2.5, launchAngle: -135, restitution: 0.85, trail: 90 }, [73, 3.4, 1.4]],
    ["lopsided-chamber", "Lopsided chamber", { preset: "asymmetric", sides: 7, rotation: 20, launchVelocity: 0.6, launchAngle: 120, trail: 140 }, [185, 3.8, 0.8]],
    ["nonagon-whirl", "Nonagon whirl", { preset: "asymmetric", sides: 9, rotation: -30, rotationSpeed: 90, launchVelocity: 1.2, launchAngle: 5, restitution: 0.92, trail: 60 }, [294, 2.2, 1.3]],
    ["slow-dodecagon", "Slow dodecagon", { sides: 12, rotation: 7, rotationSpeed: 8, launchVelocity: 0.3, launchAngle: 160, trail: 240 }, [58, 4.4, 0.6]],
    ["fast-diamond", "Fast diamond", { sides: 4, rotation: 45, launchVelocity: 3.4, launchAngle: 45, restitution: 0.75, trail: 40 }, [330, 1.4, 1.6]],
    ["wobbly-star", "Wobbly star", { preset: "star", sides: 4, rotation: 45, rotationSpeed: 20, launchVelocity: 0.5, launchAngle: -90, restitution: 0.7, trail: 200 }, [138, 3]],
  ]),
  rigidity: bank("rigidity", [
    ["factory", "Factory square", {}],
    ["braced-stiff", "Braced stiff", { structure: "braced", load: 1.6, loadAngle: 0, flexibility: 0.05, damping: 2 }, [130, 2.4]],
    ["wobbly-square", "Wobbly square", { load: 0.7, loadAngle: -18, flexibility: 0.6, damping: 0.3 }, [87, 3.4, 1.2]],
    ["rubber-triangle", "Rubber triangle", { structure: "triangle", load: 2, loadAngle: 25, flexibility: 0.85, damping: 0.6 }, [196, 3.6]],
    ["truss-bridge", "Truss bridge", { structure: "truss", load: 1.4, loadAngle: 5, flexibility: 0.2, damping: 1 }, [65, 2.8]],
    ["jelly-truss", "Jelly truss", { structure: "truss", load: 2.6, loadAngle: -30, flexibility: 0.95, damping: 0.2 }, [147, 4.2, 1.4]],
    ["heavy-square", "Heavy square", { load: 3, loadAngle: 0, flexibility: 0.35, damping: 3.5 }, [55, 2]],
    ["gale-frame", "Gale frame", { load: 1.9, loadAngle: 45, flexibility: 0.5, damping: 0.45 }, [220, 3.1, 1.6]],
    ["taut-brace", "Taut brace", { structure: "braced", load: 3, loadAngle: -12, flexibility: 0, damping: 4.5 }, [110, 1.5, 0.8]],
    ["feather-load", "Feather load", { structure: "braced", load: 0.25, loadAngle: 30, flexibility: 0.7, damping: 0.1 }, [330, 4.6, 1.3]],
    ["triangle-tuning-fork", "Triangle tuning fork", { structure: "triangle", load: 0.9, loadAngle: -8, flexibility: 0.1, damping: 0.05 }, [262, 1.6]],
    ["sway-truss", "Sway truss", { structure: "truss", load: 1, loadAngle: 40, flexibility: 0.55, damping: 0.15 }, [92, 3.7, 0.6]],
  ]),
  "rolling-measure": bank("rolling-measure", [
    ["factory", "Factory pentagon", {}],
    ["triangle-tumble", "Triangle tumble", { sides: 3, radius: 0.5, slope: 20, gravity: 0.9, drive: 1.3, restitution: 0.8, drag: 0.08 }, [98, 3.4]],
    ["square-roll", "Square roll", { sides: 4, radius: 0.42, slope: 8, gravity: 1.2, drive: 0.5, restitution: 0.9, drag: 0.1 }, [131, 2.6, 1.2]],
    ["hexagon-cruise", "Hexagon cruise", { sides: 6, radius: 0.38, slope: 5, gravity: 1, drive: 0.45, restitution: 0.95, drag: 0.12 }, [165, 3]],
    ["octagon-glide", "Octagon glide", { sides: 8, radius: 0.45, slope: 12, gravity: 1.4, drive: 0.4, restitution: 0.97, drag: 0.05 }, [208, 2.2]],
    ["dodecagon-wheel", "Dodecagon wheel", { sides: 12, radius: 0.5, slope: 6, gravity: 1, drive: 0.35, restitution: 1, drag: 0.04 }, [247, 1.4, 1.5]],
    ["downhill-pentagon", "Downhill pentagon", { radius: 0.3, slope: 30, gravity: 2.4, drive: 0.1, restitution: 0.7, drag: 0.2 }, [87, 4]],
    ["steady-heptagon", "Steady heptagon", { sides: 7, radius: 0.4, slope: 0, gravity: 1.6, drive: 1.4, restitution: 0.9, drag: 0.3 }, [73, 3.2, 0.8]],
    ["big-slow-triangle", "Big slow triangle", { sides: 3, radius: 0.56, slope: 15, gravity: 0.7, drive: 0.7, restitution: 0.6, drag: 0.6 }, [55, 4.4, 0.6]],
    ["tiny-quick-square", "Tiny quick square", { sides: 4, radius: 0.25, slope: 22, gravity: 2.6, drive: 0.9, restitution: 0.75, drag: 0.05 }, [330, 1.8, 1.7]],
    ["reverse-roll", "Reverse roll", { radius: 0.44, slope: -6, gravity: 1.1, drive: -0.9, restitution: 0.85 }, [123, 2.8, 1.1]],
    ["bouncy-nonagon", "Bouncy nonagon", { sides: 9, radius: 0.36, slope: 14, gravity: 1.5, drive: 0.6, restitution: 1, drag: 0.02 }, [185, 3.6, 1.3]],
    ["sticky-heptagon", "Sticky heptagon", { sides: 7, radius: 0.48, drive: 0.7, gravity: 1.3, restitution: 0.4, drag: 0.5 }, [104, 2.4]],
  ]),
  "falling-forms": bank("falling-forms", [
    ["factory", "Factory mixed drop", {}],
    ["triangle-shower", "Triangle shower", { count: 6, sides: 3, gravity: 1, restitution: 0.35, friction: 0.5, angularDrag: 0.1 }, [147, 3.2]],
    ["square-stack", "Square stack", { count: 5, sides: 4, restitution: 0.05, friction: 0.9, angularDrag: 0.3 }, [98, 2.4]],
    ["pentagon-bounce", "Pentagon bounce", { count: 4, sides: 5, gravity: 1.1, restitution: 0.8, friction: 0.3, angularDrag: 0.05 }, [196, 3.6, 1.2]],
    ["hex-rain", "Hex rain", { count: 8, sides: 6, gravity: 0.7, restitution: 0.45, friction: 0.6, angularDrag: 0.2 }, [165, 2.8]],
    ["moon-drift", "Moon drift", { gravity: 0.25, restitution: 0.6, friction: 0.4, angularDrag: 0.02 }, [65, 4.4, 0.6]],
    ["heavy-mixed", "Heavy mixed", { count: 8, gravity: 1.5, restitution: 0.1, friction: 0.7, angularDrag: 0.6 }, [55, 2]],
    ["lone-triangle", "Lone triangle", { count: 1, sides: 3, gravity: 0.9, restitution: 0.7, friction: 0.2, angularDrag: 0.05 }, [220, 4]],
    ["pair-of-squares", "Pair of squares", { count: 2, sides: 4, gravity: 1.2, restitution: 0.5, friction: 0.8, angularDrag: 0.4 }, [123, 1.8, 1.4]],
    ["pinball-pentagons", "Pinball pentagons", { count: 7, sides: 5, gravity: 1.3, restitution: 0.88, friction: 0.1, angularDrag: 0 }, [262, 3.4, 1.6]],
    ["sticky-hexes", "Sticky hexes", { count: 6, sides: 6, restitution: 0, friction: 1, angularDrag: 1.2 }, [82, 2.6, 0.8]],
    ["slow-tumble", "Slow tumble", { count: 3, gravity: 0.5, restitution: 0.3, friction: 0.15, angularDrag: 0 }, [110, 3.8, 0.5]],
    ["glass-shards", "Glass shards", { count: 8, sides: 3, gravity: 1.4, restitution: 0.6, friction: 0.05, angularDrag: 0.1 }, [330, 4.6, 1.3]],
  ]),
  "charge-garden": bank("charge-garden", [
    ["factory", "Factory quadrupole", {}],
    ["classic-dipole", "Classic dipole", { arrangement: "dipole", sources: 2, strength: 0.9, softening: 0.06, damping: 0.2 }, [110, 3.4]],
    ["dipole-chase", "Dipole chase", { arrangement: "dipole", sources: 2, tracerCharge: -1, strength: 1.2, softening: 0.09, damping: 0.1 }, [165, 2.6, 1.3]],
    ["double-dipole", "Double dipole", { arrangement: "dipole", sources: 4, strength: 0.7, softening: 0.08, damping: 0.5 }, [87, 3]],
    ["ring-of-eight", "Ring of eight", { arrangement: "ring", sources: 8, strength: 0.5, softening: 0.05, damping: 0.25 }, [196, 4.2]],
    ["hexagon-garden", "Hexagon garden", { arrangement: "ring", sources: 6, tracerCharge: -1, strength: 0.8, softening: 0.1, damping: 0.15 }, [147, 3.6, 1.2]],
    ["triangle-ring", "Triangle ring", { arrangement: "ring", sources: 3, strength: 1.1, softening: 0.12, damping: 0.6 }, [123, 2.2]],
    ["scatter-field", "Scatter field", { arrangement: "random", sources: 6, strength: 0.6, softening: 0.07, damping: 0.3 }, [220, 3.8, 0.9]],
    ["dense-scatter", "Dense scatter", { arrangement: "random", sources: 8, tracerCharge: -1, strength: 1, softening: 0.04, damping: 0.05 }, [262, 4.6, 1.5]],
    ["soft-quadrupole", "Soft quadrupole", { tracerCharge: -1, strength: 0.3, softening: 0.15, damping: 1 }, [73, 1.8, 0.6]],
    ["quadrupole-pair", "Quadrupole pair", { sources: 8, strength: 0.45, softening: 0.06, damping: 0.15 }, [98, 3.2]],
    ["pentagon-vortex", "Pentagon vortex", { arrangement: "ring", sources: 5, strength: 1.4, softening: 0.09, damping: 0.02 }, [330, 2.4, 1.7]],
    ["sparse-scatter", "Sparse scatter", { arrangement: "random", sources: 3, strength: 0.25, softening: 0.14, damping: 0.8 }, [58, 4]],
  ]),
  "packing-pressure": bank("packing-pressure", [
    ["factory", "Factory pile", {}],
    ["loose-sand", "Loose sand", { grains: 30, spread: 0.3, gravity: 0.6, friction: 0.2, compression: 0, agitation: 0.1 }, [165, 3.4]],
    ["monodisperse-crystal", "Monodisperse crystal", { grains: 56, spread: 0, gravity: 0.9, friction: 0.4, compression: 0.2, agitation: 0 }, [220, 2.2]],
    ["polydisperse-mix", "Polydisperse mix", { grains: 40, spread: 0.4, gravity: 0.8, friction: 0.7, compression: 0.3, agitation: 0.02 }, [131, 3.8]],
    ["squeeze", "Squeeze", { grains: 48, spread: 0.15, friction: 0.5, compression: 0.65, agitation: 0 }, [98, 2.8, 0.8]],
    ["jammed", "Jammed", { grains: 72, spread: 0.25, gravity: 1.1, friction: 0.9, compression: 0.8, agitation: 0 }, [65, 2]],
    ["shaken-box", "Shaken box", { grains: 36, gravity: 0.8, friction: 0.4, compression: 0.1, agitation: 0.7 }, [262, 3.6, 1.5]],
    ["low-g-pile", "Low-g pile", { spread: 0.35, gravity: 0.2, friction: 0.3, compression: 0.05, agitation: 0.2 }, [147, 4.4, 0.6]],
    ["few-big-grains", "Few big grains", { grains: 12, spread: 0.1, gravity: 1, friction: 0.6, compression: 0.4, agitation: 0.05 }, [82, 3]],
    ["pressure-cooker", "Pressure cooker", { grains: 64, spread: 0.3, gravity: 1.2, friction: 0.6, compression: 0.75, agitation: 0.35 }, [185, 3.2, 1.3]],
    ["heavy-sieve", "Heavy sieve", { grains: 24, spread: 0.42, gravity: 1.5, friction: 0.1, compression: 0.15, agitation: 0.9 }, [110, 1.6, 1.7]],
    ["gentle-compression", "Gentle compression", { grains: 52, spread: 0.12, gravity: 0.5, compression: 0.45, agitation: 0 }, [208, 4.6, 0.7]],
    ["fizz", "Fizz", { grains: 68, spread: 0, gravity: 0.1, friction: 0, compression: 0, agitation: 1 }, [330, 2.4, 1.6]],
  ]),
  "geodesic-drift": bank("geodesic-drift", [
    ["factory", "Factory torus", {}],
    ["plane-parallel", "Plane parallel", { surface: "plane", heading: 15, startLatitude: 10, nearby: 4, speed: 0.4, yaw: 0, pitch: -35 }, [110, 2]],
    ["cylinder-helix", "Cylinder helix", { surface: "cylinder", heading: 35, startLatitude: -10, nearby: 1.5, speed: 0.3, yaw: 40, pitch: -20 }, [147, 3]],
    ["cylinder-ring", "Cylinder ring", { surface: "cylinder", heading: 0, startLatitude: 0, nearby: 3, speed: 0.5, yaw: -30, pitch: -10 }, [196, 2.6, 1.3]],
    ["sphere-great-circle", "Sphere great circle", { surface: "sphere", heading: 0, startLatitude: 0, nearby: 2, speed: 0.4, yaw: 20, pitch: -15 }, [131, 3.4]],
    ["sphere-meridians", "Sphere meridians", { surface: "sphere", heading: 90, startLatitude: -30, nearby: 0.6, speed: 0.25, yaw: 60, pitch: 10 }, [87, 4.2, 0.7]],
    ["sphere-diverge", "Sphere diverge", { surface: "sphere", heading: 45, startLatitude: 45, nearby: 6, speed: 0.6, yaw: -40, pitch: -30 }, [262, 3.8, 1.5]],
    ["torus-winding", "Torus winding", { heading: 60, startLatitude: -40, nearby: 1.2, speed: 0.5, yaw: 10, pitch: -45 }, [165, 2.8]],
    ["torus-inner-ring", "Torus inner ring", { heading: 175, startLatitude: 70, nearby: 0.5, speed: 0.2, yaw: 100, pitch: -25 }, [73, 3.6, 0.8]],
    ["torus-slow-fan", "Torus slow fan", { heading: -45, startLatitude: 15, nearby: 3.5, speed: 0.12, yaw: -60, pitch: -8 }, [58, 4.6, 0.5]],
    ["plane-tight-pair", "Plane tight pair", { surface: "plane", heading: -30, startLatitude: -25, nearby: 0.3, speed: 0.9, yaw: 150, pitch: -60 }, [294, 1.6, 1.6]],
    ["sphere-polar-sweep", "Sphere polar sweep", { surface: "sphere", heading: -80, startLatitude: 70, nearby: 1, speed: 0.15, yaw: 0, pitch: 45 }, [98, 3]],
    ["cylinder-wide-pair", "Cylinder wide pair", { surface: "cylinder", heading: 160, startLatitude: 50, nearby: 7.5, speed: 0.7, yaw: -120, pitch: 20 }, [220, 2.4, 1.2]],
  ]),
  "kinetic-hull": bank("kinetic-hull", [
    ["factory", "Factory swarm", {}],
    ["sparse-hull", "Sparse hull", { points: 8, speed: 0.2, structure: "hull", trail: 10 }, [110, 2.4]],
    ["dense-mesh", "Dense mesh", { points: 28, speed: 0.15, structure: "delaunay", trail: 6 }, [196, 4]],
    ["round-table", "Round table", { points: 16, speed: 0.3, boundary: "circle", trail: 24 }, [147, 3.2]],
    ["circle-swarm", "Circle swarm", { points: 24, speed: 0.5, boundary: "circle", structure: "hull", trail: 30 }, [262, 3.6, 1.4]],
    ["slow-drift", "Slow drift", { points: 12, speed: 0.06, trail: 40 }, [73, 4.2, 0.6]],
    ["fast-scatter", "Fast scatter", { points: 20, speed: 0.75, structure: "delaunay", trail: 0 }, [330, 2, 1.7]],
    ["trailing-comets", "Trailing comets", { points: 10, speed: 0.4, boundary: "circle", structure: "delaunay", trail: 40 }, [165, 3.4]],
    ["triangulated-ring", "Triangulated ring", { points: 28, speed: 0.25, boundary: "circle", structure: "delaunay", trail: 12 }, [98, 2.8]],
    ["hull-dance", "Hull dance", { points: 14, speed: 0.55, structure: "hull", trail: 20 }, [220, 1.8, 1.3]],
    ["quiet-web", "Quiet web", { points: 22, speed: 0.1, boundary: "circle", trail: 32 }, [87, 4.6, 0.5]],
    ["tight-pulse", "Tight pulse", { points: 9, speed: 0.7, trail: 5 }, [185, 2.6, 1.5]],
    ["heavy-field", "Heavy field", { points: 26, speed: 0.35, trail: 15 }, [131, 3.8]],
  ]),
});
