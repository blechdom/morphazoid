import { test, expect } from '@playwright/test';
import { choose, exact } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope, readAudioStatus } from './helpers/audio-probe.mjs';

const sequence = page => page.evaluate(() => window.MorphazoidSynthesis.getSequenceState());
const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
async function ready(page) {
  await page.goto('/synthesis.html?method=fm&sequence=keyboard-range-arpeggio');
  await page.waitForFunction(() => window.MorphazoidSynthesis);
}
async function assertCompleteSweep(page) {
  const frequencies = await page.evaluate(() => {
    const api = window.MorphazoidSynthesis;
    return api.getSequenceState().cycle.steps.flatMap(step => step.notes.map(note => note.ratio * api.getState().frequencyHz));
  });
  expect(frequencies).toHaveLength(46);
  expect(Math.min(...frequencies)).toBeGreaterThanOrEqual(20);
  expect(Math.max(...frequencies)).toBeLessThanOrEqual(8000);
  expect(Math.max(...frequencies) / Math.min(...frequencies)).toBeGreaterThan(128);
  for (let i = 1; i < 24; i++) expect(frequencies[i]).toBeGreaterThan(frequencies[i - 1]);
  for (let i = 24; i < 46; i++) expect(frequencies[i]).toBeLessThan(frequencies[i - 1]);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`complete keyboard sweep controls and output fit ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport); await ready(page);
    await expect(page.locator('#sequence-param-fullTraversal')).toBeChecked();
    expect((await sequence(page)).cycle.steps).toHaveLength(16);
    await expect(page.locator('#sequence-param-steps')).toBeHidden();
    await expect(page.locator('#sequenceStrip')).toBeVisible();
    await exact(page, '#sequence-param-octaves-value', 8);
    await assertCompleteSweep(page);
    await page.locator('#sequenceSurface').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('keyboard-range.png') });
    await exact(page, '#frequencyHz', 1021);
    await assertCompleteSweep(page);
    // Cropping is deliberate when the policy is off, and the hidden control
    // becomes editable again. Returning to complete mode restores the journey.
    await page.locator('#sequence-param-fullTraversal').uncheck();
    await expect(page.locator('#sequence-param-steps')).toBeVisible();
    await assertCompleteSweep(page);
    await exact(page, '#sequence-param-steps-value', 12);
    expect((await sequence(page)).cycle.steps).toHaveLength(12);
    await page.locator('#sequence-param-fullTraversal').check();
    await exact(page, '#sequence-param-octaves-value', 8);
    await assertCompleteSweep(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await status(page)).toMatchObject({ armed: false, playing: false });
    expect(errors).toEqual([]);
  });
}

test('wide presets and live range edits retain sample-clock playback and a single output', async ({ page }) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await page.locator('#playButton').click();
  expect(await status(page)).toMatchObject({ armed: false, playing: true });
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).sequence.audio.playing).toBe(true);
  const presets = [
    ['original', 3, 'pendulum', 16], ['spacious', 1, 'inside-out', 3],
    ['sparse', 5, 'down', 15], ['tight', 7, 'up', 21],
    ['dense', 8, 'pendulum', 46], ['wild', 8, 'outside-in', 24],
  ];
  for (const [id, octaves, order, steps] of presets) {
    await choose(page, 'sequencePresetSelect', id);
    const selected = await sequence(page);
    expect(selected.parameters).toMatchObject({ octaves, order, fullTraversal: true });
    expect(selected.cycle.steps).toHaveLength(steps);
    expect(await status(page)).toMatchObject({ armed: true, playing: true });
    const audio = await sampleAudioEnvelope(page, { durationMs: 650 });
    expect(audio.summary.finite).toBe(true); expect(audio.summary.clippedSamples).toBe(0);
    expect(audio.summary.maxRms).toBeGreaterThan(.00001);
  }
  await choose(page, 'sequencePresetSelect', 'dense');
  const before = (await status(page)).sequence.transportBeat;
  await exact(page, '#sequence-param-octaves-value', 7);
  await choose(page, 'sequence-param-order', 'down');
  await expect.poll(async () => (await status(page)).sequence.transportBeat).toBeGreaterThan(before);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  await page.locator('#playButton').click();
  expect(await status(page)).toMatchObject({ armed: true, playing: false });
  expect(errors).toEqual([]);
});
