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
    await route.fulfill({ response, body: `${await response.text()}\nconst qaPublish=MidiphoriaPlayer.prototype._publish; MidiphoriaPlayer.prototype._publish=function(...args){__blackQA.player=this;return qaPublish.apply(this,args);};` });
  });
  await page.route('**/src/instruments/midiphoria/midiphoria-black-renderer.js', async route => {
    const response = await route.fetch(), source = (await response.text()).replace('export function createBlackMidiVisualizer(', 'function qaCreateBlackMidiVisualizer(');
    await route.fulfill({ response, body: `${source}\nexport function createBlackMidiVisualizer(...args){const view=qaCreateBlackMidiVisualizer(...args);__blackQA.view=view;const options=view.setOptions;view.setOptions=function(value){__blackQA.options=structuredClone(value);return options.call(view,value);};return view;}` });
  });
  await page.goto('/midiphoria.html');
  await expect(page.locator('#songList')).toHaveAttribute('aria-busy', 'false');
}
async function select(page, item) {
  await page.locator('#songSearch').fill(item.title.split(' · ')[0]);
  await page.locator(`[data-song-id="${item.id}"]`).click();
  await expect(page.locator(`[data-song-id="${item.id}"]`)).toHaveAttribute('aria-pressed', 'true');
}
async function input(page, selector, value) { await page.locator(selector).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }, value); }
const state = page => page.evaluate(() => ({ player: __blackQA.player?.state, stats: __blackQA.view?.stats, contexts: __blackQA.contexts.length, options: __blackQA.options }));
const total = page => page.locator('#blackMidiControls [data-total]');
const black = page => page.locator('#blackModeButton').click();
async function arm(page) { await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 }); }
async function audible(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 12000 }).toBeGreaterThan(.001);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 300, intervalMs: 35 });
  expect(summary.finite).toBe(true); expect(summary.maxRms).toBeGreaterThan(.001); expect(summary.clippedSamples).toBe(0);
}
async function detail(page, text) { const summary = page.locator('#blackMidiControls summary').filter({ hasText: text }); if (await summary.locator('..').getAttribute('open') === null) await summary.click(); }

test('Black mode keeps playback running with a complete 128-key keyboard, exact counts and overlaid voice colors', async ({ page }) => {
  test.setTimeout(60000); await open(page); await select(page, pattern); await black(page);
  await expect(total(page)).toHaveText(String(patternAnalysis.noteCount));
  expect((await state(page)).contexts).toBe(0);
  const keyboard = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="MIDI keyboard"]');
    return { width: canvas.width, rectangles: __blackQA.keyRects.filter(rect => rect[2] < canvas.width / 20) };
  });
  expect(keyboard.rectangles).toHaveLength(128); expect(Math.min(...keyboard.rectangles.map(rect => rect[0]))).toBe(0);
  expect(Math.max(...keyboard.rectangles.map(rect => rect[0] + rect[2]))).toBeGreaterThan(keyboard.width - 2);
  await page.locator('#loopSong').check(); await arm(page); await expect(page.locator('#playButton')).toBeEnabled(); await page.locator('#playButton').click(); await audible(page);
  await page.locator('#visualModeButton').click(); await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await black(page); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await detail(page, 'Tracks & colors');
  await page.locator('#blackMidiControls [data-palette]').selectOption('candy');
  await page.locator('#blackMidiControls [data-color-by]').selectOption('channel');
  await input(page, '#blackMidiControls input[type="color"]', '#ff2244');
  expect(Object.values((await state(page)).options.trackColors)).toContain('#ff2244');
  await page.locator('#blackMidiControls input[type="checkbox"]').uncheck();
  await expect.poll(async () => (await state(page)).stats.visible).toBe(0);
  await expect(total(page)).toHaveText('128'); await audible(page); await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#blackMidiControls input[type="checkbox"]').check();
  await expect.poll(async () => (await state(page)).stats.visible).toBeGreaterThan(0);
  await page.locator('#blackMidiControls [data-alignment]').selectOption('equal');
  expect((await state(page)).options.alignment).toBe('equal');
  await page.locator('#playButton').click(); await input(page, '#songPosition', .3);
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
  await expect(page.locator('#blackModeButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(total(page)).toHaveText(item.noteCount.toLocaleString('en-US'), { timeout: 90000 });
  expect(requests.some(url => url.endsWith(item.file))).toBe(true); expect(requests.some(url => url.endsWith(paired.file))).toBe(true);
  await expect(page.locator('#songDescription')).toContainText('AUDIO edition');
  expect((await state(page)).contexts).toBe(0);
  await arm(page); await expect(page.locator('#playButton')).toBeEnabled(); await input(page, '#songPosition', 10); await page.locator('#playButton').click(); await audible(page);
  await expect.poll(async () => (await state(page)).stats.passed).toBeGreaterThan(0);
  const observed = await state(page); expect(observed.stats.total).toBe(item.noteCount); expect(observed.player.visualOnly).not.toBe(true); expect(observed.player.time).toBeGreaterThan(10);
  await page.locator('#playButton').click();
  const stopped = await state(page); expect(Math.abs(stopped.stats.position - stopped.player.time)).toBeLessThan(.25);
});

test('Lightstorm retains its full note count and download while playing audio without loading 183 MB artwork', async ({ page }) => {
  test.setTimeout(60000); const item = song('black-bleed-lightstorm-full'), paired = song(item.pairedAudioId), requests = [];
  page.on('request', request => requests.push(request.url())); await open(page); await select(page, item);
  await expect(total(page)).toHaveText(item.noteCount.toLocaleString('en-US')); await expect(page.locator('[data-score-status]')).toContainText('12 million-note preview limit');
  await arm(page); await expect(page.locator('#playButton')).toBeEnabled(); await input(page, '#songPosition', 10); await page.locator('#playButton').click(); await audible(page);
  await expect(total(page)).toHaveText(item.noteCount.toLocaleString('en-US'));
  expect(requests.some(url => url.endsWith(item.file))).toBe(false); expect(requests.some(url => url.endsWith(paired.file))).toBe(true);
  await expect(page.locator('#songCredit a[download]')).toHaveAttribute('href', new RegExp(`${item.file.replaceAll('.', '\\.')}$`));
  expect((await state(page)).stats?.total ?? 0).toBe(0);
});

test('unpaired large artwork has a silent, seekable 8× looping transport without opening Audio', async ({ page }) => {
  test.setTimeout(120000); const item = song('black-bleed-five-pebbles-full'); await open(page); await select(page, item);
  await expect(total(page)).toHaveText(item.noteCount.toLocaleString('en-US'), { timeout: 90000 }); await expect(page.locator('#playButton')).toBeEnabled();
  await expect(page.locator('#songDescription')).toContainText('silent visual playback');
  await input(page, '#songPosition', 100); await input(page, '#playbackRate', 8);
  await expect.poll(async () => (await state(page)).stats.position).toBe(100);
  await page.locator('#playButton').click(); const before = (await state(page)).player.time;
  await expect.poll(async () => (await state(page)).player.time).toBeGreaterThan(before + 1);
  await page.locator('#playButton').click(); const paused = (await state(page)).player.time;
  await page.waitForTimeout(250); expect((await state(page)).player.time).toBe(paused);
  await page.locator('#loopSong').check(); await input(page, '#songPosition', item.durationSeconds - .5); await page.locator('#playButton').click();
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
  await expect(total(page)).toHaveText('128'); await expect(page.locator('#currentSong')).toContainText(pattern.title);
  await page.waitForTimeout(300); await expect(total(page)).toHaveText('128'); expect((await state(page)).player.fileName).toBe(pattern.title);
  await expect.poll(() => failed.some(url => url.endsWith(item.file))).toBe(true);
  await expect(page.locator('#playerStatus')).toHaveText('');
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) test(`Black keyboard and controls remain reachable at ${viewport.width} × ${viewport.height}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport); await open(page); await select(page, pattern); await black(page); await expect(total(page)).toHaveText('128');
  await page.locator('#blackMidiControls [data-alignment]').selectOption('equal'); await detail(page, 'Tracks & colors');
  await page.locator('#blackMidiViewport').scrollIntoViewIfNeeded();
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('#blackMidiViewport'), box = stage.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - innerWidth, width: box.width, height: box.height, left: box.left, right: box.right, nested: [...document.querySelectorAll('#blackMidiControls, .midiphoria-score-track')].map(node => node.scrollWidth - node.clientWidth) };
  });
  expect(layout.overflow).toBeLessThanOrEqual(1); expect(Math.max(...layout.nested)).toBeLessThanOrEqual(1); expect(layout.width).toBeGreaterThan(250); expect(layout.height).toBeGreaterThanOrEqual(160); expect(layout.left).toBeGreaterThanOrEqual(0); expect(layout.right).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: testInfo.outputPath('black-midi.png') });
});
