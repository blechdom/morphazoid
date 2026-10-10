import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWasmNetwork } from '../src/instruments/fractal-delay/wasm-runtime.js';

const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/fractal-delay.wasm', import.meta.url)));
const RATE = 48000, BLOCK = 128, zero = new Float32Array(BLOCK), signal = new Float32Array(BLOCK).fill(.04);
const parameters = { mode: 'inverse', detail: 2, timeMs: 100, coupling: 1, decay: .7, pitchOffset: 0,
  inputMode: 'point', inputPosition: 0, pickupMode: 'point', pickup: .7, boundary: 1, routing: 'geometry' };
const performance = { inputGain: 1, delayGainDb: 0, wet: 1, dry: 0, outputLevel: 1, outputBoostDb: 0,
  hpfHz: 0, lpfHz: 22000, compressorRatio: 1, compressorMakeupDb: 0 };

function peakBlock(engine) {
  const { left, right } = engine.process(signal), block = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    assert(Number.isFinite(left[i]) && Number.isFinite(right[i]), 'actual Rust output must be finite');
    block[i] = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    assert(block[i] <= .940001, 'actual Rust output must remain bounded');
  }
  return block;
}

function shortestDistance(scene, start, finish) {
  const distances = scene.nodes.map(() => Infinity), visited = new Set(); distances[start] = 0;
  while (!visited.has(finish)) {
    let closest = -1;
    for (let i = 0; i < distances.length; i++) if (!visited.has(i) && (closest < 0 || distances[i] < distances[closest])) closest = i;
    assert(closest >= 0 && Number.isFinite(distances[closest]), 'the admitted pickup must be connected');
    visited.add(closest);
    for (const edge of scene.edges) {
      const next = edge.a === closest ? edge.b : edge.b === closest ? edge.a : -1;
      if (next >= 0) distances[next] = Math.min(distances[next], distances[closest] + edge.length);
    }
  }
  return distances[finish];
}

test('real preflight serialization preserves cached multiports through actual Rust wave propagation', { timeout: 10000 }, async t => {
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self'), pending = new Map(), engines = [];
  Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: {
    postMessage(message, transfer = []) {
      // Exercise the worker's actual encoded payload and transfer semantics.
      const response = structuredClone(message, { transfer }), waiter = pending.get(response.revision);
      assert(waiter, `unexpected worker revision ${response.revision}`);
      pending.delete(response.revision); clearTimeout(waiter.timer);
      if (response.error) waiter.reject(new Error(response.error)); else waiter.resolve(response);
    },
  } });
  try {
    await import('../src/instruments/fractal-delay/preflight-worker.js?multiport-wire-regression');
    const prepare = (revision, overrides) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(revision); reject(new Error(`preflight revision ${revision} timed out`)); }, 5000);
      pending.set(revision, { resolve, reject, timer });
      self.onmessage({ data: { revision, parameters: { ...parameters, ...overrides }, performance,
        sampleRate: RATE, memoryBytes: 96 * 1024 * 1024, budget: 64, manual: true, module } });
    });
    const prepared = [await prepare(101, {}), await prepare(102, { inputMode: 'all' }),
      await prepare(103, { inputMode: 'all', pickupMode: 'all' })];
    const scenes = prepared.map(response => {
      assert.equal(response.type, 'prepared');
      const scene = JSON.parse(new TextDecoder().decode(response.sceneBytes)), network = response.network;
      assert.deepEqual(scene.inputPorts, network.inputPorts, 'the wire must preserve actual admitted source ports');
      assert.deepEqual(scene.pickupPorts, network.pickupPorts, 'the wire must preserve actual admitted receivers');
      for (const ports of [scene.inputPorts, scene.pickupPorts]) {
        assert.equal(new Set(ports.map(port => port.node)).size, ports.length);
        assert(ports.every(port => Number.isInteger(port.node) && port.node >= 0 && port.node < scene.nodes.length && port.weight > 0));
      }
      assert.equal(network.metadata.inputMode, network.parameters.inputMode, 'cached metadata follows the new source mode');
      assert.equal(network.metadata.pickupMode, network.parameters.pickupMode, 'cached metadata follows the new pickup mode');
      assert.equal(network.metadata.inputPortCount, scene.inputPorts.length);
      assert.equal(network.metadata.pickupPortCount, scene.pickupPorts.length);
      return scene;
    });
    assert.equal(scenes[0].inputPorts.length, 1); assert.equal(scenes[0].pickupPorts.length, 1);
    assert.equal(scenes[1].inputPorts.length, scenes[1].nodes.length); assert.equal(scenes[1].pickupPorts.length, 1);
    assert.equal(scenes[2].pickupPorts.length, scenes[2].nodes.length);
    for (let i = 1; i < scenes.length; i++) {
      assert.deepEqual(scenes[i].nodes, scenes[0].nodes); assert.deepEqual(scenes[i].edges, scenes[0].edges);
      assert.equal(prepared[i].requiredDelayBytes, prepared[0].requiredDelayBytes, 'port edits reuse admitted delay memory');
    }
    for (const response of prepared) {
      const engine = createWasmNetwork(module, RATE); engines.push(engine);
      engine.controls(parameters, performance, 'media');
      // Settle control smoothing on silence before installing a fresh graph.
      for (let block = 0; block < 240; block++) engine.process(zero);
      engine.prepareScene(response.sceneBytes, response.revision);
      assert.equal(engine.status().requiredDelayBytes, response.requiredDelayBytes);
    }
    const firstBlocks = engines.map(peakBlock), pickup = scenes[0].pickupNode;
    const incident = scenes[0].edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.a === pickup || edge.b === pickup);
    assert(incident.length > 0); assert.notEqual(pickup, scenes[0].inputNode);
    const pressureAtPickup = engine => {
      const wave = engine.status().edgeWaveforms;
      return Math.max(...incident.map(({ edge, index }) => Math.abs(wave[index * 32 + (edge.a === pickup ? 0 : 31)])));
    };
    assert(pressureAtPickup(engines[1]) > .0001, 'all-source encoded scene injects real outgoing waves at the distant receiver node immediately');
    assert(pressureAtPickup(engines[0]) < 1e-8, 'legacy root excitation has not travelled to that receiver in the first block');

    const pointDistance = shortestDistance(scenes[0], scenes[0].inputNode, pickup);
    const allDistance = Math.min(...incident.map(({ edge }) => edge.length));
    const framesPerLength = RATE * parameters.timeMs / 1000;
    assert((pointDistance - allDistance) * framesPerLength > BLOCK, 'fixture separates local multiport transit from the root-to-pickup route');
    const frames = Math.ceil((pointDistance * framesPerLength + 2 * BLOCK) / BLOCK) * BLOCK;
    assert(frames < RATE, 'this regression renders less than one second per engine');
    const pcm = firstBlocks.map(first => { const samples = new Float32Array(frames); samples.set(first); return samples; });
    for (let offset = BLOCK; offset < frames; offset += BLOCK) engines.forEach((engine, i) => pcm[i].set(peakBlock(engine), offset));
    const onsets = pcm.map(samples => samples.findIndex(value => value > .00001));
    assert(onsets.every(onset => onset >= 0), 'all three real encoded scenes become audible');
    assert(onsets[1] + BLOCK < onsets[0], `all-input arrives earlier (${onsets[1]}) than the legacy root route (${onsets[0]})`);
    assert(onsets[2] + BLOCK < onsets[1], `all-receiver encoded scene hears shorter routes (${onsets[2]}) than the distant single pickup (${onsets[1]})`);
    const beforeRootArrival = Math.floor((pointDistance + allDistance) * .5 * framesPerLength);
    assert(pcm[0].subarray(0, beforeRootArrival).every(value => value < 1e-8), 'point output stays silent until its actual geometric route arrives');
    assert(pcm[1].subarray(0, beforeRootArrival).some(value => value > .00001), 'serialized all-input becomes audible before the legacy route could arrive');
    t.diagnostic(`Rust onset frames: point ${onsets[0]}, all input ${onsets[1]}, all input and pickup ${onsets[2]}; ${scenes[0].edges.length} unchanged edges, ${prepared[0].requiredDelayBytes} delay bytes`);
  } finally {
    engines.forEach(engine => engine.dispose());
    // The worker yields once after posting. Let it finish before removing self.
    await new Promise(resolve => setTimeout(resolve, 0));
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf); else delete globalThis.self;
  }
});
