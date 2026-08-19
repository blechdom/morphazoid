import assert from "node:assert/strict";
import test from "node:test";

import {
  createRubixVisibilityProfile,
  projectedPolygonArea,
  rubixStickerVisibility,
  rubixVisibilityGain,
} from "../src/rubix-visibility.js";

const rectangle = (width, height, x = 0, y = 0) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

test("projected polygon area is winding-independent, finite, and safe", () => {
  const polygon = rectangle(4, 3, 10, -8);
  assert.equal(projectedPolygonArea(polygon), 12);
  assert.equal(projectedPolygonArea([...polygon].reverse()), 12);
  assert.equal(projectedPolygonArea([
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 0, y: 4 },
  ]), 12);
  assert.equal(projectedPolygonArea([]), 0);
  assert.equal(projectedPolygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }]), 0);
  assert.equal(projectedPolygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: NaN, y: 2 }]), 0);
  assert.equal(projectedPolygonArea(rectangle(Number.MAX_VALUE, Number.MAX_VALUE)), 0);
});

test("visibility profile normalizes projected sticker areas by stable sticker ID", () => {
  const profile = createRubixVisibilityProfile([
    { sticker: { id: "large" }, stickerPoints: rectangle(4, 4) },
    { sticker: { id: "small" }, projectedPoints: rectangle(2, 2) },
    {
      sticker: { id: "fan" },
      projectedTriangles: [
        [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 2 }],
        [{ x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }],
      ],
    },
    { sticker: { id: "hidden" }, stickerPoints: rectangle(20, 20), visible: false },
    { sticker: { id: "explicit-hidden" }, points: rectangle(20, 20), hidden: true },
    { sticker: { id: "duplicate" }, stickerPoints: rectangle(1, 1) },
    { sticker: { id: "duplicate" }, stickerPoints: rectangle(2, 2) },
    { sticker: {}, stickerPoints: rectangle(20, 20) },
  ]);

  assert.ok(Object.isFrozen(profile));
  assert.deepEqual(profile, {
    large: 1,
    small: 0.25,
    fan: 0.5,
    hidden: 0,
    "explicit-hidden": 0,
    duplicate: 0.25,
  });
  assert.equal(rubixStickerVisibility(profile, "large"), 1);
  assert.equal(rubixStickerVisibility(profile, { id: "small" }), 0.25);
  assert.equal(rubixStickerVisibility(profile, "hidden"), 0);
  assert.equal(rubixStickerVisibility(profile, "missing"), 0);
  assert.equal(rubixStickerVisibility(profile, null), 0);
});

test("visibility sums a center fan even when its outer corner order would bow-tie", () => {
  const center = { x: 1, y: 1 };
  const corners = [
    { x: 0, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
    { x: 2, y: 0 },
  ];
  assert.equal(projectedPolygonArea(corners), 0, "the legacy outer quad cancels itself");
  const projectedTriangles = corners.map((corner, index) => [
    center,
    corner,
    corners[(index + 1) % corners.length],
  ]);
  const profile = createRubixVisibilityProfile([
    { sticker: { id: "folded" }, projectedTriangles },
  ]);
  assert.equal(profile.folded, 1);
});

test("empty and entirely hidden geometry produce only silent lookups", () => {
  const empty = createRubixVisibilityProfile();
  const hidden = createRubixVisibilityProfile([
    { sticker: { id: "a" }, stickerPoints: rectangle(3, 3), hidden: true },
    { sticker: { id: "b" }, stickerPoints: [], visible: true },
  ]);
  assert.deepEqual(empty, {});
  assert.deepEqual(hidden, { a: 0, b: 0 });
  assert.equal(rubixStickerVisibility(empty, "a"), 0);
  assert.equal(rubixStickerVisibility(hidden, "a"), 0);
  assert.equal(rubixStickerVisibility(hidden, "b"), 0);
});

test("visibility gain always silences zero and blends visible areas from unity", () => {
  for (const amount of [-4, 0, 0.5, 1, 8, NaN, Infinity]) {
    assert.equal(rubixVisibilityGain(0, amount), 0);
    assert.equal(rubixVisibilityGain(-1, amount), 0);
  }

  assert.equal(rubixVisibilityGain(0.4, 0), 1);
  assert.equal(rubixVisibilityGain(0.4, 0.5), 0.7);
  assert.equal(rubixVisibilityGain(0.4, 1), 0.4);
  assert.equal(rubixVisibilityGain(0.4, -1), 1);
  assert.equal(rubixVisibilityGain(0.4, 2), 0.4);
  assert.equal(rubixVisibilityGain(2, 1), 1);
  assert.equal(rubixVisibilityGain(NaN, 0), 0);
  assert.equal(rubixVisibilityGain(Infinity, 0), 0);

  for (const visibility of [-Infinity, -1, 0, 0.2, 1, 4, NaN, Infinity]) {
    for (const amount of [-Infinity, -1, 0, 0.5, 1, 4, NaN, Infinity]) {
      const gain = rubixVisibilityGain(visibility, amount);
      assert.ok(Number.isFinite(gain));
      assert.ok(gain >= 0 && gain <= 1);
    }
  }
});
