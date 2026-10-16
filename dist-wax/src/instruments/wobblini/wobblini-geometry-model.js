import { WOBBLINI_DECK_COUNT, clamp } from "./wobblini-model.js";

// Canvas coordinates: left/right is pan; moving upward increases linear gain.
// The geometry is a view of the mix, never a second owner of deck state.
const coordinate = (value, fallback = 0) => clamp(value, -1, 1, fallback);

function mapEntries(entries, project) {
  if (!Array.isArray(entries)) return [];
  const ids = new Set(), result = [];
  for (let index = 0; index < Math.min(entries.length, WOBBLINI_DECK_COUNT); index++) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") continue;
    const id = entry.id === undefined ? index : entry.id;
    if (!Number.isInteger(id) || id < 0 || id >= WOBBLINI_DECK_COUNT || ids.has(id)) continue;
    ids.add(id); result.push({ id, ...project(entry) });
  }
  return result;
}

const boundedPoints = points => mapEntries(points, point => ({ x: coordinate(point.x), y: coordinate(point.y) }));

export function pointsFromDecks(decks) {
  return mapEntries(decks, deck => ({ x: coordinate(deck.pan), y: 1 - 2 * clamp(deck.gain, 0, 1, 0.7) }));
}

export function patchesFromPoints(points) {
  return boundedPoints(points).map(({ id, x, y }) => ({ id, pan: x, gain: (1 - y) / 2 }));
}

export function centroid(points) {
  const bounded = boundedPoints(points);
  if (!bounded.length) return { x: 0, y: 0 };
  return { x: bounded.reduce((sum, point) => sum + point.x, 0) / bounded.length,
    y: bounded.reduce((sum, point) => sum + point.y, 0) / bounded.length };
}

/** Always transform the gesture's initial snapshot, not its previous result.
 * Scale around the pivot, rotate in screen-coordinate radians, then translate.
 * Only the resulting points are clipped, so returning the gesture to its start
 * can recover points that previously reached a boundary. */
export function transformPoints(points, options = {}) {
  options ??= {};
  const snapshot = boundedPoints(points), center = centroid(snapshot);
  const pivot = { x: coordinate(options.pivot?.x, center.x), y: coordinate(options.pivot?.y, center.y) };
  const sx = clamp(options.scaleX, -16, 16, 1), sy = clamp(options.scaleY, -16, 16, 1);
  const tx = clamp(options.translateX, -2, 2, 0), ty = clamp(options.translateY, -2, 2, 0);
  const angle = Number.isFinite(options.rotation) ? options.rotation % (2 * Math.PI) : 0;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return snapshot.map(({ id, x, y }) => {
    const dx = (x - pivot.x) * sx, dy = (y - pivot.y) * sy;
    return { id, x: coordinate(pivot.x + dx * cos - dy * sin + tx),
      y: coordinate(pivot.y + dx * sin + dy * cos + ty) };
  });
}

/** Pull one numbered point; missing or invalid coordinates keep its prior axis. */
export function withPoint(points, id, target = {}) {
  return boundedPoints(points).map(point => point.id === id
    ? { id, x: coordinate(target?.x, point.x), y: coordinate(target?.y, point.y) } : point);
}

/** Explicit arrangement only: opening the mixer must preserve the current mix. */
export function octagonPoints() {
  return Array.from({ length: WOBBLINI_DECK_COUNT }, (_, id) => {
    const angle = id * Math.PI / 4 - Math.PI / 2;
    return { id, x: 0.8 * Math.cos(angle), y: -0.2 + 0.5 * Math.sin(angle) };
  });
}

export function centerPans(points) {
  return boundedPoints(points).map(({ id, y }) => ({ id, x: 0, y }));
}
