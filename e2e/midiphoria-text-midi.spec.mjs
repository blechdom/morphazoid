import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { generateTextMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { installFakeMidi, enableFakeMidi } from './helpers/fake-midi.mjs';

async function open(page) {
  await page.addInitScript(() => {
    window.__textMidiContexts = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); window.__textMidiContexts.push(this); }
    };
  });
  await page.goto('/midiphoria.html');
  await expect(page.locator('#songCount')).toHaveText('100 MIDIs');
}

async function generate(page, text) {
  await page.locator('#textMidiInput').fill(text);
  await page.locator('#generateTextMidi').click();
  await expect(page.locator('#songSelect')).toHaveValue('text-midi');
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'letters');
}

test('typing generates the actual downloadable letter MIDI without arming audio or firing piano keys', async ({ page }) => {
  await installFakeMidi(page); await open(page); await enableFakeMidi(page, { computerKeyboard: true });
  await page.locator('#textMidiInput').pressSequentially('hello!');
  await expect(page.locator('#noteReadout')).toHaveText('Waiting for a note');
  await page.locator('#textMidiInput').press('Enter');
  await expect(page.locator('#songSelect')).toHaveValue('text-midi');
  await expect(page.locator('#visualCanvas')).toHaveAttribute('aria-label', /HELLO!/);
  expect(await page.evaluate(() => window.__textMidiContexts.length)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  const waiting = page.waitForEvent('download');
  await page.locator('#downloadTextMidi').click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('text-HELLO.mid');
  expect(await readFile(await download.path())).toEqual(Buffer.from(generateTextMidi('HELLO!').buffer));
  await page.locator('#textMidiInput').fill('😃');
  await page.locator('#generateTextMidi').click();
  await expect(page.locator('#textMidiStatus')).toContainText('Type letters');
  await expect(page.locator('#songSelect')).toHaveValue('text-midi');
  await expect(page.locator('#downloadTextMidi')).toBeVisible();
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent('pagehide'));
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#songCount')).toHaveText('100 MIDIs');
  await expect(page.locator('#songSelect option[value="text-midi"]')).toHaveCount(0);
  await expect(page.locator('#downloadTextMidi')).toBeHidden();
  await expect(page.locator('#downloadTextMidi')).not.toHaveAttribute('href');
});

test('generated MIDI sounds, retains playback on regeneration, and stays selected through presets', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await generate(page, 'HELLO MORPHAZOID');
  await page.locator('#loopSong').check();
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioState')).toHaveText('on', { timeout: 20000 });
  await expect(page.locator('#playButton')).toBeEnabled();
  expect(Number(await page.locator('#songPosition').getAttribute('max')))
    .toBeCloseTo(generateTextMidi('HELLO MORPHAZOID').duration, 8);
  const still = await page.locator('#visualCanvas').evaluate(canvas => canvas.toDataURL());
  await page.locator('#playButton').click();
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(.3);
  const audio = await sampleAudioEnvelope(page, { durationMs: 700 });
  expect(audio.summary.finite).toBe(true);
  expect(audio.summary.maxRms).toBeGreaterThan(.002);
  expect(audio.summary.clippedSamples).toBe(0);
  expect(await page.locator('#visualCanvas').evaluate(canvas => canvas.toDataURL())).not.toBe(still);
  await generate(page, 'JAZZ ROBOT');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#songCount')).toHaveText('101 MIDIs');
  await expect(page.locator('#songSelect option[value="text-midi"]')).toHaveCount(1);
  await page.locator('.header-preset-next').click();
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'lights');
  await expect(page.locator('#songSelect')).toHaveValue('text-midi');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#showTextScore').check();
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'letters');
  await page.locator('#songSelect').selectOption('rock-theme-four');
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'lights');
  await expect(page.locator('#textScoreView')).toBeHidden();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#songSelect').selectOption('text-midi');
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'letters');
  await page.locator('#stopButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  // The SoundFont's existing reverb is allowed to finish after voices stop.
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 5000 }).toBeLessThan(.001);
  expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeLessThan(.001);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`letter score and text controls remain readable at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await open(page); await generate(page, 'MIDI');
    await expect(page.locator('#textMidiStatus')).toHaveText('');
    for (const selector of ['#textMidiInput', '#generateTextMidi', '#downloadTextMidi', '#showTextScore']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await expect(page.locator(selector)).toBeVisible();
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.locator('h1').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('text-midi.png') });
    await page.locator('#visualCanvas').screenshot({ path: testInfo.outputPath('letter-score.png') });
  });
}
