import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const snapshot = page => page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).diagnosticSnapshot());
const ready = page => expect.poll(async () => { const s = await snapshot(page); return s.ready && !s.building && s.trace.ready && !s.contours.navigation.pending; }, { timeout: 35000 }).toBe(true);

test('named Julia coefficients drive all readers while preserving the sound and clock', async ({ page }) => {
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  await page.locator('#layerVoice0').selectOption('shepard');
  await page.locator('#layerDrums1').check();
  await page.locator('#layerDrumVoice1').selectOption('metal');
  await page.locator('#traceRate').evaluate(input => { input.value = '.8'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#playButton').click();
  await page.locator('#contourDomain').selectOption('julia'); await ready(page);
  expect((await snapshot(page)).armed).toBe(false);
  expect((await snapshot(page)).audioTime).toBeNull();
  await expect(page.locator('#contourRegion')).toBeHidden();
  await expect(page.locator('#mapLabel')).toHaveText('Julia parameter c');
  await page.locator('#audioButton').click(); await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  const expected = await page.evaluate(async () => (await import('/src/instruments/vector-fractals/model.js')).EXPLORER_JULIA_PRESETS);
  const initial = await snapshot(page);
  let previousTravel = initial.trace.travel;
  for (const preset of expected) {
    await page.locator('#contourJuliaPreset').selectOption(preset.id); await ready(page);
    const s = await snapshot(page);
    expect(s.state.cReal).toBe(preset.cReal); expect(s.state.cImag).toBe(preset.cImag);
    expect(s.contours.domain).toBe('julia'); expect(s.contours.cReal).toBe(preset.cReal); expect(s.contours.cImag).toBe(preset.cImag);
    expect(s.c).toEqual([preset.cReal, preset.cImag]);
    expect(s.trace.layers.every(layer => layer.samples > 0)).toBe(true);
    expect(s.state.layerVoices).toEqual(initial.state.layerVoices);
    expect(s.state.layerDrums).toEqual(initial.state.layerDrums);
    expect(s.state.layerDrumVoices).toEqual(initial.state.layerDrumVoices);
    expect(s.trace.travel).toBeGreaterThanOrEqual(previousTravel);
    previousTravel = s.trace.travel;
    expect(s.playing && s.armed).toBe(true);
  }
  await page.locator('#contourJuliaPreset').selectOption('rabbit'); await ready(page);
  for (const reader of ['trace', 'radar', 'scan', 'xy']) {
    await page.locator('#contourReader').selectOption(reader); await ready(page);
    await page.waitForTimeout(250);
    // Scan legitimately has rests outside the outline; observe a whole cycle.
    const audio = await sampleAudioEnvelope(page, { durationMs: 1500, intervalMs: 40 });
    expect(audio.summary.finite).toBe(true); expect(audio.summary.maxPeak, reader).toBeGreaterThan(.001);
    expect(audio.summary.clippedSamples).toBe(0);
  }
  await page.locator('#contourReader').selectOption('trace'); await ready(page);
  const home = (await snapshot(page)).state;
  await page.locator('#zoomIn').click(); await ready(page);
  expect((await snapshot(page)).state.viewWidth).toBeLessThan(home.viewWidth);
  await expect(page.locator('#contourJuliaPreset')).toHaveValue('rabbit');
  await page.locator('#wholeView').click(); await ready(page);
  expect((await snapshot(page)).state.viewX).toBe(0);
  expect((await snapshot(page)).state.viewWidth).toBeCloseTo(home.viewWidth, 8);
  await page.locator('#juliaCoefficients > summary').click();
  await page.locator('#cReal').fill('0'); await page.locator('#cImag').fill('0'); await page.locator('#cImag').press('Tab'); await ready(page);
  await expect(page.locator('#contourJuliaPreset')).toHaveValue('circle');
  await page.locator('#cImag').fill('0.123'); await page.locator('#cImag').press('Enter'); await ready(page);
  await expect(page.locator('#contourJuliaPreset')).toHaveValue('custom');
  const downloading = page.waitForEvent('download'); await page.locator('#exportContour').click();
  const svg = await readFile(await (await downloading).path(), 'utf8');
  expect(svg).toContain('<title>Morphazoid Julia contours</title>');
  expect(svg).toContain('"domain":"julia","c":[0,0.123]');
  for (const id of ['broad', 'curl', 'fine']) expect(svg).toContain(`id="${id}"`);
  await page.locator('#contourJuliaPreset').selectOption('rabbit'); await ready(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/vector-julia-desktop.png', fullPage: true });
  await page.locator('#contourDomain').selectOption('mandelbrot'); await ready(page);
  expect((await snapshot(page)).contours.domain).toBe('mandelbrot');
  expect((await snapshot(page)).state.viewX).toBe(-.5);
  await expect(page.locator('#contourRegion')).toHaveValue('whole');
  expect((await snapshot(page)).playing && (await snapshot(page)).armed).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('Julia coefficient touch controls', () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`presets and coefficients remain reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      test.setTimeout(60000); await page.setViewportSize(viewport);
      await page.goto('vector-fractals.html#explorer'); await ready(page);
      await page.locator('#contourDomain').selectOption('julia'); await ready(page);
      await page.locator('#contourJuliaPreset').selectOption('siegel'); await ready(page);
      await page.locator('#juliaCoefficients > summary').click();
      for (const id of ['contourDomain', 'contourJuliaPreset', 'cReal', 'cImag', 'contourQuality']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded(); await expect(page.locator(`#${id}`)).toBeVisible();
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      for (const id of ['playButton', 'audioButton']) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
      }
      await page.locator('#playButton').click(); expect((await snapshot(page)).armed).toBe(false);
      await page.screenshot({ path: `/tmp/vector-julia-${viewport.width}.png`, fullPage: true });
    });
  }
});
