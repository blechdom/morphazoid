import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { generateGraph } from '../src/instruments/graph-delay/graph-delay.js';
import { compileGraphDelayPlan } from '../src/instruments/graph-delay-rust/graph-delay-plan.js';
import { measureGraphDelayCapacity } from '../src/instruments/graph-delay-rust/graph-delay-capacity.js';
import { createGraphCapacityController, sanitizeGraphDelayPerformance } from '../src/instruments/graph-delay-rust/graph-delay-capacity-policy.js';
const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/graph-delay.wasm', import.meta.url)));

test('capacity probes render every candidate voice with full history and leave source plans intact', () => {
  const graph = generateGraph({ type: 'dag', nodeCount: 12, maxNodes: 64, seed: 8 });
  const plan = compileGraphDelayPlan(graph, { baseDelay: 600, timeScale: 1600, pitchScale: 0 });
  const before = plan.data.slice(); let time = 0;
  const result = measureGraphDelayCapacity(module, plan.data, 48000, { now: () => time += 9 });
  assert.equal(result.voices, plan.routes); assert.equal(result.eligibleRoutes, plan.routes);
  assert.equal(result.preparedRoutes, plan.routes); assert.equal(result.pitchedStress, true);
  assert.equal(result.proved, true); assert.equal(result.targetLoad, .45);
  assert.equal(result.measurements.length, 3); assert.ok(result.measurements.every(item => item.voices === plan.routes));
  assert.deepEqual(plan.data, before);
  const slow = measureGraphDelayCapacity(module, plan.data, 48000, { now: () => time += 60 });
  assert.equal(slow.proved, false); assert.equal(slow.voices, plan.routes, 'a failed test never invents an untested lower voice count');
});

test('muted candidate routes are reported as ineligible and cannot prove full capacity', () => {
  const graph = generateGraph({ type: 'ring', nodeCount: 8, seed: 3 });
  const plan = compileGraphDelayPlan(graph, {}, graph.edges.map(() => false)); let time = 0;
  const result = measureGraphDelayCapacity(module, plan.data, 48000, { now: () => time += 9 });
  assert.equal(result.voices, 0); assert.equal(result.eligibleRoutes, 0); assert.equal(result.proved, false);
  assert.equal(result.preparedRoutes, plan.routes);
});

test('capacity probe validates sample rate and plan errors', () => {
  assert.throws(() => measureGraphDelayCapacity(module, new Float64Array(), 48000), /exceeds/);
  assert.throws(() => measureGraphDelayCapacity(module, new Float64Array(), 1), /allocate/);
});

test('automatic protection cuts actual per-scene demand using both scenes callback cost', () => {
  const controller = createGraphCapacityController();
  const next = controller.observe({ load: 1.2, seconds: .01, eligible: 100, retiringEligible: 120, processing: 220, target: 220 });
  assert.equal(next, 72);
  const duringRelease = controller.observe({ load: 1.2, seconds: .01, eligible: 100, retiringEligible: 120, processing: 220, target: 144 });
  assert.equal(duringRelease, next, 'allow the release to remove real work before cutting again');
  const reduced = controller.observe({ load: 1.2, seconds: .2, eligible: 100, retiringEligible: 120, processing: 144, target: 144 });
  assert.ok(reduced < next); assert.ok(reduced >= 1);
  controller.configure({ voiceCeiling: 512, automatic: false });
  assert.equal(controller.observe({ load: 2, seconds: 1, eligible: 512 }), 512);
});

test('protection recovers slowly after sustained headroom, never during structural transitions', () => {
  const controller = createGraphCapacityController();
  controller.configure({ voiceCeiling: 64, automatic: true });
  const reduced = controller.observe({ load: 1.2, seconds: .01, eligible: 128, processing: 64, target: 64 });
  for (let i = 0; i < 100; i++) controller.observe({ load: .2, seconds: .1, eligible: 128, processing: reduced * 2, target: reduced * 2, retiringEligible: 128 });
  assert.equal(controller.limit, reduced);
  for (let i = 0; i < 100; i++) controller.observe({ load: .2, seconds: .1, eligible: 128, processing: controller.limit, target: controller.limit });
  assert.ok(controller.limit > reduced); assert.ok(controller.limit <= 64);
  assert.deepEqual(sanitizeGraphDelayPerformance({ voiceCeiling: 900, automatic: false }), { voiceCeiling: 512, automatic: false });
});
