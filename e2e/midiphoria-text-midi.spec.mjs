import { expect, test } from '@playwright/test';
import { selectedSong, songButton, selectSong } from './helpers/midiphoria-library.mjs';
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
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', 'text-midi');
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'letters');
}

test('typing generates the actual downloadable letter MIDI without arming audio or firing piano keys', async ({ page }) => {
  await installFakeMidi(page); await open(page); await enableFakeMidi(page, { computerKeyboard: true });
  await page.locator('#songSearch').fill('no matching arrangement 987654');
  await page.locator('#textMidiInput').pressSequentially('hello!');
  await expect(page.locator('#noteReadout')).toHaveText('Waiting for a note');
  await page.locator('#textMidiInput').press('Enter');
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', 'text-midi');
  await expect(page.locator('#visualCanvas')).toHaveAttribute('aria-label', /HELLO!/);
  await expect(page.locator('#songSearch')).toHaveValue('');
  await expect(page.locator('#currentSong')).toContainText('HELLO!');
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
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', 'text-midi');
  await expect(page.locator('#downloadTextMidi')).toBeVisible();
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent('pagehide'));
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#songCount')).toHaveText('100 MIDIs');
  await expect(songButton(page, 'text-midi')).toHaveCount(0);
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
  await expect(songButton(page, 'text-midi')).toHaveCount(1);
  await page.locator('.header-preset-next').click();
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'lights');
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', 'text-midi');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#showTextScore').check();
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'letters');
  await selectSong(page, 'rock-theme-four');
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'lights');
  await expect(page.locator('#textScoreView')).toBeHidden();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await selectSong(page, 'text-midi');
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'letters');
  await page.locator('#stopButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  // The SoundFont's existing reverb is allowed to finish after voices stop.
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 5000 }).toBeLessThan(.001);
  expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeLessThan(.001);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  expect(errors).toEqual([]);
});

test('Make MIDI auditions with Audio on, including after the previous text has ended', async ({ page }) => {
  await open(page);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioState')).toHaveText('on', { timeout: 20000 });
  await generate(page, 'HELLO MIDI');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  const first = await sampleAudioEnvelope(page, { durationMs: 400 });
  expect(first.summary.finite).toBe(true);
  expect(first.summary.maxRms).toBeGreaterThan(.002);
  expect(first.summary.clippedSamples).toBe(0);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 });
  await generate(page, 'ANOTHER WORD');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeGreaterThan(.002);

  await page.locator('#stopButton').click();
  await page.locator('#audioButton').click();
  await generate(page, 'SILENT PREVIEW');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeLessThan(.001);
});

test('one Audio click recovers browser suspension without restarting the MIDI', async ({ page }) => {
  await open(page);
  await generate(page, 'RECOVER AUDIO');
  await page.locator('#loopSong').check();
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioState')).toHaveText('on', { timeout: 20000 });
  await page.locator('#playButton').click();
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(.3);
  await page.evaluate(() => window.__textMidiContexts[0].suspend());
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  const time = Number(await page.locator('#songPosition').inputValue());
  expect((await sampleAudioEnvelope(page, { durationMs: 150 })).summary.maxRms).toBeLessThan(.001);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioState')).toHaveText('on');
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(time);
  const recovered = await sampleAudioEnvelope(page, { durationMs: 400 });
  expect(recovered.summary.finite).toBe(true);
  expect(recovered.summary.maxRms).toBeGreaterThan(.002);
  expect(recovered.summary.clippedSamples).toBe(0);
  expect(await page.evaluate(() => window.__textMidiContexts.length)).toBe(1);
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
