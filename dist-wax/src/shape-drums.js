const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
);

const TAU = Math.PI * 2;

const mappingLegend = (...items) => Object.freeze(
  items.map(([source, target]) => Object.freeze({ source, target })),
);

export function shapeRotationTravelForAngle(angle, mode = "loop") {
  const normalized = ((Number(angle) + 180) % 360 + 360) % 360 - 180;
  return mode === "pingpong" ? (normalized + 180) / 360 : normalized / 360;
}

export function reversedShapeHeadState({
  position = 0,
  direction = 1,
  offset = 0,
  adjustment = 0,
} = {}) {
  const currentDirection = Number(direction) < 0 ? -1 : 1;
  const nextDirection = -currentDirection;
  const travel = currentDirection * Number(position) + Number(offset) + Number(adjustment);
  return {
    direction: nextDirection,
    adjustment: travel - nextDirection * Number(position) - Number(offset),
  };
}

export const SHAPE_DRUM_MAPPING_MODES = Object.freeze([
  Object.freeze({
    id: "contour-corner",
    label: "Side × tangent",
    description: "Polygon side regions choose the drum row; tangent direction chooses the column.",
    legend: mappingLegend(
      ["Side / sub", "drum row"],
      ["Tangent", "voice column"],
      ["Height", "tuning"],
      ["Corner", "tone + force"],
      ["Incidence", "character + force"],
    ),
  }),
  Object.freeze({
    id: "position-grid",
    label: "Contact position",
    description: "The contact's 4 × 4 position inside the shape bounds chooses the drum.",
    legend: mappingLegend(
      ["Vertical position", "row + tuning"],
      ["Horizontal position", "voice column"],
      ["Corner", "tone + force"],
      ["Incidence", "character + force"],
      ["Contact count", "level headroom"],
    ),
  }),
  Object.freeze({
    id: "incidence-playhead",
    label: "Playhead × incidence",
    description: "Playhead identity chooses the row; crossing incidence chooses the column.",
    legend: mappingLegend(
      ["Playhead", "drum row"],
      ["Incidence", "column + character"],
      ["Height", "tuning"],
      ["Corner", "tone + force"],
      ["Contact count", "level headroom"],
    ),
  }),
]);

export function normalizedShapeContact(contact, bounds) {
  const width = Math.max(
    1e-9,
    Number(bounds?.width) || Number(bounds?.maxX) - Number(bounds?.minX),
  );
  const height = Math.max(
    1e-9,
    Number(bounds?.height) || Number(bounds?.maxY) - Number(bounds?.minY),
  );
  return {
    x: clamp((Number(contact?.x) - Number(bounds?.minX)) / width),
    y: clamp((Number(contact?.y) - Number(bounds?.minY)) / height),
  };
}

function quadrant(value) {
  return Math.min(3, Math.floor(clamp(value) * 4));
}

function angularQuadrant(angle) {
  const wrapped = ((Number(angle) || 0) % TAU + TAU) % TAU;
  return Math.min(3, Math.floor(wrapped / TAU * 4));
}

export function sanitizeShapeSideSubdivisions(value) {
  const numeric = Number(value);
  return Math.min(16, Math.max(
    1,
    Number.isFinite(numeric) ? Math.round(numeric) : 1,
  ));
}

/**
 * Resolve a contact to an actual polygon side and an equal-arclength bin on
 * that side. Circles have no declared vertices, so they deliberately return
 * null and retain their continuous phase mapping.
 */
export function shapeSideSubdivision(contact = {}, path = {}, subdivisions = 1) {
  const vertexDistances = Array.isArray(path?.vertexDistances)
    ? path.vertexDistances
    : [];
  const totalLength = Number(path?.totalLength);
  const closed = Boolean(path?.closed);
  const sideCount = closed
    ? vertexDistances.length
    : Math.max(0, vertexDistances.length - 1);
  if (!sideCount || !Number.isFinite(totalLength) || totalLength <= 0) return null;

  let distance = Number(contact?.distance);
  if (!Number.isFinite(distance)) {
    const phase = Number(contact?.u);
    distance = (Number.isFinite(phase) ? phase : 0) * totalLength;
  }
  if (closed) {
    distance = ((distance % totalLength) + totalLength) % totalLength;
  } else {
    distance = Math.min(totalLength, Math.max(0, distance));
  }

  let sideIndex = sideCount - 1;
  if (!closed && distance >= totalLength) {
    sideIndex = sideCount - 1;
  } else {
    for (let index = 0; index < sideCount; index += 1) {
      const end = index + 1 < vertexDistances.length
        ? Number(vertexDistances[index + 1])
        : totalLength;
      if (distance < end) {
        sideIndex = index;
        break;
      }
    }
  }

  const start = Number(vertexDistances[sideIndex]) || 0;
  const end = sideIndex + 1 < vertexDistances.length
    ? Number(vertexDistances[sideIndex + 1])
    : totalLength;
  const local = clamp((distance - start) / Math.max(1e-9, end - start));
  const count = sanitizeShapeSideSubdivisions(subdivisions);
  const subdivisionIndex = Math.min(count - 1, Math.floor(local * count));
  return {
    sideIndex,
    sideCount,
    subdivisionIndex,
    subdivisions: count,
    globalIndex: sideIndex * count + subdivisionIndex,
    local,
  };
}

export function limitShapeDrumHits(hits = [], limit = 6) {
  const maximum = Math.min(16, Math.max(
    1,
    Number.isFinite(Number(limit)) ? Math.round(Number(limit)) : 6,
  ));
  return Array.from(hits).slice(0, maximum);
}

export function shapeDrumEventToken(
  contact = {},
  path = {},
  sideSubdivisions = 1,
  voiceIndex = 0,
) {
  const subdivision = shapeSideSubdivision(contact, path, sideSubdivisions);
  if (subdivision) {
    return `side:${subdivision.sideIndex}:sub:${subdivision.subdivisionIndex}`;
  }
  const resolution = Math.max(4, Number(path?.vertexCount) || 16);
  const phase = ((Number(contact?.u) || 0) % 1 + 1) % 1;
  const phaseBand = Math.min(
    resolution - 1,
    Math.floor(phase * resolution),
  );
  const corner = Math.trunc(Number(contact?.cornerIndex));
  const feature = Number.isFinite(corner) && corner >= 0 ? corner : phaseBand;
  return `${feature}:${phaseBand}:${Math.trunc(Number(voiceIndex) || 0)}`;
}

export function shapeDrumVoiceIndex(contact, {
  mode = "contour-corner",
  bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1, width: 2, height: 2 },
  path = null,
  sideSubdivisions = 1,
} = {}) {
  if (mode === "position-grid") {
    const position = normalizedShapeContact(contact, bounds);
    return (3 - quadrant(position.y)) * 4 + quadrant(position.x);
  }
  if (mode === "incidence-playhead") {
    const row = Math.abs(Math.trunc(Number(contact?.headIndex) || 0)) % 4;
    return row * 4 + quadrant(contact?.incidence);
  }
  const phaseRow = quadrant(contact?.u ?? contact?.headPhase);
  const corner = Math.trunc(Number(contact?.cornerIndex));
  const currentRow = Number.isFinite(corner) && corner >= 0
    ? Math.abs(corner) % 4
    : phaseRow;
  const subdivision = shapeSideSubdivision(contact, path, sideSubdivisions);
  const row = subdivision ? subdivision.globalIndex % 4 : currentRow;
  return row * 4 + angularQuadrant(contact?.tangentAngle);
}

export function mappedShapeDrumVoice(baseVoice, contact, {
  bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1, width: 2, height: 2 },
  pitchDepth = 12,
  characterDepth = 0.7,
  contactCount = 1,
} = {}) {
  const position = normalizedShapeContact(contact, bounds);
  const corner = clamp(Math.abs(
    Number(contact?.cornerStrength ?? contact?.cornerTurn) || 0,
  ));
  const incidence = clamp(contact?.incidence);
  const character = clamp(characterDepth);
  const geometricDrive = clamp(corner * 0.65 + incidence * 0.35);
  const semitones = (1 - position.y * 2) * clamp(pitchDepth, 0, 24);
  const headroom = 1 / Math.sqrt(Math.max(1, Number(contactCount) / 4));
  const mappedModIndex = clamp(
    baseVoice.modIndex * (1 - character * 0.4)
      + baseVoice.modIndex * (0.5 + geometricDrive) * character,
    0,
    20,
  );
  const mappedLevel = clamp(
    baseVoice.level * (0.42 + Math.max(corner, incidence) * 0.58) * headroom,
  );
  const isBell = baseVoice?.family === "bell";
  return {
    ...baseVoice,
    attack: isBell ? Math.min(Number(baseVoice.attack) || 0.001, 0.006) : baseVoice.attack,
    decay: isBell ? Math.min(Number(baseVoice.decay) || 0.1, 0.58) : baseVoice.decay,
    frequency: clamp(baseVoice.frequency * (2 ** (semitones / 12)), 20, 12_000),
    tone: clamp(baseVoice.tone * (1 - character) + geometricDrive * character),
    modIndex: isBell ? mappedModIndex * 0.68 : mappedModIndex,
    level: isBell ? mappedLevel * 0.62 : mappedLevel,
  };
}
