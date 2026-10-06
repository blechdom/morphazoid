import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { generationTopology } from '../src/instruments/micmic/micmic.js';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, L_SYSTEM_TYPES, sanitizeParameters,
  applyPreviewCurls, buildPreview, presetState, captureScene, randomState, topologyIdentity,
  preparePreviewTransition, advancePreviewTransition } from '../src/instruments/micmic/native/model.js';
import { decodeUtf8, withJson, wasmError } from '../src/instruments/micmic/native/wasm-abi.js';

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
  `${label}: ${actual} vs ${expected}`);
const bank = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));

test('Curls survives capture and randomization while all factory and legacy scenes restore zero independently', () => {
  assert.equal(sanitizeParameters().curls, 0);
  assert.equal(sanitizeParameters({ curls: NaN }).curls, 0);
  assert.equal(sanitizeParameters({ curls: Infinity }).curls, 0);
  assert.equal(sanitizeParameters({ curls: -100 }).curls, -8);
  assert.equal(sanitizeParameters({ curls: 100 }).curls, 8);
  const live = { ...DEFAULT_PERFORMANCE, inputGain: 1.23, level: .37, automatic: false, voiceCeiling: 12345 };
  const snapshot = captureScene({ ...DEFAULT_PARAMETERS, curls: -.37 }, live);
  assert.equal(presetState(JSON.parse(JSON.stringify(snapshot)), live).parameters.curls, -.37);
  for (const preset of bank) {
    assert.equal(preset.snapshot.parameters.curls, 0, preset.id);
    const legacy = structuredClone(preset.snapshot); delete legacy.parameters.curls;
    assert.equal(presetState(legacy, live).parameters.curls, 0, `${preset.id} legacy`);
  }
  assert.ok(randomState(DEFAULT_PARAMETERS, live, () => .1).parameters.curls < 0);
  assert.ok(randomState(DEFAULT_PARAMETERS, live, () => .9).parameters.curls > 0);
  for (const curls of [-8, -.37, 0, .37, 8]) {
    const scene = presetState({ ...snapshot, parameters: { ...snapshot.parameters, curls } }, live);
    for (const key of ['inputGain', 'level', 'automatic', 'voiceCeiling']) assert.equal(scene.performance[key], live[key]);
    assert.equal(topologyIdentity(scene.parameters), topologyIdentity(DEFAULT_PARAMETERS), 'Curls retains tap identity');
  }
});

test('Curls has an analytic signed bend, fixed root and unchanged zero-angle mirrored branches', () => {
  const parameters = { ...DEFAULT_PARAMETERS, generations: 1, angle: 0, timeRatio: 1, pitchScale: .5 };
  const unchanged = buildPreview(parameters, generationTopology), zero = structuredClone(unchanged);
  assert.equal(applyPreviewCurls(zero, 0), zero); assert.deepEqual(zero, unchanged);
  for (const curls of [-.25, .25]) {
    const nodes = buildPreview({ ...parameters, curls }, generationTopology);
    assert.deepEqual(nodes[0], unchanged[0]);
    for (const node of nodes.slice(1)) {
      assert.equal(node.startX, 1); assert.equal(node.startY, 0);
      close(node.x, 1, 'quarter-turn endpoint X'); close(node.y, Math.sign(curls), 'quarter-turn endpoint Y');
      close(node.turnDegrees, 360 * curls, 'local audio turn');
      close(node.rate, 2 ** (2 * curls * parameters.pitchScale), 'pitch follows curl');
      close(node.pan, Math.sign(curls) * parameters.spread, 'pan follows curl');
    }
  }
});

test('every grammar keeps voice identities, connected forks, gap lengths, delays and admission across Curls', () => {
  for (const lSystemType of L_SYSTEM_TYPES) {
    const p = { ...DEFAULT_PARAMETERS, lSystemType, generations: 7, intervalMs: 41, pruningBias: .65 };
    const original = buildPreview(p, generationTopology);
    for (const curls of [-8, -.37, .37, 8]) {
      const curled = buildPreview({ ...p, curls }, generationTopology), byId = new Map(curled.map(node => [node.id, node]));
      assert.equal(curled.length, original.length, lSystemType);
      // Global maxY can change the root's unused preview pan metadata. The
      // unchanged dry-input root is not an audio tap; its geometry stays fixed.
      const { pan: oldRootPan, ...oldRoot } = original[0], { pan: newRootPan, ...newRoot } = curled[0];
      assert.deepEqual(newRoot, oldRoot, `${lSystemType} root`);
      const originalById = new Map(original.map(node => [node.id, node]));
      for (let index = 1; index < curled.length; index++) {
        const node = curled[index], old = original[index], parent = byId.get(node.parentId), oldParent = originalById.get(old.parentId);
        for (const key of ['id', 'parentId', 'generation', 'voiceIndex', 'priority', 'length', 'timeScale', 'delay', 'gain']) {
          assert.equal(node[key], old[key], `${lSystemType}/${node.id}/${key}`);
        }
        const gap = Math.hypot(old.startX - oldParent.x, old.startY - oldParent.y);
        close(Math.hypot(node.startX - parent.x, node.startY - parent.y), gap, `${lSystemType} pen-up gap`);
        close(Math.hypot(node.x - node.startX, node.y - node.startY), old.length, `${lSystemType} segment length`);
        assert.ok([node.startX, node.startY, node.x, node.y, node.rate, node.pan].every(Number.isFinite));
        assert.ok(node.rate >= .125 && node.rate <= 8); assert.ok(Math.abs(node.pan) <= 1);
      }
      const transition = preparePreviewTransition(curled, new Map(original.map(node => [node.id, node])));
      advancePreviewTransition(transition, .5);
      for (const node of transition.nodes.slice(1)) {
        const parent = transition.nodes.find(candidate => candidate.id === node.parentId);
        const old = originalById.get(node.id), oldParent = originalById.get(node.parentId);
        if (old.startX === oldParent.x && old.startY === oldParent.y) {
          close(node.startX, parent.x, `${lSystemType} transition X connection`);
          close(node.startY, parent.y, `${lSystemType} transition Y connection`);
        }
      }
    }
  }
});

test('committed Rust WASM and JS previews agree for signed Curls in every grammar without shrinking the audio pool', async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(new URL('../assets/wasm/l-system-delay.wasm', import.meta.url)), {});
  const api = instance.exports;
  for (const lSystemType of L_SYSTEM_TYPES) for (const curls of [-.37, 0, .37]) {
    const p = { ...DEFAULT_PARAMETERS, lSystemType, curls, generations: 7, angle: 37, asymmetry: -.23,
      // Breadth-first isolates Curls numeric parity from the legacy classic
      // JS/Rust depth-blend floating-point rank ties. Rank stability is checked
      // above at .65 and by the Rust model tests, without changing old orders.
      mutation: .31, intervalMs: 31, timeRatio: 1.17, pitchScale: .75, pruningBias: 0 };
    const js = buildPreview(p, generationTopology);
    const handle = withJson(api, p, (pointer, length) => api.lsd_compile(pointer, length, 48000));
    assert.ok(handle, `${lSystemType}/${curls}: ${wasmError(api, 'compiler failed')}`);
    try {
      const reply = JSON.parse(decodeUtf8(new Uint8Array(api.memory.buffer, api.lsd_compile_json_ptr(handle), api.lsd_compile_json_len(handle))));
      assert.deepEqual(reply.parameters, p);
      assert.equal(reply.requestedVoices, js.length - 1); assert.equal(reply.eligibleVoices, js.length - 1);
      const pool = new DataView(api.memory.buffer, api.lsd_compile_pool_ptr(handle), api.lsd_compile_pool_len(handle));
      assert.equal(pool.byteLength, 32 + (js.length - 1) * 48); assert.equal(pool.getUint32(8, true), js.length - 1);
      const byId = new Map(js.map(node => [node.id, node]));
      for (const rust of reply.nodes.slice(1)) {
        const node = byId.get(rust.key.replace(/^generation:/, '')); assert.ok(node);
        for (const key of ['voiceIndex', 'generation', 'priority']) assert.equal(rust[key], node[key], `${lSystemType}/${key}`);
        for (const key of ['startX', 'startY', 'x', 'y', 'headingDegrees', 'turnDegrees', 'length', 'timeScale', 'delay', 'rate', 'gain', 'pan']) {
          close(rust[key], node[key], `${lSystemType}/${curls}/${node.id}/${key}`);
        }
        const offset = 32 + node.voiceIndex * 48;
        for (const [key, at] of [['delay', 0], ['rate', 8], ['pan', 24]]) close(pool.getFloat64(offset + at, true), node[key], `${lSystemType} pool ${key}`);
      }
    } finally { api.lsd_compile_free(handle); }
  }
});
