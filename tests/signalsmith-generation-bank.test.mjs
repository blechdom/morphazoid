import assert from "node:assert/strict";
import test from "node:test";

import { SignalsmithGenerationBank } from "../src/signalsmith-generation-bank.js";

function audioNode(extra = {}) {
  return {
    ...extra,
    connections: [],
    connect(destination, output = 0, input = 0) {
      this.connections.push({ destination, output, input });
      return destination;
    },
    disconnect() {},
  };
}

function harness() {
  const created = { stretches: [], mixers: [] };
  const context = {
    currentTime: 4,
    sampleRate: 48_000,
    createDelay() {
      throw new Error("the fixed-pool bank must not allocate DelayNodes");
    },
  };
  const stretchFactory = async () => {
    const node = audioNode({
      configured: null,
      schedules: [],
      async configure(options) { this.configured = options; },
      async schedule(options) { this.schedules.push(options); },
      async latency() { return 0.08; },
      async stop() { this.stopped = true; },
      port: { close() {} },
    });
    created.stretches.push(node);
    return node;
  };
  const mixerFactory = async () => {
    const messages = [];
    const node = audioNode({
      port: {
        messages,
        postMessage(message) { messages.push(message); },
        close() {},
      },
    });
    created.mixers.push(node);
    return node;
  };
  return {
    context,
    input: audioNode(),
    output: audioNode(),
    created,
    stretchFactory,
    mixerFactory,
  };
}

async function initializedBank(fixture, options = {}) {
  const bank = new SignalsmithGenerationBank(
    fixture.context,
    fixture.input,
    fixture.output,
    {
      stretchFactory: fixture.stretchFactory,
      mixerFactory: fixture.mixerFactory,
      ...options,
    },
  );
  await bank.initialize();
  return bank;
}

test("generation bank defaults to three bounded pitch processors", async () => {
  const fixture = harness();
  const bank = await initializedBank(fixture);

  assert.equal(bank.maxPitchSources, 3);
  assert.equal(bank.historySeconds, 30);
  assert.equal(fixture.created.stretches.length, 3);
  assert.equal(fixture.created.mixers.length, 1);
});

test("generation bank uses a fixed pitch pool and one bounded mixer history", async () => {
  const fixture = harness();
  const bank = await initializedBank(fixture, { maxPitchSources: 2, maxVoices: 8 });

  assert.equal(fixture.created.stretches.length, 2);
  assert.equal(fixture.created.mixers.length, 1);
  assert.deepEqual(
    fixture.created.stretches.map((node) => node.connections[0].input),
    [1, 2],
  );

  bank.setVoices([
    { key: "neutral", rate: 1, delay: 0.25, gain: 0.5, pan: 0 },
    { key: "up-a", rate: 2, delay: 0.5, gain: 0.4, pan: -0.4 },
    { key: "up-b", rate: 2, delay: 0.75, gain: 0.3, pan: 0.4 },
  ]);
  await new Promise((resolve) => setImmediate(resolve));

  const voices = fixture.created.mixers[0].port.messages.at(-1).voices;
  assert.equal(voices.find((voice) => voice.key === "neutral").sourceIndex, 0);
  assert.equal(voices.find((voice) => voice.key === "up-a").sourceIndex, 1);
  assert.equal(voices.find((voice) => voice.key === "up-b").sourceIndex, 1);
  assert.equal(voices.find((voice) => voice.key === "up-a").delay, 0.42);
  assert.equal(fixture.created.stretches[0].schedules.at(-1).semitones, 12);
  assert.equal(fixture.created.stretches[0].schedules.at(-1).formantCompensation, false);
});

test("overflow pitches map to the bounded pool without allocating more processors", async () => {
  const fixture = harness();
  const bank = await initializedBank(fixture, { maxPitchSources: 2, maxVoices: 8 });
  bank.setVoices([
    { key: "loud", rate: 2, delay: 0.2, gain: 0.8, pan: 0 },
    { key: "medium", rate: 0.5, delay: 0.3, gain: 0.6, pan: 0 },
    { key: "quiet", rate: 1.5, delay: 0.4, gain: 0.1, pan: 0 },
  ]);
  await new Promise((resolve) => setImmediate(resolve));

  const voices = fixture.created.mixers[0].port.messages.at(-1).voices;
  assert.equal(fixture.created.stretches.length, 2);
  assert.equal(voices.length, 3);
  assert.ok(voices.every((voice) => voice.sourceIndex >= 1 && voice.sourceIndex <= 2));
});

test("rapid branch-angle gestures retune slots but keep node allocation constant", async () => {
  const fixture = harness();
  const bank = await initializedBank(fixture, { maxPitchSources: 2, maxVoices: 8 });
  bank.setVoices([{ key: "branch", rate: 1, delay: 0.25, gain: 0.5, pan: 0 }]);
  await new Promise((resolve) => setImmediate(resolve));

  for (const rate of [1.05, 1.12, 1.2, 1.3]) {
    bank.setVoices([{ key: "branch", rate, delay: 0.25, gain: 0.5, pan: 0 }]);
  }
  assert.equal(fixture.created.stretches.length, 2);
  const messageCount = fixture.created.mixers[0].port.messages.length;
  await new Promise((resolve) => setTimeout(resolve, 115));

  assert.equal(fixture.created.stretches.length, 2, "a gesture must never create another worklet");
  assert.equal(fixture.created.mixers[0].port.messages.length, messageCount + 1);
  assert.ok(Math.abs(fixture.created.stretches[0].schedules.at(-1).semitones - 4.54) < 0.01);
});
