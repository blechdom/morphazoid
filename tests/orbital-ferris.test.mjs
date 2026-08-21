import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ORBITAL_FERRIS_DEFAULTS,
  ORBITAL_FERRIS_GESTURE_SHAPES,
  ORBITAL_FERRIS_LEVEL_SHAPES,
  ORBITAL_FERRIS_MAX_LEAVES,
  ORBITAL_FERRIS_PROCESSORS,
  advanceOrbitalFerrisMotion,
  orbitalFerrisContourProgress,
  orbitalFerrisContourSample,
  orbitalFerrisDelayForScene,
  orbitalFerrisLeafCount,
  orbitalFerrisLevelRate,
  orbitalFerrisOrbitSample,
  orbitalFerrisPitchAtY,
  orbitalFerrisScene,
  orbitalFerrisShapeSample,
  orbitalFerrisVoiceModulation,
} from "../src/orbital-ferris.js";

const root = new URL("../", import.meta.url);
const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
};

test("Feral Fairy Ferris Ferry defaults to one voice across three paused levels", () => {
  assert.equal(ORBITAL_FERRIS_DEFAULTS.playing, false);
  assert.equal(ORBITAL_FERRIS_DEFAULTS.gestures, 1);
  assert.equal(ORBITAL_FERRIS_DEFAULTS.levels, 3);
  assert.equal(ORBITAL_FERRIS_DEFAULTS.gestureSeconds, 4);
  assert.equal(ORBITAL_FERRIS_DEFAULTS.gestureMode, "loop");
  assert.equal(ORBITAL_FERRIS_DEFAULTS.pitchSpan, 4);
  assert.deepEqual(ORBITAL_FERRIS_DEFAULTS.levelEnabled, [true, true, true, true, true]);
  assert.deepEqual(ORBITAL_FERRIS_DEFAULTS.levelShapes, [
    "circle",
    "triangle",
    "square",
    "line",
    "star",
  ]);
  assert.deepEqual(ORBITAL_FERRIS_DEFAULTS.levelProcessors, [
    "voice",
    "modulator",
    "delay",
    "pass",
    "pass",
  ]);
  assert.deepEqual(ORBITAL_FERRIS_PROCESSORS, ["pass", "modulator", "delay"]);
});

test("level paths sample circles, polygons, lines, and stars", () => {
  assert.deepEqual(ORBITAL_FERRIS_LEVEL_SHAPES, [
    "circle",
    "triangle",
    "square",
    "line",
    "star",
  ]);
  assert.deepEqual(ORBITAL_FERRIS_GESTURE_SHAPES, [
    "circle",
    "triangle",
    "square",
    "star",
  ]);
  closeTo(orbitalFerrisShapeSample("circle", 0).x, 1);
  closeTo(orbitalFerrisShapeSample("triangle", 0).y, -1);
  closeTo(orbitalFerrisShapeSample("square", 0.25).x, 1);
  closeTo(orbitalFerrisShapeSample("line", 0).x, -1);
  closeTo(orbitalFerrisShapeSample("line", 1).x, 1);
  closeTo(orbitalFerrisShapeSample("star", 0).y, -1);
  closeTo(orbitalFerrisOrbitSample("line", 0).x, -1);
  closeTo(orbitalFerrisOrbitSample("line", 0.5).x, 1);
  closeTo(orbitalFerrisOrbitSample("line", 0.75).x, 0);
});

test("recursive leaf counts retain the 128-gesture render guard", () => {
  assert.equal(orbitalFerrisLeafCount(6, 1), 1);
  assert.equal(orbitalFerrisLeafCount(3, 3), 9);
  assert.equal(orbitalFerrisLeafCount(6, 5), ORBITAL_FERRIS_MAX_LEAVES);
});

test("inner levels move around their paths faster while disabled levels remain frozen", () => {
  closeTo(orbitalFerrisLevelRate(0.1, 3, 4, 4), 0.1);
  closeTo(orbitalFerrisLevelRate(0.1, 3, 4, 3), 0.3);
  closeTo(orbitalFerrisLevelRate(0.1, 3, 4, 2), 0.9);

  const motion = advanceOrbitalFerrisMotion({
    dt: 0.05,
    levelPhases: [0, 0, 0, 0],
    levelEnabled: [true, true, false, true, true],
    levels: 3,
    outerRate: 0.1,
    ratio: 3,
    rotationPlaying: true,
    gestureTravel: 0,
    gestureSeconds: 4,
    gesturePlaying: false,
  });
  closeTo(motion.levelPhases[0], 0.015);
  closeTo(motion.levelPhases[1], 0);
  closeTo(motion.gestureTravel, 0);
});

test("gesture travel advances independently from paused orbital rotation", () => {
  const motion = advanceOrbitalFerrisMotion({
    dt: 0.05,
    levelPhases: [0.2, 0.4, 0, 0],
    levelEnabled: [true, true, true, true, true],
    levels: 3,
    outerRate: 0.1,
    ratio: 3,
    rotationPlaying: false,
    gestureTravel: 0.5,
    gestureSeconds: 4,
    gesturePlaying: true,
  });
  closeTo(motion.levelPhases[0], 0.2);
  closeTo(motion.levelPhases[1], 0.4);
  closeTo(motion.levelPhases[2], 0);
  closeTo(motion.levelPhases[3], 0);
  closeTo(motion.gestureTravel, 0.5125);
});

test("loop and back-and-forth modes traverse the same circle differently", () => {
  closeTo(orbitalFerrisContourProgress(1.25, "loop"), 0.25);
  closeTo(orbitalFerrisContourProgress(0.5, "bounce"), 0.5);
  closeTo(orbitalFerrisContourProgress(1, "bounce"), 1);
  closeTo(orbitalFerrisContourProgress(1.5, "bounce"), 0.5);
  closeTo(orbitalFerrisContourProgress(2, "bounce"), 0);

  const top = orbitalFerrisContourSample(0, "loop");
  closeTo(top.x, 0);
  closeTo(top.y, -1);
  const right = orbitalFerrisContourSample(0.25, "loop");
  closeTo(right.x, 1);
  closeTo(right.y, 0);
  assert.equal(orbitalFerrisContourSample(1.25, "bounce").direction, -1);
});

test("nested orbit geometry carries playheads through whole-stage coordinates", () => {
  const still = orbitalFerrisScene({
    gestures: 1,
    levels: 3,
    ratio: 3,
    levelPhases: [0, 0],
    levelEnabled: [true, true, true],
    levelShapes: ["circle", "circle", "circle"],
    gestureTravel: 0,
    gestureMode: "loop",
  });
  const carriedDown = orbitalFerrisScene({
    gestures: 1,
    levels: 3,
    ratio: 3,
    levelPhases: [0, 0.25],
    levelEnabled: [true, true, true],
    levelShapes: ["circle", "circle", "circle"],
    gestureTravel: 0,
    gestureMode: "loop",
  });

  assert.equal(still.gestures.length, 1);
  assert.equal(still.rings.length, 2);
  assert.ok(carriedDown.gestures[0].playheadY > still.gestures[0].playheadY);
  assert.ok(
    orbitalFerrisPitchAtY(carriedDown.gestures[0].playheadY, 110, 4)
      < orbitalFerrisPitchAtY(still.gestures[0].playheadY, 110, 4),
  );
});

test("each recursive level moves its children around its own stationary perimeter", () => {
  const start = orbitalFerrisScene({
    gestures: 1,
    levels: 3,
    ratio: 3,
    levelPhases: [0, 0],
    levelEnabled: [true, true, true],
    levelShapes: ["circle", "square", "triangle"],
    gestureTravel: 0,
    gestureMode: "loop",
  });
  const moved = orbitalFerrisScene({
    gestures: 1,
    levels: 3,
    ratio: 3,
    levelPhases: [0.125, 1 / 6],
    levelEnabled: [true, true, true],
    levelShapes: ["circle", "square", "triangle"],
    gestureTravel: 0,
    gestureMode: "loop",
  });
  assert.equal(start.rings.find((ring) => ring.level === 3)?.shape, "triangle");
  assert.ok(start.rings.filter((ring) => ring.level === 2).every((ring) => (
    ring.shape === "square"
  )));
  assert.notEqual(moved.rings.find((ring) => ring.level === 2).x, 0);
  assert.notEqual(moved.gestures[0].playheadY, start.gestures[0].playheadY);
  assert.equal("rotation" in moved.rings[0], false);
});

test("leaf playheads traverse selectable triangle and star contours", () => {
  const triangle = orbitalFerrisContourSample(1 / 3, "loop", 0, "triangle");
  closeTo(triangle.x, Math.sqrt(3) / 2);
  closeTo(triangle.y, 0.5);

  const scene = orbitalFerrisScene({
    gestures: 1,
    levels: 1,
    ratio: 3,
    levelPhases: [],
    levelEnabled: [true],
    levelShapes: ["star"],
    gestureTravel: 0,
    gestureMode: "loop",
  });
  assert.equal(scene.gestures[0].shape, "star");
  closeTo(scene.gestures[0].sample.y, -1);
});

test("higher-level positions are inherited by lower processors", () => {
  const makeScene = (outerPhase) => orbitalFerrisScene({
    gestures: 1,
    levels: 3,
    ratio: 3,
    levelPhases: [0, outerPhase],
    levelEnabled: [true, true, true],
    levelShapes: ["circle", "triangle", "square"],
    gestureTravel: 0,
    gestureMode: "loop",
  });
  const processors = ["voice", "modulator", "delay"];
  const enabled = [true, true, true];
  const start = makeScene(0);
  const moved = makeScene(0.5);

  assert.deepEqual(start.gestures[0].ancestors.map(({ level }) => level), [3, 2]);
  assert.notEqual(
    start.gestures[0].ancestors.find(({ level }) => level === 2).y,
    moved.gestures[0].ancestors.find(({ level }) => level === 2).y,
  );
  assert.notEqual(
    orbitalFerrisVoiceModulation(start.gestures[0], processors, enabled),
    orbitalFerrisVoiceModulation(moved.gestures[0], processors, enabled),
  );
  assert.notDeepEqual(
    orbitalFerrisDelayForScene(start, processors, enabled),
    orbitalFerrisDelayForScene(moved, processors, enabled),
  );
  assert.deepEqual(
    orbitalFerrisDelayForScene(start, ["voice", "pass", "pass"], enabled),
    { delayTime: 0.18, feedback: 0, wet: 0 },
  );
});

test("pitch maps directly from top, center, and bottom viewport positions", () => {
  closeTo(orbitalFerrisPitchAtY(-1, 110, 4), 440);
  closeTo(orbitalFerrisPitchAtY(0, 110, 4), 110);
  closeTo(orbitalFerrisPitchAtY(1, 110, 4), 27.5);
});

test("Feral Fairy Ferris Ferry exposes one transport and assignable level processors", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("orbital-ferris.html", root), "utf8"),
    readFile(new URL("experiments-app.js", root), "utf8"),
    readFile(new URL("experiments.css", root), "utf8"),
  ]);

  assert.match(html, /<title>Feral Fairy Ferris Ferry - Morphazoid<\/title>/);
  assert.match(html, /id="orbitalMasterPlay"[^>]*data-primary-transport/);
  assert.doesNotMatch(html, /id="orbitalRotationPlay"|id="orbitalGesturePlay"/);
  assert.ok(html.indexOf('id="orbitalMasterPlay"') < html.indexOf('id="gestureTitle"'));
  assert.match(html, /id="orbitalGestureSeconds"[^>]*min="0\.1"[^>]*max="4"[^>]*value="4"/);
  assert.match(html, /id="orbitalGestures"[^>]*value="1"/);
  assert.match(html, /id="orbitalLevels"[^>]*min="1"[^>]*max="5"[^>]*value="3"/);
  assert.equal((html.match(/data-orbital-level="[1-5]"/g) ?? []).length, 5);
  assert.equal((html.match(/data-orbital-shape="[1-5]"/g) ?? []).length, 5);
  assert.equal((html.match(/data-orbital-processor="[1-5]"/g) ?? []).length, 5);
  assert.equal((html.match(/<option value="line"/g) ?? []).length, 4);
  assert.match(html, /data-orbital-motion="loop"/);
  assert.match(html, /data-orbital-motion="bounce"/);
  assert.match(html, /id="orbitalLevelOneOnly"/);
  assert.match(html, /data-orbital-processor="2"[\s\S]*value="modulator" selected/);
  assert.match(html, /data-orbital-processor="3"[\s\S]*value="delay" selected/);
  assert.match(html, />Triangle<\/option>[\s\S]*>Star<\/option>/);
  assert.match(html, /id="orbitalPitchSpan"[^>]*value="4"/);
  assert.match(app, /traceOrbitalGesturePath/);
  assert.match(app, /orbitalFerrisPitchAtY\([\s\S]*gesture\.playheadY/);
  assert.match(app, /pan: clamp\(gesture\.playheadX/);
  assert.match(app, /traceOrbitalFerrisRing/);
  assert.match(app, /state\.orbitalLevelShapes\[index\] = select\.value/);
  assert.match(app, /state\.orbitalLevelProcessors\[index\] = select\.value/);
  assert.match(app, /audio\.setOrbitalDelay\(orbitalFerrisDelayForScene/);
  assert.match(app, /orbitalFerrisVoiceModulation\(/);
  assert.match(app, /if \(!orbitalFerrisLevelOnePlaying\(\)\) return \[\]/);
  assert.match(app, /state\.orbitalLevelEnabled\.fill\(false\)/);
  assert.match(app, /state\.orbitalLevelEnabled\[0\] = true/);
  assert.match(app, /state\.orbitalPlaying = true/);
  assert.doesNotMatch(app, /orbitalRotationPlaying|orbitalGesturePlaying/);
  assert.doesNotMatch(app, /orbitalModDepth/);
  assert.match(css, /\.orbital-master-row\s*\{/);
  assert.match(css, /\.orbital-level-grid\s*\{/);
  assert.match(css, /\.orbital-level-selects\s*\{/);
});
