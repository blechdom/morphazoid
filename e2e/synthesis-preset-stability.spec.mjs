import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';
import { INSTRUMENT_PRESETS, RANDOMIZABLE_INPUTS } from '../src/instruments/synthesis/instrument-presets.js';

async function box(locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull(); return value;
}
function stable(actual, original) {
  for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(actual[key] - original[key]), key).toBeLessThan(1);
}
const center = rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

for (const viewport of [
  { width: 1440, height: 900 }, { width: 1024, height: 900 }, { width: 844, height: 900 },
  { width: 390, height: 844 }, { width: 844, height: 390 },
]) {
  test(`main Next and dice stay under a stationary pointer at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    test.setTimeout(30_000 + INSTRUMENT_PRESETS.length * 2_000);
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      let seed = 89341;
      Math.random = () => {
        if (Number.isFinite(window.nextFamilyDraw)) {
          const value = window.nextFamilyDraw; window.nextFamilyDraw = null; return value;
        }
        return (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
      };
    });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/synthesis.html');
    const picker = page.locator('#performancePresetHost summary');
    const next = page.locator('#nextPerformancePreset'), dice = page.locator('#randomPerformance');
    const original = await Promise.all([picker, next, dice].map(box));
    const nextPoint = center(original[1]), dicePoint = center(original[2]);
    const check = async () => {
      for (const [index, node] of [picker, next, dice].entries()) stable(await box(node), original[index]);
    };
    for (const preset of INSTRUMENT_PRESETS) {
      // Do not let locator.click follow a moving button: keep the pointer still.
      await page.mouse.click(nextPoint.x, nextPoint.y);
      await expect(picker.locator('.instrument-picker-current')).toHaveText(preset.label);
      await check();
    }
    for (const [index, input] of RANDOMIZABLE_INPUTS.entries()) {
      await page.evaluate(({ index, count }) => { window.nextFamilyDraw = (index + .5) / count; }, { index, count: RANDOMIZABLE_INPUTS.length });
      await page.mouse.click(dicePoint.x, dicePoint.y);
      await expect(picker.locator('.instrument-picker-current')).toHaveText('Preset · Custom');
      expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().routing.input)).toBe(input);
      await check();
    }
    await page.mouse.click(nextPoint.x, nextPoint.y);
    await expect(picker.locator('.instrument-picker-current')).toHaveText(INSTRUMENT_PRESETS[0].label);
    await check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus())).toMatchObject({ armed: false, playing: false });
    expect(errors).toEqual([]);
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`local preset widths do not follow their labels at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await page.goto('/synthesis.html');
    for (const [input, selectId, nextSelector, randomSelector] of [
      ['synthesis', 'presetSelect', '#nextPreset', '#randomMethod'],
      ['singing', 'synthesis-voice-1-preset', '[aria-label="Next voice preset"]', '[aria-label="Randomize current voice parameters"]'],
      ['signals', 'processorPreset', '#nextProcessorPreset', '#randomProcessor'],
    ]) {
      await choose(page, 'inputCategory', input);
      if (input === 'signals') await page.locator('#processorEnabled').check();
      const picker = page.locator(`[data-select-id="${selectId}"] summary`);
      await picker.scrollIntoViewIfNeeded();
      const controls = [picker, page.locator(nextSelector), page.locator(randomSelector)];
      const original = await Promise.all(controls.map(box));
      const options = await page.locator('#' + selectId).evaluate(node => [...node.options].filter(item => !['', 'custom'].includes(item.value)).map(item => ({ value: item.value, text: item.text })).sort((a, b) => a.text.length - b.text.length));
      for (const option of [options[0], options.at(-1)]) {
        await choose(page, selectId, option.value);
        // Other parameter sections can change document height; compare the
        // selector and its actions relative to their row, independent of scroll.
        const actual = await Promise.all(controls.map(box));
        for (const [index, rect] of actual.entries()) {
          expect(Math.abs(rect.x - original[index].x)).toBeLessThan(1);
          expect(Math.abs(rect.width - original[index].width)).toBeLessThan(1);
          expect(Math.abs(rect.height - original[index].height)).toBeLessThan(1);
          expect(Math.abs((rect.y - actual[0].y) - (original[index].y - original[0].y))).toBeLessThan(1);
        }
        await expect(picker).toHaveAttribute('title', new RegExp(option.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
      await page.locator(randomSelector).click();
      expect(Math.abs((await box(picker)).width - original[0].width)).toBeLessThan(1);
    }
  });
}
