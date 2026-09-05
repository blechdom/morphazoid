import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_PATH_SETTINGS,
  PATH_FAMILIES,
  PATH_LIMITS,
  generatePath,
  partialPath,
  pathDetailLabel,
  pathSvgData,
  samplePath,
  sanitizePathSettings,
} from "../src/paths.js";

const root = new URL("../", import.meta.url);

test("path settings clamp to each generator's useful range", () => {
  assert.deepEqual(sanitizePathSettings({
    family: "unknown",
    detail: 99,
    aspect: 20,
    seed: 0,
  }), {
    family: DEFAULT_PATH_SETTINGS.family,
    detail: 6,
    aspect: PATH_LIMITS.aspectMax,
    seed: 1,
  });
  assert.equal(sanitizePathSettings({ family: "gosper", detail: 99 }).detail, 4);
  assert.equal(sanitizePathSettings({ family: "hilbert", detail: -2 }).detail, 1);
});

test("all path families are deterministic, finite, bounded continuous scores", () => {
  for (const family of PATH_FAMILIES) {
    const settings = {
      family: family.id,
      detail: family.defaultDetail,
      aspect: 1.55,
      seed: 417,
    };
    const path = generatePath(settings);
    const again = generatePath(settings);
    assert.deepEqual(path.points, again.points, family.id);
    assert.ok(path.points.length > 20, family.id);
    assert.ok(path.points.length <= PATH_LIMITS.maxPoints, family.id);
    assert.equal(path.metrics.segmentCount, path.points.length - 1, family.id);
    assert.ok(path.metrics.length > 0, family.id);
    assert.ok(Number.isFinite(path.metrics.length), family.id);
    assert.ok(path.points.every(({ x, y, hierarchy }) => (
      Number.isFinite(x) && Number.isFinite(y) && hierarchy >= 0 && hierarchy <= 1
    )), family.id);
    path.points.slice(1).forEach((point, index) => {
      const previous = path.points[index];
      assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) > 0, family.id);
    });
    assert.ok(Object.isFrozen(path));
    assert.ok(Object.isFrozen(path.points));
  }
});

test("space-filling and folding families preserve their expected orders", () => {
  const gilbert = generatePath({ family: "gilbert", detail: 4, aspect: 1.55 });
  assert.equal(gilbert.points.length, gilbert.dimensions.width * gilbert.dimensions.height);
  assert.equal(pathDetailLabel(gilbert.settings), `${gilbert.dimensions.width} x ${gilbert.dimensions.height}`);

  const hilbert = generatePath({ family: "hilbert", detail: 5 });
  assert.equal(hilbert.points.length, 4 ** 5);

  const gosper = generatePath({ family: "gosper", detail: 4 });
  assert.equal(gosper.metrics.segmentCount, 7 ** 4);

  const dragon = generatePath({ family: "dragon", detail: 6 });
  assert.equal(dragon.metrics.segmentCount, 2 ** 10);
});

test("seeded Walk is self-avoiding and seed-sensitive", () => {
  const first = generatePath({ family: "walk", detail: 4, seed: 91 });
  const second = generatePath({ family: "walk", detail: 4, seed: 92 });
  const keys = first.points.map(({ x, y }) => `${x.toFixed(8)}:${y.toFixed(8)}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.notDeepEqual(first.points, second.points);
});

test("arc-length sampling and partial paths share exact endpoints", () => {
  const path = generatePath({ family: "gosper", detail: 3, aspect: 1.3 });
  const start = samplePath(path, -4);
  const middle = samplePath(path, 0.5);
  const end = samplePath(path, 9);
  assert.equal(start.x, path.points[0].x);
  assert.equal(start.y, path.points[0].y);
  assert.equal(end.x, path.points.at(-1).x);
  assert.equal(end.y, path.points.at(-1).y);
  assert.ok(Number.isFinite(middle.angle));
  assert.ok(middle.curvature >= -1 && middle.curvature <= 1);
  const partial = partialPath(path, 0.5);
  assert.equal(partial[0].x, path.points[0].x);
  assert.equal(partial.at(-1).x, middle.x);
  assert.equal(partial.at(-1).y, middle.y);
});

test("Paths page keeps generation primary and explanatory chrome absent", async () => {
  const [html, css, app, nav, catalog, midi] = await Promise.all([
    readFile(new URL("paths.html", root), "utf8"),
    readFile(new URL("paths.css", root), "utf8"),
    readFile(new URL("paths-app.js", root), "utf8"),
    readFile(new URL("nav.js", root), "utf8"),
    readFile(new URL("src/instrument-catalog.js", root), "utf8"),
    readFile(new URL("src/instrument-midi-capabilities.js", root), "utf8"),
    access(new URL("assets/instruments/paths.webp", root)),
  ]);

  assert.match(html, /<title>Paths - Morphazoid<\/title>/);
  assert.match(html, /data-tool-id="paths"/);
  assert.match(html, /data-instrument-info="off"/);
  assert.match(html, /data-midi-output-monitor="collapsed"/);
  assert.match(html, /data-path-mode="draw" aria-pressed="true">Draw/);
  assert.match(html, /id="playButton"[^>]+data-primary-transport/);
  assert.match(html, /id="seed"/);
  assert.match(html, /id="resetButton"/);
  assert.ok(html.indexOf('id="seed"') < html.indexOf('id="generatorTitle"'));
  assert.ok(html.indexOf('id="statsTitle"') > html.indexOf('id="soundTitle"'));
  for (const family of PATH_FAMILIES) assert.match(html, new RegExp(`value="${family.id}"`));
  assert.doesNotMatch(html, /Penrose|tiling/i);
  assert.doesNotMatch(html, /id="(?:warp|motion|rotation)"|>Shape</);
  assert.doesNotMatch(html, /<p class="control-note"|class="instrument-info/);
  assert.match(css, /\.paths-shell\s*\{/);
  assert.match(css, /\.paths-stage-wrap\s*\{[\s\S]*?aspect-ratio: 1;/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /@media \(max-width: 960px\)[\s\S]*?\.paths-panel\s*\{[\s\S]*?overflow-y: auto;/);
  assert.match(app, /new VoicePool\(8/);
  assert.match(app, /samplePath\(path, phase\)/);
  assert.doesNotMatch(app, /shapePath|state\.(?:warp|motion|rotation)/);
  assert.match(app, /pitchSource === "curvature"/);
  assert.match(app, /voicePool\.close\(\)/);
  assert.match(app, /data-layer=\\"generated-path\\"/);
  assert.match(nav, /id: "paths", label: "Paths", href: "paths\.html"/);
  assert.match(catalog, /paths: define\(/);
  assert.match(midi, /"algorithmic-mazes",\s*"paths"/);
});
