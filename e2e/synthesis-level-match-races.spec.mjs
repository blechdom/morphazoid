import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';
import { PERCUSSION_INSTRUMENT_PRESETS } from '../src/instruments/synthesis/instrument-presets.js';

async function deferredMeasurements(page) {
  await page.addInitScript(() => {
    // Keep main dice on synthesis and make its complete generated state repeatable.
    Math.random = () => .01;
    const NativeWorker = globalThis.Worker, NativeNode = globalThis.AudioWorkletNode;
    window.__levelRequests = []; window.__audioStates = [];
    globalThis.Worker = class {
      constructor(url, options) {
        if (options?.name !== 'synthesis-preset-level') return new NativeWorker(url, options);
      }
      postMessage(message) {
        if (message.type === 'warm') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
        if (message.type === 'match') window.__levelRequests.push({ worker: this, ...message });
      }
      terminate() {}
    };
    globalThis.AudioWorkletNode = class extends NativeNode {
      constructor(context, name, options) {
        super(context, name, options);
        if (name !== 'roads-synthesis') return;
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, ...args) => {
          if (message.state) window.__audioStates.push(structuredClone(message.state));
          return post(message, ...args);
        };
      }
    };
    window.__deliverLevelResult = index => {
      const request = window.__levelRequests[index];
      request.worker.onmessage({ data: { type: 'result', id: request.id,
        result: { sourceTrimDb: -20, outputGain: .3, stats: {} } } });
    };
  });
  await page.goto('/synthesis.html');
  await expect(page.locator('#randomPerformance')).toBeVisible();
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  await page.locator('#randomPerformance').click();
  await page.waitForFunction(() => window.__levelRequests.length === 1);
}

async function musicalState(page) {
  return page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
}

test('slow background matching never locks controls and cannot overwrite a newer parameter edit', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await deferredMeasurements(page);
  const initial = await page.evaluate(() => ({
    state: window.MorphazoidSynthesis.getState(), status: window.MorphazoidSynthesis.getStatus(),
    inert: [document.getElementById('inputBar').inert, document.querySelector('.synthesis-layout').inert, document.getElementById('transportTiming').inert],
    matchingDisabled: document.getElementById('matchPresetLevels').disabled,
    headerBusy: document.querySelector('.header-preset-controls').getAttribute('aria-busy'),
  }));
  expect(initial.inert).toEqual([false, false, false]); expect(initial.matchingDisabled).toBe(false);
  expect(initial.headerBusy).not.toBe('true'); expect(initial.status).toMatchObject({ armed: true, playing: true });
  await page.locator('#frequencyControl .synthesis-knob-value').click();
  await page.locator('#frequencyHz').fill('473');
  await page.locator('#frequencyHz').press('Enter');
  await expect.poll(() => page.evaluate(() => window.MorphazoidSynthesis.getState().frequencyHz)).toBe(473);
  const edited = await musicalState(page);
  const before = await page.evaluate(() => ({ state: window.__audioStates.at(-1), count: window.__audioStates.length }));
  await page.evaluate(() => window.__deliverLevelResult(0)); await page.waitForTimeout(80);
  expect(await musicalState(page)).toEqual(edited);
  const after = await page.evaluate(() => ({ state: window.__audioStates.at(-1), count: window.__audioStates.length,
    status: window.MorphazoidSynthesis.getStatus(), level: window.MorphazoidSynthesis.getState().outputLevel }));
  expect(after.state.levelTrimDb).toBe(before.state.levelTrimDb);
  expect(after.count).toBe(before.count);
  expect(after.status).toMatchObject({ armed: true, playing: true }); expect(after.level).toBe(initial.state.outputLevel);
  expect(errors).toEqual([]);
});

test('changing to a user-owned file input cancels pending source matching without late routing or gain changes', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await deferredMeasurements(page);
  await page.evaluate(() => {
    const input = document.getElementById('inputCategory'); input.value = 'file'; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.MorphazoidSynthesis.getStatus().routing.input === 'file');
  const changed = await musicalState(page);
  await page.evaluate(() => window.__deliverLevelResult(0)); await page.waitForTimeout(80);
  expect(await musicalState(page)).toEqual(changed);
  const status = await page.evaluate(() => window.MorphazoidSynthesis.getStatus());
  expect(status).toMatchObject({ armed: true, playing: true, routing: { input: 'file' } });
  expect(await page.evaluate(() => window.__levelRequests.length)).toBe(1, 'file input must never launch source normalization');
  expect(errors).toEqual([]);
});

test('disabling level matching cancels a pending background result and leaves Audio and Play unchanged', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await deferredMeasurements(page);
  await page.locator('#matchPresetLevels').uncheck();
  const unchanged = await musicalState(page);
  const before = await page.evaluate(() => window.__audioStates.at(-1));
  await page.evaluate(() => window.__deliverLevelResult(0)); await page.waitForTimeout(80);
  expect(await musicalState(page)).toEqual(unchanged);
  expect(await page.evaluate(() => window.__audioStates.at(-1).levelTrimDb)).toBe(before.levelTrimDb);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus())).toMatchObject({ armed: true, playing: true });
  expect(await page.locator('#matchPresetLevels').isChecked()).toBe(false);
  expect(errors).toEqual([]);
});

test('matched drum source gain survives downstream processor changes and bypass', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeNode = globalThis.AudioWorkletNode;
    globalThis.AudioWorkletNode = class extends NativeNode {
      constructor(context, name, options) {
        super(context, name, options);
        if (name !== 'roads-synthesis') return;
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, ...args) => {
          if (message.state) window.__lastSourceState = structuredClone(message.state);
          return post(message, ...args);
        };
      }
    };
  });
  await page.goto('/synthesis.html');
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  const picker = page.locator('#performancePresetHost');
  const preset = PERCUSSION_INSTRUMENT_PRESETS[0];
  await picker.locator('summary').click();
  await picker.getByRole('button', { name: preset.label, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__lastSourceState?.percussion?.gain), { timeout: 10000 }).toBeGreaterThan(1);
  const gain = await page.evaluate(() => window.__lastSourceState.percussion.gain);
  await page.locator('#processorEnabled').check();
  await choose(page, 'processorMethod', 'fx-delay');
  expect(await page.evaluate(() => window.__lastSourceState.percussion.gain)).toBe(gain);
  await page.locator('#processorEnabled').uncheck();
  expect(await page.evaluate(() => window.__lastSourceState.percussion.gain)).toBe(gain);
  await page.locator('#matchPresetLevels').uncheck();
  expect(await page.evaluate(() => window.__lastSourceState.percussion.gain)).toBe(1);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus())).toMatchObject({ armed: true, playing: true });
});
