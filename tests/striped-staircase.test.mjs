import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";
import {
  STRIPED_STAIRCASE_DEFAULTS,
  STRIPED_STAIRCASE_VIEWS,
  advancePingPong,
  cameraFromView,
  complexPointAt,
  createStaircaseFrame,
  staircaseBoundaries,
  viewById,
  zoomCameraAt,
} from "../src/striped-staircase.js";

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

test("famous view names and coordinates remain aligned with their source browser", () => {
  assert.deepEqual(
    STRIPED_STAIRCASE_VIEWS.map(({ id, label }) => ({ id, label })),
    [
      { id: "seahorse", label: "Seahorse" },
      { id: "overview", label: "Whole set" },
      { id: "spiral", label: "Spiral arms" },
      { id: "needle", label: "Mini set" },
    ],
  );
  assert.equal(viewById("spiral").centerX, -0.761574);
  assert.equal(viewById("spiral").centerY, -0.0847596);
  assert.equal(viewById("needle").centerX, -1.25066);
  assert.equal(viewById("needle").centerY, 0.02012);
});

test("the Morphazoid page is visual-only, navigable, and publishable", async () => {
  const [html, css, app, core, buildScript, icon] = await Promise.all([
    readFile(new URL("striped-staircase.html", root), "utf8"),
    readFile(new URL("striped-staircase.css", root), "utf8"),
    readFile(new URL("striped-staircase-app.js", root), "utf8"),
    readFile(new URL("src/striped-staircase.js", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
    stat(new URL("assets/instruments/striped-staircase.webp", root)),
  ]);

  assert.match(html, /<canvas[\s\S]*id="stage"[\s\S]*aria-describedby=/);
  assert.match(html, /data-mode="steps"[\s\S]*data-mode="slide"/);
  assert.match(html, /id="depthRail"/);
  assert.match(html, /data-reset-all data-reset-in-place/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="striped-staircase-app\.js"/);
  assert.doesNotMatch(html, /id="audioButton"|AudioContext|audio-strip/);
  assert.match(css, /\.striped-staircase-shell/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(app, /morphazoid:striped-staircase-step/);
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
    catalogue: false,
  });
});
