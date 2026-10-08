import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

// Reviewers may exercise an isolated processor/build without modifying the
// checkout. The normal suite always uses this repository's source and WASM.
const root = process.env.MORPHAZOID_SYNTHESIS_TEST_ROOT
  ? resolve(process.env.MORPHAZOID_SYNTHESIS_TEST_ROOT)
  : fileURLToPath(new URL('../', import.meta.url));
const [processorSource, wasmBytes, { PROCESSING_DATA }] = await Promise.all([
  readFile(process.env.MORPHAZOID_PERCUSSION_TEST_PROCESSOR
    ?? resolve(root, 'src/instruments/synthesis/processor.js'), 'utf8'),
  readFile(process.env.MORPHAZOID_PERCUSSION_TEST_WASM
    ?? resolve(root, 'assets/wasm/synthesis.wasm')),
  import(pathToFileURL(resolve(root, 'src/instruments/synthesis/processing-catalog.js'))),
]);
const module = await WebAssembly.compile(wasmBytes);
const RATE = 48_000;
const rms = samples => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / Math.max(1, samples.length));
const peak = samples => samples.reduce((maximum, x) => Math.max(maximum, Math.abs(x)), 0);
const difference = (a, b) => a.reduce((maximum, x, index) => Math.max(maximum, Math.abs(x - b[index])), 0);

function voice(model = 0, overrides = {}) {
  return {
    model, frequency: 110, decay: .12, tone: .6, noise: .3,
    sweep: 7, ratio: 1.7, index: 3, level: .45, pan: 0,
    ...overrides,
  };
}

function state(model = 0, overrides = {}) {
  return {
    kind: 'processor', processorId: 0, source: 0, frequencyHz: 220,
    params: [0, .6, .2, .5, ...Array(12).fill(0)],
    wet: 1, bypass: true, inputDb: 0, outputDb: 0,
    percussion: { voices: Array.from({ length: 8 }, (_, lane) => voice(model, { frequency: 70 + lane * 53 })) },
    ...overrides,
  };
}

function makeHarness(rate = RATE) {
  let Processor;
  const messages = [], hits = [];
  const context = vm.createContext({
    WebAssembly, Float32Array, sampleRate: rate, currentFrame: 0, currentTime: 0,
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: message => messages.push(message) }; }
    },
    registerProcessor(name, Class) {
      assert.equal(name, 'roads-synthesis');
      Processor = Class;
    },
  });
  vm.runInContext(processorSource, context, { filename: 'synthesis/processor.js' });
  const processor = new Processor({ processorOptions: { module } });
  assert.equal(processor.api.drum_abi_version?.(), 1, 'committed WASM contains the percussion ABI');
  const native = processor.api;
  processor.api = {
    ...native,
    drum_note(...args) {
      hits.push({ lane: args[1], velocity: args[2], ratio: args[3] });
      return native.drum_note(...args);
    },
  };
  const send = message => processor.port.onmessage({ data: message });
  const render = (frames, blockSize = 128) => {
    assert.ok(blockSize >= 1 && blockSize <= 128);
    const output = [new Float32Array(frames), new Float32Array(frames)];
    for (let offset = 0; offset < frames; offset += blockSize) {
      const count = Math.min(blockSize, frames - offset);
      const channels = [new Float32Array(count), new Float32Array(count)];
      assert.equal(processor.process([], [channels]), true);
      for (let channel = 0; channel < 2; channel++) {
        assert.ok(channels[channel].every(Number.isFinite), 'actual percussion/FX PCM is finite');
        assert.ok(peak(channels[channel]) <= 1, 'percussion/FX PCM is bounded before browser output');
        output[channel].set(channels[channel], offset);
      }
      context.currentFrame += count;
      context.currentTime = context.currentFrame / rate;
    }
    assert.deepEqual(messages.filter(message => message.type === 'error'), [], 'worklet remains usable');
    return output;
  };
  return {
    processor, send, render, hits, messages, rate,
    get frame() { return context.currentFrame; },
    get time() { return context.currentTime; },
    dispose() { send({ type: 'dispose' }); },
  };
}

function score(overrides = {}) {
  return {
    studyId: 'percussion-test', seed: 17, tempo: 120, stepBeats: .25, lengthBeats: 2,
    steps: [{ index: 0, at: .25, duration: .1,
      notes: [{ lane: 5, ratio: 1.5, velocity: .7, gate: 1 }] }],
    ...overrides,
  };
}

function startScore(h, sequence, at = h.time) {
  h.send({ type: 'sequence-load', sequence, rootFrequency: 220, tempo: sequence.tempo, at, phase: 0 });
  h.send({ type: 'sequence-start', phase: 0, originBeat: 0, rootFrequency: 220,
    tempo: sequence.tempo, at, intent: 1 });
}

for (let model = 0; model < 6; model++) test(`percussion model ${model}: every lane renders a finite independent one-shot through processor bypass`, () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state(model) });
    assert.equal(peak(h.render(128)[0]), 0, 'recalling a kit does not start playback');
    for (let lane = 0; lane < 8; lane++) {
      h.send({ type: 'silence' });
      assert.equal(peak(h.render(128)[0]), 0, 'panic clears the preceding lane and pending events');
      const before = h.hits.length;
      h.send({ type: 'drum-hit', lane, velocity: .8, ratio: 1 });
      const [left, right] = h.render(12_000);
      assert.equal(h.hits.length, before + 1, 'one pad action triggers exactly once');
      assert.equal(h.hits.at(-1).lane, lane, 'the selected lane reaches the native bank');
      assert.ok(rms(left) > 1e-5 && rms(right) > 1e-5, `lane ${lane} is audible in both channels`);
      assert.ok(peak(left) < .99 && peak(right) < .99, 'moderate isolated hits retain headroom');
    }
  } finally { h.dispose(); }
});

for (const rate of [44_100, 96_000]) test(`percussion models honor the ${rate} Hz host rate`, () => {
  const h = makeHarness(rate);
  try {
    for (let model = 0; model < 6; model++) {
      h.send({ type: 'silence' });
      h.send({ type: 'state', state: state(model) });
      h.send({ type: 'drum-hit', lane: 0, velocity: .8, ratio: 1 });
      const [left] = h.render(Math.round(rate * .25));
      assert.ok(rms(left) > 1e-5, `model ${model} sounds at the actual host rate`);
    }
  } finally { h.dispose(); }
});

test('percussion pad hits start inside the requested quantum and zero velocity stays silent', () => {
  for (const target of [47, 127, 128, 129]) {
    const h = makeHarness();
    try {
      h.send({ type: 'state', state: state() });
      h.send({ type: 'drum-hit', lane: 0, velocity: 0, ratio: 1, at: 0 });
      h.send({ type: 'drum-hit', lane: 0, velocity: .8, ratio: 1, at: target / RATE });
      const [left] = h.render(target + 128);
      assert.equal(peak(left.subarray(0, target)), 0, `no PCM may precede sample ${target}`);
      assert.ok(rms(left.subarray(target, target + 128)) > 1e-5, 'the scheduled hit does not wait for another block');
    } finally { h.dispose(); }
  }
});

test('percussion sequence notes keep authored lanes, velocity, pitch ratio and sample-clock onset', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state(3) });
    startScore(h, score(), 47 / RATE);
    const onset = 47 + RATE / 8;
    const [left] = h.render(onset + 512);
    assert.equal(peak(left.subarray(0, onset)), 0, 'sequence is silent before the exact score boundary');
    assert.ok(rms(left.subarray(onset)) > 1e-5);
    assert.deepEqual(h.hits, [{ lane: 5, velocity: .7, ratio: 1.5 }]);
    assert.equal(h.processor.sequenceAnchorFrame, 47);
  } finally { h.dispose(); }
});

test('percussion Stop cancels future sequence hits and finite tails settle', () => {
  const h = makeHarness();
  try {
    h.send({ type: 'state', state: state() });
    startScore(h, score({ lengthBeats: 1, steps: [
      { index: 0, at: 0, duration: .1, notes: [{ lane: 0, ratio: 1, velocity: .8, gate: 1 }] },
      { index: 1, at: .5, duration: .1, notes: [{ lane: 1, ratio: 1, velocity: .8, gate: 1 }] },
    ] }));
    assert.ok(rms(h.render(256)[0]) > 1e-5);
    h.send({ type: 'sequence-stop' });
    const count = h.hits.length;
    const [tail] = h.render(RATE * 2);
    assert.equal(h.hits.length, count, 'stopped score cannot strike later or repeat');
    assert.equal(h.processor.sequencePlaying, false);
    assert.equal(h.processor.sequenceNextBeat, Infinity);
    assert.ok(rms(tail.subarray(-4096)) < 1e-6, 'one-shot tails reach silence without another Stop');
  } finally { h.dispose(); }
});

test('editing a live percussion kit preserves the sequence clock and upcoming lane', () => {
  const h = makeHarness();
  try {
    const patch = state();
    h.send({ type: 'state', state: patch });
    startScore(h, score());
    h.render(2048);
    const snapshot = ['sequenceAnchorFrame', 'sequenceAnchorBeat', 'sequenceNextBeat', 'sequenceNextStep', 'sequenceRevision']
      .map(key => [key, h.processor[key]]);
    const changed = structuredClone(patch);
    changed.percussion.voices[5].frequency *= 1.37;
    changed.percussion.voices[5].tone = .85;
    h.send({ type: 'state', state: changed });
    for (const [key, value] of snapshot) assert.equal(h.processor[key], value, `${key} survives an ordinary timbre edit`);
    const [left] = h.render(6000 - h.frame + 512);
    assert.equal(peak(left.subarray(0, 6000 - 2048)), 0, 'editing does not add an unsolicited audition');
    assert.ok(rms(left.subarray(6000 - 2048)) > 1e-5);
    assert.equal(h.hits.length, 1);
    assert.equal(h.hits[0].lane, 5);
  } finally { h.dispose(); }
});

test('percussion rendering is independent of host block partition', () => {
  const a = makeHarness(), b = makeHarness();
  try {
    for (const h of [a, b]) {
      h.send({ type: 'state', state: state(3) });
      h.send({ type: 'drum-hit', lane: 0, velocity: .6, ratio: 1.25, at: 47 / RATE });
      h.send({ type: 'drum-hit', lane: 4, velocity: .5, ratio: .8, at: 521 / RATE });
    }
    const normal = a.render(4096), split = b.render(4096, 37);
    for (let channel = 0; channel < 2; channel++) {
      assert.ok(difference(normal[channel], split[channel]) < 2e-6, 'scheduling and native PCM do not depend on quantum partition');
    }
    assert.deepEqual(a.hits, b.hits);
  } finally { a.dispose(); b.dispose(); }
});

test('closed hats choke only the open-hat lane while preserving stereo routing', () => {
  const choked = makeHarness(), open = makeHarness();
  try {
    const patch = state(1);
    patch.percussion.voices[3] = voice(1, { frequency: 3900, decay: 1.5, noise: .8, pan: -1 });
    patch.percussion.voices[2] = voice(1, { frequency: 4500, decay: .09, noise: .8, pan: 1 });
    for (const h of [choked, open]) {
      h.send({ type: 'state', state: patch });
      h.send({ type: 'drum-hit', lane: 3, velocity: .8, ratio: 1 });
      const [left, right] = h.render(2048);
      assert.ok(rms(left) > 1e-5);
      assert.ok(rms(right) < 1e-7, 'hard-left open hat is not duplicated into the right channel');
    }
    choked.send({ type: 'drum-hit', lane: 2, velocity: .8, ratio: 1 });
    const cut = choked.render(9600), sustained = open.render(9600);
    assert.ok(rms(cut[1]) > 1e-5, 'closed hat still sounds through its own right channel');
    assert.ok(rms(cut[0].subarray(-2048)) < rms(sustained[0].subarray(-2048)) * .02,
      'open-hat tail releases after the choke rather than continuing underneath');
  } finally { choked.dispose(); open.dispose(); }
});

test('dense percussion stays bounded without growing WASM memory and panic recovers', () => {
  const h = makeHarness();
  try {
    const patch = state();
    patch.percussion.voices = patch.percussion.voices.map((v, lane) => ({ ...v, model: lane % 6, decay: .8, level: .25 }));
    h.send({ type: 'state', state: patch });
    // Prime fixed PCM/model state before measuring render-time allocation.
    for (let lane = 0; lane < 8; lane++) h.send({ type: 'drum-hit', lane, velocity: .7, ratio: 1 });
    h.render(128);
    const bytes = h.processor.api.memory.buffer.byteLength;
    for (let burst = 0; burst < 80; burst++) {
      for (let hit = 0; hit < 32; hit++) h.send({ type: 'drum-hit', lane: hit % 8, velocity: .35, ratio: 1 });
      const [left] = h.render(128);
      assert.ok(rms(left) > 1e-6, 'admission/stealing does not silence the dense bank');
      assert.equal(h.processor.api.memory.buffer.byteLength, bytes, 'hits/rendering do not allocate unbounded WASM memory');
    }
    h.send({ type: 'silence' });
    assert.equal(peak(h.render(512)[0]), 0, 'panic clears all drum voices');
    h.send({ type: 'drum-hit', lane: 0, velocity: .6, ratio: 1 });
    assert.ok(rms(h.render(2048)[0]) > 1e-5, 'the same processor is immediately playable again');
  } finally { h.dispose(); }
});

test('percussion runs through the selected processor effect and returns to bypass', () => {
  const dry = makeHarness(), wet = makeHarness();
  try {
    const delay = PROCESSING_DATA.find(method => method.id === 'delay');
    assert.ok(delay?.presets.length, 'a real factory delay is available');
    const factory = delay.presets[0];
    const effect = { processorId: delay.processorId, params: [...factory.params],
      wet: .5, bypass: false, inputDb: 0, outputDb: -6 };
    dry.send({ type: 'state', state: state() });
    wet.send({ type: 'state', state: state(0, effect) });
    for (const h of [dry, wet]) h.send({ type: 'drum-hit', lane: 0, velocity: .7, ratio: 1 });
    const a = dry.render(RATE), b = wet.render(RATE);
    assert.ok(rms(a[0]) > 1e-5 && rms(b[0]) > 1e-5, 'dry and effected percussion both reach the output');
    assert.ok(difference(a[0], b[0]) > 1e-4, 'the effect is in the actual percussion signal path');
    assert.ok(rms(b[0].subarray(RATE / 2, RATE * .8)) > 1e-5,
      'a real delayed repeat remains after the short dry one-shot');
    assert.ok(rms(b[0].subarray(RATE / 2, RATE * .8)) > rms(a[0].subarray(RATE / 2, RATE * .8)) * 2,
      'the effect comparison proves an echo, not merely a different output gain');
    wet.send({ type: 'silence' });
    wet.send({ type: 'state', state: state() });
    wet.send({ type: 'drum-hit', lane: 0, velocity: .7, ratio: 1 });
    assert.ok(rms(wet.render(4096)[0]) > 1e-5, 'returning to bypass needs no Audio restart');
  } finally { dry.dispose(); wet.dispose(); }
});

test('percussion preset-level compensation ramps through live stereo tails without resetting the score', () => {
  const plain = makeHarness(), matched = makeHarness();
  try {
    const patch = state(0);
    patch.percussion.voices = Array.from({ length: 8 }, () => voice(0, {
      frequency: 97, decay: 1, noise: 0, tone: .3, sweep: 0, level: .05, pan: .2,
    }));
    for (const h of [plain, matched]) {
      h.send({ type: 'state', state: patch });
      startScore(h, score({ lengthBeats: 4, steps: [
        { index: 0, at: 0, duration: .1, notes: [{ lane: 0, ratio: 1, velocity: .6, gate: 1 }] },
        { index: 1, at: 2, duration: .1, notes: [{ lane: 1, ratio: 1, velocity: .6, gate: 1 }] },
      ] }));
      h.render(2048);
    }
    const clockKeys = ['sequenceAnchorFrame', 'sequenceAnchorBeat', 'sequenceNextBeat', 'sequenceNextStep', 'sequenceRevision'];
    const clock = clockKeys.map(key => [key, matched.processor[key]]);
    matched.send({ type: 'state', state: { ...patch, percussion: { ...patch.percussion, gain: 4 } } });
    for (const [key, value] of clock) assert.equal(matched.processor[key], value, `${key} survives level matching`);
    assert.equal(matched.hits.length, 1, 'matching itself does not add another hit');
    const reference = plain.render(4096), result = matched.render(4096);
    for (let channel = 0; channel < 2; channel++) {
      const early = rms(result[channel].subarray(0, 16)) / rms(reference[channel].subarray(0, 16));
      const late = rms(result[channel].subarray(-512)) / rms(reference[channel].subarray(-512));
      assert.ok(early > 1 && early < 1.25, `channel ${channel}: compensation ramps instead of stepping from 1× to 4×`);
      assert.ok(late > 3.9 && late <= 4.001, `channel ${channel}: the static target is reached without flattening note decay`);
    }
    const referencePan = rms(reference[0]) / rms(reference[1]);
    const matchedPan = rms(result[0]) / rms(result[1]);
    assert.ok(Math.abs(referencePan - matchedPan) < 1e-5, 'one shared gain curve preserves stereo image');
    assert.equal(matched.hits.length, 1, 'a level update does not restart the earlier sequence event');
  } finally { plain.dispose(); matched.dispose(); }
});
