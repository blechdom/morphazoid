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

test("Spiral page exposes intrinsic time paths and tactile winding controls", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../spiral.html", import.meta.url), "utf8"),
    readFile(new URL("../spiral-app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<body class="spiral-page">/);
  assert.match(html, /id="radiusTime"[^>]+aria-pressed="true"/);
  assert.match(html, /id="angleTime"/);
  assert.match(html, /id="spiralTime"/);
  assert.match(html, /id="spiralA"[^>]+value="1"/);
  assert.match(html, /id="spiralB"[^>]+value="5"/);
  assert.match(html, /Out[^<]*In/);
  assert.match(app, /buildSpiralTessellation/);
  assert.match(app, /contactsForSpiralReader/);
  assert.match(app, /phaseForSpiralPoint/);

  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const referenced = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]));
  for (const match of app.matchAll(/bindRange\("([^"]+)"/g)) {
    referenced.add(match[1]);
    referenced.add(`${match[1]}Out`);
  }
  assert.deepEqual([...referenced].filter((id) => !ids.has(id)), []);
});
