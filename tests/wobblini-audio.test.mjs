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


function assertSynced(engine, ids = [1, 2, 3, 4, 5, 6, 7]) {
  const master = engine.getDeckState(0);
  for (const id of ids) {
    const deck = engine.getDeckState(id), period = deck.syncBeatPeriod;
    assert.equal(deck.syncError, null, `deck ${id + 1}: ${deck.syncError}`);
    assert.equal(deck.syncActive, true, `deck ${id + 1} must actually be locked`);
    near(deck.effectiveBpm, master.effectiveBpm);
    const error = Math.abs(deck.beatPhase - master.beatPhase % period);
    assert.ok(Math.min(error, period - error) < 1e-7, `deck ${id + 1} phase ${deck.beatPhase} vs master ${master.beatPhase}`);
  }
}

test("Wobblini Sync locks all eight manual beat grids across BPM differences and many loops without arming Audio", async () => {
  const h = harness(), { engine } = h;
  for (const [id, bpm] of [120, 60, 90, 120, 150, 180, 200, 240].entries()) {
    engine.setDeck(id, { bpm }); engine.setCue(id, id * 0.023); engine.seek(id, id * 0.13);
  }
  engine.setSyncEnabled(true); engine.playAll(); assertSynced(engine);
  assert.equal(engine.getState().masterDeck, 0); assert.equal(engine.getState().syncBpm, 120);
  assert.equal(engine.getDeckState(0).isMaster, true);
  for (const time of [101.37, 107.89, 134.123]) { h.setWall(time); assertSynced(engine); }
  assert.equal(h.creates, 0); assert.equal(engine.armed, false); await engine.dispose();
});

test("Wobblini later follower starts, source tempo edits and cue changes join the master's actual beat phase", async () => {
  const h = harness(), { engine } = h;
  engine.setSyncEnabled(true); engine.play(0); h.setWall(101.213);
  engine.seek(1, 3.117); engine.setDeck(1, { bpm: 90 }); engine.play(1); assertSynced(engine, [1]);
  assert.equal(engine.getDeckState(2).syncActive, false);
  engine.setCue(1, 0.17); assertSynced(engine, [1]);
  h.setWall(102.123); engine.setCue(0, 0.29); assertSynced(engine, [1]);
  engine.setDeck(1, { bpm: 150 }); assertSynced(engine, [1]);
  engine.seek(1, 2.31); assertSynced(engine, [1]);
  engine.setLoop(1, 4); h.setWall(108.919); assertSynced(engine, [1]);
  await engine.dispose();
});

test("Wobblini follower scratch temporarily releases phase and rejoins without changing playback intent", async () => {
  const h = harness(), { engine } = h; engine.setSyncEnabled(true); engine.playAll(); h.setWall(100.23);
  engine.beginScratch(1); engine.scratchTo(1, 3.127); h.setWall(100.67);
  near(engine.getDeckState(1).position, 3.127); assert.equal(engine.getDeckState(1).syncActive, false);
  engine.endScratch(1); assertSynced(engine);
  engine.pause(2); engine.beginScratch(2); engine.scratchTo(2, 1.173); engine.endScratch(2);
  assert.equal(engine.getDeckState(2).playing, false); assert.equal(engine.getDeckState(2).syncActive, false);
  near(engine.getDeckState(2).position, 1.173);
  engine.play(2); assertSynced(engine); assert.equal(h.creates, 0); await engine.dispose();
});

test("Wobblini master pause and scratch preserve followers until the master resumes and re-aligns them", async () => {
  const h = harness(), { engine } = h; engine.setSyncEnabled(true); engine.playAll(); h.setWall(100.12);
  engine.pause(0); const follower = engine.getDeckState(1).position; h.setWall(100.32);
  near(engine.getDeckState(1).position, follower + 0.2); assert.equal(engine.getDeckState(1).syncActive, false);
  engine.play(0); assertSynced(engine);
  engine.beginScratch(0); engine.scratchTo(0, 4.177); h.setWall(100.8);
  assert.equal(engine.getDeckState(1).syncActive, false); assert.equal(engine.getDeckState(1).playing, true);
  engine.endScratch(0); assertSynced(engine);
  engine.seek(0, 2.217); assertSynced(engine); await engine.dispose();
});

test("Wobblini sync range failures are explicit, preserve transports and recover when the ratio is valid", async () => {
  const h = harness(), { engine } = h; engine.setLoop(1, 0); engine.setDeck(1, { bpm: 40 });
  engine.setSyncEnabled(true); engine.playAll();
  assert.match(engine.getDeckState(1).syncError, /outside 0.5×–2×/);
  assert.equal(engine.getDeckState(1).syncActive, false); assert.equal(engine.getDeckState(1).playing, true);
  near(engine.getDeckState(1).rate, 1); assertSynced(engine, [2, 3, 4, 5, 6, 7]);
  engine.setDeck(1, { bpm: 60 }); assertSynced(engine);
  engine.setDeck(0, { rate: 1.1 }); assert.match(engine.getDeckState(1).syncError, /outside/);
  engine.setDeck(0, { rate: 0.9 }); assertSynced(engine); await engine.dispose();
});

test("Wobblini sync off preserves matched speeds and manual follower speed releases only that follower", async () => {
  const h = harness(), { engine } = h; engine.setDeck(1, { bpm: 90 }); engine.setSyncEnabled(true); engine.playAll();
  h.setWall(100.2); const before = engine.getDeckState(1); engine.setSyncEnabled(false);
  near(engine.getDeckState(1).position, before.position); near(engine.getDeckState(1).rate, 4 / 3);
  h.setWall(100.5); near(engine.getDeckState(1).position, before.position + 0.3 * 4 / 3);
  engine.setSyncEnabled(true); engine.setDeck(1, { rate: 0.75 });
  assert.equal(engine.getState().syncEnabled, true); assert.equal(engine.getState().syncAllEnabled, false);
  assert.equal(engine.getDeckState(1).syncEnabled, false); near(engine.getDeckState(1).rate, 0.75);
  assert.equal(engine.getDeckState(1).playing, true); assert.equal(engine.getDeckState(1).syncError, null);
  assertSynced(engine, [2, 3, 4, 5, 6, 7]);
  engine.setSyncEnabled(true); assert.equal(engine.getState().syncAllEnabled, true); assertSynced(engine);
  await engine.dispose();
});

test("Wobblini per-deck Sync selects individual followers without arming Audio or changing the fixed master", async () => {
  const h = harness(), { engine } = h;
  engine.setDeck(1, { bpm: 90 }); engine.setDeck(2, { bpm: 150 });
  assert.equal(engine.getState().syncEnabled, false); assert.equal(engine.getState().syncAllEnabled, false);
  assert.equal(engine.setDeckSyncEnabled(0, true), false); assert.equal(engine.getDeckState(0).syncEnabled, false);
  assert.equal(engine.setDeckSyncEnabled(1, true), true);
  assert.equal(engine.getState().syncEnabled, true); assert.equal(engine.getState().syncAllEnabled, false);
  assert.equal(engine.getDeckState(1).syncActive, false); near(engine.getDeckState(1).rate, 4 / 3);
  engine.playAll(); h.setWall(100.237); assertSynced(engine, [1]);
  near(engine.getDeckState(2).rate, 1); assert.equal(engine.getDeckState(2).syncActive, false);
  engine.seek(2, 2.17); engine.setDeckSyncEnabled(2, true); assertSynced(engine, [1, 2]);
  engine.setDeckSyncEnabled(1, false); engine.setDeckSyncEnabled(2, false);
  assert.equal(engine.getState().syncEnabled, false);
  assert.ok(engine.getState().decks.every(deck => !deck.syncEnabled && !deck.syncActive));
  assert.equal(h.creates, 0); assert.equal(engine.armed, false); await engine.dispose();
});

test("Wobblini follower speed and 1x reset update native audio while other selected decks remain synced", async () => {
  const h = harness(), { engine, context } = h;
  engine.setDeck(1, { bpm: 90 }); engine.setSyncEnabled(true); await engine.arm(); engine.playAll();
  context.currentTime += 0.2;
  const others = engine.decks.slice(2).map(deck => deck.source), independent = engine.decks[1].source;
  engine.setDeck(1, { rate: 0.75 });
  assert.equal(engine.decks[1].source, independent); near(independent.source.playbackRate.value, 0.75);
  assert.deepEqual(engine.decks.slice(2).map(deck => deck.source), others);
  assertSynced(engine, [2, 3, 4, 5, 6, 7]);
  engine.setDeck(0, { rate: 1.1 }); context.currentTime += 0.05;
  assertSynced(engine, [2, 3, 4, 5, 6, 7]); near(engine.getDeckState(1).rate, 0.75);
  near(independent.source.playbackRate.value, 0.75);
  engine.setDeckSyncEnabled(1, true); context.currentTime += 0.05; assertSynced(engine);
  const resetSource = engine.decks[1].source; engine.setDeck(1, { rate: 1 });
  near(resetSource.source.playbackRate.value, 1); near(engine.getDeckState(1).rate, 1);
  assert.equal(engine.getDeckState(1).syncEnabled, false); assert.equal(engine.getState().syncEnabled, true);
  assertSynced(engine, [2, 3, 4, 5, 6, 7]);
  await engine.dispose();
});

test("Wobblini individual Sync release retains native playback and scopes warnings to requested followers", async () => {
  const h = harness(), { engine, context } = h;
  engine.setLoop(1, 0); engine.setDeck(1, { bpm: 40 }); engine.setLoop(2, 0); engine.setDeck(2, { bpm: 40 });
  engine.setSyncEnabled(true); await engine.arm(); engine.playAll(); context.currentTime += 0.2;
  assert.match(engine.getDeckState(1).syncError, /outside/); assert.match(engine.getDeckState(2).syncError, /outside/);
  const before = engine.getDeckState(3), sources = engine.decks.map(deck => deck.source);
  engine.setDeckSyncEnabled(3, false);
  assert.deepEqual(engine.decks.map(deck => deck.source), sources);
  near(engine.getDeckState(3).position, before.position); near(engine.getDeckState(3).rate, before.rate);
  engine.setDeckSyncEnabled(1, false); assert.equal(engine.getDeckState(1).syncError, null);
  assert.match(engine.getDeckState(2).syncError, /outside/);
  engine.setSyncEnabled(false);
  assert.ok(engine.getState().decks.every(deck => !deck.syncEnabled && !deck.syncActive && deck.syncError === null));
  assert.ok(engine.getState().decks.every(deck => deck.playing)); await engine.dispose();
});

test("Wobblini selected memberships survive scratch, track replacement and explicit Audio rearming", async () => {
  const h = harness(), { engine, context } = h;
  engine.setDeckSyncEnabled(1, true); engine.setDeck(2, { rate: 1.25 }); engine.playAll();
  engine.beginScratch(1); engine.scratchTo(1, 2.17); engine.endScratch(1); assertSynced(engine, [1]);
  engine.beginScratch(2); engine.scratchTo(2, 3.13); engine.endScratch(2);
  near(engine.getDeckState(2).position, 3.13); assert.equal(engine.getDeckState(2).syncEnabled, false);
  engine.loadDemo(1); assertSynced(engine, [1]); await engine.loadFile(2, file());
  near(engine.getDeckState(2).rate, 1.25); assert.equal(engine.getDeckState(2).syncEnabled, false);
  await engine.arm(); context.currentTime += 0.05; assertSynced(engine, [1]);
  await engine.setAudioEnabled(false); h.setWall(100.3); assertSynced(engine, [1]);
  await engine.arm(); context.currentTime += 0.05; assertSynced(engine, [1]);
  assert.equal(engine.getState().syncAllEnabled, false);
  assert.deepEqual(engine.getState().decks.map(deck => deck.syncEnabled), [false, true, false, false, false, false, false, false]);
  await engine.dispose();
});

test("Wobblini native Sync sources share a scheduled boundary and master speed propagates without early fade-out", async () => {
  const h = harness(), { engine, context } = h;
  engine.setDeck(1, { bpm: 90 }); engine.setDeck(2, { bpm: 180 });
  engine.setSyncEnabled(true); await engine.arm(); engine.playAll();
  assert.equal(h.sources.length, 8); assert.equal(new Set(h.sources.map(source => source.startTime)).size, 1);
  near(h.sources[0].startTime, 5.016); context.currentTime = 5.2; assertSynced(engine);
  const old = engine.decks[1].source; engine.setDeck(0, { rate: 1.1 });
  const when = engine.decks[1].source.source.startTime;
  assert.ok(when > context.currentTime); near(old.source.stopTime, when + 0.008);
  for (let i = 1; i < 8; i++) near(engine.decks[i].source.source.startTime, when);
  context.currentTime = 5.4; assertSynced(engine);
  const replaced = engine.decks[2].source;
  await engine.loadFile(2, file());
  near(replaced.source.stopTime, engine.decks[2].source.source.startTime + 0.008);
  context.currentTime += 0.05; assertSynced(engine);
  engine.beginScratch(1); context.currentTime += 0.05; engine.scratchTo(1, 2.123); engine.endScratch(1);
  context.currentTime += 0.05; assertSynced(engine);
  await engine.setAudioEnabled(false); h.setWall(100.7); assertSynced(engine);
  await engine.arm(); context.currentTime += 0.05; assertSynced(engine);
  await engine.dispose();
});

test("Wobblini half-beat loops lock subdivisions and incompatible clipped loops report their limitation", async () => {
  const h = harness(), { engine } = h; engine.setSyncEnabled(true); engine.playAll();
  engine.setLoop(0, 0.5); h.setWall(101.23); assertSynced(engine);
  assert.equal(engine.getDeckState(1).syncBeatPeriod, 0.5);
  engine.setLoop(0, 16); engine.setLoop(1, 0.5); h.setWall(102.617); assertSynced(engine);
  h.engine.decodeContextFactory = () => ({ decodeAudioData: async () => buffer(1.17) });
  await engine.loadFile(0, file()); engine.setLoop(0, 4);
  assert.match(engine.getDeckState(1).syncError, /Deck 1's clipped loop/);
  assert.equal(engine.getDeckState(1).syncActive, false); assert.equal(engine.getDeckState(1).playing, true);
  engine.setLoop(0, 1); assertSynced(engine);
  await engine.dispose();
});


test("Wobblini master edits before a scheduled launch retain exact native and model timing", async () => {
  const h = harness(), { engine, context } = h;
  await engine.arm(); engine.setSyncEnabled(true); engine.playAll();
  const launch = engine.decks[0].source.source.startTime;
  context.currentTime += 0.004; engine.setDeck(0, { rate: 1.2 });
  context.currentTime += 0.003; engine.setDeck(0, { bpm: 150 });
  const masterSource = engine.decks[0].source.source;
  near(masterSource.startTime, launch); near(engine.decks[0].state.anchorTime, launch);
  for (const deck of engine.decks) near(deck.source.source.startTime, launch);
  context.currentTime = launch + 0.1;
  near(engine.getDeckState(0).position, masterSource.offset + 0.1 * masterSource.playbackRate.value);
  assertSynced(engine); await engine.dispose();
});

test("Wobblini full snapshots project every phase from one shared clock read", async () => {
  let wall = 100, calls = 0;
  const h = harness({ now: () => { calls++; wall += 0.001; return wall; } });
  h.engine.setSyncEnabled(true); h.engine.playAll();
  calls = 0; const snapshot = h.engine.getState(); assert.equal(calls, 1);
  for (const deck of snapshot.decks.slice(1)) {
    const error = Math.abs(deck.beatPhase - snapshot.decks[0].beatPhase);
    assert.ok(Math.min(error, 1 - error) < 1e-7);
  }
  await h.engine.dispose();
});
