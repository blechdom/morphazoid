const clamp = value => Math.max(0, Math.min(1, value));
export const spiderStrandKey = strand => strand.source === 'silk' ? `silk:${strand.silkId}` : `web:${strand.segmentId}`;
function project(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy));
  return { t, distance: Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) };
}
function closestStroke(from, to, a, b) {
  const dx = to.x - from.x, dy = to.y - from.y, sx = b.x - a.x, sy = b.y - a.y;
  const cross = dx * sy - dy * sx;
  if (Math.abs(cross) > 1e-8) {
    const ax = a.x - from.x, ay = a.y - from.y;
    const t = (ax * sy - ay * sx) / cross, u = (ax * dy - ay * dx) / cross;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { t, u, distance: 0 };
  }
  const start = project(from, a, b), end = project(to, a, b), first = project(a, from, to), last = project(b, from, to);
  return [{ t: 0, u: start.t, distance: start.distance }, { t: 1, u: end.t, distance: end.distance },
    { t: first.t, u: 0, distance: first.distance }, { t: last.t, u: 1, distance: last.distance }]
    .sort((a, b) => a.distance - b.distance || a.t - b.t)[0];
}
/** Swept screen-space picking catches strings skipped between pointer events.
 * Contacts latch until the pointer leaves a wider band, allowing return strokes
 * without jitter or duplicate hits from the pieces of one vibrating string. */
export function sweepSpiderStrings(parts, from, to, contacts) {
  if (Math.hypot(to.x - from.x, to.y - from.y) < .01) return [];
  const hits = new Map(), distances = new Map();
  for (const part of parts) {
    const key = spiderStrandKey(part), endpoint = project(to, part.a, part.b).distance;
    distances.set(key, Math.min(distances.get(key) ?? Infinity, endpoint));
    const hit = closestStroke(from, to, part.a, part.b);
    if (hit.distance > 9 || contacts.has(key)) continue;
    const candidate = { key, source: part.source, segmentId: part.segmentId, silkId: part.silkId,
      u: part.u0 + hit.u * (part.u1 - part.u0), t: hit.t };
    if (!hits.has(key) || hit.t < hits.get(key).t) hits.set(key, candidate);
  }
  const ordered = [...hits.values()].sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));
  for (const key of contacts) if ((distances.get(key) ?? Infinity) > 12) contacts.delete(key);
  for (const hit of ordered) if (distances.get(hit.key) <= 12) contacts.add(hit.key);
  return ordered;
}

/** Clip the visible portion of a projected string, even when both endpoints
 * lie beyond opposite viewport edges. Depth-rejected projections stay excluded. */
export function clipSpiderScreenStrand(a, b, rect) {
  if (!a?.depthVisible || !b?.depthVisible || !rect
    || ![a.x, a.y, b.x, b.y, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x - rect.left], [dx, rect.left + rect.width - a.x],
    [-dy, a.y - rect.top], [dy, rect.top + rect.height - a.y]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; t0 = Math.max(t0, t); }
    else { if (t < t0) return null; t1 = Math.min(t1, t); }
  }
  return { a: { x: a.x + dx * t0, y: a.y + dy * t0 },
    b: { x: a.x + dx * t1, y: a.y + dy * t1 }, t0, t1 };
}
