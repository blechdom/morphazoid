import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const shortMidi = Buffer.from([
  77,84,104,100,0,0,0,6,0,0,0,1,0,96,
  77,84,114,107,0,0,0,27,
  0,255,81,3,7,161,32,
  0,144,60,100,96,128,60,0,0,144,64,100,96,128,64,0,0,255,47,0,
]);
async function open(page) {
  await page.addInitScript(() => {
    window.__midiContexts = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__midiContexts.push(this); } };
  });
  await page.goto('/midiphoria.html');
  await expect(page.locator('#songSelect option')).not.toHaveCount(0);
  await expect(page.locator('#notePads button')).toHaveCount(24);
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#playButton')).toBeEnabled({ timeout: 15000 });
}
async function range(page, id, value, event = 'input') {
  await page.locator(`#${id}`).evaluate((node, { value, event }) => {
    node.value = String(value); node.dispatchEvent(new Event(event, { bubbles: true }));
  }, { value, event });
}

test('SoundFont audio requires Audio; live visual edits and mute preserve playback', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.locator('#songSelect').selectOption('rock-theme-four');
  await expect(page.locator('#playButton')).toBeDisabled();
  expect(await page.evaluate(() => window.__midiContexts.length)).toBe(0);
  await arm(page);
  expect((await readAudioStatus(page)).peak).toBe(0);
  await page.locator('#playButton').click();
  const sound = await sampleAudioEnvelope(page, { durationMs: 700 });
  expect(sound.summary.finite).toBe(true);
  expect(sound.summary.maxRms).toBeGreaterThan(.001);
  expect(sound.summary.clippedSamples).toBe(0);
  await expect.poll(async () => await page.locator('#noteReadout').textContent()).not.toBe('Waiting for a note');
  await range(page, 'attack', .1); await page.locator('#hueMode').selectOption('rotate');
  await page.locator('#viewMode').selectOption('mask');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#audioButton').click();
  const before = Number(await page.locator('#songPosition').inputValue());
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(before + .3);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  expect(await page.evaluate(() => window.__midiContexts.length)).toBe(1);
  await page.locator('#playButton').click();
  const paused = await page.locator('#songPosition').inputValue();
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  expect(await page.locator('#songPosition').inputValue()).toBe(paused);
  await page.locator('#stopButton').click();
  await expect(page.locator('#songPosition')).toHaveValue('0');
  expect(errors).toEqual([]);
});

test('local MIDI library, loop, seek and rate work without uploads or stuck notes', async ({ page }) => {
  await open(page);
  await page.locator('#midiFile').setInputFiles([
    { name: 'One.mid', mimeType: 'audio/midi', buffer: shortMidi },
    { name: 'Two.mid', mimeType: 'audio/midi', buffer: shortMidi },
  ]);
  await expect(page.locator('#songSelect')).toHaveValue('local-1');
  await expect(page.locator('#songSelect option[value^="local-"]')).toHaveCount(2);
  await expect(page.locator('#songCredit')).toContainText('Local MIDI');
  await arm(page);
  await page.locator('#loopSong').check(); await range(page, 'playbackRate', 4);
  await page.locator('#playButton').click();
  await page.waitForTimeout(1800);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  await page.locator('#loopSong').uncheck();
  await range(page, 'songPosition', .8, 'change');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
  await page.locator('#songSelect').selectOption('local-2');
  await expect(page.locator('#songPosition')).toHaveValue('0');
  await expect(page.locator('#playbackRate')).toHaveValue('4');
});

test('bad input reports an error, subsequent songs recover, pagehide closes audio', async ({ page }) => {
  await open(page); await arm(page);
  await page.locator('#midiFile').setInputFiles({ name: 'Broken.mid', mimeType: 'audio/midi', buffer: Buffer.from('not midi') });
  await expect(page.locator('#playerStatus')).toContainText('Standard MIDI');
  await expect(page.locator('#playButton')).toBeDisabled();
  await page.locator('#songSelect').selectOption('rock-theme-four');
  await expect(page.locator('#playButton')).toBeEnabled();
  await page.locator('#playButton').click();
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(await page.evaluate(() => window.__midiContexts.every(context => context.state === 'closed'))).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toBeDisabled();
});

test('full volume lifts a fixed arrangement while zero volume preserves transport', async ({ page }) => {
  await open(page);
  await page.locator('#songSelect').selectOption('electric-postcard');
  await arm(page);
  await range(page, 'outputLevel', 1);
  await range(page, 'songPosition', 8, 'change');
  await page.locator('#playButton').click();
  const sound = await sampleAudioEnvelope(page, { durationMs: 1800, intervalMs: 40 });
  // This fixed score passage measured about .023 RMS before the output boost.
  // Allow browser scheduling variation while rejecting the former quiet mix.
  expect(sound.summary.meanRms).toBeGreaterThan(.08);
  expect(sound.summary.finite).toBe(true);
  expect(sound.summary.maxPeak).toBeLessThanOrEqual(.981);
  expect(sound.summary.clippedSamples).toBe(0);
  await range(page, 'outputLevel', 0);
  const position = Number(await page.locator('#songPosition').inputValue());
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(position + .2);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await range(page, 'outputLevel', 1);
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.08);
});

test('song search filters titles and artists without replacing the playing file', async ({ page }) => {
  await open(page);
  await page.locator('#songSelect').selectOption('rock-theme-four');
  await arm(page);
  await page.locator('#playButton').click();
  const position = Number(await page.locator('#songPosition').inputValue());
  await page.locator('#songSearch').fill('Depeche');
  await expect(page.locator('#songSelect option')).not.toHaveCount(0);
  expect(await page.locator('#songSelect option').allTextContents()).toEqual(
    expect.arrayContaining([expect.stringContaining('Depeche Mode')]),
  );
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#songCredit')).toContainText('Rock Theme Four');
  await page.locator('#songSearch').fill('no matching arrangement 987654');
  await expect(page.locator('#songSelect')).toBeDisabled();
  await expect(page.locator('#songSearchStatus')).toContainText('No matching songs');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#songSearch').fill('');
  await expect(page.locator('#songSelect')).toHaveValue('rock-theme-four');
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(position + .2);
});

test('every bundled arrangement plays finite audio; the dense study stays bounded', async ({ page }) => {
  test.setTimeout(240000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await expect(page.locator('#genreSelect')).toHaveCount(0);
  const songs = await page.evaluate(() => fetch('/assets/midiphoria/collection.json').then(response => response.json()));
  expect(songs.filter(song => song.webArrangement).length).toBeGreaterThanOrEqual(40);
  await arm(page);
  for (const song of songs) {
    await page.locator('#songSelect').selectOption(song.id);
    await expect(page.locator('#playButton')).toBeEnabled();
    await page.locator('#loopSong').setChecked(song.kind === 'pattern');
    await range(page, 'songPosition', song.smokeSeekSeconds ?? Math.min(8, song.durationSeconds / 2), 'change');
    await range(page, 'outputLevel', 1);
    await page.locator('#playButton').click();
    const sample = await sampleAudioEnvelope(page, { durationMs: 800, intervalMs: 40 });
    expect(sample.summary.finite, song.title).toBe(true);
    expect(sample.summary.maxRms, song.title).toBeGreaterThan(.0001);
    expect(sample.summary.maxPeak, song.title).toBeLessThanOrEqual(.981);
    expect(sample.summary.clippedSamples, song.title).toBe(0);
    await page.locator('#stopButton').click();
  }
  expect(errors).toEqual([]);
});

test('collection filtering preserves playback and local imports remain reachable', async ({ page }) => {
  await open(page);
  await page.locator('#songSelect').selectOption('rock-theme-four');
  await arm(page); await page.locator('#playButton').click();
  await page.locator('#collectionSelect').selectOption('Geometric patterns');
  await expect(page.locator('#songSelect option')).toHaveCount(9);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#songSelect')).toHaveValue('');
  await page.locator('#songSearch').fill('funnel');
  expect((await page.locator('#songSelect option').allTextContents()).every(text => /Funnel/i.test(text))).toBe(true);
  await page.locator('#midiFile').setInputFiles({ name: 'Collection test.mid', mimeType: 'audio/midi', buffer: shortMidi });
  await expect(page.locator('#collectionSelect')).toHaveValue('');
  await expect(page.locator('#songSelect')).toHaveValue('local-1');
  await expect(page.locator('#songSelect optgroup[label="Your MIDIs"] option')).toHaveCount(1);
  await page.locator('#collectionSelect').selectOption('Black MIDI');
  await expect(page.locator('#songSelect option')).toHaveCount(16);
});

test('black MIDI peak passages at 4× stay audible and controllable with maximum radial copies and all reflection axes', async ({ page }) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await arm(page);
  const songs = await page.evaluate(() => fetch('/assets/midiphoria/collection.json').then(response => response.json()));
  const dense = songs.filter(song => song.collection === 'Black MIDI')
    .sort((a, b) => b.peakNotesPerSecond - a.peakNotesPerSecond).slice(0, 3);
  expect(dense).toHaveLength(3);
  await page.locator('#viewMode').selectOption('radial');
  await range(page, 'symmetry', 8); await range(page, 'outputLevel', 1);
  await page.locator('#reflection').selectOption('all');
  await page.locator('#flow').selectOption('inward');
  await range(page, 'playbackRate', 4);
  await expect(page.locator('#playbackRateOut')).toHaveText('4.00×');
  for (const song of dense) {
    await page.locator('#songSelect').selectOption(song.id);
    await expect(page.locator('#playButton')).toBeEnabled();
    await range(page, 'songPosition', Math.max(0, song.densestSecond - 1), 'change');
    await page.locator('#playButton').click();
    const before = Number(await page.locator('#songPosition').inputValue());
    const sample = await sampleAudioEnvelope(page, { durationMs: 3000, intervalMs: 40 });
    expect(sample.summary.finite, song.title).toBe(true);
    expect(sample.summary.maxRms, song.title).toBeGreaterThan(.01);
    expect(sample.summary.maxPeak, song.title).toBeLessThanOrEqual(.981);
    expect(sample.summary.clippedSamples, song.title).toBe(0);
    expect(Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(before + 8);
    await page.locator('#colorSource').selectOption('velocity', { timeout: 5000 });
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#stopButton').click({ timeout: 5000 });
    await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  }
  expect(errors).toEqual([]);
});
