import assert from "node:assert/strict";
import test from "node:test";

import {
  COLONY_SYRINX_GRAPH_NODE_IDS,
  COLONY_SYRINX_GRAPH_REGIONS,
  applyColonySyrinxGraphAcoustics,
  colonySyrinxEndpointEligible,
  colonySyrinxGraphLayoutFromOrganLayout,
  colonySyrinxGraphNodeCollisionRadius,
  colonySyrinxLungFeedEligible,
  colonySyrinxLungFeedGeometries,
  colonySyrinxLungFeedGeometry,
  colonySyrinxOrganLayoutFromGraph,
  colonySyrinxRouteGeometries,
  colonySyrinxRouteGeometry,
  createColonySyrinxGraphLayout,
  isColonySyrinxGraphNodeEnabled,
  moveColonySyrinxGraphNode,
  sanitizeColonySyrinxGraphLayout,
} from "../src/colony-syrinx-graph.js";
import {
  createColonySyrinxState,
  formatColonySyrinxPreset,
  parseColonySyrinxPreset,
  randomizeColonySyrinxState,
} from "../src/colony-syrinx.js";

const nodesOfKind = (layout, kind) => Object.values(layout.nodes).filter((node) => (
  node.kind === kind
));

const span = (values) => Math.max(...values) - Math.min(...values);

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

const assertCollisionSpacing = (layout, enabled = null) => {
  for (const kind of ["lung", "source", "mouth"]) {
    const nodes = nodesOfKind(layout, kind).filter((node) => (
      isColonySyrinxGraphNodeEnabled(node, enabled)
    ));
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const first = nodes[left];
        const second = nodes[right];
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        const required = colonySyrinxGraphNodeCollisionRadius(first)
          + colonySyrinxGraphNodeCollisionRadius(second)
          + COLONY_SYRINX_GRAPH_REGIONS[kind].gap;
        assert.ok(
          distance >= required - 1e-7,
          `${first.id} and ${second.id} overlap by ${(required - distance).toFixed(3)}`,
        );
      }
    }
  }
};

test("seeded graph layouts are deterministic, irregular, separated, and region bounded", () => {
  const first = createColonySyrinxGraphLayout({ seed: 0x12345678 });
  const repeated = createColonySyrinxGraphLayout({ seed: 0x12345678 });
  const different = createColonySyrinxGraphLayout({ seed: 0x87654321 });

  assert.deepEqual(first, repeated);
  assert.deepEqual(Object.keys(first).sort(), ["nodes", "seed"]);
  assert.deepEqual(
    Object.keys(first.nodes["lung-1"]).sort(),
    ["id", "index", "kind", "rotation", "scale", "variant", "x", "y"],
  );
  assert.equal(Object.keys(first.nodes).length, 23);
  assert.deepEqual(Object.keys(first.nodes), COLONY_SYRINX_GRAPH_NODE_IDS);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.values(first.nodes).every(Object.isFrozen));

  assert.equal(nodesOfKind(first, "lung").length, 16);
  assert.equal(nodesOfKind(first, "source").length, 4);
  assert.equal(nodesOfKind(first, "mouth").length, 3);

  for (const node of Object.values(first.nodes)) {
    const region = COLONY_SYRINX_GRAPH_REGIONS[node.kind];
    assert.ok(node.x >= region.minX && node.x <= region.maxX, `${node.id} x outside region`);
    assert.ok(node.y >= region.minY && node.y <= region.maxY, `${node.id} y outside region`);
    assert.ok(Number.isFinite(node.rotation));
    assert.ok(Number.isFinite(node.scale));
  }

  const lungs = nodesOfKind(first, "lung");
  const sources = nodesOfKind(first, "source");
  const mouths = nodesOfKind(first, "mouth");
  assert.ok(mean(lungs.map(({ x }) => x)) < mean(sources.map(({ x }) => x)));
  assert.ok(mean(sources.map(({ x }) => x)) < mean(mouths.map(({ x }) => x)));
  assert.ok(span(lungs.map(({ x }) => x)) > 260, "lungs must not collapse into a column");
  assert.ok(span(sources.map(({ x }) => x)) > 220, "sources must not collapse into a column");
  assert.ok(span(mouths.map(({ x }) => x)) > 100, "mouths must not collapse into a column");
  for (const nodes of [lungs, sources, mouths]) {
    assert.equal(
      new Set(nodes.map(({ x }) => x.toFixed(2))).size,
      nodes.length,
      `${nodes[0].kind} nodes share an exact x column`,
    );
    assert.equal(
      new Set(nodes.map(({ y }) => y.toFixed(2))).size,
      nodes.length,
      `${nodes[0].kind} nodes share an exact y row`,
    );
  }
  assertCollisionSpacing(first);

  const movedBySeed = COLONY_SYRINX_GRAPH_NODE_IDS.filter((id) => (
    Math.hypot(
      first.nodes[id].x - different.nodes[id].x,
      first.nodes[id].y - different.nodes[id].y,
    ) > 10
  ));
  assert.ok(movedBySeed.length >= 18, `${movedBySeed.length} nodes differed clearly by seed`);

  for (let seed = 0; seed < 32; seed += 1) {
    const layout = createColonySyrinxGraphLayout({ seed });
    assertCollisionSpacing(layout);
    for (const feed of colonySyrinxLungFeedGeometries(layout)) {
      assert.ok(
        feed.anchors.lung.x < feed.anchors.source.x,
        `${feed.id} does not flow left to right`,
      );
    }
  }
});

test("layout sanitization clamps fields, fills fixed slots, and collision-spaces enabled nodes", () => {
  const fallback = createColonySyrinxGraphLayout({ seed: 22 });
  const input = {
    seed: "wet pressure",
    nodes: {
      ...fallback.nodes,
      "lung-1": { ...fallback.nodes["lung-1"], x: -50_000, y: Infinity, scale: 99, rotation: -500 },
      "lung-2": { ...fallback.nodes["lung-2"], x: 58, y: 58 },
      "source-1": { ...fallback.nodes["source-1"], x: 500, y: 300 },
      "source-2": { ...fallback.nodes["source-2"], x: 500, y: 300 },
      extra: { id: "extra", kind: "mouth", index: 99, x: 0, y: 0 },
    },
  };
  delete input.nodes["mouth-3"];
  const before = structuredClone(input);
  const sanitized = sanitizeColonySyrinxGraphLayout(input, fallback);

  assert.deepEqual(input, before, "sanitizing must not mutate caller data");
  assert.deepEqual(Object.keys(sanitized.nodes), COLONY_SYRINX_GRAPH_NODE_IDS);
  assert.equal(sanitized.nodes["lung-1"].x, COLONY_SYRINX_GRAPH_REGIONS.lung.minX);
  assert.equal(sanitized.nodes["lung-1"].y, fallback.nodes["lung-1"].y);
  assert.equal(sanitized.nodes["lung-1"].scale, 0.72);
  assert.equal(sanitized.nodes["lung-1"].rotation, -11);
  assert.ok(Number.isInteger(sanitized.nodes["lung-1"].variant));
  assert.deepEqual(sanitized.nodes["mouth-3"], fallback.nodes["mouth-3"]);
  assert.notDeepEqual(
    [sanitized.nodes["source-1"].x, sanitized.nodes["source-1"].y],
    [sanitized.nodes["source-2"].x, sanitized.nodes["source-2"].y],
  );
  assertCollisionSpacing(sanitized);
});

test("node movement is immutable, region clamped, and resolves active collisions", () => {
  const original = createColonySyrinxGraphLayout({ seed: 777 });
  const originalSnapshot = structuredClone(original);
  const clamped = moveColonySyrinxGraphNode(
    original,
    "lung-1",
    { x: 50_000, y: -50_000 },
  );

  assert.deepEqual(original, originalSnapshot);
  assert.notEqual(clamped, original);
  assert.ok(clamped.nodes["lung-1"].x <= COLONY_SYRINX_GRAPH_REGIONS.lung.maxX);
  assert.ok(clamped.nodes["lung-1"].y >= COLONY_SYRINX_GRAPH_REGIONS.lung.minY);
  for (const id of COLONY_SYRINX_GRAPH_NODE_IDS.filter((id) => id !== "lung-1")) {
    assert.deepEqual(clamped.nodes[id], original.nodes[id], `${id} moved with lung-1`);
  }

  const second = original.nodes["lung-2"];
  const collisionResolved = moveColonySyrinxGraphNode(original, "lung-1", second);
  assert.deepEqual(collisionResolved.nodes["lung-2"], second);
  assert.notDeepEqual(
    [collisionResolved.nodes["lung-1"].x, collisionResolved.nodes["lung-1"].y],
    [second.x, second.y],
  );
  assertCollisionSpacing(collisionResolved);
});

test("graph positions compactly round-trip through the shareable sound preset", () => {
  let layout = createColonySyrinxGraphLayout({ seed: 0xa11e1 });
  layout = moveColonySyrinxGraphNode(layout, "lung-3", { x: 333, y: 444 });
  layout = moveColonySyrinxGraphNode(layout, "source-2", { x: 655, y: 118 });
  layout = moveColonySyrinxGraphNode(layout, "mouth-1", { x: 742, y: 488 });
  const organLayout = colonySyrinxOrganLayoutFromGraph(layout);
  const state = createColonySyrinxState({ organLayout });
  const decoded = parseColonySyrinxPreset(formatColonySyrinxPreset(state));
  const restored = colonySyrinxGraphLayoutFromOrganLayout(decoded.organLayout);

  assert.deepEqual(decoded.organLayout, organLayout);
  assert.deepEqual(restored, layout);
  assert.equal(Object.keys(decoded.organLayout).length, 4);
  assert.equal(decoded.organLayout.lungs.length, 16);
  assert.equal(decoded.organLayout.sources.length, 4);
  assert.equal(decoded.organLayout.mouths.length, 3);
});

test("randomized anatomy is already collision-safe and round-trips without a hidden repair", () => {
  for (let seed = 0; seed < 64; seed += 1) {
    const randomized = randomizeColonySyrinxState(createColonySyrinxState(), {
      scope: "all",
      seed,
    });
    const graph = colonySyrinxGraphLayoutFromOrganLayout(randomized.organLayout);
    assertCollisionSpacing(graph);
    assert.deepEqual(
      colonySyrinxOrganLayoutFromGraph(graph),
      randomized.organLayout,
      `randomized seed ${seed} required an unrecorded collision repair`,
    );
  }
});

test("moving each organ family changes a bounded audio configuration without accumulating", () => {
  const state = createColonySyrinxState();
  const layout = colonySyrinxGraphLayoutFromOrganLayout(state.organLayout);
  const baseline = applyColonySyrinxGraphAcoustics(state, layout);
  const repeated = applyColonySyrinxGraphAcoustics(state, layout);
  assert.deepEqual(repeated, baseline, "position projection must be stable");

  const movedLung = moveColonySyrinxGraphNode(layout, "lung-1", { x: 360, y: 500 });
  const lungSound = applyColonySyrinxGraphAcoustics(state, movedLung);
  assert.notDeepEqual(lungSound.banks[0], baseline.banks[0]);
  assert.deepEqual(lungSound.banks.slice(1), baseline.banks.slice(1));

  const movedSource = moveColonySyrinxGraphNode(layout, "source-1", { x: 680, y: 80 });
  const sourceSound = applyColonySyrinxGraphAcoustics(state, movedSource);
  assert.notEqual(sourceSound.phonators[0].frequencyHz, baseline.phonators[0].frequencyHz);
  assert.notEqual(sourceSound.phonators[0].tension, baseline.phonators[0].tension);
  assert.notDeepEqual(sourceSound.routes[0], baseline.routes[0]);

  const movedMouth = moveColonySyrinxGraphNode(layout, "mouth-1", { x: 900, y: 100 });
  const mouthSound = applyColonySyrinxGraphAcoustics(state, movedMouth);
  assert.notEqual(mouthSound.mouths[0].resonanceHz, baseline.mouths[0].resonanceHz);
  assert.notEqual(mouthSound.mouths[0].opening, baseline.mouths[0].opening);
  assert.notEqual(mouthSound.routes[0][0], baseline.routes[0][0]);

  for (const projected of [baseline, lungSound, sourceSound, mouthSound]) {
    assert.ok(projected.banks.every(({ drive, compliance, leak }) => (
      drive >= 0 && drive <= 1.5 && compliance >= 0.2 && compliance <= 2.5
        && leak >= 0 && leak <= 0.6
    )));
    assert.ok(projected.routes.flat().every((aperture) => aperture >= 0 && aperture <= 1));
    assert.ok(projected.mouths.every(({ opening, pan, resonanceHz }) => (
      opening >= 0 && opening <= 1 && pan >= -1 && pan <= 1
        && resonanceHz >= 20 && resonanceHz <= 12_000
    )));
  }
});

test("moving a disabled lung cannot alter the projected sound", () => {
  const state = createColonySyrinxState({
    lungEnabled: [false, ...Array(15).fill(true)],
  });
  const layout = colonySyrinxGraphLayoutFromOrganLayout(state.organLayout);
  const baseline = applyColonySyrinxGraphAcoustics(state, layout);
  const moved = moveColonySyrinxGraphNode(layout, "lung-1", { x: 370, y: 545 });

  assert.deepEqual(applyColonySyrinxGraphAcoustics(state, moved), baseline);
});

test("route geometry exposes cubic source and mouth anchors for all twelve model routes", () => {
  const layout = createColonySyrinxGraphLayout({ seed: 9182 });
  const routes = colonySyrinxRouteGeometries(layout);

  assert.equal(routes.length, 12);
  assert.equal(new Set(routes.map(({ id }) => id)).size, 12);
  assert.ok(Object.isFrozen(routes));
  for (const route of routes) {
    assert.match(route.d, /^M [-\d.]+ [-\d.]+ C [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/);
    assert.equal(route.anchors.source.nodeId, `source-${route.phonatorIndex + 1}`);
    assert.equal(route.anchors.mouth.nodeId, `mouth-${route.mouthIndex + 1}`);
    assert.equal(route.anchors.source.side, "out");
    assert.equal(route.anchors.mouth.side, "in");
    const direction = Math.sign(route.anchors.mouth.x - route.anchors.source.x) || 1;
    assert.ok((route.controls.source.x - route.anchors.source.x) * direction > 0);
    assert.ok((route.anchors.mouth.x - route.controls.mouth.x) * direction > 0);
    assert.equal(route.eligible, true);
  }

  const before = colonySyrinxRouteGeometry(layout, 0, 2);
  const movedLayout = moveColonySyrinxGraphNode(layout, "source-1", {
    x: layout.nodes["source-1"].x + 35,
    y: layout.nodes["source-1"].y + 19,
  });
  const after = colonySyrinxRouteGeometry(movedLayout, 0, 2);
  assert.notDeepEqual(after.anchors.source, before.anchors.source);
  assert.deepEqual(after.anchors.mouth, before.anchors.mouth);
  assert.notEqual(after.d, before.d);
});

test("feed geometry maps every lung to its fixed bank source", () => {
  const layout = createColonySyrinxGraphLayout({ seed: "fixed feeds" });
  const feeds = colonySyrinxLungFeedGeometries(layout);

  assert.equal(feeds.length, 16);
  assert.equal(new Set(feeds.map(({ id }) => id)).size, 16);
  for (const feed of feeds) {
    const expectedSource = Math.floor(feed.lungIndex / 4);
    assert.equal(feed.sourceIndex, expectedSource);
    assert.equal(feed.phonatorIndex, expectedSource);
    assert.equal(feed.anchors.lung.nodeId, `lung-${feed.lungIndex + 1}`);
    assert.equal(feed.anchors.source.nodeId, `source-${expectedSource + 1}`);
    assert.equal(feed.anchors.lung.side, "out");
    assert.equal(feed.anchors.source.side, "in");
    assert.ok(feed.anchors.lung.x < feed.anchors.source.x);
    const direction = Math.sign(feed.anchors.source.x - feed.anchors.lung.x) || 1;
    assert.ok((feed.controls.lung.x - feed.anchors.lung.x) * direction > 0);
    assert.ok((feed.anchors.source.x - feed.controls.source.x) * direction > 0);
    assert.match(feed.d, /^M .+ C .+$/);
  }
  assert.deepEqual(
    colonySyrinxLungFeedGeometry(layout, "lung-8", 1),
    feeds[7],
  );
  assert.throws(
    () => colonySyrinxLungFeedGeometry(layout, 7, 2),
    /fixed source/,
  );

  const crossed = sanitizeColonySyrinxGraphLayout({
    seed: layout.seed,
    nodes: Object.fromEntries(Object.values(layout.nodes).map((node) => [
      node.id,
      {
        ...node,
        x: node.kind === "lung"
          ? COLONY_SYRINX_GRAPH_REGIONS.lung.maxX
          : node.kind === "source" ? COLONY_SYRINX_GRAPH_REGIONS.source.minX : node.x,
      },
    ])),
  }, layout);
  for (const feed of colonySyrinxLungFeedGeometries(crossed)) {
    assert.ok(
      feed.anchors.lung.x < feed.anchors.source.x,
      `${feed.id} anchors crossed when its node regions overlapped`,
    );
  }
});

test("route and feed eligibility follows endpoint masks without entering layout state", () => {
  const enabled = {
    lungEnabled: Array.from({ length: 16 }, (_, index) => index !== 1),
    phonatorEnabled: [true, false, true, true],
    mouthEnabled: [true, true, false],
  };
  const layout = createColonySyrinxGraphLayout({ seed: 91 });

  assert.equal(isColonySyrinxGraphNodeEnabled("lung-1", enabled), true);
  assert.equal(isColonySyrinxGraphNodeEnabled("lung-2", enabled), false);
  assert.equal(isColonySyrinxGraphNodeEnabled("source-2", enabled), false);
  assert.equal(isColonySyrinxGraphNodeEnabled("mouth-3", enabled), false);
  assert.equal(isColonySyrinxGraphNodeEnabled("unknown", enabled), false);

  assert.equal(colonySyrinxEndpointEligible(enabled, 0, 0), true);
  assert.equal(colonySyrinxEndpointEligible(enabled, 1, 0), false);
  assert.equal(colonySyrinxEndpointEligible(enabled, 0, 2), false);
  assert.equal(colonySyrinxEndpointEligible(enabled, 3, 1), true);
  assert.equal(colonySyrinxEndpointEligible(enabled, 8, 8), false);

  assert.equal(colonySyrinxLungFeedEligible(enabled, 0, 0), true);
  assert.equal(colonySyrinxLungFeedEligible(enabled, 1, 0), false);
  assert.equal(colonySyrinxLungFeedEligible(enabled, 4, 1), false);
  assert.equal(colonySyrinxLungFeedEligible(enabled, 15, 3), true);
  assert.equal(colonySyrinxLungFeedEligible(enabled, 98, 24), false);

  assert.equal(colonySyrinxRouteGeometry(layout, 0, 2, { state: enabled }).eligible, false);
  assert.equal(colonySyrinxLungFeedGeometry(layout, 4, 1, { state: enabled }).eligible, false);
  assert.deepEqual(
    Object.keys(layout).sort(),
    ["nodes", "seed"],
    "enabled masks and sonic state do not enter the layout object",
  );
  assert.equal("routes" in layout, false);
  assert.equal("lungEnabled" in layout, false);
});
