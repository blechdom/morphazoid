import { REFLECTION_AXES, sanitizeMark } from "./playhead-paint.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const PAINT_LAYER_IDS = Object.freeze(["aqua", "rose", "gold", "violet"]);
export const PAINT_WAVEFORMS = Object.freeze(["sine", "triangle", "sawtooth", "square", "fm"]);
export const PAINT_TARGETS = Object.freeze(["none", "pitch", "pan", "brightness", "gain", "modulationDepth", "shepard", "ouroboros"]);
export const PAINT_COORDINATE_MODES = Object.freeze(["cartesian", "polar", "spokes"]);
export const PAINT_PLAYBACK_MODES = Object.freeze(["original", "steady"]);
export const PAINT_PRESET_KEYS = Object.freeze(["marks", "layers", "axes", "mapping", "sceneTransform", "playbackMode", "playbackRate", "steadySpeed", "loopGapMs"]);
const MAX_PAINT_MARKS = 400;
const MAX_PAINT_POINTS = 60_000;

const round = (value, digits = 4) => Number(value.toFixed(digits));
const between = (value, min, max) => typeof value === "number" && value >= min && value <= max;

export function capturePaintPreset(state) {
  const { mapping: m, sceneTransform: t } = state;
  return JSON.parse(presetStateKey({
    marks: state.marks,
    layers: state.layers.map(({ id, waveform, envelope: e }) => ({
      id, waveform, envelope: { attackMs: e.attackMs, decayMs: e.decayMs, sustain: e.sustain, releaseMs: e.releaseMs },
    })),
    axes: [...state.axes],
    mapping: {
      coordinateMode: m.coordinateMode, radialSpokes: m.radialSpokes, xTarget: m.xTarget, yTarget: m.yTarget,
      sizeTarget: m.sizeTarget, pitchMin: m.pitchMin, pitchMax: m.pitchMax,
    },
    sceneTransform: { translateX: t.translateX, translateY: t.translateY, rotationDeg: t.rotationDeg, scaleX: t.scaleX, scaleY: t.scaleY },
    playbackMode: state.playbackMode, playbackRate: state.playbackRate, steadySpeed: state.steadySpeed, loopGapMs: state.loopGapMs,
  }));
}

export function validatePaintPreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Playhead Paint preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== PAINT_PRESET_KEYS.length || PAINT_PRESET_KEYS.some(key => !(key in snapshot))) bad();
  if (!Array.isArray(snapshot.marks) || snapshot.marks.length > MAX_PAINT_MARKS) bad();
  let points = 0;
  const ids = new Set();
  for (const mark of snapshot.marks) {
    if (!mark || typeof mark.id !== "string" || ids.has(mark.id) || !PAINT_LAYER_IDS.includes(mark.layerId)) bad();
    ids.add(mark.id);
    points += mark.samples?.length ?? 0;
    if (presetStateKey(sanitizeMark(mark, { fallbackId: mark.id })) !== presetStateKey(mark)) bad();
  }
  if (points > MAX_PAINT_POINTS) bad();
  if (!Array.isArray(snapshot.layers) || snapshot.layers.length !== PAINT_LAYER_IDS.length) bad();
  snapshot.layers.forEach((layer, index) => {
    const e = layer?.envelope;
    if (Object.keys(layer).length !== 3 || layer.id !== PAINT_LAYER_IDS[index] || !PAINT_WAVEFORMS.includes(layer.waveform) || !e
      || Object.keys(e).length !== 4 || !between(e.attackMs, 0, 1200) || !between(e.decayMs, 0, 2000)
      || !between(e.sustain, 0, 1) || !between(e.releaseMs, 8, 4000)) bad();
  });
  if (!Array.isArray(snapshot.axes) || snapshot.axes.some((axis, i) => axis !== REFLECTION_AXES.filter(a => snapshot.axes.includes(a))[i])
    || new Set(snapshot.axes).size !== snapshot.axes.length || snapshot.axes.some(axis => !REFLECTION_AXES.includes(axis))) bad();
  const m = snapshot.mapping;
  if (!m || Object.keys(m).length !== 7 || !PAINT_COORDINATE_MODES.includes(m.coordinateMode) || !Number.isInteger(m.radialSpokes)
    || !between(m.radialSpokes, 3, 32) || ![m.xTarget, m.yTarget, m.sizeTarget].every(t => PAINT_TARGETS.includes(t))
    || !between(m.pitchMin, 24, 440) || !between(m.pitchMax, Math.max(220, m.pitchMin ?? 0), 6000)) bad();
  const t = snapshot.sceneTransform;
  if (!t || Object.keys(t).length !== 5 || !between(t.translateX, -2, 2) || !between(t.translateY, -2, 2)
    || !between(t.rotationDeg, -720, 720) || !between(t.scaleX, 0.05, 8) || !between(t.scaleY, 0.05, 8)) bad();
  if (!PAINT_PLAYBACK_MODES.includes(snapshot.playbackMode) || !between(snapshot.playbackRate, 0.25, 2)
    || !between(snapshot.steadySpeed, 0.05, 1.5) || !between(snapshot.loopGapMs, 0, 3000)) bad();
  return snapshot;
}

const clampUnit = value => Math.min(1, Math.max(0, value));
const polyline = (n, fn) => Array.from({ length: n }, (_, i) => fn(i / (n - 1), i));
export const SHAPES = Object.freeze({
  spiral: ({ cx = 0.5, cy = 0.5, r0 = 0.04, r1 = 0.42, turns = 2.5, phase = 0 } = {}) => polyline(48, u => [cx + (r0 + (r1 - r0) * u) * Math.cos(phase + u * turns * 2 * Math.PI), cy + (r0 + (r1 - r0) * u) * Math.sin(phase + u * turns * 2 * Math.PI)]),
  circle: ({ cx = 0.5, cy = 0.5, r = 0.3, phase = 0 } = {}) => polyline(40, u => [cx + r * Math.cos(phase + u * 2 * Math.PI), cy + r * Math.sin(phase + u * 2 * Math.PI)]),
  wave: ({ y = 0.5, amp = 0.2, cycles = 2, x0 = 0.06, x1 = 0.94, phase = 0 } = {}) => polyline(40, u => [x0 + (x1 - x0) * u, y + amp * Math.sin(phase + u * cycles * 2 * Math.PI)]),
  line: ({ x0 = 0.1, y0 = 0.9, x1 = 0.9, y1 = 0.1 } = {}) => polyline(12, u => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]),
  lissajous: ({ cx = 0.5, cy = 0.5, rx = 0.38, ry = 0.3, a = 1, b = 2, phase = Math.PI / 2 } = {}) => polyline(64, u => [cx + rx * Math.sin(a * u * 2 * Math.PI + phase), cy + ry * Math.sin(b * u * 2 * Math.PI)]),
  zigzag: ({ x0 = 0.1, x1 = 0.9, y0 = 0.85, y1 = 0.15, teeth = 6 } = {}) => polyline(teeth * 2 + 1, (u, i) => [x0 + (x1 - x0) * u, i % 2 ? y0 : y1]),
  stairs: ({ x0 = 0.1, y0 = 0.85, x1 = 0.9, y1 = 0.15, steps = 7 } = {}) => polyline(steps * 2 + 1, (u, i) => [x0 + (x1 - x0) * Math.ceil(i / 2) / steps, y0 + (y1 - y0) * Math.floor(i / 2) / steps]),
  polygon: ({ cx = 0.5, cy = 0.5, r = 0.36, sides = 3, phase = -Math.PI / 2 } = {}) => polyline(sides + 1, (u, i) => [cx + r * Math.cos(phase + i / sides * 2 * Math.PI), cy + r * Math.sin(phase + i / sides * 2 * Math.PI)]),
  spoke: ({ cx = 0.5, cy = 0.5, angle = 0, r0 = 0.06, r1 = 0.44 } = {}) => polyline(6, u => [cx + (r0 + (r1 - r0) * u) * Math.cos(angle), cy + (r0 + (r1 - r0) * u) * Math.sin(angle)]),
  tick: ({ x = 0.5, y = 0.5, dx = 0.04, dy = 0 } = {}) => [[x, y], [x + dx * 0.5, y + dy * 0.5], [x + dx, y + dy]],
});

const baseEnvelope = (attackMs, decayMs, sustain, releaseMs) => ({ attackMs, decayMs, sustain, releaseMs });
const DEFAULT_LAYERS = [
  { id: "aqua", waveform: "sine", envelope: baseEnvelope(12, 120, 0.72, 240) },
  { id: "rose", waveform: "triangle", envelope: baseEnvelope(8, 150, 0.64, 320) },
  { id: "gold", waveform: "fm", envelope: baseEnvelope(4, 95, 0.52, 190) },
  { id: "violet", waveform: "sawtooth", envelope: baseEnvelope(55, 260, 0.78, 620) },
];

export function buildPaintMark(id, spec) {
  const points = spec.points.map(([x, y]) => [round(clampUnit(x)), round(clampUnit(y))]);
  const last = Math.max(1, points.length - 1);
  return sanitizeMark({
    id, layerId: spec.layer, startOffsetMs: round(spec.at, 1), durationMs: round(spec.duration, 1), axes: spec.axes ?? [],
    brushSize: spec.brush ?? 0.014, envelope: spec.envelope,
    samples: points.map(([x, y], i) => ({ x, y, tMs: round(spec.duration * i / last, 1), pressure: round(spec.pressure?.(i / last) ?? 0.5, 2) })),
  }, { fallbackId: id });
}

function assemble(plan) {
  const layers = DEFAULT_LAYERS.map(layer => ({ id: layer.id, waveform: plan.layers?.[layer.id]?.waveform ?? layer.waveform,
    envelope: { ...layer.envelope, ...plan.layers?.[layer.id]?.envelope } }));
  const marks = [];
  let cursor = 0;
  plan.marks.forEach((spec, index) => {
    const at = spec.at ?? cursor;
    const envelope = layers.find(layer => layer.id === spec.layer).envelope;
    marks.push(buildPaintMark(`m${index + 1}`, { ...spec, envelope, at, duration: spec.duration ?? 1200 }));
    cursor = at + (spec.duration ?? 1200) + (spec.gap ?? 150);
  });
  return {
    marks, layers, axes: REFLECTION_AXES.filter(axis => plan.axes?.includes(axis)),
    mapping: { coordinateMode: "cartesian", radialSpokes: 8, xTarget: "pan", yTarget: "pitch", sizeTarget: "brightness", pitchMin: 55, pitchMax: 1760, ...plan.mapping },
    sceneTransform: { translateX: 0, translateY: 0, rotationDeg: 0, scaleX: 1, scaleY: 1, ...plan.transform },
    playbackMode: plan.playbackMode ?? "original", playbackRate: plan.rate ?? 1, steadySpeed: plan.speed ?? 0.35, loopGapMs: plan.gap ?? 300,
  };
}

const scene = (id, label, plan) => {
  const snapshot = assemble(plan);
  validatePaintPreset(snapshot);
  return Object.freeze({ id, label, snapshot });
};

const L = SHAPES;
export const PAINT_FULL_PRESETS = Object.freeze([
  scene("spiral-bloom", "Spiral bloom", { marks: [{ layer: "aqua", points: L.spiral(), duration: 3200 }, { layer: "rose", points: L.circle({ r: 0.36 }), duration: 2400 }], mapping: { pitchMin: 65, pitchMax: 1320 } }),
  scene("mirror-waves", "Mirror waves", { axes: ["horizontal"], marks: [{ layer: "aqua", points: L.wave({ y: 0.3, amp: 0.1, cycles: 3 }), duration: 2600, axes: ["horizontal"] }, { layer: "rose", points: L.wave({ y: 0.45, amp: 0.15, cycles: 1.5 }), duration: 3000, axes: ["horizontal"] }], layers: { aqua: { waveform: "sine" }, rose: { waveform: "triangle" } } }),
  scene("quad-kaleidoscope", "Quad kaleidoscope", { axes: ["horizontal", "vertical"], marks: [{ layer: "gold", points: L.polygon({ sides: 4, r: 0.3, phase: 0 }), duration: 2200, axes: ["horizontal", "vertical"] }, { layer: "violet", points: L.circle({ cx: 0.35, cy: 0.35, r: 0.12 }), duration: 1400, axes: ["horizontal", "vertical"] }], mapping: { coordinateMode: "polar", xTarget: "pitch", yTarget: "pan", sizeTarget: "gain" } }),
  scene("spoke-chimes", "Spoke chimes", { marks: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ layer: i % 2 ? "gold" : "aqua", points: L.spoke({ angle: i * Math.PI / 4 }), duration: 520, gap: 240 })), mapping: { coordinateMode: "spokes", radialSpokes: 8, xTarget: "pitch", yTarget: "shepard", sizeTarget: "brightness" }, layers: { gold: { waveform: "fm", envelope: baseEnvelope(2, 80, 0.35, 420) } } }),
  scene("steady-figure-eight", "Steady figure eight", { marks: [{ layer: "aqua", points: L.lissajous({ a: 1, b: 2 }), duration: 4200 }], mapping: { xTarget: "pan", yTarget: "ouroboros", sizeTarget: "none", pitchMin: 80, pitchMax: 1000 }, playbackMode: "steady", speed: 0.25, gap: 900 }),
  scene("staircase-arpeggio", "Staircase arpeggio", { marks: [{ layer: "gold", points: L.stairs({ steps: 8 }), duration: 2400 }, { layer: "rose", points: L.stairs({ x0: 0.9, x1: 0.1, steps: 5 }), duration: 1800 }], layers: { gold: { waveform: "square", envelope: baseEnvelope(2, 60, 0.3, 120) } }, playbackMode: "steady", speed: 0.5, gap: 200, mapping: { pitchMin: 110, pitchMax: 1760 } }),
  scene("slow-violet-tide", "Slow violet tide", { marks: [{ layer: "violet", points: L.wave({ y: 0.55, amp: 0.25, cycles: 1 }), duration: 6000 }, { layer: "violet", points: L.wave({ y: 0.4, amp: 0.18, cycles: 1.5, phase: 1 }), duration: 7000, at: 800 }], layers: { violet: { waveform: "sawtooth", envelope: baseEnvelope(900, 600, 0.85, 2600) } }, mapping: { pitchMin: 40, pitchMax: 440, yTarget: "pitch", sizeTarget: "gain" }, rate: 0.5, gap: 1500 }),
  scene("diagonal-rain", "Diagonal rain", { axes: ["antiDiagonal"], marks: [0, 1, 2, 3, 4].map(i => ({ layer: i % 2 ? "rose" : "aqua", points: L.line({ x0: 0.1 + i * 0.16, y0: 0.1, x1: 0.2 + i * 0.16, y1: 0.55 }), duration: 700, gap: 180, axes: ["antiDiagonal"] })), mapping: { xTarget: "brightness", yTarget: "pitch", sizeTarget: "pan" }, rate: 1.25 }),
  scene("pluck-constellation", "Pluck constellation", { marks: [[0.2, 0.25], [0.7, 0.2], [0.45, 0.5], [0.15, 0.7], [0.8, 0.65], [0.55, 0.85], [0.35, 0.15]].map(([x, y], i) => ({ layer: PAINT_LAYER_IDS[i % 4], points: L.tick({ x, y, dx: 0.03, dy: 0.02 }), duration: 160, gap: 120 + (i % 3) * 80, brush: 0.02 })), layers: { aqua: { envelope: baseEnvelope(2, 60, 0.1, 300) }, gold: { envelope: baseEnvelope(1, 40, 0.1, 200) } }, rate: 1.5, mapping: { pitchMin: 150, pitchMax: 3200 } }),
  scene("shepard-ramp", "Shepard ramp", { marks: [{ layer: "aqua", points: L.line({ x0: 0.1, y0: 0.9, x1: 0.9, y1: 0.1 }), duration: 5000 }, { layer: "violet", points: L.line({ x0: 0.1, y0: 0.7, x1: 0.9, y1: 0.3 }), duration: 5000, at: 0 }], mapping: { yTarget: "shepard", xTarget: "pan", sizeTarget: "none", pitchMin: 55, pitchMax: 880 }, gap: 600 }),
  scene("ouroboros-orbit", "Ouroboros orbit", { marks: [{ layer: "gold", points: L.circle({ r: 0.32 }), duration: 3600 }, { layer: "aqua", points: L.circle({ r: 0.18, phase: 1 }), duration: 2400, at: 0 }], mapping: { coordinateMode: "polar", xTarget: "ouroboros", yTarget: "pan", sizeTarget: "modulationDepth" }, layers: { gold: { waveform: "fm" } } }),
  scene("triangle-sweep-drone", "Triangle sweep drone", { marks: [{ layer: "violet", points: L.polygon({ sides: 3, r: 0.4 }), duration: 5000 }, { layer: "rose", points: L.polygon({ sides: 3, r: 0.22, phase: Math.PI / 2 }), duration: 4000, at: 600 }], transform: { rotationDeg: 15, scaleX: 0.8, scaleY: 1.1, translateX: 0.05 }, layers: { violet: { waveform: "triangle", envelope: baseEnvelope(400, 500, 0.8, 1800) } }, mapping: { pitchMin: 45, pitchMax: 600 } }),
  scene("square-pulse-grid", "Square pulse grid", { marks: [0.2, 0.4, 0.6, 0.8].flatMap((y, row) => [0.15, 0.4, 0.65].map((x, col) => ({ layer: row % 2 ? "gold" : "aqua", points: L.tick({ x, y, dx: 0.12, dy: 0 }), duration: 260, gap: 80 + col * 40, brush: 0.016 }))), layers: { aqua: { waveform: "square", envelope: baseEnvelope(1, 30, 0.6, 80) }, gold: { waveform: "square", envelope: baseEnvelope(1, 30, 0.4, 60) } }, playbackMode: "steady", speed: 0.6, gap: 100, mapping: { pitchMin: 90, pitchMax: 1500, sizeTarget: "gain" } }),
  scene("zigzag-duet", "Zigzag duet", { axes: ["vertical"], marks: [{ layer: "rose", points: L.zigzag({ teeth: 5, y0: 0.7, y1: 0.4 }), duration: 2000, axes: ["vertical"] }, { layer: "gold", points: L.zigzag({ teeth: 8, y0: 0.35, y1: 0.15 }), duration: 1600, axes: ["vertical"] }], mapping: { xTarget: "pan", yTarget: "pitch", sizeTarget: "brightness", pitchMin: 120, pitchMax: 2400 }, rate: 1.1, gap: 400 }),
  scene("eight-fold-flower", "Eight-fold flower", { axes: ["horizontal", "vertical", "diagonal"], marks: [{ layer: "aqua", points: L.spiral({ cx: 0.3, cy: 0.3, r0: 0.02, r1: 0.14, turns: 1.5 }), duration: 2400, axes: ["horizontal", "vertical", "diagonal"] }], mapping: { coordinateMode: "polar", xTarget: "pitch", yTarget: "brightness", sizeTarget: "gain", pitchMin: 100, pitchMax: 1800 }, layers: { aqua: { waveform: "triangle" } } }),
]);

const PAINT_ENVELOPE_RANGES = { attackMs: [1, 900], decayMs: [30, 700], sustain: [0.1, 0.95], releaseMs: [60, 2600] };

export function randomizePaintPreset(current, random = Math.random) {
  presetStateKey(current);
  const rng = presetRandom(random);
  const shapeNames = Object.keys(SHAPES);
  const axes = REFLECTION_AXES.filter(() => rng.unit() < 0.3);
  const layers = PAINT_LAYER_IDS.map(id => ({
    id, waveform: rng.pick(PAINT_WAVEFORMS),
    envelope: Object.fromEntries(Object.entries(PAINT_ENVELOPE_RANGES).map(([key, [lo, hi]]) => [key, round(rng.between(lo, hi), key === "sustain" ? 2 : 0)])),
  }));
  const count = rng.integer(3, 9);
  let cursor = 0;
  const marks = Array.from({ length: count }, (_, index) => {
    const name = rng.pick(shapeNames);
    const cx = rng.between(0.25, 0.75), cy = rng.between(0.25, 0.75);
    const params = { cx, cy, r: rng.between(0.1, 0.38), r0: rng.between(0.02, 0.1), r1: rng.between(0.2, 0.45), turns: rng.between(1, 4),
      phase: rng.between(0, 6.28), x: cx, y: cy, dx: rng.between(-0.15, 0.15), dy: rng.between(-0.15, 0.15), amp: rng.between(0.05, 0.3),
      cycles: rng.between(0.5, 4), x0: rng.between(0.05, 0.4), x1: rng.between(0.6, 0.95), y0: rng.between(0.5, 0.9), y1: rng.between(0.1, 0.5),
      rx: rng.between(0.15, 0.42), ry: rng.between(0.15, 0.42), a: rng.integer(1, 3), b: rng.integer(1, 4), sides: rng.integer(3, 7),
      teeth: rng.integer(3, 9), steps: rng.integer(3, 10), angle: rng.between(0, 6.28) };
    const duration = rng.between(300, 4500), at = rng.unit() < 0.25 ? Math.max(0, cursor - duration / 2) : cursor;
    cursor = at + duration + rng.between(40, 400);
    const layer = rng.pick(PAINT_LAYER_IDS);
    return buildPaintMark(`m${index + 1}`, {
      layer, envelope: layers.find(item => item.id === layer).envelope, points: SHAPES[name](params), duration, at, axes: rng.unit() < 0.5 ? axes : [],
      brush: rng.between(0.006, 0.04), pressure: rng.unit() < 0.4 ? (u => 0.3 + 0.6 * u) : undefined,
    });
  });
  const pitchMin = round(40 * 8 ** rng.unit(), 0);
  const mode = rng.pick(PAINT_COORDINATE_MODES);
  return validatePaintPreset({
    marks, layers, axes,
    mapping: {
      coordinateMode: mode, radialSpokes: rng.integer(3, 16), xTarget: rng.pick(PAINT_TARGETS), yTarget: rng.pick(PAINT_TARGETS), sizeTarget: rng.pick(PAINT_TARGETS),
      pitchMin, pitchMax: Math.min(6000, round(Math.max(220, pitchMin) * 2 ** rng.between(1, 4.5), 0)),
    },
    sceneTransform: {
      translateX: round(rng.between(-0.3, 0.3), 2), translateY: round(rng.between(-0.3, 0.3), 2),
      rotationDeg: round(rng.between(-90, 90), 0), scaleX: round(rng.between(0.6, 1.6), 2), scaleY: round(rng.between(0.6, 1.6), 2),
    },
    playbackMode: rng.pick(PAINT_PLAYBACK_MODES), playbackRate: round(rng.between(0.4, 1.8), 2),
    steadySpeed: round(rng.between(0.1, 1), 2), loopGapMs: round(rng.between(0, 1500), 0),
  });
}
