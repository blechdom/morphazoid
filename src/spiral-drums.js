const TAU = Math.PI * 2;
const EPSILON = 1e-9;
const DEFAULT_BOUNDS = Object.freeze({
  innerRadius: 0.045,
  outerRadius: 1.08,
});

const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
);

const wrap01 = (value) => ((value % 1) + 1) % 1;

function quadrant(value) {
  return Math.min(3, Math.floor(clamp(value) * 4));
}

function radialBounds(bounds) {
  const requestedInner = Number(bounds?.innerRadius);
  const requestedOuter = Number(bounds?.outerRadius);
  const first = Number.isFinite(requestedInner) && requestedInner > 0
    ? requestedInner
    : DEFAULT_BOUNDS.innerRadius;
  const second = Number.isFinite(requestedOuter) && requestedOuter > 0
    ? requestedOuter
    : DEFAULT_BOUNDS.outerRadius;
  return {
    innerRadius: Math.max(EPSILON, Math.min(first, second)),
    outerRadius: Math.max(EPSILON * 2, Math.max(first, second)),
  };
}

export const SPIRAL_DRUM_MAPPING_MODES = Object.freeze([
  Object.freeze({
    id: "radius-angle",
    label: "Scale × angle",
    description: "Outer, heavier shapes choose upper drum rows; angular quadrant chooses the column.",
  }),
  Object.freeze({
    id: "shape-angle",
    label: "Tile shape × angle",
    description: "Isohedral edge and tile identity choose the row; angular quadrant chooses the column.",
  }),
  Object.freeze({
    id: "reader-incidence",
    label: "Reader path × incidence",
    description: "Position along the active reader chooses the row; crossing sharpness chooses the column.",
  }),
]);

export function normalizedSpiralContact(contact = {}, bounds = DEFAULT_BOUNDS) {
  const { innerRadius, outerRadius } = radialBounds(bounds);
  const requestedRadius = Number(contact.radius);
  const coordinateRadius = Math.hypot(
    Number(contact.x) || 0,
    Number(contact.y) || 0,
  );
  const radius = clamp(
    Number.isFinite(requestedRadius) && requestedRadius > 0
      ? requestedRadius
      : coordinateRadius > 0
        ? coordinateRadius
        : Math.sqrt(innerRadius * outerRadius),
    innerRadius,
    outerRadius,
  );
  const requestedAngle = Number(contact.angle01);
  const angle01 = Number.isFinite(requestedAngle)
    ? wrap01(requestedAngle)
    : wrap01(
      (Math.atan2(Number(contact.y) || 0, Number(contact.x) || 0) + Math.PI)
        / TAU,
    );
  const radialSpan = Math.max(
    EPSILON,
    Math.log(outerRadius) - Math.log(innerRadius),
  );
  return {
    radius,
    radius01: clamp((Math.log(radius) - Math.log(innerRadius)) / radialSpan),
    angle01,
    along01: clamp(contact.along01),
    incidence: clamp(contact.incidence),
    orientation: clamp(contact.orientation),
  };
}

export function spiralDrumVoiceIndex(contact = {}, {
  mode = "radius-angle",
  bounds = DEFAULT_BOUNDS,
} = {}) {
  const normalized = normalizedSpiralContact(contact, bounds);
  if (mode === "shape-angle") {
    const edgeShape = Math.trunc(Number(contact.edgeShapeId) || 0);
    const aspect = Math.trunc(Number(contact.aspect) || 0);
    const edgeIndex = Math.trunc(Number(contact.edgeIndex) || 0);
    const row = Math.abs(edgeShape * 3 + aspect + edgeIndex) % 4;
    return row * 4 + quadrant(normalized.angle01);
  }
  if (mode === "reader-incidence") {
    return quadrant(normalized.along01) * 4 + quadrant(normalized.incidence);
  }
  const row = 3 - quadrant(normalized.radius01);
  return row * 4 + quadrant(normalized.angle01);
}

export function mappedSpiralDrumVoice(baseVoice, contact = {}, {
  bounds = DEFAULT_BOUNDS,
  pitchDepth = 12,
  characterDepth = 0.7,
  contactCount = 1,
} = {}) {
  const normalized = normalizedSpiralContact(contact, bounds);
  const depth = clamp(pitchDepth, 0, 24);
  const character = clamp(characterDepth);
  const semitones = (1 - 2 * normalized.radius01) * depth;
  const baseFrequency = Number(baseVoice?.frequency) || 60;
  const baseTone = clamp(baseVoice?.tone);
  const baseModIndex = clamp(baseVoice?.modIndex, 0, 20);
  const baseLevel = clamp(baseVoice?.level);
  const headroom = 1 / Math.sqrt(Math.max(1, (Number(contactCount) || 1) / 4));
  const isBell = baseVoice?.family === "bell";
  const mappedModIndex = clamp(
    baseModIndex * (1 - character * 0.45)
      + baseModIndex * (0.55 + normalized.incidence * 0.9) * character,
    0,
    20,
  );
  const mappedLevel = clamp(
    baseLevel * (0.38 + normalized.incidence * 0.62) * headroom,
  );
  return {
    ...baseVoice,
    attack: isBell ? Math.min(Number(baseVoice.attack) || 0.001, 0.006) : baseVoice.attack,
    decay: isBell ? Math.min(Number(baseVoice.decay) || 0.1, 0.58) : baseVoice.decay,
    frequency: clamp(baseFrequency * (2 ** (semitones / 12)), 20, 12_000),
    tone: clamp(
      baseTone * (1 - character) + normalized.incidence * character,
    ),
    modIndex: isBell ? mappedModIndex * 0.68 : mappedModIndex,
    level: isBell ? mappedLevel * 0.62 : mappedLevel,
  };
}
