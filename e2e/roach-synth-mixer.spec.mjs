import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

test.setTimeout(90000);
const state = page => page.evaluate(() => window.roachSynth.getState());
async function open(page) {
  await page.goto('roach-synth.html');
  await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 60000 });
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
}

test('mixer solo, mute, presets and master preserve faders, animation and explicit Audio', async ({ page }, testInfo) => {
  await open(page);
  await expect(page.locator('[data-channel]')).toHaveCount(9);
  await page.locator('[data-solo="feet"]').click();
  expect((await state(page)).audio.contextState).toBe('uninitialized');
  await page.locator('#motionButton').click(); await arm(page);
  await expect.poll(async () => (await state(page)).audio.samplesLoaded).toBe(3);
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.005);
  await page.locator('#feet').fill('0.63');
  await page.locator('[data-mute="feet"]').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  await expect(page.locator('#feet')).toHaveValue('0.63');
  expect((await state(page)).playing).toBe(true);
  await page.locator('#level').fill('0.7');
  await page.locator('#soundPreset').selectOption('under-fridge');
  expect((await state(page)).mix).toMatchObject({ muted: ['feet'], solo: ['feet'] });
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  await page.locator('#resetMix').click();
  expect((await state(page)).mix).toMatchObject({ muted: [], solo: [] });
  expect((await state(page)).sound.level).toBe(.7);
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.005);
  const report = await sampleAudioEnvelope(page, { durationMs: 600 });
  expect(report.summary.finite).toBe(true); expect(report.summary.clippedSamples).toBe(0);
  await testInfo.attach('roach-v5-mix.json', { body: JSON.stringify(report.summary), contentType: 'application/json' });
});

test('real recorded layer plays by itself and releases without stopping animation', async ({ page }) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('requestfailed', request => failures.push(request.url()));
  await open(page); await arm(page);
  await expect.poll(async () => (await state(page)).audio.samplesLoaded).toBe(3);
  await expect(page.locator('#sampleStatus')).toContainText('real cockroach movements');
  await page.locator('[data-solo="samples"]').click();
  await page.locator('#motionPreset').selectOption('side_run');
  await page.locator('#motionButton').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.003);
  const before = (await state(page)).time;
  await page.locator('[data-mute="samples"]').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  expect((await state(page)).time).toBeGreaterThan(before);
  expect(failures).toEqual([]);
});

test('missing animal assets leave synthesized sound, speech and explicit transport usable', async ({ page }) => {
  await page.route('**/assets/roach-synth/audio/*.wav', route => route.fulfill({ status: 503, body: '' }));
  await open(page); await arm(page);
  await expect(page.locator('#sampleStatus')).toContainText('Recording unavailable');
  await page.locator('#soundPlayButton').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.003);
  expect((await state(page)).time).toBe(0);
  await page.locator('#speakButton').click();
  await expect.poll(async () => (await state(page)).audio.speechEnvelope).toBeGreaterThan(.0001);
  expect((await state(page)).audioOn).toBe(true);
});
