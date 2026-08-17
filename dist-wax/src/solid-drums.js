const EPSILON = 1e-9;

const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
);

function quadrant(value) {
  return Math.min(3, Math.floor(clamp(value) * 4));
}

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export const SOLID_DRUM_MAPPING_MODES = Object.freeze([
  Object.freeze({
    id: "edge-axis",
    label: "Edge × axis",
    description: "Edge identity chooses the row; its X, Y, Z, or diagonal direction chooses the column.",
    source: "Edge number modulo 4 → drum row · X / Y / Z / diagonal direction → voice column",
  }),
  Object.freeze({
    id: "position-grid",
    label: "3D position",
    description: "The intersection's height chooses the row and horizontal position chooses the column.",
    source: "3D height (Y) → drum row · 3D horizontal position (X) → voice column",
  }),
  Object.freeze({
    id: "incidence-depth",
    label: "Incidence × depth",
    description: "Crossing incidence chooses the row; front-to-back depth chooses the column.",
    source: "Surface-crossing incidence → drum row · front-to-back position (Z) → voice column",
  }),
]);

export function solidDrumBounds(solid) {
  const vertices = Array.isArray(solid?.vertices) ? solid.vertices : [];
  if (!vertices.length) {
    return {
      minX: -1,
      minY: -1,
      minZ: -1,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    };
  }
  const axes = ["x", "y", "z"];
  return Object.fromEntries(axes.flatMap((axis) => {
    const values = vertices.map((point) => finiteCoordinate(point?.[axis]));
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const padding = Math.max(EPSILON, (maximum - minimum) * 0.001);
    return [
      [`min${axis.toUpperCase()}`, minimum - padding],
      [`max${axis.toUpperCase()}`, maximum + padding],
    ];
  }));
}

export function normalizedSolidContact(contact = {}, bounds = solidDrumBounds()) {
  const normalize = (axis) => {
    const suffix = axis.toUpperCase();
    const minimum = finiteCoordinate(bounds?.[`min${suffix}`]);
    const maximum = finiteCoordinate(bounds?.[`max${suffix}`]);
    return clamp((finiteCoordinate(contact?.[axis]) - minimum) / Math.max(EPSILON, maximum - minimum));
  };
  return {
    x: normalize("x"),
    y: normalize("y"),
    z: normalize("z"),
    t: clamp(contact?.t),
    incidence: clamp(contact?.incidence),
    axisIndex: Math.min(3, Math.max(0, Math.trunc(Number(contact?.axisIndex) || 0))),
  };
}

export function solidDrumSubdivisionCount(value = 1) {
  const numeric = Number(value);
  return Math.min(
    16,
    Math.max(1, Number.isFinite(numeric) ? Math.trunc(numeric) : 1),
  );
}

export function solidDrumSubdivisionMarkers(subdivisions = 1) {
  const count = solidDrumSubdivisionCount(subdivisions);
  return Array.from({ length: count - 1 }, (_, index) => (index + 1) / count);
}

export function solidDrumProjectedPosition(point = {}, start = {}, end = {}) {
  const dx = finiteCoordinate(end.x) - finiteCoordinate(start.x);
  const dy = finiteCoordinate(end.y) - finiteCoordinate(start.y);
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return clamp(point?.t);
  return clamp((
    (finiteCoordinate(point.x) - finiteCoordinate(start.x)) * dx
    + (finiteCoordinate(point.y) - finiteCoordinate(start.y)) * dy
  ) / lengthSquared);
}

export function solidDrumContactKey(contact = {}, subdivisions = 1) {
  const edgeIndex = Math.max(0, Math.trunc(Number(contact.edgeIndex) || 0));
  const divisionCount = solidDrumSubdivisionCount(subdivisions);
  const segmentPosition = clamp(contact.segmentPosition ?? contact.t);
  const segment = Math.min(
    divisionCount - 1,
    Math.floor(segmentPosition * divisionCount),
  );
  return `edge:${edgeIndex}:segment:${segment}`;
}

function dominantAxis(vector) {
  const components = [
    Math.abs(finiteCoordinate(vector.x)),
    Math.abs(finiteCoordinate(vector.y)),
    Math.abs(finiteCoordinate(vector.z)),
  ];
  const length = Math.hypot(...components);
  const largest = Math.max(...components);
  if (length <= EPSILON || largest / length < 0.78) return 3;
  return components.indexOf(largest);
}

/**
 * Attach the edge direction and its incidence to the moving reader plane.
 * This keeps the audio mapping pure while leaving Solid's geometry untouched.
 */
export function solidDrumContacts(
  contacts = [],
  solid = {},
  normal = {},
  subdivisions = 1,
) {
  const edges = Array.isArray(solid?.edges) ? solid.edges : [];
  const vertices = Array.isArray(solid?.vertices) ? solid.vertices : [];
  const segmentCount = solidDrumSubdivisionCount(subdivisions);
  const normalLength = Math.hypot(
    finiteCoordinate(normal.x),
    finiteCoordinate(normal.y),
    finiteCoordinate(normal.z),
  ) || 1;
  const unitNormal = {
    x: finiteCoordinate(normal.x) / normalLength,
    y: finiteCoordinate(normal.y) / normalLength,
    z: finiteCoordinate(normal.z) / normalLength,
  };
  return contacts.map((contact) => {
    const edgeIndex = Math.max(0, Math.trunc(Number(contact?.edgeIndex) || 0));
    const edge = edges[edgeIndex];
    const start = vertices[edge?.a] ?? contact;
    const end = vertices[edge?.b] ?? contact;
    const vector = {
      x: finiteCoordinate(end?.x) - finiteCoordinate(start?.x),
      y: finiteCoordinate(end?.y) - finiteCoordinate(start?.y),
      z: finiteCoordinate(end?.z) - finiteCoordinate(start?.z),
    };
    const edgeLength = Math.hypot(vector.x, vector.y, vector.z) || 1;
    const incidence = Math.abs(
      vector.x / edgeLength * unitNormal.x
      + vector.y / edgeLength * unitNormal.y
      + vector.z / edgeLength * unitNormal.z,
    );
    const enriched = {
      ...contact,
      edgeIndex,
      axisIndex: dominantAxis(vector),
      incidence: clamp(incidence),
      segmentPosition: clamp(contact?.segmentPosition ?? contact?.t),
    };
    const segmentIndex = Math.min(
      segmentCount - 1,
      Math.floor(enriched.segmentPosition * segmentCount),
    );
    return {
      ...enriched,
      segmentIndex,
      segmentCount,
      voiceKey: solidDrumContactKey(enriched, segmentCount),
    };
  });
}

export function solidDrumVoiceIndex(contact = {}, {
  mode = "edge-axis",
  bounds = solidDrumBounds(),
} = {}) {
  const normalized = normalizedSolidContact(contact, bounds);
  if (mode === "position-grid") {
    return (3 - quadrant(normalized.y)) * 4 + quadrant(normalized.x);
  }
  if (mode === "incidence-depth") {
    return quadrant(normalized.incidence) * 4 + quadrant(normalized.z);
  }
  const row = Math.abs(Math.trunc(Number(contact.edgeIndex) || 0)) % 4;
  return row * 4 + normalized.axisIndex;
}

export function mappedSolidDrumVoice(baseVoice, contact = {}, {
  bounds = solidDrumBounds(),
  pitchDepth = 12,
  characterDepth = 0.7,
  contactCount = 1,
} = {}) {
  const normalized = normalizedSolidContact(contact, bounds);
  const depth = clamp(pitchDepth, 0, 24);
  const character = clamp(characterDepth);
  const semitones = (normalized.y * 2 - 1) * depth;
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
    attack: isBell ? Math.min(Number(baseVoice.attack) || 0.001, 0.006) : baseVoice?.attack,
    decay: isBell ? Math.min(Number(baseVoice.decay) || 0.1, 0.58) : baseVoice?.decay,
    frequency: clamp(baseFrequency * (2 ** (semitones / 12)), 20, 12_000),
    tone: clamp(baseTone * (1 - character) + normalized.incidence * character),
    modIndex: isBell ? mappedModIndex * 0.68 : mappedModIndex,
    level: isBell ? mappedLevel * 0.62 : mappedLevel,
  };
}
