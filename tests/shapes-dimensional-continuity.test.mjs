import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShapesDivisionMarkers,
  buildShapesScene,
} from "../src/shapes-scene.js";
import {
  advanceShapesMotion,
  createShapesState,
  displayShapesPhase,
  projectShapesMotion,
  selectShapesDimension,
  selectShapesPlayingMode,
  setShapesDivisionCount,
  shapesDivisionCount,
  shapesEventIntervalMs,
  shapesEventRegionKeys,
  shapesEventToken,
  shapesRotationIsMoving,
} from "../src/shapes-state.js";
import {
  normalizeSharedProfile,
  sharedProfilePoints,
} from "../src/shapes-profile.js";
import {
  directedCornerEnvelopeProfile,
  shapes2dContactContourDirection,
} from "../src/geometry.js";
import { buildProfilePrism, buildSolid } from "../src/solid.js";
import { buildHyperShape, buildProfileHyperprism } from "../src/hyper.js";

const EPSILON = 1e-12;

function assertClose(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= EPSILON,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function assertSameProfileShape(actual, expected, message) {
  assert.equal(actual.length, expected.length, `${message} point count`);
  const actualMaximum = Math.max(...actual.map(({ x, y }) => Math.hypot(x, y)));
  const expectedMaximum = Math.max(...expected.map(({ x, y }) => Math.hypot(x, y)));
  actual.forEach((point, index) => {
    const reference = expected[index];
    assertClose(Math.atan2(point.y, point.x), Math.atan2(reference.y, reference.x), `${message} point ${index} angle`);
    assertClose(
      Math.hypot(point.x, point.y) / actualMaximum,
      Math.hypot(reference.x, reference.y) / expectedMaximum,
      `${message} point ${index} relative radius`,
    );
  });
}

test("the baseline profile is the original square", () => {
  const state = createShapesState();
  assert.deepEqual(state.profile, { sides: 4, kind: "polygon", starDepth: 0.48 });
  assert.equal(buildShapesScene(state).topologyEdgeCount, 4);
  assert.equal(state.dimension["3d"].representation, "cube");
  assert.equal(state.dimension["4d"].representation, "tesseract");
});

test("audio look-ahead projects transport and rotation without mutating live state", () => {
  const state = createShapesState();
  state.play.running = true;
  state.play.rateCyclesPerSecond = 0.5;
  state.dimension["2d"].rotationRunning = true;
  state.dimension["2d"].rotationSpeed = 0.2;
  const before = structuredClone(state);
  const projected = projectShapesMotion(state, 0.075);
  assert.deepEqual(state, before, "forecasting leaves the painted state untouched");
  assertClose(projected.play.continuousPhase, before.play.continuousPhase + 0.0375, "phase look-ahead");
  assertClose(projected.dimension["2d"].rotation, before.dimension["2d"].rotation + 5.4, "rotation look-ahead");
});

test("3D and 4D rotation transports move only their selected reader or shape axis", () => {
  const state = createShapesState();
  selectShapesDimension(state, "3d");
  const three = state.dimension["3d"];
  assert.equal(shapesRotationIsMoving(state), false);
  three.rotationMotion.x.running = true;
  const beforeThree = structuredClone(three);
  advanceShapesMotion(state, 0.25);
  assertClose(three.rotation.x, beforeThree.rotation.x + 2.7, "X rotates at its own speed");
  assert.equal(three.rotation.y, beforeThree.rotation.y, "Y stays fixed");
  assert.equal(three.rotation.z, beforeThree.rotation.z, "Z stays fixed");
  assert.equal(three.readerYaw, beforeThree.readerYaw, "reader yaw stays fixed");
  assert.equal(state.play.continuousPhase, 0.18, "shape rotation does not move the reader position");
  assert.equal(shapesRotationIsMoving(state), true);

  three.rotationMotion.x.running = false;
  three.rotationMotion.readerYaw.running = true;
  const yaw = three.readerYaw;
  advanceShapesMotion(state, 0.25);
  assertClose(three.readerYaw, yaw + 3.6, "reader yaw has its own transport");
  assertClose(three.rotation.x, beforeThree.rotation.x + 2.7, "shape stays fixed while reader rotates");

  selectShapesDimension(state, "4d");
  const four = state.dimension["4d"];
  four.rotationMotion.zw.running = true;
  const zw = four.rotation.zw;
  advanceShapesMotion(state, 0.25);
  assertClose(four.rotation.zw, zw - 1.8, "Z–W keeps its independent signed speed");
  assert.equal(four.rotation.xw, 24);
  assert.equal(four.rotation.yw, -18);
});

test("legacy all-axis rotation migrates into independent controls", () => {
  const state = createShapesState({
    dimension: {
      "3d": { rotationRunning: true, rotationSpeed: 0.1 },
      "4d": { rotationRunning: true, rotationSpeed: 0.05 },
    },
  });
  assert.equal(state.dimension["3d"].rotationRunning, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(state.dimension["3d"].rotationMotion).map(([axis, motion]) => [axis, motion.running])),
    { readerYaw: false, readerPitch: false, x: true, y: true, z: true },
  );
  assert.equal(state.dimension["4d"].rotationRunning, false);
  assert.deepEqual(
    Object.values(state.dimension["4d"].rotationMotion).map(({ running }) => running),
    [true, true, true],
  );
});

test("a 2D triangle is preserved as a 3D triangular prism and 4D triangular hyperprism", () => {
  const requested = { sides: 3, kind: "polygon", starDepth: 0.41 };
  const polygon = sharedProfilePoints(requested);
  const prism = buildProfilePrism(requested);
  const hyperprism = buildProfileHyperprism(requested);

  assert.deepEqual(
    { sides: polygon.sides, kind: polygon.kind, starDepth: polygon.starDepth },
    normalizeSharedProfile(requested),
  );
  assert.equal(polygon.points.length, 3);
  assert.equal(prism.vertices.length, 6);
  assert.equal(prism.edges.length, 9);
  assert.equal(hyperprism.vertices.length, 12);
  assert.equal(hyperprism.edges.length, 24);
  assert.deepEqual(prism.profile, polygon);
  assert.deepEqual(prism.vertices.slice(0, 3).map(({ x, y }) => ({ x, y })), polygon.points);
  for (let slice = 0; slice < 4; slice += 1) {
    assert.deepEqual(
      hyperprism.vertices.slice(slice * 3, slice * 3 + 3).map(({ x, y }) => ({ x, y })),
      hyperprism.profile.points,
    );
  }
  assertSameProfileShape(hyperprism.profile.points, polygon.points, "4D triangle profile");
  assert.deepEqual(buildSolid("profile", { profile: requested }), prism);
  assert.deepEqual(buildHyperShape("profile", { profile: requested }), hyperprism);
});

test("star vertices and inset depth survive each dimensional extrusion", () => {
  const requested = { sides: 5, kind: "star", starDepth: 0.37 };
  const star = sharedProfilePoints(requested);
  const prism = buildSolid("profile", { profile: requested });
  const hyperprism = buildHyperShape("profile", { profile: requested });

  assert.equal(star.points.length, 10);
  assert.equal(prism.profile.kind, "star");
  assert.equal(hyperprism.profile.kind, "star");
  assert.equal(prism.profile.starDepth, 0.37);
  assert.equal(hyperprism.profile.starDepth, 0.37);
  assert.equal(prism.vertices.length, 20);
  assert.equal(hyperprism.vertices.length, 40);
  const outerRadius = Math.hypot(star.points[0].x, star.points[0].y);
  for (let index = 0; index < star.points.length; index += 1) {
    const expectedRatio = index % 2 === 0 ? 1 : 1 - requested.starDepth;
    assertClose(
      Math.hypot(star.points[index].x, star.points[index].y) / outerRadius,
      expectedRatio,
      `2D star point ${index} radius`,
    );
  }
  assertSameProfileShape(prism.profile.points, star.points, "3D star profile");
  assertSameProfileShape(hyperprism.profile.points, star.points, "4D star profile");
});

test("circle and line profiles remain literal extrusions in 3D and 4D", () => {
  for (const profile of [
    { sides: 1, kind: "circle", starDepth: 0.48 },
    { sides: 2, kind: "line", starDepth: 0.48 },
  ]) {
    const state = createShapesState({ profile });
    selectShapesDimension(state, "3d");
    state.dimension["3d"].representation = "profile";
    const solid = buildShapesScene(state);
    assert.equal(solid.geometry.type, "profile");
    assert.equal(solid.geometry.profile.kind, profile.kind);
    assert.equal(solid.geometry.vertices.length, solid.geometry.profile.points.length * 2);
    selectShapesDimension(state, "4d");
    state.dimension["4d"].representation = "profile";
    const hyper = buildShapesScene(state);
    assert.equal(hyper.geometry.type, "profile");
    assert.equal(hyper.geometry.profile.kind, profile.kind);
    assert.equal(hyper.geometry.vertices.length, hyper.geometry.profile.points.length * 4);
  }
});

test("one canonical state preserves shared transport and dimension-private controls", () => {
  const state = createShapesState();
  state.play.running = true;
  state.play.continuousPhase = 2.25;
  state.play.rateCyclesPerSecond = 0.5;
  state.profile = { sides: 7, kind: "star", starDepth: 0.31 };
  state.dimension["2d"].rotation = 77;
  state.dimension["3d"].representation = "torus";
  state.dimension["3d"].rotation.y = 123;
  state.dimension["4d"].representation = "klein";
  state.dimension["4d"].rotation.xw = -91;

  selectShapesDimension(state, "3d");
  advanceShapesMotion(state, 0.2);
  assertClose(state.play.continuousPhase, 2.35, "shared unwrapped phase advances");
  assert.equal(state.dimension["3d"].representation, "torus");
  selectShapesDimension(state, "4d");
  assert.equal(state.dimension["4d"].representation, "klein");
  assert.equal(state.dimension["4d"].rotation.xw, -91);
  selectShapesDimension(state, "2d");
  assert.equal(state.dimension["2d"].rotation, 77);
  assert.deepEqual(state.profile, { sides: 7, kind: "star", starDepth: 0.31 });
});

test("Notes and Triggers share one stable division grid", () => {
  const state = createShapesState();
  state.voice.engine = "pm";
  state.voice.character = 0.82;
  state.trigger.mapping = "incidence";

  assert.equal(shapesDivisionCount(state), 1, "Continuous has no divisions");
  assert.equal(state.play.divisions, 2, "the original trigger grid defaults to two divisions");
  setShapesDivisionCount(state, 11);
  assert.equal(state.play.divisions, 2, "the hidden Continuous control cannot overwrite the grid");
  selectShapesPlayingMode(state, "notes");
  assert.equal(shapesDivisionCount(state), 2);
  setShapesDivisionCount(state, 11);
  assert.equal(shapesDivisionCount(state), 11);
  assert.equal(state.voice.engine, "pm");
  selectShapesPlayingMode(state, "triggers");
  assert.equal(shapesDivisionCount(state), 11, "switching mode preserves the visible division value");
  setShapesDivisionCount(state, 21);
  assert.equal(shapesDivisionCount(state), 16, "the shared original range is clamped at sixteen");
  assert.equal(state.trigger.mapping, "incidence");
  assert.equal(state.voice.character, 0.82);
  selectShapesPlayingMode(state, "notes");
  assert.equal(shapesDivisionCount(state), 16);
  selectShapesPlayingMode(state, "continuous");
  assert.equal(shapesDivisionCount(state), 1);
  assert.equal(state.play.divisions, 16);
  assert.equal(state.voice.engine, "pm");
  assert.equal("noteDivisions" in state.voice, false);
  assert.equal("divisions" in state.trigger, false);
});

test("Triggers default to the live-switchable Rattlesnake sound bank", () => {
  const defaults = createShapesState();
  assert.equal(defaults.trigger.soundBank, "rattlesnake");
  assert.equal(
    createShapesState({ trigger: { soundBank: "fm-kit", mapping: "position" } }).trigger.soundBank,
    "fm-kit",
  );
  const sanitized = createShapesState({ trigger: { soundBank: "unknown", mapping: "incidence" } });
  assert.equal(sanitized.trigger.soundBank, "rattlesnake");
  assert.equal(sanitized.trigger.mapping, "incidence", "sound selection stays independent of mapping");
});

test("legacy mode-specific division values migrate into the shared grid", () => {
  assert.equal(createShapesState({
    selection: { playingMode: "notes" },
    voice: { noteDivisions: 9 },
    trigger: { divisions: 4 },
  }).play.divisions, 9);
  assert.equal(createShapesState({
    selection: { playingMode: "triggers" },
    voice: { noteDivisions: 9 },
    trigger: { divisions: 4 },
  }).play.divisions, 4);
});

test("legacy routes sanitize into the self-contained selection without page URLs", () => {
  assert.deepEqual(createShapesState({ geometry: "solid", sound: "drums" }).selection, {
    dimension: "3d",
    playingMode: "triggers",
    bank: "main",
  });
  assert.equal(createShapesState({ selection: { dimension: "bad", playingMode: "bad" } }).selection.dimension, "2d");
  const pingPong = createShapesState({ play: { continuousPhase: 1.25, motion: "pingpong" } });
  assertClose(displayShapesPhase(pingPong), 0.75, "ping-pong phase folds without overwriting travel");
});

test("the standalone scene router builds contacts for all three dimensions", () => {
  const state = createShapesState({ profile: { sides: 5, kind: "star", starDepth: 0.42 } });
  for (const dimension of ["2d", "3d", "4d"]) {
    selectShapesDimension(state, dimension);
    const scene = buildShapesScene(state);
    assert.equal(scene.dimension, dimension);
    assert.ok(scene.vertices.length > 0, `${dimension} has vertices`);
    assert.ok(scene.edges.length > 0, `${dimension} has edges`);
    assert.ok(Array.isArray(scene.contacts), `${dimension} has a contact list`);
    assert.ok(scene.contacts.every((contact) => (
      Number.isFinite(contact.pitch01)
      && Number.isFinite(contact.pan)
      && Number.isFinite(contact.drive01)
    )), `${dimension} contacts are audio-ready`);
  }
});

test("Divisions create visible semantic markers across 2D, 3D, and 4D", () => {
  const state = createShapesState({ profile: { sides: 6, kind: "polygon", starDepth: 0.48 } });
  const polygon = buildShapesScene(state);
  assert.equal(polygon.topologyEdgeCount, 6);
  assert.equal(buildShapesDivisionMarkers(polygon, 1).length, 0);
  const polygonMarkers = buildShapesDivisionMarkers(polygon, 4);
  assert.equal(polygonMarkers.length, 18, "four divisions add three markers to each of six sides");

  state.profile = { sides: 1, kind: "circle", starDepth: 0.48 };
  const circleMarkers = buildShapesDivisionMarkers(buildShapesScene(state), 4);
  assert.equal(circleMarkers.length, 3, "circles visibly divide their full contour");

  selectShapesDimension(state, "3d");
  state.dimension["3d"].representation = "cube";
  const solid = buildShapesScene(state);
  assert.equal(buildShapesDivisionMarkers(solid, 4).length, solid.edges.length * 3);

  selectShapesDimension(state, "4d");
  state.dimension["4d"].representation = "tesseract";
  const hyper = buildShapesScene(state);
  assert.equal(buildShapesDivisionMarkers(hyper, 4).length, hyper.edges.length * 3);

  state.dimension["4d"].representation = "hypersphere";
  assert.ok(
    buildShapesDivisionMarkers(buildShapesScene(state), 24).length <= 1600,
    "dense meshes keep their visible marker budget bounded",
  );

  for (const marker of [...polygonMarkers, ...circleMarkers, ...buildShapesDivisionMarkers(solid, 4), ...buildShapesDivisionMarkers(hyper, 4)]) {
    assert.ok(Number.isFinite(marker.view.x) && Number.isFinite(marker.view.y));
    assert.ok(Number.isFinite(marker.tangent.x) && Number.isFinite(marker.tangent.y));
  }
});

test("continuous voice identities and 3D framing stay stable while geometry moves", () => {
  const state = createShapesState();
  const first2d = buildShapesScene(state);
  state.dimension["2d"].rotation = 25;
  const rotated2d = buildShapesScene(state);
  assert.equal(first2d.contacts[0].voiceKey, rotated2d.contacts[0].voiceKey);

  selectShapesDimension(state, "3d");
  state.play.continuousPhase = 0.1;
  const early = buildShapesScene(state);
  state.play.continuousPhase = 0.9;
  const late = buildShapesScene(state);
  assert.deepEqual(early.bounds, late.bounds);
});

test("continuous 2D line contacts use the original directed full-side corner envelope", () => {
  const state = createShapesState({
    selection: { dimension: "2d", playingMode: "continuous" },
  });
  state.dimension["2d"].reader = "line";

  state.play.continuousPhase = 0.25;
  const midEdge = buildShapesScene(state);
  assert.equal(midEdge.contacts.length, 2);
  for (const contact of midEdge.contacts) {
    const direction = shapes2dContactContourDirection(contact, {
      reader: "line",
      intendedPhaseDirection: 1,
    });
    const profile = directedCornerEnvelopeProfile(midEdge.geometry, contact, direction);
    assertClose(
      1 - profile.phase,
      0.5,
      "the polygon envelope stays half-open at an edge midpoint",
    );
    assertClose(
      (0.18 + 0.5 * profile.strength) * (1 - profile.phase),
      0.215,
      "the original square midpoint has its original pre-scaling gain",
    );
  }

  state.play.continuousPhase = 0.5;
  const atCorners = buildShapesScene(state);
  assert.equal(atCorners.contacts.length, 2);
  for (const contact of atCorners.contacts) {
    const direction = shapes2dContactContourDirection(contact, {
      reader: "line",
      intendedPhaseDirection: 1,
    });
    const profile = directedCornerEnvelopeProfile(atCorners.geometry, contact, direction);
    assertClose(
      1 - profile.phase,
      1,
      "the polygon corner envelope opens at a corner",
    );
    assertClose(
      (0.18 + 0.5 * profile.strength) * (1 - profile.phase),
      0.43,
      "the original square corner has its original pre-scaling gain",
    );
  }

  state.profile = { sides: 1, kind: "circle", starDepth: 0.48 };
  const circle = buildShapesScene(state);
  assert.ok(circle.contacts.length > 0);
  assert.equal(circle.geometry.shapeType, "circle", "a cornerless circle uses its fixed sustained gain");
});

test("directed corner envelopes reverse across an edge and reset at each corner", () => {
  const state = createShapesState();
  state.dimension["2d"].reader = "points";
  state.play.continuousPhase = 0;
  const scene = buildShapesScene(state);
  const path = scene.geometry;
  const start = path.vertexDistances[0];
  const end = path.vertexDistances[1];
  const edgeLength = end - start;
  const contact = {
    ...scene.contacts[0],
    distance: start + edgeLength * 0.25,
  };

  assertClose(
    directedCornerEnvelopeProfile(path, contact, 1).phase,
    0.25,
    "forward traversal measures from the preceding corner",
  );
  assertClose(
    directedCornerEnvelopeProfile(path, contact, -1).phase,
    0.75,
    "reverse traversal measures from the following corner",
  );
  assertClose(
    directedCornerEnvelopeProfile(path, { ...contact, distance: start }, 1).phase,
    0,
    "a corner retriggers the forward envelope",
  );
  assert.ok(
    directedCornerEnvelopeProfile(path, { ...contact, distance: end - edgeLength * 1e-6 }, 1).phase
      > 0.999,
    "the envelope closes just before the following corner",
  );
});

test("2D contour direction follows reader motion and shape-relative rotation", () => {
  assert.equal(
    shapes2dContactContourDirection(
      { x: 1, y: 0, tangent: { x: 1, y: 0 }, scanAxis: "path" },
      { reader: "points", phaseRate: -0.2, rotationRate: 0.5, intendedPhaseDirection: 1 },
    ),
    -1,
    "point readers follow their contour and ignore shape rotation",
  );
  assert.equal(
    shapes2dContactContourDirection(
      { x: 0, y: 0, tangent: { x: -1, y: 0 }, scanAxis: "vertical" },
      { reader: "line", phaseRate: 0, rotationRate: 0, intendedPhaseDirection: 1 },
    ),
    -1,
    "a stopped line projects its intended motion onto each contact tangent",
  );
  assert.equal(
    shapes2dContactContourDirection(
      { x: 1, y: 0, tangent: { x: 0, y: -1 }, scanAxis: "vertical" },
      { reader: "line", phaseRate: 0, rotationRate: 0.25, intendedPhaseDirection: -1 },
    ),
    1,
    "shape rotation alone directs a line contact relative to the contour",
  );
  assert.equal(
    shapes2dContactContourDirection(
      { x: 1, y: 0, tangent: { x: 0, y: 1 }, scanAxis: "radial" },
      { reader: "radar", phaseRate: 0.25, rotationRate: 0, intendedPhaseDirection: 1 },
    ),
    1,
    "radar angular motion follows the local tangent",
  );
});

test("rotation-only playback retains the original stopped-reader envelope intent", () => {
  const state = createShapesState();
  state.dimension["2d"].reader = "line";
  state.dimension["2d"].rotationRunning = true;
  state.dimension["2d"].rotationSpeed = 0.12;
  state.play.running = false;
  state.play.continuousPhase = 0.125;
  const scene = buildShapesScene(state);
  assert.equal(scene.contacts.length, 2);
  for (const contact of scene.contacts) {
    const direction = shapes2dContactContourDirection(contact, {
      reader: "line",
      phaseRate: state.play.direction,
      rotationRate: state.dimension["2d"].rotationSpeed,
      intendedPhaseDirection: state.play.direction,
    });
    assertClose(
      directedCornerEnvelopeProfile(scene.geometry, contact, direction).phase,
      0.25,
      "shape rotation adds to, rather than replacing, stopped reader intent",
    );
  }
});

test("Notes and Triggers use the same visible subdivision regions", () => {
  const state = createShapesState();
  state.play.continuousPhase = 0.2;
  selectShapesPlayingMode(state, "notes");
  setShapesDivisionCount(state, 7);
  const noteScene = buildShapesScene(state);
  const noteToken = shapesEventToken(state, noteScene);
  selectShapesPlayingMode(state, "triggers");
  const triggerScene = buildShapesScene(state);
  const triggerToken = shapesEventToken(state, triggerScene);
  assert.deepEqual(shapesEventRegionKeys(noteScene), shapesEventRegionKeys(triggerScene));
  assert.equal(buildShapesDivisionMarkers(noteScene, shapesDivisionCount(state)).length, 24);
  assert.equal(buildShapesDivisionMarkers(triggerScene, shapesDivisionCount(state)).length, 24);
  assert.notEqual(noteToken, triggerToken, "mode remains part of debounce/routing identity");
});

test("transport events follow visible subdivision regions", () => {
  const state = createShapesState({ profile: { sides: 6, kind: "polygon", starDepth: 0.48 } });
  selectShapesPlayingMode(state, "triggers");
  state.play.running = true;

  for (const divisions of [1, 2, 4, 8]) {
    setShapesDivisionCount(state, divisions);
    let previousToken = null;
    let tokenRegions = 0;
    for (let step = 0; step < 2400; step += 1) {
      state.play.continuousPhase = step / 2400;
      const token = shapesEventToken(state, buildShapesScene(state));
      if (token !== previousToken) tokenRegions += 1;
      previousToken = token;
    }
    assert.equal(
      tokenRegions,
      state.profile.sides * divisions,
      `${divisions} divisions produce exactly ${divisions} events on every side`,
    );
  }

  setShapesDivisionCount(state, 2);
  state.play.continuousPhase = 0.01;
  const firstHalfSide = shapesEventToken(state, buildShapesScene(state));
  state.play.continuousPhase = 0.04;
  state.dimension["2d"].rotation += 10;
  assert.equal(
    shapesEventToken(state, buildShapesScene(state)),
    firstHalfSide,
    "contact and rotation changes cannot add hidden events inside one division",
  );
  state.play.continuousPhase = 0.09;
  assert.notEqual(
    shapesEventToken(state, buildShapesScene(state)),
    firstHalfSide,
    "the midpoint starts the second division",
  );

  state.play.running = false;
  const pausedToken = shapesEventToken(state, buildShapesScene(state));
  state.dimension["2d"].rotation += 10;
  assert.equal(
    shapesEventToken(state, buildShapesScene(state)),
    pausedToken,
    "rotation within the same visible side region cannot invent a trigger",
  );

  state.play.running = true;
  state.play.motion = "pingpong";
  state.play.continuousPhase = 0.9999;
  const beforeTurn = shapesEventToken(state, buildShapesScene(state));
  state.play.continuousPhase = 1;
  const atTurn = shapesEventToken(state, buildShapesScene(state));
  state.play.continuousPhase = 1.0001;
  assert.notEqual(atTurn, beforeTurn, "the ping-pong endpoint is one division boundary");
  assert.notEqual(
    shapesEventToken(state, buildShapesScene(state)),
    atTurn,
    "folding away from the closed-path seam re-enters the visible final side region",
  );
});

test("event routing changes only when visible contact regions change", () => {
  const state = createShapesState({ selection: { dimension: "3d", playingMode: "triggers" } });
  state.dimension["3d"].representation = "cube";
  const originalScene = buildShapesScene(state);
  const originalToken = shapesEventToken(state, originalScene);
  state.profile.sides = 31;
  assert.equal(shapesEventToken(state, buildShapesScene(state)), originalToken);

  state.dimension["3d"].rotation.y += 10;
  assert.equal(
    shapesEventToken(state, buildShapesScene(state)),
    originalToken,
    "small rotations inside the same edge segments stay silent",
  );
  let changedToken = originalToken;
  for (let angle = 20; angle <= 180 && changedToken === originalToken; angle += 10) {
    state.dimension["3d"].rotation.y = 36 + angle;
    changedToken = shapesEventToken(state, buildShapesScene(state));
  }
  assert.notEqual(changedToken, originalToken, "a real edge-segment crossing changes the event token");
  state.trigger.hitCap = 16;
  assert.equal(shapesEventIntervalMs(state, 16), 224);
  selectShapesPlayingMode(state, "notes");
  assert.equal(shapesEventIntervalMs(state, 8), 112);
});

test("2D line, cube, and tesseract event clocks are derived from contact marker regions", () => {
  const cases = [
    { dimension: "2d", representation: null, reader: "line" },
    { dimension: "3d", representation: "cube" },
    { dimension: "4d", representation: "tesseract" },
  ];
  for (const fixture of cases) {
    const state = createShapesState({ selection: { dimension: fixture.dimension, playingMode: "triggers" } });
    setShapesDivisionCount(state, 2);
    if (fixture.reader) state.dimension["2d"].reader = fixture.reader;
    if (fixture.representation) state.dimension[fixture.dimension].representation = fixture.representation;
    let previousToken = null;
    let previousRegions = null;
    let sawIrregularBoundary = false;
    for (let step = 0; step < 1000; step += 1) {
      state.play.continuousPhase = step / 1000;
      const scene = buildShapesScene(state);
      const regions = shapesEventRegionKeys(scene);
      const token = shapesEventToken(state, scene);
      if (previousToken !== null) {
        assert.equal(
          token !== previousToken,
          regions.join("|") !== previousRegions.join("|"),
          `${fixture.dimension} token mirrors visible contact regions`,
        );
        if (token !== previousToken && step % 125 !== 0) sawIrregularBoundary = true;
      }
      previousToken = token;
      previousRegions = regions;
    }
    assert.ok(sawIrregularBoundary, `${fixture.dimension} uses geometry crossings rather than uniform phase ticks`);
  }
});
