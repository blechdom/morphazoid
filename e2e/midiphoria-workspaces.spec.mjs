import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

async function open(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
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
  await page.goto('/midiphoria.html'); await page.locator('#drawingModeButton').click();
  await expect(page.locator('#mixerStampCount')).toHaveText('58 / 58');
  return errors;
}
async function view(page, mode) {
  await page.locator(`#${{ draw: 'drawing', visual: 'visual', mixer: 'mixer', automata: 'automata' }[mode]}ModeButton`).click();
  await expect(page.locator('#midiphoria')).toHaveAttribute('data-view', mode);
}
const snapshot = page => page.evaluate(() => {
  const state = __workspaceQA.engine.state;
  return { playing: state.playing, audio: state.audioEnabled, beat: state.beat, tempo: state.tempo,
    loaded: state.decks.map(deck => Boolean(deck.analysis)), samples: state.samples.map(({ id, positionBeats, cycle, loop, sync }) => ({ id, positionBeats, cycle, loop, sync })),
    contexts: __workspaceQA.contexts.map(context => context.state) };
});
async function sounding(page) { await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.001); }
async function arm(page) { await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 }); }

test('Draw opens without deck songs and one retained stamp workspace moves between creative tabs', async ({ page }) => {
  const errors = await open(page);
  expect((await snapshot(page)).loaded).toEqual([false, false]); expect((await snapshot(page)).playing).toBe(false);
  await expect(page.locator('#generateDrawingMidi')).toHaveText('Play drawing'); await expect(page.locator('#generateDrawingMidi')).toBeDisabled();
  await expect(page.locator('#creativeControlsHost [data-mixer-sample]')).toHaveCount(58);
  await expect(page.locator('#creativeVisualizerHost #mixerPerformanceCanvas')).toBeVisible();
  await page.locator('[data-drawing-stamp="❤"]').click(); const pixels = await page.locator('#drawingCanvas').getAttribute('data-pixels');
  await page.locator('#mixerSampleLoop').check(); await page.locator('#mixerSampleSync').uncheck(); await page.locator('#mixerSampleProgram').selectOption('16');
  await page.locator('#generateDrawingMidi').click(); await expect.poll(() => page.evaluate(() => __workspaceQA.launches.length)).toBe(1);
  await view(page, 'automata');
  await expect(page.locator('#automataMidiTools .midiphoria-automata')).toHaveAttribute('open', '');
  await expect(page.locator('#automataMidiGenerate')).toHaveText('Play rule'); await expect(page.locator('#automataMidiPreview')).toBeVisible();
  await expect(page.locator('#drawingCanvas')).toBeHidden(); await expect(page.locator('.mixer-sample-bank')).toBeHidden();
  for (const id of ['mixerSampleLoop', 'mixerSampleSync', 'mixerSampleProgram', 'mixerSampleLevel', 'mixerStopSamples']) await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.locator('#mixerSampleLoop')).toBeChecked(); await expect(page.locator('#mixerSampleSync')).not.toBeChecked(); await expect(page.locator('#mixerSampleProgram')).toHaveValue('16');
  expect((await snapshot(page)).loaded).toEqual([false, false]); expect((await snapshot(page)).playing).toBe(false);
  await view(page, 'draw'); await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', pixels); await expect(page.locator('.mixer-sample-bank')).toBeVisible();
  await view(page, 'mixer'); await expect(page.locator('#tempoFromB')).toBeEnabled();
  await expect(page.locator('#mixerVisualizerHost #mixerPerformanceCanvas')).toBeVisible(); await expect(page.locator('.mixer-sample-bank')).toBeHidden();
  await expect(page.locator('#creativeControlsHost')).toBeHidden(); expect((await snapshot(page)).playing).toBe(false);
  const monitor = page.locator('#mixerPerformanceCanvas'), count = await page.evaluate(() => __workspaceQA.launches.length);
  expect(await monitor.getAttribute('tabindex')).toBeNull(); await monitor.click(); await monitor.dispatchEvent('keydown', { key: 'Enter' });
  expect(await page.evaluate(() => __workspaceQA.launches.length)).toBe(count);
  for (const id of ['mixerPerformanceCanvas', 'mixerSampleLoop', 'mixerSampleSync', 'automataMidiTools']) await expect(page.locator(`#${id}`)).toHaveCount(1);
  await view(page, 'draw'); await page.locator('#mixerStopSamples').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect((await snapshot(page)).contexts).toEqual([]); expect(errors).toEqual([]);
});

test('native stamps and deck playback continue across Draw, Mixer and Automatapoeia with one shared audio context', async ({ page }, testInfo) => {
  test.setTimeout(60000); const errors = await open(page);
  await page.locator('#mixerSampleLoop').check(); await page.locator('#mixerSampleProgram').selectOption('16');
  await arm(page); await page.locator('[data-mixer-sample="square"]').click(); await sounding(page);
  const id = (await snapshot(page)).samples[0].id;
  await view(page, 'mixer'); await expect(page.locator('#tempoFromB')).toBeEnabled(); await sounding(page);
  expect((await snapshot(page)).samples.some(sample => sample.id === id)).toBe(true); expect((await snapshot(page)).playing).toBe(false);
  await page.locator('#mixerPlay').click(); await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#deckMute0').check(); await page.locator('#deckMute1').check();
  await view(page, 'draw'); const before = await snapshot(page);
  await page.locator('#creativeTempo').fill('173'); await expect.poll(async () => (await snapshot(page)).tempo).toBe(173);
  await view(page, 'automata'); await expect(page.locator('#mixerSampleLoop')).toBeChecked(); await sounding(page);
  expect((await snapshot(page)).samples.some(sample => sample.id === id)).toBe(true); expect((await snapshot(page)).playing).toBe(true);
  expect((await snapshot(page)).beat).toBeGreaterThan(before.beat);
  await page.locator('#automataMidiGenerate').click(); await expect.poll(() => page.evaluate(() => __workspaceQA.launches.length)).toBe(2);
  const signal = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 40 });
  expect(signal.summary.finite).toBe(true); expect(signal.summary.maxRms).toBeGreaterThan(.001); expect(signal.summary.clippedSamples).toBe(0);
  expect((await snapshot(page)).contexts).toEqual(['running']);
  await view(page, 'draw'); await view(page, 'mixer'); await expect(page.locator('#masterTempo')).toHaveValue('173');
  await page.locator('#mixerStop').click(); await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);
  expect((await snapshot(page)).samples).toEqual([]);
  // Moving back to the independent Visualize player transfers Audio ownership;
  // revisiting the creative tabs reuses their existing context.
  await view(page, 'visual'); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await snapshot(page)).contexts.filter(state => state === 'running').length).toBe(1);
  await view(page, 'draw'); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await snapshot(page)).contexts.filter(state => state === 'running').length).toBe(1);
  expect((await snapshot(page)).contexts.length).toBe(2); expect((await snapshot(page)).playing).toBe(false);
  await page.locator('[data-mixer-sample="heart"]').click(); await sounding(page);
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await snapshot(page)).samples).toEqual([]);
  await testInfo.attach('workspace-native-audio', { body: JSON.stringify({ signal: signal.summary, final: await snapshot(page) }), contentType: 'application/json' }); expect(errors).toEqual([]);
});

test('returning to Draw with Audio off resumes its silent preview clock after an earlier armed session', async ({ page }) => {
  test.setTimeout(60000); const errors = await open(page); await arm(page);
  await view(page, 'visual'); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await view(page, 'draw'); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-drawing-stamp="wave"]').click(); await page.locator('#generateDrawingMidi').click();
  await expect.poll(async () => (await snapshot(page)).samples.length).toBe(1);
  const sample = (await snapshot(page)).samples[0];
  await expect.poll(async () => (await snapshot(page)).samples.find(item => item.id === sample.id)?.positionBeats).toBeGreaterThan(sample.positionBeats + .2);
  await expect.poll(() => page.locator('#mixerPerformanceCanvas').getAttribute('data-captured-notes').then(Number)).toBeGreaterThan(0);
  expect((await snapshot(page)).audio).toBe(false); expect((await snapshot(page)).playing).toBe(false);
  expect((await snapshot(page)).contexts.length).toBe(2);
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  await expect(page.locator('#drawingCanvas')).toBeVisible(); expect(errors).toEqual([]);
});
