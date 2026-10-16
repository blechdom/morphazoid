import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeMark } from "../src/instruments/playhead-paint/playhead-paint.js";
import {
  PAINT_COORDINATE_MODES, PAINT_FULL_PRESETS, PAINT_PLAYBACK_MODES, PAINT_PRESET_KEYS, PAINT_TARGETS, PAINT_WAVEFORMS,
  capturePaintPreset, randomizePaintPreset, validatePaintPreset,
} from "../src/instruments/playhead-paint/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const toState = snapshot => ({
  ...structuredClone(snapshot),
  layers: snapshot.layers.map(layer => ({ ...structuredClone(layer), name: "x", color: "#fff", gain: 0.5, brightness: 0.5, pitchOffset: 0 })),
  output: 0.9, audioOn: true, playing: true, positionMs: 400, selectedLayer: 2, selectedMarkId: "m1", tool: "erase",
  brushSize: 0.03, history: [[]], draft: null,
});

test("Playhead Paint bank is complete, valid and musically varied", () => {
  validateFullPresetBank(PAINT_FULL_PRESETS);
  for (const { snapshot } of PAINT_FULL_PRESETS) {
    assert.equal(validatePaintPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...PAINT_PRESET_KEYS].sort());
    assert.ok(snapshot.marks.length >= 1);
    for (const mark of snapshot.marks) assert.equal(presetStateKey(sanitizeMark(mark, { fallbackId: mark.id })), presetStateKey(mark));
  }
  assert.equal(new Set(PAINT_FULL_PRESETS.map(p => p.snapshot.mapping.coordinateMode)).size, 3);
  assert.equal(new Set(PAINT_FULL_PRESETS.map(p => p.snapshot.playbackMode)).size, 2);
  assert.ok(new Set(PAINT_FULL_PRESETS.flatMap(p => p.snapshot.layers.map(l => l.waveform))).size >= 4);
  assert.throws(() => validatePaintPreset({ ...PAINT_FULL_PRESETS[0].snapshot, playbackRate: 9 }), TypeError);
  assert.throws(() => validatePaintPreset({ ...PAINT_FULL_PRESETS[0].snapshot, axes: ["vertical", "horizontal"] }), TypeError);
  assert.throws(() => validatePaintPreset({ ...PAINT_FULL_PRESETS[0].snapshot, extra: 1 }), TypeError);
  const bad = structuredClone(PAINT_FULL_PRESETS[0].snapshot);
  bad.marks[0].samples[0].x = 5;
  assert.throws(() => validatePaintPreset(bad), TypeError);
});

test("Playhead Paint capture round-trips and excludes session state", () => {
  for (const { snapshot } of PAINT_FULL_PRESETS) {
    const captured = capturePaintPreset(toState(snapshot));
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["output", "audioOn", "playing", "positionMs", "selectedLayer", "selectedMarkId", "tool", "brushSize", "history"]) assert.equal(key in captured, false);
  }
  const empty = capturePaintPreset({ ...toState(PAINT_FULL_PRESETS[0].snapshot), marks: [] });
  assert.equal(validatePaintPreset(empty), empty);
});

test("Playhead Paint dice is pure, reproducible, valid and varies every field", () => {
  const initial = PAINT_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizePaintPreset(initial, seed(5)), randomizePaintPreset(PAINT_FULL_PRESETS[6].snapshot, seed(5)));
  assert.doesNotThrow(() => randomizePaintPreset(capturePaintPreset({ ...toState(initial), marks: [] }), seed(1)));
  assert.deepEqual(initial, before);
  const factory = new Set(PAINT_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = Object.fromEntries(["marks", "axes", "playbackMode", "playbackRate", "steadySpeed", "loopGapMs", "xTarget", "yTarget", "sizeTarget", "coordinateMode", "radialSpokes", "pitchMin", "pitchMax", "translateX", "rotationDeg", "scaleX", "waveform", "attackMs", "sustain", "layer"].map(k => [k, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 200; i++) {
    const r = randomizePaintPreset(initial, random);
    validatePaintPreset(r);
    assert.equal(factory.has(presetStateKey(r)), false);
    seen.marks.add(r.marks.length); seen.axes.add(r.axes.join());
    for (const k of ["playbackMode", "playbackRate", "steadySpeed", "loopGapMs"]) seen[k].add(r[k]);
    for (const k of ["xTarget", "yTarget", "sizeTarget", "coordinateMode", "radialSpokes", "pitchMin", "pitchMax"]) seen[k].add(r.mapping[k]);
    for (const k of ["translateX", "rotationDeg", "scaleX"]) seen[k].add(r.sceneTransform[k]);
    for (const layer of r.layers) { seen.waveform.add(layer.waveform); seen.attackMs.add(layer.envelope.attackMs); seen.sustain.add(layer.envelope.sustain); }
    for (const mark of r.marks) seen.layer.add(mark.layerId);
  }
  for (const [key, values] of Object.entries(seen)) assert.ok(values.size >= 3 || (key === "playbackMode" && values.size === 2), `${key} stays frozen`);
  assert.equal(seen.waveform.size, PAINT_WAVEFORMS.length);
  assert.equal(seen.coordinateMode.size, PAINT_COORDINATE_MODES.length);
  assert.equal(seen.playbackMode.size, PAINT_PLAYBACK_MODES.length);
  assert.equal(seen.xTarget.size, PAINT_TARGETS.length);
});
