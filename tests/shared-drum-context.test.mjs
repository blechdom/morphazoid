import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sharedInstrumentContextAmendments, restoreSharedInstrumentContext } from "./helpers/shared-instrument-context-reference.mjs";
import { GraphDrumAudio, graphDrumPercussionVoice, translateGraphDrumStartAt } from "../src/families/graph/graph-drum-audio.js";
import { DEFAULT_FM_DRUM_VOICES } from "../src/instruments/fm-drums/fm-drums.js";
import { LinearDrumAudio } from "../src/instruments/linear-drums/linear-drums.js";
import { getSharedAudioOutputManager } from "../src/audio-output-manager.js";

test("shared context changes reverse to independently hashed prior runtime bytes", async () => {
  for (const change of sharedInstrumentContextAmendments.changes) {
    const current = await readFile(new URL(`../${change.file}`, import.meta.url), "utf8");
    const restored = restoreSharedInstrumentContext(current, change.file);
    assert.equal(createHash("sha256").update(restored).digest("hex"), change.sha256, change.file);
    const first = change.replacements[0];
    assert.throws(() => restoreSharedInstrumentContext(current.replace(first.after, ""), change.file), /exact shared instrument context amendment/);
    assert.throws(() => restoreSharedInstrumentContext(current + first.after, change.file), /exact shared instrument context amendment/);
  }
});

function harness() {
  const contexts = [], sources = [];
  const param = (value = 0) => ({ value,
    setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; },
    cancelScheduledValues() {}, cancelAndHoldAtTime() {},
  });
  const node = (properties = {}) => ({ ...properties, connections: new Set(),
    connect(target) { this.connections.add(target); return target; },
    disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); },
  });
  const source = (properties = {}) => {
    const result = node({ ...properties, starts: [], stops: [],
      start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); },
    });
    sources.push(result);
    return result;
  };
  class AudioContext {
    constructor() {
      contexts.push(this); this.state = "running"; this.currentTime = 3;
      this.sampleRate = 48_000; this.destination = node(); this.closeCalls = 0;
    }
    createGain() { return node({ gain: param(1) }); }
    createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
    createAnalyser() { return node({ fftSize: 256 }); }
    createBiquadFilter() { return node({ frequency: param(), Q: param(), gain: param(), type: "lowpass" }); }
    createStereoPanner() { return node({ pan: param() }); }
    createOscillator() { return source({ frequency: param(440), detune: param(), type: "sine" }); }
    createBufferSource() { return source({ playbackRate: param(1), buffer: null }); }
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { duration: length / sampleRate, sampleRate, getChannelData: channel => data[channel] };
    }
    async resume() { this.state = "running"; }
    async close() { this.closeCalls++; this.state = "closed"; }
  }
  const runtime = { AudioContext, setTimeout: () => 1, clearTimeout: () => {} };
  return { runtime, contexts, sources, manager: getSharedAudioOutputManager(runtime) };
}

test("real FM and physical drum engines keep both final chains on one clock", async () => {
  const { runtime, contexts, sources, manager } = harness();
  const drums = new GraphDrumAudio(runtime);
  const context = await drums.start();
  assert.equal(contexts.length, 1);
  assert.equal(drums.fmAudio.context, context);
  assert.equal(drums.physicalAudio.context, context);
  assert.equal(manager.contexts.size, 1);
  assert.equal(manager.connectionCount(), 2, "both authored final mixes remain captured");
  assert.notEqual(drums.fmAudio.analyser, drums.physicalAudio.analyser);
  assert.ok(drums.fmAudio.analyser.connections.has(context.destination));
  assert.ok(drums.physicalAudio.analyser.connections.has(context.destination));
  drums.setOutput(0.42);
  assert.equal(drums.fmAudio.master.gain.value, 0.42);
  assert.equal(drums.physicalAudio.master.gain.value, 0.42);

  const voice = DEFAULT_FM_DRUM_VOICES[4];
  await drums.trigger(graphDrumPercussionVoice(voice, { style: "drum-bank" }), { startAt: 3.25 });
  const fmSources = sources.length;
  assert.ok(fmSources > 0);
  await drums.trigger(graphDrumPercussionVoice(voice, { style: "rattlesnake-physical" }), { startAt: 3.25 });
  assert.ok(sources.length > fmSources);
  assert.ok(sources.every(source => source.starts.every(at => at === 3.25)), "both synthesis paths retain the requested sample-clock onset");
  await drums.physicalAudio.close();
  assert.equal(context.state, "running", "borrowed physical teardown cannot close FM playback");
  assert.equal(manager.connectionCount(), 1);
  await drums.start();
  assert.equal(contexts.length, 1);
  assert.equal(manager.connectionCount(), 2);
  await drums.close();
  assert.equal(context.closeCalls, 1);
  assert.equal(manager.connectionCount(), 0);
});

test("borrowed Linear Drums never own or replace the instrument context", async () => {
  const { runtime, contexts, manager } = harness();
  const Context = runtime.AudioContext;
  const context = new Context();
  delete runtime.AudioContext;
  const drums = new LinearDrumAudio(runtime);
  await drums.start({ context });
  assert.equal(contexts.length, 1);
  assert.equal(manager.connectionCount(), 1);
  await drums.start();
  await assert.rejects(drums.start({ context: new Context() }), /before changing/);
  await drums.close();
  assert.equal(context.closeCalls, 0);
  assert.equal(context.state, "running");
  assert.equal(manager.connectionCount(), 0);
  context.state = "closed";
  await assert.rejects(drums.start({ context }), /closed/);
});

test("closing a pending borrowed Graph Drum start cannot revive either engine", async () => {
  const { runtime, manager } = harness();
  const context = new runtime.AudioContext();
  context.state = "suspended";
  let finishResume;
  context.resume = async () => {
    await new Promise(resolve => { finishResume = resolve; });
    context.state = "running";
  };
  const drums = new GraphDrumAudio(runtime);
  const starting = drums.start({ context });
  assert.equal(manager.connectionCount(), 1, "FM builds before the physical engine shares its clock");
  const cancelled = assert.rejects(starting, /cancelled/i);
  await drums.close();
  finishResume();
  await cancelled;
  assert.equal(manager.connectionCount(), 0);
  assert.equal(drums.physicalAudio.context, null);
  assert.equal(context.closeCalls, 0, "controller context survives cancelled borrowed startup");
  await drums.start({ context });
  assert.equal(manager.contexts.size, 1);
  assert.equal(manager.connectionCount(), 2);
  await drums.close();
  assert.equal(context.closeCalls, 0);
  assert.equal(manager.connectionCount(), 0);
});

test("same-context scheduling reads its clock once and introduces no translation delay", () => {
  let reads = 0;
  const context = { get currentTime() { return 10 + reads++ / 100; } };
  assert.equal(translateGraphDrumStartAt(10.5, context, context), 10.5);
  assert.equal(reads, 1);
});
