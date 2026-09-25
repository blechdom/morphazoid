import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SEQUENCER_VOICES, loadSequencerVoiceKernels, renderSequencerVoice } from "../src/sequencer-voice-renderer.js";
import { SequencerVoiceBank } from "../src/sequencer-voices.js";

const runtime = {
  WebAssembly, setTimeout,
  fetch: async (url) => ({ ok: true, arrayBuffer: async () => {
    const bytes = await readFile(fileURLToPath(url));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } }),
};
const kernels = await loadSequencerVoiceKernels(runtime);
const rms = (samples) => Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
const distance = (a, b) => Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0) / a.length);
const magnitude = (samples, frequency, sampleRate) => {
  let real = 0, imaginary = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const angle = Math.PI * 2 * frequency * i / sampleRate;
    real += samples[i] * Math.cos(angle);
    imaginary += samples[i] * Math.sin(angle);
  }
  return Math.hypot(real, imaginary) / samples.length;
};

test("every shared voice produces finite bounded non-silent deterministic samples", () => {
  assert.equal(kernels.backends.synth, "simd");
  assert.equal(kernels.backends.acid, "simd");
  assert.deepEqual(kernels.failures, []);
  const fingerprints = [];
  for (const voice of SEQUENCER_VOICES) {
    const options = { voice: voice.id, sampleRate: 24000, frequency: 220, brightness: .55, seed: 77 };
    const first = renderSequencerVoice(options, kernels);
    const second = renderSequencerVoice(options, kernels);
    assert.deepEqual(first.samples, second.samples, voice.id);
    assert.ok(first.samples.every(Number.isFinite), voice.id);
    assert.ok(first.samples.every((n) => Math.abs(n) <= .651), voice.id);
    assert.ok(rms(first.samples) > .005, voice.id);
    assert.equal(first.loop, voice.kind === "synth");
    if (voice.engine.startsWith("simd")) assert.equal(first.backend, "simd");
    fingerprints.push(Array.from(first.samples.slice(120, 152)).map((n) => n.toFixed(4)).join(","));
  }
  assert.equal(new Set(fingerprints).size, SEQUENCER_VOICES.length);
});

test("SIMD Chiptune and 303 retain musical pitch and respond to brightness", () => {
  for (const voice of ["simd-chiptune", "simd-303"]) {
    const dark = renderSequencerVoice({ voice, frequency: 220, brightness: .1 }, kernels);
    const bright = renderSequencerVoice({ voice, frequency: 220, brightness: .95 }, kernels);
    assert.ok(distance(dark.samples, bright.samples) > .025, voice);
    const fundamental = magnitude(bright.samples, bright.frequency, bright.sampleRate);
    const wrongNote = magnitude(bright.samples, bright.frequency * 2 ** (1 / 12), bright.sampleRate);
    assert.ok(fundamental > wrongNote * 2, `${voice}: expected requested pitch`);
    assert.ok(bright.loopStart > 0 && bright.loopEnd > bright.loopStart);
  }
});

test("scalar fallback uses actual WASM and missing engines report a native fallback", async () => {
  const scalar = await loadSequencerVoiceKernels(runtime, { forceScalar: true });
  assert.deepEqual(scalar.backends, { synth: "scalar", acid: "scalar" });
  for (const voice of ["simd-chiptune", "simd-303", "simd-synth"]) {
    const rendered = renderSequencerVoice({ voice, sampleRate: 24000 }, scalar);
    assert.equal(rendered.backend, "scalar");
    assert.ok(rms(rendered.samples) > .01);
  }
  const missing = await loadSequencerVoiceKernels({ WebAssembly, fetch: async () => { throw new Error("offline"); } });
  assert.equal(missing.failures.length, 2);
  const rendered = renderSequencerVoice({ voice: "simd-chiptune" }, missing);
  assert.equal(rendered.backend, "native-fallback");
  assert.ok(rms(rendered.samples) > .01);
});

class Param {
  constructor() { this.value = 0; this.events = []; }
  setValueAtTime(value, when) { this.value = value; this.events.push(["set", value, when]); }
  linearRampToValueAtTime(value, when) { this.events.push(["linear", value, when]); }
  exponentialRampToValueAtTime(value, when) { this.events.push(["exponential", value, when]); }
  setTargetAtTime(value, when, constant) { this.events.push(["target", value, when, constant]); }
  cancelAndHoldAtTime(when) { this.events.push(["hold", when]); }
  cancelScheduledValues(when) { this.events.push(["cancel", when]); }
}
class Node {
  constructor() { this.gain = new Param(); this.pan = new Param(); this.frequency = new Param(); this.Q = new Param(); this.playbackRate = new Param(); this.connections = []; this.stops = []; }
  connect(destination) { this.connections.push(destination); return destination; }
  disconnect() { this.disconnected = true; this.connections = []; }
  start(when) { this.started = when; }
  stop(when) { this.stops.push(when); }
}
const context = () => ({
  state: "running", currentTime: 12, sampleRate: 24000, destination: new Node(),
  createdSources: [], closeCalls: 0, resumeCalls: 0,
  createGain: () => new Node(), createWaveShaper: () => new Node(),
  createBiquadFilter: () => new Node(), createStereoPanner: () => new Node(),
  createBufferSource() { const source = new Node(); this.createdSources.push(source); return source; },
  createBuffer(_channels, length, sampleRate) { const samples = new Float32Array(length); return { length, sampleRate, getChannelData: () => samples }; },
  close() { this.closeCalls += 1; }, resume() { this.resumeCalls += 1; },
});

test("bank shares explicit context, schedules exact notes and maps all sound controls", async () => {
  const audio = context();
  const bank = new SequencerVoiceBank({ runtime, maxVoices: 2 });
  assert.equal(bank.trigger({ voice: "simd-303" }), null);
  await bank.prepare(audio);
  assert.equal(audio.closeCalls, 0);
  assert.equal(audio.resumeCalls, 0);
  assert.equal(bank.diagnostics().templates, SEQUENCER_VOICES.length * 3);
  assert.ok(bank.diagnostics().cacheBytes < 12 * 1024 * 1024);
  const handle = bank.trigger({ voice: "simd-chiptune", when: 12.125, frequency: 880, duration: .35, velocity: .7, pan: -.6, attack: .025, release: .1, cutoff: 3000, resonance: 7, drive: 2.5, character: .8 });
  assert.equal(handle.source.started, 12.125);
  assert.equal(handle.source.loop, true);
  assert.equal(handle.pan.pan.value, -.6);
  assert.equal(handle.filter.Q.value, 7);
  assert.equal(handle.driveGain.gain.value, 2.5);
  assert.ok(handle.filter.frequency.events.some(([kind, value]) => kind === "exponential" && value === 3000));
  assert.ok(handle.gain.gain.events.some(([kind, _value, when]) => kind === "linear" && Math.abs(when - 12.15) < 1e-8));
  assert.equal(handle.stopAt, 12.125 + .35 + .1 + .002);
  assert.ok(Math.abs(handle.source.playbackRate.value * bank.cache.get("simd-chiptune:1").frequency - 880) < .001);
  const cold = bank.trigger({ voice: "simd-chiptune", character: 0 });
  assert.notDeepEqual(cold.shaper.curve, handle.shaper.curve);
  bank.trigger({ voice: "simd-303" });
  assert.equal(bank.diagnostics().activeVoices, 2);
  assert.equal(bank.diagnostics().stolen, 1);
  bank.setMuted(true);
  assert.equal(bank.diagnostics().activeVoices, 0);
  assert.equal(bank.trigger({ voice: "simd-303" }), null);
  bank.setMuted(false);
  assert.equal(bank.trigger({ voice: "simd-303", when: 1 }), null);
  bank.dispose();
  assert.equal(bank.diagnostics().cacheBytes, 0);
  assert.equal(audio.closeCalls, 0);
});

test("disposal cancels preparation and cannot revive a detached bank", async () => {
  const audio = context();
  let release;
  const blockedRuntime = { ...runtime, fetch: async (url) => { await new Promise((resolve) => { release = resolve; }); return runtime.fetch(url); } };
  const bank = new SequencerVoiceBank({ runtime: blockedRuntime });
  const pending = bank.prepare(audio);
  bank.dispose();
  // Both kernels load sequentially; release their fetches without waiting on DSP.
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(bank.context, null);
  assert.equal(bank.kernels, null);
  assert.equal(bank.ready, false);
});
