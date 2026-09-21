const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

export const JAW_HARP_LIMITS = Object.freeze({
  reedFrequencyHz: Object.freeze([38, 180]),
  reedDecaySeconds: Object.freeze([0.35, 8]),
  reedStiffness: Object.freeze([0, 1]),
  pluckForce: Object.freeze([0.005, 4]),
  pluckPosition: Object.freeze([0.08, 0.92]),
  tonguePosition: Object.freeze([-2, 3]),
  tongueHeight: Object.freeze([-2, 3]),
  jawOpening: Object.freeze([-2, 3]),
  lipRounding: Object.freeze([-2, 3]),
  glottisOpening: Object.freeze([-2, 3]),
  cavityCoupling: Object.freeze([0, 2]),
  frameCoupling: Object.freeze([0, 1]),
  breathDepth: Object.freeze([0, 3]),
  breathNoiseAmount: Object.freeze([0, 1]),
  breathFilter: Object.freeze([0, 1]),
  breathRateBpm: Object.freeze([1, 1_200]),
  breathBalance: Object.freeze([0.02, 0.98]),
  breathFlow: Object.freeze([-3, 3]),
  formantFocus: Object.freeze([-2, 3]),
  repeatRateBpm: Object.freeze([36, 480]),
  repeatSwing: Object.freeze([-0.42, 0.42]),
  breathsPerLoop: Object.freeze([0.125, 16]),
  dryResonance: Object.freeze([0, 1]),
  level: Object.freeze([0, 0.82]),
});

// Randomize explores a deliberately playable subset of the much wider manual
// ranges. The full limits remain available from the controls for intentional
// sub-audio, near-silent, overblown, and anatomically impossible sounds.
export const JAW_HARP_RANDOM_LIMITS = Object.freeze({
  reedFrequencyHz: Object.freeze([50, 155]),
  reedDecaySeconds: Object.freeze([0.7, 6]),
  reedStiffness: Object.freeze([0.12, 0.92]),
  pluckForce: Object.freeze([0.48, 1.65]),
  pluckPosition: Object.freeze([0.14, 0.86]),
  mouthArticulation: Object.freeze([-1.2, 2.2]),
  glottisOpening: Object.freeze([-1, 2]),
  cavityCoupling: Object.freeze([0.18, 1.45]),
  frameCoupling: Object.freeze([0.16, 0.82]),
  breathDepth: Object.freeze([0.42, 1.65]),
  breathNoiseAmount: Object.freeze([0.12, 0.58]),
  breathFilter: Object.freeze([0.06, 0.82]),
  breathRateBpm: Object.freeze([10, 280]),
  breathBalance: Object.freeze([0.14, 0.86]),
  formantFocus: Object.freeze([-0.75, 2.25]),
  dryResonance: Object.freeze([0.12, 0.72]),
  dryResonanceWithoutBreath: Object.freeze([0.2, 0.72]),
  effectiveBreathRateBpm: Object.freeze([8, 360]),
});

export const JAW_HARP_MODE_COUNT = 96;
export const MAX_TINE_PULL = 2.5;
export const JAW_HARP_STYLE_CUSTOM_ID = "custom";
export const JAW_HARP_VOWEL_SEQUENCE_MODES = Object.freeze(["off", "pluck", "breath"]);

// Material constants are representative longitudinal values, rather than exact
// measurements of any one instrument. Geometry still sets the tuned fundamental.
const REFERENCE_STEEL_SPECIFIC_MODULUS = 200e9 / 7_800;

export const JAW_HARP_DEFAULTS = Object.freeze({
  presetId: "khomus",
  styleId: "cartoon-boing",
  vowelId: "a",
  vowelSequenceId: "a-i-o-i",
  vowelSequenceMode: "off",
  reedFrequencyHz: 76,
  reedDecaySeconds: 4.4,
  reedStiffness: 0.72,
  pluckForce: 0.92,
  pluckPosition: 0.29,
  pluckDirection: 1,
  tonguePosition: 0.48,
  tongueHeight: 0.22,
  jawOpening: 0.72,
  lipRounding: 0.08,
  glottisOpening: 0.42,
  cavityCoupling: 0.82,
  frameCoupling: 0.4,
  breathDepth: 0.72,
  breathNoiseAmount: 0.32,
  breathFilter: 0.36,
  breathRateBpm: 42,
  breathBalance: 0.46,
  breathFlow: 0,
  autoBreath: true,
  formantFocus: 0.48,
  repeatRateBpm: 148,
  repeatSwing: 0.08,
  repeat: false,
  rhythmId: "quarter-eighths",
  breathLinked: true,
  breathsPerLoop: 1,
  dryResonance: 0.14,
  level: 0.52,
});

function freezeSettings(settings) {
  return Object.freeze({ ...settings });
}

export const JAW_HARP_PRESETS = Object.freeze([
  Object.freeze({
    id: "khomus",
    label: "Temir khomus",
    family: "forged steel",
    description: "Low, elastic steel tongue with a long bloom and a strong, dark harmonic ladder.",
    settings: freezeSettings({
      reedFrequencyHz: 76,
      reedDecaySeconds: 4.4,
      reedStiffness: 0.72,
      pluckForce: 0.92,
      pluckPosition: 0.29,
      frameCoupling: 0.4,
    }),
    material: freezeSettings({
      brightness: 0.72, inharmonicity: 1.25, lossTilt: 0.72,
      frameRatio: 0.78, frameBandwidth: 0.72, contact: 0.86, airResponse: 0.88,
      youngsModulusGPa: 200, densityKgM3: 7_800,
      internalLossFactor: 0.0001, elasticLimitStrain: 0.009,
    }),
  }),
  Object.freeze({
    id: "munnharpe",
    label: "Munnharpe",
    family: "tempered steel",
    description: "A taut, bright Nordic steel reed with a focused attack and clearly separated partials.",
    settings: freezeSettings({
      reedFrequencyHz: 92,
      reedDecaySeconds: 2.7,
      reedStiffness: 0.82,
      pluckForce: 0.66,
      pluckPosition: 0.24,
      frameCoupling: 0.48,
    }),
    material: freezeSettings({
      brightness: 1.34, inharmonicity: 1.12, lossTilt: 1.18,
      frameRatio: 1.32, frameBandwidth: 0.58, contact: 1.2, airResponse: 1.08,
      youngsModulusGPa: 210, densityKgM3: 7_800,
      internalLossFactor: 0.00008, elasticLimitStrain: 0.0095,
    }),
  }),
  Object.freeze({
    id: "marranzanu",
    label: "Marranzanu",
    family: "iron frame",
    description: "A compact Sicilian profile: dry frame knock, firm mid reed, and a quick speaking response.",
    settings: freezeSettings({
      reedFrequencyHz: 108,
      reedDecaySeconds: 1.9,
      reedStiffness: 0.76,
      pluckForce: 0.78,
      pluckPosition: 0.2,
      frameCoupling: 0.62,
    }),
    material: freezeSettings({
      brightness: 1.08, inharmonicity: 0.92, lossTilt: 1.46,
      frameRatio: 1.72, frameBandwidth: 1.34, contact: 1.52, airResponse: 0.82,
      youngsModulusGPa: 200, densityKgM3: 7_850,
      internalLossFactor: 0.00024, elasticLimitStrain: 0.0065,
    }),
  }),
  Object.freeze({
    id: "kubing",
    label: "Kubing",
    family: "split bamboo",
    description: "A light bamboo lamella with a soft fundamental, short decay, and woody frame radiation.",
    settings: freezeSettings({
      reedFrequencyHz: 56,
      reedDecaySeconds: 0.62,
      reedStiffness: 0.28,
      pluckForce: 0.58,
      pluckPosition: 0.46,
      frameCoupling: 0.74,
    }),
    material: freezeSettings({
      brightness: 0.48, inharmonicity: 0.38, lossTilt: 2.08,
      frameRatio: 0.58, frameBandwidth: 0.92, contact: 0.54, airResponse: 0.68,
      youngsModulusGPa: 10.6, densityKgM3: 630,
      internalLossFactor: 0.015, elasticLimitStrain: 0.006,
    }),
  }),
  Object.freeze({
    id: "dan-moi",
    label: "Dan moi",
    family: "brass lamella",
    description: "A light brass lip harp with a fast, bright reed and intimate mouth coupling.",
    settings: freezeSettings({
      reedFrequencyHz: 126,
      reedDecaySeconds: 2.25,
      reedStiffness: 0.56,
      pluckForce: 0.48,
      pluckPosition: 0.4,
      frameCoupling: 0.24,
    }),
    material: freezeSettings({
      brightness: 1.62, inharmonicity: 0.74, lossTilt: 0.94,
      frameRatio: 1.08, frameBandwidth: 0.5, contact: 0.62, airResponse: 1.34,
      youngsModulusGPa: 105, densityKgM3: 8_500,
      internalLossFactor: 0.0015, elasticLimitStrain: 0.0035,
    }),
  }),
]);

export const VOWEL_PRESETS = Object.freeze([
  Object.freeze({ id: "a", label: "A", phoneme: "/ɑ/", settings: freezeSettings({
    tonguePosition: 0.48, tongueHeight: 0.22, jawOpening: 0.72, lipRounding: 0.08,
  }) }),
  Object.freeze({ id: "e", label: "E", phoneme: "/e/", settings: freezeSettings({
    tonguePosition: 0.73, tongueHeight: 0.58, jawOpening: 0.38, lipRounding: 0.05,
  }) }),
  Object.freeze({ id: "i", label: "I", phoneme: "/i/", settings: freezeSettings({
    tonguePosition: 0.9, tongueHeight: 0.84, jawOpening: 0.2, lipRounding: 0.01,
  }) }),
  Object.freeze({ id: "o", label: "O", phoneme: "/o/", settings: freezeSettings({
    tonguePosition: 0.26, tongueHeight: 0.48, jawOpening: 0.46, lipRounding: 0.76,
  }) }),
  Object.freeze({ id: "u", label: "U", phoneme: "/u/", settings: freezeSettings({
    tonguePosition: 0.12, tongueHeight: 0.84, jawOpening: 0.18, lipRounding: 0.94,
  }) }),
]);

export const JAW_HARP_VOWEL_SEQUENCES = Object.freeze([
  Object.freeze({
    id: "a-i-o-i",
    label: "A · I · O · I",
    steps: Object.freeze(["a", "i", "o", "i"]),
  }),
  Object.freeze({
    id: "a-e-i-o-u",
    label: "A · E · I · O · U",
    steps: Object.freeze(["a", "e", "i", "o", "u"]),
  }),
  Object.freeze({
    id: "u-o-a-e-i-e",
    label: "U · O · A · E · I · E",
    steps: Object.freeze(["u", "o", "a", "e", "i", "e"]),
  }),
  Object.freeze({
    id: "a-o-e-a",
    label: "A · O · E · A",
    steps: Object.freeze(["a", "o", "e", "a"]),
  }),
  Object.freeze({
    id: "i-e-a-i-u-e",
    label: "I · E · A · I · U · E",
    steps: Object.freeze(["i", "e", "a", "i", "u", "e"]),
  }),
  Object.freeze({
    id: "u-a-i-a",
    label: "U · A · I · A",
    steps: Object.freeze(["u", "a", "i", "a"]),
  }),
]);

export const JAW_HARP_RHYTHMS = Object.freeze([
  Object.freeze({ id: "quarter-eighths", label: "Quarter · eighth · eighth", steps: Object.freeze([1, 0, 0.82, 0.72]) }),
  Object.freeze({ id: "tresillo", label: "Tresillo 3–3–2", steps: Object.freeze([1, 0, 0, 0.78, 0, 0, 0.88, 0]) }),
  Object.freeze({ id: "two-one", label: "Two close · one far", steps: Object.freeze([1, 0.7, 0, 0, 0.86, 0, 0, 0]) }),
  Object.freeze({ id: "five-step", label: "Five-step lilt", steps: Object.freeze([1, 0, 0.62, 0, 0.83]) }),
  Object.freeze({ id: "soft-machine", label: "Soft / hard / ghost", steps: Object.freeze([0.42, 0, 1, 0, 0.2, 0.72, 0, 0]) }),
  Object.freeze({ id: "sparse-seven", label: "Sparse seven", steps: Object.freeze([1, 0, 0, 0.58, 0, 0.8, 0]) }),
]);

// A style is a performer, not another instrument body. These keys shape the
// mouth, breath, and hand clock while leaving every physical preset setting,
// the output level, and the current transport state untouched.
export const JAW_HARP_STYLE_SETTING_KEYS = Object.freeze([
  "pluckDirection",
  "tonguePosition",
  "tongueHeight",
  "jawOpening",
  "lipRounding",
  "glottisOpening",
  "formantFocus",
  "cavityCoupling",
  "breathDepth",
  "breathFilter",
  "breathRateBpm",
  "breathBalance",
  "autoBreath",
  "repeatRateBpm",
  "repeatSwing",
  "rhythmId",
  "breathLinked",
  "breathsPerLoop",
  "vowelSequenceId",
  "vowelSequenceMode",
]);

// Per-strike expression is intentionally narrower than the whole style layer:
// a gesture may animate the resonating tract, but never alter clocks, breath,
// direction, transport, or any part of the physical instrument.
export const JAW_HARP_STYLE_GESTURE_KEYS = Object.freeze([
  "tonguePosition",
  "tongueHeight",
  "jawOpening",
  "lipRounding",
  "glottisOpening",
  "formantFocus",
  "cavityCoupling",
]);

function freezeStyleReference({ source, settings, gestureSteps = [], ...style }) {
  return Object.freeze({
    ...style,
    source: Object.freeze({ ...source }),
    settings: freezeSettings(settings),
    gestureSteps: Object.freeze(gestureSteps.map((step) => freezeSettings(step))),
  });
}

export const JAW_HARP_STYLE_REFERENCES = Object.freeze([
  freezeStyleReference({
    id: "cartoon-boing",
    label: "Cartoon Boing",
    recommendedPresetId: "khomus",
    description: "Bright elastic studio twang with a clear contact snap and a roomy vowel bloom.",
    source: {
      label: "Snoopy-style jaw-harp reference",
      url: "https://freesound.org/people/jcookvoice/sounds/594168/",
      license: "CC0 1.0",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.48,
      tongueHeight: 0.22,
      jawOpening: 0.72,
      lipRounding: 0.08,
      glottisOpening: 0.42,
      formantFocus: 0.48,
      cavityCoupling: 0.82,
      breathDepth: 0.72,
      breathFilter: 0.36,
      breathRateBpm: 42,
      breathBalance: 0.46,
      autoBreath: true,
      repeatRateBpm: 148,
      repeatSwing: 0.08,
      rhythmId: "quarter-eighths",
      breathLinked: true,
      breathsPerLoop: 1,
      vowelSequenceId: "a-i-o-i",
      vowelSequenceMode: "off",
    },
  }),
  freezeStyleReference({
    id: "deep-overtone",
    label: "Deep Overtone",
    recommendedPresetId: "khomus",
    description: "Slow Sakha-inspired breathing with a closed glottis and a high, singing harmonic focus.",
    source: {
      label: "Yakut khomus demonstration",
      url: "https://commons.wikimedia.org/wiki/File:Klangdemonstration_einer_jakutischen_Maultrommel_-_der_Khomus_aus_Sibirien.wav",
      license: "CC BY-SA 4.0",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.62,
      tongueHeight: 0.7,
      jawOpening: 0.28,
      lipRounding: 0.12,
      glottisOpening: 0.05,
      formantFocus: 1.34,
      cavityCoupling: 1.12,
      breathDepth: 0.88,
      breathFilter: 0.16,
      breathRateBpm: 24,
      breathBalance: 0.58,
      autoBreath: true,
      repeatRateBpm: 86,
      repeatSwing: 0.1,
      rhythmId: "sparse-seven",
      breathLinked: true,
      breathsPerLoop: 0.5,
      vowelSequenceId: "u-o-a-e-i-e",
      vowelSequenceMode: "off",
    },
    gestureSteps: [
      { tongueHeight: 0.54, jawOpening: 0.42, glottisOpening: 0.02, formantFocus: 0.72 },
      { tongueHeight: 0.66, jawOpening: 0.34, glottisOpening: -0.04, formantFocus: 1.08 },
      { tongueHeight: 0.76, jawOpening: 0.25, glottisOpening: 0.04, formantFocus: 1.48 },
      { tongueHeight: 0.84, jawOpening: 0.18, glottisOpening: -0.08, formantFocus: 1.88 },
    ],
  }),
  freezeStyleReference({
    id: "nordic-dance",
    label: "Nordic Dance",
    recommendedPresetId: "munnharpe",
    description: "Bright, tightly focused mouth resonance riding a lightly swung Scandinavian dance pulse.",
    source: {
      label: "Norwegian munnharpe course recordings",
      url: "https://www.munnharpe.no/kursmateriell",
      license: "Listening reference",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.76,
      tongueHeight: 0.56,
      jawOpening: 0.36,
      lipRounding: 0.03,
      glottisOpening: 0.28,
      formantFocus: 0.9,
      cavityCoupling: 0.96,
      breathDepth: 0.7,
      breathFilter: 0.52,
      breathRateBpm: 42,
      breathBalance: 0.5,
      autoBreath: true,
      repeatRateBpm: 132,
      repeatSwing: 0.16,
      rhythmId: "two-one",
      breathLinked: true,
      breathsPerLoop: 1,
      vowelSequenceId: "a-e-i-o-u",
      vowelSequenceMode: "off",
    },
    gestureSteps: [
      {
        tonguePosition: 0.42, tongueHeight: 0.3, jawOpening: 0.64,
        lipRounding: 0.08, glottisOpening: 0.38, formantFocus: 0.52,
      },
      {
        tonguePosition: 0.84, tongueHeight: 0.74, jawOpening: 0.2,
        lipRounding: 0.02, glottisOpening: 0.16, formantFocus: 1.14,
      },
    ],
  }),
  freezeStyleReference({
    id: "morsing-pulse",
    label: "Morsing Pulse",
    recommendedPresetId: "marranzanu",
    description: "Dry tooth-coupled attacks and a driving three-accent Indian rhythmic cycle.",
    source: {
      label: "Indian morchang demonstration",
      url: "https://commons.wikimedia.org/wiki/File:Klangdemonstration_einer_indischen_Maultrommel.wav",
      license: "CC BY-SA 4.0",
    },
    settings: {
      pluckDirection: -1,
      tonguePosition: 0.68,
      tongueHeight: 0.46,
      jawOpening: 0.32,
      lipRounding: 0.02,
      glottisOpening: 0.36,
      formantFocus: 1.18,
      cavityCoupling: 0.7,
      breathDepth: 0.46,
      breathFilter: 0.3,
      breathRateBpm: 48,
      breathBalance: 0.5,
      autoBreath: true,
      repeatRateBpm: 168,
      repeatSwing: -0.06,
      rhythmId: "tresillo",
      breathLinked: true,
      breathsPerLoop: 2,
      vowelSequenceId: "a-o-e-a",
      vowelSequenceMode: "off",
    },
    gestureSteps: [
      { tonguePosition: 0.54, glottisOpening: 0.24, formantFocus: 0.68 },
      { tonguePosition: 0.76, glottisOpening: 0.42, formantFocus: 1.16 },
      { tonguePosition: 0.64, glottisOpening: 0.18, formantFocus: 1.52 },
    ],
  }),
  freezeStyleReference({
    id: "dan-moi-speech",
    label: "Dan Moi Speech",
    recommendedPresetId: "dan-moi",
    description: "Airy lip-harp articulation with an intimate high-vowel color and quick phrases.",
    source: {
      label: "Vietnamese dan moi recording",
      url: "https://commons.wikimedia.org/wiki/File:Dan_moi.ogg",
      license: "CC BY-SA 4.0",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.88,
      tongueHeight: 0.78,
      jawOpening: 0.22,
      lipRounding: 0.08,
      glottisOpening: 0.62,
      formantFocus: 1.55,
      cavityCoupling: 1.1,
      breathDepth: 0.58,
      breathFilter: 0.68,
      breathRateBpm: 64,
      breathBalance: 0.35,
      autoBreath: true,
      repeatRateBpm: 154,
      repeatSwing: 0.05,
      rhythmId: "tresillo",
      breathLinked: true,
      breathsPerLoop: 2,
      vowelSequenceId: "a-e-i-o-u",
      vowelSequenceMode: "off",
    },
    gestureSteps: [
      {
        tonguePosition: 0.48, tongueHeight: 0.22, jawOpening: 0.72,
        lipRounding: 0.08, glottisOpening: 0.54, formantFocus: 0.44,
      },
      {
        tonguePosition: 0.73, tongueHeight: 0.58, jawOpening: 0.38,
        lipRounding: 0.05, glottisOpening: 0.64, formantFocus: 0.9,
      },
      {
        tonguePosition: 0.9, tongueHeight: 0.84, jawOpening: 0.2,
        lipRounding: 0.01, glottisOpening: 0.7, formantFocus: 1.48,
      },
      {
        tonguePosition: 0.26, tongueHeight: 0.48, jawOpening: 0.46,
        lipRounding: 0.76, glottisOpening: 0.48, formantFocus: 0.72,
      },
      {
        tonguePosition: 0.12, tongueHeight: 0.84, jawOpening: 0.18,
        lipRounding: 0.94, glottisOpening: 0.4, formantFocus: 1.08,
      },
    ],
  }),
  freezeStyleReference({
    id: "sicilian-chatter",
    label: "Sicilian Chatter",
    recommendedPresetId: "marranzanu",
    description: "Firm, bright iron-frame chatter with asymmetric accents and animated exhaled color.",
    source: {
      label: "Sicilian marranzano demonstration",
      url: "https://commons.wikimedia.org/wiki/File:Klangdemonstration_einer_sizilianischen_Maultrommel.wav",
      license: "CC BY-SA 4.0",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.32,
      tongueHeight: 0.34,
      jawOpening: 0.58,
      lipRounding: 0.22,
      glottisOpening: 0.55,
      formantFocus: 1.1,
      cavityCoupling: 0.76,
      breathDepth: 0.92,
      breathFilter: 0.54,
      breathRateBpm: 56,
      breathBalance: 0.38,
      autoBreath: true,
      repeatRateBpm: 184,
      repeatSwing: -0.09,
      rhythmId: "five-step",
      breathLinked: true,
      breathsPerLoop: 2,
      vowelSequenceId: "a-i-o-i",
      vowelSequenceMode: "off",
    },
    gestureSteps: [
      { tonguePosition: 0.22, jawOpening: 0.64, glottisOpening: 0.68, formantFocus: 0.72 },
      { tonguePosition: 0.46, jawOpening: 0.46, glottisOpening: 0.42, formantFocus: 1.28 },
      { tonguePosition: 0.34, jawOpening: 0.56, glottisOpening: 0.58, formantFocus: 0.94 },
    ],
  }),
  freezeStyleReference({
    id: "water-thread",
    label: "Water Thread",
    recommendedPresetId: "khomus",
    description: "Tuvan xomuz-inspired fluid overtone ripples with a slow, independent breath and a six-vowel current.",
    source: {
      label: "Anatoli Kuular — Xomuz Imitating Water",
      url: "https://folkways.si.edu/anatoli-kuular/xomuz-jews-harp-imitating-water/world/music/track/smithsonian",
      license: "Listening reference",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.2,
      tongueHeight: 0.76,
      jawOpening: 0.32,
      lipRounding: 0.86,
      glottisOpening: 0.22,
      formantFocus: 1.42,
      cavityCoupling: 1.14,
      breathDepth: 0.85,
      breathFilter: 0.22,
      breathRateBpm: 28,
      breathBalance: 0.5,
      autoBreath: true,
      repeatRateBpm: 108,
      repeatSwing: -0.06,
      rhythmId: "soft-machine",
      breathLinked: false,
      breathsPerLoop: 0.5,
      vowelSequenceId: "u-o-a-e-i-e",
      vowelSequenceMode: "breath",
    },
    gestureSteps: [
      { glottisOpening: 0.12, formantFocus: 0.62, cavityCoupling: 1.25 },
      { glottisOpening: 0.48, formantFocus: 1.55, cavityCoupling: 0.9 },
      { glottisOpening: 0.2, formantFocus: 1.9, cavityCoupling: 1.16 },
    ],
  }),
  freezeStyleReference({
    id: "setesdal-springar",
    label: "Norwegian Springar",
    recommendedPresetId: "munnharpe",
    description: "Norwegian springar–inspired uneven triple lift with crisp steel accents and a compact dancing vowel phrase.",
    source: {
      label: "Norsk Munnharpeforum course performances",
      url: "https://www.munnharpe.no/kursmateriell",
      license: "Listening reference",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.68,
      tongueHeight: 0.58,
      jawOpening: 0.38,
      lipRounding: 0.05,
      glottisOpening: 0.28,
      formantFocus: 1.02,
      cavityCoupling: 0.94,
      breathDepth: 0.42,
      breathFilter: 0.48,
      breathRateBpm: 36,
      breathBalance: 0.48,
      autoBreath: true,
      repeatRateBpm: 124,
      repeatSwing: 0.18,
      rhythmId: "two-one",
      breathLinked: true,
      breathsPerLoop: 1,
      vowelSequenceId: "a-e-i-o-u",
      vowelSequenceMode: "pluck",
    },
    gestureSteps: [
      { glottisOpening: 0.2, formantFocus: 0.7, cavityCoupling: 0.92 },
      { glottisOpening: 0.35, formantFocus: 1.35, cavityCoupling: 1.02 },
    ],
  }),
  freezeStyleReference({
    id: "tarantella-jug",
    label: "Tarantella & Jug",
    recommendedPresetId: "marranzanu",
    description: "Sicilian-inspired fast iron-frame rattle, open-jaw vowels, and an asymmetric five-step dance.",
    source: {
      label: "Smithsonian Folkways — Folk Music from Italy",
      url: "https://folkways.si.edu/folk-music-from-italy/world/album/smithsonian",
      license: "Listening reference",
    },
    settings: {
      pluckDirection: -1,
      tonguePosition: 0.54,
      tongueHeight: 0.38,
      jawOpening: 0.7,
      lipRounding: 0.12,
      glottisOpening: 0.56,
      formantFocus: 1.08,
      cavityCoupling: 0.72,
      breathDepth: 0.52,
      breathFilter: 0.5,
      breathRateBpm: 58,
      breathBalance: 0.44,
      autoBreath: true,
      repeatRateBpm: 202,
      repeatSwing: -0.08,
      rhythmId: "five-step",
      breathLinked: true,
      breathsPerLoop: 2,
      vowelSequenceId: "a-e-i-o-u",
      vowelSequenceMode: "pluck",
    },
    gestureSteps: [
      { glottisOpening: 0.45, formantFocus: 0.66, cavityCoupling: 0.62 },
      { glottisOpening: 0.7, formantFocus: 1.38, cavityCoupling: 0.85 },
      { glottisOpening: 0.52, formantFocus: 1.02, cavityCoupling: 0.7 },
    ],
  }),
  freezeStyleReference({
    id: "sulfurara-call",
    label: "Sulfurara Call",
    recommendedPresetId: "marranzanu",
    description: "A slow Sicilian sulfur-mine-call–inspired response: broad vowels, long air arcs, and sparse knocks.",
    source: {
      label: "Carnegie Hall — Sicilian musical traditions",
      url: "https://www.carnegiehall.org/Education/Programs/Musical-Explorers/Digital/Program-Eight/Julia",
      license: "Listening and cultural reference",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.36,
      tongueHeight: 0.26,
      jawOpening: 0.82,
      lipRounding: 0.2,
      glottisOpening: 0.4,
      formantFocus: 0.72,
      cavityCoupling: 0.96,
      breathDepth: 1.1,
      breathFilter: 0.14,
      breathRateBpm: 18,
      breathBalance: 0.66,
      autoBreath: true,
      repeatRateBpm: 74,
      repeatSwing: 0.12,
      rhythmId: "sparse-seven",
      breathLinked: false,
      breathsPerLoop: 0.5,
      vowelSequenceId: "a-o-e-a",
      vowelSequenceMode: "breath",
    },
    gestureSteps: [
      { glottisOpening: 0.18, formantFocus: 0.48, cavityCoupling: 1.08 },
      { glottisOpening: 0.7, formantFocus: 1.22, cavityCoupling: 0.82 },
      { glottisOpening: 0.25, formantFocus: 0.7, cavityCoupling: 1.02 },
    ],
  }),
  freezeStyleReference({
    id: "maguindanao-message",
    label: "Maguindanao Rhythm",
    recommendedPresetId: "kubing",
    description: "Maguindanao kubing–inspired rhythmic cells, woody ghost hits, and mouth-shaped repetition.",
    source: {
      label: "Smithsonian Folkways — Kubing Rhythm (7.5 / 3.75 ips)",
      url: "https://folkways.si.edu/kubing/kubing-rhythms-and-speech-phrases/world/music/track/smithsonian",
      license: "Listening reference",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.52,
      tongueHeight: 0.48,
      jawOpening: 0.46,
      lipRounding: 0.16,
      glottisOpening: 0.42,
      formantFocus: 0.86,
      cavityCoupling: 0.72,
      breathDepth: 0.3,
      breathFilter: 0.2,
      breathRateBpm: 44,
      breathBalance: 0.5,
      autoBreath: true,
      repeatRateBpm: 136,
      repeatSwing: 0.04,
      rhythmId: "soft-machine",
      breathLinked: true,
      breathsPerLoop: 2,
      vowelSequenceId: "a-e-i-o-u",
      vowelSequenceMode: "pluck",
    },
    gestureSteps: [
      { glottisOpening: 0.3, formantFocus: 0.5, cavityCoupling: 0.55 },
      { glottisOpening: 0.55, formantFocus: 1.25, cavityCoupling: 0.85 },
      { glottisOpening: 0.38, formantFocus: 0.92, cavityCoupling: 0.7 },
    ],
  }),
  freezeStyleReference({
    id: "ncas-night-dialogue",
    label: "Ncas Night Dialogue",
    recommendedPresetId: "dan-moi",
    description: "Hmong mouth-harp–inspired close-mouthed question-and-answer phrases with a slow breath dialogue.",
    source: {
      label: "Cultural Crossroads Asia — Hmong Mouth Harp",
      url: "https://culturalcrossroadsasia.org/collection/hmong-mouth-harp-2/",
      license: "Listening and cultural reference",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.84,
      tongueHeight: 0.76,
      jawOpening: 0.24,
      lipRounding: 0.1,
      glottisOpening: 0.5,
      formantFocus: 1.28,
      cavityCoupling: 1.04,
      breathDepth: 0.24,
      breathFilter: 0.24,
      breathRateBpm: 26,
      breathBalance: 0.56,
      autoBreath: true,
      repeatRateBpm: 106,
      repeatSwing: 0.2,
      rhythmId: "two-one",
      breathLinked: true,
      breathsPerLoop: 0.5,
      vowelSequenceId: "i-e-a-i-u-e",
      vowelSequenceMode: "breath",
    },
    gestureSteps: [
      { glottisOpening: 0.35, formantFocus: 0.8, cavityCoupling: 0.9 },
      { glottisOpening: 0.7, formantFocus: 1.65, cavityCoupling: 1.12 },
    ],
  }),
  freezeStyleReference({
    id: "appalachian-corn-shuck",
    label: "Appalachian Corn-Shuck",
    recommendedPresetId: "munnharpe",
    description: "Appalachian old-time–inspired clipped 2/4 drive, ensemble accents, and a four-vowel breakdown turn.",
    source: {
      label: "Birthplace of Country Music — Bristol Sessions instrument guide",
      url: "https://birthplaceofcountrymusic.org/wp-content/uploads/2022/01/BCMM_InstrumentResourceTeacher.pdf",
      license: "Historical and listening reference",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.58,
      tongueHeight: 0.4,
      jawOpening: 0.52,
      lipRounding: 0.08,
      glottisOpening: 0.42,
      formantFocus: 0.78,
      cavityCoupling: 0.68,
      breathDepth: 0.28,
      breathFilter: 0.4,
      breathRateBpm: 48,
      breathBalance: 0.5,
      autoBreath: true,
      repeatRateBpm: 188,
      repeatSwing: 0.02,
      rhythmId: "quarter-eighths",
      breathLinked: true,
      breathsPerLoop: 2,
      vowelSequenceId: "a-o-e-a",
      vowelSequenceMode: "pluck",
    },
    gestureSteps: [
      { glottisOpening: 0.36, formantFocus: 0.48, cavityCoupling: 0.58 },
      { glottisOpening: 0.48, formantFocus: 1.1, cavityCoupling: 0.78 },
    ],
  }),
  freezeStyleReference({
    id: "southern-jawharp-blues",
    label: "Southern Jawharp Blues",
    recommendedPresetId: "khomus",
    description: "Southern blues–inspired heavy shuffle with breath-shaped call and response between low and bright vowels.",
    source: {
      label: "Sonny Terry — New Sound: Jawharp in Blues and Folk Music",
      url: "https://folkways.si.edu/sonny-terry/new-sound-jawharp-in-blues-and-folk-music-with-brownie-mcghee-and-j-c-burris/music/album/smithsonian",
      license: "Listening reference",
    },
    settings: {
      pluckDirection: -1,
      tonguePosition: 0.46,
      tongueHeight: 0.3,
      jawOpening: 0.66,
      lipRounding: 0.18,
      glottisOpening: 0.42,
      formantFocus: 0.72,
      cavityCoupling: 0.98,
      breathDepth: 0.88,
      breathFilter: 0.38,
      breathRateBpm: 22,
      breathBalance: 0.62,
      autoBreath: true,
      repeatRateBpm: 92,
      repeatSwing: 0.3,
      rhythmId: "two-one",
      breathLinked: true,
      breathsPerLoop: 0.5,
      vowelSequenceId: "a-o-e-a",
      vowelSequenceMode: "breath",
    },
    gestureSteps: [
      { glottisOpening: 0.15, formantFocus: 0.5, cavityCoupling: 1.12 },
      { glottisOpening: 0.75, formantFocus: 1.25, cavityCoupling: 0.86 },
    ],
  }),
  freezeStyleReference({
    id: "double-take-bounce",
    label: "Double-Take Bounce",
    recommendedPresetId: "khomus",
    description: "A paired cartoon jump: rounded setup, bright surprise, then a delayed elastic answer.",
    source: {
      label: "suzenako — Two cartoon jumps",
      url: "https://freesound.org/people/suzenako/sounds/537060/",
      license: "CC0 1.0",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.44,
      tongueHeight: 0.44,
      jawOpening: 0.58,
      lipRounding: 0.64,
      glottisOpening: 0.34,
      formantFocus: 0.88,
      cavityCoupling: 0.9,
      breathDepth: 0.55,
      breathFilter: 0.42,
      breathRateBpm: 70,
      breathBalance: 0.44,
      autoBreath: true,
      repeatRateBpm: 156,
      repeatSwing: 0.24,
      rhythmId: "two-one",
      breathLinked: true,
      breathsPerLoop: 2,
      vowelSequenceId: "u-a-i-a",
      vowelSequenceMode: "pluck",
    },
    gestureSteps: [
      { glottisOpening: 0.18, formantFocus: 0.35, cavityCoupling: 1.05 },
      { glottisOpening: 0.55, formantFocus: 1.55, cavityCoupling: 0.65 },
    ],
  }),
  freezeStyleReference({
    id: "studio-sproing",
    label: "Studio Sproing",
    recommendedPresetId: "khomus",
    description: "A compact Foley boing with a low rounded launch, high-vowel snap, and quick comic rebound.",
    source: {
      label: "BigSoundBank — Boing cartoon #1",
      url: "https://bigsoundbank.com/boing-cartoon-1-s2277.html",
      license: "CC0 / public domain",
    },
    settings: {
      pluckDirection: 1,
      tonguePosition: 0.38,
      tongueHeight: 0.38,
      jawOpening: 0.62,
      lipRounding: 0.72,
      glottisOpening: 0.3,
      formantFocus: 0.64,
      cavityCoupling: 1.02,
      breathDepth: 0.62,
      breathFilter: 0.58,
      breathRateBpm: 66,
      breathBalance: 0.4,
      autoBreath: true,
      repeatRateBpm: 116,
      repeatSwing: 0.16,
      rhythmId: "soft-machine",
      breathLinked: true,
      breathsPerLoop: 1,
      vowelSequenceId: "u-a-i-a",
      vowelSequenceMode: "pluck",
    },
    gestureSteps: [
      { glottisOpening: 0.2, formantFocus: 0.3, cavityCoupling: 1.08 },
      { glottisOpening: 0.5, formantFocus: 1.6, cavityCoupling: 0.76 },
      { glottisOpening: 0.32, formantFocus: 0.84, cavityCoupling: 0.94 },
    ],
  }),
]);

export function jawHarpPreset(id) {
  return JAW_HARP_PRESETS.find((preset) => preset.id === id) ?? JAW_HARP_PRESETS[0];
}

export function jawHarpStyle(id) {
  return JAW_HARP_STYLE_REFERENCES.find((style) => style.id === id) ?? null;
}

export function jawHarpStyleGesture(id, step = 0) {
  const gestures = jawHarpStyle(id)?.gestureSteps;
  if (!gestures?.length) return null;
  const index = ((Math.trunc(finiteOr(step, 0)) % gestures.length) + gestures.length)
    % gestures.length;
  return gestures[index];
}

export function reedMaterialProperties(source = JAW_HARP_DEFAULTS) {
  const presetId = typeof source === "string" ? source : source?.presetId;
  const preset = jawHarpPreset(presetId);
  const material = preset.material;
  const youngsModulusPa = material.youngsModulusGPa * 1e9;
  const specificModulusM2S2 = youngsModulusPa / material.densityKgM3;
  const waveSpeedMps = Math.sqrt(specificModulusM2S2);
  const dampingRatio = material.internalLossFactor * 0.5;
  const intrinsicCycleRetention = Math.exp(-Math.PI * material.internalLossFactor);
  return Object.freeze({
    presetId: preset.id,
    youngsModulusPa,
    densityKgM3: material.densityKgM3,
    specificModulusM2S2,
    specificModulusRatio: specificModulusM2S2 / REFERENCE_STEEL_SPECIFIC_MODULUS,
    waveSpeedMps,
    internalLossFactor: material.internalLossFactor,
    dampingRatio,
    intrinsicCycleRetention,
    elasticLimitStrain: material.elasticLimitStrain,
  });
}

export function vowelPreset(id) {
  return VOWEL_PRESETS.find((preset) => preset.id === id) ?? VOWEL_PRESETS[0];
}

export function jawHarpVowelSequence(id) {
  return JAW_HARP_VOWEL_SEQUENCES.find((sequence) => sequence.id === id)
    ?? JAW_HARP_VOWEL_SEQUENCES[0];
}

export function jawHarpVowelSequenceStep(id, step = 0) {
  const sequence = jawHarpVowelSequence(id);
  const finiteStep = Number.isFinite(Number(step)) ? Math.trunc(Number(step)) : 0;
  const index = ((finiteStep % sequence.steps.length) + sequence.steps.length)
    % sequence.steps.length;
  return vowelPreset(sequence.steps[index]);
}

export function sanitizeJawHarpState(source = {}, fallback = JAW_HARP_DEFAULTS) {
  const state = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : JAW_HARP_DEFAULTS;
  const result = {};
  for (const [key, limits] of Object.entries(JAW_HARP_LIMITS)) {
    result[key] = clamp(
      finiteOr(state[key], finiteOr(base[key], JAW_HARP_DEFAULTS[key])),
      limits[0],
      limits[1],
    );
  }
  const direction = finiteOr(state.pluckDirection, finiteOr(base.pluckDirection, 1));
  result.pluckDirection = direction < 0 ? -1 : 1;
  result.repeat = Boolean(state.repeat ?? base.repeat ?? false);
  result.autoBreath = Boolean(state.autoBreath ?? base.autoBreath ?? true);
  result.breathLinked = Boolean(state.breathLinked ?? base.breathLinked ?? true);
  result.rhythmId = jawHarpRhythm(state.rhythmId ?? base.rhythmId).id;
  result.presetId = jawHarpPreset(state.presetId ?? base.presetId).id;
  const styleId = state.styleId ?? base.styleId ?? JAW_HARP_STYLE_CUSTOM_ID;
  result.styleId = styleId === JAW_HARP_STYLE_CUSTOM_ID || jawHarpStyle(styleId)
    ? styleId
    : JAW_HARP_STYLE_CUSTOM_ID;
  result.vowelId = VOWEL_PRESETS.some(({ id }) => id === state.vowelId)
    ? state.vowelId
    : (VOWEL_PRESETS.some(({ id }) => id === base.vowelId) ? base.vowelId : "a");
  result.vowelSequenceId = jawHarpVowelSequence(
    state.vowelSequenceId ?? base.vowelSequenceId,
  ).id;
  const sequenceMode = state.vowelSequenceMode ?? base.vowelSequenceMode;
  result.vowelSequenceMode = JAW_HARP_VOWEL_SEQUENCE_MODES.includes(sequenceMode)
    ? sequenceMode
    : "off";
  return result;
}

export function jawHarpState(presetId = "khomus", overrides = {}) {
  const preset = jawHarpPreset(presetId);
  return sanitizeJawHarpState({
    ...JAW_HARP_DEFAULTS,
    ...preset.settings,
    ...overrides,
    presetId: preset.id,
  });
}

export function applyVowel(state, vowelId) {
  const vowel = vowelPreset(vowelId);
  return sanitizeJawHarpState({
    ...state,
    ...vowel.settings,
    vowelId: vowel.id,
  }, state);
}

export function applyJawHarpStyle(source, styleId) {
  const state = sanitizeJawHarpState(source);
  const style = jawHarpStyle(styleId);
  if (!style) {
    return sanitizeJawHarpState({ ...state, styleId: JAW_HARP_STYLE_CUSTOM_ID }, state);
  }
  const settings = {};
  for (const key of JAW_HARP_STYLE_SETTING_KEYS) settings[key] = style.settings[key];
  return sanitizeJawHarpState({ ...state, ...settings, styleId: style.id }, state);
}

export function mouthGeometry(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  const front = state.tonguePosition;
  const height = state.tongueHeight;
  const jaw = state.jawOpening;
  const rounding = state.lipRounding;
  const glottis = state.glottisOpening;

  const lengthM = clamp(
    0.095 + (1 - front) * 0.075 + rounding * 0.038 + glottis * 0.018,
    0.012,
    0.65,
  );
  const volumeMl = clamp(
    28 + jaw * 72 + (1 - height) * 42 + glottis * 28,
    0.5,
    1_200,
  );
  const apertureCm2 = clamp(0.35 + jaw * 3.3 - rounding * 1.15, 0.002, 24);
  return Object.freeze({ lengthM, volumeMl, apertureCm2 });
}

export function mouthFormants(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  const front = state.tonguePosition;
  const height = state.tongueHeight;
  const jaw = state.jawOpening;
  const rounding = state.lipRounding;
  const glottis = state.glottisOpening;
  const first = clamp(
    235 + jaw * 510 + (1 - height) * 280 - rounding * 55 - glottis * 34,
    30,
    4_200,
  );
  const second = clamp(
    610 + front * 1_890 - rounding * 520 - (1 - height) * 80 - glottis * 42,
    first + 30,
    8_200,
  );
  const third = clamp(
    1_930 + front * 720 + jaw * 235 - rounding * 245 - glottis * 95,
    second + 40,
    9_400,
  );
  const focus = state.formantFocus;
  let focusFrequencyHz;
  if (focus < 0) {
    focusFrequencyHz = first * Math.pow(2, focus);
  } else if (focus <= 1) {
    focusFrequencyHz = first + (second - first) * focus;
  } else if (focus <= 2) {
    focusFrequencyHz = second + (third - second) * (focus - 1);
  } else {
    focusFrequencyHz = third * Math.pow(2, (focus - 2) * 0.7);
  }
  focusFrequencyHz = clamp(focusFrequencyHz, 30, 9_400);
  return Object.freeze({
    frequenciesHz: Object.freeze([first, second, third]),
    bandwidthsHz: Object.freeze([
      clamp(80 + jaw * 92 + glottis * 70, 8, 2_400),
      clamp(105 + (1 - height) * 135 + glottis * 85, 8, 2_800),
      clamp(170 + rounding * 145 + glottis * 110, 8, 3_200),
    ]),
    focusFrequencyHz,
    focusBandwidthHz: clamp(34 + Math.sqrt(focusFrequencyHz) * 2.8, 24, 420),
  });
}

export function dominantHarmonic(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  const { focusFrequencyHz } = mouthFormants(state);
  const index = clamp(Math.round(focusFrequencyHz / state.reedFrequencyHz), 1, JAW_HARP_MODE_COUNT);
  return Object.freeze({
    index,
    frequencyHz: index * state.reedFrequencyHz,
    centsOffset: 1_200 * Math.log2(focusFrequencyHz / (index * state.reedFrequencyHz)),
  });
}

export function reedModeFrequencies(source = JAW_HARP_DEFAULTS, count = 24) {
  const state = sanitizeJawHarpState(source);
  const physics = reedMaterialProperties(state);
  const amount = Math.max(1, Math.min(128, Math.round(finiteOr(count, 24))));
  return Object.freeze(Array.from({ length: amount }, (_, index) => {
    const harmonic = index + 1;
    const specificStiffness = clamp(Math.sqrt(physics.specificModulusRatio), 0.45, 1.35);
    const stretch = 1 + state.reedStiffness
      * (0.000023 + specificStiffness * 0.000012)
      * harmonic * harmonic;
    return state.reedFrequencyHz * harmonic * stretch;
  }));
}

export function tineDisplayFrequencyHz(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  return clamp(Math.sqrt(state.reedFrequencyHz) * 0.95, 5.5, 12);
}

// A time-expanded view of the same underdamped release. Actual jaw-harp reeds
// oscillate too quickly for a 60 Hz display, so one visual cycle represents one
// physical cycle while preserving the modeled loss per cycle.
export function tineReleaseMotion(
  source = JAW_HARP_DEFAULTS,
  elapsedSeconds = 0,
  force = source?.pluckForce,
  direction = source?.pluckDirection,
) {
  const state = sanitizeJawHarpState(source);
  const physics = reedMaterialProperties(state);
  const time = Math.max(0, finiteOr(elapsedSeconds, 0));
  const displayFrequencyHz = tineDisplayFrequencyHz(state);
  const cycles = time * displayFrequencyHz;
  const strength = clamp(
    finiteOr(force, state.pluckForce),
    JAW_HARP_LIMITS.pluckForce[0],
    JAW_HARP_LIMITS.pluckForce[1],
  );
  const normalizedForce = Math.log1p(strength * 1.5)
    / Math.log1p(JAW_HARP_LIMITS.pluckForce[1] * 1.5);
  const systemCycleRetention = Math.exp(
    -1 / Math.max(1e-6, state.reedFrequencyHz * state.reedDecaySeconds),
  );
  const cycleRetention = systemCycleRetention
    * Math.pow(physics.intrinsicCycleRetention, 0.12);
  const dampedCycles = cycles * Math.sqrt(Math.max(0, 1 - physics.dampingRatio ** 2));
  const presentationFade = cycles <= 5.25
    ? 1
    : Math.exp(-Math.pow((cycles - 5.25) / 1.15, 2));
  const side = finiteOr(direction, state.pluckDirection) < 0 ? -1 : 1;
  return side * normalizedForce
    * Math.pow(cycleRetention, cycles)
    * Math.cos(Math.PI * 2 * dampedCycles)
    * presentationFade;
}

export function repeatIntervalMs(rateBpm, step = 0, swing = 0) {
  const bpm = clamp(rateBpm, JAW_HARP_LIMITS.repeatRateBpm[0], JAW_HARP_LIMITS.repeatRateBpm[1]);
  const amount = clamp(swing, JAW_HARP_LIMITS.repeatSwing[0], JAW_HARP_LIMITS.repeatSwing[1]);
  const base = 60_000 / bpm;
  return base * (step % 2 === 0 ? 1 + amount : 1 - amount);
}

export function jawHarpRhythm(id) {
  return JAW_HARP_RHYTHMS.find((rhythm) => rhythm.id === id) ?? JAW_HARP_RHYTHMS[0];
}

export function repeatStepIntervalMs(rateBpm) {
  const bpm = clamp(rateBpm, JAW_HARP_LIMITS.repeatRateBpm[0], JAW_HARP_LIMITS.repeatRateBpm[1]);
  return 30_000 / bpm;
}

export function jawHarpRhythmHit(source = JAW_HARP_DEFAULTS, step = 0) {
  const state = sanitizeJawHarpState(source);
  const steps = jawHarpRhythm(state.rhythmId).steps;
  const index = ((Math.trunc(finiteOr(step, 0)) % steps.length) + steps.length) % steps.length;
  return Object.freeze({ index, velocity: steps[index], active: steps[index] > 0 });
}

export function jawHarpRhythmLoopMs(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  return jawHarpRhythm(state.rhythmId).steps.length * repeatStepIntervalMs(state.repeatRateBpm);
}

export function linkedBreathIntervalMs(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  return jawHarpRhythmLoopMs(state) / state.breathsPerLoop;
}

export function effectiveBreathRateBpm(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  if (!state.breathLinked) return state.breathRateBpm;
  const clockRate = 60_000 / linkedBreathIntervalMs(state);
  const performerMultiplier = state.breathRateBpm / JAW_HARP_DEFAULTS.breathRateBpm;
  return clamp(clockRate * performerMultiplier, 0.1, 7_200);
}

export function breathCycleFlow(source = JAW_HARP_DEFAULTS, phase = 0) {
  const state = sanitizeJawHarpState(source);
  const wrapped = ((finiteOr(phase, 0) % 1) + 1) % 1;
  if (wrapped < state.breathBalance) {
    const inhalePhase = wrapped / state.breathBalance;
    return -state.breathDepth * Math.sin(Math.PI * inhalePhase);
  }
  const exhalePhase = (wrapped - state.breathBalance) / (1 - state.breathBalance);
  return state.breathDepth * Math.sin(Math.PI * exhalePhase);
}

export function breathLobeBoundaryCount(startPhase = 0, elapsedCycles = 0, balance = 0.5) {
  const start = ((finiteOr(startPhase, 0) % 1) + 1) % 1;
  const end = start + Math.max(0, finiteOr(elapsedCycles, 0));
  const split = clamp(
    balance,
    JAW_HARP_LIMITS.breathBalance[0],
    JAW_HARP_LIMITS.breathBalance[1],
  );
  const epsilon = 1e-10;
  const crossed = (offset) => Math.max(
    0,
    Math.floor(end - offset + epsilon) - Math.floor(start - offset + epsilon),
  );
  return crossed(0) + crossed(split);
}

export function breathCycleIntervalMs(rateBpm) {
  const bpm = clamp(rateBpm, JAW_HARP_LIMITS.breathRateBpm[0], JAW_HARP_LIMITS.breathRateBpm[1]);
  return 60_000 / bpm;
}

export function pluckForceFromPull(pull, scale = JAW_HARP_DEFAULTS.pluckForce) {
  const tension = clamp(Math.abs(finiteOr(pull, 0)), 0, MAX_TINE_PULL);
  if (tension < 0.012) return 0;
  const forceScale = clamp(
    scale,
    JAW_HARP_LIMITS.pluckForce[0],
    JAW_HARP_LIMITS.pluckForce[1],
  );
  const rawForce = forceScale * Math.pow(tension, 1.55);
  return clamp(
    -JAW_HARP_LIMITS.pluckForce[1]
      * Math.expm1(-rawForce / JAW_HARP_LIMITS.pluckForce[1]),
    JAW_HARP_LIMITS.pluckForce[0],
    JAW_HARP_LIMITS.pluckForce[1],
  );
}

// Button, repeat, and MIDI strikes imitate a quick finger pull instead of an
// abstract velocity impulse. Averaging three draws keeps ordinary pulls near
// the middle while still allowing occasional light and emphatic attacks.
export function naturalTineStrike(
  source = JAW_HARP_DEFAULTS,
  { velocity = 1, direction, position } = {},
  random = Math.random,
) {
  const state = sanitizeJawHarpState(source);
  const draw = () => clamp(
    typeof random === "function" ? finiteOr(random(), 0.5) : 0.5,
  );
  const humanPull = (draw() + draw() + draw()) / 3;
  const dynamic = 0.36 + 0.64 * Math.pow(clamp(velocity), 0.68);
  const pull = clamp((0.72 + humanPull * 0.83) * dynamic, 0, MAX_TINE_PULL);
  return Object.freeze({
    pull,
    force: pluckForceFromPull(pull, state.pluckForce),
    direction: finiteOr(direction, state.pluckDirection) < 0 ? -1 : 1,
    position: clamp(
      finiteOr(position, state.pluckPosition),
      JAW_HARP_LIMITS.pluckPosition[0],
      JAW_HARP_LIMITS.pluckPosition[1],
    ),
  });
}

function randomRange(unitValue, limits, curve = 1) {
  const [minimum, maximum] = limits;
  return minimum + (maximum - minimum) * Math.pow(clamp(unitValue), curve);
}

function centeredRandomRange(unitValue, limits, curve = 1.55) {
  const [minimum, maximum] = limits;
  const signed = clamp(unitValue) * 2 - 1;
  const curved = Math.sign(signed) * Math.pow(Math.abs(signed), curve);
  return (minimum + maximum) * 0.5 + curved * (maximum - minimum) * 0.5;
}

function logarithmicRandomRange(unitValue, limits, curve = 1) {
  const [minimum, maximum] = limits;
  return minimum * Math.pow(maximum / minimum, Math.pow(clamp(unitValue), curve));
}

function randomizedRhythmId(unitValue) {
  const value = clamp(unitValue);
  if (value < 0.24) return "sparse-seven";
  if (value < 0.44) return "tresillo";
  if (value < 0.62) return "two-one";
  if (value < 0.79) return "soft-machine";
  if (value < 0.93) return "five-step";
  return "quarter-eighths";
}

function randomizedBreathsPerLoop(unitValue) {
  const value = clamp(unitValue);
  if (value < 0.12) return 0.125;
  if (value < 0.25) return 0.25;
  if (value < 0.42) return 0.5;
  if (value < 0.72) return 1;
  if (value < 0.86) return 2;
  if (value < 0.93) return 3;
  if (value < 0.97) return 4;
  if (value < 0.99) return 8;
  return 16;
}

function randomizedVowelSequenceMode(unitValue, autoBreath) {
  const value = clamp(unitValue);
  if (value < 0.35) return "off";
  if (value < 0.8) return "pluck";
  return autoBreath ? "breath" : "pluck";
}

export function randomizeJawHarpState(source = JAW_HARP_DEFAULTS, random = Math.random) {
  const state = sanitizeJawHarpState(source);
  const unit = () => clamp(typeof random === "function" ? random() : Math.random());
  const presetId = JAW_HARP_PRESETS[
    Math.min(JAW_HARP_PRESETS.length - 1, Math.floor(unit() * JAW_HARP_PRESETS.length))
  ].id;
  const vowelId = VOWEL_PRESETS[
    Math.min(VOWEL_PRESETS.length - 1, Math.floor(unit() * VOWEL_PRESETS.length))
  ].id;
  const rhythmId = randomizedRhythmId(unit());
  const repeat = unit() < 0.22;
  const autoBreath = unit() < 0.68;
  const breathLinked = unit() < 0.28;
  const pluckDirection = unit() < 0.5 ? -1 : 1;
  const breathsPerLoop = randomizedBreathsPerLoop(unit());
  const randomized = sanitizeJawHarpState({
    ...state,
    styleId: JAW_HARP_STYLE_CUSTOM_ID,
    presetId,
    vowelId,
    vowelSequenceMode: "off",
    rhythmId,
    repeat,
    autoBreath,
    breathLinked,
    pluckDirection,
    breathsPerLoop,
    reedFrequencyHz: logarithmicRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.reedFrequencyHz, 1.1),
    reedDecaySeconds: randomRange(unit(), JAW_HARP_RANDOM_LIMITS.reedDecaySeconds, 1.15),
    reedStiffness: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.reedStiffness, 1.35),
    pluckForce: randomRange(unit(), JAW_HARP_RANDOM_LIMITS.pluckForce, 1.45),
    pluckPosition: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.pluckPosition, 1.3),
    tonguePosition: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.mouthArticulation, 1.4),
    tongueHeight: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.mouthArticulation, 1.4),
    jawOpening: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.mouthArticulation, 1.4),
    lipRounding: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.mouthArticulation, 1.4),
    glottisOpening: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.glottisOpening, 1.4),
    cavityCoupling: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.cavityCoupling, 1.35),
    frameCoupling: randomRange(unit(), JAW_HARP_RANDOM_LIMITS.frameCoupling, 1.25),
    breathDepth: randomRange(unit(), JAW_HARP_RANDOM_LIMITS.breathDepth, 1.3),
    breathNoiseAmount: randomRange(unit(), JAW_HARP_RANDOM_LIMITS.breathNoiseAmount, 1.35),
    breathFilter: randomRange(unit(), JAW_HARP_RANDOM_LIMITS.breathFilter, 1.45),
    breathRateBpm: logarithmicRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.breathRateBpm, 1.2),
    breathBalance: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.breathBalance, 1.65),
    breathFlow: 0,
    formantFocus: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.formantFocus, 1.4),
    repeatRateBpm: logarithmicRandomRange(unit(), JAW_HARP_LIMITS.repeatRateBpm, 1.7),
    repeatSwing: centeredRandomRange(unit(), JAW_HARP_LIMITS.repeatSwing, 1.8),
    dryResonance: randomRange(
      unit(),
      autoBreath
        ? JAW_HARP_RANDOM_LIMITS.dryResonance
        : JAW_HARP_RANDOM_LIMITS.dryResonanceWithoutBreath,
      1.6,
    ),
  }, state);
  const vowelSequenceId = JAW_HARP_VOWEL_SEQUENCES[
    Math.min(
      JAW_HARP_VOWEL_SEQUENCES.length - 1,
      Math.floor(unit() * JAW_HARP_VOWEL_SEQUENCES.length),
    )
  ].id;
  const randomizedPerformance = sanitizeJawHarpState({
    ...randomized,
    vowelSequenceId,
    vowelSequenceMode: randomizedVowelSequenceMode(unit(), randomized.autoBreath),
  }, randomized);
  const [minimumBreathRate, maximumBreathRate] = JAW_HARP_RANDOM_LIMITS.effectiveBreathRateBpm;
  const linkedRate = effectiveBreathRateBpm(randomizedPerformance);
  return randomizedPerformance.breathLinked
    && (linkedRate < minimumBreathRate || linkedRate > maximumBreathRate)
    ? sanitizeJawHarpState({ ...randomizedPerformance, breathLinked: false }, randomizedPerformance)
    : randomizedPerformance;
}
