const freezeList = (values) => Object.freeze([...values]);
const freezeRecord = (value) => Object.freeze({ ...value });

const finiteNumber = (value, fallback) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

export const SRTUSS_MASTER_PROJECT_IDS = freezeList([
  "XdSGz1",
  "Xd2GW3",
  "ldlfRS",
  "4tsGD8",
  "lldGDM",
  "ltKSRc",
  "4tdSDB",
  "MslBR4",
]);

export const SRTUSS_MASTER_MACROS = freezeList([
  freezeRecord({
    id: "clock",
    label: "Clock",
    description: "Scales the family clock while its source-specific sequencer remains intact.",
    min: 0.5,
    default: 1,
    max: 2,
    step: 0.01,
    curve: "exponential",
    unit: "x",
  }),
  freezeRecord({
    id: "tune",
    label: "Tune",
    description: "Offsets pitched families in semitones; noise families map this to band shift.",
    min: -24,
    default: 0,
    max: 24,
    step: 1,
    curve: "linear",
    unit: "st",
  }),
  freezeRecord({
    id: "shape",
    label: "Shape",
    description: "Moves between source-native oscillator or spectral characters.",
    min: -1,
    default: 0,
    max: 1,
    step: 0.01,
    curve: "bipolar",
    unit: "",
  }),
  freezeRecord({
    id: "brightness",
    label: "Brightness",
    description: "Darkens or brightens the source-native partial distribution.",
    min: -1,
    default: 0,
    max: 1,
    step: 0.01,
    curve: "bipolar",
    unit: "",
  }),
  freezeRecord({
    id: "contour",
    label: "Contour",
    description: "Shortens or lengthens source-native gates and decays.",
    min: -1,
    default: 0,
    max: 1,
    step: 0.01,
    curve: "bipolar",
    unit: "",
  }),
  freezeRecord({
    id: "pattern",
    label: "Pattern",
    description: "Moves from sparse to busy within the family algorithm.",
    min: -1,
    default: 0,
    max: 1,
    step: 0.01,
    curve: "bipolar",
    unit: "",
  }),
  freezeRecord({
    id: "motion",
    label: "Motion",
    description: "Reduces or exaggerates the family modulation and deterministic variation.",
    min: -1,
    default: 0,
    max: 1,
    step: 0.01,
    curve: "bipolar",
    unit: "",
  }),
  freezeRecord({
    id: "noise",
    label: "Noise",
    description: "Changes the amount of source-native noise, metal, sparks, or drum texture.",
    min: -1,
    default: 0,
    max: 1,
    step: 0.01,
    curve: "bipolar",
    unit: "",
  }),
  freezeRecord({
    id: "space",
    label: "Space",
    description: "Reduces or extends source-native taps, echoes, and stereo smear.",
    min: -1,
    default: 0,
    max: 1,
    step: 0.01,
    curve: "bipolar",
    unit: "",
  }),
  freezeRecord({
    id: "drive",
    label: "Drive",
    description: "Changes source-native clipping or saturation where that mechanism exists.",
    min: -1,
    default: 0,
    max: 1,
    step: 0.01,
    curve: "bipolar",
    unit: "",
  }),
]);

export const SRTUSS_MASTER_PARAM_ORDER = freezeList(
  SRTUSS_MASTER_MACROS.map(({ id }) => id),
);

export const SRTUSS_MASTER_PARAM_DEFAULTS = freezeRecord(
  Object.fromEntries(SRTUSS_MASTER_MACROS.map(({ id, default: value }) => [id, value])),
);

export const SRTUSS_MASTER_PARAM_LIMITS = freezeRecord(
  Object.fromEntries(
    SRTUSS_MASTER_MACROS.map(({ id, min, max, step, curve, unit }) => [
      id,
      freezeRecord({ min, max, step, curve, unit }),
    ]),
  ),
);

export const SRTUSS_MASTER_GLOBAL_DEFAULTS = freezeRecord({
  output: 0.72,
  clock: 1,
  tune: 0,
  width: 1,
  space: 0,
  drive: 0,
  maxVoices: 16,
});

const GLOBAL_LIMITS = freezeRecord({
  output: freezeRecord({ min: 0, max: 1 }),
  clock: freezeRecord({ min: 0.5, max: 2 }),
  tune: freezeRecord({ min: -24, max: 24 }),
  width: freezeRecord({ min: 0, max: 1.5 }),
  space: freezeRecord({ min: -1, max: 1 }),
  drive: freezeRecord({ min: -1, max: 1 }),
  maxVoices: freezeRecord({ min: 1, max: 16 }),
});

export const SRTUSS_MASTER_STEMS = freezeList([
  freezeRecord({
    id: "tone",
    label: "Tone",
    description: "Melody, chord, lead, and pitched oscillator material.",
  }),
  freezeRecord({
    id: "bass",
    label: "Bass",
    description: "Low pitched lines, sub tones, and bass gestures.",
  }),
  freezeRecord({
    id: "percussion",
    label: "Percussion",
    description: "Kicks, hats, impacts, bleeps, and other event-shaped hits.",
  }),
  freezeRecord({
    id: "texture",
    label: "Texture",
    description: "Noise, metal partials, engines, thunder, sparks, and beds.",
  }),
  freezeRecord({
    id: "fx",
    label: "FX",
    description: "Source-native echoes, feedback taps, stereo smear, and transitions.",
  }),
]);

export const SRTUSS_MASTER_STEM_DEFAULTS = freezeRecord(
  Object.fromEntries(SRTUSS_MASTER_STEMS.map(({ id }) => [id, 1])),
);

const STEM_IDS = freezeList(SRTUSS_MASTER_STEMS.map(({ id }) => id));
const PROJECT_ID_SET = new Set(SRTUSS_MASTER_PROJECT_IDS);

export const SRTUSS_MIX_PART_ID = "mix";

function makePart(index, id, label, role, description) {
  return freezeRecord({ index, id, label, role, description });
}

function makeFamily({
  projectId,
  title,
  description,
  techniqueTags,
  supportedStems,
  macroLabels,
  clockKind,
  clockLabel,
  postTopology = "additive",
  parts,
}) {
  const frozenLabels = freezeRecord(macroLabels);
  return freezeRecord({
    projectId,
    title,
    description,
    techniqueTags: freezeList(techniqueTags),
    supportedStems: freezeList(supportedStems),
    supportedMacros: freezeList(Object.keys(frozenLabels)),
    macroLabels: frozenLabels,
    clockKind,
    clockLabel,
    postTopology,
    parts: freezeList(parts),
  });
}

export const SRTUSS_MASTER_FAMILIES = freezeList([
  makeFamily({
    projectId: "XdSGz1",
    title: "noir et blanc",
    description: "A fixed step melody, pulse-shaped bass, detuned sine harmonics, and alternating stereo taps.",
    techniqueTags: ["fixed-step sequence", "detuned sine", "pulse shaping", "sub bass", "multitap echo"],
    supportedStems: ["tone", "bass", "fx"],
    clockKind: "step",
    clockLabel: "8-step source staircase",
    parts: [
      makePart(1, "melody", "Detuned melody", "lead", "Fixed-step sine melody, upper harmonic, and short subharmonic."),
      makePart(2, "bass", "Pulse + sub bass", "bass", "Pulse-shaped bass line and the long low sine voice."),
      makePart(3, "echo", "Alternating taps", "fx", "The authored eleven-tap alternating stereo echo, fed by melody and bass."),
    ],
    macroLabels: {
      clock: "Sequence rate",
      tune: "Transpose",
      shape: "Pulse shape",
      brightness: "Harmonic color",
      contour: "Note length",
      pattern: "Bass pattern",
      motion: "Pulse drift",
      space: "Echo field",
      drive: "Output saturation",
    },
  }),
  makeFamily({
    projectId: "Xd2GW3",
    title: "Industry II",
    description: "An unpitched machine of gated noise bands, engine vibration, programmed phase sweeps, thumps, and stereo echoes.",
    techniqueTags: ["interpolated noise", "noise differentiation", "phase trajectory", "cyclic gating", "multitap echo"],
    supportedStems: ["tone", "bass", "percussion", "texture", "fx"],
    clockKind: "free",
    clockLabel: "Overlapping 4 s / 7 s / 1.25 s cycles",
    parts: [
      makePart(1, "noise-band", "Gated noise band", "texture", "Differentiated high-rate noise shaped by the four-second cycle."),
      makePart(2, "engine", "Engine tone", "harmony", "Vibrating engine pair plus its low sine carrier."),
      makePart(3, "grind", "Grind", "texture", "Rough high-rate noise sweep modulated by a twenty-radian motion."),
      makePart(4, "phase-sweep", "Phase sweep", "fx", "Seven-second programmed nonlinear phase trajectory."),
      makePart(5, "thump", "Machine thump", "kick", "Short 1.25-second pitched-noise impact."),
      makePart(6, "echo", "Machine echo", "fx", "The authored alternating multitap echo fed by all five dry mechanisms."),
    ],
    macroLabels: {
      clock: "Cycle rate",
      tune: "Band shift",
      shape: "Engine character",
      brightness: "Noise edge",
      contour: "Impact decay",
      pattern: "Cycle spacing",
      motion: "Phase sweep",
      noise: "Machine noise",
      space: "Echo field",
      drive: "Machine saturation",
    },
  }),
  makeFamily({
    projectId: "ldlfRS",
    title: "Shift",
    description: "A stochastic additive body with a Dorian procedural lead, pulse bass, synthetic drums, and short stereo delays.",
    techniqueTags: ["stochastic additive", "Dorian quantization", "procedural arpeggio", "PWM", "synthetic drums"],
    supportedStems: ["tone", "bass", "percussion", "texture", "fx"],
    clockKind: "step",
    clockLabel: "10-unit groove grid with 64/96/128-unit sections",
    parts: [
      makePart(1, "spectral-body", "Stochastic body", "texture", "A 256-partial noise-weighted additive oscillator."),
      makePart(2, "dorian-arp", "Dorian PWM arp", "lead", "Deterministic Dorian note selection through a pulse-width voice."),
      makePart(3, "bass", "Pulse bass", "bass", "Low pulse and sine bass gestures following the shared section transposition."),
      makePart(4, "kick", "Pitch-drop kicks", "kick", "Two phase-offset synthetic pitch-drop kick patterns."),
      makePart(5, "snare", "Snare noise", "snare", "Four-step exponentially decaying noise hit."),
      makePart(6, "hats", "Hats + ticks", "hats", "Fast noise ticks with deterministic level variation."),
      makePart(7, "delay", "Stereo delays", "fx", "Two short cross-channel taps fed only by the body and arpeggio."),
    ],
    macroLabels: {
      clock: "Groove rate",
      tune: "Dorian transpose",
      shape: "Spectral / PWM blend",
      brightness: "Partial brightness",
      contour: "Gate length",
      pattern: "Full-mix rhythm gate",
      motion: "Harmonic motion",
      noise: "Drum noise",
      space: "Stereo taps",
      drive: "Output saturation",
    },
  }),
  makeFamily({
    projectId: "4tsGD8",
    title: "Boulder Dash title",
    description: "A literal 128-step stereo phase score played by paired triangle-like oscillators with intro bleeps and dusty bursts.",
    techniqueTags: ["piecewise phase score", "tracker sequence", "triangle oscillator", "micro-vibrato", "stereo smear"],
    supportedStems: ["tone", "percussion", "texture", "fx"],
    clockKind: "step",
    clockLabel: "Two-lane 128-step tracker score at 6.6 units/s",
    parts: [
      makePart(1, "tracker-a", "Tracker lane A", "lead", "First lane of the literal 128-step phase score."),
      makePart(2, "tracker-b", "Tracker lane B", "harmony", "Second lane of the literal 128-step phase score."),
      makePart(3, "intro-bleep", "Intro bleep", "percussion", "Bright section-gated introductory bleep."),
      makePart(4, "dust", "Dust bursts", "texture", "Continuous grit and sharply gated dusty noise swells."),
      makePart(5, "smear", "Short smear taps", "fx", "Three delayed copies of the complete dry tracker voice."),
    ],
    macroLabels: {
      clock: "Tracker rate",
      tune: "Phase transpose",
      shape: "Triangle body",
      brightness: "Bleep edge",
      contour: "Step gate",
      pattern: "Phrase density",
      motion: "Micro-vibrato",
      noise: "Dust bursts",
      space: "Smear taps",
      drive: "Tracker saturation",
    },
  }),
  makeFamily({
    projectId: "lldGDM",
    title: "Noise Bands",
    description: "Texture-weighted metal partials drift through slow seed morphs above a synthesized kick, hats, risers, and bleep echoes.",
    techniqueTags: ["texture-weighted additive", "metal partials", "seed crossfade", "sidechain ducking", "soft saturation"],
    supportedStems: ["tone", "bass", "percussion", "texture", "fx"],
    clockKind: "beat",
    clockLabel: "2.1 beat grid plus independent metal seed clocks",
    postTopology: "shared duck and saturation",
    parts: [
      makePart(1, "metal-bed", "Metal bed", "texture", "Texture-weighted additive metal with slowly crossfaded random seeds."),
      makePart(2, "high-tick", "High tick", "lead", "Sparse 13 kHz stereo tick embedded in the texture generator."),
      makePart(3, "kick", "Kick", "kick", "Two-component falling-pitch kick and click."),
      makePart(4, "hats", "Hats", "hats", "Three offset hats plus the slower noise accent."),
      makePart(5, "metal-accents", "Metal accents", "percussion", "Paired low metal hits on the 32-beat cycle."),
      makePart(6, "bleep-echo", "Bleep echo", "fx", "Quantized bleep with two asymmetric stereo repeats."),
    ],
    macroLabels: {
      clock: "Beat rate",
      tune: "Bleep / metal pitch",
      shape: "Metal body",
      brightness: "Spectral low-pass",
      contour: "Hit decay",
      pattern: "Fill density",
      motion: "Seed morph",
      noise: "Noise-metal mix",
      space: "Bleep echoes",
      drive: "Soft saturation",
    },
  }),
  makeFamily({
    projectId: "ltKSRc",
    title: "Gravity Shielding",
    description: "A freely accelerating soundscape of stochastic tone clouds, texture-fed metal, sparks, phase-swept impacts, and repeating thunder.",
    techniqueTags: ["time warp", "stochastic partial cloud", "texture-fed metal", "stereo sparks", "FBM thunder"],
    supportedStems: ["tone", "bass", "percussion", "texture", "fx"],
    clockKind: "free",
    clockLabel: "Nonlinear time warp with independent 6.2 thunder cycle",
    postTopology: "thunder replacement crossfade",
    parts: [
      makePart(1, "tone-cloud", "Tone cloud", "harmony", "Stochastic partial cloud blended with a high sine wobble."),
      makePart(2, "metal-bed", "Texture metal", "texture", "Thirty texture-fed metallic partials."),
      makePart(3, "sparks", "Stereo sparks", "hats", "Rapid alternating exponential spark impulses."),
      makePart(4, "impact", "Swept impact", "fx", "Noise onset and nonlinear phase-swept impact gesture."),
      makePart(5, "thunder", "FBM thunder", "bass", "Three layered fractal-noise thunder strikes on the 6.2 cycle."),
    ],
    macroLabels: {
      clock: "Time warp",
      tune: "Band shift",
      shape: "Cloud / metal blend",
      brightness: "Partial brightness",
      contour: "Thunder decay",
      pattern: "Event spacing",
      motion: "Wobble and sweep",
      noise: "Sparks / thunder",
      space: "Impact field",
      drive: "Storm saturation",
    },
  }),
  makeFamily({
    projectId: "4tdSDB",
    title: "DnB",
    description: "Nested break clocks drive texture-shaped metal drums, a pitched harmonic pad, bass sweeps, fills, and stereo chord echoes.",
    techniqueTags: ["nested break clock", "100-partial metal", "harmonic pad", "pitch-swept bass", "stereo echo"],
    supportedStems: ["tone", "bass", "percussion", "texture", "fx"],
    clockKind: "beat",
    clockLabel: "2.2 break grid with nested 1/4 to 32-beat periods",
    postTopology: "section replacement riser",
    parts: [
      makePart(1, "kick", "Noise kick", "kick", "Short noise kick on the nested break pulse."),
      makePart(2, "metal-hits", "Metal hits", "percussion", "Two alternating 100-partial metal drum voices."),
      makePart(3, "hats", "Closed + open hats", "hats", "Fast and slow high-frequency metal hats."),
      makePart(4, "snare-fill", "Snare + fill", "snare", "Noise-and-tone snare gesture with fill modulation."),
      makePart(5, "bass-sweep", "Bass sweep", "bass", "Low falling-frequency sine sweep."),
      makePart(6, "pad-echo", "Harmonic pad", "harmony", "Procedurally voiced additive chord and stereo echo taps."),
      makePart(7, "transition", "Transition riser", "fx", "Texture-metal riser that replaces the mix at section boundaries."),
    ],
    macroLabels: {
      clock: "Break rate",
      tune: "Pad / bass pitch",
      shape: "Metal / pad body",
      brightness: "Metal low-pass",
      contour: "Hit decay",
      pattern: "Break density",
      motion: "Pitch variation",
      noise: "Drum metal",
      space: "Harmonic echoes",
      drive: "Break saturation",
    },
  }),
  makeFamily({
    projectId: "MslBR4",
    title: "Cipher",
    description: "A sectioned Lydian generator moving from sine dyads and additive pads into a PWM lead, stereo feedback, and synthetic drums.",
    techniqueTags: ["Lydian quantization", "deterministic note generator", "additive pad", "PWM lead", "stereo feedback"],
    supportedStems: ["tone", "bass", "percussion", "texture", "fx"],
    clockKind: "beat",
    clockLabel: "2.4 beat grid with 32/64/128-unit sections",
    postTopology: "shared drum ducking",
    parts: [
      makePart(1, "lydian-dyad", "Lydian dyad", "lead", "Two gated high sine voices quantized to Lydian intervals."),
      makePart(2, "root-bass", "Root bass", "bass", "Paired low root oscillators."),
      makePart(3, "chord-pad", "Chord pad", "harmony", "Three additive Lydian pad voices."),
      makePart(4, "pwm-lead", "PWM lead", "lead", "Late-section deterministic pulse-width lead."),
      makePart(5, "feedback", "Stereo feedback", "fx", "Three delayed alternating feedback taps from all tonal voices."),
      makePart(6, "hats", "Hats", "hats", "Fast deterministic noise tick layer."),
      makePart(7, "kick", "Kick", "kick", "Section-gated falling-pitch synthetic kick."),
      makePart(8, "snare", "Snare", "snare", "Section-gated exponential noise snare."),
      makePart(9, "tom", "Tom", "percussion", "Short high falling-pitch drum voice."),
    ],
    macroLabels: {
      clock: "Sequence rate",
      tune: "Lydian transpose",
      shape: "Pad / PWM blend",
      brightness: "Chord color",
      contour: "Gate length",
      pattern: "Section density",
      motion: "Note motion",
      noise: "Drum noise",
      space: "Stereo feedback",
      drive: "Cipher saturation",
    },
  }),
]);

const FAMILY_BY_ID = new Map(
  SRTUSS_MASTER_FAMILIES.map((family) => [family.projectId, family]),
);

export function srtussMasterFamily(projectId) {
  return FAMILY_BY_ID.get(projectId) ?? null;
}
export function srtussMasterParts(projectId) {
  return srtussMasterFamily(projectId)?.parts ?? freezeList([]);
}

export function srtussMasterPart(projectId, partId) {
  if (partId === SRTUSS_MIX_PART_ID) {
    return freezeRecord({ index: 0, id: SRTUSS_MIX_PART_ID, label: "Complete mix", role: "mix" });
  }
  return srtussMasterParts(projectId).find(({ id }) => id === partId) ?? null;
}

export function sanitizeSrtussMasterPartId(projectId, partId, mode = "master") {
  if (mode !== "master") return SRTUSS_MIX_PART_ID;
  return srtussMasterPart(projectId, partId)?.id ?? SRTUSS_MIX_PART_ID;
}

export function srtussMasterPartIndex(projectId, partId, mode = "master") {
  return srtussMasterPart(projectId, sanitizeSrtussMasterPartId(projectId, partId, mode))?.index ?? 0;
}

export function sanitizeSrtussMasterGlobals(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  for (const key of Object.keys(SRTUSS_MASTER_GLOBAL_DEFAULTS)) {
    const fallback = SRTUSS_MASTER_GLOBAL_DEFAULTS[key];
    const { min, max } = GLOBAL_LIMITS[key];
    const candidate = clamp(finiteNumber(source[key], fallback), min, max);
    result[key] = key === "maxVoices" ? Math.round(candidate) : candidate;
  }
  return freezeRecord(result);
}

export function sanitizeSrtussMasterParams(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  for (const id of SRTUSS_MASTER_PARAM_ORDER) {
    const fallback = SRTUSS_MASTER_PARAM_DEFAULTS[id];
    const { min, max } = SRTUSS_MASTER_PARAM_LIMITS[id];
    result[id] = clamp(finiteNumber(source[id], fallback), min, max);
  }
  return freezeRecord(result);
}

export function sanitizeSrtussMasterStems(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  for (const id of STEM_IDS) {
    result[id] = clamp(
      finiteNumber(source[id], SRTUSS_MASTER_STEM_DEFAULTS[id]),
      0,
      1.25,
    );
  }
  return freezeRecord(result);
}

function makeVoice({
  id,
  projectId,
  partId = SRTUSS_MIX_PART_ID,
  groupId,
  enabled = true,
  level = 1,
  pan = 0,
  params,
  stems,
}) {
  if (!PROJECT_ID_SET.has(projectId)) {
    throw new RangeError(`Unknown srtuss master project: ${projectId}`);
  }
  const requestedGroupId = String(groupId ?? id ?? "group")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .slice(0, 48) || "group";
  return freezeRecord({
    id,
    projectId,
    partId: sanitizeSrtussMasterPartId(projectId, partId, "master"),
    groupId: requestedGroupId,
    enabled: Boolean(enabled),
    level: clamp(finiteNumber(level, 1), 0, 1),
    pan: clamp(finiteNumber(pan, 0), -1, 1),
    params: sanitizeSrtussMasterParams(params),
    stems: sanitizeSrtussMasterStems(stems),
  });
}

function makePreset({ id, label, description, mode, kind, globals, voices }) {
  return freezeRecord({
    version: 1,
    id,
    label,
    description,
    mode: mode === "master" ? "master" : "original",
    kind: kind ?? (mode === "master" ? "scene" : "original"),
    globals: sanitizeSrtussMasterGlobals(globals),
    voices: freezeList(voices.slice(0, 16).map(makeVoice)),
  });
}

const ORIGINAL_PRESET_DATA = [
  ["original-noir", "Original · noir et blanc", "XdSGz1", "The exact source program at neutral parameters."],
  ["original-industry", "Original · Industry II", "Xd2GW3", "The exact source program at neutral parameters."],
  ["original-shift", "Original · Shift", "ldlfRS", "The exact source program at neutral parameters."],
  ["original-boulder", "Original · Boulder Dash", "4tsGD8", "The exact source program at neutral parameters."],
  ["original-noise-bands", "Original · Noise Bands", "lldGDM", "The exact source program at neutral parameters."],
  ["original-gravity", "Original · Gravity Shielding", "ltKSRc", "The exact source program at neutral parameters."],
  ["original-dnb", "Original · DnB", "4tdSDB", "The exact source program at neutral parameters."],
  ["original-cipher", "Original · Cipher", "MslBR4", "The exact source program at neutral parameters."],
];

const ORIGINAL_PRESETS = ORIGINAL_PRESET_DATA.map(
  ([id, label, projectId, description]) => makePreset({
    id,
    label,
    description,
    mode: "original",
    globals: SRTUSS_MASTER_GLOBAL_DEFAULTS,
    voices: [{
      id: `${id}-voice-1`,
      projectId,
      level: 1,
      pan: 0,
      params: SRTUSS_MASTER_PARAM_DEFAULTS,
      stems: SRTUSS_MASTER_STEM_DEFAULTS,
    }],
  }),
);

const DECOMPOSED_PRESETS = SRTUSS_MASTER_FAMILIES.map((family) => {
  const groupId = "parts-" + family.projectId.toLowerCase();
  return makePreset({
    id: groupId,
    label: "Parts · " + family.title,
    description: "Independent, synchronized "
      + family.parts.map(({ label }) => label).join(", ")
      + ".",
    mode: "master",
    kind: "parts",
    globals: { ...SRTUSS_MASTER_GLOBAL_DEFAULTS, output: 0.64 },
    voices: family.parts.map((part) => ({
      id: groupId + "-" + part.id,
      groupId,
      projectId: family.projectId,
      partId: part.id,
      level: 1,
      pan: 0,
      params: SRTUSS_MASTER_PARAM_DEFAULTS,
      stems: SRTUSS_MASTER_STEM_DEFAULTS,
    })),
  });
});

const MASTER_PRESETS = [
  makePreset({
    id: "monochrome-machinery",
    label: "Monochrome Machinery",
    description: "Noir pulse harmony crosses an Industry engine bed and a restrained Shift arpeggio.",
    mode: "master",
    globals: { output: 0.64, width: 1.12, space: 0.16 },
    voices: [
      {
        id: "monochrome-noir",
        projectId: "XdSGz1",
        level: 0.38,
        pan: -0.32,
        params: { clock: 0.96, tune: -5, shape: 0.22, brightness: -0.12, contour: 0.18, motion: 0.35, space: 0.24 },
        stems: { bass: 0.62, fx: 0.72 },
      },
      {
        id: "monochrome-industry",
        projectId: "Xd2GW3",
        level: 0.28,
        pan: 0,
        params: { clock: 0.72, tune: -7, shape: 0.4, brightness: -0.36, contour: 0.34, motion: 0.58, noise: 0.42, space: 0.12 },
        stems: { percussion: 0.56, texture: 0.82, fx: 0.5 },
      },
      {
        id: "monochrome-shift",
        projectId: "ldlfRS",
        level: 0.3,
        pan: 0.34,
        params: { clock: 1.08, tune: 7, shape: -0.2, brightness: 0.14, contour: -0.2, pattern: 0.22, motion: 0.28, noise: -0.18, space: 0.1 },
        stems: { bass: 0.48, percussion: 0.58, fx: 0.5 },
      },
    ],
  }),
  makePreset({
    id: "rubble-weather",
    label: "Rubble Weather",
    description: "Boulder tracker fragments surface through Noise Bands metal and slow Gravity thunder.",
    mode: "master",
    globals: { output: 0.62, clock: 0.9, width: 1.2, space: 0.12, drive: -0.08 },
    voices: [
      {
        id: "rubble-boulder",
        projectId: "4tsGD8",
        level: 0.34,
        pan: -0.42,
        params: { clock: 0.84, tune: -12, shape: 0.12, brightness: -0.08, contour: 0.24, pattern: -0.16, motion: 0.3, noise: -0.1, space: 0.3 },
        stems: { tone: 0.82, percussion: 0.5, texture: 0.64, fx: 0.7 },
      },
      {
        id: "rubble-bands",
        projectId: "lldGDM",
        level: 0.27,
        pan: 0.03,
        params: { clock: 0.92, tune: -5, shape: 0.45, brightness: -0.28, contour: 0.32, pattern: 0.38, motion: 0.52, noise: 0.48, space: 0.18, drive: 0.2 },
        stems: { tone: 0.46, percussion: 0.62, texture: 0.9, fx: 0.58 },
      },
      {
        id: "rubble-gravity",
        projectId: "ltKSRc",
        level: 0.25,
        pan: 0.44,
        params: { clock: 0.68, tune: -9, shape: -0.18, brightness: -0.42, contour: 0.55, pattern: -0.3, motion: 0.62, noise: 0.36 },
        stems: { tone: 0.55, percussion: 0.48, texture: 0.86 },
      },
    ],
  }),
  makePreset({
    id: "ciphered-breaks",
    label: "Ciphered Breaks",
    description: "DnB percussion supports Cipher harmony while Shift supplies a narrow counter-pattern.",
    mode: "master",
    globals: { output: 0.66, clock: 1.04, tune: -2, width: 1.08, space: 0.1 },
    voices: [
      {
        id: "ciphered-dnb",
        projectId: "4tdSDB",
        level: 0.36,
        pan: -0.2,
        params: { clock: 1.06, tune: -5, shape: 0.16, brightness: 0.12, contour: -0.16, pattern: 0.48, motion: 0.18, noise: 0.32, space: -0.16 },
        stems: { tone: 0.42, bass: 0.78, percussion: 0.92, texture: 0.65, fx: 0.44 },
      },
      {
        id: "ciphered-cipher",
        projectId: "MslBR4",
        level: 0.34,
        pan: 0.25,
        params: { clock: 0.98, tune: 7, shape: -0.25, brightness: -0.12, contour: 0.2, pattern: 0.16, motion: 0.4, noise: -0.35, space: 0.32 },
        stems: { bass: 0.5, percussion: 0.45, texture: 0.52, fx: 0.76 },
      },
      {
        id: "ciphered-shift",
        projectId: "ldlfRS",
        level: 0.2,
        pan: 0.52,
        params: { clock: 1.22, tune: 12, shape: 0.28, brightness: 0.34, contour: -0.38, pattern: -0.2, motion: 0.22, noise: -0.7, space: -0.25 },
        stems: { bass: 0.25, percussion: 0.2, texture: 0.4, fx: 0.35 },
      },
    ],
  }),
  makePreset({
    id: "eightfold-relay",
    label: "Eightfold Relay",
    description: "Four restrained families relay melody, mechanism, breaks, and Lydian color across the stereo field.",
    mode: "master",
    globals: { output: 0.58, clock: 0.94, tune: -3, width: 1.25, space: 0.2, drive: -0.12 },
    voices: [
      {
        id: "relay-noir",
        projectId: "XdSGz1",
        level: 0.25,
        pan: -0.62,
        params: { clock: 0.9, tune: -12, shape: -0.18, brightness: -0.28, contour: 0.28, pattern: -0.12, motion: 0.2, space: 0.16 },
        stems: { bass: 0.58, fx: 0.48 },
      },
      {
        id: "relay-industry",
        projectId: "Xd2GW3",
        level: 0.2,
        pan: -0.18,
        params: { clock: 0.62, tune: -10, shape: 0.34, brightness: -0.5, contour: 0.46, pattern: -0.35, motion: 0.5, noise: 0.28, space: -0.12 },
        stems: { tone: 0.45, percussion: 0.42, texture: 0.72, fx: 0.35 },
      },
      {
        id: "relay-dnb",
        projectId: "4tdSDB",
        level: 0.24,
        pan: 0.2,
        params: { clock: 1.12, tune: -5, shape: -0.12, brightness: 0.08, contour: -0.22, pattern: 0.3, motion: 0.12, noise: 0.2, space: -0.3 },
        stems: { tone: 0.25, bass: 0.72, percussion: 0.78, texture: 0.48, fx: 0.3 },
      },
      {
        id: "relay-cipher",
        projectId: "MslBR4",
        level: 0.25,
        pan: 0.62,
        params: { clock: 0.88, tune: 7, shape: -0.35, brightness: -0.18, contour: 0.34, pattern: -0.08, motion: 0.44, noise: -0.46, space: 0.38 },
        stems: { bass: 0.42, percussion: 0.34, texture: 0.46, fx: 0.68 },
      },
    ],
  }),
];

const ADDITIONAL_MASTER_PRESETS = [
  makePreset({
    id: "velvet-staircase",
    label: "Velvet Staircase",
    description: "Noir's pulse melody leads a dark, slow Cipher reflection with the rhythm section pulled into the distance.",
    mode: "master",
    globals: { output: 0.6, clock: 0.88, width: 1.16, space: 0.2, drive: -0.12 },
    voices: [
      {
        id: "velvet-noir",
        projectId: "XdSGz1",
        level: 0.55,
        pan: -0.26,
        params: { clock: 0.86, tune: -7, shape: -0.32, brightness: -0.24, contour: 0.36, pattern: -0.14, motion: 0.18, noise: -0.4, space: 0.3, drive: -0.08 },
        stems: { tone: 1.12, bass: 0.78, percussion: 0.08, texture: 0.08, fx: 0.7 },
      },
      {
        id: "velvet-cipher",
        projectId: "MslBR4",
        level: 0.22,
        pan: 0.34,
        params: { clock: 0.72, tune: 5, shape: -0.44, brightness: -0.38, contour: 0.46, pattern: -0.25, motion: 0.22, noise: -0.55, space: 0.38, drive: -0.15 },
        stems: { tone: 0.64, bass: 0.22, percussion: 0.1, texture: 0.18, fx: 0.52 },
      },
    ],
  }),
  makePreset({
    id: "factory-cadence",
    label: "Factory Cadence",
    description: "Industry II becomes the foreground rhythm machine, reinforced by clipped DnB weight.",
    mode: "master",
    globals: { output: 0.54, clock: 1.02, width: 1.1, space: -0.12, drive: 0.12 },
    voices: [
      {
        id: "factory-industry",
        projectId: "Xd2GW3",
        level: 0.46,
        pan: -0.18,
        params: { clock: 1.08, tune: -3, shape: 0.58, brightness: 0.24, contour: -0.3, pattern: 0.52, motion: 0.66, noise: 0.62, space: -0.28, drive: 0.18 },
        stems: { tone: 0.66, bass: 0.2, percussion: 0.9, texture: 1.14, fx: 0.42 },
      },
      {
        id: "factory-dnb",
        projectId: "4tdSDB",
        level: 0.2,
        pan: 0.22,
        params: { clock: 0.96, tune: -12, shape: -0.16, brightness: -0.08, contour: -0.38, pattern: 0.34, motion: 0.14, noise: 0.28, space: -0.5, drive: 0.2 },
        stems: { tone: 0.12, bass: 0.72, percussion: 0.76, texture: 0.48, fx: 0.16 },
      },
    ],
  }),
  makePreset({
    id: "dorian-prism",
    label: "Dorian Prism",
    description: "Shift's stochastic Dorian arpeggio is isolated and brightened above a restrained Noir harmonic shadow.",
    mode: "master",
    globals: { output: 0.58, clock: 1.08, tune: 2, width: 1.34, space: 0.14, drive: -0.04 },
    voices: [
      {
        id: "prism-shift",
        projectId: "ldlfRS",
        level: 0.5,
        pan: 0.12,
        params: { clock: 1.2, tune: 7, shape: 0.38, brightness: 0.58, contour: -0.26, pattern: 0.44, motion: 0.52, noise: -0.62, space: 0.08, drive: -0.08 },
        stems: { tone: 1.16, bass: 0.34, percussion: 0.24, texture: 0.54, fx: 0.5 },
      },
      {
        id: "prism-noir",
        projectId: "XdSGz1",
        level: 0.18,
        pan: -0.58,
        params: { clock: 0.82, tune: -5, shape: -0.2, brightness: 0.12, contour: 0.24, pattern: -0.34, motion: 0.18, noise: -0.6, space: 0.3, drive: -0.12 },
        stems: { tone: 0.62, bass: 0.24, percussion: 0.05, texture: 0.05, fx: 0.46 },
      },
    ],
  }),
  makePreset({
    id: "tracker-afterimage",
    label: "Tracker Afterimage",
    description: "Boulder Dash's literal phase score stays central while Noise Bands dust lengthens its stereo trail.",
    mode: "master",
    globals: { output: 0.57, clock: 0.84, width: 1.38, space: 0.3, drive: -0.1 },
    voices: [
      {
        id: "afterimage-boulder",
        projectId: "4tsGD8",
        level: 0.52,
        pan: -0.1,
        params: { clock: 0.9, tune: -5, shape: 0.24, brightness: 0.18, contour: 0.42, pattern: -0.2, motion: 0.34, noise: -0.18, space: 0.62, drive: -0.08 },
        stems: { tone: 1.12, bass: 0.24, percussion: 0.5, texture: 0.44, fx: 0.94 },
      },
      {
        id: "afterimage-bands",
        projectId: "lldGDM",
        level: 0.14,
        pan: 0.5,
        params: { clock: 0.58, tune: 7, shape: -0.22, brightness: -0.32, contour: 0.6, pattern: -0.58, motion: 0.7, noise: 0.34, space: 0.42, drive: -0.16 },
        stems: { tone: 0.16, bass: 0.12, percussion: 0.18, texture: 0.68, fx: 0.42 },
      },
    ],
  }),
  makePreset({
    id: "ferrous-bloom",
    label: "Ferrous Bloom",
    description: "Noise Bands opens into a slow metal bloom shaded by distant Industry machinery.",
    mode: "master",
    globals: { output: 0.53, clock: 0.76, width: 1.26, space: 0.24, drive: 0.16 },
    voices: [
      {
        id: "bloom-bands",
        projectId: "lldGDM",
        level: 0.48,
        pan: 0.06,
        params: { clock: 0.72, tune: -7, shape: 0.64, brightness: -0.18, contour: 0.5, pattern: -0.26, motion: 0.78, noise: 0.66, space: 0.4, drive: 0.34 },
        stems: { tone: 0.42, bass: 0.38, percussion: 0.46, texture: 1.18, fx: 0.72 },
      },
      {
        id: "bloom-industry",
        projectId: "Xd2GW3",
        level: 0.18,
        pan: -0.46,
        params: { clock: 0.62, tune: -12, shape: 0.5, brightness: -0.44, contour: 0.42, pattern: -0.5, motion: 0.56, noise: 0.38, space: 0.18, drive: 0.08 },
        stems: { tone: 0.24, bass: 0.18, percussion: 0.32, texture: 0.72, fx: 0.4 },
      },
    ],
  }),
  makePreset({
    id: "orbital-weather",
    label: "Orbital Weather",
    description: "Gravity Shielding becomes a spacious foreground storm with Boulder sparks orbiting its edges.",
    mode: "master",
    globals: { output: 0.5, clock: 0.66, width: 1.42, space: 0.32, drive: -0.18 },
    voices: [
      {
        id: "weather-gravity",
        projectId: "ltKSRc",
        level: 0.5,
        pan: 0,
        params: { clock: 0.62, tune: -12, shape: -0.46, brightness: -0.28, contour: 0.76, pattern: -0.54, motion: 0.72, noise: 0.52, space: 0.58, drive: -0.24 },
        stems: { tone: 0.76, bass: 0.68, percussion: 0.48, texture: 1.12, fx: 0.74 },
      },
      {
        id: "weather-boulder",
        projectId: "4tsGD8",
        level: 0.14,
        pan: 0.58,
        params: { clock: 0.54, tune: 12, shape: -0.1, brightness: 0.36, contour: -0.28, pattern: -0.7, motion: 0.28, noise: 0.16, space: 0.48, drive: -0.2 },
        stems: { tone: 0.16, bass: 0.08, percussion: 0.42, texture: 0.5, fx: 0.56 },
      },
    ],
  }),
  makePreset({
    id: "breakbeat-cathedral",
    label: "Breakbeat Cathedral",
    description: "DnB takes the pulpit: deep breaks and bass sweeps support a high Cipher choir.",
    mode: "master",
    globals: { output: 0.56, clock: 1.14, tune: -2, width: 1.22, space: 0.16, drive: 0.08 },
    voices: [
      {
        id: "cathedral-dnb",
        projectId: "4tdSDB",
        level: 0.48,
        pan: -0.08,
        params: { clock: 1.18, tune: -7, shape: 0.28, brightness: 0.2, contour: -0.34, pattern: 0.64, motion: 0.4, noise: 0.5, space: -0.2, drive: 0.24 },
        stems: { tone: 0.58, bass: 1.08, percussion: 1.14, texture: 0.84, fx: 0.46 },
      },
      {
        id: "cathedral-cipher",
        projectId: "MslBR4",
        level: 0.2,
        pan: 0.5,
        params: { clock: 0.76, tune: 12, shape: -0.56, brightness: 0.36, contour: 0.5, pattern: -0.34, motion: 0.28, noise: -0.72, space: 0.5, drive: -0.12 },
        stems: { tone: 0.74, bass: 0.14, percussion: 0.08, texture: 0.12, fx: 0.62 },
      },
    ],
  }),
  makePreset({
    id: "lydian-assembly",
    label: "Lydian Assembly",
    description: "A conservative six-voice stack places Cipher harmony above noir bass, Dorian fragments, tracker dust, distant thunder, and softened breaks.",
    mode: "master",
    globals: { output: 0.44, clock: 0.9, tune: -2, width: 1.28, space: 0.22, drive: -0.12, maxVoices: 6 },
    voices: [
      {
        id: "assembly-cipher",
        projectId: "MslBR4",
        level: 0.28,
        pan: 0.18,
        params: { clock: 0.82, tune: 7, shape: -0.42, brightness: 0.2, contour: 0.42, pattern: -0.16, motion: 0.38, noise: -0.58, space: 0.46, drive: -0.14 },
        stems: { tone: 0.9, bass: 0.3, percussion: 0.18, texture: 0.2, fx: 0.68 },
      },
      {
        id: "assembly-noir",
        projectId: "XdSGz1",
        level: 0.13,
        pan: -0.62,
        params: { clock: 0.76, tune: -12, shape: -0.24, brightness: -0.32, contour: 0.34, pattern: -0.28, motion: 0.16, noise: -0.7, space: 0.12, drive: -0.18 },
        stems: { tone: 0.34, bass: 0.72, percussion: 0.04, texture: 0.04, fx: 0.3 },
      },
      {
        id: "assembly-shift",
        projectId: "ldlfRS",
        level: 0.11,
        pan: 0.62,
        params: { clock: 1.26, tune: 12, shape: 0.16, brightness: 0.42, contour: -0.42, pattern: -0.1, motion: 0.3, noise: -0.76, space: -0.16, drive: -0.14 },
        stems: { tone: 0.5, bass: 0.12, percussion: 0.12, texture: 0.26, fx: 0.2 },
      },
      {
        id: "assembly-boulder",
        projectId: "4tsGD8",
        level: 0.09,
        pan: -0.38,
        params: { clock: 0.64, tune: 5, shape: 0.08, brightness: 0.14, contour: 0.5, pattern: -0.62, motion: 0.22, noise: -0.18, space: 0.38, drive: -0.2 },
        stems: { tone: 0.26, bass: 0.06, percussion: 0.3, texture: 0.34, fx: 0.4 },
      },
      {
        id: "assembly-gravity",
        projectId: "ltKSRc",
        level: 0.09,
        pan: 0.4,
        params: { clock: 0.54, tune: -17, shape: -0.38, brightness: -0.48, contour: 0.7, pattern: -0.7, motion: 0.5, noise: 0.14, space: 0.44, drive: -0.2 },
        stems: { tone: 0.2, bass: 0.34, percussion: 0.16, texture: 0.46, fx: 0.28 },
      },
      {
        id: "assembly-dnb",
        projectId: "4tdSDB",
        level: 0.12,
        pan: 0,
        params: { clock: 1.08, tune: -12, shape: -0.12, brightness: -0.18, contour: -0.24, pattern: 0.22, motion: 0.16, noise: -0.06, space: -0.42, drive: -0.04 },
        stems: { tone: 0.1, bass: 0.48, percussion: 0.52, texture: 0.3, fx: 0.12 },
      },
    ],
  }),
];

// Rack snapshots intentionally contain no Audio arm, playing state, or transport
// position. Applying one can therefore preserve the caller-owned transport.
export const SRTUSS_MASTER_PRESETS = freezeList([
  ...DECOMPOSED_PRESETS,
  ...MASTER_PRESETS,
  ...ADDITIONAL_MASTER_PRESETS,
  ...ORIGINAL_PRESETS,
]);
