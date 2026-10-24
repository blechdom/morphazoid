// One cassette at the back of the bench. Both ports face the exposed maze;
// the final, internal guide closes the audio/transport loop inside its shell.
// Coordinates are workbench units, not physical tape measurements.
export const CASSETTE = Object.freeze({ x: 0, z: -3.02, portX: 1.12, portZ: -1.87 });
// Keep bends out of the cassette itself, but allow a pulled ribbon to reach
// the front of the full-height canvas, including a portrait phone. The camera
// fits distant bends again when the viewport is resized.
export const ROLLER_BOUNDS = Object.freeze({ minX: -6.75, maxX: 6.75, minZ: -1.55, maxZ: 10.4 });
export const EDIT_MIN = .03, EDIT_MAX = .97;
export const MIN_SPLIT_SPAN = .035;
export const MAX_GUIDE_POSTS = 32, MAX_DELAY_POOLS = 6;
export const MAX_ROUTE_TRACE_POINTS = 384;
export const ROUTE_CORNER_TOLERANCE = .13;
export const MAX_PLAY_HEADS = 4, MAX_RECORD_HEADS = 3;
export const MIN_POOL_SECONDS = .15, MAX_POOL_SECONDS = 3;
export const BRANCH_POOL_MARGIN = .14, BRANCH_POOL_GAP = .26;
export const MAX_BRANCH_DELAY_SECONDS = 3.5;

export const DEFAULT_NODES = Object.freeze([
  { id: "cassette-out", kind: "anchor", x: -CASSETTE.portX, z: CASSETTE.portZ },
  { id: "roller-1", kind: "roller", x: -5.05, z: -.75 },
  { id: "roller-2", kind: "roller", x: -4.3, z: 2.6 },
  { id: "roller-3", kind: "roller", x: -1.95, z: -.2 },
  { id: "roller-4", kind: "roller", x: .25, z: 2.55 },
  { id: "roller-5", kind: "roller", x: 3.65, z: 2.3 },
  { id: "roller-6", kind: "roller", x: 5.1, z: -.75 },
  { id: "cassette-in", kind: "anchor", x: CASSETTE.portX, z: CASSETTE.portZ },
  { id: "cassette-inside", kind: "internal", x: CASSETTE.x, z: CASSETTE.z },
]);

export const DEFAULT_HEADS = Object.freeze([
  { id: "record", kind: "record", position: 0.19 },
  { id: "play-1", kind: "play", position: 0.37 },
  { id: "play-2", kind: "play", position: 0.52 },
]);

export const copyNodes = () => DEFAULT_NODES.map((node) => ({ ...node }));
export const copyHeads = () => DEFAULT_HEADS.map((head) => ({ ...head }));
export const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function nextPartId(items, prefix, first, last) {
  for (let number = first; number <= last; number += 1) {
    const id = `${prefix}-${number}`;
    if (!items.some(item => item.id === id)) return id;
  }
  return null;
}

export function clampRoller(x, z) {
  return { x: clamp(x, ROLLER_BOUNDS.minX, ROLLER_BOUNDS.maxX),
    z: clamp(z, ROLLER_BOUNDS.minZ, ROLLER_BOUNDS.maxZ) };
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function lerp(a, b, t) { return a + (b - a) * t; }

// A captured gesture stores pointer samples, NOT one guide per pointermove.
// Keep the newest position even on slow devices that fire many tiny moves.
// If a long hold reaches the trace budget, thin only nearly straight sections
// first; always retain the contacted tape and the moving tip.
export function appendRouteTrace(trace, point) {
  if (!Array.isArray(trace) || !trace.length || !Number.isFinite(point?.x)
    || !Number.isFinite(point?.z)) throw new TypeError("A route needs a finite contact and pointer");
  const next = clampRoller(point.x, point.z);
  const previous = trace.at(-1);
  if (distance(previous, next) < .045 && trace.length > 1) {
    return [...trace.slice(0, -1), next];
  }
  if (distance(previous, next) < 1e-6) return trace;
  const samples = [...trace, next];
  if (samples.length <= MAX_ROUTE_TRACE_POINTS) return samples;
  const reduced = [samples[0]];
  for (let index = 1; index < samples.length - 1; index += 1) {
    const a = reduced.at(-1), b = samples[index], c = samples[index + 1];
    if (segmentError(b, a, c) > .065 || distance(a, b) > .4) reduced.push(b);
  }
  reduced.push(next);
  if (reduced.length <= MAX_ROUTE_TRACE_POINTS) return reduced;
  // A deliberately noisy, hours-long drag is still bounded. The render
  // budget is separately capped by simplifyRouteTrace below.
  return [reduced[0], ...reduced.slice(1, -1).filter((_, index) => index % 2 === 0), next];
}

function segmentError(point, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const fraction = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz)
    / Math.max(dx * dx + dz * dz, 1e-9), 0, 1);
  return Math.hypot(point.x - a.x - fraction * dx, point.z - a.z - fraction * dz);
}

// Preserve the largest visible turns in their drawn order, including returns
// and self-crossings. A straight pull needs just one post; when a stroke turns,
// its first guide pins the pickup to the original tape. The last guide always
// follows the pointer. Even a very fast event draws the complete connecting
// segment, without relying on the browser delivering intermediate events.
export function simplifyRouteTrace(trace, budget = MAX_GUIDE_POSTS) {
  if (!Array.isArray(trace) || trace.length < 2 || !Number.isInteger(budget) || budget < 0
    || budget > MAX_GUIDE_POSTS || trace.some(point => !Number.isFinite(point?.x)
      || !Number.isFinite(point?.z))) throw new TypeError("Expected a bounded, finite tape stroke");
  if (!budget) return [];
  const last = trace.length - 1;
  if (budget === 1) return [{ ...trace[last] }];
  const selected = [0, last];
  while (selected.length < budget) {
    let bestIndex = -1, bestError = ROUTE_CORNER_TOLERANCE;
    for (let part = 1; part < selected.length; part += 1) {
      const start = selected[part - 1], end = selected[part];
      for (let index = start + 1; index < end; index += 1) {
        const error = segmentError(trace[index], trace[start], trace[end]);
        if (error > bestError) { bestIndex = index; bestError = error; }
      }
    }
    if (bestIndex < 0) break;
    selected.push(bestIndex);
    selected.sort((a, b) => a - b);
  }
  return (selected.length > 2 ? selected : [last])
    .map(index => ({ ...trace[index] }));
}

// Samples short quadratic corners so rollers still pull a taut, mostly straight
// ribbon. The full closed path drives time; only out -> rollers -> in is exposed.
export function buildPath(nodes) {
  if (!Array.isArray(nodes) || nodes.length < 3) throw new RangeError("A loop needs at least three guides");
  const points = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const previous = nodes[(i - 1 + nodes.length) % nodes.length];
    const current = nodes[i];
    const next = nodes[(i + 1) % nodes.length];
    const before = distance(previous, current);
    const after = distance(current, next);
    const radius = Math.min(current.kind === "roller" ? .22 : .06, before * .28, after * .28);
    const inbound = {
      x: lerp(current.x, previous.x, radius / Math.max(before, 1e-6)),
      z: lerp(current.z, previous.z, radius / Math.max(before, 1e-6)),
    };
    const outbound = {
      x: lerp(current.x, next.x, radius / Math.max(after, 1e-6)),
      z: lerp(current.z, next.z, radius / Math.max(after, 1e-6)),
    };
    points.push(inbound);
    for (let j = 1; j <= 5; j += 1) {
      const t = j / 5;
      points.push({
        x: (1 - t) ** 2 * inbound.x + 2 * (1 - t) * t * current.x + t ** 2 * outbound.x,
        z: (1 - t) ** 2 * inbound.z + 2 * (1 - t) * t * current.z + t ** 2 * outbound.z,
      });
    }
  }
  points.push({ ...points[0] });
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]));
  const out = nodes.findIndex(node => node.id === "cassette-out");
  const into = nodes.findIndex(node => node.id === "cassette-in");
  // Each guide contributes an inbound point followed by five bend samples.
  // The port mouths conceal the short bend into/out of each cassette anchor.
  const exposedStartIndex = out >= 0 && into > out ? out * 6 + 5 : 0;
  const exposedEndIndex = out >= 0 && into > out ? into * 6 : points.length - 1;
  const exposedStart = lengths[exposedStartIndex], exposedEnd = lengths[exposedEndIndex];
  return {
    points, lengths, total: lengths[lengths.length - 1],
    exposedStartIndex, exposedEndIndex, exposedStart, exposedEnd,
    exposedLength: exposedEnd - exposedStart,
  };
}

export function pointAt(path, position) {
  const target = (((position % 1) + 1) % 1) * path.total;
  let lo = 0, hi = path.lengths.length - 1;
  while (lo < hi - 1) {
    const middle = Math.floor((lo + hi) / 2);
    if (path.lengths[middle] <= target) lo = middle; else hi = middle;
  }
  const a = path.points[lo], b = path.points[lo + 1];
  const segmentLength = Math.max(path.lengths[lo + 1] - path.lengths[lo], 1e-9);
  const t = (target - path.lengths[lo]) / segmentLength;
  return {
    x: lerp(a.x, b.x, t),
    z: lerp(a.z, b.z, t),
    tx: (b.x - a.x) / segmentLength,
    tz: (b.z - a.z) / segmentLength,
  };
}

// Editing positions are fractions of the *exposed* ribbon. They stay on the
// workbench when a roller moves, while the sample-clock phase includes the
// unseen tape between the two ports.
export function exposedFraction(path, position) {
  return (path.exposedStart + clamp(position, 0, 1) * path.exposedLength) / path.total;
}
export function pointOnTape(path, position) { return pointAt(path, exposedFraction(path, position)); }
export function isExposed(path, position) {
  const distanceAlongLoop = (((position % 1) + 1) % 1) * path.total;
  return distanceAlongLoop >= path.exposedStart && distanceAlongLoop <= path.exposedEnd;
}

// The blade forks a *virtual* copy of the same track, not two open tape ends.
// Leave room between the touched tape and the next part for an automatic join.
// Factory/added guide positions use their own samples, not closestPoint:
// a self-crossing route can have a different, nearer segment.
export function razorSplitRange(path, position, nodes, heads, pools = []) {
  const records = heads.filter(head => head.kind === "record");
  const plays = heads.filter(head => head.kind === "play");
  const lastRecord = Math.max(...records.map(head => head.position));
  if (!Number.isFinite(position) || position < lastRecord + .02 || position > EDIT_MAX
    || !plays.some(head => head.position > position + .02)) return null;
  const parts = [
    ...heads.map(head => head.position),
    ...pools.map(pool => pool.position),
    ...nodes.flatMap((node, index) => node.kind === "roller"
      ? [(path.lengths[index * 6 + 3] - path.exposedStart) / path.exposedLength] : []),
    EDIT_MAX,
  ].sort((a, b) => a - b);
  if (parts.some(part => Math.abs(part - position) < .012)) return null;
  const before = Math.max(lastRecord, ...parts.filter(part => part <= position - .012));
  const after = parts.find(part => part >= position + .012);
  if (after === undefined) return null;
  const startLimit = Math.max(EDIT_MIN, lastRecord + .022, before + .013);
  const end = Math.min(EDIT_MAX, after - .018);
  const start = Math.min(position, end - MIN_SPLIT_SPAN - .001);
  return start >= startLimit && end - start >= MIN_SPLIT_SPAN - 1e-9
    ? { start, end } : null;
}

// A continuous entry, two different length routes, and a common exit. Only
// lane B needs a separating post; lane A follows the nearly direct strip.
// The PCM is never cut or duplicated in the audio callback.
export function makeSplit(path, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)
    || start < EDIT_MIN || end > EDIT_MAX || end - start < MIN_SPLIT_SPAN) {
    throw new RangeError("A fork needs room between two tape parts");
  }
  const from = pointOnTape(path, start), into = pointOnTape(path, end);
  const middle = pointOnTape(path, (start + end) / 2);
  const dx = into.x - from.x, dz = into.z - from.z;
  const inverse = 1 / Math.max(.1, Math.hypot(dx, dz));
  const nx = -dz * inverse, nz = dx * inverse;
  const sides = [1, -1].map(sign => ({
    sign, point: clampRoller(middle.x + nx * 1.55 * sign, middle.z + nz * 1.55 * sign),
  }));
  const { sign, point: b } = sides.sort((a, b) => (
    distance(b.point, middle) - distance(a.point, middle)
  ))[0];
  const a = clampRoller(middle.x - nx * .13 * sign, middle.z - nz * .13 * sign);
  return { start, end, guides: [{ id: "lane-a", ...a }, { id: "lane-b", ...b }] };
}

export function splitGeometry(path, split) {
  if (!split) return null;
  const from = pointOnTape(path, split.start);
  const secondsPerUnit = loopSeconds(path.total) / path.total;
  const join = split.join ?? split.end;
  const lanes = split.guides.map((guide, index) => {
    // Amber rejoins at the original guide. Blue may be Scotch-spliced to a
    // later part of the intact ribbon, bypassing its intervening route.
    const endPosition = index ? join : split.end;
    const into = pointOnTape(path, endPosition);
    const originalLength = (endPosition - split.start) * path.exposedLength;
    const firstLength = distance(from, guide), secondLength = distance(guide, into);
    const length = Math.max(.001, firstLength + secondLength);
    return {
      id: guide.id, from, guide, into, endPosition, firstLength, length,
      delaySeconds: clamp((length - originalLength) * secondsPerUnit, -3.5, 3.5),
    };
  });
  return { start: split.start, end: split.end, join, lanes };
}

export function pointOnSplitLane(lane, progress) {
  const along = clamp(progress, 0, 1) * lane.length;
  const first = along <= lane.firstLength;
  const a = first ? lane.from : lane.guide;
  const b = first ? lane.guide : lane.into;
  const leg = first ? lane.firstLength : lane.length - lane.firstLength;
  const t = (along - (first ? 0 : lane.firstLength)) / Math.max(leg, 1e-9);
  return {
    x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t),
    tx: (b.x - a.x) / Math.max(leg, 1e-9),
    tz: (b.z - a.z) / Math.max(leg, 1e-9),
  };
}

export function closestPointOnSplitLane(lane, x, z, ranges = [[0, 1]]) {
  let closest = { distance: Infinity, progress: 0, x: 0, z: 0 };
  for (const [from, to, before] of [
    [lane.from, lane.guide, 0],
    [lane.guide, lane.into, lane.firstLength],
  ]) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    for (const [start, end] of ranges) {
      const low = Math.max(before / lane.length, start);
      const high = Math.min((before + length) / lane.length, end);
      if (high < low || length < 1e-9) continue;
      const first = (low * lane.length - before) / length;
      const last = (high * lane.length - before) / length;
      const fraction = clamp(((x - from.x) * dx + (z - from.z) * dz)
        / Math.max(dx * dx + dz * dz, 1e-9), first, last);
      const px = from.x + dx * fraction, pz = from.z + dz * fraction;
      const distanceFromPointer = Math.hypot(x - px, z - pz);
      if (distanceFromPointer < closest.distance) {
        closest = {
          distance: distanceFromPointer,
          progress: (before + length * fraction) / lane.length,
          x: px, z: pz,
        };
      }
    }
  }
  return closest;
}

export function branchPoolProgress(fork, pool) {
  const end = pool.laneId === "lane-b" ? (fork.join ?? fork.end) : fork.end;
  return (pool.position - fork.start) / (end - fork.start);
}

export function closestPoint(path, x, z, ranges = [[0, 1]]) {
  let closest = { distance: Infinity, position: 0, x: 0, z: 0, segmentIndex: -1 };
  for (let i = path.exposedStartIndex; i < path.exposedEndIndex; i += 1) {
    const a = path.points[i], b = path.points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const start = (path.lengths[i] - path.exposedStart) / path.exposedLength;
    const end = (path.lengths[i + 1] - path.exposedStart) / path.exposedLength;
    for (const [rangeStart, rangeEnd] of ranges) {
      const low = Math.max(start, rangeStart), high = Math.min(end, rangeEnd);
      if (high < low || end - start < 1e-9) continue;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / Math.max(dx * dx + dz * dz, 1e-9),
        (low - start) / (end - start), (high - start) / (end - start));
      const px = a.x + dx * t, pz = a.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < closest.distance) {
        closest = { distance: d, position: start + (end - start) * t, x: px, z: pz, segmentIndex: i };
      }
    }
  }
  return closest;
}

// Only the ribbon that is *actually drawn* should accept a direct grab or a
// new pool. In particular, the old strip under a fork and the straight lines
// replaced by pool zigzags must not be invisible gesture targets.
function remainingRanges(start, end, gaps) {
  let ranges = [[start, end]];
  for (const [gapStart, gapEnd] of gaps) {
    ranges = ranges.flatMap(([low, high]) => {
      if (gapEnd <= low || gapStart >= high) return [[low, high]];
      return [[low, Math.min(high, gapStart)], [Math.max(low, gapEnd), high]]
        .filter(([a, b]) => b - a > 1e-6);
    });
  }
  return ranges;
}

export function closestVisibleTape(path, fork, pools, x, z) {
  const gaps = [
    ...(fork ? [[fork.start, fork.end]] : []),
    ...pools.filter(pool => !pool.laneId).map(pool => [pool.position - .015, pool.position + .015]),
  ];
  const intact = closestPoint(path, x, z, remainingRanges(0, 1, gaps));
  let nearest = { ...intact, laneId: null, progress: null };
  for (const lane of fork?.lanes ?? []) {
    const ranges = remainingRanges(.02, .98,
      lane.pools.map(pool => [pool.progress - .075, pool.progress + .075]));
    const branch = closestPointOnSplitLane(lane, x, z, ranges);
    if (branch.distance < nearest.distance) {
      nearest = {
        ...branch, laneId: lane.id,
        position: fork.start + branch.progress * (fork.end - fork.start),
        segmentIndex: -1,
      };
    }
  }
  return nearest;
}

// Additional visible tape length adds blank travel, not a pitch shift.
// Match the short-route travel near the original bench while leaving audible
// headroom for drawn mazes. A hard linear cap at ~63 desk units made further
// pulls visually dramatic but sonically inert; this curve approaches the
// worklet's 12-second buffer limit without growing that real-time allocation.
export function loopSeconds(pathLength) {
  return clamp(4.5 + 7.5 * (1 - Math.exp(-Math.max(0, pathLength - 23.5) / 38)), 4.5, 12);
}

// A pool inserts *time*, not fake extra distance in the straight ribbon.
// Scale physical travel and stored time together if the 12 s tape buffer is
// reached, so the renderer, cut transport and audio worklet agree.
export function tapeTimeline(path, pools = []) {
  const baseSeconds = loopSeconds(path.total);
  // Branch pools delay only their own read; they do not lengthen the one
  // shared recording loop or slow the other half of a fork.
  const sharedPools = pools.filter(pool => !pool.laneId);
  const nominalSeconds = baseSeconds + sharedPools.reduce((total, pool) => total + pool.seconds, 0);
  const seconds = Math.min(12, nominalSeconds);
  const scale = seconds / nominalSeconds;
  const leadSeconds = .015 * path.exposedLength / path.total * baseSeconds;
  const entries = sharedPools.map(pool => ({
    ...pool, phase: exposedFraction(path, pool.position),
    leadSeconds,
    track: poolTrack(path, pool, pool.seconds * scale),
  })).sort((a, b) => a.phase - b.phase);
  return { baseSeconds, nominalSeconds, seconds, scale, pools: entries };
}

// Each visible stretch between consecutive guides has its own length and
// effective travel time. A shared pool contributes only to its own stretch.
// The nonlinear distance mapping and the 12-second cap match the worklet;
// these are not calibrated inches-per-second measurements.
export function routeSegmentTimes(path, nodes, pools = [], timeline = tapeTimeline(path, pools)) {
  const out = nodes.findIndex(node => node.id === "cassette-out");
  const into = nodes.findIndex(node => node.id === "cassette-in");
  if (out < 0 || into <= out) throw new RangeError("Segment times need an exposed cassette route");
  const bounds = [
    { id: nodes[out].id, length: path.exposedStart },
    ...nodes.slice(out + 1, into).map((node, offset) => ({
      id: node.id, length: path.lengths[(out + offset + 1) * 6 + 3],
    })),
    { id: nodes[into].id, length: path.exposedEnd },
  ];
  let elapsed = path.exposedStart / path.total * timeline.baseSeconds * timeline.scale;
  return bounds.slice(1).map((end, index) => {
    const start = bounds[index];
    const length = end.length - start.length;
    const travelSeconds = length / path.total * timeline.baseSeconds * timeline.scale;
    const storageSeconds = timeline.pools.reduce((sum, pool) => {
      const at = pool.phase * path.total;
      return sum + (at > start.length && at <= end.length ? pool.seconds * timeline.scale : 0);
    }, 0);
    const seconds = travelSeconds + storageSeconds;
    const segment = {
      id: `${start.id}:${end.id}`, from: start.id, to: end.id,
      length, travelSeconds, storageSeconds, seconds,
      arrivalSeconds: elapsed + seconds,
      fromPosition: (start.length - path.exposedStart) / path.exposedLength,
      toPosition: (end.length - path.exposedStart) / path.exposedLength,
      position: (start.length + length / 2 - path.exposedStart) / path.exposedLength,
      point: pointAt(path, (start.length + length / 2) / path.total),
    };
    elapsed += seconds;
    return segment;
  });
}

export function tapePhaseAt(path, pools, position, timeline = tapeTimeline(path, pools)) {
  const phase = exposedFraction(path, position);
  const waiting = timeline.pools.reduce((sum, pool) => sum + (pool.phase < phase ? pool.seconds : 0), 0);
  return (phase * timeline.baseSeconds + waiting) / timeline.nominalSeconds;
}

export function headDelaySeconds(path, pools, from, to, timeline = tapeTimeline(path, pools)) {
  const start = exposedFraction(path, from), end = exposedFraction(path, to);
  const fraction = (end - start + 1) % 1;
  const waiting = timeline.pools.reduce((sum, pool) => {
    const afterStart = (pool.phase - start + 1) % 1;
    return sum + (afterStart > 1e-7 && afterStart <= fraction + 1e-7 ? pool.seconds : 0);
  }, 0);
  return (fraction * timeline.baseSeconds + waiting) * timeline.scale;
}

// The storage basin grows with *effective* audio time, including the 12 s
// ceiling. Round turns are sampled in the model so ribbon and moving markers
// travel the exact same serpentine track instead of an unrelated animation.
export function poolRadius(seconds) {
  return .37 + .23 * Math.sqrt(clamp(seconds, MIN_POOL_SECONDS, MAX_POOL_SECONDS));
}

export function poolCenter(path, pool) {
  const p = pointOnTape(path, pool.position);
  const offset = poolRadius(pool.seconds) + .28;
  const a = clampRoller(p.x - p.tz * offset, p.z + p.tx * offset);
  const b = clampRoller(p.x + p.tz * offset, p.z - p.tx * offset);
  return Math.hypot(a.x - p.x, a.z - p.z) >= Math.hypot(b.x - p.x, b.z - p.z) ? a : b;
}

export function poolTrack(path, pool, effectiveSeconds = pool.seconds) {
  const entry = pointOnTape(path, pool.position - .015);
  const exit = pointOnTape(path, pool.position + .015);
  const p = pointOnTape(path, pool.position);
  return zigzagTrack(entry, exit, p, poolCenter(path, pool), effectiveSeconds);
}

export function branchPoolTrack(path, fork, lane, pool, effectiveSeconds = pool.seconds) {
  const progress = branchPoolProgress(fork, pool);
  const p = pointOnSplitLane(lane, progress);
  const entry = pointOnSplitLane(lane, progress - .075);
  const exit = pointOnSplitLane(lane, progress + .075);
  const offset = poolRadius(effectiveSeconds) + .28;
  const a = clampRoller(p.x - p.tz * offset, p.z + p.tx * offset);
  const b = clampRoller(p.x + p.tz * offset, p.z - p.tx * offset);
  const other = fork.lanes.find(item => item.id !== lane.id);
  const otherPoint = pointOnSplitLane(other, progress);
  const intact = pointOnTape(path, pool.position);
  // Place the basin away from the other half (and from the missing intact
  // ribbon), so its branch remains legible when the direct path crosses it.
  const score = candidate => Math.min(distance(candidate, otherPoint), distance(candidate, intact));
  const center = score(a) >= score(b) ? a : b;
  return zigzagTrack(entry, exit, p, center, effectiveSeconds);
}

function zigzagTrack(entry, exit, p, center, effectiveSeconds) {
  const radius = poolRadius(effectiveSeconds);
  const side = Math.sign((center.x - p.x) * -p.tz + (center.z - p.z) * p.tx) || 1;
  const ux = p.tx, uz = p.tz, vx = -p.tz * side, vz = p.tx * side;
  const rows = 2 + Math.floor(effectiveSeconds * 2.2);
  const raw = [entry];
  for (let row = 0; row < rows; row += 1) {
    const v = (-.70 + 1.4 * row / Math.max(1, rows - 1)) * radius;
    const width = Math.sqrt(Math.max(0, radius * radius - v * v)) * .72;
    for (const u of row % 2 ? [width, -width] : [-width, width]) {
      raw.push({ x: center.x + ux * u + vx * v, z: center.z + uz * u + vz * v });
    }
  }
  raw.push(exit);
  const points = [raw[0]];
  for (let i = 1; i < raw.length - 1; i += 1) {
    const before = raw[i - 1], corner = raw[i], after = raw[i + 1];
    const inbound = distance(before, corner), outbound = distance(corner, after);
    const turn = Math.min(radius * .12, inbound * .24, outbound * .24);
    const a = { x: lerp(corner.x, before.x, turn / Math.max(inbound, 1e-9)),
      z: lerp(corner.z, before.z, turn / Math.max(inbound, 1e-9)) };
    const b = { x: lerp(corner.x, after.x, turn / Math.max(outbound, 1e-9)),
      z: lerp(corner.z, after.z, turn / Math.max(outbound, 1e-9)) };
    points.push(a);
    for (let t = 1; t <= 5; t += 1) {
      const fraction = t / 5;
      points.push({
        x: (1 - fraction) ** 2 * a.x + 2 * fraction * (1 - fraction) * corner.x + fraction ** 2 * b.x,
        z: (1 - fraction) ** 2 * a.z + 2 * fraction * (1 - fraction) * corner.z + fraction ** 2 * b.z,
      });
    }
  }
  points.push(exit);
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]));
  return { center, radius, rows, points, lengths, total: lengths.at(-1) };
}

export function pointOnPool(track, progress) {
  const target = clamp(progress, 0, 1) * track.total;
  let low = 0, high = track.lengths.length - 1;
  while (low < high - 1) {
    const middle = Math.floor((low + high) / 2);
    if (track.lengths[middle] <= target) low = middle; else high = middle;
  }
  const first = track.points[low], next = track.points[low + 1];
  const segment = Math.max(track.lengths[low + 1] - track.lengths[low], 1e-9);
  const t = (target - track.lengths[low]) / segment;
  return { x: lerp(first.x, next.x, t), z: lerp(first.z, next.z, t),
    tx: (next.x - first.x) / segment, tz: (next.z - first.z) / segment };
}

export function pointAtTapeTime(path, pools, fraction, timeline = tapeTimeline(path, pools)) {
  const time = (((fraction % 1) + 1) % 1) * timeline.nominalSeconds;
  let waiting = 0;
  for (const pool of timeline.pools) {
    const arrival = pool.phase * timeline.baseSeconds + waiting;
    if (time < arrival - pool.leadSeconds) break;
    if (time < arrival + pool.seconds + pool.leadSeconds) {
      const progress = (time - arrival + pool.leadSeconds)
        / (pool.seconds + 2 * pool.leadSeconds);
      return {
        ...pointOnPool(pool.track, progress),
        basePhase: pool.phase, poolId: pool.id,
      };
    }
    waiting += pool.seconds;
  }
  const basePhase = clamp((time - waiting) / timeline.baseSeconds, 0, 1);
  return { ...pointAt(path, basePhase), basePhase, poolId: null };
}

// The two arrivals at the common join have different timestamps. Keep those
// distinct phases visible downstream, instead of snapping both markers back
// onto the same frame as soon as their ribbons touch.
export function forkTiming(path, pools, split, timeline = tapeTimeline(path, pools)) {
  if (!split) return null;
  const fork = splitGeometry(path, split);
  const lanes = fork.lanes.map(lane => {
    const attached = pools.filter(pool => pool.laneId === lane.id)
      .sort((a, b) => a.position - b.position);
    const requested = attached.reduce((sum, pool) => sum + pool.seconds, 0);
    // A relocated branch bypasses any shared storage between blade and
    // junction. Account for it in the bounded offset heard downstream.
    const skipped = timeline.pools.reduce((sum, pool) =>
      sum + (pool.position > split.start && pool.position < lane.endPosition ? pool.seconds : 0), 0);
    const geometryDelaySeconds = clamp(lane.delaySeconds - skipped,
      -MAX_BRANCH_DELAY_SECONDS, MAX_BRANCH_DELAY_SECONDS);
    // The worklet has a fixed-size read offset. Share the remaining room
    // across this lane's pools; their visible size and moving markers use the
    // same effective seconds as the audio read after the rejoin.
    const available = Math.max(0, MAX_BRANCH_DELAY_SECONDS - geometryDelaySeconds);
    const storageScale = requested ? Math.min(1, available / requested) : 1;
    const physicalSeconds = lane.length / path.total * timeline.baseSeconds * timeline.scale;
    const storedPools = attached.map(pool => {
      const progress = branchPoolProgress(fork, pool);
      const storedSeconds = pool.seconds * storageScale * timeline.scale;
      return {
        ...pool, progress, storedSeconds, leadSeconds: physicalSeconds * .075,
        track: branchPoolTrack(path, fork, lane, pool, storedSeconds),
      };
    });
    return {
      ...lane, geometryDelaySeconds,
      delaySeconds: geometryDelaySeconds + requested * storageScale,
      physicalSeconds,
      travelSeconds: physicalSeconds + storedPools.reduce((sum, pool) => sum + pool.storedSeconds, 0),
      pools: storedPools,
    };
  });
  return {
    ...fork, lanes,
    startTime: tapePhaseAt(path, pools, split.start, timeline) * timeline.seconds,
    endTime: tapePhaseAt(path, pools, split.end, timeline) * timeline.seconds,
    joinTime: tapePhaseAt(path, pools, fork.join, timeline) * timeline.seconds,
  };
}

export function pointAtForkTime(path, pools, fork, laneIndex, fraction,
  timeline = tapeTimeline(path, pools)) {
  const base = pointAtTapeTime(path, pools, fraction, timeline);
  if (!fork) return base;
  const lane = fork.lanes[laneIndex];
  const start = fork.startTime;
  const added = lane.delaySeconds * timeline.scale;
  const elapsed = (((fraction % 1) + 1) % 1) * timeline.seconds;
  const sinceStart = (elapsed - start + timeline.seconds) % timeline.seconds;
  if (elapsed < start && start + lane.travelSeconds < timeline.seconds) return base;
  if (sinceStart < lane.travelSeconds) {
    let waiting = 0;
    for (const pool of lane.pools) {
      const arrival = pool.progress * lane.physicalSeconds + waiting;
      if (sinceStart < arrival - pool.leadSeconds) break;
      if (sinceStart < arrival + pool.storedSeconds + pool.leadSeconds) {
        return {
          ...pointOnPool(pool.track, (sinceStart - arrival + pool.leadSeconds)
            / Math.max(.001, pool.storedSeconds + 2 * pool.leadSeconds)),
          basePhase: exposedFraction(path, pool.position), poolId: pool.id,
        };
      }
      waiting += pool.storedSeconds;
    }
    const progress = clamp((sinceStart - waiting) / Math.max(.001, lane.physicalSeconds), 0, 1);
    return {
      ...pointOnSplitLane(lane, progress),
      basePhase: exposedFraction(path, fork.start + (lane.endPosition - fork.start) * progress),
      poolId: null,
    };
  }
  if (elapsed < start) return base;
  return pointAtTapeTime(path, pools, (elapsed - added) / timeline.seconds, timeline);
}
