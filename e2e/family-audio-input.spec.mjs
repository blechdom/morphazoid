import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { installAudioInputFixture } from './helpers/audio-input-fixture.mjs';

const routes = ['crab-loom', 'freeze-point', 'scatter-ghost', 'exceptional', 'head-shed', 'simd-resonator', 'simd-lab', 'micromorph', 'fractal-synthesis'];

const installInput = installAudioInputFixture;

for (const route of routes) {
  test(`${route}: mic input toggles, meters and gain work with master Audio off`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await installInput(page);
    await page.goto(`/${route}.html`);
    const strip = page.locator('.mz-audio-input-strip');
    await expect(strip).toHaveCount(1);
    const mic = strip.locator('.mz-input-toggle');
    await expect(mic).toBeEnabled();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => __familyInput.requests)).toBe(0);
    await mic.click();
    await expect(mic).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => strip.locator('meter').first().evaluate(node => node.value)).toBeGreaterThan(.02);
    if (route !== 'head-shed') {
      const output = await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 40 });
      expect(output.summary.maxPeak).toBeLessThan(.00001);
    }
    const gain = strip.locator('input[type="range"]');
    await gain.evaluate(node => { node.value = '0'; node.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect.poll(() => strip.locator('meter').first().evaluate(node => node.value)).toBeLessThan(.001);
    await gain.evaluate(node => { node.value = '1'; node.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect.poll(() => strip.locator('meter').first().evaluate(node => node.value)).toBeGreaterThan(.02);
    await mic.click();
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === 'ended'))).toBe(true);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
    await page.evaluate(() => Promise.all(__familyInput.contexts.map(context => context.close())));
  });

  test(`${route}: second mic click cancels a pending permission grant`, async ({ page }) => {
    await installInput(page, true);
    await page.goto(`/${route}.html`);
    const mic = page.locator('.mz-input-toggle');
    await mic.click();
    await expect.poll(() => page.evaluate(() => __familyInput.requests), { timeout: 15_000 }).toBe(1);
    await expect(mic).toHaveAttribute('aria-busy', 'true');
    await mic.click();
    await expect(mic).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => __familyInput.releases.splice(0).forEach(resolve => resolve()));
    await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === 'ended'))).toBe(true);
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => Promise.all(__familyInput.contexts.map(context => context.close())));
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`family input controls stay aligned and reachable at ${viewport.width}×${viewport.height}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport, hasTouch: viewport.width !== 1440 });
    const page = await context.newPage();
    try {
      for (const route of routes) {
        await page.goto(`/${route}.html`);
        const strip = page.locator('.mz-audio-input-strip');
        await strip.scrollIntoViewIfNeeded();
        const geometry = await strip.evaluate(root => {
          const targets = [root.querySelector('.mz-input-gain'), root.querySelector('.mz-input-meter'), root.querySelector('.mz-input-toggle')];
          return targets.map(node => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right, center: rect.top + rect.height / 2, width: rect.width, height: rect.height,
              inViewport: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1 };
          });
        });
        expect(geometry.every(target => target.inViewport), route).toBe(true);
        expect(geometry[0].right, route).toBeLessThanOrEqual(geometry[1].left);
        expect(geometry[1].right, route).toBeLessThanOrEqual(geometry[2].left);
        expect(Math.abs(geometry[0].center - geometry[1].center), route).toBeLessThan(2);
        expect(Math.abs(geometry[0].center - geometry[2].center), route).toBeLessThan(2);
        if (viewport.width !== 1440) {
          expect(geometry[2].width, route).toBeGreaterThanOrEqual(48);
          expect(geometry[2].height, route).toBeGreaterThanOrEqual(48);
        }
      }
    } finally { await context.close(); }
  });
}
