/**
 * Client coordinates relative to a measured canvas rectangle, in CSS pixels.
 * Deliberately do not clamp, scale, round, sanitize or fall back to offsetX/Y.
 * The caller owns measurement, hit testing, capture, gestures and musical state.
 */
export function canvasLocalPoint(event, bounds) {
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

/**
 * Convert client coordinates to the caller's logical drawing dimensions.
 * Preserve multiplication-then-division and the existing one-pixel denominator.
 * This is NOT interchangeable with multiplying by a precomputed scale ratio.
 */
export function canvasScaledPoint(event, bounds, size) {
  return {
    x: (event.clientX - bounds.left) * size.width / Math.max(1, bounds.width),
    y: (event.clientY - bounds.top) * size.height / Math.max(1, bounds.height),
  };
}
