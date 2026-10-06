import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { RUST_EXPLORATION_GRAMMARS, expandStochasticGrammar, generationTopology } from '../src/instruments/micmic/micmic.js';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, buildPreview, sanitizeParameters, captureScene, presetState,
  interpolateParameters, topologyIdentity } from '../src/instruments/micmic/native/model.js';
import { decodeUtf8, withJson, wasmError } from '../src/instruments/micmic/native/wasm-abi.js';

const expectedCounts = [6560, 2187, 2048, 5460, 15625, 1543];
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-10 * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);

test('sourced exploration grammars produce complete connected distinct paths with no graphical voice cap', () => {
  for (const [index, grammar] of RUST_EXPLORATION_GRAMMARS.entries()) {
    const nodes = generationTopology({ ...DEFAULT_PARAMETERS, lSystemType: grammar.id, angle: grammar.angle });
    assert.equal(nodes.length, expectedCounts[index], grammar.id);
    assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length, `${grammar.id}: collision-free identities`);
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes.slice(1)) {
      const parent = byId.get(node.parentId); assert.ok(parent, `${grammar.id}/${node.id}`);
      close(node.startX, parent.x, `${node.id}: connected x`);
      close(node.startY, parent.y, `${node.id}: connected y`);
      assert.ok([node.x, node.y, node.timeScale, node.turnDegrees].every(Number.isFinite));
    }
    assert.ok(nodes.some(node => node.turnDegrees !== 0), grammar.id);
  }
});

test('weighted stochastic productions change topology while unrelated controls preserve every choice', () => {
  const p = { ...DEFAULT_PARAMETERS, lSystemType: 'stochastic' };
  const original = generationTopology(p);
  assert.deepEqual(generationTopology(p), original);
  const structure = nodes => nodes.map(({ id, parentId, rule }) => ({ id, parentId, rule }));
  const changed = generationTopology({ ...p, angle: 77, timeRatio: 1.13, mutation: .8 });
  assert.deepEqual(structure(changed), structure(original));
  assert.notEqual(changed[1].x, original[1].x);
  assert.notDeepEqual(structure(generationTopology({ ...p, grammarSeed: 2 })), structure(original));
  assert.equal(generationTopology({ ...p, branchProbability: 0 }).length, 3 ** 5);
  assert.equal(generationTopology({ ...p, branchProbability: 1 }).length, 5 ** 5);
  for (const seed of [0, 1, 471, 0xffffffff]) {
    const rewrite = expandStochasticGrammar(5, seed, .65);
    assert.deepEqual(expandStochasticGrammar(5, seed, .65), rewrite);
    assert.equal(new Set(rewrite.lineages).size, rewrite.lineages.length);
  }
});

test('branch choices persist through scene recall and remain discrete during graphical interpolation', () => {
  const p = { ...DEFAULT_PARAMETERS, lSystemType: 'stochastic', grammarSeed: 0xffffffff, branchProbability: .33 };
  assert.equal(sanitizeParameters({ grammarSeed: 1.2 }).grammarSeed, 1);
  assert.equal(sanitizeParameters({ grammarSeed: -9 }).grammarSeed, 0);
  assert.equal(sanitizeParameters({ grammarSeed: Infinity }).grammarSeed, 1);
  assert.equal(sanitizeParameters({ branchProbability: 99 }).branchProbability, 1);
  const snapshot = captureScene(p, DEFAULT_PERFORMANCE);
  assert.deepEqual(presetState(JSON.parse(JSON.stringify(snapshot)), DEFAULT_PERFORMANCE).parameters, p);
  const intermediate = interpolateParameters(DEFAULT_PARAMETERS, p, .5);
  assert.equal(intermediate.grammarSeed, p.grammarSeed);
  assert.equal(intermediate.branchProbability, p.branchProbability);
  assert.notEqual(topologyIdentity(p), topologyIdentity({ ...p, grammarSeed: 12 }));
  assert.equal(topologyIdentity(p), topologyIdentity({ ...p, angle: 77, timeRatio: 1.13 }));
});

test('actual Rust WASM agrees with all six JS exploration geometries and every independent audio target', async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(new URL('../assets/wasm/l-system-delay.wasm', import.meta.url)), {});
  const api = instance.exports;
  for (const grammar of RUST_EXPLORATION_GRAMMARS) for (const generations of [1, 7, 13]) {
    const p = { ...DEFAULT_PARAMETERS, lSystemType: grammar.id, generations, angle: grammar.angle,
      intervalMs: 11, timeRatio: .82, asymmetry: -.13, curls: .37, pitchScale: .4,
      pruningBias: .65, grammarSeed: 471, branchProbability: .33 };
    const js = buildPreview(p, generationTopology);
    const handle = withJson(api, p, (pointer, length) => api.lsd_compile(pointer, length, 48000));
    assert.ok(handle, `${grammar.id}: ${wasmError(api, 'compiler failed')}`);
    try {
      const reply = JSON.parse(decodeUtf8(new Uint8Array(api.memory.buffer, api.lsd_compile_json_ptr(handle), api.lsd_compile_json_len(handle))));
      const pool = new DataView(api.memory.buffer, api.lsd_compile_pool_ptr(handle), api.lsd_compile_pool_len(handle));
      assert.deepEqual(reply.parameters, p); assert.equal(reply.requestedVoices, js.length - 1);
      assert.equal(reply.eligibleVoices, js.length - 1);
      assert.equal(pool.byteLength, 32 + (js.length - 1) * 48, `${grammar.id}: no voice cap`);
      const byId = new Map(js.map(node => [node.id, node]));
      for (const rust of reply.nodes.slice(1)) {
        const node = byId.get(rust.key.replace(/^generation:/, '')); assert.ok(node, rust.key);
        assert.equal(rust.parentKey, node.parentId ? `generation:${node.parentId}` : '');
        assert.equal(rust.priority, node.priority);
        for (const key of ['startX', 'startY', 'x', 'y', 'headingDegrees', 'turnDegrees', 'length', 'timeScale', 'delay', 'rate', 'gain', 'pan']) {
          close(rust[key], node[key], `${grammar.id}/${node.id}/${key}`);
        }
      }
      for (const node of js.slice(1)) {
        const offset = 32 + node.voiceIndex * 48;
        close(pool.getFloat64(offset, true), node.delay, `${node.id}: delay`);
        close(pool.getFloat64(offset + 8, true), node.rate, `${node.id}: rate`);
        close(pool.getFloat64(offset + 16, true), .5 * p.depth ** (node.generation * .72), `${node.id}: gain`);
        close(pool.getFloat64(offset + 24, true), node.pan, `${node.id}: pan`);
        assert.equal(pool.getUint32(offset + 32, true), node.priority);
      }
    } finally { api.lsd_compile_free(handle); }
  }
});
