import { expect, test } from '@playwright/test';
import { readAudioStatus } from './helpers/audio-probe.mjs';

const state = page => page.evaluate(() => window.__puggler.snapshot());
const range = (page, id, value) => page.locator(`#${id}`).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`half/quarter speed, bounds, keyboard and preset recovery at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
    const touch = viewport.width < 1000;
    const context = await browser.newContext({ baseURL, viewport, hasTouch: touch, isMobile: touch });
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('puggler.html'); await page.waitForFunction(() => window.__puggler);
      await page.locator('.header-preset-next').click();
      await page.locator('#playButton').click();
      await range(page, 'level', .13); await range(page, 'tempo', 360);
      const before = await state(page);
      const half = page.getByRole('button', { name: '½ speed: halve juggling and music tempo' });
      const quarter = page.getByRole('button', { name: '¼ speed: quarter juggling and music tempo' });
      for (const button of [half, quarter]) {
        await button.scrollIntoViewIfNeeded(); await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(48);
        if (touch) expect(box.height).toBeGreaterThanOrEqual(48);
      }
      await half.click(); await expect(page.locator('#tempo')).toHaveValue('180');
      await expect(page.locator('output[for=tempo]')).toHaveText('180 BPM');
      await quarter.click(); await expect(page.locator('#tempo')).toHaveValue('45');
      await expect(page.locator('output[for=tempo]')).toHaveText('45 BPM');
      await expect(half).toBeDisabled(); await expect(quarter).toBeDisabled();
      expect(await state(page)).toMatchObject({ tempo: 45, rideSpeed: before.rideSpeed, level: .13, running: false, audioOn: false });
      const captured = await page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
      expect(captured.snapshot.model.tempo).toBe(45);
      await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
      await range(page, 'tempo', 333); await quarter.click();
      await expect(page.locator('#tempo')).toHaveValue('83.25');
      await expect(page.locator('output[for=tempo]')).toHaveText('83.25 BPM');
      await range(page, 'tempo', 100); await quarter.click();
      await expect(page.locator('#tempo')).toHaveValue('25');
      await expect(half).toBeDisabled(); await expect(quarter).toBeDisabled();
      await range(page, 'tempo', 100); await half.focus(); await half.press('Enter');
      await expect(page.locator('#tempo')).toHaveValue('50');
      await half.press('Space'); await expect(page.locator('#tempo')).toHaveValue('25');
      await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
      await page.locator('.header-preset-next').click();
      await expect(quarter).toBeEnabled();
      await page.locator('.header-preset-random').click();
      await expect(quarter).toBeEnabled();
      expect(await state(page)).toMatchObject({ level: .13, running: false, audioOn: false });
      await page.locator('#resetButton').click();
      await expect(page.locator('#tempo')).toHaveValue('360'); await expect(quarter).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await quarter.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('speed-buttons.png') });
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('speed actions preserve armed audio and running transport while actual note rhythm continues', async ({ page }) => {
  await page.goto('puggler.html'); await page.waitForFunction(() => window.__puggler);
  await page.locator('.header-preset-next').click();
  await range(page, 'tempo', 360); await range(page, 'rideSpeed', 0); await range(page, 'chaos', 0); await range(page, 'level', .13);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).rhythmicNotes).toBeGreaterThan(0);
  const before = await state(page);
  await page.locator('#quarterSpeedButton').click();
  expect(await state(page)).toMatchObject({ tempo: 90, rideSpeed: 0, level: .13, running: true, audioOn: true });
  await expect.poll(async () => (await state(page)).beat).toBeGreaterThan(before.beat);
  await expect.poll(async () => (await state(page)).rhythmicNotes, { timeout: 10000 }).toBeGreaterThan(before.rhythmicNotes);
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.000001);
  const signal = await readAudioStatus(page);
  expect(signal.active).toBe(true); expect(signal.clipped).toBe(false);
  expect(Number.isFinite(signal.peak)).toBe(true);
  await page.locator('#playButton').click(); await page.locator('#halfSpeedButton').click();
  expect(await state(page)).toMatchObject({ tempo: 45, running: false, audioOn: true });
  await page.locator('#audioButton').click();
});
