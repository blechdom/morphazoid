import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RustFftResynth } from '../src/instruments/simd-resonator-rust/fft-rust.js';
import { sanitizeSpatialSettings } from '../src/instruments/simd-resonator-rust/spatial-model.js';

// The retained pre-port implementation is an independent waveform oracle.
// Extend only its envelope-band constant to exercise the new ceiling;
// FFT, shaping, windows, envelopes, routes, overlap/add and transition math are
// unchanged, and no Rust implementation source is involved in the oracle.
let referenceSource = await readFile(new URL('./helpers/rezoidinator-js-fft-reference.mjs', import.meta.url), 'utf8');
referenceSource = referenceSource.replace("'../../src/instruments/simd-resonator-rust/spatial-model.js'", JSON.stringify(new URL('../src/instruments/simd-resonator-rust/spatial-model.js', import.meta.url).href))
  .replace('const MAX_FFT_BANDS = 128;', 'const MAX_FFT_BANDS = 1024;');
const { FftResynth: ReferenceFft } = await import(`data:text/javascript;base64,${Buffer.from(referenceSource).toString('base64')}`);
const modules = await Promise.all((process.env.RUST_FFT_TEST_WASM ? [process.env.RUST_FFT_TEST_WASM]
  : ['../assets/wasm/rust-resonator-scalar.wasm', '../assets/wasm/rust-resonator-simd.wasm'].map(path => new URL(path, import.meta.url)))
  .map(async path => WebAssembly.compile(await readFile(path))));
const BLOCK = 128;
function pair(module, rate = 48000) {
  const exports = new WebAssembly.Instance(module).exports;
  exports.fft_init(rate);
  return { exports, rust: new RustFftResynth(rate).bind(exports), reference: new ReferenceFft(rate),
    input: new Float64Array(BLOCK), output: new Float64Array(BLOCK), spatial: new Float32Array(BLOCK * 16),
    frame: 0, rate, peak: 0, maxError: 0, spatialError: 0 };
}
function configure(p, settings) { p.reference.configureResynthesis(settings); p.rust.configureResynthesis(settings); }
function spatial(p, settings, phase = 0) {
  const value = sanitizeSpatialSettings(settings); p.reference.configureSpatial(value, phase); p.rust.configureSpatial(value, phase);
}
function render(p, blocks, { silence = false, impulse = false, phase = null } = {}) {
  for (let block = 0; block < blocks; block++) {
    if (phase !== null) spatial(p, p.rust.spatialSettings, phase + block * .003);
    for (let i = 0; i < BLOCK; i++) {
      const frame = p.frame + i; const time = frame / p.rate;
      p.input[i] = impulse ? Number(frame === 0) : silence ? 0
        : .19 * Math.sin(2 * Math.PI * 317 * time) + .11 * Math.cos(2 * Math.PI * 1843 * time)
          + .025 * Math.sin(time * time * 228413) + (frame % 1973 === 0 ? .18 : 0);
    }
    p.reference.beginResynthesisTransition(); p.rust.processBlock(p.input, p.output, p.spatial);
    for (let i = 0; i < BLOCK; i++) {
      const expected = p.reference.processResynthesisSample(p.input[i]);
      assert.ok(Number.isFinite(p.output[i]) && Math.abs(p.output[i]) <= 2);
      p.peak = Math.max(p.peak, Math.abs(p.output[i]));
      p.maxError = Math.max(p.maxError, Math.abs(p.output[i] - expected));
      for (let channel = 0; channel < 16; channel++) p.spatialError = Math.max(p.spatialError,
        Math.abs(p.spatial[channel * BLOCK + i] - p.reference.spatialSample[channel]));
    }
    p.frame += BLOCK;
  }
  assert.ok(p.maxError < 1e-8, `mono maximum error ${p.maxError}`);
  assert.ok(p.spatialError < 1e-6, `spatial maximum error ${p.spatialError}`);
  assert.equal(p.rust.fftAnalysisFill, p.reference.fftAnalysisFill);
  assert.equal(p.rust.fftSize, p.reference.fftSize);
  assert.equal(p.rust.fftHopSize, p.reference.fftHopSize);
  assert.equal(p.rust.fftBandCount, p.reference.fftBandCount);
  for (let band = 0; band < p.rust.fftBandCount; band++) {
    assert.ok(Math.abs(p.rust.fftInputTelemetry[band] - p.reference.fftInputTelemetry[band]) < 1e-6);
    assert.ok(Math.abs(p.rust.fftOutputTelemetry[band] - p.reference.fftOutputTelemetry[band]) < 1e-6);
  }
}

for (const [variant, module] of modules.entries()) {
  test(`Rust FFT variant ${variant}: fixed memory, no imports, 4096-point / 1024-band capacity`, () => {
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    const p = pair(module); assert.equal(p.exports.fft_max_size(), 4096); assert.equal(p.exports.fft_max_bands(), 1024);
    assert.throws(() => p.exports.memory.grow(1), RangeError);
    configure(p, { fftSize: 4096, fftBandCount: 1024, fftHopSize: 1024 });
    assert.equal(p.rust.fftSize, 4096); assert.equal(p.rust.fftBandCount, 1024);
    render(p, 180); assert.ok(p.peak > .01);
  });
  test(`Rust FFT variant ${variant}: all windows, small/default/large transforms preserve waveform`, () => {
    for (const fftWindow of [0, 1, 2, 3]) for (const fftSize of [256, 512, 1024, 2048, 4096]) {
      const p = pair(module, fftWindow % 2 ? 44100 : 48000);
      configure(p, { fftSize, fftWindow, fftHopSize: fftSize / 4, fftBandCount: 1024,
        fftLowFrequency: 83, fftHighFrequency: 11730, fftDetail: .43, fftResponseSeconds: .071, fftGateDb: -68 });
      render(p, Math.ceil((fftSize * 2 + 4096) / BLOCK)); assert.ok(p.peak > .01);
    }
  });
  test(`Rust FFT variant ${variant}: live parameters and queued topology edits preserve warm transitions`, () => {
    const p = pair(module);
    configure(p, { fftSize: 1024, fftHopSize: 256 }); render(p, 80);
    configure(p, { fftSize: 1024, fftHopSize: 256, fftDetail: .05, fftResponseSeconds: .6, fftInputGain: 3.2, fftGateDb: -41 }); render(p, 24);
    configure(p, { fftSize: 4096, fftHopSize: 1024, fftBandCount: 1024, fftWindow: 1 }); render(p, 12);
    assert.equal(p.rust.fftTransition, true);
    configure(p, { fftSize: 512, fftHopSize: 64, fftBandCount: 40, fftWindow: 2 }); render(p, 120);
    assert.equal(p.rust.fftTransition, false); assert.equal(p.rust.fftSize, 512);
    configure(p, { fftSize: 256, fftHopSize: 256, fftWindow: 3, fftDetail: .17 }); render(p, 40);
  });
  test(`Rust FFT variant ${variant}: sixteen-channel routes, odd speaker counts and motion preserve mono`, () => {
    const p = pair(module);
    configure(p, { fftSize: 1024, fftHopSize: 128, fftBandCount: 96 }); render(p, 40);
    for (const speakerCount of [4, 7, 16]) for (const pattern of ['ascending', 'descending', 'alternate', 'scatter']) {
      spatial(p, { enabled: true, speakerCount, target: 'fft', pattern, span: 1.81, offset: .17 });
      render(p, 12, { phase: .31 });
    }
    spatial(p, { enabled: true, speakerCount: 16, target: 'modes', pattern: 'scatter' }); render(p, 16);
    spatial(p, { enabled: false }); render(p, 16);
    assert.ok(p.spatial.every(value => value === 0));
  });
  test(`Rust FFT variant ${variant}: zero prehistory catches initial impulses and reset is deterministic`, () => {
    const p = pair(module); configure(p, { fftSize: 1024, fftHopSize: 256, fftDetail: .9 });
    p.reference.primeSilence(); p.rust.primeSilence(); render(p, 40, { impulse: true }); assert.ok(p.peak > 1e-4);
    p.reference.resetResynthesis(); p.rust.resetResynthesis(); render(p, 30, { silence: true });
    assert.ok(p.output.every(value => value === 0));
    assert.ok(p.rust.fftOutputTelemetry.every(value => value === 0));
  });
}

test('Rust FFT full-state transfer keeps queued edit, overlap tails and surround sample continuity', () => {
  const source = pair(modules[0]); const destination = pair(modules.at(-1));
  configure(source, { fftSize: 1024, fftHopSize: 128 });
  spatial(source, { enabled: true, speakerCount: 16, target: 'fft', pattern: 'scatter', offset: .23 });
  render(source, 50);
  configure(source, { fftSize: 2048, fftHopSize: 256 }); render(source, 4);
  configure(source, { fftSize: 4096, fftHopSize: 1024, fftBandCount: 1024 });
  const size = source.exports.fft_state_bytes(); assert.equal(destination.exports.fft_state_bytes(), size);
  new Uint8Array(destination.exports.memory.buffer, destination.exports.fft_state_ptr(), size)
    .set(new Uint8Array(source.exports.memory.buffer, source.exports.fft_state_ptr(), size));
  destination.rust.bind(destination.exports);
  for (let block = 0; block < 120; block++) {
    for (let i = 0; i < BLOCK; i++) source.input[i] = .27 * Math.sin((block * BLOCK + i) * .027);
    source.rust.processBlock(source.input, source.output, source.spatial);
    destination.rust.processBlock(source.input, destination.output, destination.spatial);
    assert.deepEqual(destination.output, source.output); assert.deepEqual(destination.spatial, source.spatial);
  }
});

test('additional envelope groups change spectral shaping of the same multitone input', t => {
  function shaped(bands) {
    const exports = new WebAssembly.Instance(modules.at(-1)).exports;
    exports.fft_init(48000);
    const fft = new RustFftResynth(48000).bind(exports);
    fft.configureResynthesis({ fftSize: 4096, fftHopSize: 512, fftBandCount: bands,
      fftLowFrequency: 100, fftHighFrequency: 18000, fftDetail: .15,
      fftResponseSeconds: .18, fftInputGain: 1, fftGateDb: -84 });
    const input = new Float64Array(BLOCK), output = new Float64Array(BLOCK);
    const captured = new Float64Array(BLOCK * 192);
    let seed = 123456789;
    for (let block = 0; block < 256; block++) {
      for (let i = 0; i < BLOCK; i++) {
        const frame = block * BLOCK + i, time = frame / 48000;
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        input[i] = .012 * (seed / 4294967296 * 2 - 1)
          + .13 * Math.sin(time * 2 * Math.PI * 3011.71875)
          + .08 * Math.sin(time * 2 * Math.PI * 3082.03125) * (.5 + .5 * Math.sin(time * 47))
          + .06 * Math.sin(time * 2 * Math.PI * 7218.75);
      }
      fft.processBlock(input, output);
      assert.ok(output.every(value => Number.isFinite(value) && Math.abs(value) < 2));
      if (block >= 64) captured.set(output, (block - 64) * BLOCK);
    }
    return captured;
  }
  const rendered = [128, 256, 1024].map(shaped);
  const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  for (const audio of rendered) assert.ok(rms(audio) > .01);
  for (let i = 1; i < rendered.length; i++) {
    const difference = rendered[i].map((value, frame) => value - rendered[i - 1][frame]);
    const change = rms(difference);
    t.diagnostic(`${[128, 256][i - 1]} to ${[256, 1024][i - 1]} groups: difference RMS ${change.toFixed(6)}`);
    assert.ok(change > .001, 'additional groups must affect rendered audio, not just telemetry');
  }
});
