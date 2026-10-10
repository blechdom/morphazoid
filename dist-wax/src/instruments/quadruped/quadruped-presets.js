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
import { presetRandom } from "../../site/preset-random.js";

const skinId = (skins, value, fallback = skins[0].id) => skins.find(skin => skin.id === value)?.id ?? fallback;
const sharedFields = QUADRUPED_SHARED_FIELDS.filter(key => key !== "outputLevel");
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const seed = (value, fallback = 1) => (finite(value, fallback) >>> 0) || 1;
const scoreSnapshot = value => {
  // Version-one scenes have no expressive controls. Add their neutral values
  // before validation, without mutating a saved scene or inheriting live edits.
  const source = value && typeof value === "object" ? value : {};
  const { outputLevel, ...score } = sanitizeQuadrupedState({
    ...source,
    pitchSemitones: source.pitchSemitones ?? 0,
    lopsided: source.lopsided ?? 0,
    spring: source.spring ?? 1,
  });
  return score;
};

/** Musical scene only: appearance, master output, Audio, transport, motors and clocks stay live.
 * Version three drops legacy visualSkinId so recalling older scenes cannot change appearance. */
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
    version: 3, actors, groupMode, selectedActor, groupSeed: seed(source.groupSeed),
    soundSkinId: skinId(QUADRUPED_SOUND_SKINS, source.soundSkinId),
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

function createOriginalPresets() {
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
        world: { seed: 0x71750000 + index * 173, grain, cavern },
      }),
    };
  });
}

// Each scene explores a different motion/register relationship. These are
// expressive fantasy settings, not claims about an animal's physical limits.
const expandedScenes = [
  {
    id: "lunar-drift", label: "Slow motion · Lunar drift", description: "Low elephant breath; long, floating steps.",
    animalId: "elephant", behaviorId: "walk", soundSkinId: "breath",
    controls: { tempoBpm: 18, stride: 0.38, momentum: 0.18, gravity: 0.13, pitchSemitones: -24, lopsided: -0.15, spring: 1.8, surfaceId: "snow", groundResonance: 0.2 },
    world: { grain: 0.14, cavern: 0.82 }, calls: [[0, 1, 0.76], [2, 11, 0.48]],
  },
  {
    id: "deep-time", label: "Slow motion · Deep time", description: "Subterranean triceratops; almost-still, heavy impacts.",
    animalId: "dinosaur", behaviorId: "charge", soundSkinId: "ground",
    controls: { tempoBpm: 10, stride: 0.22, momentum: 0.12, gravity: 2.8, pitchSemitones: -36, lopsided: 0.1, spring: 0.25, surfaceId: "stone", groundResonance: 0.9 },
    world: { grain: 0.28, cavern: 0.96 }, calls: [[0, 0, 0.82]],
  },
  {
    id: "weightless-carousel", label: "Slow motion · Weightless carousel", description: "A high glass unicorn with elastic, low-gravity turns.",
    animalId: "unicorn", behaviorId: "carousel", soundSkinId: "porcelain",
    controls: { tempoBpm: 32, stride: 1.4, momentum: 1.1, gravity: 0.1, pitchSemitones: 12.4, lopsided: 0, spring: 2.5, surfaceId: "crystal", groundResonance: 0.8 },
    world: { grain: 0.08, cavern: 0.68 }, calls: [[2, 3, 0.54], [1, 12, 0.36]],
  },
  {
    id: "crooked-parade", label: "Lopsided · Crooked parade", description: "Three stretched strides pull in opposing directions.",
    animalId: "camel", behaviorId: "pace", groupMode: "trio", soundSkinId: "tendon",
    controls: { tempoBpm: 82, stride: 1.75, momentum: 1.4, gravity: 0.6, pitchSemitones: -7.3, lopsided: -0.92, spring: 1.5, surfaceId: "wood", groundResonance: 0.66 },
    world: { grain: 0.84, cavern: 0.22 }, calls: [[1, 5, 0.58]],
  },
  {
    id: "sideways-moon", label: "Lopsided · Sideways moon", description: "An elastic cat tilts hard into an uneven electronic shuffle.",
    animalId: "cat", behaviorId: "drunk", soundSkinId: "voltage",
    controls: { tempoBpm: 143, stride: 1.9, momentum: 0.6, gravity: 0.4, pitchSemitones: 6.7, lopsided: 1, spring: 2.1, surfaceId: "metal", groundResonance: 0.76 },
    world: { grain: 0.92, cavern: 0.32 }, calls: [[1, 2, 0.48], [2, 9, 0.72]],
  },
  {
    id: "stilt-shuffle", label: "Lopsided · Stilt shuffle", description: "Tiny goat steps, heavy gravity, and a stubborn sideways lean.",
    animalId: "goat", behaviorId: "tiptoe", soundSkinId: "tendon",
    controls: { tempoBpm: 63, stride: 0.3, momentum: 2.3, gravity: 2.4, pitchSemitones: -14.2, lopsided: -0.78, spring: 0.16, surfaceId: "wood", groundProfileId: "stairs-up", groundResonance: 0.42 },
    world: { grain: 0.72, cavern: 0.14 }, calls: [[0, 6, 0.66], [1, 14, 0.44]],
  },
  {
    id: "silver-streak", label: "Superhero · Silver streak", description: "A sleek electric cheetah at full stride and momentum.",
    animalId: "cheetah", behaviorId: "run-leap", soundSkinId: "voltage",
    controls: { tempoBpm: 310, stride: 2.4, momentum: 3, gravity: 0.42, pitchSemitones: 18, lopsided: 0, spring: 1.35, suspensionBeats: 0.4, surfaceId: "metal", groundResonance: 0.44 },
    world: { grain: 0.2, cavern: 0.1 }, calls: [[2, 0, 0.62]],
  },
  {
    id: "skybound", label: "Superhero · Skybound", description: "A gazelle vaults through long, bright low-gravity arcs.",
    animalId: "gazelle", behaviorId: "stot", soundSkinId: "porcelain",
    controls: { tempoBpm: 190, stride: 2.1, momentum: 2.5, gravity: 0.1, pitchSemitones: 7.6, lopsided: 0.08, spring: 2.5, suspensionBeats: 5.5, surfaceId: "crystal", groundResonance: 0.66 },
    world: { grain: 0.12, cavern: 0.58 }, calls: [[2, 2, 0.66], [1, 13, 0.4]],
  },
  {
    id: "thunder-charge", label: "Superhero · Thunder charge", description: "A low, fast armored herd drives massive grounded steps.",
    animalId: "dinosaur", behaviorId: "charge", groupMode: "herd", soundSkinId: "ground",
    controls: { tempoBpm: 220, stride: 2.2, momentum: 2.8, gravity: 3, pitchSemitones: -30, lopsided: 0, spring: 0.25, surfaceId: "stone", groundResonance: 0.96 },
    world: { grain: 0.48, cavern: 0.4 }, calls: [[0, 0, 0.74]],
  },
  {
    id: "hyperdrive", label: "Extreme · Hyperdrive", description: "A tiny mouse becomes a bright, rapid electrical swarm.",
    animalId: "mouse", behaviorId: "sprint", soundSkinId: "voltage",
    controls: { tempoBpm: 1000, stride: 0.15, momentum: 2.8, gravity: 0.3, pitchSemitones: 36, lopsided: 0.2, spring: 0.4, suspensionBeats: 0, surfaceId: "metal", groundResonance: 0.18 },
    world: { grain: 0.42, cavern: 0.04 }, calls: [[2, 4, 0.44]],
  },
  {
    id: "rubber-storm", label: "Extreme · Rubber storm", description: "A fast frog trio bounces and buckles in opposing elastic gaits.",
    animalId: "frog", behaviorId: "bound", groupMode: "trio", soundSkinId: "tendon",
    controls: { tempoBpm: 560, stride: 2.3, momentum: 1.8, gravity: 0.18, pitchSemitones: -18.6, lopsided: -1, spring: 2.5, suspensionBeats: 0.7, surfaceId: "water", groundResonance: 0.78 },
    world: { grain: 0.98, cavern: 0.28 }, calls: [[0, 3, 0.56], [1, 10, 0.4]],
  },
  {
    id: "needle-rain", label: "Extreme · Needle rain", description: "High porcelain clicks over short, stiff, off-balance steps.",
    animalId: "lizard", behaviorId: "lizard-scuttle", soundSkinId: "porcelain",
    controls: { tempoBpm: 720, stride: 0.24, momentum: 0.2, gravity: 2.7, pitchSemitones: 30.8, lopsided: 0.76, spring: 0, surfaceId: "crystal", groundProfileId: "stairs-down", groundResonance: 0.28 },
    world: { grain: 0.64, cavern: 0.12 }, calls: [[1, 8, 0.36]],
  },
];

function createExpandedPreset(scene, index) {
  const { id, label, description, animalId, behaviorId, controls, calls } = scene;
  const groupMode = scene.groupMode ?? "solo";
  const leader = sanitizeQuadrupedState({ ...createQuadrupedState(animalId, behaviorId), ...controls });
  const actors = createQuadrupedGroup(leader, groupMode).map((score, actorIndex) => {
    const callPattern = emptyQuadrupedCalls();
    for (const [voice, step, strength] of calls) callPattern[voice][(step + actorIndex * 5) % 16] = strength;
    return {
      ...score, ...controls,
      lopsided: actorIndex === 1 && controls.lopsided !== 0 ? -controls.lopsided : controls.lopsided,
      callPattern, mutationSeed: 0x58410000 + index * 31 + actorIndex,
    };
  });
  return {
    id, label, description,
    snapshot: normalizeQuadrupedPreset({
      actors, groupMode, selectedActor: 0, groupSeed: 0x1150 + index * 97,
      soundSkinId: scene.soundSkinId,
      world: { seed: 0x78750000 + index * 173, ...scene.world },
    }),
  };
}

export function createQuadrupedFullPresets() {
  return [...createOriginalPresets(), ...expandedScenes.map(createExpandedPreset)];
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

// Spend most rolls near a playable center, while both limits remain reachable.
// Positive tempo uses a logarithmic spread so slow scenes are not crowded out.
function exploreRange(rng, limits, center, logarithmic = false) {
  const band = rng.unit();
  const [low, high] = band > 0.15 && band < 0.85 ? center : limits;
  const unit = rng.unit();
  return logarithmic ? low * (high / low) ** unit : low + (high - low) * unit;
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
      tempoBpm: Math.round(exploreRange(rng, QUADRUPED_LIMITS.tempoBpm, [45, 210], true)), paceRatio: rng.pick(QUADRUPED_PACE_RATIOS),
      suspensionBeats: rng.between(0, 8),
      stride: exploreRange(rng, QUADRUPED_LIMITS.stride, [0.55, 1.5]),
      momentum: exploreRange(rng, QUADRUPED_LIMITS.momentum, [0.5, 1.7]),
      gravity: exploreRange(rng, QUADRUPED_LIMITS.gravity, [0.45, 1.7]),
      pitchSemitones: exploreRange(rng, QUADRUPED_LIMITS.pitchSemitones, [-12, 12]),
      lopsided: exploreRange(rng, QUADRUPED_LIMITS.lopsided, [-0.45, 0.45]),
      spring: exploreRange(rng, QUADRUPED_LIMITS.spring, [0.6, 1.6]),
      mood: rng.unit(), groundResonance: rng.unit(),
      surfaceId: rng.pick(QUADRUPED_TERRAINS).id, groundProfileId: rng.pick(QUADRUPED_GROUND_PROFILES).id,
      pattern: randomPattern(rng), callPattern: randomCalls(rng),
      customized: true, mutationSeed: rng.integer(1, 0xffffffff),
    };
  });
  return normalizeQuadrupedPreset({
    actors, groupMode, selectedActor: rng.integer(0, count - 1), groupSeed: rng.integer(1, 0xffffffff),
    soundSkinId: rng.pick(QUADRUPED_SOUND_SKINS).id,
    world: { seed: rng.integer(1, 0xffffffff), grain: rng.unit(), cavern: rng.unit() },
  });
}
