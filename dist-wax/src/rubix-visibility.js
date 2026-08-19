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

/**
 * Build a frozen `{ [stickerId]: normalizedArea }` profile.
 *
 * The largest visible projected sticker is 1; smaller stickers are proportional
 * to it. Hidden items are retained as zero. Duplicate IDs keep their largest
 * visible polygon, which makes the result stable during transitional geometry.
 */
export function createRubixVisibilityProfile(geometryItems = []) {
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
