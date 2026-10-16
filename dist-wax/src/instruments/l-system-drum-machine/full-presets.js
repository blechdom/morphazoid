import { L_SYSTEM_PRESETS } from "../l-system/l-system.js";
import { L_SYSTEM_DRUM_MAPPING_MODES, L_SYSTEM_DRUM_STYLES } from "./l-system-drum-machine.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const L_SYSTEM_DRUM_PRESET_KEYS = Object.freeze([
  "systemId", "iterations", "angle", "turnAsymmetry", "lengthScale", "speed", "direction", "traversalBehavior",
  "structureMode", "subdivisions", "mappingMode", "percussionStyle", "pitchDepth", "anglePitchDepth", "angleRange",
  "characterDepth",
]);
const SYSTEMS = new Map(L_SYSTEM_PRESETS.map(preset => [preset.id, preset]));
const MAPPING_IDS = L_SYSTEM_DRUM_MAPPING_MODES.map(mode => mode.id);
const STYLE_IDS = L_SYSTEM_DRUM_STYLES.map(style => style.id);
const STRUCTURES = ["final", "sequence", "together", "accumulate", "canon"];
const BEHAVIORS = ["loop", "ping-pong"];

const q = (value, step, min, max) => {
  const number = Number.isFinite(Number(value)) ? Number(value) : min;
  return Number((Math.round(Math.min(max, Math.max(min, number)) / step) * step).toFixed(6));
};
const choice = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export function captureLSystemDrumPreset(source) {
  const system = SYSTEMS.get(source?.systemId) ?? L_SYSTEM_PRESETS[0];
  return {
    systemId: system.id,
    iterations: q(source?.iterations, 1, 0, system.maxIterations ?? 12),
    angle: q(source?.angle, .5, 0, 180),
    turnAsymmetry: q(source?.turnAsymmetry, .01, -.8, .8),
    lengthScale: q(source?.lengthScale, .01, .3, 1),
    speed: q(source?.speed, .001, .01, 4),
    direction: source?.direction < 0 ? -1 : 1,
    traversalBehavior: choice(source?.traversalBehavior, BEHAVIORS, "loop"),
    structureMode: choice(source?.structureMode, STRUCTURES, "final"),
    subdivisions: q(source?.subdivisions, 1, 1, 16),
    mappingMode: choice(source?.mappingMode, MAPPING_IDS, "branch-depth-turn"),
    percussionStyle: choice(source?.percussionStyle, STYLE_IDS, "drum-bank"),
    pitchDepth: q(source?.pitchDepth, 1, 0, 24),
    anglePitchDepth: q(source?.anglePitchDepth, 1, 0, 36),
    angleRange: q(source?.angleRange, 5, 15, 360),
    characterDepth: q(source?.characterDepth, .01, 0, 1),
  };
}

export function validateLSystemDrumPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(captureLSystemDrumPreset(snapshot))) {
    throw new TypeError("Invalid complete L-System Drum Machine preset");
  }
  return snapshot;
}

const scene = (id, label, systemId, values) => {
  const system = SYSTEMS.get(systemId);
  const snapshot = captureLSystemDrumPreset({
    iterations: system.iterations, angle: system.angle, turnAsymmetry: 0, lengthScale: system.lengthScale,
    speed: .3, direction: 1, traversalBehavior: "loop", structureMode: "final", subdivisions: 4,
    mappingMode: "branch-depth-turn", percussionStyle: "drum-bank", pitchDepth: 12, anglePitchDepth: 12,
    angleRange: 90, characterDepth: 0.72, ...values, systemId,
  });
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const L_SYSTEM_DRUM_FULL_PRESETS = Object.freeze([
  scene("factory", "Pythagorean tree", "pythagorean", { iterations: 7 }),
  scene("wind-plant", "Wind-swept plant", "plant", {
    angle: 28, turnAsymmetry: .3, speed: .5, traversalBehavior: "ping-pong", structureMode: "together", subdivisions: 3,
    mappingMode: "position-grid", percussionStyle: "circuit", pitchDepth: 8, anglePitchDepth: 20, angleRange: 120, characterDepth: .55,
  }),
  scene("coral-canon", "Coral canon", "coral", {
    iterations: 4, turnAsymmetry: -.25, speed: .22, structureMode: "canon", subdivisions: 6,
    mappingMode: "generation-phase", percussionStyle: "resonant-metal", pitchDepth: 16, anglePitchDepth: 6, angleRange: 60, characterDepth: .85,
  }),
  scene("dragon-march", "Dragon march", "dragon", {
    iterations: 9, speed: 1.2, direction: -1, structureMode: "sequence", subdivisions: 2,
    mappingMode: "branch-depth-turn", percussionStyle: "rattlesnake", pitchDepth: 5, anglePitchDepth: 30, angleRange: 180, characterDepth: .4,
  }),
  scene("snowflake-bells", "Snowflake bells", "koch", {
    iterations: 4, speed: .12, structureMode: "accumulate", subdivisions: 8,
    mappingMode: "generation-phase", percussionStyle: "resonant-metal", pitchDepth: 20, anglePitchDepth: 4, angleRange: 45, characterDepth: .9,
  }),
  scene("sierpinski-tick", "Sierpinski ticker", "sierpinski", {
    iterations: 5, speed: 2.4, traversalBehavior: "ping-pong", structureMode: "final", subdivisions: 1,
    mappingMode: "position-grid", percussionStyle: "circuit", pitchDepth: 2, anglePitchDepth: 0, angleRange: 360, characterDepth: .3,
  }),
  scene("hilbert-grid", "Hilbert grid", "hilbert", {
    iterations: 4, speed: .65, structureMode: "sequence", subdivisions: 5,
    mappingMode: "position-grid", percussionStyle: "drum-bank", pitchDepth: 10, anglePitchDepth: 14, angleRange: 90, characterDepth: .6,
  }),
  scene("gosper-drift", "Gosper drift", "gosper", {
    iterations: 3, angle: 55, turnAsymmetry: .4, speed: .08, direction: -1, structureMode: "together", subdivisions: 12,
    mappingMode: "branch-depth-turn", percussionStyle: "resonant-metal", pitchDepth: 22, anglePitchDepth: 24, angleRange: 270, characterDepth: .95,
  }),
  scene("cantor-clicks", "Cantor clicks", "cantor", {
    iterations: 7, speed: 1.8, structureMode: "accumulate", subdivisions: 2,
    mappingMode: "generation-phase", percussionStyle: "circuit", pitchDepth: 0, anglePitchDepth: 0, angleRange: 15, characterDepth: .1,
  }),
  scene("levy-shiver", "Levy shiver", "levy", {
    iterations: 10, angle: 40, turnAsymmetry: -.5, speed: .9, traversalBehavior: "ping-pong", structureMode: "canon", subdivisions: 3,
    mappingMode: "branch-depth-turn", percussionStyle: "rattlesnake", pitchDepth: 14, anglePitchDepth: 36, angleRange: 150, characterDepth: .7,
  }),
  scene("terdragon-lull", "Terdragon lull", "terdragon", {
    iterations: 6, angle: 110, speed: .04, structureMode: "final", subdivisions: 10,
    mappingMode: "generation-phase", percussionStyle: "drum-bank", pitchDepth: 24, anglePitchDepth: 10, angleRange: 30, characterDepth: .2,
  }),
  scene("tapered-grove", "Tapered grove", "pythagorean", {
    iterations: 9, angle: 30, turnAsymmetry: .6, lengthScale: .55, speed: .35, structureMode: "together", subdivisions: 6,
    mappingMode: "position-grid", percussionStyle: "resonant-metal", pitchDepth: 18, anglePitchDepth: 8, angleRange: 200, characterDepth: .8,
  }),
  scene("coral-snare-roll", "Coral snare roll", "coral", {
    iterations: 5, angle: 18, speed: 3.2, structureMode: "sequence", subdivisions: 14, traversalBehavior: "ping-pong",
    mappingMode: "branch-depth-turn", percussionStyle: "rattlesnake", pitchDepth: 4, anglePitchDepth: 18, angleRange: 75, characterDepth: .5,
  }),
]);

export function randomizeLSystemDrumPreset(current, random = Math.random) {
  validateLSystemDrumPreset(current);
  const rng = presetRandom(random);
  const system = rng.pick(L_SYSTEM_PRESETS);
  const maxIterations = Math.min(system.maxIterations ?? 12, system.iterations + 1);
  return validateLSystemDrumPreset(captureLSystemDrumPreset({
    systemId: system.id, iterations: rng.integer(Math.min(2, maxIterations), maxIterations),
    angle: rng.between(5, 180), turnAsymmetry: rng.between(-.75, .75), lengthScale: rng.between(.35, 1),
    speed: .02 + 3.2 * rng.unit() ** 3, direction: rng.pick([-1, 1]), traversalBehavior: rng.pick(BEHAVIORS),
    structureMode: rng.pick(STRUCTURES), subdivisions: rng.integer(1, 14),
    mappingMode: rng.pick(MAPPING_IDS), percussionStyle: rng.pick(STYLE_IDS),
    pitchDepth: rng.between(0, 24), anglePitchDepth: rng.between(0, 36), angleRange: rng.between(15, 360),
    characterDepth: rng.between(0, 1),
  }));
}
