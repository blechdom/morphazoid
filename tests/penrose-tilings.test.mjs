import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PENROSE_PHI,
  PENROSE_PRESENTATIONS,
  colorPenroseTiles,
  contactsForPenroseReader,
  createPenroseKiteSeed,
  createPenroseReader,
  createPenroseSunSeed,
  createPenroseTiling,
  createPenroseWorldWindow,
  newlyEnteredPenroseContacts,
  normalizedPenrosePhase,
  pairPenroseKiteDartTriangles,
  pairPenroseTriangles,
  penrosePitch01,
  penroseTileAtPoint,
  subdividePenroseKiteDartTriangles,
  subdividePenroseTriangles,
  upcomingPenroseEdges,
} from "../src/penrose-tilings.js";

const close = (first, second, tolerance = 1e-8) => Math.abs(first - second) <= tolerance;

function sideLengths(tile) {
  return tile.points.map((point, index) => {
    const next = tile.points[(index + 1) % tile.points.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
}

function interiorAngles(tile) {
  return tile.points.map((point, index) => {
    const previous = tile.points[(index + tile.points.length - 1) % tile.points.length];
    const next = tile.points[(index + 1) % tile.points.length];
    const first = { x: previous.x - point.x, y: previous.y - point.y };
    const second = { x: next.x - point.x, y: next.y - point.y };
    const cosine = (first.x * second.x + first.y * second.y)
      / Math.hypot(first.x, first.y) / Math.hypot(second.x, second.y);
    return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  }).sort((first, second) => first - second);
}

test("golden-ratio Robinson subdivision closes into exact thick and thin rhombs", () => {
  let triangles = createPenroseSunSeed();
  const triangleCounts = [10];
  for (let generation = 1; generation <= 7; generation += 1) {
    triangles = subdividePenroseTriangles(triangles);
    triangleCounts.push(triangles.length);
  }
  assert.deepEqual(triangleCounts, [10, 20, 50, 130, 340, 890, 2330, 6100]);

  const paired = pairPenroseTriangles(triangles);
  assert.equal(paired.tiles.length, 3010);
  assert.equal(paired.boundaryTriangles, 80);
  assert.ok(paired.tiles.every(({ points }) => points.length === 4));
  for (const tile of paired.tiles) {
    const lengths = sideLengths(tile);
    assert.ok(lengths.every((length) => close(length, lengths[0], 1e-7)));
    const angles = interiorAngles(tile);
    const expected = tile.type === "thick" ? [72, 72, 108, 108] : [36, 36, 144, 144];
    angles.forEach((angle, index) => assert.ok(close(angle, expected[index], 1e-6)));
  }
});

test("cartwheel generations retain five families and approach the golden tile ratio", () => {
  const expected = [
    [1, 10, 5, 5],
    [2, 20, 10, 10],
    [3, 60, 35, 25],
    [4, 160, 100, 60],
    [5, 430, 265, 165],
    [6, 1140, 700, 440],
    [7, 3010, 1855, 1155],
  ];
  for (const [generation, total, thick, thin] of expected) {
    const tiling = createPenroseTiling({ generation });
    assert.equal(tiling.counts.total, total);
    assert.equal(tiling.counts.thick, thick);
    assert.equal(tiling.counts.thin, thin);
    assert.equal(new Set(tiling.tiles.map(({ family }) => family)).size, 5);
    assert.ok(tiling.edges.every(({ tileIds }) => tileIds.length === 1 || tileIds.length === 2));
    assert.ok(tiling.tiles.flatMap(({ points }) => points).every(({ x, y }) => (
      Number.isFinite(x) && Number.isFinite(y)
    )));
  }
  const finest = createPenroseTiling({ generation: 7 });
  assert.ok(Math.abs(finest.counts.ratio - PENROSE_PHI) < 0.015);
});

test("all standard Penrose presentations generate finite, playable edge graphs", () => {
  assert.deepEqual(
    PENROSE_PRESENTATIONS.map(({ id }) => id),
    ["p3", "pentagrid", "p2", "p1", "robinson"],
  );
  const expectedClassCounts = { p3: 2, pentagrid: 2, p2: 2, p1: 6, robinson: 2 };
  for (const { id } of PENROSE_PRESENTATIONS) {
    const tiling = createPenroseTiling({ presentation: id, generation: 6, variation: 17 });
    assert.equal(tiling.presentation, id);
    assert.ok(tiling.tiles.length > 80, `${id} should expose a substantial local patch`);
    assert.equal(new Set(tiling.tiles.map(({ kind }) => kind)).size, expectedClassCounts[id]);
    assert.ok(tiling.tiles.every(({ points, area }) => (
      points.length >= 3
      && area > 0
      && points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))
    )));
    assert.ok(tiling.edges.length > tiling.tiles.length);
    assert.ok(tiling.edges.every(({ tileIds }) => tileIds.length === 1 || tileIds.length === 2));
  }

  const firstPentagrid = createPenroseTiling({ presentation: "pentagrid", variation: 2 });
  const secondPentagrid = createPenroseTiling({ presentation: "pentagrid", variation: 3 });
  assert.notDeepEqual(
    firstPentagrid.tiles.slice(0, 12).map(({ center }) => center),
    secondPentagrid.tiles.slice(0, 12).map(({ center }) => center),
    "pentagrid phase must select genuinely different cuts",
  );
});

test("infinite viewport overscan expands every presentation without enlarging P3 tiles", () => {
  const span = ({ bounds }) => Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
  );
  for (const { id } of PENROSE_PRESENTATIONS) {
    const patch = createPenroseTiling({ presentation: id, generation: 4 });
    const buffered = createPenroseTiling({ presentation: id, generation: 4, overscan: 2 });
    assert.equal(buffered.generation, patch.generation);
    assert.equal(buffered.sourceGeneration, patch.generation + 2);
    assert.ok(span(buffered) > span(patch) * 2.5, `${id} should have an offscreen buffer`);
    assert.ok(buffered.tiles.length > patch.tiles.length);
    assert.ok(penroseTileAtPoint(buffered, { x: -1.2, y: -0.7 }));
    assert.ok(penroseTileAtPoint(buffered, { x: 1.2, y: 0.7 }));
  }

  const patch = createPenroseTiling({ presentation: "p3", generation: 4 });
  const buffered = createPenroseTiling({ presentation: "p3", generation: 4, overscan: 2 });
  const medianEdge = (tiling) => {
    const lengths = tiling.edges.map(({ length }) => length).sort((a, b) => a - b);
    return lengths[Math.floor(lengths.length / 2)];
  };
  assert.ok(close(medianEdge(patch), medianEdge(buffered), 1e-7));
});

test("world pentagrid windows preserve exact geometry and IDs through overlapping queries", () => {
  const options = {
    presentation: "p3",
    generation: 5,
    variation: 13,
    rotation: 0.137,
    radius: 0.72,
    halo: 0.28,
  };
  const first = createPenroseWorldWindow({
    ...options,
    center: { x: -0.1, y: 0.05 },
  });
  const second = createPenroseWorldWindow({
    ...options,
    center: { x: 0.31, y: -0.09 },
  });
  assert.ok(close(first.edgeScale, PENROSE_PHI ** -5, 1e-12));
  assert.equal(first.field.method, "de-bruijn-pentagrid");

  const overlap = {
    minX: Math.max(first.window.queryBounds.minX, second.window.queryBounds.minX),
    minY: Math.max(first.window.queryBounds.minY, second.window.queryBounds.minY),
    maxX: Math.min(first.window.queryBounds.maxX, second.window.queryBounds.maxX),
    maxY: Math.min(first.window.queryBounds.maxY, second.window.queryBounds.maxY),
  };
  const inset = first.edgeScale * 2;
  const isSafelyInside = ({ x, y }, amount = inset) => (
    x >= overlap.minX + amount
      && x <= overlap.maxX - amount
      && y >= overlap.minY + amount
      && y <= overlap.maxY - amount
  );
  const secondTiles = new Map(second.tiles.map((tile) => [tile.id, tile]));
  const sharedTiles = first.tiles.filter((tile) => isSafelyInside(tile.center));
  assert.ok(sharedTiles.length > 100);
  for (const tile of sharedTiles) {
    const match = secondTiles.get(tile.id);
    assert.ok(match, `overlap should retain tile ${tile.id}`);
    assert.deepEqual(match.points, tile.points);
    assert.deepEqual(match.split, tile.split);
    assert.deepEqual(match.pentagrid, tile.pentagrid);
    assert.ok(tile.points.every(({ vertexId, pentagridIndices }) => (
      vertexId.startsWith("pg:13:v:")
        && pentagridIndices.length === 5
        && pentagridIndices.every(Number.isInteger)
    )));
  }

  const secondEdges = new Map(second.edges.map((edge) => [edge.id, edge]));
  const sharedEdges = first.edges.filter((edge) => isSafelyInside(edge.center, inset * 2));
  assert.ok(sharedEdges.length > 100);
  for (const edge of sharedEdges) {
    const match = secondEdges.get(edge.id);
    assert.ok(match, `overlap should retain edge ${edge.id}`);
    assert.deepEqual(match.first, edge.first);
    assert.deepEqual(match.second, edge.second);
    assert.deepEqual(match.tileIds, edge.tileIds);
  }
});

test("world windows expose canonical P3, pentagrid, and Robinson geometry at distant centers", () => {
  const shared = {
    generation: 4,
    variation: 7,
    rotation: -0.23,
    center: { x: 123.45, y: -67.89 },
    radius: 0.62,
    halo: 0.24,
  };
  const p3 = createPenroseWorldWindow({ ...shared, presentation: "p3" });
  const pentagrid = createPenroseWorldWindow({ ...shared, presentation: "pentagrid" });
  const robinson = createPenroseWorldWindow({ ...shared, presentation: "robinson" });
  assert.ok(p3.tiles.length > 40);
  assert.ok(pentagrid.tiles.length > 40);
  assert.equal(robinson.tiles.length, p3.tiles.length * 2);
  assert.ok(penroseTileAtPoint(p3, shared.center));
  assert.ok(penroseTileAtPoint(pentagrid, shared.center));
  assert.ok(penroseTileAtPoint(robinson, shared.center));
  assert.equal(new Set(p3.tiles.map(({ id }) => id)).size, p3.tiles.length);
  assert.equal(new Set(p3.edges.map(({ id }) => id)).size, p3.edges.length);

  for (const tile of p3.tiles) {
    assert.ok(sideLengths(tile).every((length) => close(length, p3.edgeScale, 1e-8)));
    assert.equal(tile.split.length, 2);
    assert.ok(tile.split.every(({ vertexId }) => tile.vertexIds.includes(vertexId)));
    const splitLength = Math.hypot(
      tile.split[1].x - tile.split[0].x,
      tile.split[1].y - tile.split[0].y,
    );
    const diagonals = [
      Math.hypot(tile.points[2].x - tile.points[0].x, tile.points[2].y - tile.points[0].y),
      Math.hypot(tile.points[3].x - tile.points[1].x, tile.points[3].y - tile.points[1].y),
    ];
    assert.ok(close(splitLength, tile.type === "thick" ? Math.max(...diagonals) : Math.min(...diagonals)));
    assert.ok([1, 2, 3, 4].includes(tile.points[0].pentagridIndices.reduce(
      (sum, value) => sum + value,
      0,
    )));
  }
  for (const tile of robinson.tiles) {
    assert.equal(tile.points.length, 3);
    assert.match(tile.id, /^pg:7:tile:.+:triangle:pg:7:v:/);
    const expected = tile.type === "golden-triangle" ? [36, 72, 72] : [36, 36, 108];
    interiorAngles(tile).forEach((angle, index) => assert.ok(close(angle, expected[index], 1e-6)));
  }
  assert.ok(close(pentagrid.edgeScale, 0.96 / (5.1 + shared.generation * 0.58), 1e-12));
  assert.ok(pentagrid.edgeScale > 0.1 && pentagrid.edgeScale < 0.2);
  assert.throws(
    () => createPenroseWorldWindow({ presentation: "p2" }),
    /not supported: p2/,
  );
  assert.throws(
    () => createPenroseWorldWindow({ presentation: "p1" }),
    /not supported: p1/,
  );
});

test("P2 mirror-axis subdivision closes into exact kite and dart pairs", () => {
  let triangles = createPenroseKiteSeed();
  for (let generation = 0; generation < 6; generation += 1) {
    triangles = subdividePenroseKiteDartTriangles(triangles);
  }
  const paired = pairPenroseKiteDartTriangles(triangles);
  assert.equal(paired.specs.length, 1855);
  assert.equal(paired.boundaryTriangles, 60);
  assert.deepEqual(new Set(paired.specs.map(({ type }) => type)), new Set(["kite", "dart"]));
  assert.ok(paired.specs.every(({ points }) => points.length === 4));
});

test("the reader crosses unique physical edges and supports onset tracking", () => {
  const tiling = createPenroseTiling({ generation: 6 });
  const firstReader = createPenroseReader({ bounds: tiling.bounds, phase: 0.42, angle: Math.PI / 2 });
  const secondReader = createPenroseReader({ bounds: tiling.bounds, phase: 0.45, angle: Math.PI / 2 });
  const first = contactsForPenroseReader(tiling, firstReader);
  const second = contactsForPenroseReader(tiling, secondReader);
  assert.ok(first.length > 20);
  assert.equal(new Set(first.map(({ edgeId }) => edgeId)).size, first.length);
  assert.ok(first.every(({ point }) => close(
    point.x * firstReader.normal.x + point.y * firstReader.normal.y,
    firstReader.offset,
    1e-7,
  )));
  assert.ok(first.every(({ amount, along01, incidence, orientation }) => (
    amount >= 0 && amount <= 1
      && along01 >= 0 && along01 <= 1
      && incidence >= 0 && incidence <= 1
      && orientation >= 0 && orientation <= 1
  )));
  const entered = newlyEnteredPenroseContacts(second, new Set(first.map(({ edgeId }) => edgeId)));
  assert.ok(entered.length > 0);
  assert.ok(entered.every(({ edgeId }) => !first.some((contact) => contact.edgeId === edgeId)));

  const centerTile = penroseTileAtPoint(tiling, { x: 0, y: 0 });
  assert.ok(centerTile);
});

test("absolute readers keep contact pitch and lookahead coordinates centered in world space", () => {
  const center = { x: 87.25, y: -41.75 };
  const angle = 0.41;
  const span = 2;
  const tiling = createPenroseWorldWindow({
    presentation: "p3",
    generation: 5,
    variation: 9,
    rotation: 0.19,
    center,
    radius: 0.85,
    halo: 0.25,
  });
  const reader = createPenroseReader({ bounds: tiling.bounds, center, angle, span });
  assert.equal(reader.phase, null);
  assert.ok(close(reader.center.x, center.x));
  assert.ok(close(reader.center.y, center.y));
  assert.ok(close(reader.span, span));
  assert.ok(close(reader.offset, center.x * reader.normal.x + center.y * reader.normal.y));
  assert.ok(close(
    reader.tangentOffset,
    center.x * reader.direction.x + center.y * reader.direction.y,
  ));

  const contacts = contactsForPenroseReader(tiling, reader);
  assert.ok(contacts.length > 10);
  for (const contact of contacts) {
    const expectedAlong = contact.point.x * reader.direction.x
      + contact.point.y * reader.direction.y - reader.tangentOffset;
    assert.ok(close(contact.along, expectedAlong));
    assert.ok(close(contact.along01, expectedAlong / (span * 2) + 0.5));
    assert.ok(Math.abs(contact.along) <= span + 1e-9);
    assert.ok(close(contact.height01, 1 - contact.along01));
    assert.ok(close(penrosePitch01(contact, "height"), contact.height01));
  }

  const upcoming = upcomingPenroseEdges(tiling, reader, 1, 24);
  assert.ok(upcoming.length > 8);
  for (const entry of upcoming) {
    assert.ok(close(
      entry.along,
      entry.point.x * reader.direction.x
        + entry.point.y * reader.direction.y - reader.tangentOffset,
    ));
    assert.ok(Math.abs(entry.along) <= span + 1e-9);
  }
});

test("legacy finite phase normalization stays deterministic", () => {
  assert.ok(close(normalizedPenrosePhase(0.42), 0.42));
  assert.ok(close(normalizedPenrosePhase(1.08), 0.08));
  assert.ok(close(normalizedPenrosePhase(-0.08), 0.92));
});

test("upcoming edges predict the next physical reader intersections in both directions", () => {
  const tiling = createPenroseTiling({ generation: 5 });
  const reader = createPenroseReader({ bounds: tiling.bounds, phase: 0.5, angle: Math.PI / 2 });
  const active = new Set(contactsForPenroseReader(tiling, reader).map(({ edgeId }) => edgeId));
  const forward = upcomingPenroseEdges(tiling, reader, 1, 24);
  const reverse = upcomingPenroseEdges(tiling, reader, -1, 24);
  assert.ok(forward.length > 8);
  assert.ok(reverse.length > 8);
  assert.ok(forward.every(({ distance, edgeId }) => distance > 0 && !active.has(edgeId)));
  assert.ok(forward.every((entry, index) => index === 0 || (
    entry.distance >= forward[index - 1].distance
  )));
  assert.notEqual(forward[0].edgeId, reverse[0].edgeId);

  const predicted = forward[0];
  const projectionSpan = Math.abs(
    (predicted.edge.second.x - predicted.edge.first.x) * reader.normal.x
      + (predicted.edge.second.y - predicted.edge.first.y) * reader.normal.y
  );
  const advancedReader = {
    ...reader,
    offset: reader.offset + predicted.distance + Math.min(1e-6, projectionSpan * 0.1),
  };
  assert.ok(contactsForPenroseReader(tiling, advancedReader).some(({ edgeId }) => (
    edgeId === predicted.edgeId
  )));
});

test("tile graph coloring separates every pair that shares a physical edge", () => {
  for (const { id } of PENROSE_PRESENTATIONS) {
    const tiling = createPenroseTiling({ presentation: id, generation: 4, overscan: 1 });
    const colors = colorPenroseTiles(tiling, 6);
    assert.equal(colors.size, tiling.tiles.length);
    assert.ok([...colors.values()].every((value) => value >= 0 && value < 6));
    for (const edge of tiling.edges) {
      if (edge.tileIds.length !== 2) continue;
      assert.notEqual(
        colors.get(edge.tileIds[0]),
        colors.get(edge.tileIds[1]),
        `${id} adjacent tiles should contrast`,
      );
    }
  }
});

test("bounded readers keep a world-cache rebase sonically invisible", () => {
  const normalAngle = Math.PI / 5;
  const normal = { x: Math.cos(normalAngle), y: Math.sin(normalAngle) };
  const direction = { x: -normal.y, y: normal.x };
  const center = { x: normal.x * 0.235, y: normal.y * 0.235 };
  const options = {
    presentation: "p3",
    generation: 6,
    variation: 0,
    radius: 1.25,
    halo: 0.56,
  };
  const before = createPenroseWorldWindow({
    ...options,
    center: { x: 0, y: 0 },
  });
  const after = createPenroseWorldWindow({ ...options, center });
  const reader = createPenroseReader({
    bounds: before.bounds,
    center,
    angle: Math.atan2(direction.y, direction.x),
    span: 0.72,
  });
  const beforeContacts = contactsForPenroseReader(before, reader);
  const afterContacts = contactsForPenroseReader(after, reader);
  assert.ok(beforeContacts.length > 10);
  assert.deepEqual(
    beforeContacts.map(({ edgeId }) => edgeId),
    afterContacts.map(({ edgeId }) => edgeId),
  );
  assert.ok(afterContacts.every(({ along }) => Math.abs(along) <= reader.span + 1e-9));
});

test("seeded world-window coloring preserves overlap and colors every new neighbor safely", () => {
  const options = {
    presentation: "p3",
    generation: 5,
    variation: 0,
    radius: 1.05,
    halo: 0.45,
  };
  const before = createPenroseWorldWindow({
    ...options,
    center: { x: 0, y: 0 },
  });
  const after = createPenroseWorldWindow({
    ...options,
    center: { x: 0.2, y: 0 },
  });
  const beforeColors = colorPenroseTiles(before, 6);
  const afterColors = colorPenroseTiles(after, 6, beforeColors);
  const shared = after.tiles.filter(({ id }) => beforeColors.has(id));
  assert.ok(shared.length > 1_000);
  assert.ok(shared.every(({ id }) => afterColors.get(id) === beforeColors.get(id)));
  for (const edge of after.edges) {
    if (edge.tileIds.length !== 2) continue;
    assert.notEqual(afterColors.get(edge.tileIds[0]), afterColors.get(edge.tileIds[1]));
  }
});

test("Penrose page is an accessible researched instrument rather than a periodic lattice preset", async () => {
  const root = new URL("../", import.meta.url);
  const [html, css, app, geometry] = await Promise.all([
    readFile(new URL("penrose-tilings.html", root), "utf8"),
    readFile(new URL("penrose-tilings.css", root), "utf8"),
    readFile(new URL("penrose-tilings-app.js", root), "utf8"),
    readFile(new URL("src/penrose-tilings.js", root), "utf8"),
  ]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /<title>Penrose Tilings — Morphazoid<\/title>/);
  assert.match(html, /href="penrose-tilings\.html" aria-current="page">penrose tilings<\/a>/);
  assert.match(html, /P1[\s\S]*P2[\s\S]*P3/);
  assert.match(html, /Lattice[\s\S]*Spiral[\s\S]*Escher[\s\S]*Penrose/);
  assert.match(html, /doi\.org\/10\.1007\/BF03024384/);
  assert.match(html, /ems\.press\/content\/serial-issue-files\/13616/);
  assert.match(html, /doi\.org\/10\.1103\/PhysRevLett\.53\.1951/);
  assert.match(html, /id="stage"[\s\S]*aria-describedby="canvasInstructions liveStatus"/);
  assert.doesNotMatch(html, /penrose-stage-heading|stageKicker|stageSubtitle/);
  assert.doesNotMatch(app, /stageKicker|stageSubtitle/);
  assert.match(html, /id="playButton"[\s\S]*data-primary-transport/);
  assert.doesNotMatch(html, /id="readerAngle"|id="readerDirection"/);
  assert.match(html, /reader stays vertical at 90°/);
  assert.match(html, /id="presentation"[\s\S]*P3 rhombs[\s\S]*P2 kites[\s\S]*P1 pentagons[\s\S]*Robinson/);
  assert.match(html, /id="variation"[\s\S]*id="angleWarp"[\s\S]*id="palette"/);
  assert.match(html, /id="coverage"[\s\S]*Seamless infinite plane[\s\S]*Finite patch/);
  assert.match(html, /id="showOutlines"/);
  assert.match(html, /id="soundEngine"[\s\S]*Sine · sustained edge paths[\s\S]*FM percussion · new intersections/);
  assert.match(html, /id="showPaths"[\s\S]*id="showLookahead"/);
  assert.match(html, /id="pathControls"[\s\S]*id="pathVoiceCap"/);
  assert.match(html, /canonical angles are vital/i);
  assert.match(html, /src="penrose-tilings-app\.js"/);
  assert.match(css, /\.penrose-shell/);
  assert.match(css, /--accent: #ff4fd8/);
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(app, /contactsForPenroseReader/);
  assert.match(app, /pool\.strike/);
  assert.match(app, /fixedWorldToScreen[\s\S]*transformTilingPoint/);
  assert.match(app, /strikeFmPercussion/);
  assert.match(app, /pool\.setVoices/);
  assert.match(app, /pitchSource: "along"/);
  assert.doesNotMatch(app, /normalizedPenrosePhase\(nextPosition\)/);
  assert.match(app, /advanceWorld[\s\S]*refreshWorldWindow/);
  assert.doesNotMatch(app, /drawOrigin|state\.direction|readerAngle/);
  assert.match(app, /upcomingPenroseEdges/);
  assert.match(app, /drawSignalPaths/);
  assert.match(app, /PALETTES/);
  assert.match(app, /createPenroseWorldWindow/);
  assert.doesNotMatch(app, /overscan: state\.coverage === "infinite"/);
  assert.match(app, /if \(state\.showOutlines\)/);
  assert.match(geometry, /subdividePenroseTriangles/);
  assert.match(geometry, /createPenrosePentagridSpecs/);
  assert.match(geometry, /createPenroseP1Specs/);
  assert.match(geometry, /colorPenroseTiles/);
  assert.match(geometry, /upcomingPenroseEdges/);
  assert.doesNotMatch(`${html}\n${app}\n${geometry}`, /IsohedralTiling|TactileJS/);
});
