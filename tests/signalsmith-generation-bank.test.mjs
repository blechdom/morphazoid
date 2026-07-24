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
  const mixerFactory = async (_context, options = {}) => {
    const messages = [];
    const node = audioNode({
      options,
      port: {
        messages,
        postMessage(message) { messages.push(message); },
        start() {},
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

function pitchVoice(semitones, index = semitones) {
  return {
    key: `pitch:${index}`,
    rate: 2 ** (semitones / 12),
    delay: 0.2 + Number(index) / 10_000,
    gain: 0.5,
    pan: 0,
  };
}

function assertPitchReport(report, expected) {
  assert.ok(report, "the bank must publish pitch-detail telemetry after reconciling voices");
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(report[field], value, `unexpected pitch-detail field ${field}`);
  }
}

test("generation bank defaults to three bounded pitch processors", async () => {
  const fixture = harness();
  const bank = await initializedBank(fixture);

  assert.equal(bank.maxPitchSources, 3);
  assert.equal(bank.historySeconds, 30);
  assert.equal(fixture.created.stretches.length, 3);
  assert.equal(fixture.created.mixers.length, 1);
  assert.equal(fixture.created.mixers[0].options.maxInputs, 4);
});

test("generation bank releases a lane that fails during initialization", async () => {
  const fixture = harness();
  const failingNode = audioNode({
    async configure() { throw new Error("configure failed"); },
    async stop() { this.stopCount = (this.stopCount ?? 0) + 1; },
    port: {
      close() { this.closed = true; },
    },
  });
  failingNode.disconnect = () => { failingNode.disconnected = true; };
  fixture.input.disconnect = () => {
    throw new Error("not connected");
  };

  await assert.rejects(
    SignalsmithGenerationBank.create(
      fixture.context,
      fixture.input,
      fixture.output,
      {
        maxPitchSources: 16,
        stretchFactory: async () => failingNode,
        mixerFactory: fixture.mixerFactory,
      },
    ),
    /configure failed/,
  );

  assert.equal(failingNode.stopCount, 1);
  assert.equal(failingNode.disconnected, true);
  assert.equal(failingNode.port.closed, true);
});

test("generation bank renders sixteen exact shifted pitches and truthfully reports overflow merging", async () => {
  const fixture = harness();
  const pitchReports = [];
  const bank = await initializedBank(fixture, {
    maxPitchSources: 999,
    maxVoices: 64,
    onPitchDetail: (report) => pitchReports.push(report),
  });

  assert.equal(bank.maxPitchSources, 16, "the shifted-pitch pool must keep its hard safety cap");
  assert.equal(fixture.created.stretches.length, 16);
  assert.equal(fixture.created.mixers[0].options.maxInputs, 17);
  assert.deepEqual(
    fixture.created.stretches.map((node) => node.connections[0].input),
    Array.from({ length: 16 }, (_, index) => index + 1),
  );

  const exactVoices = [
    { key: "unison", rate: 1, delay: 0.2, gain: 0.5, pan: 0 },
    ...Array.from({ length: 16 }, (_, index) => pitchVoice(index - 16, index)),
  ];
  bank.setVoices(exactVoices);
  await new Promise((resolve) => setImmediate(resolve));

  const exactMessage = fixture.created.mixers[0].port.messages.at(-1);
  assert.equal(
    exactMessage.voices.find((voice) => voice.key === "unison").sourceIndex,
    0,
  );
  assert.deepEqual(
    [...new Set(
      exactMessage.voices
        .filter((voice) => voice.key !== "unison")
        .map((voice) => voice.sourceIndex),
    )].sort((first, second) => first - second),
    Array.from({ length: 16 }, (_, index) => index + 1),
  );
  assertPitchReport(pitchReports.at(-1), {
    pitchSourceLimit: 16,
    requestedShiftedPitches: 16,
    exactShiftedPitches: 16,
    mergedShiftedPitches: 0,
    requestedPitchClasses: 17,
    renderedPitchClasses: 17,
    unisonActive: true,
    exactShiftedVoices: 16,
    mergedShiftedVoices: 0,
  });

  bank.setVoices([...exactVoices, pitchVoice(1, 16)]);
  await new Promise((resolve) => setTimeout(resolve, 115));

  assert.equal(
    fixture.created.stretches.length,
    16,
    "overflow must merge into the existing pool instead of allocating a seventeenth processor",
  );
  assertPitchReport(pitchReports.at(-1), {
    pitchSourceLimit: 16,
    requestedShiftedPitches: 17,
    exactShiftedPitches: 16,
    mergedShiftedPitches: 1,
    requestedPitchClasses: 18,
    renderedPitchClasses: 17,
    unisonActive: true,
    exactShiftedVoices: 16,
    mergedShiftedVoices: 1,
  });
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

test("generation bank forwards adaptive demand and render-load telemetry without reallocating", async () => {
  const fixture = harness();
  const reports = [];
  const bank = await initializedBank(fixture, {
    maxPitchSources: 3,
    maxVoices: 64,
    onRenderLoad: (report) => reports.push(report),
  });
  const voices = Array.from({ length: 64 }, (_, index) => ({
    key: `branch:${index}`,
    rate: 1,
    delay: 0.2 + index / 1_000,
    gain: 0.01,
    pan: 0,
  }));
  bank.setVoices(voices, { requestedVoiceCount: 894, voiceLimit: 48 });
  await new Promise((resolve) => setImmediate(resolve));

  const message = fixture.created.mixers[0].port.messages.at(-1);
  assert.equal(message.voices.length, 48);
  assert.equal(message.requestedVoiceCount, 894);
  assert.equal(message.voiceLimit, 48);
  assert.equal(fixture.created.stretches.length, 3);

  fixture.created.mixers[0].port.onmessage({
    data: {
      type: "render-load",
      supported: true,
      averageLoad: 0.2,
      peakLoad: 0.3,
    },
  });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].averageLoad, 0.2);
});
