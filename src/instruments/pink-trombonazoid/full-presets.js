import {
  PINK_TROMBONAZOID_LANES, PINK_TROMBONAZOID_LFO_SHAPES, PINK_TROMBONAZOID_VOICE_HARMONIES,
  PINK_TROMBONAZOID_VOICE_PRESETS,
} from "../../families/tract/pink-trombonazoid.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const PINK_TROMBONAZOID_CONTROL_SPECS = Object.freeze({
  speechRate: [.45, 1.8, .01], wordGap: [0, 2000, 20],
  drive: [0, 1, .01], tone: [0, 1, .01], echo: [0, .62, .01], echoTime: [45, 900, 5],
  throatCount: [1, 7, 1], registerSemitones: [-12, 12, 1], detuneCents: [0, 30, 1],
  bodyLengthOffset: [-.22, .22, .01], tensionOffset: [-.25, .25, .01],
  mouthVariation: [0, 1, .01], coupling: [0, .72, .01], spread: [0, 1, .01],
});
const MODULATION_SPEED = [.1, 14];
const VOICE_KEYS = Object.freeze(["throatCount", "registerSemitones", "detuneCents", "bodyLengthOffset", "tensionOffset", "mouthVariation", "coupling", "spread"]);
const EFFECT_KEYS = Object.freeze(["drive", "tone", "echo", "echoTime"]);
const LANE_IDS = Object.freeze(PINK_TROMBONAZOID_LANES.map(({ id }) => id));
const decimals = step => (String(step).split(".")[1] ?? "").length;

export function quantizePinkControl(key, value) {
  const [lo, hi, step] = PINK_TROMBONAZOID_CONTROL_SPECS[key];
  const clamped = Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : lo));
  return Number((lo + Math.round((clamped - lo) / step) * step).toFixed(decimals(step) + decimals(lo)));
}

const unit = value => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
const track = (points, contour) => {
  const source = Array.isArray(points) && points.length >= 2 ? points : [{ phase: 0, value: 0 }, { phase: 1, value: 0 }];
  return source.map((point, index) => ({
    id: String(point?.id ?? `${contour}-${index}`),
    phase: index === 0 ? 0 : index === source.length - 1 ? 1 : unit(point?.phase),
    value: contour === "speed"
      ? Math.min(MODULATION_SPEED[1], Math.max(MODULATION_SPEED[0], Number.isFinite(Number(point?.value)) ? Number(point.value) : MODULATION_SPEED[0]))
      : unit(point?.value),
  }));
};

export function capturePinkTrombonazoidPreset(source) {
  const voice = source.voice ?? {};
  const effects = source.effects ?? {};
  const lanes = source.modulation?.lanes ?? {};
  return {
    text: String(source.text ?? "").trim().slice(0, 64) || "hello",
    voicePreset: PINK_TROMBONAZOID_VOICE_PRESETS[source.voicePreset] ? source.voicePreset : "clear",
    voice: {
      harmony: PINK_TROMBONAZOID_VOICE_HARMONIES[voice.harmony] ? voice.harmony : "shared",
      ...Object.fromEntries(VOICE_KEYS.map(key => [key, quantizePinkControl(key, voice[key])])),
    },
    speechRate: quantizePinkControl("speechRate", source.speechRate),
    wordGap: quantizePinkControl("wordGap", source.wordGap),
    effects: {
      ...Object.fromEntries(EFFECT_KEYS.map(key => [key, quantizePinkControl(key, effects[key])])),
      bypass: Boolean(effects.bypass),
    },
    loop: Boolean(source.loop),
    modulation: {
      bypass: Boolean(source.modulation?.bypass),
      lanes: Object.fromEntries(LANE_IDS.map(id => [id, {
        enabled: Boolean(lanes[id]?.enabled),
        shape: PINK_TROMBONAZOID_LFO_SHAPES.includes(lanes[id]?.shape) ? lanes[id].shape : "sine",
        seed: Math.max(0, Math.round(Number.isFinite(Number(lanes[id]?.seed)) ? Number(lanes[id].seed) : 0)),
        speed: track(lanes[id]?.speed, "speed"),
        depth: track(lanes[id]?.depth, "depth"),
      }])),
    },
  };
}

export function validatePinkTrombonazoidPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || typeof snapshot.text !== "string"
    || presetStateKey(snapshot) !== presetStateKey(capturePinkTrombonazoidPreset(snapshot))) {
    throw new TypeError("Invalid complete Pink Trombonazoid preset");
  }
  return snapshot;
}

export function defaultPinkLaneModulations() {
  return Object.fromEntries(LANE_IDS.map((id, index) => {
    const pitch = id === "pitch", breath = id === "breath";
    const speed = pitch ? 5.2 : breath ? 2.1 : 1.2, depth = pitch ? .025 : breath ? .09 : .08;
    return [id, {
      enabled: pitch || breath, shape: breath ? "triangle" : "sine", seed: index + 1,
      speed: [{ id: `${id}-speed-start`, phase: 0, value: speed }, { id: `${id}-speed-end`, phase: 1, value: speed }],
      depth: [{ id: `${id}-depth-start`, phase: 0, value: depth }, { id: `${id}-depth-end`, phase: 1, value: depth }],
    }];
  }));
}

const flatContour = (id, contour, value) => [
  { id: `${id}-${contour}-start`, phase: 0, value }, { id: `${id}-${contour}-end`, phase: 1, value },
];
const lfo = (shape, speed, depth, endSpeed = speed) => ({ enabled: true, shape, speed, depth, endSpeed });

const scene = (id, label, text, voicePreset, settings = {}) => {
  const { rate = 1, gap = 420, fx = {}, bypass = false, loop = false, mods = {} } = settings;
  const lanes = defaultPinkLaneModulations();
  for (const [laneId, mod] of Object.entries(mods)) {
    const index = LANE_IDS.indexOf(laneId);
    lanes[laneId] = mod === false
      ? { ...lanes[laneId], enabled: false }
      : {
        enabled: true, shape: mod.shape, seed: index + 1,
        speed: [{ id: `${laneId}-speed-start`, phase: 0, value: mod.speed }, { id: `${laneId}-speed-end`, phase: 1, value: mod.endSpeed }],
        depth: flatContour(laneId, "depth", mod.depth),
      };
  }
  return Object.freeze({
    id, label,
    snapshot: Object.freeze(capturePinkTrombonazoidPreset({
      text, voicePreset, voice: PINK_TROMBONAZOID_VOICE_PRESETS[voicePreset].voice, speechRate: rate, wordGap: gap,
      effects: { drive: .08, tone: .86, echo: 0, echoTime: 185, bypass, ...fx }, loop,
      modulation: { bypass: false, lanes },
    })),
  });
};

export const PINK_TROMBONAZOID_FULL_PRESETS = Object.freeze([
  scene("hello-clear", "Hello · clear solo", "hello", "clear"),
  scene("pink-trombone-velvet", "Pink trombone · velvet", "pink trombone", "warm", { rate: .94, fx: { echo: .12, echoTime: 240 } }),
  scene("morphazoid-creature", "Morphazoid · creature", "morphazoid", "creature", {
    rate: .88, fx: { drive: .3 }, mods: { mutation: lfo("triangle", 1.8, .35, 4.2) },
  }),
  scene("sequencer-reed", "Sequencer · electric reed", "sequencer", "reed", { rate: 1.08, fx: { drive: .22, tone: .95 } }),
  scene("hallelujah-choir", "Hallelujah · choir", "hallelujah", "choir", {
    rate: .72, gap: 700, loop: true, fx: { echo: .3, echoTime: 420, tone: .7 },
    mods: { intensity: lfo("sine", .5, .22), pitch: lfo("sine", 4.6, .02) },
  }),
  scene("ocean-fifths", "Ocean waves · open fifths", "ocean waves", "fifths", {
    rate: .8, gap: 560, fx: { echo: .22, echoTime: 360 }, mods: { pitch: lfo("sine", 5.2, .03), breath: lfo("triangle", .35, .18) },
  }),
  scene("la-unison", "La la la · unison stack", "la la la", "unison", { rate: .9, loop: true, mods: { pitch: lfo("sine", 6.1, .05) } }),
  scene("bell-ding-dong", "Ding dong · bell", "ding dong", "bell", { rate: 1.15, gap: 900, fx: { echo: .35, echoTime: 330, tone: 1 } }),
  scene("coloratura-spark", "Scintillating · coloratura", "scintillating", "coloratura", {
    rate: 1.3, fx: { tone: .95 }, mods: { pitch: lfo("triangle", 7.4, .04) },
  }),
  scene("mountain-deep", "Mountain · deep body", "mountain", "deep", { rate: .66, gap: 640, fx: { tone: .45, drive: .15 } }),
  scene("whisper-secret", "Secret · whisper", "secret", "whisper", {
    rate: .85, fx: { echo: .2, echoTime: 280, tone: .6 }, mods: { breath: lfo("triangle", 1.4, .3) },
  }),
  scene("boots-beatbox", "Boots and cats · beatbox", "boots and cats", "beatbox", {
    rate: 1.5, gap: 120, loop: true, fx: { drive: .4, echo: .08, echoTime: 120 }, mods: { tonguePosition: lfo("square", 2, .12) },
  }),
  scene("silence-airy", "Silence · airy upper", "silence", "airy", { rate: .78, fx: { echo: .15, tone: .75 }, mods: { breath: lfo("sine", 2.8, .16) } }),
  scene("mirror-double", "Mirror · double throat", "mirror", "double", { mods: { mutation: lfo("sine", .9, .2) } }),
  scene("moonlight-mezzo", "Moonlight · mezzo", "moonlight", "mezzo", { rate: .9, gap: 520, fx: { echo: .18, echoTime: 300 } }),
  scene("lullaby-alto", "Lullaby · alto", "lullaby", "alto", { rate: .7, gap: 800, fx: { tone: .6 }, mods: { pitch: lfo("sine", 4.1, .03) } }),
  scene("electric-grit", "Electric · grit", "electric", "reed", {
    rate: 1.2, fx: { drive: .5, tone: .8 }, mods: { lipOpening: lfo("square", 3, .1), pitch: false },
  }),
]);

const WORDS = Object.freeze([
  "aurora", "banjo", "cathedral", "dandelion", "echo", "fireflies", "glacier", "harbor", "indigo", "jellyfish",
  "kaleidoscope", "lantern", "marimba", "nebula", "orchid", "pendulum", "quicksilver", "rainfall", "saxophone",
  "thunder", "umbrella", "velvet", "waterfall", "xylophone", "yesterday", "zeppelin", "murmur", "cascade", "ripple", "lighthouse",
]);

export function randomizePinkTrombonazoidPreset(current, random = Math.random) {
  validatePinkTrombonazoidPreset(current);
  const rng = presetRandom(random);
  const harmony = rng.pick(Object.keys(PINK_TROMBONAZOID_VOICE_HARMONIES));
  const throatCount = rng.pick([1, 1, 2, 3, 3, 4, 5, 7]);
  const multi = throatCount > 1;
  const q = (key, lo, hi) => quantizePinkControl(key, rng.between(lo, hi));
  const contour = (id, name, lo, hi) => {
    const middle = rng.unit() < .5;
    const point = (suffix, phase) => ({ id: `${id}-${name}-${suffix}`, phase, value: rng.between(lo, hi) });
    return [point("start", 0), ...(middle ? [point("mid", rng.between(.25, .75))] : []), point("end", 1)];
  };
  const lanes = Object.fromEntries(LANE_IDS.map((id, index) => [id, {
    enabled: rng.unit() < .35, shape: rng.pick(PINK_TROMBONAZOID_LFO_SHAPES), seed: rng.integer(0, 99) + index,
    speed: contour(id, "speed", .3, 9), depth: contour(id, "depth", .02, id === "pitch" ? .1 : .4),
  }]));
  return validatePinkTrombonazoidPreset(capturePinkTrombonazoidPreset({
    text: rng.pick(WORDS),
    voicePreset: rng.pick(Object.keys(PINK_TROMBONAZOID_VOICE_PRESETS)),
    voice: {
      harmony, throatCount,
      registerSemitones: q("registerSemitones", -9, 12), detuneCents: harmony === "shared" ? 0 : q("detuneCents", 3, 24),
      bodyLengthOffset: q("bodyLengthOffset", -.2, .2), tensionOffset: q("tensionOffset", -.2, .2),
      mouthVariation: multi ? q("mouthVariation", .05, .8) : 0, coupling: multi ? q("coupling", 0, .6) : 0,
      spread: multi ? q("spread", .2, 1) : 0,
    },
    speechRate: q("speechRate", .6, 1.6), wordGap: q("wordGap", 0, 1200),
    effects: { drive: q("drive", 0, .5), tone: q("tone", .3, 1), echo: q("echo", 0, .45), echoTime: q("echoTime", 80, 600), bypass: rng.unit() < .1 },
    loop: rng.unit() < .35,
    modulation: { bypass: rng.unit() < .1, lanes },
  }));
}
