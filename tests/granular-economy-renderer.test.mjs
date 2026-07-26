import assert from "node:assert/strict";
import test from "node:test";

import {
  GRANULAR_ECONOMY_PITCH_CLASSES,
  GranularEconomyRenderer,
} from "../src/granular-economy-renderer.js";

function harness() {
  const messages = [];
  return {
    messages,
    node: {
      port: {
        postMessage(message) { messages.push(message); },
      },
    },
  };
}

function pitchVoice(semitones, {
  index = semitones,
  gain = 0.5,
  delay = 0.2,
} = {}) {
  return {
    key: `pitch:${index}`,
    rate: 2 ** (semitones / 12),
    delay,
    gain,
    pan: 0,
  };
}

test("economy preserves 24 strongest pitch classes and maps overflow nearest", () => {
  const fixture = harness();
  const reports = [];
  const renderer = new GranularEconomyRenderer(fixture.node, {
    maxVoices: 64,
    onPitchDetail: (report) => reports.push(report),
  });
  const voices = [
    { key: "unison", rate: 1, delay: 0.2, gain: 0.5, pan: 0 },
    ...Array.from({ length: 23 }, (_, index) => pitchVoice(index + 1)),
    pitchVoice(24, { index: "24-a", gain: 0.4 }),
    pitchVoice(24, { index: "24-b", gain: 0.4 }),
    pitchVoice(25, { gain: 0.5 }),
    pitchVoice(26, { gain: 0.1 }),
  ];
  renderer.setVoices(voices, { requestedVoiceCount: 894, voiceLimit: 64 });

  assert.equal(renderer.maxPitchSources, GRANULAR_ECONOMY_PITCH_CLASSES);
  const message = fixture.messages.at(-1);
  assert.equal(message.requestedVoiceCount, 894);
  assert.equal(message.voiceLimit, 64);
  assert.equal(message.voices.find((voice) => voice.key === "unison").rate, 1);
  const shiftedRates = new Set(
    message.voices
      .filter((voice) => voice.key !== "unison")
      .map((voice) => voice.rate),
  );
  assert.equal(shiftedRates.size, 24);
  const class24Rate = message.voices
    .find((voice) => voice.key === "pitch:24-a").rate;
  assert.equal(
    message.voices.find((voice) => voice.key === "pitch:24-b").rate,
    class24Rate,
  );
  assert.equal(
    message.voices.find((voice) => voice.key === "pitch:25").rate,
    class24Rate,
  );
  assert.equal(
    message.voices.find((voice) => voice.key === "pitch:26").rate,
    class24Rate,
  );
  assert.deepEqual(
    {
      pitchSourceLimit: reports.at(-1).pitchSourceLimit,
      requestedShiftedPitches: reports.at(-1).requestedShiftedPitches,
      exactShiftedPitches: reports.at(-1).exactShiftedPitches,
      mergedShiftedPitches: reports.at(-1).mergedShiftedPitches,
      requestedPitchClasses: reports.at(-1).requestedPitchClasses,
      renderedPitchClasses: reports.at(-1).renderedPitchClasses,
      unisonActive: reports.at(-1).unisonActive,
      exactShiftedVoices: reports.at(-1).exactShiftedVoices,
      mergedShiftedVoices: reports.at(-1).mergedShiftedVoices,
    },
    {
      pitchSourceLimit: 24,
      requestedShiftedPitches: 26,
      exactShiftedPitches: 24,
      mergedShiftedPitches: 2,
      requestedPitchClasses: 27,
      renderedPitchClasses: 25,
      unisonActive: true,
      exactShiftedVoices: 25,
      mergedShiftedVoices: 2,
    },
  );
});

test("economy forwards the adaptive branch ceiling without creating pitch nodes", () => {
  const fixture = harness();
  const renderer = new GranularEconomyRenderer(fixture.node, {
    maxVoices: 512,
  });
  const voices = Array.from({ length: 64 }, (_, index) => pitchVoice(
    index % 12,
    { index },
  ));
  renderer.setVoices(voices, {
    requestedVoiceCount: 894,
    voiceLimit: 48,
  });

  const message = fixture.messages.at(-1);
  assert.equal(message.voices.length, 48);
  assert.equal(message.requestedVoiceCount, 894);
  assert.equal(message.voiceLimit, 48);
  assert.equal(
    message.voices.every((voice) => Number.isFinite(voice.delay)),
    true,
  );
});
