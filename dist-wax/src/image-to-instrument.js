/**
 * Pure model helpers for the three eight-petal Image-to-Instrument studies.
 *
 * The returned audio objects follow src/audio.js' VoiceSpec contract, but this
 * module deliberately does not import or construct any browser/audio runtime.
 */

export const PETAL_COUNT = 8;

const TAU = Math.PI * 2;
const DEFAULT_ROTATION = -Math.PI / 2;
const CONTINUOUS_GAIN_CEILING = 0.72;
const STRIKE_GAIN_CEILING = 0.72;

export const IMAGE_TO_INSTRUMENT_LIMITS = Object.freeze({
  rootMidi: Object.freeze({ minimum: 24, maximum: 96 }),
  level: Object.freeze({ minimum: 0, maximum: 0.82 }),
  interval: Object.freeze({ minimum: -36, maximum: 36 }),
  ratchets: Object.freeze({ minimum: 1, maximum: 4 }),
  tempoBpm: Object.freeze({ minimum: 48, maximum: 220 }),
  swing: Object.freeze({ minimum: 0, maximum: 0.45 }),
  frequency: Object.freeze({ minimum: 20, maximum: 16_000 }),
  continuousGain: CONTINUOUS_GAIN_CEILING,
  strikeGain: STRIKE_GAIN_CEILING,
});

export const IMAGE_TO_INSTRUMENT_VARIANTS = Object.freeze([
  Object.freeze({
    id: "image-to-instrument-1",
    variant: "radial-choir",
    name: "Image-to-Instrument 1",
    label: "Radial Choir",
  }),
  Object.freeze({
    id: "image-to-instrument-2",
    variant: "signal-router",
    name: "Image-to-Instrument 2",
    label: "Signal Router",
  }),
  Object.freeze({
    id: "image-to-instrument-3",
    variant: "mouthwheel-sequencer",
    name: "Wheel of Organs",
    label: "Lettered Formant Organism",
  }),
]);

const VARIANT_ALIASES = new Map([
  ["1", "radial-choir"],
  ["image-to-instrument-1", "radial-choir"],
  ["radial-choir", "radial-choir"],
  ["choir", "radial-choir"],
  ["2", "signal-router"],
  ["image-to-instrument-2", "signal-router"],
  ["signal-router", "signal-router"],
  ["router", "signal-router"],
  ["3", "mouthwheel-sequencer"],
  ["image-to-instrument-3", "mouthwheel-sequencer"],
  ["mouthwheel-sequencer", "mouthwheel-sequencer"],
  ["mouthwheel", "mouthwheel-sequencer"],
  ["sequencer", "mouthwheel-sequencer"],
  ["wheel-of-organs", "mouthwheel-sequencer"],
  ["wheel", "mouthwheel-sequencer"],
]);

const VARIANT_DEFAULTS = Object.freeze({
  "radial-choir": Object.freeze({
    rootMidi: 48,
    level: 0.68,
    centerA: 0.44,
    centerB: 0.31,
    rate: (0.22 - 0.04) / (1.2 - 0.04),
    spread: 0.86,
    intervals: Object.freeze([-12, -5, 0, 3, 7, 10, 12, 19]),
  }),
  "signal-router": Object.freeze({
    rootMidi: 43,
    level: 0.72,
    centerA: 0.28,
    centerB: 0.56,
    rate: (1.2 - 0.2) / (4 - 0.2),
    spread: 0.92,
    intervals: Object.freeze([0, 7, 12, 19, 24, 31, 36, 29]),
  }),
  "mouthwheel-sequencer": Object.freeze({
    rootMidi: 36,
    level: 0.7,
    centerA: 0.18,
    centerB: 0.38,
    rate: (112 - 48) / (220 - 48),
    spread: 0.78,
    intervals: Object.freeze([0, 7, 3, 10, 5, 12, -2, 15]),
  }),
});

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Clamp numeric input, including numeric strings, with a finite fallback. */
export function clamp(value, minimum = 0, maximum = 1, fallback = minimum) {
  let low = finiteNumber(minimum, 0);
  let high = finiteNumber(maximum, low);
  if (high < low) [low, high] = [high, low];
  const safeFallback = Math.min(high, Math.max(low, finiteNumber(fallback, low)));
  return Math.min(high, Math.max(low, finiteNumber(value, safeFallback)));
}

function clampInteger(value, minimum, maximum, fallback = minimum) {
  return Math.round(clamp(value, minimum, maximum, fallback));
}

function wrap(value, modulus) {
  const safeModulus = Math.max(1, Math.trunc(finiteNumber(modulus, 1)));
  const safeValue = Math.trunc(finiteNumber(value, 0));
  return ((safeValue % safeModulus) + safeModulus) % safeModulus;
}

function wrap01(value) {
  const number = finiteNumber(value, 0);
  return ((number % 1) + 1) % 1;
}

/** Resolve numeric, public-id, and short-name aliases to a variant slug. */
export function resolveImageInstrumentVariant(value = "radial-choir") {
  const key = String(value ?? "").trim().toLowerCase();
  return VARIANT_ALIASES.get(key) ?? "radial-choir";
}

function defaultPetal(variant, index) {
  const defaults = VARIANT_DEFAULTS[variant];
  const sequencer = variant === "mouthwheel-sequencer";
  const router = variant === "signal-router";
  const emphasis = clamp(0.76 + 0.14 * Math.sin(index * 2.19), 0.38, 0.92);
  return {
    active: sequencer
      ? ![2, 5, 7].includes(index)
      : router
        ? ![2, 5, 7].includes(index)
        : true,
    aperture: clamp(0.62 + 0.17 * Math.sin(index * 1.71), 0.18, 0.82),
    tongue: clamp(0.5 + 0.22 * Math.sin(index * 1.37), 0.16, 0.84),
    emphasis,
    interval: defaults.intervals[index],
    probability: sequencer ? emphasis : 1,
    ratchets: sequencer && index === 6 ? 2 : 1,
  };
}

/** Create a fresh, deterministic, editable control patch. */
export function createDefaultPatch(variant = "radial-choir") {
  const safeVariant = resolveImageInstrumentVariant(variant);
  const defaults = VARIANT_DEFAULTS[safeVariant];
  return {
    variant: safeVariant,
    rootMidi: defaults.rootMidi,
    level: defaults.level,
    centerA: defaults.centerA,
    centerB: defaults.centerB,
    rate: defaults.rate,
    spread: defaults.spread,
    petals: Array.from(
      { length: PETAL_COUNT },
      (_, index) => defaultPetal(safeVariant, index),
    ),
  };
}

function sanitizePetal(source, fallback) {
  const petal = source && typeof source === "object" ? source : {};
  return {
    active: petal.active === undefined ? fallback.active : Boolean(petal.active),
    aperture: clamp(petal.aperture, 0, 1, fallback.aperture),
    tongue: clamp(petal.tongue, 0, 1, fallback.tongue),
    emphasis: clamp(petal.emphasis, 0, 1, fallback.emphasis),
    interval: clamp(
      petal.interval,
      IMAGE_TO_INSTRUMENT_LIMITS.interval.minimum,
      IMAGE_TO_INSTRUMENT_LIMITS.interval.maximum,
      fallback.interval,
    ),
    probability: clamp(petal.probability, 0, 1, fallback.probability),
    ratchets: clampInteger(
      petal.ratchets,
      IMAGE_TO_INSTRUMENT_LIMITS.ratchets.minimum,
      IMAGE_TO_INSTRUMENT_LIMITS.ratchets.maximum,
      fallback.ratchets,
    ),
  };
}

/** Clone and bound an externally supplied patch without retaining references. */
export function sanitizeImageInstrumentPatch(patch = {}, variantHint) {
  const source = patch && typeof patch === "object" ? patch : {};
  const variant = resolveImageInstrumentVariant(variantHint ?? source.variant);
  const fallback = createDefaultPatch(variant);
  const petals = Array.isArray(source.petals) ? source.petals : [];
  return {
    variant,
    rootMidi: clamp(
      source.rootMidi,
      IMAGE_TO_INSTRUMENT_LIMITS.rootMidi.minimum,
      IMAGE_TO_INSTRUMENT_LIMITS.rootMidi.maximum,
      fallback.rootMidi,
    ),
    level: clamp(
      source.level,
      IMAGE_TO_INSTRUMENT_LIMITS.level.minimum,
      IMAGE_TO_INSTRUMENT_LIMITS.level.maximum,
      fallback.level,
    ),
    centerA: clamp(source.centerA, 0, 1, fallback.centerA),
    centerB: clamp(source.centerB, 0, 1, fallback.centerB),
    rate: clamp(source.rate, 0, 1, fallback.rate),
    spread: clamp(source.spread, 0, 1, fallback.spread),
    petals: fallback.petals.map((petal, index) => (
      sanitizePetal(petals[index], petal)
    )),
  };
}

/** Create fresh patch controls plus the small amount of runtime UI state. */
export function createDefaultImageInstrumentState(variant = "radial-choir") {
  return {
    ...createDefaultPatch(variant),
    running: false,
    phase: 0,
    selectedPetal: 0,
  };
}

/** Bound state restored from persistence or supplied by an embedding app. */
export function sanitizeImageInstrumentState(state = {}, variantHint) {
  const source = state && typeof state === "object" ? state : {};
  const patch = sanitizeImageInstrumentPatch(source, variantHint);
  const selected = Number(source.selectedPetal);
  return {
    ...patch,
    running: Boolean(source.running),
    phase: wrap01(source.phase),
    selectedPetal: Number.isInteger(selected) && selected >= 0 && selected < PETAL_COUNT
      ? selected
      : null,
  };
}

/** Alias for callers that use the shorter state-factory name. */
export const createDefaultState = createDefaultImageInstrumentState;

/**
 * Build an eight-lobed, canvas-ready layout. Petal radii are ellipse radii:
 * radialRadius runs along the spoke and tangentialRadius runs across it.
 */
export function radialPetalLayout(width = 1, height = 1, options = {}) {
  const safeWidth = clamp(width, 1e-6, 1_000_000, 1);
  const safeHeight = clamp(height, 1e-6, 1_000_000, 1);
  const size = Math.min(safeWidth, safeHeight);
  const source = options && typeof options === "object" ? options : {};
  const centerX = clamp(source.centerX, 0, safeWidth, safeWidth / 2);
  const centerY = clamp(source.centerY, 0, safeHeight, safeHeight / 2);
  const coreRadius = clamp(source.coreRadius, size * 0.04, size * 0.3, size * 0.105);
  const ringRadius = clamp(source.ringRadius, coreRadius, size * 0.42, size * 0.275);
  const radialRadius = clamp(
    source.radialRadius ?? source.petalLength / 2,
    size * 0.04,
    size * 0.28,
    size * 0.185,
  );
  const tangentialRadius = clamp(
    source.tangentialRadius ?? source.petalWidth / 2,
    size * 0.03,
    size * 0.22,
    size * 0.118,
  );
  const rotation = finiteNumber(source.rotation, DEFAULT_ROTATION);
  const petals = Array.from({ length: PETAL_COUNT }, (_, index) => {
    const angle = rotation + index * TAU / PETAL_COUNT;
    const radialX = Math.cos(angle);
    const radialY = Math.sin(angle);
    return {
      index,
      angle,
      rotation: angle,
      x: centerX + radialX * ringRadius,
      y: centerY + radialY * ringRadius,
      centerX: centerX + radialX * ringRadius,
      centerY: centerY + radialY * ringRadius,
      radialRadius,
      tangentialRadius,
      pan: clamp(radialX, -1, 1),
    };
  });
  return {
    width: safeWidth,
    height: safeHeight,
    centerX,
    centerY,
    coreRadius,
    ringRadius,
    radialRadius,
    tangentialRadius,
    rotation,
    petals,
  };
}

/** Alias that reads naturally beside the state factory. */
export const createRadialPetalLayout = radialPetalLayout;

function localPetalCoordinates(point, petal, padding = 0) {
  const safePoint = point && typeof point === "object" ? point : {};
  const x = finiteNumber(safePoint.x, petal.centerX);
  const y = finiteNumber(safePoint.y, petal.centerY);
  const dx = x - petal.centerX;
  const dy = y - petal.centerY;
  const cosine = Math.cos(petal.angle);
  const sine = Math.sin(petal.angle);
  const safePadding = Math.max(0, finiteNumber(padding, 0));
  const radialRadius = Math.max(1e-9, petal.radialRadius + safePadding);
  const tangentialRadius = Math.max(1e-9, petal.tangentialRadius + safePadding);
  const radial = (dx * cosine + dy * sine) / radialRadius;
  const tangential = (-dx * sine + dy * cosine) / tangentialRadius;
  return {
    radial,
    tangential,
    distance: Math.hypot(radial, tangential),
  };
}

/** Return the nearest ellipse hit as a petal index, or null outside all petals. */
export function hitTestRadialPetal(point, layout, padding = 0) {
  const petals = Array.isArray(layout) ? layout : layout?.petals;
  if (!Array.isArray(petals)) return null;
  let winner = null;
  let bestDistance = Infinity;
  for (const petal of petals) {
    if (!petal || !Number.isInteger(petal.index)) continue;
    const local = localPetalCoordinates(point, petal, padding);
    if (local.distance <= 1 && local.distance < bestDistance) {
      winner = petal.index;
      bestDistance = local.distance;
    }
  }
  return winner;
}

/**
 * Map a point in one lobe to the three anatomical controls. Supplying the full
 * layout performs a hit test; supplying one petal maps directly to that petal.
 */
export function mapPetalGesture(point, petalLayout, options = {}) {
  const source = point && typeof point === "object" ? point : {};
  const petals = Array.isArray(petalLayout) ? petalLayout : petalLayout?.petals;
  let petal = null;
  if (Array.isArray(petals)) {
    const requested = Number(source.petalIndex);
    const index = Number.isInteger(requested)
      ? wrap(requested, PETAL_COUNT)
      : hitTestRadialPetal(source, petals, options.hitPadding);
    petal = index === null ? null : petals.find((candidate) => candidate?.index === index);
  } else if (petalLayout && Number.isInteger(petalLayout.index)) {
    petal = petalLayout;
  }
  if (!petal) return null;

  const local = localPetalCoordinates(source, petal);
  const fallbackEmphasis = clamp(options.defaultEmphasis, 0, 1, 0.72);
  const pressure = source.pressure ?? source.force ?? source.emphasis;
  return {
    petalIndex: petal.index,
    aperture: clamp((local.radial + 1) / 2),
    tongue: clamp((local.tangential + 1) / 2),
    emphasis: clamp(pressure, 0, 1, fallbackEmphasis),
    radial: clamp(local.radial, -1, 1),
    tangential: clamp(local.tangential, -1, 1),
    inside: local.distance <= 1,
  };
}

export function midiToFrequency(midiNote) {
  const midi = clamp(midiNote, -48, 180, 69);
  return clamp(
    440 * (2 ** ((midi - 69) / 12)),
    IMAGE_TO_INSTRUMENT_LIMITS.frequency.minimum,
    IMAGE_TO_INSTRUMENT_LIMITS.frequency.maximum,
    440,
  );
}

function panForPetal(index, spread) {
  const angle = DEFAULT_ROTATION + wrap(index, PETAL_COUNT) * TAU / PETAL_COUNT;
  return clamp(Math.cos(angle) * spread, -1, 1);
}

function normalizeRmsGains(voices, ceiling = CONTINUOUS_GAIN_CEILING) {
  const safeCeiling = clamp(ceiling, 0, 1, CONTINUOUS_GAIN_CEILING);
  const combined = Math.sqrt(voices.reduce((sum, voice) => sum + voice.gain ** 2, 0));
  const scale = combined > safeCeiling && combined > 0 ? safeCeiling / combined : 1;
  return voices.map((voice) => ({ ...voice, gain: voice.gain * scale }));
}

function normalizePeakGains(voices, ceiling = STRIKE_GAIN_CEILING) {
  const safeCeiling = clamp(ceiling, 0, 1, STRIKE_GAIN_CEILING);
  const combined = voices.reduce((sum, voice) => sum + voice.gain, 0);
  const scale = combined > safeCeiling && combined > 0 ? safeCeiling / combined : 1;
  return voices.map((voice) => ({ ...voice, gain: voice.gain * scale }));
}

/** Eight stable continuous FM VoiceSpecs for the radial choir's open petals. */
export function createChoirVoiceSpecs(state = createDefaultImageInstrumentState()) {
  const safe = sanitizeImageInstrumentState(
    { ...(state && typeof state === "object" ? state : {}), variant: "radial-choir" },
    "radial-choir",
  );
  const raw = [];
  for (let index = 0; index < PETAL_COUNT; index += 1) {
    const petal = safe.petals[index];
    if (!petal.active) continue;
    const vibratoSemitones = Math.sin(TAU * (safe.phase + index / PETAL_COUNT))
      * safe.rate * 0.16;
    raw.push({
      key: `image-choir-petal-${index}`,
      frequency: midiToFrequency(safe.rootMidi + petal.interval + vibratoSemitones),
      gain: safe.level
        * (0.2 + 0.8 * petal.emphasis)
        * (0.34 + 0.66 * petal.aperture),
      pan: panForPetal(index, safe.spread),
      waveform: "sine",
      mode: "fm",
      synthDrive: clamp(safe.centerA * (0.55 + 0.45 * petal.emphasis)),
      modulationIndex: clamp(0.3 + 8.2 * safe.centerB * petal.tongue, 0, 20),
      modulationRatio: clamp(0.5 + 2.5 * petal.tongue, 0.125, 16),
      gainSmoothingSeconds: clamp(0.012 + (1 - safe.rate) * 0.028, 0.002, 0.08),
    });
  }
  return normalizeRmsGains(raw);
}

function pulseGateAt(pulse, index) {
  const gates = pulse?.routeGates ?? pulse?.routes;
  if (!Array.isArray(gates)) return 1;
  const gate = gates[index];
  if (gate && typeof gate === "object") {
    if (gate.active === false || gate.enabled === false) return 0;
    return clamp(gate.gate ?? gate.level ?? 1);
  }
  if (typeof gate === "boolean") return gate ? 1 : 0;
  return clamp(gate, 0, 1, 0);
}

function chanceAt(pulse, index) {
  const chances = pulse?.chances ?? pulse?.randomValues;
  if (Array.isArray(chances)) return clamp(chances[index], 0, 1, 0);
  return clamp(pulse?.chance, 0, 1, 0);
}

function requestedRouteAllows(pulse, index) {
  if (!Array.isArray(pulse?.routeIndices)) return true;
  return pulse.routeIndices.some((routeIndex) => Number(routeIndex) === index);
}

/** Build peak-safe routed pulse VoiceSpecs; closed routes are omitted. */
export function createRouterPulseSpecs(
  state = createDefaultImageInstrumentState("signal-router"),
  pulse = {},
) {
  const safe = sanitizeImageInstrumentState(
    { ...(state && typeof state === "object" ? state : {}), variant: "signal-router" },
    "signal-router",
  );
  const source = pulse && typeof pulse === "object" ? pulse : {};
  const energy = clamp(source.energy ?? source.emphasis, 0, 1, 1);
  if (energy <= 0) return [];
  const sourcePetal = Number.isInteger(Number(source.sourcePetal))
    ? wrap(Number(source.sourcePetal), PETAL_COUNT)
    : safe.selectedPetal ?? 0;
  const raw = [];
  for (let index = 0; index < PETAL_COUNT; index += 1) {
    const petal = safe.petals[index];
    const gate = pulseGateAt(source, index);
    if (
      !petal.active
      || gate <= 0
      || petal.probability <= chanceAt(source, index)
      || !requestedRouteAllows(source, index)
    ) continue;
    const hops = Math.min(
      wrap(index - sourcePetal, PETAL_COUNT),
      wrap(sourcePetal - index, PETAL_COUNT),
    );
    raw.push({
      key: `image-router-${sourcePetal}-to-${index}`,
      frequency: midiToFrequency(safe.rootMidi + petal.interval + hops * safe.centerB * 0.35),
      gain: safe.level * energy * gate
        * (0.18 + 0.82 * petal.emphasis)
        * (0.45 + 0.55 * petal.aperture),
      pan: panForPetal(index, safe.spread),
      waveform: index % 2 ? "triangle" : "sine",
      mode: "fm",
      synthDrive: clamp(safe.centerA * (0.45 + 0.55 * energy)),
      modulationIndex: clamp(0.5 + 10 * petal.tongue * safe.centerB, 0, 20),
      modulationRatio: clamp(0.75 + 2.25 * petal.tongue, 0.125, 16),
      gainSmoothingSeconds: 0.004,
    });
  }
  return normalizePeakGains(raw);
}

/** Alias for apps that describe the router output directly as voices. */
export const createRouterVoiceSpecs = createRouterPulseSpecs;

/**
 * Wrap router voices in the two arguments consumed by audio.strike().
 * Each item is `{ routeIndex, sourcePetal, voice, envelope }`.
 */
export function createRouterStrikeSpecs(state, pulse = {}) {
  const safe = sanitizeImageInstrumentState(
    { ...(state && typeof state === "object" ? state : {}), variant: "signal-router" },
    "signal-router",
  );
  const sourcePetal = Number.isInteger(Number(pulse?.sourcePetal))
    ? wrap(Number(pulse.sourcePetal), PETAL_COUNT)
    : safe.selectedPetal ?? 0;
  return createRouterPulseSpecs(safe, pulse).map((voice) => {
    const routeIndex = clampInteger(
      voice.key.split("-").at(-1),
      0,
      PETAL_COUNT - 1,
      0,
    );
    const petal = safe.petals[routeIndex];
    const hops = Math.min(
      wrap(routeIndex - sourcePetal, PETAL_COUNT),
      wrap(sourcePetal - routeIndex, PETAL_COUNT),
    );
    return {
      routeIndex,
      sourcePetal,
      voice,
      envelope: {
        attackSeconds: clamp(0.002 + (1 - petal.emphasis) * 0.006, 0.002, 0.02),
        decaySeconds: clamp(0.055 + petal.aperture * 0.22, 0.04, 0.36),
        attackNoise: clamp(petal.tongue * safe.centerA * 0.12),
        startDelaySeconds: clamp(hops * safe.spread * 0.008, 0, 0.05),
        retriggerMode: "crossfade",
      },
    };
  });
}

/** Convert the model's normalized Rate control to the wheel's labelled BPM. */
export function sequencerTempoBpm(stateOrRate = (112 - 48) / (220 - 48)) {
  const rate = stateOrRate && typeof stateOrRate === "object"
    ? stateOrRate.rate
    : stateOrRate;
  const normalized = clamp(rate, 0, 1, (112 - 48) / (220 - 48));
  const { minimum, maximum } = IMAGE_TO_INSTRUMENT_LIMITS.tempoBpm;
  return minimum + normalized * (maximum - minimum);
}

/** Advance (or rewind) around the fixed eight-step wheel. */
export function advanceSequencerStep(step, amount = 1) {
  return wrap(
    Math.trunc(finiteNumber(step, 0)) + Math.trunc(finiteNumber(amount, 1)),
    PETAL_COUNT,
  );
}

/** Long/short swing keeps every adjacent pair exactly two straight steps long. */
export function sequencerStepDurationSeconds(tempoBpm, swing = 0, absoluteStep = 0) {
  const limits = IMAGE_TO_INSTRUMENT_LIMITS.tempoBpm;
  const tempo = clamp(tempoBpm, limits.minimum, limits.maximum, 110);
  const safeSwing = clamp(
    swing,
    IMAGE_TO_INSTRUMENT_LIMITS.swing.minimum,
    IMAGE_TO_INSTRUMENT_LIMITS.swing.maximum,
    0,
  );
  const straight = 30 / tempo;
  return straight * (Math.abs(Math.trunc(finiteNumber(absoluteStep, 0))) % 2
    ? 1 - safeSwing
    : 1 + safeSwing);
}

/**
 * Create deterministic step events. `hits` contains ratchet subdivisions; no
 * timers or clocks are read here, so the caller owns all real-time scheduling.
 */
export function createSequencerSchedule(
  state = createDefaultImageInstrumentState("mouthwheel-sequencer"),
  options = {},
) {
  const sourceState = state && typeof state === "object" ? state : {};
  const safe = sanitizeImageInstrumentState(
    { ...sourceState, variant: "mouthwheel-sequencer" },
    "mouthwheel-sequencer",
  );
  const source = options && typeof options === "object" ? options : {};
  const tempoBpm = clamp(
    source.tempoBpm ?? sourceState.tempoBpm,
    IMAGE_TO_INSTRUMENT_LIMITS.tempoBpm.minimum,
    IMAGE_TO_INSTRUMENT_LIMITS.tempoBpm.maximum,
    sequencerTempoBpm(safe),
  );
  const swing = clamp(
    source.swing ?? sourceState.swing,
    IMAGE_TO_INSTRUMENT_LIMITS.swing.minimum,
    IMAGE_TO_INSTRUMENT_LIMITS.swing.maximum,
    safe.centerA,
  );
  const startTime = finiteNumber(source.startTime, 0);
  const startStep = advanceSequencerStep(source.startStep ?? safe.selectedPetal ?? 0, 0);
  const stepCount = clampInteger(source.stepCount, 0, 512, PETAL_COUNT);
  const chanceValues = Array.isArray(source.chanceValues) ? source.chanceValues : [];
  const events = [];
  let time = startTime;
  for (let order = 0; order < stepCount; order += 1) {
    const stepIndex = advanceSequencerStep(startStep, order);
    const petal = safe.petals[stepIndex];
    const absoluteStep = Math.trunc(finiteNumber(source.absoluteStep, startStep)) + order;
    const durationSeconds = sequencerStepDurationSeconds(tempoBpm, swing, absoluteStep);
    const chance = clamp(chanceValues[order], 0, 1, 0);
    const active = petal.active && petal.probability > chance;
    const ratchets = active ? petal.ratchets : 0;
    const hitSpan = durationSeconds / Math.max(1, ratchets);
    const hits = Array.from({ length: ratchets }, (_, ratchetIndex) => ({
      stepIndex,
      ratchetIndex,
      time: time + ratchetIndex * hitSpan,
      durationSeconds: hitSpan,
      velocity: clamp(petal.emphasis * (1 - ratchetIndex * 0.08), 0, 1),
    }));
    events.push({
      order,
      absoluteStep,
      stepIndex,
      time,
      durationSeconds,
      active,
      probability: petal.probability,
      ratchets,
      hits,
    });
    time += durationSeconds;
  }
  return events;
}

/** Return the peak-safe VoiceSpecs for one mouthwheel hit. */
export function createSequencerStepVoiceSpecs(
  state = createDefaultImageInstrumentState("mouthwheel-sequencer"),
  stepOrEvent = 0,
  options = {},
) {
  const safe = sanitizeImageInstrumentState(
    { ...(state && typeof state === "object" ? state : {}), variant: "mouthwheel-sequencer" },
    "mouthwheel-sequencer",
  );
  const event = stepOrEvent && typeof stepOrEvent === "object" ? stepOrEvent : {};
  const source = options && typeof options === "object" ? options : {};
  const stepIndex = advanceSequencerStep(
    event.stepIndex ?? stepOrEvent ?? safe.selectedPetal ?? 0,
    0,
  );
  const petal = safe.petals[stepIndex];
  const chance = clamp(source.chance ?? event.chance, 0, 1, 0);
  if (!petal.active || petal.probability <= chance) return [];
  const velocity = clamp(source.velocity ?? event.velocity, 0, 1, petal.emphasis);
  if (velocity <= 0) return [];
  const ratchetIndex = clampInteger(
    source.ratchetIndex ?? event.ratchetIndex,
    0,
    IMAGE_TO_INSTRUMENT_LIMITS.ratchets.maximum - 1,
    0,
  );
  const frequency = midiToFrequency(safe.rootMidi + petal.interval);
  const commonGain = safe.level * velocity * (0.5 + 0.5 * petal.aperture)
    * (1 - ratchetIndex * 0.07);
  return normalizePeakGains([
    {
      key: `image-mouthwheel-${stepIndex}-${ratchetIndex}-body`,
      frequency,
      gain: commonGain * 0.74,
      pan: panForPetal(stepIndex, safe.spread),
      waveform: "sine",
      mode: "fm",
      synthDrive: clamp(safe.centerB * velocity),
      modulationIndex: clamp(0.4 + 9 * petal.tongue * safe.centerB, 0, 20),
      modulationRatio: clamp(0.75 + 2 * petal.tongue, 0.125, 16),
      gainSmoothingSeconds: 0.004,
    },
    {
      key: `image-mouthwheel-${stepIndex}-${ratchetIndex}-formant`,
      frequency: clamp(
        frequency * (1.5 + petal.tongue * 1.5),
        IMAGE_TO_INSTRUMENT_LIMITS.frequency.minimum,
        IMAGE_TO_INSTRUMENT_LIMITS.frequency.maximum,
        frequency,
      ),
      gain: commonGain * (0.12 + petal.tongue * 0.2),
      pan: panForPetal(stepIndex, safe.spread * 0.82),
      waveform: "triangle",
      mode: "fm",
      synthDrive: clamp(safe.centerB * velocity),
      modulationIndex: clamp(0.2 + 4.5 * petal.aperture, 0, 20),
      modulationRatio: clamp(1 + petal.tongue * 2.5, 0.125, 16),
      gainSmoothingSeconds: 0.004,
    },
  ]);
}

/**
 * Wrap one mouthwheel hit in audio.strike() arguments. Each returned item is
 * `{ stepIndex, ratchetIndex, voice, envelope }`.
 */
export function createSequencerStepStrikeSpecs(state, stepOrEvent = 0, options = {}) {
  const event = stepOrEvent && typeof stepOrEvent === "object" ? stepOrEvent : {};
  const source = options && typeof options === "object" ? options : {};
  const stepIndex = advanceSequencerStep(event.stepIndex ?? stepOrEvent ?? 0, 0);
  const ratchetIndex = clampInteger(
    source.ratchetIndex ?? event.ratchetIndex,
    0,
    IMAGE_TO_INSTRUMENT_LIMITS.ratchets.maximum - 1,
    0,
  );
  const durationSeconds = clamp(
    source.durationSeconds ?? event.durationSeconds,
    0.025,
    1,
    0.14,
  );
  return createSequencerStepVoiceSpecs(state, event.stepIndex === undefined
    ? stepIndex
    : event, { ...source, ratchetIndex }).map((voice) => ({
    stepIndex,
    ratchetIndex,
    voice,
    envelope: {
      attackSeconds: clamp(0.002 + (1 - voice.synthDrive) * 0.006, 0.002, 0.02),
      decaySeconds: clamp(durationSeconds * 0.72, 0.025, 0.36),
      attackNoise: clamp(voice.modulationIndex / 20 * 0.08),
      startDelaySeconds: clamp(source.startDelaySeconds, 0, 0.05, 0),
      retriggerMode: "crossfade",
    },
  }));
}
