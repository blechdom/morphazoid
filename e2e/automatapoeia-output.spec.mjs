import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const source = await readFile(new URL('../src/families/experiments/experiments-app.js', import.meta.url), 'utf8');
const declaration = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .find(node => node.type === 'ClassDeclaration' && node.id.name === 'ExperimentAudio');
const audioClass = source.slice(declaration.start, declaration.end);

test('production output graph restores 12 dB, preserves quiet waveforms and bounds overloads', async ({ page }, testInfo) => {
  const measurements = await page.evaluate(async classSource => {
    const render = async (experiment, amplitude, level = .48, sampleRate = 48000) => {
      const context = new OfflineAudioContext(1, sampleRate, sampleRate);
      // Offline rendering has no user-activation/suspension lifecycle.
      context.resume = async () => {};
      const Audio = new Function('globalThis', 'experiment', 'connectAudioOutput', 'unlockAudioContext',
        `return (${classSource})`)({ AudioContext: function () { return context; } }, experiment,
        (ctx, output) => { output.connect(ctx.destination); return () => output.disconnect(); }, () => {});
      const audio = new Audio();
      audio.level = level;
      await audio.start();
      const input = context.createOscillator();
      const gain = context.createGain();
      input.frequency.value = 431;
      gain.gain.value = amplitude;
      input.connect(gain).connect(audio.master);
      input.start(.05);
      input.stop(.7);
      const samples = (await context.startRendering()).getChannelData(0);
      const steady = samples.slice(sampleRate * .15, sampleRate * .65);
      return {
        finite: samples.every(Number.isFinite),
        peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
        rms: Math.sqrt(steady.reduce((sum, value) => sum + value * value, 0) / steady.length),
        tailPeak: samples.slice(sampleRate * .9).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
      };
    };
    const result = [];
    for (const sampleRate of [44100, 48000]) {
      result.push({ sampleRate,
        reference: await render('moire', .02, .48, sampleRate),
        revised: await render('automata', .02, .48, sampleRate),
        overload: await render('automata', 16, .82, sampleRate),
        muted: await render('automata', 16, 0, sampleRate),
      });
    }
    return result;
  }, audioClass);
  for (const { reference, revised, overload, muted } of measurements) {
    expect(revised.rms / reference.rms).toBeCloseTo(4, 3);
    for (const measured of [reference, revised, overload, muted]) {
      expect(measured.finite).toBe(true);
      expect(measured.peak).toBeLessThan(.9);
      expect(measured.tailPeak).toBeLessThan(.00001);
    }
    expect(overload.peak).toBeGreaterThan(.75);
    expect(muted.peak).toBe(0);
  }
  await testInfo.attach('output-calibration.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

test('row and column presets remain audible, bounded, adjustable and silent after stop', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('automatapoeia.html');
  await page.locator('#playButton').click();
  expect((await readAudioStatus(page)).active).toBe(false);
  await page.locator('#audioButton').click();
  const measurements = {};
  const set = (id, value) => page.locator(`#${id}`).evaluate((control, value) => {
    control.value = String(value);
    control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }, value);
  for (const id of ['original-thirty', 'ninety-carpet', 'columns-110', 'connected-54', 'fast-60', 'nasty-walls', 'radius-choir']) {
    await page.locator('.header-preset-picker summary').click();
    await page.locator(`[data-preset-id="${id}"]`).click();
    await page.locator('#seedAutomata').click();
    await page.waitForTimeout(700);
    const { summary } = await sampleAudioEnvelope(page, { durationMs: 1600 });
    measurements[id] = summary;
    expect(summary.finite, id).toBe(true);
    expect(summary.maxPeak, id).toBeGreaterThan(.02);
    expect(summary.maxPeak, id).toBeLessThan(.9);
    expect(summary.clippedSamples, id).toBe(0);
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  }
  for (const mode of ['row-events', 'vertical-sine']) {
    for (const [id, value] of Object.entries({ caSonificationMode: mode, caWidth: 127, caRate: 24, caDensity: 1, caSustain: 1, caRelease: 2, level: .82 })) await set(id, value);
    await page.locator('#seedAutomata').click();
    await page.waitForTimeout(700);
    const { summary } = await sampleAudioEnvelope(page, { durationMs: 1200 });
    measurements[`dense-${mode}`] = summary;
    expect(summary.finite).toBe(true);
    expect(summary.maxPeak).toBeLessThan(.9);
    expect(summary.clippedSamples).toBe(0);
  }
  await set('level', 0);
  await page.waitForTimeout(500);
  expect((await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxPeak).toBeLessThan(.001);
  await set('level', .48);
  await page.locator('#playButton').click();
  await page.waitForTimeout(500);
  expect((await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxPeak).toBeLessThan(.001);
  await page.locator('#audioButton').click();
  expect(errors).toEqual([]);
  await testInfo.attach('preset-levels.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});
