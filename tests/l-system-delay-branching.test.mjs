import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { L_SYSTEM_PRESETS, traceLSystem } from '../src/instruments/l-system/l-system.js';
import { RUST_BRANCHING_GRAMMARS, generationTopology, generationVoiceSpecs } from '../src/instruments/micmic/micmic.js';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, L_SYSTEM_TYPES, buildPreview, isVoiceActive,
  randomState, sanitizeParameters } from '../src/instruments/micmic/native/model.js';
import { decodeUtf8, withJson, wasmError } from '../src/instruments/micmic/native/wasm-abi.js';

const ORIGINAL_IDS = ['pythagorean', 'plant', 'coral', 'dragon', 'koch', 'sierpinski', 'hilbert', 'gosper', 'cantor', 'levy', 'terdragon'];
const NEW_IDS = ['bush', 'fan', 'fern', 'whorled', 'ternary', 'quaternary'];
const PARAMETERS = { ...DEFAULT_PARAMETERS, intervalMs: 311, timeRatio: 1.17, angle: 37,
  asymmetry: -.23, mutation: .31, pruningBias: .65, pitchScale: 1.1, depth: .77, spread: .83 };
// Captured before this extension at ff425040. These fingerprints deliberately
// exclude floating-point math and preserve exact identities, ancestry, stages,
// voice slots and pruning order for each existing grammar.
const ORIGINAL_STRUCTURE = [
  ['pythagorean', 1, 3, '82a2012924ab08c984bfa60714880317bc5b10f5dd65191a268e259b65f72d60'],
  ['pythagorean', 5, 63, '73a43f4042e3dadb3e54dd93de898d9ab5c1ce01cc2eff41b5453bba4dc48a5b'],
  ['pythagorean', 13, 16383, '4bf5967885d83ae9c3846e2c7a668703361eeba8ec12b3ebb9036d54bcf78def'],
  ['plant', 1, 3, '892b4abfab5db81c5248537c30a9620627d695c90a8b0034bc6e89562c473538'],
  ['plant', 5, 18, 'c85f29ccbaedec9e7fad6035ce2ee67b9ae379f20aac7e2667080b28aef13d13'],
  ['plant', 13, 1488, '8143627ce31b0f894587da545568b2a376c8c26caf25aa4eb1b3d509bdf98537'],
  ['coral', 1, 8, '50466ff39ad14b7a3e7ec953c74bf1d053f44f2f859f68ca23a23f1e10e0f08f'],
  ['coral', 5, 64, 'e4eddbb6ac96cacb9cf7e7727e6eb0c67e157408c3905a7a5fa465e746f3cb38'],
  ['coral', 13, 4096, '8a4b4bef01110f8047e43fc4958ba6add723a3f80e60e3756505f2c7e15ae0c2'],
  ['dragon', 1, 2, 'c53e969d0a12dc06448771097d8066b41a570438efb3b73e6dfb03fc410084e4'],
  ['dragon', 5, 32, 'd1a99d470054118b6acb70148265cf95c4a92f4c1590a38c2b83f78f836a1f9b'],
  ['dragon', 13, 4096, '2692fd56116fe6580ef288fec020f9c36b95eec901175edfc39008e98908c7a8'],
  ['koch', 1, 12, '2c00e3e29a9f218cb459f53f088737a5fbc723fa49f3d9c11d85fd49163e0ed5'],
  ['koch', 5, 48, '3670dc9f5bd044b640d97a717fa1f434595f4d176f539a53da1f72026f54d964'],
  ['koch', 13, 768, '688b3e246a9fd5d7e0ac598278b7bb0343dc0e6f92c59b0b6a1aaecd1f002b53'],
  ['sierpinski', 1, 9, 'd6b24ea93b90ebcbde7e5e2d1dd239afcd1bc131421cbe7fa9115ce1326c4556'],
  ['sierpinski', 5, 27, '78a51e48263bf60b82324d82cd60402b23f2e743868d7c0d40b4b8a93ea78e05'],
  ['sierpinski', 13, 729, '6cb987443363dcc25563ae51e7ba8f27fe97d52fdafd2a5842ca8769abd2a09c'],
  ['hilbert', 1, 3, '432ce744138af6ae13d62443a4d838a000efa1dab69c304579fd1b938b13e4aa'],
  ['hilbert', 5, 15, 'd1eb3f007753682f5efdafbe04cb55c1eab210baa37d8a6ac267f465adb21362'],
  ['hilbert', 13, 1023, '822fad1bd182755e4f267aef57df6f6dbeeae327b76430518e07dd968bc2b198'],
  ['gosper', 1, 7, '6deaf836a1467534f364c7a38e361922f4f09d65ad9d7e8c32a3a3d54669ff50'],
  ['gosper', 5, 49, '3c4188665b43fc950d2660e78e1200b3104a274d152895112d0e03813f594615'],
  ['gosper', 13, 2401, 'c39e20736a28e800f6996bc5cf845e3242ee0e66eed7a4e648dc8b243033caf3'],
  ['cantor', 1, 2, 'ba42f33b73f8a90b19c01679867327f3032058381a2ff1d60dae182348c65384'],
  ['cantor', 5, 4, '94f493d956ff255753f3a2823293b442ddb39c52fe90066be66751b256e1892c'],
  ['cantor', 13, 64, 'f818f98e6a33cb50d4e60b433ac062f2462171ecc2f50bbed6487fe6aafdf9d6'],
  ['levy', 1, 2, 'df643e9ad3b584e2748ed5d43c6de32aa11335b6e7c4c74ba7323bda20641916'],
  ['levy', 5, 32, 'd2680ea1f6c41f26b4c63c1314941bb76ad1befee2965b91e26cc7c47e7dca37'],
  ['levy', 13, 4096, '463f0d41f7108f046f89ca0139360ff871d539b4965a512475685a504779ddbe'],
  ['terdragon', 1, 3, '046a5fa0a4b7e6516e52b1024d678b901e0c86db4bcc89e012fd4e14cbec441e'],
  ['terdragon', 5, 27, '0efebb9b03ea01fe8016823128d87da5672a0276aba048e3369460f16c48c4e8'],
  ['terdragon', 13, 2187, 'ddfd99cf2b1e2489f48b59f09602be468bb7b9a3e6b59f7a250fe05517f6c69f'],
];
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-10 * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);
function childrenByParent(nodes) {
  const children = new Map();
  for (const node of nodes.filter(node => node.parentId !== null)) {
    const siblings = children.get(node.parentId) ?? []; siblings.push(node); children.set(node.parentId, siblings);
  }
  return children;
}

test('branching types append without changing any original type or exact topology/pruning order', () => {
  assert.deepEqual(L_SYSTEM_PRESETS.map(grammar => grammar.id), ORIGINAL_IDS);
  assert.deepEqual(L_SYSTEM_TYPES, [...ORIGINAL_IDS, ...NEW_IDS]);
  assert.deepEqual(RUST_BRANCHING_GRAMMARS.map(grammar => grammar.id), NEW_IDS);
  assert.ok(Object.isFrozen(RUST_BRANCHING_GRAMMARS));
  for (const grammar of RUST_BRANCHING_GRAMMARS) assert.ok(Object.isFrozen(grammar) && Object.isFrozen(grammar.rules));
  for (const [lSystemType, generations, count, expectedHash] of ORIGINAL_STRUCTURE) {
    const nodes = buildPreview({ ...PARAMETERS, lSystemType, generations }, generationTopology);
    const structure = nodes.map(({ id, parentId, generation, index, rule, voiceIndex, priority }) => ({ id, parentId, generation, index, rule, voiceIndex, priority }));
    assert.equal(nodes.length, count, `${lSystemType}/G${generations}`);
    assert.equal(createHash('sha256').update(JSON.stringify(structure)).digest('hex'), expectedHash, `${lSystemType}/G${generations}`);
  }
});

test('all six additions produce genuine connected branches using the agreed canonical bracket trace', () => {
  const fullCounts = [3125, 3125, 4118, 4118, 364, 341], signatures = new Set();
  for (const [index, grammar] of RUST_BRANCHING_GRAMMARS.entries()) {
    const p = { ...DEFAULT_PARAMETERS, lSystemType: grammar.id, generations: 13, angle: grammar.angle, mutation: 0 };
    const nodes = generationTopology(p), trace = traceLSystem({ ...grammar, angle: p.angle, turnAsymmetry: p.asymmetry, lengthScale: p.timeRatio });
    assert.equal(nodes.length, fullCounts[index], grammar.id);
    assert.equal(nodes.length, trace.segments.length);
    const byId = new Map(nodes.map(node => [node.id, node])); assert.equal(byId.size, nodes.length);
    assert.ok([...childrenByParent(nodes).values()].some(children => children.length > 1), grammar.id);
    assert.ok(nodes.some(node => node.turnDegrees > 0) && nodes.some(node => node.turnDegrees < 0), grammar.id);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i], segment = trace.segments[i];
      for (const [key, expected] of [['x', segment.end.x], ['y', segment.end.y], ['startX', segment.start.x], ['startY', segment.start.y]]) close(node[key], expected, `${grammar.id}/${i}/${key}`);
      if (node.parentId !== null) {
        const parent = byId.get(node.parentId); assert.ok(parent, `${grammar.id}/${node.id} parent`);
        assert.equal(node.startX, parent.x); assert.equal(node.startY, parent.y);
      }
      assert.ok([node.x, node.y, node.timeScale, node.headingDegrees, node.turnDegrees].every(Number.isFinite));
    }
    assert.deepEqual(generationTopology(p), nodes, `${grammar.id} deterministic rebuild`);
    signatures.add(JSON.stringify(nodes.map(node => [node.parentId, node.x, node.y])));
  }
  assert.equal(signatures.size, NEW_IDS.length);
});

test('persistent ternary and quaternary buds keep every fork at exactly three or four distinct siblings', () => {
  for (const [lSystemType, degree] of [['ternary', 3], ['quaternary', 4]]) for (const generations of [1, 5, 9, 13]) {
    const nodes = generationTopology({ lSystemType, generations, angle: 27.5, asymmetry: .18, timeRatio: .74, mutation: .4 });
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const [parentId, siblings] of childrenByParent(nodes)) {
      assert.equal(siblings.length, degree, `${lSystemType}/G${generations}/${parentId}`);
      assert.equal(new Set(siblings.map(node => node.id)).size, degree);
      assert.equal(new Set(siblings.map(node => node.headingDegrees.toFixed(8))).size, degree);
      assert.equal(new Set(siblings.map(node => `${node.x.toFixed(8)},${node.y.toFixed(8)}`)).size, degree);
      const parent = byId.get(parentId);
      for (const child of siblings) { assert.equal(child.startX, parent.x); assert.equal(child.startY, parent.y); }
    }
  }
});

test('new siblings inherit path delays, signed pitch and generation power without merging audio identities', () => {
  for (const [lSystemType, degree, turns] of [['ternary', 3, [36, 0, -24]], ['quaternary', 4, [72, 36, -24, -48]]]) {
    const p = { ...DEFAULT_PARAMETERS, lSystemType, generations: 1, intervalMs: 500, angle: 30,
      asymmetry: .2, timeRatio: .8, pitchScale: 1.3, depth: .81, mutation: 0 };
    const preview = buildPreview(p, generationTopology), children = preview.slice(1);
    assert.equal(children.length, degree); assert.ok(children.every(node => node.parentId === 'trunk'));
    const voices = generationVoiceSpecs({ ...p, interval: p.intervalMs, maximumVoices: degree });
    assert.equal(voices.length, degree); assert.equal(new Set(voices.map(voice => voice.key)).size, degree);
    for (let i = 0; i < degree; i++) {
      close(children[i].turnDegrees, turns[i], `${lSystemType}/${i} signed angle`);
      close(children[i].delay, .2, `${lSystemType}/${i} sibling delay`);
      close(children[i].rate, 2 ** (turns[i] / 180 * p.pitchScale), `${lSystemType}/${i} pitch`);
      const voice = voices.find(voice => voice.key === `generation:${children[i].id}`);
      for (const key of ['delay', 'rate', 'gain', 'pan']) close(voice[key], children[i][key], `${lSystemType}/${i}/${key}`);
    }
    const power = children.reduce((sum, node) => sum + node.gain ** 2, 0);
    close(power, .25 * p.depth ** 1.44, `${lSystemType} generation power`);
  }
});

test('new branching previews preserve connected admission prefixes and deterministic continuous coefficients', () => {
  for (const lSystemType of NEW_IDS) for (const pruningBias of [-.7, 0, .35, .65, 1]) {
    const p = { ...PARAMETERS, lSystemType, generations: 13, pruningBias };
    const nodes = buildPreview(p, generationTopology);
    for (const limit of [0, 1, 3, 4, 19, 37, nodes.length - 1]) {
      const active = nodes.filter(node => node.generation > 0 && isVoiceActive(node, limit));
      assert.equal(active.length, limit, `${lSystemType}/${pruningBias}/${limit}`);
      const admitted = new Set(['trunk', ...active.map(node => node.id)]);
      assert.ok(active.every(node => admitted.has(node.parentId)), `${lSystemType} connected prefix`);
    }
    const zero = buildPreview({ ...p, depth: 0 }, generationTopology);
    assert.ok(zero.slice(1).every(node => node.gain === 0 && !isVoiceActive(node, nodes.length)));
    const changed = buildPreview({ ...p, intervalMs: 173, pitchScale: .3, mutation: .7 }, generationTopology);
    assert.deepEqual(changed.map(node => [node.id, node.parentId, node.x, node.y]), nodes.map(node => [node.id, node.parentId, node.x, node.y]));
    assert.ok(changed.slice(1).some((node, i) => node.delay !== nodes[i + 1].delay));
    assert.ok(changed.slice(1).some((node, i) => node.rate !== nodes[i + 1].rate));
  }
});

test('validation and full-state randomization reach every appended grammar including the upper endpoint', () => {
  const live = { ...DEFAULT_PERFORMANCE, inputGain: 1.23, level: .37, frozen: true, automatic: false, voiceCeiling: 12345 };
  for (const [index, lSystemType] of L_SYSTEM_TYPES.entries()) {
    const random = () => (index + .5) / L_SYSTEM_TYPES.length;
    const scene = randomState(DEFAULT_PARAMETERS, live, random);
    assert.equal(scene.parameters.lSystemType, lSystemType);
    assert.equal(sanitizeParameters({ ...PARAMETERS, lSystemType }).lSystemType, lSystemType);
    for (const key of ['inputGain', 'level', 'frozen', 'automatic', 'voiceCeiling']) assert.equal(scene.performance[key], live[key]);
  }
  assert.equal(randomState(DEFAULT_PARAMETERS, live, () => 0).parameters.lSystemType, L_SYSTEM_TYPES[0]);
  assert.equal(randomState(DEFAULT_PARAMETERS, live, () => 1).parameters.lSystemType, L_SYSTEM_TYPES.at(-1));
});

test('actual committed Rust WASM agrees with all six JS branching previews and retains every audio record', async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(new URL('../assets/wasm/l-system-delay.wasm', import.meta.url)), {});
  const api = instance.exports;
  for (const lSystemType of NEW_IDS) for (const generations of [1, 5, 13]) {
    const p = { ...PARAMETERS, lSystemType, generations }, js = buildPreview(p, generationTopology);
    const handle = withJson(api, p, (pointer, length) => api.lsd_compile(pointer, length, 48000));
    assert.ok(handle, `${lSystemType}/G${generations}: ${wasmError(api, 'compiler failed')}`);
    try {
      const reply = JSON.parse(decodeUtf8(new Uint8Array(api.memory.buffer, api.lsd_compile_json_ptr(handle), api.lsd_compile_json_len(handle))));
      const pool = new DataView(api.memory.buffer, api.lsd_compile_pool_ptr(handle), api.lsd_compile_pool_len(handle));
      assert.deepEqual(Object.keys(reply.generationLimits).sort(), [...L_SYSTEM_TYPES].sort());
      assert.deepEqual(reply.parameters, p);
      assert.equal(reply.requestedVoices, js.length - 1); assert.equal(reply.eligibleVoices, js.length - 1);
      assert.equal(pool.getUint32(8, true), js.length - 1, `${lSystemType}: no graphical admission cap`);
      assert.equal(pool.byteLength, 32 + (js.length - 1) * 48);
      const byId = new Map(js.map(node => [node.id, node]));
      for (const rust of reply.nodes.slice(1)) {
        const id = rust.key.replace(/^generation:/, ''), node = byId.get(id); assert.ok(node, id);
        assert.equal(rust.parentKey, `generation:${node.parentId}`);
        assert.equal(rust.generation, node.generation); assert.equal(rust.voiceIndex, node.voiceIndex);
        assert.equal(rust.priority, node.priority); assert.equal(rust.rule, node.rule);
        for (const key of ['startX', 'startY', 'x', 'y', 'headingDegrees', 'turnDegrees', 'length', 'timeScale', 'delay', 'rate', 'gain', 'pan']) close(rust[key], node[key], `${lSystemType}/G${generations}/${id}/${key}`);
      }
      for (const node of js.slice(1)) {
        const offset = 32 + node.voiceIndex * 48;
        for (const [key, at] of [['delay', 0], ['rate', 8], ['pan', 24]]) close(pool.getFloat64(offset + at, true), node[key], `${lSystemType}/${node.id}/${key}`);
        const rawGain = pool.getFloat64(offset + 16, true);
        assert.ok(Number.isFinite(rawGain) && rawGain > 0);
        close(rawGain, .5 * p.depth ** (node.generation * .72), `${lSystemType}/${node.id} raw gain`);
        assert.equal(pool.getUint32(offset + 32, true), node.priority);
        assert.equal(pool.getUint32(offset + 40, true), node.generation);
      }
      const nativeNodes = reply.nodes.map(node => ({ ...node, id: node.key.replace(/^generation:/, ''),
        parentId: node.parentKey ? node.parentKey.replace(/^generation:/, '') : null }));
      if (lSystemType === 'ternary' || lSystemType === 'quaternary') {
        const degree = lSystemType === 'ternary' ? 3 : 4;
        for (const siblings of childrenByParent(nativeNodes).values()) assert.equal(siblings.length, degree);
      }
    } finally { api.lsd_compile_free(handle); }
  }
});
