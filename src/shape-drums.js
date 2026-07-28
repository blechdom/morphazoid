const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
);

const TAU = Math.PI * 2;

export const SHAPE_DRUM_MAPPING_MODES = Object.freeze([
  Object.freeze({
    id: "contour-corner",
    label: "Contour × corner",
    description: "Contour segment chooses the row; tangent direction chooses the column.",
  }),
  Object.freeze({
    id: "position-grid",
    label: "Contact position",
    description: "The contact's 4 × 4 position inside the shape bounds chooses the drum.",
  }),
  Object.freeze({
    id: "incidence-playhead",
    label: "Playhead × incidence",
    description: "Playhead identity chooses the row; crossing incidence chooses the column.",
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

export function shapeDrumVoiceIndex(contact, {
  mode = "contour-corner",
  bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1, width: 2, height: 2 },
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
  const row = Number.isFinite(corner) && corner >= 0 ? Math.abs(corner) % 4 : phaseRow;
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
