import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/instruments/striped-staircase-rust/processor.js', import.meta.url), 'utf8');
const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/staircase.wasm', import.meta.url)));
const BLOCK = 128, STRIDE = 3616;

function fixture(studies = null) {
  const messages = [];
  class Base {
    constructor() {
      this.port = { postMessage: (data, transfer = []) => messages.push(structuredClone(data, { transfer })) };
    }
  }
  let Processor;
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(Base, (_name, type) => { Processor = type; }, 48000);
  const processor = new Processor({ processorOptions: { module } });
  const send = (data, transfer = []) => processor.port.onmessage({ data: structuredClone(data, { transfer }) });
  const table = new Float32Array(64 * STRIDE);
  for (let frame = 0; frame < 64; frame++) {
    const at = frame * STRIDE;
    table[at + 532] = 1;
    table[at + 534] = frame / 63 * 16;
    table[at + 535] = 1;
    table.set([1, .3, .4, .2, 1, 0, 1, .7, .6, .2, 2, 0], at + 544);
  }
  const features = studies ? new Float32Array(64 * 512 * 6) : null;
  if (features) for (let frame = 0; frame < 64; frame++) {
    features.set([1, frame / 63 * 2, frame / 63 * .3, .6, frame / 63 * 4, 1,
      2, -frame / 63, -frame / 63 * .2, .3, frame / 63 * 3, 1], frame * 512 * 6);
  }
  send({ type: 'field', table, frames: 64, revision: 1, features, featureFrames: 64 },
    features ? [table.buffer, features.buffer] : [table.buffer]);
  send({ type: 'controls', mode: 2, base: 110, brightness: .55, body: .1, gain: .75, seconds: 2, pitchMapping: 1, pitchSpan: 3,
    ...(studies ?? {}) });
  send({ type: 'transport', playing: true, enabled: true, hold: false });
  const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  return { processor, messages, send,
    render() { assert.equal(processor.process([], [output]), true); return output; },
    close() { processor.dispose(); } };
}

test('display stalls cannot accumulate staircase voice snapshots or stop the audio clock', () => {
  const f = fixture();
  try {
    for (let block = 0; block < 64; block++) f.render();
    assert.equal(f.messages.filter(message => message.type === 'state').length, 0, 'no unsolicited diagnostics');
    f.send({ type: 'state-request' }); f.render();
    const first = f.messages.at(-1);
    assert.equal(first.type, 'state'); assert.equal(first.voices.length, 512 * 6);
    assert.equal(first.clock, 65 * BLOCK);
    assert.equal(f.processor.voiceSnapshot, null, 'the only buffer is in flight');
    // Even duplicate requests cannot allocate a replacement while the UI stalls.
    for (let block = 0; block < 256; block++) { f.send({ type: 'state-request' }); f.render(); }
    assert.equal(f.messages.filter(message => message.type === 'state').length, 1);
    f.send({ type: 'state-request', voices: first.voices }, [first.voices.buffer]);
    assert.equal(first.voices.byteLength, 0, 'return the transferred buffer');
    f.render();
    const latest = f.messages.at(-1);
    assert.equal(latest.clock, 322 * BLOCK, 'fresh state after the stall, without replaying stale snapshots');
    assert.equal(latest.voices.length, 512 * 6);
    assert.equal(f.messages.filter(message => message.type === 'state').length, 2);
  } finally { f.close(); }
});

test('all five spiral mappings keep sample-identical audio through missing and stalled display requests', () => {
  const studies = { turnAmount: .7, turnSpan: 1.3, accentAmount: 1, accentRate: 32,
    forkAmount: .6, forkSpan: 2.1, curvatureAmount: .8, curvatureDrive: 2,
    endlessAmount: .75, endlessDirection: -1 };
  const quiet = fixture(studies), observed = fixture(studies);
  let returned = null, energy = 0;
  try {
    for (let block = 0; block < 512; block++) {
      if (block < 100 || block > 300) {
        observed.send({ type: 'state-request', voices: returned }, returned ? [returned.buffer] : []);
        returned = null;
      }
      const expected = quiet.render(), actual = observed.render();
      assert.deepEqual(actual[0], expected[0]); assert.deepEqual(actual[1], actual[0], 'centered sound');
      for (const sample of actual[0]) { assert.ok(Number.isFinite(sample) && Math.abs(sample) < 1); energy += sample * sample; }
      const snapshot = observed.messages.at(-1);
      if (snapshot.type === 'state' && snapshot.voices.byteLength) returned = snapshot.voices;
    }
    assert.ok(energy > 1);
    quiet.processor.api.stair_state(quiet.processor.handle);
    observed.processor.api.stair_state(observed.processor.handle);
    assert.deepEqual(observed.processor.values, quiet.processor.values);
    assert.ok(observed.processor.values[8] >= 8);
  } finally { quiet.close(); observed.close(); }
});

test('moving stripe PCM and gate state are identical with frequent, absent, or stalled display requests', () => {
  const quiet = fixture(), observed = fixture();
  let returned = null;
  try {
    for (let block = 0; block < 512; block++) {
      if (block < 100 || block > 300) {
        observed.send({ type: 'state-request', voices: returned }, returned ? [returned.buffer] : []);
        returned = null;
      }
      const expected = quiet.render(), actual = observed.render();
      assert.deepEqual(actual[0], expected[0]); assert.deepEqual(actual[1], expected[1]);
      const snapshot = observed.messages.at(-1);
      if (snapshot.type === 'state' && snapshot.voices.byteLength) returned = snapshot.voices;
    }
    quiet.processor.api.stair_state(quiet.processor.handle);
    observed.processor.api.stair_state(observed.processor.handle);
    assert.deepEqual(observed.processor.values, quiet.processor.values);
    assert.ok(observed.processor.values[8] >= 8, 'the comparison crosses multiple real note onsets');
  } finally { quiet.close(); observed.close(); }
});
