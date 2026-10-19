import { expect, test } from '@playwright/test';
import { installAudioInputFixture } from './helpers/audio-input-fixture.mjs';

const MODES = ['body', 'processing', 'reverb', 'resynthesis'];
const SECTIONS = { body: 'bodySection', processing: 'processingSection', reverb: 'reverbSection', resynthesis: 'resynthesisSection' };
const read = page => page.evaluate(() => globalThis.__MORPHAZOID_RUST_RESONATOR__.getState());

async function choose(page, id, value, touch = false) {
  const index = await page.locator('#' + id).evaluate((select, wanted) => [...select.options].findIndex(option => option.value === wanted), value);
  expect(index, `${id} includes ${value}`).toBeGreaterThanOrEqual(0);
  const summary = page.locator(`[data-select-id="${id}"] > summary`);
  const option = page.locator(`[data-select-id="${id}"] button[data-option-index="${index}"]`);
  if (touch) { await summary.tap(); await option.tap(); }
  else { await summary.click(); await option.click(); }
}
async function range(page, id, value) {
  await page.locator('#' + id).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function synchronized(page) {
  const state = await read(page), mode = state.settings.applicationMode;
  expect(MODES).toContain(mode);
  await expect(page.locator('#applicationMode')).toHaveValue(mode);
  expect(state.signal.stageOrder).toBe('process-resonance-reverb');
  for (const candidate of MODES) {
    const key = candidate + 'Enabled';
    expect(state.signal[key], `${mode}: ${key}`).toBe(candidate === mode);
    expect(Object.hasOwn(state.settings, key), `${key} is no longer preset state`).toBe(false);
    if (candidate === mode) await expect(page.locator('#' + SECTIONS[candidate])).toBeVisible();
    else await expect(page.locator('#' + SECTIONS[candidate])).toBeHidden();
  }
  for (const key of ['stageOrder', 'spaceTarget']) expect(Object.hasOwn(state.settings, key), key).toBe(false);
  if (mode === 'body') await expect(page.locator('#materialSection')).toBeVisible();
  else await expect(page.locator('#materialSection')).toBeHidden();
  const distributed = mode === 'body' || mode === 'resynthesis';
  await expect(page.locator('#spatialDistributionControls')).toHaveJSProperty('hidden', !distributed);
  if (state.surround.enabled && distributed) await expect(page.locator('#spatialDistributionControls')).toBeVisible();
  else if (!distributed) await expect(page.locator('#spatialDistributionControls')).toBeHidden();
  return state;
}

async function installOutputProbe(page) {
  await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const manager = getSharedAudioOutputManager(), context = manager.recordingContext();
    const analyser = context.createAnalyser(), silent = context.createGain();
    analyser.fftSize = 4096; silent.gain.value = 0;
    const release = manager.tapInto(context, analyser); analyser.connect(silent); silent.connect(context.destination);
    const samples = new Float32Array(analyser.fftSize);
    globalThis.__routingOutput = () => {
      analyser.getFloatTimeDomainData(samples);
      return { sameContext: context === manager.recordingContext(), finite: samples.every(Number.isFinite),
        peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
    };
    globalThis.__releaseRoutingOutput = () => { release(); analyser.disconnect(); silent.disconnect(); };
  });
}
async function audible(page) {
  await expect.poll(async () => (await page.evaluate(() => globalThis.__routingOutput())).peak).toBeGreaterThan(.00001);
  const output = await page.evaluate(() => globalThis.__routingOutput());
  expect(output.sameContext).toBe(true); expect(output.finite).toBe(true); expect(output.peak).toBeLessThan(1);
}

test('one role selector exposes exactly one engine and its controls without arming Audio', async ({ page }) => {
  await installAudioInputFixture(page); await page.goto('simd-resonator-rust.html');
  await expect(page.locator('#signalChain, #signalPath, #spaceTarget, [data-stage-move]')).toHaveCount(0);
  for (const mode of MODES) await expect(page.locator('#' + mode + 'Enabled')).toHaveCount(0);
  expect(await page.locator('#applicationMode').evaluate(select => [...select.options].map(option => option.value))).toEqual(MODES);
  expect((await synchronized(page)).settings.applicationMode).toBe('body');
  for (const mode of MODES) {
    await choose(page, 'applicationMode', mode); const state = await synchronized(page);
    expect(state).toMatchObject({ audioOn: false, audioReady: false, contextState: 'none', inputKind: 'excitation' });
  }
  await choose(page, 'inputSource', 'mic');
  for (const mode of [...MODES].reverse()) {
    await choose(page, 'applicationMode', mode); await page.locator('#pluckButton').click();
    await synchronized(page);
  }
  expect(await page.evaluate(() => window.__familyInput.requests)).toBe(0);
  expect(await read(page)).toMatchObject({ audioOn: false, audioReady: false, micOn: false, inputKind: 'mic' });
});

test('the role picker works by keyboard, restores focus and marks an edited preset Custom', async ({ page }) => {
  await page.goto('simd-resonator-rust.html');
  // Registration stays unselected until the first explicit preset action.
  await page.locator('.header-preset-next').click();
  await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('data-preset-id', 'unselected');
  const recalledId = (await read(page)).fullPresetId;
  const summary = page.locator('[data-select-id="applicationMode"] > summary');
  await summary.focus(); await summary.press('ArrowDown');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  expect((await synchronized(page)).settings.applicationMode).toBe('resynthesis');
  await expect(summary).toBeFocused();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
  await summary.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  expect((await synchronized(page)).settings.applicationMode).toBe('body');
  await expect(summary).toBeFocused();
  expect((await read(page)).audioOn).toBe(false);
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', recalledId);
});

test('preset recall, dice and reset keep the role picker and exclusive engine synchronized', async ({ page }) => {
  test.setTimeout(60000);
  await installAudioInputFixture(page); await page.goto('simd-resonator-rust.html');
  await range(page, 'outputLevel', .73);
  await choose(page, 'inputSource', 'sample-file'); await choose(page, 'inputSample', 'music-arp');
  const { bank, defaults } = await page.evaluate(async () => {
    const { PRESETS, DEFAULT_PRESET_SETTINGS } = await import('/src/instruments/simd-resonator-rust/presets.js');
    return { bank: PRESETS, defaults: DEFAULT_PRESET_SETTINGS };
  });
  expect(new Set(bank.map(preset => preset.snapshot.applicationMode))).toEqual(new Set(MODES));
  for (const preset of bank) {
    await page.locator('.header-preset-next').click();
    const state = await synchronized(page);
    expect(state.settings).toEqual(preset.snapshot);
    expect(state.fullPresetId).toBe(preset.id);
    expect(state.outputLevel).toBe(.73); expect(state.inputKind).toBe('sample-file');
    expect(state.input).toMatchObject({ sampleId: 'music-arp', playing: false });
    expect(state.audioOn).toBe(false);
  }
  const randomizedModes = new Set();
  for (let index = 0; index < 12; index++) {
    await page.locator('.header-preset-random').click(); const state = await synchronized(page);
    randomizedModes.add(state.settings.applicationMode);
    expect(state.fullPresetId).toBeNull();
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
    expect(state).toMatchObject({ audioOn: false, audioReady: false, outputLevel: .73, inputKind: 'sample-file' });
    expect(state.input).toMatchObject({ sampleId: 'music-arp', playing: false });
  }
  expect(randomizedModes.size).toBeGreaterThan(1);
  await page.locator('#resetButton').click(); const reset = await synchronized(page);
  expect(reset.settings).toEqual(defaults);
  expect(reset).toMatchObject({ audioOn: false, audioReady: false, outputLevel: .73, inputKind: 'sample-file' });
  expect(reset.input).toMatchObject({ sampleId: 'music-arp', playing: false });
  expect(await page.evaluate(() => window.__familyInput.requests)).toBe(0);
});

test('live role changes retain knob settings, the source, AudioContext and multichannel recording', async ({ page }) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('simd-resonator-rust.html');
  await choose(page, 'inputSource', 'sample-file'); await choose(page, 'inputSample', 'music-arp');
  await range(page, 'bodyMix', .65);
  await choose(page, 'applicationMode', 'resynthesis'); await range(page, 'fftMix', .55);
  await choose(page, 'applicationMode', 'reverb'); await range(page, 'reverbMix', .35);
  await choose(page, 'applicationMode', 'processing');
  await range(page, 'filterFrequency', 1300); await range(page, 'drive', 3); await range(page, 'outputLevel', .63);
  await page.locator('label[for="surroundEnabled"]').click(); await choose(page, 'surroundLayout', '4-ring');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).input.playing).toBe(true);
  await expect.poll(async () => (await read(page)).spatialEnabled).toBe(true);
  await installOutputProbe(page);
  await page.locator('#multitrackRecord').click();
  await expect.poll(async () => (await read(page)).recording.state).toBe('recording');
  const before = await read(page);
  for (const mode of MODES) {
    await choose(page, 'applicationMode', mode); await audible(page); const state = await synchronized(page);
    for (const [key, value] of Object.entries(before.settings)) if (key !== 'applicationMode') expect(state.settings[key], key).toEqual(value);
    expect(state.inputPlaybackRevision).toBe(before.inputPlaybackRevision);
    expect(state.input).toMatchObject({ playing: true, loop: true, sampleId: 'music-arp' });
    expect(state).toMatchObject({ audioOn: true, outputLevel: .63, contextState: 'running', recording: { state: 'recording' } });
    expect(state.surround).toMatchObject({ layoutId: '4-ring', channelCount: 4 });
    expect(state.spatialPeaks.every(value => Number.isFinite(value) && value <= .951)).toBe(true);
  }
  // Wet/dry still allows direct input without introducing a second engine or
  // resetting the source. Preset edits and reset keep the recording active.
  await range(page, 'wetMix', 0); await audible(page); await synchronized(page);
  await range(page, 'wetMix', 1);
  await page.locator('.header-preset-random').click(); await synchronized(page);
  await page.locator('#resetButton').click(); await synchronized(page); await audible(page);
  const after = await read(page);
  expect(after.inputPlaybackRevision).toBe(before.inputPlaybackRevision);
  expect(after.recording.state).toBe('recording');
  expect(after.outputLevel).toBe(.63); expect(after.surround.channelCount).toBe(4);
  expect(after.contextTime).toBeGreaterThan(before.contextTime);
  await expect.poll(async () => (await read(page)).recording.seconds).toBeGreaterThan(.5);
  await page.locator('#multitrackRecord').click(); await expect(page.locator('#multitrackDialog')).toBeVisible();
  await page.locator('#multitrackDiscard').click(); await page.evaluate(() => globalThis.__releaseRoutingOutput());
  await page.locator('#audioButton').click(); await expect.poll(async () => (await read(page)).contextState).toBe('none');
  expect(errors).toEqual([]);
});

test('all four roles preserve one live microphone capture until Audio is turned off', async ({ page }) => {
  test.setTimeout(45000);
  await installAudioInputFixture(page); await page.goto('simd-resonator-rust.html');
  await choose(page, 'inputSource', 'mic');
  await page.locator('#micButton').click(); await expect.poll(async () => (await read(page)).micOn).toBe(true);
  expect((await read(page)).audioOn).toBe(false);
  await page.locator('#audioButton').click(); await expect.poll(async () => (await read(page)).audioOn).toBe(true);
  await installOutputProbe(page);
  for (const mode of MODES) {
    await choose(page, 'applicationMode', mode); await synchronized(page); await audible(page);
    expect((await read(page)).micOn).toBe(true);
    expect(await page.evaluate(() => window.__familyInput.requests)).toBe(1);
  }
  await page.evaluate(() => globalThis.__releaseRoutingOutput()); await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).micOn).toBe(false);
  expect(await page.evaluate(() => window.__familyInput.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  await page.evaluate(() => Promise.all(window.__familyInput.contexts.map(context => context.close())));
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`${viewport.width}×${viewport.height}: role and source controls stay reachable by touch without overlap`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(test.info().project.use.baseURL + 'simd-resonator-rust.html');
    for (const mode of MODES) {
      await choose(page, 'applicationMode', mode, true); await synchronized(page);
      await page.locator('#' + SECTIONS[mode]).scrollIntoViewIfNeeded();
      await expect(page.locator('#' + SECTIONS[mode])).toBeVisible();
    }
    for (const id of ['applicationMode', 'inputSource', 'excitationType']) {
      const control = page.locator(`[data-select-id="${id}"] > summary`);
      await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds.width).toBeGreaterThanOrEqual(24); expect(bounds.height).toBeGreaterThanOrEqual(24);
    }
    const geometry = await page.evaluate(() => {
      const selectors = ['applicationMode', 'inputSource', 'excitationType'];
      return selectors.map(id => {
        const rect = document.querySelector(`[data-select-id="${id}"] > summary`).getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
      });
    });
    for (let a = 0; a < geometry.length; a++) for (let b = a + 1; b < geometry.length; b++) {
      const left = geometry[a], right = geometry[b];
      const overlapX = Math.min(left.right, right.right) - Math.max(left.x, right.x);
      const overlapY = Math.min(left.bottom, right.bottom) - Math.max(left.y, right.y);
      expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(1);
    }
    await choose(page, 'excitationType', 'hard-mallet', true);
    await page.locator('#pluckButton').tap();
    expect((await read(page)).audioOn).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.locator('.panel').evaluate(panel => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
    await context.close();
  });
}
