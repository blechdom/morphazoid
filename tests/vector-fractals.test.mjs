import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_STATE, PRESETS, TABLE_SIZE, HARMONICS, sanitizeState, componentPoint, juliaCoefficients, fft, createFrame, createBank, mipSelection, randomizeState } from '../src/instruments/vector-fractals/model.js';
import { MANDELBROT_COEFFICIENTS } from '../src/instruments/vector-fractals/mandelbrot-coefficients.js';
import { VectorDSP } from '../src/instruments/vector-fractals/dsp.js';

const close = (x, y, tolerance = 1e-8) => assert.ok(Math.abs(x - y) < tolerance, `${x} != ${y}`);
const rms = x => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
const multiply = ([x, y], [a, b]) => [x * a - y * b, x * b + y * a];
// Explorer banks consume traced paths; their mathematical/audio checks live in
// vector-contour-audio.test.mjs rather than inventing an analytic fallback.
const analyticPresets = PRESETS.filter(p => p.snapshot.mode !== 'explorer');
function psi(b, r, theta) {
  return Array.from(b.re).reduce(([x, y], re, n) => {
    const k = 1 - 2 * n, c = Math.cos(k * theta), s = Math.sin(k * theta), scale = r ** k;
    return [x + scale * (re * c - b.im[n] * s), y + scale * (re * s + b.im[n] * c)];
  }, [0, 0]);
}

test('Julia recurrence reproduces the exact circle and ellipse', () => {
  const circle = juliaCoefficients(0, 0, 128), ellipse = juliaCoefficients(-2, 0, 128);
  assert.equal(circle.re[0], 1); assert.ok(circle.re.slice(1).every(v => v === 0));
  assert.equal(ellipse.re[1], 1); assert.ok(ellipse.re.slice(2).every(v => v === 0));
  for (let i = 0; i < 32; i++) {
    const theta = i / 32 * Math.PI * 2, [x, y] = psi(ellipse, 1.4, theta);
    close(x, (1.4 + 1 / 1.4) * Math.cos(theta)); close(y, (1.4 - 1 / 1.4) * Math.sin(theta));
  }
});

test('Basilica and rabbit satisfy the inverse-map functional equation', () => {
  for (const c of [[-1, 0], [-.122561166876653, .744861766619744]]) {
    const b = juliaCoefficients(...c, 128);
    for (let i = 0; i < 64; i++) {
      const theta = i / 64 * Math.PI * 2, z = psi(b, 1.1, theta), zz = multiply(z, z), p = psi(b, 1.21, 2 * theta);
      close(zz[0] + c[0], p[0], 1e-10); close(zz[1] + c[1], p[1], 1e-10);
    }
  }
});

test('Mandelbrot constants and independent exterior-potential check', () => {
  assert.equal(MANDELBROT_COEFFICIENTS.length, 513);
  assert.deepEqual(MANDELBROT_COEFFICIENTS.slice(0, 5), [-.5, .125, -.25, 15 / 128, 0]);
  const radius = 1.05;
  for (let i = 0; i < 128; i++) {
    const theta = i / 128 * Math.PI * 2;
    let cr = radius * Math.cos(theta), ci = radius * Math.sin(theta);
    MANDELBROT_COEFFICIENTS.forEach((b, k) => { cr += b * radius ** -k * Math.cos(-k * theta); ci += b * radius ** -k * Math.sin(-k * theta); });
    let x = cr, y = ci, iterations = 0;
    while (Math.hypot(x, y) < 1e6 && iterations < 500) { [x, y] = [x * x - y * y + cr, 2 * x * y + ci]; iterations++; }
    assert.ok(iterations < 500); close(Math.log(Math.hypot(x, y)) * 2 ** -iterations, Math.log(radius), 1e-9);
  }
});

test('safe parameter paths remain bounded under Julia critical iteration', () => {
  for (const component of [1, 2]) for (let i = 0; i < 80; i++) {
    const [cr, ci] = componentPoint(.96, i / 80, component); let x = 0, y = 0;
    for (let j = 0; j < 500; j++) { [x, y] = [x * x - y * y + cr, 2 * x * y + ci]; assert.ok(Math.hypot(x, y) <= 2); }
  }
});

test('FFT round trips and each mip excludes harmonics above its ceiling', () => {
  const frame = createFrame({ ...DEFAULT_STATE, traversal: 'distance', detail: 512 });
  for (let m = 0; m < HARMONICS.length; m++) {
    const x = Float64Array.from(frame.tables[m].x), y = Float64Array.from(frame.tables[m].y);
    const original = x.slice(); fft(x, y); close(x[0], 0, .0001); close(y[0], 0, .0001);
    for (let k = HARMONICS[m] + 1; k < TABLE_SIZE - HARMONICS[m]; k++) assert.ok(Math.hypot(x[k], y[k]) / TABLE_SIZE < 1e-7);
    fft(x, y, true); for (let i = 0; i < TABLE_SIZE; i++) close(x[i], original[i], 1e-10);
  }
  for (const sr of [22050, 44100, 48000, 96000]) for (let hz = 25; hz <= 1200; hz += 3) {
    const selected = mipSelection(hz, sr); assert.ok(HARMONICS[selected.index] * hz <= sr * .42); assert.ok(selected.mix >= 0 && selected.mix <= 1);
  }
});

test('circle and ellipse preserve odd symmetry and common XY aspect ratio', () => {
  const a = createFrame({ shape: 'ellipse', radius: 1.1 }), b = createFrame({ shape: 'circle' });
  assert.ok(rms(a.sourceX) > 8 * rms(a.sourceY)); close(rms(b.sourceX), rms(b.sourceY));
  for (const s of [{}, { shape: 'rabbit' }, { traversal: 'distance' }]) {
    const f = createFrame(s);
    for (let i = 0; i < TABLE_SIZE / 2; i++) { close(f.sourceX[i], -f.sourceX[i + TABLE_SIZE / 2], 1e-6); close(f.sourceY[i], -f.sourceY[i + TABLE_SIZE / 2], 1e-6); }
  }
});

test('identity controls change the signal, not only the drawing', () => {
  const original = createFrame({ radius: 1.025 });
  for (const patch of [{ radius: 1.65 }, { detail: 8 }, { shape: 'rabbit' }, { traversal: 'distance' }]) {
    const next = createFrame({ radius: 1.025, ...patch });
    assert.ok(rms(next.sourceX.map((v, i) => v - original.sourceX[i])) > .005);
  }
  const voyager = createBank({ mode: 'voyager', depth: .95 }); assert.equal(voyager.frames.length, 48);
  assert.ok(rms(voyager.frames[0].sourceX.map((v, i) => v - voyager.frames[24].sourceX[i])) > .02);
});

test('preset and randomized banks are finite, bounded, DC-free and deterministic', () => {
  const signatures = new Set();
  for (const preset of analyticPresets) {
    const bank = createBank(preset.snapshot), f = bank.frames[0];
    signatures.add(JSON.stringify(Array.from(f.sourceX.slice(0, 10))));
    for (const frame of bank.frames) for (const t of frame.tables) {
      assert.ok(t.x.every(Number.isFinite)); assert.ok(t.y.every(Number.isFinite));
      assert.ok(Math.max(...t.x.map(Math.abs), ...t.y.map(Math.abs)) < 1.8);
      assert.ok(rms(t.x) ** 2 + rms(t.y) ** 2 < .65);
    }
    assert.deepEqual(createFrame(preset.snapshot).sourceX, f.sourceX);
  }
  assert.ok(signatures.size >= 10);
  let seed = 9123; const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  const seen = new Map(Object.keys(DEFAULT_STATE).map(k => [k, new Set()]));
  for (let i = 0; i < 100; i++) {
    const s = randomizeState(DEFAULT_STATE, random);
    for (const [key, value] of Object.entries(s)) seen.get(key).add(value);
    if (i < 12 && s.mode !== 'explorer') assert.ok(createFrame(s).sourceX.every(Number.isFinite));
  }
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} is frozen`);
  assert.deepEqual(sanitizeState({ pitch: NaN, radius: Infinity }).pitch, DEFAULT_STATE.pitch);
});

function render(dsp, seconds = .35) {
  const x = new Float32Array(Math.ceil(seconds * dsp.sampleRate / 128) * 128), y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i += 128) dsp.process(x.subarray(i, i + 128), y.subarray(i, i + 128));
  return { x, y };
}
test('DSP is silent until playing; all presets sound, stay bounded and release', () => {
  const dsp = new VectorDSP(); dsp.setBank(createBank(DEFAULT_STATE)); dsp.setState(DEFAULT_STATE);
  assert.equal(rms(render(dsp).x), 0);
  dsp.playing = true;
  for (const preset of analyticPresets) {
    dsp.setBank(createBank(preset.snapshot)); dsp.setState(preset.snapshot);
    const { x, y } = render(dsp, .6); assert.ok(rms(x) > .02); assert.ok(rms(y) > .002);
    assert.ok(x.every(Number.isFinite) && y.every(Number.isFinite)); assert.ok(Math.max(...x.map(Math.abs), ...y.map(Math.abs)) < .7);
  }
  dsp.playing = false; const { x, y } = render(dsp, .8);
  assert.ok(rms(x.slice(-2048)) < 1e-8); assert.ok(rms(y.slice(-2048)) < 1e-8);
});

test('queued bank changes preserve carrier phase and mono transitions settle smoothly', () => {
  const dsp = new VectorDSP(); dsp.playing = true; dsp.setBank(createBank({ shape: 'circle' })); dsp.setState({ pitch: 80 }); render(dsp);
  const phase = dsp.phase;
  dsp.setBank(createBank({ mode: 'mandelbrot' })); dsp.setBank(createBank({ shape: 'rabbit' }));
  close(dsp.phase, phase); assert.ok(dsp.pending);
  dsp.setState({ pitch: 80, readout: 'mono', rotation: 45 });
  const { x, y } = render(dsp, 1); assert.equal(dsp.pending, null); assert.equal(dsp.previous, null);
  for (let i = x.length - 2048; i < x.length; i++) close(x[i], y[i], 1e-7);
  let jump = 0; for (let i = 1; i < x.length; i++) jump = Math.max(jump, Math.abs(x[i] - x[i - 1]));
  assert.ok(jump < .08, `unexpected transition jump ${jump}`);
});

test('page and worker keep expensive construction outside the worklet', () => {
  const root = new URL('../', import.meta.url);
  const app = readFileSync(new URL('src/instruments/vector-fractals/app.js', root), 'utf8');
  const page = readFileSync(new URL('src/pages/vector-fractals.html', root), 'utf8');
  assert.match(app, /new Worker/); assert.match(page, /data-primary-transport/); assert.match(page, /id="stage" tabindex="0"/);
  assert.doesNotMatch(readFileSync(new URL('src/instruments/vector-fractals/dsp.js', root), 'utf8'), /createBank\(/);
});

test('voyage restart crossfades positions instead of jumping the waveform', () => {
  const dsp = new VectorDSP();
  dsp.setState({ mode: 'voyager', pitch: 30, speed: .4 });
  dsp.setBank(createBank({ mode: 'voyager', depth: .96, radius: 1.025 }));
  dsp.playing = true; render(dsp, 1);
  const previousPosition = dsp.voyage, previousPhase = dsp.phase;
  dsp.resetMotion();
  close(dsp.previousVoyage, previousPosition); close(dsp.voyage, 0); close(dsp.phase, previousPhase);
  assert.ok(dsp.previous); render(dsp, .2); assert.equal(dsp.previous, null);
});
