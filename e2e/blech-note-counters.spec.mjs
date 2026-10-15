import { test, expect } from '@playwright/test';
import { generateGridMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';

const score = () => generateGridMidi(Array.from({ length: 32 }, (_, row) =>
  Array.from({ length: 16 }, (_, column) => column === row % 16)), { secondsPerRow: .25 });
const count = async (page, id) => Number((await page.locator(`#${id}`).textContent()).replace(/\D/g, ''));
async function open(page) {
  await page.addInitScript(() => { globalThis.__counterQA = {}; });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst observeCounter=MidiMixerEngine.prototype.setVolume;MidiMixerEngine.prototype.setVolume=function(...args){globalThis.__counterQA.engine=this;return observeCounter.apply(this,args);};` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#blechDropSend')).toBeAttached();
}

for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
  test(`note counts stay above the visualizer at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await open(page);
    await expect(page.locator('#blechNoteCounters')).toBeInViewport();
    const [counter, stage] = await Promise.all([page.locator('#blechNoteCounters').boundingBox(), page.locator('#blackMidiViewport').boundingBox()]);
    expect(counter.y + counter.height).toBeLessThanOrEqual(stage.y);
    expect(stage.height).toBeGreaterThan(100);
    await page.locator('#blechTab-text').click();
    await expect(page.locator('#blechNoteCounters')).toBeInViewport();
    await expect(page.locator('#blechGeneratedNotes')).toHaveText('0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('file counter advances above the stage, freezes on pause, follows seeks and keeps the complete total', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.locator('#blackMidiFile').setInputFiles({ name: 'counter.mid', mimeType: 'audio/midi', buffer: Buffer.from(score().buffer) });
  await expect(page.locator('#blechFileTotal')).toHaveText('32');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  await expect(page.locator('#blackPlayButton')).toBeEnabled();
  await page.locator('#blackPlayButton').click();
  await expect.poll(() => count(page, 'blechFileNotes')).toBeGreaterThan(2);
  await page.locator('#blackPlayButton').click();
  await page.waitForTimeout(200);
  const paused = await count(page, 'blechFileNotes');
  await page.waitForTimeout(300); expect(await count(page, 'blechFileNotes')).toBe(paused);
  await page.locator('#blackSongPosition').evaluate(node => { node.value = '4'; node.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(() => count(page, 'blechFileNotes')).toBe(17);
  await page.locator('#blackStopButton').click();
  await expect.poll(() => count(page, 'blechFileNotes')).toBe(1); // Attack at score time zero.
  await expect(page.locator('#blechFileTotal')).toHaveText('32');
  await page.locator('#blechTab-visuals').click();
  await page.locator('[data-tracks]').locator('..').locator('summary').click();
  await page.locator('[data-tracks] input[type="checkbox"]').first().uncheck();
  await expect(page.locator('#blechFileTotal')).toHaveText('32');
  expect(errors).toEqual([]);
});

test('generated count ignores pending forecasts, survives stops and resets without stopping a loop', async ({ page }) => {
  await open(page);
  await page.locator('#blechTab-math').click();
  await page.locator('#blechDropDelay').evaluate(node => { node.value = '2'; node.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#blechDropSend').click();
  await expect(page.locator('#blechGeneratedNotes')).toHaveText('0');
  await expect.poll(() => count(page, 'blechGeneratedNotes'), { timeout: 5000 }).toBeGreaterThan(0);
  await page.locator('#creativeStop').click();
  const stopped = await count(page, 'blechGeneratedNotes');
  await page.waitForTimeout(250); expect(await count(page, 'blechGeneratedNotes')).toBe(stopped);
  await page.locator('#blechResetNoteCount').click();
  await expect(page.locator('#blechGeneratedNotes')).toHaveText('0');
  await page.evaluate(async () => {
    const { generateGridMidi } = await import('/src/instruments/midiphoria/midiphoria-text-midi.js');
    __counterQA.engine.triggerSample(generateGridMidi([[true], [false], [true]], { secondsPerRow: .125 }).buffer, { loop: true });
  });
  await expect.poll(() => count(page, 'blechGeneratedNotes')).toBeGreaterThan(2);
  await page.locator('#blechResetNoteCount').click();
  expect(await page.evaluate(() => __counterQA.engine.state.samples.length)).toBe(1);
  await expect.poll(() => count(page, 'blechGeneratedNotes')).toBeGreaterThan(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});
