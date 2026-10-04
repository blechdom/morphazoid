import { test, expect } from '@playwright/test';
import { INSTRUMENT_PRESETS } from '../src/instruments/synthesis/instrument-presets.js';
import { choose } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());

async function sounding(page, label, { continuous = false } = {}) {
  const measured = await sampleAudioEnvelope(page, { durationMs: 950, intervalMs: 50 });
  expect(measured.summary.finite, label).toBe(true);
  expect(measured.summary.maxRms, label).toBeGreaterThan(.0001);
  expect(measured.summary.maxPeak, label).toBeLessThanOrEqual(1);
  // The first test-signal preset must supply new audio, not merely inherit the
  // previous synth's meter sample or release tail during the handoff.
  if (continuous) {
    expect(Math.max(...measured.samples.slice(-4).map(sample => sample.rms)), label).toBeGreaterThan(.001);
  }
  expect(await status(page)).toMatchObject({ armed: true, playing: true });
}

test('Next sounds every whole-instrument preset across synth and test-signal routes without restarting Play', async ({ page }) => {
  test.setTimeout(100_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  // Include wrapping from the final processor back to the first synth score.
  for (const preset of [...INSTRUMENT_PRESETS, INSTRUMENT_PRESETS[0]]) {
    await page.locator('#nextPerformancePreset').click();
    await expect(page.locator('#performancePresetHost .instrument-picker-current')).toHaveText(preset.label);
    await sounding(page, preset.label, { continuous: preset.snapshot.sound.methodId === 'fx-biquad' });
  }
  expect(errors).toEqual([]);
});

test('whole-instrument dice and local Next/dice remain audible after a test-signal preset', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    let seed = 214;
    Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  });
  await page.goto('/synthesis.html?method=fx-biquad');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  for (let index = 0; index < 12; index++) {
    await page.locator('#randomPerformance').click();
    await sounding(page, 'whole-instrument dice ' + index);
  }
  await choose(page, 'methodSelect', 'additive');
  await choose(page, 'sequenceSelect', 'rotating-euclidean-chords');
  for (const id of ['nextPreset', 'randomMethod', 'nextSequencePreset', 'randomSequencePreset']) {
    await page.locator('#' + id).click();
    await sounding(page, id);
  }
});

test('Next and dice preserve deliberately paused transport and never arm Audio', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/synthesis.html');
  for (const preset of INSTRUMENT_PRESETS) {
    await page.locator('#nextPerformancePreset').click();
    expect(await status(page), preset.label).toMatchObject({ armed: false, playing: false });
  }
  await page.locator('#randomPerformance').click();
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await page.locator('#nextPerformancePreset').click();
  await page.locator('#randomPerformance').click();
  expect(await status(page)).toMatchObject({ armed: true, playing: false });
  const paused = await sampleAudioEnvelope(page, { durationMs: 450 });
  expect(paused.summary.maxRms).toBeLessThan(.00001);
});
