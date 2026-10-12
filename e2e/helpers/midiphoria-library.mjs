import { readFileSync } from 'node:fs';

// Complete decorative scores now belong to Blech's full-score library.
export const bundledMidiCount = JSON.parse(readFileSync(new URL('../../assets/midiphoria/collection.json', import.meta.url), 'utf8'))
  .filter(song => !song.visualOnly && !song.compression).length;

/** The visible library uses ordinary buttons, so navigation never selects a file. */
export const songButtons = page => page.locator('#songList button[data-song-id]');
export const selectedSong = page => page.locator('#songList button[data-song-id][aria-pressed="true"]');
export const songButton = (page, id) => page.locator(`#songList button[data-song-id="${id}"]`);
export const currentSongId = page => selectedSong(page).evaluateAll(buttons => buttons[0]?.dataset.songId ?? '');
export const selectSong = (page, id) => songButton(page, id).click();
