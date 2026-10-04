import { test, expect } from '@playwright/test';
import { choose, exact } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const state = page => page.evaluate(() => window.MorphazoidSynthesis.getState());
const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());

test('input leads the UI, synth inserts and source settings round-trip without arming Audio', async ({ page }) => {
  await page.goto('/synthesis.html?method=fm&sequence=captured-control-gesture');
  await expect(page.locator('#inputCategory')).toHaveValue('synthesis');
  await expect(page.locator('#synthDetail')).toBeVisible();
  await expect(page.locator('#arpDetail')).toBeVisible();
  await expect(page.locator('#sectionSynthesis,#sectionProcessing')).toHaveCount(0);
  await page.locator('#processorEnabled').check();
  await choose(page, 'processorMethod', 'fx-delay');
  await page.locator('#nextProcessorPreset').click();
  const before = await state(page);
  expect(before.methodId).toBe('fm'); expect(before.routing.effect.methodId).toBe('fx-delay');
  await choose(page, 'inputCategory', 'signals');
  await expect(page.locator('#synthDetail')).toBeHidden(); await expect(page.locator('#arpDetail')).toBeHidden();
  await expect(page.locator('#processorDetail')).toBeVisible();
  await expect(page.locator('#randomMethod')).toBeHidden();
  await choose(page, 'processingSource', 'impulses');
  await choose(page, 'processorMethod', 'fx-reverb');
  await page.locator('#nextProcessorPreset').click();
  expect((await status(page)).input.selection).toBe('impulses');
  await page.evaluate(value => window.MorphazoidSynthesis.applyState(value), before);
  expect(await state(page)).toEqual(before);
  expect((await status(page)).armed).toBe(false);
});

test('mono and poly notes remain audible across insert and external-input transitions', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html?method=additive&sequence=basic-up');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  await page.locator('#processorEnabled').check();
  await choose(page, 'processorMethod', 'fx-biquad'); await page.locator('#processingBypass').check();
  for (const voice of ['mono', 'poly']) {
    await choose(page, 'voiceMode', voice);
    await choose(page, 'inputCategory', 'signals');
    await choose(page, 'inputCategory', 'synthesis');
    const measure = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 50 });
    expect(measure.summary.finite).toBe(true); expect(measure.summary.maxRms).toBeGreaterThan(.001);
    expect(measure.summary.maxPeak).toBeLessThanOrEqual(1);
    expect((await status(page)).playing).toBe(true);
  }
  await page.locator('#processorEnabled').uncheck();
  expect((await status(page)).playing).toBe(true);
  expect(errors).toEqual([]);
});

test('the actual gesture score changes notes and survives URL and preset state recall', async ({ page }) => {
  await page.goto('/synthesis.html?sequence=captured-control-gesture');
  const before = await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState());
  const pitch = page.getByRole('slider', { name: /^Gesture pitch/ });
  await pitch.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Alt+ArrowRight');
  const edited = await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState());
  expect(edited.parameters.gesturePoints).toBeDefined(); expect(edited.cycle.steps).not.toEqual(before.cycle.steps);
  await page.reload();
  expect((await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState())).parameters).toEqual(edited.parameters);
  expect((await status(page)).armed).toBe(false);
});

test('spectral modes expose only effective controls and colored noise remains audible', async ({ page }) => {
  await page.goto('/synthesis.html?method=fx-spectral');
  await expect(page.locator('#processorLatency')).toContainText('1024 samples');
  const rootFor = index => page.locator(`#processor-param-${index}`).locator('..');
  for (const [mode, visible] of [[0, []], [1, [1,2,3]], [2, []], [3, [3,4]]]) {
    await choose(page, 'processor-param-0', String(mode));
    for (let index = 1; index <= 4; index++) {
      if (visible.includes(index)) await expect(rootFor(index)).toBeVisible();
      else await expect(rootFor(index)).toBeHidden();
    }
  }
  expect((await status(page)).armed).toBe(false);
  await choose(page, 'processor-param-0', '0');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  for (const id of ['pink-noise', 'brown-noise', 'gaussian-noise']) {
    await choose(page, 'processingSource', id);
    const measure = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 50 });
    expect(measure.summary.finite).toBe(true); expect(measure.summary.maxRms).toBeGreaterThan(.001);
    expect((await status(page)).input.selection).toBe(id);
  }
});

for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) test(`source and processor controls remain compact at ${viewport.width}×${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport); await page.goto('/synthesis.html?method=fx-compressor');
  await expect(page.locator('#processorDetail')).toBeVisible();
  await expect(page.locator('#inputCategory')).toHaveValue('signals');
  const input = await page.locator('#inputBar').boundingBox(), processor = await page.locator('#processorPanel').boundingBox();
  expect(input.y).toBeLessThan(processor.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.synthesis-shell select optgroup')).toHaveCount(0);
  await exact(page, '#processor-param-0-value', -30);
  expect((await state(page)).presetId).toBe('custom');
  await choose(page, 'processingSource', 'file');
  await expect(page.locator('.mz-input-file')).toBeVisible();
  await expect(page.locator('#frequencyRow')).toBeHidden();
  expect(await page.evaluate(() => [...document.querySelectorAll('[id]')].map(e => e.id).filter((id,i,a) => a.indexOf(id) !== i))).toEqual([]);
});
