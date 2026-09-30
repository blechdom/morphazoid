import assert from 'node:assert/strict';
import test from 'node:test';
import { FractalOutput, OUTPUT_CEILING } from '../src/instruments/fractal-signals/output.js';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { createDefaultState, generateStructure } from '../src/instruments/fractal-signals/model.js';

const SR = 48000;

test('output raises quiet material linearly while preserving stereo, rests and envelope shape', () => {
  const output = new FractalOutput(SR, 8);
  const source = Float64Array.from({ length: 12000 }, (_, i) => i < 1200 || i > 8000 ? 0 : Math.sin(i * .031) * .025 * (1 - (i - 1200) / 6800));
  for (let i = 0; i < source.length + output.lookahead; i++) {
    output.process(source[i] ?? 0, (source[i] ?? 0) * -.3);
    const expected = (source[i - output.lookahead] ?? 0) * 8;
    assert.ok(Math.abs(output.left - expected) < 1e-14, `linear output at ${i}`);
    assert.ok(Math.abs(output.right + expected * .3) < 1e-14, `stereo ratio at ${i}`);
  }
});

test('lookahead limits sharp peaks on either channel without clipping or shifting stereo balance', () => {
  for (const rate of [8000, 44100, 48000, 96000, 192000]) {
    const output = new FractalOutput(rate, 32);
    for (let i = 0; i < Math.round(rate * .4); i++) {
      const left = i % 307 === 0 ? 1 : Math.sin(i * .31) * .015;
      output.process(left, -left * 1.7);
      assert.ok(Number.isFinite(output.left) && Number.isFinite(output.right));
      assert.ok(Math.max(Math.abs(output.left), Math.abs(output.right)) <= OUTPUT_CEILING + 1e-12, `ceiling at ${rate}`);
      assert.ok(Math.abs(output.right + output.left * 1.7) < 1e-12, `linked gain at ${rate}`);
    }
  }
});

test('master scales finished sound, including limiter recovery, with exact silence at zero', () => {
  const full = new FractalOutput(SR, 16), half = new FractalOutput(SR, 16), mute = new FractalOutput(SR, 16);
  for (let i = 0; i < SR / 2; i++) {
    const signal = Math.sin(i * .11) * (i < 4000 ? .7 : .02);
    full.process(signal, signal * .4, 1);
    half.process(signal, signal * .4, .5);
    mute.process(signal, signal * .4, 0);
    assert.equal(half.left, full.left * .5);
    assert.equal(half.right, full.right * .5);
    assert.ok(mute.left === 0 && mute.right === 0);
    assert.equal(half.gain, full.gain);
    assert.equal(mute.gain, full.gain);
  }
});

test('clearing the output flushes lookahead audio and gain reduction before restart', () => {
  const output = new FractalOutput(SR, 16);
  for (let i = 0; i < SR / 10; i++) output.process(.9, -.7);
  assert.ok(output.gain < .1);
  output.clear();
  assert.equal(output.gain, 1);
  for (let i = 0; i < output.lookahead * 2; i++) {
    output.process(0, 0);
    assert.equal(output.left, 0);
    assert.equal(output.right, 0);
  }
});

test('a zero master selected before Play produces no startup burst', () => {
  const state = createDefaultState('grammar');
  const dsp = new FractalDSP(SR, state, generateStructure(state));
  dsp.setLevel(0); dsp.setPlaying(true);
  const left = new Float32Array(128), right = new Float32Array(128);
  for (let i = 0; i < 100; i++) {
    dsp.process(left, right);
    assert.ok(left.every(value => value === 0));
    assert.ok(right.every(value => value === 0));
  }
  assert.ok(dsp.phase > 0, 'silent playback retains the musical clock');
});
