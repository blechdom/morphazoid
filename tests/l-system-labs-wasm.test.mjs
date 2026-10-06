import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, sanitizeParameters, captureScene, presetState } from '../src/instruments/micmic/native/model.js';
import { defaultLab } from '../src/instruments/l-system-parametric-lab/model.js';
import { withJson, withBytes, decodeUtf8, wasmError } from '../src/instruments/micmic/native/wasm-abi.js';

const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/l-system-delay.wasm', import.meta.url)));
function compile(api, lab, overrides = {}) {
  const parameters = sanitizeParameters({ ...DEFAULT_PARAMETERS, generations: lab.iterations, intervalMs: 5, pitchScale: 0, lab, ...overrides });
  return withJson(api, parameters, (pointer, count) => {
    const handle = api.lsd_compile(pointer, count, 8000);
    assert.ok(handle, wasmError(api, 'Lab compilation failed'));
    try {
      const preview = JSON.parse(decodeUtf8(new Uint8Array(api.memory.buffer, api.lsd_compile_json_ptr(handle), api.lsd_compile_json_len(handle))));
      const pool = new Uint8Array(api.memory.buffer, api.lsd_compile_pool_ptr(handle), api.lsd_compile_pool_len(handle)).slice();
      return { preview, pool, parameters };
    } finally { api.lsd_compile_free(handle); }
  });
}

test('laboratory module values survive browser sanitation, capture and complete recall', () => {
  const lab = { ...defaultLab('parametric'), iterations: 5, branchCount: 6, delayRatio: .43, pitchRatio: 1.13, angleIncrement: 17 };
  const scene = captureScene({ ...DEFAULT_PARAMETERS, lab }, DEFAULT_PERFORMANCE);
  assert.deepEqual(scene.parameters.lab, lab);
  const recalled = presetState(scene, { ...DEFAULT_PERFORMANCE, inputGain: .6, level: .7 });
  assert.deepEqual(recalled.parameters.lab, lab);
  assert.equal(recalled.performance.inputGain, .6); assert.equal(recalled.performance.level, .7);
});

test('actual Rust WASM compiles all laboratory mechanisms to their audible targets', () => {
  const api = new WebAssembly.Instance(module).exports;
  for (const kind of ['parametric', 'context', 'thue-morse', 'fibonacci', 'penrose', 'sphinx']) {
    const { preview, pool, parameters } = compile(api, { ...defaultLab(kind), iterations: 3 });
    assert.deepEqual(preview.parameters, parameters, kind);
    assert.ok(preview.requestedVoices > 0, kind);
    assert.equal(pool.byteLength, 32 + preview.requestedVoices * 48, kind);
    assert.equal(preview.previewSampled, false, `${kind} draws its authoritative complete topology`);
    assert.ok(preview.nodes.every(n => [n.x, n.y, n.delay, n.rate].every(Number.isFinite)), kind);
    const records = new DataView(pool.buffer), eligible = preview.nodes.filter(n => n.generation > 0 && n.priority !== null);
    assert.ok(eligible.length > 0, kind);
    for (const node of eligible) {
      const offset = 32 + node.voiceIndex * 48;
      assert.equal(records.getFloat64(offset, true), node.delay, `${kind}: graphic delay matches DSP`);
      assert.equal(records.getFloat64(offset + 8, true), node.rate, `${kind}: graphic rate matches DSP`);
    }
  }
});

test('parametric module conditions bound growth and delay/pitch parameters affect DSP independently', () => {
  const api = new WebAssembly.Instance(module).exports, base = { ...defaultLab(), iterations: 5 };
  const initial = compile(api, base), stopped = compile(api, { ...base, minLength: 1 });
  assert.ok(stopped.preview.requestedVoices < initial.preview.requestedVoices, 'the length condition terminates bud rewriting');
  const delayed = compile(api, { ...base, delayRatio: 1.1 });
  const pitchBase = compile(api, base, { pitchScale: 1 });
  const pitched = compile(api, { ...base, pitchRatio: 1.17 }, { pitchScale: 1 });
  assert.notDeepEqual(initial.preview.nodes.map(n => n.delay), delayed.preview.nodes.map(n => n.delay));
  assert.notDeepEqual(pitchBase.preview.nodes.map(n => n.rate), pitched.preview.nodes.map(n => n.rate));
  assert.deepEqual(pitchBase.preview.nodes.map(n => [n.key, n.x, n.y]), pitched.preview.nodes.map(n => [n.key, n.x, n.y]), 'pitch edits retain branch identities and geometry');
});

test('every laboratory mode processes finite wet audio through the actual Rust WASM engine', () => {
  for (const kind of ['parametric', 'context', 'thue-morse', 'fibonacci', 'penrose', 'sphinx']) {
    const api = new WebAssembly.Instance(module).exports, { pool } = compile(api, { ...defaultLab(kind), iterations: 3 });
    const handle = api.lsd_new(8000, 1), pointers = Array.from({ length: 4 }, () => api.lsd_alloc(128 * 4));
    assert.ok(handle && pointers.every(Boolean));
    try {
      withBytes(api, pool, (p, n) => assert.equal(api.lsd_install(handle, p, n), 1, wasmError(api, kind)));
      withJson(api, { ...DEFAULT_PERFORMANCE, automatic: false, level: .8, wet: 1, dry: 0, inputGain: 1 },
        (p, n) => assert.equal(api.lsd_performance(handle, p, n), 1, wasmError(api, kind)));
      let peak = 0;
      for (let block = 0; block < 125; block++) {
        for (const pointer of pointers.slice(0, 2)) {
          const input = new Float32Array(api.memory.buffer, pointer, 128);
          for (let i = 0; i < input.length; i++) input[i] = .08 * Math.sin((block * 128 + i) / 8000 * Math.PI * 2 * 173);
        }
        assert.equal(api.lsd_process(handle, ...pointers, 128), 1, wasmError(api, kind));
        for (const pointer of pointers.slice(2)) for (const sample of new Float32Array(api.memory.buffer, pointer, 128)) {
          assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 1, `${kind}: bounded finite stereo`);
          peak = Math.max(peak, Math.abs(sample));
        }
      }
      assert.ok(peak > 1e-5, `${kind}: real input produces wet output`);
    } finally {
      api.lsd_drop(handle); for (const pointer of pointers) api.lsd_free(pointer, 128 * 4);
    }
  }
});
