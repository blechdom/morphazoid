import assert from "node:assert/strict";
import test from "node:test";
import { audioInputConstraints, loadAudioInputSettings, saveAudioInputSettings, configureAudioInputNode, audioInputDescription } from "../src/audio-input-settings.js";
import { MicmicGenerationDSP } from "../src/families/mic-branch/micmic-generation-dsp.js";
import { SignalsmithGenerationMixerDSP } from "../src/families/signalsmith-generation/signalsmith-generation-mixer-dsp.js";
import { SignalsmithGenerationBank } from "../src/families/signalsmith-generation/signalsmith-generation-bank.js";

test("shared capture settings select an interface and true stereo without altering effect gain or arming", () => {
  const data = new Map();
  const runtime = { localStorage: { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v) } };
  assert.equal(saveAudioInputSettings({ inputId: "line-1-2", inputChannels: 2, inputDb: 18, active: true }, runtime), true);
  assert.deepEqual(loadAudioInputSettings(runtime), { inputId: "line-1-2", inputChannels: 2, echoCancellation: false });
  assert.deepEqual(audioInputConstraints(runtime), {
    video: false,
    audio: {
      deviceId: { exact: "line-1-2" }, channelCount: { ideal: 2 },
      echoCancellation: { ideal: false }, noiseSuppression: { ideal: false }, autoGainControl: { ideal: false },
    },
  });
  const node = {};
  configureAudioInputNode(node, runtime);
  assert.deepEqual(node, { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" });
  assert.equal(audioInputConstraints({ ...runtime, MorphazoidWAX: {} }).audio.deviceId, undefined);
  assert.equal(audioInputDescription({ getAudioTracks: () => [{ label: "Interface", getSettings: () => ({ channelCount: 2 }) }] }), "Interface · stereo");
  assert.equal(audioInputDescription({ getAudioTracks: () => [{ label: "Mic", getSettings: () => ({ channelCount: 1 }) }] }), "Mic · mono");
});

function stereoProbe(renderer, mixer = false, rate = 1) {
  renderer.setVoices([{ key: "one", sourceIndex: 0, delay: 0.025, rate, gain: 0.5, pan: 0 }]);
  const left = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i * 0.23) * 0.2);
  const right = Float32Array.from(left, (v) => -v);
  const outL = new Float32Array(left.length), outR = new Float32Array(left.length);
  if (mixer) renderer.process([left], outL, outR, [right]);
  else renderer.process(left, right, outL, outR);
  assert.ok(outL.some((v) => Math.abs(v) > 0.01), "opposite-phase stereo must not cancel into mono");
  for (let i = 0; i < outL.length; i++) assert.ok(Math.abs(outL[i] + outR[i]) < 1e-6);

  // A new left-only render has no right leakage, including pitched grains.
  const other = mixer
    ? new SignalsmithGenerationMixerDSP({ sampleRate: 8000, historySeconds: 4, maxInputs: 1, channels: 2 })
    : new MicmicGenerationDSP({ sampleRate: 8000, historySeconds: 4, channels: 2 });
  other.setVoices([{ key: "one", sourceIndex: 0, delay: 0.025, rate, gain: 0.5, pan: 0 }]);
  outL.fill(0); outR.fill(0);
  if (mixer) other.process([left], outL, outR, [new Float32Array(left.length)]);
  else other.process(left, new Float32Array(left.length), outL, outR);
  assert.ok(outL.some((v) => Math.abs(v) > 0.01));
  assert.ok(outR.every((v) => v === 0), "silent right input must remain silent");
}

test("L-system Economy/granular preserves anti-phase and channel separation at neutral and shifted pitch", () => {
  for (const rate of [1, 2, 0.5]) {
    stereoProbe(new MicmicGenerationDSP({ sampleRate: 8000, historySeconds: 4, channels: 2 }), false, rate);
  }
  assert.equal(new MicmicGenerationDSP({ sampleRate: 8000, historySeconds: 4 }).historyRight, null, "mono retains original allocation");
});

test("L-system Silky mixer keeps separate pitch histories for both input channels", () => {
  stereoProbe(new SignalsmithGenerationMixerDSP({ sampleRate: 8000, historySeconds: 4, maxInputs: 1, channels: 2 }), true);
  assert.equal(new SignalsmithGenerationMixerDSP({ sampleRate: 8000, historySeconds: 4 }).rightHistories, null);
});

test("Silky creates stereo pitch slots and a stereo history mixer when selected", async () => {
  const options = [];
  const node = () => ({ connect() {}, disconnect() {}, configure() {}, stop() {}, port: { postMessage() {}, start() {}, close() {} } });
  const bank = await SignalsmithGenerationBank.create({ currentTime: 0 }, node(), node(), {
    channels: 2, maxPitchSources: 2, historySeconds: 4,
    stretchFactory: async (_context, configuration) => { options.push(configuration); return node(); },
    mixerFactory: async (_context, configuration) => { options.push(configuration); return node(); },
  });
  assert.equal(options[0].channels, 2);
  assert.deepEqual(options.slice(1).map((option) => option.outputChannelCount), [[2], [2]]);
  await bank.dispose();
});

test("Graph Delay keeps independent stereo grain history and phase-coherent anti-phase input", async () => {
  let Processor;
  globalThis.sampleRate = 8000;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
  globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
  await import("../src/instruments/graph-delay/graph-turn-processor.js?stereo-test");
  for (const semitones of [0, 7, -12]) {
    const processor = new Processor({ processorOptions: { sourceCount: 1, outputCount: 1, channels: 2 } });
    processor.port.onmessage({ data: { type: "turns", semitones: [[semitones]] } });
    let peak = 0;
    for (let block = 0; block < 80; block++) {
      const left = Float32Array.from({ length: 128 }, (_, i) => Math.sin((block * 128 + i) * 0.15) * 0.2);
      const right = Float32Array.from(left, (v) => -v);
      const output = [new Float32Array(128), new Float32Array(128)];
      processor.process([[left, right]], [output]);
      for (let i = 0; i < 128; i++) {
        peak = Math.max(peak, Math.abs(output[0][i]));
        assert.ok(Math.abs(output[0][i] + output[1][i]) < 1e-6);
      }
    }
    assert.ok(peak > 0.01, `pitch ${semitones} must not cancel stereo input`);
  }
  delete globalThis.AudioWorkletProcessor;
  delete globalThis.registerProcessor;
  delete globalThis.sampleRate;
});
