const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
};

const legend = (...entries) => Object.freeze(entries.map(([label, detail]) => (
  Object.freeze({ label, detail })
)));

const quadrant = (value) => Math.min(3, Math.floor(clamp(value) * 4));

export const L_SYSTEM_DRUM_MAPPING_MODES = Object.freeze([
  Object.freeze({
    id: "branch-depth-turn",
    label: "Depth × turn",
    description: "Branch depth chooses the row; inherited turn angle chooses the column.",
    legend: legend(
      ["Branch depth", "drum row"],
      ["Turn angle", "voice column"],
      ["Height", "tuning"],
      ["Turn + depth", "tone + force"],
      ["Active heads", "headroom"],
    ),
  }),
  Object.freeze({
    id: "position-grid",
    label: "Stage position",
    description: "The moving branch head's 4 × 4 position chooses the drum.",
    legend: legend(
      ["Vertical", "drum row"],
      ["Horizontal", "voice column"],
      ["Height", "tuning"],
      ["Branch depth", "tone"],
      ["Active heads", "headroom"],
    ),
  }),
  Object.freeze({
    id: "generation-phase",
    label: "Generation × phase",
    description: "Rewrite generation chooses the row; segment subdivision chooses the column.",
    legend: legend(
      ["Generation", "drum row"],
      ["Segment phase", "voice column"],
      ["Height", "tuning"],
      ["Turn", "tone + force"],
      ["Active heads", "headroom"],
    ),
  }),
]);

export function lSystemDrumSubdivisionCount(value = 4) {
  return Math.min(16, Math.max(1, Math.round(Number(value) || 4)));
}

function normalizedPoint(point = {}, bounds = {}) {
  const minX = Number(bounds.minX) || 0;
  const maxX = Number(bounds.maxX) || 0;
  const minY = Number(bounds.minY) || 0;
  const maxY = Number(bounds.maxY) || 0;
  const width = Math.max(1e-9, maxX - minX);
  const height = Math.max(1e-9, maxY - minY);
  return {
    x: clamp((Number(point.x) - minX) / width),
    y: clamp((Number(point.y) - minY) / height),
  };
}

export function lSystemDrumEventKey(event = {}) {
  const iteration = Math.max(0, Math.floor(Number(event.iteration) || 0));
  const segment = Math.max(0, Math.floor(Number(event.segmentIndex) || 0));
  const subdivision = Math.max(0, Math.floor(Number(event.subdivisionIndex) || 0));
  return `l-system:${iteration}:${segment}:${subdivision}`;
}

export function lSystemDrumEventForHead(head = {}, {
  subdivisions = 4,
  direction = 1,
} = {}) {
  const count = lSystemDrumSubdivisionCount(subdivisions);
  const progress = clamp(head.progress);
  const subdivisionIndex = Math.min(count - 1, Math.floor(progress * count));
  const trace = head.sourceTrace ?? {};
  const normalized = normalizedPoint(head, trace.bounds);
  const segmentIndex = Math.max(0, Math.floor(
    Number(head.index ?? head.segment?.index) || 0,
  ));
  const maxForkDepth = Math.max(1, Math.floor(Number(trace.maxForkDepth) || 1));
  const event = {
    iteration: Math.max(0, Math.floor(Number(head.iteration) || 0)),
    segmentIndex,
    subdivisionIndex,
    subdivisions: count,
    progress,
    x: Number(head.x) || 0,
    y: Number(head.y) || 0,
    normalizedX: normalized.x,
    normalizedY: normalized.y,
    generation: Math.max(0, Math.floor(Number(head.generation) || 0)),
    depth: Math.max(0, Math.floor(Number(head.depth) || 0)),
    stackDepth: Math.max(0, Math.floor(Number(head.stackDepth) || 0)),
    maxForkDepth,
    heading: Number(head.heading) || 0,
    turn: Number(head.turn) || 0,
    cumulativeTurn: Number(head.cumulativeTurn) || 0,
    powerShare: clamp(head.powerShare, 0, 1, 0),
    direction: Number(direction) < 0 ? -1 : 1,
  };
  return { ...event, key: lSystemDrumEventKey(event) };
}

export function lSystemDrumEventsForPlayheads(playheads, options = {}) {
  return (Array.isArray(playheads) ? playheads : [])
    .map((head) => lSystemDrumEventForHead(head, options));
}

function wrappedTurn01(radians) {
  return ((Number(radians) || 0) / (Math.PI * 2) % 1 + 1) % 1;
}

export function lSystemDrumVoiceIndex(event = {}, {
  mode = "branch-depth-turn",
} = {}) {
  if (mode === "position-grid") {
    const row = 3 - quadrant(event.normalizedY);
    return row * 4 + quadrant(event.normalizedX);
  }
  if (mode === "generation-phase") {
    const row = Math.abs(Math.floor(Number(event.generation) || 0)) % 4;
    return row * 4 + quadrant((Number(event.subdivisionIndex) || 0) / Math.max(
      1,
      Number(event.subdivisions) || 1,
    ));
  }
  const depth = clamp((Number(event.depth) || 0) / Math.max(1, Number(event.maxForkDepth) || 1));
  return quadrant(depth) * 4 + quadrant(wrappedTurn01(event.cumulativeTurn));
}

export function mappedLSystemDrumVoice(baseVoice, event = {}, {
  pitchDepth = 12,
  characterDepth = 0.72,
  eventCount = 1,
} = {}) {
  const depth = clamp((Number(event.depth) || 0) / Math.max(1, Number(event.maxForkDepth) || 1));
  const turnForce = clamp(Math.abs(Number(event.turn) || 0) / Math.PI);
  const character = clamp(characterDepth);
  const semitones = (clamp(event.normalizedY) * 2 - 1) * clamp(pitchDepth, 0, 24);
  const headroom = 1 / Math.sqrt(Math.max(1, Number(eventCount) || 1));
  const baseFrequency = Number(baseVoice?.frequency) || 60;
  const baseTone = clamp(baseVoice?.tone);
  const baseModIndex = clamp(baseVoice?.modIndex, 0, 20);
  const baseLevel = clamp(baseVoice?.level);
  const force = clamp(0.45 + depth * 0.25 + turnForce * 0.3);
  const mappedModIndex = clamp(
    baseModIndex * (1 - character * 0.42)
      + baseModIndex * (0.55 + turnForce * 0.9 + depth * 0.35) * character,
    0,
    20,
  );
  const mappedLevel = clamp(baseLevel * force * headroom);
  const isBell = baseVoice?.family === "bell";
  return {
    ...baseVoice,
    attack: isBell ? Math.min(Number(baseVoice.attack) || 0.001, 0.006) : baseVoice?.attack,
    decay: isBell ? Math.min(Number(baseVoice.decay) || 0.1, 0.58) : baseVoice?.decay,
    frequency: clamp(baseFrequency * (2 ** (semitones / 12)), 20, 12_000),
    tone: clamp(baseTone * (1 - character) + Math.max(depth, turnForce) * character),
    modIndex: isBell ? mappedModIndex * 0.68 : mappedModIndex,
    level: isBell ? mappedLevel * 0.62 : mappedLevel,
  };
}
