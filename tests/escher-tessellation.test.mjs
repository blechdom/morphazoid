import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildLattice, tilingInfo } from "../src/lattice.js";
import {
  buildEscherContours,
  contourEvents,
  contourPointAtDistance,
  selectEscherContours,
} from "../src/escher-contours.js";
import {
  DEFAULT_ESCHER_TESSELLATION_PRESET,
  ESCHER_TESSELLATION_PALETTES,
  ESCHER_TESSELLATION_PRESETS,
  createHyperbolicTiling,
  createSimilarityOrbit,
  escherTessellationPreset,
  glideEscherPoint,
  hyperbolicDistance,
  reflectHyperbolicPoint,
  regularHyperbolicPolygon,
  rotateEscherPoint,
  similarityEscherPoint,
} from "../src/escher-tessellation.js";

const root = new URL("../", import.meta.url);
const close = (first, second, epsilon = 1e-8) => Math.abs(first - second) <= epsilon;

test("Escher exposes distinct structural studies with original procedural motifs", () => {
  assert.equal(DEFAULT_ESCHER_TESSELLATION_PRESET, "counterform-current");
  assert.deepEqual(
    ESCHER_TESSELLATION_PRESETS.map(({ id }) => id),
    [
      "counterform-current",
      "night-flight",
      "triple-orbit",
      "glide-parade",
      "metamorphosis-band",
      "inward-infinity",
      "hyperbolic-current",
      "dual-horizon",
    ],
  );
  assert.equal(new Set(ESCHER_TESSELLATION_PRESETS.map(({ id }) => id)).size, 8);
  assert.equal(new Set(ESCHER_TESSELLATION_PRESETS.map(({ referenceWork }) => referenceWork)).size, 8);
  assert.equal(ESCHER_TESSELLATION_PALETTES.length, 4);
  for (const preset of ESCHER_TESSELLATION_PRESETS) {
    assert.ok(preset.description.length > 65);
    assert.ok(preset.referenceUrl.startsWith("https://"));
    assert.ok(preset.generators.length >= 2);
    assert.doesNotMatch(`${preset.description} ${preset.label}`, /exact copy|replica|reproduction/i);
  }
  assert.equal(escherTessellationPreset("missing").id, DEFAULT_ESCHER_TESSELLATION_PRESET);
});

test("p3, glide, and similarity generators close at their declared periods", () => {
  const point = { x: 0.37, y: -0.24 };
  let rotated = point;
  for (let index = 0; index < 3; index += 1) rotated = rotateEscherPoint(rotated, Math.PI * 2 / 3);
  assert.ok(close(rotated.x, point.x));
  assert.ok(close(rotated.y, point.y));

  const width = 1.7;
  const once = glideEscherPoint(point, width);
  const twice = glideEscherPoint(once, width);
  assert.ok(close(twice.x, point.x + width * 2));
  assert.ok(close(twice.y, point.y));

  const similarityTwice = similarityEscherPoint(point, 2);
  const expected = rotateEscherPoint(point, Math.PI / 2);
  assert.ok(close(similarityTwice.x, expected.x / 2));
  assert.ok(close(similarityTwice.y, expected.y / 2));
  const orbit = createSimilarityOrbit(18);
  assert.equal(orbit.length, 18);
  for (let index = 1; index < orbit.length; index += 1) {
    assert.ok(close(orbit[index].scale / orbit[index - 1].scale, 1 / Math.sqrt(2)));
    assert.ok(close(orbit[index].rotation - orbit[index - 1].rotation, Math.PI / 4));
  }
});

test("the Circle Limit studies build true finite views of regular hyperbolic tilings", () => {
  for (const [p, q, minimumTiles] of [[8, 3, 500], [6, 4, 400]]) {
    const rootPolygon = regularHyperbolicPolygon(p, q);
    assert.equal(rootPolygon.length, p);
    assert.ok(rootPolygon.every(({ x, y }) => Math.hypot(x, y) < 1));

    const tiling = createHyperbolicTiling({ p, q, layers: 4, maxTiles: 1000 });
    assert.ok(tiling.length >= minimumTiles);
    assert.equal(new Set(tiling.map(({ center }) => `${center.x.toFixed(6)},${center.y.toFixed(6)}`)).size, tiling.length);
    for (const tile of tiling) {
      assert.equal(tile.points.length, p);
      assert.ok(tile.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
      assert.ok(tile.points.every(({ x, y }) => Math.hypot(x, y) < 1));
      assert.ok(Math.hypot(tile.center.x, tile.center.y) < 1);
    }

    const first = { x: 0.11, y: -0.07 };
    const second = { x: -0.13, y: 0.18 };
    const reflectedFirst = reflectHyperbolicPoint(first, rootPolygon[0], rootPolygon[1]);
    const reflectedSecond = reflectHyperbolicPoint(second, rootPolygon[0], rootPolygon[1]);
    assert.ok(close(
      hyperbolicDistance(first, second),
      hyperbolicDistance(reflectedFirst, reflectedSecond),
      1e-7,
    ));
    const returned = reflectHyperbolicPoint(reflectedFirst, rootPolygon[0], rootPolygon[1]);
    assert.ok(close(returned.x, first.x, 1e-7));
    assert.ok(close(returned.y, first.y, 1e-7));
  }
});

test("every Euclidean preset produces a finite, seam-shared isohedral field", () => {
  const bounds = { minX: -1.5, minY: -1.2, maxX: 1.5, maxY: 1.2 };
  for (const preset of ESCHER_TESSELLATION_PRESETS.filter(({ model }) => model === "euclidean")) {
    const info = tilingInfo(preset.tilingType);
    const lattice = buildLattice({
      type: preset.tilingType,
      parameters: preset.parameters ?? info.defaultParameters,
      edgeCurves: preset.edgeCurves,
      bounds,
      scale: 0.34,
    });
    assert.ok(lattice.tiles.length > 20, `${preset.id} needs a visible tile field`);
    assert.ok(lattice.edges.length > 20, `${preset.id} needs shared edges`);
    assert.ok(lattice.tiles.every(({ points }) => points.length >= 3));
    assert.ok(lattice.tiles.flatMap(({ points }) => points).every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
    assert.ok(lattice.edges.some(({ adjacentTiles }) => adjacentTiles.length === 2));
  }
});

test("playback contours are the exact tile, similarity, and geodesic outlines", () => {
  const euclideanPreset = escherTessellationPreset("counterform-current");
  const euclideanGeometry = buildLattice({
    type: euclideanPreset.tilingType,
    parameters: euclideanPreset.parameters,
    edgeCurves: euclideanPreset.edgeCurves,
    bounds: { minX: -1.4, minY: -1.1, maxX: 1.4, maxY: 1.1 },
    scale: 0.34,
  });
  const fixtures = [
    {
      preset: euclideanPreset,
      geometry: euclideanGeometry,
      role: "tile",
    },
    {
      preset: escherTessellationPreset("inward-infinity"),
      geometry: createSimilarityOrbit(12),
      role: "similarity-cell",
    },
    {
      preset: escherTessellationPreset("hyperbolic-current"),
      geometry: createHyperbolicTiling({ p: 8, q: 3, layers: 2, maxTiles: 96 }),
      role: "hyperbolic-tile",
    },
  ];

  for (const { preset, geometry, role } of fixtures) {
    const field = buildEscherContours({ preset, geometry, maxContours: 96, maxPoints: 12_288 });
    assert.equal(field.presetId, preset.id);
    assert.equal(field.model, preset.model);
    assert.ok(field.contours.length > 2, `${preset.id} needs multiple selectable outlines`);

    for (const contour of field.contours.slice(0, 12)) {
      assert.equal(contour.role, role);
      assert.ok(contour.points.length >= 3);
      assert.ok(contour.edges.length >= 3);
      assert.ok(contour.perimeter > 0);
      assert.ok(contour.area > 0);
      assert.ok(contour.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
      assert.ok(close(
        contour.edges.reduce((total, edge) => total + edge.length, 0),
        contour.perimeter,
        1e-7,
      ));

      const start = contourPointAtDistance(contour, 0);
      const wrapped = contourPointAtDistance(contour, contour.perimeter);
      assert.ok(Number.isFinite(start.point.x) && Number.isFinite(start.point.y));
      assert.ok(close(start.point.x, wrapped.point.x, 1e-7));
      assert.ok(close(start.point.y, wrapped.point.y, 1e-7));

      const edgeIds = new Set(contour.edges.map(({ id }) => id));
      const events = contourEvents(contour);
      assert.ok(events.length >= contour.edges.length);
      assert.ok(events.every(({ edgeId }) => edgeIds.has(edgeId)));
    }
  }

  const shared = fixtures[0];
  const field = buildEscherContours({ preset: shared.preset, geometry: shared.geometry, maxContours: 96 });
  const selected = field.contours.find(({ adjacentIds }) => adjacentIds.length > 0);
  assert.ok(selected, "the Euclidean field needs a contour with a real shared-border neighbor");
  assert.deepEqual(
    selectEscherContours(field, { mode: "shape", selectedId: selected.id }).map(({ id }) => id),
    [selected.id],
  );
  const neighbors = selectEscherContours(field, {
    mode: "neighbors",
    selectedId: selected.id,
    neighborReach: 1,
    maxActive: 12,
  });
  assert.equal(neighbors[0].id, selected.id);
  assert.ok(neighbors.some(({ id }) => selected.adjacentIds.includes(id)));
  const pattern = selectEscherContours(field, {
    mode: "pattern",
    selectedId: selected.id,
    maxActive: 12,
  });
  assert.equal(pattern[0].id, selected.id);
  assert.ok(pattern.length > 1);
});

test("equal outline speed makes smaller real contours loop more frequently", () => {
  const preset = escherTessellationPreset("inward-infinity");
  const field = buildEscherContours({ preset, geometry: createSimilarityOrbit(18) });
  const contours = [...field.contours].sort((first, second) => first.perimeter - second.perimeter);
  const shortest = contours[0];
  const longest = contours.at(-1);
  const travelSpeed = 0.32;
  const windowSeconds = longest.perimeter / travelSpeed * 2.1;
  assert.ok(shortest.perimeter < longest.perimeter);
  assert.ok(
    Math.floor(windowSeconds / (shortest.perimeter / travelSpeed))
      > Math.floor(windowSeconds / (longest.perimeter / travelSpeed)),
    "a shorter shape must complete more perimeter-driven loops in the same time",
  );
});

test("Escher markup is labelled, self-contained, and explicit about source boundaries", async () => {
  const [html, app, css, performanceAudio] = await Promise.all([
    readFile(new URL("escher-tessellation.html", root), "utf8"),
    readFile(new URL("escher-tessellation-app.js", root), "utf8"),
    readFile(new URL("escher-tessellation.css", root), "utf8"),
    readFile(new URL("src/escher-performance-audio.js", root), "utf8"),
  ]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "page ids must be unique");
  assert.match(html, /<title>Escher — Morphazoid<\/title>/);
  assert.match(html, /<h1 id="escherTessellationTitle">Escher<\/h1>/);
  assert.match(html, /aria-label="Escher controls"/);
  assert.match(html, /aria-label="Escher output level"/);
  assert.match(html, /data-reset-in-place>Reset Escher<\/button>/);
  assert.match(html, /href="escher-tessellation\.html" aria-current="page">escher<\/a>/);
  assert.match(html, /value="escher-tessellation\.html" selected>escher<\/option>/);
  assert.doesNotMatch(html, />Escher Tessellation<|>escher tessellation</);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(html, /id="stage"[\s\S]+aria-describedby="canvasInstructions liveStatus"/);
  assert.doesNotMatch(html, /id="stage"[^>]+role="img"/);
  assert.match(html, /id="zoomOutButton"/);
  assert.match(html, /id="resetViewButton"/);
  assert.match(html, /id="zoomInButton"/);
  assert.match(html, /id="liveStatus" aria-live="polite"/);
  assert.match(html, /id="resetButton"[^>]+data-reset-all[^>]+data-reset-in-place/);
  assert.match(html, /aria-labelledby="playbackTitle"/);
  assert.match(html, /id="playbackTitle">Contour playback/);
  assert.match(html, /id="playbackSummary">ready · tap a contour/);
  assert.match(html, /id="playbackChoice"[^>]+role="group"[^>]+aria-label="Contour playback mode"/);
  assert.match(html, /data-playback="shape" aria-pressed="true">Shape/);
  assert.match(html, /data-playback="neighbors" aria-pressed="false">Neighbors/);
  assert.match(html, /data-playback="pattern" aria-pressed="false">Pattern/);
  assert.match(html, /The playhead follows its actual outline\./);
  assert.match(html, /id="travelSpeed"[^>]+min="0\.08"[^>]+max="1\.2"[^>]+value="0\.32"/);
  assert.match(html, /id="neighborReach"[^>]+min="1"[^>]+max="4"[^>]+value="2" disabled/);
  assert.match(html, /id="playheadSize"[^>]+min="0\.2"[^>]+max="1"[^>]+value="0\.65"/);
  assert.match(html, /measured perimeter sets the loop, each real border length sets event timing/i);
  assert.match(html, /corner turns shape pitch, curvature shapes timbre/i);
  assert.match(html, /id="soundSummary">position · angle · color · border/);
  assert.match(html, /How strongly each measured contour feature changes its phrase, pitch, articulation, and position/);
  assert.match(html, /id="orientationDepth"[^>]+min="0"[^>]+max="1"[^>]+value="0\.68"/);
  assert.match(html, /id="colorAspectDepth"[^>]+min="0"[^>]+max="1"[^>]+value="0\.76"/);
  assert.match(html, /id="positionDepth"[^>]+min="0"[^>]+max="1"[^>]+value="0\.64"/);
  assert.match(html, /id="edgeArticulation"[^>]+min="0"[^>]+max="1"[^>]+value="0\.72"/);
  for (const removedId of [
    "phase", "tempo", "phraseBars", "pulse", "activity", "swing", "outlineLevels",
    "traversalChoice", "directionChoice",
  ]) {
    assert.doesNotMatch(html, new RegExp(`\\bid="${removedId}"`));
  }
  assert.doesNotMatch(html, /data-traversal=|>Tide<|>Billiard</);
  assert.match(html, /original procedural drawings, not reproductions/i);
  assert.match(html, /Craig S\. Kaplan&rsquo;s TactileJS library/);
  assert.doesNotMatch(html, /<img\b|mcescher\.com\/wp-content|escherinhetpaleis\.nl\/wp-content/);
  for (const control of [
    "level", "preset", "travelSpeed", "neighborReach", "playheadSize",
    "density", "deformation", "rotation", "detail", "showGeometry", "palette", "contrast",
    "showOutlines", "baseFrequency", "tone", "pitchSpan", "timbreMotion", "stereoWidth",
    "orientationDepth", "colorAspectDepth", "positionDepth", "edgeArticulation",
  ]) {
    assert.match(html, new RegExp(`<label[^>]*for="${control}"`), `${control} needs a label`);
  }
  for (const preset of ESCHER_TESSELLATION_PRESETS) {
    assert.match(html, new RegExp(`<option value="${preset.id}"`));
  }
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="escher-tessellation-app\.js"/);
  assert.match(html, /href="escher-tessellation\.html" aria-current="page">escher<\/a>[\s\S]+href="order-tones\.html">order tones<\/a>/);
  assert.doesNotMatch(html, /href="lattice\.html">lattice<\/a>|href="spiral\.html">spiral<\/a>/);
  assert.match(html, /<option value="order-tones\.html">order tones<\/option>/);
  assert.match(html, /<option value="morphazoidical\/">morphazoidical<\/option>/);
  assert.match(app, /createHyperbolicTiling/);
  assert.match(app, /samplePoincareGeodesic/);
  assert.match(app, /buildLattice/);
  assert.match(app, /setPointerCapture/);
  assert.match(app, /pointers\.size >= 2/);
  assert.match(app, /event\.code === "Home"/);
  assert.match(app, /is-model-locked/);
  assert.match(app, /new EscherPerformanceAudio/);
  assert.match(app, /from "\.\/src\/escher-contours\.js"/);
  assert.match(app, /buildEscherContours/);
  assert.match(app, /contourPointAtDistance/);
  assert.match(app, /selectEscherContours/);
  assert.match(app, /function drawContourPlayheads/);
  assert.match(app, /function nearestContourAtScreen/);
  assert.match(app, /function selectContour/);
  assert.match(app, /document\.querySelectorAll\("#playbackChoice button"\)/);
  assert.match(app, /playbackDistance \+= delta \* state\.travelSpeed/);
  assert.match(app, /audio\.configure\(performanceConfig\(\)\)/);
  assert.match(app, /fieldBounds: contourField\?\.bounds \?\? null/);
  assert.match(app, /visualRotation: state\.rotation/);
  assert.match(app, /contrast: state\.contrast/);
  for (const depth of [
    "orientationDepth",
    "colorAspectDepth",
    "positionDepth",
    "edgeArticulation",
  ]) {
    assert.match(app, new RegExp(`${depth}: state\\.${depth}`));
    assert.match(app, new RegExp(`bindRange\\("${depth}", \\{ audio: true \\}\\)`));
  }
  assert.match(app, /bindRange\("rotation", \{ audio: true \}\)/);
  assert.match(app, /bindRange\("contrast", \{ audio: true \}\)/);
  assert.match(app, /audio\.setPlaying\(state\.playing, playbackDistance\)/);
  assert.match(app, /audio\.dispose\(\)/);
  assert.doesNotMatch(app, /escher-performance\.js|drawTraversalOverlay|escherTraversalVisualState|hierarchyFlashes/);
  assert.doesNotMatch(app, /\b(?:state\.phase|tempo|phraseBars|pulsesPerBeat|domain-billiard|counterchange-tide|symmetry-orbit)\b/);
  assert.match(app, /function drawMotifEye\(x, y, radius, ink, accent\)/);
  assert.match(app, /function drawJointedLeg\(size, points, ink, detail\)/);
  assert.match(app, /function drawReptileMotif\(size, detail, ink, accent, variant\)/);
  const reptileMotifBody = app.match(
    /function drawReptileMotif\(size, detail, ink, accent, variant\) \{([\s\S]+?)\n\}\n\nfunction drawFishMotif/,
  )?.[1] ?? "";
  assert.equal(
    (reptileMotifBody.match(/drawJointedLeg\(size, \[\[/g) ?? []).length,
    4,
    "the procedural reptile needs four articulated legs",
  );
  assert.match(app, /drawMotifEye\(size \* 0\.48/);
  assert.match(app, /kind === "triple"\) drawReptileMotif/);
  assert.match(app, /drawing\.scale\(1, mirrored \? -1 : 1\)/);
  assert.match(app, /requestAnimationFrame/);
  assert.match(app, /Math\.min\(globalThis\.devicePixelRatio \|\| 1, 2\.5\)/);
  assert.match(performanceAudio, /AudioContext\.currentTime|context\.currentTime/);
  assert.match(performanceAudio, /SCHEDULE_HORIZON_SECONDS/);
  assert.match(performanceAudio, /setIntervalFn/);
  assert.match(performanceAudio, /edgeId/);
  assert.match(performanceAudio, /perimeter \/ this\.config\.travelSpeed/);
  assert.match(performanceAudio, /context\.close/);
  assert.doesNotMatch(performanceAudio, /escherPerformanceEvents|\b(?:bedBus|bedVoices|_createBedVoices)\b/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) clamp\(360px, 28vw, 430px\)/);
  assert.match(css, /@media \(max-width: 960px\)[\s\S]+grid-template-columns: 1fr/);
  assert.match(css, /touch-action: none/);
  assert.match(css, /\.contour-playback-choice[\s\S]+repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.escher-tessellation-page input\[type="range"\][\s\S]+(?:min-)?height: 44px/);
  assert.match(css, /\.escher-playback-body \.choice-switch button[\s\S]+min-height: 44px/);
  assert.match(css, /\.sound-mapping-grid[\s\S]+repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 390px\)[\s\S]+\.sound-mapping-grid \{[\s\S]+grid-template-columns: minmax\(0, 1fr\)/);
});
