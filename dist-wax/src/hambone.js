const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

const freezeSettings = (settings) => Object.freeze({ ...settings });

export const HAMBONE_STEP_COUNT = 16;
export const HAMBONE_VELOCITIES = Object.freeze([0, 0.42, 0.72, 1]);

export const HAMBONE_LIMITS = Object.freeze({
  lungPressure: Object.freeze([0, 1.6]),
  // The central 0..1 zone is roughly human. The outer ranges deliberately
  // allow retracted/projected lips, hollow/ballooned cheeks, and impossible
  // tongue and tract poses without passing unbounded values to the worklet.
  lipTension: Object.freeze([-0.35, 1.65]),
  lipRounding: Object.freeze([-0.45, 1.8]),
  cheekVolume: Object.freeze([-0.4, 2]),
  cheekTension: Object.freeze([-0.35, 1.7]),
  tonguePosition: Object.freeze([-0.65, 1.65]),
  tongueCurl: Object.freeze([-0.7, 1.8]),
  mouthOpening: Object.freeze([0.01, 1.85]),
  tractLengthM: Object.freeze([0.035, 0.52]),
  nasalMix: Object.freeze([0, 1]),
  dooPitch: Object.freeze([-24, 24]),
  earSpread: Object.freeze([0, 1]),
  eyeDivergence: Object.freeze([0, 1]),
  silliness: Object.freeze([0, 1]),
  decay: Object.freeze([0.35, 1.8]),
  tempo: Object.freeze([48, 520]),
  swing: Object.freeze([0, 0.46]),
  humanize: Object.freeze([0, 0.45]),
  level: Object.freeze([0, 0.82]),
});

export const HAMBONE_DEFAULTS = Object.freeze({
  presetId: "rubber-face",
  patternId: "mouth-party",
  lungPressure: 0.82,
  lipTension: 0.46,
  lipRounding: 0.38,
  cheekVolume: 0.64,
  cheekTension: 0.42,
  tonguePosition: 0.58,
  tongueCurl: 0.4,
  mouthOpening: 0.48,
  tractLengthM: 0.165,
  nasalMix: 0.14,
  dooPitch: 0,
  earSpread: 0.18,
  eyeDivergence: 0.08,
  silliness: 0.56,
  decay: 0.92,
  tempo: 118,
  swing: 0.1,
  humanize: 0.06,
  level: 0.5,
});

// Hambone uses one continuous oral tube. The section count and tongue
// landmarks deliberately match the 44-section Pink Trombone convention used
// by Throatazoid, while the control mapping remains Hambone-specific.
export const HAMBONE_TRACT_SECTION_COUNT = 44;
export const HAMBONE_TRACT_DIAMETER_FLOOR_CM = 0.001;
export const HAMBONE_TRACT_LANDMARKS = Object.freeze({
  glottis: 0,
  tongueBodyStart: 10,
  tongueControlStart: 12.9,
  // Canonical Pink/Throatazoid K place (full-tract section 22).
  velar: 22,
  tongueControlEnd: 30.4,
  postalveolar: 31,
  alveolar: 35,
  lipShapingStart: 37,
  lips: HAMBONE_TRACT_SECTION_COUNT - 1,
});

export const HAMBONE_GESTURE_CHANNELS = Object.freeze([
  "poseMix",
  "pressure",
  "lipClosure",
  "lipImpulse",
  "tongueContact",
  "constrictionPosition",
  "constriction",
  "secondaryConstrictionPosition",
  "secondaryConstriction",
  "velum",
  "turbulence",
  "suction",
  "cheekImpulse",
  "jawImpulse",
  "voicing",
  "aspiration",
  "lipFlutter",
  "tongueTrill",
]);

export const HAMBONE_SOUNDS = Object.freeze([
  Object.freeze({
    id: "bop",
    label: "BOP",
    subtitle: "bilabial kick",
    key: "1",
    family: "plosive",
    color: "#ff6f79",
    description: "Pressed lips store breath, then release a compact bilabial kick with just a trace of voice.",
  }),
  Object.freeze({
    id: "boop",
    label: "BOOP",
    subtitle: "rounded lip kick",
    key: "2",
    family: "plosive",
    color: "#ffb15d",
    description: "Projected lips turn the kick into a rounder, voiced beatbox bass with a brief cavity ring.",
  }),
  Object.freeze({
    id: "pop",
    label: "POP",
    subtitle: "inward cheek pop",
    key: "3",
    family: "cavity",
    color: "#f7dc6a",
    description: "An inward cheek pull collapses a sealed pocket of air into a dry, human mouth pop.",
  }),
  Object.freeze({
    id: "tlik",
    label: "TLIK",
    subtitle: "palatal tongue click",
    key: "4",
    family: "tongue",
    color: "#7ce7bd",
    description: "Tongue suction releases from the palate and the tip follows with a tight two-part click.",
  }),
  Object.freeze({
    id: "shh",
    label: "PHSHSHK",
    subtitle: "puff · scrape · cut",
    key: "5",
    family: "hybrid",
    color: "#65dfe8",
    description: "A lip-pressure PH puff flashes across a short SH groove and stops on a crisp rear-tongue K cut.",
  }),
  Object.freeze({
    id: "shack",
    label: "SHACK!",
    subtitle: "SH · open A · K",
    key: "6",
    family: "hybrid",
    color: "#70a9ff",
    description: "A brief postalveolar SH opens into a wide A-shaped jaw, then a rear tongue seal releases as a hard K.",
  }),
  Object.freeze({
    id: "slap",
    label: "SLAP",
    subtitle: "face-pat snap",
    key: "7",
    family: "membrane",
    color: "#bb8cff",
    description: "A palm pat excites skin, cheek, and mouth-cavity modes as one quick face-percussion snap.",
  }),
  Object.freeze({
    id: "pff",
    label: "PFF",
    subtitle: "breathy lip flutter",
    key: "8",
    family: "flutter",
    color: "#f07fd0",
    description: "A short breath pulse repeatedly parts loose lips into a beatbox PFF rather than a sustained buzz.",
  }),
  Object.freeze({
    id: "kick",
    label: "KICK",
    subtitle: "low body thump",
    key: "9",
    family: "body",
    color: "#ff526b",
    description: "A low-pressure body impulse folds the cheek wall into the mouth cavity for a resonant beatbox kick.",
  }),
  Object.freeze({
    id: "smack",
    label: "SMACK",
    subtitle: "other-hand face slap",
    key: "0",
    family: "membrane",
    color: "#ff9257",
    description: "The opposite hand catches the other cheek, reversing the skin impulse and throwing its resonance across the face.",
  }),
  Object.freeze({
    id: "hee",
    label: "HEE",
    subtitle: "ingressive voice",
    key: "q",
    family: "vocal",
    color: "#f4d35e",
    description: "Air is pulled inward across briefly vibrating vocal folds through a tight, bright HEE-shaped tract.",
  }),
  Object.freeze({
    id: "haw",
    label: "HAW",
    subtitle: "egressive voice",
    key: "w",
    family: "vocal",
    color: "#79e5ae",
    description: "The folds reverse to outward breath while the jaw falls into a short, open HAW vowel.",
  }),
  Object.freeze({
    id: "doo",
    label: "DOO",
    subtitle: "pitched round voice",
    key: "e",
    family: "vocal",
    color: "#58dbe8",
    description: "A compact voiced pulse travels through a rounded DOO tube, transposed by the dedicated DOO pitch control.",
  }),
  Object.freeze({
    id: "mwah",
    label: "MWAH",
    subtitle: "suction kiss",
    key: "r",
    family: "cavity",
    color: "#629dff",
    description: "Projected lips seal around a falling-pressure pocket, then spring open into a wet suction kiss.",
  }),
  Object.freeze({
    id: "drr",
    label: "DRR",
    subtitle: "tongue-tip roll",
    key: "t",
    family: "tongue",
    color: "#ae7df2",
    description: "Oral pressure repeatedly parts a compliant tongue tip for an organic, pressure-driven rolled DRR.",
  }),
  Object.freeze({
    id: "burp",
    label: "BURP",
    subtitle: "irregular low fold",
    key: "y",
    family: "vocal",
    color: "#e978bd",
    description: "An uneven low gas pulse rattles relaxed vocal folds and the full tract into a short human burp.",
  }),
]);

const soundById = new Map(HAMBONE_SOUNDS.map((sound) => [sound.id, sound]));

export function hamboneSound(id) {
  return soundById.get(id) ?? HAMBONE_SOUNDS[0];
}

export const HAMBONE_PRESETS = Object.freeze([
  Object.freeze({
    id: "rubber-face",
    label: "Rubber face",
    description: "A recognizably human beatbox mouth with punchy closures, elastic cheeks, and compact releases.",
    settings: freezeSettings({
      lungPressure: 0.82, lipTension: 0.46, lipRounding: 0.38,
      cheekVolume: 0.64, cheekTension: 0.42, tonguePosition: 0.58,
      tongueCurl: 0.4, mouthOpening: 0.48, tractLengthM: 0.165,
      nasalMix: 0.14, silliness: 0.56, decay: 0.92,
    }),
  }),
  Object.freeze({
    id: "chipmunk-box",
    label: "Chipmunk box",
    description: "A beyond-human pinched tract and projected lips push clicks and kicks into a bright toy register.",
    settings: freezeSettings({
      lungPressure: 0.74, lipTension: 1.28, lipRounding: 1.08,
      cheekVolume: -0.18, cheekTension: 1.34, tonguePosition: 1.3,
      tongueCurl: 1.24, mouthOpening: 0.24, tractLengthM: 0.05,
      nasalMix: 0.22, silliness: 0.82, decay: 0.62,
    }),
  }),
  Object.freeze({
    id: "cavern-gob",
    label: "Cavern gob",
    description: "A half-metre tract, balloon cheeks, and tube-like lips turn each consonant into a low hollow whomp.",
    settings: freezeSettings({
      lungPressure: 1.08, lipTension: -0.08, lipRounding: 1.52,
      cheekVolume: 1.82, cheekTension: -0.12, tonguePosition: -0.38,
      tongueCurl: 0.08, mouthOpening: 1.24, tractLengthM: 0.46,
      nasalMix: 0.08, silliness: 0.68, decay: 1.34,
    }),
  }),
  Object.freeze({
    id: "tin-grin",
    label: "Tin grin",
    description: "Impossible surface tension and a pulled-back grin make tongue and face contacts sharp and metallic.",
    settings: freezeSettings({
      lungPressure: 0.9, lipTension: 1.48, lipRounding: -0.32,
      cheekVolume: 0.38, cheekTension: 1.52, tonguePosition: 1.08,
      tongueCurl: 1.46, mouthOpening: 0.52, tractLengthM: 0.1,
      nasalMix: 0.06, silliness: 0.42, decay: 0.5,
    }),
  }),
  Object.freeze({
    id: "whisper-gremlin",
    label: "PHSHK gremlin",
    description: "Compressed lips and an over-curled tongue favor fast PHSHSHK sprays, puffs, and dry clicks.",
    settings: freezeSettings({
      lungPressure: 1.12, lipTension: 0.72, lipRounding: 0.86,
      cheekVolume: 1.08, cheekTension: 0.9, tonguePosition: 0.96,
      tongueCurl: 1.54, mouthOpening: 0.14, tractLengthM: 0.19,
      nasalMix: 0.18, silliness: 0.62, decay: 0.68,
    }),
  }),
  Object.freeze({
    id: "vowel-engine",
    label: "Vowel engine",
    description: "A supple human-length tract with a mobile tongue and rounded outlet keeps HEE, HAW, and pitched DOO articulate.",
    settings: freezeSettings({
      lungPressure: 0.7, lipTension: 0.34, lipRounding: 0.74,
      cheekVolume: 0.52, cheekTension: 0.3, tonguePosition: 0.76,
      tongueCurl: 0.28, mouthOpening: 0.46, tractLengthM: 0.172,
      nasalMix: 0.1, dooPitch: 5, earSpread: 0.34,
      eyeDivergence: 0.16, silliness: 0.3, decay: 1.08,
    }),
  }),
  Object.freeze({
    id: "inside-out",
    label: "Inside-out singer",
    description: "A short bright tube and forward tongue emphasize the reversal between ingressive HEE and egressive HAW.",
    settings: freezeSettings({
      lungPressure: 0.92, lipTension: 0.78, lipRounding: 0.18,
      cheekVolume: 0.28, cheekTension: 0.68, tonguePosition: 1.28,
      tongueCurl: 0.74, mouthOpening: 0.3, tractLengthM: 0.115,
      nasalMix: 0.24, dooPitch: 12, earSpread: 0.24,
      eyeDivergence: 0.1, silliness: 0.72, decay: 0.74,
    }),
  }),
  Object.freeze({
    id: "slap-canyon",
    label: "Slap canyon",
    description: "Loose, oversized cheeks and a deep tract exaggerate alternating hand contacts, kick thumps, and their stereo tail.",
    settings: freezeSettings({
      lungPressure: 0.58, lipTension: -0.2, lipRounding: 0.26,
      cheekVolume: 1.72, cheekTension: -0.2, tonguePosition: -0.14,
      tongueCurl: 0.02, mouthOpening: 0.72, tractLengthM: 0.34,
      nasalMix: 0.08, dooPitch: -9, earSpread: 0.86,
      eyeDivergence: 0.28, silliness: 0.64, decay: 1.48,
    }),
  }),
  Object.freeze({
    id: "feral-baron",
    label: "Feral baron",
    description: "Relaxed folds, a long throat, and an unruly tongue favor low burps, suction kisses, and unstable DRR rolls.",
    settings: freezeSettings({
      lungPressure: 1.18, lipTension: -0.28, lipRounding: 1.1,
      cheekVolume: 1.26, cheekTension: 0.02, tonguePosition: 0.16,
      tongueCurl: 1.34, mouthOpening: 0.82, tractLengthM: 0.3,
      nasalMix: 0.32, dooPitch: -17, earSpread: 0.58,
      eyeDivergence: 0.7, silliness: 0.96, decay: 1.62,
    }),
  }),
]);

export function hambonePreset(id) {
  return HAMBONE_PRESETS.find((preset) => preset.id === id) ?? HAMBONE_PRESETS[0];
}

const velocity = (value) => clamp(value, 0, 1);

// Hambone is one physical mouth. A column therefore represents one pose and
// one gesture, never a chord. Stronger hits win; equal hits follow the stable
// HAMBONE_SOUNDS order so imported or hostile patterns resolve predictably.
const exclusivePatternRows = (rows, freezeRows = false) => {
  const result = Object.fromEntries(HAMBONE_SOUNDS.map(({ id }) => [
    id,
    Array(HAMBONE_STEP_COUNT).fill(0),
  ]));
  for (let step = 0; step < HAMBONE_STEP_COUNT; step += 1) {
    let winnerId = "";
    let winnerVelocity = 0;
    for (const { id } of HAMBONE_SOUNDS) {
      const amount = velocity(rows?.[id]?.[step] ?? 0);
      if (amount > winnerVelocity) {
        winnerId = id;
        winnerVelocity = amount;
      }
    }
    if (winnerId) result[winnerId][step] = winnerVelocity;
  }
  if (!freezeRows) return result;
  for (const values of Object.values(result)) Object.freeze(values);
  return Object.freeze(result);
};

const freezePatternRows = (rows) => exclusivePatternRows(rows, true);

const row = (...active) => {
  const result = Array(HAMBONE_STEP_COUNT).fill(0);
  for (const [step, amount = 1] of active) result[step] = amount;
  return result;
};

export const HAMBONE_PATTERNS = Object.freeze([
  Object.freeze({
    id: "mouth-party",
    label: "Mouth party",
    rows: freezePatternRows({
      bop: row([0, 1], [8, 1], [11, 0.56], [14, 0.8]),
      boop: row([6, 0.72], [13, 0.84]),
      pop: row([3, 0.64], [10, 0.62]),
      tlik: row([2, 0.44], [7, 0.52]),
      shh: row([5, 0.45]),
      shack: row([15, 1]),
      slap: row([4, 0.68], [12, 0.82]),
      pff: row([9, 0.58]),
    }),
  }),
  Object.freeze({
    id: "boots-cats",
    label: "Bops & cats",
    rows: freezePatternRows({
      bop: row([0, 1], [8, 0.94]),
      boop: row([6, 0.62], [14, 0.7]),
      tlik: row([4, 0.72], [12, 0.76]),
      shh: row([2, 0.35], [10, 0.38]),
      shack: row([15, 0.86]),
      pff: row([7, 0.45]),
    }),
  }),
  Object.freeze({
    id: "cheeky-break",
    label: "Cheeky break",
    rows: freezePatternRows({
      bop: row([0, 0.9], [7, 0.54], [10, 0.78]),
      boop: row([3, 0.64], [13, 0.8]),
      pop: row([2, 0.7], [6, 0.48], [11, 0.82], [15, 0.6]),
      tlik: row([1, 0.4], [5, 0.4], [9, 0.46], [14, 0.62]),
      slap: row([4, 0.94], [12, 1]),
      pff: row([8, 0.52]),
    }),
  }),
  Object.freeze({
    id: "hush-rush",
    label: "PHSHK rush",
    rows: freezePatternRows({
      bop: row([0, 0.72], [8, 0.82]),
      pop: row([7, 0.5], [15, 0.62]),
      tlik: row([2, 0.42], [4, 0.48], [10, 0.46], [12, 0.56]),
      shh: row([1, 0.62], [9, 0.7]),
      shack: row([6, 0.9], [14, 1]),
      pff: row([5, 0.5], [13, 0.54]),
    }),
  }),
  Object.freeze({
    id: "hee-haw-loop",
    label: "HEE HAW loop",
    rows: freezePatternRows({
      kick: row([0, 1], [8, 0.92]),
      hee: row([2, 0.78], [10, 0.84]),
      haw: row([4, 0.9], [12, 1]),
      doo: row([6, 0.62], [14, 0.74]),
      smack: row([7, 0.54], [15, 0.72]),
    }),
  }),
  Object.freeze({
    id: "two-hands",
    label: "Two hands",
    rows: freezePatternRows({
      kick: row([0, 1], [6, 0.72], [8, 0.94], [14, 0.76]),
      slap: row([2, 0.82], [10, 0.92]),
      smack: row([4, 0.88], [12, 1]),
      pop: row([3, 0.46], [11, 0.56]),
      mwah: row([7, 0.58], [15, 0.74]),
    }),
  }),
  Object.freeze({
    id: "doo-wop",
    label: "Pitchy doo-wop",
    rows: freezePatternRows({
      kick: row([0, 0.86], [8, 0.92]),
      doo: row([1, 0.58], [3, 0.72], [5, 0.5], [7, 0.86], [9, 0.64], [11, 0.78], [15, 1]),
      hee: row([4, 0.52]),
      haw: row([12, 0.68]),
      mwah: row([14, 0.62]),
    }),
  }),
  Object.freeze({
    id: "rolled-and-rude",
    label: "Rolled & rude",
    rows: freezePatternRows({
      kick: row([0, 1], [5, 0.72], [8, 0.9]),
      drr: row([2, 0.62], [6, 0.8], [10, 0.7], [14, 1]),
      burp: row([4, 0.86], [12, 1]),
      tlik: row([3, 0.42], [11, 0.52]),
      smack: row([7, 0.64], [15, 0.82]),
    }),
  }),
  Object.freeze({
    id: "sixteen-faces",
    label: "Sixteen faces",
    rows: freezePatternRows({
      bop: row([0, 0.88]), boop: row([1, 0.68]), pop: row([2, 0.72]),
      tlik: row([3, 0.64]), shh: row([4, 0.58]), shack: row([5, 0.78]),
      slap: row([6, 0.82]), pff: row([7, 0.66]), kick: row([8, 1]),
      smack: row([9, 0.86]), hee: row([10, 0.7]), haw: row([11, 0.76]),
      doo: row([12, 0.72]), mwah: row([13, 0.68]), drr: row([14, 0.82]),
      burp: row([15, 1]),
    }),
  }),
]);

export function hambonePattern(id) {
  return HAMBONE_PATTERNS.find((pattern) => pattern.id === id) ?? HAMBONE_PATTERNS[0];
}

export function clonePattern(source = hambonePattern(HAMBONE_DEFAULTS.patternId).rows) {
  const rows = source?.rows ?? source;
  return exclusivePatternRows(rows);
}

export function sanitizePattern(source) {
  return clonePattern(source);
}

export function sanitizeHamboneState(source = {}, fallback = HAMBONE_DEFAULTS) {
  const state = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : HAMBONE_DEFAULTS;
  const result = {};
  for (const [key, limits] of Object.entries(HAMBONE_LIMITS)) {
    result[key] = clamp(
      finiteOr(state[key], finiteOr(base[key], HAMBONE_DEFAULTS[key])),
      limits[0],
      limits[1],
    );
  }
  result.presetId = hambonePreset(state.presetId ?? base.presetId).id;
  result.patternId = hambonePattern(state.patternId ?? base.patternId).id;
  return result;
}

export function hamboneState(presetId = HAMBONE_DEFAULTS.presetId, overrides = {}) {
  const preset = hambonePreset(presetId);
  return sanitizeHamboneState({
    ...HAMBONE_DEFAULTS,
    ...preset.settings,
    ...overrides,
    presetId: preset.id,
  });
}

export function cycleStepVelocity(value) {
  const current = velocity(value);
  const index = HAMBONE_VELOCITIES.findIndex((candidate) => Math.abs(candidate - current) < 0.02);
  if (index >= 0) return HAMBONE_VELOCITIES[(index + 1) % HAMBONE_VELOCITIES.length];
  return HAMBONE_VELOCITIES.find((candidate) => candidate > current) ?? 0;
}

export function sequenceStepIntervalSeconds(tempo, swing = 0, step = 0) {
  const bpm = clamp(tempo, HAMBONE_LIMITS.tempo[0], HAMBONE_LIMITS.tempo[1]);
  const amount = clamp(swing, HAMBONE_LIMITS.swing[0], HAMBONE_LIMITS.swing[1]);
  const straightSixteenth = 15 / bpm;
  return straightSixteenth * (Math.trunc(step) % 2 === 0 ? 1 + amount : 1 - amount);
}

export function patternEventsAtStep(pattern, step) {
  const safe = sanitizePattern(pattern);
  const index = ((Math.trunc(finiteOr(step, 0)) % HAMBONE_STEP_COUNT) + HAMBONE_STEP_COUNT)
    % HAMBONE_STEP_COUNT;
  const event = HAMBONE_SOUNDS.map(({ id }) => {
    const amount = safe[id][index];
    return amount > 0 ? Object.freeze({ soundId: id, velocity: amount, step: index }) : null;
  }).find(Boolean);
  return Object.freeze(event ? [event] : []);
}

export function randomizePattern(random = Math.random, density = 0.22) {
  const chance = clamp(density, 0.04, 0.68);
  const result = clonePattern({});
  const weightedSoundIds = Object.freeze([
    "bop", "bop", "boop", "pop", "tlik", "shh", "shack", "slap", "pff",
    "kick", "kick", "smack", "hee", "haw", "doo", "mwah", "drr", "burp",
  ]);
  for (let step = 0; step < HAMBONE_STEP_COUNT; step += 1) {
    const downbeatBias = step % 4 === 0 ? 0.15 : 0;
    if (clamp(finiteOr(random(), 0.5)) >= Math.min(0.94, chance * 2.2 + downbeatBias)) continue;
    const soundDraw = clamp(finiteOr(random(), 0.5), 0, 1 - Number.EPSILON);
    const id = weightedSoundIds[Math.floor(soundDraw * weightedSoundIds.length)];
    const draw = clamp(finiteOr(random(), 0.5));
    result[id][step] = draw < 0.34 ? 0.42 : draw < 0.72 ? 0.72 : 1;
  }
  if (!patternEventsAtStep(result, 0).length) result.bop[0] = 1;
  return result;
}

export function randomizeHamboneState(source = HAMBONE_DEFAULTS, random = Math.random) {
  const state = sanitizeHamboneState(source);
  const pick = (key) => {
    const [minimum, maximum] = HAMBONE_LIMITS[key];
    const draw = clamp(finiteOr(random(), 0.5));
    if (draw === 0) return minimum;
    if (draw === 1) return maximum;
    return minimum + draw * (maximum - minimum);
  };
  return sanitizeHamboneState({
    ...state,
    lungPressure: pick("lungPressure"),
    lipTension: pick("lipTension"),
    lipRounding: pick("lipRounding"),
    cheekVolume: pick("cheekVolume"),
    cheekTension: pick("cheekTension"),
    tonguePosition: pick("tonguePosition"),
    tongueCurl: pick("tongueCurl"),
    mouthOpening: pick("mouthOpening"),
    tractLengthM: pick("tractLengthM"),
    nasalMix: pick("nasalMix"),
    dooPitch: pick("dooPitch"),
    earSpread: pick("earSpread"),
    eyeDivergence: pick("eyeDivergence"),
    silliness: pick("silliness"),
    decay: pick("decay"),
  }, state);
}

export function hamboneGeometry(source = HAMBONE_DEFAULTS) {
  const state = sanitizeHamboneState(source);
  const opening = Math.max(0, state.mouthOpening);
  const projection = state.lipRounding;
  const apertureCm2 = clamp(
    0.06
      + Math.pow(opening, 1.25) * 4.8
      - Math.max(0, projection) * 1.25
      + Math.max(0, -projection) * 1.5,
    0.008,
    18,
  );
  const cheekVolumeMl = clamp(
    28
      + state.cheekVolume * 132
      + Math.max(0, state.cheekVolume - 1) * 190,
    8,
    480,
  );
  const neckLengthM = clamp(
    0.0055
      + Math.max(0, projection) * 0.034
      + Math.max(0, projection - 1) * 0.032
      + Math.max(0, 1 - opening) * 0.01,
    0.0025,
    0.12,
  );
  const apertureM2 = apertureCm2 * 1e-4;
  const volumeM3 = cheekVolumeMl * 1e-6;
  const cavityFrequencyHz = clamp(
    343 / (2 * Math.PI) * Math.sqrt(apertureM2 / Math.max(1e-9, volumeM3 * neckLengthM)),
    22,
    4_200,
  );
  return Object.freeze({
    apertureCm2,
    cheekVolumeMl,
    neckLengthM,
    cavityFrequencyHz,
  });
}

// DOO pitch belongs to the folds, while ear spread and eye divergence follow
// the tract as global effects. They deliberately do not reshape oral sections.
const HAMBONE_ANATOMY_KEYS = Object.freeze([
  "lipTension",
  "lipRounding",
  "cheekVolume",
  "cheekTension",
  "tonguePosition",
  "tongueCurl",
  "mouthOpening",
  "tractLengthM",
  "nasalMix",
]);

const oralBell = (index, center, radius) => {
  const safeRadius = Math.max(0.0001, finiteOr(radius, 1));
  const distance = Math.abs(index - finiteOr(center, 0));
  if (distance >= safeRadius) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * distance / safeRadius));
};

const articulatedHamboneState = (source, articulation = {}) => {
  const state = sanitizeHamboneState(source);
  const overrides = Object.fromEntries(HAMBONE_ANATOMY_KEYS.flatMap((key) => (
    Number.isFinite(Number(articulation?.[key])) ? [[key, Number(articulation[key])]] : []
  )));
  return sanitizeHamboneState({ ...state, ...overrides }, state);
};

const tongueBodyIndexForState = (state) => clamp(
  HAMBONE_TRACT_LANDMARKS.tongueControlStart
    + state.tonguePosition * (
      HAMBONE_TRACT_LANDMARKS.tongueControlEnd
      - HAMBONE_TRACT_LANDMARKS.tongueControlStart
    ),
  2,
  HAMBONE_TRACT_SECTION_COUNT - 2,
);

const tongueBodyDiameterForState = (state) => clamp(
  3.5
    - state.tongueCurl * 1.05
    - Math.max(0, state.tonguePosition - 1) * 0.18
    + Math.max(0, -state.tonguePosition) * 0.12,
  0.08,
  5.5,
);

const shapeOralDiameter = (
  diameters,
  center,
  radius,
  desiredDiameter,
  amount = 1,
) => {
  const blendAmount = clamp(amount);
  if (blendAmount <= 0) return;
  const desired = clamp(
    desiredDiameter,
    HAMBONE_TRACT_DIAMETER_FLOOR_CM,
    6.5,
  );
  for (let index = 0; index < diameters.length; index += 1) {
    const blend = oralBell(index, center, radius) * blendAmount;
    diameters[index] = clamp(
      diameters[index] + (desired - diameters[index]) * blend,
      HAMBONE_TRACT_DIAMETER_FLOOR_CM,
      6.5,
    );
  }
};

// Contacts and consonant constrictions can remove aperture, but they must
// never reopen a narrower piece of anatomy established by another contact.
const constrictOralDiameter = (
  diameters,
  center,
  radius,
  desiredDiameter,
  amount = 1,
) => {
  const blendAmount = clamp(amount);
  if (blendAmount <= 0) return;
  const desired = clamp(
    desiredDiameter,
    HAMBONE_TRACT_DIAMETER_FLOOR_CM,
    6.5,
  );
  for (let index = 0; index < diameters.length; index += 1) {
    const blend = oralBell(index, center, radius) * blendAmount;
    const constricted = Math.min(diameters[index], desired);
    diameters[index] = clamp(
      diameters[index] + (constricted - diameters[index]) * blend,
      HAMBONE_TRACT_DIAMETER_FLOOR_CM,
      6.5,
    );
  }
};

/**
 * Build the resting 44-section oral tube for one Hambone state. Diameters are
 * centimeters and follow Pink Trombone's tongue-body cosine model. Hambone's
 * signed/exaggerated controls extend that curve beyond the usual human zone.
 */
export function hamboneBaseOralDiameters(source = HAMBONE_DEFAULTS) {
  const state = sanitizeHamboneState(source);
  const tongueIndex = tongueBodyIndexForState(state);
  const tongueDiameter = tongueBodyDiameterForState(state);
  const tractRatio = state.tractLengthM / HAMBONE_DEFAULTS.tractLengthM;
  const diameterScale = clamp(
    0.84
      + Math.cbrt(Math.max(0.01, tractRatio)) * 0.12
      + (state.cheekVolume - 0.5) * 0.065,
    0.68,
    1.48,
  );
  const cheekDisplacement = clamp(
    (state.cheekVolume - 0.5) * 0.22 - (state.cheekTension - 0.5) * 0.045,
    -0.24,
    0.46,
  );
  const jawDisplacement = clamp((state.mouthOpening - 0.22) * 0.34, -0.12, 0.62);
  const diameters = Array.from({ length: HAMBONE_TRACT_SECTION_COUNT }, (_, index) => {
    const position = index / (HAMBONE_TRACT_SECTION_COUNT - 1);
    const neutral = index < 7
      ? 0.72 + index * 0.055
      : index < 12
        ? 1.105 + (index - 7) * 0.079
        : 1.5;
    const cheekWeight = oralBell(index, 25, 14);
    const jawWeight = clamp((position - 0.42) / 0.58);
    // A stable, low-amplitude tissue asymmetry prevents a mathematically
    // perfect tube without turning organic variation into another sound layer.
    const tissueWarp = 1 + state.silliness * (
      Math.sin(index * 0.79 + state.cheekVolume * 1.7) * 0.026
      + Math.sin(index * 1.73 + state.tongueCurl * 0.61) * 0.012
    );
    return clamp(
      neutral * diameterScale * tissueWarp
        + cheekDisplacement * cheekWeight
        + jawDisplacement * jawWeight,
      HAMBONE_TRACT_DIAMETER_FLOOR_CM,
      6.5,
    );
  });

  // Pink Trombone's primary tongue replaces the neutral tube with a smooth
  // cosine body instead of merely clipping it. That preserves the widened
  // cavity on the opposite side of the constriction and keeps formants mobile.
  for (
    let index = HAMBONE_TRACT_LANDMARKS.tongueBodyStart;
    index <= HAMBONE_TRACT_LANDMARKS.lipShapingStart + 1;
    index += 1
  ) {
    const interpolation = (tongueIndex - index) / 22;
    const angle = 1.1 * Math.PI * interpolation;
    const normalizedDiameter = 2 + (tongueDiameter - 2) / 1.5;
    let curve = (1.5 - normalizedDiameter + 1.7) * Math.cos(angle);
    if (index === HAMBONE_TRACT_LANDMARKS.lipShapingStart + 1) curve *= 0.8;
    if (
      index === HAMBONE_TRACT_LANDMARKS.tongueBodyStart
      || index === HAMBONE_TRACT_LANDMARKS.lipShapingStart
    ) curve *= 0.94;
    const cheekWeight = oralBell(index, 25, 14);
    const tissueWarp = 1 + state.silliness * (
      Math.sin(index * 0.79 + state.cheekVolume * 1.7) * 0.026
      + Math.sin(index * 1.73 + state.tongueCurl * 0.61) * 0.012
    );
    diameters[index] = clamp(
      (1.5 - curve) * diameterScale * tissueWarp
        + cheekDisplacement * cheekWeight
        + jawDisplacement * clamp((index - 18) / 25),
      HAMBONE_TRACT_DIAMETER_FLOOR_CM,
      6.5,
    );
  }
  return Object.freeze(diameters);
}

/**
 * Apply independent tongue-tip, one or two constriction, cheek/jaw impulse,
 * and lip shapes to the state's Pink-style base tube.
 */
export function hamboneTargetOralDiameters(
  source = HAMBONE_DEFAULTS,
  articulation = {},
) {
  const state = articulatedHamboneState(source, articulation);
  const diameters = Array.from(hamboneBaseOralDiameters(state));
  const cheekImpulse = clamp(finiteOr(articulation?.cheekImpulse, 0), -1, 1);
  const jawImpulse = clamp(finiteOr(articulation?.jawImpulse, 0), -1, 1);

  for (let index = 0; index < diameters.length; index += 1) {
    diameters[index] = clamp(
      diameters[index]
        + cheekImpulse * 0.46 * oralBell(index, 25, 14)
        + jawImpulse * 0.38 * clamp((index - 17) / 26),
      HAMBONE_TRACT_DIAMETER_FLOOR_CM,
      6.5,
    );
  }

  const tongueIndex = tongueBodyIndexForState(state);
  const tongueTipIndex = clamp(
    tongueIndex + 5.5 + state.tongueCurl * 1.8,
    2,
    HAMBONE_TRACT_SECTION_COUNT - 2,
  );
  const restingTipContact = clamp((state.tongueCurl - 0.45) / 2.2, 0, 0.58);
  const tongueContact = Math.max(
    restingTipContact,
    clamp(finiteOr(articulation?.tongueContact, 0)),
  );

  const applyConstriction = (positionKey, amountKey) => {
    const amount = clamp(finiteOr(articulation?.[amountKey], 0));
    if (amount <= 0) return;
    const position = clamp(finiteOr(articulation?.[positionKey], 0.5));
    const center = 2 + position * (HAMBONE_TRACT_SECTION_COUNT - 4);
    const radius = center < 24 ? 7.2 : center < 33 ? 5.4 : 3.4;
    const desired = HAMBONE_TRACT_DIAMETER_FLOOR_CM + (1 - amount) * 1.14;
    constrictOralDiameter(
      diameters,
      center,
      radius,
      desired,
      Math.min(1, amount * 1.45),
    );
  };

  // Projection lengthens and narrows an outlet; it does not make a rounded
  // vowel lip tube vanish. True bilabial contact belongs to `lipClosure`.
  const projectedLipFloor = 0.08
    + Math.max(0, state.lipRounding) * 0.08
    + Math.max(0, state.mouthOpening) * 0.18;
  const lipDiameter = clamp(
    Math.max(
      projectedLipFloor,
      0.035
        + state.mouthOpening * 2.35
        - Math.max(0, state.lipRounding) * 0.25
        + Math.max(0, -state.lipRounding) * 0.5,
    ),
    HAMBONE_TRACT_DIAMETER_FLOOR_CM,
    5.6,
  );
  shapeOralDiameter(
    diameters,
    HAMBONE_TRACT_LANDMARKS.lips,
    HAMBONE_TRACT_LANDMARKS.lips - HAMBONE_TRACT_LANDMARKS.lipShapingStart + 1,
    lipDiameter,
    1,
  );

  // Apply all seals after the vowel/lip tube. This preserves real contacts
  // when a projected lip or rounded-vowel target overlaps the tongue tip.
  constrictOralDiameter(
    diameters,
    tongueTipIndex,
    2.7,
    HAMBONE_TRACT_DIAMETER_FLOOR_CM + (1 - tongueContact) * 0.7,
    tongueContact,
  );
  applyConstriction("constrictionPosition", "constriction");
  applyConstriction("secondaryConstrictionPosition", "secondaryConstriction");

  const lipClosure = clamp(finiteOr(articulation?.lipClosure, 0));
  constrictOralDiameter(
    diameters,
    HAMBONE_TRACT_LANDMARKS.lips,
    4.5,
    HAMBONE_TRACT_DIAMETER_FLOOR_CM,
    lipClosure,
  );

  return Object.freeze(diameters.map((diameter) => clamp(
    diameter,
    HAMBONE_TRACT_DIAMETER_FLOOR_CM,
    6.5,
  )));
}

export function hamboneOralTractProfile(
  source = HAMBONE_DEFAULTS,
  articulation = {},
) {
  const state = sanitizeHamboneState(source);
  const posedState = articulatedHamboneState(state, articulation);
  const baseDiameters = hamboneBaseOralDiameters(state);
  const targetDiameters = hamboneTargetOralDiameters(state, articulation);
  return Object.freeze({
    sectionCount: HAMBONE_TRACT_SECTION_COUNT,
    sectionLengthM: posedState.tractLengthM / HAMBONE_TRACT_SECTION_COUNT,
    tongueBodyIndex: tongueBodyIndexForState(posedState),
    tongueBodyDiameterCm: tongueBodyDiameterForState(posedState),
    tongueTipIndex: clamp(
      tongueBodyIndexForState(posedState) + 5.5 + posedState.tongueCurl * 1.8,
      2,
      HAMBONE_TRACT_SECTION_COUNT - 2,
    ),
    lipIndex: HAMBONE_TRACT_LANDMARKS.lips,
    baseDiameters,
    targetDiameters,
  });
}

export function hamboneFormants(source = HAMBONE_DEFAULTS) {
  const state = sanitizeHamboneState(source);
  const lengthScale = 0.165 / state.tractLengthM;
  const front = state.tonguePosition;
  const curl = state.tongueCurl;
  const opening = state.mouthOpening;
  const rounding = state.lipRounding;
  const first = clamp(
    (260 + opening * 610 + (1 - curl) * 120 - rounding * 105) * lengthScale,
    90,
    2_200,
  );
  const second = clamp(
    (680 + front * 1_760 - rounding * 430 + opening * 90) * lengthScale,
    first + 80,
    5_800,
  );
  const third = clamp(
    (2_050 + front * 630 + curl * 380 - rounding * 210) * lengthScale,
    second + 120,
    8_800,
  );
  return Object.freeze({
    frequenciesHz: Object.freeze([first, second, third]),
    bandwidthsHz: Object.freeze([
      clamp(65 + opening * 150 + state.nasalMix * 90, 35, 1_800),
      clamp(105 + (1 - curl) * 170 + state.nasalMix * 120, 35, 2_400),
      clamp(180 + rounding * 210 + state.nasalMix * 180, 50, 3_200),
    ]),
    nasalFrequencyHz: clamp(245 * lengthScale + state.nasalMix * 110, 110, 750),
  });
}

const SOUND_POSES = Object.freeze({
  bop: freezeSettings({
    mouthOpening: 0.055, lipRounding: -0.12, lipTension: 0.76,
    cheekVolume: 0.18, tonguePosition: 0.42,
  }),
  boop: freezeSettings({
    mouthOpening: 0.07, lipRounding: 1.25, lipTension: 0.52,
    cheekVolume: 0.5, tonguePosition: -0.12,
  }),
  pop: freezeSettings({
    mouthOpening: 0.025, lipRounding: 0.42, cheekVolume: 1.28,
    cheekTension: 0.88, tonguePosition: 0.24,
  }),
  tlik: freezeSettings({
    mouthOpening: 0.36, lipRounding: -0.08, tonguePosition: 1.2,
    tongueCurl: 1.26, cheekVolume: 0.12,
  }),
  shh: freezeSettings({
    mouthOpening: 0.13, lipRounding: 0.66, lipTension: 0.82,
    cheekVolume: 0.34, tonguePosition: 0.88, tongueCurl: 1.12,
  }),
  shack: freezeSettings({
    mouthOpening: 0.72, lipRounding: -0.22, lipTension: 0.94,
    cheekVolume: 0.55, tonguePosition: -0.18, tongueCurl: 0.84,
  }),
  slap: freezeSettings({
    mouthOpening: 0.28, lipRounding: -0.18, cheekVolume: 1.44,
    cheekTension: 1.08, tonguePosition: 0.12,
  }),
  pff: freezeSettings({
    mouthOpening: 0.1, lipRounding: 0.48, lipTension: -0.18,
    cheekVolume: 0.82, tonguePosition: 0.36, tongueCurl: 0.06,
  }),
  kick: freezeSettings({
    mouthOpening: 0.2, lipRounding: 0.46, lipTension: -0.26,
    cheekVolume: 1.62, cheekTension: -0.22, tonguePosition: -0.2,
    tongueCurl: -0.08, tractLengthM: 0.28,
  }),
  smack: freezeSettings({
    mouthOpening: 0.34, lipRounding: -0.24, lipTension: 0.16,
    cheekVolume: 1.54, cheekTension: 1.14, tonguePosition: 0.04,
  }),
  hee: freezeSettings({
    mouthOpening: 0.16, lipRounding: -0.2, lipTension: 0.72,
    cheekVolume: 0.22, tonguePosition: 1.42, tongueCurl: 0.56,
  }),
  haw: freezeSettings({
    mouthOpening: 1.18, lipRounding: -0.12, lipTension: 0.24,
    cheekVolume: 0.74, tonguePosition: -0.42, tongueCurl: -0.08,
  }),
  doo: freezeSettings({
    mouthOpening: 0.22, lipRounding: 1.5, lipTension: 0.42,
    cheekVolume: 0.68, tonguePosition: 0.34, tongueCurl: 0.18,
  }),
  mwah: freezeSettings({
    mouthOpening: 0.045, lipRounding: 1.7, lipTension: 0.22,
    cheekVolume: 1.06, cheekTension: 0.5, tonguePosition: 0.08,
  }),
  drr: freezeSettings({
    mouthOpening: 0.32, lipRounding: 0.04, lipTension: 0.28,
    cheekVolume: 0.58, tonguePosition: 1.12, tongueCurl: 1.36,
  }),
  burp: freezeSettings({
    mouthOpening: 0.82, lipRounding: 0.38, lipTension: -0.3,
    cheekVolume: 1.2, cheekTension: -0.22, tonguePosition: -0.28,
    tongueCurl: -0.18, tractLengthM: 0.3,
  }),
});

const freezeGestureCurve = (points) => Object.freeze(points.map(([phase, value]) => (
  Object.freeze([clamp(phase), finiteOr(value, 0)])
)));

const GESTURE_CURVE_DEFAULTS = Object.freeze({
  poseMix: Object.freeze([[0, 0], [0.08, 1], [0.78, 1], [1, 0]]),
  pressure: Object.freeze([[0, 0], [1, 0]]),
  lipClosure: Object.freeze([[0, 0], [1, 0]]),
  lipImpulse: Object.freeze([[0, 0], [1, 0]]),
  tongueContact: Object.freeze([[0, 0], [1, 0]]),
  constrictionPosition: Object.freeze([[0, 0.5], [1, 0.5]]),
  constriction: Object.freeze([[0, 0], [1, 0]]),
  secondaryConstrictionPosition: Object.freeze([[0, 0.5], [1, 0.5]]),
  secondaryConstriction: Object.freeze([[0, 0], [1, 0]]),
  velum: Object.freeze([[0, 0.04], [1, 0.04]]),
  turbulence: Object.freeze([[0, 0], [1, 0]]),
  suction: Object.freeze([[0, 0], [1, 0]]),
  cheekImpulse: Object.freeze([[0, 0], [1, 0]]),
  jawImpulse: Object.freeze([[0, 0], [1, 0]]),
  voicing: Object.freeze([[0, 0], [1, 0]]),
  aspiration: Object.freeze([[0, 0], [1, 0]]),
  lipFlutter: Object.freeze([[0, 0], [1, 0]]),
  tongueTrill: Object.freeze([[0, 0], [1, 0]]),
});

const defineHamboneGesture = (id, label, curves) => Object.freeze({
  id,
  label,
  curves: Object.freeze(Object.fromEntries(HAMBONE_GESTURE_CHANNELS.map((channel) => [
    channel,
    freezeGestureCurve(curves[channel] ?? GESTURE_CURVE_DEFAULTS[channel]),
  ]))),
});

/**
 * Normalized, explicitly timed articulator trajectories. A processor samples
 * these at its current sample frame; no UI or animation clock is involved.
 */
export const HAMBONE_GESTURE_TRAJECTORIES = Object.freeze({
  bop: defineHamboneGesture("bop", "bilabial kick", {
    poseMix: [[0, 0], [0.045, 1], [0.7, 1], [1, 0]],
    pressure: [[0, 0.12], [0.08, 0.74], [0.29, 1], [0.36, 0.42], [0.7, 0.08], [1, 0]],
    lipClosure: [[0, 0.9], [0.05, 1], [0.3, 1], [0.355, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.3, 0], [0.35, 1], [0.43, 0.08], [1, 0]],
    constrictionPosition: [[0, 0.995], [1, 0.995]],
    constriction: [[0, 0.82], [0.05, 1], [0.3, 1], [0.355, 0], [1, 0]],
    turbulence: [[0, 0], [0.31, 0], [0.355, 0.62], [0.48, 0.06], [1, 0]],
    cheekImpulse: [[0, 0.12], [0.3, 0.3], [0.36, -0.16], [0.52, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.35, 0.2], [0.5, 0], [1, 0]],
    voicing: [[0, 0], [0.34, 0.28], [0.64, 0.08], [1, 0]],
    aspiration: [[0, 0.05], [0.35, 0.34], [0.54, 0], [1, 0]],
  }),
  boop: defineHamboneGesture("boop", "rounded lip kick", {
    poseMix: [[0, 0], [0.055, 1], [0.82, 1], [1, 0]],
    pressure: [[0, 0.1], [0.11, 0.76], [0.37, 1], [0.45, 0.46], [0.82, 0.1], [1, 0]],
    lipClosure: [[0, 0.88], [0.06, 1], [0.38, 1], [0.435, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.38, 0], [0.43, 0.92], [0.56, 0.06], [1, 0]],
    constrictionPosition: [[0, 0.99], [1, 0.99]],
    constriction: [[0, 0.82], [0.07, 1], [0.38, 1], [0.44, 0], [1, 0]],
    turbulence: [[0, 0], [0.39, 0], [0.44, 0.42], [0.6, 0.04], [1, 0]],
    cheekImpulse: [[0, 0.08], [0.38, 0.34], [0.46, -0.12], [0.66, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.44, 0.16], [0.62, 0], [1, 0]],
    voicing: [[0, 0], [0.42, 0.48], [0.82, 0.18], [1, 0]],
    aspiration: [[0, 0.03], [0.44, 0.22], [0.63, 0], [1, 0]],
  }),
  pop: defineHamboneGesture("pop", "inward cheek pop", {
    poseMix: [[0, 0], [0.04, 1], [0.72, 1], [1, 0]],
    pressure: [[0, 0.05], [0.18, 0.32], [0.36, 0.54], [0.44, 0.18], [0.72, 0.04], [1, 0]],
    lipClosure: [[0, 0.72], [0.08, 0.92], [0.37, 0.92], [0.42, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.36, 0], [0.415, 0.74], [0.52, 0], [1, 0]],
    constrictionPosition: [[0, 0.965], [1, 0.965]],
    constriction: [[0, 0.68], [0.1, 0.9], [0.37, 0.9], [0.42, 0], [1, 0]],
    turbulence: [[0, 0], [0.38, 0], [0.42, 0.35], [0.54, 0], [1, 0]],
    suction: [[0, 0.12], [0.16, 0.62], [0.35, 1], [0.43, 0], [1, 0]],
    cheekImpulse: [[0, -0.08], [0.34, -0.72], [0.405, -1], [0.46, 0.66], [0.64, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.42, 0.12], [0.56, 0], [1, 0]],
    aspiration: [[0, 0], [0.42, 0.18], [0.55, 0], [1, 0]],
  }),
  tlik: defineHamboneGesture("tlik", "palatal tongue click", {
    poseMix: [[0, 0], [0.035, 1], [0.75, 1], [1, 0]],
    pressure: [[0, 0.02], [0.22, 0.18], [0.49, 0.3], [0.58, 0.08], [1, 0]],
    tongueContact: [[0, 0.2], [0.15, 0.72], [0.26, 1], [0.49, 1], [0.545, 0], [1, 0]],
    constrictionPosition: [[0, 0.78], [0.48, 0.82], [0.58, 0.86], [1, 0.86]],
    constriction: [[0, 0.18], [0.17, 0.72], [0.27, 1], [0.49, 1], [0.545, 0], [1, 0]],
    secondaryConstrictionPosition: [[0, 0.5], [1, 0.5]],
    secondaryConstriction: [[0, 0.56], [0.14, 1], [0.49, 1], [0.58, 1], [0.61, 0], [1, 0]],
    turbulence: [[0, 0], [0.5, 0], [0.545, 0.56], [0.64, 0], [1, 0]],
    suction: [[0, 0.18], [0.18, 0.64], [0.45, 1], [0.545, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.42, -0.18], [0.55, 0.12], [0.67, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.535, 0.34], [0.67, 0], [1, 0]],
    aspiration: [[0, 0], [0.54, 0.24], [0.64, 0], [1, 0]],
  }),
  shh: defineHamboneGesture("shh", "PH puff · SH groove · K cut", {
    poseMix: [[0, 0], [0.035, 1], [0.9, 1], [1, 0]],
    pressure: [[0, 0.12], [0.08, 0.74], [0.18, 1], [0.68, 0.82], [0.84, 1], [0.9, 0.14], [1, 0]],
    lipClosure: [[0, 0.88], [0.05, 1], [0.17, 1], [0.225, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.17, 0], [0.22, 1], [0.31, 0], [1, 0]],
    tongueContact: [[0, 0], [0.23, 0.28], [0.66, 0.35], [0.74, 0.78], [0.82, 1], [0.875, 0], [1, 0]],
    constrictionPosition: [[0, 0.73], [1, 0.73]],
    constriction: [[0, 0], [0.21, 0], [0.28, 0.62], [0.66, 0.66], [0.78, 0], [1, 0]],
    secondaryConstrictionPosition: [[0, 0.5], [1, 0.5]],
    secondaryConstriction: [[0, 0], [0.65, 0], [0.75, 0.96], [0.83, 1], [0.875, 0], [1, 0]],
    velum: [[0, 0.04], [0.68, 0.06], [0.82, 0.02], [1, 0.04]],
    turbulence: [[0, 0.02], [0.18, 0.08], [0.23, 0.58], [0.31, 1], [0.68, 0.88], [0.76, 0.18], [0.875, 0.82], [0.95, 0.04], [1, 0]],
    suction: [[0, 0.04], [0.17, 0.12], [0.24, 0], [0.71, 0], [0.81, 0.2], [0.88, 0], [1, 0]],
    cheekImpulse: [[0, 0.1], [0.2, 0.34], [0.27, -0.14], [0.48, 0], [0.84, 0.18], [0.94, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.22, 0.12], [0.36, 0], [0.84, 0], [0.875, 0.46], [0.97, 0], [1, 0]],
    voicing: [[0, 0], [0.18, 0.06], [0.31, 0], [1, 0]],
    aspiration: [[0, 0.16], [0.22, 0.5], [0.32, 0.9], [0.69, 0.82], [0.77, 0.12], [0.88, 0.58], [0.96, 0], [1, 0]],
  }),
  shack: defineHamboneGesture("shack", "SH groove · open A · K release", {
    poseMix: [[0, 0], [0.035, 1], [0.82, 1], [1, 0]],
    pressure: [[0, 0.14], [0.07, 0.76], [0.2, 0.9], [0.54, 0.72], [0.7, 1], [0.8, 0.14], [1, 0]],
    tongueContact: [[0, 0.2], [0.08, 0.42], [0.31, 0.22], [0.53, 0.18], [0.62, 0.88], [0.72, 1], [0.79, 0], [1, 0]],
    constrictionPosition: [[0, 0.72], [1, 0.72]],
    constriction: [[0, 0.36], [0.08, 0.62], [0.28, 0.58], [0.38, 0], [1, 0]],
    secondaryConstrictionPosition: [[0, 0.5], [1, 0.5]],
    secondaryConstriction: [[0, 0], [0.54, 0], [0.63, 0.94], [0.72, 1], [0.79, 0], [1, 0]],
    turbulence: [[0, 0.12], [0.08, 0.78], [0.2, 0.92], [0.34, 0.28], [0.54, 0.04], [0.72, 0], [0.79, 0.86], [0.9, 0.04], [1, 0]],
    suction: [[0, 0], [0.61, 0.14], [0.72, 0.2], [0.8, 0], [1, 0]],
    cheekImpulse: [[0, 0.06], [0.18, 0.16], [0.4, 0.04], [0.72, 0.18], [0.88, 0], [1, 0]],
    jawImpulse: [[0, 0.04], [0.16, 0.2], [0.38, 0.72], [0.56, 0.82], [0.7, 0.32], [0.79, 0.64], [0.92, 0], [1, 0]],
    voicing: [[0, 0], [0.34, 0.22], [0.56, 0.3], [0.7, 0], [1, 0]],
    aspiration: [[0, 0.24], [0.1, 0.76], [0.3, 0.58], [0.44, 0.12], [0.72, 0], [0.79, 0.56], [0.9, 0], [1, 0]],
  }),
  slap: defineHamboneGesture("slap", "face-pat impulse", {
    poseMix: [[0, 0], [0.025, 1], [0.62, 1], [1, 0]],
    pressure: [[0, 0], [0.09, 0.12], [0.3, 0.04], [1, 0]],
    turbulence: [[0, 0], [0.075, 0.34], [0.18, 0.06], [1, 0]],
    cheekImpulse: [[0, 0], [0.055, -0.18], [0.09, -1], [0.15, 0.7], [0.32, -0.2], [0.58, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.09, 0.42], [0.23, -0.1], [0.5, 0], [1, 0]],
    aspiration: [[0, 0], [0.08, 0.22], [0.2, 0], [1, 0]],
  }),
  pff: defineHamboneGesture("pff", "breathy lip flutter", {
    poseMix: [[0, 0], [0.04, 1], [0.84, 1], [1, 0]],
    pressure: [[0, 0.08], [0.1, 0.72], [0.22, 0.94], [0.72, 0.7], [0.88, 0.08], [1, 0]],
    lipClosure: [[0, 0.72], [0.08, 0.92], [0.2, 0.12], [0.33, 0.76], [0.46, 0.08], [0.59, 0.68], [0.73, 0.06], [0.84, 0.42], [0.9, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.18, 0.52], [0.3, 0], [0.43, 0.46], [0.55, 0], [0.7, 0.38], [0.82, 0], [1, 0]],
    constrictionPosition: [[0, 0.995], [1, 0.995]],
    constriction: [[0, 0.6], [0.08, 0.82], [0.2, 0.08], [0.33, 0.68], [0.46, 0.05], [0.59, 0.6], [0.73, 0.04], [0.86, 0.34], [0.92, 0], [1, 0]],
    turbulence: [[0, 0.08], [0.12, 0.7], [0.24, 0.9], [0.72, 0.78], [0.88, 0.12], [1, 0]],
    cheekImpulse: [[0, 0.08], [0.2, 0.28], [0.4, 0.12], [0.72, 0.2], [0.9, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.2, 0.12], [0.48, 0.06], [0.82, 0], [1, 0]],
    voicing: [[0, 0], [0.15, 0.18], [0.72, 0.12], [0.9, 0], [1, 0]],
    aspiration: [[0, 0.12], [0.12, 0.82], [0.72, 0.74], [0.9, 0.08], [1, 0]],
    lipFlutter: [[0, 0], [0.1, 0.72], [0.22, 1], [0.72, 0.9], [0.88, 0.08], [1, 0]],
  }),
  kick: defineHamboneGesture("kick", "low-pressure body kick", {
    poseMix: [[0, 0], [0.018, 1], [0.58, 1], [1, 0]],
    pressure: [[0, 0.04], [0.05, 0.18], [0.14, 0.1], [0.36, 0.025], [1, 0]],
    cheekImpulse: [[0, 0], [0.035, 0.18], [0.07, -1], [0.13, 0.82], [0.28, -0.28], [0.58, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.055, -0.5], [0.1, 0.72], [0.24, -0.18], [0.5, 0], [1, 0]],
    voicing: [[0, 0], [0.045, 0.24], [0.16, 0.08], [0.32, 0], [1, 0]],
    aspiration: [[0, 0], [0.06, 0.1], [0.18, 0], [1, 0]],
  }),
  smack: defineHamboneGesture("smack", "opposite-hand cheek impulse", {
    poseMix: [[0, 0], [0.018, 1], [0.64, 1], [1, 0]],
    pressure: [[0, 0], [0.09, 0.08], [0.28, 0.025], [1, 0]],
    turbulence: [[0, 0], [0.06, 0.42], [0.16, 0.08], [1, 0]],
    cheekImpulse: [[0, 0], [0.04, -0.14], [0.075, 1], [0.14, -0.78], [0.3, 0.24], [0.62, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.075, -0.46], [0.2, 0.14], [0.5, 0], [1, 0]],
    aspiration: [[0, 0], [0.065, 0.18], [0.17, 0], [1, 0]],
  }),
  hee: defineHamboneGesture("hee", "ingressive HEE", {
    poseMix: [[0, 0], [0.025, 1], [0.84, 1], [1, 0]],
    pressure: [[0, 0.08], [0.04, 0.72], [0.16, 0.9], [0.7, 0.68], [0.88, 0.08], [1, 0]],
    constrictionPosition: [[0, 0.7], [1, 0.7]],
    constriction: [[0, 0.28], [0.08, 0.48], [0.74, 0.44], [0.9, 0.08], [1, 0]],
    velum: [[0, 0.08], [0.14, 0.18], [0.74, 0.12], [1, 0.06]],
    turbulence: [[0, 0.06], [0.05, 0.28], [0.72, 0.16], [0.9, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.08, -0.14], [0.4, -0.06], [0.86, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.08, -0.18], [0.72, -0.08], [0.9, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.72], [0.16, 1], [0.7, 0.86], [0.88, 0.06], [1, 0]],
    aspiration: [[0, 0.1], [0.04, 0.48], [0.18, 0.28], [0.76, 0.2], [0.9, 0], [1, 0]],
  }),
  haw: defineHamboneGesture("haw", "egressive HAW", {
    poseMix: [[0, 0], [0.025, 1], [0.86, 1], [1, 0]],
    pressure: [[0, 0.08], [0.05, 0.78], [0.18, 1], [0.72, 0.72], [0.9, 0.08], [1, 0]],
    velum: [[0, 0.08], [0.12, 0.12], [0.78, 0.1], [1, 0.06]],
    turbulence: [[0, 0.08], [0.045, 0.34], [0.18, 0.16], [0.78, 0.08], [0.92, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.1, 0.18], [0.72, 0.1], [0.9, 0], [1, 0]],
    jawImpulse: [[0, 0.1], [0.08, 0.86], [0.7, 0.72], [0.9, 0], [1, 0]],
    voicing: [[0, 0], [0.04, 0.62], [0.15, 0.9], [0.74, 0.76], [0.9, 0.04], [1, 0]],
    aspiration: [[0, 0.18], [0.04, 0.64], [0.22, 0.3], [0.78, 0.18], [0.92, 0], [1, 0]],
  }),
  doo: defineHamboneGesture("doo", "pitched rounded DOO", {
    poseMix: [[0, 0], [0.025, 1], [0.9, 1], [1, 0]],
    pressure: [[0, 0.08], [0.045, 0.68], [0.14, 0.88], [0.8, 0.68], [0.92, 0.06], [1, 0]],
    constrictionPosition: [[0, 0.98], [1, 0.98]],
    constriction: [[0, 0.12], [0.1, 0.28], [0.82, 0.24], [0.94, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.12, 0.12], [0.78, 0.08], [0.92, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.08, 0.1], [0.82, 0.08], [0.94, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.7], [0.12, 1], [0.8, 0.9], [0.92, 0.04], [1, 0]],
    aspiration: [[0, 0.06], [0.05, 0.18], [0.82, 0.1], [0.94, 0], [1, 0]],
  }),
  mwah: defineHamboneGesture("mwah", "sealed suction kiss", {
    poseMix: [[0, 0], [0.03, 1], [0.82, 1], [1, 0]],
    pressure: [[0, 0.02], [0.2, 0.12], [0.46, 0.24], [0.55, 0.62], [0.76, 0.34], [0.9, 0.04], [1, 0]],
    lipClosure: [[0, 0.82], [0.08, 1], [0.48, 1], [0.54, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.48, 0], [0.53, 1], [0.64, 0.08], [1, 0]],
    constrictionPosition: [[0, 0.995], [1, 0.995]],
    constriction: [[0, 0.76], [0.08, 1], [0.48, 1], [0.54, 0], [1, 0]],
    turbulence: [[0, 0], [0.48, 0], [0.54, 0.38], [0.68, 0.04], [1, 0]],
    suction: [[0, 0.16], [0.12, 0.68], [0.42, 1], [0.54, 0], [1, 0]],
    cheekImpulse: [[0, -0.08], [0.38, -0.58], [0.5, -0.88], [0.56, 0.62], [0.74, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.52, 0.32], [0.68, 0.08], [0.82, 0], [1, 0]],
    voicing: [[0, 0], [0.53, 0.62], [0.78, 0.42], [0.9, 0], [1, 0]],
    aspiration: [[0, 0], [0.52, 0.2], [0.68, 0], [1, 0]],
  }),
  drr: defineHamboneGesture("drr", "pressure-driven tongue roll", {
    poseMix: [[0, 0], [0.025, 1], [0.9, 1], [1, 0]],
    pressure: [[0, 0.08], [0.05, 0.76], [0.16, 1], [0.82, 0.82], [0.94, 0.06], [1, 0]],
    tongueContact: [[0, 0.14], [0.08, 0.34], [0.84, 0.3], [0.94, 0], [1, 0]],
    constrictionPosition: [[0, 0.84], [1, 0.84]],
    constriction: [[0, 0.18], [0.08, 0.58], [0.84, 0.54], [0.94, 0], [1, 0]],
    turbulence: [[0, 0.04], [0.06, 0.34], [0.84, 0.42], [0.95, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.12, 0.1], [0.84, 0.06], [0.94, 0], [1, 0]],
    voicing: [[0, 0], [0.045, 0.48], [0.18, 0.72], [0.84, 0.6], [0.94, 0], [1, 0]],
    aspiration: [[0, 0.1], [0.05, 0.5], [0.82, 0.44], [0.94, 0], [1, 0]],
    tongueTrill: [[0, 0], [0.045, 0.62], [0.14, 1], [0.84, 0.92], [0.94, 0.04], [1, 0]],
  }),
  burp: defineHamboneGesture("burp", "irregular low gastric fold", {
    poseMix: [[0, 0], [0.025, 1], [0.92, 1], [1, 0]],
    pressure: [[0, 0.04], [0.04, 0.62], [0.16, 1], [0.31, 0.52], [0.45, 0.92], [0.68, 0.38], [0.8, 0.72], [0.94, 0.04], [1, 0]],
    velum: [[0, 0.08], [0.18, 0.3], [0.78, 0.22], [1, 0.08]],
    turbulence: [[0, 0.05], [0.06, 0.28], [0.3, 0.14], [0.46, 0.34], [0.82, 0.16], [0.95, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.08, 0.34], [0.28, -0.14], [0.48, 0.24], [0.72, -0.08], [0.92, 0], [1, 0]],
    jawImpulse: [[0, 0.04], [0.08, 0.58], [0.34, 0.38], [0.5, 0.72], [0.78, 0.46], [0.94, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.58], [0.14, 1], [0.32, 0.5], [0.46, 0.92], [0.68, 0.42], [0.82, 0.78], [0.94, 0], [1, 0]],
    aspiration: [[0, 0.12], [0.04, 0.46], [0.26, 0.3], [0.5, 0.52], [0.82, 0.36], [0.95, 0], [1, 0]],
  }),
});

export function sampleHamboneGestureCurve(points, normalizedPhase) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const phase = clamp(normalizedPhase);
  const first = points[0];
  if (phase <= finiteOr(first?.[0], 0)) return finiteOr(first?.[1], 0);
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    const rightPhase = clamp(finiteOr(right?.[0], 1));
    if (phase > rightPhase) continue;
    const left = points[index - 1];
    const leftPhase = clamp(finiteOr(left?.[0], 0));
    const span = Math.max(1e-9, rightPhase - leftPhase);
    const amount = clamp((phase - leftPhase) / span);
    const eased = amount * amount * (3 - 2 * amount);
    return finiteOr(left?.[1], 0)
      + (finiteOr(right?.[1], 0) - finiteOr(left?.[1], 0)) * eased;
  }
  return finiteOr(points.at(-1)?.[1], 0);
}

export function hambonePoseForSound(soundId, source = HAMBONE_DEFAULTS, amount = 1) {
  const state = sanitizeHamboneState(source);
  const pose = SOUND_POSES[hamboneSound(soundId).id];
  const mix = clamp(amount);
  return sanitizeHamboneState(Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key,
    typeof value === "number" && Number.isFinite(pose[key])
      ? value + (pose[key] - value) * mix
      : value,
  ])), state);
}

export function physicalVoiceParameters(soundId, source = HAMBONE_DEFAULTS, strikeVelocity = 1) {
  const sound = hamboneSound(soundId);
  const velocityAmount = clamp(strikeVelocity, 0.01, 1);
  const state = hambonePoseForSound(sound.id, source, 0.72);
  const geometry = hamboneGeometry(state);
  const formants = hamboneFormants(state);
  const pressureScale = sound.id === "kick"
    ? 0.26
    : sound.id === "slap" || sound.id === "smack"
      ? 0.18
      : 1;
  const pressure = clamp(
    state.lungPressure * (0.34 + velocityAmount * 0.82) * pressureScale,
    0,
    1.8,
  );
  const durationBySound = {
    bop: 0.15, boop: 0.22, pop: 0.14, tlik: 0.095,
    shh: 0.14, shack: 0.18, slap: 0.25, pff: 0.22,
    kick: 0.28, smack: 0.24, hee: 0.2, haw: 0.24,
    doo: 0.28, mwah: 0.24, drr: 0.31, burp: 0.42,
  };
  // Vocal-fold pitch and closure belong to the larynx, not the lips. Keep
  // their internal gesture parameters independent even though Hambone's UI
  // intentionally exposes only the face-level controls.
  const glottalBase = 68 + state.lungPressure * 38 + state.silliness * 58;
  const glottalRatioBySound = {
    kick: 0.42,
    hee: 1.48,
    haw: 0.76,
    doo: 2 ** (state.dooPitch / 12),
    mwah: 0.92,
    drr: 0.82,
    burp: 0.34,
  };
  const glottalRatio = glottalRatioBySound[sound.id]
    ?? (sound.id === "boop" ? 0.72 : 1);
  const glottalTenseness = clamp(
    0.3
      + state.lungPressure * 0.2
      + state.silliness * 0.12
      + (sound.id === "boop" ? -0.08 : 0)
      + (sound.id === "shack" || sound.id === "hee" ? 0.08 : 0)
      - (sound.id === "haw" ? 0.06 : 0)
      - (sound.id === "burp" ? 0.2 : 0),
    0.16,
    0.88,
  );
  const flutterBase = 18 + state.lipTension * 38 + pressure * 10;
  const membraneBase = 92 + state.cheekTension * 250 + (1 - state.cheekVolume) * 120;
  const noiseCenterBase = 1_100 + state.tonguePosition * 3_500 + state.tongueCurl * 1_200;
  return Object.freeze({
    soundId: sound.id,
    family: sound.family,
    velocity: velocityAmount,
    pressure,
    durationSeconds: clamp(
      durationBySound[sound.id] * state.decay * (0.86 + velocityAmount * 0.24),
      0.055,
      1.4,
    ),
    glottalFrequencyHz: clamp(glottalBase * glottalRatio, 28, 720),
    glottalTenseness,
    flutterFrequencyHz: clamp(flutterBase, 12, 92),
    membraneFrequencyHz: clamp(sound.id === "kick" ? membraneBase * 0.38 : membraneBase, 34, 620),
    cavityFrequencyHz: geometry.cavityFrequencyHz,
    noiseCenterHz: clamp(noiseCenterBase * (sound.id === "shh" ? 1.32 : 1), 650, 7_600),
    noiseBandwidthHz: clamp(780 + state.mouthOpening * 2_200 + state.silliness * 1_400, 320, 4_600),
    formantFrequenciesHz: formants.frequenciesHz,
    formantBandwidthsHz: formants.bandwidthsHz,
    nasalFrequencyHz: formants.nasalFrequencyHz,
    nasalMix: state.nasalMix,
    dooPitch: state.dooPitch,
    airflowDirection: sound.id === "hee" ? -1 : 1,
    trillFrequencyHz: clamp(
      22 + state.tongueCurl * 12 + state.lungPressure * 9 + state.silliness * 7,
      16,
      72,
    ),
    irregularity: sound.id === "burp" ? clamp(0.62 + state.silliness * 0.36) : 0,
    silliness: state.silliness,
    lipTension: state.lipTension,
    cheekTension: state.cheekTension,
    cheekVolume: state.cheekVolume,
    tonguePosition: state.tonguePosition,
    tongueCurl: state.tongueCurl,
    mouthOpening: state.mouthOpening,
    // The oral radiator stays in one place; only asymmetric cheek contact gets
    // a restrained spatial offset.
    pan: sound.id === "slap"
      ? -0.42
      : sound.id === "smack"
        ? 0.42
        : sound.id === "pop"
          ? 0.08
          : 0,
  });
}

const HAMBONE_SIGNED_GESTURE_CHANNELS = Object.freeze(["cheekImpulse", "jawImpulse"]);

/**
 * Sample one continuous physical gesture at a normalized 0..1 phase. Energy
 * channels remain normalized; `pressureDrive` combines the pressure envelope
 * with the state's finite physical pressure for direct DSP consumption.
 */
export function hamboneGestureFrame(
  soundId,
  normalizedPhase,
  source = HAMBONE_DEFAULTS,
  strikeVelocity = 1,
) {
  const sound = hamboneSound(soundId);
  const trajectory = HAMBONE_GESTURE_TRAJECTORIES[sound.id];
  const phase = clamp(normalizedPhase);
  const velocityAmount = clamp(strikeVelocity, 0.01, 1);
  const state = sanitizeHamboneState(source);
  const channels = Object.fromEntries(HAMBONE_GESTURE_CHANNELS.map((channel) => {
    const sampled = sampleHamboneGestureCurve(trajectory.curves[channel], phase);
    return [
      channel,
      HAMBONE_SIGNED_GESTURE_CHANNELS.includes(channel)
        ? clamp(sampled, -1, 1)
        : clamp(sampled),
    ];
  }));
  const pose = hambonePoseForSound(sound.id, state, channels.poseMix);
  channels.velum = clamp(
    pose.nasalMix * 0.82 + channels.velum * (1 - pose.nasalMix * 0.45),
  );
  const plan = physicalVoiceParameters(sound.id, state, velocityAmount);
  const cheekVolume = clamp(
    pose.cheekVolume + channels.cheekImpulse * 0.2,
    ...HAMBONE_LIMITS.cheekVolume,
  );
  const mouthOpening = clamp(
    pose.mouthOpening + channels.jawImpulse * 0.24,
    ...HAMBONE_LIMITS.mouthOpening,
  );
  const tongueCurl = clamp(
    pose.tongueCurl + channels.tongueContact * 0.08,
    ...HAMBONE_LIMITS.tongueCurl,
  );
  return Object.freeze({
    soundId: sound.id,
    phase,
    active: phase < 1,
    complete: phase >= 1,
    velocity: velocityAmount,
    durationSeconds: plan.durationSeconds,
    pressureDrive: clamp(plan.pressure * channels.pressure, 0, 1.8),
    ...channels,
    lipTension: pose.lipTension,
    lipRounding: pose.lipRounding,
    lipProjection: pose.lipRounding,
    cheekVolume,
    cheekTension: pose.cheekTension,
    tonguePosition: pose.tonguePosition,
    tongueCurl,
    mouthOpening,
    tractLengthM: pose.tractLengthM,
    nasalMix: pose.nasalMix,
  });
}

/**
 * Sample-addressed counterpart to `hamboneGestureFrame`. Frame zero is the
 * first active sample; `totalFrames` is derived from this strike's duration,
 * so completion and articulation timing are independent of render block size.
 */
export function hamboneGestureFrameAtSample(
  soundId,
  sampleFrame,
  sampleRate = 48_000,
  source = HAMBONE_DEFAULTS,
  strikeVelocity = 1,
) {
  const rate = clamp(finiteOr(sampleRate, 48_000), 8_000, 384_000);
  const frame = Math.max(0, Math.trunc(finiteOr(sampleFrame, 0)));
  const plan = physicalVoiceParameters(soundId, source, strikeVelocity);
  const totalFrames = Math.max(1, Math.ceil(plan.durationSeconds * rate));
  const complete = frame >= totalFrames;
  const frameIndex = Math.min(frame, totalFrames);
  const phase = complete ? 1 : clamp(frameIndex / totalFrames);
  const sampled = hamboneGestureFrame(
    soundId,
    phase,
    source,
    strikeVelocity,
  );
  return Object.freeze({
    ...sampled,
    phase,
    active: !complete,
    complete,
    sampleRate: rate,
    frameIndex,
    totalFrames,
    remainingFrames: Math.max(0, totalFrames - frame),
  });
}
