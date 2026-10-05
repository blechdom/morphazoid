import { test, expect } from '@playwright/test';
import { INSTRUMENT_PRESETS } from '../src/instruments/synthesis/instrument-presets.js';
import { choose } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());

test('new statistical voice performances have headroom before host output limiting', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/synthesis.html');
  // These two earlier candidate factory configurations clipped in native PCM;
  // checking only the host's bounded meter concealed that upstream distortion.
  for (const id of ['performance:spectral-grammar', 'performance:kana-vowel-orbit']) {
    const voice = INSTRUMENT_PRESETS.find(preset => preset.id === id).snapshot.routing.voice;
    for (let repeat = 0; repeat < 3; repeat++) {
      const measured = await page.evaluate(voice => new Promise((resolve, reject) => {
        const worker = new Worker('/src/instruments/voicesaurus/native-worker.js', { type: 'module' });
        const finish = (error, result) => {
          clearTimeout(timer); worker.terminate();
          if (error) reject(new Error(error)); else resolve(result);
        };
        const timer = setTimeout(() => finish('Native voice render timed out'), 30_000);
        worker.onerror = event => finish(event.message);
        worker.onmessage = ({ data }) => {
          if (data.type !== 'ready') { finish(data.message || 'Native voice render failed'); return; }
          let peak = 0, sum = 0, finite = true;
          for (const sample of data.samples) {
            finite &&= Number.isFinite(sample); peak = Math.max(peak, Math.abs(sample)); sum += sample * sample;
          }
          finish(null, { finite, peak, rms: Math.sqrt(sum / data.samples.length) });
        };
        worker.postMessage({ ...voice.scene, text: voice.text });
      }), voice);
      expect(measured.finite, id).toBe(true);
      expect(measured.rms, id).toBeGreaterThan(.0001);
      expect(measured.peak, id).toBeLessThan(.9);
    }
  }
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
});

async function sounding(page, label, { continuous = false } = {}) {
  // Native speech/score rendering and bundled recordings load asynchronously;
  // keep Play running while waiting for the newly selected source, not a timer.
  await expect.poll(async () => (await status(page)).input.loading, { timeout: 40_000 }).toBe(false);
  await expect(page.locator('#audioError')).toBeHidden();
  const measured = await sampleAudioEnvelope(page, { durationMs: 950, intervalMs: 50 });
  expect(measured.summary.finite, label).toBe(true);
  expect(measured.summary.maxRms, label).toBeGreaterThan(.0001);
  expect(measured.summary.maxPeak, label).toBeLessThanOrEqual(1);
  // The first test-signal preset must supply new audio, not merely inherit the
  // previous synth's meter sample or release tail during the handoff.
  if (continuous) {
    expect(Math.max(...measured.samples.slice(-4).map(sample => sample.rms)), label).toBeGreaterThan(.001);
  }
  expect(await status(page)).toMatchObject({ armed: true, playing: true });
}

test('Next sounds every whole-instrument preset across synth, speech and singing without restarting Play', async ({ page }) => {
  test.setTimeout(60_000 + INSTRUMENT_PRESETS.length * 5_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  // Include wrapping from the final musical patch back to the first synth score.
  for (const preset of [...INSTRUMENT_PRESETS, INSTRUMENT_PRESETS[0]]) {
    await page.locator('#nextPerformancePreset').click();
    await expect(page.locator('#performancePresetHost .instrument-picker-current')).toHaveText(preset.label);
    await sounding(page, preset.label, { continuous: preset.snapshot.sound.methodId === 'fx-biquad' });
  }
  expect(errors).toEqual([]);
});

test('whole-instrument dice and local Next/dice remain audible after a test-signal preset', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    let seed = 214;
    Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  });
  await page.goto('/synthesis.html?method=fx-biquad');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  for (let index = 0; index < 12; index++) {
    await page.locator('#randomPerformance').click();
    await sounding(page, 'whole-instrument dice ' + index);
  }
  await choose(page, 'inputCategory', 'synthesis');
  await choose(page, 'methodSelect', 'additive');
  await choose(page, 'sequenceSelect', 'rotating-euclidean-chords');
  for (const id of ['nextPreset', 'randomMethod', 'nextSequencePreset', 'randomSequencePreset']) {
    await page.locator('#' + id).click();
    await sounding(page, id);
  }
});

test('Next and dice preserve deliberately paused transport and never arm Audio', async ({ page }) => {
  test.setTimeout(30_000 + INSTRUMENT_PRESETS.length * 2_000);
  await page.goto('/synthesis.html');
  for (const preset of INSTRUMENT_PRESETS) {
    await page.locator('#nextPerformancePreset').click();
    expect(await status(page), preset.label).toMatchObject({ armed: false, playing: false });
  }
  await page.locator('#randomPerformance').click();
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await page.locator('#nextPerformancePreset').click();
  await page.locator('#randomPerformance').click();
  expect(await status(page)).toMatchObject({ armed: true, playing: false });
  const paused = await sampleAudioEnvelope(page, { durationMs: 450 });
  expect(paused.summary.maxRms).toBeLessThan(.00001);
});
