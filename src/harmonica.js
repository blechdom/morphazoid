const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

export const HARMONICA_BLOW_MIDI = Object.freeze([60, 64, 67, 72, 76, 79, 84, 88, 91, 96]);
export const HARMONICA_DRAW_MIDI = Object.freeze([62, 67, 71, 74, 77, 81, 83, 86, 89, 93]);
export const HARMONICA_HOLE_COUNT = HARMONICA_BLOW_MIDI.length;

export const HARMONICA_LIMITS = Object.freeze({
  hole: Object.freeze([1, HARMONICA_HOLE_COUNT]),
  chordWidth: Object.freeze([1, Math.min(5, HARMONICA_HOLE_COUNT)]),
  breathPressure: Object.freeze([0, 3]),
  breathRateBpm: Object.freeze([1, 1_200]),
  breathBalance: Object.freeze([0.02, 0.98]),
  breathFlow: Object.freeze([-3, 3]),
  bend: Object.freeze([0, 1.5]),
  reedGap: Object.freeze([0.02, 2.5]),
  reedStiffness: Object.freeze([0.2, 2]),
  airLeak: Object.freeze([0, 0.95]),
  embouchure: Object.freeze([-2, 3]),
  tonguePosition: Object.freeze([-2, 3]),
  tongueHeight: Object.freeze([-2, 3]),
  throatOpening: Object.freeze([-2, 3]),
  vocalTractCoupling: Object.freeze([0, 2]),
  brightness: Object.freeze([0, 2]),
  vibratoRateHz: Object.freeze([0, 18]),
  vibratoDepth: Object.freeze([0, 2]),
  tremoloRateHz: Object.freeze([0.1, 30]),
  tremoloDepth: Object.freeze([0, 1]),
  stereoSpread: Object.freeze([0, 1]),
  techniqueAmount: Object.freeze([0, 2]),
  techniqueRateHz: Object.freeze([0.1, 30]),
  breathAttackMs: Object.freeze([0, 500]),
  breathReleaseMs: Object.freeze([0, 1_000]),
  breathShiftSlop: Object.freeze([0, 1]),
  handCup: Object.freeze([0, 1]),
  cupMotionDepth: Object.freeze([0, 1]),
  growl: Object.freeze([0, 2]),
  tongueBlock: Object.freeze([0, 1]),
  tongueMotionDepth: Object.freeze([0, 1]),
  overbend: Object.freeze([0, 1.5]),
  rhythmSwing: Object.freeze([-0.45, 0.45]),
  level: Object.freeze([0, 0.82]),
});

export const HARMONICA_DRAW_BENDS = Object.freeze([1, 2, 3, 1, 1, 1, 0, 0, 0, 0]);
export const HARMONICA_BLOW_BENDS = Object.freeze([0, 0, 0, 0, 0, 0, 1, 1, 1, 2]);
export const HARMONICA_DRAW_BEND_HOLES = Object.freeze([1, 2, 3, 4, 5, 6]);
export const HARMONICA_BLOW_BEND_HOLES = Object.freeze([7, 8, 9, 10]);
export const HARMONICA_OVERBLOW_HOLES = Object.freeze([1, 2, 3, 4, 5, 6]);
export const HARMONICA_OVERDRAW_HOLES = Object.freeze([7, 8, 9, 10]);
export const HARMONICA_OVERBLOW_MIDI = Object.freeze({
  1: 63, 2: 68, 3: 72, 4: 75, 5: 78, 6: 82,
});
export const HARMONICA_OVERDRAW_MIDI = Object.freeze({ 7: 85, 8: 89, 9: 92, 10: 97 });

// Diatonic harmonicas are manufactured as separate instruments for each key.
// Keep that choice independent from reed material/body construction so a
// stainless, brass, or weighted-reed body can be heard in any available key.
export const HARMONICA_KEYS = Object.freeze([
  Object.freeze({ id: "low-c", label: "Low C", transpose: -12 }),
  Object.freeze({ id: "g", label: "G", transpose: -5 }),
  Object.freeze({ id: "a-flat", label: "A♭", transpose: -4 }),
  Object.freeze({ id: "a", label: "A", transpose: -3 }),
  Object.freeze({ id: "b-flat", label: "B♭", transpose: -2 }),
  Object.freeze({ id: "b", label: "B", transpose: -1 }),
  Object.freeze({ id: "c", label: "C", transpose: 0 }),
  Object.freeze({ id: "d-flat", label: "D♭", transpose: 1 }),
  Object.freeze({ id: "d", label: "D", transpose: 2 }),
  Object.freeze({ id: "e-flat", label: "E♭", transpose: 3 }),
  Object.freeze({ id: "e", label: "E", transpose: 4 }),
  Object.freeze({ id: "f", label: "F", transpose: 5 }),
  Object.freeze({ id: "f-sharp", label: "F♯", transpose: 6 }),
]);

const NOTE_NAMES = Object.freeze(["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]);
const REFERENCE_PHOSPHOR_BRONZE_SPECIFIC_MODULUS = 110e9 / 8_800;

function freezeSettings(settings) {
  return Object.freeze({ ...settings });
}

const freezeTechnique = (technique) => Object.freeze({
  ...technique,
  holes: Object.freeze([...(technique.holes ?? [])]),
  settings: freezeSettings(technique.settings ?? {}),
  example: freezeSettings(technique.example ?? {}),
});

export const HARMONICA_TECHNIQUES = Object.freeze([
  freezeTechnique({ id: "clean", label: "Clean", description: "Unornamented paired-reed tone.", direction: 0, settings: { techniqueAmount: 0, growl: 0, tongueBlock: 0, overbend: 0, breathShiftSlop: 0.04 }, example: { hole: 4, breathDirection: -1, bend: 0 } }),
  freezeTechnique({ id: "double-stop", label: "Double stop", description: "Persistent Southern-blues voicing across two adjacent chambers.", direction: 0, settings: { techniqueAmount: 1, tongueBlock: 0, breathShiftSlop: 0.46 }, example: { hole: 4, breathDirection: -1, chordWidth: 2, bend: 0 } }),
  freezeTechnique({ id: "draw-bend", label: "Draw bend", description: "Sustained tract-loaded bend on holes one through six.", direction: -1, holes: HARMONICA_DRAW_BEND_HOLES, settings: { techniqueAmount: 1 }, example: { hole: 4, breathDirection: -1, bend: 1 } }),
  freezeTechnique({ id: "blow-bend", label: "Blow bend", description: "Sustained upper-register blow bend.", direction: 1, holes: HARMONICA_BLOW_BEND_HOLES, settings: { techniqueAmount: 1 }, example: { hole: 8, breathDirection: 1, bend: 1 } }),
  freezeTechnique({ id: "draw-scoop", label: "Draw scoop", description: "A bent draw onset that releases upward into the target pitch.", direction: -1, holes: HARMONICA_DRAW_BEND_HOLES, settings: { techniqueAmount: 1, breathAttackMs: 0 }, example: { hole: 3, breathDirection: -1, bend: 1 } }),
  freezeTechnique({ id: "blow-scoop", label: "Blow scoop", description: "A bent upper-register onset that rises into the target pitch.", direction: 1, holes: HARMONICA_BLOW_BEND_HOLES, settings: { techniqueAmount: 1, breathAttackMs: 0 }, example: { hole: 8, breathDirection: 1, bend: 1 } }),
  freezeTechnique({ id: "dip", label: "Dip", description: "A quick down-and-back pitch gesture at note onset.", direction: 0, settings: { techniqueAmount: 0.82, techniqueRateHz: 5.5 }, example: { hole: 4, breathDirection: -1, bend: 1 } }),
  freezeTechnique({ id: "fall", label: "Fall", description: "A delayed downward bend that remains at the bottom.", direction: 0, settings: { techniqueAmount: 1 }, example: { hole: 3, breathDirection: -1, bend: 1.2 } }),
  freezeTechnique({ id: "shake-warble", label: "Shake / warble", description: "A smooth alternation between neighboring chambers.", direction: 0, settings: { techniqueAmount: 1, techniqueRateHz: 6.2, breathShiftSlop: 0.72 }, example: { hole: 4, breathDirection: -1, bend: 0 } }),
  freezeTechnique({ id: "tongue-slap", label: "Tongue slap", description: "A wide chordal slap that snaps down to the selected hole.", direction: 0, settings: { techniqueAmount: 1, tongueBlock: 0.75, breathAttackMs: 5, breathShiftSlop: 0.55 }, example: { hole: 4, breathDirection: 1, chordWidth: 1 } }),
  freezeTechnique({ id: "hand-wah", label: "Hand wah", description: "Moving hand-cup radiation filter.", direction: 0, settings: { techniqueAmount: 1, techniqueRateHz: 3.1, handCup: 0.82, breathShiftSlop: 0.64 }, example: { hole: 4, breathDirection: -1 } }),
  freezeTechnique({ id: "throat-vibrato", label: "Throat vibrato", description: "Pitch and pressure oscillation from the throat.", direction: 0, settings: { techniqueAmount: 0.72, techniqueRateHz: 5.2 }, example: { hole: 4, breathDirection: -1 } }),
  freezeTechnique({ id: "flutter", label: "Flutter tongue", description: "Fast tongue interruption of the air stream.", direction: 0, settings: { techniqueAmount: 0.78, techniqueRateHz: 18 }, example: { hole: 4, breathDirection: 1 } }),
  freezeTechnique({ id: "growl", label: "Growl", description: "Low vocal modulation coupled into the reed flow.", direction: 0, settings: { techniqueAmount: 0.9, techniqueRateHz: 28, growl: 1.1, breathShiftSlop: 0.8 }, example: { hole: 3, breathDirection: -1 } }),
  freezeTechnique({ id: "octave-tongue-block", label: "Octave tongue block", description: "Blocks the middle chambers while the outer octave speaks.", direction: 0, holes: [1, 2, 3, 4, 5, 6, 7], settings: { techniqueAmount: 1, tongueBlock: 1 }, example: { hole: 1, breathDirection: 1, chordWidth: 1 } }),
  freezeTechnique({ id: "overblow", label: "Overblow", description: "Chokes the blow reed on holes one through six and transfers primacy to the draw reed.", direction: 1, holes: HARMONICA_OVERBLOW_HOLES, settings: { techniqueAmount: 1, overbend: 1, reedGap: 0.32 }, example: { hole: 4, breathDirection: 1, bend: 0 } }),
  freezeTechnique({ id: "overdraw", label: "Overdraw", description: "Chokes the draw reed on holes seven through ten and transfers primacy to the blow reed.", direction: -1, holes: HARMONICA_OVERDRAW_HOLES, settings: { techniqueAmount: 1, overbend: 1, reedGap: 0.28 }, example: { hole: 7, breathDirection: -1, bend: 0 } }),
  freezeTechnique({ id: "train-chug", label: "Train chug", description: "Alternating chordal draw and blow attacks in a train rhythm.", direction: 0, settings: { techniqueAmount: 1, breathAttackMs: 10, breathReleaseMs: 34, breathShiftSlop: 0.3 }, example: { hole: 2, chordWidth: 3, breathDirection: -1, bluesRhythmId: "train", autoBreath: true } }),
]);

const BEND_TECHNIQUES_FOR_RANDOMIZER = new Set([
  "draw-bend", "blow-bend", "draw-scoop", "blow-scoop", "dip", "fall",
]);

const freezeRhythm = (rhythm) => Object.freeze({
  ...rhythm,
  steps: Object.freeze([...(rhythm.steps ?? [])]),
});

export const HARMONICA_BLUES_RHYTHMS = Object.freeze([
  freezeRhythm({ id: "free", label: "Free breath", description: "Continuous sinusoidal draw and blow cycle.", steps: [] }),
  freezeRhythm({ id: "train", label: "Train", description: "Alternating draw and blow chugs with articulated releases.", steps: [-1, 0, 0.82, 0, -0.92, 0, 0.74, 0] }),
  freezeRhythm({ id: "shuffle", label: "Shuffle", description: "Long-short blues breath shuffle.", steps: [-1, 0, 0.62, -0.82, 0, 0.74] }),
  freezeRhythm({ id: "boogie", label: "Boogie", description: "Six-step alternating bass-like breath figure.", steps: [-1, -0.68, 0.78, -0.9, 0.64, 0.48] }),
  freezeRhythm({ id: "triplet-call-response", label: "Triplet call / response", description: "Three articulated draw calls answered by three blown pulses.", steps: [-1, 0, -0.82, 0, -0.66, 0, 1, 0, 0.8, 0, 0.62, 0] }),
  freezeRhythm({ id: "back-porch-shuffle", label: "Back-porch shuffle", description: "A draw-heavy eight-step shuffle with quiet connecting breaths instead of pristine gaps.", steps: [-1, -0.46, 0.74, 0.24, -0.92, -0.38, 0.66, 0.2] }),
  freezeRhythm({ id: "freight-chug", label: "Freight chug", description: "Hard locomotive pulls, shorter blown answers, and two clipped brake gaps.", steps: [-1, 0, 0.9, 0.52, -0.94, -0.5, 0.78, 0] }),
  freezeRhythm({ id: "slow-drag", label: "Slow drag", description: "Long low draws drag into small breathy answers and deliberate space.", steps: [-1, -0.84, -0.58, 0, 0.6, 0.38, 0, 0.26] }),
  freezeRhythm({ id: "walking-boogie", label: "Walking boogie", description: "An unbroken alternating breath walk with accented draw downbeats.", steps: [-1, -0.62, 0.7, 0.4, -0.9, -0.5, 0.82, 0.52] }),
  freezeRhythm({ id: "hill-country-stomp", label: "Hill-country stomp", description: "Asymmetrical stomps and ghost breaths that lean hard into the draw.", steps: [-1, 0, -0.54, 0.72, 0.18, -0.84, 0.5, 0] }),
  freezeRhythm({ id: "porch-waltz", label: "Porch waltz", description: "A loose three-beat sway: two drawn pulses answered by a softer blow.", steps: [-1, -0.58, 0.12, 0.74, 0.4, 0] }),
  freezeRhythm({ id: "gospel-response", label: "Gospel response", description: "A broad drawn call answered by layered blown pulses and a returning pickup.", steps: [-1, -0.76, 0, -0.52, 0.74, 0.46, 0, 0.32, -0.86, 0, 0.62, 0.28] }),
  freezeRhythm({ id: "fox-chase", label: "Fox chase", description: "Rapid darting reversals and one gulp of space for breath-percussion effects.", steps: [-1, 0.72, -0.82, 0.62, -0.94, 0.76, 0, 0.56, -0.72, 0.86, -0.56, 0.66] }),
  freezeRhythm({ id: "hand-fan", label: "Hand-fan pulse", description: "Even paired breaths designed to lock against a cycling cover-hand wah.", steps: [-0.92, -0.52, 0.74, 0.36, -0.84, -0.46, 0.68, 0.3] }),
  freezeRhythm({ id: "bent-triplets", label: "Bent triplets", description: "Descending draw triplets answer softer blown triplets with bent-note room.", steps: [-1, -0.82, -0.62, 0, 0.72, 0.5, -0.9, -0.66, -0.44, 0, 0.6, 0.4] }),
  freezeRhythm({ id: "smoky-shuffle", label: "Smoky shuffle", description: "Half-voiced pickups and rests leave room for warble, hand color, and reed dirt.", steps: [-1, -0.44, 0, 0.66, -0.82, -0.34, 0, 0.5] }),
  freezeRhythm({ id: "syncopated-sparks", label: "Syncopated sparks", description: "Short high-pressure reversals make overbends flash between ordinary reed notes.", steps: [0.96, 0, -0.56, 0.72, 0, 0.88, -0.66, 0] }),
]);

const freezePerformancePreset = (performancePreset) => Object.freeze({
  ...performancePreset,
  settings: freezeSettings(performancePreset.settings ?? {}),
});

export const HARMONICA_PERFORMANCE_CUSTOM_ID = "custom";

// Whole-player setups deliberately sit above reed body and instrument key.
// Each one combines a real gesture, signed breath score, embouchure, bends,
// hand/tongue motion, and dynamics while retaining the player's chosen harp.
export const HARMONICA_PERFORMANCE_PRESETS = Object.freeze([
  freezePerformancePreset({
    id: "front-porch-shuffle",
    label: "Front Porch Shuffle",
    description: "Loose double-stop draw groove with hand wah, little tongue nudges, and breath between the notes.",
    techniqueId: "hand-wah",
    rhythmId: "back-porch-shuffle",
    settings: {
      hole: 2, chordWidth: 2, breathDirection: -1, breathPressure: 1.08,
      breathRateBpm: 43, breathBalance: 0.62, bend: 0.34,
      embouchure: 0.5, tonguePosition: 0.46, tongueHeight: 0.34,
      throatOpening: 0.42, vocalTractCoupling: 1.16, brightness: 0.86,
      vibratoRateHz: 5.1, vibratoDepth: 0.13, tremoloRateHz: 4.4, tremoloDepth: 0.08,
      techniqueAmount: 0.84, techniqueRateHz: 2.7, breathAttackMs: 7, breathReleaseMs: 58,
      breathShiftSlop: 0.68,
      handCup: 0.64, cupMotionDepth: 0.74, growl: 0.18,
      tongueBlock: 0.3, tongueMotionDepth: 0.3, overbend: 0, rhythmSwing: 0.2,
      stereoSpread: 0.3, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "freight-train-hands",
    label: "Freight Train Hands",
    description: "Three-hole locomotive chug with tongue attacks and a cover-hand pump riding the breath engine.",
    techniqueId: "train-chug",
    rhythmId: "freight-chug",
    settings: {
      hole: 3, chordWidth: 3, breathDirection: -1, breathPressure: 1.3,
      breathRateBpm: 56, breathBalance: 0.58, bend: 0.18,
      embouchure: 0.66, tonguePosition: 0.34, tongueHeight: 0.28,
      throatOpening: 0.6, vocalTractCoupling: 0.98, brightness: 0.94,
      vibratoDepth: 0.05, tremoloDepth: 0.1, techniqueAmount: 1.12, techniqueRateHz: 4.2,
      breathAttackMs: 3, breathReleaseMs: 31, breathShiftSlop: 0.38,
      handCup: 0.56, cupMotionDepth: 0.58,
      growl: 0.3, tongueBlock: 0.48, tongueMotionDepth: 0.68,
      rhythmSwing: 0.08, stereoSpread: 0.36, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "cross-harp-moaner",
    label: "Cross-Harp Moaner",
    description: "A tract-loaded three-draw scoop that settles slowly under a dark, breathing hand cup.",
    techniqueId: "draw-scoop",
    rhythmId: "slow-drag",
    settings: {
      hole: 3, chordWidth: 1, breathDirection: -1, breathPressure: 1.18,
      breathRateBpm: 27, breathBalance: 0.72, bend: 1.08,
      embouchure: 0.72, tonguePosition: 0.26, tongueHeight: 0.7,
      throatOpening: 0.24, vocalTractCoupling: 1.72, brightness: 0.58,
      vibratoRateHz: 4.2, vibratoDepth: 0.26, tremoloDepth: 0.08,
      techniqueAmount: 1.2, techniqueRateHz: 2.1, breathAttackMs: 5, breathReleaseMs: 145,
      breathShiftSlop: 0.76,
      handCup: 0.78, cupMotionDepth: 0.42, growl: 0.36,
      tongueBlock: 0.1, tongueMotionDepth: 0.12, rhythmSwing: 0.26,
      stereoSpread: 0.2, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "tongue-block-boogie",
    label: "Tongue-Block Boogie",
    description: "Wide mouth, snapping tongue, and moving cover hands articulate an unbroken boogie breath.",
    techniqueId: "tongue-slap",
    rhythmId: "walking-boogie",
    settings: {
      hole: 4, chordWidth: 4, breathDirection: -1, breathPressure: 1.16,
      breathRateBpm: 61, breathBalance: 0.6, bend: 0.16,
      embouchure: 0.82, tonguePosition: 0.54, tongueHeight: 0.5,
      throatOpening: 0.58, vocalTractCoupling: 1.02, brightness: 0.96,
      vibratoDepth: 0.08, tremoloDepth: 0.06, techniqueAmount: 1.18, techniqueRateHz: 5.6,
      breathAttackMs: 2, breathReleaseMs: 38, breathShiftSlop: 0.55,
      handCup: 0.46, cupMotionDepth: 0.42,
      growl: 0.16, tongueBlock: 0.84, tongueMotionDepth: 0.82,
      rhythmSwing: 0.16, stereoSpread: 0.42, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "hill-country-stomp",
    label: "Hill-Country Stomp",
    description: "Raw two-hole North Mississippi hill-country lope with ghost breaths and woody vocal grit.",
    techniqueId: "double-stop",
    rhythmId: "hill-country-stomp",
    settings: {
      hole: 3, chordWidth: 2, breathDirection: -1, breathPressure: 1.24,
      breathRateBpm: 52, breathBalance: 0.66, bend: 0.42,
      embouchure: 0.58, tonguePosition: 0.38, tongueHeight: 0.32,
      throatOpening: 0.54, vocalTractCoupling: 1.22, brightness: 0.72,
      vibratoRateHz: 5.7, vibratoDepth: 0.1, tremoloDepth: 0.12,
      techniqueAmount: 0.9, techniqueRateHz: 3.4, breathAttackMs: 4, breathReleaseMs: 52,
      breathShiftSlop: 0.72,
      handCup: 0.5, cupMotionDepth: 0.48, growl: 0.48,
      tongueBlock: 0.34, tongueMotionDepth: 0.4, rhythmSwing: 0.24,
      stereoSpread: 0.34, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "backwoods-waltz",
    label: "Backwoods Waltz",
    description: "Slow three-beat throat vibrato with a gently opening hand and worn, singing draw notes.",
    techniqueId: "throat-vibrato",
    rhythmId: "porch-waltz",
    settings: {
      hole: 4, chordWidth: 2, breathDirection: -1, breathPressure: 0.94,
      breathRateBpm: 31, breathBalance: 0.64, bend: 0.28,
      embouchure: 0.68, tonguePosition: 0.3, tongueHeight: 0.42,
      throatOpening: 0.34, vocalTractCoupling: 1.32, brightness: 0.68,
      vibratoRateHz: 4.5, vibratoDepth: 0.3, tremoloRateHz: 4.5, tremoloDepth: 0.12,
      techniqueAmount: 0.76, techniqueRateHz: 4.5, breathAttackMs: 16, breathReleaseMs: 132,
      breathShiftSlop: 0.64,
      handCup: 0.7, cupMotionDepth: 0.38, growl: 0.2,
      tongueBlock: 0.18, tongueMotionDepth: 0.2, rhythmSwing: 0.12,
      stereoSpread: 0.26, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "smoky-warble",
    label: "Smoky Warble",
    description: "Neighbor-hole shake in a dirty half-voiced shuffle, shaded by slow hand and tongue movement.",
    techniqueId: "shake-warble",
    rhythmId: "smoky-shuffle",
    settings: {
      hole: 4, chordWidth: 1, breathDirection: -1, breathPressure: 1.06,
      breathRateBpm: 48, breathBalance: 0.64, bend: 0.22,
      embouchure: 0.44, tonguePosition: 0.52, tongueHeight: 0.4,
      throatOpening: 0.46, vocalTractCoupling: 1.16, brightness: 0.74,
      vibratoDepth: 0.06, tremoloDepth: 0.08, techniqueAmount: 1.08, techniqueRateHz: 6.4,
      breathAttackMs: 6, breathReleaseMs: 76, breathShiftSlop: 0.82,
      handCup: 0.66, cupMotionDepth: 0.54,
      growl: 0.34, tongueBlock: 0.26, tongueMotionDepth: 0.34,
      rhythmSwing: 0.28, stereoSpread: 0.58, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "church-house-octaves",
    label: "Church-House Octaves",
    description: "Tongue-blocked octave calls open into bright responses under a broad cupped-hand swell.",
    techniqueId: "octave-tongue-block",
    rhythmId: "gospel-response",
    settings: {
      hole: 1, chordWidth: 1, breathDirection: 1, breathPressure: 1.1,
      breathRateBpm: 34, breathBalance: 0.56, bend: 0.08,
      embouchure: 0.74, tonguePosition: 0.68, tongueHeight: 0.62,
      throatOpening: 0.68, vocalTractCoupling: 1.08, brightness: 0.9,
      vibratoRateHz: 5, vibratoDepth: 0.18, tremoloDepth: 0.08,
      techniqueAmount: 1.12, techniqueRateHz: 2.4, breathAttackMs: 9, breathReleaseMs: 96,
      breathShiftSlop: 0.5,
      handCup: 0.76, cupMotionDepth: 0.66, growl: 0.12,
      tongueBlock: 1, tongueMotionDepth: 0.28, rhythmSwing: 0.18,
      stereoSpread: 0.44, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "fox-chase",
    label: "Fox-Chase Breath",
    description: "Appalachian fox-chase breath reversals, flutter tongue, and opening hands create an animated chase effect.",
    techniqueId: "flutter",
    rhythmId: "fox-chase",
    settings: {
      hole: 2, chordWidth: 2, breathDirection: -1, breathPressure: 1.14,
      breathRateBpm: 74, breathBalance: 0.54, bend: 0.14,
      embouchure: 0.46, tonguePosition: 0.62, tongueHeight: 0.66,
      throatOpening: 0.46, vocalTractCoupling: 0.9, brightness: 1.08,
      vibratoDepth: 0.05, tremoloDepth: 0.1, techniqueAmount: 0.88, techniqueRateHz: 15.5,
      breathAttackMs: 1, breathReleaseMs: 24, breathShiftSlop: 0.32,
      handCup: 0.58, cupMotionDepth: 0.7,
      growl: 0.22, tongueBlock: 0.52, tongueMotionDepth: 0.9,
      rhythmSwing: -0.08, stereoSpread: 0.62, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "midnight-growl",
    label: "Midnight Growl",
    description: "Draw-heavy slow drag with a nearly closed hand cavity, throat dirt, and deep reed loading.",
    techniqueId: "growl",
    rhythmId: "slow-drag",
    settings: {
      hole: 2, chordWidth: 2, breathDirection: -1, breathPressure: 1.26,
      breathRateBpm: 24, breathBalance: 0.76, bend: 0.52,
      embouchure: 0.92, tonguePosition: 0.18, tongueHeight: 0.38,
      throatOpening: 0.18, vocalTractCoupling: 1.5, brightness: 0.72,
      vibratoRateHz: 3.8, vibratoDepth: 0.2, tremoloDepth: 0.13,
      techniqueAmount: 1.22, techniqueRateHz: 22, breathAttackMs: 12, breathReleaseMs: 176,
      breathShiftSlop: 0.84,
      handCup: 0.9, cupMotionDepth: 0.32, growl: 1.28,
      tongueBlock: 0.24, tongueMotionDepth: 0.26, rhythmSwing: 0.3,
      stereoSpread: 0.18, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "high-lonesome-cry",
    label: "High Lonesome Cry",
    description: "Upper blow scoop floats above a sparse waltz with wide vibrato and a slowly opening hand.",
    techniqueId: "blow-scoop",
    rhythmId: "porch-waltz",
    settings: {
      hole: 8, chordWidth: 1, breathDirection: 1, breathPressure: 1.02,
      breathRateBpm: 29, breathBalance: 0.42, bend: 0.96,
      embouchure: 0.3, tonguePosition: 0.74, tongueHeight: 0.72,
      throatOpening: 0.5, vocalTractCoupling: 1.52, brightness: 1.08,
      vibratoRateHz: 5.6, vibratoDepth: 0.34, tremoloDepth: 0.08,
      techniqueAmount: 1.16, techniqueRateHz: 2.3, breathAttackMs: 5, breathReleaseMs: 118,
      breathShiftSlop: 0.72,
      handCup: 0.54, cupMotionDepth: 0.68, growl: 0.08,
      tongueBlock: 0.08, tongueMotionDepth: 0.12, rhythmSwing: 0.16,
      stereoSpread: 0.52, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "bent-triplet-cry",
    label: "Bent Triplet Cry",
    description: "Three-draw bend speaks in descending triplets, with moving tongue load and a soft blown answer.",
    techniqueId: "draw-bend",
    rhythmId: "bent-triplets",
    settings: {
      hole: 3, chordWidth: 1, breathDirection: -1, breathPressure: 1.2,
      breathRateBpm: 45, breathBalance: 0.7, bend: 1.12,
      embouchure: 0.64, tonguePosition: 0.32, tongueHeight: 0.78,
      throatOpening: 0.28, vocalTractCoupling: 1.82, brightness: 0.7,
      vibratoRateHz: 4.8, vibratoDepth: 0.2, tremoloDepth: 0.06,
      techniqueAmount: 1.16, techniqueRateHz: 4.8, breathAttackMs: 4, breathReleaseMs: 72,
      breathShiftSlop: 0.58,
      handCup: 0.68, cupMotionDepth: 0.46, growl: 0.28,
      tongueBlock: 0.34, tongueMotionDepth: 0.64, rhythmSwing: 0.22,
      stereoSpread: 0.32, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "hand-fan-tremolo",
    label: "Hand-Fan Tremolo",
    description: "Even breath pairs become a wide, animated wah as both hands open and close around the covers.",
    techniqueId: "hand-wah",
    rhythmId: "hand-fan",
    settings: {
      hole: 5, chordWidth: 2, breathDirection: -1, breathPressure: 1.04,
      breathRateBpm: 52, breathBalance: 0.56, bend: 0.12,
      embouchure: 0.46, tonguePosition: 0.5, tongueHeight: 0.4,
      throatOpening: 0.54, vocalTractCoupling: 0.96, brightness: 0.98,
      vibratoDepth: 0.08, tremoloRateHz: 3.8, tremoloDepth: 0.18,
      techniqueAmount: 1.26, techniqueRateHz: 3.8, breathAttackMs: 6, breathReleaseMs: 54,
      breathShiftSlop: 0.52,
      handCup: 0.88, cupMotionDepth: 0.96, growl: 0.12,
      tongueBlock: 0.2, tongueMotionDepth: 0.3, rhythmSwing: 0.06,
      stereoSpread: 0.7, autoBreath: true,
    },
  }),
  freezePerformancePreset({
    id: "overblow-sparks",
    label: "Overblow Sparks",
    description: "Choked-reed flashes answer ordinary draw notes in a clipped, high-pressure syncopation.",
    techniqueId: "overblow",
    rhythmId: "syncopated-sparks",
    settings: {
      hole: 4, chordWidth: 1, breathDirection: 1, breathPressure: 1.82,
      breathRateBpm: 58, breathBalance: 0.48, bend: 0,
      embouchure: 0.26, tonguePosition: 0.78, tongueHeight: 0.88,
      throatOpening: 0.28, vocalTractCoupling: 1.54, brightness: 1.18,
      vibratoDepth: 0.08, tremoloDepth: 0.06, techniqueAmount: 1.08, techniqueRateHz: 6.2,
      breathAttackMs: 2, breathReleaseMs: 34, breathShiftSlop: 0.24,
      handCup: 0.4, cupMotionDepth: 0.48,
      growl: 0.08, tongueBlock: 0.12, tongueMotionDepth: 0.34,
      overbend: 1.12, rhythmSwing: -0.06, stereoSpread: 0.56, autoBreath: true,
    },
  }),
]);

export const HARMONICA_DEFAULTS = Object.freeze({
  presetId: "c-richter",
  keyId: "c",
  performancePresetId: "midnight-growl",
  hole: 2,
  chordWidth: 2,
  // Start with the existing Midnight Growl player: loose enough to expose the
  // two reed banks and hand cavity, while the brighter setting keeps the upper
  // reed edge and classic harmonica twang. Front Porch remains an intact preset.
  breathDirection: -1,
  breathPressure: 1.26,
  breathRateBpm: 24,
  breathBalance: 0.76,
  breathFlow: 0,
  autoBreath: true,
  bend: 0.52,
  reedGap: 0.72,
  reedStiffness: 1,
  airLeak: 0.04,
  embouchure: 0.92,
  tonguePosition: 0.18,
  tongueHeight: 0.38,
  throatOpening: 0.18,
  vocalTractCoupling: 1.5,
  brightness: 0.72,
  vibratoRateHz: 3.8,
  vibratoDepth: 0.2,
  tremoloRateHz: 4.4,
  tremoloDepth: 0.13,
  stereoSpread: 0.18,
  bluesTechniqueId: "growl",
  bluesRhythmId: "slow-drag",
  techniqueAmount: 1.22,
  techniqueRateHz: 22,
  breathAttackMs: 12,
  breathReleaseMs: 176,
  breathShiftSlop: 0.84,
  handCup: 0.9,
  cupMotionDepth: 0.32,
  growl: 1.28,
  tongueBlock: 0.24,
  tongueMotionDepth: 0.26,
  overbend: 0,
  rhythmSwing: 0.3,
  level: 0.5,
});

export const HARMONICA_PRESETS = Object.freeze([
  Object.freeze({
    id: "c-richter",
    label: "Classic bronze",
    family: "phosphor-bronze reeds",
    description: "Bright phosphor-bronze reeds with a balanced traditional response and familiar blow/draw articulation.",
    settings: freezeSettings({
      reedGap: 0.72, reedStiffness: 1, airLeak: 0.04, brightness: 0.9,
    }),
    material: freezeSettings({
      youngsModulusGPa: 110, densityKgM3: 8_800, internalLossFactor: 0.0012,
      flowResponse: 1, brightness: 1, saturation: 1,
    }),
  }),
  Object.freeze({
    id: "low-c",
    label: "Weighted bronze",
    family: "weighted phosphor bronze",
    description: "Heavier phosphor-bronze tongues with slower attacks, longer release, and a broad low-body response.",
    settings: freezeSettings({
      reedGap: 0.9, reedStiffness: 0.78, airLeak: 0.07, brightness: 0.62,
    }),
    material: freezeSettings({
      youngsModulusGPa: 110, densityKgM3: 9_050, internalLossFactor: 0.0017,
      flowResponse: 0.82, brightness: 0.68, saturation: 1.18,
    }),
  }),
  Object.freeze({
    id: "g-richter",
    label: "Spring steel",
    family: "stainless-steel reeds",
    description: "Firm stainless spring-steel tongues with clear attacks, high cycle retention, and a focused upper edge.",
    settings: freezeSettings({
      reedGap: 0.6, reedStiffness: 1.28, airLeak: 0.025, brightness: 1.12,
    }),
    material: freezeSettings({
      youngsModulusGPa: 193, densityKgM3: 8_000, internalLossFactor: 0.00045,
      flowResponse: 0.9, brightness: 1.2, saturation: 0.9,
    }),
  }),
  Object.freeze({
    id: "a-richter",
    label: "Warm brass",
    family: "brass reeds",
    description: "Quick brass tongues with a warm, slightly lossy midrange and softer transient response.",
    settings: freezeSettings({
      reedGap: 0.66, reedStiffness: 0.88, airLeak: 0.055, brightness: 0.78,
    }),
    material: freezeSettings({
      youngsModulusGPa: 100, densityKgM3: 8_500, internalLossFactor: 0.0022,
      flowResponse: 1.12, brightness: 0.82, saturation: 1.08,
    }),
  }),
]);

export function harmonicaPreset(id) {
  return HARMONICA_PRESETS.find((preset) => preset.id === id) ?? HARMONICA_PRESETS[0];
}

export function harmonicaKey(id) {
  return HARMONICA_KEYS.find((key) => key.id === id) ?? HARMONICA_KEYS.find((key) => key.id === "c");
}

export function harmonicaTechnique(id) {
  return HARMONICA_TECHNIQUES.find((technique) => technique.id === id)
    ?? HARMONICA_TECHNIQUES[0];
}

export function harmonicaBluesRhythm(id) {
  return HARMONICA_BLUES_RHYTHMS.find((rhythm) => rhythm.id === id)
    ?? HARMONICA_BLUES_RHYTHMS[0];
}

export function harmonicaPerformancePreset(id) {
  return HARMONICA_PERFORMANCE_PRESETS.find((preset) => preset.id === id)
    ?? HARMONICA_PERFORMANCE_PRESETS.find(
      (preset) => preset.id === HARMONICA_DEFAULTS.performancePresetId,
    )
    ?? HARMONICA_PERFORMANCE_PRESETS[0];
}

export function sanitizeHarmonicaState(source = {}, fallback = HARMONICA_DEFAULTS) {
  const state = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : HARMONICA_DEFAULTS;
  const result = {};
  for (const [key, limits] of Object.entries(HARMONICA_LIMITS)) {
    result[key] = clamp(
      finiteOr(state[key], finiteOr(base[key], HARMONICA_DEFAULTS[key])),
      limits[0],
      limits[1],
    );
  }
  result.hole = Math.round(result.hole);
  result.chordWidth = Math.round(result.chordWidth);
  const direction = finiteOr(state.breathDirection, finiteOr(base.breathDirection, 1));
  result.breathDirection = direction < 0 ? -1 : 1;
  result.autoBreath = Boolean(state.autoBreath ?? base.autoBreath ?? false);
  result.presetId = harmonicaPreset(state.presetId ?? base.presetId).id;
  result.keyId = harmonicaKey(state.keyId ?? base.keyId).id;
  result.bluesTechniqueId = harmonicaTechnique(
    state.bluesTechniqueId ?? base.bluesTechniqueId,
  ).id;
  result.bluesRhythmId = harmonicaBluesRhythm(
    state.bluesRhythmId ?? base.bluesRhythmId,
  ).id;
  const performancePresetId = state.performancePresetId ?? base.performancePresetId;
  result.performancePresetId = performancePresetId === HARMONICA_PERFORMANCE_CUSTOM_ID
    ? HARMONICA_PERFORMANCE_CUSTOM_ID
    : harmonicaPerformancePreset(performancePresetId).id;
  return result;
}

export function harmonicaState(presetId = "c-richter", overrides = {}) {
  const preset = harmonicaPreset(presetId);
  return sanitizeHarmonicaState({
    ...HARMONICA_DEFAULTS,
    ...preset.settings,
    ...overrides,
    presetId: preset.id,
  });
}

export function applyHarmonicaTechnique(source = HARMONICA_DEFAULTS, id = "clean") {
  const state = sanitizeHarmonicaState(source);
  const technique = harmonicaTechnique(id);
  return sanitizeHarmonicaState({
    ...state,
    performancePresetId: HARMONICA_PERFORMANCE_CUSTOM_ID,
    techniqueAmount: 1,
    techniqueRateHz: 5.5,
    breathAttackMs: 18,
    breathReleaseMs: 90,
    breathShiftSlop: 0.18,
    handCup: 0.15,
    cupMotionDepth: 0,
    growl: 0,
    tongueBlock: 0,
    tongueMotionDepth: 0,
    overbend: 0,
    chordWidth: 1,
    bend: 0,
    ...technique.settings,
    ...technique.example,
    bluesTechniqueId: technique.id,
  }, state);
}

export function applyHarmonicaPerformancePreset(
  source = HARMONICA_DEFAULTS,
  id = HARMONICA_DEFAULTS.performancePresetId,
) {
  const state = sanitizeHarmonicaState(source);
  const performancePreset = harmonicaPerformancePreset(id);
  const gestured = applyHarmonicaTechnique(state, performancePreset.techniqueId);
  return sanitizeHarmonicaState({
    ...gestured,
    ...performancePreset.settings,
    performancePresetId: performancePreset.id,
    bluesTechniqueId: performancePreset.techniqueId,
    bluesRhythmId: performancePreset.rhythmId,
    autoBreath: true,
  }, state);
}

export function harmonicaTechniqueAllowed(
  source = HARMONICA_DEFAULTS,
  requestedHole = source?.hole,
  requestedDirection = source?.breathDirection,
) {
  const state = typeof source === "string"
    ? HARMONICA_DEFAULTS
    : sanitizeHarmonicaState(source);
  const technique = harmonicaTechnique(
    typeof source === "string" ? source : state.bluesTechniqueId,
  );
  const hole = Math.round(clamp(requestedHole, 1, HARMONICA_HOLE_COUNT));
  const direction = finiteOr(requestedDirection, state.breathDirection) < 0 ? -1 : 1;
  if (technique.id === "octave-tongue-block") {
    return direction > 0
      ? hole <= 7
      : [1, 3, 4, 5, 6].includes(hole);
  }
  if ((technique.id === "dip" || technique.id === "fall")
    && bendRangeSemitones(hole, direction) === 0) return false;
  return (technique.direction === 0 || technique.direction === direction)
    && (technique.holes.length === 0 || technique.holes.includes(hole));
}

export function harmonicaOverbendTarget(
  source = HARMONICA_DEFAULTS,
  requestedHole = source?.hole,
  requestedDirection = source?.breathDirection,
) {
  const state = sanitizeHarmonicaState(source);
  const key = harmonicaKey(state.keyId);
  const hole = Math.round(clamp(requestedHole, 1, HARMONICA_HOLE_COUNT));
  const direction = finiteOr(requestedDirection, state.breathDirection) < 0 ? -1 : 1;
  const table = direction < 0 ? HARMONICA_OVERDRAW_MIDI : HARMONICA_OVERBLOW_MIDI;
  const baseMidi = table[hole];
  const legal = Number.isFinite(baseMidi);
  const midi = legal ? baseMidi + key.transpose : null;
  return Object.freeze({
    legal,
    hole,
    direction,
    midi,
    frequencyHz: legal ? midiFrequency(midi) : 0,
    noteName: legal ? midiNoteName(midi) : "",
  });
}

export function midiFrequency(midi) {
  return 440 * Math.pow(2, (finiteOr(midi, 69) - 69) / 12);
}

export function midiNoteName(midi) {
  const rounded = Math.round(finiteOr(midi, 60));
  const pitchClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[pitchClass]}${octave}`;
}

export function bendRangeSemitones(hole, direction) {
  const index = Math.round(clamp(hole, 1, HARMONICA_HOLE_COUNT)) - 1;
  return direction < 0 ? HARMONICA_DRAW_BENDS[index] : HARMONICA_BLOW_BENDS[index];
}

export function harmonicaReedPair(source = HARMONICA_DEFAULTS, requestedHole = source?.hole) {
  const state = sanitizeHarmonicaState(source);
  const key = harmonicaKey(state.keyId);
  const hole = Math.round(clamp(requestedHole, 1, HARMONICA_HOLE_COUNT));
  const index = hole - 1;
  const blowMidi = HARMONICA_BLOW_MIDI[index] + key.transpose;
  const drawMidi = HARMONICA_DRAW_MIDI[index] + key.transpose;
  return Object.freeze({
    hole,
    blowMidi,
    drawMidi,
    blowFrequencyHz: midiFrequency(blowMidi),
    drawFrequencyHz: midiFrequency(drawMidi),
    blowName: midiNoteName(blowMidi),
    drawName: midiNoteName(drawMidi),
    blowBendSemitones: HARMONICA_BLOW_BENDS[index],
    drawBendSemitones: HARMONICA_DRAW_BENDS[index],
  });
}

export function activeHoles(source = HARMONICA_DEFAULTS) {
  const state = sanitizeHarmonicaState(source);
  const width = state.chordWidth;
  const centeredFirst = clamp(
    state.hole - Math.floor((width - 1) / 2),
    1,
    HARMONICA_HOLE_COUNT + 1 - width,
  );
  // Side tongue blocking conventionally exposes the selected hole at the
  // right edge while the tongue covers the neighboring chambers to its left.
  const tongueBlockFirst = clamp(
    state.hole - (width - 1),
    1,
    HARMONICA_HOLE_COUNT + 1 - width,
  );
  const first = state.tongueBlock > 0.01 && width > 1
    ? tongueBlockFirst
    : centeredFirst;
  return Object.freeze(Array.from({ length: width }, (_, index) => first + index));
}

export function harmonicaReedFrequency(
  source = HARMONICA_DEFAULTS,
  requestedHole = source?.hole,
  requestedDirection = source?.breathDirection,
) {
  const state = sanitizeHarmonicaState(source);
  const direction = finiteOr(requestedDirection, state.breathDirection) < 0 ? -1 : 1;
  const pair = harmonicaReedPair(state, requestedHole);
  const baseMidi = direction < 0 ? pair.drawMidi : pair.blowMidi;
  const availableBend = bendRangeSemitones(pair.hole, direction);
  const bendSemitones = availableBend * state.bend;
  const loadedMidi = baseMidi - bendSemitones;
  return Object.freeze({
    hole: pair.hole,
    direction,
    midi: loadedMidi,
    frequencyHz: midiFrequency(loadedMidi),
    noteName: midiNoteName(Math.round(loadedMidi)),
    bendSemitones,
    availableBend,
    baseMidi,
  });
}

export function harmonicaActiveReeds(source = HARMONICA_DEFAULTS, flow = source?.breathFlow) {
  const state = sanitizeHarmonicaState(source);
  const signedFlow = clamp(
    finiteOr(flow, state.breathDirection * state.breathPressure),
    HARMONICA_LIMITS.breathFlow[0],
    HARMONICA_LIMITS.breathFlow[1],
  );
  const direction = Math.abs(signedFlow) < 1e-8 ? state.breathDirection : Math.sign(signedFlow);
  return Object.freeze(activeHoles(state).map((hole, index, holes) => {
    const reed = harmonicaReedFrequency(state, hole, direction);
    const center = (holes.length - 1) * 0.5;
    const weight = Math.exp(-Math.pow((index - center) / Math.max(0.8, holes.length * 0.56), 2));
    return Object.freeze({ ...reed, weight });
  }));
}

export function harmonicaMaterialProperties(source = HARMONICA_DEFAULTS) {
  const preset = harmonicaPreset(typeof source === "string" ? source : source?.presetId);
  const material = preset.material;
  const youngsModulusPa = material.youngsModulusGPa * 1e9;
  const specificModulusM2S2 = youngsModulusPa / material.densityKgM3;
  const specificModulusRatio = specificModulusM2S2 / REFERENCE_PHOSPHOR_BRONZE_SPECIFIC_MODULUS;
  const lossRatio = material.internalLossFactor / 0.0012;
  return Object.freeze({
    presetId: preset.id,
    youngsModulusPa,
    densityKgM3: material.densityKgM3,
    specificModulusM2S2,
    specificModulusRatio,
    stiffnessScale: Math.sqrt(specificModulusRatio),
    waveSpeedMps: Math.sqrt(specificModulusM2S2),
    internalLossFactor: material.internalLossFactor,
    lossRatio,
    lossScale: Math.sqrt(lossRatio),
    intrinsicCycleRetention: Math.exp(-Math.PI * material.internalLossFactor),
    flowResponse: material.flowResponse,
    brightness: material.brightness,
    saturation: material.saturation,
  });
}

// A pressure source maintains approximately equal pressure at each uncovered
// chamber. This reduced-order term converts that pressure into a bounded reed
// drive while retaining the material/gap dependence of the speaking threshold.
export function harmonicaPressureState(
  source = HARMONICA_DEFAULTS,
  flow = source?.breathFlow,
) {
  const state = sanitizeHarmonicaState(source);
  const material = harmonicaMaterialProperties(state);
  const signedFlow = clamp(
    finiteOr(flow, state.breathDirection * state.breathPressure),
    HARMONICA_LIMITS.breathFlow[0],
    HARMONICA_LIMITS.breathFlow[1],
  );
  const pressure = Math.abs(signedFlow) * (1 - state.airLeak * 0.82);
  const effectiveStiffness = Math.max(
    0.08,
    state.reedStiffness * material.stiffnessScale,
  );
  const threshold = 0.014 + state.reedGap
    * (0.038 + effectiveStiffness * 0.014)
    / Math.max(0.35, material.flowResponse);
  const excessPressure = Math.max(0, pressure - threshold);
  const drive = Math.tanh(
    excessPressure
      * (2.15 + material.flowResponse * 1.85)
      / Math.sqrt(effectiveStiffness),
  );
  const pressureFactor = clamp(
    1 - Math.exp(
      -excessPressure
        * (2.4 + material.flowResponse)
        / Math.sqrt(effectiveStiffness),
    ),
  );
  return Object.freeze({
    signedFlow,
    pressure,
    threshold,
    excessPressure,
    drive,
    pressureFactor,
    effectiveStiffness,
  });
}

export function harmonicaMouthFormants(source = HARMONICA_DEFAULTS) {
  const state = sanitizeHarmonicaState(source);
  const front = state.tonguePosition;
  const height = state.tongueHeight;
  const throat = state.throatOpening;
  const cup = state.embouchure;
  const first = clamp(260 + (1 - height) * 520 + throat * 155 - cup * 75, 45, 4_200);
  const second = clamp(720 + front * 1_720 - cup * 460 - height * 110, first + 35, 8_400);
  const third = clamp(1_900 + front * 690 + throat * 180 - cup * 220, second + 45, 9_600);
  const bendTargetHz = clamp(
    145 + (1 - height) * 720 + (1 - front) * 380 - cup * 80,
    55,
    2_800,
  );
  return Object.freeze({
    frequenciesHz: Object.freeze([first, second, third]),
    bandwidthsHz: Object.freeze([
      clamp(72 + throat * 90 + cup * 55, 18, 1_600),
      clamp(110 + (1 - height) * 160, 30, 2_100),
      clamp(170 + front * 120 + cup * 90, 45, 2_800),
    ]),
    bendTargetHz,
  });
}

// Describes the two-reed system without applying instantaneous pressure. The
// normal region approaches (but does not cross) the lower opposing reed. The
// final 0.5 of the public bend control is intentionally Morphazoid territory
// and may push beyond that acoustical boundary.
export function harmonicaReedCoupling(
  source = HARMONICA_DEFAULTS,
  requestedHole = source?.hole,
  requestedDirection = source?.breathDirection,
) {
  const state = sanitizeHarmonicaState(source);
  const direction = finiteOr(requestedDirection, state.breathDirection) < 0 ? -1 : 1;
  const pair = harmonicaReedPair(state, requestedHole);
  const baseMidi = direction < 0 ? pair.drawMidi : pair.blowMidi;
  const opposingMidi = direction < 0 ? pair.blowMidi : pair.drawMidi;
  const availableBend = bendRangeSemitones(pair.hole, direction);
  const pairInterval = Math.max(0, baseMidi - opposingMidi);
  const physicalLimit = Math.min(
    availableBend,
    Math.max(0, pairInterval - 0.08),
  );
  const normalRequest = Math.min(1, state.bend);
  const extensionRequest = Math.max(0, state.bend - 1);
  const formants = harmonicaMouthFormants(state);
  const desiredMidi = baseMidi - physicalLimit * Math.max(0.12, normalRequest);
  const desiredFrequencyHz = midiFrequency(desiredMidi);
  const alignmentCents = Math.abs(
    1_200 * Math.log2(formants.bendTargetHz / desiredFrequencyHz),
  );
  // A deliberately broad impedance lock: exact tuning strongly assists a
  // bend, while a badly mistuned mouth still supplies a smaller acoustic load.
  const tractAlignment = 0.42 + 0.58
    * Math.exp(-Math.pow(alignmentCents / 1_050, 2));
  const couplingStrength = 1 - Math.exp(-clamp(state.vocalTractCoupling, 0, 2) * 2.4);
  const normalBendAtFullPressure = physicalLimit
    * normalRequest
    * couplingStrength
    * tractAlignment;
  const extensionBendAtFullPressure = availableBend
    * extensionRequest
    * couplingStrength
    * (0.68 + tractAlignment * 0.32);
  const passiveGainAtFullPressure = availableBend > 0
    ? Math.pow(clamp(normalBendAtFullPressure / Math.max(0.05, physicalLimit)), 1.45)
      * (0.16 + couplingStrength * 0.28)
    : 0;
  return Object.freeze({
    hole: pair.hole,
    direction,
    baseMidi,
    opposingMidi,
    baseFrequencyHz: midiFrequency(baseMidi),
    opposingFrequencyHz: midiFrequency(opposingMidi),
    availableBend,
    physicalLimit,
    normalBendAtFullPressure,
    extensionBendAtFullPressure,
    passiveGainAtFullPressure,
    tractAlignment,
    alignmentCents,
    couplingStrength,
    bendTargetHz: formants.bendTargetHz,
  });
}

export function harmonicaCoupledReedState(
  source = HARMONICA_DEFAULTS,
  requestedHole = source?.hole,
  requestedDirection = source?.breathDirection,
  flow = source?.breathFlow,
) {
  const state = sanitizeHarmonicaState(source);
  const model = harmonicaReedCoupling(state, requestedHole, requestedDirection);
  const pressure = harmonicaPressureState(state, flow);
  const bendSemitones = (
    model.normalBendAtFullPressure + model.extensionBendAtFullPressure
  ) * pressure.pressureFactor;
  const pressureDetuneCents = pressure.pressureFactor
    * (model.direction < 0 ? -4.5 : 3)
    / Math.sqrt(Math.max(0.2, state.reedStiffness));
  const midi = model.baseMidi - bendSemitones + pressureDetuneCents / 100;
  const passiveGain = model.passiveGainAtFullPressure
    * pressure.pressureFactor
    * pressure.drive;
  return Object.freeze({
    ...model,
    ...pressure,
    midi,
    frequencyHz: midiFrequency(midi),
    bendSemitones,
    pressureDetuneCents,
    passiveGain,
    primaryGain: 1 - passiveGain * 0.18,
  });
}

export function harmonicaBreathCycleFlow(source = HARMONICA_DEFAULTS, phase = 0) {
  const state = sanitizeHarmonicaState(source);
  const wrapped = ((finiteOr(phase, 0) % 1) + 1) % 1;
  if (wrapped < state.breathBalance) {
    return -state.breathPressure * Math.sin(Math.PI * wrapped / state.breathBalance);
  }
  return state.breathPressure
    * Math.sin(Math.PI * (wrapped - state.breathBalance) / (1 - state.breathBalance));
}

function smoothstep(value) {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
}

// A single signed air column still crosses zero; "slop" describes the player
// and reeds around that crossing, never impossible simultaneous lung flow.
// Higher values lengthen the incoming reed rise, preserve the outgoing reed's
// inertial tail, and widen the lip-aperture glide between neighboring chambers.
export function harmonicaBreathShiftProfile(source = HARMONICA_DEFAULTS) {
  const state = sanitizeHarmonicaState(source);
  const amount = smoothstep(state.breathShiftSlop);
  return Object.freeze({
    amount,
    pressureTimeSeconds: 0.006 + amount * 0.038,
    reedAttackSeconds: 0.02 + amount * 0.07,
    reedTailSeconds: 0.03 + amount * 0.09,
    holeSlideSeconds: 0.006 + amount * 0.084,
    chamberBleed: 0.015 + amount * 0.22,
    pitchScoopCents: 2 + amount * 20,
  });
}

// Stateless rhythm preview used by UI/readouts: positive steps blow, negative
// steps draw, and rests are exactly zero. The worklet uses the same signed
// steps and swing durations, then applies its stateful one-pole breath envelope
// and articulation tail so manual and automatic pressure obey one model.
export function harmonicaBluesRhythmFlow(source = HARMONICA_DEFAULTS, phase = 0) {
  const state = sanitizeHarmonicaState(source);
  const rhythm = harmonicaBluesRhythm(state.bluesRhythmId);
  if (rhythm.steps.length === 0) return harmonicaBreathCycleFlow(state, phase);
  const wrapped = ((finiteOr(phase, 0) % 1) + 1) % 1;
  const count = rhythm.steps.length;
  const baseDuration = 1 / count;
  const durations = rhythm.steps.map((_, index) => (
    baseDuration * (1 + (index % 2 === 0 ? state.rhythmSwing : -state.rhythmSwing))
  ));
  let start = 0;
  let stepIndex = count - 1;
  for (let index = 0; index < count; index += 1) {
    if (wrapped < start + durations[index] || index === count - 1) {
      stepIndex = index;
      break;
    }
    start += durations[index];
  }
  const velocity = rhythm.steps[stepIndex];
  if (velocity === 0) return 0;
  const duration = durations[stepIndex];
  const local = clamp((wrapped - start) / Math.max(1e-9, duration));
  const cycleSeconds = 60 / state.breathRateBpm;
  const stepSeconds = cycleSeconds * duration;
  const attackFraction = clamp(state.breathAttackMs / 1_000 / stepSeconds, 0, 0.48);
  const releaseFraction = clamp(state.breathReleaseMs / 1_000 / stepSeconds, 0, 0.48);
  const attackEnvelope = attackFraction <= 1e-9
    ? 1
    : smoothstep(local / attackFraction);
  const releaseEnvelope = releaseFraction <= 1e-9
    ? 1
    : smoothstep((1 - local) / releaseFraction);
  return state.breathPressure * velocity * Math.min(attackEnvelope, releaseEnvelope);
}

export function randomizeHarmonicaState(source = HARMONICA_DEFAULTS, random = Math.random) {
  const state = sanitizeHarmonicaState(source);
  const unit = () => clamp(typeof random === "function" ? random() : Math.random());
  const performancePreset = HARMONICA_PERFORMANCE_PRESETS[
    Math.min(
      HARMONICA_PERFORMANCE_PRESETS.length - 1,
      Math.floor(unit() * HARMONICA_PERFORMANCE_PRESETS.length),
    )
  ];
  const patched = applyHarmonicaPerformancePreset(state, performancePreset.id);
  const technique = harmonicaTechnique(patched.bluesTechniqueId);
  const isOverbendTechnique = technique.id === "overblow" || technique.id === "overdraw";
  const isBendTechnique = BEND_TECHNIQUES_FOR_RANDOMIZER.has(technique.id);
  const around = (value, radius) => value + (unit() * 2 - 1) * radius;
  return sanitizeHarmonicaState({
    ...patched,
    performancePresetId: performancePreset.id,
    breathPressure: isOverbendTechnique
      ? 1.68 + unit() * 0.7
      : clamp(around(patched.breathPressure, 0.22), 0.72, 1.62),
    breathRateBpm: clamp(
      patched.breathRateBpm * (0.8 + unit() * 0.4),
      20,
      96,
    ),
    breathBalance: clamp(around(patched.breathBalance, 0.08), 0.38, 0.8),
    bend: isBendTechnique
      ? clamp(around(patched.bend, 0.2), 0.38, 1.35)
      : clamp(around(patched.bend, 0.16), 0, 1.2),
    reedGap: 0.34 + unit() * 0.82,
    reedStiffness: 0.62 + unit() * 0.82,
    airLeak: 0.015 + unit() * 0.25,
    embouchure: around(patched.embouchure, 0.34),
    tonguePosition: around(patched.tonguePosition, 0.42),
    tongueHeight: around(patched.tongueHeight, 0.42),
    throatOpening: around(patched.throatOpening, 0.34),
    vocalTractCoupling: clamp(around(patched.vocalTractCoupling, 0.28), 0.58, 1.92),
    brightness: clamp(around(patched.brightness, 0.3), 0.38, 1.5),
    vibratoRateHz: clamp(around(patched.vibratoRateHz, 1.4), 2.2, 8.8),
    vibratoDepth: clamp(around(patched.vibratoDepth, 0.12), 0.03, 0.62),
    tremoloRateHz: clamp(around(patched.tremoloRateHz, 1.6), 1.4, 9.5),
    tremoloDepth: clamp(around(patched.tremoloDepth, 0.08), 0.02, 0.34),
    stereoSpread: clamp(around(patched.stereoSpread, 0.18), 0.12, 0.78),
    techniqueAmount: clamp(around(patched.techniqueAmount, 0.22), 0.52, 1.5),
    techniqueRateHz: clamp(around(patched.techniqueRateHz, 1.4), 0.8, 24),
    breathAttackMs: clamp(around(patched.breathAttackMs, 6), 1, 30),
    breathReleaseMs: clamp(around(patched.breathReleaseMs, 28), 26, 210),
    breathShiftSlop: clamp(around(patched.breathShiftSlop, 0.16), 0.08, 0.98),
    handCup: clamp(around(patched.handCup, 0.16), 0.18, 0.96),
    cupMotionDepth: clamp(around(patched.cupMotionDepth, 0.16), 0.12, 1),
    growl: clamp(around(patched.growl, 0.22), 0.04, 1.62),
    tongueBlock: clamp(around(patched.tongueBlock, 0.15), 0.04, 1),
    tongueMotionDepth: clamp(around(patched.tongueMotionDepth, 0.18), 0.1, 1),
    overbend: isOverbendTechnique
      ? 1.04 + unit() * 0.28
      : clamp(around(patched.overbend, 0.08), 0, 0.28),
    rhythmSwing: clamp(around(patched.rhythmSwing, 0.08), -0.18, 0.36),
    level: clamp(around(state.level, 0.06), 0.44, 0.62),
    autoBreath: true,
    breathFlow: 0,
  }, state);
}
