import { test, expect } from '@playwright/test';
import { INSTRUMENT_PRESETS, SAMPLE_INSTRUMENT_PRESETS } from '../src/instruments/synthesis/instrument-presets.js';
import { sampleAudioEnvelope, readAudioStatus, waitForStableAudioState } from './helpers/audio-probe.mjs';

const state = page => page.evaluate(() => window.MorphazoidSynthesis.getState());
const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
async function recall(page, preset) {
  await page.locator('#performancePresetHost summary').click();
  await page.locator('#performancePresetHost').getByRole('button', { name: preset.label, exact: true }).click();
  await expect(page.locator('#performancePresetHost .instrument-picker-current')).toHaveText(preset.label);
}

test('mixed sample presets restore the recording and processor while retaining live playback and output', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.samplePresetDeviceRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.samplePresetDeviceRequests++; throw new Error('Unexpected device request'); };
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html');
  await page.locator('#outputLevel').evaluate(node => { node.value = '.7'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await recall(page, SAMPLE_INSTRUMENT_PRESETS[0]);
  await page.locator('#playButton').click();
  expect(await status(page)).toMatchObject({ armed: false, playing: true, input: { kind: 'none' } });
  await page.locator('#audioButton').click();
  const measurements = [];
  for (const preset of SAMPLE_INSTRUMENT_PRESETS) {
    await recall(page, preset);
    await expect.poll(() => status(page), { timeout: 15_000 }).toMatchObject({
      armed: true, playing: true, section: 'processing',
      input: { selection: preset.snapshot.routing.selection, source: 0, kind: 'file', loading: false },
    });
    const recalled = await state(page);
    expect(recalled.outputLevel).toBe(.7);
    expect(recalled.methodId).toBe(preset.snapshot.sound.methodId);
    expect(recalled.routing).toEqual(preset.snapshot.routing);
    await expect(page.locator('#processingSource')).toHaveValue(preset.snapshot.routing.selection);
    await expect(page.locator('#processingBypass')).not.toBeChecked();
    // The 5.48 s field recording includes a quiet lead-in and its main song at
    // 2–4 s. Cover its full loop rather than measuring only background sound.
    const measured = await sampleAudioEnvelope(page, {
      durationMs: preset.snapshot.routing.selection === 'birdsong' ? 6000 : 1700,
    });
    measurements.push({ id: preset.id, ...measured.summary });
    expect(measured.summary.finite, preset.id).toBe(true);
    expect(measured.summary.maxRms, preset.id).toBeGreaterThan(.01);
    expect(measured.summary.maxPeak, preset.id).toBeLessThan(1);
    expect(measured.summary.clippedSamples, preset.id).toBe(0);
    expect((await readAudioStatus(page)).connectionCount).toBe(1);
    await expect(page.locator('#audioError')).toBeHidden();
  }
  // Next leaves a sample scene through the normal mixed bank, then another
  // sample recall restores the external input without stopping transport.
  const last = SAMPLE_INSTRUMENT_PRESETS.at(-1);
  const next = INSTRUMENT_PRESETS[(INSTRUMENT_PRESETS.indexOf(last) + 1) % INSTRUMENT_PRESETS.length];
  await page.locator('#nextPerformancePreset').click();
  await expect(page.locator('#performancePresetHost .instrument-picker-current')).toHaveText(next.label);
  expect(await status(page)).toMatchObject({ armed: true, playing: true });
  await recall(page, SAMPLE_INSTRUMENT_PRESETS[0]);
  await expect.poll(() => status(page)).toMatchObject({ input: { selection: 'sample-drums', loading: false, kind: 'file' } });
  await page.locator('#playButton').click();
  await waitForStableAudioState(page, false, { timeout: 6000 });
  await recall(page, SAMPLE_INSTRUMENT_PRESETS[4]);
  expect(await status(page)).toMatchObject({ armed: true, playing: false });
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeLessThan(.00001);
  expect(await page.evaluate(() => window.samplePresetDeviceRequests)).toBe(0);
  expect(errors).toEqual([]);
  await testInfo.attach('sample-preset-levels.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`sample presets remain reachable and silent with Audio off at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/synthesis.html');
    for (const preset of [SAMPLE_INSTRUMENT_PRESETS[0], SAMPLE_INSTRUMENT_PRESETS.at(-1)]) {
      await recall(page, preset);
      await expect(page.locator('#playButton')).toBeVisible();
      await expect(page.locator('#processingSource')).toHaveValue(preset.snapshot.routing.selection);
      expect((await state(page)).routing).toEqual(preset.snapshot.routing);
    }
    await page.locator('#playButton').click();
    expect(await status(page)).toMatchObject({ armed: false, playing: true, input: { kind: 'none' } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
