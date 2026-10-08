import test from "node:test";
import assert from "node:assert/strict";
import { QUADRUPED_ANIMALS, QUADRUPED_BEHAVIORS, createQuadrupedState, applyQuadrupedBehavior, deriveQuadrupedPose } from "../src/instruments/quadruped/quadruped.js";
import { QUADRUPED_VISUAL_SKINS, deriveQuadrupedVisualRig, drawQuadrupedVisualSkin } from "../src/instruments/quadruped/quadruped-visual-skins.js";

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

test("all skins share finite fixed-length articulated limbs across every animal and motion", () => {
  for (const animal of QUADRUPED_ANIMALS) for (const behavior of QUADRUPED_BEHAVIORS) {
    const score = applyQuadrupedBehavior(createQuadrupedState(animal.id), behavior.id);
    for (const position of [0.01, 2.4, 7.8, 13.3]) {
      const pose = deriveQuadrupedPose(score, position);
      const rig = deriveQuadrupedVisualRig(pose, 390, 320, 260, score);
      const points = [...rig.body, ...rig.skull, ...rig.neck, ...rig.tail, ...rig.features.flatMap(f => f.points), ...rig.legs.flatMap(l => l.points)];
      assert.ok(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), `${animal.id}/${behavior.id}`);
      for (const leg of rig.legs) {
        const m = animal.morphology;
        const lengths = [leg.front ? m.frontUpper : m.hindUpper, leg.front ? m.frontLower : m.hindLower, m.distal];
        for (let i = 0; i < 3; i++) assert.ok(Math.abs(distance(leg.points[i], leg.points[i + 1]) - lengths[i] * rig.scale) < 0.001, `${animal.id}/${behavior.id}/${leg.id}/${i}`);
      }
    }
  }
});

test("visual geometry preserves foot contacts and does not mutate the score or pose", () => {
  const score = createQuadrupedState("horse"), pose = deriveQuadrupedPose(score, 3.2);
  const before = JSON.stringify({ score, pose });
  const rig = deriveQuadrupedVisualRig(pose, 900, 600, 450, score);
  for (const leg of rig.legs) {
    const source = pose.legs[leg.id];
    assert.equal(leg.impact, source.impact);
    assert.equal(leg.grounded, source.grounded);
    assert.equal(leg.contactY, 450 - (source.footWorldY - pose.bodyGroundHeight) * rig.scale * 0.74);
  }
  assert.equal(JSON.stringify({ score, pose }), before);
});

test("registry imports without DOM and original/unknown skins fall through without drawing", () => {
  assert.deepEqual(QUADRUPED_VISUAL_SKINS.map(s => s.id), ["animal", "skeleton", "constellation", "collage", "motion-card"]);
  assert.equal(drawQuadrupedVisualSkin(null, null, 900, 600, 450, { visualSkinId: "animal" }), false);
  assert.equal(drawQuadrupedVisualSkin(null, null, 900, 600, 450, { visualSkinId: "unknown" }), false);
});
