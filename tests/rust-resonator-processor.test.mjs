import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { DEFAULTS, createConfiguration } from '../src/instruments/simd-resonator-rust/model.js';
import { FftResynth } from './helpers/rezoidinator-js-fft-reference.mjs';

const scalarBytes = await readFile(new URL('../assets/wasm/rust-resonator-scalar.wasm', import.meta.url));
const simdBytes = await readFile(new URL('../assets/wasm/rust-resonator-simd.wasm', import.meta.url));
let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } };
globalThis.registerProcessor = (_name, value) => { Processor = value; };
await import('../src/instruments/simd-resonator-rust/processor.js');
function processor(settings = DEFAULTS) {
  const p = new Processor();
  p.message({ type: 'install', scalarBytes, simdBytes, configuration: createConfiguration(settings), requestedBackend: 'simd' });
  assert.equal(p.ready, true, JSON.stringify(p.messages)); return p;
}
function block(p, input = new Float32Array(128)) {
  const left = new Float32Array(128), right = new Float32Array(128);
  const active = p.process([[input]], [[left, right]]);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  return { left, right, active };
}

test('retained FFT path reconstructs exactly the same samples as the original', async () => {
  let Original;
  const scope = vm.createContext({ Float32Array, Float64Array, Math, performance, sampleRate: 48000,
    AudioWorkletProcessor: globalThis.AudioWorkletProcessor, registerProcessor: (_name, cls) => { Original = cls; } });
  vm.runInContext(await readFile(new URL('../src/simd-resonator-processor.js', import.meta.url), 'utf8'), scope);
  const original = new Original(), next = new FftResynth();
  const config = createConfiguration(DEFAULTS);
  original.configureResynthesis(config); next.configureResynthesis(config);
  for (let frame = 0; frame < 8192; frame++) {
    const input = Math.sin(frame * .052) * .16 + Math.cos(frame * .19) * .07;
    assert.equal(next.processResynthesisSample(input), original.processResynthesisSample(input));
  }
});
test('AudioWorklet drives high modes, retains scalar tails and clears removed states', () => {
  const p = processor({ ...DEFAULTS, modeCount: 4096 });
  p.message({ type: 'trigger', strength: .8 }); block(p);
  assert.ok(p.kernel.energy.slice(128).some(value => value > 0));
  const real = p.kernel.real.slice(); p.message({ type: 'backend', backend: 'scalar' });
  assert.deepEqual(p.kernel.real, real);
  p.message({ type: 'configure', configuration: createConfiguration({ ...DEFAULTS, modeCount: 32 }) });
  block(p); block(p);
  assert.equal(p.modeCount, 32);
  for (const kernel of Object.values(p.kernels)) for (const key of ['real', 'imaginary', 'energy']) assert.ok(kernel[key].slice(32).every(value => value === 0));
  p.message({ type: 'reset' });
  p.message({ type: 'configure', configuration: createConfiguration({ ...DEFAULTS, modeCount: 4096 }) });
  block(p); block(p); assert.ok(block(p).left.every(value => value === 0));
});
test('bank edits ramp the old tail down before applying a new bank and defer its strike', () => {
  const p = processor({ ...DEFAULTS, modeCount: 2048 });
  p.message({ type: 'trigger', strength: .8 });
  for (let i = 0; i < 8; i++) block(p);
  p.message({ type: 'configure', configuration: createConfiguration({ ...DEFAULTS, modeCount: 32 }) });
  p.message({ type: 'trigger', strength: .7 });
  const falling = block(p); assert.equal(falling.left[127], 0); assert.equal(p.impulse, .7);
  const rising = block(p); assert.equal(p.impulse, 0);
  assert.ok(Math.abs(rising.left[0] - falling.left[127]) < .01);
  assert.ok(rising.left.some(value => value !== 0)); assert.equal(p.modeCount, 32);
});
test('only complete finite configuration updates can replace the running body', () => {
  const p = processor(); const before = p.kernel.cosine.slice();
  const bad = createConfiguration({ ...DEFAULTS, modeCount: 4096 }); bad.gain[301] = NaN;
  p.message({ type: 'configure', configuration: bad });
  assert.equal(p.messages.at(-1).type, 'error'); assert.equal(p.modeCount, 512);
  assert.deepEqual(p.kernel.cosine, before); assert.equal(p.ready, true);
});
test('full bank and maximum-overlap FFT run together, report callback timing, and dispose silently', () => {
  const p = processor({ ...DEFAULTS, modeCount: 4096, fftSize: 4096, fftHopRatio: .125 });
  p.message({ type: 'mic', active: true });
  let energy = 0;
  for (let b = 0; b < 96; b++) {
    const input = Float32Array.from({ length: 128 }, (_, i) => .2 * Math.sin((b * 128 + i) * .04));
    energy += block(p, input).left.reduce((sum, value) => sum + value * value, 0);
  }
  assert.ok(energy > 1);
  const report = p.messages.filter(message => message.type === 'telemetry').at(-1);
  assert.equal(report.renderedFrames, 12288); assert.equal(report.audibleModes, 4096);
  assert.ok(report.callbackMicros >= report.kernelMicros); assert.ok(report.budgetMicros > 0);
  p.message({ type: 'dispose' }); const after = block(p);
  assert.equal(after.active, false); assert.ok(after.left.every(value => value === 0));
});
