import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { enforceRubixoidsOwnership } from './helpers/rubixoids-ownership.mjs';

enforceRubixoidsOwnership(test, expect);

const appPath = '/src/instruments/rubixoids/rubixoids-app.js';
const mainAudio = page => page.locator('body > .masthead #audioButton');
const mainPlay = page => page.locator('body > .rubixoids-bar #playButton');
const snapshot = page => page.evaluate(() => window.__rubixoidsSnapshot());

async function openPlayingCube(page) {
  await page.goto('/rubixoids.html');
  await expect.poll(async () => (await snapshot(page)).dimension).toBe('3d');
  await expect(mainAudio(page)).toBeEnabled();
  await page.locator('.header-preset-picker [data-preset-id="classic"]').evaluate(button => button.click());
  await mainAudio(page).click();
  await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true');
  await mainPlay(page).click();
  await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'true');
}

async function expectPlayingCube(page) {
  await expect.poll(async () => (await snapshot(page)).dimension).toBe('3d');
  const state = (await snapshot(page)).dimensions['3d'];
  expect(state.audioOn).toBe(true);
  expect(state.playing).toBe(true);
  expect(state.diagnostics.contextState).toBe('running');
  await expect(page.locator('.rubixoids-pane[data-dimension="3d"]')).toBeVisible();
  const envelope = await sampleAudioEnvelope(page, { durationMs: 450 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
}

for (const failure of ['styles', 'controller']) {
  test(`A failed 4D ${failure} load keeps 3D sounding and the next selection retries cleanly`, async ({ page }) => {
    await openPlayingCube(page);
    const suffix = failure === 'styles' ? '/hyper-rubix.css' : '/hyper-rubix-app.js';
    const requests = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname.endsWith(suffix)) requests.push(request.url());
    });
    const route = `**${suffix}`;
    await page.route(route, request => request.abort('failed'));
    await page.locator('.rubixoids-dimensions [data-dimension="4d"]').click();
    await expect(page.locator('#rubixoidsStatus')).toContainText(failure === 'styles' ? 'Could not load' : 'Failed to fetch');
    await expectPlayingCube(page);
    await expect(page.locator('.rubixoids-pane[data-dimension="4d"]')).toHaveCount(0);
    expect(await page.evaluate(async () => {
      const { nativeInstrumentContext } = await import('/src/instruments/rubixoids/native-context.js');
      return nativeInstrumentContext('hyper-rubix') === null;
    })).toBe(true);

    await page.unroute(route);
    await page.locator('.rubixoids-dimensions [data-dimension="4d"]').click();
    await expect.poll(async () => (await snapshot(page)).dimension).toBe('4d');
    await expect(mainAudio(page)).toBeEnabled();
    await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.rubixoids-pane[data-dimension="4d"]')).toHaveCount(1);
    const state = await snapshot(page);
    expect(state.dimensions['4d'].diagnostics.contextState).toBe('running');
    expect(state.dimensions['3d'].diagnostics.contextState).toBe('suspended');
    expect(requests).toHaveLength(2);
    if (failure === 'controller') {
      expect(new URL(requests[0]).search).toBe('');
      expect(new URL(requests[1]).searchParams.get('rubixoids-retry')).toBe('1');
    }
  });
}

test('A failed destination activation restores the playing source and presets, then retries', async ({ page }) => {
  await openPlayingCube(page);
  const before = await page.evaluate(async () => {
    const { captureHeaderPresetState } = await import('/src/site/header-presets.js');
    return captureHeaderPresetState();
  });
  await page.evaluate(async appPath => {
    const { rubixoidsInstrument, selectRubixoidsDimension } = await import(appPath);
    await selectRubixoidsDimension('4d');
    await selectRubixoidsDimension('3d');
    const hyper = rubixoidsInstrument('4d');
    const activate = hyper.bridge.activate;
    let fail = true;
    hyper.bridge.activate = async function (...args) {
      const result = await activate.apply(this, args);
      if (fail) { fail = false; throw new Error('One-time destination activation failure'); }
      return result;
    };
    await selectRubixoidsDimension('4d');
  }, appPath);
  await expect(page.locator('#rubixoidsStatus')).toContainText('One-time destination activation failure');
  await expectPlayingCube(page);
  const restored = await page.evaluate(async () => {
    const { captureHeaderPresetState } = await import('/src/site/header-presets.js');
    return captureHeaderPresetState();
  });
  expect(restored).toEqual(before);
  await expect(page.locator('.rubixoids-dimensions [data-dimension="3d"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.rubixoids-pane[data-dimension="3d"]').evaluate(pane => pane.inert)).toBe(false);
  await expect(page.locator('.rubixoids-pane[data-dimension="4d"]')).toBeHidden();
  const failed = (await snapshot(page)).dimensions['4d'];
  expect(failed.diagnostics.contextState).toBe('suspended');
  expect(failed.diagnostics.schedulerActive).toBe(false);
  expect(new URL(page.url()).searchParams.get('dimension')).toBe('3d');

  await page.locator('.rubixoids-dimensions [data-dimension="4d"]').click();
  await expect.poll(async () => (await snapshot(page)).dimension).toBe('4d');
  await expect(mainAudio(page)).toBeEnabled();
  await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.rubixoids-pane[data-dimension="4d"]').evaluate(pane => pane.inert)).toBe(false);
  expect(new URL(page.url()).searchParams.get('dimension')).toBe('4d');
});
