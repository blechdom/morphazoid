import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { IsohedralTiling } from "../vendor/tactile/tactile.js";
import {
  buildSpiralTessellation,
  contactsForSpiralReader,
  createSpiralReader,
  createSpiralTransform,
  phaseForSpiralPoint,
  scaleRateForSpiralRadius,
  spiralLoopLogOffset,
  spiralPoint,
} from "../src/spiral.js";
import { tilingInfo } from "../src/lattice.js";

test("A and B close one exact turn of the logarithmic spiral", () => {
  const tiling = new IsohedralTiling(tilingInfo(20).type);
  const transform = createSpiralTransform({
    firstTranslation: tiling.getT1(),
    secondTranslation: tiling.getT2(),
    spiralA: 1,
    spiralB: 5,
  });
  const origin = transform.mapNatural({ x: 0, y: 0 });
  const period = transform.mapNatural(transform.period);
  assert.ok(Math.abs(period.x - origin.x) < 1e-8);
  assert.ok(Math.abs(period.y - origin.y - Math.PI * 2) < 1e-8);
  const first = spiralPoint(origin);
  const repeated = spiralPoint(period);
  assert.ok(Math.hypot(first.x - repeated.x, first.y - repeated.y) < 1e-8);
});

test("tessellation zoom follows the Pattern scale range and closes smoothly", () => {
  assert.equal(spiralLoopLogOffset(0), 0);
  assert.ok(Math.abs(spiralLoopLogOffset(0.25) - 1.2) < 1e-12);
  assert.ok(Math.abs(spiralLoopLogOffset(0.5)) < 1e-12);
  assert.ok(Math.abs(spiralLoopLogOffset(0.75) + 1.2) < 1e-12);
  assert.equal(spiralLoopLogOffset(1), 0);
  assert.ok(Math.abs(
    spiralLoopLogOffset(0.001) - spiralLoopLogOffset(1.001),
  ) < 1e-12);

  const start = buildSpiralTessellation({ type: 20, loopPhase: 0 });
  const zoomed = buildSpiralTessellation({ type: 20, loopPhase: 0.25 });
  assert.equal(start.transform.logOffset, 0);
  assert.ok(Math.abs(zoomed.transform.logOffset - 1.2) < 1e-12);
  assert.equal(zoomed.transform.angleOffset, start.transform.angleOffset);
  assert.ok(Math.abs(Math.exp(
    zoomed.transform.logOffset - start.transform.logOffset,
  ) - Math.exp(1.2)) < 1e-12);
});

test("spiral tessellation preserves editable IH data and produces finite readers", () => {
  const tessellation = buildSpiralTessellation({ type: 20, spiralA: 1, spiralB: 5 });
  assert.equal(tessellation.info.code, "IH20");
  assert.ok(tessellation.tiles.length > 100);
  assert.ok(tessellation.edges.length > 250);
  assert.ok(tessellation.edges.every((edge) => edge.points.every((point) => (
    Number.isFinite(point.x) && Number.isFinite(point.y)
  ))));

  for (const mode of ["radius", "angle", "spiral"]) {
    const reader = createSpiralReader({ ...tessellation.bounds, mode, phase: 0.45, turns: 2 });
    assert.ok(reader.points.length >= 2);
    const contacts = contactsForSpiralReader(tessellation, reader);
    assert.ok(contacts.length > 0, `${mode} reader should intersect the tessellation`);
    assert.ok(contacts.every((contact) => contact.along01 >= 0 && contact.along01 <= 1));
  }
});

test("radial time is logarithmic and defaults from outside to inside", () => {
  const options = { mode: "radius", innerRadius: 0.05, outerRadius: 1 };
  const outer = createSpiralReader({ ...options, phase: 0 });
  const middle = createSpiralReader({ ...options, phase: 0.5 });
  assert.ok(Math.abs(Math.hypot(outer.points[0].x, outer.points[0].y) - 1) < 1e-8);
  assert.ok(Math.abs(Math.hypot(middle.points[0].x, middle.points[0].y) - Math.sqrt(0.05)) < 1e-8);
  assert.ok(Math.abs(phaseForSpiralPoint({ x: 1, y: 0 }, options)) < 1e-8);
  assert.ok(Math.abs(phaseForSpiralPoint({ x: 0.05, y: 0 }, options) - 1) < 1e-8);
});

test("size coupling gives radial playback physical speed and bounded pitch rates", () => {
  const options = {
    mode: "radius",
    innerRadius: 0.05,
    outerRadius: 1,
    sizeCoupled: true,
  };
  const middle = createSpiralReader({ ...options, phase: 0.5 });
  assert.ok(Math.abs(Math.hypot(middle.points[0].x, middle.points[0].y) - 0.525) < 1e-8);
  assert.ok(Math.abs(phaseForSpiralPoint({ x: 0.525, y: 0 }, options) - 0.5) < 1e-8);
  for (const phase of [0, 0.01, 0.1, 0.25, 0.5, 0.73, 0.99, 1]) {
    const reader = createSpiralReader({ ...options, phase });
    assert.ok(Math.abs(phaseForSpiralPoint(reader.points[0], options) - phase) < 1e-8);
  }

  const geometricMiddle = Math.sqrt(0.05);
  assert.equal(scaleRateForSpiralRadius(0.05, 0.05, 1), 2);
  assert.ok(Math.abs(scaleRateForSpiralRadius(geometricMiddle, 0.05, 1) - 1) < 1e-12);
  assert.equal(scaleRateForSpiralRadius(1, 0.05, 1), 0.5);
  assert.equal(scaleRateForSpiralRadius(0, 0.05, 1), 2);
  assert.equal(scaleRateForSpiralRadius(0.001, 0.05, 1), 2);
  assert.equal(scaleRateForSpiralRadius(10, 0.05, 1), 0.5);
});

test("Spiral page exposes intrinsic time paths and tactile winding controls", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../spiral.html", import.meta.url), "utf8"),
    readFile(new URL("../spiral-app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<body class="spiral-page">/);
  assert.match(html, /id="radiusTime"[^>]+aria-pressed="true"/);
  assert.match(html, /id="angleTime"/);
  assert.match(html, /id="spiralTime"/);
  assert.match(html, /id="sizeCoupling"[^>]+aria-pressed="false"/);
  assert.ok(
    html.indexOf('id="sizeCoupling"') < html.indexOf('id="formSection"'),
    "size coupling belongs in the Play section",
  );
  assert.match(html, /id="spiralA"[^>]+value="1"/);
  assert.match(html, /id="spiralB"[^>]+value="5"/);
  assert.match(html, /id="loopPhase"/);
  assert.match(html, /id="loopPlayButton"/);
  assert.match(html, /Tessellation zoom/);
  assert.match(html, /Zoom out/);
  assert.match(app, /buildSpiralTessellation/);
  assert.match(app, /contactsForSpiralReader/);
  assert.match(app, /phaseForSpiralPoint/);
  assert.match(app, /scaleRateForSpiralRadius/);
  assert.match(
    app,
    /setLoopPlaying\(true\);\s+if \(!state\.audio\) void enableAudio\(\);/,
  );

  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const referenced = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]));
  for (const match of app.matchAll(/bindRange\("([^"]+)"/g)) {
    referenced.add(match[1]);
    referenced.add(`${match[1]}Out`);
  }
  assert.deepEqual([...referenced].filter((id) => !ids.has(id)), []);
});
