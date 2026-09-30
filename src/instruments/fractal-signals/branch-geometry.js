/** Pure branch projections, shared by the score, drawing and audio clock. */
const MAX_BRANCH_POINTS = 768;
const RAD = Math.PI / 180;
const finite = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Circular degrees; full turns and negative zero have one canonical representation. */
export function wrapDegrees(value) {
  const angle = finite(value, 0) % 360;
  return angle < 0 ? (angle + 360) % 360 : angle === 0 ? 0 : angle;
}

/**
 * Prepare one angle for every point. Supply a reusable target in an audio callback.
 * Coefficients retain the original accumulated sine displacement and its cosine
 * counterpart, so applying an angle never rewrites the graph or its event times.
 */
export function branchFrame(geometry, degrees, target = {}) {
  const angle = wrapDegrees(degrees), radians = angle * RAD;
  const cos = angle === 0 ? 1 : Math.cos(radians), sin = angle === 0 ? 0 : Math.sin(radians);
  let maxY = .35;
  const count = Math.min(MAX_BRANCH_POINTS, geometry?.length || 0);
  for (let i = 0; i < count; i++) {
    const point = geometry[i];
    const y = finite(point?.ySin, 0) * cos + finite(point?.yCos, 0) * sin;
    if (Number.isFinite(y)) maxY = Math.max(maxY, Math.abs(y));
  }
  target.angle = angle; target.cos = cos; target.sin = sin; target.maxY = maxY;
  return target;
}

/** Normalized graphic height. Mapping to bipolar shape is (height - .5) * 2. */
export function branchShape(geometry, pointIndex, frame) {
  const point = pointIndex >= 0 && pointIndex < MAX_BRANCH_POINTS ? geometry?.[pointIndex] : null;
  const y = finite(point?.ySin, 0) * finite(frame?.cos, 1) + finite(point?.yCos, 0) * finite(frame?.sin, 0);
  return clamp(.5 + finite(y, 0) / Math.max(.35, finite(frame?.maxY, .35)) * .42, 0, 1);
}

/** Raw pitch coordinate, before Pitch span, inversion and Root are applied. */
export function branchPitch(geometry, pointIndex, frame) {
  const point = pointIndex >= 0 && pointIndex < MAX_BRANCH_POINTS ? geometry?.[pointIndex] : null;
  const bearing = finite(point?.bearingSin, 0) * finite(frame?.cos, 1) + finite(point?.bearingCos, 0) * finite(frame?.sin, 0);
  return (branchShape(geometry, pointIndex, frame) - .5) * 1.8 + clamp(finite(bearing, 0), -1, 1) * .12;
}


/** Preallocate once for audio or drawing. This array-like object has a mutable
 * length and 768 retained point objects, so changing frame sizes never allocates. */
export function createBranchTurnsTarget() {
  const target = { length: 0 };
  for (let i = 0; i < MAX_BRANCH_POINTS; i++) target[i] = { ySin: 0, yCos: 0, bearingSin: 0, bearingCos: 1 };
  return target;
}

/** Re-evaluate a prepared tree's bearings and cumulative positions. Parent links,
 * event phases, topology, and point identities stay fixed. Reuse the returned
 * array-like target as the third argument; branchFrame/Shape/Pitch accept it. */
export function branchTurnsGeometry(metadata, turns, target = createBranchTurnsTarget()) {
  const points = metadata?.points;
  const count = Math.min(MAX_BRANCH_POINTS, points?.length || 0);
  const value = clamp(finite(turns, finite(metadata?.turns, 0)), 0, 32);
  target.length = count;
  for (let i = 0; i < count; i++) {
    const point = points[i], parent = Number.isInteger(point?.parent) && point.parent >= 0 && point.parent < i ? target[point.parent] : null;
    const bearing = finite(point?.bearingSlope, 0) * value + finite(point?.bearingOffset, 0);
    const length = clamp(finite(point?.length, 0), 0, 2);
    const sin = Math.sin(bearing), cos = Math.cos(bearing), projected = target[i];
    projected.ySin = (parent?.ySin ?? 0) + sin * length;
    projected.yCos = (parent?.yCos ?? 0) + cos * length;
    projected.bearingSin = sin; projected.bearingCos = cos;
  }
  return target;
}


/** Validate prepared metadata once at the message boundary, never per point draw. */
export function validBranchTurns(metadata, count) {
  if (!metadata || !Number.isFinite(metadata.turns) || metadata.turns < 0 || metadata.turns > 32
    || !Array.isArray(metadata.points) || metadata.points.length !== count || count > MAX_BRANCH_POINTS) return false;
  for (let i = 0; i < count; i++) {
    const point = metadata.points[i];
    if (!Number.isInteger(point?.parent) || point.parent < -1 || point.parent >= i
      || !Number.isFinite(point.length) || point.length < 0 || point.length > 2
      || !Number.isFinite(point.bearingSlope) || !Number.isFinite(point.bearingOffset)) return false;
  }
  return true;
}
