import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const snapshot = page => page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).diagnosticSnapshot());
const ready = page => expect.poll(async () => { const s = await snapshot(page); return s.ready && !s.building && s.trace.ready && !s.contours.navigation.pending; }, { timeout: 35000 }).toBe(true);
const setRange = (page, id, value) => page.locator(`#${id}`).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const delta = (a, b) => (b - a + 1) % 1;

test('layered Trace keeps traversal separate from pitch, voice and geometry edits', async ({ page }) => {
  test.setTimeout(90000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  let s = await snapshot(page);
  expect(s.state.contourReader).toBe('trace'); expect(s.armed).toBe(false);
  expect(s.trace.layers).toHaveLength(3);
  expect(s.trace.layers.every(layer => layer.samples === 2048)).toBe(true);
  expect(new Set(s.trace.layers.map(layer => layer.depth)).size).toBe(3);
  await page.locator('#playButton').click(); await page.waitForTimeout(120);
  expect((await snapshot(page)).tracePhase).toBeGreaterThan(0);
  expect((await snapshot(page)).audioTime).toBeNull();
  await page.locator('#audioButton').click(); await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  await setRange(page, 'traceRate', .2); await page.waitForTimeout(300);
  const before = await snapshot(page);
  await setRange(page, 'pitch', 720); await page.locator('#layerVoice1').selectOption('glass');
  await page.evaluate(() => { const until = performance.now() + 450; while (performance.now() < until) {} });
  await page.waitForTimeout(100);
  const after = await snapshot(page);
  expect(after.contours.request).toBe(before.contours.request);
  expect(delta(before.tracePhase, after.tracePhase)).toBeCloseTo((after.audioTime - before.audioTime) * .2, 1);
  expect(after.trace.rate).toBeCloseTo(.2, 2);
  const output = await sampleAudioEnvelope(page, { durationMs: 220, intervalMs: 50 });
  expect(output.summary.finite).toBe(true); expect(output.summary.maxPeak).toBeGreaterThan(.005); expect(output.summary.clippedSamples).toBe(0);
  await page.locator('#playButton').click(); await page.waitForTimeout(300);
  const paused = await snapshot(page); await page.waitForTimeout(200);
  expect((await snapshot(page)).tracePhase).toBeCloseTo(paused.tracePhase, 5);
  await setRange(page, 'featureSize', .06); await page.locator('#layerVoice2').selectOption('reed');
  expect((await snapshot(page)).contours.request).toBe(paused.contours.request);
  await page.locator('#playButton').click();
  await page.locator('#contourRegion').selectOption('seahorse'); await ready(page);
  s = await snapshot(page); expect(s.playing && s.armed).toBe(true);
  expect(s.trace.layers.some(layer => layer.samples > 0)).toBe(true);
  await page.locator('#contourReader').selectOption('xy'); await page.waitForTimeout(200);
  const xy = await snapshot(page); await page.waitForTimeout(200);
  expect((await snapshot(page)).tracePhase).toBeCloseTo(xy.tracePhase, 5);
  await page.locator('#contourReader').selectOption('trace');
  await page.locator('#reset').click(); await ready(page);
  expect((await snapshot(page)).playing && (await snapshot(page)).armed).toBe(true);
  expect(errors).toEqual([]);
});

test('each detail layer sounds alone, all-muted releases, empty regions silence, and cleanup closes audio', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  await page.locator('#audioButton').click(); await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < 3; i++) await page.locator(`#layerEnabled${i}`).setChecked(i === layer);
    await page.waitForTimeout(300);
    const audio = await sampleAudioEnvelope(page, { durationMs: 180, intervalMs: 50 });
    expect(audio.summary.finite).toBe(true); expect(audio.summary.maxPeak).toBeGreaterThan(.003); expect(audio.summary.clippedSamples).toBe(0);
  }
  await page.locator('#layerEnabled2').uncheck(); await page.waitForTimeout(450);
  expect((await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 50 })).summary.maxPeak).toBeLessThan(.001);
  for (let i = 0; i < 3; i++) await page.locator(`#layerEnabled${i}`).check();
  await page.locator('#contourStage').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
  // The broad outer contour can still cross the edge of this wide crop.
  // Tighten the exterior view so all three levels are outside it.
  await page.locator('#zoomIn').click(); await page.locator('#zoomIn').click();
  await ready(page); await page.waitForTimeout(450);
  expect((await snapshot(page)).trace.layers.every(layer => layer.samples === 0)).toBe(true);
  expect((await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 50 })).summary.maxPeak).toBeLessThan(.001);
  expect((await snapshot(page)).armed && (await snapshot(page)).playing).toBe(true);
  await page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).dispose());
  expect((await snapshot(page)).audioTime).toBeNull();
});

test('Trace SVG contains three colored contour levels and open crop fragments', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  await page.locator('#contourRegion').selectOption('seahorse'); await ready(page);
  const downloading = page.waitForEvent('download'); await page.locator('#exportContour').click();
  const svg = await readFile(await (await downloading).path(), 'utf8');
  for (const id of ['broad', 'curl', 'fine']) expect(svg).toContain(`id="${id}"`);
  expect(svg).not.toMatch(/NaN|Infinity/);
  expect([...svg.matchAll(/<path d="([^"]+)"/g)].some(match => !match[1].endsWith(' Z'))).toBe(true);
});
