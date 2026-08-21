import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";
import {
  STRIPED_STAIRCASE_DEFAULTS,
  STRIPED_STAIRCASE_VIEWS,
  advancePingPong,
  cameraAtStaircaseDepth,
  cameraFromView,
  complexPointAt,
  createStaircaseFrame,
  staircaseBoundaries,
  viewById,
  zoomCameraAt,
} from "../src/striped-staircase.js";
import {
  analyzeStaircaseBlobs,
  contourVoiceTrajectory,
  createStaircaseShapeField,
  staircaseDepthContourContacts,
  staircaseGeometryRate,
  staircaseStepWeights,
  voicesForStaircaseContacts,
  voicesForStaircaseBlobs,
} from "../src/striped-staircase-audio.js";

const root = new URL("../", import.meta.url);

test("striped staircase keeps continuous, strictly increasing exponential depth bands", () => {
  const boundaries = staircaseBoundaries(STRIPED_STAIRCASE_DEFAULTS);
  assert.equal(boundaries.length, STRIPED_STAIRCASE_DEFAULTS.steps + 1);
  assert.equal(boundaries[0], STRIPED_STAIRCASE_DEFAULTS.startIteration);
  assert.equal(boundaries.at(-1), STRIPED_STAIRCASE_DEFAULTS.maxIterations);
  for (let index = 1; index < boundaries.length; index += 1) {
    assert.ok(boundaries[index] > boundaries[index - 1]);
  }
  assert.ok(
    boundaries[2] - boundaries[1] < boundaries.at(-1) - boundaries.at(-2),
    "the 1.7 curve should allocate wider intervals at deeper escape depth",
  );
});

test("step and slide frames share one stable control-rate model", () => {
  const steps = createStaircaseFrame(0.5, STRIPED_STAIRCASE_DEFAULTS, "steps");
  const slide = createStaircaseFrame(0.5, STRIPED_STAIRCASE_DEFAULTS, "slide");
  assert.equal(steps.stepNumber, 13);
  assert.equal(steps.bandLow, steps.renderLow);
  assert.equal(steps.bandHigh, steps.renderHigh);
  assert.equal(slide.motionMode, "slide");
  assert.ok(slide.renderLow < slide.renderHigh);

  const finalFrame = createStaircaseFrame(1, STRIPED_STAIRCASE_DEFAULTS, "steps");
  assert.equal(finalFrame.stepIndex, STRIPED_STAIRCASE_DEFAULTS.steps - 1);
  assert.equal(finalFrame.stepPhase, 1);
  assert.equal(finalFrame.bandHigh, STRIPED_STAIRCASE_DEFAULTS.maxIterations);
});

test("transport reflects cleanly at both ends instead of jumping across the staircase", () => {
  assert.deepEqual(advancePingPong(0.98, 1, 0.05), {
    progress: 0.97,
    direction: -1,
  });
  assert.deepEqual(advancePingPong(0.02, -1, 0.05), {
    progress: 0.030000000000000002,
    direction: 1,
  });
});

test("shape time accelerates through deeper staircase bands without changing total cycle time", () => {
  const weights = staircaseStepWeights(STRIPED_STAIRCASE_DEFAULTS);
  assert.equal(weights.length, STRIPED_STAIRCASE_DEFAULTS.steps);
  assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.ok(weights[0] > weights.at(-1), "deep steps should receive less time");
  assert.ok(
    staircaseGeometryRate(0.95, STRIPED_STAIRCASE_DEFAULTS)
      > staircaseGeometryRate(0.05, STRIPED_STAIRCASE_DEFAULTS),
    "deep traversal should be faster",
  );
});

test("blob analysis turns connected Mandelbrot regions into spatial voices", () => {
  const camera = cameraFromView(viewById("overview"));
  const frame = createStaircaseFrame(0.2, STRIPED_STAIRCASE_DEFAULTS, "steps");
  const blobs = analyzeStaircaseBlobs(
    camera,
    frame.bandLow,
    frame.bandHigh,
    STRIPED_STAIRCASE_DEFAULTS.maxIterations,
    { width: 56, height: 36 },
  );
  assert.ok(blobs.length > 0);
  assert.ok(blobs.every((blob) => blob.area > 0 && blob.x >= 0 && blob.x <= 1));
  const strikes = voicesForStaircaseBlobs(blobs, frame);
  assert.equal(strikes.length, blobs.length);
  assert.ok(strikes.every(({ voice, envelope }) =>
    voice.frequency > 0
      && voice.pan >= -1
      && voice.pan <= 1
      && envelope.decaySeconds > 0));
});

test("the synchronized playhead follows the wavy depth contour and its branches", () => {
  const frame = createStaircaseFrame(0.2, STRIPED_STAIRCASE_DEFAULTS, "steps");
  const field = createStaircaseShapeField(
    cameraFromView(viewById("overview")),
    frame.bandLow,
    frame.bandHigh,
    STRIPED_STAIRCASE_DEFAULTS.maxIterations,
    { width: 56, height: 36 },
  );
  const thresholds = Array.from({ length: 24 }, (_, index) =>
    frame.renderLow + (frame.renderHigh - frame.renderLow) * ((index + 0.5) / 24));
  const contours = thresholds.map((threshold, index) =>
    staircaseDepthContourContacts(field, threshold, (index + 0.5) / 24));
  const active = contours.find((contour) => contour.runs.length > 0);
  assert.ok(active, "the animated escape-depth contour should have at least one branch");
  assert.equal(active.edges.length, active.runs.length);
  assert.ok(active.runs.every((branch) => branch.length > 0 && branch.depth === active.threshold));
  const fill = voicesForStaircaseContacts(active, frame, {}, "fill");
  const edge = voicesForStaircaseContacts(active, frame, {}, "edge");
  assert.equal(fill.length, active.runs.length);
  assert.equal(edge.length, active.edges.length);
  assert.ok(fill.every((voice) => voice.mode === "fm"));
  assert.ok(edge.every((voice) => voice.mode === "pm"));
});

test("larger blobs map below smaller blobs while contour changes modulation", () => {
  const frame = createStaircaseFrame(0.4, STRIPED_STAIRCASE_DEFAULTS, "steps");
  const contacts = {
    phase: 0.5,
    runs: [
      { area: 0.3, size: 0.7, y: 0.5, edgeRatio: 0.1 },
      { area: 0.01, size: 0.12, y: 0.5, edgeRatio: 0.8 },
    ],
    edges: [],
  };
  const [large, small] = voicesForStaircaseContacts(contacts, frame, {}, "fill");
  assert.ok(large.frequency < small.frequency, "the tuba-sized blob should be lower");
  assert.ok(large.gainSmoothingSeconds > small.gainSmoothingSeconds);
  assert.ok(small.modulationIndex > large.modulationIndex);
});

test("disappearing contour branches release instead of becoming permanent drones", () => {
  const current = [
    { key: "branch:a", frequency: 90, gain: 0.2 },
    { key: "branch:b", frequency: 180, gain: 0.12 },
  ];
  const future = [
    { key: "branch:b", frequency: 190, gain: 0.1 },
    { key: "branch:c", frequency: 360, gain: 0.08 },
  ];
  const trajectory = contourVoiceTrajectory(current, future);
  assert.deepEqual(trajectory.current, current);
  assert.deepEqual(trajectory.future.map(({ key, gain }) => ({ key, gain })), [
    { key: "branch:a", gain: 0 },
    { key: "branch:b", gain: 0.1 },
  ]);

  const contacts = {
    phase: 0.5,
    runs: [{ key: "depth-branch:loop:6:4:2:2:0", area: 0.2, size: 0.4, x: 0.5, y: 0.5, edgeRatio: 0.2 }],
    edges: [],
  };
  const firstStep = createStaircaseFrame(0.1, STRIPED_STAIRCASE_DEFAULTS, "steps");
  const nextStep = createStaircaseFrame(0.2, STRIPED_STAIRCASE_DEFAULTS, "steps");
  const firstKey = voicesForStaircaseContacts(contacts, firstStep, {}, "fill")[0].key;
  const nextKey = voicesForStaircaseContacts(contacts, nextStep, {}, "fill")[0].key;
  assert.notEqual(firstKey, nextKey, "the discrete staircase boundary must release the old voice");
});

test("archived fractal coloring ideas become distinct continuous sound mappings", () => {
  const frame = createStaircaseFrame(0.4, STRIPED_STAIRCASE_DEFAULTS, "steps");
  const contacts = {
    phase: 0.7,
    runs: [{
      componentIndex: 3,
      area: 0.12,
      size: 0.4,
      x: 0.7,
      y: 0.3,
      edgeRatio: 0.72,
    }],
    edges: [],
  };
  const mapping = { transportProgress: 0.4, transportRate: 0.035 };
  const voice = (colorSoundMode) => voicesForStaircaseContacts(
    contacts,
    frame,
    { ...mapping, colorSoundMode },
    "fill",
  )[0];

  assert.equal(voice("shepard").mode, "shepard");
  assert.ok(Number.isFinite(voice("shepard").shepardTravel));
  assert.equal(voice("ouroboros").mode, "pm");
  assert.equal(voice("rattlesnake").mode, "fm");
  assert.equal(voice("decomposition").pan, 0.612);
  assert.equal(voice("ink").modulationIndex, 0);
});

test("pointer-centered zoom keeps the complex coordinate under the pointer fixed", () => {
  const camera = cameraFromView(viewById("seahorse"));
  const pointer = { x: 0.79, y: 0.22 };
  const aspect = 16 / 9;
  const before = complexPointAt(camera, pointer, aspect);
  const zoomed = zoomCameraAt(camera, pointer, 0.48, aspect);
  const after = complexPointAt(zoomed, pointer, aspect);
  assert.ok(Math.abs(before.x - after.x) < 1e-12);
  assert.ok(Math.abs(before.y - after.y) < 1e-12);
  assert.ok(zoomed.scale < camera.scale);
});

test("depth zoom follows the same anchored path inward and outward", () => {
  const base = cameraFromView(viewById("seahorse"));
  const beginning = cameraAtStaircaseDepth(base, 0, 6);
  const deepest = cameraAtStaircaseDepth(base, 1, 6);
  const returning = cameraAtStaircaseDepth(base, 0, 6);
  assert.deepEqual(beginning, returning);
  assert.equal(deepest.centerX, base.centerX);
  assert.equal(deepest.centerY, base.centerY);
  assert.ok(deepest.scale < base.scale / 60);
});

test("the view atlas includes the earlier Codex fractal landmarks", () => {
  assert.equal(STRIPED_STAIRCASE_VIEWS.length, 17);
  const ids = STRIPED_STAIRCASE_VIEWS.map(({ id }) => id);
  for (const id of [
    "seahorse", "overview", "elephant-archive", "triple-spiral",
    "airplane", "antenna", "needle", "dendrite-needle",
  ]) assert.ok(ids.includes(id), `${id} should remain in the location atlas`);
  assert.equal(viewById("spiral").centerX, -0.761574);
  assert.equal(viewById("spiral").centerY, -0.0847596);
  assert.equal(viewById("needle").centerX, -1.25066);
  assert.equal(viewById("needle").centerY, 0.02012);
  assert.equal(viewById("triple-spiral").centerX, -0.088);
  assert.equal(viewById("dendrite-needle").centerY, 0.9563);
});

test("the Morphazoid page is audible, navigable, and publishable", async () => {
  const [html, css, app, core, audioSource, buildScript, icon] = await Promise.all([
    readFile(new URL("striped-staircase.html", root), "utf8"),
    readFile(new URL("striped-staircase.css", root), "utf8"),
    readFile(new URL("striped-staircase-app.js", root), "utf8"),
    readFile(new URL("src/striped-staircase.js", root), "utf8"),
    readFile(new URL("src/striped-staircase-audio.js", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
    stat(new URL("assets/instruments/striped-staircase.webp", root)),
  ]);

  assert.match(html, /<canvas[\s\S]*id="stage"[\s\S]*aria-describedby=/);
  assert.match(html, /data-mode="steps"[\s\S]*data-mode="slide"/);
  assert.match(html, /id="depthRail"/);
  assert.match(html, /data-reset-all data-reset-in-place/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="striped-staircase-app\.js"/);
  assert.match(html, /class="audio-strip"/);
  assert.match(html, /id="audioButton"/);
  assert.match(html, /data-timing="equal"[\s\S]*data-timing="geometry"[\s\S]*data-timing="dive"/);
  assert.match(html, /data-palette="glass"[\s\S]*data-palette="ink"/);
  assert.match(html, /data-playback="fill"[\s\S]*data-playback="ensemble"/);
  assert.match(html, /id="viewPreset"[\s\S]*value="dendrite-needle"/);
  assert.match(html, /id="colorSoundMode"[\s\S]*value="shepard"[\s\S]*value="ouroboros"[\s\S]*value="rattlesnake"[\s\S]*value="decomposition"/);
  assert.match(css, /\.striped-staircase-shell/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(app, /morphazoid:striped-staircase-step/);
  assert.match(app, /createStaircaseShapeField/);
  assert.match(app, /voicesForStaircaseContacts/);
  assert.doesNotMatch(app, /staircaseLineContacts|soundField\.columns/);
  assert.doesNotMatch(core, /u_playheadPhase|shapePlayhead/);
  assert.match(audioSource, /staircaseDepthContourContacts/);
  assert.match(app, /ResizeObserver/);
  assert.match(app, /pointerdown/);
  assert.match(core, /class StripedStaircaseRenderer/);
  assert.match(core, /u_fieldCenter/);
  assert.match(buildScript, /striped-staircase\.html/);
  assert.ok(icon.size > 1_000);

  const tool = TOOL_GROUPS
    .flatMap((group) => group.tools)
    .find(({ id }) => id === "striped-staircase");
  assert.deepEqual(tool, {
    id: "striped-staircase",
    label: "Striped Staircase",
    href: "striped-staircase.html",
  });
});
