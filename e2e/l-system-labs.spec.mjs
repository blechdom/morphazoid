import { test, expect } from '@playwright/test';

const variants = [
  { route: 'l-system-parametric-lab.html', id: 'l-system-parametric-lab', kinds: ['parametric'] },
  { route: 'l-system-experiments.html', id: 'l-system-experiments', kinds: ['context', 'thue-morse', 'fibonacci', 'penrose', 'sphinx'] },
];
const layouts = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }];

function wav() {
  const rate = 48000, frames = rate, buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * 173) * 3200), 44 + i * 2);
  return buffer;
}

async function fixture(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/assets/synthesis/loops/electric-piano.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav() }));
  await page.addInitScript(() => {
    window.__labRuntime = { contexts: [], worklets: [], sources: [], peaks: [] };
    const NativeContext = AudioContext, NativeNode = AudioWorkletNode;
    window.AudioContext = class extends NativeContext { constructor(...args) { super(...args); __labRuntime.contexts.push(this); } };
    window.AudioWorkletNode = class extends NativeNode {
      constructor(...args) {
        super(...args);
        const analyser = this.context.createAnalyser(), mute = this.context.createGain();
        analyser.fftSize = 1024; mute.gain.value = 0; this.connect(analyser).connect(mute).connect(this.context.destination);
        __labRuntime.worklets.push({ node: this, analyser, buffer: new Float32Array(1024) });
      }
    };
    const create = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const source = create.apply(this, args), record = { starts: 0, stops: 0 };
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...args) => { record.starts++; return start(...args); };
      source.stop = (...args) => { record.stops++; return stop(...args); };
      __labRuntime.sources.push(record); return source;
    };
  });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `\nwindow.__labQa = {
      engine: browserEngine, applyScene, presetBank: () => structuredClone(presets),
      view: () => ({ ui: structuredClone(state.parameters), installed: structuredClone(previewParameters),
        nodes: geometry?.nodes.map(({ id, parentId, x, y, delay, rate, priority, generation }) => ({ id, parentId, x, y, delay, rate, priority, generation })) ?? [] }),
    };\n` });
  });
  return errors;
}

async function set(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function diagnostics(page) { return page.evaluate(() => __labQa.engine.getDiagnostics()); }
async function settled(page, kind) {
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.parameters.lab?.kind === kind && !d.compilePending && !d.installPending;
  }, { timeout: 30000 }).toBe(true);
  await page.waitForFunction(kind => __labQa.view().installed.lab?.kind === kind && __labQa.view().nodes.length > 1, kind);
}
async function peak(page) {
  return page.evaluate(() => {
    const monitor = __labRuntime.worklets.at(-1); monitor.analyser.getFloatTimeDomainData(monitor.buffer);
    return { peak: Math.max(...monitor.buffer.map(Math.abs)), finite: monitor.buffer.every(Number.isFinite) };
  });
}

for (const variant of variants) {
  test(`${variant.id} has reachable controls on desktop and both phone layouts`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = await fixture(page);
    await page.goto(`/${variant.route}`);
    await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
    await settled(page, variant.kinds[0]);
    await expect(page.locator('[data-active-tool-id]')).toHaveAttribute('data-active-tool-id', variant.id);
    expect((await diagnostics(page)).audio).toBe(false);
    for (const viewport of layouts) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const id of ['source', 'generations', 'interval', 'generationAngle', 'curls', 'depth', 'wet', 'inputTrim', variant.kinds[0] === 'parametric' ? 'labDelayRatio' : 'labSymbolRatio']) {
        const control = page.locator(`#${id}`);
        await control.evaluate(input => { for (let p = input.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
        // Native selects retain their events beneath the compact Choose UI.
        const target = await control.evaluateHandle(input => input.closest('[data-select-id]') || input.closest('label') || input);
        await target.asElement().scrollIntoViewIfNeeded();
        expect(await target.asElement().isVisible(), id).toBe(true);
      }
      await page.screenshot({ path: test.info().outputPath(`${variant.id}-${viewport.width}.png`) });
    }
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    expect((await diagnostics(page)).disposed).toBe(true); expect(errors).toEqual([]);
  });

  test(`${variant.id} changes rules and presets through the same live Rust audio session`, async ({ page }) => {
    test.setTimeout(150000);
    const errors = await fixture(page);
    await page.goto(`/${variant.route}?renderer=webgl2`);
    await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
    await settled(page, variant.kinds[0]);
    await set(page, 'source', 'samples');
    await expect.poll(async () => (await diagnostics(page)).input.mode).toBe('samples');
    await set(page, 'inputSample', 'music-keys');
    await page.locator('#audioButton').click();
    await expect.poll(async () => (await diagnostics(page)).audio).toBe(true);
    await expect.poll(async () => (await peak(page)).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
    await set(page, 'inputTrim', .7); await set(page, 'level', .6);
    const before = await page.evaluate(() => ({ time: __labQa.engine.getSampleTime(), worklets: __labRuntime.worklets.length,
      sources: __labRuntime.sources.filter(s => s.starts).length }));
    for (const kind of variant.kinds) {
      if (variant.kinds.length > 1) await set(page, 'labKind', kind);
      await settled(page, kind);
      const view = await page.evaluate(() => __labQa.view());
      expect(view.nodes.every(n => [n.x, n.y, n.delay, n.rate].every(Number.isFinite))).toBe(true);
      expect(view.nodes.some(n => n.generation > 0 && n.priority >= 0)).toBe(true);
      await expect.poll(async () => (await peak(page)).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
      expect((await peak(page)).finite).toBe(true);
    }
    const viewBefore = await page.evaluate(() => __labQa.view());
    const sensitivity = variant.kinds[0] === 'parametric' ? ['labDelayRatio', 'delayRatio', .45] : ['labSymbolRatio', 'symbolRatio', 2.4];
    await set(page, sensitivity[0], sensitivity[2]);
    await expect.poll(async () => (await diagnostics(page)).parameters.lab[sensitivity[1]]).toBe(sensitivity[2]);
    await expect.poll(() => page.evaluate(key => __labQa.view().installed.lab[key], sensitivity[1])).toBe(sensitivity[2]);
    const viewAfter = await page.evaluate(() => __labQa.view());
    expect(viewAfter.nodes.map(n => [n.delay, n.rate])).not.toEqual(viewBefore.nodes.map(n => [n.delay, n.rate]));
    // Complete factory recall should restore lab rules while retaining live gains.
    const preset = await page.evaluate(() => __labQa.presetBank()[0]);
    await page.evaluate(preset => __labQa.applyScene(preset.snapshot, preset.id), preset);
    await settled(page, variant.kinds[0]);
    const final = await diagnostics(page);
    expect(final.parameters.lab).toEqual(preset.snapshot.parameters.lab);
    expect(final.performance.inputGain).toBe(.7); expect(final.performance.level).toBe(.6);
    expect(final.audio).toBe(true); expect(final.status.elapsedSeconds).toBeGreaterThan(0);
    const after = await page.evaluate(() => ({ time: __labQa.engine.getSampleTime(), worklets: __labRuntime.worklets.length,
      sources: __labRuntime.sources.filter(s => s.starts).length }));
    expect(after.time).toBeGreaterThan(before.time); expect(after.worklets).toBe(before.worklets); expect(after.sources).toBe(before.sources);
    await page.locator('#audioButton').click();
    await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    expect((await diagnostics(page)).disposed).toBe(true); expect(errors).toEqual([]);
  });
}
