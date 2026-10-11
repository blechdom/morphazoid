import assert from "node:assert/strict";
import test from "node:test";
import { SpartialAudio } from "../src/instruments/spartial/spartial-audio.js";

function fixture(t) {
  const decodes = [];
  const original = globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext = class {
    decodeAudioData() { return new Promise((resolve, reject) => decodes.push({ resolve, reject })); }
  };
  t.after(() => { if (original) globalThis.OfflineAudioContext = original; else delete globalThis.OfflineAudioContext; });
  const audio = new SpartialAudio();
  const file = name => ({ name, size: 16, arrayBuffer: async () => new ArrayBuffer(16) });
  const decoded = (channels, sampleRate = 48000) => ({
    sampleRate, length: channels[0].length, numberOfChannels: channels.length,
    getChannelData: index => channels[index],
  });
  return { audio, file, decoded, decodes, tick: () => new Promise(resolve => setImmediate(resolve)) };
}

test("grain files decode without arming Audio and are bounded mono source data", async t => {
  const f = fixture(t);
  const loading = f.audio.loadGrainFile(f.file("stereo.wav")); await f.tick();
  f.decodes[0].resolve(f.decoded([Float32Array.of(.8, .2, Infinity, 3), Float32Array.of(.4, -.2, .4, 3)]));
  const source = await loading;
  assert.ok(Math.abs(source.samples[0] - .6) < 1e-6);
  assert.equal(source.samples[1], 0);
  assert.ok(Math.abs(source.samples[2] - .2) < 1e-6);
  assert.equal(source.samples[3], 1);
  assert.equal(f.audio.context, null);
  assert.equal(f.audio.enabled, false);
  const messages = [];
  f.audio.node = { port: { postMessage: (message, transfers) => messages.push({ message, transfers }) } };
  f.audio.sendGrainFile();
  assert.equal(messages[0].message.type, "grainFile");
  assert.equal(messages[0].message.sampleRate, 48000);
  assert.notEqual(messages[0].message.samples, source.samples, "retain source bytes for future engine creation");
  assert.deepEqual(messages[0].message.samples, source.samples);
  assert.deepEqual(messages[0].transfers, [messages[0].message.samples.buffer]);
});

test("grain file limits reject large files and retain only the first twenty seconds", async t => {
  const f = fixture(t);
  await assert.rejects(f.audio.loadGrainFile({ size: 20 * 1024 * 1024 + 1 }), /20 MB/);
  assert.equal(f.decodes.length, 0);
  const loading = f.audio.loadGrainFile(f.file("long.wav")); await f.tick();
  f.decodes[0].resolve(f.decoded([new Float32Array(48000 * 21)]));
  const source = await loading;
  assert.equal(source.samples.length, 48000 * 20);
  assert.equal(source.duration, 20);
  assert.equal(source.trimmed, true);
});

test("newer grain file selection and Clear supersede pending decodes; failures retain the current file", async t => {
  const f = fixture(t);
  const old = f.audio.loadGrainFile(f.file("old.wav")); await f.tick();
  const fresh = f.audio.loadGrainFile(f.file("new.wav")); await f.tick();
  const data = f.decoded([Float32Array.of(.2, .4, -.2)]);
  f.decodes[1].resolve(data); await fresh;
  f.decodes[0].resolve(data);
  assert.equal(await old, null); assert.equal(f.audio.grainFile.name, "new.wav");
  const failed = f.audio.loadGrainFile(f.file("bad.wav")); await f.tick();
  f.decodes[2].reject(new Error("unsupported format"));
  await assert.rejects(failed, /unsupported format/);
  assert.equal(f.audio.grainFile.name, "new.wav");
  const pending = f.audio.loadGrainFile(f.file("cancelled.wav")); await f.tick();
  f.audio.clearGrainFile(); f.decodes[3].resolve(data);
  assert.equal(await pending, null); assert.equal(f.audio.grainFile, null);
  const staleFailure = f.audio.loadGrainFile(f.file("cancelled-error.wav")); await f.tick();
  f.audio.clearGrainFile(); f.decodes[4].reject(new Error("late decode failure"));
  assert.equal(await staleFailure, null);
});
