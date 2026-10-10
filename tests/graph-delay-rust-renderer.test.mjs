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

function timingFixture() {
  const f = fixture(), extension = { TIME_ELAPSED_EXT: 100, GPU_DISJOINT_EXT: 101 };
  const getExtension = f.gl.getExtension, getParameter = f.gl.getParameter, draw = f.gl.drawArraysInstanced;
  const timing = { now: 0, disjoint: false, failBegin: false, queries: [], deleted: [], events: [], resultReads: 0 };
  Object.assign(f.gl, {
    QUERY_RESULT_AVAILABLE: 102, QUERY_RESULT: 103,
    getExtension(name) { return name === 'EXT_disjoint_timer_query_webgl2' ? extension : getExtension.call(this, name); },
    getParameter(name) { return name === extension.GPU_DISJOINT_EXT ? timing.disjoint : getParameter.call(this, name); },
    createQuery() { const query = { available: false, nanoseconds: 3500000 }; timing.queries.push(query); return query; },
    beginQuery() { timing.events.push('begin'); if (timing.failBegin) throw new Error('timer unavailable'); },
    endQuery() { timing.events.push('end'); },
    deleteQuery(query) { timing.deleted.push(query); },
    getQueryParameter(query, name) {
      if (name === this.QUERY_RESULT_AVAILABLE) return query.available;
      assert.equal(query.available, true, 'never read an unfinished query result');
      timing.resultReads++; return query.nanoseconds;
    },
    drawArraysInstanced(...args) { timing.events.push('draw'); draw.apply(this, args); },
  });
  return { ...f, timing, now: () => timing.now };
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

test('optional GPU metrics report unavailable timing without inventing measurements', () => {
  const f = fixture(), renderer = createGraphDelayRenderer(f.canvas);
  assert.equal(renderer.draw(frame()), true);
  assert.equal(renderer.getStats().gpuTimingSupported, false);
  assert.equal(renderer.getStats().gpuTimeMs, null);
  assert.equal(renderer.getStats().gpuTimeSampledAt, null);
  assert.equal(renderer.getStats().gpuTimingSamples, 0);
  assert.deepEqual(renderer.getStats(), renderer.stats, 'preserve the existing statistics getter');
  renderer.dispose();
});

test('GPU metrics time draw passes asynchronously at a bounded rate and expire old samples', () => {
  const f = timingFixture(), renderer = createGraphDelayRenderer(f.canvas, { now: f.now }), scene = frame();
  assert.equal(renderer.getStats().gpuTimingSupported, true);
  assert.equal(renderer.getStats().gpuTimeMs, null);
  renderer.draw(scene);
  assert.deepEqual(f.timing.events, ['begin', 'draw', 'draw', 'end']);
  f.timing.now = 125; renderer.draw(scene);
  assert.equal(f.timing.queries.length, 1, 'sample no more than four frames per second');
  f.timing.now = 250; renderer.draw(scene);
  f.timing.now = 500; renderer.draw(scene);
  assert.equal(f.timing.queries.length, 2, 'at most two GPU queries can be pending');
  assert.equal(f.timing.resultReads, 0, 'an unavailable result cannot stall rendering');
  f.timing.queries[0].available = true;
  f.timing.now = 750; renderer.draw(scene);
  const stats = renderer.getStats();
  assert.equal(stats.gpuTimeMs, 3.5);
  assert.equal(stats.gpuTimeSampledAt, 0);
  assert.equal(stats.gpuTimingSamples, 1);
  assert.equal(f.timing.resultReads, 1);
  assert.equal(f.timing.queries.length - f.timing.deleted.length, 2);
  f.timing.now = 2000;
  assert.equal(renderer.getStats().gpuTimeMs, null, 'idle panels must not retain stale GPU timings');
  assert.equal(renderer.getStats().gpuTimeSampledAt, null);
  renderer.dispose();
  assert.equal(f.timing.deleted.length, f.timing.queries.length);
});

test('GPU timing retires stuck queries and deletes each pending handle on disposal', () => {
  const f = timingFixture(), renderer = createGraphDelayRenderer(f.canvas, { now: f.now });
  for (const time of [0, 250, 500, 2000, 2250]) { f.timing.now = time; renderer.draw(frame()); }
  assert.equal(f.timing.queries.length, 4);
  assert.deepEqual(f.timing.deleted, f.timing.queries.slice(0, 2), 'two-second-old unfinished queries are retired');
  assert.equal(f.timing.resultReads, 0);
  renderer.dispose(); renderer.dispose();
  assert.equal(f.timing.deleted.length, 4);
  assert.equal(new Set(f.timing.deleted).size, 4);
  assert.equal(renderer.getStats().gpuTimingSupported, false);
  assert.equal(renderer.getStats().gpuTimeMs, null);
});

test('disjoint GPU clocks and optional timer failures clear measurements while drawing continues', () => {
  const f = timingFixture(), renderer = createGraphDelayRenderer(f.canvas, { now: f.now });
  renderer.draw(frame()); f.timing.queries[0].available = true;
  f.timing.now = 250; renderer.draw(frame());
  assert.equal(renderer.getStats().gpuTimeMs, 3.5);
  f.timing.disjoint = true; f.timing.now = 500;
  assert.equal(renderer.draw(frame()), true);
  assert.equal(renderer.getStats().gpuTimeMs, null);
  assert.equal(renderer.getStats().gpuTimingSupported, true);
  assert.deepEqual(f.timing.deleted, f.timing.queries);
  f.timing.disjoint = false; f.timing.now = 750; renderer.draw(frame());
  f.timing.failBegin = true; f.timing.now = 1000;
  assert.equal(renderer.draw(frame()), true);
  assert.equal(renderer.available, true);
  assert.equal(renderer.getStats().gpuTimingSupported, false);
  assert.equal(renderer.getStats().gpuTimeMs, null);
  assert.equal(new Set(f.timing.deleted).size, f.timing.queries.length);
  renderer.dispose();
});

test('GPU timing resets on context restoration and cleans active queries after a draw failure', () => {
  const f = timingFixture(), renderer = createGraphDelayRenderer(f.canvas, { now: f.now });
  renderer.draw(frame());
  f.listeners.get('webglcontextlost')({ preventDefault() {} });
  assert.equal(renderer.getStats().gpuTimingSupported, false);
  assert.equal(f.timing.deleted.length, 0, 'lost contexts own the invalid query handles');
  f.listeners.get('webglcontextrestored')();
  assert.equal(renderer.getStats().gpuTimingSupported, true);
  assert.equal(renderer.getStats().gpuTimeMs, null);
  f.timing.now = 1000;
  f.gl.drawArraysInstanced = () => { throw new Error('draw failed'); };
  assert.equal(renderer.draw(frame()), false);
  assert.equal(renderer.fallbackReason, 'draw-failed');
  assert.equal(renderer.getStats().gpuTimingSupported, false);
  assert.deepEqual(f.timing.deleted, [f.timing.queries[1]]);
  assert.equal(f.timing.events.at(-1), 'end', 'active timer ends before renderer cleanup');
  renderer.dispose();
  assert.equal(f.timing.deleted.length, 1);
});
