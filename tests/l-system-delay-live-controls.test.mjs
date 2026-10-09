import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PERFORMANCE } from '../src/instruments/micmic/native/model.js';
import { DEFAULT_MASTERING } from '../src/instruments/micmic/native/mastering.js';

const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/l-system-delay.wasm', import.meta.url)));
const RATE = 48000, BLOCK = 128;
const transparent = { ...DEFAULT_MASTERING, inputHighpassHz: 0, highpassHz: 0, lowpassHz: 0,
  compressorEnabled: false, autoMakeup: false, makeupDb: 0 };
const tone = frame => .08 * Math.sin(2 * Math.PI * 173 * frame / RATE);
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const differencePeak = (values, order = 1) => {
  let peak = 0;
  for (let i = order; i < values.length; i++) peak = Math.max(peak,
    Math.abs(order === 1 ? values[i] - values[i - 1] : values[i] - 2 * values[i - 1] + values[i - 2]));
  return peak;
};

function engine({ count = 1, delay = .24, rate = 1, dry = 0, automatic = false, bounded = false, wasmModule = module } = {}) {
  const api = new WebAssembly.Instance(wasmModule).exports, owned = [];
  const handle = api.lsd_new(RATE, count); assert.ok(handle);
  const error = () => new TextDecoder().decode(new Uint8Array(api.memory.buffer, api.lsd_error_ptr(), api.lsd_error_len()));
  const allocate = bytes => {
    const pointer = api.lsd_alloc(bytes.byteLength); assert.ok(pointer, error());
    new Uint8Array(api.memory.buffer, pointer, bytes.byteLength).set(bytes);
    owned.push([pointer, bytes.byteLength]); return pointer;
  };
  const pointers = Array.from({ length: 4 }, () => allocate(new Uint8Array(BLOCK * 4)));
  const pool = new Uint8Array(32 + count * 48), view = new DataView(pool.buffer);
  view.setUint32(0, 0x4c534431, true); view.setUint32(4, 2, true);
  view.setUint32(8, count, true); view.setUint32(12, count, true); view.setUint32(16, 9, true);
  view.setFloat64(24, 1, true);
  for (let index = 0; index < count; index++) {
    const at = 32 + index * 48;
    for (const [offset, value] of [[0, delay], [8, rate], [16, .3 / count], [24, 0]]) view.setFloat64(at + offset, value, true);
    view.setUint32(at + 32, index, true); view.setUint32(at + 36, 123 + index, true);
  }
  const poolPointer = allocate(pool);
  assert.equal(api.lsd_install_begin(handle, poolPointer, pool.length), 1, error());
  if (bounded) assert.equal(api.lsd_install_scene_admission(handle, 1), 1, error());
  assert.equal(api.lsd_install_time_fold(handle, 240, 240, 0), 1, error());
  let installed;
  do { installed = api.lsd_install_step(handle, 4096); } while (installed === 1);
  assert.equal(installed, 2, error());
  const defaults = { ...DEFAULT_PERFORMANCE, automatic,
    source: 'mic', frozen: false, inputGain: 1, level: 1, wet: dry ? 0 : 1, dry, mastering: transparent };
  const performance = candidate => {
    const settings = new TextEncoder().encode(JSON.stringify({ ...defaults, ...candidate }));
    assert.equal(api.lsd_performance(handle, allocate(settings), settings.length), 1, error());
  };
  performance({});
  let frame = 0;
  const render = (frames, source = tone) => {
    const output = new Float32Array(frames);
    for (let at = 0; at < frames; at += BLOCK) {
      const count = Math.min(BLOCK, frames - at), input = Float32Array.from({ length: count }, (_, index) => source(frame + index));
      for (const pointer of pointers.slice(0, 2)) new Float32Array(api.memory.buffer, pointer, count).set(input);
      assert.equal(api.lsd_process(handle, ...pointers, count), 1, error());
      output.set(new Float32Array(api.memory.buffer, pointers[2], count), at); frame += count;
    }
    assert.ok(output.every(Number.isFinite), 'finite PCM');
    assert.ok(output.every(value => Math.abs(value) <= 1), 'bounded PCM');
    return output;
  };
  const metrics = () => [...new Float64Array(api.memory.buffer, api.lsd_metrics_ptr(handle), api.lsd_metrics_len())];
  return { api, handle, render, metrics, performance,
    inputMode(media) { assert.equal(api.lsd_input_mode(handle, Number(media)), 1, error()); },
    reinstall() { assert.equal(api.lsd_install(handle, poolPointer, pool.length), 1, error()); },
    fold(value) { assert.equal(api.lsd_time_fold(handle, value), 1, error()); },
    pitch(value) { assert.equal(api.lsd_pitch_offset(handle, value), 1, error()); },
    close() { api.lsd_drop(handle); for (const [pointer, length] of owned) api.lsd_free(pointer, length); } };
}

function foldSweep(wasmModule = module) {
  const live = engine({ wasmModule });
  try {
    live.render(RATE);
    const steady = live.render(800), before = live.metrics(), memory = live.api.memory.buffer.byteLength;
    let transitionCurvature = 0, sweepPeak = 0, energy = 0, previous = steady.slice(-2);
    for (let step = 0; step < 120; step++) {
      // 60 Hz UI edits and frequent reversals of a modest continuous gesture.
      live.fold(240 + 60 * Math.sin(step * Math.PI / 6));
      const samples = live.render(800);
      transitionCurvature = Math.max(transitionCurvature, differencePeak([...previous, ...samples.slice(0, 16)], 2));
      sweepPeak = Math.max(sweepPeak, differencePeak(samples)); energy += rms(samples) ** 2;
      previous = samples.slice(-2);
    }
    const after = live.metrics();
    assert.equal(after[16], before[16], 'gestures retain installed topology identity');
    assert.equal(after[1], before[1], 'gestures retain admitted voices');
    assert.equal(after[5], before[5], 'gestures retain target voices');
    assert.equal(live.api.memory.buffer.byteLength, memory, 'gestures do not grow audio memory');
    assert.ok(Math.abs(after[14] - before[14] - 2) < 1e-9, 'sample clock advances exactly through the sweep');
    return { transitionCurvature, steadyCurvature: differencePeak(steady, 2), sweepPeak,
      steadySlope: differencePeak(steady), sweepRms: Math.sqrt(energy / 120), steadyRms: rms(steady) };
  } finally { live.close(); }
}

test('60 Hz Time fold gestures preserve flow and stay inside a continuous-tone transient envelope', () => {
  const measured = foldSweep();
  // Twice the steady-tone frequency has four times its discrete curvature.
  // This is a generous envelope for the small delay-speed modulation here;
  // it rejects an abrupt rate jump while allowing the intended pitch glide.
  assert.ok(measured.transitionCurvature <= measured.steadyCurvature * 4,
    `transition curvature ${measured.transitionCurvature} exceeds tone envelope ${measured.steadyCurvature * 4}`);
  assert.ok(measured.sweepPeak <= measured.steadySlope * 2, 'no step outside the doubled-frequency tone envelope');
  assert.ok(measured.sweepRms > measured.steadyRms * .9 && measured.sweepRms < measured.steadyRms * 1.1,
    'timing movement does not add a level pump or sustained hole');
});

test('same-value live coefficients preserve samples and pitch changes leave the original dry input intact', () => {
  const live = engine(), reference = engine(), dry = engine({ dry: .5 }), dryReference = engine({ dry: .5 });
  try {
    for (const instance of [live, reference, dry, dryReference]) instance.render(RATE);
    live.fold(240); live.pitch(0);
    assert.deepEqual(live.render(4096), reference.render(4096), 'coefficient gestures do not replay or reset the source');
    for (const offset of [24, -24, 0, 12, -7.25, 0]) {
      dry.pitch(offset);
      assert.deepEqual(dry.render(2048), dryReference.render(2048), 'dry signal remains sample identical');
    }
  } finally { for (const instance of [live, reference, dry, dryReference]) instance.close(); }
});

test('short unit-rate taps blend the actual pitched read at the zero-offset boundary', () => {
  const live = engine({ delay: .00005 });
  try {
    live.render(RATE);
    const steady = live.render(800), before = live.metrics();
    for (const offset of [.1, -.1, .1, -.1, 0]) {
      live.pitch(offset);
      const samples = live.render(800);
      assert.ok(differencePeak(samples, 2) < differencePeak(steady, 2) * 8,
        'entering and leaving the grain read creates no abrupt short-delay anchor jump');
      assert.ok(rms(samples) > rms(steady) * .2, 'short tap does not disappear at the pitch boundary');
    }
    assert.equal(live.metrics()[16], before[16]);
    assert.equal(live.metrics()[1], before[1]);
  } finally { live.close(); }
});

test('a cold short tap preserves its original read while live pitch waits for grain history', () => {
  const live = engine({ delay: .00005 });
  try {
    live.pitch(12);
    const cold = live.render(RATE / 5);
    assert.ok(rms(cold.slice(-800)) > .005, 'pitch preparation does not erase the immediately readable short tap');
    const transition = live.render(RATE / 2);
    assert.ok(differencePeak(transition) < .002, 'history readiness starts a smooth blend rather than switching the anchor');
  } finally { live.close(); }
});

test('dense live pitch coefficients retain admission, memory, finite output and the sample clock', () => {
  const live = engine({ count: 2048, rate: .7 });
  try {
    live.render(RATE / 2);
    const before = live.metrics(), memory = live.api.memory.buffer.byteLength;
    for (const offset of [-24, -7.25, 0, 5.5, 24, 0]) {
      live.pitch(offset); live.render(800);
      assert.equal(live.api.lsd_pitch_offset_value(live.handle), offset);
      const status = live.metrics();
      assert.equal(status[16], before[16]); assert.equal(status[1], before[1]); assert.equal(status[5], before[5]);
      assert.equal(live.api.memory.buffer.byteLength, memory);
    }
    assert.ok(Math.abs(live.metrics()[14] - before[14] - .1) < 1e-9);
    for (const invalid of [25, -25, NaN, Infinity]) assert.equal(live.api.lsd_pitch_offset(live.handle, invalid), 0);
    assert.equal(live.api.lsd_pitch_offset_value(live.handle), 0, 'invalid controls preserve the last coefficient');
  } finally { live.close(); }
});

test('automatic protection reduces an overloaded pitched bounded scene and preserves its continuous recording', () => {
  const count = 32, live = engine({ count, automatic: true, bounded: true }), duration = BLOCK / RATE;
  try {
    // Warm genuine unison PCM while reporting a cheap measured callback. This
    // models the worker-proved scene whose live pitch change costs more later.
    for (let block = 0; block < 190; block++) {
      live.render(BLOCK);
      live.api.lsd_observe(live.handle, duration * .2, BLOCK, 0);
    }
    const before = live.metrics(), memory = live.api.memory.buffer;
    const activeStorage = live.api.lsd_active_indices_ptr(live.handle);
    assert.equal(before[1], count); assert.equal(before[2], count); assert.equal(before[17], 1);
    live.pitch(12);
    let preceding;
    for (let block = 0; block < 64; block++) preceding = live.render(BLOCK);
    const clockAtObservation = live.metrics()[14];
    // Only callback cost is injected: samples, pitch, admission and release
    // still run the real binary. A genuine missed deadline must cut at once.
    const reduced = live.api.lsd_observe(live.handle, duration * 1.3, BLOCK, 0);
    assert.ok(reduced > 0 && reduced < count, 'automatic admission responds to the newly expensive pitched workload');
    assert.equal(live.metrics()[2], reduced);
    assert.equal(live.metrics()[14], clockAtObservation, 'load observation never rewinds or advances recorded audio');
    const tail = live.render(BLOCK, () => 0);
    assert.ok(rms(tail) > rms(preceding) * .1, 'the captured pitched history remains audible after the reduction');
    assert.ok(differencePeak([...preceding.slice(-1), ...tail]) < differencePeak(preceding) * 2,
      'admission fades preserve the continuous tone across the load observation');
    for (let block = 0; block < 720; block++) {
      const samples = live.render(BLOCK);
      assert.ok(rms(samples) > 1e-5, 'reduced rendering continues without a dropout');
      live.api.lsd_observe(live.handle, duration * .15, BLOCK, 0);
      assert.equal(live.metrics()[2], reduced, 'spare CPU does not regrow an unchanged bounded scene after cooldown');
    }
    const after = live.metrics();
    assert.equal(after[1], reduced, 'outgoing voices retire after their smooth release');
    assert.equal(after[4], before[4]); assert.equal(after[5], before[5]); assert.equal(after[16], before[16]);
    assert.equal(after[13], before[13] + 1, 'the injected overload remains visible in deadline telemetry');
    assert.ok(Math.abs(after[14] - before[14] - (64 + 1 + 720) * duration) < 1e-9);
    assert.equal(after[23], before[23] + 64 + 1 + 720);
    assert.equal(live.api.memory.buffer, memory, 'pitch and automatic fallback require no WASM memory growth');
    assert.equal(live.api.lsd_active_indices_ptr(live.handle), activeStorage, 'admission reuses its existing storage without a pool install');
  } finally { live.close(); }
});

test('media starts at unity after zero or boosted mic trim and returning to mic restores smoothing', () => {
  for (const trim of [0, 4]) {
    const live = engine({ dry: .5 }), unity = engine({ dry: .5 });
    try {
      live.performance({ inputGain: trim });
      live.render(RATE, () => 0); unity.render(RATE, () => 0);
      const before = live.metrics();
      live.inputMode(true); live.performance({ inputGain: 1 });
      const first = live.render(BLOCK * 4), reference = unity.render(BLOCK * 4);
      assert.deepEqual(first, reference, `the first media input block reaches output at unity after mic trim ${trim}`);
      assert.ok(rms(first) > .01, 'the comparison includes actual non-silent PCM beyond output lookahead');
      assert.equal(live.metrics()[16], before[16]); assert.equal(live.metrics()[1], before[1]);
      assert.ok(Math.abs(live.metrics()[14] - before[14] - BLOCK * 4 / RATE) < 1e-9);
      live.reinstall(); unity.reinstall();
      live.performance({ inputGain: trim });
      assert.deepEqual(live.render(4096), unity.render(4096), 'pool and performance updates retain media unity');
      live.inputMode(false); live.performance({ inputGain: 4 });
      const returning = live.render(BLOCK * 4), settled = live.render(RATE / 2);
      const unitySettled = unity.render(BLOCK * 4 + RATE / 2).slice(-4096);
      const micRms = rms(settled.slice(-4096));
      assert.ok(micRms > rms(unitySettled) * 3.99 && micRms < rms(unitySettled) * 4.01, 'mic trim restores its fourfold sensitivity');
      assert.ok(rms(returning) < micRms * .99, 'returning to mic follows its retained gain state instead of jumping to full boost');
    } finally { live.close(); unity.close(); }
  }
});

test('media routing preserves the existing delayed recording, read phase and clock', () => {
  const live = engine({ rate: .7 }), reference = engine({ rate: .7 });
  try {
    for (const instance of [live, reference]) { instance.performance({ inputGain: 4 }); instance.render(RATE); }
    const before = live.metrics();
    live.inputMode(true);
    for (const instance of [live, reference]) instance.performance({ inputGain: 1 });
    assert.deepEqual(live.render(BLOCK * 4, () => 0), reference.render(BLOCK * 4, () => 0),
      'routing retains the audible pitched history while current input is silent');
    assert.equal(live.metrics()[16], before[16]); assert.equal(live.metrics()[1], before[1]);
    assert.ok(Math.abs(live.metrics()[14] - before[14] - BLOCK * 4 / RATE) < 1e-9);
    assert.equal(live.api.lsd_input_mode(live.handle, 2), 0, 'invalid flags are rejected');
  } finally { live.close(); reference.close(); }
});

// Optional reproducible characterization against a preserved pre-change binary.
if (process.env.MORPHAZOID_FOLD_REFERENCE_WASM) {
  const reference = await WebAssembly.compile(await readFile(process.env.MORPHAZOID_FOLD_REFERENCE_WASM));
  console.log(JSON.stringify({ reference: foldSweep(reference), candidate: foldSweep() }));
}
