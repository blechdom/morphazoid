import { test, expect } from '@playwright/test';
import { SECTION_PRESETS } from '../src/instruments/synthesis/presets.js';
import { choose, exact } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope, readAudioStatus } from './helpers/audio-probe.mjs';

const presets = SECTION_PRESETS.processing;
const state = page => page.evaluate(() => window.MorphazoidSynthesis.getState());
const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
// Physical-to-normalized logarithmic controls can differ by one last bit
// between Node's factory catalogue and Chromium's math implementation.
const expectedEffect = preset => ({ ...preset.snapshot,
  params: preset.snapshot.params.map(value => expect.closeTo(value, 12)),
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`combined processor presets expose Delay and fit at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/synthesis.html?method=fm&sequence=basic-up');
    await page.locator('#processorEnabled').check();
    await expect(page.locator('#processorMethod')).toHaveValue('fx-reverb');
    expect(await page.locator('#processorPreset option').evaluateAll(options => options.map(option => option.value))).toEqual(presets.map(preset => preset.id));
    await expect(page.locator('#processorPreset optgroup')).toHaveCount(0);
    const before = await state(page);
    const sequence = await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState());
    const picker = page.locator('[data-select-id="processorPreset"]');
    await picker.locator('summary').click();
    await picker.locator('input').fill('stereo feedback delay');
    await expect(picker.locator('.instrument-picker-link:visible')).toHaveCount(8);
    await picker.getByRole('button', { name: 'Slapback · Stereo feedback delay', exact: true }).click();
    await expect(page.locator('#processorMethod')).toHaveValue('fx-delay');
    await expect(page.locator('#processorPreset')).toHaveValue('fx-delay:slapback');
    const after = await state(page);
    expect(after).toEqual({ ...before, routing: { ...before.routing, effect: expectedEffect(presets.find(preset => preset.id === 'fx-delay:slapback')) } });
    expect(await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState())).toEqual(sequence);
    expect(await status(page)).toMatchObject({ armed: false, playing: false });
    await expect(page.locator('#processorParameters')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('Next traverses every processor preset, wraps, and retains the cursor after edits', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html');
  await page.locator('#processorEnabled').check();
  await choose(page, 'processorPreset', presets[0].id);
  for (const preset of presets) {
    await expect(page.locator('#processorPreset')).toHaveValue(preset.id);
    await expect(page.locator('#processorMethod')).toHaveValue(preset.snapshot.methodId);
    expect((await state(page)).routing.effect).toEqual(expectedEffect(preset));
    await page.locator('#nextProcessorPreset').click();
    await page.waitForTimeout(25);
  }
  await expect(page.locator('#processorPreset')).toHaveValue(presets[0].id);
  const lastDelayIndex = presets.findLastIndex(preset => preset.snapshot.methodId === 'fx-delay');
  await choose(page, 'processorPreset', presets[lastDelayIndex].id);
  await exact(page, '#dryWet-value', 33);
  await expect(page.locator('#processorPreset')).toHaveValue('custom');
  await page.locator('#nextProcessorPreset').click();
  await expect(page.locator('#processorPreset')).toHaveValue(presets[lastDelayIndex + 1].id);
  expect((await state(page)).routing.effect).toEqual(expectedEffect(presets[lastDelayIndex + 1]));
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
  expect(errors).toEqual([]);
});

test('cross-processor recall preserves explicit source, live output, pause and mute', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html?method=additive');
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  const level = (await state(page)).outputLevel;
  for (const input of ['synthesis', 'speech', 'singing', 'samples', 'signals']) {
    await choose(page, 'inputCategory', input);
    if (input === 'signals') await choose(page, 'processingSource', 'sine');
    await page.locator('#processorEnabled').check();
    const before = (await state(page)).routing;
    for (const id of ['fx-delay:slapback', 'fx-reverb:small-room']) {
      await choose(page, 'processorPreset', id);
      const after = await state(page);
      expect(after.routing).toEqual({ ...before, effect: expectedEffect(presets.find(preset => preset.id === id)) });
      expect(after.outputLevel).toBe(level);
      await expect.poll(async () => (await status(page)).input.loading, { timeout: 40_000 }).toBe(false);
      await expect.poll(async () => (await sampleAudioEnvelope(page, { durationMs: 650 })).summary.maxRms, { timeout: 8000 }).toBeGreaterThan(.0001);
      expect(await status(page)).toMatchObject({ armed: true, playing: true });
      expect((await readAudioStatus(page)).connectionCount).toBe(1);
    }
  }
  await page.locator('#playButton').click();
  await choose(page, 'processorPreset', 'fx-delay:slapback');
  expect(await status(page)).toMatchObject({ armed: true, playing: false });
  // Armed test signals give a finite preset audition, without starting Play.
  await expect.poll(async () => (await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms,
    { timeout: 12_000 }).toBeLessThan(.00001);
  expect((await status(page)).playing).toBe(false);
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await choose(page, 'processorPreset', 'fx-reverb:small-room');
  expect(await status(page)).toMatchObject({ armed: false, playing: true });
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeLessThan(.00001);
  expect(errors).toEqual([]);
});
