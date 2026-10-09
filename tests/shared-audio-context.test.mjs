import assert from "node:assert/strict";
import test from "node:test";
import { VoicePool } from "../src/audio.js";
import { FmDrumAudio } from "../src/instruments/fm-drums/fm-drums.js";
import { SampleDrumAudio } from "../src/instruments/sample-drums/sample-drums.js";
import { ShapesKitAudio } from "../src/instruments/shapes/kit-audio.js";
import { MicBranchEngine } from "../src/families/mic-branch/mic-branch-engine.js";
import { getSharedAudioOutputManager } from "../src/audio-output-manager.js";

function param(value = 0) {
  return {
    value,
    setValueAtTime(next) { this.value = next; },
    setTargetAtTime(next) { this.value = next; },
    linearRampToValueAtTime(next) { this.value = next; },
    exponentialRampToValueAtTime(next) { this.value = next; },
    cancelScheduledValues() {}, cancelAndHoldAtTime() {},
  };
}
class AudioNode {
  constructor() { this.connections = new Set(); this.disconnected = false; this.stopCalls = 0; }
  connect(target) { this.connections.add(target); return target; }
  disconnect(target) {
    if (target) this.connections.delete(target);
    else { this.connections.clear(); this.disconnected = true; }
  }
  start() {}
  stop() { this.stopCalls += 1; }
}
class FakeContext {
  static constructed = 0;
  constructor() {
    if (new.target === FakeContext) FakeContext.constructed += 1;
    this.state = "suspended";
    this.currentTime = 0;
    this.sampleRate = 48_000;
    this.closeCalls = 0;
    this.suspendCalls = 0;
    this.resumeCalls = 0;
    this.nodes = [];
    this.destination = new AudioNode();
    this.audioWorklet = { async addModule() {} };
  }
  node(properties = {}) {
    const node = Object.assign(new AudioNode(), properties);
    this.nodes.push(node);
    return node;
  }
  createGain() { return this.node({ gain: param(1) }); }
  createDynamicsCompressor() {
    return this.node(Object.fromEntries(["threshold", "knee", "ratio", "attack", "release"].map(key => [key, param()])));
  }
  createAnalyser() {
    return this.node({ fftSize: 2_048, getFloatTimeDomainData(target) { target.fill(0); } });
  }
  createChannelSplitter() { return this.node(); }
  createWaveShaper() { return this.node(); }
  createStereoPanner() { return this.node({ pan: param() }); }
  createBiquadFilter() { return this.node({ frequency: param(440), Q: param(1), gain: param() }); }
  createOscillator() { return this.node({ frequency: param(440), detune: param() }); }
  createBufferSource() { return this.node({ playbackRate: param(1) }); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, numberOfChannels: channels, duration: length / sampleRate,
      getChannelData(channel) { return data[channel]; } };
  }
  async resume() { this.resumeCalls += 1; this.state = "running"; }
  async suspend() { this.suspendCalls += 1; this.state = "suspended"; }
  async close() { this.closeCalls += 1; this.state = "closed"; }
}
class FakeOfflineContext extends FakeContext {
  constructor(channels, length, sampleRate) {
    super();
    this.channels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }
  async startRendering() { return this.createBuffer(this.channels, this.length, this.sampleRate); }
}
class FakeWorklet extends AudioNode {
  constructor(context) {
    super();
    context.nodes.push(this);
    this.port = { postMessage() {}, start() {} };
  }
}
function installRuntime(t) {
  for (const [key, value] of Object.entries({
    AudioContext: FakeContext, OfflineAudioContext: FakeOfflineContext, AudioWorkletNode: FakeWorklet,
  })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (old) Object.defineProperty(globalThis, key, old);
      else delete globalThis[key];
    });
  }
}
const engines = [
  { name: "VoicePool", create: () => new VoicePool(2), start: (engine, context) => engine.enable({ context }) },
  { name: "FmDrumAudio", create: () => new FmDrumAudio(), start: (engine, context) => engine.start({ context }) },
  { name: "SampleDrumAudio", create: () => new SampleDrumAudio(), start: (engine, context) => engine.start({ context }) },
  { name: "ShapesKitAudio", create: () => new ShapesKitAudio(), start: (engine, context) => engine.start("fm-kit", { context }) },
  { name: "MicBranchEngine", create: () => new MicBranchEngine(2, { adaptive: false }), start: (engine, context) => engine.initialize({ context }) },
];

test("all retained instrument engines share one final-output clock and close independently", async (t) => {
  installRuntime(t);
  const context = new FakeContext();
  const constructions = FakeContext.constructed;
  const manager = getSharedAudioOutputManager();
  const baseline = manager.connectionCount();
  const instances = engines.map(descriptor => ({ ...descriptor, instance: descriptor.create() }));
  t.after(async () => { for (const { instance } of instances) await instance.close(); });
  for (const { name, instance, start } of instances) {
    await start(instance, context);
    assert.equal(instance.context, context, `${name} uses the supplied clock`);
    assert.equal(instance.ownsContext, false);
  }
  assert.equal(FakeContext.constructed, constructions, "no extra live AudioContext is allocated");
  assert.equal(manager.contexts.get(context).sources.size, engines.length);
  assert.equal(manager.connectionCount(), baseline + engines.length);
  for (let index = 0; index < instances.length; index += 1) {
    const { name, instance } = instances[index];
    await instance.close();
    assert.equal(context.state, "running", `${name}.close leaves its peers running`);
    assert.equal(context.closeCalls, 0);
    assert.equal(context.suspendCalls, 0);
    assert.equal(manager.connectionCount(), baseline + engines.length - index - 1);
    for (const { instance: peer } of instances.slice(index + 1)) {
      assert.equal(peer.context, context);
      assert.ok([...manager.contexts.get(context).sources].some(source => source.connections.has(context.destination)), "the peer's speaker connection remains intact");
    }
  }
});

for (const descriptor of engines) {
  test(`${descriptor.name} rejects live rebinds and closed supplied contexts without changing the current graph`, async (t) => {
    installRuntime(t);
    const engine = descriptor.create();
    t.after(() => engine.close());
    const context = new FakeContext();
    await descriptor.start(engine, context);
    const master = engine.master;
    const other = new FakeContext();
    await assert.rejects(descriptor.start(engine, other), /before changing its audio context/);
    assert.equal(engine.context, context);
    assert.equal(engine.master, master);
    assert.equal(context.closeCalls, 0);
    assert.equal(other.resumeCalls, 0);
    other.state = "closed";
    await assert.rejects(descriptor.start(engine, other), /supplied audio context is closed/);
    assert.equal(engine.context, context);
    await engine.close();
    assert.equal(context.state, "running");
    const replacement = new FakeContext();
    await descriptor.start(engine, replacement);
    assert.equal(engine.context, replacement, "explicit close permits a new borrowed context");
    await engine.close();
    assert.equal(replacement.closeCalls, 0);
  });

  test(`${descriptor.name} still owns and closes a context when no shared context is supplied`, async (t) => {
    installRuntime(t);
    const engine = descriptor.create();
    t.after(() => engine.close());
    await descriptor.start(engine);
    const context = engine.context;
    assert.equal(engine.ownsContext, true);
    assert.equal(context.state, "running");
    await engine.close();
    assert.equal(context.closeCalls, 1);
    assert.equal(context.state, "closed");
  });
}

test("VoicePool startup failure and cancellation release their nodes without closing a borrowed clock", async (t) => {
  installRuntime(t);
  const context = new FakeContext();
  context.resume = async () => { throw new Error("resume denied"); };
  const pool = new VoicePool(2);
  await assert.rejects(pool.enable({ context }), /resume denied/);
  assert.equal(context.closeCalls, 0);
  assert.equal(pool.context, null);
  assert.ok(context.nodes.filter(node => node.gain).every(node => node.disconnected));

  context.state = "running";
  let finishModule;
  context.audioWorklet.addModule = () => new Promise(resolve => { finishModule = resolve; });
  const pending = pool.enable({ context });
  await pool.close();
  await assert.rejects(pending, { name: "AbortError" });
  finishModule();
  await Promise.resolve();
  assert.equal(context.closeCalls, 0);
  assert.equal(context.state, "running");
});

test("FM Drum construction rollback never closes an external context", async (t) => {
  installRuntime(t);
  const context = new FakeContext();
  context.state = "running";
  context.createDynamicsCompressor = () => { throw new Error("node capacity exhausted"); };
  const engine = new FmDrumAudio();
  await assert.rejects(engine.start({ context }), /node capacity exhausted/);
  assert.equal(context.closeCalls, 0);
  assert.equal(context.state, "running");
  assert.equal(engine.context, null);
  await engine.close();
  assert.equal(context.closeCalls, 0);
});

for (const name of ["SampleDrumAudio", "ShapesKitAudio", "MicBranchEngine"]) {
  test(`${name} startup failure can be cleaned up without closing another engine's context`, async (t) => {
    installRuntime(t);
    const descriptor = engines.find(engine => engine.name === name);
    const context = new FakeContext();
    context.state = "running";
    const peer = new FmDrumAudio();
    await peer.start({ context });
    const peerOutput = peer.analyser;
    if (name === "SampleDrumAudio") {
      context.createDynamicsCompressor = () => { throw new Error("construction failed"); };
    } else if (name === "ShapesKitAudio") {
      globalThis.OfflineAudioContext = class { constructor() { throw new Error("preparation failed"); } };
    } else {
      context.audioWorklet.addModule = async () => { throw new Error("module failed"); };
    }
    const engine = descriptor.create();
    await assert.rejects(descriptor.start(engine, context), /failed/);
    await engine.close();
    assert.equal(context.closeCalls, 0);
    assert.equal(context.state, "running");
    assert.ok(peerOutput.connections.has(context.destination));
    await peer.close();
    assert.equal(context.closeCalls, 0);
  });
}
