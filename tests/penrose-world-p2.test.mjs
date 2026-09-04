import assert from "node:assert/strict";
import test from "node:test";

import {
  PENROSE_PHI,
  createPenroseWorldWindow,
} from "../src/penrose-tilings.js";
import {
  derivePenroseP2World,
  markedPenroseRhombVertexIndex,
} from "../src/penrose-world-p2.js";

const commonBounds = Object.freeze({
  minX: -0.55,
  minY: -0.45,
  maxX: 0.55,
  maxY: 0.45,
});

function sideLengths(tile) {
  return tile.points.map((first, index) => {
    const second = tile.points[(index + 1) % tile.points.length];
    return Math.hypot(second.x - first.x, second.y - first.y);
  }).sort((first, second) => first - second);
}

test("de Bruijn address classes provide one unambiguous mark per P3 rhomb", () => {
  const world = createPenroseWorldWindow({
    presentation: "p3",
    generation: 5,
    variation: 4,
    radius: 0.7,
    halo: 0.3,
  });
  assert.ok(world.tiles.length > 100);
  for (const rhomb of world.tiles) {
    const sums = rhomb.points.map(({ pentagridIndices }) => (
      pentagridIndices.reduce((sum, value) => sum + value, 0)
    )).sort((first, second) => first - second);
    assert.ok(
      sums.join(",") === "1,2,2,3" || sums.join(",") === "2,3,3,4",
      `unexpected pentagrid index pattern ${sums.join(",")}`,
    );
    const marked = markedPenroseRhombVertexIndex(rhomb);
    const markedSum = rhomb.points[marked].pentagridIndices
      .reduce((sum, value) => sum + value, 0);
    assert.ok(markedSum === 1 || markedSum === 4);
  }
});

test("the marked-rhomb local rule derives exact P2 kites and darts", () => {
  const world = createPenroseWorldWindow({
    presentation: "p3",
    generation: 5,
    variation: 9,
    radius: 1.4,
    halo: 0.8,
  });
  const p2 = derivePenroseP2World(world, { bounds: commonBounds });
  assert.ok(p2.tiles.length > 100);
  assert.deepEqual(new Set(p2.tiles.map(({ type }) => type)), new Set(["kite", "dart"]));
  assert.equal(p2.rejectedFaces.length, 0);
  assert.ok(Math.abs(p2.counts.ratio - PENROSE_PHI) < 0.18);

  for (const tile of p2.tiles) {
    assert.equal(tile.points.length, 4);
    const lengths = sideLengths(tile);
    assert.ok(Math.abs(lengths[0] - lengths[1]) < 1e-8);
    assert.ok(Math.abs(lengths[2] - lengths[3]) < 1e-8);
    assert.ok(Math.abs(lengths[3] / lengths[0] - PENROSE_PHI) < 1e-8);
    assert.ok(tile.area > 0);
  }
  assert.ok(p2.edges.every(({ tileIds }) => tileIds.length === 1 || tileIds.length === 2));
});

test("overlapping P3 world queries derive identical P2 geometry and ids", () => {
  const options = {
    presentation: "p3",
    generation: 5,
    variation: 12,
    radius: 1.25,
    halo: 0.9,
  };
  const first = derivePenroseP2World(createPenroseWorldWindow({
    ...options,
    center: { x: 0, y: 0 },
  }), { bounds: commonBounds });
  const second = derivePenroseP2World(createPenroseWorldWindow({
    ...options,
    center: { x: 0.32, y: -0.18 },
  }), { bounds: commonBounds });

  assert.deepEqual(first.tiles.map(({ id }) => id), second.tiles.map(({ id }) => id));
  assert.deepEqual(
    first.tiles.map(({ id, points }) => ({ id, points })),
    second.tiles.map(({ id, points }) => ({ id, points })),
  );
  assert.deepEqual(first.edges.map(({ id }) => id), second.edges.map(({ id }) => id));
});

test("a bounded P2 query remains finite and valid far from the origin", () => {
  const world = createPenroseWorldWindow({
    presentation: "p3",
    generation: 5,
    variation: 2,
    center: { x: 1800, y: -1250 },
    radius: 0.8,
    halo: 0.55,
  });
  const p2 = derivePenroseP2World(world, { bounds: world.window.innerBounds });
  assert.ok(p2.tiles.length > 100);
  assert.ok(p2.tiles.length < 5000);
  assert.ok(p2.tiles.flatMap(({ points }) => points).every(({ x, y }) => (
    Number.isFinite(x) && Number.isFinite(y)
  )));
});

test("an unmarked thin rhomb is rejected instead of choosing a periodic-looking guess", () => {
  assert.throws(() => markedPenroseRhombVertexIndex({
    id: "unmarked",
    type: "thin",
    points: [
      { x: 0, y: 0, vertexId: "a" },
      { x: 1, y: 0, vertexId: "b" },
      { x: 1.2, y: 0.5, vertexId: "c" },
      { x: 0.2, y: 0.5, vertexId: "d" },
    ],
  }), /needs pentagrid addresses or an explicit mark/);
});
