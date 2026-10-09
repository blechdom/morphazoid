import assert from 'node:assert/strict';
import test from 'node:test';
import { createGpuFrameTimer, createGpuBranchRenderer } from '../src/instruments/micmic/native/gpu-renderer.js';

function timingFixture({ supported = true } = {}) {
  let time = 0, disjoint = false, nextId = 0, active = null;
  const queries = [], deleted = [], calls = [], failures = new Set();
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = { QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4,
    getExtension: () => supported ? extension : null,
    getParameter() { if (failures.has('poll')) throw new Error('timer unavailable'); return disjoint; },
    createQuery() { const query = { id: ++nextId, available: false, nanoseconds: 0 }; queries.push(query); return query; },
    beginQuery(target, query) {
      calls.push(['begin', target, query]);
      if (failures.has('begin')) throw new Error('query unavailable');
      assert.equal(active, null, 'only one elapsed query may be active'); active = query;
    },
    endQuery(target) { calls.push(['end', target]); active = null; },
    getQueryParameter(query, parameter) {
      calls.push(['read', query, parameter]);
      if (parameter === gl.QUERY_RESULT_AVAILABLE) return query.available;
      assert.ok(query.available, 'reading an unavailable query would stall graphics');
      if (failures.has('result')) throw new Error('result unavailable');
      return query.nanoseconds;
    },
    deleteQuery(query) { deleted.push(query); },
    finish() { assert.fail('GPU measurement may never force synchronous completion'); }
  };
  const timer = createGpuFrameTimer(gl, { now: () => time });
  return { gl, timer, queries, deleted, calls, failures, extension,
    setTime(value) { time = value; }, setDisjoint(value) { disjoint = value; },
    frame(value) { time = value; timer.begin(); timer.end(); } };
}

test('GPU duration is unavailable until an asynchronous result arrives; long nanosecond values retain precision', () => {
  const f = timingFixture();
  assert.equal(f.timer.stats.gpuTimingSupported, true);
  f.frame(0); f.frame(16); f.frame(249);
  assert.equal(f.queries.length, 1); assert.equal(f.timer.stats.gpuTimeMs, null);
  f.frame(250);
  assert.equal(f.timer.stats.gpuTimeMs, null);
  assert.equal(f.calls.filter(call => call[0] === 'read' && call[2] === f.gl.QUERY_RESULT).length, 0);
  f.queries[0].available = true; f.queries[0].nanoseconds = 5_000_000_123;
  f.frame(500);
  assert.equal(f.timer.stats.gpuTimeMs, 5000.000123);
  assert.equal(f.timer.stats.gpuTimeSampledAt, 0, 'timestamp belongs to the measured frame, not the later result poll');
  assert.equal(f.timer.stats.gpuTimingSamples, 1);
  assert.ok(f.deleted.includes(f.queries[0]));
  f.setTime(2500);
  assert.equal(f.timer.stats.gpuTimeMs, null, 'stale GPU time cannot impersonate current load');
  f.timer.dispose();
});

test('slow query completion has bounded storage and expired queries are released without waiting', () => {
  const f = timingFixture();
  for (let time = 0; time < 2000; time += 10) f.frame(time);
  assert.equal(f.queries.length, 2, 'four-Hz sampling may leave at most two pending queries');
  f.frame(2000);
  assert.ok(f.deleted.includes(f.queries[0]), 'expired query is discarded without reading its result');
  assert.equal(f.queries.length, 3);
  assert.equal(f.queries.length - new Set(f.deleted).size, 2);
  assert.equal(f.timer.stats.gpuTimeMs, null);
  f.timer.dispose();
  assert.equal(new Set(f.deleted).size, f.queries.length, 'ordinary teardown deletes every owned query');
});

test('unsupported and disjoint timing never supplies a fabricated GPU measurement', () => {
  const unsupported = timingFixture({ supported: false });
  unsupported.frame(0); unsupported.frame(1000);
  assert.deepEqual(unsupported.timer.stats, { gpuTimingSupported: false, gpuTimeMs: null, gpuTimeSampledAt: null, gpuTimingSamples: 0 });
  assert.equal(unsupported.queries.length, 0);
  const f = timingFixture();
  f.frame(0); f.queries[0].available = true; f.queries[0].nanoseconds = 1_700_000;
  f.frame(250); assert.equal(f.timer.stats.gpuTimeMs, 1.7);
  f.setDisjoint(true); f.frame(500);
  assert.equal(f.timer.stats.gpuTimeMs, null); assert.equal(f.timer.stats.gpuTimingSupported, true);
  assert.equal(f.queries.length, 2, 'disjoint polls do not issue another query');
  assert.equal(new Set(f.deleted).size, 2);
  f.setDisjoint(false); f.frame(750);
  assert.equal(f.queries.length, 3, 'a later valid sample may resume');
  f.timer.dispose();
});

test('timer exceptions retire telemetry and active queries without throwing into rendering', () => {
  for (const failure of ['poll', 'begin', 'result']) {
    const f = timingFixture();
    if (failure === 'result') {
      f.frame(0); f.queries[0].available = true; f.queries[0].nanoseconds = 2_000_000;
    }
    f.failures.add(failure);
    assert.doesNotThrow(() => f.frame(250));
    assert.equal(f.timer.stats.gpuTimingSupported, false);
    assert.equal(f.timer.stats.gpuTimeMs, null);
    const reads = f.calls.length; f.frame(1000);
    assert.equal(f.calls.length, reads, 'disabled telemetry stops querying the driver');
    assert.equal(new Set(f.deleted).size, f.queries.length);
  }
});

test('context-loss teardown forgets invalid query handles and requires fresh timing after restoration', () => {
  const f = timingFixture();
  f.frame(0); f.queries[0].available = true; f.queries[0].nanoseconds = 2_000_000;
  f.frame(250); f.setTime(500); f.timer.begin();
  const deletes = f.deleted.length, calls = f.calls.length;
  f.timer.dispose({ contextLost: true });
  assert.equal(f.deleted.length, deletes, 'invalid context handles must not be deleted');
  assert.equal(f.calls.length, calls, 'invalid context must not receive endQuery');
  assert.equal(f.timer.stats.gpuTimeMs, null); assert.equal(f.timer.stats.gpuTimingSupported, false);
  f.frame(750); assert.equal(f.calls.length, calls);
  const restored = createGpuFrameTimer(f.gl, { now: () => 1000 });
  assert.equal(restored.stats.gpuTimingSupported, true); assert.equal(restored.stats.gpuTimeMs, null);
  restored.dispose();
});

test('timer API failures preserve a working branch renderer and its context lifecycle', () => {
  let time = 0, failTelemetry = false, current = null, queryId = 0;
  const listeners = new Map(), drawCalls = [], deleted = [], uniforms = new Map();
  const extension = { TIME_ELAPSED_EXT: 101, GPU_DISJOINT_EXT: 102 };
  const gl = new Proxy({
    RENDERER: 1, MAX_TEXTURE_SIZE: 2, QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4,
    getExtension(name) { return name === 'EXT_disjoint_timer_query_webgl2' ? extension : null; },
    getParameter(parameter) { if (parameter === gl.RENDERER) return 'Test hardware'; if (parameter === gl.MAX_TEXTURE_SIZE) return 4096; return false; },
    getShaderParameter: () => true, getProgramParameter: () => true,
    createQuery: () => ({ id: ++queryId }),
    beginQuery(target, query) { if (failTelemetry) throw new Error('optional timing failed'); current = query; },
    endQuery() { current = null; },
    getQueryParameter(query, parameter) { return parameter === gl.QUERY_RESULT_AVAILABLE ? true : 3_000_000; },
    deleteQuery(query) { deleted.push(query); },
    drawArraysInstanced(...args) { drawCalls.push(args); },
    getUniformLocation(program, name) { return name; },
    uniform1f(name, value) { uniforms.set(name, value); },
    finish() { assert.fail('renderer timing must not wait for the GPU'); }
  }, { get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'string' && key.startsWith('create')) return () => ({});
    if (key === 'getUniformLocation') return () => ({});
    if (typeof key === 'string' && /^[A-Z_0-9]+$/.test(key)) return key;
    return () => {};
  } });
  const gpuCanvas = { style: {}, width: 0, height: 0, hidden: true,
    setAttribute() {}, getContext: () => gl,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); }, remove() {} };
  const stage = { ownerDocument: { createElement: () => gpuCanvas }, parentNode: { insertBefore() {} } };
  const renderer = createGpuBranchRenderer(stage, ['#ffffff'], { now: () => time });
  const root = { id: 'root', generation: 0, startX: 0, startY: 0, x: 20, y: 0, gain: 1 };
  renderer.setGeometry([root], { intervalMs: 100 });
  const frame = { width: 400, height: 300, dpr: 1, seconds: 0, fit: { scale: 1, x: 20, y: 20 }, detailSteps: 5 };
  assert.equal(renderer.render(frame), true); assert.equal(renderer.available, true);
  const topologyUploads = renderer.stats.topologyUploads;
  for (const [semitones, ratio] of [[12, 2], [-12, .5], [0, 1], [24, 4]]) {
    renderer.setPitchOffset(semitones); assert.equal(renderer.render(frame), true);
    assert.equal(uniforms.get('uPitchOffsetRatio'), ratio);
    assert.equal(renderer.stats.topologyUploads, topologyUploads, 'live pitch edits reuse immutable branch buffers');
  }
  time = 250; assert.equal(renderer.render(frame), true); assert.equal(renderer.stats.gpuTimeMs, 3);
  failTelemetry = true; time = 500;
  assert.equal(renderer.render(frame), true); assert.equal(renderer.available, true);
  assert.equal(renderer.stats.gpuTimingSupported, false); assert.equal(renderer.stats.gpuTimeMs, null);
  assert.equal(current, null); assert.ok(drawCalls.length >= 6);
  listeners.get('webglcontextlost')({ preventDefault() {} });
  assert.equal(renderer.available, false); assert.equal(renderer.stats.gpuTimeMs, null);
  failTelemetry = false; listeners.get('webglcontextrestored')();
  assert.equal(renderer.available, true); assert.equal(renderer.stats.gpuTimingSupported, true);
  assert.equal(renderer.stats.gpuTimeMs, null, 'old GPU sample cannot survive restored resources');
  time = 750; assert.equal(renderer.render(frame), true);
  assert.equal(uniforms.get('uPitchOffsetRatio'), 4, 'context restoration retains the current pitch coefficient');
  renderer.dispose(); assert.equal(renderer.available, false); assert.equal(renderer.stats.gpuTimeMs, null);
  assert.equal(listeners.size, 0); assert.ok(deleted.length >= 3);
});
