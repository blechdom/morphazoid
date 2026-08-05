import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_FM_DRUM_VOICES } from "../src/fm-drums.js";
import {
  createFmDrumMidiTriggerVoice,
  FM_DRUM_MACRO_LABELS,
  fmDrumControlChangeAction,
  fmDrumMacroUpdate,
  fmDrumMidiAction,
  fmDrumVelocityGain,
  fmDrumVoiceIndexForMidiEvent,
  updateFmDrumVoiceFromMidi,
} from "../src/fm-drums-midi.js";

test("FM drum notes and logical pads address the sixteen visible voices", () => {
  assert.equal(fmDrumVoiceIndexForMidiEvent({ type: "noteOn", note: 36, velocity: 1 }), 0);
  assert.equal(fmDrumVoiceIndexForMidiEvent({ type: "noteOn", note: 51, velocity: 127 }), 15);
  assert.equal(fmDrumVoiceIndexForMidiEvent({ type: "noteOn", note: 35, velocity: 127 }), -1);
  assert.equal(fmDrumVoiceIndexForMidiEvent({ type: "noteOn", note: 35.6, velocity: 127 }), -1);
  assert.equal(fmDrumVoiceIndexForMidiEvent({ type: "noteOff", note: 36, velocity: 64 }), -1);
  assert.equal(fmDrumVoiceIndexForMidiEvent({ type: "noteOn", note: 36, velocity: 0 }), -1);
  assert.equal(fmDrumVoiceIndexForMidiEvent({
    type: "noteOn",
    note: 99,
    velocity: 100,
    logical: { type: "pad", index: 7 },
  }), 7);
});

test("FM drum velocity is linear and only scales a transient trigger", () => {
  assert.equal(fmDrumVelocityGain(0), 0);
  assert.equal(fmDrumVelocityGain(127), 1);
  assert.equal(fmDrumVelocityGain(64), 64 / 127);
  assert.deepEqual(fmDrumMidiAction({ type: "noteOn", note: 40, velocity: 64 }), {
    type: "trigger",
    voiceIndex: 4,
    velocityGain: 64 / 127,
  });
  const bankVoice = DEFAULT_FM_DRUM_VOICES[0];
  const triggerVoice = createFmDrumMidiTriggerVoice(bankVoice, 64 / 127);
  assert.notEqual(triggerVoice, bankVoice);
  assert.equal(triggerVoice.level, bankVoice.level * 64 / 127);
  assert.equal(bankVoice.level, DEFAULT_FM_DRUM_VOICES[0].level);
});

test("eight controller macros span the selected voice's useful ranges", () => {
  assert.equal(FM_DRUM_MACRO_LABELS.length, 8);
  assert.equal(fmDrumMacroUpdate(0, 0).value, 35);
  assert.equal(fmDrumMacroUpdate(0, 1).value, 6_000);
  assert.equal(fmDrumMacroUpdate(1, 0).value, 0.035);
  assert.ok(Math.abs(fmDrumMacroUpdate(1, 1).value - 3) < 1e-12);
  assert.deepEqual(fmDrumMacroUpdate(3, 0.5), { key: "modIndex", value: 10 });
  assert.deepEqual(fmDrumMacroUpdate(4, 0.5), { key: "pitchBend", value: 3.5 });
  assert.deepEqual(fmDrumMacroUpdate(7, 1), { key: "level", value: 1 });
  assert.equal(fmDrumMacroUpdate(8, 1), null);
  assert.equal(fmDrumMacroUpdate(0.6, 1), null);
});

test("standard drum CCs map master and every selected-voice parameter safely", () => {
  assert.deepEqual(fmDrumControlChangeAction(7, 127), { type: "master", value: 0.9 });
  const expectedKeys = new Map([
    [16, "frequency"],
    [73, "attack"],
    [72, "decay"],
    [76, "modRatio"],
    [71, "modIndex"],
    [77, "pitchBend"],
    [78, "noise"],
    [74, "tone"],
    [11, "level"],
  ]);
  for (const [controller, key] of expectedKeys) {
    const action = fmDrumControlChangeAction(controller, 64);
    assert.equal(action.type, "voice");
    assert.equal(action.key, key);
    assert.equal(Number.isFinite(action.value), true);
  }
  assert.equal(fmDrumControlChangeAction(99, 64), null);

  assert.equal(
    fmDrumMidiAction({
      type: "controlChange",
      controller: 16,
      value: 127,
      logical: { type: "macro", index: 2, normalized: 0.5 },
    }).key,
    "modRatio",
    "the selected controller profile's macro mapping takes priority",
  );

  const original = DEFAULT_FM_DRUM_VOICES[0];
  const updated = updateFmDrumVoiceFromMidi(original, {
    type: "voice",
    key: "modIndex",
    value: 999,
  });
  assert.equal(updated.modIndex, 20);
  assert.equal(original.modIndex, DEFAULT_FM_DRUM_VOICES[0].modIndex);
});
