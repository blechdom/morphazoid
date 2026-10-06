import { test, expect } from '@playwright/test';

const ENGINE = '/src/instruments/micmic/native/browser-engine.js';
const presetTrigger = '.instrument-preset-controls .header-preset-picker > summary';
const chooser = id => `[data-select-id="${id}"]`;

async function fixture(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const qa = window.__mobileMenusQa = { worklets: 0, sources: [], microphoneRequests: 0 };
    const NativeNode = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeNode, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-l-system-delay') qa.worklets++;
      return node;
    } });
    const createSource = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const node = createSource.apply(this, args), record = { started: 0, stopped: 0 };
      const start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...values) => { record.started++; return start(...values); };
      node.stop = (...values) => { record.stopped++; return stop(...values); };
      qa.sources.push(record);
      return node;
    };
    navigator.mediaDevices.getUserMedia = async () => {
      qa.microphoneRequests++;
      throw new DOMException('Sample menus must not request a microphone.', 'NotAllowedError');
    };
  });
  await page.goto('/l-mic-rust.html?renderer=canvas');
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
  await expect.poll(async () => (await diagnostics(page)).initialized).toBe(true);
  return errors;
}

async function diagnostics(page) {
  return page.evaluate(async path => ({
    ...(await import(path)).getBrowserDelayEngine().getDiagnostics(),
    ...__mobileMenusQa,
  }), ENGINE);
}

async function choose(page, id, value) {
  const index = await page.locator(`#${id}`).evaluate((select, value) =>
    [...select.options].findIndex(option => option.value === value), value);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.locator(`${chooser(id)} > summary`).click();
  await page.locator(`${chooser(id)} button[data-option-index="${index}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveValue(value);
  await expect.poll(async () => (await diagnostics(page)).input[id === 'source' ? 'mode' : 'sampleId']).toBe(value);
  await expect(page.locator(chooser(id))).not.toHaveAttribute('open');
}

async function overlapStickyPreset(page, id) {
  return page.evaluate(({ selector, presetTrigger }) => {
    const panel = document.querySelector('.panel');
    const preset = document.querySelector(presetTrigger);
    const trigger = document.querySelector(`${selector} > summary`);
    const before = preset.getBoundingClientRect(), input = trigger.getBoundingClientRect();
    panel.scrollTop += input.y + input.height / 2 - before.y - before.height / 2;
    const after = preset.getBoundingClientRect(), overlap = trigger.getBoundingClientRect();
    const x = after.x + after.width / 2, y = after.y + after.height / 2;
    return { scroll: panel.scrollTop, presetY: after.y, previousPresetY: before.y,
      overlapsCenter: overlap.left <= x && overlap.right >= x && overlap.top <= y && overlap.bottom >= y,
      hitIsPreset: !!document.elementFromPoint(x, y)?.closest('.instrument-preset-controls'),
      sourceTargetHeight: overlap.height, presetTargetHeight: after.height,
      documentScroll: window.scrollY };
  }, { selector: chooser(id), presetTrigger });
}

async function popupBounds(page, id) {
  return page.locator(`#${id}-choices`).evaluate(panel => {
    const r = panel.getBoundingClientRect();
    return { topLayer: panel.matches(':popover-open'), x: r.x, y: r.y, right: r.right, bottom: r.bottom,
      width: innerWidth, height: innerHeight };
  });
}

async function live(page, previousBlocks = -1) {
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.audio && d.contextState === 'running' && d.input.playing && !d.input.pending
      && d.processedBlocks > previousBlocks && d.status.inputPeak > 1e-5;
  }, { timeout: 20000 }).toBe(true);
  const d = await diagnostics(page);
  expect(Number.isFinite(d.status.outputPeak)).toBe(true);
  expect(d.status.outputPeak).toBeLessThanOrEqual(1);
  expect(d.microphoneRequests).toBe(0);
  expect(d.error).toBeFalsy();
  return d;
}

for (const [name, viewport] of [
  ['portrait', { width: 390, height: 844 }],
  ['landscape', { width: 844, height: 390 }],
]) test.describe(`Rust delay mobile menus: ${name}`, () => {
  test.use({ viewport, isMobile: true, hasTouch: true });
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  });

  test('closed source and sample controls cannot cover the sticky preset', async ({ page }, testInfo) => {
    const errors = await fixture(page);
    await choose(page, 'source', 'samples');
    await choose(page, 'inputSample', 'music-bass');
    const measurements = [];
    const stickyY = await page.locator(presetTrigger).evaluate(trigger => trigger.getBoundingClientRect().y);
    await page.locator('.panel').hover();
    await page.mouse.wheel(0, 96);
    await expect.poll(() => page.locator('.panel').evaluate(panel => panel.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator(presetTrigger).evaluate(trigger => trigger.getBoundingClientRect().y)).toBeCloseTo(stickyY, 1);
    for (const id of ['source', 'inputSample']) {
      const result = await overlapStickyPreset(page, id);
      measurements.push({ id, ...result });
      expect(result.scroll).toBeGreaterThan(0);
      expect(result.overlapsCenter).toBe(true);
      expect(result.presetY).toBeCloseTo(result.previousPresetY, 1);
      expect(result.sourceTargetHeight).toBeGreaterThanOrEqual(48);
      expect(result.presetTargetHeight).toBeGreaterThanOrEqual(48);
      expect(result.hitIsPreset).toBe(true);
      await page.locator(presetTrigger).click();
      await expect(page.locator('#header-preset-panel')).toBeVisible();
      await page.locator(presetTrigger).press('Escape');
      await expect(page.locator('.header-preset-picker')).not.toHaveAttribute('open');
      // A document scroll attempt must not dislodge the nested sticky rail.
      await page.evaluate(() => window.scrollTo(0, 200));
      expect(await page.evaluate(() => window.scrollY)).toBe(result.documentScroll);
    }
    await page.locator(presetTrigger).click();
    await page.locator('#header-preset-panel button[data-preset-id="bramble"]').click();
    await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', 'bramble');
    await expect.poll(async () => (await diagnostics(page)).parameters.intervalMs).toBe(4);
    const d = await diagnostics(page);
    expect(d.input.mode).toBe('samples'); expect(d.input.sampleId).toBe('music-bass'); expect(d.audio).toBe(false);
    expect(errors).toEqual([]);
    await testInfo.attach('closed-chooser-sticky-hit-tests', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
    await testInfo.attach('closed-chooser-mobile-layout', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('open menus scroll, select and dismiss while the sample loop continues', async ({ page }, testInfo) => {
    test.setTimeout(60000);
    const errors = await fixture(page);
    // Keep this menu/audio lifecycle regression independent of dense-tree DSP load.
    await page.locator('#generations').evaluate(input => {
      input.value = '2'; input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(async () => (await diagnostics(page)).parameters.generations).toBe(2);
    await choose(page, 'source', 'samples');
    await choose(page, 'inputSample', 'music-bass');
    await page.locator('#audioButton').click();
    const before = await live(page);
    expect(before.worklets).toBe(1);
    expect(before.connectionCount).toBe(1);
    expect(before.input.loop).toBe(true);
    expect(before.sources.filter(source => source.started && !source.stopped)).toHaveLength(1);
    const menu = page.locator(chooser('inputSample')), summary = menu.locator('summary');
    await summary.click();
    await expect(menu).toHaveAttribute('open', '');
    const bounds = await popupBounds(page, 'inputSample');
    expect(bounds.topLayer).toBe(true);
    expect(bounds.x).toBeGreaterThanOrEqual(7); expect(bounds.y).toBeGreaterThanOrEqual(7);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width - 7);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height - 7);
    const list = menu.locator('.instrument-picker-list');
    const outerScroll = await page.locator('.panel').evaluate(panel => panel.scrollTop);
    await list.hover(); await page.mouse.wheel(0, 800);
    await expect.poll(() => list.evaluate(list => list.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('.panel').evaluate(panel => panel.scrollTop)).toBe(outerScroll);
    // Escape and outside taps close the real top-layer panel without changing audio.
    await summary.press('Escape');
    await expect(menu).not.toHaveAttribute('open');
    await summary.click();
    const outside = await page.evaluate(() => {
      const panel = document.querySelector('#inputSample-choices');
      // Tap inert header space, avoiding both navigation and audio/gesture controls.
      for (let y = 1; y < 60; y += 8) for (let x = 1; x < innerWidth; x += 8) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !panel.contains(hit) && !hit.closest('a,button,input,select,summary,label,details,#stage')) return { x, y };
      }
      return null;
    });
    expect(outside).not.toBeNull();
    await page.touchscreen.tap(outside.x, outside.y);
    await expect(menu).not.toHaveAttribute('open');
    await page.locator('.panel').evaluate(panel => panel.scrollTop = 0);
    await page.locator(`${chooser('source')} > summary`).click();
    await expect(page.locator(chooser('source'))).toHaveAttribute('open', '');
    await page.locator(`${chooser('source')} > summary`).press('Escape');
    await expect(page.locator(chooser('source'))).not.toHaveAttribute('open');
    const after = await live(page, before.processedBlocks);
    expect(after.contextGeneration).toBe(before.contextGeneration);
    expect(after.worklets).toBe(before.worklets);
    expect(after.sources).toEqual(before.sources);
    expect(after.input.sampleId).toBe('music-bass');
    // Filtering and clicking an actual option still changes the existing source.
    await summary.click();
    await menu.locator('input[type="search"]').fill('Sad trombone');
    await menu.locator('button.instrument-picker-link:visible').click();
    await expect(page.locator('#inputSample')).toHaveValue('fx-sad-trombone');
    await expect(menu).not.toHaveAttribute('open');
    const selected = await live(page, after.processedBlocks);
    expect(selected.input.sampleId).toBe('fx-sad-trombone');
    expect(selected.contextGeneration).toBe(before.contextGeneration);
    expect(selected.worklets).toBe(before.worklets);
    expect(selected.sources.filter(source => source.started && !source.stopped)).toHaveLength(1);
    await page.locator('.panel').evaluate(panel => panel.scrollTop = 0);
    await summary.click();
    await menu.locator('input[type="search"]').fill('not a sample');
    await menu.locator('input[type="search"]').press('Escape');
    await expect(menu.locator('input[type="search"]')).toHaveValue('');
    await expect(menu).toHaveAttribute('open', '');
    await menu.locator('input[type="search"]').press('Escape');
    await expect(menu).not.toHaveAttribute('open');
    expect(errors).toEqual([]);
    await testInfo.attach('mobile-menu-audio-continuity', { body: JSON.stringify({ bounds, before, after, selected }, null, 2), contentType: 'application/json' });
    await testInfo.attach('sample-menu-mobile-layout', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
