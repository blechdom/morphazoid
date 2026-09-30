import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

test('dry material presets remain audible and bounded through live changes', async ({page},testInfo) => {
  await page.goto('domino-run.html');await page.waitForFunction(()=>window.dominoRun);
  expect(await page.evaluate(()=>window.dominoRun.audio.armed)).toBe(false);
  await page.locator('#audioButton').click();await page.locator('#playButton').click();
  const evidence=[];
  for(const id of ['tone-henge','classic-plastic','ceramic-clatter','stone-thuds']){
    await page.locator('.header-preset-picker summary').click();
    await page.locator(`#header-preset-panel button[data-preset-id="${id}"]`).click();
    expect(await page.evaluate(()=>window.dominoRun.playing)).toBe(true);
    expect(await page.evaluate(()=>window.dominoRun.snapshot.params.ring)).toBeLessThanOrEqual(.16);
    const envelope=await sampleAudioEnvelope(page,{durationMs:900,intervalMs:40});
    expect(envelope.summary.finite).toBe(true);expect(envelope.summary.maxPeak).toBeGreaterThan(.001);expect(envelope.summary.clippedSamples).toBe(0);
    evidence.push({preset:id,summary:envelope.summary});
  }
  await page.locator('#ring').focus();await page.keyboard.press('Home');
  expect(await page.evaluate(()=>window.dominoRun.snapshot.params.ring)).toBe(0);
  expect(await page.evaluate(()=>window.dominoRun.audio.dropped)).toBe(0);
  await testInfo.attach('dry-materials-live.json',{body:JSON.stringify(evidence),contentType:'application/json'});
});
