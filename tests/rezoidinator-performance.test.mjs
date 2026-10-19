import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createConfiguration, DEFAULTS, COEFFICIENT_KEYS } from '../src/instruments/simd-resonator-rust/model.js';

const scalarBytes = await readFile(new URL('../assets/wasm/rust-resonator-scalar.wasm', import.meta.url));
const simdBytes = await readFile(new URL('../assets/wasm/rust-resonator-simd.wasm', import.meta.url));
let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(structuredClone(message)) }; } };
globalThis.registerProcessor = (_name, value) => { Processor = value; };
await import('../src/instruments/simd-resonator-rust/processor.js');
const zero = new Float32Array(128);
const output = () => [Array.from({ length: 2 }, () => new Float32Array(128)), Array.from({ length: 16 }, () => new Float32Array(128))];
function engine(configuration = createConfiguration(), backend = 'simd') {
  const p = new Processor();
  p.message({ type: 'install', scalarBytes, simdBytes, configuration, requestedBackend: backend });
  p.message({ type: 'signal', configuration: {} });
  assert.equal(p.ready, true); return p;
}
function run(p, count = 1, input = zero) {
  const out = output(), samples = new Float32Array(count * 128);
  for (let block = 0; block < count; block++) {
    p.process([[input]], out);
    for (const bus of out) for (const channel of bus) assert.ok(channel.every(value => Number.isFinite(value) && Math.abs(value) <= .950001));
    samples.set(out[0][0], block * 128);
  }
  return { samples, out };
}
function oneMode(baseFrequency, index = 0) {
  const c = createConfiguration({ ...DEFAULTS, modeCount: 32, spectralSpan: 32, baseFrequency, spread: 0 });
  c.gain.fill(0); c.gain[index] = 1; c.outputScale = .2; c.decay[index] = 1;
  c.panLeft[index] = c.panRight[index] = 1;
  return c;
}
function measuredFrequency(samples) {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] < 0 && samples[i] >= 0) {
    crossings.push(i - 1 - samples[i - 1] / (samples[i] - samples[i - 1]));
  }
  assert.ok(crossings.length > 3);
  return (crossings.length - 1) * 48000 / (crossings.at(-1) - crossings[0]);
}

test('live performance changes raise and lower audible pitch without retriggering the ringing state', () => {
  for (const backend of ['scalar', 'simd']) {
    const p = engine(oneMode(82), backend);
    p.message({ type: 'excite', kind: 'impulse', strength: 1 }); run(p, 8);
    assert.ok(Math.abs(measuredFrequency(run(p, 64).samples) - 82) < .05);
    for (const frequency of [164, 48]) {
      const before = p.kernel.real.slice();
      p.message({ type: 'performance', configuration: oneMode(frequency) });
      assert.deepEqual(p.kernel.real, before); assert.equal(p.transition, 'steady');
      run(p, 8);
      assert.ok(Math.abs(measuredFrequency(run(p, 64).samples) - frequency) < .05);
      assert.equal(p.performanceFrames, 0); assert.equal(p.performanceConfiguration, null);
    }
  }
});

test('rotation smoothing preserves unit magnitude instead of damping a bent mode', () => {
  const p = engine(oneMode(42, 31)); p.kernel.real[31] = 1;
  const target = oneMode(220, 31);
  p.message({ type: 'performance', configuration: target });
  for (let block = 0; block < 8; block++) {
    run(p);
    assert.ok(Math.abs(Math.hypot(p.kernel.cosine[31], p.kernel.sine[31]) - 1) < 1e-7);
    assert.ok(Math.abs(Math.hypot(p.kernel.real[31], p.kernel.imaginary[31]) - 1) < .001,
      'frequency bend retains stored modal energy');
  }
  assert.equal(p.kernel.cosine[31], target.cosine[31]); assert.equal(p.kernel.sine[31], target.sine[31]);
});

test('60/120Hz gesture updates leave a long excitation sample-identical and its duration unchanged', () => {
  for (const period of [6, 3]) {
    const p = engine(), reference = engine();
    for (const value of [p, reference]) value.message({ type: 'excite', kind: 'white-noise', durationMs: 300, strength: .8 });
    const a = output(), b = output();
    for (let block = 0; block < 120; block++) {
      if (block % period === 0) p.message({ type: 'performance', configuration: createConfiguration({ ...DEFAULTS,
        baseFrequency: 42 * (220 / 42) ** ((block % 60) / 60), strikePosition: .1 + block / 180, hardness: (block % 31) / 30 }) });
      p.process([[zero]], a); reference.process([[zero]], b);
      assert.equal(p.transition, 'steady'); assert.deepEqual(p.sourceBlock, reference.sourceBlock);
      assert.equal(p.signal.excitation.age[0], reference.signal.excitation.age[0]);
      if (block < 112) assert.ok(a[0][0].some(value => value !== 0));
    }
    assert.equal(p.signal.excitation.age[0], 14400); assert.ok(p.sourceBlock.every(value => value === 0));
  }
});

test('performance coefficients arrive exactly, smooth gain/strike/scale, and follow scalar/SIMD handoff', () => {
  const p = engine(), initialScale = p.outputScale;
  const target = createConfiguration({ ...DEFAULTS, baseFrequency: 165, strikePosition: .8, hardness: .1 });
  const strike = p.kernel.strike[3];
  p.message({ type: 'performance', configuration: target }); run(p);
  assert.notEqual(p.kernel.strike[3], strike); assert.notEqual(p.kernel.strike[3], target.strike[3]);
  if (initialScale !== target.outputScale) assert.ok(p.outputScale > Math.min(initialScale, target.outputScale) && p.outputScale < Math.max(initialScale, target.outputScale));
  const before = p.kernel.real.slice(); p.message({ type: 'backend', backend: 'scalar' }); assert.deepEqual(p.kernel.real, before);
  run(p, 7);
  for (const kernel of Object.values(p.kernels)) for (const key of COEFFICIENT_KEYS) assert.deepEqual(kernel[key], target[key]);
  assert.equal(p.outputScale, target.outputScale);
  const frames = p.totalFrames; run(p, 2); assert.equal(p.performanceConfiguration, null); assert.equal(p.totalFrames, frames + 256);
});

test('full configure supersedes older gestures; newer matching gestures amend its pending target', () => {
  const p = engine();
  p.message({ type: 'performance', configuration: createConfiguration({ ...DEFAULTS, baseFrequency: 160 }) }); run(p);
  const body = createConfiguration({ ...DEFAULTS, modeCount: 32, spectralSpan: 32, baseFrequency: 70 });
  p.message({ type: 'configure', configuration: body });
  assert.equal(p.performanceConfiguration, null); assert.equal(p.transition, 'fall');
  p.message({ type: 'performance', configuration: createConfiguration({ ...DEFAULTS, baseFrequency: 170 }) });
  assert.equal(p.messages.at(-1).type, 'error'); assert.equal(p.pendingConfiguration, body);
  const latest = createConfiguration({ ...DEFAULTS, modeCount: 32, spectralSpan: 32, baseFrequency: 180 });
  p.message({ type: 'performance', configuration: latest }); assert.equal(p.pendingConfiguration, latest);
  run(p, 2); assert.equal(p.modeCount, 32); assert.equal(p.transition, 'steady');
  assert.deepEqual(p.kernel.cosine, latest.cosine);
  const after = createConfiguration({ ...DEFAULTS, modeCount: 32, spectralSpan: 32, baseFrequency: 100 });
  p.message({ type: 'performance', configuration: after }); run(p, 8); assert.deepEqual(p.kernel.cosine, after.cosine);
  p.message({ type: 'performance', configuration: latest }); p.message({ type: 'reset' });
  assert.equal(p.performanceConfiguration, null); assert.deepEqual(p.kernel.cosine, latest.cosine);
  assert.ok(run(p).samples.every(value => value === 0));
});

test('invalid performance configurations never partly replace a valid pending gesture', () => {
  const p = engine(), good = createConfiguration({ ...DEFAULTS, baseFrequency: 110 });
  p.message({ type: 'performance', configuration: good });
  const nonfinite = createConfiguration(); nonfinite.gain[17] = NaN;
  const unstable = createConfiguration(); unstable.decay[5] = 1.1;
  const zeroRotation = createConfiguration(); zeroRotation.cosine[7] = zeroRotation.sine[7] = 0;
  for (const bad of [createConfiguration({ ...DEFAULTS, modeCount: 32 }), nonfinite, unstable, zeroRotation]) {
    p.message({ type: 'performance', configuration: bad }); assert.equal(p.messages.at(-1).type, 'error');
    assert.equal(p.performanceConfiguration, good);
  }
  run(p, 8); assert.deepEqual(p.kernel.cosine, good.cosine);
});

test('4096-mode bends remain finite with maximum FFT overlap and surround and report callback cost', t => {
  const settings = { ...DEFAULTS, modeCount: 4096, fftSize: 4096, fftHopRatio: .125 };
  const p = engine(createConfiguration(settings));
  p.message({ type: 'signal', configuration: { bodyEnabled: true, processingEnabled: true, resynthesisEnabled: true,
    resynthesisMix: .5, reverbEnabled: true, reverbMix: .5, drive: 8 } });
  p.message({ type: 'spatial', configuration: { enabled: true, speakerCount: 16, pattern: 'scatter' } });
  p.message({ type: 'mic', active: true });
  const out = output(), input = new Float32Array(128), reports = [];
  for (let block = 0; block < 240; block++) {
    if (block % 3 === 0) p.message({ type: 'performance', configuration: createConfiguration({ ...settings,
      baseFrequency: 42 * (220 / 42) ** ((block % 120) / 120), hardness: (block % 60) / 60 }) });
    if (block === 180) p.message({ type: 'backend', backend: 'scalar' });
    for (let frame = 0; frame < 128; frame++) input[frame] = .1 * Math.sin((block * 128 + frame) * .047);
    p.process([[input]], out);
    for (const bus of out) for (const channel of bus) assert.ok(channel.every(value => Number.isFinite(value) && Math.abs(value) <= .950001));
    for (let frame = 0; frame < 128; frame++) assert.ok(out[1].reduce((sum, channel) => sum + Math.abs(channel[frame]), 0) <= .95 * Math.SQRT2 + 1e-6);
    if ((block + 1) % 48 === 0) reports.push(p.messages.filter(message => message.type === 'telemetry').at(-1));
  }
  assert.equal(p.modeCount, 4096); assert.equal(p.totalFrames, 30720); assert.equal(p.transition, 'steady');
  t.diagnostic(JSON.stringify(reports.slice(1).map(report => ({ backend: report.backend,
    callbackMeanMicroseconds: report.callbackMicros, callbackMaxMicroseconds: report.callbackMaxMicros,
    budgetMicroseconds: report.budgetMicros, scope: 'Node measurement; excludes message validation and physical device behavior' }))));
  p.message({ type: 'dispose' }); assert.equal(p.process([[zero]], out), false);
});
