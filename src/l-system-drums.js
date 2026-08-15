import {
  advanceLSystemTraversal,
  iterationPlaybackAtPhase,
} from "./l-system.js";

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

const TRAVERSAL_EPSILON = 1e-12;
const ENDPOINT_EPSILON = 1e-9;
const MAX_TRAVERSAL_SAMPLES = 64;

/**
 * Choose a sweep interval small enough to enter every segment subdivision.
 * Sequence and accumulate run local iteration phases faster than the global
 * transport, so their interval is scaled by the number of iterations.
 */
export function lSystemDrumTraversalStepSize(
  traces,
  subdivisions = 4,
  structureMode = "final",
) {
  const available = Array.isArray(traces) ? traces.filter(Boolean) : [];
  const count = lSystemDrumSubdivisionCount(subdivisions);
  const phaseScale = structureMode === "sequence" || structureMode === "accumulate"
    ? Math.max(1, available.length)
    : 1;
  let minimumSpan = Infinity;

  for (const trace of available) {
    const duration = Number(trace.duration) || 0;
    if (duration <= 0) continue;
    for (const segment of trace.segments ?? []) {
      const segmentLength = (Number(segment.endDistance) || 0)
        - (Number(segment.startDistance) || 0);
      if (segmentLength <= 0) continue;
      minimumSpan = Math.min(
        minimumSpan,
        segmentLength / duration / count / phaseScale,
      );
    }
  }

  if (!Number.isFinite(minimumSpan)) return 0.01;
  return clamp(minimumSpan * 0.5, 1e-7, 0.05, 0.01);
}

function audibleTraversalPosition(position) {
  if (position >= 1) return 1 - ENDPOINT_EPSILON;
  return Math.max(0, position);
}

/**
 * Advance the transport while retaining all intermediate phases needed by
 * the drum trigger. Boundary samples are explicit re-attack points.
 */
export function advanceLSystemDrumTraversal(
  position,
  direction,
  distance,
  {
    behavior = "loop",
    maxPhaseStep = 0.01,
  } = {},
) {
  const startPosition = clamp(position);
  const startDirection = Number(direction) < 0 ? -1 : 1;
  const travel = Math.max(0, Number(distance) || 0);
  const requestedStep = clamp(maxPhaseStep, 1e-7, 1, 0.01);
  const sampleStep = Math.max(
    requestedStep,
    travel / Math.max(1, MAX_TRAVERSAL_SAMPLES - Math.ceil(travel) * 2),
  );
  const samples = [];
  let cursor = startPosition;
  let currentDirection = startDirection;
  let remaining = travel;

  const pushSample = (samplePosition, sampleDirection, boundary = null) => {
    samples.push(Object.freeze({
      position: audibleTraversalPosition(samplePosition),
      direction: sampleDirection,
      boundary,
    }));
  };

  while (remaining > TRAVERSAL_EPSILON) {
    const distanceToBoundary = currentDirection > 0 ? 1 - cursor : cursor;
    if (distanceToBoundary <= TRAVERSAL_EPSILON) {
      if (behavior === "ping-pong") {
        currentDirection *= -1;
        pushSample(cursor, currentDirection, "reflection");
      } else {
        cursor = currentDirection > 0 ? 0 : 1;
        pushSample(cursor, currentDirection, "wrap");
      }
      continue;
    }

    const legDistance = Math.min(remaining, distanceToBoundary);
    const legStart = cursor;
    const sampleCount = Math.max(1, Math.ceil(legDistance / sampleStep));
    for (let index = 1; index <= sampleCount; index += 1) {
      pushSample(
        legStart + currentDirection * legDistance * index / sampleCount,
        currentDirection,
      );
    }

    cursor = legStart + currentDirection * legDistance;
    remaining = Math.max(0, remaining - legDistance);
    if (distanceToBoundary - legDistance > TRAVERSAL_EPSILON) continue;

    cursor = currentDirection > 0 ? 1 : 0;
    if (behavior === "ping-pong") {
      currentDirection *= -1;
      pushSample(cursor, currentDirection, "reflection");
    } else if (currentDirection > 0 || remaining > TRAVERSAL_EPSILON) {
      cursor = currentDirection > 0 ? 0 : 1;
      pushSample(cursor, currentDirection, "wrap");
    }
  }

  const advanced = advanceLSystemTraversal(
    startPosition,
    startDirection,
    travel,
    behavior,
  );
  return Object.freeze({
    position: advanced.position,
    direction: advanced.direction,
    samples: Object.freeze(samples),
  });
}

function playbackHeads(playback) {
  return playback.entries.flatMap((entry) => entry.snapshot.heads.map((head) => ({
    ...head,
    iteration: entry.iteration,
    localPhase: entry.localPhase,
    sourceTrace: entry.trace,
    snapshotDistance: entry.snapshot.distance,
  })));
}

/** Collect every newly entered drum subdivision across a swept frame. */
export function lSystemDrumEventsForTraversal(traces, samples, {
  structureMode = "final",
  subdivisions = 4,
  activeEventKeys = new Set(),
} = {}) {
  let activeKeys = new Set(activeEventKeys);
  const triggeredEvents = [];

  const traversalSamples = Array.isArray(samples) ? samples : [];
  for (let sampleIndex = 0; sampleIndex < traversalSamples.length; sampleIndex += 1) {
    const sample = traversalSamples[sampleIndex];
    if (sample.boundary) activeKeys = new Set();
    const playback = iterationPlaybackAtPhase(
      traces,
      sample.position,
      structureMode,
    );
    const events = lSystemDrumEventsForPlayheads(playbackHeads(playback), {
      subdivisions,
      direction: sample.direction,
    });
    const nextKeys = new Set(events.map((event) => event.key));
    for (const event of events) {
      if (!activeKeys.has(event.key)) {
        triggeredEvents.push(Object.freeze({
          ...event,
          eventCount: events.length,
          transportSampleIndex: sampleIndex,
          transportBoundary: sample.boundary,
        }));
      }
    }
    activeKeys = nextKeys;
  }

  return Object.freeze({
    events: Object.freeze(triggeredEvents),
    activeEventKeys: activeKeys,
  });
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

/** Keep simultaneous branches from launching phase-aligned copies of one drum. */
export function groupedLSystemDrumEvents(events, {
  mode = "branch-depth-turn",
  maxEvents = Infinity,
} = {}) {
  const grouped = new Map();
  const voicesPerSample = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const voiceIndex = lSystemDrumVoiceIndex(event, { mode });
    const sampleIndex = Number.isInteger(event.transportSampleIndex)
      ? event.transportSampleIndex
      : -1;
    const groupKey = `${sampleIndex}:${voiceIndex}`;
    const strength = Math.abs(Number(event.turn) || 0)
      + Math.abs(Number(event.cumulativeTurn) || 0) * 0.001;
    const current = grouped.get(groupKey);
    if (!current || strength > current.strength) {
      grouped.set(groupKey, { event, sampleIndex, strength, voiceIndex });
    }
    let sampleVoices = voicesPerSample.get(sampleIndex);
    if (!sampleVoices) {
      sampleVoices = new Set();
      voicesPerSample.set(sampleIndex, sampleVoices);
    }
    sampleVoices.add(voiceIndex);
  }

  const audibleEvents = [...grouped.values()].map(({
    event,
    sampleIndex,
    strength,
    voiceIndex,
  }, index) => ({
    event,
    index,
    strength,
    voiceIndex,
    eventCount: voicesPerSample.get(sampleIndex)?.size ?? 1,
  }));
  const limit = Math.max(1, Math.floor(Number(maxEvents) || 1));
  if (!Number.isFinite(Number(maxEvents)) || audibleEvents.length <= limit) {
    return audibleEvents.map(({ index, strength, ...entry }) => Object.freeze(entry));
  }

  const boundaryEvents = audibleEvents.filter(({ event }) => event.transportBoundary);
  const ordinaryEvents = audibleEvents.filter(({ event }) => !event.transportBoundary);
  const ordinaryLimit = Math.max(0, limit - boundaryEvents.length);
  const selected = [...boundaryEvents];
  for (let slot = 0; slot < ordinaryLimit; slot += 1) {
    const start = Math.floor(slot * ordinaryEvents.length / ordinaryLimit);
    const end = Math.max(start + 1, Math.floor((slot + 1) * ordinaryEvents.length / ordinaryLimit));
    let strongest = ordinaryEvents[start];
    for (let index = start + 1; index < end; index += 1) {
      if (ordinaryEvents[index].strength > strongest.strength) strongest = ordinaryEvents[index];
    }
    selected.push(strongest);
  }
  selected.sort((left, right) => left.index - right.index);
  return selected.map(({ index, strength, ...entry }) => Object.freeze(entry));
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
