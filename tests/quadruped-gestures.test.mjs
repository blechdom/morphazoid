import test from "node:test";
import assert from "node:assert/strict";
import { createQuadrupedState, deriveQuadrupedPose, QUADRUPED_ANIMALS } from "../src/instruments/quadruped/quadruped.js";
import { deriveQuadrupedVisualRig, QUADRUPED_VISUAL_SKINS } from "../src/instruments/quadruped/quadruped-visual-skins.js";
import { quadrupedGestureTargets, createQuadrupedGesture, advanceQuadrupedGesture } from "../src/instruments/quadruped/quadruped-gestures.js";

const contains = (rect, point) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
const bodyGesture = options => createQuadrupedGesture({ x: 100, y: 150, time: 0, width: 400, height: 260, part: "body", actorIndex: 1, ...options });
const move = (gesture, x, y = 150, time = gesture.time + 100) => advanceQuadrupedGesture(gesture, { x, y, time });

test("all animal skins expose reachable head and body targets in solo and three clipped lanes", () => {
  for (const stageWidth of [375, 1008]) for (const count of [1, 3]) for (const animal of QUADRUPED_ANIMALS) for (const skin of QUADRUPED_VISUAL_SKINS) {
    const laneWidth = stageWidth / count, laneLeft = count === 3 ? laneWidth : 0;
    const width = laneWidth * (count === 3 ? 1.6 : 1);
    const offsetX = laneLeft - (count === 3 ? laneWidth * 0.3 : 0);
    const score = { ...createQuadrupedState(animal.id), visualSkinId: skin.id };
    const ground = 260 * (["giraffe", "camel"].includes(animal.id) ? 0.81 : 0.74);
    const rig = deriveQuadrupedVisualRig(deriveQuadrupedPose(score, 0.0001), width, 260, ground, score, { playing: false });
    const targets = quadrupedGestureTargets(rig, { offsetX, laneLeft, laneWidth });
    for (const [part, anchor] of [["head", rig.head], ["body", rig.center]]) {
      const rect = targets[part];
      assert.ok(rect.x >= laneLeft && rect.x + rect.width <= laneLeft + laneWidth + 1e-8, `${animal.id}/${skin.id}/${part} lane`);
      assert.ok(rect.width >= 32 && rect.height >= 32);
      assert.ok(contains(rect, { x: anchor.x + offsetX, y: anchor.y }), `${animal.id}/${skin.id}/${part} anchor`);
    }
  }
});

test("head targets include the trunk without expanding around horns, and body targets include humps", () => {
  const rig = { center: { x: 50, y: 50 }, head: { x: 80, y: 40 }, body: [{ x: 30, y: 40 }, { x: 65, y: 60 }], skull: [{ x: 72, y: 35 }, { x: 86, y: 45 }],
    features: [{ kind: "horn", points: [{ x: -1000, y: -1000 }] }, { kind: "trunk", points: [{ x: 90, y: 70 }] }], humps: [[{ x: 42, y: 20 }]] };
  const targets = quadrupedGestureTargets(rig, { laneLeft: 0, laneWidth: 100 });
  assert.ok(contains(targets.head, { x: 90, y: 70 }));
  assert.ok(contains(targets.body, { x: 42, y: 20 }));
  assert.ok(targets.head.width < 50 && targets.head.y > 0);
  const tiny = quadrupedGestureTargets(rig, { offsetX: 200, laneLeft: 200, laneWidth: 20 });
  for (const target of Object.values(tiny)) assert.ok(target.x >= 200 && target.x + target.width <= 220);
});

test("drag slop separates taps from directional locomotion and distance controls strength", () => {
  const initial = bodyGesture(), before = structuredClone(initial);
  const tiny = move(initial, 106, 153);
  assert.equal(tiny.moved, false); assert.equal(tiny.action, null);
  const right = move(initial, 130), far = move(initial, 300), left = move(initial, 70);
  assert.equal(right.action, "run"); assert.equal(left.action, "backward");
  assert.ok(far.strength > right.strength); assert.equal(right.actorIndex, 1);
  assert.deepEqual(initial, before); assert.notEqual(right, initial);
  assert.equal(move(right, 100).moved, true);
});

test("an upward release needs vertical intent and scales its jump without downward false positives", () => {
  const initial = bodyGesture();
  assert.equal(move(initial, 102, 125).action, null);
  const jump = move(initial, 102, 120);
  assert.equal(jump.action, "jump");
  assert.ok(move(initial, 102, 40).strength > jump.strength);
  assert.equal(move(initial, 102, 200).action, null);
  assert.equal(move(initial, 160, 120).action, "run");
  const shortStage = bodyGesture({ height: 140 });
  assert.equal(move(shortStage, 100, 133).action, null);
  assert.equal(move(shortStage, 100, 132).action, "jump");
});

test("two deliberate reversals trigger dance, pointer noise and slow reversals do not", () => {
  let noise = move(bodyGesture(), 140);
  for (const x of [138, 142, 137, 140, 139, 143]) noise = move(noise, x);
  assert.equal(noise.reversals, 0); assert.notEqual(noise.action, "dance");
  let dance = move(bodyGesture(), 140);
  dance = move(dance, 115); assert.equal(dance.reversals, 1);
  dance = move(dance, 145); assert.equal(dance.reversals, 2); assert.equal(dance.action, "dance");
  assert.equal(move(dance, 100, 80, 5000).action, "dance", "dance lasts until caller ends gesture");
  let slow = move(bodyGesture(), 140, 150, 100);
  slow = move(slow, 115, 150, 1200);
  slow = move(slow, 145, 150, 2300);
  assert.notEqual(slow.action, "dance"); assert.equal(slow.reversals, 1);
  let vertical = move(bodyGesture(), 140);
  vertical = move(vertical, 110, 60);
  vertical = move(vertical, 145, -40);
  assert.notEqual(vertical.action, "dance");
});

test("head taps and drags stay expressive calls with bounded continuous pitch", () => {
  const initial = bodyGesture({ part: "head" });
  assert.equal(initial.action, "call"); assert.equal(initial.pitch, 0);
  const up = move(initial, 101, 120), fartherUp = move(initial, 101, 100), down = move(initial, 101, 180);
  assert.equal(up.action, "call"); assert.ok(up.pitch > 0 && fartherUp.pitch > up.pitch);
  assert.ok(down.pitch < 0);
  let scrub = move(initial, 140); scrub = move(scrub, 110); scrub = move(scrub, 145);
  assert.equal(scrub.action, "call"); assert.equal(scrub.reversals, 0);
  const extreme = move(initial, 1e8, -1e8);
  assert.equal(extreme.pitch, 1); assert.equal(extreme.strength, 1);
});

test("non-finite samples preserve finite state and never move time backwards", () => {
  const initial = createQuadrupedGesture({ x: NaN, y: Infinity, time: -Infinity, width: 0, height: NaN, actorIndex: Infinity });
  for (const value of Object.values(initial)) if (typeof value === "number") assert.ok(Number.isFinite(value));
  const active = advanceQuadrupedGesture(initial, { x: 20, y: 0, time: 200 });
  const invalid = advanceQuadrupedGesture(active, { x: Infinity, y: NaN, time: 1 });
  assert.equal(invalid.x, 20); assert.equal(invalid.y, 0); assert.equal(invalid.time, 200);
  assert.ok(invalid.strength >= 0 && invalid.strength <= 1);
  for (const value of Object.values(invalid)) if (typeof value === "number") assert.ok(Number.isFinite(value));
  for (const target of Object.values(quadrupedGestureTargets({}, { offsetX: Infinity, laneLeft: NaN, laneWidth: -1 }))) {
    assert.ok(Object.values(target).every(Number.isFinite)); assert.equal(target.width, 1);
  }
});
