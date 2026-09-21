/** Pure screen-space visibility helpers for the Rubix sequencer. */

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function finiteUnit(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : fallback;
}

function stickerId(source) {
  if (typeof source === "string") return source;
  return typeof source?.id === "string" ? source.id : "";
}

/**
 * Return the unsigned shoelace area of a projected polygon.
 * Invalid, incomplete, degenerate, or overflowing polygons safely return zero.
 */
export function projectedPolygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  const coordinates = points.map((point) => ({
    x: Number(point?.x),
    y: Number(point?.y),
  }));
  if (coordinates.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) return 0;

  let twiceArea = 0;
  for (let index = 0; index < coordinates.length; index += 1) {
    const current = coordinates[index];
    const next = coordinates[(index + 1) % coordinates.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  const area = Math.abs(twiceArea) * 0.5;
  return Number.isFinite(area) ? Math.max(0, area) : 0;
}

function geometryPoints(item) {
  if (Array.isArray(item?.projectedPoints)) return item.projectedPoints;
  if (Array.isArray(item?.stickerPoints)) return item.stickerPoints;
  return Array.isArray(item?.points) ? item.points : [];
}

function geometryPolygons(item) {
  if (Array.isArray(item?.projectedTriangles)) {
    return item.projectedTriangles.filter(Array.isArray);
  }
  return [geometryPoints(item)];
}

function bounds(points) {
  return points.reduce((box, { x, y }) => ({
    left: Math.min(box.left, x), right: Math.max(box.right, x),
    top: Math.min(box.top, y), bottom: Math.max(box.bottom, y),
  }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
}

function overlaps(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function halfPlane(polygon, a, b, sign) {
  const side = (p) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  const result = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const p = polygon[index];
    const q = polygon[(index + 1) % polygon.length];
    const dp = side(p);
    const dq = side(q);
    if (dp >= 0) result.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      result.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return result;
}

/** Subtract a convex painted polygon, retaining disjoint convex fragments. */
function subtract(polygon, occluder) {
  if (!overlaps(bounds(polygon), occluder.bounds)) return [polygon];
  const clip = occluder.points;
  const signedArea = clip.reduce((sum, p, i) => {
    const q = clip[(i + 1) % clip.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  const sign = signedArea < 0 ? -1 : 1;
  const outside = [];
  let inside = polygon;
  for (let index = 0; index < clip.length && inside.length >= 3; index += 1) {
    const a = clip[index];
    const b = clip[(index + 1) % clip.length];
    const piece = halfPlane(inside, a, b, -sign);
    if (projectedPolygonArea(piece) > 1e-8) outside.push(piece);
    inside = halfPlane(inside, a, b, sign);
  }
  return outside;
}

/**
 * Match the Canvas painter, not idealized face normals: clip to the viewport,
 * subtract every later-painted base/sticker, and count folded fans only once.
 * Input must be in the same back-to-front order used to draw the stage.
 */
export function rubixUncoveredAreas(geometryItems = [], { width, height } = {}) {
  const viewport = Number.isFinite(width) && Number.isFinite(height)
    ? [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
    : null;
  const occluders = [];
  const areas = new Map();
  for (const item of [...(Array.isArray(geometryItems) ? geometryItems : [])].reverse()) {
    const id = stickerId(item?.sticker);
    if (!id) continue;
    if (!areas.has(id)) areas.set(id, 0);
    if (item.hidden === true || item.visible === false) continue;
    const polygons = geometryPolygons(item).filter((points) => projectedPolygonArea(points) > 1e-8);
    for (const polygon of polygons) {
      let clipped = polygon;
      if (viewport) {
        for (let i = 0; i < 4; i += 1) {
          clipped = halfPlane(clipped, viewport[i], viewport[(i + 1) % 4], 1);
        }
      }
      let fragments = clipped.length >= 3 ? [clipped] : [];
      for (const occluder of occluders) {
        fragments = fragments.flatMap((fragment) => subtract(fragment, occluder));
        if (!fragments.length) break;
      }
      areas.set(id, areas.get(id) + fragments.reduce((sum, p) => sum + projectedPolygonArea(p), 0));
      // Later triangles of this same fan must not count the same pixels twice.
      occluders.push({ points: polygon, bounds: bounds(polygon) });
    }
    for (const triangle of item.baseSurface?.triangles ?? []) {
      if (triangle.visible && projectedPolygonArea(triangle.points) > 1e-8) {
        occluders.push({ points: triangle.points, bounds: bounds(triangle.points) });
      }
    }
  }
  return areas;
}

/**
 * Build a frozen `{ [stickerId]: normalizedArea }` profile.
 *
 * The largest visible projected sticker is 1; smaller stickers are proportional
 * to it. Hidden items are retained as zero. Duplicate IDs keep their largest
 * visible polygon, which makes the result stable during transitional geometry.
 */
export function createRubixVisibilityProfile(geometryItems = [], viewport = null) {
  if (viewport) {
    const areas = rubixUncoveredAreas(geometryItems, viewport);
    const maximum = Math.max(0, ...areas.values());
    return Object.freeze(Object.fromEntries([...areas].map(([id, area]) => [
      id, maximum > 0 ? finiteUnit(area / maximum) : 0,
    ])));
  }
  const rawAreas = new Map();
  for (const item of Array.isArray(geometryItems) ? geometryItems : []) {
    const id = stickerId(item?.sticker);
    if (!id) continue;
    const hidden = item?.hidden === true || item?.visible === false;
    const area = hidden
      ? 0
      : geometryPolygons(item).reduce(
        (total, polygon) => total + projectedPolygonArea(polygon),
        0,
      );
    rawAreas.set(id, Math.max(rawAreas.get(id) ?? 0, area));
  }

  const maximumArea = Math.max(0, ...rawAreas.values());
  const profile = Object.fromEntries([...rawAreas].map(([id, area]) => [
    id,
    maximumArea > 0 ? finiteUnit(area / maximumArea) : 0,
  ]));
  return Object.freeze(profile);
}

/** Look up normalized apparent area; hidden, missing, and invalid entries are zero. */
export function rubixStickerVisibility(profile, stickerOrId) {
  const id = stickerId(stickerOrId);
  if (!id || !profile || typeof profile !== "object") return 0;
  return finiteUnit(profile[id]);
}

/**
 * Blend visibility into voice gain.
 *
 * Zero visibility is always silent. For a visible sticker, amount 0 bypasses
 * size modulation at unity and amount 1 follows normalized apparent area.
 */
export function rubixVisibilityGain(visibility, amount = 1) {
  const visibleArea = finiteUnit(visibility);
  if (visibleArea <= 0) return 0;
  const modulation = finiteUnit(amount, 1);
  return finiteUnit(1 - modulation + visibleArea * modulation);
}
