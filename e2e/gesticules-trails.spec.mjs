import { test, expect } from '@playwright/test';

const snapshot = page => page.evaluate(() => window.__gesticulatingHand.snapshot());
const range = (page, id, value) => page.locator('#' + id).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const chooseScene = async (page, label) => {
  await page.locator('.header-preset-picker summary').click();
  await page.getByRole('button', { name: label, exact: true }).click();
};
test.beforeEach(async ({ page }) => {
  page.gesticulesErrors = [];
  page.on('pageerror', error => page.gesticulesErrors.push(error.message));
  await page.goto('gesticules.html');
  await page.waitForFunction(() => window.__gesticulatingHand?.snapshot().loaded);
});
test.afterEach(async ({ page }) => expect(page.gesticulesErrors).toEqual([]));

for (const form of ['hand', 'foot']) test(`${form} trails share the echo control, visibly fade while paused, and release at zero`, async ({ page }) => {
  await page.locator('#bodyForm').selectOption(form);
  await page.waitForFunction(form => window.__gesticulatingHand.snapshot().viewer.form === form, form);
  await expect(page.getByRole('slider', { name: /^Trails/ })).toHaveCount(1);
  await range(page, 'space', 0);
  expect((await snapshot(page)).viewer.trails.resources).toBe(0);
  await expect(page.locator('#spaceOut')).toHaveText('Off');
  await page.locator('#motionButton').click();
  for (const amount of [.5, 1]) {
    await range(page, 'space', amount);
    await expect.poll(async () => (await snapshot(page)).viewer.trails.history).toBe(true);
    const state = await snapshot(page);
    expect(state.config.sound.space).toBe(amount);
    expect(state.viewer.trails.amount).toBe(amount);
    expect(state.viewer.trails.resources).toBe(2);
    expect(state.viewer.trails.size[0] * state.viewer.trails.size[1]).toBeLessThanOrEqual(300000);
    expect(state.audioOn).toBe(false);
    expect(state.audio.contextState).toBe('uninitialized');
    await page.waitForTimeout(250);
  }
  await page.locator('#motionButton').click();
  await page.waitForTimeout(80);
  const paused = await snapshot(page), fading = await page.locator('#handCanvas').screenshot();
  expect(paused.viewer.trails.tail).toBe(true);
  await expect.poll(async () => (await snapshot(page)).viewer.trails.tail, { timeout: 6000 }).toBe(false);
  await expect.poll(async () => (await snapshot(page)).viewer.trails.history).toBe(false);
  expect((await snapshot(page)).time).toBe(paused.time);
  expect((await page.locator('#handCanvas').screenshot()).equals(fading)).toBe(false);
  await range(page, 'space', 0);
  expect((await snapshot(page)).viewer.trails.resources).toBe(0);
});

test('Choir and Marimba scenes recall trails and remain mixable during armed playback', async ({ page }) => {
  await page.locator('#soundPlayButton').click();
  await page.locator('#motionButton').click();
  for (const [label, source, form] of [['Lingering choir', 'choir', 'hand'], ['Marimba footprints', 'marimba', 'foot']]) {
    await chooseScene(page, label);
    await page.waitForFunction(form => window.__gesticulatingHand.snapshot().viewer.form === form, form);
    const saved = await snapshot(page);
    expect(saved.audioOn).toBe(false);
    expect(saved.config.voices[2].source).toBe(source);
    expect(saved.config.form).toBe(form);
    expect(saved.viewer.trails.amount).toBe(saved.config.sound.space);
    await range(page, 'space', 0);
    await page.locator('#source-2').selectOption(source === 'choir' ? 'marimba' : 'choir');
    await chooseScene(page, label);
    const recalled = await snapshot(page);
    expect(recalled.config).toEqual(saved.config);
    expect(recalled.viewer.trails.amount).toBe(saved.config.sound.space);
    expect(recalled.playing).toBe(true); expect(recalled.soundPlaying).toBe(true);
  }
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.rms).toBeGreaterThan(.001);
  await page.locator('#source-0').selectOption('choir');
  await page.locator('#source-1').selectOption('marimba');
  await range(page, 'space', .67);
  await expect.poll(async () => (await snapshot(page)).viewer.trails.amount).toBe(.67);
  const running = await snapshot(page);
  expect(running.audioOn).toBe(true); expect(running.playing).toBe(true); expect(running.soundPlaying).toBe(true);
  expect(running.audio.peak).toBeLessThanOrEqual(1);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.rms).toBeLessThan(.001);
  expect((await snapshot(page)).playing).toBe(true);
});
