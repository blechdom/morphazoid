/**
 * Blowhole: browser-free physical-control model for cetacean calls.
 *
 * Anatomical boundary: underwater phonation neither uses nor requires opening
 * a cetacean's external blowhole; it is not a flute opening. Odontocetes
 * generate sound in the nasal complex with phonic lips, reflect it with air
 * sacs, and project it through forehead fats; the great sperm whale is the
 * single-right-source exception with a long spermaceti/junk path. Mysticetes
 * instead
 * use a laryngeal U-fold against a fatty cushion, coupled to a laryngeal sac
 * and surrounding tissue. The helpers below keep those paths distinct.
 */

const SOURCE_FAMILY = Object.freeze({
  ODONTOCETE: "odontocete-nasal",
  MYSTICETE: "mysticete-laryngeal",
});

export const BLOWHOLE_SOURCE_FAMILIES = SOURCE_FAMILY;

export const BLOWHOLE_GESTURE_LANES = Object.freeze([
  "pressure",
  "frequency",
  "pulseRate",
  "closure",
  "focus",
  "asymmetry",
  "roughness",
]);

export const BLOWHOLE_LIMITS = Object.freeze({
  pressure: Object.freeze([0, 1]),
  tension: Object.freeze([0, 1]),
  closure: Object.freeze([0, 1]),
  asymmetry: Object.freeze([-1, 1]),
  recycle: Object.freeze([0, 1]),
  focus: Object.freeze([0, 1]),
  scale: Object.freeze([0, 1]),
  roughness: Object.freeze([0, 1]),
  pulseRateHz: Object.freeze([0, 10_000]),
  depthM: Object.freeze([0, 3_000]),
  level: Object.freeze([0, 1]),
  durationMs: Object.freeze([80, 30_000]),
  physicalFrequencyHz: Object.freeze([10, 200_000]),
  audibleFrequencyHz: Object.freeze([40, 12_000]),
});

export const BLOWHOLE_DEFAULTS = Object.freeze({
  callId: "orca-pulsed-call",
  pressure: 0.72,
  tension: 0.5,
  closure: 0.62,
  asymmetry: 0,
  recycle: 0.76,
  focus: 0.72,
  scale: 0.5,
  roughness: 0.08,
  pulseRateHz: 12,
  depthM: 12,
  monitorMode: "audible",
  level: 0.34,
});

const finiteOr = (value, fallback = 0) => {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
};

export function clampBlowhole(value, minimum = 0, maximum = 1) {
  const low = Math.min(finiteOr(minimum), finiteOr(maximum, 1));
  const high = Math.max(finiteOr(minimum), finiteOr(maximum, 1));
  return Math.min(high, Math.max(low, finiteOr(value, low)));
}

const clamp01 = (value) => clampBlowhole(value, 0, 1);
const bipolar = (value) => clampBlowhole(value, -1, 1);
const mix = (a, b, amount) => a + (b - a) * amount;

function freezePoints(points) {
  const sanitized = (Array.isArray(points) ? points : [])
    .map((point) => Object.freeze([
      clamp01(Array.isArray(point) ? point[0] : 0),
      clamp01(Array.isArray(point) ? point[1] : 0),
    ]))
    .sort((a, b) => a[0] - b[0]);
  if (sanitized.length === 0) {
    return Object.freeze([Object.freeze([0, 0]), Object.freeze([1, 0])]);
  }
  return Object.freeze(sanitized);
}

function freezeLanes(lanes) {
  return Object.freeze(Object.fromEntries(BLOWHOLE_GESTURE_LANES.map((lane) => (
    [lane, freezePoints(lanes?.[lane])]
  ))));
}

function freezeRange(range, fallback) {
  const first = finiteOr(range?.[0], fallback[0]);
  const second = finiteOr(range?.[1], fallback[1]);
  return Object.freeze([Math.min(first, second), Math.max(first, second)]);
}

function freezeCall(definition) {
  const frequencyHz = freezeRange(
    definition.physicalRange?.frequencyHz,
    BLOWHOLE_LIMITS.physicalFrequencyHz,
  );
  const pulseRateHz = freezeRange(definition.physicalRange?.pulseRateHz, [0, 0]);
  const durationSeconds = freezeRange(
    definition.physicalRange?.durationSeconds,
    [definition.durationMs / 1_000, definition.durationMs / 1_000],
  );
  const lanes = freezeLanes(definition.lanes);
  const pulseTimes = Object.freeze((definition.pulseTimes ?? definition.pulsePattern ?? []).map(clamp01));
  return Object.freeze({
    id: definition.id,
    label: definition.label,
    species: definition.species,
    family: definition.family,
    sourceFamily: definition.sourceFamily,
    register: definition.register,
    durationMs: clampBlowhole(definition.durationMs, ...BLOWHOLE_LIMITS.durationMs),
    description: definition.description,
    physicalRange: Object.freeze({ frequencyHz, pulseRateHz, durationSeconds }),
    frequencyRangeHz: frequencyHz,
    pulseRateRangeHz: pulseRateHz,
    anatomy: Object.freeze({ ...definition.anatomy }),
    sourcePath: Object.freeze([...(definition.sourcePath ?? [])]),
    controlDefaults: Object.freeze({ ...BLOWHOLE_DEFAULTS, ...definition.controlDefaults }),
    // `pulseTimes` is normalized call time for exact discrete event renderers.
    pulseTimes,
    pulsePattern: pulseTimes,
    voiceRatios: Object.freeze((definition.voiceRatios ?? [1]).map((ratio) => (
      clampBlowhole(ratio, 0.0625, 16)
    ))),
    pulseLockedToFundamental: Boolean(definition.pulseLockedToFundamental),
    lanes,
    // `curves` makes a call directly consumable by timeline-style clients.
    curves: lanes,
  });
}

const ODONTOCETE_PATH = Object.freeze([
  "lungs and recycled nasal air",
  "selected phonic-lip complex",
  "reflecting nasal air sacs",
  "melon and forehead fats",
  "seawater",
]);

const MYSTICETE_PATH = Object.freeze([
  "lungs",
  "coupled laryngeal U-fold / cricoid-cushion gap",
  "laryngeal sac and surrounding tissue",
  "seawater",
]);

const SPERM_WHALE_PATH = Object.freeze([
  "pressurized right nasal passage",
  "single right phonic-lip complex",
  "distal air sac and spermaceti case",
  "frontal-sac reflection",
  "junk acoustic window",
  "seawater",
]);

const odontoceteAnatomy = (blowholeCount = 1) => ({
  blowholeCount,
  externalBlowhole: "sealed underwater; not the sound generator",
  generator: "paired nasal phonic lips (monkey-lips/dorsal-bursae complexes)",
  resonator: "nasal air sacs recycle air and provide acoustic reflection",
  projector: "melon and forehead fats focus sound into water",
});

const mysticeteAnatomy = () => ({
  blowholeCount: 2,
  externalBlowhole: "both external nares are sealed underwater",
  generator: "coupled laryngeal U-fold and cricoid-cushion mucosa",
  resonator: "laryngeal sac and surrounding tissues",
  projector: "body tissues couple the laryngeal source into water",
});

const spermWhaleAnatomy = () => ({
  blowholeCount: 1,
  externalBlowhole: "left external naris is sealed underwater; not the sound generator",
  generator: "single right nasal phonic-lip complex (museau de singe)",
  resonator: "distal and frontal air sacs reflect clicks through the spermaceti case",
  projector: "the junk forms the terminal acoustic window into seawater",
});

/**
 * The frequency ranges are conservative physical modeling windows, not claims
 * that every individual or population occupies every frequency in a window.
 * Keyframe phases and values are normalized to [0, 1].
 */
export const BLOWHOLE_CALLS = Object.freeze([
  freezeCall({
    id: "bottlenose-signature-whistle",
    label: "Bottlenose signature whistle",
    species: "Common bottlenose dolphin",
    family: "odontocete",
    sourceFamily: SOURCE_FAMILY.ODONTOCETE,
    register: "frequency-modulated whistle",
    durationMs: 1_350,
    description: "An individually distinctive, narrowband contour generated in the nasal phonic-lip complex and projected through the melon.",
    physicalRange: { frequencyHz: [2_000, 24_000], pulseRateHz: [0, 0], durationSeconds: [0.4, 2.5] },
    anatomy: odontoceteAnatomy(1),
    sourcePath: ODONTOCETE_PATH,
    controlDefaults: { pressure: 0.64, closure: 0.5, focus: 0.82, roughness: 0.025, pulseRateHz: 0 },
    voiceRatios: [1, 1.006],
    lanes: {
      pressure: [[0, 0.03], [0.08, 0.72], [0.52, 0.8], [0.9, 0.58], [1, 0.01]],
      frequency: [[0, 0.3], [0.15, 0.5], [0.31, 0.43], [0.53, 0.73], [0.7, 0.61], [0.86, 0.8], [1, 0.54]],
      pulseRate: [[0, 0], [1, 0]],
      closure: [[0, 0.44], [0.1, 0.58], [0.84, 0.56], [1, 0.38]],
      focus: [[0, 0.68], [0.12, 0.86], [0.88, 0.9], [1, 0.66]],
      asymmetry: [[0, 0.12], [0.42, 0.18], [1, 0.14]],
      roughness: [[0, 0.08], [0.12, 0.025], [0.88, 0.035], [1, 0.1]],
    },
  }),
  freezeCall({
    id: "dolphin-search-clicks",
    label: "Dolphin search clicks",
    species: "Bottlenose dolphin model",
    family: "odontocete",
    sourceFamily: SOURCE_FAMILY.ODONTOCETE,
    register: "echolocation search click train",
    durationMs: 2_400,
    description: "Separated broadband nasal clicks scan the scene; air sacs reflect the impulses forward and the melon forms a directional beam.",
    physicalRange: { frequencyHz: [40_000, 130_000], pulseRateHz: [4, 35], durationSeconds: [0.5, 5] },
    anatomy: odontoceteAnatomy(1),
    sourcePath: ODONTOCETE_PATH,
    controlDefaults: { pressure: 0.76, closure: 0.82, focus: 0.94, roughness: 0.12, pulseRateHz: 12 },
    voiceRatios: [1, 0.64],
    lanes: {
      pressure: [[0, 0.22], [0.08, 0.78], [0.72, 0.74], [0.94, 0.6], [1, 0.08]],
      frequency: [[0, 0.6], [0.28, 0.72], [0.58, 0.66], [1, 0.78]],
      pulseRate: [[0, 0.18], [0.62, 0.34], [1, 0.48]],
      closure: [[0, 0.72], [0.08, 0.9], [0.9, 0.88], [1, 0.62]],
      focus: [[0, 0.82], [0.12, 0.98], [1, 0.95]],
      asymmetry: [[0, 0.76], [0.5, 0.82], [1, 0.78]],
      roughness: [[0, 0.22], [0.1, 0.1], [0.9, 0.14], [1, 0.28]],
    },
  }),
  freezeCall({
    id: "dolphin-terminal-buzz",
    label: "Dolphin terminal buzz",
    species: "Bottlenose dolphin model",
    family: "odontocete",
    sourceFamily: SOURCE_FAMILY.ODONTOCETE,
    register: "accelerating echolocation buzz",
    durationMs: 620,
    description: "During close approach, click intervals collapse into a rapid terminal buzz while the nasal source remains strongly focused.",
    physicalRange: { frequencyHz: [40_000, 130_000], pulseRateHz: [80, 500], durationSeconds: [0.15, 1.5] },
    anatomy: odontoceteAnatomy(1),
    sourcePath: ODONTOCETE_PATH,
    controlDefaults: { pressure: 0.88, closure: 0.9, focus: 0.98, roughness: 0.2, pulseRateHz: 260 },
    voiceRatios: [1, 0.7],
    lanes: {
      pressure: [[0, 0.35], [0.08, 0.86], [0.78, 0.94], [1, 0.08]],
      frequency: [[0, 0.56], [0.45, 0.72], [1, 0.82]],
      pulseRate: [[0, 0.08], [0.3, 0.3], [0.68, 0.7], [0.9, 1], [1, 0.78]],
      closure: [[0, 0.76], [0.1, 0.94], [0.92, 0.97], [1, 0.68]],
      focus: [[0, 0.9], [0.12, 1], [1, 0.98]],
      asymmetry: [[0, 0.78], [0.55, 0.86], [1, 0.8]],
      roughness: [[0, 0.18], [0.4, 0.24], [0.88, 0.36], [1, 0.3]],
    },
  }),
  freezeCall({
    id: "orca-pulsed-call",
    label: "Orca pulsed call",
    species: "Orca",
    family: "odontocete",
    sourceFamily: SOURCE_FAMILY.ODONTOCETE,
    register: "stereotyped pulsed social call",
    durationMs: 1_450,
    description: "A rapid M1 phonic-lip tissue pulse train whose repetition rate is its fundamental; nonlinear motion supplies the harmonic call spectrum.",
    physicalRange: { frequencyHz: [500, 10_000], pulseRateHz: [500, 10_000], durationSeconds: [0.3, 2.5] },
    anatomy: odontoceteAnatomy(1),
    sourcePath: ODONTOCETE_PATH,
    controlDefaults: { pressure: 0.78, closure: 0.7, focus: 0.76, roughness: 0.38, pulseRateHz: 1_200 },
    voiceRatios: [1],
    pulseLockedToFundamental: true,
    lanes: {
      pressure: [[0, 0.06], [0.06, 0.8], [0.3, 0.7], [0.5, 0.88], [0.88, 0.72], [1, 0.02]],
      frequency: [[0, 0.2], [0.18, 0.43], [0.42, 0.36], [0.7, 0.68], [1, 0.48]],
      pulseRate: [[0, 0.2], [0.18, 0.43], [0.42, 0.36], [0.7, 0.68], [1, 0.48]],
      closure: [[0, 0.48], [0.08, 0.76], [0.92, 0.73], [1, 0.42]],
      focus: [[0, 0.58], [0.15, 0.8], [0.8, 0.74], [1, 0.56]],
      asymmetry: [[0, 0.6], [0.35, 0.72], [0.66, 0.55], [1, 0.67]],
      roughness: [[0, 0.3], [0.12, 0.5], [0.54, 0.34], [0.82, 0.58], [1, 0.26]],
    },
  }),
  freezeCall({
    id: "sperm-whale-coda",
    label: "Sperm-whale five-click coda",
    species: "Sperm whale",
    family: "odontocete",
    sourceFamily: SOURCE_FAMILY.ODONTOCETE,
    register: "rhythmic social-click coda",
    durationMs: 1_600,
    description: "Five broadband communication clicks form a repeatable rhythm; codas carry social identity, but this contour does not encode a named clan dialect.",
    physicalRange: { frequencyHz: [2_000, 25_000], pulseRateHz: [1.5, 12], durationSeconds: [0.6, 3] },
    anatomy: spermWhaleAnatomy(),
    sourcePath: SPERM_WHALE_PATH,
    controlDefaults: { pressure: 0.9, closure: 0.91, asymmetry: 1, focus: 0.88, scale: 0.66, roughness: 0.26, pulseRateHz: 4.5 },
    pulsePattern: [0, 0.12, 0.28, 0.57, 0.86],
    voiceRatios: [1],
    lanes: {
      pressure: [[0, 0.92], [0.12, 0.82], [0.28, 0.9], [0.57, 0.84], [0.86, 0.94], [1, 0.02]],
      frequency: [[0, 0.7], [0.28, 0.62], [0.57, 0.68], [0.86, 0.58], [1, 0.5]],
      pulseRate: [[0, 0.35], [0.28, 0.28], [0.57, 0.2], [0.86, 0.42], [1, 0.32]],
      closure: [[0, 0.94], [0.9, 0.9], [1, 0.55]],
      focus: [[0, 0.9], [0.5, 0.84], [1, 0.8]],
      asymmetry: [[0, 1], [1, 1]],
      roughness: [[0, 0.34], [0.4, 0.25], [0.8, 0.3], [1, 0.22]],
    },
  }),
  freezeCall({
    id: "humpback-moan",
    label: "Humpback moan",
    species: "Humpback whale",
    family: "mysticete",
    sourceFamily: SOURCE_FAMILY.MYSTICETE,
    register: "low laryngeal moan",
    durationMs: 3_600,
    description: "A sustained low call from the coupled U-fold/cricoid-cushion source, colored by the compliant laryngeal sac and body tissues.",
    physicalRange: { frequencyHz: [80, 700], pulseRateHz: [0, 0], durationSeconds: [1, 5] },
    anatomy: mysticeteAnatomy(),
    sourcePath: MYSTICETE_PATH,
    controlDefaults: { pressure: 0.8, closure: 0.76, recycle: 0.82, focus: 0.46, scale: 0.74, roughness: 0.18, pulseRateHz: 0 },
    voiceRatios: [1, 0.5],
    lanes: {
      pressure: [[0, 0.02], [0.12, 0.7], [0.42, 0.86], [0.82, 0.7], [1, 0.01]],
      frequency: [[0, 0.56], [0.28, 0.48], [0.62, 0.36], [1, 0.26]],
      pulseRate: [[0, 0], [1, 0]],
      closure: [[0, 0.38], [0.14, 0.76], [0.82, 0.72], [1, 0.3]],
      focus: [[0, 0.38], [0.28, 0.52], [0.7, 0.45], [1, 0.3]],
      asymmetry: [[0, 0.5], [0.48, 0.44], [1, 0.52]],
      roughness: [[0, 0.12], [0.22, 0.2], [0.72, 0.28], [1, 0.1]],
    },
  }),
  freezeCall({
    id: "humpback-two-voice-phrase",
    label: "Humpback two-voice phrase",
    species: "Humpback whale",
    family: "mysticete",
    sourceFamily: SOURCE_FAMILY.MYSTICETE,
    register: "biphonic song phrase",
    durationMs: 6_400,
    description: "A speculative nonlinear phrase combining fold-to-fat and bilateral fold-to-fold regimes; it is a synthesis mapping, not two open blowholes.",
    physicalRange: { frequencyHz: [80, 3_000], pulseRateHz: [0, 0], durationSeconds: [2, 10] },
    anatomy: mysticeteAnatomy(),
    sourcePath: MYSTICETE_PATH,
    controlDefaults: { pressure: 0.86, closure: 0.7, asymmetry: -0.08, recycle: 0.88, focus: 0.6, scale: 0.65, roughness: 0.24, pulseRateHz: 0 },
    voiceRatios: [1, 1.52],
    lanes: {
      pressure: [[0, 0.02], [0.08, 0.76], [0.36, 0.9], [0.66, 0.72], [0.84, 0.88], [1, 0.01]],
      frequency: [[0, 0.18], [0.2, 0.38], [0.42, 0.3], [0.67, 0.65], [0.86, 0.54], [1, 0.42]],
      pulseRate: [[0, 0], [1, 0]],
      closure: [[0, 0.34], [0.1, 0.7], [0.5, 0.78], [0.88, 0.66], [1, 0.3]],
      focus: [[0, 0.36], [0.25, 0.64], [0.58, 0.48], [0.84, 0.72], [1, 0.35]],
      asymmetry: [[0, 0.42], [0.2, 0.28], [0.48, 0.68], [0.72, 0.35], [1, 0.57]],
      roughness: [[0, 0.14], [0.2, 0.32], [0.52, 0.2], [0.78, 0.4], [1, 0.12]],
    },
  }),
  freezeCall({
    id: "blue-whale-b-call",
    label: "Northeast Pacific blue-whale B call",
    species: "Blue whale · Northeast Pacific",
    family: "mysticete",
    sourceFamily: SOURCE_FAMILY.MYSTICETE,
    register: "infrasonic downswept call",
    durationMs: 18_000,
    description: "A population-qualified Northeast Pacific infrasonic downsweep; audible monitoring transposes it without relabeling the physical frequency.",
    physicalRange: { frequencyHz: [15, 20], pulseRateHz: [0, 0], durationSeconds: [10, 25] },
    anatomy: mysticeteAnatomy(),
    sourcePath: MYSTICETE_PATH,
    controlDefaults: { pressure: 0.94, tension: 0.34, closure: 0.84, recycle: 0.94, focus: 0.72, scale: 0.94, roughness: 0.12, pulseRateHz: 0 },
    voiceRatios: [1, 2],
    lanes: {
      pressure: [[0, 0.01], [0.08, 0.82], [0.25, 0.96], [0.82, 0.9], [0.96, 0.52], [1, 0.01]],
      frequency: [[0, 0.94], [0.18, 0.82], [0.5, 0.58], [0.8, 0.36], [1, 0.18]],
      pulseRate: [[0, 0], [1, 0]],
      closure: [[0, 0.42], [0.1, 0.88], [0.9, 0.84], [1, 0.34]],
      focus: [[0, 0.5], [0.18, 0.76], [0.84, 0.72], [1, 0.44]],
      asymmetry: [[0, 0.5], [0.45, 0.47], [1, 0.52]],
      roughness: [[0, 0.08], [0.16, 0.14], [0.7, 0.1], [1, 0.06]],
    },
  }),
]);

export const BLOWHOLE_CALL_LOOKUP = Object.freeze(Object.fromEntries(
  BLOWHOLE_CALLS.map((call) => [call.id, call]),
));

export const BLOWHOLE_CALLS_BY_ID = BLOWHOLE_CALL_LOOKUP;

export function blowholeCall(id, fallbackId = BLOWHOLE_DEFAULTS.callId) {
  const key = typeof id === "string" ? id : "";
  const fallbackKey = typeof fallbackId === "string" ? fallbackId : BLOWHOLE_DEFAULTS.callId;
  return BLOWHOLE_CALL_LOOKUP[key]
    ?? BLOWHOLE_CALL_LOOKUP[fallbackKey]
    ?? BLOWHOLE_CALLS[0];
}

export const getBlowholeCall = blowholeCall;
export const lookupBlowholeCall = blowholeCall;

function safeStateObject(source) {
  return source && typeof source === "object" && !Array.isArray(source) ? source : {};
}

/** Return a fresh, frozen state containing exactly the public control keys. */
export function sanitizeBlowholeState(source = {}, fallback = BLOWHOLE_DEFAULTS) {
  const state = safeStateObject(source);
  const base = safeStateObject(fallback);
  const call = blowholeCall(state.callId, base.callId);
  const result = { callId: call.id };
  const numericKeys = [
    "pressure", "tension", "closure", "asymmetry", "recycle", "focus",
    "scale", "roughness", "pulseRateHz", "depthM", "level",
  ];
  for (const key of numericKeys) {
    const limits = BLOWHOLE_LIMITS[key];
    const defaultValue = BLOWHOLE_DEFAULTS[key];
    result[key] = clampBlowhole(
      finiteOr(state[key], finiteOr(base[key], defaultValue)),
      limits[0],
      limits[1],
    );
  }
  result.monitorMode = state.monitorMode === "physical" || state.monitorMode === "audible"
    ? state.monitorMode
    : (base.monitorMode === "physical" ? "physical" : "audible");
  // Keep insertion order aligned with the UI's requested public key order.
  return Object.freeze({
    callId: result.callId,
    pressure: result.pressure,
    tension: result.tension,
    closure: result.closure,
    asymmetry: result.asymmetry,
    recycle: result.recycle,
    focus: result.focus,
    scale: result.scale,
    roughness: result.roughness,
    pulseRateHz: result.pulseRateHz,
    depthM: result.depthM,
    monitorMode: result.monitorMode,
    level: result.level,
  });
}

/**
 * Create state with call-appropriate controls. Accepts either `(callId,
 * overrides)` or one object containing `callId` and overrides.
 */
export function createBlowholeState(callIdOrOverrides = BLOWHOLE_DEFAULTS.callId, overrides = {}) {
  const firstIsObject = callIdOrOverrides && typeof callIdOrOverrides === "object";
  const requested = firstIsObject ? callIdOrOverrides : safeStateObject(overrides);
  const callId = firstIsObject ? requested.callId : callIdOrOverrides;
  const call = blowholeCall(callId);
  return sanitizeBlowholeState({
    ...BLOWHOLE_DEFAULTS,
    ...call.controlDefaults,
    ...requested,
    callId: call.id,
  }, { ...BLOWHOLE_DEFAULTS, ...call.controlDefaults, callId: call.id });
}

export function interpolateKeyframes(points, phase = 0) {
  const frames = Array.isArray(points) && points.length > 0 ? points : [[0, 0], [1, 0]];
  const at = clamp01(phase);
  let previousPhase = clamp01(frames[0]?.[0]);
  let previousValue = clamp01(frames[0]?.[1]);
  if (at <= previousPhase) return previousValue;
  for (let index = 1; index < frames.length; index += 1) {
    const nextPhase = clamp01(frames[index]?.[0]);
    const nextValue = clamp01(frames[index]?.[1]);
    if (at <= nextPhase) {
      const span = Math.max(1e-9, nextPhase - previousPhase);
      return clamp01(mix(previousValue, nextValue, (at - previousPhase) / span));
    }
    previousPhase = nextPhase;
    previousValue = nextValue;
  }
  return previousValue;
}

/**
 * Interpolate either `(points, phase)` or `(callOrId, laneName, phase)`.
 */
export function interpolateBlowholeLane(pointsOrCall, laneOrPhase = 0, maybePhase = 0) {
  if (Array.isArray(pointsOrCall)) return interpolateKeyframes(pointsOrCall, laneOrPhase);
  const call = typeof pointsOrCall === "string"
    ? blowholeCall(pointsOrCall)
    : blowholeCall(pointsOrCall?.id);
  const lane = BLOWHOLE_GESTURE_LANES.includes(laneOrPhase) ? laneOrPhase : "pressure";
  return interpolateKeyframes(call.lanes[lane], maybePhase);
}

function logarithmicRange(normalized, range) {
  const low = Math.max(BLOWHOLE_LIMITS.physicalFrequencyHz[0], finiteOr(range?.[0], 10));
  const high = Math.max(low, finiteOr(range?.[1], low));
  return clampBlowhole(
    low * Math.pow(high / low, clamp01(normalized)),
    BLOWHOLE_LIMITS.physicalFrequencyHz[0],
    BLOWHOLE_LIMITS.physicalFrequencyHz[1],
  );
}

function linearRange(normalized, range) {
  const low = finiteOr(range?.[0]);
  const high = Math.max(low, finiteOr(range?.[1], low));
  return clampBlowhole(mix(low, high, clamp01(normalized)), low, high);
}

/**
 * Evaluate authored lanes plus performer controls. Normalized lane outputs stay
 * in [0, 1]; `asymmetryBipolar` exposes the corresponding [-1, 1] balance.
 */
export function evaluateBlowholeGesture(callOrId, phase = 0, stateSource = {}) {
  const call = typeof callOrId === "string"
    ? blowholeCall(callOrId)
    : blowholeCall(callOrId?.id ?? stateSource?.callId);
  const state = sanitizeBlowholeState(
    { ...stateSource, callId: call.id },
    { ...BLOWHOLE_DEFAULTS, ...call.controlDefaults, callId: call.id },
  );
  const defaults = call.controlDefaults;
  const at = clamp01(phase);
  const authored = Object.fromEntries(BLOWHOLE_GESTURE_LANES.map((lane) => (
    [lane, interpolateKeyframes(call.lanes[lane], at)]
  )));
  const pressure = clamp01(authored.pressure * state.pressure / Math.max(0.001, defaults.pressure));
  const frequency = clamp01(
    authored.frequency
    + (state.tension - defaults.tension) * 0.42
    - (state.scale - defaults.scale) * 0.2,
  );
  const closure = clamp01(authored.closure + (state.closure - defaults.closure) * 0.72);
  const focus = clamp01(authored.focus + (state.focus - defaults.focus) * 0.72);
  const roughness = clamp01(authored.roughness + (state.roughness - defaults.roughness) * 0.75);
  const asymmetryBipolar = bipolar((authored.asymmetry * 2 - 1) + state.asymmetry - defaults.asymmetry);
  const asymmetry = clamp01((asymmetryBipolar + 1) * 0.5);
  const physicalFrequencyHz = logarithmicRange(frequency, call.physicalRange.frequencyHz);
  const pulseRange = call.physicalRange.pulseRateHz;
  const authoredPulseRateHz = linearRange(authored.pulseRate, pulseRange);
  // In M1 the tissue-pulse repetition rate is f0 itself. M0 click trains keep
  // a separate event rate and broadband center-frequency contour.
  const pulseRateHz = call.pulseLockedToFundamental
    ? clampBlowhole(physicalFrequencyHz, pulseRange[0], pulseRange[1])
    : pulseRange[1] > 0
      ? authoredPulseRateHz
      : 0;
  const pulseRate = pulseRange[1] > pulseRange[0]
    ? clamp01((pulseRateHz - pulseRange[0]) / (pulseRange[1] - pulseRange[0]))
    : 0;
  let nearestPulseIndex = -1;
  let nearestPulsePhase = 0;
  let pulseDistance = 1;
  for (let index = 0; index < call.pulseTimes.length; index += 1) {
    const distance = Math.abs(at - call.pulseTimes[index]);
    if (distance < pulseDistance) {
      pulseDistance = distance;
      nearestPulseIndex = index;
      nearestPulsePhase = call.pulseTimes[index];
    }
  }
  // A display/control impulse only; the voice plan exposes exact event times.
  const pulseWindow = clampBlowhole(18 / call.durationMs, 0.001, 0.08);
  const pulse = nearestPulseIndex < 0 ? 0 : clamp01(1 - pulseDistance / pulseWindow);
  const lanes = Object.freeze({
    pressure,
    frequency,
    pulseRate,
    closure,
    focus,
    asymmetry,
    roughness,
  });
  return Object.freeze({
    callId: call.id,
    phase: at,
    ...lanes,
    lanes,
    asymmetryBipolar,
    balance: asymmetryBipolar,
    recycle: state.recycle,
    physicalFrequencyHz,
    pulseRateHz,
    pulse,
    nearestPulseIndex,
    nearestPulsePhase,
  });
}

export const interpolateBlowholeGesture = evaluateBlowholeGesture;

/**
 * Keep the factual physical pitch alongside an octave-folded audition pitch.
 * `physical` mode selects the factual pitch even when it is inaudible;
 * `audible` mode selects the folded preview and reports the exact shift.
 */
export function mapPhysicalToAudible(frequencyHz, monitorMode = "audible") {
  const physicalFrequencyHz = clampBlowhole(
    frequencyHz,
    BLOWHOLE_LIMITS.physicalFrequencyHz[0],
    BLOWHOLE_LIMITS.physicalFrequencyHz[1],
  );
  let audibleFrequencyHz = physicalFrequencyHz;
  let shiftOctaves = 0;
  while (audibleFrequencyHz < BLOWHOLE_LIMITS.audibleFrequencyHz[0] && shiftOctaves < 16) {
    audibleFrequencyHz *= 2;
    shiftOctaves += 1;
  }
  while (audibleFrequencyHz > BLOWHOLE_LIMITS.audibleFrequencyHz[1] && shiftOctaves > -16) {
    audibleFrequencyHz *= 0.5;
    shiftOctaves -= 1;
  }
  audibleFrequencyHz = clampBlowhole(
    audibleFrequencyHz,
    BLOWHOLE_LIMITS.audibleFrequencyHz[0],
    BLOWHOLE_LIMITS.audibleFrequencyHz[1],
  );
  const mode = monitorMode === "physical" ? "physical" : "audible";
  const monitorFrequencyHz = mode === "physical" ? physicalFrequencyHz : audibleFrequencyHz;
  return Object.freeze({
    monitorMode: mode,
    physicalFrequencyHz,
    audibleFrequencyHz,
    monitorFrequencyHz,
    frequencyHz: monitorFrequencyHz,
    shiftOctaves,
    shiftSemitones: shiftOctaves * 12,
    transpositionRatio: Math.pow(2, shiftOctaves),
    transposed: shiftOctaves !== 0,
    physicallyAudible: physicalFrequencyHz >= 20 && physicalFrequencyHz <= 20_000,
  });
}

export const physicalToAudibleMap = mapPhysicalToAudible;

function blowholeCallVoiceCount(call) {
  const unilateral = call.id === "bottlenose-signature-whistle"
    || call.id === "dolphin-search-clicks"
    || call.id === "dolphin-terminal-buzz"
    || call.id === "orca-pulsed-call"
    || call.id === "sperm-whale-coda";
  if (call.sourceFamily === SOURCE_FAMILY.ODONTOCETE) return unilateral ? 1 : 2;
  return call.id === "humpback-two-voice-phrase" ? 2 : 1;
}

/**
 * Select one octave shift for an entire authored call. A constant translation
 * keeps both instantaneous intervals and the shape of every frequency contour
 * intact instead of creating phase-dependent octave jumps.
 */
export function blowholeCallAudibleShift(callOrId) {
  const call = typeof callOrId === "string" ? blowholeCall(callOrId) : blowholeCall(callOrId?.id);
  const voiceCount = blowholeCallVoiceCount(call);
  const detuneSpread = voiceCount > 1
    ? call.sourceFamily === SOURCE_FAMILY.ODONTOCETE ? 0.022 : 0.04
    : 0;
  const ratios = Array.from({ length: voiceCount }, (_, index) => call.voiceRatios[index] ?? 1);
  const lowestPhysical = call.physicalRange.frequencyHz[0]
    * Math.min(...ratios.map((ratio) => ratio * (1 - detuneSpread)));
  const highestPhysical = call.physicalRange.frequencyHz[1]
    * Math.max(...ratios.map((ratio) => ratio * (1 + detuneSpread)));
  const minimumShift = Math.ceil(Math.log2(BLOWHOLE_LIMITS.audibleFrequencyHz[0] / lowestPhysical));
  const maximumShift = Math.floor(Math.log2(BLOWHOLE_LIMITS.audibleFrequencyHz[1] / highestPhysical));
  if (minimumShift > maximumShift) {
    return mapPhysicalToAudible(Math.sqrt(lowestPhysical * highestPhysical), "audible").shiftOctaves;
  }
  return Math.round(clampBlowhole(0, minimumShift, maximumShift));
}

function resolveStateAndCall(source) {
  if (typeof source === "string") {
    const state = createBlowholeState(source);
    return { state, call: blowholeCall(state.callId) };
  }
  const candidate = safeStateObject(source);
  const call = blowholeCall(candidate.callId);
  const state = sanitizeBlowholeState(candidate, {
    ...BLOWHOLE_DEFAULTS,
    ...call.controlDefaults,
    callId: call.id,
  });
  return { state, call };
}

/** Geometry values are normalized unless their unit is present in the key. */
export function deriveBlowholeGeometry(source = BLOWHOLE_DEFAULTS, phase = 0) {
  const { state, call } = resolveStateAndCall(source);
  const gesture = evaluateBlowholeGesture(call, phase, state);
  const nasal = call.sourceFamily === SOURCE_FAMILY.ODONTOCETE;
  const spermWhale = call.id === "sperm-whale-coda";
  const sideUnassigned = call.id === "orca-pulsed-call";
  const leftUnilateral = call.id === "bottlenose-signature-whistle";
  const rightUnilateral = spermWhale
    || call.id === "dolphin-search-clicks"
    || call.id === "dolphin-terminal-buzz";
  const leftWeight = Math.sqrt(clamp01((1 - gesture.asymmetryBipolar) * 0.5));
  const rightWeight = Math.sqrt(clamp01((1 + gesture.asymmetryBipolar) * 0.5));
  const opening = 1 - gesture.closure;
  const depthNormalized = clamp01(state.depthM / BLOWHOLE_LIMITS.depthM[1]);
  const mysticeteDepthExcess = nasal ? 0 : Math.max(0, state.depthM - 100);
  const depthDriveGain = nasal ? 1 : 1 / (1 + Math.pow(mysticeteDepthExcess / 180, 2));
  const internalPressure = gesture.pressure * depthDriveGain;
  return Object.freeze({
    sourceFamily: call.sourceFamily,
    blowholeCount: call.anatomy.blowholeCount,
    underwater: true,
    blowholeSealed: true,
    externalBlowholeSeal: 1,
    externalBlowholeAperture: 0,
    depthNormalized,
    depthDriveGain,
    bodyScale: clampBlowhole(0.72 + state.scale * 0.56, 0.72, 1.28),
    internalPressure,
    activeNasalSource: leftUnilateral
      ? "left"
      : rightUnilateral ? "right" : sideUnassigned ? "side-unassigned" : nasal ? "paired" : "none",
    phonicLipActiveCount: nasal ? (sideUnassigned || leftUnilateral || rightUnilateral ? 1 : 2) : 0,
    leftPhonicLipActive: nasal && !rightUnilateral && !sideUnassigned,
    rightPhonicLipActive: nasal && !leftUnilateral && !sideUnassigned,
    leftPhonicLipGap: nasal && !rightUnilateral && !sideUnassigned
      ? clamp01(opening * (0.45 + leftWeight * 0.55))
      : 0,
    rightPhonicLipGap: nasal && !leftUnilateral && !sideUnassigned
      ? clamp01(opening * (0.45 + rightWeight * 0.55))
      : 0,
    unassignedPhonicLipGap: sideUnassigned ? clamp01(opening * 0.72) : 0,
    nasalAirSacInflation: nasal ? clamp01(state.recycle * (0.25 + gesture.pressure * 0.75)) : 0,
    melonFocus: nasal && !spermWhale ? gesture.focus : 0,
    spermacetiCaseFocus: spermWhale ? gesture.focus : 0,
    junkRadiationFocus: spermWhale ? gesture.focus : 0,
    uFoldOpening: nasal ? 0 : opening,
    fatCushionContact: nasal ? 0 : gesture.closure,
    laryngealSacInflation: nasal
      ? 0
      : clamp01(state.recycle * depthDriveGain * (0.2 + gesture.pressure * 0.8)),
    tissueRadiationFocus: nasal ? gesture.focus * 0.35 : gesture.focus,
    sourceAsymmetry: gesture.asymmetryBipolar,
    roughness: gesture.roughness,
  });
}

export const blowholeGeometry = deriveBlowholeGeometry;

export function deriveBlowholeReadout(source = BLOWHOLE_DEFAULTS, phase = 0) {
  const { state, call } = resolveStateAndCall(source);
  const gesture = evaluateBlowholeGesture(call, phase, state);
  const audibleShiftOctaves = blowholeCallAudibleShift(call);
  const audibleFrequencyHz = clampBlowhole(
    gesture.physicalFrequencyHz * Math.pow(2, audibleShiftOctaves),
    ...BLOWHOLE_LIMITS.audibleFrequencyHz,
  );
  const monitorFrequencyHz = state.monitorMode === "physical"
    ? gesture.physicalFrequencyHz
    : audibleFrequencyHz;
  const geometry = deriveBlowholeGeometry(state, phase);
  return Object.freeze({
    callId: call.id,
    label: call.label,
    species: call.species,
    family: call.family,
    sourceFamily: call.sourceFamily,
    register: call.register,
    generator: call.anatomy.generator,
    resonator: call.anatomy.resonator,
    projector: call.anatomy.projector,
    blowholeStatus: call.anatomy.externalBlowhole,
    blowholeSealed: geometry.blowholeSealed,
    phase: gesture.phase,
    durationMs: call.durationMs,
    durationSeconds: call.durationMs / 1_000,
    depthM: state.depthM,
    ambientPressureKPa: clampBlowhole(101.325 + state.depthM * 10.06, 101.325, 40_000),
    physicalFrequencyHz: gesture.physicalFrequencyHz,
    audibleFrequencyHz,
    monitorFrequencyHz,
    monitorShiftOctaves: state.monitorMode === "physical" ? 0 : audibleShiftOctaves,
    pulseRateHz: gesture.pulseRateHz,
    pressure: gesture.pressure,
    closure: gesture.closure,
    focus: gesture.focus,
    asymmetry: gesture.asymmetryBipolar,
    roughness: gesture.roughness,
  });
}

export const blowholeReadout = deriveBlowholeReadout;

function freezeVoice(voice) {
  return Object.freeze({ ...voice });
}

/**
 * Compile controls into a declarative physical voice plan. This is a DSP
 * contract, not a sampled imitation: renderers may choose their oscillator,
 * impulse, waveguide, or filter implementation from these bounded values.
 */
export function createBlowholeVoicePlan(source = BLOWHOLE_DEFAULTS, phase = 0) {
  const { state, call } = resolveStateAndCall(source);
  const gesture = evaluateBlowholeGesture(call, phase, state);
  const nasal = call.sourceFamily === SOURCE_FAMILY.ODONTOCETE;
  const isClickSource = /click|buzz|coda/.test(call.register);
  const isPulsedCall = /pulsed/.test(call.register);
  const isTwoVoice = call.id === "humpback-two-voice-phrase";
  const isSpermWhale = call.id === "sperm-whale-coda";
  const isLeftUnilateral = call.id === "bottlenose-signature-whistle";
  const isRightUnilateral = isSpermWhale
    || call.id === "dolphin-search-clicks"
    || call.id === "dolphin-terminal-buzz";
  const balance = gesture.asymmetryBipolar;
  const leftWeight = Math.sqrt(clamp01((1 - balance) * 0.5));
  const rightWeight = Math.sqrt(clamp01((1 + balance) * 0.5));
  const amplitude = clamp01(state.level * gesture.pressure);
  const excitation = isClickSource
    ? "pressure-impulse-train"
    : isPulsedCall
      ? "self-oscillating-m1-pulse-register"
      : "self-oscillating-valve";
  const sourceNames = isSpermWhale
    ? ["single right phonic lips (museau de singe)"]
    : isPulsedCall
      ? ["phonic-lip M1 source (side not assigned)"]
    : isLeftUnilateral
      ? ["left phonic lips"]
      : isRightUnilateral
        ? ["right phonic lips"]
        : nasal
          ? ["left phonic lips", "right phonic lips"]
    : isTwoVoice
      ? ["U-fold / cricoid-cushion mode", "bilateral fold-to-fold regime"]
      : ["coupled U-fold / cricoid-cushion gap"];
  const primaryModeWeight = isTwoVoice ? 0.84 * (1 - balance * 0.45) : 1;
  const secondaryModeWeight = isTwoVoice ? 0.62 * (1 + balance * 0.45) : 0;
  const weights = isSpermWhale
    ? [1]
    : isPulsedCall
      ? [1]
    : isLeftUnilateral
      ? [1]
      : isRightUnilateral
        ? [1]
        : nasal
    ? [leftWeight, rightWeight]
    : [primaryModeWeight, secondaryModeWeight];
  const voiceCount = blowholeCallVoiceCount(call);
  const pairDetune = voiceCount > 1 ? balance * (nasal ? 0.022 : 0.04) : 0;
  const physicalFrequenciesHz = Array.from({ length: voiceCount }, (_, index) => (
    clampBlowhole(
      gesture.physicalFrequencyHz
        * (call.voiceRatios[index] ?? 1)
        * (index === 0 ? 1 - pairDetune : 1 + pairDetune),
      BLOWHOLE_LIMITS.physicalFrequencyHz[0],
      BLOWHOLE_LIMITS.physicalFrequencyHz[1],
    )
  ));
  const audibleShiftOctaves = blowholeCallAudibleShift(call);
  const audibleRatio = Math.pow(2, audibleShiftOctaves);
  const monitorRatio = state.monitorMode === "physical" ? 1 : audibleRatio;
  const audibleFrequencyHz = clampBlowhole(
    physicalFrequenciesHz[0] * audibleRatio,
    ...BLOWHOLE_LIMITS.audibleFrequencyHz,
  );
  const monitorFrequencyHz = state.monitorMode === "physical"
    ? physicalFrequenciesHz[0]
    : audibleFrequencyHz;
  const voices = [];
  for (let index = 0; index < voiceCount; index += 1) {
    const physicalFrequencyHz = physicalFrequenciesHz[index];
    voices.push(freezeVoice({
      id: index === 0 ? "primary" : "secondary",
      anatomicalSource: sourceNames[index],
      excitation,
      physicalFrequencyHz,
      monitorFrequencyHz: physicalFrequencyHz * monitorRatio,
      gain: clamp01(amplitude * weights[index]),
      pulseRateHz: gesture.pulseRateHz,
      closure: gesture.closure,
      roughness: gesture.roughness,
      phaseOffsetCycles: index === 0 ? 0 : clamp01(0.25 + Math.abs(balance) * 0.2),
      bandwidthHz: clampBlowhole(
        physicalFrequencyHz * (0.012 + gesture.roughness * (isClickSource ? 1.4 : 0.18)),
        0.1,
        180_000,
      ),
    }));
  }
  const eventTimesSeconds = Object.freeze(call.pulseTimes.map((eventPhase) => (
    clampBlowhole(eventPhase * call.durationMs / 1_000, 0, call.durationMs / 1_000)
  )));
  return Object.freeze({
    callId: call.id,
    family: call.family,
    sourceFamily: call.sourceFamily,
    register: call.register,
    monitorMode: state.monitorMode,
    underwater: true,
    blowholeSealed: true,
    externalBlowholeAperture: 0,
    sourcePath: call.sourcePath,
    generatorType: isSpermWhale
      ? "single-right-phonic-lips"
      : isPulsedCall
        ? "side-unspecified-phonic-lip-m1-register"
      : isLeftUnilateral
        ? "single-left-phonic-lips"
        : isRightUnilateral
          ? "single-right-phonic-lips"
      : nasal
        ? "paired-phonic-lips"
        : isTwoVoice
          ? "fold-to-fat-plus-bilateral-fold-to-fold-reduction"
          : "coupled-u-fold-cricoid-cushion-gap",
    resonatorType: isSpermWhale
      ? "spermaceti-case-bent-horn"
      : nasal ? "nasal-air-sac-reflector" : "laryngeal-sac-tissue-coupler",
    radiatorType: isSpermWhale
      ? "junk-terminal-acoustic-window"
      : nasal ? "melon-directivity-filter" : "body-tissue-radiator",
    durationSeconds: call.durationMs / 1_000,
    phase: gesture.phase,
    physicalFrequencyHz: gesture.physicalFrequencyHz,
    audibleFrequencyHz,
    monitorFrequencyHz,
    audibleShiftOctaves,
    monitorShiftOctaves: state.monitorMode === "physical" ? 0 : audibleShiftOctaves,
    pulseRateHz: gesture.pulseRateHz,
    pulseWidthMicroseconds: isClickSource
      ? clampBlowhole(8 + (1 - gesture.closure) * 92, 8, 100)
      : 0,
    pulseTimes: call.pulseTimes,
    eventTimesSeconds,
    recycledAir: nasal ? state.recycle : 0,
    laryngealSacCoupling: nasal ? 0 : state.recycle,
    headReflectionDelaySeconds: isSpermWhale ? 0.0025 + state.scale * 0.006 : 0,
    focus: gesture.focus,
    level: state.level,
    voices: Object.freeze(voices),
  });
}

export const physicalVoicePlan = createBlowholeVoicePlan;

function seedToUint32(seed) {
  if (typeof seed !== "symbol") {
    try {
      const numericSeed = Number(seed);
      if (Number.isFinite(numericSeed)) {
        return (Math.trunc(numericSeed) >>> 0) || 0x6d2b79f5;
      }
    } catch {
      // Fall through to stable text hashing.
    }
  }
  let text = "blowhole";
  try {
    text = typeof seed === "string" ? seed : String(seed ?? "blowhole");
  } catch {
    // Retain the fixed fallback for hostile coercion objects.
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x6d2b79f5;
}

/** A small repeatable PRNG; equal seeds yield equal cross-platform sequences. */
export function createBlowholeRandom(seed = 1) {
  let state = seedToUint32(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Deterministically vary a state without mutating it or changing the selected
 * call/monitor mode. The selected call constrains its meaningful pulse rate.
 */
export function randomizeBlowholeState(source = BLOWHOLE_DEFAULTS, seed = 1) {
  const current = typeof source === "string"
    ? createBlowholeState(source)
    : sanitizeBlowholeState(source);
  const call = blowholeCall(current.callId);
  const random = createBlowholeRandom(seed);
  const between = (minimum, maximum) => mix(minimum, maximum, random());
  const pulseRange = call.physicalRange.pulseRateHz;
  const pulseRateHz = pulseRange[1] > 0
    ? between(pulseRange[0], pulseRange[1])
    : 0;
  return sanitizeBlowholeState({
    callId: current.callId,
    pressure: between(0.38, 0.98),
    tension: between(0.16, 0.88),
    closure: between(0.34, 0.97),
    asymmetry: between(-0.72, 0.72),
    recycle: between(0.34, 0.99),
    focus: between(0.28, 0.99),
    scale: between(0.14, 0.94),
    roughness: between(0.01, 0.58),
    pulseRateHz,
    depthM: between(0, Math.min(1_500, BLOWHOLE_LIMITS.depthM[1])),
    monitorMode: current.monitorMode,
    level: between(0.28, 0.88),
  }, current);
}
