import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  ANIMALS,
  CALL_GESTURES,
  animalState,
  interpolateGesture,
} from "../src/syrinx.js";
import {
  HYBRINX_TIMELINE_LANES,
  buildHybrinxTimelineModel,
  resolveHybrinxPlayhead,
} from "../src/hybrinx-timeline.js";

const root = new URL("../", import.meta.url);
const EXPECTED_LANES = Object.freeze([
  "pressure",
  "tension",
  "adduction",
  "mouthOpening",
  "cavityCoupling",
  "roughness",
  "asymmetry",
  "sourceBalance",
]);

function stateForGesture(gestureId, overrides = {}) {
  const animal = Object.values(ANIMALS).find(({ callIds }) => callIds.includes(gestureId));
  assert.ok(animal, `${gestureId} must belong to an animal`);
  return animalState(animal.id, {
    biologicalLock: false,
    callId: gestureId,
    ...overrides,
  });
}

function laneFor(model, parameter) {
  const lane = model.lanes.find((candidate) => candidate.parameter === parameter);
  assert.ok(lane, `${model.id} must expose its ${parameter} lane`);
  return lane;
}

function assertClose(actual, expected, message, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test("Hybrinx defines the eight native call-automation lanes in stable display order", () => {
  assert.deepEqual(
    HYBRINX_TIMELINE_LANES.map(({ parameter }) => parameter),
    EXPECTED_LANES,
  );
  assert.equal(new Set(EXPECTED_LANES).size, EXPECTED_LANES.length);
  assert.equal(HYBRINX_TIMELINE_LANES[0].composition, "multiply");
  assert.equal(
    HYBRINX_TIMELINE_LANES.slice(1).every(({ composition }) => composition === "add"),
    true,
  );
});

test("every animal call resolves its authored keyframes through the playback interpolator", () => {
  for (const gesture of Object.values(CALL_GESTURES)) {
    const baseState = stateForGesture(gesture.id);
    const model = buildHybrinxTimelineModel(gesture, baseState, {
      gestureRate: 1,
      loop: false,
      sampleCount: 48,
    });

    assert.equal(model.id, gesture.id);
    assert.equal(model.label, gesture.label);
    assert.equal(model.callDurationMs, gesture.durationMs);
    assert.equal(model.gapDurationMs, 0);
    assert.equal(model.cycleDurationMs, gesture.durationMs);
    assert.equal(model.callFraction, 1);
    assert.deepEqual(model.lanes.map(({ parameter }) => parameter), EXPECTED_LANES);
    assert.equal(
      model.keyframeCount,
      Object.values(gesture.curves).reduce((total, points) => total + points.length, 0),
    );

    for (const lane of model.lanes) {
      const authoredPoints = gesture.curves[lane.parameter];
      assert.equal(lane.samples.length, 49);
      assert.equal(lane.keyframes.length, authoredPoints.length);

      lane.samples.forEach((sample, index) => {
        assert.equal(sample.phase, index / 48);
        assert.equal(sample.time, sample.phase);
        assert.ok(Number.isFinite(sample.value));
        assert.ok(sample.value >= 0 && sample.value <= 1);
        assertClose(
          sample.value,
          interpolateGesture(gesture, sample.phase, baseState)[lane.parameter],
          `${gesture.id}.${lane.parameter} sample ${index} must match playback`,
        );
      });

      lane.keyframes.forEach((keyframe, index) => {
        const [phase, rawValue] = authoredPoints[index];
        assert.equal(keyframe.phase, phase);
        assert.equal(keyframe.time, phase);
        assert.equal(keyframe.rawValue, rawValue);
        assertClose(
          keyframe.value,
          interpolateGesture(gesture, phase, baseState)[lane.parameter],
          `${gesture.id}.${lane.parameter} key ${index} must match playback`,
        );
      });
    }
  }
});

test("the graphic preserves the real repeated pressure rhythm in giggles and trills", () => {
  const cases = [
    { id: "hyena-giggle", keyframes: 22, peaks: 7 },
    { id: "treefrog-trill", keyframes: 37, peaks: 12 },
  ];

  for (const expected of cases) {
    const gesture = CALL_GESTURES[expected.id];
    const model = buildHybrinxTimelineModel(gesture, stateForGesture(expected.id));
    const pressure = laneFor(model, "pressure");
    assert.equal(pressure.keyframes.length, expected.keyframes);
    assert.equal(
      pressure.keyframes.filter(({ rawValue }) => rawValue === 1).length,
      expected.peaks,
    );
    assert.deepEqual(
      pressure.keyframes.map(({ phase }) => phase),
      gesture.curves.pressure.map(([phase]) => phase),
      `${expected.id} must retain every authored rhythmic onset and release`,
    );
  }
});

test("pressure keys multiply the host baseline while tension keys add to it", () => {
  const gesture = CALL_GESTURES["raven-croak"];
  const baseState = stateForGesture(gesture.id, { pressure: 0.4, tension: 0.3 });
  const model = buildHybrinxTimelineModel(gesture, baseState);
  const pressureKey = laneFor(model, "pressure").keyframes.find(({ phase }) => phase === 0.34);
  const tensionKey = laneFor(model, "tension").keyframes.find(({ phase }) => phase === 0.3);

  assert.ok(pressureKey);
  assert.ok(tensionKey);
  assert.equal(pressureKey.rawValue, 1);
  assertClose(pressureKey.value, 0.4, "pressure peak must multiply its 0.4 baseline by 1");
  assert.equal(tensionKey.rawValue, 0.08);
  assertClose(tensionKey.value, 0.38, "tension key must add 0.08 to its 0.3 baseline");
});

test("loop rests and playhead positions remain finite and bounded", () => {
  const gesture = CALL_GESTURES["hyena-giggle"];
  const baseState = stateForGesture(gesture.id, {
    loop: true,
    gestureRate: 2,
    loopGapMs: 1_000,
  });
  const model = buildHybrinxTimelineModel(gesture, baseState, {
    loop: true,
    gestureRate: 2,
    loopGapMs: 1_000,
  });

  assert.equal(model.callDurationMs, gesture.durationMs / 2);
  assert.equal(model.gapDurationMs, 1_000);
  assert.equal(model.cycleDurationMs, gesture.durationMs / 2 + 1_000);
  assert.ok(model.callFraction >= 0.58 && model.callFraction <= 0.88);

  const callMiddle = resolveHybrinxPlayhead(model, { playing: true, phase: 0.5 });
  const restStart = resolveHybrinxPlayhead(model, {
    playing: true,
    phase: 1,
    gapRemainingMs: model.gapDurationMs,
  });
  const restMiddle = resolveHybrinxPlayhead(model, {
    playing: true,
    phase: 1,
    gapRemainingMs: model.gapDurationMs / 2,
  });
  const restEnd = resolveHybrinxPlayhead(model, {
    playing: true,
    phase: 1,
    gapRemainingMs: Number.EPSILON,
  });

  assert.equal(resolveHybrinxPlayhead(model, { playing: false, phase: 0.8 }), 0);
  assertClose(callMiddle, model.callFraction * 0.5, "call playhead must follow gesture phase");
  assertClose(restStart, model.callFraction, "rest must begin at the call boundary");
  assert.ok(restMiddle > restStart && restMiddle < 1);
  assert.ok(restEnd > restMiddle && restEnd <= 1);

  for (const position of [
    callMiddle,
    restStart,
    restMiddle,
    restEnd,
    resolveHybrinxPlayhead(model, { playing: true, phase: Number.NaN }),
    resolveHybrinxPlayhead(model, { playing: true, phase: Number.POSITIVE_INFINITY }),
    resolveHybrinxPlayhead(model, { playing: true, phase: -1e9 }),
  ]) {
    assert.ok(Number.isFinite(position));
    assert.ok(position >= 0 && position <= 1);
  }
});

test("Hybrinx is a Tongued Beasts-derived page with its timeline below the viewport", async () => {
  const [html, css, app, navigation, build, catalogue, iconBytes, iconStat] = await Promise.all([
    readFile(new URL("hybrinx.html", root), "utf8"),
    readFile(new URL("hybrinx.css", root), "utf8"),
    readFile(new URL("syrinx-app.js", root), "utf8"),
    readFile(new URL("nav.js", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
    readFile(new URL("src/instrument-catalog.js", root), "utf8"),
    readFile(new URL("assets/instruments/hybrinx.webp", root)),
    stat(new URL("assets/instruments/hybrinx.webp", root)),
  ]);

  assert.match(html, /<title>[^<]*Hybrinx[^<]*Morphazoid[^<]*<\/title>/i);
  assert.match(
    html,
    /<body[^>]*class="[^"]*syrinx-ui-page[^"]*tongued-beasts-page[^"]*hybrinx-page[^"]*"/,
  );
  assert.match(html, /href="tongued-beasts\.css\?v=[^"]+"/);
  assert.match(html, /href="hybrinx\.css\?v=[^"]+"/);
  assert.match(html, /src="syrinx-app\.js\?v=[^"]+"/);

  const stage = html.match(/<section class="stage syrinx-stage"[\s\S]*?<\/section>/)?.[0] ?? "";
  const viewportIndex = stage.indexOf('id="stageWrap"');
  const timelineIndex = stage.indexOf('id="hybrinxTimelineSection"');
  assert.ok(viewportIndex >= 0, "Hybrinx must retain the interactive animal viewport");
  assert.ok(timelineIndex > viewportIndex, "the animation timeline must follow the viewport in normal flow");
  const timelineTag = stage.match(/<section\b[^>]*id="hybrinxTimelineSection"[^>]*>/i)?.[0] ?? "";
  const svgTag = stage.match(/<svg\b[^>]*id="hybrinxTimelineSvg"[^>]*>/i)?.[0] ?? "";
  assert.match(timelineTag, /class="[^"]*hybrinx-timeline[^"]*"/);
  assert.match(timelineTag, /(?:aria-label|aria-labelledby)=/);
  assert.match(svgTag, /role="img"/);
  for (const id of [
    "hybrinxTimelineCall",
    "hybrinxTimelineDuration",
    "hybrinxTimelineKeyframes",
    "hybrinxTimelinePhase",
    "hybrinxTimelineDescription",
  ]) {
    assert.match(stage, new RegExp(`id="${id}"`), `${id} must be available to the renderer`);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Hybrinx element ids must be unique");

  for (const selector of [
    "hybrinx-timeline",
    "hybrinx-timeline-svg",
    "hybrinx-timeline-curve",
    "hybrinx-timeline-keyframe",
    "hybrinx-timeline-playhead",
    "hybrinx-timeline-rest",
  ]) {
    assert.match(css, new RegExp(`\\.${selector}\\b`), `Hybrinx CSS must style .${selector}`);
  }
  assert.match(css, /@media\s*\([^)]*(?:orientation:\s*landscape|max-height)[^)]*\)/i);

  assert.match(app, /import\s*\{\s*createHybrinxTimeline\s*\}\s*from\s*["']\.\/src\/hybrinx-timeline\.js\?v=[^"']+["']/);
  assert.match(app, /const\s+HYBRINX_MODE\s*=\s*document\.body\.classList\.contains\(["']hybrinx-page["']\)/);
  assert.match(app, /createHybrinxTimeline\(\$\(["']hybrinxTimelineSection["']\)\)/);
  assert.match(app, /function\s+updateHybrinxTimeline\s*\(/);
  assert.match(app, /hybrinxTimeline\.update\(\{[\s\S]*gesture:\s*activeGesture\(\)[\s\S]*performanceState[\s\S]*phase:\s*gesturePhase[\s\S]*playing:\s*gesturePlaying/);
  assert.match(app, /function\s+animate\s*\([^)]*\)\s*\{[\s\S]*updatePerformance\([^)]*\);[\s\S]*updateHybrinxTimeline\(\);/);

  assert.match(navigation, /id:\s*["']hybrinx["'][\s\S]{0,180}label:\s*["']Hybrinx["'][\s\S]{0,180}href:\s*["']hybrinx\.html["']/);
  assert.match(catalogue, /(?:hybrinx|["']hybrinx["'])\s*:\s*define\s*\(/);
  for (const runtimeFile of [
    "hybrinx.html",
    "hybrinx.css",
    "src/hybrinx-timeline.js",
    "assets/instruments/hybrinx.webp",
  ]) {
    assert.match(
      build,
      new RegExp(runtimeFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${runtimeFile} must enter release builds before its first commit`,
    );
  }
  assert.ok(iconStat.size > 1_000);
  assert.equal(iconBytes.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(iconBytes.subarray(8, 12).toString("ascii"), "WEBP");
});
