import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseMidi, beatsToSeconds } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const collection = JSON.parse(await readFile(new URL('../assets/midiphoria/collection.json', import.meta.url), 'utf8'));
const song = id => collection.find(item => item.id === id);
const pattern = song('black-pattern-3-beat-block-gliss-128');
const patternAnalysis = parseMidi(await readFile(new URL(`../assets/midiphoria/${pattern.file}`, import.meta.url)));
const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

async function open(page) {
  await page.addInitScript(() => {
    globalThis.__blackQA = { player: null, view: null, options: null, contexts: [], keyRects: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __blackQA.contexts.push(this); } };
    const clear = CanvasRenderingContext2D.prototype.clearRect, fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) { if (this.canvas.getAttribute('aria-label') === 'MIDI keyboard') __blackQA.keyRects = []; return clear.apply(this, args); };
    CanvasRenderingContext2D.prototype.fillRect = function (...args) { if (this.canvas.getAttribute('aria-label') === 'MIDI keyboard') __blackQA.keyRects.push(args); return fill.apply(this, args); };
  });
  // Passive observers retain the production renderer, keyboard, loader and native audio.
  await page.route('**/src/instruments/midiphoria/midiphoria-player.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst qaPublish=MidiphoriaPlayer.prototype._publish; MidiphoriaPlayer.prototype._publish=function(...args){__blackQA.player=this;return qaPublish.apply(this,args);};
      const qaLoad=MidiphoriaPlayer.prototype.load; MidiphoriaPlayer.prototype.load=async function(...args){const result=await qaLoad.apply(this,args); if(__blackQA.failNextLoad){__blackQA.failNextLoad=false;this._processorFailed();return false;}return result;};
      const qaBank=MidiphoriaPlayer.prototype.loadSoundFont; MidiphoriaPlayer.prototype.loadSoundFont=async function(...args){if(__blackQA.failFileBank){__blackQA.failFileBank=false;throw new Error('Injected file SoundFont failure');}return qaBank.apply(this,args);};` });
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst qaVolume=MidiMixerEngine.prototype.setVolume; MidiMixerEngine.prototype.setVolume=function(...args){__blackQA.engine=this;return qaVolume.apply(this,args);};
      const qaBank=MidiMixerEngine.prototype.loadSoundFont; MidiMixerEngine.prototype.loadSoundFont=async function(...args){const result=await qaBank.apply(this,args);if(__blackQA.failPadBank){__blackQA.failPadBank=false;throw new Error('Injected pad SoundFont failure');}return result;};` });
  });
  await page.route('**/src/instruments/blech-midi/blech-midi-black-renderer.js', async route => {
    const response = await route.fetch(), source = (await response.text()).replace('export function createBlackMidiVisualizer(', 'function qaCreateBlackMidiVisualizer(');
    await route.fulfill({ response, body: `${source}\nexport function createBlackMidiVisualizer(...args){const view=qaCreateBlackMidiVisualizer(...args);__blackQA.view=view;const options=view.setOptions;view.setOptions=function(value){__blackQA.options=structuredClone(value);return options.call(view,value);};return view;}` });
  });
  await page.goto('/blech-midi.html#blackMidiPlayer');
  await expect(page.locator('#blackSongSelect option')).toHaveCount(collection.length + 1);
  await expect(page.locator('#blackSongList, #blackSongSearch')).toHaveCount(0);
}
async function select(page, item) {
  await tab(page, 'files');
  await page.locator('#blackSongSelect').selectOption(item.id);
  await expect(page.locator('#blackSongSelect')).toHaveValue(item.id);
}
async function input(page, selector, value) { await page.locator(selector).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }, value); }
const state = page => page.evaluate(() => ({ player: __blackQA.player?.state, stats: __blackQA.view?.stats, contexts: __blackQA.contexts.length, options: __blackQA.options }));
const total = page => page.locator('#blackMidiControls [data-total]');
const black = page => expect(page.locator('#blackMidiViewport')).toBeVisible();
async function tab(page, name) { await page.locator(`[data-blech-tab="${name}"]`).click(); await expect(page.locator(`#blechPanel-${name}`)).toBeVisible(); }
async function arm(page) { await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 }); }
async function audible(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 12000 }).toBeGreaterThan(.001);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 300, intervalMs: 35 });
  expect(summary.finite).toBe(true); expect(summary.maxRms).toBeGreaterThan(.001); expect(summary.clippedSamples).toBe(0);
}
async function detail(page, text) { await tab(page, 'visuals'); const summary = page.locator('#blackMidiControls summary').filter({ hasText: text }); if (await summary.locator('..').getAttribute('open') === null) await summary.click(); }

test('Blech Black MIDI keeps playback running with a complete 128-key keyboard, exact counts and overlaid voice colors', async ({ page }) => {
  test.setTimeout(60000); await open(page); await select(page, pattern); await black(page);
  await expect(total(page)).toHaveText(String(patternAnalysis.noteCount));
  expect((await state(page)).contexts).toBe(0);
  const keyboard = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="MIDI keyboard"]');
    return { width: canvas.width, rectangles: __blackQA.keyRects.filter(rect => rect[2] < canvas.width / 20) };
  });
  expect(keyboard.rectangles).toHaveLength(128); expect(Math.min(...keyboard.rectangles.map(rect => rect[0]))).toBe(0);
  expect(Math.max(...keyboard.rectangles.map(rect => rect[0] + rect[2]))).toBeGreaterThan(keyboard.width - 2);
  await page.locator('#blackLoopSong').check(); await arm(page);
  expect((await state(page)).contexts).toBe(1); await expect(page.locator('#blackPlayButton')).toBeEnabled(); await page.locator('#blackPlayButton').click(); await audible(page);
  await tab(page, 'drawing'); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#blackSongSelect')).toBeHidden(); await expect(page.locator('#blackMidiViewport')).toBeVisible();
  await black(page); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await detail(page, 'Tracks & colors');
  await page.locator('#blackMidiControls [data-palette]').selectOption('candy');
  await page.locator('#blackMidiControls [data-color-by]').selectOption('channel');
  await input(page, '#blackMidiControls input[type="color"]', '#ff2244');
  expect(Object.values((await state(page)).options.trackColors)).toContain('#ff2244');
  await page.locator('#blackMidiControls input[data-track][type="checkbox"]').uncheck();
  await expect.poll(async () => (await state(page)).stats.visible).toBe(0);
  await expect(total(page)).toHaveText('128'); await audible(page); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#blackMidiControls input[data-track][type="checkbox"]').check();
  await expect.poll(async () => (await state(page)).stats.visible).toBeGreaterThan(0);
  await page.locator('#blackMidiControls [data-alignment]').selectOption('equal');
  expect((await state(page)).options.alignment).toBe('equal');
  await input(page, '#blackMidiControls [data-past]', 8);
  await input(page, '#blackMidiControls [data-present]', 45);
  await page.locator('#blackMidiControls [data-trails]').uncheck();
  expect((await state(page)).options).toMatchObject({ pastSeconds: 8, keyboardPosition: .45, trails: false });
  await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await audible(page);
  await page.locator('#blackMidiControls [data-trails]').check();
  await page.locator('#blackPlayButton').click(); await input(page, '#blackSongPosition', .3);
  await expect.poll(async () => (await state(page)).stats.position).toBe(.3);
  const starts = patternAnalysis.notes.map(note => beatsToSeconds(note.beat, patternAnalysis.tempoMap));
  const ends = patternAnalysis.notes.map(note => beatsToSeconds(note.beat + note.duration, patternAnalysis.tempoMap));
  const actual = (await state(page)).stats;
  expect(actual.passed).toBe(starts.filter(time => time <= .3).length);
  expect(actual.held).toBe(starts.filter((time, i) => time <= .3 && ends[i] > .3).length);
  expect(actual.notesPerSecond).toBe(starts.filter(time => time > -.7 && time <= .3).length);
});

test('decorative gzip score indexes every note and plays the creator audio edition on its original timeline', async ({ page }) => {
  test.setTimeout(120000); const item = song('black-bleed-chasing-wind-full'), paired = song(item.pairedAudioId), requests = [];
  page.on('request', request => requests.push(request.url())); await open(page); await select(page, item);
  await expect(page.locator('#blackMidiViewport')).toBeVisible();
  await expect(total(page)).toHaveText(item.noteCount.toLocaleString('en-US'), { timeout: 90000 });
  expect(requests.some(url => url.endsWith(item.file))).toBe(true); expect(requests.some(url => url.endsWith(paired.file))).toBe(true);
  await expect(page.locator('#blackSongDescription')).toContainText('AUDIO edition');
  expect((await state(page)).contexts).toBe(0);
  await arm(page); await expect(page.locator('#blackPlayButton')).toBeEnabled(); await input(page, '#blackSongPosition', 10); await page.locator('#blackPlayButton').click(); await audible(page);
  await expect.poll(async () => (await state(page)).stats.passed).toBeGreaterThan(0);
  const observed = await state(page); expect(observed.stats.total).toBe(item.noteCount); expect(observed.player.visualOnly).not.toBe(true); expect(observed.player.time).toBeGreaterThan(10);
  await page.locator('#blackPlayButton').click();
  const stopped = await state(page); expect(Math.abs(stopped.stats.position - stopped.player.time)).toBeLessThan(.25);
});

test('Lightstorm retains its full note count and download while playing audio without loading 183 MB artwork', async ({ page }) => {
  test.setTimeout(60000); const item = song('black-bleed-lightstorm-full'), paired = song(item.pairedAudioId), requests = [];
  page.on('request', request => requests.push(request.url())); await open(page); await select(page, item);
  await expect(total(page)).toHaveText(item.noteCount.toLocaleString('en-US')); await expect(page.locator('[data-score-status]')).toContainText('12 million-note preview limit');
  await arm(page); await expect(page.locator('#blackPlayButton')).toBeEnabled(); await input(page, '#blackSongPosition', 10); await page.locator('#blackPlayButton').click(); await audible(page);
  await expect(total(page)).toHaveText(item.noteCount.toLocaleString('en-US'));
  expect(requests.some(url => url.endsWith(item.file))).toBe(false); expect(requests.some(url => url.endsWith(paired.file))).toBe(true);
  await tab(page, 'info'); await page.locator('#blackMidiCredits > summary').click();
  await expect(page.locator('#blackSongCredit a[download]')).toBeVisible(); await expect(page.locator('#blackMidiViewport')).toBeVisible();
  await expect(page.locator('#blackSongCredit a[download]')).toHaveAttribute('href', new RegExp(`${item.file.replaceAll('.', '\\.')}$`));
  expect((await state(page)).stats?.total ?? 0).toBe(0);
});

test('unpaired large artwork has a silent, seekable 8× looping transport without opening Audio', async ({ page }) => {
  test.setTimeout(120000); const item = song('black-bleed-five-pebbles-full'); await open(page); await select(page, item);
  await expect(total(page)).toHaveText(item.noteCount.toLocaleString('en-US'), { timeout: 90000 }); await expect(page.locator('#blackPlayButton')).toBeEnabled();
  await expect(page.locator('#blackSongDescription')).toContainText('silent visual playback');
  await input(page, '#blackSongPosition', 100); await input(page, '#blackPlaybackRate', 8);
  await expect.poll(async () => (await state(page)).stats.position).toBe(100);
  await page.locator('#blackPlayButton').click(); const before = (await state(page)).player.time;
  await expect.poll(async () => (await state(page)).player.time).toBeGreaterThan(before + 1);
  await page.locator('#blackPlayButton').click(); const paused = (await state(page)).player.time;
  await page.waitForTimeout(250); expect((await state(page)).player.time).toBe(paused);
  await page.locator('#blackLoopSong').check(); await input(page, '#blackSongPosition', item.durationSeconds - .5); await page.locator('#blackPlayButton').click();
  // Software GPU readback may skip the first seconds at 8×; wrapping must still
  // produce a position before the near-end seek rather than stop at the end.
  await expect.poll(async () => (await state(page)).player.time, { timeout: 15000 }).toBeLessThan(item.durationSeconds - 5);
  const observed = await state(page); expect(observed.player.visualOnly).toBe(true); expect(observed.player.playing).toBe(true); expect(observed.player.rate).toBe(8); expect(observed.contexts).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('a later selection aborts an in-flight decorative download and owns the score and player', async ({ page }) => {
  const item = song('black-bleed-chasing-wind-full'); let release, requested;
  const failed = []; page.on('requestfailed', request => failed.push(request.url()));
  const pending = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { requested = resolve; });
  await page.route(`**/${item.file}`, async route => { requested(); await pending; await route.continue().catch(() => {}); });
  await open(page); await select(page, item); await seen; await select(page, pattern); release();
  await expect(total(page)).toHaveText('128'); await expect(page.locator('#blackCurrentSong')).toContainText(pattern.title);
  await page.waitForTimeout(300); await expect(total(page)).toHaveText('128'); expect((await state(page)).player.fileName).toBe(pattern.title);
  await expect.poll(() => failed.some(url => url.endsWith(item.file))).toBe(true);
  await expect(page.locator('#blackPlayerStatus')).toHaveText('');
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) test(`Black keyboard and controls remain reachable at ${viewport.width} × ${viewport.height}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport); await open(page); await select(page, pattern); await black(page); await expect(total(page)).toHaveText('128');
  await tab(page, 'visuals'); await page.locator('#blackMidiControls [data-alignment]').selectOption('equal'); await detail(page, 'Tracks & colors');
  await page.locator('#blackMidiViewport').scrollIntoViewIfNeeded();
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('#blackMidiViewport'), box = stage.getBoundingClientRect();
    const keyboard = stage.querySelector('canvas[aria-label="MIDI keyboard"]').getBoundingClientRect();
    const seek = document.querySelector('.blech-file-position').getBoundingClientRect(), live = document.querySelector('.blech-live-strip').getBoundingClientRect();
    const transport = ['#blackLoopSong', '#blackSyncTempo'].map(selector => { const node = document.querySelector(selector), rect = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); });
    return { keyboard: { top: keyboard.top, bottom: keyboard.bottom, height: keyboard.height }, top: box.top, bottom: box.bottom, seekBottom: seek.bottom, liveTop: live.top, liveBottom: live.bottom, transport, overflow: document.documentElement.scrollWidth - innerWidth, width: box.width, height: box.height, left: box.left, right: box.right, nested: [...document.querySelectorAll('#blackMidiControls, .midiphoria-score-track')].map(node => node.scrollWidth - node.clientWidth) };
  });
  expect(layout.transport).toEqual([true, true]); expect(layout.overflow).toBeLessThanOrEqual(1); expect(Math.max(...layout.nested)).toBeLessThanOrEqual(1); expect(layout.width).toBeGreaterThan(250); expect(layout.height).toBeGreaterThanOrEqual(viewport.height < 500 ? 48 : 100); expect(layout.left).toBeGreaterThanOrEqual(0); expect(layout.right).toBeLessThanOrEqual(viewport.width);
  if (viewport.width >= 1000) {
    expect(layout.width).toBeLessThan(viewport.width * .7);
    expect(layout.height).toBeGreaterThan(400);
  }
  if (viewport.width < 500) expect(layout.height).toBeGreaterThan(210);
  expect(layout.keyboard.height).toBeGreaterThan(8); expect(layout.keyboard.top).toBeGreaterThanOrEqual(layout.top); expect(layout.keyboard.bottom).toBeLessThanOrEqual(layout.bottom + 1);
  expect(layout.seekBottom).toBeLessThanOrEqual(layout.liveTop + 1); expect(layout.liveBottom).toBeLessThanOrEqual(viewport.height + 1);
  await page.screenshot({ path: testInfo.outputPath('black-midi.png') });
});

test('drawing preview is an independent snapshot and file, pad and evolution transports coexist on one audio clock', async ({ page }) => {
  test.setTimeout(60000); await open(page); await tab(page, 'drawing');
  await page.getByRole('button', { name: 'Heart stamp', exact: true }).click();
  await page.locator('#mixerSampleLoop').check(); await page.locator('#generateDrawingMidi').click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '1');
  const download = page.waitForEvent('download'); await page.locator('#downloadDrawingMidi').click();
  const drawing = parseMidi(await readFile(await (await download).path()));
  await page.locator('#previewDrawingMidi').click(); await expect(total(page)).toHaveText(drawing.noteCount.toLocaleString('en-US'));
  await page.locator('#drawingClear').click(); await expect(total(page)).toHaveText(drawing.noteCount.toLocaleString('en-US'));
  expect((await state(page)).contexts).toBe(0); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#blackLoopSong').check(); await arm(page); await page.locator('#blackPlayButton').click();
  await tab(page, 'automata'); await page.locator('#automataMidiPlayPause').click(); await audible(page);
  expect((await state(page)).contexts).toBe(1);
  const icon = await page.locator('#blackPlayButton').evaluate(button => ({ background: getComputedStyle(button).backgroundColor, stroke: getComputedStyle(button.querySelector('.transport-pause')).stroke, visible: getComputedStyle(button.querySelector('.transport-pause')).display }));
  expect(icon.visible).not.toBe('none'); expect(icon.stroke).not.toBe(icon.background);
  await page.locator('#blackPlayButton').click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '1'); await expect(page.locator('#automataMidiPlayPause')).toHaveAttribute('aria-pressed', 'true'); await audible(page);
  await page.locator('#blackPlayButton').click(); await page.locator('#blechLiveLayers button').click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0'); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await tab(page, 'automata'); await page.locator('#automataMidiPlayPause').click(); await audible(page);
  await page.locator('#blackSyncTempo').check(); await input(page, '#creativeTempo', 240);
  expect((await state(page)).player.rate).toBeCloseTo(2, 6);
  await input(page, '#blackPlaybackRate', 8); expect((await state(page)).player.rate).toBe(8);
  await expect(page.locator('#blackTempoStatus')).toContainText('limited to 0.5–8×');
  await input(page, '#outputLevel', 0); await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await input(page, '#outputLevel', .5); await audible(page);
  expect(await page.locator('.mixer-range-knob .mixer-range-knob').count()).toBe(0);
  await page.locator('#creativeStop').click(); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
});

test('MIDI art previews directly in the falling score without sending a pad or arming audio', async ({ page }) => {
  await open(page); await tab(page, 'art');
  await page.locator('#artScript').selectOption('sine'); await expect(page.locator('#artPreview')).toHaveAttribute('data-notes', '64');
  await page.locator('#artPreviewScore').click(); await expect(total(page)).toHaveText('64');
  await expect(page.locator('#blackCurrentSong')).toContainText('Your MIDI artwork');
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  await page.locator('#artClear').click(); await expect(page.locator('#artPreview')).toHaveAttribute('data-notes', '0');
  await expect(total(page)).toHaveText('64'); expect((await state(page)).contexts).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('Midiophilia links to the moved player and retains its ordinary MIDI library without loading the Black renderer', async ({ page }) => {
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/midiphoria.html'); await expect(page.locator('#songList')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#songList [data-song-id]')).toHaveCount(collection.filter(song => !song.visualOnly && !song.compression).length);
  await expect(page.locator('#blackMidiViewport')).toHaveCount(0);
  expect(requests.some(url => url.includes('black-renderer.js'))).toBe(false);
  await page.getByRole('link', { name: 'Black MIDI ↗', exact: true }).click();
  await expect(page).toHaveURL(/blech-midi\.html#blackMidiPlayer$/);
  await expect(page.locator('#blackMidiViewport')).toBeVisible(); await expect(page.locator('#blackSongSelect option')).toHaveCount(collection.length + 1);
});

test('Audio retries a failed file processor but never revives an older file after a replacement download fails', async ({ page }) => {
  test.setTimeout(60000); await open(page); await arm(page);
  await page.evaluate(() => { __blackQA.failNextLoad = true; }); await select(page, pattern);
  await expect(page.locator('#blackPlayerStatus')).toContainText('processor stopped'); await expect(page.locator('#blackPlayButton')).toBeDisabled();
  await page.locator('#audioButton').click(); await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#blackPlayButton')).toBeEnabled({ timeout: 20000 });
  await page.locator('#blackLoopSong').check(); await page.locator('#blackPlayButton').click(); await audible(page);
  expect((await state(page)).contexts).toBe(1);
  const replacement = song('black-bleed-chasing-wind-full'); await page.route(`**/${replacement.file}`, route => route.abort());
  await select(page, replacement); await expect(page.locator('#blackPlayerStatus')).not.toHaveText('');
  await page.locator('#audioButton').click(); await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#blackPlayButton')).toBeDisabled(); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#blackCurrentSong')).toContainText(replacement.title);
  await page.locator('#blackMidiFile').setInputFiles({ name: 'corrupt.mid', mimeType: 'audio/midi', buffer: Buffer.from('not a valid MIDI file') });
  await expect(page.locator('#blackPlayerStatus')).toContainText('invalid MIDI header');
  await page.locator('#audioButton').click(); await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#blackPlayButton')).toBeDisabled();
});

test('a failed shared SoundFont change restores both consumers and the next choice preserves file playback', async ({ page }) => {
  test.setTimeout(90000); await open(page); await select(page, pattern); await page.locator('#blackLoopSong').check(); await arm(page);
  await page.locator('#blackPlayButton').click(); await audible(page);
  await tab(page, 'sound'); await page.locator('#mixerEffects > summary').click();
  const bank = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
  const names = () => page.evaluate(() => [__blackQA.engine.state.soundfontName, __blackQA.player.state.soundfontName]);
  for (const failure of ['failFileBank', 'failPadBank']) {
    await page.evaluate(key => { __blackQA[key] = true; }, failure);
    await page.locator('#mixerSoundFont').setInputFiles({ name: 'Replacement.sf2', mimeType: 'application/octet-stream', buffer: bank });
    await expect(page.locator('#mixerFontStatus')).toContainText('Injected', { timeout: 30000 });
    expect(await names()).toEqual(['TimGM6mb', 'TimGM6mb']);
    await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true'); await audible(page);
  }
  await page.locator('#mixerSoundFont').setInputFiles({ name: 'Working.sf2', mimeType: 'application/octet-stream', buffer: bank });
  // The chooser takes its display name from the bank's embedded INAM, not the
  // uploaded filename. Both consumers must accept that same new name.
  await expect.poll(async () => { const [pad, file] = await names(); return pad === file && pad !== 'TimGM6mb'; }, { timeout: 30000 }).toBe(true);
  await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true'); await audible(page);
  expect((await state(page)).contexts).toBe(1);
});
