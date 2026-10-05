import { test, expect } from '@playwright/test';

const MODULE = '/src/instruments/micmic/native/gpu-renderer.js';
const ENGINE = '/src/instruments/micmic/native/browser-engine.js';
const COLORS = ['#fff3d6', '#55d9ff', '#5fe8c4', '#7db4ff', '#c79bff', '#ff826f', '#e8c46b'];

// Readback is deliberately confined to QA. Capture the production vertex shader
// before its real raster pass; normal rendering never waits for GPU feedback.
async function installShaderProbe(page) {
  await page.addInitScript(() => {
    const p = WebGL2RenderingContext.prototype;
    const link = p.linkProgram, draw = p.drawArraysInstanced;
    const probed = new WeakSet();
    window.__delayGpuProbe = { draws: [], enabled: false };
    p.linkProgram = function (program) {
      const source = this.getAttachedShaders(program).map(shader => this.getShaderSource(shader)).join('\n');
      if (source.includes('vCenterCss') && source.includes('vSignalEnergy')) {
        this.transformFeedbackVaryings(program, ['vCenterCss', 'vSignalEnergy', 'vColor'], this.INTERLEAVED_ATTRIBS);
        probed.add(program);
      }
      return link.call(this, program);
    };
    p.drawArraysInstanced = function (mode, first, count, instances) {
      const probe = window.__delayGpuProbe;
      if (!probe.enabled || !probed.has(this.getParameter(this.CURRENT_PROGRAM))) return draw.call(this, mode, first, count, instances);
      const feedback = this.createTransformFeedback(), buffer = this.createBuffer();
      const output = new Float32Array(count * instances * 7);
      this.bindTransformFeedback(this.TRANSFORM_FEEDBACK, feedback);
      this.bindBuffer(this.TRANSFORM_FEEDBACK_BUFFER, buffer);
      this.bufferData(this.TRANSFORM_FEEDBACK_BUFFER, output.byteLength, this.STREAM_READ);
      this.bindBufferBase(this.TRANSFORM_FEEDBACK_BUFFER, 0, buffer);
      this.enable(this.RASTERIZER_DISCARD);
      this.beginTransformFeedback(this.POINTS);
      draw.call(this, this.POINTS, first, count, instances);
      this.endTransformFeedback();
      this.disable(this.RASTERIZER_DISCARD);
      this.getBufferSubData(this.TRANSFORM_FEEDBACK_BUFFER, 0, output);
      this.bindBufferBase(this.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      this.bindTransformFeedback(this.TRANSFORM_FEEDBACK, null);
      this.bindBuffer(this.TRANSFORM_FEEDBACK_BUFFER, null);
      this.deleteBuffer(buffer); this.deleteTransformFeedback(feedback);
      const result = draw.call(this, mode, first, count, instances);
      const pixels = new Uint8Array(this.drawingBufferWidth * this.drawingBufferHeight * 4);
      this.readPixels(0, 0, this.drawingBufferWidth, this.drawingBufferHeight, this.RGBA, this.UNSIGNED_BYTE, pixels);
      let painted = 0, maximumAlpha = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index]) painted++;
        maximumAlpha = Math.max(maximumAlpha, pixels[index]);
      }
      const alphaMass = (probe.rowBands ?? []).map(cssY => {
        const dpr = this.canvas.width / this.canvas.getBoundingClientRect().width;
        let mass = 0;
        for (let y = Math.max(0, Math.floor((cssY - 4) * dpr)); y < Math.min(this.drawingBufferHeight, Math.ceil((cssY + 4) * dpr)); y++) {
          for (let x = 0; x < this.drawingBufferWidth; x++) mass += pixels[((this.drawingBufferHeight - 1 - y) * this.drawingBufferWidth + x) * 4 + 3] / 255;
        }
        return mass / (dpr * dpr);
      });
      probe.draws.push({ count, instances, output: Array.from(output), painted, maximumAlpha, alphaMass, error: this.getError() });
      if (probe.draws.length > 8) probe.draws.shift();
      if (Number.isFinite(probe.remaining) && --probe.remaining <= 0) probe.enabled = false;
      return result;
    };
  });
}

async function fixture(page) {
  await installShaderProbe(page);
  await page.route('**/__l-system-gpu-fixture.html', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>Branch GPU fixture</title><div style="position:relative;width:400px;height:320px"><canvas id="fixture" width="400" height="320" aria-label="Branch fixture" style="width:400px;height:320px"></canvas></div>' }));
  await page.goto('/__l-system-gpu-fixture.html');
  await page.evaluate(async ({ module, colors }) => {
    const { createGpuBranchRenderer } = await import(module);
    const model = await import('/src/instruments/micmic/native/model.js');
    const { generationTopology } = await import('/src/instruments/micmic/micmic.js');
    const renderer = createGpuBranchRenderer(document.getElementById('fixture'), colors, { force: true });
    window.__delayGpuFixture = { renderer, model, generationTopology, colors };
    window.__delayGpuProbe.enabled = true;
  }, { module: MODULE, colors: COLORS });
  expect(await page.evaluate(() => !!__delayGpuFixture.renderer?.available), 'Test browser supplies WebGL2').toBe(true);
}

async function goldenFrame(page, options = {}) {
  return page.evaluate(options => {
    const { renderer, model, generationTopology, colors } = __delayGpuFixture;
    const parameters = { ...model.DEFAULT_PARAMETERS, lSystemType: options.type ?? 'pythagorean', generations: 3,
      intervalMs: options.intervalMs ?? 80, timeRatio: 1, depth: .8 };
    const nodes = model.buildPreview(parameters, generationTopology);
    if (options.phaseIndex) for (const node of nodes) node.index = (node.index ?? 0) + options.phaseIndex;
    const byId = new Map(nodes.map(node => [node.id, node]));
    const limit = options.limit ?? nodes.length - 1, pending = options.pending ?? false;
    const active = model.admittedPreviewNodes(nodes, pending ? 0 : limit), activeIds = new Set(active.map(node => node.id));
    const levels = new Map(), targets = new Map(), selectedCounts = new Map();
    for (const node of active) selectedCounts.set(node.generation, (selectedCounts.get(node.generation) ?? 0) + 1);
    for (const node of nodes) if (node.generation > 0 && (options.metered !== false)) {
      levels.set(node.voiceIndex, options.energy ?? .03); targets.set(node.voiceIndex, options.energy ?? .03);
    }
    if (pending || options.energy === 0) levels.clear();
    const history = options.history === false ? null : { values: Array(2000).fill(options.historyEnergy ?? .1), interval: .01, endTime: 10 };
    const reader = history ? model.inputEnvelopeReader(history) : null;
    const frame = { width: 400, height: 320, dpr: options.dpr ?? 1, fit: { scale: 42, x: 22, y: 170 },
      seconds: 10, detailSteps: 14, reducedMotion: options.reducedMotion ?? false,
      limit, pending, historyFresh: !!history && !pending, history, levels, targets,
      rootLevel: options.rootEnergy ?? options.energy ?? .03, wet: options.wet ?? .7, wetBusGain: options.wet === 0 ? 0 : .7,
      depth: parameters.depth, selectedCounts };
    renderer.setGeometry(nodes);
    __delayGpuProbe.draws = [];
    renderer.render(frame);
    const draws = __delayGpuProbe.draws, draw = draws.at(-1);
    if (!draw) throw new Error('No production shader draw captured');
    let maximumCoordinateError = 0, maximumEnergyError = 0, unavailable = 0, available = 0, bentDescendants = 0;
    const rgb = text => [1, 3, 5].map(index => parseInt(text.slice(index, index + 2), 16) / 255);
    const violations = [];
    for (let row = 0; row < nodes.length; row++) {
      const node = nodes[row], parent = byId.get(node.parentId), energy = node.generation === 0 ? frame.rootLevel : levels.get(node.voiceIndex) ?? 0;
      const admitted = activeIds.has(node.id) || (!pending && energy > 0);
      admitted ? available++ : unavailable++;
      const project = (x, y) => ({ x: x * frame.fit.scale + frame.fit.x, y: -y * frame.fit.scale + frame.fit.y });
      const start = project(node.startX, node.startY), end = project(node.x, node.y);
      const selected = selectedCounts.get(node.generation), gain = .5 * parameters.depth ** (node.generation * .72) / Math.sqrt(selected || 1);
      const wet = frame.wetBusGain > 0 ? frame.wet : 0;
      const historyActive = frame.historyFresh && activeIds.has(node.id);
      const measured = node.generation === 0 || targets.has(node.voiceIndex), parentMeasured = parent?.generation === 0 || targets.has(parent?.voiceIndex);
      const parentEnergy = wet > 0 ? (parent?.generation === 0 ? frame.rootLevel * Math.sqrt(wet) : levels.get(parent?.voiceIndex) ?? 0) : 0;
      const points = model.branchWavePoints({ ...node, startDelay: parent?.delay ?? Math.max(0, (node.delay ?? 0) - parameters.intervalMs / 1000),
        voiceLevel: node.generation === 0 ? 1 : model.clamp(Math.sqrt(Math.max(0, gain) / .5) * Math.sqrt(wet)),
        measuredEnergy: measured ? energy : undefined, parentEnergy: parentMeasured ? parentEnergy : undefined },
        start, end, historyActive ? reader : energy, frame.detailSteps, frame.reducedMotion, frame.seconds);
      // Unavailable and available passes intentionally omit the opposite set.
      // Every node must appear in exactly one actual shader pass.
      const passes = draws.filter(candidate => candidate.output[row * candidate.count * 7 + 6] > 0);
      if (passes.length !== 1) { violations.push(`${node.id}: drawn ${passes.length} times`); continue; }
      const output = passes[0].output;
      let maximumBend = 0;
      for (let column = 0; column < draw.count; column++) {
        const step = Math.min(Math.floor(column / 2), points.length - 1), progress = step / (points.length - 1);
        const offset = (row * draw.count + column) * 7;
        const expected = admitted ? points[step] : { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress, energy: 0 };
        const coordinateError = Math.hypot(output[offset] - expected.x, output[offset + 1] - expected.y);
        const expectedEnergy = admitted ? (expected.energy ?? energy) : 0;
        const energyError = Math.abs(output[offset + 2] - expectedEnergy);
        maximumCoordinateError = Math.max(maximumCoordinateError, coordinateError);
        maximumEnergyError = Math.max(maximumEnergyError, energyError);
        const expectedColor = admitted ? [...rgb(colors[node.generation % colors.length]), .85] : [119 / 255, 131 / 255, 126 / 255, .58 * .4];
        if (expectedColor.some((value, index) => Math.abs(value - output[offset + 3 + index]) > .0001)) violations.push(`${node.id}: availability color`);
        const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
        if (length) maximumBend = Math.max(maximumBend, Math.abs(dx * (output[offset + 1] - start.y) - dy * (output[offset] - start.x)) / length);
        if (!Number.isFinite(coordinateError) || !Number.isFinite(energyError)) violations.push(`${node.id}: finite signal`);
      }
      if (node.generation > 0 && maximumBend > .01) bentDescendants++;
    }
    return { type: parameters.lSystemType, nodes: nodes.length, available, unavailable, maximumCoordinateError,
      maximumEnergyError, bentDescendants, violations: [...new Set(violations)], painted: draw.painted,
      maximumAlpha: draw.maximumAlpha, glError: draw.error, stats: renderer.stats };
  }, options);
}

test('GPU branches match Canvas signal deformation and availability for every grammar', async ({ page }) => {
  await fixture(page);
  const types = await page.evaluate(() => __delayGpuFixture.model.L_SYSTEM_TYPES);
  const report = [];
  for (const type of types) for (const options of [{ energy: 0, historyEnergy: 0 }, { energy: .03 }, { energy: 0, historyEnergy: 0, limit: 2 }]) {
    const result = await goldenFrame(page, { type, ...options }); report.push(result);
    expect(result.glError, type).toBe(0); expect(result.painted, type).toBeGreaterThan(0);
    expect(result.maximumCoordinateError, type).toBeLessThan(.005);
    expect(result.maximumEnergyError, type).toBeLessThan(.0001);
    expect(result.violations, type).toEqual([]);
    expect(result.available + result.unavailable, type).toBe(result.nodes);
    if (!options.energy) expect(result.bentDescendants, type).toBe(0);
  }
  await test.info().attach('gpu-grammar-parity', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});

test('GPU preserves quiet, wet-zero, measured short taps, history transit, pending scenes and reduced motion', async ({ page }) => {
  await fixture(page);
  const report = [];
  for (const options of [
    { energy: 0, historyEnergy: 0 }, { energy: .03, intervalMs: 100 }, { energy: .03, intervalMs: 120 },
    { energy: .03, intervalMs: 140 }, { energy: .03, intervalMs: 400 },
    { energy: 0, rootEnergy: .03, wet: 0, historyEnergy: .1 }, { energy: .03, metered: false },
    { energy: .03, history: false }, { energy: .03, reducedMotion: true }, { energy: .03, limit: 2 },
    { energy: 0, pending: true, historyEnergy: .1 }, { energy: .03, dpr: 2 }, { energy: .03, phaseIndex: 100000000 },
  ]) {
    const result = await goldenFrame(page, options); report.push({ options, ...result });
    expect(result.glError).toBe(0); expect(result.maximumCoordinateError).toBeLessThan(.005);
    expect(result.maximumEnergyError).toBeLessThan(.0001); expect(result.violations).toEqual([]);
    if (options.reducedMotion || options.pending || options.wet === 0 || (!options.energy && options.historyEnergy === 0)) expect(result.bentDescendants).toBe(0);
  }
  await test.info().attach('gpu-signal-parity', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});

test('GPU short branches retain the visible coverage of thin round Canvas strokes', async ({ page }) => {
  await fixture(page);
  const report = await page.evaluate(() => {
    const { renderer, colors } = __delayGpuFixture, result = [];
    const cases = [{ length: 0, angle: 0 }, ...[.42, 1.94, 4, 80].flatMap(length => [0, Math.PI / 2, Math.PI / 4].map(angle => ({ length, angle })))];
    for (const dpr of [1, 2]) for (const { length, angle } of cases) {
      const node = { id: 'segment', generation: 1, index: 0, voiceIndex: 0, priority: 0, gain: .5,
        startX: 120, startY: -160, x: 120 + Math.cos(angle) * length, y: -160 - Math.sin(angle) * length, delay: 0, rate: 1 };
      renderer.setGeometry([node]);
      renderer.render({ width: 400, height: 320, dpr, fit: { scale: 1, x: 0, y: 0 }, seconds: 0, detailSteps: 14,
        reducedMotion: false, limit: 10, pending: false, historyFresh: false, history: null, levels: new Map(), targets: new Map(),
        rootLevel: 0, wet: .7, wetBusGain: .7, depth: .8, selectedCounts: new Map([[1, 1]]) });
      // Include the final cap pass as well as the ribbon in this pixel check.
      const gl = renderer.canvas.getContext('webgl2'), width = 400 * dpr, height = 320 * dpr, gpuPixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, gpuPixels);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); context.scale(dpr, dpr); context.lineCap = 'round'; context.lineJoin = 'round';
      context.lineWidth = 1.2; context.globalAlpha = .85; context.strokeStyle = colors[1];
      context.beginPath(); context.moveTo(node.startX, -node.startY); context.lineTo(node.x, -node.y); context.stroke();
      const pixels = context.getImageData(0, 0, width, height).data;
      let cpuMass = 0, gpuMass = 0, symmetryError = 0;
      for (let index = 3; index < pixels.length; index += 4) { cpuMass += pixels[index] / 255; gpuMass += gpuPixels[index] / 255; }
      if (length === 0) {
        const alpha = (x, y) => gpuPixels[((height - y - 1) * width + x) * 4 + 3];
        for (let x = 1; x <= 3; x++) for (let y = 1; y <= 3; y++) {
          const samples = [alpha(120 * dpr - x, 160 * dpr - y), alpha(120 * dpr + x - 1, 160 * dpr - y),
            alpha(120 * dpr - x, 160 * dpr + y - 1), alpha(120 * dpr + x - 1, 160 * dpr + y - 1)];
          symmetryError = Math.max(symmetryError, Math.max(...samples) - Math.min(...samples));
        }
      }
      result.push({ lengthCssPx: length, angleRadians: angle, dpr, canvasAlphaMass: cpuMass / (dpr * dpr),
        gpuAlphaMass: gpuMass / (dpr * dpr), ratio: gpuMass / cpuMass, symmetryError });
    }
    return result;
  });
  await test.info().attach('gpu-short-branch-coverage', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  for (const row of report) {
    expect(row.ratio, `${row.lengthCssPx}px at ${row.angleRadians}rad DPR${row.dpr}: visible coverage`).toBeGreaterThan(.7);
    expect(row.ratio, `${row.lengthCssPx}px at ${row.angleRadians}rad DPR${row.dpr}: bounded opacity`).toBeLessThan(1.5);
    expect(row.symmetryError, `zero-length round cap DPR${row.dpr}: symmetric alpha`).toBeLessThanOrEqual(2);
  }
});

async function ready(page, query = '?renderer=webgl2') {
  await page.goto(`/l-mic-rust.html${query}`);
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
}

const status = page => page.evaluate(async module => (await import(module)).getBrowserDelayEngine().request('/api/status'), ENGINE);
const diagnostics = page => page.evaluate(async module => (await import(module)).getBrowserDelayEngine().getDiagnostics(), ENGINE);

async function selectPreset(page, id) {
  await page.locator('.instrument-preset-controls summary').click();
  await page.locator(`[data-full-preset][data-preset-id="${id}"]`).click();
  await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', id);
  await expect(page.locator('.instrument-preset-controls')).not.toHaveAttribute('aria-busy', 'true');
}

test('automatic renderer avoids a known CPU graphics backend without arming Audio', async ({ page }) => {
  await ready(page, '');
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
    if (!gl) return { backend: 'unavailable', selected: document.getElementById('stage').dataset.renderer };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const backend = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { backend, selected: document.getElementById('stage').dataset.renderer };
  });
  if (/swiftshader|llvmpipe|softpipe|software rasterizer|unavailable/i.test(result.backend)) expect(result.selected).toBe('canvas');
  expect((await diagnostics(page)).audio).toBe(false);
  await test.info().attach('automatic-graphics-backend', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('GPU layer keeps the original gesture surface aligned and reachable in three layouts', async ({ page }) => {
  test.setTimeout(60000);
  await ready(page);
  await selectPreset(page, 'coral');
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'webgl2');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await page.locator('#stage').scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => {
      const stage = document.getElementById('stage'), gpu = stage.parentElement.querySelector('canvas:not(#stage)');
      if (!gpu) return Infinity;
      const a = stage.getBoundingClientRect(), b = gpu.getBoundingClientRect();
      return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
    })).toBeLessThan(1);
    const placement = await page.evaluate(() => {
      const stage = document.getElementById('stage'), gpu = stage.parentElement.querySelector('canvas:not(#stage)'), a = stage.getBoundingClientRect();
      return { gpuHidden: gpu.getAttribute('aria-hidden'), gpuTabIndex: gpu.tabIndex,
        pointerEvents: getComputedStyle(gpu).pointerEvents, target: document.elementFromPoint(a.x + a.width * .5, a.y + a.height * .45)?.id,
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    expect(placement).toMatchObject({ gpuHidden: 'true', gpuTabIndex: -1, pointerEvents: 'none', target: 'stage' });
    expect(placement.overflow).toBeLessThanOrEqual(1);
    await page.locator('#stage').focus(); const before = await status(page); await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await status(page)).parameters.angle).toBeGreaterThan(before.parameters.angle);
    expect((await status(page)).audio).toBe(false);
    await test.info().attach(`gpu-${viewport.width}x${viewport.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
});

test('GPU context loss redraws the complete Canvas fallback while Audio is off', async ({ page }) => {
  await ready(page);
  const before = await status(page);
  await page.evaluate(() => {
    const canvas = document.getElementById('stage').parentElement.querySelector('canvas:not(#stage)');
    window.__delayGpuLoss = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!__delayGpuLoss) throw new Error('Browser cannot simulate GPU context loss');
    __delayGpuLoss.loseContext();
  });
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'canvas');
  await expect.poll(() => page.locator('#stage').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    .data.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
  expect((await status(page)).parameters).toEqual(before.parameters);
  expect((await diagnostics(page)).audio).toBe(false);
  await page.evaluate(() => __delayGpuLoss.restoreContext());
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'webgl2');
  expect((await diagnostics(page)).audio).toBe(false);
});

for (const mode of ['canvas', 'null', 'throw', 'shader']) {
  test(`${mode} GPU fallback keeps a complete playable Canvas`, async ({ page }) => {
    if (mode !== 'canvas') await page.addInitScript(mode => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl2') { if (mode === 'throw') throw new Error('QA unavailable GPU'); return null; }
        return get.call(this, type, ...args);
      };
      if (mode === 'shader') {
        HTMLCanvasElement.prototype.getContext = get;
        const check = WebGL2RenderingContext.prototype.getShaderParameter;
        WebGL2RenderingContext.prototype.getShaderParameter = function (shader, parameter) {
          return parameter === this.COMPILE_STATUS ? false : check.call(this, shader, parameter);
        };
      }
    }, mode);
    await ready(page, mode === 'canvas' ? '?renderer=canvas' : '?renderer=webgl2');
    await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'canvas');
    const pixels = await page.locator('#stage').evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return data.some((value, index) => index % 4 === 3 && value > 0);
    });
    expect(pixels, `${mode}: fallback actually paints branches`).toBe(true);
    const before = await status(page); await page.locator('#stage').focus(); await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await status(page)).parameters.angle).toBeGreaterThan(before.parameters.angle);
    expect((await diagnostics(page)).audio).toBe(false);
  });
}

test('real Rust WASM audio survives GPU loss, restore, UI stalls and branching preset recalls', async ({ page }) => {
  // This explicitly forces GPU rendering even on CI's slow software backend.
  test.setTimeout(180000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await installShaderProbe(page);
  await page.addInitScript(() => {
    window.__delayGpuMic = { requests: 0, sources: [], stopped: 0 };
    navigator.mediaDevices.getUserMedia = async () => {
      __delayGpuMic.requests++;
      const context = new AudioContext(), destination = context.createMediaStreamDestination(), oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 173; gain.gain.value = .03;
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      __delayGpuMic.sources.push({ context, oscillator, gain });
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { __delayGpuMic.stopped++; stop(); oscillator.stop(); void context.close(); };
      }
      return destination.stream;
    };
  });
  await ready(page); await selectPreset(page, 'coral');
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'webgl2');
  expect((await diagnostics(page)).audio).toBe(false); expect(await page.evaluate(() => __delayGpuMic.requests)).toBe(0);
  await page.locator('#micButton').click();
  await expect.poll(async () => (await diagnostics(page)).microphoneEnabled).toBe(true);
  expect((await status(page)).audio).toBe(false);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).status.outputPeak, { timeout: 15000 }).toBeGreaterThan(.00001);
  await page.evaluate(() => { __delayGpuProbe.draws = []; __delayGpuProbe.remaining = 4; __delayGpuProbe.enabled = true; });
  await expect.poll(() => page.evaluate(() => {
    let bent = 0;
    for (const draw of __delayGpuProbe.draws) for (let row = 0; row < draw.instances; row++) {
      const first = row * draw.count * 7, last = first + (draw.count - 1) * 7;
      const x = draw.output[first], y = draw.output[first + 1], ex = draw.output[last], ey = draw.output[last + 1];
      // Instance zero is the white root. The old test-tone control was removed;
      // measure actual following branch geometry rather than that legacy DOM.
      if (!draw.output[first + 6] || row === 0) continue;
      const length = Math.hypot(ex - x, ey - y); let bend = 0;
      for (let column = 0; column < draw.count; column++) {
        const index = first + column * 7;
        if (length) bend = Math.max(bend, Math.abs((draw.output[index] - x) * (ey - y) - (draw.output[index + 1] - y) * (ex - x)) / length);
      }
      if (bend > .01) bent++;
    }
    return bent;
  }), { timeout: 10000 }).toBeGreaterThan(0);
  const initial = await diagnostics(page), before = await status(page);
  await page.evaluate(() => { const end = performance.now() + 250; while (performance.now() < end) {} });
  await expect.poll(async () => (await status(page)).status.elapsedSeconds).toBeGreaterThan(before.status.elapsedSeconds + .2);
  const gpuCanvas = await page.evaluate(() => {
    const canvas = document.getElementById('stage').parentElement.querySelector('canvas:not(#stage)');
    const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.__delayGpuLoss = extension; extension.loseContext(); return true;
  });
  expect(gpuCanvas, 'Browser exposes loss simulation').toBe(true);
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'canvas');
  const duringLoss = await status(page); expect(duringLoss.audio).toBe(true); expect(duringLoss.status.outputPeak).toBeGreaterThan(.00001);
  expect((await diagnostics(page)).microphoneEnabled).toBe(true);
  await page.evaluate(() => __delayGpuLoss.restoreContext());
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', 'webgl2', { timeout: 15000 });
  for (const id of ['pythagorean', 'coral', 'pythagorean']) {
    await selectPreset(page, id);
    await expect.poll(async () => (await status(page)).status.outputPeak, { timeout: 15000 }).toBeGreaterThan(.00001);
    const current = await diagnostics(page); expect(current.audio).toBe(true); expect(current.microphoneEnabled).toBe(true);
    expect(current.connectionCount).toBe(initial.connectionCount); expect(current.contextState).toBe('running');
  }
  const after = await status(page); expect(after.status.elapsedSeconds).toBeGreaterThan(duringLoss.status.elapsedSeconds);
  expect(Number.isFinite(after.status.outputPeak)).toBe(true); expect(after.status.outputPeak).toBeLessThanOrEqual(1);
  await page.locator('#audioButton').click(); await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  expect((await diagnostics(page)).microphoneEnabled).toBe(false);
  expect(errors).toEqual([]); expect(requests).toEqual([]);
  await test.info().attach('gpu-real-wasm-lifecycle', { body: JSON.stringify({ before: before.status, duringLoss: duringLoss.status,
    after: after.status, initialDiagnostics: initial, listeningPerformed: false }, null, 2), contentType: 'application/json' });
});
