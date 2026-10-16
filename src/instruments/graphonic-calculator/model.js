import { analyzeRows, parameterText } from "./expressions.js";
import { FORMULA_LIBRARY } from "./formulas.js";
import { ROW_ROLES, sanitizeDrum } from "./triggers.js";
import { LINE_AXES, MAX_HEADS, MOTION_MODES, PITCH_SOURCES, PLAYBACK_MODES } from "./readers.js";
import { canonicalHeadOffsets, sanitizeHeadOffsets } from "../../playheads.js";
import { DEFAULT_RANGE } from "./geometry.js";
export { DEFAULT_RANGE };
import { VOICES, GLIDE } from "./audio.js";

const TAU = Math.PI * 2;

export const COLORS = Object.freeze(["#61e9ce", "#f6b57c", "#c9a6ff", "#ff7d8a", "#6fb7ff", "#ffe066"]);
export const MAX_ROWS = 40;
export const MAX_TEXT_LENGTH = 240;
export const ANGLE_MODES = Object.freeze(["radians", "degrees"]);
export const SLIDER_MODES = Object.freeze(["bounce", "loop", "once"]);
export const SLIDER_SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4]);
export const SLIDER_DEFAULTS = Object.freeze({ min: -10, max: 10, step: 0, animating: false, mode: "bounce", speed: 1 });
export const SLIDER_TRAVERSAL_SECONDS = 4;
export const SWEEP_SECONDS = Object.freeze({ min: 1, max: 60, default: 5 });
export const SWEEP_TEMPO = Object.freeze({ min: 1, max: 60, default: 12 });
export const sweepTempoFromSeconds = (seconds) => 60 / seconds;
export const sweepSecondsFromTempo = (tempo) => 60 / tempo;
export const TRACE_OCTAVES = Object.freeze({ min: 1, max: 4, default: 2 });
export const DEFAULT_SETTINGS = Object.freeze({
  angle: "radians", sweepSeconds: SWEEP_SECONDS.default, traceOctaves: TRACE_OCTAVES.default,
  playback: "line", motion: "loop", direction: 1, heads: 1, headOffsets: Object.freeze([0]),
  headAxes: Object.freeze(Array(MAX_HEADS).fill("vertical")), headDirections: Object.freeze(Array(MAX_HEADS).fill(1)),
  pitchSource: "height", voice: "sine", timbre: 0.5, glide: GLIDE.default, region: null,
});
export const DEFAULT_VIEW = Object.freeze({ xMin: -10, xMax: 10, yMin: -7, yMax: 7 });
export const VIEW_SPAN_LIMITS = Object.freeze({ min: 1e-9, max: 1e15 });

let rowCounter = 0;
export const nextRowId = () => `row-${++rowCounter}`;

const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createRow(text = "", overrides = {}) {
  return sanitizeRow({ id: nextRowId(), text, color: COLORS[0], visible: true, slider: null, range: null, ...overrides });
}

export function sanitizeRow(row, index = 0) {
  const source = row && typeof row === "object" ? row : {};
  const text = typeof source.text === "string" ? source.text.slice(0, MAX_TEXT_LENGTH) : "";
  const color = COLORS.includes(source.color) ? source.color : COLORS[index % COLORS.length];
  return {
    id: typeof source.id === "string" && source.id ? source.id : nextRowId(),
    text,
    color,
    visible: source.visible !== false,
    slider: sanitizeSlider(source.slider),
    range: sanitizeRange(source.range),
    role: ROW_ROLES.includes(source.role) ? source.role : "contour",
    drum: source.role === "drums" ? sanitizeDrum(source.drum) : null,
  };
}

export function sanitizeSlider(slider) {
  if (!slider || typeof slider !== "object") return null;
  let min = finite(Number(slider.min), SLIDER_DEFAULTS.min);
  let max = finite(Number(slider.max), SLIDER_DEFAULTS.max);
  if (min > max) [min, max] = [max, min];
  if (min === max) { min = SLIDER_DEFAULTS.min; max = SLIDER_DEFAULTS.max; }
  const step = Math.max(0, finite(Number(slider.step), 0));
  const mode = SLIDER_MODES.includes(slider.mode) ? slider.mode : SLIDER_DEFAULTS.mode;
  const speed = SLIDER_SPEEDS.includes(Number(slider.speed)) ? Number(slider.speed) : SLIDER_DEFAULTS.speed;
  return { min, max, step: step > max - min ? 0 : step, animating: slider.animating === true, mode, speed };
}

export function sanitizeRange(range) {
  if (!Array.isArray(range) || range.length !== 2) return null;
  let [low, high] = range.map((value) => finite(Number(value), NaN));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [...DEFAULT_RANGE];
  if (low > high) [low, high] = [high, low];
  if (low === high) return [...DEFAULT_RANGE];
  return [clamp(low, -1e6, 1e6), clamp(high, -1e6, 1e6)];
}

export function sanitizeView(view) {
  const source = view && typeof view === "object" ? view : {};
  let xMin = finite(Number(source.xMin), NaN), xMax = finite(Number(source.xMax), NaN);
  let yMin = finite(Number(source.yMin), NaN), yMax = finite(Number(source.yMax), NaN);
  const valid = (low, high) => Number.isFinite(low) && Number.isFinite(high) && high - low >= VIEW_SPAN_LIMITS.min && high - low <= VIEW_SPAN_LIMITS.max
    && Math.abs(low) <= VIEW_SPAN_LIMITS.max && Math.abs(high) <= VIEW_SPAN_LIMITS.max;
  if (!valid(xMin, xMax)) ({ xMin, xMax } = DEFAULT_VIEW);
  if (!valid(yMin, yMax)) ({ yMin, yMax } = DEFAULT_VIEW);
  return { xMin, xMax, yMin, yMax };
}

export function sanitizeSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  return withHeadOffsets({
    angle: ANGLE_MODES.includes(source.angle) ? source.angle : DEFAULT_SETTINGS.angle,
    sweepSeconds: clamp(finite(Number(source.sweepSeconds), SWEEP_SECONDS.default), SWEEP_SECONDS.min, SWEEP_SECONDS.max),
    traceOctaves: clamp(finite(Number(source.traceOctaves), TRACE_OCTAVES.default), TRACE_OCTAVES.min, TRACE_OCTAVES.max),
    playback: PLAYBACK_MODES.includes(source.playback) ? source.playback : DEFAULT_SETTINGS.playback,
    motion: MOTION_MODES.includes(source.motion) ? source.motion : DEFAULT_SETTINGS.motion,
    direction: Number(source.direction) < 0 ? -1 : 1,
    heads: clamp(Math.round(finite(Number(source.heads), DEFAULT_SETTINGS.heads)), 1, MAX_HEADS),
    headOffsets: [],
    headAxes: Array.from({ length: MAX_HEADS }, (_, head) => (LINE_AXES.includes(source.headAxes?.[head]) ? source.headAxes[head] : "vertical")),
    headDirections: Array.from({ length: MAX_HEADS }, (_, head) => (Number(source.headDirections?.[head]) < 0 ? -1 : 1)),
    pitchSource: PITCH_SOURCES.includes(source.pitchSource) ? source.pitchSource : DEFAULT_SETTINGS.pitchSource,
    voice: VOICES.includes(source.voice) ? source.voice : DEFAULT_SETTINGS.voice,
    timbre: clamp(finite(Number(source.timbre), DEFAULT_SETTINGS.timbre), 0, 1),
    glide: clamp(finite(Number(source.glide), GLIDE.default), GLIDE.min, GLIDE.max),
    region: sanitizeRegion(source.region),
  }, source);
}

/** The play region is a world-space box; null means the reader follows the view. */
export function sanitizeRegion(region) {
  if (!region || typeof region !== "object") return null;
  const values = ["xMin", "xMax", "yMin", "yMax"].map((key) => Number(region[key]));
  if (!values.every(Number.isFinite)) return null;
  const [xMin, xMax, yMin, yMax] = values;
  const xSpan = xMax - xMin, ySpan = yMax - yMin;
  if (!(xSpan >= VIEW_SPAN_LIMITS.min && xSpan <= VIEW_SPAN_LIMITS.max && ySpan >= VIEW_SPAN_LIMITS.min && ySpan <= VIEW_SPAN_LIMITS.max)) return null;
  return { xMin, xMax, yMin, yMax };
}

function withHeadOffsets(settings, source) {
  const offsets = Array.isArray(source?.headOffsets) ? sanitizeHeadOffsets(source.headOffsets, settings.heads, "parallel") : canonicalHeadOffsets(settings.heads, "parallel");
  return { ...settings, headOffsets: offsets.map((offset) => Number(offset.toFixed(6))) };
}

export function sanitizeState(state) {
  const source = state && typeof state === "object" ? state : {};
  const rows = (Array.isArray(source.rows) ? source.rows : []).slice(0, MAX_ROWS).map(sanitizeRow);
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) row.id = nextRowId();
    ids.add(row.id);
  }
  return { rows, view: sanitizeView(source.view), settings: sanitizeSettings(source.settings) };
}

export function createState(overrides = {}) {
  return sanitizeState({ rows: [], view: DEFAULT_VIEW, settings: DEFAULT_SETTINGS, ...overrides });
}

/** Preset-owned scene without session identity: ids, slider motion direction and trailing empty rows are dropped. */
export function snapshotOf(state) {
  const rows = state.rows.map(({ text, color, visible, slider, range, role, drum }) => ({
    text, color, visible,
    slider: slider ? { min: slider.min, max: slider.max, step: slider.step, animating: slider.animating, mode: slider.mode, speed: slider.speed } : null,
    range: range ? [range[0], range[1]] : null,
    role: role === "drums" ? "drums" : "contour",
    drum: role === "drums" && drum ? { ...drum } : null,
  }));
  while (rows.length && !rows.at(-1).text.trim()) rows.pop();
  return { rows, view: { ...state.view }, settings: { ...state.settings } };
}

export function applySnapshot(snapshot) {
  const clean = sanitizeState(snapshot);
  return { ...clean, rows: clean.rows.map((row) => ({ ...row, id: nextRowId() })) };
}

export function nextColor(rows) {
  const used = new Set(rows.map((row) => row.color));
  return COLORS.find((color) => !used.has(color)) ?? COLORS[rows.length % COLORS.length];
}

export function analyzeState(state) {
  return analyzeRows(state.rows, { angle: state.settings.angle });
}

export function updateRows(state, mapper) {
  return { ...state, rows: state.rows.map(mapper) };
}

export function updateRow(state, id, changes) {
  return updateRows(state, (row) => (row.id === id ? sanitizeRow({ ...row, ...changes }) : row));
}

export function addRow(state, text = "", overrides = {}) {
  if (state.rows.length >= MAX_ROWS) return state;
  return { ...state, rows: [...state.rows, createRow(text, { color: nextColor(state.rows), ...overrides })] };
}

export function removeRow(state, id) {
  return { ...state, rows: state.rows.filter((row) => row.id !== id) };
}

export function moveRow(state, id, delta) {
  const index = state.rows.findIndex((row) => row.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= state.rows.length) return state;
  const rows = [...state.rows];
  [rows[index], rows[target]] = [rows[target], rows[index]];
  return { ...state, rows };
}

export function addSliders(state, names) {
  let next = state;
  for (const name of names) {
    if (next.rows.length >= MAX_ROWS) break;
    next = addRow(next, parameterText(name, 1), { slider: { ...SLIDER_DEFAULTS } });
  }
  return next;
}

/** Give every literal parameter row a slider so its value can be dragged, like Desmos offers. */
export function ensureSliders(state, analysis) {
  let changed = false;
  const rows = state.rows.map((row, index) => {
    const info = analysis.rows[index];
    if (info?.kind === "parameter" && info.definition?.slider && !row.slider) { changed = true; return { ...row, slider: { ...SLIDER_DEFAULTS } }; }
    if (row.slider && !(info?.kind === "parameter" && info.definition?.slider)) { changed = true; return { ...row, slider: null }; }
    return row;
  });
  return changed ? { ...state, rows } : state;
}

export function setParameterValue(state, id, value, analysis) {
  const index = state.rows.findIndex((row) => row.id === id);
  const info = analysis?.rows[index];
  const name = info?.definition?.name;
  if (index < 0 || !name || !Number.isFinite(value)) return state;
  return updateRow(state, id, { text: parameterText(name, value) });
}

export function sliderValue(row, analysis, index) {
  const value = analysis?.rows[index]?.value;
  return Number.isFinite(value) ? value : 0;
}

export function advanceSliders(state, analysis, deltaSeconds, directions) {
  let changed = false;
  const rows = state.rows.map((row, index) => {
    if (!row.slider?.animating) return row;
    const info = analysis.rows[index];
    const name = info?.definition?.name;
    if (!name || !Number.isFinite(info.value)) return row;
    const { min, max, mode, speed } = row.slider;
    const span = max - min;
    let direction = mode === "bounce" ? (directions.get(row.id) ?? 1) : 1;
    let value = info.value + (direction * span * deltaSeconds * speed) / SLIDER_TRAVERSAL_SECONDS;
    let animating = true;
    if (mode === "loop") { value = value > max ? min + ((value - min) % span) : value; }
    else if (mode === "once") { if (value >= max) { value = max; animating = false; } }
    else {
      if (value > max) { value = max - (value - max); direction = -1; }
      if (value < min) { value = min + (min - value); direction = 1; }
    }
    value = clamp(value, min, max);
    directions.set(row.id, direction);
    changed = true;
    return { ...row, slider: animating ? row.slider : { ...row.slider, animating: false }, text: parameterText(name, value) };
  });
  return changed ? { ...state, rows } : state;
}

const scene = (id, label, rows, view, settings = {}) => ({
  id, label,
  snapshot: {
    rows: rows.map((row, index) => ({ text: row.text, color: row.color ?? COLORS[index % COLORS.length], visible: row.visible ?? true, slider: row.slider === undefined ? null : sanitizeSlider(row.slider), range: row.range ?? null, role: row.role ?? "contour", drum: row.role === "drums" ? sanitizeDrum(row.drum) : null })),
    view: { ...view },
    settings: sanitizeSettings({ ...DEFAULT_SETTINGS, ...settings }),
  },
});
const slider = (text, min = -10, max = 10, extra = {}) => ({ text, slider: { min, max, step: 0, animating: false }, ...extra });
const view = (xMin, xMax, yMin, yMax) => ({ xMin, xMax, yMin, yMax });

export const PRESETS = Object.freeze([
  scene("parabola-tangent", "Parabola & tangent", [
    { text: "y = x^2" }, slider("a = 1", -3, 3), { text: "y = 2a x - a^2" }, { text: "(a, a^2)" },
  ], view(-6, 6, -2, 10)),
  scene("trig-family", "Trig family", [
    { text: "sin(x)" }, { text: "cos(x)" }, { text: "tan(x)" },
  ], view(-7, 7, -4, 4), { sweepSeconds: 10, heads: 2, headAxes: ["vertical", "horizontal"] }),
  scene("circle-line", "Circle & line", [
    slider("R = 3", 0.5, 6), { text: "x^2 + y^2 = R^2" }, slider("m = 0.5", -4, 4), { text: "y = m x + 1" },
  ], view(-7, 7, -5, 5), { playback: "radar", pitchSource: "radius" }),
  scene("polar-rose", "Polar rose", [
    slider("k = 3", 1, 8, { slider: { min: 1, max: 8, step: 1, animating: false } }), { text: "r = cos(kθ)", range: [0, TAU] },
  ], view(-1.6, 1.6, -1.1, 1.1), { sweepSeconds: 12, playback: "radar", pitchSource: "radius" }),
  scene("lissajous", "Lissajous", [
    slider("a = 3", 1, 8, { slider: { min: 1, max: 8, step: 1, animating: false } }), slider("b = 2", 1, 8, { slider: { min: 1, max: 8, step: 1, animating: false } }),
    { text: "(sin(a t), cos(b t))", range: [0, TAU] },
  ], view(-1.6, 1.6, -1.1, 1.1), { sweepSeconds: 12, playback: "points", heads: 2 }),
  scene("gaussian", "Gaussian bell", [
    slider("s = 1", 0.2, 3), slider("m = 0", -4, 4), { text: "y = e^(-(x - m)^2 / (2s^2)) / (s sqrt(2π))" }, { text: "x = m" },
  ], view(-5, 5, -0.2, 0.9)),
  scene("steps-poles", "Steps & poles", [
    { text: "floor(x)" }, { text: "1/x" }, { text: "|x|" },
  ], view(-5, 5, -4, 4), { sweepSeconds: 6 }),
  scene("implicit-heart", "Implicit heart", [
    { text: "(x^2 + y^2 - 1)^3 = x^2 y^3" }, { text: "x^2 + y^2 = 1" },
  ], view(-1.8, 1.8, -1.3, 1.5), { playback: "points", motion: "pingpong" }),
  scene("draggable-point", "Draggable point", [
    slider("a = 2", -6, 6), slider("b = 3", -6, 6), { text: "(a, b)" }, { text: "y = b x / a" }, { text: "x^2 + y^2 = a^2 + b^2" },
  ], view(-8, 8, -6, 6)),
  scene("shaded-region", "Shaded region", [
    { text: "y < x^2" }, { text: "y >= 2x - 1" }, { text: "y = x^2" },
  ], view(-5, 5, -3, 8)),
  scene("composition", "Composition", [
    { text: "f(x) = x^2 - 2" }, { text: "g(x) = sin(x)" }, { text: "y = f(g(x))" }, { text: "y = g(f(x))" },
  ], view(-6, 6, -3, 3), { sweepSeconds: 10 }),
  scene("damped-wave", "Damped wave", [
    slider("d = 0.3", 0, 1.5), slider("w = 4", 0.5, 12), { text: "y = e^(-d x) sin(w x)" }, { text: "y = e^(-d x)" }, { text: "y = -e^(-d x)" },
  ], view(0, 12, -1.2, 1.2), { sweepSeconds: 8 }),
  scene("spiral", "Spiral", [
    slider("c = 0.25", 0.05, 1), { text: "r = cθ", range: [0, 8 * Math.PI] }, { text: "r = -cθ", range: [0, 8 * Math.PI] },
  ], view(-8, 8, -6, 6), { sweepSeconds: 14, playback: "radar", pitchSource: "radius", heads: 2 }),
  scene("logs-exponentials", "Logs & exponentials", [
    { text: "e^x" }, { text: "ln(x)" }, { text: "y = x" }, { text: "2^x" }, { text: "log(x)" },
  ], view(-6, 6, -4, 5)),
  scene("degrees", "Degrees", [
    { text: "sin(x)" }, { text: "cos(x)" }, slider("p = 90", -180, 180), { text: "x = p" },
  ], view(-400, 400, -1.6, 1.6), { angle: "degrees", sweepSeconds: 10 }),
  scene("fourier-square", "Fourier square wave", [
    slider("k = 1", 0.5, 3), { text: "y = sin(kx)" }, { text: "y = sin(3kx)/3" }, { text: "y = sin(5kx)/5" }, { text: "y = sin(7kx)/7" },
    { text: "y = sin(kx) + sin(3kx)/3 + sin(5kx)/5 + sin(7kx)/7" },
  ], view(-7, 7, -1.4, 1.4), { sweepSeconds: 10 }),
  scene("sawtooth-partials", "Sawtooth partials", [
    slider("p = 1", 0.5, 3), { text: "y = sin(x)" }, { text: "y = -sin(2x)/2^p" }, { text: "y = sin(3x)/3^p" }, { text: "y = -sin(4x)/4^p" },
    { text: "y = sin(x) - sin(2x)/2^p + sin(3x)/3^p - sin(4x)/4^p + sin(5x)/5^p" },
  ], view(-7, 7, -1.6, 1.6), { sweepSeconds: 10 }),
  scene("harmonic-numbers", "Harmonic numbers", [
    { text: "y = 1/x" }, { text: "y = ln(x) + 0.5772" }, { text: "(1, 1)" }, { text: "(2, 1.5)" }, { text: "(3, 1.8333)" }, { text: "(4, 2.0833)" }, { text: "(5, 2.2833)" }, { text: "(6, 2.45)" },
  ], view(-0.5, 8, -0.5, 3.2), { sweepSeconds: 6 }),
  scene("beats", "Beats", [
    slider("a = 10", 1, 20), slider("b = 11", 1, 20), { text: "y = sin(a x) + sin(b x)" }, { text: "y = 2cos((a - b)x/2)" }, { text: "y = -2cos((a - b)x/2)" },
  ], view(-7, 7, -2.4, 2.4), { sweepSeconds: 12 }),
  scene("consonant-ratios", "Consonant ratios", [
    { text: "y = sin(x)" }, { text: "y = sin(2x) + 2.5" }, { text: "y = sin(1.5x) + 5" }, { text: "y = sin(1.25x) + 7.5" }, { text: "y = sin(1.0595x) + 10" },
  ], view(0, 4 * Math.PI, -1.5, 11.5), { sweepSeconds: 10 }),
  scene("drum-grid", "Drum grid & bass line", [
    { text: "y = 3sin(x) + 4", role: "drums", drum: { placement: "x", count: 8, voice: "fm-kick" } },
    { text: "y = 2cos(2x) - 1", role: "drums", drum: { placement: "equidistant", count: 6, voice: "closed-hat" } },
    slider("a = 1", 0.25, 3), { text: "y = -4 + sin(a x)" },
  ], view(0, 4 * Math.PI, -7, 9), { sweepSeconds: 4 }),
  scene("polyrhythm-curves", "Polyrhythm curves", [
    { text: "y = sin(x)", role: "drums", drum: { placement: "x", count: 4, voice: "sub-kick" } },
    { text: "y = sin(x) + 2.5", role: "drums", drum: { placement: "x", count: 3, voice: "snap-snare" } },
    { text: "y = sin(x) + 5", role: "drums", drum: { placement: "equidistant", count: 7, voice: "rim-shot", pitch: 12 } },
    { text: "y = 0.5 sin(3x) - 3" },
  ], view(0, 4 * Math.PI, -5, 7), { sweepSeconds: 6 }),
  ...FORMULA_LIBRARY.map((formula) => scene(formula.id, formula.label, formula.rows, formula.view, formula.settings)),
]);

export const DEFAULT_PRESET_ID = "parabola-tangent";

const TEMPLATES = Object.freeze([
  { letters: ["a", "b"], ranges: [[-2, 2], [-3, 3]], rows: ["y = a x^2 + b x"], span: 8 },
  { letters: ["c", "d"], ranges: [[0.5, 2.5], [0.5, 4]], rows: ["y = c sin(d x)"], span: 8 },
  { letters: ["k"], ranges: [[2, 7]], integer: true, rows: ["r = cos(kθ)"], span: 1.6, range: [0, TAU] },
  { letters: ["p", "q"], ranges: [[1, 6], [1, 6]], integer: true, rows: ["(sin(p t), cos(q t))"], span: 1.6, range: [0, TAU] },
  { letters: ["s"], ranges: [[0.3, 2]], rows: ["y = e^(-s x^2)"], span: 5 },
  { letters: ["R"], ranges: [[1, 5]], rows: ["x^2 + y^2 = R^2"], span: 7 },
  { letters: ["h"], ranges: [[-3, 3]], rows: ["y = |x - h|"], span: 6 },
  { letters: ["n"], ranges: [[0.5, 3]], rows: ["y = floor(n x)"], span: 5 },
  { letters: ["u"], ranges: [[0.5, 4]], rows: ["y = u / x"], span: 6 },
  { letters: ["v"], ranges: [[0.3, 2]], rows: ["y = e^(-v x) sin(4x)", "y = e^(-v x)"], span: 8 },
  { letters: ["w"], ranges: [[0.5, 3]], rows: ["y = tan(x / w)"], span: 7 },
  { letters: ["g"], ranges: [[0.5, 4]], rows: ["y = ln(x + g)"], span: 6 },
]);

const roundTo = (value, decimals) => Number(value.toFixed(decimals));

function pickDistinct(count, total, random) {
  const indices = [...Array(total).keys()];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, count);
}

/**
 * Bounded full-scene randomization: two to four templates with fresh slider values and
 * colors, a framing that fits them, and a sweep tempo. Pure in `random`; returns an id-free snapshot.
 */
export function randomizeState(snapshot, random = Math.random) {
  const base = sanitizeState(snapshot);
  const count = 2 + Math.floor(random() * 3);
  const chosen = pickDistinct(count, TEMPLATES.length, random).map((index) => TEMPLATES[index]);
  const colors = pickDistinct(COLORS.length, COLORS.length, random).map((index) => COLORS[index]);
  const rows = [];
  let colorIndex = 0;
  let span = 0;
  for (const template of chosen) {
    template.letters.forEach((letter, index) => {
      const [low, high] = template.ranges[index];
      const value = template.integer ? Math.round(low + random() * (high - low)) : roundTo(low + random() * (high - low), 1);
      const text = parameterText(letter, value);
      rows.push({ text, color: colors[colorIndex++ % colors.length], visible: true, slider: { ...SLIDER_DEFAULTS, min: template.integer ? low : -10, max: template.integer ? high : 10, step: template.integer ? 1 : 0 }, range: null });
    });
    for (const text of template.rows) {
      rows.push({ text, color: colors[colorIndex++ % colors.length], visible: true, slider: null, range: template.range ? [...template.range] : null });
    }
    span = Math.max(span, template.span);
  }
  const zoom = roundTo(0.7 + random() * 0.9, 2);
  const degrees = random() < 0.12;
  const halfWidth = roundTo(span * zoom * (degrees ? 180 / Math.PI : 1), degrees ? 0 : 2);
  const halfHeight = roundTo(span * zoom * 0.7, 2);
  const sweepSeconds = roundTo(SWEEP_SECONDS.min + 2 + random() * 12, 0);
  const traceOctaves = roundTo(TRACE_OCTAVES.min + random() * (TRACE_OCTAVES.max - TRACE_OCTAVES.min), 1);
  const playback = PLAYBACK_MODES[Math.floor(random() * PLAYBACK_MODES.length)];
  const motion = MOTION_MODES[Math.floor(random() * MOTION_MODES.length)];
  const direction = random() < 0.3 ? -1 : 1;
  const heads = 1 + Math.floor(random() * 4);
  const headAxes = Array.from({ length: MAX_HEADS }, () => LINE_AXES[Math.floor(random() * LINE_AXES.length)]);
  const headDirections = Array.from({ length: MAX_HEADS }, () => (random() < 0.25 ? -1 : 1));
  const pitchSource = PITCH_SOURCES[Math.floor(random() * PITCH_SOURCES.length)];
  const voice = VOICES[Math.floor(random() * VOICES.length)];
  const timbre = roundTo(random(), 2);
  const glide = roundTo(GLIDE.min + random() * (0.2 - GLIDE.min), 3);
  return snapshotOf(sanitizeState({
    rows,
    view: { xMin: -halfWidth, xMax: halfWidth, yMin: -halfHeight, yMax: halfHeight },
    settings: { ...base.settings, angle: degrees ? "degrees" : "radians", sweepSeconds, traceOctaves, playback, motion, direction, heads, headAxes, headDirections, pitchSource, voice, timbre, glide },
  }));
}
