// Original SPARTIAL registrations and additive pipe approximations.
// Research/provenance: docs/spartial-organ-research.md. No sampled pipe or
// tonewheel recordings, copied manufacturer presets, or cabinet impulse files.
export const SPARTIAL_ORGAN_PARTIALS = 32;

export const SPARTIAL_ORGAN_STOPS = Object.freeze([
  ["16", "16′", 0.5, 1],
  ["5-1-3", "5⅓′", 1.5, 3],
  ["8", "8′", 1, 2],
  ["4", "4′", 2, 4],
  ["2-2-3", "2⅔′", 3, 6],
  ["2", "2′", 4, 8],
  ["1-3-5", "1⅗′", 5, 10],
  ["1-1-3", "1⅓′", 6, 12],
  ["1", "1′", 8, 16],
].map(([id, label, ratio, partial]) => Object.freeze({ id, label, ratio, partial })));

export const SPARTIAL_PIPE_TONES = Object.freeze([
  { id: "flute", name: "Open flute" },
  { id: "stopped", name: "Stopped flute" },
  { id: "principal", name: "Principal" },
  { id: "string", name: "String pipe" },
  { id: "reed", name: "Reed pipe" },
].map(Object.freeze));

export const SPARTIAL_ORGAN_DEFAULTS = Object.freeze({
  organMode: "partials",
  organStops: Object.freeze([8, 0, 8, 0, 0, 0, 0, 0, 0]),
  pipeTone: "flute",
  pipeBrightness: 0.5,
});

const MODES = ["partials", "tonewheel", "pipe"];
const TONES = SPARTIAL_PIPE_TONES.map(tone => tone.id);
const finite = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Return an owned, bounded patch containing only organ voicing fields. */
export function sanitizeOrganSettings(patch = {}, previous = SPARTIAL_ORGAN_DEFAULTS) {
  patch ??= {};
  previous ??= SPARTIAL_ORGAN_DEFAULTS;
  const enumValue = (key, choices) => choices.includes(patch[key]) ? patch[key]
    : choices.includes(previous[key]) ? previous[key] : SPARTIAL_ORGAN_DEFAULTS[key];
  const source = Array.isArray(patch.organStops) || ArrayBuffer.isView(patch.organStops) ? patch.organStops : [];
  const prior = Array.isArray(previous.organStops) || ArrayBuffer.isView(previous.organStops) ? previous.organStops : [];
  return {
    organMode: enumValue("organMode", MODES),
    organStops: SPARTIAL_ORGAN_STOPS.map((_, index) => Math.round(clamp(
      finite(source[index], finite(prior[index], SPARTIAL_ORGAN_DEFAULTS.organStops[index])), 0, 8,
    ))),
    pipeTone: enumValue("pipeTone", TONES),
    pipeBrightness: clamp(finite(patch.pipeBrightness,
      finite(previous.pipeBrightness, SPARTIAL_ORGAN_DEFAULTS.pipeBrightness)), 0, 1),
  };
}

function slopeEnvelope(harmonic, breakpoint, lowSlope, highSlope) {
  return harmonic ** -lowSlope * Math.max(1, harmonic / breakpoint) ** -(highSlope - lowSlope);
}

function pipeHarmonic(harmonic, tone, brightness) {
  const odd = harmonic % 2 === 1;
  switch (tone) {
    case "flute":
      // Sine foundation plus weak triangle-like odd harmonic magnitudes; a
      // small even component separates this open-flute color from stopped.
      return harmonic === 1 ? 1 : (odd ? 0.15 + 0.65 * brightness : 0.03 + 0.2 * brightness)
        / harmonic ** (2.8 - brightness);
    case "stopped":
      return odd ? 1 / harmonic ** (2 - 0.9 * brightness) : 0;
    case "principal":
      return slopeEnvelope(harmonic, 3 + 3 * brightness, 1.4 - 0.7 * brightness, 3.8 - brightness);
    case "string":
      return slopeEnvelope(harmonic, 3 + 4 * brightness, -0.25 - 0.35 * brightness, 3.5 - brightness)
        * (harmonic === 1 ? 0.6 : 1);
    case "reed":
      return slopeEnvelope(harmonic, 4 + 5 * brightness, 0.15, 4.8 - 1.2 * brightness);
    default:
      return 0;
  }
}

/**
 * Fill the caller's 32-partial bank. Organ modes use a 16′ base (played pitch
 * times 0.5), so every drawbar and its pipe overtones lands on an integer slot.
 * Each stop has an L1 budget of level/8; the complete bank is bounded by nine.
 * The DSP owns final normalization, painted-gain attenuation and Nyquist limits.
 * Partials mode returns identity multipliers; its existing rolloff stays owned
 * by the ordinary partial engine.
 */
export function writeOrganSpectrum(settings, target) {
  if (!(target instanceof Float64Array || target instanceof Float32Array) || target.length !== SPARTIAL_ORGAN_PARTIALS) {
    throw new TypeError("An organ spectrum needs a 32-element float array.");
  }
  const organ = sanitizeOrganSettings(settings);
  if (organ.organMode === "partials") { target.fill(1); return target; }
  target.fill(0);
  for (let stop = 0; stop < SPARTIAL_ORGAN_STOPS.length; stop += 1) {
    const gain = organ.organStops[stop] / 8;
    if (!gain) continue;
    const slot = SPARTIAL_ORGAN_STOPS[stop].partial;
    if (organ.organMode === "tonewheel") {
      target[slot - 1] += gain;
      continue;
    }
    const count = Math.floor(SPARTIAL_ORGAN_PARTIALS / slot);
    let total = 0;
    for (let harmonic = 1; harmonic <= count; harmonic += 1) total += pipeHarmonic(harmonic, organ.pipeTone, organ.pipeBrightness);
    for (let harmonic = 1; harmonic <= count; harmonic += 1) {
      target[harmonic * slot - 1] += gain * pipeHarmonic(harmonic, organ.pipeTone, organ.pipeBrightness) / total;
    }
  }
  return target;
}

const RECIPE_DEFAULTS = Object.freeze({
  ...SPARTIAL_ORGAN_DEFAULTS,
  partials: SPARTIAL_ORGAN_PARTIALS,
  gains: Object.freeze(Array(SPARTIAL_ORGAN_PARTIALS).fill(1)),
  rolloff: 0,
  stretch: 1,
  inharmonicity: 0,
  cascade: 0,
  cascadeStart: 0,
  attack: 0.012,
  release: 0.18,
  modulationRate: 5,
  pitchDepth: 0,
  amplitudeDepth: 0,
  modulationRipple: 0,
  modulationShape: "sine",
  rotaryMode: "off",
  rotaryMix: 0.7,
  rotarySpread: 0.7,
  rotaryRamp: 2.5,
  drive: 0,
  keyClick: 0,
  pipeChiff: 0,
  organPercussion: "off",
  percussionLevel: 0.25,
  percussionDecay: 0.35,
});

function registration(id, name, settings) {
  return Object.freeze({ id, name, settings: Object.freeze({
    ...RECIPE_DEFAULTS, ...settings, organStops: Object.freeze([...settings.organStops]),
  }) });
}

/** Original musical starting points, not transcriptions of factory registrations. */
export const SPARTIAL_ORGAN_PRESETS = Object.freeze([
  registration("tonewheel-clear", "Tonewheel · clear", {
    organMode: "tonewheel", organStops: [7, 0, 8, 2, 0, 0, 0, 0, 1], keyClick: 0.08,
  }),
  registration("tonewheel-night", "Tonewheel · late jazz", {
    organMode: "tonewheel", organStops: [7, 5, 8, 1, 0, 2, 0, 0, 1],
    organPercussion: "third", percussionLevel: 0.18, percussionDecay: 0.35,
    keyClick: 0.12, rotaryMode: "slow", rotaryMix: 0.45, drive: 0.12,
  }),
  registration("tonewheel-gospel", "Tonewheel · gospel lift", {
    organMode: "tonewheel", organStops: [7, 3, 8, 5, 4, 3, 2, 1, 2],
    organPercussion: "second", percussionLevel: 0.12, percussionDecay: 0.24,
    keyClick: 0.17, rotaryMode: "fast", rotaryMix: 0.72, rotaryRamp: 3, drive: 0.18,
  }),
  registration("tonewheel-rock", "Tonewheel · copper drive", {
    organMode: "tonewheel", organStops: [8, 6, 8, 7, 5, 4, 3, 2, 5],
    keyClick: 0.3, rotaryMode: "fast", rotaryMix: 0.55, drive: 0.42,
  }),
  registration("pipe-flute", "Pipes · quiet flute", {
    organMode: "pipe", organStops: [0, 0, 8, 2, 0, 0, 0, 0, 0],
    pipeTone: "flute", pipeBrightness: 0.25, pipeChiff: 0.08, attack: 0.045, release: 0.45,
  }),
  registration("pipe-stopped", "Pipes · hollow wood", {
    organMode: "pipe", organStops: [5, 0, 8, 0, 0, 2, 0, 0, 0],
    pipeTone: "stopped", pipeBrightness: 0.42, pipeChiff: 0.12, attack: 0.035, release: 0.38,
  }),
  registration("pipe-principal", "Pipes · principal chorus", {
    organMode: "pipe", organStops: [3, 0, 8, 5, 0, 3, 0, 0, 1],
    pipeTone: "principal", pipeBrightness: 0.48, pipeChiff: 0.06, attack: 0.028, release: 0.5,
  }),
  registration("pipe-string", "Pipes · silver strings", {
    organMode: "pipe", organStops: [0, 0, 8, 3, 0, 1, 0, 0, 0],
    pipeTone: "string", pipeBrightness: 0.56, attack: 0.065, release: 0.62,
    modulationRate: 4.7, pitchDepth: 2.5, amplitudeDepth: 0.025,
  }),
  registration("pipe-reed", "Pipes · reed crown", {
    organMode: "pipe", organStops: [3, 0, 8, 3, 1, 2, 0, 0, 1],
    pipeTone: "reed", pipeBrightness: 0.63, pipeChiff: 0.14, attack: 0.018, release: 0.32,
  }),
  registration("pipe-ripple", "Pipes · traveling tremulant", {
    organMode: "pipe", organStops: [2, 1, 8, 4, 2, 1, 0, 0, 0],
    pipeTone: "principal", pipeBrightness: 0.4, attack: 0.07, release: 0.8,
    modulationRate: 1.2, pitchDepth: 9, amplitudeDepth: 0.22, modulationRipple: 1.5,
  }),
]);

/** Seeded section dice: never touches level, Audio, transport, or device state. */
export function randomOrganRegistration(seed = 1) {
  let state = (Math.imul(finite(seed, 1), 0x9e3779b1) ^ 0x4f524741) >>> 0 || 1;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const organMode = random() < 0.5 ? "tonewheel" : "pipe";
  const organStops = SPARTIAL_ORGAN_STOPS.map(() => Math.floor(random() * 9));
  if (!organStops.some(Boolean)) organStops[2] = 6;
  return {
    organMode,
    organStops,
    pipeTone: TONES[Math.floor(random() * TONES.length)],
    pipeBrightness: Math.round(random() * 100) / 100,
  };
}
