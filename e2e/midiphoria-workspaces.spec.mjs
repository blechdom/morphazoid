import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

async function open(page) {
  const errors = [], requests = []; page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\.mid(?:$|\?)/.test(request.url())) requests.push(request.url()); });
  await page.addInitScript(() => {
    globalThis.__workspaceQA = { engine: null, contexts: [], launches: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __workspaceQA.contexts.push(this); } };
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaVolume=MidiMixerEngine.prototype.setVolume,qaTrigger=MidiMixerEngine.prototype.triggerSample;
      MidiMixerEngine.prototype.setVolume=function(...args){__workspaceQA.engine=this;return qaVolume.apply(this,args);};
      MidiMixerEngine.prototype.triggerSample=function(...args){const sample=qaTrigger.apply(this,args);
        if(sample)__workspaceQA.launches.push({id:sample.id,name:sample.name});return sample;};` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#mixerStampCount')).toHaveText('58 / 58');
  return { errors, requests };
}
async function view(page, mode) {
  await page.locator(`#${mode === 'draw' ? 'drawing' : 'automata'}ModeButton`).click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-view', mode);
}
const snapshot = page => page.evaluate(() => {
  const state = __workspaceQA.engine.state;
  return { playing: state.playing, audio: state.audioEnabled, beat: state.beat, tempo: state.tempo,
    loaded: state.decks.map(deck => Boolean(deck.analysis)), samples: state.samples.map(({ id, positionBeats, cycle, loop, sync }) => ({ id, positionBeats, cycle, loop, sync })),
    contexts: __workspaceQA.contexts.map(context => context.state) };
});
async function sounding(page) { await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.001); }
async function arm(page) { await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 }); }

test('Blech MIDI owns drawing and rules without deck requests or duplicate creative controls', async ({ page }) => {
  const { errors, requests } = await open(page);
  await expect(page.locator('h1')).toHaveText('Blech MIDI');
  expect((await snapshot(page)).loaded).toEqual([false, false]); expect((await snapshot(page)).playing).toBe(false);
  await expect(page.locator('#generateDrawingMidi')).toHaveText('Send ↑'); await expect(page.locator('#generateDrawingMidi')).toBeDisabled();
  await expect(page.locator('#creativeControlsHost [data-mixer-sample]')).toHaveCount(58);
  await expect(page.locator('#creativeVisualizerHost #mixerPerformanceCanvas')).toBeVisible();
  await expect(page.locator('#midiMixerView, #midiphoriaLegacyView, #deckSong0, #notePads')).toHaveCount(0);
  await page.locator('[data-drawing-stamp="❤"]').click(); const pixels = await page.locator('#drawingCanvas').getAttribute('data-pixels');
  await page.locator('#mixerSampleLoop').check(); await page.locator('#mixerSampleSync').uncheck(); await page.locator('#mixerSampleProgram').selectOption('16');
  await page.locator('#generateDrawingMidi').click(); await expect.poll(() => page.evaluate(() => __workspaceQA.launches.length)).toBe(1);
  await view(page, 'automata');
  await expect(page.locator('#automataMidiTools .midiphoria-automata')).toHaveAttribute('open', '');
  await expect(page.locator('#automataMidiGenerate')).toHaveText('Play rule'); await expect(page.locator('#automataMidiPreview')).toBeVisible();
  await expect(page.locator('#drawingCanvas')).toBeHidden(); await expect(page.locator('.mixer-sample-bank')).toBeHidden();
  for (const id of ['mixerSampleLoop', 'mixerSampleSync', 'mixerSampleProgram', 'mixerSampleLevel', 'mixerStopSamples']) await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.locator('#mixerSampleLoop')).toBeChecked(); await expect(page.locator('#mixerSampleSync')).not.toBeChecked(); await expect(page.locator('#mixerSampleProgram')).toHaveValue('16');
  await view(page, 'draw'); await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', pixels); await expect(page.locator('.mixer-sample-bank')).toBeVisible();
  for (const id of ['mixerPerformanceCanvas', 'mixerSampleLoop', 'mixerSampleSync', 'automataMidiTools']) await expect(page.locator(`#${id}`)).toHaveCount(1);
  await page.locator('#creativeStop').click();
  await page.locator('h1').click(); await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => __workspaceQA.launches.length)).toBe(2);
  expect((await snapshot(page)).loaded).toEqual([false, false]); expect(requests).toEqual([]);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect((await snapshot(page)).contexts).toEqual([]); expect(errors).toEqual([]);
});

test('native loops persist across drawing and Automatapoeia, with one context and explicit stop', async ({ page }, testInfo) => {
  test.setTimeout(60000); const { errors } = await open(page);
  await page.locator('#mixerSampleLoop').check(); await page.locator('#mixerSampleProgram').selectOption('16');
  await arm(page); await page.locator('[data-mixer-sample="square"]').click(); await sounding(page);
  const id = (await snapshot(page)).samples[0].id;
  await page.locator('#creativeTempo').fill('173'); await expect.poll(async () => (await snapshot(page)).tempo).toBe(173);
  await view(page, 'automata'); await expect(page.locator('#mixerSampleLoop')).toBeChecked(); await sounding(page);
  expect((await snapshot(page)).samples.some(sample => sample.id === id)).toBe(true); expect((await snapshot(page)).playing).toBe(false);
  await page.locator('#automataMidiGenerate').click(); await expect.poll(() => page.evaluate(() => __workspaceQA.launches.length)).toBe(2);
  const signal = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 40 });
  expect(signal.summary.finite).toBe(true); expect(signal.summary.maxRms).toBeGreaterThan(.001); expect(signal.summary.clippedSamples).toBe(0);
  expect((await snapshot(page)).contexts).toEqual(['running']);
  await view(page, 'draw'); await expect(page.locator('#creativeTempo')).toHaveValue('173');
  await page.locator('#creativeStop').click(); await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);
  expect((await snapshot(page)).samples).toEqual([]);
  await page.locator('[data-mixer-sample="heart"]').click(); await sounding(page);
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await snapshot(page)).samples).toEqual([]);
  await page.locator('[data-drawing-stamp="wave"]').click(); await page.locator('#generateDrawingMidi').click();
  const sample = (await snapshot(page)).samples[0];
  await expect.poll(async () => (await snapshot(page)).samples.find(item => item.id === sample.id)?.positionBeats).toBeGreaterThan(sample.positionBeats + .2);
  await expect.poll(() => page.locator('#mixerPerformanceCanvas').getAttribute('data-captured-notes').then(Number)).toBeGreaterThan(0);
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  expect((await snapshot(page)).contexts.length).toBe(1);
  await testInfo.attach('workspace-native-audio', { body: JSON.stringify({ signal: signal.summary, final: await snapshot(page) }), contentType: 'application/json' }); expect(errors).toEqual([]);
});

test('page teardown releases native audio and BFCache restores one idle drawing workspace', async ({ page }) => {
  const { errors } = await open(page); await page.locator('[data-drawing-stamp="wave"]').click();
  const pixels = await page.locator('#drawingCanvas').getAttribute('data-pixels');
  await page.locator('#mixerSampleLoop').check(); await arm(page); await page.locator('#generateDrawingMidi').click(); await sounding(page);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await expect.poll(() => page.evaluate(() => __workspaceQA.contexts.every(context => context.state === 'closed'))).toBe(true);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#mixerPerformanceCanvas')).toHaveCount(1); await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', pixels);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect((await snapshot(page)).samples).toEqual([]);
  expect((await snapshot(page)).loaded).toEqual([false, false]);
  await arm(page); await page.locator('#generateDrawingMidi').click(); await sounding(page);
  expect((await snapshot(page)).contexts).toEqual(['closed', 'running']); expect(errors).toEqual([]);
});

test('Midiophilia exposes only visualizer and mix controls and links to standalone Blech MIDI', async ({ page }) => {
  await page.goto('/midiphoria.html');
  await expect(page.locator('#visualModeButton, #mixerModeButton')).toHaveCount(2);
  await expect(page.locator('#drawingModeButton, #automataModeButton, #drawingCanvas, #creativeControlsHost')).toHaveCount(0);
  await page.locator('#mixerModeButton').click(); await expect(page.locator('#tempoFromB')).toBeEnabled();
  await expect(page.locator('[data-mixer-sample], #mixerSampleLoop, #automataMidiTools')).toHaveCount(0);
  const monitor = page.locator('#mixerPerformanceCanvas'); await expect(monitor).toBeVisible();
  expect(await monitor.getAttribute('tabindex')).toBeNull(); await monitor.click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  const destination = page.locator('main a[href="blech-midi.html"]').first(); await expect(destination).toBeVisible(); await destination.click();
  await expect(page).toHaveURL(/\/blech-midi\.html$/); await expect(page.locator('#drawingCanvas')).toBeVisible();
});
