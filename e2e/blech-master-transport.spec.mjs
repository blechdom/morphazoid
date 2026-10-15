import { test, expect } from '@playwright/test';
import { readAudioStatus } from './helpers/audio-probe.mjs';

const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
async function open(page) {
  await page.addInitScript(() => {
    globalThis.__masterQA = { engine: null, player: null, contexts: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __masterQA.contexts.push(this); } };
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst observeMasterVolume=MidiMixerEngine.prototype.setVolume; MidiMixerEngine.prototype.setVolume=function(...args){__masterQA.engine=this;return observeMasterVolume.apply(this,args);};` });
  });
  await page.route('**/src/instruments/midiphoria/midiphoria-player.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst observeMasterPublish=MidiphoriaPlayer.prototype._publish; MidiphoriaPlayer.prototype._publish=function(...args){__masterQA.player=this;return observeMasterPublish.apply(this,args);};` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
}
async function armAudio(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
}
async function tab(page, name) { await page.locator(`#blechTab-${name}`).click(); }
const master = page => page.locator('#blechMasterPlay');
const row = (page, id) => page.locator(`.blech-live-layer[data-sample-id="${id}"]`);
const state = page => page.evaluate(() => ({
  samples: __masterQA.engine.state.samples.map(sample => ({ id: sample.id, paused: sample.paused, position: sample.positionBeats, cycle: sample.cycle, scoreVersion: sample.scoreVersion })),
  automata: { playing: __masterQA.engine.state.automata.playing, beat: __masterQA.engine.state.automata.beat },
  file: { playing: __masterQA.player.state.playing, time: __masterQA.player.state.time }, contexts: __masterQA.contexts.length,
}));
async function drop(page) {
  await page.locator('#blechDropLoop').click();
  await page.locator('#blechDropDelay').fill('0'); await page.locator('#blechDropDelay').press('Tab');
  await page.locator('#blechDropSend').click();
}
function midi(note = 60) {
  const track = [0, 192, 16, 0, 144, note, 100, 152, 0, 128, note, 0, 0, 255, 47, 0];
  const bytes = Buffer.alloc(22 + track.length);
  bytes.set([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107]); bytes.writeUInt32BE(track.length,18); bytes.set(track,22);
  return bytes;
}
async function loadFile(page, name = 'First.mid', note = 60) {
  await tab(page, 'files');
  await page.locator('#blackMidiFile').setInputFiles({ name, mimeType: 'audio/midi', buffer: midi(note) });
  await expect(page.locator('#blackPlayButton')).toBeEnabled();
}

test('master pauses only running silent layers, resumes their positions and keeps Files controls in Files', async ({ page }) => {
  await open(page);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-tab', 'math');
  await expect(page.locator('#blechFileTransport')).toBeHidden();
  await expect(page.locator('#blackMidiViewport')).toBeVisible();
  await expect(page.locator('#blackPlayButton')).toBeHidden();
  await page.locator('#blechDropLoop').click(); await master(page).click();
  await expect(master(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).samples.length).toBe(1);
  await drop(page); const [first, second] = (await state(page)).samples;
  await row(page, first.id).locator('[data-layer-pause]').click();
  await master(page).click(); await expect(master(page)).toHaveAttribute('aria-pressed', 'false');
  const paused = await state(page); expect(paused.samples.every(sample => sample.paused)).toBe(true);
  await page.waitForTimeout(250); expect((await state(page)).samples).toEqual(paused.samples);
  await tab(page, 'files'); await expect(page.locator('#blechFileTransport')).toBeVisible();
  for (const selector of ['#blackPlayButton', '#blackSongPosition', '#blackPlayerStatus', '#blackCurrentSong']) expect(await page.locator(selector).evaluate(node => Boolean(node.closest('#blechFileTransport')))).toBe(true);
  await tab(page, 'text'); await master(page).click();
  await expect.poll(async () => (await state(page)).samples.find(sample => sample.id === second.id)?.paused).toBe(false);
  expect((await state(page)).samples.find(sample => sample.id === first.id)).toEqual(paused.samples[0]);
  await expect.poll(async () => (await state(page)).samples.find(sample => sample.id === second.id)?.position).toBeGreaterThan(paused.samples[1].position);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect((await state(page)).contexts).toBe(0);
  await master(page).click(); await page.locator('#creativeStop').click();
  expect((await state(page)).samples).toEqual([]);
  await tab(page, 'math'); await master(page).click();
  await expect.poll(async () => (await state(page)).samples.length).toBe(1);
  expect((await state(page)).samples[0].id).not.toBe(second.id);
});

test('master freezes and resumes sounding file, layers and evolution without changing individually paused sources', async ({ page }) => {
  test.setTimeout(60000); await open(page); await armAudio(page); await loadFile(page);
  await master(page).click(); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  await master(page).click();
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeLessThan(.0001);
  await master(page).click();
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  await tab(page, 'math'); await drop(page); await drop(page);
  const [first, second] = (await state(page)).samples;
  await row(page, first.id).locator('[data-layer-pause]').click();
  await tab(page, 'automata'); await page.locator('#automataMidiPlayPause').click();
  await expect.poll(async () => (await state(page)).automata.playing).toBe(true);
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  await master(page).click(); await expect(master(page)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(120); const paused = await state(page);
  expect(paused.file.playing).toBe(false); expect(paused.automata.playing).toBe(false);
  expect(paused.samples.every(sample => sample.paused)).toBe(true);
  await page.waitForTimeout(250); const held = await state(page);
  expect(held.file.time).toBeCloseTo(paused.file.time, 6); expect(held.automata.beat).toBeCloseTo(paused.automata.beat, 6); expect(held.samples).toEqual(paused.samples);
  await master(page).click(); await expect(master(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).file.time).toBeGreaterThan(paused.file.time);
  await expect.poll(async () => (await state(page)).automata.beat).toBeGreaterThan(paused.automata.beat);
  await expect.poll(async () => (await state(page)).samples.find(sample => sample.id === second.id)?.paused).toBe(false);
  expect((await state(page)).samples.find(sample => sample.id === first.id)).toEqual(paused.samples[0]);
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  expect((await state(page)).contexts).toBe(1); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  // A later master pause must not adopt sources paused through their own controls.
  await page.locator('#automataMidiPlayPause').click();
  await tab(page, 'files'); await page.locator('#blackPlayButton').click();
  const independent = await state(page);
  await master(page).click(); await master(page).click();
  expect((await state(page)).file).toEqual(independent.file);
  expect((await state(page)).automata).toEqual(independent.automata);
  expect((await state(page)).samples.find(sample => sample.id === first.id)).toEqual(independent.samples[0]);
  await expect.poll(async () => (await state(page)).samples.find(sample => sample.id === second.id)?.paused).toBe(false);
});

test('master resume skips replaced or stopped files and removed or replaced layers', async ({ page }) => {
  test.setTimeout(60000); await open(page); await armAudio(page); await loadFile(page); await master(page).click();
  await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await tab(page, 'math'); await drop(page); const [first] = (await state(page)).samples;
  await master(page).click(); await loadFile(page, 'Replacement.mid', 72);
  await row(page, first.id).locator('[data-layer-stop]').click();
  await master(page).click(); expect((await state(page)).file.playing).toBe(false); expect((await state(page)).samples).toEqual([]);
  await master(page).click(); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await master(page).click(); await page.locator('#blackStopButton').click();
  await master(page).click(); expect((await state(page)).file.playing).toBe(false); expect((await state(page)).file.time).toBe(0);
  await tab(page, 'text'); await drop(page); const [text] = (await state(page)).samples;
  await master(page).click(); await row(page, text.id).locator('[data-layer-edit]').click();
  await page.locator('#blechTextMessage').fill('NEW'); await page.locator('#blechTextApply').click();
  await master(page).click();
  expect((await state(page)).samples[0]).toMatchObject({ id: text.id, paused: true });
  expect((await state(page)).contexts).toBe(1); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
});


test('master pause cancels pending file autoplay and resumes the same completed selection', async ({ page }) => {
  test.setTimeout(60000); await open(page); await armAudio(page); await loadFile(page); await master(page).click();
  await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function(...args) {
      if (!this.name.startsWith('Pending')) return read.apply(this, args);
      return new Promise((resolve, reject) => {
        __masterQA.pendingRead = true;
        __masterQA.releasePending = () => { __masterQA.pendingRead = false; return read.apply(this, args).then(resolve, reject); };
      });
    };
  });
  await page.locator('#blackMidiFile').setInputFiles({ name: 'Pending.mid', mimeType: 'audio/midi', buffer: midi(67) });
  await expect.poll(() => page.evaluate(() => __masterQA.pendingRead)).toBe(true);
  await expect(master(page)).toHaveAttribute('aria-pressed', 'true');
  await master(page).click(); await expect(master(page)).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => __masterQA.releasePending());
  await expect(page.locator('#blackPlayButton')).toBeEnabled();
  expect((await state(page)).file).toEqual({ playing: false, time: 0 });
  await master(page).click(); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).file.time).toBeGreaterThan(0);
  await page.locator('#blackMidiFile').setInputFiles({ name: 'Pending stop.mid', mimeType: 'audio/midi', buffer: midi(72) });
  await expect.poll(() => page.evaluate(() => __masterQA.pendingRead)).toBe(true);
  await page.locator('#creativeStop').click();
  await page.evaluate(() => __masterQA.releasePending());
  await expect(page.locator('#blackPlayButton')).toBeEnabled();
  await expect(master(page)).toHaveAttribute('aria-pressed', 'false');
  expect((await state(page)).file).toEqual({ playing: false, time: 0 });
  expect((await state(page)).contexts).toBe(1);
});
