import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWitchColor, disposeWitchColor } from '../src/instruments/witch/witch-color.js';

function probe({ available = true, compile = true } = {}) {
  const canvases = [], calls = [];
  const document = { createElement() {
    const listeners = new Map();
    const canvas = { ownerDocument: document, width: 300, height: 150,
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
      fire(type, event = {}) { listeners.get(type)?.(event); }, listeners,
    };
    const gl = new Proxy({ lost: false,
      getParameter(name) { return name === 'MAX_VIEWPORT_DIMS' ? [4096, 4096] : 4096; },
      getShaderParameter() { return compile; }, getProgramParameter() { return true; },
      getAttribLocation() { return 0; }, getUniformLocation(_, name) { return name; },
      isContextLost() { return this.lost; },
      getExtension() { return { loseContext() { calls.push(['loseContext']); } }; },
    }, { get(target, name) {
      if (name in target) return target[name];
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      return (...args) => { calls.push([name, ...args]); return name.startsWith('create') ? {} : undefined; };
    } });
    canvas.getContext = (type, options) => { calls.push(['getContext', type, options]); return available ? gl : null; };
    canvas.gl = gl; canvases.push(canvas); return canvas;
  } };
  return { source: { ownerDocument: document, width: 600, height: 432 }, canvases, calls };
}

test('one bounded pass uploads each current source and resizes only its framebuffer and texture', () => {
  const { source, canvases, calls } = probe();
  const first = renderWitchColor(source, 90, 1.25);
  assert.equal(first, canvases[0]); assert.deepEqual([first.width, first.height], [600, 432]);
  for (let i = 0; i < 4; i++) assert.equal(renderWitchColor(source, i * 38, 1.6), first);
  assert.equal(canvases.length, 1);
  assert.equal(calls.filter(([name]) => name === 'texImage2D').length, 1);
  assert.equal(calls.filter(([name]) => name === 'texSubImage2D').length, 5);
  assert.equal(calls.filter(([name]) => name === 'drawArrays').length, 5);
  assert.equal(calls.filter(([name]) => name === 'createProgram').length, 1);
  assert.ok(calls.filter(([name]) => name === 'texSubImage2D').every(call => call.at(-1) === source));
  source.width = 500; source.height = 360;
  assert.equal(renderWitchColor(source, -30, 1), first);
  assert.deepEqual([first.width, first.height], [500, 360]);
  assert.equal(calls.filter(([name]) => name === 'texImage2D').length, 2);
  assert.equal(calls.filter(([name]) => name === 'createTexture').length, 1);
  const options = calls.find(([name]) => name === 'getContext')[2];
  assert.equal(options.preserveDrawingBuffer, false); assert.equal(options.premultipliedAlpha, true);
  disposeWitchColor(source);
  assert.equal(first.listeners.size, 0); assert.ok(calls.some(([name]) => name === 'loseContext'));
  assert.notEqual(renderWitchColor(source), first, 'explicit disposal permits a fresh owner lifecycle');
  disposeWitchColor(source);
});

test('context restoration rebuilds resources and requests repaint without an animation clock', () => {
  const { source, calls } = probe(); let notifications = 0, prevented = 0;
  const notify = () => notifications++;
  const surface = renderWitchColor(source, 38, 1.25, notify);
  surface.gl.lost = true;
  surface.fire('webglcontextlost', { preventDefault() { prevented++; } });
  assert.equal(renderWitchColor(source, 82, 1.6, notify), null);
  assert.equal(prevented, 1); assert.equal(notifications, 1);
  surface.gl.lost = false; surface.fire('webglcontextrestored');
  assert.equal(notifications, 2);
  assert.equal(renderWitchColor(source, 82, 1.6, notify), surface);
  assert.equal(calls.filter(([name]) => name === 'createProgram').length, 2);
  assert.equal(calls.filter(([name]) => name === 'texImage2D').length, 2);
  assert.equal(notifications, 2, 'painting itself never schedules the next frame');
  disposeWitchColor(source); surface.fire('webglcontextrestored'); assert.equal(notifications, 2);
});

test('unavailable and failed GPU setup are cached rather than retried each frame', () => {
  for (const options of [{ available: false }, { compile: false }]) {
    const { source, canvases, calls } = probe(options);
    assert.equal(renderWitchColor(source), null); assert.equal(renderWitchColor(source), null);
    assert.equal(canvases.length, 1);
    if (options.compile === false) {
      assert.equal(calls.filter(([name]) => name === 'deleteShader').length, 1);
      assert.equal(calls.filter(([name]) => name === 'deleteProgram').length, 1);
    }
    disposeWitchColor(source);
  }
});

test('invalid sizes and nonfinite color settings do not allocate unbounded images or send NaN uniforms', () => {
  const { source, calls } = probe(); source.width = 5000;
  assert.equal(renderWitchColor(source), null);
  assert.equal(calls.filter(([name]) => name === 'texImage2D').length, 0);
  source.width = 0; assert.equal(renderWitchColor(source), null);
  source.width = 500; renderWitchColor(source, NaN, Infinity);
  assert.deepEqual(calls.find(([name]) => name === 'uniform2f'), ['uniform2f', 'turn', 1, 0]);
  assert.deepEqual(calls.find(([name]) => name === 'uniform1f'), ['uniform1f', 'saturation', 1]);
  disposeWitchColor(source); assert.equal(renderWitchColor(null), null);
});
