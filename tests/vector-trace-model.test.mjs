import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createTraceBank, sampleTraceLayer, TRACE_TABLE_SIZE } from '../src/instruments/vector-fractals/trace-model.js';
import { computeContours } from '../src/instruments/vector-fractals/contour-model.js';
import { ContourRenderer } from '../src/instruments/vector-fractals/contour-renderer.js';

const view = { x: -.5, y: 0, width: 3.4, aspect: 1.4 };
function geometry(paths, depth = 12, sourceView = view) {
  const points = [], offsets = [0], closed = [];
  for (const path of paths) {
    points.push(...path.points.flat()); offsets.push(points.length / 2); closed.push(path.closed ? 1 : 0);
  }
  return { view: sourceView, points: new Float32Array(points), offsets: new Uint32Array(offsets), closed: new Uint8Array(closed), depth };
}
const square = [[-.4, -.3], [.4, -.3], [.4, .3], [-.4, .3]];
function subdivide(points, divisions, closed) {
  const result = [];
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = 0; j < divisions; j++) result.push([a[0] + (b[0] - a[0]) * j / divisions, a[1] + (b[1] - a[1]) * j / divisions]);
  }
  if (!closed) result.push(points.at(-1));
  return result;
}
function assertArraysNear(a, b, tolerance = 1e-5) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < tolerance, `sample ${i}: ${a[i]} vs ${b[i]}`);
}

test('closed traces share orientation and geometric seam independent of vertex density and input ordering', () => {
  const reference = geometry([{ points: square, closed: true }]);
  const dense = geometry([{ points: subdivide(square, 9, true).reverse(), closed: true }], 4);
  const bank = createTraceBank([dense, reference, reference]);
  for (const layer of bank.layers) {
    assert.equal(layer.x.length, TRACE_TABLE_SIZE);
    assert.equal(layer.closed, true);
    assertArraysNear(layer.x, bank.layers[2].x);
    assertArraysNear(layer.y, bank.layers[2].y);
    assertArraysNear(layer.bend, bank.layers[2].bend);
  }
  assert.ok(Math.abs(bank.layers[2].x[0] - .4) < 1e-7);
  assert.ok(Math.abs(bank.layers[2].y[0] - .3) < 1e-7);
  assert.ok(bank.layers[2].x[1] < bank.layers[2].x[0], 'canonical motion is counterclockwise');
});

test('open traces reach endpoints and retrace their exact arc without a closing chord or endpoint bend strike', () => {
  const points = [[-.4, -.2], [-.4, .2], [.3, .2]];
  const result = geometry([{ points: points.toReversed(), closed: false }]);
  const layer = createTraceBank([null, null, result]).layers[2];
  assert.ok(Math.abs(layer.x[0] + .4) < 1e-7 && Math.abs(layer.y[0] + .2) < 1e-7);
  assert.ok(Math.abs(layer.x[1024] - .3) < 1e-7 && Math.abs(layer.y[1024] - .2) < 1e-7);
  assert.equal(layer.bend[0], 0); assert.equal(layer.bend[1024], 0);
  for (let i = 1; i < 1024; i++) {
    assert.equal(layer.x[i], layer.x[2048 - i]); assert.equal(layer.y[i], layer.y[2048 - i]);
  }
  for (let i = 0; i < 2048; i++) assert.ok(Math.abs(layer.x[i] + .4) < 1e-7 || Math.abs(layer.y[i] - .2) < 1e-7);
  const dense = createTraceBank([null, null, geometry([{ points: subdivide(points, 11, false), closed: false }])]).layers[2];
  assertArraysNear(layer.bend, dense.bend);
});

test('Feature size measures an arc neighbourhood instead of counting sampled vertices', () => {
  const source = geometry([{ points: square, closed: true }]);
  const narrow = createTraceBank([source, source, source], { featureSize: .015 }).layers[2];
  const broad = createTraceBank([source, source, source], { featureSize: .15 }).layers[2];
  const active = layer => layer.bend.reduce((count, bend) => count + Number(bend > .05), 0);
  assert.ok(active(broad) > 5 * active(narrow), 'a broad neighbourhood responds for a wider geometric interval');
  assert.deepEqual(narrow.x, broad.x); assert.deepEqual(narrow.y, broad.y);
  assert.ok(broad.bend.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
});

test('fine selection uses arc length and other levels select the closest actual path to a global anchor', () => {
  const shortDense = subdivide([[.35, -.02], [.45, -.02], [.45, .02], [.35, .02]], 30, true);
  const source = geometry([{ points: shortDense, closed: true }, { points: square, closed: true }]);
  const defaultBank = createTraceBank([source, source, source]);
  assert.equal(defaultBank.layers[2].pathIndex, 1, 'more vertices do not imply more arc length');
  const anchor = { x: view.x + .45 * view.width, y: view.y };
  const selected = createTraceBank([source, source, source], { finePath: 0, anchor });
  assert.deepEqual(selected.layers.map(layer => layer.pathIndex), [0, 0, 0]);
  for (const layer of selected.layers) {
    assert.ok(Math.abs(layer.x[0] - .45) < 1e-7);
    assert.ok(Math.abs(layer.y[0]) < 1e-7, 'anchor projects onto a segment, not just its sampled vertices');
  }
});

test('Feature size is a fraction of path length, so a scaled copy keeps the same bend signal', () => {
  const outline = [[-.3, -.2], [.2, -.2], [.2, .05], [.4, .05], [.4, .3], [-.3, .3]];
  const source = geometry([{ points: outline, closed: true }]);
  const scaled = geometry([{ points: outline.map(([x, y]) => [x / 4, y / 4]), closed: true }]);
  const a = createTraceBank([source, source, source], { featureSize: .04 }).layers[0];
  const b = createTraceBank([scaled, scaled, scaled], { featureSize: .04 }).layers[0];
  for (let i = 0; i < a.bend.length; i++) assert.ok(Math.abs(a.bend[i] - b.bend[i]) < 1e-6);
});

test('empty levels stay empty and different source views retain one shared normalization', () => {
  const fine = geometry([{ points: square, closed: true }]);
  const wideView = { ...view, width: view.width * 2 };
  const broad = geometry([{ points: square.map(([x, y]) => [x / 2, y / 2]), closed: true }], 4, wideView);
  const bank = createTraceBank([broad, geometry([]), fine]);
  assert.deepEqual(bank.view, view);
  assert.equal(bank.layers[1].pathIndex, -1);
  assert.equal(bank.layers[1].x.length, 0);
  assert.equal(sampleTraceLayer(bank.layers[1], .25), null);
  assert.deepEqual(bank.layers[0].x, bank.layers[2].x);
  assert.deepEqual(bank.layers[0].y, bank.layers[2].y);
  const empty = createTraceBank([null, null, null]);
  assert.ok(empty.layers.every(layer => layer.x.length === 0 && layer.pathIndex === -1));
  const fineMissing = createTraceBank([broad, fine, geometry([])]);
  assert.deepEqual(fineMissing.layers.map(layer => layer.pathIndex), [0, 0, -1]);
  assert.ok(fineMissing.layers[0].x.length > 0 && fineMissing.layers[1].x.length > 0);
});

test('shared table interpolation wraps phase and matches the displayed source samples', () => {
  const result = geometry([{ points: square, closed: true }]);
  const layer = createTraceBank([result, result, result]).layers[0];
  const phase = 127.25 / TRACE_TABLE_SIZE;
  const sample = sampleTraceLayer(layer, phase);
  for (const key of ['x', 'y', 'bend']) assert.equal(sample[key], layer[key][127] * .75 + layer[key][128] * .25);
  assert.deepEqual(sampleTraceLayer(layer, phase + 8), sample);
  assert.deepEqual(sampleTraceLayer(layer, phase - 3), sample);
});

function canvasStub(webgl = false) {
  const calls = { uploads: 0, deleted: 0, segments: 0, markers: [] }, listeners = new Map();
  const ctx = {
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() { calls.segments++; }, stroke() {}, fill() {},
    arc(...args) { calls.markers.push(args); },
  };
  const gl = {
    COMPILE_STATUS: 1, LINK_STATUS: 2, ARRAY_BUFFER: 3, STATIC_DRAW: 4, LINES: 5, POINTS: 6,
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
    createBuffer: () => ({}), getAttribLocation: () => 0, getUniformLocation: () => ({}), enable() {}, blendFunc() {}, deleteShader() {},
    deleteBuffer() { calls.deleted++; }, deleteProgram() {}, viewport() {}, clearColor() {}, clear() {}, useProgram() {}, bindBuffer() {},
    bufferData() { calls.uploads++; }, enableVertexAttribArray() {}, vertexAttribPointer() {}, uniform2f() {}, uniform1f() {}, uniform4fv() {}, uniform4f() {},
    drawArrays() {}, disableVertexAttribArray() {}, vertexAttrib2f() {},
  };
  const canvas = {
    width: 0, height: 0, ownerDocument: { defaultView: { devicePixelRatio: 1 } },
    getContext: type => type === 'webgl' ? webgl ? gl : null : ctx,
    getBoundingClientRect: () => ({ width: 800, height: 500 }),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
  };
  return { canvas, calls, listeners };
}

test('renderer heads use the sounding tables during preview changes and dim muted layers without changing phase', () => {
  const layers = [4, 8, 12].map(depth => geometry([{ points: square, closed: true }], depth));
  const bank = createTraceBank(layers), phase = .178, stub = canvasStub();
  const renderer = new ContourRenderer(stub.canvas);
  const nextView = { ...view, x: view.x + .1, width: view.width / 2 };
  const preview = geometry([], 20, nextView);
  renderer.draw(preview, nextView, { traceBank: bank, tracePhase: phase, layers, traceEnabled: [true, false, true] });
  const snapshot = renderer.diagnosticSnapshot();
  assert.equal(snapshot.scanHead, null);
  assert.deepEqual(snapshot.traceHeads.map(head => head.enabled), [true, false, true]);
  for (let i = 0; i < 3; i++) {
    const sample = sampleTraceLayer(bank.layers[i], phase), head = snapshot.traceHeads[i];
    assert.equal(head.x, view.x + sample.x * view.width);
    assert.equal(head.y, view.y + sample.y * view.width);
    assert.equal(head.localX, sample.x); assert.equal(head.localY, sample.y);
    assert.ok(Math.abs(head.phase - phase) < 1e-14);
  }
  const sample = sampleTraceLayer(bank.layers[0], phase), firstMarker = stub.calls.markers[0];
  const worldX = view.x + sample.x * view.width, worldY = view.y + sample.y * view.width;
  assert.ok(Math.abs(firstMarker[0] - (400 + (worldX - nextView.x) / nextView.width * 800)) < 1e-10);
  assert.ok(Math.abs(firstMarker[1] - (250 - (worldY - nextView.y) / nextView.width * 800)) < 1e-10);
  renderer.destroy();
  assert.equal(stub.listeners.size, 0);
  assert.equal(renderer.diagnosticSnapshot().traceHeads.length, 0);
});

test('WebGL contour buffers stay cached as trace heads move and recover after context loss', () => {
  const layers = [4, 8, 12].map(depth => geometry([{ points: square, closed: true }], depth));
  const bank = createTraceBank(layers), stub = canvasStub(true), renderer = new ContourRenderer(stub.canvas);
  const draw = phase => renderer.draw(layers[2], view, { traceBank: bank, tracePhase: phase, layers });
  draw(0);
  const initialUploads = stub.calls.uploads;
  assert.equal(initialUploads, 4);
  draw(.25); draw(.5);
  assert.equal(stub.calls.uploads, initialUploads, 'head movement sends no geometry buffers');
  stub.listeners.get('webglcontextlost')({ preventDefault() {} });
  draw(.75);
  assert.equal(stub.calls.uploads, initialUploads);
  stub.listeners.get('webglcontextrestored')();
  draw(.75);
  assert.equal(stub.calls.uploads, 8);
  renderer.destroy();
  assert.equal(stub.calls.deleted, 4, 'all current base and layer buffers are released');
});

test('picking uses the newest fine geometry while the older sounding layers remain visible', () => {
  const old = geometry([{ points: square, closed: true }]), layers = [old, old, old];
  const preview = geometry([{ points: [[-.1, -.1], [.1, -.1]], closed: false }, { points: [[-.1, .1], [.1, .1]], closed: false }]);
  const renderer = new ContourRenderer(canvasStub().canvas);
  renderer.draw(preview, view, { traceBank: createTraceBank(layers), tracePhase: .3, layers });
  assert.equal(renderer.pick({ x: view.x, y: view.y + .1 * view.width }, view), 1);
  assert.equal(renderer.pick({ x: view.x + .4 * view.width, y: view.y }, view), -1);
  renderer.destroy();
});

async function startWorker(t) {
  const url = new URL('../src/instruments/vector-fractals/contour-worker.js', import.meta.url);
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage: (...args) => parentPort.postMessage(...args) };
    import(${JSON.stringify(url.href)}).then(() => {
      parentPort.on('message', data => self.onmessage({ data })); parentPort.postMessage({ boot: true });
    });`, { eval: true });
  t.after(() => worker.terminate());
  assert.equal((await once(worker, 'message'))[0].boot, true);
  return worker;
}
function completed(worker, id) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Layered worker timed out')); }, 5000);
    const listener = message => {
      if (message.id !== id) return;
      if (message.phase === 'error') { cleanup(); reject(new Error(message.error)); }
      if (message.phase === 'complete') { cleanup(); resolve(message); }
    };
    const cleanup = () => { clearTimeout(timeout); worker.off('message', listener); };
    worker.on('message', listener);
  });
}

test('layered Worker transfers three genuine potential levels in preview and complete while preserving fine identity', { timeout: 10000 }, async t => {
  const worker = await startWorker(t), messages = [];
  worker.on('message', message => messages.push(message));
  const next = completed(worker, 'layers');
  const request = { id: 'layers', view, depth: 12, resolution: 160, layered: true };
  worker.postMessage(request);
  const result = await next;
  assert.deepEqual(messages.map(message => message.phase), ['preview', 'complete']);
  for (const message of messages) {
    assert.equal(message.result, message.layers[2]);
    assert.deepEqual(message.layers.map(layer => layer.depth), [4, 8, 12]);
    assert.ok(message.layers.every(layer => layer.points.byteLength > 0));
    for (let index = 0; index < 3; index++) {
      const oracle = computeContours({ ...request, depth: [4, 8, 12][index], resolution: message.phase === 'preview' ? 112 : 160 });
      assert.deepEqual(message.layers[index].points, oracle.points);
    }
  }
  assert.deepEqual(result.result.points, computeContours(request).points);
});

test('a cancelled layered Worker suppresses stale completion and still handles legacy single requests', { timeout: 10000 }, async t => {
  const worker = await startWorker(t), messages = [];
  worker.on('message', message => {
    messages.push(message);
    if (message.id === 'cancelled' && message.phase === 'preview') worker.postMessage({ type: 'cancel' });
  });
  worker.postMessage({ id: 'cancelled', layered: true, view: { x: .2500457874350552, y: 0, width: 1e-10, aspect: 1 }, depth: 320, resolution: 900 });
  while (!messages.some(message => message.phase === 'preview')) await once(worker, 'message');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(messages.some(message => message.phase === 'complete'), false);
  const next = completed(worker, 'single');
  worker.postMessage({ id: 'single', view, depth: 12, resolution: 64 });
  const result = await next;
  assert.equal('layers' in result, false);
  assert.deepEqual(result.result.points, computeContours({ view, depth: 12, resolution: 64 }).points);
});

test('low Edge detail still produces three distinct field levels instead of duplicating clamped layers', { timeout: 10000 }, async t => {
  const worker = await startWorker(t), next = completed(worker, 'low');
  worker.postMessage({ id: 'low', view, depth: 4, resolution: 64, layered: true });
  const { layers } = await next;
  assert.deepEqual(layers.map(layer => layer.depth), [.5, 2.25, 4]);
  assert.notDeepEqual(layers[0].points, layers[1].points);
});
