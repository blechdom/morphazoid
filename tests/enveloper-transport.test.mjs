import assert from "node:assert/strict";
import test from "node:test";

import {
  ENVELOPER_AUDIO_TIMING,
  enveloperEventAtScore,
  enveloperOccurrenceAtOrdinal,
  enveloperScoreAtAudioTime,
  planEnveloperAudioWindow,
} from "../src/enveloper-transport.js";
import {
  createEnveloperState,
  deriveEnveloperTimeline,
} from "../src/enveloper.js";

const closeTo = (actual, expected, epsilon = 1e-10) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

const EVENTS = Object.freeze([
  Object.freeze({ id: "short", startSeconds: 0, endSeconds: 0.1, durationSeconds: 0.1 }),
  Object.freeze({ id: "long", startSeconds: 0.1, endSeconds: 0.45, durationSeconds: 0.35 }),
  Object.freeze({ id: "middle", startSeconds: 0.45, endSeconds: 0.7, durationSeconds: 0.25 }),
  Object.freeze({ id: "tail", startSeconds: 0.7, endSeconds: 1, durationSeconds: 0.3 }),
]);

test("Enveloper audio timing uses a wider lookahead than its scheduler interval", () => {
  assert.equal(ENVELOPER_AUDIO_TIMING.schedulerIntervalMilliseconds, 25);
  assert.equal(ENVELOPER_AUDIO_TIMING.schedulerIntervalSeconds, 0.025);
  assert.equal(ENVELOPER_AUDIO_TIMING.lookaheadSeconds, 0.16);
  assert.equal(ENVELOPER_AUDIO_TIMING.minimumLeadSeconds, 0.025);
  assert.equal(ENVELOPER_AUDIO_TIMING.startLeadSeconds, 0.06);
  assert.ok(ENVELOPER_AUDIO_TIMING.maxEvents > EVENTS.length);
  assert.ok(
    ENVELOPER_AUDIO_TIMING.lookaheadSeconds
      > ENVELOPER_AUDIO_TIMING.schedulerIntervalSeconds,
  );
  assert.equal(Object.isFrozen(ENVELOPER_AUDIO_TIMING), true);
});

test("audio-score mapping and current variable-duration fragments are exact", () => {
  closeTo(enveloperScoreAtAudioTime({
    scoreAnchorSeconds: 12.25,
    audioAnchorTime: 100,
    audioTime: 100.75,
  }), 13);
  closeTo(enveloperScoreAtAudioTime({
    scoreAnchorSeconds: 12.25,
    audioAnchorTime: 100,
    audioTime: 99,
  }), 11.25);
  assert.equal(enveloperScoreAtAudioTime({
    scoreAnchorSeconds: 0,
    audioAnchorTime: 2,
    audioTime: 1,
  }), 0, "a future start anchor cannot rewind before score zero");

  const current = enveloperEventAtScore({
    events: EVENTS,
    cycleSeconds: 1,
    scoreSeconds: 12.275,
  });
  assert.equal(current.event.id, "long");
  assert.equal(current.index, 1);
  assert.equal(current.cycle, 12);
  assert.equal(current.ordinal, 49);
  closeTo(current.startSeconds, 12.1);
  closeTo(current.endSeconds, 12.45);
  closeTo(current.progress, 0.5);
  assert.equal(current.nextEventOrdinal, 50);

  const exactBoundary = enveloperEventAtScore({
    events: EVENTS,
    cycleSeconds: 1,
    scoreSeconds: 12.45,
  });
  assert.equal(exactBoundary.event.id, "middle");
  assert.equal(exactBoundary.progress, 0);

  const cycleBoundary = enveloperEventAtScore({
    events: EVENTS,
    cycleSeconds: 1,
    scoreSeconds: 13,
  });
  assert.equal(cycleBoundary.event.id, "short");
  assert.equal(cycleBoundary.cycle, 13);
  assert.equal(cycleBoundary.ordinal, 52);

  const roundedCycleBoundary = enveloperEventAtScore({
    events: EVENTS,
    cycleSeconds: 1,
    scoreSeconds: 12.9999999999995,
  });
  assert.equal(roundedCycleBoundary.event.id, "short");
  assert.equal(roundedCycleBoundary.cycle, 13);
  assert.equal(roundedCycleBoundary.ordinal, 52);
  assert.equal(roundedCycleBoundary.progress, 0);
});

test("lookahead planner preserves unequal durations and exact absolute audio times", () => {
  const plan = planEnveloperAudioWindow({
    events: EVENTS,
    cycleSeconds: 1,
    nextEventOrdinal: 0,
    scoreAnchorSeconds: 0,
    audioAnchorTime: 5.06,
    nowAudioTime: 5,
    lookaheadSeconds: 0.8,
    minimumLeadSeconds: 0.025,
  });

  assert.deepEqual(plan.entries.map(({ event }) => event.id), [
    "short", "long", "middle", "tail",
  ]);
  assert.deepEqual(plan.entries.map(({ ordinal }) => ordinal), [0, 1, 2, 3]);
  for (const [index, expected] of [
    [0, [5.06, 5.16, 0.1]],
    [1, [5.16, 5.51, 0.35]],
    [2, [5.51, 5.76, 0.25]],
    [3, [5.76, 6.06, 0.3]],
  ]) {
    closeTo(plan.entries[index].startAt, expected[0]);
    closeTo(plan.entries[index].endAt, expected[1]);
    closeTo(plan.entries[index].durationSeconds, expected[2]);
  }
  assert.equal(plan.nextEventOrdinal, 4);
  assert.equal(plan.skippedCount, 0);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.entries), true);
  assert.ok(plan.entries.every(Object.isFrozen));
});

test("overlapping planning windows advance one cursor without duplicates", () => {
  const first = planEnveloperAudioWindow({
    events: EVENTS,
    cycleSeconds: 1,
    nextEventOrdinal: 0,
    audioAnchorTime: 5.06,
    nowAudioTime: 5,
    lookaheadSeconds: 0.3,
  });
  assert.deepEqual(first.entries.map(({ ordinal }) => ordinal), [0, 1]);

  const overlap = planEnveloperAudioWindow({
    events: EVENTS,
    cycleSeconds: 1,
    nextEventOrdinal: first.nextEventOrdinal,
    audioAnchorTime: 5.06,
    nowAudioTime: 5.08,
    lookaheadSeconds: 0.3,
  });
  assert.deepEqual(overlap.entries, []);
  assert.equal(overlap.nextEventOrdinal, 2);

  const later = planEnveloperAudioWindow({
    events: EVENTS,
    cycleSeconds: 1,
    nextEventOrdinal: overlap.nextEventOrdinal,
    audioAnchorTime: 5.06,
    nowAudioTime: 5.35,
    lookaheadSeconds: 0.3,
  });
  assert.deepEqual(later.entries.map(({ ordinal }) => ordinal), [2]);
  assert.equal(new Set([
    ...first.entries,
    ...overlap.entries,
    ...later.entries,
  ].map(({ ordinal }) => ordinal)).size, 3);
});

test("planning crosses the last-to-first cycle boundary by integer ordinal", () => {
  const plan = planEnveloperAudioWindow({
    events: EVENTS,
    cycleSeconds: 1,
    nextEventOrdinal: 3,
    audioAnchorTime: 10,
    nowAudioTime: 10.65,
    lookaheadSeconds: 0.6,
    minimumLeadSeconds: 0,
  });

  assert.deepEqual(plan.entries.map(({ event }) => event.id), ["tail", "short", "long"]);
  assert.deepEqual(plan.entries.map(({ ordinal }) => ordinal), [3, 4, 5]);
  assert.deepEqual(plan.entries.map(({ cycle }) => cycle), [0, 1, 1]);
  closeTo(plan.entries[0].startAt, 10.7);
  closeTo(plan.entries[1].startAt, 11);
  closeTo(plan.entries[2].startAt, 11.1);
});

test("the real unequal nine-leaf tree remains ordered and unique through overlapping windows", () => {
  const tree = createEnveloperState();
  tree.cycleSeconds = 4;
  tree.root.nodes.forEach((node, index) => {
    node.time = [0, 0.18, 0.62, 1][index];
  });
  const branchTimes = [
    [0, 0.12, 0.47, 1],
    [0, 0.3, 0.83, 1],
    [0, 0.21, 0.68, 1],
  ];
  tree.branches.forEach((branch, branchIndex) => {
    branch.nodes.forEach((node, nodeIndex) => {
      node.time = branchTimes[branchIndex][nodeIndex];
    });
  });
  const events = deriveEnveloperTimeline(tree);
  assert.equal(events.length, 9);
  assert.equal(new Set(events.map(({ durationSeconds }) => durationSeconds)).size, 9);

  const audioAnchorTime = 10 + ENVELOPER_AUDIO_TIMING.startLeadSeconds;
  let nextEventOrdinal = 0;
  let skippedCount = 0;
  let largestWindow = 0;
  const scheduled = [];

  // A 160 ms horizon overlaps each 25 ms wake by 135 ms. Stop after the
  // following cycle's first leaf enters the horizon but before its second.
  for (let tick = 0; tick <= 157; tick += 1) {
    const plan = planEnveloperAudioWindow({
      events,
      cycleSeconds: tree.cycleSeconds,
      nextEventOrdinal,
      scoreAnchorSeconds: 0,
      audioAnchorTime,
      nowAudioTime: 10 + tick * ENVELOPER_AUDIO_TIMING.schedulerIntervalSeconds,
    });
    nextEventOrdinal = plan.nextEventOrdinal;
    skippedCount += plan.skippedCount;
    largestWindow = Math.max(largestWindow, plan.entries.length);
    scheduled.push(...plan.entries);
  }

  assert.equal(skippedCount, 0);
  assert.deepEqual(scheduled.map(({ ordinal }) => ordinal), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(scheduled.map(({ event }) => event.id), [
    ...events.map(({ id }) => id),
    events[0].id,
  ]);
  assert.equal(new Set(scheduled.map(({ ordinal }) => ordinal)).size, scheduled.length);
  assert.ok(largestWindow <= ENVELOPER_AUDIO_TIMING.maxEvents);
  assert.ok(scheduled.every((entry, index) => (
    index === 0 || entry.startAt > scheduled[index - 1].startAt
  )));

  for (let index = 0; index < events.length; index += 1) {
    closeTo(scheduled[index].startAt, audioAnchorTime + events[index].startSeconds);
  }
  closeTo(scheduled[9].startAt, audioAnchorTime + tree.cycleSeconds);
});

test("late windows skip stale attacks instead of bursting backlog at now", () => {
  const plan = planEnveloperAudioWindow({
    events: EVENTS,
    cycleSeconds: 1,
    nextEventOrdinal: 0,
    audioAnchorTime: 10,
    nowAudioTime: 10.52,
    lookaheadSeconds: 0.3,
    minimumLeadSeconds: 0.025,
  });

  assert.equal(plan.skippedCount, 3);
  assert.deepEqual(plan.entries.map(({ ordinal }) => ordinal), [3]);
  assert.ok(plan.entries.every(({ startAt }) => startAt >= 10.545));
  closeTo(plan.entries[0].startAt, 10.7);
  assert.equal(plan.nextEventOrdinal, 4);
});

test("event caps bound dense windows while preserving a resumable ordinal", () => {
  const first = planEnveloperAudioWindow({
    events: EVENTS,
    cycleSeconds: 1,
    nextEventOrdinal: 0,
    audioAnchorTime: 1,
    nowAudioTime: 0.9,
    lookaheadSeconds: 10,
    minimumLeadSeconds: 0,
    maxEvents: 2,
  });
  assert.deepEqual(first.entries.map(({ ordinal }) => ordinal), [0, 1]);
  assert.equal(first.nextEventOrdinal, 2);

  const bounded = planEnveloperAudioWindow({
    events: EVENTS,
    cycleSeconds: 1,
    nextEventOrdinal: 0,
    audioAnchorTime: 1,
    nowAudioTime: 0.9,
    lookaheadSeconds: 100,
    minimumLeadSeconds: 0,
    maxEvents: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(bounded.entries.length, ENVELOPER_AUDIO_TIMING.maxEvents);
  assert.equal(bounded.nextEventOrdinal, ENVELOPER_AUDIO_TIMING.maxEvents);
});

test("large ordinals derive cycle times directly without accumulated drift", () => {
  const baseOrdinal = EVENTS.length * 1_000_000 + 2;
  const occurrence = enveloperOccurrenceAtOrdinal({
    events: EVENTS,
    cycleSeconds: 1,
    ordinal: baseOrdinal,
    scoreAnchorSeconds: 12.25,
    audioAnchorTime: 100,
  });
  assert.equal(occurrence.index, 2);
  assert.equal(occurrence.cycle, 1_000_000);
  closeTo(occurrence.startSeconds, 1_000_000.45);
  closeTo(occurrence.startAt, 1_000_088.2);

  for (let offset = 0; offset < 1_000; offset += 1) {
    const ordinal = baseOrdinal + offset;
    const exact = enveloperOccurrenceAtOrdinal({
      events: EVENTS,
      cycleSeconds: 1,
      ordinal,
      scoreAnchorSeconds: 12.25,
      audioAnchorTime: 100,
    });
    const cycle = Math.floor(ordinal / EVENTS.length);
    const index = ordinal % EVENTS.length;
    const expectedScore = cycle + EVENTS[index].startSeconds;
    closeTo(exact.startSeconds, expectedScore);
    closeTo(exact.startAt, 100 + expectedScore - 12.25);
  }

  const nextCycle = enveloperOccurrenceAtOrdinal({
    events: EVENTS,
    cycleSeconds: 1,
    ordinal: baseOrdinal + EVENTS.length,
    scoreAnchorSeconds: 12.25,
    audioAnchorTime: 100,
  });
  closeTo(nextCycle.startAt - occurrence.startAt, 1);
});

test("malformed timelines and unsafe options fail closed", () => {
  assert.equal(enveloperEventAtScore({ events: [], cycleSeconds: 1 }), null);
  assert.equal(enveloperOccurrenceAtOrdinal({
    events: [{ startSeconds: 0.5, endSeconds: 0.25 }],
    cycleSeconds: 1,
  }), null);
  const invalid = planEnveloperAudioWindow({
    events: [{ startSeconds: 0.5, endSeconds: 0.25 }],
    cycleSeconds: Number.NaN,
    nextEventOrdinal: -20,
  });
  assert.deepEqual(invalid.entries, []);
  assert.equal(invalid.nextEventOrdinal, 0);
  assert.equal(invalid.skippedCount, 0);
  assert.equal(Object.isFrozen(invalid), true);
});
