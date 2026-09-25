import test from "node:test";
import assert from "node:assert/strict";
import { EnveloperAudio } from "../src/instruments/enveloper/enveloper-audio.js";
import { SEQUENCER_VOICES } from "../src/sequencer-voices.js";
import { sanitizeJawJamPattern, jawJamStepConfiguration, jawJamStepIntervalSeconds } from "../src/instruments/jaw-jam/jaw-jam.js";
import { JawJamSharedVoices, jawJamSharedDuration } from "../src/instruments/jaw-jam/jaw-jam-shared-voices.js";

const param = () => ({
  events: [],
  cancelScheduledValues(at) { this.events.push(["cancel", at]); },
  setValueAtTime(value, at) { this.events.push(["set", value, at]); },
  linearRampToValueAtTime(value, at) { this.events.push(["ramp", value, at]); },
  setTargetAtTime(value, at) { this.events.push(["target", value, at]); },
});
const handle = (options) => ({ ...options, stopped: false, referenceFrequency: 220,
  source: { playbackRate: param() }, filter: { frequency: param() }, driveGain: { gain: param() },
});

test("Enveloper shared voices follow its full pitch and timbre contours for long leaves", async () => {
  const audio = new EnveloperAudio({}, { engine: { context: { state: "running", currentTime: 2 }, setOutput() {} } });
  audio.voice = "simd-chiptune";
  let scheduled;
  audio.voices = { trigger(options) { scheduled = handle(options); return scheduled; } };
  const result = await audio.triggerLeaf({ durationSeconds: 10, frequencyHz: 440, amplitude: .2,
    frequencyEnvelope: [{ time: 0, value: 440 }, { time: .4, value: 660 }, { time: 1, value: 220 }],
    modulationIndexEnvelope: [{ time: 0, value: 1 }, { time: .6, value: 12 }, { time: 1, value: 0 }],
  }, 2.1);
  assert.equal(result.scheduled, true);
  assert.equal(scheduled.duration + scheduled.release, 10);
  assert.deepEqual(scheduled.source.playbackRate.events.at(-1), ["ramp", 1, 12.1]);
  assert.deepEqual(scheduled.source.playbackRate.events[2], ["ramp", 3, 6.1]);
  assert.deepEqual(scheduled.filter.frequency.events.at(-1), ["ramp", 160, 12.1]);
  assert.deepEqual(scheduled.driveGain.gain.events.at(-1), ["ramp", .35, 12.1]);
});

test("Jaw Jam accepts every shared step voice while keeping physical configurations valid", () => {
  for (const voice of SEQUENCER_VOICES) {
    const pattern = sanitizeJawJamPattern({ stepCount: 1, steps: [{ action: "pluck", soundPresetId: voice.id, midi: 40 }] });
    assert.equal(pattern.steps[0].soundPresetId, voice.id);
    assert.ok(jawJamStepConfiguration(pattern, 0).reedFrequencyHz > 30);
  }
});

test("Jaw Jam shared plucks own hold cells, holds do not retrigger and rests release", () => {
  const pattern = sanitizeJawJamPattern({ tempo: 120, swing: 0, stepCount: 4, steps: [
    { action: "pluck", soundPresetId: "simd-chiptune", midi: 40, pluckIntensity: .8 },
    { action: "sustain", soundPresetId: "simd-chiptune", midi: 44 },
    { action: "sustain", soundPresetId: "simd-chiptune", midi: 48 },
    { action: "rest", soundPresetId: "simd-chiptune" },
  ] });
  const duration = jawJamStepIntervalSeconds(pattern, 0);
  assert.equal(jawJamSharedDuration(pattern, 0), duration * 3);
  const adapter = new JawJamSharedVoices({});
  const calls = [];
  const released = [];
  adapter.bank = { context: { currentTime: 0 },
    trigger(options) { const note = handle(options); calls.push(note); return note; },
    releaseVoice(note, when) { note.stopped = true; released.push(when); },
  };
  assert.equal(adapter.schedule(pattern, 0, 0, .01), true);
  assert.equal(calls.length, 1);
  assert.equal(adapter.schedule(pattern, 1, 1, .01 + duration), true);
  assert.equal(adapter.schedule(pattern, 2, 2, .01 + duration * 2), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].duration + calls[0].release, duration * 3);
  assert.equal(adapter.schedule(pattern, 3, 3, .01 + duration * 3), false);
  assert.equal(released.length, 1);
  assert.ok(released[0] <= .01 + duration * 3);
});
