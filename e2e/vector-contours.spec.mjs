import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const snapshot = page => page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).diagnosticSnapshot());
const ready = page => expect.poll(async () => {
  const s = await snapshot(page);
  return s.ready && !s.building && !s.contours.navigation.pending && s.contours.phase === 'complete';
}, { timeout: 25000 }).toBe(true);
const setRange = (page, id, value) => page.locator(`#${id}`).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

test('zoom recomputes detail, follows the pointer, and retains the latest view', async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1')) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  const whole = await snapshot(page);
  expect(whole.armed).toBe(false); expect(whole.contours.vertices).toBeGreaterThan(100);
  await page.locator('#playButton').click();
  await page.locator('#contourRegion').selectOption('seahorse'); await ready(page);
  const seahorse = await snapshot(page);
  expect(seahorse.contours.view.width).toBe(.015);
  expect(seahorse.contours.depth).toBeGreaterThan(whole.contours.depth + 80);
  expect(seahorse.contours.vertices).not.toBe(whole.contours.vertices);
  await page.locator('#contourRegion').selectOption('filigree'); await ready(page);
  const fine = await snapshot(page); expect(fine.contours.depth).toBeGreaterThan(seahorse.contours.depth + 50);
  const box = await page.locator('#contourStage').boundingBox();
  // Chromium reports wheel coordinates in integer CSS pixels.
  const pointer = { x: Math.round(box.x + box.width * .67), y: Math.round(box.y + box.height * .43) };
  const anchor = { x: (pointer.x - box.x) / box.width, y: (pointer.y - box.y) / box.height };
  const world = view => ({ x: view.x + (anchor.x - .5) * view.width, y: view.y + (.5 - anchor.y) * view.width / view.aspect });
  const before = world(fine.contours.view);
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.wheel(0, -180); await ready(page);
  const zoomed = await snapshot(page), after = world(zoomed.contours.view);
  expect(zoomed.state.viewWidth).toBeLessThan(fine.state.viewWidth);
  expect(Math.abs(before.x - after.x)).toBeLessThan(1e-12); expect(Math.abs(before.y - after.y)).toBeLessThan(1e-12);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * anchor.x + 35, box.y + box.height * anchor.y + 20, { steps: 3 }); await page.mouse.up();
  await page.locator('#contourStage').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press(i % 2 ? 'ArrowLeft' : '+');
  await ready(page);
  const latest = await snapshot(page);
  expect(latest.contours.view.x).toBe(latest.state.viewX); expect(latest.contours.view.y).toBe(latest.state.viewY);
  expect(latest.contours.view.width).toBe(latest.state.viewWidth);
  expect(latest.playing).toBe(true); expect(latest.armed).toBe(false);
  await page.keyboard.press('Home'); await ready(page); expect((await snapshot(page)).state.viewWidth).toBe(whole.state.viewWidth);
  expect(errors).toEqual([]);
});

test('selected strands produce bounded audio through refinement and empty regions become silent', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  await page.locator('#audioButton').click(); await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  const sounding = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 50 });
  expect(sounding.summary.finite).toBe(true); expect(sounding.summary.maxPeak).toBeGreaterThan(.01); expect(sounding.summary.clippedSamples).toBe(0);
  await page.locator('#contourRegion').selectOption('seahorse'); await ready(page);
  const selected = (await snapshot(page)).contours.selectedPath;
  await page.locator('#nextStrand').click(); await ready(page); expect((await snapshot(page)).contours.selectedPath).not.toBe(selected);
  const before = await snapshot(page);
  await setRange(page, 'pitch', 400); await page.locator('#readout').selectOption('mono');
  expect((await snapshot(page)).contours.request).toBe(before.contours.request);
  await setRange(page, 'contourBias', 14); await ready(page);
  await page.locator('#contourQuality').selectOption('fine'); await ready(page);
  expect((await snapshot(page)).contours.stats.grid.columns).toBeGreaterThan(before.contours.stats.grid.columns);
  await page.evaluate(() => { const until = performance.now() + 350; while (performance.now() < until) {} });
  const ongoing = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 50 });
  expect(ongoing.summary.finite).toBe(true); expect(ongoing.summary.maxPeak).toBeGreaterThan(.005); expect(ongoing.summary.maxPeak).toBeLessThan(.8);
  expect((await snapshot(page)).audioTime - before.audioTime).toBeGreaterThan(.35);
  await page.locator('#wholeView').click(); await ready(page);
  // Pan far into the exterior using the real keyboard surface; no contours at this level.
  await page.locator('#contourStage').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
  await ready(page); expect((await snapshot(page)).contours.paths).toBe(0);
  await page.waitForTimeout(300);
  const empty = await sampleAudioEnvelope(page, { durationMs: 240, intervalMs: 50 }); expect(empty.summary.maxPeak).toBeLessThan(.001);
  const state = await snapshot(page); expect(state.armed && state.playing).toBe(true);
  await page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).dispose());
  const disposed = await snapshot(page); expect(disposed.disposed).toBe(true); expect(disposed.audioTime).toBeNull();
  await testInfo.attach('contour-audio.json', { body: JSON.stringify({ sounding, ongoing, empty }, null, 2), contentType: 'application/json' });
});

test('SVG exports completed vectors and preserves cropped open strands', async ({ page }) => {
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  await page.locator('#contourRegion').selectOption('seahorse'); await ready(page);
  const s = await snapshot(page); expect(s.contours.stats.openCount).toBeGreaterThan(0);
  const pending = page.waitForEvent('download'); await page.locator('#exportContour').click();
  const download = await pending, svg = await readFile(await download.path(), 'utf8');
  expect(svg).toContain('<metadata>'); expect(svg).not.toMatch(/NaN|Infinity/);
  const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
  expect(paths.length).toBe(s.contours.paths); expect(paths.some(p => !p.endsWith(' Z'))).toBe(true);
});

test('two-finger zoom and cancellation release the gesture without arming audio', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  const before = await snapshot(page), box = await page.locator('#contourStage').boundingBox();
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const points = (left, right) => [
    { x: Math.round(box.x + box.width * left), y: Math.round(box.y + box.height * .5), id: 1 },
    { x: Math.round(box.x + box.width * right), y: Math.round(box.y + box.height * .5), id: 2 },
  ];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(.35, .65) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(.22, .78) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await ready(page);
  const after = await snapshot(page);
  expect(after.state.viewWidth).toBeLessThan(before.state.viewWidth * .65);
  expect(after.contours.navigation.pointers).toBe(0); expect(after.armed).toBe(false);
  await page.locator('#wholeView').click(); await ready(page);
  expect((await snapshot(page)).state.viewWidth).toBe(before.state.viewWidth);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`explorer controls remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await page.goto('vector-fractals.html#explorer'); await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    const canvas = await page.locator('#contourStage').boundingBox(); expect(canvas.width).toBeGreaterThan(250); expect(canvas.height).toBeGreaterThan(200);
    await page.locator('#zoomIn').click(); await ready(page); expect((await snapshot(page)).state.viewWidth).toBeLessThan(3.4);
    await page.locator('#contourRegion').selectOption('filigree'); await ready(page);
    await page.screenshot({ path: testInfo.outputPath('explorer.png'), fullPage: true });
    await page.locator('#contourStage').scrollIntoViewIfNeeded(); await page.locator('#contourStage').focus(); await page.keyboard.press('Home'); await ready(page);
    await page.locator('#info').click(); await expect(page.locator('#helpDialog')).toBeVisible(); await page.keyboard.press('Escape');
    expect((await snapshot(page)).armed).toBe(false);
  });
}
