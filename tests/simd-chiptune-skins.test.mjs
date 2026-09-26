import assert from "node:assert/strict";
import test from "node:test";
import {
  CHIPTUNE_DANCER_IDENTITIES,
  drawChiptuneDancer,
} from "../src/instruments/webgpu-chiptune/webgpu-chiptune-dancers.js";
import {
  SKINS,
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

test("Every costume keeps the original articulated pose and integer pixel grid, including Noise", () => {
  assert.deepEqual(SKINS.map(({ id }) => id), ["original", "animals", "blobs", "arcade"]);
  for (const key of [...originalKeys, "noise"]) {
    for (const pose of poses) {
      const actor = actorFor(key, pose);
      const before = structuredClone(actor);
      const originalActor = key === "noise" ? { ...actor, key: "upperOne" } : actor;
      const options = { reducedMotion: pose.reducedMotion ?? false };
      const skeleton = drawCalls(drawChiptuneDancer, originalActor, options);
      for (const { id: skin } of SKINS) {
        const calls = drawCalls(drawSimdChiptuneDancer, actor, { ...options, skin });
        // Costumes may decorate heads and torsos, but must retain the complete
        // original pose, limbs and proportions beneath those small accents.
        assert.deepEqual(calls.slice(0, skeleton.length), skeleton, `${key}/${skin}`);
        if (skin !== "original" || key === "noise") {
          assert.ok(calls.length > skeleton.length, `${key}/${skin} must add its costume`);
        }
      }
      assert.deepEqual(actor, before, "Drawing must not change the audible performer state");
    }
  }
});

test("All costumes and the Noise performer fit the original cast's pixel drawing bounds", () => {
  const reference = emptyBounds();
  const variants = new Map(SKINS.map(({ id }) => [id, emptyBounds()]));
  for (const key of [...originalKeys, "noise"]) {
    for (let frame = 0; frame < 32; frame++) {
      const actor = actorFor(key, {
        dancePhase: frame / 32, onset: 1, levelUnit: 1,
        bodyMotion: {
          leftArm: 1, rightArm: 1, squash: 1, jump: 1,
          jiggle: 1, leftLeg: 1, rightLeg: 1,
        },
      });
      const originalActor = key === "noise" ? { ...actor, key: "upperOne" } : actor;
      extendBounds(reference, drawCalls(drawChiptuneDancer, originalActor, { unit: 5 }));
      for (const [skin, bounds] of variants) {
        extendBounds(bounds, drawCalls(drawSimdChiptuneDancer, actor, { unit: 5, skin }));
      }
    }
  }
  for (const [skin, bounds] of variants) {
    assert.deepEqual(bounds, reference, `${skin} must preserve the original cast's drawing budget`);
  }
});
