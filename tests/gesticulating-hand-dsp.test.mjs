import test from "node:test";
import assert from "node:assert/strict";
import { HandDSP } from "../src/instruments/gesticulating-hand/hand-dsp.js";
import { HandAudio } from "../src/instruments/gesticulating-hand/hand-audio.js";
import { HAND_PRESETS, HAND_POSES, VOICE_SOURCES, normalizeHandConfig, evaluateHandVoices } from "../src/instruments/gesticulating-hand/hand-model.js";
import { getSharedAudioOutputManager } from "../src/audio-output-manager.js";

const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length));
const peak = samples => samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const difference = (a, b) => rms(a.map((value, i) => value - b[i]));
const scene = () => normalizeHandConfig({ motion: { id: "still" }, sound: { space: 0, attack: .012, release: .18 } });
function render(dsp, seconds = .25, block = 128) {
  const left = new Float32Array(Math.round(seconds * dsp.sampleRate)), right = new Float32Array(left.length);
  for (let offset = 0; offset < left.length; offset += block) dsp.process(left.subarray(offset, offset + block), right.subarray(offset, offset + block));
  return { left, right };
}
function engine(config = scene(), rate = 24000) {
  const dsp = new HandDSP(rate); dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true); return dsp;
}

test("Audio arm and moving choreography alone remain exactly silent at every supported rate", () => {
  for (const rate of [8000, 44100, 48000, 96000, 192000]) {
    const dsp = new HandDSP(rate); dsp.setTransport({ time: 0, playing: true }); dsp.setEnabled(true);
    assert.equal(peak(render(dsp, .07).left), 0);
    dsp.setSoundPlaying(true); const { left, right } = render(dsp, .15);
    assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
    assert.ok(rms(left) > .005 && rms(right) > .005); assert.ok(peak(left) < .82 && peak(right) < .82);
  }
});

test("all five voices and complete scene presets produce distinct finite bounded stereo output", () => {
  const signals = [];
  for (const source of VOICE_SOURCES) {
    // Hold a fixed articulated timbre fixture independently of startup pose changes.
    const config = scene(); config.pose = structuredClone(HAND_POSES.find(p => p.id === "relaxed").pose);
    config.voices.forEach((v, i) => { v.source = source; v.level = i === 2 ? 1 : 0; });
    const signal = render(engine(config)); assert.ok(rms(signal.left) > .005, source); signals.push(signal.left);
  }
  for (let i = 0; i < signals.length; i++) for (let j = i + 1; j < signals.length; j++) assert.ok(difference(signals[i], signals[j]) > .006);
  for (const preset of HAND_PRESETS) {
    const dsp = engine(preset.snapshot); dsp.setTransport({ time: .3, playing: true });
    const signal = render(dsp, .5);
    assert.ok(signal.left.every(Number.isFinite) && signal.right.every(Number.isFinite), preset.id);
    assert.ok(rms(signal.left) > .005, preset.id); assert.ok(peak(signal.left) < .82, preset.id);
  }
});

test("sound sustain, held fingers, audition and motion have independent ownership", () => {
  const dsp = engine(); dsp.setSoundPlaying(false); dsp.setHeldFingers(1 << 1);
  render(dsp, .1); assert.ok(dsp.voiceLevels[1] > .1); assert.equal(dsp.voiceLevels[2], 0);
  dsp.setHeldFingers(0); render(dsp, .5); assert.ok(peak(render(dsp, .1).left) < 1e-7);
  assert.equal(dsp.auditionFinger(4, .06), true); assert.ok(peak(render(dsp, .03).left) > .001);
  render(dsp, .8); assert.ok(peak(render(dsp, .1).left) < 1e-7);
  dsp.setSoundPlaying(true); dsp.setTransport({ time: 2.7, playing: false });
  assert.ok(rms(render(dsp, .2).left) > .01); assert.equal(dsp.getMotionTime(), 2.7);
  dsp.setTransport({ playing: true }); dsp.setSoundPlaying(false); render(dsp, .6);
  assert.ok(dsp.getMotionTime() > 3.29); assert.ok(peak(render(dsp, .1).left) < 1e-7);
  dsp.setEnabled(false); assert.equal(dsp.auditionFinger(0), false);
});

test("all sonic controls and visible joint dimensions have measurable audio effects", () => {
  const baseConfig = scene(), base = render(engine(baseConfig), .5).left;
  const edits = {
    rootHz: c => { c.sound.rootHz = 223; }, brightness: c => { c.sound.brightness = .95; },
    roughness: c => { c.sound.roughness = .95; }, space: c => { c.sound.space = .9; },
    attack: c => { c.sound.attack = .7; }, mcp: c => { c.pose.fingers[2].mcp += 30; },
    pip: c => { c.pose.fingers[1].pip += 65; }, dip: c => { c.pose.fingers[3].dip += 45; },
    spread: c => { c.pose.fingers[2].spread += 23; }, wrist: c => { c.pose.wrist.flex = 35; },
    level: c => { c.voices[0].level = 0; }, source: c => { c.voices[2].source = "pulse"; },
  };
  for (const [name, edit] of Object.entries(edits)) {
    const config = scene(); edit(config);
    assert.ok(difference(base, render(engine(config), .5).left) > .0003, `${name} has no measurable destination`);
  }
  const config = scene(); config.voices.forEach((v, i) => { v.level = i === 2 ? 1 : 0; });
  config.pose.fingers[2].spread = -25; config.pose.wrist.side = -30;
  const left = render(engine(config)); assert.ok(rms(left.left) > rms(left.right) * 5);
  config.pose.fingers[2].spread = 25; config.pose.wrist.side = 30;
  const right = render(engine(config)); assert.ok(rms(right.right) > rms(right.left) * 5);
});

test("attack and release control actual onset and tail; muting clears stale auditions", () => {
  const quick = scene(), slow = scene(); slow.sound.attack = .8;
  assert.ok(rms(render(engine(quick), .02).left) > rms(render(engine(slow), .02).left) * 5);
  const short = engine(quick), longConfig = scene(); longConfig.sound.release = 1.2; const long = engine(longConfig);
  render(short, .2); render(long, .2); short.setSoundPlaying(false); long.setSoundPlaying(false);
  const tailShort = render(short, .35).left, tailLong = render(long, .35).left;
  assert.ok(rms(tailLong.subarray(4800)) > rms(tailShort.subarray(4800)) * 20);
  short.setEnabled(false); short.setSoundPlaying(false); short.setHeldFingers(0); short.setEnabled(true); short.auditionFinger(0, 2);
  short.setEnabled(false); render(short, .1); short.setEnabled(true);
  assert.ok(peak(render(short, .1).left) < 1e-7, "disabled audition must not reappear on arm");
});

test("hostile input and maximum controls stay finite; changes preserve clocks and bound transients", () => {
  const config = normalizeHandConfig({ sound: { rootHz: 1000, brightness: 1, roughness: 1, space: 1, attack: .004, release: 3.5 },
    motion: { tempo: 220, amount: 1, id: "flourish" }, voices: Array.from({ length: 5 }, () => ({ source: "pulse", level: 1 })) });
  const dsp = engine(config, 8000); dsp.setTransport({ time: 4, playing: true });
  for (const preset of HAND_PRESETS) {
    const before = dsp.getMotionTime(); dsp.setConfig(preset.snapshot); assert.equal(dsp.getMotionTime(), before);
    const { left } = render(dsp, .1); assert.ok(left.every(Number.isFinite)); assert.ok(peak(left) < .82);
    let delta = 0; for (let i = 1; i < left.length; i++) delta = Math.max(delta, Math.abs(left[i] - left[i - 1]));
    assert.ok(delta < .3, preset.id);
  }
  dsp.setConfig({ sound: { rootHz: NaN, attack: Symbol(), brightness: Infinity }, pose: null, voices: [null] });
  assert.ok(render(dsp).left.every(Number.isFinite));
  dsp.setEnabled(false); render(dsp, .3); assert.ok(peak(render(dsp, .2).left) < 1e-7);
});

test("worklet advances the same pose from audio time without graphics messages and rejects expired gestures", async () => {
  const names = ["AudioWorkletProcessor", "registerProcessor", "sampleRate", "currentTime"];
  const saved = names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  let Processor;
  try {
    globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } };
    globalThis.registerProcessor = (name, Type) => { assert.equal(name, "gesticulating-hand"); Processor = Type; };
    globalThis.sampleRate = 24000; globalThis.currentTime = 0;
    await import("../src/instruments/gesticulating-hand/hand-processor.js");
    const processor = new Processor(), send = data => processor.port.onmessage({ data });
    const config = normalizeHandConfig({ motion: { id: "flourish", tempo: 73, amount: .8 }, sound: { space: 0 } });
    send({ type: "config", config }); send({ type: "enabled", enabled: true }); send({ type: "sound", playing: true });
    send({ type: "transport", transport: { time: 1.2, playing: true }, audioTime: 0 });
    const left = new Float32Array(128), right = new Float32Array(128); let max = 0;
    for (let block = 0; block < 300; block++) {
      globalThis.currentTime = block * 128 / 24000; processor.process([], [[left, right]]); max = Math.max(max, peak(left));
    }
    assert.ok(max > .02);
    const evaluatedAt = currentTime + 96 / sampleRate;
    assert.ok(Math.abs(processor.dsp.targets[2].frequency - evaluateHandVoices(config, 1.2 + evaluatedAt)[2].frequency) < 1e-9);
    send({ type: "sound", playing: false }); send({ type: "audition", index: 1, seconds: .1, audioTime: 0 });
    assert.equal(processor.dsp.voices[1].auditionUntil, -1);
    assert.ok(processor.messages.length > 10 && processor.messages.length < 25);
    send({ type: "dispose" }); assert.equal(processor.process([], [[left, right]]), false); assert.equal(peak(left), 0);
  } finally { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
});

function fakeRuntime({ deferModule = false, failModule = false } = {}) {
  const contexts = [], nodes = [], state = { now: 1000, release: null };
  class Node {
    constructor() { this.connections = []; this.disconnected = false; }
    connect(destination) { this.connections.push(destination); return destination; }
    disconnect() { this.connections = []; this.disconnected = true; }
  }
  class Context {
    constructor() {
      this.currentTime = 0; this.state = "suspended"; this.destination = new Node(); this.listeners = new Set(); this.moduleLoads = 0;
      this.audioWorklet = { addModule: () => {
        this.moduleLoads++;
        if (failModule) return Promise.reject(new Error("module failed"));
        if (!deferModule) return Promise.resolve();
        return new Promise(resolve => { state.release = resolve; });
      } }; contexts.push(this);
    }
    resume() { this.state = "running"; return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
    addEventListener(_type, callback) { this.listeners.add(callback); }
    removeEventListener(_type, callback) { this.listeners.delete(callback); }
    createGain() {
      const node = new Node(); node.gain = { value: 0, events: [], cancelScheduledValues() {},
        setTargetAtTime(value, time, constant) { this.events.push({ value, time, constant }); this.value = value; } };
      return node;
    }
  }
  class Worklet extends Node {
    constructor(context, name) {
      super(); this.context = context; this.name = name; this.sent = []; this.closed = false;
      this.port = { postMessage: data => this.sent.push(data), close: () => { this.closed = true; } }; nodes.push(this);
    }
  }
  return { runtime: { AudioContext: Context, AudioWorkletNode: Worklet, performance: { now: () => state.now } }, contexts, nodes, state };
}

test("wrapper joins current motion phase, arms silently, uses one graph and releases it", async () => {
  const { runtime, contexts, nodes, state } = fakeRuntime(), audio = new HandAudio(runtime);
  audio.setTransport({ time: 4, playing: true }); audio.setConfig(scene()); audio.setHeldFingers(0);
  assert.equal(contexts.length, 0); assert.equal(audio.auditionFinger(0), false);
  state.now += 2300; assert.ok(Math.abs(audio.getMotionTime() - 6.3) < 1e-9);
  assert.equal(await audio.arm(), true); assert.equal(audio.running, true);
  assert.equal(nodes.length, 1); assert.equal(nodes[0].sent.find(m => m.type === "sound").playing, false);
  assert.ok(Math.abs(nodes[0].sent.find(m => m.type === "transport").transport.time - 6.3) < 1e-9);
  audio.setSoundPlaying(true); audio.setHeldFingers(2); audio.setOutput(.31); audio.mute();
  assert.equal(audio.armed, false); assert.equal(audio.playing, true); assert.equal(audio.soundPlaying, true);
  assert.equal(audio.master.gain.events.at(-1).value, 0);
  assert.equal(await audio.arm(), true); assert.equal(nodes.length, 1); assert.equal(audio.master.gain.events.at(-1).value, .31);
  const manager = getSharedAudioOutputManager(runtime); assert.equal(manager.connectionCount(), 1);
  await audio.close(); assert.equal(contexts[0].state, "closed"); assert.equal(contexts[0].listeners.size, 0);
  assert.equal(manager.connectionCount(), 0); assert.equal(nodes[0].closed, true); assert.equal(audio.context, null);
});

test("rapid arm/mute/arm during module loading cannot enable a stale request or duplicate the graph", async () => {
  const { runtime, contexts, nodes, state } = fakeRuntime({ deferModule: true }), audio = new HandAudio(runtime);
  const first = audio.arm(); assert.equal(contexts.length, 1); audio.mute();
  const second = audio.arm(); audio.setSoundPlaying(true); audio.setSoundPlaying(false);
  assert.notEqual(first, second); state.release();
  assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(contexts[0].moduleLoads, 1); assert.equal(nodes.length, 1); assert.equal(audio.armed, true);
  assert.equal(nodes[0].sent.findLast(m => m.type === "sound").playing, false);
  await audio.close();
});

test("cancelled startup stays muted, teardown during loading cannot attach a graph, failures clean up", async () => {
  {
    const { runtime, state } = fakeRuntime({ deferModule: true }), audio = new HandAudio(runtime);
    const pending = audio.arm(); audio.mute(); state.release(); assert.equal(await pending, false); assert.equal(audio.armed, false);
    assert.equal(audio.master.gain.value, 0); await audio.close();
  }
  {
    const { runtime, state, nodes, contexts } = fakeRuntime({ deferModule: true }), audio = new HandAudio(runtime);
    const pending = audio.arm(); await audio.close(); state.release(); assert.equal(await pending, false);
    assert.equal(nodes.length, 0); assert.equal(contexts[0].state, "closed");
  }
  {
    const { runtime, contexts } = fakeRuntime({ failModule: true }), audio = new HandAudio(runtime);
    await assert.rejects(audio.arm(), /module failed/); assert.equal(audio.context, null); assert.equal(audio.armed, false);
    assert.equal(contexts[0].state, "closed");
  }
});


test("a fresh graph can restart during an old cancelled load and recover after processor failure", async () => {
  const { runtime, state, nodes, contexts } = fakeRuntime({ deferModule: true }), audio = new HandAudio(runtime);
  const oldStart = audio.arm(), releaseOld = state.release;
  await audio.close(); const newStart = audio.arm(), releaseNew = state.release;
  releaseOld(); assert.equal(await oldStart, false); assert.equal(nodes.length, 0);
  releaseNew(); assert.equal(await newStart, true); assert.equal(nodes.length, 1); assert.equal(contexts.length, 2);
  nodes[0].onprocessorerror(); assert.equal(audio.armed, false); assert.equal(nodes[0].closed, true);
  assert.equal(getSharedAudioOutputManager(runtime).connectionCount(), 0);
  const retry = audio.arm(); state.release(); assert.equal(await retry, true); assert.equal(nodes.length, 2);
  assert.equal(getSharedAudioOutputManager(runtime).connectionCount(), 1); await audio.close();
});


test("original source clip keeps shaping audible finger voices when no visual updates arrive and freezes on pause", () => {
  const preset = HAND_PRESETS.find(p => p.id === "original-grasp");
  const dsp = engine(preset.snapshot); dsp.setTransport({ time: 0, playing: true });
  const open = dsp.targets.map(v => v.frequency);
  render(dsp, .9);
  assert.ok(dsp.targets.some((v, i) => Math.abs(v.frequency - open[i]) > 30));
  const pose = structuredClone(dsp.pose); dsp.setTransport({ time: dsp.getMotionTime(), playing: false });
  render(dsp, .03); const stopped = structuredClone(dsp.pose);
  assert.equal(stopped.source.amount, 1); assert.ok(stopped.source.phase > 0);
  const signal = render(dsp, .3);
  assert.deepEqual(dsp.pose, stopped); assert.ok(rms(signal.left) > .005);
  assert.notDeepEqual(pose, stopped, "pause anchors at the message time, not the previous control sample");
});
