import test from "node:test";
import assert from "node:assert/strict";

import {
  QUADRUPED_ANIMALS,
  QUADRUPED_BEHAVIORS,
  QUADRUPED_FOOT_VOICES,
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
  quadrupedBehaviorsForAnimal,
  quadrupedFootVoice,
  quadrupedHeadPhrase,
  quadrupedSequenceEvent,
  sanitizeQuadrupedState,
  setQuadrupedContact,
} from "../src/quadruped.js";

const footLaneIds = QUADRUPED_LANES.slice(0, 4).map(({ id }) => id);

test("Quadruped exposes three animals, an animal-aware gait dictionary, four feet plus tail, and sixteen frames", () => {
  assert.deepEqual(QUADRUPED_ANIMALS.map(({ id }) => id), ["elephant", "unicorn", "gazelle"]);
  assert.deepEqual(QUADRUPED_BEHAVIORS.map(({ id }) => id), [
    "walk", "amble", "charge", "trot", "pace", "canter", "gallop", "sprint", "stot", "jump", "dance",
  ]);
  assert.deepEqual(quadrupedBehaviorsForAnimal("elephant").map(({ id }) => id), ["walk", "amble", "charge", "jump", "dance"]);
  assert.deepEqual(quadrupedBehaviorsForAnimal("unicorn").map(({ id }) => id), ["walk", "amble", "trot", "pace", "canter", "gallop", "jump", "dance"]);
  assert.deepEqual(quadrupedBehaviorsForAnimal("gazelle").map(({ id }) => id), ["walk", "trot", "canter", "sprint", "stot", "jump", "dance"]);
  assert.deepEqual(QUADRUPED_LANES.map(({ id }) => id), [
    "front-left",
    "front-right",
    "rear-left",
    "rear-right",
    "tail",
  ]);
  assert.equal(QUADRUPED_STEP_COUNT, 16);
  assert.equal(QUADRUPED_TERRAINS.length, 4);
});

test("every available animal gait creates a finite, bounded, reproducible score", () => {
  for (const animal of QUADRUPED_ANIMALS) {
    for (const behavior of quadrupedBehaviorsForAnimal(animal.id)) {
      const first = createQuadrupedState(animal.id, behavior.id);
      const second = createQuadrupedState(animal.id, behavior.id);
      assert.deepEqual(first, second);
      assert.equal(first.animalId, animal.id);
      assert.equal(first.behaviorId, behavior.id);
      assert.ok(first.tempoBpm >= QUADRUPED_LIMITS.tempoBpm[0]);
      assert.ok(first.tempoBpm <= QUADRUPED_LIMITS.tempoBpm[1]);
      assert.ok(first.outputLevel >= 0.42);
      assert.ok(first.outputLevel <= QUADRUPED_LIMITS.outputLevel[1]);
      assert.equal(first.terrain.length, QUADRUPED_STEP_COUNT);
      for (const lane of QUADRUPED_LANES) {
        assert.equal(first.pattern[lane.id].length, QUADRUPED_STEP_COUNT);
        for (const value of first.pattern[lane.id]) {
          assert.ok(Number.isFinite(value));
          assert.ok(value >= 0 && value <= 1);
        }
      }
    }
  }
});

test("the sixteen-frame dictionary keeps walk, paired gaits, leads, gallops, stot, and dance distinct", () => {
  const hitsAt = (animalId, behaviorId, step) => quadrupedSequenceEvent(
    createQuadrupedState(animalId, behaviorId),
    step,
  ).contacts.filter(({ id }) => id !== "tail").map(({ shortLabel }) => shortLabel).sort();
  const signature = (animalId, behaviorId) => Array.from({ length: QUADRUPED_STEP_COUNT }, (_, step) => (
    `${step}:${hitsAt(animalId, behaviorId, step).join("+")}`
  )).filter((entry) => !entry.endsWith(":"));

  assert.deepEqual(signature("unicorn", "walk"), ["0:RH", "4:RF", "8:LH", "12:LF"]);
  assert.deepEqual(signature("unicorn", "trot"), ["0:LF+RH", "8:LH+RF"]);
  assert.deepEqual(signature("unicorn", "pace"), ["0:RF+RH", "8:LF+LH"]);
  assert.deepEqual(signature("unicorn", "canter"), ["0:LH", "5:LF+RH", "10:RF"]);
  assert.deepEqual(signature("unicorn", "gallop"), ["0:LH", "5:RH", "8:LF", "11:RF"]);
  assert.deepEqual(signature("gazelle", "sprint"), ["0:RH", "2:LH", "8:LF", "10:RF"]);
  assert.deepEqual(signature("gazelle", "stot"), ["0:LF+LH+RF+RH", "8:LF+LH+RF+RH"]);
  assert.deepEqual(signature("gazelle", "dance"), ["0:LF+RH", "8:LH+RF"]);
  assert.notDeepEqual(signature("elephant", "walk"), signature("elephant", "amble"));
  assert.notDeepEqual(signature("elephant", "amble"), signature("elephant", "charge"));
  assert.notDeepEqual(signature("unicorn", "gallop"), signature("gazelle", "sprint"));
});

test("each animal gives every foot and tail a named, mono-safe articulation family", () => {
  for (const animal of QUADRUPED_ANIMALS) {
    const voices = QUADRUPED_LANES.map(({ id }) => quadrupedFootVoice(animal.id, id));
    assert.equal(new Set(voices.map(({ family }) => family)).size, QUADRUPED_LANES.length);
    assert.ok(voices.every(({ label, family }) => label.length > 0 && family.length > 0));
    assert.deepEqual(Object.keys(QUADRUPED_FOOT_VOICES[animal.id]), QUADRUPED_LANES.map(({ id }) => id));
  }
});

test("simultaneous foot and tail contacts stay layered instead of collapsing to one event", () => {
  let state = clearQuadrupedPattern(createQuadrupedState("elephant", "jump"));
  for (const laneId of [...footLaneIds, "tail"]) state = setQuadrupedContact(state, laneId, 4, 1);
  const event = quadrupedSequenceEvent(state, 4);
  assert.equal(event.contacts.length, 5);
  assert.equal(event.supportCount, 4);
  assert.equal(event.footEnergy, 4);
});

test("ground position changes the resonator while the same limb score remains intact", () => {
  let state = clearQuadrupedPattern(createQuadrupedState("gazelle", "sprint"));
  state = setQuadrupedContact(state, "front-left", 0, 1);
  const onWood = sanitizeQuadrupedState({ ...state, terrain: state.terrain.map((value, step) => step === 0 ? "wood" : value) }, state);
  const onCrystal = sanitizeQuadrupedState({ ...state, terrain: state.terrain.map((value, step) => step === 0 ? "crystal" : value) }, state);
  const woodEvent = quadrupedSequenceEvent(onWood, 0);
  const crystalEvent = quadrupedSequenceEvent(onCrystal, 0);
  assert.equal(woodEvent.contacts[0].id, crystalEvent.contacts[0].id);
  assert.equal(woodEvent.contacts[0].intensity, crystalEvent.contacts[0].intensity);
  assert.notEqual(woodEvent.terrain.id, crystalEvent.terrain.id);
  assert.notDeepEqual(woodEvent.head?.notes, crystalEvent.head?.notes);
});

test("each animal derives its own head voice from the body score", () => {
  const elephant = quadrupedSequenceEvent(createQuadrupedState("elephant", "jump"), 0);
  const walkingElephant = quadrupedSequenceEvent(createQuadrupedState("elephant", "walk"), 0);
  const unicorn = quadrupedSequenceEvent(createQuadrupedState("unicorn", "dance"), 0);
  const gazelle = quadrupedSequenceEvent(createQuadrupedState("gazelle", "sprint"), 0);
  assert.equal(elephant.head?.kind, "trumpet");
  assert.equal(elephant.head?.gesture, "trunk-lift");
  assert.equal(walkingElephant.head?.kind, "trumpet");
  assert.equal(unicorn.head?.kind, "neigh-arpeggio");
  assert.equal(unicorn.head?.gesture, "horn-neigh");
  assert.equal(gazelle.head?.kind, "marimba-string");
  assert.equal(gazelle.head?.gesture, "head-toss");
  assert.deepEqual([elephant.head.notes.length, unicorn.head.notes.length, gazelle.head.notes.length], [5, 6, 6]);
  for (const head of [elephant.head, unicorn.head, gazelle.head]) {
    assert.ok(head.notes.every(Number.isFinite));
    assert.deepEqual(head.noteOffsetsSeconds.length, head.notes.length);
    assert.ok(head.noteOffsetsSeconds.every(Number.isFinite));
    assert.equal(head.noteOffsetsSeconds[0], 0);
    assert.deepEqual([...head.noteOffsetsSeconds].sort((a, b) => a - b), head.noteOffsetsSeconds);
    assert.ok(Number.isFinite(head.durationSeconds));
    assert.ok(Number.isFinite(head.phraseDurationSeconds));
    assert.ok(head.phraseDurationSeconds >= head.noteOffsetsSeconds.at(-1));
    assert.ok(head.phraseDurationSeconds <= 1.2);
  }
  assert.ok(elephant.head.notes.at(-1) > elephant.head.notes[0]);
  assert.equal(Math.max(...elephant.head.notes), elephant.head.notes.at(-1));
  assert.deepEqual(
    gazelle.head.notes.slice(1).map((note, index) => Math.sign(note - gazelle.head.notes[index])),
    [1, -1, 1, -1, 1],
  );

  const density = (animalId, behaviorId) => Array.from({ length: QUADRUPED_STEP_COUNT }, (_, step) => (
    quadrupedSequenceEvent(createQuadrupedState(animalId, behaviorId), step).head
  )).filter(Boolean).length;
  assert.deepEqual([
    density("elephant", "walk"),
    density("unicorn", "dance"),
    density("gazelle", "sprint"),
  ], [2, 2, 2]);
});

test("manual and sequenced heads share one phrase factory and gestures outlive their trigger step", () => {
  for (const [animalId, behaviorId] of [["elephant", "walk"], ["unicorn", "dance"], ["gazelle", "sprint"]]) {
    const state = createQuadrupedState(animalId, behaviorId);
    assert.deepEqual(quadrupedHeadPhrase(state, 0), quadrupedSequenceEvent(state, 0).head);
  }

  const elephant = createQuadrupedState("elephant", "walk");
  const sustained = deriveQuadrupedPose(elephant, 2.25);
  assert.equal(sustained.event.head, null);
  assert.equal(sustained.headPerformance.active, true);
  assert.equal(sustained.headPerformance.gesture, "trunk-lift");
  assert.ok(sustained.headPerformance.strength > 0);
  assert.ok(sustained.headPerformance.noteIndex >= 1);
  assert.ok(sustained.headPerformance.progress > 0 && sustained.headPerformance.progress < 1);
});

test("Dance alternates diagonal two-leg balances while the other pair lifts", () => {
  const state = createQuadrupedState("unicorn", "dance");
  const firstBalance = deriveQuadrupedPose(state, 0.5);
  const secondBalance = deriveQuadrupedPose(state, 8.5);

  assert.deepEqual(
    firstBalance.event.contacts.filter(({ id }) => id !== "tail").map(({ id }) => id).sort(),
    ["front-left", "rear-right"],
  );
  assert.equal(firstBalance.event.supportCount, 2);
  assert.equal(firstBalance.danceBalance, 1);
  assert.ok(firstBalance.legs["front-right"].lift > firstBalance.legs["front-left"].lift);
  assert.ok(firstBalance.legs["rear-left"].lift > firstBalance.legs["rear-right"].lift);

  assert.deepEqual(
    secondBalance.event.contacts.filter(({ id }) => id !== "tail").map(({ id }) => id).sort(),
    ["front-right", "rear-left"],
  );
  assert.equal(secondBalance.event.supportCount, 2);
  assert.equal(secondBalance.danceBalance, 1);
  assert.ok(secondBalance.legs["front-left"].lift > secondBalance.legs["front-right"].lift);
  assert.ok(secondBalance.legs["rear-right"].lift > secondBalance.legs["rear-left"].lift);
});

test("pose support follows gait stance and exposes researched suspension gaps", () => {
  const walkingElephant = createQuadrupedState("elephant", "charge");
  const trottingUnicorn = createQuadrupedState("unicorn", "trot");
  const sprintingGazelle = createQuadrupedState("gazelle", "sprint");
  assert.ok(Array.from({ length: 16 }, (_, step) => deriveQuadrupedPose(walkingElephant, step + 0.5)).every(({ airborne }) => !airborne));
  assert.equal(deriveQuadrupedPose(trottingUnicorn, 7).airborne, true);
  assert.equal(deriveQuadrupedPose(sprintingGazelle, 5).airborne, true);
  assert.equal(deriveQuadrupedPose(sprintingGazelle, 13).airborne, true);
});

test("contact and terrain editing cycle in both directions", () => {
  const cleared = clearQuadrupedPattern(createQuadrupedState("unicorn", "walk"));
  const soft = cycleQuadrupedContact(cleared, "rear-right", 3);
  const strong = cycleQuadrupedContact(soft, "rear-right", 3);
  const off = cycleQuadrupedContact(strong, "rear-right", 3);
  assert.equal(soft.pattern["rear-right"][3], 0.58);
  assert.equal(strong.pattern["rear-right"][3], 1);
  assert.equal(off.pattern["rear-right"][3], 0);
  assert.equal(soft.customized, true);
  assert.equal(cycleQuadrupedContact(cleared, "rear-right", 3, -1).pattern["rear-right"][3], 1);

  const originalTerrain = cleared.terrain[3];
  const nextTerrain = cycleQuadrupedTerrain(cleared, 3);
  assert.notEqual(nextTerrain.terrain[3], originalTerrain);
  assert.equal(cycleQuadrupedTerrain(nextTerrain, 3, -1).terrain[3], originalTerrain);
});

test("mutation is deterministic, bounded, custom, and leaves every quarter playable", () => {
  const source = createQuadrupedState("gazelle", "sprint");
  const first = mutateQuadrupedPattern(source, 0x12345678);
  const second = mutateQuadrupedPattern(source, 0x12345678);
  assert.deepEqual(first, second);
  assert.notEqual(first.mutationSeed, source.mutationSeed);
  assert.equal(first.customized, true);
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const start = quarter * 4;
    assert.ok(footLaneIds.some((laneId) => first.pattern[laneId].slice(start, start + 4).some((value) => value > 0)));
  }
});

test("hostile external state is sanitized without losing the selected valid animal", () => {
  const fallback = createQuadrupedState("unicorn", "dance");
  const safe = sanitizeQuadrupedState({
    animalId: "unicorn",
    behaviorId: "not-a-gait",
    tempoBpm: Infinity,
    stride: -500,
    mood: 99,
    groundResonance: -1,
    outputLevel: 12,
    mutationSeed: 0,
    terrain: ["lava"],
    pattern: { "front-left": [NaN, -4, 99] },
  }, fallback);
  assert.equal(safe.animalId, "unicorn");
  assert.equal(safe.behaviorId, "dance");
  assert.equal(safe.tempoBpm, QUADRUPED_LIMITS.tempoBpm[0]);
  assert.equal(safe.stride, QUADRUPED_LIMITS.stride[0]);
  assert.equal(safe.mood, 1);
  assert.equal(safe.groundResonance, 0);
  assert.equal(safe.outputLevel, QUADRUPED_LIMITS.outputLevel[1]);
  assert.equal(safe.mutationSeed, 1);
  assert.equal(safe.pattern["front-left"][0], 0);
  assert.equal(safe.pattern["front-left"][1], 0);
  assert.equal(safe.pattern["front-left"][2], 1);
  assert.ok(QUADRUPED_TERRAINS.some(({ id }) => id === safe.terrain[0]));
  assert.equal(quadrupedSequenceEvent(safe, Infinity).step, 0);
  assert.equal(deriveQuadrupedPose(safe, -Infinity).position, 0);
  assert.doesNotThrow(() => cycleQuadrupedTerrain(safe, 0, "sideways"));
  assert.doesNotThrow(() => cycleQuadrupedContact(safe, "front-left", 0, NaN));
});

test("animal and movement changes preserve output while movement replacement stays deterministic", () => {
  const source = sanitizeQuadrupedState({ ...createQuadrupedState("elephant"), outputLevel: 0.19 });
  const unicorn = applyQuadrupedAnimal(source, "unicorn");
  const jump = applyQuadrupedBehavior(unicorn, "jump");
  assert.equal(unicorn.outputLevel, 0.19);
  assert.equal(jump.outputLevel, 0.19);
  assert.equal(jump.animalId, "unicorn");
  assert.equal(jump.behaviorId, "jump");
  assert.deepEqual(jump.pattern, createQuadrupedState("unicorn", "jump").pattern);
});

test("the visible pose is finite and responds causally to edited contacts and movement", () => {
  const clearedWalk = clearQuadrupedPattern(createQuadrupedState("elephant", "walk"));
  const struckWalk = setQuadrupedContact(clearedWalk, "front-left", 2, 1);
  const resting = deriveQuadrupedPose(clearedWalk, 2.08);
  const struck = deriveQuadrupedPose(struckWalk, 2.08);
  const airborne = deriveQuadrupedPose(clearQuadrupedPattern(createQuadrupedState("unicorn", "jump")), 2.5);
  assert.equal(resting.legs["front-left"].contact, 0);
  assert.ok(struck.legs["front-left"].contact > 0);
  assert.ok(struck.legs["front-left"].impact > resting.legs["front-left"].impact);
  assert.ok(airborne.bodyLift > resting.bodyLift);
  for (const value of [struck.bodyLift, struck.bodyRoll, struck.bodyPitch, struck.headLift, struck.headExpression, struck.danceBalance, struck.tailAngle, struck.eyeOpen, struck.smile]) {
    assert.ok(Number.isFinite(value));
  }
  assert.match(describeQuadrupedStep(struckWalk, 2), /Left front foot 100 percent/);
});
