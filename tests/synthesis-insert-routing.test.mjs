import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.MORPHAZOID_SYNTHESIS_TEST_ROOT
  ? resolve(process.env.MORPHAZOID_SYNTHESIS_TEST_ROOT)
  : fileURLToPath(new URL('../', import.meta.url));
const [{ createDefaultState, getMethod }, { compileSequence }, { captureInstrumentPreset }, source, bytes] = await Promise.all([
  import(pathToFileURL(resolve(root, 'src/instruments/synthesis/catalog.js'))),
  import(pathToFileURL(resolve(root, 'src/instruments/synthesis/sequence-compiler.js'))),
  import(pathToFileURL(resolve(root, 'src/instruments/synthesis/instrument-presets.js'))),
  readFile(resolve(root, 'src/instruments/synthesis/processor.js'), 'utf8'),
  readFile(resolve(root, 'assets/wasm/synthesis.wasm')),
]);
const module = await WebAssembly.compile(bytes);
const RATE = 48_000;
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);

function harness() {
  let Processor;
  const messages = [];
  const context = vm.createContext({
    WebAssembly, Float32Array, sampleRate: RATE, currentFrame: 0, currentTime: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
    registerProcessor(name, Constructor) { assert.equal(name, 'roads-synthesis'); Processor = Constructor; },
  });
  vm.runInContext(source, context, { filename: 'synthesis/processor.js' });
  const processor = new Processor({ processorOptions: { module } });
  const send = message => processor.port.onmessage({ data: message });
  return {
    processor, send,
    get time() { return context.currentTime; },
    get frame() { return context.currentFrame; },
    render(frames) {
      const rendered = [new Float32Array(frames), new Float32Array(frames)];
      for (let offset = 0; offset < frames; offset += 128) {
        const count = Math.min(128, frames - offset);
        const output = [new Float32Array(count), new Float32Array(count)];
        assert.equal(processor.process([], [output]), true);
        output.forEach((channel, index) => {
          assert.ok(channel.every(Number.isFinite), 'insert output is finite');
          assert.ok(channel.every(value => Math.abs(value) <= 1), 'insert output stays bounded');
          rendered[index].set(channel, offset);
        });
        context.currentFrame += count;
        context.currentTime = context.currentFrame / RATE;
      }
      assert.deepEqual(messages.filter(message => message.type === 'error'), []);
      return rendered;
    },
    dispose() { send({ type: 'dispose' }); },
  };
}

function effect(overrides = {}) {
  return { ...createDefaultState('fx-biquad'), kind: 'processor', processorId: 0,
    source: 0, bypass: true, inputDb: 0, outputDb: 0, playStyle: 'process', ...overrides };
}

function synth(voiceMode = 'mono', insert = effect()) {
  return { ...createDefaultState('additive'), kind: 'synthesis', engineId: getMethod('additive').engineId,
    voiceMode, playStyle: 'hold', insert,
    envelope: { attack: .001, decay: .005, sustain: 1, release: .02 } };
}

function note(h, noteId = 1, at = h.time) {
  h.send({ type: 'note', noteId, frequency: 440, velocity: .8, duration: null, at });
}

const audible = (channels, label) => channels.forEach((samples, index) => {
  assert.ok(rms(samples.subarray(samples.length / 2)) > .01, `${label}: channel ${index} is audible`);
});

for (const voiceMode of ['mono', 'poly']) {
  test(`${voiceMode} synth insert accepts notes while primary Play is off and retains sample onset`, () => {
    const h = harness();
    try {
      h.send({ type: 'state', state: synth(voiceMode) });
      note(h, 1, 47 / RATE);
      const output = h.render(4096);
      for (const channel of output) assert.ok(channel.subarray(0, 47).every(sample => sample === 0), 'insert does not sound before the scheduled note');
      audible(output, 'manual note through insert');
      assert.equal(h.processor.playing, false, 'manual input does not depend on Play');
      h.send({ type: 'off', noteId: 1, at: h.time });
      h.render(24_000);
      assert.ok(rms(h.render(4096)[0]) < 1e-7, 'bypassed insert releases to silence');
    } finally { h.dispose(); }
  });

  test(`${voiceMode} insert remains audible after an external-processor transition`, () => {
    const h = harness();
    try {
      h.send({ type: 'state', state: effect({ source: 1 }) });
      h.send({ type: 'play', playing: true, rate: 1 });
      h.render(2048);
      h.send({ type: 'state', state: synth(voiceMode) });
      h.send({ type: 'play', playing: false, rate: 1 });
      note(h);
      audible(h.render(8192), 'external source → synth insert');
    } finally { h.dispose(); }
  });

  test(`${voiceMode} insert recovers new notes after silence/panic without another state message`, () => {
    const h = harness();
    try {
      h.send({ type: 'state', state: synth(voiceMode) });
      note(h);
      audible(h.render(4096), 'initial note');
      h.send({ type: 'silence' });
      h.render(24_000);
      assert.ok(rms(h.render(4096)[0]) < 1e-7, 'panic releases the previous note');
      note(h, 2);
      audible(h.render(8192), 'fresh note after panic');
    } finally { h.dispose(); }
  });

  test(`${voiceMode} insert cutoff changes sound without changing a running sequence clock`, () => {
    const h = harness();
    try {
      const open = effect({ bypass: false, params: [0, .95, .1, .5, ...Array(12).fill(0)] });
      const closed = effect({ bypass: false, params: [0, .1, .1, .5, ...Array(12).fill(0)] });
      h.send({ type: 'state', state: synth(voiceMode, open) });
      const sequence = compileSequence('rising-latched-chord', { parameters: { steps: 16, density: 1, stepBeats: .5 } });
      h.send({ type: 'sequence-load', sequence, tempo: 120, rootFrequency: 440, preservePhase: false });
      h.send({ type: 'sequence-start', tempo: 120, rootFrequency: 440, at: 0, phase: 0 });
      const before = h.render(4096)[0];
      const clock = [h.processor.sequenceAnchorBeat, h.processor.sequenceAnchorFrame, h.processor.sequenceNextBeat, h.processor.sequenceRevision];
      h.send({ type: 'state', state: synth(voiceMode, closed) });
      assert.equal(h.processor.sequencePlaying, true);
      assert.deepEqual([h.processor.sequenceAnchorBeat, h.processor.sequenceAnchorFrame, h.processor.sequenceNextBeat, h.processor.sequenceRevision], clock);
      const after = h.render(4096)[0];
      assert.ok(rms(before.subarray(2048)) > .01, 'open filter passes the playing synth');
      assert.ok(rms(after.subarray(2048)) < rms(before.subarray(2048)) * .2, 'low cutoff attenuates the synth, not merely its UI value');
    } finally { h.dispose(); }
  });

  test(`${voiceMode} synth insert survives Play stop and restart`, () => {
    const h = harness();
    try {
      h.send({ type: 'state', state: synth(voiceMode) });
      h.send({ type: 'play', playing: true, rate: 1 });
      audible(h.render(4096), 'Play onset');
      h.send({ type: 'play', playing: false, rate: 1 });
      h.render(24_000);
      assert.ok(rms(h.render(4096)[0]) < 1e-7, 'Stop closes the synth gate');
      h.send({ type: 'play', playing: true, rate: 1 });
      audible(h.render(8192), 'Play restart');
    } finally { h.dispose(); }
  });
}

test('complete snapshots retain independent synth and insert state without device or transport ownership', () => {
  const sound = synth('poly', null);
  const first = captureInstrumentPreset({ sound, voiceMode: 'poly', tuningId: 'bohlen-pierce-13edt',
    sequence: { id: 'rising-latched-chord', tempoBpm: 139 },
    routing: { input: 'synthesis', effectEnabled: true, loop: false, effect: effect({ wet: .37, inputDb: -4, outputDb: 2 }) },
    playing: true, audioEnabled: true, stream: 'device-owned',
  });
  assert.equal(first.sound.methodId, 'additive');
  assert.equal(first.routing.effect.methodId, 'fx-biquad');
  assert.equal(first.routing.effect.wet, .37);
  assert.equal(first.routing.effect.inputDb, -4);
  assert.equal(first.routing.effect.outputDb, 2);
  assert.equal(first.routing.effectEnabled, true);
  assert.equal(first.routing.loop, false);
  assert.deepEqual(captureInstrumentPreset(first), first, 'snapshot restore is idempotent');
  for (const key of ['outputLevel', 'playing', 'audioEnabled', 'stream']) {
    assert.equal(Object.hasOwn(first, key), false);
    assert.equal(Object.hasOwn(first.sound, key), false);
    assert.equal(Object.hasOwn(first.routing.effect, key), false);
  }
});

for (const voiceMode of ['mono', 'poly']) test(`${voiceMode} spectral Freeze clears on Stop, Panic and Audio off, and can capture again`, () => {
  const h = harness();
  try {
    const insert = { ...createDefaultState('fx-spectral'), kind: 'processor', processorId: 16,
      source: 0, wet: 1, params: [2 / 3, .5, .5, .5, .5, ...Array(11).fill(0)] };
    h.send({ type: 'state', state: synth(voiceMode, insert) });
    for (const action of ['stop', 'panic', 'audio-off']) {
      h.send({ type: 'output-armed', armed: true });
      h.send({ type: 'play', playing: true, rate: 1 });
      audible(h.render(8192), 'captured spectrum');
      if (action === 'panic') h.send({ type: 'silence' });
      else {
        if (action === 'audio-off') h.send({ type: 'output-armed', armed: false });
        h.send({ type: 'play', playing: false });
      }
      h.render(24000);
      assert.ok(rms(h.render(4096)[0]) < 1e-7, `${action} cannot leave a latched spectrum sounding`);
    }
    h.send({ type: 'output-armed', armed: true });
    note(h, 99);
    audible(h.render(8192), 'manual capture after disarm');
  } finally { h.dispose(); }
});
