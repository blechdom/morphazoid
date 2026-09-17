/**
 * Shared rounded canvas sizing. Defaults preserve the original Solid/Hyper rule.
 * The caller owns canvas assignment, observers, drawing, and frame scheduling.
 * This function does not access the DOM or any audio state.
 * null pixelBudget preserves pages with no pixel budget; null minPixelRatio
 * preserves pages that allow a device scale below one. Do not silently replace
 * an instrument's existing policy with the defaults.
 *
 * @param {{ width: number, height: number }} bounds
 * @param {number} devicePixelRatio
 * @param {{maxPixelRatio?: number, minPixelRatio?: number|null, pixelBudget?: number|null}} [options]
 */
export function canvasSizing(bounds, devicePixelRatio, {
  maxPixelRatio = 2,
  minPixelRatio = 1,
  pixelBudget = 3_000_000,
} = {}) {
  const cssWidth = Math.max(1, Math.round(bounds.width));
  const cssHeight = Math.max(1, Math.round(bounds.height));
  const budgetRatio = pixelBudget === null
    ? Infinity
    : Math.sqrt(pixelBudget / (cssWidth * cssHeight));
  const requestedRatio = Math.min(
    devicePixelRatio || 1,
    maxPixelRatio,
    budgetRatio,
  );
  const pixelRatio = minPixelRatio === null
    ? requestedRatio
    : Math.max(minPixelRatio, requestedRatio);
  return {
    cssWidth,
    cssHeight,
    pixelRatio,
    width: Math.round(cssWidth * pixelRatio),
    height: Math.round(cssHeight * pixelRatio),
  };
}
