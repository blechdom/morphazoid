import { test, expect } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const snapshot = page => page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).diagnosticSnapshot());
const setRange = (page, id, value) => page.locator(`#${id}`).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const ready = page => expect.poll(async () => { const s = await snapshot(page); return s.ready && !s.building; }).toBe(true);

test('three demos share silent transport, direct geometry controls and recoverable presets', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.url().startsWith('http://127.0.0.1')) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('vector-fractals.html'); await ready(page);
  expect((await snapshot(page)).renderer).toBe('webgl');
  expect((await readAudioStatus(page)).active).toBe(false);
  await page.locator('#playButton').click();
  for (const mode of ['mandelbrot', 'voyager', 'julia']) {
    await page.locator(`#demoModes [data-mode="${mode}"]`).click(); await ready(page);
    const current = await snapshot(page); expect(current.state.mode).toBe(mode); expect(current.playing).toBe(true); expect(current.armed).toBe(false); expect(current.audioTime).toBeNull();
    await page.locator('#stage').focus(); await page.keyboard.press('ArrowRight');
    expect((await snapshot(page)).state.rotation).toBe(current.state.rotation + 5);
  }
  await page.locator('.header-preset-next').click(); await ready(page);
  await page.locator('.header-preset-random').click(); await ready(page);
  expect((await snapshot(page)).playing).toBe(true); expect((await snapshot(page)).armed).toBe(false);
  await page.locator('#reset').click(); await ready(page);
  await page.locator('#info').click(); await expect(page.locator('#helpDialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#helpDialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('real XY audio, presets, high pitch, UI stalls, release, off/on and cleanup', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('vector-fractals.html'); await ready(page);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  const paused = await sampleAudioEnvelope(page, { durationMs: 220, intervalMs: 50 }); expect(paused.summary.maxPeak).toBeLessThan(.001);
  await page.locator('#playButton').click();
  const measurements = {};
  for (const mode of ['julia', 'mandelbrot', 'voyager']) {
    await page.locator(`#demoModes [data-mode="${mode}"]`).click(); await ready(page);
    await page.waitForTimeout(200);
    const { summary } = await sampleAudioEnvelope(page, { durationMs: 420, intervalMs: 50 });
    measurements[mode] = summary; expect(summary.finite).toBe(true); expect(summary.maxPeak).toBeGreaterThan(.01); expect(summary.maxPeak).toBeLessThan(.8); expect(summary.clippedSamples).toBe(0);
  }
  const before = await snapshot(page);
  await page.evaluate(() => { const end = performance.now() + 400; while (performance.now() < end) {} });
  await page.waitForTimeout(100); const after = await snapshot(page);
  expect(after.audioTime - before.audioTime).toBeGreaterThan(.35); expect(after.voyage).not.toBe(before.voyage);
  await setRange(page, 'pitch', 1200); await page.waitForTimeout(350);
  expect((await sampleAudioEnvelope(page, { durationMs: 220, intervalMs: 50 })).summary.maxPeak).toBeGreaterThan(.01);
  await page.locator('.header-preset-next').click(); await ready(page);
  expect((await snapshot(page)).armed && (await snapshot(page)).playing).toBe(true);
  await setRange(page, 'level', 0); await page.waitForTimeout(550);
  expect((await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 50 })).summary.maxPeak).toBeLessThan(.001);
  await setRange(page, 'level', .35); await page.locator('#playButton').click(); await page.waitForTimeout(550);
  expect((await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 50 })).summary.maxPeak).toBeLessThan(.001);
  await page.locator('#audioButton').click(); await page.waitForTimeout(100); expect((await snapshot(page)).audioTime).toBeNull();
  await page.locator('#audioButton').click(); await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  expect((await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 50 })).summary.maxPeak).toBeGreaterThan(.01);
  await page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).dispose());
  expect((await snapshot(page)).disposed).toBe(true); expect((await snapshot(page)).audioTime).toBeNull();
  await testInfo.attach('xy-audio.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`reachable controls and graph at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await page.goto('vector-fractals.html#voyager'); await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    await expect(page.locator('#demoModes [data-mode="voyager"]')).toHaveAttribute('aria-pressed', 'true');
    const stage = await page.locator('#stage').boundingBox(); expect(stage.width).toBeGreaterThan(250); expect(stage.height).toBeGreaterThan(200);
    const play = await page.locator('#playButton').boundingBox(); expect(play.width).toBeGreaterThanOrEqual(48); expect(play.height).toBeGreaterThanOrEqual(48);
    await page.screenshot({ path: testInfo.outputPath('layout.png'), fullPage: true });
    // Actual document scrolling, not programmatic selectOption on clipped fields.
    await page.mouse.move(20, viewport.height - 30); await page.mouse.wheel(0, 1100); await page.waitForTimeout(100);
    if (viewport.width < 850) expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.locator('#info').click(); await expect(page.locator('#helpDialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#readout').selectOption('mono'); expect((await snapshot(page)).state.readout).toBe('mono');
    await page.locator('#component').selectOption('2'); await ready(page); expect((await snapshot(page)).state.component).toBe(2);
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const box = await page.locator('#stage').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20); await page.mouse.up(); await ready(page);
    expect((await snapshot(page)).state.rotation).toBeGreaterThan(0);
    expect((await snapshot(page)).armed).toBe(false);
  });
}
