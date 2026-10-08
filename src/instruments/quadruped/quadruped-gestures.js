const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const coordinate = (value, fallback = 0) => clamp(finite(value, fallback), -1e6, 1e6);
const timestamp = (value, fallback = 0) => clamp(finite(value, fallback), 0, 1e12);

function targetRect(points, fallback, offsetX, laneLeft, laneWidth) {
  const valid = points.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (!valid.length) valid.push({ x: finite(fallback?.x), y: finite(fallback?.y) });
  const xs = valid.map(point => coordinate(point.x + offsetX));
  const ys = valid.map(point => coordinate(point.y));
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const width = Math.min(laneWidth, Math.max(32, right - left + 8));
  const height = Math.max(32, bottom - top + 8);
  return {
    x: clamp((left + right - width) / 2, laneLeft, laneLeft + laneWidth - width),
    y: (top + bottom - height) / 2,
    width,
    height,
  };
}

/** CSS-pixel targets for the same rig that paints the animal, clipped to its lane. */
export function quadrupedGestureTargets(rig = {}, { offsetX = 0, laneLeft = 0, laneWidth } = {}) {
  const offset = coordinate(offsetX), left = coordinate(laneLeft);
  const width = clamp(finite(laneWidth, Math.max(32, finite(rig.center?.x, 320) * 2)), 1, 8192);
  const bodyPoints = [...(rig.body ?? []), ...(rig.humps ?? []).flat()];
  // Long horns and ears remain expressive anatomy, without stealing a large
  // rectangular area from the body. The elephant's trunk is a head gesture.
  const headPoints = [...(rig.skull ?? []), ...(rig.features ?? [])
    .filter(feature => feature.kind === "trunk").flatMap(feature => feature.points ?? [])];
  return {
    head: targetRect(headPoints, rig.head, offset, left, width),
    body: targetRect(bodyPoints, rig.center, offset, left, width),
  };
}

/** A gesture owns no clock or musical state; the caller decides when to perform it. */
export function createQuadrupedGesture({ x, y, time, width, height, part, actorIndex } = {}) {
  const startX = coordinate(x), startY = coordinate(y), startTime = timestamp(time);
  const safeWidth = clamp(finite(width, 640), 1, 8192);
  const safeHeight = clamp(finite(height, 360), 1, 4096);
  const head = part === "head";
  return {
    startX, startY, startTime, x: startX, y: startY, time: startTime,
    width: safeWidth, height: safeHeight, part: head ? "head" : "body",
    actorIndex: clamp(Math.trunc(finite(actorIndex)), 0, 2),
    slop: clamp(Math.min(safeWidth, safeHeight) * 0.025, 8, 12),
    dx: 0, dy: 0, moved: false, action: head ? "call" : null,
    strength: head ? 0.65 : 0, pitch: 0,
    direction: 0, extremeX: startX, extremeY: startY,
    reversals: 0, firstReversalTime: null, dance: false,
    distance: 0,
  };
}

/** Interpret one pointer sample without mutating the preceding sample. Pitch is −1…1. */
export function advanceQuadrupedGesture(gesture, sample = {}) {
  const previous = gesture ?? createQuadrupedGesture(sample);
  const x = coordinate(sample.x, previous.x), y = coordinate(sample.y, previous.y);
  const time = Math.max(previous.time, timestamp(sample.time, previous.time));
  const dx = x - previous.startX, dy = y - previous.startY;
  const next = {
    ...previous, x, y, time, dx, dy,
    moved: previous.moved || Math.hypot(dx, dy) >= previous.slop,
    distance: Math.min(1e7, previous.distance + Math.hypot(x - previous.x, y - previous.y)),
    pitch: clamp(-dy / Math.max(24, previous.height * 0.45), -1, 1),
  };
  if (previous.part === "head") {
    next.action = "call";
    next.strength = clamp(0.65 + Math.abs(dx) / Math.max(32, previous.width) * 0.6 + Math.abs(dy) / Math.max(32, previous.height) * 0.2, 0, 1);
    return next;
  }

  // Accumulate excursion from the latest horizontal extreme. Tiny alternating
  // pointer deltas cannot become dance; each reversed leg must travel 12px.
  const leg = x - previous.extremeX, verticalLeg = y - previous.extremeY;
  const direction = Math.sign(leg);
  if (!previous.direction) {
    if (Math.abs(leg) >= 12 && Math.abs(leg) >= Math.abs(verticalLeg)) {
      next.direction = direction; next.extremeX = x; next.extremeY = y;
    }
  } else if (direction === previous.direction) {
    next.extremeX = x; next.extremeY = y;
  } else if (Math.abs(leg) >= 12 && Math.abs(leg) >= Math.abs(verticalLeg)) {
    next.reversals = previous.firstReversalTime !== null && time - previous.firstReversalTime <= 1000
      ? Math.min(2, previous.reversals + 1) : 1;
    next.firstReversalTime = next.reversals === 1 ? time : previous.firstReversalTime;
    next.direction = direction; next.extremeX = x; next.extremeY = y;
    next.dance = previous.dance || next.reversals >= 2;
  }

  const horizontal = Math.abs(dx), upward = -dy;
  if (next.dance) {
    next.action = "dance";
    next.strength = clamp(next.distance / Math.max(48, previous.width * 0.8), 0.2, 1);
  } else if (upward >= Math.max(18, previous.height * 0.1) && upward > horizontal * 1.2) {
    next.action = "jump";
    next.strength = clamp(upward / Math.max(36, previous.height * 0.6), 0.2, 1);
  } else if (horizontal >= previous.slop && horizontal >= Math.abs(dy) * 0.8) {
    next.action = dx < 0 ? "backward" : "run";
    next.strength = clamp(horizontal / Math.max(32, previous.width * 0.45), 0.15, 1);
  } else {
    next.action = null; next.strength = 0;
  }
  return next;
}
