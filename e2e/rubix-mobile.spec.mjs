import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
const snapshot = page => page.evaluate(async () => (await import('/src/instruments/rubix/rubix-app.js')).rubixPlaybackSnapshot());
const voiceMap = { red: 0, green: 2, yellow: 7, blue: 10, white: 11, orange: 14 };

async function openKit(page) {
  await page.goto('/rubix.html');
  await page.locator('.header-preset-picker > summary').tap();
  await page.locator('.header-preset-picker [data-preset-id="color-kit"]').tap();
  await expect(page.locator('#soundBank')).toHaveValue('color-kit');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
}

async function uncoveredControl(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect.poll(() => locator.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
      && [.2, .5, .8].every(y => node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height * y)));
  })).toBe(true);
}

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [568, 320], [844, 390]]) {
  test.describe(`Rubix touch layout ${width}×${height}`, () => {
    test.use({ viewport: { width, height } });
    test('playback, recovery and preset controls are fully reachable', async ({ page }, info) => {
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await openKit(page);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      expect(await page.locator('#tempoOut').evaluate(node => node.scrollWidth > node.clientWidth + 1)).toBe(false);
      await page.screenshot({ path: info.outputPath('color-kit-mobile.png') });
      for (const selector of ['#audioButton', '#playButton', '#randomTwists', '#scrambleCube', '#solveCube', '#undoMove', '#resetView']) {
        const control = page.locator(selector);
        await uncoveredControl(control);
        const box = await control.boundingBox();
        expect(box.width, selector).toBeGreaterThanOrEqual(48);
        expect(box.height, selector).toBeGreaterThanOrEqual(48);
      }
      for (const selector of ['#readPath', '#shape', '#soundBank']) {
        await uncoveredControl(page.locator(selector));
        expect(await page.locator(selector).evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
      }
      await page.locator('#colorKey').scrollIntoViewIfNeeded();
      await expect(page.locator('#colorKey span')).toHaveCount(6);
      for (const item of await page.locator('#colorKey span').all()) {
        expect(await item.evaluate(node => node.scrollWidth > node.clientWidth + 1)).toBe(false);
      }
      const stage = await page.locator('#stage').boundingBox();
      expect(stage.y).toBeGreaterThanOrEqual(0);
      expect(stage.y + stage.height).toBeLessThanOrEqual(height);
      expect(stage.height).toBeGreaterThanOrEqual(200);
      expect(errors).toEqual([]);
    });
  });
}

async function dragCoordinates(page) {
  const s = await snapshot(page);
  const geometry = s.geometry.find(item => item.sticker.id === 'front:1:1');
  expect(geometry).toBeTruthy();
  const [center, a, b] = geometry.projectedTriangles[0];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const bounds = await page.locator('#stage').boundingBox();
  const start = { x: bounds.x + center.x, y: bounds.y + center.y, id: 1 };
  const end = { x: start.x + 40 * (b.x - a.x) / length, y: start.y + 40 * (b.y - a.y) / length, id: 1 };
  return { start, end, bounds };
}

test.describe('Rubix mobile gestures', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('native presets remain usable after orientation changes during playback', async ({ page }, info) => {
    await openKit(page);
    await page.locator('#audioButton').tap();
    await page.locator('#playButton').tap();
    await page.setViewportSize({ width: 844, height: 390 });
    await uncoveredControl(page.locator('#playButton'));
    await page.waitForTimeout(350);
    await page.locator('.header-preset-picker > summary').tap();
    await expect(page.locator('.header-preset-picker')).toHaveAttribute('open', '', { timeout: 1500 });
    await page.locator('.header-preset-picker [data-preset-id="color-kit"]').tap();
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    const envelope = await sampleAudioEnvelope(page, { durationMs: 800 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
    expect(envelope.summary.clippedSamples).toBe(0);
    await info.attach('orientation-audio.json', { body: JSON.stringify(envelope.summary), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('landscape-playing.png') });
  });
  test('a second touch cannot steal a slice or interrupt audio', async ({ page }, info) => {
    test.setTimeout(60000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await openKit(page);
    await page.locator('#solveCube').tap();
    await page.locator('#audioButton').tap();
    await page.locator('#playButton').tap();
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const before = await snapshot(page);
    const { start, end, bounds } = await dragCoordinates(page);
    const second = { x: bounds.x + 12, y: bounds.y + 12, id: 2 };
    await touch('touchStart', [start]);
    await touch('touchMove', [end]);
    await touch('touchStart', [end, second]);
    await touch('touchMove', [end, { ...second, x: second.x + 20 }]);
    await touch('touchEnd');
    await expect.poll(async () => (await snapshot(page)).scoreIds).not.toEqual(before.scoreIds);
    await expect(page.locator('#stage')).not.toHaveClass(/is-dragging/);
    expect((await snapshot(page)).camera).toEqual(before.camera);
    const turned = await snapshot(page);
    const orbitStart = { x: bounds.x + 10, y: bounds.y + bounds.height / 2, id: 1 };
    await touch('touchStart', [orbitStart]);
    await touch('touchMove', [{ ...orbitStart, x: orbitStart.x + 70, y: orbitStart.y + 15 }]);
    await touch('touchEnd');
    await expect.poll(async () => (await snapshot(page)).camera).not.toEqual(before.camera);
    await expect(page.locator('#stage')).not.toHaveClass(/is-dragging/);
    expect((await snapshot(page)).scoreIds).toEqual(turned.scoreIds);
    const after = await snapshot(page);
    expect(after.playing).toBe(true);
    expect(after.audioTime).toBeGreaterThan(before.audioTime);
    expect(after.events.every(event => event.value === voiceMap[event.color])).toBe(true);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 1200 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
    expect(envelope.summary.clippedSamples).toBe(0);
    await info.attach('multitouch-audio.json', { body: JSON.stringify(envelope.summary), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });

  test('cancelled drags recover and whole-cube rotation preserves audio', async ({ page }, info) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await openKit(page);
    await page.locator('#solveCube').tap();
    await page.locator('#audioButton').tap();
    await page.locator('#playButton').tap();
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#stage').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector('#stage').addEventListener('pointerdown', event => {
      if (event.isPrimary) window.mobileTestPointerId = event.pointerId;
    }));
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const before = await snapshot(page);
    const cancel = await dragCoordinates(page);
    const { bounds } = cancel;
    await touch('touchStart', [cancel.start]);
    await touch('touchMove', [cancel.end]);
    await touch('touchCancel');
    await expect(page.locator('#stage')).not.toHaveClass(/is-dragging/);
    expect((await snapshot(page)).scoreIds).toEqual(before.scoreIds);
    await touch('touchStart', [cancel.start]);
    await touch('touchMove', [cancel.end]);
    await page.evaluate(() => document.querySelector('#stage').releasePointerCapture(window.mobileTestPointerId));
    await touch('touchMove', [{ ...cancel.end, x: cancel.end.x + 1 }]);
    await expect(page.locator('#stage')).not.toHaveClass(/is-dragging/);
    await touch('touchEnd');
    expect((await snapshot(page)).scoreIds).toEqual(before.scoreIds);
    await touch('touchStart', [cancel.start]);
    await touch('touchMove', [cancel.end]);
    await touch('touchEnd');
    await expect.poll(async () => (await snapshot(page)).scoreIds).not.toEqual(before.scoreIds);
    const recovered = await snapshot(page);

    const orbitStart = { x: bounds.x + 10, y: bounds.y + bounds.height / 2, id: 1 };
    await touch('touchStart', [orbitStart]);
    await touch('touchMove', [{ ...orbitStart, x: orbitStart.x + 70, y: orbitStart.y + 15 }]);
    await touch('touchEnd');
    await expect.poll(async () => (await snapshot(page)).camera).not.toEqual(before.camera);
    expect((await snapshot(page)).scoreIds).toEqual(recovered.scoreIds);
    const after = await snapshot(page);
    expect(after.playing).toBe(true);
    expect(after.audioTime).toBeGreaterThan(before.audioTime);
    expect(after.events.every(event => event.value === voiceMap[event.color])).toBe(true);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 1200 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
    expect(envelope.summary.clippedSamples).toBe(0);
    await info.attach('touch-and-audio.json', { body: JSON.stringify({ beforeCamera: before.camera, afterCamera: after.camera, envelope: envelope.summary }), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('touch-playing.png') });
    expect(errors).toEqual([]);
  });
});
