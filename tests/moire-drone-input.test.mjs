import assert from "node:assert/strict";
import test from "node:test";
import {
  MOIRE_DRONE_DEFAULTS,
  MOIRE_DRONE_MANUAL_MOTION_SETTINGS,
  MoireDroneAudio,
  MoireDroneKernel,
} from "../src/instruments/moire-drone/moire-drone.js";
import { AUDIO_INPUT_STORAGE_KEY } from "../src/audio-input-settings.js";

const SAMPLE_RATE = 16_000;
const BLOCK_SIZE = 128;
const NEUTRAL = {
  ...MOIRE_DRONE_MANUAL_MOTION_SETTINGS,
  filteredMix: 0, combDepth: 0, space: 0, feedback: 0, drive: 0,
  stereoWidth: 0, dust: 0,
};
function kernel(parameters = {}) {
  const result = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters: { ...NEUTRAL, ...parameters } });
  result.setSourceMode("input");
  result.setActive(true);
  return result;
}
function tone(length = SAMPLE_RATE / 2, frequency = 2_000, level = 0.1) {
  return Float32Array.from({ length }, (_, index) => Math.sin(index * Math.PI * 2 * frequency / SAMPLE_RATE) * level);
}
function render(engine, leftInput, rightInput = leftInput, frames = leftInput?.length ?? SAMPLE_RATE / 2) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += BLOCK_SIZE) {
    const end = Math.min(frames, offset + BLOCK_SIZE);
    engine.process(left.subarray(offset, end), right.subarray(offset, end),
      leftInput?.subarray(offset, end), rightInput?.subarray(offset, end));
  }
  for (const channel of [left, right]) for (const value of channel) {
    assert.ok(Number.isFinite(value) && Math.abs(value) <= 0.980001, "audio must remain finite and bounded");
  }
  return { left, right };
}
function rms(values, start = Math.floor(values.length / 2)) {
  let sum = 0;
  for (let index = start; index < values.length; index++) sum += values[index] ** 2;
  return Math.sqrt(sum / (values.length - start));
}
function difference(left, right) {
  return rms(Float32Array.from(left, (value, index) => value - right[index]));
}

test("input mode is silent without a source, including synthesized dust and physical impacts", () => {
  for (const blend of [0, 0.5, 1]) {
    const engine = kernel({ ...MOIRE_DRONE_DEFAULTS, dust: 1, propagationGain: 1, spectralFilterBlend: blend });
    engine.impactFabric(0.2, -0.3, 1.8, 0.5);
    engine.tugFabric(-0.4, 0.4, 0.8);
    engine.releaseFabric();
    const output = render(engine);
    assert.equal(output.left.every((value) => value === 0), true);
    assert.equal(output.right.every((value) => value === 0), true);
  }
});

test("the broadband endpoint retains stereo phase, unity input level and mono duplication", () => {
  const left = tone(), antiPhase = Float32Array.from(left, (value) => -value);
  const stereo = render(kernel(), left, antiPhase);
  assert.ok(Math.abs(rms(stereo.left) - 0.1 / Math.SQRT2) < 1e-6);
  assert.ok(stereo.left.every((value, index) => Math.abs(value + stereo.right[index]) < 1e-7));
  const mono = render(kernel(), left);
  assert.deepEqual(mono.left, mono.right);
});

test("both resonator fields retain independent stereo through cascade and Q/FFT filtering", () => {
  const input = tone(), zeros = new Float32Array(input.length);
  for (const blend of [0, 0.5, 1]) {
    const parameters = { filteredMix: 1, cascade: 0.8, spectralFilterBlend: blend, combDepth: 0.75, combWidth: 0.04 };
    const single = render(kernel(parameters), input, zeros);
    assert.ok(rms(single.left) > 0.0001);
    assert.equal(single.right.every((value) => value === 0), true, "a left input cannot leak right before intentional ambience");
    const stereo = render(kernel(parameters), input, Float32Array.from(input, (value) => -value));
    assert.ok(rms(stereo.left) > 0.0001, "anti-phase stereo cannot disappear through an input downmix");
    assert.ok(stereo.left.every((value, index) => Math.abs(value + stereo.right[index]) < 1e-6));
  }
});

test("warp, weft, resonance, collision and cascade remain audible in the full input chain", () => {
  const input = Float32Array.from(tone(), (value, index) => value + Math.sin(index * 0.417) * 0.06);
  const base = render(kernel({ filteredMix: 1 }), input).left;
  for (const parameters of [
    { fieldAAngle: 150, fieldADepth: 1.2, fieldADensity: 7 },
    { fieldBAngle: 130, fieldBDepth: 1.2, fieldBDensity: 8 },
    { resonance: 0.98 },
    { collisionAmount: 1, collisionWidth: 1, collisionPolarity: 1 },
    { cascade: 1 },
  ]) {
    const changed = render(kernel({ filteredMix: 1, ...parameters }), input).left;
    assert.ok(difference(base, changed) > 0.001, `input must respond to ${JSON.stringify(parameters)}`);
  }
});

test("Q, FFT and hybrid low-pass sculpting remove the same high input tone", () => {
  const input = tone();
  const neutral = rms(render(kernel(), input).left);
  for (const blend of [0, 0.5, 1]) {
    const output = render(kernel({ combDepth: 1, spectralSculptMode: "lowpass", combOffset: 0.3, spectralFilterBlend: blend }), input);
    assert.ok(rms(output.left) < neutral * 0.05, `blend ${blend} must filter supplied audio`);
  }
});

test("source handover removes old noise and ambience without flattening a held fabric", () => {
  const engine = new MoireDroneKernel({ sampleRate: SAMPLE_RATE });
  engine.setActive(true);
  assert.ok(rms(render(engine).left) > 0.00001);
  engine.tugFabric(0.3, -0.2, 0.75);
  engine.setSourceMode("input");
  const output = render(engine);
  assert.equal(engine.fabricTugActive, true);
  assert.equal(engine.fabricTugX, 0.3);
  assert.equal(engine.fabricTugY, -0.2);
  assert.equal(rms(output.left), 0, "generator and delay history must not sound in the disconnected input mode");
  assert.ok(output.left.some((value) => value !== 0), "handover fades existing sound before clearing it");
  engine.setSourceMode("noise");
  assert.ok(rms(render(engine).left) > 0.00001);
  assert.equal(engine.fabricTugActive, true);
});

test("a device onset fades before spectral latency instead of arriving at full level", () => {
  const engine = kernel();
  render(engine);
  engine.resetSourceAudio({ connecting: true });
  const output = render(engine, new Float32Array(4_096).fill(0.1)).left;
  const first = output.findIndex((value) => value > 1e-8);
  assert.ok(first >= 1_000, "the Q/FFT alignment delay is retained");
  assert.ok(output[first] < 0.001, "the delayed onset must still begin near zero");
  let jump = 0;
  for (let index = 1; index < output.length; index++) jump = Math.max(jump, Math.abs(output[index] - output[index - 1]));
  assert.ok(jump < 0.002, "a constant input connection ramps rather than stepping");
  assert.ok(rms(output) > 0.09);
});

test("input trim is smoothed, bounded and excluded from musical parameter recall", () => {
  const engine = kernel(), input = tone();
  const before = rms(render(engine, input).left);
  engine.setInputGain(2);
  assert.ok(Math.abs(rms(render(engine, input).left) / before - 2) < 0.002);
  engine.setParameters({ ...MOIRE_DRONE_DEFAULTS, ...NEUTRAL });
  assert.equal(engine.sourceMode, "input");
  assert.equal(engine.inputGainTarget, 2);
  assert.equal(engine.setInputGain(Infinity), 1);
  assert.equal(engine.setInputGain(200), 4);
  assert.equal(engine.setInputGain(-1), 0);
  const output = render(engine, new Float32Array(input.length).fill(Infinity), new Float32Array(input.length).fill(NaN));
  assert.equal(rms(output.left), 0);
  assert.equal(rms(output.right), 0);
});

class FakeNode {
  constructor() { this.connections = new Set(); this.messages = []; this.port = { postMessage: (message) => this.messages.push(message) }; }
  connect(target) { this.connections.add(target); return target; }
  disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); }
}
const parameter = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
function fakeStream(channels = 2) {
  const listeners = new Map();
  const track = {
    label: "Test interface", readyState: "live", stops: 0,
    getSettings: () => ({ channelCount: channels }),
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type, callback) => { if (listeners.get(type) === callback) listeners.delete(type); },
    stop() { this.stops++; this.readyState = "ended"; },
    end() { this.readyState = "ended"; listeners.get("ended")?.(); },
  };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}
function runtime(getUserMedia = async () => fakeStream()) {
  const requests = [], contexts = [], worklets = [];
  const saved = new Map([[AUDIO_INPUT_STORAGE_KEY, JSON.stringify({ inputId: "interface", inputChannels: 2 })]]);
  class Context {
    constructor() {
      this.state = "suspended"; this.currentTime = 0; this.sampleRate = SAMPLE_RATE; this.destination = {};
      this.audioWorklet = { addModule: async () => {} }; contexts.push(this);
    }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
    createGain() { const node = new FakeNode(); node.gain = parameter(); return node; }
    createBiquadFilter() { const node = new FakeNode(); node.frequency = parameter(); node.Q = parameter(); return node; }
    createWaveShaper() { return new FakeNode(); }
    createAnalyser() { const node = new FakeNode(); node.frequencyBinCount = 1024; return node; }
    createMediaStreamSource(stream) { const node = new FakeNode(); node.stream = stream; return node; }
  }
  class Worklet extends FakeNode {
    constructor(context, name, options) { super(); Object.assign(this, { context, name, options }); worklets.push(this); }
  }
  return {
    AudioContext: Context, AudioWorkletNode: Worklet,
    navigator: { mediaDevices: { getUserMedia: (constraints) => { requests.push(constraints); return getUserMedia(constraints); } } },
    localStorage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    requests, contexts, worklets,
  };
}

test("capture starts only from explicit Connect and uses shared device/stereo settings", async () => {
  const environment = runtime(), audio = new MoireDroneAudio(environment), observed = [];
  audio.onInputStateChange = (state) => observed.push(state);
  audio.setSourceMode("input");
  audio.setParameters({ resonance: 0.8 });
  await assert.rejects(audio.startInput(), /Turn Audio on/);
  assert.equal(environment.requests.length, 0);
  await audio.start();
  assert.equal(environment.requests.length, 0, "Audio arming and source selection cannot request capture");
  assert.equal(environment.worklets[0].options.numberOfInputs, 1);
  assert.equal(await audio.startInput(), true);
  assert.equal(environment.requests.length, 1);
  assert.deepEqual(environment.requests[0].audio, {
    deviceId: { exact: "interface" }, channelCount: { ideal: 2 },
    echoCancellation: { ideal: false }, noiseSuppression: { ideal: false }, autoGainControl: { ideal: false },
  });
  assert.equal(audio.inputChannelNode.channelCount, 2);
  assert.equal(audio.inputChannelNode.channelCountMode, "explicit");
  assert.equal(audio.inputDescription, "Test interface · stereo");
  assert.deepEqual(observed.at(-1), { sourceMode: "input", active: true, pending: false, description: "Test interface · stereo" });
  const stream = audio.inputStream, source = audio.inputNode, bus = audio.inputChannelNode;
  audio.setInputGain(2);
  audio.setParameters(MOIRE_DRONE_DEFAULTS);
  assert.equal(audio.inputGain, 2);
  assert.equal(audio.inputStream, stream, "preset recall preserves capture and source choice");
  await audio.startInput();
  assert.equal(environment.requests.length, 1, "repeated Connect reuses the stream");
  await audio.stop();
  assert.equal(stream.track.stops, 1);
  assert.equal(source.connections.size + bus.connections.size, 0);
  assert.equal(audio.inputActive, false);
  assert.equal(audio.sourceMode, "input");
  await audio.start();
  assert.equal(environment.requests.length, 1, "Audio rearming requires a fresh explicit Connect");
  await audio.close();
});

test("mono selection uses an explicit downmix bus and an existing source can end safely", async () => {
  const stream = fakeStream(1), environment = runtime(async () => stream), audio = new MoireDroneAudio(environment);
  await audio.start(); audio.setSourceMode("input");
  await audio.startInput({ inputChannels: 1, inputId: "mono-in", echoCancellation: true });
  assert.equal(audio.inputChannelNode.channelCount, 1);
  assert.equal(audio.inputChannelNode.channelInterpretation, "speakers");
  assert.equal(environment.requests[0].audio.echoCancellation.ideal, true);
  stream.track.end();
  assert.equal(audio.inputActive, false);
  assert.equal(audio.sourceMode, "input", "lost input stays silent instead of replacing it with noise");
  await audio.close();
});

test("capture cancellation rejects promptly, retires a late grant and permits a fresh request", async () => {
  let grant;
  const late = fakeStream(), current = fakeStream();
  const environment = runtime(() => environment.requests.length === 1
    ? new Promise((resolve) => { grant = resolve; }) : Promise.resolve(current));
  const audio = new MoireDroneAudio(environment);
  await audio.start(); audio.setSourceMode("input");
  const pending = audio.startInput();
  assert.equal(audio.startInput(), pending, "pending requests are single-flight");
  assert.equal(audio.inputPending, true);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  audio.stopInput();
  await rejected;
  assert.equal(audio.inputPending, false);
  await audio.startInput();
  grant(late); await Promise.resolve(); await Promise.resolve();
  assert.ok(late.track.stops >= 1);
  assert.equal(audio.inputStream, current, "the stale grant cannot detach the new stream");
  audio.setSourceMode("noise");
  assert.equal(current.track.stops, 1);
  assert.equal(audio.inputActive, false);
  await assert.rejects(audio.startInput(), /Choose Mic/);
  await audio.close();
});

test("Audio off, Noise selection and close each cancel a pending permission prompt", async () => {
  for (const action of ["stop", "noise", "close"]) {
    let grant;
    const stream = fakeStream(), environment = runtime(() => new Promise((resolve) => { grant = resolve; }));
    const audio = new MoireDroneAudio(environment);
    await audio.start(); audio.setSourceMode("input");
    const pending = audio.startInput(), rejected = assert.rejects(pending, { name: "AbortError" });
    if (action === "noise") audio.setSourceMode("noise");
    else await audio[action]();
    await rejected;
    grant(stream); await Promise.resolve(); await Promise.resolve();
    assert.ok(stream.track.stops >= 1, action);
    assert.equal(audio.inputActive, false);
    await audio.close();
  }
});

test("denied and unsupported capture remain recoverable without changing Audio or the source", async () => {
  const denial = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
  const environment = runtime(async () => { throw denial; }), audio = new MoireDroneAudio(environment);
  await audio.start(); audio.setSourceMode("input");
  await assert.rejects(audio.startInput(), denial);
  assert.equal(audio.inputPending, false);
  assert.equal(audio.inputActive, false);
  assert.equal(audio.enabled, true);
  assert.equal(audio.sourceMode, "input");
  environment.navigator = {};
  await assert.rejects(audio.startInput(), /secure browser/);
  await audio.close();
});

test("an ordinary WAX artifact cannot restore permission or browser device identity", async () => {
  const environment = runtime(); environment.MorphazoidWAX = {};
  const audio = new MoireDroneAudio(environment);
  audio.setSourceMode("input"); await audio.start(); audio.setParameters(MOIRE_DRONE_DEFAULTS);
  assert.equal(environment.requests.length, 0);
  await audio.startInput();
  assert.equal(environment.requests[0].audio.deviceId, undefined);
  await audio.close();
});

test("the worklet accepts stereo render input and keeps disconnected input silent", async (t) => {
  let Processor;
  const previous = ["AudioWorkletProcessor", "registerProcessor", "sampleRate"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  globalThis.sampleRate = SAMPLE_RATE;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
  await import(`../src/instruments/moire-drone/moire-drone.js?input-test=${Date.now()}`);
  const processor = new Processor({ processorOptions: { parameters: NEUTRAL } });
  processor.performanceNow = null;
  processor.port.onmessage({ data: { type: "source-mode", value: "input" } });
  processor.port.onmessage({ data: { type: "active", value: true } });
  const input = tone(BLOCK_SIZE), opposite = Float32Array.from(input, (value) => -value);
  const outputs = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
  for (let block = 0; block < 30; block++) processor.process([[input, opposite]], [outputs]);
  assert.ok(rms(outputs[0], 0) > 0.02);
  assert.ok(outputs[0].every((value, index) => Math.abs(value + outputs[1][index]) < 1e-6));
  processor.port.onmessage({ data: { type: "input-reset" } });
  for (let block = 0; block < 30; block++) processor.process([], [outputs]);
  assert.equal(outputs[0].every((value) => value === 0), true);
});
