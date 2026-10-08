import {
  QUADRUPED_ANIMALS, QUADRUPED_BEHAVIORS, QUADRUPED_GROUND_PROFILES,
  QUADRUPED_LANES, QUADRUPED_LIMITS, QUADRUPED_PACE_RATIOS, QUADRUPED_STEP_COUNT,
  QUADRUPED_TERRAINS, createQuadrupedState, sanitizeQuadrupedState,
} from "./quadruped.js";
import {
  QUADRUPED_GROUP_MODES, QUADRUPED_SHARED_FIELDS, createQuadrupedGroup,
  sanitizeQuadrupedWorld,
} from "./quadruped-world.js";
import { emptyQuadrupedCalls } from "./quadruped-voices.js";
import { QUADRUPED_SOUND_SKINS } from "./quadruped-sound-skins.js";
import { QUADRUPED_VISUAL_SKINS } from "./quadruped-visual-skins.js";
import { presetRandom } from "../../site/preset-random.js";

const skinId = (skins, value) => skins.find(skin => skin.id === value)?.id ?? skins[0].id;
const sharedFields = QUADRUPED_SHARED_FIELDS.filter(key => key !== "outputLevel");
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const seed = (value, fallback = 1) => (finite(value, fallback) >>> 0) || 1;
const scoreSnapshot = value => {
  const { outputLevel, ...score } = sanitizeQuadrupedState(value);
  return score;
};

/** Musical scene only: master output, Audio, transport, motors and clocks stay live. */
export function normalizeQuadrupedPreset(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const groupMode = QUADRUPED_GROUP_MODES.includes(source.groupMode) ? source.groupMode : "solo";
  const rawActors = Array.isArray(source.actors) && source.actors.length ? source.actors.slice(0, 3) : [createQuadrupedState()];
  const actors = rawActors.map(actor => scoreSnapshot(actor?.score ?? actor));
  const selectedActor = Math.max(0, Math.min(actors.length - 1, Math.trunc(finite(source.selectedActor, 0))));
  if (groupMode !== "solo") {
    const leader = actors[selectedActor];
    const defaults = createQuadrupedGroup(leader, groupMode);
    while (actors.length < 3) actors.push(scoreSnapshot(defaults[actors.length]));
  }
  // The existing control surface keeps tempo and ground shared even when the
  // selected animal plays solo and its companions are parked.
  const leader = actors[selectedActor];
  const shared = Object.fromEntries(sharedFields.map(key => [key, leader[key]]));
  for (let index = 0; index < actors.length; index += 1) {
    actors[index] = scoreSnapshot({
      ...actors[index], ...shared,
      ...(groupMode === "herd" ? { animalId: leader.animalId } : {}),
    });
  }
  return {
    version: 1, actors, groupMode, selectedActor, groupSeed: seed(source.groupSeed),
    soundSkinId: skinId(QUADRUPED_SOUND_SKINS, source.soundSkinId),
    visualSkinId: skinId(QUADRUPED_VISUAL_SKINS, source.visualSkinId),
    world: { ...sanitizeQuadrupedWorld(source.world && typeof source.world === "object" ? source.world : {}) },
  };
}

// Accepts both live actors ({ score, motor, ... }) and plain snapshot scores.
export function captureQuadrupedPreset(state) {
  return normalizeQuadrupedPreset(state);
}

const scenes = [
  ["earth-procession", "Earth procession", "elephant", "walk", "herd", "earth", "level", 96, 0.72, 0.22],
  ["crystal-carousel", "Crystal carousel", "unicorn", "carousel", "solo", "crystal", "level", 110, 0.2, 0.4],
  ["stair-flight", "Stair flight", "gazelle", "stot", "solo", "stone", "stairs-up", 128, 0.48, 0.58],
  ["velvet-paws", "Velvet paws", "cat", "cat-prowl", "solo", "wood", "level", 72, 0.34, 0.18],
  ["crosswind", "Crosswind", "cheetah", "run-leap", "solo", "sand", "level", 146, 0.9, 0.12],
  ["long-shadows", "Long shadows", "giraffe", "giraffe-walk", "herd", "snow", "level", 80, 0.64, 0.36],
  ["copper-scuttle", "Copper scuttle", "lizard", "lizard-scuttle", "trio", "metal", "level", 112, 0.8, 0.46],
  ["timber-canter", "Timber canter", "horse", "canter", "solo", "wood", "level", 124, 0.4, 0.32],
  ["waterside-pack", "Waterside pack", "dog", "trot", "herd", "water", "level", 104, 0.88, 0.24],
  ["high-steps", "High steps", "goat", "jump", "trio", "stone", "stairs-up", 92, 0.54, 0.72],
  ["rabbit-springs", "Rabbit springs", "rabbit", "rabbit-gallop", "herd", "earth", "level", 118, 0.62, 0.28],
  ["dune-pace", "Dune pace", "camel", "pace", "solo", "sand", "stairs-down", 68, 0.96, 0.66],
  ["ice-whisper", "Ice whisper", "mouse", "tiptoe", "solo", "snow", "level", 132, 0.3, 0.16],
  ["cavern-thunder", "Cavern thunder", "dinosaur", "charge", "trio", "stone", "stairs-down", 64, 0.76, 0.95],
  ["glass-pond", "Glass pond", "frog", "bound", "solo", "crystal", "level", 88, 0.46, 0.5],
];

export function createQuadrupedFullPresets() {
  return scenes.map(([id, label, animalId, behaviorId, groupMode, surfaceId, groundProfileId, tempoBpm, grain, cavern], index) => {
    const leader = sanitizeQuadrupedState({
      ...createQuadrupedState(animalId, behaviorId), tempoBpm, surfaceId, groundProfileId,
      groundResonance: 0.28 + (index % 5) * 0.14,
      suspensionBeats: 1 + (index % 4) * 0.5,
    });
    const actors = createQuadrupedGroup(leader, groupMode).map((score, actorIndex) => {
      const callPattern = emptyQuadrupedCalls();
      callPattern[(index + actorIndex) % 3][(2 + index + actorIndex * 5) % 16] = 0.68;
      callPattern[(index + actorIndex + 1) % 3][(10 + index + actorIndex * 5) % 16] = 0.46;
      return { ...score, callPattern, mutationSeed: 0x51410000 + index * 31 + actorIndex };
    });
    return {
      id, label, description: `${animalId[0].toUpperCase()}${animalId.slice(1)} · ${groupMode} · ${surfaceId}`,
      snapshot: normalizeQuadrupedPreset({
        actors, groupMode, selectedActor: 0, groupSeed: 1 + index * 97,
        soundSkinId: QUADRUPED_SOUND_SKINS[index % 5].id,
        visualSkinId: QUADRUPED_VISUAL_SKINS[index % 5].id,
        world: { seed: 0x71750000 + index * 173, grain, cavern },
      }),
    };
  });
}

export const QUADRUPED_FULL_PRESETS = Object.freeze(createQuadrupedFullPresets());

function randomPattern(rng) {
  return Object.fromEntries(QUADRUPED_LANES.map(({ id }) => {
    const row = Array(QUADRUPED_STEP_COUNT).fill(0);
    const available = Array.from({ length: QUADRUPED_STEP_COUNT }, (_, step) => step);
    const count = rng.integer(2, 5);
    for (let hit = 0; hit < count; hit += 1) {
      const [step] = available.splice(rng.integer(0, available.length - 1), 1);
      row[step] = rng.between(0.35, 1);
    }
    return [id, row];
  }));
}

function randomCalls(rng) {
  const calls = emptyQuadrupedCalls();
  // At most four calls per cycle and at most one call at any step per animal.
  const available = Array.from({ length: QUADRUPED_STEP_COUNT }, (_, step) => step);
  const count = rng.integer(1, 4);
  for (let hit = 0; hit < count; hit += 1) {
    const [step] = available.splice(rng.integer(0, available.length - 1), 1);
    calls[rng.integer(0, 2)][step] = rng.between(0.3, 0.9);
  }
  return calls;
}

/** Generate a new bounded score, including every editable foot/call cell. */
export function randomizeQuadrupedPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const groupMode = rng.pick(QUADRUPED_GROUP_MODES);
  const count = groupMode === "solo" ? rng.pick([1, 3]) : 3;
  const herdAnimal = rng.pick(QUADRUPED_ANIMALS).id;
  const actors = Array.from({ length: count }, () => {
    const animalId = groupMode === "herd" ? herdAnimal : rng.pick(QUADRUPED_ANIMALS).id;
    const behaviorId = rng.pick(QUADRUPED_BEHAVIORS).id;
    return {
      ...createQuadrupedState(animalId, behaviorId),
      tempoBpm: rng.integer(56, 160), paceRatio: rng.pick(QUADRUPED_PACE_RATIOS),
      suspensionBeats: rng.between(0, 8), stride: rng.between(...QUADRUPED_LIMITS.stride),
      momentum: rng.between(...QUADRUPED_LIMITS.momentum), gravity: rng.between(...QUADRUPED_LIMITS.gravity),
      mood: rng.unit(), groundResonance: rng.unit(),
      surfaceId: rng.pick(QUADRUPED_TERRAINS).id, groundProfileId: rng.pick(QUADRUPED_GROUND_PROFILES).id,
      pattern: randomPattern(rng), callPattern: randomCalls(rng),
      customized: true, mutationSeed: rng.integer(1, 0xffffffff),
    };
  });
  return normalizeQuadrupedPreset({
    actors, groupMode, selectedActor: rng.integer(0, count - 1), groupSeed: rng.integer(1, 0xffffffff),
    soundSkinId: rng.pick(QUADRUPED_SOUND_SKINS).id, visualSkinId: rng.pick(QUADRUPED_VISUAL_SKINS).id,
    world: { seed: rng.integer(1, 0xffffffff), grain: rng.unit(), cavern: rng.unit() },
  });
}
