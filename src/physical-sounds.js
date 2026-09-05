/**
 * Shared, dependency-free physical-sound definitions and modal-bank builder.
 *
 * The module intentionally stops at control/state sanitization and modal data.
 * AudioWorklets can consume the returned typed arrays without knowing how the
 * presets were authored, while UI code can use the frozen definitions directly.
 * Preset values are plausible synthesis seeds, not calibrated measurements of
 * a particular physical specimen; imported hammer-test/FEM modes remain the
 * path for specimen-accurate Object Forge patches.
 */

const DEFAULT_SAMPLE_RATE = 48_000;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 384_000;
const DEFAULT_MAX_MODES = 64;
const HARD_MAX_MODES = 128;
const MODAL_JSON_MAX_LENGTH = 65_536;
const SPEED_OF_SOUND_MPS = 343;
const MIN_MODAL_FREQUENCY_HZ = 8;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeRead(source, key) {
  try {
    return source?.[key];
  } catch {
    return undefined;
  }
}

function safeToken(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function modalRows(rows) {
  return rows.map(([
    ratio,
    t60Seconds,
    gain,
    pan = 0,
    strikeNode,
    strikeWeight,
  ], index) => ({
    ratio,
    t60Seconds,
    gain,
    pan,
    strikeNode: strikeNode ?? index + 1,
    ...(strikeWeight === undefined ? {} : { strikeWeight }),
  }));
}

function definePreset({
  kind,
  id,
  label,
  description,
  tags,
  settings,
  physical,
  model,
}) {
  return deepFreeze({
    kind,
    id,
    label,
    description,
    tags,
    settings: { ...settings, presetId: id },
    physical,
    model: {
      dispersion: 0,
      defaultStrikePosition: 0.37,
      ...model,
      modes: modalRows(model.modes),
    },
  });
}

export const PHYSICAL_SOUND_KINDS = Object.freeze([
  "particle-cabinet",
  "impact-ecology",
  "object-forge",
  "bowed-things",
  "airflow-objects",
]);

const KIND_ALIASES = Object.freeze({
  particle: "particle-cabinet",
  particles: "particle-cabinet",
  shaker: "particle-cabinet",
  impact: "impact-ecology",
  impacts: "impact-ecology",
  object: "object-forge",
  modal: "object-forge",
  bowed: "bowed-things",
  bow: "bowed-things",
  airflow: "airflow-objects",
  air: "airflow-objects",
});

function resolveKind(value) {
  const token = safeToken(value);
  return PHYSICAL_SOUND_KINDS.includes(token)
    ? token
    : KIND_ALIASES[token] ?? PHYSICAL_SOUND_KINDS[0];
}

const COMMON_LIMITS = {
  size: [0.25, 4],
  damping: [0, 1],
  brightness: [0, 1],
  energy: [0, 1],
  stereoWidth: [0, 1],
};

export const PHYSICAL_SOUND_LIMITS = deepFreeze({
  "particle-cabinet": {
    ...COMMON_LIMITS,
    objectCount: [1, 512],
    particleSize: [0, 1],
    roughness: [0, 1],
    gravity: [0, 2],
  },
  "impact-ecology": {
    ...COMMON_LIMITS,
    restitution: [0.02, 0.98],
    eventDensity: [0.1, 200],
    hardness: [0, 1],
    chaos: [0, 1],
    strikePosition: [0, 1],
  },
  "object-forge": {
    ...COMMON_LIMITS,
    baseFrequencyHz: [20, 4_000],
    stiffness: [0, 1],
    strikePosition: [0, 1],
    pickupPosition: [0, 1],
    modeCount: [1, 64],
    modalJsonLength: [0, MODAL_JSON_MAX_LENGTH],
  },
  "bowed-things": {
    ...COMMON_LIMITS,
    baseFrequencyHz: [20, 2_000],
    bowPressure: [0, 1],
    bowVelocity: [0, 1],
    bowPosition: [0, 1],
    rosin: [0, 1],
  },
  "airflow-objects": {
    ...COMMON_LIMITS,
    airSpeed: [0, 80],
    diameter: [0.002, 0.5],
    cavityDepth: [0.005, 2],
    aperture: [0.01, 1],
    turbulence: [0, 1],
    listenerAngle: [-180, 180],
  },
});

export const PHYSICAL_SOUND_OPTIONS = deepFreeze({
  "impact-ecology": {
    eventType: ["bounce", "shatter", "crumple", "roll", "scrape"],
  },
  "airflow-objects": {
    airflowMode: ["cavity", "aeolian", "bottle"],
  },
});

const COMMON_CONTROLS = [
  { key: "presetId", label: "Preset", type: "select" },
  { key: "size", label: "Size", type: "number", unit: "ratio" },
  { key: "damping", label: "Damping", type: "number", unit: "normalized" },
  { key: "brightness", label: "Brightness", type: "number", unit: "normalized" },
  { key: "energy", label: "Energy", type: "number", unit: "normalized" },
  { key: "stereoWidth", label: "Stereo width", type: "number", unit: "normalized" },
];

export const PHYSICAL_SOUND_METADATA = deepFreeze({
  "particle-cabinet": {
    id: "particle-cabinet",
    label: "Particle Cabinet",
    modelFamily: "stochastic collisions into a modal container",
    description: "Shake ensembles of particles against the walls of resonant bodies.",
    defaultPresetId: "gourd-maraca",
    controls: [
      ...COMMON_CONTROLS,
      { key: "objectCount", label: "Objects", type: "integer", unit: "particles" },
      { key: "particleSize", label: "Particle size", type: "number", unit: "normalized" },
      { key: "roughness", label: "Roughness", type: "number", unit: "normalized" },
      { key: "gravity", label: "Gravity", type: "number", unit: "g" },
    ],
  },
  "impact-ecology": {
    id: "impact-ecology",
    label: "Impact Ecology",
    modelFamily: "scheduled micro-impacts into a modal body",
    description: "Bounce, shatter, crumple, roll, and scrape controllable impact populations.",
    defaultPresetId: "rubber-on-wood",
    controls: [
      ...COMMON_CONTROLS,
      { key: "eventType", label: "Event", type: "select" },
      { key: "restitution", label: "Restitution", type: "number", unit: "coefficient" },
      { key: "eventDensity", label: "Event density", type: "number", unit: "events/s" },
      { key: "hardness", label: "Hardness", type: "number", unit: "normalized" },
      { key: "chaos", label: "Chaos", type: "number", unit: "normalized" },
      { key: "strikePosition", label: "Strike position", type: "number", unit: "normalized" },
    ],
  },
  "object-forge": {
    id: "object-forge",
    label: "Object Forge",
    modelFamily: "position-dependent modal synthesis",
    description: "Strike arbitrary wood, glass, metal, ceramic, and imported modal objects.",
    defaultPresetId: "wood-bar",
    controls: [
      ...COMMON_CONTROLS,
      { key: "baseFrequencyHz", label: "Base frequency", type: "number", unit: "Hz" },
      { key: "stiffness", label: "Stiffness", type: "number", unit: "normalized" },
      { key: "strikePosition", label: "Strike position", type: "number", unit: "normalized" },
      { key: "pickupPosition", label: "Pickup position", type: "number", unit: "normalized" },
      { key: "modeCount", label: "Modes", type: "integer", unit: "modes" },
      { key: "modalJson", label: "Modal JSON", type: "text" },
    ],
    modalJsonSchema: {
      name: "optional string",
      modeCount: "optional active-mode count; defaults to the number of rows",
      referenceStiffness: "optional 0..1 neutral point; defaults to 0.5",
      dispersion: "optional 0..1 stiffness sensitivity; defaults to 0.1",
      modes: [{ ratio: "positive number", decay: "T60 seconds", gain: "linear amplitude" }],
      optionalModeFields: {
        pan: "-1..1",
        strikeNode: "positive integer",
        strikeWeight: "explicit -1..1 input weight (overrides strikeNode)",
      },
    },
  },
  "bowed-things": {
    id: "bowed-things",
    label: "Bowed Things",
    modelFamily: "friction excitation into an inharmonic resonator",
    description: "Rub bars, glass, bowls, and cymbals with pressure-, speed-, and position-sensitive bows.",
    defaultPresetId: "uniform-bar",
    controls: [
      ...COMMON_CONTROLS,
      { key: "baseFrequencyHz", label: "Base frequency", type: "number", unit: "Hz" },
      { key: "bowPressure", label: "Bow pressure", type: "number", unit: "normalized" },
      { key: "bowVelocity", label: "Bow velocity", type: "number", unit: "normalized" },
      { key: "bowPosition", label: "Bow position", type: "number", unit: "normalized" },
      { key: "rosin", label: "Rosin", type: "number", unit: "normalized" },
    ],
  },
  "airflow-objects": {
    id: "airflow-objects",
    label: "Airflow Objects",
    modelFamily: "Strouhal, quarter-wave, and Helmholtz resonators",
    description: "Blow across cavities, wires, slots, pipes, and bottles.",
    defaultPresetId: "slot-cavity",
    controls: [
      ...COMMON_CONTROLS,
      { key: "airflowMode", label: "Airflow mode", type: "select" },
      { key: "airSpeed", label: "Air speed", type: "number", unit: "m/s" },
      { key: "diameter", label: "Diameter", type: "number", unit: "m" },
      { key: "cavityDepth", label: "Cavity depth", type: "number", unit: "m" },
      { key: "aperture", label: "Aperture", type: "number", unit: "normalized" },
      { key: "turbulence", label: "Turbulence", type: "number", unit: "normalized" },
      { key: "listenerAngle", label: "Listener angle", type: "number", unit: "degrees" },
    ],
  },
});

const particleCommon = {
  size: 1,
  damping: 0.52,
  brightness: 0.55,
  energy: 0.68,
  stereoWidth: 0.58,
  objectCount: 48,
  particleSize: 0.38,
  roughness: 0.62,
  gravity: 1,
};

const impactCommon = {
  size: 1,
  damping: 0.5,
  brightness: 0.58,
  energy: 0.72,
  stereoWidth: 0.5,
  eventType: "bounce",
  restitution: 0.68,
  eventDensity: 12,
  hardness: 0.58,
  chaos: 0.25,
  strikePosition: 0.37,
};

const objectCommon = {
  size: 1,
  damping: 0.48,
  brightness: 0.55,
  energy: 0.7,
  stereoWidth: 0.42,
  baseFrequencyHz: 220,
  stiffness: 0.5,
  strikePosition: 0.37,
  pickupPosition: 0.63,
  modeCount: 12,
  modalJson: "",
};

const bowedCommon = {
  size: 1,
  damping: 0.34,
  brightness: 0.52,
  energy: 0.62,
  stereoWidth: 0.46,
  baseFrequencyHz: 146.83,
  bowPressure: 0.52,
  bowVelocity: 0.45,
  bowPosition: 0.31,
  rosin: 0.58,
};

const airflowCommon = {
  size: 1,
  damping: 0.58,
  brightness: 0.54,
  energy: 0.62,
  stereoWidth: 0.55,
  airflowMode: "cavity",
  airSpeed: 18,
  diameter: 0.028,
  cavityDepth: 0.14,
  aperture: 0.32,
  turbulence: 0.42,
  listenerAngle: 0,
};

export const PHYSICAL_SOUND_PRESETS = deepFreeze({
  "particle-cabinet": [
    definePreset({
      kind: "particle-cabinet",
      id: "gourd-maraca",
      label: "Gourd Maraca",
      description: "Dry seeds collide in a lossy, warm gourd shell.",
      tags: ["seed", "gourd", "shaker"],
      settings: {
        ...particleCommon,
        energy: 0.9,
        damping: 0.68,
        brightness: 0.3,
        objectCount: 72,
        particleSize: 0.18,
        roughness: 0.72,
      },
      physical: {
        particleMaterial: "dried seed",
        containerMaterial: "dried gourd",
        particleDensityKgM3: 650,
        containerVolumeLitres: 0.72,
      },
      model: {
        baseFrequencyHz: 315,
        exciter: {
          rateScale: 0.95,
          impactScale: 0.85,
          contactBrightness: 0.34,
          contactT60Seconds: 0.006,
          systemT60Seconds: 0.11,
          scrapeMix: 0.12,
          modalMix: 0.55,
          contactMix: 2.2,
        },
        modes: [
          [1, 0.18, 1, -0.35], [1.43, 0.14, 0.72, 0.24], [1.91, 0.11, 0.48, -0.12],
          [2.57, 0.09, 0.36, 0.38], [3.32, 0.07, 0.27, -0.4], [4.26, 0.052, 0.19, 0.16],
          [5.41, 0.04, 0.12, -0.22], [6.88, 0.032, 0.08, 0.32],
        ],
      },
    }),
    definePreset({
      kind: "particle-cabinet",
      id: "steel-cabasa",
      label: "Steel Cabasa",
      description: "Steel beads scrape and chatter around a corrugated metal cylinder.",
      tags: ["steel", "beads", "scrape"],
      settings: {
        ...particleCommon,
        energy: 0.88,
        damping: 0.62,
        brightness: 0.98,
        objectCount: 240,
        particleSize: 0.06,
        roughness: 1,
      },
      physical: {
        particleMaterial: "carbon steel",
        containerMaterial: "corrugated steel",
        particleDensityKgM3: 7_850,
        containerVolumeLitres: 0.38,
      },
      model: {
        baseFrequencyHz: 690,
        exciter: {
          rateScale: 1.25,
          impactScale: 0.58,
          contactBrightness: 0.98,
          contactT60Seconds: 0.0025,
          systemT60Seconds: 0.08,
          scrapeMix: 1,
          modalMix: 0.25,
          contactMix: 2.8,
        },
        modes: [
          [1, 0.42, 0.7, -0.4], [1.62, 0.34, 1, 0.36], [2.31, 0.27, 0.82, -0.2],
          [3.08, 0.22, 0.62, 0.18], [4.14, 0.17, 0.48, -0.36], [5.47, 0.13, 0.35, 0.42],
          [7.02, 0.1, 0.24, -0.1], [8.91, 0.075, 0.17, 0.27], [11.2, 0.055, 0.1, -0.3],
        ],
      },
    }),
    definePreset({
      kind: "particle-cabinet",
      id: "coin-tin",
      label: "Coin Tin",
      description: "A small handful of coins ricochets through a bright sheet-metal tin.",
      tags: ["coins", "tin", "rattle"],
      settings: {
        ...particleCommon,
        energy: 0.95,
        damping: 0.28,
        brightness: 0.88,
        objectCount: 6,
        particleSize: 0.88,
        roughness: 0.18,
        gravity: 1.2,
      },
      physical: {
        particleMaterial: "mixed coin alloy",
        containerMaterial: "tin-plated steel",
        particleDensityKgM3: 8_400,
        containerVolumeLitres: 0.95,
      },
      model: {
        baseFrequencyHz: 410,
        exciter: {
          rateScale: 0.62,
          impactScale: 0.58,
          contactBrightness: 0.84,
          contactT60Seconds: 0.011,
          systemT60Seconds: 0.23,
          scrapeMix: 0.06,
          modalMix: 1.4,
          contactMix: 0.8,
        },
        modes: [
          [1, 1.15, 0.7, -0.42], [1.58, 0.92, 1, 0.34], [2.14, 0.72, 0.8, -0.16],
          [2.89, 0.58, 0.62, 0.27], [3.76, 0.47, 0.48, -0.36], [4.83, 0.37, 0.34, 0.42],
          [6.11, 0.29, 0.24, -0.08], [7.7, 0.22, 0.18, 0.25], [9.64, 0.16, 0.11, -0.3],
        ],
      },
    }),
    definePreset({
      kind: "particle-cabinet",
      id: "pebbles-in-glass",
      label: "Pebbles in Glass",
      description: "Hard stone impacts excite a clear glass vessel with long narrow modes.",
      tags: ["stone", "glass", "rattle"],
      settings: {
        ...particleCommon,
        energy: 0.9,
        damping: 0.12,
        brightness: 0.92,
        objectCount: 9,
        particleSize: 0.72,
        roughness: 0.25,
      },
      physical: {
        particleMaterial: "quartz pebble",
        containerMaterial: "soda-lime glass",
        particleDensityKgM3: 2_650,
        containerVolumeLitres: 1.4,
      },
      model: {
        baseFrequencyHz: 525,
        dispersion: 0.06,
        exciter: {
          rateScale: 0.48,
          impactScale: 0.45,
          contactBrightness: 0.74,
          contactT60Seconds: 0.008,
          systemT60Seconds: 0.28,
          scrapeMix: 0.08,
          modalMix: 1.8,
          contactMix: 0.65,
        },
        modes: [
          [1, 2.6, 1, -0.38], [1.51, 2.05, 0.76, 0.31], [2.32, 1.68, 0.63, -0.2],
          [3.18, 1.3, 0.5, 0.4], [4.27, 1.03, 0.36, -0.31], [5.55, 0.78, 0.27, 0.17],
          [7.02, 0.58, 0.2, -0.42], [8.68, 0.43, 0.14, 0.28], [10.7, 0.31, 0.09, -0.12],
        ],
      },
    }),
    definePreset({
      kind: "particle-cabinet",
      id: "bamboo-rainstick",
      label: "Bamboo Rainstick",
      description: "Many small grains cascade through a softly resonant bamboo tube.",
      tags: ["grain", "bamboo", "pour"],
      settings: {
        ...particleCommon,
        size: 1.45,
        energy: 0.88,
        damping: 0.7,
        brightness: 0.26,
        objectCount: 480,
        particleSize: 0.04,
        roughness: 0.88,
        gravity: 0.65,
      },
      physical: {
        particleMaterial: "small seed and gravel",
        containerMaterial: "bamboo",
        particleDensityKgM3: 1_400,
        containerVolumeLitres: 2.8,
      },
      model: {
        baseFrequencyHz: 190,
        exciter: {
          rateScale: 1.55,
          impactScale: 0.4,
          contactBrightness: 0.27,
          contactT60Seconds: 0.0035,
          systemT60Seconds: 0.85,
          scrapeMix: 0.52,
          modalMix: 0.22,
          contactMix: 2.6,
        },
        modes: [
          [1, 0.5, 1, -0.32], [2.03, 0.37, 0.62, 0.29], [3.08, 0.28, 0.43, -0.19],
          [4.17, 0.21, 0.31, 0.37], [5.32, 0.16, 0.21, -0.38], [6.55, 0.12, 0.15, 0.14],
          [7.9, 0.09, 0.1, -0.25],
        ],
      },
    }),
    definePreset({
      kind: "particle-cabinet",
      id: "sleigh-bells",
      label: "Sleigh Bells",
      description: "Loose steel pellets intermittently excite several small slotted bells.",
      tags: ["steel", "bells", "jingle"],
      settings: {
        ...particleCommon,
        energy: 0.92,
        damping: 0.16,
        brightness: 1,
        objectCount: 18,
        particleSize: 0.32,
        roughness: 0.18,
        stereoWidth: 0.78,
      },
      physical: {
        particleMaterial: "steel pellet",
        containerMaterial: "slotted steel bells",
        particleDensityKgM3: 7_850,
        containerVolumeLitres: 0.16,
      },
      model: {
        baseFrequencyHz: 820,
        dispersion: 0.1,
        exciter: {
          rateScale: 0.42,
          impactScale: 1.25,
          contactBrightness: 1,
          contactT60Seconds: 0.006,
          systemT60Seconds: 0.32,
          scrapeMix: 0.04,
          modalMix: 2,
          contactMix: 0.5,
        },
        modes: [
          [1, 2.8, 0.76, -0.52], [1.47, 2.35, 1, 0.48], [2.09, 1.82, 0.83, -0.28],
          [2.73, 1.5, 0.68, 0.18], [3.61, 1.12, 0.52, -0.44], [4.68, 0.86, 0.38, 0.53],
          [5.96, 0.64, 0.29, -0.14], [7.45, 0.47, 0.2, 0.35], [9.13, 0.34, 0.13, -0.37],
          [11.1, 0.24, 0.08, 0.22],
        ],
      },
    }),
  ],
  "impact-ecology": [
    definePreset({
      kind: "impact-ecology",
      id: "rubber-on-wood",
      label: "Rubber Ball on Wood",
      description: "A compliant ball loses energy through a sequence of accelerating wooden knocks.",
      tags: ["bounce", "rubber", "wood"],
      settings: { ...impactCommon, restitution: 0.73, hardness: 0.28, eventDensity: 9 },
      physical: { exciter: "rubber sphere", body: "spruce board", bodyDensityKgM3: 450 },
      model: {
        baseFrequencyHz: 185,
        defaultStrikePosition: 0.31,
        modes: [
          [1, 0.72, 1, -0.2], [2.76, 0.46, 0.68, 0.18], [5.4, 0.29, 0.43, -0.31],
          [8.93, 0.2, 0.27, 0.33], [13.34, 0.14, 0.17, -0.13], [18.64, 0.1, 0.1, 0.24],
        ],
      },
    }),
    definePreset({
      kind: "impact-ecology",
      id: "marble-on-stone",
      label: "Marble on Stone",
      description: "A hard marble produces a bright, long bounce train on a stone slab.",
      tags: ["bounce", "marble", "stone"],
      settings: {
        ...impactCommon,
        damping: 0.28,
        brightness: 0.82,
        restitution: 0.88,
        hardness: 0.92,
        eventDensity: 16,
      },
      physical: { exciter: "glass marble", body: "granite slab", bodyDensityKgM3: 2_700 },
      model: {
        baseFrequencyHz: 430,
        dispersion: 0.08,
        modes: [
          [1, 1.6, 1, -0.25], [1.59, 1.3, 0.74, 0.3], [2.14, 1.02, 0.59, -0.4],
          [2.65, 0.82, 0.46, 0.17], [3.16, 0.64, 0.34, -0.19], [3.69, 0.5, 0.25, 0.37],
          [4.28, 0.38, 0.18, -0.32], [5.07, 0.28, 0.12, 0.12],
        ],
      },
    }),
    definePreset({
      kind: "impact-ecology",
      id: "window-shatter",
      label: "Window Shatter",
      description: "A brittle glass plate breaks into a dense cloud of hard micro-impacts.",
      tags: ["shatter", "glass", "brittle"],
      settings: {
        ...impactCommon,
        eventType: "shatter",
        damping: 0.2,
        brightness: 0.91,
        restitution: 0.42,
        eventDensity: 125,
        hardness: 0.98,
        chaos: 0.82,
      },
      physical: { exciter: "fracture cloud", body: "soda-lime glass sheet", bodyDensityKgM3: 2_500 },
      model: {
        baseFrequencyHz: 610,
        dispersion: 0.12,
        modes: [
          [1, 2.4, 0.82, -0.44], [1.59, 2.05, 1, 0.37], [2.14, 1.61, 0.88, -0.23],
          [2.3, 1.4, 0.66, 0.15], [2.65, 1.16, 0.6, -0.4], [2.92, 0.93, 0.48, 0.42],
          [3.16, 0.75, 0.38, -0.12], [3.5, 0.59, 0.3, 0.29], [4.12, 0.43, 0.2, -0.34],
          [5.03, 0.31, 0.13, 0.2], [6.18, 0.22, 0.08, -0.16],
        ],
      },
    }),
    definePreset({
      kind: "impact-ecology",
      id: "ceramic-break",
      label: "Ceramic Break",
      description: "A glazed ceramic body cracks into fewer, heavier ringing fragments.",
      tags: ["shatter", "ceramic", "fragments"],
      settings: {
        ...impactCommon,
        eventType: "shatter",
        damping: 0.3,
        brightness: 0.72,
        restitution: 0.34,
        eventDensity: 64,
        hardness: 0.86,
        chaos: 0.68,
      },
      physical: { exciter: "fracture cloud", body: "glazed stoneware", bodyDensityKgM3: 2_300 },
      model: {
        baseFrequencyHz: 360,
        dispersion: 0.09,
        modes: [
          [1, 1.4, 1, -0.38], [1.46, 1.12, 0.72, 0.25], [2.08, 0.85, 0.57, -0.16],
          [2.71, 0.66, 0.44, 0.4], [3.48, 0.49, 0.31, -0.34], [4.32, 0.36, 0.23, 0.14],
          [5.39, 0.26, 0.15, -0.25], [6.71, 0.18, 0.09, 0.31],
        ],
      },
    }),
    definePreset({
      kind: "impact-ecology",
      id: "paper-crumple",
      label: "Paper Crumple",
      description: "Sparse fiber buckles gather into a dry, irregular crackle.",
      tags: ["crumple", "paper", "dry"],
      settings: {
        ...impactCommon,
        eventType: "crumple",
        damping: 0.83,
        brightness: 0.6,
        restitution: 0.08,
        eventDensity: 78,
        hardness: 0.24,
        chaos: 0.91,
      },
      physical: { exciter: "fiber buckles", body: "uncoated paper", bodyDensityKgM3: 800 },
      model: {
        baseFrequencyHz: 720,
        modes: [
          [1, 0.065, 1, -0.34], [1.55, 0.052, 0.77, 0.29], [2.2, 0.044, 0.59, -0.16],
          [3.01, 0.036, 0.42, 0.38], [4.03, 0.03, 0.3, -0.4], [5.24, 0.025, 0.2, 0.13],
          [6.7, 0.021, 0.13, -0.24],
        ],
      },
    }),
    definePreset({
      kind: "impact-ecology",
      id: "foil-crumple",
      label: "Foil Crumple",
      description: "Dense snap-through events excite a thin, metallic resonant sheet.",
      tags: ["crumple", "foil", "metal"],
      settings: {
        ...impactCommon,
        eventType: "crumple",
        damping: 0.55,
        brightness: 0.86,
        restitution: 0.12,
        eventDensity: 142,
        hardness: 0.66,
        chaos: 0.94,
      },
      physical: { exciter: "snap-through buckles", body: "aluminium foil", bodyDensityKgM3: 2_700 },
      model: {
        baseFrequencyHz: 920,
        dispersion: 0.16,
        modes: [
          [1, 0.2, 0.74, -0.45], [1.37, 0.17, 1, 0.36], [1.91, 0.14, 0.86, -0.2],
          [2.56, 0.11, 0.67, 0.21], [3.39, 0.09, 0.51, -0.37], [4.42, 0.07, 0.38, 0.43],
          [5.71, 0.054, 0.27, -0.1], [7.28, 0.041, 0.18, 0.29], [9.16, 0.031, 0.11, -0.3],
        ],
      },
    }),
  ],
  "object-forge": [
    definePreset({
      kind: "object-forge",
      id: "wood-bar",
      label: "Wood Bar",
      description: "A free-free wooden bar with the characteristic bending-mode sequence.",
      tags: ["wood", "bar", "struck"],
      settings: { ...objectCommon, baseFrequencyHz: 196, stiffness: 0.34, modeCount: 8 },
      physical: { material: "rosewood", densityKgM3: 840, youngsModulusGPa: 16 },
      model: {
        baseFrequencyHz: 196,
        dispersion: 0.04,
        modes: [
          [1, 1.3, 1, -0.28], [2.756, 0.9, 0.68, 0.25], [5.404, 0.57, 0.42, -0.36],
          [8.933, 0.38, 0.28, 0.34], [13.34, 0.25, 0.18, -0.14], [18.64, 0.17, 0.11, 0.21],
          [24.84, 0.12, 0.07, -0.27], [31.94, 0.085, 0.045, 0.12],
        ],
      },
    }),
    definePreset({
      kind: "object-forge",
      id: "glass-bowl",
      label: "Glass Bowl",
      description: "A thin glass bowl with paired circumferential modes and slow decay.",
      tags: ["glass", "bowl", "ringing"],
      settings: {
        ...objectCommon,
        damping: 0.2,
        brightness: 0.7,
        baseFrequencyHz: 294,
        stiffness: 0.66,
        modeCount: 12,
      },
      physical: { material: "borosilicate glass", densityKgM3: 2_230, youngsModulusGPa: 63 },
      model: {
        baseFrequencyHz: 294,
        dispersion: 0.08,
        modes: [
          [1, 4.8, 1, -0.36], [1.013, 4.4, 0.62, 0.32], [2.71, 3.5, 0.73, -0.18],
          [2.744, 3.2, 0.45, 0.4], [5.12, 2.5, 0.48, -0.42], [5.18, 2.2, 0.3, 0.16],
          [8.41, 1.7, 0.3, -0.27], [8.5, 1.5, 0.2, 0.34], [12.55, 1.08, 0.18, -0.12],
          [12.7, 0.92, 0.12, 0.24], [17.6, 0.68, 0.08, -0.31], [17.82, 0.58, 0.055, 0.13],
        ],
      },
    }),
    definePreset({
      kind: "object-forge",
      id: "steel-plate",
      label: "Steel Plate",
      description: "An inharmonic rectangular plate with dense, durable high modes.",
      tags: ["steel", "plate", "metal"],
      settings: {
        ...objectCommon,
        damping: 0.24,
        brightness: 0.76,
        baseFrequencyHz: 118,
        stiffness: 0.83,
        modeCount: 16,
      },
      physical: { material: "mild steel", densityKgM3: 7_850, youngsModulusGPa: 200 },
      model: {
        baseFrequencyHz: 118,
        dispersion: 0.14,
        modes: [
          [1, 4.2, 1, -0.42], [1.59, 3.7, 0.83, 0.36], [2.14, 3.2, 0.68, -0.2],
          [2.3, 2.9, 0.52, 0.18], [2.65, 2.55, 0.49, -0.36], [2.92, 2.2, 0.39, 0.43],
          [3.16, 1.9, 0.34, -0.12], [3.5, 1.65, 0.28, 0.27], [3.65, 1.42, 0.23, -0.4],
          [4.06, 1.18, 0.2, 0.35], [4.38, 0.98, 0.16, -0.18], [4.72, 0.82, 0.13, 0.13],
          [5.14, 0.68, 0.1, -0.3], [5.63, 0.56, 0.08, 0.38], [6.18, 0.46, 0.06, -0.1],
          [6.82, 0.37, 0.045, 0.21],
        ],
      },
    }),
    definePreset({
      kind: "object-forge",
      id: "ceramic-tile",
      label: "Ceramic Tile",
      description: "A stiff ceramic plate with a bright fundamental and moderately short ring.",
      tags: ["ceramic", "tile", "plate"],
      settings: {
        ...objectCommon,
        damping: 0.38,
        brightness: 0.69,
        baseFrequencyHz: 345,
        stiffness: 0.74,
        modeCount: 12,
      },
      physical: { material: "porcelain", densityKgM3: 2_400, youngsModulusGPa: 70 },
      model: {
        baseFrequencyHz: 345,
        dispersion: 0.09,
        modes: [
          [1, 1.7, 1, -0.31], [1.59, 1.42, 0.8, 0.3], [2.14, 1.12, 0.62, -0.17],
          [2.3, 0.96, 0.48, 0.38], [2.65, 0.78, 0.4, -0.4], [2.92, 0.64, 0.33, 0.14],
          [3.16, 0.52, 0.27, -0.25], [3.5, 0.42, 0.21, 0.33], [4.06, 0.32, 0.15, -0.12],
          [4.72, 0.24, 0.11, 0.2], [5.63, 0.18, 0.075, -0.28], [6.82, 0.13, 0.05, 0.1],
        ],
      },
    }),
    definePreset({
      kind: "object-forge",
      id: "bronze-bell",
      label: "Bronze Bell",
      description: "A bell-like mode family with a low hum, prime, tierce, quint, and nominal.",
      tags: ["bronze", "bell", "ringing"],
      settings: {
        ...objectCommon,
        damping: 0.12,
        brightness: 0.77,
        baseFrequencyHz: 130.81,
        stiffness: 0.86,
        modeCount: 14,
      },
      physical: { material: "bell bronze", densityKgM3: 8_800, youngsModulusGPa: 105 },
      model: {
        baseFrequencyHz: 130.81,
        dispersion: 0.12,
        modes: [
          [0.5, 7.8, 0.4, -0.2], [1, 6.8, 1, 0.18], [1.2, 6.1, 0.72, -0.39],
          [1.5, 5.3, 0.65, 0.36], [2, 4.5, 0.58, -0.12], [2.52, 3.7, 0.45, 0.28],
          [3.01, 3, 0.38, -0.35], [3.52, 2.45, 0.3, 0.41], [4.08, 1.95, 0.23, -0.17],
          [4.72, 1.52, 0.18, 0.22], [5.43, 1.17, 0.13, -0.3], [6.25, 0.88, 0.095, 0.34],
          [7.18, 0.65, 0.065, -0.1], [8.22, 0.47, 0.045, 0.16],
        ],
      },
    }),
  ],
  "bowed-things": [
    definePreset({
      kind: "bowed-things",
      id: "uniform-bar",
      label: "Uniform Bar",
      description: "A bowed free-free bar following the classic inharmonic bending-mode ratios.",
      tags: ["bar", "uniform", "bowed"],
      settings: { ...bowedCommon },
      physical: { resonator: "uniform metal bar", exciter: "velocity-dependent bow friction" },
      model: {
        baseFrequencyHz: 146.83,
        dispersion: 0.08,
        defaultStrikePosition: 0.31,
        modes: [
          [1, 3.4, 1, -0.28], [2.756, 2.7, 0.72, 0.26], [5.404, 1.9, 0.49, -0.37],
          [8.933, 1.3, 0.31, 0.34], [13.34, 0.88, 0.2, -0.14], [18.64, 0.58, 0.12, 0.22],
          [24.84, 0.38, 0.075, -0.25], [31.94, 0.25, 0.045, 0.11],
        ],
      },
    }),
    definePreset({
      kind: "bowed-things",
      id: "tuned-bar",
      label: "Tuned Bar",
      description: "An undercut bar whose first overtones approach musically tuned 1:4:10 ratios.",
      tags: ["bar", "tuned", "marimba-like"],
      settings: {
        ...bowedCommon,
        damping: 0.42,
        brightness: 0.46,
        baseFrequencyHz: 174.61,
        bowPosition: 0.23,
      },
      physical: { resonator: "undercut rosewood bar", exciter: "velocity-dependent bow friction" },
      model: {
        baseFrequencyHz: 174.61,
        dispersion: 0.025,
        defaultStrikePosition: 0.23,
        modes: [
          [1, 2.6, 1, -0.25], [4.02, 1.52, 0.65, 0.24], [9.18, 0.86, 0.38, -0.35],
          [15.7, 0.53, 0.22, 0.32], [23.6, 0.32, 0.12, -0.12], [32.8, 0.2, 0.07, 0.19],
        ],
      },
    }),
    definePreset({
      kind: "bowed-things",
      id: "glass-harmonica",
      label: "Glass Harmonica",
      description: "A lightly touched glass rim sustains paired, slowly beating bowl modes.",
      tags: ["glass", "rim", "singing"],
      settings: {
        ...bowedCommon,
        damping: 0.17,
        brightness: 0.67,
        baseFrequencyHz: 261.63,
        bowPressure: 0.32,
        bowVelocity: 0.27,
        rosin: 0.38,
      },
      physical: { resonator: "thin glass bowl", exciter: "wet finger / friction wheel" },
      model: {
        baseFrequencyHz: 261.63,
        dispersion: 0.065,
        modes: [
          [1, 7.5, 1, -0.32], [1.008, 7.1, 0.54, 0.3], [2.71, 5.2, 0.68, -0.17],
          [2.735, 4.8, 0.39, 0.4], [5.12, 3.45, 0.42, -0.38], [5.17, 3.1, 0.25, 0.13],
          [8.41, 2.15, 0.24, -0.24], [8.49, 1.9, 0.15, 0.32], [12.55, 1.25, 0.13, -0.1],
          [12.7, 1.05, 0.08, 0.19],
        ],
      },
    }),
    definePreset({
      kind: "bowed-things",
      id: "singing-bowl",
      label: "Singing Bowl",
      description: "A rubbed bronze bowl builds energy in coupled circumferential mode pairs.",
      tags: ["bronze", "bowl", "rubbed"],
      settings: {
        ...bowedCommon,
        damping: 0.11,
        brightness: 0.58,
        baseFrequencyHz: 110,
        bowPressure: 0.66,
        bowVelocity: 0.36,
        rosin: 0.7,
      },
      physical: { resonator: "bronze singing bowl", exciter: "wood-and-leather rubbing stick" },
      model: {
        baseFrequencyHz: 110,
        dispersion: 0.11,
        modes: [
          [1, 9.5, 1, -0.34], [1.006, 8.9, 0.48, 0.31], [2.68, 7.1, 0.74, -0.18],
          [2.704, 6.6, 0.38, 0.39], [5.05, 4.8, 0.48, -0.41], [5.1, 4.35, 0.25, 0.14],
          [8.31, 3.1, 0.29, -0.25], [8.39, 2.75, 0.16, 0.34], [12.4, 1.9, 0.16, -0.11],
          [12.54, 1.65, 0.09, 0.21], [17.3, 1.08, 0.07, -0.27], [17.51, 0.92, 0.045, 0.12],
        ],
      },
    }),
    definePreset({
      kind: "bowed-things",
      id: "bowed-cymbal",
      label: "Bowed Cymbal",
      description: "A bow catches an edge and excites a dense, unstable family of plate modes.",
      tags: ["cymbal", "metal", "edge"],
      settings: {
        ...bowedCommon,
        damping: 0.22,
        brightness: 0.84,
        baseFrequencyHz: 92,
        bowPressure: 0.48,
        bowVelocity: 0.55,
        bowPosition: 0.88,
        rosin: 0.82,
      },
      physical: { resonator: "bronze plate", exciter: "rosined edge bow" },
      model: {
        baseFrequencyHz: 92,
        dispersion: 0.18,
        defaultStrikePosition: 0.88,
        modes: [
          [1, 5.8, 0.7, -0.42], [1.37, 5.2, 1, 0.37], [1.82, 4.5, 0.82, -0.2],
          [2.31, 3.8, 0.69, 0.18], [2.86, 3.2, 0.58, -0.36], [3.49, 2.65, 0.47, 0.43],
          [4.18, 2.13, 0.38, -0.12], [4.96, 1.7, 0.3, 0.28], [5.84, 1.34, 0.23, -0.4],
          [6.83, 1.04, 0.17, 0.35], [7.95, 0.8, 0.12, -0.17], [9.21, 0.6, 0.085, 0.2],
          [10.65, 0.44, 0.06, -0.28], [12.3, 0.32, 0.04, 0.12],
        ],
      },
    }),
  ],
  "airflow-objects": [
    definePreset({
      kind: "airflow-objects",
      id: "slot-cavity",
      label: "Slot Cavity",
      description: "A jet crossing a rectangular opening excites a lossy quarter-wave cavity.",
      tags: ["cavity", "slot", "edge tone"],
      settings: {
        ...airflowCommon,
        damping: 0.62,
        brightness: 0.78,
        energy: 0.82,
        airSpeed: 17,
        cavityDepth: 0.12,
        aperture: 0.28,
        turbulence: 0.72,
      },
      physical: { source: "edge-tone jet", resonator: "quarter-wave cavity", strouhalNumber: 0.2 },
      model: {
        frequencyScale: 1,
        modes: [
          [1, 0.58, 1, -0.28], [3.02, 0.35, 0.52, 0.26], [5.08, 0.23, 0.32, -0.37],
          [7.16, 0.16, 0.21, 0.35], [9.28, 0.11, 0.13, -0.13], [11.45, 0.078, 0.08, 0.2],
        ],
      },
    }),
    definePreset({
      kind: "airflow-objects",
      id: "roof-wire",
      label: "Aeolian Wire",
      description: "Alternating vortex shedding drives a wire and its first few bending modes.",
      tags: ["aeolian", "wire", "vortex"],
      settings: {
        ...airflowCommon,
        damping: 0.6,
        brightness: 0.72,
        energy: 0.6,
        airflowMode: "aeolian",
        airSpeed: 14,
        diameter: 0.008,
        cavityDepth: 0.7,
        aperture: 0.5,
        turbulence: 0.08,
      },
      physical: { source: "von Kármán vortex street", resonator: "tensioned wire", strouhalNumber: 0.19 },
      model: {
        strouhalNumber: 0.19,
        frequencyScale: 1,
        modes: [
          [1, 2.8, 1, -0.35], [2.01, 1.7, 0.46, 0.33], [3.04, 1.08, 0.25, -0.18],
          [4.1, 0.7, 0.15, 0.38], [5.2, 0.45, 0.09, -0.4], [6.34, 0.29, 0.055, 0.14],
        ],
      },
    }),
    definePreset({
      kind: "airflow-objects",
      id: "chimney-tone",
      label: "Chimney Tone",
      description: "A broad cylinder in gusty flow produces a low Aeolian moan.",
      tags: ["aeolian", "cylinder", "wind"],
      settings: {
        ...airflowCommon,
        size: 1.1,
        damping: 0.45,
        energy: 0.82,
        airflowMode: "aeolian",
        airSpeed: 24,
        diameter: 0.03,
        cavityDepth: 1.2,
        aperture: 0.7,
        turbulence: 0.75,
        brightness: 0.34,
      },
      physical: { source: "vortex shedding", resonator: "hollow metal cylinder", strouhalNumber: 0.2 },
      model: {
        strouhalNumber: 0.2,
        frequencyScale: 1,
        modes: [
          [1, 2.1, 1, -0.32], [2.04, 1.25, 0.38, 0.3], [3.12, 0.78, 0.2, -0.17],
          [4.28, 0.49, 0.12, 0.36], [5.5, 0.3, 0.07, -0.38],
        ],
      },
    }),
    definePreset({
      kind: "airflow-objects",
      id: "glass-bottle",
      label: "Glass Bottle",
      description: "A blown neck drives the Helmholtz mode and weaker internal air-column modes.",
      tags: ["bottle", "glass", "helmholtz"],
      settings: {
        ...airflowCommon,
        damping: 0.28,
        brightness: 0.62,
        energy: 0.8,
        airflowMode: "bottle",
        airSpeed: 10,
        diameter: 0.07,
        cavityDepth: 0.15,
        aperture: 0.18,
        turbulence: 0.12,
      },
      physical: { source: "lip jet", resonator: "Helmholtz cavity", wallMaterial: "glass" },
      model: {
        frequencyScale: 1.42,
        modes: [
          [1, 1.75, 1, -0.2], [2.97, 0.66, 0.28, 0.24], [5.08, 0.37, 0.16, -0.34],
          [6.83, 0.24, 0.1, 0.37], [8.91, 0.15, 0.06, -0.13],
        ],
      },
    }),
    definePreset({
      kind: "airflow-objects",
      id: "stone-jug",
      label: "Stone Jug",
      description: "A large porous vessel produces a dark Helmholtz hoot with muted upper modes.",
      tags: ["bottle", "stoneware", "helmholtz"],
      settings: {
        ...airflowCommon,
        size: 1,
        damping: 0.55,
        brightness: 0.28,
        energy: 0.8,
        airflowMode: "bottle",
        airSpeed: 9,
        diameter: 0.14,
        cavityDepth: 0.18,
        aperture: 0.18,
        turbulence: 0.45,
      },
      physical: { source: "lip jet", resonator: "Helmholtz cavity", wallMaterial: "porous stoneware" },
      model: {
        frequencyScale: 1.28,
        modes: [
          [1, 0.95, 1, -0.18], [2.88, 0.75, 0.72, 0.22], [4.82, 0.19, 0.1, -0.31],
          [6.55, 0.12, 0.055, 0.34],
        ],
      },
    }),
    definePreset({
      kind: "airflow-objects",
      id: "deep-pipe",
      label: "Deep Pipe",
      description: "A turbulent edge jet excites the odd modes of a long stopped pipe.",
      tags: ["cavity", "pipe", "wind"],
      settings: {
        ...airflowCommon,
        size: 1.1,
        damping: 0.5,
        brightness: 0.48,
        energy: 0.84,
        airSpeed: 24,
        diameter: 0.045,
        cavityDepth: 0.72,
        aperture: 0.42,
        turbulence: 0.62,
      },
      physical: { source: "edge jet", resonator: "stopped cylindrical pipe", strouhalNumber: 0.2 },
      model: {
        frequencyScale: 1,
        modes: [
          [1, 1.25, 1, -0.26], [3.01, 0.77, 0.43, 0.25], [5.04, 0.48, 0.24, -0.36],
          [7.1, 0.31, 0.14, 0.34], [9.2, 0.2, 0.08, -0.12], [11.36, 0.13, 0.045, 0.18],
        ],
      },
    }),
  ],
});

function defaultState(kind) {
  const presetId = PHYSICAL_SOUND_METADATA[kind].defaultPresetId;
  const preset = PHYSICAL_SOUND_PRESETS[kind].find((entry) => entry.id === presetId)
    ?? PHYSICAL_SOUND_PRESETS[kind][0];
  return deepFreeze({ ...preset.settings, presetId: preset.id });
}

export const PHYSICAL_SOUND_DEFAULTS = deepFreeze(Object.fromEntries(
  PHYSICAL_SOUND_KINDS.map((kind) => [kind, defaultState(kind)]),
));

export const PHYSICAL_SOUND_DEFINITIONS = deepFreeze(Object.fromEntries(
  PHYSICAL_SOUND_KINDS.map((kind) => [kind, {
    ...PHYSICAL_SOUND_METADATA[kind],
    limits: PHYSICAL_SOUND_LIMITS[kind],
    options: PHYSICAL_SOUND_OPTIONS[kind] ?? {},
    defaults: PHYSICAL_SOUND_DEFAULTS[kind],
    presets: PHYSICAL_SOUND_PRESETS[kind],
  }]),
));

const NUMERIC_STATE_KEYS = Object.freeze({
  "particle-cabinet": [
    ...Object.keys(COMMON_LIMITS),
    "objectCount", "particleSize", "roughness", "gravity",
  ],
  "impact-ecology": [
    ...Object.keys(COMMON_LIMITS),
    "restitution", "eventDensity", "hardness", "chaos", "strikePosition",
  ],
  "object-forge": [
    ...Object.keys(COMMON_LIMITS),
    "baseFrequencyHz", "stiffness", "strikePosition", "pickupPosition", "modeCount",
  ],
  "bowed-things": [
    ...Object.keys(COMMON_LIMITS),
    "baseFrequencyHz", "bowPressure", "bowVelocity", "bowPosition", "rosin",
  ],
  "airflow-objects": [
    ...Object.keys(COMMON_LIMITS),
    "airSpeed", "diameter", "cavityDepth", "aperture", "turbulence", "listenerAngle",
  ],
});

const INTEGER_STATE_KEYS = new Set(["objectCount", "modeCount"]);

function findPreset(kind, requestedId) {
  const id = safeToken(requestedId);
  return PHYSICAL_SOUND_PRESETS[kind].find((preset) => preset.id === id) ?? null;
}

/** Return the immutable definition for a physical-sound kind. Unknown kinds use Particle Cabinet. */
export function physicalSoundDefinition(kind) {
  return PHYSICAL_SOUND_DEFINITIONS[resolveKind(kind)];
}

/** Return an immutable preset, falling back to the selected kind's documented default. */
export function physicalSoundPreset(kind, presetId) {
  const resolvedKind = resolveKind(kind);
  return findPreset(resolvedKind, presetId)
    ?? findPreset(resolvedKind, PHYSICAL_SOUND_METADATA[resolvedKind].defaultPresetId)
    ?? PHYSICAL_SOUND_PRESETS[resolvedKind][0];
}

function optionValue(kind, key, candidateValue, fallbackValue, presetValue) {
  const options = PHYSICAL_SOUND_OPTIONS[kind]?.[key] ?? [];
  const candidateToken = safeToken(candidateValue);
  if (options.includes(candidateToken)) return candidateToken;
  const fallbackToken = safeToken(fallbackValue);
  if (options.includes(fallbackToken)) return fallbackToken;
  return options.includes(presetValue) ? presetValue : options[0];
}

function modalJsonValue(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.slice(0, MODAL_JSON_MAX_LENGTH);
}

/**
 * Return a fresh, frozen state containing exactly the public controls for `kind`.
 * Numbers may arrive as finite numeric strings. Symbols, objects, infinities,
 * throwing getters, unknown presets, and unknown enum values safely fall back.
 */
export function sanitizePhysicalSoundState(kind, candidate = {}, fallback) {
  const resolvedKind = resolveKind(kind);
  const source = safeObject(candidate);
  const defaultStateForKind = PHYSICAL_SOUND_DEFAULTS[resolvedKind];
  const base = safeObject(fallback);
  const basePreset = findPreset(resolvedKind, safeRead(base, "presetId"))
    ?? physicalSoundPreset(resolvedKind, defaultStateForKind.presetId);
  const requestedPreset = findPreset(resolvedKind, safeRead(source, "presetId"));
  const preset = requestedPreset ?? basePreset;
  const changedPreset = Boolean(requestedPreset && requestedPreset.id !== basePreset.id);
  const result = { presetId: preset.id };

  for (const key of NUMERIC_STATE_KEYS[resolvedKind]) {
    const limits = PHYSICAL_SOUND_LIMITS[resolvedKind][key];
    const presetValue = finiteNumber(preset.settings[key], defaultStateForKind[key]);
    const fallbackValue = changedPreset
      ? presetValue
      : finiteNumber(safeRead(base, key), presetValue);
    let value = clamp(
      finiteNumber(safeRead(source, key), fallbackValue),
      limits[0],
      limits[1],
    );
    if (INTEGER_STATE_KEYS.has(key)) value = Math.round(value);
    result[key] = value;
  }

  if (resolvedKind === "impact-ecology") {
    result.eventType = optionValue(
      resolvedKind,
      "eventType",
      safeRead(source, "eventType"),
      changedPreset ? preset.settings.eventType : safeRead(base, "eventType"),
      preset.settings.eventType,
    );
  } else if (resolvedKind === "object-forge") {
    const presetJson = modalJsonValue(preset.settings.modalJson, "");
    const baseJson = changedPreset
      ? presetJson
      : modalJsonValue(safeRead(base, "modalJson"), presetJson);
    result.modalJson = modalJsonValue(safeRead(source, "modalJson"), baseJson);
  } else if (resolvedKind === "airflow-objects") {
    result.airflowMode = optionValue(
      resolvedKind,
      "airflowMode",
      safeRead(source, "airflowMode"),
      changedPreset ? preset.settings.airflowMode : safeRead(base, "airflowMode"),
      preset.settings.airflowMode,
    );
  }

  // Stable insertion order keeps serialization and AudioWorklet messages predictable.
  return Object.freeze(result);
}

function parseCustomModes(modalJson) {
  if (typeof modalJson !== "string" || modalJson.trim() === "") return null;
  let source;
  try {
    source = JSON.parse(modalJson);
  } catch {
    return null;
  }
  const modes = Array.isArray(source) ? source : source?.modes;
  if (!Array.isArray(modes)) return null;
  const parsed = [];
  for (let index = 0; index < modes.length && parsed.length < HARD_MAX_MODES; index += 1) {
    const entry = safeObject(modes[index]);
    const ratio = finiteNumber(safeRead(entry, "ratio"), NaN);
    const t60Seconds = finiteNumber(
      safeRead(entry, "decay"),
      finiteNumber(safeRead(entry, "t60Seconds"), NaN),
    );
    const gain = finiteNumber(safeRead(entry, "gain"), NaN);
    if (!(ratio > 0) || !(t60Seconds > 0) || !Number.isFinite(gain)) continue;
    const explicitStrikeWeight = finiteNumber(
      safeRead(entry, "strikeWeight"),
      finiteNumber(safeRead(entry, "weight"), NaN),
    );
    parsed.push({
      ratio: clamp(ratio, 0.01, 128),
      t60Seconds: clamp(t60Seconds, 0.01, 60),
      gain: clamp(gain, -4, 4),
      pan: clamp(finiteNumber(safeRead(entry, "pan"), 0), -1, 1),
      strikeNode: Math.round(clamp(
        finiteNumber(safeRead(entry, "strikeNode"), index + 1),
        1,
        64,
      )),
      ...(Number.isFinite(explicitStrikeWeight)
        ? { strikeWeight: clamp(explicitStrikeWeight, -1, 1) }
        : {}),
    });
  }
  if (parsed.length === 0) return null;
  return {
    name: typeof source?.name === "string" ? source.name.slice(0, 160) : "Imported modal object",
    referenceStiffness: clamp(
      finiteNumber(safeRead(source, "referenceStiffness"), 0.5),
      0,
      1,
    ),
    dispersion: clamp(finiteNumber(safeRead(source, "dispersion"), 0.1), 0, 1),
    modes: parsed.sort((a, b) => a.ratio - b.ratio),
  };
}

/** Serialize the active Object Forge source modes without baking UI transforms twice. */
export function serializePhysicalModalJson(state) {
  const safeState = sanitizePhysicalSoundState("object-forge", state);
  const preset = physicalSoundPreset("object-forge", safeState.presetId);
  const imported = parseCustomModes(safeState.modalJson);
  const source = imported ?? {
    name: preset.label,
    referenceStiffness: finiteNumber(preset.settings.stiffness, 0.5),
    dispersion: finiteNumber(preset.model.dispersion, 0),
    modes: preset.model.modes,
  };
  const modes = source.modes.map((mode) => ({
    ratio: mode.ratio,
    decay: mode.t60Seconds,
    gain: mode.gain,
    pan: mode.pan,
    ...(Number.isFinite(mode.strikeWeight)
      ? { strikeWeight: mode.strikeWeight }
      : { strikeNode: mode.strikeNode }),
  }));
  return JSON.stringify({
    name: source.name,
    modeCount: Math.min(safeState.modeCount, modes.length),
    referenceStiffness: source.referenceStiffness,
    dispersion: source.dispersion,
    modes,
  }, null, 2);
}

function stringHash(value) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function deterministicSignedNoise(seed, index) {
  let value = (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 2_147_483_648 - 1;
}

function airflowFundamental(state, preset) {
  const size = Math.max(0.25, state.size);
  const diameter = Math.max(0.002, state.diameter * size);
  const depth = Math.max(0.005, state.cavityDepth * size);
  const scale = finiteNumber(preset.model.frequencyScale, 1);

  if (state.airflowMode === "aeolian") {
    const strouhal = clamp(finiteNumber(preset.model.strouhalNumber, 0.2), 0.12, 0.28);
    return Math.max(8, scale * strouhal * Math.max(0.1, state.airSpeed) / diameter);
  }

  if (state.airflowMode === "bottle") {
    const neckRadius = Math.max(0.001, diameter * (0.04 + 0.1 * state.aperture));
    const neckArea = Math.PI * neckRadius * neckRadius;
    const volume = Math.max(1e-8, Math.PI * (diameter * 0.5) ** 2 * depth);
    const effectiveNeckLength = Math.max(0.002, 0.025 * depth + 1.7 * neckRadius);
    return scale * SPEED_OF_SOUND_MPS / (Math.PI * 2)
      * Math.sqrt(neckArea / (volume * effectiveNeckLength));
  }

  const endCorrection = diameter * (0.22 + 0.18 * state.aperture);
  const flowCorrection = 1 + Math.min(0.08, state.airSpeed * 0.002);
  return scale * SPEED_OF_SOUND_MPS / (4 * (depth + endCorrection)) * flowCorrection;
}

function modalFundamental(kind, state, preset) {
  if (kind === "airflow-objects") return airflowFundamental(state, preset);
  const authored = kind === "object-forge" || kind === "bowed-things"
    ? state.baseFrequencyHz
    : preset.model.baseFrequencyHz;
  return Math.max(8, finiteNumber(authored, 220) / Math.max(0.25, state.size));
}

function spectralBrightness(kind, state) {
  if (kind === "particle-cabinet") {
    return clamp(state.brightness + (0.5 - state.particleSize) * 0.34 + state.roughness * 0.12, 0, 1);
  }
  if (kind === "impact-ecology") {
    return clamp(state.brightness + (state.hardness - 0.5) * 0.38, 0, 1);
  }
  if (kind === "bowed-things") {
    return clamp(state.brightness + (state.rosin - 0.5) * 0.18, 0, 1);
  }
  if (kind === "airflow-objects") {
    return clamp(state.brightness + (state.turbulence - 0.5) * 0.2, 0, 1);
  }
  return state.brightness;
}

function modeStrikeWeight(kind, state, preset, mode) {
  if (Number.isFinite(mode.strikeWeight)) return clamp(mode.strikeWeight, -1, 1);
  if (kind === "particle-cabinet" || kind === "airflow-objects") return 1;
  const position = kind === "bowed-things"
    ? state.bowPosition
    : state.strikePosition ?? preset.model.defaultStrikePosition;
  return Math.sin(Math.PI * mode.strikeNode * clamp(position, 0, 1));
}

function pickupWeight(kind, state, mode) {
  if (kind !== "object-forge") return 1;
  return Math.sin(Math.PI * mode.strikeNode * state.pickupPosition);
}

function airflowDirectionGain(state) {
  const radians = state.listenerAngle * Math.PI / 180;
  if (state.airflowMode === "bottle") return 0.82 + 0.18 * Math.abs(Math.cos(radians));
  return 0.25 + 0.75 * Math.abs(Math.cos(radians));
}

function particleExciterSnapshot(kind, preset) {
  if (kind !== "particle-cabinet") return null;
  const source = safeObject(preset.model.exciter);
  return Object.freeze({
    referenceObjectCount: Math.round(clamp(
      finiteNumber(preset.settings.objectCount, 48),
      1,
      1_024,
    )),
    rateScale: clamp(finiteNumber(safeRead(source, "rateScale"), 1), 0.2, 3),
    impactScale: clamp(finiteNumber(safeRead(source, "impactScale"), 1), 0.2, 3),
    contactBrightness: clamp(
      finiteNumber(safeRead(source, "contactBrightness"), 0.5),
      0,
      1,
    ),
    contactT60Seconds: clamp(
      finiteNumber(safeRead(source, "contactT60Seconds"), 0.006),
      0.0015,
      0.04,
    ),
    systemT60Seconds: clamp(
      finiteNumber(safeRead(source, "systemT60Seconds"), 0.5),
      0.04,
      2.5,
    ),
    scrapeMix: clamp(finiteNumber(safeRead(source, "scrapeMix"), 0.2), 0, 1),
    modalMix: clamp(finiteNumber(safeRead(source, "modalMix"), 1), 0.1, 3),
    contactMix: clamp(finiteNumber(safeRead(source, "contactMix"), 1), 0.1, 4),
  });
}

/**
 * Build a stable modal snapshot for an AudioWorklet.
 *
 * Every vector is a Float32Array of identical length. Frequencies are sorted,
 * finite, positive, and kept under a conservative 0.475 * sampleRate guard.
 * Object Forge accepts `{name,modes:[{ratio,decay,gain,pan?,strikeNode?}]}` in
 * `state.modalJson`; malformed imports fall back to the selected preset.
 */
export function buildPhysicalModalBank(
  kind,
  state,
  options = {},
) {
  const resolvedKind = resolveKind(kind);
  const safeState = sanitizePhysicalSoundState(resolvedKind, state);
  const preset = physicalSoundPreset(resolvedKind, safeState.presetId);
  const safeOptions = safeObject(options);
  const sampleRate = clamp(
    finiteNumber(safeRead(safeOptions, "sampleRate"), DEFAULT_SAMPLE_RATE),
    MIN_SAMPLE_RATE,
    MAX_SAMPLE_RATE,
  );
  const maxModes = Math.round(clamp(
    finiteNumber(safeRead(safeOptions, "maxModes"), DEFAULT_MAX_MODES),
    1,
    HARD_MAX_MODES,
  ));
  const imported = resolvedKind === "object-forge"
    ? parseCustomModes(safeState.modalJson)
    : null;
  const sourceModes = imported?.modes ?? preset.model.modes;
  const requestedCount = resolvedKind === "object-forge"
    ? Math.min(safeState.modeCount, maxModes)
    : maxModes;
  const structureKey = imported
    ? `custom:${stringHash(safeState.modalJson)}:${requestedCount}`
    : `preset:${preset.id}`;
  const frequencyLimitHz = sampleRate * 0.475;
  const requestedFundamental = finiteNumber(
    safeRead(safeOptions, "fundamentalOverrideHz"),
    NaN,
  );
  const fundamentalHz = Number.isFinite(requestedFundamental)
    ? clamp(requestedFundamental, MIN_MODAL_FREQUENCY_HZ, frequencyLimitHz)
    : modalFundamental(resolvedKind, safeState, preset);
  const brightness = spectralBrightness(resolvedKind, safeState);
  const maximumRatio = Math.max(1, ...sourceModes.map((mode) => mode.ratio));
  const dampingScale = 2 ** ((0.5 - safeState.damping) * 3);
  const sizeDecayScale = Math.sqrt(safeState.size);
  const presetStiffness = imported
    ? imported.referenceStiffness
    : finiteNumber(preset.settings.stiffness, safeState.stiffness ?? 0.5);
  const dispersion = imported
    ? imported.dispersion
    : finiteNumber(preset.model.dispersion, 0);
  const jitterAmount = resolvedKind === "particle-cabinet"
    ? safeState.roughness * 9
    : resolvedKind === "impact-ecology"
      ? safeState.chaos * 12
      : 0;
  const seed = stringHash(`${resolvedKind}:${preset.id}`);
  const particleExciter = particleExciterSnapshot(resolvedKind, preset);
  const rows = [];

  for (let index = 0; index < sourceModes.length && rows.length < requestedCount; index += 1) {
    const mode = sourceModes[index];
    let ratio = Math.max(0.01, finiteNumber(mode.ratio, 1));
    if (resolvedKind === "object-forge") {
      const relativeStiffness = safeState.stiffness - presetStiffness;
      ratio *= Math.max(0.75, 1 + relativeStiffness * dispersion * (1 - 1 / Math.max(1, ratio)));
    }
    const detuneCents = deterministicSignedNoise(seed, index) * jitterAmount;
    const frequencyHz = fundamentalHz * ratio * 2 ** (detuneCents / 1_200);
    if (!(frequencyHz > 0) || frequencyHz >= frequencyLimitHz) continue;
    const spectralPosition = Math.log2(Math.max(1, ratio)) / Math.max(1, Math.log2(maximumRatio));
    const tilt = 2 ** ((brightness - 0.5) * 4 * spectralPosition);
    const strikeWeight = modeStrikeWeight(resolvedKind, safeState, preset, mode);
    const pickup = pickupWeight(resolvedKind, safeState, mode);
    const directional = resolvedKind === "airflow-objects" ? airflowDirectionGain(safeState) : 1;
    const sourceGain = finiteNumber(mode.gain, 0) * tilt;
    const t60Seconds = clamp(
      finiteNumber(mode.t60Seconds, 0.2) * dampingScale * sizeDecayScale,
      0.012,
      30,
    );
    const panBias = resolvedKind === "airflow-objects"
      ? Math.sin(safeState.listenerAngle * Math.PI / 180) * 0.28
      : 0;
    rows.push({
      frequencyHz,
      t60Seconds,
      gain: sourceGain * pickup * directional,
      normalizationGain: sourceGain,
      pan: clamp((finiteNumber(mode.pan, 0) + panBias) * safeState.stereoWidth, -1, 1),
      strikeWeight,
    });
  }

  // Hostile low sample rates or fundamentals still produce one valid mode.
  if (rows.length === 0) {
    const mode = sourceModes[0] ?? { t60Seconds: 0.2, gain: 1, pan: 0, strikeNode: 1 };
    rows.push({
      frequencyHz: clamp(fundamentalHz, 8, frequencyLimitHz * 0.999),
      t60Seconds: clamp(finiteNumber(mode.t60Seconds, 0.2) * dampingScale, 0.012, 30),
      gain: finiteNumber(mode.gain, 1),
      normalizationGain: finiteNumber(mode.gain, 1),
      pan: 0,
      strikeWeight: modeStrikeWeight(resolvedKind, safeState, preset, mode),
    });
  }

  rows.sort((a, b) => a.frequencyHz - b.frequencyHz);
  let gainNorm = 0;
  for (const row of rows) gainNorm += row.normalizationGain * row.normalizationGain;
  const energyScale = gainNorm > 1e-18 ? safeState.energy / Math.sqrt(gainNorm) : 0;
  const count = rows.length;
  const frequenciesHz = new Float32Array(count);
  const t60Seconds = new Float32Array(count);
  const gains = new Float32Array(count);
  const pans = new Float32Array(count);
  const strikeWeights = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const row = rows[index];
    frequenciesHz[index] = row.frequencyHz;
    t60Seconds[index] = row.t60Seconds;
    gains[index] = row.gain * energyScale;
    pans[index] = row.pan;
    strikeWeights[index] = row.strikeWeight;
  }

  return Object.freeze({
    kind: resolvedKind,
    presetId: preset.id,
    source: imported ? "custom" : "preset",
    structureKey,
    name: imported?.name ?? preset.label,
    sampleRate,
    nyquistGuardHz: frequencyLimitHz,
    fundamentalHz,
    modeCount: count,
    frequenciesHz,
    t60Seconds,
    gains,
    pans,
    strikeWeights,
    ...(particleExciter ? { particleExciter } : {}),
  });
}

/** Retune Airflow Objects by solving its exposed physical geometry. */
export function tuneAirflowStateToFrequency(state, targetHz) {
  const safeState = sanitizePhysicalSoundState("airflow-objects", state);
  const preset = physicalSoundPreset("airflow-objects", safeState.presetId);
  const target = clamp(finiteNumber(targetHz, 220), 20, 4_000);
  const limits = PHYSICAL_SOUND_LIMITS["airflow-objects"];

  if (safeState.airflowMode === "aeolian") {
    const current = airflowFundamental(safeState, preset);
    const effectiveSpeed = Math.max(0.1, safeState.airSpeed);
    const airSpeed = clamp(
      effectiveSpeed * target / Math.max(8, current),
      ...limits.airSpeed,
    );
    let tuned = sanitizePhysicalSoundState("airflow-objects", {
      ...safeState,
      airSpeed,
    }, safeState);

    // Preserve the object diameter while flow alone can reach the note. Once
    // flow saturates, diameter is the secondary physical degree of freedom.
    const flowFrequency = airflowFundamental(tuned, preset);
    if (Math.abs(flowFrequency - target) / target > 1e-7) {
      tuned = sanitizePhysicalSoundState("airflow-objects", {
        ...tuned,
        diameter: clamp(tuned.diameter * flowFrequency / target, ...limits.diameter),
      }, tuned);
      const geometryFrequency = airflowFundamental(tuned, preset);
      tuned = sanitizePhysicalSoundState("airflow-objects", {
        ...tuned,
        airSpeed: clamp(
          Math.max(0.1, tuned.airSpeed) * target / Math.max(8, geometryFrequency),
          ...limits.airSpeed,
        ),
      }, tuned);
    }
    return tuned;
  }

  const frequencyAt = (cavityDepth) => airflowFundamental(
    sanitizePhysicalSoundState("airflow-objects", {
      ...safeState,
      cavityDepth,
    }, safeState),
    preset,
  );
  const [minimumDepth, maximumDepth] = limits.cavityDepth;
  const shallowFrequency = frequencyAt(minimumDepth);
  const deepFrequency = frequencyAt(maximumDepth);
  let cavityDepth = minimumDepth;
  if (target <= deepFrequency) cavityDepth = maximumDepth;
  else if (target < shallowFrequency) {
    let shallow = minimumDepth;
    let deep = maximumDepth;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const midpoint = Math.sqrt(shallow * deep);
      if (frequencyAt(midpoint) > target) shallow = midpoint;
      else deep = midpoint;
    }
    cavityDepth = Math.sqrt(shallow * deep);
  }
  return sanitizePhysicalSoundState("airflow-objects", {
    ...safeState,
    cavityDepth,
  }, safeState);
}
