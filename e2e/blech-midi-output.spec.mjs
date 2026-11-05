import { test, expect } from '@playwright/test';
import { installFakeMidi, fakeMidiSnapshot } from './helpers/fake-midi.mjs';
import { readAudioStatus } from './helpers/audio-probe.mjs';

async function open(page, { wax = false } = {}) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await installFakeMidi(page, { outputs: [{ id: 'capture-a', name: 'DAW capture A' }, { id: 'capture-b', name: 'DAW capture B' }] });
  await page.addInitScript(() => { globalThis.__blechMidiQA = {}; });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst observeMidi=MidiMixerEngine.prototype.setVolume; MidiMixerEngine.prototype.setVolume=function(...args){__blechMidiQA.engine=this;return observeMidi.apply(this,args);};` });
  });
  await page.route('**/src/instruments/blech-midi/blech-midi-app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('midiOutput = mountBlechMidiOutput(', 'midiOutput = __blechMidiQA.output = mountBlechMidiOutput(') });
  });
  if (wax) await page.addInitScript(() => {
    globalThis.__host = { playing: false, ppq: 0, start: performance.now() };
    Object.defineProperty(globalThis, 'PlayheadInfo', { get() {
      const elapsed = __host.playing ? (performance.now() - __host.start) / 1000 : 0;
      return { state: { isPlaying: __host.playing }, tempo: { bpm: 120 }, timing: { timeInSeconds: __host.ppq / 2 + elapsed, ppqPosition: __host.ppq + elapsed * 2 } };
    } });
    globalThis.WAX_RequestPlayheadInfo = () => {};
    globalThis.Request_PlayheadTimerStart = () => {};
    globalThis.Request_PlayheadTimerStop = () => {};
  });
  await page.goto(wax ? '/dist-wax/blech-midi.html' : '/blech-midi.html');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  return errors;
}
const notes = snapshot => snapshot.outputs.flatMap(output => output.sent).filter(({ data }) => (data[0] & 0xf0) === 0x90 && data[2] > 0);
const portNotes = (snapshot, id) => notes({ outputs: snapshot.outputs.filter(port => port.id === id) });
async function settings(page) { if (!await page.locator('.header-settings-menu').evaluate(node => node.open)) await page.locator('.header-settings-trigger').click(); }
async function enable(page) {
  await settings(page); await page.locator('#sharedMidiToggle').click();
  await page.locator('#midiOutputSelect').selectOption('port:capture-a');
  await expect.poll(() => page.evaluate(() => __blechMidiQA.output.state.ready), { timeout: 20000 }).toBe(true);
  await page.locator('.header-settings-trigger').click();
}
async function drawing(page, loop = false) {
  await page.locator('#blechTab-frames').click(); await page.locator('#blechTab-drawing').click();
  const canvas = page.locator('#drawingCanvas'); await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox(), cell = Math.min((box.width - 28) / 48, (box.height - 52) / 32);
  const x0 = box.x + (box.width - cell * 48) / 2, y0 = box.y + (box.height - cell * 32) / 2;
  for (const [x, y] of [[12, 31], [16, 23], [19, 15]]) await page.mouse.click(x0 + (x + .5) * cell, y0 + (y + .5) * cell);
  await expect(canvas).toHaveAttribute('data-pixels', '3');
  await page.locator('#blechDropDelay').fill('0'); await page.locator('#blechDropDelay').press('Tab');
  if (loop) await page.locator('#blechDropLoop').click();
}
async function clearCapture(page) {
  await page.evaluate(() => { for (const output of __morphazoidFakeMidi.access.outputs.values()) output.sent.length = 0; });
}

test('browser MIDI preserves drawing timing, loop phase and releases through Audio toggles', async ({ page }) => {
  test.setTimeout(60000); const errors = await open(page);
  expect((await fakeMidiSnapshot(page)).requests).toHaveLength(0);
  await settings(page); await page.locator('#sharedMidiToggle').click();
  expect((await fakeMidiSnapshot(page)).requests).toHaveLength(1);
  expect(notes(await fakeMidiSnapshot(page))).toHaveLength(0);
  expect(await page.evaluate(() => __blechMidiQA.engine.context)).toBeNull();
  await page.locator('#midiOutputSelect').selectOption('port:capture-a');
  await expect.poll(() => page.evaluate(() => __blechMidiQA.output.state.ready), { timeout: 20000 }).toBe(true);
  await page.locator('.header-settings-trigger').click();
  await drawing(page, true); await clearCapture(page);
  await page.locator('#blechDropSend').click();
  await expect.poll(async () => notes(await fakeMidiSnapshot(page)).length).toBe(3);
  const sent = portNotes(await fakeMidiSnapshot(page), 'capture-a');
  expect(sent.map(event => event.data[1])).toEqual([60, 64, 67]);
  expect(sent.every(event => Number.isFinite(event.timestamp))).toBe(true);
  expect(sent[1].timestamp - sent[0].timestamp).toBeCloseTo(1000, -1);
  expect(sent[2].timestamp - sent[1].timestamp).toBeCloseTo(1000, -1);
  await expect.poll(async () => (await fakeMidiSnapshot(page)).outputs[0].sent.filter(({ data }) => (data[0] & 0xf0) === 0x80).length).toBe(3);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await readAudioStatus(page)).rms).toBeLessThan(.00001);
  expect(portNotes(await fakeMidiSnapshot(page), 'capture-b')).toHaveLength(0);
  const id = await page.evaluate(() => __blechMidiQA.engine.state.samples[0].id);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __blechMidiQA.engine.state.samples.map(sample => sample.id))).toEqual([id]);
  await expect.poll(async () => notes(await fakeMidiSnapshot(page)).length, { timeout: 6000 }).toBe(6);
  const looped = portNotes(await fakeMidiSnapshot(page), 'capture-a');
  expect(looped.slice(3).map(event => event.data[1])).toEqual([60, 64, 67]);
  expect(looped[3].timestamp - looped[0].timestamp).toBeCloseTo(4000, -1);
  expect(await page.evaluate(() => __blechMidiQA.output.stats.lateAttacks)).toBe(0);
  await page.locator('#creativeStop').click();
  const count = notes(await fakeMidiSnapshot(page)).length; await page.waitForTimeout(200);
  expect(notes(await fakeMidiSnapshot(page))).toHaveLength(count);
  expect((await fakeMidiSnapshot(page)).outputs[0].sent.some(({ data }) => (data[0] & 0xf0) === 0xb0 && data[1] === 123)).toBe(true);
  expect(errors).toEqual([]);
});

test('file and playable keyboard send real notes in MIDI-only mode; switching ports cleans up', async ({ page }) => {
  test.setTimeout(60000); const errors = await open(page); await enable(page);
  // A deliberately small channel-2 score: program, pitch bend, C5, then release.
  const track = [0, 193, 16, 0, 225, 0, 72, 0, 145, 72, 96, 96, 129, 72, 0, 0, 255, 47, 0];
  const bytes = Buffer.alloc(22 + track.length);
  bytes.set([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107]); bytes.writeUInt32BE(track.length,18); bytes.set(track,22);
  await page.locator('#blechTab-files').click();
  await page.locator('#blackMidiFile').setInputFiles({ name: 'MIDI-output-test.mid', mimeType: 'audio/midi', buffer: bytes });
  await expect(page.locator('#blackPlayButton')).toBeEnabled({ timeout: 20000 });
  await clearCapture(page); await page.locator('#blackPlayButton').click();
  await expect.poll(async () => notes(await fakeMidiSnapshot(page)).map(({ data }) => data)).toContainEqual([0x91, 72, 96]);
  await expect.poll(async () => (await fakeMidiSnapshot(page)).outputs[0].sent.some(({ data }) => data[0] === 0x81 && data[1] === 72)).toBe(true);
  const file = (await fakeMidiSnapshot(page)).outputs[0].sent;
  expect(file.some(({ data }) => data[0] === 0xc1 && data[1] === 16)).toBe(true);
  expect(file.some(({ data }) => data[0] === 0xe1 && data[2] === 72)).toBe(true);
  await page.locator('#blackStopButton').click(); await clearCapture(page);
  const keyboard = page.getByRole('slider', { name: /Play MIDI keyboard/ });
  await keyboard.focus(); await page.keyboard.press('Home'); await page.keyboard.down('Enter');
  await expect.poll(async () => notes(await fakeMidiSnapshot(page)).map(({ data }) => data[1])).toContain(0);
  await page.keyboard.up('Enter');
  await expect.poll(async () => (await fakeMidiSnapshot(page)).outputs[0].sent.some(({ data }) => data[0] === 0x80 && data[1] === 0)).toBe(true);
  await settings(page); await page.locator('#midiOutputSelect').selectOption('port:capture-b');
  await expect.poll(() => page.evaluate(() => __blechMidiQA.engine.state.midiOutputEnabled)).toBe(true);
  await page.locator('.header-settings-trigger').click(); await clearCapture(page);
  await keyboard.focus(); await page.keyboard.down('Enter');
  await expect.poll(async () => portNotes(await fakeMidiSnapshot(page), 'capture-b').length).toBeGreaterThan(0);
  expect(portNotes(await fakeMidiSnapshot(page), 'capture-a')).toHaveLength(0);
  await settings(page); await page.locator('#midiOutputSelect').selectOption('off'); await page.keyboard.up('Enter');
  await expect.poll(() => page.evaluate(() => __blechMidiQA.engine.state.midiOutputEnabled)).toBe(false);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect(errors).toEqual([]);
});

test('WAX uses native BLECH notes, follows DAW stop/resume, and has no companion sequence', async ({ page }) => {
  test.setTimeout(60000); const errors = await open(page, { wax: true });
  // A real WAX host permits its graph to start; grant Chrome a gesture without
  // arming BLECH Audio so this checks the same MIDI-only path.
  await page.locator('#blechMidiTitle').click();
  // The native host grants autoplay. Ordinary Chrome needs this explicit resume
  // after the gesture because its original pre-gesture resume remains pending.
  await page.evaluate(() => __blechMidiQA.engine.context?.resume());
  await expect.poll(() => page.evaluate(() => __blechMidiQA.output.state.ready), { timeout: 20000 }).toBe(true);
  expect((await fakeMidiSnapshot(page)).requests).toHaveLength(1);
  await expect(page.locator('.wax-midi-panel')).toHaveCount(0);
  expect(notes(await fakeMidiSnapshot(page))).toHaveLength(0);
  await drawing(page, true); await page.locator('#blechDropSend').click();
  await expect.poll(async () => notes(await fakeMidiSnapshot(page)).length).toBeGreaterThan(0);
  await page.evaluate(() => { __host.playing = false; WAX_Stop(); });
  await expect(page.locator('#blechMasterPlay')).toHaveAttribute('aria-pressed', 'false');
  await clearCapture(page); await page.waitForTimeout(200); expect(notes(await fakeMidiSnapshot(page))).toHaveLength(0);
  await page.evaluate(() => { __host.start = performance.now(); __host.playing = true; WAX_Play(); });
  await expect(page.locator('#blechMasterPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => notes(await fakeMidiSnapshot(page)).length, { timeout: 8000 }).toBeGreaterThan(0);
  expect(notes(await fakeMidiSnapshot(page)).every(({ data }) => [60, 64, 67].includes(data[1]))).toBe(true);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect.poll(async () => (await fakeMidiSnapshot(page)).outputs[0].clearCount).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`MIDI output remains reachable at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); const errors = await open(page); await enable(page);
    await settings(page); const output = page.locator('#midiOutputSelect');
    await output.scrollIntoViewIfNeeded(); await expect(output).toBeVisible();
    await expect(output).toHaveValue('port:capture-a');
    const box = await output.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await output.selectOption('off');
    await expect.poll(() => page.evaluate(() => __blechMidiQA.output.state.active)).toBe(false);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  });
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
  const status = await page.evaluate(() => ({
    midi: globalThis.__morphazoidFakeMidi?.snapshot(),
    stream: globalThis.__blechMidiQA?.output?.stats,
    context: globalThis.__blechMidiQA?.engine?.context?.state,
    error: document.querySelector('#midiOutputError')?.textContent,
  })).catch(() => null);
  await testInfo.attach('midi-output-status', { body: JSON.stringify(status, null, 2), contentType: 'application/json' });
});
