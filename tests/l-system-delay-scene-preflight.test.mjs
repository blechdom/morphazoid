import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { measurePreparedPool } from '../src/instruments/micmic/native/device-capacity.js';
import { DEFAULT_PERFORMANCE } from '../src/instruments/micmic/native/model.js';
import { DEFAULT_MASTERING } from '../src/instruments/micmic/native/mastering.js';
import { withBytes, withJson, wasmError } from '../src/instruments/micmic/native/wasm-abi.js';

const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/l-system-delay.wasm', import.meta.url)));
const RATE = 8000, BLOCK = 128, ELIGIBLE = 8, MIN_DELAY = 29;
const SETTINGS = { ...DEFAULT_PERFORMANCE, automatic: true, voiceCeiling: 1,
  source: 'seed', frozen: true, inputGain: 0, wet: 0, dry: .5, level: .2,
  mastering: { ...DEFAULT_MASTERING, inputHighpassHz: 0, highpassHz: 0, lowpassHz: 0,
    compressorEnabled: false, autoMakeup: false, makeupDb: 0 } };

function longPitchedPool() {
  // The last installed slot is outside the 40-second history. It must remain
  // excluded from the measured workload; the other eight have real long,
  // granular pitched reads rather than an immediately audible unison tap.
  const bytes = new Uint8Array(32 + (ELIGIBLE + 1) * 48), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x4c534431, true); view.setUint32(4, 2, true);
  view.setUint32(8, ELIGIBLE + 1, true); view.setUint32(12, ELIGIBLE, true);
  view.setUint32(16, 17, true); view.setFloat64(24, 1, true);
  for (let index = 0; index <= ELIGIBLE; index++) {
    const at = 32 + index * 48;
    view.setFloat64(at, index === ELIGIBLE ? 80 : MIN_DELAY + index * .25, true);
    view.setFloat64(at + 8, [1.31, .77, 1.91, .4][index % 4], true);
    view.setFloat64(at + 16, .5 / Math.sqrt(ELIGIBLE), true);
    view.setFloat64(at + 24, index % 2 ? .5 : -.5, true);
    view.setUint32(at + 32, index, true); view.setUint32(at + 36, index + 1, true);
    view.setUint32(at + 40, 1, true);
  }
  return bytes;
}

function metrics(api, handle) {
  const values = new Float64Array(api.memory.buffer, api.lsd_metrics_ptr(handle), api.lsd_metrics_len());
  return { active: values[1], target: values[2], limit: values[3], installed: values[4],
    elapsedSeconds: values[14], automatic: values[17], mic: values[18], blocks: values[23] };
}

// Observe only the host boundary: every install, fill, control and PCM call
// still runs the published Rust binary. No DSP or admission result is mocked.
function observeInstances(action) {
  const descriptor = Object.getOwnPropertyDescriptor(WebAssembly, 'Instance'), NativeInstance = WebAssembly.Instance;
  const observations = [];
  try {
    Object.defineProperty(WebAssembly, 'Instance', { configurable: true, writable: true, value: class {
      constructor(compiled, imports) {
        const api = new NativeInstance(compiled, imports).exports;
        const record = { api, handle: 0, constructors: [], warm: [], depth: [], pitch: [], settings: [],
          frames: 0, peak: 0, finite: true, bounded: true, allocations: new Map(), drops: [] };
        observations.push(record);
        return { exports: { ...api,
          lsd_new(...args) { const handle = api.lsd_new(...args); record.constructors.push('live'); record.handle = handle; return handle; },
          lsd_new_calibration(...args) { const handle = api.lsd_new_calibration(...args); record.constructors.push('calibration'); record.handle = handle; return handle; },
          lsd_prepare_calibration_history(handle) { const accepted = api.lsd_prepare_calibration_history(handle); record.warm.push(accepted); return accepted; },
          lsd_depth(handle, depth) { record.depth.push(depth); return api.lsd_depth(handle, depth); },
          lsd_pitch_offset(handle, offset) { record.pitch.push(offset); return api.lsd_pitch_offset(handle, offset); },
          lsd_performance(handle, pointer, length) {
            record.settings.push(JSON.parse(new TextDecoder().decode(new Uint8Array(api.memory.buffer, pointer, length))));
            return api.lsd_performance(handle, pointer, length);
          },
          lsd_alloc(length) { const pointer = api.lsd_alloc(length); if (pointer) record.allocations.set(pointer, length); return pointer; },
          lsd_free(pointer, length) { record.allocations.delete(pointer); return api.lsd_free(pointer, length); },
          lsd_drop(handle) { record.drops.push(handle); return api.lsd_drop(handle); },
          lsd_process(handle, left, right, outputLeft, outputRight, frames) {
            const accepted = api.lsd_process(handle, left, right, outputLeft, outputRight, frames);
            record.frames += frames;
            for (const pointer of [outputLeft, outputRight]) for (const sample of new Float32Array(api.memory.buffer, pointer, frames)) {
              record.finite &&= Number.isFinite(sample); record.bounded &&= Math.abs(sample) <= 1;
              record.peak = Math.max(record.peak, Math.abs(sample));
            }
            return accepted;
          },
        } };
      }
    } });
    return action(observations);
  } finally { Object.defineProperty(WebAssembly, 'Instance', descriptor); }
}

function measureWithClock(pool, trialMilliseconds) {
  return observeInstances(observations => {
    let clock = 0;
    const reads = [];
    const result = measurePreparedPool(module, pool, RATE, { performance: SETTINGS, pitchOffset: 7.25, now: () => {
      const record = observations[0];
      // Synthetic timing is read only after genuine warm DSP. A removed fill,
      // early clock read or partial admission cannot pass on a fast machine.
      assert.ok(record.frames > 0, 'settled real PCM precedes the first timing read');
      assert.ok(record.peak > 1e-5, 'the 29–31 second pitched history is already sounding');
      assert.equal(record.finite, true); assert.equal(record.bounded, true);
      const state = metrics(record.api, record.handle);
      assert.equal(state.active, ELIGIBLE); assert.equal(state.target, ELIGIBLE);
      assert.equal(state.limit, ELIGIBLE); assert.equal(state.installed, ELIGIBLE + 1);
      assert.equal(state.automatic, 0); assert.equal(state.mic, 1);
      assert.ok(state.elapsedSeconds < MIN_DELAY, 'settling does not render 30 seconds to fake a warm probe');
      if (reads.length % 2) clock += trialMilliseconds[Math.floor(reads.length / 2)];
      reads.push({ milliseconds: clock, frames: record.frames, state });
      return clock;
    } });
    assert.equal(observations.length, 1, 'one disposable real WASM instance owns this scene probe');
    const record = observations[0];
    assert.deepEqual(record.constructors, ['calibration']); assert.deepEqual(record.warm, [1]);
    assert.deepEqual(record.depth, [1]);
    assert.deepEqual(record.pitch, [7.25], 'scene proof uses the actual transposition before warmup');
    assert.equal(record.settings.length, 1);
    assert.deepEqual(record.settings[0], { ...SETTINGS, automatic: false, voiceCeiling: ELIGIBLE,
      source: 'mic', frozen: false, inputGain: 1, wet: 1, dry: 0 });
    assert.equal(reads.length, 6, 'three real timed trials feed the median');
    const loads = trialMilliseconds.map((milliseconds, index) => {
      const frames = reads[index * 2 + 1].frames - reads[index * 2].frames;
      assert.ok(frames > 0, 'each trial renders actual PCM before its closing timing read');
      return milliseconds / 1000 / (frames / RATE);
    }).sort((a, b) => a - b);
    assert.ok(Math.abs(result.load - loads[1]) < 1e-10, 'returned load is the median of the actual rendered trial lengths');
    assert.equal(result.voices, ELIGIBLE, 'the history-ineligible installed slot is not claimed as measured capacity');
    assert.equal(result.targetLoad, .55); assert.equal(result.proved, loads[1] <= .55);
    assert.deepEqual(record.drops, [record.handle]); assert.equal(record.allocations.size, 0);
    return { result, peak: record.peak, frames: record.frames };
  });
}

test('scene preflight measures the fully warm long-delay pitched pool and takes the median, using real WASM', () => {
  const pool = longPitchedPool(), before = pool.slice();
  const fast = measureWithClock(pool, [320, 32, 96]);
  assert.equal(fast.result.proved, true);
  assert.deepEqual(pool, before, 'calibration cannot rewrite the candidate pool');
  const slow = measureWithClock(pool.buffer, [640, 320, 480]);
  assert.equal(slow.result.proved, false, 'an overloaded complete pool fails proof without a hardware-speed assumption');
  assert.deepEqual(pool, before);
});

test('ordinary live WASM rejects calibration fill and remains silent before its real 30-second delays arrive', () => {
  const api = new WebAssembly.Instance(module, {}).exports;
  assert.equal(typeof api.lsd_new_calibration, 'function');
  assert.equal(typeof api.lsd_prepare_calibration_history, 'function');
  const handle = api.lsd_new(RATE, ELIGIBLE + 1), pointers = Array.from({ length: 4 }, () => api.lsd_alloc(BLOCK * 4));
  assert.ok(handle, wasmError(api, 'Live renderer creation failed'));
  try {
    withBytes(api, longPitchedPool(), (pointer, length) => assert.equal(api.lsd_install(handle, pointer, length), 1));
    assert.equal(api.lsd_depth(handle, 1), 1);
    withJson(api, { ...SETTINGS, automatic: false, voiceCeiling: ELIGIBLE, source: 'mic', frozen: false,
      inputGain: 1, wet: 1, dry: 0 }, (pointer, length) => assert.equal(api.lsd_performance(handle, pointer, length), 1));
    assert.equal(api.lsd_prepare_calibration_history(handle), 0, 'worker-only synthetic history is denied to a live renderer');
    let peak = 0;
    for (let block = 0; block < 112; block++) {
      for (const pointer of pointers.slice(0, 2)) {
        const input = new Float32Array(api.memory.buffer, pointer, BLOCK);
        for (let index = 0; index < BLOCK; index++) input[index] = .08 * Math.sin((block * BLOCK + index) * .13);
      }
      assert.equal(api.lsd_process(handle, ...pointers, BLOCK), 1, wasmError(api, 'Live long-delay processing failed'));
      for (const pointer of pointers.slice(2)) for (const sample of new Float32Array(api.memory.buffer, pointer, BLOCK)) {
        assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 1); peak = Math.max(peak, Math.abs(sample));
      }
    }
    assert.ok(metrics(api, handle).elapsedSeconds < MIN_DELAY);
    assert.equal(peak, 0, 'live wet-only delayed input receives no synthetic calibration signal');
  } finally { api.lsd_drop(handle); for (const pointer of pointers) api.lsd_free(pointer, BLOCK * 4); }
});
