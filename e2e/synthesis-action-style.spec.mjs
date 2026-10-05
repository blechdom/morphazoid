import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';

const appearance = locator => locator.evaluate(node => {
  const style = getComputedStyle(node), box = node.getBoundingClientRect();
  const icon = node.querySelector('svg')?.getBoundingClientRect();
  return { width: box.width, height: box.height, font: style.font, color: style.color,
    background: style.backgroundColor, border: style.border, radius: style.borderRadius,
    padding: style.padding, outline: style.outline, outlineOffset: style.outlineOffset,
    icon: icon ? [icon.width, icon.height] : null };
});

for (const { viewport, hasTouch } of [
  { viewport: { width: 1440, height: 900 }, hasTouch: false },
  { viewport: { width: 390, height: 844 }, hasTouch: false },
  { viewport: { width: 390, height: 844 }, hasTouch: true },
  { viewport: { width: 844, height: 390 }, hasTouch: true },
]) {
  test(`every preset action matches the main controls at ${viewport.width}×${viewport.height}, touch=${hasTouch}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport, hasTouch });
    const page = await context.newPage();
    try {
      await page.goto('/synthesis.html?method=fm&sequence=rotating-euclidean-chords');
      await expect(page.locator('#nextPerformancePreset')).toBeVisible();
      await page.locator('#processorEnabled').check();
      const compare = async (selector, main) => {
        const action = page.locator(selector), reference = page.locator(main);
        await expect(action).toBeVisible();
        await expect(action).toBeEnabled();
        await page.mouse.move(1, 1);
        const expected = await appearance(reference);
        expect(expected.width).toBe(hasTouch ? 48 : 36);
        expect(expected.height).toBe(expected.width);
        expect(await appearance(action), selector).toEqual(expected);
        // Voice controls have their own font/focus theme; actions must still
        // match the shared toolbar, including a real keyboard focus outline.
        await page.keyboard.press('Tab');
        await reference.focus();
        const focused = await appearance(reference);
        await action.focus();
        expect(await appearance(action), `${selector} focus`).toEqual(focused);
        await action.evaluate(node => node.blur());
        if (!hasTouch) {
          await reference.hover();
          const hovered = await appearance(reference);
          await action.hover();
          expect(await appearance(action), `${selector} hover`).toEqual(hovered);
          await page.mouse.move(1, 1);
        }
      };
      for (const id of ['nextMethod', 'nextPreset', 'nextTuning', 'nextEnvelopePreset',
        'nextSequence', 'nextSequencePreset', 'nextProcessor', 'nextProcessorPreset']) {
        await compare(`#${id}`, '#nextPerformancePreset');
      }
      for (const id of ['randomMethod', 'randomEnvelope', 'randomSequencePreset', 'randomProcessor']) {
        await compare(`#${id}`, '#randomPerformance');
      }
      await choose(page, 'inputCategory', 'percussion');
      for (const id of ['drumMethodNext', 'drumKitNext', 'drumRhythmNext']) await compare(`#${id}`, '#nextPerformancePreset');
      for (const id of ['drumKitRandom', 'drumRhythmRandom']) await compare(`#${id}`, '#randomPerformance');
      for (const input of ['speech', 'singing']) {
        await choose(page, 'inputCategory', input);
        for (const label of ['Next voice method', 'Next voice preset']) {
          await compare(`[aria-label="${label}"]`, '#nextPerformancePreset');
        }
        await compare('[aria-label="Randomize current voice parameters"]', '#randomPerformance');
        await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
        await page.getByRole('button', { name: 'Randomize current voice parameters', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Randomize current voice parameters', exact: true })).not.toHaveAttribute('aria-pressed', 'true');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus())).toMatchObject({ armed: false, playing: false });
    } finally { await context.close(); }
  });
}
