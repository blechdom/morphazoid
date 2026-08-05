import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SHAPE_MIDI_MACRO_LABELS,
  SHAPE_MIDI_PAD_ACTIONS,
  ShapeMidiPerformance,
  shapeMidiMacroAction,
  shapeMidiNoteRatio,
  shapeMidiPadAction,
} from "../src/shape-midi.js";

test("Shape note overlay uses C4 as neutral and follows equal temperament", () => {
  assert.equal(shapeMidiNoteRatio(60), 1);
  assert.equal(shapeMidiNoteRatio(72), 2);
  assert.equal(shapeMidiNoteRatio(48), 0.5);
  assert.ok(Math.abs(shapeMidiNoteRatio(60, 2) - 2 ** (2 / 12)) < 1e-12);
});

test("Shape performance has last-note priority, sustain, bend, and neutral fallback", () => {
  const performance = new ShapeMidiPerformance();
  assert.deepEqual(performance.snapshot(), {
    note: null, pitchRatio: 1, gain: 1, expression: 1, sustain: false,
  });
  performance.handle({ type: "noteOn", note: 60, velocity: 64, channel: 0, sourceId: "keys" });
  let snapshot = performance.handle({ type: "noteOn", note: 67, velocity: 127, channel: 0, sourceId: "keys" });
  assert.equal(snapshot.note, 67);
  assert.equal(snapshot.gain, 1);
  snapshot = performance.handle({ type: "pitchBend", normalized: 1 });
  assert.ok(Math.abs(snapshot.pitchRatio - shapeMidiNoteRatio(67, 2)) < 1e-12);
  performance.handle({ type: "controlChange", controller: 64, value: 127, channel: 0, sourceId: "keys" });
  snapshot = performance.handle({ type: "noteOff", note: 67, channel: 0, sourceId: "keys" });
  assert.equal(snapshot.note, 67);
  performance.handle({ type: "controlChange", controller: 64, value: 0, channel: 0, sourceId: "keys" });
  snapshot = performance.handle({ type: "noteOff", note: 60, channel: 0, sourceId: "keys" });
  assert.equal(snapshot.note, null);
  assert.equal(snapshot.pitchRatio, 1);
  assert.equal(snapshot.gain, 1);
});

test("Shape expression is linear and panic restores the original geometric voice", () => {
  const performance = new ShapeMidiPerformance();
  performance.handle({ type: "noteOn", note: 60, velocity: 127 });
  let snapshot = performance.handle({ type: "controlChange", controller: 11, value: 64 });
  assert.equal(snapshot.gain, 64 / 127);
  snapshot = performance.handle({ type: "controlChange", controller: 120, value: 0 });
  assert.equal(snapshot.note, null);
  assert.equal(snapshot.pitchRatio, 1);
  snapshot = performance.handle({ type: "controlChange", controller: 121, value: 0 });
  assert.equal(snapshot.expression, 1);
});

test("Shape balances duplicate note-ons and keeps identical notes owned by their source", () => {
  const performance = new ShapeMidiPerformance();
  performance.handle({ type: "noteOn", note: 60, velocity: 80, channel: 0, sourceId: "keys-a" });
  performance.handle({ type: "noteOn", note: 60, velocity: 96, channel: 0, sourceId: "keys-a" });
  let snapshot = performance.handle({ type: "noteOff", note: 60, channel: 0, sourceId: "keys-a" });
  assert.equal(snapshot.note, 60, "one matching note-off must not release a duplicated note-on");

  performance.handle({ type: "noteOn", note: 60, velocity: 127, channel: 0, sourceId: "keys-b" });
  snapshot = performance.handle({
    type: "controlChange",
    controller: 120,
    value: 0,
    channel: 0,
    sourceId: "keys-b",
    synthetic: true,
  });
  assert.equal(snapshot.note, 60, "disconnect panic must leave another input's matching note intact");
  assert.equal(snapshot.gain, 96 / 127);

  snapshot = performance.handle({ type: "noteOff", note: 60, channel: 0, sourceId: "keys-a" });
  assert.equal(snapshot.note, null);
});

test("Shape sustain and all-notes-off are scoped to the originating input and channel", () => {
  const performance = new ShapeMidiPerformance();
  performance.handle({ type: "noteOn", note: 60, velocity: 100, channel: 2, sourceId: "keys-a" });
  performance.handle({ type: "controlChange", controller: 64, value: 127, channel: 2, sourceId: "keys-a" });
  performance.handle({ type: "noteOff", note: 60, channel: 2, sourceId: "keys-a" });
  let snapshot = performance.handle({
    type: "controlChange", controller: 123, value: 0, channel: 2, sourceId: "keys-a",
  });
  assert.equal(snapshot.note, 60, "CC123 follows note-off semantics while that scope's pedal is down");
  assert.equal(snapshot.sustain, true);

  performance.handle({ type: "noteOn", note: 67, velocity: 127, channel: 0, sourceId: "keys-b" });
  snapshot = performance.handle({
    type: "controlChange", controller: 64, value: 0, channel: 2, sourceId: "keys-a",
  });
  assert.equal(snapshot.note, 67);
  assert.equal(snapshot.sustain, false);
});

test("Shape's eight macros and sixteen Maschine pad commands are stable", () => {
  assert.equal(SHAPE_MIDI_MACRO_LABELS.length, 8);
  assert.equal(SHAPE_MIDI_PAD_ACTIONS.length, 16);
  assert.deepEqual(shapeMidiMacroAction(0, 0), { type: "range", id: "sides", value: 1 });
  assert.deepEqual(shapeMidiMacroAction(0, 1), { type: "range", id: "sides", value: 32 });
  assert.deepEqual(shapeMidiMacroAction(1, 0.5), { type: "range", id: "curvature", value: 0 });
  assert.deepEqual(shapeMidiMacroAction(6, 1, "fm"), { type: "range", id: "fmIndex", value: 12 });
  assert.deepEqual(shapeMidiMacroAction(6, 1, "pm"), { type: "range", id: "pmIndex", value: 8 });
  assert.deepEqual(shapeMidiMacroAction(7, 0.25), { type: "range", id: "stereoWidth", value: 0.25 });
  assert.deepEqual(shapeMidiPadAction(0), { type: "command", command: "sound-sine" });
  assert.deepEqual(shapeMidiPadAction(15), { type: "command", command: "add-head" });
  assert.equal(shapeMidiPadAction(16), null);
});

test("Shape applies the MIDI overlay to every rendered sound path and restores it across BFCache", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /gain: amplitudeGainForContact\(contact, path\) \* shapeMidiSnapshot\.gain/);
  assert.match(app, /const frequency = synthFrequencyForMapping\(mapping\);/);
  assert.match(app, /gain: peak \* shapeMidiSnapshot\.gain/);
  assert.match(app, /if \(message\.logical\?\.type === "pad"\) \{[\s\S]*?if \(message\.type === "noteOn"\)/);
  assert.match(app, /function registerShapeMidiClient\(\)/);
  assert.match(app, /window\.addEventListener\("pageshow", \(\) => \{\s+registerShapeMidiClient\(\);/);
  assert.match(app, /shapeMidiSnapshot = shapeMidiPerformance\.reset\(\);/);
  assert.doesNotMatch(
    app,
    /onProfileChange:\s*\(\)\s*=>\s*\{[\s\S]*?shapeMidiPerformance\.reset\(\)/,
    "hardware profile changes must not cut notes held by the computer keyboard",
  );
  assert.match(app, /lifecycleGeneration !== audioLifecycleGeneration/);
});
