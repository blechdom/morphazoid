import { expect, test } from '@playwright/test';
import { readAudioStatus } from './helpers/audio-probe.mjs';

const state = page => page.evaluate(() => window.__puggler.snapshot());
const range = (page, id, value) => page.locator(`#${id}`).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`five-detent speed knob, top center, native keys/drag and preset recovery at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
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
      const speed = page.getByRole('slider', { name: 'Juggling / music speed', exact: true });
      await speed.scrollIntoViewIfNeeded(); await expect(speed).toBeVisible();
      await expect(speed).toHaveAttribute('min', '-2'); await expect(speed).toHaveAttribute('max', '2');
      await expect(speed).toHaveAttribute('step', '1'); await expect(speed).toHaveValue('0');
      await expect(page.locator('#halfSpeedButton,#quarterSpeedButton,#doubleSpeedButton,#quadSpeedButton')).toHaveCount(0);
      const needle = page.locator('label[for=tempoMultiplier] .mz-range-knob__dial i');
      await expect(needle).toHaveAttribute('style', 'transform: rotate(0deg)');
      await expect(page.locator('output[for=tempoMultiplier]')).toHaveText('1');
      // A five-step native range, with exactly the requested ratios and no compounding.
      await speed.focus();
      for (const [key, value, multiplier, label] of [
        ['ArrowLeft', '-1', .5, '½'], ['ArrowLeft', '-2', .25, '¼'],
        ['ArrowLeft', '-2', .25, '¼'], ['ArrowRight', '-1', .5, '½'],
        ['ArrowRight', '0', 1, '1'], ['ArrowRight', '1', 2, '2×'],
        ['ArrowRight', '2', 4, '4×'], ['ArrowRight', '2', 4, '4×'],
      ]) {
        await speed.press(key); await expect(speed).toHaveValue(value);
        await expect(page.locator('output[for=tempoMultiplier]')).toHaveText(label);
        await expect(page.locator('#tempo')).toHaveValue('360');
        expect(await state(page)).toMatchObject({ tempo: 360 * multiplier, baseTempo: 360, tempoMultiplier: multiplier, rideSpeed: before.rideSpeed, level: .13, running: false, audioOn: false });
      }
      await speed.press('Home'); await expect(speed).toHaveValue('-2');
      const captured = await page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
      expect(captured.snapshot.model).toMatchObject({ tempo: 360, tempoMultiplier: .25 });
      await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
      // True captured vertical drag: touch on phone layouts, mouse on desktop.
      await speed.scrollIntoViewIfNeeded(); const box = await speed.boundingBox();
      const x = box.x + box.width / 2, y = box.y + 20;
      if (touch) {
        const session = await context.newCDPSession(page);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 60 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await session.detach();
      } else {
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x, y - 60, { steps: 6 }); await page.mouse.up();
      }
      await expect(speed).toHaveValue('0');
      await expect(needle).toHaveAttribute('style', 'transform: rotate(0deg)');
      expect(await state(page)).toMatchObject({ tempo: 360, tempoMultiplier: 1 });
      await range(page, 'tempo', 25); await speed.press('Home');
      expect(await state(page)).toMatchObject({ tempo: 6.25, baseTempo: 25 });
      await range(page, 'tempo', 1200); await speed.press('End');
      expect(await state(page)).toMatchObject({ tempo: 4800, baseTempo: 1200 });
      await page.locator('.header-preset-next').click(); await expect(speed).toHaveValue('0');
      await page.locator('.header-preset-random').click();
      expect([-2, -1, 0, 1, 2]).toContain(Number(await speed.inputValue()));
      expect(await state(page)).toMatchObject({ level: .13, running: false, audioOn: false });
      await page.locator('#resetButton').click();
      await expect(page.locator('#tempo')).toHaveValue('360'); await expect(speed).toHaveValue('0');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await speed.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('speed-knob.png') });
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('speed knob preserves armed audio/transport, note rhythm and bounded dense output', async ({ page }) => {
  await page.goto('puggler.html'); await page.waitForFunction(() => window.__puggler);
  await page.locator('.header-preset-next').click();
  await range(page, 'tempo', 360); await range(page, 'rideSpeed', 0); await range(page, 'chaos', 0); await range(page, 'level', .13);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).rhythmicNotes).toBeGreaterThan(0);
  const before = await state(page);
  await range(page, 'tempoMultiplier', -2);
  expect(await state(page)).toMatchObject({ tempo: 90, baseTempo: 360, rideSpeed: 0, level: .13, running: true, audioOn: true });
  await expect.poll(async () => (await state(page)).beat).toBeGreaterThan(before.beat);
  await expect.poll(async () => (await state(page)).rhythmicNotes, { timeout: 10000 }).toBeGreaterThan(before.rhythmicNotes);
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.000001);
  for (const skin of ['punk', 'history', 'future']) {
    await page.locator('#skin').selectOption(skin);
    await range(page, 'tempo', 1200); await range(page, 'count', 10); await range(page, 'tempoMultiplier', 2);
    await page.waitForTimeout(1600);
    const signal = await readAudioStatus(page);
    expect(signal.active).toBe(true); expect(signal.clipped).toBe(false);
    expect(Number.isFinite(signal.peak)).toBe(true); expect(signal.rms).toBeGreaterThan(.000001);
    expect(await state(page)).toMatchObject({ tempo: 4800, audioOn: true, running: true, level: .13 });
    expect((await state(page)).attacks).toBeLessThanOrEqual(64);
  }
  await page.locator('#playButton').click(); await range(page, 'tempoMultiplier', -1);
  expect(await state(page)).toMatchObject({ tempo: 600, running: false, audioOn: true });
  await page.locator('#audioButton').click();
});
