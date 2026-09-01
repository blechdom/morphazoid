import assert from "node:assert/strict";
import test from "node:test";
import {
  ENVELOPER_AUDIO_LIMITS,
  EnveloperAudio,
  deriveEnveloperLeafTrigger,
} from "../src/enveloper-audio.js";

class FakeGraphSynthAudio {
  constructor() {
    this.context = null;
    this.outputCalls = [];
    this.triggerCalls = [];
    this.silenceCalls = 0;
    this.closeCalls = 0;
  }

  async start() {
    this.context = { state: "running", currentTime: 4.25 };
    return this.context;
  }

  setOutput(value) {
    this.outputCalls.push(value);
  }

  async trigger(voice, envelope) {
    this.triggerCalls.push({ voice, envelope });
    return { ...voice, ...envelope, scheduled: true };
  }

  silence() {
    this.silenceCalls += 1;
  }

  async close() {
    this.closeCalls += 1;
    this.context = null;
  }
}

test("Enveloper leaf mapping preserves event controls and exact bounded duration", () => {
  const mapped = deriveEnveloperLeafTrigger({
    leafId: "2:1",
    durationSeconds: 0.75,
    frequencyHz: 523.25,
    timbre: 0.4,
    amplitude: 0.37,
    pan: -0.6,
    modulationRatio: 1.5,
    modulationIndex: 4.2,
    brightness: 0.82,
  });

  assert.equal(mapped.voice.leafId, "2:1");
  assert.equal(mapped.voice.mode, "fm");
  assert.equal(mapped.voice.frequency, 523.25);
  assert.equal(mapped.voice.frequencyHz, 523.25);
  assert.equal(mapped.voice.timbre, 0.4);
  assert.equal(mapped.voice.gain, 0.37);
  assert.equal(mapped.voice.amplitude, 0.37);
  assert.equal(mapped.voice.pan, -0.6);
  assert.equal(mapped.voice.modulationRatio, 1.5);
  assert.equal(mapped.voice.modulationIndex, 4.2);
  assert.equal(mapped.voice.brightness, 0.82);
  assert.equal(
    mapped.envelope.gateSeconds + mapped.envelope.releaseSeconds,
    0.75,
  );
  assert.ok(mapped.envelope.attackSeconds + mapped.envelope.decaySeconds <= mapped.envelope.gateSeconds);
});

test("Enveloper derives a useful timbre and clamps unsafe leaf values", () => {
  const mapped = deriveEnveloperLeafTrigger({
    durationSeconds: 0,
    frequencyHz: 40_000,
    timbre: 0.5,
    amplitude: 3,
    pan: -3,
    modulationRatio: 40,
  });

  assert.equal(mapped.voice.durationSeconds, ENVELOPER_AUDIO_LIMITS.minDurationSeconds);
  assert.equal(mapped.voice.frequency, ENVELOPER_AUDIO_LIMITS.maxFrequencyHz);
  assert.equal(mapped.voice.modulationIndex, 2);
  assert.equal(mapped.voice.modulationRatio, ENVELOPER_AUDIO_LIMITS.maxModulationRatio);
  assert.equal(mapped.voice.gain, 1);
  assert.equal(mapped.voice.pan, -1);
  assert.equal(mapped.envelope.gateSeconds + mapped.envelope.releaseSeconds, mapped.voice.durationSeconds);
});

test("Enveloper facade arms explicitly, forwards absolute time, and releases its engine", async () => {
  const engine = new FakeGraphSynthAudio();
  const audio = new EnveloperAudio({}, { engine });

  assert.equal(audio.engineRunning, false);
  assert.equal(audio.contextState, "closed");
  const skipped = await audio.triggerLeaf({ durationSeconds: 0.2, frequencyHz: 220 }, 2);
  assert.equal(skipped.scheduled, false);
  assert.equal(skipped.skipReason, "audio-not-running");
  assert.equal(engine.triggerCalls.length, 0, "a scheduler must not create audio outside the Audio gesture");

  audio.setLevel(0.41);
  const context = await audio.start();
  assert.equal(context, audio.context);
  assert.equal(audio.engineRunning, true);
  assert.equal(audio.contextState, "running");
  assert.equal(audio.currentTime, 4.25);
  assert.equal(engine.outputCalls.at(-1), 0.41);

  const rendered = await audio.triggerLeaf({
    durationSeconds: 0.6,
    frequencyHz: 330,
    timbre: 0.75,
    amplitude: 0.2,
  }, { startAt: 4.8 });
  assert.equal(rendered.scheduled, true);
  assert.equal(engine.triggerCalls.length, 1);
  assert.equal(engine.triggerCalls[0].envelope.startAt, 4.8);
  assert.equal(
    engine.triggerCalls[0].envelope.gateSeconds
      + engine.triggerCalls[0].envelope.releaseSeconds,
    0.6,
  );

  audio.silence();
  assert.equal(engine.silenceCalls, 1);
  await audio.close();
  assert.equal(engine.closeCalls, 1);
  assert.equal(audio.engineRunning, false);
});
