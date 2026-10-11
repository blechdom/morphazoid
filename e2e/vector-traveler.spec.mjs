import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const TAU = Math.PI * 2;
const snapshot = page => page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).diagnosticSnapshot());
const ready = page => expect.poll(async () => {
  const s = await snapshot(page);
  return s.ready && !s.building && s.trace.ready && !s.contours.navigation.pending;
}, { timeout: 40000 }).toBe(true);
const range = (page, id, value) => page.locator(`#${id}`).evaluate((node, value) => {
  node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

async function travelerPreset(page) {
  const menu = page.locator('.header-preset-picker');
  if (!await menu.evaluate(node => node.open)) await menu.locator(':scope > summary').click();
  await menu.locator('[data-full-preset][data-preset-id="traveler"]').click();
  await ready(page);
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'traveler');
}

// Read the rendered head over real elapsed traversal, without seeking or
// substituting geometry. A circle makes the seam and turning sign observable.
async function collectTurns(page) {
  return page.evaluate(async () => {
    const { diagnosticSnapshot } = await import('/src/instruments/vector-fractals/app.js');
    const samples = [], start = diagnosticSnapshot().trace.travel;
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      const s = diagnosticSnapshot();
      const head = s.contours.renderer.traceHeads.find(head => head.index === 2);
      samples.push({ travel: s.trace.travel, phase: s.tracePhase, turn: head?.turn, heading: head?.heading });
      if (s.trace.travel - start >= 1.2) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return samples;
  });
}

function expectContinuousLap(samples, direction) {
  expect(samples.length).toBeGreaterThan(5);
  expect(samples.every(s => Number.isFinite(s.turn) && Number.isFinite(s.heading))).toBe(true);
  const first = samples[0], last = samples.at(-1), travel = last.travel - first.travel;
  expect(travel).toBeGreaterThanOrEqual(1.2);
  expect((last.turn - first.turn) / travel).toBeCloseTo(direction * TAU, 1);
  let seams = 0;
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1], after = samples[i];
    if (before.phase > .85 && after.phase < .15 && after.travel - before.travel < .15) {
      seams++;
      // A wrapped heading would jump by about 2π at this boundary.
      expect(Math.abs(after.turn - before.turn)).toBeLessThan(1);
      expect(direction * (after.turn - before.turn)).toBeGreaterThanOrEqual(-.03);
    }
  }
  expect(seams).toBeGreaterThan(0);
}

test('Traveler controls preserve layer choices and silent transport', async ({ page }) => {
  test.setTimeout(90000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  await expect(page.locator('#travelerControls')).toBeHidden();
  await page.locator('#layerVoice1').selectOption('glass');
  await page.locator('#layerDrums0').check();
  await page.locator('#layerDrumVoice0').selectOption('metal');
  await page.locator('#playButton').click();
  const before = await snapshot(page);
  await page.locator('#contourReader').selectOption('traveler'); await ready(page);
  await expect(page.locator('#travelerControls')).toBeVisible();
  await expect(page.locator('#travelerReadout')).toBeVisible();
  await expect(page.locator('#travelerOctaves')).toHaveValue('1');
  await page.locator('#travelerDirection').selectOption('counterclockwise'); await ready(page);
  await range(page, 'travelerOctaves', 2.5);
  let s = await snapshot(page);
  expect(s.trace.reader).toBe('traveler');
  expect(s.state.travelerDirection).toBe('counterclockwise');
  expect(s.state.travelerOctaves).toBe(2.5);
  expect(s.contours.request).toBe(before.contours.request);
  expect(s.state.layerVoices).toEqual(before.state.layerVoices);
  expect(s.state.layerDrums).toEqual(before.state.layerDrums);
  expect(s.state.layerDrumVoices).toEqual(before.state.layerDrumVoices);
  expect(s.trace.travel).toBeGreaterThan(before.trace.travel);
  expect(s.playing).toBe(true); expect(s.armed).toBe(false); expect(s.audioTime).toBeNull();
  await range(page, 'travelerOctaves', 0);
  expect((await snapshot(page)).state.travelerOctaves).toBe(0);
  await page.locator('#contourReader').selectOption('radar'); await ready(page);
  await expect(page.locator('#travelerControls')).toBeHidden();
  await expect(page.locator('#travelerReadout')).toBeHidden();
  await page.locator('#contourReader').selectOption('traveler'); await ready(page);
  await expect(page.locator('#travelerDirection')).toHaveValue('counterclockwise');
  await expect(page.locator('#travelerOctaves')).toHaveValue('0');
  await travelerPreset(page);
  s = await snapshot(page);
  expect(s.state.contourReader).toBe('traveler');
  expect(s.state.layerVoices.every(voice => voice === 'shepard')).toBe(true);
  expect(s.playing).toBe(true); expect(s.armed).toBe(false); expect(s.audioTime).toBeNull();
  expect(errors).toEqual([]);
});

test('a marching-squares circle accumulates signed turns through the seam and releases live audio', async ({ page }, testInfo) => {
  test.setTimeout(110000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('vector-fractals.html#explorer'); await ready(page);
  await travelerPreset(page);
  await page.locator('#contourDomain').selectOption('julia'); await ready(page);
  await page.locator('#contourJuliaPreset').selectOption('circle'); await ready(page);
  await range(page, 'traceRate', 1);
  let s = await snapshot(page);
  expect(s.trace.layers).toHaveLength(3);
  expect(s.trace.layers.every(layer => layer.closed && layer.samples > 0)).toBe(true);
  for (const layer of s.trace.layers) expect(layer.turnPerLap).toBeCloseTo(-TAU, 4);
  expect(s.audioTime).toBeNull();
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  expect((await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 40 })).summary.maxPeak).toBeLessThan(.001);
  await page.locator('#playButton').click(); await page.waitForTimeout(250);
  const clockwise = await collectTurns(page);
  expectContinuousLap(clockwise, -1);
  const sounding = await sampleAudioEnvelope(page, { durationMs: 300, intervalMs: 40 });
  expect(sounding.summary.finite).toBe(true); expect(sounding.summary.maxPeak).toBeGreaterThan(.003);
  expect(sounding.summary.clippedSamples).toBe(0);
  const before = await snapshot(page);
  await page.locator('#travelerDirection').selectOption('counterclockwise'); await ready(page);
  s = await snapshot(page);
  expect(s.playing && s.armed).toBe(true);
  expect(s.trace.travel).toBeGreaterThanOrEqual(before.trace.travel);
  expect(s.contours.request).toBe(before.contours.request);
  for (const layer of s.trace.layers) expect(layer.turnPerLap).toBeCloseTo(TAU, 4);
  const counterclockwise = await collectTurns(page);
  expectContinuousLap(counterclockwise, 1);
  for (const amount of [0, 2, 4]) {
    await range(page, 'travelerOctaves', amount); await page.waitForTimeout(180);
    expect((await snapshot(page)).state.travelerOctaves).toBe(amount);
    const audio = await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 40 });
    expect(audio.summary.finite).toBe(true); expect(audio.summary.maxPeak).toBeGreaterThan(.001);
    expect(audio.summary.clippedSamples).toBe(0);
  }
  await page.locator('#playButton').click(); await page.waitForTimeout(550);
  const paused = await snapshot(page); await page.waitForTimeout(150);
  expect((await snapshot(page)).trace.travel).toBeCloseTo(paused.trace.travel, 5);
  expect((await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 40 })).summary.maxPeak).toBeLessThan(.001);
  const heldPitch = (await snapshot(page)).trace.travelerState.pitch;
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).audioTime).toBeNull();
  await page.locator('#playButton').click(); await page.waitForTimeout(400);
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  await page.waitForTimeout(200);
  const resumed = await snapshot(page);
  for (let i = 0; i < 3; i++) expect(resumed.trace.travelerState.pitch[i]).toBeCloseTo(heldPitch[i], 4);
  expect(resumed.playing).toBe(false);
  await page.locator('#playButton').click(); await page.waitForTimeout(250);
  expect((await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 40 })).summary.maxPeak).toBeGreaterThan(.001);
  for (let i = 0; i < 3; i++) await page.locator(`#layerEnabled${i}`).uncheck();
  await page.waitForTimeout(550);
  expect((await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 40 })).summary.maxPeak).toBeLessThan(.001);
  expect((await snapshot(page)).playing && (await snapshot(page)).armed).toBe(true);
  await page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).dispose());
  expect((await snapshot(page)).audioTime).toBeNull();
  await testInfo.attach('traveler-turns.json', { body: JSON.stringify({ clockwise, counterclockwise, sounding: sounding.summary }), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`Traveler layout ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, ...(viewport.width < 1000 ? { hasTouch: true, isMobile: true } : {}) });
    test('controls remain reachable and transport retains an explicit Audio arm', async ({ page }, testInfo) => {
      test.setTimeout(80000);
      await page.goto('vector-fractals.html#explorer'); await ready(page);
      await page.locator('#contourReader').selectOption('traveler'); await ready(page);
      for (const id of ['contourReader', 'travelerDirection', 'travelerOctaves', 'traceRate', 'layerVoice2']) {
        const control = page.locator(`#${id}`);
        await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      for (const id of ['audioButton', 'playButton']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        const box = await page.locator(`#${id}`).boundingBox();
        if (viewport.width < 1000 || id === 'playButton') {
          expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
        }
      }
      await page.locator('#travelerDirection').selectOption('counterclockwise'); await ready(page);
      await page.locator('#playButton').click();
      const s = await snapshot(page);
      expect(s.playing).toBe(true); expect(s.armed).toBe(false); expect(s.audioTime).toBeNull();
      await page.locator('#travelerReadout').scrollIntoViewIfNeeded();
      await expect(page.locator('#travelerReadout')).toBeVisible();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath('traveler-layout.png'), fullPage: true });
    });
  });
}
