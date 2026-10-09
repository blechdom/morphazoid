import { expect, test } from '@playwright/test';
import { songButtons, selectedSong, songButton, currentSongId, selectSong } from './helpers/midiphoria-library.mjs';
import { readAudioStatus } from './helpers/audio-probe.mjs';

// A long original organ note keeps transport assertions independent of song lengths.
const sustainedMidi = Buffer.from([
  77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
  77, 84, 114, 107, 0, 0, 0, 23,
  0, 255, 81, 3, 7, 161, 32, 0, 192, 19, 0, 144, 60, 80,
  158, 0, 128, 60, 0, 0, 255, 47, 0,
]);
async function open(page) {
  await page.goto('/midiphoria.html');
  await expect(page.locator('#nextSongButton')).toBeEnabled();
}
async function play(page) {
  await selectSong(page, 'rock-theme-four');
  await page.locator('#audioButton').click();
  await expect(page.locator('#playButton')).toBeEnabled({ timeout: 15000 });
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
}
async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, next) => {
    node.value = String(next); node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function delayedSong(page, file) {
  let finish, requested;
  const done = new Promise(resolve => { finish = resolve; });
  const started = new Promise(resolve => { requested = resolve; });
  await page.route(`**/assets/midiphoria/midi/${file}`, async route => {
    requested(); await done;
    await route.fulfill({ status: 200, contentType: 'audio/midi', body: sustainedMidi }).catch(() => {});
  });
  return { finish, started };
}

test('empty startup shows the full library; preset selection fills it once and keeps imports', async ({ page }) => {
  await open(page);
  const songs = await page.evaluate(() => fetch('/assets/midiphoria/collection.json').then(response => response.json()));
  await expect(songButtons(page)).toHaveCount(songs.length);
  await expect(page.locator('#songSelect, #collectionSelect')).toHaveCount(0);
  await expect(page.locator('#songList')).toHaveJSProperty('tagName', 'UL');
  const library = await page.locator('#songList').evaluate(node => ({
    height: node.clientHeight, content: node.scrollHeight, overflow: getComputedStyle(node).overflowY,
  }));
  expect(library.height).toBeGreaterThan(0);
  expect(library.content).toBeGreaterThan(library.height);
  expect(['auto', 'scroll']).toContain(library.overflow);
  await expect(selectedSong(page)).toHaveCount(0);
  await expect(page.locator('#playButton')).toBeDisabled();
  await expect(page.locator('.midiphoria-original')).toHaveAttribute('href', 'https://github.com/NicholasCStanley/midiphoria');
  await expect(page.locator('.midiphoria-original')).toContainText('Nicholas C. Stanley');
  expect((await page.locator('#songList').textContent()).includes('Morphazoid original study')).toBe(false);
  await expect(songButton(page, 'mirror-spiral').locator('.midiphoria-song-title')).toHaveText('Mirror Spiral · Expanding Orbits');
  await page.locator('.header-preset-next').click();
  await expect(selectedSong(page)).toHaveCount(1);
  const first = await currentSongId(page);
  expect(songs.some(song => song.id === first)).toBe(true);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.header-preset-next').click();
  await page.locator('.header-preset-random').click();
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', first);
  await page.locator('#midiFile').setInputFiles({ name: 'My song.mid', mimeType: 'audio/midi', buffer: sustainedMidi });
  await page.locator('.header-preset-next').click();
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', 'local-1');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('a preset chosen before the collection arrives gets one song without arming Audio', async ({ page }) => {
  let finish;
  const ready = new Promise(resolve => { finish = resolve; });
  await page.route('**/assets/midiphoria/collection.json', async route => {
    await ready; await route.continue();
  });
  await page.goto('/midiphoria.html');
  await page.locator('.header-preset-next').click();
  finish();
  await expect(selectedSong(page)).toHaveCount(1);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
});

test('Next and Random traverse the visible collection without immediate repeats or starting playback', async ({ page }) => {
  await open(page);
  await page.locator('#songSearch').fill('geometric studies');
  const ids = await songButtons(page).evaluateAll(buttons => buttons.map(button => button.dataset.songId));
  expect(ids.length).toBeGreaterThan(1);
  await page.locator('#nextSongButton').click();
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', ids[0]);
  await page.locator('#nextSongButton').click();
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', ids[1]);
  let previous = ids[1];
  for (let index = 0; index < 6; index++) {
    await page.locator('#randomSongButton').click();
    const current = await currentSongId(page);
    expect(ids).toContain(current); expect(current).not.toBe(previous); previous = current;
  }
  await page.locator('#songSearch').fill('no matching arrangement 987654');
  await expect(page.locator('#nextSongButton')).toBeDisabled();
  await expect(page.locator('#randomSongButton')).toBeDisabled();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
});

test('switching songs and imports keeps playback, rate, loop and Audio; newest request wins', async ({ page }) => {
  await open(page); await play(page);
  await page.locator('#loopSong').check(); await range(page, 'playbackRate', 1.75);
  const slow = await delayedSong(page, 'mirror-spiral.mid');
  await selectSong(page, 'mirror-spiral'); await slow.started;
  await selectSong(page, 'ratio-canon-345');
  await expect(page.locator('#playButton')).toBeEnabled();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  slow.finish();
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', 'ratio-canon-345');
  await expect(page.locator('#songCredit')).toContainText('Ratio Canon');
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  await page.locator('#midiFile').setInputFiles({ name: 'Keep playing.mid', mimeType: 'audio/midi', buffer: sustainedMidi });
  await expect(page.locator('#playButton')).toBeEnabled();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#playbackRate')).toHaveValue('1.75');
  await expect(page.locator('#loopSong')).toBeChecked();
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  expect(Number(await page.locator('#songPosition').inputValue())).toBeLessThan(5);
});

test('Stop during a pending song load cancels playback intent; failed replacements never restart old audio', async ({ page }) => {
  await open(page); await play(page);
  const slow = await delayedSong(page, 'mirror-spiral.mid');
  await selectSong(page, 'mirror-spiral'); await slow.started;
  await expect(page.locator('#stopButton')).toBeEnabled();
  await page.locator('#stopButton').click(); slow.finish();
  await expect(page.locator('#playButton')).toBeEnabled();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#songPosition')).toHaveValue('0');
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  await page.locator('#playButton').click();
  await page.route('**/assets/midiphoria/midi/ratio-canon-345.mid', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await selectSong(page, 'ratio-canon-345');
  await expect(page.locator('#playerStatus')).toContainText('Could not load this song');
  await expect(page.locator('#playButton')).toBeDisabled();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  await page.unroute('**/assets/midiphoria/midi/ratio-canon-345.mid');
  await selectSong(page, 'ratio-canon-345');
  await expect(page.locator('#playButton')).toBeEnabled();
  await expect(page.locator('#playerStatus')).toHaveText('');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await selectSong(page, 'rock-theme-four');
  await expect(page.locator('#playButton')).toBeEnabled();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
});


test('one search matches title, artist and collection words in any order', async ({ page }) => {
  await open(page);
  const songs = await page.evaluate(() => fetch('/assets/midiphoria/collection.json').then(response => response.json()));
  const expected = songs.filter(song => {
    const text = `${song.title} ${song.composer || ''} ${song.collection || ''}`.toLocaleLowerCase();
    return ['black', 'midi'].every(word => text.includes(word));
  }).map(song => song.id);
  expect(expected.length).toBeGreaterThanOrEqual(16);
  for (const query of ['black midi', ' MIDI   BLACK ']) {
    await page.locator('#songSearch').fill(query);
    await expect(songButtons(page)).toHaveCount(expected.length);
    expect(await songButtons(page).evaluateAll(buttons => buttons.map(button => button.dataset.songId)))
      .toEqual(expected);
    await expect(selectedSong(page)).toHaveCount(0);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  }
  await page.locator('#songSearch').fill('africa toto');
  await expect(songButtons(page)).toHaveCount(1);
  await expect(songButtons(page).first()).toHaveAttribute('data-song-id', 'toto-africa');
  await page.locator('#songSearch').fill('');
  await expect(songButtons(page)).toHaveCount(songs.length);
});

test('arrow navigation only moves list focus; Enter selects without changing Audio or playback intent', async ({ page }) => {
  await open(page); await play(page);
  await page.locator('#songSearch').fill('geometric studies');
  await expect(songButtons(page)).toHaveCount(2);
  const choices = await songButtons(page).evaluateAll(buttons => buttons.map(button => button.dataset.songId));
  const before = Number(await page.locator('#songPosition').inputValue());
  await songButtons(page).first().focus();
  await expect(page.locator('#songList button[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(songButtons(page).nth(1)).toBeFocused();
  await page.keyboard.press('Home'); await expect(songButtons(page).first()).toBeFocused();
  await page.keyboard.press('End'); await expect(songButtons(page).nth(1)).toBeFocused();
  await expect(selectedSong(page)).toHaveCount(0);
  await expect(page.locator('#songCredit')).toContainText('Rock Theme Four');
  await expect(page.locator('#currentSong')).toContainText('Rock Theme Four');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(before + .2);
  await page.keyboard.press('Enter');
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', choices[1]);
  await expect(page.locator('#playButton')).toBeEnabled();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#songSearch')).toHaveValue('geometric studies');
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(.5);
  const selectedPosition = Number(await page.locator('#songPosition').inputValue());
  await selectedSong(page).click();
  expect(Number(await page.locator('#songPosition').inputValue())).toBeGreaterThanOrEqual(selectedPosition);
  await page.locator('#playButton').click();
  await songButtons(page).nth(1).focus();
  await page.keyboard.press('ArrowUp');
  await expect(songButtons(page).first()).toBeFocused();
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', choices[1]);
  await page.keyboard.press('Enter');
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', choices[0]);
  await expect(page.locator('#playButton')).toBeEnabled();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
});
