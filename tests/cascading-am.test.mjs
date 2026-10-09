import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CASCADING_AM_DEFAULTS, CASCADING_AM_PRESETS, CASCADING_AM_PROCESSOR_NAME,
  CascadingAmAudioEngine, CascadingAmProcessor,
  advanceCascadePhases, bandwidthSafeModulationDepth, cascadeModulationDepth,
  cascadeRatioForStageCount, deriveCascadeStack, evaluateAmplitudeCascade,
  modulationDepthSliderPosition, modulationDepthSliderValue,
  renderCascadingAmSamples, sanitizeCascadingAmSettings,
} from "../src/instruments/cascading-am/cascading-am.js";
import { CASCADING_PM_PRESETS } from "../src/instruments/cascading-pm/cascading-pm.js";
import { CASCADING_AM_FULL_PRESETS, randomizeCascadingAmPreset } from "../src/instruments/cascading-am/full-presets.js";

const ROOT = new URL("../", import.meta.url);
const TAU = 2 * Math.PI;
const near = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
const projection = (samples, hz, sr = 48000) => {
  let real = 0, imag = 0;
  for (let i = 0; i < samples.length; i++) {
    real += samples[i] * Math.cos(TAU * hz * i / sr);
    imag += samples[i] * Math.sin(TAU * hz * i / sr);
  }
  return 2 * Math.hypot(real, imag) / samples.length;
};

function renderWorklet(settings, frames, sr = 48000) {
  const previous = globalThis.sampleRate;
  globalThis.sampleRate = sr;
  try {
    const processor = new CascadingAmProcessor({ processorOptions: { settings } });
    const samples = new Float32Array(frames);
    assert.equal(processor.process([], [[samples]]), true);
    return { processor, samples };
  } finally {
    if (previous === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previous;
  }
}

test("AM preserves stable preset IDs and output levels with immediate AM-specific voicings", () => {
  assert.deepEqual(CASCADING_AM_PRESETS.map(p => p.id), CASCADING_PM_PRESETS.map(p => p.id));
  assert.equal(new Set(CASCADING_AM_PRESETS.map(p => p.label)).size, 12);
  for (const [i, preset] of CASCADING_AM_PRESETS.entries()) {
    const original = CASCADING_PM_PRESETS[i];
    assert.equal(preset.level, original.level);
    const stack = deriveCascadeStack(preset.settings);
    const carrier = stack.oscillators.at(-1).frequencyHz;
    assert.ok(carrier >= 240 && carrier <= 1400, `${preset.id}: carrier must be clear above the sub-bass register`);
    assert.ok(preset.settings.rootHz >= 2, `${preset.id}: no slow evolution required`);
    assert.deepEqual(sanitizeCascadingAmSettings(preset.settings), preset.settings);
    assert.ok(Object.isFrozen(preset.settings));
    assert.deepEqual(CASCADING_AM_FULL_PRESETS[i].snapshot.settings, preset.settings);
  }
});

test("factory presets speak in the first quarter-second with substantial AM sidebands", () => {
  const sampleRate = 8000;
  for (const preset of CASCADING_AM_PRESETS) {
    const samples = renderCascadingAmSamples(preset.settings, { sampleRate, frameCount: sampleRate });
    const carrier = deriveCascadeStack(preset.settings).oscillators.at(-1).frequencyHz;
    const carrierAmplitude = projection(samples, carrier, sampleRate);
    assert.ok(rms(samples.subarray(0, sampleRate / 4)) > 0.25, `${preset.id}: immediate sound`);
    assert.ok(carrierAmplitude > 0.45, `${preset.id}: audible carrier survives modulation`);
    assert.ok(20 * Math.log10(rms(samples) * 0.7 * preset.level * 0.82) > -24, `${preset.id}: useful starting level`);
    const sidebandPower = 1 - carrierAmplitude ** 2 / (2 * rms(samples) ** 2);
    assert.ok(sidebandPower > 0.08, `${preset.id}: substantial modulation, not a nearly dry sine`);
    if (preset.settings.stages !== 2 || preset.settings.rootHz >= 20) continue;
    const envelope = [];
    const window = sampleRate * 0.02;
    for (let start = 0; start + window <= samples.length; start += window) {
      envelope.push(rms(samples.subarray(start, start + window)));
    }
    envelope.sort((a, b) => a - b);
    const contrastDb = 20 * Math.log10(envelope[Math.floor(envelope.length * 0.9)]
      / envelope[Math.floor(envelope.length * 0.1)]);
    assert.ok(contrastDb >= 8, `${preset.id}: ${contrastDb.toFixed(2)} dB of amplitude movement`);
  }
});

test("hostile settings and all bounded stage counts remain finite across sample rates", () => {
  assert.deepEqual(sanitizeCascadingAmSettings(null), CASCADING_AM_DEFAULTS);
  const hostile = sanitizeCascadingAmSettings({ stages: 99, rootHz: -9, cascadeRatio: Infinity, modulationDepth: 999, depthTaper: -4 });
  assert.equal(hostile.stages, 12); assert.equal(hostile.modulationDepth, 1); assert.equal(hostile.rootHz, 0.02);
  for (const sr of [8000, 44100, 48000, 96000]) {
    for (const stages of [2, 6, 12]) {
      const settings = { stages, rootHz: 110, cascadeRatio: 200, modulationDepth: 1, depthTaper: 4 };
      const { samples } = renderWorklet(settings, 4096, sr);
      assert.ok(samples.every(v => Number.isFinite(v) && Math.abs(v) <= 1));
      assert.ok(rms(samples) > 0.05);
    }
  }
});

test("each biased multiplier preserves the carrier sign and stays bounded", () => {
  const settings = { stages: 4, rootHz: 1, cascadeRatio: 4, modulationDepth: 1, depthTaper: 1 };
  const phases = [-Math.PI / 2, Math.PI / 2, -0.6, 0.9];
  const { stageOutputs } = evaluateAmplitudeCascade(phases, settings);
  near(stageOutputs[1], 0);
  near(stageOutputs[2], Math.sin(phases[2]) / 2);
  for (let i = 1; i < phases.length; i++) {
    assert.ok(stageOutputs[i] * Math.sin(phases[i]) >= 0);
    assert.ok(Math.abs(stageOutputs[i]) <= Math.abs(Math.sin(phases[i])));
  }
  near(evaluateAmplitudeCascade([0, Math.PI / 2], { ...settings, stages: 2 }).output, 0.5);
});

test("100% AM keeps the carrier and adds the expected symmetric sidebands, unlike ring modulation", () => {
  const samples = renderCascadingAmSamples({ stages: 2, rootHz: 44, cascadeRatio: 10, modulationDepth: 1 }, { frameCount: 48000 });
  near(projection(samples, 440), 0.5, 1e-7);
  near(projection(samples, 396), 0.25, 1e-7);
  near(projection(samples, 484), 0.25, 1e-7);
  near(projection(samples, 44), 0, 1e-7);
  near(projection(samples, 528), 0, 1e-7);
});

test("zero depth is an exact dry carrier and modulation never changes phase increments", () => {
  const settings = { stages: 5, rootHz: 2, cascadeRatio: 4, modulationDepth: 0 };
  const dry = renderCascadingAmSamples(settings, { frameCount: 4096 });
  for (let i = 0; i < dry.length; i++) near(dry[i], Math.sin(TAU * 512 * i / 48000), 3e-8);
  assert.deepEqual(advanceCascadePhases([1, 2, 3, 4, 5], settings),
    advanceCascadePhases([1, 2, 3, 4, 5], { ...settings, modulationDepth: 1, depthTaper: 4 }));
  const dryRun = renderWorklet(settings, 4096), wetRun = renderWorklet({ ...settings, modulationDepth: 1 }, 4096);
  assert.deepEqual(dryRun.processor._phases, wetRun.processor._phases);
});

test("depth, depth taper and every upstream stage have an audible path without early depth saturation", () => {
  assert.ok(cascadeModulationDepth(0.7, 1.5, 1) < 1);
  assert.ok(cascadeModulationDepth(0.7, 1.5, 2) > cascadeModulationDepth(0.7, 1.5, 1));
  const settings = { stages: 5, rootHz: 3, cascadeRatio: 3, modulationDepth: 0.7, depthTaper: 1 };
  const baseline = renderCascadingAmSamples(settings, { frameCount: 48000 });
  for (const change of [{ modulationDepth: 0.1 }, { depthTaper: 0.4 }, { rootHz: 2 }, { cascadeRatio: 2.8 }, { stages: 4 }]) {
    const changed = renderCascadingAmSamples({ ...settings, ...change }, { frameCount: 48000 });
    assert.ok(rms(changed.map((v, i) => v - baseline[i])) > 0.01, JSON.stringify(change));
  }
  const phases = [0.3, 0.4, 0.5, 0.6, 0.7];
  const reference = evaluateAmplitudeCascade(phases, settings).output;
  for (let i = 0; i < phases.length; i++) {
    const altered = [...phases]; altered[i] += 0.8;
    assert.ok(Math.abs(evaluateAmplitudeCascade(altered, settings).output - reference) > 1e-5);
  }
});

test("stage-count edits preserve the carrier frequency and depth sliders round trip", () => {
  for (let stages = 2; stages <= 12; stages++) {
    const ratio = cascadeRatioForStageCount(3, 5, stages);
    near(0.5 * ratio ** (stages - 1), 0.5 * 3 ** 4, 1e-10);
  }
  for (const depth of [0, 0.01, 0.5, 1]) near(modulationDepthSliderValue(modulationDepthSliderPosition(depth)), depth);
});

test("AM suppresses sidebands before Nyquist with smooth, depth-independent frequency headroom", () => {
  assert.equal(bandwidthSafeModulationDepth(1, 1000, 500, 21600), 1);
  assert.equal(bandwidthSafeModulationDepth(1, 20000, 2000, 21600), 0);
  const nearEdge = bandwidthSafeModulationDepth(1, 20000, 1000, 21600);
  assert.ok(nearEdge > 0 && nearEdge < 1);
  near(bandwidthSafeModulationDepth(0.25, 20000, 1000, 21600), 0.25 * nearEdge);
});

test("offline and audio-thread rendering agree for presets and headroom transitions", () => {
  const cases = [...CASCADING_AM_PRESETS.map(p => p.settings),
    { stages: 3, rootHz: 110, cascadeRatio: 12.5, modulationDepth: 0.8, depthTaper: 1.2 },
    { stages: 12, rootHz: 110, cascadeRatio: 200, modulationDepth: 1 }];
  for (const sr of [8000, 44100, 48000]) {
    for (const settings of cases) {
      const actual = renderWorklet(settings, 2048, sr).samples;
      const expected = renderCascadingAmSamples(settings, { sampleRate: sr, frameCount: 2048 });
      assert.ok(actual.every((sample, index) => sample === expected[index]),
        "worklet and reference samples agree, including equivalent signed silence");
    }
  }
});

test("all presets produce bounded audio and every ordered preset transition retains storage and continuity", () => {
  for (const from of CASCADING_AM_PRESETS) {
    const steady = renderCascadingAmSamples(from.settings, { frameCount: 48000 });
    assert.ok(rms(steady) > 0.1, from.id);
    assert.ok(steady.every(v => Number.isFinite(v) && Math.abs(v) <= 1));
    for (const to of CASCADING_AM_PRESETS) {
      const { processor } = renderWorklet(from.settings, 5000);
      const unchanged = renderWorklet(from.settings, 5000).processor;
      const nextUnchangedSample = new Float32Array(1);
      unchanged.process([], [[nextUnchangedSample]]);
      const storage = Object.entries(processor).filter(([, v]) => ArrayBuffer.isView(v));
      processor.port.onmessage({ data: { type: "settings", settings: to.settings } });
      const transition = new Float32Array(4096);
      processor.process([], [[transition]]);
      assert.ok(transition.every(v => Number.isFinite(v) && Math.abs(v) <= 1));
      // Compare against the next unedited sample: a bright carrier has a large
      // natural inter-sample slope which must not be mistaken for a preset click.
      assert.ok(Math.abs(transition[0] - nextUnchangedSample[0]) < 0.02, `${from.id} -> ${to.id}`);
      for (const [name, value] of storage) assert.equal(processor[name], value);
      near(processor._tapGains.reduce((sum, v) => sum + v, 0), 1);
    }
  }
});

test("worklet shutdown stops rendering and randomization preserves level while varying every musical field", () => {
  const { processor } = renderWorklet(CASCADING_AM_DEFAULTS, 1);
  processor.port.onmessage({ data: { type: "shutdown" } });
  assert.equal(processor.process([], [[new Float32Array(128)]]), false);
  let seed = 27;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const values = Object.fromEntries(Object.keys(CASCADING_AM_DEFAULTS).map(k => [k, new Set()]));
  for (let i = 0; i < 64; i++) {
    const result = randomizeCascadingAmPreset({ level: 0.39 }, random);
    assert.equal(Object.hasOwn(result, "level"), false, "master output is not preset-owned");
    assert.equal(result.activePresetId, null);
    const stack = deriveCascadeStack(result.settings);
    assert.ok(stack.oscillators.at(-1).frequencyHz >= 240 - 1e-8);
    assert.ok(stack.oscillators.at(-1).frequencyHz <= 1400 + 1e-8);
    assert.ok(result.settings.rootHz >= 2);
    for (const [key, value] of Object.entries(result.settings)) values[key].add(value);
  }
  for (const [key, observed] of Object.entries(values)) assert.ok(observed.size > 1, key);
});

test("AM page retains the original control layout and lifecycle with amplitude labels", async () => {
  const [html, original, app] = await Promise.all([
    readFile(new URL("src/pages/cascading-am.html", ROOT), "utf8"),
    readFile(new URL("src/pages/cascading-pm.html", ROOT), "utf8"),
    readFile(new URL("src/instruments/cascading-am/cascading-am-app.js", ROOT), "utf8"),
  ]);
  const controls = source => [...source.matchAll(/<(?:input|button)\b[^>]*id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(controls(html), controls(original).map(id => id.replace('phaseIndex', 'modulationDepth').replace('indexTaper', 'depthTaper').replace('Pm', 'Am')));
  assert.match(html, /<h1[^>]*>Cascading AM<\/h1>/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /0–100%/);
  assert.doesNotMatch(html, /phase index|radians|phase modulation/i);
  assert.match(app, /pagehide/); assert.match(app, /cascadeRatioForStageCount/);
  assert.match(app, /sᵢ = sin\(φᵢ\) × \(1 \+ dᵢsᵢ₋₁\) \/ \(1 \+ dᵢ\)/);
});
test("the audio owner is lazy and sends carrier-preserving AM settings to its worklet", async () => {
  class Parameter {
    constructor(value = 0) { this.value = value; }
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
  }
  class Node {
    constructor() { this.connections = []; }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.connections.length = 0; }
  }
  class Context {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.state = "suspended";
      this.destination = new Node();
      this.modules = [];
      this.audioWorklet = {
        addModule: async (url) => { this.modules.push(String(url)); },
      };
    }
    createBuffer() { return {}; }
    createBufferSource() {
      const node = new Node();
      node.start = () => {};
      node.buffer = null;
      node.onended = null;
      return node;
    }
    createGain() { const node = new Node(); node.gain = new Parameter(1); return node; }
    createDynamicsCompressor() {
      const node = new Node();
      for (const name of ["threshold", "knee", "ratio", "attack", "release"]) {
        node[name] = new Parameter();
      }
      return node;
    }
    createAnalyser() {
      const node = new Node();
      node.getByteTimeDomainData = (target) => target.fill(128);
      return node;
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  }
  const worklets = [];
  class Worklet extends Node {
    constructor(context, name, options) {
      super();
      this.context = context;
      this.name = name;
      this.options = options;
      this.messages = [];
      this.port = { postMessage: (message) => this.messages.push(message) };
      worklets.push(this);
    }
  }

  const runtime = {
    AudioContext: Context,
    AudioWorkletNode: Worklet,
    setTimeout: (callback) => callback(),
  };
  const engine = new CascadingAmAudioEngine(runtime);
  assert.equal(engine.context, null, "constructing the owner must not touch audio");
  const settings = CASCADING_AM_PRESETS[3].settings;
  await engine.start(settings, 0.43);
  assert.equal(engine.running, true);
  assert.equal(worklets.length, 1);
  assert.equal(worklets[0].name, CASCADING_AM_PROCESSOR_NAME);
  assert.deepEqual(worklets[0].options.outputChannelCount, [1]);
  assert.deepEqual(worklets[0].options.processorOptions, { settings });
  assert.match(engine.context.modules[0], /\/src\/instruments\/cascading-am\/cascading-am\.js$/);
  assert.deepEqual(worklets[0].messages.at(-1), {
    type: "settings",
    settings: sanitizeCascadingAmSettings(settings),
    immediate: true,
  });
  await engine.stop({ immediate: true });
  assert.equal(engine.context, null);
  assert.equal(engine.running, false);
});
