const CONTACT_LEVELS = Object.freeze([0, 0.58, 1]);

export const QUADRUPED_STEP_COUNT = 16;

export const QUADRUPED_LIMITS = Object.freeze({
  tempoBpm: Object.freeze([42, 196]),
  stride: Object.freeze([0.55, 1.35]),
  mood: Object.freeze([0, 1]),
  groundResonance: Object.freeze([0, 1]),
  outputLevel: Object.freeze([0, 0.72]),
  maxScheduledVoices: 48,
  maxHeadVoices: 16,
  schedulerLookaheadSeconds: 0.09,
});

export const QUADRUPED_LANES = Object.freeze([
  Object.freeze({ id: "front-left", label: "Left front foot", shortLabel: "LF", color: "#ffcc66" }),
  Object.freeze({ id: "front-right", label: "Right front foot", shortLabel: "RF", color: "#ff7e8a" }),
  Object.freeze({ id: "rear-left", label: "Left hind foot", shortLabel: "LH", color: "#68e0c1" }),
  Object.freeze({ id: "rear-right", label: "Right hind foot", shortLabel: "RH", color: "#7f9cff" }),
  Object.freeze({ id: "tail", label: "Tail percussion", shortLabel: "TAIL", color: "#d69cff" }),
]);

export const QUADRUPED_TERRAINS = Object.freeze([
  Object.freeze({ id: "earth", label: "Packed earth", shortLabel: "EARTH", color: "#9a6845", pitchOffset: -5, decay: 0.2, brightness: 0.16 }),
  Object.freeze({ id: "wood", label: "Hollow wood", shortLabel: "WOOD", color: "#d09b55", pitchOffset: 0, decay: 0.32, brightness: 0.38 }),
  Object.freeze({ id: "metal", label: "Bell metal", shortLabel: "METAL", color: "#75c7d3", pitchOffset: 5, decay: 0.56, brightness: 0.68 }),
  Object.freeze({ id: "crystal", label: "Resonant crystal", shortLabel: "GLASS", color: "#db9cff", pitchOffset: 9, decay: 0.78, brightness: 0.94 }),
]);

export const QUADRUPED_BEHAVIORS = Object.freeze([
  Object.freeze({ id: "walk", label: "Walk", description: "4 even beats · lateral", stanceSteps: 9.4, animalIds: Object.freeze(["elephant", "unicorn", "gazelle"]) }),
  Object.freeze({ id: "amble", label: "Amble", description: "4 close beats · lateral", stanceSteps: 8.8, animalIds: Object.freeze(["elephant", "unicorn"]) }),
  Object.freeze({ id: "charge", label: "Charge", description: "4 fast beats · grounded", stanceSteps: 7.4, animalIds: Object.freeze(["elephant"]) }),
  Object.freeze({ id: "trot", label: "Trot", description: "2 beats · diagonal pairs", stanceSteps: 6.2, animalIds: Object.freeze(["unicorn", "gazelle"]) }),
  Object.freeze({ id: "pace", label: "Pace", description: "2 beats · same-side pairs", stanceSteps: 6.8, animalIds: Object.freeze(["unicorn"]) }),
  Object.freeze({ id: "canter", label: "Canter", description: "3 beats · right lead", stanceSteps: 5.1, animalIds: Object.freeze(["unicorn", "gazelle"]) }),
  Object.freeze({ id: "gallop", label: "Gallop", description: "4 beats · transverse", stanceSteps: 3.4, animalIds: Object.freeze(["unicorn"]) }),
  Object.freeze({ id: "sprint", label: "Sprint", description: "4 beats · rotary + flight", stanceSteps: 2.4, animalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "stot", label: "Stot", description: "4 together · flight", stanceSteps: 1.8, animalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "jump", label: "Jump", description: "rear launch · 4-foot land", stanceSteps: 2.8, animalIds: Object.freeze(["elephant", "unicorn", "gazelle"]) }),
  Object.freeze({ id: "dance", label: "Dance", description: "2-leg balance · diagonals", stanceSteps: 7.2, animalIds: Object.freeze(["elephant", "unicorn", "gazelle"]) }),
]);

export const QUADRUPED_FOOT_VOICES = Object.freeze({
  elephant: Object.freeze({
    "front-left": Object.freeze({ label: "hide slap", family: "fore-slap" }),
    "front-right": Object.freeze({ label: "hollow knock", family: "fore-knock" }),
    "rear-left": Object.freeze({ label: "sub drum", family: "hind-sub" }),
    "rear-right": Object.freeze({ label: "floor drum", family: "hind-tom" }),
    tail: Object.freeze({ label: "tail brush", family: "brush" }),
  }),
  unicorn: Object.freeze({
    "front-left": Object.freeze({ label: "glass bell", family: "fore-glass" }),
    "front-right": Object.freeze({ label: "silver bell", family: "fore-silver" }),
    "rear-left": Object.freeze({ label: "hoof clop", family: "hind-clop" }),
    "rear-right": Object.freeze({ label: "crystal kick", family: "hind-crystal" }),
    tail: Object.freeze({ label: "star shimmer", family: "shimmer" }),
  }),
  gazelle: Object.freeze({
    "front-left": Object.freeze({ label: "wood tick", family: "fore-tick" }),
    "front-right": Object.freeze({ label: "stick click", family: "fore-click" }),
    "rear-left": Object.freeze({ label: "low marimba", family: "hind-low" }),
    "rear-right": Object.freeze({ label: "high marimba", family: "hind-high" }),
    tail: Object.freeze({ label: "tail whip", family: "whip" }),
  }),
});

const ANIMAL_DEFINITIONS = Object.freeze({
  elephant: Object.freeze({
    id: "elephant",
    label: "Elephant",
    subtitle: "thick ground orchestra",
    description: "Heavy feet. Rising trumpet.",
    defaultBehaviorId: "walk",
    behaviorIds: Object.freeze(["walk", "amble", "charge", "jump", "dance"]),
    mood: 0.54,
    groundResonance: 0.72,
    outputLevel: 0.62,
    bodyScale: 1.12,
    palette: Object.freeze(["#d2b187", "#8e705b", "#ffae57", "#5a4037", "#f7ddbd"]),
    scale: Object.freeze([50, 53, 55, 58, 62, 65]),
    tempoByBehavior: Object.freeze({ walk: 72, amble: 92, charge: 126, jump: 86, dance: 98 }),
  }),
  unicorn: Object.freeze({
    id: "unicorn",
    label: "Unicorn",
    subtitle: "prismatic hoof magic",
    description: "Crystal hooves. Sparkle neigh.",
    defaultBehaviorId: "canter",
    behaviorIds: Object.freeze(["walk", "amble", "trot", "pace", "canter", "gallop", "jump", "dance"]),
    mood: 0.86,
    groundResonance: 0.84,
    outputLevel: 0.6,
    bodyScale: 0.98,
    palette: Object.freeze(["#f9f2ff", "#ba87ff", "#58e8ef", "#ff83c9", "#ffe38a"]),
    scale: Object.freeze([62, 66, 69, 73, 78, 81]),
    tempoByBehavior: Object.freeze({ walk: 96, amble: 112, trot: 138, pace: 130, canter: 152, gallop: 176, jump: 110, dance: 126 }),
  }),
  gazelle: Object.freeze({
    id: "gazelle",
    label: "Gazelle",
    subtitle: "quick-foot sprint ensemble",
    description: "Quick feet. Marimba strings.",
    defaultBehaviorId: "sprint",
    behaviorIds: Object.freeze(["walk", "trot", "canter", "sprint", "stot", "jump", "dance"]),
    mood: 0.68,
    groundResonance: 0.48,
    outputLevel: 0.62,
    bodyScale: 0.88,
    palette: Object.freeze(["#e5b86d", "#6e4227", "#f3e8c3", "#141111", "#ed704f"]),
    scale: Object.freeze([57, 60, 64, 67, 69, 72]),
    tempoByBehavior: Object.freeze({ walk: 112, trot: 150, canter: 166, sprint: 190, stot: 140, jump: 132, dance: 148 }),
  }),
});

export const QUADRUPED_ANIMALS = Object.freeze(Object.values(ANIMAL_DEFINITIONS));

const BEHAVIOR_HITS = Object.freeze({
  walk: Object.freeze({
    "front-left": Object.freeze([[12, 0.88]]),
    "front-right": Object.freeze([[4, 0.92]]),
    "rear-left": Object.freeze([[8, 0.94]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[3, 0.46], [11, 0.62]]),
  }),
  amble: Object.freeze({
    "front-left": Object.freeze([[10, 0.88]]),
    "front-right": Object.freeze([[2, 0.94]]),
    "rear-left": Object.freeze([[8, 0.9]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[4, 0.48], [12, 0.68]]),
  }),
  charge: Object.freeze({
    "front-left": Object.freeze([[11, 0.96]]),
    "front-right": Object.freeze([[3, 1]]),
    "rear-left": Object.freeze([[8, 1]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[2, 0.46], [6, 0.62], [10, 0.52], [14, 0.76]]),
  }),
  trot: Object.freeze({
    "front-left": Object.freeze([[0, 0.94]]),
    "front-right": Object.freeze([[8, 1]]),
    "rear-left": Object.freeze([[8, 0.9]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[4, 0.5], [12, 0.72]]),
  }),
  pace: Object.freeze({
    "front-left": Object.freeze([[8, 0.94]]),
    "front-right": Object.freeze([[0, 1]]),
    "rear-left": Object.freeze([[8, 0.9]]),
    "rear-right": Object.freeze([[0, 0.96]]),
    tail: Object.freeze([[4, 0.54], [12, 0.72]]),
  }),
  canter: Object.freeze({
    "front-left": Object.freeze([[5, 0.88]]),
    "front-right": Object.freeze([[10, 1]]),
    "rear-left": Object.freeze([[0, 0.94]]),
    "rear-right": Object.freeze([[5, 0.9]]),
    tail: Object.freeze([[13, 0.7], [15, 0.48]]),
  }),
  gallop: Object.freeze({
    "front-left": Object.freeze([[8, 0.9]]),
    "front-right": Object.freeze([[11, 1]]),
    "rear-left": Object.freeze([[0, 0.92]]),
    "rear-right": Object.freeze([[5, 0.96]]),
    tail: Object.freeze([[13, 0.72], [15, 0.52]]),
  }),
  sprint: Object.freeze({
    "front-left": Object.freeze([[8, 0.94]]),
    "front-right": Object.freeze([[10, 1]]),
    "rear-left": Object.freeze([[2, 0.96]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[5, 0.62], [13, 0.82]]),
  }),
  stot: Object.freeze({
    "front-left": Object.freeze([[0, 1], [8, 0.92]]),
    "front-right": Object.freeze([[0, 1], [8, 0.92]]),
    "rear-left": Object.freeze([[0, 1], [8, 0.92]]),
    "rear-right": Object.freeze([[0, 1], [8, 0.92]]),
    tail: Object.freeze([[4, 0.68], [12, 0.82]]),
  }),
  jump: Object.freeze({
    "front-left": Object.freeze([[8, 1]]),
    "front-right": Object.freeze([[8, 1]]),
    "rear-left": Object.freeze([[0, 0.9], [8, 1]]),
    "rear-right": Object.freeze([[0, 0.9], [8, 1]]),
    tail: Object.freeze([[3, 0.7], [11, 0.54]]),
  }),
  dance: Object.freeze({
    "front-left": Object.freeze([[0, 1]]),
    "front-right": Object.freeze([[8, 0.94]]),
    "rear-left": Object.freeze([[8, 1]]),
    "rear-right": Object.freeze([[0, 0.94]]),
    tail: Object.freeze([[2, 0.72], [6, 0.9], [10, 0.72], [14, 1]]),
  }),
});

const TERRAIN_PATTERNS = Object.freeze({
  elephant: Object.freeze(["earth", "earth", "wood", "earth", "earth", "metal", "wood", "earth", "earth", "wood", "earth", "metal", "earth", "earth", "wood", "earth"]),
  unicorn: Object.freeze(["crystal", "metal", "crystal", "wood", "crystal", "crystal", "metal", "crystal", "wood", "crystal", "metal", "crystal", "crystal", "wood", "crystal", "metal"]),
  gazelle: Object.freeze(["wood", "earth", "wood", "metal", "earth", "wood", "earth", "crystal", "wood", "earth", "metal", "wood", "earth", "wood", "crystal", "earth"]),
});

const BEHAVIOR_MOTION = Object.freeze({
  walk: Object.freeze({ lift: 0.42, bounce: 0.13, aerial: 0, sway: 0.1, stride: 0.72 }),
  amble: Object.freeze({ lift: 0.5, bounce: 0.16, aerial: 0, sway: 0.13, stride: 0.8 }),
  charge: Object.freeze({ lift: 0.62, bounce: 0.27, aerial: 0, sway: 0.2, stride: 0.94 }),
  trot: Object.freeze({ lift: 0.72, bounce: 0.34, aerial: 0.2, sway: 0.16, stride: 0.98 }),
  pace: Object.freeze({ lift: 0.66, bounce: 0.29, aerial: 0.12, sway: 0.26, stride: 0.94 }),
  canter: Object.freeze({ lift: 0.84, bounce: 0.42, aerial: 0.3, sway: 0.22, stride: 1.05 }),
  gallop: Object.freeze({ lift: 0.96, bounce: 0.52, aerial: 0.4, sway: 0.27, stride: 1.16 }),
  sprint: Object.freeze({ lift: 1.05, bounce: 0.58, aerial: 0.56, sway: 0.3, stride: 1.24 }),
  stot: Object.freeze({ lift: 1.12, bounce: 0.7, aerial: 0.82, sway: 0.08, stride: 0.72 }),
  jump: Object.freeze({ lift: 1.05, bounce: 0.76, aerial: 0.72, sway: 0.08, stride: 1.18 }),
  dance: Object.freeze({ lift: 0.62, bounce: 0.36, aerial: 0.1, sway: 0.48, stride: 0.86 }),
});

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function stepDirection(direction) {
  const value = Number(direction);
  return Number.isFinite(value) && value < 0 ? -1 : 1;
}

function behaviorDefinition(id, animalId = null) {
  const requested = QUADRUPED_BEHAVIORS.find((entry) => entry.id === id);
  if (requested && (!animalId || requested.animalIds.includes(animalId))) return requested;
  const animal = ANIMAL_DEFINITIONS[animalId] ?? ANIMAL_DEFINITIONS.elephant;
  return QUADRUPED_BEHAVIORS.find((entry) => entry.id === animal.defaultBehaviorId) ?? QUADRUPED_BEHAVIORS[0];
}

export function quadrupedAnimal(id = "elephant") {
  return ANIMAL_DEFINITIONS[id] ?? ANIMAL_DEFINITIONS.elephant;
}

export function quadrupedBehavior(id = "walk") {
  return behaviorDefinition(id);
}

export function quadrupedBehaviorsForAnimal(animalId = "elephant") {
  const animal = quadrupedAnimal(animalId);
  return QUADRUPED_BEHAVIORS.filter((behavior) => animal.behaviorIds.includes(behavior.id));
}

export function quadrupedFootVoice(animalId = "elephant", laneId = "front-left") {
  const animal = quadrupedAnimal(animalId);
  return QUADRUPED_FOOT_VOICES[animal.id]?.[laneId] ?? QUADRUPED_FOOT_VOICES.elephant["front-left"];
}

export function quadrupedTerrain(id = "earth") {
  return QUADRUPED_TERRAINS.find((entry) => entry.id === id) ?? QUADRUPED_TERRAINS[0];
}

function emptyPattern() {
  return Object.fromEntries(QUADRUPED_LANES.map(({ id }) => [id, Array(QUADRUPED_STEP_COUNT).fill(0)]));
}

function authoredPattern(animalId, behaviorId) {
  const source = BEHAVIOR_HITS[behaviorId] ?? BEHAVIOR_HITS.walk;
  const pattern = emptyPattern();
  for (const lane of QUADRUPED_LANES) {
    for (const [step, intensity] of source[lane.id] ?? []) {
      pattern[lane.id][mod(step, QUADRUPED_STEP_COUNT)] = clamp(intensity);
    }
  }

  if (animalId === "elephant") {
    for (const lane of QUADRUPED_LANES.slice(0, 4)) {
      pattern[lane.id] = pattern[lane.id].map((value) => value > 0 ? clamp(0.12 + value * 0.92) : 0);
    }
  }
  if (animalId === "unicorn") {
    for (const step of [3, 7, 11, 15]) pattern.tail[step] = Math.max(pattern.tail[step], step % 8 === 3 ? 0.7 : 0.46);
  }
  if (animalId === "gazelle" && ["trot", "canter", "sprint", "stot", "dance"].includes(behaviorId)) {
    for (const step of [4, 6, 12, 14]) pattern.tail[step] = Math.max(pattern.tail[step], step % 8 === 6 ? 0.58 : 0.36);
  }
  return pattern;
}

function sanitizedPattern(source, fallback) {
  const pattern = {};
  for (const lane of QUADRUPED_LANES) {
    const values = Array.isArray(source?.[lane.id]) ? source[lane.id] : fallback[lane.id];
    pattern[lane.id] = Array.from({ length: QUADRUPED_STEP_COUNT }, (_, step) => clamp(values?.[step] ?? fallback[lane.id][step]));
  }
  return pattern;
}

function defaultStride(animalId, behaviorId) {
  const behavior = BEHAVIOR_MOTION[behaviorId] ?? BEHAVIOR_MOTION.walk;
  const animalScale = animalId === "elephant" ? 0.86 : animalId === "gazelle" ? 1.08 : 1;
  return clamp(behavior.stride * animalScale, ...QUADRUPED_LIMITS.stride);
}

export function createQuadrupedState(animalId = "elephant", behaviorId = null) {
  const animal = quadrupedAnimal(animalId);
  const behavior = behaviorDefinition(behaviorId ?? animal.defaultBehaviorId, animal.id);
  return {
    version: 2,
    animalId: animal.id,
    behaviorId: behavior.id,
    tempoBpm: animal.tempoByBehavior[behavior.id],
    stride: defaultStride(animal.id, behavior.id),
    mood: animal.mood,
    groundResonance: animal.groundResonance,
    outputLevel: animal.outputLevel,
    pattern: authoredPattern(animal.id, behavior.id),
    terrain: [...TERRAIN_PATTERNS[animal.id]],
    customized: false,
    mutationSeed: 0x51414452,
  };
}

export function sanitizeQuadrupedState(candidate, fallback = createQuadrupedState()) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const fallbackAnimal = quadrupedAnimal(fallback?.animalId);
  const animal = quadrupedAnimal(source.animalId ?? fallbackAnimal.id);
  const requestedBehavior = quadrupedBehaviorsForAnimal(animal.id).some(({ id }) => id === source.behaviorId)
    ? source.behaviorId
    : quadrupedBehaviorsForAnimal(animal.id).some(({ id }) => id === fallback?.behaviorId)
      ? fallback.behaviorId
      : animal.defaultBehaviorId;
  const behavior = behaviorDefinition(requestedBehavior, animal.id);
  const authored = authoredPattern(animal.id, behavior.id);
  const fallbackPattern = fallback?.animalId === animal.id && fallback?.behaviorId === behavior.id
    ? sanitizedPattern(fallback.pattern, authored)
    : authored;
  const fallbackTerrain = Array.isArray(fallback?.terrain) ? fallback.terrain : TERRAIN_PATTERNS[animal.id];
  const validTerrainIds = new Set(QUADRUPED_TERRAINS.map(({ id }) => id));
  const terrain = Array.from({ length: QUADRUPED_STEP_COUNT }, (_, step) => {
    const value = source.terrain?.[step] ?? fallbackTerrain[step] ?? "earth";
    return validTerrainIds.has(value) ? value : fallbackTerrain[step] ?? "earth";
  });
  const seed = Number.isFinite(Number(source.mutationSeed))
    ? Number(source.mutationSeed) >>> 0
    : Number(fallback?.mutationSeed ?? 0x51414452) >>> 0;
  return {
    version: 2,
    animalId: animal.id,
    behaviorId: behavior.id,
    tempoBpm: clamp(source.tempoBpm ?? fallback?.tempoBpm ?? animal.tempoByBehavior[behavior.id], ...QUADRUPED_LIMITS.tempoBpm),
    stride: clamp(source.stride ?? fallback?.stride ?? defaultStride(animal.id, behavior.id), ...QUADRUPED_LIMITS.stride),
    mood: clamp(source.mood ?? fallback?.mood ?? animal.mood, ...QUADRUPED_LIMITS.mood),
    groundResonance: clamp(source.groundResonance ?? fallback?.groundResonance ?? animal.groundResonance, ...QUADRUPED_LIMITS.groundResonance),
    outputLevel: clamp(source.outputLevel ?? fallback?.outputLevel ?? animal.outputLevel, ...QUADRUPED_LIMITS.outputLevel),
    pattern: sanitizedPattern(source.pattern, fallbackPattern),
    terrain,
    customized: Boolean(source.customized ?? fallback?.customized ?? false),
    mutationSeed: seed || 1,
  };
}

export function applyQuadrupedAnimal(state, animalId) {
  const next = createQuadrupedState(animalId);
  return sanitizeQuadrupedState({ ...next, outputLevel: state?.outputLevel ?? next.outputLevel }, next);
}

export function applyQuadrupedBehavior(state, behaviorId) {
  const current = sanitizeQuadrupedState(state);
  const next = createQuadrupedState(current.animalId, behaviorId);
  return sanitizeQuadrupedState({
    ...next,
    mood: current.mood,
    groundResonance: current.groundResonance,
    outputLevel: current.outputLevel,
    terrain: current.terrain,
    mutationSeed: current.mutationSeed,
  }, next);
}

export function setQuadrupedContact(state, laneId, step, intensity) {
  const current = sanitizeQuadrupedState(state);
  if (!QUADRUPED_LANES.some(({ id }) => id === laneId)) return current;
  const index = mod(Math.trunc(Number(step) || 0), QUADRUPED_STEP_COUNT);
  return sanitizeQuadrupedState({
    ...current,
    customized: true,
    pattern: {
      ...current.pattern,
      [laneId]: current.pattern[laneId].map((value, valueIndex) => valueIndex === index ? clamp(intensity) : value),
    },
  }, current);
}

export function cycleQuadrupedContact(state, laneId, step, direction = 1) {
  const current = sanitizeQuadrupedState(state);
  if (!QUADRUPED_LANES.some(({ id }) => id === laneId)) return current;
  const index = mod(Math.trunc(Number(step) || 0), QUADRUPED_STEP_COUNT);
  const value = current.pattern[laneId][index];
  const currentLevel = CONTACT_LEVELS.reduce((closestIndex, candidate, candidateIndex) => (
    Math.abs(candidate - value) < Math.abs(CONTACT_LEVELS[closestIndex] - value) ? candidateIndex : closestIndex
  ), 0);
  const nextLevel = mod(currentLevel + stepDirection(direction), CONTACT_LEVELS.length);
  return setQuadrupedContact(current, laneId, index, CONTACT_LEVELS[nextLevel]);
}

export function cycleQuadrupedTerrain(state, step, direction = 1) {
  const current = sanitizeQuadrupedState(state);
  const index = mod(Math.trunc(Number(step) || 0), QUADRUPED_STEP_COUNT);
  const terrainIndex = Math.max(0, QUADRUPED_TERRAINS.findIndex(({ id }) => id === current.terrain[index]));
  const nextTerrain = QUADRUPED_TERRAINS[mod(terrainIndex + stepDirection(direction), QUADRUPED_TERRAINS.length)].id;
  return sanitizeQuadrupedState({
    ...current,
    customized: true,
    terrain: current.terrain.map((value, valueIndex) => valueIndex === index ? nextTerrain : value),
  }, current);
}

function nextRandom(seed) {
  const next = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
  return [next, next / 0x1_0000_0000];
}

export function mutateQuadrupedPattern(state, seed = state?.mutationSeed) {
  const current = sanitizeQuadrupedState(state);
  let cursor = Number(seed ?? current.mutationSeed) >>> 0 || 1;
  const pattern = Object.fromEntries(QUADRUPED_LANES.map(({ id }) => [id, [...current.pattern[id]]]));
  for (const lane of QUADRUPED_LANES) {
    for (let step = 0; step < QUADRUPED_STEP_COUNT; step += 1) {
      let random;
      [cursor, random] = nextRandom(cursor);
      if (random >= (lane.id === "tail" ? 0.16 : 0.1)) continue;
      let levelRandom;
      [cursor, levelRandom] = nextRandom(cursor);
      pattern[lane.id][step] = CONTACT_LEVELS[Math.floor(levelRandom * CONTACT_LEVELS.length)];
    }
  }
  const footLaneIds = QUADRUPED_LANES.slice(0, 4).map(({ id }) => id);
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const start = quarter * 4;
    const hasFoot = footLaneIds.some((laneId) => pattern[laneId].slice(start, start + 4).some((value) => value > 0));
    if (hasFoot) continue;
    let laneRandom;
    [cursor, laneRandom] = nextRandom(cursor);
    let stepRandom;
    [cursor, stepRandom] = nextRandom(cursor);
    pattern[footLaneIds[Math.floor(laneRandom * footLaneIds.length)]][start + Math.floor(stepRandom * 4)] = 0.72;
  }
  const terrain = [...current.terrain];
  for (let step = 0; step < QUADRUPED_STEP_COUNT; step += 1) {
    let random;
    [cursor, random] = nextRandom(cursor);
    if (random >= 0.1) continue;
    let materialRandom;
    [cursor, materialRandom] = nextRandom(cursor);
    terrain[step] = QUADRUPED_TERRAINS[Math.floor(materialRandom * QUADRUPED_TERRAINS.length)].id;
  }
  return sanitizeQuadrupedState({ ...current, pattern, terrain, customized: true, mutationSeed: cursor || 1 }, current);
}

export function clearQuadrupedPattern(state) {
  const current = sanitizeQuadrupedState(state);
  return sanitizeQuadrupedState({ ...current, pattern: emptyPattern(), customized: true }, current);
}

export function quadrupedStepDurationSeconds(state) {
  const tempoBpm = clamp(state?.tempoBpm, ...QUADRUPED_LIMITS.tempoBpm);
  return 60 / tempoBpm / 4;
}

function headPhraseFromEvent(safe, step, terrain, footEnergy, totalEnergy, force = false) {
  const animal = quadrupedAnimal(safe.animalId);
  const terrainIndex = QUADRUPED_TERRAINS.findIndex(({ id }) => id === terrain.id);
  const pitchIndex = mod(step + terrainIndex, animal.scale.length);
  const baseNote = animal.scale[pitchIndex] + Math.round((safe.mood - 0.5) * 4);
  const phraseEnergy = force ? Math.max(1, totalEnergy) : totalEnergy;
  const phraseFootEnergy = force ? Math.max(1, footEnergy) : footEnergy;
  const elephantPhraseAccent = force || (phraseFootEnergy > 0.3 && step % 8 === 0);
  const unicornPhraseAccent = force || (phraseEnergy > 0.34 && step % 4 === 0);
  const gazellePhraseAccent = force || (phraseFootEnergy > 0.3 && step % 4 === 0);

  if (safe.animalId === "elephant" && elephantPhraseAccent) {
    const notes = Object.freeze([baseNote + 7, baseNote + 10, baseNote + 12, baseNote + 10, baseNote + 17]);
    const phraseDurationSeconds = 0.72 + safe.mood * 0.26;
    const noteOffsetsSeconds = Object.freeze([0, 0.18, 0.38, 0.62, 1].map((ratio) => ratio * phraseDurationSeconds));
    return Object.freeze({
      kind: "trumpet",
      gesture: "trunk-lift",
      notes,
      noteOffsetsSeconds,
      intensity: clamp(0.3 + phraseEnergy * 0.2 + safe.mood * 0.24),
      phraseDurationSeconds,
      durationSeconds: phraseDurationSeconds,
    });
  }

  if (safe.animalId === "unicorn" && unicornPhraseAccent) {
    const notes = Object.freeze([baseNote, baseNote + 4, baseNote + 11, baseNote + 18, baseNote + 14, baseNote + 23]);
    const phraseStepSeconds = 0.052;
    const noteDecaySeconds = 0.16 + terrain.decay * 0.1;
    const noteOffsetsSeconds = Object.freeze(notes.map((_, index) => index * phraseStepSeconds));
    const phraseDurationSeconds = noteOffsetsSeconds.at(-1) + noteDecaySeconds;
    return Object.freeze({
      kind: "neigh-arpeggio",
      gesture: "horn-neigh",
      notes,
      noteOffsetsSeconds,
      intensity: clamp(0.22 + phraseEnergy * 0.13 + safe.mood * 0.28),
      phraseStepSeconds,
      noteDecaySeconds,
      phraseDurationSeconds,
      durationSeconds: phraseDurationSeconds,
    });
  }

  if (safe.animalId === "gazelle" && gazellePhraseAccent) {
    const contour = Math.floor(step / 4) % 2 === 0
      ? [0, 9, 4, 11, 6, 12]
      : [12, 6, 11, 4, 9, 0];
    const notes = Object.freeze(contour.map((offset) => baseNote + offset));
    const phraseStepSeconds = 0.032;
    const pluckDecaySeconds = 0.1 + terrain.decay * 0.08;
    const stringTailSeconds = 0.16 + terrain.decay * 0.1;
    const noteOffsetsSeconds = Object.freeze(notes.map((_, index) => index * phraseStepSeconds));
    const phraseDurationSeconds = noteOffsetsSeconds.at(-1) + Math.max(pluckDecaySeconds, stringTailSeconds);
    return Object.freeze({
      kind: "marimba-string",
      gesture: "head-toss",
      notes,
      noteOffsetsSeconds,
      intensity: clamp(0.26 + phraseEnergy * 0.16 + safe.mood * 0.18),
      phraseStepSeconds,
      pluckDecaySeconds,
      stringTailSeconds,
      phraseDurationSeconds,
      durationSeconds: phraseDurationSeconds,
    });
  }

  return null;
}

function sequenceEventFromSafe(safe, absoluteStep = 0, forceHead = false) {
  const numericStep = Number(absoluteStep);
  const step = mod(Number.isFinite(numericStep) ? Math.trunc(numericStep) : 0, QUADRUPED_STEP_COUNT);
  const contacts = QUADRUPED_LANES
    .map((lane) => Object.freeze({ ...lane, intensity: safe.pattern[lane.id][step] }))
    .filter(({ intensity }) => intensity > 0);
  const terrain = quadrupedTerrain(safe.terrain[step]);
  const footContacts = contacts.filter(({ id }) => id !== "tail");
  const tail = contacts.find(({ id }) => id === "tail")?.intensity ?? 0;
  const footEnergy = footContacts.reduce((sum, { intensity }) => sum + intensity, 0);
  const totalEnergy = footEnergy + tail * 0.65;
  const foreEnergy = footContacts.filter(({ id }) => id.startsWith("front")).reduce((sum, { intensity }) => sum + intensity, 0);
  const rearEnergy = Math.max(0, footEnergy - foreEnergy);
  const head = headPhraseFromEvent(safe, step, terrain, footEnergy, totalEnergy, forceHead);
  return Object.freeze({ step, contacts: Object.freeze(contacts), terrain, footEnergy, totalEnergy, foreEnergy, rearEnergy, supportCount: footContacts.length, head });
}

export function quadrupedSequenceEvent(state, absoluteStep = 0) {
  return sequenceEventFromSafe(sanitizeQuadrupedState(state), absoluteStep);
}

export function quadrupedHeadPhrase(state, absoluteStep = 0) {
  return sequenceEventFromSafe(sanitizeQuadrupedState(state), absoluteStep, true).head;
}

function headPerformanceFromSafe(safe, absolutePosition) {
  const position = Number.isFinite(Number(absolutePosition)) ? Number(absolutePosition) : 0;
  const wholeStep = Math.floor(position);
  const phase = position - wholeStep;
  const stepDurationSeconds = quadrupedStepDurationSeconds(safe);
  for (let lag = 0; lag < QUADRUPED_STEP_COUNT; lag += 1) {
    const phrase = sequenceEventFromSafe(safe, wholeStep - lag).head;
    if (!phrase) continue;
    const elapsedSeconds = (lag + phase) * stepDurationSeconds;
    const durationSeconds = phrase.phraseDurationSeconds ?? phrase.durationSeconds ?? stepDurationSeconds;
    if (elapsedSeconds > durationSeconds) continue;
    const progress = clamp(elapsedSeconds / Math.max(0.001, durationSeconds));
    const attack = clamp(elapsedSeconds / Math.min(0.08, durationSeconds * 0.22));
    const strength = clamp(Math.sin(attack * Math.PI * 0.5) * (1 - progress * 0.72));
    const offsets = phrase.noteOffsetsSeconds ?? [0];
    let noteIndex = 0;
    for (let index = 0; index < offsets.length; index += 1) {
      if (offsets[index] <= elapsedSeconds + 0.0001) noteIndex = index;
    }
    const noteDelta = Math.max(0, elapsedSeconds - (offsets[noteIndex] ?? 0));
    const notePulse = clamp(Math.exp(-noteDelta * 30));
    return Object.freeze({
      active: true,
      kind: phrase.kind,
      gesture: phrase.gesture,
      strength,
      progress,
      noteIndex,
      notePulse,
      trunkRaise: phrase.gesture === "trunk-lift" ? strength : 0,
      hornPulse: phrase.gesture === "horn-neigh" ? Math.max(strength * 0.42, notePulse) : 0,
      headToss: phrase.gesture === "head-toss" ? strength * (0.52 + notePulse * 0.48) : 0,
      earFlick: phrase.gesture === "head-toss" ? notePulse * (noteIndex % 2 === 0 ? 1 : 0.62) : 0,
    });
  }
  return Object.freeze({ active: false, kind: null, gesture: null, strength: 0, progress: 1, noteIndex: -1, notePulse: 0, trunkRaise: 0, hornPulse: 0, headToss: 0, earFlick: 0 });
}

function footCycleState(safe, laneId, absolutePosition, stanceSteps) {
  const position = mod(absolutePosition, QUADRUPED_STEP_COUNT);
  const wholeStep = Math.floor(position);
  const fraction = position - wholeStep;
  let previous = null;
  let next = null;
  for (let lag = 0; lag < QUADRUPED_STEP_COUNT; lag += 1) {
    const step = mod(wholeStep - lag, QUADRUPED_STEP_COUNT);
    const intensity = safe.pattern[laneId][step];
    if (intensity > 0) {
      previous = { age: lag + fraction, intensity };
      break;
    }
  }
  for (let lead = 1; lead <= QUADRUPED_STEP_COUNT; lead += 1) {
    const step = mod(wholeStep + lead, QUADRUPED_STEP_COUNT);
    const intensity = safe.pattern[laneId][step];
    if (intensity > 0) {
      next = { distance: lead - fraction, intensity };
      break;
    }
  }
  if (!previous || !next) {
    return Object.freeze({ intensity: 0, contact: 0, impact: 0, lift: 0.34, swing: 0 });
  }
  const cycleSteps = Math.max(1, previous.age + next.distance);
  const stanceDuration = Math.min(Math.max(0.7, stanceSteps), Math.max(0.7, cycleSteps - 0.45));
  const grounded = previous.age < stanceDuration;
  const touchdown = safe.pattern[laneId][wholeStep];
  const impact = touchdown * Math.exp(-fraction * 10);
  if (grounded) {
    const stanceProgress = clamp(previous.age / stanceDuration);
    const release = stanceProgress > 0.9 ? clamp((1 - stanceProgress) / 0.1) : 1;
    return Object.freeze({
      intensity: previous.intensity,
      contact: previous.intensity * release,
      impact,
      lift: 0,
      swing: (1 - stanceProgress * 2) * safe.stride,
    });
  }
  const swingDuration = Math.max(0.45, cycleSteps - stanceDuration);
  const swingProgress = clamp((previous.age - stanceDuration) / swingDuration);
  return Object.freeze({
    intensity: previous.intensity,
    contact: 0,
    impact,
    lift: Math.sin(Math.PI * swingProgress),
    swing: (-1 + swingProgress * 2) * safe.stride,
  });
}

export function deriveQuadrupedPose(state, sequencePosition = 0) {
  const safe = sanitizeQuadrupedState(state);
  const numericPosition = Number(sequencePosition);
  const absolutePosition = Number.isFinite(numericPosition) ? numericPosition : 0;
  const position = mod(absolutePosition, QUADRUPED_STEP_COUNT);
  const step = Math.floor(position);
  const phase = position - step;
  const event = sequenceEventFromSafe(safe, step);
  const headPerformance = headPerformanceFromSafe(safe, absolutePosition);
  const motion = BEHAVIOR_MOTION[safe.behaviorId] ?? BEHAVIOR_MOTION.walk;
  const legs = {};
  const behavior = behaviorDefinition(safe.behaviorId, safe.animalId);
  for (const lane of QUADRUPED_LANES.slice(0, 4)) {
    const cycle = footCycleState(safe, lane.id, absolutePosition, behavior.stanceSteps);
    legs[lane.id] = Object.freeze({ ...cycle, lift: clamp(cycle.lift * motion.lift, 0, 1.2) });
  }
  const tailIntensity = safe.pattern.tail[step];
  legs.tail = Object.freeze({
    intensity: tailIntensity,
    contact: tailIntensity * (phase < 0.64 ? 1 : clamp(1 - (phase - 0.64) / 0.36)),
    impact: tailIntensity * Math.exp(-phase * 10),
    lift: Math.max(0, Math.sin(Math.PI * phase)) * motion.lift * 0.5,
    swing: Math.sin((position / 2 + 0.25) * Math.PI * 2) * safe.stride,
  });
  const groundSupportCount = QUADRUPED_LANES.slice(0, 4).filter(({ id }) => legs[id].contact > 0.06).length;
  if (safe.behaviorId === "dance" && groundSupportCount === 2) {
    for (const lane of QUADRUPED_LANES.slice(0, 4)) {
      if (legs[lane.id].contact > 0.06) continue;
      legs[lane.id] = Object.freeze({ ...legs[lane.id], lift: Math.max(legs[lane.id].lift, 0.72 + Math.sin(Math.PI * phase) * 0.28) });
    }
  }
  const aerial = groundSupportCount === 0 ? motion.aerial * (0.72 + Math.sin(Math.PI * phase) * 0.28) : 0;
  const impact = QUADRUPED_LANES.slice(0, 4).reduce((sum, { id }) => sum + legs[id].impact, 0) / 4;
  const leftEnergy = (legs["front-left"].contact + legs["rear-left"].contact) / 2;
  const rightEnergy = (legs["front-right"].contact + legs["rear-right"].contact) / 2;
  const foreSupport = legs["front-left"].contact + legs["front-right"].contact;
  const rearSupport = legs["rear-left"].contact + legs["rear-right"].contact;
  const danceSway = safe.behaviorId === "dance" ? Math.sin(position * Math.PI * 0.5) * 0.16 : 0;
  const bounce = Math.max(0, Math.sin(Math.PI * phase)) * motion.bounce + aerial;
  const bodyLift = clamp(0.05 + bounce - impact * 0.13, -0.1, 1.2);
  const headExpression = headPerformance.strength;
  const danceBalance = safe.behaviorId === "dance" && groundSupportCount === 2
    ? clamp(Math.sin(Math.PI * phase))
    : 0;
  return Object.freeze({
    position,
    step,
    phase,
    progress: position / QUADRUPED_STEP_COUNT,
    event,
    headPerformance,
    legs: Object.freeze(legs),
    groundSupportCount,
    airborne: groundSupportCount === 0,
    bodyLift,
    bodyRoll: clamp((rightEnergy - leftEnergy) * motion.sway + danceSway, -0.5, 0.5),
    bodyPitch: clamp((rearSupport - foreSupport) * 0.08 + Math.sin(phase * Math.PI * 2) * 0.03, -0.28, 0.28),
    headLift: clamp(bodyLift * 0.42 + safe.mood * 0.2 + headExpression * 0.22, 0, 0.92),
    headNod: clamp(impact * 0.25 - Math.sin(phase * Math.PI * 2) * 0.06, -0.2, 0.35),
    headExpression,
    danceBalance,
    tailAngle: Math.sin(position * Math.PI * 0.72) * (0.18 + safe.mood * 0.38) + legs.tail.impact * 0.65,
    eyeOpen: clamp(0.48 + safe.mood * 0.46 + headExpression * 0.16, 0.22, 1),
    smile: clamp((safe.mood - 0.32) * 1.2 + event.totalEnergy * 0.08, -0.3, 1),
  });
}

export function describeQuadrupedStep(state, step) {
  const event = quadrupedSequenceEvent(state, step);
  const contacts = event.contacts.length
    ? event.contacts.map(({ label, intensity }) => `${label} ${Math.round(intensity * 100)} percent`).join(", ")
    : "no body contacts";
  const head = event.head ? ` Head voice: ${event.head.kind}.` : " Head rests.";
  return `Step ${event.step + 1}, ${event.terrain.label}: ${contacts}.${head}`;
}
