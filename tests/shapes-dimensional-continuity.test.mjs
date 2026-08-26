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
  selectShapesDimension,
  selectShapesPlayingMode,
  setShapesDivisionCount,
  shapesDivisionCount,
  shapesEventIntervalMs,
  shapesEventToken,
} from "../src/shapes-state.js";
import {
  normalizeSharedProfile,
  sharedProfilePoints,
} from "../src/shapes-profile.js";
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
    const solid = buildShapesScene(state);
    assert.equal(solid.geometry.type, "profile");
    assert.equal(solid.geometry.profile.kind, profile.kind);
    assert.equal(solid.geometry.vertices.length, solid.geometry.profile.points.length * 2);
    selectShapesDimension(state, "4d");
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

test("Continuous, Notes, and Triggers do not overwrite voice or trigger namespaces", () => {
  const state = createShapesState();
  state.voice.engine = "pm";
  state.voice.character = 0.82;
  state.trigger.mapping = "incidence";
  state.trigger.divisions = 13;

  assert.equal(shapesDivisionCount(state), 1, "Continuous has no divisions");
  setShapesDivisionCount(state, 21);
  assert.equal(state.voice.noteDivisions, 8, "hidden Continuous control cannot overwrite Notes");
  assert.equal(state.trigger.divisions, 13, "hidden Continuous control cannot overwrite Triggers");
  selectShapesPlayingMode(state, "notes");
  assert.equal(shapesDivisionCount(state), 8);
  setShapesDivisionCount(state, 11);
  assert.equal(state.voice.noteDivisions, 11);
  assert.equal(state.voice.engine, "pm");
  selectShapesPlayingMode(state, "triggers");
  assert.equal(shapesDivisionCount(state), 13);
  setShapesDivisionCount(state, 15);
  assert.equal(state.trigger.divisions, 15);
  assert.equal(state.trigger.mapping, "incidence");
  assert.equal(state.voice.noteDivisions, 11);
  assert.equal(state.voice.character, 0.82);
  selectShapesPlayingMode(state, "continuous");
  assert.equal(shapesDivisionCount(state), 1);
  assert.equal(state.voice.engine, "pm");
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

test("event routing has independent note and trigger subdivision semantics", () => {
  const state = createShapesState();
  state.play.continuousPhase = 0.2;
  state.voice.noteDivisions = 8;
  state.trigger.divisions = 3;
  selectShapesPlayingMode(state, "notes");
  const noteScene = buildShapesScene(state);
  const noteToken = shapesEventToken(state, noteScene);
  selectShapesPlayingMode(state, "triggers");
  const triggerToken = shapesEventToken(state, buildShapesScene(state));
  assert.notEqual(noteToken, triggerToken);
  assert.match(noteToken, /^2d:/);
  assert.match(triggerToken, /^2d:/);
});

test("event routing follows visible topology and rotation within a bounded emission rate", () => {
  const state = createShapesState({ selection: { dimension: "3d", playingMode: "triggers" } });
  state.dimension["3d"].representation = "cube";
  const originalScene = buildShapesScene(state);
  const originalToken = shapesEventToken(state, originalScene);
  state.profile.sides = 31;
  assert.equal(shapesEventToken(state, buildShapesScene(state)), originalToken);

  state.dimension["3d"].rotation.y += 10;
  assert.notEqual(shapesEventToken(state, buildShapesScene(state)), originalToken);
  state.trigger.hitCap = 16;
  assert.equal(shapesEventIntervalMs(state, 16), 224);
  selectShapesPlayingMode(state, "notes");
  assert.equal(shapesEventIntervalMs(state, 8), 112);
});
