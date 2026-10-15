import { LINEAR_DRUM_PRESETS } from "../linear-drums/linear-drums.js";
import {
  PAINT_MACHINE_LAYER_DEFAULTS, PAINT_MACHINE_TARGETS, createPaintMachineDemo, sanitizePaintItem,
} from "./linear-drums-machine.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const RATTLESNAKE_SKIN_BEATS = Object.freeze([4, 8, 16]);
export const RATTLESNAKE_SKIN_PRESET_IDS = Object.freeze(LINEAR_DRUM_PRESETS.map(preset => preset.id));
export const RATTLESNAKE_SKIN_MAX_ITEMS = 600;
const LAYER_COUNT = PAINT_MACHINE_LAYER_DEFAULTS.length;
const RANGE_MIN = 20;
const round = value => Number(value.toFixed(4));

export function captureRattlesnakeSkinPreset(state) {
  return {
    items: state.items.map(item => sanitizePaintItem(JSON.parse(JSON.stringify(item)), item.id)),
    layers: state.layers.map(({ role, presetId, target, amount }) => ({ role, presetId, target, amount })),
    tempo: state.tempo, beats: state.beats, glissRate: state.glissRate, rangeMax: state.rangeMax,
  };
}

export function validateRattlesnakeSkinPreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Rattlesnake Skin preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== 6 || !Array.isArray(snapshot.items) || snapshot.items.length > RATTLESNAKE_SKIN_MAX_ITEMS
    || !Array.isArray(snapshot.layers) || snapshot.layers.length !== LAYER_COUNT) bad();
  const ids = new Set();
  for (const item of snapshot.items) {
    if (typeof item?.id !== "string" || ids.has(item.id)
      || presetStateKey(item) !== presetStateKey(sanitizePaintItem(item, item.id))) bad();
    ids.add(item.id);
  }
  for (const layer of snapshot.layers) {
    if (Object.keys(layer).length !== 4 || !["voice", "mod"].includes(layer.role)
      || !RATTLESNAKE_SKIN_PRESET_IDS.includes(layer.presetId) || !PAINT_MACHINE_TARGETS.includes(layer.target)
      || typeof layer.amount !== "number" || layer.amount < -1 || layer.amount > 1) bad();
  }
  if (!Number.isInteger(snapshot.tempo) || snapshot.tempo < 50 || snapshot.tempo > 180
    || !RATTLESNAKE_SKIN_BEATS.includes(snapshot.beats)
    || !Number.isInteger(snapshot.glissRate) || snapshot.glissRate < 6 || snapshot.glissRate > 30
    || typeof snapshot.rangeMax !== "number" || snapshot.rangeMax < 4_000 || snapshot.rangeMax > 20_000) bad();
  return snapshot;
}

const hit = (layer, x, y, radius = 0.014) => ({ type: "hit", layer, x: round(x), y: round(y), radius });
const stroke = (layer, ...points) => ({ type: "stroke", layer, points: points.map(([x, y]) => ({ x: round(x), y: round(y) })) });
const ring = (layer, x, y, radiusX, radiusY) => ({ type: "ring", layer, x: round(x), y: round(y), radiusX, radiusY });
const slotX = (slot, slots) => slot / slots + 0.002;
const row = (layer, slots, hits, y, radius) => hits.map(slot => hit(layer, slotX(slot, slots), typeof y === "function" ? y(slot) : y, radius));
const every = (count, step, offset = 0) => Array.from({ length: Math.ceil((count - offset) / step) }, (_, i) => i * step + offset);
const noteY = (hz, rangeMax) => Math.min(1, Math.max(0, Math.log(hz / RANGE_MIN) / Math.log(rangeMax / RANGE_MIN)));
const PENTATONIC = [110, 130.81, 146.83, 164.81, 196, 220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880];

const layerSpec = (specs = []) => PAINT_MACHINE_LAYER_DEFAULTS.map((fallback, index) => {
  const spec = specs[index] ?? {};
  return {
    role: spec.role ?? "voice", presetId: spec.presetId ?? fallback.presetId, target: spec.target ?? fallback.target, amount: spec.amount ?? 0.7,
  };
});

const scene = (id, label, { tempo, beats, glissRate = 18, rangeMax = 16_000, layers, items }) => {
  const snapshot = {
    items: items.map((item, index) => sanitizePaintItem({ ...item, id: `p-${index}` }, `p-${index}`)),
    layers: layerSpec(layers), tempo, beats, glissRate, rangeMax,
  };
  validateRattlesnakeSkinPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

const factoryLayers = PAINT_MACHINE_LAYER_DEFAULTS.map(({ role, presetId, target, amount }) => ({ role, presetId, target, amount }));
const y16 = hz => noteY(hz, 16_000);

export const RATTLESNAKE_SKIN_FULL_PRESETS = Object.freeze([
  scene("skin-demo", "Skin demo", { tempo: 112, beats: 8, layers: factoryLayers, items: createPaintMachineDemo() }),
  scene("four-on-the-floor", "Four on the floor", {
    tempo: 124, beats: 4, glissRate: 14,
    layers: [{ presetId: "sub-cavern" }, { presetId: "dry-wood" }, { presetId: "air-needles" }, { role: "mod", target: "decay", amount: -0.6 }],
    items: [
      ...row(0, 16, [0, 4, 8, 12], y16(55), 0.02), ...row(1, 16, [4, 12], y16(250), 0.016), ...row(2, 16, [2, 6, 10, 14], y16(6000), 0.01),
      ...row(2, 16, [1, 5, 9, 13], y16(9000), 0.008), stroke(3, [0.02, 0.2], [0.5, 0.85], [0.98, 0.3]),
    ],
  }),
  scene("tom-cascade", "Tom cascade", {
    tempo: 96, beats: 8, glissRate: 20,
    layers: [{ presetId: "tom-field" }, { presetId: "rubber-arc" }, { presetId: "natural-line" }, { role: "mod", target: "pitchFall", amount: 0.8 }],
    items: [
      stroke(0, [0.02, 0.75], [0.25, 0.5], [0.48, 0.22]), stroke(0, [0.52, 0.78], [0.75, 0.55], [0.98, 0.3]),
      ...row(1, 32, [0, 6, 12, 16, 22, 28], i => 0.2 + (i % 5) * 0.08, 0.016), ...row(2, 32, [3, 9, 19, 25], 0.7, 0.012),
      stroke(3, [0.05, 0.3], [0.3, 0.9], [0.55, 0.2], [0.8, 0.85], [0.97, 0.4]),
    ],
  }),
  scene("marimba-ladder", "Marimba ladder", {
    tempo: 100, beats: 8, glissRate: 10, rangeMax: 8_000,
    layers: [{ presetId: "wood-bars" }, { presetId: "string-keys" }, { presetId: "dry-wood" }, { role: "mod", target: "brightness", amount: 0.5 }],
    items: [
      ...row(0, 32, every(32, 2), slot => noteY(PENTATONIC[(slot / 2) % 16] * 2, 8_000), 0.014),
      ...row(1, 32, every(32, 4, 1), slot => noteY(PENTATONIC[(slot * 3) % 16], 8_000), 0.012),
      ...row(2, 32, [0, 8, 16, 24], noteY(110, 8_000), 0.02), stroke(3, [0.02, 0.4], [0.5, 0.8], [0.98, 0.2]),
    ],
  }),
  scene("harp-rain", "Harp rain", {
    tempo: 84, beats: 8, glissRate: 12, rangeMax: 12_000,
    layers: [{ presetId: "string-keys" }, { presetId: "reverse-keys" }, { presetId: "tine-reverse" }, { role: "mod", target: "attack", amount: 0.6 }],
    items: [
      stroke(0, [0.02, 0.85], [0.14, 0.45]), stroke(0, [0.17, 0.8], [0.3, 0.4]), stroke(0, [0.34, 0.9], [0.46, 0.5]),
      stroke(0, [0.52, 0.82], [0.66, 0.42]), stroke(0, [0.7, 0.88], [0.82, 0.5]), stroke(0, [0.86, 0.78], [0.98, 0.38]),
      ring(1, 0.25, 0.55, 0.06, 0.18), ring(1, 0.75, 0.6, 0.08, 0.2),
      ...row(2, 32, [5, 13, 21, 29], 0.88, 0.01), stroke(3, [0.05, 0.2], [0.5, 0.9], [0.95, 0.3]),
    ],
  }),
  scene("sub-tresillo", "Sub tresillo", {
    tempo: 140, beats: 4, glissRate: 16,
    layers: [{ presetId: "sub-cavern" }, { presetId: "hard-rise" }, { presetId: "air-needles" }, { role: "mod", target: "pitchFall", amount: 0.7 }],
    items: [
      ...row(0, 16, [0, 3, 6, 8, 11, 14], y16(48), 0.022), ...row(1, 16, [4, 12], y16(320), 0.016),
      ...row(2, 16, every(16, 1), slot => 0.72 + (slot % 3) * 0.07, 0.008), stroke(3, [0.02, 0.15], [0.52, 0.8], [0.98, 0.25]),
    ],
  }),
  scene("ring-bells", "Ring bells", {
    tempo: 84, beats: 16, glissRate: 8,
    layers: [{ presetId: "tine-reverse" }, { presetId: "wood-bars" }, { presetId: "string-keys" }, { presetId: "reverse-keys" }],
    items: [
      ring(0, 0.1, 0.55, 0.05, 0.2), ring(0, 0.35, 0.7, 0.09, 0.14), ring(0, 0.6, 0.45, 0.06, 0.25), ring(0, 0.85, 0.65, 0.07, 0.18),
      ...row(1, 64, [4, 20, 36, 52], 0.35, 0.016), stroke(2, [0.2, 0.9], [0.3, 0.6]), stroke(2, [0.7, 0.88], [0.8, 0.52]),
      ...row(3, 64, [10, 26, 42, 58], 0.5, 0.014),
    ],
  }),
  scene("reverse-swells", "Reverse swells", {
    tempo: 70, beats: 16, glissRate: 10,
    layers: [{ presetId: "soft-rise" }, { presetId: "reverse-weight" }, { presetId: "hard-rise" }, { role: "mod", target: "attack", amount: 0.9 }],
    items: [
      stroke(0, [0.03, 0.1], [0.3, 0.75]), stroke(0, [0.52, 0.12], [0.8, 0.85]), stroke(1, [0.33, 0.85], [0.5, 0.2]), stroke(1, [0.83, 0.9], [0.98, 0.3]),
      ...row(2, 64, [32, 63], 0.4, 0.03), stroke(3, [0.02, 0.9], [0.5, 0.1], [0.98, 0.7]),
    ],
  }),
  scene("three-against-four", "Three against four", {
    tempo: 120, beats: 16, glissRate: 14,
    layers: [{ presetId: "natural-line" }, { presetId: "bongo-wire" }, { presetId: "air-needles" }, { role: "mod", target: "inharmonicity", amount: 0.6 }],
    items: [
      ...[0, 1, 2, 3].map(i => hit(0, i / 4 + 0.002, 0.16, 0.02)), ...[0, 1, 2].map(i => hit(1, i / 3 + 0.002, 0.42, 0.016)),
      ...[0, 1, 2, 3, 4].map(i => hit(2, i / 5 + 0.002, 0.78, 0.01)), stroke(3, [0.02, 0.3], [0.33, 0.75], [0.66, 0.35], [0.98, 0.8]),
    ],
  }),
  scene("bongo-shuffle", "Bongo shuffle", {
    tempo: 104, beats: 8, glissRate: 12,
    layers: [{ presetId: "bongo-wire" }, { presetId: "dry-wood" }, { presetId: "air-needles" }, { role: "mod", target: "brightness", amount: -0.5 }],
    items: [
      ...row(0, 32, [0, 3, 6, 8, 11, 14, 16, 19, 22, 24, 27, 30], slot => 0.45 + (slot % 4) * 0.06, 0.014),
      ...row(1, 32, [2, 10, 18, 26], 0.25, 0.016), ...row(2, 32, every(32, 2, 1), 0.85, 0.008), stroke(3, [0.02, 0.8], [0.5, 0.2], [0.98, 0.75]),
    ],
  }),
  scene("pitch-bend-lab", "Pitch bend lab", {
    tempo: 90, beats: 8, glissRate: 16,
    layers: [{ presetId: "rubber-arc" }, { presetId: "skin-ladder" }, { role: "mod", target: "brightness", amount: 0.9 }, { role: "mod", target: "pitchFall", amount: -0.8 }],
    items: [
      ...row(0, 32, [0, 8, 14, 16, 24, 30], 0.3, 0.018), ...row(1, 32, [4, 12, 20, 28], 0.6, 0.014),
      stroke(2, [0.02, 0.1], [0.4, 0.9], [0.8, 0.3], [0.98, 0.7]), stroke(3, [0.02, 0.9], [0.5, 0.15], [0.98, 0.85]),
    ],
  }),
  scene("glissando-storm", "Glissando storm", {
    tempo: 150, beats: 4, glissRate: 28,
    layers: [{ presetId: "y-expression" }, { presetId: "natural-line" }, { presetId: "air-needles" }, { role: "mod", target: "hardness", amount: 0.8 }],
    items: [
      stroke(0, [0.02, 0.1], [0.3, 0.9]), stroke(0, [0.35, 0.9], [0.62, 0.2]), stroke(0, [0.66, 0.15], [0.98, 0.85]),
      ring(1, 0.3, 0.5, 0.1, 0.3), ring(1, 0.7, 0.5, 0.12, 0.25), ...row(2, 16, [1, 5, 9, 13], 0.9, 0.01),
      stroke(3, [0.02, 0.5], [0.25, 0.9], [0.5, 0.1], [0.75, 0.9], [0.98, 0.5]),
    ],
  }),
  scene("sparse-low-room", "Sparse low room", {
    tempo: 60, beats: 16, glissRate: 6, rangeMax: 6_000,
    layers: [{ presetId: "sub-cavern" }, { presetId: "reverse-weight" }, { presetId: "tom-field" }, { role: "mod", target: "decay", amount: 0.8 }],
    items: [
      hit(0, 0.002, 0.1, 0.03), hit(0, 0.38, 0.14, 0.03), hit(0, 0.752, 0.08, 0.03), stroke(1, [0.2, 0.7], [0.36, 0.25]),
      ...row(2, 64, [24, 56], 0.3, 0.02), stroke(3, [0.02, 0.2], [0.98, 0.9]),
    ],
  }),
]);

const REGISTER_BANDS = [[0.04, 0.22], [0.22, 0.45], [0.45, 0.7], [0.65, 0.92]];

function randomItems(rng, layers, beats) {
  const slots = beats * 4;
  const items = [];
  layers.forEach((layer, index) => {
    const [low, high] = rng.pick(REGISTER_BANDS);
    if (layer.role === "mod") {
      const count = rng.integer(3, 5);
      const points = Array.from({ length: count }, (_, i) => [i / (count - 1), rng.between(0.05, 0.95)]);
      items.push(stroke(index, ...points));
      return;
    }
    const density = rng.between(0.12, 0.4), step = rng.pick([1, 2, 2, 4]);
    for (let slot = rng.integer(0, 1); slot < slots; slot += step) {
      if (rng.unit() < density) items.push(hit(index, slotX(slot, slots), rng.between(low, high), rng.between(0.008, 0.026)));
    }
    if (!items.some(item => item.layer === index)) items.push(hit(index, slotX(0, slots), rng.between(low, high), 0.016));
    for (let i = rng.integer(0, 2); i > 0; i--) {
      const x = rng.between(0.02, 0.8), y = rng.between(0.1, 0.9);
      items.push(stroke(index, [x, y], [Math.min(0.98, x + rng.between(0.08, 0.3)), rng.between(0.1, 0.9)]));
    }
    if (rng.unit() < 0.4) items.push(ring(index, rng.between(0.15, 0.85), rng.between(0.25, 0.75), rng.between(0.03, 0.12), rng.between(0.08, 0.25)));
  });
  return items.map(item => ({
    ...item,
    ...(item.type === "ring" ? { x: round(item.x), y: round(item.y), radiusX: round(item.radiusX), radiusY: round(item.radiusY) } : {}),
    ...(item.type === "hit" ? { radius: round(item.radius) } : {}),
  }));
}

export function randomizeRattlesnakeSkinPreset(current, random = Math.random) {
  presetStateKey(current);
  const rng = presetRandom(random);
  const roles = Array.from({ length: LAYER_COUNT }, () => (rng.unit() < 0.28 ? "mod" : "voice"));
  if (!roles.includes("voice")) roles[0] = "voice";
  const layers = roles.map(role => ({
    role, presetId: rng.pick(RATTLESNAKE_SKIN_PRESET_IDS), target: rng.pick(PAINT_MACHINE_TARGETS), amount: round(rng.between(-1, 1)),
  }));
  const beats = rng.pick(RATTLESNAKE_SKIN_BEATS);
  const items = randomItems(rng, layers, beats).slice(0, RATTLESNAKE_SKIN_MAX_ITEMS)
    .map((item, index) => sanitizePaintItem({ ...item, id: `p-${index}` }, `p-${index}`));
  return validateRattlesnakeSkinPreset({
    items, layers, tempo: rng.integer(56, 168), beats, glissRate: rng.integer(6, 30),
    rangeMax: round(4_000 * 5 ** rng.unit()),
  });
}
