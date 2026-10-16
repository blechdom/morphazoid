import assert from "node:assert/strict";
import test from "node:test";
import { WobbliniAudio } from "../src/instruments/wobblini/wobblini-audio.js";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);
const parameter = (value = 0) => ({ value, events: [],
  cancelAndHoldAtTime(time) { this.events.push(["hold", time]); },
  setValueAtTime(value, time) { this.value = value; this.events.push(["set", value, time]); },
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(["ramp", value, time]); },
});
const node = (extra = {}) => ({ connections: [], disconnected: false,
  connect(target, output = 0) { this.connections.push({ target, output }); return target; },
  disconnect() { this.connections = []; this.disconnected = true; }, ...extra,
});
function buffer(seconds = 8, sampleRate = 8000, channels = 2) {
  const data = Array.from({ length: channels }, () => new Float32Array(seconds * sampleRate).fill(0.2));
  return { duration: seconds, length: data[0].length, sampleRate, numberOfChannels: channels, getChannelData: channel => data[channel] };
}
const file = (name = "Local beat.wav") => ({ name, size: 100, arrayBuffer: async () => new ArrayBuffer(100) });
function harness(options = {}) {
  let wall = 100, creates = 0, decodes = 0, releases = 0; const sources = [], nodes = [], errors = [], outputs = [];
  const add = extra => { const item = node(extra); nodes.push(item); return item; };
  const context = { currentTime: 5, sampleRate: 48000, state: "suspended", resumeCount: 0,
    addEventListener(type, fn) { this.listener = fn; }, removeEventListener() { this.listener = null; },
    async resume() { this.resumeCount++; this.state = "running"; },
    async suspend() { this.state = "suspended"; }, async close() { this.state = "closed"; },
    createGain: () => add({ gain: parameter(1) }),
    createBiquadFilter: () => add({ frequency: parameter(), gain: parameter(), detune: parameter(), Q: parameter() }),
    createWaveShaper: () => add(), createChannelSplitter: () => add(),
    createStereoPanner: () => add({ pan: parameter() }),
    createAnalyser: () => add({ getFloatTimeDomainData(array) { array.fill(0.2); } }),
    createOscillator: () => add({ frequency: parameter(440), start() { this.started = true; }, stop() { this.stopped = true; } }),
    createBuffer: (channels, length, sampleRate) => buffer(length / sampleRate, sampleRate, channels),
    createBufferSource() {
      const source = add({ playbackRate: parameter(1), start(time, offset) { this.startTime = time; this.offset = offset; },
        stop(time) { this.stopTime = time; } }); sources.push(source); return source;
    },
  };
  const engine = new WobbliniAudio({ contextFactory: () => { creates++; return context; },
    decodeContextFactory: () => { decodes++; return { decodeAudioData: async () => buffer() }; },
    scratchFactory: async () => add({ port: { messages: [], closed: false,
      postMessage(message) { this.messages.push(message); }, close() { this.closed = true; } } }),
    metadataReader: async () => 8,
    outputConnector: (...args) => { outputs.push(args); return () => releases++; },
    now: () => wall, onError: error => errors.push(error), ...options });
  return { engine, context, sources, nodes, errors, outputs, setWall(value) { wall = value; },
    get creates() { return creates; }, get decodes() { return decodes; }, get releases() { return releases; } };
}

test("Wobblini Play never creates audio; explicit arm joins all eight silent deck clocks", async () => {
  const h = harness(), { engine, context } = h;
  assert.equal(engine.getState().decks.length, 8);
  for (let i = 0; i < 8; i++) engine.play(i);
  h.setWall(102); near(engine.getDeckState(0).position, 2);
  assert.equal(h.creates, 0); assert.equal(engine.armed, false);
  assert.equal(await engine.arm(), true); assert.equal(h.sources.length, 8);
  for (const source of h.sources) { near(source.offset, 2); assert.equal(source.loop, true); }
  context.currentTime = 7; h.setWall(104); near(engine.getDeckState(0).position, 4);
  await engine.setAudioEnabled(false); assert.equal(context.state, "suspended");
  h.setWall(107); near(engine.getDeckState(0).position, 7); assert.equal(engine.getDeckState(0).playing, true);
  await engine.arm(); near(h.sources.at(-1).offset, 7); assert.equal(h.creates, 1);
  await engine.dispose(); assert.equal(context.state, "closed");
});

test("Wobblini pause, cue, seek, tempo and loops preserve source/audio-clock agreement", async () => {
  const h = harness(), { engine, context } = h;
  await engine.arm(); engine.play(0); context.currentTime = 6;
  engine.setDeck(0, { rate: 2 }); near(engine.getDeckState(0).position, 1);
  context.currentTime = 7; near(engine.getDeckState(0).position, 3);
  assert.equal(h.sources[0].playbackRate.value, 2);
  engine.setCue(0); engine.setLoop(0, 2); context.currentTime = 9.5;
  near(engine.getDeckState(0).position, 3); engine.pause(0);
  context.currentTime = 13; near(engine.getDeckState(0).position, 3);
  engine.seek(0, 6); assert.equal(engine.getDeckState(0).loopEnabled, false);
  engine.play(0); context.currentTime = 14.5;
  assert.equal(engine.getDeckState(0).playing, false); near(engine.getDeckState(0).position, 8);
  engine.cue(0); near(engine.getDeckState(0).position, 3); assert.equal(engine.getDeckState(0).playing, false);
  await engine.dispose();
});

test("Wobblini pan, EQ, filter, solo, mute and A/THRU/B route real node gains", async () => {
  const h = harness(), { engine } = h; await engine.arm();
  engine.setMaster({ crossfader: -1 });
  near(engine.decks[0].graph.gain.gain.value, 0.7); assert.equal(engine.decks[7].graph.gain.gain.value, 0);
  engine.setDeck(7, { assignment: "THRU", gain: 0.4, pan: -1, eq: { low: -24, high: 12 }, filter: -1 });
  const graph = engine.decks[7].graph;
  near(graph.gain.gain.value, 0.4); assert.equal(graph.pan.pan.value, -1);
  assert.equal(graph.low.gain.value, -24); assert.equal(graph.high.gain.value, 12); near(graph.lowpass.frequency.value, 180);
  engine.setDeck(7, { solo: true }); assert.equal(engine.decks[0].graph.gain.gain.value, 0);
  engine.setDeck(7, { mute: true }); assert.equal(graph.gain.gain.value, 0);
  engine.setDeck(7, { solo: false }); near(engine.decks[0].graph.gain.gain.value, 0.7);
  engine.setMaster({ gain: 0 }); assert.equal(engine.graph.master.gain.value, 0);
  assert.equal(h.outputs[0][1], engine.graph.output);
  assert.ok([...engine.graph.safety.curve].every(value => Number.isFinite(value) && Math.abs(value) < 1));
  await engine.dispose();
});

test("Wobblini wobble is a shared audio oscillator connected to every deck filter", async () => {
  const { engine } = harness(); await engine.arm();
  engine.setMaster({ wobbleAmount: 1, wobbleRate: 8 });
  assert.equal(engine.graph.lfo.frequency.value, 8); assert.equal(engine.graph.lfo.connections.length, 8);
  for (const deck of engine.decks) {
    assert.equal(deck.graph.wobbleDepth.gain.value, 2400);
    assert.ok(deck.graph.wobble.frequency.value < 1300);
    assert.equal(deck.graph.wobbleDepth.connections[0].target, deck.graph.wobble.detune);
  }
  const lfo = engine.graph.lfo; await engine.dispose(); assert.equal(lfo.stopped, true);
});

test("Wobblini Play all launches once on a common boundary before notifying observers", async () => {
  let changes = 0;
  const h = harness({ onChange: () => changes++ }), { engine, context } = h;
  await engine.arm(); changes = 0; engine.playAll();
  assert.equal(changes, 1); assert.equal(h.sources.length, 8);
  assert.equal(new Set(h.sources.map(source => source.startTime)).size, 1);
  near(h.sources[0].startTime, context.currentTime + 0.016);
  engine.setDeck(0, { gain: 0.3 });
  engine.setLoop(1, 8);
  context.currentTime += 1.016;
  for (let id = 0; id < 8; id++) near(engine.getDeckState(id).position, 1);
  changes = 0; engine.pauseAll(); assert.equal(changes, 1);
  assert.ok(engine.getState().decks.every(deck => !deck.playing)); await engine.dispose();
});

test("Wobblini visual wobble phase tracks native rate ramps and unrelated edits preserve phase", async () => {
  const h = harness(), { engine, context } = h;
  await engine.arm(); near(engine.getWobbleState().phase, 0);
  context.currentTime += 0.125; near(engine.getWobbleState().phase, 0.25);
  engine.setMaster({ wobbleRate: 6 }); context.currentTime += 0.004;
  near(engine.getWobbleState().phase, 0.262); near(engine.getWobbleState().frequency, 4);
  engine.setMaster({ gain: 0.5, wobbleAmount: 0.8 }); context.currentTime += 0.004;
  near(engine.getWobbleState().phase, 0.282); near(engine.getWobbleState().frequency, 6);
  const phase = engine.getWobbleState().phase; await engine.setAudioEnabled(false); h.setWall(9999);
  near(engine.getWobbleState().phase, phase); await engine.dispose();
});

test("Wobblini local files decode with Audio off and failed replacements preserve playback", async () => {
  const h = harness(), { engine } = h;
  await engine.loadFile(2, file());
  assert.equal(h.creates, 0); assert.equal(h.decodes, 1); assert.equal(engine.armed, false);
  assert.equal(engine.getDeckState(2).kind, "file"); assert.equal(engine.getDeckState(2).loopEnabled, false);
  engine.play(2); h.setWall(102);
  await assert.rejects(engine.loadFile(2, { ...file(), size: 65 * 1024 * 1024 }), /64 MB/);
  near(engine.getDeckState(2).position, 2); assert.equal(engine.getDeckState(2).name, "Local beat.wav");
  engine.loadDemo(2); assert.equal(engine.getDeckState(2).kind, "demo"); assert.equal(engine.getDeckState(2).playing, true);
  await engine.dispose();
});

test("Wobblini stale file reads and late decodes cannot overwrite a newer source or disposal", async () => {
  const first = deferred(), h = harness(), { engine } = h;
  const pending = engine.loadFile(0, { ...file("Old.wav"), arrayBuffer: () => first.promise });
  engine.loadDemo(0); first.resolve(new ArrayBuffer(100)); assert.equal(await pending, false);
  assert.equal(engine.getDeckState(0).kind, "demo"); assert.equal(engine.getDeckState(0).loading, false);
  const decoding = deferred(); engine.decodeContextFactory = () => ({ decodeAudioData: () => decoding.promise });
  const next = engine.loadFile(0, file()); await new Promise(resolve => setImmediate(resolve));
  await engine.dispose(); decoding.resolve(buffer()); assert.equal(await next, false);
  assert.equal(h.creates, 0);
});

test("Wobblini serializes decoding and skips superseded queued files", async () => {
  const pending = deferred(); let calls = 0, staleReads = 0;
  const h = harness({ decodeContextFactory: () => ({ decodeAudioData: async () => {
    calls++; return calls === 1 ? pending.promise : buffer();
  } }) });
  const first = h.engine.loadFile(0, file("First.wav"));
  await new Promise(resolve => setImmediate(resolve));
  const stale = h.engine.loadFile(1, { ...file("Stale.wav"), arrayBuffer: async () => { staleReads++; return new ArrayBuffer(100); } });
  const latest = h.engine.loadFile(1, file("Latest.wav"));
  assert.equal(calls, 1); pending.resolve(buffer());
  assert.deepEqual(await Promise.all([first, stale, latest]), [true, false, true]);
  assert.equal(calls, 2); assert.equal(staleReads, 0);
  assert.equal(h.engine.getDeckState(1).name, "Latest.wav"); await h.engine.dispose();
});

test("Wobblini rejects oversized decoded audio and sanitizes malformed floating samples", async () => {
  const h = harness();
  h.engine.decodeContextFactory = () => ({ decodeAudioData: async () => ({ ...buffer(), length: 20 * 1024 * 1024 }) });
  await assert.rejects(h.engine.loadFile(0, file()), /decoded/);
  assert.equal(h.engine.getDeckState(0).kind, "demo"); assert.equal(h.engine.getDeckState(0).loading, false);
  const malformed = buffer(); malformed.getChannelData(0)[0] = NaN; malformed.getChannelData(1)[1] = Infinity;
  h.engine.decodeContextFactory = () => ({ decodeAudioData: async () => malformed });
  await h.engine.loadFile(0, file());
  assert.equal(malformed.getChannelData(0)[0], 0); assert.equal(malformed.getChannelData(1)[1], 0);
  await h.engine.dispose();
});

test("Wobblini a rejected newer import clears loading state from an older pending read", async () => {
  const pending = deferred(), { engine } = harness();
  const first = engine.loadFile(0, { ...file(), arrayBuffer: () => pending.promise });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(engine.loadFile(0, { ...file(), size: 0 }), /64 MB/);
  pending.resolve(new ArrayBuffer(100)); assert.equal(await first, false);
  assert.equal(engine.getDeckState(0).loading, false); await engine.dispose();
});

test("Wobblini Audio-off cancels a pending resume and cannot reconnect output later", async () => {
  const h = harness(), waiting = deferred();
  h.context.resume = async () => { await waiting.promise; h.context.state = "running"; };
  const pending = h.engine.arm(); await h.engine.setAudioEnabled(false);
  waiting.resolve(); assert.equal(await pending, false);
  assert.equal(h.engine.armed, false); assert.equal(h.outputs.length, 0); assert.equal(h.context.state, "suspended");
  await h.engine.dispose();
});

test("Wobblini interrupted audio releases output; silent transports remain available", async () => {
  const h = harness(), { engine, context } = h; await engine.arm(); engine.play(0);
  context.currentTime = 6; h.setWall(101); context.state = "suspended"; context.listener();
  assert.equal(engine.armed, false); assert.equal(h.releases, 1); assert.equal(h.errors.length, 1);
  h.setWall(103); near(engine.getDeckState(0).position, 3);
  assert.deepEqual(engine.getMeter(), { left: 0, right: 0, peak: 0 });
  await engine.dispose();
});

test("Wobblini rapid seeks keep at most two retiring sources per deck and dispose disconnects all", async () => {
  const h = harness(), { engine } = h; await engine.arm(); engine.play(0);
  for (let index = 0; index < 50; index++) engine.seek(0, index / 10);
  assert.ok(engine.decks[0].retiring.size <= 2);
  assert.ok(h.sources.filter(source => !source.disconnected).length <= 3);
  await engine.dispose(); await engine.dispose();
  assert.ok(h.sources.every(source => source.disconnected)); assert.equal(h.context.listener, null);
  assert.equal(engine.play(0), false); assert.equal(await engine.arm(), false);
});

test("Wobblini silent scratch never creates audio and preserves paused/playing transport intent", async () => {
  const h = harness(), { engine } = h;
  assert.equal(engine.beginScratch(0), true); assert.equal(engine.beginScratch(0), false);
  engine.scratchTo(0, -0.25); near(engine.getDeckState(0).position, 7.75);
  assert.equal(engine.getDeckState(0).scratching, true); assert.equal(engine.getDeckState(0).playing, false);
  h.setWall(102); near(engine.getDeckState(0).position, 7.75); assert.equal(engine.getDeckState(0).scratchVelocity, 0);
  engine.endScratch(0); assert.equal(engine.getDeckState(0).playing, false); assert.equal(h.creates, 0);
  engine.play(1); h.setWall(103); engine.beginScratch(1); near(engine.getDeckState(1).position, 1);
  h.setWall(105); near(engine.getDeckState(1).position, 1); assert.equal(engine.getDeckState(1).playing, true);
  engine.scratchTo(1, 2); engine.endScratch(1); h.setWall(106); near(engine.getDeckState(1).position, 3);
  assert.equal(h.creates, 0); await engine.dispose();
});

test("Wobblini armed scratch routes copied stereo PCM through deck EQ and resumes at hand position", async () => {
  const h = harness(), { engine, context } = h; await engine.loadFile(0, file()); await engine.arm(); engine.play(0);
  context.currentTime = 6; engine.beginScratch(0);
  const node = engine.scratchNode, begin = node.port.messages.at(-1);
  assert.equal(engine.getState().scratchReady, true); assert.equal(node.connections.length, 8);
  assert.equal(node.connections[0].target, engine.decks[0].graph.low); assert.equal(begin.type, "begin");
  assert.equal(begin.window.chunks[0].channels.length, 2);
  assert.notEqual(begin.window.chunks[0].channels[0], engine.decks[0].buffer.getChannelData(0));
  near(begin.position, 1); assert.equal(engine.decks[0].source, null);
  context.currentTime = 6.05; engine.scratchTo(0, 0.75);
  assert.ok(engine.getDeckState(0).scratchVelocity < 0); near(engine.getDeckState(0).position, 0.75);
  context.currentTime = 7; near(engine.getDeckState(0).position, 0.75); assert.equal(engine.getDeckState(0).playing, true);
  engine.endScratch(0); assert.equal(node.port.messages.at(-1).type, "end"); near(h.sources.at(-1).offset, 0.75);
  context.currentTime = 8; near(engine.getDeckState(0).position, 1.75);
  engine.pause(0); engine.beginScratch(0); engine.scratchTo(0, 0.5); engine.endScratch(0);
  assert.equal(engine.decks[0].source, null); assert.equal(engine.getDeckState(0).playing, false);
  await engine.dispose(); assert.equal(node.port.closed, true);
});

test("Wobblini Audio-off during a held platter releases sound without losing hand ownership", async () => {
  const h = harness(), { engine, context } = h; await engine.arm(); engine.play(0); engine.beginScratch(0);
  context.currentTime += 0.05; engine.scratchTo(0, 0.2); await engine.setAudioEnabled(false);
  assert.equal(engine.getDeckState(0).scratching, true); assert.equal(engine.scratchNode.port.messages.at(-1).type, "clear");
  h.setWall(102); engine.scratchTo(0, 0.1); near(engine.getDeckState(0).position, 0.1);
  await engine.arm(); assert.equal(engine.scratchNode.port.messages.at(-1).type, "begin");
  assert.equal(engine.decks[0].source, null); engine.endScratch(0); near(h.sources.at(-1).offset, 0.1);
  await engine.dispose();
});

test("Wobblini scratch velocity expiry survives wall/audio clock changes", async () => {
  const h = harness(), { engine, context } = h;
  engine.beginScratch(0); h.setWall(100.05); engine.scratchTo(0, 0.1);
  assert.ok(engine.getDeckState(0).scratchVelocity > 0);
  await engine.arm(); context.currentTime += 0.2;
  assert.equal(engine.getDeckState(0).scratchVelocity, 0);
  engine.scratchTo(0, 0); assert.ok(engine.getDeckState(0).scratchVelocity < 0);
  await engine.setAudioEnabled(false); h.setWall(100.25);
  assert.equal(engine.getDeckState(0).scratchVelocity, 0);
  await engine.dispose();
});

test("Wobblini replacement and explicit seek invalidate stale scratch gestures", async () => {
  const { engine } = harness(); engine.beginScratch(0); engine.scratchTo(0, 2);
  engine.loadDemo(0); engine.scratchTo(0, 5); near(engine.getDeckState(0).position, 0);
  assert.equal(engine.getDeckState(0).scratching, false);
  engine.beginScratch(0); engine.scratchTo(0, 3); engine.seek(0, 1); engine.scratchTo(0, 6);
  near(engine.getDeckState(0).position, 1); assert.equal(engine.getDeckState(0).scratching, false);
  await engine.loadFile(0, file()); engine.beginScratch(0); engine.scratchTo(0, -100);
  near(engine.getDeckState(0).position, 0); engine.scratchTo(0, 100); near(engine.getDeckState(0).position, 8);
  engine.endScratch(0); await engine.dispose();
});

test("Wobblini delayed worklet preparation cannot arm after Audio-off or disposal", async () => {
  const prepared = deferred(), h = harness({ scratchFactory: () => prepared.promise });
  const pending = h.engine.arm(); await new Promise(resolve => setImmediate(resolve));
  await h.engine.setAudioEnabled(false);
  const scratch = node({ port: { postMessage() {}, close() { this.closed = true; } } }); prepared.resolve(scratch);
  assert.equal(await pending, false); assert.equal(h.engine.armed, false); assert.equal(h.outputs.length, 0);
  await h.engine.dispose(); assert.equal(scratch.port.closed, true);
});


test("Wobblini constrained imports use 32 kHz decoding and enforce per-track and aggregate memory without replacing tracks", async () => {
  let decodeRate;
  const h = harness({ resourceProfile: "constrained", decodeContextFactory: sampleRate => {
    decodeRate = sampleRate; return { decodeAudioData: async () => buffer(60, sampleRate) };
  } });
  const { engine } = h;
  assert.equal(engine.getState().resourceProfile, "constrained");
  assert.equal(engine.getState().limits.bufferBytes, 64 * 1024 * 1024);
  await engine.loadFile(0, file("Mobile.wav")); assert.equal(decodeRate, 32000); assert.equal(h.creates, 0);
  await assert.rejects(engine.loadFile(0, { ...file(), size: 17 * 1024 * 1024 }), /16 MB/);
  assert.equal(engine.getDeckState(0).name, "Mobile.wav");
  engine.decodeContextFactory = () => ({ decodeAudioData: async () => buffer(70, 32000) });
  await assert.rejects(engine.loadFile(0, file()), /16 MB decoded/);
  assert.equal(engine.getDeckState(0).name, "Mobile.wav");
  engine.decodeContextFactory = () => ({ decodeAudioData: async () => buffer(60, 32000) });
  for (const index of [1, 2, 3]) await engine.loadFile(index, file());
  await assert.rejects(engine.loadFile(4, file()), /64 MB/);
  assert.equal(engine.getDeckState(4).kind, "demo"); assert.equal(engine.getDeckState(4).loading, false);
  assert.equal(await engine.decodeQueue, undefined, "queue does not retain the previous decoded buffer");
  await engine.dispose();
});

test("Wobblini long-track scratch transfers stay bounded and stale refill requests cannot revive replaced gestures", async () => {
  const h = harness({ decodeContextFactory: () => ({ decodeAudioData: async () => buffer(60, 48000) }) });
  const { engine } = h; await engine.loadFile(0, file()); await engine.arm(); engine.seek(0, 30); engine.beginScratch(0);
  const port = engine.scratchNode.port, begin = port.messages.at(-1);
  const bytes = message => message.window.chunks.reduce((sum, chunk) => sum + chunk.channels.reduce((sum, channel) => sum + channel.byteLength, 0), 0);
  assert.ok(bytes(begin) <= (48000 * 2 + 8) * 2 * 4); assert.equal(begin.channels, undefined);
  port.onmessage({ data: { type: "window-request", index: 0, generation: begin.generation, position: 31 } });
  assert.equal(port.messages.at(-1).type, "window"); assert.ok(bytes(port.messages.at(-1)) <= bytes(begin) + 64);
  engine.endScratch(0); const count = port.messages.length;
  port.onmessage({ data: { type: "window-request", index: 0, generation: begin.generation, position: 32 } });
  assert.equal(port.messages.length, count);
  engine.beginScratch(0); const newCount = port.messages.length;
  port.onmessage({ data: { type: "window-request", index: 0, generation: begin.generation, position: 32 } });
  assert.equal(port.messages.length, newCount); await engine.dispose();
});

test("Wobblini cannot claim Audio is armed when a browser remains interrupted after resume", async () => {
  const h = harness(); h.context.resume = async () => { h.context.state = "interrupted"; };
  await assert.rejects(h.engine.arm(), /Audio is unavailable/);
  assert.equal(h.engine.armed, false); assert.equal(h.outputs.length, 0);
  h.context.resume = async () => { h.context.state = "running"; };
  assert.equal(await h.engine.arm(), true); await h.engine.dispose();
});


test("Wobblini constrained preflight rejects long compressed imports before reading or decoding PCM", async () => {
  let reads = 0, decodes = 0, inspections = 0;
  const h = harness({ resourceProfile: "constrained", metadataReader: async () => { inspections++; return 600; },
    decodeContextFactory: () => { decodes++; return { decodeAudioData: async () => buffer() }; } });
  await assert.rejects(h.engine.loadFile(0, { ...file(), arrayBuffer: async () => { reads++; return new ArrayBuffer(10); } }), /under 131 seconds/);
  assert.equal(inspections, 1); assert.equal(reads, 0); assert.equal(decodes, 0); assert.equal(h.creates, 0);
  assert.equal(h.engine.getDeckState(0).kind, "demo"); assert.equal(h.engine.getDeckState(0).loading, false);
  h.engine.metadataReader = async () => { throw new Error("Could not inspect duration; choose a shorter clip."); };
  await assert.rejects(h.engine.loadFile(0, file()), /shorter clip/);
  assert.equal(decodes, 0); await h.engine.dispose();
});

test("Wobblini constrained preflight admits longer mono clips and uses remaining session memory", async () => {
  let duration = 100, decodes = 0;
  const h = harness({ resourceProfile: "constrained", metadataReader: async () => duration,
    decodeContextFactory: sampleRate => ({ decodeAudioData: async () => { decodes++; return buffer(duration, sampleRate, 1); } }) });
  await h.engine.loadFile(0, file("Long mono.wav")); assert.equal(h.engine.getDeckState(0).duration, 100);
  for (const index of [1, 2, 3]) await h.engine.loadFile(index, file());
  duration = 120;
  await assert.rejects(h.engine.loadFile(4, file()), /under 106 seconds/);
  assert.equal(decodes, 4, "remaining memory rejects before native decode");
  assert.equal(h.engine.getDeckState(4).kind, "demo");
  await h.engine.dispose();
});

test("Wobblini new imports, demo replacement and disposal cancel stale metadata readers", async () => {
  const signals = [], h = harness({ resourceProfile: "constrained", metadataReader: (_file, { signal }) => {
    signals.push(signal);
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
  } });
  const first = h.engine.loadFile(0, file()); await new Promise(resolve => setImmediate(resolve));
  h.engine.metadataReader = async () => 8;
  const replacement = h.engine.loadFile(0, file("Replacement.wav"));
  assert.equal(await first, false); assert.equal(signals[0].aborted, true); assert.equal(await replacement, true);
  assert.equal(h.engine.getDeckState(0).name, "Replacement.wav");
  h.engine.metadataReader = (_file, { signal }) => { signals.push(signal); return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true })); };
  const second = h.engine.loadFile(1, file()); await new Promise(resolve => setImmediate(resolve));
  h.engine.loadDemo(1); assert.equal(await second, false); assert.equal(signals[1].aborted, true);
  const third = h.engine.loadFile(2, file()); await new Promise(resolve => setImmediate(resolve));
  await h.engine.dispose(); assert.equal(await third, false); assert.equal(signals[2].aborted, true);
  assert.equal(h.creates, 0);
});

test("Wobblini standard imports skip metadata preflight entirely", async () => {
  const h = harness({ metadataReader: () => { throw new Error("Unexpected metadata request"); } });
  assert.equal(await h.engine.loadFile(0, file()), true); assert.equal(h.decodes, 1); await h.engine.dispose();
});
