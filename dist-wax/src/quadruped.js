const CONTACT_LEVELS = Object.freeze([0, 0.58, 1]);

export const QUADRUPED_STEP_COUNT = 16;

const ALL_QUADRUPED_IDS = Object.freeze(["elephant", "unicorn", "gazelle", "cat", "cheetah", "giraffe", "lizard"]);

export const QUADRUPED_LIMITS = Object.freeze({
  tempoBpm: Object.freeze([42, 196]),
  stride: Object.freeze([0.55, 1.35]),
  momentum: Object.freeze([0.5, 1.4]),
  gravity: Object.freeze([0.55, 1.55]),
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
  Object.freeze({ id: "walk", label: "Walk", description: "even lateral walk", stanceSteps: 10, defaultCadence: 88, nativeAnimalIds: ALL_QUADRUPED_IDS }),
  Object.freeze({ id: "diagonal-walk", label: "Diagonal walk", description: "even diagonal walk", stanceSteps: 10, defaultCadence: 84, nativeAnimalIds: Object.freeze(["unicorn", "gazelle"]) }),
  Object.freeze({ id: "running-walk", label: "Running walk", description: "four quick grounded beats", stanceSteps: 8.8, defaultCadence: 118, nativeAnimalIds: Object.freeze(["unicorn"]) }),
  Object.freeze({ id: "amble", label: "Amble", description: "close lateral couplets", stanceSteps: 8, defaultCadence: 112, nativeAnimalIds: Object.freeze(["elephant", "unicorn"]) }),
  Object.freeze({ id: "tolt", label: "Tölt", description: "fast four-beat singlefoot", stanceSteps: 7, defaultCadence: 138, nativeAnimalIds: Object.freeze(["unicorn"]) }),
  Object.freeze({ id: "jog", label: "Jog", description: "broken diagonal pairs", stanceSteps: 10, defaultCadence: 116, nativeAnimalIds: Object.freeze(["unicorn", "gazelle"]) }),
  Object.freeze({ id: "trot", label: "Trot", description: "diagonal pairs + float", stanceSteps: 6, defaultCadence: 138, nativeAnimalIds: Object.freeze(["unicorn", "gazelle"]) }),
  Object.freeze({ id: "passage", label: "Passage", description: "high suspended trot", stanceSteps: 5, defaultCadence: 112, nativeAnimalIds: Object.freeze(["unicorn"]) }),
  Object.freeze({ id: "pace", label: "Pace", description: "grounded lateral pairs", stanceSteps: 9, defaultCadence: 130, nativeAnimalIds: Object.freeze(["unicorn"]) }),
  Object.freeze({ id: "flying-pace", label: "Flying pace", description: "lateral pairs + flight", stanceSteps: 5.6, defaultCadence: 160, nativeAnimalIds: Object.freeze(["unicorn"]) }),
  Object.freeze({ id: "canter", label: "Canter R", description: "three beats · right lead", stanceSteps: 4, defaultCadence: 152, nativeAnimalIds: Object.freeze(["unicorn", "gazelle"]) }),
  Object.freeze({ id: "counter-canter", label: "Canter L", description: "three beats · left lead", stanceSteps: 4, defaultCadence: 152, nativeAnimalIds: Object.freeze(["unicorn", "gazelle"]) }),
  Object.freeze({ id: "gallop", label: "Gallop R", description: "right transverse gallop", stanceSteps: 4, defaultCadence: 176, nativeAnimalIds: Object.freeze(["unicorn", "gazelle"]) }),
  Object.freeze({ id: "counter-gallop", label: "Gallop L", description: "left transverse gallop", stanceSteps: 4, defaultCadence: 176, nativeAnimalIds: Object.freeze(["unicorn", "gazelle"]) }),
  Object.freeze({ id: "sprint", label: "Rotary R", description: "right rotary sprint", stanceSteps: 3, defaultCadence: 176, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "rotary-left", label: "Rotary L", description: "left rotary sprint", stanceSteps: 3, defaultCadence: 176, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "bound", label: "Bound", description: "hind pair · fore pair", stanceSteps: 4, defaultCadence: 150, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "half-bound", label: "Half-bound R", description: "hind pair · split fore", stanceSteps: 4, defaultCadence: 168, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "counter-half-bound", label: "Half-bound L", description: "hind pair · split fore", stanceSteps: 4, defaultCadence: 168, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "stot", label: "Stot", description: "four together + flight", stanceSteps: 3, defaultCadence: 140, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "jump", label: "Jump", description: "hind launch · fore landing", stanceSteps: 3, defaultCadence: 110, nativeAnimalIds: Object.freeze(["unicorn", "gazelle"]) }),
  Object.freeze({ id: "charge", label: "Charge", description: "heavy grounded drive", stanceSteps: 7.4, defaultCadence: 154, nativeAnimalIds: Object.freeze(["elephant"]) }),
  Object.freeze({ id: "dance", label: "Tango", description: "alternating two-leg balance", stanceSteps: 3, defaultCadence: 126, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "rear-waltz", label: "Rear waltz", description: "hind-leg dancing", stanceSteps: 4, defaultCadence: 96, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "carousel", label: "Carousel", description: "circling four-beat pivot", stanceSteps: 7, defaultCadence: 104, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "cat-prowl", label: "Cat prowl", description: "quiet overlapping paws", stanceSteps: 10, defaultCadence: 78, nativeAnimalIds: Object.freeze(["cat"]) }),
  Object.freeze({ id: "cat-gallop", label: "Cat gallop", description: "one-flight feline gallop", stanceSteps: 4, defaultCadence: 168, nativeAnimalIds: Object.freeze(["cat"]) }),
  Object.freeze({ id: "run-leap", label: "Run ×3 · leap", description: "run run run · hind launch", stanceSteps: 1.4, defaultCadence: 54, nativeAnimalIds: Object.freeze(["cat", "cheetah", "gazelle"]) }),
  Object.freeze({ id: "giraffe-walk", label: "Giraffe walk", description: "long lateral overlap", stanceSteps: 11, defaultCadence: 76, nativeAnimalIds: Object.freeze(["giraffe"]) }),
  Object.freeze({ id: "giraffe-gallop", label: "Grounded rotary", description: "long grounded rotary run", stanceSteps: 6, defaultCadence: 120, nativeAnimalIds: Object.freeze(["giraffe"]) }),
  Object.freeze({ id: "lizard-scuttle", label: "Scuttle", description: "lateral body-wave walk", stanceSteps: 8.5, defaultCadence: 126, nativeAnimalIds: Object.freeze(["lizard"]) }),
  Object.freeze({ id: "lizard-trot", label: "Lizard trot", description: "diagonal scurry", stanceSteps: 8, defaultCadence: 144, nativeAnimalIds: Object.freeze(["lizard"]) }),
  Object.freeze({ id: "lizard-pace", label: "Lizard pace", description: "serpentine lateral pairs", stanceSteps: 8, defaultCadence: 120, nativeAnimalIds: Object.freeze(["lizard"]) }),
  Object.freeze({ id: "lizard-sprint", label: "Lizard sprint", description: "hind-leg dash + tail", stanceSteps: 3, defaultCadence: 154, nativeAnimalIds: Object.freeze(["lizard"]) }),
]);

const ALL_BEHAVIOR_IDS = Object.freeze(QUADRUPED_BEHAVIORS.map(({ id }) => id));

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
  cat: Object.freeze({
    "front-left": Object.freeze({ label: "felt tap", family: "fore-felt" }),
    "front-right": Object.freeze({ label: "paw knock", family: "fore-paw" }),
    "rear-left": Object.freeze({ label: "cushion kick", family: "hind-cushion" }),
    "rear-right": Object.freeze({ label: "soft thump", family: "hind-soft" }),
    tail: Object.freeze({ label: "tail swish", family: "swish" }),
  }),
  cheetah: Object.freeze({
    "front-left": Object.freeze({ label: "claw snap", family: "fore-claw" }),
    "front-right": Object.freeze({ label: "dry slap", family: "fore-dry" }),
    "rear-left": Object.freeze({ label: "launch drum", family: "hind-launch" }),
    "rear-right": Object.freeze({ label: "sprint kick", family: "hind-sprint" }),
    tail: Object.freeze({ label: "rudder whip", family: "rudder" }),
  }),
  giraffe: Object.freeze({
    "front-left": Object.freeze({ label: "long knock", family: "fore-long" }),
    "front-right": Object.freeze({ label: "bone bell", family: "fore-bone" }),
    "rear-left": Object.freeze({ label: "wood bass", family: "hind-wood" }),
    "rear-right": Object.freeze({ label: "hollow hoof", family: "hind-hollow" }),
    tail: Object.freeze({ label: "tuft brush", family: "tuft" }),
  }),
  lizard: Object.freeze({
    "front-left": Object.freeze({ label: "claw tick", family: "fore-tick" }),
    "front-right": Object.freeze({ label: "scale click", family: "fore-scale" }),
    "rear-left": Object.freeze({ label: "sand scrape", family: "hind-sand" }),
    "rear-right": Object.freeze({ label: "stone tap", family: "hind-stone" }),
    tail: Object.freeze({ label: "tail drag", family: "drag" }),
  }),
});

const ANIMAL_DEFINITIONS = Object.freeze({
  elephant: Object.freeze({
    id: "elephant",
    label: "Elephant",
    subtitle: "thick ground orchestra",
    description: "Heavy feet. Rising trumpet.",
    defaultBehaviorId: "walk",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.54,
    groundResonance: 0.72,
    outputLevel: 0.62,
    bodyScale: 1.12,
    palette: Object.freeze(["#d2b187", "#8e705b", "#ffae57", "#5a4037", "#f7ddbd"]),
    scale: Object.freeze([50, 53, 55, 58, 62, 65]),
    cadenceScale: 0.82,
    mass: 1.38,
    power: 0.92,
    compliance: 0.72,
    rollingResistance: 1.34,
    baseGravity: 10.2,
  }),
  unicorn: Object.freeze({
    id: "unicorn",
    label: "Unicorn",
    subtitle: "prismatic hoof magic",
    description: "Crystal hooves. Sparkle neigh.",
    defaultBehaviorId: "canter",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.86,
    groundResonance: 0.84,
    outputLevel: 0.6,
    bodyScale: 0.98,
    palette: Object.freeze(["#f9f2ff", "#ba87ff", "#58e8ef", "#ff83c9", "#ffe38a"]),
    scale: Object.freeze([62, 66, 69, 73, 78, 81]),
    cadenceScale: 1,
    mass: 0.94,
    power: 1.08,
    compliance: 1.08,
    rollingResistance: 1.08,
    baseGravity: 9.2,
  }),
  gazelle: Object.freeze({
    id: "gazelle",
    label: "Gazelle",
    subtitle: "quick-foot sprint ensemble",
    description: "Quick feet. Marimba strings.",
    defaultBehaviorId: "sprint",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.68,
    groundResonance: 0.48,
    outputLevel: 0.62,
    bodyScale: 0.88,
    palette: Object.freeze(["#e5b86d", "#6e4227", "#f3e8c3", "#141111", "#ed704f"]),
    scale: Object.freeze([57, 60, 64, 67, 69, 72]),
    cadenceScale: 1.08,
    mass: 0.76,
    power: 1.22,
    compliance: 0.9,
    rollingResistance: 0.92,
    baseGravity: 10.8,
  }),
  cat: Object.freeze({
    id: "cat",
    label: "Cat",
    subtitle: "felt-paw chamber animal",
    description: "Soft paws. Purr glissando.",
    defaultBehaviorId: "cat-prowl",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.7,
    groundResonance: 0.42,
    outputLevel: 0.6,
    bodyScale: 0.8,
    palette: Object.freeze(["#b8aaa0", "#5a4b46", "#f4b35d", "#171312", "#dce7df"]),
    scale: Object.freeze([55, 58, 62, 65, 69, 72]),
    cadenceScale: 0.96,
    mass: 0.62,
    power: 1.12,
    compliance: 1.2,
    rollingResistance: 0.78,
    baseGravity: 10.4,
  }),
  cheetah: Object.freeze({
    id: "cheetah",
    label: "Cheetah",
    subtitle: "double-flight sprint engine",
    description: "Claw snaps. Chirping velocity.",
    defaultBehaviorId: "run-leap",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.82,
    groundResonance: 0.4,
    outputLevel: 0.62,
    bodyScale: 0.86,
    palette: Object.freeze(["#e6b84f", "#70471f", "#ff713f", "#17100b", "#fff0b0"]),
    scale: Object.freeze([59, 62, 66, 69, 73, 78]),
    cadenceScale: 1.14,
    mass: 0.68,
    power: 1.35,
    compliance: 1.28,
    rollingResistance: 0.72,
    baseGravity: 10.6,
  }),
  giraffe: Object.freeze({
    id: "giraffe",
    label: "Giraffe",
    subtitle: "long-neck wooden orchestra",
    description: "Long knocks. Neck harp.",
    defaultBehaviorId: "giraffe-walk",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.58,
    groundResonance: 0.62,
    outputLevel: 0.61,
    bodyScale: 1.02,
    palette: Object.freeze(["#e8bd72", "#865426", "#f5d79b", "#24150b", "#8ed8c5"]),
    scale: Object.freeze([45, 50, 52, 57, 62, 64]),
    cadenceScale: 0.8,
    mass: 1.12,
    power: 0.9,
    compliance: 0.78,
    rollingResistance: 1.16,
    baseGravity: 10,
  }),
  lizard: Object.freeze({
    id: "lizard",
    label: "Lizard",
    subtitle: "sidewinding scale machine",
    description: "Claw clicks. Hiss melody.",
    defaultBehaviorId: "lizard-scuttle",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.46,
    groundResonance: 0.54,
    outputLevel: 0.6,
    bodyScale: 0.72,
    palette: Object.freeze(["#70ae78", "#294f37", "#d8e65c", "#08150d", "#ef7f55"]),
    scale: Object.freeze([48, 51, 54, 58, 61, 66]),
    cadenceScale: 0.72,
    mass: 0.46,
    power: 0.82,
    compliance: 0.56,
    rollingResistance: 1.02,
    baseGravity: 9.8,
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
  "diagonal-walk": Object.freeze({
    "front-left": Object.freeze([[4, 0.88]]),
    "front-right": Object.freeze([[12, 0.92]]),
    "rear-left": Object.freeze([[8, 0.94]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[6, 0.44], [14, 0.6]]),
  }),
  "running-walk": Object.freeze({
    "front-left": Object.freeze([[12, 0.94]]),
    "front-right": Object.freeze([[4, 0.98]]),
    "rear-left": Object.freeze([[8, 0.96]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[2, 0.42], [6, 0.56], [10, 0.48], [14, 0.68]]),
  }),
  amble: Object.freeze({
    "front-left": Object.freeze([[10, 0.88]]),
    "front-right": Object.freeze([[2, 0.94]]),
    "rear-left": Object.freeze([[8, 0.9]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[4, 0.48], [12, 0.68]]),
  }),
  tolt: Object.freeze({
    "front-left": Object.freeze([[12, 0.94]]),
    "front-right": Object.freeze([[4, 1]]),
    "rear-left": Object.freeze([[8, 0.94]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[2, 0.5], [6, 0.66], [10, 0.54], [14, 0.76]]),
  }),
  jog: Object.freeze({
    "front-left": Object.freeze([[1, 0.88]]),
    "front-right": Object.freeze([[9, 0.94]]),
    "rear-left": Object.freeze([[8, 0.9]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[5, 0.46], [13, 0.68]]),
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
  passage: Object.freeze({
    "front-left": Object.freeze([[0, 0.96]]),
    "front-right": Object.freeze([[8, 1]]),
    "rear-left": Object.freeze([[8, 0.94]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[3, 0.58], [7, 0.74], [11, 0.58], [15, 0.8]]),
  }),
  pace: Object.freeze({
    "front-left": Object.freeze([[8, 0.94]]),
    "front-right": Object.freeze([[0, 1]]),
    "rear-left": Object.freeze([[8, 0.9]]),
    "rear-right": Object.freeze([[0, 0.96]]),
    tail: Object.freeze([[4, 0.54], [12, 0.72]]),
  }),
  "flying-pace": Object.freeze({
    "front-left": Object.freeze([[8, 0.98]]),
    "front-right": Object.freeze([[0, 1]]),
    "rear-left": Object.freeze([[8, 0.96]]),
    "rear-right": Object.freeze([[0, 0.98]]),
    tail: Object.freeze([[4, 0.68], [12, 0.84]]),
  }),
  canter: Object.freeze({
    "front-left": Object.freeze([[4, 0.9]]),
    "front-right": Object.freeze([[8, 1]]),
    "rear-left": Object.freeze([[0, 0.94]]),
    "rear-right": Object.freeze([[4, 0.92]]),
    tail: Object.freeze([[11, 0.58], [14, 0.74]]),
  }),
  "counter-canter": Object.freeze({
    "front-left": Object.freeze([[8, 1]]),
    "front-right": Object.freeze([[4, 0.9]]),
    "rear-left": Object.freeze([[4, 0.92]]),
    "rear-right": Object.freeze([[0, 0.94]]),
    tail: Object.freeze([[11, 0.58], [14, 0.74]]),
  }),
  gallop: Object.freeze({
    "front-left": Object.freeze([[7, 0.92]]),
    "front-right": Object.freeze([[10, 1]]),
    "rear-left": Object.freeze([[0, 0.92]]),
    "rear-right": Object.freeze([[3, 0.96]]),
    tail: Object.freeze([[13, 0.72], [15, 0.56]]),
  }),
  "counter-gallop": Object.freeze({
    "front-left": Object.freeze([[10, 1]]),
    "front-right": Object.freeze([[7, 0.92]]),
    "rear-left": Object.freeze([[3, 0.96]]),
    "rear-right": Object.freeze([[0, 0.92]]),
    tail: Object.freeze([[13, 0.72], [15, 0.56]]),
  }),
  sprint: Object.freeze({
    "front-left": Object.freeze([[8, 0.94]]),
    "front-right": Object.freeze([[11, 1]]),
    "rear-left": Object.freeze([[3, 0.96]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[5, 0.62], [13, 0.82]]),
  }),
  "rotary-left": Object.freeze({
    "front-left": Object.freeze([[11, 1]]),
    "front-right": Object.freeze([[8, 0.94]]),
    "rear-left": Object.freeze([[0, 1]]),
    "rear-right": Object.freeze([[3, 0.96]]),
    tail: Object.freeze([[5, 0.62], [13, 0.82]]),
  }),
  bound: Object.freeze({
    "front-left": Object.freeze([[8, 1]]),
    "front-right": Object.freeze([[8, 1]]),
    "rear-left": Object.freeze([[0, 1]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[4, 0.62], [12, 0.82]]),
  }),
  "half-bound": Object.freeze({
    "front-left": Object.freeze([[7, 0.94]]),
    "front-right": Object.freeze([[10, 1]]),
    "rear-left": Object.freeze([[0, 1]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[4, 0.56], [13, 0.8]]),
  }),
  "counter-half-bound": Object.freeze({
    "front-left": Object.freeze([[10, 1]]),
    "front-right": Object.freeze([[7, 0.94]]),
    "rear-left": Object.freeze([[0, 1]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[4, 0.56], [13, 0.8]]),
  }),
  stot: Object.freeze({
    "front-left": Object.freeze([[0, 1], [8, 0.92]]),
    "front-right": Object.freeze([[0, 1], [8, 0.92]]),
    "rear-left": Object.freeze([[0, 1], [8, 0.92]]),
    "rear-right": Object.freeze([[0, 1], [8, 0.92]]),
    tail: Object.freeze([[4, 0.68], [12, 0.82]]),
  }),
  jump: Object.freeze({
    "front-left": Object.freeze([[10, 1]]),
    "front-right": Object.freeze([[9, 1]]),
    "rear-left": Object.freeze([[0, 0.96], [13, 0.72]]),
    "rear-right": Object.freeze([[0, 0.96], [13, 0.72]]),
    tail: Object.freeze([[3, 0.74], [12, 0.58]]),
  }),
  dance: Object.freeze({
    "front-left": Object.freeze([[0, 1], [8, 0.94]]),
    "front-right": Object.freeze([[4, 0.94], [12, 1]]),
    "rear-left": Object.freeze([[4, 1], [12, 0.94]]),
    "rear-right": Object.freeze([[0, 0.94], [8, 1]]),
    tail: Object.freeze([[2, 0.72], [6, 0.92], [10, 0.72], [14, 1]]),
  }),
  "rear-waltz": Object.freeze({
    "front-left": Object.freeze([]),
    "front-right": Object.freeze([]),
    "rear-left": Object.freeze([[0, 1], [5, 0.9], [10, 0.96]]),
    "rear-right": Object.freeze([[0, 0.96], [5, 1], [10, 0.9]]),
    tail: Object.freeze([[2, 0.72], [7, 0.86], [12, 1]]),
  }),
  carousel: Object.freeze({
    "front-left": Object.freeze([[8, 0.94]]),
    "front-right": Object.freeze([[4, 1]]),
    "rear-left": Object.freeze([[12, 0.94]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[2, 0.54], [6, 0.7], [10, 0.62], [14, 0.82]]),
  }),
  "cat-prowl": Object.freeze({
    "front-left": Object.freeze([[11, 0.78]]),
    "front-right": Object.freeze([[3, 0.82]]),
    "rear-left": Object.freeze([[8, 0.84]]),
    "rear-right": Object.freeze([[0, 0.88]]),
    tail: Object.freeze([[6, 0.34], [14, 0.46]]),
  }),
  "cat-gallop": Object.freeze({
    "front-left": Object.freeze([[8, 0.94]]),
    "front-right": Object.freeze([[12, 1]]),
    "rear-left": Object.freeze([[2, 0.96]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[5, 0.58], [14, 0.76]]),
  }),
  "run-leap": Object.freeze({
    "front-left": Object.freeze([[2, 0.82], [7, 0.9], [10, 0.94], [15, 1]]),
    "front-right": Object.freeze([[3, 0.9], [6, 0.84], [11, 1], [15, 1]]),
    "rear-left": Object.freeze([[1, 0.8], [4, 0.86], [9, 0.92], [12, 1]]),
    "rear-right": Object.freeze([[0, 0.86], [5, 0.9], [8, 0.96], [12, 1]]),
    tail: Object.freeze([[3, 0.42], [7, 0.5], [11, 0.62], [14, 1]]),
  }),
  "giraffe-walk": Object.freeze({
    "front-left": Object.freeze([[2, 0.92]]),
    "front-right": Object.freeze([[10, 0.96]]),
    "rear-left": Object.freeze([[0, 1]]),
    "rear-right": Object.freeze([[8, 0.98]]),
    tail: Object.freeze([[5, 0.42], [13, 0.58]]),
  }),
  "giraffe-gallop": Object.freeze({
    "front-left": Object.freeze([[8, 0.94]]),
    "front-right": Object.freeze([[10, 1]]),
    "rear-left": Object.freeze([[2, 0.96]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[5, 0.48], [13, 0.66]]),
  }),
  "lizard-scuttle": Object.freeze({
    "front-left": Object.freeze([[12, 0.84]]),
    "front-right": Object.freeze([[4, 0.88]]),
    "rear-left": Object.freeze([[8, 0.9]]),
    "rear-right": Object.freeze([[0, 0.94]]),
    tail: Object.freeze([[2, 0.54], [6, 0.66], [10, 0.56], [14, 0.72]]),
  }),
  "lizard-trot": Object.freeze({
    "front-left": Object.freeze([[0, 0.9]]),
    "front-right": Object.freeze([[8, 0.94]]),
    "rear-left": Object.freeze([[8, 0.9]]),
    "rear-right": Object.freeze([[0, 0.94]]),
    tail: Object.freeze([[4, 0.62], [12, 0.78]]),
  }),
  "lizard-pace": Object.freeze({
    "front-left": Object.freeze([[8, 0.9]]),
    "front-right": Object.freeze([[0, 0.94]]),
    "rear-left": Object.freeze([[8, 0.9]]),
    "rear-right": Object.freeze([[0, 0.94]]),
    tail: Object.freeze([[4, 0.68], [12, 0.8]]),
  }),
  "lizard-sprint": Object.freeze({
    "front-left": Object.freeze([]),
    "front-right": Object.freeze([]),
    "rear-left": Object.freeze([[4, 0.94], [12, 1]]),
    "rear-right": Object.freeze([[0, 1], [8, 0.94]]),
    tail: Object.freeze([[2, 0.82], [6, 0.94], [10, 0.82], [14, 1]]),
  }),
});

const TERRAIN_PATTERNS = Object.freeze({
  elephant: Object.freeze(["earth", "earth", "wood", "earth", "earth", "metal", "wood", "earth", "earth", "wood", "earth", "metal", "earth", "earth", "wood", "earth"]),
  unicorn: Object.freeze(["crystal", "metal", "crystal", "wood", "crystal", "crystal", "metal", "crystal", "wood", "crystal", "metal", "crystal", "crystal", "wood", "crystal", "metal"]),
  gazelle: Object.freeze(["wood", "earth", "wood", "metal", "earth", "wood", "earth", "crystal", "wood", "earth", "metal", "wood", "earth", "wood", "crystal", "earth"]),
  cat: Object.freeze(["wood", "wood", "crystal", "wood", "earth", "wood", "metal", "wood", "wood", "crystal", "wood", "earth", "wood", "metal", "wood", "crystal"]),
  cheetah: Object.freeze(["earth", "wood", "earth", "metal", "earth", "earth", "wood", "earth", "crystal", "earth", "wood", "earth", "metal", "earth", "earth", "wood"]),
  giraffe: Object.freeze(["wood", "earth", "wood", "earth", "metal", "wood", "earth", "wood", "earth", "wood", "crystal", "earth", "wood", "earth", "metal", "wood"]),
  lizard: Object.freeze(["earth", "metal", "earth", "wood", "earth", "crystal", "earth", "wood", "metal", "earth", "wood", "earth", "crystal", "earth", "metal", "earth"]),
});

const BEHAVIOR_MOTION = Object.freeze({
  walk: Object.freeze({ lift: 0.42, bounce: 0.13, aerial: 0, sway: 0.1, stride: 0.72, momentum: 0.72, gravity: 1.08 }),
  "diagonal-walk": Object.freeze({ lift: 0.44, bounce: 0.14, aerial: 0, sway: 0.12, stride: 0.72, momentum: 0.7, gravity: 1.08 }),
  "running-walk": Object.freeze({ lift: 0.56, bounce: 0.2, aerial: 0.04, sway: 0.14, stride: 0.88, momentum: 0.78, gravity: 1.04 }),
  amble: Object.freeze({ lift: 0.5, bounce: 0.16, aerial: 0, sway: 0.13, stride: 0.8, momentum: 0.76, gravity: 1.06 }),
  tolt: Object.freeze({ lift: 0.65, bounce: 0.23, aerial: 0.04, sway: 0.17, stride: 0.9, momentum: 0.8, gravity: 1.04 }),
  jog: Object.freeze({ lift: 0.58, bounce: 0.21, aerial: 0.03, sway: 0.12, stride: 0.84, momentum: 0.75, gravity: 1.08 }),
  trot: Object.freeze({ lift: 0.72, bounce: 0.34, aerial: 0.34, sway: 0.16, stride: 0.98, momentum: 0.82, gravity: 1 }),
  passage: Object.freeze({ lift: 0.96, bounce: 0.5, aerial: 0.52, sway: 0.17, stride: 0.86, momentum: 0.76, gravity: 0.92 }),
  pace: Object.freeze({ lift: 0.66, bounce: 0.29, aerial: 0.08, sway: 0.26, stride: 0.94, momentum: 0.8, gravity: 1.04 }),
  "flying-pace": Object.freeze({ lift: 0.9, bounce: 0.46, aerial: 0.48, sway: 0.3, stride: 1.08, momentum: 0.87, gravity: 0.98 }),
  canter: Object.freeze({ lift: 0.84, bounce: 0.42, aerial: 0.42, sway: 0.22, stride: 1.05, momentum: 0.84, gravity: 1 }),
  "counter-canter": Object.freeze({ lift: 0.84, bounce: 0.42, aerial: 0.42, sway: 0.22, stride: 1.05, momentum: 0.84, gravity: 1 }),
  gallop: Object.freeze({ lift: 0.96, bounce: 0.52, aerial: 0.56, sway: 0.27, stride: 1.16, momentum: 0.9, gravity: 0.96 }),
  "counter-gallop": Object.freeze({ lift: 0.96, bounce: 0.52, aerial: 0.56, sway: 0.27, stride: 1.16, momentum: 0.9, gravity: 0.96 }),
  sprint: Object.freeze({ lift: 1.05, bounce: 0.58, aerial: 0.7, sway: 0.3, stride: 1.24, momentum: 0.94, gravity: 0.94 }),
  "rotary-left": Object.freeze({ lift: 1.05, bounce: 0.58, aerial: 0.7, sway: 0.3, stride: 1.24, momentum: 0.94, gravity: 0.94 }),
  bound: Object.freeze({ lift: 0.92, bounce: 0.56, aerial: 0.62, sway: 0.1, stride: 1.12, momentum: 0.9, gravity: 0.98 }),
  "half-bound": Object.freeze({ lift: 0.98, bounce: 0.58, aerial: 0.64, sway: 0.18, stride: 1.18, momentum: 0.92, gravity: 0.96 }),
  "counter-half-bound": Object.freeze({ lift: 0.98, bounce: 0.58, aerial: 0.64, sway: 0.18, stride: 1.18, momentum: 0.92, gravity: 0.96 }),
  stot: Object.freeze({ lift: 1.12, bounce: 0.7, aerial: 0.88, sway: 0.08, stride: 0.72, momentum: 0.84, gravity: 0.92 }),
  jump: Object.freeze({ lift: 1.05, bounce: 0.76, aerial: 0.86, sway: 0.08, stride: 1.18, momentum: 0.9, gravity: 0.88 }),
  charge: Object.freeze({ lift: 0.62, bounce: 0.27, aerial: 0, sway: 0.2, stride: 0.94, momentum: 0.82, gravity: 1.12 }),
  dance: Object.freeze({ lift: 0.72, bounce: 0.36, aerial: 0.12, sway: 0.48, stride: 0.86, momentum: 0.7, gravity: 1 }),
  "rear-waltz": Object.freeze({ lift: 0.9, bounce: 0.48, aerial: 0.18, sway: 0.58, stride: 0.68, momentum: 0.66, gravity: 1.06 }),
  carousel: Object.freeze({ lift: 0.58, bounce: 0.24, aerial: 0, sway: 0.42, stride: 0.74, momentum: 0.74, gravity: 1.04 }),
  "cat-prowl": Object.freeze({ lift: 0.38, bounce: 0.1, aerial: 0, sway: 0.16, stride: 0.82, momentum: 0.86, gravity: 1.02 }),
  "cat-gallop": Object.freeze({ lift: 1.02, bounce: 0.56, aerial: 0.64, sway: 0.24, stride: 1.2, momentum: 0.92, gravity: 0.94 }),
  "run-leap": Object.freeze({ lift: 1.12, bounce: 0.62, aerial: 0.92, sway: 0.26, stride: 1.28, momentum: 0.96, gravity: 0.88 }),
  "giraffe-walk": Object.freeze({ lift: 0.4, bounce: 0.12, aerial: 0, sway: 0.18, stride: 1.12, momentum: 0.84, gravity: 1.08 }),
  "giraffe-gallop": Object.freeze({ lift: 0.7, bounce: 0.3, aerial: 0.06, sway: 0.2, stride: 1.18, momentum: 0.88, gravity: 1.1 }),
  "lizard-scuttle": Object.freeze({ lift: 0.32, bounce: 0.08, aerial: 0, sway: 0.62, stride: 0.68, momentum: 0.7, gravity: 1.12 }),
  "lizard-trot": Object.freeze({ lift: 0.46, bounce: 0.15, aerial: 0.06, sway: 0.5, stride: 0.76, momentum: 0.74, gravity: 1.08 }),
  "lizard-pace": Object.freeze({ lift: 0.38, bounce: 0.1, aerial: 0, sway: 0.72, stride: 0.7, momentum: 0.72, gravity: 1.1 }),
  "lizard-sprint": Object.freeze({ lift: 0.76, bounce: 0.34, aerial: 0.18, sway: 0.7, stride: 0.92, momentum: 0.82, gravity: 1.04 }),
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
  if (requested) return requested;
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
  quadrupedAnimal(animalId);
  return QUADRUPED_BEHAVIORS;
}

export function quadrupedBehaviorFit(animalId = "elephant", behaviorId = "walk") {
  const animal = quadrupedAnimal(animalId);
  const behavior = behaviorDefinition(behaviorId);
  return animal.id === "unicorn" || behavior.nativeAnimalIds.includes(animal.id) ? "observed" : "playful";
}

export function quadrupedMotion(behaviorId = "walk") {
  return BEHAVIOR_MOTION[behaviorDefinition(behaviorId).id] ?? BEHAVIOR_MOTION.walk;
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
  const animalScale = animalId === "elephant" ? 0.86
    : animalId === "gazelle" ? 1.08
      : animalId === "cat" ? 0.9
        : animalId === "cheetah" ? 1.12
          : animalId === "giraffe" ? 1.06
            : animalId === "lizard" ? 0.76
              : 1;
  return clamp(behavior.stride * animalScale, ...QUADRUPED_LIMITS.stride);
}

function defaultCadence(animalId, behaviorId) {
  const animal = quadrupedAnimal(animalId);
  const behavior = behaviorDefinition(behaviorId);
  return clamp(Math.round(behavior.defaultCadence * animal.cadenceScale), ...QUADRUPED_LIMITS.tempoBpm);
}

export function createQuadrupedState(animalId = "elephant", behaviorId = null) {
  const animal = quadrupedAnimal(animalId);
  const behavior = behaviorDefinition(behaviorId ?? animal.defaultBehaviorId, animal.id);
  return {
    version: 3,
    animalId: animal.id,
    behaviorId: behavior.id,
    tempoBpm: defaultCadence(animal.id, behavior.id),
    stride: defaultStride(animal.id, behavior.id),
    momentum: quadrupedMotion(behavior.id).momentum,
    gravity: quadrupedMotion(behavior.id).gravity,
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
    version: 3,
    animalId: animal.id,
    behaviorId: behavior.id,
    tempoBpm: clamp(source.tempoBpm ?? fallback?.tempoBpm ?? defaultCadence(animal.id, behavior.id), ...QUADRUPED_LIMITS.tempoBpm),
    stride: clamp(source.stride ?? fallback?.stride ?? defaultStride(animal.id, behavior.id), ...QUADRUPED_LIMITS.stride),
    momentum: clamp(source.momentum ?? fallback?.momentum ?? quadrupedMotion(behavior.id).momentum, ...QUADRUPED_LIMITS.momentum),
    gravity: clamp(source.gravity ?? fallback?.gravity ?? quadrupedMotion(behavior.id).gravity, ...QUADRUPED_LIMITS.gravity),
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
  return 60 / tempoBpm / QUADRUPED_STEP_COUNT;
}

const HEAD_MOTIFS = Object.freeze({
  elephant: Object.freeze({ steps: Object.freeze([0, 3, 7, 10, 13]), offsets: Object.freeze([7, 10, 12, 10, 17]), durationFrames: 2.4 }),
  unicorn: Object.freeze({ steps: Object.freeze([0, 2, 4, 7, 10, 13]), offsets: Object.freeze([0, 4, 11, 18, 14, 23]), durationFrames: 1.7 }),
  gazelle: Object.freeze({ steps: Object.freeze([0, 1, 4, 6, 9, 12]), offsets: Object.freeze([0, 9, 4, 11, 6, 12]), durationFrames: 1.35 }),
  cat: Object.freeze({ steps: Object.freeze([0, 4, 8, 12, 15]), offsets: Object.freeze([0, 3, 7, 5, 12]), durationFrames: 2 }),
  cheetah: Object.freeze({ steps: Object.freeze([0, 3, 6, 9, 12, 15]), offsets: Object.freeze([0, 7, 12, 9, 16, 21]), durationFrames: 1.2 }),
  giraffe: Object.freeze({ steps: Object.freeze([0, 4, 8, 12]), offsets: Object.freeze([0, 7, 12, 19]), durationFrames: 3 }),
  lizard: Object.freeze({ steps: Object.freeze([0, 2, 5, 8, 11, 14]), offsets: Object.freeze([0, 1, 6, 3, 8, 11]), durationFrames: 1.45 }),
});

const HEAD_KINDS = Object.freeze({
  elephant: Object.freeze({ kind: "trumpet", gesture: "trunk-lift" }),
  unicorn: Object.freeze({ kind: "neigh-arpeggio", gesture: "horn-neigh" }),
  gazelle: Object.freeze({ kind: "marimba-string", gesture: "head-toss" }),
  cat: Object.freeze({ kind: "purr-meow", gesture: "whisker-meow" }),
  cheetah: Object.freeze({ kind: "chirp-run", gesture: "spine-chirp" }),
  giraffe: Object.freeze({ kind: "neck-harp", gesture: "neck-sway" }),
  lizard: Object.freeze({ kind: "hiss-click", gesture: "tongue-flick" }),
});

function headPhraseFromEvent(safe, step, terrain, footEnergy, totalEnergy, force = false) {
  const animal = quadrupedAnimal(safe.animalId);
  const terrainIndex = QUADRUPED_TERRAINS.findIndex(({ id }) => id === terrain.id);
  const pitchIndex = mod(step + terrainIndex, animal.scale.length);
  const baseNote = animal.scale[pitchIndex] + Math.round((safe.mood - 0.5) * 4);
  const scoredFootEnergy = QUADRUPED_LANES.slice(0, 4).reduce((sum, lane) => (
    sum + safe.pattern[lane.id].reduce((laneSum, value) => laneSum + value, 0)
  ), 0);
  if (!force) {
    if (scoredFootEnergy <= 0.001) return null;
    const motif = HEAD_MOTIFS[safe.animalId];
    const motifIndex = motif.steps.indexOf(step);
    if (motifIndex < 0) return null;
    const { kind, gesture } = HEAD_KINDS[safe.animalId] ?? HEAD_KINDS.elephant;
    const scoreDrive = clamp(scoredFootEnergy / 5.2, 0.18, 1);
    return Object.freeze({
      kind,
      gesture,
      notes: Object.freeze([baseNote + motif.offsets[motifIndex]]),
      intensity: clamp(0.2 + scoreDrive * 0.46 + safe.mood * 0.22),
      durationFrames: motif.durationFrames,
      durationSeconds: clamp(60 / safe.tempoBpm * motif.durationFrames / QUADRUPED_STEP_COUNT * 1.8, 0.055, 0.28),
      frameLocked: true,
      motifIndex,
      motifLength: motif.steps.length,
    });
  }

  const phraseEnergy = Math.max(1, totalEnergy);
  const phraseFootEnergy = Math.max(1, footEnergy);
  const elephantPhraseAccent = phraseFootEnergy > 0.3;
  const unicornPhraseAccent = phraseEnergy > 0.34;
  const gazellePhraseAccent = phraseFootEnergy > 0.3;

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

  const newSpeciesPhrase = {
    cat: { kind: "purr-meow", gesture: "whisker-meow", offsets: [0, 3, 7, 5, 12], spacing: 0.075, decay: 0.24 },
    cheetah: { kind: "chirp-run", gesture: "spine-chirp", offsets: [0, 7, 12, 9, 16, 21], spacing: 0.038, decay: 0.13 },
    giraffe: { kind: "neck-harp", gesture: "neck-sway", offsets: [0, 7, 12, 19, 14], spacing: 0.11, decay: 0.34 },
    lizard: { kind: "hiss-click", gesture: "tongue-flick", offsets: [0, 1, 6, 3, 8, 11], spacing: 0.032, decay: 0.12 },
  }[safe.animalId];
  if (newSpeciesPhrase) {
    const notes = Object.freeze(newSpeciesPhrase.offsets.map((offset) => baseNote + offset));
    const noteOffsetsSeconds = Object.freeze(notes.map((_, index) => index * newSpeciesPhrase.spacing));
    const phraseDurationSeconds = noteOffsetsSeconds.at(-1) + newSpeciesPhrase.decay;
    return Object.freeze({
      kind: newSpeciesPhrase.kind,
      gesture: newSpeciesPhrase.gesture,
      notes,
      noteOffsetsSeconds,
      intensity: clamp(0.28 + phraseEnergy * 0.15 + safe.mood * 0.2),
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
  for (let lag = 0; lag < QUADRUPED_STEP_COUNT; lag += 1) {
    const phrase = sequenceEventFromSafe(safe, wholeStep - lag).head;
    if (!phrase) continue;
    const elapsedFrames = lag + phase;
    const durationFrames = phrase.durationFrames ?? 1.5;
    if (elapsedFrames > durationFrames) continue;
    const progress = clamp(elapsedFrames / Math.max(0.001, durationFrames));
    const attack = clamp(elapsedFrames / Math.min(0.34, durationFrames * 0.22));
    const strength = clamp(Math.sin(attack * Math.PI * 0.5) * (1 - progress * 0.72));
    const noteIndex = phrase.motifIndex ?? 0;
    const notePulse = clamp(Math.exp(-progress * 5.5));
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
      whiskerPulse: phrase.gesture === "whisker-meow" ? Math.max(strength * 0.5, notePulse) : 0,
      spineFlex: phrase.gesture === "spine-chirp" ? strength * (noteIndex % 2 ? -1 : 1) : 0,
      neckSway: phrase.gesture === "neck-sway" ? strength * Math.sin((noteIndex + progress) * Math.PI * 0.7) : 0,
      tongueFlick: phrase.gesture === "tongue-flick" ? notePulse : 0,
    });
  }
  return Object.freeze({ active: false, kind: null, gesture: null, strength: 0, progress: 1, noteIndex: -1, notePulse: 0, trunkRaise: 0, hornPulse: 0, headToss: 0, earFlick: 0, whiskerPulse: 0, spineFlex: 0, neckSway: 0, tongueFlick: 0 });
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

export function deriveQuadrupedPose(state, sequencePosition = 0, motorSnapshot = null) {
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
  const inferredSupportCount = QUADRUPED_LANES.slice(0, 4).filter(({ id }) => legs[id].contact > 0.06).length;
  const groundSupportCount = Number.isFinite(Number(motorSnapshot?.supportCount))
    ? Math.round(clamp(motorSnapshot.supportCount, 0, 4))
    : inferredSupportCount;
  if (["dance", "rear-waltz", "lizard-sprint"].includes(safe.behaviorId) && groundSupportCount === 2) {
    for (const lane of QUADRUPED_LANES.slice(0, 4)) {
      if (legs[lane.id].contact > 0.06) continue;
      legs[lane.id] = Object.freeze({ ...legs[lane.id], lift: Math.max(legs[lane.id].lift, 0.72 + Math.sin(Math.PI * phase) * 0.28) });
    }
  }
  let flightArc = 0;
  if (groundSupportCount === 0) {
    const sampleSupport = (samplePosition) => QUADRUPED_LANES.slice(0, 4).some(({ id }) => (
      footCycleState(safe, id, samplePosition, behavior.stanceSteps).contact > 0.06
    ));
    let behind = 0;
    let ahead = 0;
    while (behind < QUADRUPED_STEP_COUNT && !sampleSupport(absolutePosition - behind)) behind += 0.125;
    while (ahead < QUADRUPED_STEP_COUNT && !sampleSupport(absolutePosition + ahead)) ahead += 0.125;
    const flightSpan = Math.max(0.25, behind + ahead);
    flightArc = Math.sin(Math.PI * clamp(behind / flightSpan));
  }
  const simulatedHeight = Number.isFinite(Number(motorSnapshot?.height)) ? clamp(motorSnapshot.height, 0, 2) : null;
  const aerial = simulatedHeight === null
    ? flightArc * motion.aerial / Math.sqrt(safe.gravity)
    : simulatedHeight * (0.34 + motion.aerial * 0.34);
  const legImpact = QUADRUPED_LANES.slice(0, 4).reduce((sum, { id }) => sum + legs[id].impact, 0) / 4;
  const impact = Math.max(legImpact, clamp(motorSnapshot?.landing, 0, 1));
  const leftEnergy = (legs["front-left"].contact + legs["rear-left"].contact) / 2;
  const rightEnergy = (legs["front-right"].contact + legs["rear-right"].contact) / 2;
  const foreSupport = legs["front-left"].contact + legs["front-right"].contact;
  const rearSupport = legs["rear-left"].contact + legs["rear-right"].contact;
  const danceSway = ["dance", "rear-waltz", "carousel"].includes(safe.behaviorId) ? Math.sin(position * Math.PI * 0.5) * 0.16 : 0;
  const propulsion = Number.isFinite(Number(motorSnapshot?.propulsion))
    ? clamp(motorSnapshot.propulsion / 2.4)
    : clamp(event.footEnergy / 3.2);
  const compression = clamp(motorSnapshot?.compression ?? impact * 0.42);
  const bodyLift = clamp(0.05 + aerial + propulsion * motion.bounce * 0.16 - compression * 0.2, -0.1, 1.2);
  const headExpression = headPerformance.strength;
  const danceBalance = ["dance", "rear-waltz", "lizard-sprint"].includes(safe.behaviorId) && groundSupportCount === 2
    ? clamp(Math.sin(Math.PI * phase))
    : 0;
  const rearBalance = safe.behaviorId === "rear-waltz" ? 1 : safe.behaviorId === "lizard-sprint" ? 0.48 : 0;
  return Object.freeze({
    position,
    step,
    phase,
    progress: position / QUADRUPED_STEP_COUNT,
    event,
    headPerformance,
    legs: Object.freeze(legs),
    groundSupportCount,
    airborne: typeof motorSnapshot?.airborne === "boolean" ? motorSnapshot.airborne : groundSupportCount === 0,
    bodyLift,
    bodyRoll: clamp((rightEnergy - leftEnergy) * motion.sway + danceSway, -0.5, 0.5),
    bodyPitch: clamp((rearSupport - foreSupport) * 0.08 + Math.sin(phase * Math.PI * 2) * 0.03, -0.28, 0.28),
    headLift: clamp(bodyLift * 0.42 + safe.mood * 0.2 + headExpression * 0.22, 0, 0.92),
    headNod: clamp(impact * 0.25 - Math.sin(phase * Math.PI * 2) * 0.06, -0.2, 0.35),
    headExpression,
    danceBalance,
    rearBalance,
    propulsion,
    momentum: Number.isFinite(Number(motorSnapshot?.normalizedVelocity)) ? motorSnapshot.normalizedVelocity : safe.momentum,
    gravity: safe.gravity,
    compression,
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
