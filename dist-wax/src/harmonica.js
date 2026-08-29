const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

export const HARMONICA_LIMITS = Object.freeze({
  hole: Object.freeze([1, 10]),
  chordWidth: Object.freeze([1, 4]),
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
  handCup: Object.freeze([0, 1]),
  growl: Object.freeze([0, 2]),
  tongueBlock: Object.freeze([0, 1]),
  overbend: Object.freeze([0, 1.5]),
  rhythmSwing: Object.freeze([-0.45, 0.45]),
  level: Object.freeze([0, 0.82]),
});

export const HARMONICA_BLOW_MIDI = Object.freeze([60, 64, 67, 72, 76, 79, 84, 88, 91, 96]);
export const HARMONICA_DRAW_MIDI = Object.freeze([62, 67, 71, 74, 77, 81, 83, 86, 89, 93]);
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
  freezeTechnique({ id: "clean", label: "Clean", description: "Unornamented paired-reed tone.", direction: 0, settings: { techniqueAmount: 0, growl: 0, tongueBlock: 0, overbend: 0 }, example: { hole: 4, breathDirection: -1, bend: 0 } }),
  freezeTechnique({ id: "double-stop", label: "Double stop", description: "Persistent Southern-blues voicing across two adjacent chambers.", direction: 0, settings: { techniqueAmount: 1, tongueBlock: 0 }, example: { hole: 4, breathDirection: -1, chordWidth: 2, bend: 0 } }),
  freezeTechnique({ id: "draw-bend", label: "Draw bend", description: "Sustained tract-loaded bend on holes one through six.", direction: -1, holes: HARMONICA_DRAW_BEND_HOLES, settings: { techniqueAmount: 1 }, example: { hole: 4, breathDirection: -1, bend: 1 } }),
  freezeTechnique({ id: "blow-bend", label: "Blow bend", description: "Sustained upper-register blow bend.", direction: 1, holes: HARMONICA_BLOW_BEND_HOLES, settings: { techniqueAmount: 1 }, example: { hole: 8, breathDirection: 1, bend: 1 } }),
  freezeTechnique({ id: "draw-scoop", label: "Draw scoop", description: "A bent draw onset that releases upward into the target pitch.", direction: -1, holes: HARMONICA_DRAW_BEND_HOLES, settings: { techniqueAmount: 1, breathAttackMs: 0 }, example: { hole: 3, breathDirection: -1, bend: 1 } }),
  freezeTechnique({ id: "blow-scoop", label: "Blow scoop", description: "A bent upper-register onset that rises into the target pitch.", direction: 1, holes: HARMONICA_BLOW_BEND_HOLES, settings: { techniqueAmount: 1, breathAttackMs: 0 }, example: { hole: 8, breathDirection: 1, bend: 1 } }),
  freezeTechnique({ id: "dip", label: "Dip", description: "A quick down-and-back pitch gesture at note onset.", direction: 0, settings: { techniqueAmount: 0.82, techniqueRateHz: 5.5 }, example: { hole: 4, breathDirection: -1, bend: 1 } }),
  freezeTechnique({ id: "fall", label: "Fall", description: "A delayed downward bend that remains at the bottom.", direction: 0, settings: { techniqueAmount: 1 }, example: { hole: 3, breathDirection: -1, bend: 1.2 } }),
  freezeTechnique({ id: "shake-warble", label: "Shake / warble", description: "A smooth alternation between neighboring chambers.", direction: 0, settings: { techniqueAmount: 1, techniqueRateHz: 6.2 }, example: { hole: 4, breathDirection: -1, bend: 0 } }),
  freezeTechnique({ id: "tongue-slap", label: "Tongue slap", description: "A wide chordal slap that snaps down to the selected hole.", direction: 0, settings: { techniqueAmount: 1, tongueBlock: 0.75, breathAttackMs: 5 }, example: { hole: 4, breathDirection: 1, chordWidth: 1 } }),
  freezeTechnique({ id: "hand-wah", label: "Hand wah", description: "Moving hand-cup radiation filter.", direction: 0, settings: { techniqueAmount: 1, techniqueRateHz: 3.1, handCup: 0.82 }, example: { hole: 4, breathDirection: -1 } }),
  freezeTechnique({ id: "throat-vibrato", label: "Throat vibrato", description: "Pitch and pressure oscillation from the throat.", direction: 0, settings: { techniqueAmount: 0.72, techniqueRateHz: 5.2 }, example: { hole: 4, breathDirection: -1 } }),
  freezeTechnique({ id: "flutter", label: "Flutter tongue", description: "Fast tongue interruption of the air stream.", direction: 0, settings: { techniqueAmount: 0.78, techniqueRateHz: 18 }, example: { hole: 4, breathDirection: 1 } }),
  freezeTechnique({ id: "growl", label: "Growl", description: "Low vocal modulation coupled into the reed flow.", direction: 0, settings: { techniqueAmount: 0.9, techniqueRateHz: 28, growl: 1.1 }, example: { hole: 3, breathDirection: -1 } }),
  freezeTechnique({ id: "octave-tongue-block", label: "Octave tongue block", description: "Blocks the middle chambers while the outer octave speaks.", direction: 0, holes: [1, 2, 3, 4, 5, 6, 7], settings: { techniqueAmount: 1, tongueBlock: 1 }, example: { hole: 1, breathDirection: 1, chordWidth: 1 } }),
  freezeTechnique({ id: "overblow", label: "Overblow", description: "Chokes the blow reed on holes one through six and transfers primacy to the draw reed.", direction: 1, holes: HARMONICA_OVERBLOW_HOLES, settings: { techniqueAmount: 1, overbend: 1, reedGap: 0.32 }, example: { hole: 4, breathDirection: 1, bend: 0 } }),
  freezeTechnique({ id: "overdraw", label: "Overdraw", description: "Chokes the draw reed on holes seven through ten and transfers primacy to the blow reed.", direction: -1, holes: HARMONICA_OVERDRAW_HOLES, settings: { techniqueAmount: 1, overbend: 1, reedGap: 0.28 }, example: { hole: 7, breathDirection: -1, bend: 0 } }),
  freezeTechnique({ id: "train-chug", label: "Train chug", description: "Alternating chordal draw and blow attacks in a train rhythm.", direction: 0, settings: { techniqueAmount: 1, breathAttackMs: 10, breathReleaseMs: 34 }, example: { hole: 2, chordWidth: 3, breathDirection: -1, bluesRhythmId: "train", autoBreath: true } }),
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
]);

export const HARMONICA_DEFAULTS = Object.freeze({
  presetId: "c-richter",
  hole: 4,
  chordWidth: 1,
  // Hole four defaults to draw so the primary gesture exposes its legal bend.
  breathDirection: -1,
  breathPressure: 0.82,
  breathRateBpm: 36,
  breathBalance: 0.5,
  breathFlow: 0,
  autoBreath: false,
  bend: 0,
  reedGap: 0.72,
  reedStiffness: 1,
  airLeak: 0.04,
  embouchure: 0.36,
  tonguePosition: 0.42,
  tongueHeight: 0.38,
  throatOpening: 0.5,
  vocalTractCoupling: 0.88,
  brightness: 0.9,
  vibratoRateHz: 5.2,
  vibratoDepth: 0.08,
  tremoloRateHz: 5.2,
  tremoloDepth: 0.05,
  stereoSpread: 0.24,
  bluesTechniqueId: "clean",
  bluesRhythmId: "free",
  techniqueAmount: 1,
  techniqueRateHz: 5.5,
  breathAttackMs: 18,
  breathReleaseMs: 90,
  handCup: 0.15,
  growl: 0,
  tongueBlock: 0,
  overbend: 0,
  rhythmSwing: 0,
  level: 0.5,
});

export const HARMONICA_PRESETS = Object.freeze([
  Object.freeze({
    id: "c-richter",
    label: "C Richter 10-hole",
    keyLabel: "C",
    family: "phosphor-bronze reeds",
    description: "Standard C Richter tuning with bright bronze reeds and the familiar blow/draw chord layout.",
    transpose: 0,
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
    label: "Low C",
    keyLabel: "Low C",
    family: "weighted phosphor bronze",
    description: "An octave-lower plate with heavier tongues, slower attacks, and broad low chords.",
    transpose: -12,
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
    label: "G Richter",
    keyLabel: "G",
    family: "stainless-steel reeds",
    description: "A lower G instrument with firm stainless tongues, clear attacks, and long high reeds.",
    transpose: -5,
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
    label: "A Richter",
    keyLabel: "A",
    family: "brass reeds",
    description: "Compact A tuning with quick brass reeds and a warm, slightly lossy midrange.",
    transpose: -3,
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

export function harmonicaTechnique(id) {
  return HARMONICA_TECHNIQUES.find((technique) => technique.id === id)
    ?? HARMONICA_TECHNIQUES[0];
}

export function harmonicaBluesRhythm(id) {
  return HARMONICA_BLUES_RHYTHMS.find((rhythm) => rhythm.id === id)
    ?? HARMONICA_BLUES_RHYTHMS[0];
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
  result.bluesTechniqueId = harmonicaTechnique(
    state.bluesTechniqueId ?? base.bluesTechniqueId,
  ).id;
  result.bluesRhythmId = harmonicaBluesRhythm(
    state.bluesRhythmId ?? base.bluesRhythmId,
  ).id;
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
    bluesRhythmId: HARMONICA_DEFAULTS.bluesRhythmId,
    techniqueAmount: HARMONICA_DEFAULTS.techniqueAmount,
    techniqueRateHz: HARMONICA_DEFAULTS.techniqueRateHz,
    breathAttackMs: HARMONICA_DEFAULTS.breathAttackMs,
    breathReleaseMs: HARMONICA_DEFAULTS.breathReleaseMs,
    handCup: HARMONICA_DEFAULTS.handCup,
    growl: HARMONICA_DEFAULTS.growl,
    tongueBlock: HARMONICA_DEFAULTS.tongueBlock,
    overbend: HARMONICA_DEFAULTS.overbend,
    rhythmSwing: HARMONICA_DEFAULTS.rhythmSwing,
    autoBreath: false,
    chordWidth: 1,
    bend: 0,
    ...technique.settings,
    ...technique.example,
    bluesTechniqueId: technique.id,
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
  const hole = Math.round(clamp(requestedHole, 1, 10));
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
  const preset = harmonicaPreset(state.presetId);
  const hole = Math.round(clamp(requestedHole, 1, 10));
  const direction = finiteOr(requestedDirection, state.breathDirection) < 0 ? -1 : 1;
  const table = direction < 0 ? HARMONICA_OVERDRAW_MIDI : HARMONICA_OVERBLOW_MIDI;
  const baseMidi = table[hole];
  const legal = Number.isFinite(baseMidi);
  const midi = legal ? baseMidi + preset.transpose : null;
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
  const index = Math.round(clamp(hole, 1, 10)) - 1;
  return direction < 0 ? HARMONICA_DRAW_BENDS[index] : HARMONICA_BLOW_BENDS[index];
}

export function harmonicaReedPair(source = HARMONICA_DEFAULTS, requestedHole = source?.hole) {
  const state = sanitizeHarmonicaState(source);
  const preset = harmonicaPreset(state.presetId);
  const hole = Math.round(clamp(requestedHole, 1, 10));
  const index = hole - 1;
  const blowMidi = HARMONICA_BLOW_MIDI[index] + preset.transpose;
  const drawMidi = HARMONICA_DRAW_MIDI[index] + preset.transpose;
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
  const first = clamp(
    state.hole - Math.floor((width - 1) / 2),
    1,
    11 - width,
  );
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
  const technique = HARMONICA_TECHNIQUES[
    Math.min(HARMONICA_TECHNIQUES.length - 1, Math.floor(unit() * HARMONICA_TECHNIQUES.length))
  ];
  const rhythm = HARMONICA_BLUES_RHYTHMS[
    Math.min(HARMONICA_BLUES_RHYTHMS.length - 1, Math.floor(unit() * HARMONICA_BLUES_RHYTHMS.length))
  ];
  const patched = applyHarmonicaTechnique(state, technique.id);
  const isOverbendTechnique = technique.id === "overblow" || technique.id === "overdraw";
  const isBendTechnique = BEND_TECHNIQUES_FOR_RANDOMIZER.has(technique.id);
  return sanitizeHarmonicaState({
    ...patched,
    breathPressure: isOverbendTechnique
      ? 1.6 + unit() * 1.3
      : (technique.id === "clean" ? 0.15 + unit() * 2.75 : 0.45 + unit() * 2.45),
    breathRateBpm: 2 + Math.pow(unit(), 2.1) * 1_150,
    breathBalance: 0.04 + unit() * 0.92,
    bend: BEND_TECHNIQUES_FOR_RANDOMIZER.has(technique.id)
      ? 0.25 + unit() * 1.25
      : unit() * 1.5,
    reedGap: 0.08 + unit() * 2.3,
    reedStiffness: 0.25 + unit() * 1.7,
    airLeak: unit() * 0.72,
    embouchure: -1.5 + unit() * 4.2,
    tonguePosition: -1.5 + unit() * 4.2,
    tongueHeight: -1.5 + unit() * 4.2,
    throatOpening: -1.4 + unit() * 4.1,
    vocalTractCoupling: isBendTechnique ? 0.6 + unit() * 1.4 : unit() * 2,
    brightness: unit() * 2,
    vibratoRateHz: unit() * 15,
    vibratoDepth: unit() * 1.5,
    tremoloRateHz: 0.2 + unit() * 25,
    tremoloDepth: unit() * 0.9,
    stereoSpread: unit(),
    bluesTechniqueId: technique.id,
    bluesRhythmId: technique.id === "train-chug" ? "train" : rhythm.id,
    techniqueAmount: 0.35 + unit() * 1.65,
    techniqueRateHz: 0.1 + unit() * 29.9,
    breathAttackMs: unit() * 500,
    breathReleaseMs: unit() * 1_000,
    handCup: technique.id === "hand-wah" ? 0.35 + unit() * 0.65 : unit(),
    growl: technique.id === "growl" ? 0.4 + unit() * 1.6 : unit() * 2,
    tongueBlock: technique.id === "octave-tongue-block" ? 0.3 + unit() * 0.7 : unit(),
    overbend: isOverbendTechnique
      ? 1.05 + unit() * 0.45
      : unit() * 1.5,
    rhythmSwing: -0.45 + unit() * 0.9,
    breathFlow: 0,
  }, state);
}
