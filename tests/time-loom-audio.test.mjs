import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceTransport, createDefaultState, createDemo, getWaveform, normalizeState, sanitizeSource,
} from "../src/instruments/time-loom/time-loom-model.js";
import { TimeLoomDSP } from "../src/instruments/time-loom/time-loom-dsp.js";
import { TimeLoomAudio } from "../src/instruments/time-loom/time-loom-audio.js";

const RATE = 8000;
const cord = (overrides = {}) => ({ start: 0, end: 1, stretch: 1, reverse: false, next: null, ...overrides });
const sine = (seconds = 2, frequency = 223.7) => Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => Math.sin(2 * Math.PI * frequency * i / RATE) * 0.5);
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
function render(core, seconds) { return Float32Array.from({ length: Math.round(RATE * seconds) }, () => core.tick()); }
function coreWithSource(configuration = cord(), samples = sine()) {
  const core = new TimeLoomDSP(RATE);
  core.setSource(0, samples, RATE);
  core.setState({ cords: [configuration], activeCord: 0 });
  core.seek(0, configuration.reverse ? configuration.end : configuration.start);
  return core;
}

test("model bounds hostile state and makes independent copies", () => {
  const state = normalizeState({ activeCord: Infinity, cords: [
    { start: 4, end: -4, stretch: NaN, reverse: "false", next: 8 },
    { start: 0.7, end: 0.1, stretch: 100, reverse: true, next: 0 }, null,
  ] });
  assert.equal(state.activeCord, 0);
  for (const value of state.cords) {
    assert.ok(value.start >= 0 && value.end <= 1 && value.end - value.start >= 0.02 - 1e-12);
    assert.ok(value.stretch >= 0.5 && value.stretch <= 4);
  }
  assert.equal(state.cords[0].reverse, false); assert.equal(state.cords[0].next, null);
  assert.equal(state.cords[1].next, 0); assert.equal(state.cords[1].stretch, 4);
  state.cords[0].start = 0;
  assert.equal(createDefaultState().cords[0].start, 0.04);
  const source = sanitizeSource([NaN, Infinity, -Infinity, 5, -5, 0.2], RATE);
  assert.deepEqual(Array.from(source.samples).slice(0, 5), [0, 0, 0, 1, -1]);
  assert.equal(sanitizeSource(new Float32Array(RATE * 31), RATE).samples.length, RATE * 30);
});

test("authored demo is repeatable, bounded, varied and eight seconds long", () => {
  const first = createDemo(RATE), second = createDemo(RATE);
  assert.equal(first.length, RATE * 8); assert.deepEqual(first, second);
  let peak = 0;
  for (const value of first) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); }
  assert.ok(peak > 0.6 && peak < 0.67); assert.ok(rms(first) > 0.04);
  const levels = Array.from({ length: 16 }, (_, index) => rms(first.subarray(index * RATE / 2, (index + 1) * RATE / 2)));
  assert.ok(Math.max(...levels) > Math.min(...levels) * 2);
  assert.equal(getWaveform(first).length, 96);
  assert.ok(getWaveform(first).some(value => value > 0.3));
  assert.ok(getWaveform(null).every(value => value === 0));
});

test("audio arm and playback are independent, stop releases and pause retains position", () => {
  const core = coreWithSource();
  core.setPlaying(true);
  assert.equal(rms(render(core, 0.2)), 0);
  assert.ok(core.snapshot().position > 0.09);
  core.setArmed(true); assert.ok(rms(render(core, 0.2)) > 0.08);
  core.setArmed(false); render(core, 0.25);
  assert.equal(rms(render(core, 0.1)), 0); assert.equal(core.playing, true);
  core.setArmed(true); render(core, 0.1);
  const beforeStop = core.position;
  core.setPlaying(false);
  const release = render(core, 0.15);
  assert.ok(Math.abs(release[0]) < 0.5);
  assert.equal(rms(release.subarray(RATE / 10)), 0);
  assert.equal(core.position, beforeStop); assert.equal(core.armed, true);
});

test("stretch changes loop duration on the audio clock and reverse reads upward", () => {
  for (const reverse of [false, true]) for (const stretch of [0.5, 1, 4]) {
    const core = coreWithSource(cord({ start: 0.2, end: 0.6, stretch, reverse }), sine(1));
    core.setPlaying(true);
    const frames = Math.round(RATE * 0.4 * stretch);
    for (let i = 0; i < frames - 2; i++) core.tick();
    assert.equal(core.transitions, 0, `${reverse}, ${stretch}`);
    const before = core.position;
    assert.ok(reverse ? before < 0.201 : before > 0.599);
    for (let i = 0; i < 4; i++) core.tick();
    assert.equal(core.transitions, 1, `${reverse}, ${stretch}`);
    assert.ok(reverse ? core.position > 0.599 : core.position < 0.201);
  }
});

test("exit links move the single reader to each destination's direction-dependent entry", () => {
  const core = coreWithSource(cord({ start: 0.1, end: 0.3, stretch: 2, next: 1 }), sine(1));
  core.setSource(1, sine(0.5), RATE);
  core.setState({ cords: [
    cord({ start: 0.1, end: 0.3, stretch: 2, next: 1 }),
    cord({ start: 0.4, end: 0.8, stretch: 0.5, reverse: true, next: 2 }),
    cord({ start: 0.1, end: 0.9 }),
  ] });
  core.setPlaying(true);
  render(core, 0.399);
  assert.equal(core.activeCord, 0);
  render(core, 0.002);
  assert.equal(core.activeCord, 1); assert.ok(core.position > 0.79 && core.position < 0.8);
  render(core, 0.101);
  assert.equal(core.activeCord, 2); assert.ok(core.position >= 0.1 && core.position < 0.102);
  assert.equal(core.transitions, 2);
});

test("waveform-aligned grains retain pitch at stretch extremes and reverse", () => {
  for (const stretch of [0.5, 1, 2, 4]) for (const reverse of [false, true]) {
    const core = coreWithSource(cord({ stretch, reverse }), sine(4));
    core.seek(0, reverse ? 0.8 : 0.2);
    core.setArmed(true); core.setPlaying(true); render(core, 0.15);
    const samples = render(core, 0.5);
    assert.ok(rms(samples) > 0.09, `non-silent at ${stretch}, ${reverse}`);
    let strongest = 0; let peakFrequency = 0;
    for (let frequency = 180; frequency <= 260; frequency += 0.5) {
      let real = 0; let imaginary = 0;
      for (let i = 0; i < samples.length; i++) {
        const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / samples.length);
        real += samples[i] * window * Math.cos(2 * Math.PI * frequency * i / RATE);
        imaginary += samples[i] * window * Math.sin(2 * Math.PI * frequency * i / RATE);
      }
      const amplitude = real * real + imaginary * imaginary;
      if (amplitude > strongest) { strongest = amplitude; peakFrequency = frequency; }
    }
    assert.ok(Math.abs(peakFrequency - 223.7) < 3, `pitch ${peakFrequency} at ${stretch}, ${reverse}`);
  }
});

test("route seams, live knots, direction and source replacement remain bounded", () => {
  const positive = new Float32Array(RATE).fill(0.8);
  const negative = new Float32Array(RATE).fill(-0.8);
  const core = coreWithSource(cord({ start: 0.1, end: 0.3, next: 1 }), positive);
  core.setSource(1, negative, RATE);
  core.setState({ cords: [cord({ start: 0.1, end: 0.3, next: 1 }), cord({ start: 0.2, end: 0.5, next: 0 })] });
  core.setArmed(true); core.setPlaying(true);
  const samples = render(core, 0.7);
  let maximumStep = 0;
  for (let i = 1; i < samples.length; i++) maximumStep = Math.max(maximumStep, Math.abs(samples[i] - samples[i - 1]));
  assert.ok(maximumStep < 0.06, `largest seam step ${maximumStep}`);
  const playing = core.playing;
  for (let edit = 0; edit < 80; edit++) {
    core.setState({ cords: [cord({ start: edit % 2 * 0.1, end: 0.3, reverse: edit % 2 === 0, stretch: edit % 3 ? 0.5 : 4 })] });
    core.seek(0, edit % 2 ? 0 : 1);
    if (edit % 10 === 0) core.setSource(0, [NaN, Infinity, -4, 4], RATE);
    const result = render(core, 0.003);
    for (const value of result) assert.ok(Number.isFinite(value) && Math.abs(value) <= 0.98);
  }
  assert.equal(core.playing, playing); assert.equal(core.grains.length, 12);
  core.setPlaying(false); render(core, 0.2);
  assert.ok(core.grains.every(grain => grain.samples === null));
});

test("silent preview advances the same routes as audio and bounds overdue time", () => {
  const cords = [cord({ start: 0.1, end: 0.3, next: 1 }), cord({ start: 0.2, end: 0.6, reverse: true, stretch: 2, next: 2 }), cord()];
  const preview = advanceTransport({ cords, activeCord: 0, position: 0.1, playing: true }, 0.7, [1, 0.5, 1]);
  assert.equal(preview.activeCord, 2); assert.equal(preview.transitions, 2);
  assert.ok(Math.abs(preview.position - 0.1) < 1e-10);
  const overdue = advanceTransport({ cords: [cord(), cord(), cord()], activeCord: 0, position: 0 }, 80, [8, 8, 8]);
  assert.equal(overdue.position, 0.125);
  assert.equal(advanceTransport({ ...overdue, playing: false }, 1, [8, 8, 8]).position, overdue.position);
});

function mockRuntime(moduleGate = Promise.resolve()) {
  const records = { contexts: [], nodes: [] };
  class Context {
    constructor() {
      this.state = "suspended"; this.sampleRate = RATE; this.currentTime = 0; this.destination = {};
      this.audioWorklet = { addModule: () => moduleGate }; this.closes = 0; records.contexts.push(this);
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; this.closes++; }
    addEventListener() {} removeEventListener() {}
  }
  class Worklet {
    constructor(context, name, options) {
      this.context = context; this.name = name; this.options = options; this.messages = []; this.connections = [];
      this.port = { postMessage: message => this.messages.push(message), close: () => { this.closed = true; } };
      records.nodes.push(this);
    }
    connect(target) { this.connections.push(target); }
    disconnect(target) { this.connections = target ? this.connections.filter(value => value !== target) : []; }
  }
  return { runtime: { AudioContext: Context, AudioWorkletNode: Worklet }, records };
}

test("engine creates audio only from init, keeps mic init muted and releases its output lease", async () => {
  const { runtime, records } = mockRuntime();
  const engine = new TimeLoomAudio({ runtime });
  engine.setSource(0, sine(), RATE); engine.setPlaying(true); engine.seek(0, 0.2);
  assert.equal(records.contexts.length, 0); assert.equal(engine.setArmed(true), false);
  await engine.init();
  assert.equal(records.contexts.length, 1); assert.equal(records.nodes.length, 1);
  const node = records.nodes[0];
  assert.equal(node.messages.find(message => message.type === "arm").value, false);
  assert.equal(node.messages.find(message => message.type === "seek").position, 0.2);
  assert.equal(node.messages.find(message => message.type === "play").value, true);
  assert.equal(node.options.numberOfInputs, 0);
  assert.equal(engine.setArmed(true), true);
  engine.setArmed(false); assert.equal(engine.getSnapshot().playing, true);
  await engine.init(); assert.equal(records.nodes.length, 1);
  node.onprocessorerror(); assert.equal(engine.node, null); assert.equal(engine.armed, false);
  await engine.init(); assert.equal(records.nodes.length, 2);
  assert.equal(engine.playing, true); assert.equal(engine.armed, false);
  await engine.dispose(); await engine.dispose();
  assert.equal(records.contexts[0].closes, 1); assert.equal(node.connections.length, 0);
  assert.equal(engine.context, null); assert.equal(node.closed, true);
  assert.equal(await engine.init(), false);
});

test("disposing during worklet startup cannot attach a late graph", async () => {
  let resolveModule;
  const { runtime, records } = mockRuntime(new Promise(resolve => { resolveModule = resolve; }));
  const engine = new TimeLoomAudio({ runtime });
  const starting = engine.init();
  await Promise.resolve(); await Promise.resolve();
  await engine.dispose(); resolveModule();
  assert.equal(await starting, false); assert.equal(records.nodes.length, 0);
  assert.equal(records.contexts[0].state, "closed");
});

test("actual worklet renders without UI scheduling, publishes route state and shuts down", async () => {
  let Processor;
  const saved = { AudioWorkletProcessor: globalThis.AudioWorkletProcessor, registerProcessor: globalThis.registerProcessor, sampleRate: globalThis.sampleRate };
  globalThis.sampleRate = RATE;
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; }
  };
  globalThis.registerProcessor = (name, value) => { assert.equal(name, "morphazoid-time-loom"); Processor = value; };
  try {
    await import("../src/instruments/time-loom/time-loom-processor.js");
    const processor = new Processor();
    const send = message => processor.port.onmessage({ data: message });
    const output = [[new Float32Array(128), new Float32Array(128)]];
    send({ type: "source", index: 0, samples: sine(), sampleRate: RATE });
    send({ type: "play", value: true });
    for (let i = 0; i < 10; i++) processor.process([], output);
    assert.equal(rms(output[0][0]), 0);
    send({ type: "arm", value: true });
    for (let i = 0; i < 20; i++) processor.process([], output);
    assert.ok(rms(output[0][0]) > 0.05); assert.deepEqual(output[0][0], output[0][1]);
    assert.ok(processor.messages.at(-1).state.time > 0.4);
    assert.ok(processor.messages.at(-1).state.position > 0.2);
    send({ type: "dispose" }); assert.equal(processor.process([], output), false);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});
