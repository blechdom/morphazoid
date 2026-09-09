import test from "node:test";
import assert from "node:assert/strict";

import {
  QUADRUPED_ANIMALS,
  QUADRUPED_BEHAVIORS,
  QUADRUPED_DEFAULT_TEMPO_BPM,
  QUADRUPED_FOOT_VOICES,
  QUADRUPED_GROUND_PROFILES,
  QUADRUPED_LANES,
  QUADRUPED_LIMITS,
  QUADRUPED_STEP_COUNT,
  QUADRUPED_TERRAINS,
  applyQuadrupedAnimal,
  applyQuadrupedBehavior,
  clearQuadrupedPattern,
  createQuadrupedState,
  cycleQuadrupedContact,
  cycleQuadrupedTerrain,
  deriveQuadrupedPose,
  describeQuadrupedStep,
  mutateQuadrupedPattern,
  quadrupedAnimal,
  quadrupedBehaviorFit,
  quadrupedBehaviorsForAnimal,
  quadrupedFootCycleState,
  quadrupedFootVoice,
  quadrupedGaitProfile,
  quadrupedGroundAnchorX,
  quadrupedGroundHeightAtWorldX,
  quadrupedSequenceEvent,
  quadrupedStepDurationSeconds,
  quadrupedSupportSnapshot,
  sanitizeQuadrupedState,
  setQuadrupedContact,
  setQuadrupedGroundProfile,
  setQuadrupedSurface,
  solveQuadrupedLimbChain,
  solveQuadrupedLimbJoint,
} from "../src/quadruped.js";
import {
  QUADRUPED_MOTOR_LIMITS,
  advanceQuadrupedMotor,
  createQuadrupedMotorState,
  kickQuadrupedMotor,
  predictQuadrupedMotor,
  quadrupedMotorSnapshot,
} from "../src/quadruped-motor.js";

const footLaneIds = QUADRUPED_LANES.map(({ id }) => id);
const animalIds = [
  "elephant", "unicorn", "gazelle", "cat", "cheetah", "giraffe", "lizard",
  "horse", "dog", "goat", "rabbit", "camel", "mouse", "dinosaur", "frog",
];
const finite = (value) => Number.isFinite(Number(value));
const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function signature(animalId, behaviorId) {
  const state = createQuadrupedState(animalId, behaviorId);
  return Array.from({ length: QUADRUPED_STEP_COUNT }, (_, step) => {
    const feet = quadrupedSequenceEvent(state, step).contacts.map(({ shortLabel }) => shortLabel).sort();
    return feet.length ? `${step}:${feet.join("+")}` : "";
  }).filter(Boolean);
}

test("Quadruped exposes fifteen animals, forty-five transferable gaits, four feet, sixteen cards, eight surfaces, and three courses", () => {
  assert.deepEqual(QUADRUPED_ANIMALS.map(({ id }) => id), animalIds);
  assert.equal(QUADRUPED_BEHAVIORS.length, 45);
  assert.ok(QUADRUPED_BEHAVIORS.some(({ id }) => id === "rabbit-gallop"));
  for (const stunt of ["leap", "walk-leap", "skid", "forward-roll", "cartwheel", "rear-up", "mosey", "wander", "drunk", "tiptoe"]) {
    assert.ok(QUADRUPED_BEHAVIORS.some(({ id }) => id === stunt));
  }
  assert.deepEqual(footLaneIds, ["front-left", "front-right", "rear-left", "rear-right"]);
  assert.equal(QUADRUPED_STEP_COUNT, 16);
  assert.deepEqual(QUADRUPED_TERRAINS.map(({ id }) => id), [
    "earth", "sand", "wood", "stone", "metal", "snow", "water", "crystal",
  ]);
  assert.deepEqual(QUADRUPED_GROUND_PROFILES.map(({ id }) => id), [
    "level", "stairs-up", "stairs-down",
  ]);
  for (const animalId of animalIds) {
    assert.deepEqual(
      quadrupedBehaviorsForAnimal(animalId).map(({ id }) => id),
      QUADRUPED_BEHAVIORS.map(({ id }) => id),
    );
  }
  assert.equal(quadrupedBehaviorFit("rabbit", "rabbit-gallop"), "observed");
  assert.equal(quadrupedBehaviorFit("elephant", "rabbit-gallop"), "playful");
});

test("every animal and gait creates a finite deterministic four-lane score", () => {
  const morphologyKeys = [
    "bodyWidth", "bodyHeight", "clearance", "shoulder", "haunch", "headScale",
    "neckLength", "headForward", "headRise", "frontUpper", "frontLower",
    "hindUpper", "hindLower", "distal", "legWidth", "footWidth", "tailLength",
    "foreBend", "hindBend", "spineElasticity",
  ];
  for (const animal of QUADRUPED_ANIMALS) {
    assert.ok(morphologyKeys.every((key) => finite(animal.morphology[key])));
    assert.ok(morphologyKeys.filter((key) => !key.endsWith("Bend")).every((key) => animal.morphology[key] >= 0));
    for (const behavior of QUADRUPED_BEHAVIORS) {
      const first = createQuadrupedState(animal.id, behavior.id);
      assert.deepEqual(first, createQuadrupedState(animal.id, behavior.id));
      assert.equal(first.animalId, animal.id);
      assert.equal(first.behaviorId, behavior.id);
      assert.ok(first.tempoBpm >= QUADRUPED_LIMITS.tempoBpm[0] && first.tempoBpm <= QUADRUPED_LIMITS.tempoBpm[1]);
      assert.ok(first.outputLevel >= 0.42 && first.outputLevel <= QUADRUPED_LIMITS.outputLevel[1]);
      assert.ok(QUADRUPED_TERRAINS.some(({ id }) => id === first.surfaceId));
      assert.ok(QUADRUPED_GROUND_PROFILES.some(({ id }) => id === first.groundProfileId));
      assert.deepEqual(Object.keys(first.pattern), footLaneIds);
      for (const laneId of footLaneIds) {
        assert.equal(first.pattern[laneId].length, QUADRUPED_STEP_COUNT);
        assert.ok(first.pattern[laneId].every((value) => finite(value) && value >= 0 && value <= 1));
      }
    }
  }
});

test("the gait dictionary preserves distinct locomotion and stunt rhythms", () => {
  assert.deepEqual(signature("unicorn", "walk"), ["0:RH", "4:RF", "8:LH", "12:LF"]);
  assert.deepEqual(signature("unicorn", "trot"), ["0:LF+RH", "8:LH+RF"]);
  assert.deepEqual(signature("unicorn", "pace"), ["0:RF+RH", "8:LF+LH"]);
  assert.deepEqual(signature("unicorn", "canter"), ["0:LH", "4:LF+RH", "8:RF"]);
  assert.deepEqual(signature("unicorn", "gallop"), ["0:LH", "3:RH", "4:LF", "8:RF"]);
  assert.deepEqual(signature("gazelle", "sprint"), ["0:RH", "2:LH", "7:LF", "10:RF"]);
  assert.deepEqual(signature("gazelle", "bound"), ["0:LH+RH", "8:LF+RF"]);
  assert.deepEqual(signature("rabbit", "rabbit-gallop"), ["0:LH", "1:RH", "5:LF", "7:RF"]);
  assert.deepEqual(signature("elephant", "leap"), ["0:LH+RH", "10:RF", "11:LF"]);
  assert.deepEqual(signature("elephant", "skid"), ["0:LH+RH", "14:RF", "15:LF"]);
  assert.deepEqual(signature("elephant", "forward-roll"), ["0:LH+RH", "12:RF", "13:LF"]);
  assert.deepEqual(signature("elephant", "rear-up"), ["0:LH+RH", "8:LH+RH"]);
  assert.notDeepEqual(signature("elephant", "walk"), signature("elephant", "amble"));
});

test("run-leap is three running clusters followed by hind launch, flight, and fore landing", () => {
  assert.deepEqual(signature("cat", "run-leap"), [
    "0:RH", "1:LH", "2:LF", "3:RF",
    "4:LH", "5:RH", "6:RF", "7:LF",
    "8:RH", "9:LH", "10:LF", "11:RF",
    "12:LH+RH", "15:LF+RF",
  ]);
  const state = createQuadrupedState("cheetah", "run-leap");
  assert.ok([13.5, 14, 14.5].every((position) => quadrupedSupportSnapshot(state, position).supportCount === 0));
});

test("each animal gives all four feet different named mono-safe articulation families", () => {
  for (const animal of QUADRUPED_ANIMALS) {
    const voices = footLaneIds.map((laneId) => quadrupedFootVoice(animal.id, laneId));
    assert.equal(new Set(voices.map(({ family }) => family)).size, 4);
    assert.ok(voices.every(({ label, family }) => label.length > 0 && family.length > 0));
    assert.deepEqual(Object.keys(QUADRUPED_FOOT_VOICES[animal.id]), footLaneIds);
  }
});

test("one frame can layer all four feet without inventing a tail lane", () => {
  let state = clearQuadrupedPattern(createQuadrupedState("elephant", "jump"));
  for (const laneId of footLaneIds) state = setQuadrupedContact(state, laneId, 4, 1);
  const event = quadrupedSequenceEvent(state, 4);
  assert.equal(event.contacts.length, 4);
  assert.equal(event.supportCount, 4);
  assert.equal(event.footEnergy, 4);
  assert.ok(event.contacts.every(({ id }) => footLaneIds.includes(id)));
});

test("surface is global and changes resonance physics without changing the gait topology", () => {
  const earth = createQuadrupedState("gazelle", "sprint");
  const crystal = setQuadrupedSurface(earth, "crystal");
  assert.deepEqual(crystal.pattern, earth.pattern);
  assert.equal(quadrupedSequenceEvent(earth, 0).terrain.id, "earth");
  assert.equal(quadrupedSequenceEvent(crystal, 0).terrain.id, "crystal");
  assert.notDeepEqual(
    QUADRUPED_TERRAINS.find(({ id }) => id === "earth"),
    QUADRUPED_TERRAINS.find(({ id }) => id === "crystal"),
  );
});

test("a dot means no new touchdown while the independent support bar can remain planted", () => {
  const state = createQuadrupedState("elephant", "walk");
  assert.equal(quadrupedSequenceEvent(state, 1).contacts.length, 0);
  const rearRight = quadrupedFootCycleState(state, "rear-right", 1);
  assert.equal(rearRight.touchdown, false);
  assert.equal(rearRight.grounded, true);
  assert.ok(rearRight.contact > 0);
});

test("automatic head events are muted during the gait-focused pass", () => {
  for (const animal of QUADRUPED_ANIMALS) {
    const state = createQuadrupedState(animal.id);
    assert.ok(Array.from({ length: 16 }, (_, step) => quadrupedSequenceEvent(state, step).head).every((head) => head === null));
    assert.equal(deriveQuadrupedPose(state, 0.5).headPerformance.active, false);
    assert.equal(deriveQuadrupedPose(state, 0.5).headExpression, 0);
  }
});

test("dance, rear-waltz, and rear-up support two-leg balances", () => {
  const first = deriveQuadrupedPose(createQuadrupedState("lizard", "dance"), 0.5);
  assert.equal(first.groundSupportCount, 2);
  assert.ok(first.legs["front-right"].lift > first.legs["front-left"].lift);
  assert.ok(first.legs["rear-left"].lift > first.legs["rear-right"].lift);
  const waltz = deriveQuadrupedPose(createQuadrupedState("giraffe", "rear-waltz"), 0.5);
  assert.equal(waltz.groundSupportCount, 2);
  assert.equal(waltz.rearBalance, 1);
  assert.ok(waltz.legs["front-left"].lift >= 0.72);
  assert.ok(waltz.legs["front-right"].lift >= 0.72);
  const rearUp = deriveQuadrupedPose(createQuadrupedState("camel", "rear-up"), 8);
  assert.equal(rearUp.groundSupportCount, 2);
  assert.ok(rearUp.rearBalance > 0.95);
  assert.ok(rearUp.legs["front-left"].lift > 0.95);
  assert.ok(rearUp.legs["front-right"].lift > 0.95);
});

test("leap, skid, and forward roll expose distinct physical pose signals", () => {
  const leap = createQuadrupedState("giraffe", "leap");
  assert.ok([4, 6, 8].every((position) => quadrupedSupportSnapshot(leap, position).supportCount === 0));
  const skid = deriveQuadrupedPose(createQuadrupedState("horse", "skid"), 8);
  assert.ok(skid.skidLean > 0.15);
  const roll = deriveQuadrupedPose(createQuadrupedState("cat", "forward-roll"), 8);
  assert.ok(roll.forwardRoll > 0.4 && roll.forwardRoll < 0.7);
  assert.ok(roll.rollTuck > 0.9);
});

test("duty factors create grounded walks and explicit suspension in faster gaits", () => {
  const walk = createQuadrupedState("elephant", "walk");
  const trot = createQuadrupedState("horse", "trot");
  const sprint = createQuadrupedState("gazelle", "sprint");
  assert.ok(Array.from({ length: 64 }, (_, index) => quadrupedSupportSnapshot(walk, index / 4).supportCount > 0).every(Boolean));
  assert.ok(Array.from({ length: 64 }, (_, index) => quadrupedSupportSnapshot(trot, index / 4).supportCount === 0).some(Boolean));
  assert.ok(Array.from({ length: 64 }, (_, index) => quadrupedSupportSnapshot(sprint, index / 4).supportCount === 0).some(Boolean));
  assert.ok(quadrupedGaitProfile("walk", "elephant").frontDutyFactor > quadrupedGaitProfile("sprint", "gazelle").frontDutyFactor);
});

test("stair treads, safe touchdown insets, and course grades are deterministic", () => {
  assert.equal(quadrupedGroundHeightAtWorldX("level", 99), 0);
  assert.equal(quadrupedGroundHeightAtWorldX("stairs-up", 0.899), 0);
  assert.equal(quadrupedGroundHeightAtWorldX("stairs-up", 0.9), 0.16);
  assert.equal(quadrupedGroundHeightAtWorldX("stairs-up", 1.8), 0.32);
  assert.equal(quadrupedGroundHeightAtWorldX("stairs-down", 0.9), -0.16);
  assert.ok(Math.abs(quadrupedGroundAnchorX("stairs-up", 0.01) - 0.117) < 1e-12);
  assert.ok(Math.abs(quadrupedGroundAnchorX("stairs-up", 0.89) - 0.783) < 1e-12);
  const up = quadrupedSupportSnapshot(setQuadrupedGroundProfile(createQuadrupedState("goat"), "stairs-up"), 8);
  const down = quadrupedSupportSnapshot(setQuadrupedGroundProfile(createQuadrupedState("goat"), "stairs-down"), 8);
  assert.ok(up.supportSlope > 0 && up.supportSlope < 0.65);
  assert.ok(down.supportSlope < 0 && down.supportSlope > -0.65);
});

test("the body follows a continuous stair grade even when the supporting foot set changes", () => {
  const state = setQuadrupedGroundProfile(createQuadrupedState("cheetah", "run-leap"), "stairs-up");
  let previous = quadrupedSupportSnapshot(state, 0).bodyGroundHeight;
  let maximumDelta = 0;
  for (let index = 1; index <= 16_000; index += 1) {
    const next = quadrupedSupportSnapshot(state, index / 1_000).bodyGroundHeight;
    maximumDelta = Math.max(maximumDelta, Math.abs(next - previous));
    previous = next;
  }
  const expectedPerSample = state.stride / QUADRUPED_STEP_COUNT / 1_000 * (0.16 / 0.9);
  assert.ok(Math.abs(maximumDelta - expectedPerSample) < 1e-10);
});

test("a planted foot stays latched to one stair tread until lift-off", () => {
  const state = setQuadrupedGroundProfile(createQuadrupedState("elephant", "walk"), "stairs-up");
  const early = quadrupedFootCycleState(state, "rear-right", 0.1);
  const later = quadrupedFootCycleState(state, "rear-right", 4);
  assert.equal(early.grounded, true);
  assert.equal(later.grounded, true);
  assert.equal(early.eventId, later.eventId);
  assert.equal(early.footWorldX, early.anchorWorldX);
  assert.equal(later.footWorldX, early.anchorWorldX);
  assert.equal(later.footWorldY, early.anchorWorldY);
  assert.ok(early.nextAnchorWorldX > early.anchorWorldX);
  assert.equal(early.nextAnchorWorldY, quadrupedGroundHeightAtWorldX("stairs-up", early.nextAnchorWorldX));
});

test("two-link and three-link IK preserve fixed segment lengths", () => {
  const joint = solveQuadrupedLimbJoint(0, 0, 0.4, 0.7, 0.5, 0.45, 1);
  assert.ok(Math.abs(distance(0, 0, joint.x, joint.y) - 0.5) < 1e-9);
  assert.ok(Math.abs(distance(joint.x, joint.y, joint.endX, joint.endY) - 0.45) < 1e-9);
  const chain = solveQuadrupedLimbChain(0, 0, 0.42, 1.05, 0.48, 0.5, 0.21, -1, 0.08, -1);
  assert.equal(chain.reached, true);
  assert.ok(Math.abs(distance(0, 0, chain.kneeX, chain.kneeY) - chain.upperLength) < 1e-8);
  assert.ok(Math.abs(distance(chain.kneeX, chain.kneeY, chain.ankleX, chain.ankleY) - chain.lowerLength) < 1e-8);
  assert.ok(Math.abs(distance(chain.ankleX, chain.ankleY, chain.footX, chain.footY) - chain.distalLength) < 1e-8);
  assert.ok(Math.abs(chain.footX - 0.42) < 1e-8 && Math.abs(chain.footY - 1.05) < 1e-8);
});

test("global tempo is independent of animal and gait and one cycle equals one beat", () => {
  for (const animal of QUADRUPED_ANIMALS) {
    for (const behavior of QUADRUPED_BEHAVIORS) {
      assert.equal(createQuadrupedState(animal.id, behavior.id).tempoBpm, QUADRUPED_DEFAULT_TEMPO_BPM);
    }
  }
  for (const cadence of [42, 72, 138, 196]) {
    const state = sanitizeQuadrupedState({ ...createQuadrupedState("cat", "run-leap"), tempoBpm: cadence });
    assert.equal(quadrupedStepDurationSeconds(state), 60 / cadence / QUADRUPED_STEP_COUNT);
    assert.equal(quadrupedStepDurationSeconds(state) * QUADRUPED_STEP_COUNT, 60 / cadence);
  }
});

test("the foot-driven motor predicts crossings with finite bounded state", () => {
  const score = createQuadrupedState("cheetah", "run-leap");
  const initial = createQuadrupedMotorState(score);
  const kicked = kickQuadrupedMotor(score, initial, 1);
  const prediction = predictQuadrupedMotor(score, kicked, 1);
  assert.deepEqual(initial, createQuadrupedMotorState(score));
  assert.ok(prediction.events.length > 0);
  assert.ok(prediction.events.every((event, index, events) => (
    finite(event.offsetSeconds)
      && event.offsetSeconds >= 0
      && event.offsetSeconds <= prediction.advancedSeconds
      && (index === 0 || event.ordinal > events[index - 1].ordinal)
  )));
  assert.ok(prediction.events.length <= QUADRUPED_MOTOR_LIMITS.maxCrossingEvents);
  const advanced = advanceQuadrupedMotor(score, kicked, 99).motor;
  for (const key of ["position", "velocity", "height", "verticalVelocity", "supportCount", "supportEnergy", "propulsion"]) {
    assert.ok(finite(advanced[key]), key);
  }
  assert.ok(advanced.velocity >= 0 && advanced.velocity <= QUADRUPED_MOTOR_LIMITS.maxVelocity);
  assert.ok(advanced.height >= 0 && advanced.height <= QUADRUPED_MOTOR_LIMITS.maxHeight);
  assert.ok(quadrupedMotorSnapshot(score, advanced).frame < QUADRUPED_STEP_COUNT);
});

test("clearing every foot removes traction and the clock stalls", () => {
  const score = clearQuadrupedPattern(createQuadrupedState("cat", "run-leap"));
  const initial = createQuadrupedMotorState(score);
  const kicked = kickQuadrupedMotor(score, initial, 2);
  const result = advanceQuadrupedMotor(score, kicked, 2);
  assert.equal(kicked.velocity, 0);
  assert.equal(result.motor.position, 0);
  assert.equal(result.motor.stalled, true);
  assert.equal(result.events.length, 0);
});

test("contact and global surface editing cycle in both directions", () => {
  const cleared = clearQuadrupedPattern(createQuadrupedState("unicorn", "walk"));
  const soft = cycleQuadrupedContact(cleared, "rear-right", 3);
  const strong = cycleQuadrupedContact(soft, "rear-right", 3);
  const off = cycleQuadrupedContact(strong, "rear-right", 3);
  assert.equal(soft.pattern["rear-right"][3], 0.58);
  assert.equal(strong.pattern["rear-right"][3], 1);
  assert.equal(off.pattern["rear-right"][3], 0);
  assert.equal(cycleQuadrupedContact(cleared, "rear-right", 3, -1).pattern["rear-right"][3], 1);
  const nextSurface = cycleQuadrupedTerrain(cleared, 3);
  assert.notEqual(nextSurface.surfaceId, cleared.surfaceId);
  assert.equal(cycleQuadrupedTerrain(nextSurface, 3, -1).surfaceId, cleared.surfaceId);
});

test("mutation is deterministic, bounded, and preserves touchdown topology", () => {
  const source = createQuadrupedState("gazelle", "sprint");
  const first = mutateQuadrupedPattern(source, 0x12345678);
  assert.deepEqual(first, mutateQuadrupedPattern(source, 0x12345678));
  assert.equal(first.customized, true);
  assert.notEqual(first.mutationSeed, source.mutationSeed);
  for (const laneId of footLaneIds) {
    assert.deepEqual(
      first.pattern[laneId].map((value) => value > 0),
      source.pattern[laneId].map((value) => value > 0),
    );
    assert.ok(first.pattern[laneId].every((value) => finite(value) && value >= 0 && value <= 1));
  }
});

test("hostile external state is sanitized to valid surface and course defaults", () => {
  const fallback = createQuadrupedState("unicorn", "dance");
  const safe = sanitizeQuadrupedState({
    animalId: "unicorn",
    behaviorId: "not-a-gait",
    tempoBpm: Infinity,
    stride: -500,
    momentum: Infinity,
    gravity: -Infinity,
    outputLevel: 12,
    mutationSeed: 0,
    surfaceId: "lava",
    groundProfileId: "escalator",
    pattern: { "front-left": [NaN, -4, 99] },
  }, fallback);
  assert.equal(safe.animalId, "unicorn");
  assert.equal(safe.behaviorId, "dance");
  assert.equal(safe.tempoBpm, QUADRUPED_LIMITS.tempoBpm[0]);
  assert.equal(safe.stride, QUADRUPED_LIMITS.stride[0]);
  assert.equal(safe.outputLevel, QUADRUPED_LIMITS.outputLevel[1]);
  assert.equal(safe.surfaceId, "earth");
  assert.equal(safe.groundProfileId, "level");
  assert.equal(safe.mutationSeed, 1);
  assert.deepEqual(safe.pattern["front-left"].slice(0, 3), [0, 0, 1]);
  assert.equal(quadrupedSequenceEvent(safe, Infinity).step, 0);
  assert.equal(quadrupedSupportSnapshot(safe, Infinity).bodyWorldX, 0);
});

test("animal and gait changes preserve output, surface, and path while replacing the score", () => {
  let state = setQuadrupedGroundProfile(setQuadrupedSurface(createQuadrupedState("elephant"), "metal"), "stairs-down");
  state = sanitizeQuadrupedState({ ...state, outputLevel: 0.67, tempoBpm: 173 }, state);
  const animal = applyQuadrupedAnimal(state, "camel");
  assert.equal(animal.outputLevel, 0.67);
  assert.equal(animal.surfaceId, "metal");
  assert.equal(animal.groundProfileId, "stairs-down");
  assert.equal(animal.tempoBpm, 173);
  const gait = applyQuadrupedBehavior(animal, "pace");
  assert.equal(gait.outputLevel, 0.67);
  assert.equal(gait.surfaceId, "metal");
  assert.equal(gait.groundProfileId, "stairs-down");
  assert.equal(gait.tempoBpm, 173);
  assert.equal(gait.behaviorId, "pace");
});

test("poses stay finite across every animal, gait, course, and sampled frame", () => {
  for (const animal of QUADRUPED_ANIMALS) {
    for (const behavior of QUADRUPED_BEHAVIORS) {
      const state = setQuadrupedGroundProfile(createQuadrupedState(animal.id, behavior.id), behavior.id === "walk" ? "stairs-up" : "level");
      for (const position of [0, 3.25, 7.5, 12.75, 15.9]) {
        const pose = deriveQuadrupedPose(state, position);
        for (const key of ["bodyLift", "bodyRoll", "bodyPitch", "bodyGroundHeight", "groundSlope", "propulsion", "forwardRoll", "rollTuck", "skidLean"]) {
          assert.ok(finite(pose[key]), `${animal.id}/${behavior.id}/${key}`);
        }
        for (const laneId of footLaneIds) {
          for (const key of ["footX", "footWorldX", "footWorldY", "lift", "load", "propulsion"]) {
            assert.ok(finite(pose.legs[laneId][key]), `${animal.id}/${behavior.id}/${laneId}/${key}`);
          }
        }
      }
    }
  }
});

test("step descriptions teach touchdown marks separately from planted support", () => {
  const description = describeQuadrupedStep(createQuadrupedState("horse", "walk"), 1);
  assert.match(description, /Lit marks are touchdowns/);
  assert.match(description, /support bar continues until lift-off/);
});
