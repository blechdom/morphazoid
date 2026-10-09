import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_RECURSIVE_AM_PRESET_ID,
  RECURSIVE_AM_PRESETS,
  RecursiveAmAudioEngine,
  RecursiveAmProcessor,
  deriveRecursiveAmStack,
  recursiveAmModulationDepth,
  sanitizeRecursiveAmSettings,
} from "../src/instruments/recursive-am/recursive-am.js";
import {
  DEFAULT_RECURSIVE_PM_PRESET_ID,
  RECURSIVE_PM_PRESETS,
} from "../src/instruments/recursive-pm/recursive-pm.js";
import { RecursiveAmMidiPerformance } from "../src/instruments/recursive-am/recursive-am-midi.js";
import { RecursivePmMidiPerformance } from "../src/instruments/recursive-pm/recursive-pm-midi.js";

const SAMPLE_RATE = 48_000;
const TAU = 2 * Math.PI;
const probe = { depth: 3, carrierHz: 80, startModFrequencyHz: 300,
  frequencyDivisor: 1.6, startAmplitudeIndex: 4, indexDivisor: 1.3 };

function processorFor(settings) {
  const processor = new RecursiveAmProcessor();
  processor.port.onmessage({ data: { type: "settings", settings, immediate: true } });
  return processor;
}

function render(processor, count = 8192, blockSize = 128) {
  const result = new Float32Array(count);
  for (let offset = 0; offset < count; offset += blockSize) {
    const block = result.subarray(offset, Math.min(count, offset + blockSize));
    assert.equal(processor.process([], [[block]]), true);
  }
  return result;
}

function rmsDifference(a, b) {
  return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0) / a.length);
}

function spectralAmplitude(samples, hz) {
  let real = 0;
  let imaginary = 0;
  for (let n = 0; n < samples.length; n += 1) {
    real += samples[n] * Math.cos(TAU * hz * n / SAMPLE_RATE);
    imaginary += samples[n] * Math.sin(TAU * hz * n / SAMPLE_RATE);
  }
  return 2 * Math.hypot(real, imaginary) / samples.length;
}

test("AM preserves PM preset identities and topology while translating inaudible frequency spans", () => {
  assert.equal(DEFAULT_RECURSIVE_AM_PRESET_ID, DEFAULT_RECURSIVE_PM_PRESET_ID);
  for (const [index, preset] of RECURSIVE_AM_PRESETS.entries()) {
    const oldSettings = RECURSIVE_PM_PRESETS[index].settings;
    const { startPhaseIndex } = oldSettings;
    assert.equal(preset.id, RECURSIVE_PM_PRESETS[index].id);
    assert.equal(preset.label, RECURSIVE_PM_PRESETS[index].label);
    // PM's low-rate operators generate many high-order sidebands. AM cannot
    // copy those Hz values and remain audible, so test the preserved identity
    // and gesture contract separately from the AM-specific frequency voicing.
    assert.equal(preset.settings.depth, oldSettings.depth);
    assert.equal(preset.settings.carrierHz, oldSettings.carrierHz);
    assert.equal(preset.settings.startAmplitudeIndex, startPhaseIndex);
    assert.deepEqual(preset.settings, (({ maximumFrequencyHz, ...values }) => values)(
      sanitizeRecursiveAmSettings(preset.settings),
    ));
    const stack = deriveRecursiveAmStack(preset.settings);
    assert.equal(stack.actualDepth, preset.settings.depth);
    assert.equal(stack.audibleIndex, stack.actualDepth);
    for (let turn = 1; turn <= stack.actualDepth; turn += 1) {
      const operator = stack.operators[turn];
      assert.equal(operator.sourceIndex, turn - 1);
      assert.ok(Math.abs(operator.frequencyHz - preset.settings.startModFrequencyHz
        / preset.settings.frequencyDivisor ** (turn - 1)) < 1e-10);
      assert.ok(Math.abs(operator.amplitudeIndex - startPhaseIndex
        / preset.settings.indexDivisor ** (turn - 1)) < 1e-10);
      assert.ok(operator.modulationDepth >= 0 && operator.modulationDepth < 1);
    }
  }
});

// Exact finite AM spectrum: every turn contributes its carrier and multiplies
// the incoming finite spectrum by that sine. Unlike raw RMS, this separates
// actual audible energy from DC and infrasonic components without FFT leakage.
function amplitudeSpectrum(settings) {
  const stack = deriveRecursiveAmStack(settings);
  const add = (spectrum, frequency, real, imaginary) => {
    const key = Math.round(frequency * 1e8);
    const current = spectrum.get(key) ?? [0, 0];
    spectrum.set(key, [current[0] + real, current[1] + imaginary]);
  };
  let spectrum = new Map();
  add(spectrum, stack.operators[0].frequencyHz, 0, -0.5);
  add(spectrum, -stack.operators[0].frequencyHz, 0, 0.5);
  for (const operator of stack.operators.slice(1)) {
    const next = new Map();
    const gain = 1 / (1 + operator.modulationDepth);
    const sidebandGain = operator.modulationDepth * gain / 2;
    add(next, operator.frequencyHz, 0, -gain / 2);
    add(next, -operator.frequencyHz, 0, gain / 2);
    for (const [key, [real, imaginary]] of spectrum) {
      add(next, key / 1e8 + operator.frequencyHz,
        imaginary * sidebandGain, -real * sidebandGain);
      add(next, key / 1e8 - operator.frequencyHz,
        -imaginary * sidebandGain, real * sidebandGain);
    }
    spectrum = next;
  }
  return spectrum;
}

function audibleSpectrumRms(a, b = new Map()) {
  let energy = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const hz = Math.abs(key / 1e8);
    if (hz < 20 || hz > 20_000) continue;
    const [ar, ai] = a.get(key) ?? [0, 0];
    const [br, bi] = b.get(key) ?? [0, 0];
    energy += (ar - br) ** 2 + (ai - bi) ** 2;
  }
  return Math.sqrt(energy);
}

test("every translated preset has audible carrier energy and meaningful nested modulation", () => {
  for (const preset of RECURSIVE_AM_PRESETS) {
    const stack = deriveRecursiveAmStack(preset.settings);
    const carrier = stack.operators.at(-1).frequencyHz;
    assert.ok(carrier >= 45 && carrier <= 200, `${preset.id}: final carrier is audible`);
    const spectrum = amplitudeSpectrum(preset.settings);
    const audibleRms = audibleSpectrumRms(spectrum);
    assert.ok(audibleRms > 0.35, `${preset.id}: audible RMS ${audibleRms}`);
    const outputRms = audibleRms * stack.normalizedGain * 0.58 * 0.82;
    assert.ok(20 * Math.log10(outputRms) > -30, `${preset.id}: useful level after gain staging`);
    const drySpectrum = amplitudeSpectrum({ ...preset.settings, startAmplitudeIndex: 0 });
    assert.ok(audibleSpectrumRms(spectrum, drySpectrum) > 0.15,
      `${preset.id}: amplitude depth changes audible content`);
    const movedSeed = amplitudeSpectrum({ ...preset.settings, carrierHz: preset.settings.carrierHz * 1.5 });
    assert.ok(audibleSpectrumRms(spectrum, movedSeed) > 0.002,
      `${preset.id}: the initial seed still reaches the audible band`);
    const samples = render(processorFor(preset.settings), SAMPLE_RATE * 2);
    assert.ok(spectralAmplitude(samples, carrier) > 0.45,
      `${preset.id}: the actual worklet retains its audible carrier`);
  }
});

test("the audible-band check rejects copying the original sub-audio PM presets", () => {
  const original = RECURSIVE_PM_PRESETS.find(preset => preset.id === "glass-rotor");
  const { startPhaseIndex, ...settings } = original.settings;
  assert.equal(audibleSpectrumRms(amplitudeSpectrum({
    ...settings, startAmplitudeIndex: startPhaseIndex,
  })), 0);
});

test("AM sum-sidebands fade before aliasing during high MIDI transposition", () => {
  const processor = processorFor({ depth: 1, carrierHz: 1200,
    startModFrequencyHz: 400, frequencyDivisor: 1,
    startAmplitudeIndex: 20, indexDivisor: 1 });
  processor.port.onmessage({ data: { type: "note-pitch", pitchRatio: 48, immediate: true } });
  const samples = render(processor, SAMPLE_RATE);
  assert.ok(spectralAmplitude(samples, 19_200) > 0.99);
  assert.ok(spectralAmplitude(samples, 8_800) < 1e-6, "39.2kHz sum must not fold to 8.8kHz");
  assert.ok(spectralAmplitude(samples, 800) < 1e-6, "the guarded AM link is smoothly bypassed");
});

test("the displayed AM ledger matches the worklet inside its sideband headroom fade", () => {
  const settings = { depth: 3, carrierHz: 1100, startModFrequencyHz: 400,
    frequencyDivisor: 0.16, startAmplitudeIndex: 20, indexDivisor: 1 };
  const stack = deriveRecursiveAmStack(settings);
  assert.equal(stack.boundedByBandwidth, true);
  const guarded = stack.operators.at(-1);
  assert.ok(guarded.modulationDepth > 0 && guarded.modulationDepth < guarded.rawModulationDepth);
  const samples = render(processorFor(settings), 1024);
  for (let n = 0; n < samples.length; n += 1) {
    let expected = Math.sin(TAU * settings.carrierHz * (n + 1) / SAMPLE_RATE);
    for (const operator of stack.operators.slice(1)) {
      expected = Math.sin(TAU * operator.frequencyHz * (n + 1) / SAMPLE_RATE)
        * (1 + operator.modulationDepth * expected) / (1 + operator.modulationDepth);
    }
    assert.ok(Math.abs(samples[n] - expected) < 1e-6);
  }
});

test("crossing the recursive frequency ceiling fades the outgoing tap without resetting its phase", () => {
  const processor = processorFor({ depth: 2, carrierHz: 100,
    startModFrequencyHz: 100, frequencyDivisor: 0.1,
    startAmplitudeIndex: 3, indexDivisor: 1 });
  processor.port.onmessage({ data: { type: "note-pitch", pitchRatio: 19.999, immediate: true } });
  render(processor, 997);
  const outgoingPhase = processor.operatorPhases[1];
  processor.port.onmessage({ data: { type: "note-pitch", pitchRatio: 20.001, immediate: true } });
  const first = render(processor, 1)[0];
  const nextPhase = (outgoingPhase + 20_000 / SAMPLE_RATE) % 1;
  const continuingOutgoingSine = Math.sin(TAU * nextPhase);
  assert.ok(Math.abs(first - continuingOutgoingSine) < 0.005,
    "first sample must remain near the outgoing sine, not jump to the lower operator");
  assert.ok(processor.current.depth > 1.99 && processor.current.depth < 2);
  assert.ok(Math.abs(processor.operatorPhases[1] - nextPhase) < 1e-12);
  render(processor, SAMPLE_RATE / 10);
  assert.ok(Math.abs(processor.current.depth - 1) < 0.0001);
  processor.port.onmessage({ data: { type: "note-pitch", pitchRatio: 19.999, immediate: true } });
  render(processor, 1);
  assert.ok(processor.current.depth < 1.01, "returning turn also fades in");
  render(processor, SAMPLE_RATE / 10);
  assert.ok(Math.abs(processor.current.depth - 2) < 0.0001);
});

test("one AM turn preserves carrier and creates only the two expected sidebands", () => {
  const samples = render(processorFor({ ...probe, depth: 1,
    startModFrequencyHz: 400, startAmplitudeIndex: 3 }), SAMPLE_RATE);
  const depth = recursiveAmModulationDepth(3);
  const carrierAmplitude = 1 / (1 + depth);
  assert.ok(Math.abs(spectralAmplitude(samples, 400) - carrierAmplitude) < 1e-6);
  for (const sideband of [320, 480]) {
    assert.ok(Math.abs(spectralAmplitude(samples, sideband) - depth / (2 * (1 + depth))) < 1e-6);
  }
  for (const absent of [80, 160, 240, 560, 800]) {
    assert.ok(spectralAmplitude(samples, absent) < 1e-6, `${absent} Hz is not an AM sideband`);
  }
  for (let n = 0; n < samples.length; n += 1) {
    const carrier = Math.sin(TAU * 400 * (n + 1) / SAMPLE_RATE);
    assert.ok(samples[n] * carrier >= -1e-9, "positive AM gain never inverts the carrier");
  }
});

test("zero index returns the final independent sine; zero turns returns the seed", () => {
  for (const settings of [{ ...probe, depth: 0 }, { ...probe, startAmplitudeIndex: 0 }]) {
    const samples = render(processorFor(settings));
    const expectedHz = settings.depth === 0 ? settings.carrierHz
      : settings.startModFrequencyHz / settings.frequencyDivisor ** (settings.depth - 1);
    for (let n = 0; n < samples.length; n += 1) {
      assert.ok(Math.abs(samples[n] - Math.sin(TAU * expectedHz * (n + 1) / SAMPLE_RATE)) < 1e-6);
    }
  }
});

test("the operator ledger and sample renderer agree through every nested turn", () => {
  const settings = { ...probe, depth: 7, indexDivisor: 0.25 };
  const stack = deriveRecursiveAmStack(settings);
  const samples = render(processorFor(settings));
  for (let n = 0; n < samples.length; n += 1) {
    let expected = Math.sin(TAU * stack.operators[0].frequencyHz * (n + 1) / SAMPLE_RATE);
    for (const operator of stack.operators.slice(1)) {
      const carrier = Math.sin(TAU * operator.frequencyHz * (n + 1) / SAMPLE_RATE);
      expected = carrier * (1 + operator.modulationDepth * expected) / (1 + operator.modulationDepth);
    }
    assert.ok(Math.abs(samples[n] - expected) < 1e-6);
  }
});

test("index controls change amplitude without changing oscillator phase or frequency", () => {
  const plain = processorFor({ ...probe, startAmplitudeIndex: 0 });
  const nested = processorFor({ ...probe, startAmplitudeIndex: 20, indexDivisor: 0.01 });
  const a = render(plain);
  const b = render(nested);
  assert.ok(rmsDifference(a, b) > 0.1);
  assert.equal(plain.carrierPhase, nested.carrierPhase);
  assert.deepEqual(plain.operatorPhases, nested.operatorPhases);
});

test("all six synthesis controls remain consequential in the AM voice", () => {
  const baseline = render(processorFor(probe), SAMPLE_RATE);
  for (const [key, value] of Object.entries({ depth: 2, carrierHz: 139,
    startModFrequencyHz: 210, frequencyDivisor: 1.2, startAmplitudeIndex: 1,
    indexDivisor: 2.4 })) {
    const altered = render(processorFor({ ...probe, [key]: value }), SAMPLE_RATE);
    assert.ok(rmsDifference(baseline, altered) > 0.01, `${key} changes the rendered signal`);
  }
});

test("presets, expanding series, raw hostile messages and sample rates remain bounded", () => {
  const settings = [
    ...RECURSIVE_AM_PRESETS.map(preset => preset.settings),
    { ...probe, depth: 10, indexDivisor: 0.01, startAmplitudeIndex: 20 },
    { ...probe, depth: 10, frequencyDivisor: 0.01 },
    { depth: NaN, carrierHz: Infinity, startModFrequencyHz: -Infinity,
      frequencyDivisor: 0, startAmplitudeIndex: NaN, indexDivisor: -1, maximumFrequencyHz: NaN },
  ];
  const previousSampleRate = globalThis.sampleRate;
  try {
    for (const sampleRate of [8_000, 44_100, 48_000, 96_000]) {
      globalThis.sampleRate = sampleRate;
      for (const values of settings) {
        const samples = render(processorFor(values));
        for (const sample of samples) assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 1);
        assert.ok(samples.some(sample => Math.abs(sample) > 1e-6));
      }
    }
  } finally {
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
  const bounded = deriveRecursiveAmStack({ ...probe, depth: 10, frequencyDivisor: 0.01 });
  assert.ok(bounded.actualDepth < bounded.requestedDepth);
  assert.equal(bounded.boundedByFrequency, true);
  assert.equal(sanitizeRecursiveAmSettings({ startAmplitudeIndex: 99 }).startAmplitudeIndex, 20);
});

test("rendering is block-independent and live depth changes crossfade without restarting", () => {
  const a = render(processorFor(probe), 8192, 128);
  const b = render(processorFor(probe), 8192, 257);
  assert.deepEqual(a, b);
  const processor = processorFor({ ...probe, depth: 1 });
  const before = render(processor, 1000);
  processor.port.onmessage({ data: { type: "settings", settings: { depth: 8 } } });
  const after = render(processor, 8192);
  assert.ok(Math.abs(after[0] - before.at(-1)) < 0.08);
  assert.ok(processor.current.depth > 7.99);
  assert.ok(after.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  processor.port.onmessage({ data: { type: "shutdown" } });
  assert.equal(processor.process([], [[new Float32Array(128)]]), false);
});

test("MIDI note priority, sustain, expression and panic preserve PM performance behavior", () => {
  const am = new RecursiveAmMidiPerformance();
  const pm = new RecursivePmMidiPerformance();
  const actions = [
    { type: "noteOn", note: 60, velocity: 100, channel: 0, sourceId: "keyboard" },
    { type: "noteOn", note: 67, velocity: 80, channel: 0, sourceId: "keyboard" },
    { type: "pitchBend", normalized: 0.75 },
    { type: "controlChange", controller: 11, value: 63 },
    { type: "controlChange", controller: 64, value: 127 },
    { type: "noteOff", note: 67, channel: 0, sourceId: "keyboard" },
    { type: "noteOff", note: 60, channel: 0, sourceId: "keyboard" },
    { type: "controlChange", controller: 64, value: 0 },
    { type: "noteOn", note: 72, velocity: 127 },
    { type: "controlChange", controller: 120, value: 0 },
    { type: "controlChange", controller: 121, value: 0 },
  ];
  for (const action of actions) assert.deepEqual(am.handle(action), pm.handle(action));
});

test("note glide and pitch bend transpose free-running AM oscillators independently", () => {
  const processor = processorFor(probe);
  processor.port.onmessage({ data: { type: "note-pitch", pitchRatio: 2, glideSeconds: 0.1 } });
  render(processor, 2400);
  assert.ok(Math.abs(processor.currentNoteSemitones - 6) < 1e-10);
  processor.port.onmessage({ data: { type: "pitch-bend", bendSemitones: -2 } });
  render(processor, 2400);
  assert.equal(processor.currentNoteSemitones, 12);
  assert.equal(processor.currentBendSemitones, -2);
  assert.ok(Math.abs(processor.currentPitchRatio - 2 ** (10 / 12)) < 1e-10);
});

test("owned HTML retains every original control and wires AM model semantics", async () => {
  const [am, pm, app] = await Promise.all([
    readFile(new URL("../src/pages/recursive-am.html", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/recursive-pm.html", import.meta.url), "utf8"),
    readFile(new URL("../src/instruments/recursive-am/recursive-am-app.js", import.meta.url), "utf8"),
  ]);
  const controlIds = html => [...html.matchAll(/<(?:input|button|select)[^>]*\bid="([^"]+)"/g)]
    .map(match => match[1]);
  assert.deepEqual(controlIds(am), controlIds(pm).map(id => id
    .replace("phaseIndex", "amplitudeIndex").replace("RecursivePm", "RecursiveAm")));
  assert.match(app, /new RecursiveAmAudioEngine\(window\)/);
  assert.match(app, /pagehide/);
  assert.match(app, /AM GAIN/);
  assert.match(am, /unitless index/);
  assert.doesNotMatch(am, /sine’s phase|phase operators|phase index/i);
});

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  cancelScheduledValues(time) {
    this.events.push(["cancel", time]);
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push(["set", value, time]);
  }

  setTargetAtTime(value, time, constant) {
    this.value = value;
    this.events.push(["target", value, time, constant]);
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(["ramp", value, time]);
  }
}

class FakeNode {
  constructor() {
    this.connections = [];
    this.disconnected = false;
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeAudioWorkletNode extends FakeNode {
  constructor(context, name, options) {
    super();
    this.context = context;
    this.name = name;
    this.options = options;
    this.messages = [];
    this.port = {
      postMessage: (message) => {
        this.messages.push(message);
      },
    };
  }
}

class FakeAudioContext {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.sampleRate = 48_000;
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = new FakeNode();
    this.modules = [];
    this.audioWorklet = {
      addModule: async (url) => {
        this.modules.push(String(url));
      },
    };
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    const node = new FakeNode();
    node.gain = new FakeAudioParam();
    return node;
  }

  createDynamicsCompressor() {
    const node = new FakeNode();
    for (const name of [
      "threshold",
      "knee",
      "ratio",
      "attack",
      "release",
    ]) {
      node[name] = new FakeAudioParam();
    }
    return node;
  }

  createAnalyser() {
    const node = new FakeNode();
    node.fftSize = 0;
    node.smoothingTimeConstant = 0;
    node.getByteTimeDomainData = (target) => target.fill(128);
    return node;
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.state = "closed";
  }
}

test("audio engine starts once, updates smoothly, analyses, and fully closes", async () => {
  FakeAudioContext.instances.length = 0;
  const runtime = {
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    setTimeout: (callback) => callback(),
  };
  const engine = new RecursiveAmAudioEngine(runtime);
  const firstSettings = RECURSIVE_AM_PRESETS[1].settings;

  await engine.start(firstSettings, 0.58);
  assert.equal(engine.running, true);
  assert.equal(engine.waveform.length, 512, "scope window matches Chaotic FM");
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.equal(engine.context.options.latencyHint, "interactive");
  assert.match(engine.context.modules[0], /src\/instruments\/recursive-am\/recursive-am\.js$/);
  assert.equal(engine.worklet.name, "morphazoid-recursive-am");
  assert.equal(engine.worklet.messages[0].type, "settings");
  assert.equal(engine.worklet.messages[0].immediate, true);
  assert.equal(engine.worklet.messages[0].settings.depth, 3);
  assert.equal(engine.readWaveform()[0], 128);

  const worklet = engine.worklet;
  engine.updateSettings({ ...firstSettings, depth: 8 });
  assert.equal(worklet.messages.at(-1).settings.depth, 8);
  assert.equal(worklet.messages.at(-1).immediate, false);
  await engine.start(firstSettings, 0.4);
  assert.equal(FakeAudioContext.instances.length, 1);

  await engine.stop({ immediate: true });
  assert.equal(engine.running, false);
  assert.equal(engine.context, null);
  assert.equal(FakeAudioContext.instances[0].state, "closed");
  assert.equal(worklet.messages.at(-1).type, "shutdown");
  assert.equal(worklet.disconnected, true);
});
