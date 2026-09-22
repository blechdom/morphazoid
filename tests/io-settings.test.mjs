import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_SETTINGS, OUTPUT_LAYOUTS, IOAudioTest, IOMidiTest,
  normalizeSettings, loadSettings, saveSettings, describeMidi,
  dbToGain, gainToDb, measureSamples,
} from "../src/site/io-settings.js";
import { AudioOutputManager, AUDIO_OUTPUT_STORAGE_KEY } from "../src/audio-output-manager.js";

test("preferences are bounded and never store session activation or monitoring", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  const value = normalizeSettings({
    layout: "__proto__", outputDb: 100, inputDb: -999, midiChannel: 80,
    inputId: { bad: true }, announce: false, monitoring: true, active: true,
  });
  assert.equal(value.layout, "stereo");
  assert.equal(value.outputDb, -12);
  assert.equal(value.inputDb, -24);
  assert.equal(value.midiChannel, 16);
  assert.equal(value.inputId, "");
  assert.equal(value.announce, false);
  assert.equal("monitoring" in value, false);
  assert.equal("active" in value, false);
  const stored = new Map();
  const runtime = { localStorage: { getItem: (k) => stored.get(k), setItem: (k, v) => stored.set(k, v) } };
  assert.equal(saveSettings(value, runtime), true);
  assert.deepEqual(loadSettings(runtime), value);
  assert.deepEqual(loadSettings({ get localStorage() { throw Error("blocked"); } }), DEFAULT_SETTINGS);
  assert.equal(saveSettings(value, {}), false);
});

test("channel conventions and peak measurement remain explicit", () => {
  assert.deepEqual(Object.values(OUTPUT_LAYOUTS).map((c) => c.length), [1, 2, 4, 6, 8]);
  assert.deepEqual(OUTPUT_LAYOUTS["5.1"].map((c) => c.short), ["L", "R", "C", "LFE", "RL", "RR"]);
  assert.deepEqual(OUTPUT_LAYOUTS["7.1"].map((c) => c.short), ["L", "R", "C", "LFE", "RL", "RR", "SL", "SR"]);
  assert.equal(gainToDb(0), -96);
  assert.ok(Math.abs(gainToDb(dbToGain(-24)) + 24) < 1e-9);
  assert.deepEqual(measureSamples([0, -1, 1, 0]), { peak: 1, rms: Math.sqrt(0.5), clipped: true });
  assert.deepEqual(measureSamples([NaN, Infinity, 0]), { peak: 0, rms: 0, clipped: false });
});

test("MIDI descriptions handle zero-velocity releases, bend, channels and quiet realtime streams", () => {
  assert.equal(describeMidi([0x92, 60, 100]).channel, 3);
  assert.match(describeMidi([0x92, 60, 100]).text, /Note on · C4 \(60\) · velocity 100/);
  assert.equal(describeMidi([0x90, 60, 0]).announce, false);
  assert.equal(describeMidi([0x80, 60, 64]).announce, false);
  assert.equal(describeMidi([0xf8]).announce, false);
  assert.equal(describeMidi([0xfe]).announce, false);
  assert.equal(describeMidi([0xf1, 0]).announce, false);
  assert.equal(describeMidi([0xe0, 0, 64]).text, "Pitch bend · 0");
  assert.equal(describeMidi([0xb0, 7, 99]).hex, "B0 07 63");
});

function midiFixture(request) {
  class Port extends EventTarget {
    constructor(id) { super(); this.id = id; this.name = id; this.state = "connected"; this.closed = 0; this.sent = []; }
    close() { this.closed++; return Promise.resolve(); }
    clear() { this.cleared = true; }
    send(data, time) { this.sent.push({ data, time }); }
    message(data) {
      const event = new Event("midimessage");
      event.data = data;
      this.dispatchEvent(event);
    }
  }
  const a = new Port("a"), b = new Port("b"), out = new Port("out");
  const access = new EventTarget();
  access.inputs = new Map([["a", a], ["b", b]]);
  access.outputs = new Map([["out", out]]);
  const messages = [], requests = [], timers = new Map();
  const runtime = {
    navigator: { requestMIDIAccess: (options) => { requests.push(options); return request ? request(access) : Promise.resolve(access); } },
    performance: { now: () => 1000 },
    setTimeout: (fn) => { timers.set(1, fn); return 1; },
    clearTimeout: (id) => timers.delete(id),
  };
  const midi = new IOMidiTest(runtime, (message) => messages.push(message));
  return { midi, a, b, out, access, messages, requests, timers };
}

test("MIDI input selection/channel filter, disconnect/reconnect and disable", async () => {
  const f = midiFixture();
  assert.equal(f.requests.length, 0);
  await f.midi.enable();
  assert.deepEqual(f.requests, [{ sysex: false }]);
  f.midi.selectInput("a");
  f.midi.channel = 3;
  f.a.message([0x91, 60, 100]);
  f.b.message([0x92, 60, 100]);
  f.a.message([0x92, 60, 100]);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].name, "a");
  f.a.state = "disconnected";
  f.access.dispatchEvent(new Event("statechange"));
  f.a.message([0x92, 60, 100]);
  assert.equal(f.messages.length, 1);
  f.a.state = "connected";
  f.access.dispatchEvent(new Event("statechange"));
  f.a.message([0x92, 61, 100]);
  assert.equal(f.messages.length, 2);
  f.midi.disable();
  f.a.message([0x92, 62, 100]);
  assert.equal(f.messages.length, 2);
  assert.equal(f.midi.inputs.size, 0);
});

test("MIDI outputs only explicit bounded notes and stop releases the original port/channel", async () => {
  const f = midiFixture();
  await f.midi.enable();
  assert.throws(() => f.midi.testNote(), /Choose/);
  assert.equal(f.out.sent.length, 0);
  f.midi.selectOutput("out");
  f.midi.testNote(5);
  assert.deepEqual(f.out.sent, [
    { data: [0x94, 60, 64], time: undefined },
    { data: [0x84, 60, 0], time: 1250 },
  ]);
  f.midi.selectOutput("");
  assert.deepEqual(f.out.sent.at(-1).data, [0x84, 60, 0]);
  assert.equal(f.out.cleared, true);
  assert.equal(f.timers.size, 0);
  f.midi.disable();
});

test("cancelled MIDI permission cannot attach late input listeners", async () => {
  let resolve;
  const f = midiFixture((access) => new Promise((r) => { resolve = () => r(access); }));
  const pending = f.midi.enable();
  f.midi.disable();
  resolve();
  await pending;
  assert.equal(f.midi.access, null);
  assert.equal(f.midi.inputs.size, 0);
  assert.ok(f.a.closed > 0);
  f.a.message([0x90, 60, 100]);
  assert.equal(f.messages.length, 0);
});

test("late microphone permission is released without constructing an audio graph", async () => {
  let resolve;
  let stops = 0;
  const stream = { getTracks: () => [{ stop: () => stops++ }] };
  const audio = new IOAudioTest({
    navigator: { mediaDevices: { getUserMedia: () => new Promise((r) => { resolve = r; }) } },
  });
  audio.context = { state: "running" };
  const pending = audio.startMic();
  audio.stopMic();
  resolve(stream);
  assert.equal(await pending, false);
  assert.equal(stops, 1);
  assert.equal(audio.mic, null);
});

test("shared output selection is persisted, restores without arming, and ignores storage in WAX", async () => {
  const stored = new Map();
  const runtime = {
    AudioContext: class { setSinkId() {} },
    localStorage: { getItem: (k) => stored.get(k), setItem: (k, v) => stored.set(k, v) },
  };
  const manager = new AudioOutputManager(runtime);
  assert.equal(await manager.setOutputDevice("interface-8ch"), true);
  assert.equal(stored.get(AUDIO_OUTPUT_STORAGE_KEY), "interface-8ch");
  const restored = new AudioOutputManager(runtime);
  assert.equal(restored.selectedOutputId, "interface-8ch");
  assert.equal(restored.contexts.size, 0);
  const unavailable = new AudioOutputManager({ ...runtime, AudioContext: class {} });
  assert.equal(unavailable.outputStatus().selectedId, "");
  assert.equal(unavailable.outputStatus().label, "System default");
  const host = new AudioOutputManager({ ...runtime, MorphazoidWAX: {} });
  assert.equal(host.selectedOutputId, "");
  assert.equal(await host.setOutputDevice("other"), false);
  assert.equal(stored.get(AUDIO_OUTPUT_STORAGE_KEY), "interface-8ch");
});

test("bundled original announcement is non-silent bounded mono PCM, not a speech service", async () => {
  const wav = await readFile(new URL("../assets/audio/midi-received.wav", import.meta.url));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 11025);
  assert.equal(wav.readUInt16LE(34), 16);
  const samples = [];
  for (let i = 44; i < wav.length; i += 2) samples.push(wav.readInt16LE(i) / 32768);
  const metrics = measureSamples(samples);
  assert.ok(metrics.peak < 0.65 && metrics.peak > 0.5);
  assert.ok(metrics.rms > 0.05);
  assert.ok(samples.length / 11025 > 0.8 && samples.length / 11025 < 3);
});
