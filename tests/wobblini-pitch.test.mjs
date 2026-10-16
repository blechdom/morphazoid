import test from "node:test";
import assert from "node:assert/strict";
import { createWobbliniPitch, needsPitchProcessing, pitchOutputSemitones,
  wobbliniPitchMemoryBytes } from "../src/instruments/wobblini/wobblini-pitch.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function node(extra = {}) {
  return { connections: [], disconnects: 0, connect(output) { this.connections.push(output); return output; },
    disconnect() { this.disconnects++; this.connections = []; }, ...extra };
}
function parameter() {
  return { value: 1, events: [], cancelAndHoldAtTime(time) { this.events.push(["hold", time]); },
    setValueAtTime(value, time) { this.events.push(["set", value, time]); },
    linearRampToValueAtTime(value, time) { this.events.push(["ramp", value, time]); } };
}
function buffer({ rate = 48000, frames = 48000, channels = 2, marker = 0.25 } = {}) {
  return { sampleRate: rate, length: frames, numberOfChannels: channels, duration: frames / rate,
    copyFromChannel(target, channel) { target.fill(marker * (channel + 1)); },
    getChannelData() { throw new Error("Do not materialize an acquired native buffer"); } };
}
function stretch(extra = {}) {
  return node({ schedules: [], copies: [], drops: 0, configurations: [],
    port: { closed: false, close() { this.closed = true; } },
    async configure(config) { this.configurations.push(config); }, async latency() { return 0.08; },
    async schedule(command) { this.schedules.push(command); },
    async dropBuffers() { this.drops++; this.copies = []; },
    async addBuffers(copies, transfer) { this.copies = copies; this.transfer = transfer; }, ...extra });
}
function harness(overrides = {}) {
  const gains = [], nodes = [], errors = [], output = node();
  const context = { sampleRate: 48000, currentTime: 5, audioWorklet: {}, state: "suspended",
    createGain() { const gain = node({ gain: parameter() }); gains.push(gain); return gain; },
    resume() { throw new Error("Pitch must never arm Audio"); } };
  const options = { context, output, onError: error => errors.push(error),
    stretchFactory: async () => { const item = stretch(); nodes.push(item); return item; }, ...overrides };
  const helper = createWobbliniPitch(options);
  return { helper, context, output, gains, nodes, errors, options };
}

test("pitch mapping separates playback speed, original-pitch lock and independent semitones", () => {
  assert.equal(needsPitchProcessing({ keyLock: true, rate: 1, pitchSemitones: 0 }), false);
  assert.equal(needsPitchProcessing({ keyLock: false, rate: 1.5, pitchSemitones: 0 }), false);
  assert.equal(needsPitchProcessing({ keyLock: true, rate: 1.5, pitchSemitones: 0 }), true);
  assert.equal(needsPitchProcessing({ keyLock: false, rate: 1, pitchSemitones: 0.01 }), true);
  assert.equal(pitchOutputSemitones({ keyLock: true, rate: 0.25, pitchSemitones: 12 }), 12);
  assert.equal(pitchOutputSemitones({ keyLock: false, rate: 0.5, pitchSemitones: 7 }), -5);
  assert.equal(pitchOutputSemitones({ keyLock: true, rate: NaN, pitchSemitones: Infinity }), 0);
  assert.equal(pitchOutputSemitones({ keyLock: true, rate: 1, pitchSemitones: -99 }), -12);
});

test("constructing, preparing and controlling pitch never creates or resumes Audio", async () => {
  const h = harness(), pcm = buffer();
  assert.equal(h.nodes.length, 0); assert.equal(h.gains.length, 0);
  assert.equal(await h.helper.play({ position: 0 }), false);
  assert.equal(await h.helper.prepare(pcm), true); assert.equal(h.context.state, "suspended");
  assert.equal(await h.helper.prepare(pcm), true); assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0].copies[0][0], 0.25); assert.equal(h.nodes[0].copies[1][0], 0.5);
  assert.deepEqual(h.nodes[0].transfer, h.nodes[0].copies.map(copy => copy.buffer));
  assert.equal(wobbliniPitchMemoryBytes(h.context), pcm.length * 8);
  h.helper.dispose(); assert.equal(wobbliniPitchMemoryBytes(h.context), 0);
});

test("pitch commands use the projected source position once and exact output boundary", async () => {
  const h = harness(); await h.helper.prepare(buffer({ frames: 480000 }));
  assert.equal(h.helper.latency, 0.08);
  await h.helper.play({ when: 5.1, position: 2.15, rate: 1.5, keyLock: true, pitchSemitones: -4 });
  assert.deepEqual(h.nodes[0].schedules.at(-1), { active: true, output: 5.1, input: 2.15, rate: 1.5,
    semitones: -4, loopStart: 0, loopEnd: 0 });
  const expectedEnd = 5.1 + (10 - 2.15) / 1.5;
  assert.deepEqual(h.gains[0].gain.events.at(-1), ["ramp", 0, expectedEnd]);
  await h.helper.play({ when: 5.2, position: 2.3, rate: 0.5, keyLock: false, pitchSemitones: 7 });
  assert.equal(h.nodes[0].schedules.at(-1).semitones, -5);
  assert.equal(h.gains[0].gain.events.filter(event => event[0] === "set" && event[1] === 0).length, 0, "live edits do not reset gain to zero");
  h.helper.dispose();
});

test("files cannot repeat and even a sub-fade final fragment ends at its source boundary", async () => {
  const h = harness(); await h.helper.prepare(buffer());
  await h.helper.play({ when: 5, position: 0.999, rate: 1, keyLock: true,
    loopEnabled: true, loopStart: 0, loopEnd: 1 });
  assert.equal(h.nodes[0].schedules.at(-1).loopEnd, 0);
  assert.equal(Math.max(...h.gains[0].gain.events.map(event => event.at(-1))), 5.001);
  assert.deepEqual(h.gains[0].gain.events.at(-1), ["ramp", 0, 5.001]);
  assert.equal(await h.helper.play({ when: 5.1, position: 1, rate: 1 }), false);
  assert.equal(h.nodes[0].schedules.at(-1).active, false);
  h.helper.dispose();
});

test("scratch handoff immediately gates pitch, cancels end automation, then resumes at supplied position", async () => {
  const h = harness(); await h.helper.prepare(buffer({ frames: 480000 }));
  await h.helper.play({ when: 5.1, position: 2, rate: 1.5, keyLock: true });
  await h.helper.stop(5.2, true);
  assert.deepEqual(h.gains[0].gain.events.slice(-2), [["hold", 5.2], ["set", 0, 5.2]]);
  assert.deepEqual(h.nodes[0].schedules.at(-1), { active: false, output: 5.2 });
  await h.helper.play({ when: 5.5, position: 1.3, rate: 1.5, keyLock: true });
  assert.equal(h.nodes[0].schedules.at(-1).input, 1.3); assert.equal(h.nodes.length, 1);
  h.helper.dispose();
});

test("eight helpers share the native-plus-extra PCM budget and a ninth worklet is rejected", async () => {
  const h = harness({ memoryLimit: 20 * 1024 * 1024, getBaseBytes: () => 1024 * 1024 }), helpers = [h.helper];
  for (let index = 1; index < 9; index++) helpers.push(createWobbliniPitch(h.options));
  await Promise.all(helpers.slice(0, 8).map(helper => helper.prepare(buffer())));
  await assert.rejects(helpers[8].prepare(buffer()), /eight pitch voices/);
  assert.equal(h.nodes.length, 8); assert.equal(wobbliniPitchMemoryBytes(h.context), 8 * 48000 * 8);
  helpers[0].dispose(); assert.equal(await helpers[8].prepare(buffer()), true);
  helpers.forEach(helper => helper.dispose()); assert.equal(wobbliniPitchMemoryBytes(h.context), 0);
});

test("memory preflight rejects aggregate copies before any allocation and releases failed reservation", async () => {
  const h = harness({ memoryLimit: 700000, getBaseBytes: () => 300000 });
  await h.helper.prepare(buffer());
  const second = createWobbliniPitch(h.options);
  await assert.rejects(second.prepare(buffer()), /audio memory/);
  assert.equal(h.nodes.length, 1); assert.equal(wobbliniPitchMemoryBytes(h.context), 384000);
  h.helper.dispose(); await second.prepare(buffer()); second.dispose();
});

test("resampling accounts for intermediate and transferable PCM without changing source time", async () => {
  let allocated = 0;
  const h = harness({ memoryLimit: 1000000, getBaseBytes: () => 100000,
    offlineFactory(channels, length, rate) {
      allocated++; assert.equal(channels, 2); assert.equal(length, 48000); assert.equal(rate, 48000);
      return { destination: node(), createBufferSource: () => node({ start() {} }),
        async startRendering() { assert.equal(wobbliniPitchMemoryBytes(h.context), 768000); return buffer(); } };
    } });
  const pcm = buffer({ frames: 32000, rate: 32000 });
  await h.helper.prepare(pcm); assert.equal(allocated, 1); assert.equal(wobbliniPitchMemoryBytes(h.context), 384000);
  await h.helper.play({ when: 5.1, position: 0.2, rate: 1.25, keyLock: true });
  assert.equal(h.nodes[0].schedules.at(-1).input, 0.2); h.helper.dispose();
  const small = harness({ memoryLimit: 700000, offlineFactory() { throw new Error("Must reject before resampling"); } });
  await assert.rejects(small.helper.prepare(pcm), /audio memory/); assert.equal(small.nodes.length, 0);
});

test("disposing during offline rendering keeps its reservation until the uncancellable work finishes", async () => {
  const job = deferred();
  const h = harness({ offlineFactory: () => ({ destination: node(), createBufferSource: () => node({ start() {} }), startRendering: () => job.promise }) });
  const pending = h.helper.prepare(buffer({ frames: 32000, rate: 32000 })); await flush();
  h.helper.dispose(); assert.equal(wobbliniPitchMemoryBytes(h.context), 768000);
  job.resolve(buffer()); assert.equal(await pending, false); assert.equal(wobbliniPitchMemoryBytes(h.context), 0);
  assert.equal(h.nodes[0].copies.length, 0); assert.equal(h.nodes[0].port.closed, true);
});

test("superseded preparation cannot load an old track into the newest voice", async () => {
  const created = deferred(), late = stretch(), next = stretch(); let calls = 0;
  const h = harness({ stretchFactory: () => ++calls === 1 ? created.promise : Promise.resolve(next) });
  const old = buffer({ marker: 0.1 }), current = buffer({ marker: 0.7 });
  const first = h.helper.prepare(old); await flush(); const second = h.helper.prepare(current);
  created.resolve(late); assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(late.port.closed, true); assert.equal(late.copies.length, 0);
  assert.ok(Math.abs(next.copies[0][0] - 0.7) < 1e-6); assert.equal(h.helper.isReady(current), true);
  assert.equal(wobbliniPitchMemoryBytes(h.context), 384000); h.helper.dispose();
});

test("late factory arrival after disposal is closed and never connects", async () => {
  const created = deferred(), late = stretch(), h = harness({ stretchFactory: () => created.promise });
  const pending = h.helper.prepare(buffer()); await flush(); h.helper.dispose(); created.resolve(late);
  assert.equal(await pending, false); assert.equal(late.port.closed, true); assert.equal(late.connections.length, 0);
  assert.equal(wobbliniPitchMemoryBytes(h.context), 0);
});

test("returning to the ready file cancels a queued replacement rather than silently loading it later", async () => {
  const h = harness(), original = buffer({ marker: 0.1 }), replacement = buffer({ marker: 0.7 });
  await h.helper.prepare(original);
  const pendingReplacement = h.helper.prepare(replacement), pendingOriginal = h.helper.prepare(original);
  assert.equal(await pendingReplacement, false); assert.equal(await pendingOriginal, true);
  assert.equal(h.helper.isReady(original), true); assert.equal(h.helper.isReady(replacement), false);
  assert.ok(Math.abs(h.nodes[0].copies[0][0] - 0.1) < 1e-6); h.helper.dispose();
});

test("failed preparation cleans nodes and can be retried without retained PCM", async () => {
  let fail = true; const items = [];
  const h = harness({ stretchFactory: async () => {
    const item = stretch({ async configure() { if (fail) throw new Error("configure failed"); } }); items.push(item); return item;
  } });
  await assert.rejects(h.helper.prepare(buffer()), /configure failed/);
  assert.equal(items[0].port.closed, true); assert.equal(wobbliniPitchMemoryBytes(h.context), 0);
  fail = false; assert.equal(await h.helper.prepare(buffer()), true); h.helper.dispose();
});

test("factory timeout keeps a pending voice counted until its late result is closed", async () => {
  const created = deferred(), late = stretch(), h = harness({ timeoutMs: 5, stretchFactory: () => created.promise });
  await assert.rejects(h.helper.prepare(buffer()), /timed out/); h.helper.dispose();
  const helpers = Array.from({ length: 8 }, () => createWobbliniPitch({ ...h.options, stretchFactory: async () => stretch() }));
  await Promise.all(helpers.slice(0, 7).map(helper => helper.prepare(buffer())));
  await assert.rejects(helpers[7].prepare(buffer()), /eight pitch voices/);
  created.resolve(late); await flush(); assert.equal(late.port.closed, true);
  assert.equal(await helpers[7].prepare(buffer()), true); helpers.forEach(helper => helper.dispose());
});

test("processor failure gates and releases the voice and reports only once", async () => {
  const h = harness(), pcm = buffer(); await h.helper.prepare(pcm);
  const fail = h.nodes[0].onprocessorerror; fail(); fail();
  assert.equal(h.errors.length, 1); assert.equal(h.helper.isReady(pcm), false);
  assert.equal(h.nodes[0].port.closed, true); assert.equal(wobbliniPitchMemoryBytes(h.context), 0);
  assert.equal(await h.helper.play({ position: 0 }), false); h.helper.dispose();
});

test("missing worklet support fails before allocating and never arms Audio", async () => {
  const h = harness(); h.context.audioWorklet = null;
  await assert.rejects(h.helper.prepare(buffer()), /AudioWorklet/);
  assert.equal(h.nodes.length, 0); assert.equal(wobbliniPitchMemoryBytes(h.context), 0);
});
