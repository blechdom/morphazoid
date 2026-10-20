import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { createConfiguration, DEFAULTS, kernelViews, MAX_MODES, SPATIAL_POINTERS } from '../src/instruments/simd-resonator-rust/model.js';
import { SPATIAL_DEFAULTS, sanitizeSpatialSettings, spatialPosition, equalPowerRoute, SpatialRouter } from '../src/instruments/simd-resonator-rust/spatial-model.js';
import { FftResynth } from './helpers/rezoidinator-js-fft-reference.mjs';

const scalarBytes = await readFile(new URL('../assets/wasm/rust-resonator-scalar.wasm', import.meta.url));
const simdBytes = await readFile(new URL('../assets/wasm/rust-resonator-simd.wasm', import.meta.url));
const coefficients = ['cosine', 'sine', 'decay', 'strike', 'gain', 'panLeft', 'panRight'];
async function kernel(backend) { return kernelViews((await WebAssembly.instantiate(backend === 'scalar' ? scalarBytes : simdBytes)).instance.exports); }
function configure(k, c) { k.exports.reset(); for (const key of coefficients) k[key].set(c[key]); }
let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(structuredClone(value)) }; } };
globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
await import('../src/instruments/simd-resonator-rust/processor.js');
function processor(settings = DEFAULTS, backend = 'simd') {
  const p = new Processor();
  p.message({ type: 'install', scalarBytes, simdBytes, requestedBackend: backend, configuration: createConfiguration(settings) });
  assert.equal(p.ready, true); return p;
}
function block(p, index = 0, silent = false) {
  const input = Float32Array.from({ length: 128 }, (_, frame) => silent ? 0 : .2 * Math.sin((index * 128 + frame) * .041) + .08 * Math.sin((index * 128 + frame) * .379));
  const output = [Array.from({ length: 2 }, () => new Float32Array(128)), Array.from({ length: 16 }, () => new Float32Array(128))];
  const running = p.process([[input]], output);
  for (const bus of output) for (const channel of bus) assert.ok(channel.every(Number.isFinite));
  for (let frame = 0; frame < 128; frame++) {
    assert.ok(output[1].reduce((sum, channel) => sum + Math.abs(channel[frame]), 0) <= .95 * Math.SQRT2 + 1e-6);
    for (const channel of output[1]) assert.ok(Math.abs(channel[frame]) <= .950001);
  }
  return { stereo: output[0], spatial: output[1], running };
}
const power = samples => samples.reduce((sum, value) => sum + value * value, 0);
const difference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));

test('spatial controls bound finite native values, distribute every pattern, and hold audio-clock phase', () => {
  const settings = sanitizeSpatialSettings({ speakerCount: Infinity, span: -10, offset: 20, rate: -2 });
  assert.equal(settings.speakerCount, 8); assert.equal(settings.span, 0); assert.equal(settings.offset, 1); assert.equal(settings.rate, -1);
  for (const pattern of ['ascending', 'descending', 'alternate', 'scatter']) {
    const s = { ...SPATIAL_DEFAULTS, enabled: true, pattern };
    const occupied = new Set();
    for (let index = 0; index < 4096; index++) {
      const position = spatialPosition(index, 4096, s, .37);
      assert.ok(position >= 0 && position < 1);
      const route = equalPowerRoute(position, 16); occupied.add(route.left);
      assert.ok(Math.abs(route.leftGain ** 2 + route.rightGain ** 2 - 1) < 1e-12);
    }
    assert.equal(occupied.size, 16, pattern);
  }
  const router = new SpatialRouter(); router.configure({ ...SPATIAL_DEFAULTS, enabled: true, motion: true, rate: .5 });
  router.advance(4800); assert.ok(Math.abs(router.phase - .05) < 1e-12);
  router.configure({ ...router.settings, motion: false }); router.advance(4800); assert.ok(Math.abs(router.phase - .05) < 1e-12);
  router.configure({ ...router.settings, motion: true, rate: -.5 }); router.advance(4800); assert.ok(router.phase < 1e-12);
});

test('spatial ABI remains fixed and separates every route and output region', async () => {
  for (const backend of ['scalar', 'simd']) {
    const k = await kernel(backend);
    assert.equal(k.exports.max_spatial_channels(), 16); assert.equal(k.exports.memory.buffer.byteLength, 16777216);
    const keys = [...coefficients, 'input', 'outputLeft', 'outputRight', 'real', 'imaginary', 'energy', 'spatialOutput', ...Object.keys(SPATIAL_POINTERS)];
    const regions = keys.map(key => ({ key, start: k[key].byteOffset, end: k[key].byteOffset + k[key].byteLength })).sort((a, b) => a.start - b.start);
    for (let i = 1; i < regions.length; i++) assert.ok(regions[i - 1].end <= regions[i].start, `${regions[i].key} never aliases`);
    assert.throws(() => k.exports.memory.grow(1), RangeError);
  }
});

test('each individual modal lane including4095 reaches its own bus before the stereo sum', async () => {
  for (const backend of ['scalar', 'simd']) {
    const [spatial, stereo] = await Promise.all([kernel(backend), kernel(backend)]);
    for (const [mode, channel] of [[0, 1], [1, 5], [2, 9], [3, 13], [37, 2], [4095, 15]]) {
      for (const k of [spatial, stereo]) {
        k.exports.reset(); for (const key of coefficients) k[key].fill(0);
        k.cosine[mode] = Math.cos(.051); k.sine[mode] = Math.sin(.051); k.decay[mode] = .9999;
        k.strike[mode] = 1; k.gain[mode] = 1; k.panLeft[mode] = .6; k.panRight[mode] = .8;
      }
      spatial.routeIndexA.fill(channel); spatial.routeIndexC.fill(channel); spatial.routeIndexB.fill((channel + 1) % 16); spatial.routeIndexD.fill((channel + 1) % 16);
      spatial.routeGainA.fill(1); spatial.routeGainC.fill(1); spatial.routeGainB.fill(0); spatial.routeGainD.fill(0);
      spatial.exports.process_resonator_spatial(128, MAX_MODES, .4, .2); stereo.exports.process_resonator(128, MAX_MODES, .4, .2);
      assert.deepEqual(spatial.outputLeft, stereo.outputLeft); assert.deepEqual(spatial.outputRight, stereo.outputRight);
      for (let bus = 0; bus < 16; bus++) {
        const energy = power(spatial.spatialOutput.subarray(bus * 128, (bus + 1) * 128));
        assert.ok(bus === channel ? energy > .1 : energy === 0, `mode${mode}→bus${channel}, checked${bus}`);
      }
    }
  }
});

test('sparse scalar and SIMD agree through pair crossings and partial tiles', async () => {
  const [scalar, simd] = await Promise.all([kernel('scalar'), kernel('simd')]);
  const config = createConfiguration({ ...DEFAULTS, modeCount: 4096 });
  const routers = [new SpatialRouter(), new SpatialRouter()];
  for (const k of [scalar, simd]) configure(k, config);
  for (let b = 0; b < 20; b++) {
    const frames = [128, 127, 1, 13][b % 4];
    const settings = { ...SPATIAL_DEFAULTS, enabled: true, speakerCount: b < 10 ? 16 : 5, offset: b < 10 ? .03 : .72, pattern: b < 10 ? 'ascending' : 'scatter', motion: true, rate: 1 };
    [scalar, simd].forEach((k, index) => {
      routers[index].configure(settings); routers[index].advance(frames); routers[index].prepare(k, config.modeCount, frames);
      k.exports.process_resonator_spatial(frames, config.modeCount, b === 0 ? .8 : 0, config.outputScale);
    });
    assert.ok(difference(scalar.spatialOutput, simd.spatialOutput) < 5e-5);
    assert.ok(scalar.spatialOutput.every(Number.isFinite));
  }
});

test('surround changes never alter the independent stereo output or restart its modal tails', () => {
  const p = processor({ ...DEFAULTS, modeCount: 1024 }), reference = processor({ ...DEFAULTS, modeCount: 1024 });
  for (const engine of [p, reference]) { engine.message({ type: 'mic', active: true }); engine.message({ type: 'trigger', strength: .8 }); }
  for (let b = 0; b < 100; b++) {
    if (b === 10 || b === 35 || b === 60) p.message({ type: 'spatial', configuration: { ...SPATIAL_DEFAULTS, enabled: true, speakerCount: b === 35 ? 5 : 16, pattern: b === 60 ? 'scatter' : 'ascending', motion: true, rate: -.3, offset: .8 } });
    if (b === 80) p.message({ type: 'spatial', configuration: SPATIAL_DEFAULTS });
    const actual = block(p, b), expected = block(reference, b);
    assert.deepEqual(actual.stereo, expected.stereo);
    if (b < 10 || b >= 80) assert.ok(actual.spatial.every(channel => channel.every(value => value === 0)));
    if (b > 20 && b < 80) assert.ok(actual.spatial.some(channel => power(channel) > .0001));
  }
  assert.deepEqual(p.kernel.real, reference.kernel.real);
  const report = p.messages.filter(value => value.type === 'telemetry').at(-1);
  assert.equal(report.spatialPeaks.length, 16); assert.ok(report.spatialPhase > 0);
});

test('FFT mono matches current original during smoothed controls and warm topology changes', async () => {
  let Original;
  const scope = vm.createContext({ Float32Array, Float64Array, Math, performance, sampleRate: 48000,
    AudioWorkletProcessor: globalThis.AudioWorkletProcessor, registerProcessor: (_name, cls) => { Original = cls; } });
  vm.runInContext(await readFile(new URL('../src/simd-resonator-processor.js', import.meta.url), 'utf8'), scope);
  const previous = new Original(), current = new FftResynth();
  for (let b = 0; b < 240; b++) {
    if ([0, 30, 80, 81, 140].includes(b)) {
      const config = createConfiguration({ ...DEFAULTS, fftSize: b < 30 ? 1024 : b < 81 ? 4096 : 512,
        fftDetail: b < 140 ? .9 : .1, fftInputGain: b < 80 ? 1.4 : 3, fftGateDb: -80 });
      previous.configureResynthesis(config); current.configureResynthesis(config);
    }
    previous.beginResynthesisTransition(); current.beginResynthesisTransition();
    for (let frame = 0; frame < 128; frame++) {
      const input = .13 * Math.sin((b * 128 + frame) * .063);
      assert.equal(current.processResynthesisSample(input), previous.processResynthesisSample(input));
    }
  }
});

test('paired inverse FFTs preserve a stationary mono route and spatialize low/high tones separately', () => {
  const fft = new FftResynth(); fft.configureResynthesis(createConfiguration({ ...DEFAULTS, fftSize: 1024, fftDetail: 1, fftMix: 1 }));
  fft.configureSpatial({ ...SPATIAL_DEFAULTS, enabled: true, speakerCount: 8, span: 0 }, 0);
  for (let frame = 0; frame < 8192; frame++) {
    const mono = fft.processResynthesisSample(.2 * Math.sin(frame * .049));
    assert.ok(Math.abs(mono - fft.spatialSample[0]) < 1e-7);
    for (let channel = 1; channel < 8; channel++) assert.ok(Math.abs(fft.spatialSample[channel]) < 1e-10);
  }
  const settings = { ...SPATIAL_DEFAULTS, enabled: true, speakerCount: 8 };
  fft.configureSpatial(settings, 0);
  const tones = [375, 4500], real = [new Float64Array(8), new Float64Array(8)], imaginary = [new Float64Array(8), new Float64Array(8)];
  for (let frame = 0; frame < 32768; frame++) {
    fft.processResynthesisSample(tones.reduce((sum, frequency) => sum + .12 * Math.sin(frame * frequency * Math.PI * 2 / 48000), 0));
    if (frame < 16384) continue;
    tones.forEach((frequency, tone) => {
      const angle = frame * frequency * Math.PI * 2 / 48000;
      for (let channel = 0; channel < 8; channel++) { real[tone][channel] += fft.spatialSample[channel] * Math.cos(angle); imaginary[tone][channel] += fft.spatialSample[channel] * Math.sin(angle); }
    });
  }
  const dominant = [];
  tones.forEach((frequency, tone) => {
    const band = Math.log(frequency / 70) / Math.log(12000 / 70) * 95;
    const route = equalPowerRoute(spatialPosition(band, 96, settings, 0, 'fft'), 8);
    const energies = real[tone].map((value, channel) => value ** 2 + imaginary[tone][channel] ** 2);
    assert.ok((energies[route.left] + energies[route.right]) / energies.reduce((a, b) => a + b, 0) > .95);
    dominant.push(energies.indexOf(Math.max(...energies)));
  });
  assert.notEqual(...dominant);
});

test('FFT edits and input stop retain spatial overlap; excluded layers stay audible; reset/dispose clear it', () => {
  const p = processor({ ...DEFAULTS, fftMix: 1 });
  p.message({ type: 'spatial', configuration: { ...SPATIAL_DEFAULTS, enabled: true, target: 'modes' } });
  p.message({ type: 'mic', active: true });
  for (let b = 0; b < 80; b++) block(p, b);
  const fixed = block(p, 80); assert.ok(power(fixed.spatial[0]) > .01);
  p.message({ type: 'configure', configuration: createConfiguration({ ...DEFAULTS, fftMix: 1, fftSize: 4096, fftHopRatio: .125 }) });
  assert.ok(power(block(p, 81).stereo[0]) > .001);
  p.message({ type: 'mic', active: false });
  assert.ok(power(block(p, 82, true).spatial[0]) > .001, 'queued input overlap remains after stop');
  p.message({ type: 'reset' }); assert.ok(block(p, 0, true).spatial.every(channel => channel.every(value => value === 0)));
  p.message({ type: 'spatial', configuration: { ...SPATIAL_DEFAULTS, enabled: true, target: 'fft' } });
  p.message({ type: 'trigger', strength: .8 }); const pluck = block(p, 0, true); assert.ok(power(pluck.spatial[0]) > 0, 'untargeted body remains at origin');
  p.message({ type: 'dispose' }); const disposed = block(p); assert.equal(disposed.running, false); assert.ok(disposed.spatial.every(channel => power(channel) === 0));
});

test('8192 modes, largest overlap FFT and16 channels stay finite through live routing on both backends', () => {
  for (const backend of ['simd', 'scalar']) {
    const p = processor({ ...DEFAULTS, modeCount: 8192, fftSize: 4096, fftBandCount: 1024, fftHopRatio: .125 }, backend);
    p.message({ type: 'mic', active: true });
    p.message({ type: 'spatial', configuration: { ...SPATIAL_DEFAULTS, enabled: true, speakerCount: 16, motion: true, rate: 1 } });
    let energy = 0;
    for (let b = 0; b < 100; b++) {
      if (b === 60) p.message({ type: 'spatial', configuration: { ...p.spatial.settings, speakerCount: 5, pattern: 'alternate', offset: .2 } });
      energy += block(p, b).spatial.reduce((sum, channel) => sum + power(channel), 0);
    }
    assert.ok(energy > .1); assert.ok(p.kernel.real.every(Number.isFinite));
  }
});
