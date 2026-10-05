import { test, expect } from '@playwright/test';
import { choose, exact } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope, readAudioStatus } from './helpers/audio-probe.mjs';
import { PERCUSSION_METHODS } from '../src/instruments/synthesis/percussion-state.js';
import { PERCUSSION_INSTRUMENT_PRESETS } from '../src/instruments/synthesis/instrument-presets.js';

const state = page => page.evaluate(() => window.MorphazoidSynthesis.getState());
const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
async function sounding(page, durationMs = 650) {
  const result = await sampleAudioEnvelope(page, { durationMs });
  expect(result.summary.finite).toBe(true); expect(result.summary.clippedSamples).toBe(0);
  expect(result.summary.maxRms).toBeGreaterThan(.0001);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`percussion controls, pads and paintable rhythm at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    test.setTimeout(90_000); await page.setViewportSize(viewport);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/synthesis.html?method=fm&sequence=basic-up'); await choose(page, 'inputCategory', 'percussion');
    await expect(page.locator('#drumDetail')).toBeVisible();
    await expect(page.locator('#voiceDetail')).toBeHidden();
    await expect(page.locator('#envelopeDetails')).toBeHidden();
    await expect(page.locator('#transportTiming')).toBeVisible();
    await expect(page.locator('#processorEnabled')).toBeEnabled();
    const before = (await state(page)).routing.percussion;
    await page.locator('#playButton').click();
    await page.locator('.synthesis-drum-pad').first().click();
    expect(await status(page)).toMatchObject({ armed: false, playing: true });
    await page.locator('#drumKitNext').click();
    expect((await state(page)).routing.percussion.steps).toEqual(before.steps);
    const kit = (await state(page)).routing.percussion.voices;
    await page.locator('#drumRhythmNext').click();
    expect((await state(page)).routing.percussion.voices).toEqual(kit);
    await page.locator('#drumKitRandom').click();
    expect((await state(page)).routing.percussion.kitId).toBe('custom');
    await page.locator('#drumRhythmRandom').click();
    expect((await state(page)).routing.percussion.rhythmId).toBe('custom');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator('#drumClear').click();
    const first = page.locator('.synthesis-drum-step[data-lane="0"][data-step="0"]');
    const fourth = page.locator('.synthesis-drum-step[data-lane="0"][data-step="3"]');
    await first.scrollIntoViewIfNeeded(); const a = await first.boundingBox(), b = await fourth.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.up();
    expect((await state(page)).routing.percussion.steps[0].slice(0, 4)).toEqual([.75, .75, .75, .75]);
    await page.locator('#drumUndo').click(); expect((await state(page)).routing.percussion.steps[0].every(value => value === 0)).toBe(true);
    await first.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
    expect((await state(page)).routing.percussion.steps[0][1]).toBe(.75);
    await page.locator('#drumUndo').click();
    await page.locator('#drumRhythmNext').click();
    await page.locator('#audioButton').click(); await expect.poll(async () => (await status(page)).armed).toBe(true);
    await sounding(page);
    await expect.poll(() => page.locator('.synthesis-drum-step.is-current').count()).toBe(8);
    const beat = (await status(page)).sequence.transportBeat;
    await page.locator('#drumKitNext').click();
    expect((await status(page)).sequence.transportBeat).toBeGreaterThan(beat);
    await sounding(page);
    await page.locator('#playButton').click();
    expect(await status(page)).toMatchObject({ armed: true, playing: false });
    await page.locator('.synthesis-drum-pad[data-lane="1"]').click(); await sounding(page, 250);
    await choose(page, 'inputCategory', 'synthesis');
    await expect(page.locator('#drumDetail')).toBeHidden();
    await page.locator('#playButton').click();
    await expect.poll(async () => (await status(page)).sequence.audio.studyId).toBe('basic-up');
    await sounding(page);
    await page.locator('#playButton').click();
    await choose(page, 'inputCategory', 'percussion');
    expect((await status(page)).playing).toBe(false);
    await page.locator('#playButton').click(); await sounding(page);
    await page.locator('#audioButton').click();
    expect(await status(page)).toMatchObject({ armed: false, playing: true });
    expect(errors).toEqual([]);
  });
}

test('all drum techniques and complete presets play without rearming, with optional effects and MIDI', async ({ page }) => {
  test.setTimeout(120_000); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html'); await choose(page, 'inputCategory', 'percussion');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  await expect.poll(async () => (await status(page)).sequence.audio.playing).toBe(true);
  for (const method of PERCUSSION_METHODS) {
    await choose(page, 'drumMethod', method.id);
    for (const kit of method.kits) { await choose(page, 'drumKit', kit.id); await sounding(page, 900); }
    await page.locator('#drumKitRandom').click(); await page.locator('#drumRhythmRandom').click(); await sounding(page);
    await expect(page.locator('#audioError')).toBeHidden();
  }
  await exact(page, '#tempo-value', 143);
  await page.locator('#processorEnabled').check(); await choose(page, 'processorMethod', 'fx-delay'); await sounding(page);
  await page.locator('#processorEnabled').uncheck();
  const picker = page.locator('#performancePresetHost');
  for (const preset of PERCUSSION_INSTRUMENT_PRESETS.filter((_, index) => index % 3 === 0)) {
    await picker.locator('summary').click();
    await picker.locator('.instrument-picker-search-input').fill(preset.label);
    await picker.getByRole('button', { name: preset.label, exact: true }).click();
    expect((await state(page)).routing.percussion).toEqual(preset.snapshot.routing.percussion);
    expect(await status(page)).toMatchObject({ armed: true, playing: true }); await sounding(page);
  }
  // A deliberate main-thread stall cannot stall the worklet's musical clock.
  const before = (await status(page)).sequence.audio.beat;
  await page.evaluate(() => { const end = performance.now() + 350; while (performance.now() < end) {} });
  await expect.poll(async () => (await status(page)).sequence.audio.beat).toBeGreaterThan(before + .3);
  await sounding(page);
  await page.locator('#playButton').click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('morphazoid:midi-input', { detail: { routeId: 'synthesis', message: { type: 'noteOn', note: 38, velocity: 110 } } })));
  await sounding(page, 250);
  await page.locator('#audioButton').click(); await page.locator('#audioButton').click();
  await page.locator('#playButton').click(); await sounding(page);
  expect(errors).toEqual([]);
});

test('host first-hit startup and complete drum recalls retain atomic clock ownership', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const Native = window.AudioWorkletNode; window.drumMessages = [];
    window.AudioWorkletNode = class extends Native {
      constructor(...args) {
        super(...args); if (args[1] !== 'roads-synthesis') return;
        const send = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, ...rest) => { window.drumMessages.push(structuredClone(message)); return send(message, ...rest); };
      }
    };
  });
  await page.goto('/synthesis.html?method=fm&sequence=basic-up'); await choose(page, 'inputCategory', 'percussion');
  expect((await status(page)).armed).toBe(false);
  // Emulates the explicit host-MIDI Audio-arm exception, not a browser gesture.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('morphazoid:midi-input', { detail: { source: 'wax', routeId: 'synthesis', message: { type: 'noteOn', note: 36, velocity: 100 } } })));
  await expect.poll(() => page.evaluate(() => window.drumMessages.filter(message => message.type === 'drum-hit').length)).toBe(1);
  expect((await status(page)).armed).toBe(true);
  await page.locator('#playButton').click(); await sounding(page);
  await page.evaluate(() => { window.drumMessages.length = 0; });
  const preset = PERCUSSION_INSTRUMENT_PRESETS[4];
  await page.locator('#performancePresetHost summary').click();
  await page.locator('#performancePresetHost').getByRole('button', { name: preset.label, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.drumMessages.filter(message => message.type === 'sequence-swap').length)).toBe(1);
  expect(await page.evaluate(() => window.drumMessages.filter(message => message.type === 'state').length)).toBe(0);
  expect((await state(page)).routing.percussion).toEqual(preset.snapshot.routing.percussion);
  await sounding(page);
  // Restore an arp through an intermediate external-input route as well.
  await page.locator('#playButton').click(); await choose(page, 'inputCategory', 'synthesis');
  await choose(page, 'sequenceSelect', 'basic-up'); await choose(page, 'inputCategory', 'percussion');
  await choose(page, 'inputCategory', 'signals'); await choose(page, 'inputCategory', 'synthesis');
  await page.locator('#playButton').click();
  await expect.poll(async () => (await status(page)).sequence.audio.studyId).toBe('basic-up');
  await sounding(page);
});
