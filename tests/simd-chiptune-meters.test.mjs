import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { WEBGPU_CHIPTUNE_DEFAULTS as DEFAULTS, WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE as SONG,
  WEBGPU_CHIPTUNE_SEQUENCE_LANES as LANES, createWebGpuChiptunePattern,
  packWebGpuChiptuneSequence, webGpuChiptuneParamArray } from '../src/instruments/webgpu-chiptune/webgpu-chiptune.js';
import { applySimdChiptunePerformance } from '../src/instruments/simd-chiptune/performance.js';
import { ChiptuneTempoClock, TEMPO_CLOCK_CAPACITY, TEMPO_CLOCK_FIELDS } from '../src/instruments/simd-chiptune/tempo-clock.js';

const VOICES = ['drums', 'bass', 'arp', 'lead', 'upperOne', 'upperTwo', 'noise'];
const PARTS = ['kick', 'snare', 'hats', 'shaker'];
const PART_LEVELS = ['kickLevel', 'snareLevel', 'hatLevel', 'shakerLevel'];
const modules = Object.fromEntries(await Promise.all(['scalar', 'simd'].map(async type => [type,
  new WebAssembly.Module(await readFile(new URL(`../assets/wasm/simd-chiptune-${type}.wasm`, import.meta.url)))])));

function kernel(type = 'simd', params = DEFAULTS, sequence = SONG, metering = true, clock = null) {
  const exports = new WebAssembly.Instance(modules[type]).exports;
  exports.reset(); exports.set_metering(Number(metering));
  const packed = packWebGpuChiptuneSequence(sequence, 0);
  new Float32Array(exports.memory.buffer, exports.params_ptr(), 154).set(webGpuChiptuneParamArray(params));
  new Uint32Array(exports.memory.buffer, exports.sequence_meta_ptr(), 48).set(packed.meta);
  new Uint8Array(exports.memory.buffer, exports.sequence_cells_ptr(), 9216).set(new Uint8Array(packed.cells));
  if (clock) exports.set_tempo_clock(clock.writeTo(new Float64Array(exports.memory.buffer, exports.tempo_clock_ptr(), TEMPO_CLOCK_CAPACITY * TEMPO_CLOCK_FIELDS)));
  return { exports, left: new Float32Array(exports.memory.buffer, exports.output_left_ptr(), 128),
    right: new Float32Array(exports.memory.buffer, exports.output_right_ptr(), 128),
    peaks: new Float32Array(exports.memory.buffer, exports.stem_peaks_ptr(), 11) };
}
function render(engine, offset, frames = 1024) {
  const samples = new Float32Array(frames * 2), peaks = new Float32Array(11);
  for (let position = 0; position < frames; position += 128) {
    const count = Math.min(128, frames - position);
    engine.exports.process(count, 48000, offset + position / 48000);
    for (let i = 0; i < count; i++) { samples[(position + i) * 2] = engine.left[i]; samples[(position + i) * 2 + 1] = engine.right[i]; }
    for (let stem = 0; stem < 11; stem++) peaks[stem] = Math.max(peaks[stem], engine.peaks[stem]);
  }
  return { samples, peaks };
}
const peak = samples => samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
function pattern(lane = 'upperOne') {
  const sequence = structuredClone(createWebGpuChiptunePattern());
  for (const key of LANES) {
    sequence.lanes[key].activeLength = 4;
    sequence.lanes[key].stepBeats = .25;
    sequence.lanes[key].gate = .8;
    sequence.lanes[key].cells = Array.from({ length: 32 }, (_, step) => ({ state: key === lane && step === 0 ? 'note' : 'rest', value: PARTS.includes(key) ? 1 : 0, velocity: 1 }));
  }
  return sequence;
}

test('rendered stem meters preserve every output sample with metering enabled or disabled', () => {
  const clock = new ChiptuneTempoClock(1.3); clock.setTempo(2.7, 120.137);
  for (const type of ['scalar', 'simd']) for (const sequence of [SONG, createWebGpuChiptunePattern()]) {
    const params = { ...DEFAULTS, tempo: 2.7, echoTaps: 8, echoTime: .31, ghostDrums: .8, gain: .7 };
    for (const offset of [0, 7.137, 120.137, 120.19, 126.333]) {
      const metered = render(kernel(type, params, sequence, true, clock), offset);
      const unmetered = render(kernel(type, params, sequence, false, clock), offset);
      assert.deepEqual(metered.samples, unmetered.samples);
      assert.ok(metered.peaks.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
      assert.ok(unmetered.peaks.every(value => value === 0));
    }
  }
});

test('all-seven mute is silent and each solo lights only its actual rendered performer', () => {
  const muted = applySimdChiptunePerformance(DEFAULTS, Object.fromEntries(VOICES.map(voice => [voice, { muted: true }])));
  for (const type of ['scalar', 'simd']) {
    const silent = render(kernel(type, muted), 14.02);
    assert.equal(peak(silent.samples), 0); assert.deepEqual([...silent.peaks], Array(11).fill(0));
    for (const [index, voice] of VOICES.entries()) {
      const params = applySimdChiptunePerformance({ ...DEFAULTS, gain: .3 }, { [voice]: { solo: true } });
      const totals = new Float32Array(11);
      for (const offset of [.04, 3.17, 14.02, 25.25]) {
        const { samples, peaks } = render(kernel(type, params), offset);
        assert.ok(Math.abs(peaks[index] - peak(samples)) < .000001, `${type}/${voice} meter must match its actual isolated stereo peak`);
        for (let stem = 0; stem < 11; stem++) totals[stem] = Math.max(totals[stem], peaks[stem]);
      }
      assert.ok(totals[index] > .00001, `${type}/${voice} should register rendered audio`);
      for (let other = 0; other < 7; other++) if (other !== index) assert.equal(totals[other], 0, `${voice} leaked into ${VOICES[other]} meter`);
      if (voice !== 'drums') assert.ok(totals.slice(7).every(value => value === 0));
    }
  }
});

test('drum part meters follow the isolated rendered hit, including kit gain and silence', () => {
  for (const type of ['scalar', 'simd']) for (const [part, lane] of PARTS.entries()) {
    const params = applySimdChiptunePerformance({ ...DEFAULTS, tempo: 1, gain: .2,
      ...Object.fromEntries(PART_LEVELS.map((key, i) => [key, i === part ? 1 : 0])) }, { drums: { solo: true, volume: .7 } });
    const full = render(kernel(type, params, pattern(lane)), 1.03);
    assert.ok(full.peaks[7 + part] > .00001, `${type}/${lane}`);
    assert.equal(full.peaks[0], full.peaks[7 + part]);
    for (let other = 0; other < 4; other++) if (part !== other) assert.equal(full.peaks[7 + other], 0);
    const half = render(kernel(type, { ...params, gain: .1 }, pattern(lane)), 1.03);
    assert.ok(Math.abs(half.peaks[7 + part] / full.peaks[7 + part] - .5) < .000001);
    const silent = render(kernel(type, { ...params, drumMix: 0 }, pattern(lane)), 1.03);
    assert.ok(silent.peaks.every(value => value === 0));
  }
});

test('echoes and ghost hits continue to register when the direct step is resting', () => {
  const synthParams = applySimdChiptunePerformance({ ...DEFAULTS, tempo: 1, fadeIn: .01, gain: .2,
    echoTaps: 2, echoTime: .2, echoWet: 1, echoDecay: .8 }, { upperOne: { solo: true } });
  const drumParams = applySimdChiptunePerformance({ ...DEFAULTS, tempo: 1, fadeIn: .01, gain: .2,
    kickLevel: 1, snareLevel: 0, hatLevel: 0, shakerLevel: 0, ghostDelayDivisor: 5, ghostDrums: 1 }, { drums: { solo: true } });
  for (const type of ['scalar', 'simd']) {
    const dry = render(kernel(type, { ...synthParams, echoWet: 0 }, pattern()), .3);
    const echoed = render(kernel(type, synthParams, pattern()), .3);
    assert.equal(peak(dry.samples), 0); assert.equal(dry.peaks[4], 0);
    assert.ok(peak(echoed.samples) > .00001); assert.ok(echoed.peaks[4] > .00001);
    const noGhost = render(kernel(type, { ...drumParams, ghostDrums: 0 }, pattern('kick')), .3);
    const ghost = render(kernel(type, drumParams, pattern('kick')), .3);
    assert.equal(peak(noGhost.samples), 0); assert.equal(noGhost.peaks[7], 0);
    assert.ok(peak(ghost.samples) > .00001); assert.ok(ghost.peaks[7] > .00001);
    assert.equal(ghost.peaks[0], ghost.peaks[7]);
  }
});

test('scalar and SIMD meters agree, clear stale peaks, and meter the selected audition voice', () => {
  for (const sequence of [SONG, createWebGpuChiptunePattern()]) {
    const a = render(kernel('scalar', DEFAULTS, sequence), 13.417);
    const b = render(kernel('simd', DEFAULTS, sequence), 13.417);
    assert.deepEqual(a.peaks, b.peaks);
  }
  const params = applySimdChiptunePerformance({ ...DEFAULTS, gain: .2, echoTaps: 1 }, { bass: { solo: true } });
  const rest = structuredClone(SONG);
  for (const lane of LANES) rest.lanes[lane].cells = Array.from({ length: 32 }, () => ({ state: 'rest', value: 0, velocity: 1 }));
  const engine = kernel('simd', params, rest);
  new Float32Array(engine.exports.memory.buffer, engine.exports.time_info_ptr(), 4).set([10, 2, -12, 10]);
  const audition = render(engine, 10.03);
  assert.ok(audition.peaks[1] > .00001);
  assert.ok(audition.peaks.every((value, stem) => stem === 1 || value === 0));
  const after = render(engine, 11);
  assert.equal(peak(after.samples), 0); assert.ok(after.peaks.every(value => value === 0));
});
