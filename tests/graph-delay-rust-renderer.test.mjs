import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraphDelayRenderer } from '../src/instruments/graph-delay-rust/graph-delay-renderer.js';

function fixture({ backend = 'GPU', compile = true } = {}) {
  let currentBuffer = null, nextId = 1;
  const buffers = new Map(), listeners = new Map(), draws = [], uniforms = new Map();
  const deleted = [], calls = { allocations: 0, loss: 0 };
  const gl = {
    MAX_RENDERBUFFER_SIZE: 1, RENDERER: 2, ARRAY_BUFFER: 3, TRIANGLE_STRIP: 4, TRIANGLES: 5,
    getExtension(name) { return name === 'WEBGL_lose_context' ? { loseContext() { calls.loss++; } } : null; },
    getParameter(name) { return name === this.MAX_RENDERBUFFER_SIZE ? 8192 : backend; },
    createShader: () => nextId++, shaderSource() {}, compileShader() {},
    getShaderParameter: () => compile, deleteShader: id => deleted.push(id),
    createProgram: () => nextId++, attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
    deleteProgram: id => deleted.push(id), createBuffer: () => nextId++, deleteBuffer: id => deleted.push(id),
    createVertexArray: () => nextId++, deleteVertexArray: id => deleted.push(id),
    getUniformLocation: (_, name) => name, bindVertexArray() {},
    bindBuffer(_, buffer) { currentBuffer = buffer; },
    bufferData(_, data) { buffers.set(currentBuffer, new Float32Array(data / 4)); calls.allocations++; },
    bufferSubData(_, offset, data, start, length) { buffers.get(currentBuffer).set(data.subarray(start, start + length), offset / 4); },
    enableVertexAttribArray() {}, vertexAttribPointer() {}, vertexAttribDivisor() {},
    useProgram() {}, uniform3fv() {}, uniform2f() {}, uniform1f(name, value) { uniforms.set(name, value); },
    uniform1i(name, value) { uniforms.set(name, value); }, enable() {}, blendFunc() {}, disable() {},
    clearColor() {}, viewport() {}, clear() {},
    drawArraysInstanced(mode, first, vertices, instances) { draws.push({ mode, vertices, instances }); },
  };
  const canvas = { width: 0, height: 0, hidden: false, getContext: () => gl,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  };
  return { gl, canvas, listeners, draws, uniforms, buffers, calls, deleted };
}

const frame = () => ({
  points: [{ x: 80, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 240 }],
  edges: [{ id: 0, from: 0, to: 1 }, { id: 1, from: 1, to: 2, feedbackEdge: true }],
  entries: [0], sinks: [2], inputPoint: { x: 20, y: 100 }, outputPoint: { x: 370, y: 240 },
  inputLevel: .7, seconds: 2,
});

test('graph GPU draws directed routes in two bounded passes and meters only measured signal', () => {
  const f = fixture(), renderer = createGraphDelayRenderer(f.canvas);
  renderer.resize(400, 300, 4);
  assert.equal(f.canvas.width, 800);
  assert.equal(renderer.stats.dpr, 2);
  const scene = frame();
  assert.equal(renderer.draw(scene), true);
  const [geometry, meters] = [...f.buffers.values()];
  assert.deepEqual(Array.from(meters.slice(0, 4)).map(value => Math.round(value * 10) / 10), [0, 0, .7, 0],
    'microphone activity must not invent energy in unmeasured edges or speaker taps');
  assert.equal(geometry[0], 92, 'trim the source node radius');
  assert.equal(geometry[2], 185, 'stop at the target node with room for the arrow');
  assert.equal(geometry[15], 2, 'feedback route retains its distinct color flag');
  assert.deepEqual(f.draws, [
    { mode: f.gl.TRIANGLE_STRIP, vertices: 26, instances: 4 },
    { mode: f.gl.TRIANGLES, vertices: 3, instances: 4 },
  ]);
  scene.edgeLevels = new Float32Array([.4, .9]); scene.nodeLevels = new Map([[2, .5]]);
  scene.switches = new Map([['1>2', false]]);
  renderer.draw(scene);
  assert.deepEqual(Array.from(meters.slice(0, 4)).map(value => Math.round(value * 10) / 10), [.4, 0, .7, .5]);
  assert.equal(geometry[15], 3, 'closed feedback remains distinguishable and cannot vibrate');
  scene.edgeLevels = [NaN, Infinity]; scene.inputLevel = NaN; scene.nodeLevels = [0, 0, -1];
  renderer.draw(scene);
  assert.deepEqual(Array.from(meters.slice(0, 4)), [0, 0, 0, 0]);
  renderer.dispose();
});

test('graph motion updates reusable geometry while meter-only frames leave it untouched', () => {
  const f = fixture(), renderer = createGraphDelayRenderer(f.canvas), scene = frame();
  renderer.draw(scene);
  const allocations = renderer.stats.bufferAllocations, topologyUploads = renderer.stats.topologyUploads;
  for (let index = 0; index < 30; index++) {
    scene.edgeLevels = [index / 30, .1]; scene.seconds += .02; renderer.draw(scene);
  }
  assert.equal(renderer.stats.topologyUploads, topologyUploads);
  scene.points[1].y += 20; renderer.draw(scene);
  assert.equal(renderer.stats.topologyUploads, topologyUploads + 1);
  assert.equal(renderer.stats.bufferAllocations, allocations, 'dragging never reallocates GPU storage');
  assert.equal(renderer.stats.capacity, 16);
  renderer.dispose();
});

test('context loss requests Canvas fallback and restores current data without changing audio', () => {
  const f = fixture(); let invalidations = 0;
  const renderer = createGraphDelayRenderer(f.canvas, { onInvalidate: () => invalidations++ }), scene = frame();
  renderer.draw(scene); let prevented = false;
  f.listeners.get('webglcontextlost')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(renderer.available, false);
  assert.equal(renderer.fallbackReason, 'context-lost'); assert.equal(f.canvas.hidden, true);
  assert.equal(renderer.draw(scene), false);
  scene.points[0].x += 10;
  f.listeners.get('webglcontextrestored')();
  assert.equal(renderer.available, true); assert.equal(renderer.fallbackReason, '');
  assert.equal(renderer.draw(scene), true); assert.equal(f.canvas.hidden, false);
  assert.equal(invalidations, 2);
  const draws = f.draws.length;
  renderer.dispose(); renderer.dispose();
  assert.equal(renderer.draw(scene), false); assert.equal(renderer.available, false);
  assert.equal(f.draws.length, draws); assert.equal(f.listeners.size, 0);
  assert.equal(f.calls.loss, 1); assert.equal(renderer.fallbackReason, 'disposed');
});

test('unsupported, software, and failed shader backends cleanly retain Canvas rendering', () => {
  assert.equal(createGraphDelayRenderer({ getContext: () => null }), null);
  assert.equal(createGraphDelayRenderer({ getContext() { throw new Error('disabled'); } }), null);
  const software = fixture({ backend: 'ANGLE SwiftShader' });
  assert.equal(createGraphDelayRenderer(software.canvas), null); assert.equal(software.calls.loss, 1);
  const forced = createGraphDelayRenderer(software.canvas, { force: true });
  assert.equal(forced.available, true); forced.dispose();
  const failure = fixture({ compile: false });
  assert.equal(createGraphDelayRenderer(failure.canvas), null);
  assert.ok(failure.deleted.length >= 5); assert.equal(failure.calls.loss, 1);
});

test('pixel area, routes, detail and malformed points are bounded independently of audio capacity', () => {
  const f = fixture(), renderer = createGraphDelayRenderer(f.canvas), scene = frame();
  renderer.resize(10000, 8000, 6);
  assert.ok(f.canvas.width * f.canvas.height <= 4 * 1024 * 1024);
  scene.edges = Array.from({ length: 20000 }, (_, id) => ({ id, from: 0, to: 1 }));
  scene.detailSteps = 900;
  renderer.draw(scene);
  assert.equal(renderer.stats.routes, 16384);
  assert.equal(renderer.stats.omittedRoutes, 3618);
  assert.equal(f.draws[0].vertices, 30);
  scene.edges = [{ id: 0, from: 0, to: 0 }, { id: 1, from: 0, to: 10 }];
  scene.entries = []; scene.sinks = [];
  assert.equal(renderer.draw(scene), true);
  assert.equal(renderer.stats.routes, 0);
  assert.ok([...f.buffers.values()].every(buffer => buffer.every(Number.isFinite)));
  renderer.dispose();
});
