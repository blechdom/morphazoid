import assert from "node:assert/strict";
import test from "node:test";

import { SignalsmithGenerationBank } from "../src/signalsmith-generation-bank.js";

function parameter() {
  return {
    events: [],
    cancelScheduledValues(time) {
      this.events.push({ type: "cancel", time });
    },
    setValueAtTime(value, time) {
      this.events.push({ type: "set", value, time });
    },
    linearRampToValueAtTime(value, time) {
      this.events.push({ type: "ramp", value, time });
    },
    setTargetAtTime(value, time, constant) {
      this.events.push({ type: "target", value, time, constant });
    },
  };
}

function audioNode(extra = {}) {
  return {
    ...extra,
    connections: [],
    connect(destination) {
      this.connections.push(destination);
      return destination;
    },
    disconnect() {},
  };
}

function harness() {
  const created = { delays: [], gains: [], pans: [], stretches: [] };
  const context = {
    currentTime: 4,
    sampleRate: 48_000,
    createDelay() {
      const node = audioNode({ delayTime: parameter() });
      created.delays.push(node);
      return node;
    },
    createGain() {
      const node = audioNode({ gain: parameter() });
      created.gains.push(node);
      return node;
    },
    createStereoPanner() {
      const node = audioNode({ pan: parameter() });
      created.pans.push(node);
      return node;
    },
  };
  const stretchFactory = async () => {
    const node = audioNode({
      configured: null,
      schedules: [],
      async configure(options) { this.configured = options; },
      async schedule(options) { this.schedules.push(options); },
      async latency() { return 0.08; },
      async stop() {},
    });
    created.stretches.push(node);
    return node;
  };
  return {
    context,
    input: audioNode(),
    output: audioNode(),
    created,
    stretchFactory,
  };
}

test("generation bank preserves neutral audio and shares silky pitch processors", async () => {
  const fixture = harness();
  const bank = new SignalsmithGenerationBank(
    fixture.context,
    fixture.input,
    fixture.output,
    { stretchFactory: fixture.stretchFactory },
  );

  bank.desired = [
    { key: "neutral", semitones: 0, pitchKey: "0", delay: 0.25, gain: 0.5, pan: 0 },
    { key: "up-a", semitones: 12, pitchKey: "12.00", delay: 0.5, gain: 0.4, pan: -0.4 },
    { key: "up-b", semitones: 12, pitchKey: "12.00", delay: 0.75, gain: 0.3, pan: 0.4 },
  ];
  bank.revision = 1;
  await bank.reconcile(1);

  assert.equal(fixture.created.stretches.length, 1, "one processor should serve a shared pitch");
  assert.equal(bank.taps.get("neutral").source, fixture.input, "zero pitch must remain bit-clean");
  assert.equal(bank.taps.get("up-a").source, bank.taps.get("up-b").source);
  assert.equal(fixture.created.stretches[0].schedules[0].semitones, 12);
  assert.equal(fixture.created.stretches[0].schedules[0].formantCompensation, false);
  assert.equal(
    bank.taps.get("up-a").delays[0].delayTime.events.at(-1).value,
    0.42,
    "processor latency should not move the branch in time",
  );
});

test("generation timing changes crossfade stationary delay taps instead of scrubbing one tap", async () => {
  const fixture = harness();
  const bank = new SignalsmithGenerationBank(
    fixture.context,
    fixture.input,
    fixture.output,
    { stretchFactory: fixture.stretchFactory },
  );
  bank.desired = [
    { key: "branch", semitones: 0, pitchKey: "0", delay: 0.25, gain: 0.5, pan: 0 },
  ];
  bank.revision = 1;
  await bank.reconcile(1);
  const tap = bank.taps.get("branch");

  bank.desired = [
    { key: "branch", semitones: 0, pitchKey: "0", delay: 0.75, gain: 0.5, pan: 0 },
  ];
  bank.revision = 2;
  await bank.reconcile(2);

  assert.equal(tap.delayValues[0], 0.25, "audible delay must remain stationary");
  assert.equal(tap.delayValues[1], 0.75, "new time belongs on the silent delay");
  assert.equal(tap.activeLane, 1);
  assert.deepEqual(
    tap.laneGains.map((lane) => lane.gain.events.filter((event) => event.type === "ramp").at(-1).value),
    [0, 1],
  );
});

test("generation bank caps distinct pitch processors and maps overflow voices", async () => {
  const fixture = harness();
  const bank = new SignalsmithGenerationBank(
    fixture.context,
    fixture.input,
    fixture.output,
    { stretchFactory: fixture.stretchFactory, maxPitchSources: 2 },
  );
  const voices = [
    { key: "loud", rate: 2, delay: 0.2, gain: 0.8, pan: 0 },
    { key: "medium", rate: 0.5, delay: 0.3, gain: 0.6, pan: 0 },
    { key: "quiet", rate: 1.5, delay: 0.4, gain: 0.1, pan: 0 },
  ];

  bank.setVoices(voices);
  await bank.reconcile(bank.revision);

  assert.equal(fixture.created.stretches.length, 2);
  assert.equal(bank.taps.size, 3);
});
