import { test, expect } from '@playwright/test';
import { INSTRUMENT_PRESETS, RANDOMIZABLE_INPUTS, randomizeInstrumentPreset } from '../src/instruments/synthesis/instrument-presets.js';
import { inputsForCategory } from '../src/instruments/synthesis/signal-path.js';
import { sampleAudioEnvelope, readAudioStatus, waitForStableAudioState } from './helpers/audio-probe.mjs';

const sampleInputs = inputsForCategory('samples');
const sampleFamilyDraw = (RANDOMIZABLE_INPUTS.indexOf('samples') + .5) / RANDOMIZABLE_INPUTS.length;
const state = page => page.evaluate(() => window.MorphazoidSynthesis.getState());
const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());

// Plan seeds through the public musical-state function, then exercise those
// same rolls through the real button. Hash the starting seeds so adjacent
// trials explore different processors as well as different recordings.
function samplePlans() {
  const plans = new Map();
  for (let trial = 1; trial < 2000 && plans.size < sampleInputs.length; trial++) {
    let seed = Math.imul(trial ^ trial >>> 16, 0x7feb352d);
    seed = Math.imul(seed ^ seed >>> 15, 0x846ca68b);
    seed = (seed ^ seed >>> 16) >>> 0;
    let cursor = seed, first = true;
    const snapshot = randomizeInstrumentPreset({}, () => {
      if (first) { first = false; return sampleFamilyDraw; }
      return (cursor = Math.imul(cursor, 1664525) + 1013904223 >>> 0) / 4294967296;
    });
    if (snapshot.routing.input === 'samples' && !plans.has(snapshot.routing.selection)) {
      plans.set(snapshot.routing.selection, { seed, snapshot });
    }
  }
  return [...plans.values()];
}

const plans = samplePlans();

async function installSampleDice(page) {
  await page.addInitScript(({ familyDraw }) => {
    let seed = 89341, nextFamilyDraw = null;
    window.sampleRandomDeviceRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.sampleRandomDeviceRequests++;
      throw new Error('Unexpected device request');
    };
    window.prepareSampleRandom = value => { seed = value; nextFamilyDraw = familyDraw; };
    Math.random = () => {
      if (nextFamilyDraw !== null) {
        const value = nextFamilyDraw; nextFamilyDraw = null; return value;
      }
      return (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
    };
  }, { familyDraw: sampleFamilyDraw });
}

async function rollSample(page, plan) {
  await page.evaluate(seed => window.prepareSampleRandom(seed), plan.seed);
  await page.locator('#randomPerformance').click();
  await expect(page.locator('#performancePresetHost .instrument-picker-current')).toHaveText('Preset · Custom');
  const recalled = await state(page);
  expect(recalled.routing).toMatchObject({
    input: 'samples', selection: plan.snapshot.routing.selection, loop: true, effectEnabled: true,
    effect: { methodId: plan.snapshot.sound.methodId, presetId: 'custom', source: 0, bypass: false },
  });
  expect(recalled.methodId).toBe(plan.snapshot.sound.methodId);
  expect(recalled.params).toEqual(plan.snapshot.sound.params.map(value => expect.closeTo(value, 12)));
  expect(recalled.voiceMode).toBe('mono');
  expect(recalled.outputLevel).toBe(.61);
  await expect(page.locator('#inputCategory')).toHaveValue('samples');
  await expect(page.locator('#processingSource')).toHaveValue(plan.snapshot.routing.selection);
  expect((await status(page)).sequence.id).toBe('none');
}

test('main dice explores every bundled recording with fresh processing and preserves Audio, Play and output', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  expect(new Set(plans.map(plan => plan.snapshot.routing.selection))).toEqual(new Set(sampleInputs.map(input => input.id)));
  expect(new Set(plans.map(plan => plan.snapshot.sound.methodId)).size).toBeGreaterThanOrEqual(6);
  await installSampleDice(page);
  let fileRequests = 0; page.on('filechooser', () => fileRequests++);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html');
  await page.locator('#outputLevel').evaluate(node => { node.value = '.61'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#nextPerformancePreset').click();
  await expect(page.locator('#performancePresetHost .instrument-picker-current')).toHaveText(INSTRUMENT_PRESETS[0].label);

  await rollSample(page, plans[0]);
  expect(await status(page)).toMatchObject({ armed: false, playing: false, input: { kind: 'none' } });
  await page.locator('#playButton').click();
  await rollSample(page, plans[1]);
  expect(await status(page)).toMatchObject({ armed: false, playing: true, input: { kind: 'none' } });
  expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeLessThan(.00001);

  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  await rollSample(page, plans[2]);
  await expect.poll(() => status(page)).toMatchObject({ armed: true, playing: false, input: { loading: false } });
  await waitForStableAudioState(page, false);
  expect((await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms).toBeLessThan(.00001);

  await page.locator('#playButton').click();
  const measurements = [];
  for (const plan of plans) {
    await rollSample(page, plan);
    await expect.poll(() => status(page), { timeout: 15_000 }).toMatchObject({
      armed: true, playing: true, section: 'processing',
      input: { selection: plan.snapshot.routing.selection, source: 0, kind: 'file', loading: false },
    });
    const measured = await sampleAudioEnvelope(page, {
      // Birdsong has a quiet lead-in; cover the complete field-recording loop.
      durationMs: plan.snapshot.routing.selection === 'birdsong' ? 6000 : 1700,
    });
    measurements.push({ seed: plan.seed, source: plan.snapshot.routing.selection, effect: plan.snapshot.sound.methodId, ...measured.summary });
    expect(measured.summary.finite, plan.snapshot.routing.selection).toBe(true);
    expect(measured.summary.maxRms, plan.snapshot.routing.selection).toBeGreaterThan(.001);
    expect(measured.summary.maxPeak, plan.snapshot.routing.selection).toBeLessThan(1);
    expect(measured.summary.clippedSamples, plan.snapshot.routing.selection).toBe(0);
    expect((await readAudioStatus(page)).connectionCount).toBe(1);
    expect(await status(page)).toMatchObject({ armed: true, playing: true });
    await expect(page.locator('#audioError')).toBeHidden();
  }

  // Dice leaves the ordinary preset cursor intact, including a transition
  // away from a recording and back while transport remains running.
  await page.locator('#nextPerformancePreset').click();
  await expect(page.locator('#performancePresetHost .instrument-picker-current')).toHaveText(INSTRUMENT_PRESETS[1].label);
  expect(await status(page)).toMatchObject({ armed: true, playing: true });
  await rollSample(page, plans[0]);
  await expect.poll(() => status(page)).toMatchObject({ input: { kind: 'file', loading: false } });
  await page.locator('#audioButton').click();
  await rollSample(page, plans[1]);
  expect(await status(page)).toMatchObject({ armed: false, playing: true });
  await waitForStableAudioState(page, false);
  expect((await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms).toBeLessThan(.00001);
  expect(await page.evaluate(() => window.sampleRandomDeviceRequests)).toBe(0);
  expect(fileRequests).toBe(0);
  expect(errors).toEqual([]);
  await testInfo.attach('random-sample-levels.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

test('main sample dice remains reachable on a phone without arming Audio', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installSampleDice(page);
  await page.goto('/synthesis.html');
  await page.locator('#outputLevel').evaluate(node => { node.value = '.61'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  for (const plan of [plans[0], plans.at(-1)]) {
    await rollSample(page, plan);
    await expect(page.locator('#randomPerformance')).toBeVisible();
    await expect(page.locator('#playButton')).toBeVisible();
    expect(await status(page)).toMatchObject({ armed: false, playing: false, input: { kind: 'none' } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(await page.evaluate(() => window.sampleRandomDeviceRequests)).toBe(0);
});
