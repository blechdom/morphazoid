import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSimdResonatorConfiguration } from '../src/simd-resonator.js';

const root = new URL('../', import.meta.url);
const blockSize = 128;
const maxModes = 4096;
const pointers = Object.freeze({ input: 'input_ptr', outputLeft: 'output_left_ptr', outputRight: 'output_right_ptr',
  real: 'real_ptr', imaginary: 'imaginary_ptr', cosine: 'cosine_ptr', sine: 'sine_ptr', decay: 'decay_ptr',
  strike: 'strike_ptr', gain: 'gain_ptr', panLeft: 'pan_left_ptr', panRight: 'pan_right_ptr', energy: 'energy_ptr' });
const coefficients = ['cosine', 'sine', 'decay', 'strike', 'gain', 'panLeft', 'panRight'];
const states = ['real', 'imaginary', 'energy'];

async function load(variant, original = false) {
  const bytes = await readFile(new URL(`assets/wasm/${original ? 'simd' : 'rust'}-resonator-${variant}.wasm`, root));
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const instance = new WebAssembly.Instance(module);
  const e = instance.exports;
  const capacity = original ? 128 : maxModes;
  const views = Object.fromEntries(Object.entries(pointers).map(([key, pointer]) => [key,
    new Float32Array(e.memory.buffer, e[pointer](), ['input', 'outputLeft', 'outputRight'].includes(key) ? blockSize : capacity)]));
  return { e, module, ...views };
}

function configure(kernel, configuration) {
  kernel.e.reset();
  for (const key of coefficients) kernel[key].set(configuration[key]);
}

function denseConfiguration(modes, sampleRate = 48_000) {
  const result = { modeCount: modes, outputScale: 0.1 / Math.sqrt(modes / 32) };
  for (const key of coefficients) result[key] = new Float32Array(modes);
  for (let mode = 0; mode < modes; mode += 1) {
    const position = mode / Math.max(1, modes - 1);
    const frequency = 70 * (15_000 / 70) ** position;
    const phase = 2 * Math.PI * frequency / sampleRate;
    const pan = Math.sin((mode + 1) * 1.618) * 0.8;
    result.cosine[mode] = Math.cos(phase);
    result.sine[mode] = Math.sin(phase);
    result.decay[mode] = Math.exp(-1 / (sampleRate * (0.3 + (1 - position) * 2)));
    result.strike[mode] = Math.sin((mode + 1) * 2.399963) * (0.2 + 0.8 * (1 - position));
    result.gain[mode] = 1 / Math.sqrt(1 + position * 12);
    result.panLeft[mode] = Math.sqrt((1 - pan) * 0.5);
    result.panRight[mode] = Math.sqrt((1 + pan) * 0.5);
  }
  return result;
}

function fillInput(kernel, block, sampleRate = 48_000) {
  for (let frame = 0; frame < blockSize; frame += 1) {
    const time = (block * blockSize + frame) / sampleRate;
    kernel.input[frame] = Math.sin(time * Math.PI * 2 * 193) * 0.025 + Math.sin(time * Math.PI * 2 * 1747) * 0.015;
  }
}

function maximumDifference(a, b) {
  let maximum = 0;
  for (let index = 0; index < a.length; index += 1) maximum = Math.max(maximum, Math.abs(a[index] - b[index]));
  return maximum;
}

function assertSignal(kernel) {
  for (const channel of [kernel.outputLeft, kernel.outputRight]) {
    assert.ok(channel.every(Number.isFinite), 'output remains finite');
    assert.ok(channel.every(value => Math.abs(value) <= 1), 'soft clipping bounds output');
  }
  for (const key of states) assert.ok(kernel[key].every(Number.isFinite), `${key} remains finite`);
}

test('Rust scalar and SIMD expose one fixed, aligned, import-free 4,096-mode ABI', async () => {
  for (const variant of ['scalar', 'simd']) {
    const kernel = await load(variant);
    assert.equal(kernel.e.abi_version(), 2);
    assert.equal(kernel.e.block_size(), blockSize);
    assert.equal(kernel.e.max_modes(), maxModes);
    assert.equal(kernel.e.lane_width(), variant === 'simd' ? 4 : 1);
    assert.equal(kernel.e.memory.buffer.byteLength, 393216);
    assert.throws(() => kernel.e.memory.grow(1), RangeError);
    const regions = Object.entries(pointers).map(([key, pointer]) => {
      const start = kernel.e[pointer]();
      assert.equal(start % 16, 0, `${key} is aligned`);
      return { key, start, end: start + kernel[key].byteLength };
    }).sort((a, b) => a.start - b.start);
    for (let index = 1; index < regions.length; index += 1) {
      assert.ok(regions[index - 1].end <= regions[index].start, 'buffer regions never overlap');
    }
    assert.ok(regions.at(-1).end <= kernel.e.memory.buffer.byteLength);
  }
});

test('Rust kernels preserve original Resonator waveforms and energy with identical coefficients', async () => {
  for (const variant of ['scalar', 'simd']) {
    const [old, current] = await Promise.all([load(variant, true), load(variant)]);
    for (const sampleRate of [44_100, 48_000, 96_000]) {
      for (const modeCount of [32, 80, 128]) {
        const configuration = createSimdResonatorConfiguration({ modeCount, baseFrequency: 82, spread: 0.37,
          hardness: 0.84, strikePosition: 0.39, decaySeconds: 2.6 }, sampleRate);
        configure(old, configuration); configure(current, configuration);
        let difference = 0;
        for (let block = 0; block < 48; block += 1) {
          fillInput(old, block, sampleRate); current.input.set(old.input);
          const impulse = block === 0 ? 0.78 : block === 23 ? -0.24 : 0;
          old.e.process_resonator(blockSize, modeCount, impulse, configuration.outputScale);
          current.e.process_resonator(blockSize, modeCount, impulse, configuration.outputScale);
          assertSignal(current);
          difference = Math.max(difference, maximumDifference(old.outputLeft, current.outputLeft), maximumDifference(old.outputRight, current.outputRight));
        }
        assert.ok(difference < 5e-5, `${variant}, ${sampleRate} Hz, ${modeCount} modes: difference ${difference}`);
        for (const key of states) assert.ok(maximumDifference(old[key], current[key].subarray(0, 128)) < 5e-5, `${key} matches original`);
      }
    }
  }
});

test('Rust scalar and SIMD agree at expanded capacities with input and repeated strikes', async () => {
  const [scalar, simd] = await Promise.all([load('scalar'), load('simd')]);
  for (const modes of [4, 128, 132, 1024, 4096]) {
    const configuration = denseConfiguration(modes);
    configure(scalar, configuration); configure(simd, configuration);
    let difference = 0;
    let power = 0;
    for (let block = 0; block < 64; block += 1) {
      fillInput(scalar, block); simd.input.set(scalar.input);
      for (const kernel of [scalar, simd]) {
        kernel.e.process_resonator(blockSize, modes, block % 17 === 0 ? 0.9 : 0, configuration.outputScale);
        assertSignal(kernel);
      }
      difference = Math.max(difference, maximumDifference(scalar.outputLeft, simd.outputLeft), maximumDifference(scalar.outputRight, simd.outputRight));
      for (const value of simd.outputLeft) power += value * value;
    }
    assert.ok(difference < 5e-5, `${modes} modes: difference ${difference}`);
    assert.ok(power > 0.01, `${modes} modes produce signal`);
    for (const key of states) assert.ok(maximumDifference(scalar[key], simd[key]) < 5e-5, `${key} matches at ${modes}`);
  }
});

test('the final modal group contributes independently; inactive states are preserved', async () => {
  for (const variant of ['scalar', 'simd']) {
    const kernel = await load(variant);
    const index = maxModes - 1;
    kernel.cosine[index] = Math.cos(2 * Math.PI * 440 / 48_000);
    kernel.sine[index] = Math.sin(2 * Math.PI * 440 / 48_000);
    kernel.decay[index] = 0.999;
    kernel.strike[index] = 1; kernel.gain[index] = 1;
    kernel.panLeft[index] = 0.8; kernel.panRight[index] = 0.6;
    kernel.e.process_resonator(blockSize, 128, 1, 0.5);
    assert.ok(kernel.outputLeft.every(value => value === 0));
    assert.equal(kernel.imaginary[index], 0);
    kernel.e.process_resonator(blockSize, maxModes, 1, 0.5);
    assert.ok(Math.max(...kernel.outputLeft.map(Math.abs)) > 0.2);
    assert.ok(kernel.energy[index] > 0.5);
    const tail = states.map(key => kernel[key][index]);
    kernel.e.process_resonator(blockSize, 4095, 0, 0.5);
    assert.deepEqual(states.map(key => kernel[key][index]), tail, 'unaligned count excludes final group');
    assertSignal(kernel);
  }
});

test('partial processing respects frame boundaries and preserves continuous state across tiles', async () => {
  for (const variant of ['scalar', 'simd']) {
    const [whole, split] = await Promise.all([load(variant), load(variant)]);
    const configuration = denseConfiguration(260);
    configure(whole, configuration); configure(split, configuration);
    fillInput(whole, 0);
    whole.e.process_resonator(128, 260, 0.7, configuration.outputScale);
    let offset = 0;
    for (const frames of [1, 7, 13, 32, 64, 11]) {
      split.input.fill(0);
      split.input.set(whole.input.subarray(offset, offset + frames));
      split.outputLeft.fill(0.321); split.outputRight.fill(-0.123);
      split.e.process_resonator(frames, 260, offset === 0 ? 0.7 : 0, configuration.outputScale);
      assert.ok(maximumDifference(whole.outputLeft.subarray(offset, offset + frames), split.outputLeft.subarray(0, frames)) < 1e-7);
      assert.ok(maximumDifference(whole.outputRight.subarray(offset, offset + frames), split.outputRight.subarray(0, frames)) < 1e-7);
      assert.ok(split.outputLeft.subarray(frames).every(value => value === Math.fround(0.321)));
      offset += frames;
    }
    for (const key of states) assert.deepEqual(split[key], whole[key]);
  }
});

test('hostile bounds and nonfinite scalar inputs cannot grow memory or poison subsequent blocks', async () => {
  for (const variant of ['scalar', 'simd']) {
    const kernel = await load(variant);
    const configuration = denseConfiguration(maxModes);
    configure(kernel, configuration);
    const memory = kernel.e.memory.buffer;
    for (const frames of [-2147483648, -1, 0, 1, 127, 128, 2147483647]) {
      for (const modes of [-2147483648, 0, 3, 4095, 4096, 2147483647]) {
        kernel.input.fill(Number.NaN);
        kernel.e.process_resonator(frames, modes, Infinity, Number.NaN);
        assertSignal(kernel);
        assert.equal(kernel.e.memory.buffer, memory);
      }
    }
    kernel.real[257] = Infinity; kernel.imaginary[3000] = NaN;
    kernel.energy[4000] = Infinity;
    kernel.e.process_resonator(128, maxModes, 0, configuration.outputScale);
    assertSignal(kernel);
    kernel.strike.fill(0);
    kernel.strike[0] = 1;
    kernel.e.process_resonator(128, maxModes, 1, configuration.outputScale);
    assert.ok(kernel.outputLeft.some(value => Math.abs(value) > 0.001), 'valid following strike recovers');
  }
});

test('reset clears tails and buffers while retaining coefficients and deterministic retrigger', async () => {
  for (const variant of ['scalar', 'simd']) {
    const kernel = await load(variant);
    const configuration = denseConfiguration(maxModes);
    configure(kernel, configuration);
    kernel.e.process_resonator(128, maxModes, 0.8, configuration.outputScale);
    const first = kernel.outputLeft.slice();
    kernel.e.reset_resonator();
    for (const key of states) assert.ok(kernel[key].every(value => value === 0));
    assert.deepEqual(kernel.outputLeft, first, 'state-only reset preserves output buffer semantics');
    for (const key of coefficients) assert.deepEqual(kernel[key], configuration[key]);
    kernel.e.reset();
    for (const key of ['input', 'outputLeft', 'outputRight']) assert.ok(kernel[key].every(value => value === 0));
    kernel.e.process_resonator(128, maxModes, 0.8, configuration.outputScale);
    assert.deepEqual(kernel.outputLeft, first);
  }
});

test('Rust build provenance and both shipped artifacts verify without requiring a compiler', () => {
  const result = spawnSync(process.execPath, ['scripts/build-rust-resonator-wasm.mjs', '--check'], { cwd: fileURLToPath(root), encoding: 'utf8', env: { ...process.env, RUSTC: '/nonexistent/rustc' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /4,096 modes, fixed memory, no imports/);
});
