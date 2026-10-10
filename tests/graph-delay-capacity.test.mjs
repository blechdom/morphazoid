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

test('closed switches and zero gains still measure every prepared voice without mutating the plan', () => {
  const graph = generateGraph({ type: 'ring', nodeCount: 8, seed: 3 });
  const plan = compileGraphDelayPlan(graph, { nodePass: 0, feedback: 0, inputTrim: 0, wet: 0, level: 0 }, graph.edges.map(() => false)); let time = 0;
  const before = plan.data.slice();
  const result = measureGraphDelayCapacity(module, plan.data, 48000, { now: () => time += 9 });
  assert.equal(result.voices, plan.routes); assert.equal(result.eligibleRoutes, plan.routes); assert.equal(result.proved, true);
  assert.equal(result.fullPrepared, true); assert.deepEqual(plan.data, before);
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

const quantum = 128 / 48000;
function observeFor(controller, duration, options = {}) {
  for (let at = 0; at < duration; at += quantum) controller.observe({
    load: .1, seconds: quantum, eligible: 384, processing: Math.min(controller.limit, controller.settings.voiceCeiling || 512, options.eligible ?? 384),
    target: Math.min(controller.limit, controller.settings.voiceCeiling || 512, options.eligible ?? 384), ...options,
  });
}

test('a new bounded scene does not inherit a tiny-scene overload ceiling', () => {
  const controller = createGraphCapacityController();
  observeFor(controller, 1, { eligible: 4, processing: 4, target: 4 });
  assert.equal(controller.observe({ load: 1.3, seconds: quantum, eligible: 4, processing: 4, target: 4 }), 2);
  assert.equal(controller.beginScene(), 512);
  observeFor(controller, 3);
  assert.equal(controller.limit, 512, 'the complete prepared graph remains admitted under real headroom');
  const reduced = controller.observe({ load: 1.4, seconds: quantum, eligible: 384, retiringEligible: 384, processing: 768, target: 768 });
  assert.ok(reduced < 384, 'overlapping scenes still protect their combined callback cost immediately');
});

test('sustained headroom recovers a tiny limit in seconds instead of four minutes', () => {
  const controller = createGraphCapacityController();
  observeFor(controller, 1, { eligible: 4, processing: 4, target: 4 });
  controller.observe({ load: 1.3, seconds: quantum, eligible: 4, processing: 4, target: 4 });
  observeFor(controller, 12);
  assert.ok(controller.limit >= 384);
});

test('maintenance overload releases work then promptly restores known recurring capacity', () => {
  const controller = createGraphCapacityController();
  observeFor(controller, 1, { eligible: 128, processing: 128, target: 128, load: .25 });
  const cut = controller.observe({ load: 2.25, maintenanceLoad: 2, seconds: quantum, eligible: 128, processing: 128, target: 128 });
  assert.equal(cut, 64);
  observeFor(controller, .17, { eligible: 128, processing: 128, target: cut, load: .25 });
  assert.equal(controller.limit, cut, 'release work must finish before recovery');
  observeFor(controller, .35, { eligible: 128, processing: cut, target: cut, load: .25 });
  assert.equal(controller.limit, 128, 'one expensive control edit is not a permanent DSP capacity measurement');
});

test('sustained DSP overload keeps reducing admission and cannot trigger optimistic recovery', () => {
  const controller = createGraphCapacityController();
  observeFor(controller, 3, { load: 1.2 });
  assert.equal(controller.limit, 1);
  observeFor(controller, 5, { load: 1.2, maintenanceLoad: 0 });
  assert.equal(controller.limit, 1);
  controller.configure({ voiceCeiling: 0, automatic: false });
  assert.equal(controller.observe({ load: 2, seconds: quantum, eligible: 512, processing: 512, target: 512 }), 512);
});

test('recovery probes respect measured headroom, manual ceiling and transition settling', () => {
  const controller = createGraphCapacityController();
  controller.configure({ voiceCeiling: 80, automatic: true });
  observeFor(controller, 1, { eligible: 384, processing: 80, target: 80 });
  controller.observe({ load: 1.3, seconds: quantum, eligible: 384, processing: 80, target: 80 });
  const cut = controller.limit;
  observeFor(controller, 3, { preparing: true }); assert.equal(controller.limit, cut);
  observeFor(controller, 3, { retiringEligible: 384 }); assert.equal(controller.limit, cut);
  observeFor(controller, 5); assert.equal(controller.limit, 80);
});
