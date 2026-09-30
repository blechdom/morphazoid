import { expect, test } from '@playwright/test';

const zeroFields = [
  ['soundVariation', 'Sound variation', '0%'],
  ['sizeVariation', 'Size variation', '0%'],
  ['growth', 'Size gradient', 'Even'],
  ['stairRise', 'Step height', '0.00'],
  ['ring', 'Resonance', '0%'],
];
const snapshot = page => page.evaluate(() => window.dominoRun.snapshot);
const geometry = page => page.evaluate(() => {
  const { dominoes, links, roots } = window.dominoRun.run;
  return { dominoes, links, roots };
});
async function open(page) {
  await page.goto('domino-run.html');
  await page.waitForFunction(() => Boolean(window.dominoRun));
  await expect(page.locator('#soundVariation')).toBeAttached();
}
async function activate(locator, touch) {
  await locator.scrollIntoViewIfNeeded();
  if (touch) await locator.tap();
  else await locator.click();
}

for (const variant of [
  { name: 'desktop', touch: false, viewport: { width: 1440, height: 900 } },
  { name: 'phone touch', touch: true, viewport: { width: 390, height: 844 } },
]) {
  test.describe(variant.name, () => {
    test.use({ viewport: variant.viewport, hasTouch: variant.touch, isMobile: variant.touch });

    test('zero buttons reset native ranges, synchronize outputs, and disable at zero', async ({ page }) => {
      await open(page);
      expect(Number(await page.locator('#soundVariation').inputValue())).toBe(.2);
      if (variant.touch) expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      // Observe native input notifications; the test never changes app values directly.
      await page.evaluate(() => {
        window.dominoZeroInputEvents = [];
        document.addEventListener('input', event => {
          if (event.target instanceof HTMLInputElement) {
            window.dominoZeroInputEvents.push({ id: event.target.id, value: event.target.value });
          }
        });
      });
      for (const [key, label, zeroOutput] of zeroFields) {
        const input = page.locator(`#${key}`);
        const reset = page.locator(`[data-zero-param="${key}"]`);
        const output = page.locator(`output[for="${key}"]`);
        await expect(input).toHaveAccessibleName(new RegExp(label, 'i'));
        await expect(reset).toHaveAccessibleName(`Reset ${label} to zero`);
        await input.scrollIntoViewIfNeeded();
        await input.press('End');
        await expect(reset).toBeEnabled();
        expect(Number(await input.inputValue())).toBeGreaterThan(0);
        expect(await output.evaluate(el => el.scrollWidth <= el.clientWidth), `${label} maximum output fits`).toBe(true);
        if (variant.touch) {
          const box = await reset.boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        await activate(reset, variant.touch);
        await expect(input).toHaveValue('0');
        await expect(output).toHaveText(zeroOutput);
        expect(await output.evaluate(el => el.scrollWidth <= el.clientWidth), `${label} zero output fits`).toBe(true);
        await expect(reset).toBeDisabled();
        expect((await snapshot(page)).params[key]).toBe(0);
        expect(await page.evaluate(id => window.dominoZeroInputEvents.some(event => event.id === id && Number(event.value) === 0), key)).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(false);
    });

    test('Choose on stage edits the selected domino without changing the other pieces', async ({ page }) => {
      await open(page);
      const summary = page.locator('.group summary').filter({ hasText: 'Edit one domino' });
      await activate(summary, variant.touch);
      const choose = page.locator('#chooseDomino');
      await expect(choose).toHaveAccessibleName('Choose on stage');
      await activate(choose, variant.touch);
      await expect(page.locator('[data-mode="arrange"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#stage')).toBeFocused();
      await page.locator('#stage').scrollIntoViewIfNeeded();
      const target = await page.evaluate(() => window.dominoRun.targets.find(tile => tile.id === 7));
      expect(target).toBeTruthy();
      if (variant.touch) await page.locator('#stage').tap({ position: { x: target.x, y: target.y } });
      else await page.locator('#stage').click({ position: { x: target.x, y: target.y } });
      expect(await page.evaluate(() => window.dominoRun.selected)).toBe(7);
      await expect(page.locator('#selectedNumber')).toHaveText('8');
      const before = await geometry(page), settings = await snapshot(page);
      await page.locator('#tileSize').scrollIntoViewIfNeeded();
      await page.locator('#tileSize').evaluate(input => {
        input.value = '4'; input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await expect(page.locator('#tileSizeOut')).toHaveText('4.00');
      await page.locator('#tileMaterial').selectOption('plastic');
      const after = await geometry(page), selected = after.dominoes.find(tile => tile.id === 7);
      expect(selected.height).toBe(4);
      expect(selected.material).toBe('plastic');
      expect(after.dominoes.filter(tile => tile.id !== 7)).toEqual(before.dominoes.filter(tile => tile.id !== 7));
      expect(after.links).toEqual(before.links);
      expect(after.roots).toEqual(before.roots);
      expect((await snapshot(page)).edits.map(edit => edit.id)).toEqual([7]);
      expect((await snapshot(page)).params.size).toBe(settings.params.size);
      expect((await snapshot(page)).params.material).toBe(settings.params.material);
      expect(await page.evaluate(() => window.dominoRun.playing)).toBe(false);
      expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(false);
    });

    test('sound variation and its zero reset preserve geometry and the running audio clock', async ({ page }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await open(page);
      await activate(page.locator('#audioButton'), variant.touch);
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
      await activate(page.locator('#playButton'), variant.touch);
      await expect.poll(() => page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(.12);
      const before = await geometry(page);
      const firstTime = await page.evaluate(() => window.dominoRun.time);
      const input = page.locator('#soundVariation');
      await input.scrollIntoViewIfNeeded();
      await input.press('End');
      await expect(input).toHaveValue('1');
      expect((await snapshot(page)).params.soundVariation).toBe(1);
      expect(await geometry(page)).toEqual(before);
      const changedTime = await page.evaluate(() => window.dominoRun.time);
      expect(changedTime).toBeGreaterThanOrEqual(firstTime - .001);
      await activate(page.locator('[data-zero-param="soundVariation"]'), variant.touch);
      await expect(input).toHaveValue('0');
      await expect(page.locator('output[for="soundVariation"]')).toHaveText('0%');
      expect(await geometry(page)).toEqual(before);
      const resetTime = await page.evaluate(() => window.dominoRun.time);
      expect(resetTime).toBeGreaterThanOrEqual(changedTime - .001);
      expect(await page.evaluate(() => window.dominoRun.playing)).toBe(true);
      expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(true);
      await expect.poll(() => page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(resetTime + .10);
      expect(errors).toEqual([]);
    });
  });
}
