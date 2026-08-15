import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEscherContours,
  contourEvents,
  contourPointAtDistance,
  selectEscherContours,
} from "../src/escher-contours.js";
import { buildLattice, tilingInfo } from "../src/lattice.js";
import {
  createHyperbolicTiling,
  createSimilarityOrbit,
  escherTessellationPreset,
  samplePoincareGeodesic,
} from "../src/escher-tessellation.js";

const EPSILON = 1e-7;
const BOUNDS = Object.freeze({ minX: -1.35, minY: -1.05, maxX: 1.35, maxY: 1.05 });

const close = (first, second, epsilon = EPSILON) => (
  Math.abs(first - second) <= epsilon
);

const pointDistance = (first, second) => (
  Math.hypot(first.x - second.x, first.y - second.y)
);

function assertPointClose(actual, expected, message = "points must coincide") {
  assert.ok(pointDistance(actual, expected) <= EPSILON, message);
}

function polylineLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += pointDistance(points[index - 1], points[index]);
  }
  return length;
}

function assertPolylineMatchesEitherDirection(actual, expected) {
  assert.equal(actual.length, expected.length);
  const forward = actual.every((point, index) => pointDistance(point, expected[index]) <= EPSILON);
  const reverse = actual.every((point, index) => (
    pointDistance(point, expected[expected.length - 1 - index]) <= EPSILON
  ));
  assert.ok(forward || reverse, "contour edge must be the source edge in either orientation");
}

function matchingEndpointPair(first, second) {
  const direct = pointDistance(first.points[0], second.points[0]) <= EPSILON
    && pointDistance(first.points.at(-1), second.points.at(-1)) <= EPSILON;
  const reversed = pointDistance(first.points[0], second.points.at(-1)) <= EPSILON
    && pointDistance(first.points.at(-1), second.points[0]) <= EPSILON;
  return direct || reversed;
}

function squareVertices(radius, rotation) {
  return Array.from({ length: 4 }, (_, index) => {
    const angle = rotation + Math.PI / 4 + index * Math.PI / 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function similarityTriangle(orbit, sector) {
  const corner = squareVertices(orbit.scale, orbit.rotation)[sector];
  const inner = squareVertices(orbit.innerScale, orbit.rotation + Math.PI / 4);
  const adjacent = inner.map((point, index) => ({
    point,
    index,
    distance: pointDistance(point, corner),
  })).sort((first, second) => (
    first.distance - second.distance || first.index - second.index
  )).slice(0, 2).map(({ point }) => point);
  return [corner, ...adjacent];
}

const euclideanPreset = escherTessellationPreset("counterform-current");
const euclideanGeometry = buildLattice({
  type: euclideanPreset.tilingType,
  parameters: euclideanPreset.parameters ?? tilingInfo(euclideanPreset.tilingType).defaultParameters,
  edgeCurves: euclideanPreset.edgeCurves,
  bounds: BOUNDS,
  scale: 0.34,
});
const similarityPreset = escherTessellationPreset("inward-infinity");
const similarityGeometry = createSimilarityOrbit(10);
const hyperbolicPreset = escherTessellationPreset("hyperbolic-current");
const hyperbolicGeometry = createHyperbolicTiling({
  p: hyperbolicPreset.p,
  q: hyperbolicPreset.q,
  layers: 2,
  maxTiles: 128,
});

const fixtures = Object.freeze([
  Object.freeze({
    name: "Euclidean",
    preset: euclideanPreset,
    geometry: euclideanGeometry,
    role: "tile",
  }),
  Object.freeze({
    name: "similarity",
    preset: similarityPreset,
    geometry: similarityGeometry,
    role: "similarity-cell",
  }),
  Object.freeze({
    name: "hyperbolic",
    preset: hyperbolicPreset,
    geometry: hyperbolicGeometry,
    role: "hyperbolic-tile",
  }),
]);

function buildFixtureField(fixture) {
  return buildEscherContours({
    preset: fixture.preset,
    geometry: fixture.geometry,
    maxContours: 256,
    maxPoints: 24_576,
  });
}

test("all three geometry models produce deterministic, deeply frozen finite contour records", () => {
  for (const fixture of fixtures) {
    const first = buildFixtureField(fixture);
    const second = buildFixtureField(fixture);

    assert.deepEqual(second, first, `${fixture.name} contour construction must be deterministic`);
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.contours));
    assert.ok(Object.isFrozen(first.byId));
    assert.ok(Object.isFrozen(first.bounds));
    assert.ok([
      first.bounds.minX,
      first.bounds.minY,
      first.bounds.maxX,
      first.bounds.maxY,
    ].every(Number.isFinite));
    assert.ok(first.bounds.maxX > first.bounds.minX);
    assert.ok(first.bounds.maxY > first.bounds.minY);
    assert.equal(first.presetId, fixture.preset.id);
    assert.equal(first.model, fixture.preset.model);
    assert.ok(first.contours.length > 3);
    assert.ok(first.sourceCount >= first.contours.length);

    for (const contour of first.contours) {
      assert.ok(Object.isFrozen(contour));
      assert.ok(Object.isFrozen(contour.center));
      assert.ok(Object.isFrozen(contour.points));
      assert.ok(Object.isFrozen(contour.edges));
      assert.ok(Object.isFrozen(contour.adjacentIds));
      assert.equal(first.byId[contour.id], contour);
      assert.equal(contour.model, fixture.preset.model);
      assert.equal(contour.role, fixture.role);
      assert.ok(contour.points.length >= 3);
      assert.ok(contour.edges.length >= 3);
      for (const numeric of [
        contour.level,
        contour.aspect,
        contour.color,
        contour.depth,
        contour.center.x,
        contour.center.y,
        contour.area,
        contour.perimeter,
      ]) {
        assert.ok(Number.isFinite(numeric), `${contour.id} must contain only finite geometry`);
      }
      assert.ok(contour.area > 0);
      assert.ok(contour.perimeter > 0);
      assert.ok(contour.points.every((point) => (
        point.x >= first.bounds.minX - EPSILON
          && point.x <= first.bounds.maxX + EPSILON
          && point.y >= first.bounds.minY - EPSILON
          && point.y <= first.bounds.maxY + EPSILON
      )));

      for (const point of contour.points) {
        assert.ok(Object.isFrozen(point));
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      }
      for (const edge of contour.edges) {
        assert.ok(Object.isFrozen(edge));
        assert.ok(Object.isFrozen(edge.points));
        assert.ok(Object.isFrozen(edge.adjacentIds));
        assert.ok(edge.points.every(Object.isFrozen));
        for (const numeric of [
          edge.index,
          edge.length,
          edge.curvature,
          edge.turn,
          edge.startDistance,
          edge.endDistance,
        ]) {
          assert.ok(Number.isFinite(numeric), `${edge.id} must contain finite metrics`);
        }
      }
    }
  }
});

test("Euclidean contour color classes match the rendered tile shading", () => {
  const cases = [
    ["counterform-current", 2, ({ first, second, aspect }) => first + second + aspect],
    ["triple-orbit", 3, ({ first, second, aspect }) => first + second * 2 + aspect],
    ["glide-parade", 4, ({ first, second, aspect }) => first + ((second % 2) + 2) % 2 * 2 + aspect],
  ];

  for (const [presetId, colorCount, expectedValue] of cases) {
    const preset = escherTessellationPreset(presetId);
    const geometry = buildLattice({
      type: preset.tilingType,
      parameters: preset.parameters ?? tilingInfo(preset.tilingType).defaultParameters,
      edgeCurves: preset.edgeCurves,
      bounds: BOUNDS,
      scale: 0.34,
    });
    const field = buildEscherContours({ preset, geometry, maxContours: 256 });
    assert.ok(new Set(field.contours.map(({ color }) => color)).size > 1);
    for (const contour of field.contours) {
      const [first = 0, second = 0] = contour.sourceId.split(",").map(Number);
      const expected = ((Math.floor(expectedValue({
        first,
        second,
        aspect: contour.aspect,
      })) % colorCount) + colorCount) % colorCount;
      assert.equal(contour.color, expected, `${presetId} ${contour.sourceId}`);
    }
  }
});

test("Euclidean contour paths are the buildLattice tiles and their exact sampled shared edges", () => {
  const field = buildFixtureField(fixtures[0]);
  const tiles = new Map(euclideanGeometry.tiles.map((tile) => [String(tile.key), tile]));
  const edges = new Map(euclideanGeometry.edges.map((edge) => [edge.key, edge]));

  for (const contour of field.contours) {
    const tile = tiles.get(contour.sourceId);
    assert.ok(tile, `${contour.id} must reference a real lattice tile`);
    assert.equal(contour.points.length, tile.points.length);
    contour.points.forEach((point, index) => assertPointClose(point, tile.points[index]));
    const samplesPerEdge = tile.points.length / contour.edges.length;
    assert.ok(Number.isInteger(samplesPerEdge));
    for (const edge of contour.edges) {
      const sourcePath = Array.from({ length: samplesPerEdge + 1 }, (_, offset) => (
        tile.points[(edge.index * samplesPerEdge + offset) % tile.points.length]
      ));
      assert.equal(edge.points.length, sourcePath.length);
      edge.points.forEach((point, index) => assertPointClose(point, sourcePath[index]));

      const source = edges.get(edge.sourceEdgeId);
      if (source) {
        assert.ok(source.adjacentTiles.some(({ key }) => String(key) === contour.sourceId));
        assertPolylineMatchesEitherDirection(edge.points, source.points);
      } else {
        assert.equal(edge.sourceEdgeId, `${contour.id}:edge:${edge.index}`);
      }
    }
  }
});

test("similarity contours are exactly the visible nested square-sector triangles", () => {
  const field = buildFixtureField(fixtures[1]);
  for (const contour of field.contours) {
    const orbit = similarityGeometry[contour.level];
    assert.ok(orbit, `${contour.id} must reference a real similarity level`);
    const expected = similarityTriangle(orbit, contour.sector);
    assert.equal(contour.points.length, expected.length);
    contour.points.forEach((point, index) => assertPointClose(point, expected[index]));
    contour.edges.forEach((edge, index) => {
      assert.deepEqual(edge.sourceEdgeId, `${contour.id}:edge:${index}`);
      assertPointClose(edge.points[0], expected[index]);
      assertPointClose(edge.points.at(-1), expected[(index + 1) % expected.length]);
    });
  }
});

test("hyperbolic contours are exactly the rendered Poincare geodesic tile borders", () => {
  const field = buildFixtureField(fixtures[2]);
  const tiles = new Map(hyperbolicGeometry.map((tile) => [String(tile.id), tile]));

  for (const contour of field.contours) {
    const tile = tiles.get(contour.sourceId);
    assert.ok(tile, `${contour.id} must reference a generated hyperbolic tile`);
    const segments = tile.depth <= 1 ? 12 : tile.depth <= 3 ? 6 : 3;
    assert.equal(contour.edges.length, tile.points.length);
    for (const edge of contour.edges) {
      const expected = samplePoincareGeodesic(
        tile.points[edge.index],
        tile.points[(edge.index + 1) % tile.points.length],
        segments,
      );
      assert.equal(edge.sourceEdgeId, `${contour.id}:edge:${edge.index}`);
      assert.equal(edge.points.length, expected.length);
      edge.points.forEach((point, index) => assertPointClose(point, expected[index]));
    }
  }
});

test("contours close by cumulative arclength and distance lookup wraps at real vertices", () => {
  for (const fixture of fixtures) {
    const field = buildFixtureField(fixture);
    for (const contour of field.contours.slice(0, 24)) {
      let cumulative = 0;
      contour.edges.forEach((edge, index) => {
        assert.ok(close(edge.startDistance, cumulative));
        assert.ok(close(edge.length, polylineLength(edge.points)));
        cumulative += edge.length;
        assert.ok(close(edge.endDistance, cumulative));

        const following = contour.edges[(index + 1) % contour.edges.length];
        assertPointClose(edge.points.at(-1), following.points[0], `${edge.id} must join the next edge`);

        const atVertex = contourPointAtDistance(contour, edge.startDistance);
        assert.equal(atVertex.edgeId, edge.id);
        assertPointClose(atVertex.point, edge.points[0]);

        const atMiddle = contourPointAtDistance(contour, edge.startDistance + edge.length / 2);
        assert.equal(atMiddle.edgeId, edge.id);
        assert.ok(close(atMiddle.edgeProgress, 0.5));
      });
      assert.ok(close(cumulative, contour.perimeter));
      assert.ok(close(contour.edges.at(-1).endDistance, contour.perimeter));

      const start = contourPointAtDistance(contour, 0);
      const closed = contourPointAtDistance(contour, contour.perimeter);
      const negativeLoop = contourPointAtDistance(contour, -contour.perimeter);
      assertPointClose(closed.point, start.point);
      assertPointClose(negativeLoop.point, start.point);
      assert.equal(closed.edgeId, start.edgeId);
      assert.ok(close(closed.distance, 0));
    }
  }
});

test("every corner event belongs to an actual contour edge at that edge's real start", () => {
  for (const fixture of fixtures) {
    const field = buildFixtureField(fixture);
    for (const contour of field.contours.slice(0, 24)) {
      const events = contourEvents(contour);
      assert.ok(Object.isFrozen(events));
      assert.equal(events.length, contour.edges.length);
      for (const event of events) {
        assert.ok(Object.isFrozen(event));
        const edge = contour.edges.find(({ id }) => id === event.edgeId);
        assert.ok(edge, `${event.id} must reference an actual edge`);
        assert.equal(event.contourId, contour.id);
        assert.equal(event.edgeIndex, edge.index);
        assert.ok(close(event.afterDistance, edge.startDistance));
        assert.equal(event.point, edge.points[0]);
        assert.ok(Number.isFinite(event.turn));
        assert.ok(Number.isFinite(event.curvature));
      }
    }
  }
});

for (const fixtureIndex of [0, 2]) {
  const fixture = fixtures[fixtureIndex];
  test(`${fixture.name} adjacency is mutual and every link is a real shared border`, () => {
    const field = buildFixtureField(fixture);
    let links = 0;
    for (const contour of field.contours) {
      for (const adjacentId of contour.adjacentIds) {
        links += 1;
        const adjacent = field.byId[adjacentId];
        assert.ok(adjacent, `${contour.id} must not link outside the retained contour field`);
        assert.ok(adjacent.adjacentIds.includes(contour.id), "contour adjacency must be mutual");

        const shared = contour.edges.find((edge) => (
          edge.adjacentIds.includes(adjacent.id)
          && adjacent.edges.some((otherEdge) => (
            otherEdge.adjacentIds.includes(contour.id)
            && matchingEndpointPair(edge, otherEdge)
          ))
        ));
        assert.ok(shared, `${contour.id} → ${adjacent.id} must identify a real shared edge`);
      }
    }
    assert.ok(links > field.contours.length, `${fixture.name} needs a connected contour graph`);
    assert.equal(links % 2, 0, "mutual links must occur in pairs");
  });
}

test("Shape, Neighbors, and Pattern selection preserve the selection and obey hard caps", () => {
  for (const fixture of fixtures) {
    const field = buildFixtureField(fixture);
    const selected = field.contours.find(({ adjacentIds }) => adjacentIds.length > 0)
      ?? field.contours[Math.min(3, field.contours.length - 1)];

    const shape = selectEscherContours(field, {
      mode: "shape",
      selectedId: selected.id,
      maxActive: 5,
    });
    assert.ok(Object.isFrozen(shape));
    assert.deepEqual(shape.map(({ id }) => id), [selected.id]);

    for (const [mode, cap] of [["neighbors", 4], ["pattern", 5]]) {
      const active = selectEscherContours(field, {
        mode,
        selectedId: selected.id,
        neighborReach: 4,
        maxActive: cap,
      });
      assert.ok(Object.isFrozen(active));
      assert.ok(active.length >= 1 && active.length <= cap);
      assert.equal(active[0].id, selected.id);
      assert.equal(new Set(active.map(({ id }) => id)).size, active.length);
      assert.ok(active.every(({ id }) => field.byId[id]));
    }
  }
});

test("equal geometric speed makes period equal perimeter divided by speed", () => {
  const field = buildFixtureField(fixtures[1]);
  const sameSector = field.contours
    .filter(({ sector }) => sector === 0)
    .sort((first, second) => first.level - second.level);
  const outer = sameSector[0];
  const inner = sameSector.at(-1);
  const speed = 0.32;
  const outerPeriod = outer.perimeter / speed;
  const innerPeriod = inner.perimeter / speed;

  assert.ok(inner.perimeter < outer.perimeter);
  assert.ok(innerPeriod < outerPeriod, "the smaller nested outline must recur sooner");
  assert.ok(close(outerPeriod * speed, outer.perimeter));
  assert.ok(close(innerPeriod * speed, inner.perimeter));
  assertPointClose(
    contourPointAtDistance(outer, speed * outerPeriod).point,
    contourPointAtDistance(outer, 0).point,
  );
  assertPointClose(
    contourPointAtDistance(inner, speed * innerPeriod).point,
    contourPointAtDistance(inner, 0).point,
  );
  assert.ok(
    Math.floor(outerPeriod / innerPeriod) >= 10,
    "nested similarity outlines should complete many loops during the largest outline's phrase",
  );
});
