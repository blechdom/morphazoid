import assert from "node:assert/strict";
import test from "node:test";

import { getSharedAudioOutputManager } from "../src/audio-output-manager.js";
import { OculoidAudio } from "../src/instruments/oculoid/oculoid-audio.js";
import { OCULOID_DEFAULTS } from "../src/instruments/oculoid/oculoid-model.js";

function fakeAudioRuntime({ delayedFirstModule = false, delayedFirstClose = false } = {}) {
  const contexts = [], nodes = [];
  const pendingModules = [], pendingCloses = [];
  let seconds = 0;
  class Context {
    constructor() {
      this.currentTime = 0;
      this.state = "suspended";
      this.destination = {};
      this.listeners = new Set();
      this.resumes = 0;
      this.audioWorklet = {
        addModule: () => delayedFirstModule && contexts[0] === this
          ? new Promise(resolve => pendingModules.push(resolve)) : Promise.resolve(),
      };
      contexts.push(this);
    }
    addEventListener(type, listener) { if (type === "statechange") this.listeners.add(listener); }
    removeEventListener(type, listener) { if (type === "statechange") this.listeners.delete(listener); }
    emit() { for (const listener of this.listeners) listener(); }
    resume() {
      this.resumes++;
      this.state = "running";
      this.emit();
      return Promise.resolve();
    }
    suspend() {
      this.state = "suspended";
      this.emit();
      return Promise.resolve();
    }
    close() {
      this.state = "closed";
      this.emit();
      return delayedFirstClose && contexts[0] === this
        ? new Promise(resolve => pendingCloses.push(resolve)) : Promise.resolve();
    }
    createGain() {
      return {
        gain: {
          value: 0,
          cancelScheduledValues() {},
          setTargetAtTime(value) { this.value = value; },
        },
        connect() {},
        disconnect() {},
      };
    }
  }
  class WorkletNode {
    constructor(context, name, settings) {
      this.context = context;
      this.name = name;
      this.settings = settings;
      this.messages = [];
      this.port = {
        postMessage: value => this.messages.push(value),
        close: () => { this.port.closed = true; },
      };
      nodes.push(this);
    }
    connect() {}
    disconnect() { this.disconnected = true; }
  }
  const runtime = {
    performance: { now: () => seconds * 1000 },
    AudioContext: Context,
    AudioWorkletNode: WorkletNode,
  };
  return {
    runtime, contexts, nodes, pendingModules, pendingCloses,
    advance(value) {
      seconds += value;
      for (const context of contexts) if (context.state === "running") context.currentTime += value;
    },
  };
}

test("Audio resumes an interrupted graph in one gesture; a processor crash frees and rebuilds it", async () => {
  const harness = fakeAudioRuntime({ delayedFirstClose: true });
  const audio = new OculoidAudio(harness.runtime);
  const manager = getSharedAudioOutputManager(harness.runtime);
  const errors = [];
  audio.onError = error => errors.push(error.message);
  assert.equal(harness.contexts.length, 0, "Audio must be lazy");
  audio.excite(0.8);
  audio.poke({ pressure: 0.8 });
  audio.flashlight(0.8);
  audio.retractLids(true);
  audio.surface({ kind: "stretch", strength: 0.8 });
  audio.setCryTempo(132);
  audio.cry(true, 2.6);
  audio.tear(0.8);
  assert.equal(harness.contexts.length, 0, "MIDI must not arm Audio on its own");
  audio.setPlaying(true);
  assert.equal(await audio.arm(), true);
  assert.equal(audio.running, true);
  audio.excite(1.6);
  assert.deepEqual(harness.nodes[0].messages.at(-1), { type: "excite", amount: 1 });
  audio.poke({ pressure: 2, travel: 3, pan: -5, diameter: 30 });
  assert.deepEqual(harness.nodes[0].messages.at(-1), {
    type: "poke", pressure: 1, travel: 1, pan: -0.84, diameter: 0.92, cancel: false,
  });
  assert.ok(harness.nodes[0].messages.some(message =>
    message.type === "retractor" && message.active === true),
  "a live lid latch set before arming is synchronized with the worklet");
  assert.ok(harness.nodes[0].messages.some(message =>
    message.type === "cry" && message.active === true && message.beat === 2.6),
  "an unarmed Cry phase is synchronized only on explicit Audio arm");
  const initialCryTempo = harness.nodes[0].messages.findIndex(message =>
    message.type === "cry-tempo" && message.tempo === 132);
  const initialCry = harness.nodes[0].messages.findIndex(message =>
    message.type === "cry" && message.active === true);
  assert.ok(initialCryTempo >= 0 && initialCryTempo < initialCry,
    "a newly armed worklet receives Cry's own tempo before its visual beat");
  assert.equal(harness.nodes[0].messages.some(message => message.type === "tear"), false,
    "one-shot events performed before Audio was armed are not replayed");
  audio.tear(5);
  assert.deepEqual(harness.nodes[0].messages.at(-1), { type: "tear", size: 1 });
  audio.cry(true, 7);
  assert.deepEqual(harness.nodes[0].messages.at(-1), { type: "cry", active: true, beat: 3 });
  audio.cry(false);
  assert.deepEqual(harness.nodes[0].messages.at(-1), { type: "cry", active: false, beat: 0 });
  audio.setCryTempo(800);
  assert.deepEqual(harness.nodes[0].messages.at(-1), { type: "cry-tempo", tempo: 800 });
  audio.setCryTempo(999);
  assert.deepEqual(harness.nodes[0].messages.at(-1), { type: "cry-tempo", tempo: 800 });
  audio.setCryTempo(NaN);
  assert.deepEqual(harness.nodes[0].messages.at(-1), { type: "cry-tempo", tempo: 84 });
  audio.surface({ kind: "stretch", strength: 12, pan: Infinity, release: true });
  assert.deepEqual(harness.nodes[0].messages.at(-1), {
    type: "surface", kind: "stretch", strength: 1,
    pan: 0, release: true, cancel: false,
  });
  audio.surface({ kind: "stretch", cancel: true });
  assert.equal(harness.nodes[0].messages.at(-1).cancel, true);
  audio.retractLids(false);
  assert.deepEqual(harness.nodes[0].messages.at(-1), { type: "retractor", active: false });
  assert.ok(harness.nodes[0].messages.some(message =>
    message.type === "flashlight" && message.exposure === 0.8),
  "an exposure set before Audio is armed is synchronized on explicit arm");
  audio.flashlight(2);
  assert.deepEqual(harness.nodes[0].messages.at(-1), { type: "flashlight", exposure: 1 });
  audio.flashlight(NaN);
  assert.deepEqual(harness.nodes[0].messages.at(-1), { type: "flashlight", exposure: 0 });
  assert.equal(manager.getStatus().connectionCount, 1);
  assert.equal(harness.nodes[0].settings.outputChannelCount[0], 2);
  harness.advance(1);
  const beatBefore = audio.getBeat();
  await harness.contexts[0].suspend();
  assert.equal(audio.armed, true);
  assert.equal(audio.running, false);
  assert.equal(await audio.arm(), true);
  assert.equal(harness.contexts[0].resumes, 2);
  assert.equal(harness.nodes.length, 1, "suspend must reuse the live node");
  assert.equal(audio.running, true);

  harness.nodes[0].onprocessorerror();
  assert.equal(audio.armed, false);
  assert.equal(audio.node, null);
  assert.equal(manager.getStatus().connectionCount, 0);
  assert.equal(harness.nodes[0].disconnected, true);
  assert.equal(harness.nodes[0].port.closed, true);
  assert.match(errors[0], /processor stopped/);
  assert.equal(harness.pendingCloses.length, 1);
  assert.equal(await audio.arm(), true);
  assert.equal(harness.nodes.length, 2, "next explicit arm rebuilds a new node");
  assert.equal(manager.getStatus().connectionCount, 1);
  harness.advance(0.5);
  const beatAfterRearm = audio.getBeat();
  harness.pendingCloses[0]();
  await Promise.resolve();
  assert.equal(audio.running, true, "a late close must not silence the new graph");
  assert.ok(audio.getBeat() >= beatAfterRearm && audio.getBeat() > beatBefore);
  await audio.dispose();
  assert.equal(manager.getStatus().connectionCount, 0);
  await assert.rejects(audio.arm(), /disposed/);
});

test("changing either animation while playing keeps the beat and never arms Audio", async () => {
  const harness = fakeAudioRuntime();
  const audio = new OculoidAudio(harness.runtime);
  audio.setPlaying(true);
  harness.advance(1.25);
  const before = audio.getBeat();
  audio.setConfig({ ...OCULOID_DEFAULTS, eyeballStyle: "pupil", eyelidStyle: "still" });
  assert.equal(audio.getBeat(), before, "unarmed motion phase must not restart");
  assert.equal(audio.playing, true);
  assert.equal(harness.contexts.length, 0, "choosing a style must not create Audio");
  harness.advance(0.4);
  assert.ok(audio.getBeat() > before);
  await audio.arm();
  harness.advance(0.7);
  const armedBeat = audio.getBeat();
  audio.setConfig({ ...audio.config, eyeballStyle: "still", eyelidStyle: "lid-flutter" });
  assert.equal(audio.getBeat(), armedBeat, "armed style changes retain the same audio-clock phase");
  assert.equal(audio.playing, true);
  assert.equal(harness.nodes.length, 1);
  const messages = harness.nodes[0].messages.slice(-2);
  assert.equal(messages[0].config.eyeballStyle, "still");
  assert.equal(messages[0].config.eyelidStyle, "lid-flutter");
  assert.equal(messages[1].beat, armedBeat);
  harness.advance(0.3);
  assert.ok(audio.getBeat() > armedBeat);
  await audio.dispose();
});

test("lid speed, eye ensembles and wardrobe follow Audio's own clock without arming it", async () => {
  const harness = fakeAudioRuntime();
  const audio = new OculoidAudio(harness.runtime);
  audio.setEnsemble(4, "harmony");
  audio.setWardrobe({ tongue: true, cigar: true, hat: "top" });
  audio.setLidsVisible(false);
  audio.setPlaying(true);
  harness.advance(1.25);
  const eyeBeat = audio.getBeat(), lidBeat = audio.getLidBeat();
  assert.equal(eyeBeat, lidBeat);
  audio.setConfig({ ...OCULOID_DEFAULTS, lidRate: 1.5 });
  assert.equal(audio.getBeat(), eyeBeat);
  assert.equal(audio.getLidBeat(), lidBeat,
    "turning up the lid rate changes its slope, never its position");
  harness.advance(1);
  assert.ok(Math.abs(audio.getLidBeat() - lidBeat - 2.1) < 1e-9);
  assert.ok(Math.abs(audio.getBeat() - eyeBeat - 1.4) < 1e-9);
  audio.setPlaying(false);
  const held = [audio.getBeat(), audio.getLidBeat()];
  harness.advance(1);
  assert.deepEqual([audio.getBeat(), audio.getLidBeat()], held);
  assert.equal(harness.contexts.length, 0, "wardrobe and ensemble edits do not create Audio");

  await audio.arm();
  const messages = harness.nodes[0].messages;
  assert.ok(messages.some(post => post.type === "transport" && post.beat === held[0]
    && post.lidBeat === held[1]));
  assert.ok(messages.some(post => post.type === "ensemble" && post.count === 4
    && post.style === "harmony"));
  assert.ok(messages.some(post => post.type === "wardrobe"
    && post.wardrobe.tongue && post.wardrobe.cigar && post.wardrobe.hat === "top"));
  assert.ok(messages.some(post => post.type === "lids-visible" && !post.visible));
  audio.setEnsemble(300, "__proto__");
  assert.deepEqual(messages.at(-1), { type: "ensemble", count: 1, style: "banter" });
  audio.setWardrobe({ teeth: true });
  assert.equal(messages.at(-1).wardrobe.teeth, true);
  assert.equal(messages.at(-1).wardrobe.tongue, false);
  audio.setLidsVisible(true);
  assert.deepEqual(messages.at(-1), { type: "lids-visible", visible: true });
  audio.seekBeat(0);
  assert.deepEqual([audio.getBeat(), audio.getLidBeat()], [0, 0]);
  await audio.dispose();
});

test("a pending worklet load cannot re-arm an old context after BFCache parking", async () => {
  const harness = fakeAudioRuntime({ delayedFirstModule: true });
  const audio = new OculoidAudio(harness.runtime);
  const manager = getSharedAudioOutputManager(harness.runtime);
  const obsolete = audio.arm();
  assert.equal(harness.pendingModules.length, 1);
  await audio.close();
  assert.equal(await audio.arm(), true);
  harness.pendingModules[0]();
  assert.equal(await obsolete, false);
  assert.equal(audio.running, true);
  assert.equal(harness.nodes.length, 1);
  assert.equal(manager.getStatus().connectionCount, 1);
  await audio.dispose();
  assert.equal(manager.getStatus().connectionCount, 0);
});
