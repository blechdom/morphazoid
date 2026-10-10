import assert from "node:assert/strict";
import test from "node:test";
import {
  QUADRUPED_FULL_PRESETS, captureQuadrupedPreset, createQuadrupedFullPresets,
  normalizeQuadrupedPreset, randomizeQuadrupedPreset,
} from "../src/instruments/quadruped/quadruped-presets.js";
import {
  QUADRUPED_ANIMALS, QUADRUPED_BEHAVIORS, QUADRUPED_GROUND_PROFILES,
  QUADRUPED_LANES, QUADRUPED_LIMITS, QUADRUPED_TERRAINS, createQuadrupedState, sanitizeQuadrupedState,
} from "../src/instruments/quadruped/quadruped.js";
import {
  QUADRUPED_GROUP_MODES, QUADRUPED_SHARED_FIELDS, quadrupedRandom,
  sanitizeQuadrupedWorld,
} from "../src/instruments/quadruped/quadruped-world.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const clone = value => JSON.parse(JSON.stringify(value));
const musicalFields = Object.keys(createQuadrupedState()).filter(key => key !== "outputLevel").sort();
const sharedFields = QUADRUPED_SHARED_FIELDS.filter(key => key !== "outputLevel");

function assertComplete(snapshot) {
  assert.doesNotThrow(() => presetStateKey(snapshot));
  assert.deepEqual(Object.keys(snapshot).sort(), ["actors", "groupMode", "groupSeed", "selectedActor", "soundSkinId", "version", "world"]);
  assert.equal(snapshot.version, 3);
  assert.ok(["ground", "tendon", "porcelain", "voltage", "breath"].includes(snapshot.soundSkinId));
  assert.ok(!Object.hasOwn(snapshot, "visualSkinId"), "appearance stays outside musical state");
  assert.ok(QUADRUPED_GROUP_MODES.includes(snapshot.groupMode));
  assert.ok(snapshot.actors.length >= 1 && snapshot.actors.length <= 3);
  assert.ok(snapshot.selectedActor >= 0 && snapshot.selectedActor < snapshot.actors.length);
  assert.equal(snapshot.selectedActor, Math.trunc(snapshot.selectedActor));
  assert.ok(snapshot.groupSeed > 0 && snapshot.groupSeed <= 0xffffffff);
  assert.deepEqual(snapshot.world, sanitizeQuadrupedWorld(snapshot.world));
  const leader = snapshot.actors[snapshot.selectedActor];
  for (const score of snapshot.actors) {
    assert.deepEqual(Object.keys(score).sort(), musicalFields);
    const { outputLevel, ...safe } = sanitizeQuadrupedState(score);
    assert.deepEqual(score, safe);
    if (snapshot.groupMode !== "solo") {
      assert.equal(snapshot.actors.length, 3);
    }
    for (const key of sharedFields) assert.deepEqual(score[key], leader[key], key);
    if (snapshot.groupMode === "herd") assert.equal(score.animalId, leader.animalId);
  }
  assert.deepEqual(normalizeQuadrupedPreset(snapshot), snapshot);
}

test("complete scenes retain the original bank and expand every animal, group, terrain and ground profile", () => {
  validateFullPresetBank(QUADRUPED_FULL_PRESETS);
  assert.equal(QUADRUPED_FULL_PRESETS.length, 27);
  assert.deepEqual(QUADRUPED_FULL_PRESETS.slice(0, 15).map(preset => preset.id), [
    "earth-procession", "crystal-carousel", "stair-flight", "velvet-paws", "crosswind",
    "long-shadows", "copper-scuttle", "timber-canter", "waterside-pack", "high-steps",
    "rabbit-springs", "dune-pace", "ice-whisper", "cavern-thunder", "glass-pond",
  ]);
  for (const { snapshot } of QUADRUPED_FULL_PRESETS) {
    assertComplete(snapshot);
    assert.deepEqual(clone(snapshot), snapshot, "factory scenes survive saved JSON without changing signed zero or other state");
  }
  const snapshots = QUADRUPED_FULL_PRESETS.map(preset => preset.snapshot);
  assert.equal(new Set(snapshots.map(scene => scene.soundSkinId)).size, 5);
  assert.deepEqual(new Set(snapshots.map(scene => scene.actors[0].animalId)), new Set(QUADRUPED_ANIMALS.map(item => item.id)));
  assert.deepEqual(new Set(snapshots.map(scene => scene.groupMode)), new Set(QUADRUPED_GROUP_MODES));
  assert.deepEqual(new Set(snapshots.map(scene => scene.actors[0].surfaceId)), new Set(QUADRUPED_TERRAINS.map(item => item.id)));
  assert.deepEqual(new Set(snapshots.map(scene => scene.actors[0].groundProfileId)), new Set(QUADRUPED_GROUND_PROFILES.map(item => item.id)));
  // Distinction does not depend on arbitrary IDs, seeds or provenance flags.
  const musicalKeys = snapshots.map(scene => presetStateKey({
    groupMode: scene.groupMode,
    scores: scene.actors.map(({ animalId, behaviorId, tempoBpm, surfaceId, groundProfileId, pattern, callPattern }) => (
      { animalId, behaviorId, tempoBpm, surfaceId, groundProfileId, pattern, callPattern }
    )),
  }));
  assert.equal(new Set(musicalKeys).size, QUADRUPED_FULL_PRESETS.length);
});

test("capture retains edited and parked actors while ignoring output, transport and clocks", () => {
  const source = clone(QUADRUPED_FULL_PRESETS.find(preset => preset.snapshot.groupMode === "trio").snapshot);
  source.groupMode = "solo";
  source.selectedActor = 2;
  source.actors = source.actors.map(score => ({ score: { ...score, outputLevel: 0.12 }, motor: { position: 913 }, offset: 0.3, transitions: new Map() }));
  source.actors[2].score.pattern["front-left"][3] = 0.82;
  source.actors[1].score.callPattern[1][7] = 0.43;
  source.actors[2].score.tempoBpm = 133;
  source.audioEnabled = true;
  source.playing = true;
  const captured = captureQuadrupedPreset(source);
  const before = clone(captured);
  assert.equal(captured.actors.length, 3);
  assert.equal(captured.selectedActor, 2);
  assert.equal(captured.actors[2].pattern["front-left"][3], 0.82);
  assert.equal(captured.actors[1].callPattern[1][7], 0.43);
  assert.ok(captured.actors.every(score => score.tempoBpm === 133), "parked actors retain the native shared tempo contract");
  for (const actor of source.actors) { actor.score.outputLevel = 0.65; actor.motor.position += 99; }
  source.audioEnabled = false;
  source.playing = false;
  assert.deepEqual(captureQuadrupedPreset(source), before);
  source.actors[2].score.pattern["front-left"][3] = 0;
  source.world.grain = 0;
  assert.deepEqual(captured, before, "nested score and world data must be detached");
  assert.notDeepEqual(captureQuadrupedPreset(source), captured);
  assertComplete(captured);
});

test("normalization repairs missing and malformed state with valid dependent group fields", () => {
  for (const input of [undefined, null, {}, { actors: [] }, { actors: [null], world: null }]) assertComplete(normalizeQuadrupedPreset(input));
  const candidate = {
    groupMode: "herd", selectedActor: 2, groupSeed: -17,
    world: { grain: Infinity, cavern: -4, seed: 0 },
    actors: [
      { ...createQuadrupedState("cat"), tempoBpm: 9, surfaceId: "invalid", pattern: { "front-left": [Infinity, -3, 7] } },
      createQuadrupedState("frog"),
      { ...createQuadrupedState("horse"), tempoBpm: 170, stride: 1.12, surfaceId: "wood", groundProfileId: "stairs-up" },
      createQuadrupedState("elephant"),
    ],
  };
  const scene = normalizeQuadrupedPreset(candidate);
  assertComplete(scene);
  assert.equal(scene.actors.length, 3);
  assert.equal(scene.actors[0].animalId, "horse");
  assert.equal(scene.actors[0].tempoBpm, 170);
  assert.equal(scene.actors[0].pattern["front-left"][2], 1);
  const padded = normalizeQuadrupedPreset({ groupMode: "trio", actors: [createQuadrupedState("unicorn")] });
  assertComplete(padded);
  assert.equal(padded.actors.length, 3);
});

test("solo scenes keep private parked scores and canonicalize the native shared controls", () => {
  const scene = normalizeQuadrupedPreset({
    groupMode: "solo", selectedActor: 2,
    actors: [createQuadrupedState("cat", "cat-prowl"), createQuadrupedState("goat", "jump"), {
      ...createQuadrupedState("horse", "canter"),
      tempoBpm: 137, paceRatio: 3, stride: 0.77, surfaceId: "water", groundProfileId: "stairs-down", groundResonance: 0.88,
    }],
  });
  assertComplete(scene);
  assert.deepEqual(scene.actors.map(score => score.animalId), ["cat", "goat", "horse"]);
  assert.deepEqual(scene.actors.map(score => score.behaviorId), ["cat-prowl", "jump", "canter"]);
  for (const score of scene.actors) for (const key of sharedFields) assert.equal(score[key], scene.actors[2][key]);
});

test("factory builders return independent snapshots", () => {
  const first = createQuadrupedFullPresets(), second = createQuadrupedFullPresets();
  assert.deepEqual(first, second);
  first[0].snapshot.actors[0].pattern["front-left"][0] = 0.123;
  first[0].snapshot.world.grain = 0;
  assert.deepEqual(second, QUADRUPED_FULL_PRESETS);
});

test("seeded dice creates fresh full scores and varies every musical field and pattern cell", () => {
  const current = clone(QUADRUPED_FULL_PRESETS[0].snapshot);
  const before = clone(current);
  const rng = quadrupedRandom(0x51c0ffee);
  const scenes = Array.from({ length: 400 }, () => randomizeQuadrupedPreset(current, rng));
  assert.deepEqual(current, before);
  assert.deepEqual(randomizeQuadrupedPreset(current, quadrupedRandom(91)), randomizeQuadrupedPreset(null, quadrupedRandom(91)));
  const bankKeys = new Set(QUADRUPED_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  for (const scene of scenes) {
    assertComplete(scene);
    assert.ok(!bankKeys.has(presetStateKey(scene)));
    for (const score of scene.actors) {
      assert.equal(score.customized, true);
      for (const row of Object.values(score.pattern)) {
        const hits = row.filter(value => value > 0);
        assert.ok(hits.length >= 2 && hits.length <= 5);
      }
      const calls = score.callPattern.flat().filter(value => value > 0);
      assert.ok(calls.length >= 1 && calls.length <= 4);
      for (let step = 0; step < 16; step += 1) assert.ok(score.callPattern.filter(row => row[step] > 0).length <= 1);
    }
  }
  assert.equal(new Set(scenes.map(presetStateKey)).size, scenes.length);
  for (const key of ["groupMode", "selectedActor", "groupSeed"]) assert.ok(new Set(scenes.map(scene => scene[key])).size > 1, key);
  for (const key of ["grain", "cavern", "seed"]) assert.ok(new Set(scenes.map(scene => scene.world[key])).size > 1, `world.${key}`);
  const scores = scenes.flatMap(scene => scene.actors);
  for (const key of musicalFields.filter(key => !["version", "customized", "pattern", "callPattern"].includes(key))) {
    assert.ok(new Set(scores.map(score => score[key])).size > 1, key);
  }
  assert.deepEqual(new Set(scores.map(score => score.behaviorId)), new Set(QUADRUPED_BEHAVIORS.map(item => item.id)));
  assert.deepEqual(new Set(scores.map(score => score.animalId)), new Set(QUADRUPED_ANIMALS.map(item => item.id)));
  for (const { id } of QUADRUPED_LANES) for (let step = 0; step < 16; step += 1) {
    assert.ok(new Set(scores.map(score => score.pattern[id][step])).size > 1, `${id}:${step}`);
  }
  for (let row = 0; row < 3; row += 1) for (let step = 0; step < 16; step += 1) {
    assert.ok(new Set(scores.map(score => score.callPattern[row][step])).size > 1, `call ${row}:${step}`);
  }
});

test("dice endpoints stay finite and invalid random sources fail explicitly", () => {
  for (const value of [-4, 0, 1, 7]) assertComplete(randomizeQuadrupedPreset(null, () => value));
  assert.throws(() => randomizeQuadrupedPreset(null, () => NaN), /finite/);
});


test("musical snapshots retain sound skins and ignore legacy animal appearance", () => {
  for (const version of [1, 2, 3]) for (const visualSkinId of ["animal", "skeleton", "constellation", "collage", "motion-card", "missing"]) {
    const source = { ...clone(QUADRUPED_FULL_PRESETS[6].snapshot), version, soundSkinId: "breath", visualSkinId };
    const before = clone(source);
    const normalized = normalizeQuadrupedPreset(source);
    assertComplete(normalized);
    assert.equal(normalized.soundSkinId, "breath");
    assert.deepEqual(normalized, { ...QUADRUPED_FULL_PRESETS[6].snapshot, soundSkinId: "breath" });
    assert.deepEqual(captureQuadrupedPreset(source), normalized);
    assert.deepEqual(source, before, "legacy migration never edits the saved source");
    assert.deepEqual(randomizeQuadrupedPreset(source, quadrupedRandom(91)), randomizeQuadrupedPreset(null, quadrupedRandom(91)));
  }
  assert.equal(normalizeQuadrupedPreset({ soundSkinId: "missing" }).soundSkinId, "ground");
});

test("version-one scenes migrate expressive controls neutrally without changing saved music", () => {
  const source = clone(QUADRUPED_FULL_PRESETS[6].snapshot);
  source.version = 1;
  source.visualSkinId = "animal";
  for (const score of source.actors) {
    score.version = 8;
    delete score.pitchSemitones;
    delete score.lopsided;
    delete score.spring;
  }
  const before = clone(source);
  const migrated = normalizeQuadrupedPreset(source);
  assertComplete(migrated);
  assert.deepEqual(source, before, "migration must be detached and transactional");
  assert.ok(!Object.hasOwn(migrated, "visualSkinId"), "legacy appearance is ignored without changing the music");
  for (let index = 0; index < source.actors.length; index += 1) {
    const { version, pitchSemitones, lopsided, spring, ...music } = migrated.actors[index];
    const { version: oldVersion, ...oldMusic } = source.actors[index];
    assert.deepEqual(music, oldMusic);
    assert.deepEqual({ pitchSemitones, lopsided, spring }, { pitchSemitones: 0, lopsided: 0, spring: 1 });
  }
  const edited = clone(migrated);
  Object.assign(edited.actors[0], { pitchSemitones: -31.7, lopsided: -0.94, spring: 2.34 });
  assert.deepEqual(captureQuadrupedPreset(edited), edited, "new fields survive capture and recall");
});

test("new scenes expose slow, uneven, superhero and extreme motion/register relationships", () => {
  const expanded = QUADRUPED_FULL_PRESETS.slice(15);
  assert.deepEqual(expanded.map(scene => scene.label.split(" · ")[0]), [
    "Slow motion", "Slow motion", "Slow motion", "Lopsided", "Lopsided", "Lopsided",
    "Superhero", "Superhero", "Superhero", "Extreme", "Extreme", "Extreme",
  ]);
  const scores = expanded.map(scene => scene.snapshot.actors[0]);
  const spans = {
    tempoBpm: [10, 1000], stride: [0.15, 2.4], momentum: [0.12, 3],
    gravity: [0.1, 3], pitchSemitones: [-36, 36], lopsided: [-1, 1], spring: [0, 2.5],
  };
  for (const [key, endpoints] of Object.entries(spans)) {
    assert.deepEqual([Math.min(...scores.map(score => score[key])), Math.max(...scores.map(score => score[key]))], endpoints, key);
  }
  assert.ok(scores.slice(0, 3).every(score => score.tempoBpm < 40));
  assert.ok(scores.slice(3, 6).every(score => Math.abs(score.lopsided) >= 0.75));
  assert.ok(scores.slice(6, 9).every(score => score.stride >= 2 && score.momentum >= 2.5));
  assert.ok(scores.slice(9).every(score => score.tempoBpm > 500));
  const crooked = expanded.find(scene => scene.id === "crooked-parade").snapshot;
  assert.ok(crooked.actors[0].lopsided * crooked.actors[1].lopsided < 0, "the trio opposes its lean");
});

test("dice reaches both expressive limits and favors playable centers without freezing fields", () => {
  const keys = ["tempoBpm", "stride", "momentum", "gravity", "pitchSemitones", "lopsided", "spring"];
  for (const [unit, endpoint] of [[0, 0], [1, 1]]) {
    const scene = randomizeQuadrupedPreset(null, () => unit);
    for (const score of scene.actors) for (const key of keys) {
      assert.ok(Math.abs(score[key] - QUADRUPED_LIMITS[key][endpoint]) < 1e-9, `${key} reaches ${endpoint ? "maximum" : "minimum"}`);
    }
  }
  const rng = quadrupedRandom(0x17883211);
  const scores = Array.from({ length: 500 }, () => randomizeQuadrupedPreset(null, rng).actors[0]);
  for (const [key, low, high] of [["tempoBpm", 45, 210], ["pitchSemitones", -12, 12], ["lopsided", -0.45, 0.45], ["spring", 0.6, 1.6]]) {
    const centered = scores.filter(score => score[key] >= low && score[key] <= high).length;
    assert.ok(centered > 300 && centered < 480, `${key}: ${centered} of 500 center-biased rolls`);
    assert.ok(scores.some(score => score[key] < low), `${key} explores below center`);
    assert.ok(scores.some(score => score[key] > high), `${key} explores above center`);
  }
});
