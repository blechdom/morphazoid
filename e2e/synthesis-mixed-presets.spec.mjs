import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope, readAudioStatus } from './helpers/audio-probe.mjs';
import { INSTRUMENT_PRESETS, RANDOMIZABLE_INPUTS } from '../src/instruments/synthesis/instrument-presets.js';
import { voiceTextForEngine } from '../src/instruments/synthesis/voice-texts.js';

const state = page => page.evaluate(() => window.MorphazoidSynthesis.getState());
const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
const current = page => page.locator('#performancePresetHost .instrument-picker-current');
const bank = page => page.locator('#performancePresetHost button[data-preset-id]');
const familyCount = RANDOMIZABLE_INPUTS.length;

async function installSafetyProbe(page) {
  await page.addInitScript(() => {
    window.deviceRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.deviceRequests++; throw new Error('Unexpected device request'); };
    let seed = 89341;
    Math.random = () => {
      if (Number.isFinite(window.nextFamilyDraw)) {
        const value = window.nextFamilyDraw; window.nextFamilyDraw = null; return value;
      }
      return (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
    };
  });
}

async function recall(page, preset) {
  await page.locator('#performancePresetHost summary').click();
  await page.locator('#performancePresetHost').getByRole('button', { name: preset.label, exact: true }).click();
  await expect(current(page)).toHaveText(preset.label);
}

test('the top tour stays global and Next retains its place through input changes and dice', async ({ page }) => {
  await installSafetyProbe(page);
  let fileRequests = 0; page.on('filechooser', () => fileRequests++);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html');
  const labels = INSTRUMENT_PRESETS.map(preset => preset.label);
  for (const input of [...RANDOMIZABLE_INPUTS, 'samples', 'signals']) {
    await choose(page, 'inputCategory', input);
    expect(await bank(page).allTextContents()).toEqual(labels);
    if (input === 'samples' || input === 'signals') {
      await expect(page.locator('[data-select-id="processingSource"] summary')).toBeVisible();
      expect(await page.locator('#processingSource option').count()).toBeGreaterThan(0);
    }
  }
  // A manually chosen source must not reset or narrow the global tour.
  for (let index = 0; index < familyCount; index++) {
    await choose(page, 'inputCategory', index % 2 ? 'singing' : 'speech');
    await page.locator('#nextPerformancePreset').click();
    await expect(current(page)).toHaveText(INSTRUMENT_PRESETS[index].label);
    expect((await state(page)).routing.input).toBe(RANDOMIZABLE_INPUTS[index]);
  }
  for (const [index, input] of RANDOMIZABLE_INPUTS.entries()) {
    await page.evaluate(({ index, familyCount }) => { window.nextFamilyDraw = (index + .5) / familyCount; }, { index, familyCount });
    await page.locator('#randomPerformance').click();
    await expect(current(page)).toHaveText('Preset · Custom');
    expect((await state(page)).routing.input).toBe(input);
  }
  await page.locator('#nextPerformancePreset').click();
  await expect(current(page)).toHaveText(INSTRUMENT_PRESETS[familyCount].label);
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
  expect(await page.evaluate(() => window.deviceRequests)).toBe(0);
  expect(fileRequests).toBe(0);
  expect(errors).toEqual([]);
});

test('mixed preset recalls keep one live output, performer level, and Play/Audio intent', async ({ page }) => {
  test.setTimeout(120_000);
  await installSafetyProbe(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html');
  await page.locator('#outputLevel').evaluate(node => { node.value = '.27'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  for (const preset of INSTRUMENT_PRESETS.slice(0, familyCount)) {
    await page.locator('#nextPerformancePreset').click();
    await expect(current(page)).toHaveText(preset.label);
    await expect.poll(async () => (await status(page)).input.loading, { timeout: 40_000 }).toBe(false);
    await expect.poll(async () => (await sampleAudioEnvelope(page, { durationMs: 500 })).summary.maxRms, { timeout: 8000 }).toBeGreaterThan(.0001);
    expect((await readAudioStatus(page)).connectionCount).toBe(1);
    expect((await state(page)).outputLevel).toBe(.27);
    expect(await status(page)).toMatchObject({ armed: true, playing: true });
    await expect(page.locator('#audioError')).toBeHidden();
  }
  // Random voice auditions repeat beyond their first phrase. Otherwise natural
  // completion would stop host Play and make the following Next stay silent.
  await page.evaluate(() => { window.nextFamilyDraw = .5; });
  await page.locator('#randomPerformance').click();
  await expect.poll(async () => (await status(page)).input.loading, { timeout: 40_000 }).toBe(false);
  const voice = await status(page);
  expect(voice.routing.input).toBe('speech');
  expect(voice.routing.loop).toBe(true);
  expect(voice.input.voice.duration).toBeGreaterThan(0);
  await page.waitForTimeout(voice.input.voice.duration * 1000 + 300);
  expect(await status(page)).toMatchObject({ armed: true, playing: true });
  await page.locator('#nextPerformancePreset').click();
  await expect(current(page)).toHaveText(INSTRUMENT_PRESETS[familyCount].label);
  expect((await sampleAudioEnvelope(page, { durationMs: 700 })).summary.maxRms).toBeGreaterThan(.0001);
  await page.locator('#playButton').click();
  for (const preset of INSTRUMENT_PRESETS.slice(0, familyCount)) {
    await recall(page, preset);
    expect(await status(page)).toMatchObject({ armed: true, playing: false });
  }
  await page.waitForTimeout(250);
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeLessThan(.00001);
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  for (const [index, input] of RANDOMIZABLE_INPUTS.entries()) {
    await page.evaluate(({ index, familyCount }) => { window.nextFamilyDraw = (index + .5) / familyCount; }, { index, familyCount });
    await page.locator('#randomPerformance').click();
    expect((await state(page)).routing.input).toBe(input);
    expect((await state(page)).outputLevel).toBe(.27);
    expect(await status(page)).toMatchObject({ armed: false, playing: true });
  }
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeLessThan(.00001);
  expect(await page.evaluate(() => window.deviceRequests)).toBe(0);
  expect(errors).toEqual([]);
});

test('voice factories restore technique text and playful text reaches native speech and singing inputs', async ({ page }) => {
  await page.goto('/synthesis.html');
  const text = page.locator('#synthesis-voice-1-text');
  for (const [input, engine] of [['speech', 'espeak'], ['speech', 'vizsn'], ['singing', 'singer'], ['singing', 'sinsy']]) {
    await choose(page, 'inputCategory', input);
    await choose(page, 'synthesis-voice-1-method', engine);
    await expect(text).toHaveValue(voiceTextForEngine(engine));
    const textPreset = engine === 'sinsy' ? 'kana-pulse' : 'lip-bits';
    await choose(page, 'synthesis-voice-1-text-preset', textPreset);
    await expect.poll(async () => (await state(page)).routing.voice.text).not.toBe(voiceTextForEngine(engine));
    const voice = (await state(page)).routing.voice;
    if (input === 'singing') expect(voice.scene.input.singingText).toBe(voice.text);
    if (engine === 'vizsn') expect(voice.scene.input).toMatchObject({ mode: 'text', text: voice.text });
    await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
    await expect(text).toHaveValue(voiceTextForEngine(engine));
    await expect(page.locator('#audioError')).toBeHidden();
  }
  await choose(page, 'inputCategory', 'speech');
  await choose(page, 'synthesis-voice-1-method', 'mea8000');
  await expect(text).toHaveCount(0);
  await expect(page.locator('.synthesis-voice-hint')).toContainText('parameter frames');
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
});
