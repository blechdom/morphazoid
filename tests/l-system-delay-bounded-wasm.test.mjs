import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, L_SYSTEM_TYPES, sanitizeParameters } from '../src/instruments/micmic/native/model.js';
import { defaultLab, LAB_KINDS } from '../src/instruments/l-system-parametric-lab/model.js';
import { withJson, withBytes, decodeUtf8, wasmError } from '../src/instruments/micmic/native/wasm-abi.js';

const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/l-system-delay.wasm', import.meta.url)));
const instantiate = () => new WebAssembly.Instance(module, {}).exports;
function compile(api, parameters, budget) {
  return withJson(api, parameters, (pointer, length) => {
    const handle = api.lsd_compile_bounded(pointer, length, 8000, budget);
    assert.ok(handle, wasmError(api, 'Bounded compilation failed'));
    try {
      const json = JSON.parse(decodeUtf8(new Uint8Array(api.memory.buffer, api.lsd_compile_json_ptr(handle), api.lsd_compile_json_len(handle))));
      const pool = new Uint8Array(api.memory.buffer, api.lsd_compile_pool_ptr(handle), api.lsd_compile_pool_len(handle)).slice();
      return { json, pool };
    } finally { api.lsd_compile_free(handle); }
  });
}
const scenes = () => [...L_SYSTEM_TYPES.map(lSystemType => ({ ...DEFAULT_PARAMETERS, lSystemType, generations: 52 })),
  ...LAB_KINDS.map(kind => ({ ...DEFAULT_PARAMETERS, generations: 24, lab: { ...defaultLab(kind), iterations: 24,
    ...(kind === 'parametric' ? { lengthRatio: 1.05, branchCount: 6, minLength: .001 } : {}) } }))];

test('bounded WASM retains all requested rule parameters while every prepared allocation follows the device budget', () => {
  const api = instantiate();
  assert.equal(api.lsd_abi_version(), 1);
  assert.equal(typeof api.lsd_compile_bounded, 'function');
  assert.equal(typeof api.lsd_capacity_hint, 'function');
  for (const parameters of scenes()) for (const budget of [0, 1, 37]) {
    const { json, pool } = compile(api, parameters, budget), label = parameters.lab?.kind ?? parameters.lSystemType;
    assert.deepEqual(json.parameters, sanitizeParameters(parameters), label);
    assert.ok(json.preparedVoices <= budget, `${label}: pool fits budget ${budget}`);
    assert.equal(pool.byteLength, 32 + json.preparedVoices * 48);
    assert.equal(json.nodes.length, json.preparedVoices + 1, `${label}: display follows the prepared graph`);
    assert.equal(json.previewSampled, false);
    for (const type of L_SYSTEM_TYPES) assert.equal(json.generationLimits[type], 52, `${label}: requested recursion remains available`);
    const byKey = new Map(json.nodes.map(node => [node.key, node]));
    for (const node of json.nodes.slice(1)) {
      assert.ok(byKey.has(node.parentKey), `${label}: connected parent ${node.parentKey}`);
      assert.ok([node.x, node.y, node.delay, node.rate, node.gain, node.pan].every(Number.isFinite), label);
      const offset = 32 + node.voiceIndex * 48, records = new DataView(pool.buffer);
      assert.equal(records.getFloat64(offset, true), node.delay, label);
      assert.equal(records.getFloat64(offset + 8, true), node.rate, label);
    }
  }
  assert.ok(api.memory.buffer.byteLength < 32 * 1024 * 1024, 'hostile recursions do not expand million-voice storage');
});

test('six-way partial frontiers use the complete available budget and retain exact large demand as decimal metadata', () => {
  const api = instantiate(), parameters = scenes().find(scene => scene.lab?.kind === 'parametric');
  const first = compile(api, parameters, 73).json, second = compile(api, parameters, 127).json;
  assert.equal(first.preparedVoices, 73); assert.equal(second.preparedVoices, 127);
  const requested = Array.from({ length: 24 }, (_, index) => 6n ** BigInt(index + 1)).reduce((a, b) => a + b, 0n);
  assert.equal(first.requestedVoicesDecimal, requested.toString());
  assert.equal(first.requestedVoicesExact, false, 'JS numeric demand is explicitly approximate beyond safe integer range');
  const expanded = new Map(second.nodes.map(node => [node.key, node]));
  for (const node of first.nodes) {
    const next = expanded.get(node.key); assert.ok(next);
    for (const key of ['x', 'y', 'startX', 'startY', 'delay', 'rate', 'voiceIndex']) assert.equal(next[key], node[key], key);
  }
});

test('dense classic requests fill measured capacity using a nearby effective derivation', () => {
  const api = instantiate();
  for (const lSystemType of ['plant', 'coral', 'bush', 'fan', 'fern', 'whorled', 'ternary', 'quaternary', 'stochastic']) {
    const parameters = { ...DEFAULT_PARAMETERS, lSystemType, generations: 52, intervalMs: 5 };
    const { json } = compile(api, parameters, 1024);
    assert.equal(json.parameters.generations, 52);
    assert.ok(json.effectiveParameters.generations < 52, lSystemType);
    assert.equal(json.preparedVoices, 1024, lSystemType);
    assert.ok(json.nodes.some(node => Math.abs(node.y) > .01), `${lSystemType}: visible branches`);
    assert.ok(Math.max(...json.nodes.map(node => node.delay)) > .001, `${lSystemType}: meaningful path timing`);
  }
  for (const kind of ['thue-morse', 'fibonacci']) {
    const parameters = { ...DEFAULT_PARAMETERS, generations: 24, intervalMs: 5, lab: { ...defaultLab(kind), iterations: 24 } };
    const { json } = compile(api, parameters, 1024);
    assert.equal(json.parameters.lab.iterations, 24);
    assert.ok(json.effectiveParameters.lab.iterations < 24, kind);
    assert.equal(json.preparedVoices, 1024, kind);
    assert.ok(Math.max(...json.nodes.map(node => node.delay)) > .001, `${kind}: meaningful path timing`);
  }
});

test('zero depth and history eligibility retain structural prepared slots for live resumption', () => {
  const api = instantiate(), parameters = { ...DEFAULT_PARAMETERS, generations: 52, depth: 0, intervalMs: 3000, timeRatio: 2 };
  const { json, pool } = compile(api, parameters, 37);
  assert.equal(json.preparedVoices, 37); assert.equal(json.eligibleVoices, 0);
  assert.ok(json.structuralEligibleVoices > 0 && json.structuralEligibleVoices < 37);
  assert.equal(json.nodes.length, 38);
  assert.ok(json.nodes.slice(1).every(node => node.gain === 0));
  assert.equal(new DataView(pool.buffer).getUint32(12, true), json.structuralEligibleVoices);
});

test('each bounded rule family produces finite wet audio and the measured cold hint obeys live admission', () => {
  for (const lSystemType of L_SYSTEM_TYPES.concat(LAB_KINDS.map(kind => `lab:${kind}`))) {
    const api = instantiate(), kind = lSystemType.startsWith('lab:') ? lSystemType.slice(4) : null;
    const parameters = { ...DEFAULT_PARAMETERS, lSystemType: kind ? 'pythagorean' : lSystemType,
      generations: 3, intervalMs: 5, pitchScale: 0, ...(kind ? { lab: { ...defaultLab(kind), iterations: 3 } } : {}) };
    const { pool, json } = compile(api, parameters, 37), handle = api.lsd_new(8000, 1);
    assert.ok(handle);
    const pointers = Array.from({ length: 4 }, () => api.lsd_alloc(128 * 4));
    try {
      withBytes(api, pool, (p, n) => assert.equal(api.lsd_install(handle, p, n), 1, wasmError(api, lSystemType)));
      assert.equal(api.lsd_capacity_hint(handle, 31), 1);
      let metrics = new Float64Array(api.memory.buffer, api.lsd_metrics_ptr(handle), api.lsd_metrics_len());
      assert.equal(metrics[3], Math.min(31, json.structuralEligibleVoices));
      withJson(api, { ...DEFAULT_PERFORMANCE, automatic: false, voiceCeiling: 7, level: .8, wet: 1, dry: 0, inputGain: 1 },
        (p, n) => assert.equal(api.lsd_performance(handle, p, n), 1));
      assert.equal(api.lsd_capacity_hint(handle, 1), 1);
      metrics = new Float64Array(api.memory.buffer, api.lsd_metrics_ptr(handle), api.lsd_metrics_len());
      assert.equal(metrics[3], Math.min(7, json.structuralEligibleVoices), 'manual admission is unchanged');
      let peak = 0;
      for (let block = 0; block < 100; block++) {
        for (const pointer of pointers.slice(0, 2)) {
          const input = new Float32Array(api.memory.buffer, pointer, 128);
          for (let index = 0; index < 128; index++) input[index] = .08 * Math.sin((block * 128 + index) / 8000 * Math.PI * 2 * 177);
        }
        assert.equal(api.lsd_process(handle, ...pointers, 128), 1);
        for (const pointer of pointers.slice(2)) for (const sample of new Float32Array(api.memory.buffer, pointer, 128)) {
          assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 1, lSystemType);
          peak = Math.max(peak, Math.abs(sample));
        }
      }
      assert.ok(peak > 1e-5, `${lSystemType}: nonzero Rust wet output`);
    } finally { api.lsd_drop(handle); for (const pointer of pointers) api.lsd_free(pointer, 128 * 4); }
  }
});
