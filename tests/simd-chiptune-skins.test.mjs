import assert from "node:assert/strict";
import test from "node:test";
import {
  CHIPTUNE_DANCER_IDENTITIES,
  drawChiptuneDancer,
} from "../src/instruments/webgpu-chiptune/webgpu-chiptune-dancers.js";
import {
  SKINS,
  normalizeChiptuneSkin,
  drawSimdChiptuneDancer,
} from "../src/instruments/simd-chiptune/skins.js";

const originalKeys = Object.keys(CHIPTUNE_DANCER_IDENTITIES);
const colors = Object.freeze({
  outline: "#071220", mid: "#4c5798", body: "#899aff",
  highlight: "#cedaff", spark: "#fff7a1",
});
const poses = [
  { dancePhase: 0 },
  { dancePhase: 0.23 },
  { dancePhase: 0.63 },
  { dancePhase: 0.96 },
  { dancePhase: 0.63, resting: true },
  { dancePhase: 0.63, reducedMotion: true },
];

function actorFor(key, pose = {}) {
  return {
    key, dancePhase: 0, resting: false, onset: 0.7, levelUnit: 0.6,
    bodyMotion: {
      leftArm: 0.7, rightArm: 0.2, squash: 0.5, jump: 0.6,
      jiggle: 0.3, leftLeg: 0.8, rightLeg: 0.3,
    },
    ...pose,
  };
}

function drawCalls(draw, actor, { unit = 2.3, skin, reducedMotion = false } = {}) {
  const calls = [];
  // Deliberately provide only the original raster API. A vector-path, transform
  // or image call would throw instead of silently raising the drawing resolution.
  const context = {
    fillStyle: "",
    fillRect(x, y, width, height) {
      const geometry = [x, y, width, height];
      assert.ok(geometry.every(Number.isInteger), "Pixels must have integer geometry");
      assert.ok(width > 0 && height > 0, "Pixel rectangles must have positive area");
      calls.push([...geometry, this.fillStyle]);
    },
  };
  draw(context, actor, 101.4, 235.2, unit, colors, reducedMotion, skin);
  assert.ok(calls.length, "Every performer must draw visible pixels");
  return calls;
}

function extendBounds(bounds, calls) {
  for (const [x, y, width, height] of calls) {
    bounds.left = Math.min(bounds.left, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x + width);
    bounds.bottom = Math.max(bounds.bottom, y + height);
  }
}
const emptyBounds = () => ({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

test("Original is the default; all six original dancers retain exact raster calls", () => {
  assert.equal(SKINS[0].id, "original");
  for (const key of originalKeys) {
    for (const pose of poses) {
      const actor = actorFor(key, pose);
      for (const unit of [1, 2.3, 5]) {
        const options = { unit, reducedMotion: pose.reducedMotion ?? false };
        const expected = drawCalls(drawChiptuneDancer, actor, options);
        for (const skin of [undefined, "original", "unknown-saved-skin"]) {
          assert.deepEqual(
            drawCalls(drawSimdChiptuneDancer, actor, { ...options, skin }),
            expected,
            `${key}: ${skin ?? "default"}, phase ${pose.dancePhase}, unit ${unit}`,
          );
        }
      }
    }
  }
});

test("Skins have distinct raster output while preserving deterministic musical poses", () => {
  assert.deepEqual(SKINS.map(({ id }) => id), ["original", "cubist", "anime", "swirl"]);
  const raster = calls => {
    const pixels = new Map();
    for (const [x, y, width, height, color] of calls) {
      for (let px = x; px < x + width; px++) for (let py = y; py < y + height; py++) {
        pixels.set(px + "," + py, color);
      }
    }
    return pixels;
  };
  for (const key of [...originalKeys, "noise"]) {
    for (const pose of poses) {
      const actor = actorFor(key, pose), before = structuredClone(actor);
      const options = { reducedMotion: pose.reducedMotion ?? false };
      const images = SKINS.map(({ id }) => raster(drawCalls(drawSimdChiptuneDancer, actor, { ...options, skin: id })));
      for (let a = 0; a < images.length; a++) for (let b = a + 1; b < images.length; b++) {
        const pixels = new Set([...images[a].keys(), ...images[b].keys()]);
        const changed = [...pixels].filter(pixel => images[a].get(pixel) !== images[b].get(pixel)).length;
        assert.ok(changed / pixels.size > .35, key + ": styles must redraw the figure, not add tiny accents");
        const silhouetteChange = [...pixels].filter(pixel => images[a].has(pixel) !== images[b].has(pixel)).length;
        assert.ok(silhouetteChange / pixels.size > .25,
          `${key}/${SKINS[a].id}/${SKINS[b].id}: skins need distinct silhouettes independent of color`);
      }
      assert.deepEqual(actor, before, "Drawing must not change audible performer state");
    }
    for (const { id: skin } of SKINS) {
      const first = actorFor(key, { dancePhase: .19 }), later = { ...first, dancePhase: .63 };
      assert.notDeepEqual(drawCalls(drawSimdChiptuneDancer, first, { skin }),
        drawCalls(drawSimdChiptuneDancer, later, { skin }), key + "/" + skin + ": follow the musical pose");
      assert.deepEqual(drawCalls(drawSimdChiptuneDancer, first, { skin, reducedMotion: true }),
        drawCalls(drawSimdChiptuneDancer, later, { skin, reducedMotion: true }));
      assert.deepEqual(drawCalls(drawSimdChiptuneDancer, { ...first, resting: true }, { skin }),
        drawCalls(drawSimdChiptuneDancer, { ...later, resting: true }, { skin }));
      if (skin !== "original") {
        // Incoming note onsets must not sneak animation into reduced-motion or rest.
        const quiet = { ...first, onset: 0 }, attack = { ...later, onset: 1 };
        assert.deepEqual(drawCalls(drawSimdChiptuneDancer, quiet, { skin, reducedMotion: true }),
          drawCalls(drawSimdChiptuneDancer, attack, { skin, reducedMotion: true }));
        assert.deepEqual(drawCalls(drawSimdChiptuneDancer, { ...quiet, resting: true }, { skin }),
          drawCalls(drawSimdChiptuneDancer, { ...attack, resting: true }, { skin }));
      }
    }
  }
});

test("Every skin fits the existing stage's pixel budget through the complete dance", () => {
  for (const { id: skin } of SKINS) {
    const bounds = emptyBounds();
    for (const key of [...originalKeys, "noise"]) {
      for (let frame = 0; frame < 32; frame++) {
        const actor = actorFor(key, {
          dancePhase: frame / 32, onset: 1, levelUnit: 1,
          bodyMotion: { leftArm: 1, rightArm: 1, squash: 1, jump: 1, jiggle: 1, leftLeg: 1, rightLeg: 1 },
        });
        extendBounds(bounds, drawCalls(drawSimdChiptuneDancer, actor, { unit: 5, skin }));
      }
    }
    // Existing bays allocate 20 units across, 22 above the floor; no larger canvas.
    assert.ok(bounds.left >= Math.round(101.4 - 50) && bounds.right <= Math.round(101.4 + 50), skin + ": bay width");
    assert.ok(bounds.top >= Math.round(235.2 - 110) && bounds.bottom <= Math.round(235.2 + 10), skin + ": bay height");
  }
});

test("Legacy saved skin IDs migrate to the replacement styles", () => {
  for (const [before, after] of Object.entries({ animals: "anime", blobs: "swirl", arcade: "cubist" })) {
    assert.equal(normalizeChiptuneSkin(before), after);
    assert.deepEqual(drawCalls(drawSimdChiptuneDancer, actorFor("lead"), { skin: before }),
      drawCalls(drawSimdChiptuneDancer, actorFor("lead"), { skin: after }));
  }
  for (const { id } of SKINS) assert.equal(normalizeChiptuneSkin(id), id);
  for (const value of [undefined, null, "", "missing", "toString", "__proto__"]) {
    assert.equal(normalizeChiptuneSkin(value), "original");
  }
});
