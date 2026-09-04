import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  ANIMALS,
  CALL_GESTURES,
  animalState,
  interpolateGesture,
  resolveGestureTimeline,
} from "../src/syrinx.js";
import {
  HYBRINX_TIMELINE_LANES,
  buildHybrinxTimelineModel,
  createHybrinxGestureStore,
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

function standaloneFunctionBody(source, name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `Missing ${name}()`);
  const parametersStart = source.indexOf("(", match.index);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  const bodyStart = source.indexOf("{", parametersEnd);
  assert.ok(bodyStart >= 0, `Missing body for ${name}()`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`Unterminated ${name}()`);
}

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
      assert.ok(lane.samples.length >= 49);
      assert.equal(lane.keyframes.length, authoredPoints.length);

      lane.samples.forEach((sample, index) => {
        if (index > 0) assert.ok(sample.phase > lane.samples[index - 1].phase);
        assert.equal(sample.time, sample.phase);
        assert.ok(Number.isFinite(sample.value));
        assert.ok(sample.value >= 0 && sample.value <= 1);
        assertClose(
          sample.value,
          interpolateGesture(gesture, sample.phase, baseState)[lane.parameter],
          `${gesture.id}.${lane.parameter} sample ${index} must match playback`,
        );
      });
      for (const [phase] of authoredPoints) {
        assert.equal(
          lane.samples.some((sample) => sample.phase === phase),
          true,
          `${gesture.id}.${lane.parameter} path must pass through keyframe ${phase}`,
        );
      }

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

test("Hybrinx edits deep working copies while preserving immutable native calls", () => {
  const gestureId = "raven-croak";
  const native = CALL_GESTURES[gestureId];
  const nativeSnapshot = JSON.stringify(native);
  const store = createHybrinxGestureStore(CALL_GESTURES);
  const initial = store.get(gestureId);

  assert.notStrictEqual(initial, native, "the editor must never hand its native definition to mutation code");
  assert.notStrictEqual(initial.curves, native.curves);
  for (const parameter of Object.keys(native.curves)) {
    assert.notStrictEqual(initial.curves[parameter], native.curves[parameter]);
    initial.curves[parameter].forEach((point, index) => {
      assert.notStrictEqual(point, native.curves[parameter][index]);
    });
  }

  store.updateKeyframe(gestureId, "pressure", 2, { phase: 0.41, rawValue: 0.37 });
  const edited = store.get(gestureId);
  assert.equal(store.isEdited(gestureId), true);
  assert.deepEqual(edited.curves.pressure[2], [0.41, 0.37]);
  assert.ok(
    Number.isFinite(edited.revision) && edited.revision > (initial.revision ?? 0),
    "same-call edits need a newer revision so the SVG rebuilds",
  );
  assert.equal(JSON.stringify(native), nativeSnapshot, "editing must not mutate CALL_GESTURES");
  assert.deepEqual(native.curves.pressure[2], [0.34, 1]);

  const baseState = stateForGesture(gestureId, { pressure: 0.6 });
  assertClose(
    interpolateGesture(edited, 0.41, baseState).pressure,
    0.6 * 0.37,
    "the audio interpolator must consume the edited pressure point",
  );
  const model = buildHybrinxTimelineModel(edited, baseState);
  assert.equal(laneFor(model, "pressure").keyframes[2].phase, 0.41);
  assert.equal(laneFor(model, "pressure").keyframes[2].rawValue, 0.37);
});

test("keyframe updates preserve omitted coordinates and clamp phase, order, and lane values", () => {
  const gestureId = "raven-croak";
  const store = createHybrinxGestureStore(CALL_GESTURES);

  store.updateKeyframe(gestureId, "pressure", 2, { rawValue: 0.52 });
  assert.deepEqual(
    store.get(gestureId).curves.pressure[2],
    [0.34, 0.52],
    "vertical-only drags must not move a key in time",
  );
  store.updateKeyframe(gestureId, "pressure", 2, { phase: 0.6 });
  assert.deepEqual(
    store.get(gestureId).curves.pressure[2],
    [0.6, 0.52],
    "horizontal-only drags must retain the key value",
  );

  store.updateKeyframe(gestureId, "pressure", 2, { phase: -50, rawValue: 50 });
  store.updateKeyframe(gestureId, "tension", 1, { phase: 50, rawValue: -50 });
  store.updateKeyframe(gestureId, "pressure", 0, { phase: 0.4 });
  store.updateKeyframe(gestureId, "pressure", 4, { phase: 0.6 });
  const edited = store.get(gestureId);
  const pressurePoints = edited.curves.pressure;
  const tensionPoints = edited.curves.tension;

  for (const points of [pressurePoints, tensionPoints]) {
    assert.equal(points.every(([phase]) => phase >= 0 && phase <= 1), true);
    for (let index = 1; index < points.length; index += 1) {
      assert.ok(
        points[index][0] > points[index - 1][0],
        "keyframe phases must stay strictly ordered for stable interpolation",
      );
    }
  }
  assert.equal(pressurePoints[2][1], 1, "multiplicative pressure keys clamp to 0…1");
  assert.equal(tensionPoints[1][1], -1, "additive keys clamp to −1…1");
  assert.equal(pressurePoints[0][0], 0, "the call's opening endpoint stays anchored");
  assert.equal(pressurePoints.at(-1)[0], 1, "the call's closing endpoint stays anchored");
});

test("resolved-value keyframe edits invert multiply and add composition for playback", () => {
  const gestureId = "raven-croak";
  const store = createHybrinxGestureStore(CALL_GESTURES);
  const baseState = stateForGesture(gestureId, { pressure: 0.6, tension: 0.3 });

  store.updateKeyframe(gestureId, "pressure", 2, { value: 0.3 }, baseState);
  store.updateKeyframe(gestureId, "tension", 1, { value: 0.65 }, baseState);
  const edited = store.get(gestureId);
  assertClose(edited.curves.pressure[2][1], 0.5, "pressure display value must invert its baseline multiplier");
  assertClose(edited.curves.tension[1][1], 0.35, "tension display value must invert its baseline offset");
  assertClose(interpolateGesture(edited, edited.curves.pressure[2][0], baseState).pressure, 0.3, "edited pressure must reach the dragged value");
  assertClose(interpolateGesture(edited, edited.curves.tension[1][0], baseState).tension, 0.65, "edited tension must reach the dragged value");
});

test("Hybrinx can add and remove interior keys without losing contour endpoints", () => {
  const gestureId = "raven-croak";
  const store = createHybrinxGestureStore(CALL_GESTURES);
  const initialCount = store.get(gestureId).curves.pressure.length;

  store.addKeyframe(gestureId, "pressure", { phase: 0.5, rawValue: 0.44 });
  let points = store.get(gestureId).curves.pressure;
  assert.equal(points.length, initialCount + 1);
  const insertedIndex = points.findIndex(([phase, rawValue]) => phase === 0.5 && rawValue === 0.44);
  assert.ok(insertedIndex > 0 && insertedIndex < points.length - 1);

  store.removeKeyframe(gestureId, "pressure", insertedIndex);
  points = store.get(gestureId).curves.pressure;
  assert.equal(points.length, initialCount);
  assert.equal(points.some(([phase, rawValue]) => phase === 0.5 && rawValue === 0.44), false);

  store.removeKeyframe(gestureId, "pressure", 0);
  store.removeKeyframe(gestureId, "pressure", store.get(gestureId).curves.pressure.length - 1);
  points = store.get(gestureId).curves.pressure;
  assert.equal(points.length, initialCount, "endpoint deletion attempts are safe no-ops");
  assert.equal(points[0][0], 0);
  assert.equal(points.at(-1)[0], 1);
});

test("duration edits elongate both the contour model and the audio transport", () => {
  const gestureId = "raven-croak";
  const native = CALL_GESTURES[gestureId];
  const store = createHybrinxGestureStore(CALL_GESTURES);
  store.setDuration(gestureId, native.durationMs * 2);
  const elongated = store.get(gestureId);
  const nativeModel = buildHybrinxTimelineModel(native, stateForGesture(gestureId));
  const elongatedModel = buildHybrinxTimelineModel(elongated, stateForGesture(gestureId));

  assert.equal(elongated.durationMs, native.durationMs * 2);
  assert.equal(native.durationMs, 720, "the authored call duration must remain unchanged");
  assert.equal(elongatedModel.callDurationMs, 1_440);
  assert.ok(
    elongatedModel.callPlotWidth > nativeModel.callPlotWidth
      && elongatedModel.viewBoxWidth > nativeModel.viewBoxWidth,
    "stretching time must visibly elongate the horizontally scrollable contour",
  );
  assert.deepEqual(
    resolveGestureTimeline(900, elongated.durationMs, false),
    { active: true, complete: false, phase: 0.625, remainingGapMs: 0 },
    "elongation must change playback timing, not only the drawn axis",
  );
  assert.equal(resolveGestureTimeline(900, native.durationMs, false).complete, true);

  store.setDuration(gestureId, -1_000);
  assert.equal(store.get(gestureId).durationMs, 80, "duration has a usable lower bound");
  store.setDuration(gestureId, 1_000_000);
  assert.equal(store.get(gestureId).durationMs, 30_000, "duration has a finite 30 second elongation bound");
});

test("call edits persist across switches and reset at current-call or whole-store scope", () => {
  const ravenId = "raven-croak";
  const hyenaId = "hyena-giggle";
  const store = createHybrinxGestureStore(CALL_GESTURES);

  store.updateKeyframe(ravenId, "pressure", 2, { rawValue: 0.23 });
  store.setDuration(ravenId, 2_400);
  store.updateKeyframe(hyenaId, "roughness", 1, { rawValue: 0.61 });
  assert.equal(store.get(hyenaId).curves.roughness[1][1], 0.61);
  assert.equal(store.get(ravenId).curves.pressure[2][1], 0.23);
  assert.equal(store.get(ravenId).durationMs, 2_400);
  assert.equal(store.isEdited(ravenId), true);
  assert.equal(store.isEdited(hyenaId), true);

  store.reset(ravenId);
  assert.equal(store.isEdited(ravenId), false);
  assert.equal(store.get(ravenId).durationMs, CALL_GESTURES[ravenId].durationMs);
  assert.deepEqual(store.get(ravenId).curves, CALL_GESTURES[ravenId].curves);
  assert.equal(store.isEdited(hyenaId), true, "reset current call must retain edits to other calls");
  assert.equal(store.get(hyenaId).curves.roughness[1][1], 0.61);

  store.resetAll();
  assert.equal(store.isEdited(hyenaId), false);
  assert.deepEqual(store.get(hyenaId).curves, CALL_GESTURES[hyenaId].curves);
});

test("Hybrinx viewport, full, and timeline resets cancel automatic tongue motion", async () => {
  const [html, app, timelineSource] = await Promise.all([
    readFile(new URL("hybrinx.html", root), "utf8"),
    readFile(new URL("syrinx-app.js", root), "utf8"),
    readFile(new URL("src/hybrinx-timeline.js", root), "utf8"),
  ]);
  const viewportResetButton = html.match(/<button\b[^>]*id="resetViewportTongue"[^>]*>[\s\S]*?<\/button>/i)?.[0] ?? "";
  const fullResetButton = html.match(/<button\b[^>]*data-reset-all[^>]*>[\s\S]*?<\/button>/i)?.[0] ?? "";
  const timelineResetButton = html.match(/<button\b[^>]*id="hybrinxTimelineReset"[^>]*>[\s\S]*?<\/button>/i)?.[0] ?? "";
  const listeners = standaloneFunctionBody(app, "installControlListeners");
  const resetTongue = standaloneFunctionBody(app, "resetTonguePerformance");
  const timelineEdit = standaloneFunctionBody(app, "handleHybrinxTimelineEdit");
  const stopTongueAnimation = standaloneFunctionBody(app, "stopTongueAnimationForReset");

  assert.match(viewportResetButton, /reset[\s\S]{0,80}tongue|tongue[\s\S]{0,80}reset/i);
  assert.match(
    resetTongue,
    /stopTongueAnimationForReset\(\)/,
    "Hybrinx's viewport Reset Tongue cancels an active tongue preset",
  );
  assert.match(fullResetButton, />\s*Reset Hybrinx\s*</i, "Hybrinx exposes its full reset");
  assert.match(timelineResetButton, />\s*Reset Call\s*</i, "Hybrinx exposes its call reset");
  assert.match(
    listeners,
    /querySelector\(\s*["']\[data-reset-all\]["']\s*\)\?*\.addEventListener\(\s*["']click["'][\s\S]{0,500}?stopTongueAnimationForReset\(\)/,
    "Reset Hybrinx stops an active tongue preset",
  );
  assert.match(
    timelineSource,
    /resetButton\?*\.addEventListener\(\s*["']click["']\s*,\s*\(\)\s*=>\s*emitEdit\(\s*\{\s*type:\s*["']reset["']\s*\}\s*\)\s*\)/,
    "Reset Call emits the timeline reset action",
  );
  assert.match(
    timelineEdit,
    /action\.type\s*===\s*["']reset["'][\s\S]{0,180}?hybrinxGestureStore\.reset\(gestureId\)[\s\S]{0,100}?stopTongueAnimationForReset\(\)/,
    "Reset Call restores the contour and stops an active tongue preset",
  );
  assert.match(
    stopTongueAnimation,
    /setTongueMotion\(\s*["']{2}\s*,\s*\{[^}]*announceChange:\s*false[^}]*startAudio:\s*false[^}]*\}\s*\)/,
    "reset cancellation returns to free-hand tongue motion without starting audio",
  );
});

test("Hybrinx is a Tongued Beasts-derived page with its timeline below the viewport", async () => {
  const [html, css, app, layout, timelineSource, navigation, build, catalogue, iconBytes, iconStat] = await Promise.all([
    readFile(new URL("hybrinx.html", root), "utf8"),
    readFile(new URL("hybrinx.css", root), "utf8"),
    readFile(new URL("syrinx-app.js", root), "utf8"),
    readFile(new URL("src/hybrinx-layout.js", root), "utf8"),
    readFile(new URL("src/hybrinx-timeline.js", root), "utf8"),
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
  assert.match(html, /href="hybrinx\.css\?v=hybrinx-[^"]+"/);
  assert.match(html, /src="syrinx-app\.js\?v=[^"]+"/);

  const stage = html.match(/<section class="stage syrinx-stage"[\s\S]*?<\/section>/)?.[0] ?? "";
  const viewportIndex = stage.indexOf('id="stageWrap"');
  const splitterIndex = stage.indexOf('id="hybrinxSplitter"');
  const timelineIndex = stage.indexOf('id="hybrinxTimelineSection"');
  assert.ok(viewportIndex >= 0, "Hybrinx must retain the interactive animal viewport");
  assert.ok(
    splitterIndex > viewportIndex && timelineIndex > splitterIndex,
    "the draggable divider must sit between viewport and timeline in normal flow",
  );
  const splitterTag = stage.match(/<[^>]+\bid="hybrinxSplitter"[^>]*>/i)?.[0] ?? "";
  assert.match(splitterTag, /class="[^"]*hybrinx-splitter[^"]*"/);
  assert.match(splitterTag, /role="separator"/);
  assert.match(splitterTag, /tabindex="0"/);
  assert.match(splitterTag, /aria-orientation="horizontal"/);
  assert.match(splitterTag, /aria-controls="[^"]*stageWrap[^"]*hybrinxTimelineSection[^"]*"/);
  for (const attribute of ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"]) {
    assert.match(splitterTag, new RegExp(`${attribute}="[^"]+"`));
  }
  const timelineTag = stage.match(/<section\b[^>]*id="hybrinxTimelineSection"[^>]*>/i)?.[0] ?? "";
  const svgTag = stage.match(/<svg\b[^>]*id="hybrinxTimelineSvg"[^>]*>/i)?.[0] ?? "";
  assert.match(timelineTag, /class="[^"]*hybrinx-timeline[^"]*"/);
  assert.match(timelineTag, /(?:aria-label|aria-labelledby)=/);
  assert.match(svgTag, /role="group"/, "interactive timeline descendants must not live inside role=img");
  for (const id of [
    "hybrinxTimelineCall",
    "hybrinxTimelineDuration",
    "hybrinxTimelineKeyframes",
    "hybrinxTimelinePhase",
    "hybrinxTimelineEditStatus",
    "hybrinxTimelineDescription",
  ]) {
    assert.match(stage, new RegExp(`id="${id}"`), `${id} must be available to the renderer`);
  }
  const durationInputTag = stage.match(/<input\b[^>]*id="hybrinxTimelineDurationInput"[^>]*>/i)?.[0] ?? "";
  const resetButtonTag = stage.match(/<button\b[^>]*id="hybrinxTimelineReset"[^>]*>/i)?.[0] ?? "";
  assert.match(durationInputTag, /type="(?:number|range)"/);
  assert.match(durationInputTag, /min="80"/);
  assert.match(durationInputTag, /max="30000"/);
  assert.match(resetButtonTag, /type="button"/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Hybrinx element ids must be unique");

  for (const selector of [
    "hybrinx-timeline",
    "hybrinx-timeline-svg",
    "hybrinx-timeline-curve",
    "hybrinx-timeline-keyframe",
    "hybrinx-timeline-playhead",
    "hybrinx-timeline-rest",
    "hybrinx-splitter",
  ]) {
    assert.match(css, new RegExp(`\\.${selector}\\b`), `Hybrinx CSS must style .${selector}`);
  }
  assert.match(css, /@media\s*\([^)]*(?:orientation:\s*landscape|max-height)[^)]*\)/i);
  assert.match(
    css,
    /\.hybrinx-timeline-scroll\s*\{[^}]*overflow:\s*auto[^}]*overscroll-behavior-x:\s*contain[^}]*overscroll-behavior-y:\s*auto[^}]*touch-action:\s*pan-x pan-y[^}]*-webkit-overflow-scrolling:\s*touch/s,
    "the timeline must retain horizontal gestures without trapping vertical page swipes",
  );

  const mobileCss = css.match(
    /@media \(max-width:\s*980px\)\s*\{[\s\S]*?(?=@media \(max-width:\s*650px\))/,
  )?.[0] ?? "";
  assert.match(
    mobileCss,
    /html\s*\{[^}]*height:\s*auto[^}]*min-height:\s*100%[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s,
    "compact screens must give vertical scrolling back to the document root",
  );
  assert.match(
    mobileCss,
    /\.hybrinx-page\s*\{[^}]*--hybrinx-min-viewport:\s*180px[^}]*--hybrinx-min-timeline:\s*190px[^}]*height:\s*auto[^}]*min-height:\s*100dvh[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto[^}]*overscroll-behavior-y:\s*auto[^}]*-webkit-overflow-scrolling:\s*touch/s,
    "portrait phones need a natural page scroller and a usable timeline viewport",
  );
  assert.match(
    mobileCss,
    /\.hybrinx-page \.shell\s*\{[^}]*display:\s*block[^}]*height:\s*auto[^}]*min-height:\s*calc\(100dvh - 58px\)[^}]*overflow:\s*visible/s,
  );
  assert.match(
    mobileCss,
    /\.hybrinx-page \.syrinx-stage\s*\{[^}]*position:\s*relative[^}]*height:\s*clamp\(540px, 78dvh, 700px\)[^}]*min-height:\s*540px/s,
  );
  assert.match(mobileCss, /\.hybrinx-page #stage\s*\{[^}]*touch-action:\s*pan-y/s);
  assert.match(
    mobileCss,
    /\.hybrinx-page \.panel\s*\{[^}]*overflow:\s*visible[^}]*overscroll-behavior-y:\s*auto/s,
    "the controls panel must contribute to document height instead of becoming a trapped scroller",
  );

  const landscapeCss = css.match(
    /@media \(orientation:\s*landscape\) and \(max-width:\s*980px\) and \(max-height:\s*650px\)\s*\{[\s\S]*?(?=@media \(prefers-reduced-motion:)/,
  )?.[0] ?? "";
  assert.match(
    landscapeCss,
    /\.hybrinx-page\s*\{[^}]*--hybrinx-min-viewport:\s*150px[^}]*--hybrinx-min-timeline:\s*160px/s,
    "short landscape phones need enough room for both viewport and timeline",
  );
  assert.match(
    landscapeCss,
    /\.hybrinx-page \.shell\s*\{[^}]*display:\s*grid[^}]*height:\s*auto[^}]*min-height:\s*calc\(100dvh - 50px\)[^}]*overflow:\s*visible[^}]*grid-template-columns:[^;}]+;[^}]*grid-template-rows:\s*auto[^}]*align-items:\s*start/s,
  );
  assert.match(
    landscapeCss,
    /\.hybrinx-page \.syrinx-stage\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*height:\s*max\(420px, calc\(100dvh - 50px\)\)[^}]*min-height:\s*420px/s,
  );

  assert.match(app, /import\s*\{\s*createHybrinxTimeline\s*\}\s*from\s*["']\.\/src\/hybrinx-timeline\.js\?v=[^"']+["']/);
  assert.match(app, /const\s+HYBRINX_MODE\s*=\s*document\.body\.classList\.contains\(["']hybrinx-page["']\)/);
  assert.match(app, /createHybrinxTimeline\(\$\(["']hybrinxTimelineSection["']\)\)/);
  assert.match(app, /function\s+updateHybrinxTimeline\s*\(/);
  assert.match(app, /hybrinxTimeline\.update\(\{[\s\S]*gesture:\s*activeGesture\(\)[\s\S]*performanceState[\s\S]*phase:\s*gesturePhase[\s\S]*playing:\s*gesturePlaying/);
  assert.match(app, /function\s+animate\s*\([^)]*\)\s*\{[\s\S]*updatePerformance\([^)]*\);[\s\S]*updateHybrinxTimeline\(\);/);
  assert.match(app, /createHybrinxGestureStore\s*\(\s*CALL_GESTURES\s*\)/);
  assert.match(app, /HYBRINX_MODE[\s\S]{0,260}hybrinxGestureStore[\s\S]{0,180}\.get\(state\.callId\)/);

  for (const attribute of [
    "data-parameter",
    "data-index",
    "tabindex",
    "role",
    "aria-valuemin",
    "aria-valuemax",
    "aria-valuenow",
  ]) {
    assert.match(
      app + layout + timelineSource,
      new RegExp(`(?:["']${attribute}["']|\\b${attribute}\\s*:)`),
      `editable keyframes must expose ${attribute}`,
    );
  }
  assert.match(timelineSource, /addEventListener\(["']pointerdown["']/);
  assert.match(timelineSource, /addEventListener\(["']pointermove["']/);
  assert.match(timelineSource, /setPointerCapture/);
  assert.match(timelineSource, /addEventListener\(["']keydown["']/);
  assert.match(timelineSource, /["'](?:Delete|Backspace)["']/);
  assert.match(
    css,
    /\.hybrinx-timeline-keyframe(?:-hit)?\b[\s\S]{0,500}pointer-events:\s*(?:all|auto)/,
    "keyframe hit targets must opt back into pointer interaction",
  );

  assert.match(html, /<script\b[^>]*type="module"[^>]*src="src\/hybrinx-layout\.js\?v=[^"]+"[^>]*><\/script>/i);
  assert.match(layout, /export\s+function\s+createHybrinxSplitPane\s*\(/);
  assert.match(layout, /setPointerCapture/);
  assert.match(layout, /addEventListener\(["']pointermove["']/);
  assert.match(layout, /addEventListener\(["']keydown["']/);
  for (const key of ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]) {
    assert.match(layout, new RegExp(`["']${key}["']`), `splitter must support ${key}`);
  }
  assert.match(layout, /addEventListener\(["']dblclick["']/);

  assert.doesNotMatch(html, /id="viewportModulationLayer"/);
  assert.doesNotMatch(html, /id="resetViewportModulators"/);

  assert.match(navigation, /id:\s*["']hybrinx["'][\s\S]{0,180}label:\s*["']Hybrinx["'][\s\S]{0,180}href:\s*["']hybrinx\.html["']/);
  assert.match(catalogue, /(?:hybrinx|["']hybrinx["'])\s*:\s*define\s*\(/);
  for (const runtimeFile of [
    "hybrinx.html",
    "hybrinx.css",
    "src/hybrinx-layout.js",
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
