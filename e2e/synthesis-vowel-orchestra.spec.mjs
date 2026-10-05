import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope, readAudioStatus } from './helpers/audio-probe.mjs';

test('Small vowel orchestra recalls its fuller patch without changing live output or transport', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const status = () => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
  const recall = async () => {
    await page.locator('#performancePresetHost summary').click();
    await page.locator('#performancePresetHost').getByRole('button', { name: 'Small vowel orchestra', exact: true }).click();
    await expect(page.locator('#performancePresetHost .instrument-picker-current')).toHaveText('Small vowel orchestra');
  };
  await page.goto('/synthesis.html');
  await page.locator('#outputLevel').evaluate(node => { node.value = '.37'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await recall();
  expect(await status()).toMatchObject({ armed: false, playing: false });
  await page.locator('#playButton').click();
  expect(await status()).toMatchObject({ armed: false, playing: true });
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status()).armed).toBe(true);
  for (let pass = 0; pass < 2; pass++) {
    const state = await page.evaluate(() => window.MorphazoidSynthesis.getState());
    expect(state.methodId).toBe('fof'); expect(state.frequencyHz).toBe(137);
    expect(state.outputLevel).toBe(.37);
    expect(await status()).toMatchObject({ armed: true, playing: true });
    const audio = await sampleAudioEnvelope(page, { durationMs: 1200 });
    expect(audio.summary.finite).toBe(true); expect(audio.summary.clippedSamples).toBe(0);
    expect(audio.summary.maxRms).toBeGreaterThan(.005);
    expect((await readAudioStatus(page)).connectionCount).toBe(1);
    if (!pass) { await page.locator('#nextPerformancePreset').click(); await recall(); }
  }
  await page.locator('#playButton').click();
  await page.waitForTimeout(2500);
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeLessThan(.00001);
  expect(await status()).toMatchObject({ armed: true, playing: false });
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioError')).toBeHidden();
  expect(errors).toEqual([]);
});
