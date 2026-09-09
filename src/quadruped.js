const CONTACT_LEVELS = Object.freeze([0, 0.58, 1]);

export const QUADRUPED_STEP_COUNT = 16;
export const QUADRUPED_DEFAULT_TEMPO_BPM = 96;
export const QUADRUPED_PACE_RATIOS = Object.freeze([0.5, 1, 2, 3]);

const ALL_QUADRUPED_IDS = Object.freeze([
  "elephant",
  "unicorn",
  "gazelle",
  "cat",
  "cheetah",
  "giraffe",
  "lizard",
  "horse",
  "dog",
  "goat",
  "rabbit",
  "camel",
  "mouse",
  "dinosaur",
]);

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
]);

export const QUADRUPED_FOOT_LANES = QUADRUPED_LANES;

export const QUADRUPED_TERRAINS = Object.freeze([
  Object.freeze({ id: "earth", label: "Packed earth", shortLabel: "EARTH", color: "#9a6845", pitchOffset: -5, decay: 0.2, brightness: 0.16, traction: 1, rollingResistance: 1, hardness: 0.54, damping: 0.58, roughness: 0.62, reflection: 0.16 }),
  Object.freeze({ id: "sand", label: "Loose sand", shortLabel: "SAND", color: "#c49a61", pitchOffset: -8, decay: 0.12, brightness: 0.12, traction: 0.62, rollingResistance: 1.55, hardness: 0.18, damping: 0.88, roughness: 0.86, reflection: 0.04 }),
  Object.freeze({ id: "wood", label: "Hollow wood", shortLabel: "WOOD", color: "#d09b55", pitchOffset: 0, decay: 0.32, brightness: 0.38, traction: 0.92, rollingResistance: 0.82, hardness: 0.72, damping: 0.36, roughness: 0.42, reflection: 0.54 }),
  Object.freeze({ id: "stone", label: "Cut stone", shortLabel: "STONE", color: "#82918c", pitchOffset: 2, decay: 0.42, brightness: 0.48, traction: 0.94, rollingResistance: 0.9, hardness: 0.96, damping: 0.2, roughness: 0.3, reflection: 0.64 }),
  Object.freeze({ id: "metal", label: "Bell metal", shortLabel: "METAL", color: "#75c7d3", pitchOffset: 5, decay: 0.56, brightness: 0.68, traction: 0.8, rollingResistance: 0.72, hardness: 1, damping: 0.12, roughness: 0.18, reflection: 0.92 }),
  Object.freeze({ id: "snow", label: "Deep snow", shortLabel: "SNOW", color: "#dceceb", pitchOffset: -10, decay: 0.09, brightness: 0.26, traction: 0.48, rollingResistance: 1.72, hardness: 0.1, damping: 0.96, roughness: 0.68, reflection: 0.03 }),
  Object.freeze({ id: "water", label: "Shallow water", shortLabel: "WATER", color: "#4c91a8", pitchOffset: -2, decay: 0.24, brightness: 0.52, traction: 0.42, rollingResistance: 1.92, hardness: 0.05, damping: 0.78, roughness: 0.94, reflection: 0.2 }),
  Object.freeze({ id: "crystal", label: "Resonant crystal", shortLabel: "GLASS", color: "#db9cff", pitchOffset: 9, decay: 0.78, brightness: 0.94, traction: 0.72, rollingResistance: 0.74, hardness: 0.98, damping: 0.08, roughness: 0.12, reflection: 1 }),
]);

export const QUADRUPED_GROUND_PROFILES = Object.freeze([
  Object.freeze({ id: "level", label: "Level ground", shortLabel: "LEVEL", stepHeight: 0, treadLength: 0.9, direction: 0, clearanceScale: 1 }),
  Object.freeze({ id: "stairs-up", label: "Steps up", shortLabel: "UP", stepHeight: 0.16, treadLength: 0.9, direction: 1, clearanceScale: 1.28 }),
  Object.freeze({ id: "stairs-down", label: "Steps down", shortLabel: "DOWN", stepHeight: 0.16, treadLength: 0.9, direction: -1, clearanceScale: 1.2 }),
]);

export const QUADRUPED_BEHAVIORS = Object.freeze([
  Object.freeze({ id: "walk", label: "Walk", description: "even lateral walk", stanceSteps: 10, nativeAnimalIds: ALL_QUADRUPED_IDS }),
  Object.freeze({ id: "mosey", label: "Mosey", description: "lazy long-short steps", stanceSteps: 11, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "wander", label: "Wander", description: "hesitate · step · look around", stanceSteps: 10, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "drunk", label: "Drunk", description: "stagger · catch · stagger", stanceSteps: 8, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "tiptoe", label: "Tiptoe", description: "light toes · careful lifted steps", stanceSteps: 10, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "diagonal-walk", label: "Diagonal walk", description: "even diagonal walk", stanceSteps: 10, nativeAnimalIds: Object.freeze(["unicorn", "gazelle", "horse", "dog", "goat"]) }),
  Object.freeze({ id: "running-walk", label: "Running walk", description: "four quick grounded beats", stanceSteps: 8.8, nativeAnimalIds: Object.freeze(["unicorn", "horse"]) }),
  Object.freeze({ id: "amble", label: "Amble", description: "close lateral couplets", stanceSteps: 8, nativeAnimalIds: Object.freeze(["elephant", "unicorn", "horse", "camel"]) }),
  Object.freeze({ id: "tolt", label: "Tölt", description: "fast four-beat singlefoot", stanceSteps: 7, nativeAnimalIds: Object.freeze(["unicorn"]) }),
  Object.freeze({ id: "jog", label: "Jog", description: "broken diagonal pairs", stanceSteps: 10, nativeAnimalIds: Object.freeze(["unicorn", "gazelle", "horse", "dog", "goat"]) }),
  Object.freeze({ id: "trot", label: "Trot", description: "diagonal pairs + float", stanceSteps: 6, nativeAnimalIds: Object.freeze(["unicorn", "gazelle", "horse", "dog", "goat"]) }),
  Object.freeze({ id: "passage", label: "Passage", description: "high suspended trot", stanceSteps: 5, nativeAnimalIds: Object.freeze(["unicorn"]) }),
  Object.freeze({ id: "pace", label: "Pace", description: "grounded lateral pairs", stanceSteps: 9, nativeAnimalIds: Object.freeze(["unicorn", "horse", "camel"]) }),
  Object.freeze({ id: "flying-pace", label: "Flying pace", description: "lateral pairs + flight", stanceSteps: 5.6, nativeAnimalIds: Object.freeze(["unicorn"]) }),
  Object.freeze({ id: "canter", label: "Canter R", description: "three beats · right lead", stanceSteps: 4, nativeAnimalIds: Object.freeze(["unicorn", "gazelle", "horse", "dog", "goat"]) }),
  Object.freeze({ id: "counter-canter", label: "Canter L", description: "three beats · left lead", stanceSteps: 4, nativeAnimalIds: Object.freeze(["unicorn", "gazelle", "horse", "dog", "goat"]) }),
  Object.freeze({ id: "gallop", label: "Gallop R", description: "right transverse gallop", stanceSteps: 4, nativeAnimalIds: Object.freeze(["unicorn", "gazelle", "horse", "dog", "goat"]) }),
  Object.freeze({ id: "counter-gallop", label: "Gallop L", description: "left transverse gallop", stanceSteps: 4, nativeAnimalIds: Object.freeze(["unicorn", "gazelle", "horse", "dog", "goat"]) }),
  Object.freeze({ id: "sprint", label: "Rotary R", description: "right rotary sprint", stanceSteps: 3, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "rotary-left", label: "Rotary L", description: "left rotary sprint", stanceSteps: 3, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "bound", label: "Bound", description: "hind pair · fore pair", stanceSteps: 4, nativeAnimalIds: Object.freeze(["gazelle", "dog", "goat", "rabbit"]) }),
  Object.freeze({ id: "half-bound", label: "Half-bound R", description: "hind pair · split fore", stanceSteps: 4, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "counter-half-bound", label: "Half-bound L", description: "hind pair · split fore", stanceSteps: 4, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "stot", label: "Stot", description: "four together + flight", stanceSteps: 3, nativeAnimalIds: Object.freeze(["gazelle"]) }),
  Object.freeze({ id: "jump", label: "Jump", description: "short hind launch · fore landing", stanceSteps: 3, nativeAnimalIds: Object.freeze(["unicorn", "gazelle", "horse", "dog", "goat", "rabbit", "camel"]) }),
  Object.freeze({ id: "leap", label: "Leap", description: "long hind launch · late fore landing", stanceSteps: 2.6, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "walk-leap", label: "Walk ×4 · leap", description: "walk walk walk walk · launch · rest · land", stanceSteps: 1.4, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "skid", label: "Skid", description: "push · belly slide · stand", stanceSteps: 2, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "forward-roll", label: "Forward roll", description: "hind launch · tuck · fore landing", stanceSteps: 2.6, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "cartwheel", label: "Cartwheel", description: "sideways wheel · four separated feet", stanceSteps: 2, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "rear-up", label: "Rear up", description: "hind support · forefeet raised", stanceSteps: 12, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "charge", label: "Charge", description: "heavy grounded drive", stanceSteps: 7.4, nativeAnimalIds: Object.freeze(["elephant"]) }),
  Object.freeze({ id: "dance", label: "Tango", description: "alternating two-leg balance", stanceSteps: 3, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "rear-waltz", label: "Rear waltz", description: "hind-leg dancing", stanceSteps: 4, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "carousel", label: "Carousel", description: "circling four-beat pivot", stanceSteps: 7, nativeAnimalIds: Object.freeze([]) }),
  Object.freeze({ id: "cat-prowl", label: "Cat prowl", description: "quiet overlapping paws", stanceSteps: 10, nativeAnimalIds: Object.freeze(["cat"]) }),
  Object.freeze({ id: "cat-gallop", label: "Cat gallop", description: "one-flight feline gallop", stanceSteps: 4, nativeAnimalIds: Object.freeze(["cat"]) }),
  Object.freeze({ id: "run-leap", label: "Run ×3 · leap", description: "run run run · hind launch", stanceSteps: 1.4, nativeAnimalIds: Object.freeze(["cat", "cheetah", "gazelle"]) }),
  Object.freeze({ id: "rabbit-gallop", label: "Rabbit gallop", description: "hind cluster · split fore", stanceSteps: 6, nativeAnimalIds: Object.freeze(["rabbit"]) }),
  Object.freeze({ id: "giraffe-walk", label: "Giraffe walk", description: "long lateral overlap", stanceSteps: 11, nativeAnimalIds: Object.freeze(["giraffe"]) }),
  Object.freeze({ id: "giraffe-gallop", label: "Grounded rotary", description: "long grounded rotary run", stanceSteps: 6, nativeAnimalIds: Object.freeze(["giraffe"]) }),
  Object.freeze({ id: "lizard-scuttle", label: "Scuttle", description: "lateral body-wave walk", stanceSteps: 8.5, nativeAnimalIds: Object.freeze(["lizard"]) }),
  Object.freeze({ id: "lizard-trot", label: "Lizard trot", description: "diagonal scurry", stanceSteps: 8, nativeAnimalIds: Object.freeze(["lizard"]) }),
  Object.freeze({ id: "lizard-pace", label: "Lizard pace", description: "serpentine lateral pairs", stanceSteps: 8, nativeAnimalIds: Object.freeze(["lizard"]) }),
  Object.freeze({ id: "lizard-sprint", label: "Lizard sprint", description: "hind-leg dash + tail", stanceSteps: 3, nativeAnimalIds: Object.freeze(["lizard"]) }),
]);

const ALL_BEHAVIOR_IDS = Object.freeze(QUADRUPED_BEHAVIORS.map(({ id }) => id));

// Duty factor is the fraction of one limb's touchdown-to-touchdown cycle spent
// in stance.  These values shape support; touchdown ordering still comes from
// the editable sixteen-frame score.  Measured families are used where useful,
// while dance/jump figures are deliberately playable approximations.
const GAIT_DUTY_FACTORS = Object.freeze({
  mosey: Object.freeze({ front: 0.72, hind: 0.72, basis: "playful lingering walk" }),
  wander: Object.freeze({ front: 0.68, hind: 0.68, basis: "playful hesitant walk" }),
  drunk: Object.freeze({ front: 0.56, hind: 0.58, basis: "playful stagger" }),
  tiptoe: Object.freeze({ front: 0.6, hind: 0.6, basis: "playful light toe steps" }),
  "walk-leap": Object.freeze({ front: 0.2, hind: 0.2, basis: "four-step launch phrase" }),
  cartwheel: Object.freeze({ front: 0.1, hind: 0.1, basis: "fictional acrobatic transfer" }),
  walk: Object.freeze({ front: 0.64, hind: 0.64, basis: "four-beat lateral walk" }),
  "diagonal-walk": Object.freeze({ front: 0.64, hind: 0.64, basis: "four-beat diagonal walk" }),
  "running-walk": Object.freeze({ front: 0.54, hind: 0.54, basis: "grounded four-beat approximation" }),
  amble: Object.freeze({ front: 0.58, hind: 0.58, basis: "lateral couplet approximation" }),
  tolt: Object.freeze({ front: 0.51, hind: 0.51, basis: "grounded single-foot approximation" }),
  jog: Object.freeze({ front: 0.52, hind: 0.52, basis: "grounded broken-trot approximation" }),
  charge: Object.freeze({ front: 0.58, hind: 0.6, basis: "grounded drive approximation" }),
  trot: Object.freeze({ front: 0.45, hind: 0.45, basis: "diagonal-pair approximation" }),
  passage: Object.freeze({ front: 0.36, hind: 0.36, basis: "suspended diagonal-pair approximation" }),
  pace: Object.freeze({ front: 0.52, hind: 0.52, basis: "grounded lateral-pair approximation" }),
  "flying-pace": Object.freeze({ front: 0.36, hind: 0.36, basis: "aerial lateral-pair approximation" }),
  canter: Object.freeze({ front: 0.36, hind: 0.38, basis: "three-beat 1:1:2 canter" }),
  "counter-canter": Object.freeze({ front: 0.36, hind: 0.38, basis: "three-beat 1:1:2 canter" }),
  gallop: Object.freeze({ front: 0.296, hind: 0.286, basis: "comparative transverse gallop" }),
  "counter-gallop": Object.freeze({ front: 0.296, hind: 0.286, basis: "comparative transverse gallop" }),
  sprint: Object.freeze({ front: 0.229, hind: 0.236, basis: "comparative rotary gallop" }),
  "rotary-left": Object.freeze({ front: 0.229, hind: 0.236, basis: "comparative rotary gallop" }),
  bound: Object.freeze({ front: 0.29, hind: 0.29, basis: "paired bound approximation" }),
  "half-bound": Object.freeze({ front: 0.29, hind: 0.3, basis: "half-bound approximation" }),
  "counter-half-bound": Object.freeze({ front: 0.29, hind: 0.3, basis: "half-bound approximation" }),
  stot: Object.freeze({ front: 0.2, hind: 0.2, basis: "simultaneous stot approximation" }),
  jump: Object.freeze({ front: 0.24, hind: 0.28, basis: "launch-and-land approximation" }),
  leap: Object.freeze({ front: 0.18, hind: 0.22, basis: "long launch-and-land stunt approximation" }),
  skid: Object.freeze({ front: 0.1, hind: 0.1, basis: "body-slide stunt approximation" }),
  "forward-roll": Object.freeze({ front: 0.18, hind: 0.22, basis: "aerial rolling stunt approximation" }),
  "rear-up": Object.freeze({ front: 0.08, hind: 0.74, basis: "hind-support stunt approximation" }),
  dance: Object.freeze({ front: 0.34, hind: 0.34, basis: "two-leg dance approximation" }),
  "rear-waltz": Object.freeze({ front: 0.3, hind: 0.42, basis: "rear-balance dance approximation" }),
  carousel: Object.freeze({ front: 0.58, hind: 0.58, basis: "grounded pivot approximation" }),
  "cat-prowl": Object.freeze({ front: 0.66, hind: 0.66, basis: "measured slow cat walk family" }),
  "cat-gallop": Object.freeze({ front: 0.32, hind: 0.32, basis: "video-derived cat rotary approximation" }),
  "run-leap": Object.freeze({ front: 0.23, hind: 0.25, basis: "three-run-and-leap phrase" }),
  "rabbit-gallop": Object.freeze({ front: 0.38, hind: 0.46, basis: "measured rabbit slow-gallop support order" }),
  "giraffe-walk": Object.freeze({ front: 0.7, hind: 0.68, basis: "measured giraffe walk family" }),
  "giraffe-gallop": Object.freeze({ front: 0.4, hind: 0.38, basis: "measured grounded giraffe run family" }),
  "lizard-scuttle": Object.freeze({ front: 0.74, hind: 0.74, basis: "sprawling walk family" }),
  "lizard-trot": Object.freeze({ front: 0.58, hind: 0.58, basis: "grounded diagonal scuttle approximation" }),
  "lizard-pace": Object.freeze({ front: 0.7, hind: 0.7, basis: "grounded lateral scuttle approximation" }),
  "lizard-sprint": Object.freeze({ front: 0.41, hind: 0.41, basis: "hind-leg sprint approximation" }),
});

export const QUADRUPED_FOOT_VOICES = Object.freeze({
  mouse: Object.freeze({
    "front-left": Object.freeze({ label: "tiny tick", family: "fore-tick" }),
    "front-right": Object.freeze({ label: "claw fleck", family: "fore-fleck" }),
    "rear-left": Object.freeze({ label: "seed tap", family: "hind-seed" }),
    "rear-right": Object.freeze({ label: "quick pat", family: "hind-pat" }),
  }),
  dinosaur: Object.freeze({
    "front-left": Object.freeze({ label: "shield knock", family: "fore-shield" }),
    "front-right": Object.freeze({ label: "stone stomp", family: "fore-stone" }),
    "rear-left": Object.freeze({ label: "earth drum", family: "hind-earth" }),
    "rear-right": Object.freeze({ label: "heavy push", family: "hind-push" }),
  }),
  elephant: Object.freeze({
    "front-left": Object.freeze({ label: "hide slap", family: "fore-slap" }),
    "front-right": Object.freeze({ label: "hollow knock", family: "fore-knock" }),
    "rear-left": Object.freeze({ label: "sub drum", family: "hind-sub" }),
    "rear-right": Object.freeze({ label: "floor drum", family: "hind-tom" }),
  }),
  unicorn: Object.freeze({
    "front-left": Object.freeze({ label: "glass bell", family: "fore-glass" }),
    "front-right": Object.freeze({ label: "silver bell", family: "fore-silver" }),
    "rear-left": Object.freeze({ label: "hoof clop", family: "hind-clop" }),
    "rear-right": Object.freeze({ label: "crystal kick", family: "hind-crystal" }),
  }),
  gazelle: Object.freeze({
    "front-left": Object.freeze({ label: "wood tick", family: "fore-tick" }),
    "front-right": Object.freeze({ label: "stick click", family: "fore-click" }),
    "rear-left": Object.freeze({ label: "low marimba", family: "hind-low" }),
    "rear-right": Object.freeze({ label: "high marimba", family: "hind-high" }),
  }),
  cat: Object.freeze({
    "front-left": Object.freeze({ label: "felt tap", family: "fore-felt" }),
    "front-right": Object.freeze({ label: "paw knock", family: "fore-paw" }),
    "rear-left": Object.freeze({ label: "cushion kick", family: "hind-cushion" }),
    "rear-right": Object.freeze({ label: "soft thump", family: "hind-soft" }),
  }),
  cheetah: Object.freeze({
    "front-left": Object.freeze({ label: "claw snap", family: "fore-claw" }),
    "front-right": Object.freeze({ label: "dry slap", family: "fore-dry" }),
    "rear-left": Object.freeze({ label: "launch drum", family: "hind-launch" }),
    "rear-right": Object.freeze({ label: "sprint kick", family: "hind-sprint" }),
  }),
  giraffe: Object.freeze({
    "front-left": Object.freeze({ label: "long knock", family: "fore-long" }),
    "front-right": Object.freeze({ label: "bone bell", family: "fore-bone" }),
    "rear-left": Object.freeze({ label: "wood bass", family: "hind-wood" }),
    "rear-right": Object.freeze({ label: "hollow hoof", family: "hind-hollow" }),
  }),
  lizard: Object.freeze({
    "front-left": Object.freeze({ label: "claw tick", family: "fore-tick" }),
    "front-right": Object.freeze({ label: "scale click", family: "fore-scale" }),
    "rear-left": Object.freeze({ label: "sand scrape", family: "hind-sand" }),
    "rear-right": Object.freeze({ label: "stone tap", family: "hind-stone" }),
  }),
  horse: Object.freeze({
    "front-left": Object.freeze({ label: "near clop", family: "fore-hoof" }),
    "front-right": Object.freeze({ label: "far clop", family: "fore-hoof-bright" }),
    "rear-left": Object.freeze({ label: "hind knock", family: "hind-hoof" }),
    "rear-right": Object.freeze({ label: "drive clop", family: "hind-hoof-drive" }),
  }),
  dog: Object.freeze({
    "front-left": Object.freeze({ label: "pad tap", family: "fore-pad" }),
    "front-right": Object.freeze({ label: "claw tick", family: "fore-claw" }),
    "rear-left": Object.freeze({ label: "hind pat", family: "hind-pad" }),
    "rear-right": Object.freeze({ label: "push thump", family: "hind-push" }),
  }),
  goat: Object.freeze({
    "front-left": Object.freeze({ label: "split clack", family: "fore-cloven" }),
    "front-right": Object.freeze({ label: "stone click", family: "fore-stone" }),
    "rear-left": Object.freeze({ label: "load knock", family: "hind-load" }),
    "rear-right": Object.freeze({ label: "climb clack", family: "hind-climb" }),
  }),
  rabbit: Object.freeze({
    "front-left": Object.freeze({ label: "fore pat", family: "fore-soft" }),
    "front-right": Object.freeze({ label: "fore tap", family: "fore-quick" }),
    "rear-left": Object.freeze({ label: "haunch thump", family: "hind-haunch" }),
    "rear-right": Object.freeze({ label: "launch thump", family: "hind-launch" }),
  }),
  camel: Object.freeze({
    "front-left": Object.freeze({ label: "broad pad", family: "fore-pad-wide" }),
    "front-right": Object.freeze({ label: "sand pad", family: "fore-sand" }),
    "rear-left": Object.freeze({ label: "deep pad", family: "hind-pad-wide" }),
    "rear-right": Object.freeze({ label: "pace thump", family: "hind-pace" }),
  }),
});

// Normalized side-view anatomy. Segment lengths remain fixed while the IK
// solver changes joint angles, so gait edits articulate a body rather than
// stretching decorative legs.
const MORPHOLOGY = Object.freeze({
  mouse: Object.freeze({ family: "rodent", bodyWidth: 1.34, bodyHeight: 0.65, clearance: 0.3, shoulder: 0.8, haunch: 0.98, headScale: 0.43, neckLength: 0.14, headForward: 0.68, headRise: 0.04, frontUpper: 0.18, frontLower: 0.17, hindUpper: 0.27, hindLower: 0.22, distal: 0.09, legWidth: 0.038, footWidth: 0.11, tailLength: 1.55, foreBend: 1, hindBend: -1, spineElasticity: 0.2 }),
  dinosaur: Object.freeze({ family: "ceratopsian", bodyWidth: 1.75, bodyHeight: 0.86, clearance: 0.6, shoulder: 1.08, haunch: 1, headScale: 0.66, neckLength: 0.24, headForward: 0.94, headRise: 0.08, frontUpper: 0.34, frontLower: 0.3, hindUpper: 0.38, hindLower: 0.32, distal: 0.1, legWidth: 0.16, footWidth: 0.19, tailLength: 1.03, foreBend: 1, hindBend: -1, spineElasticity: 0.025 }),
  elephant: Object.freeze({ family: "elephant", bodyWidth: 1.5, bodyHeight: 0.78, clearance: 0.84, shoulder: 1.04, haunch: 1.02, headScale: 0.58, neckLength: 0.08, headForward: 0.58, headRise: 0.04, frontUpper: 0.34, frontLower: 0.35, hindUpper: 0.34, hindLower: 0.35, distal: 0.045, legWidth: 0.11, footWidth: 0.14, tailLength: 0.64, foreBend: 1, hindBend: -1, spineElasticity: 0.03 }),
  unicorn: Object.freeze({ family: "equid", bodyWidth: 1.4, bodyHeight: 0.6, clearance: 0.88, shoulder: 1.08, haunch: 1.12, headScale: 0.44, neckLength: 0.6, headForward: 0.7, headRise: 0.42, frontUpper: 0.36, frontLower: 0.34, hindUpper: 0.38, hindLower: 0.34, distal: 0.12, legWidth: 0.06, footWidth: 0.085, tailLength: 0.88, foreBend: 1, hindBend: -1, spineElasticity: 0.08 }),
  gazelle: Object.freeze({ family: "bovid", bodyWidth: 1.28, bodyHeight: 0.5, clearance: 0.8, shoulder: 0.98, haunch: 1.08, headScale: 0.4, neckLength: 0.5, headForward: 0.68, headRise: 0.42, frontUpper: 0.38, frontLower: 0.36, hindUpper: 0.4, hindLower: 0.37, distal: 0.14, legWidth: 0.045, footWidth: 0.065, tailLength: 0.48, foreBend: 1, hindBend: -1, spineElasticity: 0.12 }),
  cat: Object.freeze({ family: "feline", bodyWidth: 1.45, bodyHeight: 0.46, clearance: 0.7, shoulder: 1, haunch: 1.12, headScale: 0.4, neckLength: 0.14, headForward: 0.64, headRise: 0.12, frontUpper: 0.3, frontLower: 0.3, hindUpper: 0.36, hindLower: 0.33, distal: 0.15, legWidth: 0.058, footWidth: 0.095, tailLength: 0.96, foreBend: 1, hindBend: -1, spineElasticity: 0.2 }),
  cheetah: Object.freeze({ family: "feline", bodyWidth: 1.58, bodyHeight: 0.43, clearance: 0.72, shoulder: 0.94, haunch: 1.08, headScale: 0.35, neckLength: 0.2, headForward: 0.7, headRise: 0.14, frontUpper: 0.33, frontLower: 0.32, hindUpper: 0.4, hindLower: 0.36, distal: 0.16, legWidth: 0.048, footWidth: 0.085, tailLength: 1.15, foreBend: 1, hindBend: -1, spineElasticity: 0.28 }),
  giraffe: Object.freeze({ family: "giraffe", bodyWidth: 1.34, bodyHeight: 0.56, clearance: 1.03, shoulder: 1.14, haunch: 0.98, headScale: 0.38, neckLength: 1.42, headForward: 0.55, headRise: 1.35, frontUpper: 0.44, frontLower: 0.42, hindUpper: 0.43, hindLower: 0.41, distal: 0.12, legWidth: 0.052, footWidth: 0.075, tailLength: 0.68, foreBend: 1, hindBend: -1, spineElasticity: 0.04 }),
  lizard: Object.freeze({ family: "lizard", bodyWidth: 1.66, bodyHeight: 0.3, clearance: 0.38, shoulder: 0.82, haunch: 0.9, headScale: 0.3, neckLength: 0.08, headForward: 0.74, headRise: 0.02, frontUpper: 0.24, frontLower: 0.27, hindUpper: 0.27, hindLower: 0.29, distal: 0.07, legWidth: 0.055, footWidth: 0.09, tailLength: 1.3, foreBend: 1, hindBend: -1, spineElasticity: 0.16 }),
  horse: Object.freeze({ family: "equid", bodyWidth: 1.46, bodyHeight: 0.62, clearance: 0.9, shoulder: 1.12, haunch: 1.1, headScale: 0.43, neckLength: 0.72, headForward: 0.9, headRise: 0.4, frontUpper: 0.37, frontLower: 0.35, hindUpper: 0.39, hindLower: 0.35, distal: 0.12, legWidth: 0.062, footWidth: 0.09, tailLength: 0.9, foreBend: 1, hindBend: -1, spineElasticity: 0.1 }),
  dog: Object.freeze({ family: "canid", bodyWidth: 1.4, bodyHeight: 0.52, clearance: 0.72, shoulder: 1.08, haunch: 1.04, headScale: 0.42, neckLength: 0.24, headForward: 0.68, headRise: 0.2, frontUpper: 0.3, frontLower: 0.29, hindUpper: 0.35, hindLower: 0.32, distal: 0.14, legWidth: 0.062, footWidth: 0.105, tailLength: 0.78, foreBend: 1, hindBend: -1, spineElasticity: 0.14 }),
  goat: Object.freeze({ family: "goat", bodyWidth: 1.3, bodyHeight: 0.58, clearance: 0.78, shoulder: 1.08, haunch: 1, headScale: 0.42, neckLength: 0.34, headForward: 0.68, headRise: 0.32, frontUpper: 0.34, frontLower: 0.32, hindUpper: 0.36, hindLower: 0.33, distal: 0.11, legWidth: 0.062, footWidth: 0.08, tailLength: 0.32, foreBend: 1, hindBend: -1, spineElasticity: 0.07 }),
  rabbit: Object.freeze({ family: "rabbit", bodyWidth: 1.18, bodyHeight: 0.52, clearance: 0.58, shoulder: 0.78, haunch: 1.38, headScale: 0.5, neckLength: 0.08, headForward: 0.62, headRise: 0.24, frontUpper: 0.23, frontLower: 0.25, hindUpper: 0.42, hindLower: 0.38, distal: 0.11, legWidth: 0.055, footWidth: 0.12, tailLength: 0.18, foreBend: 1, hindBend: -1, spineElasticity: 0.18 }),
  camel: Object.freeze({ family: "camel", bodyWidth: 1.52, bodyHeight: 0.68, clearance: 0.96, shoulder: 1.04, haunch: 1.02, headScale: 0.4, neckLength: 1.02, headForward: 0.68, headRise: 0.76, frontUpper: 0.41, frontLower: 0.39, hindUpper: 0.42, hindLower: 0.4, distal: 0.11, legWidth: 0.07, footWidth: 0.15, tailLength: 0.56, foreBend: 1, hindBend: -1, spineElasticity: 0.05 }),
});

const ANIMAL_DEFINITIONS = Object.freeze({
  mouse: Object.freeze({
    id: "mouse", label: "Mouse", subtitle: "tiny paw percussion", description: "Tiny paws, round ears, a pointed muzzle and a long balancing tail.", defaultBehaviorId: "walk", behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.62, groundResonance: 0.38, outputLevel: 0.6, bodyScale: 0.38, morphology: MORPHOLOGY.mouse,
    palette: Object.freeze(["#a8998d", "#55483f", "#e6a79f", "#191310", "#e5d5c4"]), scale: Object.freeze([67, 70, 74, 79, 82, 86]),
    mass: 0.32, power: 0.65, compliance: 1.15, rollingResistance: 0.68, baseGravity: 9.8,
  }),
  dinosaur: Object.freeze({
    id: "dinosaur", label: "Triceratops", subtitle: "three-horn earth drums", description: "Broad frill, three horns, heavy shoulders and a tapered balancing tail.", defaultBehaviorId: "walk", behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.45, groundResonance: 0.72, outputLevel: 0.6, bodyScale: 1.12, morphology: MORPHOLOGY.dinosaur,
    palette: Object.freeze(["#839b79", "#3f5746", "#bdcda1", "#14251c", "#e5dbb7"]), scale: Object.freeze([33, 38, 41, 45, 50, 53]),
    mass: 1.65, power: 1.1, compliance: 0.65, rollingResistance: 1.4, baseGravity: 9.8,
  }),
  elephant: Object.freeze({
    id: "elephant",
    label: "Elephant",
    subtitle: "thick ground orchestra",
    description: "Four weighted feet. Deep ground impulses.",
    defaultBehaviorId: "walk",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.54,
    groundResonance: 0.72,
    outputLevel: 0.62,
    bodyScale: 1.12,
    morphology: MORPHOLOGY.elephant,
    palette: Object.freeze(["#d2b187", "#8e705b", "#ffae57", "#5a4037", "#f7ddbd"]),
    scale: Object.freeze([50, 53, 55, 58, 62, 65]),
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
    description: "Four prismatic hooves. Bright contact edges.",
    defaultBehaviorId: "canter",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.86,
    groundResonance: 0.84,
    outputLevel: 0.6,
    bodyScale: 0.98,
    morphology: MORPHOLOGY.unicorn,
    palette: Object.freeze(["#f9f2ff", "#ba87ff", "#58e8ef", "#ff83c9", "#ffe38a"]),
    scale: Object.freeze([62, 66, 69, 73, 78, 81]),
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
    description: "Quick feet. Dry, pitched earth strikes.",
    defaultBehaviorId: "sprint",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.68,
    groundResonance: 0.48,
    outputLevel: 0.62,
    bodyScale: 0.88,
    morphology: MORPHOLOGY.gazelle,
    palette: Object.freeze(["#e5b86d", "#6e4227", "#f3e8c3", "#141111", "#ed704f"]),
    scale: Object.freeze([57, 60, 64, 67, 69, 72]),
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
    description: "Quiet overlapping paws. Felt transients.",
    defaultBehaviorId: "cat-prowl",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.7,
    groundResonance: 0.42,
    outputLevel: 0.6,
    bodyScale: 0.8,
    morphology: MORPHOLOGY.cat,
    palette: Object.freeze(["#b8aaa0", "#5a4b46", "#f4b35d", "#171312", "#dce7df"]),
    scale: Object.freeze([55, 58, 62, 65, 69, 72]),
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
    description: "Fast claws. Gathered and extended flight.",
    defaultBehaviorId: "run-leap",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.82,
    groundResonance: 0.4,
    outputLevel: 0.62,
    bodyScale: 0.86,
    morphology: MORPHOLOGY.cheetah,
    palette: Object.freeze(["#e6b84f", "#70471f", "#ff713f", "#17100b", "#fff0b0"]),
    scale: Object.freeze([59, 62, 66, 69, 73, 78]),
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
    description: "Spotted long-neck body. Long weighted hooves.",
    defaultBehaviorId: "giraffe-walk",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.58,
    groundResonance: 0.62,
    outputLevel: 0.61,
    bodyScale: 1.02,
    morphology: MORPHOLOGY.giraffe,
    palette: Object.freeze(["#e8bd72", "#865426", "#f5d79b", "#24150b", "#8ed8c5"]),
    scale: Object.freeze([45, 50, 52, 57, 62, 64]),
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
    description: "Sprawled claws. Lateral scuttle timing.",
    defaultBehaviorId: "lizard-scuttle",
    behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.46,
    groundResonance: 0.54,
    outputLevel: 0.6,
    bodyScale: 0.72,
    morphology: MORPHOLOGY.lizard,
    palette: Object.freeze(["#70ae78", "#294f37", "#d8e65c", "#08150d", "#ef7f55"]),
    scale: Object.freeze([48, 51, 54, 58, 61, 66]),
    mass: 0.46,
    power: 0.82,
    compliance: 0.56,
    rollingResistance: 1.02,
    baseGravity: 9.8,
  }),
  horse: Object.freeze({
    id: "horse", label: "Horse", subtitle: "four-beat hoof engine", description: "Measured walk, diagonal trot, and three-beat canter families.", defaultBehaviorId: "walk", behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.62, groundResonance: 0.62, outputLevel: 0.61, bodyScale: 0.96, morphology: MORPHOLOGY.horse,
    palette: Object.freeze(["#a9764e", "#513222", "#e2b278", "#160e0a", "#f2d1aa"]), scale: Object.freeze([48, 52, 55, 60, 64, 67]),
    mass: 1.08, power: 1.14, compliance: 0.92, rollingResistance: 0.92, baseGravity: 9.8,
  }),
  dog: Object.freeze({
    id: "dog", label: "Dog", subtitle: "pad-and-claw runner", description: "Diagonal support shifts from walk into trot.", defaultBehaviorId: "walk", behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.76, groundResonance: 0.48, outputLevel: 0.61, bodyScale: 0.82, morphology: MORPHOLOGY.dog,
    palette: Object.freeze(["#b7865b", "#5e3b28", "#f0b86e", "#17100d", "#ead0b0"]), scale: Object.freeze([52, 55, 59, 62, 67, 71]),
    mass: 0.7, power: 1.12, compliance: 1.12, rollingResistance: 0.8, baseGravity: 10.1,
  }),
  goat: Object.freeze({
    id: "goat", label: "Goat", subtitle: "cloven stair drummer", description: "Sure-footed overlap with distinct load and push accents.", defaultBehaviorId: "walk", behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.6, groundResonance: 0.58, outputLevel: 0.61, bodyScale: 0.82, morphology: MORPHOLOGY.goat,
    palette: Object.freeze(["#c7b7a0", "#685848", "#f0c85c", "#17130f", "#efe6d8"]), scale: Object.freeze([50, 55, 57, 62, 65, 69]),
    mass: 0.72, power: 1.08, compliance: 0.86, rollingResistance: 0.9, baseGravity: 10.3,
  }),
  rabbit: Object.freeze({
    id: "rabbit", label: "Rabbit", subtitle: "haunch-and-flight rhythm", description: "Hind cluster, split forefeet, then suspension.", defaultBehaviorId: "rabbit-gallop", behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.72, groundResonance: 0.38, outputLevel: 0.6, bodyScale: 0.7, morphology: MORPHOLOGY.rabbit,
    palette: Object.freeze(["#c7c0b7", "#665d56", "#ff9ca8", "#171413", "#f7eee5"]), scale: Object.freeze([57, 60, 64, 67, 72, 76]),
    mass: 0.48, power: 1.2, compliance: 1.3, rollingResistance: 0.72, baseGravity: 10.2,
  }),
  camel: Object.freeze({
    id: "camel", label: "Bactrian camel", subtitle: "two-hump lateral pad pulse", description: "Two humps. Broad pads with walk and pace-like timing.", defaultBehaviorId: "walk", behaviorIds: ALL_BEHAVIOR_IDS,
    mood: 0.5, groundResonance: 0.56, outputLevel: 0.61, bodyScale: 0.98, morphology: MORPHOLOGY.camel,
    palette: Object.freeze(["#d6a966", "#795128", "#f0c980", "#21150b", "#f2ddb8"]), scale: Object.freeze([43, 48, 52, 55, 60, 64]),
    mass: 1.18, power: 0.86, compliance: 0.82, rollingResistance: 1.14, baseGravity: 9.7,
  }),
});

export const QUADRUPED_ANIMALS = Object.freeze(ALL_QUADRUPED_IDS.map((id) => ANIMAL_DEFINITIONS[id]));

const BEHAVIOR_HITS = Object.freeze({
  mosey: { "front-left": [[13, 0.6]], "front-right": [[5, 0.7]], "rear-left": [[8, 0.72]], "rear-right": [[0, 0.8]] },
  wander: { "front-left": [[12, 0.62]], "front-right": [[3, 0.5]], "rear-left": [[10, 0.7]], "rear-right": [[0, 0.76]] },
  drunk: { "front-left": [[5, 0.5], [13, 0.92]], "front-right": [[3, 1], [11, 0.48]], "rear-left": [[7, 0.87]], "rear-right": [[0, 0.7], [15, 0.48]] },
  tiptoe: { "front-left": [[12, 0.32]], "front-right": [[4, 0.3]], "rear-left": [[8, 0.4]], "rear-right": [[0, 0.38]] },
  "walk-leap": { "front-left": [[6, 0.62], [15, 0.8]], "front-right": [[2, 0.64], [14, 1]], "rear-left": [[4, 0.7], [8, 1]], "rear-right": [[0, 0.72], [8, 1]] },
  cartwheel: { "front-left": [[5, 0.82]], "front-right": [[2, 0.94]], "rear-left": [[13, 0.92]], "rear-right": [[10, 0.86]] },
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
    "front-left": Object.freeze([[4, 0.92]]),
    "front-right": Object.freeze([[8, 1]]),
    "rear-left": Object.freeze([[0, 0.92]]),
    "rear-right": Object.freeze([[3, 0.96]]),
    tail: Object.freeze([[13, 0.72], [15, 0.56]]),
  }),
  "counter-gallop": Object.freeze({
    "front-left": Object.freeze([[8, 1]]),
    "front-right": Object.freeze([[4, 0.92]]),
    "rear-left": Object.freeze([[3, 0.96]]),
    "rear-right": Object.freeze([[0, 0.92]]),
    tail: Object.freeze([[13, 0.72], [15, 0.56]]),
  }),
  sprint: Object.freeze({
    "front-left": Object.freeze([[7, 0.94]]),
    "front-right": Object.freeze([[10, 1]]),
    "rear-left": Object.freeze([[2, 0.96]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[5, 0.62], [13, 0.82]]),
  }),
  "rotary-left": Object.freeze({
    "front-left": Object.freeze([[10, 1]]),
    "front-right": Object.freeze([[7, 0.94]]),
    "rear-left": Object.freeze([[0, 1]]),
    "rear-right": Object.freeze([[2, 0.96]]),
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
  leap: Object.freeze({
    "front-left": Object.freeze([[11, 1]]),
    "front-right": Object.freeze([[10, 0.94]]),
    "rear-left": Object.freeze([[0, 1]]),
    "rear-right": Object.freeze([[0, 0.98]]),
    tail: Object.freeze([[4, 0.82], [13, 0.54]]),
  }),
  skid: Object.freeze({
    "front-left": Object.freeze([[15, 0.7]]),
    "front-right": Object.freeze([[14, 0.8]]),
    "rear-left": Object.freeze([[0, 1]]),
    "rear-right": Object.freeze([[0, 1]]),
    tail: Object.freeze([[4, 0.62], [8, 0.78], [12, 0.7]]),
  }),
  "forward-roll": Object.freeze({
    "front-left": Object.freeze([[13, 1]]),
    "front-right": Object.freeze([[12, 0.96]]),
    "rear-left": Object.freeze([[0, 1]]),
    "rear-right": Object.freeze([[0, 0.98]]),
    tail: Object.freeze([[4, 0.92], [11, 0.72]]),
  }),
  "rear-up": Object.freeze({
    "front-left": Object.freeze([]),
    "front-right": Object.freeze([]),
    "rear-left": Object.freeze([[0, 1], [8, 0.94]]),
    "rear-right": Object.freeze([[0, 0.94], [8, 1]]),
    tail: Object.freeze([[3, 0.7], [7, 0.88], [11, 0.76], [15, 1]]),
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
    "front-left": Object.freeze([[6, 0.94]]),
    "front-right": Object.freeze([[7, 1]]),
    "rear-left": Object.freeze([[1, 0.96]]),
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
  "rabbit-gallop": Object.freeze({
    "front-left": Object.freeze([[5, 0.92]]),
    "front-right": Object.freeze([[7, 0.96]]),
    "rear-left": Object.freeze([[0, 1]]),
    "rear-right": Object.freeze([[1, 0.98]]),
    tail: Object.freeze([]),
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
    "front-right": Object.freeze([[13, 1]]),
    "rear-left": Object.freeze([[3, 0.96]]),
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
  mosey: Object.freeze({ lift: 0.38, bounce: 0.12, aerial: 0, sway: 0.26, stride: 0.64, momentum: 0.72, gravity: 1 }),
  wander: Object.freeze({ lift: 0.54, bounce: 0.15, aerial: 0, sway: 0.42, stride: 0.7, momentum: 0.62, gravity: 1 }),
  drunk: Object.freeze({ lift: 0.7, bounce: 0.3, aerial: 0.08, sway: 0.85, stride: 0.82, momentum: 1, gravity: 1 }),
  tiptoe: Object.freeze({ lift: 0.92, bounce: 0.08, aerial: 0, sway: 0.06, stride: 0.58, momentum: 0.58, gravity: 1 }),
  "walk-leap": Object.freeze({ lift: 1.15, bounce: 0.65, aerial: 1, sway: 0.08, stride: 1, momentum: 0.9, gravity: 0.9 }),
  cartwheel: Object.freeze({ lift: 1, bounce: 0.3, aerial: 0.25, sway: 0, stride: 1, momentum: 0.9, gravity: 1 }),
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
  leap: Object.freeze({ lift: 1.15, bounce: 0.8, aerial: 1, sway: 0.08, stride: 1.25, momentum: 0.92, gravity: 0.86 }),
  skid: Object.freeze({ lift: 0.18, bounce: 0.08, aerial: 0, sway: 0.12, stride: 0.9, momentum: 1.15, gravity: 1.1 }),
  "forward-roll": Object.freeze({ lift: 1.18, bounce: 0.78, aerial: 1, sway: 0.08, stride: 1, momentum: 0.9, gravity: 0.86 }),
  "rear-up": Object.freeze({ lift: 0.9, bounce: 0.18, aerial: 0.04, sway: 0.28, stride: 0.58, momentum: 0.62, gravity: 1.08 }),
  charge: Object.freeze({ lift: 0.62, bounce: 0.27, aerial: 0, sway: 0.2, stride: 0.94, momentum: 0.82, gravity: 1.12 }),
  dance: Object.freeze({ lift: 0.72, bounce: 0.36, aerial: 0.12, sway: 0.48, stride: 0.86, momentum: 0.7, gravity: 1 }),
  "rear-waltz": Object.freeze({ lift: 0.9, bounce: 0.48, aerial: 0.18, sway: 0.58, stride: 0.68, momentum: 0.66, gravity: 1.06 }),
  carousel: Object.freeze({ lift: 0.58, bounce: 0.24, aerial: 0, sway: 0.42, stride: 0.74, momentum: 0.74, gravity: 1.04 }),
  "cat-prowl": Object.freeze({ lift: 0.38, bounce: 0.1, aerial: 0, sway: 0.16, stride: 0.82, momentum: 0.86, gravity: 1.02 }),
  "cat-gallop": Object.freeze({ lift: 1.02, bounce: 0.56, aerial: 0.64, sway: 0.24, stride: 1.2, momentum: 0.92, gravity: 0.94 }),
  "run-leap": Object.freeze({ lift: 1.12, bounce: 0.62, aerial: 0.92, sway: 0.26, stride: 1.28, momentum: 0.96, gravity: 0.88 }),
  "rabbit-gallop": Object.freeze({ lift: 1.02, bounce: 0.58, aerial: 0.7, sway: 0.18, stride: 1.08, momentum: 0.9, gravity: 0.94 }),
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
  return behavior.nativeAnimalIds.includes(animal.id) ? "observed" : "playful";
}

export function quadrupedMotion(behaviorId = "walk") {
  return BEHAVIOR_MOTION[behaviorDefinition(behaviorId).id] ?? BEHAVIOR_MOTION.walk;
}

export function quadrupedGaitProfile(behaviorId = "walk", animalId = "elephant") {
  const behavior = behaviorDefinition(behaviorId, animalId);
  const profile = GAIT_DUTY_FACTORS[behavior.id] ?? GAIT_DUTY_FACTORS.walk;
  return Object.freeze({
    behaviorId: behavior.id,
    frontDutyFactor: profile.front,
    hindDutyFactor: profile.hind,
    basis: profile.basis,
  });
}

export function quadrupedFootVoice(animalId = "elephant", laneId = "front-left") {
  const animal = quadrupedAnimal(animalId);
  return QUADRUPED_FOOT_VOICES[animal.id]?.[laneId] ?? QUADRUPED_FOOT_VOICES.elephant["front-left"];
}

export function quadrupedTerrain(id = "earth") {
  return QUADRUPED_TERRAINS.find((entry) => entry.id === id) ?? QUADRUPED_TERRAINS[0];
}

export function quadrupedGroundProfile(id = "level") {
  return QUADRUPED_GROUND_PROFILES.find((entry) => entry.id === id) ?? QUADRUPED_GROUND_PROFILES[0];
}

const SUSPENSION_WINDOWS = Object.freeze({
  leap: [4, 10],
  "walk-leap": [11, 14],
  "run-leap": [14, 15],
  "forward-roll": [4, 12],
  skid: [2, 14],
});
const timingCache = new WeakMap();

// Each cabinet card occupies musical time. Pace scales the footwork; extra
// suspension adds whole global beats without changing BPM or repeating attacks.
export function quadrupedScoreTiming(state) {
  const ratio = QUADRUPED_PACE_RATIOS.includes(Number(state?.paceRatio)) ? Number(state.paceRatio) : 1;
  const extra = clamp(state?.suspensionBeats ?? 2, 0, 8);
  const key = `${state?.behaviorId}:${ratio}:${extra}`;
  const cached = state && timingCache.get(state);
  if (cached?.key === key) return cached;
  const window = SUSPENSION_WINDOWS[state?.behaviorId] ?? null;
  const durations = Array.from({ length: QUADRUPED_STEP_COUNT }, (_, frame) => (
    1 / ratio + (window && frame >= window[0] && frame < window[1]
      ? extra * QUADRUPED_STEP_COUNT / (window[1] - window[0]) : 0)
  ));
  const boundaries = [0];
  for (const duration of durations) boundaries.push(boundaries.at(-1) + duration);
  const timing = Object.freeze({ key, durations: Object.freeze(durations), boundaries: Object.freeze(boundaries), clockFrames: boundaries.at(-1), beats: boundaries.at(-1) / 16, window });
  if (state && typeof state === "object") timingCache.set(state, timing);
  return timing;
}

export function quadrupedClockAtPosition(state, position = 0) {
  const timing = quadrupedScoreTiming(state);
  const safePosition = Number.isFinite(Number(position)) ? Number(position) : 0;
  const cycle = Math.floor(safePosition / 16);
  const local = mod(safePosition, 16);
  const frame = Math.floor(local);
  return cycle * timing.clockFrames + timing.boundaries[frame] + (local - frame) * timing.durations[frame];
}

export function quadrupedPositionAtClock(state, clock = 0) {
  const timing = quadrupedScoreTiming(state);
  const safeClock = Number.isFinite(Number(clock)) ? Number(clock) : 0;
  const cycle = Math.floor(safeClock / timing.clockFrames);
  const local = mod(safeClock, timing.clockFrames);
  let frame = 0;
  while (frame < 15 && timing.boundaries[frame + 1] <= local + 1e-10) frame += 1;
  return cycle * 16 + frame + (local - timing.boundaries[frame]) / timing.durations[frame];
}

export function quadrupedBodySlide(state, position) {
  if (state?.behaviorId !== "skid") return 0;
  const local = mod(Number(position) || 0, 16);
  return minimumJerk(clamp((local - 1.6) / 0.8)) * minimumJerk(clamp((14 - local) / 0.8));
}

export function quadrupedFlightTrajectory(state, position, support = quadrupedSupportSnapshot(state, position)) {
  if (support.supportCount || quadrupedBodySlide(state, position) > 0) return null;
  const feet = Object.values(support.legs).filter((foot) => Number.isFinite(foot.previousTouchdownPosition));
  if (!feet.length) return null;
  const start = Math.max(...feet.map((foot) => foot.previousTouchdownPosition + foot.stanceDuration));
  const end = Math.min(...feet.map((foot) => foot.nextTouchdownPosition));
  if (end <= start || position < start || position > end) return null;
  const duration = (quadrupedClockAtPosition(state, end) - quadrupedClockAtPosition(state, start)) * 60 / (16 * clamp(state.tempoBpm, 42, 196));
  const progress = clamp((quadrupedClockAtPosition(state, position) - quadrupedClockAtPosition(state, start)) * 60 / (16 * clamp(state.tempoBpm, 42, 196)) / Math.max(0.001, duration));
  // A bounded ballistic-shaped arc: long musical rests are intentional slow
  // motion, not a claim of real-world multi-second jumps under Earth gravity.
  const apex = Math.min(1.55, 9.8 * duration * duration / 8) / Math.sqrt(clamp(state.gravity, 0.55, 1.55));
  return Object.freeze({ start, end, progress, duration, height: 4 * apex * progress * (1 - progress), verticalVelocity: 4 * apex * (1 - 2 * progress) / Math.max(0.001, duration) });
}

export function quadrupedGroundHeightAtWorldX(profileId = "level", worldX = 0) {
  const profile = quadrupedGroundProfile(profileId);
  const x = Number.isFinite(Number(worldX)) ? Number(worldX) : 0;
  if (profile.direction === 0 || profile.stepHeight === 0) return 0;
  return Math.floor(x / profile.treadLength) * profile.stepHeight * profile.direction;
}

export function quadrupedGroundAnchorX(profileId = "level", desiredWorldX = 0) {
  const profile = quadrupedGroundProfile(profileId);
  const x = Number.isFinite(Number(desiredWorldX)) ? Number(desiredWorldX) : 0;
  if (profile.direction === 0) return x;
  const treadIndex = Math.floor(x / profile.treadLength);
  const treadStart = treadIndex * profile.treadLength;
  const inset = profile.treadLength * 0.13;
  return treadStart + clamp(x - treadStart, inset, profile.treadLength - inset);
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
              : animalId === "rabbit" ? 1.04
                : animalId === "camel" ? 0.9
                  : animalId === "dog" ? 0.92
                    : animalId === "goat" ? 0.86
                      : 1;
  return clamp(behavior.stride * animalScale, ...QUADRUPED_LIMITS.stride);
}

export function createQuadrupedState(animalId = "elephant", behaviorId = null) {
  const animal = quadrupedAnimal(animalId);
  const behavior = behaviorDefinition(behaviorId ?? animal.defaultBehaviorId, animal.id);
  return {
    version: 7,
    animalId: animal.id,
    behaviorId: behavior.id,
    tempoBpm: QUADRUPED_DEFAULT_TEMPO_BPM,
    paceRatio: 1,
    suspensionBeats: 2,
    stride: defaultStride(animal.id, behavior.id),
    momentum: quadrupedMotion(behavior.id).momentum,
    gravity: quadrupedMotion(behavior.id).gravity,
    mood: animal.mood,
    groundResonance: animal.groundResonance,
    outputLevel: animal.outputLevel,
    pattern: authoredPattern(animal.id, behavior.id),
    surfaceId: "earth",
    groundProfileId: "level",
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
  const validTerrainIds = new Set(QUADRUPED_TERRAINS.map(({ id }) => id));
  const legacySurface = Array.isArray(source.terrain) ? source.terrain.find((id) => validTerrainIds.has(id)) : null;
  const requestedSurface = source.surfaceId ?? source.terrainId ?? legacySurface
    ?? fallback?.surfaceId ?? "earth";
  const surfaceId = validTerrainIds.has(requestedSurface) ? requestedSurface : "earth";
  const validGroundProfileIds = new Set(QUADRUPED_GROUND_PROFILES.map(({ id }) => id));
  const requestedGroundProfile = source.groundProfileId ?? fallback?.groundProfileId ?? "level";
  const groundProfileId = validGroundProfileIds.has(requestedGroundProfile) ? requestedGroundProfile : "level";
  const seed = Number.isFinite(Number(source.mutationSeed))
    ? Number(source.mutationSeed) >>> 0
    : Number(fallback?.mutationSeed ?? 0x51414452) >>> 0;
  return {
    version: 7,
    animalId: animal.id,
    behaviorId: behavior.id,
    tempoBpm: clamp(source.tempoBpm ?? fallback?.tempoBpm ?? QUADRUPED_DEFAULT_TEMPO_BPM, ...QUADRUPED_LIMITS.tempoBpm),
    paceRatio: QUADRUPED_PACE_RATIOS.includes(Number(source.paceRatio ?? fallback?.paceRatio)) ? Number(source.paceRatio ?? fallback.paceRatio) : 1,
    suspensionBeats: clamp(source.suspensionBeats ?? fallback?.suspensionBeats ?? 2, 0, 8),
    stride: clamp(source.stride ?? fallback?.stride ?? defaultStride(animal.id, behavior.id), ...QUADRUPED_LIMITS.stride),
    momentum: clamp(source.momentum ?? fallback?.momentum ?? quadrupedMotion(behavior.id).momentum, ...QUADRUPED_LIMITS.momentum),
    gravity: clamp(source.gravity ?? fallback?.gravity ?? quadrupedMotion(behavior.id).gravity, ...QUADRUPED_LIMITS.gravity),
    mood: clamp(source.mood ?? fallback?.mood ?? animal.mood, ...QUADRUPED_LIMITS.mood),
    groundResonance: clamp(source.groundResonance ?? fallback?.groundResonance ?? animal.groundResonance, ...QUADRUPED_LIMITS.groundResonance),
    outputLevel: clamp(source.outputLevel ?? fallback?.outputLevel ?? animal.outputLevel, ...QUADRUPED_LIMITS.outputLevel),
    pattern: sanitizedPattern(source.pattern, fallbackPattern),
    surfaceId,
    groundProfileId,
    customized: Boolean(source.customized ?? fallback?.customized ?? false),
    mutationSeed: seed || 1,
  };
}

export function applyQuadrupedAnimal(state, animalId) {
  const next = createQuadrupedState(animalId, state?.behaviorId);
  return sanitizeQuadrupedState({
    ...next,
    pattern: state?.pattern ?? next.pattern,
    customized: state?.customized ?? false,
    paceRatio: state?.paceRatio ?? 1,
    suspensionBeats: state?.suspensionBeats ?? 2,
    tempoBpm: state?.tempoBpm ?? next.tempoBpm,
    outputLevel: state?.outputLevel ?? next.outputLevel,
    surfaceId: state?.surfaceId ?? next.surfaceId,
    groundProfileId: state?.groundProfileId ?? next.groundProfileId,
  }, next);
}

export function applyQuadrupedBehavior(state, behaviorId) {
  const current = sanitizeQuadrupedState(state);
  const next = createQuadrupedState(current.animalId, behaviorId);
  return sanitizeQuadrupedState({
    ...next,
    tempoBpm: current.tempoBpm,
    paceRatio: current.paceRatio,
    suspensionBeats: current.suspensionBeats,
    mood: current.mood,
    groundResonance: current.groundResonance,
    outputLevel: current.outputLevel,
    surfaceId: current.surfaceId,
    groundProfileId: current.groundProfileId,
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
  const terrainIndex = Math.max(0, QUADRUPED_TERRAINS.findIndex(({ id }) => id === current.surfaceId));
  const nextTerrain = QUADRUPED_TERRAINS[mod(terrainIndex + stepDirection(direction), QUADRUPED_TERRAINS.length)].id;
  return sanitizeQuadrupedState({
    ...current,
    customized: true,
    surfaceId: nextTerrain,
  }, current);
}

export function setQuadrupedSurface(state, surfaceId) {
  const current = sanitizeQuadrupedState(state);
  return sanitizeQuadrupedState({ ...current, surfaceId }, current);
}

export function setQuadrupedGroundProfile(state, groundProfileId) {
  const current = sanitizeQuadrupedState(state);
  return sanitizeQuadrupedState({ ...current, groundProfileId }, current);
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
    const activeSteps = pattern[lane.id]
      .map((value, step) => ({ value, step }))
      .filter(({ value }) => value > 0);
    if (!activeSteps.length) continue;
    let chosenRandom;
    [cursor, chosenRandom] = nextRandom(cursor);
    const chosen = activeSteps[Math.floor(chosenRandom * activeSteps.length)];
    let strengthRandom;
    [cursor, strengthRandom] = nextRandom(cursor);
    pattern[lane.id][chosen.step] = clamp(chosen.value + (strengthRandom - 0.5) * 0.22);
  }
  return sanitizeQuadrupedState({ ...current, pattern, customized: true, mutationSeed: cursor || 1 }, current);
}

export function clearQuadrupedPattern(state) {
  const current = sanitizeQuadrupedState(state);
  return sanitizeQuadrupedState({ ...current, pattern: emptyPattern(), customized: true }, current);
}

export function quadrupedStepDurationSeconds(state, frame = 0) {
  const tempoBpm = clamp(state?.tempoBpm, ...QUADRUPED_LIMITS.tempoBpm);
  const duration = quadrupedScoreTiming(state).durations[mod(Math.floor(Number(frame) || 0), QUADRUPED_STEP_COUNT)];
  return duration * 60 / tempoBpm / QUADRUPED_STEP_COUNT;
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
  const terrain = quadrupedTerrain(safe.surfaceId);
  const footContacts = contacts;
  const footEnergy = footContacts.reduce((sum, { intensity }) => sum + intensity, 0);
  const totalEnergy = footEnergy;
  const foreEnergy = footContacts.filter(({ id }) => id.startsWith("front")).reduce((sum, { intensity }) => sum + intensity, 0);
  const rearEnergy = Math.max(0, footEnergy - foreEnergy);
  const head = forceHead ? headPhraseFromEvent(safe, step, terrain, footEnergy, totalEnergy, true) : null;
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

function minimumJerk(progress) {
  const u = clamp(progress);
  return u * u * u * (10 + u * (-15 + u * 6));
}

export function solveQuadrupedLimbJoint(rootX, rootY, endX, endY, upperLength, lowerLength, bendDirection = 1) {
  const safeRootX = Number.isFinite(Number(rootX)) ? Number(rootX) : 0;
  const safeRootY = Number.isFinite(Number(rootY)) ? Number(rootY) : 0;
  const safeEndX = Number.isFinite(Number(endX)) ? Number(endX) : safeRootX;
  const safeEndY = Number.isFinite(Number(endY)) ? Number(endY) : safeRootY + 1;
  const upper = Math.max(0.001, Math.abs(Number(upperLength) || 0));
  const lower = Math.max(0.001, Math.abs(Number(lowerLength) || 0));
  const dx = safeEndX - safeRootX;
  const dy = safeEndY - safeRootY;
  const rawDistance = Math.hypot(dx, dy);
  const minimumReach = Math.abs(upper - lower) + 0.000001;
  const maximumReach = Math.max(minimumReach, upper + lower - 0.000001);
  const distance = clamp(rawDistance, minimumReach, maximumReach);
  const ux = rawDistance > 0.000001 ? dx / rawDistance : 0;
  const uy = rawDistance > 0.000001 ? dy / rawDistance : 1;
  const constrainedEndX = safeRootX + ux * distance;
  const constrainedEndY = safeRootY + uy * distance;
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const side = Number(bendDirection) < 0 ? -1 : 1;
  return Object.freeze({
    x: safeRootX + ux * along - uy * height * side,
    y: safeRootY + uy * along + ux * height * side,
    endX: constrainedEndX,
    endY: constrainedEndY,
    upperLength: upper,
    lowerLength: lower,
    distance,
    reached: Math.abs(distance - rawDistance) < 0.00001,
  });
}

// Solve a fixed upper + lower + distal chain while preserving the requested
// foot contact whenever the three authored segments can reach it. The distal
// hint chooses an anatomical ankle orientation; circle intersection supplies
// the nearest valid orientation when that hint would stretch the limb.
export function solveQuadrupedLimbChain(
  rootX,
  rootY,
  footX,
  footY,
  upperLength,
  lowerLength,
  distalLength,
  bendDirection = 1,
  distalHintX = 0,
  distalHintY = -1,
) {
  const safeRootX = Number.isFinite(Number(rootX)) ? Number(rootX) : 0;
  const safeRootY = Number.isFinite(Number(rootY)) ? Number(rootY) : 0;
  const requestedFootX = Number.isFinite(Number(footX)) ? Number(footX) : safeRootX;
  const requestedFootY = Number.isFinite(Number(footY)) ? Number(footY) : safeRootY + 1;
  const upper = Math.max(0.001, Math.abs(Number(upperLength) || 0));
  const lower = Math.max(0.001, Math.abs(Number(lowerLength) || 0));
  const distal = Math.max(0.001, Math.abs(Number(distalLength) || 0));
  const requestedDx = requestedFootX - safeRootX;
  const requestedDy = requestedFootY - safeRootY;
  const requestedDistance = Math.hypot(requestedDx, requestedDy);
  const ux = requestedDistance > 0.000001 ? requestedDx / requestedDistance : 0;
  const uy = requestedDistance > 0.000001 ? requestedDy / requestedDistance : 1;
  const maximumReach = Math.max(0.000001, upper + lower + distal - 0.000003);
  const minimumReach = Math.max(
    0.000001,
    upper - lower - distal,
    lower - upper - distal,
    distal - upper - lower,
  ) + 0.000001;
  const footDistance = clamp(requestedDistance, minimumReach, maximumReach);
  const constrainedFootX = safeRootX + ux * footDistance;
  const constrainedFootY = safeRootY + uy * footDistance;

  const rawHintLength = Math.hypot(Number(distalHintX) || 0, Number(distalHintY) || 0);
  const hintX = rawHintLength > 0.000001 ? Number(distalHintX) / rawHintLength : 0;
  const hintY = rawHintLength > 0.000001 ? Number(distalHintY) / rawHintLength : -1;
  const preferredAnkleX = constrainedFootX + hintX * distal;
  const preferredAnkleY = constrainedFootY + hintY * distal;
  const preferredDistance = Math.hypot(preferredAnkleX - safeRootX, preferredAnkleY - safeRootY);
  const minimumJointReach = Math.abs(upper - lower) + 0.000001;
  const maximumJointReach = Math.max(minimumJointReach, upper + lower - 0.000001);
  let ankleX = preferredAnkleX;
  let ankleY = preferredAnkleY;

  if (preferredDistance < minimumJointReach || preferredDistance > maximumJointReach) {
    const circleMinimum = Math.abs(footDistance - distal) + 0.000001;
    const circleMaximum = Math.max(circleMinimum, footDistance + distal - 0.000001);
    const targetDistance = clamp(
      preferredDistance,
      Math.max(minimumJointReach, circleMinimum),
      Math.min(maximumJointReach, circleMaximum),
    );
    const along = footDistance > 0.000001
      ? (targetDistance * targetDistance - distal * distal + footDistance * footDistance) / (2 * footDistance)
      : 0;
    const height = Math.sqrt(Math.max(0, targetDistance * targetDistance - along * along));
    const baseX = safeRootX + ux * along;
    const baseY = safeRootY + uy * along;
    const candidateA = { x: baseX - uy * height, y: baseY + ux * height };
    const candidateB = { x: baseX + uy * height, y: baseY - ux * height };
    const distanceA = Math.hypot(candidateA.x - preferredAnkleX, candidateA.y - preferredAnkleY);
    const distanceB = Math.hypot(candidateB.x - preferredAnkleX, candidateB.y - preferredAnkleY);
    const selected = distanceA <= distanceB ? candidateA : candidateB;
    ankleX = selected.x;
    ankleY = selected.y;
  }

  const joint = solveQuadrupedLimbJoint(
    safeRootX,
    safeRootY,
    ankleX,
    ankleY,
    upper,
    lower,
    bendDirection,
  );
  return Object.freeze({
    kneeX: joint.x,
    kneeY: joint.y,
    ankleX: joint.endX,
    ankleY: joint.endY,
    footX: constrainedFootX,
    footY: constrainedFootY,
    upperLength: upper,
    lowerLength: lower,
    distalLength: distal,
    reached: joint.reached && Math.abs(footDistance - requestedDistance) < 0.00001,
  });
}

function neutralFootX(laneId, animalId) {
  const fore = laneId.startsWith("front");
  const left = laneId.endsWith("left");
  const morphology = quadrupedAnimal(animalId).morphology ?? MORPHOLOGY.elephant;
  const reach = morphology.bodyWidth * (morphology.family === "lizard" ? 0.52 : 0.49);
  return (fore ? reach : -reach) + (left ? -0.075 : 0.075);
}

function footCycleStateFromSafe(safe, laneId, absolutePosition) {
  const numericPosition = Number(absolutePosition);
  const unwrappedPosition = Number.isFinite(numericPosition) ? numericPosition : 0;
  const position = mod(unwrappedPosition, QUADRUPED_STEP_COUNT);
  const wholeStep = Math.floor(position);
  const fraction = position - wholeStep;
  const lanePattern = safe.pattern[laneId] ?? [];
  const bodyWorldX = unwrappedPosition / QUADRUPED_STEP_COUNT * safe.stride;
  const bodyGroundHeight = quadrupedGroundHeightAtWorldX(safe.groundProfileId, bodyWorldX);
  const neutralX = neutralFootX(laneId, safe.animalId);
  let previous = null;
  let next = null;
  for (let lag = 0; lag < QUADRUPED_STEP_COUNT; lag += 1) {
    const step = mod(wholeStep - lag, QUADRUPED_STEP_COUNT);
    const intensity = lanePattern[step] ?? 0;
    if (intensity > 0) {
      previous = { age: lag + fraction, intensity, step };
      break;
    }
  }
  for (let lead = 1; lead <= QUADRUPED_STEP_COUNT; lead += 1) {
    const step = mod(wholeStep + lead, QUADRUPED_STEP_COUNT);
    const intensity = lanePattern[step] ?? 0;
    if (intensity > 0) {
      next = { distance: lead - fraction, intensity, step };
      break;
    }
  }
  if (!previous || !next) {
    const neutralWorldX = quadrupedGroundAnchorX(safe.groundProfileId, bodyWorldX + neutralX);
    const neutralWorldY = quadrupedGroundHeightAtWorldX(safe.groundProfileId, neutralWorldX);
    return Object.freeze({
      laneId,
      eventId: null,
      intensity: 0,
      contact: 0,
      grounded: false,
      load: 0,
      propulsion: 0,
      impact: 0,
      touchdown: false,
      lift: 0.18,
      swing: neutralX,
      footX: neutralX,
      footWorldX: neutralWorldX,
      footWorldY: neutralWorldY,
      anchorWorldX: null,
      anchorWorldY: null,
      nextAnchorWorldX: null,
      nextAnchorWorldY: null,
      bodyWorldX,
      bodyGroundHeight,
      stanceProgress: 1,
      swingProgress: 0.5,
      dutyFactor: 0,
      cycleSteps: QUADRUPED_STEP_COUNT,
      stanceDuration: 0,
      previousTouchdownPosition: null,
      nextTouchdownPosition: null,
    });
  }
  const cycleSteps = Math.max(0.5, previous.age + next.distance);
  const profile = quadrupedGaitProfile(safe.behaviorId, safe.animalId);
  const dutyFactor = laneId.startsWith("front") ? profile.frontDutyFactor : profile.hindDutyFactor;
  const direction = quadrupedGroundProfile(safe.groundProfileId).direction;
  const fore = laneId.startsWith("front");
  const stairDuty = direction > 0 ? (fore ? 1.02 : 1.14) : direction < 0 ? (fore ? 1.14 : 1.02) : 1;
  const stanceDuration = clamp(cycleSteps * dutyFactor * stairDuty, 0.28, Math.max(0.3, cycleSteps - 0.08));
  const previousTouchdownPosition = unwrappedPosition - previous.age;
  const nextTouchdownPosition = unwrappedPosition + next.distance;
  const requestedAnchorWorldX = previousTouchdownPosition / QUADRUPED_STEP_COUNT * safe.stride + neutralX;
  const requestedNextAnchorWorldX = nextTouchdownPosition / QUADRUPED_STEP_COUNT * safe.stride + neutralX;
  const anchorWorldX = quadrupedGroundAnchorX(safe.groundProfileId, requestedAnchorWorldX);
  const nextAnchorWorldX = quadrupedGroundAnchorX(safe.groundProfileId, requestedNextAnchorWorldX);
  const anchorWorldY = quadrupedGroundHeightAtWorldX(safe.groundProfileId, anchorWorldX);
  const nextAnchorWorldY = quadrupedGroundHeightAtWorldX(safe.groundProfileId, nextAnchorWorldX);
  const touchdown = previous.age < 0.0001;
  const impact = previous.intensity * Math.exp(-previous.age * 11);
  const grounded = previous.age < stanceDuration;
  let stanceProgress = 1;
  let swingProgress = 0;
  let footWorldX = anchorWorldX;
  let footWorldY = anchorWorldY;
  let lift = 0;
  let contact = 0;
  let load = 0;
  let propulsion = 0;
  if (grounded) {
    stanceProgress = clamp(previous.age / stanceDuration);
    const release = stanceProgress > 0.92 ? clamp((1 - stanceProgress) / 0.08) : 1;
    const verticalArc = 0.34 + Math.sin(Math.PI * stanceProgress) * 0.66;
    contact = previous.intensity * release;
    const weightShift = direction < 0 ? (fore ? 1.35 : 0.8) : direction > 0 ? (fore ? 0.84 : 1.3) : 1;
    load = contact * verticalArc * weightShift;
    const driveBias = laneId.startsWith("front") ? 0.72 : 1.16;
    propulsion = load * driveBias * (0.42 + 0.58 * stanceProgress) * (direction > 0 && !fore ? 1.35 : 1);
  } else {
    const swingDuration = Math.max(0.08, cycleSteps - stanceDuration);
    swingProgress = clamp((previous.age - stanceDuration) / swingDuration);
    const pathProgress = minimumJerk(swingProgress);
    footWorldX = anchorWorldX + (nextAnchorWorldX - anchorWorldX) * pathProgress;
    footWorldY = anchorWorldY + (nextAnchorWorldY - anchorWorldY) * pathProgress;
    lift = Math.sin(Math.PI * swingProgress) ** 2 * quadrupedGroundProfile(safe.groundProfileId).clearanceScale;
  }
  const footX = footWorldX - bodyWorldX;
  const cycleOrdinal = Math.round((previousTouchdownPosition - previous.step) / QUADRUPED_STEP_COUNT);
  return Object.freeze({
    laneId,
    eventId: `${laneId}:${cycleOrdinal}:${previous.step}`,
    intensity: previous.intensity,
    contact,
    grounded,
    load,
    propulsion,
    impact,
    touchdown,
    lift,
    swing: footX,
    footX,
    footWorldX,
    footWorldY,
    anchorWorldX,
    anchorWorldY,
    nextAnchorWorldX,
    nextAnchorWorldY,
    bodyWorldX,
    bodyGroundHeight,
    stanceProgress,
    swingProgress,
    dutyFactor,
    cycleSteps,
    stanceDuration,
    previousTouchdownPosition,
    nextTouchdownPosition,
  });
}

export function quadrupedFootCycleState(state, laneId, absolutePosition = 0) {
  const safe = sanitizeQuadrupedState(state);
  if (!QUADRUPED_LANES.some(({ id }) => id === laneId)) {
    return footCycleStateFromSafe(safe, QUADRUPED_LANES[0].id, absolutePosition);
  }
  return footCycleStateFromSafe(safe, laneId, absolutePosition);
}

export function quadrupedSupportSnapshot(state, absolutePosition = 0) {
  const safe = sanitizeQuadrupedState(state);
  const legs = Object.fromEntries(QUADRUPED_LANES.map(({ id }) => [
    id,
    footCycleStateFromSafe(safe, id, absolutePosition),
  ]));
  const values = Object.values(legs);
  const bodyWorldX = values[0]?.bodyWorldX ?? 0;
  const profile = quadrupedGroundProfile(safe.groundProfileId);
  // A regular stair is discontinuous under each foot, but the animal's body
  // follows the continuous grade through those treads. This prevents the body
  // from snapping when the set of supporting feet changes.
  const courseSlope = clamp(profile.direction * profile.stepHeight / profile.treadLength, -0.65, 0.65);
  const bodyGroundHeight = courseSlope * bodyWorldX;
  return Object.freeze({
    legs: Object.freeze(legs),
    supportCount: values.filter(({ grounded }) => grounded).length,
    supportEnergy: values.reduce((sum, { load }) => sum + load, 0),
    propulsion: values.reduce((sum, leg) => sum + leg.propulsion, 0),
    bodyWorldX,
    bodyGroundHeight,
    supportSlope: courseSlope,
  });
}

export function deriveQuadrupedPose(state, sequencePosition = 0, motorSnapshot = null) {
  const safe = sanitizeQuadrupedState(state);
  const numericPosition = Number(sequencePosition);
  const absolutePosition = Number.isFinite(numericPosition) ? numericPosition : 0;
  const position = mod(absolutePosition, QUADRUPED_STEP_COUNT);
  const step = Math.floor(position);
  const phase = position - step;
  const cycleProgress = position / QUADRUPED_STEP_COUNT;
  const bodySlide = quadrupedBodySlide(safe, absolutePosition);
  const cartwheel = safe.behaviorId === "cartwheel" ? minimumJerk(cycleProgress) : 0;
  const stagger = safe.behaviorId === "drunk" ? Math.sin(cycleProgress * Math.PI * 2) * 0.32 + Math.sin(cycleProgress * Math.PI * 6) * 0.09 : 0;
  const wandering = safe.behaviorId === "wander" ? Math.sin(cycleProgress * Math.PI * 2) * 0.18 : 0;
  const rearUpEnvelope = safe.behaviorId === "rear-up"
    ? minimumJerk(clamp(position / 3)) * minimumJerk(clamp((QUADRUPED_STEP_COUNT - position) / 3))
    : 0;
  const forwardRollProgress = safe.behaviorId === "forward-roll"
    ? minimumJerk(clamp((position - 1.25) / 12.5))
    : 0;
  const rollTuck = bodySlide > 0 ? bodySlide : safe.behaviorId === "forward-roll"
    ? Math.sin(Math.PI * clamp((position - 0.5) / 14.5)) ** 2
    : 0;
  const event = sequenceEventFromSafe(safe, step);
  const headPerformance = headPerformanceFromSafe(safe, absolutePosition);
  const motion = BEHAVIOR_MOTION[safe.behaviorId] ?? BEHAVIOR_MOTION.walk;
  const legs = {};
  for (const lane of QUADRUPED_LANES.slice(0, 4)) {
    const cycle = footCycleStateFromSafe(safe, lane.id, absolutePosition);
    legs[lane.id] = Object.freeze({ ...cycle, lift: clamp(cycle.lift * motion.lift, 0, 1.2) });
  }
  legs.tail = Object.freeze({
    intensity: 0,
    contact: 0,
    impact: 0,
    lift: 0,
    swing: Math.sin((position / QUADRUPED_STEP_COUNT) * Math.PI * 2) * safe.stride,
  });
  if (rearUpEnvelope > 0) {
    for (const lane of QUADRUPED_LANES.slice(0, 2)) {
      legs[lane.id] = Object.freeze({
        ...legs[lane.id],
        grounded: false,
        contact: 0,
        load: 0,
        propulsion: 0,
        footX: legs[lane.id].footX + rearUpEnvelope * (lane.id.endsWith("left") ? -0.28 : 0.18),
        lift: Math.max(legs[lane.id].lift, 0.3 + rearUpEnvelope * (lane.id.endsWith("left") ? 0.7 : 0.76)),
      });
    }
  }
  const inferredSupportCount = QUADRUPED_LANES.slice(0, 4).filter(({ id }) => legs[id].grounded).length;
  const supportPlane = quadrupedSupportSnapshot(safe, absolutePosition);
  const groundSupportCount = Number.isFinite(Number(motorSnapshot?.supportCount))
    ? Math.round(clamp(motorSnapshot.supportCount, 0, 4))
    : inferredSupportCount;
  if (["dance", "rear-waltz", "rear-up", "lizard-sprint"].includes(safe.behaviorId) && groundSupportCount === 2) {
    for (const lane of QUADRUPED_LANES.slice(0, 4)) {
      if (legs[lane.id].grounded) continue;
      legs[lane.id] = Object.freeze({ ...legs[lane.id], lift: Math.max(legs[lane.id].lift, 0.72 + Math.sin(Math.PI * phase) * 0.28) });
    }
  }
  let flightArc = 0;
  if (groundSupportCount === 0) {
    const sampleSupport = (samplePosition) => QUADRUPED_LANES.slice(0, 4).some(({ id }) => (
      footCycleStateFromSafe(safe, id, samplePosition).grounded
    ));
    let behind = 0;
    let ahead = 0;
    while (behind < QUADRUPED_STEP_COUNT && !sampleSupport(absolutePosition - behind)) behind += 0.125;
    while (ahead < QUADRUPED_STEP_COUNT && !sampleSupport(absolutePosition + ahead)) ahead += 0.125;
    const flightSpan = Math.max(0.25, behind + ahead);
    flightArc = Math.sin(Math.PI * clamp(behind / flightSpan));
  }
  const timedArc = quadrupedFlightTrajectory(safe, absolutePosition, supportPlane);
  const simulatedHeight = Number.isFinite(Number(motorSnapshot?.height)) ? clamp(motorSnapshot.height, 0, 2) : timedArc?.height ?? null;
  const aerial = simulatedHeight === null
    ? flightArc * motion.aerial / Math.sqrt(safe.gravity)
    : simulatedHeight * (0.34 + motion.aerial * 0.34);
  const legImpact = QUADRUPED_LANES.slice(0, 4).reduce((sum, { id }) => sum + legs[id].impact, 0) / 4;
  const impact = Math.max(legImpact, clamp(motorSnapshot?.landing, 0, 1));
  const leftEnergy = (legs["front-left"].load + legs["rear-left"].load) / 2;
  const rightEnergy = (legs["front-right"].load + legs["rear-right"].load) / 2;
  const foreSupport = legs["front-left"].load + legs["front-right"].load;
  const rearSupport = legs["rear-left"].load + legs["rear-right"].load;
  const foreFootX = (legs["front-left"].footX + legs["front-right"].footX) * 0.5;
  const hindFootX = (legs["rear-left"].footX + legs["rear-right"].footX) * 0.5;
  const spineElasticity = quadrupedAnimal(safe.animalId).morphology?.spineElasticity ?? 0;
  const felineSpineFlex = clamp((1.6 - (foreFootX - hindFootX)) * spineElasticity, -0.28, 0.28);
  const danceSway = ["dance", "rear-waltz", "rear-up", "carousel"].includes(safe.behaviorId) ? Math.sin(position * Math.PI * 0.5) * 0.16 : 0;
  const propulsion = Number.isFinite(Number(motorSnapshot?.propulsion))
    ? clamp(motorSnapshot.propulsion / 2.4)
    : clamp(event.footEnergy / 3.2);
  const compression = clamp(motorSnapshot?.compression ?? impact * 0.42);
  const bodyLift = bodySlide > 0 ? 0 : clamp(0.05 + aerial + propulsion * motion.bounce * 0.16 - compression * 0.2 + (safe.behaviorId === "tiptoe" ? 0.16 : 0), -0.1, 1.2);
  const headExpression = 0;
  const danceBalance = ["dance", "rear-waltz", "rear-up", "lizard-sprint"].includes(safe.behaviorId) && groundSupportCount === 2
    ? clamp(Math.sin(Math.PI * phase))
    : 0;
  const rearBalance = safe.behaviorId === "rear-waltz" ? 1
    : safe.behaviorId === "rear-up" ? rearUpEnvelope
      : safe.behaviorId === "lizard-sprint" ? 0.48
        : 0;
  const skidLean = bodySlide * 0.16;
  return Object.freeze({
    position,
    step,
    phase,
    progress: position / QUADRUPED_STEP_COUNT,
    event,
    headPerformance,
    legs: Object.freeze(legs),
    groundSupportCount,
    airborne: bodySlide > 0 ? false : typeof motorSnapshot?.airborne === "boolean" ? motorSnapshot.airborne : groundSupportCount === 0,
    bodyLift,
    bodyRoll: clamp((rightEnergy - leftEnergy) * motion.sway + danceSway + stagger + wandering, -0.5, 0.5),
    bodyPitch: clamp((rearSupport - foreSupport) * 0.09 - compression * 0.05 - Math.atan(supportPlane.supportSlope) * 1.35 + stagger * 0.3, -0.42, 0.42) * (1 - bodySlide),
    bodyGroundHeight: supportPlane.bodyGroundHeight,
    groundSlope: supportPlane.supportSlope,
    groundProfileId: safe.groundProfileId,
    spineFlex: felineSpineFlex,
    headLift: clamp(bodyLift * 0.38 + 0.1, 0, 0.72),
    headNod: clamp(impact * 0.18 - (rearSupport - foreSupport) * 0.025 + wandering - supportPlane.supportSlope * 0.3, -0.22, 0.32),
    headExpression,
    danceBalance,
    rearBalance,
    forwardRoll: forwardRollProgress,
    rollTuck,
    bodySlide,
    cartwheel,
    skidLean,
    propulsion,
    momentum: Number.isFinite(Number(motorSnapshot?.normalizedVelocity)) ? motorSnapshot.normalizedVelocity : safe.momentum,
    gravity: safe.gravity,
    compression,
    tailAngle: Math.sin(position / QUADRUPED_STEP_COUNT * Math.PI * 2) * (0.2 + propulsion * 0.16),
    eyeOpen: 0.78,
    smile: 0.12,
  });
}

export function describeQuadrupedStep(state, step) {
  const event = quadrupedSequenceEvent(state, step);
  const contacts = event.contacts.length
    ? event.contacts.map(({ label, intensity }) => `${label} ${Math.round(intensity * 100)} percent`).join(", ")
    : "no body contacts";
  return `Frame ${event.step + 1}, ${event.terrain.label}: ${contacts}. Lit marks are touchdowns; the support bar continues until lift-off.`;
}
