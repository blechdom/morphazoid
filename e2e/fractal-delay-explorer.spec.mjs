import { test, expect } from '@playwright/test';

const ENGINE = '/src/instruments/fractal-delay/browser-engine.js';
const SIZES = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
test.use({ reducedMotion: 'no-preference' });

function knownSample() {
  const rate = 48000, frames = rate * 4, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const sample = [173, 311, 659].reduce((sum, f) => sum + Math.sin(i / rate * Math.PI * 2 * f), 0) / 3;
    bytes.writeInt16LE(Math.round(sample * .035 * 32767), 44 + i * 2);
  }
  return bytes;
}

async function fixture(page, { pcm = false } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ pcm }) => {
    const NativeWorker = Worker, NativeContext = AudioContext, NativeNode = AudioWorkletNode;
    const qa = window.__fractalExplorerWitness = { maps: [], requests: [], geometry: [], contexts: [],
      sources: [], nodes: [], packets: [], statuses: [], recording: false };
    window.Worker = class extends NativeWorker {
      constructor(url, ...args) {
        super(url, ...args);
        const map = String(url).includes('/fractal-delay/mandelbrot-worker.js');
        const geometry = String(url).includes('/fractal-delay/preflight-worker.js');
        if (!map && !geometry) return;
        const post = this.postMessage.bind(this);
        this.postMessage = (data, ...rest) => {
          if (map) qa.requests.push(structuredClone(data));
          if (geometry && data.parameters) qa.geometry.push({ revision: data.revision, parameters: { ...data.parameters } });
          return post(data, ...rest);
        };
        if (map) this.addEventListener('message', ({ data }) => {
          if (!data.pixels) return;
          // Observe actual escape-time pixels returned by the production worker.
          // Sampling every 16th pixel keeps the observer below the map's work.
          let hash = 2166136261;
          for (let i = 0; i < data.pixels.length; i += 64)
            for (let c = 0; c < 4; c++) hash = Math.imul(hash ^ data.pixels[i + c], 16777619);
          qa.maps.push({ hash: hash >>> 0, width: data.width, height: data.height, revision: data.revision });
        });
      }
    };
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); qa.contexts.push(this); }
    };
    const createSource = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const source = createSource.apply(this, args), row = { starts: 0, stops: 0, ended: false };
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...values) => { row.starts++; return start(...values); };
      source.stop = (...values) => { row.stops++; return stop(...values); };
      source.addEventListener('ended', () => { row.ended = true; });
      qa.sources.push(row); return source;
    };
    window.AudioWorkletNode = class extends NativeNode {
      constructor(...args) {
        super(...args);
        if (args[1] !== 'fractal-delay-network') return;
        qa.nodes.push(this);
        this.port.addEventListener('message', ({ data }) => {
          if (data.status) qa.statuses.push({ sampleClock: data.status.sampleClock, revision: data.status.revision,
            activeEdges: data.status.activeEdges });
        });
        if (!pcm) return;
        qa.probeReady = (async () => {
          const script = `registerProcessor('fractal-explorer-pcm-witness', class extends AudioWorkletProcessor {
            constructor() {
              super(); this.reset();
              this.port.onmessage = ({ data }) => {
                if (data === 'reset') { this.reset(); this.port.postMessage({ reset: true }); }
              };
            }
            reset() {
              this.frames = this.nonFinite = this.discontinuities = this.longestZero = this.zero = this.energy = this.peak = 0;
              this.previousEnd = undefined; this.callbackGaps = [];
            }
            process(inputs, outputs) {
              for (const output of outputs) for (const channel of output) channel.fill(0);
              const count = outputs[0][0].length, input = inputs[0] || [];
              if (this.previousEnd !== undefined && this.previousEnd !== currentFrame) {
                this.discontinuities++;
                if (this.callbackGaps.length < 16) this.callbackGaps.push({ expected: this.previousEnd, actual: currentFrame });
              }
              this.previousEnd = currentFrame + count;
              for (let i = 0; i < count; i++) {
                const l = input[0]?.[i] ?? 0, r = input[1]?.[i] ?? l;
                this.nonFinite += Number(!Number.isFinite(l) || !Number.isFinite(r));
                this.energy += (l*l + r*r) / 2; this.peak = Math.max(this.peak, Math.abs(l), Math.abs(r));
                this.zero = Math.max(Math.abs(l), Math.abs(r)) < 1e-8 ? this.zero + 1 : 0;
                this.longestZero = Math.max(this.longestZero, this.zero); this.frames++;
              }
              if (this.frames % 2560 === 0) this.port.postMessage({ frames: this.frames, rate: sampleRate,
                rms: Math.sqrt(this.energy / this.frames), peak: this.peak, nonFinite: this.nonFinite,
                discontinuities: this.discontinuities, callbackGaps: this.callbackGaps, longestZeroSeconds: this.longestZero / sampleRate });
              return true;
            }
          });`;
          const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
          try { await this.context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          const probe = qa.probe = new NativeNode(this.context, 'fractal-explorer-pcm-witness', { outputChannelCount: [1] });
          probe.port.onmessage = ({ data }) => {
            if (data.reset) { qa.resetAck?.(); return; }
            if (qa.recording) qa.packets.push(data);
          };
          this.connect(probe); probe.connect(this.context.destination);
        })();
      }
    };
  }, { pcm });
  await page.route('**/assets/synthesis/loops/*.wav', route => route.fulfill({
    status: 200, contentType: 'audio/wav', body: knownSample(),
  }));
  return errors;
}

async function diagnostics(page) {
  return page.evaluate(async module => {
    const qa = __fractalExplorerWitness;
    return { ...(await import(module)).getFractalDelayEngine().getDiagnostics(), witness: {
      contexts: qa.contexts.length, nodes: qa.nodes.length, sources: qa.sources.map(source => ({ ...source })),
      maps: qa.maps, requests: qa.requests, geometry: qa.geometry, statuses: qa.statuses,
    } };
  }, ENGINE);
}
async function ready(page) {
  await page.goto('/fractal-delay.html');
  await expect(page.locator('#audioButton')).toBeEnabled();
  await expect.poll(async () => (await diagnostics(page)).preparedEdges, { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => __fractalExplorerWitness.maps.length), { timeout: 15000 }).toBeGreaterThan(0);
  expect((await diagnostics(page)).audioDesired).toBe(false);
}
async function choose(page, id, value) {
  const select = page.locator(`#${id}`), picker = page.locator(`[data-select-id="${id}"]`);
  await expect.poll(async () => await select.isVisible() || await picker.isVisible()).toBe(true);
  if (await select.isVisible()) await select.selectOption(value);
  else {
    const index = await select.evaluate((node, value) => [...node.options].findIndex(option => option.value === value), value);
    expect(index, `#${id} option ${value}`).toBeGreaterThanOrEqual(0);
    if (await picker.getAttribute('open') === null) await picker.locator('summary').click();
    await picker.locator(`button[data-option-index="${index}"]`).click();
  }
  await expect(select).toHaveValue(value);
}
async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function zoomIn(page) {
  const input = page.locator('#explorerZoom');
  const next = await input.evaluate(node => {
    const current = Number(node.value), maximum = Number(node.max);
    return current * 1.75 < maximum ? current * 1.75 : current / 1.75;
  });
  await range(page, 'explorerZoom', next);
}
async function settled(page) {
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return !d.compiling && d.network?.parameters.cReal === d.parameters.cReal && d.network?.parameters.cImag === d.parameters.cImag
      && (!d.audio || d.status.revision === d.network.revision);
  }, { timeout: 30000 }).toBe(true);
  return diagnostics(page);
}
async function captureSettings(page) {
  await page.locator('#captureSound').evaluate(button => { button.closest('details').open = true; });
  await page.locator('#captureSound').click();
  return JSON.parse(await page.locator('#capturedSound').inputValue());
}
async function expectAudioOff(page) {
  const d = await diagnostics(page);
  expect(d.audioDesired).toBe(false); expect(d.audio).toBe(false); expect(d.contextState).toBe('uninitialized');
  expect(d.contextGeneration).toBe(0); expect(d.sourceCount).toBe(0);
  expect(d.witness.contexts).toBe(0); expect(d.witness.nodes).toBe(0); expect(d.witness.sources).toEqual([]);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
}
async function tapHasNoOverlaps(page, axis) {
  const tap = page.locator(`.mz-tap-tempo[data-tap-control="#${axis}MotionTempo"]`);
  await tap.scrollIntoViewIfNeeded(); await expect(tap).toBeVisible();
  const overlaps = await tap.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return [...button.closest('.motion-row').querySelectorAll('.knob-field b, .knob-field output, input[type=number]')]
      .filter(node => node.getBoundingClientRect().width > 0).flatMap(node => {
        const other = node.getBoundingClientRect();
        const width = Math.max(0, Math.min(bounds.right, other.right) - Math.max(bounds.left, other.left));
        const height = Math.max(0, Math.min(bounds.bottom, other.bottom) - Math.max(bounds.top, other.top));
        return width * height > 0 ? [{ id: node.id, label: node.textContent, width, height }] : [];
      });
  });
  expect(overlaps, `${axis} Tap must not cover labels, values or editable coefficients`).toEqual([]);
}

for (const viewport of SIZES) {
  test(`fractal explorer and delay divide the graphic evenly with reachable controls at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(60000); await page.setViewportSize(viewport);
    const errors = await fixture(page); await ready(page);
    const map = await page.locator('#parameterMap').boundingBox(), stage = await page.locator('#stage').boundingBox();
    expect(map.width).toBeGreaterThanOrEqual(150); expect(stage.width).toBeGreaterThanOrEqual(150);
    expect(map.height).toBeGreaterThanOrEqual(120); expect(stage.height).toBeGreaterThanOrEqual(120);
    expect(Math.abs(map.width - stage.width), 'each graphic occupies half the same row').toBeLessThanOrEqual(2);
    expect(Math.abs(map.y - stage.y)).toBeLessThanOrEqual(2);
    expect(map.x + map.width, 'explorer is on the left of the delay').toBeLessThanOrEqual(stage.x + 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    const nestedOverflow = await page.evaluate(() => [...document.querySelectorAll('.fractal-controls, .fractal-stage, .motion-row')]
      .map(node => ({ className: node.className, overflow: node.scrollWidth - node.clientWidth })).filter(row => row.overflow > 2));
    expect(nestedOverflow).toEqual([]);
    for (const id of ['explorerSet', 'explorerPreset', 'explorerPresetNext', 'explorerZoom', 'explorerReset',
      'cRealNumber', 'cImagNumber', 'cReal', 'cImag', 'realMotionPlay', 'imagMotionPlay',
      'realMotionTempo', 'imagMotionTempo', 'realMotionDepth', 'imagMotionDepth', 'motionTempoLatch']) {
      let control = page.locator(`#${id}`);
      await control.evaluate(node => {
        for (let parent = node.parentElement; parent; parent = parent.parentElement)
          if (parent.tagName === 'DETAILS' && !parent.matches('[data-select-id]')) parent.open = true;
      });
      if (!(await control.isVisible()) && await page.locator(`[data-select-id="${id}"]`).count())
        control = page.locator(`[data-select-id="${id}"] > summary`);
      await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds.x, id).toBeGreaterThanOrEqual(-1);
      expect(bounds.x + bounds.width, id).toBeLessThanOrEqual(viewport.width + 1);
    }
    for (const axis of ['real', 'imag']) await tapHasNoOverlaps(page, axis);
    await expectAudioOff(page); expect(errors).toEqual([]);
    await page.locator('#explorerSet').evaluate(node => node.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: testInfo.outputPath(`explorer-${viewport.width}.png`), fullPage: true });
  });
}

test('typeable coefficients drive the actual graph and remain editable during visual motion', async ({ page }, testInfo) => {
  test.setTimeout(90000); const errors = await fixture(page); await ready(page);
  await choose(page, 'mode', 'orbits');
  const before = await settled(page);
  for (const [id, key, value] of [['cRealNumber', 'cReal', -.16], ['cImagNumber', 'cImag', .77]]) {
    const number = page.locator(`#${id}`);
    await expect(number).toHaveAttribute('type', 'number');
    await number.fill(String(value)); await number.press('Enter'); await number.blur();
    await expect.poll(async () => (await diagnostics(page)).parameters[key]).toBe(value);
    await expect(page.locator(`#${key}`)).toHaveValue(String(value));
  }
  const typed = await settled(page);
  expect(typed.network.revision).toBeGreaterThan(before.network.revision);
  expect(typed.witness.geometry.some(row => row.parameters.cReal === -.16 && row.parameters.cImag === .77)).toBe(true);
  expect(typed.network.edges).not.toEqual(before.network.edges);
  await range(page, 'realMotionTempo', 30); await range(page, 'realMotionDepth', .08);
  await page.locator('#realMotionPlay').click();
  await expect.poll(async () => (await page.locator('#cRealNumber').inputValue())).not.toBe(String(typed.parameters.cReal));
  const number = page.locator('#cRealNumber'); await number.focus();
  await number.fill('-.321'); const heldText = await number.inputValue();
  const moving = await diagnostics(page); await page.waitForTimeout(400);
  await expect(number).toHaveValue(heldText);
  await expect.poll(async () => (await diagnostics(page)).motion.real.value).not.toBe(moving.motion.real.value);
  await number.press('Enter');
  await expect.poll(async () => (await diagnostics(page)).motion.real.center).toBe(-.321);
  await page.locator('#realMotionPlay').click(); await settled(page); await number.blur();
  await expect.poll(async () => Math.abs(Number(await number.inputValue()) - (await diagnostics(page)).parameters.cReal)).toBeLessThan(.000001);
  await expectAudioOff(page); expect(errors).toEqual([]);
  await testInfo.attach('coefficient-typing.json', { body: JSON.stringify({ typed: typed.parameters,
    moving: moving.motion, final: (await diagnostics(page)).parameters }, null, 2), contentType: 'application/json' });
});

test('tempo latch links native, keyboard and Tap edits in either direction without coupling Play or Sweep', async ({ page }, testInfo) => {
  test.setTimeout(90000); const errors = await fixture(page); await ready(page);
  const latch = page.locator('#motionTempoLatch');
  await expect(latch).toHaveAttribute('aria-pressed', 'false');
  await range(page, 'realMotionTempo', 12); await range(page, 'imagMotionTempo', 9);
  await range(page, 'realMotionDepth', .04); await range(page, 'imagMotionDepth', .08);
  await latch.click(); await expect(latch).toHaveAttribute('aria-pressed', 'true');
  const pairs = [];
  for (const [axis, tempo] of [['real', 18], ['imag', 24]]) {
    await range(page, `${axis}MotionTempo`, tempo);
    await expect.poll(async () => {
      const p = (await diagnostics(page)).parameters;
      return p.realMotionTempo === tempo && p.imagMotionTempo === tempo;
    }).toBe(true);
    pairs.push((await diagnostics(page)).parameters);
  }
  await page.locator('#realMotionTempo').focus(); await page.keyboard.press('ArrowUp');
  await expect.poll(async () => {
    const p = (await diagnostics(page)).parameters;
    return p.realMotionTempo > 24 && p.realMotionTempo === p.imagMotionTempo;
  }).toBe(true);
  for (const axis of ['imag', 'real']) {
    await range(page, `${axis}MotionTempo`, 12);
    const tap = page.locator(`.mz-tap-tempo[data-tap-control="#${axis}MotionTempo"]`);
    await tap.click(); await page.waitForTimeout(400); await tap.click();
    await expect(page.locator('#realMotionTempo')).toHaveValue('60');
    await expect(page.locator('#imagMotionTempo')).toHaveValue('60');
  }
  await page.locator('#realMotionPlay').click();
  await expect(page.locator('#realMotionPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#imagMotionPlay')).toHaveAttribute('aria-pressed', 'false');
  const moving = await diagnostics(page);
  expect(moving.motion.real.playing).toBe(true); expect(moving.motion.imag.playing).toBe(false);
  expect(moving.motion.real.depth).toBe(.04); expect(moving.motion.imag.depth).toBe(.08);
  await range(page, 'imagMotionDepth', .06);
  expect((await diagnostics(page)).parameters.realMotionDepth).toBe(.04);
  await page.locator('#realMotionPlay').click(); await settled(page);
  const captured = await captureSettings(page);
  expect(captured.version).toBe(4); expect(captured.motionTempoLatched).toBe(true);
  await latch.click(); await range(page, 'imagMotionTempo', 15);
  expect((await diagnostics(page)).parameters.realMotionTempo).toBe(60);
  expect((await diagnostics(page)).parameters.imagMotionTempo).toBe(15);
  await expectAudioOff(page); expect(errors).toEqual([]);
  await testInfo.attach('tempo-latch.json', { body: JSON.stringify({ pairs, captured }, null, 2), contentType: 'application/json' });
});

test('Mandelbrot and Julia locations, zoom, drag and keyboard controls change real pixels and recover', async ({ page }, testInfo) => {
  test.setTimeout(90000); const errors = await fixture(page); await ready(page);
  const initial = await diagnostics(page), explorer = page.locator('#parameterMap');
  const initialPreset = await page.locator('#explorerPreset').inputValue();
  await page.locator('#explorerPresetNext').click();
  await expect(page.locator('#explorerPreset')).not.toHaveValue(initialPreset);
  await expect.poll(async () => (await diagnostics(page)).witness.maps.at(-1).hash).not.toBe(initial.witness.maps.at(-1).hash);
  const located = await diagnostics(page);
  await zoomIn(page);
  await expect.poll(async () => (await diagnostics(page)).witness.maps.at(-1).hash).not.toBe(located.witness.maps.at(-1).hash);
  const zoomed = await diagnostics(page);
  await choose(page, 'explorerSet', 'julia');
  await expect.poll(async () => (await diagnostics(page)).witness.maps.at(-1).hash).not.toBe(zoomed.witness.maps.at(-1).hash);
  const julia = await captureSettings(page);
  expect(julia.explorer.set).toBe('julia');
  const beforeJuliaClick = await settled(page), juliaBox = await explorer.boundingBox();
  await explorer.click({ position: { x: juliaBox.width * .45, y: juliaBox.height * .4 } });
  const clickedJulia = await settled(page);
  expect(clickedJulia.parameters.cReal).toBe(beforeJuliaClick.parameters.cReal);
  expect(clickedJulia.parameters.cImag).toBe(beforeJuliaClick.parameters.cImag);
  await explorer.scrollIntoViewIfNeeded();
  const juliaDrag = await explorer.boundingBox();
  await page.mouse.move(juliaDrag.x + juliaDrag.width * .4, juliaDrag.y + juliaDrag.height * .5);
  await page.mouse.down(); await page.mouse.move(juliaDrag.x + juliaDrag.width * .5, juliaDrag.y + juliaDrag.height * .4); await page.mouse.up();
  await expect.poll(async () => {
    const p = (await diagnostics(page)).parameters;
    return p.cReal !== clickedJulia.parameters.cReal && p.cImag !== clickedJulia.parameters.cImag;
  }).toBe(true);
  await choose(page, 'explorerSet', 'mandelbrot'); await page.locator('#explorerReset').click();
  const beforeKeys = await settled(page);
  await explorer.scrollIntoViewIfNeeded(); await explorer.focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
  await expect.poll(async () => {
    const p = (await diagnostics(page)).parameters;
    return p.cReal !== beforeKeys.parameters.cReal && p.cImag !== beforeKeys.parameters.cImag;
  }).toBe(true);
  const afterKeys = await settled(page), box = await explorer.boundingBox();
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .55);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .45, box.y + box.height * .4, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => {
    const p = (await diagnostics(page)).parameters;
    return p.cReal !== afterKeys.parameters.cReal && p.cImag !== afterKeys.parameters.cImag;
  }).toBe(true);
  const last = await settled(page);
  expect(last.witness.geometry.length).toBeGreaterThan(beforeKeys.witness.geometry.length);
  const beforeViewGestures = await captureSettings(page), gestureGraph = await settled(page);
  await explorer.scrollIntoViewIfNeeded();
  const panBox = await explorer.boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(panBox.x + panBox.width * .5, panBox.y + panBox.height * .5);
  await page.mouse.down(); await page.mouse.move(panBox.x + panBox.width * .6, panBox.y + panBox.height * .6); await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await captureSettings(page)).explorer.centerReal).not.toBe(beforeViewGestures.explorer.centerReal);
  await explorer.scrollIntoViewIfNeeded(); await explorer.hover(); await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await captureSettings(page)).explorer.zoom).toBeGreaterThan(beforeViewGestures.explorer.zoom);
  const afterViewGestures = await settled(page);
  expect(afterViewGestures.parameters.cReal).toBe(gestureGraph.parameters.cReal);
  expect(afterViewGestures.parameters.cImag).toBe(gestureGraph.parameters.cImag);
  expect(afterViewGestures.network.revision).toBe(gestureGraph.network.revision);
  await explorer.scrollIntoViewIfNeeded(); await explorer.focus(); await page.keyboard.press('Escape');
  const finalCapture = await captureSettings(page);
  expect(finalCapture.explorer.set).toBe('mandelbrot'); expect(finalCapture.explorer.zoom).toBe(1);
  await expectAudioOff(page); expect(errors).toEqual([]);
  await testInfo.attach('fractal-view.json', { body: JSON.stringify({ located: located.witness.requests.at(-1),
    zoomed: zoomed.witness.requests.at(-1), julia: julia.explorer, final: finalCapture.explorer }, null, 2), contentType: 'application/json' });
});

for (const viewport of SIZES.slice(1)) {
  test(`circular motion Play and Tap remain 48-pixel touch targets at ${viewport.width}×${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });
    try {
      const page = await context.newPage(), errors = await fixture(page); await ready(page);
      for (const axis of ['real', 'imag']) {
        const play = page.locator(`#${axis}MotionPlay`), tap = page.locator(`.mz-tap-tempo[data-tap-control="#${axis}MotionTempo"]`);
        for (const control of [play, tap]) {
          await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
          const bounds = await control.boundingBox();
          expect(bounds.width).toBeGreaterThanOrEqual(48); expect(bounds.height).toBeGreaterThanOrEqual(48);
        }
        const circular = await play.evaluate(button => {
          const style = getComputedStyle(button), bounds = button.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height, radius: style.borderRadius };
        });
        expect(Math.abs(circular.width - circular.height)).toBeLessThanOrEqual(1);
        expect(circular.radius).toMatch(/50%|999|24px/);
        await tapHasNoOverlaps(page, axis);
        await play.click(); await expect(play).toHaveAttribute('aria-pressed', 'true');
        await expectAudioOff(page);
        await play.click(); await expect(play).toHaveAttribute('aria-pressed', 'false');
      }
      expect(errors).toEqual([]);
      await page.locator('#realMotionPlay').evaluate(node => node.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: testInfo.outputPath(`explorer-touch-${viewport.width}.png`), fullPage: true });
    } finally { await context.close(); }
  });
}

test('explorer, typed coefficients and latched motion preserve real sample PCM and its one continuous source', async ({ page }, testInfo) => {
  test.setTimeout(150000); const errors = await fixture(page, { pcm: true }); await ready(page);
  await choose(page, 'mode', 'orbits');
  await choose(page, 'sourceMode', 'samples'); await choose(page, 'sampleSelect', 'music-keys');
  await page.evaluate(async module => {
    const engine = (await import(module)).getFractalDelayEngine();
    await engine.setParameters({ detail: 8, timeMs: 35, realMotionDepth: .012, imagMotionDepth: .009 });
    await engine.setPerformance({ wet: .7, dry: .15 });
  }, ENGINE);
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.input.playing && !d.compiling && d.status.revision === d.network.revision;
  }, { timeout: 30000 }).toBe(true);
  const before = await diagnostics(page);
  await page.evaluate(async () => {
    const qa = __fractalExplorerWitness; await qa.probeReady;
    await new Promise(resolve => { qa.resetAck = resolve; qa.probe.port.postMessage('reset'); });
    qa.packets.length = 0; qa.recording = true;
  });
  await page.locator('#motionTempoLatch').click(); await range(page, 'realMotionTempo', 24);
  await page.locator('#realMotionPlay').click(); await page.locator('#imagMotionPlay').click();
  await zoomIn(page); await choose(page, 'explorerSet', 'julia');
  await page.locator('#cRealNumber').fill('-.122'); await page.locator('#cRealNumber').press('Enter'); await page.locator('#cRealNumber').blur();
  await page.evaluate(() => { const until = performance.now() + 450; while (performance.now() < until) {} });
  await choose(page, 'explorerSet', 'mandelbrot'); await page.locator('#explorerPresetNext').click();
  await page.locator('#realMotionPlay').click(); await page.locator('#imagMotionPlay').click();
  const after = await settled(page);
  await expect.poll(() => page.evaluate(() => {
    const packet = __fractalExplorerWitness.packets.at(-1); return packet ? packet.frames / packet.rate : 0;
  }), { timeout: 15000 }).toBeGreaterThanOrEqual(1.2);
  const pcm = await page.evaluate(() => __fractalExplorerWitness.packets.at(-1));
  expect(pcm.frames).toBeGreaterThan(0); expect(pcm.nonFinite).toBe(0); expect(pcm.discontinuities).toBe(0);
  expect(pcm.callbackGaps).toEqual([]); expect(pcm.peak).toBeLessThanOrEqual(1);
  expect(pcm.rms).toBeGreaterThan(.00001); expect(pcm.longestZeroSeconds).toBeLessThan(.04);
  expect(after.contextGeneration).toBe(before.contextGeneration); expect(after.witness.contexts).toBe(before.witness.contexts);
  expect(after.witness.nodes).toBe(before.witness.nodes); expect(after.witness.sources).toEqual(before.witness.sources);
  expect(after.input.playing).toBe(true); expect(after.audioDesired).toBe(true);
  expect(after.witness.statuses.at(-1).sampleClock).toBeGreaterThan(before.witness.statuses.at(-1).sampleClock);
  for (let i = 1; i < after.witness.statuses.length; i++)
    expect(after.witness.statuses[i].sampleClock, 'Rust time never resets while the explorer changes').toBeGreaterThanOrEqual(after.witness.statuses[i - 1].sampleClock);
  expect(after.error).toBeFalsy(); expect(errors).toEqual([]);
  await testInfo.attach('explorer-live-pcm.json', { body: JSON.stringify({ pcm,
    before: { clock: before.sampleClock, sources: before.witness.sources },
    after: { clock: after.sampleClock, sources: after.witness.sources, parameters: after.parameters } }, null, 2), contentType: 'application/json' });
});
