/** Device feedback for the drawing budget. This never changes audio admission. */
const positiveCount = (value, fallback = 1) => Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
const nonnegative = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Start from the measured DSP preparation capacity, including the input root.
 * Retain that learned capacity when the current preset needs fewer nodes.
 * Costs must include every rendered frame, including morphs and rebuilds.
 * Pass continuous:false after an idle gap; deliberate low FPS is represented
 * by expectedFrameMs, so neither inactivity nor planned backoff is a stall. */
export function createGraphicsCapacity({ preparedVoices = 0, nodeCount = 0,
  targetFrameMs = 1000 / 60, workBudgetMs = 4, setupBudgetMs = 8, growthDelayMs = 750 } = {}) {
  let limit = positiveCount(nonnegative(preparedVoices) + 1);
  let availableNodes = Math.floor(nonnegative(nodeCount));
  const frameTarget = Math.max(1, nonnegative(targetFrameMs) || 1000 / 60);
  const workTarget = Math.max(.1, nonnegative(workBudgetMs) || 4);
  const setupTarget = Math.max(.1, nonnegative(setupBudgetMs) || 8);
  const growthDelay = Math.max(frameTarget, nonnegative(growthDelayMs) || 750);
  let previousTime = null, healthySince = null, healthySamples = 0, averagePressure = null;
  let lastPressure = 0, changes = 0, lastChange = 'initial', lateFrames = 0;
  const resetGrowth = () => { healthySince = null; healthySamples = 0; };
  return {
    get limit() { return limit; },
    ensureCapacity({ availableNodes: nextNodes } = {}) {
      if (Number.isFinite(nextNodes)) {
        const demand = Math.floor(nonnegative(nextNodes));
        if (demand !== availableNodes) resetGrowth();
        availableNodes = demand;
      }
      // A new audio preparation count is evidence for audio, not permission
      // to overwrite a graphics reduction. The next real frames can grow it.
      return false;
    },
    observe({ nowMs, workMs, setupMs, frameIntervalMs, expectedFrameMs = frameTarget,
      continuous = true, drawnNodes = Math.min(limit, availableNodes), audioLoad = 0, peakLoad = 0 } = {}) {
      const expected = Math.max(1, nonnegative(expectedFrameMs) || frameTarget);
      const now = Number.isFinite(nowMs) ? nowMs : (previousTime ?? 0) + expected;
      if (previousTime !== null && now < previousTime) { resetGrowth(); previousTime = now; return false; }
      previousTime = now;
      const measured = Number.isFinite(workMs) || Number.isFinite(setupMs)
        || (continuous && Number.isFinite(frameIntervalMs) && frameIntervalMs > 0);
      if (!measured) { resetGrowth(); return false; }
      const workPressure = nonnegative(workMs) / workTarget;
      const setupPressure = nonnegative(setupMs) / setupTarget;
      const interval = continuous ? nonnegative(frameIntervalMs) / expected : 0;
      lateFrames = interval > 1.2 ? lateFrames + 1 : 0;
      // A single delayed UI callback is not proof that drawing became costly.
      // Repeated missed frames still capture asynchronous GPU/compositor load.
      const cadencePressure = interval > 1.2 && (workPressure >= .25 || lateFrames >= 3) ? interval : 0;
      const cpuMultiplier = audioLoad >= .85 || peakLoad >= .95 ? 2
        : audioLoad >= .65 || peakLoad >= .85 ? 1.3 : 1;
      // Under audio pressure reduce costly drawing first. Cheap frames must
      // not repeatedly halve the tree merely because audio uses its budget.
      const pressure = Math.max(workPressure * cpuMultiplier, setupPressure, cadencePressure);
      lastPressure = pressure;
      averagePressure = averagePressure === null ? pressure : averagePressure + (pressure - averagePressure) * .2;
      if (pressure > 1.2) {
        resetGrowth();
        // One slow setup or deadline warning reduces actual topology work on
        // the next frame. Cheap frames then recover through the growth path.
        const measuredCount = Math.min(limit, positiveCount(drawnNodes, limit));
        const next = Math.max(1, Math.floor(measuredCount * clamp(.85 / pressure, .2, .8)));
        if (next === limit) return false;
        limit = next; changes++; lastChange = 'shrink'; return true;
      }
      const saturated = drawnNodes >= limit * .8 && availableNodes > limit;
      const headroom = pressure <= .65 && averagePressure <= .75 && interval <= 1.15
        && nonnegative(audioLoad) < .55 && nonnegative(peakLoad) < .75;
      if (!saturated || !headroom) { resetGrowth(); return false; }
      healthySince ??= now; healthySamples++;
      if (healthySamples < 12 || now - healthySince < growthDelay) return false;
      const next = Math.min(availableNodes, Math.max(limit + 1, Math.ceil(limit * 1.15)));
      resetGrowth();
      if (next === limit) return false;
      limit = next; changes++; lastChange = 'grow'; return true;
    },
    diagnostics() { return { limit, availableNodes, pressure: lastPressure,
      averagePressure: averagePressure ?? 0, healthySamples, changes, lastChange }; },
  };
}

// Raw Rust replies use key/parentKey. Normalized drawing replies use id/parentId.
// Canonicalizing lookup keys does not alter any node or its voice/meter metadata.
const nodeKey = value => value === null || value === undefined || value === '' ? null : String(value).replace(/^generation:/, '');
// Rust also serializes numeric id/parent fields; its semantic lineage is key.
const idFor = node => nodeKey(node.key ?? node.id);
const parentFor = node => nodeKey(Object.hasOwn(node, 'parentId') ? node.parentId : node.parentKey);
const rankFor = node => Number.isFinite(node.priority) && node.priority >= 0 ? node.priority : Infinity;

/** Index an already device-bounded prepared graph once. Grow a connected,
 * parent-first frontier in audible rank order; only returned references reach
 * transition cloning, geometry maps, waveform caches and GPU setup.
 * Repeated selects at the same effective limit reuse the same array. */
export function createConnectedGraphicsSelection(nodes = []) {
  const unique = new Map(), children = new Map();
  let root;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index], id = idFor(node);
    if (id === null || unique.has(id)) continue;
    const item = { node, index, id, parent: parentFor(node), rank: rankFor(node) };
    unique.set(id, item);
    if (!root && node.generation === 0 && item.parent === null) root = item;
  }
  root ??= [...unique.values()].find(item => item.parent === null);
  for (const item of unique.values()) {
    if (item === root || item.parent === null || !unique.has(item.parent)) continue;
    if (!children.has(item.parent)) children.set(item.parent, []);
    children.get(item.parent).push(item);
  }
  const heap = [], prefix = [], selectedIds = new Set();
  const before = (a, b) => a.rank < b.rank || (a.rank === b.rank && a.index < b.index);
  function push(item) {
    let index = heap.length; heap.push(item);
    while (index) {
      const parent = (index - 1) >> 1;
      if (!before(item, heap[parent])) break;
      heap[index] = heap[parent]; index = parent;
    }
    heap[index] = item;
  }
  function pop() {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
        if (!before(heap[child], last)) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = last;
    }
    return first;
  }
  if (root) push(root);
  let selection = [], requested = -1;
  return {
    select(nodeLimit) {
      const count = Number.isFinite(nodeLimit) ? Math.max(0, Math.min(nodes.length, Math.floor(nodeLimit)))
        : nodeLimit === Infinity ? nodes.length : 0;
      if (count === requested) return selection;
      requested = count;
      while (prefix.length < count && heap.length) {
        const item = pop();
        if (selectedIds.has(item.id)) continue;
        selectedIds.add(item.id); prefix.push(item.node);
        for (const child of children.get(item.id) ?? []) if (!selectedIds.has(child.id)) push(child);
      }
      const length = Math.min(count, prefix.length);
      if (selection.length !== length) selection = prefix.slice(0, length);
      return selection;
    },
  };
}

export function selectConnectedGraphics(nodes, nodeLimit) {
  return createConnectedGraphicsSelection(nodes).select(nodeLimit);
}
