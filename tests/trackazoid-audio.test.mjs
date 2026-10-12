import assert from "node:assert/strict";
import test from "node:test";
import { TrackazoidAudio } from "../src/instruments/trackazoid/audio.js";
import { beatPhase } from "../src/instruments/trackazoid/transport.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`); }
function parameter(value = 0) {
  return {
    value, events: [],
    cancelAndHoldAtTime(time) { this.events.push(["hold", time]); },
    setValueAtTime(value, time) { this.value = value; this.events.push(["set", value, time]); },
    linearRampToValueAtTime(value, time) { this.value = value; this.events.push(["ramp", value, time]); },
  };
}
function node(extra = {}) {
  return {
    connections: [], disconnected: false,
    connect(target, output = 0, input = 0) { this.connections.push({ target, output, input }); return target; },
    disconnect() { this.connections = []; this.disconnected = true; },
    ...extra,
  };
}
function audioBuffer(seconds = 120, marker = 0.25, sampleRate = 48_000) {
  return { duration: seconds, sampleRate, numberOfChannels: 2, getChannelData: () => new Float32Array([marker, marker / 2]) };
}
function stretchNode() {
  return node({
    schedules: [], buffers: [], configureCount: 0,
    async configure() { this.configureCount++; }, async latency() { return 0.08; },
    async dropBuffers() { this.buffers = []; }, async addBuffers(buffers) { this.buffers = buffers; },
    async schedule(command) { this.schedules.push(command); },
    port: { closed: false, close() { this.closed = true; } },
  });
}
function harness(options = {}) {
  let wall = 10; let creates = 0; let releases = 0; const outputCalls = []; const errors = [];
  const sources = []; const stretches = [];
  const context = {
    currentTime: 5, sampleRate: 48_000, state: "suspended", audioWorklet: {},
    listeners: new Map(), addEventListener(type, listener) { this.listeners.set(type, listener); },
    removeEventListener(type) { this.listeners.delete(type); },
    resumeCount: 0, async resume() { this.resumeCount++; this.state = "running"; },
    async suspend() { this.state = "suspended"; }, async close() { this.state = "closed"; },
    createGain: () => node({ gain: parameter(1) }),
    createBiquadFilter: () => node({ frequency: parameter(), gain: parameter(), Q: parameter() }),
    createWaveShaper: () => node(), createChannelMerger: () => node(),
    createBufferSource() {
      const source = node({ playbackRate: parameter(1),
        start(time, offset) { this.startTime = time; this.offset = offset; },
        stop(time) { this.stopTime = time; },
      }); sources.push(source); return source;
    },
  };
  const engine = new TrackazoidAudio({
    defaultKeyLock: false,
    contextFactory: () => { creates++; return context; }, now: () => wall,
    onError: error => errors.push(error),
    outputConnector: (...args) => { outputCalls.push(args); return () => { releases++; }; },
    stretchFactory: async () => { const stretch = stretchNode(); stretches.push(stretch); return stretch; },
    ...options,
  });
  return { engine, context, sources, stretches, errors, outputCalls,
    get creates() { return creates; }, get releases() { return releases; },
    setWall(time) { wall = time; },
  };
}

test("Trackazoid Play stays silent before arm, and Audio joins/preserves transport phase", async () => {
  const h = harness(); const { engine, context } = h;
  await engine.load("a", audioBuffer()); engine.play("a"); h.setWall(20);
  near(engine.snapshot("a").position, 10);
  assert.equal(h.creates, 0); assert.equal(engine.armed, false);
  assert.equal(await engine.setAudio(true), true);
  near(h.sources[0].offset, 10.012); near(engine.snapshot("a").position, 10);
  context.currentTime = 8; h.setWall(23);
  await engine.setAudio(false);
  assert.equal(context.state, "suspended"); assert.equal(engine.snapshot("a").playing, true);
  h.setWall(28); near(engine.snapshot("a").position, 18);
  await engine.setAudio(true); near(h.sources.at(-1).offset, 18.012);
  assert.equal(h.creates, 1); assert.equal(h.releases, 1);
  await engine.dispose(); assert.equal(context.state, "closed");
});

test("Trackazoid cue and split output never feed the recorded stereo master", async () => {
  const h = harness(); const { engine } = h;
  engine.setCue("a", true); engine.setCrossfader(1);
  await engine.setAudio(true);
  const graph = engine.graph; const deck = engine.decks.a.graph;
  assert.equal(deck.fader.gain.value, 0); assert.equal(deck.cueSend.gain.value, 0.7);
  assert.equal(deck.cueSend.connections[0].target, graph.cue);
  assert.equal(graph.cueArm.connections.length, 1);
  assert.equal(graph.cueArm.connections[0].target, graph.monoCue);
  assert.equal(graph.monoCue.connections[0].input, 1);
  assert.equal(graph.monoMaster.connections[0].input, 0);
  assert.equal(graph.stereo.gain.value, 1); assert.equal(graph.split.gain.value, 0);
  engine.setRouting("split");
  assert.equal(graph.stereo.gain.value, 0); assert.equal(graph.split.gain.value, 1);
  assert.equal(h.outputCalls[0][2].stereoSource, graph.masterArm);
  engine.setMaster(0); assert.equal(graph.master.gain.value, 0);
  assert.ok(graph.cue.gain.value > 0, "headphone level is independent of master");
  assert.ok([...graph.masterSafety.curve].every(value => Number.isFinite(value) && Math.abs(value) < 1));
  await engine.dispose();
});

test("Trackazoid schedules key lock with compensated output time and projected loop position", async () => {
  const h = harness(); const { engine, context } = h;
  await engine.load("a", audioBuffer()); await engine.setAudio(true); engine.seek("a", 11.95); engine.setLoop("a", 10, 12); engine.play("a");
  await engine.setKeyLock("a", true);
  const command = h.stretches[0].schedules.at(-1);
  near(command.output, context.currentTime + 0.092);
  near(command.input, 10.03); assert.equal(command.semitones, 0);
  assert.equal(command.loopStart, 10); assert.equal(command.loopEnd, 12);
  engine.setRate("a", 1.1);
  near(h.stretches[0].schedules.at(-1).rate, 1.1);
  assert.equal(h.stretches.length, 1, "live changes reuse the same WASM lane");
  await engine.setKeyLock("a", false);
  assert.equal(h.sources.at(-1).playbackRate.value, 1.1);
  await engine.dispose(); assert.equal(h.stretches[0].port.closed, true);
});

test("Trackazoid key lock can be selected before explicit Audio without creating a context", async () => {
  const h = harness(); await h.engine.load("a", audioBuffer());
  await h.engine.setKeyLock("a", true); h.engine.play("a");
  assert.equal(h.creates, 0); assert.equal(h.stretches.length, 0);
  h.setWall(12); await h.engine.setAudio(true);
  assert.equal(h.stretches.length, 1); assert.equal(h.sources.length, 0);
  near(h.stretches[0].schedules.at(-1).input, 2.092);
  await h.engine.dispose();
});

test("Trackazoid rapid seeks bound native voices and replacement loads stop the old track", async () => {
  const h = harness(); const { engine } = h;
  await engine.load("a", audioBuffer()); await engine.setAudio(true); engine.play("a");
  for (let index = 0; index < 100; index++) engine.seek("a", index);
  assert.ok(h.sources.filter(source => !source.disconnected).length <= 2);
  const newest = audioBuffer(30, 0.8); await engine.load("a", newest);
  assert.equal(engine.snapshot("a").playing, false);
  assert.equal(engine.snapshot("a").position, 0);
  assert.equal(engine.decks.a.buffer, newest);
  engine.play("a"); assert.equal(h.sources.at(-1).buffer, newest);
  await engine.dispose();
});

test("Trackazoid replaces audio during pending key-lock creation without loading stale PCM", async () => {
  const started = deferred(); const node = stretchNode(); let calls = 0;
  const h = harness({ stretchFactory: () => { calls++; return started.promise; } });
  const { engine } = h;
  await engine.load("a", audioBuffer(120, 0.1)); await engine.setAudio(true);
  const keyLock = engine.setKeyLock("a", true); await flush();
  const latest = audioBuffer(120, 0.9); const load = engine.load("a", latest);
  const secondRequest = engine.setKeyLock("a", true);
  started.resolve(node); await Promise.all([keyLock, load, secondRequest]);
  assert.equal(calls, 1); assert.equal(engine.decks.a.stretchBuffer, latest);
  near(node.buffers[0][0], Math.fround(0.9));
  await engine.dispose();
});

test("Trackazoid a late Audio arm cannot undo Audio off", async () => {
  const resumed = deferred(); const h = harness();
  h.context.resume = async () => { await resumed.promise; h.context.state = "running"; };
  const arming = h.engine.setAudio(true);
  const off = h.engine.setAudio(false);
  resumed.resolve(); await Promise.all([arming, off]);
  assert.equal(h.engine.armed, false); assert.equal(h.outputCalls.length, 0);
  assert.equal(h.context.state, "suspended");
  await h.engine.dispose();
});

test("Trackazoid suspends a stale browser resume even after the mute fade completed", async () => {
  const resumed = deferred(); const h = harness();
  h.context.resume = async () => { await resumed.promise; h.context.state = "running"; };
  const arming = h.engine.setAudio(true);
  await h.engine.setAudio(false);
  resumed.resolve(); await arming;
  assert.equal(h.engine.armed, false); assert.equal(h.context.state, "suspended");
  await h.engine.dispose();
});

test("Trackazoid browser interruption disarms Audio while the visual transport continues", async () => {
  const h = harness(); await h.engine.load("a", audioBuffer()); await h.engine.setAudio(true); h.engine.play("a");
  h.context.currentTime = 7; h.setWall(12);
  h.context.state = "interrupted"; h.context.listeners.get("statechange")();
  assert.equal(h.engine.armed, false); assert.equal(h.context.resumeCount, 1);
  assert.equal(h.errors.length, 1); h.setWall(15);
  near(h.engine.snapshot("a").position, 4.988);
  await h.engine.dispose(); assert.equal(h.context.listeners.size, 0);
});

test("Trackazoid disposes a worklet that arrives after teardown", async () => {
  const started = deferred(); const stretch = stretchNode();
  const h = harness({ stretchFactory: () => started.promise });
  await h.engine.setAudio(true); await h.engine.load("a", audioBuffer());
  const pending = h.engine.setKeyLock("a", true); await flush();
  await h.engine.dispose(); started.resolve(stretch); await pending;
  assert.equal(stretch.disconnected, true); assert.equal(stretch.port.closed, true);
  assert.equal(h.context.state, "closed");
});

test("Trackazoid a failed key-lock setup keeps native playback and can be retried", async () => {
  let attempts = 0; const failed = stretchNode(); failed.configure = async () => { throw new Error("WASM unavailable"); };
  const good = stretchNode();
  const h = harness({ stretchFactory: async () => ++attempts === 1 ? failed : good });
  await h.engine.load("a", audioBuffer()); await h.engine.setAudio(true); h.engine.play("a");
  await assert.rejects(h.engine.setKeyLock("a", true), /WASM unavailable/);
  assert.equal(h.engine.snapshot("a").playing, true); assert.equal(h.engine.snapshot("a").keyLock, false);
  assert.equal(failed.port.closed, true); assert.ok(h.engine.decks.a.source);
  await h.engine.setKeyLock("a", true);
  assert.equal(h.engine.decks.a.stretch, good);
  await h.engine.dispose();
});

async function beatmatchingHarness(options = {}) {
  const h = harness(options);
  await h.engine.load("a", audioBuffer(120)); await h.engine.load("b", audioBuffer(120));
  h.engine.setBeatGrid("a", { bpm: 114, beatOffset: 0.1 });
  h.engine.setBeatGrid("b", { bpm: 126, beatOffset: 0.2 });
  return h;
}

test("Trackazoid Sync before Play launches with the master, and tempo follows without polling", async () => {
  const h = await beatmatchingHarness(); const { engine, context } = h;
  engine.setSync("b", true);
  assert.equal(engine.master, null);
  await engine.setAudio(true); engine.play("a");
  context.currentTime = 5.4;
  engine.play("b");
  assert.equal(engine.master, "a"); assert.equal(engine.snapshot("b").sync, true);
  assert.equal(engine.snapshot("b").pending, true);
  const launch = h.sources.at(-1).startTime;
  assert.ok(launch > 5.4);
  context.currentTime = launch + 1;
  near(engine.snapshot("b").phaseError, 0);
  near(engine.snapshot("b").effectiveBpm, engine.snapshot("a").effectiveBpm);
  const initialB = h.sources.at(-1);
  context.currentTime += 30;
  near(engine.snapshot("b").phaseError, 0);
  assert.equal(h.sources.at(-1), initialB, "no rendering-frame correction or restart");
  engine.setBeatGrid("b", { bpm: 126, beatOffset: 0.2 });
  assert.equal(h.sources.at(-1), initialB, "re-saving the same grid cannot restart the follower");
  engine.setRate("a", 1.03);
  near(engine.snapshot("b").effectiveBpm, 114 * 1.03);
  const voices = [engine.decks.a.source, engine.decks.b.source];
  near(voices[0].startTime, voices[1].startTime);
  context.currentTime += 1;
  near(engine.snapshot("b").phaseError, 0);
  engine.pause("a"); assert.equal(engine.master, "b");
  engine.play("a"); assert.equal(engine.master, "b", "returning old master cannot steal ownership");
  engine.setSync("b", false); assert.equal(engine.master, "b");
  await engine.dispose();
});

test("Trackazoid manual follower edits override Sync while pause/relaunch preserves it", async () => {
  const h = await beatmatchingHarness(); const { engine, context } = h;
  await engine.setAudio(true); engine.play("a"); engine.setSync("b", true); engine.play("b");
  context.currentTime = 7;
  engine.pause("b"); assert.equal(engine.snapshot("b").sync, true);
  context.currentTime = 7.2; engine.play("b"); context.currentTime = 8.2;
  near(engine.snapshot("b").phaseError, 0);
  engine.seek("b", 20); assert.equal(engine.snapshot("b").sync, false);
  engine.setSync("b", true); context.currentTime = 9;
  engine.setRate("b", 1); assert.equal(engine.snapshot("b").sync, false);
  assert.equal(engine.master, "a");
  await engine.dispose();
});

test("Trackazoid rejects unknown/out-of-range Sync and preserves explicitly selected master", async () => {
  const h = harness(); const { engine } = h;
  await engine.load("a", audioBuffer());
  assert.throws(() => engine.setSync("a", true), /source BPM/);
  engine.setBeatGrid("a", { bpm: 120 }); engine.play("a");
  await engine.load("b", audioBuffer()); engine.setBeatGrid("b", { bpm: 60 });
  assert.throws(() => engine.setSync("b", true), /±16%/);
  assert.equal(engine.snapshot("b").sync, false);
  engine.setBeatGrid("b", { bpm: 110 }); engine.setSync("b", true); engine.play("b");
  engine.setRate("a", 1.16);
  assert.equal(engine.snapshot("b").sync, false);
  assert.match(engine.snapshot("b").syncError, /±16%/);
  assert.equal(engine.master, "a");
  await engine.dispose();
});

test("Trackazoid sync survives audio clock changes and hands off when a finite master ends", async () => {
  const h = await beatmatchingHarness(); const { engine, context } = h;
  engine.play("a"); engine.setSync("b", true); engine.play("b"); h.setWall(12);
  near(engine.snapshot("b").phaseError, 0);
  await engine.setAudio(true); context.currentTime = 7; h.setWall(14);
  near(engine.snapshot("b").phaseError, 0);
  await engine.setAudio(false); h.setWall(20);
  near(engine.snapshot("b").phaseError, 0);
  await engine.setAudio(true); context.currentTime += 110;
  assert.equal(engine.master, "b");
  await engine.dispose();
});

test("Trackazoid key lock defaults on and gracefully falls back when it cannot initialize", async () => {
  const h = await beatmatchingHarness({ defaultKeyLock: true, stretchFactory: async () => { throw new Error("WASM unavailable"); } });
  assert.equal(h.engine.snapshot("a").keyLock, true);
  h.engine.play("a");
  assert.equal(await h.engine.setAudio(true), true);
  assert.equal(h.engine.snapshot("a").keyLock, false);
  assert.equal(h.engine.snapshot("a").playing, true);
  assert.equal(h.errors.length, 2);
  await h.engine.dispose();
});

test("Trackazoid mixed key-lock/native followers share the exact future edit boundary", async () => {
  const h = await beatmatchingHarness({ defaultKeyLock: true }); const { engine, context } = h;
  await engine.setAudio(true); await engine.setKeyLock("b", false);
  engine.play("a"); context.currentTime = 6; engine.setSync("b", true); engine.play("b");
  context.currentTime = 8; engine.setRate("a", 1.04);
  const command = engine.decks.a.stretch.schedules.at(-1);
  near(command.output, engine.decks.b.source.startTime);
  near(command.output, 8.092);
  context.currentTime = 9; near(engine.snapshot("b").phaseError, 0);
  await engine.dispose();
});

test("Trackazoid a master edit before a queued follower launch keeps that launch on a beat", async () => {
  const h = await beatmatchingHarness(); const { engine, context } = h;
  engine.setBeatGrid("a", { bpm: 120 }); engine.setBeatGrid("b", { bpm: 120 });
  await engine.setAudio(true); engine.play("a"); context.currentTime = 5.2;
  engine.setSync("b", true); engine.play("b");
  near(engine.decks.b.source.startTime, 5.512);
  context.currentTime = 5.25; engine.setRate("a", 1.02);
  const launch = engine.decks.b.source.startTime;
  const phase = beatPhase(engine.decks.a.transport.snapshot(launch).position, engine.decks.a.grid);
  assert.ok(Math.min(phase, 1 - phase) < 1e-8, `queued launch must remain on beat, got ${phase}`);
  assert.ok(launch > 5.49 && launch < 5.52);
  context.currentTime = launch + 1; near(engine.snapshot("b").phaseError, 0);
  await engine.dispose();
});

test("Trackazoid grid corrections persist as overrides and free loops release beat Sync", async () => {
  const h = await beatmatchingHarness(); const { engine } = h;
  engine.play("a"); engine.setSync("b", true); engine.play("b"); h.setWall(11);
  engine.setLoop("a", 0.1, 0.1 + 4 * 60 / 114);
  assert.equal(engine.snapshot("b").sync, true);
  h.setWall(14); near(engine.snapshot("b").phaseError, 0);
  engine.setLoop("b", 0.2, 0.2 + 4 * 60 / 126);
  near(engine.snapshot("b").phaseError, 0, "jumping into an earlier follower loop preserves beat phase");
  engine.clearLoop("b");
  engine.setLoop("a", 0.1, 1.1);
  assert.equal(engine.snapshot("b").sync, false);
  engine.clearLoop("a"); engine.setSync("b", true);
  assert.doesNotThrow(() => engine.setBeatGrid("b", { bpm: 63, beatOffset: 0.2 }));
  assert.equal(engine.snapshot("b").bpm, 63); assert.equal(engine.snapshot("b").sync, false);
  await engine.dispose();
});

test("Trackazoid Quantize defaults on, survives loads, and stopped cue recalls never arm Audio", async () => {
  const h = harness(), { engine } = h;
  assert.equal(engine.snapshot("a").quantize, true);
  await engine.load("a", audioBuffer(30)); engine.triggerCue("a", 3.137);
  near(engine.snapshot("a").position, 3.137); assert.equal(engine.snapshot("a").playing, false);
  assert.equal(h.creates, 0); assert.throws(() => engine.beatJump("a", 1), /BPM/);
  engine.setBeatGrid("a", { bpm: 120 }); engine.triggerCue("a", 4.137);
  near(engine.snapshot("a").position, 4.137, "stopped Quantize recall uses the exact saved point");
  engine.setQuantize("a", false); await engine.load("a", audioBuffer(60));
  assert.equal(engine.snapshot("a").quantize, false); assert.equal(engine.snapshot("b").quantize, true);
  await engine.dispose();
});

for (const keyLock of [false, true]) test(`Trackazoid Quantize preserves active cue phase immediately through ${keyLock ? "key lock" : "native audio"}`, async () => {
  const h = harness({ defaultKeyLock: keyLock }), { engine, context } = h;
  await engine.load("a", audioBuffer()); engine.setBeatGrid("a", { bpm: 120, beatOffset: 0.125 });
  await engine.setAudio(true); engine.play("a"); context.currentTime = 7.231;
  const before = engine.snapshot("a").position, when = context.currentTime + (keyLock ? 0.092 : 0.012);
  const reference = engine.decks.a.transport.snapshot(when).position;
  engine.triggerCue("a", 20);
  near(engine.snapshot("a").position, before); assert.equal(engine.snapshot("a").pending, true);
  const command = keyLock ? engine.decks.a.stretch.schedules.at(-1) : { output: engine.decks.a.source.startTime, input: engine.decks.a.source.node.offset };
  near(command.output, when); near(beatPhase(command.input, engine.decks.a.grid), beatPhase(reference, engine.decks.a.grid));
  assert.ok(Math.abs(command.input - 20) < 0.5);
  context.currentTime = when + 0.1; assert.equal(engine.snapshot("a").playing, true);
  engine.setQuantize("a", false); engine.triggerCue("a", 31.123);
  near(engine.decks.a.transport.pending.position, 31.123);
  await engine.dispose();
});

test("Trackazoid Quantize cue and loop recalls retain mixed-mode Sync through a pending master tempo edit", async () => {
  const h = await beatmatchingHarness({ defaultKeyLock: true }), { engine, context } = h;
  await engine.setAudio(true); await engine.setKeyLock("b", false);
  engine.play("a"); context.currentTime = 6; engine.setSync("b", true); engine.play("b"); context.currentTime = 9;
  engine.triggerCue("b", 20);
  assert.equal(engine.snapshot("b").sync, true); context.currentTime = 9.02; engine.setRate("a", 1.03);
  near(engine.decks.a.stretch.schedules.at(-1).output, engine.decks.b.source.startTime);
  context.currentTime = 10; near(engine.snapshot("b").phaseError, 0);
  engine.setQuantize("b", false); engine.beatJump("b", 4);
  assert.equal(engine.snapshot("b").sync, true); context.currentTime = 11; near(engine.snapshot("b").phaseError, 0);
  engine.triggerCue("b", 17.137); assert.equal(engine.snapshot("b").sync, false);
  engine.setSync("b", true); context.currentTime = 12;
  engine.triggerLoop("b", { start: 30, end: 30 + 4 * 60 / 126 });
  assert.equal(engine.snapshot("b").sync, false, "Quantize off recalls are manual");
  engine.setQuantize("b", true); engine.setSync("b", true); context.currentTime = 13;
  engine.triggerLoop("b", { start: 40, end: 40 + 4 * 60 / 126 }); context.currentTime = 14;
  assert.equal(engine.snapshot("b").sync, true); near(engine.snapshot("b").phaseError, 0);
  engine.triggerLoop("b", { start: 40, end: 40.1 });
  assert.equal(engine.snapshot("b").sync, false, "a sub-beat loop cannot retain full-beat Sync");
  await engine.dispose();
});

for (const keyLock of [false, true]) test(`Trackazoid rapid opposing beat jumps compose once and stay bounded with ${keyLock ? "key lock" : "native audio"}`, async () => {
  const h = harness({ defaultKeyLock: keyLock }), { engine, context } = h;
  await engine.load("a", audioBuffer()); engine.setBeatGrid("a", { bpm: 120 });
  engine.seek("a", 30); await engine.setAudio(true); engine.play("a"); context.currentTime = 6;
  const initial = engine.snapshot("a").position, reference = engine.decks.a.transport.snapshot(6 + engine._lead()).position;
  for (let count = 0; count < 100; count++) { engine.beatJump("a", 1); engine.beatJump("a", -1); }
  near(engine.decks.a.transport.pending.position, reference);
  near(engine.snapshot("a").position, initial);
  engine.beatJump("a", 8); engine.beatJump("a", 4);
  near(engine.decks.a.transport.pending.position, reference + 6);
  context.currentTime += 0.003; engine.setRate("a", 1.1);
  const pending = engine.decks.a.transport.pending;
  near(pending.position, reference + 6.003);
  context.currentTime = pending.time + 1; near(engine.snapshot("a").position, pending.position + 1.1);
  assert.equal(engine.snapshot("a").playing, true);
  assert.ok(h.sources.filter(source => !source.disconnected).length <= 2);
  assert.equal(h.stretches.length, keyLock ? 1 : 0);
  await engine.dispose();
});

test("Trackazoid beat actions reject out-of-track targets transactionally and manual seeks still release Sync", async () => {
  const h = await beatmatchingHarness(), { engine } = h;
  engine.play("a"); engine.setSync("b", true); engine.play("b");
  const before = engine.snapshot("b");
  assert.throws(() => engine.beatJump("b", -32), /leave the track/);
  assert.deepEqual(engine.snapshot("b"), before);
  for (const value of [0, 0.25, 33, Infinity]) assert.throws(() => engine.beatJump("b", value), /whole-beat jump/);
  assert.throws(() => engine.triggerCue("b", 121), /outside the track/);
  assert.throws(() => engine.triggerLoop("b", { start: 119, end: 121 }), /within the track/);
  assert.throws(() => engine.moveLoop("b", 1), /Activate a loop/);
  assert.deepEqual(engine.snapshot("b"), before);
  engine.seek("b", 10); assert.equal(engine.snapshot("b").sync, false);
  await engine.dispose();
});

test("Trackazoid loop moves shift range and inside playhead together; resize preserves playing and valid Sync", async () => {
  const h = harness(), { engine } = h;
  await engine.load("a", audioBuffer()); engine.setBeatGrid("a", { bpm: 120 });
  engine.triggerLoop("a", { start: 10, end: 12 }); engine.seek("a", 11.23); engine.play("a"); engine.setSync("a", true);
  engine.moveLoop("a", 4); near(engine.snapshot("a").position, 13.23);
  assert.deepEqual(engine.snapshot("a").loop, { start: 12, end: 14 });
  engine.resizeLoop("a", 0.5); near(engine.snapshot("a").position, 12.23);
  assert.deepEqual(engine.snapshot("a").loop, { start: 12, end: 13 }); assert.equal(engine.snapshot("a").sync, true);
  engine.resizeLoop("a", 2); assert.deepEqual(engine.snapshot("a").loop, { start: 12, end: 14 });
  assert.equal(engine.snapshot("a").playing, true);
  for (let count = 0; count < 3; count++) engine.resizeLoop("a", 0.5);
  assert.equal(engine.snapshot("a").sync, false); assert.equal(engine.snapshot("a").playing, true);
  engine.resizeLoop("a", 0.5); engine.resizeLoop("a", 0.5);
  const before = engine.snapshot("a"); assert.throws(() => engine.resizeLoop("a", 0.5), /⅛ and 32/);
  assert.deepEqual(engine.snapshot("a"), before);
  engine.clearLoop("a"); engine.pause("a"); engine.seek("a", 1); engine.setLoop("a", 10, 12);
  engine.moveLoop("a", 4); near(engine.snapshot("a").position, 1, "lead-in before a moved loop is preserved");
  assert.equal(engine.snapshot("a").playing, false);
  await engine.dispose();
});

test("Trackazoid pending cue and beat actions retain a prepared beat-quantized Sync launch", async () => {
  const h = await beatmatchingHarness(), { engine, context } = h;
  engine.setBeatGrid("a", { bpm: 120 }); engine.setBeatGrid("b", { bpm: 120 });
  await engine.setAudio(true); engine.play("a"); context.currentTime = 5.2;
  engine.setSync("b", true); engine.play("b"); const launch = engine.decks.b.source.startTime;
  engine.triggerCue("b", 20); engine.beatJump("b", 4);
  near(engine.decks.b.source.startTime, launch); near(engine.decks.b.source.node.offset, 22);
  context.currentTime = 5.25; engine.setRate("a", 1.02);
  const updated = engine.decks.b.source.startTime;
  const masterPhase = beatPhase(engine.decks.a.transport.snapshot(updated).position, engine.decks.a.grid);
  assert.ok(Math.min(masterPhase, 1 - masterPhase) < 1e-8);
  context.currentTime = updated + 1; near(engine.snapshot("b").phaseError, 0);
  assert.equal(engine.snapshot("b").sync, true);
  await engine.dispose();
});

test("Trackazoid a pending tempo edit followed by a jump uses the audible predecessor until the replacement boundary", async () => {
  const h = harness({ defaultKeyLock: true }), { engine, context } = h;
  await engine.load("a", audioBuffer()); engine.setBeatGrid("a", { bpm: 120 });
  await engine.setAudio(true); engine.play("a"); context.currentTime = 7;
  engine.setRate("a", 1.1); context.currentTime = 7.02;
  engine.beatJump("a", 8);
  near(engine.decks.a.stretch.schedules.at(-1).output, 7.112);
  near(engine.decks.a.stretch.schedules.at(-1).input, 6.02);
  context.currentTime = 7.05; near(engine.snapshot("a").position, 1.958);
  await engine.dispose();
});

test("Trackazoid Quantize replaces an unheard manual seek using the still-audible beat phase", async () => {
  const h = harness({ defaultKeyLock: true }), { engine, context } = h;
  await engine.load("a", audioBuffer()); engine.setBeatGrid("a", { bpm: 120 });
  await engine.setAudio(true); engine.play("a"); context.currentTime = 7.231;
  const when = 7.323, phase = beatPhase(engine.decks.a.transport.snapshot(when).position, engine.decks.a.grid);
  engine.seek("a", 17.137); engine.triggerCue("a", 30);
  near(beatPhase(engine.decks.a.transport.pending.position, engine.decks.a.grid), phase);
  engine.seek("a", 19.137); engine.triggerLoop("a", { start: 40, end: 42 });
  near(beatPhase(engine.decks.a.transport.pending.position, engine.decks.a.grid), phase);
  near(engine.decks.a.stretch.schedules.at(-1).output, when);
  await engine.dispose();
});

test("Trackazoid enabling key lock re-times both a pending jump and its audible source", async () => {
  const h = harness(), { engine, context } = h;
  await engine.load("a", audioBuffer()); engine.setBeatGrid("a", { bpm: 120 });
  await engine.setAudio(true); engine.play("a"); context.currentTime = 7;
  engine.beatJump("a", 8); near(engine.decks.a.transport.pending.time, 7.012);
  await engine.setKeyLock("a", true);
  near(engine.decks.a.transport.pending.time, 7.092);
  near(engine.decks.a.stretch.schedules.at(-1).output, 7.092);
  near(engine.decks.a.stretch.schedules.at(-1).input, 6.08);
  context.currentTime = 7.03; near(engine.snapshot("a").position, 2.018);
  context.currentTime = 7.192; near(engine.snapshot("a").position, 6.18);
  await engine.dispose();
});

test("Trackazoid pause, replacement and disposal cancel pending beat actions without arming or stale playback", async () => {
  const h = harness({ defaultKeyLock: true }), { engine, context } = h;
  await engine.load("a", audioBuffer()); engine.setBeatGrid("a", { bpm: 120 });
  await engine.setAudio(true); engine.play("a"); context.currentTime = 7;
  const audible = engine.snapshot("a").position; engine.beatJump("a", 8); engine.pause("a");
  context.currentTime = 8; near(engine.snapshot("a").position, audible);
  assert.equal(engine.snapshot("a").playing, false); assert.equal(engine.decks.a.transport.pendingPositionOffset, null);
  engine.play("a"); context.currentTime = 9; engine.beatJump("a", 8);
  await engine.load("a", audioBuffer(30)); context.currentTime = 10;
  assert.equal(engine.snapshot("a").position, 0); assert.equal(engine.snapshot("a").playing, false);
  assert.equal(engine.decks.a.transport.pending, null);
  await engine.dispose(); const count = h.stretches[0].schedules.length;
  assert.doesNotThrow(() => engine.beatJump("a", 4)); assert.equal(h.stretches[0].schedules.length, count);
});

test("Trackazoid phase-preserving actions survive Audio off/on and leave both Sync clocks continuous", async () => {
  const h = await beatmatchingHarness({ defaultKeyLock: true }), { engine, context } = h;
  await engine.setAudio(true); engine.play("a"); context.currentTime = 6; engine.setSync("b", true); engine.play("b");
  context.currentTime = 9; h.setWall(14); engine.triggerCue("b", 20);
  await engine.setAudio(false); h.setWall(15);
  near(engine.snapshot("b").phaseError, 0); assert.equal(engine.snapshot("b").playing, true);
  engine.beatJump("b", 8); near(engine.snapshot("b").phaseError, 0); assert.equal(engine.armed, false);
  await engine.setAudio(true); context.currentTime += 1;
  near(engine.snapshot("b").phaseError, 0); assert.equal(engine.snapshot("b").sync, true);
  assert.equal(h.creates, 1); await engine.dispose();
});
