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

test.describe('touch transport alignment', () => {
  test.use({ hasTouch: true });
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1024, height: 900 },
    { width: 390, height: 844 }, { width: 844, height: 390 },
  ]) {
    test(`preset, play, preview, tempo and tap center at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/synthesis.html');
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      const picker = page.locator('#performancePresetHost summary');
      const play = page.locator('#playButton'), next = page.locator('#nextPerformancePreset');
      const original = await Promise.all([picker, play, next].map(box));
      // These consecutive factory scenes include mono, poly, speech and singing.
      for (const preset of INSTRUMENT_PRESETS.slice(0, 8)) {
        await next.click();
        await expect(picker.locator('.instrument-picker-current')).toHaveText(preset.label);
        for (const [index, node] of [picker, play, next].entries()) stable(await box(node), original[index]);
        const presetBox = await box(picker), playBox = await box(play);
        expect(playBox.width).toBeGreaterThanOrEqual(48);
        expect(playBox.height).toBeGreaterThanOrEqual(48);
        if (playBox.x >= presetBox.x + presetBox.width)
          expect(Math.abs(center(presetBox).y - center(playBox).y)).toBeLessThan(1);
        expect(Math.abs(center(playBox).y - center(await box(page.locator('#triggerButton'))).y)).toBeLessThan(1);
        if (await page.locator('#transportTiming').isVisible()) {
          const dial = await box(page.locator('#transportTiming .synthesis-knob-dial'));
          const drawnDial = await box(page.locator('#transportTiming .mz-range-knob__dial'));
          const tap = await box(page.locator('#transportTiming .mz-tap-tempo'));
          expect(Math.abs(center(dial).y - center(drawnDial).y)).toBeLessThan(1);
          expect(Math.abs(center(dial).y - center(tap).y)).toBeLessThan(1);
          // On narrow phones tempo wraps to a second, independently centered row.
          if (dial.x >= playBox.x + playBox.width)
            expect(Math.abs(center(dial).y - center(playBox).y)).toBeLessThan(1);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }
});

test('Synthesaurus catalogue icon retains real transparency', async ({ page }) => {
  await page.goto('/synthesis.html');
  const result = await page.evaluate(async () => {
    const { TOOL_GROUPS } = await import('/src/site/instrument-registry.js');
    const icon = TOOL_GROUPS.flatMap(group => group.tools).find(tool => tool.id === 'synthesis').imageHref;
    const image = new Image(); image.src = '/' + icon; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let transparent = 0, solid = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) transparent++;
      // Generated fills can retain alpha 254; distinguish a solid mark from
      // a faint/empty asset without requiring a particular encoder's rounding.
      if (data[i] >= 250) solid++;
    }
    return { width: image.width, height: image.height,
      corners: [0, image.width - 1, (image.height - 1) * image.width, image.width * image.height - 1].map(pixel => data[pixel * 4 + 3]),
      transparent: transparent / (image.width * image.height), solid: solid / (image.width * image.height) };
  });
  expect(result.width).toBe(512); expect(result.height).toBe(512);
  expect(result.corners).toEqual([0, 0, 0, 0]);
  expect(result.transparent).toBeGreaterThan(.1);
  expect(result.solid).toBeGreaterThan(.1);
  const heading = page.getByRole('heading', { level: 1, name: 'Synthesaurus', exact: true });
  const titleIcon = page.locator('.synthesis-title-icon');
  await expect(titleIcon).toHaveAttribute('src', 'assets/instruments/synthesis.webp');
  await expect(titleIcon).toHaveAttribute('alt', ''); // Decorative; don't repeat the heading for screen readers.
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(titleIcon).toBeVisible();
    const iconBox = await box(titleIcon), headingBox = await box(heading);
    const copyBox = await box(page.locator('.synthesis-title-copy'));
    const subtitleBox = await box(page.locator('.synthesis-subtitle'));
    expect(iconBox.width).toBe(iconBox.height);
    expect(iconBox.height).toBe(96);
    expect(headingBox.x).toBeGreaterThan(iconBox.x + iconBox.width);
    expect(subtitleBox.x).toBe(headingBox.x);
    expect(subtitleBox.y).toBeGreaterThanOrEqual(headingBox.y + headingBox.height);
    expect(Math.abs(center(iconBox).y - center(copyBox).y)).toBeLessThan(1);
    expect(await page.locator('.synthesis-subtitle').evaluate(node => getComputedStyle(node).fontStyle)).toBe('normal');
    expect(await titleIcon.evaluate(node => node.complete && node.naturalWidth === 512)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

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
      const preset = await box(picker), play = await box(page.locator('#playButton'));
      // When the responsive layout puts them on the same row, compare actual
      // control centers rather than their different-height wrapper elements.
      if (play.x >= preset.x + preset.width) expect(Math.abs(center(preset).y - center(play).y)).toBeLessThan(1);
      expect(Math.abs(center(play).y - center(await box(page.locator('#triggerButton'))).y)).toBeLessThan(1);
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
