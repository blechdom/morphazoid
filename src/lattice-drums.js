const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
);

export const LATTICE_DRUM_MAPPING_MODES = Object.freeze([
  Object.freeze({
    id: "edge-angle",
    label: "Edge class × angle",
    description: "Edge class chooses the row; edge orientation chooses the column.",
  }),
  Object.freeze({
    id: "position-grid",
    label: "Contact position",
    description: "The contact's 4 × 4 position in the stage chooses the drum.",
  }),
  Object.freeze({
    id: "incidence-density",
    label: "Incidence × density",
    description: "Line/edge incidence chooses the row; contact density chooses the column.",
  }),
]);

export function normalizedLatticeContact(contact, bounds) {
  const width = Math.max(1e-9, Number(bounds?.maxX) - Number(bounds?.minX));
  const height = Math.max(1e-9, Number(bounds?.maxY) - Number(bounds?.minY));
  return {
    x: clamp((Number(contact?.x) - Number(bounds?.minX)) / width),
    y: clamp((Number(contact?.y) - Number(bounds?.minY)) / height),
  };
}

function quadrant(value) {
  return Math.min(3, Math.floor(clamp(value) * 4));
}

export function latticeDrumVoiceIndex(contact, {
  mode = "edge-angle",
  bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 },
  contactCount = 1,
  densityCeiling = 16,
} = {}) {
  if (mode === "position-grid") {
    const position = normalizedLatticeContact(contact, bounds);
    const row = 3 - quadrant(position.y);
    return row * 4 + quadrant(position.x);
  }
  if (mode === "incidence-density") {
    const row = quadrant(contact?.incidence);
    const density = clamp(Number(contactCount) / Math.max(1, Number(densityCeiling) || 16));
    return row * 4 + quadrant(density);
  }
  const edgeClass = Math.abs(Math.trunc(
    Number(contact?.edgeShapeId ?? contact?.edgeIndex) || 0,
  )) % 4;
  return edgeClass * 4 + quadrant(contact?.orientation);
}

export function mappedLatticeDrumVoice(baseVoice, contact, {
  bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 },
  pitchDepth = 12,
  characterDepth = 0.7,
  contactCount = 1,
} = {}) {
  const position = normalizedLatticeContact(contact, bounds);
  const incidence = clamp(contact?.incidence);
  const semitones = (position.y * 2 - 1) * clamp(pitchDepth, 0, 24);
  const character = clamp(characterDepth);
  const headroom = 1 / Math.sqrt(Math.max(1, Number(contactCount) / 4));
  return {
    ...baseVoice,
    frequency: clamp(baseVoice.frequency * (2 ** (semitones / 12)), 20, 12_000),
    tone: clamp(baseVoice.tone * (1 - character) + incidence * character),
    modIndex: clamp(
      baseVoice.modIndex * (1 - character * 0.45)
        + baseVoice.modIndex * (0.55 + incidence * 0.9) * character,
      0,
      20,
    ),
    level: clamp(baseVoice.level * (0.38 + incidence * 0.62) * headroom),
  };
}
