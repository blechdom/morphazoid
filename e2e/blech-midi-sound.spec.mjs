import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

async function open(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    globalThis.__blechSoundQA = { engine: null, contexts: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __blechSoundQA.contexts.push(this); } };
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaVolume=MidiMixerEngine.prototype.setVolume;
      MidiMixerEngine.prototype.setVolume=function(...args){__blechSoundQA.engine=this;return qaVolume.apply(this,args);};` });
  });
  await page.goto('/blech-midi.html'); await expect(page.locator('#mixerStampCount')).toHaveText('58 / 58');
  await page.locator('[data-blech-tab="sound"]').click(); await page.locator('#mixerEffects > summary').click(); return errors;
}
const state = page => page.evaluate(() => { const state = __blechSoundQA.engine.state; return { audio: state.audioEnabled, effects: state.effects,
  samples: state.samples.map(({ id, positionBeats }) => ({ id, positionBeats })), font: state.soundfontName, contexts: __blechSoundQA.contexts.map(context => context.state) }; });
async function input(page, id, value, event = 'input') {
  await page.locator(`#${id}`).evaluate((node, detail) => { node.value = String(detail.value); node.dispatchEvent(new Event(detail.event, { bubbles: true })); }, { value, event });
}
async function audible(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.001);
  const result = await sampleAudioEnvelope(page, { durationMs: 400, intervalMs: 30 });
  expect(result.summary.finite).toBe(true); expect(result.summary.clippedSamples).toBe(0); expect(result.summary.maxPeak).toBeLessThanOrEqual(.981);
  return result.summary;
}

test('Blech MIDI imports SoundFonts, changes live effects and restores default sound without arming implicitly or losing loops', async ({ page }, testInfo) => {
  test.setTimeout(60000); const errors = await open(page);
  const font = fileURLToPath(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
  await page.locator('#mixerSoundFont').setInputFiles(font); await expect(page.locator('#mixerFontName')).toContainText('TimGM6mb1.sf2');
  expect((await state(page)).contexts).toEqual([]); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#mixerSampleProgram').selectOption('16');
  await page.locator('[data-blech-tab="stamps"]').click(); await page.locator('[data-stamp-loop="square"]').check();
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  await page.locator('[data-mixer-sample="square"]').click(); const before = await audible(page), sent = (await state(page)).samples[0].id;
  await page.locator('[data-blech-tab="sound"]').click(); await input(page, 'mixerFilterExact', 60, 'change');
  await expect.poll(async () => (await state(page)).effects.filterHz).toBe(60);
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeLessThan(before.maxRms * .3);
  await input(page, 'mixerFilterExact', 20000, 'change'); const restored = await audible(page);
  await input(page, 'mixerEcho', .35); await input(page, 'mixerEchoExact', 1.5, 'change'); await input(page, 'mixerFeedback', .45);
  expect((await state(page)).effects).toEqual(expect.objectContaining({ delayMix: .35, delayBeats: 1.5, feedback: .45 }));
  await page.locator('#mixerEffectsReset').click();
  expect((await state(page)).effects).toEqual(expect.objectContaining({ filterHz: 20000, delayMix: 0, delayBeats: .5, feedback: .3, synth: {} }));
  await page.locator('#mixerDefaultFont').click(); await expect(page.locator('#mixerFontName')).toHaveText('TimGM6mb'); await audible(page);
  expect((await state(page)).samples.some(sample => sample.id === sent)).toBe(true); expect((await state(page)).contexts).toEqual(['running']);
  await page.locator('#mixerSoundFont').setInputFiles({ name: 'invalid.sf2', mimeType: 'application/octet-stream', buffer: Buffer.from('This is not a SoundFont') });
  await expect(page.locator('#mixerFontStatus')).toContainText(/not an SF2|not a SoundFont|invalid/i); await audible(page);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await expect.poll(() => page.evaluate(() => __blechSoundQA.contexts.every(context => context.state === 'closed'))).toBe(true);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#mixerEffects, #mixerSoundFont, #mixerEffectsReset')).toHaveCount(3);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect((await state(page)).samples).toEqual([]);
  await testInfo.attach('native-font-filter-effects', { body: JSON.stringify({ before, restored, final: await state(page) }), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`expanded Blech MIDI sound controls fit ${viewport.width}×${viewport.height}`, async ({ browser }, testInfo) => {
    const coarse = viewport.width < 1000, context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, hasTouch: coarse, isMobile: coarse });
    const page = await context.newPage();
    try {
      const errors = await open(page);
      for (const id of ['mixerFilter', 'mixerEcho', 'mixerFeedback', 'mixerDefaultFont', 'mixerEffectsReset']) {
        const control = page.locator(`#${id}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
        const bounds = await control.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
        if (coarse) { expect(bounds.width).toBeGreaterThanOrEqual(48); expect(bounds.height).toBeGreaterThanOrEqual(48); }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await page.locator('#mixerEffects').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.locator('#mixerEffects').screenshot({ path: testInfo.outputPath('sound-controls.png') });
      expect((await state(page)).contexts).toEqual([]); expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
