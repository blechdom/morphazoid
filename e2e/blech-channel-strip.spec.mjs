import { test, expect } from '@playwright/test';
import { generateGridMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { readAudioStatus } from './helpers/audio-probe.mjs';

async function open(page) {
  await page.addInitScript(() => { globalThis.__channelQA = {}; });
  await page.route('**/src/instruments/midiphoria/midiphoria-player.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst channelPublish=MidiphoriaPlayer.prototype._publish;MidiphoriaPlayer.prototype._publish=function(...args){__channelQA.player=this;return channelPublish.apply(this,args);};` });
  });
  await page.goto('/blech-midi.html');
  await expect.poll(() => page.locator('#blackSongSelect option').count()).toBeGreaterThan(100);
}
async function input(page, selector, value) {
  await page.locator(selector).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => __channelQA.player.state.audioEnabled)).toBe(true);
}
async function loadScore(page) {
  const score = generateGridMidi(Array.from({ length: 64 }, (_, row) => Array.from({ length: 24 }, (_, column) => column === row % 24)));
  await page.locator('#blackMidiFile').setInputFiles({ name: '120-bpm.mid', mimeType: 'audio/midi', buffer: Buffer.from(score.buffer) });
  await expect(page.locator('#blackFileTempo')).toHaveValue('120');
  await expect(page.locator('#blackSyncTempo')).toBeEnabled();
}
const rate = page => page.evaluate(() => __channelQA.player.state.rate);
const held = page => page.evaluate(() => [...__channelQA.player._padNotes.keys()]);
const keyPoint = (page, note, height = .8) => page.evaluate(async ({ note, height }) => {
  const { blackMidiKeyLayout } = await import('/src/instruments/blech-midi/blech-midi-black-renderer.js');
  const key = blackMidiKeyLayout()[note], box = document.querySelector('.blech-playable-keyboard').getBoundingClientRect();
  return { x: box.x + (key.x + key.width / 2) * box.width, y: box.y + box.height * height };
}, { note, height });

test('file channel links and unlinks tempo, applies exact fractions and preserves live playback', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await loadScore(page); await arm(page);
  await page.locator('#blackLoopSong').check(); await page.locator('#blackPlayButton').click();
  await page.locator('#blackSpeedRatio').selectOption('0.25');
  expect(await rate(page)).toBe(.25); await expect(page.locator('#blackTempoStatus')).toContainText('Independent · 30 BPM');
  await input(page, '#blackFileTempo', 80); expect(await rate(page)).toBeCloseTo(1 / 6);
  await input(page, '#creativeTempo', 240); expect(await rate(page)).toBeCloseTo(1 / 6);
  await page.locator('#blackSyncTempo').check(); expect(await rate(page)).toBe(.5);
  await expect(page.locator('#blackFileTempo')).toBeDisabled();
  await expect(page.locator('#blackTempoStatus')).toContainText('Linked · 60 BPM');
  await page.locator('#blackSpeedRatio').selectOption('0.125'); await input(page, '#creativeTempo', 30);
  expect(await rate(page)).toBe(.03125); await expect(page.locator('#blackTempoStatus')).not.toContainText('limited');
  await page.locator('#blackSyncTempo').uncheck(); await expect(page.locator('#blackFileTempo')).toHaveValue('80');
  await expect(page.locator('#blackTempoReference')).toHaveValue('80');
  await page.locator('#blackSpeedRatio').selectOption('0.3333333333333333'); expect(await rate(page)).toBeCloseTo(2 / 9, 9);
  await page.locator('#blackSyncTempo').check(); await input(page, '#creativeTempo', 300);
  await page.locator('#blackSpeedRatio').selectOption('8'); expect(await rate(page)).toBe(20);
  await expect(page.locator('#blackTempoStatus')).not.toContainText('limited');
  await input(page, '#creativeTempoExact', 4800);
  await expect(page.locator('#creativeTempo')).toHaveValue('4800');
  await expect(page.locator('#creativeTempoOut')).toHaveText('4800 BPM');
  await expect(page.locator('#blechFramesRate')).toHaveText('80 frames/s at 4800 BPM');
  await page.locator('#blackSpeedRatio').selectOption('1'); expect(await rate(page)).toBe(40);
  await expect(page.locator('#blackTempoStatus')).toContainText('Linked · 4800 BPM');
  await page.locator('#blackSpeedRatio').selectOption('64'); expect(await rate(page)).toBe(64);
  await expect(page.locator('#blackTempoStatus')).toContainText('rate limited to 0.01–64×');
  await page.locator('#blackSyncTempo').uncheck(); await page.locator('#blackSpeedRatio').selectOption('1');
  await input(page, '#blackFileTempo', 4800); expect(await rate(page)).toBe(40);
  await expect(page.locator('#blackTempoStatus')).toContainText('Independent · 4800 BPM');
  await page.locator('#blackOriginalTiming').click(); expect(await rate(page)).toBe(1);
  await expect(page.locator('#blackFileTempo')).toHaveValue('120');
  await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('hover keyboard makes real piano audio only after Audio is armed and releases cleanly', async ({ page }) => {
  await open(page);
  const first = await keyPoint(page, 60); await page.mouse.move(first.x, first.y);
  expect(await held(page)).toEqual([]); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await arm(page);
  for (const [note, y] of [[60, .8], [61, .2], [64, .8]]) {
    const point = await keyPoint(page, note, y); await page.mouse.move(point.x, point.y);
    await expect.poll(() => held(page)).toEqual([note]);
    await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.0001);
  }
  await page.mouse.move(first.x, first.y - 80); await expect.poll(() => held(page)).toEqual([]);
  await page.mouse.move(first.x, first.y);
  await page.locator('#creativeStop').dispatchEvent('click'); await expect.poll(() => held(page)).toEqual([]);
  await page.mouse.move(first.x + 1, first.y); await expect.poll(() => held(page)).toEqual([60]);
  await page.locator('#audioButton').dispatchEvent('click'); await expect.poll(() => held(page)).toEqual([]);
  await page.mouse.move(first.x + 2, first.y); expect(await held(page)).toEqual([]);
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
});

test('timecode MIDI exposes speed ratios without inventing a musical tempo', async ({ page }) => {
  await open(page);
  const score = generateGridMidi([[true, false], [false, true]]), bytes = new Uint8Array(score.buffer);
  bytes[12] = 0xe7; bytes[13] = 40; // SMPTE: 25 frames/second, 40 ticks/frame.
  await page.locator('#blackMidiFile').setInputFiles({ name: 'timecode.mid', mimeType: 'audio/midi', buffer: Buffer.from(bytes) });
  await expect(page.locator('#blackTempoStatus')).toContainText('timecode');
  await expect(page.locator('#blackFileTempo')).toBeDisabled(); await expect(page.locator('#blackSyncTempo')).toBeDisabled();
  await page.locator('#blackSpeedRatio').selectOption('0.25'); expect(await rate(page)).toBe(.25);
  await expect(page.locator('#blackTempoStatus')).not.toContainText('BPM');
});

test('a failed file does not claim to use timecode', async ({ page }) => {
  await open(page);
  await page.locator('#blackMidiFile').setInputFiles({ name: 'invalid.mid', mimeType: 'audio/midi', buffer: Buffer.from('invalid MIDI') });
  await expect(page.locator('#blackTempoStatus')).toContainText('Tempo unavailable');
  await expect(page.locator('#blackTempoStatus')).not.toContainText('timecode');
  await expect(page.locator('#blackSyncTempo')).toBeDisabled();
});

test('GM bank picker exposes four complete banks and changes the shared font without arming Audio', async ({ page }) => {
  await open(page);
  const group = page.locator('#sharedSoundFontBank optgroup[label="General MIDI · 128 instruments"]');
  await expect(group.locator('option')).toHaveCount(4);
  const picker = page.locator('#mixerBankChooser details');
  await picker.locator(':scope > summary').click();
  await expect(picker.getByText('General MIDI · 128 instruments', { exact: true })).toBeVisible();
  await picker.getByRole('button').filter({ hasText: 'GeneralUser GS' }).click();
  await expect(page.locator('#mixerFontName')).toHaveText('GeneralUser GS 2.0.3', { timeout: 20000 });
  expect(await page.evaluate(() => __channelQA.player.state.soundfontName)).toBe('GeneralUser GS 2.0.3');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mixerSampleLevel').locator('xpath=ancestor::label').locator(':scope > span:first-child > b')).toHaveText('Layer volume');
});

for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
  test(`channel controls remain a shallow reachable row at ${width}×${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height }); await open(page); await loadScore(page);
    const channel = page.locator('.blech-file-channel');
    expect((await channel.boundingBox()).height).toBeLessThan(95);
    for (const selector of ['#blackPlayButton', '#blackFileTempo', '#blackSyncTempo', '#blackSpeedRatio', '#blackOriginalTiming']) {
      const control = page.locator(selector); await control.scrollIntoViewIfNeeded(); await expect(control).toBeInViewport();
      const hit = await control.evaluate(node => { const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); });
      expect(hit).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator('.blech-playable-keyboard')).toBeInViewport();
    await channel.evaluate(node => { node.scrollLeft = 0; });
    await page.screenshot({ path: testInfo.outputPath('channel-strip.png') });
  });
}
