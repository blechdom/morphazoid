import assert from "node:assert/strict";
import test from "node:test";
import {
  appendRouteTrace, BRANCH_POOL_GAP, BRANCH_POOL_MARGIN, branchPoolProgress, buildPath, CASSETTE,
  clampRoller, closestPoint, closestPointOnSplitLane, closestVisibleTape, copyHeads, copyNodes,
  exposedFraction, forkTiming, headDelaySeconds, isExposed,
  loopSeconds, makeSplit, MAX_DELAY_POOLS, MAX_GUIDE_POSTS, MAX_PLAY_HEADS, MAX_ROUTE_TRACE_POINTS,
  MAX_RECORD_HEADS, MIN_POOL_SECONDS, MIN_SPLIT_SPAN, nextPartId, pointAt,
  pointAtForkTime, pointAtTapeTime, pointOnPool, pointOnSplitLane, pointOnTape,
  poolCenter, poolRadius, razorSplitRange, ROLLER_BOUNDS, simplifyRouteTrace,
  routeSegmentTimes, splitGeometry, tapePhaseAt, tapeTimeline,
} from "../src/instruments/tapezoid/path.js";
import { ORIGINAL_TRACK_RATE, ORIGINAL_TRACK_SECONDS, renderTapezoidTrack } from "../src/instruments/tapezoid/demo-material.js";
import {
  TAPEZOID_FULL_PRESETS, TAPEZOID_MEMORY_DEFAULTS,
  captureTapezoidPreset, randomizeTapezoidPreset, validateTapezoidPreset,
} from "../src/instruments/tapezoid/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("one bounded closed route drives tape distance, duration and head positions", () => {
  const nodes = copyNodes(), path = buildPath(nodes);
  assert.ok(path.total > 25 && path.total < 50);
  assert.deepEqual(nodes.filter(node => node.kind === "anchor").map(({ x, z }) => [x, z]),
    [[-CASSETTE.portX, CASSETTE.portZ], [CASSETTE.portX, CASSETTE.portZ]]);
  assert.deepEqual(nodes.filter(node => node.kind === "internal").map(({ x, z }) => [x, z]),
    [[CASSETTE.x, CASSETTE.z]]);
  assert.ok(path.exposedLength < path.total);
  assert.equal(path.points.length, path.lengths.length);
  assert.ok(path.lengths.every((length, index) => Number.isFinite(length)
    && (index === 0 || length >= path.lengths[index - 1])));
  const start = pointAt(path, 0), end = pointAt(path, 1);
  assert.ok(Math.hypot(start.x - end.x, start.z - end.z) < 1e-8);
  assert.ok(!isExposed(path, .95)); // The closed connector is hidden inside the cassette.
  assert.ok(closestPoint(path, CASSETTE.x, CASSETTE.z).distance > 1);
  for (const fraction of [.07, .22, .39, .58, .85, .95]) {
    const position = pointOnTape(path, fraction);
    const nearest = closestPoint(path, position.x, position.z);
    assert.ok(nearest.distance < .001);
    assert.ok(Math.abs(nearest.position - fraction) < .001);
    assert.ok(isExposed(path, exposedFraction(path, fraction)));
  }
  assert.ok(pointOnTape(path, 0).x < CASSETTE.x && pointOnTape(path, 1).x > CASSETTE.x);
  assert.ok(pointOnTape(path, 0).z > CASSETTE.z && pointOnTape(path, 1).z > CASSETTE.z);
  const before = loopSeconds(path.total);
  nodes.find(node => node.id === "roller-3").x = -.1;
  assert.notEqual(loopSeconds(buildPath(nodes).total), before);
  assert.equal(copyNodes().find(node => node.id === "roller-3").x, -1.95);
  assert.deepEqual(clampRoller(-200, 100), { x: ROLLER_BOUNDS.minX, z: ROLLER_BOUNDS.maxZ });
  assert.deepEqual(clampRoller(200, -100), { x: ROLLER_BOUNDS.maxX, z: ROLLER_BOUNDS.minZ });
  assert.throws(() => buildPath([]), RangeError);
});

test("each exposed stretch reports its own effective time and its own pool storage", () => {
  const nodes = copyNodes(), path = buildPath(nodes);
  const base = routeSegmentTimes(path, nodes);
  assert.equal(base.length, nodes.filter(node => node.kind === "roller").length + 1);
  assert.ok(new Set(base.map(segment => segment.seconds.toFixed(2))).size > 3,
    "unequal guide spacing makes unequal delay");
  assert.ok(Math.abs(base.reduce((sum, segment) => sum + segment.length, 0)
    - path.exposedLength) < 1e-8);
  assert.ok(Math.abs(base.reduce((sum, segment) => sum + segment.seconds, 0)
    - path.exposedLength / path.total * loopSeconds(path.total)) < 1e-8);
  assert.ok(base.every(segment => segment.seconds > 0
    && segment.arrivalSeconds > segment.seconds && Number.isFinite(segment.point.x)));

  const position = .62;
  const pool = { id: "pool-1", position, seconds: 1.4 };
  const pooled = routeSegmentTimes(path, nodes, [pool]);
  const selected = pooled.findIndex(segment =>
    segment.fromPosition < position && segment.toPosition >= position);
  assert.ok(selected >= 0);
  assert.ok(Math.abs(pooled[selected].seconds - base[selected].seconds - pool.seconds) < 1e-9);
  assert.ok(pooled.every((segment, index) => index === selected
    || Math.abs(segment.seconds - base[index].seconds) < 1e-9));
  assert.ok(Math.abs(pooled[selected].storageSeconds - pool.seconds) < 1e-9);
  assert.ok(pooled.slice(selected).every((segment, index) =>
    segment.arrivalSeconds > base[index + selected].arrivalSeconds));

  nodes.find(node => node.id === "roller-4").z += .8;
  const stretched = routeSegmentTimes(buildPath(nodes), nodes);
  assert.ok(stretched.some((segment, index) => Math.abs(segment.length - base[index].length) > .1
    && Math.abs(segment.seconds - base[index].seconds) > .01));
  assert.deepEqual(routeSegmentTimes(path, copyNodes()), base);
});

test("a captured pull follows many turns, remains bounded, and changes tape travel before one Undo", () => {
  const nodes = copyNodes(), path = buildPath(nodes);
  const contact = pointOnTape(path, .62);
  const hit = closestVisibleTape(path, null, [], contact.x, contact.z);
  let trace = [{ x: hit.x, z: hit.z }];
  for (const [x, z] of [
    [-6.3, 3.3], [6.25, 3.25], [6.2, -1.3], [-6.2, -1.2],
    [-6.1, 2.5], [6.15, 2.45], [6.1, -.6], [-5.9, -.5],
    [-5.8, 1.6], [5.85, 1.55], [5.8, .4], [-5.6, .35],
  ]) trace = appendRouteTrace(trace, { x, z });
  const guides = simplifyRouteTrace(trace);
  assert.ok(guides.length >= 10 && guides.length <= MAX_GUIDE_POSTS);
  assert.deepEqual(guides[0], trace[0], "a turning stroke pins its tape pickup");
  assert.deepEqual(guides.at(-1), trace.at(-1), "the final guide follows the pointer");
  assert.ok(Math.min(...guides.map(point => point.x)) < -5);
  assert.ok(Math.max(...guides.map(point => point.x)) > 5);
  const insertion = Math.floor(hit.segmentIndex / 6) + 1;
  nodes.splice(insertion, 0, ...guides.map((point, index) => ({
    id: `post-${index + 1}`, kind: "roller", ...point,
  })));
  const tangled = buildPath(nodes);
  assert.ok(tangled.total > path.total + 40);
  assert.ok(loopSeconds(tangled.total) > loopSeconds(path.total) + 3);
  assert.ok(loopSeconds(tangled.total) < 12);
  assert.notEqual(headDelaySeconds(tangled, [], .19, .52),
    headDelaySeconds(path, [], .19, .52), "head delays follow the edited route");
  nodes.splice(insertion, guides.length);
  assert.ok(Math.abs(buildPath(nodes).total - path.total) < 1e-8,
    "undo removes the entire stroke, not just its last guide");

  assert.deepEqual(simplifyRouteTrace([trace[0], { x: 1, z: 0 }]), [{ x: 1, z: 0 }],
    "a straight pull only needs one added guide");
  assert.deepEqual(simplifyRouteTrace(trace, 1), [trace.at(-1)]);
  assert.deepEqual(simplifyRouteTrace(trace, 0), []);
  assert.throws(() => simplifyRouteTrace(trace, MAX_GUIDE_POSTS + 1), TypeError);
  assert.throws(() => appendRouteTrace(trace, { x: NaN, z: 0 }), TypeError);
  for (let index = 0; index < 2000; index += 1) {
    trace = appendRouteTrace(trace, { x: index % 2 ? 60 : -60, z: 3.7 });
    assert.ok(trace.length <= MAX_ROUTE_TRACE_POINTS);
  }
  assert.ok(simplifyRouteTrace(trace).length <= MAX_GUIDE_POSTS);
  assert.ok(simplifyRouteTrace(trace).every(point => point.x >= ROLLER_BOUNDS.minX
    && point.x <= ROLLER_BOUNDS.maxX));
});

test("Razor adds one separating post and rejoins before the next part without moving a head", () => {
  const nodes = copyNodes(), path = buildPath(nodes), heads = copyHeads();
  const beforePlay = razorSplitRange(path, .33, nodes, heads);
  assert.ok(beforePlay.start < .33 && beforePlay.start > .30);
  assert.ok(beforePlay.end < heads[1].position - .015);
  const first = makeSplit(path, beforePlay.start, beforePlay.end);
  const timing = forkTiming(path, [], first);
  assert.equal(first.guides[1].id, "lane-b");
  assert.ok(timing.lanes[1].delaySeconds - timing.lanes[0].delaySeconds > .05);
  const arrival = timing.endTime / tapeTimeline(path).seconds + .07;
  const firstMarker = pointAtForkTime(path, [], timing, 0, arrival);
  const lateMarker = pointAtForkTime(path, [], timing, 1, arrival);
  assert.ok(Math.hypot(firstMarker.x - lateMarker.x, firstMarker.z - lateMarker.z) > .02,
    "the arrivals must still differ *after* their routes have visibly rejoined");
  assert.equal(razorSplitRange(path, .15, nodes, heads), null, "REC has not printed yet");
  assert.equal(razorSplitRange(path, .93, nodes, heads), null, "no later PLAY can hear that fork");
  const pool = { id: "pool-1", position: .34, seconds: 2 };
  const beforePool = razorSplitRange(path, .33, nodes, heads, [pool]);
  assert.ok(beforePool === null || beforePool.end < pool.position - .015);
});

test("a continuous fork produces two routed streams with independent bounded delay", () => {
  const path = buildPath(copyNodes());
  const split = makeSplit(path, .30, .52);
  const fork = splitGeometry(path, split);
  assert.ok(Math.abs(split.end - split.start - .22) < 1e-10);
  assert.deepEqual(fork.lanes.map(lane => lane.id), ["lane-a", "lane-b"]);
  assert.ok(Math.abs(fork.lanes[0].delaySeconds - fork.lanes[1].delaySeconds) > .1);
  for (const lane of fork.lanes) {
    assert.ok(Math.abs(pointOnSplitLane(lane, 0).x - pointOnTape(path, split.start).x) < 1e-7);
    assert.ok(Math.abs(pointOnSplitLane(lane, 1).z - pointOnTape(path, split.end).z) < 1e-7);
    for (let fraction = 0; fraction <= 1; fraction += .1) {
      assert.ok(Object.values(pointOnSplitLane(lane, fraction)).every(Number.isFinite));
    }
  }
  const original = fork.lanes.map(lane => lane.delaySeconds);
  split.guides[1].x += .7;
  const changed = splitGeometry(path, split).lanes.map(lane => lane.delaySeconds);
  assert.equal(changed[0], original[0]);
  assert.notEqual(changed[1], original[1]);
  split.guides[0].x = fork.lanes[0].from.x;
  split.guides[0].z = fork.lanes[0].from.z;
  assert.ok(Object.values(pointOnSplitLane(splitGeometry(path, split).lanes[0], 0))
    .every(Number.isFinite), "a guide at the start of the fork stays numerically safe");
  assert.throws(() => makeSplit(path, .3, .3 + MIN_SPLIT_SPAN / 2), RangeError);
  assert.throws(() => makeSplit(path, .1, .99), RangeError);
});

test("Scotch can reconnect blue to a later stretch while amber retains its original join", () => {
  const path = buildPath(copyNodes());
  const split = makeSplit(path, .31, .35);
  const original = forkTiming(path, [], split);
  split.join = .44;
  split.mix = .5;
  const pool = { id: "pool-1", laneId: "lane-b",
    position: split.start + (split.join - split.start) * .4, seconds: .8 };
  const joined = forkTiming(path, [pool], split);
  assert.equal(joined.end, .35);
  assert.equal(joined.join, .44);
  assert.ok(joined.joinTime > joined.endTime);
  assert.equal(joined.lanes[0].delaySeconds, original.lanes[0].delaySeconds);
  assert.ok(joined.lanes[1].delaySeconds !== original.lanes[1].delaySeconds);
  assert.ok(Math.abs(branchPoolProgress(joined, pool) - .4) < 1e-10);
  assert.ok(Math.abs(joined.lanes[1].into.x - pointOnTape(path, split.join).x) < 1e-9);
  assert.ok(Math.abs(joined.lanes[0].into.x - pointOnTape(path, split.end).x) < 1e-9);
  const base = TAPEZOID_FULL_PRESETS[0].snapshot;
  const scene = validateTapezoidPreset({ ...base, split });
  assert.equal(scene.split.mix, .5);
  assert.equal(captureTapezoidPreset({
    nodes: copyNodes(), heads: copyHeads(), pools: [pool], patches: [],
    split, ...TAPEZOID_MEMORY_DEFAULTS,
  }).split.join, .44);
  for (const bad of [
    { ...split, join: .36 }, { ...split, join: .51 },
    { ...split, mix: -1 }, { ...split, mix: Infinity },
    { ...split, join: undefined }, { ...split, mix: undefined },
  ]) assert.throws(() => validateTapezoidPreset({ ...base, split: bad }), TypeError);
  assert.throws(() => validateTapezoidPreset({ ...scene,
    pools: [{ ...pool, position: split.end + .01, laneId: "lane-a" }] }), TypeError);
});

test("a bare ribbon is grabbable, while a fork or pool's hidden original strip is not", () => {
  const nodes = copyNodes(), path = buildPath(nodes);
  const intact = pointOnTape(path, .58);
  const hit = closestVisibleTape(path, null, [], intact.x, intact.z);
  assert.equal(hit.laneId, null);
  assert.ok(Math.abs(hit.position - .58) < .001);
  const index = Math.floor(hit.segmentIndex / 6) + 1;
  const post = { id: "post-1", kind: "roller", x: hit.x + .8, z: hit.z + .8 };
  nodes.splice(index, 0, post);
  const pulled = buildPath(nodes);
  assert.ok(pulled.total > path.total + .1, "a pulled post lengthens the actual audio loop");
  post.x = hit.x;
  post.z = hit.z;
  assert.ok(buildPath(nodes).total < pulled.total - .1, "squeezing the bend shortens it again");

  const { start, end } = razorSplitRange(path, .33, copyNodes(), copyHeads());
  const split = makeSplit(path, start, end), fork = forkTiming(path, [], split);
  for (const lane of fork.lanes) {
    const point = pointOnSplitLane(lane, .7);
    const branch = closestVisibleTape(path, fork, [], point.x, point.z);
    assert.equal(branch.laneId, lane.id);
    assert.ok(Math.abs(branch.progress - .7) < .001);
    assert.ok(closestPointOnSplitLane(lane, point.x, point.z).distance < 1e-8);
  }
  const pooled = { id: "pool-1", laneId: "lane-b",
    position: start + (end - start) * .35, seconds: 1 };
  const stored = forkTiming(path, [pooled], split);
  const hidden = pointOnSplitLane(stored.lanes[1], .35);
  const nearest = closestVisibleTape(path, stored, [pooled], hidden.x, hidden.z);
  assert.ok(nearest.laneId !== "lane-b" || Math.abs(nearest.progress - .35) > .07,
    "the bare strip replaced by a basin cannot start another edit");
  assert.equal(closestVisibleTape(path, stored, [pooled], 100, 100).distance > 100, true);
});

test("each branch pool moves with its tape and delays only its own playback read", () => {
  const path = buildPath(copyNodes());
  const { start, end } = razorSplitRange(path, .33, copyNodes(), copyHeads());
  const split = makeSplit(path, start, end);
  const before = forkTiming(path, [], split);
  const pools = [
    { id: "pool-1", laneId: "lane-a", position: start + (end - start) * .3, seconds: .8 },
    { id: "pool-2", laneId: "lane-b", position: start + (end - start) * .72, seconds: 1.6 },
  ];
  const timeline = tapeTimeline(path, pools), fork = forkTiming(path, pools, split, timeline);
  assert.equal(timeline.seconds, tapeTimeline(path).seconds, "branch storage does not lengthen the shared PCM loop");
  assert.equal(headDelaySeconds(path, pools, .19, .52), headDelaySeconds(path, [], .19, .52));
  for (const [index, lane] of fork.lanes.entries()) {
    const pool = lane.pools[0];
    assert.equal(pool.id, pools[index].id);
    assert.ok(Math.abs(pool.progress - branchPoolProgress(fork, pools[index])) < 1e-9);
    assert.ok(Math.abs(lane.delaySeconds - before.lanes[index].delaySeconds - pool.storedSeconds) < 1e-8);
    assert.ok(pool.track.radius > 0 && pool.track.rows >= 2);
    const centerTime = fork.startTime + lane.physicalSeconds * pool.progress + pool.storedSeconds * .5;
    const marker = pointAtForkTime(path, pools, fork, index, centerTime / timeline.seconds, timeline);
    assert.equal(marker.poolId, pool.id, "the audio clock also drives the stored ribbon's zigzag");
    assert.ok(Math.hypot(marker.x - pool.track.center.x, marker.z - pool.track.center.z) < pool.track.radius * 1.15);
    assert.ok(lane.delaySeconds * timeline.scale <= 3.5);
  }
  const oneChanged = [{ ...pools[0], seconds: 2 }, pools[1]];
  const expanded = forkTiming(path, oneChanged, split);
  assert.ok(expanded.lanes[0].delaySeconds > fork.lanes[0].delaySeconds + .7);
  assert.equal(expanded.lanes[1].delaySeconds, fork.lanes[1].delaySeconds);
  assert.ok(expanded.lanes[0].pools[0].track.radius > fork.lanes[0].pools[0].track.radius);
  const moved = [{ ...pools[0], position: start + (end - start) * .68 }, pools[1]];
  const shifted = forkTiming(path, moved, split);
  assert.notDeepEqual(shifted.lanes[0].pools[0].track.center, fork.lanes[0].pools[0].track.center);
  assert.equal(shifted.lanes[0].delaySeconds, fork.lanes[0].delaySeconds);
  split.guides[0].x -= .7;
  const stretched = forkTiming(path, pools, split);
  assert.notEqual(stretched.lanes[0].delaySeconds, fork.lanes[0].delaySeconds);
  assert.equal(stretched.lanes[1].delaySeconds, fork.lanes[1].delaySeconds);
  assert.ok(BRANCH_POOL_MARGIN * 2 + BRANCH_POOL_GAP < 1);
});

test("a larger zigzag storage pool takes longer to traverse and moves only downstream reads", () => {
  const path = buildPath(copyNodes());
  const pools = [{ id: "pool-1", position: .31, seconds: 1.5 }];
  const unpooled = tapeTimeline(path), timeline = tapeTimeline(path, pools);
  assert.equal(timeline.seconds, unpooled.seconds + 1.5);
  assert.equal(timeline.scale, 1);
  assert.equal(headDelaySeconds(path, pools, .19, .29), headDelaySeconds(path, [], .19, .29));
  assert.ok(Math.abs(headDelaySeconds(path, pools, .19, .37)
    - headDelaySeconds(path, [], .19, .37) - 1.5) < 1e-10);
  assert.ok(Math.abs(headDelaySeconds(path, pools, .37, .19)
    - headDelaySeconds(path, [], .37, .19)) < 1e-10,
  "the pool lies behind this PLAY head when it reads around the loop");
  const enter = tapePhaseAt(path, pools, pools[0].position);
  const inPool = pointAtTapeTime(path, pools, enter + .7 / timeline.seconds);
  assert.equal(inPool.poolId, pools[0].id);
  assert.ok(Object.values(poolCenter(path, pools[0])).every(Number.isFinite));
  assert.ok(Math.hypot(inPool.x - poolCenter(path, pools[0]).x,
    inPool.z - poolCenter(path, pools[0]).z) < poolRadius(pools[0].seconds) * 1.05);
  assert.ok(tapePhaseAt(path, pools, .36) > tapePhaseAt(path, [], .36));
  const shapes = [.15, 1, 2, 3].map(seconds =>
    tapeTimeline(path, [{ id: "pool-1", position: .31, seconds }]).pools[0].track);
  assert.ok(shapes.every((shape, index) => index === 0
    || shape.radius > shapes[index - 1].radius && shape.rows >= shapes[index - 1].rows
      && shape.total > shapes[index - 1].total));
  for (const seconds of [.15, 1, 2, 3]) {
    const pool = { id: "pool-1", position: .31, seconds };
    const clock = tapeTimeline(path, [pool]);
    const track = clock.pools[0].track;
    const start = clock.pools[0].phase * clock.baseSeconds - clock.pools[0].leadSeconds;
    const visibleTravel = seconds + 2 * clock.pools[0].leadSeconds;
    for (const fraction of [0, .17, .43, .73, 1]) {
      const p = pointAtTapeTime(path, [pool],
        (start + visibleTravel * fraction) / clock.nominalSeconds, clock);
      const q = fraction === 1 ? pointOnTape(path, pool.position + .015) : pointOnPool(track, fraction);
      assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < .02,
        "each marker visits the actual zigzag ribbon at its audio-clock time");
    }
  }
  const full = tapeTimeline(path, [
    { id: "pool-1", position: .15, seconds: 3 },
    { id: "pool-2", position: .75, seconds: 3 },
  ]);
  assert.equal(full.seconds, Math.min(12, loopSeconds(path.total) + 6));
  assert.ok(full.scale > 0 && full.scale <= 1);
  assert.ok(headDelaySeconds(path, full.pools, .1, .92) < 12);
  const sixPools = Array.from({ length: MAX_DELAY_POOLS }, (_, index) => ({
    id: `pool-${index + 1}`, position: .1 + index * .14, seconds: 3,
  }));
  const crowded = tapeTimeline(path, sixPools);
  assert.equal(crowded.seconds, 12, "additional pools share the bounded PCM loop");
  assert.ok(crowded.scale < 1);
  assert.ok(crowded.pools.every(pool => pool.track.total > 0));
  assert.ok(headDelaySeconds(path, sixPools, .1, .92, crowded) < 12);
  assert.equal(nextPartId([{ id: "post-2" }], "post", 1, MAX_GUIDE_POSTS), "post-1");
  assert.equal(nextPartId(sixPools.slice(0, 2), "pool", 1, MAX_DELAY_POOLS), "pool-3");
  assert.equal(nextPartId(sixPools, "pool", 1, MAX_DELAY_POOLS), null);
  assert.deepEqual([MAX_PLAY_HEADS, MAX_RECORD_HEADS, MIN_POOL_SECONDS], [4, 3, .15]);
});

test("the original rendered track is deterministic, bounded and sustained through its full loop", () => {
  assert.equal(ORIGINAL_TRACK_RATE, 24000);
  assert.throws(() => renderTapezoidTrack(7999), RangeError);
  const a = renderTapezoidTrack(8000), b = renderTapezoidTrack(8000);
  assert.deepEqual(a, b);
  assert.equal(a.length, ORIGINAL_TRACK_SECONDS * 8000);
  assert.ok(a.every(sample => Number.isFinite(sample) && Math.abs(sample) < 1));
  assert.ok(Math.max(...a.subarray(0, 4000)) > .1);
  assert.equal(a[0], 0);
  for (let second = 0; second < ORIGINAL_TRACK_SECONDS; second++) {
    const window = a.subarray(second * 8000, (second + 1) * 8000);
    const rms = Math.sqrt(window.reduce((sum, sample) => sum + sample ** 2, 0) / window.length);
    assert.ok(rms > .035, `second ${second}: recorded music must not contain blank travel`);
  }
});

test("twenty complete scenes include phase studies, freeform mazes, forks and head echo", () => {
  validateFullPresetBank(TAPEZOID_FULL_PRESETS);
  assert.equal(TAPEZOID_FULL_PRESETS.length, 20);
  assert.deepEqual(TAPEZOID_MEMORY_DEFAULTS, {
    feedback: .45, phaseSlip: 0, printing: true,
    echoReturn: 0, returnHead: "play-1", monitorMix: .75, voices: 1,
  });
  const feedbackSettings = new Set(), slipSettings = new Set(), printSettings = new Set();
  const returnSettings = new Set(), returnHeads = new Set(), monitorSettings = new Set(), voiceCounts = new Set();
  const splitStates = new Set(), poolStates = new Set(), extraHeadStates = new Set(), postStates = new Set();
  for (const preset of TAPEZOID_FULL_PRESETS) {
    assert.equal(validateTapezoidPreset(preset.snapshot), preset.snapshot);
    const original = copyNodes();
    const state = {
      nodes: [original[0], ...preset.snapshot.rollers.map(roller => ({ ...roller, kind: "roller" })),
        ...original.slice(-2)],
      heads: preset.snapshot.heads.map(head => ({ ...head })),
      pools: preset.snapshot.pools.map(pool => ({ ...pool })),
      patches: preset.snapshot.patches,
      cut: preset.snapshot.cut, split: preset.snapshot.split,
      speed: -4, phase: .8, outputLevel: .35, audioOn: true,
      feedback: preset.snapshot.feedback, phaseSlip: preset.snapshot.phaseSlip,
      printing: preset.snapshot.printing,
      echoReturn: preset.snapshot.echoReturn, returnHead: preset.snapshot.returnHead,
      monitorMix: preset.snapshot.monitorMix, voices: preset.snapshot.voices,
    };
    feedbackSettings.add(state.feedback);
    slipSettings.add(state.phaseSlip);
    printSettings.add(state.printing);
    returnSettings.add(state.echoReturn);
    returnHeads.add(state.returnHead);
    monitorSettings.add(state.monitorMix);
    voiceCounts.add(state.voices);
    splitStates.add(state.split !== null);
    poolStates.add(state.pools.length);
    extraHeadStates.add(state.heads.length);
    postStates.add(state.nodes.length);
    const path = buildPath(state.nodes);
    for (const position of [...state.heads.map(head => head.position), ...state.pools.map(pool => pool.position),
      ...state.patches, ...(state.cut === null ? [] : [state.cut])]) {
      const physical = pointOnTape(path, position);
      assert.ok(isExposed(path, exposedFraction(path, position)));
      assert.ok(closestPoint(path, physical.x, physical.z).distance < .001);
    }
    assert.deepEqual(captureTapezoidPreset(state), preset.snapshot);
    if (state.split) {
      const copied = captureTapezoidPreset(state);
      copied.split.guides[0].x = 0;
      assert.notEqual(copied.split.guides[0].x, state.split.guides[0].x);
      const fork = splitGeometry(path, state.split);
      assert.ok(fork.lanes.every(lane => Number.isFinite(lane.delaySeconds)));
      assert.notEqual(fork.lanes[0].delaySeconds, fork.lanes[1].delaySeconds);
      assert.ok(state.heads.filter(head => head.kind === "play").every(head => head.position > state.split.end));
    }
    assert.deepEqual(Object.keys(captureTapezoidPreset(state)).sort(),
      ["cut", "echoReturn", "feedback", "heads", "monitorMix", "patches",
        "phaseSlip", "pools", "printing", "returnHead", "rollers", "split", "voices"]);
  }
  assert.ok(feedbackSettings.size > 7);
  assert.ok(slipSettings.size > 7);
  assert.deepEqual([...printSettings].sort(), [false, true]);
  assert.ok(returnSettings.size > 5);
  assert.deepEqual([...returnHeads].sort(), ["play-1", "play-2", "play-3"]);
  assert.ok(monitorSettings.size > 5);
  assert.deepEqual([...voiceCounts].sort((a, b) => a - b), [1, 2, 4, 8]);
  assert.deepEqual([...splitStates].sort(), [false, true]);
  assert.deepEqual([...poolStates].sort(), [0, 1]);
  assert.deepEqual([...extraHeadStates].sort((a, b) => a - b), [3, 4, 5]);
  assert.deepEqual([...postStates].sort((a, b) => a - b), [9, 10, 15, 21]);
  for (const [index, voices] of [[15, 2], [16, 4], [17, 8]]) {
    const study = TAPEZOID_FULL_PRESETS[index];
    assert.match(study.label, /^Phase ·/);
    assert.equal(study.snapshot.voices, voices);
    assert.equal(study.snapshot.echoReturn, 0, "phasing is not head-to-REC feedback");
  }
  assert.ok(TAPEZOID_FULL_PRESETS[18].snapshot.rollers.length > 12);
  assert.ok(TAPEZOID_FULL_PRESETS[18].snapshot.echoReturn > .5);
  assert.equal(TAPEZOID_FULL_PRESETS[18].snapshot.voices, 1);
  assert.equal(TAPEZOID_FULL_PRESETS[19].snapshot.pools[0].laneId, "lane-b");
  const original = TAPEZOID_FULL_PRESETS[0].snapshot;
  const sixPools = Array.from({ length: MAX_DELAY_POOLS }, (_, index) => ({
    id: `pool-${index + 1}`, position: .1 + index * .14, seconds: 1,
  }));
  assert.equal(validateTapezoidPreset({ ...original, pools: sixPools }).pools.length, MAX_DELAY_POOLS);
  assert.throws(() => validateTapezoidPreset({ ...original, pools: [
    ...sixPools, { id: `pool-${MAX_DELAY_POOLS + 1}`, position: .96, seconds: 1 },
  ] }), TypeError);
  const forked = TAPEZOID_FULL_PRESETS[12].snapshot;
  assert.deepEqual(forked.pools.map(pool => pool.laneId), ["lane-b"],
    "a factory scene should demonstrate storage on a split half");
  assert.deepEqual(captureTapezoidPreset({
    ...{ nodes: copyNodes(), heads: copyHeads(), pools: forked.pools,
      patches: forked.patches, split: forked.split },
    feedback: forked.feedback, phaseSlip: forked.phaseSlip,
    printing: forked.printing, echoReturn: forked.echoReturn,
    returnHead: forked.returnHead, monitorMix: forked.monitorMix, voices: forked.voices,
  }).pools, forked.pools);
  const { split: omitted, pools: oldPools, ...legacy } = {
    ...original, heads: original.heads.map(head => head.position),
  };
  assert.equal(omitted, null);
  assert.deepEqual(oldPools, []);
  assert.deepEqual(validateTapezoidPreset(legacy), original);
  assert.deepEqual(validateTapezoidPreset({ ...legacy, split: null }), original);
  assert.deepEqual(validateTapezoidPreset({ ...original, cut: .46 }), {
    ...original, cut: null, patches: [.46],
  }, "legacy open-cut scenes become intact, patched tape on recall");
  for (const bad of [
    { ...original, rollers: original.rollers.slice(1) },
    { ...original, rollers: original.rollers.map((item, index) => index ? item : { ...item, x: NaN }) },
    { ...original, heads: [{ ...original.heads[0], position: 0 }, ...original.heads.slice(1)] },
    { ...original, heads: [{ ...original.heads[0], position: .02 }, ...original.heads.slice(1)] },
    { ...original, heads: original.heads.filter(head => head.kind !== "record") },
    { ...original, heads: original.heads.filter(head => head.kind !== "play") },
    { ...original, heads: [...original.heads, { ...original.heads[1] }] },
    { ...original, heads: [...original.heads, { id: "play-5", kind: "play", position: .4 }] },
    { ...original, rollers: [...original.rollers, { id: `post-${MAX_GUIDE_POSTS + 1}`, x: 1, z: 0 }] },
    { ...original, pools: [{ id: "pool-1", position: .4, seconds: .1 }] },
    { ...original, pools: [{ id: "pool-1", position: .4, seconds: 4 }] },
    { ...original, pools: [{ id: "pool-1", laneId: "lane-a", position: .4, seconds: 1 }] },
    { ...original, pools: [{ id: "pool-1", laneId: "other", position: .4, seconds: 1 }] },
    { ...original, pools: [{ id: "pool-1", position: .4, seconds: 1 },
      { id: "pool-1", position: .7, seconds: 2 }] },
    { ...original, patches: Array(9).fill(.2) },
    { ...original, patches: [.98] },
    { ...original, cut: 1 },
    { ...original, feedback: .89 },
    { ...original, phaseSlip: -1 },
    { ...original, printing: "true" },
    { ...original, echoReturn: .81 },
    { ...original, returnHead: "cassette" },
    { ...original, monitorMix: Infinity },
    { ...original, voices: 3 },
    { ...original, extra: true },
    { ...original, split: undefined },
    { ...forked, cut: .44 },
    { ...forked, split: { ...forked.split, end: forked.split.start + MIN_SPLIT_SPAN / 2 } },
    { ...forked, split: { ...forked.split, guides: [forked.split.guides[0]] } },
    { ...forked, split: { ...forked.split, guides: [
      forked.split.guides[0], { ...forked.split.guides[1], x: Infinity },
    ] } },
    { ...forked, heads: [{ ...forked.heads[0], position: forked.split.start }, ...forked.heads.slice(1)] },
    { ...forked, heads: [forked.heads[0],
      { ...forked.heads[1], position: forked.split.start + .05 }, forked.heads[2]] },
    { ...forked, pools: [{ id: "pool-1", position: forked.split.start + .05, seconds: 1 }] },
    { ...forked, pools: [{ ...forked.pools[0], position: forked.split.start }] },
    { ...forked, pools: [{ ...forked.pools[0], laneId: null }] },
    { ...forked, pools: [{ ...forked.pools[0], seconds: 4 }] },
    { ...forked, pools: [forked.pools[0], { ...forked.pools[0], id: "pool-2",
      position: forked.pools[0].position + BRANCH_POOL_GAP * (forked.split.end - forked.split.start) / 2 }] },
  ]) assert.throws(() => validateTapezoidPreset(bad), TypeError);
  const legacySharedPool = { ...original, pools: [{ id: "pool-1", position: .64, seconds: 1.4 }] };
  assert.equal(validateTapezoidPreset(legacySharedPool), legacySharedPool,
    "older three-field pool scenes need no migration or optional lane field");
});

test("seeded dice varies every roller/head and optional joins without changing live state", () => {
  const original = TAPEZOID_FULL_PRESETS[0].snapshot, before = structuredClone(original);
  assert.deepEqual(randomizeTapezoidPreset(original, seed(5)),
    randomizeTapezoidPreset(TAPEZOID_FULL_PRESETS[7].snapshot, seed(5)));
  assert.deepEqual(original, before);
  const known = new Set(TAPEZOID_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(53), rollerValues = Array.from({ length: 6 }, () => ({ x: new Set(), z: new Set() }));
  const headValues = Array.from({ length: 3 }, () => new Set());
  const patchCounts = new Set(), cutStates = new Set(), splitStates = new Set();
  const feedbackValues = new Set(), phaseValues = new Set(), printStates = new Set();
  const returnValues = new Set(), returnHeads = new Set(), monitorValues = new Set(), voiceCounts = new Set();
  const postCounts = new Set(), poolCounts = new Set(), extraRecords = new Set(), extraPlays = new Set();
  const poolDurations = new Set(), poolLanes = new Set();
  const junctionMixes = new Set();
  for (let index = 0; index < 240; index += 1) {
    const scene = randomizeTapezoidPreset(original, random);
    validateTapezoidPreset(scene);
    assert.ok(scene.rollers.every(roller => roller.z <= 3.8),
      "dice stays in the default camera framing; hand-drawn tape can reach farther");
    assert.ok(!scene.split || scene.split.guides[1].z <= 3.8);
    assert.ok(!known.has(presetStateKey(scene)));
    scene.rollers.filter(roller => roller.id.startsWith("roller-")).forEach((roller, id) => {
      rollerValues[id].x.add(roller.x); rollerValues[id].z.add(roller.z);
    });
    scene.heads.filter(head => ["record", "play-1", "play-2"].includes(head.id))
      .forEach(head => headValues[["record", "play-1", "play-2"].indexOf(head.id)].add(head.position));
    postCounts.add(scene.rollers.length - 6);
    poolCounts.add(scene.pools.length);
    scene.pools.forEach(pool => {
      poolDurations.add(pool.seconds);
      poolLanes.add(pool.laneId ?? "shared");
    });
    extraRecords.add(scene.heads.filter(head => head.kind === "record").length - 1);
    extraPlays.add(scene.heads.filter(head => head.kind === "play").length - 2);
    patchCounts.add(scene.patches.length); cutStates.add(scene.cut === null);
    splitStates.add(scene.split !== null);
    if (scene.split) {
      if (scene.split.join !== undefined) junctionMixes.add(scene.split.mix);
      assert.equal(scene.cut, null);
      assert.ok(scene.heads.filter(head => head.kind === "record")
        .every(head => head.position < scene.split.start));
      assert.ok(scene.heads.filter(head => head.kind === "play")
        .every(head => head.position < scene.split.start || head.position > scene.split.end));
      assert.ok(scene.pools.every(pool => pool.laneId
        ? pool.position > scene.split.start
          && pool.position < (pool.laneId === "lane-b" ? (scene.split.join ?? scene.split.end) : scene.split.end)
        : pool.position < scene.split.start || pool.position > scene.split.end));
    }
    feedbackValues.add(scene.feedback); phaseValues.add(scene.phaseSlip);
    printStates.add(scene.printing);
    returnValues.add(scene.echoReturn); returnHeads.add(scene.returnHead);
    monitorValues.add(scene.monitorMix); voiceCounts.add(scene.voices);
  }
  for (const pair of rollerValues) {
    assert.ok(pair.x.size > 30);
    assert.ok(pair.z.size > 30);
  }
  for (const values of headValues) assert.ok(values.size > 25);
  assert.deepEqual([...cutStates], [true]);
  assert.deepEqual([...splitStates].sort(), [false, true]);
  assert.ok(junctionMixes.size > 5, "dice explores independently mixed Scotch junctions");
  assert.deepEqual([...patchCounts].sort(), [0, 1, 2]);
  assert.ok(feedbackValues.size > 40);
  assert.ok(phaseValues.size > 25);
  assert.deepEqual([...printStates].sort(), [false, true]);
  assert.ok(returnValues.size > 40);
  assert.deepEqual([...returnHeads].sort(), ["play-1", "play-2", "play-3", "play-4"]);
  assert.ok(monitorValues.size > 40);
  assert.deepEqual([...voiceCounts].sort((a, b) => a - b), [1, 2, 4, 8]);
  assert.ok(postCounts.has(0) && postCounts.has(MAX_GUIDE_POSTS));
  assert.ok(postCounts.size >= 15);
  assert.deepEqual([...poolCounts].sort((a, b) => a - b),
    Array.from({ length: MAX_DELAY_POOLS + 1 }, (_, index) => index));
  assert.deepEqual([...extraRecords].sort((a, b) => a - b), [0, 1, 2]);
  assert.deepEqual([...extraPlays].sort((a, b) => a - b), [0, 1, 2]);
  assert.ok(poolDurations.size > 25);
  assert.deepEqual([...poolLanes].sort(), ["lane-a", "lane-b", "shared"]);
  assert.throws(() => randomizeTapezoidPreset(original, () => Infinity), TypeError);
});
