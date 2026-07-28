const clamp = (value, minimum = 0, maximum = 1) => {
  const numeric = Number(value);
  return Math.min(maximum, Math.max(
    minimum,
    Number.isFinite(numeric) ? numeric : minimum,
  ));
};

const coordinate = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const HYPER_DRUM_MAPPING_MODES = Object.freeze([
  Object.freeze({
    id: "axis-depth",
    label: "Edge axis × depth",
    description: "The edge's 4D axis chooses the drum row; projected depth chooses the column.",
  }),
  Object.freeze({
    id: "projected-position",
    label: "Projected position",
    description: "The contact's projected 4 × 4 position chooses the drum.",
  }),
  Object.freeze({
    id: "w-incidence",
    label: "W depth × incidence",
    description: "W position chooses the row; alignment with the W plane chooses the column.",
  }),
]);

function normalizedCoordinate(value, minimum, maximum) {
  const low = coordinate(minimum, -1);
  const high = coordinate(maximum, 1);
  return clamp((coordinate(value, low) - low) / Math.max(1e-9, high - low));
}

export function normalizedHyperContact(contact = {}, bounds = {}) {
  return {
    x: normalizedCoordinate(
      contact.projectedX ?? contact.x,
      bounds.minX,
      bounds.maxX,
    ),
    y: normalizedCoordinate(
      contact.projectedY ?? contact.y,
      bounds.minY,
      bounds.maxY,
    ),
    depth: normalizedCoordinate(
      contact.projectedDepth ?? contact.z,
      bounds.minDepth ?? bounds.minZ,
      bounds.maxDepth ?? bounds.maxZ,
    ),
    w: normalizedCoordinate(contact.w, bounds.minW, bounds.maxW),
    incidence: clamp(contact.incidence),
    along: clamp(contact.t),
  };
}

function quadrant(value) {
  return Math.min(3, Math.floor(clamp(value) * 4));
}

function axisRow(axis) {
  const namedRows = { x: 0, u: 0, y: 1, v: 1, z: 2, w: 3 };
  const named = namedRows[String(axis).toLowerCase()];
  if (Number.isInteger(named)) return named;
  return Math.abs(Math.trunc(coordinate(axis))) % 4;
}

export function hyperContactVoiceKey(contact, segmentCount = 4) {
  const segments = Math.max(1, Math.trunc(coordinate(segmentCount, 4)));
  const segment = Math.min(
    segments - 1,
    Math.floor(clamp(contact?.t) * segments),
  );
  return `hyper:${Math.abs(Math.trunc(coordinate(contact?.edgeIndex)))}:${segment}`;
}

export function hyperDrumVoiceIndex(contact, {
  mode = "axis-depth",
  bounds = {
    minX: -1,
    minY: -1,
    minDepth: -1,
    minW: -1,
    maxX: 1,
    maxY: 1,
    maxDepth: 1,
    maxW: 1,
  },
} = {}) {
  const normalized = normalizedHyperContact(contact, bounds);
  if (mode === "projected-position") {
    return (3 - quadrant(normalized.y)) * 4 + quadrant(normalized.x);
  }
  if (mode === "w-incidence") {
    return (3 - quadrant(normalized.w)) * 4 + quadrant(normalized.incidence);
  }
  return axisRow(contact?.axis) * 4 + quadrant(normalized.depth);
}

export function mappedHyperDrumVoice(baseVoice, contact, {
  bounds = {
    minX: -1,
    minY: -1,
    minDepth: -1,
    minW: -1,
    maxX: 1,
    maxY: 1,
    maxDepth: 1,
    maxW: 1,
  },
  pitchDepth = 12,
  characterDepth = 0.7,
  contactCount = 1,
} = {}) {
  const normalized = normalizedHyperContact(contact, bounds);
  const character = clamp(characterDepth);
  const semitones = (normalized.y * 2 - 1) * clamp(pitchDepth, 0, 24);
  const headroom = 1 / Math.sqrt(Math.max(1, coordinate(contactCount, 1) / 4));
  const mappedModIndex = clamp(
    baseVoice.modIndex * (1 - character * 0.45)
      + baseVoice.modIndex * (0.55 + normalized.incidence * 0.9) * character,
    0,
    20,
  );
  const mappedLevel = clamp(
    baseVoice.level * (0.38 + normalized.incidence * 0.62) * headroom,
  );
  const isBell = baseVoice?.family === "bell";
  return {
    ...baseVoice,
    attack: isBell
      ? Math.min(coordinate(baseVoice.attack, 0.001), 0.006)
      : baseVoice.attack,
    decay: isBell
      ? Math.min(coordinate(baseVoice.decay, 0.1), 0.58)
      : baseVoice.decay,
    frequency: clamp(
      baseVoice.frequency * (2 ** (semitones / 12)),
      20,
      12_000,
    ),
    tone: clamp(
      baseVoice.tone * (1 - character) + normalized.incidence * character,
    ),
    modIndex: isBell ? mappedModIndex * 0.68 : mappedModIndex,
    level: isBell ? mappedLevel * 0.62 : mappedLevel,
  };
}
