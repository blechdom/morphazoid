// Closed-path vector editing. Handles are offsets from their anchor; legacy
// points have a mirrored incoming handle when inHx/inHy are omitted.
const MAX_POINTS = 256;
const finite = value => Number.isFinite(value) ? value : 0;
const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const validBlob = blob => Array.isArray(blob?.points) && blob.points.length >= 3 && blob.points.length <= MAX_POINTS && blob.points.every(validPoint);
const validIndex = (blob, index) => validBlob(blob) && Number.isInteger(index) && index >= 0 && index < blob.points.length;
const clone = blob => ({ ...blob, points: blob.points.map(point => ({ ...point })) });

export function handles(point) {
  const out = { x: finite(point?.hx), y: finite(point?.hy) };
  return { out, in: { x: Number.isFinite(point?.inHx) ? point.inHx : -out.x, y: Number.isFinite(point?.inHy) ? point.inHy : -out.y } };
}

function controls(blob, segment) {
  const a = blob.points[segment], b = blob.points[(segment + 1) % blob.points.length];
  return [a, add(a, handles(a).out), add(b, handles(b).in), b];
}

function sample(blob, segment, t) {
  const a = blob.points[segment], b = blob.points[(segment + 1) % blob.points.length];
  if (blob.tool !== 'pen') return lerp(a, b, t);
  const [, p1, p2] = controls(blob, segment);
  const q0 = lerp(a, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, b, t);
  return lerp(lerp(q0, q1, t), lerp(q1, q2, t), t);
}

export function curvePoint(blob, segmentIndex, t) {
  if (!validIndex(blob, segmentIndex) || !Number.isFinite(t)) return null;
  return sample(blob, segmentIndex, Math.max(0, Math.min(1, t)));
}

export function insertPoint(blob, segmentIndex, t) {
  if (!validIndex(blob, segmentIndex) || blob.points.length >= MAX_POINTS || !Number.isFinite(t) || t <= 1e-4 || t >= 1 - 1e-4) return null;
  const next = clone(blob), nextIndex = (segmentIndex + 1) % blob.points.length;
  let inserted;
  if (blob.tool === 'pen') {
    const [a, p1, p2, b] = controls(blob, segmentIndex);
    const q0 = lerp(a, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, b, t);
    const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t), position = lerp(r0, r1, t);
    const aOut = subtract(q0, a), bIn = subtract(q2, b), aIn = handles(a).in;
    const newOut = subtract(r1, position), newIn = subtract(r0, position);
    // Materialize the old incoming handle before changing a legacy outgoing
    // handle: the preceding segment must remain exactly as it was.
    Object.assign(next.points[segmentIndex], { hx: aOut.x, hy: aOut.y, inHx: aIn.x, inHy: aIn.y });
    Object.assign(next.points[nextIndex], { inHx: bIn.x, inHy: bIn.y });
    inserted = { ...position, hx: newOut.x, hy: newOut.y, inHx: newIn.x, inHy: newIn.y };
  } else {
    inserted = { ...sample(blob, segmentIndex, t), hx: 0, hy: 0 };
  }
  // Appending at the closing segment preserves every existing point's index.
  next.points.splice(segmentIndex + 1, 0, inserted);
  return next;
}

export function removePoint(blob, index) {
  if (!validIndex(blob, index) || blob.points.length <= 3) return null;
  const next = clone(blob);
  next.points.splice(index, 1);
  return next;
}

export function smoothPoint(blob, index, smooth = true) {
  if (!validIndex(blob, index)) return null;
  const next = clone(blob);
  if (next.tool !== 'pen') {
    // Straight segments remain straight when entering the cubic representation.
    for (const point of next.points) Object.assign(point, { hx: 0, hy: 0, inHx: 0, inHy: 0 });
  }
  next.tool = 'pen';
  const before = next.points[(index + next.points.length - 1) % next.points.length], after = next.points[(index + 1) % next.points.length];
  const hx = smooth ? Math.max(-.3, Math.min(.3, (after.x - before.x) / 6)) : 0;
  const hy = smooth ? Math.max(-.3, Math.min(.3, (after.y - before.y) / 6)) : 0;
  Object.assign(next.points[index], { hx, hy, inHx: -hx, inHy: -hy });
  return next;
}

export function nearestSegment(blob, point, { transform = p => p, maxDistance = .03 } = {}) {
  if (!validBlob(blob) || !validPoint(point) || typeof transform !== 'function' || !(maxDistance >= 0)) return null;
  const steps = blob.tool === 'pen' ? 24 : 1;
  let best = null, bestSquared = Infinity;
  const evaluate = (segment, t) => {
    const source = sample(blob, segment, t), projected = transform(source);
    if (!validPoint(projected)) return Infinity;
    const squared = (projected.x - point.x) ** 2 + (projected.y - point.y) ** 2;
    if (squared < bestSquared) {
      bestSquared = squared;
      best = { segment, t, point: source, distance: Math.sqrt(squared) };
    }
    return squared;
  };
  for (let segment = 0; segment < blob.points.length; segment++) {
    let previous = transform(sample(blob, segment, 0));
    evaluate(segment, 0);
    for (let step = 1; step <= steps; step++) {
      const current = transform(sample(blob, segment, step / steps));
      evaluate(segment, step / steps);
      if (validPoint(previous) && validPoint(current)) {
        const dx = current.x - previous.x, dy = current.y - previous.y, lengthSquared = dx * dx + dy * dy;
        const fraction = lengthSquared > 0 ? Math.max(0, Math.min(1, ((point.x - previous.x) * dx + (point.y - previous.y) * dy) / lengthSquared)) : 0;
        evaluate(segment, (step - 1 + fraction) / steps);
      }
      previous = current;
    }
  }
  if (!best) return null;
  const segment = best.segment;
  let low = Math.max(0, best.t - 1 / steps), high = Math.min(1, best.t + 1 / steps);
  // Refine in transformed space so hit testing remains accurate when stretched,
  // skewed, rotated, reflected, or drawn at a different canvas scale.
  for (let i = 0; i < 24; i++) {
    const left = low + (high - low) / 3, right = high - (high - low) / 3;
    if (evaluate(segment, left) <= evaluate(segment, right)) high = right;
    else low = left;
  }
  evaluate(segment, (low + high) / 2);
  return best.distance <= maxDistance ? best : null;
}
