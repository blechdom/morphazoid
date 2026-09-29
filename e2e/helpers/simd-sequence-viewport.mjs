// Reveal only the requested gesture within the independently scrolling editor.
// The full canvas can be taller than its pane; every returned point still has
// to hit the actual target, never the pinned controls covering another region.
export async function revealLocalPoints(locator, points) {
  return locator.evaluate((element, points) => {
    const pane = element.closest('.simd-sequencer-scroll');
    if (!pane) throw new Error('Expected the independent sequence scroll region');
    const before = element.getBoundingClientRect(), viewport = pane.getBoundingClientRect();
    const top = Math.min(...points.map(point => point.y));
    const bottom = Math.max(...points.map(point => point.y));
    if (bottom - top > pane.clientHeight - 4) throw new Error('The requested gesture cannot fit in the sequence viewport');
    const center = before.top + (top + bottom) / 2;
    pane.scrollTop += center - (viewport.top + pane.clientTop + pane.clientHeight / 2);
    const after = element.getBoundingClientRect();
    return points.map(point => {
      const result = { x: after.left + point.x, y: after.top + point.y };
      const hit = document.elementFromPoint(result.x, result.y);
      if (hit !== element && !element.contains(hit)) {
        throw new Error(`Gesture point ${JSON.stringify(result)} is blocked for ${element.id || element.className} by ${hit?.tagName}#${hit?.id}`);
      }
      return result;
    });
  }, points);
}
