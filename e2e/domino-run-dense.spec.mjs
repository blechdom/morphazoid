import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

test('512 mixed dominoes complete audibly without queue loss or clipping', async ({ page }, testInfo) => {
  await page.goto('domino-run.html');
  await page.waitForFunction(() => Boolean(window.dominoRun));
  await page.locator('.header-preset-picker summary').click();
  await page.locator('#header-preset-panel button[data-preset-id="material-tapestry"]').click();
  for (const [id, value] of [['count', 512], ['speed', 2.4]]) {
    await page.locator(`#${id}`).evaluate((el, v) => { el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true})); },value);
    await page.waitForTimeout(100);
  }
  await page.locator('#loop').uncheck();
  const expected = await page.evaluate(() => window.dominoRun.timeline.events.length);
  expect(await page.evaluate(() => window.dominoRun.timeline.falls.length)).toBe(512);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  await page.locator('#playButton').click();
  const envelope=await sampleAudioEnvelope(page,{durationMs:2500,intervalMs:80});
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  await expect.poll(()=>page.evaluate(()=>window.dominoRun.audio.played),{timeout:20000}).toBe(expected);
  const status=await page.evaluate(()=>window.dominoRun.audio);
  expect(status.dropped).toBe(0);expect(status.active).toBeLessThanOrEqual(96);
  await testInfo.attach('dense-field-audio.json',{body:JSON.stringify({expected,status,envelope:envelope.summary}),contentType:'application/json'});
  await page.locator('#audioButton').click();
});
