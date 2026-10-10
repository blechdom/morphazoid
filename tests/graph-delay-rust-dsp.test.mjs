import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { generateGraph, generateGraphWithinTurnBudget } from '../src/instruments/graph-delay/graph-delay.js';
import { compileGraphDelayPlan, MAX_RUST_GRAPH_NODES, MAX_RUST_GRAPH_TURN_ROUTES } from '../src/instruments/graph-delay-rust/graph-delay-plan.js';

const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/graph-delay.wasm', import.meta.url)));
const RATE = 48000, BLOCK = 128;
const graph = (type = 'chain', nodes = 3) => generateGraph({ type, nodeCount: nodes, maxNodes: 64, seed: 37 });
const settings = { baseDelay: 20, timeScale: 0, pitchScale: 0, nodePass: 1, feedback: .7, wet: 1, dry: 0, inputTrim: 1, level: .5, spread: 0 };
function fixture(g = graph(), options = settings, rate = RATE) {
  const api = new WebAssembly.Instance(module).exports, engine = api.gdr_new(rate);
  const pointers = Array.from({ length: 4 }, () => api.gdr_alloc(BLOCK * 4));
  const install = (nextGraph = g, nextSettings = options, switches = null, finish = true) => {
    const plan = compileGraphDelayPlan(nextGraph, nextSettings, switches), pointer = api.gdr_alloc(plan.data.byteLength);
    new Float64Array(api.memory.buffer, pointer, plan.data.length).set(plan.data);
    const result = api.gdr_plan(engine, pointer, plan.data.length);
    api.gdr_free(pointer, plan.data.byteLength); assert.equal(result, 1);
    if (finish) { let attempts = 0; while (!api.gdr_prepare(engine, 65536)) assert.ok(++attempts < 5000); }
    return plan;
  };
  const initial = install(); api.gdr_enabled(engine, 1);
  let frame = 0;
  const render = (seconds, signal = () => 0, rightSignal = signal) => {
    const result = [new Float32Array(Math.ceil(seconds * rate / BLOCK) * BLOCK), new Float32Array(Math.ceil(seconds * rate / BLOCK) * BLOCK)];
    for (let at = 0; at < result[0].length; at += BLOCK) {
      const left = new Float32Array(api.memory.buffer, pointers[0], BLOCK), right = new Float32Array(api.memory.buffer, pointers[1], BLOCK);
      for (let i = 0; i < BLOCK; i++, frame++) { left[i] = signal(frame, frame / rate); right[i] = rightSignal(frame, frame / rate); }
      assert.equal(api.gdr_process(engine, ...pointers, BLOCK), 1);
      result[0].set(new Float32Array(api.memory.buffer, pointers[2], BLOCK), at); result[1].set(new Float32Array(api.memory.buffer, pointers[3], BLOCK), at);
      api.gdr_prepare(engine, 65536);
    }
    return result;
  };
  return { api, engine, pointers, initial, install, render,
    metrics: () => new Float64Array(api.memory.buffer, api.gdr_metrics(engine), 16).slice(),
    close() { api.gdr_drop(engine); for (const pointer of pointers) api.gdr_free(pointer, BLOCK * 4); } };
}
const peak = values => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
const energy = values => values.reduce((sum, value) => sum + value * value, 0);

test('Rust graph module has a checked raw ABI and no runtime imports', () => {
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const api = new WebAssembly.Instance(module).exports;
  assert.equal(api.gdr_abi_version(), 1); assert.equal(api.gdr_new(1), 0);
});

test('plan preserves graph timeScale, terminal geometry, switches and independent turn pitches', () => {
  const geometry = graph('ring', 8), a = compileGraphDelayPlan(geometry, { ...settings, timeScale: 0 }), b = compileGraphDelayPlan(geometry, { ...settings, timeScale: 1000, pitchScale: 1 });
  assert.equal(a.signature, b.signature); assert.equal(b.routes, geometry.edges.length + 1);
  const edgeStart = 16 + geometry.nodes.length * 2;
  assert.ok(b.data[edgeStart + 2] > a.data[edgeStart + 2]);
  const closed = compileGraphDelayPlan(geometry, settings, geometry.edges.map(() => false));
  for (let index = 0; index < geometry.edges.length; index++) assert.equal(closed.data[edgeStart + index * 6 + 4], 0);
});

test('Rust graph remains cold-silent and starts wet sound only after the directed delays', () => {
  const f = fixture();
  try {
    assert.equal(peak(f.render(.1)[0]), 0);
    f.api.gdr_clear(f.engine);
    let first = true;
    const signal = () => { if (first) { first = false; return .2; } return 0; };
    // Use identical one-shot channels rather than advancing shared generator twice.
    const capture = f.render(.2, (frame, time) => time < .103 ? .2 : 0);
    const firstNonzero = capture[0].findIndex(value => Math.abs(value) > 1e-8);
    assert.ok(firstNonzero >= Math.floor(.043 * RATE));
    assert.ok(firstNonzero < Math.floor(.05 * RATE));
    assert.ok(peak(capture[0]) > .01);
  } finally { f.close(); }
});

test('feedback is a real recirculating network and its decay control changes later returns', () => {
  const captures = [];
  for (const feedback of [0, .8]) {
    const f = fixture(graph('ring'), { ...settings, feedback });
    try { captures.push(f.render(.8, (_frame, time) => time < .005 ? .08 * Math.sin(time * 2 * Math.PI * 300) : 0)[0]); }
    finally { f.close(); }
  }
  assert.ok(energy(captures[0].subarray(.18 * RATE)) < 1e-10);
  assert.ok(energy(captures[1].subarray(.18 * RATE)) > 1e-6);
  assert.ok(energy(captures[1].subarray(.6 * RATE)) < energy(captures[1].subarray(.18 * RATE, .4 * RATE)));
});

test('stereo histories retain channel identity and left-only input does not become mono', () => {
  const f = fixture();
  try {
    const result = f.render(.3, (_frame, time) => .08 * Math.sin(time * 2 * Math.PI * 173), () => 0);
    assert.ok(peak(result[0]) > .01); assert.equal(peak(result[1]), 0);
  } finally { f.close(); }
});

test('distinct per-turn pitch settings change the wet spectrum', () => {
  const captures = [];
  for (const pitchScale of [0, 1]) {
    const f = fixture(graph('ring', 4), { ...settings, feedback: 0, pitchScale });
    try { captures.push(f.render(1, (_frame, time) => .05 * Math.sin(time * 2 * Math.PI * 233))[0].subarray(.5 * RATE)); }
    finally { f.close(); }
  }
  const crossings = values => values.reduce((sum, value, index) => sum + Number(index > 0 && value > 0 && values[index - 1] <= 0), 0);
  assert.ok(peak(captures[1]) > .001);
  assert.ok(Math.abs(crossings(captures[0]) - crossings(captures[1])) > 15);
});

test('live geometry and mix updates retain sample clock and feedback history', () => {
  const geometry = graph('ring'), f = fixture(geometry);
  try {
    f.render(.12, (_frame, time) => time < .02 ? .1 : 0);
    const elapsed = f.metrics()[0], changed = structuredClone(geometry); changed.nodes[1].x += .1;
    f.install(changed, { ...settings, feedback: .8, timeScale: 30, pitchScale: .2 });
    const result = f.render(.15);
    assert.ok(energy(result[0]) > 1e-6); assert.ok(f.metrics()[0] > elapsed);
  } finally { f.close(); }
});

test('Clear removes even long old history immediately without resetting the sample clock', () => {
  const f = fixture(graph('ring'), { ...settings, pitchScale: .8, feedback: .92 });
  try {
    f.render(.25, () => .1); const time = f.metrics()[0]; f.api.gdr_clear(f.engine);
    const result = f.render(.4);
    assert.equal(peak(result[0]), 0); assert.ok(f.metrics()[0] > time);
  } finally { f.close(); }
});

test('large plans prepare in bounded steps while the installed scene still sounds', () => {
  const f = fixture();
  try {
    f.render(.1, () => .05);
    const large = generateGraphWithinTurnBudget({ type: 'dag', nodeCount: 64, maxNodes: 64, density: .5, seed: 3 }, 512).graph;
    const plan = f.install(large, { ...settings, pitchScale: .7 }, null, false);
    assert.equal(f.api.gdr_prepare(f.engine, 1), 0);
    const result = f.render(.03, () => .05);
    assert.ok(peak(result[0]) > .01); assert.ok(plan.routes > 192);
    // An explicit return to the installed scene cancels the uncommitted scene.
    f.install(graph(), settings);
    assert.equal(f.metrics()[3], 3);
  } finally { f.close(); }
});

test('maximum controls and invalid PCM remain finite and bounded across sample rates', () => {
  for (const rate of [8000, 48000, 96000]) {
    const f = fixture(graph('ring', 8), { ...settings, feedback: .92, wet: 1.5, dry: 1, level: .9, pitchScale: 2, timeScale: 1600 }, rate);
    try {
      const capture = f.render(.1, index => index % 17 === 0 ? NaN : 10);
      for (const channel of capture) { assert.ok(channel.every(Number.isFinite)); assert.ok(peak(channel) <= 1); }
    } finally { f.close(); }
  }
});

test('fixed safety limits are explicit and larger node graphs retain the shared graph model', () => {
  assert.equal(MAX_RUST_GRAPH_NODES, 64); assert.equal(MAX_RUST_GRAPH_TURN_ROUTES, 512);
  const large = generateGraphWithinTurnBudget({ type: 'dag', nodeCount: 64, maxNodes: 64, density: .8, seed: 8 }, 512);
  assert.equal(large.graph.nodes.length, 64); assert.ok(large.turnRouteCount <= 512);
  assert.ok(compileGraphDelayPlan(large.graph).routes > 192);
  assert.throws(() => compileGraphDelayPlan(generateGraph({ type: 'chain', nodeCount: 65, maxNodes: 65 })), /64 nodes/);
});

test('structural recall keeps the previous audible graph until the new long path arrives', () => {
  const f = fixture();
  try {
    f.render(.3, () => .05);
    const next = graph('chain', 8);
    const plan = f.install(next, { ...settings, baseDelay: 180 }, null, false);
    assert.ok(plan.data[11] > 1.3);
    const result = f.render(1.8, () => .05)[0];
    for (let at = 0; at + 480 < result.length; at += 480) assert.ok(peak(result.subarray(at, at + 480)) > .005, `gap at ${at / RATE}s`);
    assert.equal(f.metrics()[3], 8);
  } finally { f.close(); }
});
