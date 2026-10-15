import test from "node:test";
import assert from "node:assert/strict";
import {
  COLORS, DEFAULT_SETTINGS, DEFAULT_VIEW, MAX_ROWS, PRESETS, SLIDER_DEFAULTS, addRow, addSliders, advanceSliders, analyzeState, applySnapshot,
  createState, ensureSliders, moveRow, nextColor, randomizeState, removeRow, sanitizeSlider, sanitizeState, setParameterValue, snapshotOf, updateRow,
} from "../src/instruments/graphonic-calculator/model.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const close = (actual, expected, tolerance = 1e-9, message = `${actual} != ${expected}`) => assert.ok(Math.abs(actual - expected) < tolerance, message);

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("state creation, sanitizing and snapshots stay finite and bounded", () => {
  const state = createState();
  assert.deepEqual(state.rows, []);
  assert.deepEqual(state.view, DEFAULT_VIEW);
  assert.deepEqual(state.settings, DEFAULT_SETTINGS);
  const hostile = sanitizeState({
    rows: [...Array(MAX_ROWS + 5)].map((_, i) => ({ id: "same", text: `${i}`.padEnd(400, "x"), color: "#000000", slider: { min: 5, max: -5, step: -1 }, range: [3, 3] })),
    view: { xMin: 2, xMax: 2, yMin: NaN, yMax: Infinity },
    settings: { angle: "grads", sweepSeconds: -4, traceOctaves: 99 },
  });
  assert.equal(hostile.rows.length, MAX_ROWS);
  assert.equal(new Set(hostile.rows.map((row) => row.id)).size, MAX_ROWS);
  assert.equal(hostile.rows[0].text.length, 240);
  assert.ok(COLORS.includes(hostile.rows[0].color));
  assert.deepEqual(hostile.rows[0].slider, { min: -5, max: 5, step: 0, animating: false, mode: "bounce", speed: 1 });
  assert.deepEqual(hostile.rows[0].range, [0, Math.PI * 2]);
  assert.deepEqual(hostile.view, DEFAULT_VIEW);
  assert.deepEqual(sanitizeState({ view: { xMin: 2e15, xMax: 2e15 + 10, yMin: -1, yMax: 1 } }).view, { xMin: -10, xMax: 10, yMin: -1, yMax: 1 }, "far-off positions fall back per axis");
  assert.deepEqual(sanitizeState({ view: { xMin: -5e14, xMax: 5e14, yMin: -1, yMax: 1 } }).view, { xMin: -5e14, xMax: 5e14, yMin: -1, yMax: 1 });
  assert.deepEqual(hostile.settings, { ...DEFAULT_SETTINGS, angle: "radians", sweepSeconds: 1, traceOctaves: 4, headOffsets: [0], headAxes: [...DEFAULT_SETTINGS.headAxes], headDirections: [...DEFAULT_SETTINGS.headDirections] });
  const wild = sanitizeState({ settings: { playback: "radar", motion: "pingpong", direction: -3, heads: 99, headAxes: ["horizontal", "sideways"], headDirections: [-1, 0, "x"], headOffsets: [0.2, 1.4, NaN], pitchSource: "radius", voice: "fm", timbre: 7, glide: 0 } }).settings;
  assert.deepEqual({ ...wild, headAxes: wild.headAxes.slice(0, 3), headDirections: wild.headDirections.slice(0, 3), headOffsets: wild.headOffsets.slice(0, 4) }, { ...DEFAULT_SETTINGS, playback: "radar", motion: "pingpong", direction: -1, heads: 12, headAxes: ["horizontal", "vertical", "vertical"], headDirections: [-1, 1, 1], headOffsets: [0.2, 0.4, 2 / 12, 3 / 12].map((v) => Number(v.toFixed(6))), pitchSource: "radius", voice: "fm", timbre: 1, glide: 0.005 });
  assert.equal(wild.headOffsets.length, 12);
  const trailing = sanitizeState({ rows: [{ text: "y = x" }, { text: " " }, { text: "" }] });
  assert.equal(snapshotOf(trailing).rows.length, 1);
  assert.doesNotThrow(() => presetStateKey(snapshotOf(trailing)));
  const applied = applySnapshot(snapshotOf(trailing));
  assert.notEqual(applied.rows[0].id, trailing.rows[0].id);
  assert.deepEqual(snapshotOf(applied), snapshotOf(trailing));
});

test("row editing helpers assign distinct colors and preserve order semantics", () => {
  let state = createState();
  for (let i = 0; i < COLORS.length + 1; i++) state = addRow(state, `y = x + ${i}`);
  assert.deepEqual(state.rows.slice(0, COLORS.length).map((row) => row.color), [...COLORS]);
  assert.equal(nextColor([]), COLORS[0]);
  assert.equal(nextColor([{ color: COLORS[0] }, { color: COLORS[2] }]), COLORS[1]);
  const [first, second] = state.rows;
  state = moveRow(state, second.id, -1);
  assert.deepEqual(state.rows.slice(0, 2).map((row) => row.id), [second.id, first.id]);
  assert.equal(moveRow(state, second.id, -1), state);
  state = removeRow(state, second.id);
  assert.equal(state.rows.some((row) => row.id === second.id), false);
  state = updateRow(state, first.id, { text: "y = 2x", visible: false, color: "nope" });
  assert.equal(state.rows[0].text, "y = 2x");
  assert.equal(state.rows[0].visible, false);
  assert.ok(COLORS.includes(state.rows[0].color));
});

test("sliders appear for literal parameters, rewrite text and bounce while animating", () => {
  let state = addRow(addRow(createState(), "a x^2"), "a = 2");
  let analysis = analyzeState(state);
  assert.deepEqual(analysis.rows[0].missing, []);
  state = ensureSliders(state, analysis);
  assert.deepEqual(state.rows[1].slider, { ...SLIDER_DEFAULTS });
  assert.equal(state.rows[0].slider, null);
  state = setParameterValue(state, state.rows[1].id, 2.5, analysis);
  assert.equal(state.rows[1].text, "a = 2.5");
  state = updateRow(state, state.rows[1].id, { text: "a = 2b" });
  analysis = analyzeState(state);
  state = ensureSliders(state, analysis);
  assert.equal(state.rows[1].slider, null, "derived parameters lose their slider");
  state = addSliders(state, ["b"]);
  assert.equal(state.rows.at(-1).text, "b = 1");
  assert.deepEqual(state.rows.at(-1).slider, { ...SLIDER_DEFAULTS });
  state = updateRow(state, state.rows.at(-1).id, { slider: { min: 0, max: 1, step: 0, animating: true, mode: "bounce", speed: 1 } });
  analysis = analyzeState(state);
  const directions = new Map();
  state = advanceSliders(state, analysis, 2, directions);
  const value = analyzeState(state).rows.at(-1).value;
  assert.ok(value <= 1 && value >= 0, `bounced value ${value}`);
  assert.equal(directions.get(state.rows.at(-1).id), -1);
  let lowest = 1;
  for (let i = 0; i < 40; i++) {
    state = advanceSliders(state, analyzeState(state), 0.5, directions);
    const current = analyzeState(state).rows.at(-1).value;
    assert.ok(current >= 0 && current <= 1);
    lowest = Math.min(lowest, current);
  }
  assert.ok(lowest < 0.2, "animation reaches the lower bound");
  assert.equal(advanceSliders(createState(), analyzeState(createState()), 1, new Map()).rows.length, 0);
});

test("preset bank satisfies the shared header contract and every scene analyzes cleanly", () => {
  assert.doesNotThrow(() => validateFullPresetBank(PRESETS));
  assert.ok(PRESETS.length >= 12);
  for (const preset of PRESETS) {
    const state = applySnapshot(preset.snapshot);
    assert.deepEqual(snapshotOf(state), preset.snapshot, `${preset.id} round-trips through sanitize`);
    const analysis = analyzeState(state);
    const errors = analysis.rows.filter((row) => row.error).map((row) => `${row.text}: ${row.error}`);
    assert.deepEqual(errors, [], preset.id);
    assert.ok(analysis.rows.some((row) => row.plot), `${preset.id} draws something`);
    for (const [index, row] of state.rows.entries()) {
      if (row.slider) assert.equal(analysis.rows[index].definition?.slider, true, `${preset.id}: ${row.text} slider matches a literal parameter`);
    }
  }
});

test("randomization is deterministic, bounded, valid and varies every scene-owned field", () => {
  const base = PRESETS[0].snapshot;
  const seen = { rowCounts: new Set(), texts: new Set(), colors: new Set(), spans: new Set(), sweeps: new Set(), angles: new Set(), octaves: new Set() };
  const random = mulberry32(7);
  for (let i = 0; i < 150; i++) {
    const result = randomizeState(base, random);
    assert.deepEqual(snapshotOf(applySnapshot(result)), result, "randomized snapshot round-trips through sanitize");
    assert.doesNotThrow(() => presetStateKey(result));
    const analysis = analyzeState(applySnapshot(result));
    assert.deepEqual(analysis.rows.filter((row) => row.error).map((row) => `${row.text}: ${row.error}`), []);
    assert.ok(analysis.rows.filter((row) => row.plot).length >= 2);
    assert.ok(result.rows.length <= 14);
    seen.rowCounts.add(result.rows.length);
    for (const row of result.rows) seen.texts.add(row.text.replace(/[\d.-]+/g, "#"));
    seen.colors.add(result.rows[0].color);
    seen.spans.add(result.view.xMax);
    seen.sweeps.add(result.settings.sweepSeconds);
    seen.angles.add(result.settings.angle);
    seen.octaves.add(result.settings.traceOctaves);
    for (const key of ["playback", "motion", "direction", "heads", "pitchSource", "voice", "timbre", "glide"]) (seen[key] ??= new Set()).add(result.settings[key]);
    (seen.axes ??= new Set()).add(result.settings.headAxes.join("")); (seen.dirs ??= new Set()).add(result.settings.headDirections.join(""));
  }
  assert.equal(seen.playback.size, 3); assert.equal(seen.motion.size, 2); assert.equal(seen.direction.size, 2); assert.ok(seen.heads.size >= 3); assert.equal(seen.pitchSource.size, 3);
  assert.equal(seen.voice.size, 6); assert.ok(seen.timbre.size >= 20); assert.ok(seen.glide.size >= 20); assert.ok(seen.axes.size >= 20); assert.ok(seen.dirs.size >= 20);
  assert.ok(seen.rowCounts.size >= 3);
  assert.ok(seen.texts.size >= 10);
  assert.ok(seen.colors.size >= 4);
  assert.ok(seen.spans.size >= 20);
  assert.ok(seen.sweeps.size >= 5);
  assert.deepEqual([...seen.angles].sort(), ["degrees", "radians"]);
  assert.ok(seen.octaves.size >= 5);
  const a = randomizeState(base, mulberry32(3)), b = randomizeState(base, mulberry32(3));
  assert.deepEqual(a, b);
  assert.deepEqual(base, PRESETS[0].snapshot, "input snapshot is not mutated");
});

test("slider loop modes and speeds follow Desmos: bounce, loop forward, play once", () => {
  const make = (mode, speed) => {
    let state = addRow(createState(), "a = 0", { slider: { min: 0, max: 1, step: 0, animating: true, mode, speed } });
    return state;
  };
  const value = (state) => analyzeState(state).rows[0].value;
  let state = make("loop", 1);
  state = advanceSliders(state, analyzeState(state), 5, new Map());
  close(value(state), 0.25, 1e-9, "loop wraps to the start");
  assert.equal(state.rows[0].slider.animating, true);
  state = make("once", 2);
  state = advanceSliders(state, analyzeState(state), 1, new Map());
  close(value(state), 0.5, 1e-9, "double speed halves the traversal time");
  state = advanceSliders(state, analyzeState(state), 2, new Map());
  assert.equal(value(state), 1);
  assert.equal(state.rows[0].slider.animating, false, "play once stops at the end");
  state = make("bounce", 0.25);
  const directions = new Map();
  state = advanceSliders(state, analyzeState(state), 4, directions);
  close(value(state), 0.25, 1e-9, "quarter speed takes four times longer");
  assert.deepEqual(sanitizeSlider({ mode: "sideways", speed: 3 }), { ...SLIDER_DEFAULTS });
  for (const preset of PRESETS) for (const row of preset.snapshot.rows) if (row.slider) assert.deepEqual(Object.keys(row.slider).sort(), ["animating", "max", "min", "mode", "speed", "step"]);
});
