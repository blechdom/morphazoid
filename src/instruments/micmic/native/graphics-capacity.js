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
  let lastPressure = 0, lastWorkMs = 0, changes = 0, lastChange = 'initial', lateFrames = 0;
  let pendingLimit = null, cadenceTrial = null, cadenceSuppression = null, sceneRevision;
  let lateMinimum = Infinity, witness = null, rootWitness = null;
  let workTrial = null, workFloor = 0, workWitness = null;
  const resetGrowth = () => { healthySince = null; healthySamples = 0; };
  const resetLate = () => { lateFrames = 0; lateMinimum = Infinity; };
  const resetCadence = () => {
    resetLate(); cadenceTrial = cadenceSuppression = witness = rootWitness = null; pendingLimit = null;
    workTrial = workWitness = null; workFloor = 0;
  };
  // Callback delays include the compositor, other tabs and audio scheduling.
  // A smaller tree is a trial, not proof that its nodes caused that delay.
  const observation = () => ({ since: null, last: null, samples: 0, maximum: 0,
    sum: 0, workSum: 0, workMinimum: Infinity, workMaximum: 0, ratioMinimum: Infinity });
  function observeWindow(window, now, ratio, work, expected) {
    if (window.last !== null && (now <= window.last || now - window.last > Math.max(250, expected * 4))) {
      Object.assign(window, observation());
    }
    window.since ??= now; window.last = now; window.samples++;
    window.maximum = Math.max(window.maximum, ratio); window.sum += ratio;
    window.workSum += work; window.workMinimum = Math.min(window.workMinimum, work);
    window.workMaximum = Math.max(window.workMaximum, work);
    window.ratioMinimum = Math.min(window.ratioMinimum, ratio);
    return window.samples >= 6 && now - window.since >= 100;
  }
  return {
    get limit() { return limit; },
    ensureCapacity({ availableNodes: nextNodes, sceneRevision: nextRevision } = {}) {
      if (nextRevision !== undefined && nextRevision !== sceneRevision) {
        sceneRevision = nextRevision; resetGrowth(); resetCadence();
      }
      if (Number.isFinite(nextNodes)) {
        const demand = Math.floor(nonnegative(nextNodes));
        // More prepared nodes do not invalidate a failed causal trial. The
        // observation below still rechecks actual work/cadence as they draw.
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
      if (previousTime !== null && now < previousTime) { resetGrowth(); resetCadence(); previousTime = now; return false; }
      previousTime = now;
      const measured = Number.isFinite(workMs) || Number.isFinite(setupMs)
        || (continuous && Number.isFinite(frameIntervalMs) && frameIntervalMs > 0);
      if (!measured) { resetGrowth(); return false; }
      const work = nonnegative(workMs);
      if (Number.isFinite(workMs)) lastWorkMs = work;
      let workPressure = Math.max(0, work - workFloor) / workTarget;
      const setupPressure = nonnegative(setupMs) / setupTarget;
      const cpuMultiplier = audioLoad >= .85 || peakLoad >= .95 ? 2
        : audioLoad >= .65 || peakLoad >= .85 ? 1.3 : 1;
      const interval = continuous ? nonnegative(frameIntervalMs) / expected : 0;
      const rendered = continuous && Number.isFinite(frameIntervalMs) && frameIntervalMs > 0;
      const drawn = positiveCount(drawnNodes, limit);
      // A silent/zero-depth scene can draw only its irreducible input root.
      // Cutting cached membership cannot reduce that work or prove capacity.
      const reducible = drawn > 1;
      if (rendered && reducible && interval > 1.2) { lateFrames++; lateMinimum = Math.min(lateMinimum, interval); }
      else resetLate();
      const awaitingMembership = pendingLimit !== null && drawn > pendingLimit;
      if (!awaitingMembership) pendingLimit = null;
      let restored = false;
      if (rendered && !awaitingMembership && workTrial) {
        if (observeWindow(workTrial.window, now, interval, work, expected)) {
          const { window, before, beforeLimit, beforeInterval } = workTrial;
          if (window.workMaximum > before * .9) {
            // A sustained cost that did not improve with fewer drawn branches
            // is an irreducible frame floor. Leave a quarter work budget as a
            // margin; total cost still determines the app's FPS/DPR backoff.
            workFloor = Math.max(workFloor, window.workMinimum - workTarget * .25);
            if (beforeInterval > 1.2 && window.maximum > beforeInterval * .9) {
              cadenceSuppression = { work: window.workSum / window.samples, ratio: window.sum / window.samples };
            }
            if ((before - workFloor) / workTarget * cpuMultiplier <= .65) {
              // Restore the retained budget even for a small current preset;
              // selection remains bounded by its available prepared nodes.
              const next = beforeLimit;
              if (next > limit) { limit = next; changes++; lastChange = 'restore'; restored = true; }
            }
          }
          workTrial = workWitness = null; resetGrowth(); resetLate();
        }
      } else if (rendered && workFloor > 0 && work < workFloor) {
        workWitness ??= observation();
        if (observeWindow(workWitness, now, interval, work, expected)) {
          // A cheaper rendering mode invalidates the old floor. Re-measure
          // node-dependent work instead of masking it with stale overhead.
          workFloor = 0; workWitness = null;
        }
      } else workWitness = null;
      if (rendered && !awaitingMembership && cadenceTrial) {
        if (observeWindow(cadenceTrial.window, now, interval, nonnegative(workMs), expected)) {
          const window = cadenceTrial.window;
          // Require a coherent improvement, rather than letting an unrelated
          // fast callback after one slow frame validate successive count cuts.
          if (window.maximum > cadenceTrial.before * .9) {
            cadenceSuppression = { work: window.workSum / window.samples, ratio: window.sum / window.samples };
          }
          cadenceTrial = null; witness = null; resetLate();
        }
      } else if (rendered && reducible && !awaitingMembership && cadenceSuppression) {
        witness ??= observation();
        if (observeWindow(witness, now, interval, nonnegative(workMs), expected)) {
          // New, sustained workload can justify another trial. Small timing
          // jitter or one expensive callback cannot erase an unsuccessful one.
          const changedWork = witness.workMinimum > cadenceSuppression.work * 1.5
            && witness.workMinimum > cadenceSuppression.work + workTarget * .25;
          const changedCadence = witness.ratioMinimum > cadenceSuppression.ratio * 1.35;
          if (changedWork || changedCadence) { cadenceSuppression = null; resetLate(); }
          witness = null;
        }
      } else if (rendered && !awaitingMembership && !cadenceTrial && !cadenceSuppression
        && !reducible && availableNodes > 1 && Number.isFinite(workMs)) {
        // A transient startup/work spike can reach the root without opening a
        // cadence trial. Its sustained cheap, irreducible work proves that
        // further callback delay cannot be resolved by cutting cached branches.
        rootWitness ??= observation();
        if (observeWindow(rootWitness, now, interval, nonnegative(workMs), expected)) {
          workFloor = Math.max(workFloor, rootWitness.workMinimum - workTarget * .25);
          cadenceSuppression = { work: rootWitness.workSum / rootWitness.samples,
            ratio: rootWitness.sum / rootWitness.samples };
          rootWitness = null; resetLate();
        }
      } else rootWitness = null;
      // Detect asynchronous GPU pressure, then verify that fewer drawn nodes
      // actually improve it before cutting again. Own work/setup overloads
      // remain actionable immediately, including during that verification.
      workPressure = Math.max(0, work - workFloor) / workTarget;
      const cadencePressure = !workTrial && !cadenceTrial && !cadenceSuppression && lateFrames >= 3 ? interval : 0;
      // Under audio pressure reduce costly drawing first. Cheap frames must
      // not repeatedly halve the tree merely because audio uses its budget.
      const pressure = Math.max(workPressure * cpuMultiplier, setupPressure, cadencePressure);
      lastPressure = pressure;
      averagePressure = averagePressure === null ? pressure : averagePressure + (pressure - averagePressure) * .2;
      if (pressure > 1.2) {
        resetGrowth();
        // Several frames can finish before an async membership update commits.
        // Do not apply the old frame's cost repeatedly to a not-yet-drawn limit.
        if (awaitingMembership || !reducible || (workTrial && setupPressure <= 1.2)) return restored;
        // One slow setup or deadline warning reduces actual topology work on
        // the next frame. Cheap frames then recover through the growth path.
        const measuredCount = Math.min(limit, positiveCount(drawnNodes, limit));
        const next = Math.max(1, Math.floor(measuredCount * clamp(.85 / pressure, .2, .8)));
        if (next === limit) return false;
        if (workPressure * cpuMultiplier > 1.2 && setupPressure <= 1.2) {
          workTrial = { before: work, beforeLimit: limit, beforeInterval: interval, window: observation() };
        } else workTrial = null;
        if (cadencePressure > 1.2 && workPressure * cpuMultiplier <= 1.2 && setupPressure <= 1.2) {
          cadenceTrial = { before: lateMinimum, window: observation() };
        } else { cadenceTrial = cadenceSuppression = witness = null; }
        pendingLimit = next; resetLate();
        limit = next; changes++; lastChange = 'shrink'; return true;
      }
      const saturated = drawnNodes >= limit * .8 && availableNodes > limit;
      const headroom = !awaitingMembership && !cadenceTrial && !workTrial
        && pressure <= .65 && averagePressure <= .75 && (interval <= 1.15 || cadenceSuppression);
      if (!saturated || !headroom) { resetGrowth(); return restored; }
      healthySince ??= now; healthySamples++;
      if (healthySamples < 12 || now - healthySince < growthDelay) return restored;
      const next = Math.min(availableNodes, Math.max(limit + 1, Math.ceil(limit * 1.15)));
      resetGrowth();
      if (next === limit) return restored;
      limit = next; changes++; lastChange = 'grow'; return true;
    },
    diagnostics() { return { limit, availableNodes, pressure: lastPressure,
      averagePressure: averagePressure ?? 0, healthySamples, changes, lastChange,
      pendingLimit, cadenceTrial: Boolean(cadenceTrial), cadenceSuppressed: Boolean(cadenceSuppression),
      workTrial: Boolean(workTrial), workFloor, workMs: lastWorkMs }; },
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
