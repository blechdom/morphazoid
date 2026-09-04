import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ANIMALS,
  CALL_GESTURES,
  CONTROL_LIMITS,
  animalState,
  interpolateGesture,
} from "../src/syrinx.js";
import { DEFAULT_TONGUE_STATE } from "../src/tongue-physics.js";
import * as hybrinx from "../src/hybrinx-timeline.js";

const root = new URL("../", import.meta.url);

const NATIVE_PARAMETERS = Object.freeze([
  "pressure",
  "tension",
  "adduction",
  "mouthOpening",
  "cavityCoupling",
  "roughness",
  "asymmetry",
  "sourceBalance",
]);

const ADDABLE_PARAMETERS = Object.freeze([
  "sourceScale",
  "tractLengthM",
  "tonguePosition",
  "tongueHeight",
  "tongueShape",
  "tongueTip",
  "tongueExtension",
  "tongueCurl",
  "tongueLateral",
]);

function requiredExport(name, type = "function") {
  const value = hybrinx[name];
  assert.equal(typeof value, type, `src/hybrinx-timeline.js must export ${name}`);
  return value;
}

function catalogEntries() {
  const catalog = hybrinx.HYBRINX_TIMELINE_PARAMETER_CATALOG;
  assert.ok(catalog, "Hybrinx must export its addable timeline parameter catalog");
  return Array.isArray(catalog) ? catalog : Object.values(catalog);
}

function catalogParameter(entry) {
  return String(entry?.parameter ?? entry?.id ?? entry?.key ?? "");
}

function standaloneFunctionBody(source, name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `Missing ${name}()`);
  const bodyStart = source.indexOf("{", source.indexOf(")", match.index));
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`Unterminated ${name}()`);
}

function resetStoredTongueAutomation(store, gestureId) {
  if (typeof store.resetParameterFamily === "function") {
    return store.resetParameterFamily(gestureId, "tongue");
  }
  if (typeof store.clearTongueAutomation === "function") {
    return store.clearTongueAutomation(gestureId);
  }
  assert.fail(
    "Hybrinx gesture stores need resetParameterFamily(id, 'tongue') or clearTongueAutomation(id)",
  );
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

function modulationPoints(gesture, parameter, contour) {
  const modulation = gesture?.modulations?.[parameter];
  assert.ok(modulation, `${parameter} must own a modulation document`);
  const points = modulation[contour];
  assert.ok(Array.isArray(points), `${parameter} ${contour} must be an editable contour`);
  assert.ok(points.length >= 2, `${parameter} ${contour} must retain its endpoints`);
  return points;
}

function assertOrderedFinitePoints(points, [minimum, maximum], label) {
  points.forEach(([phase, value], index) => {
    assert.ok(Number.isFinite(phase), `${label} key ${index} phase must be finite`);
    assert.ok(Number.isFinite(value), `${label} key ${index} value must be finite`);
    assert.ok(phase >= 0 && phase <= 1, `${label} key ${index} phase must be bounded`);
    assert.ok(value >= minimum && value <= maximum, `${label} key ${index} value must be bounded`);
    if (index > 0) {
      assert.ok(phase > points[index - 1][0], `${label} phases must stay strictly ordered`);
    }
  });
  assert.equal(points[0][0], 0, `${label} opening endpoint must stay anchored`);
  assert.equal(points.at(-1)[0], 1, `${label} closing endpoint must stay anchored`);
}

function assertHostIsFiniteAndBounded(host, label) {
  for (const [parameter, [minimum, maximum]] of Object.entries(CONTROL_LIMITS)) {
    assert.ok(Number.isFinite(host[parameter]), `${label}.${parameter} must be finite`);
    assert.ok(
      host[parameter] >= minimum && host[parameter] <= maximum,
      `${label}.${parameter} must stay inside ${minimum}…${maximum}`,
    );
  }
}

function assertTongueIsFiniteAndBounded(tongue, label) {
  for (const parameter of ADDABLE_PARAMETERS.filter((name) => name.startsWith("tongue"))) {
    assert.ok(Number.isFinite(tongue[parameter]), `${label}.${parameter} must be finite`);
    assert.ok(
      tongue[parameter] >= 0 && tongue[parameter] <= 1,
      `${label}.${parameter} must stay inside 0…1`,
    );
  }
}

test("Hybrinx Add + catalog can append host and tongue parameter lanes exactly once", () => {
  const entries = catalogEntries();
  const available = entries.map(catalogParameter);
  for (const parameter of [...NATIVE_PARAMETERS, ...ADDABLE_PARAMETERS]) {
    assert.ok(available.includes(parameter), `${parameter} must be available to the timeline`);
  }
  assert.equal(new Set(available).size, available.length, "the parameter catalog must not duplicate lanes");

  const createStore = requiredExport("createHybrinxGestureStore");
  const buildModel = requiredExport("buildHybrinxTimelineModel");
  const store = createStore(CALL_GESTURES);
  const gestureId = "raven-croak";
  const baseState = stateForGesture(gestureId);
  const initial = store.get(gestureId);
  assert.deepEqual(initial.laneParameters, NATIVE_PARAMETERS);
  assert.ok(Object.isFrozen(initial.laneParameters), "lane order must be immutable outside the store");

  const withHostLane = store.addParameter(
    gestureId,
    "sourceScale",
    baseState,
    DEFAULT_TONGUE_STATE,
  );
  assert.ok(withHostLane.laneParameters.includes("sourceScale"));
  assert.deepEqual(withHostLane.curves.sourceScale, [[0, 0], [1, 0]]);
  assert.ok(
    buildModel(withHostLane, baseState, { tongueState: DEFAULT_TONGUE_STATE })
      .lanes.some(({ parameter }) => parameter === "sourceScale"),
    "an added parameter must become a rendered model lane",
  );

  const withTongueLane = store.addParameter(
    gestureId,
    "tongueCurl",
    baseState,
    DEFAULT_TONGUE_STATE,
  );
  assert.ok(withTongueLane.laneParameters.includes("tongueCurl"));
  assert.deepEqual(
    withTongueLane.curves.tongueCurl,
    [[0, DEFAULT_TONGUE_STATE.tongueCurl], [1, DEFAULT_TONGUE_STATE.tongueCurl]],
    "new tongue lanes start flat at the current tongue pose",
  );
  assert.equal(store.isEdited(gestureId), true);

  store.addParameter(gestureId, "tongueCurl", baseState, DEFAULT_TONGUE_STATE);
  assert.equal(
    store.get(gestureId).laneParameters.filter((name) => name === "tongueCurl").length,
    1,
    "choosing an existing palette item must not create duplicate lanes",
  );
  const beforeUnknown = store.get(gestureId);
  const afterUnknown = store.addParameter(
    gestureId,
    "not-a-real-parameter",
    baseState,
    DEFAULT_TONGUE_STATE,
  );
  assert.deepEqual(afterUnknown.laneParameters, beforeUnknown.laneParameters);
  assert.equal(afterUnknown.curves["not-a-real-parameter"], undefined);

  assert.ok(
    store.get("hyena-giggle").laneParameters.every((parameter) => (
      NATIVE_PARAMETERS.includes(parameter)
    )),
    "added lanes remain scoped to their call",
  );
  assert.ok(store.get(gestureId).laneParameters.includes("tongueCurl"));
  store.reset(gestureId);
  assert.deepEqual(store.get(gestureId).laneParameters, NATIVE_PARAMETERS);
  assert.equal(store.get(gestureId).curves.tongueCurl, undefined);
});

test("tongue presets become immutable, call-relative clips in a dedicated override lane", () => {
  const createStore = requiredExport("createHybrinxGestureStore");
  const buildModel = requiredExport("buildHybrinxTimelineModel");
  const store = createStore(CALL_GESTURES);
  const gestureId = "raven-croak";
  const baseState = stateForGesture(gestureId);

  store.setDuration(gestureId, 3_000);
  let gesture = store.addTonguePattern(gestureId, "rolled-r", {
    startPhase: 0.25,
    durationMs: 900,
  });
  assert.ok(Object.isFrozen(gesture.tonguePatterns));
  assert.ok(Object.isFrozen(gesture.tonguePatterns[0]));
  assert.deepEqual(
    {
      presetId: gesture.tonguePatterns[0].presetId,
      startPhase: gesture.tonguePatterns[0].startPhase,
      endPhase: gesture.tonguePatterns[0].endPhase,
    },
    { presetId: "rolled-r", startPhase: 0.25, endPhase: 0.55 },
    "900 ms occupies 30% of a three-second authored call",
  );

  const model = buildModel(gesture, baseState, { gestureRate: 1 });
  assert.equal(model.patternLane.kind, "tongue-patterns");
  assert.equal(model.patternLane.patterns.length, 1);
  assert.equal(model.patternLane.patterns[0].label, "Rolled R");
  assert.ok(Math.abs(model.patternLane.patterns[0].durationMs - 900) < 1e-9);
  assert.equal(
    model.rowCount,
    model.lanes.reduce((count, lane) => count + 1 + (lane.modulation.enabled ? 2 : 0), 1),
    "the tongue pattern lane occupies one real timeline row",
  );

  gesture = store.updateTonguePattern(gestureId, 0, { startPhase: 0.9 });
  assert.equal(gesture.tonguePatterns[0].startPhase, 0.7, "moving a clip keeps it inside the call");
  assert.equal(gesture.tonguePatterns[0].endPhase, 1);
  gesture = store.updateTonguePattern(gestureId, 0, { endPhase: 0.86 });
  assert.equal(gesture.tonguePatterns[0].endPhase, 0.86, "the right edge resizes the override interval");

  const beforeInvalid = gesture;
  assert.strictEqual(
    store.addTonguePattern(gestureId, "not-a-pattern", { startPhase: 0.1 }),
    beforeInvalid,
    "unknown presets cannot enter the gesture document",
  );
  store.removeTonguePattern(gestureId, 0);
  assert.deepEqual(store.get(gestureId).tonguePatterns, []);

  store.addTonguePattern(gestureId, "lick", { startPhase: 0.1, durationMs: 500 });
  store.addParameter(gestureId, "sourceScale", baseState, DEFAULT_TONGUE_STATE);
  const resetTongue = resetStoredTongueAutomation(store, gestureId);
  assert.deepEqual(resetTongue.tonguePatterns, [], "Reset Tongue clears pattern clips too");
  assert.ok(resetTongue.laneParameters.includes("sourceScale"), "host automation survives Reset Tongue");
  assert.equal(resetTongue.durationMs, 3_000, "transport edits survive Reset Tongue");
});

test("tongue clips override host, tongue, and articulation only inside their timeline interval", () => {
  const createStore = requiredExport("createHybrinxGestureStore");
  const applyPerformance = requiredExport("applyHybrinxTimelinePerformance");
  const resolvePattern = requiredExport("resolveHybrinxTonguePattern");
  const store = createStore(CALL_GESTURES);
  const gestureId = "raven-croak";
  const baseState = stateForGesture(gestureId, { pressure: 0.41, mouthOpening: 0.77 });
  store.setDuration(gestureId, 3_000);
  const underlyingGesture = store.get(gestureId);
  const before = applyPerformance(underlyingGesture, baseState, DEFAULT_TONGUE_STATE, 0.1);
  const after = applyPerformance(underlyingGesture, baseState, DEFAULT_TONGUE_STATE, 0.5);

  store.addTonguePattern(gestureId, "p", { startPhase: 0.2, durationMs: 600 });
  store.addTonguePattern(gestureId, "rolled-r", { startPhase: 0.25, durationMs: 300 });
  const gesture = store.get(gestureId);
  const beforeClip = applyPerformance(gesture, baseState, DEFAULT_TONGUE_STATE, 0.1);
  const pOnly = applyPerformance(gesture, baseState, DEFAULT_TONGUE_STATE, 0.22);
  const overlap = applyPerformance(gesture, baseState, DEFAULT_TONGUE_STATE, 0.3);
  const afterNested = applyPerformance(gesture, baseState, DEFAULT_TONGUE_STATE, 0.37);
  const afterClip = applyPerformance(gesture, baseState, DEFAULT_TONGUE_STATE, 0.5);

  assert.equal(beforeClip.pattern, null);
  assert.equal(beforeClip.articulation.active, false);
  assert.deepEqual(beforeClip.host, before.host, "settings before a clip are unchanged");
  assert.deepEqual(beforeClip.tongue, before.tongue);
  assert.equal(pOnly.pattern.presetId, "p");
  assert.equal(pOnly.articulation.active, true);
  assert.equal(pOnly.host.pressure, 0.94, "the pattern's host settings win during its clip");
  assert.equal(overlap.pattern.presetId, "rolled-r", "the last-starting overlapping clip wins");
  assert.equal(afterNested.pattern.presetId, "p", "the earlier clip resumes when the nested clip ends");
  assert.equal(afterClip.pattern, null);
  assert.equal(afterClip.articulation.active, false);
  assert.deepEqual(afterClip.host, after.host, "underlying host automation resumes after the clip");
  assert.deepEqual(afterClip.tongue, after.tongue, "the free-hand tongue pose resumes after the clip");

  const resolved = resolvePattern(gesture, 0.3, { gestureRate: 2 });
  assert.equal(resolved.presetId, "rolled-r");
  assert.ok(
    Math.abs(resolved.elapsedSeconds - 0.075) < 1e-12,
    "a clip's motion clock is derived from call phase and gesture rate",
  );
});

test("per-lane Speed and Depth modulation contours are editable, immutable, and bounded", () => {
  const createStore = requiredExport("createHybrinxGestureStore");
  const buildModel = requiredExport("buildHybrinxTimelineModel");
  const store = createStore(CALL_GESTURES);
  const gestureId = "raven-croak";
  const baseState = stateForGesture(gestureId);

  let edited = store.toggleModulation(gestureId, "pressure", true);
  assert.equal(edited.modulations.pressure.enabled, true);
  assert.equal(edited.modulations.pressure.shape, "sine");
  assert.deepEqual(edited.modulations.pressure.speed, [[0, 2], [1, 2]]);
  assert.deepEqual(edited.modulations.pressure.depth, [[0, 0.35], [1, 0.35]]);

  edited = store.updateModulationKeyframe(
    gestureId,
    "pressure",
    "speed",
    0,
    { phase: 0.7, rawValue: 999 },
  );
  edited = store.updateModulationKeyframe(
    gestureId,
    "pressure",
    "depth",
    1,
    { phase: 0.2, rawValue: -999 },
  );
  assertOrderedFinitePoints(modulationPoints(edited, "pressure", "speed"), [0.02, 30], "speed");
  assertOrderedFinitePoints(modulationPoints(edited, "pressure", "depth"), [0, 1], "depth");

  edited = store.addModulationKeyframe(
    gestureId,
    "pressure",
    "speed",
    { phase: 0.5, rawValue: 4.25 },
  );
  let speed = modulationPoints(edited, "pressure", "speed");
  const insertedIndex = speed.findIndex(([phase, value]) => phase === 0.5 && value === 4.25);
  assert.ok(insertedIndex > 0 && insertedIndex < speed.length - 1);
  edited = store.removeModulationKeyframe(gestureId, "pressure", "speed", insertedIndex);
  speed = modulationPoints(edited, "pressure", "speed");
  assert.equal(speed.some(([phase, value]) => phase === 0.5 && value === 4.25), false);
  assert.ok(Object.isFrozen(edited.modulations));
  assert.ok(Object.isFrozen(edited.modulations.pressure));
  assert.ok(Object.isFrozen(edited.modulations.pressure.speed));

  const pressureLane = buildModel(edited, baseState).lanes
    .find(({ parameter }) => parameter === "pressure");
  assert.ok(pressureLane?.modulation?.enabled, "the primary lane model exposes its active modulator");
  for (const contour of ["speed", "depth"]) {
    const child = pressureLane.modulation[contour];
    assert.ok(child?.samples?.length > 2, `${contour} must draw a sampled contour`);
    assert.equal(child.keyframes.length, edited.modulations.pressure[contour].length);
    assert.equal(
      child.samples.every(({ phase, value }) => (
        Number.isFinite(phase) && phase >= 0 && phase <= 1
          && Number.isFinite(value) && value >= 0 && value <= 1
      )),
      true,
      `${contour} rendering samples must be normalized and finite`,
    );
  }

  edited = store.toggleModulation(gestureId, "pressure", false);
  assert.equal(edited.modulations.pressure.enabled, false);
  assert.ok(edited.modulations.pressure.speed, "disabling must retain authored Speed keys");
  store.reset(gestureId);
  assert.equal(store.get(gestureId).modulations.pressure, undefined);
});

test("Reset Tongue clears only current-call tongue automation and preserves host edits and transport", async () => {
  const createStore = requiredExport("createHybrinxGestureStore");
  const applyPerformance = requiredExport("applyHybrinxTimelinePerformance");
  const store = createStore(CALL_GESTURES);
  const gestureId = "raven-croak";
  const otherGestureId = "hyena-giggle";
  const baseState = stateForGesture(gestureId, { sourceScale: 0.52 });
  const otherBaseState = stateForGesture(otherGestureId);

  store.updateKeyframe(gestureId, "pressure", 2, { rawValue: 0.27 });
  store.setDuration(gestureId, 1_760);
  store.addParameter(gestureId, "sourceScale", baseState, DEFAULT_TONGUE_STATE);
  store.toggleModulation(gestureId, "sourceScale", true);
  store.updateModulationKeyframe(
    gestureId,
    "sourceScale",
    "depth",
    0,
    { rawValue: 0.62 },
  );
  store.addParameter(gestureId, "tongueCurl", baseState, DEFAULT_TONGUE_STATE);
  store.updateKeyframe(gestureId, "tongueCurl", 1, { rawValue: 0.94 });
  store.toggleModulation(gestureId, "tongueCurl", true);
  store.updateModulationKeyframe(
    gestureId,
    "tongueCurl",
    "speed",
    1,
    { rawValue: 8.5 },
  );
  store.updateModulationKeyframe(
    gestureId,
    "tongueCurl",
    "depth",
    1,
    { rawValue: 0.88 },
  );

  store.addParameter(otherGestureId, "tongueTip", otherBaseState, DEFAULT_TONGUE_STATE);
  store.toggleModulation(otherGestureId, "tongueTip", true);

  const before = store.get(gestureId);
  const beforePlayback = applyPerformance(
    before,
    baseState,
    DEFAULT_TONGUE_STATE,
    0.61,
    { gestureRate: 1.4 },
  );
  assert.notEqual(beforePlayback.tongue.tongueCurl, DEFAULT_TONGUE_STATE.tongueCurl);
  assert.equal(
    beforePlayback.modulation.some(({ family }) => family === "tongue"),
    true,
  );

  const after = resetStoredTongueAutomation(store, gestureId);
  assert.ok(after && Object.isFrozen(after));
  assert.ok(after.revision > before.revision, "Reset Tongue must invalidate the rendered timeline");
  assert.equal(after.durationMs, before.durationMs, "Reset Tongue must not rewind call transport length");
  assert.deepEqual(after.curves.pressure, before.curves.pressure);
  assert.deepEqual(after.curves.sourceScale, before.curves.sourceScale);
  assert.deepEqual(after.modulations.sourceScale, before.modulations.sourceScale);
  assert.ok(after.laneParameters.includes("sourceScale"));
  assert.equal(store.isEdited(gestureId), true, "retained host edits keep the call marked edited");

  const tongueParameters = catalogEntries()
    .filter(({ family }) => family === "tongue")
    .map(catalogParameter);
  for (const parameter of tongueParameters) {
    assert.notEqual(
      after.modulations?.[parameter]?.enabled,
      true,
      `${parameter} modulation must be disabled or removed`,
    );
    if (!after.laneParameters.includes(parameter)) continue;
    const baseline = DEFAULT_TONGUE_STATE[parameter];
    assert.ok(
      after.curves?.[parameter]?.every(([, value]) => value === baseline),
      `a retained ${parameter} lane must be flat at its reset pose`,
    );
  }

  const afterPlayback = applyPerformance(
    after,
    baseState,
    DEFAULT_TONGUE_STATE,
    0.61,
    { gestureRate: 1.4 },
  );
  assert.deepEqual(afterPlayback.host, beforePlayback.host, "host timeline sound remains intact");
  assert.deepEqual(afterPlayback.tongue, DEFAULT_TONGUE_STATE);
  assert.equal(afterPlayback.modulation.some(({ family }) => family === "tongue"), false);

  const otherCall = store.get(otherGestureId);
  assert.ok(otherCall.laneParameters.includes("tongueTip"));
  assert.equal(
    otherCall.modulations.tongueTip.enabled,
    true,
    "Reset Tongue only clears automation on the selected call",
  );

  const app = await readFile(new URL("syrinx-app.js", root), "utf8");
  const resetBody = standaloneFunctionBody(app, "resetTonguePerformance");
  assert.match(
    resetBody,
    /HYBRINX_MODE[\s\S]{0,320}?hybrinxGestureStore\?*\.(?:resetParameterFamily\(\s*state\.callId\s*,\s*["']tongue["']|clearTongueAutomation\(\s*state\.callId)/,
    "Hybrinx Reset Tongue must clear the current call's sequenced tongue automation",
  );
  assert.doesNotMatch(
    resetBody,
    /hybrinxGestureStore\?*\.(?:reset|resetAll)\s*\(/,
    "Reset Tongue must not erase host or whole-call edits",
  );
  assert.doesNotMatch(
    resetBody,
    /(?:gesturePlaying|manualBreath)\s*=|gesturePhase\s*=|gestureStartTime\s*=|loopGapRemainingMs\s*=|stopPerformance\s*\(/,
    "Reset Tongue must leave the active call transport untouched",
  );
  assert.match(resetBody, /audioDirty\s*=\s*true/);
});

test("timeline geometry fills its pane and zooms horizontal and vertical axes independently", () => {
  const buildModel = requiredExport("buildHybrinxTimelineModel");
  const resolveGeometry = requiredExport("resolveHybrinxTimelineGeometry");
  const gestureId = "raven-croak";
  const model = buildModel(CALL_GESTURES[gestureId], stateForGesture(gestureId));
  const pane = {
    availableWidth: 1_420,
    availableHeight: 820,
    rowCount: model.rowCount,
  };
  const fitted = resolveGeometry(model, pane);
  const explicitHundred = resolveGeometry(model, { ...pane, zoomX: 1, zoomY: 1 });

  assert.deepEqual(fitted, explicitHundred, "100% is the fitted timeline baseline");
  assert.ok(Object.isFrozen(fitted));
  assert.ok(fitted.viewBoxWidth >= pane.availableWidth);
  assert.ok(fitted.viewBoxHeight >= pane.availableHeight);
  for (const [name, value] of Object.entries(fitted)) {
    assert.ok(Number.isFinite(value), `fitted geometry ${name} must be finite`);
    assert.ok(value >= 0, `fitted geometry ${name} must not be negative`);
  }
  for (const name of ["viewBoxWidth", "viewBoxHeight", "plotWidth", "laneHeight"]) {
    assert.ok(fitted[name] > 0, `fitted geometry ${name} must be positive`);
  }

  const zoomX110 = resolveGeometry(model, { ...pane, zoomX: 1.1, zoomY: 1 });
  assert.ok(zoomX110.plotWidth > fitted.plotWidth, "110% X zoom responds immediately");
  assert.equal(zoomX110.laneHeight, fitted.laneHeight, "X zoom does not alter lane height");
  assert.equal(zoomX110.viewBoxHeight, fitted.viewBoxHeight, "X zoom does not alter canvas height");

  const zoomY110 = resolveGeometry(model, { ...pane, zoomX: 1, zoomY: 1.1 });
  assert.ok(zoomY110.laneHeight > fitted.laneHeight, "110% Y zoom responds immediately");
  assert.equal(zoomY110.plotWidth, fitted.plotWidth, "Y zoom does not alter time width");
  assert.equal(zoomY110.viewBoxWidth, fitted.viewBoxWidth, "Y zoom does not alter canvas width");

  const zoomX200 = resolveGeometry(model, { ...pane, zoomX: 2, zoomY: 1 });
  const zoomY200 = resolveGeometry(model, { ...pane, zoomX: 1, zoomY: 2 });
  assert.equal(zoomX200.plotWidth, fitted.plotWidth * 2, "200% X doubles fitted time width");
  assert.equal(zoomX200.laneHeight, fitted.laneHeight);
  assert.equal(zoomY200.laneHeight, fitted.laneHeight * 2, "200% Y doubles fitted lane height");
  assert.equal(zoomY200.plotWidth, fitted.plotWidth);
});

test("timeline modulation deterministically affects playback while keeping host and tongue values finite", () => {
  const createStore = requiredExport("createHybrinxGestureStore");
  const applyPerformance = requiredExport("applyHybrinxTimelinePerformance");
  const store = createStore(CALL_GESTURES);
  const gestureId = "raven-croak";
  const baseState = stateForGesture(gestureId, {
    sourceScale: 0.52,
    pressure: 0.72,
  });

  store.addParameter(gestureId, "sourceScale", baseState, DEFAULT_TONGUE_STATE);
  store.addParameter(gestureId, "tongueCurl", baseState, DEFAULT_TONGUE_STATE);
  let gesture = store.get(gestureId);
  const quietPhase = 0.37;
  const unmodulated = applyPerformance(
    gesture,
    baseState,
    DEFAULT_TONGUE_STATE,
    quietPhase,
  );
  const interpolated = interpolateGesture(gesture, quietPhase, baseState);
  assert.equal(unmodulated.host.sourceScale, interpolated.sourceScale);
  assert.equal(unmodulated.tongue.tongueCurl, DEFAULT_TONGUE_STATE.tongueCurl);

  store.toggleModulation(gestureId, "sourceScale", true);
  store.toggleModulation(gestureId, "tongueCurl", true);
  for (const parameter of ["sourceScale", "tongueCurl"]) {
    for (const index of [0, 1]) {
      store.updateModulationKeyframe(
        gestureId,
        parameter,
        "speed",
        index,
        { rawValue: 5.5 },
      );
      store.updateModulationKeyframe(
        gestureId,
        parameter,
        "depth",
        index,
        { rawValue: 1 },
      );
    }
  }
  gesture = store.get(gestureId);

  const samples = [0, 0.11, 0.23, 0.39, 0.61, 0.83, 1].map((phase) => {
    const first = applyPerformance(gesture, baseState, DEFAULT_TONGUE_STATE, phase);
    const second = applyPerformance(gesture, baseState, DEFAULT_TONGUE_STATE, phase);
    assert.deepEqual(second, first, `phase ${phase} playback must be deterministic`);
    assertHostIsFiniteAndBounded(first.host, `phase ${phase} host`);
    assertTongueIsFiniteAndBounded(first.tongue, `phase ${phase} tongue`);
    assert.ok(first.modulation, "playback must report the applied timeline modulation");
    return first;
  });
  assert.ok(
    new Set(samples.map(({ host }) => host.sourceScale.toFixed(6))).size > 1,
    "the Speed/Depth contours must audibly move an added host parameter",
  );
  assert.ok(
    new Set(samples.map(({ tongue }) => tongue.tongueCurl.toFixed(6))).size > 1,
    "the Speed/Depth contours must animate an added tongue parameter",
  );

  const normalRate = applyPerformance(
    gesture,
    baseState,
    DEFAULT_TONGUE_STATE,
    0.63,
    { gestureRate: 1 },
  ).modulation.find(({ parameter }) => parameter === "sourceScale");
  const doubleRate = applyPerformance(
    gesture,
    baseState,
    DEFAULT_TONGUE_STATE,
    0.63,
    { gestureRate: 2 },
  ).modulation.find(({ parameter }) => parameter === "sourceScale");
  assert.ok(normalRate && doubleRate);
  assert.ok(
    Math.abs(doubleRate.oscillatorPhase * 2 - normalRate.oscillatorPhase) < 1e-12,
    "Hz modulation follows real sounding time, so a 2× call advances half as many cycles at the same normalized call phase",
  );

  for (const phase of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
    const result = applyPerformance(gesture, baseState, DEFAULT_TONGUE_STATE, phase);
    assertHostIsFiniteAndBounded(result.host, "invalid-phase host");
    assertTongueIsFiniteAndBounded(result.tongue, "invalid-phase tongue");
  }
});

test("Hybrinx exposes accessible Add +, per-lane Mod, and independent two-axis zoom controls", async () => {
  const [html, css, timelineSource, app] = await Promise.all([
    readFile(new URL("hybrinx.html", root), "utf8"),
    readFile(new URL("hybrinx.css", root), "utf8"),
    readFile(new URL("src/hybrinx-timeline.js", root), "utf8"),
    readFile(new URL("syrinx-app.js", root), "utf8"),
  ]);

  const addButton = html.match(/<button\b[^>]*id="hybrinxTimelineAddParameter"[^>]*>[\s\S]*?<\/button>/i)?.[0] ?? "";
  assert.match(addButton, /type="button"/i);
  assert.match(addButton, /aria-(?:label|haspopup)=/i);
  assert.match(addButton, /aria-controls="hybrinxTimelineParameterPalette"/i);
  assert.match(addButton, /aria-expanded="false"/i);
  assert.match(addButton, /(?:add\s*\+|\+\s*add|>\s*\+)/i);
  const palette = html.match(/<[^>]+\bid="hybrinxTimelineParameterPalette"[^>]*>/i)?.[0] ?? "";
  assert.match(palette, /(?:hidden|aria-hidden|role="(?:menu|listbox|group)")/i);
  const gutter = html.match(/<[^>]+\bid="hybrinxTimelineGutter"[^>]*>/i)?.[0] ?? "";
  assert.match(gutter, /role="group"/i);
  assert.match(gutter, /aria-label="[^"]*(?:parameter|lane|modulation)[^"]*"/i);

  for (const [id, axis] of [
    ["hybrinxTimelineZoomX", "horizontal"],
    ["hybrinxTimelineZoomY", "vertical"],
  ]) {
    const input = html.match(new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`, "i"))?.[0] ?? "";
    assert.match(input, /type="range"/i, `${axis} zoom must use a range control`);
    assert.match(input, /min="100"/i, `${axis} zoom starts at its fitted 100% size`);
    assert.match(input, /max="[^"]+"/i);
    assert.match(input, new RegExp(`aria-label="[^"]*${axis}[^\"]*"`, "i"));
  }
  const paletteParameters = [...html.matchAll(/data-hybrinx-add-parameter="([^"]+)"/g)]
    .map((match) => match[1]);
  for (const parameter of ADDABLE_PARAMETERS) {
    assert.ok(
      paletteParameters.includes(parameter),
      `the Add + shelf must expose ${parameter}`,
    );
  }
  assert.equal(
    new Set(paletteParameters).size,
    paletteParameters.length,
    "the Add + shelf must not repeat parameters",
  );
  assert.match(timelineSource, /querySelector\(\s*["']#hybrinxTimelineZoomX["']\s*\)/);
  assert.match(timelineSource, /querySelector\(\s*["']#hybrinxTimelineZoomY["']\s*\)/);
  assert.match(
    timelineSource,
    /zoomXInput\?*\.addEventListener\(\s*["']input["'][\s\S]{0,160}?["']x["']/,
    "horizontal zoom must update live while dragged",
  );
  assert.match(
    timelineSource,
    /zoomYInput\?*\.addEventListener\(\s*["']input["'][\s\S]{0,160}?["']y["']/,
    "vertical zoom must update live while dragged",
  );
  assert.match(
    timelineSource,
    /(?:install|apply)ZoomControl\(\s*zoomXInput\s*,[^,]+,\s*["']x["']\s*\)/,
    "horizontal zoom needs an independent x-axis binding",
  );
  assert.match(
    timelineSource,
    /(?:install|apply)ZoomControl\(\s*zoomYInput\s*,[^,]+,\s*["']y["']\s*\)/,
    "vertical zoom needs an independent y-axis binding",
  );
  assert.match(timelineSource, /resolveHybrinxTimelineGeometry\(\s*model\s*,/);
  assert.match(
    timelineSource,
    /createElement\(\s*["']button["']\s*\)[\s\S]{0,500}?type\s*=\s*["']button["'][\s\S]{0,500}?dataset\.hybrinxModToggle[\s\S]{0,500}?aria-pressed/,
    "each parameter's left-side Mod control must be a keyboard-native button that announces its state",
  );
  assert.match(
    timelineSource,
    /gutter\?\.addEventListener\(\s*["']click["'][\s\S]{0,500}?data-hybrinx-mod-toggle[\s\S]{0,500}?toggle-modulation/,
    "native Mod buttons must dispatch modulation edits through the frozen lane gutter",
  );
  assert.match(timelineSource, /["']toggle-modulation["']/);
  for (const contour of ["speed", "depth"]) {
    assert.match(
      timelineSource,
      new RegExp(`lane\\.modulation\\.${contour}[\\s\\S]{0,100}contour:\\s*[\"']${contour}[\"']`),
      `an enabled Mod button must reveal its ${contour} row`,
    );
  }
  assert.match(timelineSource, /["']data-modulation-axis["']\s*:\s*contour/);
  for (const action of [
    "modulation-keyframe",
    "add-modulation-keyframe",
    "remove-modulation-keyframe",
  ]) {
    assert.match(timelineSource, new RegExp(`[\"']${action}[\"']`));
  }
  assert.match(timelineSource, /["']add-parameter["']/);
  assert.match(timelineSource, /aria-expanded[\s\S]{0,800}parameterPalette\.hidden|parameterPalette\.hidden[\s\S]{0,800}aria-expanded/);

  assert.match(
    css,
    /\.hybrinx-timeline-scroll\s*\{[^}]*flex:\s*1\s+1\s+(?:auto|0)[^}]*overflow:\s*auto/is,
    "the contour scroller must consume the timeline's available vertical space",
  );
  assert.match(
    css,
    /\.hybrinx-timeline-svg\s*\{[^}]*(?:height|min-height):\s*(?:max\([^;]*100%|100%|var\(--hybrinx-[^;]*(?:height|zoom-y))/is,
    "the contour canvas must expand into unused vertical space",
  );
  assert.match(
    css,
    /\.hybrinx-timeline-gutter\s*\{[^}]*position:\s*sticky[^}]*left:\s*0/is,
    "lane names, values, and Mod buttons must stay frozen while the contour scrolls in time",
  );
  assert.match(css, /\.hybrinx-timeline-gutter-mod\b[^}]*\{/i);
  assert.match(
    css,
    /\.hybrinx-timeline\.is-parameter-palette-open\s+\.hybrinx-timeline-header\s*\{[^}]*z-index:\s*(?:9|[1-9]\d+)/is,
    "the Add + shelf must rise above the sticky lane gutter while it is open",
  );
  assert.match(css, /\.hybrinx-timeline-modulation-(?:lane|curve)\b/);
  assert.match(css, /\.hybrinx-timeline-(?:parameter-palette|add-parameter)\b/);
  assert.match(css, /\.hybrinx-timeline-(?:zoom|zoom-control|zoom-controls)\b/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*(?:650|520|420)px\)[\s\S]{0,8000}?\.hybrinx-timeline-(?:editor-tools|zoom|add-parameter)\b/,
    "Add + and two-axis zoom controls need a compact-screen layout",
  );
  assert.match(
    css,
    /@media[^\n{]*orientation:\s*landscape[^\n{]*max-height[^\n{]*\{[\s\S]{0,8000}?\.hybrinx-timeline-editor-tools\b/,
    "timeline tools need to survive short landscape viewports",
  );

  assert.match(
    app,
    /applyHybrinxTimelinePerformance\([\s\S]{0,240}(?:gesturePhase|timeline\.phase)/,
    "the animated Speed/Depth contours must feed the real Hybrinx playback state",
  );
  assert.match(
    app,
    /applyHybrinxTimelinePerformance\([\s\S]{0,360}?gestureRate:\s*state\.gestureRate/,
    "real-time modulation must use the transport's effective call rate",
  );
});

test("Hybrinx exposes tongue pattern clips as accessible timeline edits", async () => {
  const [html, css, timelineSource, app] = await Promise.all([
    readFile(new URL("hybrinx.html", root), "utf8"),
    readFile(new URL("hybrinx.css", root), "utf8"),
    readFile(new URL("src/hybrinx-timeline.js", root), "utf8"),
    readFile(new URL("syrinx-app.js", root), "utf8"),
  ]);

  assert.match(html, /Voice \+ tongue timeline/i);
  assert.match(html, /900 ms override clip at the timeline playhead/i);
  assert.match(html, /aria-label="[^"]*tongue pattern[^"]*timeline[^"]*"/i);
  assert.match(css, /\.hybrinx-timeline-pattern\s*\{/);
  assert.match(css, /\.hybrinx-timeline-pattern-resize\s*\{/);
  assert.match(timelineSource, /data-tongue-pattern-index/);
  assert.match(timelineSource, /type:\s*["']tongue-pattern["']/);
  assert.match(timelineSource, /type:\s*["']remove-tongue-pattern["']/);
  assert.match(timelineSource, /event\.key\s*===\s*["']Delete["']/);
  assert.match(app, /hybrinxGestureStore\.addTonguePattern\(/);
  assert.match(app, /sequenced\.articulation/);
  assert.match(
    app,
    /setTongueMotion\([\s\S]{0,1400}?startPhase[\s\S]{0,500}?durationMs:\s*900/,
    "preset buttons must place a bounded clip at the current call phase",
  );
});
