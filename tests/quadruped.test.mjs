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
  quadrupedBehaviorFit,
  quadrupedBehaviorsForAnimal,
  quadrupedFootVoice,
  quadrupedHeadPhrase,
  quadrupedSequenceEvent,
  quadrupedStepDurationSeconds,
  sanitizeQuadrupedState,
  setQuadrupedContact,
} from "../src/quadruped.js";
import {
  QUADRUPED_MOTOR_LIMITS,
  advanceQuadrupedMotor,
  createQuadrupedMotorState,
  kickQuadrupedMotor,
  predictQuadrupedMotor,
  quadrupedMotorSnapshot,
} from "../src/quadruped-motor.js";

const footLaneIds = QUADRUPED_LANES.slice(0, 4).map(({ id }) => id);

test("Quadruped exposes seven animals, a shared expanded gait dictionary, four feet plus tail, and sixteen frames", () => {
  assert.deepEqual(QUADRUPED_ANIMALS.map(({ id }) => id), [
    "elephant", "unicorn", "gazelle", "cat", "cheetah", "giraffe", "lizard",
  ]);
  const behaviorIds = QUADRUPED_BEHAVIORS.map(({ id }) => id);
  assert.ok(behaviorIds.length >= 30);
  for (const id of [
    "walk", "running-walk", "trot", "pace", "canter", "counter-canter", "gallop",
    "counter-gallop", "sprint", "rotary-left", "bound", "half-bound", "stot", "jump",
    "dance", "rear-waltz", "cat-prowl", "cat-gallop", "run-leap", "giraffe-walk",
    "giraffe-gallop", "lizard-scuttle", "lizard-trot", "lizard-pace", "lizard-sprint",
  ]) {
    assert.ok(behaviorIds.includes(id), `missing gait ${id}`);
  }
  for (const animal of QUADRUPED_ANIMALS) {
    assert.deepEqual(
      quadrupedBehaviorsForAnimal(animal.id).map(({ id }) => id),
      behaviorIds,
      `${animal.id} should be able to borrow every gait`,
    );
  }
  assert.equal(quadrupedBehaviorFit("cat", "cat-prowl"), "observed");
  assert.equal(quadrupedBehaviorFit("elephant", "cat-prowl"), "playful");
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
      assert.ok(first.momentum >= QUADRUPED_LIMITS.momentum[0]);
      assert.ok(first.momentum <= QUADRUPED_LIMITS.momentum[1]);
      assert.ok(first.gravity >= QUADRUPED_LIMITS.gravity[0]);
      assert.ok(first.gravity <= QUADRUPED_LIMITS.gravity[1]);
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

test("the sixteen-frame dictionary keeps researched footfall families and lead variants distinct", () => {
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
  assert.deepEqual(signature("unicorn", "canter"), ["0:LH", "4:LF+RH", "8:RF"]);
  assert.deepEqual(signature("unicorn", "counter-canter"), ["0:RH", "4:LH+RF", "8:LF"]);
  assert.deepEqual(signature("unicorn", "gallop"), ["0:LH", "3:RH", "7:LF", "10:RF"]);
  assert.deepEqual(signature("unicorn", "counter-gallop"), ["0:RH", "3:LH", "7:RF", "10:LF"]);
  assert.deepEqual(signature("gazelle", "sprint"), ["0:RH", "3:LH", "8:LF", "11:RF"]);
  assert.deepEqual(signature("gazelle", "rotary-left"), ["0:LH", "3:RH", "8:RF", "11:LF"]);
  assert.deepEqual(signature("gazelle", "bound"), ["0:LH+RH", "8:LF+RF"]);
  assert.deepEqual(signature("gazelle", "half-bound"), ["0:LH+RH", "7:LF", "10:RF"]);
  assert.deepEqual(signature("gazelle", "stot"), ["0:LF+LH+RF+RH", "8:LF+LH+RF+RH"]);
  assert.deepEqual(signature("gazelle", "dance"), ["0:LF+RH", "4:LH+RF", "8:LF+RH", "12:LH+RF"]);
  assert.notDeepEqual(signature("elephant", "walk"), signature("elephant", "amble"));
  assert.notDeepEqual(signature("elephant", "amble"), signature("elephant", "charge"));
  assert.notDeepEqual(signature("unicorn", "gallop"), signature("gazelle", "sprint"));

  const canterContactSteps = [0, 4, 8];
  const cyclicSpacing = canterContactSteps.map((step, index) => (
    (canterContactSteps[(index + 1) % canterContactSteps.length] - step + QUADRUPED_STEP_COUNT) % QUADRUPED_STEP_COUNT
  ));
  assert.deepEqual(cyclicSpacing, [4, 4, 8]);
});

test("run-leap is three running clusters followed by a hind launch and fore landing", () => {
  const state = createQuadrupedState("cat", "run-leap");
  const signature = Array.from({ length: QUADRUPED_STEP_COUNT }, (_, step) => {
    const feet = quadrupedSequenceEvent(state, step).contacts
      .filter(({ id }) => id !== "tail")
      .map(({ shortLabel }) => shortLabel)
      .sort();
    return feet.length ? `${step}:${feet.join("+")}` : "";
  }).filter(Boolean);
  assert.deepEqual(signature, [
    "0:RH", "1:LH", "2:LF", "3:RF",
    "4:LH", "5:RH", "6:RF", "7:LF",
    "8:RH", "9:LH", "10:LF", "11:RF",
    "12:LH+RH", "15:LF+RF",
  ]);
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

test("each animal has a distinct melodic head identity with frame-locked sequencer notes", () => {
  const expectedKinds = new Map([
    ["elephant", "trumpet"],
    ["unicorn", "neigh-arpeggio"],
    ["gazelle", "marimba-string"],
    ["cat", "purr-meow"],
    ["cheetah", "chirp-run"],
    ["giraffe", "neck-harp"],
    ["lizard", "hiss-click"],
  ]);
  const foundKinds = new Set();
  for (const animal of QUADRUPED_ANIMALS) {
    const state = createQuadrupedState(animal.id);
    const automaticHeads = Array.from({ length: QUADRUPED_STEP_COUNT }, (_, step) => (
      quadrupedSequenceEvent(state, step).head
    )).filter(Boolean);
    assert.ok(automaticHeads.length >= 4, `${animal.id} needs a recurring melodic motif`);
    for (const head of automaticHeads) {
      assert.equal(head.kind, expectedKinds.get(animal.id));
      assert.equal(head.notes.length, 1, "automatic notes must not outrun the locomotion frame");
      assert.equal(head.frameLocked, true);
      assert.ok(Number.isFinite(head.notes[0]));
      assert.ok(Number.isFinite(head.durationFrames));
      assert.ok(Number.isFinite(head.durationSeconds));
    }
    foundKinds.add(automaticHeads[0].kind);
  }
  assert.equal(foundKinds.size, QUADRUPED_ANIMALS.length);
});

test("manual heads remain multi-note, species-specific phrases while automatic gestures follow gait frames", () => {
  for (const animal of QUADRUPED_ANIMALS) {
    const state = createQuadrupedState(animal.id);
    const automatic = quadrupedSequenceEvent(state, 0).head;
    const manual = quadrupedHeadPhrase(state, 0);
    assert.ok(manual.notes.length >= 4);
    assert.equal(manual.kind, automatic.kind);
    assert.notDeepEqual(manual.notes, automatic.notes);
    assert.equal(manual.noteOffsetsSeconds.length, manual.notes.length);
    assert.equal(manual.noteOffsetsSeconds[0], 0);
    assert.deepEqual([...manual.noteOffsetsSeconds].sort((a, b) => a - b), manual.noteOffsetsSeconds);
    assert.ok(manual.phraseDurationSeconds >= manual.noteOffsetsSeconds.at(-1));
    assert.ok(manual.phraseDurationSeconds <= 1.2);
  }

  const elephant = createQuadrupedState("elephant", "walk");
  const sustained = deriveQuadrupedPose(elephant, 2.25);
  assert.equal(sustained.event.head, null);
  assert.equal(sustained.headPerformance.active, true);
  assert.equal(sustained.headPerformance.gesture, "trunk-lift");
  assert.ok(sustained.headPerformance.strength > 0);
  assert.ok(sustained.headPerformance.progress > 0 && sustained.headPerformance.progress < 1);
});

test("dance alternates diagonal two-leg balances and rear-waltz raises both forelegs", () => {
  const state = createQuadrupedState("lizard", "dance");
  const firstBalance = deriveQuadrupedPose(state, 0.5);
  const secondBalance = deriveQuadrupedPose(state, 4.5);

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

  const rearWaltz = deriveQuadrupedPose(createQuadrupedState("giraffe", "rear-waltz"), 0.5);
  assert.equal(rearWaltz.groundSupportCount, 2);
  assert.equal(rearWaltz.danceBalance, 1);
  assert.equal(rearWaltz.rearBalance, 1);
  assert.ok(rearWaltz.legs["rear-left"].contact > 0);
  assert.ok(rearWaltz.legs["rear-right"].contact > 0);
  assert.ok(rearWaltz.legs["front-left"].lift >= 0.72);
  assert.ok(rearWaltz.legs["front-right"].lift >= 0.72);
});

test("pose support follows gait stance and exposes researched suspension gaps", () => {
  const walkingElephant = createQuadrupedState("elephant", "charge");
  const trottingUnicorn = createQuadrupedState("unicorn", "trot");
  const sprintingGazelle = createQuadrupedState("gazelle", "sprint");
  assert.ok(Array.from({ length: 16 }, (_, step) => deriveQuadrupedPose(walkingElephant, step + 0.5)).every(({ airborne }) => !airborne));
  assert.equal(deriveQuadrupedPose(trottingUnicorn, 7).airborne, true);
  assert.equal(deriveQuadrupedPose(sprintingGazelle, 7).airborne, true);
  assert.equal(deriveQuadrupedPose(sprintingGazelle, 15).airborne, true);
});

test("gait cadence divides one full sixteen-frame motion cycle instead of clocking quarter-note steps", () => {
  for (const cadence of [42, 72, 138, 196]) {
    const state = sanitizeQuadrupedState({ ...createQuadrupedState("cat", "run-leap"), tempoBpm: cadence });
    assert.equal(quadrupedStepDurationSeconds(state), 60 / cadence / QUADRUPED_STEP_COUNT);
    assert.equal(quadrupedStepDurationSeconds(state) * QUADRUPED_STEP_COUNT, 60 / cadence);
  }
});

test("the foot-driven motor predicts frame crossings and keeps momentum and gravity finite and bounded", () => {
  const score = sanitizeQuadrupedState({
    ...createQuadrupedState("cheetah", "run-leap"),
    momentum: Infinity,
    gravity: -Infinity,
  });
  assert.equal(score.momentum, QUADRUPED_LIMITS.momentum[0]);
  assert.equal(score.gravity, QUADRUPED_LIMITS.gravity[0]);

  const initial = createQuadrupedMotorState(score, {
    position: -99,
    velocity: Infinity,
    height: Infinity,
    verticalVelocity: -Infinity,
    compression: 99,
    landing: -99,
  });
  const kicked = kickQuadrupedMotor(score, initial, 1);
  const prediction = predictQuadrupedMotor(score, kicked, 1);
  assert.deepEqual(initial, createQuadrupedMotorState(score, {
    position: -99,
    velocity: Infinity,
    height: Infinity,
    verticalVelocity: -Infinity,
    compression: 99,
    landing: -99,
  }), "prediction must not mutate its input motor state");
  assert.ok(prediction.events.length > 0);
  assert.ok(prediction.events.every((event, index, events) => (
    Number.isFinite(event.offsetSeconds)
      && event.offsetSeconds >= 0
      && event.offsetSeconds <= prediction.advancedSeconds
      && (index === 0 || event.ordinal > events[index - 1].ordinal)
  )));
  assert.ok(prediction.events.length <= QUADRUPED_MOTOR_LIMITS.maxCrossingEvents);
  assert.ok(prediction.transitions.length <= QUADRUPED_MOTOR_LIMITS.maxTransitionEvents);

  const advanced = advanceQuadrupedMotor(score, kicked, 99).motor;
  for (const key of [
    "position", "velocity", "height", "verticalVelocity", "compression", "landing",
    "supportCount", "supportEnergy", "propulsion", "landingCount", "elapsedSeconds",
    "simulatedSeconds", "remainderSeconds",
  ]) {
    assert.ok(Number.isFinite(advanced[key]), `${key} should remain finite`);
  }
  assert.ok(advanced.velocity >= 0 && advanced.velocity <= QUADRUPED_MOTOR_LIMITS.maxVelocity);
  assert.ok(advanced.height >= 0 && advanced.height <= QUADRUPED_MOTOR_LIMITS.maxHeight);
  assert.ok(advanced.compression >= 0 && advanced.compression <= 1);
  assert.ok(advanced.landing >= 0 && advanced.landing <= 1);
  const snapshot = quadrupedMotorSnapshot(score, advanced);
  assert.ok(snapshot.frame >= 0 && snapshot.frame < QUADRUPED_STEP_COUNT);
  assert.ok(snapshot.normalizedVelocity >= 0 && snapshot.normalizedVelocity <= 1.5);
});

test("clearing every foot removes traction so the score stalls instead of advancing on a hidden clock", () => {
  const score = clearQuadrupedPattern(createQuadrupedState("cat", "run-leap"));
  const initial = createQuadrupedMotorState(score);
  const kicked = kickQuadrupedMotor(score, initial, 2);
  const result = advanceQuadrupedMotor(score, kicked, 2);
  assert.equal(kicked.velocity, 0);
  assert.equal(result.motor.position, 0);
  assert.equal(result.motor.stalled, true);
  assert.equal(result.events.length, 0);
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
    momentum: Infinity,
    gravity: -Infinity,
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
  assert.equal(safe.momentum, QUADRUPED_LIMITS.momentum[0]);
  assert.equal(safe.gravity, QUADRUPED_LIMITS.gravity[0]);
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
