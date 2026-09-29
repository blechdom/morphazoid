import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  createGardenDSP, GARDEN_DEFAULTS, GARDEN_MAX_FRAMES, GARDEN_MAX_MODES, TINE_COUNT, ORIGINAL_PITCH_SPREAD, fillBankRidge, prepareGardenSettings, tineFrequency, sanitizeGardenSettings,
} from "../src/instruments/wasm-garden/dsp.js";

import { PRESETS, fillPitchProbabilities, choosePitch, randomizeGardenPreset } from '../src/instruments/wasm-garden/garden-model.js';
import { tineGeometry, materialPointer, bankPointer, bankSurfacePoint, prepareBankSurface } from '../src/instruments/wasm-garden/garden-view.js';

const bytes = await readFile(new URL("../assets/wasm/wasm-garden.wasm", import.meta.url));
const module = await WebAssembly.compile(bytes);
const make = (settings = {}, options = {}) => createGardenDSP({ module, settings: { model: 'tines', modes: 1024, baseFrequency: 82, decay: 4.5, dispersion: 0.7, brightness: 0.65, ...settings }, ...options });
const energy = (dsp) => {
  const bands = dsp.getEnergies(new Float32Array(32));
  return bands.reduce((sum, value) => sum + value * value, 0);
};
const render = (dsp, frames = 8192, backend = "wasm") => {
  const result = new Float32Array(frames * 2);
  for (let offset = 0; offset < frames; offset += 128) {
    const count = Math.min(128, frames - offset);
    const block = dsp.process(count, backend);
    result.set(block.left.subarray(0, count), offset);
    result.set(block.right.subarray(0, count), frames + offset);
  }
  return result;
};
const meanSquare = (samples) => samples.reduce((sum, value) => sum + value * value, 0) / samples.length;
function assertMatching(a, b, message) {
  assert.equal(a.length, b.length);
  let maximum = 0;
  for (let index = 0; index < a.length; index += 1) maximum = Math.max(maximum, Math.abs(a[index] - b[index]));
  assert.ok(maximum <= 1e-7, `${message}: max waveform difference ${maximum}`);
}

test("committed artifact matches Rust source/build provenance and needs no imports", async () => {
  const manifest = JSON.parse(await readFile(new URL("../src/instruments/wasm-garden/rust/build-manifest.json", import.meta.url)));
  const source = await readFile(new URL(`../${manifest.source}`, import.meta.url));
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  assert.equal(manifest.sourceSha256, digest(source));
  assert.equal(manifest.wasmSha256, digest(bytes));
  assert.equal(manifest.wasmBytes, bytes.length);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const instance = new WebAssembly.Instance(module);
  assert.equal(instance.exports.garden_abi_version(), 1);
  assert.equal(instance.exports.memory.buffer.byteLength, 4 * 1024 * 1024);
  assert.throws(() => instance.exports.memory.grow(1), RangeError);
  assert.equal(instance.exports.garden_process(GARDEN_MAX_FRAMES + 1), 0);
});

test("JS fallback is usable, starts silent, bounds parameters and rejects invalid block sizes", () => {
  assert.deepEqual(sanitizeGardenSettings(), GARDEN_DEFAULTS);
  assert.deepEqual(sanitizeGardenSettings({ modes: 1e6, baseFrequency: -1, decay: Infinity, dispersion: -1, brightness: 7 }), {
    model: 'bank', modes: GARDEN_MAX_MODES, baseFrequency: 45, pitchSpread: ORIGINAL_PITCH_SPREAD, decay: 3.2, dispersion: 0, brightness: 1,
  });
  const dsp = createGardenDSP();
  assert.equal(dsp.hasWasm, false);
  assert.equal(meanSquare(render(dsp)), 0);
  dsp.strike(0.32, 0.45, 0.8);
  assert.ok(meanSquare(render(dsp)) > 1e-5);
  const incompatible = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
  const fallback = createGardenDSP({ module: incompatible });
  assert.equal(fallback.hasWasm, false);
  assert.match(fallback.wasmError, /Incompatible/);
  fallback.strike(0.2, 0.6);
  assert.ok(meanSquare(render(fallback)) > 1e-5);
  for (const size of [-1, 2049, NaN, Infinity, 1.2]) assert.throws(() => dsp.process(size), RangeError);
  assert.throws(() => dsp.process(128, "unrecognized"), RangeError);
  assert.equal(dsp.process(0), dsp.process(128));
  assert.equal(dsp.process(128).left, dsp.left);
});

test("Rust and JavaScript render equivalent stereo waveforms at every load tier", () => {
  for (const modes of [32, 256, 2048, 8192, 16384, 32768]) {
    for (const sampleRate of [44100, 48000, 96000]) {
      const js = make({ modes }, { sampleRate });
      const wasm = make({ modes }, { sampleRate });
      assert.equal(wasm.hasWasm, true);
      js.strike(0.23, 0.61, 0.78);
      wasm.strike(0.23, 0.61, 0.78);
      assertMatching(render(js, 257, "js"), render(wasm, 257, "wasm"), `${modes} modes at ${sampleRate} Hz`);
    }
  }
});

test("switching backends during a ringing tail and configuration ramp neither resets nor double-renders", () => {
  const reference = make({ modes: 128 });
  const switched = make({ modes: 128 });
  reference.strike(0.31, 0.27);
  switched.strike(0.31, 0.27);
  for (let block = 0; block < 80; block += 1) {
    if (block === 7 || block === 23 || block === 24) {
      const settings = {
        modes: block === 7 ? 1024 : 32,
        baseFrequency: block === 7 ? 260 : 70,
        brightness: 0.83, dispersion: 0.87, decay: 5,
      };
      reference.configure(settings);
      switched.configure(settings);
      assert.ok(energy(switched) > 0, "retuning preserves ringing state");
    }
    const a = reference.process(128, "wasm");
    const b = switched.process(128, block % 2 ? "js" : "wasm");
    assertMatching(a.left.subarray(0, 128), b.left.subarray(0, 128), `left, block ${block}`);
    assertMatching(a.right.subarray(0, 128), b.right.subarray(0, 128), `right, block ${block}`);
  }
});

test("maximum-density extreme settings and repeated strikes remain finite and bounded", () => {
  for (const backend of ["js", "wasm"]) {
    const dsp = make({ modes: GARDEN_MAX_MODES, baseFrequency: 360, decay: 12, dispersion: 1, brightness: 1 });
    for (let block = 0; block < 40; block += 1) {
      dsp.strike((block * 0.193) % 1, (block * 0.317) % 1, 1);
      if (block % 7 === 0) dsp.configure({ baseFrequency: block % 2 ? 45 : 360, brightness: block % 2 });
      const output = dsp.process(128, backend);
      for (let frame = 0; frame < 128; frame += 1) {
        assert.ok(Number.isFinite(output.left[frame]) && Math.abs(output.left[frame]) <= 0.800001);
        assert.ok(Number.isFinite(output.right[frame]) && Math.abs(output.right[frame]) <= 0.800001);
      }
    }
    assert.ok(energy(dsp) > 0);
    const frequencies = dsp.getFrequencies(new Float64Array(GARDEN_MAX_MODES));
    assert.ok(frequencies.every((frequency) => frequency >= 35 && frequency < dsp.sampleRate / 2));
    assert.ok(new Set(frequencies).size > GARDEN_MAX_MODES / 4, "upper out-of-band partials are muted; many distinct audible modes remain");
  }
});

test("decay releases energy, reset gives exact silence and retrigger is deterministic", () => {
  const short = make({ modes: 64, decay: 0.2 });
  const long = make({ modes: 64, decay: 12 });
  for (const dsp of [short, long]) dsp.strike(0.36, 0.44, 0.7);
  render(short, 24000);
  render(long, 24000);
  assert.ok(energy(short) < energy(long) * 1e-8, "short decay releases much faster");
  assert.ok(energy(long) > 1e-6, "long decay still rings");
  const dsp = make();
  dsp.strike(0.2, 0.6, 0.73);
  const first = render(dsp);
  dsp.reset();
  assert.equal(energy(dsp), 0);
  assert.equal(meanSquare(render(dsp)), 0);
  dsp.strike(0.2, 0.6, 0.73);
  assert.deepEqual(render(dsp), first);
});

test("pitch, density, brightness, dispersion and strike position each change the waveform", () => {
  const sound = (settings = {}, x = 0.27, y = 0.62, velocity = 0.75) => {
    const dsp = make(settings);
    dsp.strike(x, y, velocity);
    return render(dsp, 4096);
  };
  const reference = sound();
  for (const alternate of [
    sound({ baseFrequency: 210 }), sound({ modes: 64 }),
    sound({ brightness: 0.05 }), sound({ dispersion: 0.92 }),
    sound({}, 0.71, 0.62), sound({}, 0.27, 0.16),
  ]) {
    let difference = 0;
    for (let index = 0; index < reference.length; index += 1) difference += (reference[index] - alternate[index]) ** 2;
    assert.ok(difference / reference.length > 1e-5, "control must change actual synthesis");
  }
  assert.ok(meanSquare(sound({}, 0.27, 0.62, 0.2)) < meanSquare(reference) * 0.2);
});


test("tines retain fundamentals at every detail tier and a strike excites only its own body", () => {
  for (const modes of [128, 2048, 32768]) {
    const dsp = make({ modes, dispersion: 1, baseFrequency: 82 });
    const frequencies = dsp.getFrequencies(new Float64Array(modes));
    for (let tine = 0; tine < TINE_COUNT; tine++) assert.equal(frequencies[tine], tineFrequency(tine, 82));
    assert.ok(Math.abs(frequencies[TINE_COUNT] / frequencies[0] - 6.267) < 1e-10);
    dsp.strike(13.5 / TINE_COUNT, 0.8, 0.8);
    const energies = dsp.getEnergies(new Float32Array(TINE_COUNT));
    assert.ok(energies[13] > 0);
    assert.equal(energies.filter((value) => value > 0).length, 1);
  }
});

test("prepared coefficients agree with direct configuration through odd counts and partial blocks", () => {
  const js = make({ modes: 8193 });
  const wasm = make({ modes: 8193 });
  for (const modes of [8193, 513, 32767, 32768, 127]) {
    const settings = { modes, baseFrequency: modes % 2 ? 140 : 70, decay: 4.2 };
    js.configure(settings);
    wasm.configure(settings, prepareGardenSettings({ ...wasm.settings, ...settings }, wasm.sampleRate));
    for (const size of [1, 7, 129, 257, 64]) {
      js.strike(0.995, 0.81, 0.5, 'pick'); wasm.strike(0.995, 0.81, 0.5, 'pick');
      const a = js.process(size, 'js'), b = wasm.process(size, 'wasm');
      assertMatching(a.left.subarray(0, size), b.left.subarray(0, size), `odd/partial left ${modes}/${size}`);
      assertMatching(a.right.subarray(0, size), b.right.subarray(0, size), `odd/partial right ${modes}/${size}`);
    }
  }
});

test("mallet, pick and scraper contacts produce distinct finite signals", () => {
  const sounds = ['mallet', 'pick', 'scraper'].map(exciter => {
    const dsp = make({ modes: 4096 });
    dsp.strike(0.42, 0.7, 0.8, exciter);
    return render(dsp, 2048);
  });
  for (const sound of sounds) assert.ok(meanSquare(sound) > 1e-5);
  assert.notDeepEqual(sounds[0], sounds[1]); assert.notDeepEqual(sounds[0], sounds[2]);
});

test("contact rates through 2048/s remain sample timed across rates, blocks and live edits", async () => {
  let Processor;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (_name, Class) => { Processor = Class; };
  globalThis.sampleRate = 48000;
  globalThis.currentFrame = 0;
  await import('../src/instruments/wasm-garden/garden-processor.js');
  try {
    for (const sampleRate of [44100, 48000]) for (const blockSize of [128, 256]) for (const rate of [159, 160, 512, 1024, 2047, 2048]) {
      globalThis.sampleRate = sampleRate;
      globalThis.currentFrame = 0;
      const processor = new Processor({ processorOptions: { module, settings: { modes: 128 }, playing: true, rate } });
      const contacts = [];
      let rendered = 0;
      const process = processor.engine.process;
      processor.engine.process = (...args) => { const signal = process(...args); rendered += args[0]; return signal; };
      processor.engine.strike = () => { contacts.push(rendered); };
      const channels = [[new Float32Array(blockSize), new Float32Array(blockSize)]];
      while (globalThis.currentFrame < sampleRate) {
        const count = Math.min(blockSize, sampleRate - globalThis.currentFrame);
        processor.process([], [channels[0].map(channel => channel.subarray(0, count))]);
        globalThis.currentFrame += count;
      }
      assert.equal(contacts.length, rate, `${rate}/s at ${sampleRate} Hz in ${blockSize}-frame blocks`);
      for (let i = 0; i < rate; i++) assert.ok(Math.abs(contacts[i] - i * sampleRate / rate) < 1.000001);
      processor.port.onmessage({ data: { type: 'dispose' } });
      assert.equal(processor.process([], channels), false);
    }
    globalThis.sampleRate = 48000;
    for (const [preset, pattern] of [[PRESETS.originalDense, 'random'], [PRESETS.originalDense, 'weighted'], [PRESETS.steel, 'sweep']]) {
      globalThis.currentFrame = 0;
      const excitation = { playing: true, rate: 2048, pattern, pitchFocus: 0, chanceWidth: 0, exciter: preset.exciter };
      const processor = new Processor({ processorOptions: { ...excitation, module, settings: { ...preset, modes: GARDEN_MAX_MODES } } });
      const channels = [[new Float32Array(128), new Float32Array(128)]];
      let squareSum = 0;
      for (let block = 0; block < 96; block++) {
        processor.process([], channels);
        globalThis.currentFrame += 128;
        for (const channel of channels[0]) for (const sample of channel) {
          assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 0.800001);
          squareSum += sample * sample;
        }
      }
      assert.equal(processor.ticks, Math.ceil(currentFrame * 2048 / sampleRate), 'all high-rate contacts reach the actual DSP');
      assert.ok(squareSum > 1e-5, `${preset.model}/${pattern} remains audible at maximum density and rate`);
      const seed = processor.seed, engine = processor.engine;
      processor.setExcitation({ ...excitation, rate: 0.5 });
      assert.equal(processor.seed, seed, 'rate edits preserve the random sequence');
      assert.equal(processor.engine, engine, 'rate edits preserve the ringing engine');
      processor.setExcitation({ ...excitation, rate: 1000000 });
      assert.equal(processor.rate, 2048, 'the worklet bounds out-of-range requests');
      processor.setExcitation({ ...excitation, playing: false });
      const ticks = processor.ticks;
      processor.process([], channels);
      assert.equal(processor.ticks, ticks, 'stopping rain stops new contacts');
      globalThis.currentFrame += 48000;
      processor.setExcitation(excitation);
      processor.process([], channels);
      assert.equal(processor.ticks - ticks, Math.ceil(128 * 2048 / sampleRate), 'resuming skips stale contacts');
    }
    const options = { processorOptions: { module, settings: { model: 'tines', modes: 128 }, playing: true, rate: 160, pattern: 'weighted', pitchFocus: 0.9, chanceWidth: 0.2 } };
    const weighted = new Processor(options), twin = new Processor(options);
    const pitches = [], reference = [];
    weighted.engine.strike = x => pitches.push(Math.floor(x * TINE_COUNT));
    twin.engine.strike = x => reference.push(Math.floor(x * TINE_COUNT));
    for (let hit = 0; hit < 1000; hit++) { weighted.contact(); twin.contact(); }
    assert.deepEqual(pitches, reference, 'seeded pitch selection is reproducible');
    assert.ok(pitches.filter(tine => tine > 16).length > 990, 'high focus favors high tines in the actual worklet');
    weighted.nextContact = currentFrame + 27.5;
    const seed = weighted.seed, ticks = weighted.ticks;
    weighted.setExcitation({ ...options.processorOptions, pitchFocus: 0, chanceWidth: 0 });
    assert.equal(weighted.nextContact, currentFrame + 27.5, 'changing odds preserves the contact deadline');
    assert.equal(weighted.seed, seed, 'changing odds does not reseed');
    weighted.contact();
    assert.equal(pitches.at(-1), 0, 'zero-width low focus selects only the lowest tine');
    assert.equal(weighted.ticks, ticks + 1);
    const original = new Processor({ processorOptions: { module, settings: PRESETS.original, playing: true, rate: 3, pattern: 'random' } });
    const excitation = [];
    original.engine.strike = (x, y, velocity) => excitation.push({ x, y, velocity });
    const golden = JSON.parse(await readFile(new URL('./fixtures/wasm-garden-original.json', import.meta.url)));
    for (let event = 0; event < 6; event++) original.contact();
    assert.deepEqual(excitation, golden.presets.bronze.events.slice(1).map(({ x, y, velocity }) => ({ x, y, velocity })), 'random XY and velocity match the original sequence');
    original.port.onmessage({ data: { type: 'configure', settings: PRESETS.steel } });
    let struckModel;
    original.engine.strike = () => { struckModel = original.engine.settings.model; };
    original.port.onmessage({ data: { type: 'strike', x: 0.4, y: 0.6, velocity: 0.5 } });
    assert.equal(struckModel, 'tines', 'pending model configuration precedes a manual strike');
    for (const [name, preset] of [['glass', PRESETS.originalGlass], ['cloud', PRESETS.originalDense]]) {
      globalThis.currentFrame = 0;
      const sequenced = new Processor({ processorOptions: { module, settings: preset, playing: true, rate: preset.rate, pattern: 'random' } });
      // Match the golden scenario: a manual onset followed by six random hits.
      sequenced.nextContact = golden.presets[name].events[1].frame;
      let rendered = 0;
      const frames = [], renderBlock = sequenced.engine.process;
      sequenced.engine.process = (count, backend) => { const result = renderBlock(count, backend); rendered += count; return result; };
      sequenced.engine.strike = () => frames.push(rendered);
      const channels = [[new Float32Array(128), new Float32Array(128)]];
      while (frames.length < 6) { sequenced.process([], channels); globalThis.currentFrame += 128; }
      assert.deepEqual(frames, golden.presets[name].events.slice(1).map(event => event.frame), `${name} retains original block-aligned random cadence`);
    }
  } finally {
    delete globalThis.AudioWorkletProcessor; delete globalThis.registerProcessor;
    delete globalThis.sampleRate; delete globalThis.currentFrame;
  }
});


test('pitch spread controls audible fundamentals and inverse-square geometry across its full range', () => {
  assert.equal(sanitizeGardenSettings({ model: 'tines', pitchSpread: -5 }).pitchSpread, 0);
  assert.equal(sanitizeGardenSettings({ model: 'tines', pitchSpread: 9 }).pitchSpread, 4);
  assert.equal(sanitizeGardenSettings({ model: 'tines', pitchSpread: NaN }).pitchSpread, 2);
  const dsp = make({ modes: 4096, baseFrequency: 82 });
  dsp.strike(0.9, 0.8);
  for (const pitchSpread of [0, 0.01, 0.5, 2, 4]) {
    dsp.configure({ pitchSpread });
    assert.ok(energy(dsp) > 0, 'spread edits preserve ringing state');
    const frequencies = dsp.getFrequencies(new Float64Array(TINE_COUNT));
    assert.equal(frequencies[0], 82);
    assert.ok(Math.abs(frequencies[31] / frequencies[0] - 2 ** pitchSpread) < 1e-10);
    const low = tineGeometry(1000, 700, 0, 82, pitchSpread);
    const high = tineGeometry(1000, 700, 31, 82, pitchSpread);
    assert.ok(Math.abs((low.length / high.length) ** 2 - 2 ** pitchSpread) < 1e-10);
    const pointer = materialPointer(1000, 700, high.x, high.base - high.length * 0.6, 82, pitchSpread);
    assert.equal(Math.floor(pointer.x * TINE_COUNT), 31);
    assert.ok(Math.abs(pointer.y - 0.6) < 1e-10, 'hit testing follows the changed tine length');
    const samples = render(dsp, 512);
    assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) <= 0.800001));
  }
});

test('pitch odds normalize, mirror, reach exact endpoints and exclude zero-weight tines', () => {
  const weights = (focus, width) => fillPitchProbabilities(new Float64Array(TINE_COUNT), focus, width);
  for (const focus of [0, 0.13, 0.5, 0.9, 1, NaN]) {
    for (const width of [0, Number.MIN_VALUE, 0.01, 0.5, 0.99, 1, NaN]) {
      const distribution = weights(focus, width);
      assert.ok(distribution.every(value => Number.isFinite(value) && value >= 0));
      assert.ok(Math.abs(distribution.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    }
  }
  const low = weights(0.2, 0.4), high = weights(0.8, 0.4);
  for (let tine = 0; tine < TINE_COUNT; tine++) assert.ok(Math.abs(low[tine] - high[TINE_COUNT - 1 - tine]) < 1e-12);
  const one = weights(0.9, 0), equal = weights(0.12, 1);
  assert.equal(one.filter(value => value > 0).length, 1);
  assert.ok(equal.every(value => value === 1 / TINE_COUNT));
  const counts = new Uint32Array(TINE_COUNT);
  for (let draw = 0; draw < 3200; draw++) {
    counts[choosePitch(equal, (draw + 0.5) / 3200)]++;
    assert.equal(choosePitch(one, (draw + 0.5) / 3200), 28);
  }
  assert.ok(counts.every(value => value === 100));
  assert.equal(choosePitch(one, 1), 28);
});


test('all four original sounds match independent pre-redesign waveform checkpoints', async t => {
  const golden = JSON.parse(await readFile(new URL('./fixtures/wasm-garden-original.json', import.meta.url)));
  const presets = { bronze: PRESETS.original, glass: PRESETS.originalGlass, wood: PRESETS.originalWood, cloud: PRESETS.originalDense };
  let maximumDifference = 0;
  for (const [name, preset] of Object.entries(presets)) {
    const reference = golden.presets[name];
    for (const [key, value] of Object.entries(reference.settings)) assert.equal(preset[key], value, `${name} ${key}`);
    assert.equal(preset.rate, reference.rateHz);
    assert.equal(preset.pattern, 'random');
    const dsp = createGardenDSP({ module, sampleRate: golden.sampleRate, settings: preset });
    let event = 0, checkpoint = 0;
    for (let frame = 0; frame < reference.totalFrames; frame += 128) {
      while (reference.events[event]?.frame === frame) {
        const hit = reference.events[event++]; dsp.strike(hit.x, hit.y, hit.velocity);
      }
      const count = Math.min(128, reference.totalFrames - frame);
      const output = dsp.process(count, 'wasm');
      while (checkpoint < reference.checkpoints.length && reference.checkpoints[checkpoint][0] < frame + count) {
        const [sample, left, right] = reference.checkpoints[checkpoint++];
        const difference = Math.max(Math.abs(output.left[sample - frame] - left), Math.abs(output.right[sample - frame] - right));
        maximumDifference = Math.max(maximumDifference, difference);
        assert.ok(difference <= golden.tolerance, `${name} changed at sample ${sample}: ${difference}`);
      }
    }
    assert.equal(checkpoint, 512); assert.equal(event, 7);
  }
  t.diagnostic(`Maximum original waveform checkpoint difference: ${maximumDifference}`);
});

test('original bank stays bounded at maximum density and retains continuous XY mapping', () => {
  const dsp = createGardenDSP({ module, settings: { ...PRESETS.originalDense, modes: GARDEN_MAX_MODES } });
  for (let block = 0; block < 40; block++) {
    dsp.strike((block * 0.173) % 1, (block * 0.271) % 1, 1);
    const signal = dsp.process(128);
    for (let i = 0; i < 128; i++) assert.ok(Number.isFinite(signal.left[i]) && Number.isFinite(signal.right[i]) && Math.abs(signal.left[i]) <= 0.800001 && Math.abs(signal.right[i]) <= 0.800001);
  }
  for (const x of [0, 0.42, 1]) for (const y of [0, 0.65, 1]) {
    const projected = bankSurfacePoint(900, 700, x, y);
    const point = bankPointer(900, 700, projected.x, projected.y);
    assert.ok(Math.abs(point.x - x) < 1e-10 && Math.abs(point.y - y) < 1e-10);
  }
});


test('dense low-focus weighted strikes avoid the coherent endpoint attacks', async () => {
  let Processor;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (_name, Class) => { Processor = Class; };
  globalThis.sampleRate = 48000;
  globalThis.currentFrame = 0;
  await import('../src/instruments/wasm-garden/garden-processor.js?weighted-onset-regression');
  try {
    const settings = { ...PRESETS.originalDense, modes: GARDEN_MAX_MODES };
    for (const chanceWidth of [0, 0.1, 0.35]) {
      const processor = new Processor({ processorOptions: { module, settings, playing: true,
        rate: 160, pattern: 'weighted', pitchFocus: 0, chanceWidth } });
      const endpoint = createGardenDSP({ module, settings });
      let fixedJump = 0, endpointJump = 0;
      for (let hit = 0; hit < 12; hit++) {
        processor.engine.reset(); endpoint.reset();
        processor.contact();
        assert.ok(processor.lastY >= 0.2 && processor.lastY <= 0.9);
        endpoint.strike(processor.lastX, (processor.lastY - 0.2) / 0.7, 0.55);
        const fixed = processor.engine.process(128), legacy = endpoint.process(128);
        fixedJump = Math.max(fixedJump, Math.abs(fixed.left[0]), Math.abs(fixed.right[0]));
        endpointJump = Math.max(endpointJump, Math.abs(legacy.left[0]), Math.abs(legacy.right[0]));
        assert.ok(meanSquare(fixed.left.subarray(0, 128)) > 1e-8, 'weighted contacts remain audible');
        for (let i = 0; i < 128; i++) assert.ok(Number.isFinite(fixed.left[i]) && Number.isFinite(fixed.right[i]));
      }
      assert.ok(fixedJump < endpointJump * 0.4, `width ${chanceWidth}: onset ${fixedJump} vs endpoint ${endpointJump}`);
    }
  } finally {
    delete globalThis.AudioWorkletProcessor; delete globalThis.registerProcessor;
    delete globalThis.sampleRate; delete globalThis.currentFrame;
  }
});

test('cached bank excitation remains exact across repeated focus and density changes', () => {
  const settings = { ...PRESETS.original, modes: 32768 };
  const cached = createGardenDSP({ module, settings });
  const fresh = createGardenDSP({ module, settings });
  for (const modes of [32768, 256, 8192, 32768]) {
    cached.configure({ modes }); fresh.configure({ modes });
    for (const y of [0.2, 0.2, 0.9, 0.9, 0.2]) {
      // A silent contact at another Y forces a fresh ridge calculation in the
      // reference without changing its resonator state or scheduled time.
      fresh.strike(0.42, 0.5, 0);
      cached.strike(0.42, y, 0.55); fresh.strike(0.42, y, 0.55);
      const a = cached.process(128), b = fresh.process(128);
      assert.deepEqual(a.left.slice(0, 128), b.left.slice(0, 128));
      assert.deepEqual(a.right.slice(0, 128), b.right.slice(0, 128));
    }
  }
});


test('bank picking follows the rendered metal relief and live bending at desktop and phone sizes', () => {
  for (const [width, height] of [[1070, 804], [375, 290], [520, 310]]) {
    for (const audioOn of [false, true]) {
      const state = { settings: PRESETS.original, audioOn, energies: new Float32Array(32).fill(0.01) };
      for (const time of [0, 1, 2]) {
        const surface = prepareBankSurface(width, height, state, time);
        for (const [x, y] of [[0, 0], [0.42, 0.65], [0.5, 0.5], [0.7, 0.2], [1, 1]]) {
          const visible = bankSurfacePoint(width, height, x, y, surface);
          const picked = bankPointer(width, height, visible.x, visible.y, surface);
          assert.ok(Math.abs(picked.x - x) < 1e-6 && Math.abs(picked.y - y) < 1e-6,
            `visible ${x},${y} picked ${picked.x},${picked.y} at ${width}x${height}`);
        }
      }
    }
  }
});


test('parameter randomization covers complete musical states without device or transport state', () => {
  const current = { ...PRESETS.original, audioOn: true, repeating: true, volume: 0.63 };
  const preserved = { ...current };
  let seed = 93217;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const states = Array.from({ length: 256 }, () => randomizeGardenPreset(current, random));
  assert.deepEqual(current, preserved);
  for (const state of states) {
    assert.deepEqual(Object.keys(state).sort(), Object.keys(PRESETS.original).sort());
    for (const value of Object.values(state)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.deepEqual(sanitizeGardenSettings(state), Object.fromEntries(Object.keys(GARDEN_DEFAULTS).map(key => [key, state[key]])));
    assert.ok(state.rate >= 0.5 && state.rate <= 2048);
    assert.ok(state.pitchFocus >= 0 && state.pitchFocus <= 1);
    assert.ok(state.chanceWidth >= 0 && state.chanceWidth <= 1);
    if (state.model === 'bank') assert.equal(state.exciter, 'impulse');
  }
  for (const key of Object.keys(PRESETS.original)) {
    assert.ok(new Set(states.map(state => state[key])).size > 1, `${key} must not be frozen`);
  }
  for (const value of [0, 1, NaN, Infinity, -4]) {
    assert.deepEqual(randomizeGardenPreset(current, () => value), randomizeGardenPreset(current, () => value));
  }
});


test('dense excitation matches the direct Gaussian profile without cumulative drift', () => {
  const ridge = new Float64Array(GARDEN_MAX_MODES);
  for (const modes of [32, 256, 2048, 2049, 4096, 8191, 16384, 32767, 32768]) {
    for (const focus of [0, 0.05, 0.2, 0.493871, 0.5, 0.9, 1]) {
      fillBankRidge(ridge, modes, focus);
      for (let i = 0; i < modes; i++) {
        const expected = 0.16 + Math.exp(-((i / (modes - 1) - focus) ** 2) / 0.075);
        if (modes <= 2048) assert.equal(ridge[i], expected);
        else assert.ok(Math.abs(ridge[i] - expected) < 1e-12, `${modes} modes, focus ${focus}, index ${i}`);
      }
    }
  }
});
