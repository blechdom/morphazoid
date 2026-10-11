import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { DEFAULT_EXPLORER_VIEW, EXPLORER_LIMITS, EXPLORER_PRESETS, complexAt, pixelAt,
  normalizeExplorerView, zoomExplorer, panExplorer, normalizeExplorerRenderRequest,
  renderFractalImage, renderFractalImageAsync } from '../src/instruments/fractal-delay/fractal-explorer.js';
import { installExplorerWorker } from '../src/instruments/fractal-delay/mandelbrot-worker.js';

const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
const byteAt = (image, x, y) => Array.from(image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const interior = [17, 54, 53, 255];

test('view normalization is finite, bounded, immutable and independent from coefficients', () => {
  assert.deepEqual(normalizeExplorerView(null), DEFAULT_EXPLORER_VIEW);
  const supplied = { set: 'julia', centerReal: '1.25', centerImag: '-.5', zoom: '8', cReal: 100, running: true };
  const previous = structuredClone(supplied), normalized = normalizeExplorerView(supplied);
  assert.deepEqual(normalized, { set: 'julia', centerReal: 1.25, centerImag: -.5, zoom: 8 });
  assert.deepEqual(supplied, previous);
  assert.deepEqual(normalizeExplorerView({ set: 'invalid', centerReal: Infinity, centerImag: -100, zoom: 1e30 }),
    { set: 'mandelbrot', centerReal: -.5, centerImag: -4, zoom: EXPLORER_LIMITS.zoom[1] });
  assert.deepEqual(normalizeExplorerView({ set: 'julia', zoom: -5 }), { set: 'julia', centerReal: 0, centerImag: 0, zoom: .5 });
});

test('screen and complex coordinates round-trip across portrait, landscape and deep zoom', () => {
  for (const aspect of [.5, 1, 2.75]) for (const zoom of [.5, 1, 75, 16384]) {
    const view = { set: 'julia', centerReal: -.734, centerImag: .132, zoom };
    for (const [x, y] of [[0, 0], [.5, .5], [1, 1], [.153, .87], [-.2, 1.2]]) {
      const complex = complexAt(view, x, y, aspect), screen = pixelAt(view, complex.real, complex.imag, aspect);
      close(screen.x, x); close(screen.y, y);
    }
    const center = complexAt(view, .5, .5, aspect);
    close(center.real, view.centerReal); close(center.imag, view.centerImag);
    assert.ok(complexAt(view, .5, 0, aspect).imag > center.imag, 'imaginary increases upward');
  }
});

test('zoom anchors and panning preserve isotropic geometric movement and never edit audio c', () => {
  const view = { ...DEFAULT_EXPLORER_VIEW, cReal: -.123, cImag: .745 };
  for (const aspect of [.65, 2]) for (const [x, y] of [[.2, .15], [.5, .5], [.9, .85]]) {
    const before = complexAt(view, x, y, aspect), changed = zoomExplorer(view, 20, x, y, aspect);
    const after = complexAt(changed, x, y, aspect);
    close(before.real, after.real); close(before.imag, after.imag);
    assert.equal(changed.zoom, 20); assert.equal(changed.set, view.set);
    assert.deepEqual(zoomExplorer(changed, 1, x, y, aspect), DEFAULT_EXPLORER_VIEW);
    const moved = panExplorer(changed, .1, -.2, aspect);
    close(moved.centerReal, changed.centerReal - 3.4 / 20 * .1);
    close(moved.centerImag, changed.centerImag - 3.4 / 20 * .2 / aspect);
    assert.equal('cReal' in moved, false);
  }
  assert.equal(view.cReal, -.123); assert.equal(view.cImag, .745);
});

test('render allocation and iteration work stay bounded while retaining requested image aspect', () => {
  const render = normalizeExplorerRenderRequest({ width: 1440, height: 640, revision: 12,
    view: { zoom: 16384 }, iterations: 1e9, cReal: Infinity, cImag: -500 });
  assert.equal(render.width, 360); assert.equal(render.height, 160); assert.equal(render.iterations, 384);
  assert.equal(render.revision, 12); assert.equal(render.cReal, -.745); assert.equal(render.cImag, -1.5);
  assert.equal(normalizeExplorerRenderRequest({ width: NaN, height: Infinity, iterations: -1 }).iterations, 64);
  assert.ok(normalizeExplorerRenderRequest({ view: { zoom: 16 } }).iterations > normalizeExplorerRenderRequest({}).iterations);
  assert.ok(normalizeExplorerRenderRequest({ width: 1e30, height: 1e30 }).width <= 360);
  assert.equal(normalizeExplorerRenderRequest({ width: 1, height: 0 }).width, 2);
});

test('Mandelbrot uses the parameter plane and Julia uses the current instrument coefficient', () => {
  const request = { width: 24, height: 24, view: { ...DEFAULT_EXPLORER_VIEW, centerReal: 0, zoom: 8 } };
  const first = renderFractalImage({ ...request, cReal: -1, cImag: 0 });
  const second = renderFractalImage({ ...request, cReal: .5, cImag: 1 });
  assert.deepEqual(first.pixels, second.pixels, 'moving c cannot redraw the Mandelbrot parameter plane');
  assert.deepEqual(byteAt(first, 12, 12), interior, 'critical orbit near zero is bounded');
  const outside = renderFractalImage({ ...request, view: { set: 'mandelbrot', centerReal: 1, zoom: 8 } });
  assert.notDeepEqual(byteAt(outside, 12, 12), interior, 'c near1 escapes');
  const circle = renderFractalImage({ width: 31, height: 31, view: { set: 'julia' }, cReal: 0, cImag: 0 });
  assert.deepEqual(byteAt(circle, 15, 15), interior, 'Julia z² bounded center');
  assert.notDeepEqual(byteAt(circle, 0, 15), interior, 'Julia z² outside unit disk escapes');
  const shifted = renderFractalImage({ width: 31, height: 31, view: { set: 'julia' }, cReal: 1, cImag: 0 });
  assert.notDeepEqual(byteAt(shifted, 15, 15), interior, 'Julia center now escapes with different c');
  assert.notDeepEqual(circle.pixels, shifted.pixels);
  for (let i = 3; i < first.pixels.length; i += 4) assert.equal(first.pixels[i], 255);
});

test('explorer view presets offer distinct bounded regions and explicit optional coefficient changes', () => {
  assert.equal(new Set(EXPLORER_PRESETS.map(({ id }) => id)).size, EXPLORER_PRESETS.length);
  assert.ok(EXPLORER_PRESETS.filter(({ view }) => view.set === 'mandelbrot').length >= 6);
  assert.ok(EXPLORER_PRESETS.filter(({ view }) => view.set === 'julia').length >= 6);
  const renderIdentities = new Set();
  for (const preset of EXPLORER_PRESETS) {
    assert.deepEqual(normalizeExplorerView(preset.view), preset.view);
    assert.ok(Object.isFrozen(preset)); assert.ok(Object.isFrozen(preset.view));
    assert.equal(preset.cReal === null, preset.cImag === null);
    if (preset.cReal !== null) {
      assert.ok(Number.isFinite(preset.cReal) && preset.cReal >= -2 && preset.cReal <= 1);
      assert.ok(Number.isFinite(preset.cImag) && preset.cImag >= -1.5 && preset.cImag <= 1.5);
    }
    const image = renderFractalImage({ width: 28, height: 28, view: preset.view, cReal: preset.cReal, cImag: preset.cImag });
    renderIdentities.add(Buffer.from(image.pixels).toString('base64'));
  }
  assert.ok(renderIdentities.size >= 10, 'regions and Julia suggestions render a substantial variety');
  const current = EXPLORER_PRESETS.find(({ id }) => id === 'julia-current');
  assert.equal(current.cReal, null); assert.equal(current.cImag, null);
});

test('chunked rendering produces the same complete pixels and yields cancellably between chunks', async () => {
  const request = { width: 37, height: 23, revision: 9, view: { set: 'julia', zoom: 2 }, cReal: -.123, cImag: .745 };
  let yields = 0;
  const actual = await renderFractalImageAsync(request, { yieldTask: async () => { yields++; }, rowsPerChunk: 3 });
  assert.deepEqual(actual, renderFractalImage(request)); assert.equal(yields, 7);
  let cancelled = false, cancelYields = 0;
  assert.equal(await renderFractalImageAsync(request, { isCancelled: () => cancelled,
    yieldTask: async () => { cancelYields++; cancelled = true; } }), null);
  assert.equal(cancelYields, 1, 'stale requests stop after a bounded row chunk');
  assert.equal(await renderFractalImageAsync(request, { isCancelled: () => true }), null);
});

test('worker coalesces rapid requests to the newest revision and disposal suppresses pending output', async () => {
  const posted = [], yields = [], scope = { postMessage: (image, transfer) => posted.push({ image, transfer }) };
  const dispose = installExplorerWorker(scope, { yieldTask: () => new Promise(resolve => yields.push(resolve)) });
  scope.onmessage({ data: { width: 20, height: 9, revision: 1 } });
  scope.onmessage({ data: { width: 20, height: 9, revision: 2 } });
  scope.onmessage({ data: { width: 20, height: 9, revision: 3, view: { set: 'julia' }, cReal: 0, cImag: 0 } });
  for (let turn = 0; turn < 12; turn++) { yields.shift()?.(); await Promise.resolve(); }
  assert.equal(posted.length, 1); assert.equal(posted[0].image.revision, 3);
  assert.deepEqual(posted[0].image.pixels, renderFractalImage({ width: 20, height: 9, view: { set: 'julia' }, cReal: 0, cImag: 0 }).pixels);
  assert.equal(posted[0].transfer[0], posted[0].image.pixels.buffer);
  scope.onmessage({ data: { width: 20, height: 9, revision: 4 } });
  dispose(); for (let turn = 0; turn < 6; turn++) { yields.shift()?.(); await Promise.resolve(); }
  assert.equal(posted.length, 1); assert.equal(scope.onmessage, null);
});

test('real worker module transfers bounded final pixel buffers and preserves viewport/revision', { timeout: 5000 }, async () => {
  const workerURL = new URL('../src/instruments/fractal-delay/mandelbrot-worker.js', import.meta.url).href;
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');
    global.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
    import(${JSON.stringify(workerURL)}).then(()=>{
      parentPort.on('message', data=>self.onmessage({data}));parentPort.postMessage({ready:true});
    });`, { eval: true });
  try {
    const nextMessage = () => new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    assert.deepEqual(await nextMessage(), { ready: true });
    const final = nextMessage();
    worker.postMessage({ width: 100, height: 100, revision: 11, view: { set: 'julia', zoom: 8 }, cReal: -.8, cImag: .156 });
    worker.postMessage({ width: 24, height: 20, revision: 12, view: { set: 'mandelbrot', centerReal: -.74, centerImag: .12, zoom: 20 } });
    const image = await final;
    assert.equal(image.revision, 12); assert.equal(image.width, 24); assert.equal(image.height, 20);
    assert.equal(image.pixels.length, 24 * 20 * 4); assert.ok(image.pixels instanceof Uint8ClampedArray);
    assert.deepEqual(image.view, { set: 'mandelbrot', centerReal: -.74, centerImag: .12, zoom: 20 });
    assert.deepEqual(image.pixels, renderFractalImage(image).pixels);
  } finally { await worker.terminate(); }
});
