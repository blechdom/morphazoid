import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const snapshot = page => page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).diagnosticSnapshot());
const ready = page => expect.poll(async () => { const s = await snapshot(page); return s.ready && !s.building && s.trace.ready; }, { timeout: 40000 }).toBe(true);
const range = (page, id, value) => page.locator(`#${id}`).evaluate((node, value) => {
  node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const count = s => s.trace.drumTriggerCounts.reduce((sum, value) => sum + value, 0);

test('reader options retain independent tone/drum choices and preserve silent transport', async ({ page }) => {
  test.setTimeout(100000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  await page.locator('#playButton').click();
  await page.locator('#layerSustain0').uncheck(); await page.locator('#layerDrums0').check();
  await page.locator('#layerDrumVoice0').selectOption('metal');
  const request = (await snapshot(page)).contours.request;
  for (const reader of ['radar', 'scan', 'trace']) {
    await page.locator('#contourReader').selectOption(reader); await ready(page);
    const s = await snapshot(page);
    expect(s.trace.reader).toBe(reader); expect(s.armed).toBe(false); expect(s.audioTime).toBeNull();
    expect(s.playing).toBe(true); expect(s.state.layerSustain[0]).toBe(false);
    expect(s.state.layerDrums[0]).toBe(true); expect(s.state.layerDrumVoices[0]).toBe('metal');
    expect(s.contours.request).toBe(request);
    expect(s.contours.renderer.visibleBeads).toBeGreaterThan(0);
    expect(s.contours.renderer.readerGuide?.type ?? null).toBe(reader === 'trace' ? null : reader);
  }
  const before = (await snapshot(page)).trace.layers.reduce((n, layer) => n + layer.beads, 0);
  await range(page, 'drumSpacing', .012); await ready(page);
  expect((await snapshot(page)).trace.layers.reduce((n, layer) => n + layer.beads, 0)).toBeGreaterThan(before);
  await page.locator('#contourReader').selectOption('scan');
  for (const value of [-90, 40, 125, -15]) await range(page, 'scanAngle', value);
  await ready(page);
  expect((await snapshot(page)).state.scanAngle).toBe(-15);
  expect((await snapshot(page)).contours.renderer.readerGuide.nx).toBeCloseTo(Math.cos(-15 * Math.PI / 180), 4);
  await page.locator('#layerDrums0').uncheck();
  await expect.poll(async () => (await snapshot(page)).contours.renderer.visibleBeads).toBe(0);
  expect(errors).toEqual([]);
});

test('drum crossings and Shepard tones keep the audio clock through edits and release on mute', async ({ page }) => {
  test.setTimeout(100000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  for (let i = 0; i < 3; i++) {
    await page.locator(`#layerSustain${i}`).uncheck(); await page.locator(`#layerDrums${i}`).check();
  }
  await range(page, 'traceRate', .7); await range(page, 'drumSpacing', .025); await ready(page);
  await page.locator('#audioButton').click(); await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  for (const reader of ['trace', 'radar', 'scan']) {
    await page.locator('#contourReader').selectOption(reader); await ready(page);
    const before = await snapshot(page);
    await expect.poll(async () => count(await snapshot(page)), { timeout: 6000 }).toBeGreaterThan(count(before));
    await expect.poll(async () => (await snapshot(page)).contours.renderer.beadFlashes.length, { timeout: 6000 }).toBeGreaterThan(0);
    const audio = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 40 });
    expect(audio.summary.finite).toBe(true); expect(audio.summary.maxPeak).toBeGreaterThan(.001);
    expect(audio.summary.clippedSamples).toBe(0);
  }
  const beforeStall = await snapshot(page);
  await page.evaluate(() => { const end = performance.now() + 400; while (performance.now() < end) {} });
  await page.waitForTimeout(100);
  const afterStall = await snapshot(page);
  expect(count(afterStall)).toBeGreaterThan(count(beforeStall));
  expect(afterStall.trace.travel - beforeStall.trace.travel).toBeCloseTo((afterStall.audioTime - beforeStall.audioTime) * .7, 1);
  await page.locator('#contourReader').selectOption('trace'); await ready(page);
  for (let i = 0; i < 3; i++) await page.locator(`#layerDrums${i}`).uncheck();
  await page.locator('#layerSustain0').check(); await page.locator('#layerVoice0').selectOption('shepard');
  await range(page, 'pitchDepth', 0); await range(page, 'panWidth', 0);
  await page.locator('#shepardOptions').evaluate(node => { node.open = true; });
  await page.locator('#shepardDirection').selectOption('fall'); await range(page, 'shepardWidth', 1.8);
  await page.waitForTimeout(350);
  const tone = await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 40 });
  expect(tone.summary.finite).toBe(true); expect(tone.summary.maxPeak).toBeGreaterThan(.003);
  expect(tone.summary.clippedSamples).toBe(0);
  const a = await snapshot(page); await page.waitForTimeout(200); const b = await snapshot(page);
  expect(b.trace.shepardTravel).toBeLessThan(a.trace.shepardTravel);
  expect(b.armed && b.playing).toBe(true);
  await page.locator('#layerSustain0').uncheck(); await page.waitForTimeout(650);
  expect((await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 50 })).summary.maxPeak).toBeLessThan(.001);
  await page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).dispose());
  expect((await snapshot(page)).audioTime).toBeNull(); expect(errors).toEqual([]);
});

test.describe('touch controls', () => {
test.use({ hasTouch: true, isMobile: true });
for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`contour options remain reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    test.setTimeout(80000); await page.setViewportSize(viewport);
    await page.goto('vector-fractals.html#explorer'); await ready(page);
    await page.locator('#contourReader').selectOption('radar'); await ready(page);
    for (const id of ['readerOptions', 'mappingOptions', 'drumOptions', 'shepardOptions']) await page.locator(`#${id} > summary`).click();
    for (const id of ['layerSustain2', 'layerDrums2', 'radarX', 'bendTimbre', 'drumDecay', 'shepardWidth']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded(); await expect(page.locator(`#${id}`)).toBeVisible();
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    for (const id of ['audioButton', 'playButton']) {
      const target = await page.locator(`#${id}`).boundingBox();
      expect(target.width).toBeGreaterThanOrEqual(48); expect(target.height).toBeGreaterThanOrEqual(48);
    }
    await page.locator('#layerDrums2').check(); await page.locator('#playButton').click();
    expect((await snapshot(page)).playing).toBe(true); expect((await snapshot(page)).armed).toBe(false);
  });
}
});
