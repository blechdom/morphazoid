import {
  branchingSnapshotAtPhase, iterationPlaybackAtPhase, allocateIterationVoiceHeads,
  normalizeLSystemPoint,
} from "../l-system/l-system.js";
import { lSystemDrumEventForHead } from "../l-system-drum-machine/l-system-drum-machine.js";

import { lSystemsCornersForHead, lSystemsCornerContact } from "./corners.js";

export const L_SYSTEM_READERS = 3;
const clamp = (x, low = 0, high = 1) => Math.min(high, Math.max(low, Number(x) || 0));
const metadata = new WeakMap();
const playbackViews = new WeakMap();

function traceMetadata(trace) {
  if (metadata.has(trace)) return metadata.get(trace);
  let minTurn = Infinity, maxTurn = -Infinity, weightedLength = 0, power = 0;
  for (const segment of trace.segments) {
    minTurn = Math.min(minTurn, segment.cumulativeTurn);
    maxTurn = Math.max(maxTurn, segment.cumulativeTurn);
    const share = segment.powerShare || 1e-9;
    weightedLength += (segment.endDistance - segment.startDistance) * share;
    power += share;
  }
  const result = { minTurn, maxTurn, steps: trace.duration * power / Math.max(1e-9, weightedLength) };
  metadata.set(trace, result);
  return result;
}

function snapshot(trace, phase) {
  if (trace.maxForkDepth || trace.rootIndices.length !== 1) return branchingSnapshotAtPhase(trace, phase);
  // A path can have tens of thousands of edges. Do not walk from its root
  // three times per audio sample just to locate one reader (including rests).
  const distance = phase * trace.duration;
  let low = 0, high = trace.segments.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (trace.segments[mid].endDistance <= distance) low = mid + 1;
    else high = mid;
  }
  return branchingSnapshotAtPhase({ ...trace, rootIndices: low < trace.segments.length ? [low] : [] }, phase);
}

/** End-to-end follows one frontier through the score; real forks bifurcate.
 * Optional regions start three readers, each scanning one third of an iteration.
 * At reflection all readers reverse; at wrap each returns to its own region.
 * The original standalone instruments and Mic traversal remain untouched. */
export function lSystemsPlaybackAtPhase(traces, phase, mode = "final", readerMode = "end-to-end") {
  const readerCount = readerMode === "regions" ? L_SYSTEM_READERS : 1;
  if (!playbackViews.has(traces)) playbackViews.set(traces,
    traces.map(trace => ({ ...trace, rootIndices: [], originalTrace: trace })));
  // Reuse the shared iteration timing, without computing its discarded
  // single-reader snapshot before the three real readers.
  const playback = iterationPlaybackAtPhase(playbackViews.get(traces), phase, mode);
  return { ...playback, entries: playback.entries.map(scheduled => {
    const entry = { ...scheduled, trace: scheduled.trace.originalTrace };
    const regions = [], heads = [];
    for (let reader = 0; reader < readerCount; reader++) {
      const localPhase = (reader + entry.localPhase) / readerCount;
      const current = snapshot(entry.trace, localPhase);
      regions.push({ startDistance: reader * entry.trace.duration / readerCount, distance: current.distance });
      for (const head of current.heads) heads.push({
        ...head, reader, localPhase, readerPhase: entry.localPhase,
        snapshotDistance: current.distance,
        // Iterations previously collided on root:0, silently collapsing layers.
        voiceKey: `iteration:${entry.iteration}/reader:${reader}/${head.voiceKey}`,
      });
    }
    return { ...entry, snapshot: { ...entry.snapshot, heads, regions } };
  }) };
}

export function lSystemsPlaybackHeads(playback) {
  return playback.entries.flatMap(entry => entry.snapshot.heads.map(head => ({
    ...head, iteration: entry.iteration, sourceTrace: entry.trace,
    localPhase: head.localPhase ?? entry.localPhase,
    snapshotDistance: head.snapshotDistance ?? entry.snapshot.distance,
  })));
}

/** Pitch remains continuous and image-derived, with no musical-scale/chord
 * injection. Normalize inherited turn across the actual trace rather than
 * exponentiating an unbounded winding angle. Geometry also separates equal-
 * depth siblings; a branchless/flat source falls back to its visible path. */
export function lSystemsPitchCoordinates(head) {
  const trace = head.sourceTrace;
  if (!trace) return head.pitchCoordinates ?? {
    angle: .5, height: clamp(head.normalizedY ?? .5),
    depth: clamp(head.depth / Math.max(1, head.maxForkDepth || 1)),
    progress: clamp(head.progress), location: clamp(head.normalizedX ?? .5),
  };
  const { minTurn, maxTurn } = traceMetadata(trace);
  const point = normalizeLSystemPoint(head, trace.bounds);
  const width = trace.bounds.maxX - trace.bounds.minX;
  const height = trace.bounds.maxY - trace.bounds.minY;
  const progress = clamp(head.localPhase ?? head.snapshotDistance / trace.duration);
  const location = width < 1e-9 ? point.y : height < 1e-9 ? point.x : .65 * point.y + .35 * point.x;
  return {
    angle: maxTurn - minTurn > 1e-9 ? clamp((head.cumulativeTurn - minTurn) / (maxTurn - minTurn)) : location,
    height: height > 1e-9 ? point.y : location,
    depth: trace.maxForkDepth ? clamp(head.depth / trace.maxForkDepth) : progress,
    progress,
    location: .75 * location + .25 * progress,
  };
}

export function lSystemsFrequency(head, synth) {
  const coordinates = head.pitchCoordinates ?? lSystemsPitchCoordinates(head);
  const pitch = .75 * (coordinates[synth.pitchSource] ?? coordinates.height) + .25 * coordinates.location;
  return clamp(synth.baseFrequency * 2 ** ((pitch - .5) * synth.pitchRange), 20, 20000);
}

/** Both note onsets and percussion contacts use the very same visible readers.
 * Event identity includes reader and iteration, not merely a drum-map cell. */
export function lSystemsEventsForTraversal(traces, samples, {
  structureMode = "final", readerMode = "end-to-end", subdivisions = 4, activeEventKeys = new Set(),
  cornerThreshold = 12, hitPlacement = "all",
} = {}) {
  let activeKeys = new Set(activeEventKeys);
  const events = [];
  for (const [sampleIndex, sample] of samples.entries()) {
    if (sample.boundary === "wrap") activeKeys.clear();
    const playback = lSystemsPlaybackAtPhase(traces, sample.position, structureMode, readerMode);
    const heads = allocateIterationVoiceHeads(lSystemsPlaybackHeads(playback), 128);
    const nextKeys = new Set();
    for (const head of heads) {
      const event = lSystemDrumEventForHead(head, { subdivisions, direction: sample.direction });
      const key = `${head.reader}:${event.key}`;
      nextKeys.add(key);
      if (activeKeys.has(key)) continue;
      const corners = lSystemsCornersForHead(head);
      if (hitPlacement === "corners" && !lSystemsCornerContact({ ...event, corners }, sample.direction, cornerThreshold)) continue;
      events.push({
        ...event, key, corners, reader: head.reader, voiceKey: head.voiceKey,
        pitchCoordinates: lSystemsPitchCoordinates(head),
        pathPhase: head.localPhase, eventCount: heads.length,
        transportSampleIndex: sampleIndex, transportBoundary: sample.boundary,
      });
    }
    activeKeys = nextKeys;
  }
  return { events, activeEventKeys: activeKeys };
}

export function lSystemsNoteGroups(events) {
  // Percussion may coalesce identical drum rows. Pitched notes must not:
  // different visible readers in the same row can have different frequencies.
  const samples = new Map();
  for (const event of events) {
    const group = samples.get(event.transportSampleIndex) ?? [];
    group.push(event);
    samples.set(event.transportSampleIndex, group);
  }
  return [...samples.values()].flatMap(group => {
    const count = Math.min(8, group.length);
    return Array.from({ length: count }, (_, index) => ({
      event: group[Math.floor(index * group.length / count)], eventCount: count,
    }));
  });
}

/** Factory/dice pacing only. Manual speed is never silently altered by edits.
 * Estimate sequential edge changes (not leaf count) and account for the faster
 * local phase of Sequence/Accumulate and for note/trigger subdivisions. */
export function lSystemsPresetSpeed(traces, state, preferredSpeed, activity = 10) {
  const relevant = state.structureMode === "final" ? traces.slice(-1) : traces;
  const phaseScale = ["sequence", "accumulate"].includes(state.structureMode) ? traces.length : 1;
  const steps = Math.max(1, ...relevant.map(trace => traceMetadata(trace).steps)) * phaseScale;
  const subdivisions = state.mode === "continuous" ? 1 : state.drums.subdivisions;
  return Math.max(.001, Math.min(preferredSpeed, activity / (steps * subdivisions)));
}
