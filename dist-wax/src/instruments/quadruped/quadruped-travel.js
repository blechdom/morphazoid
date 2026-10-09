import { QUADRUPED_LIMITS } from "./quadruped-limits.js";

// Transient world travel is separate from the monotonically advancing score.
// Keep this on an effective performance score, never in saved animal/preset state.
export const QUADRUPED_TRAVEL_LIMITS = Object.freeze({
  maxSegments: 256,
  historyFrames: 80, // Three footprint cycles plus the preceding touchdown.
  maxPosition: 1_000_000_000,
  maxWorldX: 1_000_000_000,
});

const LANES = Object.freeze(["front-left", "front-right", "rear-left", "rear-right"]);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high, fallback = low) => Math.min(high, Math.max(low, finite(value, fallback)));
const positionValue = value => clamp(value, -QUADRUPED_TRAVEL_LIMITS.maxPosition, QUADRUPED_TRAVEL_LIMITS.maxPosition);
const worldValue = value => clamp(value, -QUADRUPED_TRAVEL_LIMITS.maxWorldX, QUADRUPED_TRAVEL_LIMITS.maxWorldX);
const strideValue = (value, fallback = 0.9) => clamp(value, ...QUADRUPED_LIMITS.stride, fallback);
const directionValue = (value, fallback = 1) => finite(value, fallback) < 0 ? -1 : 1;
const minimumJerk = value => value ** 3 * (10 - 15 * value + 6 * value ** 2);

function segmentAt(travel, position) {
  const segments = travel?.segments;
  if (!Array.isArray(segments) || !segments.length || segments.length > QUADRUPED_TRAVEL_LIMITS.maxSegments) return null;
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (finite(segments[middle]?.position) <= position) low = middle;
    else high = middle - 1;
  }
  return segments[low];
}

function worldAt(travel, position, stride) {
  const segment = segmentAt(travel, position);
  if (!segment) return position / 16 * stride;
  return worldValue(finite(segment.worldX)
    + (position - positionValue(segment.position)) / 16
      * strideValue(segment.stride, stride) * clamp(segment.direction, -1, 1, 1));
}

/** Signed world coordinate; negative score positions support pre-roll anchors. */
export function quadrupedWorldAtPosition(score, position = 0) {
  const p = positionValue(position);
  const stride = strideValue(score?.stride);
  return worldAt(score?.worldTravel, p, stride);
}

function freezeTravel(segments, anchors = {}, swings = {}) {
  const last = segments.at(-1);
  return Object.freeze({
    version: 1,
    direction: directionValue(last.direction),
    stride: last.stride,
    segments: Object.freeze(segments.map(segment => Object.freeze({ ...segment }))),
    anchors: Object.freeze(anchors),
    swings: Object.freeze(swings),
  });
}

/** Start a new course. Use changeQuadrupedTravel to reverse an existing course. */
export function createQuadrupedTravel({ position = 0, worldX, direction = 1, stride = 0.9 } = {}) {
  const p = positionValue(position);
  const step = strideValue(stride);
  return freezeTravel([{
    position: p,
    worldX: worldValue(worldX === undefined ? p / 16 * step : worldX),
    direction: directionValue(direction),
    stride: step,
  }]);
}

function boundedSegments(segments, position) {
  const cutoff = position - QUADRUPED_TRAVEL_LIMITS.historyFrames;
  // Keep the segment covering the oldest visible footprint. Its earlier part
  // also supplies pre-roll support when the instrument starts at frame zero.
  let first = 0;
  while (first + 1 < segments.length && segments[first + 1].position <= cutoff) first += 1;
  const kept = segments.slice(first);
  while (kept.length > QUADRUPED_TRAVEL_LIMITS.maxSegments) {
    // Extreme repeated reversals can exceed the cap inside one footprint span.
    // Simplify the least consequential historical corner, preserving endpoints
    // and the newest segment. Live planted anchors are captured separately.
    let candidate = 1;
    let leastError = Infinity;
    for (let index = 1; index < kept.length - 1; index += 1) {
      const previous = kept[index - 1];
      const point = kept[index];
      const next = kept[index + 1];
      const span = next.position - previous.position;
      const expected = previous.worldX + (next.worldX - previous.worldX)
        * (point.position - previous.position) / Math.max(1e-12, span);
      const error = Math.abs(point.worldX - expected) * span;
      if (error < leastError) { leastError = error; candidate = index; }
    }
    const previous = kept[candidate - 1];
    const next = kept[candidate + 1];
    const slope = (next.worldX - previous.worldX) * 16 / Math.max(1e-12, next.position - previous.position);
    kept[candidate - 1] = { ...previous, stride: QUADRUPED_LIMITS.stride[1], direction: clamp(slope / QUADRUPED_LIMITS.stride[1], -1, 1) };
    kept.splice(candidate, 1);
  }
  return kept;
}

/**
 * Change direction/stride at the current monotonically advancing score position.
 * Pass current support.legs as feet to retain exact planted anchors even under
 * history compaction, and to retarget airborne feet without a positional jump.
 */
export function changeQuadrupedTravel(travel, { position = 0, direction, stride, feet } = {}) {
  const p = positionValue(position);
  const step = strideValue(stride, strideValue(travel?.stride));
  const sign = directionValue(direction, directionValue(travel?.direction));
  const source = segmentAt(travel, p) ? travel : createQuadrupedTravel({ position: p, stride: step });
  const last = source.segments.at(-1);
  if (p >= last.position && last.direction === sign && last.stride === step) return source;
  const worldX = worldAt(source, p, step);
  const segments = source.segments.filter(segment => segment.position < p).map(segment => ({ ...segment }));
  segments.push({ position: p, worldX, direction: sign, stride: step });
  const anchors = {};
  const swings = {};
  for (const laneId of LANES) {
    const foot = Array.isArray(feet) ? feet.find(value => value?.laneId === laneId) : feet?.[laneId];
    if (!foot?.eventId || !Number.isFinite(foot.previousTouchdownPosition)) continue;
    if (Number.isFinite(foot.anchorWorldX) && Number.isFinite(foot.anchorWorldY)) {
      anchors[laneId] = Object.freeze({
        eventId: String(foot.eventId),
        touchdownPosition: positionValue(foot.previousTouchdownPosition),
        worldX: worldValue(foot.anchorWorldX),
        worldY: worldValue(foot.anchorWorldY),
      });
    }
    if (foot.grounded || !Number.isFinite(foot.nextTouchdownPosition)
      || foot.nextTouchdownPosition <= p || !Number.isFinite(foot.footWorldX) || !Number.isFinite(foot.footWorldY)) continue;
    swings[laneId] = Object.freeze({
      eventId: String(foot.eventId),
      startPosition: p,
      endPosition: positionValue(foot.nextTouchdownPosition),
      worldX: worldValue(foot.footWorldX),
      worldY: worldValue(foot.footWorldY),
    });
  }
  return freezeTravel(boundedSegments(segments, p), anchors, swings);
}

/** Re-time/reset a score while keeping its current physical world coordinate. */
export function rebaseQuadrupedTravel(travel, {
  previousPosition = 0, position = 0, worldX, direction, stride,
} = {}) {
  const step = strideValue(stride, strideValue(travel?.stride));
  return createQuadrupedTravel({
    position,
    worldX: worldX === undefined ? worldAt(travel, positionValue(previousPosition), step) : worldX,
    direction: directionValue(direction, directionValue(travel?.direction)),
    stride: step,
  });
}

/** Remaining-swing retarget. Grounded feet never pass through this function. */
export function quadrupedTravelSwing(travel, laneId, eventId, position, endPosition, targetX, targetY) {
  const swing = travel?.swings?.[laneId];
  if (!swing || swing.eventId !== eventId || position < swing.startPosition || position >= swing.endPosition
    || Math.abs(endPosition - swing.endPosition) > 1e-7) return null;
  const progress = minimumJerk(clamp((position - swing.startPosition) / Math.max(1e-9, swing.endPosition - swing.startPosition), 0, 1));
  return {
    worldX: finite(swing.worldX) + (targetX - finite(swing.worldX)) * progress,
    worldY: finite(swing.worldY) + (targetY - finite(swing.worldY)) * progress,
  };
}
