/** Pure helpers for editable relative playhead layouts. */

function safeCount(value, maximum = 12) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(maximum, Math.trunc(value)));
}

export function wrapOffset(value) {
  if (!Number.isFinite(value)) return 0;
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

/**
 * Canonical relative phases. Crossed scanners are equidistant on each axis so
 * the first vertical and horizontal lines meet at the same central phase.
 */
export function canonicalHeadOffsets(count, layout = "parallel") {
  const total = safeCount(count);
  if (layout !== "crossed") {
    return Array.from({ length: total }, (_, index) => index / total);
  }

  const verticalCount = Math.ceil(total / 2);
  const horizontalCount = Math.floor(total / 2);
  return Array.from({ length: total }, (_, index) => {
    const axisCount = index % 2 === 0 ? verticalCount : horizontalCount;
    return Math.floor(index / 2) / Math.max(1, axisCount);
  });
}

export function sanitizeHeadOffsets(offsets, count, layout = "parallel") {
  const canonical = canonicalHeadOffsets(count, layout);
  return canonical.map((fallback, index) => (
    Number.isFinite(offsets?.[index]) ? wrapOffset(offsets[index]) : fallback
  ));
}

export function updateHeadOffset(offsets, index, value) {
  if (!Number.isInteger(index) || index < 0 || index >= offsets.length) return [...offsets];
  const next = [...offsets];
  next[index] = wrapOffset(value);
  return next;
}
